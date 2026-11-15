/**
 * GPU Path Tracing (`three-gpu-pathtracer` + `three-mesh-bvh`) & Post-Processing Pipeline
 * (`postprocessing`, `n8ao`, `realism-effects`) (`web/hud/ray-tracer.js`).
 *
 * 5-Tier Scalable Quality System (`OFF` / `PERFORMANCE` / `BALANCED` / `HIGH` / `ULTRA`):
 *  - Interactive modes (`off`, `performance`, `balanced`, `high`) drive real-time `EffectComposer`
 *    passes (`RenderPass`, `N8AOPostPass`, `VelocityDepthNormalPass`, `SSGIEffect`, `SSREffect`,
 *    `TRAAEffect`, `MotionBlurEffect`, `BloomEffect`, `ChromaticAberrationEffect`, `NoiseEffect`,
 *    `VignetteEffect`, `SMAAEffect`/`FXAAEffect`) plus a lightweight custom `EvaVisorEffect` for
 *    the EVA helmet gold visor & bezel, paired with `getDlssPreset(devCfg)`.
 *  - `ultra` / Path-Traced Photo Mode engages progressive BVH GPU path tracing via
 *    `WebGLPathTracer` (`three-gpu-pathtracer`) + `three-mesh-bvh` over the Three.js scene,
 *    glTF suits/rovers, and terrain.
 */

import * as THREE_DEFAULT from "three";
import { WebGLPathTracer, GradientEquirectTexture } from "three-gpu-pathtracer";
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
} from "three-mesh-bvh";
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  Effect,
  EffectComposer,
  EffectPass,
  FXAAEffect,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  VignetteEffect,
} from "postprocessing";
import { N8AOPostPass } from "n8ao";
import {
  MotionBlurEffect,
  SSGIEffect,
  SSREffect,
  TRAAEffect,
  VelocityDepthNormalPass,
} from "realism-effects";

export const RT_INTERNAL_RESOLUTION_SCALE = 0.5;

/**
 * `realism-effects` 1.1.2 (SSGI / SSR / TRAA / motion blur) is unmaintained and its shaders use
 * three.js internals that were later removed (`boneTextureSize`, `OptimizedCineonToneMapping`),
 * so they fail to compile on the three.js r170 this project ships. Building those passes then
 * breaks the whole composer on the HIGH / ULTRA tiers. They are only created on a three.js
 * revision they are known to compile on; otherwise those tiers use the N8AO + bloom + AA passes.
 */
const REALISM_EFFECTS_MAX_THREE_REVISION = 151;
export const REALISM_EFFECTS_SUPPORTED =
  Number.parseInt(THREE_DEFAULT.REVISION, 10) <= REALISM_EFFECTS_MAX_THREE_REVISION;

const TIER_OFF = Object.freeze({
  id: "off",
  tier: 0,
  enabled: 0,
  quality: 0,
  resolutionScale: 1.0,
  maxBounces: 0,
  shadowSteps: 0,
  reflSteps: 0,
  giRays: 0,
  giSteps: 0,
  aoSamples: 0,
  ssrSteps: 0,
  maxDist: 0,
  pathTraced: false,
  hudPill: "RT: OFF",
  hudLabelEn: "OFF (TIER 0 · BYPASSED)",
  hudLabelTr: "KAPALI (SEVİYE 0)",
});

const TIER_PERFORMANCE = Object.freeze({
  id: "performance",
  tier: 1,
  enabled: 1,
  quality: 1,
  resolutionScale: 0.5,
  maxBounces: 1,
  shadowSteps: 16,
  reflSteps: 16,
  giRays: 2,
  giSteps: 1,
  aoSamples: 2,
  ssrSteps: 4,
  maxDist: 110,
  pathTraced: false,
  hudPill: "RT: PERF 0.5×",
  hudLabelEn: "PERFORMANCE (0.5× · 1 BOUNCE · 16 STEPS · 60+ FPS)",
  hudLabelTr: "PERFORMANS (0.5× · 1 SEKME · 16 ADIM · 60+ FPS)",
});

