/**
 * Virtual Dual-Stick & Action Button Touch Controls (`web/shared/touch-controls.js`).
 *
 * Integrates `nipplejs` (with a built-in zero-network Pointer/Touch fallback manager)
 * to render dual analog virtual joysticks + console-glyph touch action buttons on mobile/tablet
 * screens or when toggled on in Controller Settings. Routes directly into `gamepad` virtual
 * axes and buttons so EVA HUD, Rover Driving, and Orbit View work seamlessly without hardware.
 */

const TOUCH_CSS = `
#mm-touch-controls {
  position: fixed;
  inset: 0;
  z-index: 88;
  pointer-events: none;
  display: none;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  font-family: var(--mono, monospace);
}
#mm-touch-controls.active {
  display: block;
}
body.landing-active #mm-touch-controls,
#start-screen:not(.hidden) ~ #mm-touch-controls {
  display: none !important;
}
.mm-touch-zone {
  position: absolute;
  bottom: 26px;
  width: 148px;
  height: 148px;
  border-radius: 50%;
  border: 1.5px solid rgba(103, 232, 249, 0.35);
  background: radial-gradient(circle, rgba(10, 24, 34, 0.45) 0%, rgba(0, 6, 10, 0.72) 100%);
  pointer-events: auto;
  touch-action: none;
  box-shadow: 0 0 18px rgba(0, 0, 0, 0.55);
}
.mm-touch-zone-left { left: 26px; }
.mm-touch-zone-right { right: 188px; }
.mm-touch-stick-nub {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 52px;
  height: 52px;
  margin: -26px 0 0 -26px;
  border-radius: 50%;
  border: 1.5px solid rgba(165, 243, 252, 0.85);
  background: rgba(34, 211, 238, 0.24);
  box-shadow: 0 0 12px rgba(34, 211, 238, 0.35);
  pointer-events: none;
  transition: transform 0.04s linear;
}
.mm-touch-zone-lbl {
  position: absolute;
  bottom: -18px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 8.5px;
  letter-spacing: 0.14em;
  color: rgba(165, 243, 252, 0.6);
  text-transform: uppercase;
  pointer-events: none;
}
.mm-touch-cluster {
  position: absolute;
  right: 22px;
  bottom: 24px;
  width: 152px;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 7px;
  pointer-events: auto;
}
.mm-touch-btn {
  appearance: none;
  background: rgba(0, 8, 14, 0.8);
  border: 1px solid rgba(103, 232, 249, 0.48);
  color: #e0f2fe;
  border-radius: 8px;
  padding: 8px 6px;
  font-family: inherit;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-align: center;
  cursor: pointer;
  touch-action: none;
}
.mm-touch-btn.pressed {
  background: rgba(34, 211, 238, 0.88);
  color: #000;
  border-color: #fff;
}
.mm-touch-btn b {
  display: block;
  font-size: 11px;
  color: #a5f3fc;
}
.mm-touch-btn.pressed b {
  color: #000;
}
`;

let stylesInjected = false;
function ensureTouchStyles() {
  if (stylesInjected || typeof document === "undefined" || !document.head) return;
  stylesInjected = true;
  const st = document.createElement("style");
  st.id = "mm-touch-controls-styles";
  st.textContent = TOUCH_CSS;
  document.head.appendChild(st);
}

/**
 * Create a lightweight pointer/touch joystick zone that also attaches `nipplejs` if loaded.
 */
function bindStickZone(zoneEl, nubEl, radiusPx, onVector) {
  let activePointerId = null;
  let center = { x: 0, y: 0 };

  function updateFromPoint(clientX, clientY) {
    const dx = clientX - center.x;
    const dy = clientY - center.y;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, radiusPx);
    const angle = Math.atan2(dy, dx);
    const nx = dist > 1e-4 ? (Math.cos(angle) * clamped) / radiusPx : 0;
    const ny = dist > 1e-4 ? (Math.sin(angle) * clamped) / radiusPx : 0;
    if (nubEl) {
      nubEl.style.transform = `translate(${(nx * radiusPx).toFixed(1)}px, ${(ny * radiusPx).toFixed(1)}px)`;
    }
    onVector(nx, ny);
  }

  function resetStick() {
    activePointerId = null;
    if (nubEl) nubEl.style.transform = "translate(0px, 0px)";
    onVector(0, 0);
  }

  zoneEl.addEventListener("pointerdown", (e) => {
    if (activePointerId !== null) return;
    activePointerId = e.pointerId;
    const rect = zoneEl.getBoundingClientRect();
    center = { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 };
    try {
      zoneEl.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    updateFromPoint(e.clientX, e.clientY);
  });

  zoneEl.addEventListener("pointermove", (e) => {
    if (e.pointerId !== activePointerId) return;
    updateFromPoint(e.clientX, e.clientY);
  });

  zoneEl.addEventListener("pointerup", (e) => {
    if (e.pointerId !== activePointerId) return;
    resetStick();
  });

  zoneEl.addEventListener("pointercancel", (e) => {
    if (e.pointerId !== activePointerId) return;
    resetStick();
  });

  return { reset: resetStick };
}

