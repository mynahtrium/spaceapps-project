/**
 * Martian CO2 Atmosphere Acoustics (`web/physics/MarsAcoustics.js`).
 *
 * Models the two-branch CO2 speed of sound (~240 m/s below vibrational relaxation,
 * ~250 m/s above), classical + molecular vibrational absorption (dB/m), and distance-driven
 * low-pass filtering used by the unified `audioEngine.js` and `footsteps.js` synthesis graph.
 */

import { M_MARS_KG_MOL, R_UNIV_J_MOL_K } from "./MarsConstants.js";

function soundSpeed(gamma, tempK) {
  const T = Number.isFinite(tempK) ? tempK : 240;
  return Math.sqrt(gamma * (R_UNIV_J_MOL_K / M_MARS_KG_MOL) * T);
}

/** Low-frequency branch, gamma ≈ 1.29. About 240 m/s at 240 K. */
export function speedOfSoundLowMs(tempK) {
  return soundSpeed(1.29, tempK);
}

/** High-frequency branch, gamma ≈ 1.40. About 250 m/s at 240 K. */
export function speedOfSoundHighMs(tempK) {
  return soundSpeed(1.4, tempK);
}

/** Classical + molecular absorption, dB per metre. */
export function attenuationDbPerM(freqHz) {
  const f = Math.max(0, freqHz) / 1000;
  return 0.018 * f * f;
}

/** Distance-driven low-pass corner, hertz. */
export function lowPassCutoffHz(distanceM) {
  const d = Math.max(0, distanceM);
  return Math.max(180, 2400 * Math.exp(-d / 8));
}

/** Linear amplitude gain factor across `distanceM` in ~740 Pa Martian CO2 at `freqHz`. */
export function marsDistanceGain(distanceM, freqHz = 400) {
  const d = Math.max(0, Number(distanceM) || 0);
  const db = attenuationDbPerM(freqHz) * d;
  return Math.pow(10, -db / 20);
}

/**
 * Compute unified CO2 low-pass filter & attenuation parameters for footsteps, wind, and rover audio.
 */
export function marsAcousticFilterSpec(distanceM, { dusty = false, inHabitat = false } = {}) {
  const d = Math.max(0, Number(distanceM) || 0);
  const baseCutoff = lowPassCutoffHz(d);
  const maxCap = inHabitat ? 280 : dusty ? 680 : 380;
  const cutoffHz = Math.min(maxCap, baseCutoff);
  const attenuationDb = attenuationDbPerM(cutoffHz) * Math.max(1, d * 1.6);
  const attLinear = Math.pow(10, -attenuationDb / 20);
  const gainScale = Math.min(1, attLinear * (inHabitat ? 2.5 : 5));
  return {
    cutoffHz,
    attenuationDb,
    gainScale,
    q: dusty ? 0.55 : 0.48,
  };
}

if (typeof globalThis !== "undefined") {
  globalThis.MarsAcoustics = {
    speedOfSoundLowMs,
    speedOfSoundHighMs,
    attenuationDbPerM,
    lowPassCutoffHz,
    marsDistanceGain,
    marsAcousticFilterSpec,
  };
}
