/**
 * EVA mission model (`web/planner/mission.js`). Pure module: no DOM, no fetch; unit-tested.
 *
 * A mission is a JSON document (contract docs/contracts/mission.json, `martian-mappers.mission.v1`):
 *   { contract, name, startUtc, params, stops: [{ id, name, kind, lon, lat, dwellMin }],
 *     legs: [{ from, to, mode: "walk" | "drive", coords: [[lon, lat], ...], grid }] }
 *
 * Every constant below is either cited or a planner input. Planner inputs are shown as such in the UI.
 */

import { marsDistance } from "./routing.js";

export const MISSION_CONTRACT = "martian-mappers.mission.v1";

/** Cited constants. */
export const SOURCES = Object.freeze({
  sevSpeed: {
    value: 10,
    unit: "km/h",
    text: "NASA SEV fact sheet FS-2011-08-045-JSC: 'can travel at about 10 kilometers per hour'",
    url: "https://www.nasa.gov/wp-content/uploads/2015/08/464826main_sev_factsheet_508.pdf",
  },
  walkBack: {
    value: 9.7,
    unit: "km",
    text: "NASA SEV fact sheet FS-2011-08-045-JSC: Apollo walk-back limit 'about 6 miles' (9.7 km)",
    url: "https://www.nasa.gov/wp-content/uploads/2015/08/464826main_sev_factsheet_508.pdf",
  },
  slope: {
    value: 20,
    caution: 15,
    unit: "deg",
    text: "NASA lunar EVA ConOps slope limits, used as stand-ins (no Mars limit is published)",
    url: "https://www.nasa.gov/wp-content/uploads/2020/01/topic_1-_eva_lunar_surface_concept_of_operations.pdf",
  },
  dose: {
    value: 0.64,
    unit: "mSv/day",
    text: "Curiosity RAD surface dose rate, Hassler et al. 2014 (Science 343, 1244797)",
    url: "https://doi.org/10.1126/science.1244797",
  },
});

/** Planner inputs (not data): the planner sets these for their mission. */
export const DEFAULT_PARAMS = Object.freeze({
  walkPaceKmh: 2.0, // planner input; no validated Mars suited-walking speed is published
  defaultDwellMin: 30, // planner input: time spent at each science stop
  evaLimitH: 8, // planner input: suit / crew EVA duration limit for this plan
  walkBackLimitKm: SOURCES.walkBack.value,
  slopeLimitDeg: SOURCES.slope.value,
  slopeCautionDeg: SOURCES.slope.caution,
  sevSpeedKmh: SOURCES.sevSpeed.value,
});

export const STOP_KINDS = Object.freeze(["start", "science", "rover", "return"]);

export function newMission({ name = "New EVA", startUtc = new Date().toISOString(), site = null } = {}) {
  return { contract: MISSION_CONTRACT, name, startUtc, site, params: { ...DEFAULT_PARAMS }, stops: [], legs: [] };
}

let idSeq = 0;
export function makeStopId() {
  idSeq += 1;
  return `stop-${Date.now().toString(36)}-${idSeq}`;
}

/** Keep legs in step with the stop order: one leg per consecutive pair, reusing routed geometry. */
export function syncLegs(m) {
  const old = new Map(m.legs.map((l) => [`${l.from}>${l.to}`, l]));
  const legs = [];
  for (let k = 0; k < m.stops.length - 1; k++) {
    const a = m.stops[k];
    const b = m.stops[k + 1];
    const prev = old.get(`${a.id}>${b.id}`);
    const straight = [
      [a.lon, a.lat],
      [b.lon, b.lat],
    ];
    const stale =
      !prev ||
      !prev.coords?.length ||
      prev.coords[0][0] !== a.lon ||
      prev.coords[0][1] !== a.lat ||
      prev.coords[prev.coords.length - 1][0] !== b.lon ||
      prev.coords[prev.coords.length - 1][1] !== b.lat;
    legs.push(
      stale
        ? { from: a.id, to: b.id, mode: prev?.mode || "walk", coords: straight, routed: false, grid: null }
        : prev
    );
  }
  m.legs = legs;
  return m;
}

