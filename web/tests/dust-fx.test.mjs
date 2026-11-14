import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ATLAS_COUNT,
  computeDustAtlasUv,
  createMarsDustSystem,
  stepDustGrain,
  stepDustPuff,
} from "../hud/dust-fx.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, "..");

function createMockThree() {
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    set(x, y, z) {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
    copy(v) {
      this.x = v.x;
      this.y = v.y;
      this.z = v.z;
      return this;
    }
    clone() {
      return new Vector3(this.x, this.y, this.z);
    }
    normalize() {
      const l = Math.hypot(this.x, this.y, this.z) || 1;
      this.x /= l;
      this.y /= l;
      this.z /= l;
      return this;
    }
    applyQuaternion() {
      return this;
    }
  }
  class Color {
    constructor(r = 0.6, g = 0.4, b = 0.3) {
      this.r = r;
      this.g = g;
      this.b = b;
    }
    clone() {
      return new Color(this.r, this.g, this.b);
    }
    copy(c) {
      this.r = c.r;
      this.g = c.g;
      this.b = c.b;
      return this;
    }
  }
  class BufferAttribute {
    constructor(array, itemSize) {
      this.array = array;
      this.itemSize = itemSize;
      this.needsUpdate = false;
    }
    setUsage() {
      return this;
    }
  }
  class BufferGeometry {
    constructor() {
      this.attributes = {};
      this.drawRange = { start: 0, count: 0 };
      this.index = null;
    }
    setAttribute(name, attr) {
      this.attributes[name] = attr;
    }
    setIndex(idx) {
      this.index = idx;
    }
    setDrawRange(start, count) {
      this.drawRange = { start, count };
    }
    dispose() {}
  }
  class ShaderMaterial {
    constructor(opts) {
      this.uniforms = opts.uniforms;
    }
    dispose() {}
  }
  class Mesh {
    constructor(geom, mat) {
      this.geometry = geom;
      this.material = mat;
    }
  }
  class Points extends Mesh {}
  return {
    Vector3,
    Color,
    BufferAttribute,
    BufferGeometry,
    ShaderMaterial,
    Mesh,
    Points,
    DynamicDrawUsage: 35048,
    DoubleSide: 2,
  };
}

test("mars-dust-atlas.png exists and is a valid PNG sprite sheet", () => {
  const atlasPath = path.join(WEB_ROOT, "assets", "dust", "mars-dust-atlas.png");
  const stat = fs.statSync(atlasPath);
  assert.ok(stat.size > 50_000, `expected valid atlas PNG size, got ${stat.size}`);
  const header = fs.readFileSync(atlasPath).subarray(0, 8);
  assert.deepEqual([...header], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test("computeDustAtlasUv produces bounded non-overlapping UVs across all 12 cells", () => {
  assert.equal(ATLAS_COUNT, 12);
  const cells = [];
  for (let i = 0; i < ATLAS_COUNT; i++) {
    const uv = computeDustAtlasUv(i);
    assert.ok(uv.u0 > 0 && uv.u1 < 1 && uv.u0 < uv.u1);
    assert.ok(uv.v0 > 0 && uv.v1 < 1 && uv.v0 < uv.v1);
    cells.push(uv);
  }
  // Cell 0 is top-left (high V, low U); cell 11 is bottom-right (low V, high U)
  assert.ok(cells[0].u1 < cells[1].u0);
  assert.ok(cells[0].v0 > cells[4].v1);
  assert.ok(cells[8].v0 < cells[4].v0);
  assert.ok(cells[11].u0 > 0.75 && cells[11].v1 < 0.34);
});

test("stepDustPuff expands, decelerates, and expires smoothly", () => {
  const puff = {
    alive: true,
    x: 0, y: 0.1, z: 0,
    vx: 1.0, vy: 0.6, vz: 0,
    startSize: 0.2,
    endSize: 1.0,
    size: 0.2,
    rot: 0,
    angVel: 1.0,
    age: 0,
    life: 1.0,
    fadeIn: 0.08,
    peakAlpha: 0.6,
    alpha: 0,
    drag: 2.5,
    buoyancy: 0.12,
    windCoupling: 0.8,
  };
  assert.equal(stepDustPuff(puff, 0.2), true);
  assert.ok(puff.size > 0.2 && puff.size < 1.0);
  assert.ok(puff.alpha > 0 && puff.alpha <= 0.6);
  assert.ok(puff.vx < 1.0);

  for (let i = 0; i < 10; i++) stepDustPuff(puff, 0.1);
  assert.equal(puff.alive, false);
});

test("stepDustGrain follows Mars 3.71 m/s^2 gravity along arbitrary surface normals and bounces once", () => {
  // Spherical tilted surface normal (3, 4, 0) / 5
  const invLen = 1 / 5;
  const nx = 3 * invLen;
  const ny = 4 * invLen;
  const grain = {
    alive: true,
    x: 0, y: 0.05, z: 0,
    gx: 0, gy: 0, gz: 0,
    nx, ny, nz: 0,
    vx: nx * 1.2 + 0.5, vy: ny * 1.2, vz: 0,
    age: 0,
    life: 1.5,
    size: 0.8,
    peakAlpha: 0.9,
    alpha: 0,
    bounced: false,
  };

  let bouncedObserved = false;
  for (let i = 0; i < 30; i++) {
    stepDustGrain(grain, 0.05, 3.71);
    if (grain.bounced) bouncedObserved = true;
  }
  assert.equal(bouncedObserved, true);
  const height = (grain.x - grain.gx) * grain.nx + (grain.y - grain.gy) * grain.ny;
  assert.ok(height >= -1e-6, `grain must not tunnel below ground plane, height=${height}`);
});

test("createMarsDustSystem emits footstep, takeoff, landing and handles shiftOrigin/clear", () => {
  const THREE = createMockThree();
  const added = [];
  const scene = {
    add(obj) { added.push(obj); },
    remove() {},
  };
  const dust = createMarsDustSystem({
    THREE,
    scene,
    atlasUrl: "",
    marsG: 3.71,
  });
  assert.equal(added.length, 2);

  dust.emitFootstep({ x: 1, y: 0, z: 2 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 1.0);
  const afterStep = dust.getActiveCounts();
  assert.ok(afterStep.puffs >= 5 && afterStep.grains >= 15);

  dust.emitTakeoff({ x: 1, y: 0, z: 2 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 });
  const afterTakeoff = dust.getActiveCounts();
  assert.ok(afterTakeoff.puffs > afterStep.puffs);

  dust.emitLanding({ x: 1, y: 0, z: 4 }, { x: 0, y: 1, z: 0 }, 4.2, { x: 0, y: 0, z: -1 });
  const afterLanding = dust.getActiveCounts();
  assert.ok(afterLanding.puffs >= afterTakeoff.puffs + 12);
  assert.ok(afterLanding.grains >= afterTakeoff.grains + 30);

  dust.shiftOrigin(10, -5, 20);
  const cam = { quaternion: new THREE.Vector3(0, 0, 0) };
  dust.update(0.016, cam, 1.0);
  assert.ok(added[0].geometry.drawRange.count > 0);
  assert.ok(added[1].geometry.drawRange.count > 0);

  dust.clear();
  assert.deepEqual(dust.getActiveCounts(), { puffs: 0, grains: 0 });
  dust.dispose();
});
