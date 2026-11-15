/**
 * Cross-Platform Controller Setup Screen & Embedded Settings Widget (`web/shared/gamepad-ui.js`).
 *
 * Renders an interactive controller silhouette that updates face/bumper/trigger glyphs dynamically
 * for Xbox (A/B/X/Y, LB/RB, LT/RT), PlayStation DualSense/DS4 (✕/○/□/△, L1/R1, L2/R2, Create/Options),
 * and Nintendo Switch (B/A/Y/X, L/R, ZL/ZR, −/+). Includes live analog trigger travel bars,
 * DualSense EVA safety lightbar indicator, a "Test Rumble / Pair DualSense WebHID / Touch Joysticks"
 * toolbar, layout preset switcher, trigger deadzone & response curve controls, and full button rebinding.
 */

import { ACTIONS, BUTTON_NAMES, CONTROLLER_PRESETS, gamepad } from "./gamepad.js";

const ACTION_LABELS_EN = {
  confirm: "Select & Confirm",
  back: "Go Back",
  pin: "Drop Landmark",
  interact: "Interact — vehicles & crew",
  jump: "Jump (on foot)",
  run: "Sprint (on foot)",
  brake: "Brake (driving)",
  throttle: "Throttle (driving)",
  map: "Map (M)",
  menu: "ESC Menu",
  camera: "Camera switch",
  lamp: "Flashlight / Headlights",
  pov: "Rover POV photo",
};

const ACTION_LABELS_TR = {
  confirm: "Seç ve Onayla",
  back: "Geri Git",
  pin: "Landmark Bırakma",
  interact: "Etkileşim — araçlar ve insanlar",
  jump: "Zıplama (yaya)",
  run: "Hızlı Koşu (yaya)",
  brake: "Fren (sürüş)",
  throttle: "Gaz (sürüş)",
  map: "Harita (M)",
  menu: "ESC Menü",
  camera: "Kamera Değiştirme",
  lamp: "El feneri / Farlar",
  pov: "Gezgin POV fotoğrafı",
};

// Silhouette drawn here (generic controller outline with dynamic glyphs & LED lightbar). viewBox 0 0 440 280.
const PAD_SVG = `
<svg class="pad-svg" viewBox="0 0 440 280" role="img" aria-label="Controller layout">
  <g class="pad-trigger" data-b="6"><rect x="88" y="6" width="62" height="20" rx="8"/><text x="119" y="20" data-glyph="6">LT</text></g>
  <g class="pad-trigger" data-b="7"><rect x="290" y="6" width="62" height="20" rx="8"/><text x="321" y="20" data-glyph="7">RT</text></g>
  <g class="pad-bumper" data-b="4"><rect x="74" y="32" width="88" height="14" rx="7"/><text x="118" y="43" data-glyph="4">LB</text></g>
  <g class="pad-bumper" data-b="5"><rect x="278" y="32" width="88" height="14" rx="7"/><text x="322" y="43" data-glyph="5">RB</text></g>
  <path class="pad-body" d="M128 52 C96 52 76 62 66 84 L34 184 C22 228 44 262 78 262 C104 262 116 246 132 220 L152 188 L288 188 L308 220 C324 246 336 262 362 262 C396 262 418 228 406 184 L374 84 C364 62 344 52 312 52 C282 52 268 62 220 62 C172 62 158 52 128 52 Z"/>
  <rect class="pad-led-bar" x="186" y="57" width="68" height="4" rx="2" fill="#00e4b8"/>
  <g class="pad-btn" data-b="16"><circle cx="220" cy="84" r="13"/><text x="220" y="88" class="pad-small" data-glyph="16">GUIDE</text></g>
  <g class="pad-btn" data-b="8"><rect x="184" y="104" width="18" height="12" rx="6"/><text x="193" y="134" class="pad-small" data-glyph="8">VIEW</text></g>
  <g class="pad-btn" data-b="9"><rect x="238" y="104" width="18" height="12" rx="6"/><text x="247" y="134" class="pad-small" data-glyph="9">MENU</text></g>
  <g class="pad-stick" data-b="10" data-stick="left"><circle class="pad-well" cx="128" cy="108" r="26"/><circle class="pad-cap" cx="128" cy="108" r="17"/></g>
  <g class="pad-stick" data-b="11" data-stick="right"><circle class="pad-well" cx="270" cy="160" r="26"/><circle class="pad-cap" cx="270" cy="160" r="17"/></g>
  <g class="pad-dpad">
    <g class="pad-btn" data-b="12"><rect x="160" y="132" width="18" height="20" rx="3"/></g>
    <g class="pad-btn" data-b="13"><rect x="160" y="168" width="18" height="20" rx="3"/></g>
    <g class="pad-btn" data-b="14"><rect x="140" y="150" width="20" height="20" rx="3"/></g>
    <g class="pad-btn" data-b="15"><rect x="178" y="150" width="20" height="20" rx="3"/></g>
  </g>
  <g class="pad-btn pad-face" data-b="3"><circle cx="314" cy="84" r="12"/><text x="314" y="88" data-glyph="3">Y</text></g>
  <g class="pad-btn pad-face" data-b="2"><circle cx="290" cy="108" r="12"/><text x="290" y="112" data-glyph="2">X</text></g>
  <g class="pad-btn pad-face" data-b="1"><circle cx="338" cy="108" r="12"/><text x="338" y="112" data-glyph="1">B</text></g>
  <g class="pad-btn pad-face" data-b="0"><circle cx="314" cy="132" r="12"/><text x="314" y="136" data-glyph="0">A</text></g>
</svg>`;

