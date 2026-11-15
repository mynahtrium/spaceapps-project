/**
 * Martian Mappers — Standalone Procedural Web Audio Engine (`web/shared/audioEngine.js`).
 *
 * Zero-dependency, asset-free synthesis using the native browser Web Audio API:
 *  1. Martian Thin-Atmosphere Wind Ambience: Brown/pink noise -> slow LFO-modulated
 *     low-pass BiquadFilterNode (80 Hz – 260 Hz) simulating ~740 Pa Gale Crater gusts.
 *  2. Spacesuit Helmet Life-Support & Breathing: Rhythmic soft white-noise
 *     inhalation/exhalation envelope (~14 breaths/min baseline, faster above 12° slope)
 *     mixed with a faint 60 Hz suit circulation hum when outside the habitat.
 *  3. Electric Rover Drivetrain Hum: Dual-oscillator (sine + triangle) through a warm
 *     low-pass filter, scaling pitch (55 Hz – 240 Hz) and gain with vehicle speed (km/h)
 *     and motor load, fading out cleanly when exiting the rover.
 *  4. Steep Terrain & Hazard Telemetry Beep: Crisp NASA-style 880 Hz dual-pulse sine
 *     chime with a strict 4-second cooldown when slope > 15° or radiation/storm alert is active.
 *  5. UI & Airlock Interaction Clicks: Subtle tactile 1200 Hz short-decay micro-clicks
 *     for HUD button presses and airlock / teleport transitions.
 *
 * Exposes `window.MartianAudio` and injects a compact `[AUDIO: ON/OFF]` pill toggle
 * in the top-right HUD corner.
 */

