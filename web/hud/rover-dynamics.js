/**
 * Rigid-body MMSEV 6x6 dynamics with six raycast spring-damper wheels (`web/hud/rover-dynamics.js`).
 *
 * The chassis is one rigid body (position, velocity, orientation, angular velocity, box inertia).
 * Each wheel hangs on its own strut along the chassis "down" axis: the strut length comes from a
 * ray to the terrain, and the strut pushes the chassis with a spring + damper (softer in bump than in
 * rebound) and a stiff bump stop. Tyre forces act at the contact patch: drive / brake / rolling
 * resistance along the wheel, and slip-angle cornering across it, both inside one friction circle
 * (mu * load) for Martian regolith. So pitch under acceleration and braking, roll in corners, single
 * wheels climbing rocks, and flight off crests all come out of the same physics, not from scripted
 * animation.
 *
 * Drive: six in-hub electric motors with a reduction gear. Constant torque at low speed, then a power
 * limit, and a speed governor; the accelerator pedal ramps instead of snapping, so the rover gets
 * going over a few seconds (about 1 m/s^2), not instantly. Numbers are a plausible stand-in for a
 * ~3 t pressurised rover, not NASA's specification; the real MMSEV is rated around 10 km/h.
 *
 * Body frame: +X right, +Y up, -Z forward (same as the model). World: +Y up. Runs at a fixed 240 Hz.
 */

export const WATTS_PER_HP = 745.699872;

export const ROVER_PARAMS = Object.freeze({
  massKg: 2950,
  weightN: 2950 * 3.71,
  dims: { w: 2.6, h: 2.2, l: 4.6 }, // for the box inertia
  cgY: 0.95, // centre of mass above the model origin (ground at rest)
  cgZ: 0.37, // over the middle axle (the wheel set is not centred on the model origin)
  g: 3.71,
  wheelRadius: 0.345,
  tireHalfWidth: 0.22,
  wheelMassKg: 28,
  wheelInertiaKgM2: 6 * 0.5 * 28 * 0.345 * 0.345,
  trackHalfW: 1.339,
  axleZ: [-0.969, 0.37, 1.708], // front, mid, rear
  restLen: 0.5, // strut length with no load (top mount to hub)
  sagM: 0.11, // static compression
  maxComp: 0.34, // bump stop starts here
  bumpRatio: 0.72, // bump damping vs the critical-ish value
  reboundRatio: 1.3,
  dampingZeta: 0.38,
  mu: 0.58, // tyre on loose regolith (peak); sliding is a little lower
  muSlide: 0.48,
  rollingCrr: 0.075, // soft-soil rolling resistance coefficient
  corneringB: 7.5, // lateral force rises to full grip by about 8 degrees of slip
  gearRatio: 18,
  wheelForceMaxN: 3400, // whole vehicle, low-speed traction force at full pedal (~1.15 m/s^2)
  wheelTorqueMaxNm: 3400 * 0.345, // 1,173 N·m total wheel torque across 6 hub drives
  motorTorqueMaxNm: (3400 * 0.345) / (18 * 0.88), // ~74.1 N·m total motor shaft torque
  powerW: 14000,
  boostPowerW: 19000,
  maxHp: 14000 / WATTS_PER_HP, // 18.77 HP continuous
  boostHp: 19000 / WATTS_PER_HP, // 25.48 HP boost
  vMax: 20 / 3.6,
  vMaxBoost: 26 / 3.6,
  vMaxReverse: 8 / 3.6,
  brakeForceN: 9000,
  regenCoastG: 0.11, // motor drag when you lift off the pedal
  pedalRate: 1.4, // pedal travel per second (0 -> full in ~0.7 s)
  steerMaxRad: (26 * Math.PI) / 180,
  steerRate: 1.1, // rad/s at the wheel
  batteryKWh: 45,
  hotelW: 1200, // life support, avionics, heaters
  driveEfficiency: 0.88,
  regenEfficiency: 0.6,
});

/**
 * Parameters for another drivable vehicle from its spec (axles, track, wheel radius, mass, top speed):
 * the MMSEV numbers above are the reference, forces scale with mass, speeds with the top speed.
 */
