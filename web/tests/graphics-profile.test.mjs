// Graphics presets and settings normalisation (node --test web/tests/graphics-profile.test.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GRAPHICS_PRESETS,
  buildHardwareSummary,
  chunkSegmentsFor,
  cleanGpuModelName,
  detectGpuVendor,
  detectGraphicsLevel,
  estimateGpuVram,
  estimateSceneVramMb,
  probeGpuTier,
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
    for (const key of ["pixelRatioCap", "renderScale", "shadowPx", "detailRadiusM", "mirrorRing"]) {
      assert.ok(order[i][key] >= order[i - 1][key], `${key} at step ${i}`);
    }
    const aoRank = { off: 0, low: 1, high: 2 };
    assert.ok(aoRank[order[i].ao] >= aoRank[order[i - 1].ao], `ao at step ${i}`);
  }
});

test("overrides replace single values of the preset", () => {
  const base = resolveGraphics(normalizeDevSettings({ quality: "high" }));
  assert.equal(base.level, "high");
  assert.equal(base.shadowPx, 2048);
  const g = resolveGraphics(
    normalizeDevSettings({ quality: "high", gfxShadows: "off", gfxViewDistance: "near", gfxRenderScale: "0.5", gfxAntialias: "fxaa", gfxAo: "off", gfxBloom: "off", fpsLimit: 60 })
  );
  assert.equal(g.shadowPx, 0);
  assert.equal(g.detailRadiusM, 350);
  assert.equal(g.renderScale, 0.5);
  assert.equal(g.adaptive, false);
  assert.equal(g.aa, "fxaa");
  assert.equal(g.ao, "off");
  assert.equal(g.bloom, false);
  assert.equal(resolveGraphics(normalizeDevSettings({ quality: "low", gfxBloom: "on" })).bloom, true);
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

test("DLSS is gone from saved settings", () => {
  const cfg = normalizeDevSettings({ dlss: true, dlssMode: "performance", dlssSharpness: 0.8 });
  for (const key of ["dlss", "dlssMode", "dlssSharpness"]) assert.equal(key in cfg, false, key);
});

test("hardware detection cleans ANGLE GPU strings, estimates VRAM, and builds telemetry summary", async () => {
  const rawNvidia = "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)";
  assert.equal(cleanGpuModelName(rawNvidia), "NVIDIA GeForce RTX 4070");
  assert.equal(detectGpuVendor(rawNvidia), "NVIDIA");

  const vram4070 = estimateGpuVram(rawNvidia, 0, 32);
  assert.equal(vram4070.vramGb, 12);
  assert.equal(vram4070.vramMb, 12288);
  assert.equal(vram4070.shared, false);

  const rawIntel = "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)";
  const vramIntel = estimateGpuVram(rawIntel, 0, 16);
  assert.equal(vramIntel.shared, true);
  assert.equal(vramIntel.vramGb, 8);

  const summary = buildHardwareSummary({
    gpu: rawNvidia,
    cores: 16,
    osRamGb: 32,
    osFreeRamGb: 18.4,
    cpuModel: "AMD Ryzen 7 7800X3D",
    maxTextureSize: 16384,
  });
  assert.equal(summary.gpuName, "NVIDIA GeForce RTX 4070");
  assert.equal(summary.vramGb, 12);
  assert.equal(summary.ramGb, 32);
  assert.equal(summary.freeRamGb, 18.4);
  assert.equal(summary.cores, 16);
  assert.equal(summary.cpuModel, "AMD Ryzen 7 7800X3D");
  assert.equal(summary.autoLevel, "high");

  const sceneMb = estimateSceneVramMb({
    rtWidth: 1920,
    rtHeight: 1080,
    rtSamples: 4,
    rtHasDepth: true,
    shadowPx: 2048,
    textures: 24,
    geometries: 80,
    triangles: 250000,
    realisticTextures: true,
  });
  assert.ok(sceneMb >= 60 && sceneMb <= 350, `scene VRAM estimate ${sceneMb} MB within realistic range`);

  const tier4070 = await probeGpuTier({ gpu: rawNvidia });
  assert.equal(tier4070.tier, 3);
  const tierSwift = await probeGpuTier({ gpu: "Google SwiftShader" });
  assert.equal(tierSwift.tier, 0);
});

test("graphics screen shows the preset's values until an option is changed", async () => {
  const { effectiveGfxChoice, gfxPresetPatch, hasGfxOverrides } = await import("../shared/graphics-profile.js");
  const high = normalizeDevSettings({ quality: "high" });
  const g = resolveGraphics(high);
  assert.equal(hasGfxOverrides(high), false);
  assert.equal(effectiveGfxChoice(high, "gfxShadows", g), "high");
  assert.equal(effectiveGfxChoice(high, "gfxAntialias", g), "smaa");
  assert.equal(effectiveGfxChoice(high, "gfxAo", g), "low");
  assert.equal(effectiveGfxChoice(high, "gfxBloom", g), "on");
  assert.equal(effectiveGfxChoice(high, "gfxViewDistance", g), "far");
  assert.equal(effectiveGfxChoice(high, "gfxRenderScale", g), "auto");
  const custom = normalizeDevSettings({ quality: "high", gfxAntialias: "msaa" });
  assert.equal(hasGfxOverrides(custom), true);
  assert.equal(effectiveGfxChoice(custom, "gfxAntialias"), "msaa");
  const reset = normalizeDevSettings({ ...custom, ...gfxPresetPatch("low") });
  assert.equal(reset.quality, "low");
  assert.equal(hasGfxOverrides(reset), false);
});
