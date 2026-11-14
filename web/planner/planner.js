/**
 * Visor Tactical Map, Elevation Profile & NASA Science Drawer (`web/planner/planner.js`).
 * Runs MapLibre GL JS directly inside the helmet visor dock, syncs live astronaut position,
 * and binds NASA/PDS science cards with honest empty states ("no NASA value").
 */

import { buildCumulativeDistances, closestAlongM, dispatchSetRoute } from "../shared/route-bridge.js";

function tileToLon(x, z) {
  return (x / Math.pow(2, z)) * 360 - 180;
}

function tileToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

let marsProtocolRegistered = false;
function ensureMarsEqProtocol() {
  if (marsProtocolRegistered || !window.maplibregl?.addProtocol) return;
  marsProtocolRegistered = true;

  window.maplibregl.addProtocol("mars-eq", async (params) => {
    const m = params.url.match(/^mars-eq:\/\/(ctx|themis-day|themis-night)\/(\d+)\/(\d+)\/(\d+)$/);
    if (!m) throw new Error("Invalid mars-eq tile URL");
    const layer = m[1];
    const z = Number(m[2]);
    const x = Number(m[3]);
    const y = Number(m[4]);

    const west = tileToLon(x, z);
    const east = tileToLon(x + 1, z);
    const north = tileToLat(y, z);
    const south = tileToLat(y + 1, z);

    const maxLod = layer === "ctx" ? 13 : 9;
    const eqZ = Math.max(0, Math.min(maxLod, z - 1));
    const nCols = Math.pow(2, eqZ + 1);
    const nRows = Math.pow(2, eqZ);
    const lonSpan = 360 / nCols;
    const latSpan = 180 / nRows;

    const cMin = Math.max(0, Math.floor((west + 180) / lonSpan));
    const cMax = Math.min(nCols - 1, Math.floor((east - 1e-9 + 180) / lonSpan));
    const rMin = Math.max(0, Math.floor((90 - north) / latSpan));
    const rMax = Math.min(nRows - 1, Math.floor((90 - (south + 1e-9)) / latSpan));

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx2d = canvas.getContext("2d");

    const buildSrcUrl = (row, col) => {
      if (layer === "ctx") {
        return `https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/${eqZ}/${row}/${col}`;
      }
      const id =
        layer === "themis-day"
          ? "THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018"
          : "THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018";
      return `https://trek.nasa.gov/tiles/Mars/EQ/${id}/1.0.0//default/default028mm/${eqZ}/${row}/${col}.png`;
    };

    const tasks = [];
    for (let row = rMin; row <= rMax; row++) {
      for (let col = cMin; col <= cMax; col++) {
        tasks.push(
          new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
              const tWest = -180 + col * lonSpan;
              const tNorth = 90 - row * latSpan;
              const dx = ((tWest - west) / (east - west)) * 256;
              const dy = ((north - tNorth) / (north - south)) * 256;
              const dw = (lonSpan / (east - west)) * 256;
              const dh = (latSpan / (north - south)) * 256;
              ctx2d.drawImage(img, dx, dy, dw, dh);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = buildSrcUrl(row, col);
          })
        );
      }
    }
    await Promise.all(tasks);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const buf = await blob.arrayBuffer();
    return { data: buf };
  });
}

