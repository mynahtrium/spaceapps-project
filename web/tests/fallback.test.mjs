import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as THREE from "../vendor/three.module.js";
import { createHistoricRoverGroup, stepRoverRigKinematics } from "../hud/historic-rovers.js";

import { makeLocalTangentOrigin, decodeTerrariumPixel } from "../map/Geodesy.js";
import { MarsDemSampler, fillElevationVoids } from "../map/MarsDemSampler.js";
import {
  DEFAULT_DEV_SETTINGS,
  FULL_REALISM_PRESET,
  normalizeDevSettings,
} from "../shared/dev-settings.js";
import {
  MARS_HISTORIC_ROVERS,
  buildHistoricRoversGeoJson,
  computeRoverSurfaceDistanceKm,
  formatMarsLonLat,
  getHistoricRoverById,
  sampleProceduralSiteHeightM,
  scatterHistoricRoverCoords,
} from "../shared/mars-rovers.js";
import {
  DRIVABLE_VEHICLES,
  ROVER_FLIGHT_G,
  computeSpawnBesideOffset,
  createExperimentalRover,
  getDrivableVehicleSpec,
  resolveRoverObbCollision,
  stepAdvancedRoverPhysics,
  stepRoverBallisticPhysics,
} from "../hud/experimental-rover.js";
import { HABITAT_ZONES, createMarsHabitatStation } from "../hud/mars-habitat.js";
import {
  RT_HEIGHT_GLSL,
  RT_LENS_PARS_GLSL,
  buildHeightfieldRtData,
  createRayTracerUniforms,
} from "../hud/ray-tracer.js";
import { createMartianPbrTextureSets } from "../map/MarsPbrTextures.js";
import { buildMarsTerrainTilePayload } from "../map/TerrainMeshBuilder.js";
import { TerrainWorkerPool } from "../map/TerrainWorkerPool.js";
import {
  ProviderCircuitBreaker,
  TileLRUCache,
  TileSourceRegistry,
} from "../map/TileSourceRegistry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, "..");

test("TileSourceRegistry cascades 429/503 providers cleanly and trips circuit breaker", async () => {
  const calls = [];
  let now = 1000;
  const mockFetch = async (url) => {
    calls.push(url);
    if (url.includes("astro.arcgis.com")) {
      return { ok: false, status: 429 };
    }
    if (url.includes("CTX_beta01")) {
      return { ok: false, status: 503 };
    }
    if (url.includes("THEMIS_DayIR")) {
      const buf = new Uint8Array([1, 2, 3, 4]).buffer;
      return { ok: true, status: 200, arrayBuffer: async () => buf };
    }
    return { ok: false, status: 404 };
  };

  const reg = new TileSourceRegistry({
    demoSafe: false,
    fetchImpl: mockFetch,
    breakerOptions: { baseCooldownMs: 10000, nowFn: () => now },
  });

  const chain = reg.getImageryCascade("onmars-ctx");
  // The dead Trek CTX path (404) is no longer part of the default cascade.
  assert.ok(!chain.includes("trek-ctx"));
  const res = await reg.fetchWithCascade(chain, { eqZ: 4, col: 28, row: 8 });
  assert.equal(res.providerId, "themis-day");
  assert.equal(calls.length, 2);

  // Immediately query neighbor tile: the onmars-ctx circuit is OPEN, so it is skipped without a fetch.
  assert.equal(reg.breaker.getState("onmars-ctx").state, "OPEN");

  // An explicit trek-ctx cascade still trips its own breaker on 503.
  await reg.fetchWithCascade(["trek-ctx", "themis-day"], { eqZ: 4, col: 30, row: 8 });
  assert.equal(reg.breaker.getState("trek-ctx").state, "OPEN");
  const before = calls.length;

  const res2 = await reg.fetchWithCascade(chain, { eqZ: 4, col: 29, row: 8 });
  assert.equal(res2.providerId, "themis-day");
  assert.equal(calls.length, before + 1); // Only 1 new call straight to themis-day!

  // Advance clock past cooldown -> HALF_OPEN allows re-probing
  now += 20000;
  assert.equal(reg.breaker.canAttempt("onmars-ctx"), true);
  assert.equal(reg.breaker.getState("onmars-ctx").state, "HALF_OPEN");
});

test("Singleflight request coalescing & isolated AbortSignal cancellation", async () => {
  let networkCount = 0;
  let resolveFetch;
  const pendingPromise = new Promise((r) => {
    resolveFetch = r;
  });

  const reg = new TileSourceRegistry({
    demoSafe: false,
    fetchImpl: async () => {
      networkCount++;
      return pendingPromise;
    },
  });

  const c1 = new AbortController();
  const c2 = new AbortController();

  const p1 = reg.fetchSingleflight("k1", "https://example.org/tile.png", {
    providerId: "onmars-ctx",
    signal: c1.signal,
  });
  const p2 = reg.fetchSingleflight("k1", "https://example.org/tile.png", {
    providerId: "onmars-ctx",
    signal: c2.signal,
  });

  // Abort caller 1 BEFORE network completes; caller 2 MUST still resolve normally!
  c1.abort();
  await assert.rejects(p1, { name: "AbortError" });

  resolveFetch({
    ok: true,
    status: 200,
    arrayBuffer: async () => new Uint8Array([9, 8, 7]).buffer,
  });

  const out2 = await p2;
  assert.equal(networkCount, 1);
  assert.equal(out2.data.byteLength, 3);
});

