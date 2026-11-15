/**
 * Cross-Controller Rumble Haptics & Sony DualSense WebHID Features (`web/shared/controller-haptics.js`).
 *
 * Provides:
 *  1. Standard Gamepad `vibrationActuator.playEffect("dual-rumble", ...)` (and `hapticActuators` fallback)
 *     with per-preset cooldown throttling for footsteps, jump/landing impact, rover wheelspin/slip,
 *     boulder/curb bump, boost, and >20° blocked slope warnings.
 *  2. Progressive WebHID enhancement for Sony DualSense (`dualsense-ts` + raw WebHID output report 0x02):
 *     - Dynamic adaptive trigger resistance (`L2` brake lock / stiffness, `R2` slope grade & wheelspin pulse).
 *     - Controller lightbar LED synced to Mars EVA safety status (cyan/green <=10° safe, amber 10-15°,
 *       red 15-20°, pulsing crimson >20° blocked / solar storm alert).
 *  3. Safe no-op in Node.js, headless environments, or unsupported browsers with zero network requests.
 */

const SONY_VENDOR_ID = 0x054c;
const DUALSENSE_PRODUCT_IDS = [0x0ce6, 0x0df2]; // DualSense & DualSense Edge

export const HAPTIC_PRESETS = {
  footstep: { duration: 32, strongMagnitude: 0.08, weakMagnitude: 0.22, cooldownMs: 120 },
  step: { duration: 32, strongMagnitude: 0.08, weakMagnitude: 0.22, cooldownMs: 120 },
  crunch: { duration: 40, strongMagnitude: 0.12, weakMagnitude: 0.28, cooldownMs: 120 },
  jump: { duration: 70, strongMagnitude: 0.25, weakMagnitude: 0.45, cooldownMs: 180 },
  takeoff: { duration: 70, strongMagnitude: 0.25, weakMagnitude: 0.45, cooldownMs: 180 },
  land: { duration: 145, strongMagnitude: 0.68, weakMagnitude: 0.52, cooldownMs: 160 },
  landing: { duration: 145, strongMagnitude: 0.68, weakMagnitude: 0.52, cooldownMs: 160 },
  wheelspin: { duration: 85, strongMagnitude: 0.22, weakMagnitude: 0.56, cooldownMs: 140 },
  slip: { duration: 85, strongMagnitude: 0.22, weakMagnitude: 0.56, cooldownMs: 140 },
  bump: { duration: 130, strongMagnitude: 0.75, weakMagnitude: 0.6, cooldownMs: 180 },
  boulder: { duration: 130, strongMagnitude: 0.75, weakMagnitude: 0.6, cooldownMs: 180 },
  curb: { duration: 115, strongMagnitude: 0.62, weakMagnitude: 0.48, cooldownMs: 160 },
  collision: { duration: 150, strongMagnitude: 0.82, weakMagnitude: 0.68, cooldownMs: 180 },
  boost: { duration: 105, strongMagnitude: 0.42, weakMagnitude: 0.68, cooldownMs: 180 },
  "slope-warning": { duration: 220, strongMagnitude: 0.85, weakMagnitude: 0.9, cooldownMs: 650 },
  blocked: { duration: 220, strongMagnitude: 0.85, weakMagnitude: 0.9, cooldownMs: 650 },
  steep: { duration: 190, strongMagnitude: 0.72, weakMagnitude: 0.8, cooldownMs: 500 },
  hazard: { duration: 240, strongMagnitude: 0.88, weakMagnitude: 0.92, cooldownMs: 650 },
  ui: { duration: 20, strongMagnitude: 0.0, weakMagnitude: 0.18, cooldownMs: 40 },
  click: { duration: 20, strongMagnitude: 0.0, weakMagnitude: 0.18, cooldownMs: 40 },
  test: { duration: 260, strongMagnitude: 0.8, weakMagnitude: 0.85, cooldownMs: 80 },
};

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/**
 * Compute Mars EVA safety lightbar color and level from slope (degrees) and storm/alert flags.
 * Follows NASA EVA ConOps lunar stand-in slope bands (<=10° green/cyan, 10-15° amber, 15-20° red, >20° blocked).
 */