function buildRasterStyle(demoSafe) {
  const sources = {};
  const layers = [
    { id: "bg", type: "background", paint: { "background-color": "#14100e" } },
  ];

  if (!demoSafe) {
    ensureMarsEqProtocol();
    sources["trek-ctx"] = {
      type: "raster",
      tiles: ["mars-eq://ctx/{z}/{x}/{y}"],
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
      img.data[p] = 168;
      img.data[p + 1] = 85;
      img.data[p + 2] = 247;
      img.data[p + 3] = 165;
    } else if (c >= 3.25) {
      img.data[p] = 239;
      img.data[p + 1] = 68;
      img.data[p + 2] = 68;
      img.data[p + 3] = 155;
    } else {
      img.data[p + 3] = 0;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

export function initPlanner(data, { onOpenPov }) {
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

  // Disable external layers cleanly in ?demo=1
  const ctxChk = document.getElementById("layer-ctx");
  const orthoChk = document.getElementById("layer-ortho");
  const tdChk = document.getElementById("layer-themis-day");
  const tnChk = document.getElementById("layer-themis-night");
  if (demoSafe) {
    if (ctxChk) { ctxChk.checked = false; ctxChk.disabled = true; }
    if (tdChk) { tdChk.checked = false; tdChk.disabled = true; }
    if (tnChk) { tnChk.checked = false; tnChk.disabled = true; }
    if (orthoChk && !assets.orthoPreviewUrl) { orthoChk.checked = false; orthoChk.disabled = true; }
  }

  let map = null;
  let mapReady = false;
  const startCoord = route?.geometry?.coordinates?.[0] || center;

  if (window.maplibregl) {
    map = new window.maplibregl.Map({
      container: "map",
      style: buildRasterStyle(demoSafe),
      center,
      zoom: 14.0,
      attributionControl: false,
    });
    map.addControl(new window.maplibregl.NavigationControl({ showCompass: false }), "top-left");

    map.on("load", () => {
      mapReady = true;

      if (assets.orthoPreviewUrl) {
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
      }

      map.addSource("slope-preview", {
        type: "image",
        url: assets.slopePreviewUrl,
        coordinates: imgCoords,
      });
      map.addLayer({
        id: "slope-preview-layer",
        type: "raster",
        source: "slope-preview",
        paint: { "raster-opacity": demoSafe ? 0.85 : 0.56 },
      });

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
          paint: { "raster-opacity": 0.78 },
        });
      }

      if (!demoSafe) {
        map.addSource("themis-day", {
          type: "raster",
          tiles: ["mars-eq://themis-day/{z}/{x}/{y}"],
          tileSize: 256,
          maxzoom: 12,
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
          tiles: ["mars-eq://themis-night/{z}/{x}/{y}"],
          tileSize: 256,
          maxzoom: 12,
        });
        map.addLayer({
          id: "themis-night-layer",
          type: "raster",
          source: "themis-night",
          layout: { visibility: "none" },
          paint: { "raster-opacity": 0.6 },
        });
      }

      if (crism?.products?.length) {
        const crismFeatures = crism.products.map((p) => ({
          type: "Feature",
          properties: { pdsid: p.pdsid, comment: p.comment, scale: p.map_scale_m },
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
            "circle-radius": 5,
            "circle-color": "#c084fc",
            "circle-stroke-width": 1.2,
            "circle-stroke-color": "#ffffff",
          },
        });
      }

      if (route) {
        map.addSource("eva-route", { type: "geojson", data: route });
        map.addLayer({
          id: "eva-route-glow",
          type: "line",
          source: "eva-route",
          paint: { "line-color": "#38bdf8", "line-width": 6, "line-opacity": 0.35 },
        });
        map.addLayer({
          id: "eva-route-line",
          type: "line",
          source: "eva-route",
          paint: { "line-color": "#38bdf8", "line-width": 2.6 },
        });
      }

      if (stops) {
        map.addSource("eva-stops", { type: "geojson", data: stops });
        map.addLayer({
          id: "eva-stops-circle",
          type: "circle",
          source: "eva-stops",
          paint: {
            "circle-radius": 6.5,
            "circle-color": [
              "match",
              ["get", "kind"],
              "habitat", "#22c55e",
              "boxwork_bonus", "#f59e0b",
              "#38bdf8",
            ],
            "circle-stroke-width": 1.8,
            "circle-stroke-color": "#05070b",
          },
        });

        map.on("click", "eva-stops-circle", (e) => {
          const f = e.features?.[0];
          if (!f) return;
          new window.maplibregl.Popup()
            .setLngLat(f.geometry.coordinates)
            .setHTML(
              `<div style="color:#0b0e14;font-size:11px;"><strong>${f.properties.name}</strong><br/><em>${f.properties.kind}</em></div>`
            )
            .addTo(map);
        });
      }

      // Live astronaut marker on the visor map
      map.addSource("astronaut-pos", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "Point", coordinates: startCoord },
        },
      });
      map.addLayer({
        id: "astronaut-halo",
        type: "circle",
        source: "astronaut-pos",
        paint: {
          "circle-radius": 11,
          "circle-color": "#38bdf8",
          "circle-opacity": 0.28,
        },
      });
      map.addLayer({
        id: "astronaut-dot",
        type: "circle",
        source: "astronaut-pos",
        paint: {
          "circle-radius": 5,
          "circle-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0284c7",
        },
      });
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

  // Visor Dock Expand / Collapse buttons
  const mapDock = document.getElementById("visor-map-dock");
  const btnMapExpand = document.getElementById("btn-map-expand");
  const btnMapCollapse = document.getElementById("btn-map-collapse");
  btnMapExpand?.addEventListener("click", () => {
    const expanded = mapDock.classList.toggle("expanded");
    btnMapExpand.textContent = expanded ? "Compact" : "Expand";
    setTimeout(() => map?.resize(), 210);
  });
  btnMapCollapse?.addEventListener("click", () => {
    const collapsed = mapDock.classList.toggle("collapsed");
    btnMapCollapse.textContent = collapsed ? "Show" : "Hide";
    if (!collapsed) setTimeout(() => map?.resize(), 50);
  });

  const sciDock = document.getElementById("visor-science-dock");
  const btnSciCollapse = document.getElementById("btn-science-collapse");
  btnSciCollapse?.addEventListener("click", () => {
    const collapsed = sciDock.classList.toggle("collapsed");
    btnSciCollapse.textContent = collapsed ? "Show" : "Hide";
  });

  // Elevation Profile SVG + click to jump via mm:set-route
  const profileController = renderProfileSvg(route?.profile || [], (sM) => {
    if (route) dispatchSetRoute(route, sM);
  });

  // Route totals summary
  const totals = route?.totals || route?.properties || {};
  const routeTotalsEl = document.getElementById("hud-route-totals");
  if (routeTotalsEl) {
    if (totals.distance_m != null) {
      routeTotalsEl.textContent = `Route: ${Number(totals.distance_m).toFixed(1)} m · +${totals.climb_m ?? "—"}/-${totals.descent_m ?? "—"} m · ~${totals.duration_min_placeholder ?? "—"} min (Earth hiking placeholder)`;
    } else {
      routeTotalsEl.textContent = "Route: no NASA value";
    }
  }

  // Stops list with Jump & POV
  const stopsList = document.getElementById("stops-list");
  const routeCoords = route?.geometry?.coordinates || [];
  const cumDist = buildCumulativeDistances(routeCoords);

  if (stopsList) {
    if (stops?.features?.length) {
      stopsList.innerHTML = `<div class="hud-kicker" style="margin-bottom:4px;">SCIENCE STOPS (${stops.features.length})</div>`;
      stops.features.forEach((f) => {
        const p = f.properties;
        const povEntry = povIndex?.stops?.find((s) => s.stop_id === p.id);
        const stopAlong = closestAlongM(routeCoords, cumDist, f.geometry.coordinates);
        const div = document.createElement("div");
        div.className = "stop-item";
        div.innerHTML = `
          <div class="stop-header">
            <span class="stop-name">${p.name}</span>
            <span class="stop-kind">${p.kind}</span>
          </div>
          <div class="hud-sub">${p.science_summary || "no NASA value"}</div>
          <div style="display:flex;gap:6px;margin-top:6px;">
            <button class="btn mini" data-jump>Jump Here</button>
            <button class="btn mini" data-zoom>Map Zoom</button>
            <button class="btn mini" data-pov>${povEntry ? "Curiosity POV" : "POV (none)"}</button>
          </div>
        `;
        div.querySelector("[data-jump]")?.addEventListener("click", () => {
          if (route) dispatchSetRoute(route, stopAlong);
        });
        div.querySelector("[data-zoom]")?.addEventListener("click", () => {
          if (map) map.flyTo({ center: f.geometry.coordinates, zoom: 15.8 });
        });
        div.querySelector("[data-pov]")?.addEventListener("click", () => {
          onOpenPov(povEntry || { stop_id: p.id, stop_name: p.name, missing: true, missing_label: "no NASA value — POV index entry missing" });
        });
        stopsList.appendChild(div);
      });
    } else {
      stopsList.innerHTML = `<div class="science-card empty-state">Stops: no NASA value (stops.json missing)</div>`;
    }
  }

  // DONKI Banner (exact sentence if skipped; never invent a forecast)
  const donkiEl = document.getElementById("donki-banner");
  if (donkiEl) {
    if (!alerts) {
      donkiEl.innerHTML = `<span class="empty-state">DONKI Space Weather: no NASA value (alerts.json missing)</span>`;
    } else if ((alerts.status || "").includes("skipped") || (alerts.note || "").toLowerCase().includes("skipped")) {
      donkiEl.innerHTML = `<strong>DONKI (${alerts.status}):</strong> ${alerts.note || "Live DONKI was skipped."}`;
    } else if (alerts.alerts?.length) {
      const firstAlert = alerts.alerts[0];
      donkiEl.innerHTML = `<strong>DONKI (${alerts.status}):</strong> ${alerts.alerts.length} Mars WSA-Enlil run(s). Latest: ${firstAlert.predicted_arrival} (${firstAlert.is_glancing_blow ? "glancing blow" : "direct"}). <span class="hud-sub">(${alerts.queried_at || "cached"})</span>`;
    } else {
      donkiEl.innerHTML = `<strong>DONKI (${alerts.status || "cached"}):</strong> 0 Mars WSA-Enlil alerts in window (${alerts.queried_at || "—"}).`;
    }
  }

  // RAD Dose Card (honest empty state if missing)
  const doseEl = document.getElementById("dose-box");
  if (doseEl) {
    if (!dose || dose.dose_estimate_mSv == null) {
      doseEl.innerHTML = `<span class="empty-state">RAD Dose: no NASA value (dose.json missing)</span>`;
    } else {
      doseEl.innerHTML = `<strong>RAD Dose (${dose.status || "—"}):</strong> ${dose.dose_estimate_mSv} ± ${dose.dose_uncertainty_mSv} mSv (${dose.baseline_rate_mSv_per_day} mSv/day Hassler 2014 × ${dose.eva_duration_min_placeholder} min placeholder). Time &amp; shielding problem — no spatial rock map.`;
    }
  }

  // REMS Weather (honest empty state if missing)
  const weatherEl = document.getElementById("weather-box");
  if (weatherEl) {
    if (!weather?.latest_sol) {
      weatherEl.innerHTML = `<span class="empty-state">REMS Weather: no NASA value (weather.json missing)</span>`;
    } else {
      const s = weather.latest_sol;
      weatherEl.innerHTML = `<strong>REMS Sol ${s.sol} (${s.terrestrial_date}):</strong> Air ${s.air_min_C}°C..${s.air_max_C}°C · Ground ${s.ground_min_C}°C..${s.ground_max_C}°C · ${s.pressure_Pa} Pa · ${s.atmo_opacity} · Sunrise ${s.sunrise} / Sunset ${s.sunset} LTST.`;
    }
  }

  function updateAstronautPosition(lon, lat, alongM) {
    if (mapReady && map) {
      const src = map.getSource("astronaut-pos");
      if (src) {
        src.setData({
          type: "Feature",
          geometry: { type: "Point", coordinates: [lon, lat] },
        });
      }
    }
    if (profileController) {
      profileController.updateMarker(alongM);
    }
  }

  return { map, updateAstronautPosition };
}

