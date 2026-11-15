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

  /** Scene chunk cell (any integers, mirrored copies included) containing a scene point. */
  sceneCellOf(x, z) {
    return {
      a: Math.floor((x + this.worldW / 2) / this.chunkW),
      b: Math.floor((z + this.worldH / 2) / this.chunkH),
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

  /** Distance from a scene point to the nearest point of a scene cell (0 inside). */
  cellDistance(a, b, x, z) {
    const x0 = -this.worldW / 2 + a * this.chunkW;
    const z0 = -this.worldH / 2 + b * this.chunkH;
    const dx = Math.max(x0 - x, 0, x - (x0 + this.chunkW));
    const dz = Math.max(z0 - z, 0, z - (z0 + this.chunkH));
    return Math.hypot(dx, dz);
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
 * Build the mesh of one scene cell from its (possibly mirrored) data chunk.
 * Positions are absolute scene coordinates; y = elevation - `elevBase`, optionally passed through
 * `adjustY(x, z, y)` (e.g. a levelled habitat pad) so the mesh matches the walkable height.
 * UVs address the data chunk's own texture (u west->east, v north at 1), so mirrored copies
 * show the same imagery flipped, matching their heights.
 *
 * @returns {import('three').BufferGeometry | null} null when the data chunk is not loaded
 */
export function buildCorridorCellGeometry(THREE, corridor, a, b, seg, elevBase, skirtDepth = 30, adjustY = null) {
  const { ci, cj, flipX, flipZ } = corridor.dataChunkForCell(a, b);
  const arr = corridor.chunkHeights(ci, cj);
  if (!arr) return null;
  const n = corridor.chunkPx;
  const s = n + 1;
  const step = n / seg;
  const nv = seg + 1;
  const x0 = -corridor.worldW / 2 + a * corridor.chunkW;
  const z0 = -corridor.worldH / 2 + b * corridor.chunkH;
  const dxv = corridor.chunkW / seg;
  const dzv = corridor.chunkH / seg;

  const ring = [];
  for (let p = 0; p < nv; p++) ring.push(p); // north edge
  for (let q = 1; q < nv; q++) ring.push(q * nv + seg); // east edge
  for (let p = seg - 1; p >= 0; p--) ring.push(seg * nv + p); // south edge
  for (let q = seg - 1; q >= 1; q--) ring.push(q * nv); // west edge
  const total = nv * nv + 2 * ring.length;
  const P = new Float32Array(total * 3);
  const N = new Float32Array(total * 3);
  const U = new Float32Array(total * 2);

  // heights on this chunk's own grid
  const H = new Float32Array(nv * nv);
  for (let q = 0; q < nv; q++) {
    const row = Math.round(flipZ ? n - q * step : q * step);
    for (let p = 0; p < nv; p++) {
      const col = Math.round(flipX ? n - p * step : p * step);
      const y = arr[row * s + col] - elevBase;
      H[q * nv + p] = adjustY ? adjustY(x0 + p * dxv, z0 + q * dzv, y) : y;
    }
  }
  // edge-aware height lookup for normals (falls back to the corridor sampler outside this chunk)
  const hAt = (p, q) => {
    if (p >= 0 && p < nv && q >= 0 && q < nv) return H[q * nv + p];
    const x = x0 + p * dxv;
    const z = z0 + q * dzv;
    const y = corridor.sample(x, z) - elevBase;
    return adjustY ? adjustY(x, z, y) : y;
  };
  for (let q = 0; q < nv; q++) {
    for (let p = 0; p < nv; p++) {
      const k = q * nv + p;
      P[k * 3] = x0 + p * dxv;
      P[k * 3 + 1] = H[k];
      P[k * 3 + 2] = z0 + q * dzv;
      const gx = (hAt(p + 1, q) - hAt(p - 1, q)) / (2 * dxv);
      const gz = (hAt(p, q + 1) - hAt(p, q - 1)) / (2 * dzv);
      const inv = 1 / Math.hypot(gx, 1, gz);
      N[k * 3] = -gx * inv;
      N[k * 3 + 1] = inv;
      N[k * 3 + 2] = -gz * inv;
      const col = flipX ? n - p * step : p * step;
      const row = flipZ ? n - q * step : q * step;
      U[k * 2] = col / n;
      U[k * 2 + 1] = 1 - row / n;
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

  const quads = seg * seg;
  const idx = new Uint32Array(quads * 6 + ring.length * 12);
  let w = 0;
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
  g.userData.corridorCell = { a, b, ci, cj, flipX, flipZ, seg };
  return g;
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