export function computeSafetyLedState(input = {}) {
  if (typeof input === "string") {
    const key = input.toLowerCase();
    if (key === "blocked" || key === "storm") {
      return { level: "blocked", r: 255, g: 0, b: 40, hex: "#ff0028", pulse: true, slopeDeg: 22 };
    }
    if (key === "warning" || key === "red") {
      return { level: "warning", r: 255, g: 48, b: 32, hex: "#ff3020", pulse: false, slopeDeg: 17.5 };
    }
    if (key === "caution" || key === "amber") {
      return { level: "caution", r: 255, g: 176, b: 0, hex: "#ffb000", pulse: false, slopeDeg: 12.5 };
    }
    return { level: "safe", r: 0, g: 228, b: 184, hex: "#00e4b8", pulse: false, slopeDeg: 0 };
  }

  const slopeDeg = Math.abs(Number(input?.slopeDeg) || 0);
  const storm = Boolean(input?.solarStorm || input?.isAlert || input?.blocked);

  if (storm || slopeDeg > 20) {
    return {
      level: "blocked",
      r: 255,
      g: 0,
      b: 40,
      hex: "#ff0028",
      pulse: true,
      slopeDeg,
    };
  }
  if (slopeDeg > 15) {
    return {
      level: "warning",
      r: 255,
      g: 48,
      b: 32,
      hex: "#ff3020",
      pulse: false,
      slopeDeg,
    };
  }
  if (slopeDeg > 10) {
    return {
      level: "caution",
      r: 255,
      g: 176,
      b: 0,
      hex: "#ffb000",
      pulse: false,
      slopeDeg,
    };
  }
  return {
    level: "safe",
    r: 0,
    g: 228,
    b: 184,
    hex: "#00e4b8",
    pulse: false,
    slopeDeg,
  };
}

/**
 * Compute DualSense L2/R2 adaptive trigger resistance parameters from rover/walker telemetry.
 */
export function computeAdaptiveTriggerSpec(telemetry = {}) {
  const slopeDeg = Math.abs(Number(telemetry.slopeDeg ?? telemetry.pitchDeg) || 0);
  const wheelspin = Boolean(telemetry.wheelspin || (Number(telemetry.slipPct) || 0) > 35);
  const handbrake = Boolean(telemetry.handbrake);
  const speedKmh = Math.abs(Number(telemetry.speedKmh) || 0);

  // R2 (Throttle): continuous resistance proportional to uphill grade, or rapid vibration on wheelspin
  const r2Resistance = clamp01(slopeDeg / 25);
  const r2Mode = wheelspin ? "vibration" : slopeDeg > 4 ? "continuous" : "off";
  const r2Force = wheelspin ? 0.78 : clamp01(0.18 + r2Resistance * 0.75);
  const r2FreqHz = wheelspin ? 28 : 0;

  // L2 (Brake): rigid lock when handbrake is pulled, or speed-scaled brake pedal feedback
  const l2Mode = handbrake ? "rigid-lock" : speedKmh > 2 ? "section" : "off";
  const l2Force = handbrake ? 0.95 : clamp01(0.25 + (speedKmh / 45) * 0.65);

  return {
    l2: { mode: l2Mode, startPosition: 0.15, force: Number(l2Force.toFixed(2)) },
    r2: { mode: r2Mode, startPosition: 0.12, force: Number(r2Force.toFixed(2)), frequencyHz: r2FreqHz },
  };
}

export class ControllerHapticsManager {
  constructor() {
    this.cooldownMap = new Map();
    this.lastEvent = null;
    this.safetyLedState = computeSafetyLedState({ slopeDeg: 0 });
    this.adaptiveTriggerState = computeAdaptiveTriggerSpec({});
    this.hidDevice = null;
    this.dualsenseInstance = null;
    this.dualsenseModuleLoaded = false;
  }

