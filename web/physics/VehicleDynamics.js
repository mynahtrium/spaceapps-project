/**
 * Rigid-body wheeled vehicle on a height field, under Gale crater gravity (`VehicleDynamics.js`).
 *
 * Model (fixed 240 Hz substeps):
 *  - Chassis is one rigid body: position of the centre of mass, velocity, orientation quaternion,
 *    angular velocity, diagonal inertia from the chassis box.
 *  - Each wheel is a spring-damper suspension along the chassis up axis that can only push, never
 *    pull. A wheel is in contact only when the ground is within its travel, so the vehicle leaves the
 *    ground only when the terrain falls away faster than Mars gravity can pull it down (a real crest
 *    or a drop), never because of a scripted "launch".
 *  - Tyre forces come from each wheel's own load: lateral grip from the slip angle, longitudinal
 *    drive (power- and force-limited electric motors, a speed governor), braking, rolling resistance
 *    in loose regolith, all clipped to a friction circle mu * load. Low Mars gravity means low load,
 *    so less grip and longer stopping distances than on Earth.
 *  - The chassis underside also collides with the ground (high-centring on a ridge is possible).
 *
 * Scene axes match `hud3d.js`: +X east, +Y up, +Z south; yaw 0 faces -Z.
 * Specs: see `VEHICLE_SPECS` for each number's source; estimates are labelled.
 */

import { marsGravityMs2 } from "./MarsGravityField.js";
import { MARS_GEODESY } from "./MarsConstants.js";

export const VEHICLE_DT = 1 / 240;
export const GALE_G = marsGravityMs2(MARS_GEODESY.GALE_ANCHOR_LAT_DEG, -4000);
const MAX_SUBSTEPS = 24;

// ---------- small vector / quaternion helpers (no three.js, so this runs in node tests) ----------
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
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
function qRotate(q, v) {
  // v' = q v q*
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return v3(
    ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x
  );
}
const qConjRotate = (q, v) => qRotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);
function qNormalize(q) {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  q.x /= l;
  q.y /= l;
  q.z /= l;
  q.w /= l;
}
export function quatFromYaw(yaw) {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}
/** Heading of the chassis forward axis projected on the ground plane (0 = -Z, like hud3d yaw). */
export function vehicleYaw(body) {
  const f = qRotate(body.q, v3(0, 0, -1));
  return Math.atan2(-f.x, -f.z);
}

// ---------- vehicle catalogue ----------
/**
 * Wheel layout: x (right), z (back) in chassis metres from the chassis origin (ground level under the
 * chassis centre at static ride height); `steer`: 1 front-steering, -1 rear-steering (opposite), 0 fixed.
 */
