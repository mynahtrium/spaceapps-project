/**
 * Digital instrument cluster for the drivable MMSEV (`web/hud/rover-dash.js`).
 *
 * Shown along the bottom of the screen while you drive: speed, motor RPM arc, gear, motor power
 * (with regen), battery, pitch / roll attitude, the six struts' travel, wheel slip, warnings
 * (airborne, wheelspin, handbrake, steep tilt), and live console-accurate controller prompt pills
 * (throttle, brake, boost, headlights, park brake). Values come from `rover-dynamics.js`.
 */

import { gamepad } from "../shared/gamepad.js";

const RPM_MAX = 4000;
const ARC_START = 135; // degrees, SVG angle (0 = +x), clockwise
const ARC_SWEEP = 270;

function arcPath(cx, cy, r, a0, a1) {
  const p = (a) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export function createRoverDash(host) {
  const el = document.createElement("div");
  el.className = "rover-dash";
  el.setAttribute("aria-live", "off");
  const ticks = [];
  for (let i = 0; i <= 8; i++) {
    const a = ((ARC_START + (ARC_SWEEP * i) / 8) * Math.PI) / 180;
    const r0 = i % 2 === 0 ? 40 : 43;
    ticks.push(
      `<line x1="${(60 + r0 * Math.cos(a)).toFixed(1)}" y1="${(60 + r0 * Math.sin(a)).toFixed(1)}" x2="${(60 + 47 * Math.cos(a)).toFixed(1)}" y2="${(60 + 47 * Math.sin(a)).toFixed(1)}" class="rd-tick${i >= 7 ? " red" : ""}"/>`
    );
    if (i % 2 === 0) {
      ticks.push(
        `<text x="${(60 + 32 * Math.cos(a)).toFixed(1)}" y="${(60 + 32 * Math.sin(a) + 3).toFixed(1)}" class="rd-ticklabel">${i / 2}</text>`
      );
    }
  }
  el.innerHTML = `
    <div class="rd-cell rd-speed">
      <div class="rd-big" data-k="speed">0</div>
      <div class="rd-unit">KM/H</div>
      <div class="rd-sub" data-k="odo">ODO 0.000 KM</div>
      <div class="rd-sub" data-k="mass">2950 KG · 10.9 KN</div>
    </div>
    <div class="rd-cell rd-rpm">
      <svg viewBox="0 0 120 112" aria-hidden="true">
        <path class="rd-arc-bg" d="${arcPath(60, 60, 50, ARC_START, ARC_START + ARC_SWEEP)}"/>
        <path class="rd-arc" data-k="rpmArc" d="${arcPath(60, 60, 50, ARC_START, ARC_START + 0.1)}"/>
        ${ticks.join("")}
        <text x="60" y="66" class="rd-rpmnum" data-k="rpm">0</text>
        <text x="60" y="80" class="rd-rpmunit">RPM ×1000</text>
        <text x="60" y="104" class="rd-gear" data-k="gear">N</text>
      </svg>
    </div>
    <div class="rd-cell rd-bars">
      <div class="rd-row"><span class="rd-k">PWR</span><span class="rd-meter rd-meter-c"><i data-k="pwrBar"></i></span><span class="rd-v" data-k="pwr">0.0 HP · 0.0 kW</span></div>
      <div class="rd-row"><span class="rd-k">TRQ</span><span class="rd-meter"><i data-k="trqBar"></i></span><span class="rd-v" data-k="trq">0 N·m (0%)</span></div>
      <div class="rd-row"><span class="rd-k">BAT</span><span class="rd-meter"><i data-k="batBar"></i></span><span class="rd-v" data-k="bat">100%</span></div>
      <div class="rd-row"><span class="rd-k">ACC</span><span class="rd-meter rd-meter-c"><i data-k="accBar"></i></span><span class="rd-v" data-k="acc">0.00 m/s²</span></div>
    </div>
    <div class="rd-cell rd-att">
      <div class="rd-horizon"><div class="rd-horizon-line" data-k="horizon"></div><div class="rd-horizon-mark"></div></div>
      <div class="rd-sub"><span data-k="pitch">P +0.0°</span> · <span data-k="roll">R +0.0°</span></div>
      <div class="rd-sub" data-k="hdg">HDG 000°</div>
    </div>
    <div class="rd-cell rd-susp">
      <div class="rd-susp-title">SUSPENSION</div>
      <div class="rd-susp-grid" data-k="susp"></div>
      <div class="rd-sub" data-k="slip">GRIP 100%</div>
    </div>
    <div class="rd-cell rd-flags">
      <span class="rd-flag" data-k="fAir">AIR</span>
      <span class="rd-flag" data-k="fSpin">SPIN</span>
      <span class="rd-flag" data-k="fHb">P-BRAKE</span>
      <span class="rd-flag" data-k="fTilt">TILT</span>
      <span class="rd-flag" data-k="fBoost">BOOST</span>
      <div class="rd-pad-prompts" data-k="padPrompts" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;font-size:9px;letter-spacing:0.06em;">
        <span class="rd-flag" data-k="pThrottle">RT GAS</span>
        <span class="rd-flag" data-k="pBrake">LT BRK</span>
        <span class="rd-flag" data-k="pBoost">RB BST</span>
        <span class="rd-flag" data-k="pPark">LB PRK</span>
        <span class="rd-flag" data-k="pLamp">R3 LMP</span>
      </div>
    </div>`;
  host.appendChild(el);
  const k = Object.fromEntries([...el.querySelectorAll("[data-k]")].map((n) => [n.dataset.k, n]));

  // six strut bars, laid out like the wheels seen from above (front at the top)
  const susp = [];
  for (let i = 0; i < 6; i++) {
    const b = document.createElement("div");
    b.className = "rd-strut";
    b.innerHTML = "<i></i>";
    k.susp.appendChild(b);
    susp.push(b.firstChild);
  }

  function renderPromptGlyphs() {
    if (!gamepad?.glyphFor) return;
    const gThrottle = gamepad.glyphFor("throttle");
    const gBrake = gamepad.glyphFor("brake");
    const gBoost = gamepad.glyphFor("run");
    const gPark = gamepad.glyphFor("jump");
    const gLamp = gamepad.glyphFor("lamp");
    if (k.pThrottle) k.pThrottle.textContent = `${gThrottle} GAS`;
    if (k.pBrake) k.pBrake.textContent = `${gBrake} BRK`;
    if (k.pBoost) k.pBoost.textContent = `${gBoost} BST`;
    if (k.pPark) k.pPark.textContent = `${gPark} PRK`;
    if (k.pLamp) k.pLamp.textContent = `${gLamp} LMP`;
  }
  renderPromptGlyphs();
  gamepad?.onConnectionChange?.(() => renderPromptGlyphs());

  let last = 0;
  let wasAirborne = false;
  /**
   * @param {object} t telemetry: { speedKmh, rpm, gear, powerKw, torquePct, batteryPct, accel,
   *   pitchDeg, rollDeg, headingDeg, odoKm, struts:[0..1 x6, FL FR ML MR RL RR], slipPct,
   *   airborne, wheelspin, handbrake, boost }
   */
  function update(t, now = typeof performance !== "undefined" ? performance.now() : Date.now()) {
    // Detect airborne -> touchdown transition even between 50ms UI refreshes
    const landedNow = wasAirborne && !t.airborne;
    wasAirborne = Boolean(t.airborne);
    if (landedNow) {
      const impactIntensity = Math.min(1, 0.48 + Math.abs(Number(t.accel) || 0) * 0.15);
      gamepad?.triggerHaptic?.("land", impactIntensity);
    }

    if (now - last < 50) return; // ~20 updates per second is plenty for a display
    last = now;
    k.speed.textContent = String(Math.round(Math.abs(t.speedKmh)));
    k.odo.textContent = `ODO ${t.odoKm.toFixed(3)} KM`;
    if (k.mass && Number.isFinite(t.massKg)) {
      const wtKn = ((t.weightN || t.massKg * 3.71) / 1000).toFixed(1);
      k.mass.textContent = `${Math.round(t.massKg)} KG · ${wtKn} KN`;
    }
    const rpmFrac = Math.min(1, Math.abs(t.rpm) / RPM_MAX);
    k.rpmArc.setAttribute("d", arcPath(60, 60, 50, ARC_START, ARC_START + Math.max(0.1, ARC_SWEEP * rpmFrac)));
    k.rpmArc.classList.toggle("red", rpmFrac > 0.85);
    k.rpm.textContent = (Math.abs(t.rpm) / 1000).toFixed(2);
    k.gear.textContent = t.gear;
    const maxPwrKw = Number.isFinite(t.maxPowerKw) && t.maxPowerKw > 0 ? t.maxPowerKw : 35;
    const pw = Math.max(-1, Math.min(1, t.powerKw / maxPwrKw));
    k.pwrBar.style.left = pw >= 0 ? "50%" : `${50 + pw * 50}%`;
    k.pwrBar.style.width = `${Math.abs(pw) * 50}%`;
    k.pwrBar.classList.toggle("regen", pw < 0);
    const hpVal = Number.isFinite(t.hp) ? t.hp : Math.abs(t.powerKw * 1.34102);
    k.pwr.textContent = `${t.powerKw >= 0 ? "" : "−"}${hpVal.toFixed(1)} HP · ${Math.abs(t.powerKw).toFixed(1)} kW`;
    k.trqBar.style.width = `${Math.round(Math.abs(t.torquePct) * 100)}%`;
    if (Number.isFinite(t.wheelTorqueNm)) {
      k.trq.textContent = `${Math.round(t.wheelTorqueNm)} N·m (${Math.round(t.torquePct * 100)}%)`;
    } else {
      k.trq.textContent = `${Math.round(t.torquePct * 100)}%`;
    }
    k.batBar.style.width = `${t.batteryPct.toFixed(1)}%`;
    k.bat.textContent = `${t.batteryPct.toFixed(1)}%`;
    const ac = Math.max(-1, Math.min(1, t.accel / 2));
    k.accBar.style.left = ac >= 0 ? "50%" : `${50 + ac * 50}%`;
    k.accBar.style.width = `${Math.abs(ac) * 50}%`;
    k.acc.textContent = `${t.accel >= 0 ? "+" : "−"}${Math.abs(t.accel).toFixed(2)} m/s²`;
    k.horizon.style.transform = `translateY(${Math.max(-22, Math.min(22, t.pitchDeg * 1.6))}px) rotate(${-t.rollDeg}deg)`;
    k.pitch.textContent = `P ${t.pitchDeg >= 0 ? "+" : "−"}${Math.abs(t.pitchDeg).toFixed(1)}°`;
    k.roll.textContent = `R ${t.rollDeg >= 0 ? "+" : "−"}${Math.abs(t.rollDeg).toFixed(1)}°`;
    k.hdg.textContent = `HDG ${String(Math.round(((t.headingDeg % 360) + 360) % 360)).padStart(3, "0")}°`;
    for (let i = 0; i < 6; i++) {
      const v = Math.max(0, Math.min(1, t.struts[i]));
      susp[i].style.height = `${Math.round(v * 100)}%`;
      susp[i].classList.toggle("hot", v > 0.85 || v < 0.04);
    }
    const steepTilt = Math.abs(t.pitchDeg) > 20 || Math.abs(t.rollDeg) > 15;
    k.slip.textContent = `GRIP ${Math.max(0, 100 - Math.round(t.slipPct))}%`;
    k.fAir.classList.toggle("on", Boolean(t.airborne));
    k.fSpin.classList.toggle("on", Boolean(t.wheelspin));
    k.fHb.classList.toggle("on", Boolean(t.handbrake));
    k.fTilt.classList.toggle("on", steepTilt);
    k.fBoost.classList.toggle("on", Boolean(t.boost));

    // Update live controller prompt pills with current console glyphs & active state
    renderPromptGlyphs();
    k.pThrottle?.classList.toggle("on", (gamepad?.analog?.("throttle") || 0) > 0.1);
    k.pBrake?.classList.toggle("on", (gamepad?.analog?.("brake") || 0) > 0.1);
    k.pBoost?.classList.toggle("on", Boolean(t.boost));
    k.pPark?.classList.toggle("on", Boolean(t.handbrake));
    k.pLamp?.classList.toggle("on", Boolean(gamepad?.isDown?.("lamp")));

    // Trigger haptics & DualSense adaptive triggers on wheelspin, boost, and steep tilt alerts
    if (t.wheelspin) {
      gamepad?.triggerHaptic?.("wheelspin", Math.min(1, 0.35 + (Number(t.slipPct) || 30) / 120));
    }
    if (t.boost && Math.abs(t.speedKmh) > 1) {
      gamepad?.triggerHaptic?.("boost", 0.55);
    }
    if (steepTilt) {
      gamepad?.triggerHaptic?.("slope-warning", 0.82);
    }
    gamepad?.updateDriveHaptics?.(t);
    gamepad?.setSafetyLedState?.({
      slopeDeg: Math.max(Math.abs(t.pitchDeg || 0), Math.abs(t.rollDeg || 0)),
    });
  }

  return { el, update };
}
