/**
 * Deterministic 120 Hz Martian walker & Rapier3D WASM Physics Backend (`web/physics/MarsPhysicsWorld.js`).
 * Scene axes: +X east, +Y up, +Z south.
 *
 * Replaces `createNullCollisionWorld` and custom wall-slide / OBB / ray clipping with
 * `@dimforge/rapier3d-compat` (`RAPIER.World`, `KinematicCharacterController`,
 * `HeightField`, `DynamicRayCastVehicleController`, `Cuboid`, and `Ray`).
 */

import RAPIERPkg from "../../node_modules/@dimforge/rapier3d-compat/rapier.es.js";
import { M_MARS_KG_MOL, MARS_GEODESY, P_GALE_PA, R_UNIV_J_MOL_K, SUIT_BODY } from "./MarsConstants.js";
import { coriolisAccel, marsGravityMs2 } from "./MarsGravityField.js";
import { bootSinkM, classifyFacies, frictionAccelMax } from "./Terramechanics.js";
import {
  JUMP_SPEED_MS,
  RESPONSE_TAU_S,
  gradeSpeedScale,
  landingControl,
  landingCrouchM,
  targetSpeedMs,
} from "./SuitBiomechanics.js";

export const RAPIER = RAPIERPkg?.default || RAPIERPkg;
await RAPIER.init();

export const FIXED_DT = 1 / 120;
const DRAG_CD = 1;
const DRAG_AREA_M2 = 0.7;
const AIR_TEMP_K = 240;

/** Ledge the walker steps onto without jumping, metres. */
export const STEP_UP_M = 0.45;
/** Ground drop the walker follows instead of going airborne, metres per substep. */
export const SNAP_DOWN_M = 0.12;
/** Mid-air steering, m/s². Small, so jumps keep their Mars arc. */
const AIR_CONTROL_MS2 = 1.2;

const BRAKE_BOOST = 3.4;
const ACCEL_BOOST = 2.2;

// Shared scratch Rapier world + cuboid collider for synchronous OBB point-projection queries
const _obbScratchWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
const _obbScratchCollider = _obbScratchWorld.createCollider(
  RAPIER.ColliderDesc.cuboid(1.75, 10.0, 3.1)
);

/**
 * Resolve 2D/3D cylinder vs oriented bounding box (OBB) collision using Rapier's `Collider.projectPoint`.
 */