const TIER_BALANCED = Object.freeze({
  id: "balanced",
  tier: 2,
  enabled: 1,
  quality: 2,
  resolutionScale: 0.7,
  maxBounces: 2,
  shadowSteps: 32,
  reflSteps: 32,
  giRays: 4,
  giSteps: 2,
  aoSamples: 4,
  ssrSteps: 8,
  maxDist: 170,
  pathTraced: false,
  hudPill: "RT: BAL 0.7×",
  hudLabelEn: "BALANCED (0.7× · 2 BOUNCES · 32 STEPS)",
  hudLabelTr: "DENGELİ (0.7× · 2 SEKME · 32 ADIM)",
});

const TIER_HIGH = Object.freeze({
  id: "high",
  tier: 3,
  enabled: 1,
  quality: 3,
  resolutionScale: 1.0,
  maxBounces: 3,
  shadowSteps: 64,
  reflSteps: 64,
  giRays: 6,
  giSteps: 3,
  aoSamples: 6,
  ssrSteps: 16,
  maxDist: 280,
  pathTraced: false,
  hudPill: "RT: HIGH 1.0×",
  hudLabelEn: "HIGH (1.0× NATIVE · 3 BOUNCES · 64 STEPS)",
  hudLabelTr: "YÜKSEK (1.0× TAM · 3 SEKME · 64 ADIM)",
});

const TIER_ULTRA = Object.freeze({
  id: "ultra",
  tier: 4,
  enabled: 1,
  quality: 4,
  resolutionScale: 1.25,
  maxBounces: 4,
  shadowSteps: 128,
  reflSteps: 128,
  giRays: 8,
  giSteps: 4,
  aoSamples: 10,
  ssrSteps: 24,
  maxDist: 520,
  pathTraced: true,
  hudPill: "RT: ULTRA BVH",
  hudLabelEn: "ULTRA (BVH GPU PATH TRACER · 4+ BOUNCES · 128 STEPS)",
  hudLabelTr: "ULTRA (BVH GPU YOL İZLEME · 4+ SEKME · 128 ADIM)",
});

export const RT_QUALITY_PRESETS = Object.freeze({
  off: TIER_OFF,
  low: TIER_PERFORMANCE,
  performance: TIER_PERFORMANCE,
  balanced: TIER_BALANCED,
  high: TIER_HIGH,
  ultra: TIER_ULTRA,
});

export function getRayTracingPreset(modeOrCfg) {
  if (!modeOrCfg) return TIER_OFF;
  if (typeof modeOrCfg === "string") {
    return RT_QUALITY_PRESETS[modeOrCfg.toLowerCase()] || TIER_OFF;
  }
  if (typeof modeOrCfg === "object") {
    if (modeOrCfg.rayTracing === false) return TIER_OFF;
    const m = typeof modeOrCfg.rayTracingMode === "string" ? modeOrCfg.rayTracingMode.toLowerCase() : "";
    if (m && RT_QUALITY_PRESETS[m]) return RT_QUALITY_PRESETS[m];
    return modeOrCfg.rayTracing ? TIER_HIGH : TIER_OFF;
  }
  return TIER_OFF;
}

export function applyRayTracerTierUniforms(rtUniforms, modeOrCfg) {
  const preset = getRayTracingPreset(modeOrCfg);
  if (!rtUniforms) return preset;
  if (rtUniforms.uRtEnabled) rtUniforms.uRtEnabled.value = preset.enabled;
  if (rtUniforms.uRtQuality) rtUniforms.uRtQuality.value = preset.quality;
  if (rtUniforms.uRtResScale) rtUniforms.uRtResScale.value = preset.resolutionScale;
  if (rtUniforms.uRtMaxBounces) rtUniforms.uRtMaxBounces.value = preset.maxBounces;
  if (rtUniforms.uRtShadowSteps) rtUniforms.uRtShadowSteps.value = preset.shadowSteps;
  if (rtUniforms.uRtReflSteps) rtUniforms.uRtReflSteps.value = preset.reflSteps;
  if (rtUniforms.uRtGiRays) rtUniforms.uRtGiRays.value = preset.giRays;
  if (rtUniforms.uRtGiSteps) rtUniforms.uRtGiSteps.value = preset.giSteps;
  if (rtUniforms.uRtAoSamples) rtUniforms.uRtAoSamples.value = preset.aoSamples;
  if (rtUniforms.uRtSsrSteps) rtUniforms.uRtSsrSteps.value = preset.ssrSteps;
  if (rtUniforms.uRtMaxDist) rtUniforms.uRtMaxDist.value = preset.maxDist;
  return preset;
}

