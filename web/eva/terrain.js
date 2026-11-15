/**
 * Real terrain for the 3D rehearsal view (`web/eva/terrain.js`).
 *
 * Every height drawn here is measured data, finest first:
 *   1. HiRISE DTM DTEEC_009149 (MRO), 1 m posts, streamed in 128 x 128 m chunks around the walker.
 *   2. The same DTM's ~8 m overview grid over the whole 2.1 x 5.4 km corridor.
 *   3. MGS MOLA MEGDR global topography (8 px/deg, about 7.4 km) out to `farRadiusM`, so the real
 *      Gale crater rim and Mount Sharp stand on the horizon. Imagery there is the Viking MDIM 2.1
 *      colour mosaic (about 5 km/px).
 * Nothing is mirrored, repeated or generated. Outside the corridor the ground is as coarse as MOLA is,
 * and the HUD says which source is under the walker.
 *
 * Scene frame: origin at the corridor centre, +x east, +z south, +y up, metres. Heights are metres
 * above `elevBase` (the corridor's lowest areoid elevation), so scene y + elevBase = MOLA-areoid height.
 */

import { buildCorridorSubCellGeometry } from "../map/GaleCorridor.js";
import { patchAtmosphericHaze } from "../hud/MarsAtmosphereHaze.js";

const SUBDIV = 2; // 256 px data chunks drawn as 2 x 2 meshes of 128 x 128 m
const COV_N = 16; // coverage mask cells around the walker (overview is cut away under ready chunks)
const MARS_R_M = 3389500;
const DEG = Math.PI / 180;