export function resolveObbCollisionRapier(
  roverX,
  roverZ,
  roverYaw,
  roverY,
  entityX,
  entityZ,
  entityRadius = 0.42,
  entityY = null,
  halfW = 1.66,
  halfL = 2.42,
  roofHeight = 3.25
) {
  if (entityY != null && Number.isFinite(entityY) && Number.isFinite(roverY)) {
    if (entityY > roverY + roofHeight + 0.25) {
      return { hit: false, x: entityX, z: entityZ, nx: 0, nz: 0, pen: 0 };
    }
  }

  const hw = Math.max(0.05, halfW);
  const hl = Math.max(0.05, halfL);
  _obbScratchCollider.setHalfExtents({ x: hw, y: 10.0, z: hl });
  _obbScratchCollider.setTranslation({ x: roverX, y: 0, z: roverZ });
  const halfYaw = roverYaw * 0.5;
  _obbScratchCollider.setRotation({
    x: 0,
    y: Math.sin(halfYaw),
    z: 0,
    w: Math.cos(halfYaw),
  });

  const proj = _obbScratchCollider.projectPoint({ x: entityX, y: 0, z: entityZ }, false);
  const dx = entityX - proj.point.x;
  const dz = entityZ - proj.point.z;
  const dist = Math.hypot(dx, dz);

  if (!proj.isInside && dist >= entityRadius) {
    return { hit: false, x: entityX, z: entityZ, nx: 0, nz: 0, pen: 0 };
  }

  if (!proj.isInside && dist > 1e-6) {
    const nx = dx / dist;
    const nz = dz / dist;
    const pen = entityRadius - dist;
    return {
      hit: true,
      x: proj.point.x + nx * entityRadius,
      z: proj.point.z + nz * entityRadius,
      nx,
      nz,
      pen,
    };
  }

  if (proj.isInside && dist > 1e-6) {
    const nx = -dx / dist;
    const nz = -dz / dist;
    const pen = dist + entityRadius;
    return {
      hit: true,
      x: proj.point.x + nx * entityRadius,
      z: proj.point.z + nz * entityRadius,
      nx,
      nz,
      pen,
    };
  }

  // Exact center or boundary tie-breaker in OBB frame
  const cosY = Math.cos(roverYaw);
  const sinY = Math.sin(roverYaw);
  const rdx = entityX - roverX;
  const rdz = entityZ - roverZ;
  const lx = rdx * cosY - rdz * sinY;
  const lz = rdx * sinY + rdz * cosY;
  const penLeft = hw + lx;
  const penRight = hw - lx;
  const penFront = hl + lz;
  const penBack = hl - lz;
  const minFace = Math.min(penLeft, penRight, penFront, penBack);
  const pen = minFace + entityRadius;
  let normLx = 0;
  let normLz = 0;
  let outLx = lx;
  let outLz = lz;
  if (minFace === penLeft) {
    normLx = -1;
    outLx = -hw - entityRadius;
  } else if (minFace === penRight) {
    normLx = 1;
    outLx = hw + entityRadius;
  } else if (minFace === penFront) {
    normLz = -1;
    outLz = -hl - entityRadius;
  } else {
    normLz = 1;
    outLz = hl + entityRadius;
  }
  const nx = normLx * cosY + normLz * sinY;
  const nz = -normLx * sinY + normLz * cosY;
  return {
    hit: true,
    x: roverX + outLx * cosY + outLz * sinY,
    z: roverZ - outLx * sinY + outLz * cosY,
    nx,
    nz,
    pen,
  };
}

/**
 * Raycast a 3D segment `(ox, oy, oz) -> (ox + dx, oy + dy, oz + dz)` against an axis-aligned box
 * `[minX..maxX, minY..maxY, minZ..maxZ]` using Rapier's `Collider.castRay` and return the normalized
 * hit fraction `t` in `[0, 1]`, or `null` if no hit.
 */
export function castSegmentBoxRapier(ox, oy, oz, dx, dy, dz, minX, maxX, minY, maxY, minZ, maxZ) {
  if (ox > minX && ox < maxX && oy > minY && oy < maxY && oz > minZ && oz < maxZ) {
    return null;
  }
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-9) return null;
  const hx = Math.max(0.001, (maxX - minX) * 0.5);
  const hy = Math.max(0.001, (maxY - minY) * 0.5);
  const hz = Math.max(0.001, (maxZ - minZ) * 0.5);
  _obbScratchCollider.setHalfExtents({ x: hx, y: hy, z: hz });
  _obbScratchCollider.setTranslation({
    x: (minX + maxX) * 0.5,
    y: (minY + maxY) * 0.5,
    z: (minZ + maxZ) * 0.5,
  });
  _obbScratchCollider.setRotation({ x: 0, y: 0, z: 0, w: 1 });
  const ray = new RAPIER.Ray(
    { x: ox, y: oy, z: oz },
    { x: dx / len, y: dy / len, z: dz / len }
  );
  const toi = _obbScratchCollider.castRay(ray, len, false);
  if (toi == null || toi < 0 || toi > len) return null;
  return toi / len;
}

/**
 * Shared vertical ballistic crest-launch / gravity solver used across rovers and vehicles.
 */
