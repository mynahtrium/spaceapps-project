/**
 * Cross-Platform Controller Input, Standardization, Glyphs & Haptics (`web/shared/gamepad.js`).
 *
 * Supports Xbox / XInput, Sony PlayStation (DualSense / DualShock 4), Nintendo Switch (Pro / Joy-Con),
 * 8BitDo / generic SDL / DirectInput controllers, virtual touch joysticks (`nipplejs`), rumble haptics,
 * and DualSense WebHID adaptive triggers + EVA safety lightbar.
 *
 * Preserves the W3C "standard" 17-button + 4-axis layout across browsers and OSes:
 * buttons 0 South (A/✕/B), 1 East (B/○/A), 2 West (X/□/Y), 3 North (Y/△/X),
 * 4 LB/L1/L, 5 RB/R1/R, 6 LT/L2/ZL, 7 RT/R2/ZR, 8 View/Create/−, 9 Menu/Options/+,
 * 10 LS/L3, 11 RS/R3, 12-15 D-pad up/down/left/right, 16 Guide/PS/Home;
 * axes 0/1 left stick, 2/3 right stick.
 */

import { ControllerHapticsManager } from "./controller-haptics.js";
import { createTouchControls } from "./touch-controls.js";

const STORAGE_KEY = "mm-gamepad-v4";
const LEGACY_STORAGE_KEY = "mm-gamepad-v2";

/** Fixed menu buttons: South (0) selects / confirms, East (1) goes back. */
export const CONFIRM_BUTTON = 0;
export const BACK_BUTTON = 1;

export const BUTTON_NAMES = [
  "A",
  "B",
  "X",
  "Y",
  "LB",
  "RB",
  "LT",
  "RT",
  "View (2▢)",
  "Menu (≡)",
  "LS (press)",
  "RS (press)",
  "D-pad up",
  "D-pad down",
  "D-pad left",
  "D-pad right",
  "Guide",
];

/** Console-accurate button glyph tables indexed by W3C Standard button 0..16. */
export const CONTROLLER_GLYPHS = {
  xbox: [
    "A",
    "B",
    "X",
    "Y",
    "LB",
    "RB",
    "LT",
    "RT",
    "View (2▢)",
    "Menu (≡)",
    "LS",
    "RS",
    "D-pad Up",
    "D-pad Down",
    "D-pad Left",
    "D-pad Right",
    "Xbox",
  ],
  playstation: [
    "✕",
    "○",
    "□",
    "△",
    "L1",
    "R1",
    "L2",
    "R2",
    "Create",
    "Options",
    "L3",
    "R3",
    "D-pad Up",
    "D-pad Down",
    "D-pad Left",
    "D-pad Right",
    "PS",
  ],
  switch: [
    "B",
    "A",
    "Y",
    "X",
    "L",
    "R",
    "ZL",
    "ZR",
    "−",
    "+",
    "LS",
    "RS",
    "D-pad Up",
    "D-pad Down",
    "D-pad Left",
    "D-pad Right",
    "Home",
  ],
  generic: [
    "A / ✕",
    "B / ○",
    "X / □",
    "Y / △",
    "L1 / LB",
    "R1 / RB",
    "L2 / LT",
    "R2 / RT",
    "Select",
    "Start",
    "L3",
    "R3",
    "D-pad Up",
    "D-pad Down",
    "D-pad Left",
    "D-pad Right",
    "Guide",
  ],
};

/** Rebindable in-game actions with their default Xbox / XInput buttons. */
export const ACTIONS = [
  { id: "confirm", label: "Select & Confirm (A)", button: 0 },
  { id: "back", label: "Go Back (B)", button: 1 },
  { id: "pin", label: "Drop Landmark (X)", button: 2 },
  { id: "interact", label: "Interact — vehicles & crew (Y)", button: 3 },
  { id: "jump", label: "Jump (LB) — on foot", button: 4 },
  { id: "run", label: "Sprint (RB) — on foot", button: 5 },
  { id: "brake", label: "Brake / Reverse (LT) — driving", button: 6 },
  { id: "throttle", label: "Throttle (RT) — driving", button: 7 },
  { id: "map", label: "Map (M) — 2 Squares (View)", button: 8 },
  { id: "menu", label: "ESC Menu — 3 Lines (Menu)", button: 9 },
  { id: "camera", label: "Camera Switch (L3)", button: 10 },
  { id: "lamp", label: "Flashlight / Headlights (R3)", button: 11 },
  { id: "pov", label: "Rover POV photo (D-pad up)", button: 12 },
];

