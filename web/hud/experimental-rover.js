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

import { mergeStaticMeshes } from "./merge-static.js";

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
    accelGain: 8.6,
    brakeGain: 15.5,
    steerRate: 1.78,
    gripBase: 13.5,
    driftGrip: 4.6,
    massKg: 1850,
    suspStiff: 40.0,
    suspDamp: 7.6,
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
    accelGain: 9.8,
    brakeGain: 16.5,
    steerRate: 1.9,
    gripBase: 14.5,
    driftGrip: 5.0,
    massKg: 2250,
    suspStiff: 44.0,
    suspDamp: 8.2,
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

  if (!airborne) {
    // 1. Electric motor torque curve (extra low-end torque in Gear 1 + steep climb support)
    const speedFrac = Math.min(1, Math.abs(vFwd) / Math.max(1, topFwd));
    const lowEndBoost = 1 + (1 - speedFrac) * 0.45 * (spec.slopeTorque || 1);
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
      // Slope longitudinal gravity load + lateral side-camber slide
      const climbAssist = throttle !== 0 ? Math.min(0.45, (spec.slopeTorque - 1) * 0.35) : 0;
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

  return {
    spec,
    vFwd,
    vLat,
    totalHoriz,
    slipRatio,
    gear,
    rpmNorm,
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

function makeConceptHexTireTexture(THREE) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const g = c.getContext("2d");

  g.fillStyle = "#14161a";
  g.fillRect(0, 0, 512, 512);

  // Diagonal tread block ribs
  g.fillStyle = "#1d2026";
  for (let y = 0; y < 512; y += 32) {
    g.fillRect(0, y, 512, 26);
    g.fillStyle = "#0a0b0e";
    g.fillRect(0, y + 26, 512, 6);
    g.fillStyle = "#1d2026";
  }

  // Central dual honeycomb hex tread pattern (matches NASA Mars Rover Concept tires)
  const hexR = 11;
  g.strokeStyle = "#3a404a";
  g.lineWidth = 2;
  for (let row = 0; row < 28; row++) {
    const cy = row * 19 + ((row & 1) * 9);
    for (const bandCx of [185, 220, 256, 292, 327]) {
      const cx = bandCx + ((row & 1) ? 10 : -10);
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const px = cx + Math.cos(a) * hexR;
        const py = cy + Math.sin(a) * (hexR * 0.85);
        if (k === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fillStyle = "#22262e";
      g.fill();
      g.stroke();
    }
  }

  // Silver shoulder chevrons along outer/inner edges
  g.fillStyle = "#c8ced6";
  for (let y = 10; y < 512; y += 32) {
    for (const sx of [26, 486]) {
      g.beginPath();
      g.moveTo(sx - 9, y);
      g.lineTo(sx + 9, y + 6);
      g.lineTo(sx - 9, y + 12);
      g.closePath();
      g.fill();
    }
  }

  // Light Mars dust accumulation in recessed grooves
  g.fillStyle = "rgba(156, 88, 56, 0.24)";
  for (let y = 26; y < 512; y += 32) {
    g.fillRect(14, y, 484, 5);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 2);
  return tex;
}

function makeConceptNasaBadgeTexture(THREE) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");

  g.fillStyle = "#171a20";
  g.fillRect(0, 0, 256, 256);

  // Dark metallic circle + NASA meatball
  g.fillStyle = "#0b3d91";
  g.beginPath();
  g.arc(128, 128, 92, 0, Math.PI * 2);
  g.fill();

  g.strokeStyle = "#cbd5e1";
  g.lineWidth = 6;
  g.beginPath();
  g.arc(128, 128, 94, 0, Math.PI * 2);
  g.stroke();

  // White orbit swoosh
  g.strokeStyle = "#f8fafc";
  g.lineWidth = 5;
  g.beginPath();
  g.ellipse(128, 128, 108, 34, -0.35, 0, Math.PI * 2);
  g.stroke();

  // Red vector chevron
  g.strokeStyle = "#fc3d21";
  g.lineWidth = 10;
  g.beginPath();
  g.moveTo(58, 174);
  g.lineTo(132, 62);
  g.lineTo(192, 162);
  g.stroke();

  g.fillStyle = "#ffffff";
  g.font = "bold 46px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("NASA", 128, 132);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeConceptCabSideTexture(THREE) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d");

  // Brushed gunmetal-silver cab flank
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#b4bbc4");
  grad.addColorStop(0.55, "#8b939e");
  grad.addColorStop(1, "#2a2e35");
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 256);

  // Panel seams
  g.strokeStyle = "#20242a";
  g.lineWidth = 4;
  g.strokeRect(8, 8, 496, 240);
  g.beginPath();
  g.moveTo(310, 12);
  g.lineTo(310, 244);
  g.stroke();

  // Monochrome US Flag plate (matches Parker Bros / NASA Concept Rover photo)
  const fx = 115;
  const fy = 68;
  const fw = 128;
  const fh = 76;
  g.fillStyle = "#f1f5f9";
  g.fillRect(fx, fy, fw, fh);
  g.fillStyle = "#475569";
  for (let s = 0; s < 13; s += 2) {
    g.fillRect(fx, fy + s * (fh / 13), fw, fh / 13);
  }
  g.fillStyle = "#334155";
  g.fillRect(fx, fy, fw * 0.44, fh * 0.54);
  g.fillStyle = "#ffffff";
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 5; sx++) {
      g.fillRect(fx + 5 + sx * 10, fy + 5 + sy * 9, 3, 3);
    }
  }
  g.strokeStyle = "#1e293b";
  g.lineWidth = 3;
  g.strokeRect(fx, fy, fw, fh);

  // 2x3 six-cell silver-framed intake louver box on rear cab flank
  const vx = 332;
  const vy = 72;
  const vw = 152;
  const vh = 88;
  g.fillStyle = "#111317";
  g.fillRect(vx, vy, vw, vh);
  g.strokeStyle = "#e2e8f0";
  g.lineWidth = 4;
  g.strokeRect(vx, vy, vw, vh);
  const cellW = vw / 3;
  const cellH = vh / 2;
  for (let c0 = 0; c0 < 3; c0++) {
    for (let r0 = 0; r0 < 2; r0++) {
      g.strokeRect(vx + c0 * cellW + 3, vy + r0 * cellH + 3, cellW - 6, cellH - 6);
      g.fillStyle = "#090b0f";
      g.fillRect(vx + c0 * cellW + 6, vy + r0 * cellH + 6, cellW - 12, cellH - 12);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeConceptLabSideTexture(THREE) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d");

  g.fillStyle = "#3d424b";
  g.fillRect(0, 0, 512, 256);

  // Upper metallic fairing strip
  g.fillStyle = "#8a929e";
  g.fillRect(0, 0, 512, 92);

  // Framed honeycomb hex ventilation grille
  const gx = 32;
  const gy = 18;
  const gw = 176;
  const gh = 86;
  g.fillStyle = "#171a20";
  g.fillRect(gx, gy, gw, gh);
  g.strokeStyle = "#d1d5db";
  g.lineWidth = 5;
  g.strokeRect(gx, gy, gw, gh);
  g.fillStyle = "#07090c";
  for (let hy = gy + 12; hy < gy + gh - 8; hy += 14) {
    for (let hx = gx + 12; hx < gx + gw - 8; hx += 16) {
      g.beginPath();
      g.arc(hx + ((hy / 14) & 1) * 7, hy, 5, 0, Math.PI * 2);
      g.fill();
    }
  }

  // NASA Meatball medallion in center
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(278, 128, 46, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#1e293b";
  g.lineWidth = 4;
  g.stroke();
  g.fillStyle = "#0b3d91";
  g.beginPath();
  g.arc(278, 128, 38, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffffff";
  g.font = "bold 20px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("NASA", 278, 128);

  // 3-slot side utility rail detail
  g.fillStyle = "#cbd5e1";
  g.fillRect(344, 152, 148, 36);
  g.fillStyle = "#111827";
  g.fillRect(352, 164, 38, 12);
  g.fillRect(399, 164, 38, 12);
  g.fillRect(446, 164, 38, 12);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeConceptSolarTexture(THREE) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#0e1c36";
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "#64748b";
  g.lineWidth = 3;
  for (let x = 0; x <= 256; x += 32) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 256);
    g.stroke();
  }
  for (let y = 0; y <= 256; y += 32) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildConceptHollowWheels(THREE, axleLayout, trackHalfW, radius) {
  const wheelGroup = new THREE.Group();
  const tireTex = makeConceptHexTireTexture(THREE);

  const tireMat = new THREE.MeshStandardMaterial({
    map: tireTex,
    color: 0xffffff,
    roughness: 0.82,
    metalness: 0.24,
    side: THREE.DoubleSide,
  });
  const innerDrumMat = new THREE.MeshStandardMaterial({
    color: 0x181b21,
    roughness: 0.65,
    metalness: 0.55,
    side: THREE.DoubleSide,
  });
  const slatMat = new THREE.MeshStandardMaterial({
    color: 0x262b33,
    roughness: 0.52,
    metalness: 0.68,
  });
  const silverRimMat = new THREE.MeshStandardMaterial({
    color: 0xd0d6de,
    roughness: 0.28,
    metalness: 0.88,
  });
  const strutDarkMat = new THREE.MeshStandardMaterial({
    color: 0x20242c,
    roughness: 0.52,
    metalness: 0.72,
  });
  const shockBlueMat = new THREE.MeshStandardMaterial({
    color: 0x2563eb,
    roughness: 0.34,
    metalness: 0.6,
  });

  const tireW = 0.58;
  // Open-ended outer barrel so you look straight through the wheel center
  const outerBarrelGeom = new THREE.CylinderGeometry(radius, radius, tireW, 28, 1, true);
  outerBarrelGeom.rotateZ(Math.PI / 2);

  const innerBarrelGeom = new THREE.CylinderGeometry(radius * 0.72, radius * 0.72, tireW * 0.94, 24, 1, true);
  innerBarrelGeom.rotateZ(Math.PI / 2);

  const rimRingGeom = new THREE.TorusGeometry(radius * 0.75, 0.036, 10, 28);
  rimRingGeom.rotateY(Math.PI / 2);

  const slatGeom = new THREE.BoxGeometry(tireW * 0.9, radius * 0.24, 0.045);
  const lugGeom = new THREE.BoxGeometry(0.03, 0.036, 0.042);
  const swingArmGeom = new THREE.BoxGeometry(0.11, 0.14, 0.68);
  const shockGeom = new THREE.CylinderGeometry(0.048, 0.048, 0.52, 10);

  const wheels = [];
  const frontSteerKnuckles = [];
  const rearSteerKnuckles = [];
  const pods = [];

  for (const ax of axleLayout) {
    for (const side of [-1, 1]) {
      const podRoot = new THREE.Group();
      podRoot.position.set(side * trackHalfW, radius, ax.z);
      wheelGroup.add(podRoot);

      const knuckle = new THREE.Group();
      podRoot.add(knuckle);

      // Inner chassis swing-arm & anodized blue shock (keeps wheel center open/hollow)
      const arm = new THREE.Mesh(swingArmGeom, strutDarkMat);
      arm.position.set(-side * 0.42, 0.12, ax.role === "rear" ? -0.18 : 0.18);
      arm.rotation.z = side * -0.18;
      arm.castShadow = true;
      knuckle.add(arm);

      const shock = new THREE.Mesh(shockGeom, shockBlueMat);
      shock.position.set(-side * 0.36, 0.34, 0);
      shock.rotation.z = side * 0.26;
      shock.castShadow = true;
      knuckle.add(shock);

      const spinner = new THREE.Group();
      knuckle.add(spinner);

      const outerBarrel = new THREE.Mesh(outerBarrelGeom, tireMat);
      outerBarrel.castShadow = true;
      outerBarrel.receiveShadow = true;
      spinner.add(outerBarrel);

      const innerBarrel = new THREE.Mesh(innerBarrelGeom, innerDrumMat);
      innerBarrel.castShadow = true;
      innerBarrel.receiveShadow = true;
      spinner.add(innerBarrel);

      // Notched brushed-silver beadlock rings on outer & inner faces of the hollow drum
      for (const faceSign of [-1, 1]) {
        const ring = new THREE.Mesh(rimRingGeom, silverRimMat);
        ring.position.x = faceSign * (tireW * 0.47);
        ring.castShadow = true;
        spinner.add(ring);

        for (let b = 0; b < 18; b++) {
          const ang = (b / 18) * Math.PI * 2;
          const lug = new THREE.Mesh(lugGeom, silverRimMat);
          lug.position.set(
            faceSign * (tireW * 0.48),
            Math.sin(ang) * (radius * 0.78),
            Math.cos(ang) * (radius * 0.78)
          );
          lug.rotation.x = ang;
          spinner.add(lug);
        }
      }

      // 12 internal structural radial paddles around the hollow interior
      for (let s = 0; s < 12; s++) {
        const ang = (s / 12) * Math.PI * 2;
        const slat = new THREE.Mesh(slatGeom, slatMat);
        slat.position.set(0, Math.sin(ang) * (radius * 0.85), Math.cos(ang) * (radius * 0.85));
        slat.rotation.x = -ang;
        spinner.add(slat);
      }
      mergeStaticMeshes(THREE, spinner, { castShadow: true, receiveShadow: true });

      wheels.push(spinner);
      pods.push({
        podRoot,
        knuckle,
        spinner,
        lx: side * trackHalfW,
        lz: ax.z,
        baseY: radius,
        role: ax.role,
        smoothPodY: 0,
      });
      if (ax.role === "front") frontSteerKnuckles.push(knuckle);
      else if (ax.role === "rear") rearSteerKnuckles.push(knuckle);
    }
  }

  return { wheelGroup, wheels, frontSteerKnuckles, rearSteerKnuckles, pods };
}

function buildNasaConceptRoverVisuals(THREE) {
  const procGroup = new THREE.Group();

  const carbonMat = new THREE.MeshStandardMaterial({ color: 0x16191f, roughness: 0.7, metalness: 0.48 });
  const gunmetalMat = new THREE.MeshStandardMaterial({ color: 0x2c323b, roughness: 0.46, metalness: 0.74 });
  const silverArmorMat = new THREE.MeshStandardMaterial({ color: 0x9aa3af, roughness: 0.32, metalness: 0.78 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    roughness: 0.1,
    metalness: 0.55,
    emissive: 0x0c4a6e,
    emissiveIntensity: 0.48,
    transparent: true,
    opacity: 0.88,
  });
  const blueLedMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0ea5e9,
    emissiveIntensity: 2.2,
    roughness: 0.2,
  });
  const whiteTankMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.34, metalness: 0.25 });
  const nasaBadgeMat = new THREE.MeshStandardMaterial({
    map: makeConceptNasaBadgeTexture(THREE),
    color: 0xffffff,
    roughness: 0.38,
    metalness: 0.35,
  });
  const cabSideMat = new THREE.MeshStandardMaterial({
    map: makeConceptCabSideTexture(THREE),
    color: 0xffffff,
    roughness: 0.36,
    metalness: 0.65,
  });
  const labSideMat = new THREE.MeshStandardMaterial({
    map: makeConceptLabSideTexture(THREE),
    color: 0xffffff,
    roughness: 0.42,
    metalness: 0.62,
  });
  const solarMat = new THREE.MeshStandardMaterial({
    map: makeConceptSolarTexture(THREE),
    color: 0xffffff,
    roughness: 0.22,
    metalness: 0.45,
  });

  const addM = (geom, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    procGroup.add(m);
    return m;
  };

  // Continuous low matte carbon belly chassis & frame rails
  addM(new THREE.BoxGeometry(2.15, 0.28, 5.75), carbonMat, 0, 0.68, -0.05);
  addM(new THREE.BoxGeometry(2.38, 0.48, 3.05), carbonMat, 0, 1.04, -1.32);

  // Signature recessed trapezoidal lower front chin viewport + nose lip
  addM(new THREE.BoxGeometry(1.88, 0.14, 0.46), carbonMat, 0, 1.12, -2.92);
  addM(new THREE.BoxGeometry(1.76, 0.12, 0.34), carbonMat, 0, 0.62, -2.84);
  addM(new THREE.BoxGeometry(1.62, 0.42, 0.08), glassMat, 0, 0.87, -2.82, 0.26, 0, 0);

  // Aggressive forward-sloping nose hood + NASA badge
  addM(new THREE.BoxGeometry(2.08, 0.24, 0.82), carbonMat, 0, 1.24, -2.58, -0.22, 0, 0);
  addM(new THREE.BoxGeometry(0.46, 0.04, 0.46), nasaBadgeMat, 0, 1.36, -2.56, -0.22, 0, 0);

  // Raked dual-pane cyan cockpit windshield (slopes up-back from nose to roof) + center mullion + wipers
  addM(new THREE.BoxGeometry(1.94, 0.08, 1.48), glassMat, 0, 1.76, -1.66, -0.56, 0, 0);
  addM(new THREE.BoxGeometry(0.11, 0.12, 1.5), carbonMat, 0, 1.77, -1.66, -0.56, 0, 0);
  for (const wx of [-0.48, 0.48]) {
    addM(new THREE.BoxGeometry(0.56, 0.03, 0.04), silverArmorMat, wx, 1.38, -2.26, -0.12, wx > 0 ? -0.2 : 0.2, 0);
  }

  // Faceted brushed-silver upper cab shell, roofline & A-pillar shoulders
  addM(new THREE.BoxGeometry(2.14, 0.22, 1.42), gunmetalMat, 0, 2.24, -0.58, -0.06, 0, 0);
  addM(new THREE.BoxGeometry(2.34, 0.34, 1.62), silverArmorMat, 0, 2.04, -0.45);
  for (const sx of [-1.06, 1.06]) {
    // Swept cab fender beam sloping cleanly forward-down from roof waist to nose bumper
    addM(new THREE.BoxGeometry(0.24, 0.22, 2.15), silverArmorMat, sx, 1.56, -1.56, -0.46, 0, 0);
    // Side cockpit glass & upper roof quarter window
    addM(new THREE.BoxGeometry(0.06, 0.42, 1.15), glassMat, sx * 0.96, 1.76, -1.08, -0.2, 0, 0);
    // Textured cab armor side flank (US flag + 6-cell louver)
    addM(new THREE.PlaneGeometry(1.95, 0.88), cabSideMat, sx * 1.07, 1.54, -0.46, 0, sx < 0 ? -Math.PI / 2 : Math.PI / 2, 0);
  }

  // Twin roof brow air intakes with blue glowing LED accents
  for (const ix of [-0.54, 0.54]) {
    addM(new THREE.BoxGeometry(0.68, 0.2, 0.62), gunmetalMat, ix, 2.32, -1.16, -0.14, 0, 0);
    addM(new THREE.BoxGeometry(0.54, 0.08, 0.06), blueLedMat, ix, 2.29, -1.46);
  }

  // Articulated waist bellows connecting front cab & detached rear science lab
  for (let r = 0; r < 4; r++) {
    addM(new THREE.BoxGeometry(2.04, 1.34, 0.11), carbonMat, 0, 1.56, 0.12 + r * 0.14);
  }

  // Rear detached science laboratory module (hex mesh, NASA emblem, solar roof, pressure tank)
  addM(new THREE.BoxGeometry(2.42, 1.28, 2.18), gunmetalMat, 0, 1.62, 1.68);
  addM(new THREE.BoxGeometry(2.14, 0.32, 1.98), silverArmorMat, 0, 2.34, 1.66);
  addM(new THREE.BoxGeometry(1.22, 0.22, 0.72), glassMat, 0, 2.58, 1.42);
  for (const sx of [-1, 1]) {
    // Textured lab flanks
    addM(new THREE.PlaneGeometry(2.12, 1.18), labSideMat, sx * 1.22, 1.62, 1.68, 0, sx < 0 ? -Math.PI / 2 : Math.PI / 2, 0);
    // White shoulder oxygen/nitrogen pressure tank
    addM(new THREE.CylinderGeometry(0.11, 0.11, 1.05, 12), whiteTankMat, sx * 1.12, 2.18, 1.32, 0.92, 0, 0);
    // 2 angled photovoltaic solar panels per roof slope
    addM(new THREE.BoxGeometry(0.76, 0.05, 0.88), solarMat, sx * 0.84, 2.28, 1.18, 0, 0, sx * -0.44);
    addM(new THREE.BoxGeometry(0.76, 0.05, 0.88), solarMat, sx * 0.84, 2.28, 2.16, 0, 0, sx * -0.44);
    // Protruding 3-slot side utility rail bumper
    addM(new THREE.BoxGeometry(0.18, 0.24, 1.22), gunmetalMat, sx * 1.26, 1.32, 2.12);
  }
  // Stern bumper, rear airlock door & hex cutout step
  addM(new THREE.BoxGeometry(2.2, 0.42, 0.38), carbonMat, 0, 1.16, 2.86);
  addM(new THREE.BoxGeometry(0.92, 1.04, 0.08), silverArmorMat, 0, 1.68, 2.78);

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

  function applyVehicleVisibility() {
    const isConcept = isConceptType(activeVehicleType);
    mmsevContainer.visible = !isConcept;
    mmsevFallback.procGroup.visible = !isConcept && (!hasRealMmsevModel || detailLodFar);
    if (nasaModelRoot) nasaModelRoot.visible = !isConcept && !detailLodFar;
    conceptContainer.visible = isConcept;

    const lampY = isConcept ? 1.18 : 0.9;
    const lampZ = isConcept ? -2.96 : -2.02;
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
      pod.smoothPodY += (clampedDiff - (pod.smoothPodY || 0)) * Math.min(1, dt * 22);
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