test("TileLRUCache enforces byte budget while keeping pinned active tiles untouched", () => {
  const evicted = [];
  const cache = new TileLRUCache(1000, (key) => evicted.push(key));

  cache.set("tile_a", { id: "a" }, 400);
  cache.set("tile_b", { id: "b" }, 400);
  cache.pin("tile_a"); // Active viewport tile must survive LRU eviction

  cache.set("tile_c", { id: "c" }, 400); // Total 1200 > 1000 -> evicts tile_b, keeps tile_a
  assert.equal(cache.has("tile_a"), true);
  assert.equal(cache.has("tile_b"), false);
  assert.equal(cache.has("tile_c"), true);
  assert.deepEqual(evicted, ["tile_b"]);
});

test("TileSourceRegistry in demoSafe mode performs ZERO external fetches and resolves local THEMIS cache", async () => {
  let externalFetched = 0;
  const themisMeta = JSON.parse(
    fs.readFileSync(path.resolve(WEB_DIR, "../data/demo/layers-themis.json"), "utf8")
  );
  const reg = new TileSourceRegistry({
    demoSafe: true,
    themisMetadata: themisMeta,
    fetchImpl: async (url) => {
      if (url.startsWith("http")) externalFetched++;
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(16) };
    },
  });

  // Live HTTPS URLs MUST return null
  assert.equal(reg.resolveEquirectTileUrl("onmars-ctx", 6, 112, 33), null);
  assert.equal(reg.resolveEquirectTileUrl("mola-color", 4, 28, 8), null);

  // Cached Gale THEMIS tile resolves locally
  const localHit = reg.resolveEquirectTileUrl("themis-day", 6, 112, 33);
  assert.ok(localHit && localHit.isLocal);
  assert.match(localHit.url, /z6_r33_c112\.png$/);

  await assert.rejects(
    reg.fetchSingleflight("ext", "https://trek.nasa.gov/bad.png", { providerId: "mola-color" }),
    { demoBlocked: true }
  );
  assert.equal(externalFetched, 0);
});

test("DEM void filling, border-clamped analytical normal map, skirt geometry, and TerrainWorkerPool fallback", async () => {
  // Inject NaN voids into grid and verify smooth interpolation removal
  const grid = new Float32Array(25);
  for (let i = 0; i < 25; i++) grid[i] = -3600 + i;
  grid[12] = Number.NaN;
  grid[6] = Number.NaN;
  const { filled, holeCountBefore, holeCountAfter } = fillElevationVoids(grid, 5, 5, 8);
  assert.equal(holeCountBefore, 2);
  assert.equal(holeCountAfter, 0);
  assert.ok(Number.isFinite(filled[12]) && filled[12] > -3600 && filled[12] < -3575);

  const dem = MarsDemSampler.createSyntheticGale(32, 32);
  const b = {
    west: dem.bounds.west_lon_deg,
    south: dem.bounds.south_lat_deg,
    east: dem.bounds.east_lon_deg,
    north: dem.bounds.north_lat_deg,
  };
  const midLon = (b.west + b.east) * 0.5;
  const midLat = (b.south + b.north) * 0.5;
  const origin = makeLocalTangentOrigin(midLon, midLat, -3650);

  // Adjacent East-West tiles MUST share matching vertical boundary slope/normals on seam
  const leftBounds = { ...b, east: midLon };
  const rightBounds = { ...b, west: midLon };
  const leftTile = buildMarsTerrainTilePayload({
    demSampler: dem,
    bounds: leftBounds,
    rtcOrigin: origin,
    segments: 16,
    normalTexSize: 16,
  });
  const rightTile = buildMarsTerrainTilePayload({
    demSampler: dem,
    bounds: rightBounds,
    rtcOrigin: origin,
    segments: 16,
    normalTexSize: 16,
  });

  // Check vertex position continuity along shared seam (row 8)
  const cols = 17;
  const leftSeamIdx = 8 * cols + 16;
  const rightSeamIdx = 8 * cols + 0;
  assert.ok(
    Math.abs(leftTile.positions[leftSeamIdx * 3 + 1] - rightTile.positions[rightSeamIdx * 3 + 1]) < 0.01
  );
  // Check skirts exist beyond interior vertices
  assert.equal(leftTile.positions.length / 3, 17 * 17 + 17 * 4);
  assert.ok(leftTile.normalMapRgba.length === 16 * 16 * 4);

  // WorkerPool main-thread fallback supports AbortSignal cancellation cleanly
  const pool = new TerrainWorkerPool({ forceMainThread: true });
  await pool.initDem(dem, { lonDeg: midLon, latDeg: midLat, elevM: -3650 });
  const ac = new AbortController();
  const buildPromise = pool.buildTile({ tileKey: "0/0/0", bounds: b, segments: 12, normalTexSize: 16 }, { signal: ac.signal });
  ac.abort();
  await assert.rejects(buildPromise, { name: "AbortError" });
  pool.dispose();
});