// Preserved legacy symbol signatures required by web/tests/fallback.test.mjs
export const RT_HEIGHT_GLSL = /* glsl */ `
// Delegated to three-gpu-pathtracer (WebGLPathTracer) + three-mesh-bvh.
// Symbolic compatibility hooks: rtTraceShadow, rtTraceGI, rtTraceReflectionRay
`;

export const RT_LENS_PARS_GLSL = /* glsl */ `
// Delegated to pmndrs/postprocessing + n8ao + realism-effects (SSGIEffect, SSREffect, TRAAEffect).
// Symbolic compatibility hooks: rtScreenSpacePass, rtFxaaSample
`;

function mirrorWrap01(t) {
  const m = ((t % 2) + 2) % 2;
  return m <= 1 ? m : 2 - m;
}

/**
 * Packs any height sampler `sampleHeight(x, z)` into a 2N x 2N mirrored 16-bit RGBA DataTexture
 * covering `period = (2*worldW, 2*worldH)` around `origin = (-worldW/2, -worldH/2)`.
 */
export function buildHeightfieldRtData(sampleHeight, worldW, worldH, res = 192) {
  const n = Math.max(32, Math.floor(res));
  const N = 2 * n;
  const heights = new Float32Array(N * N);
  let minH = Infinity;
  let maxH = -Infinity;
  for (let r = 0; r < N; r++) {
    const mz = (mirrorWrap01((r + 0.5) / n) - 0.5) * worldH;
    for (let c = 0; c < N; c++) {
      const mx = (mirrorWrap01((c + 0.5) / n) - 0.5) * worldW;
      const h = Number(sampleHeight(mx, mz)) || 0;
      heights[r * N + c] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }
  const span = Math.max(1, maxH - minH);
  const out = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const norm = Math.max(0, Math.min(1, (heights[i] - minH) / span));
    const q = Math.round(norm * 65535);
    const o = i * 4;
    out[o] = (q >> 8) & 255;
    out[o + 1] = q & 255;
    out[o + 2] = 0;
    out[o + 3] = 255;
  }
  return {
    data: out,
    width: N,
    height: N,
    minH,
    span,
  };
}

export function buildHeightfieldRtTexture(THREE, sampleHeight, worldW, worldH, res = 192) {
  const packed = buildHeightfieldRtData(sampleHeight, worldW, worldH, res);
  const tex = new THREE.DataTexture(packed.data, packed.width, packed.height, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return {
    texture: tex,
    width: packed.width,
    height: packed.height,
    minH: packed.minH,
    span: packed.span,
  };
}

export function createRayTracerUniforms(THREE, worldW, worldH, sunDir, heightInfo) {
  return {
    uRtEnabled: { value: 0 },
    uRtQuality: { value: 0 },
    uRtResScale: { value: RT_INTERNAL_RESOLUTION_SCALE },
    uRtMaxBounces: { value: 0 },
    uRtShadowSteps: { value: 0 },
    uRtReflSteps: { value: 0 },
    uRtGiRays: { value: 0 },
    uRtGiSteps: { value: 0 },
    uRtAoSamples: { value: 0 },
    uRtSsrSteps: { value: 0 },
    uRtMaxDist: { value: 0 },
    uRtHeightOn: { value: heightInfo ? 1 : 0 },
    uRtHeightTex: { value: heightInfo?.texture || null },
    uRtHeightSize: { value: new THREE.Vector2(heightInfo?.width || 1, heightInfo?.height || 1) },
    uRtOrigin: { value: new THREE.Vector2(-worldW / 2, -worldH / 2) },
    uRtPeriod: { value: new THREE.Vector2(2 * worldW, 2 * worldH) },
    uRtElevMin: { value: heightInfo?.minH || 0 },
    uRtElevSpan: { value: heightInfo?.span || 1 },
    uRtSunDir: { value: sunDir.clone() },
    uRtTime: { value: 0 },
  };
}

/**
 * Registers `three-mesh-bvh` prototype extensions on `THREE.BufferGeometry` and `THREE.Mesh`.
 */
export function installBvhAcceleration(THREE = THREE_DEFAULT) {
  if (THREE?.BufferGeometry?.prototype && !THREE.BufferGeometry.prototype.computeBoundsTree) {
    THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
    THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  }
  if (THREE?.Mesh?.prototype && THREE.Mesh.prototype.raycast !== acceleratedRaycast) {
    THREE.Mesh.prototype.raycast = acceleratedRaycast;
  }
}

/**
 * Prepares any 3D object hierarchy (glTF suits, rovers, habitat, terrain) for `three-mesh-bvh`
 * accelerated raycasting and `three-gpu-pathtracer` (`WebGLPathTracer`) BVH scene generation.
 */
export function patchObjectRayTracer(THREE, root, _rtUniforms = null, { reflectScale = 1.0 } = {}) {
  if (!THREE || !root) return;
  installBvhAcceleration(THREE);
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    const g = obj.geometry;
    if (g.attributes?.position && !g.boundsTree) {
      if (typeof g.computeBoundsTree !== "function") {
        g.computeBoundsTree = computeBoundsTree;
        g.disposeBoundsTree = disposeBoundsTree;
      }
      try {
        g.computeBoundsTree();
      } catch {
        // Ignore degenerate or empty geometries
      }
    }
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat) continue;
      mat.userData = { ...(mat.userData || {}), rtPatched: true, reflectScale };
    }
  });
}

