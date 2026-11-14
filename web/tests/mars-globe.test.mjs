import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MARS_CIRCUMFERENCE_M,
  MARS_LANDMARKS,
  MARS_RADIUS_MEAN_M,
  MOLA_DEM_OFFSET_M,
  createMarsGlobalModel,
  decodeMolaDemRgba,
  localSceneXZToLonLat,
  lonLatToUnitVec,
  marsLonLatAltToLocalScene,
  sphereNormalAtLocal,
  stepOnMarsSphere,
  unitVecToLonLat,
} from "../hud/mars-globe.js";
import { marsDistanceM } from "../map/Geodesy.js";

test("mars planetary dimensions match real Mars", () => {
  assert.equal(MARS_RADIUS_MEAN_M, 3389500);
  assert.ok(Math.abs(MARS_CIRCUMFERENCE_M - 2 * Math.PI * 3389500) < 1e-6);
  assert.ok(MARS_CIRCUMFERENCE_M > 21296000 && MARS_CIRCUMFERENCE_M < 21298000);
});

test("unitVecToLonLat <-> lonLatToUnitVec round-trip across poles and antimeridian", () => {
  for (const [lon, lat] of [
    [137.39, -4.8],
    [-133.8, 18.65],
    [179.99, 0.0],
    [-179.99, -42.4],
    [45.0, 89.5],
    [-120.0, -89.5],
  ]) {
    const v = lonLatToUnitVec(lon, lat);
    assert.ok(Math.abs(Math.hypot(v.ux, v.uy, v.uz) - 1) < 1e-12);
    const rt = unitVecToLonLat(v.ux, v.uy, v.uz);
    assert.ok(Math.abs(rt.latDeg - lat) < 1e-9);
    const dLon = Math.abs((((rt.lonDeg - lon + 540) % 360) - 180));
    assert.ok(dLon < 1e-9);
  }
});

test("stepOnMarsSphere walks accurate distance and crosses poles & antimeridian smoothly", () => {
  // Walk 10 km East along equator
  const eqStep = stepOnMarsSphere(137.39, 0, 0, 10000, 0, 0);
  const dEq = marsDistanceM([137.39, 0], [eqStep.lonDeg, eqStep.latDeg]);
  assert.ok(Math.abs(dEq - 10000) < 0.05);

  // Walk straight over North Pole without NaN or singularity
  const overPole = stepOnMarsSphere(20, 89.95, 0, 0, 10000, 0);
  assert.ok(Number.isFinite(overPole.lonDeg) && Number.isFinite(overPole.latDeg));
  assert.ok(Number.isFinite(overPole.deltaYawRad));
  assert.ok(overPole.latDeg > 89 && overPole.latDeg <= 90);
  const dPole = marsDistanceM([20, 89.95], [overPole.lonDeg, overPole.latDeg]);
  assert.ok(Math.abs(dPole - 10000) < 0.2);

  // Walk across +/-180 deg antimeridian seamlessly
  const anti = stepOnMarsSphere(179.99, 5, 0, 5000, 0, 0);
  assert.ok(anti.lonDeg < -179 && anti.lonDeg >= -180);
});

test("spherical scene projection satisfies exact sphere geometry and Float64 invertibility", () => {
  const refLon = 137.39;
  const refLat = -4.8;
  const refElev = -3620;

  // At 10 km East on datum, terrain curves down by ~d^2 / (2R) ~= -14.75 m
  const farGeo = stepOnMarsSphere(refLon, refLat, refElev, 10000, 0, 0);
  const p = marsLonLatAltToLocalScene(farGeo.lonDeg, farGeo.latDeg, refElev + 42, refLon, refLat, refElev);
  const radial = Math.hypot(p.x, MARS_RADIUS_MEAN_M + p.y, p.z);
  assert.ok(Math.abs(radial - (MARS_RADIUS_MEAN_M + 42)) < 1e-4);
  assert.ok(p.y < 42 - 14 && p.y > 42 - 16);

  // Inverse localSceneXZToLonLat recovers geo coordinates accurately
  const inv = localSceneXZToLonLat(350, -420, refLon, refLat);
  const pInv = marsLonLatAltToLocalScene(inv.lonDeg, inv.latDeg, refElev, refLon, refLat, refElev);
  assert.ok(Math.abs(pInv.x - 350) < 0.05);
  assert.ok(Math.abs(pInv.z - -420) < 0.05);

  const [nx, ny, nz] = sphereNormalAtLocal(p.x, p.y, p.z);
  assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) < 1e-12);
  assert.ok(ny > 0.99 && nx > 0);
});

