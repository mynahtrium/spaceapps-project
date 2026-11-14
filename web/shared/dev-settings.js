/**
 * Persistent developer / experimental visual & movement settings (`web/shared/dev-settings.js`).
 * Stored in `localStorage["mm-dev-settings"]` and broadcast via `mm:dev-settings`.
 */

const STORAGE_KEY = "mm-dev-settings";
export const DEV_SETTINGS_EVENT = "mm:dev-settings";

export const DEFAULT_DEV_SETTINGS = Object.freeze({
  frameEffect: true,
  frameStrength: 1.0,
  speedMultiplier: 1.0,
  roverSpeedMultiplier: 1.0,
  superGraphics: false,
  experimentalRover: false,
  realisticTextures: false,
  realisticDust: true,
  realisticPhysics: true,
  realisticWeather: true,
  fov: 78,
  cleanHud: false,
});

export const FULL_REALISM_PRESET = Object.freeze({
  superGraphics: true,
  experimentalRover: true,
  realisticTextures: true,
  realisticDust: true,
  realisticPhysics: true,
  realisticWeather: true,
});

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function normalizeDevSettings(raw = {}) {
  return {
    frameEffect: raw.frameEffect !== undefined ? Boolean(raw.frameEffect) : DEFAULT_DEV_SETTINGS.frameEffect,
    frameStrength: clampNum(raw.frameStrength, 0, 1.5, DEFAULT_DEV_SETTINGS.frameStrength),
    speedMultiplier: clampNum(raw.speedMultiplier, 0.5, 8.0, DEFAULT_DEV_SETTINGS.speedMultiplier),
    roverSpeedMultiplier: clampNum(raw.roverSpeedMultiplier, 0.3, 4.0, DEFAULT_DEV_SETTINGS.roverSpeedMultiplier),
    superGraphics: raw.superGraphics !== undefined ? Boolean(raw.superGraphics) : DEFAULT_DEV_SETTINGS.superGraphics,
    experimentalRover:
      raw.experimentalRover !== undefined ? Boolean(raw.experimentalRover) : DEFAULT_DEV_SETTINGS.experimentalRover,
    realisticTextures:
      raw.realisticTextures !== undefined ? Boolean(raw.realisticTextures) : DEFAULT_DEV_SETTINGS.realisticTextures,
    realisticDust: raw.realisticDust !== undefined ? Boolean(raw.realisticDust) : DEFAULT_DEV_SETTINGS.realisticDust,
    realisticPhysics:
      raw.realisticPhysics !== undefined ? Boolean(raw.realisticPhysics) : DEFAULT_DEV_SETTINGS.realisticPhysics,
    realisticWeather:
      raw.realisticWeather !== undefined ? Boolean(raw.realisticWeather) : DEFAULT_DEV_SETTINGS.realisticWeather,
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
  const merged = normalizeDevSettings({ ...loadDevSettings(), ...(patch || {}) });
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
