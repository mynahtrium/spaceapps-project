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

export const ROVER_PARAMS = Object.freeze({
  massKg: 2950,
  dims: { w: 2.6, h: 2.2, l: 4.6 }, // for the box inertia
  cgY: 0.95, // centre of mass above the model origin (ground at rest)
  cgZ: 0.37, // over the middle axle (the wheel set is not centred on the model origin)
  g: 3.71,
  wheelRadius: 0.345,
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
  powerW: 14000,
  boostPowerW: 19000,
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
  return Object.freeze({
    ...ROVER_PARAMS,
    massKg: Math.round(ROVER_PARAMS.massKg * k),
    wheelRadius: r,
    trackHalfW: spec.trackHalfW || ROVER_PARAMS.trackHalfW,
    axleZ: axleZ.length === 3 ? axleZ : ROVER_PARAMS.axleZ,
    cgZ: mid,
    cgY: ROVER_PARAMS.cgY + (r - ROVER_PARAMS.wheelRadius),
    restLen: ROVER_PARAMS.restLen + (r - ROVER_PARAMS.wheelRadius),
    wheelForceMaxN: ROVER_PARAMS.wheelForceMaxN * k,
    brakeForceN: ROVER_PARAMS.brakeForceN * k,
    powerW: ROVER_PARAMS.powerW * k * sp,
    boostPowerW: ROVER_PARAMS.boostPowerW * k * sp,
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
  return Object.freeze({
    ...ROVER_PARAMS,
    massKg: mass,
    dims: { w: hw * 2.4, h: Math.max(0.3, 2.2 * s), l: hl * 2.4 },
    cgY: Math.max(0.12, 0.95 * s),
    cgZ: 0,
    wheelRadius: r,
    trackHalfW: hw,
    axleZ: [-hl, 0, hl],
    restLen: 0.5 * s,
    sagM: 0.11 * s,
    maxComp: 0.34 * s,
    probeScale: s,
    wheelForceMaxN: ROVER_PARAMS.wheelForceMaxN * k,
    brakeForceN: ROVER_PARAMS.brakeForceN * k,
    powerW: ROVER_PARAMS.powerW * k,
    boostPowerW: ROVER_PARAMS.boostPowerW * k,
    vMax: vmax,
    vMaxBoost: vmax * 1.3,
    vMaxReverse: vmax * 0.5,
    batteryKWh: kind === "sojourner" ? 0.15 : kind.startsWith("mer") ? 1.0 : 2.7,
    hotelW: kind === "sojourner" ? 10 : kind.startsWith("mer") ? 60 : 110,
  });
}

const SUBSTEP = 1 / 240;

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
    motorRpm: 0,
    torquePct: 0,
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
  // belly and bumper points (ground clearance ~0.55 m, like a high-riding pressurised rover)
  const probe = [
    [-0.9, 0.62, -2.25],
    [0.9, 0.62, -2.25],
    [-0.9, 0.62, 2.3],
    [0.9, 0.62, 2.3],
    [0, 0.55, 0.37],
    [-0.8, 0.55, -1.0],
    [0.8, 0.55, -1.0],
    [-0.8, 0.55, 1.6],
    [0.8, 0.55, 1.6],
    [-1.1, 1.8, -1.6],
    [1.1, 1.8, -1.6],
    [-1.1, 1.8, 1.8],
    [1.1, 1.8, 1.8],
  ];

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

    // motor demand for the whole vehicle
    const boost = Boolean(inp.boost);
    const rawMult = Number(inp.speedMultiplier);
    const speedMult = Number.isFinite(rawMult) ? Math.max(0.3, Math.min(4.0, rawMult)) : 1;
    const vCap = (st.pedal >= 0 ? (boost ? P.vMaxBoost : P.vMax) : P.vMaxReverse) * speedMult;
    const governor = Math.max(0, Math.min(1, (vCap - speed) / 0.8));
    const wheelForceMaxN = P.wheelForceMaxN * speedMult;
    const powerCap = ((boost ? P.boostPowerW : P.powerW) * speedMult) / Math.max(0.5, speed);
    let driveTotal = Math.min(wheelForceMaxN, powerCap) * Math.abs(st.pedal) * governor;
    driveTotal *= Math.sign(st.pedal);
    const coastRegen = st.pedal === 0 && st.brake < 0.05 ? -Math.sign(vLong) * Math.min(1, speed / 0.6) * m * P.regenCoastG : 0;

    let contacts = 0;
    for (const wh of wheels) {
      // strut top in world space
      mountW.set(wh.lx, mountY, wh.lz).applyQuaternion(st.q).add(st.pos);
      // hub along the strut until the tyre touches the ground (two passes to follow the slope)
      let len = P.restLen;
      for (let k = 0; k < 2; k++) {
        const hx = mountW.x - up.x * len;
        const hz = mountW.z - up.z * len;
        const gy = sampleY(hx, hz);
        len = Math.min(P.restLen, (mountW.y - gy - P.wheelRadius) / Math.max(0.3, up.y));
      }
      const comp = Math.min(P.restLen * 0.95, P.restLen - len); // a strut cannot shorten past its body
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
      wh.hubY = mountY - len;

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
      fl -= P.rollingCrr * N * Math.max(-1, Math.min(1, vl / 0.25));
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

    // chassis / belly against the terrain (rocks, crests): stiff penalty contact
    const ps = P.probeScale || 1;
    for (const [bx, by, bz] of probe) {
      tmp.set(bx * ps, by * ps, bz * ps).applyQuaternion(st.q).add(st.pos);
      const gy = sampleY(tmp.x, tmp.z);
      const pen = gy - tmp.y;
      if (pen <= 0) continue;
      r.copy(tmp).sub(cgWorld);
      vPoint.crossVectors(st.angVel, r).add(st.vel);
      const fn = Math.max(0, m * 40 * pen - m * 6 * Math.min(0, vPoint.y));
      // sliding friction on the belly / bumper, never more than mu * normal force
      const vt = Math.hypot(vPoint.x, vPoint.z);
      const ft = vt > 1e-4 ? Math.min(0.45 * fn, m * 2 * vt) / vt : 0;
      F.set(-vPoint.x * ft, fn, -vPoint.z * ft);
      force.add(F);
      torque.add(tmp.crossVectors(r, F));
    }

    st.airborne = contacts === 0;
    // wheelspin light: the motors ask for more than at least two tyres can put down
    st.tractionLimited = Math.abs(driveTotal) > 1 && wheels.filter((wh) => wh.contact && wh.slip >= 0.999).length >= 2;

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

    if (st.airborne) st.airTime += dt;
    else {
      if (st.airTime > 0.15) st.landingImpact = Math.max(st.landingImpact, -prevVY);
      st.airTime = 0;
    }

    // telemetry
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
    const mech = tractive * vLong;
    st.powerW = (mech >= 0 ? mech / P.driveEfficiency : mech * P.regenEfficiency) + P.hotelW;
    st.batteryKWh = Math.max(0, Math.min(P.batteryKWh, st.batteryKWh - (st.powerW * dt) / 3.6e6));
    st.odometerM += Math.abs(vLong) * dt;
  }

  /**
   * @param {number} dt frame time (s)
   * @param {{throttle:number, steer:number, boost:boolean, handbrake:boolean, speedMultiplier?:number}} inp steer > 0 = left
   * @param {{sampleY:(x:number,z:number)=>number, sampleNormal:(x:number,z:number)=>{x:number,y:number,z:number}}} env
   */
  let acc = 0;
  function step(dt, inp, env) {
    st.landingImpact = 0;
    acc = Math.min(acc + Math.min(0.1, Math.max(0, dt)), 0.1);
    let n = 0;
    while (acc >= SUBSTEP && n < 30) {
      substep(SUBSTEP, inp, env);
      acc -= SUBSTEP;
      n++;
    }
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
    reset,
    step,
    attitude,
    /** Rover was moved from outside (world wrap, collision push): keep velocities, take the new spot. */
    setPosition(x, z) {
      st.pos.x = x;
      st.pos.z = z;
    },
    scaleVelocity(s) {
      st.vel.x *= s;
      st.vel.z *= s;
    },
  };
}
