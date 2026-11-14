/**
 * Mars Tile Source Registry, Multi-Tier Fallback Cascade, Singleflight Coalescer,
 * Per-Provider Circuit Breaker, Byte-Budgeted LRU Cache, and Dynamic Attribution Tracker.
 *
 * Strictly honors `demoSafe` (`?demo=1`): disables all external network requests BEFORE
 * calling `fetch()`, serving only local cached demo tiles (`data/demo/tiles/themis/...`)
 * and processed/demo elevation grids.
 */

import { mercatorZoomToMarsEquirectZoom } from "./Geodesy.js";

export const DEFAULT_MARS_PROVIDERS = [
  {
    id: "onmars-ctx",
    kind: "imagery",
    label: "MRO CTX 5 m Global Mosaic (ArcGIS OnMars)",
    attribution: "NASA/JPL/Caltech/MSSS · Esri OnMars CTX (5 m)",
    sourceUrl: "https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer",
    fetchDate: "2026-11-14",
    projection: "mars-equirectangular",
    urlTemplate:
      "https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{eqZ}/{row}/{col}",
    minEqZ: 0,
    maxEqZ: 10,
    localOnly: false,
    priority: 20,
  },
  {
    id: "trek-ctx",
    kind: "imagery",
    label: "MRO CTX 5 m Mosaic (NASA Mars Trek)",
    attribution: "NASA/JPL/Caltech · Mars Trek CTX (5 m)",
    sourceUrl:
      "https://trek.nasa.gov/tiles/Mars/EQ/CTX_beta01_uncontrolled_5m_Caltech/1.0.0/WMTSCapabilities.xml",
    fetchDate: "2026-11-11",
    projection: "mars-equirectangular",
    urlTemplate:
      "https://trek.nasa.gov/tiles/Mars/EQ/CTX_beta01_uncontrolled_5m_Caltech/1.0.0/default/default028mm/{eqZ}/{row}/{col}.jpg",
    minEqZ: 0,
    maxEqZ: 10,
    localOnly: false,
    priority: 30,
  },
  {
    id: "themis-day",
    kind: "imagery",
    label: "Mars Odyssey THEMIS Day IR 100 m",
    attribution: "NASA/JPL/ASU · Odyssey THEMIS Day IR (100 m)",
    sourceUrl:
      "https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml",
    fetchDate: "2026-11-14",
    projection: "mars-equirectangular",
    urlTemplate:
      "https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/default/default028mm/{eqZ}/{row}/{col}.png",
    minEqZ: 0,
    maxEqZ: 9,
    localOnly: false,
    priority: 40,
  },
  {
    id: "themis-night",
    kind: "imagery",
    label: "Mars Odyssey THEMIS Night IR 100 m",
    attribution: "NASA/JPL/ASU · Odyssey THEMIS Night IR (100 m)",
    sourceUrl:
      "https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml",
    fetchDate: "2026-11-14",
    projection: "mars-equirectangular",
    urlTemplate:
      "https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/default/default028mm/{eqZ}/{row}/{col}.png",
    minEqZ: 0,
    maxEqZ: 9,
    localOnly: false,
    priority: 45,
  },
  {
    id: "mola-color",
    kind: "imagery",
    label: "MGS MOLA Shaded Relief 463 m (NASA Mars Trek)",
    attribution: "NASA/JPL/GSFC · MGS MOLA Color Shaded Relief (463 m)",
    sourceUrl:
      "https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/WMTSCapabilities.xml",
    fetchDate: "2026-11-11",
    projection: "mars-equirectangular",
    urlTemplate:
      "https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm/{eqZ}/{row}/{col}.jpg",
    minEqZ: 0,
    maxEqZ: 6,
    localOnly: false,
    priority: 50,
  },
  {
    id: "hirise-dtm-local",
    kind: "terrain",
    label: "MRO HiRISE DTM DTEEC_019698 (1 m -> ~5 m Local Grid)",
    attribution: "NASA/JPL/UArizona · HiRISE DTEEC_019698 DTM (processed ~5 m grid)",
    sourceUrl:
      "https://hirise-pds.lpl.arizona.edu/PDS/DTM/ESP/ORB_019600_019699/ESP_019698_1750_ESP_019988_1750/",
    fetchDate: "2026-11-14",
    projection: "local-grid",
    localOnly: true,
    priority: 10,
  },
  {
    id: "procedural-mars-relief",
    kind: "imagery",
    label: "Local Gale Hillshade & Regolith Baseline (Offline)",
    attribution: "Local Gale Hillshade (derived from NASA/UArizona HiRISE DTEEC_019698)",
    sourceUrl: "local://processed-terrain",
    fetchDate: "2026-11-14",
    projection: "local-synthetic",
    localOnly: true,
    priority: 100,
  },
];