test("Static BUG-12 & BUG-14 regression checks on web/index.html & web/shared/data-loader.js", () => {
  const html = fs.readFileSync(path.join(WEB_DIR, "index.html"), "utf8");
  assert.equal(html.includes("unpkg.com"), false, "index.html must not depend on unpkg.com");
  assert.ok(fs.existsSync(path.join(WEB_DIR, "vendor/three.module.js")));
  assert.ok(fs.existsSync(path.join(WEB_DIR, "vendor/maplibre-gl.js")));
  assert.ok(fs.existsSync(path.join(WEB_DIR, "vendor/maplibre-gl.css")));

  const loader = fs.readFileSync(path.join(WEB_DIR, "shared/data-loader.js"), "utf8");
  assert.match(loader, /terrainBase = demoSafe \? `\$\{base\}\/data\/demo`/);
  assert.equal(/orthoPreviewUrl:[^\n]*data\/processed/.test(loader), false, "ortho must follow terrainBase (data/demo in ?demo=1)");
});

test("MarsPbrTextures synthesizes high-contrast offline PBR albedo + normals and shader uses logdepthbuf + albedo", () => {
  const mockTHREE = {
    DataTexture: class {
      constructor(data, width, height, format) {
        this.data = data;
        this.width = width;
        this.height = height;
        this.format = format;
      }
    },
    RGBAFormat: 1023,
    RepeatWrapping: 1000,
    LinearMipmapLinearFilter: 1008,
    LinearFilter: 1006,
    SRGBColorSpace: "srgb",
  };
  const { dustAlbedoTex, dustNormalTex, rockAlbedoTex, rockNormalTex } = createMartianPbrTextureSets(mockTHREE, 256);

  for (const [label, tex] of [
    ["dustAlbedoTex", dustAlbedoTex],
    ["rockAlbedoTex", rockAlbedoTex],
  ]) {
    assert.equal(tex.width, 256);
    assert.equal(tex.height, 256);
    assert.equal(tex.data.length, 256 * 256 * 4);
    let min = 255;
    let max = 0;
    for (let i = 0; i < tex.data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const v = tex.data[i + c];
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    assert.ok(min < 100 && max > 180, `${label} must be high-contrast textured (min=${min}, max=${max})`);
  }

  for (const [label, tex] of [
    ["dustNormalTex", dustNormalTex],
    ["rockNormalTex", rockNormalTex],
  ]) {
    assert.equal(tex.data.length, 256 * 256 * 4);
    let minX = 255;
    let maxX = 0;
    for (let i = 0; i < tex.data.length; i += 4) {
      if (tex.data[i] < minX) minX = tex.data[i];
      if (tex.data[i] > maxX) maxX = tex.data[i];
    }
    assert.ok(maxX - minX > 40, `${label} must vary in tangent normal X (delta=${maxX - minX})`);
  }

  const shaderSrc = fs.readFileSync(path.join(WEB_DIR, "map/MarsTerrainShader.js"), "utf8");
  for (const token of [
    "#include <common>",
    "#include <logdepthbuf_pars_vertex>",
    "#include <logdepthbuf_vertex>",
    "#include <logdepthbuf_pars_fragment>",
    "#include <logdepthbuf_fragment>",
    "u_dustAlbedo",
    "u_rockAlbedo",
  ]) {
    assert.equal(shaderSrc.includes(token), true, `MarsTerrainShader.js must include ${token}`);
  }
});

test("TileSourceRegistry substitutes THEMIS WMTS template params online and resolves ancestor tiles in demoSafe mode", () => {
  const themisMeta = JSON.parse(
    fs.readFileSync(path.resolve(WEB_DIR, "..", "data/demo/layers-themis.json"), "utf8")
  );

  const onlineReg = new TileSourceRegistry({
    demoSafe: false,
    themisMetadata: themisMeta,
    demoTileBaseUrl: "../data/demo/themis",
  });
  const onlineRes = onlineReg.resolveEquirectTileUrl("themis-day", 9, 902, 268);
  assert.ok(onlineRes);
  assert.equal(onlineRes.isLocal, false);
  assert.equal(onlineRes.url.includes("{Style}"), false);
  assert.equal(onlineRes.url.includes("{TileMatrixSet}"), false);
  assert.equal(onlineRes.url.includes("1.0.0//"), false);
  assert.ok(onlineRes.url.includes("/1.0.0/default/default028mm/9/268/902.png"));

  const demoReg = new TileSourceRegistry({
    demoSafe: true,
    themisMetadata: themisMeta,
    demoTileBaseUrl: "../data/demo/themis",
  });
  // Exact eqZ=8 tile (col=451, row=134) should satisfy intermediate eqZ=9 Gale tile (col=902, row=268)
  const ancestorRes = demoReg.resolveEquirectTileUrl("themis-day", 9, 902, 268);
  assert.ok(ancestorRes);
  assert.equal(ancestorRes.isLocal, true);
  assert.equal(ancestorRes.eqZ, 8);
  assert.equal(ancestorRes.col, 451);
  assert.equal(ancestorRes.row, 134);
  assert.ok(ancestorRes.url.endsWith("/day/z8_r134_c451.png"));
});

test("MarsDemSampler smoothly tapers outside HiRISE bounds without extruded edge streaks", () => {
  const dem = MarsDemSampler.createSyntheticGale(32, 32);
  // Tile overlapping east of Gale bounds at z=12 (x=3611, y=2102 crosses ~137.46 E..137.55 E outside HiRISE)
  const rgba = dem.rasterizeTerrariumTileRGBA(12, 3612, 2102, 32, dem.minElevM - 20);
  // Two pixels well beyond fadeDeg (top-left vs bottom-right of that eastern tile) must match evenly
  const iA = 0;
  const iB = (31 * 32 + 31) * 4;
  const hA = decodeTerrariumPixel(rgba[iA], rgba[iA + 1], rgba[iA + 2]);
  const hB = decodeTerrariumPixel(rgba[iB], rgba[iB + 1], rgba[iB + 2]);
  assert.ok(Math.abs(hA - hB) < 0.05, `far outside terrain must settle smoothly (diff=${Math.abs(hA - hB)})`);
});

test("dev-settings normalizeDevSettings clamps bounds and preserves flags cleanly", () => {
  const clean = normalizeDevSettings({
    frameEffect: false,
    frameStrength: 9,
    speedMultiplier: 12,
    roverSpeedMultiplier: 9.5,
    ...FULL_REALISM_PRESET,
    realisticDust: false,
    realisticPhysics: false,
    realisticWeather: false,
    dustTau: 10,
    dustDevil: true,
    fov: 15,
    cleanHud: true,
  });
  assert.equal(clean.frameEffect, false);
  assert.equal(clean.frameStrength, 1.5);
  assert.equal(clean.speedMultiplier, 8.0);
  assert.equal(clean.roverSpeedMultiplier, 4.0);
  assert.equal(clean.superGraphics, true);
  assert.equal(clean.rayTracing, true);
  assert.equal(clean.experimentalRover, true);
  assert.equal(clean.realisticTextures, true);
  assert.equal(clean.realisticDust, false);
  assert.equal(clean.realisticPhysics, false);
  assert.equal(clean.realisticWeather, false);
  assert.equal(clean.dustTau, 3);
  assert.equal(clean.dustDevil, true);
  assert.equal(clean.fov, 60);
  assert.equal(clean.cleanHud, true);
  const defs = normalizeDevSettings();
  assert.equal(defs.frameStrength, 0.2);
  assert.equal(defs.speedMultiplier, DEFAULT_DEV_SETTINGS.speedMultiplier);
  assert.equal(defs.roverSpeedMultiplier, 1.0);
  assert.equal(defs.rayTracing, false);
  assert.equal(defs.experimentalRover, false);
  assert.equal(defs.realisticTextures, false);
  assert.equal(defs.realisticDust, true);
  assert.equal(defs.realisticPhysics, true);
  assert.equal(defs.realisticWeather, true);
  assert.equal(defs.dustTau, 0.5);
  assert.equal(defs.dustDevil, false);
  assert.equal(normalizeDevSettings({ dustTau: 0.05 }).dustTau, 0.35);
});

test("ray-tracer packs 16-bit mirrored heightfield accurately and exposes GLSL kernels", () => {
  const sampleFn = (x, z) => 12.0 + Math.sin(x * 0.03) * 8.0 + Math.cos(z * 0.02) * 5.0;
  const packed = buildHeightfieldRtData(sampleFn, 100, 100, 32);
  assert.equal(packed.width, 64);
  assert.equal(packed.height, 64);
  assert.equal(packed.data.length, 64 * 64 * 4);
  assert.ok(packed.span >= 1);

  // Decode center vs mirrored column across tile seam (col 31 vs col 32)
  const decodeAt = (row, col) => {
    const o = (row * 64 + col) * 4;
    const val16 = (packed.data[o] * 256 + packed.data[o + 1]) / 65535;
    return packed.minH + val16 * packed.span;
  };
  assert.ok(Math.abs(decodeAt(10, 31) - decodeAt(10, 32)) < 0.02, "mirrored tile edge must be C0 continuous");
  assert.ok(Math.abs(decodeAt(31, 12) - decodeAt(32, 12)) < 0.02, "mirrored row edge must be C0 continuous");

  assert.match(RT_HEIGHT_GLSL, /rtTraceShadow/);
  assert.match(RT_HEIGHT_GLSL, /rtTraceGI/);
  assert.match(RT_HEIGHT_GLSL, /rtTraceReflectionRay/);
  assert.match(RT_LENS_PARS_GLSL, /rtScreenSpacePass/);
  assert.match(RT_LENS_PARS_GLSL, /rtFxaaSample/);

  const mockThree = { Vector2: class { constructor(x = 0, y = 0) { this.x = x; this.y = y; } } };
  const uniforms = createRayTracerUniforms(mockThree, 100, 100, { clone: () => ({ x: 0.6, y: 0.5, z: 0.6 }) }, {
    texture: {},
    width: 64,
    height: 64,
    minH: packed.minH,
    span: packed.span,
  });
  assert.equal(uniforms.uRtEnabled.value, 0);
  assert.equal(uniforms.uRtOrigin.value.x, -50);
  assert.equal(uniforms.uRtPeriod.value.x, 200);
});

test("bundled offline NASA MMSEV rover GLB asset is a valid binary", () => {
  for (const relPath of ["assets/nasa-3d/mmsev-rover.glb"]) {
    const abs = path.join(WEB_DIR, relPath);
    assert.equal(fs.existsSync(abs), true, `Missing offline GLB asset: ${relPath}`);
    const fd = fs.openSync(abs, "r");
    const hdr = Buffer.alloc(4);
    fs.readSync(fd, hdr, 0, 4, 0);
    fs.closeSync(fd);
    assert.equal(hdr.toString("ascii"), "glTF", `${relPath} must have valid glTF binary header`);
  }
});

test("experimental-rover computeSpawnBesideOffset places rover forward-right relative to walker yaw", () => {
  const zeroYaw = computeSpawnBesideOffset(10, 20, 0, 3.4, 2.4);
  assert.ok(Math.abs(zeroYaw.x - 13.4) < 1e-6);
  assert.ok(Math.abs(zeroYaw.z - 17.6) < 1e-6);

  const turned90 = computeSpawnBesideOffset(0, 0, Math.PI / 2, 3.4, 2.4);
  // yaw=+90deg faces -X, right is -Z
  assert.ok(Math.abs(turned90.x - -2.4) < 1e-6);
  assert.ok(Math.abs(turned90.z - -3.4) < 1e-6);
});

test("resolveRoverObbCollision keeps nose, sides, corners, and wheel pods solid at any rotation", () => {
  // Approaching straight at front cantilevered cockpit (-Z) inside hull edge
  const frontHit = resolveRoverObbCollision(0, 0, 0, 0, 0.2, -2.5, 0.42, 0.0);
  assert.equal(frontHit.hit, true);
  assert.ok(frontHit.z <= -2.42 - 0.42 + 1e-6, `Expected front push outside -2.84m, got ${frontHit.z}`);

  // Approaching diagonal wheel pod corner under 45-degree rover rotation
  const cornerRot = resolveRoverObbCollision(10, 20, Math.PI / 4, 5.0, 10 + 2.8, 20 + 0.1, 0.42, 5.2);
  assert.equal(cornerRot.hit, true);
  assert.ok(cornerRot.pen > 0);
  const recheck = resolveRoverObbCollision(10, 20, Math.PI / 4, 5.0, cornerRot.x, cornerRot.z, 0.42, 5.2);
  assert.equal(recheck.hit, false);

  // Far clear position does not trigger collision
  const miss = resolveRoverObbCollision(0, 0, 0, 0, 5.0, 5.0, 0.42, 0.0);
  assert.equal(miss.hit, false);

  // High jump above rover roof clears cleanly
  const highJump = resolveRoverObbCollision(0, 0, 0, 0, 0.0, 0.0, 0.42, 4.0);
  assert.equal(highJump.hit, false);
});

test("stepRoverBallisticPhysics keeps normal driving planted and launches fast crests crisply without floaty hang", () => {
  const s = { posY: 0, velY: 0, prevGroundY: 0, airborne: false, airTime: 0, peakLaunchVy: 0, landingCooldown: 0 };
  const slow = stepRoverBallisticPhysics(s, { groundY: 0.04, slopeClimbVy: 0.4, horizSpeed: 2.0, dt: 0.016 });
  assert.equal(slow.launched, false);
  assert.equal(s.airborne, false);

  // Moderate turn/ripple stays planted cleanly without false bounce
  const ripple = stepRoverBallisticPhysics(s, { groundY: 0.08, slopeClimbVy: 1.5, horizSpeed: 9.0, dt: 0.016 });
  assert.equal(ripple.launched, false);

  // Fast ramp climb stays gripped, then launches airborne crisply at the crest dropoff
  const ramp = stepRoverBallisticPhysics(s, { groundY: 0.17, slopeClimbVy: 6.0, horizSpeed: 18.0, dt: 0.016 });
  assert.equal(ramp.launched, false);
  const crest = stepRoverBallisticPhysics(s, { groundY: 0.0, slopeClimbVy: 0.0, horizSpeed: 18.0, dt: 0.016 });
  assert.equal(crest.launched, true);
  assert.equal(s.airborne, true);
  assert.ok(s.velY >= 1.8 && s.velY <= 2.6);

  let landedStep = null;
  let totalAirTime = 0;
  for (let i = 0; i < 120; i++) {
    const res = stepRoverBallisticPhysics(s, {
      groundY: 0.1,
      horizSpeed: 18.0,
      dt: 0.016,
      marsG: ROVER_FLIGHT_G,
    });
    totalAirTime += 0.016;
    if (res.landed) {
      landedStep = res;
      break;
    }
  }
  assert.ok(landedStep && landedStep.landed, "Rover must return promptly to terrain");
  assert.ok(totalAirTime < 1.0, `Airtime should stay crisp (<1.0s), got ${totalAirTime.toFixed(2)}s`);
  assert.equal(s.airborne, false);
  assert.ok(s.landingCooldown > 0.1, "Shock cooldown should prevent instant trampoline re-bounce");
  assert.ok(landedStep.impactSpeed > 1.8);

  // Landing shock cooldown settles before next violent whip impulse can launch
  const blockedImmediately = stepRoverBallisticPhysics(s, {
    groundY: 0.1,
    bumpImpulseVy: 3.6,
    horizSpeed: 14.0,
    dt: 0.016,
  });
  assert.equal(blockedImmediately.launched, false);

  s.landingCooldown = 0;
  const whip = stepRoverBallisticPhysics(s, {
    groundY: 0.1,
    bumpImpulseVy: 3.6,
    horizSpeed: 14.0,
    dt: 0.016,
  });
  assert.equal(whip.launched, true);
  assert.equal(s.airborne, true);
});

test("MARS_HISTORIC_ROVERS defines all 5 unique Mars rovers at separated real Martian coordinates + valid Perseverance GLB", () => {
  assert.equal(MARS_HISTORIC_ROVERS.length, 5);
  const expectedIds = ["sojourner", "spirit", "opportunity", "curiosity", "perseverance"];
  assert.deepEqual(
    MARS_HISTORIC_ROVERS.map((r) => r.id),
    expectedIds
  );

  for (let i = 0; i < MARS_HISTORIC_ROVERS.length; i++) {
    const a = MARS_HISTORIC_ROVERS[i];
    assert.ok(a.lat >= -90 && a.lat <= 90, `${a.id} valid lat`);
    assert.ok(a.lon >= -180 && a.lon <= 180, `${a.id} valid lon`);
    assert.equal(getHistoricRoverById(a.id)?.name, a.name);
    assert.ok(formatMarsLonLat(a.lon, a.lat).includes("°"));
    for (let j = i + 1; j < MARS_HISTORIC_ROVERS.length; j++) {
      const b = MARS_HISTORIC_ROVERS[j];
      const distKm = computeRoverSurfaceDistanceKm(a, b);
      assert.ok(distKm > 1000, `${a.id} and ${b.id} must be far apart on Mars (got ${distKm.toFixed(0)} km)`);
    }
  }

  const fc = buildHistoricRoversGeoJson();
  assert.equal(fc.type, "FeatureCollection");
  assert.equal(fc.features.length, 5);

  // Gale site defers completely to real HiRISE DTM; off-Gale sites generate deterministic relief
  assert.equal(sampleProceduralSiteHeightM("curiosity", 120, -80), 0);
  assert.notEqual(sampleProceduralSiteHeightM("perseverance", 260, 180), 0);

  // Bundled NASA Perseverance GLB starts with valid binary glTF magic header
  const glbPath = path.join(WEB_DIR, "assets", "nasa-3d", "mars-2020-perseverance.glb");
  assert.equal(fs.existsSync(glbPath), true, "Expected mars-2020-perseverance.glb on disk");
  const head = fs.readFileSync(glbPath).subarray(0, 4).toString("ascii");
  assert.equal(head, "glTF");
});

test("scatterHistoricRoverCoords spreads all 5 unique rovers safely across walkable terrain", () => {
  let seed = 42;
  const detRng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // Mild crater undulations (< 16 deg slope everywhere except small local bump)
  const gentleDem = (x, z) => Math.sin(x * 0.02) * 1.6 + Math.cos(z * 0.018) * 1.4;
  const placements = scatterHistoricRoverCoords({
    sampleElevY: gentleDem,
    worldW: 1980,
    worldH: 1980,
    originX: 0,
    originZ: 0,
    minSepM: 52,
    maxSlopeDeg: 16,
    rng: detRng,
  });
  assert.equal(placements.length, 5);
  const seen = new Set(placements.map((p) => p.id));
  assert.equal(seen.size, 5);

  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    assert.ok(Math.hypot(p.x, p.z) >= 28, `${p.id} must clear start mast`);
    assert.ok(p.slopeDeg <= 16.5, `${p.id} slope (${p.slopeDeg.toFixed(1)}°) should be safe`);
    for (let j = i + 1; j < placements.length; j++) {
      const q = placements[j];
      const sep = Math.hypot(p.x - q.x, p.z - q.z);
      assert.ok(sep >= 50, `${p.id} and ${q.id} too close (${sep.toFixed(1)} m)`);
    }
  }
});