export function stepBallisticVertPhysics(
  state,
  { groundY, slopeClimbVy = 0, bumpImpulseVy = 0, horizSpeed = 0, jumpBias = 1.0, dt = 0.016, marsG = 4.65 } = {}
) {
  const s = state;
  const safeDt = Math.max(0.001, Math.min(0.05, dt));
  if (s.posY == null || !Number.isFinite(s.posY) || Math.abs(groundY - (s.prevGroundY ?? groundY)) > 6.0) {
    s.posY = groundY;
    s.velY = 0;
    s.prevGroundY = groundY;
    s.airborne = false;
    s.airTime = 0;
    s.peakLaunchVy = 0;
    s.landingCooldown = 0;
    return { launched: false, landed: false, impactSpeed: 0 };
  }

  const groundRiseRate = Math.max(-8, Math.min(10, (groundY - s.prevGroundY) / safeDt));
  s.prevGroundY = groundY;
  s.landingCooldown = Math.max(0, (s.landingCooldown || 0) - safeDt);

  if (!s.airborne) {
    if (s.landingCooldown > 0) {
      s.posY = groundY;
      s.velY = 0;
      s.peakLaunchVy = 0;
      s.airTime = 0;
      return { launched: false, landed: false, impactSpeed: 0 };
    }
    const rawClimb = Math.max(groundRiseRate * 0.48 + slopeClimbVy * 0.45, slopeClimbVy * 0.78) + bumpImpulseVy;
    const maxLaunchVy = 2.4 * Math.min(1.1, Math.max(0.75, jumpBias));
    const effectiveClimb = Math.max(-4, Math.min(maxLaunchVy, (rawClimb - 0.55) * jumpBias));
    s.peakLaunchVy = Math.max((s.peakLaunchVy || 0) * Math.exp(-safeDt * 8.5), effectiveClimb);

    const ballisticY = s.posY + s.peakLaunchVy * safeDt - 0.5 * marsG * safeDt * safeDt;
    const clearance = ballisticY - groundY;
    const launchSpeedThresh = 14.5 / Math.max(0.75, jumpBias);
    const shouldLaunch =
      (clearance > 0.14 && s.peakLaunchVy > 1.95 && horizSpeed > launchSpeedThresh) || bumpImpulseVy > 3.4;

    if (shouldLaunch) {
      s.airborne = true;
      s.velY = Math.min(maxLaunchVy, Math.max(s.peakLaunchVy, bumpImpulseVy > 3.4 ? bumpImpulseVy * jumpBias : 1.9));
      s.posY = Math.max(s.posY, groundY) + s.velY * safeDt;
      s.airTime = 0;
      s.peakLaunchVy = 0;
      return { launched: true, landed: false, impactSpeed: 0 };
    }

    s.posY = groundY;
    s.velY = Math.min(0, effectiveClimb);
    s.airTime = 0;
    return { launched: false, landed: false, impactSpeed: 0 };
  }

  s.airTime += safeDt;
  s.velY -= marsG * safeDt;
  s.posY += s.velY * safeDt;

  if (s.posY <= groundY) {
    const impactSpeed = Math.max(0, -s.velY);
    s.posY = groundY;
    s.velY = 0;
    s.airborne = false;
    s.airTime = 0;
    s.peakLaunchVy = 0;
    s.landingCooldown = 0.24;
    return { launched: false, landed: true, impactSpeed };
  }

  return { launched: false, landed: false, impactSpeed: 0 };
}

/**
 * Create a Rapier3D WASM collision world with:
 * - `KinematicCharacterController` walker capsule (respecting `STEP_UP_M`, `SNAP_DOWN_M`, and Mars slope limits)
 * - Optional `HeightField` terrain collider (`setTerrainHeightfield`)
 * - Box/OBB colliders (`addBox`, `setBoxes`) for habitat rooms, walls, ramps, and rovers
 * - Raycasting (`raycast`, `castRay`, `clipSegment`) for camera arm occlusion and obstacle checks
 */
