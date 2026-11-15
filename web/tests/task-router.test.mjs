import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as THREE from "../vendor/three.module.js";
import {
  TASK_VEHICLE_PROFILES,
  buildSiteElevationSampler,
  computeRoverRegionSummary,
  computeTaskProgress,
  generateVehicleRoutes,
  getTaskTargetRover,
  getTaskTargetRovers,
  getTaskVehicleProfile,
  isTeleportLockedForTask,
  selectHabitatStagingSpot,
} from "../shared/task-router.js";
import { createMarsHabitatStation } from "../hud/mars-habitat.js";
import { createTaskGuide3D } from "../hud/hud-tasks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, "..");

test("Tasks target registry exposes all 5 historic rovers and both 6x6 garage vehicles", () => {
  const rovers = getTaskTargetRovers();
  assert.equal(rovers.length, 5);
  assert.deepEqual(
    rovers.map((r) => r.id),
    ["sojourner", "spirit", "opportunity", "curiosity", "perseverance"]
  );
  const mmsev = getTaskVehicleProfile("mmsev");
  const concept = getTaskVehicleProfile("nasa_concept");
  assert.equal(mmsev.massKg, 1850);
  assert.equal(concept.massKg, 2250);
  assert.ok(concept.wheelTorqueMaxNm > mmsev.wheelTorqueMaxNm);
  assert.ok(concept.wheelRadiusM > mmsev.wheelRadiusM);
  assert.equal(getTaskVehicleProfile("mars_robo_concept").id, "nasa_concept");
  assert.ok(TASK_VEHICLE_PROFILES.mmsev && TASK_VEHICLE_PROFILES.nasa_concept);
});

test("selectHabitatStagingSpot places Habitat 520-780 m north across all rover landing regions", () => {
  for (const r of getTaskTargetRovers()) {
    const targetX = r.isHiRiseGaleSite ? -131.1 : 0;
    const targetZ = r.isHiRiseGaleSite ? 1544.05 : 0;
    const sampler = buildSiteElevationSampler(r, {
      galeSampleY: (x, z) => 0.5 * Math.sin(x * 0.015) + 0.4 * Math.cos(z * 0.012),
    });
    const spot = selectHabitatStagingSpot({ targetX, targetZ, sampleElevY: sampler });
    assert.ok(Number.isFinite(spot.habX) && Number.isFinite(spot.habZ));
    assert.ok(spot.habZ < targetZ - 480, `${r.id}: habitat should sit north (-Z) of target`);
    assert.ok(spot.distanceM >= 510 && spot.distanceM <= 810, `${r.id}: expected 520-780m offset, got ${spot.distanceM}`);
  }
  const summary = computeRoverRegionSummary(getTaskTargetRover("perseverance"));
  assert.ok(summary.marsArcKm > 3000, "Jezero to Gale arc km should exceed 3000 km on Mars");
});

