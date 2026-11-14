/**
 * IAU 2015 / Gale crater constants for the visor physics core.
 * Equatorial and polar radii come from Geodesy.js so the tile datum is not copied twice.
 * Facies friction and cohesion are illustrative stand-ins, not mapped Gale geology.
 */

import { MARS_RADIUS_EQ_M, MARS_RADIUS_MEAN_M, MARS_RADIUS_POLAR_M } from "../map/Geodesy.js";

const FLATTENING = (MARS_RADIUS_EQ_M - MARS_RADIUS_POLAR_M) / MARS_RADIUS_EQ_M;

export const MARS_GEODESY = Object.freeze({
  GM_M3_S2: 4.2828372e13, // Konopliv et al. 2016
  MASS_KG: 6.4171e23,
  RADIUS_EQ_M: MARS_RADIUS_EQ_M,
  RADIUS_POLAR_N_M: MARS_RADIUS_POLAR_M,
  RADIUS_MEAN_M: MARS_RADIUS_MEAN_M,
  FLATTENING,
  ECCENTRICITY_SQ: 2 * FLATTENING - FLATTENING * FLATTENING,
  J2: 1.95545e-3,
  OMEGA_SIDEREAL_RAD_S: 7.0882181e-5,
  SIDEREAL_DAY_S: 88642.663,
  SOLAR_DAY_SOL_S: 88775.244,
  AXIAL_TILT_DEG: 25.19,
  ORBIT_ECCENTRICITY: 0.0934,
  GALE_ANCHOR_LAT_DEG: -4.8,
  GALE_ANCHOR_LON_DEG: 137.39,
  GALE_ANCHOR_ELEV_M: -3610,
});

/** Newtonian constant. Used only for the Bouguer slab term. */
export const G_NEWTON = 6.6743e-11;

/**
 * Mount Sharp lake-sediment density used with the Bouguer term.
 * Lewis et al., Science 2019, about 1,680 kg/m³.
 */
export const RHO_CRUST_KG_M3 = 1680;

/**
 * Gale gravimetry offset (m/s²). The spec starts at -0.0112.
 * With IAU radii, J2, free-air, and the 1,680 kg/m³ Bouguer term, that value
 * lands at 3.703 m/s². Shifted by +0.01425 so marsGravityMs2(-4.80, -4500)
 * matches Lewis et al. 2019, 3.717 m/s². Only this offset is tuned.
 */
export const DELTA_G_GALE_MS2 = 0.003048183;

export const G_EARTH_MS2 = 9.80665;

export const SUIT_BODY = Object.freeze({
  bodyMassKg: 82,
  suitMassKg: 98,
  totalMassKg: 180,
  comHeightM: 1.04,
  plssOffsetM: 0.085,
  inertiaPitchYawRoll: Object.freeze([34.2, 14.8, 31.5]),
  bootAreaM2: 0.045,
  eyeHeightM: 1.64,
  legLengthM: 0.92,
  thighM: 0.42,
  shinM: 0.4,
});

/** Gale surface pressure stand-in (~7.5 mbar) when REMS is not wired into the integrator. */
export const P_GALE_PA = 750;
export const M_MARS_KG_MOL = 0.04334;
export const R_UNIV_J_MOL_K = 8.31446;

/**
 * Illustrative surface classes. μ and cohesion are locomotion stand-ins,
 * not CRISM detections or measured outcrop shear strengths.
 * bekkerSinkageCm is a boot-sink depth only (no k_c / k_phi / n in the spec).
 */
export const FACIES = Object.freeze({
  MUDSTONE_SLAB: Object.freeze({
    id: "MUDSTONE_SLAB",
    cohesionKPa: 12,
    frictionDeg: 38,
    muStatic: 0.68,
    muKinetic: 0.54,
    bekkerSinkageCm: 0.1,
    eta: 1.05,
  }),
  BOXWORK_RIDGE: Object.freeze({
    id: "BOXWORK_RIDGE",
    cohesionKPa: 18,
    frictionDeg: 42,
    muStatic: 0.74,
    muKinetic: 0.6,
    bekkerSinkageCm: 0.05,
    eta: 1.1,
  }),
  SIDERITE_HOLLOW: Object.freeze({
    id: "SIDERITE_HOLLOW",
    cohesionKPa: 0.45,
    frictionDeg: 30,
    muStatic: 0.48,
    muKinetic: 0.38,
    bekkerSinkageCm: 1.8,
    eta: 1.3,
  }),
  AEOLIAN_RIPPLE: Object.freeze({
    id: "AEOLIAN_RIPPLE",
    cohesionKPa: 0.1,
    frictionDeg: 27,
    muStatic: 0.38,
    muKinetic: 0.29,
    bekkerSinkageCm: 3.8,
    eta: 1.55,
  }),
  STEEP_SCREE: Object.freeze({
    id: "STEEP_SCREE",
    cohesionKPa: 0.2,
    frictionDeg: 31,
    muStatic: 0.4,
    muKinetic: 0.3,
    bekkerSinkageCm: 2.5,
    eta: 1.75,
  }),
});

export const SLOPE_LIMIT_DEG = Object.freeze({
  standard: 20,
  strict: 15,
});
