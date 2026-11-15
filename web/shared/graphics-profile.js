/**
 * Graphics presets & hardware profiling for the 3D EVA view (`web/shared/graphics-profile.js`).
 * Powered by `detect-gpu` with bundled offline benchmark data (zero external network fetches).
 */

import * as detectGpuModule from "detect-gpu";

const getGPUTier = detectGpuModule["getGPUTier"] || detectGpuModule["default"]?.getGPUTier;

export const GRAPHICS_LEVELS = Object.freeze(["auto", "low", "medium", "high", "ultra"]);

/**
 * pixelRatioCap  device pixels per CSS pixel, upper limit
 * renderScale    3D scene resolution relative to the canvas (the HUD lens pass stays sharp)
 * minScale       floor for the adaptive resolution
 * msaa           MSAA samples on the scene target
 * shadowPx       sun shadow map size, 0 = no shadow map (baked terrain shadows stay)
 * shadowHalfM    half-width of the shadow box around the walker
 * softShadows    PCF soft filter
 * detailRadiusM  radius of the streamed 1 m terrain meshes
 * lodNearM/MidM  distance where a chunk drops from 1 m to 2 m, and 2 m to 4 m vertex spacing
 * lodSegs        grid segments per chunk for near / mid / far
 * mirrorRing     mirrored copies of the overview terrain drawn around the centre tile
 * sceneDetail    rock field, far vista and field kits
 * adaptive       lower the scene resolution when frames run slow
 */
export const GRAPHICS_PRESETS = Object.freeze({
  low: Object.freeze({
    pixelRatioCap: 1,
    renderScale: 0.75,
    minScale: 0.5,
    msaa: 0,
    shadowPx: 0,
    shadowHalfM: 14,
    softShadows: false,
    detailRadiusM: 350,
    lodNearM: 90,
    lodMidM: 220,
    lodSegs: Object.freeze([128, 64, 32]),
    mirrorRing: 1,
    sceneDetail: false,
    adaptive: true,
  }),
  medium: Object.freeze({
    pixelRatioCap: 1.25,
    renderScale: 1,
    minScale: 0.55,
    msaa: 2,
    shadowPx: 1024,
    shadowHalfM: 16,
    softShadows: false,
    detailRadiusM: 600,
    lodNearM: 130,
    lodMidM: 380,
    lodSegs: Object.freeze([256, 128, 64]),
    mirrorRing: 1,
    sceneDetail: false,
    adaptive: true,
  }),
  high: Object.freeze({
    pixelRatioCap: 1.5,
    renderScale: 1,
    minScale: 0.7,
    msaa: 4,
    shadowPx: 2048,
    shadowHalfM: 20,
    softShadows: false,
    detailRadiusM: 850,
    lodNearM: 150,
    lodMidM: 450,
    lodSegs: Object.freeze([256, 128, 64]),
    mirrorRing: 2,
    sceneDetail: true,
    adaptive: true,
  }),
  ultra: Object.freeze({
    pixelRatioCap: 2,
    renderScale: 1.25,
    minScale: 1,
    msaa: 4,
    shadowPx: 4096,
    shadowHalfM: 30,
    softShadows: true,
    detailRadiusM: 1000,
    lodNearM: 200,
    lodMidM: 550,
    lodSegs: Object.freeze([256, 128, 64]),
    mirrorRing: 2,
    sceneDetail: true,
    adaptive: false,
  }),
});

export const SHADOW_OPTIONS = Object.freeze({
  off: Object.freeze({ shadowPx: 0, shadowHalfM: 14, softShadows: false }),
  low: Object.freeze({ shadowPx: 1024, shadowHalfM: 16, softShadows: false }),
  high: Object.freeze({ shadowPx: 2048, shadowHalfM: 20, softShadows: false }),
  ultra: Object.freeze({ shadowPx: 4096, shadowHalfM: 30, softShadows: true }),
});
export const VIEW_DISTANCE_OPTIONS = Object.freeze({ near: 350, medium: 600, far: 850, max: 1000 });
export const RENDER_SCALE_OPTIONS = Object.freeze([0.5, 0.75, 1, 1.25]);
export const ANTIALIAS_OPTIONS = Object.freeze([0, 2, 4]);
export const FPS_LIMIT_OPTIONS = Object.freeze([0, 30, 60, 120]);

