/**
 * Project Data Loader & HiRISE DEM Initializer.
 *
 * Resolution cascade:
 * - Normal mode: `../data/processed/...` -> `../docs/contracts/...`
 * - Demo-safe mode (`?demo=1` or `?DEMO_SAFE=1`): strictly `../data/demo/...` ONLY (zero external network, zero `data/processed/` reads).
 */

import { MarsDemSampler, decodeHiRiseHeightRgbaBuffer } from "../map/MarsDemSampler.js";

export function isDemoSafeMode() {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("demo") === "1" || params.get("DEMO_SAFE") === "1";
  } catch {
    return false;
  }
}

async function fetchJsonSafe(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchWithCascade(urls) {
  for (const url of urls) {
    if (!url) continue;
    const data = await fetchJsonSafe(url);
    if (data !== null) return { data, sourcePath: url };
  }
  return { data: null, sourcePath: null };
}

function collectSources(namedPayloads) {
  const seen = new Set();
  const out = [];
  for (const { label, payload } of namedPayloads) {
    if (!payload || !Array.isArray(payload.sources)) continue;
    for (const s of payload.sources) {
      const key = `${s.name || s.label || ""}|${s.url || s.source_url || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        dataset: label,
        name: s.name || s.label || label,
        url: s.url || s.source_url || "",
        fetchDate: s.fetch_date || s.fetchDate || "2026-11-14",
        note: s.note || s.license || "",
      });
    }
  }
  return out;
}

/**
 * Load height-preview.png into an in-memory RGBA buffer and decode into a void-filled `MarsDemSampler`.
 * Falls back cleanly to a synthetic Gale gradient DEM if PNG decoding is unavailable.
 * @param {object} data Loaded project bundle from `loadAllProjectData()`
 * @returns {Promise<MarsDemSampler>}
 */
export async function loadDemSamplerFromData(data) {
  const cm = data?.costMap;
  const url = data?.assets?.heightPreviewUrl;
  const bounds = cm?.bounds || {
    west_lon_deg: 137.372831,
    south_lat_deg: -4.816946,
    east_lon_deg: 137.406542,
    north_lat_deg: -4.783236,
  };
  const range = cm?.height_preview_elevation_range_m || [-3850.6, -3369.3];
  const cellSizeM = cm?.cell_size_m || 5.059;

  if (!url || typeof Image === "undefined" || typeof document === "undefined") {
    const synth = MarsDemSampler.createSyntheticGale();
    synth.isSyntheticFallback = true;
    return synth;
  }

  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Failed to load DEM image: ${url}`));
      image.src = url;
    });
    const w = img.naturalWidth || img.width || cm?.grid?.ncols || 395;
    const h = img.naturalHeight || img.height || cm?.grid?.nrows || 395;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    const { data: rgba } = ctx.getImageData(0, 0, w, h);
    const { raw, filled, holeCountBefore, holeCountAfter } = decodeHiRiseHeightRgbaBuffer(
      rgba,
      w,
      h,
      range[0],
      range[1]
    );
    const sampler = new MarsDemSampler({
      bounds,
      ncols: w,
      nrows: h,
      cellSizeM,
      elevations: filled,
      rawElevations: raw,
      minElevM: range[0],
      maxElevM: range[1],
    });
    sampler.isSyntheticFallback = false;
    sampler.voidStats = { holeCountBefore, holeCountAfter };
    return sampler;
  } catch (err) {
    console.warn("[data-loader] DEM image load failed; using synthetic Gale DEM:", err);
    const synth = MarsDemSampler.createSyntheticGale();
    synth.isSyntheticFallback = true;
    return synth;
  }
}

