import test from "node:test";
import assert from "node:assert/strict";

import { ellipsoidMetersPerDeg, marsGravityMs2 } from "../physics/MarsGravityField.js";
import { createMarsBody, FIXED_DT, stepPhysicsWorld } from "../physics/MarsPhysicsWorld.js";

const ENV_FLAT = {
  sampleHeight: () => 0,
  molaElevM: () => -4500,
};

test("marsGravityMs2 at Gale matches Lewis et al. 2019", () => {
  const g = marsGravityMs2(-4.8, -4500);
  assert.ok(Math.abs(g - 3.717) <= 0.002, `g = ${g}`);
});

test("ellipsoid metres per degree at 4.80 S", () => {
  const m = ellipsoidMetersPerDeg(-4.8);
  assert.ok(Math.abs(m.northSouthM - 58584.5) <= 10, `N-S ${m.northSouthM}`);
  assert.ok(Math.abs(m.eastWestM - 59059.4) <= 10, `E-W ${m.eastWestM}`);
});

test("releasing the keys stops the walker quickly (under 0.5 s and 0.6 m from 2.5 m/s)", () => {
  const body = createMarsBody({ vx: 2.5, vy: 0, vz: 0, y: 0, grounded: true });
  let t = 0;
  while (body.vx > 0.02 && t < 5) {
    stepPhysicsWorld(body, FIXED_DT, { wishX: 0, wishZ: 0, latDeg: -4.8, slopeLimitDeg: 20 }, ENV_FLAT);
    t += FIXED_DT;
  }
  assert.equal(body.faciesId, "MUDSTONE_SLAB");
  assert.ok(t < 0.5, `time ${t}`);
  assert.ok(body.x < 0.6 && body.vx === 0, `distance ${body.x}, vx ${body.vx}`);
});

test("a 24 degree slope slips downhill instead of climbing", () => {
  const rise = Math.tan((24 * Math.PI) / 180);
  const body = createMarsBody({ vx: 0.4, y: 0, grounded: true });
  const env = {
    sampleHeight: (x) => x * rise,
    molaElevM: () => -4500,
  };
  for (let i = 0; i < 180; i++) {
    stepPhysicsWorld(
      body,
      FIXED_DT,
      { wishX: 1, wishZ: 0, run: true, latDeg: -4.8, slopeLimitDeg: 20 },
      env
    );
  }
  const uphillSpeed = body.vx * body.uphillX + body.vz * body.uphillZ;
  assert.ok(body.slopeDeg > 20, `slope ${body.slopeDeg}`);
  assert.ok(uphillSpeed < 0, `uphill speed ${uphillSpeed}`);
  assert.ok(body.vx < 0, `vx ${body.vx} should follow the downhill gradient`);
});

test("airborne horizontal speed stays within 1% when strafing", () => {
  const body = createMarsBody({ x: 0, y: 6, z: 0, vx: 2, vz: 0, vy: 0.4, grounded: false });
  for (let i = 0; i < 48; i++) {
    stepPhysicsWorld(
      body,
      FIXED_DT,
      { wishX: 0, wishZ: 1, run: false, latDeg: -4.8, slopeLimitDeg: 20 },
      ENV_FLAT
    );
  }
  assert.equal(body.grounded, false);
  assert.ok(Math.abs(body.vx - 2) / 2 < 0.01, `vx ${body.vx}`);
});