function renderProfileSvg(profile, onSelectDist) {
  const svg = document.getElementById("profile-svg");
  if (!svg) return null;
  if (!profile || profile.length < 2) {
    svg.innerHTML = `<text x="10" y="40" fill="#fca5a5" font-size="10" font-family="monospace">Profile: no NASA value</text>`;
    return null;
  }

  const W = 300;
  const H = 74;
  const pad = 10;

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
    <polyline points="${poly}" fill="none" stroke="#38bdf8" stroke-width="2" />
    <line id="profile-cursor" x1="${pad}" y1="${pad}" x2="${pad}" y2="${H - pad}" stroke="#ffffff" stroke-width="1.2" stroke-dasharray="2,2" />
    <text x="${pad}" y="10" fill="#93a7c3" font-size="8" font-family="monospace">${maxE.toFixed(1)} m</text>
    <text x="${pad}" y="${H - 2}" fill="#93a7c3" font-size="8" font-family="monospace">${minE.toFixed(1)} m · 0→${maxS.toFixed(0)} m (click to jump)</text>
  `;

  svg.style.cursor = "pointer";
  svg.onclick = (ev) => {
    const rect = svg.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    onSelectDist(frac * maxS);
  };

  return {
    updateMarker(sM) {
      const line = svg.querySelector("#profile-cursor");
      if (!line) return;
      const frac = Math.max(0, Math.min(1, (sM || 0) / maxS));
      const x = pad + frac * (W - pad * 2);
      line.setAttribute("x1", x.toFixed(1));
      line.setAttribute("x2", x.toFixed(1));
    },
  };
}