export const VEHICLE_SPECS = Object.freeze({
  sev: Object.freeze({
    id: "sev",
    nameEn: "NASA SEV pressurized rover",
    nameTr: "NASA SEV basınçlı araç",
    shortLabel: "SEV",
    // NASA facts FS-2011-08-045-JSC: 6,600 lb (2,994 kg); about 10 km/h; wheels pivot 360 deg (crab).
    massKg: 2994 + 160, // + two crew inside in plain clothes (estimate)
    topSpeedMs: 10 / 3.6,
    reverseSpeedMs: 4 / 3.6, // estimate
    powerW: 12000 * 1.75, // 21,000 W / 21.0 kW (1.75x)
    powerKw: (12000 * 1.75) / 1000,
    maxHp: (12000 * 1.75) / 745.699872,
    maxDriveForceN: 7500 * 2.25, // 16,875 N (2.25x)
    wheelTorqueMaxNm: 7500 * 2.25 * 0.345, // 5,821.875 N·m (2.25x)
    brakeForceN: 9000, // estimate
    mu: 0.55, // tyre on Mars regolith, illustrative
    rollingResistance: 0.06, // loose regolith, illustrative
    wheelRadius: 0.345, // matches the NASA 3D model pods (fact sheet: 39 in / 0.99 m wheels)
    trackHalfW: 1.339,
    axles: [-0.969, 0.37, 1.708], // from the NASA 3D model (fact sheet wheelbase: 13 ft)
    steerAxles: [1, 0, -1],
    maxSteerRad: 0.55,
    canCrab: true,
    staticSagM: 0.07,
    droopM: 0.18,
    bumpM: 0.16,
    damping: 0.55,
    comHeightM: 1.25,
    box: { halfW: 1.66, halfL: 2.42, height: 3.25, clearance: 0.42 },
    sources: "NASA SEV fact sheet FS-2011-08-045-JSC (mass, ~10 km/h, 360 deg pivoting wheels); NASA 3D Resources MMSEV model (geometry). Power, brakes, friction are estimates.",
  }),
  chariot: Object.freeze({
    id: "chariot",
    nameEn: "NASA Chariot chassis (crew rides outside)",
    nameTr: "NASA Chariot şasisi (ekip dışarıda)",
    shortLabel: "Chariot",
    // Fact sheet: the SEV chassis "Chariot" can be driven without the cabin from rotating turrets.
    massKg: 1500 + 360, // chassis mass not published: estimate; + two suited crew (app suit model 180 kg each)
    topSpeedMs: 10 / 3.6,
    reverseSpeedMs: 4 / 3.6,
    powerW: 12000 * 1.75, // 21,000 W / 21.0 kW (1.75x)
    powerKw: (12000 * 1.75) / 1000,
    maxHp: (12000 * 1.75) / 745.699872,
    maxDriveForceN: 7500 * 2.25, // 16,875 N (2.25x)
    wheelTorqueMaxNm: 7500 * 2.25 * 0.345, // 5,821.875 N·m (2.25x)
    brakeForceN: 9000,
    mu: 0.55,
    rollingResistance: 0.06,
    wheelRadius: 0.345,
    trackHalfW: 1.339,
    axles: [-0.969, 0.37, 1.708],
    steerAxles: [1, 0, -1],
    maxSteerRad: 0.55,
    canCrab: true,
    staticSagM: 0.06,
    droopM: 0.18,
    bumpM: 0.16,
    damping: 0.55,
    comHeightM: 0.8,
    box: { halfW: 1.55, halfL: 2.3, height: 1.6, clearance: 0.42 },
    sources: "NASA SEV fact sheet FS-2011-08-045-JSC (Chariot chassis driven without the cabin). Mass without the cabin is an estimate.",
  }),
  lrv: Object.freeze({
    id: "lrv",
    nameEn: "Apollo LRV-class open rover",
    nameTr: "Apollo LRV sınıfı açık araç",
    shortLabel: "LRV",
    // NASA NSSDC Apollo LRV page: 210 kg, wheelbase 2.3 m, 81.8 cm wheels, one 0.25 hp motor per wheel,
    // front and rear steering, 36 cm ground clearance. Design speed ~13 km/h (commonly cited).
    massKg: 210 + 360, // + two suited crew (app suit model 180 kg each)
    topSpeedMs: 13 / 3.6,
    reverseSpeedMs: 5 / 3.6, // estimate
    powerW: 4 * 186.4 * 1.75, // 1,304.8 W / 1.305 kW (1.75x)
    powerKw: (4 * 186.4 * 1.75) / 1000,
    maxHp: (4 * 186.4 * 1.75) / 745.699872,
    maxDriveForceN: 1150 * 2.25, // 2,587.5 N (2.25x)
    wheelTorqueMaxNm: 1150 * 2.25 * 0.409, // 1,058.29 N·m (2.25x)
    brakeForceN: 1500, // estimate
    mu: 0.6,
    rollingResistance: 0.06,
    wheelRadius: 0.409,
    trackHalfW: 0.915, // ~1.83 m tread, commonly cited (not on the NSSDC page)
    axles: [-1.15, 1.15],
    steerAxles: [1, -1],
    maxSteerRad: 0.5,
    canCrab: false,
    staticSagM: 0.06,
    droopM: 0.15,
    bumpM: 0.14,
    damping: 0.5,
    comHeightM: 0.65,
    box: { halfW: 1.0, halfL: 1.55, height: 1.15, clearance: 0.36 },
    sources: "NASA NSSDC Apollo LRV page (mass, wheelbase, wheel size, motors, steering, clearance). Apollo numbers stand in for a Mars version, which does not exist.",
  }),
});
export const VEHICLE_IDS = Object.freeze(Object.keys(VEHICLE_SPECS));

export function getVehicleSpec(id) {
  return VEHICLE_SPECS[id] || VEHICLE_SPECS.sev;
}

