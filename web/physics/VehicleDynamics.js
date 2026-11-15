/**
 * Unified Mars Wheeled Vehicle & 6x6 Rover Dynamics Engine (`web/physics/VehicleDynamics.js`).
 *
 * Powered by `@dimforge/rapier3d-compat` (`RAPIER.World`, `RAPIER.RigidBody`,
 * `DynamicRayCastVehicleController`) and `three` (`THREE.Vector3`, `THREE.Quaternion`)
 * under Gale Crater gravity (`GALE_G ≈ 3.717 m/s²`).
 *
 * Consolidates all vehicle & rover solvers in one shared module:
 *  - `createVehicleBody`, `stepVehicle`, `vehiclePose`, `placeVehicle`, `shiftVehicle`, `dampVehicleAlong`
 *  - `createRoverDynamics`, `roverParamsFor`, `roverParamsForHistoric`, `ROVER_PARAMS`
 *  - `stepAdvancedRoverPhysics`
 */

import * as THREE from "three";
import { MARS_GEODESY } from "./MarsConstants.js";
import { marsGravityMs2 } from "./MarsGravityField.js";
import { RAPIER } from "./MarsPhysicsWorld.js";

export const VEHICLE_DT = 1 / 240;
export const GALE_G = marsGravityMs2(MARS_GEODESY.GALE_ANCHOR_LAT_DEG, -4000);
const MAX_SUBSTEPS = 24;

export const WATTS_PER_HP = 745.699872;
export const TORQUE_MULTIPLIER = 2.25;
export const POWER_MULTIPLIER = 2.25;

// Shared THREE.Vector3 / THREE.Quaternion scratch instances for allocations-free substepping
const _tmpV = new THREE.Vector3();
const _tmpQ = new THREE.Quaternion();

function vec3(x = 0, y = 0, z = 0) {
  return new THREE.Vector3(x, y, z);
}

// small vector helpers used by the tuned stabilisation / self-righting code (ported from
// eskisinden-gelen-iyi-ozellikler); they return new THREE.Vector3 values
const v3 = vec3;
const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const scale = (a, s) => v3(a.x * s, a.y * s, a.z * s);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const len = (a) => Math.hypot(a.x, a.y, a.z);
const norm = (a) => {
  const l = len(a) || 1;
  return v3(a.x / l, a.y / l, a.z / l);
};
const qRotate = (q, v) => quatRotateVec(q, v);
const qConjRotate = (q, v) => quatConjRotateVec(q, v);

function quatRotateVec(q, v) {
  _tmpQ.set(q.x, q.y, q.z, q.w);
  _tmpV.set(v.x, v.y, v.z).applyQuaternion(_tmpQ);
  return new THREE.Vector3(_tmpV.x, _tmpV.y, _tmpV.z);
}

function quatConjRotateVec(q, v) {
  _tmpQ.set(-q.x, -q.y, -q.z, q.w);
  _tmpV.set(v.x, v.y, v.z).applyQuaternion(_tmpQ);
  return new THREE.Vector3(_tmpV.x, _tmpV.y, _tmpV.z);
}

function normalizeQuatInPlace(q) {
  _tmpQ.set(q.x, q.y, q.z, q.w).normalize();
  q.x = _tmpQ.x;
  q.y = _tmpQ.y;
  q.z = _tmpQ.z;
  q.w = _tmpQ.w;
}

export function quatFromYaw(yaw) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

/** Heading of the chassis forward axis projected on the ground plane (0 = -Z, like hud3d yaw). */
export function vehicleYaw(body) {
  const f = quatRotateVec(body.q, { x: 0, y: 0, z: -1 });
  return Math.atan2(-f.x, -f.z);
}

/**
 * Create a Rapier `DynamicRayCastVehicleController` attached to a chassis RigidBody in a dedicated Rapier World.
 */
function createRapierVehicleControllerRig(spec, wheels, g = GALE_G) {
  const world = new RAPIER.World({ x: 0, y: -g, z: 0 });
  const rbDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, spec.comHeightM || 1.0, 0);
  const chassisRb = world.createRigidBody(rbDesc);
  const box = spec.box || { halfW: 1.3, halfL: 2.3, height: 2.2 };
  const colDesc = RAPIER.ColliderDesc.cuboid(
    box.halfW || 1.3,
    (box.height || 2.0) * 0.5,
    box.halfL || 2.3
  ).setMass(spec.massKg || 2000);
  world.createCollider(colDesc, chassisRb);

  const vc = world.createVehicleController(chassisRb);
  vc.setIndexForwardAxis = vc.setIndexForwardAxis || (() => {});
  const restLen = (spec.droopM || 0.18) + (spec.staticSagM || 0.08);
  const wRadius = spec.wheelRadius || 0.345;
  const dirCs = { x: 0, y: -1, z: 0 };
  const axleCs = { x: 1, y: 0, z: 0 };

  wheels.forEach((w, idx) => {
    const conn = { x: w.x ?? w.lx ?? 0, y: 0, z: w.z ?? w.lz ?? 0 };
    vc.addWheel(conn, dirCs, axleCs, restLen, wRadius);
    vc.setWheelSuspensionStiffness(idx, 35.0);
    vc.setWheelMaxSuspensionTravel(idx, restLen + (spec.bumpM || 0.16));
    vc.setWheelFrictionSlip(idx, spec.mu || 0.58);
  });

  return { world, chassisRb, vc };
}

// ---------- vehicle catalogue ----------
export const VEHICLE_SPECS = Object.freeze({
  sev: Object.freeze({
    id: "sev",
    nameEn: "NASA SEV pressurized rover",
    nameTr: "NASA SEV basınçlı araç",
    shortLabel: "SEV",
    massKg: 2994 + 160,
    topSpeedMs: 10 / 3.6,
    reverseSpeedMs: 4 / 3.6, // estimate
    powerW: 12000 * 2.25, // 27,000 W / 27.0 kW (2.25x)
    powerKw: (12000 * 2.25) / 1000,
    maxHp: (12000 * 2.25) / 745.699872,
    maxDriveForceN: 7500 * 2.25, // 16,875 N (2.25x)
    wheelTorqueMaxNm: 7500 * 2.25 * 0.345, // 5,821.875 N·m (2.25x)
    brakeForceN: 13500, // estimate
    mu: 0.92, // high-traction tyre on Mars regolith
    rollingResistance: 0.055,
    wheelRadius: 0.345, // matches the NASA 3D model pods (fact sheet: 39 in / 0.99 m wheels)
    trackHalfW: 1.339,
    axles: [-0.969, 0.37, 1.708],
    steerAxles: [1, 0, -1],
    maxSteerRad: 0.55,
    canCrab: true,
    staticSagM: 0.07,
    droopM: 0.18,
    bumpM: 0.16,
    damping: 0.72,
    comHeightM: 0.95,
    box: { halfW: 1.66, halfL: 2.42, height: 3.25, clearance: 0.42 },
    sources: "NASA SEV fact sheet FS-2011-08-045-JSC (mass, ~10 km/h, 360 deg pivoting wheels); NASA 3D Resources MMSEV model (geometry). Power, brakes, friction are estimates.",
  }),
  chariot: Object.freeze({
    id: "chariot",
    nameEn: "NASA Chariot chassis (crew rides outside)",
    nameTr: "NASA Chariot şasisi (ekip dışarıda)",
    shortLabel: "Chariot",
    massKg: 1500 + 360,
    topSpeedMs: 10 / 3.6,
    reverseSpeedMs: 4 / 3.6,
    powerW: 12000 * 2.25, // 27,000 W / 27.0 kW (2.25x)
    powerKw: (12000 * 2.25) / 1000,
    maxHp: (12000 * 2.25) / 745.699872,
    maxDriveForceN: 7500 * 2.25, // 16,875 N (2.25x)
    wheelTorqueMaxNm: 7500 * 2.25 * 0.345, // 5,821.875 N·m (2.25x)
    brakeForceN: 13500,
    mu: 0.92,
    rollingResistance: 0.055,
    wheelRadius: 0.345,
    trackHalfW: 1.339,
    axles: [-0.969, 0.37, 1.708],
    steerAxles: [1, 0, -1],
    maxSteerRad: 0.55,
    canCrab: true,
    staticSagM: 0.06,
    droopM: 0.18,
    bumpM: 0.16,
    damping: 0.72,
    comHeightM: 0.72,
    box: { halfW: 1.55, halfL: 2.3, height: 1.6, clearance: 0.42 },
    sources: "NASA SEV fact sheet FS-2011-08-045-JSC (Chariot chassis driven without the cabin). Mass without the cabin is an estimate.",
  }),
  lrv: Object.freeze({
    id: "lrv",
    nameEn: "Apollo LRV-class open rover",
    nameTr: "Apollo LRV sınıfı açık araç",
    shortLabel: "LRV",
    massKg: 210 + 360,
    topSpeedMs: 13 / 3.6,
    reverseSpeedMs: 5 / 3.6, // estimate
    powerW: 4 * 186.4 * 1.85, // 1,379.4 W / 1.38 kW (1.85x)
    powerKw: (4 * 186.4 * 1.85) / 1000,
    maxHp: (4 * 186.4 * 1.85) / 745.699872,
    maxDriveForceN: 1150 * 2.25, // 2,587.5 N (2.25x)
    wheelTorqueMaxNm: 1150 * 2.25 * 0.409, // 1,058.29 N·m (2.25x)
    brakeForceN: 2100, // estimate
    mu: 0.90,
    rollingResistance: 0.055,
    wheelRadius: 0.409,
    trackHalfW: 0.915,
    axles: [-1.15, 1.15],
    steerAxles: [1, -1],
    maxSteerRad: 0.5,
    canCrab: false,
    staticSagM: 0.06,
    droopM: 0.15,
    bumpM: 0.14,
    damping: 0.70,
    comHeightM: 0.55,
    box: { halfW: 1.0, halfL: 1.55, height: 1.15, clearance: 0.36 },
    sources: "NASA NSSDC Apollo LRV page (mass, wheelbase, wheel size, motors, steering, clearance). Apollo numbers stand in for a Mars version, which does not exist.",
  }),
});
export const VEHICLE_IDS = Object.freeze(Object.keys(VEHICLE_SPECS));

export function getVehicleSpec(id) {
  return VEHICLE_SPECS[id] || VEHICLE_SPECS.sev;
}