export function roverParamsFor(spec) {
  if (!spec || spec.id === "mmsev") return ROVER_PARAMS;
  const k = (spec.massKg || 1850) / 1850; // relative to the MMSEV spec
  const sp = (spec.topSpeedMs || 18.5) / 18.5;
  const axleZ = (spec.axles || []).map((a) => a.z);
  const mid = axleZ.length === 3 ? axleZ[1] : ROVER_PARAMS.cgZ;
  const r = spec.wheelRadius || ROVER_PARAMS.wheelRadius;
  const massKg = Math.round(ROVER_PARAMS.massKg * k);
  const wheelForceMaxN = ROVER_PARAMS.wheelForceMaxN * k;
  const gearRatio = spec.gearRatio || ROVER_PARAMS.gearRatio;
  const eff = ROVER_PARAMS.driveEfficiency;
  const wheelTorqueMaxNm = wheelForceMaxN * r;
  const motorTorqueMaxNm = wheelTorqueMaxNm / (gearRatio * eff);
  const powerW = ROVER_PARAMS.powerW * k * sp;
  const boostPowerW = ROVER_PARAMS.boostPowerW * k * sp;
  const wheelMassKg = ROVER_PARAMS.wheelMassKg * (r / ROVER_PARAMS.wheelRadius) ** 2;
  return Object.freeze({
    ...ROVER_PARAMS,
    massKg,
    weightN: massKg * ROVER_PARAMS.g,
    wheelRadius: r,
    tireHalfWidth: Math.max(0.22, r * 0.5),
    wheelMassKg,
    wheelInertiaKgM2: 6 * 0.5 * wheelMassKg * r * r,
    trackHalfW: spec.trackHalfW || ROVER_PARAMS.trackHalfW,
    axleZ: axleZ.length === 3 ? axleZ : ROVER_PARAMS.axleZ,
    cgZ: mid,
    cgY: ROVER_PARAMS.cgY + (r - ROVER_PARAMS.wheelRadius),
    restLen: ROVER_PARAMS.restLen + (r - ROVER_PARAMS.wheelRadius),
    wheelForceMaxN,
    wheelTorqueMaxNm,
    motorTorqueMaxNm,
    brakeForceN: ROVER_PARAMS.brakeForceN * k,
    powerW,
    boostPowerW,
    maxHp: powerW / WATTS_PER_HP,
    boostHp: boostPowerW / WATTS_PER_HP,
    gearRatio,
    vMax: ROVER_PARAMS.vMax * sp,
    vMaxBoost: ROVER_PARAMS.vMaxBoost * sp,
    vMaxReverse: ROVER_PARAMS.vMaxReverse * sp,
    dims: { w: (spec.halfW || 1.3) * 2, h: ROVER_PARAMS.dims.h, l: (spec.halfL || 2.3) * 2 },
  });
}

// Wheel radius of each historic NASA rover model (metres, from the models in historic-rovers.js)
const HISTORIC_WHEEL_R = { sojourner: 0.068, "mer-spirit": 0.128, "mer-opportunity": 0.128, curiosity: 0.255, "perseverance-glb": 0.26 };
// Driving speed in the game. The real rovers are far slower (Curiosity about 0.14 km/h on autonav,
// Sojourner about 0.04 km/h); these are teleoperation-for-fun speeds, labelled as such in the HUD.
const HISTORIC_VMAX_KMH = { sojourner: 4, "mer-spirit": 7, "mer-opportunity": 7, curiosity: 10, "perseverance-glb": 10 };

/**
 * Parameters for a historic rover (Sojourner, Spirit, Opportunity, Curiosity, Perseverance) from its
 * spec: six wheels on the footprint used by historic-rovers.js, real mass, suspension and belly
 * contact points scaled with the wheel size so a 10 kg Sojourner and a 1 t Curiosity both work.
 */
