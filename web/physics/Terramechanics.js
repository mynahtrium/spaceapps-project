/**
 * Illustrative Gale facies and boot traction.
 * Geologic cohesion in the table is not applied as boot glue: a 12 kPa mudstone
 * shear over a 0.045 m² sole is rock strength, and the spec's own worked example
 * caps braking at a_max = μ_s * g (about 2.53 m/s², ~0.98 s from 2.5 m/s).
 */

import { FACIES, SUIT_BODY } from "./MarsConstants.js";

/**
 * @param {{ slopeDeg: number, laplacian: number }} sample
 * laplacian is d²h/dx² + d²h/dz² (1/m). Hollows are positive, ridges negative.
 */
export function classifyFacies(sample) {
  const slope = Math.abs(sample?.slopeDeg ?? 0);
  const lap = sample?.laplacian ?? 0;
  if (slope > 15) return FACIES.STEEP_SCREE;
  if (lap < -0.02) return FACIES.BOXWORK_RIDGE;
  if (lap > 0.05) return FACIES.AEOLIAN_RIPPLE;
  if (lap > 0.015) return FACIES.SIDERITE_HOLLOW;
  return FACIES.MUDSTONE_SLAB;
}

/** Mohr–Coulomb contact limit, newtons. Cohesion is kPa. */
export function gripForceMaxN(mu, normalN, cohesionKPa, bootAreaM2 = SUIT_BODY.bootAreaM2) {
  return mu * Math.max(0, normalN) + cohesionKPa * 1000 * bootAreaM2;
}

/**
 * Horizontal acceleration cap from boot friction, m/s².
 * Uses μ N / m, which on flat ground is μ g. Matches the spec's mudstone example.
 */
export function frictionAccelMax(mu, g, cosSlope) {
  return Math.max(0, mu) * g * Math.max(0, cosSlope);
}

/** Boot sink into the facies, metres. Not a Bekker pressure-sinkage solve. */
export function bootSinkM(facies) {
  return (facies?.bekkerSinkageCm ?? 0) / 100;
}
