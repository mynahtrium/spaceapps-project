import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as THREE from "../vendor/three.module.js";
import { createFootsteps } from "../hud/footsteps.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, "..");

function withMockCanvasDocument(fn) {
  const prevDoc = globalThis.document;
  const noop = () => {};
  const ctx2d = {
    clearRect: noop,
    beginPath: noop,
    moveTo: noop,
    bezierCurveTo: noop,
    closePath: noop,
    fill: noop,
    save: noop,
    clip: noop,
    stroke: noop,
    lineTo: noop,
    fillRect: noop,
    restore: noop,
  };
  globalThis.document = {
    hidden: false,
    createElement: () => ({ width: 128, height: 256, getContext: () => ctx2d }),
  };
  try {
    return fn();
  } finally {
    globalThis.document = prevDoc;
  }
}

test("footsteps reprojectAll snaps decals to newly streamed terrain height and clear hides all decals", () => {
  withMockCanvasDocument(() => {
    const scene = new THREE.Scene();
    const footsteps = createFootsteps(THREE, scene);
    const decals = scene.children.find((o) => o.isInstancedMesh && o.count === 256);
    assert.ok(decals, "Expected decals InstancedMesh in scene");

    // Stamp footprint on coarse overview ground (y = 10 m)
    footsteps.stamp(12, 10, -8, { x: 0, y: 1, z: 0 }, 0.3, "MUDSTONE", "L");

    const mat = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    decals.getMatrixAt(0, mat);
    mat.decompose(pos, quat, scale);
    assert.ok(Math.abs(pos.y - 10.012) < 1e-4);
    assert.ok(scale.z > 0.2);

    // 1 m detail chunk finishes loading with height 6.5 m -> reprojectAll updates decal onto ground
    const count = footsteps.reprojectAll(() => 6.5, () => ({ x: 0, y: 1, z: 0 }));
    assert.equal(count, 1);
    decals.getMatrixAt(0, mat);
    mat.decompose(pos, quat, scale);
    assert.ok(Math.abs(pos.y - 6.512) < 1e-4);

    // Teleporting / switching sites clears old world-space decals so none float in air
    footsteps.clear();
    decals.getMatrixAt(0, mat);
    mat.decompose(pos, quat, scale);
    assert.equal(scale.x, 0);
    assert.equal(scale.y, 0);
    assert.equal(scale.z, 0);
  });
});

test("hud3d clears footsteps across large teleports/site changes and stamps on rendered surface", () => {
  const hudSrc = fs.readFileSync(path.join(WEB_DIR, "hud", "hud3d.js"), "utf8");
  assert.match(hudSrc, /function sampleRenderedSurfaceY\(x, z\)/);
  assert.match(hudSrc, /footsteps\.clear\(\)/);
  assert.match(hudSrc, /footsteps\.reprojectAll\(sampleRenderedSurfaceY, sampleNormal\)/);
  assert.match(hudSrc, /if \(!drivingRover && !snappedThisFrame\)/);
  // the walker pose is reset on a snap; hud3d reuses one options object, so it assigns the field
  assert.match(hudSrc, /reset\s*[:=]\s*snappedThisFrame/);
});
