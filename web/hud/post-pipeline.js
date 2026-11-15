/**
 * Post-processing pipeline for the 3D EVA view (`web/hud/post-pipeline.js`).
 *
 * Built from premade passes (`postprocessing` EffectComposer, `n8ao` ambient occlusion):
 *   RenderPass → N8AO ambient occlusion (optional) → bloom, chromatic aberration, grain, vignette,
 *   EVA visor → FXAA or SMAA (optional). MSAA is done by the composer's multisampled input buffer.
 *
 * Honesty note: this is screen-space ambient occlusion plus lens effects. There is no ray tracing,
 * no temporal accumulation and no upscaler. Every buffer is sized from the renderer's drawing buffer
 * (`composer.setSize`), so AO always lines up with the frame; an AO buffer of a different size than
 * the frame is what drew offset "ghost" silhouettes around objects before.
 */

import * as THREE_DEFAULT from "three";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
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

export const AO_LEVELS = Object.freeze(["off", "low", "high"]);
export const AA_MODES = Object.freeze(["off", "fxaa", "smaa", "msaa"]);
export const MSAA_SAMPLES = 4;

/** N8AO settings per level. Radius is in metres; half resolution keeps "low" cheap. */
export const AO_PRESETS = Object.freeze({
  off: Object.freeze({ enabled: false }),
  low: Object.freeze({ enabled: true, aoSamples: 8, denoiseSamples: 4, halfRes: true, aoRadius: 1.2, intensity: 1.2 }),
  high: Object.freeze({ enabled: true, aoSamples: 16, denoiseSamples: 8, halfRes: false, aoRadius: 1.6, intensity: 1.35 }),
});

export function normalizeAoLevel(v) {
  return AO_LEVELS.includes(v) ? v : "off";
}

export function normalizeAaMode(v) {
  return AA_MODES.includes(v) ? v : "smaa";
}

/**
 * The drawing-buffer pixel ratio for a canvas: the display ratio, capped by the preset, times the
 * render-resolution scale. The DOM HUD stays sharp; only the 3D frame changes resolution.
 */
export function effectivePixelRatio(devicePixelRatio, pixelRatioCap, renderScale) {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const cap = Number.isFinite(pixelRatioCap) && pixelRatioCap > 0 ? pixelRatioCap : 1;
  const scale = Number.isFinite(renderScale) && renderScale > 0 ? renderScale : 1;
  return Math.max(0.25, Math.min(dpr, cap) * scale);
}

/** Registers `three-mesh-bvh` raycast acceleration (used for picking NPCs, rovers and screens). */
export function installBvhAcceleration(THREE = THREE_DEFAULT) {
  if (THREE?.BufferGeometry?.prototype && !THREE.BufferGeometry.prototype.computeBoundsTree) {
    THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
    THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  }
  if (THREE?.Mesh?.prototype && THREE.Mesh.prototype.raycast !== acceleratedRaycast) {
    THREE.Mesh.prototype.raycast = acceleratedRaycast;
  }
}

/** Builds BVH bounds trees for every mesh under `root`, so raycasts against it stay fast. */
export function computeBvhForObject(THREE, root) {
  if (!THREE || !root) return;
  installBvhAcceleration(THREE);
  root.traverse((obj) => {
    const g = obj.isMesh ? obj.geometry : null;
    if (!g?.attributes?.position || g.boundsTree) return;
    try {
      g.computeBoundsTree();
    } catch {
      // degenerate or empty geometry: plain raycasting still works
    }
  });
}