const CSS = `
/* crosshair used by the map controllers */
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
.pad-card { width: min(1020px, 100%); max-height: 92vh; overflow-y: auto; border: 1px solid rgba(255,255,255,0.3);
  background: #000; padding: 24px 28px; display: grid; grid-template-columns: 1.12fr 1fr; gap: 26px; }
.pad-embed-card { display: grid; grid-template-columns: 1.05fr 1fr; gap: 20px; padding: 14px;
  border: 1px solid var(--line, rgba(255,255,255,0.22)); background: var(--tint-03, rgba(255,255,255,0.03)); }
@media (max-width: 820px) {
  .pad-card, .pad-embed-card { grid-template-columns: 1fr; }
}
.pad-head { grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap; }
.pad-head h3 { margin: 0; font-weight: 400; font-size: 11px; letter-spacing: 0.16em; color: var(--cyan-bright, #fff); text-transform: uppercase; }
.pad-status { font-size: 10.5px; letter-spacing: 0.1em; color: var(--muted, rgba(255,255,255,0.55)); }
.pad-status.on { color: var(--cyan-bright, #fff); }
.pad-svg { width: 100%; height: auto; display: block; max-width: 420px; margin: 0 auto; }
.pad-svg .pad-body { fill: #0b0b0b; stroke: var(--line-strong, rgba(255,255,255,0.55)); stroke-width: 1.5; }
.pad-svg rect:not(.pad-led-bar), .pad-svg circle { fill: #000; stroke: var(--line-strong, rgba(255,255,255,0.55)); stroke-width: 1.2; transition: fill 0.06s; }
.pad-svg .pad-well { fill: #050505; stroke: var(--line, rgba(255,255,255,0.25)); }
.pad-svg text { fill: var(--cyan, rgba(255,255,255,0.75)); font-size: 11px; text-anchor: middle; font-family: inherit; pointer-events: none; }
.pad-svg .pad-small { font-size: 7px; letter-spacing: 0.1em; fill: var(--muted, rgba(255,255,255,0.45)); }
.pad-svg .lit rect:not(.pad-led-bar), .pad-svg .lit circle:not(.pad-well) { fill: var(--cyan-bright, #fff); }
.pad-svg .lit text { fill: #000; }
.pad-svg .target rect:not(.pad-led-bar), .pad-svg .target circle:not(.pad-well) { stroke: var(--cyan-bright, #fff); stroke-width: 2.5; animation: padblink 0.8s steps(1) infinite; }
@keyframes padblink { 50% { stroke-opacity: 0.2; } }
.pad-trigger-bars { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px auto 6px; max-width: 400px; font-size: 10px; color: var(--muted, rgba(255,255,255,0.7)); }
.pad-tbar-wrap { display: flex; flex-direction: column; gap: 3px; }
.pad-tbar-head { display: flex; justify-content: space-between; letter-spacing: 0.08em; }
.pad-tbar-track { height: 6px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.22); border-radius: 999px; overflow: hidden; }
.pad-tbar-fill { height: 100%; width: 0%; background: var(--cyan-bright, #38bdf8); transition: width 0.04s linear; }
.pad-toolbar { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 8px; }
.pad-toolbar .btn { font-size: 10px; padding: 4px 9px; }
.pad-hint { font-size: 10px; line-height: 1.55; color: var(--muted, rgba(255,255,255,0.55)); margin-top: 8px; }
.pad-list { display: grid; grid-template-columns: 1fr auto auto; gap: 6px 10px; align-items: center; font-size: 11px; }
.pad-list .lbl { color: var(--muted, rgba(255,255,255,0.75)); }
.pad-list .key { color: var(--cyan-bright, #fff); letter-spacing: 0.08em; min-width: 82px; text-align: right; }
.pad-list .key.wait { animation: padblink 0.8s steps(1) infinite; }
.pad-sec { font-size: 9.5px; letter-spacing: 0.2em; color: var(--faint, rgba(255,255,255,0.45)); margin: 13px 0 7px; text-transform: uppercase; }
.pad-sec:first-child { margin-top: 0; }
.pad-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 11px; color: var(--muted, rgba(255,255,255,0.75)); margin: 6px 0; cursor: pointer; }
.pad-row input[type=range] { width: 135px; accent-color: var(--cyan-accent, #fff); cursor: pointer; }
.pad-row select { background: #070a0e; color: #f2f2f2; border: 1px solid rgba(255,255,255,0.3); padding: 3px 7px; font-family: inherit; font-size: 10.5px; }
.pad-foot { display: flex; gap: 10px; justify-content: flex-end; margin-top: 14px; }
`;

