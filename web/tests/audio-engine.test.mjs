import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_ENGINE_PATH = path.resolve(__dirname, "../shared/audioEngine.js");

function createFakeAudioEnv() {
  const createdNodes = [];
  const makeParam = (initial = 0) => ({
    value: initial,
    setValueAtTime(v) {
      this.value = v;
    },
    setTargetAtTime(v) {
      this.value = v;
    },
    linearRampToValueAtTime(v) {
      this.value = v;
    },
    exponentialRampToValueAtTime(v) {
      this.value = v;
    },
  });
  class FakeAudioContext {
    constructor() {
      this.sampleRate = 44100;
      this.currentTime = 0;
      this.state = "suspended";
      this.destination = { kind: "destination" };
    }
    async resume() {
      this.state = "running";
    }
    createBuffer(channels, length, sampleRate) {
      const ch = new Float32Array(length);
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        getChannelData: () => ch,
      };
    }
    createGain() {
      const node = { kind: "gain", gain: makeParam(1), connect() { return this; } };
      createdNodes.push(node);
      return node;
    }
    createBiquadFilter() {
      const node = {
        kind: "biquad",
        type: "lowpass",
        frequency: makeParam(350),
        Q: makeParam(1),
        detune: makeParam(0),
        connect() { return this; },
      };
      createdNodes.push(node);
      return node;
    }
    createOscillator() {
      const node = {
        kind: "osc",
        type: "sine",
        frequency: makeParam(440),
        detune: makeParam(0),
        started: false,
        start() { this.started = true; },
        stop() {},
        connect() { return this; },
      };
      createdNodes.push(node);
      return node;
    }
    createBufferSource() {
      const node = {
        kind: "bufferSource",
        buffer: null,
        loop: false,
        started: false,
        start() { this.started = true; },
        stop() {},
        connect() { return this; },
      };
      createdNodes.push(node);
      return node;
    }
    createWaveShaper() {
      const node = { kind: "waveShaper", curve: null, oversample: "none", connect() { return this; } };
      createdNodes.push(node);
      return node;
    }
  }

  const noticeEl = {
    textContent: "TRANSIT TERMINAL · PRESS [E] FOR SITE SELECTOR",
    classList: { contains: () => false },
  };
  const elementsById = {
    "hud-wrap-notice": noticeEl,
    "mm-audio-toggle": {
      id: "mm-audio-toggle",
      textContent: "",
      setAttribute() {},
      classList: { toggle() {} },
    },
  };
  const fakeWindow = {
    AudioContext: FakeAudioContext,
    addEventListener() {},
  };
  const fakeDocument = {
    readyState: "complete",
    hidden: false,
    body: { dataset: {}, appendChild() {} },
    head: { appendChild() {} },
    getElementById: (id) => elementsById[id] || null,
    querySelector: () => null,
    createElement: () => ({
      id: "",
      type: "",
      style: {},
      classList: { toggle() {} },
      setAttribute() {},
      addEventListener() {},
      appendChild() {},
    }),
    addEventListener() {},
  };

  const sandbox = {
    window: fakeWindow,
    document: fakeDocument,
    performance: { now: () => 1000 },
    setInterval: () => 0,
    clearInterval() {},
    Math,
    Number,
    Boolean,
    Float32Array,
  };
  sandbox.globalThis = sandbox;
  const code = fs.readFileSync(AUDIO_ENGINE_PATH, "utf8");
  vm.runInNewContext(code, sandbox, { filename: AUDIO_ENGINE_PATH });
  return {
    MartianAudio: fakeWindow.MartianAudio || sandbox.MartianAudio,
    noticeEl,
    createdNodes,
  };
}

