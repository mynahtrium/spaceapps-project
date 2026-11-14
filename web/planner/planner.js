/**
 * 2D MapLibre GL JS Planner (`web/planner/planner.js`).
 * Displays Mars Trek CTX/THEMIS (skipped in ?demo=1), HiRISE ortho & slope previews,
 * 15°/20° hazard toggle, CRISM footprints, stops, route, elevation profile, and science cards.
 */

import { shouldUseHighResMap } from "../map/IMapAdapter.js";
import { LegacyMapAdapter } from "../map/LegacyMapAdapter.js";
import { MapLibreMarsAdapter } from "../map/MapLibreMarsAdapter.js";
import {
  MARS_HISTORIC_ROVERS,
  buildHistoricRoversGeoJson,
  formatMarsLonLat,
  getHistoricRoverById,
} from "../shared/mars-rovers.js";
import {
  dispatchOpenRoverInfo,
  dispatchSetRoute,
  dispatchTeleport,
  dispatchVisitRoverSite,
} from "../shared/route-bridge.js";

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

export function initPlanner(data, { onOpenPov, onStartEva, onOpenRoverInfo, onVisitRoverSite, demSampler, registry, mp }) {
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
  const fitBtn = document.getElementById("map-fit-btn");
  const toggle3d = document.getElementById("toggle-3d-map");
  let selectedTarget = null;
  let activePopup = null;
  let lastProbePoint = {
    lon: route?.geometry?.coordinates?.[0]?.[0] ?? center[0],
    lat: route?.geometry?.coordinates?.[0]?.[1] ?? center[1],
    elevM: null,
  };
  let crewFc = { type: "FeatureCollection", features: [] };
  let pinsFc = { type: "FeatureCollection", features: [] };

  const buildCrewFc = (selfPose = null) => {
    const features = [];
    if (mp) {
      for (const peer of mp.peers.values()) {
        const st = peer.state;
        if (st && Number.isFinite(st.lon) && Number.isFinite(st.lat)) {
          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [st.lon, st.lat] },
            properties: { id: peer.id, callsign: peer.callsign, color: peer.color || "#38bdf8" },
          });
        }
      }
    }
    if (selfPose && Number.isFinite(selfPose.lon) && Number.isFinite(selfPose.lat)) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [selfPose.lon, selfPose.lat] },
        properties: { id: "SELF", callsign: mp?.callsign || "YOU", color: "#ffffff" },
      });
    }
    return { type: "FeatureCollection", features };
  };

  const buildPinsFc = (pins = []) => ({
    type: "FeatureCollection",
    features: pins.map((pin) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [pin.lon, pin.lat] },
      properties: {
        id: pin.id,
        label: pin.label || "Science Beacon",
        by: pin.by || "CREW",
        color: pin.color || "#fbbf24",
      },
    })),
  });

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
      zoom: 14.7,
      minZoom: 1.1,
      maxZoom: 18,
      pitch: terrain3dDefault ? 50 : 0,
      bearing: terrain3dDefault ? -14 : 0,
      terrain3d: terrain3dDefault,
    });

    if (fitBtn) {
      fitBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        adapter.flyTo?.({
          center,
          zoom: 14.7,
          pitch: toggle3d?.checked ? 50 : 0,
          bearing: toggle3d?.checked ? -14 : 0,
        });
      });
    }

    // Subtle study corridor perimeter so the 2 km HiRISE DTM tile reads clearly against Gale Crater context
    adapter.addGeoJsonLayer(
      "hirise-footprint",
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { name: "HiRISE DTEEC_019698 Study Corridor" },
            geometry: {
              type: "LineString",
              coordinates: [...imgCoords, imgCoords[0]],
            },
          },
        ],
      },
      { type: "line", color: "rgba(245, 158, 11, 0.55)", width: 1.5, dasharray: [4, 3], visible: true }
    );

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
      } else if (typeof adapter.loadRasterOverlay === "function") {
        // ?legacyMap=1: the adapter itself is a Fallback2DMap
        adapter.loadRasterOverlay("strict-15", strictUrl, false);
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
        {
          type: "circle",
          radius: 4.5,
          radiusExpr: ["interpolate", ["linear"], ["zoom"], 11, 3, 14, 4.5, 16, 6],
          color: "#c084fc",
          strokeWidth: 1.2,
          strokeColor: "#ffffff",
          visible: true,
        }
      );
    }

    if (route) {
      adapter.addGeoJsonLayer(
        "eva-route",
        { type: "FeatureCollection", features: [route] },
        { type: "line", color: "#67e8f9", width: 2.8, visible: true }
      );
    }

    if (stops) {
      adapter.addGeoJsonLayer("eva-stops", stops, {
        type: "circle",
        radius: 6.5,
        radiusExpr: ["interpolate", ["linear"], ["zoom"], 11, 3.5, 13.5, 5.5, 16, 8.5],
        color: "#a5f3fc",
        strokeWidth: 1.8,
        strokeColor: "#000000",
        visible: true,
      });
    }

    adapter.addGeoJsonLayer("historic-rovers", buildHistoricRoversGeoJson(), {
      type: "circle",
      radius: 8,
      radiusExpr: ["interpolate", ["linear"], ["zoom"], 1, 6.5, 5, 7.5, 15, 10],
      colorExpr: ["coalesce", ["get", "color"], "#4ade80"],
      strokeWidth: 2.2,
      strokeColor: "#000000",
      visible: true,
    });

    pinsFc = buildPinsFc(mp?.pins || []);
    adapter.addGeoJsonLayer("eva-pings", pinsFc, {
      type: "circle",
      radius: 7,
      colorExpr: ["coalesce", ["get", "color"], "#fbbf24"],
      strokeWidth: 2,
      strokeColor: "#000000",
      visible: true,
    });

    crewFc = buildCrewFc();
    adapter.addGeoJsonLayer("eva-crew", crewFc, {
      type: "circle",
      radius: 7,
      colorExpr: ["coalesce", ["get", "color"], "#38bdf8"],
      strokeWidth: 2,
      strokeColor: "#ffffff",
      visible: true,
    });

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
      // First check if the user clicked one of the 5 NASA Mars rover pins (works at any zoom level!)
      let clickedRover = null;
      if (typeof evt.x === "number" && typeof evt.y === "number" && typeof adapter.project === "function") {
        let bestPx = 22;
        for (const r of MARS_HISTORIC_ROVERS) {
          const proj = adapter.project([r.lon, r.lat]);
          if (!proj) continue;
          const dPx = Math.hypot(proj[0] - evt.x, proj[1] - evt.y);
          if (dPx < bestPx) {
            bestPx = dPx;
            clickedRover = r;
          }
        }
      }
      if (clickedRover) {
        if (probeTextEl) {
          probeTextEl.textContent = `${clickedRover.name.toUpperCase()} (${clickedRover.mission}) · ${formatMarsLonLat(clickedRover.lon, clickedRover.lat)}`;
        }
        if (onOpenRoverInfo) onOpenRoverInfo(clickedRover);
        else dispatchOpenRoverInfo(clickedRover.id);
        return;
      }

      lastProbePoint = { lon: evt.lon, lat: evt.lat, elevM: evt.elevM ?? null };
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
            `<div style="color:var(--cyan-bright,#a5f3fc);font-size:12px;"><strong>${nearest.properties.name}</strong><br/><em>${nearest.properties.kind}</em></div>`
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
      onStartEva?.();
    }
  });

  // NASA Historic Mars Rovers list (all 5 real sites)
  const fleetListEl = document.getElementById("fleet-list");
  if (fleetListEl) {
    fleetListEl.innerHTML = "";
    for (const r of MARS_HISTORIC_ROVERS) {
      const card = document.createElement("div");
      card.className = "fleet-item";
      const isAct = r.status === "ACTIVE";
      card.innerHTML = `
        <div class="fleet-head">
          <div class="fleet-name-wrap">
            <span class="fleet-dot" style="background:${r.color};"></span>
            <strong>${r.name}</strong>
          </div>
          <span class="fleet-status ${isAct ? "active" : ""}">${r.status}</span>
        </div>
        <div class="fleet-meta">
          ${r.siteShortName} · ${formatMarsLonLat(r.lon, r.lat)}<br/>
          ${r.landingDate} · ${r.distanceLabel}
        </div>
        <div class="fleet-actions">
          <button class="btn" type="button" data-rover-fly>Zoom</button>
          <button class="btn" type="button" data-rover-info>Info</button>
          <button class="btn primary" type="button" data-rover-3d>Visit 3D</button>
        </div>
      `;
      card.querySelector("[data-rover-fly]")?.addEventListener("click", () => {
        adapter.flyTo?.({
          center: [r.lon, r.lat],
          zoom: r.isHiRiseGaleSite ? 15.2 : 5.5,
          pitch: toggle3d?.checked ? 45 : 0,
        });
      });
      card.querySelector("[data-rover-info]")?.addEventListener("click", () => {
        if (onOpenRoverInfo) onOpenRoverInfo(r);
        else dispatchOpenRoverInfo(r.id);
      });
      card.querySelector("[data-rover-3d]")?.addEventListener("click", () => {
        if (onVisitRoverSite) onVisitRoverSite(r.id);
        else dispatchVisitRoverSite(r.id);
        onStartEva?.();
      });
      fleetListEl.appendChild(card);
    }
  }

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

  return {
    map: adapter,
    adapter,
    ready,
    getLastProbePoint: () => ({ ...lastProbePoint }),
    /** Mars lon/lat under a viewport point, or null when off the map. */
    lonLatAt: (clientX, clientY) => {
      if (!container) return null;
      const r = container.getBoundingClientRect();
      if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
      const ll = adapter.unproject?.([clientX - r.left, clientY - r.top]);
      return ll && Number.isFinite(ll[0]) && Number.isFinite(ll[1]) ? { lon: ll[0], lat: ll[1] } : null;
    },
    teleportTo: (lon, lat) => triggerTeleport(lon, lat),
    fitEva: () => fitBtn?.click(),
    flyToRover: (roverId) => {
      const r = getHistoricRoverById(roverId);
      if (!r) return;
      adapter.flyTo?.({
        center: [r.lon, r.lat],
        zoom: r.isHiRiseGaleSite ? 15.2 : 5.5,
        pitch: toggle3d?.checked ? 45 : 0,
      });
    },
    updateCrewOverlay: (selfPose) => {
      crewFc = buildCrewFc(selfPose);
      adapter.updateGeoJsonLayer("eva-crew", crewFc);
    },
    updatePinsOverlay: (pins) => {
      pinsFc = buildPinsFc(pins);
      adapter.updateGeoJsonLayer("eva-pings", pinsFc);
    },
  };
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
    <polygon points="${area}" fill="rgba(34,211,238,0.18)" />
    <polyline points="${poly}" fill="none" stroke="#67e8f9" stroke-width="1.5" />
    <text x="${pad}" y="11" fill="rgba(103,232,249,0.72)" font-size="9" font-family="monospace">${maxE.toFixed(1)} m</text>
    <text x="${pad}" y="${H - 3}" fill="rgba(103,232,249,0.72)" font-size="9" font-family="monospace">${minE.toFixed(1)} m · 0 m → ${maxS.toFixed(0)} m</text>
  `;

  svg.style.cursor = "pointer";
  svg.onclick = (ev) => {
    const rect = svg.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    onSelectDist(frac * maxS);
  };
}
