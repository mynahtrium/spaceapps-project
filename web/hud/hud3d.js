/**
 * First-Person Mars Astronaut Helmet HUD & 3D Terrain Controller (`hud3d.js`).
 *
 * Driven by `HighResMarsTerrainEngine` (CDLOD Quadtree, off-main-thread TerrainWorkerPool,
 * 1-px border analytical normal maps, Martian PBR strata/regolith shader, sky dome,
 * terrain-draped AR route/beacons, ground-clamped WASD movement, and screen-to-terrain raycast).
 */

import { HighResMarsTerrainEngine } from "../map/HighResMarsTerrainEngine.js";
import {
  buildCumulativeDistances,
  classifySlope,
  marsBearingDeg,
  marsDistanceM,
  onSetRoute,
  sampleAlongRoute,
} from "../shared/route-bridge.js";

function cardinalFromDeg(deg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export async function initHud3D(data, opts = {}) {
  const { demSampler, onOpenPov, onPositionChange, onAttributionsChange } = opts;

  const canvasWrap = document.getElementById("hud-canvas-wrap");
  const distEl = document.getElementById("hud-dist");
  const distSubEl = document.getElementById("hud-dist-sub");
  const slopeEl = document.getElementById("hud-slope");
  const slopeBadgeEl = document.getElementById("hud-slope-badge");
  const nextStopEl = document.getElementById("hud-next-stop");
  const nextKindEl = document.getElementById("hud-next-kind");
  const o2El = document.getElementById("hud-o2");
  const o2FillEl = document.getElementById("hud-o2-fill");
  const compassEl = document.getElementById("hud-compass");
  const probeEl = document.getElementById("hud-probe");
  const shouldLineEl = document.getElementById("hud-should-line");

  const playBtn = document.getElementById("hud-play");
  const scrubber = document.getElementById("hud-scrubber");
  const speedBtn = document.getElementById("hud-speed");
  const texBtn = document.getElementById("hud-tex");
  const exagBtn = document.getElementById("hud-exag");
  const freeRoamBtn = document.getElementById("hud-freeroam");
  const arToggleBtn = document.getElementById("hud-ar-toggle");
  const resetLookBtn = document.getElementById("hud-reset-look");
  const povBtn = document.getElementById("hud-pov-btn");

  let THREE = null;
  try {
    THREE = await import("three");
  } catch (err) {
    if (canvasWrap) {
      canvasWrap.innerHTML = `<div class="hud-error-box">3D terrain module unavailable: ${err.message}</div>`;
    }
    return { onResize: () => {}, setStrictSlopeLimit: () => {}, getEngine: () => null };
  }

  let route = data.route;
  let routeCoords = route?.geometry?.coordinates || [[137.39, -4.8]];
  let cumDist = buildCumulativeDistances(routeCoords);
  let totalDistM = cumDist[cumDist.length - 1] || route?.properties?.distance_m || 790;
  let profile = route?.profile || [];
  const stops = data.stops?.features || [];

  const engine = new HighResMarsTerrainEngine({
    THREE,
    demSampler,
    demoSafe: data.demoSafe,
    orthoPreviewUrl: data.assets?.orthoPreviewUrl,
    slopePreviewUrl: data.assets?.slopePreviewUrl,
  });

  const startPose = sampleAlongRoute(routeCoords, cumDist, 0);
  await engine.mount(canvasWrap, {
    center: [startPose.lon, startPose.lat],
    bearing: startPose.bearingDeg,
  });

  if (route) {
    engine.addGeoJsonLayer(
      "eva-route",
      { type: "FeatureCollection", features: [route] },
      { color: 0x38bdf8, visible: true }
    );
  }
  if (data.stops) {
    engine.addGeoJsonLayer("eva-stops", data.stops, { visible: true });
  }

  if (onAttributionsChange) {
    onAttributionsChange(engine.getActiveAttributions());
  }

  // Terrain raycast live readout
  const updateProbeText = (evt, prefix = "Probe") => {
    if (!probeEl || !evt) return;
    const elev = evt.elevM != null ? `${evt.elevM.toFixed(1)} m MOLA` : "no NASA value";
    const slope = evt.slopeDeg != null ? `${evt.slopeDeg.toFixed(1)}°` : "--";
    probeEl.textContent = `${prefix}: ${evt.lat.toFixed(5)}°, ${evt.lon.toFixed(5)}° · ${elev} · slope ${slope}`;
  };
  engine.on("hover", (evt) => updateProbeText(evt, "Hover"));
  engine.on("click", (evt) => updateProbeText(evt, "Clicked"));

  // Simulation / Playback state
  let playing = false;
  let freeRoam = false;
  let alongM = 0;
  let speedMult = 1;
  const speeds = [1, 2, 4];
  let strictLimitDeg = 20;
  let shaderModeIdx = 0;
  const shaderModes = [
    { id: "mars-pbr", label: "Surface: Mars PBR" },
    { id: "slope-hazard", label: "Surface: Slope Stand-in" },
    { id: "elevation-strata", label: "Surface: Strata Elev" },
  ];
  let exagIdx = 0;
  const exagModes = [
    { val: 1.0, label: "Relief: 1.0× True" },
    { val: 1.8, label: "Relief: 1.8×" },
  ];
  let arEnabled = true;

  const findNearestStop = (lon, lat) => {
    if (!stops.length) return null;
    // Prefer upcoming stop along route if walking, else nearest stop overall
    let best = null;
    let bestDist = Infinity;
    for (const s of stops) {
      const c = s.geometry?.coordinates;
      if (!c) continue;
      const d = marsDistanceM([lon, lat], c);
      if (d < bestDist) {
        bestDist = d;
        best = { feature: s, distM: d, bearingDeg: marsBearingDeg([lon, lat], c) };
      }
    }
    return best;
  };

  const interpolateProfileSlope = (sM) => {
    if (!profile.length) return null;
    for (let i = 1; i < profile.length; i++) {
      if (profile[i].s_m >= sM) return profile[i].slope_deg;
    }
    return profile[profile.length - 1]?.slope_deg ?? null;
  };

  const updateReadouts = (lon, lat, bearingDeg) => {
    const walkedM = Math.max(0, Math.min(totalDistM, alongM));
    const frac = totalDistM > 0 ? walkedM / totalDistM : 0;

    if (distEl) distEl.textContent = `${walkedM.toFixed(0)} m`;
    if (distSubEl) {
      distSubEl.textContent = `of ${totalDistM.toFixed(0)} m · rem ${(totalDistM - walkedM).toFixed(0)} m`;
    }
    if (scrubber) scrubber.value = String(Math.round(frac * 1000));

    const terrainInfo = demSampler.sampleSlopeAndNormal([lon, lat]);
    const slopeDeg = terrainInfo?.slopeDeg ?? interpolateProfileSlope(walkedM);
    const elevM = terrainInfo?.elevM ?? null;
    const slopeClass = classifySlope(slopeDeg, strictLimitDeg);

    if (slopeEl) slopeEl.textContent = slopeDeg != null ? `${slopeDeg.toFixed(1)}°` : "no NASA value";
    if (slopeBadgeEl) {
      slopeBadgeEl.textContent = `${slopeClass.label}${elevM != null ? ` · ${elevM.toFixed(0)} m` : ""}`;
      slopeBadgeEl.style.borderColor = slopeClass.color;
      slopeBadgeEl.style.color = slopeClass.color;
    }

    const nearest = findNearestStop(lon, lat);
    if (nearest && nextStopEl) {
      const p = nearest.feature.properties || {};
      nextStopEl.textContent = `${p.name || p.id} (${nearest.distM.toFixed(0)} m ${cardinalFromDeg(nearest.bearingDeg)})`;
      if (nextKindEl) {
        nextKindEl.textContent =
          p.kind === "bonus"
            ? "Bonus outcrop (Altadena boxwork)"
            : "Primary target (Lake / Mudstones)";
      }
    } else if (nextStopEl) {
      nextStopEl.textContent = "no NASA value";
    }

    // Illustrative suit O₂ linear depletion placeholder (explicitly labeled)
    const o2Pct = Math.max(12, Math.round(100 - frac * 22));
    if (o2El) o2El.textContent = `${o2Pct}% (placeholder)`;
    if (o2FillEl) o2FillEl.style.width = `${o2Pct}%`;

    const view = engine.getView();
    const headDeg = Math.round(view.bearing ?? bearingDeg ?? 0);
    if (compassEl) {
      compassEl.textContent = `${String(headDeg).padStart(3, "0")}° ${cardinalFromDeg(headDeg)}`;
    }

    if (shouldLineEl) {
      const evaDose = data.dose?.dose_estimate_mSv ?? data.dose?.total_eva_dose_msv;
      const doseTxt =
        evaDose != null
          ? `RAD ~${Number(evaDose).toFixed(3)} mSv`
          : "RAD: no NASA value";
      const wxCount = Array.isArray(data.alerts?.alerts) ? data.alerts.alerts.length : null;
      const alertStatus =
        wxCount != null
          ? `${wxCount} Mars WSA-Enlil runs`
          : data.alerts?.status || "no NASA value";
      shouldLineEl.textContent = `${doseTxt} · DONKI: ${alertStatus} · DEM 5m tilt r≈0.15`;
    }

    if (onPositionChange) {
      onPositionChange({ lon, lat, alongM: walkedM, bearingDeg: headDeg, elevM, slopeDeg });
    }
  };

  engine.on("viewchange", (view) => {
    if (compassEl && typeof view.bearing === "number") {
      const h = Math.round(view.bearing);
      compassEl.textContent = `${String(h).padStart(3, "0")}° ${cardinalFromDeg(h)}`;
    }
  });

  const applyAlongM = (sM, alignLook = true) => {
    alongM = Math.max(0, Math.min(totalDistM, sM));
    const pose = sampleAlongRoute(routeCoords, cumDist, alongM);
    engine.setAstronautPose({
      lon: pose.lon,
      lat: pose.lat,
      headingDeg: alignLook ? pose.bearingDeg : null,
    });
    updateReadouts(pose.lon, pose.lat, pose.bearingDeg);
  };

  // Controls wiring
  if (playBtn) {
    playBtn.addEventListener("click", () => {
      playing = !playing;
      if (playing && freeRoam) {
        freeRoam = false;
        if (freeRoamBtn) freeRoamBtn.textContent = "Walk: Free (WASD)";
      }
      playBtn.textContent = playing ? "⏸ Pause EVA" : "▶ Walk Route";
    });
  }

  if (scrubber) {
    scrubber.addEventListener("input", () => {
      playing = false;
      if (playBtn) playBtn.textContent = "▶ Walk Route";
      const frac = Number(scrubber.value) / 1000;
      applyAlongM(frac * totalDistM, true);
    });
  }

  if (speedBtn) {
    speedBtn.addEventListener("click", () => {
      const idx = (speeds.indexOf(speedMult) + 1) % speeds.length;
      speedMult = speeds[idx];
      speedBtn.textContent = `Speed ${speedMult}×`;
    });
  }

  if (texBtn) {
    texBtn.addEventListener("click", () => {
      shaderModeIdx = (shaderModeIdx + 1) % shaderModes.length;
      const mode = shaderModes[shaderModeIdx];
      engine.setImageryProvider(mode.id);
      texBtn.textContent = mode.label;
    });
  }

  if (exagBtn) {
    exagBtn.addEventListener("click", () => {
      exagIdx = (exagIdx + 1) % exagModes.length;
      const mode = exagModes[exagIdx];
      engine.setTerrainExaggeration(mode.val);
      exagBtn.textContent = mode.label;
    });
  }

  if (arToggleBtn) {
    arToggleBtn.addEventListener("click", () => {
      arEnabled = !arEnabled;
      engine.setLayerVisibility("ar-overlays", arEnabled);
      arToggleBtn.textContent = arEnabled ? "AR Markers: ON" : "AR Markers: OFF";
    });
  }

  if (resetLookBtn) {
    resetLookBtn.addEventListener("click", () => {
      const pose = sampleAlongRoute(routeCoords, cumDist, alongM);
      engine.setAstronautPose({
        lon: pose.lon,
        lat: pose.lat,
        headingDeg: pose.bearingDeg,
        pitchRad: -0.14,
      });
      updateReadouts(pose.lon, pose.lat, pose.bearingDeg);
    });
  }

  if (freeRoamBtn) {
    freeRoamBtn.addEventListener("click", () => {
      freeRoam = !freeRoam;
      if (freeRoam) {
        playing = false;
        if (playBtn) playBtn.textContent = "▶ Walk Route";
      }
      freeRoamBtn.textContent = freeRoam ? "Free-Roam ACTIVE (WASD)" : "Walk: Free (WASD)";
    });
  }

  if (povBtn && onOpenPov) {
    povBtn.addEventListener("click", () => {
      const cur = engine.getView().center;
      const nearest = findNearestStop(cur[0], cur[1]);
      onOpenPov(nearest?.feature?.properties || stops[0]?.properties || null);
    });
  }

  // Keyboard WASD + Arrow keys free roam
  const pressedKeys = new Set();
  window.addEventListener("keydown", (e) => {
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
      pressedKeys.add(e.code);
    }
  });
  window.addEventListener("keyup", (e) => {
    pressedKeys.delete(e.code);
  });

  // Route update listener (`mm:set-route`)
  onSetRoute((detail) => {
    if (!detail) return;
    if (detail.route) {
      route = detail.route;
      routeCoords = route.geometry?.coordinates || routeCoords;
      cumDist = buildCumulativeDistances(routeCoords);
      totalDistM = cumDist[cumDist.length - 1] || route.properties?.distance_m || totalDistM;
      profile = route.profile || profile;
      engine.updateGeoJsonLayer("eva-route", { type: "FeatureCollection", features: [route] });
    }
    playing = false;
    if (playBtn) playBtn.textContent = "▶ Walk Route";
    applyAlongM(detail.alongM ?? 0, true);
  });

  // Main simulation tick for playback & smooth WASD ground-clamped walking
  let lastT = performance.now();
  const simTick = (now) => {
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;

    if (playing) {
      const baseMetersPerSec = 4.2; // Illustrative walk replay pace
      let nextM = alongM + baseMetersPerSec * speedMult * dt;
      if (nextM >= totalDistM) {
        nextM = totalDistM;
        playing = false;
        if (playBtn) playBtn.textContent = "▶ Walk Route";
      }
      applyAlongM(nextM, true);
    } else if (freeRoam || pressedKeys.size > 0) {
      const stepSpeed = 12 * dt; // 12 m/s scouting speed
      let fwd = 0;
      let strafe = 0;
      if (pressedKeys.has("KeyW") || pressedKeys.has("ArrowUp")) fwd += stepSpeed;
      if (pressedKeys.has("KeyS") || pressedKeys.has("ArrowDown")) fwd -= stepSpeed;
      if (pressedKeys.has("KeyD") || pressedKeys.has("ArrowRight")) strafe += stepSpeed;
      if (pressedKeys.has("KeyA") || pressedKeys.has("ArrowLeft")) strafe -= stepSpeed;
      if (fwd !== 0 || strafe !== 0) {
        const pos = engine.stepForwardMeters(fwd, strafe);
        updateReadouts(pos.lon, pos.lat, engine.getView().bearing);
      }
    }

    requestAnimationFrame(simTick);
  };
  requestAnimationFrame(simTick);

  // Initial HUD population
  updateReadouts(startPose.lon, startPose.lat, startPose.bearingDeg);

  return {
    onResize: () => engine.resize(),
    setStrictSlopeLimit: (deg) => {
      strictLimitDeg = Number(deg) || 20;
      engine.setStrictSlopeLimit(strictLimitDeg);
      const cur = engine.getView().center;
      updateReadouts(cur[0], cur[1], engine.getView().bearing);
    },
    getEngine: () => engine,
  };
}