export function createRapierCollisionWorld({
  gravityY = -3.717,
  capsuleRadius = 0.25,
  capsuleHalfHeight = 0.55,
} = {}) {
  const world = new RAPIER.World({ x: 0, y: gravityY, z: 0 });
  const kcc = world.createCharacterController(0.005);
  kcc.setUp({ x: 0, y: 1, z: 0 });
  kcc.enableAutostep(STEP_UP_M, 0.15, true);
  kcc.enableSnapToGround(SNAP_DOWN_M);
  kcc.setSlideEnabled(true);

  const walkerRb = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, capsuleHalfHeight + capsuleRadius, 0)
  );
  const walkerCollider = world.createCollider(
    RAPIER.ColliderDesc.capsule(capsuleHalfHeight, capsuleRadius),
    walkerRb
  );

  // Reusable ledge-wall colliders for KCC tangent sliding against steep heightfield cliffs
  const wallColX = world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.5, 5.0, 5.0).setTranslation(1e6, 0, 1e6)
  );
  const wallColZ = world.createCollider(
    RAPIER.ColliderDesc.cuboid(5.0, 5.0, 0.5).setTranslation(1e6, 0, 1e6)
  );

  let terrainCollider = null;
  const boxColliders = [];

  function setTerrainHeightfield(nrows, ncols, heights, scale = { x: 1, y: 1, z: 1 }, origin = { x: 0, y: 0, z: 0 }) {
    if (terrainCollider) {
      world.removeCollider(terrainCollider, true);
      terrainCollider = null;
    }
    if (nrows >= 2 && ncols >= 2 && heights && heights.length >= nrows * ncols) {
      const f32 = heights instanceof Float32Array ? heights : new Float32Array(heights);
      const desc = RAPIER.ColliderDesc.heightfield(nrows - 1, ncols - 1, f32, scale).setTranslation(
        origin.x || 0,
        origin.y || 0,
        origin.z || 0
      );
      terrainCollider = world.createCollider(desc);
      world.updateSceneQueries();
    }
    return terrainCollider;
  }

  function clearBoxes() {
    while (boxColliders.length > 0) {
      const entry = boxColliders.pop();
      world.removeCollider(entry.collider, true);
    }
    world.updateSceneQueries();
  }

  function addBox({ minX, maxX, minY, maxY, minZ, maxZ, yaw = 0, tag = "" }) {
    const hx = Math.max(0.005, (maxX - minX) * 0.5);
    const hy = Math.max(0.005, (maxY - minY) * 0.5);
    const hz = Math.max(0.005, (maxZ - minZ) * 0.5);
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz);
    if (yaw) {
      const hyaw = -yaw * 0.5;
      desc.setRotation({ x: 0, y: Math.sin(hyaw), z: 0, w: Math.cos(hyaw) });
    }
    const collider = world.createCollider(desc);
    const entry = { collider, minX, maxX, minY, maxY, minZ, maxZ, cx, cy, cz, hx, hy, hz, yaw, tag };
    boxColliders.push(entry);
    return entry;
  }

  function setBoxes(boxes = []) {
    clearBoxes();
    for (const b of boxes) {
      addBox(b);
    }
    world.updateSceneQueries();
  }

  function raycast(origin, dir, maxToi = 100.0) {
    const len = Math.hypot(dir.x, dir.y, dir.z);
    if (len < 1e-8) return null;
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x / len, y: dir.y / len, z: dir.z / len }
    );
    const hit = world.castRayAndGetNormal(ray, maxToi, false, undefined, undefined, walkerCollider);
    if (!hit) return null;
    return {
      toi: hit.timeOfImpact,
      point: ray.pointAt(hit.timeOfImpact),
      normal: hit.normal,
      collider: hit.collider,
    };
  }

  function clipSegment(fromPt, toPt, radius = 0.22) {
    const dx = toPt.x - fromPt.x;
    const dy = toPt.y - fromPt.y;
    const dz = toPt.z - fromPt.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-6 || boxColliders.length === 0) {
      return { x: toPt.x, y: toPt.y, z: toPt.z, clipped: false, t: 1 };
    }
    world.updateSceneQueries();
    const ray = new RAPIER.Ray(
      { x: fromPt.x, y: fromPt.y, z: fromPt.z },
      { x: dx / dist, y: dy / dist, z: dz / dist }
    );
    const hit = world.castRayAndGetNormal(ray, dist, false, undefined, undefined, walkerCollider);
    if (!hit || hit.timeOfImpact > dist) {
      return { x: toPt.x, y: toPt.y, z: toPt.z, clipped: false, t: 1 };
    }
    const safeDist = Math.max(0.15, hit.timeOfImpact - radius);
    const tSafe = Math.max(0.05, Math.min(1, safeDist / dist));
    return {
      x: fromPt.x + dx * tSafe,
      y: fromPt.y + dy * tSafe,
      z: fromPt.z + dz * tSafe,
      clipped: true,
      t: tSafe,
    };
  }

  /**
   * Slide walker along a heightfield cliff/ledge using Rapier's `KinematicCharacterController`.
   */
  function slideLedgeKcc(body, oldX, oldZ, sampleHeight, maxRise, refY = body.y) {
    const dx = body.x - oldX;
    const dz = body.z - oldZ;
    const hX = sampleHeight(body.x, oldZ);
    const hZ = sampleHeight(oldX, body.z);
    const okX = hX - refY <= maxRise;
    const okZ = hZ - refY <= maxRise;

    if (okX && okZ) {
      // Diagonal corner where both axes are fine individually but blocked together
      body.x = oldX;
      body.z = oldZ;
      body.vx = 0;
      body.vz = 0;
      return;
    }

    const offset = capsuleRadius + 0.5 + 0.005;
    wallColX.setTranslation(
      !okX && Math.abs(dx) > 1e-9
        ? { x: oldX + Math.sign(dx) * offset, y: refY, z: oldZ }
        : { x: 1e6, y: 0, z: 1e6 }
    );
    wallColZ.setTranslation(
      !okZ && Math.abs(dz) > 1e-9
        ? { x: oldX, y: refY, z: oldZ + Math.sign(dz) * offset }
        : { x: 1e6, y: 0, z: 1e6 }
    );
    walkerRb.setTranslation({ x: oldX, y: refY + capsuleHalfHeight + capsuleRadius, z: oldZ }, true);
    world.propagateModifiedBodyPositionsToColliders();
    world.updateSceneQueries();
    kcc.computeColliderMovement(walkerCollider, { x: dx, y: 0, z: dz });
    const mv = kcc.computedMovement();
    wallColX.setTranslation({ x: 1e6, y: 0, z: 1e6 });
    wallColZ.setTranslation({ x: 1e6, y: 0, z: 1e6 });

    if (!okX) body.vx = 0;
    if (!okZ) body.vz = 0;
    body.x = okX ? oldX + mv.x : oldX;
    body.z = okZ ? oldZ + mv.z : oldZ;
  }

  function collide(capsule, delta) {
    if (boxColliders.length === 0 && !terrainCollider) {
      return false;
    }
    const centerOffset = capsuleHalfHeight + capsuleRadius;
    walkerRb.setTranslation(
      { x: capsule.x, y: (capsule.y || 0) + centerOffset, z: capsule.z },
      true
    );
    world.propagateModifiedBodyPositionsToColliders();
    world.updateSceneQueries();
    kcc.computeColliderMovement(walkerCollider, {
      x: delta?.dx || 0,
      y: delta?.dy || 0,
      z: delta?.dz || 0,
    });
    const mv = kcc.computedMovement();
    return {
      dx: mv.x,
      dy: mv.y,
      dz: mv.z,
      grounded: kcc.computedGrounded(),
    };
  }

  return {
    world,
    kcc,
    walkerRb,
    walkerCollider,
    boxColliders,
    setTerrainHeightfield,
    addBox,
    setBoxes,
    clearBoxes,
    raycast,
    castRay: raycast,
    clipSegment,
    slideLedgeKcc,
    collide,
  };
}