function derive(spec, g) {
  const nWheels = spec.axles.length * 2;
  const wheelLoad = (spec.massKg * g) / nWheels;
  const k = wheelLoad / spec.staticSagM;
  const mWheel = spec.massKg / nWheels;
  const c = 2 * spec.damping * Math.sqrt(k * mWheel);
  const { halfW, halfL, height } = spec.box;
  const m = spec.massKg;
  const I = vec3(
    (m / 12) * ((2 * halfL) ** 2 + height ** 2),
    (m / 12) * ((2 * halfW) ** 2 + (2 * halfL) ** 2),
    (m / 12) * ((2 * halfW) ** 2 + height ** 2)
  );
  const wheels = [];
  spec.axles.forEach((z, ai) => {
    for (const side of [-1, 1]) {
      wheels.push({ x: side * spec.trackHalfW, z, steerSign: spec.steerAxles[ai], side });
    }
  });
  const kT = mWheel * 400;
  const cT = 2 * 0.8 * Math.sqrt(kT * mWheel);
  return { k, c, kBump: 12 * k, kT, cT, wheelLoad, I, wheels, nWheels };
}

export function createVehicleBody(id, x, z, yaw, sampleHeight, g = GALE_G) {
  const spec = getVehicleSpec(id);
  const d = derive(spec, g);
  const rapierRig = createRapierVehicleControllerRig(spec, d.wheels, g);
  const body = {
    spec,
    g,
    d,
    pos: vec3(),
    vel: vec3(),
    q: quatFromYaw(yaw),
    w: vec3(),
    acc: 0,
    steer: 0,
    crab: false,
    wheels: d.wheels.map((wd) => ({ ...wd, s: 0, sPrev: 0, contact: false, load: 0, spin: 0, steerRad: 0, slip: 0 })),
    contacts: 0,
    airborneT: 0,
    speed: 0,
    forwardSpeed: 0,
    lateralSpeed: 0,
    slipRatio: 0,
    powerFrac: 0,
    mechPowerW: 0,
    mechPowerKw: 0,
    maxPowerKw: spec.powerW / 1000,
    hp: 0,
    maxHp: spec.powerW / WATTS_PER_HP,
    wheelTorqueNm: 0,
    maxWheelTorqueNm: spec.wheelTorqueMaxNm ?? spec.maxDriveForceN * spec.wheelRadius,
    maxDriveForceN: spec.maxDriveForceN,
    weightN: spec.massKg * g,
    lastImpact: 0,
    sleeping: false,
    stillT: 0,
    rapierWorld: rapierRig.world,
    rapierChassisRb: rapierRig.chassisRb,
    rapierVehicleController: rapierRig.vc,
    tippedT: 0,
    selfRighting: false,
  };
  placeVehicle(body, x, z, yaw, sampleHeight);
  return body;
}

export function placeVehicle(body, x, z, yaw, sampleHeight) {
  const spec = body.spec;
  body.q = quatFromYaw(yaw);
  body.vel = vec3();
  body.w = vec3();
  body.acc = 0;
  body.sleeping = false;
  body.stillT = 0;
  body.tippedT = 0;
  body.selfRighting = false;
  // highest wheel footprint decides the ride height, so no wheel starts inside the ground
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  let top = -Infinity;
  for (const w of body.wheels) {
    const wx = x + c * w.x + s * w.z;
    const wz = z - s * w.x + c * w.z;
    top = Math.max(top, sampleHeight(wx, wz));
  }
  body.pos = vec3(x, top + spec.comHeightM, z);
  for (const w of body.wheels) {
    w.s = 0;
    w.sPrev = 0;
    w.spin = w.spin || 0;
  }
  if (body.rapierChassisRb) {
    body.rapierChassisRb.setTranslation(body.pos, true);
    body.rapierChassisRb.setRotation(body.q, true);
  }
}

function groundNormal(sampleHeight, x, z, e = 0.5) {
  const nx = sampleHeight(x - e, z) - sampleHeight(x + e, z);
  const nz = sampleHeight(x, z - e) - sampleHeight(x, z + e);
  return vec3(nx, 2 * e, nz).normalize();
}

export function stepVehicle(body, input, env, dt) {
  const active = Math.abs(input.throttle || 0) > 0.01 || Math.abs(input.steer || 0) > 0.01 || input.brake;
  if (body.sleeping && !active) return body;
  if (active) {
    body.sleeping = false;
    body.stillT = 0;
  }
  body.acc = Math.min(body.acc + Math.max(0, Math.min(0.1, dt)), VEHICLE_DT * MAX_SUBSTEPS);
  body.lastImpact = 0;
  while (body.acc >= VEHICLE_DT) {
    substepVehicle(body, input, env, VEHICLE_DT);
    body.acc -= VEHICLE_DT;
  }
  // Sleep when parked and settled, so a parked rover costs nothing and never creeps.
  const bodyUp = qRotate(body.q, v3(0, 1, 0));
  if (!active && !body.selfRighting && bodyUp.y > 0.72 && body.contacts === body.wheels.length && len(body.vel) < 0.02 && len(body.w) < 0.02) {
    body.stillT += dt;
    if (body.stillT > 1.0) {
      body.sleeping = true;
      body.vel.set(0, 0, 0);
      body.w.set(0, 0, 0);
    }
  } else {
    body.stillT = 0;
  }
  return body;
}