export function createTouchControls(gamepad) {
  let rootEl = null;
  let enabled = false;
  let nippleManagers = [];
  let btnEls = [];

  const TOUCH_ACTIONS = [
    { actionId: "throttle", labelEn: "GAS", labelTr: "GAZ" },
    { actionId: "brake", labelEn: "BRAKE", labelTr: "FREN" },
    { actionId: "jump", labelEn: "JUMP/HB", labelTr: "ZIPLA" },
    { actionId: "run", labelEn: "BOOST", labelTr: "KOŞU" },
    { actionId: "interact", labelEn: "USE", labelTr: "ETKİ" },
    { actionId: "pin", labelEn: "PIN", labelTr: "İŞARET" },
    { actionId: "confirm", labelEn: "OK", labelTr: "SEÇ" },
    { actionId: "lamp", labelEn: "LAMP", labelTr: "FAR" },
  ];

  function refreshGlyphLabels() {
    if (!btnEls.length || !gamepad) return;
    const tr = typeof localStorage !== "undefined" && localStorage.getItem("mm-lang") === "tr";
    for (const item of btnEls) {
      const glyph = gamepad.glyphFor ? gamepad.glyphFor(item.actionId) : item.actionId.toUpperCase();
      const text = tr ? item.labelTr : item.labelEn;
      item.el.innerHTML = `<b>${glyph}</b><span>${text}</span>`;
    }
  }

  function ensureDom() {
    if (rootEl || typeof document === "undefined" || !document.body) return rootEl;
    ensureTouchStyles();

    rootEl = document.createElement("div");
    rootEl.id = "mm-touch-controls";
    rootEl.setAttribute("aria-label", "Virtual Touch Controller");
    rootEl.innerHTML = `
      <div class="mm-touch-zone mm-touch-zone-left" data-stick="left">
        <div class="mm-touch-stick-nub"></div>
        <div class="mm-touch-zone-lbl">MOVE / STEER</div>
      </div>
      <div class="mm-touch-zone mm-touch-zone-right" data-stick="right">
        <div class="mm-touch-stick-nub"></div>
        <div class="mm-touch-zone-lbl">LOOK / AIM</div>
      </div>
      <div class="mm-touch-cluster" data-k="cluster"></div>
    `;
    document.body.appendChild(rootEl);

    const leftZone = rootEl.querySelector('[data-stick="left"]');
    const rightZone = rootEl.querySelector('[data-stick="right"]');
    const leftNub = leftZone.querySelector(".mm-touch-stick-nub");
    const rightNub = rightZone.querySelector(".mm-touch-stick-nub");

    bindStickZone(leftZone, leftNub, 52, (x, y) => {
      gamepad?.setVirtualStick?.("left", x, y);
    });
    bindStickZone(rightZone, rightNub, 52, (x, y) => {
      gamepad?.setVirtualStick?.("right", x, y);
    });

    // Optional progressive nipplejs manager attachment if nipplejs is loaded in window or ESM
    if (typeof window !== "undefined" && window.nipplejs?.create) {
      try {
        const mgrL = window.nipplejs.create({ zone: leftZone, mode: "static", position: { left: "50%", top: "50%" } });
        const mgrR = window.nipplejs.create({ zone: rightZone, mode: "static", position: { left: "50%", top: "50%" } });
        mgrL.on("move", (_evt, data) => {
          if (data?.vector) gamepad?.setVirtualStick?.("left", data.vector.x, -data.vector.y);
        });
        mgrL.on("end", () => gamepad?.setVirtualStick?.("left", 0, 0));
        mgrR.on("move", (_evt, data) => {
          if (data?.vector) gamepad?.setVirtualStick?.("right", data.vector.x, -data.vector.y);
        });
        mgrR.on("end", () => gamepad?.setVirtualStick?.("right", 0, 0));
        nippleManagers.push(mgrL, mgrR);
      } catch {
        /* fallback pointer handler already active */
      }
    }

    const cluster = rootEl.querySelector('[data-k="cluster"]');
    btnEls = TOUCH_ACTIONS.map((spec) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mm-touch-btn";
      b.dataset.action = spec.actionId;

      const setHeld = (val) => {
        b.classList.toggle("pressed", val > 0.5);
        const btnIdx = gamepad?.settings?.bindings?.[spec.actionId];
        if (btnIdx != null) {
          gamepad.setVirtualButton(btnIdx, val);
        }
      };

      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        setHeld(1);
      });
      b.addEventListener("pointerup", () => setHeld(0));
      b.addEventListener("pointercancel", () => setHeld(0));
      b.addEventListener("pointerleave", () => setHeld(0));

      cluster.appendChild(b);
      return { ...spec, el: b };
    });

    refreshGlyphLabels();
    gamepad?.onConnectionChange?.(() => refreshGlyphLabels());
    return rootEl;
  }

  function setEnabled(next) {
    enabled = Boolean(next);
    if (enabled) {
      ensureDom();
    }
    if (rootEl) {
      rootEl.classList.toggle("active", enabled);
    }
    if (!enabled) {
      gamepad?.clearVirtualInputs?.();
    }
    refreshGlyphLabels();
    return enabled;
  }

  return {
    setEnabled,
    isEnabled: () => enabled,
    refreshGlyphLabels,
    destroy() {
      for (const m of nippleManagers) m?.destroy?.();
      nippleManagers = [];
      if (rootEl) {
        rootEl.remove();
        rootEl = null;
      }
    },
  };
}
