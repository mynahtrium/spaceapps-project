/**
 * Suited-walker targets. Speeds are still placeholders.
 * Joint neutrals are a rest bias for the procedural rig, not a torque ragdoll.
 */

import { MARS_GEODESY, SUIT_BODY } from "./MarsConstants.js";
import { marsGravityMs2 } from "./MarsGravityField.js";

const DEG = Math.PI / 180;

export const WALK_SPEED_MS = 1.4;
export const RUN_SPEED_MS = 2.5;
export const JUMP_SPEED_MS = 1.7;
export const RESPONSE_TAU_S = 0.22;

export const HIP_NEUTRAL_RAD = 12 * DEG;
export const KNEE_NEUTRAL_RAD = 15 * DEG;
export const SHOULDER_ABDUCT_RAD = 14 * DEG;
export const SHOULDER_FLEX_RAD = 19 * DEG;

const GALE_G = marsGravityMs2(MARS_GEODESY.GALE_ANCHOR_LAT_DEG, -4500);

/** Walk-to-lope speed at Gale, Froude 0.5. About 1.31 m/s. */
export const FROUDE_LOPE_MS = Math.sqrt(0.5 * GALE_G * SUIT_BODY.legLengthM);

export function targetSpeedMs(run, speedMultiplier = 1) {
  const base = run ? RUN_SPEED_MS : WALK_SPEED_MS;
  const scale = Number.isFinite(speedMultiplier) ? speedMultiplier : 1;
  return base * scale;
}

/**
 * Landing crouch, metres (negative is down). t is seconds since touchdown.
 * Spec: Δy = -min(0.22, v_imp/8.5) * sin(π t / T) * exp(-3t/T)
 */
export function landingCrouchM(impactSpeed, t, tRecover = 0.45) {
  if (!(impactSpeed > 0) || !(tRecover > 0) || t < 0 || t > tRecover) return 0;
  const amp = Math.min(0.22, impactSpeed / 8.5);
  const u = t / tRecover;
  return -amp * Math.sin(Math.PI * u) * Math.exp(-3 * u);
}

/** Uphill torso lean, radians. 0.08 rad baseline plus grade. */
export function torsoLeanRad(uphillSlopeRad) {
  const s = Math.max(0, uphillSlopeRad || 0);
  return 0.08 + 0.45 * Math.sin(s);
}
