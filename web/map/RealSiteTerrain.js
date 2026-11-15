/**
 * Real elevation for landing sites away from the Gale HiRISE corridor (`web/map/RealSiteTerrain.js`).
 *
 * - HiRISE DTM windows (2 km, 2 m spacing) cut around rover / lander sites by
 *   `pipeline/terrain/fetch_site_dtms.py` -> `data/demo/sites/<id>/{meta.json,height.bin}`.
 * - Global MGS MOLA topography (8 px/deg, ~7.4 km) from `pipeline/globe/build_mola_grid.py`
 *   -> `data/demo/globe/mola-8ppd.png` (height = R*256 + G - 32768), used everywhere else.
 * Inside a DTM window the DTM is used, fading to MOLA over the last 120 m of the window.
 * Heights are metres above the MOLA areoid; samplers return them relative to the site centre.
 * All files are local, so this works offline (`?demo=1`).
 */

const MARS_R_M = 3389500;
const DEG = Math.PI / 180;

/** Site ids that have a HiRISE DTM window (see data/demo/sites/index.json). */
export const DTM_SITE_IDS = Object.freeze(["perseverance", "spirit", "opportunity", "insight", "sojourner"]);

let molaPromise = null;
let mola = null; // { w, h, ppd, data: Int16Array }
const dtmCache = new Map(); // id -> Promise<dtm | null>
const dtms = new Map(); // id -> dtm

function resolveUrl(rel) {
  // the app is served from /web/, data from /data/
  return new URL(`../data/demo/${rel}`, typeof document !== "undefined" ? document.baseURI : "http://localhost/web/").href;
}

/** Decode the MOLA RG-encoded PNG into an Int16Array (browser only). */
export function loadMolaGlobe(url = resolveUrl("globe/mola-8ppd.png")) {
  if (molaPromise) return molaPromise;
  molaPromise = (async () => {
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, c.width, c.height).data;
      const data = new Int16Array(c.width * c.height);
      for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = px[j] * 256 + px[j + 1] - 32768;
      mola = { w: c.width, h: c.height, ppd: c.width / 360, data };
      return mola;
    } catch {
      return null;
    }
  })();
  return molaPromise;
}

/** Set the MOLA grid directly (tests, workers). */
export function setMolaGrid(grid) {
  mola = grid;
  molaPromise = Promise.resolve(grid);
}

/** MOLA height (m) at a latitude / east longitude, bilinear; null before the grid is loaded. */
export function sampleMolaM(latDeg, lonEDeg) {
  if (!mola) return null;
  const { w, h, ppd, data } = mola;
  const lon = (((lonEDeg % 360) + 360) % 360) * ppd - 0.5;
  const row = (90 - latDeg) * ppd - 0.5;
  const r0 = Math.max(0, Math.min(h - 1, Math.floor(row)));
  const r1 = Math.min(h - 1, r0 + 1);
  const ty = Math.max(0, Math.min(1, row - r0));
  const c0 = ((Math.floor(lon) % w) + w) % w;
  const c1 = (c0 + 1) % w;
  const tx = lon - Math.floor(lon);
  const a = data[r0 * w + c0] + (data[r0 * w + c1] - data[r0 * w + c0]) * tx;
  const b = data[r1 * w + c0] + (data[r1 * w + c1] - data[r1 * w + c0]) * tx;
  return a + (b - a) * ty;
}

/** Load a site's HiRISE DTM window; resolves to null when the site has none. */
export function loadSiteDtm(siteId) {
  if (!DTM_SITE_IDS.includes(siteId)) return Promise.resolve(null);
  if (dtmCache.has(siteId)) return dtmCache.get(siteId);
  const p = (async () => {
    try {
      const meta = await (await fetch(resolveUrl(`sites/${siteId}/meta.json`))).json();
      const buf = await (await fetch(resolveUrl(`sites/${siteId}/height.bin`))).arrayBuffer();
      const dtm = makeDtm(meta, new Uint16Array(buf));
      dtms.set(siteId, dtm);
      return dtm;
    } catch {
      return null;
    }
  })();
  dtmCache.set(siteId, p);
  return p;
}

/** Build a DTM sampler object from meta.json and the uint16 grid. */
export function makeDtm(meta, u16) {
  return { meta, u16, halfW: (meta.width * meta.spacingM) / 2, halfH: (meta.height * meta.spacingM) / 2 };
}

export function registerDtm(siteId, dtm) {
  dtms.set(siteId, dtm);
  dtmCache.set(siteId, Promise.resolve(dtm));
}

export function getLoadedDtm(siteId) {
  return dtms.get(siteId) || null;
}

/** DTM height (m) at local metres (x east, z south) from the window centre; null outside. */
export function sampleDtmLocalM(dtm, x, z) {
  const { meta, u16, halfW, halfH } = dtm;
  if (Math.abs(x) >= halfW || Math.abs(z) >= halfH) return null;
  const fx = (x + halfW) / meta.spacingM - 0.5;
  const fy = (z + halfH) / meta.spacingM - 0.5;
  const c0 = Math.max(0, Math.min(meta.width - 2, Math.floor(fx)));
  const r0 = Math.max(0, Math.min(meta.height - 2, Math.floor(fy)));
  const tx = Math.max(0, Math.min(1, fx - c0));
  const ty = Math.max(0, Math.min(1, fy - r0));
  const i = r0 * meta.width + c0;
  const a = u16[i] + (u16[i + 1] - u16[i]) * tx;
  const b = u16[i + meta.width] + (u16[i + meta.width + 1] - u16[i + meta.width]) * tx;
  return meta.heightOffsetM + (a + (b - a) * ty) * meta.heightScaleM;
}

/**
 * Height sampler for a site: (x east, z south in metres from the site point) -> metres relative to the
 * site point's own elevation. Returns null when neither the DTM nor MOLA is available yet.
 */
export function createRealSiteSampler({ siteId = null, lat, lonE }) {
  const dtm = siteId ? getLoadedDtm(siteId) : null;
  // the DTM window is centred on its own site; a custom point uses MOLA only
  const mPerDegLat = MARS_R_M * DEG;
  const mPerDegLon = MARS_R_M * DEG * Math.max(0.05, Math.cos(lat * DEG));
  const molaAt = (x, z) => sampleMolaM(lat - z / mPerDegLat, lonE + x / mPerDegLon);
  const base = (() => {
    if (dtm) return sampleDtmLocalM(dtm, 0, 0);
    return molaAt(0, 0);
  })();
  if (base === null || !Number.isFinite(base)) return null;
  const molaBase = molaAt(0, 0);
  const fadeM = 120;
  return function sample(x, z) {
    const m = molaAt(x, z);
    // MOLA relative to the site, shifted so it meets the DTM at the site point
    const mRel = m === null ? 0 : m - (molaBase ?? m);
    if (!dtm) return mRel;
    const d = sampleDtmLocalM(dtm, x, z);
    if (d === null) return mRel;
    const edge = Math.min(dtm.halfW - Math.abs(x), dtm.halfH - Math.abs(z));
    const t = Math.max(0, Math.min(1, edge / fadeM));
    const s = t * t * (3 - 2 * t);
    return mRel + (d - base - mRel) * s;
  };
}

/** Absolute elevation (m above the areoid) of a site point, for HUD readouts. */
export function siteElevationM({ siteId = null, lat, lonE }) {
  const dtm = siteId ? getLoadedDtm(siteId) : null;
  if (dtm) return sampleDtmLocalM(dtm, 0, 0);
  return sampleMolaM(lat, lonE);
}
