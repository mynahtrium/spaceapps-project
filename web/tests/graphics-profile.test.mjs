// Graphics presets and settings normalisation (node --test web/tests/graphics-profile.test.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GRAPHICS_PRESETS,
  chunkSegmentsFor,
  detectGraphicsLevel,
  resolveGraphics,
} from "../shared/graphics-profile.js";
import { normalizeDevSettings } from "../shared/dev-settings.js";

test("auto picks a level from the hardware hints", () => {
  assert.equal(detectGraphicsLevel({ gpu: "Google SwiftShader", cores: 16, memoryGb: 8 }), "low");
  assert.equal(detectGraphicsLevel({ gpu: "ANGLE (AMD, AMD Radeon Vega 3 Graphics)", cores: 4, memoryGb: 4 }), "low");
  assert.equal(detectGraphicsLevel({ gpu: "ANGLE (Intel, Intel(R) UHD Graphics 620)", cores: 4, memoryGb: 8 }), "low");
  assert.equal(detectGraphicsLevel({ gpu: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070)", cores: 16, memoryGb: 8 }), "high");
  assert.equal(detectGraphicsLevel({}), "medium");
});

test("each preset costs no less than the one below it", () => {
  const order = ["low", "medium", "high", "ultra"].map((k) => GRAPHICS_PRESETS[k]);
  for (let i = 1; i < order.length; i++) {
    for (const key of ["pixelRatioCap", "renderScale", "msaa", "shadowPx", "detailRadiusM", "mirrorRing"]) {
      assert.ok(order[i][key] >= order[i - 1][key], `${key} at step ${i}`);
    }
  }
});

test("overrides replace single values of the preset", () => {
  const base = resolveGraphics(normalizeDevSettings({ quality: "high" }));
  assert.equal(base.level, "high");
  assert.equal(base.shadowPx, 2048);
  const g = resolveGraphics(
    normalizeDevSettings({ quality: "high", gfxShadows: "off", gfxViewDistance: "near", gfxRenderScale: "0.5", gfxAntialias: "0", fpsLimit: 60 })
  );
  assert.equal(g.shadowPx, 0);
  assert.equal(g.detailRadiusM, 350);
  assert.equal(g.renderScale, 0.5);
  assert.equal(g.adaptive, false);
  assert.equal(g.msaa, 0);
  assert.equal(g.fpsLimit, 60);
  assert.ok(g.lodNearM <= g.lodMidM && g.lodMidM <= g.detailRadiusM);
});

test("old settings still load", () => {
  assert.equal(normalizeDevSettings({ quality: "performance" }).quality, "medium");
  assert.equal(normalizeDevSettings({ quality: "balanced" }).quality, "high");
  assert.equal(normalizeDevSettings({ quality: "nonsense" }).quality, "auto");
  assert.equal(resolveGraphics(normalizeDevSettings({ quality: "low", superGraphics: true })).level, "ultra");
});

test("chunks get coarser with distance", () => {
  const g = GRAPHICS_PRESETS.medium;
  assert.equal(chunkSegmentsFor(g, 10), 256);
  assert.equal(chunkSegmentsFor(g, 200), 128);
  assert.equal(chunkSegmentsFor(g, 500), 64);
});
