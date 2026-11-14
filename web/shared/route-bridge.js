/**
 * Shared route event bridge (`mm:set-route`) and Mars-radius geometry helpers.
 * GeoJSON coordinates are [lon_deg, lat_deg].
 */

export const MARS_RADIUS_M = 3389500;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Dispatch `mm:set-route` on `window` so the 3D HUD & visor map sync route + distance.
 * @param {object} route - GeoJSON Feature (LineString) matching martian-mappers.route.v1
 * @param {number} [alongM=0] - Starting distance along the route in metres
 */
export function dispatchSetRoute(route, alongM = 0) {
  window.dispatchEvent(
    new CustomEvent("mm:set-route", {
      detail: { route, along_m: Number(alongM) || 0 },
    })
  );
}

/**
 * Subscribe to `mm:set-route` events.
 * @param {(detail: { route: object, along_m: number }) => void} handler
 * @returns {() => void} Unsubscribe function
 */
export function onSetRoute(handler) {
  const listener = (ev) => {
    if (ev.detail && ev.detail.route) {
      handler(ev.detail);
    }
  };
  window.addEventListener("mm:set-route", listener);
  return () => window.removeEventListener("mm:set-route", listener);
}

/**
 * Spherical distance on Mars (mean radius 3,389.5 km) between two [lon, lat] points.
 */
export function marsDistanceM(coordA, coordB) {
  const [lon1, lat1] = coordA;
  const [lon2, lat2] = coordB;
  const phi1 = lat1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD;
  const dPhi = (lat2 - lat1) * DEG_TO_RAD;
  const dLam = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
  return 2 * MARS_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Initial bearing in degrees (0 = North, 90 = East) from coordA to coordB.
 */
export function marsBearingDeg(coordA, coordB) {
  const [lon1, lat1] = coordA;
  const [lon2, lat2] = coordB;
  const phi1 = lat1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD;
  const dLam = (lon2 - lon1) * DEG_TO_RAD;
  const y = Math.sin(dLam) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLam);
  return ((Math.atan2(y, x) * RAD_TO_DEG) + 360) % 360;
}

/**
 * Build cumulative distance array (in metres, Mars radius) along a LineString's coordinates.
 */
export function buildCumulativeDistances(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + marsDistanceM(coords[i - 1], coords[i]));
  }
  return cum;
}

/**
 * Sample [lon, lat] and heading_deg at distance `sM` along a LineString.
 */
export function sampleAlongRoute(coords, cumDist, sM) {
  if (!coords || coords.length === 0) {
    return { lon: 137.39, lat: -4.8, headingDeg: 0, sM: 0 };
  }
  if (coords.length === 1) {
    return { lon: coords[0][0], lat: coords[0][1], headingDeg: 0, sM: 0 };
  }
  const total = cumDist[cumDist.length - 1] || 1;
  const clamped = Math.max(0, Math.min(sM, total));

  let idx = 0;
  while (idx < cumDist.length - 2 && cumDist[idx + 1] < clamped) {
    idx++;
  }
  const segLen = cumDist[idx + 1] - cumDist[idx];
  const t = segLen > 0 ? (clamped - cumDist[idx]) / segLen : 0;
  const a = coords[idx];
  const b = coords[idx + 1];
  const lon = a[0] + (b[0] - a[0]) * t;
  const lat = a[1] + (b[1] - a[1]) * t;
  const headingDeg = marsBearingDeg(a, b);
  return { lon, lat, headingDeg, sM: clamped };
}

/**
 * Find the closest `along_m` along a LineString to a stop's [lon, lat].
 */
export function closestAlongM(coords, cumDist, targetCoord) {
  if (!coords || coords.length === 0) return 0;
  let bestDist = Infinity;
  let bestS = 0;
  for (let i = 0; i < coords.length; i++) {
    const d = marsDistanceM(coords[i], targetCoord);
    if (d < bestDist) {
      bestDist = d;
      bestS = cumDist[i] || 0;
    }
  }
  return bestS;
}

/**
 * Classify slope degrees using the project's illustrative lunar stand-in thresholds.
 */
export function classifySlope(slopeDeg, strictLimitDeg = 20) {
  if (slopeDeg == null || Number.isNaN(slopeDeg)) {
    return { id: "green", label: "≤10° Preferred" };
  }
  if (slopeDeg > strictLimitDeg) {
    return { id: "blocked", label: `>${strictLimitDeg}° Blocked` };
  }
  if (slopeDeg > 15) {
    return { id: "red", label: "15–20° Steep" };
  }
  if (slopeDeg > 10) {
    return { id: "amber", label: "10–15° Caution" };
  }
  return { id: "green", label: "≤10° Preferred" };
}