test("generateVehicleRoutes differentiates Safe Valley vs Direct Crest and contrasts MMSEV vs Concept", () => {
  // Sculpt a pronounced steep ridge down x = 0 between Habitat (z = -620) and Target (z = 0),
  // with a gentle low-slope valley detour around x = -180.
  const ridgeRelief = (x, z) => {
    const inLatBand = Math.exp(-(((z + 310) / 145) ** 2));
    const centralRidge = 46 * Math.exp(-((x / 85) ** 2)) * inLatBand;
    const eastWall = 30 * Math.exp(-(((x - 240) / 70) ** 2)) * inLatBand;
    return centralRidge + eastWall + 0.15 * Math.sin(x * 0.02);
  };

  const habX = 0;
  const habZ = -620;
  const startX = -6;
  const startZ = habZ + 43;

  const resMmsev = generateVehicleRoutes({
    sampleElevY: ridgeRelief,
    startX,
    startZ,
    targetX: 0,
    targetZ: 0,
    habX,
    habZ,
    vehicleId: "mmsev",
  });
  const resConcept = generateVehicleRoutes({
    sampleElevY: ridgeRelief,
    startX,
    startZ,
    targetX: 0,
    targetZ: 0,
    habX,
    habZ,
    vehicleId: "nasa_concept",
  });

  assert.equal(resMmsev.routes.length, 3);
  assert.deepEqual(
    resMmsev.routes.map((r) => r.id),
    ["safe", "balanced", "direct"]
  );
  const [safeM, balM, dirM] = resMmsev.routes;
  assert.ok(safeM.points.length >= 6 && balM.points.length >= 6 && dirM.points.length >= 6);
  // Safe route detours around central ridge so peak slope is materially milder than direct ridge crossing
  assert.ok(
    safeM.maxSlopeDeg < dirM.maxSlopeDeg,
    `expected safe maxSlopeDeg (${safeM.maxSlopeDeg}) < direct (${dirM.maxSlopeDeg})`
  );
  assert.ok(safeM.distanceM > dirM.distanceM, `expected safe (${safeM.distanceM} m) longer than direct (${dirM.distanceM} m)`);
  // All routes must steer clear of Habitat building wings & upper decks
  for (const rt of resMmsev.routes) {
    for (const pt of rt.points) {
      const insideMainHull = pt.x >= habX - 18 && pt.x <= habX + 32 && pt.z >= habZ - 26 && pt.z <= habZ + 12;
      assert.equal(insideMainHull, false, `route ${rt.id} should not cut through Habitat hull at (${pt.x}, ${pt.z})`);
    }
  }
  // Vehicle suitability contrast: Concept 6x6 outperforms MMSEV on steep direct ridge climb
  const dirC = resConcept.routes.find((r) => r.id === "direct");
  assert.ok(
    dirC.suitabilityPct > dirM.suitabilityPct,
    `expected Concept suitability (${dirC.suitabilityPct}%) > MMSEV (${dirM.suitabilityPct}%) on steep ridge`
  );
  assert.equal(resMmsev.routes.filter((r) => r.recommended).length, 1);
});

test("computeTaskProgress & isTeleportLockedForTask track arrival, bearings, and teleport locks accurately", () => {
  const pts = [
    { x: 0, z: -400, y: 0, sM: 0, slopeDeg: 2 },
    { x: 0, z: -200, y: 0, sM: 200, slopeDeg: 4 },
    { x: 0, z: 0, y: 0, sM: 400, slopeDeg: 2 },
  ];
  const mid = computeTaskProgress({ routePoints: pts, curX: 25, curZ: -200, targetX: 0, targetZ: 0, arriveRadiusM: 13.5 });
  assert.equal(mid.targetArrived, false);
  assert.ok(Math.abs(mid.offRouteM - 25) < 0.5);
  assert.ok(Math.abs(mid.alongM - 200) < 1);
  // Facing south (+Z) is 180 deg in scene azimuth
  assert.ok(Math.abs(mid.bearingToTargetDeg - 180) < 10);

  const arrived = computeTaskProgress({ routePoints: pts, curX: 6, curZ: -8, targetX: 0, targetZ: 0, arriveRadiusM: 13.5 });
  assert.equal(arrived.targetArrived, true);
  assert.ok(arrived.directDistM < 13.5);

  assert.equal(isTeleportLockedForTask(null), false);
  assert.equal(isTeleportLockedForTask({ status: "active" }), true);
  assert.equal(isTeleportLockedForTask({ status: "completed" }), false);
  assert.equal(isTeleportLockedForTask({ status: "aborted" }), false);
});

