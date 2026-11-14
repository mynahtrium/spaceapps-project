/**
 * Gale Crater / Mount Sharp 2D/2.5D Tactical Map Controller (`planner.js`).
 *
 * Uses the unified `IMapAdapter` interface (`MapLibreMarsAdapter` with custom
 * `mars-eq://` + `mars-dem://` Terrarium terrain relief, or `LegacyMapAdapter` when `?legacyMap=1`).
 */

import { shouldUseHighResMap } from "../map/IMapAdapter.js";
import { LegacyMapAdapter } from "../map/LegacyMapAdapter.js";
import { MapLibreMarsAdapter } from "../map/MapLibreMarsAdapter.js";
import {
  buildCumulativeDistances,
  classifySlope,
  closestAlongM,
  dispatchSetRoute,
} from "../shared/route-bridge.js";

function renderElevationProfile(svgEl, profile, stops, cumDist, routeCoords, strictLimitDeg, activeAlongM = 0) {
  if (!svgEl) return;
  if (!Array.isArray(profile) || profile.length < 2) {
    svgEl.innerHTML =
      '<text x="12" y="45" fill="#94a3b8" font-size="11">no NASA value — route profile unavailable</text>';
    return;
  }

  const W = 380;
  const H = 96;
  const padL = 34;
  const padR = 10;
  const padT = 12;
  const padB = 20;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const sMax = Math.max(1, profile[profile.length - 1].s_m || 1);
  let eMin = Infinity;
  let eMax = -Infinity;
  for (const p of profile) {
    if (p.elev_m < eMin) eMin = p.elev_m;
    if (p.elev_m > eMax) eMax = p.elev_m;
  }
  const eSpan = Math.max(5, eMax - eMin);

  const sx = (s) => padL + (s / sMax) * plotW;
  const sy = (e) => padT + plotH - ((e - eMin) / eSpan) * plotH;

  let segmentsSvg = "";
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1];
    const b = profile[i];
    const slope = Math.max(a.slope_deg ?? 0, b.slope_deg ?? 0);
    const { color } = classifySlope(slope, strictLimitDeg);
    segmentsSvg += `<line x1="${sx(a.s_m).toFixed(1)}" y1="${sy(a.elev_m).toFixed(1)}" x2="${sx(b.s_m).toFixed(1)}" y2="${sy(b.elev_m).toFixed(1)}" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>`;
  }

  let areaPts = `${sx(profile[0].s_m).toFixed(1)},${(padT + plotH).toFixed(1)} `;
  for (const p of profile) {
    areaPts += `${sx(p.s_m).toFixed(1)},${sy(p.elev_m).toFixed(1)} `;
  }
  areaPts += `${sx(profile[profile.length - 1].s_m).toFixed(1)},${(padT + plotH).toFixed(1)}`;

  let stopTicks = "";
  if (Array.isArray(stops?.features) && Array.isArray(routeCoords)) {
    for (const st of stops.features) {
      const [lon, lat] = st.geometry?.coordinates || [];
      if (lon == null) continue;
      const sm = closestAlongM(routeCoords, cumDist, lon, lat);
      const x = sx(sm);
      const col = st.properties?.kind === "bonus" ? "#fbbf24" : "#34d399";
      stopTicks += `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${padT + plotH}" stroke="${col}" stroke-opacity="0.45" stroke-dasharray="2,2"/>`;
    }
  }

  const markerX = sx(Math.max(0, Math.min(sMax, activeAlongM)));

  svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svgEl.innerHTML = `
    <polygon points="${areaPts}" fill="rgba(56, 189, 248, 0.12)" />
    ${stopTicks}
    ${segmentsSvg}
    <line x1="${markerX.toFixed(1)}" y1="${padT - 2}" x2="${markerX.toFixed(1)}" y2="${padT + plotH + 2}" stroke="#22d3ee" stroke-width="1.6" />
    <text x="${padL}" y="10" fill="#94a3b8" font-size="9">${eMax.toFixed(0)} m MOLA</text>
    <text x="${padL}" y="${padT + plotH + 14}" fill="#94a3b8" font-size="9">0 m · ${eMin.toFixed(0)} m</text>
    <text x="${W - padR}" y="${padT + plotH + 14}" text-anchor="end" fill="#94a3b8" font-size="9">${sMax.toFixed(0)} m walk</text>
  `;
}