test("drivable vehicle registry includes NASA MMSEV and NASA Mars Rover Concept", () => {
  assert.equal(DRIVABLE_VEHICLES.length, 2);
  assert.equal(DRIVABLE_VEHICLES[0].id, "mmsev");
  assert.equal(DRIVABLE_VEHICLES[1].id, "nasa_concept");
  assert.equal(getDrivableVehicleSpec("mmsev").shortLabel, "MMSEV 6×6");
  assert.equal(getDrivableVehicleSpec("nasa_concept").shortLabel, "MARS CONCEPT");
  assert.equal(getDrivableVehicleSpec("anything-else").id, "mmsev");
  assert.equal(DEFAULT_DEV_SETTINGS.roverSpeedMultiplier, 1.0);
  assert.equal(normalizeDevSettings({ roverSpeedMultiplier: 2.5 }).roverSpeedMultiplier, 2.5);
});

test("stepAdvancedRoverPhysics simulates acceleration, gearbox shifts, handbrake drift slip, and flight trim", () => {
  const s = {
    yaw: 0,
    yawRate: 0,
    velX: 0,
    velZ: 0,
    forwardSpeed: 0,
    lateralSpeed: 0,
    slipRatio: 0,
    gear: 1,
    rpmNorm: 0,
    drifting: false,
    braking: false,
    airPitchVel: 0,
    airRollVel: 0,
    airPitchOffset: 0,
    airRollOffset: 0,
    lastSlopePitch: 0,
  };

  let res = null;
  for (let i = 0; i < 65; i++) {
    res = stepAdvancedRoverPhysics(s, {
      vehicleType: "mmsev",
      throttle: 1,
      steer: 0,
      boost: true,
      speedMultiplier: 1.0,
      dt: 0.02,
    });
  }
  assert.ok(res.vFwd > 10, `MMSEV should accelerate crisply (got ${res.vFwd.toFixed(2)} m/s)`);
  assert.ok(res.gear >= 3, `Expected higher gear at speed (got Gear ${res.gear})`);

  // Engage handbrake powerslide drift + sharp steer
  for (let i = 0; i < 12; i++) {
    res = stepAdvancedRoverPhysics(s, {
      vehicleType: "mmsev",
      throttle: 1,
      steer: 1,
      handbrake: true,
      dt: 0.02,
    });
  }
  assert.equal(res.drifting, true, "Handbrake + steer at speed must induce powerslide drift");
  assert.ok(res.slipRatio > 0.2, `Drift must produce lateral slip ratio (got ${res.slipRatio.toFixed(2)})`);
  assert.ok(Math.abs(s.yaw) > 0.15, "Cornering drift must rotate heading yaw");

  // Mid-air attitude reaction trim
  const airOut = stepAdvancedRoverPhysics(s, {
    vehicleType: "mmsev",
    throttle: 1,
    steer: -1,
    airborne: true,
    dt: 0.05,
  });
  assert.equal(airOut.drifting, false);
  assert.ok(s.airPitchVel !== 0 || s.airRollVel !== 0);
});

