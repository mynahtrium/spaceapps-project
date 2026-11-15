/**
 * Martian Weather & Space Weather Event System (`web/environment/marsWeather.js`)
 *
 * Self-contained atmospheric and space-weather simulation for Gale Crater / Mount Sharp.
 * Driven by cached NASA Curiosity REMS daily weather, Curiosity RAD dose baseline,
 * and NASA DONKI WSA-Enlil space-weather alerts (with offline/demo-safe fallbacks).
 *
 * Exposes `window.MartianWeather` and exports state helpers for unit testing.
 */

export const WEATHER_STATES = Object.freeze([
  Object.freeze({
    id: "CLEAR_SOL",
    index: 0,
    label: "CLEAR SOL",
    shortLabel: "CLEAR",
    tau: 0.4,
    pressureOffsetPa: 0,
    windMs: 4.2,
    fogDensity: 0.00042,
    sunScale: 1.0,
    hemiScale: 1.0,
    radMultiplier: 1.0, // 0.64 mSv/day (~0.027 mSv/hr)
    isAlert: false,
    banner: null,
  }),
  Object.freeze({
    id: "DUST_DEVIL",
    index: 1,
    label: "DUST DEVIL",
    shortLabel: "VORTEX",
    tau: 0.75,
    pressureOffsetPa: -3, // Brief barometric pressure drop (-3 Pa)
    windMs: 18.5,
    fogDensity: 0.00095,
    sunScale: 0.88,
    hemiScale: 0.94,
    radMultiplier: 1.0,
    isAlert: false,
    banner: null,
  }),
  Object.freeze({
    id: "REGIONAL_DUST_STORM",
    index: 2,
    label: "REGIONAL DUST STORM",
    shortLabel: "DUST STORM",
    tau: 2.8, // High opacity tau > 2.5
    pressureOffsetPa: 4,
    windMs: 28.0,
    fogDensity: 0.0092,
    sunScale: 0.34,
    hemiScale: 0.65,
    radMultiplier: 0.96,
    isAlert: true,
    banner: {
      level: "caution",
      text: "CAUTION: HIGH DUST OPACITY (\u03c4 > 2.5) - REDUCE ROVER SPEED",
    },
  }),
  Object.freeze({
    id: "DONKI_SPE",
    index: 3,
    label: "SOLAR PARTICLE EVENT (DONKI SPE)",
    shortLabel: "DONKI SPE",
    tau: 0.45,
    pressureOffsetPa: 0,
    windMs: 6.0,
    fogDensity: 0.00062,
    sunScale: 0.92,
    hemiScale: 1.08,
    radMultiplier: 106.875, // Spikes ~0.0267 mSv/hr -> ~2.85 mSv/hr
    isAlert: true,
    banner: {
      level: "warning",
      text: "WARNING: DONKI SPE RADIATION SURGE - SEEK HABITAT AIRLOCK",
    },
  }),
]);

const DEFAULT_TELEMETRY = Object.freeze({
  sol: 4995,
  basePressurePa: 740,
  tempMinC: -72,
  tempMaxC: -5,
  baselineRadMsvDay: 0.64,
  donkiAlertCount: 0,
  latestDonkiArrival: null,
  sourceStatus: "fallback",
});

const AUTO_SEQUENCE = [0, 1, 0, 2, 3, 0];
const AUTO_STAGE_SECONDS = 32;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

/**
 * Compute instantaneous atmospheric & radiation telemetry for a given state index and elapsed time.
 */