/**
 * Byte-budgeted LRU cache with pinned active-viewport key protection and eviction callback.
 */
export class TileLRUCache {
  /**
   * @param {number} [maxBytes=67108864] Default 64 MB budget
   * @param {(key: string, value: any) => void} [onEvict] Optional GPU/memory disposal hook
   */
  constructor(maxBytes = 64 * 1024 * 1024, onEvict = null) {
    this.maxBytes = Math.max(1024, maxBytes);
    this.onEvict = onEvict;
    /** @type {Map<string, { value: any, byteLength: number }>} */
    this._map = new Map();
    /** @type {Set<string>} */
    this._pinned = new Set();
    this.totalBytes = 0;
  }

  has(key) {
    return this._map.has(key);
  }

  get(key) {
    const entry = this._map.get(key);
    if (!entry) return undefined;
    // Refresh recency
    this._map.delete(key);
    this._map.set(key, entry);
    return entry.value;
  }

  pin(key) {
    this._pinned.add(key);
  }

  unpin(key) {
    this._pinned.delete(key);
  }

  clearPins() {
    this._pinned.clear();
  }

  setPinnedKeys(keys) {
    this._pinned = new Set(keys);
  }

  set(key, value, byteLength = 1024) {
    const size = Math.max(1, Number(byteLength) || 1024);
    if (this._map.has(key)) {
      const old = this._map.get(key);
      this.totalBytes -= old.byteLength;
      if (this.onEvict && old.value !== value) {
        this.onEvict(key, old.value);
      }
      this._map.delete(key);
    }
    this._map.set(key, { value, byteLength: size });
    this.totalBytes += size;
    this._evictIfNeeded(key);
  }

  delete(key) {
    const entry = this._map.get(key);
    if (!entry) return false;
    this._map.delete(key);
    this.totalBytes -= entry.byteLength;
    if (this.onEvict) this.onEvict(key, entry.value);
    return true;
  }

  _evictIfNeeded(justInsertedKey) {
    if (this.totalBytes <= this.maxBytes) return;
    for (const [k, entry] of [...this._map.entries()]) {
      if (this.totalBytes <= this.maxBytes) break;
      if (k === justInsertedKey || this._pinned.has(k)) continue;
      this._map.delete(k);
      this.totalBytes -= entry.byteLength;
      if (this.onEvict) this.onEvict(k, entry.value);
    }
  }

  clear() {
    for (const [k, entry] of this._map.entries()) {
      if (this.onEvict) this.onEvict(k, entry.value);
    }
    this._map.clear();
    this._pinned.clear();
    this.totalBytes = 0;
  }

  get size() {
    return this._map.size;
  }
}

/**
 * Per-provider circuit breaker preventing retry storms on 429 / 5xx / CORS failures.
 */
export class ProviderCircuitBreaker {
  /**
   * @param {object} [opts]
   * @param {number} [opts.failureThreshold=3]
   * @param {number} [opts.baseCooldownMs=15000]
   * @param {number} [opts.maxCooldownMs=120000]
   * @param {() => number} [opts.nowFn]
   */
  constructor({
    failureThreshold = 3,
    baseCooldownMs = 15000,
    maxCooldownMs = 120000,
    nowFn = () => Date.now(),
  } = {}) {
    this.failureThreshold = failureThreshold;
    this.baseCooldownMs = baseCooldownMs;
    this.maxCooldownMs = maxCooldownMs;
    this.nowFn = nowFn;
    /** @type {Map<string, { state: 'CLOSED'|'OPEN'|'HALF_OPEN', failures: number, trips: number, openUntil: number, lastError: string|null }>} */
    this._states = new Map();
  }

  _entry(id) {
    if (!this._states.has(id)) {
      this._states.set(id, {
        state: "CLOSED",
        failures: 0,
        trips: 0,
        openUntil: 0,
        lastError: null,
      });
    }
    return this._states.get(id);
  }

