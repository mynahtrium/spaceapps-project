import test from "node:test";
import assert from "node:assert/strict";
import {
  MOLA_PALETTE_STOPS,
  buildMolaPaletteGlsl,
  sampleMolaPaletteRgb,
  sampleSlopeHazardColor,
} from "../hud/mars-terrain-colors.js";

test("MOLA_PALETTE_STOPS spans 0..1 monotonically with valid [t, r, g, b] normalized stops", () => {
  assert.ok(Array.isArray(MOLA_PALETTE_STOPS));
  assert.equal(MOLA_PALETTE_STOPS.length, 8);
  assert.equal(MOLA_PALETTE_STOPS[0][0], 0);
  assert.equal(MOLA_PALETTE_STOPS[MOLA_PALETTE_STOPS.length - 1][0], 1);

  let prevT = -1;
  for (const stop of MOLA_PALETTE_STOPS) {
    assert.equal(stop.length, 4);
    const [t, r, g, b] = stop;
    assert.ok(Number.isFinite(t) && t > prevT && t <= 1);
    prevT = t;
    for (const c of [r, g, b]) {
      assert.ok(Number.isFinite(c) && c >= 0 && c <= 1);
    }
  }
});

test("sampleMolaPaletteRgb interpolates NASA MOLA colors and clamps out-of-range inputs", () => {
  const basin = sampleMolaPaletteRgb(0);
  assert.deepEqual(basin, [0.24, 0.12, 0.56]);

  const mid = sampleMolaPaletteRgb(0.52);
  assert.ok(Math.abs(mid[0] - 0.42) < 1e-6);
  assert.ok(Math.abs(mid[1] - 0.8) < 1e-6);
  assert.ok(Math.abs(mid[2] - 0.25) < 1e-6);

  const interpMid = sampleMolaPaletteRgb(0.5);
  assert.ok(interpMid[1] > interpMid[2], "mid-altitude elevation should sit in green/chartreuse band");

  const summit = sampleMolaPaletteRgb(1);
  assert.deepEqual(summit, [0.97, 0.96, 0.95]);

  assert.deepEqual(sampleMolaPaletteRgb(-0.5), basin);
  assert.deepEqual(sampleMolaPaletteRgb(1.5), summit);
  assert.ok(Number.isFinite(sampleMolaPaletteRgb(Number.NaN)[0]));
});

test("sampleSlopeHazardColor matches NASA EVA thresholds green <=10, amber 10-15, red 15-20, blocked >20 deg", () => {
  const safe = sampleSlopeHazardColor(10);
  const amber = sampleSlopeHazardColor(12);
  const red = sampleSlopeHazardColor(17);
  const blocked = sampleSlopeHazardColor(25);

  assert.deepEqual(safe, { r: 34, g: 197, b: 94, alpha: 0.25 });
  assert.deepEqual(amber, { r: 245, g: 158, b: 11, alpha: 0.4 });
  assert.deepEqual(red, { r: 239, g: 68, b: 68, alpha: 0.52 });
  assert.deepEqual(blocked, { r: 168, g: 85, b: 247, alpha: 0.62 });
});

test("buildMolaPaletteGlsl generates valid vec3 mmSampleMolaRamp(float t) shader code", () => {
  const glsl = buildMolaPaletteGlsl();
  assert.equal(typeof glsl, "string");
  assert.ok(glsl.includes("vec3 mmSampleMolaRamp(float t)"));
  assert.ok(glsl.includes("clamp(t, 0.0, 1.0)"));
  assert.ok(glsl.includes("vec3(0.240, 0.120, 0.560)"));
  assert.ok(glsl.includes("vec3(0.970, 0.960, 0.950)"));
  assert.ok(glsl.includes("mix("));
});