/** Derived constants for one spec under gravity g. */
function derive(spec, g) {
  const nWheels = spec.axles.length * 2;
  const wheelLoad = (spec.massKg * g) / nWheels;
  const k = wheelLoad / spec.staticSagM;
  const mWheel = spec.massKg / nWheels;
  const c = 2 * spec.damping * Math.sqrt(k * mWheel);
  const { halfW, halfL, height } = spec.box;
  const m = spec.massKg;
  // solid box inertia about the centre of mass (chassis axes)
  const I = v3(
    (m / 12) * ((2 * halfL) ** 2 + height ** 2), // pitch (about x)
    (m / 12) * ((2 * halfW) ** 2 + (2 * halfL) ** 2), // yaw (about y)
    (m / 12) * ((2 * halfW) ** 2 + height ** 2) // roll (about z)
  );
  const wheels = [];
  spec.axles.forEach((z, ai) => {
    for (const side of [-1, 1]) {
      wheels.push({ x: side * spec.trackHalfW, z, steerSign: spec.steerAxles[ai], side });
    }
  });
  // static-friction "anchor" for a parked / braked tyre: stiff spring to the contact point (~3 Hz)
  const kT = mWheel * 400;
  const cT = 2 * 0.8 * Math.sqrt(kT * mWheel);
  return { k, c, kBump: 12 * k, kT, cT, wheelLoad, I, wheels, nWheels };
}

/**
 * Create a vehicle body standing on the ground at (x, z) facing `yaw`.
 * @param {string} id key of VEHICLE_SPECS
 */
export function createVehicleBody(id, x, z, yaw, sampleHeight, g = GALE_G) {
  const spec = getVehicleSpec(id);
  const d = derive(spec, g);
  const body = {
    spec,
    g,
    d,
    pos: v3(),
    vel: v3(),
    q: quatFromYaw(yaw),
    w: v3(),
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
    hp: 0,
    maxHp: spec.powerW / 745.699872,
    wheelTorqueNm: 0,
    maxWheelTorqueNm: spec.maxDriveForceN * spec.wheelRadius,
    weightN: spec.massKg * g,
    lastImpact: 0,
    sleeping: false,
    stillT: 0,
  };
  placeVehicle(body, x, z, yaw, sampleHeight);
  return body;
}

/** Put the vehicle at rest on the ground (spawn, teleport). */
export function placeVehicle(body, x, z, yaw, sampleHeight) {
  const spec = body.spec;
  body.q = quatFromYaw(yaw);
  body.vel = v3();
  body.w = v3();
  body.acc = 0;
  body.sleeping = false;
  body.stillT = 0;
  // highest wheel footprint decides the ride height, so no wheel starts inside the ground
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  let top = -Infinity;
  for (const w of body.wheels) {
    const wx = x + c * w.x + s * w.z;
    const wz = z - s * w.x + c * w.z;
    top = Math.max(top, sampleHeight(wx, wz));
  }
  body.pos = v3(x, top + spec.comHeightM, z);
  for (const w of body.wheels) {
    w.s = 0;
    w.sPrev = 0;
    w.spin = w.spin || 0;
  }
}

function groundNormal(sampleHeight, x, z, e = 0.5) {
  const nx = sampleHeight(x - e, z) - sampleHeight(x + e, z);
  const nz = sampleHeight(x, z - e) - sampleHeight(x, z + e);
  return norm(v3(nx, 2 * e, nz));
}

/**
 * Advance the vehicle by `dt` seconds (fixed substeps).
 * input: { throttle -1..1, steer -1..1 (+ = left), brake bool, crab bool, speedMultiplier }
 * env:   { sampleHeight(x, z) -> ground y }
 */
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
    substep(body, input, env, VEHICLE_DT);
    body.acc -= VEHICLE_DT;
  }
  // Sleep when parked and settled, so a parked rover costs nothing and never creeps.
  if (!active && body.contacts === body.wheels.length && len(body.vel) < 0.02 && len(body.w) < 0.02) {
    body.stillT += dt;
    if (body.stillT > 1.0) {
      body.sleeping = true;
      body.vel = v3();
      body.w = v3();
    }
  } else {
    body.stillT = 0;
  }
  return body;
}

