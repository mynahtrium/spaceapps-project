import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as THREE from "../vendor/three.module.js";
import {
  GaleCorridor,
  buildCorridorCellGeometry,
  buildCorridorSubCellGeometry,
  chunkSlopeRgba,
  mirrorWrap,
} from "../map/GaleCorridor.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = "data/demo/corridor";
let fetchCount = 0;
const fileFetch = async (url) => {
  fetchCount++;
  try {
    const buf = await fs.readFile(path.join(ROOT, url));
    return new Response(buf, { status: 200 });
  } catch {
    return new Response("", { status: 404 });
  }
};

const R = 3389500;
const rad = Math.PI / 180;
function sceneOf(c, lon, lat) {
  const b = c.bounds;
  const x = ((lon - b.west_lon_deg) / (b.east_lon_deg - b.west_lon_deg) - 0.5) * c.worldW;
  const z = (0.5 - (lat - b.south_lat_deg) / (b.north_lat_deg - b.south_lat_deg)) * c.worldH;
  return { x, z };
}

test("corridor manifest and overview load from local files", async () => {
  const c = await GaleCorridor.load(BASE, { fetchFn: fileFetch });
  assert.ok(c, "corridor loads");
  assert.equal(c.chunksX, 8);
  assert.equal(c.chunksZ, 21);
  assert.ok(Math.abs(c.worldW - 2065) < 5 && Math.abs(c.worldH - 5439) < 5, `world ${c.worldW} x ${c.worldH}`);
  assert.equal(c.overview.elev.length, c.overview.nx * c.overview.nz);
  // corridor size in metres matches its lon/lat span on the Mars sphere (within 1%)
  const b = c.bounds;
  const spanZ = (b.north_lat_deg - b.south_lat_deg) * rad * 3396190;
  assert.ok(Math.abs(spanZ - c.worldH) / c.worldH < 0.01);
  const missing = await GaleCorridor.load("data/demo/no-such-corridor", { fetchFn: fileFetch });
  assert.equal(missing, null, "missing corridor resolves to null (single-tile fallback)");
});

test("detail heights at the cited stops match Curiosity elevations plus the fitted datum offset", async () => {
  const c = await GaleCorridor.load(BASE, { fetchFn: fileFetch });
  const offset = c.manifest.registration.median_dtm_minus_rover_m;
  // rover elev_geoid from MSL_waypoints.json at the parked waypoint
  const stops = [
    ["Glen Etive 1 (Sol 2481)", 137.3835412, -4.73030915, -4133.36],
    ["Mary Anning 3 (Sol 2829)", 137.3911375, -4.72930656, -4128.06],
    ["habitat (Sol 4527)", 137.3875065, -4.79721368, null],
  ];
  for (const [name, lon, lat, roverElev] of stops) {
    const { x, z } = sceneOf(c, lon, lat);
    assert.equal(c.sampleDetail(x, z), null, "detail not loaded yet");
    await c.warmup(x, z, 50);
    const h = c.sampleDetail(x, z);
    assert.ok(Number.isFinite(h), `${name} detail height`);
    assert.ok(Math.abs(h - c.sampleOverview(x, z)) < 15, `${name}: detail and overview agree roughly`);
    if (roverElev !== null) assert.ok(Math.abs(h - (roverElev + offset)) < 5, `${name}: ${h.toFixed(1)} vs ${(roverElev + offset).toFixed(1)}`);
  }
});

test("heights are continuous across the mirror seam and chunk borders", async () => {
  const c = await GaleCorridor.load(BASE, { fetchFn: fileFetch });
  const eastEdge = c.worldW / 2;
  await c.warmup(eastEdge - 10, 0, 60);
  for (const dz of [-100, 0, 77]) {
    const inside = c.sampleDetail(eastEdge - 0.01, dz);
    const outside = c.sampleDetail(eastEdge + 0.01, dz);
    assert.ok(Math.abs(inside - outside) < 0.05, `seam step ${Math.abs(inside - outside)}`);
  }
  // a chunk border inside the corridor
  const border = -c.worldW / 2 + 4 * c.chunkW;
  await c.warmup(border, 0, 40);
  const l = c.sampleDetail(border - 0.001, 0);
  const r = c.sampleDetail(border + 0.001, 0);
  assert.ok(Math.abs(l - r) < 0.02, "neighbour chunks share their edge row");
  assert.equal(mirrorWrap(1.25), 0.75);
  assert.equal(mirrorWrap(-0.25), 0.25);
});

test("mirrored scene cells map to flipped data chunks", async () => {
  const c = await GaleCorridor.load(BASE, { fetchFn: fileFetch });
  assert.deepEqual(c.dataChunkForCell(0, 0), { ci: 0, cj: 0, flipX: false, flipZ: false });
  assert.deepEqual(c.dataChunkForCell(8, 0), { ci: 7, cj: 0, flipX: true, flipZ: false });
  assert.deepEqual(c.dataChunkForCell(-1, -1), { ci: 0, cj: 0, flipX: true, flipZ: true });
  assert.deepEqual(c.dataChunkForCell(16, 42), { ci: 0, cj: 0, flipX: false, flipZ: false });
});

