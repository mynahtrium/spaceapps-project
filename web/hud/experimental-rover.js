/**
 * Experimental Drivable NASA MMSEV Mars Rover & Advanced 6-Wheel Physics (`web/hud/experimental-rover.js`).
 *
 * Driven by the official NASA 3D Resources Multi-Mission Space Exploration Vehicle (`mmsev-rover.glb`)
 * fitted with 6 articulated, steering, rolling NASA spring-mesh dual-wheel pods (with full procedural
 * fallback geometry).
 *
 * Physics highlights:
 *  - Pure 2D longitudinal + lateral tire slip vector dynamics with 4-speed motor torque curve.
 *  - Handbrake (`Space`) drift & powerslide oversteer with differential cornering grip.
 *  - 3.71 m/s² longitudinal & side-camber terrain gravity coupling.
 *  - 6-wheel independent suspension strut spring-damper compression + crest ballistic flight
 *    with in-air pitch/roll attitude angular momentum & reaction-wheel trim.
 */

import { mergeRigidParts, mergeStaticMeshes } from "./merge-static.js";
import { buildConceptHollowWheels, buildNasaConceptRoverVisuals } from "./concept-rover-model.js";

export const MARS_GRAVITY_MS2 = 3.71;
export const ROVER_FLIGHT_G = 9.4;
export const ROVER_COLLISION_RADIUS_M = 2.45;
export const ROVER_WHEEL_RADIUS_M = 0.345;
export const ROVER_OBB_HALF_W = 1.66;
export const ROVER_OBB_HALF_L = 2.42;
export const ROVER_OBB_HEIGHT_M = 3.25;

export const DRIVABLE_VEHICLES = Object.freeze([
  {
    id: "mmsev",
    nameEn: "NASA MMSEV Pressurized 6×6",
    nameTr: "NASA MMSEV Basınçlı 6×6",
    shortLabel: "MMSEV 6×6",
    badgeColor: "#f59e0b",
    topSpeedMs: 18.5,
    boostSpeedMs: 25.5,
    reverseSpeedMs: 9.0,
    roverMaxKmh: 38.6,
    roverBoostKmh: 45.6,
    roverReverseKmh: 14,
    accelGain: 9.2,
    brakeGain: 21.0,
    steerRate: 1.85,
    gripBase: 20.0,
    driftGrip: 7.4,
    massKg: 1850,
    weightN: 1850 * MARS_GRAVITY_MS2,
    powerW: 14000 * 2.25, // 31,500 W (31.5 kW, 2.25x)
    boostPowerW: 19000 * 2.25, // 42,750 W (42.75 kW, 2.25x)
    powerKw: (14000 * 2.25) / 1000,
    boostPowerKw: (19000 * 2.25) / 1000,
    hp: (14000 * 2.25) / 745.699872,
    boostHp: (19000 * 2.25) / 745.699872,
    wheelTorqueMaxNm: 1173 * 2.25, // 2,639.25 N·m (2.25x)
    motorTorqueMaxNm: (1173 * 2.25) / (11.2 * 0.88), // ~267.8 N·m matched to 45 km/h gearing
    gearRatio: 11.2,
    suspStiff: 52.0,
    suspDamp: 11.0,
    wheelRadius: 0.345,
    trackHalfW: 1.339,
    halfW: 1.66,
    halfL: 2.42,
    heightM: 3.25,
    jumpBias: 1.0,
    slopeTorque: 1.3,
    axles: [
      { z: -0.969, role: "front" },
      { z: 0.37, role: "mid" },
      { z: 1.708, role: "rear" },
    ],
  },
  {
    id: "nasa_concept",
    nameEn: "NASA Mars Rover Concept 6×6",
    nameTr: "NASA Mars Rover Konsepti 6×6",
    shortLabel: "MARS CONCEPT",
    badgeColor: "#38bdf8",
    topSpeedMs: 22.0,
    boostSpeedMs: 31.0,
    reverseSpeedMs: 11.0,
    roverMaxKmh: 50.6,
    roverBoostKmh: 60.6,
    roverReverseKmh: 18,
    accelGain: 10.6,
    brakeGain: 22.5,
    steerRate: 2.0,
    gripBase: 22.0,
    driftGrip: 8.0,
    massKg: 2250,
    weightN: 2250 * MARS_GRAVITY_MS2,
    powerW: 20200 * 2.25, // 45,450 W (45.45 kW, 2.25x)
    boostPowerW: 27400 * 2.25, // 61,650 W (61.65 kW, 2.25x)
    powerKw: (20200 * 2.25) / 1000,
    boostPowerKw: (27400 * 2.25) / 1000,
    hp: (20200 * 2.25) / 745.699872,
    boostHp: (27400 * 2.25) / 745.699872,
    wheelTorqueMaxNm: 2150 * 2.25, // 4,837.5 N·m (2.25x)
    motorTorqueMaxNm: (2150 * 2.25) / (12.6 * 0.88), // ~436.3 N·m matched to 60 km/h gearing
    gearRatio: 12.6,
    suspStiff: 56.0,
    suspDamp: 11.8,
    wheelRadius: 0.52,
    trackHalfW: 1.48,
    halfW: 1.82,
    halfL: 3.15,
    heightM: 2.85,
    jumpBias: 1.05,
    slopeTorque: 1.4,
    axles: [
      { z: -1.95, role: "front" },
      { z: 0.42, role: "mid" },
      { z: 1.98, role: "rear" },
    ],
  },
]);

function normalizeDrivableId(id = "mmsev") {
  return id === "mars_robo_concept" ? "nasa_concept" : id;
}

export function getDrivableVehicleSpec(id = "mmsev") {
  const canonical = normalizeDrivableId(id);
  return DRIVABLE_VEHICLES.find((v) => v.id === canonical) || DRIVABLE_VEHICLES[0];
}

export const GARAGE_DRIVABLE_VEHICLES = Object.freeze([
  DRIVABLE_VEHICLES[0],
  Object.freeze({
    ...DRIVABLE_VEHICLES[1],
    id: "mars_robo_concept",
    nameEn: "NASA Mars Robo Concept",
    nameTr: "NASA Mars Robo Konsepti",
  }),
]);

export function getGarageVehicleSpec(id = "mmsev") {
  if (id === "nasa_concept") return GARAGE_DRIVABLE_VEHICLES[1];
  return GARAGE_DRIVABLE_VEHICLES.find((v) => v.id === id) || GARAGE_DRIVABLE_VEHICLES[0];
}

