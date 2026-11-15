/**
 * Graphics presets for the 3D EVA view (`web/shared/graphics-profile.js`).
 * `resolveGraphics(cfg, hw)` turns the stored settings into the numbers the renderer uses.
 * Pure data and maths: no DOM, no three.js, so it runs under `node --test`.
 */

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

const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render/i;
const INTEGRATED_GPU = /intel|mali|adreno|powervr|videocore|apple gpu|vega \d|radeon\(tm\) graphics|radeon graphics/i;
const DISCRETE_GPU = /nvidia|geforce|rtx|gtx|radeon rx|radeon pro|arc\b|apple m\d/i;

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

export function detectGpuVendor(rawRenderer = "") {
  const s = String(rawRenderer || "");
  if (/nvidia|geforce|rtx|gtx|quadro/i.test(s)) return "NVIDIA";
  if (/amd|radeon|ryzen/i.test(s)) return "AMD";
  if (/apple/i.test(s)) return "Apple";
  if (/intel|iris|uhd|hd graphics|arc\b/i.test(s)) return "Intel";
  if (/qualcomm|adreno/i.test(s)) return "Qualcomm";
  if (/arm|mali/i.test(s)) return "ARM";
  return "Generic";
}

const GPU_VRAM_RULES = [
  [/rtx\s*5090/i, 32, false],
  [/rtx\s*(?:4090|3090)/i, 24, false],
  [/rx\s*7900\s*xtx/i, 24, false],
  [/rx\s*7900\s*xt\b/i, 20, false],
  [/rtx\s*(?:5080|4080|4070\s*ti\s*super|4060\s*ti\s*16)/i, 16, false],
  [/rx\s*(?:7900\s*gre|7800\s*xt|6950|6900|6800|7600\s*xt)/i, 16, false],
  [/arc\s*a770/i, 16, false],
  [/rtx\s*(?:4070|3080\s*ti|3080\s*12|3060\b(?!\s*ti))/i, 12, false],
  [/rx\s*(?:7700\s*xt|6750\s*xt|6700\s*xt)/i, 12, false],
  [/rtx\s*3080\b/i, 10, false],
  [/rtx\s*(?:4060|3070|3060\s*ti|2080|2070|2060\s*super)/i, 8, false],
  [/gtx\s*(?:1080|1070)/i, 8, false],
  [/rx\s*(?:7600|6650|6600|5700|5600|580\b)/i, 8, false],
  [/arc\s*(?:a750|a580)/i, 8, false],
  [/rtx\s*(?:4050|3060\s*laptop|2060\b|3050\s*6)/i, 6, false],
  [/gtx\s*(?:1660|1060)/i, 6, false],
  [/rtx\s*3050/i, 4, false],
  [/gtx\s*(?:1650|1050|970|960)/i, 4, false],
  [/rx\s*(?:6500|6400|5500|570\b|560\b)/i, 4, false],
  [/mx\s*[12345]\d\d/i, 2, false],
];

/**
 * Estimate GPU VRAM in GB & MB from driver memory extension, OS probe, or GPU model table.
 * @param {string} rawRenderer
 * @param {number} [driverVramMb=0]
 * @param {number} [systemRamGb=8]
 */
