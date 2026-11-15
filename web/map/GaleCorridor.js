/**
 * Streamed Gale corridor terrain (`web/map/GaleCorridor.js`).
 *
 * Real HiRISE DTEEC_009149 1 m elevation + 25 cm orthoimage (shown at ~0.5 m), cut by
 * `pipeline/terrain/build_corridor.py` into 8 x 21 chunks of 256 x 256 DTM pixels (~259 m).
 * The corridor runs from the habitat / boxwork stops north to the Glen Torridon drill sites.
 *
 * Two levels:
 *  - overview: the whole corridor every 8th vertex (~8 m), always loaded (far terrain, horizon)
 *  - detail:   1 m chunks streamed around the walker, dropped again when far away
 *
 * Scene axes match `hud3d.js`: +X east, +Z south, corridor centred on 0,0. Beyond the corridor the
 * ground is mirror-wrapped (period 2 x corridor), exactly like the old single-tile world, so the
 * heights stay continuous across the seam.
 *
 * Demo-safe: every file is local (`data/demo/corridor/`), no network beyond the static server.
 */

import { buildAdaptiveRtinMesh } from "./TerrainMeshBuilder.js";

/** Mirror-wrap a coordinate with period 2 (0..1 forward, 1..2 backward). */
export function mirrorWrap(t) {
  const m = ((t % 2) + 2) % 2;
  return m > 1 ? 2 - m : m;
}

