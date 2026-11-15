/**
 * Project Data Loader & HiRISE DEM Initializer.
 *
 * Resolution cascade:
 * - Normal mode: `../data/processed/...` -> `../data/demo/...` (never `docs/contracts/`: shape examples only)
 * - Demo-safe mode (`?demo=1` or `?DEMO_SAFE=1`): strictly `../data/demo/...` ONLY (zero external network, zero `data/processed/` reads).
 */


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

export async function loadAllProjectData() {
  const demoSafe = isDemoSafeMode();
  const base = "..";

  const pick = (processedRel, contractRel, demoRel) =>
    demoSafe
      ? [`${base}/data/demo/${demoRel}`]
      : [
          // Never fall back to docs/contracts/: those are shape examples with invented values.
          `${base}/data/processed/${processedRel}`,
          `${base}/data/demo/${demoRel}`,
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
    // Streamed HiRISE corridor (local static files, same in both modes like the THEMIS tiles).
    corridorBaseUrl: `${base}/data/demo/corridor`,
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
