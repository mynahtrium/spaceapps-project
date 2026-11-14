/**
 * Route Event Bridge (`mm:set-route`) and Mars Route Polyline Utilities.
 * Delegates planetary spherical math cleanly to `../map/Geodesy.js`.
 */

import {
  MARS_RADIUS_MEAN_M,
  marsBearingDeg,
  marsDistanceM,
} from "../map/Geodesy.js";

export { MARS_RADIUS_MEAN_M, marsDistanceM, marsBearingDeg };

export function dispatchSetRoute(route, alongM = 0) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("mm:set-route", { detail: { route, alongM, along_m: alongM } })
  );
}

export function onSetRoute(handler) {
  if (typeof window === "undefined") return () => {};
  const wrapped = (e) => handler(e.detail);
  window.addEventListener("mm:set-route", wrapped);
  return () => window.removeEventListener("mm:set-route", wrapped);
}

export function dispatchTeleport(target) {
  if (typeof window === "undefined" || !target) return;
  window.dispatchEvent(new CustomEvent("mm:teleport", { detail: target }));
}

export function onTeleport(handler) {
  if (typeof window === "undefined") return () => {};
  const wrapped = (e) => handler(e.detail);
  window.addEventListener("mm:teleport", wrapped);
  return () => window.removeEventListener("mm:teleport", wrapped);
}

export function buildCumulativeDistances(coords) {
  const cum = [0];
  if (!Array.isArray(coords)) return cum;
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + marsDistanceM(coords[i - 1], coords[i]));
  }
  return cum;
}

export function sampleAlongRoute(coords, cumDist, sM) {
  if (!Array.isArray(coords) || coords.length === 0) {
    return { lon: 137.39, lat: -4.8, bearingDeg: 0, sM: 0, index: 0 };
  }
  const total = cumDist[cumDist.length - 1] || 0;
  const target = Math.max(0, Math.min(total, sM));
  let i = 0;
  while (i < cumDist.length - 2 && cumDist[i + 1] < target) i++;
  const segStart = cumDist[i];
  const segEnd = cumDist[i + 1] ?? segStart;
  const t = segEnd > segStart ? (target - segStart) / (segEnd - segStart) : 0;
  const a = coords[i];
  const b = coords[i + 1] || a;
  return {
    lon: a[0] + (b[0] - a[0]) * t,
    lat: a[1] + (b[1] - a[1]) * t,
    bearingDeg: marsBearingDeg(a, b),
    sM: target,
    index: i,
  };
}

export function closestAlongM(coords, cumDist, lon, lat) {
  if (!Array.isArray(coords) || coords.length === 0) return 0;
  let bestDist = Infinity;
  let bestSM = 0;
  for (let i = 0; i < coords.length; i++) {
    const d = marsDistanceM([lon, lat], coords[i]);
    if (d < bestDist) {
      bestDist = d;
      bestSM = cumDist[i] ?? 0;
    }
  }
  return bestSM;
}

export function classifySlope(slopeDeg, strictLimitDeg = 20) {
  // `id` and `level` are aliases (2D planner reads `level`/`color`, bodycam HUD reads `id`).
  const make = (level, label, color) => ({ id: level, level, label, color });
  if (slopeDeg == null || Number.isNaN(slopeDeg)) return make("green", "NO DATA", "#64748b");
  if (slopeDeg <= 10) return make("green", "NOMINAL <=10°", "#34d399");
  if (slopeDeg <= (strictLimitDeg < 16 ? 13 : 15)) return make("amber", "MODERATE", "#fbbf24");
  if (slopeDeg <= strictLimitDeg) return make("red", "STEEP", "#f87171");
  return make("blocked", `EXCEEDS ${strictLimitDeg}° LIMIT`, "#ef4444");
}

/**
 * Resolve the upcoming stop along `route.legs` at walk distance `sM` (BUG-15),
 * falling back to nearest-stop Mars spherical distance if `legs` are absent (BUG-16).
 */
export function resolveNextStopAlongRoute(route, stops, sM, lonLat) {
  const features = stops?.features || [];
  const legs = route?.legs || [];
  if (legs.length > 0 && features.length > 0) {
    let cumLegM = 0;
    let chosenLeg = legs[legs.length - 1];
    let targetCumM = 0;
    for (const leg of legs) {
      cumLegM += Number(leg.distance_m) || 0;
      targetCumM = cumLegM;
      if (sM < cumLegM - 0.05 || leg === legs[legs.length - 1]) {
        chosenLeg = leg;
        break;
      }
    }
    const targetId = chosenLeg.to ?? chosenLeg.to_stop_id;
    const stopFeature = features.find((f) => f.properties?.id === targetId || f.id === targetId);
    if (stopFeature) {
      return {
        stop: stopFeature,
        distanceM: Math.max(0, targetCumM - sM),
        mode: "leg",
      };
    }
  }

  let nearest = features[0] || null;
  let minStopDist = Infinity;
  if (lonLat && features.length > 0) {
    for (const f of features) {
      const coords = f.geometry?.coordinates;
      if (!coords) continue;
      const d = marsDistanceM(lonLat, coords);
      if (d < minStopDist) {
        minStopDist = d;
        nearest = f;
      }
    }
  }
  return { stop: nearest, distanceM: minStopDist, mode: "nearest" };
}
