/**
 * Controller setup screen (`web/shared/gamepad-ui.js`).
 *
 * A black overlay with an Xbox-style controller silhouette that lights up live as buttons are
 * pressed and sticks move, a list of actions with their current button, and stick settings.
 * Choose ASSIGN next to an action, then press the controller button to use for it.
 */

import { ACTIONS, BUTTON_NAMES, gamepad } from "./gamepad.js";

// Silhouette drawn here (generic controller outline, no logos). viewBox 0 0 440 280.
const PAD_SVG = `
<svg class="pad-svg" viewBox="0 0 440 280" role="img" aria-label="Controller layout">
  <g class="pad-trigger" data-b="6"><rect x="88" y="6" width="62" height="20" rx="8"/><text x="119" y="20">LT</text></g>
  <g class="pad-trigger" data-b="7"><rect x="290" y="6" width="62" height="20" rx="8"/><text x="321" y="20">RT</text></g>
  <g class="pad-bumper" data-b="4"><rect x="74" y="32" width="88" height="14" rx="7"/><text x="118" y="43">LB</text></g>
  <g class="pad-bumper" data-b="5"><rect x="278" y="32" width="88" height="14" rx="7"/><text x="322" y="43">RB</text></g>
  <path class="pad-body" d="M128 52 C96 52 76 62 66 84 L34 184 C22 228 44 262 78 262 C104 262 116 246 132 220 L152 188 L288 188 L308 220 C324 246 336 262 362 262 C396 262 418 228 406 184 L374 84 C364 62 344 52 312 52 C282 52 268 62 220 62 C172 62 158 52 128 52 Z"/>
  <g class="pad-btn" data-b="16"><circle cx="220" cy="84" r="13"/></g>
  <g class="pad-btn" data-b="8"><rect x="184" y="104" width="18" height="12" rx="6"/><text x="193" y="134" class="pad-small">VIEW</text></g>
  <g class="pad-btn" data-b="9"><rect x="238" y="104" width="18" height="12" rx="6"/><text x="247" y="134" class="pad-small">MENU</text></g>
  <g class="pad-stick" data-b="10" data-stick="left"><circle class="pad-well" cx="128" cy="108" r="26"/><circle class="pad-cap" cx="128" cy="108" r="17"/></g>
  <g class="pad-stick" data-b="11" data-stick="right"><circle class="pad-well" cx="270" cy="160" r="26"/><circle class="pad-cap" cx="270" cy="160" r="17"/></g>
  <g class="pad-dpad">
    <g class="pad-btn" data-b="12"><rect x="160" y="132" width="18" height="20" rx="3"/></g>
    <g class="pad-btn" data-b="13"><rect x="160" y="168" width="18" height="20" rx="3"/></g>
    <g class="pad-btn" data-b="14"><rect x="140" y="150" width="20" height="20" rx="3"/></g>
    <g class="pad-btn" data-b="15"><rect x="178" y="150" width="20" height="20" rx="3"/></g>
  </g>
  <g class="pad-btn pad-face" data-b="3"><circle cx="314" cy="84" r="12"/><text x="314" y="88">Y</text></g>
  <g class="pad-btn pad-face" data-b="2"><circle cx="290" cy="108" r="12"/><text x="290" y="112">X</text></g>
  <g class="pad-btn pad-face" data-b="1"><circle cx="338" cy="108" r="12"/><text x="338" y="112">B</text></g>
  <g class="pad-btn pad-face" data-b="0"><circle cx="314" cy="132" r="12"/><text x="314" y="136">A</text></g>
</svg>`;

