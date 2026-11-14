/**
 * Gravity-adjusted Pandolf stand-in. Not a validated PLSS.
 * Rest (~0.35 L/min), level mudstone walking (~0.85 L/min), and an 18° sandy
 * climb (~2.4 L/min) match 1.5 * body mass plus the gravity-scaled external
 * term only. The classic Earth standing-load term, 2(m_b+m_s)(m_s/m_b)^2,
 * is about 514 W and is left out: it is not scaled by g in the written
 * equation, and adding it misses those three anchors.
 */

import { G_EARTH_MS2, SUIT_BODY } from "./MarsConstants.js";

/**
 * @param {{ eta?: number, gMs2: number, speedMs: number, gradePercent: number }} input
 * @returns {number} watts
 */
export function metabolicPowerW(input) {
  const mb = SUIT_BODY.bodyMassKg;
  const ms = SUIT_BODY.suitMassKg;
  const eta = input.eta ?? 1;
  const gRatio = Math.max(0, (input.gMs2 ?? 3.71) / G_EARTH_MS2);
  const v = Math.max(0, input.speedMs ?? 0);
  let grade = input.gradePercent ?? 0;
  if (!Number.isFinite(grade)) grade = 0;
  let external = eta * gRatio * (mb + ms) * (1.5 * v * v + 0.35 * v * grade);
  // Steep downhill braking costs more again once the grade is below -18%.
  if (grade < -18) {
    external += eta * gRatio * (mb + ms) * 0.35 * v * (Math.abs(grade) - 18);
  }
  const power = 1.5 * mb + external;
  return Math.max(1.5 * mb, power);
}

/** Litres per minute, STPD stand-in. */
export function oxygenLitresPerMin(powerW) {
  return powerW / 348.8;
}

/**
 * Illustrative sky-view factor from 8 horizon samples.
 * Labelled shielding only — does not replace dose.json.
 * @param {(x: number, z: number) => number} sampleHeight
 */
export function skyViewFactor(sampleHeight, x, z) {
  const h0 = sampleHeight(x, z);
  const distances = [12, 28, 56, 96];
  let sum = 0;
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2;
    const cx = Math.cos(ang);
    const sz = Math.sin(ang);
    let alpha = 0;
    for (const dist of distances) {
      const dh = sampleHeight(x + cx * dist, z + sz * dist) - h0;
      const elev = Math.atan2(dh, dist);
      if (elev > alpha) alpha = elev;
    }
    const a = Math.max(0, alpha);
    sum += Math.cos(a) ** 2;
  }
  return sum / 8;
}
