/**
 * Suited-walker targets. Speeds are still placeholders.
 * Joint neutrals are a rest bias for the procedural rig, not a torque ragdoll.
 */

import { MARS_GEODESY, SUIT_BODY } from "./MarsConstants.js";
import { marsGravityMs2 } from "./MarsGravityField.js";

const DEG = Math.PI / 180;

/**
 * Gait speeds. Walk follows dynamic similarity (Froude number Fr = v² / gL), which is
 * how walking speed scales with gravity: at Gale g and a 0.92 m leg, Fr ≈ 0.35 gives
 * ~1.1 m/s (an Earth stroll at the same Fr is ~1.8 m/s). The Shift run is a fast
 * gameplay lope, well past the Fr 0.5 transition; a realistic suited lope would be
 * nearer 2.2 m/s. Placeholders until suit trials say otherwise.
 */
export const WALK_SPEED_MS = 1.1;
export const RUN_SPEED_MS = 4.4;
/**
 * Take-off speed, m/s. A suited push-off a bit under an unsuited Earth jump;
 * at Gale g (≈3.72 m/s²) it peaks near 0.9 m and stays up ~1.4 s. Gameplay value.
 */
export const JUMP_SPEED_MS = 2.6;
export const RESPONSE_TAU_S = 0.1;

export const HIP_NEUTRAL_RAD = 12 * DEG;
export const KNEE_NEUTRAL_RAD = 15 * DEG;
export const SHOULDER_ABDUCT_RAD = 14 * DEG;
export const SHOULDER_FLEX_RAD = 19 * DEG;

const GALE_G = marsGravityMs2(MARS_GEODESY.GALE_ANCHOR_LAT_DEG, -4500);

/** Walk-to-lope speed at Gale, Froude 0.5. About 1.31 m/s. */
export const FROUDE_LOPE_MS = Math.sqrt(0.5 * GALE_G * SUIT_BODY.legLengthM);

/**
 * Speed scale for the grade along the walking direction, degrees (+ uphill).
 * Uphill: full pace to 12°, easing to 55% (never stops you).
 * Downhill: full pace to 10°, then shorter braking steps down to 60%,
 * because low g means less boot load to brake with.
 */
export function gradeSpeedScale(slopeAlongDeg) {
  const a = slopeAlongDeg || 0;
  if (a > 12) return Math.max(0.55, 1 - (a - 12) / 60);
  if (a < -10) return Math.max(0.6, 1 - (-a - 10) / 50);
  return 1;
}

/**
 * Control left right after a landing, 0..1. Soft landings barely matter;
 * a hard one (say a 2 m drop, ~3.9 m/s at Gale) costs most of the step.
 */
export function landingControl(impactSpeed, t, tRecover) {
  if (!(impactSpeed > 1.5) || !(tRecover > 0) || t >= tRecover) return 1;
  const hit = Math.min(1, (impactSpeed - 1.5) / 3);
  return 1 - hit * 0.75 * (1 - t / tRecover);
}

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

/** Downhill brake lean, radians. Negative pitches the torso back and the caller adds knee bend. */
export function downhillLeanRad(downhillSlopeRad) {
  const s = Math.max(0, downhillSlopeRad || 0);
  return -0.06 - 0.28 * Math.sin(s);
}