  canAttempt(id) {
    const e = this._entry(id);
    if (e.state === "CLOSED") return true;
    if (e.state === "OPEN") {
      if (this.nowFn() >= e.openUntil) {
        e.state = "HALF_OPEN";
        return true;
      }
      return false;
    }
    return true; // HALF_OPEN allows one probe
  }

  recordSuccess(id) {
    const e = this._entry(id);
    e.state = "CLOSED";
    e.failures = 0;
    e.trips = 0;
    e.openUntil = 0;
    e.lastError = null;
  }

  recordFailure(id, reason = "error", status = 0) {
    const e = this._entry(id);
    e.failures += 1;
    e.lastError = String(reason);
    const immediateTrip = status === 429 || status >= 500;
    if (e.state === "HALF_OPEN" || e.failures >= this.failureThreshold || immediateTrip) {
      e.state = "OPEN";
      e.trips += 1;
      const backoff = Math.min(this.maxCooldownMs, this.baseCooldownMs * 2 ** (e.trips - 1));
      e.openUntil = this.nowFn() + backoff;
    }
    return e;
  }

  getState(id) {
    return { ...this._entry(id) };
  }
}

/**
 * Coordinates Mars tile URL formatting, local demo cache lookup, cascading fallback,
 * singleflight deduplication, byte-budgeted LRU caching, and attribution tracking.
 */
export class TileSourceRegistry {
  /**
   * @param {object} [opts]
   * @param {boolean} [opts.demoSafe=false] When true, ALL non-local HTTPS fetches are hard-blocked.
   * @param {typeof fetch} [opts.fetchImpl]
   * @param {number} [opts.cacheMaxBytes=67108864]
   * @param {number} [opts.timeoutMs=8000]
   * @param {object} [opts.themisMetadata] Parsed layers-themis.json object
   * @param {string} [opts.demoTileBaseUrl="../data/demo/tiles/themis"]
   */
  constructor(opts = {}) {
    this.demoSafe = Boolean(opts.demoSafe);
    this.fetchImpl =
      opts.fetchImpl || (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null);
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.demoTileBaseUrl = opts.demoTileBaseUrl ?? "../data/demo/tiles/themis";
    this.cache = new TileLRUCache(opts.cacheMaxBytes ?? 64 * 1024 * 1024);
    this.breaker = new ProviderCircuitBreaker(opts.breakerOptions);
    /** @type {Map<string, Promise<any>>} */
    this._inflight = new Map();
    /** @type {Map<string, object>} */
    this._providers = new Map();
    /** @type {Set<string>} */
    this._activeAttributionIds = new Set(["hirise-dtm-local"]);
    /** @type {Map<string, string>} */
    this._localThemisMap = new Map();
    /** @type {{ day: Array<{eqZ:number,row:number,col:number,url:string}>, night: Array<{eqZ:number,row:number,col:number,url:string}> }} */
    this._localThemisEntries = { day: [], night: [] };
    /** @type {Set<(list: Array<object>) => void>} */
    this._attrListeners = new Set();

    for (const p of DEFAULT_MARS_PROVIDERS) {
      this._providers.set(p.id, { ...p });
    }
    if (opts.themisMetadata) {
      this.configureFromThemisMetadata(opts.themisMetadata, this.demoTileBaseUrl);
    }
  }

  configureFromThemisMetadata(themis, baseUrl = this.demoTileBaseUrl) {
    if (!themis || typeof themis !== "object") return;
    this.demoTileBaseUrl = baseUrl;
    for (const band of ["day", "night"]) {
      const cfg = themis[band];
      if (!cfg) continue;
      const pid = band === "day" ? "themis-day" : "themis-night";
      const prov = this._providers.get(pid);
      if (prov && cfg.tile_url_template) {
        prov.urlTemplate = cfg.tile_url_template
          .replace("{Style}", cfg.style || "default")
          .replace("{TileMatrixSet}", cfg.tile_matrix_set || "default028mm")
          .replace("{TileMatrix}", "{eqZ}")
          .replace("{TileRow}", "{row}")
          .replace("{TileCol}", "{col}")
          .replace(/\/1\.0\.0\/+/g, "/1.0.0/");
      }
      if (Array.isArray(cfg.cached_gale_sample_tiles)) {
        this._localThemisEntries[band] = [];
        for (const t of cfg.cached_gale_sample_tiles) {
          const eqZ = Number(t.z);
          const row = Number(t.row);
          const col = Number(t.col);
          const key = `${band}:${t.z}:${row}:${col}`;
          const filename = String(t.relpath || "").split("/").pop();
          if (filename) {
            const url = `${baseUrl}/${band}/${filename}`;
            this._localThemisMap.set(key, url);
            this._localThemisEntries[band].push({ eqZ, row, col, url });
          }
        }
        this._localThemisEntries[band].sort((a, b) => b.eqZ - a.eqZ);
      }
    }
  }

