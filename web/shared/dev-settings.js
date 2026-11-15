/**
 * Persistent developer / experimental visual & movement settings (`web/shared/dev-settings.js`).
 * Stored in `localStorage["mm-dev-settings"]` and broadcast via `mm:dev-settings`.
 */

const STORAGE_KEY = "mm-dev-settings";
export const DEV_SETTINGS_EVENT = "mm:dev-settings";

export const QUALITY_LEVELS = Object.freeze(["auto", "low", "medium", "high", "ultra"]);
// names used before the graphics presets existed
const LEGACY_QUALITY = Object.freeze({ performance: "medium", balanced: "high", quality: "high" });
const pick = (val, allowed, fallback) => (allowed.includes(String(val)) ? String(val) : fallback);
export const RT_MODES = Object.freeze(["off", "performance", "balanced", "high", "ultra"]);

export const DEFAULT_DEV_SETTINGS = Object.freeze({
  // graphics preset; "auto" picks one from the GPU (see graphics-profile.js)
  quality: "auto",
  // per-option overrides of the preset ("auto" = take the preset's value)
  gfxShadows: "auto",
  gfxViewDistance: "auto",
  gfxRenderScale: "auto",
  gfxAntialias: "auto",
  fpsLimit: 0,
  showPerf: false,
  hudTheme: "cyan",
  frameEffect: true,
  frameStrength: 0.2,
  speedMultiplier: 1.0,
  roverSpeedMultiplier: 1.0,
  superGraphics: false,
  rayTracing: false,
  rayTracingMode: "off",
  experimentalRover: false,
  realisticTextures: false,
  realisticDust: true,
  realisticPhysics: true,
  realisticWeather: true,
  dustTau: 0.5,
  dustDevil: false,
  fov: 78,
  cleanHud: false,
});

export const FULL_REALISM_PRESET = Object.freeze({
  superGraphics: true,
  rayTracing: true,
  rayTracingMode: "high",
  experimentalRover: true,
  realisticTextures: true,
  realisticDust: true,
  realisticPhysics: true,
  realisticWeather: true,
});