export function roverParamsForHistoric(spec) {
  const kind = spec?.modelKind || "curiosity";
  const r = HISTORIC_WHEEL_R[kind] ?? 0.25;
  const s = r / ROVER_PARAMS.wheelRadius; // size relative to the MMSEV wheel
  const hw = Math.max(0.24, (spec?.halfW || 1.2) * 0.72);
  const hl = Math.max(0.28, (spec?.halfL || 1.4) * 0.72);
  const mass = spec?.massKg || 900;
  const k = mass / ROVER_PARAMS.massKg;
  const vmax = (HISTORIC_VMAX_KMH[kind] ?? 8) / 3.6;
  const wheelForceMaxN = ROVER_PARAMS.wheelForceMaxN * k;
  const wheelTorqueMaxNm = wheelForceMaxN * r;
  const motorTorqueMaxNm = wheelTorqueMaxNm / (ROVER_PARAMS.gearRatio * ROVER_PARAMS.driveEfficiency);
  const powerW = ROVER_PARAMS.powerW * k;
  const boostPowerW = ROVER_PARAMS.boostPowerW * k;
  const wheelMassKg = Math.max(0.35, mass * 0.018);
  return Object.freeze({
    ...ROVER_PARAMS,
    massKg: mass,
    weightN: mass * ROVER_PARAMS.g,
    dims: { w: hw * 2.4, h: Math.max(0.3, 2.2 * s), l: hl * 2.4 },
    cgY: Math.max(0.12, 0.95 * s),
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
const SLEEP_SPEED_SQ = 4e-4; // 2 cm/s (and 0.02 rad/s): a parked rover below this is at rest

export function createRoverDynamics(THREE, params = ROVER_PARAMS) {
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
    mechPowerW: 0,
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
    gradeForceN: 0,
    rollingResistanceN: 0,
    vLong: 0,
    vLat: 0,
    airborne: false,
    airTime: 0,
    landingImpact: 0,
    gear: "N",
    tractionLimited: false,
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

    // steering rack with speed-sensitive lock (less wheel angle at speed, like a real rack ratio)
    const lockScale = 1 / (1 + speed / 5.5);
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
    const wheelForceMaxN = P.wheelForceMaxN * speedMult;
    const availPowerW = (boost ? P.boostPowerW : P.powerW) * speedMult;
    const powerCap = availPowerW / Math.max(0.5, speed);
    let driveTotal = Math.min(wheelForceMaxN, powerCap) * Math.abs(st.pedal) * governor;
    driveTotal *= Math.sign(st.pedal);
    const coastRegen = st.pedal === 0 && st.brake < 0.05 ? -Math.sign(vLong) * Math.min(1, speed / 0.6) * m * P.regenCoastG : 0;

    let contacts = 0;
    let totalNormalLoad = 0;
    let totalRollingDrag = 0;
    let maxHardPen = 0;
    const minLen = P.restLen * 0.05;
    for (const wh of wheels) {
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

      // contact point and its velocity
      const cx = mountW.x - up.x * (len + P.wheelRadius);
      const cy = mountW.y - up.y * (len + P.wheelRadius);
      const cz = mountW.z - up.z * (len + P.wheelRadius);
      r.set(cx, cy, cz).sub(cgWorld);
      vPoint.crossVectors(st.angVel, r).add(st.vel);

      // spring + damper (+ bump stop), never pulling the wheel into the ground
      const cDamp = wh.compVel > 0 ? cBump : cRebound;
      let fs = kSpring * comp + cDamp * wh.compVel;
      if (comp > P.maxComp) fs += kSpring * 12 * (comp - P.maxComp) + cCrit * 1.5 * Math.max(0, wh.compVel);
      // no strut pushes harder than ~8 g of its share (a hard landing), and it never pulls
      fs = Math.max(0, Math.min(fs, 8 * m * P.g));
      const n = sampleNormal(cx, cz);
      nrm.set(n.x, n.y, n.z);
      const N = fs * Math.max(0.2, up.dot(nrm));
      wh.load = N;
      totalNormalLoad += N;

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

      // lateral: slip angle, saturating at full grip
      const alpha = Math.atan2(vs, Math.abs(vl) + 0.6);
      let fsLat = -P.mu * N * Math.max(-1, Math.min(1, alpha * P.corneringB));

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

    // chassis / belly against the terrain (rocks, crests, steep crater walls): normal-aware penalty + hard floor
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
    for (const wh of wheels) {
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
    for (const wh of wheels) {
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
    st.motorRpm = (wheelOmega * 60 * P.gearRatio) / (2 * Math.PI);
    const tractive = driveTotal + coastRegen;
    st.torquePct = Math.max(-1, Math.min(1, tractive / wheelForceMaxN));
    st.maxWheelTorqueNm = wheelForceMaxN * P.wheelRadius;
    st.maxMotorTorqueNm = st.maxWheelTorqueNm / (P.gearRatio * P.driveEfficiency);
    st.wheelTorqueNm = tractive * P.wheelRadius;
    st.motorTorqueNm = st.wheelTorqueNm / (P.gearRatio * P.driveEfficiency);
    const mech = tractive * vLong;
    st.mechPowerW = mech;
    st.hp = Math.abs(mech) / WATTS_PER_HP;
    st.maxHp = availPowerW / WATTS_PER_HP;
    st.powerToWeightHpPerTon = (st.maxHp * 1000) / m;
    st.normalLoadN = totalNormalLoad;
    st.gradeForceN = -m * P.g * fwd.y;
    st.rollingResistanceN = totalRollingDrag;
    st.powerW = (mech >= 0 ? mech / P.driveEfficiency : mech * P.regenEfficiency) + P.hotelW;
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
    if (inp.park === true && !st.airborne && st.vel.lengthSq() < SLEEP_SPEED_SQ && st.angVel.lengthSq() < SLEEP_SPEED_SQ) {
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