/** Backwards-compatible alias that returns the Rapier WASM collision world. */
export function createNullCollisionWorld() {
  return createRapierCollisionWorld();
}

export function createMarsBody(overrides = {}) {
  return {
    x: 0,
    z: 0,
    y: 0,
    vx: 0,
    vz: 0,
    vy: 0,
    grounded: true,
    jumpQueued: false,
    crouch: 0,
    crouchT: 0,
    crouchDur: 0.45,
    impactSpeed: 0,
    g: 3.717,
    slopeDeg: 0,
    cosSlope: 1,
    faciesId: "MUDSTONE_SLAB",
    eta: 1.05,
    sinkM: 0,
    uphillX: 0,
    uphillZ: 0,
    gradePercent: 0,
    accumulator: 0,
    prevX: 0,
    prevZ: 0,
    prevY: 0,
    collisionWorld: createRapierCollisionWorld(),
    ...overrides,
  };
}

function airDensity(elevM) {
  const g = 3.715;
  const H = (R_UNIV_J_MOL_K * AIR_TEMP_K) / (M_MARS_KG_MOL * g);
  const dH = elevM - MARS_GEODESY.GALE_ANCHOR_ELEV_M;
  const pressure = P_GALE_PA * Math.exp(-dH / H);
  return (pressure * M_MARS_KG_MOL) / (R_UNIV_J_MOL_K * AIR_TEMP_K);
}

