import test from "node:test";
import assert from "node:assert/strict";

import {
  MARS_RADIUS_MEAN_M,
  decodeHiRiseRgb16Pixel,
  decodeTerrariumPixel,
  encodeTerrariumPixel,
  interpolateAntimeridianPath,
  localRTCToLonLatElev,
  lonLatElevToLocalRTC,
  lonLatToMarsEquirectTile,
  lonLatToTile,
  makeLocalTangentOrigin,
  marsBearingDeg,
  marsDistanceM,
  marsEquirectTileToBounds,
  tileToLonLatBounds,
  toLngLat,
} from "../map/Geodesy.js";

test("Terrarium RGB encode/decode precision across negative Gale and Mt Everest elevations", () => {
  const testElevs = [-4500.25, -3850.6, -3369.3, -102.375, 0, 250.5, 4210.8, 8848.86];
  for (const h of testElevs) {
    const [r, g, b] = encodeTerrariumPixel(h);
    assert.ok(r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255);
    const decoded = decodeTerrariumPixel(r, g, b);
    assert.ok(
      Math.abs(decoded - h) <= 0.004,
      `Terrarium roundtrip error too large for ${h}: got ${decoded}`
    );
  }
});

test("HiRISE 16-bit RGB decode treats 0 as NaN NoData and maps 1..65535 linearly", () => {
  const minE = -3850.6;
  const maxE = -3369.3;
  assert.ok(Number.isNaN(decodeHiRiseRgb16Pixel(0, 0, minE, maxE)));
  assert.equal(decodeHiRiseRgb16Pixel(0, 1, minE, maxE), minE);
  assert.equal(decodeHiRiseRgb16Pixel(255, 255, minE, maxE), maxE);
  const mid = decodeHiRiseRgb16Pixel(128, 0, minE, maxE);
  assert.ok(mid > minE && mid < maxE);
});

test("20-coordinate Slippy & Mars Equirectangular bounds containment symmetry", () => {
  const coords = [
    [137.39, -4.8],
    [137.372831, -4.816946],
    [137.406542, -4.783236],
    [-179.5, -80.1],
    [179.5, 80.1],
    [0, 0],
    [-122.4194, 37.7749],
    [29.0121, 41.0082],
    [77.4508, 18.4447], // Jezero Crater
    [-45.0, -33.2],
    [15.2, 62.7],
    [-98.3, 21.4],
    [110.1, -66.6],
    [-1.25, 51.75],
    [139.69, 35.69],
    [-70.66, -33.45],
    [35.2, -12.1],
    [-155.47, 19.82],
    [6.15, 46.2],
    [-60.0, 45.0],
  ];

  for (const [lon, lat] of coords) {
    for (const z of [2, 6, 12]) {
      const tile = lonLatToTile(lon, lat, z);
      const b = tileToLonLatBounds(tile.z, tile.x, tile.y);
      assert.ok(lon >= b.west - 1e-9 && lon <= b.east + 1e-9, `Slippy lon ${lon} outside ${JSON.stringify(b)}`);
      assert.ok(lat >= b.south - 1e-9 && lat <= b.north + 1e-9, `Slippy lat ${lat} outside ${JSON.stringify(b)}`);

      const eq = lonLatToMarsEquirectTile(lon, lat, Math.min(8, z));
      const eb = marsEquirectTileToBounds(eq.z, eq.col, eq.row);
      assert.ok(lon >= eb.west - 1e-9 && lon <= eb.east + 1e-9, `Eq lon ${lon} outside ${JSON.stringify(eb)}`);
      assert.ok(lat >= eb.south - 1e-9 && lat <= eb.north + 1e-9, `Eq lat ${lat} outside ${JSON.stringify(eb)}`);
    }
  }

  // Exact verification against cached Gale Crater THEMIS sample filenames
  assert.deepEqual(lonLatToMarsEquirectTile(137.39, -4.8, 4), { z: 4, col: 28, row: 8 });
  assert.deepEqual(lonLatToMarsEquirectTile(137.39, -4.8, 6), { z: 6, col: 112, row: 33 });
  assert.deepEqual(lonLatToMarsEquirectTile(137.39, -4.8, 8), { z: 8, col: 451, row: 134 });
});

test("toLngLat enforces [lon, lat] and catches accidental [lat, lon] when |lat| > 90", () => {
  assert.deepEqual(toLngLat([137.39, -4.8]), [137.39, -4.8]);
  assert.deepEqual(toLngLat({ lng: 137.39, lat: -4.8 }), [137.39, -4.8]);
  assert.throws(() => toLngLat([-4.8, 137.39]), RangeError);
});

test("Antimeridian interpolation keeps longitude continuous across +/-180 deg", () => {
  const unwrapped = interpolateAntimeridianPath([
    [178.5, -10.0],
    [-179.2, -10.2],
    [-178.0, -10.4],
  ]);
  assert.equal(unwrapped[0][0], 178.5);
  assert.ok(Math.abs(unwrapped[1][0] - 180.8) < 1e-9);
  assert.ok(Math.abs(unwrapped[2][0] - 182.0) < 1e-9);
});

test("Float64 Planetocentric ECEF <-> Local RTC transform preserves sub-millimeter invertibility", () => {
  const origin = makeLocalTangentOrigin(137.39, -4.8, -3620);
  const ptLon = 137.3965;
  const ptLat = -4.7921;
  const ptElev = -3512.45;

  const rtc = lonLatElevToLocalRTC(ptLon, ptLat, ptElev, origin);
  // Expect East > 0 (+x), North -> -z so south < 0, slightly elevated (+y)
  assert.ok(rtc.x > 300 && rtc.x < 500);
  assert.ok(rtc.z < -300 && rtc.z > -600);
  assert.ok(rtc.y > 90 && rtc.y < 120);

  const inv = localRTCToLonLatElev(rtc.x, rtc.y, rtc.z, origin);
  assert.ok(Math.abs(inv.lon - ptLon) < 1e-8);
  assert.ok(Math.abs(inv.lat - ptLat) < 1e-8);
  assert.ok(Math.abs(inv.elevM - ptElev) < 1e-3);
});

test("Mars Haversine distance & bearing reflect 3,389.5 km Mars radius (~59 km/deg)", () => {
  const dLat1 = marsDistanceM([137.39, -5.0], [137.39, -4.0], MARS_RADIUS_MEAN_M);
  const expected = (Math.PI / 180) * MARS_RADIUS_MEAN_M;
  assert.ok(Math.abs(dLat1 - expected) < 0.1);
  assert.ok(Math.abs(marsBearingDeg([137.39, -4.8], [137.39, -4.7]) - 0) < 1e-6);
  assert.ok(Math.abs(marsBearingDeg([137.39, -4.8], [137.49, -4.8]) - 90) < 0.1);
});
