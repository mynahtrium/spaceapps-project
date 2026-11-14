/**
 * Data loader with strict Demo-Safe mode (?demo=1 / DEMO_SAFE) and contract fallback.
 * Load order (normal): data/processed/... -> docs/contracts/...
 * Load order (?demo=1): data/demo/... ONLY (no external network, NASA, or DONKI calls).
 */

export function isDemoSafeMode() {
  const params = new URLSearchParams(window.location.search);
  return params.get("demo") === "1" || window.DEMO_SAFE === true;
}

async function fetchJsonWithFallback(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return { data: await res.json(), url };
      }
    } catch {
      // Try next fallback
    }
  }
  return { data: null, url: null };
}

/**
 * Load all terrain, routing, telemetry, and science datasets for the astronaut visor.
 */
export async function loadAllProjectData() {
  const demoSafe = isDemoSafeMode();

  const paths = (processedPath, demoPath, contractPath) => {
    if (demoSafe) return [demoPath];
    const list = [processedPath];
    if (contractPath) list.push(contractPath);
    return list;
  };

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
    fetchJsonWithFallback(
      paths(
        "../data/processed/terrain/cost-map.json",
        "../data/demo/cost-map.json",
        "../docs/contracts/cost-map.json"
      )
    ),
    fetchJsonWithFallback(
      paths(
        "../data/processed/routing/stops.json",
        "../data/demo/stops.json",
        "../docs/contracts/stops.json"
      )
    ),
    fetchJsonWithFallback(
      paths(
        "../data/processed/routing/route.json",
        "../data/demo/route.json",
        "../docs/contracts/route.json"
      )
    ),
    fetchJsonWithFallback(
      paths(
        "../data/processed/routing/hud-telemetry.json",
        "../data/demo/hud-telemetry.json",
        "../docs/contracts/hud-telemetry.json"
      )
    ),
    fetchJsonWithFallback(
      paths(
        "../data/processed/science/alerts.json",
        "../data/demo/alerts.json",
        "../docs/contracts/alerts.json"
      )
    ),
    fetchJsonWithFallback(
      paths(
        "../data/processed/science/dose.json",
        "../data/demo/dose.json",
        "../docs/contracts/dose.json"
      )
    ),
    fetchJsonWithFallback(
      paths(
        "../data/processed/science/weather.json",
        "../data/demo/weather.json",
        "../docs/contracts/weather.json"
      )
    ),
    fetchJsonWithFallback(
      paths(
        "../data/processed/science/pov/index.json",
        "../data/demo/pov/index.json",
        null
      )
    ),
    fetchJsonWithFallback(
      paths(
        "../data/processed/science/layers-themis.json",
        "../data/demo/layers-themis.json",
        null
      )
    ),
    fetchJsonWithFallback(
      paths(
        "../data/processed/science/layers-crism.json",
        "../data/demo/layers-crism.json",
        null
      )
    ),
  ]);

  const baseTerrainDir = demoSafe ? "../data/demo" : "../data/processed/terrain";
  const baseScienceDir = demoSafe ? "../data/demo" : "../data/processed/science";

  return {
    demoSafe,
    costMap: costMapRes.data,
    stops: stopsRes.data,
    route: routeRes.data,
    telemetry: telemetryRes.data,
    alerts: alertsRes.data,
    dose: doseRes.data,
    weather: weatherRes.data,
    povIndex: povIndexRes.data,
    themis: themisRes.data,
    crism: crismRes.data,
    loadedFrom: {
      costMap: costMapRes.url,
      stops: stopsRes.url,
      route: routeRes.url,
      telemetry: telemetryRes.url,
      alerts: alertsRes.url,
      dose: doseRes.url,
      weather: weatherRes.url,
      povIndex: povIndexRes.url,
      themis: themisRes.url,
      crism: crismRes.url,
    },
    assets: {
      heightPreviewUrl: `${baseTerrainDir}/height-preview.png`,
      slopePreviewUrl: `${baseTerrainDir}/slope-preview.png`,
      orthoPreviewUrl: `${baseTerrainDir}/ortho-preview.png`,
      reliefPreviewUrl: demoSafe ? null : "../data/processed/terrain/texture-relief.jpg",
      povBaseUrl: `${baseScienceDir}/pov`,
      themisTileBaseUrl: `${baseScienceDir}/tiles/themis`,
    },
  };
}
