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
const INTEGRATED_GPU = /intel|mali|adreno|powervr|videocore|apple gpu/i;
const DISCRETE_GPU = /nvidia|geforce|rtx|gtx|radeon|amd|arc\b|apple m\d/i;

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
