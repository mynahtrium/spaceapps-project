/**
 * Instanced rocks in a bubble around the walker (`web/hud/MarsRockField.js`).
 * Uses `MeshSurfaceSampler` (`three/addons/math/MeshSurfaceSampler.js`) weighted by 2D Simplex noise
 * (`simplex-noise`) and deterministic `seedrandom` PRNG so boulder clusters follow terrain relief
 * without shimmering or overlapping excluded footprints.
 */

import seedrandom from "seedrandom";
import { createNoise2D } from "simplex-noise";
// three/addons/math/MeshSurfaceSampler.js
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";

const CELL = 3.2;
const RADIUS = 72;
const PER_MESH = 280;
const PATCH_SEGMENTS = 28;
const SAMPLE_CANDIDATES = 960;

export function createRockField(THREE) {
  const noisePrng = seedrandom("mars-gale-rock-simplex-v1");
  const noise2D = createNoise2D(noisePrng);

  const mat = new THREE.MeshStandardMaterial({ color: 0x8d684c, roughness: 0.94, metalness: 0.02 });
  const geos = [
    new THREE.DodecahedronGeometry(0.28, 0),
    new THREE.BoxGeometry(0.42, 0.16, 0.3),
    new THREE.IcosahedronGeometry(0.22, 0),
    new THREE.CapsuleGeometry(0.1, 0.22, 2, 5),
  ];
  const meshes = geos.map((geo) => {
    const mesh = new THREE.InstancedMesh(geo, mat, PER_MESH);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.visible = false;
    return mesh;
  });
  const group = new THREE.Group();
  for (const mesh of meshes) group.add(mesh);

  const dummy = new THREE.Object3D();
  const samplePos = new THREE.Vector3();
  const sampleNormal = new THREE.Vector3();
  let anchorX = Infinity;
  let anchorZ = Infinity;

  function buildSurfacePatch(cx, cz, sampleY, exclude) {
    const geom = new THREE.PlaneGeometry(RADIUS * 2, RADIUS * 2, PATCH_SEGMENTS, PATCH_SEGMENTS);
    geom.rotateX(-Math.PI / 2);
    const pos = geom.attributes.position;
    const weights = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const wx = cx + pos.getX(i);
      const wz = cz + pos.getZ(i);
      const wy = sampleY(wx, wz);
      pos.setXYZ(i, wx, wy, wz);
      if (exclude && exclude(wx, wz)) {
        weights[i] = 0;
      } else {
        const n = 0.5 + 0.5 * noise2D(wx * 0.035, wz * 0.035);
        weights[i] = Math.max(0.05, n * n);
      }
    }
    geom.setAttribute("rockWeight", new THREE.BufferAttribute(weights, 1));
    geom.computeVertexNormals();
    return new THREE.Mesh(geom, mat);
  }

  function rebuild(px, pz, sampleY, exclude) {
    anchorX = px;
    anchorZ = pz;
    const snapX = Math.round(px / CELL) * CELL;
    const snapZ = Math.round(pz / CELL) * CELL;
    const rng = seedrandom(`mars-rock-patch:${snapX}:${snapZ}`);

    const patchMesh = buildSurfacePatch(snapX, snapZ, sampleY, exclude);
    const sampler = new MeshSurfaceSampler(patchMesh)
      .setWeightAttribute("rockWeight")
      .setRandomGenerator(rng)
      .build();

    const cursors = [0, 0, 0, 0];
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);

    for (let sIdx = 0; sIdx < SAMPLE_CANDIDATES; sIdx++) {
      sampler.sample(samplePos, sampleNormal);
      const x = samplePos.x;
      const z = samplePos.z;
      if (Math.hypot(x - px, z - pz) > RADIUS) continue;
      if (exclude && exclude(x, z)) continue;

      const density = 0.5 + 0.5 * noise2D(x * 0.06, z * 0.06);
      if (rng() > 0.32 + density * 0.45) continue;

      const kind = Math.floor(rng() * 4) % 4;
      const slot = cursors[kind];
      if (slot >= PER_MESH) continue;
      cursors[kind] += 1;

      const y = sampleY(x, z);
      dummy.position.set(x, y + 0.02, z);
      dummy.rotation.set(
        (sampleNormal.z || 0) * 0.25,
        rng() * Math.PI * 2,
        -(sampleNormal.x || 0) * 0.25 + (rng() - 0.5) * 0.35
      );
      const s = 0.45 + rng() * 1.5;
      dummy.scale.set(s, s * (0.45 + rng() * 0.8), s);
      dummy.updateMatrix();
      meshes[kind].setMatrixAt(slot, dummy.matrix);
    }

    patchMesh.geometry.dispose();

    for (let k = 0; k < 4; k++) {
      for (let i = cursors[k]; i < PER_MESH; i++) meshes[k].setMatrixAt(i, zero);
      meshes[k].instanceMatrix.needsUpdate = true;
    }
  }

  function update(px, pz, sampleY, visible, exclude = null) {
    group.visible = visible;
    if (!visible) return;
    if (Math.hypot(px - anchorX, pz - anchorZ) < 14) return;
    rebuild(px, pz, sampleY, exclude);
  }

  return { group, update };
}
