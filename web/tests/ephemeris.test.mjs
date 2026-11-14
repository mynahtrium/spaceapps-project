import test from "node:test";
import assert from "node:assert/strict";

import {
  BRIGHT_STARS,
  coordinatedMarsTimeHours,
  galeSunState,
  localTrueSolarTimeHours,
  marsMoonBodyFixed,
  marsOrbitState,
  marsSolDate,
  subsolarPoint,
  sunBodyFixedFromElements,
  sunStateAt,
} from "../hud/MarsEphemeris.js";

const R2D = 180 / Math.PI;
const lonDiff = (a, b) => ((((a - b) % 360) + 540) % 360) - 180;

test("Mars24 worked example (2000-01-06 00:00 UTC)", () => {
  const d = new Date(Date.UTC(2000, 0, 6));
  assert.ok(Math.abs(marsSolDate(d) - 44795.9998) < 0.0002);
  const o = marsOrbitState(d);
  assert.ok(Math.abs(o.ls - 277.18758) < 0.001, `Ls ${o.ls}`);
  assert.ok(Math.abs(o.nuMinusM - 4.44193) < 0.0005, `nu-M ${o.nuMinusM}`);
  assert.ok(Math.abs(o.decDeg - -25.2282) < 0.01, `dec ${o.decDeg}`);
  const mtc = coordinatedMarsTimeHours(d);
  assert.ok(mtc > 23.99 && mtc < 24, `MTC ${mtc}`);
});

test("local true solar time is 12:00 at the subsolar longitude", () => {
  for (const iso of ["2024-03-01T00:00Z", "2026-11-14T20:40Z", "2031-07-04T12:00Z"]) {
    const d = new Date(iso);
    const sub = subsolarPoint(d);
    assert.ok(Math.abs(sub.latDeg) <= 25.5);
    assert.ok(Math.abs(localTrueSolarTimeHours(d, sub.lonEastDeg) - 12) < 1e-6);
    const opposite = localTrueSolarTimeHours(d, sub.lonEastDeg + 180);
    assert.ok(opposite < 1e-6 || Math.abs(opposite - 24) < 1e-6);
  }
});

test("Mars24 subsolar point agrees with the IAU-rotation + planet-element Sun", () => {
  const d = new Date("2026-11-14T20:40Z");
  const sub = subsolarPoint(d);
  const s = sunBodyFixedFromElements(d).dir;
  assert.ok(Math.abs(lonDiff(Math.atan2(s[1], s[0]) * R2D, sub.lonEastDeg)) < 0.5);
  assert.ok(Math.abs(Math.asin(s[2]) * R2D - sub.latDeg) < 0.5);
});

test("Phobos / Deimos sub-points match JPL Horizons", () => {
  // Horizons observer tables (target Mars 499, centre 500@401 / 500@402, quantity 14), west lon -> east.
  const ref = [
    ["phobos", "2020-01-01T00:00Z", -2.562786, -0.359207],
    ["phobos", "2026-11-14T20:40Z", -89.148556, -1.066977],
    ["deimos", "2024-06-01T12:00Z", -18.984838, 2.034482],
    ["deimos", "2030-01-01T00:00Z", -155.623704, -2.703123],
  ];
  for (const [name, iso, lonE, lat] of ref) {
    const v = marsMoonBodyFixed(name, new Date(iso));
    const r = Math.hypot(...v);
    assert.ok(Math.abs(lonDiff(Math.atan2(v[1], v[0]) * R2D, lonE)) < 0.3, `${name} lon @ ${iso}`);
    assert.ok(Math.abs(Math.asin(v[2] / r) * R2D - lat) < 0.3, `${name} lat @ ${iso}`);
  }
});

test("fixed-LTST sun state shifts the date to that local time and stays in daylight at 15:00", () => {
  const d = new Date("2026-11-14T20:40Z");
  const s = galeSunState(d, 15);
  assert.ok(Math.abs(s.ltstHours - 15) < 0.01);
  assert.ok(s.elevationRad > 0);
  assert.ok(Math.abs(s.date.getTime() - d.getTime()) <= 12.5 * 3600 * 1000 * 1.03);
  const night = sunStateAt(d, { latDeg: 0, lonEastDeg: subsolarPoint(d).lonEastDeg + 180 });
  assert.ok(night.elevationRad < -1.2);
  const noon = sunStateAt(d, { latDeg: subsolarPoint(d).latDeg, lonEastDeg: subsolarPoint(d).lonEastDeg });
  assert.ok(noon.elevationRad > 1.55);
});

test("bright star catalogue has no duplicate entries", () => {
  const keys = new Set(BRIGHT_STARS.map(([ra, dec]) => `${ra},${dec}`));
  assert.equal(keys.size, BRIGHT_STARS.length);
});