const MMSEV_POD_AXLES = DRIVABLE_VEHICLES[0].axles;
const MMSEV_TRACK_HALF_W = DRIVABLE_VEHICLES[0].trackHalfW;
const MMSEV_POD_DROP_OFFSET_Y = 0.055;

/**
 * Computes a world-space spawn position beside a walker at `(x, z)` facing `yaw`
 * (`yaw = 0` looks along `-Z`, matching Three.js camera & `hud3d.js`).
 */
export function computeSpawnBesideOffset(x, z, yaw = 0, rightM = 3.8, fwdM = 2.8) {
  const sinY = Math.sin(yaw);
  const cosY = Math.cos(yaw);
  return {
    x: x + cosY * rightM - sinY * fwdM,
    z: z - sinY * rightM - cosY * fwdM,
  };
}

/**
 * Computes automated 4-speed EV traction gearbox readout (`gear` 1..4 & normalized motor `rpmNorm`).
 */
export function computeVehicleGearTelemetry(speedAbs, maxTopSpeed) {
  const top = Math.max(8, maxTopSpeed || 18.5);
  const ratio = Math.max(0, Math.min(1.35, speedAbs / top));
  if (ratio < 0.22) return { gear: 1, rpmNorm: Math.min(1, ratio / 0.24) };
  if (ratio < 0.48) return { gear: 2, rpmNorm: Math.min(1, (ratio - 0.14) / 0.36) };
  if (ratio < 0.78) return { gear: 3, rpmNorm: Math.min(1, (ratio - 0.38) / 0.42) };
  return { gear: 4, rpmNorm: Math.min(1, 0.32 + (ratio - 0.65) * 0.95) };
}

/**
 * Pure 2D + Attitude Advanced Off-Road Mars Rover Physics Step.
 * Combines 4-speed electric torque curve, slope-gradient gravity, Ackermann cornering,
 * `Space` handbrake drift / loose regolith lateral slip, and mid-air attitude control.
 */