test("Mars Habitat exposes Tasks controls on all 14 wall screens across zones and 3D ground route guide conforms cleanly", () => {
  const hab = createMarsHabitatStation(THREE, { originX: 80, originZ: -520, rawSampleElevY: () => 2.5 });
  const screens = hab.getTaskScreens();
  assert.equal(screens.length, 14, "expected all 14 Habitat wall screens to be registered for Tasks");
  const primaryScreens = screens.filter((s) => s.spec.kind === "tasks");
  assert.equal(primaryScreens.length, 2, "expected 2 dedicated Tasks wall screens in Pink Corridor");
  for (const s of screens) {
    assert.ok(Number.isFinite(s.ry), "screen should include facing yaw ry");
    assert.ok(s.spec && typeof s.spec.title === "string");
    assert.ok(Math.abs(s.x - (80 + s.localX)) < 1e-4);
  }
  for (const s of primaryScreens) {
    assert.ok(s.localZ >= 4 && s.localZ <= 10, `Primary Tasks screen should sit inside Pink Corridor (z=${s.localZ})`);
  }
  let taskTargetMeshes = 0;
  let wallTargetMeshes = 0;
  hab.getInteractiveGroup().traverse((o) => {
    const kind = o.userData?.screenTarget?.kind;
    if (kind === "taskScreen") taskTargetMeshes++;
    else if (kind === "wallScreen") wallTargetMeshes++;
  });
  assert.equal(taskTargetMeshes, 2);
  assert.equal(wallTargetMeshes, 12);
  assert.equal(taskTargetMeshes + wallTargetMeshes, 14);

  // Build 3D route ribbons & pylons
  const scene = new THREE.Scene();
  const guide = createTaskGuide3D(THREE, scene);
  const sampler = (x, z) => Math.sin(x * 0.03) * 1.8 + Math.cos(z * 0.02) * 1.4;
  const bundle = generateVehicleRoutes({
    sampleElevY: sampler,
    startX: 74,
    startZ: -477,
    targetX: 0,
    targetZ: 0,
    habX: 80,
    habZ: -520,
    vehicleId: "mmsev",
  });
  guide.build({
    routes: bundle.routes,
    selectedRouteId: "safe",
    targetRover: getTaskTargetRover("perseverance"),
    targetX: 0,
    targetZ: 0,
    sampleY: sampler,
    bayPosition: { x: 74, z: -487 },
  });
  assert.equal(guide.group.visible, true);
  assert.ok(guide.group.children.length >= 6, "expected 3 ribbons + pylons + bay ring + target beacon");
  guide.rebuildHeights((x, z) => sampler(x, z) + 5.0);
  guide.update(0.016, 1.0, 74, -487, 74, -487);
  guide.clear();
  assert.equal(guide.group.visible, false);
  assert.equal(guide.group.children.length, 0);
});

test("Tasks preserves test invariants and enforces teleport locks across HUD, Transit, Fleet, and Orbit", () => {
  const hudSrc = fs.readFileSync(path.join(WEB_DIR, "hud", "hud3d.js"), "utf8");
  const taskUiSrc = fs.readFileSync(path.join(WEB_DIR, "hud", "hud-tasks.js"), "utf8");
  const appSrc = fs.readFileSync(path.join(WEB_DIR, "app.js"), "utf8");
  const htmlSrc = fs.readFileSync(path.join(WEB_DIR, "index.html"), "utf8");

  // Preserve regression invariants
  assert.match(hudSrc, /\/\/\s*npcManager\.spawnCorridorScreenNPCs\(/);
  assert.match(hudSrc, /habitatStation\.group\.visible = gale;/);

  // All habitat screens open Tasks; no Tasks buttons leaked into ESC menu or HUD bottom bar
  assert.doesNotMatch(htmlSrc, /esc-open-tasks|hud-tasks-btn/i);
  assert.match(hudSrc, /target\.kind === "taskScreen"[\s\S]{0,80}target\.kind === "wallScreen"[\s\S]{0,80}taskUi\.open/);
  assert.match(hudSrc, /function tryTaskScreenInteract[\s\S]{0,450}wallScreen[\s\S]{0,120}taskUi\.open/);
  assert.match(hudSrc, /function findNearbyTaskScreen[\s\S]{0,650}clipCameraSegment/);
  assert.match(hudSrc, /data-act="tasks"/);
  assert.match(hudSrc, /act === "tasks"[\s\S]{0,80}taskUi\.open/);
  assert.match(taskUiSrc, /data-tk-tab="tasks"[\s\S]{0,260}data-tk-tab="telemetry"/);

  // Teleport lock checks present across all entry points
  assert.match(hudSrc, /function visitLocation[\s\S]{0,200}isTaskLocked\(\)/);
  assert.match(hudSrc, /function visitRoverSite[\s\S]{0,160}isTaskLocked\(\)/);
  assert.match(hudSrc, /function deployToHardwareSite[\s\S]{0,160}isTaskLocked\(\)/);
  assert.match(hudSrc, /function returnToHabitat[\s\S]{0,160}isTaskLocked\(\)/);
  assert.match(hudSrc, /function visitHabitatStation[\s\S]{0,160}isTaskLocked\(\)/);
  assert.match(hudSrc, /syncAlongM:[\s\S]{0,140}isTaskLocked\(\)/);
  assert.match(appSrc, /function landFromOrbit[\s\S]{0,160}isTaskActive/);
  assert.match(appSrc, /rover-modal-visit-3d[\s\S]{0,260}isTaskActive/);
});