  registerProvider(provider) {
    if (!provider || !provider.id) throw new Error("Provider requires an id");
    this._providers.set(provider.id, { ...provider });
  }

  getProvider(id) {
    return this._providers.get(id) || null;
  }

  listProviders(kind = null) {
    const all = [...this._providers.values()];
    const filtered = kind ? all.filter((p) => p.kind === kind) : all;
    return filtered.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  /**
   * Build the equirectangular tile URL for a provider (local cached demo tile first if available).
   * Returns `null` if blocked by `demoSafe` or out of LOD range.
   */
  resolveEquirectTileUrl(providerId, eqZ, col, row) {
    const prov = this._providers.get(providerId);
    if (!prov) return null;

    if (providerId === "themis-day" || providerId === "themis-night") {
      const band = providerId === "themis-day" ? "day" : "night";
      const exactUrl = this._localThemisMap.get(`${band}:${eqZ}:${row}:${col}`);
      if (exactUrl) return { url: exactUrl, isLocal: true, eqZ, col, row };

      // In demoSafe mode (or at intermediate zooms like eqZ=9/7/5), reuse cached ancestor tile
      if (this.demoSafe) {
        for (const cand of this._localThemisEntries[band] || []) {
          if (cand.eqZ > eqZ) continue;
          const shift = eqZ - cand.eqZ;
          if (Math.floor(col / 2 ** shift) === cand.col && Math.floor(row / 2 ** shift) === cand.row) {
            return { url: cand.url, isLocal: true, eqZ: cand.eqZ, col: cand.col, row: cand.row };
          }
        }
      }
    }

    if (this.demoSafe && !prov.localOnly) {
      return null; // Hard guard: zero external network requests in demoSafe mode
    }
    if (!prov.urlTemplate) return null;
    if (eqZ < (prov.minEqZ ?? 0) || eqZ > (prov.maxEqZ ?? 12)) return null;

    const url = prov.urlTemplate
      .replace("{eqZ}", String(eqZ))
      .replace("{z}", String(eqZ))
      .replace("{row}", String(row))
      .replace("{y}", String(row))
      .replace("{col}", String(col))
      .replace("{x}", String(col));
    return { url, isLocal: false, eqZ, col, row };
  }

  /**
   * Fetch with singleflight deduplication, AbortSignal isolation, timeout, and circuit-breaker update.
   */
  async fetchSingleflight(cacheKey, url, { providerId = "unknown", signal = null, responseType = "arrayBuffer" } = {}) {
    if (this.cache.has(cacheKey)) {
      this.recordActiveAttribution(providerId);
      return { data: this.cache.get(cacheKey), fromCache: true, providerId };
    }

    if (this.demoSafe && /^https?:\/\//i.test(url)) {
      const err = new Error(`Blocked external URL in demoSafe mode: ${url}`);
      err.status = 0;
      err.demoBlocked = true;
      throw err;
    }

    if (signal?.aborted) {
      const abortErr = new Error("Aborted");
      abortErr.name = "AbortError";
      throw abortErr;
    }

    let promise = this._inflight.get(cacheKey);
    if (!promise) {
      promise = (async () => {
        if (!this.fetchImpl) throw new Error("No fetch implementation available");
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error("Timeout")), this.timeoutMs);
        try {
          const res = await this.fetchImpl(url, { signal: controller.signal });
          if (!res.ok) {
            const err = new Error(`HTTP ${res.status} from ${providerId}`);
            err.status = res.status;
            throw err;
          }
          const payload =
            responseType === "blob"
              ? await res.blob()
              : responseType === "json"
                ? await res.json()
                : await res.arrayBuffer();
          const byteLen =
            payload?.byteLength ?? payload?.size ?? 16 * 1024;
          this.cache.set(cacheKey, payload, byteLen);
          this.breaker.recordSuccess(providerId);
          this.recordActiveAttribution(providerId);
          return payload;
        } catch (err) {
          if (err?.name !== "AbortError") {
            this.breaker.recordFailure(providerId, err?.message || "fetch failed", err?.status || 0);
          }
          throw err;
        } finally {
          clearTimeout(timer);
          this._inflight.delete(cacheKey);
        }
      })();
      this._inflight.set(cacheKey, promise);
    }