const DEFAULT_BINDINGS = Object.fromEntries(ACTIONS.map((a) => [a.id, a.button]));

/** Bindings saved before L3 became the camera switch: carry the old "texture" button over. */
export function migrateBindings(saved = {}) {
  const out = { ...DEFAULT_BINDINGS };
  for (const [k, v] of Object.entries(saved || {})) {
    if (k === "texture") continue;
    if (k in DEFAULT_BINDINGS) out[k] = v;
  }
  if (saved && "texture" in saved && !("camera" in saved)) out.camera = saved.texture;
  return out;
}

export const CONTROLLER_PRESETS = {
  "eva-default": {
    id: "eva-default",
    labelEn: "EVA Default",
    labelTr: "EVA Varsayılan",
    bindings: { ...DEFAULT_BINDINGS },
    swapSticks: false,
    invertY: false,
    responseCurve: "linear",
  },
  "rover-trigger-swap": {
    id: "rover-trigger-swap",
    labelEn: "Rover Trigger Swap (LT Gas / RT Brake)",
    labelTr: "Gezgin Tetik Değişimi (LT Gaz / RT Fren)",
    bindings: { ...DEFAULT_BINDINGS, throttle: 6, brake: 7 },
    swapSticks: false,
    invertY: false,
    responseCurve: "linear",
  },
  "left-handed": {
    id: "left-handed",
    labelEn: "Left-Handed Sticks",
    labelTr: "Solak Analog Çubuklar",
    bindings: { ...DEFAULT_BINDINGS },
    swapSticks: true,
    invertY: false,
    responseCurve: "linear",
  },
  "flight-freecam": {
    id: "flight-freecam",
    labelEn: "Flight / Freecam Precision",
    labelTr: "Uçuş / Serbest Kamera",
    bindings: { ...DEFAULT_BINDINGS },
    swapSticks: false,
    invertY: true,
    responseCurve: "exponential",
  },
};

const DEFAULT_SETTINGS = {
  bindings: { ...DEFAULT_BINDINGS },
  sensitivity: 1,
  invertY: false,
  swapSticks: false,
  deadzone: 0.15,
  triggerDeadzone: 0,
  responseCurve: "linear",
  preset: "eva-default",
  glyphFamily: "auto",
  hapticsEnabled: true,
  touchControls: false,
  deviceProfiles: {},
};

/**
 * Detect controller family (`xbox` | `playstation` | `switch` | `generic`) from Gamepad.id string.
 */
export function detectControllerFamily(id) {
  if (!id || typeof id !== "string") return "xbox";
  const s = id.toLowerCase();
  if (/xbox|xinput|microsoft|045e/i.test(s)) {
    return "xbox";
  }
  if (/nintendo|switch|joy-con|pro controller|057e/i.test(s)) {
    return "switch";
  }
  if (/dualsense|dualshock|ps[345]|playstation|054c|wireless controller|sony/i.test(s)) {
    return "playstation";
  }
  return "generic";
}

function readRawBtn(btn) {
  if (btn == null) return 0;
  if (typeof btn === "number") return Math.max(0, Math.min(1, btn));
  if (typeof btn === "object") {
    if (typeof btn.value === "number") return Math.max(0, Math.min(1, btn.value));
    return btn.pressed ? 1 : 0;
  }
  return 0;
}

/**
 * Bundled offline SDL_GameControllerDB normalizer (`gamepad_standardizer` compatible):
 * converts non-standard DirectInput / raw HID gamepads (Sony DualSense/DS4, Nintendo Switch Pro,
 * Logitech / 8BitDo DirectInput) into the W3C 17-button + 4-axis standard layout.
 */
