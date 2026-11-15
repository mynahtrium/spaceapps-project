// Headless checks for the MMSEV rigid-body + suspension model (node web/tests/rover-dynamics.test.mjs).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "../vendor/three.module.js";
import {
  createRoverDynamics,
  roverParamsFor,
  roverParamsForHistoric,
  ROVER_PARAMS,
  TORQUE_MULTIPLIER,
  POWER_MULTIPLIER,
} from "../hud/rover-dynamics.js";
import { DRIVABLE_VEHICLES } from "../hud/experimental-rover.js";

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
  assert.ok(v1 * 3.6 < 6.0, "no instant launch");
  assert.ok(maxAccel > 1.4 && maxAccel < 2.8, "high-traction Martian regolith acceleration without spinout");
  assert.ok(kmh > 34 && kmh < 40, `governed near 38 km/h (${kmh.toFixed(1)})`);
  assert.ok(maxPitch > 0.002, "nose lifts / rear squats under power");
  assert.ok(rv.state.motorRpm > 2000 && rv.state.motorRpm < 3600, `motor rpm (${Math.round(rv.state.motorRpm)})`);

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

// 7) historic rovers (tiny Sojourner to 1 t Perseverance): sit level on their springs, drive up to
//    their (game) top speed without flipping, and stop again
{
  for (const spec of [
    { id: "sojourner", modelKind: "sojourner", massKg: 10.6, halfW: 0.32, halfL: 0.38 },
    { id: "spirit", modelKind: "mer-spirit", massKg: 185, halfW: 1.22, halfL: 0.92 },
    { id: "curiosity", modelKind: "curiosity", massKg: 899, halfW: 1.45, halfL: 1.55 },
    { id: "perseverance", modelKind: "perseverance-glb", massKg: 1025, halfW: 1.45, halfL: 1.55 },
  ]) {
    const P = roverParamsForHistoric(spec);
    const rv = createRoverDynamics(THREE, P);
    rv.reset(0, 0, 0, flat.sampleY);
    run(rv, 2, idle);
    const rest = rv.attitude();
    assert.ok(Math.abs(rest.pitch) < 0.02 && Math.abs(rest.roll) < 0.02, `${spec.id} level at rest`);
    let worst = 0;
    run(rv, 10, { ...idle, throttle: 1, steer: 0.3 }, flat, () => {
      const a = rv.attitude();
      worst = Math.max(worst, Math.abs(a.pitch), Math.abs(a.roll));
    });
    const kmh = Math.hypot(rv.state.vel.x, rv.state.vel.z) * 3.6;
    run(rv, 8, { ...idle, throttle: -1 }, flat);
    console.log(`${spec.id}: top ${kmh.toFixed(1)} km/h (limit ${(P.vMax * 3.6).toFixed(0)}), worst tilt ${(worst * 57.3).toFixed(1)} deg`);
    assert.ok(kmh > P.vMax * 3.6 * 0.6 && kmh < P.vMax * 3.6 * 1.1, `${spec.id} reaches its speed`);
    assert.ok(worst < 0.35, `${spec.id} stays upright`);
    assert.ok(Number.isFinite(rv.state.pos.y), `${spec.id} stable`);
  }
}

console.log("rover-dynamics: all checks passed");

// parked rovers sleep once settled, and wake when driven, moved or when the ground changes
{
  const rv = createRoverDynamics(THREE);
  rv.reset(0, 0, 0, flat.sampleY);
  const parked = { throttle: 0, steer: 0, boost: false, handbrake: true, park: true };
  run(rv, 6, parked);
  assert.ok(rv.asleep, "settled parked rover sleeps");
  const y0 = rv.state.pos.y;
  assert.equal(rv.step(1 / 60, parked, flat), false, "a sleeping rover skips the simulation");
  assert.equal(rv.state.pos.y, y0);
  // not parked (someone is in the seat): never sleeps, however long it stands still
  const rv2 = createRoverDynamics(THREE);
  rv2.reset(0, 0, 0, flat.sampleY);
  run(rv2, 6, { ...idle, handbrake: true });
  assert.ok(!rv2.asleep, "a rover that is not parked stays awake");
  // driving wakes it
  assert.equal(rv.step(1 / 60, { ...idle, throttle: 1 }, flat), true);
  assert.ok(!rv.asleep, "input wakes the rover");
  // ground rising under a sleeping rover (terrain detail streamed in) wakes it and it follows
  run(rv, 8, parked);
  assert.ok(rv.asleep, "sleeps again");
  const raised = { sampleY: () => 0.3, sampleNormal: flat.sampleNormal };
  run(rv, 4, parked, raised);
  assert.ok(Math.abs(rv.state.pos.y - y0 - 0.3) < 0.03, `follows the new ground (${(rv.state.pos.y - y0).toFixed(3)} m)`);

  // ground changing only under the front wheels (center stays fixed) must also wake a parked rover
  run(rv, 6, parked, flat);
  assert.ok(rv.asleep, "sleeps back down on flat ground");
  const edgeBump = { sampleY: (x, z) => (z < -1.0 ? 0.35 : 0), sampleNormal: flat.sampleNormal };
  let wokeFromFrontWheel = false;
  for (let k = 0; k < 45; k++) {
    if (rv.step(1 / 60, parked, edgeBump)) {
      wokeFromFrontWheel = true;
      break;
    }
  }
  assert.ok(wokeFromFrontWheel, "front-wheel terrain change wakes a parked rover");
  console.log("sleep ok");
}