test("all 5 historic rovers (curiosity, sojourner, spirit, opportunity, perseverance) build complete rigs and articulate cleanly", () => {
  const orderedIds = ["curiosity", "sojourner", "spirit", "opportunity", "perseverance"];
  for (const id of orderedIds) {
    const spec = getHistoricRoverById(id);
    assert.ok(spec, `Expected spec for ${id}`);
    const grp = createHistoricRoverGroup(THREE, null, spec);
    const rig = grp.userData?.rig;
    assert.ok(rig, `${id} must expose userData.rig`);
    assert.ok(rig.chassis, `${id} rig must have chassis`);
    assert.ok(rig.rockerL && rig.rockerR, `${id} rig must have rockerL and rockerR`);
    assert.ok(rig.bogieL && rig.bogieR, `${id} rig must have bogieL and bogieR`);
    assert.ok(rig.diffBar, `${id} rig must have diffBar`);
    assert.equal(rig.wheels.length, 6, `${id} rig must have 6 wheel spin pivots`);
    assert.equal(rig.steerKnuckles.length, 4, `${id} rig must have 4 corner steering knuckles`);
    assert.ok(rig.mastYaw && rig.mastPitch, `${id} rig must have mastYaw and mastPitch`);
    assert.ok(rig.hgaYaw && rig.hgaPitch, `${id} rig must have hgaYaw and hgaPitch`);
    assert.ok(rig.arm?.shoulderYaw && rig.arm?.shoulderPitch && rig.arm?.elbowPitch, `${id} rig must have hierarchical arm joints`);
    assert.ok(rig.arm?.wristPitch && rig.arm?.turretRoll && rig.arm?.toolSpin, `${id} rig must have wrist/turret/tool joints`);

    const initMastY = rig.mastYaw.rotation.y;
    const initWheelX = rig.wheels[0].rotation.x;
    const initArmYaw = rig.arm.shoulderYaw.rotation.y;
    const initToolZ = rig.arm.toolSpin.rotation.z;

    for (let i = 0; i < 20; i++) {
      stepRoverRigKinematics(rig, {
        dt: 0.05,
        clockT: 1.5 + i * 0.05,
        relObserverX: 4.5,
        relObserverY: 0.6,
        relObserverZ: -6.0,
        wheelDeltaHeights: [0.18, 0.04, -0.14, -0.12, 0.0, 0.14],
        driveSpeed: 0.4,
        steerAngle: 0.25,
      });
    }

    assert.notEqual(rig.mastYaw.rotation.y, initMastY, `${id} mastYaw must articulate`);
    assert.notEqual(rig.wheels[0].rotation.x, initWheelX, `${id} wheels must spin`);
    assert.notEqual(rig.arm.shoulderYaw.rotation.y, initArmYaw, `${id} arm must articulate`);
    assert.notEqual(rig.arm.toolSpin.rotation.z, initToolZ, `${id} toolSpin must rotate`);
    assert.ok(Math.abs(rig.rockerL.rotation.x) > 0.01, `${id} rockerL must flex with wheel terrain deltas`);
    assert.ok(Math.abs(rig.steerKnuckles[0].rotation.y) > 0.05, `${id} corner steering knuckle must turn`);
  }
});