export function stepAdvancedRoverPhysics(
  state,
  {
    vehicleType = "mmsev",
    throttle = 0,
    steer = 0,
    boost = false,
    handbrake = false,
    speedMultiplier = 1.0,
    slopePitch = 0,
    slopeRoll = 0,
    airborne = false,
    realisticPhysics = true,
    dt = 0.016,
  } = {}
) {
  const spec = getDrivableVehicleSpec(vehicleType);
  const safeDt = Math.max(0.001, Math.min(0.05, dt));
  const mult = Math.max(0.25, Math.min(5.0, Number(speedMultiplier) || 1));

  const yaw0 = Number(state.yaw) || 0;
  const fx0 = -Math.sin(yaw0);
  const fz0 = -Math.cos(yaw0);
  const rx0 = Math.cos(yaw0);
  const rz0 = -Math.sin(yaw0);

  let vx = Number(state.velX) || 0;
  let vz = Number(state.velZ) || 0;
  let vFwd = vx * fx0 + vz * fz0;
  let vLat = vx * rx0 + vz * rz0;

  const topFwd = (boost ? spec.boostSpeedMs : spec.topSpeedMs) * mult;
  const topRev = spec.reverseSpeedMs * mult;
  const availPowerW = ((boost ? spec.boostPowerW : spec.powerW) || 24500) * mult;
  const maxTorqueNm = (spec.wheelTorqueMaxNm || 2639.25) * mult;
  const wheelRadiusM = Math.max(0.2, spec.wheelRadius || 0.345);
  const massKg = Math.max(400, spec.massKg || 1850);

  if (!airborne) {
    // 1. Electric motor torque curve (wheel torque & kW power cap integrated into longitudinal dynamics)
    const speedFrac = Math.min(1, Math.abs(vFwd) / Math.max(1, topFwd));
    const wheelOmegaPre = Math.max(0.8, Math.abs(vFwd) / wheelRadiusM);
    const torqueAvailPre = Math.min(maxTorqueNm, availPowerW / wheelOmegaPre);
    const tractiveForceN = torqueAvailPre / wheelRadiusM;
    const torqueFactor = Math.max(1, tractiveForceN / (massKg * 2.2));
    const lowEndBoost = (1 + (1 - speedFrac) * 0.45 * (spec.slopeTorque || 1)) * Math.min(1.65, Math.sqrt(torqueFactor));
    const reversingInput = throttle !== 0 && throttle * vFwd < -0.6;

    let targetVel = 0;
    if (handbrake && throttle >= 0) {
      targetVel = vFwd * 0.72; // Hold/bleed momentum during handbrake slide
    } else if (throttle > 0) {
      targetVel = topFwd;
    } else if (throttle < 0) {
      targetVel = -topRev;
    }

    const rate = handbrake
      ? 2.2
      : reversingInput
        ? spec.brakeGain
        : throttle !== 0
          ? spec.accelGain * (boost ? 1.32 : 1.0) * lowEndBoost
          : 4.2;

    let nextVFwd = vFwd + (targetVel - vFwd) * Math.min(1, safeDt * rate);
    if (throttle === 0 && !handbrake && Math.abs(nextVFwd) < 0.18) nextVFwd = 0;

    if (realisticPhysics) {
      // Slope longitudinal gravity load + lateral side-camber slide, countered by wheel torque reserve
      const climbAssist =
        throttle !== 0
          ? Math.min(0.65, (spec.slopeTorque - 1) * 0.35 + (maxTorqueNm / (massKg * MARS_GRAVITY_MS2 * wheelRadiusM)) * 0.08)
          : 0;
      nextVFwd -= MARS_GRAVITY_MS2 * Math.sin(slopePitch) * (1.12 - climbAssist) * safeDt;
      vLat += MARS_GRAVITY_MS2 * Math.sin(slopeRoll) * 0.75 * safeDt;
    }

    // 2. Steering yaw authority + drifting oversteer yaw kick
    const absFwd = Math.abs(nextVFwd);
    const speedAuth = Math.min(1, absFwd / 2.8) * 0.8 + 0.2;
    const turnDir = absFwd > 0.3 ? Math.sign(nextVFwd) : 0.48;
    const handbrakeYawGain = handbrake && absFwd > 4.2 ? 1.48 : 1.0;
    const targetYawRate = steer * turnDir * spec.steerRate * speedAuth * handbrakeYawGain;
    state.yawRate = (state.yawRate || 0) + (targetYawRate - (state.yawRate || 0)) * Math.min(1, safeDt * 12);
    const deltaYaw = state.yawRate * safeDt;
    state.yaw = yaw0 + deltaYaw;

    // 3. Reproject velocity onto new chassis heading & apply Martian tire cornering grip vs handbrake drift
    const yaw1 = state.yaw;
    const fx1 = -Math.sin(yaw1);
    const fz1 = -Math.cos(yaw1);
    const rx1 = Math.cos(yaw1);
    const rz1 = -Math.sin(yaw1);

    const curVx = fx0 * nextVFwd + rx0 * vLat;
    const curVz = fz0 * nextVFwd + rz0 * vLat;
    const projFwd = curVx * fx1 + curVz * fz1;
    const projLat = curVx * rx1 + curVz * rz1;

    const highSpeedSharpWhip = Math.abs(steer) > 0.55 && Math.abs(projFwd) > topFwd * 0.48;
    const isDrifting = (handbrake || highSpeedSharpWhip) && Math.hypot(projFwd, projLat) > 4.5;
    const grip = isDrifting ? spec.driftGrip : handbrake ? spec.driftGrip * 1.2 : spec.gripBase;
    const dampedLat = projLat * Math.exp(-safeDt * grip);

    vx = fx1 * projFwd + rx1 * dampedLat;
    vz = fz1 * projFwd + rz1 * dampedLat;
    vFwd = projFwd;
    vLat = dampedLat;

    // Preserve angular pitch/roll momentum gently when launching off ground later
    state.airPitchVel = ((slopePitch - (state.lastSlopePitch ?? slopePitch)) / safeDt) * 0.35;
    state.airRollVel = (state.yawRate * Math.min(1, absFwd / 12)) * 0.22;
    state.lastSlopePitch = slopePitch;
    state.drifting = isDrifting || (Math.abs(vLat) > 2.4 && Math.abs(projFwd) > 4.0);
  } else {
    // Mid-air attitude trim (reaction wheel torque: A/D yaw + slight W/S pitch level + ballistic aero drag)
    const airYaw = steer * 0.62 * safeDt;
    state.yaw = yaw0 + airYaw;
    const drag = Math.exp(-safeDt * 0.05);
    vx *= drag;
    vz *= drag;

    const yaw1 = state.yaw;
    vFwd = vx * -Math.sin(yaw1) + vz * -Math.cos(yaw1);
    vLat = vx * Math.cos(yaw1) - vz * Math.sin(yaw1);
    state.airPitchVel = ((state.airPitchVel || 0) - throttle * 1.25 * safeDt) * Math.exp(-safeDt * 1.8);
    state.airRollVel = ((state.airRollVel || 0) - steer * 0.9 * safeDt) * Math.exp(-safeDt * 2.2);
    state.drifting = false;
  }

  state.velX = vx;
  state.velZ = vz;
  state.forwardSpeed = vFwd;
  state.lateralSpeed = vLat;

  const totalHoriz = Math.hypot(vx, vz);
  const slipRatio = totalHoriz > 0.8 ? Math.min(1, Math.abs(vLat) / totalHoriz + (handbrake ? 0.35 : 0)) : 0;
  state.slipRatio = slipRatio;

  const { gear, rpmNorm } = computeVehicleGearTelemetry(Math.abs(vFwd), topFwd);
  state.gear = gear;
  state.rpmNorm = rpmNorm;

  const speedAbs = Math.abs(vFwd);
  const wheelOmega = Math.max(0.8, speedAbs / wheelRadiusM);
  const torqueAvail = Math.min(maxTorqueNm, availPowerW / wheelOmega);
  const wheelTorqueNm = airborne ? 0 : throttle * torqueAvail;
  const motorTorqueNm = wheelTorqueNm / ((spec.gearRatio || 18) * 0.88);
  const mechPowerW = Math.abs(wheelTorqueNm * wheelOmega);
  const mechPowerKw = mechPowerW / 1000;
  const maxPowerKw = availPowerW / 1000;
  const hp = mechPowerW / 745.699872;
  const maxHp = availPowerW / 745.699872;
  const weightN = massKg * MARS_GRAVITY_MS2;
  state.wheelTorqueNm = wheelTorqueNm;
  state.motorTorqueNm = motorTorqueNm;
  state.mechPowerW = mechPowerW;
  state.mechPowerKw = mechPowerKw;
  state.maxPowerKw = maxPowerKw;
  state.hp = hp;
  state.maxHp = maxHp;
  state.weightN = weightN;

  return {
    spec,
    vFwd,
    vLat,
    totalHoriz,
    slipRatio,
    gear,
    rpmNorm,
    wheelTorqueNm,
    motorTorqueNm,
    mechPowerW,
    hp,
    maxHp,
    weightN,
    drifting: Boolean(state.drifting),
    braking: Boolean(handbrake || (throttle < 0 && vFwd > 0.5)),
  };
}

/**
 * Pure vertical ballistic & crest-launch stepper for Mars chassis vehicle flight.
 * Absorbs normal terrain ripples on bogie travel and launches cleanly on real fast crests
 * or abrupt maneuvers, returning crisply under Martian gravity (`ROVER_FLIGHT_G`).
 */
