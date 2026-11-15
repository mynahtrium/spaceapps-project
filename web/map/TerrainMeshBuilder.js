/**
 * Pure Skirted Quadtree Tile Geometry & 1-Pixel Border-Clamped Analytical Normal Map Builder.
 *
 * Shared by `terrain.worker.js` (WebWorker off-main-thread execution), `TerrainWorkerPool.js`
 * (main-thread fallback), and automated `node --test` unit tests.
 */

import MartiniPkg from "../../node_modules/@mapbox/martini/index.js";
import {
  clampLatDeg,
  lonLatElevToLocalRTC,
  marsDistanceM,
} from "./Geodesy.js";

const Martini = MartiniPkg?.default || MartiniPkg;
const martiniCache = new Map();

function getMartini(gridSize) {
  let instance = martiniCache.get(gridSize);
  if (!instance) {
    instance = new Martini(gridSize);
    martiniCache.set(gridSize, instance);
  }
  return instance;
}

function isPowerOfTwo(n) {
  return Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0;
}

/**
 * Generate an adaptive Right-Triangulated Irregular Network (RTIN) mesh using `@mapbox/martini`
 * for any `(2^k + 1) x (2^k + 1)` height grid.
 *
 * @param {Float32Array} terrainGrid `(gridSize * gridSize)` elevation grid
 * @param {number} gridSize `2^k + 1` (e.g. 17, 33, 65, 129, 257)
 * @param {number} [maxError=0] Maximum vertical error in meters (`-1` forces full subdivision)
 * @returns {{ vertices: Uint16Array, triangles: Uint32Array, errors: Float32Array }}
 */
export function buildAdaptiveRtinMesh(terrainGrid, gridSize, maxError = 0) {
  const martini = getMartini(gridSize);
  const tile = martini.createTile(terrainGrid);
  const { vertices, triangles } = tile.getMesh(maxError);
  return { vertices, triangles, errors: tile.errors };
}

/**
 * Build a skirted grid mesh + 1-pixel border-clamped tangent-space analytical normal map
 * for a geographic tile bounds rectangle on Mars.
 *
 * Texture coordinate convention:
 * - `uv.x`: 0 (west) -> 1 (east)
 * - `uv.y`: 0 (south) -> 1 (north) — matches `flipY = true` WebGL imagery textures AND
 *   `flipY = false` DataTexture written row 0 = south to row H-1 = north.
 *
 * @param {object} params
 * @param {import('./MarsDemSampler.js').MarsDemSampler} params.demSampler
 * @param {{ west: number, south: number, east: number, north: number }} params.bounds
 * @param {ReturnType<typeof import('./Geodesy.js').makeLocalTangentOrigin>} params.rtcOrigin
 * @param {number} [params.segments=48] Grid subdivisions per edge
 * @param {number} [params.normalTexSize=128] Width/height of RGBA8 tangent-space normal map
 * @param {number} [params.exaggeration=1.0] Vertical elevation multiplier
 * @param {number} [params.skirtDepthM=120] Vertical skirt drop on all 4 tile perimeter edges
 * @returns {{
 *   positions: Float32Array,
 *   normals: Float32Array,
 *   uvs: Float32Array,
 *   indices: Uint32Array,
 *   normalMapRgba: Uint8Array,
 *   normalTexSize: number,
 *   skirtStartIndex: number,
 *   boundingSphereRadiusM: number,
 *   centerRtc: [number, number, number],
 *   centerElevM: number,
 * }}
 */