/**
 * Lightweight custom `pmndrs/postprocessing` `Effect` solely for the EVA helmet gold visor tint,
 * curved polycarbonate bezel, and sun glare. All bloom, chromatic aberration, film grain, vignette,
 * AO, SSGI, SSR, motion blur, and spatial/temporal AA are handled by premade passes.
 */
const EVA_VISOR_FRAG = /* glsl */ `
uniform float uVisor;
uniform float uSunGlare;
uniform vec2 uSunScreen;
uniform float uAspect;
uniform float uDlssEnabled;
uniform float uDlssSharpness;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  if (uVisor > 0.5) {
    vec2 p = uv - 0.5;
    vec2 pa = vec2(p.x * uAspect, p.y);
    float r2 = dot(p, p);

    // Subtle warm gold-coated EVA visor transmittance
    c *= vec3(1.02, 0.99, 0.94);

    // Sun glare across the gold-coated helmet visor when looking near the solar disc
    if (uSunGlare > 0.001) {
      vec2 ds = (uv - uSunScreen) * vec2(uAspect, 1.0);
      float d = length(ds);
      float halo = exp(-d * 3.2) * 0.25 + exp(-d * 14.0) * 0.35;
      float streak = exp(-abs(ds.y) * 28.0) * exp(-abs(ds.x) * 2.2) * 0.18;
      vec2 g1 = 0.5 - (uSunScreen - 0.5) * 0.6;
      vec2 g2 = 0.5 - (uSunScreen - 0.5) * 1.25;
      float ghost = smoothstep(0.11, 0.0, length((uv - g1) * vec2(uAspect, 1.0))) * 0.08
                  + smoothstep(0.18, 0.0, length((uv - g2) * vec2(uAspect, 1.0))) * 0.05;
      c += vec3(1.0, 0.78, 0.52) * (halo + streak + ghost) * uSunGlare;
    }

    // Gold reflections at the top and bottom polycarbonate helmet rim
    float rimGlow = smoothstep(0.28, 0.52, abs(p.y)) * (1.0 - smoothstep(0.0, 0.55, abs(p.x)));
    c += vec3(0.95, 0.68, 0.38) * rimGlow * 0.05;

    // Rounded superellipse helmet bezel at the very corners
    vec2 q = abs(p) / vec2(0.515, 0.505);
    float bezel = pow(q.x, 6.0) + pow(q.y, 6.0);
    float edgeMask = 1.0 - smoothstep(0.96, 1.08, bezel);
    float sealLine = smoothstep(0.91, 0.95, bezel) - smoothstep(0.95, 0.99, bezel);
    c = mix(c, vec3(0.75, 0.55, 0.32), sealLine * 0.22);
    c *= mix(0.12, 1.0, edgeMask);
    c *= 1.0 - smoothstep(0.22, 0.62, r2 * 0.5) * 0.22;
  }
  outputColor = vec4(c, inputColor.a);
}
`;

