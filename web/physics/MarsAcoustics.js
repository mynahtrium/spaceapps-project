/**
 * CO2 speed of sound and a distance low-pass. Pure functions.
 * The visor does not run a synth; nothing in the scene plays audio yet.
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
