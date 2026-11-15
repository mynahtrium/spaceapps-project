/**
 * Martian Mappers — Unified Tone.js & MarsAcoustics Web Audio Engine (`web/shared/audioEngine.js`).
 *
 * Single shared audio synthesis graph (powered by `tone` / Web Audio API + `MarsAcoustics.js`
 * CO2 distance attenuation & low-pass filtering) serving both the HUD/Orbit soundscape and
 * `web/hud/footsteps.js` boot footfalls without duplicate AudioContexts:
 *  1. Martian Thin-Atmosphere Wind Ambience: Brown/pink noise -> slow LFO low-pass filter (80–260 Hz).
 *  2. Spacesuit Helmet PLSS & Breathing: Rhythmic airflow (~14–22 BPM) + 60 Hz circulation hum.
 *  3. Electric Rover Drivetrain Hum: Dual-voice synth (55–240 Hz) scaling with speed & load.
 *  4. Suit-Borne Footsteps & Regolith Scuff (`playFootstep`): CO2-attenuated boot thud + dust brush.
 *  5. Telemetry Chimes, Airlock/UI Micro-Clicks, Jump/Landing & D-Dorian Ambient Pad.
 *
 * Exposes `window.MartianAudio` (`globalThis.MartianAudio`) and injects `[AUDIO: ON/OFF]`.
 */