function substepVehicle(body, input, env, h) {
  const spec = body.spec;
  const d = body.d;
  const g = body.g;
  const sampleHeight = env.sampleHeight;
  const mult = Math.max(0.25, Math.min(5, Number(input.speedMultiplier) || 1));
  const throttle = Math.max(-1, Math.min(1, input.throttle || 0));
  const steerIn = Math.max(-1, Math.min(1, input.steer || 0));
  body.crab = Boolean(input.crab && spec.canCrab);

  const right = quatRotateVec(body.q, { x: 1, y: 0, z: 0 });
  const up = quatRotateVec(body.q, { x: 0, y: 1, z: 0 });
  const back = quatRotateVec(body.q, { x: 0, y: 0, z: 1 });
  const fwd = back.clone().multiplyScalar(-1);

  // steering: responsive turn-in with smooth high-speed stability
  const vFwd = dot(body.vel, fwd);
  const speedLimit = spec.maxSteerRad / (1 + (vFwd * vFwd) / (8.5 * 8.5));
  const targetSteer = steerIn * Math.min(spec.maxSteerRad, speedLimit);
  body.steer += Math.max(-1.8 * h, Math.min(1.8 * h, targetSteer - body.steer));

  const vMax = (throttle >= 0 ? spec.topSpeedMs : spec.reverseSpeedMs) * mult;
  const power = spec.powerW * mult;
  const maxWheelTorqueNm = spec.wheelTorqueMaxNm ?? spec.maxDriveForceN * spec.wheelRadius;
  const maxDriveForceN = maxWheelTorqueNm / spec.wheelRadius;
  let driveTotal = 0;
  const movingWithThrottle = throttle !== 0 && Math.sign(throttle) === Math.sign(vFwd || throttle);
  if (throttle !== 0 && movingWithThrottle) {
    const governor = Math.max(0, Math.min(1, (vMax - Math.abs(vFwd)) / (0.12 * vMax)));
    const wheelOmega = Math.max(0.3 / spec.wheelRadius, Math.abs(vFwd) / spec.wheelRadius);
    const powerCapTorqueNm = power / wheelOmega;
    const cmdTorqueNm = Math.sign(throttle) * Math.abs(throttle) * Math.min(maxWheelTorqueNm, powerCapTorqueNm) * governor;
    driveTotal = cmdTorqueNm / spec.wheelRadius;
  }
  const braking = input.brake || (throttle !== 0 && !movingWithThrottle);
  const hold = throttle === 0;
  const mechPowerW = Math.abs(driveTotal * vFwd);
  body.mechPowerW = mechPowerW;
  body.mechPowerKw = mechPowerW / 1000;
  body.maxPowerKw = power / 1000;
  body.hp = mechPowerW / WATTS_PER_HP;
  body.maxHp = power / WATTS_PER_HP;
  body.wheelTorqueNm = driveTotal * spec.wheelRadius;
  body.maxWheelTorqueNm = maxWheelTorqueNm;
  body.maxDriveForceN = maxDriveForceN;
  body.weightN = spec.massKg * g;
  body.powerFrac = Math.min(1, mechPowerW / power);

  const origin = body.pos.clone().addScaledVector(up, -spec.comHeightM);
  const r = spec.wheelRadius;
  const F = vec3(0, -spec.massKg * g, 0);
  let T = vec3();
  let contacts = 0;
  let slipSum = 0;
  let loadSum = 0;
  const driveWheels = d.nWheels;
  const vc = body.rapierVehicleController;

  for (let wi = 0; wi < body.wheels.length; wi++) {
    const w = body.wheels[wi];
    let steerRad = 0;
    if (body.crab) steerRad = body.steer;
    else if (w.steerSign) steerRad = body.steer * w.steerSign;
    w.steerRad = steerRad;
    if (vc) {
      vc.setWheelSteering(wi, steerRad);
      vc.setWheelEngineForce(wi, driveTotal / driveWheels);
      vc.setWheelBrake(wi, braking || hold ? spec.brakeForceN / driveWheels : 0);
    }

    const hp = origin.clone().addScaledVector(right, w.x).addScaledVector(back, w.z);
    const ground = sampleHeight(hp.x, hp.z);
    // wheel struts only push when pointed downward; wait until mostly upright during self-righting
    if (up.y < (body.selfRighting ? 0.72 : 0.55)) {
      w.sPrev = w.s;
      w.s = -spec.droopM;
      w.contact = false;
      w.load = 0;
      w.anchor = null;
      continue;
    }
    // suspension travel needed for the tyre to just touch the ground (positive = compressed)
    const rawS = (ground + r - hp.y) / up.y - r;
    const s = Math.min(rawS, spec.bumpM + 0.08);
    w.sPrev = w.s;
    if (rawS < -spec.droopM) {
      w.s = -spec.droopM;
      w.contact = false;
      w.load = 0;
      continue;
    }
    const sVel = !w.contact && s > -spec.droopM + 0.05 ? Math.max(0, -body.vel.y) : (s - w.sPrev) / h;
    w.contact = true;
    contacts++;
    let fs = d.k * s + d.wheelLoad + d.c * sVel;
    if (s > spec.bumpM) fs += d.kBump * (s - spec.bumpM) + 2 * d.c * Math.max(0, sVel); // bump stop
    w.s = s;
    fs = Math.max(0, Math.min(d.wheelLoad * 18, fs));
    if (sVel < -3 && w.sPrev > -spec.droopM) body.lastImpact = Math.max(body.lastImpact, -sVel);
    else if (sVel > 1.5) body.lastImpact = Math.max(body.lastImpact, sVel);

    const contact = vec3(hp.x, ground, hp.z);
    const n = groundNormal(sampleHeight, hp.x, hp.z);
    const load = fs * Math.max(0, up.dot(n));
    w.load = load;
    loadSum += load;

    const cs = Math.cos(steerRad);
    const sn = Math.sin(steerRad);
    const wf = fwd.clone().multiplyScalar(cs).addScaledVector(right, -sn);
    const tf = wf.clone().addScaledVector(n, -wf.dot(n)).normalize();
    const tl = new THREE.Vector3().crossVectors(n, tf);
    const rc = contact.clone().sub(body.pos);
    const vcVel = new THREE.Vector3().crossVectors(body.w, rc).add(body.vel);
    const vLong = vcVel.dot(tf);
    const vLat = vcVel.dot(tl);

    const fMax = spec.mu * load;
    // lateral: crisp slip angle with smooth low-speed blend
    const alpha = Math.atan2(vLat, Math.abs(vLong) + 0.35);
    let fLat = -fMax * Math.tanh(alpha / 0.055);
    // longitudinal: drive, brakes / hold, rolling resistance
    let fLong = 0;
    if (braking) fLong = -Math.min(spec.brakeForceN / driveWheels, fMax) * Math.tanh(vLong / 0.05);
    else if (hold) fLong = -fMax * Math.tanh(vLong / 0.05);
    else {
      const tractionCap = fMax * (1 - 0.35 * Math.min(1, Math.abs(alpha) / 0.12));
      fLong = Math.max(-tractionCap, Math.min(tractionCap, driveTotal / driveWheels));
    }
    fLong -= spec.rollingResistance * load * Math.tanh(vLong / 0.1);
    const brakeCap = hold ? fMax : Math.min(fMax, spec.brakeForceN / driveWheels);
    if ((hold || braking) && Math.hypot(vLong, vLat) < 0.12) {
      if (!w.anchor) w.anchor = { x: contact.x, z: contact.z };
      const ax = contact.x - w.anchor.x;
      const az = contact.z - w.anchor.z;
      const dL = ax * tf.x + az * tf.z;
      const dT = ax * tl.x + az * tl.z;
      fLong = -d.kT * dL - d.cT * vLong;
      fLat = hold ? -d.kT * dT - d.cT * vLat : fLat;
      const fa = Math.hypot(fLong, fLat);
      if (fa > brakeCap) {
        const keep = brakeCap / fa;
        fLong *= keep;
        fLat *= keep;
        w.anchor.x = contact.x - ax * keep;
        w.anchor.z = contact.z - az * keep;
      }
    } else {
      w.anchor = null;
    }
    const ft = Math.hypot(fLong, fLat);
    if (ft > fMax && ft > 0) {
      const k = fMax / ft;
      fLong *= k;
      fLat *= k;
    }
    w.slip = Math.min(1, Math.abs(alpha) / 0.3);
    slipSum += w.slip * load;
    w.spin += (vLong / r) * h;

    const fw = up.clone().multiplyScalar(fs).addScaledVector(tf, fLong).addScaledVector(tl, fLat);
    F.add(fw);
    T.add(new THREE.Vector3().crossVectors(rc, fw));
  }

  // chassis underside against the ground (high-centring on ridges, never sinking into the terrain)
  if (!body.selfRighting && up.y >= 0.35) {
    const { halfW, halfL, clearance } = spec.box;
    const maxBodyFy = spec.massKg * g * 3.5;
    for (const [bx, bz] of [
      [-halfW, -halfL],
      [halfW, -halfL],
      [-halfW, halfL],
      [halfW, halfL],
      [0, 0],
    ]) {
      const p = add(add(add(origin, scale(right, bx)), scale(back, bz)), scale(up, clearance));
      const gy = sampleHeight(p.x, p.z);
      const pen = gy - p.y;
      if (pen <= 0) continue;
      const rc = sub(p, body.pos);
      const vc = add(body.vel, cross(body.w, rc));
      const kB = d.k * 8;
      const fy = Math.min(maxBodyFy, Math.max(0, kB * pen - 4 * d.c * vc.y));
      const fr = v3(-vc.x * spec.massKg * 0.8, fy, -vc.z * spec.massKg * 0.8); // scraping friction
      F.x += fr.x;
      F.y += fr.y;
      F.z += fr.z;
      T = add(T, cross(rc, fr));
    }
  }

  // Active rollover stabilization + automatic self-righting gyro recovery (vehicles never stay flipped)
  const cNrm = groundNormal(sampleHeight, body.pos.x, body.pos.z);
  const align = dot(up, cNrm);
  const hasInp = Math.abs(throttle) > 0.05 || Math.abs(steerIn) > 0.05 || Boolean(input.brake);
  if (up.y < 0.45) {
    body.tippedT += h;
    if (body.tippedT > (hasInp ? 0.08 : 0.2)) body.selfRighting = true;
  } else if (body.selfRighting && (align < 0.94 || up.y < 0.85)) {
    // finish righting smoothly onto all wheels before releasing gyro
  } else {
    body.tippedT = 0;
    body.selfRighting = false;
  }
  if (body.selfRighting || up.y < 0.55) {
    const sideDrop = Math.abs(right.y) * Math.max(spec.trackHalfW, spec.box.halfW);
    const endDrop = Math.abs(back.y) * spec.box.halfL * 0.45;
    const invDrop = up.y < 0 ? (-up.y) * Math.max(spec.comHeightM, spec.box.height - spec.comHeightM) : up.y * spec.comHeightM;
    const rollClearY = Math.max(spec.comHeightM + 0.15, sideDrop + endDrop + invDrop + 0.18);
    const floorY = sampleHeight(body.pos.x, body.pos.z) + rollClearY;
    const liftErr = Math.max(-0.35, Math.min(1.5, floorY - body.pos.y));
    F.y += Math.max(-spec.massKg * g * 0.4, spec.massKg * (g + 22 * liftErr - 8 * body.vel.y));
    body.vel.x *= Math.exp(-h * 3.0);
    body.vel.z *= Math.exp(-h * 3.0);
  }
  if (body.selfRighting) {
    let ax = cross(up, cNrm);
    if (len(ax) < 1e-3) ax = fwd;
    const axBody = qConjRotate(body.q, norm(ax));
    const wbCur = qConjRotate(body.q, body.w);
    const targetRate = 3.2 * Math.max(0.25, Math.min(1, 1.05 - align));
    const tauBody = v3(
      d.I.x * (axBody.x * targetRate - wbCur.x) * 14.0,
      d.I.y * (-wbCur.y * 8.0),
      d.I.z * (axBody.z * targetRate - wbCur.z) * 14.0
    );
    T = add(T, qRotate(body.q, tauBody));
  } else {
    const steep = Math.max(0, 0.86 - align) + Math.max(0, 0.82 - up.y) * 1.35;
    if (steep > 0) {
      let ax = cross(up, cNrm);
      if (len(ax) > 1e-4) {
        const axBody = qConjRotate(body.q, norm(ax));
        const wbCur = qConjRotate(body.q, body.w);
        const kp = Math.min(18, steep * 28);
        const kd = 3.5 + steep * 5.0;
        const tauBody = v3(
          d.I.x * (axBody.x * kp - wbCur.x * kd),
          0,
          d.I.z * (axBody.z * kp - wbCur.z * kd)
        );
        T = add(T, qRotate(body.q, tauBody));
      }
    }
  }

  const m = spec.massKg;
  body.vel.addScaledVector(F, h / m);
  body.pos.addScaledVector(body.vel, h);

  const wb = quatConjRotateVec(body.q, body.w);
  const tb = quatConjRotateVec(body.q, T);
  const I = d.I;
  const Iw = vec3(I.x * wb.x, I.y * wb.y, I.z * wb.z);
  const gyro = new THREE.Vector3().crossVectors(wb, Iw);
  wb.x += ((tb.x - gyro.x) / I.x) * h;
  wb.y += ((tb.y - gyro.y) / I.y) * h;
  wb.z += ((tb.z - gyro.z) / I.z) * h;
  body.w = quatRotateVec(body.q, wb);
  const q = body.q;
  const wx = body.w.x;
  const wy = body.w.y;
  const wz = body.w.z;
  q.x += 0.5 * (wx * q.w + wy * q.z - wz * q.y) * h;
  q.y += 0.5 * (wy * q.w + wz * q.x - wx * q.z) * h;
  q.z += 0.5 * (wz * q.w + wx * q.y - wy * q.x) * h;
  q.w += 0.5 * (-wx * q.x - wy * q.y - wz * q.z) * h;
  normalizeQuatInPlace(q);

  if (body.rapierChassisRb) {
    body.rapierChassisRb.setTranslation(body.pos, true);
    body.rapierChassisRb.setRotation(body.q, true);
    body.rapierChassisRb.setLinvel(body.vel, true);
    body.rapierChassisRb.setAngvel(body.w, true);
  }

  body.contacts = contacts;
  body.airborneT = contacts === 0 ? body.airborneT + h : 0;
  body.speed = Math.hypot(body.vel.x, body.vel.z);
  body.forwardSpeed = body.vel.dot(fwd);
  body.lateralSpeed = body.vel.dot(right);
  body.slipRatio = loadSum > 0 ? slipSum / loadSum : 0;
}

export function vehiclePose(body) {
  const up = quatRotateVec(body.q, { x: 0, y: 1, z: 0 });
  const origin = body.pos.clone().addScaledVector(up, -body.spec.comHeightM);
  return { origin, q: body.q, yaw: vehicleYaw(body), up };
}

export function shiftVehicle(body, dx, dz) {
  body.pos.x += dx;
  body.pos.z += dz;
  if (body.rapierChassisRb) {
    body.rapierChassisRb.setTranslation(body.pos, true);
  }
}

export function dampVehicleAlong(body, nx, nz, keep = 0.25) {
  const vn = body.vel.x * nx + body.vel.z * nz;
  if (vn < 0) {
    body.vel.x -= nx * vn * (1 - keep);
    body.vel.z -= nz * vn * (1 - keep);
  }
  body.sleeping = false;
}

// ============================================================================
// UNIFIED 6x6 ROVER DYNAMICS (`ROVER_PARAMS`, `createRoverDynamics`)
// ============================================================================

const BASE_WHEEL_FORCE_MAX_N = 3400 * TORQUE_MULTIPLIER;
const BASE_POWER_W = 14000 * POWER_MULTIPLIER;
const BASE_BOOST_POWER_W = 19000 * POWER_MULTIPLIER;

