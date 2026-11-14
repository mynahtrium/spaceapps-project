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
    new CustomEvent("mm:set-route", { detail: { route, alongM } })
  );
}

export function onSetRoute(handler) {
  if (typeof window === "undefined") return () => {};
  const wrapped = (e) => handler(e.detail);
  window.addEventListener("mm:set-route", wrapped);
  return () => window.removeEventListener("mm:set-route", wrapped);
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
  if (slopeDeg == null || Number.isNaN(slopeDeg)) {
    return { label: "NO DATA", color: "#64748b", level: "nodata" };
  }
  if (slopeDeg <= 10) return { label: "NOMINAL <=10°", color: "#34d399", level: "green" };
  if (slopeDeg <= (strictLimitDeg < 16 ? 13 : 15)) {
    return { label: "MODERATE", color: "#fbbf24", level: "amber" };
  }
  if (slopeDeg <= strictLimitDeg) {
    return { label: "STEEP", color: "#f87171", level: "red" };
  }
  return {
    label: `EXCEEDS ${strictLimitDeg}° LIMIT`,
    color: "#ef4444",
    level: "blocked",
  };
}