  resetCooldowns() {
    this.cooldownMap.clear();
    this.lastEvent = null;
  }

  /**
   * Fire dual-rumble haptic effect on the active Gamepad and/or connected DualSense WebHID device.
   */
  triggerHaptic(pad, presetOrSpec = "ui", intensity = 1, options = {}) {
    if (options.enabled === false) return false;
    const scale = clamp01(intensity);
    if (scale <= 0.01) return false;

    const key = typeof presetOrSpec === "string" ? presetOrSpec.toLowerCase() : "custom";
    const base =
      typeof presetOrSpec === "object" && presetOrSpec !== null
        ? {
            duration: Number(presetOrSpec.duration) || 80,
            strongMagnitude: clamp01(presetOrSpec.strongMagnitude ?? 0.5),
            weakMagnitude: clamp01(presetOrSpec.weakMagnitude ?? 0.5),
            cooldownMs: Number(presetOrSpec.cooldownMs) || 80,
          }
        : HAPTIC_PRESETS[key] || HAPTIC_PRESETS.ui;

    const t = nowMs();
    const force = Boolean(options.force);
    const prevT = this.cooldownMap.get(key) ?? -Infinity;
    if (!force && t - prevT < base.cooldownMs) {
      return false;
    }

    const duration = Math.max(15, Math.min(1000, Math.round(base.duration * (0.75 + 0.25 * scale))));
    const strongMagnitude = Number(clamp01(base.strongMagnitude * scale).toFixed(3));
    const weakMagnitude = Number(clamp01(base.weakMagnitude * scale).toFixed(3));

    let played = false;

    // 1. Standard W3C Gamepad vibrationActuator ("dual-rumble" / "trigger-rumble")
    const actuator = pad?.vibrationActuator;
    if (actuator && typeof actuator.playEffect === "function") {
      try {
        const effectType = actuator.type || "dual-rumble";
        const res = actuator.playEffect(effectType, {
          startDelay: 0,
          duration,
          strongMagnitude,
          weakMagnitude,
        });
        if (res && typeof res.catch === "function") res.catch(() => {});
        played = true;
      } catch {
        /* ignore unsupported actuator errors */
      }
    } else if (Array.isArray(pad?.hapticActuators) && pad.hapticActuators[0]?.pulse) {
      // 2. Legacy Firefox GamepadHapticActuator.pulse(value, duration)
      try {
        const mag = Math.max(strongMagnitude, weakMagnitude);
        const res = pad.hapticActuators[0].pulse(mag, duration);
        if (res && typeof res.catch === "function") res.catch(() => {});
        played = true;
      } catch {
        /* ignore */
      }
    }

    // 3. DualSense WebHID rumble if paired
    if (this.hidDevice?.opened) {
      this._sendDualSenseOutputReport({
        rumbleStrong: strongMagnitude,
        rumbleWeak: weakMagnitude,
      });
      played = true;
    }

    if (played) {
      this.cooldownMap.set(key, t);
      this.lastEvent = { preset: key, duration, strongMagnitude, weakMagnitude, timestamp: t };
    }
    return played;
  }

  /**
   * Update DualSense LED lightbar color and state from Mars EVA slope & space-weather alerts.
   */
  setSafetyLedState(input) {
    const next = computeSafetyLedState(input);
    this.safetyLedState = next;
    if (this.dualsenseInstance?.hid?.setLightbar) {
      try {
        this.dualsenseInstance.hid.setLightbar(next.r, next.g, next.b);
      } catch {
        /* fallback to raw report */
      }
    }
    if (this.hidDevice?.opened) {
      this._sendDualSenseOutputReport({});
    }
    return next;
  }

  /**
   * Modulate L2/R2 adaptive trigger resistance from live rover or EVA slope telemetry.
   */
  updateAdaptiveTriggers(telemetry = {}) {
    const spec = computeAdaptiveTriggerSpec(telemetry);
    this.adaptiveTriggerState = spec;
    if (this.hidDevice?.opened) {
      this._sendDualSenseOutputReport({});
    }
    return spec;
  }