/**
 * Bundled offline GPU benchmark database compatible with `detect-gpu` v4 schema.
 * Each record defines vendor, canonical model, benchmark FPS (tier 0-3), VRAM, and shared-memory status.
 */
const OFFLINE_GPU_CATALOG = Object.freeze([
  // Software / blocklisted (tier 0)
  { key: "swiftshader", modelId: "swiftshader", vendor: "Generic", display: "Google SwiftShader", tier: 0, fps: -1, vramGb: 1, shared: true, rt: false },
  { key: "llvmpipe", modelId: "llvmpipe", vendor: "Generic", display: "LLVMpipe Software Renderer", tier: 0, fps: -1, vramGb: 1, shared: true, rt: false },
  { key: "softpipe", modelId: "softpipe", vendor: "Generic", display: "Softpipe Renderer", tier: 0, fps: -1, vramGb: 1, shared: true, rt: false },
  { key: "basic render", modelId: "basic", vendor: "Generic", display: "Microsoft Basic Render Driver", tier: 0, fps: -1, vramGb: 1, shared: true, rt: false },

  // NVIDIA discrete (tier 3 / 2)
  { key: "rtx 5090", modelId: "5090", vendor: "NVIDIA", display: "NVIDIA GeForce RTX 5090", tier: 3, fps: 165, vramGb: 32, shared: false, rt: true },
  { key: "rtx 5080", modelId: "5080", vendor: "NVIDIA", display: "NVIDIA GeForce RTX 5080", tier: 3, fps: 140, vramGb: 16, shared: false, rt: true },
  { key: "rtx 4090", modelId: "4090", vendor: "NVIDIA", display: "NVIDIA GeForce RTX 4090", tier: 3, fps: 150, vramGb: 24, laptopVramGb: 16, shared: false, rt: true },
  { key: "rtx 4080", modelId: "4080", vendor: "NVIDIA", display: "NVIDIA GeForce RTX 4080", tier: 3, fps: 125, vramGb: 16, laptopVramGb: 12, shared: false, rt: true },
  { key: "rtx 4070 ti super", modelId: "4070", vendor: "NVIDIA", display: "NVIDIA GeForce RTX 4070 Ti Super", tier: 3, fps: 115, vramGb: 16, shared: false, rt: true },
  { key: "rtx 4070", modelId: "4070", vendor: "NVIDIA", display: "NVIDIA GeForce RTX 4070", tier: 3, fps: 105, vramGb: 12, laptopVramGb: 8, shared: false, rt: true },
  { key: "rtx 4060 ti 16", modelId: "4060", vendor: "NVIDIA", display: "NVIDIA GeForce RTX 4060 Ti", tier: 3, fps: 90, vramGb: 16, shared: false, rt: true },
  { key: "rtx 4060", modelId: "4060", vendor: "NVIDIA", display: "NVIDIA GeForce RTX 4060", tier: 3, fps: 82, vramGb: 8, shared: false, rt: true },
  { key: "rtx 4050", modelId: "4050", vendor: "NVIDIA", display: "NVIDIA GeForce RTX 4050", tier: 2, fps: 55, vramGb: 6, shared: false, rt: true },
  { key: "rtx 3090", modelId: "3090", vendor: "NVIDIA", display: "NVIDIA GeForce RTX 3090", tier: 3, fps: 120, vramGb: 24, shared: false, rt: true },
  { key: "rtx 3080 ti", modelId: "3080", vendor: "NVIDIA", display: "NVIDIA GeForce RTX 3080 Ti", tier: 3, fps: 110, vramGb: 12, shared: false, rt: true },
  { key: "rtx 3080", modelId: "3080", vendor: "NVIDIA", display: "NVIDIA GeForce RTX 3080", tier: 3, fps: 100, vramGb: 10, shared: false, rt: true },
  { key: "rtx 3070", modelId: "3070", vendor: "NVIDIA", display: "NVIDIA GeForce RTX 3070", tier: 3, fps: 88, vramGb: 8, shared: false, rt: true },
  { key: "rtx 3060 ti", modelId: "3060", vendor: "NVIDIA", display: "NVIDIA GeForce RTX 3060 Ti", tier: 3, fps: 78, vramGb: 8, shared: false, rt: true },
  { key: "rtx 3060 laptop", modelId: "3060", vendor: "NVIDIA", display: "NVIDIA GeForce RTX 3060 Laptop", tier: 3, fps: 64, vramGb: 6, shared: false, rt: true },
  { key: "rtx 3060", modelId: "3060", vendor: "NVIDIA", display: "NVIDIA GeForce RTX 3060", tier: 3, fps: 70, vramGb: 12, shared: false, rt: true },
  { key: "rtx 3050", modelId: "3050", vendor: "NVIDIA", display: "NVIDIA GeForce RTX 3050", tier: 2, fps: 48, vramGb: 4, shared: false, rt: true },
  { key: "rtx 2080", modelId: "2080", vendor: "NVIDIA", display: "NVIDIA GeForce RTX 2080", tier: 3, fps: 80, vramGb: 8, shared: false, rt: true },
  { key: "rtx 2070", modelId: "2070", vendor: "NVIDIA", display: "NVIDIA GeForce RTX 2070", tier: 3, fps: 72, vramGb: 8, shared: false, rt: true },
  { key: "rtx 2060 super", modelId: "2060", vendor: "NVIDIA", display: "NVIDIA GeForce RTX 2060 Super", tier: 3, fps: 66, vramGb: 8, shared: false, rt: true },
  { key: "rtx 2060", modelId: "2060", vendor: "NVIDIA", display: "NVIDIA GeForce RTX 2060", tier: 3, fps: 60, vramGb: 6, shared: false, rt: true },
  { key: "gtx 1660", modelId: "1660", vendor: "NVIDIA", display: "NVIDIA GeForce GTX 1660", tier: 2, fps: 52, vramGb: 6, shared: false, rt: false },
  { key: "gtx 1650", modelId: "1650", vendor: "NVIDIA", display: "NVIDIA GeForce GTX 1650", tier: 2, fps: 42, vramGb: 4, shared: false, rt: false },
  { key: "gtx 1080", modelId: "1080", vendor: "NVIDIA", display: "NVIDIA GeForce GTX 1080", tier: 3, fps: 75, vramGb: 8, shared: false, rt: false },
  { key: "gtx 1070", modelId: "1070", vendor: "NVIDIA", display: "NVIDIA GeForce GTX 1070", tier: 3, fps: 65, vramGb: 8, shared: false, rt: false },
  { key: "gtx 1060", modelId: "1060", vendor: "NVIDIA", display: "NVIDIA GeForce GTX 1060", tier: 2, fps: 50, vramGb: 6, shared: false, rt: false },
  { key: "gtx 1050", modelId: "1050", vendor: "NVIDIA", display: "NVIDIA GeForce GTX 1050", tier: 2, fps: 36, vramGb: 4, shared: false, rt: false },

  // AMD discrete & integrated
  { key: "rx 7900 xtx", modelId: "7900", vendor: "AMD", display: "AMD Radeon RX 7900 XTX", tier: 3, fps: 135, vramGb: 24, shared: false, rt: true },
  { key: "rx 7900 xt", modelId: "7900", vendor: "AMD", display: "AMD Radeon RX 7900 XT", tier: 3, fps: 120, vramGb: 20, shared: false, rt: true },
  { key: "rx 7800 xt", modelId: "7800", vendor: "AMD", display: "AMD Radeon RX 7800 XT", tier: 3, fps: 100, vramGb: 16, shared: false, rt: true },
  { key: "rx 7700 xt", modelId: "7700", vendor: "AMD", display: "AMD Radeon RX 7700 XT", tier: 3, fps: 88, vramGb: 12, shared: false, rt: true },
  { key: "rx 7600", modelId: "7600", vendor: "AMD", display: "AMD Radeon RX 7600", tier: 3, fps: 70, vramGb: 8, shared: false, rt: true },
  { key: "rx 6800", modelId: "6800", vendor: "AMD", display: "AMD Radeon RX 6800", tier: 3, fps: 95, vramGb: 16, shared: false, rt: true },
  { key: "rx 6700 xt", modelId: "6700", vendor: "AMD", display: "AMD Radeon RX 6700 XT", tier: 3, fps: 82, vramGb: 12, shared: false, rt: true },
  { key: "rx 6600", modelId: "6600", vendor: "AMD", display: "AMD Radeon RX 6600", tier: 3, fps: 65, vramGb: 8, shared: false, rt: true },
  { key: "vega", modelId: "vega", vendor: "AMD", display: "AMD Radeon Vega Graphics", tier: 1, fps: 22, vramGb: 0, shared: true, rt: false },
  { key: "radeon graphics", modelId: "radeon", vendor: "AMD", display: "AMD Radeon Graphics", tier: 1, fps: 24, vramGb: 0, shared: true, rt: false },

  // Intel discrete & integrated
  { key: "arc a770", modelId: "a770", vendor: "Intel", display: "Intel Arc A770", tier: 3, fps: 75, vramGb: 16, shared: false, rt: true },
  { key: "arc a750", modelId: "a750", vendor: "Intel", display: "Intel Arc A750", tier: 3, fps: 68, vramGb: 8, shared: false, rt: true },
  { key: "iris xe", modelId: "xe", vendor: "Intel", display: "Intel Iris Xe Graphics", tier: 1, fps: 26, vramGb: 0, shared: true, rt: false },
  { key: "uhd graphics", modelId: "uhd", vendor: "Intel", display: "Intel UHD Graphics", tier: 1, fps: 18, vramGb: 0, shared: true, rt: false },
  { key: "hd graphics", modelId: "hd", vendor: "Intel", display: "Intel HD Graphics", tier: 1, fps: 15, vramGb: 0, shared: true, rt: false },

  // Apple Silicon
  { key: "apple m4", modelId: "m4", vendor: "Apple", display: "Apple M4", tier: 3, fps: 95, vramGb: 0, shared: true, rt: true },
  { key: "apple m3", modelId: "m3", vendor: "Apple", display: "Apple M3", tier: 3, fps: 85, vramGb: 0, shared: true, rt: true },
  { key: "apple m2", modelId: "m2", vendor: "Apple", display: "Apple M2", tier: 3, fps: 72, vramGb: 0, shared: true, rt: false },
  { key: "apple m1", modelId: "m1", vendor: "Apple", display: "Apple M1", tier: 3, fps: 62, vramGb: 0, shared: true, rt: false },
  { key: "apple gpu", modelId: "apple", vendor: "Apple", display: "Apple GPU", tier: 2, fps: 45, vramGb: 0, shared: true, rt: false },

  // Mobile / ARM
  { key: "adreno", modelId: "adreno", vendor: "Qualcomm", display: "Qualcomm Adreno", tier: 1, fps: 24, vramGb: 0, shared: true, rt: false },
  { key: "mali", modelId: "mali", vendor: "ARM", display: "ARM Mali", tier: 1, fps: 20, vramGb: 0, shared: true, rt: false },
]);