async function maybeGunzip(buf) {
  const u8 = new Uint8Array(buf);
  if (u8.length < 2 || u8[0] !== 0x1f || u8[1] !== 0x8b) return buf; // already plain (server decoded it)
  if (typeof DecompressionStream === "undefined") throw new Error("DecompressionStream unavailable");
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

/**
 * Decode a height file: int16 row deltas over uint16 levels (first column absolute uint16).
 * @returns {Float32Array} elevations in metres, row-major north to south.
 */
export async function decodeHeights(buf, nx, nz, elevMinM, stepM) {
  const plain = await maybeGunzip(buf);
  const raw = new Uint16Array(plain.byteLength >= nx * nz * 2 ? plain.slice(0, nx * nz * 2) : plain);
  if (raw.length !== nx * nz) throw new Error(`height file has ${raw.length} values, expected ${nx * nz}`);
  const out = new Float32Array(nx * nz);
  for (let r = 0; r < nz; r++) {
    const o = r * nx;
    let lv = raw[o];
    out[o] = elevMinM + lv * stepM;
    for (let c = 1; c < nx; c++) {
      const d = raw[o + c];
      lv += d > 32767 ? d - 65536 : d;
      out[o + c] = elevMinM + lv * stepM;
    }
  }
  return out;
}

function joinUrl(base, rel) {
  return `${String(base).replace(/\/+$/, "")}/${rel}`;
}

export class GaleCorridor {
  /**
   * @param {object} manifest parsed `manifest.json`
   * @param {string} baseUrl folder holding the manifest
   * @param {{ fetchFn?: typeof fetch, maxDetailChunks?: number, maxConcurrent?: number }} [opts]
   */
  constructor(manifest, baseUrl, opts = {}) {
    this.manifest = manifest;
    this.baseUrl = baseUrl;
    this.fetchFn = opts.fetchFn || ((u) => fetch(u));
    this.bounds = { ...manifest.bounds };
    this.worldW = manifest.world_size_m.x;
    this.worldH = manifest.world_size_m.z;
    this.chunksX = manifest.chunks_x;
    this.chunksZ = manifest.chunks_z;
    this.chunkPx = manifest.chunk_px;
    this.chunkW = this.worldW / this.chunksX;
    this.chunkH = this.worldH / this.chunksZ;
    this.vx = manifest.grid_vertices.x; // vertices across the whole corridor (2049)
    this.vz = manifest.grid_vertices.z;
    this.elevMin = manifest.elev_range_m[0];
    this.elevMax = manifest.elev_range_m[1];
    this.overview = null; // { nx, nz, elev }
    this.slots = new Array(this.chunksX * this.chunksZ).fill(null);
    this.lastUse = new Float64Array(this.chunksX * this.chunksZ);
    this.pending = new Map(); // index -> promise
    this.failed = new Set();
    this.queue = [];
    this.inFlight = 0;
    this.maxConcurrent = opts.maxConcurrent ?? 4;
    this.maxDetailChunks = opts.maxDetailChunks ?? 48;
    this.useClock = 0;
    this.listeners = new Set();
  }

  /** Fetch the manifest; resolves to null when there is no corridor (old single-tile world). */
  static async load(baseUrl, opts = {}) {
    const fetchFn = opts.fetchFn || ((u) => fetch(u));
    try {
      const res = await fetchFn(joinUrl(baseUrl, "manifest.json"));
      if (!res.ok) return null;
      const manifest = await res.json();
      if (manifest?.contract !== "martian-mappers.corridor.v1") return null;
      const c = new GaleCorridor(manifest, baseUrl, { ...opts, fetchFn });
      await c.loadOverview();
      return c;
    } catch (err) {
      if (typeof console !== "undefined") console.warn("[corridor] not available, using the single tile:", err?.message || err);
      return null;
    }
  }

  async loadOverview() {
    const m = this.manifest;
    const res = await this.fetchFn(joinUrl(this.baseUrl, m.files.overview_height));
    if (!res.ok) throw new Error(`overview ${res.status}`);
    const nx = m.overview_vertices.x;
    const nz = m.overview_vertices.z;
    this.overview = { nx, nz, elev: await decodeHeights(await res.arrayBuffer(), nx, nz, m.elev_min_m, m.elev_step_m) };
    return this.overview;
  }

  overviewTextureUrl() {
    return joinUrl(this.baseUrl, this.manifest.files.overview_texture);
  }

  chunkTextureUrl(ci, cj) {
    return joinUrl(this.baseUrl, this.manifest.files.chunk_texture.replace("{i}", ci).replace("{j}", cj));
  }

  chunkHeightUrl(ci, cj) {
    return joinUrl(this.baseUrl, this.manifest.files.chunk_height.replace("{i}", ci).replace("{j}", cj));
  }

  onChunkLoaded(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---------- coordinates ----------

  /** Corridor vertex coordinates (fx 0..vx-1 west->east, fz 0..vz-1 north->south) for a scene point. */
  gridCoord(x, z) {
    return {
      fx: mirrorWrap(x / this.worldW + 0.5) * (this.vx - 1),
      fz: mirrorWrap(z / this.worldH + 0.5) * (this.vz - 1),
    };
  }

  /** Scene chunk dimensions when split into `subDiv x subDiv` sub-chunks (`subDiv=2` -> 128x128 px). */
  subCellSize(subDiv = 1) {
    const d = Math.max(1, Math.floor(subDiv));
    return {
      chunkW: this.chunkW / d,
      chunkH: this.chunkH / d,
      px: Math.round(this.chunkPx / d),
    };
  }

  /** Scene chunk cell (any integers, mirrored copies included) containing a scene point. */
  subSceneCellOf(x, z, subDiv = 1) {
    const { chunkW, chunkH } = this.subCellSize(subDiv);
    return {
      a: Math.floor((x + this.worldW / 2) / chunkW),
      b: Math.floor((z + this.worldH / 2) / chunkH),
    };
  }

  /** Scene chunk cell (any integers, mirrored copies included) containing a scene point. */
  sceneCellOf(x, z) {
    return this.subSceneCellOf(x, z, 1);
  }

  /** Data chunk + local sub-quadrant `(qx, qz)` behind a scene sub-cell, with mirror flips. */
  dataChunkForSubCell(sa, sb, subDiv = 1) {
    const d = Math.max(1, Math.floor(subDiv));
    const a = Math.floor(sa / d);
    const b = Math.floor(sb / d);
    const { ci, cj, flipX, flipZ } = this.dataChunkForCell(a, b);
    const la = ((sa % d) + d) % d;
    const lb = ((sb % d) + d) % d;
    return {
      ci,
      cj,
      flipX,
      flipZ,
      qx: flipX ? d - 1 - la : la,
      qz: flipZ ? d - 1 - lb : lb,
    };
  }

  /** Data chunk behind a scene cell, with the mirror flips of that copy. */
  dataChunkForCell(a, b) {
    const px = 2 * this.chunksX;
    const pz = 2 * this.chunksZ;
    const ma = ((a % px) + px) % px;
    const mb = ((b % pz) + pz) % pz;
    const flipX = ma >= this.chunksX;
    const flipZ = mb >= this.chunksZ;
    return {
      ci: flipX ? px - 1 - ma : ma,
      cj: flipZ ? pz - 1 - mb : mb,
      flipX,
      flipZ,
    };
  }

  index(ci, cj) {
    return ci + cj * this.chunksX;
  }

  hasChunk(ci, cj) {
    return this.slots[this.index(ci, cj)] !== null;
  }

  chunkHeights(ci, cj) {
    const i = this.index(ci, cj);
    const arr = this.slots[i];
    if (arr) this.lastUse[i] = ++this.useClock;
    return arr;
  }

  // ---------- sampling (absolute elevation, metres) ----------

  /** 1 m detail height, or null when that chunk is not loaded. */
  sampleDetail(x, z) {
    const { fx, fz } = this.gridCoord(x, z);
    const n = this.chunkPx;
    const ci = Math.min(this.chunksX - 1, Math.floor(fx / n));
    const cj = Math.min(this.chunksZ - 1, Math.floor(fz / n));
    const arr = this.slots[ci + cj * this.chunksX];
    if (!arr) return null;
    const lx = fx - ci * n;
    const lz = fz - cj * n;
    const x0 = Math.min(n - 1, Math.floor(lx));
    const z0 = Math.min(n - 1, Math.floor(lz));
    const tx = lx - x0;
    const tz = lz - z0;
    const s = n + 1;
    const o = z0 * s + x0;
    const top = arr[o] + (arr[o + 1] - arr[o]) * tx;
    const bot = arr[o + s] + (arr[o + s + 1] - arr[o + s]) * tx;
    return top + (bot - top) * tz;
  }

  /** ~8 m overview height (always available once loaded). */
  sampleOverview(x, z) {
    const ov = this.overview;
    if (!ov) return this.elevMin;
    const { fx, fz } = this.gridCoord(x, z);
    const gx = (fx / (this.vx - 1)) * (ov.nx - 1);
    const gz = (fz / (this.vz - 1)) * (ov.nz - 1);
    const x0 = Math.min(ov.nx - 2, Math.floor(gx));
    const z0 = Math.min(ov.nz - 2, Math.floor(gz));
    const tx = gx - x0;
    const tz = gz - z0;
    const e = ov.elev;
    const o = z0 * ov.nx + x0;
    const top = e[o] + (e[o + 1] - e[o]) * tx;
    const bot = e[o + ov.nx] + (e[o + ov.nx + 1] - e[o + ov.nx]) * tx;
    return top + (bot - top) * tz;
  }

  sample(x, z) {
    const d = this.sampleDetail(x, z);
    return d === null ? this.sampleOverview(x, z) : d;
  }

  // ---------- streaming ----------

  /** Ask for a data chunk; resolves when loaded (or rejects). Nearest-first via `priority`. */
  request(ci, cj, priority = 0) {
    const i = this.index(ci, cj);
    if (this.slots[i]) {
      this.lastUse[i] = ++this.useClock;
      return Promise.resolve(this.slots[i]);
    }
    if (this.failed.has(i)) return Promise.reject(new Error("chunk failed"));
    const existing = this.pending.get(i);
    if (existing) {
      const q = this.queue.find((e) => e.i === i);
      if (q) q.priority = Math.min(q.priority, priority);
      return existing.promise;
    }
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    promise.catch(() => {});
    const entry = { i, ci, cj, priority, promise, resolve, reject };
    this.pending.set(i, entry);
    this.queue.push(entry);
    this._pump();
    return promise;
  }

  _pump() {
    while (this.inFlight < this.maxConcurrent && this.queue.length) {
      this.queue.sort((p, q) => p.priority - q.priority);
      const e = this.queue.shift();
      this.inFlight++;
      this._fetchChunk(e)
        .then((arr) => {
          this.slots[e.i] = arr;
          this.lastUse[e.i] = ++this.useClock;
          e.resolve(arr);
          for (const fn of this.listeners) fn(e.ci, e.cj);
        })
        .catch((err) => {
          this.failed.add(e.i);
          e.reject(err);
        })
        .finally(() => {
          this.pending.delete(e.i);
          this.inFlight--;
          this._evict();
          this._pump();
        });
    }
  }

  async _fetchChunk(e) {
    const res = await this.fetchFn(this.chunkHeightUrl(e.ci, e.cj));
    if (!res.ok) throw new Error(`chunk ${e.ci},${e.cj}: ${res.status}`);
    const n = this.chunkPx + 1;
    return decodeHeights(await res.arrayBuffer(), n, n, this.manifest.elev_min_m, this.manifest.elev_step_m);
  }

  /** Keep at most `maxDetailChunks` decoded chunks; drop the least recently used. */
  _evict(pinned = null) {
    let loaded = 0;
    for (const s of this.slots) if (s) loaded++;
    while (loaded > this.maxDetailChunks) {
      let worst = -1;
      let worstUse = Infinity;
      for (let i = 0; i < this.slots.length; i++) {
        if (!this.slots[i] || pinned?.has(i)) continue;
        if (this.lastUse[i] < worstUse) {
          worstUse = this.lastUse[i];
          worst = i;
        }
      }
      if (worst < 0) break;
      this.slots[worst] = null;
      loaded--;
    }
  }

  /**
   * Request every data chunk within `radiusM` of a scene point (mirror-aware), nearest first.
   * Returns the set of data-chunk indices that are wanted, so callers can pin them.
   */
  update(x, z, radiusM = 700) {
    const wanted = new Set();
    const list = [];
    const { a, b } = this.sceneCellOf(x, z);
    const ra = Math.ceil(radiusM / this.chunkW) + 1;
    const rb = Math.ceil(radiusM / this.chunkH) + 1;
    for (let db = -rb; db <= rb; db++) {
      for (let da = -ra; da <= ra; da++) {
        const d = this.cellDistance(a + da, b + db, x, z);
        if (d > radiusM) continue;
        const { ci, cj } = this.dataChunkForCell(a + da, b + db);
        const i = this.index(ci, cj);
        if (wanted.has(i)) continue;
        wanted.add(i);
        this.lastUse[i] = ++this.useClock;
        list.push({ ci, cj, d });
      }
    }
    // Nearest first: requests start fetching immediately, so order them before asking.
    list.sort((p, q) => p.d - q.d);
    for (const e of list) this.request(e.ci, e.cj, e.d).catch(() => {});
    this._evict(wanted);
    return wanted;
  }

  /**
   * Select the `count` nearest scene sub-cells (`subDiv=2` -> 128x128 px) around `(x, z)`, sorted closest-first.
   */
  selectNearestSubCells(x, z, count = 32, subDiv = 2) {
    const { a, b } = this.subSceneCellOf(x, z, subDiv);
    const ring = Math.max(2, Math.ceil(Math.sqrt(Math.max(1, count)) / 2) + 1);
    const list = [];
    for (let db = -ring; db <= ring; db++) {
      for (let da = -ring; da <= ring; da++) {
        const sa = a + da;
        const sb = b + db;
        list.push({ a: sa, b: sb, d: this.subCellDistance(sa, sb, x, z, subDiv) });
      }
    }
    list.sort((p, q) => p.d - q.d);
    return list.slice(0, Math.max(0, count));
  }

  /** Distance from a scene point to the nearest point of a scene sub-cell (0 inside). */
  subCellDistance(a, b, x, z, subDiv = 1) {
    const { chunkW, chunkH } = this.subCellSize(subDiv);
    const x0 = -this.worldW / 2 + a * chunkW;
    const z0 = -this.worldH / 2 + b * chunkH;
    const dx = Math.max(x0 - x, 0, x - (x0 + chunkW));
    const dz = Math.max(z0 - z, 0, z - (z0 + chunkH));
    return Math.hypot(dx, dz);
  }

  /** Distance from a scene point to the nearest point of a scene cell (0 inside). */
  cellDistance(a, b, x, z) {
    return this.subCellDistance(a, b, x, z, 1);
  }

  /** Wait until all chunks within `radiusM` are loaded (or `timeoutMs` passes). */
  async warmup(x, z, radiusM = 300, timeoutMs = 8000) {
    const wanted = this.update(x, z, radiusM);
    const all = [...wanted].map((i) => this.request(i % this.chunksX, Math.floor(i / this.chunksX), 0).catch(() => null));
    let timer;
    const timeout = new Promise((r) => {
      timer = setTimeout(r, timeoutMs);
    });
    await Promise.race([Promise.all(all), timeout]);
    clearTimeout(timer);
  }
}

/**
 * Build the mesh of one scene sub-cell (`subDiv=2` splits each 256x256 tile into 128x128 chunks)
 * from its (possibly mirrored) data chunk.
 *
 * @returns {import('three').BufferGeometry | null} null when the data chunk is not loaded
 */
export function buildCorridorSubCellGeometry(
  THREE,
  corridor,
  a,
  b,
  seg,
  elevBase,
  skirtDepth = 30,
  adjustY = null,
  subDiv = 2,
  edgeMask = 15
) {
  const div = Math.max(1, Math.floor(subDiv));
  const { ci, cj, flipX, flipZ, qx, qz } = corridor.dataChunkForSubCell(a, b, div);
  const arr = corridor.chunkHeights(ci, cj);
  if (!arr) return null;
  const n = corridor.chunkPx;
  const subPx = n / div;
  const s = n + 1;
  const step = subPx / seg;
  const nv = seg + 1;
  const colOff = qx * subPx;
  const rowOff = qz * subPx;
  const cellW = corridor.chunkW / div;
  const cellH = corridor.chunkH / div;
  const x0 = -corridor.worldW / 2 + a * cellW;
  const z0 = -corridor.worldH / 2 + b * cellH;
  const dxv = cellW / seg;
  const dzv = cellH / seg;
  const pxW = cellW / subPx;
  const pxH = cellH / subPx;

  const ring = [];
  for (let p = 0; p < nv; p++) ring.push(p); // north edge
  for (let q = 1; q < nv; q++) ring.push(q * nv + seg); // east edge
  for (let p = seg - 1; p >= 0; p--) ring.push(seg * nv + p); // south edge
  for (let q = seg - 1; q >= 1; q--) ring.push(q * nv); // west edge
  const total = nv * nv + 2 * ring.length;
  const P = new Float32Array(total * 3);
  const N = new Float32Array(total * 3);
  const U = new Float32Array(total * 2);

  const hasNorth = (edgeMask & 1) !== 0;
  const hasSouth = (edgeMask & 2) !== 0;
  const hasWest = (edgeMask & 4) !== 0;
  const hasEast = (edgeMask & 8) !== 0;
  const blendBandM = 10.0;

  const blendOverview = (wx, wz, yDetail) => {
    if (edgeMask === 15) return yDetail;
    let dMin = blendBandM;
    if (!hasNorth) dMin = Math.min(dMin, wz - z0);
    if (!hasSouth) dMin = Math.min(dMin, z0 + cellH - wz);
    if (!hasWest) dMin = Math.min(dMin, wx - x0);
    if (!hasEast) dMin = Math.min(dMin, x0 + cellW - wx);
    if (dMin >= blendBandM) return yDetail;
    const t = Math.max(0, Math.min(1, dMin / blendBandM));
    const sCurve = t * t * (3 - 2 * t);
    const rawOv = corridor.sampleOverview(wx, wz) - elevBase;
    const yOv = adjustY ? adjustY(wx, wz, rawOv) : rawOv;
    return yOv + (yDetail - yOv) * sCurve;
  };

  // heights on this chunk's own grid
  const H = new Float32Array(nv * nv);
  for (let q = 0; q < nv; q++) {
    const row = Math.round(rowOff + (flipZ ? subPx - q * step : q * step));
    const wz = z0 + q * dzv;
    for (let p = 0; p < nv; p++) {
      const col = Math.round(colOff + (flipX ? subPx - p * step : p * step));
      const wx = x0 + p * dxv;
      const rawY = arr[row * s + col] - elevBase;
      const y = adjustY ? adjustY(wx, wz, rawY) : rawY;
      H[q * nv + p] = blendOverview(wx, wz, y);
    }
  }
  // 1-pixel world-space height lookup for normals so adjacent chunks of different LOD (seg)
  // compute identical normals along shared borders.
  const hSampleWorld = (colIdx, rowIdx, wx, wz) => {
    let rawY;
    if (colIdx >= 0 && colIdx <= n && rowIdx >= 0 && rowIdx <= n) {
      rawY = arr[rowIdx * s + colIdx] - elevBase;
    } else {
      rawY = corridor.sample(wx, wz) - elevBase;
    }
    const y = adjustY ? adjustY(wx, wz, rawY) : rawY;
    return blendOverview(wx, wz, y);
  };
  const dColX = flipX ? -1 : 1;
  const dRowZ = flipZ ? -1 : 1;
  for (let q = 0; q < nv; q++) {
    const row = Math.round(rowOff + (flipZ ? subPx - q * step : q * step));
    const wz = z0 + q * dzv;
    for (let p = 0; p < nv; p++) {
      const col = Math.round(colOff + (flipX ? subPx - p * step : p * step));
      const wx = x0 + p * dxv;
      const k = q * nv + p;
      P[k * 3] = wx;
      P[k * 3 + 1] = H[k];
      P[k * 3 + 2] = wz;
      const hxp = hSampleWorld(col + dColX, row, wx + pxW, wz);
      const hxm = hSampleWorld(col - dColX, row, wx - pxW, wz);
      const hzp = hSampleWorld(col, row + dRowZ, wx, wz + pxH);
      const hzm = hSampleWorld(col, row - dRowZ, wx, wz - pxH);
      const gx = (hxp - hxm) / (2 * pxW);
      const gz = (hzp - hzm) / (2 * pxH);
      const inv = 1 / Math.hypot(gx, 1, gz);
      N[k * 3] = -gx * inv;
      N[k * 3 + 1] = inv;
      N[k * 3 + 2] = -gz * inv;
      const colF = colOff + (flipX ? subPx - p * step : p * step);
      const rowF = rowOff + (flipZ ? subPx - q * step : q * step);
      U[k * 2] = colF / n;
      U[k * 2 + 1] = 1 - rowF / n;
    }
  }
  const base = nv * nv;
  ring.forEach((src, k) => {
    for (const [o, dy] of [
      [base + 2 * k, 0],
      [base + 2 * k + 1, -skirtDepth],
    ]) {
      P[o * 3] = P[src * 3];
      P[o * 3 + 1] = P[src * 3 + 1] + dy;
      P[o * 3 + 2] = P[src * 3 + 2];
      N[o * 3] = N[src * 3];
      N[o * 3 + 1] = N[src * 3 + 1];
      N[o * 3 + 2] = N[src * 3 + 2];
      U[o * 2] = U[src * 2];
      U[o * 2 + 1] = U[src * 2 + 1];
    }
  });

  let idx;
  let w = 0;
  if (seg >= 2 && (seg & (seg - 1)) === 0) {
    const rtin = buildAdaptiveRtinMesh(H, nv, -1);
    const rtinVerts = rtin.vertices;
    const rtinTris = rtin.triangles;
    idx = new Uint32Array(rtinTris.length + ring.length * 12);
    for (let i = 0; i < rtinTris.length; i += 3) {
      const a0 = rtinTris[i];
      const b0 = rtinTris[i + 1];
      const c0 = rtinTris[i + 2];
      idx[w++] = rtinVerts[2 * a0 + 1] * nv + rtinVerts[2 * a0];
      idx[w++] = rtinVerts[2 * b0 + 1] * nv + rtinVerts[2 * b0];
      idx[w++] = rtinVerts[2 * c0 + 1] * nv + rtinVerts[2 * c0];
    }
  } else {
    const quads = seg * seg;
    idx = new Uint32Array(quads * 6 + ring.length * 12);
    for (let q = 0; q < seg; q++) {
      for (let p = 0; p < seg; p++) {
        const i0 = q * nv + p;
        const i1 = i0 + 1;
        const i2 = i0 + nv;
        const i3 = i2 + 1;
        // counter-clockwise seen from above (+Y), same as THREE.PlaneGeometry rotated flat
        idx[w++] = i0;
        idx[w++] = i2;
        idx[w++] = i1;
        idx[w++] = i2;
        idx[w++] = i3;
        idx[w++] = i1;
      }
    }
  }
  for (let k = 0; k < ring.length; k++) {
    const t0 = base + 2 * k;
    const t1 = base + 2 * ((k + 1) % ring.length);
    // both windings so the skirt shows from either side
    idx.set([t0, t0 + 1, t1, t1, t0 + 1, t1 + 1, t0, t1, t0 + 1, t1, t1 + 1, t0 + 1], w);
    w += 12;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(P, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  g.userData.corridorCell = { a, b, ci, cj, flipX, flipZ, qx, qz, subDiv: div, seg };
  return g;
}

/**
 * Build the mesh of one 256x256 corridor scene cell (wrapper around `buildCorridorSubCellGeometry` with `subDiv = 1`).
 */
export function buildCorridorCellGeometry(THREE, corridor, a, b, seg, elevBase, skirtDepth = 30, adjustY = null) {
  return buildCorridorSubCellGeometry(THREE, corridor, a, b, seg, elevBase, skirtDepth, adjustY, 1);
}

/** Slope-class colours for one data chunk (same classes as the cost map), as RGBA bytes. */
export function chunkSlopeRgba(corridor, ci, cj, size = 128) {
  const arr = corridor.chunkHeights(ci, cj);
  if (!arr) return null;
  const n = corridor.chunkPx;
  const s = n + 1;
  const cellX = corridor.chunkW / n;
  const cellZ = corridor.chunkH / n;
  const out = new Uint8Array(size * size * 4);
  for (let ty = 0; ty < size; ty++) {
    // texture row 0 is the bottom (v = 0) = south edge of the chunk
    const row = Math.min(n - 1, Math.max(1, Math.round(n - ((ty + 0.5) / size) * n)));
    for (let tx = 0; tx < size; tx++) {
      const col = Math.min(n - 1, Math.max(1, Math.round(((tx + 0.5) / size) * n)));
      const gx = (arr[row * s + col + 1] - arr[row * s + col - 1]) / (2 * cellX);
      const gz = (arr[(row + 1) * s + col] - arr[(row - 1) * s + col]) / (2 * cellZ);
      const deg = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
      const c = deg > 20 ? [60, 20, 20] : deg > 15 ? [239, 68, 68] : deg > 10 ? [245, 158, 11] : [34, 197, 94];
      const o = (ty * size + tx) * 4;
      out[o] = c[0];
      out[o + 1] = c[1];
      out[o + 2] = c[2];
      out[o + 3] = 255;
    }
  }
  return out;
}
