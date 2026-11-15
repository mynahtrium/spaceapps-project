import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GALE_G,
  VEHICLE_IDS,
  createVehicleBody,
  getVehicleSpec,
  stepVehicle,
  vehiclePose,
} from "../physics/VehicleDynamics.js";
import { GaleCorridor } from "../map/GaleCorridor.js";

const flat = () => 0;
const deg = Math.PI / 180;
const run = (body, input, env, seconds, each) => {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    stepVehicle(body, input, env, 1 / 60);
    each?.(body, i);
  }
};
const upY = (b) => vehiclePose(b).up.y;

test("Gale gravity is real (~3.72 m/s^2), not a boosted 'flight' gravity", () => {
  assert.ok(GALE_G > 3.68 && GALE_G < 3.75, `g = ${GALE_G}`);
  assert.deepEqual([...VEHICLE_IDS].sort(), ["chariot", "lrv", "sev"]);
  assert.ok(Math.abs(getVehicleSpec("sev").topSpeedMs * 3.6 - 10) < 0.01, "SEV ~10 km/h (NASA fact sheet)");
  assert.equal(getVehicleSpec("lrv").massKg, 570, "LRV 210 kg + two suited crew");
});

for (const id of VEHICLE_IDS) {
  test(`${id}: settles on flat ground with every wheel loaded, then sleeps`, () => {
    const b = createVehicleBody(id, 0, 0, 0.3, flat);
    run(b, {}, { sampleHeight: flat }, 4);
    const pose = vehiclePose(b);
    assert.equal(b.contacts, b.wheels.length);
    assert.ok(Math.abs(pose.origin.y) < 0.06, `ride height ${pose.origin.y.toFixed(3)}`);
    assert.ok(upY(b) > 0.999, "level");
    const total = b.wheels.reduce((s, w) => s + w.load, 0);
    const weight = b.spec.massKg * GALE_G;
    assert.ok(Math.abs(total - weight) / weight < 0.03, `wheel loads ${total.toFixed(0)} vs weight ${weight.toFixed(0)}`);
    assert.ok(b.sleeping, "parked vehicle sleeps");
  });

  test(`${id}: reaches its real top speed on flat ground and never leaves it`, () => {
    const b = createVehicleBody(id, 0, 0, 0, flat);
    let airborne = 0;
    let maxH = 0;
    run(b, { throttle: 1 }, { sampleHeight: flat }, 40, (bb) => {
      if (bb.contacts === 0) airborne++;
      maxH = Math.max(maxH, vehiclePose(bb).origin.y);
    });
    // Governor at the published top speed; a low-power rover (LRV: 4 x 0.25 hp against Mars rolling
    // resistance, 2.3x the Moon's gravity) settles a little below it, which is the physics, not a bug.
    const top = b.spec.topSpeedMs;
    const ratio = b.forwardSpeed / top;
    assert.ok(ratio > 0.85 && ratio < 1.03, `${(b.forwardSpeed * 3.6).toFixed(1)} km/h vs ${(top * 3.6).toFixed(1)}`);
    assert.equal(airborne, 0, "never airborne on flat ground");
    assert.ok(maxH < 0.1, `no bouncing (max ${maxH.toFixed(3)} m)`);
  });

  test(`${id}: parked on a 15 degree slope it holds without creeping`, () => {
    const slope = (x, z) => -Math.tan(15 * deg) * z; // uphill toward -z
    const b = createVehicleBody(id, 0, 0, 0, slope);
    run(b, {}, { sampleHeight: slope }, 3);
    const z0 = b.pos.z;
    run(b, {}, { sampleHeight: slope }, 10);
    assert.ok(Math.abs(b.pos.z - z0) < 0.05, `crept ${(b.pos.z - z0).toFixed(3)} m`);
  });
}

test("climbing slows the low-power LRV a lot and the SEV a little", () => {
  const slope = (x, z) => -Math.tan(12 * deg) * z;
  const out = {};
  for (const id of ["lrv", "sev"]) {
    const b = createVehicleBody(id, 0, 0, 0, slope);
    run(b, { throttle: 1 }, { sampleHeight: slope }, 30);
    out[id] = b.forwardSpeed / b.spec.topSpeedMs;
    assert.ok(b.forwardSpeed > 0.3, `${id} still climbs 12 deg (${b.forwardSpeed.toFixed(2)} m/s)`);
  }
  assert.ok(out.lrv < 0.75, `LRV is power limited uphill (${(out.lrv * 100).toFixed(0)}% of top speed)`);
  assert.ok(out.sev > out.lrv, "the SEV has more power per kg");
});