export function normalizeGamepadState(rawPad) {
  const buttons = new Array(17).fill(0);
  const axes = [0, 0, 0, 0];
  if (!rawPad) return { buttons, axes, family: "xbox" };

  const id = String(rawPad.id || "");
  const family = detectControllerFamily(id);
  const isStandard = rawPad.mapping === "standard";
  const rawBtns = Array.isArray(rawPad.buttons) || rawPad.buttons?.length ? rawPad.buttons : [];
  const rawAxes = Array.isArray(rawPad.axes) || rawPad.axes?.length ? rawPad.axes : [];

  if (isStandard) {
    for (let i = 0; i < 17; i++) {
      buttons[i] = readRawBtn(rawBtns[i]);
    }
    for (let i = 0; i < 4; i++) {
      axes[i] = Number(rawAxes[i]) || 0;
    }
    return { buttons, axes, family };
  }

  // Non-standard SDL / DirectInput / Linux hidraw / macOS IOKit mapping normalization
  if (family === "playstation") {
    // Sony DualSense (054c:0ce6 / 0df2) & DualShock 4 (054c:05c4 / 09cc) raw layout:
    // raw buttons: 0=Square(West), 1=Cross(South), 2=Circle(East), 3=Triangle(North),
    // 4=L1, 5=R1, 6=L2, 7=R2, 8=Create/Share, 9=Options, 10=L3, 11=R3, 12=PS, 13=Touchpad
    buttons[0] = readRawBtn(rawBtns[1]); // Cross -> South (0)
    buttons[1] = readRawBtn(rawBtns[2]); // Circle -> East (1)
    buttons[2] = readRawBtn(rawBtns[0]); // Square -> West (2)
    buttons[3] = readRawBtn(rawBtns[3]); // Triangle -> North (3)
    buttons[4] = readRawBtn(rawBtns[4]); // L1
    buttons[5] = readRawBtn(rawBtns[5]); // R1
    buttons[6] = readRawBtn(rawBtns[6]); // L2 digital fallback
    buttons[7] = readRawBtn(rawBtns[7]); // R2 digital fallback
    buttons[8] = readRawBtn(rawBtns[8]); // Create / Share
    buttons[9] = readRawBtn(rawBtns[9]); // Options
    buttons[10] = readRawBtn(rawBtns[10]); // L3
    buttons[11] = readRawBtn(rawBtns[11]); // R3
    buttons[16] = readRawBtn(rawBtns[12]); // PS Guide

    axes[0] = Number(rawAxes[0]) || 0;
    axes[1] = Number(rawAxes[1]) || 0;
    if (rawAxes.length >= 6) {
      // Raw 6-axis HID layout: 2=RX, 3=L2(-1..1), 4=R2(-1..1), 5=RY
      axes[2] = Number(rawAxes[2]) || 0;
      axes[3] = Number(rawAxes[5]) || 0;
      const l2Axis = Number(rawAxes[3]);
      const r2Axis = Number(rawAxes[4]);
      if (Number.isFinite(l2Axis)) {
        buttons[6] = Math.max(buttons[6], Math.max(0, Math.min(1, (l2Axis + 1) * 0.5)));
      }
      if (Number.isFinite(r2Axis)) {
        buttons[7] = Math.max(buttons[7], Math.max(0, Math.min(1, (r2Axis + 1) * 0.5)));
      }
      if (rawAxes.length >= 8) {
        const dpadX = Number(rawAxes[6]) || 0;
        const dpadY = Number(rawAxes[7]) || 0;
        if (dpadY < -0.5) buttons[12] = 1;
        if (dpadY > 0.5) buttons[13] = 1;
        if (dpadX < -0.5) buttons[14] = 1;
        if (dpadX > 0.5) buttons[15] = 1;
      }
    } else {
      axes[2] = Number(rawAxes[2]) || 0;
      axes[3] = Number(rawAxes[3]) || 0;
    }
    return { buttons, axes, family };
  }

  if (family === "switch") {
    // Nintendo Switch Pro (057e:2009) & Joy-Con raw layout:
    // 0=B(South), 1=A(East), 2=Y(West), 3=X(North), 4=L, 5=R, 6=ZL, 7=ZR, 8=Minus, 9=Plus, 10=LS, 11=RS
    for (let i = 0; i < 16; i++) {
      buttons[i] = readRawBtn(rawBtns[i]);
    }
    buttons[16] = readRawBtn(rawBtns[12] ?? rawBtns[16]);
    for (let i = 0; i < 4; i++) {
      axes[i] = Number(rawAxes[i]) || 0;
    }
    if (rawAxes.length >= 8) {
      const dpadX = Number(rawAxes[6]) || 0;
      const dpadY = Number(rawAxes[7]) || 0;
      if (dpadY < -0.5) buttons[12] = 1;
      if (dpadY > 0.5) buttons[13] = 1;
      if (dpadX < -0.5) buttons[14] = 1;
      if (dpadX > 0.5) buttons[15] = 1;
    }
    return { buttons, axes, family };
  }

  if (/046d|c216|2dc8|directinput|logitech|8bitdo/i.test(id)) {
    // DirectInput standard: 0=West(X), 1=South(A), 2=East(B), 3=North(Y)
    buttons[0] = readRawBtn(rawBtns[1]);
    buttons[1] = readRawBtn(rawBtns[2]);
    buttons[2] = readRawBtn(rawBtns[0]);
    buttons[3] = readRawBtn(rawBtns[3]);
    for (let i = 4; i < 17; i++) {
      buttons[i] = readRawBtn(rawBtns[i]);
    }
    for (let i = 0; i < 4; i++) {
      axes[i] = Number(rawAxes[i]) || 0;
    }
    return { buttons, axes, family };
  }

  // Fallback generic mapping
  for (let i = 0; i < 17; i++) {
    buttons[i] = readRawBtn(rawBtns[i]);
  }
  for (let i = 0; i < 4; i++) {
    axes[i] = Number(rawAxes[i]) || 0;
  }
  return { buttons, axes, family };
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const s = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT_SETTINGS),
      ...s,
      bindings: migrateBindings(s.bindings),
      deviceProfiles: { ...(s.deviceProfiles || {}) },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function saveSettings(s) {
  try {
    const serialized = JSON.stringify(s);
    localStorage.setItem(STORAGE_KEY, serialized);
    localStorage.setItem(LEGACY_STORAGE_KEY, serialized);
  } catch {
    /* storage blocked: settings last for this visit only */
  }
}

