import test from "node:test";
import assert from "node:assert/strict";

import {
  MARS_RUN_STRIDE_M,
  MARS_WALK_STRIDE_M,
  MARS_WALK_VELOCITY_MS,
  computeFootstepDustIntensity,
  computeMarsCameraSway,
  computeMarsGaitSample,
} from "../hud/mars-gait.js";
import { createMarsDustSystem } from "../hud/dust-fx.js";

function createMinimalThree() {
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone() { return new Vector3(this.x, this.y, this.z); }
    normalize() { return this; }
  }
  class Color {
    constructor(r = 0.6, g = 0.4, b = 0.3) { this.r = r; this.g = g; this.b = b; }
    clone() { return new Color(this.r, this.g, this.b); }
    copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
  }
  class BufferAttribute {
    constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; }
    setUsage() { return this; }
  }
  class BufferGeometry {
    setAttribute() {}
    setIndex() {}
    setDrawRange() {}
    dispose() {}
  }
  class ShaderMaterial {
    constructor(opts) { this.uniforms = opts.uniforms; }
    dispose() {}
  }
  class Mesh {
    constructor(g, m) { this.geometry = g; this.material = m; }
  }
  class Points extends Mesh {}
  return { Vector3, Color, BufferAttribute, BufferGeometry, ShaderMaterial, Mesh, Points, DynamicDrawUsage: 35048, DoubleSide: 2 };
}

test("Mars gait constants match EwhaGlab 1/3g IPC walking and running measurements", () => {
  assert.equal(MARS_WALK_VELOCITY_MS, 0.8);
  assert.equal(MARS_WALK_STRIDE_M, 1.08);
  assert.equal(MARS_RUN_STRIDE_M, 1.75);
});

test("computeMarsGaitSample models buoyant 1/3g pelvis arc, PLSS lean, and out-of-phase limbs", () => {
  const midStance = computeMarsGaitSample({ phase: 0, amount: 1, air: 0, dirF: 1, dirS: 0 });
  const pushOff = computeMarsGaitSample({ phase: Math.PI * 0.5, amount: 1, air: 0, dirF: 1, dirS: 0 });

  // Buoyant 1/3g rise during mid-stance (cos=1), mild plant cushion at transition
  assert.ok(midStance.pelvisYOffset > 0.015, `expected positive buoyant crest, got ${midStance.pelvisYOffset}`);
  assert.ok(pushOff.pelvisYOffset < midStance.pelvisYOffset);

  // Subtle ~5 deg forward torso lean balancing PLSS backpack & clear trailing knee bend
  assert.ok(midStance.spinePitch > 0.06 && midStance.spinePitch < 0.14);
  assert.ok(midStance.L.knee > 0.5 && midStance.R.knee < 0.25);

  // Calmer arm swing than Earth running
  assert.ok(Math.abs(pushOff.armSwingL) < 0.2 && pushOff.armOut >= 0.05);
});

test("computeMarsCameraSway stays subtle and synchronized with 1/3g stride", () => {
  const idle = computeMarsCameraSway(1.2, 0);
  assert.equal(idle.swayY, 0);
  assert.equal(idle.swayX, 0);

  const crest = computeMarsCameraSway(0, 1);
  const trough = computeMarsCameraSway(Math.PI * 0.5, 1);
  assert.ok(crest.swayY > trough.swayY);
  assert.ok(Math.abs(crest.swayRoll) < 0.01);
});

test("walking dust intensity is ~60% lower than running while running remains at full 1.55 intensity", () => {
  const walkInt = computeFootstepDustIntensity(MARS_WALK_VELOCITY_MS);
  const runInt = computeFootstepDustIntensity(2.25);
  assert.equal(walkInt, 0.4);
  assert.equal(runInt, 1.55);

  const THREE = createMinimalThree();
  const sceneWalk = { add() {}, remove() {} };
  const dustWalk = createMarsDustSystem({ THREE, scene: sceneWalk, atlasUrl: "" });
  dustWalk.emitFootstep({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, walkInt);
  const walkCounts = dustWalk.getActiveCounts();

  const sceneRun = { add() {}, remove() {} };
  const dustRun = createMarsDustSystem({ THREE, scene: sceneRun, atlasUrl: "" });
  dustRun.emitFootstep({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, runInt);
  const runCounts = dustRun.getActiveCounts();

  // Previous walking intensity (~1.0) emitted ~8 puffs & ~21 grains; now walking emits <= 4 puffs & <= 9 grains (>= 60% reduction)
  assert.ok(walkCounts.puffs <= 4, `expected <=4 puffs on walk, got ${walkCounts.puffs}`);
  assert.ok(walkCounts.grains <= 9, `expected <=9 grains on walk, got ${walkCounts.grains}`);
  // Running keeps full 11 puffs (7 shear + 4 plume) & 26 grains
  assert.equal(runCounts.puffs, 11);
  assert.equal(runCounts.grains, 26);

  dustWalk.dispose();
  dustRun.dispose();
});