test("braking from top speed takes at least the Mars friction-limited distance", () => {
  for (const id of VEHICLE_IDS) {
    const b = createVehicleBody(id, 0, 0, 0, flat);
    run(b, { throttle: 1 }, { sampleHeight: flat }, 30);
    const v0 = b.forwardSpeed;
    const z0 = b.pos.z;
    run(b, { brake: true }, { sampleHeight: flat }, 8);
    const dist = Math.abs(b.pos.z - z0);
    const minDist = (v0 * v0) / (2 * b.spec.mu * GALE_G);
    assert.ok(Math.abs(b.forwardSpeed) < 0.05, `${id} stopped`);
    assert.ok(dist >= minDist * 0.95, `${id} stopped in ${dist.toFixed(2)} m, physics floor ${minDist.toFixed(2)} m`);
  }
});

test("steering turns the vehicle the right way and crab mode moves it sideways", () => {
  const b = createVehicleBody("sev", 0, 0, 0, flat);
  run(b, { throttle: 1, steer: 1 }, { sampleHeight: flat }, 6);
  assert.ok(b.pos.x < -0.5, `left steer goes left (x = ${b.pos.x.toFixed(2)})`);
  const c = createVehicleBody("sev", 0, 0, 0, flat);
  run(c, { throttle: 1, steer: 1, crab: true }, { sampleHeight: flat }, 6);
  assert.ok(Math.abs(vehiclePose(c).yaw) < 0.05, "crab keeps the heading");
  assert.ok(c.pos.x < -1, "crab drifts sideways");
});

test("driving off a 2 m ledge falls under Mars gravity and lands upright", () => {
  // start on the high side; the ground drops 2 m ahead (toward -z)
  const ground = (x, z) => (z < -6 ? 0 : 2);
  const b = createVehicleBody("lrv", 0, 0, 0, ground);
  let wasAir = false;
  let landedAt = -1;
  let maxImpact = 0;
  run(b, { throttle: 1 }, { sampleHeight: ground }, 12, (bb, i) => {
    if (bb.contacts === 0) wasAir = true;
    if (wasAir && landedAt < 0 && bb.contacts > 0) landedAt = i;
    maxImpact = Math.max(maxImpact, bb.lastImpact);
    for (const v of [bb.pos.x, bb.pos.y, bb.pos.z, bb.vel.y]) assert.ok(Number.isFinite(v));
  });
  assert.ok(wasAir, "left the ground at the drop");
  assert.ok(landedAt > 0, "landed again");
  assert.ok(upY(b) > 0.9, "upright after landing");
  assert.ok(vehiclePose(b).origin.y > -0.25, "not inside the ground");
});

test("on the real HiRISE corridor every vehicle stays on the ground (real speed and 2.5x)", async () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const fileFetch = async (u) => {
    try {
      return new Response(await fs.readFile(path.join(ROOT, u)), { status: 200 });
    } catch {
      return new Response("", { status: 404 });
    }
  };
  const c = await GaleCorridor.load("data/demo/corridor", { fetchFn: fileFetch });
  // habitat stop, scene coordinates
  const b0 = c.bounds;
  const sx = ((137.3875065 - b0.west_lon_deg) / (b0.east_lon_deg - b0.west_lon_deg) - 0.5) * c.worldW;
  const sz = (0.5 - (-4.79721368 - b0.south_lat_deg) / (b0.north_lat_deg - b0.south_lat_deg)) * c.worldH;
  await c.warmup(sx, sz, 400);
  const ground = (x, z) => c.sample(x, z) - c.elevMin;
  for (const [id, mult, maxAir] of VEHICLE_IDS.flatMap((v) => [[v, 1, 0.02], [v, 2.5, 0.08]])) {
    const b = createVehicleBody(id, sx, sz, 1.2, ground);
    let air = 0;
    let frames = 0;
    let deepest = 0;
    let minUp = 1;
    run(b, {}, { sampleHeight: ground }, 2);
    const input = { throttle: 1, steer: 0, speedMultiplier: mult };
    run(b, input, { sampleHeight: ground }, 60, (bb, i) => {
      input.steer = Math.sin(i / 90) * 0.5; // gentle weaving, like a driver following the terrain
      frames++;
      if (bb.contacts === 0) air++;
      const o = vehiclePose(bb).origin;
      deepest = Math.min(deepest, o.y - ground(o.x, o.z));
      minUp = Math.min(minUp, upY(bb));
      for (const v of [bb.pos.x, bb.pos.y, bb.pos.z]) assert.ok(Number.isFinite(v), "finite");
    });
    assert.ok(air / frames < maxAir, `${id} x${mult}: airborne ${((100 * air) / frames).toFixed(1)}% of the time`);
    assert.ok(deepest > -0.6, `${id}: never sinks into the ground (${deepest.toFixed(2)} m)`);
    assert.ok(minUp > 0.6, `${id}: stays upright (min up.y ${minUp.toFixed(2)})`);
    assert.ok(Math.hypot(b.pos.x - sx, b.pos.z - sz) > 20, `${id}: made progress`);
  }
});
