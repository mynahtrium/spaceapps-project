/**
 * 2D MapLibre GL JS Planner (`web/planner/planner.js`).
 * Displays Mars Trek CTX/THEMIS (skipped in ?demo=1), HiRISE ortho & slope previews,
 * 15°/20° hazard toggle, CRISM footprints, stops, route, elevation profile, and science cards.
 */

import { shouldUseHighResMap } from "../map/IMapAdapter.js";
import { LegacyMapAdapter } from "../map/LegacyMapAdapter.js";
import { MapLibreMarsAdapter } from "../map/MapLibreMarsAdapter.js";
import { dispatchSetRoute, dispatchTeleport } from "../shared/route-bridge.js";

/**
 * Build an RGBA data URL from costMap.cost_row_major for the 15° strict vs 20° mask toggle.
 * cost = 1 + (slope/10)^2 + 0.05*roughness. At 15°, cost >= ~3.25; blocked = 9e99.
 */
function buildStrict15Canvas(costMap) {
  const { ncols, nrows } = costMap.grid;
  const canvas = document.createElement("canvas");
  canvas.width = ncols;
  canvas.height = nrows;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(ncols, nrows);
  const data = costMap.cost_row_major || [];

  for (let i = 0; i < ncols * nrows; i++) {
    const c = data[i];
    const p = i * 4;
    if (c == null || c >= 1e10) {
      // Blocked >20° or no-data
      img.data[p] = 168;
      img.data[p + 1] = 85;
      img.data[p + 2] = 247;
      img.data[p + 3] = 160;
    } else if (c >= 3.25) {
      // >15° strict limit highlight
      img.data[p] = 239;
      img.data[p + 1] = 68;
      img.data[p + 2] = 68;
      img.data[p + 3] = 150;
    } else {
      img.data[p + 3] = 0;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

export function initPlanner(data, { onOpenPov, onStartEva, demSampler, registry }) {
  const { costMap, stops, route, alerts, dose, weather, povIndex, crism, demoSafe, assets } = data;

  const bounds = costMap?.bounds || {
    west_lon_deg: 137.372831,
    south_lat_deg: -4.816946,
    east_lon_deg: 137.406542,
    north_lat_deg: -4.783236,
  };
  const center = [
    (bounds.west_lon_deg + bounds.east_lon_deg) / 2,
    (bounds.south_lat_deg + bounds.north_lat_deg) / 2,
  ];
  const imgCoords = [
    [bounds.west_lon_deg, bounds.north_lat_deg],
    [bounds.east_lon_deg, bounds.north_lat_deg],
    [bounds.east_lon_deg, bounds.south_lat_deg],
    [bounds.west_lon_deg, bounds.south_lat_deg],
  ];

  // High-res Mars map (MapLibre + mars-eq:// Trek tiles + mars-dem:// HiRISE relief),
  // or the legacy adapter with ?legacyMap=1. Both fall back to a 2D canvas without MapLibre.
  const adapterOpts = {
    demSampler,
    registry,
    demoSafe,
    orthoPreviewUrl: assets?.orthoPreviewUrl,
    slopePreviewUrl: assets?.slopePreviewUrl,
  };
  const adapter = shouldUseHighResMap() ? new MapLibreMarsAdapter(adapterOpts) : new LegacyMapAdapter(adapterOpts);
  const container = document.getElementById("map");
  const probeEl = document.getElementById("map-probe-readout");
  const probeTextEl = document.getElementById("map-probe-text") || probeEl;
  const teleportBtn = document.getElementById("map-teleport-btn");
  const toggle3d = document.getElementById("toggle-3d-map");
  let selectedTarget = null;
  let activePopup = null;

  const setTeleportMarker = (lon, lat) => {
    selectedTarget = { lon, lat };
    adapter.updateGeoJsonLayer("teleport-target", {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "Teleport" },
          geometry: { type: "Point", coordinates: [lon, lat] },
        },
      ],
    });
    if (teleportBtn) teleportBtn.style.display = "inline-block";
  };

  const triggerTeleport = (lon, lat) => {
    setTeleportMarker(lon, lat);
    dispatchTeleport({ lon, lat });
    onStartEva?.();
  };

  if (teleportBtn) {
    teleportBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (selectedTarget) triggerTeleport(selectedTarget.lon, selectedTarget.lat);
    });
  }

  const ready = (async () => {
    if (!container) return;
    const terrain3dDefault = toggle3d ? toggle3d.checked : true;
    await adapter.mount(container, {
      center,
      zoom: 14.3,
      pitch: terrain3dDefault ? 52 : 0,
      bearing: terrain3dDefault ? -14 : 0,
      terrain3d: terrain3dDefault,
    });

    // Strict 15° overlay (raw MapLibre image layer or Fallback2DMap raster overlay; hidden until toggled)
    if (costMap?.cost_row_major) {
      const strictUrl = buildStrict15Canvas(costMap);
      if (adapter.map) {
        adapter._runOrQueue(() => {
          adapter.map.addSource("strict-15", { type: "image", url: strictUrl, coordinates: imgCoords });
          adapter.map.addLayer({
            id: "strict-15",
            type: "raster",
            source: "strict-15",
            layout: { visibility: "none" },
            paint: { "raster-opacity": 0.75 },
          });
        });
      } else if (adapter._fallback?.loadRasterOverlay) {
        adapter._fallback.loadRasterOverlay("strict-15", strictUrl, false);
      }
    }

    if (crism?.products?.length) {
      adapter.addGeoJsonLayer(
        "crism-pts",
        {
          type: "FeatureCollection",
          features: crism.products
            .filter((p) => p.center_lon != null && p.center_lat != null)
            .map((p) => ({
              type: "Feature",
              properties: { pdsid: p.pdsid, name: p.pdsid || p.product_id },
              geometry: { type: "Point", coordinates: [parseFloat(p.center_lon), parseFloat(p.center_lat)] },
            })),
        },
        { type: "circle", radius: 6, color: "#c084fc", strokeWidth: 1.5, strokeColor: "#ffffff", visible: true }
      );
    }

    if (route) {
      adapter.addGeoJsonLayer(
        "eva-route",
        { type: "FeatureCollection", features: [route] },
        { type: "line", color: "#ffffff", width: 2.5, visible: true }
      );
    }

    if (stops) {
      adapter.addGeoJsonLayer("eva-stops", stops, {
        type: "circle",
        radius: 8,
        color: "#ffffff",
        strokeWidth: 2,
        strokeColor: "#000000",
        visible: true,
      });
    }

    adapter.addGeoJsonLayer(
      "teleport-target",
      { type: "FeatureCollection", features: [] },
      {
        type: "circle",
        radius: 7,
        color: "#38bdf8",
        strokeWidth: 2,
        strokeColor: "#ffffff",
        visible: true,
      }
    );

    const formatProbe = (evt) => {
      const elev = evt.elevM != null ? `${evt.elevM.toFixed(1)} m` : "no data";
      const slope = evt.slopeDeg != null ? `${evt.slopeDeg.toFixed(1)}°` : "—";
      return `${evt.lat.toFixed(5)}°, ${evt.lon.toFixed(5)}° · ${elev} · slope ${slope}`;
    };

    adapter.on("hover", (evt) => {
      if (!selectedTarget && probeTextEl) probeTextEl.textContent = formatProbe(evt);
    });

    adapter.on("click", (evt) => {
      if (probeTextEl) probeTextEl.textContent = formatProbe(evt);
      setTeleportMarker(evt.lon, evt.lat);
      // Clicked near a stop (~40 m on Mars): show its POV / popup.
      let nearest = null;
      let best = 40;
      for (const f of stops?.features || []) {
        const [lon, lat] = f.geometry.coordinates;
        const d = Math.hypot((lon - evt.lon) * 59000, (lat - evt.lat) * 59150);
        if (d < best) {
          best = d;
          nearest = f;
        }
      }
      if (activePopup) {
        activePopup.remove();
        activePopup = null;
      }
      if (nearest && adapter.map && window.maplibregl) {
        activePopup = new window.maplibregl.Popup()
          .setLngLat(nearest.geometry.coordinates)
          .setHTML(
            `<div style="color:#fff;font-size:12px;"><strong>${nearest.properties.name}</strong><br/><em>${nearest.properties.kind}</em></div>`
          )
          .addTo(adapter.map);
      }
    });

    adapter.on("dblclick", (evt) => {
      if (probeTextEl) probeTextEl.textContent = `${formatProbe(evt)} · TELEPORTING`;
      triggerTeleport(evt.lon, evt.lat);
    });
  })().catch((err) => console.warn("[planner] map mount failed:", err));

  // Layer checkboxes
  const bindToggle = (id, layerId) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => adapter.setLayerVisibility(layerId, el.checked));
  };
  bindToggle("layer-ortho", "hirise-ortho");
  bindToggle("layer-slope", "slope-preview");
  bindToggle("layer-themis-day", "themis-day");
  bindToggle("layer-themis-night", "themis-night");
  bindToggle("layer-crism", "crism-pts");
  bindToggle("layer-ctx", "onmars-ctx");
  bindToggle("layer-mola", "mola-color");

  if (toggle3d) {
    toggle3d.addEventListener("change", () => adapter.setTerrain3D?.(toggle3d.checked));
  }

  // Strict 15° toggle
  const strictToggle = document.getElementById("toggle-strict-15");
  const legendLimit = document.getElementById("legend-limit");
  if (strictToggle) {
    strictToggle.addEventListener("change", () => {
      const strict = strictToggle.checked;
      if (legendLimit) legendLimit.textContent = strict ? "15" : "20";
      adapter.setLayerVisibility("strict-15", strict);
    });
  }

  // Route Summary
  const totals = route?.totals || route?.properties || {};
  document.getElementById("sum-distance").textContent =
    totals.distance_m != null ? `${Number(totals.distance_m).toFixed(1)} m` : "—";
  document.getElementById("sum-climb").textContent =
    totals.climb_m != null ? `+${totals.climb_m} / -${totals.descent_m ?? totals.climb_m} m` : "—";
  document.getElementById("sum-duration").textContent =
    totals.duration_min_placeholder != null ? `${totals.duration_min_placeholder} min` : "—";
  document.getElementById("sum-dose").textContent =
    dose?.dose_estimate_mSv != null ? `${dose.dose_estimate_mSv} ± ${dose.dose_uncertainty_mSv} mSv` : "—";

  // Elevation Profile SVG
  renderProfileSvg(route?.profile || [], (sM) => {
    if (route) {
      dispatchSetRoute(route, sM);
      onStartEva();
    }
  });

  // Stops list
  const stopsList = document.getElementById("stops-list");
  if (stops?.features && stopsList) {
    stopsList.innerHTML = "";
    stops.features.forEach((f) => {
      const p = f.properties;
      const povEntry = povIndex?.stops?.find((s) => s.stop_id === p.id);
      const div = document.createElement("div");
      div.className = "stop-item";
      div.innerHTML = `
        <div class="stop-header">
          <span class="stop-name">${p.name}</span>
          <span class="stop-kind">${p.kind}</span>
        </div>
        <div class="stop-desc">${p.science_summary || ""}</div>
        <div style="display:flex;gap:6px;">
          <button class="btn" data-fly>Zoom</button>
          ${povEntry ? `<button class="btn" data-pov>View Curiosity POV</button>` : ""}
        </div>
      `;
      div.querySelector("[data-fly]")?.addEventListener("click", () => {
        adapter.flyTo({ center: f.geometry.coordinates, zoom: 16 });
      });
      div.querySelector("[data-pov]")?.addEventListener("click", () => {
        if (povEntry) onOpenPov(povEntry);
      });
      stopsList.appendChild(div);
    });
  }

  // DONKI Banner
  const donkiEl = document.getElementById("donki-banner");
  if (donkiEl) {
    const firstAlert = alerts?.alerts?.[0];
    if (firstAlert) {
      donkiEl.innerHTML = `<strong>DONKI Space Weather (${alerts.status}):</strong> ${alerts.alerts.length} Mars WSA-Enlil run(s) in window. Latest: ${firstAlert.predicted_arrival} (${firstAlert.is_glancing_blow ? "glancing blow" : "direct"}).`;
    } else {
      donkiEl.textContent = "No active Mars WSA-Enlil space weather alerts in cached window.";
    }
  }

  // REMS Weather
  const weatherEl = document.getElementById("weather-box");
  if (weatherEl && weather?.latest_sol) {
    const s = weather.latest_sol;
    weatherEl.innerHTML = `<strong>Curiosity REMS (Sol ${s.sol}, ${s.terrestrial_date}):</strong> Air ${s.air_min_C}°C to ${s.air_max_C}°C · Ground ${s.ground_min_C}°C to ${s.ground_max_C}°C · ${s.pressure_Pa} Pa · ${s.atmo_opacity} · Sunrise ${s.sunrise} / Sunset ${s.sunset} LTST.`;
  }

  // Dose note
  const doseEl = document.getElementById("dose-box");
  if (doseEl && dose) {
    doseEl.innerHTML = `<strong>Radiation Dose:</strong> ${dose.dose_estimate_mSv} ± ${dose.dose_uncertainty_mSv} mSv (${dose.baseline_rate_mSv_per_day} mSv/day RAD baseline × ${dose.eva_duration_min_placeholder} min placeholder walk). Time &amp; shielding problem — no spatial rock radiation map.`;
  }

  return { map: adapter, adapter, ready };
}