export function computeWeatherTelemetry(stateIndex, elapsedSec = 0, base = DEFAULT_TELEMETRY) {
  const st = WEATHER_STATES[clamp(Math.floor(stateIndex) || 0, 0, WEATHER_STATES.length - 1)];
  const wave = Math.sin(elapsedSec * 0.7);
  const gustWave = Math.sin(elapsedSec * 2.3) * 0.5 + Math.cos(elapsedSec * 1.1) * 0.5;

  let pressurePa = (base.basePressurePa ?? 740) + st.pressureOffsetPa;
  if (st.id === "DUST_DEVIL") {
    // Convective vortex core passage dips pressure -3 Pa cleanly
    pressurePa = (base.basePressurePa ?? 740) - 3 + Math.sin(elapsedSec * 1.6) * 0.4;
  } else {
    pressurePa += wave * 0.25;
  }

  const tau =
    st.id === "REGIONAL_DUST_STORM"
      ? st.tau + Math.sin(elapsedSec * 0.4) * 0.12
      : st.tau;

  const windMs = Math.max(0.5, st.windMs + gustWave * (st.id === "CLEAR_SOL" ? 0.6 : 2.8));

  const baseMsvDay = base.baselineRadMsvDay ?? 0.64;
  const baseMsvHr = baseMsvDay / 24;
  const radSpikeJitter = st.id === "DONKI_SPE" ? 1 + 0.14 * Math.sin(elapsedSec * 1.9) : 1;
  const radMsvHr = baseMsvHr * st.radMultiplier * radSpikeJitter;
  const radMsvDay = radMsvHr * 24;

  return {
    sol: base.sol ?? 4995,
    stateId: st.id,
    stateIndex: st.index,
    label: st.label,
    shortLabel: st.shortLabel,
    tau: Number(tau.toFixed(2)),
    pressurePa: Math.round(pressurePa),
    tempMinC: base.tempMinC ?? -72,
    tempMaxC: base.tempMaxC ?? -5,
    windMs: Number(windMs.toFixed(1)),
    radMsvDay: Number(radMsvDay.toFixed(2)),
    radMsvHr: Number(radMsvHr.toFixed(3)),
    isAlert: st.isAlert,
    banner: st.banner,
  };
}

class MartianWeatherSystem {
  constructor() {
    this.stateIndex = 0;
    this.autoMode = false;
    this.autoStepIndex = 0;
    this.autoTimerSec = 0;
    this.elapsedSec = 0;

    this.base = { ...DEFAULT_TELEMETRY };
    this._dataLoaded = false;

    // Smoothly interpolated visual weights
    this._blend = {
      tau: WEATHER_STATES[0].tau,
      fogDensity: WEATHER_STATES[0].fogDensity,
      stormWeight: 0,
      speWeight: 0,
      vortexWeight: 0,
      sunScale: 1,
      hemiScale: 1,
    };

    // Three.js scene resources (created lazily when Three.js context is provided)
    this._fx = null;
    this._lastAudioAlert = null;
    this._lastSpeBeepMs = 0;

    // DOM elements
    this._ui = {
      injected: false,
      root: null,
      pill: null,
      banner: null,
    };

    this._onKeyDown = this._onKeyDown.bind(this);
  }