export async function initPlanner(data, opts = {}) {
  const {
    demSampler,
    registry,
    onOpenPov,
    onStrictLimitChange,
    onAttributionsChange,
    onLocationProbe,
  } = opts;

  const container = document.getElementById("map");
  const probeEl = document.getElementById("map-probe-readout");
  const strictToggle = document.getElementById("toggle-strict-15");
  const toggle3dMap = document.getElementById("toggle-3d-map");
  const legendLimit = document.getElementById("legend-limit");
  const profileSvg = document.getElementById("profile-svg");

  const useHighRes = shouldUseHighResMap();
  const adapter = useHighRes
    ? new MapLibreMarsAdapter({
        demSampler,
        registry,
        demoSafe: data.demoSafe,
        orthoPreviewUrl: data.assets?.orthoPreviewUrl,
        slopePreviewUrl: data.assets?.slopePreviewUrl,
      })
    : new LegacyMapAdapter({
        demSampler,
        demoSafe: data.demoSafe,
        orthoPreviewUrl: data.assets?.orthoPreviewUrl,
        slopePreviewUrl: data.assets?.slopePreviewUrl,
      });

  const routeCoords = data.route?.geometry?.coordinates || [];
  const cumDist = buildCumulativeDistances(routeCoords);
  const startCoord = routeCoords[0] || [137.39, -4.8];

  await adapter.mount(container, {
    center: startCoord,
    zoom: 14.6,
    pitch: 0,
    bearing: 0,
  });

  // Add Mars vector & science GeoJSON overlays
  if (Array.isArray(data.crism?.products)) {
    const crismFc = {
      type: "FeatureCollection",
      features: data.crism.products
        .filter((p) => p.center_lat != null && p.center_lon != null)
        .map((p) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [p.center_lon, p.center_lat] },
          properties: { id: p.product_id, name: p.product_id },
        })),
    };
    adapter.addGeoJsonLayer("crism-pts", crismFc, {
      type: "circle",
      radius: 5,
      color: "#c084fc",
      visible: true,
    });
  }

  if (data.route) {
    const routeFc = { type: "FeatureCollection", features: [data.route] };
    adapter.addGeoJsonLayer("eva-route", routeFc, {
      type: "line",
      color: "#38bdf8",
      width: 3.5,
      visible: true,
    });
  }

  if (data.stops) {
    adapter.addGeoJsonLayer("eva-stops", data.stops, {
      type: "circle",
      radiusExpr: ["match", ["get", "kind"], "bonus", 7, 6],
      colorExpr: ["match", ["get", "kind"], "bonus", "#fbbf24", "#34d399"],
      color: "#34d399",
      visible: true,
    });
  }

  const astronautFc = (lon, lat) => ({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: { id: "ASTRONAUT" },
      },
    ],
  });
  adapter.addGeoJsonLayer("astronaut-pos", astronautFc(startCoord[0], startCoord[1]), {
    type: "circle",
    radius: 7,
    color: "#22d3ee",
    strokeWidth: 2,
    strokeColor: "#ffffff",
    visible: true,
  });

  // Wire imagery & hazard toggles cleanly
  const bindCheckbox = (elId, handler) => {
    const el = document.getElementById(elId);
    if (!el) return;
    el.addEventListener("change", () => handler(el.checked));
  };

  bindCheckbox("layer-ortho", (on) => adapter.setLayerVisibility("hirise-ortho", on));
  bindCheckbox("layer-slope", (on) => adapter.setLayerVisibility("slope-preview", on));
  bindCheckbox("layer-crism", (on) => adapter.setLayerVisibility("crism-pts", on));
  bindCheckbox("layer-ctx", (on) => adapter.setLayerVisibility("onmars-ctx", on));
  bindCheckbox("layer-themis-day", (on) => adapter.setLayerVisibility("themis-day", on));
  bindCheckbox("layer-themis-night", (on) => adapter.setLayerVisibility("themis-night", on));
  bindCheckbox("layer-mola", (on) => adapter.setLayerVisibility("mola-color", on));

  if (toggle3dMap) {
    toggle3dMap.addEventListener("change", () => {
      if (typeof adapter.setTerrain3D === "function") {
        adapter.setTerrain3D(toggle3dMap.checked);
      }
    });
  }

  let strictLimit = 20;
  let currentAlongM = 0;
  const refreshProfile = () => {
    renderElevationProfile(
      profileSvg,
      data.route?.profile,
      data.stops,
      cumDist,
      routeCoords,
      strictLimit,
      currentAlongM
    );
  };
  refreshProfile();

  if (strictToggle) {
    strictToggle.addEventListener("change", () => {
      strictLimit = strictToggle.checked ? 15 : 20;
      if (legendLimit) {
        legendLimit.textContent = strictToggle.checked
          ? "Blocked >15° (strict lunar stand-in)"
          : "Blocked >20° (lunar stand-in)";
      }
      refreshProfile();
      if (onStrictLimitChange) onStrictLimitChange(strictLimit);
    });
  }

  // Interactive click probing + route jump
  adapter.on("click", (evt) => {
    const elevStr = evt.elevM != null ? `${evt.elevM.toFixed(1)} m MOLA` : "no NASA value";
    const slopeStr = evt.slopeDeg != null ? `${evt.slopeDeg.toFixed(1)}°` : "--";
    if (probeEl) {
      probeEl.textContent = `${evt.lat.toFixed(5)}°, ${evt.lon.toFixed(5)}° · ${elevStr} · slope ${slopeStr}`;
    }
    if (onLocationProbe) onLocationProbe(evt);

    // Check if near any stop (within ~35 m on Mars)
    if (Array.isArray(data.stops?.features)) {
      let nearest = null;
      let minDist = Infinity;
      for (const st of data.stops.features) {
        const c = st.geometry?.coordinates;
        if (!c) continue;
        const d = Math.hypot((c[0] - evt.lon) * 59000, (c[1] - evt.lat) * 59150);
        if (d < 42 && d < minDist) {
          minDist = d;
          nearest = st;
        }
      }
      if (nearest) {
        const c = nearest.geometry.coordinates;
        const sM = closestAlongM(routeCoords, cumDist, c[0], c[1]);
        dispatchSetRoute(data.route, sM);
        if (onOpenPov) onOpenPov(nearest.properties);
      }
    }
  });

  adapter.on("hover", (evt) => {
    if (probeEl && evt.elevM != null) {
      probeEl.textContent = `${evt.lat.toFixed(4)}°, ${evt.lon.toFixed(4)}° · ${evt.elevM.toFixed(1)} m · ${evt.slopeDeg != null ? evt.slopeDeg.toFixed(1) + "°" : "--"}`;
    }
  });

  if (onAttributionsChange) {
    adapter.on("attributionchange", onAttributionsChange);
  }

  // Clickable SVG elevation profile jump
  if (profileSvg && data.route) {
    profileSvg.style.cursor = "pointer";
    profileSvg.addEventListener("click", (e) => {
      const rect = profileSvg.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
      const total = cumDist[cumDist.length - 1] || data.route.properties?.distance_m || 790;
      dispatchSetRoute(data.route, frac * total);
    });
  }

  return {
    map: adapter,
    adapter,
    updateAstronautPosition(lon, lat, alongM = null) {
      adapter.updateGeoJsonLayer("astronaut-pos", astronautFc(lon, lat));
      if (typeof alongM === "number") {
        currentAlongM = alongM;
        refreshProfile();
      }
    },
    redrawProfile: refreshProfile,
  };
}