function renderProfileSvg(profile, onSelectDist) {
  const svg = document.getElementById("profile-svg");
  if (!svg || profile.length < 2) return;
  const W = 320;
  const H = 110;
  const pad = 14;

  const maxS = profile[profile.length - 1].s_m || 1;
  const elevs = profile.map((p) => p.elev_m);
  const minE = Math.min(...elevs);
  const maxE = Math.max(...elevs);
  const spanE = maxE - minE || 1;

  const pts = profile.map((p) => {
    const x = pad + (p.s_m / maxS) * (W - pad * 2);
    const y = H - pad - ((p.elev_m - minE) / spanE) * (H - pad * 2);
    return { x, y, ...p };
  });

  const poly = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${pad},${H - pad} ${poly} ${W - pad},${H - pad}`;

  svg.innerHTML = `
    <polygon points="${area}" fill="rgba(56,189,248,0.18)" />
    <polyline points="${poly}" fill="none" stroke="#ffffff" stroke-width="1.5" />
    <text x="${pad}" y="11" fill="rgba(255,255,255,0.55)" font-size="9" font-family="monospace">${maxE.toFixed(1)} m</text>
    <text x="${pad}" y="${H - 3}" fill="rgba(255,255,255,0.55)" font-size="9" font-family="monospace">${minE.toFixed(1)} m · 0 m → ${maxS.toFixed(0)} m</text>
  `;

  svg.style.cursor = "pointer";
  svg.onclick = (ev) => {
    const rect = svg.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    onSelectDist(frac * maxS);
  };
}
