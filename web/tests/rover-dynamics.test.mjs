// Headless checks for the MMSEV rigid-body + suspension model (node web/tests/rover-dynamics.test.mjs).
import assert from "node:assert/strict";
import * as THREE from "../vendor/three.module.js";
import { createRoverDynamics, roverParamsFor, ROVER_PARAMS } from "../hud/rover-dynamics.js";

const flat = {
  sampleY: () => 0,
  sampleNormal: () => ({ x: 0, y: 1, z: 0 }),
};
const run = (rv, seconds, inp, env = flat, each = null) => {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    rv.step(dt, inp, env);
    each?.(t);
  }
};
const idle = { throttle: 0, steer: 0, boost: false, handbrake: false };

// 1) settles on its springs at the static sag, level, without drifting
{
  const rv = createRoverDynamics(THREE);
  rv.reset(0, 0, 0, flat.sampleY);
  run(rv, 4, idle);
  const s = rv.state;
  for (const w of rv.wheels) assert.ok(Math.abs(w.comp - ROVER_PARAMS.sagM) < 0.02, `sag ${w.comp}`);
  assert.ok(Math.hypot(s.vel.x, s.vel.y, s.vel.z) < 0.02, "at rest");
  const a = rv.attitude();
  assert.ok(Math.abs(a.pitch) < 0.01 && Math.abs(a.roll) < 0.01, "level");
  console.log("rest ok: sag", rv.wheels[0].comp.toFixed(3), "m");
}

// 2) accelerates gently (no instant jump), reaches the governed top speed, nose lifts under power
{
  const rv = createRoverDynamics(THREE);
  rv.reset(0, 0, 0, flat.sampleY);
  run(rv, 2, idle);
  let maxAccel = 0;
  let maxPitch = 0;
  let v1 = 0;
  run(rv, 12, { ...idle, throttle: 1 }, flat, (t) => {
    maxAccel = Math.max(maxAccel, rv.state.accel);
    maxPitch = Math.max(maxPitch, rv.attitude().pitch);
    if (Math.abs(t - 1) < 1 / 120) v1 = rv.state.vLong;
  });
  const kmh = rv.state.vLong * 3.6;
  console.log(`after 1 s ${(v1 * 3.6).toFixed(1)} km/h, after 12 s ${kmh.toFixed(1)} km/h, peak accel ${maxAccel.toFixed(2)} m/s2, squat pitch ${(maxPitch * 57.3).toFixed(2)} deg, motor ${Math.round(rv.state.motorRpm)} rpm`);
  assert.ok(v1 * 3.6 < 4.5, "no instant launch");
  assert.ok(maxAccel < 1.6, "gentle acceleration");
  assert.ok(kmh > 17 && kmh < 21, "governed near 20 km/h");
  assert.ok(maxPitch > 0.002, "nose lifts / rear squats under power");
  assert.ok(rv.state.motorRpm > 2000 && rv.state.motorRpm < 3500, "motor rpm");

  // brake: stops, nose dives
  let minPitch = 0;
  let tStop = null;
  run(rv, 10, { ...idle, throttle: -1 }, flat, (t) => {
    minPitch = Math.min(minPitch, rv.attitude().pitch);
    if (tStop == null && Math.abs(rv.state.vLong) < 0.3) tStop = t;
  });
  console.log(`brake stop in ${tStop?.toFixed(2)} s, dive ${(minPitch * 57.3).toFixed(2)} deg`);
  assert.ok(tStop != null && tStop < 4, "brakes stop it");
  assert.ok(minPitch < -0.004, "nose dives under braking");
  assert.ok(rv.state.vLong < 0, "then reverses on held S");
  assert.ok(rv.state.vLong > -ROVER_PARAMS.vMaxReverse - 0.3, "reverse limited");
}

// 3) turning: yaws left on left steer, body rolls out of the turn, stays upright
{
  const rv = createRoverDynamics(THREE);
  rv.reset(0, 0, 0, flat.sampleY);
  run(rv, 8, { ...idle, throttle: 1 });
  const yaw0 = rv.attitude().yaw;
  let maxRoll = 0;
  run(rv, 3, { ...idle, throttle: 1, steer: 1 }, flat, () => (maxRoll = Math.max(maxRoll, Math.abs(rv.attitude().roll))));
  const dYaw = rv.attitude().yaw - yaw0;
  console.log(`turn: yaw ${(dYaw * 57.3).toFixed(1)} deg in 3 s, max roll ${(maxRoll * 57.3).toFixed(2)} deg`);
  assert.ok(dYaw > 0.3, "turns left");
  assert.ok(maxRoll > 0.003 && maxRoll < 0.4, "rolls a little");
}