    // Wrap promise so caller signal aborts only this caller, not sibling coalesced callers
    const data = await new Promise((resolve, reject) => {
      const onAbort = () => {
        const abortErr = new Error("Aborted");
        abortErr.name = "AbortError";
        reject(abortErr);
      };
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (val) => {
          if (signal) signal.removeEventListener("abort", onAbort);
          resolve(val);
        },
        (err) => {
          if (signal) signal.removeEventListener("abort", onAbort);
          reject(err);
        }
      );
    });

    return { data, fromCache: false, providerId };
  }

  /**
   * Attempt providers along a cascading fallback chain until one succeeds.
   * Example cascade for Mars imagery: `["onmars-ctx", "trek-ctx", "themis-day", "mola-color"]`.
   */
  async fetchWithCascade(providerChain, { eqZ, col, row, signal = null, responseType = "arrayBuffer" }) {
    const errors = [];
    for (const providerId of providerChain) {
      const prov = this._providers.get(providerId);
      if (!prov) continue;
      if (!this.breaker.canAttempt(providerId)) {
        errors.push({ providerId, skipped: true, reason: "circuit-open" });
        continue;
      }
      const clampedZ = Math.max(prov.minEqZ ?? 0, Math.min(prov.maxEqZ ?? eqZ, eqZ));
      const scaleDiff = eqZ - clampedZ;
      const targetCol = Math.floor(col / 2 ** scaleDiff);
      const targetRow = Math.floor(row / 2 ** scaleDiff);

      const resolved = this.resolveEquirectTileUrl(providerId, clampedZ, targetCol, targetRow);
      if (!resolved) {
        errors.push({ providerId, skipped: true, reason: this.demoSafe ? "demo-blocked" : "unavailable" });
        continue;
      }
      const actualZ = resolved.eqZ ?? clampedZ;
      const actualCol = resolved.col ?? targetCol;
      const actualRow = resolved.row ?? targetRow;
      const key = `${providerId}:${actualZ}:${actualCol}:${actualRow}`;
      try {
        const result = await this.fetchSingleflight(key, resolved.url, {
          providerId,
          signal,
          responseType,
        });
        return {
          ...result,
          eqZ: actualZ,
          col: actualCol,
          row: actualRow,
          requestedEqZ: eqZ,
          requestedCol: col,
          requestedRow: row,
          errors,
        };
      } catch (err) {
        if (err?.name === "AbortError" && signal?.aborted) throw err;
        errors.push({
          providerId,
          status: err?.status || 0,
          message: err?.message || String(err),
        });
      }
    }

    const finalErr = new Error(
      `All Mars providers in cascade [${providerChain.join(", ")}] failed`
    );
    finalErr.attempts = errors;
    throw finalErr;
  }

  /**
   * Default Mars imagery cascade starting from a desired primary layer.
   */
  getImageryCascade(primaryId = "onmars-ctx") {
    // trek-ctx is kept as a provider record but left out of the cascade: its Trek WMTS path returns 404
    // (verified 2026-11-14), so trying it first only delayed every CTX tile.
    const base = ["onmars-ctx", "themis-day", "mola-color"];
    const ordered = [primaryId, ...base.filter((id) => id !== primaryId)];
    return ordered.filter((id) => this._providers.has(id));
  }

  recordActiveAttribution(providerId) {
    if (!this._providers.has(providerId)) return;
    if (!this._activeAttributionIds.has(providerId)) {
      this._activeAttributionIds.add(providerId);
      const list = this.getActiveAttributions();
      for (const fn of this._attrListeners) fn(list);
    }
  }

  onAttributionChange(fn) {
    this._attrListeners.add(fn);
    return () => this._attrListeners.delete(fn);
  }

  getActiveAttributions() {
    const out = [];
    for (const id of this._activeAttributionIds) {
      const p = this._providers.get(id);
      if (p) {
        out.push({
          id: p.id,
          label: p.attribution || p.label,
          sourceUrl: p.sourceUrl,
          fetchDate: p.fetchDate,
        });
      }
    }
    return out;
  }

  static equirectZoomForMercatorZ(mercatorZ, maxEqZ = 9) {
    return mercatorZoomToMarsEquirectZoom(mercatorZ, maxEqZ);
  }
}