function buildDetectGpuBenchmarkTable(entries) {
  return [
    "4.0.0",
    ...entries.map((entry) => {
      const lower = entry.display.toLowerCase();
      const sortedTokens = lower.split(/[.,()[\]/\s]/g).filter(Boolean).sort().join(" ");
      return [lower, entry.modelId, sortedTokens, "", [[1920, 1080, entry.fps, entry.display]]];
    }),
  ];
}

const OFFLINE_BENCHMARK_FILES = Object.freeze({
  "d-nvidia.json": buildDetectGpuBenchmarkTable(OFFLINE_GPU_CATALOG.filter((e) => e.vendor === "NVIDIA")),
  "d-geforce.json": buildDetectGpuBenchmarkTable(OFFLINE_GPU_CATALOG.filter((e) => e.vendor === "NVIDIA")),
  "d-amd.json": buildDetectGpuBenchmarkTable(OFFLINE_GPU_CATALOG.filter((e) => e.vendor === "AMD")),
  "d-radeon.json": buildDetectGpuBenchmarkTable(OFFLINE_GPU_CATALOG.filter((e) => e.vendor === "AMD")),
  "d-intel.json": buildDetectGpuBenchmarkTable(OFFLINE_GPU_CATALOG.filter((e) => e.vendor === "Intel")),
  "d-apple.json": buildDetectGpuBenchmarkTable(OFFLINE_GPU_CATALOG.filter((e) => e.vendor === "Apple")),
  "d-adreno.json": buildDetectGpuBenchmarkTable(OFFLINE_GPU_CATALOG.filter((e) => e.vendor === "Qualcomm")),
  "m-apple.json": buildDetectGpuBenchmarkTable(OFFLINE_GPU_CATALOG.filter((e) => e.vendor === "Apple")),
  "m-adreno.json": buildDetectGpuBenchmarkTable(OFFLINE_GPU_CATALOG.filter((e) => e.vendor === "Qualcomm")),
  "m-mali.json": buildDetectGpuBenchmarkTable(OFFLINE_GPU_CATALOG.filter((e) => e.vendor === "ARM")),
});

