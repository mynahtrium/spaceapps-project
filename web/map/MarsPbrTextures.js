/**
 * Procedural + KTX2 Offline-Safe Martian Regolith & Bedrock PBR Texture Sets.
 *
 * Uses `simplex-noise` (`createNoise4D` mapped onto a 4D torus for seamless periodic tiling)
 * and `three/addons/loaders/KTX2Loader.js` for pre-baked `.ktx2` GPU texture sets when a
 * WebGLRenderer is supplied, with automatic headless Node-test fallback to `DataTexture`s:
 *   1. `dustAlbedo`  — Fine ferric regolith dust + ripple micro-albedo + roughness in alpha
 *   2. `dustNormal`  — Wind-carved aeolian ripple tangent-space normal map
 *   3. `rockAlbedo`  — Fractured Murray / Stimson mudstone-sandstone strata + roughness in alpha
 *   4. `rockNormal`  — Sharp polygonal fracture & cross-bedding tangent-space normal map
 *
 * Works identically in browser WebGL and headless Node.js unit tests (no DOM canvas needed).
 */

import { createNoise4D } from "../../node_modules/simplex-noise/dist/esm/simplex-noise.js";
import { KTX2Loader } from "../../node_modules/three/examples/jsm/loaders/KTX2Loader.js";

const TAU = Math.PI * 2;