test("cell geometry sits on the sampled ground, in real and mirrored copies", async () => {
  const c = await GaleCorridor.load(BASE, { fetchFn: fileFetch });
  const base = c.elevMin;
  for (const [a, b] of [
    [3, 16],
    [8, 16],
    [-1, 3],
  ]) {
    const { ci, cj } = c.dataChunkForCell(a, b);
    assert.equal(buildCorridorCellGeometry(THREE, c, a, b, 64, base), null, "no geometry before the data");
    await c.request(ci, cj);
    // load the neighbours too, so border vertices can be checked against the sampler
    const cx = -c.worldW / 2 + (a + 0.5) * c.chunkW;
    const cz = -c.worldH / 2 + (b + 0.5) * c.chunkH;
    await c.warmup(cx, cz, c.chunkH);
    for (const seg of [256, 64]) {
      const g = buildCorridorCellGeometry(THREE, c, a, b, seg, base);
      const pos = g.attributes.position;
      const nor = g.attributes.normal;
      const uv = g.attributes.uv;
      const nv = (seg + 1) ** 2;
      for (const k of [0, seg, Math.floor(nv / 2) + 3, nv - 1]) {
        const x = pos.getX(k);
        const z = pos.getZ(k);
        const expect = c.sampleDetail(x, z) - base;
        assert.ok(Math.abs(pos.getY(k) - expect) < 0.05, `cell ${a},${b} seg ${seg} vertex ${k}: ${pos.getY(k)} vs ${expect}`);
        assert.ok(Math.abs(Math.hypot(nor.getX(k), nor.getY(k), nor.getZ(k)) - 1) < 1e-4);
        assert.ok(nor.getY(k) > 0, "normals point up");
        assert.ok(uv.getX(k) >= 0 && uv.getX(k) <= 1 && uv.getY(k) >= 0 && uv.getY(k) <= 1);
      }
      // triangles face up (counter-clockwise from above)
      const idx = g.index.array;
      const v = (i) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      const n = new THREE.Vector3().crossVectors(v(idx[1]).sub(v(idx[0])), v(idx[2]).sub(v(idx[0])));
      assert.ok(n.y > 0, "top surface winding faces +Y");
      g.dispose();
    }
  }
  const rgba = chunkSlopeRgba(c, 3, 16, 32);
  assert.equal(rgba.length, 32 * 32 * 4);
});

test("streaming loads nearest chunks first and evicts beyond the budget", async () => {
  fetchCount = 0;
  const c = await GaleCorridor.load(BASE, { fetchFn: fileFetch, maxDetailChunks: 12, maxConcurrent: 1 }); // one at a time: load order is deterministic
  const order = [];
  c.onChunkLoaded((ci, cj) => order.push([ci, cj]));
  const here = { x: 40, z: 25 }; // inside a chunk, not on a border (ties are legitimate there)
  const wanted = c.update(here.x, here.z, 600);
  assert.ok(wanted.size >= 9 && wanted.size <= 30, `wanted ${wanted.size}`);
  await c.warmup(here.x, here.z, 600);
  const { a, b } = c.sceneCellOf(here.x, here.z);
  const first = c.dataChunkForCell(a, b);
  assert.deepEqual(order[0], [first.ci, first.cj], "the walker's own chunk loads first");
  assert.ok(c.cellDistance(a, b, here.x, here.z) === 0);
  // walk 3 km north: old chunks get evicted to stay within the budget
  await c.warmup(0, -2600, 400);
  const loaded = c.slots.filter(Boolean).length;
  assert.ok(loaded <= 12 + 4, `loaded ${loaded} stays near the budget`);
  assert.ok(c.sampleDetail(0, -2600) !== null, "new position has detail");
  assert.ok(fetchCount > 2);
});

test("128x128 sub-chunks select exact 32 nearest cells and match detail ground across seams", async () => {
  const c = await GaleCorridor.load(BASE, { fetchFn: fileFetch });
  const sub = c.subCellSize(2);
  assert.equal(sub.px, 128);
  assert.ok(Math.abs(sub.chunkW - c.chunkW / 2) < 1e-6);
  const nearest = c.selectNearestSubCells(40, 25, 32, 2);
  assert.equal(nearest.length, 32);
  assert.equal(nearest[0].d, 0);
  for (let i = 1; i < nearest.length; i++) {
    assert.ok(nearest[i].d >= nearest[i - 1].d, "selected 32 chunks must be ordered nearest-first");
  }
  await c.warmup(40, 25, 520);
  await c.warmup(c.worldW / 2 - 10, 0, 200);
  await c.warmup(-c.worldW / 2 + 10, 0, 200);
  for (const [sa, sb] of [
    [nearest[0].a, nearest[0].b],
    [16, 20],
    [-1, 20],
    [15, 20],
  ]) {
    const g = buildCorridorSubCellGeometry(THREE, c, sa, sb, 64, c.elevMin, 30, null, 2);
    assert.ok(g, `expected 128x128 sub-cell (${sa}, ${sb}) geometry`);
    assert.equal(g.userData.corridorCell.subDiv, 2);
    const pos = g.attributes.position;
    const mid = Math.floor(pos.count / 2);
    const expect = c.sampleDetail(pos.getX(mid), pos.getZ(mid)) - c.elevMin;
    assert.ok(Math.abs(pos.getY(mid) - expect) < 0.05);
    g.dispose();
  }
});