function applyResponseCurveScalar(mag, curve = "linear") {
  const m = Math.max(0, Math.min(1, mag));
  if (curve === "exponential") {
    return m * m * 0.65 + m * 0.35;
  }
  if (curve === "s-curve") {
    return m * m * (3 - 2 * m);
  }
  return m;
}

function radial(x, y, dz, curve = "linear") {
  const m = Math.hypot(x, y);
  if (m < dz || m < 1e-6) return { x: 0, y: 0 };
  const norm = Math.min(1, (m - dz) / Math.max(0.01, 1 - dz));
  const curved = applyResponseCurveScalar(norm, curve);
  const k = curved / m;
  return { x: x * k, y: y * k };
}

class GamepadInput {
  constructor() {
    this.settings = loadSettings();
    this.pad = null;
    this.activePadIndex = -1;
    this.buttons = new Array(17).fill(0);
    this.prev = new Array(17).fill(false);
    this.axes = [0, 0, 0, 0];
    this.virtualAxes = [0, 0, 0, 0];
    this.virtualButtons = new Array(17).fill(0);
    this.virtualActive = false;
    this.pressListeners = new Set();
    this.navListeners = new Set();
    this.stickDir = null;
    this.connListeners = new Set();
    this.captureCb = null;
    this.connectedId = null;
    this.haptics = new ControllerHapticsManager();
    this.touchOverlay = null;
    this.joymap = null;
    // "pad" after the last controller input, "kbm" after the last keyboard / mouse input:
    // on-screen hints show the glyphs of whichever was used last.
    this.inputMode = "kbm";
    this.modeListeners = new Set();

    if (typeof window !== "undefined") {
      window.MartianGamepad = this;
      this._initBrowserHooks();
    }
    if (typeof globalThis !== "undefined") {
      globalThis.MartianGamepad = this;
    }
  }