export const ROVER_PARAMS = Object.freeze({
  massKg: 2950,
  weightN: 2950 * 3.71,
  dims: { w: 2.6, h: 2.2, l: 4.6 },
  cgY: 0.72,
  cgZ: 0.37,
  g: 3.71,
  wheelRadius: 0.345,
  tireHalfWidth: 0.22,
  wheelMassKg: 28,
  wheelInertiaKgM2: 6 * 0.5 * 28 * 0.345 * 0.345,
  trackHalfW: 1.339,
  axleZ: [-0.969, 0.37, 1.708],
  restLen: 0.5,
  sagM: 0.11,
  maxComp: 0.34,
  bumpRatio: 0.85,
  reboundRatio: 1.45,
  dampingZeta: 0.68,
  antiRollRatio: 0.62,
  mu: 1.15,
  muSlide: 0.92,
  rollingCrr: 0.055,
  corneringB: 15.0,
  gearRatio: 11.2,
  wheelForceMaxN: BASE_WHEEL_FORCE_MAX_N,
  wheelTorqueMaxNm: BASE_WHEEL_FORCE_MAX_N * 0.345,
  motorTorqueMaxNm: (BASE_WHEEL_FORCE_MAX_N * 0.345) / (11.2 * 0.88),
  powerW: BASE_POWER_W,
  boostPowerW: BASE_BOOST_POWER_W,
  powerKw: BASE_POWER_W / 1000,
  boostPowerKw: BASE_BOOST_POWER_W / 1000,
  maxHp: BASE_POWER_W / WATTS_PER_HP,
  boostHp: BASE_BOOST_POWER_W / WATTS_PER_HP,
  vMax: 38.6 / 3.6,
  vMaxBoost: 45.6 / 3.6,
  vMaxReverse: 14 / 3.6,
  brakeForceN: 16500,
  regenCoastG: 0.11,
  pedalRate: 1.32,
  steerMaxRad: (26 * Math.PI) / 180,
  steerRate: 1.75,
  batteryKWh: 45,
  hotelW: 1200,
  driveEfficiency: 0.88,
  regenEfficiency: 0.6,
});

export function roverParamsFor(spec) {
  if (!spec || spec.id === "mmsev") return ROVER_PARAMS;
  const k = (spec.massKg || 1850) / 1850;
  const sp = (spec.topSpeedMs || 18.5) / 18.5;
  const axleZ = (spec.axles || []).map((a) => a.z);
  const mid = axleZ.length === 3 ? axleZ[1] : ROVER_PARAMS.cgZ;
  const r = spec.wheelRadius || ROVER_PARAMS.wheelRadius;
  const massKg = Math.round(ROVER_PARAMS.massKg * k);
  const gearRatio = spec.gearRatio || ROVER_PARAMS.gearRatio;
  const eff = ROVER_PARAMS.driveEfficiency;
  const wheelTorqueMaxNm = Number.isFinite(spec.wheelTorqueMaxNm)
    ? spec.wheelTorqueMaxNm
    : ROVER_PARAMS.wheelForceMaxN * k * r;
  const wheelForceMaxN = wheelTorqueMaxNm / r;
  const motorTorqueMaxNm = Number.isFinite(spec.motorTorqueMaxNm)
    ? spec.motorTorqueMaxNm
    : wheelTorqueMaxNm / (gearRatio * eff);
  const powerW = Number.isFinite(spec.powerW) ? spec.powerW : ROVER_PARAMS.powerW * k * sp;
  const boostPowerW = Number.isFinite(spec.boostPowerW) ? spec.boostPowerW : ROVER_PARAMS.boostPowerW * k * sp;
  const wheelMassKg = ROVER_PARAMS.wheelMassKg * (r / ROVER_PARAMS.wheelRadius) ** 2;
  const travelScale = 1 + (r / ROVER_PARAMS.wheelRadius - 1) * 0.45;
  return Object.freeze({
    ...ROVER_PARAMS,
    massKg,
    weightN: massKg * ROVER_PARAMS.g,
    wheelMassKg,
    wheelInertiaKgM2: 6 * 0.5 * wheelMassKg * r * r,
    wheelRadius: r,
    tireHalfWidth: Math.max(0.16, r * 0.62),
    trackHalfW: spec.wheelTrackHalfX || ROVER_PARAMS.trackHalfW,
    axleZ: axleZ.length === 3 ? axleZ : ROVER_PARAMS.axleZ,
    cgZ: mid,
    cgY: ROVER_PARAMS.cgY + (r - ROVER_PARAMS.wheelRadius) * 0.45,
    restLen: ROVER_PARAMS.restLen * travelScale,
    sagM: ROVER_PARAMS.sagM * travelScale,
    maxComp: ROVER_PARAMS.maxComp * travelScale,
    wheelForceMaxN,
    wheelTorqueMaxNm,
    motorTorqueMaxNm,
    brakeForceN: ROVER_PARAMS.brakeForceN * k,
    powerW,
    boostPowerW,
    powerKw: powerW / 1000,
    boostPowerKw: boostPowerW / 1000,
    maxHp: powerW / WATTS_PER_HP,
    boostHp: boostPowerW / WATTS_PER_HP,
    gearRatio,
    vMax: Number.isFinite(spec.roverMaxKmh) ? spec.roverMaxKmh / 3.6 : ROVER_PARAMS.vMax * sp,
    vMaxBoost: Number.isFinite(spec.roverBoostKmh) ? spec.roverBoostKmh / 3.6 : ROVER_PARAMS.vMaxBoost * sp,
    vMaxReverse: Number.isFinite(spec.roverReverseKmh) ? spec.roverReverseKmh / 3.6 : ROVER_PARAMS.vMaxReverse * sp,
    dims: { w: (spec.halfW || 1.3) * 2, h: ROVER_PARAMS.dims.h, l: (spec.halfL || 2.3) * 2 },
  });
}

const HISTORIC_WHEEL_R = {
  sojourner: 0.068,
  "mer-spirit": 0.128,
  "mer-opportunity": 0.128,
  curiosity: 0.255,
  "perseverance-glb": 0.26,
};
const HISTORIC_VMAX_KMH = {
  sojourner: 4,
  "mer-spirit": 7,
  "mer-opportunity": 7,
  curiosity: 10,
  "perseverance-glb": 10,
};

export function roverParamsForHistoric(spec) {
  const kind = spec?.modelKind || "curiosity";
  const r = HISTORIC_WHEEL_R[kind] ?? 0.25;
  const s = r / ROVER_PARAMS.wheelRadius;
  const hw = Math.max(0.24, (spec?.halfW || 1.2) * 0.72);
  const hl = Math.max(0.28, (spec?.halfL || 1.4) * 0.72);
  const mass = spec?.massKg || 900;
  const k = mass / ROVER_PARAMS.massKg;
  const vmax = (HISTORIC_VMAX_KMH[kind] ?? 8) / 3.6;
  const wheelTorqueMaxNm = Number.isFinite(spec?.wheelTorqueMaxNm)
    ? spec.wheelTorqueMaxNm
    : ROVER_PARAMS.wheelForceMaxN * k * r;
  const wheelForceMaxN = wheelTorqueMaxNm / r;
  const motorTorqueMaxNm = Number.isFinite(spec?.motorTorqueMaxNm)
    ? spec.motorTorqueMaxNm
    : wheelTorqueMaxNm / (ROVER_PARAMS.gearRatio * ROVER_PARAMS.driveEfficiency);
  const powerW = Number.isFinite(spec?.powerW) ? spec.powerW : ROVER_PARAMS.powerW * k;
  const boostPowerW = Number.isFinite(spec?.boostPowerW) ? spec.boostPowerW : ROVER_PARAMS.boostPowerW * k;
  const wheelMassKg = Math.max(0.35, mass * 0.018);
  return Object.freeze({
    ...ROVER_PARAMS,
    massKg: mass,
    weightN: mass * ROVER_PARAMS.g,
    dims: { w: hw * 2.4, h: Math.max(0.3, 2.2 * s), l: hl * 2.4 },
    cgY: Math.max(0.1, 0.68 * s),
    cgZ: 0,
    wheelRadius: r,
    tireHalfWidth: Math.max(0.035, r * 0.45),
    wheelMassKg,
    wheelInertiaKgM2: 6 * 0.5 * wheelMassKg * r * r,
    trackHalfW: hw,
    axleZ: [-hl, 0, hl],
    restLen: 0.5 * s,
    sagM: 0.11 * s,
    maxComp: 0.34 * s,
    probeScale: s,
    wheelForceMaxN,
    wheelTorqueMaxNm,
    motorTorqueMaxNm,
    brakeForceN: ROVER_PARAMS.brakeForceN * k,
    powerW,
    boostPowerW,
    powerKw: powerW / 1000,
    boostPowerKw: boostPowerW / 1000,
    maxHp: powerW / WATTS_PER_HP,
    boostHp: boostPowerW / WATTS_PER_HP,
    vMax: vmax,
    vMaxBoost: vmax * 1.3,
    vMaxReverse: vmax * 0.5,
    batteryKWh: kind === "sojourner" ? 0.15 : kind.startsWith("mer") ? 1.0 : 2.7,
    hotelW: kind === "sojourner" ? 10 : kind.startsWith("mer") ? 60 : 110,
  });
}

const SUBSTEP = 1 / 240;
const SLEEP_SPEED_SQ = 4e-4;

