/**
 * Real elevation grids the planner can route on, finest first (`web/planner/terrain-sources.js`).
 *
 *  - Gale corridor: HiRISE DTM DTEEC_009149 block-averaged to ~5.06 m (data/demo/height-preview.png,
 *    same grid as the pipeline cost map, pipeline/costmap/make_corridor_cost_map.py).
 *  - Landing sites: HiRISE DTM windows at ~2 m (data/demo/sites/<id>/, pipeline/terrain/fetch_site_dtms.py).
 *  - Everywhere: MGS MOLA MEGDR at 8 px/deg (~7.4 km), cut to a window around the leg. Coarse: it shows
 *    large-scale relief only and must not be read as EVA-scale safety information; the UI says so.
 */

import { loadMolaGlobe } from "../map/RealSiteTerrain.js";
import { gridContains, molaWindow } from "./routing.js";

const MARS_R_M = 3389500;
const DEG = Math.PI / 180;
const norm180 = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

async function loadImagePixels(url) {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  return { w: c.width, h: c.height, px: g.getImageData(0, 0, c.width, c.height).data };
}

/** Gale ~5 m grid from the 16-bit height preview that matches the cost map. */
async function loadGaleGrid(data) {
  const cm = data.costMap;
  if (!cm?.bounds || !data.assets?.heightPreviewUrl) return null;
  const [eMin, eMax] = cm.height_preview_elevation_range_m || [];
  if (!Number.isFinite(eMin) || !Number.isFinite(eMax)) return null;
  const { w, h, px } = await loadImagePixels(data.assets.heightPreviewUrl);
  const elev = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const v = px[i * 4] * 256 + px[i * 4 + 1];
    elev[i] = v === 0 ? NaN : eMin + (v / 65535) * (eMax - eMin);
  }
  const b = cm.bounds;
  const midLat = (b.south_lat_deg + b.north_lat_deg) / 2;
  return {
    id: "gale-hirise",
    label: "HiRISE DTM DTEEC_009149 (Gale), ~5 m grid",
    resolutionM: cm.cell_size_m || 5.06,
    nx: w,
    nz: h,
    dx: ((b.east_lon_deg - b.west_lon_deg) * DEG * MARS_R_M * Math.cos(midLat * DEG)) / w,
    dz: ((b.north_lat_deg - b.south_lat_deg) * DEG * MARS_R_M) / h,
    elev,
    west: b.west_lon_deg,
    east: b.east_lon_deg,
    south: b.south_lat_deg,
    north: b.north_lat_deg,
    source: cm.sources?.[0] || null,
  };
}

/** One landing-site HiRISE DTM window (~2 m). */
async function loadSiteGrid(base, id, info) {
  const meta = await (await fetch(`${base}/sites/${id}/meta.json`)).json();
  const u16 = new Uint16Array(await (await fetch(`${base}/sites/${id}/height.bin`)).arrayBuffer());
  const elev = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) elev[i] = meta.heightOffsetM + u16[i] * meta.heightScaleM;
  const b = meta.bounds;
  return {
    id: `site-${id}`,
    label: `HiRISE DTM ${meta.source?.product || ""} (${info.description}), ~${meta.spacingM.toFixed(1)} m`,
    resolutionM: meta.spacingM,
    nx: meta.width,
    nz: meta.height,
    dx: meta.spacingM,
    dz: meta.spacingM,
    elev,
    west: norm180(b.west),
    east: norm180(b.west) + (b.east - b.west),
    south: b.south,
    north: b.north,
    validFraction: meta.validFraction,
    source: meta.source ? { name: meta.source.provider, product_id: meta.source.product, url: meta.source.url, fetch_date: meta.source.fetched } : null,
  };
}

/**
 * Loads every grid. Returns { grids: [...finest first], mola, pick(lonLatA, lonLatB) }.
 * `pick` returns the finest grid that contains both points, or a MOLA window around them.
 */
export async function loadTerrainSources(data) {
  const base = new URL("../data/demo", document.baseURI).href;
  const grids = [];
  const gale = await loadGaleGrid(data).catch(() => null);
  if (gale) grids.push(gale);
  try {
    const idx = await (await fetch(`${base}/sites/index.json`)).json();
    const loaded = await Promise.all(
      Object.entries(idx.sites || {}).map(([id, info]) => loadSiteGrid(base, id, info).catch(() => null))
    );
    for (const g of loaded) if (g) grids.push(g);
  } catch {
    /* no site DTMs: MOLA still covers everything */
  }
  const mola = await loadMolaGlobe();
  grids.sort((p, q) => p.resolutionM - q.resolutionM);

  function pick(a, b) {
    for (const g of grids) if (gridContains(g, a[0], a[1]) && gridContains(g, b[0], b[1])) return g;
    if (!mola) return null;
    const pad = 0.6; // degrees (~35 km) around the leg so the search can go around obstacles
    const w = molaWindow(mola, {
      west: Math.min(a[0], b[0]) - pad,
      east: Math.max(a[0], b[0]) + pad,
      south: Math.max(-89, Math.min(a[1], b[1]) - pad),
      north: Math.min(89, Math.max(a[1], b[1]) + pad),
    });
    w.id = "mola";
    w.coarse = true;
    w.source = {
      name: "MGS MOLA MEGDR megt90n000eb (16 px/deg, averaged to 8 px/deg)",
      url: "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.lbl",
      fetch_date: "2026-11-15",
    };
    return w;
  }

  /** Finest grid covering one point (for hover readouts). */
  function at(lon, lat) {
    for (const g of grids) if (gridContains(g, lon, lat)) return g;
    return null;
  }

  return { grids, mola, pick, at };
}