  init() {
    if (typeof window !== "undefined") {
      this._bindKeyboard();
    }
    if (typeof document !== "undefined") {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => this._injectUi(), { once: true });
      } else {
        this._injectUi();
      }
    }
    this.loadScienceData();
    return this;
  }

  async loadScienceData() {
    if (this._dataLoaded || typeof fetch !== "function") return;
    this._dataLoaded = true;

    const isDemo =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location?.search || "").get("demo") === "1";

    const tryJson = async (paths) => {
      for (const p of paths) {
        try {
          const res = await fetch(p, { cache: "no-store" });
          if (res.ok) return await res.json();
        } catch {
          // Offline / fallback to next path
        }
      }
      return null;
    };

    const prefixList = isDemo
      ? ["../data/demo"]
      : ["../data/processed/science", "../data/demo"];

    const [rems, alerts, dose] = await Promise.all([
      tryJson(prefixList.map((d) => `${d}/weather.json`)),
      tryJson(prefixList.map((d) => `${d}/alerts.json`)),
      tryJson(prefixList.map((d) => `${d}/dose.json`)),
    ]);

    if (rems?.latest_sol) {
      const s = rems.latest_sol;
      if (Number.isFinite(Number(s.sol))) this.base.sol = Number(s.sol);
      if (Number.isFinite(Number(s.air_min_C))) this.base.tempMinC = Number(s.air_min_C);
      if (Number.isFinite(Number(s.air_max_C))) this.base.tempMaxC = Number(s.air_max_C);
      this.base.sourceStatus = rems.status || "cached";
    }

    if (alerts && Array.isArray(alerts.alerts)) {
      this.base.donkiAlertCount = alerts.alerts.length;
      this.base.latestDonkiArrival = alerts.alerts[0]?.predicted_arrival || null;
    }

    if (dose && Number.isFinite(Number(dose.baseline_rate_mSv_per_day))) {
      this.base.baselineRadMsvDay = Number(dose.baseline_rate_mSv_per_day);
    }

    this._refreshUi();
  }

  getState() {
    return {
      ...computeWeatherTelemetry(this.stateIndex, this.elapsedSec, this.base),
      autoMode: this.autoMode,
      donkiAlertCount: this.base.donkiAlertCount,
      latestDonkiArrival: this.base.latestDonkiArrival,
    };
  }

  setState(indexOrId, { disableAuto = true } = {}) {
    if (disableAuto) this.autoMode = false;
    let next = 0;
    if (typeof indexOrId === "number") {
      next = ((Math.floor(indexOrId) % WEATHER_STATES.length) + WEATHER_STATES.length) % WEATHER_STATES.length;
    } else if (typeof indexOrId === "string") {
      const upper = indexOrId.toUpperCase();
      const found = WEATHER_STATES.find((s) => s.id === upper || s.shortLabel === upper);
      next = found ? found.index : 0;
    }
    this.stateIndex = next;
    this._syncAudio();
    this._refreshUi();
    return this.getState();
  }

  setAutoMode(enabled) {
    this.autoMode = Boolean(enabled);
    this.autoTimerSec = 0;
    if (this.autoMode) {
      this.autoStepIndex = 0;
      this.stateIndex = AUTO_SEQUENCE[0];
    }
    this._syncAudio();
    this._refreshUi();
    return this.getState();
  }

  /**
   * Cycles: CLEAR SOL (0) -> DUST DEVIL (1) -> REGIONAL DUST STORM (2) -> DONKI SPE (3) -> AUTO -> CLEAR SOL (0)
   */
  cycleState() {
    if (this.autoMode) {
      this.autoMode = false;
      return this.setState(0, { disableAuto: true });
    }
    if (this.stateIndex < WEATHER_STATES.length - 1) {
      return this.setState(this.stateIndex + 1, { disableAuto: true });
    }
    return this.setAutoMode(true);
  }

  /**
   * Per-frame update called from hud3d.js animation loop.
   * Safely modulates scene fog, lighting, dust devil vortex, storm streaks, and ionization tint.
   */
  update(ctx = {}) {
    const dt = clamp(Number(ctx.dt) || 0.016, 0.001, 0.25);
    this.elapsedSec += dt;

    if (this.autoMode) {
      this.autoTimerSec += dt;
      if (this.autoTimerSec >= AUTO_STAGE_SECONDS) {
        this.autoTimerSec = 0;
        this.autoStepIndex = (this.autoStepIndex + 1) % AUTO_SEQUENCE.length;
        this.stateIndex = AUTO_SEQUENCE[this.autoStepIndex];
        this._syncAudio();
      }
    }

    const st = WEATHER_STATES[this.stateIndex];
    const rate = 1 - Math.exp(-dt * 1.8);

    this._blend.tau = lerp(this._blend.tau, st.tau, rate);
    this._blend.fogDensity = lerp(this._blend.fogDensity, st.fogDensity, rate);
    this._blend.stormWeight = lerp(this._blend.stormWeight, st.id === "REGIONAL_DUST_STORM" ? 1 : 0, rate);
    this._blend.speWeight = lerp(this._blend.speWeight, st.id === "DONKI_SPE" ? 1 : 0, rate);
    this._blend.vortexWeight = lerp(this._blend.vortexWeight, st.id === "DUST_DEVIL" ? 1 : 0, rate);
    this._blend.sunScale = lerp(this._blend.sunScale, st.sunScale, rate);
    this._blend.hemiScale = lerp(this._blend.hemiScale, st.hemiScale, rate);

    const { THREE, scene, camera, sun, hemiLight, player, groundY = 0, sampleElevY } = ctx;

    if (THREE && scene) {
      this._ensureSceneFx(THREE, scene);
      this._updateAtmosphere(THREE, { scene, sun, hemiLight });
      this._updateVortex(THREE, { player, groundY, sampleElevY, dt });
      this._updateStormParticles(THREE, { camera, player, dt });
      this._updateSpeParticles(THREE, { camera, dt });
    }

    // Periodic SPE hazard beep if audio is unlocked
    if (st.id === "DONKI_SPE" && typeof performance !== "undefined") {
      const now = performance.now();
      if (now - this._lastSpeBeepMs > 3600) {
        this._lastSpeBeepMs = now;
        this._pulseSpeAudio();
      }
    }

    this._refreshUi();
  }

  _bindKeyboard() {
    if (this._keyBound) return;
    this._keyBound = true;
    window.addEventListener("keydown", this._onKeyDown);
  }

  _onKeyDown(e) {
    if (e.repeat) return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;

    const modalOpen = document.getElementById("modal-backdrop")?.classList.contains("open");
    const crewOpen = document.getElementById("crew-drawer")?.classList.contains("open");
    const escMenuOpen = document.getElementById("esc-menu")?.classList.contains("open");
    const startMenuOpen =
      document.getElementById("start-screen") &&
      !document.getElementById("start-screen").classList.contains("hidden");
    const npcOpen = document.getElementById("npc-dialogue-modal")?.classList.contains("open");
    const landingActive = document.body?.classList?.contains("landing-active");
    const orbitActive = document.getElementById("orbit-view")?.classList.contains("active");
    if (modalOpen || crewOpen || escMenuOpen || startMenuOpen || npcOpen || landingActive || orbitActive) return;

    if (e.key?.toLowerCase() === "m") {
      e.preventDefault();
      if (e.shiftKey) {
        this.setAutoMode(!this.autoMode);
      } else {
        this.cycleState();
      }
    }
  }

  _syncAudio() {
    const st = WEATHER_STATES[this.stateIndex];
    const isAlert = Boolean(st.isAlert);
    try {
      const audio = typeof window !== "undefined" ? window.MartianAudio : null;
      if (audio && typeof audio.update === "function") {
        audio.update({ isAlert });
        if (isAlert && this._lastAudioAlert !== st.id) {
          audio.playHazardBeep?.();
        }
      }
    } catch {
      // Safe no-op if audio engine is unavailable
    }
    this._lastAudioAlert = isAlert ? st.id : null;
  }

  _pulseSpeAudio() {
    try {
      const audio = typeof window !== "undefined" ? window.MartianAudio : null;
      if (audio && typeof audio.update === "function") {
        audio.update({ isAlert: true });
        audio.playHazardBeep?.();
      }
    } catch {
      // Safe no-op
    }
  }

  _ensureSceneFx(THREE, scene) {
    if (this._fx && this._fx.scene === scene) return;

    const root = new THREE.Group();
    root.name = "martian-weather-fx";

    // 1. Dust Devil localized convective vortex (cone + swirling particle column)
    const vortexGroup = new THREE.Group();
    vortexGroup.visible = false;

    const funnelGeo = new THREE.CylinderGeometry(5.2, 1.4, 34, 20, 8, true);
    const funnelMat = new THREE.MeshBasicMaterial({
      color: 0xc97b4c,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const funnelMesh = new THREE.Mesh(funnelGeo, funnelMat);
    funnelMesh.position.y = 17;
    vortexGroup.add(funnelMesh);

    const vortexCount = 420;
    const vortexPos = new Float32Array(vortexCount * 3);
    const vortexMeta = new Float32Array(vortexCount * 3); // angle, height, radius
    for (let i = 0; i < vortexCount; i++) {
      const h = Math.random();
      const ang = Math.random() * Math.PI * 2;
      const r = 1.2 + h * 4.8 + Math.random() * 0.9;
      vortexMeta[i * 3] = ang;
      vortexMeta[i * 3 + 1] = h;
      vortexMeta[i * 3 + 2] = r;
      vortexPos[i * 3] = Math.cos(ang) * r;
      vortexPos[i * 3 + 1] = h * 36;
      vortexPos[i * 3 + 2] = Math.sin(ang) * r;
    }
    const vortexGeo = new THREE.BufferGeometry();
    vortexGeo.setAttribute("position", new THREE.BufferAttribute(vortexPos, 3));
    const vortexMat = new THREE.PointsMaterial({
      color: 0xd99262,
      size: 0.85,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const vortexPoints = new THREE.Points(vortexGeo, vortexMat);
    vortexGroup.add(vortexPoints);
    root.add(vortexGroup);

    // 2. Regional Dust Storm blowing particle streaks
    const stormCount = 550;
    const stormPos = new Float32Array(stormCount * 3);
    for (let i = 0; i < stormCount; i++) {
      stormPos[i * 3] = (Math.random() - 0.5) * 70;
      stormPos[i * 3 + 1] = (Math.random() - 0.3) * 18;
      stormPos[i * 3 + 2] = (Math.random() - 0.5) * 70;
    }
    const stormGeo = new THREE.BufferGeometry();
    stormGeo.setAttribute("position", new THREE.BufferAttribute(stormPos, 3));
    const stormMat = new THREE.PointsMaterial({
      color: 0xd97d45,
      size: 0.34,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const stormPoints = new THREE.Points(stormGeo, stormMat);
    stormPoints.visible = false;
    stormPoints.frustumCulled = false;
    root.add(stormPoints);

    // 3. DONKI SPE high-energy ionization shimmer particles
    const speCount = 180;
    const spePos = new Float32Array(speCount * 3);
    for (let i = 0; i < speCount; i++) {
      spePos[i * 3] = (Math.random() - 0.5) * 50;
      spePos[i * 3 + 1] = Math.random() * 24 - 4;
      spePos[i * 3 + 2] = (Math.random() - 0.5) * 50;
    }
    const speGeo = new THREE.BufferGeometry();
    speGeo.setAttribute("position", new THREE.BufferAttribute(spePos, 3));
    const speMat = new THREE.PointsMaterial({
      color: 0xc084fc,
      size: 0.22,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const spePoints = new THREE.Points(speGeo, speMat);
    spePoints.visible = false;
    spePoints.frustumCulled = false;
    root.add(spePoints);

    scene.add(root);

    this._fx = {
      scene,
      root,
      vortexGroup,
      funnelMesh,
      funnelMat,
      vortexPoints,
      vortexGeo,
      vortexMat,
      vortexMeta,
      vortexCount,
      vortexOffset: { x: 22, z: -18 },
      stormPoints,
      stormGeo,
      stormMat,
      stormCount,
      spePoints,
      speGeo,
      speMat,
      speCount,
      stormFogColor: new THREE.Color(0x9a471f),
      speFogColor: new THREE.Color(0x744d80),
      stormSunColor: new THREE.Color(0xff9254),
      speSunColor: new THREE.Color(0xe9d5ff),
      baseSunColor: new THREE.Color(0xfff1e0),
      baseHemiSky: new THREE.Color(0xc99a76),
      stormHemiSky: new THREE.Color(0xb85b2a),
      speHemiSky: new THREE.Color(0x9f7aea),
    };
  }

  _updateAtmosphere(THREE, { scene, sun, hemiLight }) {
    const { stormWeight, speWeight, fogDensity, sunScale, hemiScale } = this._blend;
    const fx = this._fx;

    if (scene.fog) {
      if (stormWeight > 0.02 || speWeight > 0.02 || this._blend.vortexWeight > 0.05) {
        scene.fog.density = Math.max(scene.fog.density, fogDensity);
      }
      if (stormWeight > 0.01) {
        scene.fog.color.lerp(fx.stormFogColor, stormWeight * 0.85);
      }
      if (speWeight > 0.01) {
        scene.fog.color.lerp(fx.speFogColor, speWeight * 0.35);
      }
    }

    if (sun) {
      sun.intensity *= sunScale;
      if (sun.color) {
        sun.color.copy(fx.baseSunColor);
        if (stormWeight > 0.01) sun.color.lerp(fx.stormSunColor, stormWeight * 0.7);
        if (speWeight > 0.01) sun.color.lerp(fx.speSunColor, speWeight * 0.25);
      }
    }

    if (hemiLight) {
      hemiLight.intensity *= hemiScale;
      if (hemiLight.color) {
        hemiLight.color.copy(fx.baseHemiSky);
        if (stormWeight > 0.01) hemiLight.color.lerp(fx.stormHemiSky, stormWeight * 0.75);
        if (speWeight > 0.01) hemiLight.color.lerp(fx.speHemiSky, speWeight * 0.45);
      }
    }
  }

  _updateVortex(THREE, { player, groundY, sampleElevY, dt }) {
    const fx = this._fx;
    const w = this._blend.vortexWeight;
    if (w < 0.02 || !player) {
      fx.vortexGroup.visible = false;
      return;
    }

    fx.vortexGroup.visible = true;
    fx.funnelMat.opacity = 0.2 * w;
    fx.vortexMat.opacity = 0.75 * w;

    // Slowly drift convective vortex in an elliptical loop near the player
    const orbitT = this.elapsedSec * 0.22;
    const vx = (player.x || 0) + Math.cos(orbitT) * 24 + Math.sin(orbitT * 0.5) * 6;
    const vz = (player.z || 0) + Math.sin(orbitT) * 22;
    const vy = typeof sampleElevY === "function" ? sampleElevY(vx, vz) : groundY;
    fx.vortexGroup.position.set(vx, Number.isFinite(vy) ? vy : groundY, vz);
    fx.funnelMesh.rotation.y += dt * 4.5;

    const posAttr = fx.vortexGeo.getAttribute("position");
    const arr = posAttr.array;
    const meta = fx.vortexMeta;
    for (let i = 0; i < fx.vortexCount; i++) {
      const ang = meta[i * 3] + this.elapsedSec * (5.2 - meta[i * 3 + 1] * 2.1);
      const h = (meta[i * 3 + 1] + this.elapsedSec * 0.28) % 1;
      const r = meta[i * 3 + 2] * (0.75 + h * 0.65);
      arr[i * 3] = Math.cos(ang) * r;
      arr[i * 3 + 1] = h * 36;
      arr[i * 3 + 2] = Math.sin(ang) * r;
    }
    posAttr.needsUpdate = true;
  }

  _updateStormParticles(THREE, { camera, player, dt }) {
    const fx = this._fx;
    const w = this._blend.stormWeight;
    if (w < 0.02) {
      fx.stormPoints.visible = false;
      return;
    }

    fx.stormPoints.visible = true;
    fx.stormMat.opacity = 0.68 * w;

    const cx = camera?.position?.x ?? player?.x ?? 0;
    const cy = camera?.position?.y ?? player?.y ?? 2;
    const cz = camera?.position?.z ?? player?.z ?? 0;
    fx.stormPoints.position.set(cx, cy, cz);

    const posAttr = fx.stormGeo.getAttribute("position");
    const arr = posAttr.array;
    for (let i = 0; i < fx.stormCount; i++) {
      let x = arr[i * 3] + dt * 26.0;
      let y = arr[i * 3 + 1] + Math.sin(this.elapsedSec * 3.1 + i) * dt * 1.4;
      let z = arr[i * 3 + 2] + dt * 9.5;
      if (x > 35) x -= 70;
      if (z > 35) z -= 70;
      if (y > 14) y -= 18;
      if (y < -4) y += 18;
      arr[i * 3] = x;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = z;
    }
    posAttr.needsUpdate = true;
  }

  _updateSpeParticles(THREE, { camera, dt }) {
    const fx = this._fx;
    const w = this._blend.speWeight;
    if (w < 0.02) {
      fx.spePoints.visible = false;
      return;
    }

    fx.spePoints.visible = true;
    fx.speMat.opacity = 0.52 * w;
    if (camera?.position) {
      fx.spePoints.position.copy(camera.position);
    }

    const posAttr = fx.speGeo.getAttribute("position");
    const arr = posAttr.array;
    for (let i = 0; i < fx.speCount; i++) {
      let y = arr[i * 3 + 1] - dt * 14.0;
      if (y < -6) y += 24;
      arr[i * 3 + 1] = y;
    }
    posAttr.needsUpdate = true;
  }

  _injectUi() {
    if (this._ui.injected || typeof document === "undefined") return;
    const visor = document.getElementById("visor-overlay");
    if (!visor) return;
    this._ui.injected = true;

    if (!document.getElementById("mm-weather-styles") && document.head) {
      const style = document.createElement("style");
      style.id = "mm-weather-styles";
      style.textContent = `
        #mm-weather-hud {
          position: absolute;
          top: calc(var(--visor-pad-top, clamp(28px, 4.4vh, 52px)) + 56px);
          left: 50%;
          transform: translateX(-50%);
          z-index: 6;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          pointer-events: none;
          max-width: min(92vw, 680px);
        }
        #mm-weather-pill {
          appearance: none;
          pointer-events: auto;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 4px 12px;
          border-radius: 999px;
          border: 1px solid var(--line-strong, rgba(103, 232, 249, 0.52));
          background: var(--panel, rgba(0, 6, 10, 0.82));
          color: var(--cyan-bright, #a5f3fc);
          font-family: var(--mono, "IBM Plex Mono", "JetBrains Mono", Consolas, monospace);
          font-size: 10px;
          letter-spacing: 0.11em;
          text-transform: uppercase;
          white-space: nowrap;
          cursor: pointer;
          backdrop-filter: blur(6px);
          box-shadow: 0 0 12px rgba(34, 211, 238, 0.14);
          transition: border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
        }
        #mm-weather-pill:hover,
        #mm-weather-pill:focus-visible {
          color: #ffffff;
          border-color: var(--cyan-bright, #a5f3fc);
          outline: none;
        }
        #mm-weather-pill.is-caution {
          border-color: rgba(251, 146, 60, 0.85);
          color: #fdba74;
          box-shadow: 0 0 14px rgba(249, 115, 22, 0.35);
        }
        #mm-weather-pill.is-warning {
          border-color: rgba(248, 113, 113, 0.9);
          color: #fca5a5;
          box-shadow: 0 0 16px rgba(239, 68, 68, 0.45);
        }
        #mm-weather-banner {
          display: none;
          padding: 5px 14px;
          border-radius: 6px;
          font-family: var(--mono, "IBM Plex Mono", "JetBrains Mono", Consolas, monospace);
          font-size: 10.5px;
          font-weight: 600;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          text-align: center;
          backdrop-filter: blur(6px);
        }
        #mm-weather-banner.is-caution {
          display: block;
          background: rgba(67, 20, 7, 0.86);
          border: 1px solid rgba(251, 146, 60, 0.9);
          color: #ffedd5;
          box-shadow: 0 0 18px rgba(249, 115, 22, 0.32);
        }
        #mm-weather-banner.is-warning {
          display: block;
          background: rgba(69, 10, 10, 0.9);
          border: 1px solid rgba(248, 113, 113, 0.95);
          color: #fee2e2;
          box-shadow: 0 0 22px rgba(239, 68, 68, 0.5);
          animation: mmWeatherPulse 1.1s ease-in-out infinite alternate;
        }
        @keyframes mmWeatherPulse {
          from { opacity: 0.85; }
          to { opacity: 1; box-shadow: 0 0 26px rgba(239, 68, 68, 0.78); }
        }
        .visor-overlay.clean-hud #mm-weather-hud {
          display: none;
        }
      `;
      document.head.appendChild(style);
    }

    const root = document.createElement("div");
    root.id = "mm-weather-hud";

    const pill = document.createElement("button");
    pill.id = "mm-weather-pill";
    pill.type = "button";
    pill.title = "Click or press [M] to cycle weather (Shift+Click / Shift+M for Auto Mode)";
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.shiftKey) {
        this.setAutoMode(!this.autoMode);
      } else {
        this.cycleState();
      }
    });

    const banner = document.createElement("div");
    banner.id = "mm-weather-banner";
    banner.setAttribute("role", "alert");

    root.appendChild(pill);
    root.appendChild(banner);
    visor.appendChild(root);

    this._ui.root = root;
    this._ui.pill = pill;
    this._ui.banner = banner;
    this._refreshUi();
  }

  _refreshUi() {
    const { pill, banner } = this._ui;
    if (!pill || !banner) return;

    const t = this.getState();
    const modeSuffix = this.autoMode ? `AUTO:${t.shortLabel}` : t.shortLabel;
    const radExtra =
      t.stateId === "DONKI_SPE" ? ` | ${t.radMsvHr.toFixed(2)} mSv/hr` : "";

    pill.textContent = `SOL ${t.sol} | ${t.pressurePa} Pa | \u03c4 ${t.tau.toFixed(1)} | ${modeSuffix}${radExtra} | [M] WEATHER`;
    pill.classList.toggle("is-caution", t.banner?.level === "caution");
    pill.classList.toggle("is-warning", t.banner?.level === "warning");

    if (t.banner) {
      banner.textContent = t.banner.text;
      banner.className = t.banner.level === "warning" ? "is-warning" : "is-caution";
    } else {
      banner.textContent = "";
      banner.className = "";
    }
  }
}

const instance = new MartianWeatherSystem();

if (typeof window !== "undefined") {
  window.MartianWeather = instance;
  instance.init();
}

export default instance;
