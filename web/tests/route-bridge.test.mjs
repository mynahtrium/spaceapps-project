import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { marsDistanceM, resolveNextStopAlongRoute } from "../shared/route-bridge.js";

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
