/**
 * Deterministic 120 Hz Martian walker.
 * Scene axes: +X east, +Y up, +Z south.
 *
 * ICollisionWorld is a no-op adapter. A later Rapier WASM build can replace
 * createNullCollisionWorld without changing the visor. Do not vendor Rapier here.
 */

import { M_MARS_KG_MOL, MARS_GEODESY, P_GALE_PA, R_UNIV_J_MOL_K, SUIT_BODY } from "./MarsConstants.js";
import { coriolisAccel, marsGravityMs2 } from "./MarsGravityField.js";
import { bootSinkM, classifyFacies, frictionAccelMax } from "./Terramechanics.js";
import { JUMP_SPEED_MS, RESPONSE_TAU_S, landingCrouchM, targetSpeedMs } from "./SuitBiomechanics.js";

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

function clampAccel(ax, az, cap) {
  const mag = Math.hypot(ax, az);
  if (mag > cap && mag > 0) {
    const s = cap / mag;
    return [ax * s, az * s];
  }
  return [ax, az];
}

function substep(body, dt, input, env) {
  const sampleHeight = env.sampleHeight;
  const patch = samplePatch(sampleHeight, body.x, body.z);
  const slopeDeg = (Math.acos(Math.min(1, Math.max(-1, patch.ny))) * 180) / Math.PI;
  const facies = classifyFacies({ slopeDeg, laplacian: patch.laplacian });
  const lat = input.latDeg ?? MARS_GEODESY.GALE_ANCHOR_LAT_DEG;
  const elev = env.molaElevM ? env.molaElevM(body.x, body.z) : MARS_GEODESY.GALE_ANCHOR_ELEV_M + patch.height;
  const g = marsGravityMs2(lat, elev);
  const limit = input.slopeLimitDeg ?? 20;
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
  let gradeScale = 1;
  if (slopeAlongDeg > 0) {
    gradeScale = Math.min(1, Math.max(0.35, 1 - Math.max(0, slopeAlongDeg - 10) / 22));
  }
  const speed = wishLen > 1e-6 ? targetSpeedMs(Boolean(input.run), input.speedMultiplier ?? 1) * gradeScale : 0;
  const vTargetX = wishUx * speed;
  const vTargetZ = wishUz * speed;

  if (body.grounded && body.jumpQueued) {
    body.vy = JUMP_SPEED_MS;
    body.grounded = false;
    body.y = patch.height + 0.02;
    body.jumpQueued = false;
    body.crouch = 0;
  }

  if (body.grounded && body.y - patch.height > 0.25) {
    body.grounded = false;
  }

  if (!body.grounded) {
    const rho = airDensity(elev);
    const sp = Math.hypot(body.vx, body.vy, body.vz);
    const drag = (0.5 * rho * DRAG_CD * DRAG_AREA_M2 * sp) / SUIT_BODY.totalMassKg;
    const cor = coriolisAccel(body.vx, body.vy, body.vz, lat);
    body.vx += (-drag * body.vx + cor.x) * dt;
    body.vz += (-drag * body.vz + cor.z) * dt;
    body.vy += (-g + -drag * body.vy + cor.y) * dt;
    body.x += body.vx * dt;
    body.z += body.vz * dt;
    body.y += body.vy * dt;
    const landed = sampleHeight(body.x, body.z);
    if (body.y <= landed && body.vy <= 0) {
      body.impactSpeed = -body.vy;
      body.y = landed - bootSinkM(facies);
      body.vy = 0;
      body.grounded = true;
      body.crouchT = 0;
      body.crouchDur = 0.35 + Math.min(0.4, body.impactSpeed * 0.08);
    }
  } else if (slopeDeg > limit) {
    // Above the lunar stand-in limit the boots do not hold a climb.
    const gDotN = -g * patch.ny;
    const gpx = -gDotN * patch.nx;
    const gpz = -gDotN * patch.nz;
    const sp = Math.hypot(body.vx, body.vz);
    const fric = frictionAccelMax(facies.muKinetic, g, patch.ny);
    const eps = 0.04;
    let ax = gpx - (fric * body.vx) / (sp + eps);
    let az = gpz - (fric * body.vz) / (sp + eps);
    const steer = 0.25 * fric;
    ax += wishUx * steer;
    az += wishUz * steer;
    body.vx += ax * dt;
    body.vz += az * dt;
    body.x += body.vx * dt;
    body.z += body.vz * dt;
    const next = sampleHeight(body.x, body.z);
    if (body.y - next > 0.25) {
      body.grounded = false;
    } else {
      body.y = next - bootSinkM(classifyFacies({
        slopeDeg,
        laplacian: patch.laplacian,
      }));
      body.vy = 0;
    }
  } else {
    const cap = frictionAccelMax(facies.muStatic, g, patch.ny);
    const sp = Math.hypot(body.vx, body.vz);
    let ax;
    let az;
    // Releasing the stick brakes at the full friction limit (μ g), which is the
    // spec's ~0.98 s / ~1.22 m stop from 2.5 m/s. A soft tau tail would miss that.
    if (speed === 0 && sp > 0.03) {
      ax = (-cap * body.vx) / sp;
      az = (-cap * body.vz) / sp;
    } else {
      ax = (vTargetX - body.vx) / RESPONSE_TAU_S;
      az = (vTargetZ - body.vz) / RESPONSE_TAU_S;
      [ax, az] = clampAccel(ax, az, cap);
    }
    body.vx += ax * dt;
    body.vz += az * dt;
    body.x += body.vx * dt;
    body.z += body.vz * dt;
    const next = sampleHeight(body.x, body.z);
    if (body.y - next > 0.25) {
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