test("resolveRoverObbCollision returns finite push-out when entity center lies inside the OBB", () => {
  for (const [ex, ez] of [
    [10, 20],
    [10.25, 19.7],
    [9.4, 20.6],
  ]) {
    const res = resolveRoverObbCollision(10, 20, -0.43, 0, ex, ez, 0.45, 0, 1.45, 1.55);
    assert.equal(res.hit, true);
    assert.ok(Number.isFinite(res.x), "resolved x must be finite");
    assert.ok(Number.isFinite(res.z), "resolved z must be finite");
    assert.ok(Number.isFinite(res.nx), "resolved nx must be finite");
    assert.ok(Number.isFinite(res.nz), "resolved nz must be finite");
    assert.ok(Number.isFinite(res.pen) && res.pen > 0, "resolved pen must be positive and finite");
  }
});

test("NASA Mars Rover Concept builds rigged 6x6 hollow wheels and drives with physics", () => {
  const concept = createExperimentalRover(THREE, "nasa_concept");
  assert.equal(concept.vehicleType, "nasa_concept");
  assert.equal(concept.getActiveSpec().id, "nasa_concept");
  assert.ok(concept.radius >= 3.0);

  concept.group.position.set(7.2, 0, 25);
  concept.update(0.1, {
    sampleElevY: (x, z) => Math.sin(x * 0.25) * 0.12 + Math.cos(z * 0.2) * 0.08,
    speed: 14,
    steer: 0.55,
    driving: true,
    physicsEnabled: true,
  });
  assert.ok(Number.isFinite(concept.group.position.y));
  const hit = concept.resolveCollision(7.4, 25.2, 0.45, 0);
  assert.equal(hit.hit, true);

  const dynState = {
    yaw: 0,
    yawRate: 0,
    velX: 0,
    velZ: 0,
    forwardSpeed: 0,
    lateralSpeed: 0,
    slipRatio: 0,
    gear: 1,
    rpmNorm: 0,
    drifting: false,
    braking: false,
    airPitchVel: 0,
    airRollVel: 0,
    airPitchOffset: 0,
    airRollOffset: 0,
    lastSlopePitch: 0,
  };
  const step = stepAdvancedRoverPhysics(dynState, {
    vehicleType: "nasa_concept",
    throttle: 1,
    steer: -0.35,
    boost: true,
    realisticPhysics: true,
    dt: 0.05,
  });
  assert.equal(step.spec.id, "nasa_concept");
  assert.ok(step.vFwd > 0);
});

