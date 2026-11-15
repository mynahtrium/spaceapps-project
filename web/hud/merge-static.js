/**
 * Static mesh merging (`web/hud/merge-static.js`): fewer draw calls for models made of many parts.
 *
 * A rover built from 200 small meshes costs 200 draw calls in the main pass and another 200 in the
 * shadow pass, and the CPU (not the GPU) is what limits the frame rate. Parts that share a material
 * and never move relative to each other can be baked into one geometry per material with the same
 * picture. Call it on a subtree whose parts do not animate (a wheel spinner is fine: it turns as one).
 */

import {
  mergeGeometries,
  mergeVertices,
} from "../vendor/addons/utils/BufferGeometryUtils.js";

export { mergeGeometries, mergeVertices };

function prepareGeometryForMerge(geom, matrix) {
  let g = geom.clone();
  g.applyMatrix4(matrix);
  if (!g.index) {
    g = mergeVertices(g, 1e-6);
  }
  if (matrix.determinant() < 0 && g.index) {
    const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = t;
    }
    g.index.needsUpdate = true;
  }
  g.clearGroups();
  return g;
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
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      geoms.push(prepareGeometryForMerge(o.geometry, m));
    }
    const merged = mergeGeometries(geoms, false);
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
  const victimSet = new Set(victims);
  const keptGeoms = new Set();
  subtree.traverse((c) => {
    if (c.isMesh && !victimSet.has(c) && c.geometry) keptGeoms.add(c.geometry);
  });
  for (const o of victims) {
    o.parent?.remove(o);
    if (o.geometry && !keptGeoms.has(o.geometry)) {
      o.geometry.dispose?.();
    }
  }
  return { before, after };
}

/** Every Object3D found in a rig description (nested objects and arrays, a few levels deep). */
export function collectRigNodes(rig, out = [], depth = 0) {
  if (!rig || depth > 4) return out;
  if (rig.isObject3D) {
    out.push(rig);
    return out;
  }
  if (typeof rig !== "object") return out;
  for (const v of Array.isArray(rig) ? rig : Object.values(rig)) collectRigNodes(v, out, depth + 1);
  return out;
}

/**
 * Merge a model that has moving parts. `movers` are the nodes that get animated or shown / hidden
 * (wheel spinners, steering knuckles, suspension arms, containers that are toggled). Every mesh is
 * baked into one mesh per material under the nearest mover above it (or under `root`), so each
 * rigid piece still moves as before but costs a handful of draw calls instead of hundreds.
 * A mesh that is itself a mover, or sits under a hidden node that is not a mover, is left alone.
 * Returns { before, after } mesh counts.
 */
export function mergeRigidParts(THREE, root, movers = []) {
  const anchors = new Set(movers.filter(Boolean));
  anchors.add(root);
  root.updateWorldMatrix(true, true);
  const buckets = new Map(); // anchor -> Map(key -> { material, cast, recv, items })
  let before = 0;
  const visit = (o, anchor, hidden) => {
    const isAnchor = anchors.has(o);
    if (isAnchor) {
      anchor = o;
      hidden = false;
    } else if (!o.visible) hidden = true;
    if (o.isMesh) {
      before++;
      const g = o.geometry;
      const ok =
        !isAnchor &&
        !hidden &&
        o.children.length === 0 &&
        !o.isSkinnedMesh &&
        !o.isInstancedMesh &&
        !o.userData?.noMerge &&
        !o.userData?.isLocator &&
        o.material &&
        !Array.isArray(o.material) &&
        !o.material.transparent &&
        g?.attributes?.position &&
        !g.morphAttributes?.position;
      if (ok) {
        const names = Object.keys(g.attributes).sort().join(",");
        const key = `${o.material.uuid}|${names}|${g.index ? "i" : "n"}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}`;
        let byKey = buckets.get(anchor);
        if (!byKey) buckets.set(anchor, (byKey = new Map()));
        let b = byKey.get(key);
        if (!b) byKey.set(key, (b = { material: o.material, cast: o.castShadow, recv: o.receiveShadow, items: [] }));
        b.items.push(o);
      }
    }
    for (const c of o.children) visit(c, anchor, hidden);
  };
  visit(root, root, false);

  let removed = 0;
  let added = 0;
  const inv = new THREE.Matrix4();
  const m = new THREE.Matrix4();
  const victims = [];
  for (const [anchor, byKey] of buckets) {
    inv.copy(anchor.matrixWorld).invert();
    for (const b of byKey.values()) {
      if (b.items.length < 2) continue;
      const geoms = [];
      for (const o of b.items) {
        m.multiplyMatrices(inv, o.matrixWorld);
        geoms.push(prepareGeometryForMerge(o.geometry, m));
      }
      const merged = mergeGeometries(geoms, false);
      for (const g of geoms) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, b.material);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = b.recv;
      const src = b.items[0].userData || {};
      // the geometry is new (ours to dispose); the material may still belong to a shared model
      mesh.userData = { ...src, merged: true, sharedAsset: false, sharedMaterial: Boolean(src.sharedAsset) };
      anchor.add(mesh);
      added++;
      removed += b.items.length;
      for (const o of b.items) victims.push(o);
    }
  }
  const victimSet = new Set(victims);
  const keptGeoms = new Set();
  root.traverse((c) => {
    if (c.isMesh && !victimSet.has(c) && c.geometry) keptGeoms.add(c.geometry);
  });
  for (const o of victims) {
    o.parent?.remove(o);
    if (o.geometry && !keptGeoms.has(o.geometry) && !o.userData?.sharedAsset) o.geometry.dispose?.();
  }
  return { before, after: before - removed + added };
}
