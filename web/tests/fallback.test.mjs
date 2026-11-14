import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { makeLocalTangentOrigin, decodeTerrariumPixel } from "../map/Geodesy.js";
import { MarsDemSampler, fillElevationVoids } from "../map/MarsDemSampler.js";
import { DEFAULT_DEV_SETTINGS, FULL_REALISM_PRESET, normalizeDevSettings } from "../shared/dev-settings.js";
import {
  MARS_GRAVITY_MS2,
  computeSpawnBesideOffset,
  resolveRoverObbCollision,
  stepRoverBallisticPhysics,
} from "../hud/experimental-rover.js";
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
  const res = await reg.fetchWithCascade(chain, { eqZ: 4, col: 28, row: 8 });
  assert.equal(res.providerId, "themis-day");
  assert.equal(calls.length, 3);

  // Immediately query neighbor tile: onmars-ctx & trek-ctx circuits are OPEN, so skipped without fetch!
  assert.equal(reg.breaker.getState("onmars-ctx").state, "OPEN");
  assert.equal(reg.breaker.getState("trek-ctx").state, "OPEN");

  const res2 = await reg.fetchWithCascade(chain, { eqZ: 4, col: 29, row: 8 });
  assert.equal(res2.providerId, "themis-day");
  assert.equal(calls.length, 4); // Only 1 new call straight to themis-day!

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
    ...FULL_REALISM_PRESET,
    realisticDust: false,
    realisticPhysics: false,
    realisticWeather: false,
    fov: 15,
    cleanHud: true,
  });
  assert.equal(clean.frameEffect, false);
  assert.equal(clean.frameStrength, 1.5);
  assert.equal(clean.speedMultiplier, 8.0);
  assert.equal(clean.superGraphics, true);
  assert.equal(clean.experimentalRover, true);
  assert.equal(clean.realisticTextures, true);
  assert.equal(clean.realisticDust, false);
  assert.equal(clean.realisticPhysics, false);
  assert.equal(clean.realisticWeather, false);
  assert.equal(clean.fov, 60);
  assert.equal(clean.cleanHud, true);
  const defs = normalizeDevSettings();
  assert.equal(defs.speedMultiplier, DEFAULT_DEV_SETTINGS.speedMultiplier);
  assert.equal(defs.experimentalRover, false);
  assert.equal(defs.realisticTextures, false);
  assert.equal(defs.realisticDust, true);
  assert.equal(defs.realisticPhysics, true);
  assert.equal(defs.realisticWeather, true);
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

test("stepRoverBallisticPhysics keeps slow crawl planted and launches high-speed crests under 3.71 m/s^2 gravity", () => {
  const s = { posY: 0, velY: 0, prevGroundY: 0, airborne: false, airTime: 0, peakLaunchVy: 0 };
  const slow = stepRoverBallisticPhysics(s, { groundY: 0.04, slopeClimbVy: 0.4, horizSpeed: 2.0, dt: 0.016 });
  assert.equal(slow.launched, false);
  assert.equal(s.airborne, false);

  // Smooth uphill ramp climb stays planted, then launches airborne at the crest dropoff
  const ramp = stepRoverBallisticPhysics(s, { groundY: 0.105, slopeClimbVy: 4.2, horizSpeed: 15.0, dt: 0.016 });
  assert.equal(ramp.launched, false);
  const crest = stepRoverBallisticPhysics(s, { groundY: 0.1, slopeClimbVy: 0.0, horizSpeed: 15.0, dt: 0.016 });
  assert.equal(crest.launched, true);
  assert.equal(s.airborne, true);
  assert.ok(s.velY >= 3.5);

  let landedStep = null;
  for (let i = 0; i < 300; i++) {
    const res = stepRoverBallisticPhysics(s, {
      groundY: 0.1,
      horizSpeed: 15.0,
      dt: 0.016,
      marsG: MARS_GRAVITY_MS2,
    });
    if (res.landed) {
      landedStep = res;
      break;
    }
  }
  assert.ok(landedStep && landedStep.landed, "Rover must return to terrain under Mars gravity");
  assert.equal(s.airborne, false);
  assert.ok(landedStep.impactSpeed > 2.5, "Touchdown should report vertical impact velocity");

  const whip = stepRoverBallisticPhysics(s, {
    groundY: 0.1,
    bumpImpulseVy: 2.6,
    horizSpeed: 11.0,
    dt: 0.016,
  });
  assert.equal(whip.launched, true);
  assert.equal(s.airborne, true);
});
