import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  dispatchTeleport,
  marsDistanceM,
  onTeleport,
  resolveNextStopAlongRoute,
} from "../shared/route-bridge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

test("resolveNextStopAlongRoute advances through route.legs instead of snapping to nearest stop (BUG-15)", () => {
  const route = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/processed/routing/route.json"), "utf8"));
  const stops = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/processed/routing/stops.json"), "utf8"));

  const start = resolveNextStopAlongRoute(route, stops, 0, route.geometry.coordinates[0]);
  assert.equal(start.mode, "leg");
  assert.equal(start.stop.properties.id, "stop-mudstone-a");
  assert.ok(Math.abs(start.distanceM - 220.9) < 0.1);

  const mid = resolveNextStopAlongRoute(route, stops, 220.9, route.geometry.coordinates[0]);
  assert.equal(mid.stop.properties.id, "stop-mudstone-b");
  assert.ok(Math.abs(mid.distanceM - 125.3) < 0.1);

  const bonus = resolveNextStopAlongRoute(route, stops, 500, route.geometry.coordinates[0]);
  assert.equal(bonus.stop.properties.id, "stop-boxwork-bonus");
  assert.ok(Math.abs(bonus.distanceM - 222.8) < 0.1);

  const end = resolveNextStopAlongRoute(route, stops, 790.3, route.geometry.coordinates[0]);
  assert.equal(end.stop.properties.id, "stop-habitat");
  assert.equal(end.distanceM, 0);
});

test("resolveNextStopAlongRoute falls back to Mars spherical distance when legs are absent (BUG-16)", () => {
  const stops = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data/processed/routing/stops.json"), "utf8"));
  const target = stops.features[1];
  const origin = stops.features[0].geometry.coordinates;

  const res = resolveNextStopAlongRoute({ legs: [] }, stops, 0, origin);
  assert.equal(res.mode, "nearest");
  assert.equal(res.stop.properties.id, stops.features[0].properties.id);
  assert.equal(res.distanceM, 0);

  const expectedMarsDist = marsDistanceM(origin, target.geometry.coordinates);
  assert.ok(expectedMarsDist > 50 && expectedMarsDist < 400);
});

function assertCoordClose(actual, expected) {
  assert.ok(Math.abs(actual.lon - expected.lon) < 1e-10, `lon ${actual.lon} != ${expected.lon}`);
  assert.ok(Math.abs(actual.lat - expected.lat) < 1e-10, `lat ${actual.lat} != ${expected.lat}`);
}

test("dispatchTeleport and onTeleport buffer pending coordinates and deliver live updates", () => {
  const buffered = [];
  const returned = dispatchTeleport([137.392, -4.798]);
  assertCoordClose(returned, { lon: 137.392, lat: -4.798 });

  const off1 = onTeleport((evt) => buffered.push(evt));
  assert.equal(buffered.length, 1);
  assertCoordClose(buffered[0], { lon: 137.392, lat: -4.798 });

  const second = [];
  const off2 = onTeleport((evt) => second.push(evt));
  assert.equal(second.length, 0, "stale buffered teleport must not replay after first consumer");

  dispatchTeleport({ lon: 137.401, lat: -4.805 });
  assertCoordClose(buffered[1], { lon: 137.401, lat: -4.805 });
  assertCoordClose(second[0], { lon: 137.401, lat: -4.805 });

  off1();
  dispatchTeleport([137.385, -4.812]);
  assert.equal(buffered.length, 2);
  assertCoordClose(second[1], { lon: 137.385, lat: -4.812 });
  off2();
});