export function estimateGpuVram(rawRenderer = "", driverVramMb = 0, systemRamGb = 8) {
  const clean = cleanGpuModelName(rawRenderer);
  const ram = Number.isFinite(Number(systemRamGb)) && Number(systemRamGb) > 0 ? Number(systemRamGb) : 8;
  if (Number.isFinite(driverVramMb) && driverVramMb >= 256) {
    const gb = Math.round((driverVramMb / 1024) * 10) / 10;
    const isShared = INTEGRATED_GPU.test(clean) && !/rtx|gtx|radeon rx/i.test(clean);
    return {
      vramGb: gb,
      vramMb: Math.round(driverVramMb),
      shared: isShared,
      source: "driver",
    };
  }
  for (const [regex, gb, shared] of GPU_VRAM_RULES) {
    if (regex.test(clean) || regex.test(rawRenderer)) {
      // Laptop variants of 4080/4070 have 12 GB / 8 GB
      let adjGb = gb;
      if (/laptop|mobile|max-q/i.test(clean)) {
        if (/rtx\s*4090/i.test(clean)) adjGb = 16;
        else if (/rtx\s*4080/i.test(clean)) adjGb = 12;
        else if (/rtx\s*4070/i.test(clean)) adjGb = 8;
      }
      return {
        vramGb: adjGb,
        vramMb: Math.round(adjGb * 1024),
        shared,
        source: "model-db",
      };
    }
  }
  if (/apple\s*m[1-9]/i.test(clean)) {
    const unifiedGb = Math.max(8, ram);
    return {
      vramGb: unifiedGb,
      vramMb: Math.round(unifiedGb * 1024),
      shared: true,
      source: "unified",
    };
  }
  if (DISCRETE_GPU.test(clean) && !INTEGRATED_GPU.test(clean)) {
    return { vramGb: 8, vramMb: 8192, shared: false, source: "model-db" };
  }
  // Integrated GPU (Intel UHD/Iris, AMD Radeon Vega/780M) shares up to ~50% of system RAM
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
  // HalfFloat RGBA (8 bytes/px) + depth/stencil (4 bytes/px)
  const rtBytes = pixels * (8 * sampleMult + (rtHasDepth ? 8 : 4));
  const shadowBytes = shadowPx > 0 ? shadowPx * shadowPx * 4 : 0;
  // HiRISE corridor overview + detail chunks + PBR normal/albedo maps + suit/rover GLB textures
  const baseTexMb = realisticTextures ? 68 : 42;
  const perTexMb = Math.max(0, textures) * 1.65;
  const geomMb = Math.max(0, geometries) * 0.35 + (Math.max(0, triangles) * 36) / 1048576;
  const totalMb = (rtBytes + shadowBytes) / 1048576 + baseTexMb + perTexMb + geomMb;
  return Math.round(totalMb * 10) / 10;
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
  const freeRamGb = Number.isFinite(Number(hw.osFreeRamGb)) && Number(hw.osFreeRamGb) > 0
    ? Math.round(Number(hw.osFreeRamGb) * 10) / 10
    : null;
  const vram = estimateGpuVram(gpuRaw, Number(hw.vramMb) || Number(hw.driverVramMb) || 0, ramGb);
  const recommendedLevel = detectGraphicsLevel({ ...hw, memoryGb: ramGb });
  const supportsHardwareRt = /rtx|radeon rx\s*[6789]\d\d\d|arc\s*a[57]\d\d|apple\s*m[34]/i.test(gpuName);
  const supportsDlss = /nvidia|geforce|rtx|gtx/i.test(gpuName) || !SOFTWARE_GPU.test(gpuName);
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
 * Pick a level for "auto" from what the browser reports.
 * @param {{gpu?:string, cores?:number, memoryGb?:number, mobile?:boolean}} hw
 */
export function detectGraphicsLevel(hw = {}) {
  const gpu = String(hw.gpu || "");
  const cores = Number(hw.cores) || 4;
  const mem = Number(hw.memoryGb) || 4;
  if (SOFTWARE_GPU.test(gpu) || hw.mobile || cores <= 2 || mem <= 2) return "low";
  // a small machine (4 threads and 4 GB or less) has a small GPU, whatever its name
  if (Number(hw.cores) <= 4 && Number(hw.memoryGb) <= 4 && hw.cores && hw.memoryGb) return "low";
  if (DISCRETE_GPU.test(gpu) && cores >= 8) return "high";
  if (INTEGRATED_GPU.test(gpu) && !DISCRETE_GPU.test(gpu)) return cores >= 8 ? "medium" : "low";
  return "medium";
}

/**
 * @param {object} cfg normalized settings (see dev-settings.js)
 * @param {object} hw  hardware hints for "auto"
 * @returns {object} one preset with the per-option overrides applied, plus `level` and `fpsLimit`
 */
export function resolveGraphics(cfg = {}, hw = {}) {
  let level = GRAPHICS_LEVELS.includes(cfg.quality) ? cfg.quality : "auto";
  if (level === "auto") level = detectGraphicsLevel(hw);
  // "Super graphics" is the old name for the ultra preset; it still forces it.
  if (cfg.superGraphics) level = "ultra";
  const out = { ...GRAPHICS_PRESETS[level], level };
  if (SHADOW_OPTIONS[cfg.gfxShadows]) Object.assign(out, SHADOW_OPTIONS[cfg.gfxShadows]);
  if (VIEW_DISTANCE_OPTIONS[cfg.gfxViewDistance]) out.detailRadiusM = VIEW_DISTANCE_OPTIONS[cfg.gfxViewDistance];
  const scale = Number(cfg.gfxRenderScale);
  if (RENDER_SCALE_OPTIONS.includes(scale)) {
    out.renderScale = scale;
    out.minScale = Math.min(out.minScale, scale);
    out.adaptive = false; // a resolution chosen by hand stays put
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