// 8) anti-clipping: nasa_concept long overhangs, centerline belly over sharp ridge, steep crater wall, hard drop & setPosition
{
  const conceptSpec = {
    id: "nasa_concept",
    massKg: 2250,
    topSpeedMs: 22,
    wheelRadius: 0.52,
    trackHalfW: 1.48,
    halfW: 1.82,
    halfL: 3.15,
    axles: [{ z: -1.95 }, { z: 0.42 }, { z: 1.98 }],
  };
  const ridgeH = (x, z) => 0.65 * Math.exp(-((z + 5.5) ** 2) / 0.55);
  const ridgeEnv = {
    sampleY: ridgeH,
    sampleNormal: (x, z) => {
      const e = 0.2;
      const nx = ridgeH(x - e, z) - ridgeH(x + e, z);
      const nz = ridgeH(x, z - e) - ridgeH(x, z + e);
      const l = Math.hypot(nx, 2 * e, nz);
      return { x: nx / l, y: (2 * e) / l, z: nz / l };
    },
  };
  const rvConcept = createRoverDynamics(THREE, roverParamsFor(conceptSpec));
  rvConcept.reset(0, 0, 0, ridgeEnv.sampleY);
  const pt = new THREE.Vector3();
  let worstBellyPen = 0;
  run(rvConcept, 4.5, { ...idle, throttle: 1 }, ridgeEnv, () => {
    for (const [bx, by, bz] of [
      [0, 0.58, -3.02],
      [0, 0.52, 0.42],
      [0, 0.58, 3.02],
    ]) {
      pt.set(bx, by, bz).applyQuaternion(rvConcept.state.q).add(rvConcept.state.pos);
      worstBellyPen = Math.max(worstBellyPen, ridgeH(pt.x, pt.z) - pt.y);
    }
  });
  assert.ok(worstBellyPen < 0.03, `nasa_concept overhang/belly stays above ridge (worst pen ${worstBellyPen.toFixed(4)} m)`);

  // steep 40-deg crater wall impact at boost speed + 3.5 m drop
  const wallH = (x, z) => (z < -8 ? Math.min(4.5, (-8 - z) * 0.84) : 0);
  const wallEnv = {
    sampleY: wallH,
    sampleNormal: (x, z) => {
      const e = 0.25;
      const nx = wallH(x - e, z) - wallH(x + e, z);
      const nz = wallH(x, z - e) - wallH(x, z + e);
      const l = Math.hypot(nx, 2 * e, nz);
      return { x: nx / l, y: (2 * e) / l, z: nz / l };
    },
  };
  const rvWall = createRoverDynamics(THREE);
  rvWall.reset(0, 0, 0, wallEnv.sampleY);
  let worstWheelPen = 0;
  let maxHubY = -Infinity;
  const maxAllowedHubY = rvWall.mountY - rvWall.params.restLen * 0.05 + 1e-6;
  run(rvWall, 4.0, { ...idle, throttle: 1, boost: true }, wallEnv, () => {
    for (const w of rvWall.wheels) {
      maxHubY = Math.max(maxHubY, w.hubY);
    }
    pt.set(0, 0.58, -2.21).applyQuaternion(rvWall.state.q).add(rvWall.state.pos);
    worstWheelPen = Math.max(worstWheelPen, wallH(pt.x, pt.z) - pt.y);
  });
  assert.ok(maxHubY <= maxAllowedHubY, `wheel hub never telescopes inside fender (${maxHubY.toFixed(3)} <= ${maxAllowedHubY.toFixed(3)})`);
  assert.ok(worstWheelPen < 0.04, `nose does not spear deep into steep wall (${worstWheelPen.toFixed(4)} m)`);

  // 3.5 m vertical drop onto flat ground: chassis belly and visual wheel bottoms never sink underground
  rvWall.reset(0, 0, 0, flat.sampleY);
  rvWall.state.pos.y = 3.5;
  rvWall.state.vel.set(0, -6.0, 0);
  let worstDropPen = 0;
  run(rvWall, 1.5, idle, flat, () => {
    for (const w of rvWall.wheels) {
      assert.ok(w.hubY <= maxAllowedHubY, "hub stays below fender during hard landing");
      const wheelBotY = rvWall.state.pos.y + w.hubY - rvWall.params.wheelRadius;
      worstDropPen = Math.max(worstDropPen, -wheelBotY);
    }
    pt.set(0, 0.52, rvWall.params.cgZ).applyQuaternion(rvWall.state.q).add(rvWall.state.pos);
    worstDropPen = Math.max(worstDropPen, -pt.y);
  });
  assert.ok(worstDropPen < 0.04, `hard drop recovers without wheel/belly sinking underground (${worstDropPen.toFixed(4)} m)`);

  // setPosition with sampleY lifts a displaced rover onto elevated terrain
  rvWall.setPosition(25, 25, () => 1.8);
  assert.ok(rvWall.state.pos.y >= 1.75, `setPosition keeps ground clearance on elevated terrain (${rvWall.state.pos.y.toFixed(3)})`);

  // hud3d wiring: roverEnv uses rendered surface sampler and passes it to setPosition
  const __dir = path.dirname(fileURLToPath(import.meta.url));
  const hudSrc = fs.readFileSync(path.resolve(__dir, "..", "hud", "hud3d.js"), "utf8");
  assert.match(hudSrc, /roverEnv\s*=\s*\{\s*sampleY:\s*sampleRenderedSurfaceY/);
  assert.match(hudSrc, /sim\.setPosition\([^)]*roverEnv\.sampleY/);
  assert.match(hudSrc, /ringCopyGeom\s*=\s*buildTerrainGeometry\([^)]*includeHabitat:\s*false/);
  console.log("anti-clipping ok");
}

// 9) realistic torque (N*m), horsepower (HP 2.25x), weight (kg / N), increased traction and zero wheel-floor clipping
{
  const rv = createRoverDynamics(THREE, roverParamsFor({ id: "mmsev", massKg: 2950 }));
  rv.reset(0, 0, 0, flat.sampleY);
  run(rv, 2, idle);
  const st0 = rv.state;
  assert.equal(st0.massKg, 2950);
  assert.ok(Math.abs(st0.weightN - 2950 * rv.params.g) < 1, `Martian weight N (${st0.weightN})`);
  assert.ok(Math.abs(st0.normalLoadN - st0.weightN) < 150, `settled normal load matches weight (${st0.normalLoadN} vs ${st0.weightN})`);
  assert.ok(Math.abs(st0.maxWheelTorqueNm - 3400 * 2.25 * 0.345) < 1, `2.25x max wheel torque N*m (${st0.maxWheelTorqueNm})`);
  assert.ok(Math.abs(st0.maxPowerKw - 14 * 2.25) < 0.05, `2.25x max power kW (${st0.maxPowerKw})`);
  assert.ok(st0.maxHp > 42, `2.25x max horsepower HP (${st0.maxHp})`);

  // Full throttle acceleration: positive wheel/motor torque and higher horsepower
  run(rv, 3.0, { ...idle, throttle: 1, boost: true });
  assert.ok(rv.state.wheelTorqueNm > 400, `active wheel torque N*m (${rv.state.wheelTorqueNm})`);
  assert.ok(rv.state.motorTorqueNm > 20, `active motor torque N*m (${rv.state.motorTorqueNm})`);
  assert.ok(rv.state.hp > 20, `active horsepower HP (${rv.state.hp})`);
  assert.ok(Math.abs(rv.state.maxPowerKw - 19 * 2.25) < 0.05, `2.25x boost power kW (${rv.state.maxPowerKw})`);

  // Sharp step / bump obstacle: wheel bottom never clips below ground under tire footprint
  const stepEnv = {
    sampleY: (x, z) => (z < -2 ? 0.55 * Math.exp(-((z + 3.5) ** 2) / 0.8) : 0),
    sampleNormal: (x, z) => {
      const h = (px, pz) => (pz < -2 ? 0.55 * Math.exp(-((pz + 3.5) ** 2) / 0.8) : 0);
      const gx = (h(x + 0.1, z) - h(x - 0.1, z)) / 0.2;
      const gz = (h(x, z + 0.1) - h(x, z - 0.1)) / 0.2;
      const il = 1 / Math.hypot(gx, 1, gz);
      return { x: -gx * il, y: il, z: -gz * il };
    },
  };
  rv.reset(0, 0, 0, stepEnv.sampleY);
  for (let i = 0; i < 180; i++) {
    rv.step(1 / 60, { ...idle, throttle: 0.8 }, stepEnv);
    for (const wh of rv.wheels) {
      const clearance = wh.worldHubY - wh.groundY;
      assert.ok(
        clearance >= rv.params.wheelRadius * 0.96,
        `wheel never clips floor: hub clearance ${clearance.toFixed(3)} m vs radius ${rv.params.wheelRadius.toFixed(3)} m`
      );
    }
  }

  // Verify 2.25x torque and 2.25x kW/HP + boosted traction across DRIVABLE_VEHICLES and historic rovers
  assert.equal(TORQUE_MULTIPLIER, 2.25);
  assert.equal(POWER_MULTIPLIER, 2.25);
  assert.ok(ROVER_PARAMS.mu >= 1.0, `high tire grip mu >= 1.0 (${ROVER_PARAMS.mu})`);
  assert.ok(ROVER_PARAMS.corneringB >= 12, `sharp lateral cornering stiffness (${ROVER_PARAMS.corneringB})`);
  assert.ok(ROVER_PARAMS.antiRollRatio >= 0.5, `per-axle anti-roll bar enabled (${ROVER_PARAMS.antiRollRatio})`);
  const mmsevSpec = DRIVABLE_VEHICLES.find((v) => v.id === "mmsev");
  const conceptSpec = DRIVABLE_VEHICLES.find((v) => v.id === "nasa_concept");
  assert.equal(mmsevSpec.wheelTorqueMaxNm, 1173 * 2.25);
  assert.equal(mmsevSpec.powerW, 14000 * 2.25);
  assert.equal(mmsevSpec.boostPowerW, 19000 * 2.25);
  assert.equal(conceptSpec.wheelTorqueMaxNm, 2150 * 2.25);
  assert.equal(conceptSpec.powerW, 20200 * 2.25);
  assert.equal(conceptSpec.boostPowerW, 27400 * 2.25);
  const conceptParams = roverParamsFor(conceptSpec);
  assert.equal(conceptParams.wheelTorqueMaxNm, 2150 * 2.25);
  assert.equal(conceptParams.powerKw, (20200 * 2.25) / 1000);
  const curParams = roverParamsForHistoric({ modelKind: "curiosity", massKg: 899 });
  assert.ok(Math.abs(curParams.wheelTorqueMaxNm - 3400 * 2.25 * (899 / 2950) * 0.255) < 0.01);
  assert.ok(Math.abs(curParams.powerKw - (14 * 2.25 * 899) / 2950) < 0.01);
}

// 10) Anti-rollover stability & automatic self-righting recovery for all rovers (MMSEV, Concept, Historic)
{
  const duneEnv = {
    sampleY: (x, z) => 0.48 * Math.sin(x * 0.55) * Math.cos(z * 0.45) + 0.18 * Math.sin(x * 1.4 - z * 1.1),
    sampleNormal: (x, z) => {
      const h = (px, pz) => 0.48 * Math.sin(px * 0.55) * Math.cos(pz * 0.45) + 0.18 * Math.sin(px * 1.4 - pz * 1.1);
      const e = 0.25;
      const nx = h(x - e, z) - h(x + e, z);
      const nz = h(x, z - e) - h(x, z + e);
      const l = Math.hypot(nx, 2 * e, nz);
      return { x: nx / l, y: (2 * e) / l, z: nz / l };
    },
  };

  const mmsevSpec = DRIVABLE_VEHICLES.find((v) => v.id === "mmsev");
  const conceptSpec = DRIVABLE_VEHICLES.find((v) => v.id === "nasa_concept");
  const historicCur = { id: "curiosity", modelKind: "curiosity", massKg: 899, halfW: 1.45, halfL: 1.55 };

  // Verify calibrated boost top speeds: MMSEV ~45 km/h, NASA Concept ~60 km/h
  for (const [label, params, minKmh, maxKmh] of [
    ["mmsev", roverParamsFor(mmsevSpec), 43.5, 46.0],
    ["nasa_concept", roverParamsFor(conceptSpec), 58.0, 61.0],
  ]) {
    const rvTop = createRoverDynamics(THREE, params);
    rvTop.reset(0, 0, 0, flat.sampleY);
    run(rvTop, 14.0, { ...idle, throttle: 1, boost: true }, flat);
    const topKmh = rvTop.state.vLong * 3.6;
    assert.ok(topKmh >= minKmh && topKmh <= maxKmh, `${label} boost top speed ${topKmh.toFixed(2)} km/h in [${minKmh}, ${maxKmh}]`);
    assert.ok(rvTop.state.motorRpm < 4000, `${label} stays within 4000 RPM tachometer (${Math.round(rvTop.state.motorRpm)})`);
  }

  // Steep climb with boost unlocks up to 5000 RPM climb rev & over-torque surge
  const slope18 = Math.tan((18 * Math.PI) / 180);
  const climbEnv = {
    sampleY: (x, z) => Math.max(0, (-z - 3) * slope18),
    sampleNormal: (x, z) =>
      z < -3 ? { x: 0, y: Math.cos((18 * Math.PI) / 180), z: Math.sin((18 * Math.PI) / 180) } : { x: 0, y: 1, z: 0 },
  };
  for (const [label, params] of [
    ["mmsev", roverParamsFor(mmsevSpec)],
    ["nasa_concept", roverParamsFor(conceptSpec)],
  ]) {
    const rvClimb = createRoverDynamics(THREE, params);
    rvClimb.reset(0, 0, 0, climbEnv.sampleY);
    let maxRpm = 0;
    let maxTrq = 0;
    run(rvClimb, 5.0, { ...idle, throttle: 1, boost: true }, climbEnv, () => {
      if (rvClimb.state.pos.z < -4) {
        maxRpm = Math.max(maxRpm, rvClimb.state.motorRpm);
        maxTrq = Math.max(maxTrq, rvClimb.state.wheelTorqueNm);
      }
    });
    assert.ok(maxRpm >= 4600 && maxRpm <= 5005, `${label} boost climb hits 5000 RPM band (${Math.round(maxRpm)})`);
    assert.ok(maxTrq > params.wheelTorqueMaxNm * 1.25, `${label} boost climb unlocks extra wheel torque (${Math.round(maxTrq)} > ${Math.round(params.wheelTorqueMaxNm)})`);
  }

  // Aggressive full-boost zig-zag slalom over dunes never flips any drivable vehicle
  for (const [label, params] of [
    ["mmsev", roverParamsFor(mmsevSpec)],
    ["nasa_concept", roverParamsFor(conceptSpec)],
  ]) {
    const rv = createRoverDynamics(THREE, params);
    rv.reset(0, 0, 0, duneEnv.sampleY);
    const up = new THREE.Vector3();
    let minUpY = 1;
    for (let i = 0; i < 600; i++) {
      const steer = Math.sin(i / 36);
      rv.step(1 / 60, { throttle: 1, steer, boost: true, speedMultiplier: 1.6 }, duneEnv);
      up.set(0, 1, 0).applyQuaternion(rv.state.q);
      minUpY = Math.min(minUpY, up.y);
      assert.ok(Number.isFinite(rv.state.pos.y));
    }
    assert.ok(minUpY > 0.72, `${label} stays upright on aggressive slalom (min up.y ${minUpY.toFixed(3)})`);

    // Deliberately flip 180 deg upside-down and 90 deg onto side: must self-right & resume driving
    for (const [poseName, angleRad] of [
      ["upside-down", Math.PI],
      ["side-tipped", Math.PI / 2],
    ]) {
      rv.reset(0, 0, 0, flat.sampleY);
      const qFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angleRad);
      rv.state.q.copy(qFlip);
      rv.state.pos.y = poseName === "upside-down" ? 2.1 : 1.4;
      run(rv, 3.0, { ...idle, throttle: 0.8 }, flat);
      up.set(0, 1, 0).applyQuaternion(rv.state.q);
      assert.ok(up.y > 0.9, `${label} auto-rights from ${poseName} (up.y ${up.y.toFixed(3)})`);
      assert.ok(rv.state.vLong > 1.0, `${label} drives forward cleanly after self-righting from ${poseName}`);
    }
  }

  // Historic rover also automatically recovers from being flipped upside-down
  const curRv = createRoverDynamics(THREE, roverParamsForHistoric(historicCur));
  curRv.reset(0, 0, 0, flat.sampleY);
  curRv.state.q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
  curRv.state.pos.y = 1.2;
  run(curRv, 3.0, { ...idle, throttle: 0.6 }, flat);
  const curUp = new THREE.Vector3(0, 1, 0).applyQuaternion(curRv.state.q);
  assert.ok(curUp.y > 0.9, `historic curiosity auto-rights from upside-down (up.y ${curUp.y.toFixed(3)})`);
}
