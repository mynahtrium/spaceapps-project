/**
 * Static mesh merging (`web/hud/merge-static.js`): fewer draw calls for models made of many parts.
 *
 * A rover built from 200 small meshes costs 200 draw calls in the main pass and another 200 in the
 * shadow pass, and the CPU (not the GPU) is what limits the frame rate. Parts that share a material
 * and never move relative to each other can be baked into one geometry per material with the same
 * picture. Call it on a subtree whose parts do not animate (a wheel spinner is fine: it turns as one).
 */

/** Concatenate geometries with identical attribute layouts (all indexed or all non-indexed). */
function mergeGeometries(THREE, geoms) {
  const first = geoms[0];
  const names = Object.keys(first.attributes);
  const indexed = Boolean(first.index);
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const a0 = first.attributes[name];
    if (a0.isInterleavedBufferAttribute) return null;
    let total = 0;
    for (const g of geoms) {
      const a = g.attributes[name];
      if (!a || a.itemSize !== a0.itemSize || a.normalized !== a0.normalized || a.array.constructor !== a0.array.constructor) return null;
      total += a.array.length;
    }
    const arr = new a0.array.constructor(total);
    let off = 0;
    for (const g of geoms) {
      arr.set(g.attributes[name].array, off);
      off += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, a0.itemSize, a0.normalized));
  }
  if (indexed) {
    let count = 0;
    let verts = 0;
    for (const g of geoms) {
      if (!g.index) return null;
      count += g.index.count;
    }
    const idx = new Uint32Array(count);
    let o = 0;
    for (const g of geoms) {
      const src = g.index.array;
      for (let i = 0; i < src.length; i++) idx[o + i] = src[i] + verts;
      o += src.length;
      verts += g.attributes.position.count;
    }
    out.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return out;
}

function flipWinding(THREE, geom) {
  if (!geom.index) {
    const n = geom.attributes.position.count;
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    geom.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  const a = geom.index.array;
  for (let i = 0; i < a.length; i += 3) {
    const t = a[i + 1];
    a[i + 1] = a[i + 2];
    a[i + 2] = t;
  }
  geom.index.needsUpdate = true;
}

/**
 * Merge the plain meshes under `subtree` into one mesh per (material, attribute layout), placed
 * under `subtree` itself, in `subtree`'s own space. Skips skinned, instanced, transparent-sorted,
 * multi-material and flagged (`userData.noMerge`) meshes. Returns { before, after } mesh counts.
 */
export function mergeStaticMeshes(THREE, subtree, { castShadow = true, receiveShadow = true, tag = null } = {}) {
  subtree.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(subtree.matrixWorld).invert();
  const groups = new Map();
  const victims = [];
  let before = 0;
  subtree.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o === subtree) return;
    before++;
    if (o.userData?.noMerge || o.userData?.isLocator || Array.isArray(o.material)) return;
    const g = o.geometry;
    if (!g?.attributes?.position || g.morphAttributes?.position) return;
    if (o.material?.transparent) return; // keep sorting behaviour
    const names = Object.keys(g.attributes).sort().join(",");
    const key = `${o.material.uuid}|${names}|${g.index ? "i" : "n"}`;
    let list = groups.get(key);
    if (!list) groups.set(key, (list = { material: o.material, items: [] }));
    list.items.push(o);
    victims.push(o);
  });

  let after = before - victims.length;
  for (const { material, items } of groups.values()) {
    if (items.length < 2) {
      after += items.length;
      for (const o of items) victims.splice(victims.indexOf(o), 1);
      continue;
    }
    const geoms = [];
    for (const o of items) {
      const g = o.geometry.clone();
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      g.applyMatrix4(m);
      if (m.determinant() < 0) flipWinding(THREE, g);
      // drop anything the merge cannot align (groups, ranges) so draw ranges stay whole
      g.clearGroups();
      geoms.push(g);
    }
    const merged = mergeGeometries(THREE, geoms);
    for (const g of geoms) g.dispose();
    if (!merged) {
      after += items.length;
      for (const o of items) victims.splice(victims.indexOf(o), 1);
      continue;
    }
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.userData = { ...(items[0].userData || {}), merged: true, sharedAsset: false };
    if (tag) Object.assign(mesh.userData, tag);
    subtree.add(mesh);
    after++;
  }
  for (const o of victims) o.parent?.remove(o);
  return { before, after };
}
