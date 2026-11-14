/**
 * 2D MapLibre GL JS Planner (`web/planner/planner.js`).
 * Displays Mars Trek CTX/THEMIS (skipped in ?demo=1), HiRISE ortho & slope previews,
 * 15°/20° hazard toggle, CRISM footprints, stops, route, elevation profile, and science cards.
 */

import { dispatchSetRoute } from "../shared/route-bridge.js";

function buildRasterStyle(demoSafe) {
  const sources = {};
  const layers = [
    { id: "bg", type: "background", paint: { "background-color": "#000000" } },
  ];

  if (!demoSafe) {
    sources["trek-ctx"] = {
      type: "raster",
      tiles: [
        "https://trek.nasa.gov/tiles/Mars/EQ/CTX_beta01_uncontrolled_5m_Caltech/1.0.0//default/default028mm/{z}/{y}/{x}.jpg",
      ],
      tileSize: 256,
      maxzoom: 16,
    };
    layers.push({
      id: "trek-ctx-layer",
      type: "raster",
      source: "trek-ctx",
      paint: { "raster-opacity": 0.85 },
    });
  }

  return { version: 8, sources, layers };
}

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

export function initPlanner(data, { onOpenPov, onStartEva }) {
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

  let map = null;
  if (window.maplibregl) {
    map = new window.maplibregl.Map({
      container: "map",
      style: buildRasterStyle(demoSafe),
      center,
      zoom: 14.3,
      attributionControl: false,
    });
    map.addControl(new window.maplibregl.NavigationControl(), "top-left");

    map.on("load", () => {
      // Local HiRISE Ortho
      map.addSource("hirise-ortho", {
        type: "image",
        url: assets.orthoPreviewUrl,
        coordinates: imgCoords,
      });
      map.addLayer({
        id: "hirise-ortho-layer",
        type: "raster",
        source: "hirise-ortho",
        paint: { "raster-opacity": 0.9 },
      });

      // Local Slope Preview
      map.addSource("slope-preview", {
        type: "image",
        url: assets.slopePreviewUrl,
        coordinates: imgCoords,
      });
      map.addLayer({
        id: "slope-preview-layer",
        type: "raster",
        source: "slope-preview",
        paint: { "raster-opacity": 0.58 },
      });

      // Strict 15° overlay (hidden until toggled)
      if (costMap?.cost_row_major) {
        map.addSource("strict-15", {
          type: "image",
          url: buildStrict15Canvas(costMap),
          coordinates: imgCoords,
        });
        map.addLayer({
          id: "strict-15-layer",
          type: "raster",
          source: "strict-15",
          layout: { visibility: "none" },
          paint: { "raster-opacity": 0.75 },
        });
      }

      // THEMIS Day / Night IR
      if (!demoSafe) {
        map.addSource("themis-day", {
          type: "raster",
          tiles: [
            "https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0//default/default028mm/{z}/{y}/{x}.png",
          ],
          tileSize: 256,
          maxzoom: 9,
        });
        map.addLayer({
          id: "themis-day-layer",
          type: "raster",
          source: "themis-day",
          layout: { visibility: "none" },
          paint: { "raster-opacity": 0.6 },
        });

        map.addSource("themis-night", {
          type: "raster",
          tiles: [
            "https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0//default/default028mm/{z}/{y}/{x}.png",
          ],
          tileSize: 256,
          maxzoom: 9,
        });
        map.addLayer({
          id: "themis-night-layer",
          type: "raster",
          source: "themis-night",
          layout: { visibility: "none" },
          paint: { "raster-opacity": 0.6 },
        });
      }

      // CRISM footprints
      if (crism?.products?.length) {
        const crismFeatures = crism.products.map((p) => ({
          type: "Feature",
          properties: {
            pdsid: p.pdsid,
            comment: p.comment,
            scale: p.map_scale_m,
          },
          geometry: {
            type: "Point",
            coordinates: [parseFloat(p.center_lon), parseFloat(p.center_lat)],
          },
        }));
        map.addSource("crism-pts", {
          type: "geojson",
          data: { type: "FeatureCollection", features: crismFeatures },
        });
        map.addLayer({
          id: "crism-layer",
          type: "circle",
          source: "crism-pts",
          paint: {
            "circle-radius": 6,
            "circle-color": "#c084fc",
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#ffffff",
          },
        });
      }

      // Route GeoJSON
      if (route) {
        map.addSource("eva-route", { type: "geojson", data: route });
        map.addLayer({
          id: "eva-route-glow",
          type: "line",
          source: "eva-route",
          paint: { "line-color": "#ffffff", "line-width": 6, "line-opacity": 0.18 },
        });
        map.addLayer({
          id: "eva-route-line",
          type: "line",
          source: "eva-route",
          paint: { "line-color": "#ffffff", "line-width": 2 },
        });
      }

      // Science Stops
      if (stops) {
        map.addSource("eva-stops", { type: "geojson", data: stops });
        map.addLayer({
          id: "eva-stops-circle",
          type: "circle",
          source: "eva-stops",
          paint: {
            "circle-radius": 8,
            "circle-color": [
              "match",
              ["get", "kind"],
              "habitat", "#ffffff",
              "boxwork_bonus", "#d4d4d4",
              "#ffffff",
            ],
            "circle-stroke-width": 2,
            "circle-stroke-color": "#000000",
          },
        });

        map.on("click", "eva-stops-circle", (e) => {
          const f = e.features?.[0];
          if (!f) return;
          new window.maplibregl.Popup()
            .setLngLat(f.geometry.coordinates)
            .setHTML(
              `<div style="color:#0b0e14;font-size:12px;"><strong>${f.properties.name}</strong><br/><em>${f.properties.kind}</em></div>`
            )
            .addTo(map);
        });
      }
    });
  }

  // Layer checkboxes
  const bindToggle = (id, layerId) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
      if (map && map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", el.checked ? "visible" : "none");
      }
    });
  };
  bindToggle("layer-ortho", "hirise-ortho-layer");
  bindToggle("layer-slope", "slope-preview-layer");
  bindToggle("layer-themis-day", "themis-day-layer");
  bindToggle("layer-themis-night", "themis-night-layer");
  bindToggle("layer-crism", "crism-layer");
  bindToggle("layer-ctx", "trek-ctx-layer");

  // Strict 15° toggle
  const strictToggle = document.getElementById("toggle-strict-15");
  const legendLimit = document.getElementById("legend-limit");
  if (strictToggle) {
    strictToggle.addEventListener("change", () => {
      const strict = strictToggle.checked;
      if (legendLimit) legendLimit.textContent = strict ? "15" : "20";
      if (map && map.getLayer("strict-15-layer")) {
        map.setLayoutProperty("strict-15-layer", "visibility", strict ? "visible" : "none");
      }
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
        if (map) map.flyTo({ center: f.geometry.coordinates, zoom: 16 });
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

  return { map };
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