function samplePatch(sampleHeight, x, z) {
  const d = 0.75;
  const hC = sampleHeight(x, z);
  const hL = sampleHeight(x - d, z);
  const hR = sampleHeight(x + d, z);
  const hD = sampleHeight(x, z - d);
  const hU = sampleHeight(x, z + d);
  const dhdx = (hR - hL) / (2 * d);
  const dhdz = (hU - hD) / (2 * d);
  const nx = -dhdx;
  const ny = 1;
  const nz = -dhdz;
  const len = Math.hypot(nx, ny, nz) || 1;
  // Wider stencil so centimetre stereo noise does not flip the facies every step.
  const w = 3;
  const laplacian =
    (sampleHeight(x - w, z) +
      sampleHeight(x + w, z) +
      sampleHeight(x, z - w) +
      sampleHeight(x, z + w) -
      4 * hC) /
    (w * w);
  return {
    height: hC,
    nx: nx / len,
    ny: ny / len,
    nz: nz / len,
    dhdx,
    dhdz,
    laplacian,
  };
}

function clampAccel(ax, az, cap) {
  const mag = Math.hypot(ax, az);
  if (mag > cap && mag > 0) {
    const s = cap / mag;
    return [ax * s, az * s];
  }
  return [ax, az];
}

function slideAlongWall(body, oldX, oldZ, sampleHeight, maxRise, refY = body.y) {
  if (body.collisionWorld && typeof body.collisionWorld.slideLedgeKcc === "function") {
    body.collisionWorld.slideLedgeKcc(body, oldX, oldZ, sampleHeight, maxRise, refY);
    return;
  }
  const hX = sampleHeight(body.x, oldZ);
  const hZ = sampleHeight(oldX, body.z);
  const okX = hX - refY <= maxRise;
  const okZ = hZ - refY <= maxRise;
  if (!okX) body.vx = 0;
  if (!okZ) body.vz = 0;
  body.x = okX ? body.x : oldX;
  body.z = okZ ? body.z : oldZ;
  if (okX && okZ) {
    body.x = oldX;
    body.z = oldZ;
    body.vx = 0;
    body.vz = 0;
  }
}