test("createMarsGlobalModel blends HiRISE Gale DTM smoothly into real global topography", () => {
  const bounds = {
    west_lon_deg: 137.372831,
    east_lon_deg: 137.406542,
    south_lat_deg: -4.816946,
    north_lat_deg: -4.783236,
  };
  const elevGrid = new Float32Array(16).fill(-3610);
  const model = createMarsGlobalModel({
    elevGrid,
    imgW: 4,
    imgH: 4,
    bounds,
    elevMin: -3850,
    elevMax: -3369,
  });

  // Inside Gale HiRISE patch
  assert.equal(model.hiRiseWeightAt(137.39, -4.8), 1);
  assert.ok(Math.abs(model.sampleElevM(137.39, -4.8) - -3610) < 1e-3);

  // Far outside HiRISE patch
  assert.equal(model.hiRiseWeightAt(-133.8, 18.65), 0);

  // Global topography check against landmarks
  const oly = MARS_LANDMARKS.find((l) => l.id === "olympus");
  const hel = MARS_LANDMARKS.find((l) => l.id === "hellas");
  const np = MARS_LANDMARKS.find((l) => l.id === "npole");
  assert.ok(model.sampleElevM(oly.lon, oly.lat) > 15000);
  assert.ok(model.sampleElevM(hel.lon, hel.lat) < -6000);
  const poleAlbedo = model.sampleAlbedoRgb(np.lon, np.lat, 2400);
  assert.ok(poleAlbedo[0] > 0.7 && poleAlbedo[2] > 0.6);

  // Continuity check across boundary in small steps
  const eBefore = model.sampleElevM(137.4064, -4.8);
  const eAfter = model.sampleElevM(137.4070, -4.8);
  assert.ok(Math.abs(eAfter - eBefore) < 50);
  assert.equal(model.hasRealMola, false);
  assert.equal(model.hasRealViking, false);
});

test("decodeMolaDemRgba and real MOLA/Viking planetary grids sample accurately with seam wrap", () => {
  const mW = 4;
  const mH = 2;
  const rgba = new Uint8ClampedArray(mW * mH * 4);
  const encodeMola = (pixelIndex, elevM) => {
    const val = Math.round(elevM + MOLA_DEM_OFFSET_M);
    rgba[pixelIndex * 4] = (val >> 8) & 0xff;
    rgba[pixelIndex * 4 + 1] = val & 0xff;
    rgba[pixelIndex * 4 + 2] = 0;
    rgba[pixelIndex * 4 + 3] = 255;
  };
  // Top row (lat ~ +45..+90) values around -8000..+20000
  encodeMola(0, 1000);
  encodeMola(1, 5000);
  encodeMola(2, 12000);
  encodeMola(3, 1000);
  // Bottom row
  encodeMola(4, -8068);
  encodeMola(5, 0);
  encodeMola(6, 21134);
  encodeMola(7, -8068);

  const molaGrid = decodeMolaDemRgba(rgba, mW, mH);
  assert.equal(molaGrid.length, mW * mH);
  assert.equal(molaGrid[0], 1000);
  assert.equal(molaGrid[4], -8068);
  assert.equal(molaGrid[6], 21134);

  // Synthetic 4x2 Viking RGB texture
  const vikingRgb = new Uint8ClampedArray(mW * mH * 4).fill(255);
  vikingRgb[0] = 200;
  vikingRgb[1] = 100;
  vikingRgb[2] = 50;

  const bounds = {
    west_lon_deg: 137.372831,
    east_lon_deg: 137.406542,
    south_lat_deg: -4.816946,
    north_lat_deg: -4.783236,
  };
  const model = createMarsGlobalModel({
    elevGrid: new Float32Array(16).fill(-3610),
    imgW: 4,
    imgH: 4,
    bounds,
    elevMin: -3850,
    elevMax: -3369,
    molaGrid,
    molaW: mW,
    molaH: mH,
    vikingRgb,
    vikingW: mW,
    vikingH: mH,
  });

  assert.equal(model.hasRealMola, true);
  assert.equal(model.hasRealViking, true);
  // Longitude wrap continuity across -180 / +180 antimeridian
  const eWest = model.sampleElevM(-179.99, 45);
  const eEast = model.sampleElevM(179.99, 45);
  assert.ok(Math.abs(eWest - eEast) < 10);

  // Gale HiRISE patch still overrides MOLA cleanly inside patch bounds
  assert.ok(Math.abs(model.sampleElevM(137.39, -4.8) - -3610) < 1e-3);

  // Offline demo files & manifest metadata check
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const demoDir = path.resolve(testDir, "../../data/demo");
  assert.ok(fs.existsSync(path.join(demoDir, "mars-mola-dem.png")));
  assert.ok(fs.existsSync(path.join(demoDir, "mars-viking-global.jpg")));
  const meta = JSON.parse(fs.readFileSync(path.join(demoDir, "mars-global-sources.json"), "utf8"));
  assert.ok(Array.isArray(meta.sources) && meta.sources.length >= 3);
  assert.ok(meta.sources.some((s) => String(s.product_id || "").includes("MOLA")));
  assert.ok(meta.sources.some((s) => String(s.product_id || "").includes("Viking")));
});