// 4) a step: one side climbs a 25 cm ledge -> that wheel compresses more and the body rolls
{
  const ledge = {
    sampleY: (x, z) => (x > 0.5 && z < -3 ? 0.25 : 0),
    sampleNormal: () => ({ x: 0, y: 1, z: 0 }),
  };
  const rv = createRoverDynamics(THREE);
  rv.reset(0, 0, 0, ledge.sampleY);
  run(rv, 6, { ...idle, throttle: 0.6 }, ledge);
  const a = rv.attitude();
  console.log(`ledge: roll ${(a.roll * 57.3).toFixed(2)} deg, z ${rv.state.pos.z.toFixed(1)} m, comps`, rv.wheels.map((w) => w.comp.toFixed(2)).join(" "));
  assert.ok(rv.state.pos.z < -3, "drove onto the ledge");
  assert.ok(Math.abs(a.roll) > 0.02, "body rolls on the ledge");
  assert.ok(Number.isFinite(rv.state.pos.y), "stable");
}

// 5) rough terrain (dunes + ripples + slope), full lock then gentle steer: stays upright, keeps moving,
//    and the wheels really articulate (not all six always in contact)
{
  const h = (x, z) => 0.35 * Math.sin(x * 0.7) * Math.cos(z * 0.55) + 0.12 * Math.sin(x * 2.3 + z * 1.7) + 0.05 * x;
  const rough = {
    sampleY: h,
    sampleNormal: (x, z) => {
      const e = 0.3;
      const nx = h(x - e, z) - h(x + e, z);
      const nz = h(x, z - e) - h(x, z + e);
      const ny = 2 * e;
      const l = Math.hypot(nx, ny, nz);
      return { x: nx / l, y: ny / l, z: nz / l };
    },
  };
  const rv = createRoverDynamics(THREE);
  rv.reset(0, 0, 0, rough.sampleY);
  let worstTilt = 0;
  let minContacts = 6;
  let i = 0;
  run(rv, 10, { ...idle, throttle: 1, steer: 1 }, rough, () => {
    const a = rv.attitude();
    worstTilt = Math.max(worstTilt, Math.abs(a.pitch), Math.abs(a.roll));
    minContacts = Math.min(minContacts, rv.wheels.filter((w) => w.contact).length);
    i++;
  });
  console.log(`rough: worst tilt ${(worstTilt * 57.3).toFixed(1)} deg, min wheels on ground ${minContacts}, speed ${(rv.state.vLong * 3.6).toFixed(1)} km/h`);
  assert.ok(worstTilt < (35 * Math.PI) / 180, "stays upright on rough ground");
  assert.ok(minContacts < 6, "wheels articulate");
  assert.ok(rv.state.vLong > 1, "keeps moving");
}

// 6) high terrain (Gale sits ~500 m above the local datum) and the other vehicle's asymmetric axles:
//    the start pose must not depend on the absolute elevation
{
  const high = { sampleY: () => 526.6, sampleNormal: () => ({ x: 0, y: 1, z: 0 }) };
  for (const spec of [
    { id: "nasa_concept", massKg: 2250, topSpeedMs: 22, wheelRadius: 0.52, trackHalfW: 1.48, halfW: 1.82, halfL: 3.15, axles: [{ z: -1.95 }, { z: 0.42 }, { z: 1.98 }] },
  ]) {
    const rv = createRoverDynamics(THREE, roverParamsFor(spec));
    rv.reset(-59.85, 1515.17, 0.3, high.sampleY);
    run(rv, 3, idle, high);
    const a = rv.attitude();
    console.log(`high ground (${spec.id}): y ${rv.state.pos.y.toFixed(2)}, pitch ${(a.pitch * 57.3).toFixed(2)}, roll ${(a.roll * 57.3).toFixed(2)}`);
    assert.ok(Math.abs(rv.state.pos.y - 526.6) < 0.1, "sits on the ground");
    assert.ok(Math.abs(a.pitch) < 0.02 && Math.abs(a.roll) < 0.02, "level on flat high ground");
    assert.equal(rv.wheels.filter((w) => w.contact).length, 6, "all wheels down");
  }
}

console.log("rover-dynamics: all checks passed");