  _initBrowserHooks() {
    if (typeof window === "undefined") return;

    // Optional progressive enhancement with @nkzw/joymap if installed in node_modules
    import("@nkzw/joymap")
      .then((mod) => {
        if (mod?.createJoymap) {
          this.joymap = mod.createJoymap({ onPoll: () => {} });
        }
      })
      .catch(() => {});

    // Auto-mount touch controls if stored setting is enabled
    this.touchOverlay = createTouchControls(this);
    if (this.settings.touchControls) {
      this.touchOverlay.setEnabled(true);
    }

    // synthetic events (the Y button re-sent as an "e" key press) must not flip the hints back
    const toKbm = (e) => {
      if (e?.isTrusted !== false) this.setInputMode("kbm");
    };
    window.addEventListener("keydown", toKbm, true);
    window.addEventListener("mousedown", toKbm, true);
    window.addEventListener("wheel", toKbm, { capture: true, passive: true });
    window.addEventListener(
      "mousemove",
      (e) => {
        if (Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0) > 6) toKbm(e);
      },
      { capture: true, passive: true }
    );
    if (typeof document !== "undefined" && document.body) document.body.classList.add("input-kbm");

    if (typeof navigator !== "undefined" && navigator.getGamepads) {
      window.addEventListener("gamepadconnected", () => this.poll());
      window.addEventListener("gamepaddisconnected", () => this.poll());
      const loop = () => {
        this.poll();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  }

  normalizePad(rawPad) {
    return normalizeGamepadState(rawPad);
  }

  deviceFamily() {
    const pref = this.settings.glyphFamily;
    if (pref && pref !== "auto" && CONTROLLER_GLYPHS[pref]) {
      return pref;
    }
    const id = this.pad?.id || this.connectedId || "";
    return detectControllerFamily(id);
  }

  /**
   * Return the console-accurate button glyph for an actionId (e.g. "confirm" -> "✕" on PlayStation,
   * "B" on Switch, "A" on Xbox) or a numeric button index (0..16).
   */
  glyphFor(actionOrButton, { family = null, tr = false } = {}) {
    const b =
      typeof actionOrButton === "number"
        ? actionOrButton
        : this.settings.bindings?.[actionOrButton];
    if (b == null || b < 0 || b >= 17) return "—";
    const fam = family && CONTROLLER_GLYPHS[family] ? family : this.deviceFamily();
    const table = CONTROLLER_GLYPHS[fam] || CONTROLLER_GLYPHS.xbox;
    const raw = table[b] || BUTTON_NAMES[b] || `B${b}`;
    if (tr && b >= 12 && b <= 15) {
      const trDpad = {
        12: "D-pad Yukarı",
        13: "D-pad Aşağı",
        14: "D-pad Sol",
        15: "D-pad Sağ",
      };
      return trDpad[b] || raw;
    }
    return raw;
  }

  poll() {
    const rawPads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : null;
    let pad = null;
    if (rawPads) {
      let fallbackStandard = null;
      let fallbackAny = null;
      for (let i = 0; i < rawPads.length; i++) {
        const p = rawPads[i];
        if (!p || !p.connected) continue;
        if (!fallbackAny) fallbackAny = p;
        const isXboxOrStandard = p.mapping === "standard" || /xbox|xinput/i.test(p.id || "");
        if (isXboxOrStandard && !fallbackStandard) fallbackStandard = p;
        let hasInput = false;
        if (p.buttons) {
          for (let b = 0; b < p.buttons.length; b++) {
            const val = readRawBtn(p.buttons[b]);
            if (val > 0.2) {
              hasInput = true;
              break;
            }
          }
        }
        if (!hasInput && p.axes) {
          for (let a = 0; a < Math.min(6, p.axes.length); a++) {
            if (Math.abs(p.axes[a] || 0) > 0.25) {
              hasInput = true;
              break;
            }
          }
        }
        if (hasInput) {
          this.activePadIndex = i;
          pad = p;
          break;
        }
      }
      if (!pad) {
        const lastActive = this.activePadIndex >= 0 ? rawPads[this.activePadIndex] : null;
        if (lastActive && lastActive.connected) pad = lastActive;
        else pad = fallbackStandard || fallbackAny;
      }
    }

    const id = pad ? pad.id : this.virtualActive ? "Virtual Touch Controller" : null;
    if (id !== this.connectedId) {
      this.connectedId = id;
      this.prev.fill(false);
      if (id && this.settings.deviceProfiles?.[id]) {
        this.loadDeviceProfile(id);
      }
      for (const fn of this.connListeners) fn(id);
    }
    this.pad = pad;

    if (!pad && !this.virtualActive) {
      this.buttons.fill(0);
      this.axes[0] = 0;
      this.axes[1] = 0;
      this.axes[2] = 0;
      this.axes[3] = 0;
      return;
    }

    const norm = pad ? normalizeGamepadState(pad) : { buttons: new Array(17).fill(0), axes: [0, 0, 0, 0] };
    for (let i = 0; i < 17; i++) {
      this.buttons[i] = Math.max(norm.buttons[i] || 0, this.virtualButtons[i] || 0);
    }
    for (let i = 0; i < 4; i++) {
      const hw = norm.axes[i] || 0;
      const vw = this.virtualAxes[i] || 0;
      this.axes[i] = Math.abs(vw) > Math.abs(hw) ? vw : hw;
    }

    if (pad) {
      let active = false;
      for (let i = 0; i < 17 && !active; i++) active = (norm.buttons[i] || 0) > 0.5;
      for (let i = 0; i < 4 && !active; i++) active = Math.abs(norm.axes[i] || 0) > 0.35;
      if (active) this.setInputMode("pad");
    }

    this._processEdgesAndNav();
  }

  /** Switch hint glyphs between keyboard ("kbm") and controller ("pad"). */
  setInputMode(mode) {
    const next = mode === "pad" ? "pad" : "kbm";
    if (next === this.inputMode) return;
    this.inputMode = next;
    if (typeof document !== "undefined" && document.body) {
      document.body.classList.toggle("input-pad", next === "pad");
      document.body.classList.toggle("input-kbm", next === "kbm");
    }
    for (const fn of this.modeListeners) fn(next);
    if (typeof window !== "undefined" && typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent("mm:input-mode", { detail: next }));
    }
  }