export function buildMarsTerrainTilePayload({
  demSampler,
  bounds,
  rtcOrigin,
  segments = 48,
  normalTexSize = 128,
  exaggeration = 1.0,
  skirtDepthM = 120,
  maxError = -1,
}) {
  const { west, south, east, north } = bounds;
  const cols = segments + 1;
  const rows = segments + 1;
  const interiorVerts = cols * rows;
  const skirtVertsPerSide = cols;
  const totalVerts = interiorVerts + skirtVertsPerSide * 4;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);

  const midLat = (south + north) * 0.5;
  const midLon = (west + east) * 0.5;
  const centerElevRaw = demSampler.sampleElevation([midLon, midLat], true);
  const centerRtcVec = lonLatElevToLocalRTC(
    midLon,
    midLat,
    centerElevRaw * exaggeration,
    rtcOrigin
  );

  // Sample extended (segments + 3) x (segments + 3) grid with 1-px border clamp for shared boundary normals
  const dLonGrid = (east - west) / segments;
  const dLatGrid = (north - south) / segments;
  const stepXM = Math.max(0.5, marsDistanceM([west, midLat], [east, midLat]) / segments);
  const stepYM = Math.max(0.5, marsDistanceM([midLon, south], [midLon, north]) / segments);

  const extCols = cols + 2;
  const extElev = new Float32Array(extCols * (rows + 2));
  for (let r = -1; r <= segments + 1; r++) {
    const lat = clampLatDeg(south + r * dLatGrid);
    for (let c = -1; c <= segments + 1; c++) {
      const lon = west + c * dLonGrid;
      const elev = demSampler.sampleElevation([lon, lat], true) * exaggeration;
      extElev[(r + 1) * extCols + (c + 1)] = elev;
    }
  }

  let maxDistSq = 0;

  // Populate interior surface vertices (row 0 = south, row segments = north)
  for (let r = 0; r < rows; r++) {
    const v = r / segments;
    const lat = south + v * (north - south);
    for (let c = 0; c < cols; c++) {
      const u = c / segments;
      const lon = west + u * (east - west);
      const vi = r * cols + c;

      const er = r + 1;
      const ec = c + 1;
      const elevScaled = extElev[er * extCols + ec];
      const rtc = lonLatElevToLocalRTC(lon, lat, elevScaled, rtcOrigin);

      positions[vi * 3] = rtc.x;
      positions[vi * 3 + 1] = rtc.y;
      positions[vi * 3 + 2] = rtc.z;

      uvs[vi * 2] = u;
      uvs[vi * 2 + 1] = v;

      // Finite-difference vertex normal in Three.js frame (+X East, +Y Up, +Z South)
      const zW = extElev[er * extCols + (ec - 1)];
      const zE = extElev[er * extCols + (ec + 1)];
      const zS = extElev[(er - 1) * extCols + ec];
      const zN = extElev[(er + 1) * extCols + ec];
      const dzdx = (zE - zW) / (2 * stepXM);
      const dzdy = (zN - zS) / (2 * stepYM);
      const invLen = 1 / Math.hypot(-dzdx, 1.0, dzdy);
      normals[vi * 3] = -dzdx * invLen;
      normals[vi * 3 + 1] = 1.0 * invLen;
      normals[vi * 3 + 2] = dzdy * invLen;

      const dxC = rtc.x - centerRtcVec.x;
      const dyC = rtc.y - centerRtcVec.y;
      const dzC = rtc.z - centerRtcVec.z;
      const d2 = dxC * dxC + dyC * dyC + dzC * dzC;
      if (d2 > maxDistSq) maxDistSq = d2;
    }
  }

  // Interior triangles generated via @mapbox/martini RTIN hierarchy
  // Row r=0 is South (+Z), row r+1 is North (-Z).
  const skirtTris = segments * 4 * 2;
  let indices;
  let ptr = 0;

  if (isPowerOfTwo(segments)) {
    const rtinElev = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      const er = r + 1;
      for (let c = 0; c < cols; c++) {
        rtinElev[r * cols + c] = extElev[er * extCols + (c + 1)];
      }
    }
    const rtin = buildAdaptiveRtinMesh(rtinElev, cols, maxError);
    const rtinVerts = rtin.vertices;
    const rtinTris = rtin.triangles;
    const interiorTris = rtinTris.length / 3;
    indices = new Uint32Array((interiorTris + skirtTris) * 3);
    for (let i = 0; i < rtinTris.length; i += 3) {
      const a = rtinTris[i];
      const b = rtinTris[i + 1];
      const c = rtinTris[i + 2];
      const vA = rtinVerts[2 * a + 1] * cols + rtinVerts[2 * a];
      const vB = rtinVerts[2 * b + 1] * cols + rtinVerts[2 * b];
      const vC = rtinVerts[2 * c + 1] * cols + rtinVerts[2 * c];
      // Flip (vB, vC) because r increases South->North (-Z) in Three.js frame
      indices[ptr++] = vA;
      indices[ptr++] = vC;
      indices[ptr++] = vB;
    }
  } else {
    const interiorTris = segments * segments * 2;
    indices = new Uint32Array((interiorTris + skirtTris) * 3);
    for (let r = 0; r < segments; r++) {
      for (let c = 0; c < segments; c++) {
        const v00 = r * cols + c;
        const v10 = v00 + 1;
        const v01 = v00 + cols;
        const v11 = v01 + 1;

        indices[ptr++] = v00;
        indices[ptr++] = v10;
        indices[ptr++] = v01;

        indices[ptr++] = v10;
        indices[ptr++] = v11;
        indices[ptr++] = v01;
      }
    }
  }

  const skirtStartIndex = ptr;

  // Helper to append an edge skirt dropping down by skirtDepthM to eliminate LOD cracks
  let nextSkirtVert = interiorVerts;
  const addSkirtSide = (edgeIndices, outwardFlip) => {
    const baseSkirt = nextSkirtVert;
    for (let i = 0; i < edgeIndices.length; i++) {
      const src = edgeIndices[i];
      const dst = baseSkirt + i;
      positions[dst * 3] = positions[src * 3];
      positions[dst * 3 + 1] = positions[src * 3 + 1] - skirtDepthM;
      positions[dst * 3 + 2] = positions[src * 3 + 2];
      normals[dst * 3] = normals[src * 3];
      normals[dst * 3 + 1] = normals[src * 3 + 1];
      normals[dst * 3 + 2] = normals[src * 3 + 2];
      uvs[dst * 2] = uvs[src * 2];
      uvs[dst * 2 + 1] = uvs[src * 2 + 1];
    }
    nextSkirtVert += edgeIndices.length;

    for (let i = 0; i < edgeIndices.length - 1; i++) {
      const topA = edgeIndices[i];
      const topB = edgeIndices[i + 1];
      const botA = baseSkirt + i;
      const botB = baseSkirt + i + 1;
      if (!outwardFlip) {
        indices[ptr++] = topA;
        indices[ptr++] = botA;
        indices[ptr++] = topB;
        indices[ptr++] = topB;
        indices[ptr++] = botA;
        indices[ptr++] = botB;
      } else {
        indices[ptr++] = topA;
        indices[ptr++] = topB;
        indices[ptr++] = botA;
        indices[ptr++] = topB;
        indices[ptr++] = botB;
        indices[ptr++] = botA;
      }
    }
  };

  // South edge (c = 0..segments, r = 0): outward normal +Z
  const southEdge = [];
  for (let c = 0; c < cols; c++) southEdge.push(c);
  addSkirtSide(southEdge, false);

  // North edge (c = 0..segments, r = segments): outward normal -Z
  const northEdge = [];
  for (let c = 0; c < cols; c++) northEdge.push(segments * cols + c);
  addSkirtSide(northEdge, true);

  // West edge (r = 0..segments, c = 0): outward normal -X
  const westEdge = [];
  for (let r = 0; r < rows; r++) westEdge.push(r * cols);
  addSkirtSide(westEdge, true);

  // East edge (r = 0..segments, c = segments): outward normal +X
  const eastEdge = [];
  for (let r = 0; r < rows; r++) eastEdge.push(r * cols + segments);
  addSkirtSide(eastEdge, false);

  // Full-resolution 1-pixel border-clamped tangent-space normal map (RGBA8)
  // Row 0 = south (uv.y = 0), Row N-1 = north (uv.y = 1)
  // RGB = tangent normal (East, North, Up) * 0.5 + 0.5; Alpha = normalized slope (0..45 deg -> 0..255)
  const texN = Math.max(8, normalTexSize);
  const extTexN = texN + 2;
  const dLonTex = (east - west) / (texN - 1);
  const dLatTex = (north - south) / (texN - 1);
  const texStepXM = Math.max(0.5, marsDistanceM([west, midLat], [east, midLat]) / (texN - 1));
  const texStepYM = Math.max(0.5, marsDistanceM([midLon, south], [midLon, north]) / (texN - 1));

  const texElev = new Float32Array(extTexN * extTexN);
  for (let py = -1; py <= texN; py++) {
    const lat = clampLatDeg(south + py * dLatTex);
    for (let px = -1; px <= texN; px++) {
      const lon = west + px * dLonTex;
      texElev[(py + 1) * extTexN + (px + 1)] =
        demSampler.sampleElevation([lon, lat], true) * exaggeration;
    }
  }

  const normalMapRgba = new Uint8Array(texN * texN * 4);
  for (let py = 0; py < texN; py++) {
    const ey = py + 1;
    for (let px = 0; px < texN; px++) {
      const ex = px + 1;
      const zW = texElev[ey * extTexN + (ex - 1)];
      const zE = texElev[ey * extTexN + (ex + 1)];
      const zS = texElev[(ey - 1) * extTexN + ex];
      const zN = texElev[(ey + 1) * extTexN + ex];
      const dzdx = (zE - zW) / (2 * texStepXM);
      const dzdy = (zN - zS) / (2 * texStepYM);
      const nx = -dzdx;
      const ny = -dzdy;
      const nz = 1.0;
      const invLen = 1 / Math.hypot(nx, ny, nz);
      const tx = nx * invLen;
      const ty = ny * invLen;
      const tz = nz * invLen;
      const slopeDeg = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;

      const idx = (py * texN + px) * 4;
      normalMapRgba[idx] = Math.round((tx * 0.5 + 0.5) * 255);
      normalMapRgba[idx + 1] = Math.round((ty * 0.5 + 0.5) * 255);
      normalMapRgba[idx + 2] = Math.round((tz * 0.5 + 0.5) * 255);
      normalMapRgba[idx + 3] = Math.max(0, Math.min(255, Math.round((slopeDeg / 45) * 255)));
    }
  }

  return {
    positions,
    normals,
    uvs,
    indices,
    normalMapRgba,
    normalTexSize: texN,
    skirtStartIndex,
    boundingSphereRadiusM: Math.sqrt(maxDistSq) + skirtDepthM,
    centerRtc: [centerRtcVec.x, centerRtcVec.y, centerRtcVec.z],
    centerElevM: centerElevRaw,
  };
}