export async function loadAllProjectData() {
  const demoSafe = isDemoSafeMode();
  const base = "..";

  const pick = (processedRel, contractRel, demoRel) =>
    demoSafe
      ? [`${base}/data/demo/${demoRel}`]
      : [
          `${base}/data/processed/${processedRel}`,
          `${base}/docs/contracts/${contractRel}`,
        ];

  const [
    costMapRes,
    stopsRes,
    routeRes,
    telemetryRes,
    alertsRes,
    doseRes,
    weatherRes,
    povIndexRes,
    themisRes,
    crismRes,
    globalSourcesRes,
  ] = await Promise.all([
    fetchWithCascade(pick("terrain/cost-map.json", "cost-map.json", "cost-map.json")),
    fetchWithCascade(pick("routing/stops.json", "stops.json", "stops.json")),
    fetchWithCascade(pick("routing/route.json", "route.json", "route.json")),
    fetchWithCascade(
      pick("routing/hud-telemetry.json", "hud-telemetry.json", "hud-telemetry.json")
    ),
    fetchWithCascade(pick("science/alerts.json", "alerts.json", "alerts.json")),
    fetchWithCascade(pick("science/dose.json", "dose.json", "dose.json")),
    fetchWithCascade(pick("science/weather.json", "weather.json", "weather.json")),
    fetchWithCascade(
      pick("science/pov/index.json", "pov/index.json", "pov/index.json")
    ),
    fetchWithCascade(
      demoSafe
        ? [`${base}/data/demo/layers-themis.json`]
        : [
            `${base}/data/processed/science/layers-themis.json`,
            `${base}/data/demo/layers-themis.json`,
          ]
    ),
    fetchWithCascade(
      demoSafe
        ? [`${base}/data/demo/layers-crism.json`]
        : [
            `${base}/data/processed/science/layers-crism.json`,
            `${base}/data/demo/layers-crism.json`,
          ]
    ),
    demoSafe
      ? fetchWithCascade([`${base}/data/demo/mars-global-sources.json`])
      : Promise.resolve({ data: null, sourcePath: null }),
  ]);

  const themis = themisRes.data?.day ? themisRes.data : themisRes.data?.themis ?? null;
  const crism = crismRes.data?.products ? crismRes.data : crismRes.data?.crism ?? crismRes.data;

  const isExampleData =
    Boolean(routeRes.data?.properties?.is_example) ||
    Boolean(stopsRes.data?.features?.[0]?.properties?.is_example) ||
    String(costMapRes.sourcePath || "").includes("contracts") ||
    demoSafe;

  // BUG-14: in demoSafe mode, assets come ONLY from data/demo/ (never data/processed/).
  const terrainBase = demoSafe ? `${base}/data/demo` : `${base}/data/processed/terrain`;
  const assets = {
    heightPreviewUrl: `${terrainBase}/height-preview.png`,
    slopePreviewUrl: `${terrainBase}/slope-preview.png`,
    orthoPreviewUrl: `${terrainBase}/ortho-preview.png`,
    reliefTextureUrl: `${terrainBase}/texture-relief.jpg`,
    povBaseUrl: demoSafe ? `${base}/data/demo/pov` : `${base}/data/processed/science/pov`,
    themisTileBaseUrl: `${base}/data/demo/tiles/themis`,
    demoGlobalMolaDemUrl: demoSafe ? `${base}/data/demo/mars-mola-dem.png` : null,
    demoGlobalVikingMosaicUrl: demoSafe ? `${base}/data/demo/mars-viking-global.jpg` : null,
  };

  const sources = collectSources([
    { label: "HiRISE DTM & Cost Map", payload: costMapRes.data },
    { label: "Gale EVA Stops", payload: stopsRes.data },
    { label: "EVA Route", payload: routeRes.data },
    { label: "DONKI Space Weather", payload: alertsRes.data },
    { label: "RAD Dose Budget", payload: doseRes.data },
    { label: "REMS Weather", payload: weatherRes.data },
    { label: "THEMIS Thermal", payload: themisRes.data },
    { label: "CRISM Mineralogy", payload: crismRes.data },
    { label: "Curiosity Raw POV", payload: povIndexRes.data },
    { label: "Global Mars Topography & Mosaic", payload: globalSourcesRes.data },
  ]);

  return {
    demoSafe,
    isExampleData,
    costMap: costMapRes.data,
    stops: stopsRes.data,
    route: routeRes.data,
    telemetry: telemetryRes.data,
    alerts: alertsRes.data,
    dose: doseRes.data,
    weather: weatherRes.data,
    povIndex: povIndexRes.data,
    themis,
    crism,
    sources,
    assets,
  };
}