const CSS = `
/* crosshair used by the map controllers (planner map and the 3D Mars globe map) */
.pad-crosshair { position: absolute; width: 34px; height: 34px; margin: -17px 0 0 -17px; pointer-events: none;
  z-index: 6; display: none; }
.pad-crosshair.on { display: block; }
.pad-crosshair::before, .pad-crosshair::after { content: ""; position: absolute; background: #fff;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.7); }
.pad-crosshair::before { left: 16px; top: 0; width: 2px; height: 34px; }
.pad-crosshair::after { top: 16px; left: 0; height: 2px; width: 34px; }
.pad-crosshair .ring { position: absolute; inset: 9px; border: 1.5px solid #fff; border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.6); }
#pad-setup { position: fixed; inset: 0; z-index: 300; background: rgba(0,0,0,0.94); display: none;
  align-items: center; justify-content: center; padding: 24px; font-family: var(--mono, monospace); color: #f2f2f2; }
#pad-setup.open { display: flex; }
.pad-card { width: min(980px, 100%); max-height: 92vh; overflow-y: auto; border: 1px solid rgba(255,255,255,0.3);
  background: #000; padding: 24px 28px; display: grid; grid-template-columns: 1.15fr 1fr; gap: 28px; }
@media (max-width: 820px) { .pad-card { grid-template-columns: 1fr; } }
.pad-head { grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
.pad-head h3 { margin: 0; font-weight: 400; font-size: 12px; letter-spacing: 0.28em; }
.pad-status { font-size: 10.5px; letter-spacing: 0.1em; color: rgba(255,255,255,0.55); }
.pad-status.on { color: #fff; }
.pad-svg { width: 100%; height: auto; display: block; }
.pad-svg .pad-body { fill: #0b0b0b; stroke: rgba(255,255,255,0.55); stroke-width: 1.5; }
.pad-svg rect, .pad-svg circle { fill: #000; stroke: rgba(255,255,255,0.55); stroke-width: 1.2; transition: fill 0.06s; }
.pad-svg .pad-well { fill: #050505; stroke: rgba(255,255,255,0.25); }
.pad-svg text { fill: rgba(255,255,255,0.75); font-size: 11px; text-anchor: middle; font-family: inherit; pointer-events: none; }
.pad-svg .pad-small { font-size: 7.5px; letter-spacing: 0.12em; fill: rgba(255,255,255,0.45); }
.pad-svg .lit rect, .pad-svg .lit circle:not(.pad-well) { fill: #fff; }
.pad-svg .lit text { fill: #000; }
.pad-svg .target rect, .pad-svg .target circle:not(.pad-well) { stroke: #fff; stroke-width: 2.5; animation: padblink 0.8s steps(1) infinite; }
@keyframes padblink { 50% { stroke-opacity: 0.2; } }
.pad-hint { font-size: 10.5px; line-height: 1.6; color: rgba(255,255,255,0.55); margin-top: 12px; }
.pad-list { display: grid; grid-template-columns: 1fr auto auto; gap: 8px 14px; align-items: center; font-size: 11.5px; }
.pad-list .lbl { color: rgba(255,255,255,0.75); }
.pad-list .key { color: #fff; letter-spacing: 0.08em; min-width: 92px; text-align: right; }
.pad-list .key.wait { animation: padblink 0.8s steps(1) infinite; }
.pad-sec { font-size: 9.5px; letter-spacing: 0.24em; color: rgba(255,255,255,0.45); margin: 18px 0 10px; text-transform: uppercase; }
.pad-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 11.5px; color: rgba(255,255,255,0.75); margin: 8px 0; }
.pad-row input[type=range] { width: 150px; accent-color: #fff; }
.pad-foot { display: flex; gap: 14px; justify-content: flex-end; margin-top: 18px; }
`;

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function initGamepadSetup() {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = el(`
    <div id="pad-setup" role="dialog" aria-label="Controller setup">
      <div class="pad-card">
        <div class="pad-head">
          <h3>CONTROLLER SETUP</h3>
          <div class="pad-status" id="pad-status">NO CONTROLLER · CONNECT ONE AND PRESS ANY BUTTON</div>
        </div>
        <div>
          ${PAD_SVG}
          <div class="pad-hint">
            LEFT STICK WALK · RIGHT STICK LOOK · BUTTONS LIGHT UP WHEN PRESSED.<br/>
            IN MENUS AND ON THE MAP: A SELECTS / CONFIRMS, B GOES BACK (FIXED); D-PAD OR LEFT STICK MOVES.<br/>
            TO CHANGE A BUTTON: CHOOSE ASSIGN, THEN PRESS THE BUTTON ON THE CONTROLLER (ESC CANCELS).<br/>
            XBOX / XINPUT CONTROLLERS USE THIS LAYOUT; OTHER PADS MAY NAME BUTTONS DIFFERENTLY.
          </div>
        </div>
        <div>
          <div class="pad-sec">Actions</div>
          <div class="pad-list" id="pad-list"></div>
          <div class="pad-sec">Sticks</div>
          <div class="pad-row"><span>Look sensitivity <span id="pad-sens-v"></span></span><input id="pad-sens" type="range" min="0.3" max="2.5" step="0.1"/></div>
          <div class="pad-row"><span>Dead zone <span id="pad-dz-v"></span></span><input id="pad-dz" type="range" min="0.05" max="0.35" step="0.01"/></div>
          <label class="pad-row"><span>Invert look up / down</span><input id="pad-inv" type="checkbox"/></label>
          <label class="pad-row"><span>Swap sticks (walk on right)</span><input id="pad-swap" type="checkbox"/></label>
          <div class="pad-foot">
            <button class="btn" id="pad-reset">Defaults</button>
            <button class="btn primary" id="pad-close">Done</button>
          </div>
        </div>
      </div>
    </div>`);
  document.body.appendChild(root);

  const status = root.querySelector("#pad-status");
  const list = root.querySelector("#pad-list");
  const svg = root.querySelector(".pad-svg");
  const parts = [...svg.querySelectorAll("[data-b]")];
  const sticks = {
    left: svg.querySelector('[data-stick="left"] .pad-cap'),
    right: svg.querySelector('[data-stick="right"] .pad-cap'),
  };
  const stickHome = {
    left: [Number(sticks.left.getAttribute("cx")), Number(sticks.left.getAttribute("cy"))],
    right: [Number(sticks.right.getAttribute("cx")), Number(sticks.right.getAttribute("cy"))],
  };
  let waitingFor = null;

  function renderList() {
    list.innerHTML = "";
    for (const a of ACTIONS) {
      const b = gamepad.settings.bindings[a.id];
      const lbl = el(`<span class="lbl">${a.label}</span>`);
      const key = el(`<span class="key${waitingFor === a.id ? " wait" : ""}">${
        waitingFor === a.id ? "PRESS…" : b == null ? "—" : BUTTON_NAMES[b]
      }</span>`);
      const btn = el(`<button class="btn">${waitingFor === a.id ? "Cancel" : "Assign"}</button>`);
      btn.onclick = () => (waitingFor === a.id ? cancel() : assign(a.id));
      list.append(lbl, key, btn);
    }
    for (const p of parts) {
      const b = Number(p.dataset.b);
      p.classList.toggle("target", waitingFor != null && gamepad.settings.bindings[waitingFor] === b);
    }
  }

  function assign(actionId) {
    waitingFor = actionId;
    renderList();
    gamepad.captureNextButton((button) => {
      gamepad.bind(actionId, button);
      waitingFor = null;
      renderList();
    });
  }

  function cancel() {
    waitingFor = null;
    gamepad.cancelCapture();
    renderList();
  }

  const sens = root.querySelector("#pad-sens");
  const dz = root.querySelector("#pad-dz");
  const inv = root.querySelector("#pad-inv");
  const swap = root.querySelector("#pad-swap");
  function syncSettings() {
    sens.value = gamepad.settings.sensitivity;
    dz.value = gamepad.settings.deadzone;
    inv.checked = gamepad.settings.invertY;
    swap.checked = gamepad.settings.swapSticks;
    root.querySelector("#pad-sens-v").textContent = `${Number(gamepad.settings.sensitivity).toFixed(1)}x`;
    root.querySelector("#pad-dz-v").textContent = `${Math.round(gamepad.settings.deadzone * 100)}%`;
  }
  sens.oninput = () => {
    gamepad.set("sensitivity", Number(sens.value));
    syncSettings();
  };
  dz.oninput = () => {
    gamepad.set("deadzone", Number(dz.value));
    syncSettings();
  };
  inv.onchange = () => gamepad.set("invertY", inv.checked);
  swap.onchange = () => gamepad.set("swapSticks", swap.checked);
  root.querySelector("#pad-reset").onclick = () => {
    cancel();
    gamepad.reset();
    syncSettings();
    renderList();
  };

  function close() {
    cancel();
    root.classList.remove("open");
  }
  root.querySelector("#pad-close").onclick = close;
  root.addEventListener("click", (e) => {
    if (e.target === root) close();
  });
  window.addEventListener("keydown", (e) => {
    if (!root.classList.contains("open") || e.key !== "Escape") return;
    if (waitingFor) cancel();
    else close();
  });

  // live view of the controller while the screen is open
  function frame() {
    if (root.classList.contains("open")) {
      for (const p of parts) p.classList.toggle("lit", gamepad.buttons[Number(p.dataset.b)] > 0.5);
      const ax = gamepad.axes;
      for (const [name, [ix, iy]] of [
        ["left", [0, 1]],
        ["right", [2, 3]],
      ]) {
        const [hx, hy] = stickHome[name];
        sticks[name].setAttribute("cx", String(hx + (ax[ix] || 0) * 9));
        sticks[name].setAttribute("cy", String(hy + (ax[iy] || 0) * 9));
      }
      status.textContent = gamepad.connected
        ? `CONNECTED · ${gamepad.connectedId.slice(0, 60).toUpperCase()}`
        : "NO CONTROLLER · CONNECT ONE AND PRESS ANY BUTTON";
      status.classList.toggle("on", gamepad.connected);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    open() {
      syncSettings();
      renderList();
      root.classList.add("open");
    },
    close,
    get isOpen() {
      return root.classList.contains("open");
    },
  };
}