export function stepRoverBallisticPhysics(
  state,
  { groundY, slopeClimbVy = 0, bumpImpulseVy = 0, horizSpeed = 0, jumpBias = 1.0, dt = 0.016, marsG = ROVER_FLIGHT_G }
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
 * Exact Oriented Rounded-Box (OBB) collision push-out in world XZ + vertical roof tolerance.
 */
export function resolveRoverObbCollision(
  roverX,
  roverZ,
  roverYaw,
  roverY,
  entityX,
  entityZ,
  entityRadius = 0.42,
  entityY = null,
  halfW = ROVER_OBB_HALF_W,
  halfL = ROVER_OBB_HALF_L,
  roofHeight = ROVER_OBB_HEIGHT_M
) {
  if (entityY != null && Number.isFinite(entityY) && Number.isFinite(roverY)) {
    if (entityY > roverY + roofHeight + 0.25) {
      return { hit: false, x: entityX, z: entityZ, nx: 0, nz: 0, pen: 0 };
    }
  }

  const cosY = Math.cos(roverYaw);
  const sinY = Math.sin(roverYaw);
  const dx = entityX - roverX;
  const dz = entityZ - roverZ;
  const lx = dx * cosY - dz * sinY;
  const lz = dx * sinY + dz * cosY;

  const clampedX = Math.max(-halfW, Math.min(halfW, lx));
  const clampedZ = Math.max(-halfL, Math.min(halfL, lz));
  const ux = lx - clampedX;
  const uz = lz - clampedZ;
  const distSq = ux * ux + uz * uz;

  if (distSq >= entityRadius * entityRadius) {
    return { hit: false, x: entityX, z: entityZ, nx: 0, nz: 0, pen: 0 };
  }

  let outLx = lx;
  let outLz = lz;
  let normLx = 0;
  let normLz = 0;
  let pen = 0;
  if (distSq > 1e-8) {
    const dist = Math.sqrt(distSq);
    pen = entityRadius - dist;
    normLx = ux / dist;
    normLz = uz / dist;
    outLx = clampedX + normLx * entityRadius;
    outLz = clampedZ + normLz * entityRadius;
  } else {
    const penLeft = halfW + lx;
    const penRight = halfW - lx;
    const penFront = halfL + lz;
    const penBack = halfL - lz;
    const minFace = Math.min(penLeft, penRight, penFront, penBack);
    pen = minFace + entityRadius;
    if (minFace === penLeft) {
      normLx = -1;
      outLx = -halfW - entityRadius;
    } else if (minFace === penRight) {
      normLx = 1;
      outLx = halfW + entityRadius;
    } else if (minFace === penFront) {
      normLz = -1;
      outLz = -halfL - entityRadius;
    } else {
      normLz = 1;
      outLz = halfL + entityRadius;
    }
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

function makeSolarTexture(THREE) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#102344";
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "#3668a8";
  g.lineWidth = 2;
  for (let i = 0; i <= 128; i += 16) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 128);
    g.stroke();
  }
  g.strokeStyle = "#b89b52";
  g.lineWidth = 1.5;
  for (let j = 0; j <= 128; j += 32) {
    g.beginPath();
    g.moveTo(0, j);
    g.lineTo(128, j);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeDoorDecalTexture(THREE, badgeText = "MM-EXP 01", subText = "GALE CRATER // PRESSURIZED") {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 96;
  const g = c.getContext("2d");
  g.fillStyle = "#eceae4";
  g.fillRect(0, 0, 256, 96);
  g.fillStyle = "#d95b26";
  g.fillRect(0, 0, 256, 16);
  g.fillStyle = "#1b2432";
  g.fillRect(0, 78, 256, 18);
  g.fillStyle = "#111827";
  g.font = "bold 24px ui-monospace, SFMono-Regular, Menlo, monospace";
  g.fillText(badgeText, 16, 46);
  g.font = "600 13px ui-monospace, SFMono-Regular, Menlo, monospace";
  g.fillStyle = "#475569";
  g.fillText(subText, 16, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeMarsSpringTireTexture(THREE) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");

  g.fillStyle = "#15171b";
  g.fillRect(0, 0, 256, 256);

  g.strokeStyle = "rgba(182, 174, 158, 0.56)";
  g.lineWidth = 2;
  for (let i = -256; i < 512; i += 14) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 128, 256);
    g.stroke();
    g.beginPath();
    g.moveTo(i + 128, 0);
    g.lineTo(i, 256);
    g.stroke();
  }

  for (let y = 0; y < 256; y += 22) {
    g.fillStyle = "#2b2f36";
    g.beginPath();
    g.moveTo(14, y);
    g.lineTo(128, y + 10);
    g.lineTo(242, y);
    g.lineTo(242, y + 7);
    g.lineTo(128, y + 17);
    g.lineTo(14, y + 7);
    g.closePath();
    g.fill();

    g.fillStyle = "rgba(156, 86, 52, 0.42)";
    g.fillRect(24, y + 14, 208, 4);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 3);
  return tex;
}

function stripStaticWheelTriangles(THREE, model) {
  model.updateMatrixWorld(true);
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();

  model.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
    const srcGeom = obj.geometry;
    const pos = srcGeom.attributes.position;
    const mat = obj.matrixWorld;
    const index = srcGeom.index;

    const isWheelTri = (ia, ib, ic) => {
      v0.fromBufferAttribute(pos, ia).applyMatrix4(mat);
      v1.fromBufferAttribute(pos, ib).applyMatrix4(mat);
      v2.fromBufferAttribute(pos, ic).applyMatrix4(mat);
      const cx = (v0.x + v1.x + v2.x) / 3;
      const cy = (v0.y + v1.y + v2.y) / 3;
      return Math.abs(cx) > 1.065 && cy < 0.618;
    };

    if (index) {
      const srcArr = index.array;
      const kept = [];
      for (let i = 0; i < srcArr.length; i += 3) {
        if (!isWheelTri(srcArr[i], srcArr[i + 1], srcArr[i + 2])) {
          kept.push(srcArr[i], srcArr[i + 1], srcArr[i + 2]);
        }
      }
      if (kept.length < srcArr.length) {
        const TypedArr = srcArr.constructor === Uint32Array ? Uint32Array : Uint16Array;
        srcGeom.setIndex(new THREE.BufferAttribute(new TypedArr(kept), 1));
      }
    }
  });
}

