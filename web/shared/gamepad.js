/**
 * Controller input (`web/shared/gamepad.js`).
 *
 * Xbox / XInput controllers show up in browsers through the Gamepad API with the "standard"
 * layout: buttons 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu, 10 LS, 11 RS,
 * 12-15 D-pad up/down/left/right, 16 Guide; axes 0/1 left stick, 2/3 right stick.
 *
 * One polling loop runs for the whole page. Other modules read analog sticks and held actions
 * each frame, and subscribe to button presses. Action bindings and stick settings are saved in
 * this browser only (localStorage), so each player keeps their own layout.
 */

// v3: Xbox / XInput layout (A confirm, B back, X landmark, Y interact, LB jump, RB run, LT brake, RT throttle, View map, Menu esc)
const STORAGE_KEY = "mm-gamepad-v4";

/** Fixed menu buttons: A selects / confirms, B goes back. */
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

/** Rebindable in-game actions with their default Xbox / XInput buttons. */
export const ACTIONS = [
  { id: "confirm", label: "Select & Confirm (A)", button: 0 },
  { id: "back", label: "Go Back (B)", button: 1 },
  { id: "pin", label: "Drop Landmark (X)", button: 2 },
  { id: "interact", label: "Interact — vehicles & crew (Y)", button: 3 },
  { id: "jump", label: "Jump / Handbrake (LB)", button: 4 },
  { id: "run", label: "Fast Run / Boost (RB)", button: 5 },
  { id: "brake", label: "Brake / Reverse (LT)", button: 6 },
  { id: "throttle", label: "Throttle / Gas (RT)", button: 7 },
  { id: "map", label: "Map (M) — 2 Squares (View)", button: 8 },
  { id: "menu", label: "ESC Menu — 3 Lines (Menu)", button: 9 },
  { id: "texture", label: "Change surface layer (LS)", button: 10 },
  { id: "lamp", label: "Flashlight / Headlights (R3)", button: 11 },
  { id: "pov", label: "Rover POV photo (D-pad up)", button: 12 },
];

const DEFAULT_SETTINGS = {
  bindings: Object.fromEntries(ACTIONS.map((a) => [a.id, a.button])),
  sensitivity: 1,
  invertY: false,
  swapSticks: false,
  deadzone: 0.15,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const s = JSON.parse(raw);
    const out = {
      ...structuredClone(DEFAULT_SETTINGS),
      ...s,
      bindings: { ...DEFAULT_SETTINGS.bindings, ...(s.bindings || {}) },
    };
    return out;
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function saveSettings(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: settings last for this visit only */
  }
}

function radial(x, y, dz) {
  const m = Math.hypot(x, y);
  if (m < dz) return { x: 0, y: 0 };
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
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
    this.pressListeners = new Set();
    this.navListeners = new Set();
    this.stickDir = null;
    this.connListeners = new Set();
    this.captureCb = null;
    this.connectedId = null;
    if (typeof window !== "undefined" && navigator.getGamepads) {
      window.addEventListener("gamepadconnected", () => this.poll());
      window.addEventListener("gamepaddisconnected", () => this.poll());
      const loop = () => {
        this.poll();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  }

  poll() {
    const rawPads = navigator.getGamepads ? navigator.getGamepads() : null;
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
            const btn = p.buttons[b];
            const val = btn ? (typeof btn === "object" ? (typeof btn.value === "number" ? btn.value : btn.pressed ? 1 : 0) : Number(btn) || 0) : 0;
            if (val > 0.2) {
              hasInput = true;
              break;
            }
          }
        }
        if (!hasInput && p.axes) {
          for (let a = 0; a < Math.min(4, p.axes.length); a++) {
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
    const id = pad ? pad.id : null;
    if (id !== this.connectedId) {
      this.connectedId = id;
      this.prev.fill(false);
      for (const fn of this.connListeners) fn(id);
    }
    this.pad = pad;
    if (!pad) {
      this.buttons.fill(0);
      this.axes[0] = 0;
      this.axes[1] = 0;
      this.axes[2] = 0;
      this.axes[3] = 0;
      return;
    }
    for (let i = 0; i < this.buttons.length; i++) {
      const b = pad.buttons[i];
      this.buttons[i] = b ? (typeof b === "object" ? (typeof b.value === "number" ? b.value : b.pressed ? 1 : 0) : Number(b) || 0) : 0;
    }
    for (let i = 0; i < 4; i++) this.axes[i] = pad.axes[i] || 0;
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
    return Boolean(this.pad);
  }

  isDown(actionId) {
    const b = this.settings.bindings[actionId];
    return b != null && this.buttons[b] > 0.5;
  }

  /** Analog 0..1 value for the button bound to actionId (for RT throttle / LT brake triggers). */
  analog(actionId) {
    const b = this.settings.bindings[actionId];
    return b != null ? Math.max(0, Math.min(1, this.buttons[b] || 0)) : 0;
  }

  /** Left stick (or right, if swapped): x right, y forward (+1 = push up). */
  move() {
    const [ax, ay] = this.settings.swapSticks ? [2, 3] : [0, 1];
    const v = radial(this.axes[ax], this.axes[ay], this.settings.deadzone);
    return { x: v.x, y: -v.y };
  }

  /** Right stick (or left, if swapped): screen-space cursor delta (x right, y down), without camera invertY. */
  rightStick() {
    const [ax, ay] = this.settings.swapSticks ? [0, 1] : [2, 3];
    return radial(this.axes[ax], this.axes[ay], this.settings.deadzone);
  }

  /** Right stick (or left, if swapped): x right, y up, with sensitivity and invert applied. */
  look() {
    const [ax, ay] = this.settings.swapSticks ? [0, 1] : [2, 3];
    const v = radial(this.axes[ax], this.axes[ay], this.settings.deadzone);
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
    // a button does one thing: take it away from any other action
    for (const a of ACTIONS) if (a.id !== actionId && this.settings.bindings[a.id] === button) this.settings.bindings[a.id] = null;
    this.settings.bindings[actionId] = button;
    saveSettings(this.settings);
  }

  set(key, value) {
    this.settings[key] = value;
    saveSettings(this.settings);
  }

  reset() {
    this.settings = structuredClone(DEFAULT_SETTINGS);
    saveSettings(this.settings);
  }
}

export const gamepad = new GamepadInput();