  get dualsenseConnected() {
    return Boolean(this.hidDevice?.opened || this.dualsenseInstance);
  }

  /**
   * Connect to a Sony DualSense / DualSense Edge controller over WebHID (`navigator.hid`),
   * progressively loading `dualsense-ts` when available and configuring lightbar + adaptive triggers.
   */
  async connectDualSenseWebHID() {
    if (typeof navigator === "undefined" || !navigator.hid || typeof navigator.hid.requestDevice !== "function") {
      return false;
    }
    try {
      // Attempt optional dynamic import of dualsense-ts from local node_modules if present
      if (!this.dualsenseModuleLoaded) {
        this.dualsenseModuleLoaded = true;
        try {
          const mod = await import("dualsense-ts").catch(() => null);
          if (mod?.Dualsense) {
            this.dualsenseInstance = new mod.Dualsense();
          }
        } catch {
          /* local WebHID report path handles DualSense directly */
        }
      }

      const devices = await navigator.hid.requestDevice({
        filters: DUALSENSE_PRODUCT_IDS.map((productId) => ({
          vendorId: SONY_VENDOR_ID,
          productId,
        })),
      });
      const device = Array.isArray(devices) ? devices[0] : null;
      if (!device) return false;
      if (!device.opened) {
        await device.open();
      }
      this.hidDevice = device;
      this._sendDualSenseOutputReport({});
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send USB WebHID output report 0x02 to a connected DualSense controller for
   * adaptive triggers (L2/R2), rumble motors, and RGB lightbar.
   */
  _sendDualSenseOutputReport({ rumbleStrong = 0, rumbleWeak = 0 } = {}) {
    if (!this.hidDevice || !this.hidDevice.opened || typeof this.hidDevice.sendReport !== "function") {
      return false;
    }
    try {
      const report = new Uint8Array(47);
      // Feature flags: byte 0 = 0xFF (enable rumble, triggers), byte 1 = 0x04 (lightbar RGB)
      report[0] = 0xff;
      report[1] = 0x04;
      report[2] = Math.round(clamp01(rumbleWeak) * 255);
      report[3] = Math.round(clamp01(rumbleStrong) * 255);

      // R2 adaptive trigger (bytes 10..20)
      const r2 = this.adaptiveTriggerState.r2;
      if (r2.mode === "vibration") {
        report[10] = 0x06;
        report[11] = Math.round(r2.startPosition * 255);
        report[12] = Math.round(r2.force * 255);
        report[13] = Math.max(1, Math.min(255, Math.round(r2.frequencyHz || 25)));
      } else if (r2.mode === "continuous") {
        report[10] = 0x01;
        report[11] = Math.round(r2.startPosition * 255);
        report[12] = Math.round(r2.force * 255);
      } else {
        report[10] = 0x05; // Off / normal linear travel
      }

      // L2 adaptive trigger (bytes 21..31)
      const l2 = this.adaptiveTriggerState.l2;
      if (l2.mode === "rigid-lock" || l2.mode === "section") {
        report[21] = 0x02;
        report[22] = Math.round(l2.startPosition * 255);
        report[23] = 0x90;
        report[24] = Math.round(l2.force * 255);
      } else {
        report[21] = 0x05;
      }

      // Lightbar RGB (bytes 44, 45, 46)
      const led = this.safetyLedState;
      const pulseScale = led.pulse ? 0.55 + 0.45 * Math.sin(nowMs() * 0.012) : 1;
      report[44] = Math.round(led.r * pulseScale);
      report[45] = Math.round(led.g * pulseScale);
      report[46] = Math.round(led.b * pulseScale);

      const p = this.hidDevice.sendReport(0x02, report);
      if (p && typeof p.catch === "function") p.catch(() => {});
      return true;
    } catch {
      return false;
    }
  }
}
