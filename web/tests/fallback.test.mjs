import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { makeLocalTangentOrigin } from "../map/Geodesy.js";
import { MarsDemSampler, fillElevationVoids } from "../map/MarsDemSampler.js";
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