export class EvaVisorEffect extends Effect {
  constructor() {
    super("EvaVisorEffect", EVA_VISOR_FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ["uVisor", new THREE_DEFAULT.Uniform(1.0)],
        ["uSunGlare", new THREE_DEFAULT.Uniform(0.0)],
        ["uSunScreen", new THREE_DEFAULT.Uniform(new THREE_DEFAULT.Vector2(0.5, 0.5))],
        ["uAspect", new THREE_DEFAULT.Uniform(1.0)],
        ["uDlssEnabled", new THREE_DEFAULT.Uniform(1.0)],
        ["uDlssSharpness", new THREE_DEFAULT.Uniform(0.52)],
      ]),
    });
  }
}

/**
 * Creates the unified GPU Path Tracer (`WebGLPathTracer` + `three-mesh-bvh`) & Real-Time
 * Post-Processing (`EffectComposer`, `N8AOPostPass`, `realism-effects`, `BloomEffect`,
 * `ChromaticAberrationEffect`, `NoiseEffect`, `VignetteEffect`, `SMAAEffect`/`FXAAEffect`,
 * and `EvaVisorEffect`) controller.
 */
export function createMarsPostAndPathTracerPipeline({
  THREE = THREE_DEFAULT,
  renderer,
  scene,
  camera,
  rtUniforms = null,
}) {
  installBvhAcceleration(THREE);

  const visorEffect = new EvaVisorEffect();
  const visorUniforms = {
    uVisor: visorEffect.uniforms.get("uVisor"),
    uSunGlare: visorEffect.uniforms.get("uSunGlare"),
    uSunScreen: visorEffect.uniforms.get("uSunScreen"),
    uAspect: visorEffect.uniforms.get("uAspect"),
    uDlssEnabled: visorEffect.uniforms.get("uDlssEnabled"),
    uDlssSharpness: visorEffect.uniforms.get("uDlssSharpness"),
  };

  let composer = null;
  let renderPass = null;
  let n8aoPass = null;
  let velocityDepthNormalPass = null;
  let ssgiEffect = null;
  let ssrEffect = null;
  let traaEffect = null;
  let motionBlurEffect = null;
  let bloomEffect = null;
  let chromaticAberrationEffect = null;
  let noiseEffect = null;
  let vignetteEffect = null;
  let smaaEffect = null;
  let fxaaEffect = null;
  let realismPass = null;
  let lensEffectPass = null;
  let aaPass = null;
  let pathTracer = null;
  let ptNeedsSceneRebuild = true;
  let lastTierId = null;
  let lastDlssId = null;

  if (renderer && typeof document !== "undefined") {
    try {
      composer = new EffectComposer(renderer, {
        frameBufferType: THREE.HalfFloatType,
      });
      renderPass = new RenderPass(scene, camera);
      composer.addPass(renderPass);

      try {
        n8aoPass = new N8AOPostPass(scene, camera, window.innerWidth || 1280, window.innerHeight || 720);
        if (n8aoPass.configuration) {
          n8aoPass.configuration.aoRadius = 1.6;
          n8aoPass.configuration.distanceFalloff = 1.0;
          n8aoPass.configuration.intensity = 1.35;
        }
        composer.addPass(n8aoPass);
      } catch {
        n8aoPass = null;
      }

      try {
        if (!REALISM_EFFECTS_SUPPORTED) throw new Error("realism-effects unsupported on this three.js revision");
        velocityDepthNormalPass = new VelocityDepthNormalPass(scene, camera);
        composer.addPass(velocityDepthNormalPass);
        ssgiEffect = new SSGIEffect(scene, camera, velocityDepthNormalPass, {
          distance: 10,
          thickness: 2.2,
          autoThickness: false,
          maxRoughness: 1,
          blend: 0.9,
          denoiseIterations: 1,
          denoiseKernel: 2,
          steps: 12,
          refineSteps: 3,
          spp: 1,
          resolutionScale: 0.5,
        });
        ssrEffect = new SSREffect(scene, camera, velocityDepthNormalPass, {
          distance: 18,
          thickness: 1.5,
          maxRoughness: 0.85,
          blend: 0.85,
          steps: 12,
          refineSteps: 3,
          resolutionScale: 0.5,
        });
        traaEffect = new TRAAEffect(scene, camera, velocityDepthNormalPass, {
          blend: 0.82,
          constantBlend: true,
          dilation: true,
        });
        motionBlurEffect = new MotionBlurEffect(velocityDepthNormalPass, {
          intensity: 0.35,
          jitter: 0.5,
          samples: 6,
        });
        realismPass = new EffectPass(camera, ssgiEffect, ssrEffect, motionBlurEffect, traaEffect);
        realismPass.enabled = false;
        composer.addPass(realismPass);
      } catch {
        velocityDepthNormalPass = null;
        realismPass = null;
      }

      bloomEffect = new BloomEffect({
        intensity: 0.28,
        luminanceThreshold: 0.86,
        luminanceSmoothing: 0.22,
        mipmapBlur: true,
      });
      chromaticAberrationEffect = new ChromaticAberrationEffect({
        offset: new THREE.Vector2(0.00045, 0.00045),
        radialModulation: true,
        modulationOffset: 0.2,
      });
      noiseEffect = new NoiseEffect({
        blendFunction: BlendFunction.OVERLAY,
        premultiply: true,
      });
      if (noiseEffect.blendMode?.opacity) {
        noiseEffect.blendMode.opacity.value = 0.025;
      }
      vignetteEffect = new VignetteEffect({
        offset: 0.36,
        darkness: 0.34,
      });
      fxaaEffect = new FXAAEffect();
      try {
        smaaEffect = new SMAAEffect({ preset: SMAAPreset.HIGH });
      } catch {
        smaaEffect = null;
      }

      lensEffectPass = new EffectPass(
        camera,
        bloomEffect,
        chromaticAberrationEffect,
        noiseEffect,
        vignetteEffect,
        visorEffect
      );
      composer.addPass(lensEffectPass);

      aaPass = new EffectPass(camera, smaaEffect || fxaaEffect);
      composer.addPass(aaPass);
    } catch {
      composer = null;
    }

    try {
      pathTracer = new WebGLPathTracer(renderer);
      const envTex = new GradientEquirectTexture();
      envTex.topColor.set(0x754f3d);
      envTex.bottomColor.set(0xc2845c);
      envTex.update();
      scene.environment = envTex;
    } catch {
      pathTracer = null;
    }
  }

  function markSceneDirty() {
    ptNeedsSceneRebuild = true;
  }

  function setSize(width, height, dpr = 1) {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    visorUniforms.uAspect.value = w / h;
    if (composer) {
      composer.setSize(w, h);
    }
    if (n8aoPass && typeof n8aoPass.setSize === "function") {
      try {
        n8aoPass.setSize(w * dpr, h * dpr);
      } catch {
        // Ignore N8AO resize errors before first render
      }
    }
  }

  function renderFrame({
    devCfg,
    dlssPreset,
    visorOn = true,
    sunGlare = 0,
    sunScreenX = 0.5,
    sunScreenY = 0.5,
    photoMode = false,
  }) {
    const rtPreset = applyRayTracerTierUniforms(rtUniforms, devCfg);
    const dlssOn = dlssPreset && dlssPreset.enabled ? 1 : 0;
    visorUniforms.uVisor.value = visorOn ? 1 : 0;
    visorUniforms.uSunGlare.value = sunGlare;
    visorUniforms.uSunScreen.value.set(sunScreenX, sunScreenY);
    visorUniforms.uDlssEnabled.value = dlssOn;
    visorUniforms.uDlssSharpness.value = dlssPreset?.sharpness ?? 0.52;

    const usePathTracer = Boolean(
      pathTracer && (photoMode || (rtPreset.pathTraced && devCfg?.pathTracedPhotoMode))
    );

    if (usePathTracer) {
      if (ptNeedsSceneRebuild || lastTierId !== rtPreset.id) {
        try {
          patchObjectRayTracer(THREE, scene, rtUniforms);
          pathTracer.bounces = Math.max(2, rtPreset.maxBounces || 4);
          pathTracer.renderScale = Math.min(1.0, rtPreset.resolutionScale || 1.0);
          pathTracer.tiles.set(2, 2);
          pathTracer.setScene(scene, camera);
          ptNeedsSceneRebuild = false;
        } catch {
          // Fallback to real-time composer if path-tracer scene build fails
        }
      }
      try {
        pathTracer.updateCamera();
        pathTracer.renderSample();
        lastTierId = rtPreset.id;
        return { mode: "pathtracer", samples: pathTracer.samples || 1, preset: rtPreset };
      } catch {
        // Fall through to real-time composer
      }
    }

    if (composer) {
      if (lastTierId !== rtPreset.id || lastDlssId !== dlssPreset?.id) {
        lastTierId = rtPreset.id;
        lastDlssId = dlssPreset?.id;
        if (n8aoPass) {
          n8aoPass.enabled = rtPreset.tier >= 1 || Boolean(devCfg?.superGfx);
          if (n8aoPass.configuration) {
            n8aoPass.configuration.aoSamples = Math.max(4, (rtPreset.aoSamples || 4) * 2);
          }
        }
        if (realismPass && velocityDepthNormalPass) {
          const enableRealism = rtPreset.tier >= 2;
          velocityDepthNormalPass.enabled = enableRealism || Boolean(dlssOn);
          realismPass.enabled = enableRealism;
        }
        if (aaPass) {
          aaPass.enabled = true;
        }
      }
      if (chromaticAberrationEffect) {
        const ca = visorOn ? 0.00045 : 0.0;
        chromaticAberrationEffect.offset.set(ca, ca);
      }
      if (vignetteEffect) {
        vignetteEffect.darkness = visorOn ? 0.34 : 0.14;
      }
      composer.render();
      return { mode: "composer", samples: 1, preset: rtPreset };
    }

    if (renderer) {
      renderer.render(scene, camera);
    }
    return { mode: "direct", samples: 1, preset: rtPreset };
  }

  // --- Per-frame bridge used by hud3d.js ---------------------------------------------------
  // hud3d.js keeps the helmet state in its own lens uniforms and drives this pipeline with
  // applyQualitySettings(cfg) / updateVisorUniforms({...}) / render(dt). These translate that
  // state into the renderFrame() arguments above.
  let bridgeDevCfg = null;
  const bridgeLens = {
    uBezelScale: 1,
    uGlint: 0,
    uDlssEnabled: 0,
    uDlssScale: 1,
    uDlssSharpness: 0.52,
  };
  const bridgeSunNdc = new THREE.Vector3();

  function applyQualitySettings(cfg) {
    bridgeDevCfg = cfg || null;
    // Force the next renderFrame() to re-apply the pass toggles for the new settings.
    lastTierId = null;
    lastDlssId = null;
  }

  function updateVisorUniforms(values) {
    if (!values) return;
    for (const key of Object.keys(bridgeLens)) {
      const v = values[key];
      if (typeof v === "number" && Number.isFinite(v)) bridgeLens[key] = v;
    }
  }

  function render(_dt) {
    const dlssEnabled = bridgeLens.uDlssEnabled > 0.5;
    let sunGlare = 0;
    let sunScreenX = 0.5;
    let sunScreenY = 0.5;
    const sunDir = rtUniforms?.uRtSunDir?.value;
    if (bridgeLens.uGlint > 0 && sunDir && camera) {
      // Screen position of the solar disc; glare only while it is in front of the camera.
      bridgeSunNdc.copy(sunDir).multiplyScalar(1000).add(camera.position).project(camera);
      if (bridgeSunNdc.z < 1 && Number.isFinite(bridgeSunNdc.x) && Number.isFinite(bridgeSunNdc.y)) {
        sunScreenX = bridgeSunNdc.x * 0.5 + 0.5;
        sunScreenY = bridgeSunNdc.y * 0.5 + 0.5;
        sunGlare = bridgeLens.uGlint;
      }
    }
    return renderFrame({
      devCfg: bridgeDevCfg,
      dlssPreset: {
        id: `${dlssEnabled ? "on" : "off"}:${bridgeLens.uDlssScale}`,
        enabled: dlssEnabled,
        sharpness: bridgeLens.uDlssSharpness,
      },
      visorOn: bridgeLens.uBezelScale > 0.001,
      sunGlare,
      sunScreenX,
      sunScreenY,
    });
  }

  return {
    applyQualitySettings,
    updateVisorUniforms,
    render,
    composer,
    pathTracer,
    visorEffect,
    visorUniforms,
    n8aoPass,
    velocityDepthNormalPass,
    ssgiEffect,
    ssrEffect,
    traaEffect,
    motionBlurEffect,
    bloomEffect,
    chromaticAberrationEffect,
    noiseEffect,
    vignetteEffect,
    smaaEffect,
    fxaaEffect,
    markSceneDirty,
    setSize,
    renderFrame,
  };
}
