/**
 * Deterministic 120 Hz Martian walker.
 * Scene axes: +X east, +Y up, +Z south.
 *
 * Character controller: Mars gravity (≈3.72 m/s² at Gale) for jumps and falls,
 * the walker never slides: any slope can be walked (slower uphill), small ledges
 * are stepped onto, and taller ones block and need a jump.
 *
 * ICollisionWorld is a no-op adapter. A later Rapier WASM build can replace
 * createNullCollisionWorld without changing the visor. Do not vendor Rapier here.
 */

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

export const FIXED_DT = 1 / 120;
const DRAG_CD = 1;
const DRAG_AREA_M2 = 0.7;
const AIR_TEMP_K = 240;

/** @returns {{ raycast: Function, collide: Function }} */
export function createNullCollisionWorld() {
  return {
    raycast() {
      return null;
    },
    collide() {
      return false;
    },
  };
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
    collisionWorld: createNullCollisionWorld(),
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

const BRAKE_BOOST = 3.4;
const ACCEL_BOOST = 2.2;

function clampAccel(ax, az, cap) {
  const mag = Math.hypot(ax, az);
  if (mag > cap && mag > 0) {
    const s = cap / mag;
    return [ax * s, az * s];
  }
  return [ax, az];
}

// Character-controller tuning. Gameplay values, not measured suit data.
/** Ledge the walker steps onto without jumping, metres. */
export const STEP_UP_M = 0.45;
/** Ground drop the walker follows instead of going airborne, metres per substep. */
const SNAP_DOWN_M = 0.12;
/** Mid-air steering, m/s². Small, so jumps keep their Mars arc. */
const AIR_CONTROL_MS2 = 1.2;

function slideAlongWall(body, oldX, oldZ, sampleHeight, maxRise) {
  // Try each axis on its own so the walker slides along a ledge it cannot climb.
  const hX = sampleHeight(body.x, oldZ);
  const hZ = sampleHeight(oldX, body.z);
  const okX = hX - body.y <= maxRise;
  const okZ = hZ - body.y <= maxRise;
  if (!okX) body.vx = 0;
  if (!okZ) body.vz = 0;
  body.x = okX ? body.x : oldX;
  body.z = okZ ? body.z : oldZ;
  if (okX && okZ) {
    // Diagonal into a corner: both axes fine alone but not together.
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

  const grad = Math.hypot(patch.dhdx, patch.dhdz);
  if (grad > 1e-6) {
    body.uphillX = patch.dhdx / grad;
    body.uphillZ = patch.dhdz / grad;
  } else {
    body.uphillX = 0;
    body.uphillZ = 0;
  }

  const wishX = input.wishX || 0;
  const wishZ = input.wishZ || 0;
  const wishLen = Math.hypot(wishX, wishZ);
  const wishUx = wishLen > 1e-6 ? wishX / wishLen : 0;
  const wishUz = wishLen > 1e-6 ? wishZ / wishLen : 0;
  const along = patch.dhdx * wishUx + patch.dhdz * wishUz;
  const slopeAlongDeg = (Math.atan(along) * 180) / Math.PI;
  body.gradePercent = 100 * along;
  let gradeScale = gradeSpeedScale(slopeAlongDeg);
  if (body.grounded) gradeScale *= landingControl(body.impactSpeed, body.crouchT, body.crouchDur);
  const speed = wishLen > 1e-6 ? targetSpeedMs(Boolean(input.run), input.speedMultiplier ?? 1) * gradeScale : 0;
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
    // Hitting a wall mid-air: stop the horizontal motion into it.
    if (sampleHeight(body.x, body.z) - body.y > STEP_UP_M) {
      slideAlongWall(body, oldX, oldZ, sampleHeight, STEP_UP_M);
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
      // Rising through a lip: lift onto it instead of clipping inside the terrain.
      body.y = ground;
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
    const footY = body.y + body.sinkM;
    if (next - footY > STEP_UP_M) {
      // A ledge taller than a step: block, slide along it. Jump to get up.
      slideAlongWall(body, oldX, oldZ, sampleHeight, STEP_UP_M + footY - body.y);
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