let stylesInjected = false;
export function ensurePadStyles() {
  if (stylesInjected || typeof document === "undefined" || !document.head) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.id = "mm-gamepad-ui-styles";
  style.textContent = CSS;
  document.head.appendChild(style);
}

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

const FAMILY_BADGE_LABELS = {
  xbox: { en: "XBOX / XINPUT", tr: "XBOX / XINPUT" },
  playstation: { en: "PLAYSTATION DUALSENSE / DS4", tr: "PLAYSTATION DUALSENSE / DS4" },
  switch: { en: "NINTENDO SWITCH PRO / JOY-CON", tr: "NINTENDO SWITCH PRO / JOY-CON" },
  generic: { en: "SDL STANDARD CONTROLLER", tr: "SDL STANDART KUMANDA" },
};

/**
 * Mount the interactive controller layout, button rebinding list, and analog stick/trigger controls
 * inside a parent container (such as the Controls tab of the unified Settings modal).
 */
export function mountGamepadSettings(container, { tr = false, showCloseButton = false, onClose = null } = {}) {
  if (!container) return { cancel: () => {}, isCapturing: () => false, destroy: () => {} };
  ensurePadStyles();

  const card = el(`
    <div class="${showCloseButton ? "pad-card" : "pad-embed-card"}">
      <div class="pad-head">
        <h3 id="pad-title">${tr ? "ÇOKLU PLATFORM KUMANDA KURULUMU (XBOX · PLAYSTATION · SWITCH)" : "CROSS-PLATFORM CONTROLLER SETUP (XBOX · PLAYSTATION · SWITCH)"}</h3>
        <div class="pad-status" id="pad-status">
          ${
            tr
              ? "KUMANDA BAĞLI DEĞİL · BİR KUMANDA BAĞLAYIP HERHANGİ BİR TUŞA BASIN"
              : "NO CONTROLLER · CONNECT ONE AND PRESS ANY BUTTON"
          }
        </div>
      </div>
      <div>
        ${PAD_SVG}
        <div class="pad-trigger-bars">
          <div class="pad-tbar-wrap">
            <div class="pad-tbar-head"><span id="pad-lt-lbl">LT / L2</span><span id="pad-lt-val">0%</span></div>
            <div class="pad-tbar-track"><div class="pad-tbar-fill" id="pad-lt-fill"></div></div>
          </div>
          <div class="pad-tbar-wrap">
            <div class="pad-tbar-head"><span id="pad-rt-lbl">RT / R2</span><span id="pad-rt-val">0%</span></div>
            <div class="pad-tbar-track"><div class="pad-tbar-fill" id="pad-rt-fill"></div></div>
          </div>
        </div>
        <div class="pad-toolbar">
          <button class="btn" type="button" id="pad-test-rumble">${tr ? "Titreşimi Test Et" : "Test Rumble"}</button>
          <button class="btn" type="button" id="pad-pair-ds">${tr ? "DualSense WebHID Bağla" : "Connect DualSense WebHID"}</button>
          <button class="btn" type="button" id="pad-touch-btn">${tr ? "Dokunmatik Çubuklar" : "Touch Joysticks"}</button>
        </div>
        <div class="pad-hint" id="pad-hint-box"></div>
      </div>
      <div>
        <div class="pad-sec">${tr ? "Profil & Sembol Düzeni" : "Layout Preset & Button Glyphs"}</div>
        <div class="pad-row">
          <span>${tr ? "Kontrol Profili" : "Layout preset"}</span>
          <select id="pad-preset">
            ${Object.values(CONTROLLER_PRESETS)
              .map((p) => `<option value="${p.id}">${tr ? p.labelTr : p.labelEn}</option>`)
              .join("")}
          </select>
        </div>
        <div class="pad-row">
          <span>${tr ? "Tuş Sembolleri" : "Button glyphs"}</span>
          <select id="pad-family">
            <option value="auto">${tr ? "Otomatik Algıla" : "Auto-detect"}</option>
            <option value="xbox">Xbox (A / B / X / Y)</option>
            <option value="playstation">PlayStation (✕ / ○ / □ / △)</option>
            <option value="switch">Nintendo Switch (B / A / Y / X)</option>
          </select>
        </div>
        <div class="pad-sec">${tr ? "Eylemler & Tuş Atamaları" : "Actions & Button Bindings"}</div>
        <div class="pad-list" id="pad-list"></div>
        <div class="pad-sec">${tr ? "Analog Çubuklar & Tetikler" : "Analog Sticks & Triggers"}</div>
        <div class="pad-row">
          <span>${tr ? "Bakış hassasiyeti" : "Look sensitivity"} <strong id="pad-sens-v"></strong></span>
          <input id="pad-sens" type="range" min="0.3" max="2.5" step="0.1"/>
        </div>
        <div class="pad-row">
          <span>${tr ? "Çubuk ölü bölgesi" : "Stick dead zone"} <strong id="pad-dz-v"></strong></span>
          <input id="pad-dz" type="range" min="0.05" max="0.35" step="0.01"/>
        </div>
        <div class="pad-row">
          <span>${tr ? "Tetik ölü bölgesi (LT/RT)" : "Trigger dead zone (LT/RT)"} <strong id="pad-tdz-v"></strong></span>
          <input id="pad-tdz" type="range" min="0" max="0.35" step="0.01"/>
        </div>
        <div class="pad-row">
          <span>${tr ? "Tepki eğrisi" : "Response curve"}</span>
          <select id="pad-curve">
            <option value="linear">${tr ? "Doğrusal (Linear)" : "Linear"}</option>
            <option value="exponential">${tr ? "Üstel (Hassas Merkez)" : "Exponential (Fine Center)"}</option>
            <option value="s-curve">${tr ? "S-Eğrisi (Yumuşak)" : "S-Curve (Smooth)"}</option>
          </select>
        </div>
        <label class="pad-row">
          <span>${tr ? "Yukarı / aşağı bakışı ters çevir" : "Invert look up / down"}</span>
          <input id="pad-inv" type="checkbox"/>
        </label>
        <label class="pad-row">
          <span>${tr ? "Çubukları değiştir (sağ çubukla yürü)" : "Swap sticks (walk on right)"}</span>
          <input id="pad-swap" type="checkbox"/>
        </label>
        <label class="pad-row">
          <span>${tr ? "Titreşim & DualSense Haptik" : "Rumble & DualSense haptics"}</span>
          <input id="pad-hap" type="checkbox"/>
        </label>
        <div class="pad-foot">
          <button class="btn" type="button" id="pad-reset">${tr ? "Kumanda Varsayılanları" : "Controller Defaults"}</button>
          ${showCloseButton ? `<button class="btn primary" type="button" id="pad-close">${tr ? "Tamam" : "Done"}</button>` : ""}
        </div>
      </div>
    </div>
  `);

  container.innerHTML = "";
  container.appendChild(card);

  const status = card.querySelector("#pad-status");
  const list = card.querySelector("#pad-list");
  const svg = card.querySelector(".pad-svg");
  const ledBar = svg.querySelector(".pad-led-bar");
  const parts = [...svg.querySelectorAll("[data-b]")];
  const glyphNodes = [...svg.querySelectorAll("[data-glyph]")];
  const ltLbl = card.querySelector("#pad-lt-lbl");
  const rtLbl = card.querySelector("#pad-rt-lbl");
  const ltVal = card.querySelector("#pad-lt-val");
  const rtVal = card.querySelector("#pad-rt-val");
  const ltFill = card.querySelector("#pad-lt-fill");
  const rtFill = card.querySelector("#pad-rt-fill");
  const hintBox = card.querySelector("#pad-hint-box");
  const sticks = {
    left: svg.querySelector('[data-stick="left"] .pad-cap'),
    right: svg.querySelector('[data-stick="right"] .pad-cap'),
  };
  const stickHome = {
    left: [Number(sticks.left.getAttribute("cx")), Number(sticks.left.getAttribute("cy"))],
    right: [Number(sticks.right.getAttribute("cx")), Number(sticks.right.getAttribute("cy"))],
  };
  let waitingFor = null;
  let lastFamily = null;

  function renderSvgGlyphs() {
    const fam = gamepad.deviceFamily();
    lastFamily = fam;
    for (const node of glyphNodes) {
      const idx = Number(node.dataset.glyph);
      node.textContent = gamepad.glyphFor(idx, { family: fam }).replace(/\s*\(.*?\)/, "").toUpperCase();
    }
    const gBrake = gamepad.glyphFor("brake", { family: fam });
    const gThrottle = gamepad.glyphFor("throttle", { family: fam });
    const gRun = gamepad.glyphFor("run", { family: fam });
    const gJump = gamepad.glyphFor("jump", { family: fam });
    const gInteract = gamepad.glyphFor("interact", { family: fam });
    const gPin = gamepad.glyphFor("pin", { family: fam });
    const gConfirm = gamepad.glyphFor("confirm", { family: fam });
    const gBack = gamepad.glyphFor("back", { family: fam });
    ltLbl.textContent = `${gamepad.glyphFor(6, { family: fam })} (${tr ? "FREN" : "BRAKE"})`;
    rtLbl.textContent = `${gamepad.glyphFor(7, { family: fam })} (${tr ? "GAZ" : "GAS"})`;
    hintBox.innerHTML = tr
      ? `SOL ÇUBUK: HAREKET & 3D HARİTA · SAĞ ÇUBUK: KAMERA & İMLEÇ.<br/>GAZ: ${gThrottle} · FREN: ${gBrake} · HIZLI KOŞU: ${gRun} · ZIPLAMA: ${gJump} · ETKİLEŞİM: ${gInteract} · LANDMARK: ${gPin}.<br/>MENÜLERDE VE HARİTADA: ${gConfirm} SEÇ VE ONAYLA, ${gBack} GERİ GİT.`
      : `LEFT STICK: MOVE & 3D MAP PAN · RIGHT STICK: CAMERA & CURSOR.<br/>THROTTLE: ${gThrottle} · BRAKE: ${gBrake} · FAST RUN: ${gRun} · JUMP: ${gJump} · INTERACT: ${gInteract} · LANDMARK: ${gPin}.<br/>IN MENUS & MAP: ${gConfirm} SELECT & CONFIRM, ${gBack} GO BACK.`;
  }

  function renderList() {
    renderSvgGlyphs();
    list.innerHTML = "";
    const fam = gamepad.deviceFamily();
    for (const a of ACTIONS) {
      const b = gamepad.settings.bindings[a.id];
      const baseText = tr ? ACTION_LABELS_TR[a.id] || a.label : ACTION_LABELS_EN[a.id] || a.label;
      const glyphTxt = b == null ? "—" : gamepad.glyphFor(b, { family: fam, tr });
      const lbl = el(`<span class="lbl">${baseText} (${glyphTxt})</span>`);
      const waitTxt = tr ? "TUŞA BAS…" : "PRESS…";
      const key = el(
        `<span class="key${waitingFor === a.id ? " wait" : ""}">${
          waitingFor === a.id ? waitTxt : b == null ? "—" : fam === "xbox" ? BUTTON_NAMES[b] : glyphTxt
        }</span>`
      );
      const btnTxt = waitingFor === a.id ? (tr ? "İptal" : "Cancel") : tr ? "Ata" : "Assign";
      const btn = el(`<button class="btn" type="button" style="padding:2px 8px;font-size:10px;">${btnTxt}</button>`);
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
    if (!waitingFor) return false;
    waitingFor = null;
    gamepad.cancelCapture();
    renderList();
    return true;
  }

  const presetSel = card.querySelector("#pad-preset");
  const familySel = card.querySelector("#pad-family");
  const sens = card.querySelector("#pad-sens");
  const dz = card.querySelector("#pad-dz");
  const tdz = card.querySelector("#pad-tdz");
  const curveSel = card.querySelector("#pad-curve");
  const inv = card.querySelector("#pad-inv");
  const swap = card.querySelector("#pad-swap");
  const hap = card.querySelector("#pad-hap");
  const rumbleBtn = card.querySelector("#pad-test-rumble");
  const dsBtn = card.querySelector("#pad-pair-ds");
  const touchBtn = card.querySelector("#pad-touch-btn");

  function syncSettings() {
    presetSel.value = gamepad.settings.preset || "eva-default";
    familySel.value = gamepad.settings.glyphFamily || "auto";
    sens.value = gamepad.settings.sensitivity;
    dz.value = gamepad.settings.deadzone;
    tdz.value = gamepad.settings.triggerDeadzone || 0;
    curveSel.value = gamepad.settings.responseCurve || "linear";
    inv.checked = Boolean(gamepad.settings.invertY);
    swap.checked = Boolean(gamepad.settings.swapSticks);
    hap.checked = gamepad.settings.hapticsEnabled !== false;
    card.querySelector("#pad-sens-v").textContent = `${Number(gamepad.settings.sensitivity).toFixed(1)}×`;
    card.querySelector("#pad-dz-v").textContent = `${Math.round(gamepad.settings.deadzone * 100)}%`;
    card.querySelector("#pad-tdz-v").textContent = `${Math.round((gamepad.settings.triggerDeadzone || 0) * 100)}%`;
    touchBtn.classList.toggle("active", Boolean(gamepad.settings.touchControls));
    dsBtn.textContent = gamepad.dualsenseConnected
      ? tr
        ? "DualSense WebHID Aktif ✓"
        : "DualSense WebHID Active ✓"
      : tr
        ? "DualSense WebHID Bağla"
        : "Connect DualSense WebHID";
  }

  presetSel.onchange = () => {
    gamepad.applyPreset(presetSel.value);
    syncSettings();
    renderList();
  };
  familySel.onchange = () => {
    gamepad.set("glyphFamily", familySel.value);
    syncSettings();
    renderList();
  };
  sens.oninput = () => {
    gamepad.set("sensitivity", Number(sens.value));
    syncSettings();
  };
  dz.oninput = () => {
    gamepad.set("deadzone", Number(dz.value));
    syncSettings();
  };
  tdz.oninput = () => {
    gamepad.set("triggerDeadzone", Number(tdz.value));
    syncSettings();
  };
  curveSel.onchange = () => {
    gamepad.set("responseCurve", curveSel.value);
    syncSettings();
  };
  inv.onchange = () => gamepad.set("invertY", inv.checked);
  swap.onchange = () => gamepad.set("swapSticks", swap.checked);
  hap.onchange = () => gamepad.set("hapticsEnabled", hap.checked);

  rumbleBtn.onclick = () => {
    gamepad.triggerHaptic("test", 1.0, { force: true });
  };
  dsBtn.onclick = async () => {
    await gamepad.connectDualSenseWebHID();
    syncSettings();
  };
  touchBtn.onclick = () => {
    gamepad.setTouchControlsEnabled(!gamepad.settings.touchControls);
    syncSettings();
  };

  card.querySelector("#pad-reset").onclick = () => {
    cancel();
    gamepad.reset();
    syncSettings();
    renderList();
  };
  const closeBtn = card.querySelector("#pad-close");
  if (closeBtn && onClose) closeBtn.onclick = onClose;

  syncSettings();
  renderList();

  let rafId = 0;
  let destroyed = false;
  function frame() {
    if (destroyed || !card.isConnected) {
      rafId = 0;
      return;
    }
    const fam = gamepad.deviceFamily();
    if (fam !== lastFamily) {
      renderList();
    }
    for (const p of parts) p.classList.toggle("lit", gamepad.buttons[Number(p.dataset.b)] > 0.5);
    const ltRaw = Math.round((gamepad.buttons[6] || 0) * 100);
    const rtRaw = Math.round((gamepad.buttons[7] || 0) * 100);
    ltVal.textContent = `${ltRaw}%`;
    rtVal.textContent = `${rtRaw}%`;
    ltFill.style.width = `${ltRaw}%`;
    rtFill.style.width = `${rtRaw}%`;

    if (ledBar && gamepad.safetyLedState?.hex) {
      ledBar.setAttribute("fill", gamepad.safetyLedState.hex);
    }

    const ax = gamepad.axes;
    for (const [name, [ix, iy]] of [
      ["left", [0, 1]],
      ["right", [2, 3]],
    ]) {
      const [hx, hy] = stickHome[name];
      sticks[name].setAttribute("cx", String(hx + (ax[ix] || 0) * 9));
      sticks[name].setAttribute("cy", String(hy + (ax[iy] || 0) * 9));
    }
    const famBadge = (FAMILY_BADGE_LABELS[fam] || FAMILY_BADGE_LABELS.xbox)[tr ? "tr" : "en"];
    status.textContent = gamepad.connected
      ? `${tr ? "BAĞLI" : "CONNECTED"} [${famBadge}] · ${(gamepad.connectedId || "").slice(0, 48).toUpperCase()}`
      : tr
        ? "KUMANDA BAĞLI DEĞİL · BİR KUMANDA BAĞLAYIP HERHANGİ BİR TUŞA BASIN"
        : "NO CONTROLLER · CONNECT ONE AND PRESS ANY BUTTON";
    status.classList.toggle("on", gamepad.connected);
    rafId = requestAnimationFrame(frame);
  }
  if (typeof requestAnimationFrame === "function") {
    rafId = requestAnimationFrame(frame);
  }

  return {
    cancel,
    sync: () => {
      syncSettings();
      renderList();
    },
    isCapturing: () => waitingFor != null,
    destroy: () => {
      destroyed = true;
      cancel();
      if (rafId && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    },
  };
}

export function initGamepadSetup({ onOpen = null } = {}) {
  ensurePadStyles();
  const root = el(`<div id="pad-setup" role="dialog" aria-label="Controller setup"></div>`);
  document.body.appendChild(root);
  let mounted = null;

  function close() {
    mounted?.destroy?.();
    mounted = null;
    root.classList.remove("open");
    root.innerHTML = "";
  }

  root.addEventListener("click", (e) => {
    if (e.target === root) close();
  });
  window.addEventListener("keydown", (e) => {
    if (!root.classList.contains("open") || e.key !== "Escape") return;
    if (mounted?.isCapturing?.()) mounted.cancel();
    else close();
  });

  return {
    open() {
      if (typeof onOpen === "function") {
        onOpen();
        return;
      }
      root.classList.add("open");
      mounted?.destroy?.();
      mounted = mountGamepadSettings(root, { showCloseButton: true, onClose: close });
    },
    close,
    get isOpen() {
      return root.classList.contains("open");
    },
  };
}