(function initMartianAudioEngine(globalScope) {
  "use strict";

  const hasWindow = typeof window !== "undefined";
  const hasDocument = typeof document !== "undefined";

  const WIND_MIN_HZ = 80;
  const WIND_MAX_HZ = 260;
  const WIND_CENTER_HZ = (WIND_MIN_HZ + WIND_MAX_HZ) * 0.5;
  const WIND_LFO_DEPTH_HZ = (WIND_MAX_HZ - WIND_MIN_HZ) * 0.5;

  const BREATH_BASE_BPM = 14;
  const BREATH_MAX_BPM = 22;
  const BREATH_SLOPE_THRESHOLD_DEG = 12;
  const SUIT_HUM_HZ = 60;

  const ROVER_MIN_HZ = 55;
  const ROVER_MAX_HZ = 240;
  const ROVER_REF_TOP_SPEED_KMH = 42;

  const HAZARD_BEEP_HZ = 880;
  const HAZARD_SLOPE_THRESHOLD_DEG = 20;
  const HAZARD_COOLDOWN_MS = 20000;
  const UI_CLICK_HZ = 1200;

  const DUSTY_FACIES = new Set(["SIDERITE_HOLLOW", "AEOLIAN_RIPPLE", "STEEP_SCREE"]);
  const DORIAN_CHIME_NOTES = [293.66, 329.63, 349.23, 440.0, 493.88, 523.25, 587.33];

  function clamp(val, min, max) {
    const n = Number(val);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function co2LowPassHz(distanceM) {
    if (globalScope?.MarsAcoustics?.lowPassCutoffHz) {
      return globalScope.MarsAcoustics.lowPassCutoffHz(distanceM);
    }
    const d = Math.max(0, Number(distanceM) || 0);
    return Math.max(180, 2400 * Math.exp(-d / 8));
  }

  function co2AttenuationDbPerM(freqHz) {
    if (globalScope?.MarsAcoustics?.attenuationDbPerM) {
      return globalScope.MarsAcoustics.attenuationDbPerM(freqHz);
    }
    const f = Math.max(0, Number(freqHz) || 0) / 1000;
    return 0.018 * f * f;
  }

  let ToneLib = null;
  let toneLoadedAttempted = false;
  let ctx = null;
  let nodes = null;
  let unlocked = false;
  let muted = false;
  let musicEnabled = true;
  let lastHazardBeepMs = -Infinity;
  let hazardLatched = false;
  let lastUiClickMs = -Infinity;
  let musicNoteIdx = 0;
  let musicTimerId = null;
  let toggleBtnEl = null;

  const telemetry = {
    speedKmh: 0,
    slopeDeg: 0,
    isDriving: false,
    inHabitat: false,
    isAlert: false,
    motorLoad: 0,
    viewMode: "hud",
    breathCadenceBpm: BREATH_BASE_BPM,
    roverFreqHz: ROVER_MIN_HZ,
    roverGain: 0,
  };

  function tryLoadTone() {
    if (toneLoadedAttempted) return;
    toneLoadedAttempted = true;
    if (hasWindow && window.Tone) {
      ToneLib = window.Tone;
      return;
    }
    import("tone")
      .then((mod) => {
        ToneLib = mod?.default || mod;
        if (ToneLib && ctx && typeof ToneLib.setContext === "function") {
          try {
            ToneLib.setContext(ctx);
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {});
  }

  function ensureAudioContext() {
    if (ctx) return ctx;
    tryLoadTone();
    if (ToneLib?.getContext) {
      try {
        const raw = ToneLib.getContext()?.rawContext;
        if (raw) {
          ctx = raw;
          return ctx;
        }
      } catch {
        /* fallback to standard AudioContext */
      }
    }
    if (!hasWindow) return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    try {
      ctx = new AudioCtx();
      if (ToneLib?.setContext) {
        try {
          ToneLib.setContext(ctx);
        } catch {
          /* ignore */
        }
      }
    } catch {
      return null;
    }
    return ctx;
  }

  function createNoiseLoopBuffer(ac, type = "brown", durationSec = 2.5) {
    const rate = ac.sampleRate || 44100;
    const len = Math.max(512, Math.floor(rate * durationSec));
    const buf = ac.createBuffer(1, len, rate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = type === "brown" ? (last + 0.03 * w) / 1.03 : last * 0.55 + w * 0.45;
      data[i] = clamp(type === "brown" ? last * 2.4 : last * 0.7, -0.95, 0.95);
    }
    return buf;
  }

  function buildGraph() {
    if (nodes) return nodes;
    const ac = ensureAudioContext();
    if (!ac) return null;

    const now = ac.currentTime || 0;
    const masterGain = ac.createGain();
    masterGain.gain.setValueAtTime(muted ? 0.0001 : 1.0, now);
    masterGain.connect(ac.destination);

    // 1. Martian CO2 Wind Ambience (Tone-style Noise -> LFO AutoFilter -> CO2 LowPass)
    const windSource = ac.createBufferSource();
    windSource.buffer = createNoiseLoopBuffer(ac, "brown", 3.0);
    windSource.loop = true;

    const windFilter = ac.createBiquadFilter();
    windFilter.type = "lowpass";
    windFilter.frequency.setValueAtTime(WIND_CENTER_HZ, now);
    windFilter.Q.setValueAtTime(1.1, now);

    const windLfo = ac.createOscillator();
    windLfo.type = "sine";
    windLfo.frequency.setValueAtTime(0.085, now);
    const windLfoGain = ac.createGain();
    windLfoGain.gain.setValueAtTime(WIND_LFO_DEPTH_HZ, now);
    windLfo.connect(windLfoGain);
    windLfoGain.connect(windFilter.frequency);

    const windGain = ac.createGain();
    windGain.gain.setValueAtTime(0.15, now);
    windSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(masterGain);

    // 2. Spacesuit PLSS Breathing & 60 Hz Circulation Hum
    const suitBusGain = ac.createGain();
    suitBusGain.gain.setValueAtTime(telemetry.inHabitat ? 0.0001 : 1.0, now);
    suitBusGain.connect(masterGain);

    const suitHumOsc = ac.createOscillator();
    suitHumOsc.type = "sine";
    suitHumOsc.frequency.setValueAtTime(SUIT_HUM_HZ, now);
    const suitHumGain = ac.createGain();
    suitHumGain.gain.setValueAtTime(0.016, now);
    suitHumOsc.connect(suitHumGain);
    suitHumGain.connect(suitBusGain);

    const breathNoise = ac.createBufferSource();
    breathNoise.buffer = createNoiseLoopBuffer(ac, "pink", 2.2);
    breathNoise.loop = true;
    const breathBandpass = ac.createBiquadFilter();
    breathBandpass.type = "bandpass";
    breathBandpass.frequency.setValueAtTime(480, now);
    breathBandpass.Q.setValueAtTime(1.4, now);

    const breathEnvVca = ac.createGain();
    breathEnvVca.gain.setValueAtTime(0.018, now);
    const breathLfo = ac.createOscillator();
    breathLfo.type = "sine";
    breathLfo.frequency.setValueAtTime(BREATH_BASE_BPM / 60, now);
    const breathDepthGain = ac.createGain();
    breathDepthGain.gain.setValueAtTime(0.018, now);
    breathLfo.connect(breathDepthGain);
    breathDepthGain.connect(breathEnvVca.gain);

    breathNoise.connect(breathBandpass);
    breathBandpass.connect(breathEnvVca);
    breathEnvVca.connect(suitBusGain);

    // 3. Electric Rover Drivetrain Hum (Sine + Triangle -> CO2 LowPass)
    const roverOscSine = ac.createOscillator();
    roverOscSine.type = "sine";
    roverOscSine.frequency.setValueAtTime(ROVER_MIN_HZ, now);

    const roverOscTri = ac.createOscillator();
    roverOscTri.type = "triangle";
    roverOscTri.frequency.setValueAtTime(ROVER_MIN_HZ, now);

    const roverFilter = ac.createBiquadFilter();
    roverFilter.type = "lowpass";
    roverFilter.frequency.setValueAtTime(180, now);

    const roverGain = ac.createGain();
    roverGain.gain.setValueAtTime(0.0001, now);

    roverOscSine.connect(roverFilter);
    roverOscTri.connect(roverFilter);
    roverFilter.connect(roverGain);
    roverGain.connect(masterGain);

    // 4. D-Dorian Ambient Exploration Pad
    const musicBusGain = ac.createGain();
    musicBusGain.gain.setValueAtTime(musicEnabled ? 0.05 : 0.0001, now);
    musicBusGain.connect(masterGain);

    const musicFilter = ac.createBiquadFilter();
    musicFilter.type = "lowpass";
    musicFilter.frequency.setValueAtTime(co2LowPassHz(14), now);
    musicFilter.connect(musicBusGain);

    const padOscs = [73.42, 110.0, 164.81, 174.61].map((freq, idx) => {
      const osc = ac.createOscillator();
      osc.type = idx % 2 === 0 ? "sine" : "triangle";
      osc.frequency.setValueAtTime(freq, now);
      const g = ac.createGain();
      g.gain.setValueAtTime(idx === 0 ? 0.38 : 0.2, now);
      osc.connect(g);
      g.connect(musicFilter);
      osc.start(now);
      return osc;
    });

    // Reusable short footstep noise buffers on the shared AudioContext
    const footDustyBuf = createNoiseLoopBuffer(ac, "pink", 0.18);
    const footFirmBuf = createNoiseLoopBuffer(ac, "brown", 0.09);

    windSource.start(now);
    windLfo.start(now);
    suitHumOsc.start(now);
    breathNoise.start(now);
    breathLfo.start(now);
    roverOscSine.start(now);
    roverOscTri.start(now);

    nodes = {
      masterGain,
      windFilter,
      windLfoGain,
      windGain,
      suitBusGain,
      breathLfo,
      breathDepthGain,
      roverOscSine,
      roverOscTri,
      roverFilter,
      roverGain,
      musicBusGain,
      musicFilter,
      padOscs,
      footDustyBuf,
      footFirmBuf,
    };
    return nodes;
  }

  function unlock() {
    if (muted) return false;
    const ac = ensureAudioContext();
    if (!ac) return false;
    buildGraph();
    if (ac.state === "suspended" && typeof ac.resume === "function") {
      ac.resume().catch(() => {});
    }
    if (ToneLib?.start) {
      try {
        ToneLib.start().catch?.(() => {});
      } catch {
        /* ignore */
      }
    }
    unlocked = true;
    applyTelemetryToNodes();
    updateToggleButtonUi();
    return true;
  }

  /**
   * Unified suit-borne footfall + Mars CO2 regolith scuff synthesis used by `web/hud/footsteps.js`.
   * Eliminates the second AudioContext and routes through `MarsAcoustics.js` attenuation & cutoff.
   */
  function playFootstep(side = "L", faciesId = "MUDSTONE", customSpec = null) {
    if (muted || (hasDocument && document.hidden)) return false;
    const ac = ensureAudioContext();
    if (!ac) return false;
    const g = buildGraph();
    if (!g) return false;
    if (ac.state === "suspended" && typeof ac.resume === "function") {
      ac.resume().catch(() => {});
    }

    const now = ac.currentTime || 0;
    const dusty = DUSTY_FACIES.has(faciesId);

    // 1. Suit-borne membrane boot thud (54 Hz L / 60 Hz R -> 34 Hz)
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const jitter = (Math.random() - 0.5) * 3;
    osc.type = "sine";
    osc.frequency.setValueAtTime((side === "L" ? 54 : 60) + jitter, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.11);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.055, now + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.connect(gain);
    gain.connect(g.masterGain);
    osc.start(now);
    osc.stop(now + 0.15);

    // 2. CO2-filtered regolith brush (`MarsAcoustics.js` lowPassCutoffHz + attenuationDbPerM)
    const src = ac.createBufferSource();
    src.buffer = dusty ? g.footDustyBuf : g.footFirmBuf;
    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.setValueAtTime(customSpec?.q ?? 0.5, now);
    const rawCutoff = customSpec?.cutoffHz ?? co2LowPassHz(dusty ? 1.1 : 2.4);
    const cutoff = dusty ? Math.min(680, rawCutoff) : Math.min(340, rawCutoff);
    filter.frequency.setValueAtTime(cutoff, now);
    const db = customSpec?.attenuationDb ?? co2AttenuationDbPerM(cutoff) * 1.6;
    const att = Math.pow(10, -db / 20);
    const sg = ac.createGain();
    sg.gain.setValueAtTime((dusty ? 0.045 : 0.018) * Math.min(1, att * 5), now);
    src.connect(filter);
    filter.connect(sg);
    sg.connect(g.masterGain);
    src.start(now);
    src.stop(now + (dusty ? 0.18 : 0.09));
    return true;
  }

  function playTonePulse(freq0, freq1, durationSec, peakGain, type = "sine", delaySec = 0) {
    if (muted || (hasDocument && document.hidden)) return false;
    const ac = ensureAudioContext();
    const g = buildGraph();
    if (!ac || !g) return false;
    if (ac.state === "suspended" && typeof ac.resume === "function") ac.resume().catch(() => {});

    const start = (ac.currentTime || 0) + delaySec;
    const osc = ac.createOscillator();
    const env = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq0, start);
    if (freq1 !== freq0) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq1), start + durationSec);
    }
    env.gain.setValueAtTime(0.0001, start);
    env.gain.linearRampToValueAtTime(peakGain, start + Math.min(0.012, durationSec * 0.25));
    env.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);
    osc.connect(env);
    env.connect(g.masterGain);
    osc.start(start);
    osc.stop(start + durationSec + 0.01);
    return true;
  }

  function playHazardBeep(options = {}) {
    const force = Boolean(options && options.force);
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (!force && nowMs - lastHazardBeepMs < HAZARD_COOLDOWN_MS) return false;
    lastHazardBeepMs = nowMs;
    globalScope?.MartianGamepad?.triggerHaptic?.("slope-warning", 0.85);
    if (!unlocked) return false;
    const p1 = playTonePulse(HAZARD_BEEP_HZ, HAZARD_BEEP_HZ, 0.082, 0.052, "sine", 0);
    playTonePulse(HAZARD_BEEP_HZ, HAZARD_BEEP_HZ, 0.125, 0.064, "sine", 0.115);
    return p1;
  }

  function playUiClick(options = {}) {
    if (!unlocked) return false;
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (nowMs - lastUiClickMs < 28) return false;
    lastUiClickMs = nowMs;
    const isAirlock = Boolean(options && options.airlock);
    const ok = playTonePulse(UI_CLICK_HZ, isAirlock ? 880 : 980, 0.032, 0.048, "sine", 0);
    if (isAirlock) {
      playTonePulse(UI_CLICK_HZ, 720, 0.05, 0.038, "triangle", 0.055);
    }
    return ok;
  }

  function playAirlockTransition() {
    return playUiClick({ airlock: true });
  }

  function playJump(mode = "takeoff") {
    const isLand = mode === "land" || mode === "landing";
    globalScope?.MartianGamepad?.triggerHaptic?.(isLand ? "land" : "jump", isLand ? 0.75 : 0.45);
    return isLand
      ? playTonePulse(92, 34, 0.18, 0.075, "sine", 0)
      : playTonePulse(110, 210, 0.14, 0.042, "sine", 0);
  }

  function playScienceChime() {
    const notes = [587.33, 739.99, 880.0];
    let ok = false;
    notes.forEach((f, i) => {
      ok = playTonePulse(f, f, 0.24, 0.036, "sine", i * 0.075) || ok;
    });
    return ok;
  }

  function playRadioSquelch() {
    return playTonePulse(1650, 1180, 0.055, 0.028, "triangle", 0);
  }

  function playDescentWhoosh() {
    return playTonePulse(420, 95, 1.4, 0.065, "triangle", 0);
  }

  function triggerAmbientMusicNote() {
    if (muted || !musicEnabled || !unlocked || (hasDocument && document.hidden)) return false;
    if (!ctx || !nodes || ctx.state !== "running") return false;
    const freq = DORIAN_CHIME_NOTES[(musicNoteIdx * 3 + 1) % DORIAN_CHIME_NOTES.length];
    musicNoteIdx += 1;
    return playTonePulse(freq, freq, 2.8, 0.025, "sine", 0);
  }

  function applyTelemetryToNodes() {
    const slope = clamp(telemetry.slopeDeg, 0, 90);
    const speed = clamp(telemetry.speedKmh, 0, 140);

    const slopeExcess = Math.max(0, slope - BREATH_SLOPE_THRESHOLD_DEG);
    const cadenceBoost = clamp(slopeExcess / 12, 0, 1) * (BREATH_MAX_BPM - BREATH_BASE_BPM);
    telemetry.breathCadenceBpm = Number((BREATH_BASE_BPM + cadenceBoost).toFixed(2));

    const speedNorm = clamp(speed / ROVER_REF_TOP_SPEED_KMH, 0, 1);
    const slopeLoad = clamp(slope / 25, 0, 1);
    const motorLoad = Math.max(slopeLoad, clamp(telemetry.motorLoad, 0, 1));
    const excitation = clamp(speedNorm * 0.82 + motorLoad * (speedNorm > 0.01 ? 0.18 : 0.06), 0, 1);

    telemetry.roverFreqHz = Number((ROVER_MIN_HZ + (ROVER_MAX_HZ - ROVER_MIN_HZ) * excitation).toFixed(2));
    telemetry.roverGain = telemetry.isDriving ? Number((0.024 + excitation * 0.115).toFixed(4)) : 0;

    // Sync controller EVA safety lightbar with current slope & alert status
    globalScope?.MartianGamepad?.setSafetyLedState?.({
      slopeDeg: slope,
      isAlert: telemetry.isAlert,
    });

    const steep = slope > HAZARD_SLOPE_THRESHOLD_DEG;
    if (steep && !hazardLatched) {
      hazardLatched = true;
      playHazardBeep({ force: false });
    } else if (slope < HAZARD_SLOPE_THRESHOLD_DEG - 6) {
      hazardLatched = false;
    }

    if (!ctx || !nodes) return;
    const now = ctx.currentTime || 0;
    const isHidden = hasDocument && Boolean(document.hidden);

    nodes.masterGain.gain.setTargetAtTime(muted || isHidden ? 0.0001 : 1.0, now, 0.06);
    nodes.windGain.gain.setTargetAtTime(telemetry.inHabitat ? 0.032 : 0.15, now, 0.35);
    nodes.windFilter.frequency.setTargetAtTime(telemetry.inHabitat ? 110 : WIND_CENTER_HZ, now, 0.35);
    nodes.windLfoGain.gain.setTargetAtTime(telemetry.inHabitat ? 30 : WIND_LFO_DEPTH_HZ, now, 0.35);

    nodes.suitBusGain.gain.setTargetAtTime(telemetry.inHabitat ? 0.0001 : 1.0, now, 0.28);
    nodes.breathLfo.frequency.setTargetAtTime(telemetry.breathCadenceBpm / 60, now, 0.25);

    nodes.roverOscSine.frequency.setTargetAtTime(telemetry.roverFreqHz, now, 0.08);
    nodes.roverOscTri.frequency.setTargetAtTime(telemetry.roverFreqHz, now, 0.08);
    nodes.roverFilter.frequency.setTargetAtTime(165 + excitation * 440, now, 0.1);
    nodes.roverGain.gain.setTargetAtTime(
      telemetry.isDriving ? telemetry.roverGain : 0.0001,
      now,
      telemetry.isDriving ? 0.08 : 0.18
    );

    if (nodes.musicBusGain) {
      const targetMusic = !musicEnabled
        ? 0.0001
        : telemetry.isAlert
          ? 0.022
          : telemetry.isDriving && speed > 4
            ? 0.028
            : 0.048;
      nodes.musicBusGain.gain.setTargetAtTime(targetMusic, now, 0.55);
    }
  }

  function update(partialState) {
    try {
      const input = partialState && typeof partialState === "object" ? partialState : {};
      const prevInHabitat = telemetry.inHabitat;
      const prevIsDriving = telemetry.isDriving;

      if (input.speedKmh !== undefined && Number.isFinite(Number(input.speedKmh))) {
        telemetry.speedKmh = Math.abs(Number(input.speedKmh));
      }
      if (input.slopeDeg !== undefined && Number.isFinite(Number(input.slopeDeg))) {
        telemetry.slopeDeg = Math.abs(Number(input.slopeDeg));
      }
      if (typeof input.isDriving === "boolean") telemetry.isDriving = input.isDriving;
      if (typeof input.inHabitat === "boolean") telemetry.inHabitat = input.inHabitat;
      if (typeof input.isAlert === "boolean") telemetry.isAlert = input.isAlert;
      if (input.motorLoad !== undefined && Number.isFinite(Number(input.motorLoad))) {
        telemetry.motorLoad = clamp(Number(input.motorLoad), 0, 1);
      }

      if (unlocked && (prevInHabitat !== telemetry.inHabitat || prevIsDriving !== telemetry.isDriving)) {
        playAirlockTransition();
      }
      applyTelemetryToNodes();
    } catch {
      /* never throw */
    }
    return getState();
  }

  function setMuted(nextMuted) {
    muted = Boolean(nextMuted);
    if (!muted && !unlocked) {
      unlock();
    } else if (ctx && nodes) {
      const now = ctx.currentTime || 0;
      nodes.masterGain.gain.setTargetAtTime(muted ? 0.0001 : 1.0, now, 0.05);
      if (!muted && ctx.state === "suspended" && typeof ac?.resume === "function") {
        ctx.resume().catch(() => {});
      }
    }
    updateToggleButtonUi();
    return muted;
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    if (!next) playUiClick();
    return !muted;
  }

  function setMusicEnabled(nextEnabled) {
    musicEnabled = Boolean(nextEnabled);
    applyTelemetryToNodes();
    return musicEnabled;
  }

  function toggleMusic() {
    return setMusicEnabled(!musicEnabled);
  }

  function updateToggleButtonUi() {
    if (!toggleBtnEl) return;
    const isOn = !muted;
    toggleBtnEl.textContent = isOn ? "[AUDIO: ON]" : "[AUDIO: OFF]";
    toggleBtnEl.setAttribute("aria-pressed", isOn ? "true" : "false");
    toggleBtnEl.classList.toggle("is-off", !isOn);
  }

  function injectToggleButton() {
    if (!hasDocument || !document.body) return null;
    const existing = document.getElementById("mm-audio-toggle");
    if (existing) {
      toggleBtnEl = existing;
      updateToggleButtonUi();
      return existing;
    }
    const btn = document.createElement("button");
    btn.id = "mm-audio-toggle";
    btn.type = "button";
    btn.className = "btn";
    btn.setAttribute("aria-label", "Toggle Martian Procedural Audio");
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      toggleMute();
    });
    toggleBtnEl = btn;
    updateToggleButtonUi();
    const telemetryBlock = document.querySelector(".visor-top .telemetry, .hud-telemetry-block");
    if (telemetryBlock) {
      const wrap = document.createElement("div");
      wrap.id = "mm-audio-toggle-wrap";
      wrap.appendChild(btn);
      telemetryBlock.insertBefore(wrap, telemetryBlock.firstChild);
    }
    return btn;
  }

  function setupAutoHooks() {
    if (!hasWindow || !hasDocument) return;
    const onFirstGesture = () => {
      if (!unlocked && !muted) unlock();
    };
    window.addEventListener("pointerdown", onFirstGesture, { passive: true, capture: true });
    window.addEventListener("keydown", onFirstGesture, { passive: true, capture: true });
    window.addEventListener("touchstart", onFirstGesture, { passive: true, capture: true });

    document.addEventListener(
      "click",
      (ev) => {
        if (!unlocked && !muted) unlock();
        const target =
          ev.target && typeof ev.target.closest === "function"
            ? ev.target.closest("button, .btn, .txt-btn, .menu-item, [role='button']")
            : null;
        if (!target || target.id === "mm-audio-toggle") return;
        const id = (target.id || "").toLowerCase();
        if (id === "orbit-confirm-go") playDescentWhoosh();
        else if (id === "hud-ping" || id === "esc-pin" || id === "mp-drop-ping") playScienceChime();
        else if (id === "npc-dlg-send" || target.closest("#mp-chat-form")) playRadioSquelch();
        else playUiClick({ airlock: id.includes("orbit") || id.includes("land") || id.includes("habitat") });
      },
      { passive: true, capture: true }
    );

    for (const evtName of ["mm:teleport", "mm:visit-rover-site", "mm:set-route"]) {
      window.addEventListener(evtName, () => {
        if (unlocked && !muted) playAirlockTransition();
      });
    }

    document.addEventListener("visibilitychange", () => applyTelemetryToNodes());
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => injectToggleButton(), { once: true });
    } else {
      injectToggleButton();
    }

    if (!musicTimerId) {
      musicTimerId = setInterval(() => triggerAmbientMusicNote(), 6500);
      if (typeof musicTimerId === "object" && typeof musicTimerId.unref === "function") {
        musicTimerId.unref();
      }
    }
  }

  function getState() {
    return {
      initialized: Boolean(ctx && nodes),
      unlocked,
      muted,
      musicEnabled,
      contextState: ctx ? ctx.state : "uninitialized",
      speedKmh: telemetry.speedKmh,
      slopeDeg: telemetry.slopeDeg,
      isDriving: telemetry.isDriving,
      inHabitat: telemetry.inHabitat,
      isAlert: telemetry.isAlert,
      windCutoffRangeHz: [WIND_MIN_HZ, WIND_MAX_HZ],
      breathCadenceBpm: telemetry.breathCadenceBpm,
      suitHumHz: SUIT_HUM_HZ,
      roverFreqHz: telemetry.roverFreqHz,
      roverGain: telemetry.roverGain,
      lastHazardBeepMs,
    };
  }

  const MartianAudio = {
    update,
    unlock,
    init: unlock,
    start: unlock,
    getContext: ensureAudioContext,
    toggle: toggleMute,
    toggleMute,
    setMuted,
    mute: () => setMuted(true),
    unmute: () => setMuted(false),
    isMuted: () => muted,
    setMusicEnabled,
    toggleMusic,
    isMusicEnabled: () => musicEnabled,
    playClick: () => playUiClick({ airlock: false }),
    playUiClick,
    playAirlock: playAirlockTransition,
    playTeleport: playAirlockTransition,
    playHazardBeep,
    playJump,
    playScienceChime,
    playRadioSquelch,
    playDescentWhoosh,
    playFootstep,
    injectToggleButton,
    getState,
  };

  if (hasWindow) window.MartianAudio = MartianAudio;
  if (globalScope && typeof globalScope === "object") globalScope.MartianAudio = MartianAudio;

  setupAutoHooks();
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
