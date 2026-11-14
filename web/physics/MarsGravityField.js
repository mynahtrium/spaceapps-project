/**
 * Oblate Mars gravity, radii of curvature, and horizon drop.
 * Latitude in is planetocentric, matching PDS / Curiosity waypoints.
 */

import {
  DELTA_G_GALE_MS2,
  G_NEWTON,
  MARS_GEODESY,
  RHO_CRUST_KG_M3,
} from "./MarsConstants.js";

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export function planetographicLatDeg(latCentricDeg) {
  const e2 = MARS_GEODESY.ECCENTRICITY_SQ;
  const phiC = latCentricDeg * DEG;
  return Math.atan(Math.tan(phiC) / (1 - e2)) * RAD;
}

function latGraphicRad(latGraphicDeg) {
  return latGraphicDeg * DEG;
}

/** Prime-vertical radius N(φ_g), metres. */
export function primeVerticalRadiusM(latGraphicDeg) {
  const e2 = MARS_GEODESY.ECCENTRICITY_SQ;
  const s = Math.sin(latGraphicRad(latGraphicDeg));
  return MARS_GEODESY.RADIUS_EQ_M / Math.sqrt(1 - e2 * s * s);
}

/** Meridional radius M(φ_g), metres. */
export function meridionalRadiusM(latGraphicDeg) {
  const e2 = MARS_GEODESY.ECCENTRICITY_SQ;
  const s = Math.sin(latGraphicRad(latGraphicDeg));
  const den = (1 - e2 * s * s) ** 1.5;
  return (MARS_GEODESY.RADIUS_EQ_M * (1 - e2)) / den;
}

/** Distance from the centre of mass to the ellipsoid surface at a planetocentric latitude. */
export function geocentricRadiusM(latCentricDeg) {
  const phiG = latGraphicRad(planetographicLatDeg(latCentricDeg));
  const N = primeVerticalRadiusM(phiG * RAD);
  const c = Math.cos(phiG);
  const s = Math.sin(phiG);
  const k = 1 - MARS_GEODESY.ECCENTRICITY_SQ;
  return N * Math.sqrt(c * c + k * k * s * s);
}

/**
 * Metres per degree at a planetocentric latitude.
 * @returns {{ northSouthM: number, eastWestM: number, planetographicLatDeg: number }}
 */
export function ellipsoidMetersPerDeg(latCentricDeg) {
  const phiG = planetographicLatDeg(latCentricDeg);
  const M = meridionalRadiusM(phiG);
  const N = primeVerticalRadiusM(phiG);
  const phiRad = phiG * DEG;
  return {
    northSouthM: DEG * M,
    eastWestM: DEG * N * Math.cos(phiRad),
    planetographicLatDeg: phiG,
    meridionalM: M,
    primeVerticalM: N,
  };
}

/**
 * Effective gravity (m/s²) at planetocentric latitude and MOLA areoid elevation.
 * Somigliana / J2 + spin, free-air, Bouguer slab, Gale offset.
 * @param {number} latCentricDeg
 * @param {number} elevM metres above the areoid (Gale is negative)
 */
export function marsGravityMs2(latCentricDeg, elevM) {
  const phi = latCentricDeg * DEG;
  const r = geocentricRadiusM(latCentricDeg);
  const a = MARS_GEODESY.RADIUS_EQ_M;
  const sin2 = Math.sin(phi) ** 2;
  const cos2 = Math.cos(phi) ** 2;
  const j2 = 1 - 1.5 * MARS_GEODESY.J2 * (a / r) ** 2 * (3 * sin2 - 1);
  const g0 =
    (MARS_GEODESY.GM_M3_S2 / (r * r)) * j2 -
    MARS_GEODESY.OMEGA_SIDEREAL_RAD_S ** 2 * r * cos2;
  const mean = MARS_GEODESY.RADIUS_MEAN_M;
  const freeAir = ((2 * MARS_GEODESY.GM_M3_S2) / mean ** 3) * elevM;
  const bouguer = 2 * Math.PI * G_NEWTON * RHO_CRUST_KG_M3 * elevM;
  return g0 - freeAir + bouguer + DELTA_G_GALE_MS2;
}

/**
 * Curvature drop (metres, negative) in a local East-Up-South frame.
 * dx is east, dz is south, both metres from the anchor.
 */
export function curvatureDropM(dx, dz, latCentricDeg = MARS_GEODESY.GALE_ANCHOR_LAT_DEG, h0 = MARS_GEODESY.GALE_ANCHOR_ELEV_M) {
  const radii = ellipsoidMetersPerDeg(latCentricDeg);
  const n = radii.primeVerticalM + h0;
  const m = radii.meridionalM + h0;
  return -(dx * dx) / (2 * n) - (dz * dz) / (2 * m);
}

/** East-Up-South Coriolis acceleration for an airborne velocity. */
export function coriolisAccel(vx, vy, vz, latCentricDeg) {
  const phi = latCentricDeg * DEG;
  const w = MARS_GEODESY.OMEGA_SIDEREAL_RAD_S;
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  return {
    x: 2 * w * (vy * c + vz * s),
    y: 2 * w * (-vx * c),
    z: 2 * w * (-vx * s),
  };
}