function buildArticulatedDualWheelPods(THREE, axleLayout, trackHalfW, radius, podCenterY, dual = true, rimAccent = 0xb98a4a) {
  const wheelGroup = new THREE.Group();
  const tireTex = makeMarsSpringTireTexture(THREE);

  const tireMat = new THREE.MeshStandardMaterial({
    map: tireTex,
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0.34,
  });
  const sidewallMat = new THREE.MeshStandardMaterial({
    color: 0x20242b,
    roughness: 0.68,
    metalness: 0.42,
  });
  const beadlockMat = new THREE.MeshStandardMaterial({
    color: 0x6f7782,
    roughness: 0.36,
    metalness: 0.8,
  });
  const bronzeHubMat = new THREE.MeshStandardMaterial({
    color: rimAccent,
    roughness: 0.34,
    metalness: 0.78,
  });
  const strutDarkMat = new THREE.MeshStandardMaterial({
    color: 0x2c3038,
    roughness: 0.55,
    metalness: 0.7,
  });

  const tireW = dual ? 0.175 : 0.34;
  const dualOffsets = dual ? [-0.145, 0.145] : [0];
  const tireGeom = new THREE.CylinderGeometry(radius, radius, tireW, 24, 1, false);
  tireGeom.rotateZ(Math.PI / 2);

  const rimGeom = new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, tireW + 0.012, 16);
  rimGeom.rotateZ(Math.PI / 2);

  const hubGeom = new THREE.CylinderGeometry(radius * 0.28, radius * 0.31, tireW + 0.03, 12);
  hubGeom.rotateZ(Math.PI / 2);

  const cleatGeom = new THREE.BoxGeometry(tireW * 0.94, 0.026, 0.062);
  const axleShaftGeom = new THREE.CylinderGeometry(0.068, 0.068, dual ? 0.37 : 0.42, 12);
  axleShaftGeom.rotateZ(Math.PI / 2);
  const yokeCollarGeom = new THREE.CylinderGeometry(0.085, 0.085, 0.28, 12);

  const wheels = [];
  const frontSteerKnuckles = [];
  const rearSteerKnuckles = [];
  const pods = [];

  for (const ax of axleLayout) {
    for (const side of [-1, 1]) {
      const podRoot = new THREE.Group();
      podRoot.position.set(side * trackHalfW, podCenterY, ax.z);
      wheelGroup.add(podRoot);

      const knuckle = new THREE.Group();
      podRoot.add(knuckle);

      const collar = new THREE.Mesh(yokeCollarGeom, strutDarkMat);
      collar.position.set(0, radius * 0.72, 0);
      collar.castShadow = true;
      collar.receiveShadow = true;
      knuckle.add(collar);

      const axleBar = new THREE.Mesh(axleShaftGeom, strutDarkMat);
      axleBar.castShadow = true;
      knuckle.add(axleBar);

      const spinner = new THREE.Group();
      knuckle.add(spinner);

      for (const dualOff of dualOffsets) {
        const tire = new THREE.Mesh(tireGeom, tireMat);
        tire.position.x = dualOff;
        tire.castShadow = true;
        tire.receiveShadow = true;
        spinner.add(tire);

        const rim = new THREE.Mesh(rimGeom, beadlockMat);
        rim.position.x = dualOff;
        rim.castShadow = true;
        spinner.add(rim);

        const hub = new THREE.Mesh(hubGeom, bronzeHubMat);
        hub.position.x = dualOff;
        spinner.add(hub);

        for (let c = 0; c < 10; c++) {
          const ang = (c / 10) * Math.PI * 2;
          const cleat = new THREE.Mesh(cleatGeom, sidewallMat);
          cleat.position.set(dualOff, Math.sin(ang) * (radius - 0.004), Math.cos(ang) * (radius - 0.004));
          cleat.rotation.x = ang;
          spinner.add(cleat);
        }
      }
      mergeStaticMeshes(THREE, spinner, { castShadow: true, receiveShadow: true });

      wheels.push(spinner);
      pods.push({
        podRoot,
        knuckle,
        spinner,
        lx: side * trackHalfW,
        lz: ax.z,
        baseY: podCenterY,
        role: ax.role,
        smoothPodY: 0,
      });
      if (ax.role === "front") frontSteerKnuckles.push(knuckle);
      else if (ax.role === "rear") rearSteerKnuckles.push(knuckle);
    }
  }

  return { wheelGroup, wheels, frontSteerKnuckles, rearSteerKnuckles, pods };
}

function buildProceduralMmsevVisuals(THREE) {
  const procGroup = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x262b33, roughness: 0.72, metalness: 0.65 });
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xe6e2da, roughness: 0.44, metalness: 0.08 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xd95b26, roughness: 0.48, metalness: 0.1 });
  const foilMat = new THREE.MeshStandardMaterial({ color: 0xd4a42a, roughness: 0.28, metalness: 0.88 });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0xc27b2b,
    roughness: 0.14,
    metalness: 0.62,
    emissive: 0x2a1404,
    emissiveIntensity: 0.35,
  });
  const solarMat = new THREE.MeshStandardMaterial({ map: makeSolarTexture(THREE), color: 0xffffff, roughness: 0.28, metalness: 0.35 });
  const decalMat = new THREE.MeshStandardMaterial({ map: makeDoorDecalTexture(THREE), roughness: 0.46, metalness: 0.05 });

  const addM = (parent, geom, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    if (rx || ry || rz) m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  addM(procGroup, new THREE.BoxGeometry(1.75, 0.22, 3.6), frameMat, 0, 0.56, 0);
  addM(procGroup, new THREE.BoxGeometry(1.5, 0.18, 1.45), foilMat, 0, 0.52, 0.95);
  addM(procGroup, new THREE.BoxGeometry(2.04, 1.18, 2.75), hullMat, 0, 1.24, 0.18);
  addM(procGroup, new THREE.BoxGeometry(1.94, 0.62, 1.05), hullMat, 0, 0.98, -1.42, 0.24, 0, 0);
  addM(procGroup, new THREE.BoxGeometry(2.06, 0.1, 2.82), accentMat, 0, 0.72, 0.18);
  addM(procGroup, new THREE.PlaneGeometry(1.32, 0.5), decalMat, -1.03, 1.28, -0.05, 0, -Math.PI / 2, 0);
  addM(procGroup, new THREE.PlaneGeometry(1.32, 0.5), decalMat, 1.03, 1.28, -0.05, 0, Math.PI / 2, 0);
  addM(procGroup, new THREE.BoxGeometry(1.76, 0.54, 0.28), visorMat, 0, 1.45, -1.24, -0.38, 0, 0);
  addM(procGroup, new THREE.CylinderGeometry(0.62, 0.68, 0.95, 14), foilMat, 0, 1.28, 1.62, Math.PI / 2, 0, 0);
  for (const sx of [-0.72, 0.72]) {
    addM(procGroup, new THREE.BoxGeometry(0.95, 0.05, 1.95), solarMat, sx, 1.95, 0.68, 0.05, 0, sx < 0 ? 0.1 : -0.1);
  }
  return { procGroup };
}

