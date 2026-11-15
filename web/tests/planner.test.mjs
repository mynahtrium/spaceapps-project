import test from "node:test";
import assert from "node:assert/strict";

import { findRoute, marsDistance, sampleGrid, slopeGrid } from "../planner/routing.js";
import {
  DEFAULT_PARAMS,
  MISSION_CONTRACT,
  SOURCES,
  evaluateMission,
  missionToRoute,
  newMission,
  parseMission,
  syncLegs,
} from "../planner/mission.js";

const DEG = Math.PI / 180;

/** A synthetic test grid: flat plain with a steep ridge across the middle and one gap. */
function ridgeGrid() {
  const nx = 60;
  const nz = 60;
  const elev = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const ridge = i >= 28 && i <= 31 && !(j >= 50 && j <= 54);
      elev[j * nx + i] = ridge ? 30 : 0;
    }
  }
  const cell = 5;
  const lat0 = -4.77;
  const dLat = (cell * nz) / (3389500 * DEG);
  const dLon = (cell * nx) / (3389500 * DEG * Math.cos(lat0 * DEG));
  return { nx, nz, dx: cell, dz: cell, elev, west: 137.38, east: 137.38 + dLon, north: lat0 + dLat / 2, south: lat0 - dLat / 2, resolutionM: cell, label: "test" };
}

test("slope grid: flat is 0 deg, a 30 m step over 10 m is steep", () => {
  const g = ridgeGrid();
  const s = slopeGrid(g);
  assert.equal(s[5 * g.nx + 5], 0);
  assert.ok(s[10 * g.nx + 27] > 40, `ridge flank ${s[10 * g.nx + 27]}`);
});

test("A* goes around a ridge steeper than the limit, through the gap", () => {
  const g = ridgeGrid();
  const lonAt = (i) => g.west + ((i + 0.5) / g.nx) * (g.east - g.west);
  const latAt = (j) => g.north - ((j + 0.5) / g.nz) * (g.north - g.south);
  const from = [lonAt(10), latAt(10)];
  const to = [lonAt(50), latAt(10)];
  const r = findRoute(g, from, to, { slopeLimitDeg: 20 });
  assert.ok(r.ok, r.reason);
  const straight = marsDistance(from, to);
  let len = 0;
  for (let k = 1; k < r.coords.length; k++) len += marsDistance(r.coords[k - 1], r.coords[k]);
  assert.ok(len > straight * 1.5, `detour ${len.toFixed(0)} m vs straight ${straight.toFixed(0)} m`);
  // every point of the path stays off the blocked ridge cells
  const s = slopeGrid(g);
  for (const [lon, lat] of r.coords.slice(1, -1)) {
    const v = sampleGrid(g, lon, lat, s);
    assert.ok(v == null || v <= 20 + 1e-6, `path crosses slope ${v}`);
  }
});

test("A* reports no path when the ridge has no gap", () => {
  const g = ridgeGrid();
  for (let j = 0; j < g.nz; j++) for (let i = 28; i <= 31; i++) g.elev[j * g.nx + i] = 30;
  const r = findRoute(g, [g.west + 0.0001, (g.north + g.south) / 2], [g.east - 0.0001, (g.north + g.south) / 2], { slopeLimitDeg: 20 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-path");
});

test("Mars distance uses the 3389.5 km mean radius", () => {
  const d = marsDistance([0, 0], [1, 0]);
  assert.ok(Math.abs(d - 3389500 * DEG) < 1, `${d}`);
});

function twoStopMission({ mode = "walk", distLon = 0.05 } = {}) {
  const m = newMission({ name: "t", startUtc: "2026-11-15T12:00:00Z" });
  m.stops = [
    { id: "a", name: "A", kind: "start", lon: 137.38, lat: -4.77, dwellMin: 0 },
    { id: "b", name: "B", kind: "science", lon: 137.38 + distLon, lat: -4.77, dwellMin: 30 },
  ];
  syncLegs(m);
  m.legs[0].mode = mode;
  return m;
}

test("mission: walk time = distance / planned pace, dose = 0.64 mSv/day x EVA time", () => {
  const m = twoStopMission();
  const r = evaluateMission(m, { elevAt: () => 0, sunAt: () => ({ elevationRad: 0.5, ltstHours: 12, lsDeg: 0 }) });
  const dist = r.legs[0].lengthM;
  const expectWalkS = (dist / 1000 / DEFAULT_PARAMS.walkPaceKmh) * 3600;
  assert.ok(Math.abs(r.totals.walkS - expectWalkS) < 1);
  assert.ok(Math.abs(r.totals.totalS - (expectWalkS + 30 * 60)) < 1);
  assert.ok(Math.abs(r.totals.doseMsv - (0.64 * r.totals.totalS) / 86400) < 1e-9);
});

test("mission: SEV legs use the fact-sheet 10 km/h and reset the walk-back distance", () => {
  assert.equal(SOURCES.sevSpeed.value, 10);
  const m = twoStopMission({ mode: "drive", distLon: 0.3 });
  const r = evaluateMission(m, { elevAt: () => 0, sunAt: () => ({ elevationRad: 0.5 }) });
  assert.ok(Math.abs(r.totals.driveS - (r.legs[0].lengthM / 1000 / 10) * 3600) < 1);
  assert.ok(!r.issues.some((i) => /walk-back/.test(i.text)), "driving does not count as walking");
});

test("mission: flags walk-back over the 9.7 km Apollo limit, night arrival, steep grade, EVA over limit", () => {
  const m = twoStopMission({ distLon: 0.25 }); // ~14.8 km on foot
  m.params.evaLimitH = 1;
  const r = evaluateMission(m, {
    elevAt: (lon) => (lon - 137.38) * 3389500 * DEG * Math.tan(25 * DEG), // 25 deg ramp
    sunAt: () => ({ elevationRad: -0.1, ltstHours: 21 }),
  });
  const t = r.issues.map((i) => i.text).join("\n");
  assert.match(t, /walk-back/);
  assert.match(t, /sun below horizon/);
  assert.match(t, /above the 20° limit/);
  assert.match(t, /above the 1 h limit/);
});

test("mission JSON round-trips and rejects foreign files", () => {
  const m = twoStopMission();
  const back = parseMission(JSON.stringify(m));
  assert.ok(back.ok);
  assert.equal(back.mission.contract, MISSION_CONTRACT);
  assert.equal(back.mission.stops.length, 2);
  assert.equal(back.mission.legs.length, 1);
  assert.equal(parseMission('{"contract":"x"}').ok, false);
  const route = missionToRoute(m);
  assert.equal(route.geometry.type, "LineString");
  assert.deepEqual(route.geometry.coordinates[0], [137.38, -4.77]);
});