// Rover body dynamics as tuned on eskisinden-gelen-iyi-ozellikler (anti-roll bars, ESC,
// self-righting, boost torque); `THREE` defaults to the module import.
export function createRoverDynamics(THREE_LIB = THREE, params = ROVER_PARAMS) {
  const THREE = THREE_LIB;  // eslint-disable-line no-shadow
  const P = params;
  const { w, h, l } = P.dims;
  const m = P.massKg;
  const I = new THREE.Vector3(
    (m / 12) * (h * h + l * l), // pitch
    (m / 12) * (w * w + l * l), // yaw
    (m / 12) * (w * w + h * h) // roll
  );
  const kSpring = (m * P.g) / 6 / P.sagM;
  const cCrit = 2 * Math.sqrt(kSpring * (m / 6));
  const cBump = cCrit * P.dampingZeta * P.bumpRatio;
  const cRebound = cCrit * P.dampingZeta * P.reboundRatio;
  const staticLen = P.restLen - P.sagM;
  const mountY = P.wheelRadius + staticLen; // top strut mount, model coords, at rest

  const wheels = [];
  for (let a = 0; a < 3; a++) {
    for (const side of [-1, 1]) {
      wheels.push({
        lx: side * P.trackHalfW,
        lz: P.axleZ[a],
        axle: a,
        comp: P.sagM,
        compVel: 0,
        contact: true,
        load: 0,
        steer: 0,
        omega: 0,
        angle: 0,
        slip: 0,
        hubY: P.wheelRadius, // hub height in model coords (for the rig)
        worldHubY: P.wheelRadius,
        groundY: 0,
      });
    }
  }

  const st = {
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    q: new THREE.Quaternion(),
    angVel: new THREE.Vector3(),
    pedal: 0,
    brake: 0,
    steerCmd: 0,
    batteryKWh: P.batteryKWh,
    odometerM: 0,
    powerW: 0,
    powerKw: 0,
    mechPowerW: 0,
    mechPowerKw: 0,
    maxPowerW: P.powerW,
    maxPowerKw: (P.powerW || 0) / 1000,
    hp: 0,
    maxHp: P.maxHp || P.powerW / WATTS_PER_HP,
    motorRpm: 0,
    torquePct: 0,
    wheelTorqueNm: 0,
    motorTorqueNm: 0,
    maxWheelTorqueNm: P.wheelTorqueMaxNm || P.wheelForceMaxN * P.wheelRadius,
    maxMotorTorqueNm:
      P.motorTorqueMaxNm || (P.wheelForceMaxN * P.wheelRadius) / (P.gearRatio * P.driveEfficiency),
    massKg: m,
    weightN: m * P.g,
    normalLoadN: m * P.g,
    powerToWeightHpPerTon: (((P.maxHp || P.powerW / WATTS_PER_HP) * 1000) / m),
    powerToWeightKwPerTon: (P.powerW || 0) / m,
    gradeForceN: 0,
    rollingResistanceN: 0,
    vLong: 0,
    vLat: 0,
    airborne: false,
    airTime: 0,
    landingImpact: 0,
    gear: "N",
    tractionLimited: false,
    selfRighting: false,
    accel: 0,
  };

  // scratch
  const up = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const mountW = new THREE.Vector3();
  const r = new THREE.Vector3();
  const vPoint = new THREE.Vector3();
  const wf = new THREE.Vector3();
  const ws = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const F = new THREE.Vector3();
  const force = new THREE.Vector3();
  const torque = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const qInv = new THREE.Quaternion();
  const wBody = new THREE.Vector3();
  const Iw = new THREE.Vector3();
  const gyro = new THREE.Vector3();
  const dq = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  const cgLocal = new THREE.Vector3(0, P.cgY, P.cgZ);
  const cgWorld = new THREE.Vector3();
  const cNrm = new THREE.Vector3();
  const stabAxis = new THREE.Vector3();
  const stabUp = new THREE.Vector3();
  const wheelStepData = wheels.map((wh) => ({
    wh,
    fs: 0,
    cx: 0,
    cy: 0,
    cz: 0,
    r: new THREE.Vector3(),
    nrm: new THREE.Vector3(),
  }));
  const avgInertia = (I.x + I.z) * 0.5;
  const antiRollK = (P.antiRollRatio ?? 0.62) * kSpring;
  const antiRollC = (P.antiRollRatio ?? 0.62) * 0.35 * cBump;
  let tippedT = 0;
  const tireHalfW = P.tireHalfWidth || Math.max(0.04, P.wheelRadius * 0.45);
  const minStrutLen = P.restLen * 0.05;
  const ps = P.probeScale || 1;
  // belly, bumper, rocker, and roof probes scaled to the active vehicle's actual chassis footprint
  const probe = (() => {
    const hl = (P.dims?.l || 4.6) * 0.5;
    const hw = (P.dims?.w || 2.6) * 0.5;
    const a0 = P.axleZ[0];
    const a1 = P.axleZ[1];
    const a2 = P.axleZ[2];
    const zFront = P.probeScale ? -2.25 * ps : Math.min(-hl * 0.96, a0 - P.wheelRadius * 0.85);
    const zRear = P.probeScale ? 2.3 * ps : Math.max(hl * 0.96, a2 + P.wheelRadius * 0.85);
    const xSide = P.probeScale ? 0.9 * ps : Math.min(P.trackHalfW * 0.85, hw * 0.72);
    const xBumper = xSide * 0.9;
    const xRoof = P.probeScale ? 1.1 * ps : Math.min(P.trackHalfW * 0.95, hw * 0.82);
    const byLow = P.probeScale ? 0.55 * ps : 0.52;
    const byBumper = P.probeScale ? 0.62 * ps : 0.58;
    const byRoof = P.probeScale ? 1.8 * ps : Math.max(1.75, (P.dims?.h || 2.2) * 0.72);
    const pts = [
      [-xBumper, byBumper, zFront],
      [0, byBumper, zFront],
      [xBumper, byBumper, zFront],
      [-xBumper, byBumper, zRear],
      [0, byBumper, zRear],
      [xBumper, byBumper, zRear],
    ];
    for (const z of [zFront * 0.55 + a0 * 0.45, 0.5 * (a0 + a1), a1, 0.5 * (a1 + a2), zRear * 0.55 + a2 * 0.45]) {
      pts.push([-xSide, byLow, z], [0, byLow, z], [xSide, byLow, z]);
    }
    pts.push(
      [-xRoof, byRoof, a0 * 1.1],
      [xRoof, byRoof, a0 * 1.1],
      [-xRoof, byRoof, a1],
      [xRoof, byRoof, a1],
      [-xRoof, byRoof, a2 * 1.05],
      [xRoof, byRoof, a2 * 1.05],
      [0, byRoof * 1.08, P.cgZ]
    );
    return pts;
  })();

  function sampleWheelFootprintY(sampleY, hx, hz, steerRad) {
    const g0 = sampleY(hx, hz);
    const cs = Math.cos(steerRad);
    const sn = Math.sin(steerRad);
    // Wheel axis (lateral across dual/wide tire) and rolling axis in world XZ
    const axX = right.x * cs + fwd.x * sn;
    const axZ = right.z * cs + fwd.z * sn;
    const fwX = fwd.x * cs - right.x * sn;
    const fwZ = fwd.z * cs - right.z * sn;
    const gL = sampleY(hx - axX * tireHalfW, hz - axZ * tireHalfW);
    const gR = sampleY(hx + axX * tireHalfW, hz + axZ * tireHalfW);
    const chord = P.wheelRadius * 0.38;
    const arcRise = P.wheelRadius * 0.08;
    const gF = sampleY(hx + fwX * chord, hz + fwZ * chord) - arcRise;
    const gB = sampleY(hx - fwX * chord, hz - fwZ * chord) - arcRise;
    return Math.max(g0, gL, gR, gF, gB);
  }

  /** Put the rover at rest on the ground at (x, z), facing yaw. */
  function reset(x, z, yaw, sampleY) {
    // sit the body on the plane through the six wheel spots, so no wheel starts buried
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    // plane through the six wheel spots (least squares on heights relative to their mean, so the
    // absolute terrain elevation does not matter)
    const hs = [];
    for (const wh of wheels) {
      hs.push(sampleY(x + cy * wh.lx + sy * wh.lz, z - sy * wh.lx + cy * wh.lz));
    }
    const mean = hs.reduce((u, v) => u + v, 0) / hs.length;
    let shx = 0;
    let shz = 0;
    let sxx = 0;
    let szz = 0;
    wheels.forEach((wh, i) => {
      const dz = wh.lz - P.cgZ;
      shx += (hs[i] - mean) * wh.lx;
      shz += (hs[i] - mean) * dz;
      sxx += wh.lx * wh.lx;
      szz += dz * dz;
    });
    const slopeX = shx / sxx; // rise per metre to the right
    const slopeZ = shz / szz; // rise per metre to the back
    const pitch = Math.atan(-slopeZ); // nose up when the ground rises ahead (-Z)
    const roll = Math.atan(slopeX); // right side up when the ground rises to the right
    st.q.setFromEuler(euler.set(pitch, yaw, roll, "YXZ"));
    st.pos.set(x, mean - slopeZ * (0 - P.cgZ), z);
    st.vel.set(0, 0, 0);
    st.angVel.set(0, 0, 0);
    st.pedal = 0;
    st.brake = 0;
    st.steerCmd = 0;
    st.airborne = false;
    st.selfRighting = false;
    tippedT = 0;
    for (const wh of wheels) {
      wh.comp = P.sagM;
      wh.compVel = 0;
      wh.omega = 0;
      wh.steer = 0;
      wh.hubY = P.wheelRadius;
    }
  }

  function wheelSteerAngles(steerCmd) {
    // four-wheel Ackermann: front and rear wheels steer opposite, mid wheels stay straight; the
    // turning centre sits on the mid axle line, so every wheel rolls on its own circle
    const zc = P.axleZ[1];
    const a = zc - P.axleZ[0];
    const d = steerCmd * P.steerMaxRad;
    if (Math.abs(d) < 1e-4) {
      for (const wh of wheels) wh.steer = 0;
      return;
    }
    const R = a / Math.tan(d); // signed; left turn > 0
    for (const wh of wheels) wh.steer = Math.atan((zc - wh.lz) / (R + wh.lx));
  }

  function substep(dt, inp, env) {
    const { sampleY, sampleNormal } = env;
    up.set(0, 1, 0).applyQuaternion(st.q);
    fwd.set(0, 0, -1).applyQuaternion(st.q);
    right.set(1, 0, 0).applyQuaternion(st.q);
    cgWorld.copy(cgLocal).applyQuaternion(st.q).add(st.pos);

    force.set(0, -m * P.g, 0);
    torque.set(0, 0, 0);

    // vehicle speed along its heading (for the motor, governor and gear readout)
    const vLong = st.vel.dot(fwd);
    st.vLong = vLong;
    st.vLat = st.vel.dot(right);
    const speed = Math.abs(vLong);

    // pedals: W forward, S brake then reverse once stopped, Space handbrake
    const wantFwd = inp.throttle > 0;
    const wantBack = inp.throttle < 0;
    let pedalTarget = 0;
    let brakeTarget = 0;
    if (wantFwd) {
      if (vLong < -0.35) brakeTarget = 1;
      else pedalTarget = inp.throttle;
    } else if (wantBack) {
      if (vLong > 0.35) brakeTarget = -inp.throttle;
      else pedalTarget = inp.throttle; // reverse
    }
    // pressing goes in at pedalRate per second; lifting off is quicker
    const pressing = Math.abs(pedalTarget) > Math.abs(st.pedal) && Math.sign(pedalTarget) !== -Math.sign(st.pedal);
    const pr = (pressing ? P.pedalRate : 5) * dt;
    st.pedal += Math.max(-pr, Math.min(pr, pedalTarget - st.pedal));
    if (Math.abs(st.pedal) < 1e-3 && pedalTarget === 0) st.pedal = 0;
    st.brake += (brakeTarget - st.brake) * Math.min(1, dt * 8);
    st.gear = st.pedal < -0.02 || (vLong < -0.2 && !wantFwd) ? "R" : st.pedal > 0.02 || vLong > 0.2 ? "D" : "N";

    // steering rack with speed-sensitive lock (preserves mid/high-speed turn-in while smoothing 40+ km/h lock)
    const lockScale = 1 / (1 + speed / 10.5);
    const steerTarget = Math.max(-1, Math.min(1, inp.steer)) * lockScale;
    const sr = (P.steerRate / P.steerMaxRad) * dt;
    st.steerCmd += Math.max(-sr, Math.min(sr, steerTarget - st.steerCmd));
    wheelSteerAngles(st.steerCmd);

    // motor torque & power demand for the whole vehicle (6 in-hub motors + planetary reduction)
    const boost = Boolean(inp.boost);
    const rawMult = Number(inp.speedMultiplier);
    const speedMult = Number.isFinite(rawMult) ? Math.max(0.3, Math.min(4.0, rawMult)) : 1;
    const vCap = (st.pedal >= 0 ? (boost ? P.vMaxBoost : P.vMax) : P.vMaxReverse) * speedMult;
    const governor = Math.max(0, Math.min(1, (vCap - speed) / 0.8));
    const baseWheelTorqueMaxNm =
      Number.isFinite(P.wheelTorqueMaxNm) && P.wheelTorqueMaxNm > 0
        ? P.wheelTorqueMaxNm
        : Number.isFinite(P.motorTorqueMaxNm) && P.motorTorqueMaxNm > 0
          ? P.motorTorqueMaxNm * P.gearRatio * P.driveEfficiency
          : P.wheelForceMaxN * P.wheelRadius;
    const climbSlope = boost && st.pedal > 0.05 ? Math.max(0, Math.min(1, (fwd.y - 0.04) / 0.26)) : 0;
    const boostTorqueMult = boost ? 1.45 : 1.0;
    const maxWheelTorqueNm = baseWheelTorqueMaxNm * speedMult * boostTorqueMult;
    const wheelForceMaxN = maxWheelTorqueNm / P.wheelRadius;
    const availPowerW = (boost ? P.boostPowerW * (1 + climbSlope * 0.5) : P.powerW) * speedMult;
    const wheelOmegaEff = Math.max(0.5 / P.wheelRadius, speed / P.wheelRadius);
    const powerCapTorqueNm = availPowerW / wheelOmegaEff;
    const commandedTorqueNm = Math.min(maxWheelTorqueNm, powerCapTorqueNm) * Math.abs(st.pedal) * governor * Math.sign(st.pedal);
    const driveTotal = commandedTorqueNm / P.wheelRadius;
    const coastRegen = st.pedal === 0 && st.brake < 0.05 ? -Math.sign(vLong) * Math.min(1, speed / 0.6) * m * P.regenCoastG : 0;

    let contacts = 0;
    let totalNormalLoad = 0;
    let totalRollingDrag = 0;
    let maxHardPen = 0;
    const minLen = P.restLen * 0.05;
    const softZone = P.maxComp * 0.78;
    const allowWheelRays = up.y > 0.15;

    // Pass 1: strut geometry & base spring-damper forces (+ progressive hydraulic bump-stop)
    for (let wi = 0; wi < wheels.length; wi++) {
      const wh = wheels[wi];
      const wd = wheelStepData[wi];
      wd.fs = 0;
      if (!allowWheelRays) {
        wh.contact = false;
        wh.comp += (0 - wh.comp) * Math.min(1, dt * 18);
        wh.compVel = 0;
        wh.load = 0;
        wh.slip = 0;
        wh.omega *= Math.exp(-dt * 2);
        wh.hubY = mountY - (P.restLen - wh.comp);
        continue;
      }

      // strut top in world space
      mountW.set(wh.lx, mountY, wh.lz).applyQuaternion(st.q).add(st.pos);
      // hub along the strut until the tyre footprint touches the ground (two passes to follow the slope)
      let len = P.restLen;
      let gy = 0;
      for (let k = 0; k < 2; k++) {
        const hx = mountW.x - up.x * len;
        const hz = mountW.z - up.z * len;
        gy = sampleWheelFootprintY(sampleY, hx, hz, wh.steer);
        len = Math.min(P.restLen, (mountW.y - gy - P.wheelRadius) / Math.max(0.3, up.y));
      }
      if (up.y > 0.45 && len < minLen) {
        maxHardPen = Math.max(maxHardPen, (minLen - len) * up.y - 0.015);
      }
      const clampedLen = Math.max(minLen, len);
      const comp = P.restLen - clampedLen; // a strut cannot shorten past its body
      const prevComp = wh.comp;
      if (comp <= 0) {
        wh.contact = false;
        wh.comp += (0 - wh.comp) * Math.min(1, dt * 30); // wheel drops to full droop
        wh.compVel = 0;
        wh.load = 0;
        wh.slip = 0;
        wh.omega *= Math.exp(-dt * 0.3);
        wh.hubY = mountY - (P.restLen - wh.comp);
        continue;
      }
      contacts++;
      wh.contact = true;
      wh.comp = comp;
      wh.compVel = Math.max(-4, Math.min(4, (comp - prevComp) / dt));
      wh.hubY = mountY - clampedLen;

      // contact point and terrain normal
      wd.cx = mountW.x - up.x * (len + P.wheelRadius);
      wd.cy = mountW.y - up.y * (len + P.wheelRadius);
      wd.cz = mountW.z - up.z * (len + P.wheelRadius);
      const n = sampleNormal(wd.cx, wd.cz);
      wd.nrm.set(n.x, n.y, n.z);

      // spring + damper (+ progressive hydraulic cushion & bump stop), never pulling downward
      const cDamp = wh.compVel > 0 ? cBump : cRebound;
      let fs = kSpring * comp + cDamp * wh.compVel;
      if (comp > softZone) {
        const z = comp - softZone;
        fs += kSpring * 2.2 * z + cDamp * 0.35 * Math.max(0, wh.compVel);
      }
      if (comp > P.maxComp) {
        fs += kSpring * 12 * (comp - P.maxComp) + cCrit * 1.5 * Math.max(0, wh.compVel);
      }
      wd.fs = Math.max(0, fs);
    }

    // Per-axle anti-roll (sway) bars keep the chassis flat & planted during high-grip cornering
    for (let a = 0; a < 3; a++) {
      const L = wheelStepData[a * 2];
      const R = wheelStepData[a * 2 + 1];
      if (!L.wh.contact && !R.wh.contact) continue;
      const rollDiff = R.wh.comp - L.wh.comp;
      const rollDiffVel = R.wh.compVel - L.wh.compVel;
      const arb = antiRollK * rollDiff + antiRollC * rollDiffVel;
      if (L.wh.contact) L.fs = Math.max(0, L.fs - arb);
      if (R.wh.contact) R.fs = Math.max(0, R.fs + arb);
    }

    // Active Electronic Stability Control (ESC): gently tempers lateral peak forces near heavy body roll
    // so aggressive high-grip cornering slides cleanly rather than tripping into a rollover.
    const rollExcess = Math.max(0, 0.88 - up.y);
    const escLatScale = rollExcess > 0 ? Math.max(0.55, 1 - rollExcess * 2.1) : 1;

    // Pass 2: tyre grip circle & suspension forces applied at each wheel contact
    for (let wi = 0; wi < wheelStepData.length; wi++) {
      const wd = wheelStepData[wi];
      const wh = wd.wh;
      if (!wh.contact) continue;
      const fs = Math.min(wd.fs, 8 * m * P.g);
      nrm.copy(wd.nrm);
      const N = fs * Math.max(0.2, up.dot(nrm));
      wh.load = N;
      totalNormalLoad += N;

      r.set(wd.cx, wd.cy, wd.cz).sub(cgWorld);
      vPoint.crossVectors(st.angVel, r).add(st.vel);

      // wheel heading on the ground plane
      wf.copy(fwd).multiplyScalar(Math.cos(wh.steer)).addScaledVector(right, -Math.sin(wh.steer));
      wf.addScaledVector(nrm, -wf.dot(nrm)).normalize();
      ws.crossVectors(wf, nrm).normalize(); // to the wheel's right
      const vl = vPoint.dot(wf);
      const vs = vPoint.dot(ws);

      // longitudinal: drive, coast regen, brakes, handbrake (rear axle), rolling resistance
      let fl = (driveTotal + coastRegen) / 6;
      const brakeN = st.brake * P.brakeForceN / 6;
      fl -= brakeN * Math.max(-1, Math.min(1, vl / 0.15));
      if (inp.handbrake && wh.axle === 2) fl -= P.muSlide * N * Math.max(-1, Math.min(1, vl / 0.08));
      const rollDrag = P.rollingCrr * N * Math.max(-1, Math.min(1, vl / 0.25));
      fl -= rollDrag;
      totalRollingDrag += Math.abs(rollDrag);
      // parking hold: no pedal and nearly stopped -> the motors hold the rover on a slope
      if (st.pedal === 0 && Math.abs(vLong) < 0.12 && !inp.handbrake) fl -= P.mu * N * Math.max(-1, Math.min(1, vl / 0.04));

      // lateral: crisp slip angle, saturating at full regolith grouser grip
      const alpha = Math.atan2(vs, Math.abs(vl) + 0.35);
      const latMu = P.mu * escLatScale;
      let fsLat = -latMu * N * Math.max(-1, Math.min(1, alpha * P.corneringB));

      // friction circle
      const mu = inp.handbrake && wh.axle === 2 ? P.muSlide : P.mu;
      const cap = mu * N;
      const mag = Math.hypot(fl, fsLat);
      wh.slip = cap > 1 ? Math.min(1, mag / cap) : 0;
      let spinExtra = 0;
      if (mag > cap && mag > 1e-6) {
        const s = cap / mag;
        if (Math.abs(fl) * s < Math.abs(fl) && Math.abs(driveTotal) > 0) spinExtra = Math.sign(fl) * (1 - s) * 6;
        fl *= s;
        fsLat *= s;
      }

      F.copy(nrm).multiplyScalar(N).addScaledVector(wf, fl).addScaledVector(ws, fsLat);
      force.add(F);
      torque.add(tmp.crossVectors(r, F));

      // wheel spin for the rig (rolling, plus wheelspin when traction-limited, locked by handbrake)
      const locked = inp.handbrake && wh.axle === 2;
      const targetOmega = locked ? 0 : vl / P.wheelRadius + spinExtra;
      wh.omega += (targetOmega - wh.omega) * Math.min(1, dt * 25);
    }

    // chassis / belly / roof against the terrain: normal-aware penalty + hard floor
    for (const [bx, by, bz] of probe) {
      tmp.set(bx, by, bz).applyQuaternion(st.q).add(st.pos);
      const gy = sampleY(tmp.x, tmp.z);
      const pen = gy - tmp.y;
      if (pen <= 0) continue;
      maxHardPen = Math.max(maxHardPen, pen - 0.015);
      r.copy(tmp).sub(cgWorld);
      vPoint.crossVectors(st.angVel, r).add(st.vel);
      const pn = env.sampleNormal(tmp.x, tmp.z);
      const nny = Math.max(0.42, pn.y);
      const invN = 1 / Math.hypot(pn.x, nny, pn.z);
      const nx = pn.x * invN;
      const ny = nny * invN;
      const nz = pn.z * invN;
      const vn = vPoint.x * nx + vPoint.y * ny + vPoint.z * nz;
      const fn = Math.max(0, m * 55 * pen - m * 8 * Math.min(0, vn));
      const vtx = vPoint.x - vn * nx;
      const vty = vPoint.y - vn * ny;
      const vtz = vPoint.z - vn * nz;
      const vt = Math.hypot(vtx, vty, vtz);
      const ft = vt > 1e-4 ? Math.min(0.45 * fn, m * 2.5 * vt) / vt : 0;
      F.set(nx * fn - vtx * ft, ny * fn - vty * ft, nz * fn - vtz * ft);
      force.add(F);
      torque.add(tmp.crossVectors(r, F));
    }

    // Active Rollover Prevention & Automatic Self-Righting Gyro Recovery:
    //  - Above ~28 deg relative tilt (during aggressive turns/impacts), progressive CMG stabilization torque resists flipping.
    //  - If knocked onto a side/roof (up.y < 0.45), automatically clears ground & smoothly rotates upright onto all 6 wheels.
    const cn = sampleNormal(st.pos.x, st.pos.z);
    cNrm.set(cn.x, cn.y, cn.z).normalize();
    stabUp.set(cNrm.x * 0.45, Math.max(0.72, cNrm.y), cNrm.z * 0.45).normalize();
    const hasDriverInput = Math.abs(inp.throttle) > 0.05 || Math.abs(inp.steer) > 0.05 || Boolean(inp.handbrake);

    if (up.y < 0.45) {
      tippedT += dt;
      if (tippedT > (hasDriverInput ? 0.08 : 0.35)) {
        st.selfRighting = true;
      }
    } else if (st.selfRighting && up.y < 0.88) {
      // Keep righting until squarely back upright
    } else {
      tippedT = 0;
      st.selfRighting = false;
    }

    if (st.selfRighting) {
      stabAxis.crossVectors(up, stabUp);
      if (stabAxis.lengthSq() < 1e-4) {
        // Exactly 180 deg inverted: roll sideways cleanly along longitudinal axis
        stabAxis.copy(fwd);
      }
      stabAxis.normalize();
      // Righting angular velocity target + damping (scale-invariant via avgInertia)
      const alignRate = 18.0;
      const angDamp = 6.5;
      torque.addScaledVector(stabAxis, avgInertia * alignRate);
      torque.addScaledVector(st.angVel, -avgInertia * angDamp);
      // Lift gently if roof/side is pinned to terrain so flipping back over doesn't snag underground
      const floorY = sampleY(st.pos.x, st.pos.z);
      const minFlipClearanceY = floorY + Math.max(P.cgY, P.wheelRadius * 1.15) + 0.16;
      if (cgWorld.y < minFlipClearanceY) {
        const liftGap = minFlipClearanceY - cgWorld.y;
        force.y += m * P.g + m * 24 * liftGap - m * 6 * st.vel.y;
      }
      st.vel.x *= Math.exp(-dt * 2.5);
      st.vel.z *= Math.exp(-dt * 2.5);
    } else {
      const tiltDot = up.dot(cNrm);
      const steepExcess = Math.max(0, 0.86 - tiltDot) + Math.max(0, 0.82 - up.y) * 1.35;
      if (steepExcess > 0) {
        stabAxis.crossVectors(up, stabUp);
        if (stabAxis.lengthSq() > 1e-6) {
          stabAxis.normalize();
          const kStab = Math.min(18.0, steepExcess * 28.0);
          torque.addScaledVector(stabAxis, avgInertia * kStab);
          // Dampen roll/pitch spin velocity without fighting steering yaw around stabUp
          const wYaw = st.angVel.dot(stabUp);
          tmp.copy(st.angVel).addScaledVector(stabUp, -wYaw);
          torque.addScaledVector(tmp, -avgInertia * (3.2 + steepExcess * 6.0));
        }
      }
    }

    st.airborne = contacts === 0;
    // wheelspin light: the motors ask for more than at least two tyres can put down
    let spinning = 0;
    for (const wh of wheels) if (wh.contact && wh.slip >= 0.999) spinning++;
    st.tractionLimited = Math.abs(driveTotal) > 1 && spinning >= 2;

    // integrate (semi-implicit Euler)
    const prevVY = st.vel.y;
    st.vel.addScaledVector(force, dt / m);
    st.accel = (st.vel.dot(fwd) - vLong) / dt;
    // angular: body-frame Euler equations
    qInv.copy(st.q).invert();
    tmp.copy(torque).applyQuaternion(qInv);
    wBody.copy(st.angVel).applyQuaternion(qInv);
    Iw.set(I.x * wBody.x, I.y * wBody.y, I.z * wBody.z);
    gyro.crossVectors(wBody, Iw);
    wBody.x += ((tmp.x - gyro.x) / I.x) * dt;
    wBody.y += ((tmp.y - gyro.y) / I.y) * dt;
    wBody.z += ((tmp.z - gyro.z) / I.z) * dt;
    wBody.multiplyScalar(Math.exp(-dt * 0.15)); // a little structural / air damping
    st.angVel.copy(wBody).applyQuaternion(st.q);
    // move the centre of mass, turn the body about it, then put the model origin back under it
    cgWorld.addScaledVector(st.vel, dt);
    const ang = st.angVel.length() * dt;
    if (ang > 1e-9) {
      dq.setFromAxisAngle(tmp.copy(st.angVel).normalize(), ang);
      st.q.premultiply(dq).normalize();
    }
    st.pos.copy(cgWorld).sub(tmp.copy(cgLocal).applyQuaternion(st.q));
    if (maxHardPen > 0) {
      const pushY = Math.min(maxHardPen, 4.0);
      st.pos.y += pushY;
      cgWorld.y += pushY;
      if (st.vel.y < 0) st.vel.y *= 0.15;
      st.airborne = false;
    }

    // Post-integration wheel & chassis floor constraint:
    // Re-evaluate wheel hub heights at the integrated pose so wheels never clip through the floor
    // on slopes, crests, or hard landings, and prevent the chassis from sinking past bump stops.
    up.set(0, 1, 0).applyQuaternion(st.q);
    fwd.set(0, 0, -1).applyQuaternion(st.q);
    right.set(1, 0, 0).applyQuaternion(st.q);
    let maxFloorLift = 0;
    for (let wi = 0; wi < wheels.length; wi++) {
      const wh = wheels[wi];
      if (up.y <= 0.15) continue;
      mountW.set(wh.lx, mountY, wh.lz).applyQuaternion(st.q).add(st.pos);
      const estLen = P.restLen - wh.comp;
      const hx = mountW.x - up.x * estLen;
      const hz = mountW.z - up.z * estLen;
      const gy = sampleWheelFootprintY(sampleY, hx, hz, wh.steer);
      const reqLen = (mountW.y - gy - P.wheelRadius) / Math.max(0.3, up.y);
      if (reqLen < minStrutLen) {
        maxFloorLift = Math.max(maxFloorLift, (minStrutLen - reqLen) * Math.max(0.3, up.y));
      }
    }
    // Also ensure the central belly never penetrates underground
    tmp.set(0, 0.35 * ps, P.cgZ).applyQuaternion(st.q).add(st.pos);
    const bellyFloorPen = sampleY(tmp.x, tmp.z) - tmp.y;
    if (bellyFloorPen > 0) maxFloorLift = Math.max(maxFloorLift, bellyFloorPen);

    if (maxFloorLift > 0) {
      st.pos.y += maxFloorLift;
      cgWorld.y += maxFloorLift;
      if (st.vel.y < 0) st.vel.y *= 0.2;
      st.airborne = false;
    }

    // Finalize visual hubY for the integrated pose so rendered wheels sit cleanly on the surface
    for (let wi = 0; wi < wheels.length; wi++) {
      const wh = wheels[wi];
      if (up.y <= 0.15) continue;
      mountW.set(wh.lx, mountY, wh.lz).applyQuaternion(st.q).add(st.pos);
      const estLen = P.restLen - wh.comp;
      const hx = mountW.x - up.x * estLen;
      const hz = mountW.z - up.z * estLen;
      const gy = sampleWheelFootprintY(sampleY, hx, hz, wh.steer);
      const reqLen = (mountW.y - gy - P.wheelRadius) / Math.max(0.3, up.y);
      const finalLen = wh.contact || maxFloorLift > 0 ? Math.max(minStrutLen, Math.min(P.restLen, reqLen)) : P.restLen;
      wh.hubY = mountY - finalLen;
      wh.worldHubY = mountW.y - finalLen * up.y;
      wh.groundY = gy;
    }

    if (st.airborne) st.airTime += dt;
    else {
      if (st.airTime > 0.15) st.landingImpact = Math.max(st.landingImpact, -prevVY);
      st.airTime = 0;
    }

    // telemetry: RPM, Torque (N·m), Horsepower (HP & kW), and Weight / Normal Load (N)
    let wSum = 0;
    let driven = 0;
    for (const wh of wheels) {
      wh.angle -= wh.omega * dt;
      if (wh.contact) {
        wSum += Math.abs(wh.omega);
        driven++;
      }
    }
    const wheelOmega = driven ? wSum / driven : Math.abs(vLong) / P.wheelRadius;
    const baseRpm = (wheelOmega * 60 * P.gearRatio) / (2 * Math.PI);
    const slipDemand = boost && st.tractionLimited ? 0.55 : 0;
    const climbDemand = boost && st.pedal > 0.05 ? Math.max(climbSlope, slipDemand) : 0;
    const climbBoostRpm = climbDemand > 0 ? (3100 + 1900 * climbDemand) * Math.min(1, st.pedal * 1.15) : 0;
    const targetRpm = Math.min(5000, Math.max(baseRpm * (1 + 0.25 * climbSlope), climbBoostRpm));
    st.motorRpm = climbDemand > 0 || st.motorRpm > baseRpm + 20 ? st.motorRpm + (targetRpm - st.motorRpm) * Math.min(1, dt * 8) : targetRpm;
    const tractive = driveTotal + coastRegen;
    st.torquePct = Math.max(-1, Math.min(1, tractive / Math.max(1, wheelForceMaxN)));
    st.maxWheelTorqueNm = maxWheelTorqueNm;
    st.maxMotorTorqueNm = maxWheelTorqueNm / (P.gearRatio * P.driveEfficiency);
    st.wheelTorqueNm = tractive * P.wheelRadius;
    st.motorTorqueNm = st.wheelTorqueNm / (P.gearRatio * P.driveEfficiency);
    const mech = tractive * vLong;
    st.mechPowerW = mech;
    st.mechPowerKw = mech / 1000;
    st.hp = Math.abs(mech) / WATTS_PER_HP;
    st.maxPowerW = availPowerW;
    st.maxPowerKw = availPowerW / 1000;
    st.maxHp = availPowerW / WATTS_PER_HP;
    st.powerToWeightHpPerTon = (st.maxHp * 1000) / m;
    st.powerToWeightKwPerTon = st.maxPowerW / m;
    st.normalLoadN = totalNormalLoad;
    st.gradeForceN = -m * P.g * fwd.y;
    st.rollingResistanceN = totalRollingDrag;
    st.powerW = (mech >= 0 ? mech / P.driveEfficiency : mech * P.regenEfficiency) + P.hotelW;
    st.powerKw = st.powerW / 1000;
    st.batteryKWh = Math.max(0, Math.min(P.batteryKWh, st.batteryKWh - (st.powerW * dt) / 3.6e6));
    st.odometerM += Math.abs(vLong) * dt;
  }

  /**
   * @param {number} dt frame time (s)
   * @param {{throttle:number, steer:number, boost:boolean, handbrake:boolean, speedMultiplier?:number, park?:boolean}} inp
   *   steer > 0 = left. `park: true` marks a rover nobody drives: once it has settled on its springs
   *   it sleeps (no substeps) until it is moved, reset, driven, or the ground under it changes.
   * @param {{sampleY:(x:number,z:number)=>number, sampleNormal:(x:number,z:number)=>{x:number,y:number,z:number}}} env
   * @returns {boolean} false when the rover slept through this call (its pose did not change)
   */
  let acc = 0;
  let asleep = false;
  let restT = 0;
  let sleepCheckT = 0;
  let sleepGroundY = 0;
  let sleepGroundF = 0;
  let sleepGroundR = 0;
  function sampleSleepEndY(env, isFront) {
    fwd.set(0, 0, -1).applyQuaternion(st.q);
    const along = isFront ? Math.abs(P.axleZ[0]) + P.wheelRadius : -(Math.abs(P.axleZ[2]) + P.wheelRadius);
    return env.sampleY(st.pos.x + fwd.x * along, st.pos.z + fwd.z * along);
  }
  function wake() {
    asleep = false;
    restT = 0;
  }
  function step(dt, inp, env) {
    st.landingImpact = 0;
    const frameDt = Math.min(0.1, Math.max(0, dt));
    if (asleep) {
      if (inp.park !== true) wake();
      else {
        // terrain detail can stream in under a parked rover: check center, front, and rear twice a second
        sleepCheckT += frameDt;
        if (sleepCheckT < 0.5) return false;
        sleepCheckT = 0;
        const gC = env.sampleY(st.pos.x, st.pos.z);
        const gF = sampleSleepEndY(env, true);
        const gR = sampleSleepEndY(env, false);
        if (
          Math.abs(gC - sleepGroundY) < 0.02 &&
          Math.abs(gF - sleepGroundF) < 0.02 &&
          Math.abs(gR - sleepGroundR) < 0.02
        ) {
          return false;
        }
        wake();
      }
    }
    acc = Math.min(acc + frameDt, 0.1);
    let n = 0;
    while (acc >= SUBSTEP && n < 30) {
      substep(SUBSTEP, inp, env);
      acc -= SUBSTEP;
      n++;
    }
    if (
      inp.park === true &&
      !st.airborne &&
      !st.selfRighting &&
      up.y > 0.72 &&
      st.vel.lengthSq() < SLEEP_SPEED_SQ &&
      st.angVel.lengthSq() < SLEEP_SPEED_SQ
    ) {
      restT += frameDt;
      if (restT > 1) {
        asleep = true;
        sleepCheckT = 0;
        sleepGroundY = env.sampleY(st.pos.x, st.pos.z);
        sleepGroundF = sampleSleepEndY(env, true);
        sleepGroundR = sampleSleepEndY(env, false);
        st.vel.set(0, 0, 0);
        st.angVel.set(0, 0, 0);
      }
    } else restT = 0;
    return true;
  }

  /** Yaw, pitch and roll (YXZ) of the chassis, for the model and the camera. */
  function attitude() {
    euler.setFromQuaternion(st.q, "YXZ");
    return { yaw: euler.y, pitch: euler.x, roll: euler.z };
  }

  return {
    state: st,
    wheels,
    params: P,
    mountY,
    staticLen,
    reset(x, z, yaw, sampleY) {
      wake();
      reset(x, z, yaw, sampleY);
    },
    step,
    get asleep() {
      return asleep;
    },
    wake,
    attitude,
    /** Rover was moved from outside (world wrap, collision push): keep velocities, keep ground clearance on the new spot. */
    setPosition(x, z, sampleY = null) {
      wake();
      st.pos.x = x;
      st.pos.z = z;
      if (typeof sampleY === "function") {
        fwd.set(0, 0, -1).applyQuaternion(st.q);
        const reachF = Math.abs(P.axleZ[0]) + P.wheelRadius * 0.5;
        const reachR = Math.abs(P.axleZ[2]) + P.wheelRadius * 0.5;
        const gC = sampleY(x, z);
        const gF = sampleY(x + fwd.x * reachF, z + fwd.z * reachF);
        const gR = sampleY(x - fwd.x * reachR, z - fwd.z * reachR);
        const minY = Math.max(gC - 0.02, Math.max(gF, gR) - (P.restLen - P.sagM) - 0.05);
        if (st.pos.y < minY) {
          st.pos.y = minY;
          if (st.vel.y < 0) st.vel.y = 0;
        }
      }
    },
    scaleVelocity(s) {
      wake();
      st.vel.x *= s;
      st.vel.z *= s;
    },
  };
}

