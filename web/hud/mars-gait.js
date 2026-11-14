/**
 * Pure kinematics for reduced-gravity (1/3g) Martian walking and running.
 * Calibrated to EwhaGlab (2017) "Full-body Animation of Human Locomotion in
 * Reduced Gravity using Physics-based Control" (IPC + Froude scaling):
 *  - Mars 1/3g walking: 0.80 m/s target speed, 1.08 m stride length (~0.74 strides/s)
 *  - Mars 1/3g running: 1.75 m stride length
 */

export const MARS_WALK_VELOCITY_MS = 0.8;
export const MARS_WALK_STRIDE_M = 1.08;
export const MARS_RUN_STRIDE_M = 1.75;

/**
 * Compute full-body Martian locomotion joint angles and inverted-pendulum
 * pelvis/camera buoyancy at a given normalized gait phase (radians).
 */
export function computeMarsGaitSample({
  phase = 0,
  amount = 0,
  air = 0,
  dirF = 1,
  dirS = 0,
  running = false,
} = {}) {
  const a = amount;
  const fw = dirF;
  const sd = dirS;
  const side = Math.abs(sd);
  const s = Math.sin(phase);
  const c = Math.cos(phase);

  const legPose = (p) => {
    const sp = Math.sin(p);
    const cp = Math.cos(p);
    // Compact 1.08 m stride hip swing with subtle push-off linger at late stance
    const hip = a * (running ? 0.36 : 0.27) * (sp + 0.12 * Math.sin(2 * p)) * fw;
    // Swing clearance bend + soft post-heel-strike loading compliance under 1/3g
    const swingBend = Math.pow(Math.max(0, cp), 1.55) * (running ? 0.88 : 0.66) * (1 - 0.25 * side);
    const loadFlex = Math.max(0, Math.sin(p - 0.55)) * Math.max(0, -cp) * 0.22 * (1 - 0.35 * side);
    const knee = a * (0.06 + swingBend + loadFlex);
    const toePush = -Math.max(0, -sp) * 0.2 * fw * (1 - 0.5 * side);
    const heelReach = Math.max(0, sp) * 0.14 * fw * (1 - 0.5 * side);
    const ankle = -(hip - knee) * 0.78 + a * (toePush + heelReach);
    return { hip, knee, ankle };
  };

  const L = legPose(phase);
  const R = legPose(phase + Math.PI);

  // Side-stepping abduction without crossing feet
  const reach = a * 0.24 * side;
  const out = (p) => 0.5 + 0.5 * Math.sin(p);
  const leadR = sd > 0;
  const abdR = reach * (leadR ? out(phase + Math.PI) : 0.35 * out(phase + Math.PI));
  const abdL = reach * (leadR ? 0.35 * out(phase) : out(phase));

  // Buoyant 1/3g inverted-pendulum arc: rise softly over mid-stance, gentle cushion on plant
  const pelvisYOffset =
    a * ((running ? 0.042 : 0.026) * (c * c) - 0.018 * (s * s)) - air * 0.035;
  const pelvisYaw = a * 0.055 * s * Math.abs(fw);
  const pelvisRoll = a * 0.028 * c - sd * a * 0.035;
  const spineYaw = -a * 0.04 * s;
  // Subtle ~5 deg forward torso lean balancing the rear PLSS backpack
  const spinePitch = a * (running ? 0.14 : 0.088) * (0.85 + 0.15 * Math.abs(fw));
  const chestYaw = -a * 0.025 * s;

  // Restrained suited counter-swing with natural slight outward arm posture
  const swing = a * (running ? 0.28 : 0.13) * Math.abs(fw);
  const armSign = Math.sign(fw || 1);
  const armOut = a * (0.055 + side * 0.12) + air * 0.26;
  const armSwingL = -swing * s * armSign + air * 0.3;
  const armSwingR = swing * s * armSign + air * 0.3;
  const headYaw = a * 0.018 * s;

  return {
    L,
    R,
    abdL,
    abdR,
    pelvisYOffset,
    pelvisYaw,
    pelvisRoll,
    spineYaw,
    spinePitch,
    chestYaw,
    armOut,
    armSwingL,
    armSwingR,
    headYaw,
    tuck: air * 0.45,
  };
}

/**
 * Helmet camera first-person sway coupled to the 1/3g inverted-pendulum stride.
 */
export function computeMarsCameraSway(phase = 0, amount = 0) {
  const amt = Math.min(1.25, Math.max(0, amount));
  // Buoyant upward crest at mid-stance (cos(2*ph)), soft plant trough, calm roll
  const swayY = (Math.cos(phase * 2) * 0.011 + 0.004) * amt || 0;
  const swayX = Math.sin(phase) * 0.0042 * amt || 0;
  const swayRoll = Math.sin(phase) * 0.0032 * amt || 0;
  return { swayY, swayX, swayRoll };
}

/**
 * Footstep dust emission intensity from ground speed.
 * Running keeps full vigorous intensity (1.55), while Mars walking (~0.80 m/s)
 * drops to 0.40 (~60% less dust kick-up than running/prior walk).
 */
export function computeFootstepDustIntensity(
  groundSpeed,
  walkSpeed = MARS_WALK_VELOCITY_MS,
  runSpeed = 2.25
) {
  if (!Number.isFinite(groundSpeed) || groundSpeed <= 0.05) return 0;
  const walkCeiling = walkSpeed * 1.35;
  const runFloor = runSpeed * 0.72;
  if (groundSpeed <= walkCeiling) return 0.4;
  if (groundSpeed >= runFloor) return 1.55;
  const t = (groundSpeed - walkCeiling) / Math.max(1e-4, runFloor - walkCeiling);
  return 0.4 + t * (1.55 - 0.4);
}