/** Polyline length (m) on the Mars mean sphere. */
export function pathLength(coords) {
  let s = 0;
  for (let k = 1; k < coords.length; k++) s += marsDistance(coords[k - 1], coords[k]);
  return s;
}

/** Resample a polyline every `stepM` metres: [{ lon, lat, s }]. */
export function resample(coords, stepM = 10) {
  const out = [];
  if (!coords.length) return out;
  out.push({ lon: coords[0][0], lat: coords[0][1], s: 0 });
  let s = 0;
  for (let k = 1; k < coords.length; k++) {
    const a = coords[k - 1];
    const b = coords[k];
    const d = marsDistance(a, b);
    const n = Math.max(1, Math.ceil(d / stepM));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      out.push({ lon: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t, s: s + d * t });
    }
    s += d;
  }
  return out;
}

/**
 * Profile and slope statistics of a leg. `elevAt(lon, lat)` returns metres or null (no data).
 * Slope is measured along the path over `stepM` (the grade the walker meets), so it is never more
 * than the cell slope of the grid the leg was routed on.
 */
export function legProfile(coords, elevAt, { stepM = 10, cautionDeg = 15, limitDeg = 20 } = {}) {
  const pts = resample(coords, stepM);
  let ascent = 0;
  let descent = 0;
  let maxGrade = 0;
  let gaps = 0;
  const tiers = { green: 0, amber: 0, red: 0, blocked: 0 };
  let prev = null;
  for (const p of pts) {
    p.elev = elevAt(p.lon, p.lat);
    if (p.elev == null) {
      gaps++;
      prev = null;
      continue;
    }
    if (prev) {
      const dh = p.elev - prev.elev;
      const ds = Math.max(1e-6, p.s - prev.s);
      const grade = (Math.atan(Math.abs(dh) / ds) * 180) / Math.PI;
      if (dh > 0) ascent += dh;
      else descent -= dh;
      maxGrade = Math.max(maxGrade, grade);
      const tier = grade <= 10 ? "green" : grade <= cautionDeg ? "amber" : grade <= limitDeg ? "red" : "blocked";
      tiers[tier] += ds;
    }
    prev = p;
  }
  return { pts, lengthM: pts.length ? pts[pts.length - 1].s : 0, ascent, descent, maxGrade, tiers, gaps };
}

/**
 * Full mission evaluation.
 * @param m mission
 * @param env { elevAt(lon, lat) -> m | null, sunAt(date, lon, lat) -> { elevationRad, ltstHours, lsDeg } }
 */