export function stepAdvancedRoverPhysics(
  state,
  {
    spec = {},
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

  const topFwd = ((boost ? spec.boostSpeedMs : spec.topSpeedMs) || 18.5) * mult;
  const topRev = (spec.reverseSpeedMs || 10.5) * mult;
  const availPowerW = ((boost ? spec.boostPowerW : spec.powerW) || 24500) * mult;
  const maxTorqueNm = (spec.wheelTorqueMaxNm || 2639.25) * mult;
  const wheelRadiusM = Math.max(0.2, spec.wheelRadius || 0.345);
  const massKg = Math.max(400, spec.massKg || 1850);

  if (!airborne) {
    const speedFrac = Math.min(1, Math.abs(vFwd) / Math.max(1, topFwd));
    const wheelOmegaPre = Math.max(0.8, Math.abs(vFwd) / wheelRadiusM);
    const torqueAvailPre = Math.min(maxTorqueNm, availPowerW / wheelOmegaPre);
    const tractiveForceN = torqueAvailPre / wheelRadiusM;
    const torqueFactor = Math.max(1, tractiveForceN / (massKg * 2.2));
    const lowEndBoost = (1 + (1 - speedFrac) * 0.45 * (spec.slopeTorque || 1)) * Math.min(1.65, Math.sqrt(torqueFactor));
    const reversingInput = throttle !== 0 && throttle * vFwd < -0.6;

    let targetVel = 0;
    if (handbrake && throttle >= 0) {
      targetVel = vFwd * 0.72;
    } else if (throttle > 0) {
      targetVel = topFwd;
    } else if (throttle < 0) {
      targetVel = -topRev;
    }

    const rate = handbrake
      ? 2.2
      : reversingInput
        ? spec.brakeGain || 11.2
        : throttle !== 0
          ? (spec.accelGain || 6.4) * (boost ? 1.32 : 1.0) * lowEndBoost
          : 4.2;

    let nextVFwd = vFwd + (targetVel - vFwd) * Math.min(1, safeDt * rate);
    if (throttle === 0 && !handbrake && Math.abs(nextVFwd) < 0.18) nextVFwd = 0;

    if (realisticPhysics) {
      const climbAssist =
        throttle !== 0
          ? Math.min(0.65, ((spec.slopeTorque || 1) - 1) * 0.35 + (maxTorqueNm / (massKg * 3.71 * wheelRadiusM)) * 0.08)
          : 0;
      nextVFwd -= 3.71 * Math.sin(slopePitch) * (1.12 - climbAssist) * safeDt;
      vLat += 3.71 * Math.sin(slopeRoll) * 0.75 * safeDt;
    }

    const absFwd = Math.abs(nextVFwd);
    const speedAuth = Math.min(1, absFwd / 2.8) * 0.8 + 0.2;
    const turnDir = absFwd > 0.3 ? Math.sign(nextVFwd) : 0.48;
    const handbrakeYawGain = handbrake && absFwd > 4.2 ? 1.48 : 1.0;
    const targetYawRate = steer * turnDir * (spec.steerRate || 2.15) * speedAuth * handbrakeYawGain;
    state.yawRate = (state.yawRate || 0) + (targetYawRate - (state.yawRate || 0)) * Math.min(1, safeDt * 12);
    const deltaYaw = state.yawRate * safeDt;
    state.yaw = yaw0 + deltaYaw;

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
    const grip = isDrifting ? spec.driftGrip || 4.6 : handbrake ? (spec.driftGrip || 4.6) * 1.2 : spec.gripBase || 9.2;
    const dampedLat = projLat * Math.exp(-safeDt * grip);

    vx = fx1 * projFwd + rx1 * dampedLat;
    vz = fz1 * projFwd + rz1 * dampedLat;
    vFwd = projFwd;
    vLat = dampedLat;

    state.airPitchVel = ((slopePitch - (state.lastSlopePitch ?? slopePitch)) / safeDt) * 0.35;
    state.airRollVel = (state.yawRate * Math.min(1, absFwd / 12)) * 0.22;
    state.lastSlopePitch = slopePitch;
    state.drifting = isDrifting || (Math.abs(vLat) > 2.4 && Math.abs(projFwd) > 4.0);
  } else {
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

  const absSpeed = Math.abs(vFwd);
  const refTop = Math.max(8, topFwd);
  const ratio = Math.min(1.25, absSpeed / refTop);
  let gear = 1;
  let rpmNorm = 0.22;
  if (absSpeed < 0.25) {
    gear = 1;
    rpmNorm = 0.18;
  } else if (ratio < 0.28) {
    gear = 1;
    rpmNorm = 0.26 + (ratio / 0.28) * 0.66;
  } else if (ratio < 0.56) {
    gear = 2;
    rpmNorm = 0.38 + ((ratio - 0.28) / 0.28) * 0.54;
  } else if (ratio < 0.82) {
    gear = 3;
    rpmNorm = 0.44 + ((ratio - 0.56) / 0.26) * 0.48;
  } else {
    gear = 4;
    rpmNorm = Math.min(1.0, 0.52 + ((ratio - 0.82) / 0.38) * 0.48);
  }
  state.gear = gear;
  state.rpmNorm = rpmNorm;

  const wheelOmega = Math.max(0.8, absSpeed / wheelRadiusM);
  const torqueAvail = Math.min(maxTorqueNm, availPowerW / wheelOmega);
  const wheelTorqueNm = airborne ? 0 : throttle * torqueAvail;
  const motorTorqueNm = wheelTorqueNm / ((spec.gearRatio || 18) * 0.88);
  const mechPowerW = Math.abs(wheelTorqueNm * wheelOmega);
  const mechPowerKw = mechPowerW / 1000;
  const maxPowerKw = availPowerW / 1000;
  const hp = mechPowerW / WATTS_PER_HP;
  const maxHp = availPowerW / WATTS_PER_HP;
  const weightN = massKg * 3.71;
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