function substep(body, dt, input, env) {
  const sampleHeight = env.sampleHeight;
  const patch = samplePatch(sampleHeight, body.x, body.z);
  const slopeDeg = (Math.acos(Math.min(1, Math.max(-1, patch.ny))) * 180) / Math.PI;
  const facies = classifyFacies({ slopeDeg, laplacian: patch.laplacian });
  const lat = input.latDeg ?? MARS_GEODESY.GALE_ANCHOR_LAT_DEG;
  const elev = env.molaElevM ? env.molaElevM(body.x, body.z) : MARS_GEODESY.GALE_ANCHOR_ELEV_M + patch.height;
  const g = marsGravityMs2(lat, elev);
  body.g = g;
  body.slopeDeg = slopeDeg;
  body.cosSlope = patch.ny;
  body.faciesId = facies.id;
  body.eta = facies.eta;
  body.sinkM = bootSinkM(facies);

  // Depenetration guard: if the walker is already below the local surface at (body.x, body.z)
  // (e.g. after teleporting, exiting a rover, or a detail chunk loading higher beneath them),
  // lift them immediately onto the surface before any wall or step checks run.
  const surfaceFloorY = patch.height - body.sinkM;
  if (body.y < surfaceFloorY) {
    body.y = surfaceFloorY;
    if (body.vy < 0) body.vy = 0;
    body.grounded = true;
  }

  // Uphill unit vector in XZ from the terrain gradient.
  const gradMag = Math.hypot(patch.dhdx, patch.dhdz);
  const upX = gradMag > 1e-6 ? patch.dhdx / gradMag : 0;
  const upZ = gradMag > 1e-6 ? patch.dhdz / gradMag : 0;
  body.uphillX = upX;
  body.uphillZ = upZ;

  const wishX = input.wishX || 0;
  const wishZ = input.wishZ || 0;
  const wishLen = Math.hypot(wishX, wishZ);
  const wishUx = wishLen > 1e-6 ? wishX / wishLen : 0;
  const wishUz = wishLen > 1e-6 ? wishZ / wishLen : 0;

  // Grade along the walk direction (positive uphill, negative downhill).
  const dirDotGrad = wishUx * patch.dhdx + wishUz * patch.dhdz;
  body.gradePercent = dirDotGrad * 100;

  const baseSpeed = targetSpeedMs({
    forward: input.forward || 0,
    strafe: input.strafe || 0,
    sprint: Boolean(input.sprint),
    g,
    eta: facies.eta,
  });
  const gradeScale = gradeSpeedScale(body.gradePercent);
  const ctrl = body.grounded && body.impactSpeed > 0 ? landingControl(body.impactSpeed, body.crouchT, body.crouchDur) : 1;
  const speed = baseSpeed * gradeScale * ctrl * Math.min(1, wishLen);
  const vTargetX = wishUx * speed;
  const vTargetZ = wishUz * speed;

  if (body.grounded && body.jumpQueued) {
    body.vy = JUMP_SPEED_MS;
    body.grounded = false;
    body.y = Math.max(body.y, patch.height) + 0.02;
    body.crouch = 0;
  }
  body.jumpQueued = false;

  const oldX = body.x;
  const oldZ = body.z;

  if (!body.grounded) {
    // Ballistic flight under Mars g with thin-air drag and a little steering.
    const rho = airDensity(elev);
    const sp = Math.hypot(body.vx, body.vy, body.vz);
    const drag = (0.5 * rho * DRAG_CD * DRAG_AREA_M2 * sp) / SUIT_BODY.totalMassKg;
    const cor = coriolisAccel(body.vx, body.vy, body.vz, lat);
    let ax = -drag * body.vx + cor.x;
    let az = -drag * body.vz + cor.z;
    if (wishLen > 1e-6) {
      // Steer toward the wish direction without adding speed beyond the walk target.
      const vAlong = body.vx * wishUx + body.vz * wishUz;
      if (vAlong < Math.max(speed, 0.5)) {
        ax += wishUx * AIR_CONTROL_MS2;
        az += wishUz * AIR_CONTROL_MS2;
      }
    }
    body.vx += ax * dt;
    body.vz += az * dt;
    body.vy += (-g + -drag * body.vy + cor.y) * dt;
    body.x += body.vx * dt;
    body.z += body.vz * dt;
    body.y += body.vy * dt;
    // Hitting a wall mid-air: stop the horizontal motion into it (use oldGround so rising streamed terrain doesn't trap).
    const oldGround = sampleHeight(oldX, oldZ);
    const airRefY = Math.max(body.y, oldGround);
    if (sampleHeight(body.x, body.z) - airRefY > STEP_UP_M) {
      slideAlongWall(body, oldX, oldZ, sampleHeight, STEP_UP_M, airRefY);
    }
    const ground = sampleHeight(body.x, body.z);
    if (body.y <= ground && body.vy <= 0) {
      body.impactSpeed = -body.vy;
      body.y = ground - body.sinkM;
      body.vy = 0;
      body.grounded = true;
      body.crouchT = 0;
      body.crouchDur = 0.35 + Math.min(0.4, body.impactSpeed * 0.08);
    } else if (body.y < ground) {
      // Rising through a lip or streamed terrain: lift onto it instead of clipping inside the terrain.
      body.y = ground - body.sinkM;
    }
  } else {
    const cap = frictionAccelMax(facies.muStatic, g, patch.ny);
    const sp = Math.hypot(body.vx, body.vz);
    let ax;
    let az;
    // Game-feel pass: releasing the keys stops the walker almost at once (no ice-skating),
    // and standing still holds position on any slope (no sliding).
    if (speed === 0) {
      const stopStep = cap * BRAKE_BOOST * dt;
      if (sp <= Math.max(0.12, stopStep)) {
        body.vx = 0;
        body.vz = 0;
        ax = 0;
        az = 0;
      } else {
        ax = (-cap * BRAKE_BOOST * body.vx) / sp;
        az = (-cap * BRAKE_BOOST * body.vz) / sp;
      }
    } else {
      ax = (vTargetX - body.vx) / RESPONSE_TAU_S;
      az = (vTargetZ - body.vz) / RESPONSE_TAU_S;
      // Never let low grip or a steep grade stop the walker from getting moving.
      [ax, az] = clampAccel(ax, az, Math.max(cap * ACCEL_BOOST, 1.2));
    }
    body.vx += ax * dt;
    body.vz += az * dt;
    body.x += body.vx * dt;
    body.z += body.vz * dt;
    let next = sampleHeight(body.x, body.z);
    const footY = Math.max(body.y + body.sinkM, patch.height);
    const refY = footY - body.sinkM;
    if (next - footY > STEP_UP_M) {
      // A ledge taller than a step: block, slide along it via Rapier KCC. Jump to get up.
      slideAlongWall(body, oldX, oldZ, sampleHeight, STEP_UP_M + body.sinkM, refY);
      next = sampleHeight(body.x, body.z);
    }
    if (footY - next > SNAP_DOWN_M + Math.hypot(body.vx, body.vz) * dt * 1.2) {
      // Walked off an edge: fall.
      body.grounded = false;
    } else {
      body.y = next - body.sinkM;
      body.vy = 0;
    }
  }

  if (body.grounded && body.impactSpeed > 0) {
    body.crouchT += dt;
    const dy = landingCrouchM(body.impactSpeed, body.crouchT, body.crouchDur);
    body.crouch = -dy;
    if (body.crouchT >= body.crouchDur) {
      body.crouch = 0;
      body.impactSpeed = 0;
    }
  } else if (!body.grounded) {
    body.crouch = 0;
  }
}

export function stepPhysicsWorld(body, frameDt, input = {}, env = {}) {
  if (!env.sampleHeight) {
    throw new TypeError("stepPhysicsWorld requires env.sampleHeight(x, z)");
  }
  const dtFrame = Math.min(0.1, Math.max(0, frameDt));
  body.accumulator = Math.min((body.accumulator || 0) + dtFrame, 0.1);
  let guard = 0;
  while (body.accumulator >= FIXED_DT && guard < 20) {
    body.prevX = body.x;
    body.prevZ = body.z;
    body.prevY = body.y;
    substep(body, FIXED_DT, input, env);
    body.accumulator -= FIXED_DT;
    guard += 1;
  }
  return interpolateRenderState(body);
}

export function interpolateRenderState(body) {
  const alpha = FIXED_DT > 0 ? body.accumulator / FIXED_DT : 0;
  if (!(alpha > 0)) {
    return { x: body.x, y: body.y, z: body.z, alpha: 0 };
  }
  const t = Math.min(1, alpha);
  return {
    x: body.prevX + (body.x - body.prevX) * t,
    y: body.prevY + (body.y - body.prevY) * t,
    z: body.prevZ + (body.z - body.prevZ) * t,
    alpha: t,
  };
}