  /** True while hints should show controller glyphs (a controller was the last input used). */
  get usingPad() {
    return this.inputMode === "pad" && this.connected;
  }

  onInputModeChange(fn) {
    this.modeListeners.add(fn);
    return () => this.modeListeners.delete(fn);
  }

  /** `keyLabel` for keyboard players, the bound button's glyph for controller players. */
  hint(keyLabel, actionId) {
    return this.usingPad ? this.glyphFor(actionId) : keyLabel;
  }

  _processEdgesAndNav() {
    for (let i = 0; i < this.buttons.length; i++) {
      const down = this.buttons[i] > 0.5;
      if (down && !this.prev[i]) this.emitPress(i);
      this.prev[i] = down;
    }
    // left stick as menu arrows: one step when it crosses 0.6, re-armed when it returns under 0.35
    const lx = this.axes[0];
    const ly = this.axes[1];
    const m = Math.max(Math.abs(lx), Math.abs(ly));
    if (this.stickDir && m < 0.35) this.stickDir = null;
    else if (!this.stickDir && m > 0.6) {
      this.stickDir = Math.abs(lx) > Math.abs(ly) ? (lx > 0 ? "right" : "left") : ly > 0 ? "down" : "up";
      this.emitNav(this.stickDir, "stick");
    }
  }

  emitNav(dir, source) {
    for (const fn of this.navListeners) fn({ dir, source });
  }

  /** Menu arrows from the D-pad or the left stick: fn({ dir: "up"|"down"|"left"|"right", source }). */
  onNav(fn) {
    this.navListeners.add(fn);
    return () => this.navListeners.delete(fn);
  }

  emitPress(button) {
    if (this.captureCb) {
      const cb = this.captureCb;
      this.captureCb = null;
      cb(button);
      return; // a press used for assigning does not also trigger its action
    }
    const dpad = { 12: "up", 13: "down", 14: "left", 15: "right" }[button];
    if (dpad) this.emitNav(dpad, "dpad");
    const actions = ACTIONS.filter((a) => this.settings.bindings[a.id] === button).map((a) => a.id);
    for (const fn of this.pressListeners) fn({ button, actions });
  }

  /** Subscribe to button presses: fn({ button, actions: [actionIds] }). Returns an unsubscribe. */
  onPress(fn) {
    this.pressListeners.add(fn);
    return () => this.pressListeners.delete(fn);
  }

  onConnectionChange(fn) {
    this.connListeners.add(fn);
    return () => this.connListeners.delete(fn);
  }

  get connected() {
    return Boolean(this.pad || this.virtualActive);
  }

