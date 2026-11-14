/**
 * Instanced rocks in a bubble around the walker. Super Graphics only.
 * Positions are a deterministic hash of the cell, so the field does not shimmer.
 */

const CELL = 3.2;
const RADIUS = 72;
const PER_MESH = 280;

function hash01(ix, iz, salt) {
  let n = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(salt, 1440678779);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

export function createRockField(THREE) {
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
  let anchorX = Infinity;
  let anchorZ = Infinity;

  function rebuild(px, pz, sampleY) {
    anchorX = px;
    anchorZ = pz;
    const cursors = [0, 0, 0, 0];
    const minX = Math.floor((px - RADIUS) / CELL);
    const maxX = Math.ceil((px + RADIUS) / CELL);
    const minZ = Math.floor((pz - RADIUS) / CELL);
    const maxZ = Math.ceil((pz + RADIUS) / CELL);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let iz = minZ; iz <= maxZ; iz++) {
      for (let ix = minX; ix <= maxX; ix++) {
        const h = hash01(ix, iz, 1);
        if (h > 0.22) continue;
        const jx = (hash01(ix, iz, 2) - 0.5) * CELL;
        const jz = (hash01(ix, iz, 3) - 0.5) * CELL;
        const x = ix * CELL + jx;
        const z = iz * CELL + jz;
        if (Math.hypot(x - px, z - pz) > RADIUS) continue;
        const kind = Math.floor(hash01(ix, iz, 4) * 4) % 4;
        const slot = cursors[kind];
        if (slot >= PER_MESH) continue;
        cursors[kind] += 1;
        const y = sampleY(x, z);
        dummy.position.set(x, y + 0.02, z);
        dummy.rotation.set(0, hash01(ix, iz, 5) * Math.PI * 2, (hash01(ix, iz, 6) - 0.5) * 0.4);
        const s = 0.45 + hash01(ix, iz, 7) * 1.5;
        dummy.scale.set(s, s * (0.45 + hash01(ix, iz, 8) * 0.8), s);
        dummy.updateMatrix();
        meshes[kind].setMatrixAt(slot, dummy.matrix);
      }
    }
    for (let k = 0; k < 4; k++) {
      for (let i = cursors[k]; i < PER_MESH; i++) meshes[k].setMatrixAt(i, zero);
      meshes[k].instanceMatrix.needsUpdate = true;
    }
  }

  function update(px, pz, sampleY, visible) {
    group.visible = visible;
    if (!visible) return;
    if (Math.hypot(px - anchorX, pz - anchorZ) < 14) return;
    rebuild(px, pz, sampleY);
  }

  return { group, update };
}