const gpuTierCache = new Map();

/**
 * Strip ANGLE / Direct3D / PCI hex wrappers from WebGL UNMASKED_RENDERER_WEBGL strings.
 */
export function cleanGpuModelName(rawRenderer = "") {
  let s = String(rawRenderer || "").trim();
  if (!s) return "Unknown WebGL GPU";
  const angleMatch = s.match(/^ANGLE\s*\([^,]+,\s*([^,]+?)(?:,\s*OpenGL|\s+Direct3D|\s+D3D|\s*\)|$)/i);
  if (angleMatch && angleMatch[1]) {
    s = angleMatch[1].trim();
  }
  s = s
    .replace(/\s*\(0x[0-9a-fA-F]+\)/g, "")
    .replace(/\s*Direct3D\S*.*$/i, "")
    .replace(/\s*vs_\d+_\d+.*$/i, "")
    .replace(/\s*\(TM\)/gi, "")
    .replace(/\s*\(R\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return s || "Unknown WebGL GPU";
}

function lookupCatalogEntry(rawRenderer = "") {
  const cleanLower = cleanGpuModelName(rawRenderer).toLowerCase();
  const rawLower = String(rawRenderer || "").toLowerCase();
  for (const entry of OFFLINE_GPU_CATALOG) {
    if (cleanLower.includes(entry.key) || rawLower.includes(entry.key)) {
      return entry;
    }
  }
  return null;
}

/**
 * Run `detect-gpu`'s `getGPUTier` against the bundled offline benchmark table (zero network requests).
 */
export async function probeGpuTier(hw = {}) {
  const renderer = String(hw.gpu || "");
  if (gpuTierCache.has(renderer)) return gpuTierCache.get(renderer);
  const catalogEntry = lookupCatalogEntry(renderer);
  let tierResult = null;
  if (typeof getGPUTier === "function") {
    try {
      const res = await getGPUTier({
        override: {
          renderer: renderer || undefined,
          isMobile: Boolean(hw.mobile),
          screenSize: { width: 1920, height: 1080 },
          loadBenchmarks: async (file) => OFFLINE_BENCHMARK_FILES[file] || ["4.0.0"],
        },
      });
      if (res && res.type !== "SSR") {
        tierResult = res;
      }
    } catch {
      /* fallback to catalog entry */
    }
  }
  if (!tierResult) {
    tierResult = {
      tier: catalogEntry ? catalogEntry.tier : renderer ? 2 : 2,
      type: catalogEntry ? (catalogEntry.tier === 0 ? "BLOCKLISTED" : "BENCHMARK") : "FALLBACK",
      gpu: cleanGpuModelName(renderer),
      fps: catalogEntry ? catalogEntry.fps : 45,
      isMobile: Boolean(hw.mobile),
    };
  }
  gpuTierCache.set(renderer, tierResult);
  return tierResult;
}

export function detectGpuVendor(rawRenderer = "") {
  const entry = lookupCatalogEntry(rawRenderer);
  if (entry && entry.vendor !== "Generic") return entry.vendor;
  const s = String(rawRenderer || "").toLowerCase();
  if (s.includes("nvidia") || s.includes("geforce") || s.includes("quadro") || s.includes("rtx") || s.includes("gtx")) return "NVIDIA";
  if (s.includes("amd") || s.includes("radeon") || s.includes("ryzen")) return "AMD";
  if (s.includes("apple")) return "Apple";
  if (s.includes("intel") || s.includes("iris") || s.includes("uhd") || s.includes("arc")) return "Intel";
  if (s.includes("qualcomm") || s.includes("adreno")) return "Qualcomm";
  if (s.includes("arm") || s.includes("mali")) return "ARM";
  return "Generic";
}

/**
 * Estimate GPU VRAM in GB & MB from driver memory extension, OS probe, or offline `detect-gpu` catalog.
 * @param {string} rawRenderer
 * @param {number} [driverVramMb=0]
 * @param {number} [systemRamGb=8]
 */
export function estimateGpuVram(rawRenderer = "", driverVramMb = 0, systemRamGb = 8) {
  const clean = cleanGpuModelName(rawRenderer);
  const cleanLower = clean.toLowerCase();
  const ram = Number.isFinite(Number(systemRamGb)) && Number(systemRamGb) > 0 ? Number(systemRamGb) : 8;
  const entry = lookupCatalogEntry(rawRenderer);

  if (Number.isFinite(driverVramMb) && driverVramMb >= 256) {
    const gb = Math.round((driverVramMb / 1024) * 10) / 10;
    const isShared = entry ? entry.shared : cleanLower.includes("intel") || cleanLower.includes("vega");
    return {
      vramGb: gb,
      vramMb: Math.round(driverVramMb),
      shared: isShared,
      source: "driver",
    };
  }

  if (entry) {
    if (!entry.shared && entry.vramGb > 0) {
      const isLaptop = cleanLower.includes("laptop") || cleanLower.includes("mobile") || cleanLower.includes("max-q");
      const adjGb = isLaptop && entry.laptopVramGb ? entry.laptopVramGb : entry.vramGb;
      return {
        vramGb: adjGb,
        vramMb: Math.round(adjGb * 1024),
        shared: false,
        source: "model-db",
      };
    }
    if (entry.vendor === "Apple" && entry.key.startsWith("apple m")) {
      const unifiedGb = Math.max(8, ram);
      return {
        vramGb: unifiedGb,
        vramMb: Math.round(unifiedGb * 1024),
        shared: true,
        source: "unified",
      };
    }
  }

  const vendor = detectGpuVendor(rawRenderer);
  if (vendor === "NVIDIA" || cleanLower.includes("radeon rx") || cleanLower.includes("radeon pro")) {
    return { vramGb: 8, vramMb: 8192, shared: false, source: "model-db" };
  }

  const sharedGb = Math.max(1, Math.min(8, Math.round(ram * 0.5 * 10) / 10));
  return {
    vramGb: sharedGb,
    vramMb: Math.round(sharedGb * 1024),
    shared: true,
    source: "shared-estimate",
  };
}

/**
 * Estimate live WebGL scene VRAM usage in MB from render target, shadow map, and loaded assets.
 */
export function estimateSceneVramMb({
  rtWidth = 1280,
  rtHeight = 720,
  rtSamples = 0,
  rtHasDepth = false,
  shadowPx = 1024,
  textures = 12,
  geometries = 24,
  triangles = 100000,
  realisticTextures = false,
} = {}) {
  const pixels = Math.max(1, rtWidth * rtHeight);
  const sampleMult = rtSamples > 0 ? rtSamples + 1 : 1;
  const rtBytes = pixels * (8 * sampleMult + (rtHasDepth ? 8 : 4));
  const shadowBytes = shadowPx > 0 ? shadowPx * shadowPx * 4 : 0;
  const baseTexMb = realisticTextures ? 68 : 42;
  const perTexMb = Math.max(0, textures) * 1.65;
  const geomMb = Math.max(0, geometries) * 0.35 + (Math.max(0, triangles) * 36) / 1048576;
  const totalMb = (rtBytes + shadowBytes) / 1048576 + baseTexMb + perTexMb + geomMb;
  return Math.round(totalMb * 10) / 10;
}

/**
 * Pick a level for "auto" from what the browser reports and the `detect-gpu` tier catalog.
 * @param {{gpu?:string, cores?:number, memoryGb?:number, mobile?:boolean}} hw
 */
export function detectGraphicsLevel(hw = {}) {
  const gpu = String(hw.gpu || "");
  const cores = Number(hw.cores) || 4;
  const mem = Number(hw.memoryGb) || 4;
  if (hw.mobile || cores <= 2 || mem <= 2) return "low";
  if (Number(hw.cores) <= 4 && Number(hw.memoryGb) <= 4 && hw.cores && hw.memoryGb) return "low";

  // Trigger async detect-gpu cache warmup in browser environments
  if (gpu && !gpuTierCache.has(gpu) && typeof window !== "undefined") {
    void probeGpuTier(hw);
  }

  const cachedTier = gpuTierCache.get(gpu);
  const entry = lookupCatalogEntry(gpu);
  const tier = cachedTier ? cachedTier.tier : entry ? entry.tier : 2;

  if (tier <= 0) return "low";
  if (tier >= 3 && (!entry?.shared || entry?.vendor === "Apple") && cores >= 8) return "high";
  if (tier === 1 || entry?.shared) return cores >= 8 ? "medium" : "low";
  return "medium";
}

/**
 * Build a complete hardware & memory profile from browser WebGL + optional local OS probe.
 */
export function buildHardwareSummary(hw = {}) {
  const gpuRaw = String(hw.gpu || "");
  const gpuName = cleanGpuModelName(gpuRaw);
  const vendor = detectGpuVendor(gpuRaw);
  const cores = Math.max(1, Number(hw.cores) || 4);
  const osRamGb = Number(hw.osRamGb);
  const navRamGb = Number(hw.memoryGb) || 8;
  const ramGb = Number.isFinite(osRamGb) && osRamGb > 0 ? Math.round(osRamGb * 10) / 10 : navRamGb;
  const ramCappedByBrowser = !(Number.isFinite(osRamGb) && osRamGb > 0) && navRamGb >= 8;
  const freeRamGb =
    Number.isFinite(Number(hw.osFreeRamGb)) && Number(hw.osFreeRamGb) > 0
      ? Math.round(Number(hw.osFreeRamGb) * 10) / 10
      : null;
  const vram = estimateGpuVram(gpuRaw, Number(hw.vramMb) || Number(hw.driverVramMb) || 0, ramGb);
  const recommendedLevel = detectGraphicsLevel({ ...hw, memoryGb: ramGb });
  const entry = lookupCatalogEntry(gpuRaw);
  const supportsHardwareRt = Boolean(entry?.rt);
  const supportsDlss = vendor === "NVIDIA" || (entry ? entry.tier > 0 : true);
  return {
    gpuName,
    gpuRaw,
    vendor,
    vramGb: vram.vramGb,
    vramMb: vram.vramMb,
    vramShared: vram.shared,
    vramSource: vram.source,
    ramGb,
    freeRamGb,
    ramCappedByBrowser,
    cpuModel: String(hw.cpuModel || "").trim(),
    cores,
    maxTextureSize: Number(hw.maxTextureSize) || 4096,
    recommendedLevel,
    autoLevel: recommendedLevel,
    supportsHardwareRt,
    supportsDlss,
  };
}

/**
 * @param {object} cfg normalized settings (see dev-settings.js)
 * @param {object} hw  hardware hints for "auto"
 * @returns {object} one preset with the per-option overrides applied, plus `level` and `fpsLimit`
 */
export function resolveGraphics(cfg = {}, hw = {}) {
  let level = GRAPHICS_LEVELS.includes(cfg.quality) ? cfg.quality : "auto";
  if (level === "auto") level = detectGraphicsLevel(hw);
  if (cfg.superGraphics) level = "ultra";
  const out = { ...GRAPHICS_PRESETS[level], level };
  if (SHADOW_OPTIONS[cfg.gfxShadows]) Object.assign(out, SHADOW_OPTIONS[cfg.gfxShadows]);
  if (VIEW_DISTANCE_OPTIONS[cfg.gfxViewDistance]) out.detailRadiusM = VIEW_DISTANCE_OPTIONS[cfg.gfxViewDistance];
  const scale = Number(cfg.gfxRenderScale);
  if (RENDER_SCALE_OPTIONS.includes(scale)) {
    out.renderScale = scale;
    out.minScale = Math.min(out.minScale, scale);
    out.adaptive = false;
  }
  const aa = cfg.gfxAntialias === "auto" || cfg.gfxAntialias == null ? NaN : Number(cfg.gfxAntialias);
  if (ANTIALIAS_OPTIONS.includes(aa)) out.msaa = aa;
  out.lodMidM = Math.min(out.lodMidM, out.detailRadiusM);
  out.lodNearM = Math.min(out.lodNearM, out.lodMidM);
  out.fpsLimit = FPS_LIMIT_OPTIONS.includes(Number(cfg.fpsLimit)) ? Number(cfg.fpsLimit) : 0;
  return out;
}

/** Grid segments for a terrain chunk `d` metres away. */
export function chunkSegmentsFor(gfx, d) {
  return d < gfx.lodNearM ? gfx.lodSegs[0] : d < gfx.lodMidM ? gfx.lodSegs[1] : gfx.lodSegs[2];
}