function createSeededPrng(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sample 4D Simplex noise on a 2D torus `[0, 1) x [0, 1)` so textures wrap seamlessly with RepeatWrapping.
 */
function createSeamlessTorusFbm(seed = 1) {
  const noise4D = createNoise4D(createSeededPrng(seed));
  const samplePeriodic = (u, v, freq) => {
    const r = freq / TAU;
    const ax = u * TAU;
    const ay = v * TAU;
    return (
      noise4D(
        Math.cos(ax) * r,
        Math.sin(ax) * r,
        Math.cos(ay) * r,
        Math.sin(ay) * r
      ) *
        0.5 +
      0.5
    );
  };
  const fbm = (u, v, baseFreq, octaves = 4) => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let freq = baseFreq;
    for (let i = 0; i < octaves; i++) {
      sum += amp * samplePeriodic(u, v, freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
  return { samplePeriodic, fbm };
}

function buildNormalTextureFromHeightField(THREE, heightField, size, strength = 4.5) {
  const data = new Uint8Array(size * size * 4);
  const step = 1 / size;
  for (let y = 0; y < size; y++) {
    const ym = (y - 1 + size) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;

      const hL = heightField[y * size + xm];
      const hR = heightField[y * size + xp];
      const hD = heightField[ym * size + x];
      const hU = heightField[yp * size + x];

      const dx = (hR - hL) * strength * 0.5 / step;
      const dy = (hU - hD) * strength * 0.5 / step;
      const nx = -dx * 0.015;
      const ny = -dy * 0.015;
      const nz = 1.0;
      const inv = 1 / Math.hypot(nx, ny, nz);

      const idx = (y * size + x) * 4;
      data[idx] = Math.max(0, Math.min(255, Math.round((nx * inv * 0.5 + 0.5) * 255)));
      data[idx + 1] = Math.max(0, Math.min(255, Math.round((ny * inv * 0.5 + 0.5) * 255)));
      data[idx + 2] = Math.max(0, Math.min(255, Math.round((nz * inv * 0.5 + 0.5) * 255)));
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Create a configured `KTX2Loader` instance for pre-baked Martian `.ktx2` textures when running in a browser with WebGL.
 */
export function createMartianKtx2Loader(renderer = null, transcoderPath = "./vendor/addons/libs/basis/") {
  const loader = new KTX2Loader();
  loader.setTranscoderPath(transcoderPath);
  if (renderer && typeof renderer.capabilities !== "undefined") {
    try {
      loader.detectSupport(renderer);
    } catch (_err) {
      // Headless / mock renderer fallback
    }
  }
  return loader;
}

/**
 * Synthesize high-contrast Martian regolith dust and fractured mudstone/bedrock PBR textures
 * using `simplex-noise` (with optional `KTX2Loader` upgrade when `.ktx2` assets are supplied).
 *
 * @param {typeof import('three')} THREE
 * @param {number} [size=256]
 * @param {{ renderer?: any, ktx2Urls?: Record<string, string> }} [options]
 */
export function createMartianPbrTextureSets(THREE, size = 256, options = {}) {
  const dustAlbedoData = new Uint8Array(size * size * 4);
  const dustHeight = new Float32Array(size * size);

  const rockAlbedoData = new Uint8Array(size * size * 4);
  const rockHeight = new Float32Array(size * size);

  const dustMacroNoise = createSeamlessTorusFbm(11);
  const dustMicroNoise = createSeamlessTorusFbm(29);
  const dustPebbleNoise = createSeamlessTorusFbm(73);
  const rockStrataNoise = createSeamlessTorusFbm(41);
  const rockGrainNoise = createSeamlessTorusFbm(97);
  const rockCrackNoiseA = createSeamlessTorusFbm(131);
  const rockCrackNoiseB = createSeamlessTorusFbm(193);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const pIdx = y * size + x;
      const rgbaIdx = pIdx * 4;

      // --- 1. Aeolian Regolith Dust & Wind Ripples ---
      const warp = dustMacroNoise.fbm(u, v, 4, 3) * 0.18;
      const ripplePhase = (u * 10 + v * 3 + warp) * TAU;
      const ripple = Math.pow(0.5 + 0.5 * Math.sin(ripplePhase), 1.6);
      const microGrain = dustMicroNoise.fbm(u, v, 16, 4);
      const pebbles = Math.max(0, dustPebbleNoise.samplePeriodic(u, v, 32) - 0.72) * 3.5;

      const dH = ripple * 0.55 + microGrain * 0.3 + pebbles * 0.25;
      dustHeight[pIdx] = dH;

      // High-contrast ochre / ferric oxide dust palette (70..225 range so detail pops)
      const dustShade = Math.max(0, Math.min(1, 0.15 + dH * 0.85 + (microGrain - 0.5) * 0.45));
      dustAlbedoData[rgbaIdx] = Math.round(70 + dustShade * 155);
      dustAlbedoData[rgbaIdx + 1] = Math.round(45 + dustShade * 105);
      dustAlbedoData[rgbaIdx + 2] = Math.round(28 + dustShade * 72);
      // Alpha encodes roughness (0.72 .. 0.96)
      dustAlbedoData[rgbaIdx + 3] = Math.round((0.94 - pebbles * 0.18) * 255);

      // --- 2. Fractured Mudstone / Cross-Bedded Sandstone Bedrock ---
      const crackA = Math.abs(rockCrackNoiseA.samplePeriodic(u, v, 8) - 0.5) * 2;
      const crackB = Math.abs(rockCrackNoiseB.samplePeriodic(u + 0.37, v + 0.61, 16) - 0.5) * 2;
      const fractureMask = Math.min(1, Math.pow(Math.min(crackA, crackB), 0.45) * 1.35);
      const strata = 0.5 + 0.5 * Math.sin((v * 14 + rockStrataNoise.fbm(u, v, 6, 3) * 0.45) * TAU);
      const rockGrain = rockGrainNoise.fbm(u, v, 24, 3);

      const rH = fractureMask * (0.55 + strata * 0.3 + rockGrain * 0.25);
      rockHeight[pIdx] = rH;

      // High-contrast basaltic / sulfate-veined mudstone palette
      const vein = fractureMask < 0.22 ? (0.22 - fractureMask) * 5.0 : 0; // bright calcium-sulfate veins in cracks
      const rockShade = Math.max(0, Math.min(1, rH * 0.9 + vein * 0.75));
      rockAlbedoData[rgbaIdx] = Math.round(48 + rockShade * 172);
      rockAlbedoData[rgbaIdx + 1] = Math.round(38 + rockShade * 148);
      rockAlbedoData[rgbaIdx + 2] = Math.round(32 + rockShade * 128);
      // Alpha encodes roughness (0.55 .. 0.88)
      rockAlbedoData[rgbaIdx + 3] = Math.round((0.58 + (1 - rockShade) * 0.28) * 255);
    }
  }

  const makeAlbedoTex = (bytes) => {
    const tex = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  };

  const dustAlbedoTex = makeAlbedoTex(dustAlbedoData);
  const dustNormalTex = buildNormalTextureFromHeightField(THREE, dustHeight, size, 5.5);
  const rockAlbedoTex = makeAlbedoTex(rockAlbedoData);
  const rockNormalTex = buildNormalTextureFromHeightField(THREE, rockHeight, size, 8.0);

  const sets = {
    dustAlbedoTex,
    dustNormalTex,
    rockAlbedoTex,
    rockNormalTex,
    dustAlbedo: dustAlbedoTex,
    dustNormal: dustNormalTex,
    rockAlbedo: rockAlbedoTex,
    rockNormal: rockNormalTex,
  };

  if (options?.ktx2Urls && options?.renderer) {
    const ktx2Loader = createMartianKtx2Loader(options.renderer);
    for (const key of ["dustAlbedo", "dustNormal", "rockAlbedo", "rockNormal"]) {
      const url = options.ktx2Urls[key];
      if (url) {
        ktx2Loader.load(
          url,
          (ktxTex) => {
            ktxTex.wrapS = THREE.RepeatWrapping;
            ktxTex.wrapT = THREE.RepeatWrapping;
            sets[key] = ktxTex;
          },
          undefined,
          () => {
            // Keep procedural simplex-noise fallback texture on load failure
          }
        );
      }
    }
  }

  return sets;
}
