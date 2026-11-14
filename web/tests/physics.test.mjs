import test from "node:test";
import assert from "node:assert/strict";

import { ellipsoidMetersPerDeg, marsGravityMs2 } from "../physics/MarsGravityField.js";
import { createMarsBody, FIXED_DT, STEP_UP_M, stepPhysicsWorld } from "../physics/MarsPhysicsWorld.js";
import {
  FROUDE_LOPE_MS,
  JUMP_SPEED_MS,
  RUN_SPEED_MS,
  WALK_SPEED_MS,
  gradeSpeedScale,
  landingControl,
} from "../physics/SuitBiomechanics.js";

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

test("mudstone braking from 2.5 m/s takes about 0.98 s and 1.22 m", () => {
  const body = createMarsBody({ vx: 2.5, vy: 0, vz: 0, y: 0, grounded: true });
  let t = 0;
  while (body.vx > 0.02 && t < 5) {
    stepPhysicsWorld(body, FIXED_DT, { wishX: 0, wishZ: 0, latDeg: -4.8, slopeLimitDeg: 20 }, ENV_FLAT);
    t += FIXED_DT;
  }
  assert.equal(body.faciesId, "MUDSTONE_SLAB");
  assert.ok(Math.abs(t - 0.98) <= 0.05, `time ${t}`);
  assert.ok(Math.abs(body.x - 1.22) <= 0.05, `distance ${body.x}`);
});

test("a 30 degree slope is walkable uphill", () => {
  const rise = Math.tan((30 * Math.PI) / 180);
  const body = createMarsBody({ y: 0, grounded: true });
  const env = { sampleHeight: (x) => x * rise, molaElevM: () => -4500 };
  for (let i = 0; i < 240; i++) {
    stepPhysicsWorld(body, FIXED_DT, { wishX: 1, wishZ: 0, latDeg: -4.8 }, env);
  }
  assert.ok(body.grounded, "stays on the ground");
  assert.ok(body.x > 1.2, `climbed only ${body.x} m in 2 s`);
  assert.ok(body.vx > 0.5, `vx ${body.vx}`);
});

test("steep ground never slides: standing holds, walking climbs", () => {
  const rise = Math.tan((55 * Math.PI) / 180);
  const env = { sampleHeight: (x) => x * rise, molaElevM: () => -4500 };
  const still = createMarsBody({ x: 2, y: 2 * rise, grounded: true });
  for (let i = 0; i < 240; i++) stepPhysicsWorld(still, FIXED_DT, { latDeg: -4.8 }, env);
  assert.ok(Math.abs(still.x - 2) < 1e-9, `slid to x ${still.x}`);
  const climber = createMarsBody({ x: 0, y: 0, grounded: true });
  for (let i = 0; i < 240; i++) stepPhysicsWorld(climber, FIXED_DT, { wishX: 1, latDeg: -4.8 }, env);
  assert.ok(climber.x > 1, `climbed only ${climber.x} m`);
});

test("jump peaks at v^2 / 2g under Mars gravity", () => {
  const body = createMarsBody({ y: 0, grounded: true, jumpQueued: true });
  let peak = 0;
  let airT = 0;
  for (let i = 0; i < 400; i++) {
    stepPhysicsWorld(body, FIXED_DT, { latDeg: -4.8 }, ENV_FLAT);
    peak = Math.max(peak, body.y);
    if (!body.grounded) airT += FIXED_DT;
    else if (airT > 0) break;
  }
  const expected = (JUMP_SPEED_MS * JUMP_SPEED_MS) / (2 * 3.717);
  assert.ok(Math.abs(peak - expected) < 0.05, `peak ${peak} vs ${expected}`);
  assert.ok(Math.abs(airT - (2 * JUMP_SPEED_MS) / 3.717) < 0.05, `air time ${airT}`);
});

test("small ledges are stepped onto, tall ones block until jumped", () => {
  const small = { sampleHeight: (x) => (x > 1 ? STEP_UP_M * 0.6 : 0), molaElevM: () => -4500 };
  const a = createMarsBody({ y: 0, grounded: true });
  for (let i = 0; i < 240; i++) stepPhysicsWorld(a, FIXED_DT, { wishX: 1, latDeg: -4.8 }, small);
  assert.ok(a.x > 1.5, `stuck at small step, x ${a.x}`);

  const tall = { sampleHeight: (x) => (x > 1 ? 0.8 : 0), molaElevM: () => -4500 };
  const b = createMarsBody({ y: 0, grounded: true });
  for (let i = 0; i < 240; i++) stepPhysicsWorld(b, FIXED_DT, { wishX: 1, latDeg: -4.8 }, tall);
  assert.ok(b.x <= 1, `walked through a 0.8 m wall, x ${b.x}`);
  b.jumpQueued = true;
  for (let i = 0; i < 360; i++) stepPhysicsWorld(b, FIXED_DT, { wishX: 1, latDeg: -4.8 }, tall);
  assert.ok(b.x > 1 && b.grounded && b.y > 0.7, `jump onto ledge failed: x ${b.x} y ${b.y}`);
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

test("Mars gait speeds sit either side of the Froude 0.5 walk-to-lope transition", () => {
  assert.ok(WALK_SPEED_MS < FROUDE_LOPE_MS, `walk ${WALK_SPEED_MS} vs ${FROUDE_LOPE_MS}`);
  assert.ok(RUN_SPEED_MS > FROUDE_LOPE_MS, `run ${RUN_SPEED_MS} vs ${FROUDE_LOPE_MS}`);
});

test("grade scale slows steep climbs and descents but never stops the walker", () => {
  assert.equal(gradeSpeedScale(0), 1);
  assert.ok(gradeSpeedScale(30) < 1 && gradeSpeedScale(80) >= 0.55);
  assert.ok(gradeSpeedScale(-30) < 1 && gradeSpeedScale(-80) >= 0.6);
});

test("hard landings cost control briefly, soft ones do not", () => {
  assert.equal(landingControl(1.0, 0, 0.4), 1);
  assert.ok(landingControl(4.5, 0, 0.7) < 0.4);
  assert.equal(landingControl(4.5, 0.7, 0.7), 1);
});

test("walking off a 2 m ledge falls under Mars g and lands", () => {
  const env = { sampleHeight: (x) => (x > 1 ? -2 : 0), molaElevM: () => -4500 };
  const body = createMarsBody({ y: 0, grounded: true });
  let wasAirborne = false;
  for (let i = 0; i < 480; i++) {
    stepPhysicsWorld(body, FIXED_DT, { wishX: 1, latDeg: -4.8 }, env);
    if (!body.grounded) wasAirborne = true;
  }
  assert.ok(wasAirborne, "never left the ground");
  assert.ok(body.grounded && body.y < -1.9, `y ${body.y}`);
});