export function createRealTerrain(THREE, {
  corridor,
  scene,
  renderer,
  atmoUniforms,
  getGfx,
  sampleMolaM = null,
  vikingUrl = null,
  farRadiusM = 70000,
  farSeg = 220,
}) {
  const elevBase = corridor.elevMin;
  const W = corridor.worldW;
  const H = corridor.worldH;
  const b = corridor.bounds;
  const lon0 = (b.west_lon_deg + b.east_lon_deg) / 2;
  const lat0 = (b.south_lat_deg + b.north_lat_deg) / 2;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const texLoader = new THREE.TextureLoader();

  // ---------- frame conversions (corridor: linear in lon/lat; far ring: local tangent plane) ----------
  const lonToX = (lon) => ((lon - b.west_lon_deg) / (b.east_lon_deg - b.west_lon_deg) - 0.5) * W;
  const latToZ = (lat) => (0.5 - (lat - b.south_lat_deg) / (b.north_lat_deg - b.south_lat_deg)) * H;
  const xToLon = (x) => b.west_lon_deg + (x / W + 0.5) * (b.east_lon_deg - b.west_lon_deg);
  const zToLat = (z) => b.south_lat_deg + (0.5 - z / H) * (b.north_lat_deg - b.south_lat_deg);
  const insideCorridor = (x, z) => Math.abs(x) <= W / 2 && Math.abs(z) <= H / 2;

  // ---------- curvature (vertices drop by d^2 / 2R so the far horizon sits where it really is) ----------
  const curvature = {
    uCurvAnchor: { value: new THREE.Vector2() },
    uCurvInv2N: { value: 1 / (2 * MARS_R_M) },
    uCurvInv2M: { value: 1 / (2 * MARS_R_M) },
  };

  // ---------- shared coverage mask ----------
  const covData = new Uint8Array(COV_N * COV_N * 4);
  const covTex = new THREE.DataTexture(covData, COV_N, COV_N, THREE.RGBAFormat);
  covTex.magFilter = covTex.minFilter = THREE.NearestFilter;
  covTex.needsUpdate = true;
  const sub = corridor.subCellSize(SUBDIV);
  const covU = {
    uCov: { value: covTex },
    uCovOrigin: { value: new THREE.Vector2() },
    uCovCell: { value: new THREE.Vector2(sub.chunkW, sub.chunkH) },
    uCorridorHalf: { value: new THREE.Vector2(W / 2, H / 2) },
  };

  /** Adds the coverage cut (overview under ready chunks) or the corridor cut (far ring) to a material. */
  function patchCut(mat, mode) {
    mat.customProgramCacheKey = () => `mm-eva-terrain-${mode}`;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, covU);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vCutXZ;")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvCutXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
      const cut =
        mode === "overview"
          ? `vec2 cc = (vCutXZ - uCovOrigin) / uCovCell;
             if (cc.x >= 0.0 && cc.y >= 0.0 && cc.x < ${COV_N}.0 && cc.y < ${COV_N}.0 &&
                 texture2D(uCov, (floor(cc) + 0.5) / ${COV_N}.0).r > 0.5) discard;`
          : mode === "far"
            ? "if (abs(vCutXZ.x) < uCorridorHalf.x && abs(vCutXZ.y) < uCorridorHalf.y) discard;"
            : "";
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>\nvarying vec2 vCutXZ;\nuniform sampler2D uCov;\nuniform vec2 uCovOrigin;\nuniform vec2 uCovCell;\nuniform vec2 uCorridorHalf;`
        )
        .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n${cut}`);
    };
    // haze + curvature are chained after the cut (patchAtmosphericHaze wraps onBeforeCompile)
    patchAtmosphericHaze(THREE, mat, atmoUniforms, { curvature });
    return mat;
  }

  function groundMaterial(map, mode) {
    const m = new THREE.MeshStandardMaterial({ map, roughness: 0.96, metalness: 0 });
    m.envMapIntensity = 0.7;
    return patchCut(m, mode);
  }

  const prepTex = (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    return t;
  };

  // ---------- skirt: a strip hanging from every edge hides cracks between meshes of different density ----------
  function addSkirt(g, segX, segZ, depth) {
    const n = segX + 1;
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    const nor = g.attributes.normal;
    const ring = [];
    for (let i = 0; i < n; i++) ring.push(i);
    for (let j = 1; j <= segZ; j++) ring.push(j * n + segX);
    for (let i = segX - 1; i >= 0; i--) ring.push(segZ * n + i);
    for (let j = segZ - 1; j >= 1; j--) ring.push(j * n);
    const base = pos.count;
    const m = ring.length;
    const P = new Float32Array((base + 2 * m) * 3);
    const U = new Float32Array((base + 2 * m) * 2);
    const N = new Float32Array((base + 2 * m) * 3);
    P.set(pos.array);
    U.set(uv.array);
    N.set(nor.array);
    ring.forEach((src, k) => {
      for (const [o, dy] of [
        [base + 2 * k, 0],
        [base + 2 * k + 1, -depth],
      ]) {
        P[o * 3] = pos.getX(src);
        P[o * 3 + 1] = pos.getY(src) + dy;
        P[o * 3 + 2] = pos.getZ(src);
        U[o * 2] = uv.getX(src);
        U[o * 2 + 1] = uv.getY(src);
        N[o * 3] = nor.getX(src);
        N[o * 3 + 1] = nor.getY(src);
        N[o * 3 + 2] = nor.getZ(src);
      }
    });
    const idx = Array.from(g.index.array);
    for (let k = 0; k < m; k++) {
      const a = base + 2 * k;
      const c = base + 2 * ((k + 1) % m);
      idx.push(a, a + 1, c, c, a + 1, c + 1, a, c, a + 1, c, c + 1, a + 1);
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(P, 3));
    out.setAttribute("uv", new THREE.BufferAttribute(U, 2));
    out.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    out.setIndex(idx);
    out.computeBoundingSphere();
    out.computeBoundingBox();
    return out;
  }

  // ---------- height samplers ----------
  const overviewY = (x, z) => corridor.sampleOverview(x, z) - elevBase;

  let molaOffsetM = 0;
  function molaY(x, z) {
    if (!sampleMolaM) return null;
    const lat = lat0 - (z / MARS_R_M) / DEG;
    const lon = lon0 + (x / (MARS_R_M * Math.cos(lat0 * DEG))) / DEG;
    const h = sampleMolaM(lat, lon);
    return h == null ? null : h + molaOffsetM - elevBase;
  }

  // ---------- 2. corridor overview mesh (~8 m) ----------
  const ov = corridor.overview;
  const ovSegX = Math.max(1, Math.floor((ov.nx - 1) / 2));
  const ovSegZ = Math.max(1, Math.floor((ov.nz - 1) / 2));
  const ovPlane = new THREE.PlaneGeometry(W, H, ovSegX, ovSegZ);
  ovPlane.rotateX(-Math.PI / 2);
  {
    const pos = ovPlane.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, overviewY(pos.getX(i), pos.getZ(i)));
    ovPlane.computeVertexNormals();
  }
  const ovGeom = addSkirt(ovPlane, ovSegX, ovSegZ, 40);
  ovPlane.dispose();
  const overviewMat = groundMaterial(prepTex(texLoader.load(corridor.overviewTextureUrl())), "overview");
  const overviewMesh = new THREE.Mesh(ovGeom, overviewMat);
  overviewMesh.receiveShadow = true;
  scene.add(overviewMesh);

  // ---------- 3. MOLA far ring with Viking colour ----------
  let farMesh = null;
  function buildFar() {
    if (!sampleMolaM || farMesh) return;
    // MOLA (8 ppd) and HiRISE are both areoid heights; the coarse grid is smoothed over ~7 km, so
    // shift it to agree with the corridor's own mean height (logged, and shown in Sources).
    let sumD = 0;
    let n = 0;
    for (let k = 0; k < 64; k++) {
      const x = ((k % 8) / 7 - 0.5) * W * 0.9;
      const z = (Math.floor(k / 8) / 7 - 0.5) * H * 0.9;
      const m = molaY(x, z);
      if (m == null) continue;
      sumD += overviewY(x, z) - m;
      n++;
    }
    molaOffsetM = n ? sumD / n : 0;
    const g = new THREE.PlaneGeometry(2 * farRadiusM, 2 * farRadiusM, farSeg, farSeg);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = molaY(x, z) ?? 0;
      // dip the far ring slightly under the corridor so the measured HiRISE ground always wins
      pos.setY(i, y - (insideCorridor(x, z) ? 25 : 0));
      const lat = lat0 - (z / MARS_R_M) / DEG;
      const lon = lon0 + (x / (MARS_R_M * Math.cos(lat0 * DEG))) / DEG;
      uv.setXY(i, (lon + 180) / 360, (lat + 90) / 180);
    }
    g.computeVertexNormals();
    const farTex = vikingUrl ? prepTex(texLoader.load(vikingUrl)) : null;
    farMesh = new THREE.Mesh(g, groundMaterial(farTex, "far"));
    farMesh.receiveShadow = false;
    farMesh.renderOrder = -1;
    scene.add(farMesh);
  }
  buildFar();

  // ---------- 1. streamed 1 m chunks ----------
  const chunkGroup = new THREE.Group();
  scene.add(chunkGroup);
  const chunks = new Map(); // "a,b" -> { a, b, seg, edgeMask, mesh, ready, disposed, texEntry }
  const texEntries = new Map();
  const matPool = [];
  let buildQueue = [];
  let planT = 0;
  let planCell = "";
  let covDirty = true;
  let covA0 = NaN;
  let covB0 = NaN;
  corridor.onChunkLoaded(() => {
    planT = 0;
  });
  const maxA = corridor.chunksX * SUBDIV;
  const maxB = corridor.chunksZ * SUBDIV;
  const inBoundsCell = (a, b2) => a >= 0 && b2 >= 0 && a < maxA && b2 < maxB;

  function texEntry(ci, cj) {
    const i = corridor.index(ci, cj);
    let e = texEntries.get(i);
    if (!e) {
      e = { refs: 0, loaded: false, failed: false, waiters: [], ci, cj };
      const settle = (ok) => {
        e.loaded = ok;
        e.failed = !ok;
        for (const w of e.waiters.splice(0)) w();
      };
      e.tex = prepTex(texLoader.load(corridor.chunkTextureUrl(ci, cj), () => settle(true), undefined, () => settle(false)));
      texEntries.set(i, e);
    }
    return e;
  }

  function releaseTex(e) {
    e.refs--;
    if (e.refs > 0) return;
    e.tex.dispose();
    texEntries.delete(corridor.index(e.ci, e.cj));
  }

  function chunkMaterial(map) {
    const m = matPool.pop();
    if (m) {
      m.map = map;
      return m;
    }
    return groundMaterial(map, "chunk");
  }

  function disposeChunk(key, c) {
    c.disposed = true;
    chunkGroup.remove(c.mesh);
    c.mesh.geometry.dispose();
    if (matPool.length < 64) matPool.push(c.mesh.material);
    else c.mesh.material.dispose();
    releaseTex(c.texEntry);
    chunks.delete(key);
    covDirty = true;
  }

  function plan(px, pz) {
    const gfx = getGfx();
    corridor.update(px, pz, Math.min(520, gfx.detailRadiusM + 160));
    const want = new Map();
    for (const item of corridor.selectNearestSubCells(px, pz, 40, SUBDIV)) {
      if (!inBoundsCell(item.a, item.b)) continue;
      const key = `${item.a},${item.b}`;
      let seg = Math.min(128, gfx.lodSegs ? (item.d < gfx.lodNearM ? gfx.lodSegs[0] : item.d < gfx.lodMidM ? gfx.lodSegs[1] : gfx.lodSegs[2]) : 128);
      const cur = chunks.get(key);
      if (cur && seg < cur.seg && item.d < (gfx.lodMidM || 300) * 1.2) seg = cur.seg; // hysteresis
      want.set(key, { a: item.a, b: item.b, d: item.d, seg, edgeMask: 15 });
      if (want.size >= 32) break;
    }
    const hasNeighbor = (na, nb) => {
      if (!want.has(`${na},${nb}`)) return false;
      const dc = corridor.dataChunkForSubCell(na, nb, SUBDIV);
      return Boolean(corridor.chunkHeights(dc.ci, dc.cj));
    };
    for (const w of want.values()) {
      w.edgeMask =
        (hasNeighbor(w.a, w.b - 1) ? 1 : 0) |
        (hasNeighbor(w.a, w.b + 1) ? 2 : 0) |
        (hasNeighbor(w.a - 1, w.b) ? 4 : 0) |
        (hasNeighbor(w.a + 1, w.b) ? 8 : 0);
    }
    for (const [key, c] of chunks) if (!want.has(key)) disposeChunk(key, c);
    buildQueue = [...want.entries()]
      .filter(([key, w]) => {
        const cur = chunks.get(key);
        return !cur || cur.seg !== w.seg || cur.edgeMask !== w.edgeMask;
      })
      .map(([, w]) => w)
      .sort((p, q) => p.d - q.d);
  }

  function buildQueued(budgetMs) {
    const t0 = performance.now();
    let built = 0;
    while (buildQueue.length && (built === 0 || performance.now() - t0 < budgetMs)) {
      const w = buildQueue.shift();
      const key = `${w.a},${w.b}`;
      const g = buildCorridorSubCellGeometry(THREE, corridor, w.a, w.b, w.seg, elevBase, 30, null, SUBDIV, w.edgeMask);
      if (!g) continue;
      built++;
      const existing = chunks.get(key);
      if (existing) {
        existing.mesh.geometry.dispose();
        existing.mesh.geometry = g;
        existing.seg = w.seg;
        existing.edgeMask = w.edgeMask;
        continue;
      }
      const { ci, cj } = corridor.dataChunkForSubCell(w.a, w.b, SUBDIV);
      const e = texEntry(ci, cj);
      e.refs++;
      const c = { a: w.a, b: w.b, seg: w.seg, edgeMask: w.edgeMask, texEntry: e, ready: false, disposed: false };
      c.mesh = new THREE.Mesh(g, chunkMaterial(e.tex));
      c.mesh.receiveShadow = true;
      c.mesh.visible = false;
      chunkGroup.add(c.mesh);
      chunks.set(key, c);
      const show = () => {
        if (c.disposed) return;
        c.ready = true;
        c.mesh.visible = true;
        covDirty = true;
      };
      if (e.loaded || e.failed) show();
      else e.waiters.push(show);
    }
  }

  function updateCoverage(a, b2) {
    const a0 = a - COV_N / 2;
    const b0 = b2 - COV_N / 2;
    if (!covDirty && a0 === covA0 && b0 === covB0) return;
    covA0 = a0;
    covB0 = b0;
    covDirty = false;
    covData.fill(0);
    for (const c of chunks.values()) {
      if (!c.ready) continue;
      const ia = c.a - a0;
      const ib = c.b - b0;
      if (ia < 0 || ib < 0 || ia >= COV_N || ib >= COV_N) continue;
      covData[(ib * COV_N + ia) * 4] = 255;
    }
    covTex.needsUpdate = true;
    covU.uCovOrigin.value.set(-W / 2 + a0 * sub.chunkW, -H / 2 + b0 * sub.chunkH);
  }

  /** Exact triangle height on a uniform grid mesh (matches what is drawn). */
  function gridMeshY(geom, x0, z0, w, h, segX, segZ, x, z) {
    const pos = geom?.attributes?.position?.array;
    if (!pos) return null;
    const fx = Math.max(0, Math.min(segX - 1e-6, ((x - x0) / w) * segX));
    const fz = Math.max(0, Math.min(segZ - 1e-6, ((z - z0) / h) * segZ));
    const p = Math.min(segX - 1, Math.floor(fx));
    const q = Math.min(segZ - 1, Math.floor(fz));
    const tx = fx - p;
    const tz = fz - q;
    const nv = segX + 1;
    const i0 = (q * nv + p) * 3 + 1;
    const y00 = pos[i0];
    const y10 = pos[i0 + 3];
    const y01 = pos[i0 + nv * 3];
    const y11 = pos[i0 + nv * 3 + 3];
    if (tx + tz <= 1) return y00 + (y10 - y00) * tx + (y01 - y00) * tz;
    return y11 + (y01 - y11) * (1 - tx) + (y10 - y11) * (1 - tz);
  }

  /** Which data set is under (x, z): "hirise-1m" | "hirise-8m" | "mola" | "none". */
  function sourceAt(x, z) {
    if (insideCorridor(x, z)) {
      const cell = corridor.subSceneCellOf(x, z, SUBDIV);
      const c = chunks.get(`${cell.a},${cell.b}`);
      return c?.ready ? "hirise-1m" : "hirise-8m";
    }
    return sampleMolaM && Math.max(Math.abs(x), Math.abs(z)) < farRadiusM ? "mola" : "none";
  }

  /** Height of the ground as drawn (scene y). */
  function surfaceY(x, z) {
    if (insideCorridor(x, z)) {
      const cell = corridor.subSceneCellOf(x, z, SUBDIV);
      const c = chunks.get(`${cell.a},${cell.b}`);
      if (c?.ready) {
        const x0 = -W / 2 + c.a * sub.chunkW;
        const z0 = -H / 2 + c.b * sub.chunkH;
        const y = gridMeshY(c.mesh.geometry, x0, z0, sub.chunkW, sub.chunkH, c.seg, c.seg, x, z);
        if (y !== null) return y;
      }
      return gridMeshY(ovGeom, -W / 2, -H / 2, W, H, ovSegX, ovSegZ, x, z) ?? overviewY(x, z);
    }
    return molaY(x, z) ?? overviewY(Math.max(-W / 2, Math.min(W / 2, x)), Math.max(-H / 2, Math.min(H / 2, z)));
  }

  /** Per frame: stream data, build a few meshes within a time budget, keep the cut mask current. */
  function update(px, pz, dt) {
    curvature.uCurvAnchor.value.set(px, pz);
    if (!insideCorridor(px, pz) && chunks.size === 0) return;
    const { a, b: b2 } = corridor.subSceneCellOf(px, pz, SUBDIV);
    const key = `${a},${b2}`;
    planT -= dt;
    if (planT <= 0 || key !== planCell) {
      planT = 0.25;
      planCell = key;
      plan(px, pz);
    }
    buildQueued(4);
    updateCoverage(a, b2);
  }

  async function warmAt(px, pz) {
    await corridor.warmup(px, pz, 520, 8000);
    plan(px, pz);
    buildQueued(300);
    const { a, b: b2 } = corridor.subSceneCellOf(px, pz, SUBDIV);
    updateCoverage(a, b2);
    planT = 0;
  }

  return {
    elevBase,
    worldW: W,
    worldH: H,
    lon0,
    lat0,
    lonToX,
    latToZ,
    xToLon,
    zToLat,
    insideCorridor,
    surfaceY,
    sourceAt,
    update,
    warmAt,
    get molaOffsetM() {
      return molaOffsetM;
    },
    hasFarTerrain: () => Boolean(farMesh),
  };
}