export function createExperimentalRover(THREE, initialVehicleType = "mmsev", { withLights = true } = {}) {
  const group = new THREE.Group();
  const bodyRoot = new THREE.Group();
  group.add(bodyRoot);

  const isConceptType = (typeId) => typeId === "nasa_concept" || typeId === "mars_robo_concept";
  let activeVehicleType = isConceptType(initialVehicleType) ? initialVehicleType : "mmsev";
  let hasRealMmsevModel = false;
  let nasaModelRoot = null;

  // MMSEV root (NASA GLB + articulated 6x6 dual pods, with procedural fallback)
  const mmsevContainer = new THREE.Group();
  bodyRoot.add(mmsevContainer);
  const mmsevFallback = buildProceduralMmsevVisuals(THREE);
  mergeStaticMeshes(THREE, mmsevFallback.procGroup, { castShadow: true, receiveShadow: true });
  mmsevContainer.add(mmsevFallback.procGroup);

  const mmsevWheels = buildArticulatedDualWheelPods(
    THREE,
    MMSEV_POD_AXLES,
    MMSEV_TRACK_HALF_W,
    ROVER_WHEEL_RADIUS_M,
    ROVER_WHEEL_RADIUS_M,
    true,
    0xb98a4a
  );
  mmsevWheels.wheelGroup.visible = true;
  mmsevContainer.add(mmsevWheels.wheelGroup);

  // NASA Mars Rover Concept root (6x6 hollow barrel wheels + stealth faceted lab body)
  const conceptSpec = getDrivableVehicleSpec("nasa_concept");
  const conceptContainer = new THREE.Group();
  bodyRoot.add(conceptContainer);
  const conceptVisuals = buildNasaConceptRoverVisuals(THREE);
  mergeStaticMeshes(THREE, conceptVisuals.procGroup, { castShadow: true, receiveShadow: true });
  conceptContainer.add(conceptVisuals.procGroup);
  const conceptWheels = buildConceptHollowWheels(
    THREE,
    conceptSpec.axles,
    conceptSpec.trackHalfW,
    conceptSpec.wheelRadius
  );
  conceptContainer.add(conceptWheels.wheelGroup);

  // Shared Headlights & Brake/Tailbar Rig
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xfff3d6,
    emissive: 0xffe4b5,
    emissiveIntensity: 2.3,
    roughness: 0.2,
  });
  const headLamps = [];
  for (const lx of [-0.58, 0.58]) {
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 12), lampMat);
    lamp.position.set(lx, 0.9, -2.02);
    lamp.rotation.x = Math.PI / 2;
    bodyRoot.add(lamp);
    headLamps.push(lamp);
  }
  let headlight;
  let highBeam = null;
  if (withLights) {
    headlight = new THREE.PointLight(0xffdfb3, 2.0, 26, 1.5);
    headlight.position.set(0, 1.15, -2.6);
    bodyRoot.add(headlight);

    highBeam = new THREE.SpotLight(0xffe7c2, 5.4, 52, 0.58, 0.65, 1.3);
    highBeam.position.set(0, 1.22, -2.18);
    highBeam.target.position.set(0, 0.1, -20);
    bodyRoot.add(highBeam);
    bodyRoot.add(highBeam.target);
  } else {
    headlight = { position: new THREE.Vector3(0, 1.15, -2.6), intensity: 0, distance: 26, decay: 1.5 };
  }

  const tailBarMat = new THREE.MeshStandardMaterial({
    color: 0xff4938,
    emissive: 0xef4444,
    emissiveIntensity: 1.4,
    roughness: 0.24,
  });
  const tailBars = [];
  for (const lx of [-0.52, 0.52]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.055, 0.045), tailBarMat);
    bar.position.set(lx, 1.05, 1.98);
    bar.castShadow = true;
    bar.receiveShadow = true;
    bodyRoot.add(bar);
    tailBars.push(bar);
  }

  let detailLodFar = false;

  // Bake each rigid piece (body shells, each wheel, each knuckle, each pod) into one mesh per
  // material. The containers and the wheel parts stay separate nodes, so switching vehicle,
  // steering, wheel spin and suspension travel work as before, at a fraction of the draw calls.
  {
    const movers = [mmsevContainer, conceptContainer, mmsevFallback.procGroup, conceptVisuals.procGroup, ...headLamps, ...tailBars];
    for (const w of [mmsevWheels, conceptWheels]) {
      movers.push(w.wheelGroup);
      for (const pod of w.pods) movers.push(pod.podRoot, pod.knuckle, pod.spinner);
    }
    mergeRigidParts(THREE, bodyRoot, movers);
  }

  function applyVehicleVisibility() {
    const isConcept = isConceptType(activeVehicleType);
    mmsevContainer.visible = !isConcept;
    mmsevFallback.procGroup.visible = !isConcept && (!hasRealMmsevModel || detailLodFar);
    if (nasaModelRoot) nasaModelRoot.visible = !isConcept && !detailLodFar;
    conceptContainer.visible = isConcept;

    const lampY = isConcept ? 1.18 : 0.9;
    const lampZ = isConcept ? -3.10 : -2.02;
    for (const lamp of headLamps) {
      lamp.position.y = lampY;
      lamp.position.z = lampZ;
    }
    headlight.position.set(0, isConcept ? 1.28 : 1.15, isConcept ? -3.45 : -2.6);
    if (highBeam) highBeam.position.set(0, isConcept ? 1.32 : 1.22, isConcept ? -3.02 : -2.18);
    const tailY = isConcept ? 1.22 : 1.05;
    const tailZ = isConcept ? 3.04 : 1.98;
    for (const bar of tailBars) {
      bar.position.y = tailY;
      bar.position.z = tailZ;
    }
  }

  function setVehicleType(nextType) {
    activeVehicleType = isConceptType(nextType) ? nextType : "mmsev";
    applyVehicleVisibility();
    return activeVehicleType;
  }

  function getActiveSpec() {
    return activeVehicleType === "mars_robo_concept"
      ? getGarageVehicleSpec("mars_robo_concept")
      : getDrivableVehicleSpec(activeVehicleType);
  }

  function getActiveRig() {
    return isConceptType(activeVehicleType) ? conceptWheels : mmsevWheels;
  }

  async function attachRealModel(gltfLoader, url = "./assets/nasa-3d/mmsev-rover.glb", { castShadow = true } = {}) {
    if (hasRealMmsevModel || !gltfLoader) return false;
    try {
      const gltf = await gltfLoader.loadAsync(url);
      const model = gltf?.scene;
      if (!model) return false;

      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      const maxSpan = Math.max(size.x, size.z, 0.01);
      const scale = 4.65 / maxSpan;
      model.position.set(-center.x * scale, -box.min.y * scale + MMSEV_POD_DROP_OFFSET_Y, -center.z * scale);
      model.scale.setScalar(scale);

      stripStaticWheelTriangles(THREE, model);

      const wrapper = new THREE.Group();
      wrapper.rotation.y = Math.PI;
      wrapper.add(model);

      wrapper.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = Boolean(castShadow);
        o.receiveShadow = true;
        if (o.material) {
          o.material.envMapIntensity = 0.85;
          if (o.material.normalMap && o.material.normalScale) {
            o.material.normalScale.set(0.8, 0.8);
          }
          o.material.needsUpdate = true;
        }
      });
      mergeStaticMeshes(THREE, wrapper, { castShadow: Boolean(castShadow), receiveShadow: true });

      mergeRigidParts(THREE, wrapper); // the NASA body has no moving parts: one mesh per material
      mmsevFallback.procGroup.visible = false;
      mmsevContainer.add(wrapper);
      nasaModelRoot = wrapper;
      hasRealMmsevModel = true;
      applyVehicleVisibility();
      return true;
    } catch (err) {
      console.warn("NASA MMSEV rover model failed, keeping procedural fallback:", err);
      return false;
    }
  }

  let wheelAngle = 0;
  let smoothPitch = 0;
  let smoothRoll = 0;
  let smoothGroundY = null;
  let prevGroundY = null;
  let suspY = 0;
  let suspVelY = 0;
  let prevSpeed = 0;
  let accelSquat = 0;
  let cornerRoll = 0;

  function placeAt(x, z, yaw = 0, sampleElevY = null) {
    const y = typeof sampleElevY === "function" ? sampleElevY(x, z) : 0;
    group.position.set(x, y, z);
    group.rotation.y = yaw;
    smoothGroundY = y;
    prevGroundY = y;
    suspY = 0;
    suspVelY = 0;
    accelSquat = 0;
    cornerRoll = 0;
    smoothPitch = 0;
    smoothRoll = 0;
    bodyRoot.position.set(0, 0, 0);
    bodyRoot.rotation.set(0, 0, 0);
    return group.position;
  }

  function spawnBeside(x, z, yaw, sampleElevY) {
    const pos = computeSpawnBesideOffset(x, z, yaw, 3.8, 2.8);
    return placeAt(pos.x, pos.z, yaw, sampleElevY);
  }

  function resolveCollision(entityX, entityZ, entityRadius = 0.42, entityY = null) {
    if (!group.visible) return { hit: false, x: entityX, z: entityZ, nx: 0, nz: 0, pen: 0 };
    const spec = getActiveSpec();
    return resolveRoverObbCollision(
      group.position.x,
      group.position.z,
      group.rotation.y,
      group.position.y,
      entityX,
      entityZ,
      entityRadius,
      entityY,
      spec.halfW,
      spec.halfL,
      spec.heightM
    );
  }

  function sampleSupportGroundY(sampleElevY, x = group.position.x, z = group.position.z, yaw = group.rotation.y) {
    if (!sampleElevY) return 0;
    const spec = getActiveSpec();
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    const halfW = spec.trackHalfW;
    const frontZ = spec.axles[0].z;
    const midZ = spec.axles[1].z;
    const rearZ = spec.axles[2].z;
    const pt = (lx, lz) => sampleElevY(x + cosY * lx + sinY * lz, z - sinY * lx + cosY * lz);
    const hFL = pt(-halfW, frontZ);
    const hFR = pt(halfW, frontZ);
    const hML = pt(-halfW, midZ);
    const hMR = pt(halfW, midZ);
    const hRL = pt(-halfW, rearZ);
    const hRR = pt(halfW, rearZ);
    const hC = sampleElevY(x, z);
    const wheelAvg = (hFL + hFR + hML + hMR + hRL + hRR) / 6;
    const peakH = Math.max(hC, hFL, hFR, hML, hMR, hRL, hRR);
    return Math.max(wheelAvg + 0.04, peakH - 0.04);
  }

  function update(
    dt,
    {
      sampleElevY,
      speed = 0,
      steer = 0,
      driving = false,
      physicsEnabled = true,
      airborne = false,
      worldY = null,
      velY = 0,
      lateralSpeed = 0,
      landingImpact = 0,
      braking = false,
      handbrake = false,
      drifting = false,
      airPitchOffset = 0,
      airRollOffset = 0,
    } = {}
  ) {
    if (!group.visible || !sampleElevY) return;

    const spec = getActiveSpec();
    const rig = getActiveRig();
    const px = group.position.x;
    const pz = group.position.z;
    const yaw = group.rotation.y;
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);

    const halfW = spec.trackHalfW;
    const frontZ = spec.axles[0].z;
    const midZ = spec.axles[1].z;
    const rearZ = spec.axles[2].z;
    const samplePt = (lx, lz) => sampleElevY(px + cosY * lx + sinY * lz, pz - sinY * lx + cosY * lz);
    const hFL = samplePt(-halfW, frontZ);
    const hFR = samplePt(halfW, frontZ);
    const hML = samplePt(-halfW, midZ);
    const hMR = samplePt(halfW, midZ);
    const hRL = samplePt(-halfW, rearZ);
    const hRR = samplePt(halfW, rearZ);
    const hC = sampleElevY(px, pz);
    const wheelAvg = (hFL + hFR + hML + hMR + hRL + hRR) / 6;
    const peakH = Math.max(hC, hFL, hFR, hML, hMR, hRL, hRR);
    const groundTargetY = Math.max(wheelAvg + 0.04, peakH - 0.04);
    const targetY = airborne && Number.isFinite(worldY) ? worldY : groundTargetY;

    if (smoothGroundY == null || !Number.isFinite(smoothGroundY)) {
      smoothGroundY = targetY;
      prevGroundY = targetY;
    }

    if (landingImpact > 0.3) {
      suspVelY -= Math.min(4.8, landingImpact * 1.45);
      accelSquat = Math.min(0.14, accelSquat + landingImpact * 0.028);
    }

    // Brighter brake-lights when handbraking / decelerating
    tailBarMat.emissiveIntensity = braking ? 3.8 : driving ? 1.7 : 0.7;

    if (physicsEnabled && dt > 0) {
      if (airborne) {
        smoothGroundY = targetY;
        prevGroundY = groundTargetY;
        const accelForce = -22.0 * (suspY - 0.06) - 6.0 * suspVelY;
        suspVelY += accelForce * dt;
        suspY = Math.max(-0.045, Math.min(0.24, suspY + suspVelY * dt));
        accelSquat *= Math.exp(-dt * 4);
        cornerRoll += (Math.max(-0.22, Math.min(0.22, -lateralSpeed * 0.025 + steer * 0.16)) - cornerRoll) * Math.min(1, dt * 6);
        prevSpeed = speed;
      } else {
        const dGround = groundTargetY - (prevGroundY ?? groundTargetY);
        prevGroundY = groundTargetY;
        if (Math.abs(dGround) < 0.85) {
          suspVelY -= dGround * 4.1;
        }
        const accelForce = -spec.suspStiff * suspY - spec.suspDamp * suspVelY;
        suspVelY += accelForce * dt;
        suspY = Math.max(-0.055, Math.min(0.22, suspY + suspVelY * dt));
        const riseAlpha = groundTargetY > smoothGroundY ? Math.min(1, dt * 28) : Math.min(1, dt * 16);
        smoothGroundY += (groundTargetY - smoothGroundY) * riseAlpha;

        const dv = (speed - prevSpeed) / Math.max(0.008, dt);
        prevSpeed = speed;
        const targetSquat = Math.max(-0.12, Math.min(0.12, dv * 0.0048));
        const driftRollBoost = drifting ? 1.45 : 1.0;
        const targetRollDyn = Math.max(
          -0.16,
          Math.min(0.16, (steer * speed * 0.0088 - lateralSpeed * 0.028) * driftRollBoost)
        );
        accelSquat += (targetSquat - accelSquat) * Math.min(1, dt * 9);
        cornerRoll += (targetRollDyn - cornerRoll) * Math.min(1, dt * 9);
      }
    } else {
      prevSpeed = speed;
      suspY = 0;
      suspVelY = 0;
      accelSquat = 0;
      cornerRoll = 0;
      smoothGroundY = airborne && Number.isFinite(worldY) ? worldY : smoothGroundY + (groundTargetY - smoothGroundY) * Math.min(1, dt * 16);
    }

    group.position.y = smoothGroundY;
    bodyRoot.position.y = suspY;

    const wheelBaseZ = rearZ - frontZ;
    const terrainPitch = Math.atan2((hFL + hFR) * 0.5 - (hRL + hRR) * 0.5, wheelBaseZ);
    const flightPitch = Math.max(-0.44, Math.min(0.46, Math.atan2(velY, Math.max(2.5, Math.abs(speed))) + airPitchOffset));
    const targetPitch = airborne ? flightPitch : terrainPitch + accelSquat;
    const targetRoll =
      (airborne ? airRollOffset : Math.atan2((hFR + hMR + hRR) / 3 - (hFL + hML + hRL) / 3, halfW * 2)) + cornerRoll;
    const kTilt = Math.min(1, dt * (airborne ? 7.2 : 11.2));
    smoothPitch += (targetPitch - smoothPitch) * kTilt;
    smoothRoll += (targetRoll - smoothRoll) * kTilt;
    bodyRoot.rotation.x = smoothPitch;
    bodyRoot.rotation.z = smoothRoll;

    const wheelR = spec.wheelRadius;
    const wheelSpinSpeed = (handbrake || braking) && Math.abs(speed) > 1.5 ? speed * 0.25 : speed * (drifting ? 1.25 : 1.0);
    wheelAngle -= (wheelSpinSpeed * dt) / wheelR;
    for (const w of rig.wheels) w.rotation.x = wheelAngle;

    const steerRad = Math.max(-0.48, Math.min(0.48, steer * 0.42));
    for (const kn of rig.frontSteerKnuckles) kn.rotation.y = steerRad;
    for (const kn of rig.rearSteerKnuckles) kn.rotation.y = -steerRad * 0.68;

    // 6-wheel independent suspension pod grounding for NASA MMSEV
    let chassisLiftNeeded = 0;
    const podContacts = [];
    for (const pod of rig.pods) {
      const hPodMax = Math.max(
        samplePt(pod.lx, pod.lz),
        samplePt(pod.lx, pod.lz - 0.26),
        samplePt(pod.lx, pod.lz + 0.26)
      );
      const planeY = smoothGroundY + suspY - pod.lz * Math.sin(smoothPitch) + pod.lx * Math.sin(smoothRoll);
      const minAntiSinkDiff = hPodMax + 0.022 - planeY;
      const desiredDiff = Math.max(-0.14, minAntiSinkDiff);
      if (!airborne && desiredDiff > 0.24) {
        chassisLiftNeeded = Math.max(chassisLiftNeeded, desiredDiff - 0.24);
      }
      podContacts.push({ pod, hPodMax });
    }
    if (!airborne && chassisLiftNeeded > 0) {
      smoothGroundY += chassisLiftNeeded;
      group.position.y = smoothGroundY;
    }
    for (const { pod, hPodMax } of podContacts) {
      const planeY = smoothGroundY + suspY - pod.lz * Math.sin(smoothPitch) + pod.lx * Math.sin(smoothRoll);
      const minAntiSinkDiff = hPodMax + 0.022 - planeY;
      const targetPodDiff = airborne ? Math.max(-0.14, minAntiSinkDiff) : Math.max(-0.13, minAntiSinkDiff);
      const clampedDiff = Math.min(0.44, targetPodDiff);
      const nextSmooth = (pod.smoothPodY || 0) + (clampedDiff - (pod.smoothPodY || 0)) * Math.min(1, dt * 22);
      pod.smoothPodY = airborne ? nextSmooth : Math.max(Math.min(0.44, minAntiSinkDiff), nextSmooth);
      pod.podRoot.position.y = pod.baseY + pod.smoothPodY;
    }
  }

  function getWheelDustEmitPoint(sideSign) {
    const spec = getActiveSpec();
    const yaw = group.rotation.y;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const zBack = spec.axles[2].z;
    const xSide = spec.trackHalfW * sideSign;
    return {
      x: group.position.x + rx * xSide - fx * zBack,
      z: group.position.z + rz * xSide - fz * zBack,
    };
  }

  applyVehicleVisibility();

  return {
    group,
    bodyRoot,
    headlight,
    get radius() {
      return Math.max(getActiveSpec().halfW, getActiveSpec().halfL);
    },
    get vehicleType() {
      return activeVehicleType;
    },
    get hasRealModel() {
      return activeVehicleType === "mmsev" ? hasRealMmsevModel : true;
    },
    get nasaModelRoot() {
      return nasaModelRoot;
    },
    setDetailLod(near = true) {
      const wantFar = !near;
      if (detailLodFar === wantFar) return;
      detailLodFar = wantFar;
      applyVehicleVisibility();
    },
    setVehicleType,
    getActiveSpec,
    getActiveRig,
    attachRealModel,
    placeAt,
    spawnBeside,
    resolveCollision,
    getWheelDustEmitPoint,
    sampleSupportGroundY,
    update,
  };
}