// Always reset Ray Tracing to OFF on startup so a previous session never boots with RT active.
try {
  if (typeof localStorage !== "undefined") {
    const bootText = localStorage.getItem(STORAGE_KEY);
    if (bootText) {
      const bootParsed = JSON.parse(bootText);
      if (bootParsed && (bootParsed.rayTracing || (bootParsed.rayTracingMode && bootParsed.rayTracingMode !== "off"))) {
        bootParsed.rayTracing = false;
        bootParsed.rayTracingMode = "off";
        localStorage.setItem(STORAGE_KEY, JSON.stringify(bootParsed));
      }
    }
  }
} catch {
  /* ignore storage errors */
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeRtModeString(val) {
  if (typeof val !== "string") return null;
  const m = val.trim().toLowerCase();
  if (m === "low" || m === "perf") return "performance";
  if (RT_MODES.includes(m)) return m;
  return null;
}

function resolveRayTracingState(raw = {}) {
  const directMode = normalizeRtModeString(raw.rayTracing);
  if (directMode) {
    return { rayTracing: directMode !== "off", rayTracingMode: directMode };
  }
  const explicitMode = normalizeRtModeString(raw.rayTracingMode);
  if (explicitMode) {
    if (raw.rayTracing === false) return { rayTracing: false, rayTracingMode: "off" };
    if (raw.rayTracing === true && explicitMode === "off") return { rayTracing: true, rayTracingMode: "high" };
    return { rayTracing: explicitMode !== "off", rayTracingMode: explicitMode };
  }
  if (raw.rayTracing !== undefined) {
    const on = Boolean(raw.rayTracing);
    return { rayTracing: on, rayTracingMode: on ? "high" : "off" };
  }
  return { rayTracing: DEFAULT_DEV_SETTINGS.rayTracing, rayTracingMode: DEFAULT_DEV_SETTINGS.rayTracingMode };
}

export function cycleRayTracingMode(current = {}) {
  const { rayTracingMode } = resolveRayTracingState(current);
  const idx = RT_MODES.indexOf(rayTracingMode);
  const nextMode = RT_MODES[(idx + 1) % RT_MODES.length] || "off";
  return { rayTracing: nextMode !== "off", rayTracingMode: nextMode };
}

export function normalizeDevSettings(raw = {}) {
  const rtState = resolveRayTracingState(raw);
  return {
    quality: pick(LEGACY_QUALITY[raw.quality] || raw.quality, QUALITY_LEVELS, DEFAULT_DEV_SETTINGS.quality),
    gfxShadows: pick(raw.gfxShadows, ["auto", "off", "low", "high", "ultra"], "auto"),
    gfxViewDistance: pick(raw.gfxViewDistance, ["auto", "near", "medium", "far", "max"], "auto"),
    gfxRenderScale: pick(raw.gfxRenderScale, ["auto", "0.5", "0.75", "1", "1.25"], "auto"),
    gfxAntialias: pick(raw.gfxAntialias, ["auto", "0", "2", "4"], "auto"),
    fpsLimit: Number(pick(raw.fpsLimit, ["0", "30", "60", "120"], "0")),
    showPerf: Boolean(raw.showPerf),
    hudTheme: ["cyan", "untitled", "mono"].includes(raw.hudTheme) ? raw.hudTheme : DEFAULT_DEV_SETTINGS.hudTheme,
    frameEffect: raw.frameEffect !== undefined ? Boolean(raw.frameEffect) : DEFAULT_DEV_SETTINGS.frameEffect,
    frameStrength: clampNum(raw.frameStrength, 0, 1.5, DEFAULT_DEV_SETTINGS.frameStrength),
    speedMultiplier: clampNum(raw.speedMultiplier, 0.5, 8.0, DEFAULT_DEV_SETTINGS.speedMultiplier),
    roverSpeedMultiplier: clampNum(raw.roverSpeedMultiplier, 0.3, 4.0, DEFAULT_DEV_SETTINGS.roverSpeedMultiplier),
    superGraphics: raw.superGraphics !== undefined ? Boolean(raw.superGraphics) : DEFAULT_DEV_SETTINGS.superGraphics,
    rayTracing: rtState.rayTracing,
    rayTracingMode: rtState.rayTracingMode,
    experimentalRover:
      raw.experimentalRover !== undefined ? Boolean(raw.experimentalRover) : DEFAULT_DEV_SETTINGS.experimentalRover,
    realisticTextures:
      raw.realisticTextures !== undefined ? Boolean(raw.realisticTextures) : DEFAULT_DEV_SETTINGS.realisticTextures,
    realisticDust: raw.realisticDust !== undefined ? Boolean(raw.realisticDust) : DEFAULT_DEV_SETTINGS.realisticDust,
    realisticPhysics:
      raw.realisticPhysics !== undefined ? Boolean(raw.realisticPhysics) : DEFAULT_DEV_SETTINGS.realisticPhysics,
    realisticWeather:
      raw.realisticWeather !== undefined ? Boolean(raw.realisticWeather) : DEFAULT_DEV_SETTINGS.realisticWeather,
    dustTau: clampNum(raw.dustTau, 0.35, 3, DEFAULT_DEV_SETTINGS.dustTau),
    dustDevil: raw.dustDevil !== undefined ? Boolean(raw.dustDevil) : DEFAULT_DEV_SETTINGS.dustDevil,
    fov: clampNum(raw.fov, 60, 110, DEFAULT_DEV_SETTINGS.fov),
    cleanHud: raw.cleanHud !== undefined ? Boolean(raw.cleanHud) : DEFAULT_DEV_SETTINGS.cleanHud,
  };
}

export function loadDevSettings() {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT_DEV_SETTINGS };
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) return { ...DEFAULT_DEV_SETTINGS };
    return normalizeDevSettings(JSON.parse(text));
  } catch {
    return { ...DEFAULT_DEV_SETTINGS };
  }
}

export function saveDevSettings(patch) {
  const nextPatch = { ...(patch || {}) };
  if (nextPatch.rayTracingMode !== undefined && nextPatch.rayTracing === undefined) {
    const mode = normalizeRtModeString(nextPatch.rayTracingMode) || "off";
    nextPatch.rayTracingMode = mode;
    nextPatch.rayTracing = mode !== "off";
  } else if (typeof nextPatch.rayTracing === "boolean" && nextPatch.rayTracingMode === undefined) {
    nextPatch.rayTracingMode = nextPatch.rayTracing ? "high" : "off";
  }
  const merged = normalizeDevSettings({ ...loadDevSettings(), ...nextPatch });
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    }
  } catch {
    /* ignore storage blocked in restricted frames */
  }
  if (typeof window !== "undefined" && typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent(DEV_SETTINGS_EVENT, { detail: merged }));
  }
  return merged;
}

export function resetDevSettings() {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
  const fresh = { ...DEFAULT_DEV_SETTINGS };
  if (typeof window !== "undefined" && typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent(DEV_SETTINGS_EVENT, { detail: fresh }));
  }
  return fresh;
}

export function subscribeDevSettings(handler) {
  if (typeof window === "undefined" || typeof handler !== "function") return () => {};
  const fn = (e) => handler(normalizeDevSettings(e?.detail || loadDevSettings()));
  window.addEventListener(DEV_SETTINGS_EVENT, fn);
  return () => window.removeEventListener(DEV_SETTINGS_EVENT, fn);
}
