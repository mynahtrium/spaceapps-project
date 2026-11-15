/**
 * Persistent developer / experimental visual & movement settings (`web/shared/dev-settings.js`).
 * Stored in `localStorage["mm-dev-settings"]` and broadcast via `mm:dev-settings`.
 * Validated and normalized via `zod`.
 */

import { z } from "zod";

const STORAGE_KEY = "mm-dev-settings";
export const DEV_SETTINGS_EVENT = "mm:dev-settings";

export const QUALITY_LEVELS = Object.freeze(["auto", "low", "medium", "high", "ultra"]);
// names used before the graphics presets existed
const LEGACY_QUALITY = Object.freeze({ performance: "medium", balanced: "high", quality: "high" });
export const AO_OPTIONS = Object.freeze(["auto", "off", "low", "high"]);
export const AA_OPTIONS = Object.freeze(["auto", "off", "fxaa", "smaa", "msaa"]);
// values the anti-aliasing option used when it was an MSAA sample count
const LEGACY_AA = Object.freeze({ 0: "off", 2: "msaa", 4: "msaa" });

export const DEFAULT_DEV_SETTINGS = Object.freeze({
  // graphics preset; "auto" picks one from the GPU (see graphics-profile.js)
  quality: "auto",
  // per-option overrides of the preset ("auto" = take the preset's value)
  gfxShadows: "auto",
  gfxViewDistance: "auto",
  gfxRenderScale: "auto",
  gfxAntialias: "auto",
  gfxAo: "auto",
  gfxBloom: "auto",
  fpsLimit: 0,
  showPerf: false,
  hudTheme: "cyan",
  frameEffect: true,
  frameStrength: 0.2,
  speedMultiplier: 1.0,
  roverSpeedMultiplier: 1.0,
  experimentalRover: false,
  realisticTextures: false,
  realisticPhysics: true,
  fov: 78,
  cleanHud: false,
  audioMuted: false,
  audioMusic: true,
});

export const FULL_REALISM_PRESET = Object.freeze({
  quality: "ultra",
  experimentalRover: true,
  realisticTextures: true,
  realisticPhysics: true,
});

const zEnumChoice = (allowed, fallback, mapLegacy = null) =>
  z
    .preprocess((v) => {
      const mapped = mapLegacy && v !== undefined && v !== null ? mapLegacy[v] || v : v;
      return String(mapped ?? fallback);
    }, z.enum(allowed))
    .catch(fallback);

const zClampedNumber = (min, max, fallback) =>
  z
    .preprocess((v) => {
      if (v === undefined || v === null || v === "") return fallback;
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(min, Math.min(max, n));
    }, z.number().min(min).max(max))
    .catch(fallback);

const zBoolWithDefault = (fallback) =>
  z.preprocess((v) => (v === undefined ? fallback : Boolean(v)), z.boolean()).catch(fallback);

const DevSettingsSchema = z.object({
  quality: zEnumChoice(QUALITY_LEVELS, DEFAULT_DEV_SETTINGS.quality, LEGACY_QUALITY),
  gfxShadows: zEnumChoice(["auto", "off", "low", "high", "ultra"], "auto"),
  gfxViewDistance: zEnumChoice(["auto", "near", "medium", "far", "max"], "auto"),
  gfxRenderScale: zEnumChoice(["auto", "0.5", "0.75", "1", "1.25"], "auto"),
  gfxAntialias: zEnumChoice(AA_OPTIONS, "auto", LEGACY_AA),
  gfxAo: zEnumChoice(AO_OPTIONS, "auto"),
  gfxBloom: zEnumChoice(["auto", "on", "off"], "auto", { true: "on", false: "off" }),
  fpsLimit: zEnumChoice(["0", "30", "60", "120"], "0").transform(Number),
  showPerf: zBoolWithDefault(DEFAULT_DEV_SETTINGS.showPerf),
  hudTheme: zEnumChoice(["cyan", "untitled", "mono"], DEFAULT_DEV_SETTINGS.hudTheme),
  frameEffect: zBoolWithDefault(DEFAULT_DEV_SETTINGS.frameEffect),
  frameStrength: zClampedNumber(0, 1.5, DEFAULT_DEV_SETTINGS.frameStrength),
  speedMultiplier: zClampedNumber(0.5, 8.0, DEFAULT_DEV_SETTINGS.speedMultiplier),
  roverSpeedMultiplier: zClampedNumber(0.3, 4.0, DEFAULT_DEV_SETTINGS.roverSpeedMultiplier),
  experimentalRover: zBoolWithDefault(DEFAULT_DEV_SETTINGS.experimentalRover),
  realisticTextures: zBoolWithDefault(DEFAULT_DEV_SETTINGS.realisticTextures),
  realisticPhysics: zBoolWithDefault(DEFAULT_DEV_SETTINGS.realisticPhysics),
  fov: zClampedNumber(60, 110, DEFAULT_DEV_SETTINGS.fov),
  cleanHud: zBoolWithDefault(DEFAULT_DEV_SETTINGS.cleanHud),
  audioMuted: zBoolWithDefault(DEFAULT_DEV_SETTINGS.audioMuted),
  audioMusic: zBoolWithDefault(DEFAULT_DEV_SETTINGS.audioMusic),
});

export function normalizeDevSettings(raw = {}) {
  const safeRaw = raw && typeof raw === "object" ? raw : {};
  // the old "Super Graphics" switch meant the ultra preset
  const quality = safeRaw.superGraphics === true ? "ultra" : safeRaw.quality;
  return DevSettingsSchema.parse({ ...safeRaw, quality });
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