  isDown(actionId) {
    const b = this.settings.bindings[actionId];
    return b != null && this.buttons[b] > 0.5;
  }

  /** Analog 0..1 value for the button bound to actionId (for RT throttle / LT brake triggers). */
  analog(actionId) {
    const b = this.settings.bindings[actionId];
    if (b == null) return 0;
    const raw = Math.max(0, Math.min(1, this.buttons[b] || 0));
    const tdz = Math.max(0, Math.min(0.45, Number(this.settings.triggerDeadzone) || 0));
    if (raw <= tdz) return 0;
    const scaled = tdz > 0 ? (raw - tdz) / (1 - tdz) : raw;
    return applyResponseCurveScalar(scaled, this.settings.responseCurve);
  }

  /** Left stick (or right, if swapped): x right, y forward (+1 = push up). */
  move() {
    const [ax, ay] = this.settings.swapSticks ? [2, 3] : [0, 1];
    const v = radial(this.axes[ax], this.axes[ay], this.settings.deadzone, this.settings.responseCurve);
    return { x: v.x, y: -v.y };
  }

  /** Right stick (or left, if swapped): screen-space cursor delta (x right, y down), without camera invertY. */
  rightStick() {
    const [ax, ay] = this.settings.swapSticks ? [0, 1] : [2, 3];
    return radial(this.axes[ax], this.axes[ay], this.settings.deadzone, this.settings.responseCurve);
  }

  /** Right stick (or left, if swapped): x right, y up, with sensitivity and invert applied. */
  look() {
    const [ax, ay] = this.settings.swapSticks ? [0, 1] : [2, 3];
    const v = radial(this.axes[ax], this.axes[ay], this.settings.deadzone, this.settings.responseCurve);
    const s = this.settings.sensitivity;
    return { x: v.x * s, y: (this.settings.invertY ? v.y : -v.y) * s };
  }

  /** Next button pressed is passed to cb instead of triggering actions. */
  captureNextButton(cb) {
    this.captureCb = cb;
  }

  cancelCapture() {
    this.captureCb = null;
  }

  bind(actionId, button) {
    for (const a of ACTIONS) {
      if (a.id !== actionId && this.settings.bindings[a.id] === button) {
        this.settings.bindings[a.id] = null;
      }
    }
    this.settings.bindings[actionId] = button;
    this.saveDeviceProfile();
    saveSettings(this.settings);
  }

  set(key, value) {
    this.settings[key] = value;
    if (key === "touchControls" && this.touchOverlay) {
      this.touchOverlay.setEnabled(Boolean(value));
    }
    this.saveDeviceProfile();
    saveSettings(this.settings);
  }

  applyPreset(presetId) {
    const preset = CONTROLLER_PRESETS[presetId];
    if (!preset) return false;
    this.settings.preset = preset.id;
    this.settings.bindings = { ...preset.bindings };
    this.settings.swapSticks = Boolean(preset.swapSticks);
    this.settings.invertY = Boolean(preset.invertY);
    this.settings.responseCurve = preset.responseCurve || "linear";
    this.saveDeviceProfile();
    saveSettings(this.settings);
    this.touchOverlay?.refreshGlyphLabels?.();
    return true;
  }

  saveDeviceProfile(deviceId = this.pad?.id || this.connectedId) {
    if (!deviceId) return;
    if (!this.settings.deviceProfiles) this.settings.deviceProfiles = {};
    this.settings.deviceProfiles[deviceId] = {
      bindings: { ...this.settings.bindings },
      sensitivity: this.settings.sensitivity,
      invertY: this.settings.invertY,
      swapSticks: this.settings.swapSticks,
      deadzone: this.settings.deadzone,
      triggerDeadzone: this.settings.triggerDeadzone,
      responseCurve: this.settings.responseCurve,
      preset: this.settings.preset,
    };
  }