(function initMartianAudioEngine(globalScope) {
  "use strict";

  const hasWindow = typeof window !== "undefined";
  const hasDocument = typeof document !== "undefined";

  // Acoustic & synthesis constants
  const WIND_MIN_HZ = 80;
  const WIND_MAX_HZ = 260;
  const WIND_CENTER_HZ = (WIND_MIN_HZ + WIND_MAX_HZ) * 0.5; // 170 Hz
  const WIND_LFO_DEPTH_HZ = (WIND_MAX_HZ - WIND_MIN_HZ) * 0.5; // 90 Hz
  const WIND_LFO_RATE_HZ = 0.085; // ~11.8 s gust filter sweep period
  const WIND_GUST_RATE_HZ = 0.032; // ~31 s secondary amplitude swell

  const BREATH_BASE_BPM = 14; // ~14 breaths/min nominal EVA rest/walk cadence
  const BREATH_MAX_BPM = 22; // elevated cadence on steep grades (>12 deg)
  const BREATH_SLOPE_THRESHOLD_DEG = 12;
  const SUIT_HUM_HZ = 60;

  const ROVER_MIN_HZ = 55;
  const ROVER_MAX_HZ = 240;
  const ROVER_REF_TOP_SPEED_KMH = 42;

  const HAZARD_BEEP_HZ = 880;
  const HAZARD_SLOPE_THRESHOLD_DEG = 20;
  const HAZARD_COOLDOWN_MS = 20000;

  const UI_CLICK_HZ = 1200;

  function clamp(val, min, max) {
    const n = Number(val);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  // Engine internal state
  let ctx = null;
  let nodes = null;
  let unlocked = false;
  let muted = false;
  let lastHazardBeepMs = -Infinity;
  let hazardLatched = false;
  let lastUiClickMs = -Infinity;
  let lastExplicitUpdateMs = -Infinity;
  let pollTimerId = null;
  let musicTimerId = null;
  let musicEnabled = true;
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

  /**
   * Build a seamless looping AudioBuffer mixing Brown noise (-6 dB/oct) and
   * Paul Kellet Pink noise (-3 dB/oct) for low-pressure Martian wind.
   */
  function createBrownPinkNoiseBuffer(audioCtx, durationSec = 7.0) {
    const sampleRate = audioCtx.sampleRate || 44100;
    const length = Math.max(1024, Math.floor(sampleRate * durationSec));
    const buffer = audioCtx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    let brown = 0;

    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;

      // Paul Kellet pinking filter
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.04;
      b6 = white * 0.115926;

      // Leaky-integrator brown noise
      brown = (brown + 0.02 * white) / 1.02;
      const brownScaled = brown * 1.85;

      // Blend 65% brown + 35% pink for deep low-pressure Gale Crater rumble + dust shear
      data[i] = clamp(brownScaled * 0.65 + pink * 0.35, -0.98, 0.98);
    }

    // Crossfade loop ends (4096 samples) to prevent any loop boundary click
    const fadeLen = Math.min(4096, Math.floor(length * 0.08));
    for (let i = 0; i < fadeLen; i++) {
      const alpha = i / fadeLen;
      const endIdx = length - fadeLen + i;
      data[endIdx] = data[endIdx] * (1 - alpha) + data[i] * alpha;
    }

    return buffer;
  }

  /**
   * Build a soft, smooth white-noise buffer for helmet PLSS airflow / breathing.
   */
  function createSoftWhiteNoiseBuffer(audioCtx, durationSec = 5.0) {
    const sampleRate = audioCtx.sampleRate || 44100;
    const length = Math.max(1024, Math.floor(sampleRate * durationSec));
    const buffer = audioCtx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    let prev = 0;
    for (let i = 0; i < length; i++) {
      // Triangular PDF white noise with gentle 1-pole smoothing
      const w = (Math.random() + Math.random() - 1) * 0.7;
      prev = prev * 0.35 + w * 0.65;
      data[i] = prev;
    }

    const fadeLen = Math.min(2048, Math.floor(length * 0.06));
    for (let i = 0; i < fadeLen; i++) {
      const alpha = i / fadeLen;
      const endIdx = length - fadeLen + i;
      data[endIdx] = data[endIdx] * (1 - alpha) + data[i] * alpha;
    }

    return buffer;
  }

  /**
   * Build a WaveShaper transfer curve that maps a single sine LFO cycle [-1, +1]
   * into a realistic two-phase inhalation + pause + exhalation + pause envelope.
   */
  function createBreathEnvelopeCurve(samples = 1024) {
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i / (samples - 1)) * 2 - 1; // [-1, 1]
      if (x > 0.16) {
        // Inhalation lobe (positive half-cycle)
        const u = (x - 0.16) / 0.84;
        const s = Math.sin(u * Math.PI * 0.5);
        curve[i] = 0.78 * s * s;
      } else if (x < -0.14) {
        // Exhalation lobe (negative half-cycle, slightly fuller & warmer)
        const u = (-x - 0.14) / 0.86;
        const s = Math.sin(u * Math.PI * 0.5);
        curve[i] = 0.96 * s * s;
      } else {
        // Natural respiratory pause around zero-crossings
        curve[i] = 0.0;
      }
    }
    return curve;
  }

  /**
   * Resolve or construct the native AudioContext.
   */
  function ensureAudioContext() {
    if (ctx) return ctx;
    if (!hasWindow) return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    try {
      ctx = new AudioCtx();
    } catch {
      return null;
    }
    return ctx;
  }

  /**
   * Construct and wire all continuous procedural synthesis layers.
   */
  function buildGraph() {
    if (nodes) return nodes;
    const ac = ensureAudioContext();
    if (!ac) return null;

    const now = ac.currentTime || 0;

    // Master output bus
    const masterGain = ac.createGain();
    masterGain.gain.setValueAtTime(muted ? 0.0001 : 1.0, now);
    masterGain.connect(ac.destination);

    // =========================================================================
    // LAYER 1: Martian Thin-Atmosphere Wind Ambience (80 Hz – 260 Hz LFO LPF)
    // =========================================================================
    const windSource = ac.createBufferSource();
    windSource.buffer = createBrownPinkNoiseBuffer(ac, 7.0);
    windSource.loop = true;

    const windFilter = ac.createBiquadFilter();
    windFilter.type = "lowpass";
    windFilter.frequency.setValueAtTime(WIND_CENTER_HZ, now);
    windFilter.Q.setValueAtTime(1.15, now);

    // Slow LFO sweeping low-pass filter between 80 Hz and 260 Hz (170 ± 90 Hz)
    const windLfo = ac.createOscillator();
    windLfo.type = "sine";
    windLfo.frequency.setValueAtTime(WIND_LFO_RATE_HZ, now);

    const windLfoGain = ac.createGain();
    windLfoGain.gain.setValueAtTime(WIND_LFO_DEPTH_HZ, now);
    windLfo.connect(windLfoGain);
    windLfoGain.connect(windFilter.frequency);

    // Secondary slow gust amplitude swell
    const windGustOsc = ac.createOscillator();
    windGustOsc.type = "sine";
    windGustOsc.frequency.setValueAtTime(WIND_GUST_RATE_HZ, now);

    const windGustDepth = ac.createGain();
    windGustDepth.gain.setValueAtTime(0.035, now);

    const windGain = ac.createGain();
    windGain.gain.setValueAtTime(0.16, now);
    windGustOsc.connect(windGustDepth);
    windGustDepth.connect(windGain.gain);

    windSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(masterGain);

    // =========================================================================
    // LAYER 2: Spacesuit Helmet Life-Support (60 Hz Hum + ~14 BPM Breathing)
    // =========================================================================
    const suitBusGain = ac.createGain();
    suitBusGain.gain.setValueAtTime(telemetry.inHabitat ? 0.0001 : 1.0, now);
    suitBusGain.connect(masterGain);

    // Faint 60 Hz PLSS circulation fan / pump hum
    const suitHumOsc = ac.createOscillator();
    suitHumOsc.type = "sine";
    suitHumOsc.frequency.setValueAtTime(SUIT_HUM_HZ, now);

    const suitHumFilter = ac.createBiquadFilter();
    suitHumFilter.type = "lowpass";
    suitHumFilter.frequency.setValueAtTime(110, now);

    const suitHumGain = ac.createGain();
    suitHumGain.gain.setValueAtTime(0.018, now);

    suitHumOsc.connect(suitHumFilter);
    suitHumFilter.connect(suitHumGain);
    suitHumGain.connect(suitBusGain);

    // Soft white-noise inhalation/exhalation stream
    const breathNoise = ac.createBufferSource();
    breathNoise.buffer = createSoftWhiteNoiseBuffer(ac, 5.0);
    breathNoise.loop = true;

    const breathBandpass = ac.createBiquadFilter();
    breathBandpass.type = "bandpass";
    breathBandpass.frequency.setValueAtTime(480, now);
    breathBandpass.Q.setValueAtTime(1.5, now);

    const breathLowpass = ac.createBiquadFilter();
    breathLowpass.type = "lowpass";
    breathLowpass.frequency.setValueAtTime(1050, now);

    // Envelope VCA controlled by breathLfo -> WaveShaperNode
    const breathEnvVca = ac.createGain();
    breathEnvVca.gain.setValueAtTime(0.0, now);

    const breathLfo = ac.createOscillator();
    breathLfo.type = "sine";
    breathLfo.frequency.setValueAtTime(BREATH_BASE_BPM / 60, now);

    const breathShaper = ac.createWaveShaper();
    breathShaper.curve = createBreathEnvelopeCurve(1024);
    breathShaper.oversample = "2x";

    const breathDepthGain = ac.createGain();
    breathDepthGain.gain.setValueAtTime(0.032, now);

    // Subtle formant shift between inhale (+detune) and exhale (-detune)
    const breathFormantGain = ac.createGain();
    breathFormantGain.gain.setValueAtTime(160, now); // cents
    breathLfo.connect(breathFormantGain);
    if (breathBandpass.detune) {
      breathFormantGain.connect(breathBandpass.detune);
    }

    breathLfo.connect(breathShaper);
    breathShaper.connect(breathDepthGain);
    breathDepthGain.connect(breathEnvVca.gain);

    breathNoise.connect(breathBandpass);
    breathBandpass.connect(breathLowpass);
    breathLowpass.connect(breathEnvVca);
    breathEnvVca.connect(suitBusGain);

    // =========================================================================
    // LAYER 3: Electric Rover Drivetrain Hum (55 Hz – 240 Hz Sine + Triangle)
    // =========================================================================
    const roverOscSine = ac.createOscillator();
    roverOscSine.type = "sine";
    roverOscSine.frequency.setValueAtTime(ROVER_MIN_HZ, now);

    const roverOscTri = ac.createOscillator();
    roverOscTri.type = "triangle";
    roverOscTri.frequency.setValueAtTime(ROVER_MIN_HZ, now);
    if (roverOscTri.detune) {
      roverOscTri.detune.setValueAtTime(4, now); // Warm +4 cent chorus
    }

    const roverSineMix = ac.createGain();
    roverSineMix.gain.setValueAtTime(0.65, now);

    const roverTriMix = ac.createGain();
    roverTriMix.gain.setValueAtTime(0.35, now);

    const roverFilter = ac.createBiquadFilter();
    roverFilter.type = "lowpass";
    roverFilter.frequency.setValueAtTime(180, now);
    roverFilter.Q.setValueAtTime(1.25, now);

    const roverGain = ac.createGain();
    roverGain.gain.setValueAtTime(0.0001, now);

    roverOscSine.connect(roverSineMix);
    roverOscTri.connect(roverTriMix);
    roverSineMix.connect(roverFilter);
    roverTriMix.connect(roverFilter);
    roverFilter.connect(roverGain);
    roverGain.connect(masterGain);

    // =========================================================================
    // LAYER 6: Procedural Ambient Mars Exploration Music (D-Dorian Pad + Bells)
    // =========================================================================
    const musicBusGain = ac.createGain();
    musicBusGain.gain.setValueAtTime(musicEnabled ? 0.055 : 0.0001, now);
    musicBusGain.connect(masterGain);

    const musicFilter = ac.createBiquadFilter();
    musicFilter.type = "lowpass";
    musicFilter.frequency.setValueAtTime(420, now);
    musicFilter.Q.setValueAtTime(0.8, now);
    musicFilter.connect(musicBusGain);

    // Slow LFO breathing the ambient pad filter (260 Hz – 580 Hz)
    const musicLfo = ac.createOscillator();
    musicLfo.type = "sine";
    musicLfo.frequency.setValueAtTime(0.045, now);
    const musicLfoGain = ac.createGain();
    musicLfoGain.gain.setValueAtTime(160, now);
    musicLfo.connect(musicLfoGain);
    musicLfoGain.connect(musicFilter.frequency);

    // Warm D-Dorian fifth/ninth chord voices (D2 73.42, A2 110.0, E3 164.81, F3 174.61)
    const padFreqs = [73.42, 110.0, 164.81, 174.61];
    const padOscs = padFreqs.map((freq, idx) => {
      const osc = ac.createOscillator();
      osc.type = idx % 2 === 0 ? "sine" : "triangle";
      osc.frequency.setValueAtTime(freq, now);
      if (osc.detune) {
        osc.detune.setValueAtTime((idx - 1.5) * 3.5, now);
      }
      const g = ac.createGain();
      g.gain.setValueAtTime(idx === 0 ? 0.42 : 0.22, now);
      osc.connect(g);
      g.connect(musicFilter);
      return osc;
    });

    // Start all continuous generators
    windSource.start(now);
    windLfo.start(now);
    windGustOsc.start(now);
    suitHumOsc.start(now);
    breathNoise.start(now);
    breathLfo.start(now);
    roverOscSine.start(now);
    roverOscTri.start(now);
    musicLfo.start(now);
    for (const o of padOscs) o.start(now);

    nodes = {
      masterGain,
      windSource,
      windFilter,
      windLfo,
      windLfoGain,
      windGustOsc,
      windGain,
      suitBusGain,
      suitHumOsc,
      suitHumGain,
      breathNoise,
      breathBandpass,
      breathLfo,
      breathDepthGain,
      roverOscSine,
      roverOscTri,
      roverFilter,
      roverGain,
      musicBusGain,
      musicFilter,
      musicLfo,
      padOscs,
    };

    return nodes;
  }

  /**
   * Safely unlock and resume the AudioContext on first user interaction.
   */
  function unlock() {
    if (muted) return false;
    const ac = ensureAudioContext();
    if (!ac) return false;
    buildGraph();
    if (ac.state === "suspended" && typeof ac.resume === "function") {
      ac.resume().catch(() => {});
    }
    unlocked = true;
    applyTelemetryToNodes();
    updateToggleButtonUi();
    return true;
  }

  // ===========================================================================
  // LAYER 4: Steep Terrain & Hazard Telemetry Beep (880 Hz Dual-Pulse Chime)
  // ===========================================================================
  function playHazardBeep(options = {}) {
    const force = Boolean(options && options.force);
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (!force && nowMs - lastHazardBeepMs < HAZARD_COOLDOWN_MS) {
      return false;
    }
    lastHazardBeepMs = nowMs;

    if (!unlocked || muted || (hasDocument && document.hidden)) return false;
    const ac = ensureAudioContext();
    if (!ac) return false;
    const g = buildGraph();
    if (!g) return false;
    if (ac.state === "suspended" && typeof ac.resume === "function") {
      ac.resume().catch(() => {});
    }

    const t0 = ac.currentTime;
    const pulseOffsets = [0.0, 0.115];
    const pulseDurations = [0.082, 0.125];
    const pulsePeaks = [0.052, 0.064];

    for (let i = 0; i < 2; i++) {
      const start = t0 + pulseOffsets[i];
      const dur = pulseDurations[i];
      const peak = pulsePeaks[i];

      const osc = ac.createOscillator();
      const env = ac.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(HAZARD_BEEP_HZ, start);

      env.gain.setValueAtTime(0.0001, start);
      env.gain.linearRampToValueAtTime(peak, start + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, start + dur);

      osc.connect(env);
      env.connect(g.masterGain);
      osc.start(start);
      osc.stop(start + dur + 0.01);
    }

    return true;
  }

  // ===========================================================================
  // LAYER 5: UI & Airlock Interaction Clicks (1200 Hz Tactile Micro-Clicks)
  // ===========================================================================
  function playUiClick(options = {}) {
    if (!unlocked || muted || (hasDocument && document.hidden)) return false;
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (nowMs - lastUiClickMs < 28) return false;
    lastUiClickMs = nowMs;

    const ac = ensureAudioContext();
    if (!ac) return false;
    const g = buildGraph();
    if (!g) return false;
    if (ac.state === "suspended" && typeof ac.resume === "function") {
      ac.resume().catch(() => {});
    }

    const now = ac.currentTime;
    const isAirlock = Boolean(options && options.airlock);

    // Primary 1200 Hz tactile switch micro-click
    const osc = ac.createOscillator();
    const env = ac.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(UI_CLICK_HZ, now);
    osc.frequency.exponentialRampToValueAtTime(isAirlock ? 880 : 980, now + 0.028);

    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(0.048, now + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.032);

    osc.connect(env);
    env.connect(g.masterGain);
    osc.start(now);
    osc.stop(now + 0.036);

    // If airlock / teleport transition, add a subtle secondary latch click + brief pressure seal whisper
    if (isAirlock) {
      const osc2 = ac.createOscillator();
      const env2 = ac.createGain();
      const t2 = now + 0.055;
      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(UI_CLICK_HZ, t2);
      osc2.frequency.exponentialRampToValueAtTime(720, t2 + 0.045);

      env2.gain.setValueAtTime(0.0001, t2);
      env2.gain.linearRampToValueAtTime(0.038, t2 + 0.003);
      env2.gain.exponentialRampToValueAtTime(0.0001, t2 + 0.05);

      osc2.connect(env2);
      env2.connect(g.masterGain);
      osc2.start(t2);
      osc2.stop(t2 + 0.055);
    }

    return true;
  }

  function playAirlockTransition() {
    return playUiClick({ airlock: true });
  }

  // ===========================================================================
  // ADDITIONAL EVA & ORBIT SOUND EFFECTS + GENERATIVE MUSIC BELLS
  // ===========================================================================
  function playJump(mode = "takeoff") {
    if (muted || (hasDocument && document.hidden)) return false;
    const ac = ensureAudioContext();
    if (!ac) return false;
    const g = buildGraph();
    if (!g) return false;
    if (ac.state === "suspended" && typeof ac.resume === "function") ac.resume().catch(() => {});

    const now = ac.currentTime;
    const isLand = mode === "land" || mode === "landing";
    const osc = ac.createOscillator();
    const env = ac.createGain();
    osc.type = "sine";

    if (isLand) {
      osc.frequency.setValueAtTime(92, now);
      osc.frequency.exponentialRampToValueAtTime(34, now + 0.16);
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(0.075, now + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      osc.connect(env);
      env.connect(g.masterGain);
      osc.start(now);
      osc.stop(now + 0.19);
    } else {
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.exponentialRampToValueAtTime(210, now + 0.12);
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(0.042, now + 0.014);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      osc.connect(env);
      env.connect(g.masterGain);
      osc.start(now);
      osc.stop(now + 0.15);
    }
    return true;
  }

  function playScienceChime() {
    if (muted || (hasDocument && document.hidden)) return false;
    const ac = ensureAudioContext();
    if (!ac) return false;
    const g = buildGraph();
    if (!g) return false;
    if (ac.state === "suspended" && typeof ac.resume === "function") ac.resume().catch(() => {});

    const now = ac.currentTime;
    const notes = [587.33, 739.99, 880.0]; // D5 -> F#5 -> A5 ascending NASA telemetry chime
    notes.forEach((freq, i) => {
      const start = now + i * 0.075;
      const osc = ac.createOscillator();
      const env = ac.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);
      env.gain.setValueAtTime(0.0001, start);
      env.gain.linearRampToValueAtTime(0.036, start + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
      osc.connect(env);
      env.connect(g.masterGain);
      osc.start(start);
      osc.stop(start + 0.26);
    });
    return true;
  }

  function playRadioSquelch() {
    if (muted || (hasDocument && document.hidden)) return false;
    const ac = ensureAudioContext();
    if (!ac) return false;
    const g = buildGraph();
    if (!g) return false;
    if (ac.state === "suspended" && typeof ac.resume === "function") ac.resume().catch(() => {});

    const now = ac.currentTime;
    const osc = ac.createOscillator();
    const env = ac.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(1650, now);
    osc.frequency.exponentialRampToValueAtTime(1180, now + 0.045);
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(0.028, now + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    osc.connect(env);
    env.connect(g.masterGain);
    osc.start(now);
    osc.stop(now + 0.06);
    return true;
  }

  function playDescentWhoosh() {
    if (muted || (hasDocument && document.hidden)) return false;
    const ac = ensureAudioContext();
    if (!ac) return false;
    const g = buildGraph();
    if (!g) return false;
    if (ac.state === "suspended" && typeof ac.resume === "function") ac.resume().catch(() => {});

    const now = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = createSoftWhiteNoiseBuffer(ac, 1.8);
    const flt = ac.createBiquadFilter();
    flt.type = "bandpass";
    flt.Q.setValueAtTime(1.4, now);
    flt.frequency.setValueAtTime(950, now);
    flt.frequency.exponentialRampToValueAtTime(140, now + 1.5);
    const env = ac.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(0.09, now + 0.22);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
    src.connect(flt);
    flt.connect(env);
    env.connect(g.masterGain);
    src.start(now);
    src.stop(now + 1.65);
    return true;
  }

  const DORIAN_CHIME_NOTES = [293.66, 329.63, 349.23, 440.0, 493.88, 523.25, 587.33]; // D4 E4 F4 A4 B4 C5 D5
  let musicNoteIdx = 0;

  function triggerAmbientMusicNote() {
    if (muted || !musicEnabled || !unlocked || (hasDocument && document.hidden)) return false;
    if (!ctx || !nodes || ctx.state !== "running") return false;
    const now = ctx.currentTime;
    const freq = DORIAN_CHIME_NOTES[(musicNoteIdx * 3 + 1) % DORIAN_CHIME_NOTES.length];
    musicNoteIdx += 1;

    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(0.14, now + 0.35);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);
    osc.connect(env);
    env.connect(nodes.musicFilter);
    osc.start(now);
    osc.stop(now + 3.3);
    return true;
  }

  /**
   * Read fallback state from global variables or live HUD DOM elements
   * without throwing if any element or property is missing.
   */
  function readFallbackEnvironmentState() {
    const fallback = {
      speedKmh: 0,
      slopeDeg: 0,
      isDriving: false,
      inHabitat: false,
      isAlert: false,
      motorLoad: 0,
    };

    try {
      // 1. Check optional global state objects if exposed by any module
      const gState =
        (hasWindow && (window.MartianTelemetry || window.marsTelemetry || window.hudState || window.roverState)) ||
        null;
      if (gState && typeof gState === "object") {
        if (Number.isFinite(Number(gState.speedKmh))) fallback.speedKmh = Number(gState.speedKmh);
        if (Number.isFinite(Number(gState.slopeDeg))) fallback.slopeDeg = Number(gState.slopeDeg);
        if (typeof gState.isDriving === "boolean") fallback.isDriving = gState.isDriving;
        if (typeof gState.inHabitat === "boolean") fallback.inHabitat = gState.inHabitat;
        if (typeof gState.isAlert === "boolean") fallback.isAlert = gState.isAlert;
        if (Number.isFinite(Number(gState.motorLoad))) fallback.motorLoad = Number(gState.motorLoad);
      }

      if (!hasDocument) return fallback;

      // 2. Read slope from #hud-slope ("14.2°")
      const slopeEl = document.getElementById("hud-slope");
      if (slopeEl && slopeEl.textContent) {
        const parsedSlope = parseFloat(slopeEl.textContent);
        if (Number.isFinite(parsedSlope)) {
          fallback.slopeDeg = Math.abs(parsedSlope);
        }
      }

      // 3. Detect driving state from #visor-overlay.driving-3p or active rover dashboard
      const visorEl = document.getElementById("visor-overlay");
      if (visorEl && visorEl.classList.contains("driving-3p")) {
        fallback.isDriving = true;
      }

      // 4. Read vehicle speed (km/h) from #hud-drv-spd or .rover-dash [data-k="speed"]
      const drvSpdEl = document.getElementById("hud-drv-spd");
      if (drvSpdEl && drvSpdEl.textContent != null) {
        const spd = parseFloat(drvSpdEl.textContent);
        if (Number.isFinite(spd)) {
          fallback.speedKmh = Math.abs(spd);
        }
      }
      const dashSpdEl = document.querySelector('.rover-dash [data-k="speed"]');
      if (dashSpdEl && dashSpdEl.textContent != null) {
        const spd2 = parseFloat(dashSpdEl.textContent);
        if (Number.isFinite(spd2) && spd2 > fallback.speedKmh) {
          fallback.speedKmh = Math.abs(spd2);
        }
      }

      // Read motor RPM / load bar width if present ("65%")
      const rpmEl = document.getElementById("hud-drv-rpm");
      if (rpmEl && rpmEl.style && rpmEl.style.width) {
        const rpmPct = parseFloat(rpmEl.style.width);
        if (Number.isFinite(rpmPct)) {
          fallback.motorLoad = clamp(rpmPct / 100, 0, 1);
        }
      }

      // 5. Check habitat state from body dataset or HUD notices
      if (document.body && document.body.dataset && document.body.dataset.inHabitat === "true") {
        fallback.inHabitat = true;
      } else {
        const noticeEl = document.getElementById("hud-wrap-notice");
        if (noticeEl && noticeEl.textContent) {
          const txt = noticeEl.textContent.toUpperCase();
          if (txt.includes("TRANSIT TERMINAL") || txt.includes("DORMITORY") || txt.includes("CAFETERIA")) {
            fallback.inHabitat = true;
          }
        }
      }

      // 6. Check steep/hazard alert state from slope badge or rover tilt warning flag
      const badgeEl = document.getElementById("hud-slope-badge");
      if (
        badgeEl &&
        (badgeEl.classList.contains("slope-red") || badgeEl.classList.contains("slope-blocked"))
      ) {
        fallback.isAlert = true;
      }
      const tiltFlagEl = document.querySelector('.rover-dash [data-k="fTilt"].on');
      if (tiltFlagEl) {
        fallback.isAlert = true;
      }
    } catch {
      // Never throw if DOM or globals are partially initialized
    }

    return fallback;
  }

  /**
   * Apply current `telemetry` values smoothly to all active Web Audio nodes.
   */
  function applyTelemetryToNodes() {
    // Compute derived DSP targets even before AudioContext is unlocked (for state inspection/tests)
    const slope = clamp(telemetry.slopeDeg, 0, 90);
    const speed = clamp(telemetry.speedKmh, 0, 140);

    // Breathing cadence: ~14 BPM at <= 12° slope, scaling up to 22 BPM on steeper slopes
    const slopeExcess = Math.max(0, slope - BREATH_SLOPE_THRESHOLD_DEG);
    const cadenceBoost = clamp(slopeExcess / 12, 0, 1) * (BREATH_MAX_BPM - BREATH_BASE_BPM);
    telemetry.breathCadenceBpm = Number((BREATH_BASE_BPM + cadenceBoost).toFixed(2));

    // Rover drivetrain frequency (55 Hz – 240 Hz) and gain
    const speedNorm = clamp(speed / ROVER_REF_TOP_SPEED_KMH, 0, 1);
    const slopeLoad = clamp(slope / 25, 0, 1);
    const motorLoad = Math.max(slopeLoad, clamp(telemetry.motorLoad, 0, 1));
    const excitation = clamp(speedNorm * 0.82 + motorLoad * (speedNorm > 0.01 ? 0.18 : 0.06), 0, 1);

    telemetry.roverFreqHz = Number(
      (ROVER_MIN_HZ + (ROVER_MAX_HZ - ROVER_MIN_HZ) * excitation).toFixed(2)
    );
    telemetry.roverGain = telemetry.isDriving
      ? Number((0.024 + excitation * 0.115).toFixed(4))
      : 0;

    // 880 Hz dual-pulse hazard chime: ONE beep when you step onto a steep slope (> 20 deg, the
    // walking limit), not every 4 s while you stand or walk on it (most of the HiRISE terrain is
    // steeper than 15 deg, which made the simulation beep "for no reason"). Weather and radiation
    // alerts beep once when they start (marsWeather.js calls playHazardBeep itself) and show a banner.
    const steep = slope > HAZARD_SLOPE_THRESHOLD_DEG;
    if (steep && !hazardLatched) {
      hazardLatched = true;
      playHazardBeep({ force: false });
    } else if (slope < HAZARD_SLOPE_THRESHOLD_DEG - 6) {
      hazardLatched = false; // back on gentle ground: the next steep slope beeps again
    }

    if (!ctx || !nodes) return;

    const now = ctx.currentTime || 0;
    const isHidden = hasDocument && Boolean(document.hidden);

    // Master mute / tab visibility ducking
    const targetMaster = muted || isHidden ? 0.0001 : 1.0;
    nodes.masterGain.gain.setTargetAtTime(targetMaster, now, 0.06);

    // 1. Martian Wind Ambience (muffled inside habitat, full outside)
    const targetWindGain = telemetry.inHabitat ? 0.032 : 0.16;
    const targetWindCenterHz = telemetry.inHabitat ? 110 : WIND_CENTER_HZ;
    const targetWindDepthHz = telemetry.inHabitat ? 30 : WIND_LFO_DEPTH_HZ;
    nodes.windGain.gain.setTargetAtTime(targetWindGain, now, 0.35);
    nodes.windFilter.frequency.setTargetAtTime(targetWindCenterHz, now, 0.35);
    nodes.windLfoGain.gain.setTargetAtTime(targetWindDepthHz, now, 0.35);

    // 2. Spacesuit Life-Support & Breathing (active outside habitat, silent inside)
    const targetSuitBus = telemetry.inHabitat ? 0.0001 : 1.0;
    nodes.suitBusGain.gain.setTargetAtTime(targetSuitBus, now, 0.28);
    nodes.breathLfo.frequency.setTargetAtTime(telemetry.breathCadenceBpm / 60, now, 0.25);
    const breathDepth = 0.030 + clamp(slopeExcess / 15, 0, 1) * 0.014;
    nodes.breathDepthGain.gain.setTargetAtTime(breathDepth, now, 0.25);

    // 3. Electric Rover Drivetrain Hum (55 Hz – 240 Hz, fades out cleanly when exiting rover)
    nodes.roverOscSine.frequency.setTargetAtTime(telemetry.roverFreqHz, now, 0.08);
    nodes.roverOscTri.frequency.setTargetAtTime(telemetry.roverFreqHz, now, 0.08);

    const roverCutoffHz = 165 + excitation * 440;
    nodes.roverFilter.frequency.setTargetAtTime(roverCutoffHz, now, 0.1);

    const targetRoverGain = telemetry.isDriving ? telemetry.roverGain : 0.0001;
    const fadeTimeConstant = telemetry.isDriving ? 0.08 : 0.18;
    nodes.roverGain.gain.setTargetAtTime(targetRoverGain, now, fadeTimeConstant);

    // 4. Procedural Ambient Space Music (warmer in Orbit/Start, ducks softly when driving fast or on alerts)
    if (nodes.musicBusGain) {
      let targetMusic = 0.048;
      if (!musicEnabled) {
        targetMusic = 0.0001;
      } else if (telemetry.isAlert) {
        targetMusic = 0.022;
      } else if (telemetry.isDriving && speed > 4) {
        targetMusic = 0.028;
      } else if (telemetry.inHabitat) {
        targetMusic = 0.056;
      }
      nodes.musicBusGain.gain.setTargetAtTime(targetMusic, now, 0.55);
    }
  }

  /**
   * Public update method:
   * `window.MartianAudio.update({ speedKmh, slopeDeg, isDriving, inHabitat, isAlert })`
   * Safely merges any provided values with fallback global/DOM state without throwing.
   */
  function update(partialState) {
    try {
      const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
      const fb = readFallbackEnvironmentState();
      const input = partialState && typeof partialState === "object" ? partialState : {};

      const hasExplicit =
        input.speedKmh !== undefined ||
        input.slopeDeg !== undefined ||
        input.isDriving !== undefined ||
        input.inHabitat !== undefined ||
        input.isAlert !== undefined;

      if (hasExplicit) {
        lastExplicitUpdateMs = nowMs;
      }

      const prevInHabitat = telemetry.inHabitat;
      const prevIsDriving = telemetry.isDriving;

      telemetry.speedKmh =
        input.speedKmh !== undefined && Number.isFinite(Number(input.speedKmh))
          ? Math.abs(Number(input.speedKmh))
          : fb.speedKmh;

      telemetry.slopeDeg =
        input.slopeDeg !== undefined && Number.isFinite(Number(input.slopeDeg))
          ? Math.abs(Number(input.slopeDeg))
          : fb.slopeDeg;

      telemetry.isDriving =
        typeof input.isDriving === "boolean" ? input.isDriving : Boolean(fb.isDriving);

      telemetry.inHabitat =
        typeof input.inHabitat === "boolean" ? input.inHabitat : Boolean(fb.inHabitat);

      telemetry.isAlert =
        typeof input.isAlert === "boolean" ? input.isAlert : Boolean(fb.isAlert);

      telemetry.motorLoad =
        input.motorLoad !== undefined && Number.isFinite(Number(input.motorLoad))
          ? clamp(Number(input.motorLoad), 0, 1)
          : fb.motorLoad;

      // Play subtle tactile transition sound when entering/exiting habitat or rover
      if (unlocked && (prevInHabitat !== telemetry.inHabitat || prevIsDriving !== telemetry.isDriving)) {
        playAirlockTransition();
      }

      applyTelemetryToNodes();
    } catch {
      // Guaranteed never to throw even if globals or DOM elements are undefined
    }
    return getState();
  }

  /**
   * Mute / Unmute controls
   */
  function setMuted(nextMuted) {
    muted = Boolean(nextMuted);
    if (!muted && !unlocked) {
      unlock();
    } else if (ctx && nodes) {
      const now = ctx.currentTime || 0;
      nodes.masterGain.gain.setTargetAtTime(muted ? 0.0001 : 1.0, now, 0.05);
      if (!muted && ctx.state === "suspended" && typeof ctx.resume === "function") {
        ctx.resume().catch(() => {});
      }
    }
    updateToggleButtonUi();
    return muted;
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    if (!next) {
      playUiClick();
    }
    return !muted;
  }

  function updateToggleButtonUi() {
    if (!toggleBtnEl) return;
    const isOn = !muted;
    toggleBtnEl.textContent = isOn ? "[AUDIO: ON]" : "[AUDIO: OFF]";
    toggleBtnEl.setAttribute("aria-pressed", isOn ? "true" : "false");
    toggleBtnEl.setAttribute(
      "title",
      isOn ? "Mute Martian procedural audio" : "Unmute Martian procedural audio"
    );
    toggleBtnEl.classList.toggle("is-off", !isOn);
  }

  /**
   * Inject a sleek, compact NASA-themed `[AUDIO: ON/OFF]` pill button in the top-right HUD corner.
   */
  function injectToggleButton() {
    if (!hasDocument || !document.body) return null;
    const existing = document.getElementById("mm-audio-toggle");
    if (existing) {
      toggleBtnEl = existing;
      updateToggleButtonUi();
      return existing;
    }

    // Inject self-contained NASA cyan HUD styling once
    if (!document.getElementById("mm-audio-engine-styles") && document.head) {
      const style = document.createElement("style");
      style.id = "mm-audio-engine-styles";
      style.textContent = `
        #mm-audio-toggle {
          appearance: none;
          font-family: var(--mono, "IBM Plex Mono", "JetBrains Mono", Consolas, monospace);
          font-size: 10px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--cyan-bright, #a5f3fc);
          background: var(--panel, rgba(0, 6, 10, 0.84));
          border: 1px solid var(--line-strong, rgba(103, 232, 249, 0.52));
          border-radius: 999px;
          padding: 4px 10px;
          cursor: pointer;
          pointer-events: auto;
          user-select: none;
          white-space: nowrap;
          box-shadow: 0 0 10px rgba(34, 211, 238, 0.16);
          backdrop-filter: blur(6px);
          transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
        }
        #mm-audio-toggle:hover,
        #mm-audio-toggle:focus-visible {
          color: #ffffff;
          border-color: var(--cyan-bright, #a5f3fc);
          box-shadow: 0 0 14px var(--glow-soft, rgba(34, 211, 238, 0.38));
          outline: none;
        }
        #mm-audio-toggle.is-off {
          color: var(--faint, rgba(103, 232, 249, 0.48));
          border-color: var(--line, rgba(34, 211, 238, 0.22));
          box-shadow: none;
          opacity: 0.82;
        }
        .telemetry #mm-audio-toggle-wrap {
          grid-column: 1 / -1;
          justify-self: end;
          margin-bottom: 5px;
          pointer-events: auto;
        }
        #mm-audio-toggle-floating {
          position: fixed;
          top: 12px;
          right: 16px;
          z-index: 95;
          pointer-events: auto;
        }
      `;
      document.head.appendChild(style);
    }

    const btn = document.createElement("button");
    btn.id = "mm-audio-toggle";
    btn.type = "button";
    btn.setAttribute("aria-label", "Toggle Martian Procedural Audio");

    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      toggleMute();
    });

    toggleBtnEl = btn;
    updateToggleButtonUi();

    // Prefer mounting cleanly at the top-right HUD telemetry block if present;
    // otherwise mount as a fixed top-right HUD pill.
    const telemetryBlock = document.querySelector(".visor-top .telemetry, .hud-telemetry-block");
    if (telemetryBlock) {
      const wrap = document.createElement("div");
      wrap.id = "mm-audio-toggle-wrap";
      wrap.appendChild(btn);
      telemetryBlock.insertBefore(wrap, telemetryBlock.firstChild);
    } else {
      const floatWrap = document.createElement("div");
      floatWrap.id = "mm-audio-toggle-floating";
      floatWrap.appendChild(btn);
      document.body.appendChild(floatWrap);
    }

    return btn;
  }

  /**
   * Bind global user interaction hooks (autoplay unlock, HUD button micro-clicks,
   * and airlock/teleport custom event listeners).
   */
  function setupAutoHooks() {
    if (!hasWindow || !hasDocument) return;

    const onFirstGesture = () => {
      if (!unlocked && !muted) {
        unlock();
      }
    };

    window.addEventListener("pointerdown", onFirstGesture, { passive: true, capture: true });
    window.addEventListener("keydown", onFirstGesture, { passive: true, capture: true });
    window.addEventListener("touchstart", onFirstGesture, { passive: true, capture: true });

    // Tactile 1200 Hz micro-clicks for HUD buttons and interactive controls
    document.addEventListener(
      "click",
      (ev) => {
        if (!unlocked && !muted) unlock();
        const target = ev.target && typeof ev.target.closest === "function"
          ? ev.target.closest("button, .btn, .txt-btn, .menu-item, [role='button']")
          : null;
        if (!target || target.id === "mm-audio-toggle") return;
        const id = (target.id || "").toLowerCase();
        const isTransitBtn =
          id.includes("orbit") ||
          id.includes("land") ||
          id.includes("habitat") ||
          target.hasAttribute("data-hud-go") ||
          target.hasAttribute("data-drv-go") ||
          target.hasAttribute("data-drv-drive");
        if (id === "orbit-confirm-go") {
          playDescentWhoosh();
        } else if (id === "hud-ping" || id === "esc-pin" || id === "mp-drop-ping") {
          playScienceChime();
        } else if (id === "npc-dlg-send" || target.closest("#mp-chat-form")) {
          playRadioSquelch();
        } else {
          playUiClick({ airlock: isTransitBtn });
        }
      },
      { passive: true, capture: true }
    );

    // Keypress hooks for [E] interact, [P] pin, [Space] jump
    window.addEventListener(
      "keydown",
      (ev) => {
        if (ev.repeat) return;
        const tag = ev.target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || ev.target?.isContentEditable) return;
        const key = (ev.key || "").toLowerCase();
        if (key === "e") {
          playAirlockTransition();
        } else if (key === "p") {
          playScienceChime();
        } else if (key === " " && !telemetry.isDriving) {
          playJump("takeoff");
        } else if (key === "f" || key === "g" || key === "v" || key === "m" || key === "escape") {
          playUiClick();
        }
      },
      { passive: true }
    );

    // Custom route-bridge & site teleport events
    for (const evtName of ["mm:teleport", "mm:visit-rover-site", "mm:set-route"]) {
      window.addEventListener(evtName, () => {
        if (unlocked && !muted) {
          playAirlockTransition();
        }
      });
    }

    // Silence smoothly when browser tab is backgrounded
    document.addEventListener("visibilitychange", () => {
      applyTelemetryToNodes();
    });

    // Inject the top-right [AUDIO: ON/OFF] pill button when DOM is ready
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => injectToggleButton(), { once: true });
    } else {
      injectToggleButton();
    }

    // Lightweight background fallback sync (10 Hz) when external .update() is not actively called
    if (!pollTimerId) {
      pollTimerId = setInterval(() => {
        const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
        if (nowMs - lastExplicitUpdateMs > 250) {
          update();
        }
      }, 100);
      if (typeof pollTimerId === "object" && typeof pollTimerId.unref === "function") {
        pollTimerId.unref();
      }
    }

    // Generative D-Dorian space chime interval (~6.5 s)
    if (!musicTimerId) {
      musicTimerId = setInterval(() => {
        triggerAmbientMusicNote();
      }, 6500);
      if (typeof musicTimerId === "object" && typeof musicTimerId.unref === "function") {
        musicTimerId.unref();
      }
    }
  }

  function setMusicEnabled(nextEnabled) {
    musicEnabled = Boolean(nextEnabled);
    applyTelemetryToNodes();
    return musicEnabled;
  }

  function toggleMusic() {
    return setMusicEnabled(!musicEnabled);
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
    injectToggleButton,
    getState,
  };

  if (hasWindow) {
    window.MartianAudio = MartianAudio;
  }
  if (globalScope && typeof globalScope === "object") {
    globalScope.MartianAudio = MartianAudio;
  }

  setupAutoHooks();
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