test("Mars Habitat Station builds 5 zones, 7 bay/lane placements, elevated dorm deck, and walkable openings", () => {
  assert.equal(HABITAT_ZONES.length, 5);
  const hab = createMarsHabitatStation(THREE, { originX: 0, originZ: 0, rawSampleElevY: () => 1.5 });
  const zoneNames = new Set(hab.group.children.map((c) => c.name));
  for (const z of HABITAT_ZONES) {
    assert.ok(zoneNames.has(z.id), `Missing habitat zone ${z.id}`);
  }

  const bays = hab.getBayPlacements();
  assert.deepEqual(
    bays.historicPlacements.map((p) => p.id),
    ["sojourner", "spirit", "opportunity", "curiosity", "perseverance"]
  );
  assert.deepEqual(
    bays.drivablePlacements.map((p) => p.vehicleType),
    ["mmsev", "nasa_concept"]
  );

  // Pad levels ground around baseY=1.5 and Dormitory raises +0.8m to 2.3m
  assert.ok(Math.abs(hab.sampleElevWithHabitat(0, 10, 4.0) - 1.5) < 0.05);
  assert.ok(Math.abs(hab.sampleElevWithHabitat(0, -21, 1.5) - 2.3) < 0.05);

  // Open center bay doorway and airlock entrance must remain unobstructed, while solid west outer wall collides
  assert.equal(hab.resolveCollision(0, 18, 0.4, 1.5).hit, false);
  assert.equal(hab.resolveCollision(27, 2, 0.4, 1.5).hit, false);
  assert.equal(hab.resolveCollision(-18, -5, 0.4, 1.5).hit, true);
});