  loadDeviceProfile(deviceId = this.pad?.id || this.connectedId) {
    const prof = deviceId && this.settings.deviceProfiles?.[deviceId];
    if (!prof) return false;
    this.settings.bindings = migrateBindings(prof.bindings);
    if (typeof prof.sensitivity === "number") this.settings.sensitivity = prof.sensitivity;
    if (typeof prof.invertY === "boolean") this.settings.invertY = prof.invertY;
    if (typeof prof.swapSticks === "boolean") this.settings.swapSticks = prof.swapSticks;
    if (typeof prof.deadzone === "number") this.settings.deadzone = prof.deadzone;
    if (typeof prof.triggerDeadzone === "number") this.settings.triggerDeadzone = prof.triggerDeadzone;
    if (typeof prof.responseCurve === "string") this.settings.responseCurve = prof.responseCurve;
    if (typeof prof.preset === "string") this.settings.preset = prof.preset;
    return true;
  }

  reset() {
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.clearVirtualInputs();
    this.haptics.resetCooldowns();
    saveSettings(this.settings);
  }

  // ===========================================================================
  // Haptics & Sony DualSense WebHID Adaptive Triggers + Safety Lightbar
  // ===========================================================================
  triggerHaptic(presetOrSpec = "ui", intensity = 1, options = {}) {
    return this.haptics.triggerHaptic(this.pad, presetOrSpec, intensity, {
      ...options,
      enabled: this.settings.hapticsEnabled !== false,
    });
  }

  setSafetyLedState(input) {
    return this.haptics.setSafetyLedState(input);
  }

  updateDriveHaptics(telemetry = {}) {
    return this.haptics.updateAdaptiveTriggers(telemetry);
  }

  connectDualSenseWebHID() {
    return this.haptics.connectDualSenseWebHID();
  }

  get dualsenseConnected() {
    return this.haptics.dualsenseConnected;
  }

  get safetyLedState() {
    return this.haptics.safetyLedState;
  }

  // ===========================================================================
  // Virtual Touch Joystick / Button State Injection (`nipplejs` & Touch UI)
  // ===========================================================================
  setVirtualStick(side, x, y) {
    const nx = Math.max(-1, Math.min(1, Number(x) || 0));
    const ny = Math.max(-1, Math.min(1, Number(y) || 0));
    if (side === "right") {
      this.virtualAxes[2] = nx;
      this.virtualAxes[3] = ny;
      this.axes[2] = nx;
      this.axes[3] = ny;
    } else {
      this.virtualAxes[0] = nx;
      this.virtualAxes[1] = ny;
      this.axes[0] = nx;
      this.axes[1] = ny;
    }
    this._updateVirtualActive();
    this._processEdgesAndNav();
  }

  setVirtualButton(buttonIndex, value) {
    const idx = Number(buttonIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= 17) return;
    const v = Math.max(0, Math.min(1, Number(value) || 0));
    this.virtualButtons[idx] = v;
    this.buttons[idx] = v;
    this._updateVirtualActive();
    this._processEdgesAndNav();
  }

  injectVirtualState({ axes = null, buttons = null } = {}) {
    if (Array.isArray(axes)) {
      for (let i = 0; i < Math.min(4, axes.length); i++) {
        this.virtualAxes[i] = Math.max(-1, Math.min(1, Number(axes[i]) || 0));
        this.axes[i] = this.virtualAxes[i];
      }
    }
    if (Array.isArray(buttons)) {
      for (let i = 0; i < Math.min(17, buttons.length); i++) {
        this.virtualButtons[i] = Math.max(0, Math.min(1, Number(buttons[i]) || 0));
        this.buttons[i] = this.virtualButtons[i];
      }
    }
    this._updateVirtualActive();
    this._processEdgesAndNav();
  }

  clearVirtualInputs() {
    this.virtualAxes.fill(0);
    this.virtualButtons.fill(0);
    this.virtualActive = false;
    if (!this.pad) {
      this.axes.fill(0);
      this.buttons.fill(0);
      this.prev.fill(false);
    }
  }

  _updateVirtualActive() {
    const anyAxis = this.virtualAxes.some((v) => Math.abs(v) > 0.01);
    const anyBtn = this.virtualButtons.some((v) => v > 0.01);
    this.virtualActive = Boolean(anyAxis || anyBtn || this.settings.touchControls);
    if (this.virtualActive && !this.connectedId) {
      this.connectedId = "Virtual Touch Controller";
    }
  }

  setTouchControlsEnabled(enabled) {
    this.set("touchControls", Boolean(enabled));
    return Boolean(enabled);
  }
}

export const gamepad = new GamepadInput();