function substep(body, input, env, h) {
  const spec = body.spec;
  const d = body.d;
  const g = body.g;
  const sampleHeight = env.sampleHeight;
  const mult = Math.max(0.25, Math.min(5, Number(input.speedMultiplier) || 1));
  const throttle = Math.max(-1, Math.min(1, input.throttle || 0));
  const steerIn = Math.max(-1, Math.min(1, input.steer || 0));
  body.crab = Boolean(input.crab && spec.canCrab);

  const right = qRotate(body.q, v3(1, 0, 0));
  const up = qRotate(body.q, v3(0, 1, 0));
  const back = qRotate(body.q, v3(0, 0, 1));
  const fwd = scale(back, -1);

  // steering: slower at speed so a quick input does not flip a top-heavy rover
  const vFwd = dot(body.vel, fwd);
  const speedLimit = spec.maxSteerRad / (1 + (vFwd * vFwd) / (3.5 * 3.5));
  const targetSteer = steerIn * Math.min(spec.maxSteerRad, speedLimit);
  body.steer += Math.max(-1.2 * h, Math.min(1.2 * h, targetSteer - body.steer));

  // drive force available (motor torque, power kW/HP envelope, and speed governor)
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
  const hold = throttle === 0; // motors hold the wheels when no throttle (parking brake)
  const mechPowerW = Math.abs(driveTotal * vFwd);
  body.mechPowerW = mechPowerW;
  body.mechPowerKw = mechPowerW / 1000;
  body.maxPowerKw = power / 1000;
  body.hp = mechPowerW / 745.699872;
  body.maxHp = power / 745.699872;
  body.wheelTorqueNm = driveTotal * spec.wheelRadius;
  body.maxWheelTorqueNm = maxWheelTorqueNm;
  body.maxDriveForceN = maxDriveForceN;
  body.weightN = spec.massKg * g;
  body.powerFrac = Math.min(1, mechPowerW / power);

  // centre of mass to chassis origin (ground level under the chassis at static ride height)
  const origin = sub(body.pos, scale(up, spec.comHeightM));
  const r = spec.wheelRadius;
  const F = v3(0, -spec.massKg * g, 0);
  let T = v3();
  let contacts = 0;
  let slipSum = 0;
  let loadSum = 0;
  const driveWheels = d.nWheels;

  for (const w of body.wheels) {
    // wheel steer angle
    let steerRad = 0;
    if (body.crab) steerRad = body.steer;
    else if (w.steerSign) steerRad = body.steer * w.steerSign;
    w.steerRad = steerRad;

    const hp = add(add(origin, scale(right, w.x)), scale(back, w.z)); // hub plane point at s = -r offset
    const ground = sampleHeight(hp.x, hp.z);
    // suspension travel needed for the tyre to just touch the ground (positive = compressed)
    const uy = Math.max(0.25, up.y);
    let s = (ground + r - hp.y) / uy - r;
    w.sPrev = w.s;
    if (s < -spec.droopM) {
      w.s = -spec.droopM;
      w.contact = false;
      w.load = 0;
      continue;
    }
    w.contact = true;
    contacts++;
    const sVel = (s - w.sPrev) / h;
    let fs = d.k * s + d.wheelLoad + d.c * sVel;
    if (s > spec.bumpM) fs += d.kBump * (s - spec.bumpM) + 2 * d.c * Math.max(0, sVel); // bump stop
    w.s = Math.min(s, spec.bumpM + 0.05);
    fs = Math.max(0, fs);
    if (sVel < -3 && w.sPrev > -spec.droopM) body.lastImpact = Math.max(body.lastImpact, -sVel);
    else if (sVel > 1.5) body.lastImpact = Math.max(body.lastImpact, sVel);

    const contact = v3(hp.x, ground, hp.z);
    const n = groundNormal(sampleHeight, hp.x, hp.z);
    const load = fs * Math.max(0, dot(up, n));
    w.load = load;
    loadSum += load;

    // tyre frame on the ground plane
    const cs = Math.cos(steerRad);
    const sn = Math.sin(steerRad);
    // steering turns the wheel about the chassis up axis; +steer = left
    const wf = add(scale(fwd, cs), scale(right, -sn));
    const tf = norm(sub(wf, scale(n, dot(wf, n))));
    const tl = cross(n, tf); // points to the wheel's left
    const rc = sub(contact, body.pos);
    const vc = add(body.vel, cross(body.w, rc));
    const vLong = dot(vc, tf);
    const vLat = dot(vc, tl);

    const fMax = spec.mu * load;
    // lateral: slip angle with a smooth low-speed blend
    const alpha = Math.atan2(vLat, Math.abs(vLong) + 0.5);
    let fLat = -fMax * Math.tanh(alpha / 0.08);
    // longitudinal: drive, brakes / hold, rolling resistance
    let fLong = 0;
    if (braking) fLong = -Math.min(spec.brakeForceN / driveWheels, fMax) * Math.tanh(vLong / 0.05);
    else if (hold) fLong = -fMax * Math.tanh(vLong / 0.05);
    else {
      const tractionCap = fMax * (1 - 0.35 * Math.min(1, Math.abs(alpha) / 0.12));
      fLong = Math.max(-tractionCap, Math.min(tractionCap, driveTotal / driveWheels));
    }
    fLong -= spec.rollingResistance * load * Math.tanh(vLong / 0.1);
    // Parked or braked and nearly still: real static friction. The tyre is held to the ground point
    // where it stopped and only slides when the needed force exceeds mu * load (no slow creep).
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
        w.anchor.x = contact.x - ax * keep; // slide: the anchor follows the tyre
        w.anchor.z = contact.z - az * keep;
      }
    } else {
      w.anchor = null;
    }
    // friction circle
    const ft = Math.hypot(fLong, fLat);
    if (ft > fMax && ft > 0) {
      const k = fMax / ft;
      fLong *= k;
      fLat *= k;
    }
    w.slip = Math.min(1, Math.abs(alpha) / 0.3);
    slipSum += w.slip * load;
    w.spin += (vLong / r) * h;

    const fw = add(add(scale(up, fs), scale(tf, fLong)), scale(tl, fLat));
    F.x += fw.x;
    F.y += fw.y;
    F.z += fw.z;
    T = add(T, cross(rc, fw));
  }

  // chassis underside against the ground (high-centring on ridges, never sinking into the terrain)
  const { halfW, halfL, clearance } = spec.box;
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
    const fy = Math.max(0, kB * pen - 4 * d.c * vc.y);
    const fr = v3(-vc.x * spec.massKg * 0.8, fy, -vc.z * spec.massKg * 0.8); // scraping friction
    F.x += fr.x;
    F.y += fr.y;
    F.z += fr.z;
    T = add(T, cross(rc, fr));
  }

  // integrate linear motion
  const m = spec.massKg;
  body.vel = add(body.vel, scale(F, h / m));
  body.pos = add(body.pos, scale(body.vel, h));

  // integrate rotation in chassis axes: I dw/dt = T - w x (I w)
  const wb = qConjRotate(body.q, body.w);
  const tb = qConjRotate(body.q, T);
  const I = d.I;
  const Iw = v3(I.x * wb.x, I.y * wb.y, I.z * wb.z);
  const gyro = cross(wb, Iw);
  wb.x += ((tb.x - gyro.x) / I.x) * h;
  wb.y += ((tb.y - gyro.y) / I.y) * h;
  wb.z += ((tb.z - gyro.z) / I.z) * h;
  body.w = qRotate(body.q, wb);
  const q = body.q;
  const wx = body.w.x;
  const wy = body.w.y;
  const wz = body.w.z;
  q.x += 0.5 * (wx * q.w + wy * q.z - wz * q.y) * h;
  q.y += 0.5 * (wy * q.w + wz * q.x - wx * q.z) * h;
  q.z += 0.5 * (wz * q.w + wx * q.y - wy * q.x) * h;
  q.w += 0.5 * (-wx * q.x - wy * q.y - wz * q.z) * h;
  qNormalize(q);

  body.contacts = contacts;
  body.airborneT = contacts === 0 ? body.airborneT + h : 0;
  body.speed = Math.hypot(body.vel.x, body.vel.z);
  body.forwardSpeed = dot(body.vel, fwd);
  body.lateralSpeed = dot(body.vel, right);
  body.slipRatio = loadSum > 0 ? slipSum / loadSum : 0;
}

/** Chassis origin (ground point under the chassis at static ride height) and axes, for drawing. */
export function vehiclePose(body) {
  const up = qRotate(body.q, v3(0, 1, 0));
  const origin = sub(body.pos, scale(up, body.spec.comHeightM));
  return { origin, q: body.q, yaw: vehicleYaw(body), up };
}

/** Move the vehicle by (dx, dz) without touching its motion (world wrap, collision push-out). */
export function shiftVehicle(body, dx, dz) {
  body.pos.x += dx;
  body.pos.z += dz;
}

/** Remove the velocity component into a contact normal (horizontal), e.g. after a collision push-out. */
export function dampVehicleAlong(body, nx, nz, keep = 0.25) {
  const vn = body.vel.x * nx + body.vel.z * nz;
  if (vn < 0) {
    body.vel.x -= nx * vn * (1 - keep);
    body.vel.z -= nz * vn * (1 - keep);
  }
  body.sleeping = false;
}