const EVA_VISOR_FRAG = /* glsl */ `
uniform float uVisor;
uniform float uSunGlare;
uniform vec2 uSunScreen;
uniform float uAspect;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  if (uVisor > 0.5) {
    vec2 p = uv - 0.5;
    float r2 = dot(p, p);
    c *= vec3(1.02, 0.99, 0.94);
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
    float rimGlow = smoothstep(0.28, 0.52, abs(p.y)) * (1.0 - smoothstep(0.0, 0.55, abs(p.x)));
    c += vec3(0.95, 0.68, 0.38) * rimGlow * 0.05;
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

/** EVA helmet visor tint, bezel and sun glare as a `postprocessing` Effect. */
export class EvaVisorEffect extends Effect {
  constructor() {
    super("EvaVisorEffect", EVA_VISOR_FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ["uVisor", new THREE_DEFAULT.Uniform(1.0)],
        ["uSunGlare", new THREE_DEFAULT.Uniform(0.0)],
        ["uSunScreen", new THREE_DEFAULT.Uniform(new THREE_DEFAULT.Vector2(0.5, 0.5))],
        ["uAspect", new THREE_DEFAULT.Uniform(1.0)],
      ]),
    });
  }
}

/**
 * @param {{THREE?: object, renderer: object, scene: object, camera: object}} opts
 * @returns pipeline controller: applySettings, setSize, setVisor, render
 */
export function createMarsPostPipeline({ THREE = THREE_DEFAULT, renderer, scene, camera }) {
  installBvhAcceleration(THREE);
  const visorEffect = new EvaVisorEffect();
  const u = (k) => visorEffect.uniforms.get(k);

  let composer = null;
  let n8aoPass = null;
  let bloomEffect = null;
  let chromaticAberrationEffect = null;
  let vignetteEffect = null;
  let fxaaPass = null;
  let smaaPass = null;
  let lensPass = null;
  const state = { ao: "off", aa: "smaa", bloom: true };

  if (renderer && typeof document !== "undefined") {
    try {
      composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
      composer.addPass(new RenderPass(scene, camera));
      try {
        n8aoPass = new N8AOPostPass(scene, camera, 1, 1);
        n8aoPass.enabled = false;
        composer.addPass(n8aoPass);
      } catch {
        n8aoPass = null;
      }
      bloomEffect = new BloomEffect({ intensity: 0.28, luminanceThreshold: 0.86, luminanceSmoothing: 0.22, mipmapBlur: true });
      chromaticAberrationEffect = new ChromaticAberrationEffect({
        offset: new THREE.Vector2(0.00045, 0.00045),
        radialModulation: true,
        modulationOffset: 0.2,
      });
      const noiseEffect = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
      if (noiseEffect.blendMode?.opacity) noiseEffect.blendMode.opacity.value = 0.025;
      vignetteEffect = new VignetteEffect({ offset: 0.36, darkness: 0.34 });
      lensPass = new EffectPass(camera, bloomEffect, chromaticAberrationEffect, noiseEffect, vignetteEffect, visorEffect);
      composer.addPass(lensPass);
      fxaaPass = new EffectPass(camera, new FXAAEffect());
      composer.addPass(fxaaPass);
      try {
        smaaPass = new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH }));
        composer.addPass(smaaPass);
      } catch {
        smaaPass = null;
      }
    } catch {
      composer = null;
    }
  }

  function applySettings({ ao = state.ao, aa = state.aa, bloom = state.bloom } = {}) {
    state.ao = normalizeAoLevel(ao);
    state.aa = normalizeAaMode(aa);
    state.bloom = bloom !== false;
    if (!composer) return { ...state };
    const aoPreset = AO_PRESETS[state.ao];
    if (n8aoPass) {
      n8aoPass.enabled = aoPreset.enabled;
      if (aoPreset.enabled && n8aoPass.configuration) {
        Object.assign(n8aoPass.configuration, {
          aoSamples: aoPreset.aoSamples,
          denoiseSamples: aoPreset.denoiseSamples,
          halfRes: aoPreset.halfRes,
          aoRadius: aoPreset.aoRadius,
          intensity: aoPreset.intensity,
          distanceFalloff: 1.0,
          accumulate: false,
        });
      }
    }
    if (bloomEffect) bloomEffect.intensity = state.bloom ? 0.28 : 0;
    // SMAA falls back to FXAA if its lookup textures could not be built.
    const wantSmaa = state.aa === "smaa" && smaaPass;
    if (smaaPass) smaaPass.enabled = Boolean(wantSmaa);
    if (fxaaPass) fxaaPass.enabled = state.aa === "fxaa" || (state.aa === "smaa" && !smaaPass);
    if ( Array.isArray(composer.passes)) {
      let lastEnabled = null;
      for (const pass of composer.passes) {
        pass.renderToScreen = false;
        if (pass.enabled) lastEnabled = pass;
      }
      if (lastEnabled) lastEnabled.renderToScreen = true;
    }
    const samples = state.aa === "msaa" ? MSAA_SAMPLES : 0;
    if (composer.multisampling !== samples) composer.multisampling = samples;
    return { ...state };
  }

  /** CSS size of the canvas; the drawing buffer follows `renderer.getPixelRatio()`. */
  function setSize(cssW, cssH) {
    const w = Math.max(1, Math.floor(cssW));
    const h = Math.max(1, Math.floor(cssH));
    u("uAspect").value = w / h;
    if (composer) composer.setSize(w, h);
    else renderer?.setSize(w, h);
  }

  const sunNdc = new THREE.Vector3();
  function setVisor({ visorOn = true, glint = 0, sunDir = null } = {}) {
    u("uVisor").value = visorOn ? 1 : 0;
    let glare = 0;
    if (glint > 0 && sunDir && camera) {
      sunNdc.copy(sunDir).multiplyScalar(1000).add(camera.position).project(camera);
      if (sunNdc.z < 1 && Number.isFinite(sunNdc.x) && Number.isFinite(sunNdc.y)) {
        u("uSunScreen").value.set(sunNdc.x * 0.5 + 0.5, sunNdc.y * 0.5 + 0.5);
        glare = glint;
      }
    }
    u("uSunGlare").value = glare;
    if (chromaticAberrationEffect) {
      const ca = visorOn ? 0.00045 : 0.0;
      chromaticAberrationEffect.offset.set(ca, ca);
    }
    if (vignetteEffect) vignetteEffect.darkness = visorOn ? 0.34 : 0.14;
  }

  function render(dt) {
    if (composer) composer.render(dt);
    else renderer?.render(scene, camera);
  }

  applySettings();
  return { applySettings, setSize, setVisor, render, composer, n8aoPass, visorEffect, getState: () => ({ ...state }) };
}