export function evaluateMission(m, env) {
  const p = { ...DEFAULT_PARAMS, ...(m.params || {}) };
  const start = new Date(m.startUtc);
  const issues = [];
  const legs = [];
  const timeline = [];
  let t = 0; // seconds since EVA start
  let walkS = 0;
  let driveS = 0;
  let walkM = 0;
  let driveM = 0;
  const byId = new Map(m.stops.map((s) => [s.id, s]));

  const stopEvent = (stop, arriveS) => {
    const date = new Date(start.getTime() + arriveS * 1000);
    const sun = env.sunAt ? env.sunAt(date, stop.lon, stop.lat) : null;
    const dwell = (stop.dwellMin ?? (stop.kind === "science" ? p.defaultDwellMin : 0)) * 60;
    timeline.push({ stopId: stop.id, name: stop.name, arriveS, departS: arriveS + dwell, date, sun });
    if (sun && sun.elevationRad < 0) issues.push({ level: "red", stopId: stop.id, text: `${stop.name}: sun below horizon on arrival (LTST ${fmtH(sun.ltstHours)})` });
    return dwell;
  };

  if (m.stops.length) t += stopEvent(m.stops[0], 0);

  // walk-back: walking distance from the last place a pressurised refuge (rover / start) was left
  let sinceRefugeM = 0;
  for (const leg of m.legs) {
    const a = byId.get(leg.from);
    const b = byId.get(leg.to);
    if (!a || !b) continue;
    const prof = legProfile(leg.coords, env.elevAt, { cautionDeg: p.slopeCautionDeg, limitDeg: p.slopeLimitDeg });
    const speedKmh = leg.mode === "drive" ? p.sevSpeedKmh : p.walkPaceKmh;
    const durS = speedKmh > 0 ? (prof.lengthM / 1000 / speedKmh) * 3600 : NaN;
    if (leg.mode === "drive") {
      driveS += durS;
      driveM += prof.lengthM;
      sinceRefugeM = 0;
    } else {
      walkS += durS;
      walkM += prof.lengthM;
      sinceRefugeM += prof.lengthM;
      if (sinceRefugeM / 1000 > p.walkBackLimitKm) {
        issues.push({ level: "red", legFrom: a.id, text: `${a.name} → ${b.name}: ${(sinceRefugeM / 1000).toFixed(1)} km on foot from the last refuge, above the ${p.walkBackLimitKm} km walk-back limit` });
      }
    }
    if (prof.maxGrade > p.slopeLimitDeg) {
      issues.push({ level: "red", legFrom: a.id, text: `${a.name} → ${b.name}: grade up to ${prof.maxGrade.toFixed(1)}°, above the ${p.slopeLimitDeg}° limit` });
    } else if (prof.maxGrade > p.slopeCautionDeg) {
      issues.push({ level: "amber", legFrom: a.id, text: `${a.name} → ${b.name}: grade up to ${prof.maxGrade.toFixed(1)}° (caution above ${p.slopeCautionDeg}°)` });
    }
    if (!leg.routed) issues.push({ level: "amber", legFrom: a.id, text: `${a.name} → ${b.name}: straight line, not routed around slopes yet` });
    if (leg.grid?.coarse) issues.push({ level: "amber", legFrom: a.id, text: `${a.name} → ${b.name}: routed on ${leg.grid.label} (~${leg.grid.resolutionM} m); too coarse for EVA-scale hazards` });
    if (prof.gaps) issues.push({ level: "amber", legFrom: a.id, text: `${a.name} → ${b.name}: ${prof.gaps} profile points without elevation data` });
    legs.push({ from: a.id, to: b.id, mode: leg.mode, departS: t, durS, ...prof });
    t += durS;
    if (b.kind === "rover" || b.kind === "start" || b.kind === "return") sinceRefugeM = 0;
    t += stopEvent(b, t);
  }

  const totalS = t;
  if (totalS / 3600 > p.evaLimitH) issues.push({ level: "red", text: `EVA lasts ${(totalS / 3600).toFixed(1)} h, above the ${p.evaLimitH} h limit set for this plan` });
  const doseMsv = (SOURCES.dose.value * totalS) / 86400;
  return { params: p, legs, timeline, issues, totals: { totalS, walkS, driveS, walkM, driveM, doseMsv } };
}

function fmtH(h) {
  if (!Number.isFinite(h)) return "—";
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Mission JSON → route GeoJSON the 3D view understands (one LineString through all legs). */
export function missionToRoute(m) {
  const coords = [];
  for (const leg of m.legs) {
    for (const c of leg.coords) {
      const last = coords[coords.length - 1];
      if (!last || last[0] !== c[0] || last[1] !== c[1]) coords.push([c[0], c[1]]);
    }
  }
  return {
    type: "Feature",
    properties: { id: m.name, source: "planner" },
    geometry: { type: "LineString", coordinates: coords },
  };
}

export function missionToStops(m) {
  return {
    type: "FeatureCollection",
    features: m.stops.map((s) => ({
      type: "Feature",
      properties: { id: s.id, name: s.name, kind: s.kind },
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
    })),
  };
}

/** Validate an imported mission; returns { ok, mission, error }. */
export function parseMission(json) {
  try {
    const m = typeof json === "string" ? JSON.parse(json) : json;
    if (m?.contract !== MISSION_CONTRACT) return { ok: false, error: `not a ${MISSION_CONTRACT} file` };
    if (!Array.isArray(m.stops) || !Array.isArray(m.legs)) return { ok: false, error: "stops and legs must be arrays" };
    for (const s of m.stops) {
      if (!Number.isFinite(s.lon) || !Number.isFinite(s.lat) || !s.id) return { ok: false, error: "every stop needs id, lon, lat" };
    }
    m.params = { ...DEFAULT_PARAMS, ...(m.params || {}) };
    return { ok: true, mission: syncLegs(m) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
