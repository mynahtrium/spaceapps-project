/**
 * Low-poly Gale rim and Mount Sharp silhouette beyond the mirrored tile.
 * +X east, +Z south. The summit sits to the southeast of the walker.
 */

export function createGaleVista(THREE) {
  const inner = 4200;
  const outer = 16000;
  const rings = 5;
  const segs = 72;
  const positions = [];
  const indices = [];
  const yAt = (r, x, z) => {
    const ang = Math.atan2(x, z); // 0 south, + toward east
    const se = Math.max(0, Math.cos(ang - Math.PI / 4));
    const north = Math.max(0, Math.cos(ang - Math.PI));
    const t = Math.max(0, Math.min(1, (r - inner) / (outer - inner)));
    const mound = se * se * (400 + 1500 * t);
    const rim = north * north * (80 + 520 * t);
    return mound + rim;
  };
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const r = inner + (outer - inner) * t * t;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      positions.push(x, yAt(r, x, z), z);
    }
  }
  const row = segs + 1;
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * row + i;
      indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x9a6a48,
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.visible = false;
  return mesh;
}