test("MartianAudio distinguishes 1st-person helmet audio vs 3rd-person open wind and boosts levels", () => {
  const { MartianAudio } = createFakeAudioEnv();
  assert.ok(MartianAudio, "window.MartianAudio should be exposed");
  assert.equal(MartianAudio.unlock(), true);

  // 1st-person camera (inside helmet): breathing louder, wind deep & muffled, rovers active
  const firstPerson = MartianAudio.update({
    speedKmh: 0,
    walkSpeedMs: 2.5,
    slopeDeg: 4,
    isDriving: false,
    isThirdPerson: false,
    inHabitat: false,
    nearestRoverDistM: 6,
  });
  assert.equal(firstPerson.initialized, true);
  assert.equal(firstPerson.unlocked, true);
  assert.equal(firstPerson.isThirdPerson, false);
  assert.ok(firstPerson.breathGain >= 0.19, `expected louder 1st-person breathGain >= 0.19, got ${firstPerson.breathGain}`);
  assert.ok(firstPerson.windGain > 0.2, `expected muffled 1st-person windGain > 0.2, got ${firstPerson.windGain}`);
  assert.ok(firstPerson.roverGain > 0.05, `expected continuous idle roverGain > 0.05, got ${firstPerson.roverGain}`);
  assert.ok(firstPerson.breathCadenceBpm > 15, "walking should raise breathing cadence above resting baseline");
  assert.equal(firstPerson.roverFreqHz, 68, "walking should not rev parked rover drivetrain frequency");

  // 1st-person inside habitat: breathing & rovers still active
  const habFirstPerson = MartianAudio.update({
    speedKmh: 0,
    walkSpeedMs: 0,
    slopeDeg: 0,
    isDriving: false,
    isThirdPerson: false,
    inHabitat: true,
    nearestRoverDistM: 18,
  });
  assert.ok(habFirstPerson.breathGain >= 0.19, `expected breathGain >= 0.19 in 1st-person habitat, got ${habFirstPerson.breathGain}`);
  assert.ok(habFirstPerson.windGain > 0.1, `expected windGain > 0.1 inside habitat, got ${habFirstPerson.windGain}`);
  assert.ok(habFirstPerson.roverGain > 0.05, `expected roverGain > 0.05 inside habitat, got ${habFirstPerson.roverGain}`);

  // 3rd-person walking camera: NO breathing sound, stronger open Martian wind
  const thirdPersonWalk = MartianAudio.update({
    speedKmh: 0,
    walkSpeedMs: 2.5,
    slopeDeg: 4,
    isDriving: false,
    isThirdPerson: true,
    inHabitat: false,
    nearestRoverDistM: 6,
  });
  assert.equal(thirdPersonWalk.isThirdPerson, true);
  assert.equal(thirdPersonWalk.breathGain, 0, "expected no breathing sound in 3rd-person camera");
  assert.ok(
    thirdPersonWalk.windGain > firstPerson.windGain,
    `expected 3rd-person windGain (${thirdPersonWalk.windGain}) > 1st-person (${firstPerson.windGain})`
  );
  assert.ok(thirdPersonWalk.roverGain > 0.05, "rovers should still be audible in 3rd-person");

  // 3rd-person driving rover: frequency and drivetrain gain scale up, no breathing
  const driveState = MartianAudio.update({
    speedKmh: 30,
    walkSpeedMs: 0,
    slopeDeg: 10,
    isDriving: true,
    isThirdPerson: true,
    inHabitat: false,
    motorLoad: 0.7,
    nearestRoverDistM: 0,
  });
  assert.equal(driveState.breathGain, 0, "expected no breathing sound while driving in 3rd-person");
  assert.ok(driveState.roverFreqHz > firstPerson.roverFreqHz, "driving should raise rover pitch");
  assert.ok(driveState.roverGain > firstPerson.roverGain, "driving should raise rover gain");

  // Mute / unmute toggle
  assert.equal(MartianAudio.setMuted(true), true);
  assert.equal(MartianAudio.isMuted(), true);
  assert.equal(MartianAudio.setMuted(false), false);
  assert.equal(MartianAudio.isMuted(), false);
});

test("MartianAudio ignores stale hidden #hud-wrap-notice text for inHabitat detection", () => {
  const { MartianAudio } = createFakeAudioEnv();
  MartianAudio.unlock();
  const state = MartianAudio.update();
  assert.equal(state.inHabitat, false);
});
