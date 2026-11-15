/**
 * 3D helmet view of the Mount Sharp walk (`web/hud/hud3d.js`).
 *
 * The camera is the astronaut's eyes. Escape leaves this view for the mission UI.
 * Symbology is drawn on the inner visor. The suit is NASA's Advanced Crew Escape Suit
 * when that mesh loads, with a procedural gait, slope-matched feet, and synthesized footsteps.
 *
 * - Terrain: the streamed HiRISE corridor (web/map/GaleCorridor.js): an ~8 m overview of the
 *   2.1 x 5.4 km corridor plus real 1 m chunks loaded around the walker, surrounded by mirrored
 *   copies so the ground never ends (copies are visual, not data). Without the corridor files it
 *   falls back to the single height-preview.png tile (value = R*256 + G).
 * - Astronaut: NASA 3D Resources spacesuit glTF, scaled to 1.80 m and rigged procedurally
 *   (astronaut-rig.js) with a distance-driven walk / run cycle. You see through a helmet camera;
 *   your own helmet is hidden, so looking down shows your legs and gloves. A second crew member
 *   walks ahead on the route (buddy EVA).
 * - Physics: Gale gravity, 180 kg suited inertia, boot traction, step-up ledges, ballistic jumps
 *   (`web/physics/`). Slope limits stay lunar stand-ins. O2 on the HUD stays a placeholder.
 * - Look: physically based materials, a Mars sky dome, sun shadows, ACES tone mapping and a camera
 *   lens pass (barrel distortion, chromatic aberration, vignette, grain). This is real-time
 *   rasterisation, not ray tracing.
 * - Receives routes via `mm:set-route` and updates the HUD (distance, slope, next stop, O2).
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import {
  buildCumulativeDistances,
  classifySlope,
  closestAlongM,
  dispatchOpenRoverInfo,
  marsBearingDeg,
  onSetRoute,
  onTeleport,
  onVisitRoverSite,
  resolveNextStopAlongRoute,
  sampleAlongRoute,
} from "../shared/route-bridge.js";
import { createAstronaut, loadSuitRig } from "./astronaut-rig.js";
import { createFootsteps } from "./footsteps.js";
import { formatHoursHM, moonFromSurface, sunStateAt } from "./MarsEphemeris.js";
import { createCelestialSky } from "./MarsCelestialSky.js";
import { createRockField } from "./MarsRockField.js";
import { createGaleVista } from "./GaleVista.js";
import { createDustDevil } from "./DustDevil.js";
import { createLandingSequence } from "./landing-sequence.js";
import { gamepad } from "../shared/gamepad.js";
import { createFieldKits } from "./FieldKits.js";
import { lerpAngleRad } from "../shared/multiplayer.js";
import { createMartianPbrTextureSets } from "../map/MarsPbrTextures.js";
import { cycleRayTracingMode, loadDevSettings, saveDevSettings, subscribeDevSettings } from "../shared/dev-settings.js";
import { MARS_GEODESY } from "../physics/MarsConstants.js";
import { ellipsoidMetersPerDeg } from "../physics/MarsGravityField.js";
import { metabolicPowerW, oxygenLitresPerMin, skyViewFactor } from "../physics/MetabolicPlssModel.js";
import { createMarsBody, stepPhysicsWorld } from "../physics/MarsPhysicsWorld.js";
import {
  downhillLeanRad,
  FROUDE_LOPE_MS,
  gradeSpeedScale,
  JUMP_SPEED_MS,
  RUN_SPEED_MS,
  torsoLeanRad,
  WALK_SPEED_MS,
} from "../physics/SuitBiomechanics.js";
import {
  DRIVABLE_VEHICLES,
  ROVER_FLIGHT_G,
  computeSpawnBesideOffset,
  createExperimentalRover,
  getDrivableVehicleSpec,
  stepAdvancedRoverPhysics,
  stepRoverBallisticPhysics,
} from "./experimental-rover.js";
import { ENTRY_OFFSET_Z, createMarsHabitatStation } from "./mars-habitat.js";
import { createMarsFxSystem } from "./mars-fx.js";
import { buildInfoBeacon, buildIngenuity, buildLanderById, buildReturnPad } from "./mars-landers.js";
import {
  MARS_SURFACE_HARDWARE,
  STAGING_PAD_DISTANCE_M,
  formatHardwareDims,
  formatHardwareLatLon,
  getSurfaceHardwareById,
  makeHardwareSiteSpec,
} from "../shared/mars-hardware.js";
import { MARS_RADIUS_MEAN_M } from "../map/Geodesy.js";
import {
  MARS_HISTORIC_ROVERS,
  getHistoricRoverById,
  makeCustomSiteSpec,
  sampleProceduralSiteHeightM,
  scatterHistoricRoverCoords,
} from "../shared/mars-rovers.js";
import { createHistoricRoverManager } from "./historic-rovers.js";
import { createNpcManager } from "./npc-system.js";
import { initNpcDialogueUi } from "./npc-dialogue-ui.js";
import { GaleCorridor, buildCorridorCellGeometry, chunkSlopeRgba } from "../map/GaleCorridor.js";
import {
  RT_HEIGHT_GLSL,
  RT_INTERNAL_RESOLUTION_SCALE,
  RT_LENS_PARS_GLSL,
  applyRayTracerTierUniforms,
  buildHeightfieldRtData,
  buildHeightfieldRtTexture,
  createRayTracerUniforms,
  getRayTracingPreset,
  patchObjectRayTracer,
} from "./ray-tracer.js";

const ASTRONAUT_HEIGHT_M = 1.8;
const EYE_HEIGHT_M = 1.64; // eye level inside the helmet of a 1.80 m astronaut
const EYE_FORWARD_M = 0.36; // at the visor, ahead of the suit's deep chest so the legs show when looking down
const PARTNER_AHEAD_M = 6;
const PARTNER_COLLISION_R = 1.05; // solid suit + backpack + 0.36 m visor clearance
const TILE_RING = 2; // mirrored copies out to 2 tiles in every direction

// NASA 3D Resources models, tried in order (first one that loads wins). The Z2 suit
// (16.9 MB, NASA's Mars-oriented prototype) can be added in front of this list once downloaded
// to ./assets/nasa-3d/z2-spacesuit.glb.
const SUIT_MODELS = [
  {
    url: "./assets/nasa-3d/advanced-crew-escape-suit.glb",
    label: "NASA ACES · LAUNCH/ENTRY MESH · PROCEDURAL GAIT",
  },
  { url: "./assets/nasa-3d/mark-iii-spacesuit.glb", label: "NASA MARK III · PROCEDURAL GAIT" },
];

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

// Mirror-wrap a tile coordinate (period 2) so heights match the mirrored copies.
function mirrorWrap(t) {
  const m = ((t % 2) + 2) % 2;
  return m > 1 ? 2 - m : m;
}

// Small tileable value-noise texture for close-range ground detail (visual only).
function makeDetailTexture(size = 512) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  const grid = (n) => {
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = Math.random();
    return g;
  };
  const octaves = [
    { n: 8, w: 0.36 },
    { n: 16, w: 0.24 },
    { n: 32, w: 0.18 },
    { n: 64, w: 0.13 },
    { n: 128, w: 0.09 },
  ].map((o) => ({ ...o, g: grid(o.n) }));
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const o of octaves) {
        const fx = (x / size) * o.n;
        const fy = (y / size) * o.n;
        const x0 = Math.floor(fx) % o.n;
        const y0 = Math.floor(fy) % o.n;
        const x1 = (x0 + 1) % o.n;
        const y1 = (y0 + 1) % o.n;
        const tx = smooth(fx - Math.floor(fx));
        const ty = smooth(fy - Math.floor(fy));
        const a = o.g[y0 * o.n + x0] + (o.g[y0 * o.n + x1] - o.g[y0 * o.n + x0]) * tx;
        const b = o.g[y1 * o.n + x0] + (o.g[y1 * o.n + x1] - o.g[y1 * o.n + x0]) * tx;
        v += (a + (b - a) * ty) * o.w;
      }
      const p = (y * size + x) * 4;
      const byte = Math.max(0, Math.min(255, v * 255));
      img.data[p] = img.data[p + 1] = img.data[p + 2] = byte;
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform float uTau;
  uniform float uSunElev;
  uniform float uSunCos;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float tau = max(0.2, uTau);
    vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
    col *= mix(vec3(1.0), vec3(0.62, 0.38, 0.22), smoothstep(0.45, 2.8, tau));
    col = mix(col, uGround, smoothstep(0.0, -0.08, h));
    // Day/twilight/night: dusty Mars twilight lasts until the sun is ~18° down.
    float day = smoothstep(-0.32, 0.12, uSunElev);
    float above = smoothstep(-0.03, 0.01, uSunElev);
    col *= mix(0.012, 1.0, day);
    float s = max(dot(d, normalize(uSunDir)), 0.0);
    float disc = smoothstep(uSunCos - 0.00002, min(0.9999992, uSunCos + 0.0000015), s);
    col += vec3(1.6, 1.65, 1.8) * disc * exp(-0.18 * tau) * above;
    col += vec3(0.55, 0.62, 0.75) * pow(s, 900.0) * 6.0 * above;
    col += vec3(0.40, 0.48, 0.62) * pow(s, 60.0) * 0.6 * day;
    col += vec3(0.30, 0.18, 0.10) * pow(s, 6.0) * 0.35 * day;
    float lowSun = smoothstep(0.38, -0.02, uSunElev);
    float fwd = smoothstep(0.90, 0.992, s);
    // Blue Martian sunset glow around the sun, fading out through twilight.
    col += vec3(0.18, 0.34, 0.62) * fwd * lowSun * exp(-tau * 0.22) * smoothstep(-0.3, -0.02, uSunElev);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const MOON_VERT = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vDirW;
  varying vec3 vLocalPos;
  void main() {
    vLocalPos = position;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vDirW = normalize(wp.xyz - cameraPosition);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// Daytime Martian moon shader: matches surrounding sky glow on dark unlit limb so the unlit side
// blends naturally into the dusty atmosphere instead of turning into a black silhouette.
const MOON_FRAG = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform float uTau;
  uniform float uSunElev;
  uniform vec3 uBaseColor;
  uniform float uAlbedoBoost;
  varying vec3 vNormalW;
  varying vec3 vDirW;
  varying vec3 vLocalPos;

  vec3 marsSky(vec3 d) {
    float h = d.y;
    float tau = max(0.2, uTau);
    vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
    col *= mix(vec3(1.0), vec3(0.62, 0.38, 0.22), smoothstep(0.45, 2.8, tau));
    col = mix(col, uGround, smoothstep(0.0, -0.08, h));
    float day = smoothstep(-0.32, 0.12, uSunElev);
    col *= mix(0.012, 1.0, day);
    float s = max(dot(d, normalize(uSunDir)), 0.0);
    col += vec3(0.55, 0.62, 0.75) * pow(s, 900.0) * 6.0 * day;
    col += vec3(0.40, 0.48, 0.62) * pow(s, 60.0) * 0.6 * day;
    col += vec3(0.30, 0.18, 0.10) * pow(s, 6.0) * 0.35 * day;
    float lowSun = smoothstep(0.38, -0.02, uSunElev);
    float fwd = smoothstep(0.90, 0.992, s);
    col += vec3(0.18, 0.34, 0.62) * fwd * lowSun * exp(-tau * 0.22) * smoothstep(-0.3, -0.02, uSunElev);
    return col;
  }

  void main() {
    vec3 d = normalize(vDirW);
    vec3 n = normalize(vNormalW);
    vec3 sun = normalize(uSunDir);
    vec3 skyBg = marsSky(d);

    // Subtle regolith/crater tonal grain on the moon surface
    vec3 p = normalize(vLocalPos);
    float mottling = 0.82 + 0.18 * sin(p.x * 11.0 + p.y * 7.0) * cos(p.z * 9.0 - p.x * 5.0);
    float ndl = max(dot(n, sun), 0.0);
    float diffuse = smoothstep(0.0, 0.85, ndl) * uAlbedoBoost * mottling;

    // Warm Martian dust extinction near the horizon
    float elevFade = smoothstep(-0.02, 0.14, d.y);
    vec3 lit = uBaseColor * diffuse * mix(vec3(1.0, 0.68, 0.45), vec3(1.0), elevFade);
    vec3 col = skyBg + lit * (0.28 + 0.72 * elevFade);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const LENS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Optical lens pass: default 20% curved black visor bezel housing HUD text, gentle optical curve, gold filter (G), zoom (Z).
const LENS_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uDistort;
  uniform float uFrameZoom;
  uniform float uBezelScale;
  uniform float uAberration;
  uniform float uGrain;
  uniform float uVignette;
  uniform float uExposure;
  uniform float uGold;
  uniform float uGoldSlide;
  uniform float uOptZoom;
  uniform float uGlint;
  uniform float uRay;
  uniform float uDust;
  varying vec2 vUv;

  ${RT_LENS_PARS_GLSL}

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    float aspect = uResolution.x / max(1.0, uResolution.y);
    vec2 c = vUv - 0.5;
    c.x *= aspect;
    float r2 = dot(c, c);
    float dist = 1.0 + uDistort * r2 + 0.35 * uDistort * r2 * r2;
    vec2 d = (c * dist * uFrameZoom) / max(1.0, uOptZoom);
    d.x /= aspect;
    vec2 uv = d + 0.5;
    vec2 dir = normalize(c + 1e-5) / vec2(aspect, 1.0);
    float ca = uAberration * r2;
    vec3 col;
    if (uRtEnabled > 0.5) {
      vec3 rtBase = rtFxaaSample(tDiffuse, clamp(uv, 0.0, 1.0), uResolution);
      float rtJ = hash(gl_FragCoord.xy + fract(uTime * 13.7) * 97.0);
      vec3 rtCol = rtScreenSpacePass(tDiffuse, rtBase, clamp(uv, 0.0, 1.0), uResolution, rtJ);
      if (ca > 0.0001) {
        col.r = mix(rtCol.r, texture2D(tDiffuse, clamp(uv + dir * ca, 0.0, 1.0)).r, 0.35);
        col.g = rtCol.g;
        col.b = mix(rtCol.b, texture2D(tDiffuse, clamp(uv - dir * ca, 0.0, 1.0)).b, 0.35);
      } else {
        col = rtCol;
      }
    } else if (ca > 0.0001) {
      col.r = texture2D(tDiffuse, clamp(uv + dir * ca, 0.0, 1.0)).r;
      col.g = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).g;
      col.b = texture2D(tDiffuse, clamp(uv - dir * ca, 0.0, 1.0)).b;
    } else {
      col = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
    }
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) col = vec3(0.0);

    // Thin curved black visor frame (default 20% strength => sleek thin visor border)
    float b = clamp(uBezelScale, 0.0, 1.5);
    float bezel = 1.0;
    float bezelRim = 0.0;
    if (b > 0.001) {
      float bNorm = b <= 0.2 ? (b / 0.2) : (1.0 + (b - 0.2) * 0.65);
      vec2 q = (vUv - 0.5) * 2.0;
      float bY = clamp(0.012 * bNorm, 0.0, 0.09);
      float bCornerY = clamp(0.038 * bNorm, 0.0, 0.14);
      float bX = clamp(0.015 * bNorm, 0.0, 0.08);
      float bCornerX = clamp(0.034 * bNorm, 0.0, 0.12);
      float yHalf = max(0.22, 1.0 - 2.0 * mix(bY, bCornerY, pow(max(abs(q.x), 1e-4), 1.85)));
      float xHalf = max(0.32, 1.0 - 2.0 * mix(bX, bCornerX, pow(max(abs(q.y), 1e-4), 1.85)));
      vec2 pBox = vec2(abs(q.x) * aspect, abs(q.y));
      vec2 halfBox = vec2(xHalf * aspect, yHalf);
      float cr = 0.068 * min(1.0, bNorm);
      vec2 qBox = pBox - (halfBox - vec2(cr));
      float dPx = length(max(qBox, 0.0)) + min(max(qBox.x, qBox.y), 0.0) - cr;
      bezel = 1.0 - smoothstep(-0.003, 0.006, dPx);
      bezelRim = smoothstep(-0.032, 0.0, dPx) * min(1.0, bNorm);
    }

    col *= uExposure;
    if (bezelRim > 0.001) {
      col *= mix(1.0, 0.62, bezelRim);
    }
    if (uVignette > 0.001) {
      float vig = smoothstep(1.30, 0.40, length(c) * uVignette);
      col *= mix(0.45, 1.0, vig);
    }

    float goldAmt = clamp(max(uGoldSlide, uGold * 0.001), 0.0, 1.0);
    if (goldAmt > 0.002) {
      vec3 goldCol = (col / (1.0 + col * 0.14)) * vec3(1.16, 0.80, 0.36);
      goldCol = mix(goldCol, goldCol * vec3(0.76, 0.65, 0.42), 0.3);
      col = mix(col, goldCol, goldAmt);
    }

    float glint = pow(max(0.0, uGlint), 3.5);
    if (glint > 0.002) {
      float fadeR = exp(-length(c) * 3.4);
      float streakH = 0.45 * exp(-abs(c.y) * 28.0) * exp(-abs(c.x) * 2.4);
      float streakD1 = 0.25 * exp(-abs(c.y - c.x * 0.36) * 52.0);
      float streakD2 = 0.25 * exp(-abs(c.y + c.x * 0.36) * 52.0);
      float sunRays = glint * (streakH + (streakD1 + streakD2) * fadeR);
      col += vec3(1.0, 0.95, 0.85) * sunRays * 0.018;
    }

    float ray = 0.0;
    float tbin = floor(uTime * 12.0);
    for (int i = 0; i < 3; i++) {
      float h = hash(vec2(tbin, float(i) + 2.7));
      if (h > uRay) continue;
      vec2 p = vec2(hash(vec2(h, 1.3)), hash(vec2(h, 2.7)));
      vec2 sdir = normalize(vec2(hash(vec2(h, 3.1)) - 0.5, hash(vec2(h, 4.2)) - 0.5) + 1e-4);
      float side = abs(dot(vUv - p, vec2(-sdir.y, sdir.x)));
      float along = dot(vUv - p, sdir);
      ray += smoothstep(0.0035, 0.0, side) * smoothstep(0.0, 0.01, along) * smoothstep(0.09, 0.02, along);
    }
    col += vec3(0.75, 0.92, 1.0) * ray;

    // dust on the outside of the visor: fixed specks that catch the light (more when you face the
    // Sun) and a faint film low on the glass; both build up as you walk (uDust 0.2 .. 1)
    vec2 gs = vUv * vec2(aspect, 1.0) * 70.0;
    vec2 cid = floor(gs);
    vec2 off = vec2(hash(cid + 3.1), hash(cid + 7.7)) - 0.5;
    float speck = step(1.0 - 0.09 * uDust, hash(cid)) * smoothstep(0.2, 0.0, length(fract(gs) - 0.5 - off * 0.5));
    col += vec3(0.95, 0.8, 0.62) * speck * (0.05 + 0.22 * pow(max(0.0, uGlint), 3.5));
    float film = uDust * smoothstep(0.42, 0.0, vUv.y) * 0.35;
    col = mix(col, col * vec3(1.02, 0.94, 0.86) + vec3(0.035, 0.024, 0.014), film);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>

    float g = hash(vUv * uResolution + fract(uTime * 37.0) * 91.0) - 0.5;
    gl_FragColor.rgb += g * uGrain * (1.0 - 0.6 * dot(gl_FragColor.rgb, vec3(0.333)));
    gl_FragColor.rgb *= bezel;
  }
`;

export async function initHud3D(
  data,
  { onOpenMenu = null, onBackToPlanner, onOpenPov, onOpenRoverInfo = null, mp = null, onLocalPose = null, onOpenOrbit = null }
) {
  const openPauseMenu = onOpenMenu || onBackToPlanner;
  const { costMap, route, stops, telemetry, dose, alerts, weather, povIndex, assets } = data;
  let surfaceG = 3.717;
  const wrap = document.getElementById("hud-canvas-wrap");
  const loadingVeil = document.getElementById("hud-loading");
  let devCfg = loadDevSettings();
  if (devCfg.rayTracing || (devCfg.rayTracingMode && devCfg.rayTracingMode !== "off")) {
    devCfg = saveDevSettings({ rayTracing: false, rayTracingMode: "off" });
  }
  const isTrLang = () => {
    try {
      return localStorage.getItem("mm-lang") === "tr";
    } catch {
      return false;
    }
  };

  // Streamed HiRISE corridor (habitat -> Glen Torridon, real 1 m DTM in chunks). When it is missing,
  // the world falls back to the single height-preview tile.
  const corridor = assets.corridorBaseUrl ? await GaleCorridor.load(assets.corridorBaseUrl) : null;

  const bounds = corridor?.bounds ||
    costMap?.bounds || {
      west_lon_deg: 137.372831,
      south_lat_deg: -4.816946,
      east_lon_deg: 137.406542,
      north_lat_deg: -4.783236,
    };
  const ncols = costMap?.grid?.ncols || 395;
  const nrows = costMap?.grid?.nrows || 395;
  const cellSizeM = costMap?.cell_size_m || 5.059;
  const worldW = corridor ? corridor.worldW : ncols * cellSizeM;
  const worldH = corridor ? corridor.worldH : nrows * cellSizeM;
  const [elevMin, elevMax] = corridor
    ? [corridor.elevMin, corridor.elevMax]
    : costMap?.height_preview_elevation_range_m || [-3850.6, -3369.3];
  // Detail-texture tiling in the terrain shader was tuned on a ~2 km tile; scale it per mesh.
  const UV_REF_M = 1998;

  let activeSiteRover = getHistoricRoverById("curiosity") || MARS_HISTORIC_ROVERS[0];
  let activeSiteId = activeSiteRover.id;

  // Convert [lon, lat] <-> local scene X, Z (metres, centred at 0,0) for active landing site
  const isGaleSite = () => Boolean(activeSiteRover?.isHiRiseGaleSite);
  /** True when a lon/lat lies on (or within ~1 km of) the real HiRISE Gale tile. */
  const insideGaleTile = (lon, lat) => {
    const padLon = (bounds.east_lon_deg - bounds.west_lon_deg) * 0.5;
    const padLat = (bounds.north_lat_deg - bounds.south_lat_deg) * 0.5;
    return (
      lon >= bounds.west_lon_deg - padLon &&
      lon <= bounds.east_lon_deg + padLon &&
      lat >= bounds.south_lat_deg - padLat &&
      lat <= bounds.north_lat_deg + padLat
    );
  };
  const cosLatClamped = (latDeg) => Math.max(0.2, Math.cos(latDeg * (Math.PI / 180)));
  const lonToX = (lon) => {
    if (isGaleSite()) {
      return ((lon - bounds.west_lon_deg) / (bounds.east_lon_deg - bounds.west_lon_deg) - 0.5) * worldW;
    }
    const rad = Math.PI / 180;
    let dLon = lon - activeSiteRover.lon;
    dLon = ((((dLon + 180) % 360) + 360) % 360) - 180;
    return dLon * rad * MARS_RADIUS_MEAN_M * cosLatClamped(activeSiteRover.lat);
  };
  const latToZ = (lat) => {
    if (isGaleSite()) {
      return (0.5 - (lat - bounds.south_lat_deg) / (bounds.north_lat_deg - bounds.south_lat_deg)) * worldH;
    }
    const rad = Math.PI / 180;
    return -(lat - activeSiteRover.lat) * rad * MARS_RADIUS_MEAN_M;
  };
  const xToLon = (x) => {
    if (isGaleSite()) {
      const u = mirrorWrap(x / worldW + 0.5);
      return bounds.west_lon_deg + u * (bounds.east_lon_deg - bounds.west_lon_deg);
    }
    const rad = Math.PI / 180;
    const mPerDeg = MARS_RADIUS_MEAN_M * cosLatClamped(activeSiteRover.lat) * rad;
    const lon = activeSiteRover.lon + x / mPerDeg;
    return ((((lon + 180) % 360) + 360) % 360) - 180;
  };
  const zToLat = (z) => {
    if (isGaleSite()) {
      const v = mirrorWrap(0.5 - z / worldH);
      return bounds.south_lat_deg + v * (bounds.north_lat_deg - bounds.south_lat_deg);
    }
    const mPerDeg = MARS_RADIUS_MEAN_M * (Math.PI / 180);
    return activeSiteRover.lat - z / mPerDeg;
  };
  const activeElevBaseM = () => (isGaleSite() ? elevMin : activeSiteRover.siteElevM ?? 0);

  // EVA start (route start, else the first stop) in scene metres. The corridor is centred between
  // the habitat and Glen Torridon, so "home" is no longer the scene origin.
  const galeHome = (() => {
    const c = route?.geometry?.coordinates?.[0] || stops?.features?.[0]?.geometry?.coordinates;
    return c ? { x: lonToX(c[0]), z: latToZ(c[1]) } : { x: 0, z: 0 };
  })();
  // Load the real 1 m ground under the start and every stop before anything is placed on it
  // (stop poles, field kits, rovers); otherwise they would sit on the smoother ~8 m overview.
  if (corridor) {
    const jobs = [corridor.warmup(galeHome.x, galeHome.z, 600, 8000)];
    for (const f of stops?.features || []) {
      const [lon, lat] = f.geometry.coordinates;
      jobs.push(corridor.warmup(lonToX(lon), latToZ(lat), 60, 8000));
    }
    await Promise.all(jobs);
  }

  // ---------- renderer, scene, camera ----------
  const scene = new THREE.Scene();
  const HORIZON = new THREE.Color(0.62, 0.43, 0.3);
  scene.fog = new THREE.FogExp2(HORIZON.getHex(), 0.00042);

  const camera = new THREE.PerspectiveCamera(78, 1, 0.06, 15000);

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  // Performance: draw at most 1.25 device pixels per CSS pixel; adaptive scaling below lowers it further.
  const MAX_PIXEL_RATIO = Math.min(window.devicePixelRatio, 1.25);
  renderer.setPixelRatio(MAX_PIXEL_RATIO);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCF: crisp enough, far cheaper than PCFSoft
  wrap.appendChild(renderer.domElement);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // Sun from the Mars24 algorithm at the active site. "local" = real local true solar time now;
  // "day" = the same site at 15:00 LTST (the classic afternoon light). Gale starts in "day" mode.
  let sunMode = "day";
  const sunSite = { lat: -4.8, lon: 137.4 };
  const computeSunState = () =>
    sunStateAt(new Date(), { latDeg: sunSite.lat, lonEastDeg: sunSite.lon, ltstHours: sunMode === "day" ? 15 : null });
  let sunState = computeSunState();
  const sunDir = new THREE.Vector3(sunState.x, sunState.y, sunState.z).normalize();
  // 0 when the sun is well below the horizon, 1 above ~+6°; drives sun light, glint and night ambient.
  const sunUp = (el) => Math.max(0, Math.min(1, (el + 0.02) / 0.12));
  let sunTransit = 1;
  // Mars sees a small sun disc (about 0.35 deg), so near shadows are crisp; the thin dusty sky
  // fills them with a weak reddish light rather than washing them out.
  const SHADOW_HALF_M = 20; // about 2 cm per shadow texel around the walker
  const SHADOW_MAP_PX = 2048;
  let shadowHalfM = SHADOW_HALF_M;
  let shadowMapPx = SHADOW_MAP_PX;
  const sun = new THREE.DirectionalLight(0xfff0de, 3.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_PX, SHADOW_MAP_PX);
  sun.shadow.camera.left = -SHADOW_HALF_M;
  sun.shadow.camera.right = SHADOW_HALF_M;
  sun.shadow.camera.top = SHADOW_HALF_M;
  sun.shadow.camera.bottom = -SHADOW_HALF_M;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 900;
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.025;
  scene.add(sun, sun.target);
  const hemiLight = new THREE.HemisphereLight(0xc99a76, 0x2e1a12, 0.22);
  scene.add(hemiLight);

  const ZENITH = new THREE.Color(0.23, 0.15, 0.12);
  const SKY_GROUND = new THREE.Color(0.3, 0.19, 0.13);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(12500, 48, 24),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: ZENITH },
        uHorizon: { value: HORIZON },
        uGround: { value: SKY_GROUND },
        uSunDir: { value: sunDir },
        uTau: { value: 0.5 },
        uSunElev: { value: sunState.elevationRad },
        uSunCos: { value: Math.cos(sunState.sunAngularRad * 0.5) },
      },
    })
  );
  sky.renderOrder = -2;
  scene.add(sky);

  // ---------- Mars Moons: Phobos (potato-shaped, prograde W->E) & Deimos (smaller, E->W) ----------
  function buildMoonGeometry(radius, axesScale, craterProfile) {
    const geom = new THREE.SphereGeometry(radius, 36, 26);
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let vx = pos.getX(i);
      let vy = pos.getY(i);
      let vz = pos.getZ(i);
      const invR = 1 / (Math.hypot(vx, vy, vz) || 1);
      const nx = vx * invR;
      const ny = vy * invR;
      const nz = vz * invR;
      let scale = 1.0;
      if (craterProfile) {
        // Stickney crater depression (+Z faces Mars when lookAt(camPos) is applied) + surface lumps
        const dStickney = Math.hypot(nx - 0.52, ny - 0.18, nz - 0.83);
        const stickney = Math.max(0, 1 - dStickney / 0.55);
        const dHall = Math.hypot(nx + 0.5, ny - 0.65, nz - 0.56);
        const hall = Math.max(0, 1 - dHall / 0.34);
        const lum = 0.05 * Math.sin(nx * 4.3 + ny * 3.1) * Math.cos(nz * 5.1);
        scale += lum - 0.18 * stickney * stickney - 0.09 * hall * hall;
      }
      pos.setXYZ(i, vx * axesScale[0] * scale, vy * axesScale[1] * scale, vz * axesScale[2] * scale);
    }
    geom.computeVertexNormals();
    return geom;
  }

  function makeMoonMat(baseHex, albedoBoost) {
    return new THREE.ShaderMaterial({
      vertexShader: MOON_VERT,
      fragmentShader: MOON_FRAG,
      depthWrite: false,
      depthTest: true,
      fog: false,
      uniforms: {
        uZenith: { value: ZENITH },
        uHorizon: { value: HORIZON },
        uGround: { value: SKY_GROUND },
        uSunDir: { value: sunDir },
        uTau: { value: 0.5 },
        uSunElev: { value: sunState.elevationRad },
        uBaseColor: { value: new THREE.Color(baseHex) },
        uAlbedoBoost: { value: albedoBoost },
      },
    });
  }

  const skyMoons = new THREE.Group();
  const phobos = new THREE.Mesh(
    buildMoonGeometry(16, [1.34, 0.9, 0.82], true),
    makeMoonMat(0xd6cbc2, 1.35)
  );
  phobos.renderOrder = -1;
  const deimos = new THREE.Mesh(
    buildMoonGeometry(3.4, [1.14, 0.95, 0.9], false),
    makeMoonMat(0xf0e4d8, 1.7)
  );
  deimos.renderOrder = -1;
  skyMoons.add(phobos, deimos);
  scene.add(skyMoons);

  const PHOBOS_ORBIT_R = 9600;
  const DEIMOS_ORBIT_R = 10400;
  const phobosDir = new THREE.Vector3();
  const deimosDir = new THREE.Vector3();
  let sunStateStampMs = performance.now();
  // Real topocentric Phobos / Deimos directions (JPL-fitted ephemeris) for the sky time in `sunState.date`.
  // Their sky sizes keep the old artistic scale; the directions and rise/set are real.
  function updateMoons(camPos = camera.position) {
    const when = new Date(sunState.date.getTime() + (performance.now() - sunStateStampMs));
    const p = moonFromSurface("phobos", when, sunSite.lat, sunSite.lon);
    phobosDir.set(p.x, p.y, p.z).normalize();
    phobos.position.copy(phobosDir).multiplyScalar(PHOBOS_ORBIT_R);
    phobos.visible = p.el > -0.05;
    phobos.lookAt(camPos);
    const d = moonFromSurface("deimos", when, sunSite.lat, sunSite.lon);
    deimosDir.set(d.x, d.y, d.z).normalize();
    deimos.position.copy(deimosDir).multiplyScalar(DEIMOS_ORBIT_R);
    deimos.visible = d.el > -0.05;
    deimos.lookAt(camPos);
    const sep = Math.acos(Math.max(-1, Math.min(1, phobosDir.dot(sunDir))));
    const limit = sunState.sunAngularRad * 0.5 + 0.1 * (Math.PI / 180);
    sunTransit = sep < limit ? 1 - 0.35 * (1 - sep / limit) : 1;
  }
  updateMoons();
  const celestial = createCelestialSky(THREE);
  celestial.update(sunState);
  scene.add(celestial.group);
  const rockField = createRockField(THREE);
  scene.add(rockField.group);
  const galeVista = createGaleVista(THREE);
  scene.add(galeVista);
  const dustDevil = createDustDevil(THREE);
  scene.add(dustDevil.points);

  // Image-based light from the same sky, so suits and rocks pick up the dusty sky and ground bounce.
  // Rebuilt whenever the sun moves enough to change the sky (time of day / site change).
  const envSphereGeom = new THREE.SphereGeometry(50, 32, 16);
  function rebuildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(envSphereGeom, sky.material));
    const prev = scene.environment;
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    prev?.dispose?.();
    scene.environmentIntensity = 0.5 * (0.18 + 0.82 * sunUp(sunState.elevationRad));
    pmrem.dispose();
  }
  rebuildEnvironment();

  // ---------- height grid ----------
  let elevGrid = null;
  let imgW = 0;
  let imgH = 0;
  if (corridor) {
    // ~8 m overview of the whole corridor: far terrain, horizon and the fallback under unloaded chunks.
    elevGrid = corridor.overview.elev;
    imgW = corridor.overview.nx;
    imgH = corridor.overview.nz;
  } else try {
    const hImg = await loadImage(assets.heightPreviewUrl);
    imgW = hImg.width;
    imgH = hImg.height;
    const c = document.createElement("canvas");
    c.width = imgW;
    c.height = imgH;
    const ctx = c.getContext("2d");
    ctx.drawImage(hImg, 0, 0);
    const px = ctx.getImageData(0, 0, imgW, imgH).data;
    elevGrid = new Float32Array(imgW * imgH);
    for (let i = 0; i < imgW * imgH; i++) {
      const val = px[i * 4] * 256 + px[i * 4 + 1];
      elevGrid[i] = elevMin + (val / 65535) * (elevMax - elevMin);
    }
  } catch {
    // Flat terrain if the height preview fails
  }

  // Bilinear height (scene Y, metres above site base), mirror-wrapped beyond the tile.
  // At Gale (Curiosity), samples real HiRISE DTM (1 m detail chunks where streamed in, else the
  // overview grid); at other rover sites, uses deterministic site relief.
  function rawSampleElevSceneY(x, z) {
    if (corridor && isGaleSite()) {
      const d = corridor.sampleDetail(x, z);
      if (d !== null) return d - elevMin;
    }
    return sampleBaseSceneY(x, z);
  }

  /** Height without the streamed detail: the overview grid at Gale, site relief elsewhere. */
  function sampleBaseSceneY(x, z) {
    if (!isGaleSite()) {
      const mx = (mirrorWrap(x / worldW + 0.5) - 0.5) * worldW;
      const mz = (mirrorWrap(z / worldH + 0.5) - 0.5) * worldH;
      return sampleProceduralSiteHeightM(activeSiteRover, mx, mz);
    }
    if (!elevGrid) return 0;
    const fx = mirrorWrap(x / worldW + 0.5) * (imgW - 1);
    const fy = mirrorWrap(z / worldH + 0.5) * (imgH - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(imgW - 1, x0 + 1);
    const y1 = Math.min(imgH - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const e00 = elevGrid[y0 * imgW + x0];
    const e10 = elevGrid[y0 * imgW + x1];
    const e01 = elevGrid[y1 * imgW + x0];
    const e11 = elevGrid[y1 * imgW + x1];
    const top = e00 + (e10 - e00) * tx;
    const bot = e01 + (e11 - e01) * tx;
    return top + (bot - top) * ty - elevMin;
  }

  const initRouteCoords = route?.geometry?.coordinates || [];
  const initRouteOriginX = initRouteCoords.length > 0 ? lonToX(initRouteCoords[0][0]) : 0;
  const initRouteOriginZ = initRouteCoords.length > 0 ? latToZ(initRouteCoords[0][1]) : 0;
  const habitatStation = createMarsHabitatStation(THREE, {
    originX: initRouteOriginX,
    originZ: initRouteOriginZ - ENTRY_OFFSET_Z,
    rawSampleElevY: rawSampleElevSceneY,
  });
  scene.add(habitatStation.group);

  /** Terrain mesh height with the habitat's levelled pad (decks and ramps are station meshes). */
  function withHabitat(x, z, y) {
    return habitatStation.group.visible ? habitatStation.sampleTerrainWithHabitat(x, z, y) : y;
  }

  function sampleElevSceneY(x, z) {
    const rawY = rawSampleElevSceneY(x, z);
    return habitatStation.group.visible ? habitatStation.sampleElevWithHabitat(x, z, rawY) : rawY;
  }

  const rtHeightInfo = buildHeightfieldRtTexture(THREE, sampleElevSceneY, worldW, worldH, 96);
  const rtUniforms = createRayTracerUniforms(THREE, worldW, worldH, sunDir, rtHeightInfo);
  patchObjectRayTracer(THREE, habitatStation.group, rtUniforms, { reflectScale: 0.72 });
  function refreshRtHeightfield() {
    const packed = buildHeightfieldRtData(sampleElevSceneY, worldW, worldH, 96);
    if (rtHeightInfo?.texture?.image?.data) {
      rtHeightInfo.texture.image.data.set(packed.data);
      rtHeightInfo.texture.needsUpdate = true;
    }
    rtUniforms.uRtElevMin.value = packed.minH;
    rtUniforms.uRtElevSpan.value = packed.span;
  }
  patchObjectRayTracer(THREE, rockField.group, rtUniforms, { reflectScale: 0.35 });
  patchObjectRayTracer(THREE, galeVista, rtUniforms, { reflectScale: 0.25 });

  function sampleNormal(x, z) {
    const e = 0.35;
    const nx = sampleElevSceneY(x - e, z) - sampleElevSceneY(x + e, z);
    const nz = sampleElevSceneY(x, z - e) - sampleElevSceneY(x, z + e);
    const ny = 2 * e;
    const len = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / len, y: ny / len, z: nz / len };
  }

  function footSample(x, z, yaw, bodyY) {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const one = (side) => {
      const px = x + fx * 0.16 + rx * side * 0.12;
      const pz = z + fz * 0.16 + rz * side * 0.12;
      return { dy: sampleElevSceneY(px, pz) - bodyY, n: sampleNormal(px, pz) };
    };
    const L = one(-1);
    const R = one(1);
    return { footDyL: L.dy, footDyR: R.dy, normalL: L.n, normalR: R.n };
  }

  // The base mesh (whole tile / corridor overview) never uses the streamed detail: detail chunks
  // draw their own meshes on top, and the base is cut away under them in the shader.
  function buildTerrainGeometry(segX, segZ = segX) {
    const g = new THREE.PlaneGeometry(worldW, worldH, segX, segZ);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, withHabitat(x, z, sampleBaseSceneY(x, z)));
    }
    g.computeVertexNormals();
    return addSkirt(g, segX, segZ, 40);
  }

  // Tiles of different vertex density meet with small height mismatches along their edges, which
  // open thin cracks where the sky shows through. A skirt (a strip hanging 40 m down from every
  // edge, textured like the edge) fills those cracks without changing the visible surface.
  function addSkirt(g, segX, segZ, depth) {
    const n = segX + 1; // vertices per row
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    const nor = g.attributes.normal;
    const ring = [];
    for (let i = 0; i < n; i++) ring.push(i); // north edge
    for (let j = 1; j <= segZ; j++) ring.push(j * n + segX); // east edge
    for (let i = segX - 1; i >= 0; i--) ring.push(segZ * n + i); // south edge
    for (let j = segZ - 1; j >= 1; j--) ring.push(j * n); // west edge
    const base = pos.count;
    const m = ring.length;
    const P = new Float32Array((pos.count + 2 * m) * 3);
    const U = new Float32Array((pos.count + 2 * m) * 2);
    const N = new Float32Array((pos.count + 2 * m) * 3);
    P.set(pos.array);
    U.set(uv.array);
    N.set(nor.array);
    ring.forEach((src, k) => {
      for (const [o, dy] of [
        [base + 2 * k, 0],
        [base + 2 * k + 1, -depth],
      ]) {
        P[o * 3] = pos.getX(src);
        P[o * 3 + 1] = pos.getY(src) + dy;
        P[o * 3 + 2] = pos.getZ(src);
        U[o * 2] = uv.getX(src);
        U[o * 2 + 1] = uv.getY(src);
        N[o * 3] = nor.getX(src);
        N[o * 3 + 1] = nor.getY(src);
        N[o * 3 + 2] = nor.getZ(src);
      }
    });
    const idx = Array.from(g.index.array);
    for (let k = 0; k < m; k++) {
      const a = base + 2 * k;
      const b = base + 2 * ((k + 1) % m);
      // both windings, so the strip shows from either side (mirrored copies flip winding)
      idx.push(a, a + 1, b, b, a + 1, b + 1, a, b, a + 1, b, b + 1, a + 1);
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(P, 3));
    out.setAttribute("uv", new THREE.BufferAttribute(U, 2));
    out.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    out.setIndex(idx);
    out.computeBoundingSphere();
    out.computeBoundingBox();
    return out;
  }

  // Corridor: one vertex per overview sample (~8 m). Single tile: up to 394 x 394 (~5 m).
  const fullSeg = elevGrid ? Math.min(imgW - 1, 394) : 1;
  const fullSegZ = corridor ? imgH - 1 : fullSeg;
  const copySeg = Math.max(1, Math.floor(fullSeg / 4));
  const copySegZ = Math.max(1, Math.floor(fullSegZ / 4));
  let terrainGeom = buildTerrainGeometry(fullSeg, fullSegZ);
  // mirrored copies are seen from far away through fog: a quarter of the vertex density is plenty
  let copyGeom = buildTerrainGeometry(copySeg, copySegZ);

  // ---------- far terrain shadows (baked) ----------
  // The real-time shadow map only covers the ground near the walker. For the rest, march from every
  // terrain cell towards the sun through the height grid and store how much of the sun is visible.
  // The mirrored terrain repeats every 2 tiles in world space, so one mask over that period, sampled
  // with world x/z and repeat wrapping, is correct for the real tile and every mirrored copy.
  function bakeSunMask() {
    const n = elevGrid ? imgW : 0;
    const m = elevGrid ? imgH : 0;
    if (!n || !m) return null;
    const NX = 2 * n; // cells across one mirror period (east-west)
    const NZ = 2 * m; // (north-south); the corridor is not square
    const cellX = worldW / n;
    const cellZ = worldH / m;
    const H = new Float32Array(NX * NZ);
    for (let r = 0; r < NZ; r++) {
      const sr = r < m ? r : 2 * m - 1 - r;
      for (let c = 0; c < NX; c++) {
        const sc = c < n ? c : 2 * n - 1 - c;
        H[r * NX + c] = elevGrid[sr * imgW + sc];
      }
    }
    const horiz = Math.max(1e-4, Math.hypot(sunDir.x, sunDir.z));
    const tanSun = sunDir.y / horiz;
    const stepM = Math.min(cellX, cellZ);
    const dx = ((sunDir.x / horiz) * stepM) / cellX; // cells per step towards the sun (x = columns, east)
    const dz = ((sunDir.z / horiz) * stepM) / cellZ; // z = rows, south
    const maxSteps = Math.ceil(700 / stepM);
    const SOFT = 0.012; // about the sun disc plus dust: soft edge in tan(angle)
    const out = new Uint8Array(NX * NZ * 4);
    if (sunDir.y <= 0.0) {
      // Sun below the horizon: nothing is directly lit (the sun light is also switched off).
      for (let i = 0; i < out.length; i += 4) out[i + 3] = 255;
      const dark = new THREE.DataTexture(out, NX, NZ, THREE.RGBAFormat);
      dark.needsUpdate = true;
      return dark;
    }
    if (sunDir.y > 0.995) {
      out.fill(255); // sun at the zenith: no terrain shadows
      const lit = new THREE.DataTexture(out, NX, NZ, THREE.RGBAFormat);
      lit.needsUpdate = true;
      return lit;
    }
    const wrapX = (v) => ((v % NX) + NX) % NX;
    const wrapZ = (v) => ((v % NZ) + NZ) % NZ;
    for (let r = 0; r < NZ; r++) {
      for (let c = 0; c < NX; c++) {
        const h0 = H[r * NX + c];
        let worst = -1e9;
        for (let k = 1; k <= maxSteps; k++) {
          const fx = c + dx * k;
          const fz = r + dz * k;
          const x0 = Math.floor(fx);
          const z0 = Math.floor(fz);
          const tx = fx - x0;
          const tz = fz - z0;
          const a = wrapX(x0);
          const b = wrapX(x0 + 1);
          const ra = wrapZ(z0) * NX;
          const rb = wrapZ(z0 + 1) * NX;
          const h =
            (H[ra + a] * (1 - tx) + H[ra + b] * tx) * (1 - tz) + (H[rb + a] * (1 - tx) + H[rb + b] * tx) * tz;
          const t = (h - h0) / (k * stepM);
          if (t > worst) {
            worst = t;
            if (worst > tanSun + SOFT) break; // fully in shadow
          }
        }
        const lit = Math.min(1, Math.max(0, (tanSun - worst) / (2 * SOFT) + 0.5));
        // texture row 0 = smallest world z (north), matching the shader's lookup
        const o = (r * NX + c) * 4;
        out[o] = out[o + 1] = out[o + 2] = Math.round(lit * 255);
        out[o + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(out, NX, NZ, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }
  const bakeT0 = performance.now();
  let sunMask = bakeSunMask();
  if (sunMask) {
    const d = sunMask.image.data;
    let shade = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) shade++;
    console.info(`sun mask baked in ${Math.round(performance.now() - bakeT0)} ms, ${((100 * shade) / (d.length / 4)).toFixed(1)}% of ground in terrain shadow`);
  }

  // ---------- terrain material ----------
  const texLoader = new THREE.TextureLoader();
  const prepTex = (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    return t;
  };
  const maxTexDim = Math.min(4096, renderer?.capabilities?.maxTextureSize || 4096);
  function upscaleWithFillers(tex) {
    const img = tex?.image;
    const sw = img?.naturalWidth || img?.width || 0;
    const sh = img?.naturalHeight || img?.height || 0;
    if (!sw || !sh || Math.max(sw, sh) >= maxTexDim) return tex;
    const maxScale = Math.floor(maxTexDim / Math.max(sw, sh));
    if (maxScale < 2) return tex;
    const dw = sw * maxScale;
    const dh = sh * maxScale;

    // Progressive 2x steps preserve smooth diagonal contours & structure without single-pass blur/ringing.
    let curSrc = img;
    let cw = sw;
    let ch = sh;
    while (cw * 2 < dw && ch * 2 < dh) {
      cw *= 2;
      ch *= 2;
      const stepCanvas = document.createElement("canvas");
      stepCanvas.width = cw;
      stepCanvas.height = ch;
      const sctx = stepCanvas.getContext("2d");
      if (!sctx) break;
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = "high";
      sctx.drawImage(curSrc, 0, 0, cw, ch);
      curSrc = stepCanvas;
    }

    const canvas = document.createElement("canvas");
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return tex;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(curSrc, 0, 0, dw, dh);

    // Multi-scale (1 px + upscale-radius) luminance-only unsharp sharpening + zero-mean micro filler pixels.
    // Produces visibly crisp ridges & features while keeping RGB color balance, shapes, and smoothness exact.
    const imgData = ctx.getImageData(0, 0, dw, dh);
    const px = imgData.data;
    const src = new Uint8ClampedArray(px);
    const row = dw * 4;
    const rad = Math.max(2, Math.round(maxScale * 0.45));
    const radOff = rad * 4;
    const radRow = rad * row;
    for (let y = rad; y < dh - rad; y++) {
      const yOff = y * row;
      for (let x = rad; x < dw - rad; x++) {
        const i = yOff + x * 4;
        const lc = (src[i] * 77 + src[i + 1] * 150 + src[i + 2] * 29) >> 8;
        const ll = (src[i - 4] * 77 + src[i - 3] * 150 + src[i - 2] * 29) >> 8;
        const lr = (src[i + 4] * 77 + src[i + 5] * 150 + src[i + 6] * 29) >> 8;
        const lu = (src[i - row] * 77 + src[i - row + 1] * 150 + src[i - row + 2] * 29) >> 8;
        const ld = (src[i + row] * 77 + src[i + row + 1] * 150 + src[i + row + 2] * 29) >> 8;
        const wl = (src[i - radOff] * 77 + src[i - radOff + 1] * 150 + src[i - radOff + 2] * 29) >> 8;
        const wr = (src[i + radOff] * 77 + src[i + radOff + 1] * 150 + src[i + radOff + 2] * 29) >> 8;
        const wu = (src[i - radRow] * 77 + src[i - radRow + 1] * 150 + src[i - radRow + 2] * 29) >> 8;
        const wd = (src[i + radRow] * 77 + src[i + radRow + 1] * 150 + src[i + radRow + 2] * 29) >> 8;
        const grad = Math.abs(lr - ll) + Math.abs(ld - lu) + ((Math.abs(wr - wl) + Math.abs(wd - wu)) >> 1);
        const lap1 = 4 * lc - ll - lr - lu - ld;
        const lapWide = 4 * lc - wl - wr - wu - wd;
        const sharp = Math.max(-24, Math.min(24, lap1 * 0.55 + lapWide * 0.38));
        let micro = 0;
        if (grad >= 6) {
          const n = (((x * 73856093) ^ (y * 19349663)) & 255) / 255 - 0.5;
          micro = n * Math.min(7, grad * 0.12);
        }
        const delta = Math.round(sharp + micro);
        if (!delta) continue;
        px[i] = Math.max(0, Math.min(255, src[i] + delta));
        px[i + 1] = Math.max(0, Math.min(255, src[i + 1] + delta));
        px[i + 2] = Math.max(0, Math.min(255, src[i + 2] + delta));
      }
    }
    ctx.putImageData(imgData, 0, 0);
    tex.image = canvas;
    tex.needsUpdate = true;
    return tex;
  }
  const orthoTex = prepTex(texLoader.load(assets.orthoPreviewUrl, upscaleWithFillers));
  const slopeTex = prepTex(texLoader.load(assets.slopePreviewUrl, upscaleWithFillers));
  const reliefUrl = corridor
    ? corridor.overviewTextureUrl()
    : assets.reliefTextureUrl || assets.heightPreviewUrl.replace(/height-preview\.png$/, "texture-relief.jpg");
  let reliefOk = true;
  let texMode = 0; // 0 relief, 1 ortho, 2 slope
  const reliefTex = prepTex(
    texLoader.load(reliefUrl, upscaleWithFillers, undefined, () => {
      reliefOk = false;
      if (texMode === 0) {
        texMode = 1;
        terrainMat.map = orthoTex;
        terrainMat.needsUpdate = true;
        const b = document.getElementById("hud-tex");
        if (b) b.textContent = "Tex: ortho";
      }
    })
  );
  const detailTex = makeDetailTexture();
  // Offline procedural Mars ground (map branch): wind-rippled regolith + fractured mudstone slabs.
  const pbr = createMartianPbrTextureSets(THREE, 512);
  for (const t of [pbr.dustAlbedoTex, pbr.rockAlbedoTex, pbr.dustNormalTex, pbr.rockNormalTex]) t.anisotropy = maxAniso;
  pbr.dustNormalTex.repeat.set((960 * worldW) / UV_REF_M, (960 * worldH) / UV_REF_M);
  let pbrHigh = null;
  let terrainShaderRef = null;
  let suitWeaveTex = null;

  function ensureHighResPbr() {
    if (pbrHigh) return pbrHigh;
    pbrHigh = createMartianPbrTextureSets(THREE, 1024);
    for (const t of [pbrHigh.dustAlbedoTex, pbrHigh.rockAlbedoTex, pbrHigh.dustNormalTex, pbrHigh.rockNormalTex]) {
      t.anisotropy = maxAniso;
    }
    pbrHigh.dustNormalTex.repeat.set((960 * worldW) / UV_REF_M, (960 * worldH) / UV_REF_M);
    return pbrHigh;
  }

  function ensureSuitWeaveNormal() {
    if (suitWeaveTex) return suitWeaveTex;
    const sz = 128;
    const data = new Uint8Array(sz * sz * 4);
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const gx = Math.sin((x / sz) * Math.PI * 32) * 0.25;
        const gy = Math.sin((y / sz) * Math.PI * 32) * 0.25;
        const seam = x % 16 === 0 || y % 16 === 0 ? -0.35 : 0.0;
        const dx = gx + seam * 0.25;
        const dy = gy + seam * 0.25;
        const inv = 1 / Math.hypot(dx, dy, 1);
        const i = (y * sz + x) * 4;
        data[i] = Math.round(((dx * inv) * 0.5 + 0.5) * 255);
        data[i + 1] = Math.round(((dy * inv) * 0.5 + 0.5) * 255);
        data[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
        data[i + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, sz, sz, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(14, 14);
    tex.needsUpdate = true;
    suitWeaveTex = tex;
    return tex;
  }

  const galeRadii = ellipsoidMetersPerDeg(MARS_GEODESY.GALE_ANCHOR_LAT_DEG);
  const curvAnchor = { value: new THREE.Vector2() };
  const curvInv2N = {
    value: 1 / (2 * (galeRadii.primeVerticalM + MARS_GEODESY.GALE_ANCHOR_ELEV_M)),
  };
  const curvInv2M = {
    value: 1 / (2 * (galeRadii.meridionalM + MARS_GEODESY.GALE_ANCHOR_ELEV_M)),
  };
  const terrainMat = new THREE.MeshStandardMaterial({
    map: reliefTex,
    normalMap: pbr.dustNormalTex,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.96,
    metalness: 0.0,
  });
  terrainMat.envMapIntensity = 0.7; // ground in shade stays dark; the suit keeps the full sky light
  const superDetailUniform = { value: 0 };
  const realisticTexUniform = { value: 0 };
  // Shared by every terrain material (base mesh, mirrored copies, streamed detail chunks).
  const sunMaskU = { value: sunMask };
  const sunMaskOnU = { value: sunMask ? 1 : 0 };
  const sunMaskPeriodU = { value: new THREE.Vector2(2 * worldW, 2 * worldH) };
  const sunMaskOriginU = { value: new THREE.Vector2(-worldW / 2, -worldH / 2) };
  const pbrDustU = { value: devCfg.realisticTextures ? ensureHighResPbr().dustAlbedoTex : pbr.dustAlbedoTex };
  const pbrRockU = { value: devCfg.realisticTextures ? ensureHighResPbr().rockAlbedoTex : pbr.rockAlbedoTex };
  const detailMapU = { value: detailTex };
  // Detail-chunk coverage (16 x 16 scene cells around the walker): the base mesh is cut away where a
  // streamed 1 m chunk is drawn, so the smoother ~8 m overview never pokes through it.
  const COV_N = 16;
  const covData = new Uint8Array(COV_N * COV_N * 4);
  const covTex = new THREE.DataTexture(covData, COV_N, COV_N, THREE.RGBAFormat);
  covTex.magFilter = THREE.NearestFilter;
  covTex.minFilter = THREE.NearestFilter;
  covTex.needsUpdate = true;
  const covTexU = { value: covTex };
  const covOriginU = { value: new THREE.Vector2() };
  const covCellU = { value: new THREE.Vector2(corridor ? corridor.chunkW : 1, corridor ? corridor.chunkH : 1) };

  /** Per-material uniforms: detail tiling scale and whether this mesh is cut under detail chunks. */
  function makeTerrainMmUniforms(spanXM, spanZM, coverageCut) {
    return {
      uMmUvScale: { value: new THREE.Vector2(spanXM / UV_REF_M, spanZM / UV_REF_M) },
      uCovOn: { value: coverageCut ? 1 : 0 },
    };
  }
  terrainMat.userData.mm = makeTerrainMmUniforms(worldW, worldH, Boolean(corridor));

  /** Shader patch for every terrain material. Called as a method, so `this` is the material. */
  function patchTerrainShader(shader) {
    if (this === terrainMat) terrainShaderRef = shader;
    const mm = this.userData.mm;
    shader.uniforms.detailMap = detailMapU;
    shader.uniforms.uCurvAnchor = curvAnchor;
    shader.uniforms.uCurvInv2N = curvInv2N;
    shader.uniforms.uCurvInv2M = curvInv2M;
    shader.uniforms.pbrDust = pbrDustU;
    shader.uniforms.pbrRock = pbrRockU;
    shader.uniforms.sunMask = sunMaskU;
    shader.uniforms.sunMaskOn = sunMaskOnU;
    shader.uniforms.sunMaskPeriod = sunMaskPeriodU;
    shader.uniforms.sunMaskOrigin = sunMaskOriginU;
    shader.uniforms.uSuperDetail = superDetailUniform;
    shader.uniforms.uRealisticTex = realisticTexUniform;
    shader.uniforms.uMmUvScale = mm.uMmUvScale;
    shader.uniforms.uCovOn = mm.uCovOn;
    shader.uniforms.uCov = covTexU;
    shader.uniforms.uCovOrigin = covOriginU;
    shader.uniforms.uCovCell = covCellU;
    Object.assign(shader.uniforms, rtUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec2 vMmWorldXZ;\nvarying vec3 vRtWorldPos;\nvarying float vMmSlope;\nvarying float vMmElev;\nuniform vec2 uCurvAnchor;\nuniform float uCurvInv2N;\nuniform float uCurvInv2M;"
      )
      .replace(
        "#include <project_vertex>",
        "vMmSlope = 1.0 - clamp(abs(normal.y), 0.0, 1.0);\nvMmElev = transformed.y;\nvec4 mmWorld = modelMatrix * vec4(transformed, 1.0);\nvMmWorldXZ = mmWorld.xz;\nvRtWorldPos = mmWorld.xyz;\nfloat mmDx = mmWorld.x - uCurvAnchor.x;\nfloat mmDz = mmWorld.z - uCurvAnchor.y;\nmmWorld.y += -mmDx * mmDx * uCurvInv2N - mmDz * mmDz * uCurvInv2M;\nvec4 mvPosition = viewMatrix * mmWorld;\ngl_Position = projectionMatrix * mvPosition;"
      );
    const sunChunk = THREE.ShaderChunk.lights_fragment_begin.replace(
      "getDirectionalLightInfo( directionalLight, directLight );",
      "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= mmSunVis;"
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec2 vMmWorldXZ;\nvarying vec3 vRtWorldPos;\nvarying float vMmSlope;\nvarying float vMmElev;\nuniform sampler2D sunMask;\nuniform float sunMaskOn;\nuniform vec2 sunMaskPeriod;\nuniform vec2 sunMaskOrigin;\nuniform vec2 uMmUvScale;\nuniform float uCovOn;\nuniform sampler2D uCov;\nuniform vec2 uCovOrigin;\nuniform vec2 uCovCell;\n${RT_HEIGHT_GLSL}`
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        if (uCovOn > 0.5) {
          vec2 mmCc = (vMmWorldXZ - uCovOrigin) / uCovCell;
          if (mmCc.x >= 0.0 && mmCc.y >= 0.0 && mmCc.x < ${COV_N}.0 && mmCc.y < ${COV_N}.0 &&
              texture2D(uCov, (floor(mmCc) + 0.5) / ${COV_N}.0).r > 0.5) discard;
        }`
      )
      .replace(
        "#include <lights_fragment_begin>",
        "float mmMaskVis = sunMaskOn > 0.5 ? texture2D(sunMask, (vMmWorldXZ - sunMaskOrigin) / sunMaskPeriod).r : 1.0;\nfloat mmSunVis = mmMaskVis;\nfloat rtCamDist = length(vViewPosition);\nfloat rtMaxD = max(110.0, uRtMaxDist);\nif (uRtEnabled > 0.5 && rtCamDist < rtMaxD) {\n  float rtShJ = rtIgn(gl_FragCoord.xy + fract(uRtTime) * 53.0);\n  float rtSh = rtTraceShadow(vRtWorldPos + vec3(0.0, 0.14, 0.0), uRtSunDir, rtMaxD, rtShJ);\n  float rtShVis = mix(rtSh, min(rtSh, mmMaskVis), 0.35);\n  float rtFade = (uRtQuality >= 3.5) ? 1.0 : (1.0 - smoothstep(rtMaxD * 0.72, rtMaxD, rtCamDist));\n  mmSunVis = mix(mmMaskVis, rtShVis, rtFade);\n}\n" +
          sunChunk
      )
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
        float rtGiMaxD = (uRtQuality >= 3.5) ? rtMaxD : rtMaxD * 0.78;
        if (uRtEnabled > 0.5 && rtCamDist < rtGiMaxD) {
          float rtGiFade = (uRtQuality >= 3.5) ? 1.0 : (1.0 - smoothstep(rtGiMaxD * 0.68, rtGiMaxD, rtCamDist));
          float rtJGi = rtIgn(gl_FragCoord.xy + fract(uRtTime * 1.37) * 79.0);
          vec3 rtWN = normalize((vec4(geometryNormal, 0.0) * viewMatrix).xyz);
          vec3 rtWV = normalize((vec4(geometryViewDir, 0.0) * viewMatrix).xyz);
          float rtSkyVis;
          vec3 rtBounce;
          rtTraceGI(vRtWorldPos + rtWN * 0.08, rtWN, uRtSunDir, rtJGi, rtSkyVis, rtBounce);
          reflectedLight.indirectDiffuse *= mix(1.0, rtSkyVis, rtGiFade);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * rtBounce * rtGiFade;
          float rtFresnel = pow(1.0 - clamp(dot(rtWN, rtWV), 0.0, 1.0), 5.0);
          if (rtFresnel > 0.025) {
            vec3 rtReflDir = reflect(-rtWV, rtWN);
            vec3 rtSkySpec = rtMarsSky(rtReflDir, uRtSunDir);
            reflectedLight.indirectSpecular += rtSkySpec * rtFresnel * 0.18 * rtSkyVis * rtGiFade;
          }
        }`
      )
      .replace(
        "#include <map_pars_fragment>",
        "#include <map_pars_fragment>\nuniform sampler2D detailMap;\nuniform sampler2D pbrDust;\nuniform sampler2D pbrRock;\nuniform float uSuperDetail;\nuniform float uRealisticTex;"
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        #ifdef USE_MAP
          vec2 mmUv = vMapUv * uMmUvScale; // same metres per detail tile on every terrain mesh
          float dA = texture2D(detailMap, mmUv * 173.0).r;
          float dB = texture2D(detailMap, mmUv * 911.0).r;
          float mmSlopeMix = smoothstep(0.03, 0.30, vMmSlope);
          vec2 mmElevWarp = (vec2(dA - 0.5, dB - 0.5) * 0.0020 + vec2(sin(vMmElev * 0.42), cos(vMmElev * 0.42)) * 0.0010) * mmSlopeMix;
          vec3 mmAltTex = texture2D(map, vMapUv + mmElevWarp / uMmUvScale).rgb;
          diffuseColor.rgb = mix(diffuseColor.rgb, mmAltTex, 0.45 * mmSlopeMix);
          float detailGain = mix(0.46, 0.62, max(uSuperDetail, uRealisticTex * 0.90));
          diffuseColor.rgb *= (1.0 - detailGain * 0.65) + detailGain * dA * 0.6 + detailGain * dB * 0.4;
          // Close-range ground detail: ripples / pebbles on dust, slabs + veins on rock patches + fine sub-meter grit.
          vec3 mmDust = texture2D(pbrDust, mmUv * mix(720.0, 1080.0, max(uSuperDetail, uRealisticTex))).rgb;
          vec3 mmRock = texture2D(pbrRock, mmUv * mix(320.0, 520.0, max(uSuperDetail, uRealisticTex)) + 0.37).rgb;
          vec3 mmMicro = texture2D(pbrDust, mmUv * mix(2200.0, 3200.0, max(uSuperDetail, uRealisticTex)) + 0.19).rgb;
          float mmRockMask = clamp(max(smoothstep(0.48, 0.66, texture2D(detailMap, mmUv * 41.0 + 0.11).r), mmSlopeMix * 0.62), 0.0, 1.0);
          vec3 mmGround = mix(mmDust, mmRock, mmRockMask);
          float mmLum = dot(mmGround, vec3(0.299, 0.587, 0.114)) / 0.40;
          float mmMicroLum = dot(mmMicro, vec3(0.299, 0.587, 0.114)) / 0.40;
          float mmRichLum = mix(mmLum, pow(clamp(mmLum, 0.18, 2.1), 1.38), uRealisticTex);
          float mmMineralGlint = uRealisticTex * smoothstep(0.92, 0.995, dB) * 0.18;
          diffuseColor.rgb *= mix(1.0, clamp(mmRichLum, 0.22, 1.95), mix(0.82, 0.98, max(uSuperDetail, uRealisticTex)));
          diffuseColor.rgb *= mix(1.0, clamp(mmMicroLum, 0.62, 1.42), 0.42);
          diffuseColor.rgb += vec3(mmMineralGlint, mmMineralGlint * 0.72, mmMineralGlint * 0.48);
        #endif`
      );
  }
  terrainMat.onBeforeCompile = patchTerrainShader;

  const terrainMesh = new THREE.Mesh(terrainGeom, terrainMat);
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = false; // terrain shadows come from the baked sun mask, not the shadow map
  scene.add(terrainMesh);

  // Endless ground: mirrored copies meet the real tile with identical edges. Only the
  // centre tile is data; the ring follows the camera in steps of one mirror period.
  const endless = new THREE.Group();
  for (let i = -TILE_RING; i <= TILE_RING; i++) {
    for (let j = -TILE_RING; j <= TILE_RING; j++) {
      const copy = new THREE.Mesh(i === 0 && j === 0 ? terrainGeom : copyGeom, terrainMat);
      copy.position.set(i * worldW, 0, j * worldH);
      copy.scale.set(i % 2 === 0 ? 1 : -1, 1, j % 2 === 0 ? 1 : -1);
      copy.receiveShadow = true;
      copy.userData.mirrorCopy = true;
      if (i === 0 && j === 0) {
        copy.visible = false; // the real tile sits here until the ring moves
        endless.userData.centre = copy;
      }
      endless.add(copy);
    }
  }
  scene.add(endless);
  const period = { x: 2 * worldW, z: 2 * worldH };
  function followEndless(pos) {
    endless.position.set(Math.round(pos.x / period.x) * period.x, 0, Math.round(pos.z / period.z) * period.z);
    endless.userData.centre.visible = endless.position.x !== 0 || endless.position.z !== 0;
  }

  // ---------- streamed 1 m detail chunks (Gale corridor) ----------
  // Each ~259 m scene cell near the walker gets its own mesh built from the real 1 m DTM chunk
  // (mirrored copies reuse the same data, flipped). Level of detail by distance; far cells are
  // dropped and the overview mesh shows again there.
  const chunkGroup = new THREE.Group();
  scene.add(chunkGroup);
  const chunkMeshes = new Map(); // "a,b" -> { a, b, ci, cj, seg, mesh, ready, disposed }
  const chunkTexEntries = new Map(); // data-chunk index -> { tex, slope, refs, loaded, failed, waiters }
  const chunkNormalClones = new Map(); // shared normal map -> clone tiled for one chunk
  const DETAIL_RADIUS_M = 850;
  const DATA_RADIUS_M = 1050;
  const chunkLodSeg = (d) => (d < 150 ? 256 : d < 450 ? 128 : 64); // 1 m, 2 m, 4 m vertex spacing
  let chunkPlanT = 0;
  let chunkPlanCell = "";
  let chunkBuildQueue = [];
  let covDirty = true;
  let covA0 = Number.NaN;
  let covB0 = Number.NaN;
  if (corridor) {
    corridor.onChunkLoaded(() => {
      chunkPlanT = 0; // new data: queue the cells that were waiting for it
    });
  }

  function chunkNormalFor(src) {
    let t = chunkNormalClones.get(src);
    if (!t) {
      t = src.clone(); // shares the image with the base mesh's normal map
      t.repeat.set((960 * corridor.chunkW) / UV_REF_M, (960 * corridor.chunkH) / UV_REF_M);
      chunkNormalClones.set(src, t);
    }
    return t;
  }

  function chunkTexEntry(ci, cj) {
    const i = corridor.index(ci, cj);
    let e = chunkTexEntries.get(i);
    if (!e) {
      e = { refs: 0, loaded: false, failed: false, waiters: [], slope: null, ci, cj };
      const settle = (ok) => {
        e.loaded = ok;
        e.failed = !ok;
        for (const w of e.waiters.splice(0)) w();
      };
      e.tex = texLoader.load(corridor.chunkTextureUrl(ci, cj), () => settle(true), undefined, () => settle(false));
      e.tex.colorSpace = THREE.SRGBColorSpace;
      e.tex.anisotropy = maxAniso;
      chunkTexEntries.set(i, e);
    }
    return e;
  }

  function chunkSlopeTex(e) {
    if (!e.slope) {
      const rgba = chunkSlopeRgba(corridor, e.ci, e.cj, 128);
      if (!rgba) return e.tex;
      e.slope = new THREE.DataTexture(rgba, 128, 128, THREE.RGBAFormat);
      e.slope.colorSpace = THREE.SRGBColorSpace;
      e.slope.magFilter = THREE.LinearFilter;
      e.slope.minFilter = THREE.LinearFilter;
      e.slope.needsUpdate = true;
    }
    return e.slope;
  }

  function releaseChunkTex(e) {
    e.refs--;
    if (e.refs > 0) return;
    e.tex.dispose();
    e.slope?.dispose();
    chunkTexEntries.delete(corridor.index(e.ci, e.cj));
  }

  function chunkMapFor(e) {
    return texMode === 2 ? chunkSlopeTex(e) : e.tex;
  }

  function makeChunkMaterial(e) {
    const m = new THREE.MeshStandardMaterial({
      map: chunkMapFor(e),
      normalMap: chunkNormalFor(terrainMat.normalMap),
      normalScale: terrainMat.normalScale.clone(),
      roughness: terrainMat.roughness,
      metalness: 0.0,
    });
    m.envMapIntensity = terrainMat.envMapIntensity;
    m.userData.mm = makeTerrainMmUniforms(corridor.chunkW, corridor.chunkH, false);
    m.onBeforeCompile = patchTerrainShader;
    return m;
  }

  /** Keep chunk materials in step with the base terrain material (dev settings, texture mode). */
  function syncChunkMaterials() {
    for (const c of chunkMeshes.values()) {
      const m = c.mesh.material;
      m.map = chunkMapFor(c.texEntry);
      m.normalMap = chunkNormalFor(terrainMat.normalMap);
      m.normalScale.copy(terrainMat.normalScale);
      m.roughness = terrainMat.roughness;
      m.needsUpdate = true;
    }
  }

  function disposeChunk(key, c) {
    c.disposed = true;
    chunkGroup.remove(c.mesh);
    c.mesh.geometry.dispose();
    c.mesh.material.dispose();
    releaseChunkTex(c.texEntry);
    chunkMeshes.delete(key);
    covDirty = true;
  }

  function planCorridorChunks(px, pz) {
    corridor.update(px, pz, DATA_RADIUS_M);
    const { a, b } = corridor.sceneCellOf(px, pz);
    const ra = Math.ceil(DETAIL_RADIUS_M / corridor.chunkW) + 1;
    const rb = Math.ceil(DETAIL_RADIUS_M / corridor.chunkH) + 1;
    const want = new Map();
    for (let db = -rb; db <= rb; db++) {
      for (let da = -ra; da <= ra; da++) {
        const d = corridor.cellDistance(a + da, b + db, px, pz);
        if (d > DETAIL_RADIUS_M) continue;
        want.set(`${a + da},${b + db}`, { a: a + da, b: b + db, d, seg: chunkLodSeg(d) });
      }
    }
    for (const [key, c] of chunkMeshes) if (!want.has(key)) disposeChunk(key, c);
    chunkBuildQueue = [...want.entries()]
      .filter(([key, w]) => chunkMeshes.get(key)?.seg !== w.seg)
      .map(([, w]) => w)
      .sort((p, q) => p.d - q.d);
  }

  function buildQueuedChunks(budgetMs) {
    const t0 = performance.now();
    let built = 0;
    while (chunkBuildQueue.length && (built === 0 || performance.now() - t0 < budgetMs)) {
      const w = chunkBuildQueue.shift();
      const key = `${w.a},${w.b}`;
      const g = buildCorridorCellGeometry(THREE, corridor, w.a, w.b, w.seg, elevMin, 30, withHabitat);
      if (!g) continue; // data still on its way; the next plan queues it again
      built++;
      const existing = chunkMeshes.get(key);
      if (existing) {
        existing.mesh.geometry.dispose();
        existing.mesh.geometry = g;
        existing.seg = w.seg;
        continue;
      }
      const { ci, cj } = corridor.dataChunkForCell(w.a, w.b);
      const e = chunkTexEntry(ci, cj);
      e.refs++;
      const c = { a: w.a, b: w.b, ci, cj, seg: w.seg, texEntry: e, ready: false, disposed: false };
      c.mesh = new THREE.Mesh(g, makeChunkMaterial(e));
      c.mesh.receiveShadow = true;
      c.mesh.castShadow = false; // far terrain shadows come from the baked sun mask
      c.mesh.visible = false; // until its imagery arrives; the overview shows meanwhile
      chunkGroup.add(c.mesh);
      chunkMeshes.set(key, c);
      const show = () => {
        if (c.disposed) return;
        c.ready = true;
        c.mesh.visible = true;
        covDirty = true;
      };
      if (e.loaded || e.failed) show();
      else e.waiters.push(show);
    }
  }

  function updateCoverage(a, b) {
    const a0 = a - COV_N / 2;
    const b0 = b - COV_N / 2;
    if (!covDirty && a0 === covA0 && b0 === covB0) return;
    covA0 = a0;
    covB0 = b0;
    covDirty = false;
    covData.fill(0);
    for (const c of chunkMeshes.values()) {
      if (!c.ready) continue;
      const ia = c.a - a0;
      const ib = c.b - b0;
      if (ia < 0 || ib < 0 || ia >= COV_N || ib >= COV_N) continue;
      covData[(ib * COV_N + ia) * 4] = 255;
    }
    covTex.needsUpdate = true;
    covOriginU.value.set(-corridor.worldW / 2 + a0 * corridor.chunkW, -corridor.worldH / 2 + b0 * corridor.chunkH);
  }

  /** Per frame: stream data, (re)build a few meshes within a time budget, keep the cut-out mask current. */
  function updateCorridorChunks(px, pz, dt) {
    if (!corridor) return;
    const on = isGaleSite();
    chunkGroup.visible = on;
    terrainMat.userData.mm.uCovOn.value = on ? 1 : 0;
    if (!on) return;
    const { a, b } = corridor.sceneCellOf(px, pz);
    const cellKey = `${a},${b}`;
    chunkPlanT -= dt;
    if (chunkPlanT <= 0 || cellKey !== chunkPlanCell) {
      chunkPlanT = 0.25;
      chunkPlanCell = cellKey;
      planCorridorChunks(px, pz);
    }
    buildQueuedChunks(6);
    updateCoverage(a, b);
  }

  /** Drop every detail mesh so they are rebuilt (e.g. after the habitat pad moved). */
  function invalidateCorridorChunks() {
    for (const [key, c] of chunkMeshes) disposeChunk(key, c);
    chunkPlanT = 0;
  }

  /** Load the data around a point and build its meshes now (start of the EVA, teleports). */
  async function warmCorridorAt(px, pz) {
    if (!corridor || !isGaleSite()) return;
    await corridor.warmup(px, pz, 450, 6000);
    planCorridorChunks(px, pz);
    buildQueuedChunks(250);
    chunkPlanT = 0;
  }

  // ---------- stop markers: survey poles with a small lamp (Gale site only) ----------
  const galeStopsGroup = new THREE.Group();
  scene.add(galeStopsGroup);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5, metalness: 0.2 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.5 });
  const startLampMat = new THREE.MeshStandardMaterial({
    color: 0xfef3c7,
    emissive: 0xf59e0b,
    emissiveIntensity: 3.0,
  });
  if (stops?.features) {
    stops.features.forEach((f, idx) => {
      const [lon, lat] = f.geometry.coordinates;
      const sx = lonToX(lon);
      const sz = latToZ(lat);
      const sy = sampleElevSceneY(sx, sz);
      const isStart = idx === 0 || f.properties?.kind === "habitat";
      // You spawn on the start stop: no marker there (the 4.6 m pole stood as a white line in the view).
      if (isStart) return;
      const poleH = 0.45; // knee-high survey stake
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(isStart ? 0.032 : 0.025, isStart ? 0.038 : 0.025, poleH, 8),
        poleMat
      );
      pole.position.set(sx, sy + poleH * 0.5, sz);
      pole.castShadow = true;
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(isStart ? 0.1 : 0.07, 12, 8),
        isStart ? startLampMat : lampMat
      );
      lamp.position.set(sx, sy + poleH + (isStart ? 0.07 : 0.05), sz);
      galeStopsGroup.add(pole, lamp);
    });
  }
  const fieldKits = createFieldKits(THREE, stops, lonToX, latToZ, sampleElevSceneY);
  scene.add(fieldKits);
  const footsteps = createFootsteps(THREE, scene);

  // ---------- route ----------
  let activeRoute = route;
  let routeCoords = activeRoute?.geometry?.coordinates || [];
  let cumDist = buildCumulativeDistances(routeCoords);
  let geomTotalDist = cumDist[cumDist.length - 1] || 1;
  let totalDist = Number(activeRoute?.totals?.distance_m) > 0 ? Number(activeRoute.totals.distance_m) : geomTotalDist;
  let alongM = 0;

  const toGeomDist = (s) => (geomTotalDist > 0 && totalDist > 0 ? (s / totalDist) * geomTotalDist : s);

  function rebuildRouteRibbon(r) {
    activeRoute = r;
    routeCoords = r?.geometry?.coordinates || [];
    cumDist = buildCumulativeDistances(routeCoords);
    geomTotalDist = cumDist[cumDist.length - 1] || 1;
    totalDist = Number(activeRoute?.totals?.distance_m) > 0 ? Number(activeRoute.totals.distance_m) : geomTotalDist;
    // The route line is intentionally not drawn in the 3D view; the route data still drives the HUD.
    const scrubberEl = document.getElementById("hud-scrubber");
    if (scrubberEl) {
      scrubberEl.max = totalDist.toFixed(1);
      scrubberEl.value = alongM.toFixed(1);
    }
  }
  if (activeRoute) rebuildRouteRibbon(activeRoute);

  function routePoint(s) {
    const smp = sampleAlongRoute(routeCoords, cumDist, Math.max(0, Math.min(geomTotalDist, toGeomDist(s))));
    const x = lonToX(smp.lon);
    const z = latToZ(smp.lat);
    return { x, z, y: sampleElevSceneY(x, z), smp };
  }

  // The route is a loop (it ends back at the habitat), so search only near the last known
  // progress; otherwise the start would match the end of the loop.
  function nearestAlongRoute(x, z, prevRouteM) {
    if (routeCoords.length < 2) return 0;
    const prevG = toGeomDist(prevRouteM || 0);
    let best = Infinity;
    let bestS = 0;
    for (let i = 0; i < routeCoords.length - 1; i++) {
      if (cumDist[i + 1] < prevG - 80 || cumDist[i] > prevG + 80) continue;
      const ax = lonToX(routeCoords[i][0]);
      const az = latToZ(routeCoords[i][1]);
      const bx = lonToX(routeCoords[i + 1][0]);
      const bz = latToZ(routeCoords[i + 1][1]);
      const vx = bx - ax;
      const vz = bz - az;
      const len2 = vx * vx + vz * vz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / len2));
      const d = Math.hypot(ax + vx * t - x, az + vz * t - z);
      if (d < best) {
        best = d;
        bestS = cumDist[i] + (cumDist[i + 1] - cumDist[i]) * t; // geometry metres
      }
    }
    return geomTotalDist > 0 && totalDist > 0 ? (bestS / geomTotalDist) * totalDist : bestS;
  }

  function routeHeading(s) {
    const a = routePoint(s - 2);
    const b = routePoint(s + 4);
    return Math.atan2(-(b.x - a.x), -(b.z - a.z));
  }

  // ---------- astronauts (NASA 3D Resources, procedural rig) ----------
  let suitRig = null;
  let self = null;
  let partner = null;
  let suitLabel = "SUIT MODEL UNAVAILABLE";
  const makeStandInAvatar = (colorHex = 0xe9e7e2) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.32, ASTRONAUT_HEIGHT_M - 0.64, 6, 16),
      new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.7 })
    );
    body.position.y = ASTRONAUT_HEIGHT_M / 2;
    body.castShadow = true;
    g.add(body);
    return { group: g, update() {}, phase: 0, amount: 0, isStandIn: true };
  };
  const sharedDraco = new DRACOLoader();
  sharedDraco.setDecoderPath("./vendor/addons/libs/draco/gltf/");
  const sharedGltfLoader = new GLTFLoader();
  sharedGltfLoader.setDRACOLoader(sharedDraco);
  {
    for (const m of SUIT_MODELS) {
      try {
        const rig = await loadSuitRig(sharedGltfLoader, m.url, ASTRONAUT_HEIGHT_M);
        suitRig = rig;
        if (rig.bootBounds) footsteps.setSuitProfile(rig.bootBounds);
        self = createAstronaut(rig, { hideHead: true });
        suitLabel = m.label + " · RIGGED";
        break;
      } catch (err) {
        console.warn("suit model failed", m.url, err);
      }
    }
  }
  if (!self) {
    // Stand-in: a 1.80 m capsule, labelled in the HUD
    self = makeStandInAvatar();
    self.group.visible = false;
    suitLabel = "STAND-IN (MODEL NOT LOADED)";
  }
  scene.add(self.group); // single astronaut: you
  patchObjectRayTracer(THREE, self.group, rtUniforms, { reflectScale: 1.0 });

  const suitMatBaselines = [];
  self.group.traverse((obj) => {
    if (obj.isMesh && obj.material && !Array.isArray(obj.material)) {
      suitMatBaselines.push({
        mat: obj.material,
        normalMap: obj.material.normalMap || null,
        normalScale: obj.material.normalScale ? obj.material.normalScale.clone() : new THREE.Vector2(1, 1),
        roughness: obj.material.roughness ?? 0.65,
        metalness: obj.material.metalness ?? 0.05,
      });
    }
  });
  function applySuitRealism(enabled) {
    const weave = enabled ? ensureSuitWeaveNormal() : null;
    for (const entry of suitMatBaselines) {
      if (enabled) {
        if (!entry.normalMap) {
          entry.mat.normalMap = weave;
          entry.mat.normalScale?.set(0.32, 0.32);
        } else {
          entry.mat.normalScale?.set(
            Math.max(0.45, entry.normalScale.x * 1.45),
            Math.max(0.45, entry.normalScale.y * 1.45)
          );
        }
        entry.mat.roughness = Math.max(0.22, entry.roughness * 0.88);
      } else {
        entry.mat.normalMap = entry.normalMap;
        entry.mat.normalScale?.copy(entry.normalScale);
        entry.mat.roughness = entry.roughness;
      }
      entry.mat.needsUpdate = true;
    }
  }

  const roverMmsev = createExperimentalRover(THREE, "mmsev");
  const roverConcept = createExperimentalRover(THREE, "nasa_concept");
  const drivableRovers = [roverMmsev, roverConcept];
  let activeDriveRover = roverConcept;
  for (const r of drivableRovers) {
    r.group.visible = true;
    scene.add(r.group);
    patchObjectRayTracer(THREE, r.group, rtUniforms, { reflectScale: 1.18 });
  }
  roverMmsev.attachRealModel(sharedGltfLoader).then((ok) => {
    if (ok) patchObjectRayTracer(THREE, roverMmsev.group, rtUniforms, { reflectScale: 1.18 });
  });

  const historicRovers = createHistoricRoverManager(THREE, sharedGltfLoader, scene, {
    onModelLoaded: (grp) => patchObjectRayTracer(THREE, grp, rtUniforms, { reflectScale: 1.12 }),
  });
  const npcManager = createNpcManager(THREE, scene, {
    suitRig,
    createAstronautFn: createAstronaut,
    sampleElevY: sampleElevSceneY,
  });
  patchObjectRayTracer(THREE, npcManager.npcGroup, rtUniforms, { reflectScale: 0.95 });
  npcManager.npcGroup.visible = habitatStation.group.visible;

  let stationedAtHabitat = true;
  function stationDrivableRoversAtHabitat({ resetNpcAnchors = false } = {}) {
    const bays = habitatStation.getBayPlacements();
    for (const dp of bays.drivablePlacements) {
      const target = dp.vehicleType === "nasa_concept" ? roverConcept : roverMmsev;
      target.group.visible = habitatStation.group.visible;
      target.placeAt(dp.x, dp.z, dp.yaw, sampleElevSceneY);
      target.update(0.016, { sampleElevY: sampleElevSceneY, speed: 0, steer: 0, driving: false, physicsEnabled: false });

      // Static Anchor Rule: NPC 1 (MMSEV) & NPC 2 (NASA Concept) stay fixed at initial bay spots
      // even when the player enters and drives either rover away.
      const isConcept = dp.vehicleType === "nasa_concept";
      npcManager.anchorDrivableVehicleNpc(dp.vehicleType, dp.x, dp.z, dp.yaw, {
        standoffM: isConcept ? 4.4 : 3.9,
        sideOffsetM: isConcept ? -1.15 : 1.15,
        resetAnchor: resetNpcAnchors,
      });
    }
  }
  function stationRoversAtHabitat({ includeDrivable = true, resetNpcAnchors = false } = {}) {
    stationedAtHabitat = true;
    const bays = habitatStation.getBayPlacements();
    historicRovers.spawnAllScattered(bays.historicPlacements, {
      sampleElevY: sampleElevSceneY,
      focusId: activeSiteId,
    });
    if (includeDrivable) stationDrivableRoversAtHabitat({ resetNpcAnchors });
    npcManager.syncHistoricRoverNpcs(historicRovers, { sideOffsetM: 1.05 });

    // Pink Zone (Corridor) Info Screen NPCs are disabled until corridor info screens are built:
    // npcManager.spawnCorridorScreenNPCs({ scene, suitRig, sampleElevY: sampleElevSceneY });
    return bays.historicPlacements;
  }
  function reScatterHistoricRovers(originX = 0, originZ = 0) {
    stationedAtHabitat = false;
    const placements = scatterHistoricRoverCoords({
      sampleElevY: sampleElevSceneY,
      worldW,
      worldH,
      originX,
      originZ,
      minSepM: 56,
      maxSlopeDeg: 16,
    });
    historicRovers.spawnAllScattered(placements, {
      sampleElevY: sampleElevSceneY,
      focusId: activeSiteId,
    });
    npcManager.syncHistoricRoverNpcs(historicRovers, { bayCenter: { x: originX, z: originZ } });
    return placements;
  }
  stationRoversAtHabitat({ includeDrivable: true, resetNpcAnchors: true });

  const marsFx = createMarsFxSystem(scene, sampleElevSceneY);
  // rocket landing cinematic at the start of an EVA (landing-sequence.js); the lander stays as a landmark
  const landing = createLandingSequence(THREE, scene, { marsFx, sampleY: sampleElevSceneY });
  let landingHidNpcs = false;

  // ---------- contact shadows under the boots ----------
  // The sun shadow map gives the long cast shadow; this adds the dark, soft patch right under each
  // boot where almost no sky light reaches. It lies on the local slope and fades as the boot lifts.
  const contactTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, "rgba(0,0,0,0.85)");
    grad.addColorStop(0.45, "rgba(0,0,0,0.5)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const contactGeom = new THREE.PlaneGeometry(0.34, 0.5);
  contactGeom.rotateX(-Math.PI / 2);
  const contacts = [];
  for (const who of [self]) {
    const feet = who.bones ? [who.bones.footL, who.bones.footR] : [];
    for (const foot of feet) {
      if (!foot) continue;
      const mat = new THREE.MeshBasicMaterial({
        map: contactTex,
        color: 0x000000,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      });
      const m = new THREE.Mesh(contactGeom, mat);
      m.renderOrder = 2;
      scene.add(m);
      contacts.push({ who, foot, mesh: m });
    }
  }
  const footPos = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const qTilt = new THREE.Quaternion();
  const qYaw = new THREE.Quaternion();
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  function updateContactShadows() {
    for (const c of contacts) {
      c.mesh.visible = c.who.group.visible;
      if (!c.mesh.visible) continue;
      c.foot.getWorldPosition(footPos);
      const gy = sampleElevSceneY(footPos.x, footPos.z);
      const lift = Math.max(0, footPos.y - gy - 0.08); // ankle bone sits ~8 cm above the sole
      c.mesh.material.opacity = Math.max(0, 1 - lift / 0.35);
      const e = 0.3;
      nrm
        .set(
          sampleElevSceneY(footPos.x - e, footPos.z) - sampleElevSceneY(footPos.x + e, footPos.z),
          2 * e,
          sampleElevSceneY(footPos.x, footPos.z - e) - sampleElevSceneY(footPos.x, footPos.z + e)
        )
        .normalize();
      qTilt.setFromUnitVectors(Y_AXIS, nrm);
      qYaw.setFromAxisAngle(Y_AXIS, c.who.group.rotation.y);
      c.mesh.quaternion.copy(qTilt).multiply(qYaw);
      c.mesh.position.set(footPos.x, gy + 0.02, footPos.z);
      const sc = 1 + lift * 1.5;
      c.mesh.scale.set(sc, 1, sc);
    }
  }
  const suitEl = document.getElementById("hud-suit");
  if (suitEl) suitEl.textContent = suitLabel;

  // ---------- multiplayer remote crewmates & shared beacons ----------
  const remoteGroup = new THREE.Group();
  const pingGroup = new THREE.Group();
  scene.add(remoteGroup, pingGroup);
  const remoteAvatars = new Map();

  function makeCallsignSprite(text, colorCss = "#38bdf8") {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "rgba(0, 0, 0, 0.78)";
    ctx.fillRect(10, 12, 236, 40);
    ctx.strokeStyle = colorCss;
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 12, 236, 40);
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 22px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(text || "CREW").slice(0, 16), 128, 33);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(1.55, 0.39, 1);
    spr.position.set(0, 2.15, 0);
    return { spr, tex, mat };
  }

  function ensureRemoteAvatar(peer) {
    let entry = remoteAvatars.get(peer.id);
    if (entry) {
      if (peer.callsign && peer.callsign !== entry.callsign) {
        entry.group.remove(entry.badge.spr);
        entry.badge.tex.dispose();
        entry.badge.mat.dispose();
        entry.badge = makeCallsignBadgeFor(peer);
        entry.group.add(entry.badge.spr);
        entry.callsign = peer.callsign;
      }
      return entry;
    }
    const avatar = suitRig ? createAstronaut(suitRig) : makeStandInAvatar(peer.color || 0x38bdf8);
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.065, 10, 8),
      new THREE.MeshBasicMaterial({ color: peer.color || "#38bdf8" })
    );
    beacon.position.set(0, 1.88, 0.12);
    avatar.group.add(beacon);

    const badge = makeCallsignBadgeFor(peer);
    avatar.group.add(badge.spr);
    patchObjectRayTracer(THREE, avatar.group, rtUniforms, { reflectScale: 0.95 });
    remoteGroup.add(avatar.group);

    const st = peer.state || {};
    const sx = Number.isFinite(st.x) ? st.x : Number.isFinite(st.lon) ? lonToX(st.lon) : 0;
    const sz = Number.isFinite(st.z) ? st.z : Number.isFinite(st.lat) ? latToZ(st.lat) : 0;
    const sy = Number.isFinite(st.y) ? st.y : sampleElevSceneY(sx, sz);
    const syaw = Number.isFinite(st.yaw) ? st.yaw : 0;
    avatar.group.position.set(sx, sy, sz);
    avatar.group.rotation.y = syaw;

    entry = {
      id: peer.id,
      callsign: peer.callsign || "CREW",
      color: peer.color || "#38bdf8",
      avatar,
      group: avatar.group,
      beacon,
      badge,
      target: { x: sx, y: sy, z: sz, yaw: syaw, airborne: Boolean(st.airborne), speed: Number(st.speed) || 0 },
      cur: { x: sx, y: sy, z: sz, yaw: syaw },
    };
    remoteAvatars.set(peer.id, entry);
    updateCrewHudSummary();
    return entry;
  }

  function makeCallsignBadgeFor(peer) {
    return makeCallsignSprite(peer.callsign || "CREW", peer.color || "#38bdf8");
  }

  function removeRemoteAvatar(peerId) {
    const entry = remoteAvatars.get(peerId);
    if (!entry) return;
    remoteGroup.remove(entry.group);
    entry.beacon.geometry.dispose();
    entry.beacon.material.dispose();
    entry.badge.tex.dispose();
    entry.badge.mat.dispose();
    if (entry.avatar?.isStandIn) {
      entry.group.traverse((o) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
    }
    remoteAvatars.delete(peerId);
    updateCrewHudSummary();
  }

  function rebuildPingBeacons(pins = []) {
    while (pingGroup.children.length > 0) {
      const child = pingGroup.children.pop();
      child.traverse?.((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
    }
    for (const pin of pins) {
      if (!Number.isFinite(pin.lon) || !Number.isFinite(pin.lat)) continue;
      const x = lonToX(pin.lon);
      const z = latToZ(pin.lat);
      const y = sampleElevSceneY(x, z);
      const g = new THREE.Group();
      const col = pin.color || "#fbbf24";
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 6.0, 8),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.72 })
      );
      beam.position.set(0, 3.0, 0);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.04, 8, 24),
        new THREE.MeshBasicMaterial({ color: col })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, 0.12, 0);
      const badge = makeCallsignSprite(`${pin.by || "CREW"} PIN`, col);
      badge.spr.position.set(0, 3.2, 0);
      badge.spr.scale.set(1.7, 0.42, 1);
      g.add(beam, ring, badge.spr);
      g.position.set(x, y, z);
      pingGroup.add(g);
    }
  }

  function updateCrewHudSummary() {
    const crewEl = document.getElementById("hud-crew");
    const summaryEl = document.getElementById("hud-crew-summary");
    if (crewEl) {
      const cs = mp?.callsign || "AST-1";
      const txt = `${cs} · 1.80 M · ${suitLabel}`;
      if (crewEl.textContent !== txt) crewEl.textContent = txt;
    }
    if (summaryEl) {
      const gTxt = `MARS g ${surfaceG.toFixed(3)} M/S²`;
      if (remoteAvatars.size > 0) {
        summaryEl.textContent = `${gTxt} · CREW: ${1 + remoteAvatars.size} LIVE · ROOM ${mp?.room || "GALE-01"}`;
      } else {
        summaryEl.textContent = `${gTxt} · CREW: 2 (BUDDY EVA)`;
      }
    }
  }

  if (mp) {
    for (const p of mp.peers.values()) ensureRemoteAvatar(p);
    rebuildPingBeacons(mp.pins || []);
    mp.on("peerjoin", (peer) => ensureRemoteAvatar(peer));
    mp.on("peerstate", (peer) => {
      const entry = ensureRemoteAvatar(peer);
      const st = peer.state || {};
      const tx = Number.isFinite(st.x) ? st.x : Number.isFinite(st.lon) ? lonToX(st.lon) : entry.target.x;
      const tz = Number.isFinite(st.z) ? st.z : Number.isFinite(st.lat) ? latToZ(st.lat) : entry.target.z;
      const ty = Number.isFinite(st.y) ? st.y : sampleElevSceneY(tx, tz);
      entry.target = {
        x: tx,
        y: ty,
        z: tz,
        yaw: Number.isFinite(st.yaw) ? st.yaw : entry.target.yaw,
        airborne: Boolean(st.airborne),
        speed: Number(st.speed) || 0,
      };
    });
    mp.on("peerleave", (peer) => removeRemoteAvatar(peer.id));
    mp.on("pins", (pins) => rebuildPingBeacons(pins));
    mp.on("status", () => {
      const liveIds = new Set(mp.peers.keys());
      for (const pid of [...remoteAvatars.keys()]) {
        if (!liveIds.has(pid)) removeRemoteAvatar(pid);
      }
      updateCrewHudSummary();
    });
    updateCrewHudSummary();
  }

  // ---------- EVA floodlamp & optical visor pass (zero 3D helmet frame) ----------
  const evaLamp = new THREE.SpotLight(0xfff5e4, 0, 52, Math.PI * 0.25, 0.52, 1.25);
  evaLamp.castShadow = false;
  scene.add(evaLamp, evaLamp.target);
  let evaLampOn = false;
  let goldSlide = 0;

  const dummyDepthTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  dummyDepthTex.needsUpdate = true;
  let rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 });
  let rtSamples = 2;
  let rtHasDepth = false;
  let lastRtW = 1;
  let lastRtH = 1;
  const lensMat = new THREE.ShaderMaterial({
    vertexShader: LENS_VERT,
    fragmentShader: LENS_FRAG,
    depthTest: false,
    depthWrite: false,
    toneMapped: true,
    uniforms: {
      tDiffuse: { value: rt.texture },
      tDepth: { value: dummyDepthTex },
      uRtEnabled: rtUniforms.uRtEnabled,
      uRtQuality: rtUniforms.uRtQuality,
      uRtResScale: rtUniforms.uRtResScale,
      uRtMaxBounces: rtUniforms.uRtMaxBounces,
      uRtAoSamples: rtUniforms.uRtAoSamples,
      uRtSsrSteps: rtUniforms.uRtSsrSteps,
      uRtProj: { value: new THREE.Matrix4() },
      uRtInvProj: { value: new THREE.Matrix4() },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uDistort: { value: 0.14 },
      uFrameZoom: { value: 1.0 },
      uBezelScale: { value: 1.0 },
      uAberration: { value: 0.0014 },
      uGrain: { value: 0.008 },
      uVignette: { value: 0.72 },
      uExposure: { value: 1.0 },
      uGold: { value: 0 },
      uGoldSlide: { value: 0 },
      uDust: { value: 0.2 },
      uOptZoom: { value: 1 },
      uGlint: { value: 0 },
      uRay: { value: 0.00035 },
    },
  });
  const lensScene = new THREE.Scene();
  const lensCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const lensQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lensMat);
  lensQuad.frustumCulled = false;
  lensScene.add(lensQuad);

  // Collimated top-frame compass tape & elevation/pitch readouts
  const compassDegEl = document.getElementById("hud-compass-deg");
  const compassTapeEl = document.getElementById("hud-compass-tape");
  const compassStopEl = document.getElementById("hud-compass-stop");
  const compassSunEl = document.getElementById("hud-compass-sun");
  const pitchDegEl = document.getElementById("hud-pitch-deg");
  const elevMolaEl = document.getElementById("hud-elev-mola");
  const COMPASS_PX_PER_DEG = 4.0;
  const COMPASS_LABELS = new Map([
    [0, "N"],
    [45, "NE"],
    [90, "E"],
    [135, "SE"],
    [180, "S"],
    [225, "SW"],
    [270, "W"],
    [315, "NW"],
  ]);

  if (compassTapeEl) {
    compassTapeEl.innerHTML = "";
    for (let d = -90; d <= 450; d += 5) {
      const norm = ((d % 360) + 360) % 360;
      const major = norm % 15 === 0;
      const cardinal = COMPASS_LABELS.has(norm);
      const tick = document.createElement("div");
      tick.className = `c-tick${major ? " major" : ""}${cardinal ? " cardinal" : ""}`;
      tick.style.left = `${(d * COMPASS_PX_PER_DEG).toFixed(1)}px`;
      const bar = document.createElement("i");
      tick.appendChild(bar);
      if (major) {
        const lbl = document.createElement("span");
        lbl.textContent = cardinal ? COMPASS_LABELS.get(norm) : String(norm).padStart(3, "0");
        tick.appendChild(lbl);
      }
      compassTapeEl.appendChild(tick);
    }
  }

  function compassCardinalName(deg) {
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  }

  let lastCompassTxt = "";
  let lastPitchTxt = "";
  let lastMolaTxt = "";
  function updateWaveguideOptics(headingDeg, pitchDeg, elevMolaM, stopBearingDeg, sunBearingDeg) {
    const h = ((headingDeg % 360) + 360) % 360;
    if (compassTapeEl) {
      compassTapeEl.style.transform = `translate3d(${(-h * COMPASS_PX_PER_DEG).toFixed(1)}px, 0, 0)`;
    }
    const cTxt = `${String(Math.round(h) % 360).padStart(3, "0")}° ${compassCardinalName(h)}`;
    if (compassDegEl && cTxt !== lastCompassTxt) {
      lastCompassTxt = cTxt;
      compassDegEl.textContent = cTxt;
    }

    const placeMarker = (el, targetBearing) => {
      if (!el) return;
      if (!Number.isFinite(targetBearing)) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      const diff = ((targetBearing - h + 540) % 360) - 180;
      const clamped = Math.abs(diff) > 33;
      const px = Math.max(-33, Math.min(33, diff)) * COMPASS_PX_PER_DEG;
      el.style.transform = `translate3d(calc(-50% + ${px.toFixed(1)}px), 0, 0)`;
      el.classList.toggle("clamped", clamped);
    };
    placeMarker(compassStopEl, stopBearingDeg);
    placeMarker(compassSunEl, sunBearingDeg);

    const pRound = Math.round(pitchDeg);
    const pTxt = `${pRound > 0 ? "+" : ""}${pRound}°`;
    if (pitchDegEl && pTxt !== lastPitchTxt) {
      lastPitchTxt = pTxt;
      pitchDegEl.textContent = pTxt;
    }
    if (elevMolaEl && Number.isFinite(elevMolaM)) {
      const mTxt = `${Math.round(elevMolaM)} m MOLA`;
      if (mTxt !== lastMolaTxt) {
        lastMolaTxt = mTxt;
        elevMolaEl.textContent = mTxt;
      }
    }
  }

  // ---------- state & controls ----------
  let playing = false;
  let speedIdx = 0;
  const SPEEDS = [1, 2, 3];
  const freeRoam = true; // walking is always yours; the route is a guide line on the ground
  let userYaw = 0;
  let pitch = -0.1;
  let autoYaw = routeCoords.length > 1 ? routeHeading(0) : 0;
  const freePos = new THREE.Vector3(0, 0, 0);
  // Start overlooking the 5-Bay Mars Habitat Station, 2 drivable rovers, and 5 historic bays
  if (habitatStation.group.visible) {
    const ep = habitatStation.getBayPlacements().entryPoint;
    freePos.set(ep.x, 0, ep.z);
    userYaw = ep.yaw;
    autoYaw = 0;
  } else if (routeCoords.length > 1) {
    const p0 = routePoint(0);
    freePos.set(p0.x, 0, p0.z);
    userYaw = autoYaw;
    autoYaw = 0;
  }
  const partnerPos = new THREE.Vector3(freePos.x, 0, freePos.z);
  let partnerYaw = userYaw;
  const player = { x: 0, y: 0, z: 0, vy: 0, grounded: true, init: false };
  const phys = createMarsBody({ x: freePos.x, z: freePos.z, y: 0, grounded: true });
  const heightEnv = {
    sampleHeight: sampleElevSceneY,
    molaElevM: (x, z) => activeElevBaseM() + sampleElevSceneY(x, z),
  };
  function syncPlayerFromPhys() {
    player.x = phys.x;
    player.y = phys.y;
    player.z = phys.z;
    player.vy = phys.vy;
    player.grounded = phys.grounded;
    player.init = true;
    surfaceG = phys.g;
    freePos.set(phys.x, phys.y, phys.z);
  }
  function snapPhys(x, z) {
    phys.x = x;
    phys.z = z;
    phys.vx = 0;
    phys.vz = 0;
    phys.vy = 0;
    phys.grounded = true;
    phys.jumpQueued = false;
    phys.crouch = 0;
    phys.impactSpeed = 0;
    phys.accumulator = 0;
    phys.y = sampleElevSceneY(x, z);
    syncPlayerFromPhys();
    justTeleportedOrWrapped = true;
    lastMoveYaw = null;
  }
  let partnerS = PARTNER_AHEAD_M;
  let justTeleportedOrWrapped = false;
  let lastMoveYaw = null;
  let drivingRover = false;
  // hardware-site visit state (see "hardware sites + habitat <-> site transit" below)
  const hardwareGroup = new THREE.Group();
  hardwareGroup.name = "hardwareSite";
  scene.add(hardwareGroup);
  let hardwareSite = null;
  let transitBringRover = true;
  let transitPrompt = "";
  // [V] walking camera: helmet (first person) or over-the-shoulder (third person)
  let thirdPersonWalk = false;
  let thirdCamInit = false;
  const thirdCamPos = new THREE.Vector3();
  let roverThrottleVel = 0;
  let roverVelX = 0;
  let roverVelZ = 0;
  let roverSteer = 0;
  let prevRoverSteer = 0;
  let roverLandingImpact = 0;
  let roverAirState = {
    posY: null,
    velY: 0,
    prevGroundY: null,
    airborne: false,
    airTime: 0,
    peakLaunchVy: 0,
    landingCooldown: 0,
  };
  const roverDynState = {
    yaw: 0,
    yawRate: 0,
    velX: 0,
    velZ: 0,
    forwardSpeed: 0,
    lateralSpeed: 0,
    slipRatio: 0,
    gear: 1,
    rpmNorm: 0,
    drifting: false,
    braking: false,
    airPitchVel: 0,
    airRollVel: 0,
    airPitchOffset: 0,
    airRollOffset: 0,
    lastSlopePitch: 0,
  };
  function resetRoverMotionState() {
    roverThrottleVel = 0;
    roverVelX = 0;
    roverVelZ = 0;
    roverSteer = 0;
    prevRoverSteer = 0;
    roverLandingImpact = 0;
    roverAirState.posY = null;
    roverAirState.velY = 0;
    roverAirState.prevGroundY = null;
    roverAirState.airborne = false;
    roverAirState.airTime = 0;
    roverAirState.peakLaunchVy = 0;
    roverAirState.landingCooldown = 0;
    roverDynState.yaw = activeDriveRover?.group?.rotation?.y || 0;
    roverDynState.yawRate = 0;
    roverDynState.velX = 0;
    roverDynState.velZ = 0;
    roverDynState.forwardSpeed = 0;
    roverDynState.lateralSpeed = 0;
    roverDynState.slipRatio = 0;
    roverDynState.gear = 1;
    roverDynState.rpmNorm = 0;
    roverDynState.drifting = false;
    roverDynState.braking = false;
    roverDynState.airPitchVel = 0;
    roverDynState.airRollVel = 0;
    roverDynState.airPitchOffset = 0;
    roverDynState.airRollOffset = 0;
    roverDynState.lastSlopePitch = 0;
  }
  let roverWasOn = false;
  let nearRoverPrompted = false;
  let prevFirstPersonPitch = -0.12;
  let chaseCamInit = false;
  const chaseCamPos = new THREE.Vector3();
  const chaseLookTarget = new THREE.Vector3();
  let baseSunIntensity = 3.6;
  let roverDustAcc = 0;
  const keys = new Set();
  phys.y = sampleElevSceneY(phys.x, phys.z);
  syncPlayerFromPhys();
  justTeleportedOrWrapped = false;

  const hudView = document.getElementById("hud-view");
  const reticleEl = document.querySelector(".hud-reticle");
  const roverTargetEl = document.getElementById("hud-rover-target");
  const fleetBtnEl = document.getElementById("hud-fleet-btn");
  const fleetPanelEl = document.getElementById("hud-fleet-panel");
  const drvVehEl = document.getElementById("hud-drv-veh");
  const drvSpdEl = document.getElementById("hud-drv-spd");
  const drvGearEl = document.getElementById("hud-drv-gear");
  const drvRpmEl = document.getElementById("hud-drv-rpm");
  const drvSlipEl = document.getElementById("hud-drv-slip");
  const isMapOpen = () => false;
  const isHudActive = () => Boolean(hudView?.classList.contains("active"));
  const isPointerLocked = () => document.pointerLockElement === renderer.domElement;
  const hasOpenModalOverlay = () =>
    Boolean(
      document.querySelector(
        ".modal-backdrop.open, #npc-dialogue-modal.open, #crew-drawer.open, #esc-menu.open"
      )
    );

  const raycaster = new THREE.Raycaster();
  const rayNdc = new THREE.Vector2();
  const lastMouseClient = { x: 0, y: 0, valid: false };
  let hoveredRoverSpec = null;
  let hoveredNpcEntry = null;

  function setRaycasterFromView(clientX = null, clientY = null) {
    if (isPointerLocked() || clientX == null || clientY == null) {
      rayNdc.set(0, 0);
    } else {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      rayNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      rayNdc.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    }
    raycaster.setFromCamera(rayNdc, camera);
    return true;
  }

  function pickTargetNpc(clientX = null, clientY = null) {
    if (!npcManager.npcGroup.visible) return null;
    if (!setRaycasterFromView(clientX, clientY)) return null;
    return npcManager.pickNpc(raycaster, 38);
  }

  function pickHistoricRover(clientX = null, clientY = null) {
    const groups = historicRovers.getInteractiveGroups();
    if (!groups || groups.length === 0) return null;
    if (!setRaycasterFromView(clientX, clientY)) return null;
    const hits = raycaster.intersectObjects(groups, true);
    if (hits.length > 0 && hits[0].distance <= 115) {
      let obj = hits[0].object;
      while (obj && !obj.userData?.historicRoverId) obj = obj.parent;
      const rId = obj?.userData?.historicRoverId;
      return rId ? getHistoricRoverById(rId) : null;
    }
    return null;
  }

  function findNearestDrivableEntry(x, z, maxDistM = 5.8) {
    let best = null;
    let bestDist = maxDistM;
    for (const drvR of drivableRovers) {
      if (!drvR.group.visible) continue;
      const dist = Math.hypot(x - drvR.group.position.x, z - drvR.group.position.z);
      if (dist <= bestDist) {
        bestDist = dist;
        best = drvR;
      }
    }
    return best ? { rover: best, dist: bestDist } : null;
  }

  let manualUnlockPending = false;
  function releasePointerLock() {
    if (document.pointerLockElement) {
      manualUnlockPending = true;
      setTimeout(() => {
        manualUnlockPending = false;
      }, 140);
      try {
        document.exitPointerLock?.();
      } catch {}
    }
  }

  const npcDialogueUi = initNpcDialogueUi({
    onOpen: () => {
      keys.clear();
      dragging = false;
      releasePointerLock();
      roverTargetEl?.classList.remove("visible");
    },
    onClose: () => {
      keys.clear();
    },
    getLang: () => (isTrLang() ? "tr" : "en"),
  });

  function openNpcDialogueSafe(npcOrSpec) {
    if (!npcOrSpec) return;
    keys.clear();
    dragging = false;
    releasePointerLock();
    npcDialogueUi.openForNpc(npcOrSpec);
  }

  function openRoverInfoSafe(spec, opts = {}) {
    if (!spec) return;
    dragging = false;
    releasePointerLock();
    if (onOpenRoverInfo) onOpenRoverInfo(spec, opts);
    else dispatchOpenRoverInfo(spec.id);
  }

  function requestCrosshairLock() {
    if (!isHudActive() || isMapOpen() || hasOpenModalOverlay() || isPointerLocked()) return;
    try {
      const p = renderer.domElement.requestPointerLock?.();
      if (p?.catch) p.catch(() => {});
    } catch {}
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  renderer.domElement.addEventListener("pointerdown", (e) => {
    footsteps.resume();
    if (isMapOpen() || !isHudActive() || hasOpenModalOverlay()) return;
    if (fleetPanelEl?.classList.contains("open")) fleetPanelEl.classList.remove("open");
    if (e.button === 0) {
      const cx = isPointerLocked() ? null : e.clientX;
      const cy = isPointerLocked() ? null : e.clientY;
      const hitNpc = pickTargetNpc(cx, cy);
      if (hitNpc) {
        e.preventDefault?.();
        openNpcDialogueSafe(hitNpc);
        return;
      }
      const directHit = pickHistoricRover(cx, cy);
      if (directHit) {
        e.preventDefault?.();
        openRoverInfoSafe(directHit);
        return;
      }
      requestCrosshairLock();
    }
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener("pointerup", () => (dragging = false));
  document.addEventListener("pointerlockchange", () => {
    const locked = isPointerLocked();
    dragging = false;
    reticleEl?.classList.toggle("locked", locked);
    if (locked && (isMapOpen() || !isHudActive() || hasOpenModalOverlay())) {
      releasePointerLock();
      return;
    }
    // Pressing ESC while pointer-locked releases lock; open the ESC menu when HUD was active.
    if (!locked && !manualUnlockPending && isHudActive() && !isMapOpen() && !hasOpenModalOverlay()) {
      setTimeout(() => {
        if (
          !manualUnlockPending &&
          !isPointerLocked() &&
          isHudActive() &&
          !isMapOpen() &&
          !hasOpenModalOverlay() &&
          document.hasFocus() &&
          !document.hidden
        ) {
          keys.clear();
          openPauseMenu?.();
        }
      }, 25);
    }
  });
  if (hudView && typeof MutationObserver !== "undefined") {
    new MutationObserver(() => {
      if (!isHudActive()) {
        dragging = false;
        releasePointerLock();
      }
    }).observe(hudView, { attributes: true, attributeFilter: ["class"] });
  }
  document.addEventListener("mousemove", (e) => {
    lastMouseClient.x = e.clientX;
    lastMouseClient.y = e.clientY;
    lastMouseClient.valid = true;
    const locked = isPointerLocked();
    if (!locked && !dragging) return;
    if (landing.active) return;
    if (isMapOpen() || !isHudActive()) {
      dragging = false;
      if (locked) releasePointerLock();
      return;
    }
    const rawDx = locked ? e.movementX || 0 : e.clientX - lastX;
    const rawDy = locked ? e.movementY || 0 : e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    const dx = Math.abs(rawDx) > 320 ? 0 : rawDx;
    const dy = Math.abs(rawDy) > 320 ? 0 : rawDy;
    if (dx === 0 && dy === 0) return;
    const sensX = locked ? 0.0024 : 0.0035;
    const sensY = locked ? 0.0021 : 0.003;
    userYaw -= dx * sensX;
    const minPitch = drivingRover ? -1.08 : -1.35;
    const maxPitch = drivingRover ? -0.06 : 1.42;
    pitch = Math.max(minPitch, Math.min(maxPitch, pitch - dy * sensY));
  });
  const dropLocalPing = (label = "Science Beacon") => {
    if (!mp) return null;
    const x = player.init ? player.x : lonToX(routeCoords[0]?.[0] ?? 137.39);
    const z = player.init ? player.z : latToZ(routeCoords[0]?.[1] ?? -4.8);
    const lon = xToLon(x);
    const lat = zToLat(z);
    const elev = activeElevBaseM() + sampleElevSceneY(x, z);
    return mp.dropPing({ lon, lat, elevM: elev, label });
  };

  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener("blur", () => {
    keys.clear();
    dragging = false;
    releasePointerLock();
  });

  const btnPlay = document.getElementById("hud-play");
  const scrubber = document.getElementById("hud-scrubber");
  const btnSpeed = document.getElementById("hud-speed");
  const btnTex = document.getElementById("hud-tex");
  const btnFreeRoam = document.getElementById("hud-freeroam");
  const btnBack = document.getElementById("hud-back-planner");
  const btnPing = document.getElementById("hud-ping");
  const btnPov = document.getElementById("hud-pov-btn");
  const btnGold = document.getElementById("hud-gold-btn");
  const btnLamp = document.getElementById("hud-lamp-btn");
  const optGoldPill = document.getElementById("hud-opt-gold");
  const optLampPill = document.getElementById("hud-opt-lamp");
  const optZoomPill = document.getElementById("hud-opt-zoom");

  btnPing?.addEventListener("click", () => dropLocalPing("EVA Waypoint"));
  const openNextPov = () => {
    const stop = nextPovStop;
    const entry = povIndex?.stops?.find((s) => s.stop_id === stop?.properties?.id) || povIndex?.stops?.[0];
    if (entry) onOpenPov(entry);
  };
  btnPov?.addEventListener("click", openNextPov);
  const btnOrbit = document.getElementById("hud-orbit-btn");
  btnOrbit?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    releasePointerLock();
    onOpenOrbit?.();
  });

  btnBack?.addEventListener("click", () => {
    playing = false;
    if (btnPlay) btnPlay.textContent = "Play";
    openPauseMenu?.();
  });
  btnPlay?.addEventListener("click", () => {
    playing = !playing;
    btnPlay.textContent = playing ? "Pause" : "Play";
  });
  scrubber?.addEventListener("input", () => {
    alongM = parseFloat(scrubber.value) || 0;
  });
  btnSpeed?.addEventListener("click", () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    btnSpeed.textContent = `${SPEEDS[speedIdx]}x walk`;
  });

  // texture modes: relief (default), ortho, slope
  const TEX = [
    { tex: reliefTex, label: "relief" },
    { tex: orthoTex, label: "ortho" },
    { tex: slopeTex, label: "slope" },
  ];
  function setTexMode(i) {
    texMode = i;
    if (texMode === 0 && !reliefOk) texMode = 1;
    terrainMat.map = TEX[texMode].tex;
    terrainMat.needsUpdate = true;
    syncChunkMaterials();
    const b = document.getElementById("hud-tex");
    if (b) b.textContent = `Tex: ${TEX[texMode].label}`;
    return TEX[texMode].label;
  }
  btnTex?.addEventListener("click", () => setTexMode((texMode + 1) % TEX.length));

  // Wrap boundary helper: keeps coordinates inside one mirror period of the real terrain by wrapping opposite edges
  const wrapNoticeEl = document.getElementById("hud-wrap-notice");
  let wrapNoticeTimer = 0;
  function showWrapNotice(msg) {
    if (!wrapNoticeEl) return;
    wrapNoticeEl.textContent = msg;
    wrapNoticeEl.classList.add("visible");
    if (wrapNoticeTimer) clearTimeout(wrapNoticeTimer);
    wrapNoticeTimer = setTimeout(() => {
      wrapNoticeEl.classList.remove("visible");
    }, 2800);
  }

  function wrapSceneCoord(val, span) {
    const half = span * 0.5;
    let wrapped = false;
    let crossedNegToPos = false;
    let crossedPosToNeg = false;
    let out = val;
    while (out > half) {
      out -= span;
      wrapped = true;
      crossedPosToNeg = true;
    }
    while (out < -half) {
      out += span;
      wrapped = true;
      crossedNegToPos = true;
    }
    return { val: out, wrapped, crossedPosToNeg, crossedNegToPos };
  }

  /**
   * Performs a C^∞ seamless map-boundary loop across the exact mirror-symmetrical
   * terrain period (`2 * worldW`, `2 * worldH`), shifting camera chase target, player,
   * rover, active dust particles, and historic rovers together with ZERO snap/pop.
   */
  function applySeamlessWorldWrap(curX, curZ) {
    const periodX = worldW * 2;
    const periodZ = worldH * 2;
    const wx = wrapSceneCoord(curX, periodX);
    const wz = wrapSceneCoord(curZ, periodZ);
    if (!wx.wrapped && !wz.wrapped) {
      return { wrapped: false, x: curX, z: curZ, dx: 0, dz: 0, dirs: [] };
    }
    const dx = wx.val - curX;
    const dz = wz.val - curZ;

    phys.x += dx;
    phys.z += dz;
    phys.prevX += dx;
    phys.prevZ += dz;
    freePos.x += dx;
    freePos.z += dz;
    if (player.init) {
      player.x += dx;
      player.z += dz;
    }
    for (const drvR of drivableRovers) {
      drvR.group.position.x += dx;
      drvR.group.position.z += dz;
    }
    if (chaseCamInit) {
      chaseCamPos.x += dx;
      chaseCamPos.z += dz;
      chaseLookTarget.x += dx;
      chaseLookTarget.z += dz;
    }
    marsFx.shiftParticles(dx, dz);
    historicRovers.wrapAllRelativeTo(freePos.x, freePos.z, periodX, periodZ);

    const dirs = [];
    if (wx.crossedPosToNeg) dirs.push(isTrLang() ? "DOĞU ↔ BATI" : "EAST ↔ WEST");
    else if (wx.crossedNegToPos) dirs.push(isTrLang() ? "BATI ↔ DOĞU" : "WEST ↔ EAST");
    if (wz.crossedPosToNeg) dirs.push(isTrLang() ? "GÜNEY ↔ KUZEY" : "SOUTH ↔ NORTH");
    else if (wz.crossedNegToPos) dirs.push(isTrLang() ? "KUZEY ↔ GÜNEY" : "NORTH ↔ SOUTH");

    showWrapNotice(
      (isTrLang() ? "DÜNYA SINIRI DÖNGÜSÜ (KESİNTİSİZ): " : "SEAMLESS WORLD LOOP: ") + dirs.join(" · ")
    );
    return { wrapped: true, x: wx.val, z: wz.val, dx, dz, dirs };
  }

  // A new route from the planner (Begin EVA): stand at the Habitat apron facing the 5 bays, or along route.
  onSetRoute((detail) => {
    const newRoute = detail?.route;
    const nextAlong = Number(detail?.alongM ?? detail?.along_m ?? 0) || 0;
    rebuildRouteRibbon(newRoute);
    alongM = nextAlong;
    autoYaw = 0;
    if (routeCoords.length > 1) {
      const p = routePoint(alongM);
      if (alongM === 0 && habitatStation.group.visible) {
        const ep = habitatStation.getBayPlacements().entryPoint;
        userYaw = ep.yaw;
        partnerPos.set(ep.x, 0, ep.z);
        snapPhys(ep.x, ep.z);
        stationRoversAtHabitat({ includeDrivable: true, resetNpcAnchors: true });
      } else {
        userYaw = routeHeading(alongM);
        partnerPos.set(p.x, 0, p.z);
        snapPhys(p.x, p.z);
        if (devCfg.experimentalRover && activeDriveRover) {
          activeDriveRover.group.visible = true;
          activeDriveRover.spawnBeside(p.x, p.z, userYaw, sampleElevSceneY);
          roverDynState.yaw = activeDriveRover.group.rotation.y;
        }
      }
      drivingRover = false;
      resetRoverMotionState();
      chaseCamInit = false;
      syncDrivingCameraVisualState(false);
      if (self?.group) self.group.visible = suitRig != null;
      nearRoverPrompted = false;
    }
  });

  const viewLabelEl = document.getElementById("hud-view-label");

  function computeLocalSlopeDeg(x, z) {
    const hW = sampleElevSceneY(x - 2, z);
    const hE = sampleElevSceneY(x + 2, z);
    const hN = sampleElevSceneY(x, z - 2);
    const hS = sampleElevSceneY(x, z + 2);
    const grad = Math.hypot((hE - hW) / 4, (hS - hN) / 4);
    return Math.atan(grad) * (180 / Math.PI);
  }

  function teleportToLocal(tx, tz, { keepYaw = false } = {}) {
    const wx = wrapSceneCoord(tx, worldW * 2).val;
    const wz = wrapSceneCoord(tz, worldH * 2).val;
    const lon = xToLon(wx);
    const lat = zToLat(wz);

    const nearestGeomS = closestAlongM(routeCoords, cumDist, lon, lat);
    alongM = geomTotalDist > 0 ? (nearestGeomS / geomTotalDist) * totalDist : 0;

    snapPhys(wx, wz);

    autoYaw = 0;
    if (!keepYaw && routeCoords.length > 1) {
      const rp = routePoint(alongM);
      const distToRoute = Math.hypot(rp.x - wx, rp.z - wz);
      userYaw = distToRoute > 5 ? Math.atan2(-(rp.x - wx), -(rp.z - wz)) : routeHeading(alongM);
    }
    pitch = Math.max(-0.55, Math.min(0.25, keepYaw ? pitch : -0.06));
    followEndless({ x: player.x, y: player.y, z: player.z });
  }

  onTeleport(({ lon, lat }) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    visitLocation(lon, lat, { keepYaw: false });
  });

  function renderHudFleetPanel() {
    if (!fleetPanelEl) return;
    const tr = isTrLang();
    fleetPanelEl.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
      <span style="font-size:9.5px;letter-spacing:0.15em;color:var(--faint);text-transform:uppercase;">${
        tr ? "MARS ÜSSÜ & ROVER FİLOSU (7 ARAÇ)" : "MARS HABITAT & ROVER FLEET (7 VEHICLES)"
      }</span>
      <div style="display:flex;gap:4px;">
        <button id="hud-fleet-habitat" class="btn primary" type="button" style="padding:2px 7px;font-size:9px;">${
          tr ? "Üs Garajı" : "Habitat Bay"
        }</button>
        <button id="hud-fleet-rescatter" class="btn" type="button" style="padding:2px 7px;font-size:9px;">${
          tr ? "Karıştır" : "Rescatter"
        }</button>
      </div>
    </div>`;
    fleetPanelEl.querySelector("#hud-fleet-habitat")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      fleetPanelEl.classList.remove("open");
      if (drivingRover) {
        drivingRover = false;
        resetRoverMotionState();
        chaseCamInit = false;
        syncDrivingCameraVisualState(false);
        if (self?.group) self.group.visible = suitRig != null;
      }
      stationRoversAtHabitat({ includeDrivable: true, resetNpcAnchors: true });
      const ep = habitatStation.getBayPlacements().entryPoint;
      teleportToLocal(ep.x, ep.z, { keepYaw: true });
      autoYaw = 0;
      userYaw = ep.yaw;
      pitch = -0.08;
      renderHudFleetPanel();
      showWrapNotice(tr ? "MARS YAŞAM İSTASYONU · 5 BÖLGE + 7 ROVER" : "MARS HABITAT STATION · 5 ZONES + 7 ROVERS");
    });
    fleetPanelEl.querySelector("#hud-fleet-rescatter")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      reScatterHistoricRovers(freePos.x, freePos.z);
      renderHudFleetPanel();
      showWrapNotice(
        tr ? "5 NASA ROVER RASTGELE KONUMLARA YERLEŞTİRİLDİ" : "ALL 5 HISTORICAL ROVERS RESCATTERED ACROSS TERRAIN"
      );
    });

    const drivableHeader = document.createElement("div");
    drivableHeader.style.cssText =
      "font-size:9px;letter-spacing:0.14em;color:#38bdf8;margin-top:6px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.1);";
    drivableHeader.textContent = tr ? "SÜRÜLEBİLİR ARAÇLAR (2)" : "DRIVABLE ROVERS (2)";
    fleetPanelEl.appendChild(drivableHeader);

    for (const rInstance of [roverConcept, roverMmsev]) {
      const vSpec = rInstance.getActiveSpec();
      const dDist = `${Math.round(
        Math.hypot(rInstance.group.position.x - freePos.x, rInstance.group.position.z - freePos.z)
      )} m`;
      const row = document.createElement("div");
      row.className = `hud-fleet-row ${drivingRover && activeDriveRover === rInstance ? "current" : ""}`;
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:7px;min-width:0;">
          <span class="fleet-dot" style="background:${vSpec.badgeColor};"></span>
          <div style="min-width:0;">
            <div style="font-size:11px;color:#fff;letter-spacing:0.06em;">${
              tr ? vSpec.nameTr : vSpec.nameEn
            } <span style="color:var(--faint);font-size:9.5px;">· ${dDist}</span></div>
            <div style="font-size:9px;color:var(--faint);">${tr ? "Sürülebilir · [E] ile bin" : "Drivable · Press [E] to drive"}</div>
          </div>
        </div>
        <div style="display:flex;gap:5px;flex:none;">
          <button class="btn" type="button" data-drv-go style="padding:3px 7px;font-size:9.5px;">${
            tr ? "Git" : "Locate"
          }</button>
          <button class="btn primary" type="button" data-drv-drive style="padding:3px 7px;font-size:9.5px;">${
            tr ? "Sür" : "Drive"
          }</button>
        </div>
      `;
      row.querySelector("[data-drv-go]")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        fleetPanelEl.classList.remove("open");
        if (drivingRover) {
          drivingRover = false;
          resetRoverMotionState();
          chaseCamInit = false;
          syncDrivingCameraVisualState(false);
          if (self?.group) self.group.visible = suitRig != null;
        }
        const rx = rInstance.group.position.x;
        const rz = rInstance.group.position.z;
        const stand = computeSpawnBesideOffset(rx, rz, rInstance.group.rotation.y, -3.5, 1.5);
        teleportToLocal(stand.x, stand.z, { keepYaw: true });
        autoYaw = 0;
        userYaw = Math.atan2(-(rx - stand.x), -(rz - stand.z));
        activeDriveRover = rInstance;
        showWrapNotice(`${vSpec.shortLabel} · ${tr ? "BİNMEK İÇİN [E]" : "PRESS [E] TO DRIVE"}`);
      });
      row.querySelector("[data-drv-drive]")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        fleetPanelEl.classList.remove("open");
        rInstance.group.visible = true;
        activeDriveRover = rInstance;
        drivingRover = true;
        resetRoverMotionState();
        prevFirstPersonPitch = pitch;
        pitch = -0.25;
        autoYaw = 0;
        userYaw = rInstance.group.rotation.y;
        roverDynState.yaw = rInstance.group.rotation.y;
        chaseCamInit = false;
        syncDrivingCameraVisualState(true);
        if (drvVehEl) drvVehEl.textContent = vSpec.shortLabel;
        if (self?.group) self.group.visible = false;
        showWrapNotice(`${vSpec.shortLabel} · ${tr ? "3. ŞAHIS SÜRÜŞ AKTİF" : "3RD-PERSON DRIVE ACTIVE"}`);
      });
      fleetPanelEl.appendChild(row);
    }

    const histHeader = document.createElement("div");
    histHeader.style.cssText =
      "font-size:9px;letter-spacing:0.14em;color:#22c55e;margin-top:6px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.1);";
    histHeader.textContent = tr ? "GARAJ / TARİHİ ROVERLER (5)" : "GARAGE DISPLAY & HISTORIC ROVERS (5)";
    fleetPanelEl.appendChild(histHeader);

    MARS_HISTORIC_ROVERS.forEach((r, idx) => {
      const entry = historicRovers.getEntry(r.id);
      const distStr = entry
        ? `${Math.round(Math.hypot(entry.group.position.x - freePos.x, entry.group.position.z - freePos.z))} m`
        : "—";
      const bayTag = stationedAtHabitat ? `BAY 0${idx + 1} · ` : "";
      const row = document.createElement("div");
      row.className = `hud-fleet-row ${r.id === activeSiteId ? "current" : ""}`;
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:7px;min-width:0;">
          <span class="fleet-dot" style="background:${r.color};"></span>
          <div style="min-width:0;">
            <div style="font-size:11px;color:#fff;letter-spacing:0.08em;">${bayTag}${r.name} <span style="color:var(--faint);font-size:9.5px;">· ${distStr}</span></div>
            <div style="font-size:9px;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.siteShortName}</div>
          </div>
        </div>
        <div style="display:flex;gap:5px;flex:none;">
          <button class="btn" type="button" data-hud-info style="padding:3px 7px;font-size:9.5px;">${tr ? "Bilgi" : "Info"}</button>
          <button class="btn primary" type="button" data-hud-go style="padding:3px 7px;font-size:9.5px;">${
            tr ? "Yanına Git" : "Locate"
          }</button>
        </div>
      `;
      row.querySelector("[data-hud-info]")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        fleetPanelEl.classList.remove("open");
        openRoverInfoSafe(r);
      });
      row.querySelector("[data-hud-go]")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        fleetPanelEl.classList.remove("open");
        visitRoverSite(r.id, { approachRover: true, switchTerrain: false });
      });
      fleetPanelEl.appendChild(row);
    });
  }

  fleetBtnEl?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (!fleetPanelEl) return;
    releasePointerLock();
    const nextOpen = !fleetPanelEl.classList.contains("open");
    if (nextOpen) renderHudFleetPanel();
    fleetPanelEl.classList.toggle("open", nextOpen);
  });

  // ---------- active site & sun ----------
  let lastSunBakeMs = performance.now();
  /**
   * Recompute the sun for the active site and time mode and push it into every consumer.
   * `rebake` re-runs the terrain shadow ray-march (Gale only; ~100 ms) and rebuilds sky IBL.
   */
  function refreshSun({ rebake = false } = {}) {
    sunState = computeSunState();
    sunStateStampMs = performance.now();
    sunDir.set(sunState.x, sunState.y, sunState.z).normalize();
    sky.material.uniforms.uSunElev.value = sunState.elevationRad;
    sky.material.uniforms.uSunCos.value = Math.cos(sunState.sunAngularRad * 0.5);
    for (const moon of [phobos, deimos]) moon.material.uniforms.uSunElev.value = sunState.elevationRad;
    celestial.update(sunState);
    const up = sunUp(sunState.elevationRad);
    // Night: no direct sun, a faint sky/starlight floor so the ground stays readable.
    hemiLight.intensity = (devCfg.superGraphics ? 0.28 : 0.22) * (0.32 + 0.68 * up);
    renderer.toneMappingExposure = (devCfg.superGraphics ? 1.06 : 1.0) * (1 + 0.55 * (1 - up));
    if (rebake) {
      rebuildEnvironment();
      if (isGaleSite() && elevGrid) {
        const next = bakeSunMask();
        if (next) {
          const prev = sunMask;
          sunMask = next;
          sunMaskU.value = next;
          prev?.dispose?.();
        }
      }
      lastSunBakeMs = performance.now();
    }
    sunMaskOnU.value = isGaleSite() && sunMask ? 1 : 0;
    updateSunButton();
  }

  const btnSun = document.getElementById("hud-sun-btn");
  function updateSunButton() {
    if (!btnSun) return;
    const tr = isTrLang();
    const t = formatHoursHM(sunState.ltstHours);
    btnSun.textContent =
      sunMode === "local" ? (tr ? `Güneş: yerel ${t}` : `Sun: local ${t}`) : tr ? `Güneş: gündüz ${t}` : `Sun: day ${t}`;
    btnSun.title =
      sunMode === "local"
        ? "Real local true solar time at this site (Mars24). Click for fixed 15:00 daylight."
        : "Fixed 15:00 local solar time. Click for the real local time at this site.";
  }
  function setSunMode(mode) {
    sunMode = mode === "local" ? "local" : "day";
    refreshSun({ rebake: true });
    const tr = isTrLang();
    const lt = formatHoursHM(sunState.ltstHours);
    const night = sunState.elevationRad < 0;
    showWrapNotice(
      sunMode === "local"
        ? tr
          ? `GERÇEK YEREL GÜNEŞ SAATİ ${lt}${night ? " · GECE" : ""}`
          : `REAL LOCAL SOLAR TIME ${lt}${night ? " · NIGHT SIDE" : ""}`
        : tr
          ? `SABİT GÜNDÜZ IŞIĞI ${lt}`
          : `FIXED DAYLIGHT ${lt}`
    );
  }
  btnSun?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    setSunMode(sunMode === "local" ? "day" : "local");
  });
  updateSunButton();

  /** Swap the active terrain site (Gale HiRISE tile, a rover site, or an arbitrary orbit landing). */
  function switchSite(spec) {
    if (!spec || spec.id === activeSiteId) return false;
    clearHardwareSite();
    activeSiteRover = spec;
    activeSiteId = spec.id;
    historicRovers.setFocusId(spec.isCustomSite ? spec.nearRoverId : spec.id);
    const gale = isGaleSite();
    const showRovers = !spec.isCustomSite || Boolean(spec.nearRoverId);
    habitatStation.group.visible = showRovers;
    if (showRovers) {
      const habX = gale ? initRouteOriginX : 0;
      const habZ = gale ? initRouteOriginZ - ENTRY_OFFSET_Z : -ENTRY_OFFSET_Z;
      habitatStation.setBasePose(habX, habZ, rawSampleElevSceneY);
      invalidateCorridorChunks(); // detail meshes carry the habitat pad; rebuild them
    }
    for (const r of drivableRovers) r.group.visible = showRovers;
    npcManager.npcGroup.visible = showRovers;
    galeStopsGroup.visible = gale;
    fieldKits.visible = Boolean(devCfg.superGraphics) && gale;
    galeVista.visible = Boolean(devCfg.superGraphics) && gale;
    const nextMain = buildTerrainGeometry(fullSeg, fullSegZ);
    const nextCopy = buildTerrainGeometry(copySeg, copySegZ);
    terrainMesh.geometry = nextMain;
    for (const child of endless.children) {
      if (child.isMesh) {
        child.geometry = child === endless.userData.centre ? nextMain : nextCopy;
      }
    }
    terrainGeom.dispose();
    copyGeom.dispose();
    terrainGeom = nextMain;
    copyGeom = nextCopy;

    if (gale) {
      terrainMat.color.setHex(0xffffff);
      HORIZON.setRGB(0.62, 0.43, 0.3);
      scene.fog.color.copy(HORIZON);
    } else {
      const pal = spec.terrainProfile?.palette;
      if (pal?.dust) {
        terrainMat.color.setRGB(
          Math.min(1, pal.dust[0] / 155),
          Math.min(1, pal.dust[1] / 100),
          Math.min(1, pal.dust[2] / 72)
        );
      }
      if (pal?.skyHorizon) {
        HORIZON.setRGB(pal.skyHorizon[0], pal.skyHorizon[1], pal.skyHorizon[2]);
        scene.fog.color.copy(HORIZON);
      }
    }
    // At Gale and NASA rover sites, station the 5-Bay Habitat Garage & 7 vehicles on the terrain.
    if (showRovers) stationRoversAtHabitat({ includeDrivable: true, resetNpcAnchors: true });
    else historicRovers.clearAll();
    if (fleetBtnEl) fleetBtnEl.textContent = showRovers ? `Rovers: ${spec.name} (7)` : "Rovers (7)";

    sunSite.lat = spec.lat;
    sunSite.lon = spec.lon;
    refreshSun({ rebake: true });
    refreshRtHeightfield();
    return true;
  }

  /**
   * Put the walker at any lat/lon on Mars. Inside the Gale HiRISE tile this is a precise teleport onto the
   * real DTM; anywhere else the site switches to seeded procedural relief centred on that point.
   */
  function visitLocation(lon, lat, { keepYaw = true, sun = null } = {}) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    if (sun === "local" || sun === "day") sunMode = sun;
    if (drivingRover) {
      drivingRover = false;
      resetRoverMotionState();
      chaseCamInit = false;
      syncDrivingCameraVisualState(false);
      if (self?.group) self.group.visible = suitRig != null;
    }
    if (insideGaleTile(lon, lat)) {
      const changed = switchSite(getHistoricRoverById("curiosity"));
      if (!changed) {
        sunSite.lat = lat;
        sunSite.lon = lon;
        refreshSun({ rebake: true });
      }
      teleportToLocal(lonToX(lon), latToZ(lat), { keepYaw });
    } else {
      const spec = makeCustomSiteSpec(lon, lat);
      // Force a rebuild even when landing twice on the same rounded point.
      if (spec.id === activeSiteId) activeSiteId = null;
      switchSite(spec);
      teleportToLocal(0, 0, { keepYaw: true });
    }
    renderHudFleetPanel();
    const tr = isTrLang();
    const lt = formatHoursHM(sunState.ltstHours);
    const where = isGaleSite() ? "GALE · HiRISE DTM" : tr ? "PROSEDÜREL ARAZİ" : "PROCEDURAL RELIEF";
    showWrapNotice(
      `${formatLatLonShort(lat, lon)} · ${where} · LTST ${lt}${sunState.elevationRad < 0 ? (tr ? " · GECE" : " · NIGHT") : ""}`
    );
  }

  function formatLatLonShort(lat, lon) {
    return `${Math.abs(lat).toFixed(2)}°${lat < 0 ? "S" : "N"} ${(((lon % 360) + 360) % 360).toFixed(2)}°E`;
  }

  function visitRoverSite(roverId, { approachRover = true, switchTerrain = false } = {}) {
    const spec = getHistoricRoverById(roverId) || getHistoricRoverById("curiosity");
    if (!spec) return;
    if (switchTerrain && spec.id !== activeSiteId) {
      switchSite(spec);
    } else if (!activeSiteRover?.isCustomSite) {
      historicRovers.setFocusId(spec.id);
    }

    let entry = historicRovers.getEntry(spec.id);
    if (!entry) {
      reScatterHistoricRovers(freePos.x, freePos.z);
      entry = historicRovers.getEntry(spec.id);
    }
    const rx = entry?.group?.position?.x ?? 0;
    const rz = entry?.group?.position?.z ?? 0;
    const rYaw = entry?.group?.rotation?.y ?? -0.35;

    if (approachRover) {
      if (drivingRover) {
        drivingRover = false;
        resetRoverMotionState();
        chaseCamInit = false;
        syncDrivingCameraVisualState(false);
        if (self?.group) self.group.visible = suitRig != null;
      }
      if (!freeRoam && btnFreeRoam) btnFreeRoam.click();
      const standDist = spec.lengthM < 1 ? 2.6 : 5.4;
      const cosRY = Math.cos(rYaw);
      const sinRY = Math.sin(rYaw);
      const standLx = -standDist * 0.45;
      const standLz = -standDist * 0.88;
      const standX = wrapSceneCoord(rx + standLx * cosRY + standLz * sinRY, worldW * 2).val;
      const standZ = wrapSceneCoord(rz - standLx * sinRY + standLz * cosRY, worldH * 2).val;
      teleportToLocal(standX, standZ, { keepYaw: true });
      autoYaw = 0;
      userYaw = Math.atan2(-(rx - standX), -(rz - standZ));
      pitch = -0.09;

      if (devCfg.experimentalRover && activeDriveRover?.group?.visible && !stationedAtHabitat) {
        activeDriveRover.spawnBeside(standX, standZ, userYaw + Math.PI * 0.5, sampleElevSceneY);
        roverDynState.yaw = activeDriveRover.group.rotation.y;
      }
    }

    if (fleetBtnEl) fleetBtnEl.textContent = `Rovers: ${spec.name} (7)`;
    renderHudFleetPanel();
    const tr = isTrLang();
    showWrapNotice(
      tr
        ? `${spec.siteShortName} · ${spec.name.toUpperCase()} (${spec.mission}) — BİLGİ İÇİN TIKLA`
        : `${spec.siteShortName} · ${spec.name.toUpperCase()} (${spec.mission}) — CLICK ROVER FOR INFO`
    );
  }

  // ---------- hardware sites + habitat <-> site transit ----------
  // The Transit Terminal (hologram table in the Pink Corridor) opens the Site Deployment Selector.
  // Deploying switches to seeded procedural relief centred on the unit's listed coordinates, with
  // the scale model at the origin and a staging pad STAGING_PAD_DISTANCE_M to the south.

  function clearHardwareSite() {
    if (!hardwareSite) return;
    for (const child of [...hardwareGroup.children]) {
      hardwareGroup.remove(child);
      child.traverse?.((o) => {
        if (o.isMesh) {
          o.geometry?.dispose?.();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            m?.map?.dispose?.();
            m?.dispose?.();
          }
        }
      });
    }
    hardwareSite = null;
  }

  function leaveRoverForTransit() {
    if (!drivingRover) return;
    drivingRover = false;
    resetRoverMotionState();
    chaseCamInit = false;
    syncDrivingCameraVisualState(false);
    if (self?.group) self.group.visible = suitRig != null;
  }

  function deployToHardwareSite(hwId, { bringRover = transitBringRover } = {}) {
    const hw = getSurfaceHardwareById(hwId);
    if (!hw) return false;
    closeTransitPanel();
    leaveRoverForTransit();
    if (!freeRoam && btnFreeRoam) btnFreeRoam.click();
    const spec = makeHardwareSiteSpec(hw);
    if (spec.id === activeSiteId) activeSiteId = null; // rebuild even when re-deploying to the same unit
    switchSite(spec);

    const tr = isTrLang();
    const padX = 0;
    const padZ = STAGING_PAD_DISTANCE_M;
    let radius = Math.max(hw.lengthM, hw.widthM) * 0.5;
    let landerObj = null;
    if (hw.kind === "rover") {
      historicRovers.spawnForSite(getHistoricRoverById(hw.id), { x: 0, z: 0, yaw: Math.PI, sampleElevY: sampleElevSceneY });
    } else {
      landerObj = buildLanderById(THREE, hw.id);
      if (landerObj) {
        landerObj.position.set(0, sampleElevSceneY(0, 0), 0);
        hardwareGroup.add(landerObj);
        radius = 0.95;
      }
    }
    if (hw.companion?.id === "ingenuity") {
      const heli = buildIngenuity(THREE);
      heli.position.set(5.5, sampleElevSceneY(5.5, 2.5), 2.5);
      heli.rotation.y = 0.6;
      hardwareGroup.add(heli);
    }
    const beaconX = Math.max(hw.lengthM, hw.widthM) * 0.5 + 1.8;
    const beacon = buildInfoBeacon(THREE, hw, { tr });
    beacon.position.set(beaconX, sampleElevSceneY(beaconX, 2.0), 2.0);
    hardwareGroup.add(beacon);
    const pad = buildReturnPad(THREE, { tr });
    pad.position.set(padX, sampleElevSceneY(padX, padZ), padZ);
    hardwareGroup.add(pad);
    hardwareSite = { hw, beacon, pad, padX, padZ, beaconX, beaconZ: 2.0, radius, isLander: Boolean(landerObj) };

    teleportToLocal(padX, padZ + 0.8, { keepYaw: true });
    autoYaw = 0;
    userYaw = 0; // face north, towards the hardware
    pitch = -0.05;
    thirdCamInit = false;

    for (const r of drivableRovers) r.group.visible = false;
    if (bringRover && activeDriveRover?.group) {
      activeDriveRover.group.visible = true;
      activeDriveRover.spawnBeside(padX + 2.2, padZ + 2.0, Math.PI * 0.5, sampleElevSceneY);
      roverDynState.yaw = activeDriveRover.group.rotation.y;
      stationedAtHabitat = false;
    }
    if (fleetBtnEl) fleetBtnEl.textContent = `Site: ${hw.name}`;
    showWrapNotice(
      tr
        ? `${hw.name.toUpperCase()} · ${formatHardwareLatLon(hw)} · PROSEDÜREL ARAZİ · [H] ÜSSE DÖN`
        : `${hw.name.toUpperCase()} · ${formatHardwareLatLon(hw)} · PROCEDURAL RELIEF · [H] RETURN TO HABITAT`
    );
    return true;
  }

  function returnToHabitat() {
    closeTransitPanel();
    leaveRoverForTransit();
    if (!freeRoam && btnFreeRoam) btnFreeRoam.click();
    const gale = getHistoricRoverById("curiosity");
    if (activeSiteId !== gale.id) switchSite(gale);
    else clearHardwareSite();
    const pt = habitatStation.getTransitPoints();
    teleportToLocal(pt.arrival.x, pt.arrival.z, { keepYaw: true });
    autoYaw = 0;
    userYaw = pt.arrival.yaw;
    pitch = -0.05;
    thirdCamInit = false;
    renderHudFleetPanel();
    if (fleetBtnEl) fleetBtnEl.textContent = "Rovers (7)";
    showWrapNotice(isTrLang() ? "MARS ÜSSÜ · PEMBE KORİDOR · TRANSİT TERMİNALİ" : "MARS HABITAT · PINK CORRIDOR · TRANSIT TERMINAL");
  }

  // Site Deployment Selector / site info card (DOM panel over the visor)
  const transitPanelEl = document.createElement("div");
  transitPanelEl.id = "hud-transit-panel";
  transitPanelEl.className = "hud-transit-panel";
  transitPanelEl.setAttribute("role", "dialog");
  hudView.appendChild(transitPanelEl);
  const transitPanelIsOpen = () => transitPanelEl.classList.contains("open");
  function closeTransitPanel() {
    transitPanelEl.classList.remove("open");
  }
  function openTransitPanel({ infoId = null } = {}) {
    const tr = isTrLang();
    releasePointerLock();
    keys.clear();
    const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const here = hardwareSite?.hw?.id || null;
    const info = infoId ? getSurfaceHardwareById(infoId) : null;
    let body = "";
    if (info) {
      body = `<div class="tp-card">
        <div class="tp-name">${esc(info.name)}</div>
        <div class="tp-meta">${esc(info.mission)} · ${esc(info.agency)} · ${esc(info.years)}</div>
        <dl>
          <dt>${tr ? "Konum" : "Location"}</dt><dd>${esc(info.site)}<br/>${esc(formatHardwareLatLon(info))}</dd>
          <dt>${tr ? "Boyut (U × G × Y)" : "Size (L × W × H)"}</dt><dd>${esc(formatHardwareDims(info))}</dd>
          <dt>${tr ? "Kütle" : "Mass"}</dt><dd>${info.massKg.toLocaleString("en-US")} kg</dd>
          ${
            info.companion
              ? `<dt>${esc(info.companion.name)}</dt><dd>${info.companion.fuselageM.join(" × ")} m ${tr ? "gövde" : "fuselage"} · ${info.companion.rotorSpanM} m rotor · ${info.companion.heightM} m · ${info.companion.massKg} kg</dd>`
              : ""
          }
        </dl>
        <p>${esc(tr ? info.noteTr : info.noteEn)}</p>
        <p class="tp-note">${
          tr
            ? "Ölçekli prosedürel model. Arazi tohumlanmış prosedürel yükseltidir, haritalanmış topoğrafya değildir."
            : "Procedural scale model. The ground here is seeded procedural relief, not mapped topography."
        } <a href="${esc(info.nasaUrl)}" target="_blank" rel="noopener">NASA</a></p>
        <div class="tp-actions">
          ${here ? `<button class="btn primary" data-act="return" type="button">${tr ? "Üsse dön [H]" : "Return to habitat [H]"}</button>` : ""}
          <button class="btn" data-act="list" type="button">${tr ? "Tüm sahalar" : "All sites"}</button>
        </div>
      </div>`;
    } else {
      const rows = MARS_SURFACE_HARDWARE.map(
        (h, i) => `<button class="tp-row${h.id === here ? " current" : ""}" data-hw="${h.id}" type="button">
          <span class="tp-key">${i + 1}</span>
          <span class="tp-main"><b>${esc(h.name)}</b><i>${esc(h.mission)} · ${esc(h.years)} · ${h.kind === "rover" ? (tr ? "gezgin" : "rover") : tr ? "iniş aracı" : "lander"}</i></span>
          <span class="tp-coord">${esc(formatHardwareLatLon(h))}<i>${esc(h.site)}</i></span>
          <span class="tp-dim">${esc(formatHardwareDims(h))}<i>${h.massKg.toLocaleString("en-US")} kg</i></span>
          <span class="tp-go">${h.id === here ? (tr ? "BURADASIN" : "HERE") : tr ? "IŞINLA ▸" : "DEPLOY ▸"}</span>
        </button>`
      ).join("");
      const drv = activeDriveRover?.getActiveSpec?.();
      body = `<div class="tp-rows">${rows}</div>
        <label class="tp-check"><input type="checkbox" data-act="bring" ${transitBringRover ? "checked" : ""}/> ${
          tr ? "Aktif aracı da getir" : "Bring the active rover"
        }${drv ? ` (${esc(drv.shortLabel)})` : ""}</label>
        <p class="tp-note">${
          tr
            ? "Hazırlık pisti donanımdan 15 m uzaktadır. Koordinatlar yayımlanmış iniş noktalarıdır; saha arazisi prosedüreldir (haritalanmış topoğrafya değil)."
            : "Staging pad is 15 m from the hardware. Coordinates are the published landing sites; site terrain is procedural relief, not mapped topography."
        }</p>
        ${here ? `<div class="tp-actions"><button class="btn primary" data-act="return" type="button">${tr ? "Üsse dön [H]" : "Return to habitat [H]"}</button></div>` : ""}`;
    }
    transitPanelEl.innerHTML = `<div class="tp-head">
        <span>${info ? (tr ? "SAHA BİLGİSİ" : "SITE INFO") : tr ? "NASA SAHA KONUŞLANMA SEÇİCİ" : "NASA SITE DEPLOYMENT SELECTOR"}</span>
        <button class="btn" data-act="close" type="button">${tr ? "Kapat [Esc]" : "Close [Esc]"}</button>
      </div>${body}`;
    transitPanelEl.classList.add("open");
  }
  transitPanelEl.addEventListener("click", (ev) => {
    const row = ev.target.closest?.("[data-hw]");
    if (row) {
      ev.stopPropagation();
      deployToHardwareSite(row.dataset.hw);
      return;
    }
    const act = ev.target.closest?.("[data-act]")?.dataset.act;
    if (!act) return;
    ev.stopPropagation();
    if (act === "close") closeTransitPanel();
    else if (act === "return") returnToHabitat();
    else if (act === "list") openTransitPanel();
    else if (act === "bring") transitBringRover = Boolean(ev.target.checked);
  });

  /** What [E] would do here: "terminal", "return", "info" or null. */
  function transitTargetNearby() {
    if (drivingRover) return null;
    if (hardwareSite) {
      const s = hardwareSite;
      if (Math.hypot(freePos.x - s.padX, freePos.z - s.padZ) < 3.0) return "return";
      if (Math.hypot(freePos.x - s.beaconX, freePos.z - s.beaconZ) < 2.6) return "info";
      if (Math.hypot(freePos.x, freePos.z) < s.radius + 3.2) return "info";
      return null;
    }
    if (habitatStation.group.visible) {
      const t = habitatStation.getTransitPoints().terminal;
      if (Math.hypot(freePos.x - t.x, freePos.z - t.z) < 3.0) return "terminal";
    }
    return null;
  }
  function tryTransitInteract() {
    const target = transitTargetNearby();
    if (target === "terminal") openTransitPanel();
    else if (target === "return") returnToHabitat();
    else if (target === "info") openTransitPanel({ infoId: hardwareSite.hw.id });
    return Boolean(target);
  }
  /** Per frame: spin the markers, keep the walker out of a lander, and show the [E] prompt once. */
  function updateTransit(dt) {
    if (hardwareSite) {
      const s = hardwareSite;
      if (s.beacon.userData.ring) s.beacon.userData.ring.rotation.z += dt * 1.6;
      if (s.pad.userData.halo) s.pad.userData.halo.rotation.y += dt * 1.8;
      if (s.pad.userData.core) s.pad.userData.core.rotation.y -= dt * 2.4;
      if (s.isLander && !drivingRover) {
        const d = Math.hypot(freePos.x, freePos.z);
        const minD = s.radius + 0.35;
        if (d < minD && d > 1e-4) {
          freePos.x *= minD / d;
          freePos.z *= minD / d;
          phys.x = freePos.x;
          phys.z = freePos.z;
        }
      }
    }
    const target = transitPanelIsOpen() ? transitPrompt : transitTargetNearby() || "";
    if (target !== transitPrompt) {
      transitPrompt = target;
      const tr = isTrLang();
      if (target === "terminal") showWrapNotice(tr ? "TRANSİT TERMİNALİ · SAHA SEÇİCİ İÇİN [E]" : "TRANSIT TERMINAL · PRESS [E] FOR SITE SELECTOR");
      else if (target === "return") showWrapNotice(tr ? "DÖNÜŞ FENERİ · ÜSSE DÖNMEK İÇİN [E] / [H]" : "RETURN BEACON · PRESS [E] / [H] TO RETURN TO HABITAT");
      else if (target === "info") showWrapNotice(tr ? `${hardwareSite.hw.name.toUpperCase()} · BİLGİ İÇİN [E]` : `${hardwareSite.hw.name.toUpperCase()} · PRESS [E] FOR INFO`);
    }
  }

  onVisitRoverSite((detail) => {
    if (detail?.roverId) visitRoverSite(detail.roverId, { approachRover: true, switchTerrain: true });
  });
  if (fleetBtnEl) fleetBtnEl.textContent = `Rovers (7)`;
  renderHudFleetPanel();

  let goldVisor = 0;
  let optZoom = 1;
  let arrival = null; // { t0, reduced } while the orbit arrival drop plays
  let nextPovStop = null;

  let optRtPill = document.getElementById("hud-opt-rt");
  if (!optRtPill && optZoomPill?.parentElement && typeof document !== "undefined") {
    optRtPill = document.createElement("span");
    optRtPill.id = "hud-opt-rt";
    optRtPill.className = "dim";
    optRtPill.style.cursor = "pointer";
    optRtPill.title = "Cycle Ray Tracing Quality Tier (R)";
    optZoomPill.parentElement.appendChild(optRtPill);
  }

  function syncOpticsOverlayUi() {
    const visorOverlay = document.getElementById("visor-overlay") || document.querySelector(".visor-overlay");
    const goldOn = goldVisor > 0.5;
    if (visorOverlay) {
      visorOverlay.classList.toggle("gold-deployed", goldOn);
      visorOverlay.classList.toggle("zoom-active", optZoom > 1);
    }
    if (btnGold) {
      btnGold.textContent = goldOn ? "Gold: ON (G)" : "Gold (G)";
      btnGold.classList.toggle("is-gold", goldOn);
    }
    if (btnLamp) {
      btnLamp.textContent = evaLampOn ? "Flashlight: ON (F)" : "Flashlight (F)";
      btnLamp.classList.toggle("is-active", evaLampOn);
    }
    if (optGoldPill) {
      optGoldPill.textContent = goldOn ? "VISOR: GOLD" : "VISOR: CLR";
      optGoldPill.classList.toggle("gold", goldOn);
    }
    if (optLampPill) {
      optLampPill.textContent = evaLampOn ? "LIGHT: ON" : "LIGHT: OFF";
      optLampPill.classList.toggle("active", evaLampOn);
    }
    if (optZoomPill) {
      optZoomPill.textContent = `MAG: ${optZoom}×`;
      optZoomPill.classList.toggle("active", optZoom > 1);
    }
    if (optRtPill) {
      const rtPreset = getRayTracingPreset(devCfg);
      optRtPill.textContent = rtPreset.hudPill;
      optRtPill.classList.toggle("active", rtPreset.enabled > 0);
    }
  }

  function cycleRayTracingTier() {
    const nextRt = cycleRayTracingMode(devCfg);
    const nextCfg = saveDevSettings(nextRt);
    applyDevSettings(nextCfg);
    const preset = getRayTracingPreset(nextCfg);
    showWrapNotice(`RAY TRACING: ${isTrLang() ? preset.hudLabelTr : preset.hudLabelEn}`);
  }

  function toggleGoldVisor() {
    goldVisor = goldVisor > 0.5 ? 0 : 1;
    syncOpticsOverlayUi();
  }

  function toggleHelmetLamp() {
    evaLampOn = !evaLampOn;
    syncOpticsOverlayUi();
  }

  function cycleOpticalZoom() {
    optZoom = optZoom === 1 ? 3 : optZoom === 3 ? 8 : 1;
    const reticle = document.getElementById("hud-zoom-reticle");
    const readout = document.getElementById("hud-zoom-readout");
    if (reticle) reticle.hidden = optZoom === 1;
    if (readout) readout.textContent = `${optZoom}×`;
    syncOpticsOverlayUi();
  }

  btnGold?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    toggleGoldVisor();
  });
  btnLamp?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    toggleHelmetLamp();
  });
  optRtPill?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    cycleRayTracingTier();
  });
  syncOpticsOverlayUi();

  window.addEventListener("keydown", (e) => {
    if (!hudView.classList.contains("active")) return;
    if (landing.active) {
      // any key skips the landing cinematic; the others do nothing meanwhile
      e.preventDefault();
      if (!e.repeat) landing.skip();
      return;
    }
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
    const modalOpen = document.getElementById("modal-backdrop")?.classList.contains("open");
    const crewOpen = document.getElementById("crew-drawer")?.classList.contains("open");
    const escMenuOpen = document.getElementById("esc-menu")?.classList.contains("open");
    const menuOpen = !document.getElementById("start-screen")?.classList.contains("hidden");
    if (modalOpen || crewOpen || escMenuOpen || menuOpen || npcDialogueUi.isOpen()) return;

    const k = e.key.toLowerCase();
    if (transitPanelIsOpen()) {
      e.preventDefault();
      if (e.key === "Escape" || k === "e") closeTransitPanel();
      else if (k === "h" && hardwareSite) returnToHabitat();
      else if (/^[1-8]$/.test(k) && transitPanelEl.querySelector("[data-hw]")) deployToHardwareSite(MARS_SURFACE_HARDWARE[Number(k) - 1].id);
      if (e.key === "Escape") e.stopImmediatePropagation?.();
      return;
    }
    if (k === "h" && !e.repeat) {
      if (hardwareSite) returnToHabitat();
      return;
    }
    if (k === "5" && !e.repeat) {
      if (fleetPanelEl) {
        e.preventDefault();
        releasePointerLock();
        const nextOpen = !fleetPanelEl.classList.contains("open");
        if (nextOpen) renderHudFleetPanel();
        fleetPanelEl.classList.toggle("open", nextOpen);
      }
      return;
    }
    if (k === "o" && !e.repeat) {
      e.preventDefault();
      releasePointerLock();
      onOpenOrbit?.();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation?.();
      keys.clear();
      if (fleetPanelEl?.classList.contains("open")) {
        fleetPanelEl.classList.remove("open");
        return;
      }
      releasePointerLock();
      openPauseMenu?.();
      return;
    }

    if (k === "g" && !e.repeat) {
      toggleGoldVisor();
      return;
    }
    if (k === "f" && !e.repeat) {
      toggleHelmetLamp();
      return;
    }
    if (k === "z" && !e.repeat) {
      cycleOpticalZoom();
      return;
    }
    if (k === "r" && !e.repeat) {
      cycleRayTracingTier();
      return;
    }

    if (k === "v" && !e.repeat && !drivingRover) {
      thirdPersonWalk = !thirdPersonWalk;
      thirdCamInit = false;
      self?.setHeadVisible?.(thirdPersonWalk);
      document.getElementById("visor-overlay")?.classList.toggle("third-person", thirdPersonWalk);
      showWrapNotice(
        isTrLang()
          ? thirdPersonWalk ? "3. ŞAHIS KAMERA · [V] KASK" : "KASK KAMERASI · [V] 3. ŞAHIS"
          : thirdPersonWalk ? "3RD-PERSON CAMERA · [V] HELMET" : "HELMET CAMERA · [V] 3RD PERSON"
      );
      return;
    }
    if (k === "e" && !e.repeat) {
      const tr = isTrLang();
      if (drivingRover && activeDriveRover?.group?.visible) {
        drivingRover = false;
        resetRoverMotionState();
        chaseCamInit = false;
        pitch = prevFirstPersonPitch;
        const exitPt = computeSpawnBesideOffset(
          activeDriveRover.group.position.x,
          activeDriveRover.group.position.z,
          activeDriveRover.group.rotation.y,
          -2.85,
          0.0
        );
        let wx = wrapSceneCoord(exitPt.x, worldW * 2).val;
        let wz = wrapSceneCoord(exitPt.z, worldH * 2).val;
        const wy = sampleElevSceneY(wx, wz);
        const outCol = activeDriveRover.resolveCollision(wx, wz, PARTNER_COLLISION_R + 0.08, wy);
        if (outCol.hit) {
          wx = wrapSceneCoord(outCol.x, worldW * 2).val;
          wz = wrapSceneCoord(outCol.z, worldH * 2).val;
        }
        snapPhys(wx, wz);
        syncDrivingCameraVisualState(false);
        if (self?.group) self.group.visible = suitRig != null;
        showWrapNotice(tr ? "MARS ARACINDAN İNİLDİ (BİNMEK: E)" : "EXITED MARS ROVER (PRESS E TO BOARD)");
        return;
      }

      if (tryTransitInteract()) return;

      const aimX = isPointerLocked() ? null : lastMouseClient.valid ? lastMouseClient.x : null;
      const aimY = isPointerLocked() ? null : lastMouseClient.valid ? lastMouseClient.y : null;
      const targetNpc = pickTargetNpc(aimX, aimY);
      if (targetNpc) {
        openNpcDialogueSafe(targetNpc);
        return;
      }

      const targetRover = hoveredRoverSpec || pickHistoricRover(aimX, aimY);
      if (targetRover) {
        openRoverInfoSafe(targetRover, { toggleKey: "e" });
        return;
      }

      const drivableHit = findNearestDrivableEntry(freePos.x, freePos.z, 5.8);
      const nearNpcHit = npcManager.npcGroup.visible
        ? npcManager.getNearestInteractableNpc(freePos.x, freePos.z, 4.4, freePos, lookDir)
        : null;
      const nearNpc = nearNpcHit?.npc || null;
      if (nearNpc) {
        const npcDist = Number.isFinite(nearNpcHit.distance)
          ? nearNpcHit.distance
          : Math.hypot(freePos.x - nearNpc.x, freePos.z - nearNpc.z);
        if (!drivableHit || npcDist <= drivableHit.dist) {
          openNpcDialogueSafe(nearNpc);
          return;
        }
      }

      const nearestDrivable = drivableHit?.rover || null;
      if (nearestDrivable) {
        activeDriveRover = nearestDrivable;
        const drvSpec = activeDriveRover.getActiveSpec();
        if (drvVehEl) drvVehEl.textContent = drvSpec.shortLabel;
        drivingRover = true;
        resetRoverMotionState();
        prevFirstPersonPitch = pitch;
        pitch = -0.25;
        autoYaw = 0;
        userYaw = activeDriveRover.group.rotation.y;
        roverDynState.yaw = activeDriveRover.group.rotation.y;
        chaseCamInit = false;
        syncDrivingCameraVisualState(true);
        if (self?.group) self.group.visible = false;
        showWrapNotice(
          tr
            ? `${drvSpec.shortLabel} · 3. ŞAHIS SÜRÜŞ · W/S GAZ · A/D DİREKSİYON · SPACE DRİFT · E İN`
            : `${drvSpec.shortLabel} · 3RD-PERSON DRIVE · W/S DRIVE · A/D STEER · SPACE DRIFT · E EXIT`
        );
        return;
      }

      let nearRover = null;
      let bestRoverDist = 7.0;
      for (const entry of historicRovers.getAllEntries()) {
        if (!entry?.group || !entry?.spec) continue;
        const dH = Math.hypot(freePos.x - entry.group.position.x, freePos.z - entry.group.position.z);
        if (dH < bestRoverDist) {
          bestRoverDist = dH;
          nearRover = entry.spec;
        }
      }
      if (nearRover) {
        openRoverInfoSafe(nearRover, { toggleKey: "e" });
      }
      return;
    }

    keys.add(k);
    if (k === "p") {
      dropLocalPing("EVA Waypoint");
    }
    if (k === " " && drivingRover) {
      e.preventDefault();
    }
    if (k === " " && !drivingRover) {
      e.preventDefault();
      if (devCfg.realisticPhysics) {
        if (phys.grounded) phys.jumpQueued = true;
      } else if (phys.grounded) {
        phys.vy = JUMP_SPEED_MS;
        phys.grounded = false;
        player.vy = JUMP_SPEED_MS;
        player.grounded = false;
      }
    }
  });

  // Controller buttons in the 3D view (layout and rebinding: shared/gamepad.js + setup screen).
  // Menus, dialogs and the setup screen are handled in app.js.
  const padBlocked = () =>
    document.getElementById("pad-setup")?.classList.contains("open") ||
    !document.getElementById("start-screen")?.classList.contains("hidden") ||
    hasOpenModalOverlay();
  gamepad.onPress(({ actions }) => {
    if (landing.active) return landing.skip();
    if (!isHudActive() || padBlocked() || drivingRover) return;
    for (const a of actions) {
      if (a === "jump") {
        if (devCfg.realisticPhysics) {
          if (phys.grounded) phys.jumpQueued = true;
        } else if (phys.grounded) {
          phys.vy = JUMP_SPEED_MS;
          phys.grounded = false;
          player.vy = JUMP_SPEED_MS;
          player.grounded = false;
        }
      } else if (a === "pin") dropLocalPing("Landmark");
      else if (a === "texture") document.getElementById("hud-tex")?.click();
      else if (a === "pov") document.getElementById("hud-pov-btn")?.click();
      else if (a === "map") document.getElementById("hud-orbit-btn")?.click();
    }
  });

  const shouldEl = document.getElementById("hud-should-line");
  if (shouldEl) {
    const doseTxt = dose ? `DOSE ${dose.dose_estimate_mSv} mSv (RAD baseline × time)` : "DOSE —";
    const alertCount = alerts?.alerts?.length ?? 0;
    const tempTxt = weather?.latest_sol
      ? `REMS SOL ${weather.latest_sol.sol} ${weather.latest_sol.air_min_C}..${weather.latest_sol.air_max_C}°C`
      : "REMS —";
    shouldEl.textContent = `${doseTxt} · DONKI MARS ALERTS ${alertCount} · ${tempTxt}`;
  }

  const clockEl = document.getElementById("hud-clock");
  function updateHudReadouts(sM, lon, lat, overrideSlopeDeg = null) {
    const rem = Math.max(0, totalDist - sM);

    const prof = activeRoute?.profile || [];
    let slopeDeg = telemetry?.primary?.slope_deg ?? telemetry?.slope_deg ?? 4.0;
    if (overrideSlopeDeg != null && Number.isFinite(overrideSlopeDeg)) {
      slopeDeg = overrideSlopeDeg;
    } else if (prof.length > 1) {
      let i = 0;
      while (i < prof.length - 2 && prof[i + 1].s_m < sM) i++;
      slopeDeg = prof[i].slope_deg ?? slopeDeg;
    }
    const slopeClass = classifySlope(slopeDeg, 20);
    if (viewLabelEl && Number.isFinite(lat) && Number.isFinite(lon)) {
      const latHem = lat < 0 ? "S" : "N";
      const lonE = ((lon % 360) + 360) % 360;
      const lonTxt = lon >= 0 ? `${lon.toFixed(4)}°E` : `${lonE.toFixed(2)}°E (${Math.abs(lon).toFixed(2)}°W)`;
      if (isGaleSite()) {
        viewLabelEl.textContent = `GALE CRATER · MOUNT SHARP · ${Math.abs(lat).toFixed(4)}°${latHem} ${lonTxt}`;
      } else if (activeSiteRover.isCustomSite) {
        viewLabelEl.textContent = `${activeSiteRover.siteShortName} · ${Math.abs(lat).toFixed(3)}°${latHem} ${lonTxt} · PROCEDURAL RELIEF`;
      } else {
        viewLabelEl.textContent = `${activeSiteRover.siteShortName} · ${activeSiteRover.name.toUpperCase()} · ${Math.abs(lat).toFixed(2)}°${latHem} ${lonTxt} · PROCEDURAL RELIEF`;
      }
    }

    // The EVA route and science stops exist only on the Gale HiRISE tile.
    const onRoute = isGaleSite();
    const { stop: nextStop, distanceM: nextStopDist, mode: nextMode } = onRoute
      ? resolveNextStopAlongRoute(activeRoute, stops, sM, [lon, lat])
      : { stop: null, distanceM: Infinity, mode: "none" };

    const setText = (id, txt) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== txt) el.textContent = txt;
    };

    if (onRoute) {
      setText("hud-dist", `${sM.toFixed(1)} m`);
      const stopDistLabel = nextMode === "leg" ? "next stop" : "nearest stop";
      setText(
        "hud-dist-sub",
        `remaining ${rem.toFixed(1)} m · ${stopDistLabel} ${nextStopDist < Infinity ? nextStopDist.toFixed(0) + " m" : "—"}`
      );
    } else {
      setText("hud-dist", "OFF-ROUTE");
      setText("hud-dist-sub", `EVA route is at Gale · here: ${activeSiteRover.siteShortName}`);
    }
    setText("hud-slope", `${Number(slopeDeg).toFixed(1)}°`);
    const badge = document.getElementById("hud-slope-badge");
    if (badge) {
      badge.textContent = slopeClass.id;
      badge.className = `slope-badge slope-${slopeClass.id}`;
    }
    setText("hud-next-stop", nextStop?.properties?.name || "—");
    setText("hud-next-kind", nextStop?.properties?.kind || (onRoute ? "—" : "no science stops at this site"));

    if (clockEl) {
      const t = Math.floor(sM / WALK_SPEED_MS);
      const hh = String(Math.floor(t / 3600)).padStart(2, "0");
      const mm = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
      const ss = String(t % 60).padStart(2, "0");
      const ltst = formatHoursHM(sunState.ltstHours);
      const mode = sunMode === "local" ? "LOCAL" : "FIXED DAY";
      const txt = `LTST ${ltst} (${mode}) · Ls ${sunState.lsDeg.toFixed(0)}° · T+${hh}:${mm}:${ss}  (WALK-TIME PLACEHOLDER)`;
      if (clockEl.textContent !== txt) clockEl.textContent = txt;
    }
    if (nextStop) nextPovStop = nextStop;
  }

  let renderScale = 1;
  let frameAvg = 16;
  let lastScaleChange = 0;

  function syncVisorSafeInsets(w, h, bezelScale) {
    const host = hudView || document.getElementById("visor-overlay") || document.querySelector(".visor-overlay");
    if (!host) return;
    const width = Math.max(1, w || window.innerWidth);
    const height = Math.max(1, h || window.innerHeight);
    const b = Math.max(0, Math.min(1.5, bezelScale || 0));
    if (b <= 0.001) {
      host.style.setProperty("--visor-pad-top", "14px");
      host.style.setProperty("--visor-pad-bottom", "14px");
      host.style.setProperty("--visor-pad-x", "28px");
      host.style.setProperty("--visor-compass-lift", "0px");
      return;
    }
    const bNorm = b <= 0.2 ? b / 0.2 : 1.0 + (b - 0.2) * 0.65;
    const bY = Math.min(0.09, 0.012 * bNorm);
    const bCornerY = Math.min(0.14, 0.038 * bNorm);
    const bX = Math.min(0.08, 0.015 * bNorm);
    const bCornerX = Math.min(0.12, 0.034 * bNorm);
    const cr = 0.068 * Math.min(1.0, bNorm);
    const aspect = width / height;

    const padXPct = Math.min(0.16, bCornerX + 0.016);
    const qx = Math.max(0, 1 - 2 * padXPct);
    const yHalf = Math.max(0.22, 1.0 - 2.0 * (bY + (bCornerY - bY) * Math.pow(Math.max(qx, 1e-4), 1.85)));
    const xHalf = Math.max(0.32, 1.0 - 2.0 * (bX + (bCornerX - bX) * Math.pow(Math.max(yHalf, 1e-4), 1.85)));
    const hx = xHalf * aspect;
    const dx = Math.max(0, qx * aspect - Math.max(0, hx - cr));
    const cornerDropY = cr - Math.sqrt(Math.max(0, cr * cr - Math.min(cr, dx) ** 2));
    const clearY = Math.max(0.1, yHalf - cornerDropY);
    const padYPct = Math.min(0.18, (1.0 - clearY) * 0.5 + 0.014);

    const padX = Math.max(30, Math.round(width * padXPct));
    const padY = Math.max(20, Math.round(height * padYPct));
    const centerClearY = Math.round(height * (bY + 0.012));
    const compassLift = Math.max(0, Math.min(14, padY - centerClearY));

    host.style.setProperty("--visor-pad-top", `${padY}px`);
    host.style.setProperty("--visor-pad-bottom", `${padY}px`);
    host.style.setProperty("--visor-pad-x", `${padX}px`);
    host.style.setProperty("--visor-compass-lift", `${compassLift}px`);
  }

  const onResize = () => {
    const w = wrap.clientWidth || window.innerWidth;
    const topOff = document.body.classList.contains("in-hud") ? 0 : 44;
    const h = wrap.clientHeight || window.innerHeight - topOff;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    const rtPreset = getRayTracingPreset(devCfg);
    const wantRt = rtPreset.enabled > 0;
    const basePr = wantRt
      ? rtPreset.tier >= 4
        ? renderer.getPixelRatio()
        : Math.min(1.0, renderer.getPixelRatio())
      : renderer.getPixelRatio();
    const pr = basePr * (wantRt ? rtPreset.resolutionScale : renderScale);
    const nextW = Math.max(1, Math.floor(w * pr));
    const nextH = Math.max(1, Math.floor(h * pr));
    if (nextW !== lastRtW || nextH !== lastRtH) {
      lastRtW = nextW;
      lastRtH = nextH;
      rt.setSize(nextW, nextH);
    }
    lensMat.uniforms.uResolution.value.set(nextW, nextH);
    const activeScale = devCfg.frameEffect ? Math.max(0.2, Math.min(1.5, devCfg.frameStrength ?? 0.2)) : 0;
    syncVisorSafeInsets(w, h, activeScale);
  };

  function syncDrivingCameraVisualState(isDriving3p) {
    const visorOverlay = document.getElementById("visor-overlay") || document.querySelector(".visor-overlay");
    if (visorOverlay) {
      visorOverlay.classList.toggle("driving-3p", Boolean(isDriving3p));
    }
    const w = wrap.clientWidth || window.innerWidth;
    const topOff = document.body.classList.contains("in-hud") ? 0 : 44;
    const h = wrap.clientHeight || window.innerHeight - topOff;
    if (!devCfg.frameEffect) {
      lensMat.uniforms.uFrameZoom.value = 1.0;
      lensMat.uniforms.uBezelScale.value = 0.0;
      lensMat.uniforms.uDistort.value = 0.0;
      lensMat.uniforms.uAberration.value = 0.0;
      lensMat.uniforms.uVignette.value = 0.0;
      syncVisorSafeInsets(w, h, 0);
      return;
    }
    const strength = Math.max(0.2, Math.min(1.5, devCfg.frameStrength ?? 0.2));
    const lensAmt = Math.max(0.45, Math.min(1.5, 0.35 + strength * 0.65));
    lensMat.uniforms.uFrameZoom.value = 1.0;
    lensMat.uniforms.uBezelScale.value = strength;
    syncVisorSafeInsets(w, h, strength);
    if (isDriving3p) {
      lensMat.uniforms.uDistort.value = 0.04 * lensAmt;
      lensMat.uniforms.uAberration.value = 0.0006 * lensAmt;
      lensMat.uniforms.uVignette.value = 0.45 * lensAmt;
    } else {
      lensMat.uniforms.uDistort.value = 0.11 * lensAmt;
      lensMat.uniforms.uAberration.value = 0.0012 * lensAmt;
      lensMat.uniforms.uVignette.value = 0.68 * lensAmt;
    }
  }

  function applyDevSettings(cfg) {
    devCfg = cfg;
    const visorOverlay = document.getElementById("visor-overlay") || document.querySelector(".visor-overlay");
    if (visorOverlay) {
      visorOverlay.classList.toggle("no-frame", !cfg.frameEffect);
      visorOverlay.classList.toggle("clean-hud", Boolean(cfg.cleanHud));
      visorOverlay.classList.toggle("driving-3p", Boolean(drivingRover));
    }

    syncDrivingCameraVisualState(drivingRover);
    const strength = cfg.frameEffect ? cfg.frameStrength : 0.35;
    lensMat.uniforms.uGrain.value = (cfg.superGraphics ? 0.008 : 0.014) * Math.max(0.35, strength);
    lensMat.uniforms.uGold.value = goldVisor;
    lensMat.uniforms.uOptZoom.value = optZoom;

    if (camera.fov !== cfg.fov) {
      camera.fov = cfg.fov;
      camera.updateProjectionMatrix();
    }

    const wantSuper = Boolean(cfg.superGraphics);
    const rtPreset = applyRayTracerTierUniforms(rtUniforms, cfg);
    const wantRt = rtPreset.enabled > 0;
    const targetPr = Math.min(window.devicePixelRatio || 1, wantSuper || rtPreset.tier >= 4 ? 2.0 : 1.25);
    renderer.setPixelRatio(targetPr);
    renderScale = wantRt ? rtPreset.resolutionScale : wantSuper ? 1.25 : 1.0;

    // WebGL2 MSAA render targets cannot attach a DepthTexture, so when Ray Tracing is active
    // we switch to samples: 0 + DepthTexture (paired with FXAA + CAS + SSR/RTAO in LENS_FRAG).
    const wantSamples = wantRt ? 0 : wantSuper ? 4 : 2;
    if (rtSamples !== wantSamples || rtHasDepth !== wantRt) {
      rtSamples = wantSamples;
      rtHasDepth = wantRt;
      lastRtW = 0;
      lastRtH = 0;
      rt.depthTexture?.dispose?.();
      rt.dispose();
      if (wantRt) {
        const depthTex = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
        rt = new THREE.WebGLRenderTarget(1, 1, {
          type: THREE.HalfFloatType,
          samples: 0,
          depthTexture: depthTex,
        });
        lensMat.uniforms.tDepth.value = depthTex;
      } else {
        rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: wantSamples });
        lensMat.uniforms.tDepth.value = dummyDepthTex;
      }
      lensMat.uniforms.tDiffuse.value = rt.texture;
    }
    syncOpticsOverlayUi();

    const wantShadowPx = wantSuper ? 4096 : SHADOW_MAP_PX;
    const wantShadowHalf = wantSuper ? 30 : SHADOW_HALF_M;
    const wantShadowType = wantSuper ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (shadowMapPx !== wantShadowPx || shadowHalfM !== wantShadowHalf || renderer.shadowMap.type !== wantShadowType) {
      shadowMapPx = wantShadowPx;
      shadowHalfM = wantShadowHalf;
      renderer.shadowMap.type = wantShadowType;
      sun.shadow.mapSize.set(wantShadowPx, wantShadowPx);
      sun.shadow.camera.left = -wantShadowHalf;
      sun.shadow.camera.right = wantShadowHalf;
      sun.shadow.camera.top = wantShadowHalf;
      sun.shadow.camera.bottom = -wantShadowHalf;
      sun.shadow.camera.updateProjectionMatrix();
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
      renderer.shadowMap.needsUpdate = true;
    }

    const wantRealTex = Boolean(cfg.realisticTextures);
    const activePbr = wantRealTex ? ensureHighResPbr() : pbr;
    if (terrainMat.normalMap !== activePbr.dustNormalTex) {
      terrainMat.normalMap = activePbr.dustNormalTex;
      terrainMat.needsUpdate = true;
    }
    pbrDustU.value = activePbr.dustAlbedoTex;
    pbrRockU.value = activePbr.rockAlbedoTex;
    realisticTexUniform.value = wantRealTex ? 1.0 : 0.0;
    const baseNorm = wantSuper ? 0.95 : 0.55;
    const normScale = wantRealTex ? baseNorm + 0.45 : baseNorm;
    terrainMat.normalScale.set(normScale, normScale);
    terrainMat.roughness = wantRealTex ? 0.85 : 0.96;
    syncChunkMaterials();
    applySuitRealism(wantRealTex);

    superDetailUniform.value = wantSuper ? 1.0 : 0.0;
    baseSunIntensity = wantSuper ? 3.95 : 3.6;
    const upNow = sunUp(sunState.elevationRad);
    sun.intensity = baseSunIntensity * (sunState.fluxWm2 / 590) * upNow;
    hemiLight.intensity = (wantSuper ? 0.28 : 0.22) * (0.32 + 0.68 * upNow);
    renderer.toneMappingExposure = (wantSuper ? 1.06 : 1.0) * (1 + 0.55 * (1 - upNow));
    rockField.group.visible = wantSuper;
    galeVista.visible = wantSuper && isGaleSite();
    fieldKits.visible = wantSuper && isGaleSite();
    const tau = cfg.dustTau ?? 0.5;
    sky.material.uniforms.uTau.value = tau;
    sky.material.uniforms.uSunElev.value = sunState.elevationRad;
    for (const moon of [phobos, deimos]) {
      moon.material.uniforms.uTau.value = tau;
      moon.material.uniforms.uSunElev.value = sunState.elevationRad;
    }
    scene.fog.density = 0.00042 * (0.55 + tau * 0.85);
    const alertCount = alerts?.alerts?.length ?? 0;
    lensMat.uniforms.uRay.value = alertCount > 0 ? 0.0018 : 0.00035;

    const vSpec = activeDriveRover ? activeDriveRover.getActiveSpec() : getDrivableVehicleSpec();
    if (drvVehEl) drvVehEl.textContent = vSpec.shortLabel;

    const wantRover = Boolean(cfg.experimentalRover);
    const keepHabitatVisible = habitatStation.group.visible;
    for (const r of drivableRovers) r.group.visible = wantRover || keepHabitatVisible;
    if (wantRover && !roverWasOn && activeDriveRover) {
      resetRoverMotionState();
      activeDriveRover.spawnBeside(freePos.x, freePos.z, autoYaw + userYaw, sampleElevSceneY);
      roverDynState.yaw = activeDriveRover.group.rotation.y;
      nearRoverPrompted = false;
      if (hudView.classList.contains("active")) {
        showWrapNotice(
          isTrLang()
            ? `${vSpec.nameTr.toUpperCase()} YANINDA OLUŞTU (BİN: E · ARAÇ DEĞİŞTİR: V)`
            : `${vSpec.nameEn.toUpperCase()} SPAWNED BESIDE YOU (E TO BOARD · V TO SWITCH)`
        );
      }
    } else if (!wantRover && !keepHabitatVisible && drivingRover) {
      drivingRover = false;
      resetRoverMotionState();
      chaseCamInit = false;
      snapPhys(freePos.x, freePos.z);
      syncDrivingCameraVisualState(false);
      if (self?.group) self.group.visible = suitRig != null;
    }
    roverWasOn = wantRover;
    onResize();
  }

  // Adaptive resolution: the 3D scene renders into rt, so its size can drop when frames are slow
  // and come back when there is headroom. Disabled when Experimental Super Graphics is active.
  function adaptResolution(frameMs, now) {
    if (devCfg.rayTracing || devCfg.superGraphics) return;
    frameAvg += (frameMs - frameAvg) * 0.05;
    if (now - lastScaleChange < 1200) return;
    let next = renderScale;
    if (frameAvg > 24 && renderScale > 0.55) next = Math.max(0.55, renderScale - 0.1);
    else if (frameAvg < 15 && renderScale < 1) next = Math.min(1, renderScale + 0.05);
    if (next !== renderScale) {
      renderScale = next;
      lastScaleChange = now;
      onResize();
    }
  }
  window.addEventListener("resize", onResize);
  subscribeDevSettings(applyDevSettings);
  applyDevSettings(devCfg);

  // ---------- loop ----------
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const moveDir = new THREE.Vector3();
  let prevT = performance.now();
  let clockT = 0;
  let lastMpSendMs = 0;
  let lastSentPose = null;
  let hudTimer = 1;
  let eyeBaseY = null;
  let groundSpeedSm = 0;

  const pushApart = (targetPos, minRadius = PARTNER_COLLISION_R) => {
    if (!targetPos) return;
    const pdx = freePos.x - targetPos.x;
    const pdz = freePos.z - targetPos.z;
    const pdy = Math.abs((player.init ? player.y : sampleElevSceneY(freePos.x, freePos.z)) - targetPos.y);
    const pDist = Math.hypot(pdx, pdz);
    if (pdy < ASTRONAUT_HEIGHT_M * 1.15 && pDist < minRadius) {
      if (pDist > 1e-4) {
        freePos.x = targetPos.x + (pdx / pDist) * minRadius;
        freePos.z = targetPos.z + (pdz / pDist) * minRadius;
      } else {
        freePos.x -= fwd.x * minRadius;
        freePos.z -= fwd.z * minRadius;
      }
    }
  };

  const lookDir = new THREE.Vector3();
  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min(0.1, (now - prevT) / 1000);
    prevT = now;
    clockT += dt;
    if (!hudView.classList.contains("active")) return; // do not render while hidden

    // habitat: bay doors / airlock doors open for the walker and the driven rover
    if (habitatStation.group.visible) {
      const actors = [{ x: freePos.x, z: freePos.z }];
      if (drivingRover && activeDriveRover?.group) actors.push(activeDriveRover.group.position);
      habitatStation.update(dt, { actors });
    }
    updateTransit(dt);

    // controller look (right stick), off while a menu, dialog or the setup screen has the pad
    const padBusy = padBlocked();
    const lk = padBusy ? { x: 0, y: 0 } : gamepad.look();
    if (lk.x || lk.y) {
      userYaw -= lk.x * 2.6 * dt;
      const minP = drivingRover ? -1.08 : -1.35;
      const maxP = drivingRover ? -0.06 : 1.42;
      pitch = Math.max(minP, Math.min(maxP, pitch + lk.y * 1.9 * dt));
    }

    // progress along the route = the route point nearest to you (for the HUD only)
    alongM = nearestAlongRoute(freePos.x, freePos.z, alongM);
    const sample = sampleAlongRoute(routeCoords, cumDist, toGeomDist(alongM));
    let px = player.x;
    let pz = player.z;
    const prevX = player.x;
    const prevZ = player.z;
    let roverLateralSpeed = 0;

    if (freeRoam && drivingRover && activeDriveRover?.group?.visible) {
      const rYaw0 = activeDriveRover.group.rotation.y;
      const fx0 = -Math.sin(rYaw0);
      const fz0 = -Math.cos(rYaw0);
      const rx0 = Math.cos(rYaw0);
      const rz0 = -Math.sin(rYaw0);
      let steerJerk = 0;

      let dyn = null;
      if (!isMapOpen() && !hasOpenModalOverlay()) {
        const run = keys.has("shift");
        const handbrake = keys.has(" ");
        const throttle =
          (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
        const steerIn =
          (keys.has("a") || keys.has("arrowleft") ? 1 : 0) - (keys.has("d") || keys.has("arrowright") ? 1 : 0);
        prevRoverSteer = roverSteer;
        roverSteer += (steerIn - roverSteer) * Math.min(1, dt * 10.5);
        steerJerk = dt > 0 ? Math.abs(roverSteer - prevRoverSteer) / dt : 0;

        const gHere = sampleElevSceneY(activeDriveRover.group.position.x, activeDriveRover.group.position.z);
        const gAheadSlope = sampleElevSceneY(
          activeDriveRover.group.position.x + fx0 * 1.4,
          activeDriveRover.group.position.z + fz0 * 1.4
        );
        const gBehindSlope = sampleElevSceneY(
          activeDriveRover.group.position.x - fx0 * 1.4,
          activeDriveRover.group.position.z - fz0 * 1.4
        );
        const gRightSlope = sampleElevSceneY(
          activeDriveRover.group.position.x + rx0 * 1.3,
          activeDriveRover.group.position.z + rz0 * 1.3
        );
        const gLeftSlope = sampleElevSceneY(
          activeDriveRover.group.position.x - rx0 * 1.3,
          activeDriveRover.group.position.z - rz0 * 1.3
        );
        const slopePitch = Math.atan2(gAheadSlope - gBehindSlope, 2.8);
        const slopeRoll = Math.atan2(gRightSlope - gLeftSlope, 2.6);

        roverDynState.yaw = rYaw0;
        dyn = stepAdvancedRoverPhysics(roverDynState, {
          vehicleType: activeDriveRover.vehicleType,
          throttle,
          steer: roverSteer,
          boost: run,
          handbrake,
          speedMultiplier: devCfg.roverSpeedMultiplier || 1,
          slopePitch,
          slopeRoll,
          airborne: roverAirState.airborne,
          realisticPhysics: Boolean(devCfg.realisticPhysics),
          dt,
        });

        // Sheer vertical wall guard (> 55 deg cliff crest)
        const moveSign = Math.sign(roverDynState.forwardSpeed || throttle || 1);
        const probeAhead = sampleElevSceneY(
          activeDriveRover.group.position.x + moveSign * fx0 * 2.2,
          activeDriveRover.group.position.z + moveSign * fz0 * 2.2
        );
        const slopeAheadDeg = Math.abs(Math.atan2(probeAhead - gHere, 2.2)) * (180 / Math.PI);
        if (!roverAirState.airborne && devCfg.realisticPhysics && slopeAheadDeg > 55 && probeAhead > gHere) {
          roverDynState.velX *= Math.exp(-dt * 8);
          roverDynState.velZ *= Math.exp(-dt * 8);
          roverDynState.forwardSpeed *= Math.exp(-dt * 8);
        }

        const deltaYaw = roverDynState.yaw - rYaw0;
        activeDriveRover.group.rotation.y = roverDynState.yaw;
        userYaw += deltaYaw;
        roverVelX = roverDynState.velX;
        roverVelZ = roverDynState.velZ;
        roverThrottleVel = roverDynState.forwardSpeed;
        roverLateralSpeed = roverDynState.lateralSpeed;
      } else {
        roverVelX *= Math.exp(-dt * 4);
        roverVelZ *= Math.exp(-dt * 4);
        roverThrottleVel *= Math.exp(-dt * 4);
        roverDynState.velX = roverVelX;
        roverDynState.velZ = roverVelZ;
        roverDynState.forwardSpeed = roverThrottleVel;
      }

      if (roverAirState.airborne) {
        roverDynState.airPitchOffset = Math.max(-0.32, Math.min(0.32, roverDynState.airPitchOffset + roverDynState.airPitchVel * dt));
        roverDynState.airRollOffset = Math.max(-0.28, Math.min(0.28, roverDynState.airRollOffset + roverDynState.airRollVel * dt));
      } else {
        roverDynState.airPitchOffset *= Math.exp(-dt * 12);
        roverDynState.airRollOffset *= Math.exp(-dt * 12);
      }

      activeDriveRover.group.position.x += roverVelX * dt;
      activeDriveRover.group.position.z += roverVelZ * dt;

      const resolveDrivingActor = (actorPos) => {
        if (!actorPos) return;
        const hit = activeDriveRover.resolveCollision(actorPos.x, actorPos.z, PARTNER_COLLISION_R + 0.08, actorPos.y);
        if (hit.hit) {
          activeDriveRover.group.position.x -= hit.nx * hit.pen;
          activeDriveRover.group.position.z -= hit.nz * hit.pen;
          roverVelX *= 0.25;
          roverVelZ *= 0.25;
          roverThrottleVel *= 0.25;
          roverDynState.velX = roverVelX;
          roverDynState.velZ = roverVelZ;
        }
      };
      if (partner && partner.group.visible) resolveDrivingActor(partner.group.position);
      for (const remote of remoteAvatars.values()) resolveDrivingActor(remote.group.position);
      for (const otherDrv of drivableRovers) {
        if (otherDrv === activeDriveRover || !otherDrv.group.visible) continue;
        const hitOther = activeDriveRover.resolveCollision(
          otherDrv.group.position.x,
          otherDrv.group.position.z,
          otherDrv.radius * 0.72,
          otherDrv.group.position.y
        );
        if (hitOther.hit) {
          activeDriveRover.group.position.x -= hitOther.nx * hitOther.pen;
          activeDriveRover.group.position.z -= hitOther.nz * hitOther.pen;
          roverVelX *= 0.25;
          roverVelZ *= 0.25;
          roverThrottleVel *= 0.25;
          roverDynState.velX = roverVelX;
          roverDynState.velZ = roverVelZ;
        }
      }
      if (habitatStation.group.visible) {
        const hitHab = habitatStation.resolveCollision(
          activeDriveRover.group.position.x,
          activeDriveRover.group.position.z,
          1.75,
          activeDriveRover.group.position.y
        );
        if (hitHab.hit) {
          activeDriveRover.group.position.x = hitHab.x;
          activeDriveRover.group.position.z = hitHab.z;
          roverVelX *= 0.25;
          roverVelZ *= 0.25;
          roverThrottleVel *= 0.25;
          roverDynState.velX = roverVelX;
          roverDynState.velZ = roverVelZ;
        }
      }
      for (const histEntry of historicRovers.getAllEntries()) {
        const hPos = histEntry.group?.position;
        const hSpec = histEntry.spec;
        if (!hPos || !hSpec) continue;
        const hitHist = activeDriveRover.resolveCollision(
          hPos.x,
          hPos.z,
          Math.max(hSpec.halfW || 1.2, hSpec.halfL || 1.3) * 0.72,
          hPos.y
        );
        if (hitHist.hit) {
          activeDriveRover.group.position.x -= hitHist.nx * hitHist.pen;
          activeDriveRover.group.position.z -= hitHist.nz * hitHist.pen;
          roverVelX *= 0.25;
          roverVelZ *= 0.25;
          roverThrottleVel *= 0.25;
          roverDynState.velX = roverVelX;
          roverDynState.velZ = roverVelZ;
        }
      }
      if (npcManager.npcGroup.visible) {
        for (const npcEntry of npcManager.getAllNpcs()) {
          const hitNpcCol = activeDriveRover.resolveCollision(
            npcEntry.x,
            npcEntry.z,
            0.52,
            npcEntry.y
          );
          if (hitNpcCol.hit) {
            activeDriveRover.group.position.x -= hitNpcCol.nx * hitNpcCol.pen;
            activeDriveRover.group.position.z -= hitNpcCol.nz * hitNpcCol.pen;
            roverVelX *= 0.25;
            roverVelZ *= 0.25;
            roverThrottleVel *= 0.25;
            roverDynState.velX = roverVelX;
            roverDynState.velZ = roverVelZ;
          }
        }
      }

      applySeamlessWorldWrap(activeDriveRover.group.position.x, activeDriveRover.group.position.z);

      const horizSpeed = Math.hypot(roverVelX, roverVelZ);
      const vehSpec = dyn?.spec || activeDriveRover.getActiveSpec();
      const supportGroundY = activeDriveRover.sampleSupportGroundY(sampleElevSceneY);
      let slopeClimbVy = 0;
      let bumpImpulseVy = 0;
      if (horizSpeed > 0.8 && !roverAirState.airborne) {
        const dirX = roverVelX / horizSpeed;
        const dirZ = roverVelZ / horizSpeed;
        const hBackVel = sampleElevSceneY(
          activeDriveRover.group.position.x - dirX * 1.15,
          activeDriveRover.group.position.z - dirZ * 1.15
        );
        const hNow = sampleElevSceneY(activeDriveRover.group.position.x, activeDriveRover.group.position.z);
        slopeClimbVy = Math.max(0, (hNow - hBackVel) / 1.15) * horizSpeed;
        const hLeft = sampleElevSceneY(
          activeDriveRover.group.position.x + Math.cos(activeDriveRover.group.rotation.y) * 1.34,
          activeDriveRover.group.position.z - Math.sin(activeDriveRover.group.rotation.y) * 1.34
        );
        const hRight = sampleElevSceneY(
          activeDriveRover.group.position.x - Math.cos(activeDriveRover.group.rotation.y) * 1.34,
          activeDriveRover.group.position.z + Math.sin(activeDriveRover.group.rotation.y) * 1.34
        );
        const crossBump = Math.abs(hLeft - hRight);
        if ((steerJerk > 2.6 || Math.abs(roverLateralSpeed) > 5.0) && horizSpeed > 11.5 && (crossBump > 0.24 || slopeClimbVy > 2.2)) {
          bumpImpulseVy = Math.min(2.8, steerJerk * 0.28 + crossBump * 2.2 + Math.abs(roverLateralSpeed) * 0.22);
        }
      }
      const airStep = stepRoverBallisticPhysics(roverAirState, {
        groundY: supportGroundY,
        slopeClimbVy,
        bumpImpulseVy,
        horizSpeed,
        jumpBias: vehSpec.jumpBias || 1.0,
        dt,
        marsG: ROVER_FLIGHT_G,
      });
      if (airStep.launched && devCfg.realisticDust) {
        for (const sideSign of [-1, 1]) {
          const emit = activeDriveRover.getWheelDustEmitPoint(sideSign);
          marsFx.emitBurst(emit.x, sampleElevSceneY(emit.x, emit.z), emit.z, 5, 1.35, -roverVelX * 0.2, -roverVelZ * 0.2);
        }
      }
      roverLandingImpact = airStep.landed ? airStep.impactSpeed : 0;
      if (airStep.landed && devCfg.realisticDust && airStep.impactSpeed > 1.0) {
        const rYawL = activeDriveRover.group.rotation.y;
        marsFx.emitJumpBurst(activeDriveRover.group.position.x, supportGroundY, activeDriveRover.group.position.z, {
          mode: "land",
          impactSpeed: Math.max(1.2, airStep.impactSpeed * 1.15),
          rightX: Math.cos(rYawL),
          rightZ: -Math.sin(rYawL),
          fwdX: -Math.sin(rYawL),
          fwdZ: -Math.cos(rYawL),
          vx: roverVelX,
          vz: roverVelZ,
        });
        for (const sideSign of [-1, 1]) {
          const emit = activeDriveRover.getWheelDustEmitPoint(sideSign);
          marsFx.emitBurst(emit.x, sampleElevSceneY(emit.x, emit.z), emit.z, 6, 1.75, -roverVelX * 0.28, -roverVelZ * 0.28);
        }
      }

      activeDriveRover.update(dt, {
        sampleElevY: sampleElevSceneY,
        speed: roverThrottleVel,
        steer: roverSteer,
        clockT,
        driving: true,
        physicsEnabled: Boolean(devCfg.realisticPhysics),
        airborne: roverAirState.airborne,
        worldY: roverAirState.posY,
        velY: roverAirState.velY,
        lateralSpeed: roverLateralSpeed,
        landingImpact: roverLandingImpact,
        braking: Boolean(dyn?.braking),
        handbrake: Boolean(!isMapOpen() && !hasOpenModalOverlay() && keys.has(" ")),
        drifting: Boolean(dyn?.drifting),
        airPitchOffset: roverDynState.airPitchOffset,
        airRollOffset: roverDynState.airRollOffset,
      });
      for (const idleDrv of drivableRovers) {
        if (idleDrv === activeDriveRover || !idleDrv.group.visible) continue;
        idleDrv.update(dt, {
          sampleElevY: sampleElevSceneY,
          speed: 0,
          steer: 0,
          clockT,
          driving: false,
          physicsEnabled: Boolean(devCfg.realisticPhysics),
        });
      }

      if (drvSpdEl) drvSpdEl.textContent = String(Math.round(horizSpeed * 3.6));
      if (drvGearEl) drvGearEl.textContent = String(dyn?.gear || 1);
      if (drvRpmEl) drvRpmEl.style.width = `${Math.round((dyn?.rpmNorm || 0) * 100)}%`;
      if (drvSlipEl) {
        const slipPct = Math.round((dyn?.slipRatio || 0) * 100);
        const isDrifting = Boolean(dyn?.drifting);
        drvSlipEl.classList.toggle("drifting", isDrifting);
        drvSlipEl.textContent = roverAirState.airborne
          ? "AIRBORNE"
          : isDrifting
            ? `DRIFT ${slipPct}%`
            : `GRIP ${Math.max(0, 100 - slipPct)}%`;
      }

      if (devCfg.realisticDust && !roverAirState.airborne && (Math.abs(roverThrottleVel) > 0.7 || Math.abs(roverLateralSpeed) > 1.2 || dyn?.drifting)) {
        const speedMag = Math.hypot(roverThrottleVel, roverLateralSpeed) + (dyn?.drifting ? 4.5 : 0);
        roverDustAcc += dt * Math.min(54, 10 + speedMag * 3.1);
        const burstCount = Math.floor(roverDustAcc);
        if (burstCount > 0) {
          roverDustAcc -= burstCount;
          const rYaw = activeDriveRover.group.rotation.y;
          const fx = -Math.sin(rYaw);
          const fz = -Math.cos(rYaw);
          const sideSign = Math.random() < 0.5 ? -1 : 1;
          const emit = activeDriveRover.getWheelDustEmitPoint(sideSign);
          marsFx.emitBurst(
            emit.x,
            sampleElevSceneY(emit.x, emit.z),
            emit.z,
            Math.min(7, burstCount),
            Math.min(2.15, 0.72 + speedMag * 0.13),
            -fx * roverThrottleVel * 0.24 - Math.cos(rYaw) * roverLateralSpeed * 0.22,
            -fz * roverThrottleVel * 0.24 + Math.sin(rYaw) * roverLateralSpeed * 0.22
          );
        }
      }

      phys.x = activeDriveRover.group.position.x;
      phys.z = activeDriveRover.group.position.z;
      phys.y = activeDriveRover.group.position.y;
      phys.vx = roverVelX;
      phys.vz = roverVelZ;
      phys.vy = roverAirState.velY;
      phys.grounded = !roverAirState.airborne;
      phys.crouch = 0;
      phys.slopeDeg = computeLocalSlopeDeg(phys.x, phys.z);
      syncPlayerFromPhys();
      px = phys.x;
      pz = phys.z;
    } else if (freeRoam) {
      const wasGrounded = player.grounded;
      const prevVy = phys.vy;
      if (!isMapOpen() && !hasOpenModalOverlay()) {
        fwd.set(0, 0, -1).applyAxisAngle(UP, userYaw);
        right.set(1, 0, 0).applyAxisAngle(UP, userYaw);
        moveDir.set(0, 0, 0);
        if (keys.has("w") || keys.has("arrowup")) moveDir.add(fwd);
        if (keys.has("s") || keys.has("arrowdown")) moveDir.sub(fwd);
        if (keys.has("d") || keys.has("arrowright")) moveDir.add(right);
        if (keys.has("a") || keys.has("arrowleft")) moveDir.sub(right);
        // analog stick: direction from the stick, speed scaled by how far it is pushed
        let stickPace = 1;
        if (!padBusy && moveDir.lengthSq() === 0) {
          const st = gamepad.move();
          const mag = Math.min(1, Math.hypot(st.x, st.y));
          if (mag > 0) {
            moveDir.addScaledVector(fwd, st.y).addScaledVector(right, st.x);
            stickPace = mag;
          }
        }
        const padRun = !padBusy && gamepad.isDown("run");
        if (moveDir.lengthSq() > 0) moveDir.normalize();

        if (devCfg.realisticPhysics) {
          stepPhysicsWorld(
            phys,
            dt,
            {
              wishX: moveDir.x,
              wishZ: moveDir.z,
              run: keys.has("shift") || padRun,
              speedMultiplier: (devCfg.speedMultiplier || 1) * stickPace,
              slopeLimitDeg: document.getElementById("toggle-strict-15")?.checked ? 15 : 20,
              latDeg: zToLat(phys.z),
            },
            heightEnv
          );
        } else {
          const run = keys.has("shift") || padRun;
          const here = sampleElevSceneY(phys.x, phys.z);
          let desiredVx = 0;
          let desiredVz = 0;
          if (moveDir.lengthSq() > 0) {
            const ahead = sampleElevSceneY(phys.x + moveDir.x * 1.5, phys.z + moveDir.z * 1.5);
            // Signed grade (+ uphill), same curve as the realistic walker.
            const slowdown = gradeSpeedScale(Math.atan2(ahead - here, 1.5) * (180 / Math.PI));
            const v =
              (run ? RUN_SPEED_MS : WALK_SPEED_MS) *
              (devCfg.speedMultiplier || 1) *
              stickPace *
              slowdown *
              (phys.grounded ? 1 : 0.65);
            desiredVx = moveDir.x * v;
            desiredVz = moveDir.z * v;
          }
          phys.vx = desiredVx;
          phys.vz = desiredVz;
          phys.x += desiredVx * dt;
          phys.z += desiredVz * dt;
          const groundSimple = sampleElevSceneY(phys.x, phys.z);
          if (phys.grounded && phys.y - groundSimple > 0.25) phys.grounded = false;
          if (!phys.grounded) {
            phys.vy -= surfaceG * dt;
            phys.y += phys.vy * dt;
            if (phys.y <= groundSimple) {
              phys.impactSpeed = Math.abs(phys.vy);
              phys.y = groundSimple;
              phys.vy = 0;
              phys.grounded = true;
            }
          } else {
            phys.y = groundSimple;
          }
          phys.crouch = 0;
          phys.slopeDeg = computeLocalSlopeDeg(phys.x, phys.z);
        }
      }

      const wrapRes = applySeamlessWorldWrap(phys.x, phys.z);
      if (wrapRes.wrapped) {
        const wLon = xToLon(phys.x);
        const wLat = zToLat(phys.z);
        const nearestGeomS = closestAlongM(routeCoords, cumDist, wLon, wLat);
        alongM = geomTotalDist > 0 ? (nearestGeomS / geomTotalDist) * totalDist : 0;
      }

      freePos.set(phys.x, phys.y, phys.z);
      if (partner && partner.group.visible) pushApart(partner.group.position);
      if (landing.lander.visible && !landing.active) pushApart(landing.lander.position, 4.6);
      let nearestR = null;
      let minDistR = Infinity;
      for (const drvR of drivableRovers) {
        if (!drvR.group.visible) continue;
        const col = drvR.resolveCollision(
          freePos.x,
          freePos.z,
          PARTNER_COLLISION_R,
          player.init ? player.y : sampleElevSceneY(freePos.x, freePos.z)
        );
        if (col.hit) {
          freePos.x = col.x;
          freePos.z = col.z;
          const vn = phys.vx * col.nx + phys.vz * col.nz;
          if (vn < 0) {
            phys.vx -= col.nx * vn;
            phys.vz -= col.nz * vn;
          }
        }
        drvR.update(dt, {
          sampleElevY: sampleElevSceneY,
          speed: 0,
          steer: 0,
          clockT,
          driving: false,
          physicsEnabled: Boolean(devCfg.realisticPhysics),
        });
        const distR = Math.hypot(freePos.x - drvR.group.position.x, freePos.z - drvR.group.position.z);
        if (distR < minDistR) {
          minDistR = distR;
          nearestR = drvR;
        }
      }
      if (nearestR && minDistR <= 4.8 && !nearRoverPrompted) {
        nearRoverPrompted = true;
        const nSpec = nearestR.getActiveSpec();
        showWrapNotice(
          isTrLang()
            ? `${nSpec.nameTr.toUpperCase()} · BİNMEK İÇİN [E] TUŞUNA BAS`
            : `${nSpec.nameEn.toUpperCase()} · PRESS [E] TO DRIVE`
        );
      } else if (minDistR > 6.4) {
        nearRoverPrompted = false;
      }
      if (habitatStation.group.visible) {
        const habCol = habitatStation.resolveCollision(
          freePos.x,
          freePos.z,
          PARTNER_COLLISION_R * 0.58,
          player.init ? player.y : sampleElevSceneY(freePos.x, freePos.z)
        );
        if (habCol.hit) {
          freePos.x = habCol.x;
          freePos.z = habCol.z;
          const vn = phys.vx * habCol.nx + phys.vz * habCol.nz;
          if (vn < 0) {
            phys.vx -= habCol.nx * vn;
            phys.vz -= habCol.nz * vn;
          }
        }
      }
      for (const remote of remoteAvatars.values()) pushApart(remote.group.position);
      const histCol = historicRovers.resolveCollision(
        freePos.x,
        freePos.z,
        PARTNER_COLLISION_R * 0.52,
        player.init ? player.y : sampleElevSceneY(freePos.x, freePos.z)
      );
      if (histCol.hit) {
        freePos.x = histCol.x;
        freePos.z = histCol.z;
        const vn = phys.vx * histCol.nx + phys.vz * histCol.nz;
        if (vn < 0) {
          phys.vx -= histCol.nx * vn;
          phys.vz -= histCol.nz * vn;
        }
      }
      if (npcManager.npcGroup.visible) {
        const npcCol = npcManager.resolveCollision(freePos.x, freePos.z, PARTNER_COLLISION_R * 0.52);
        if (npcCol.hit) {
          freePos.x = npcCol.x;
          freePos.z = npcCol.z;
          const vn = phys.vx * npcCol.nx + phys.vz * npcCol.nz;
          if (vn < 0) {
            phys.vx -= npcCol.nx * vn;
            phys.vz -= npcCol.nz * vn;
          }
        }
      }
      if (freePos.x !== phys.x || freePos.z !== phys.z) {
        phys.x = freePos.x;
        phys.z = freePos.z;
        phys.vx *= 0.2;
        phys.vz *= 0.2;
      }
      syncPlayerFromPhys();
      px = phys.x;
      pz = phys.z;

      if (devCfg.realisticDust) {
        const jYaw = autoYaw + userYaw;
        if (wasGrounded && !phys.grounded && phys.vy > 0.4) {
          marsFx.emitJumpBurst(px, phys.y, pz, {
            mode: "takeoff",
            impactSpeed: 1.55,
            rightX: Math.cos(jYaw),
            rightZ: -Math.sin(jYaw),
            fwdX: -Math.sin(jYaw),
            fwdZ: -Math.cos(jYaw),
            vx: phys.vx,
            vz: phys.vz,
          });
        } else if (!wasGrounded && phys.grounded) {
          const impactVy = phys.impactSpeed || Math.abs(prevVy);
          if (impactVy > 0.6) {
            marsFx.emitJumpBurst(px, phys.y, pz, {
              mode: "landing",
              impactSpeed: impactVy,
              rightX: Math.cos(jYaw),
              rightZ: -Math.sin(jYaw),
              fwdX: -Math.sin(jYaw),
              fwdZ: -Math.cos(jYaw),
              vx: phys.vx,
              vz: phys.vz,
            });
          }
        }
      }
    } else {
      px = lonToX(sample.lon);
      pz = latToZ(sample.lat);
      const target = routeHeading(alongM);
      let diff = target - autoYaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      autoYaw += diff * Math.min(1, dt * 1.6);
      const ground = sampleElevSceneY(px, pz);
      if (!player.grounded) {
        player.vy -= surfaceG * dt;
        player.y += player.vy * dt;
        if (player.y <= ground) {
          player.y = ground;
          player.vy = 0;
          player.grounded = true;
        }
      } else {
        player.y = ground;
      }
      player.x = px;
      player.z = pz;
      phys.x = px;
      phys.z = pz;
      phys.y = player.y;
      phys.grounded = player.grounded;
      freePos.set(px, player.y, pz);
    }

    const yaw = autoYaw + userYaw;
    const snappedThisFrame = justTeleportedOrWrapped;
    const movedXZ = Math.hypot(px - prevX, pz - prevZ);
    const mvx = px - prevX;
    const mvz = pz - prevZ;
    const step = !justTeleportedOrWrapped && movedXZ < 20 ? movedXZ : 0;
    justTeleportedOrWrapped = false;
    const groundSpeed = dt > 0 ? step / dt : 0;
    if (snappedThisFrame) {
      lastMoveYaw = null;
    } else if (step > 5e-4) {
      lastMoveYaw = Math.atan2(-mvx, -mvz);
    } else if (Math.hypot(phys.vx, phys.vz) > 0.05) {
      lastMoveYaw = Math.atan2(-phys.vx, -phys.vz);
    }

    self.group.position.set(px, player.y, pz);
    self.group.rotation.y = yaw;
    if (drivingRover) {
      self.group.visible = false;
    } else {
      self.group.visible = suitRig != null;
    }
    let gaitDir = null;
    if (step > 1e-5) {
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      gaitDir = { f: (mvx * fx + mvz * fz) / movedXZ, s: (mvx * -fz + mvz * fx) / movedXZ };
    }
    fwd.set(0, 0, -1).applyAxisAngle(UP, yaw);
    right.set(1, 0, 0).applyAxisAngle(UP, yaw);
    const uphillAlign = fwd.x * phys.uphillX + fwd.z * phys.uphillZ;
    const slopeRad = ((phys.slopeDeg || 0) * Math.PI) / 180;
    let lean = 0.08;
    let brake = 0;
    if (uphillAlign > 0.05) lean = torsoLeanRad(slopeRad * uphillAlign);
    else if (uphillAlign < -0.05) {
      lean = 0.08 + downhillLeanRad(slopeRad * -uphillAlign);
      brake = Math.min(1, -uphillAlign);
    }
    const feet = footSample(px, pz, yaw, player.y);
    const strikes = [];
    groundSpeedSm += (groundSpeed - groundSpeedSm) * Math.min(1, dt * 9);
    if (groundSpeedSm < 0.03 && step === 0) groundSpeedSm = 0;
    self.update(dt, step, groundSpeedSm, !player.grounded, gaitDir, {
      crouch: phys.crouch,
      lean,
      brake,
      ...feet,
      onStrike: (side) => strikes.push(side),
    });
    self.group.updateMatrixWorld(true);
    if (!drivingRover) {
      for (const side of strikes) {
        const bone = side === "L" ? self.bones.footL : self.bones.footR;
        if (!bone) continue;
        bone.getWorldPosition(footPos);
        const gy = sampleElevSceneY(footPos.x, footPos.z);
        const n = sampleNormal(footPos.x, footPos.z);
        footsteps.play(side, phys.faciesId);
        footsteps.stamp(footPos.x, gy, footPos.z, n, lastMoveYaw ?? yaw, phys.faciesId, side);
        if (devCfg.realisticDust && groundSpeed > 0.35 && movedXZ > 1e-5) {
          const runFast = groundSpeed > 1.9;
          marsFx.emitBurst(
            footPos.x,
            gy,
            footPos.z,
            runFast ? 6 : 3,
            runFast ? 1.1 : 0.72,
            -(mvx / movedXZ) * groundSpeed * 0.18,
            -(mvz / movedXZ) * groundSpeed * 0.18
          );
        }
      }
    }

    // helmet camera at the visor (or 3rd-person chase cam when driving MMSEV)
    const ph = self.phase ?? 0;
    const amt = Math.min(1, self.amount ?? 0);
    fwd.set(0, 0, -1).applyAxisAngle(UP, yaw);
    right.set(1, 0, 0).applyAxisAngle(UP, yaw);
    // Head bob: about 2 cm walking and 4 cm loping (low g lengthens the flight phase).
    // groundSpeed is measured from this frame's motion, so it is valid on route playback too
    // (phys.vx/vz are only stepped in free roam and go stale on the route).
    const bobAmp = player.grounded ? (groundSpeed >= FROUDE_LOPE_MS ? 0.04 : 0.02) : 0;
    const swayY = Math.sin(ph * 2) * bobAmp * amt;
    const swayX = Math.sin(ph) * 0.003 * amt;
    const micro = (f, a) => Math.sin(clockT * f) * a + Math.sin(clockT * f * 2.17 + 1.3) * a * 0.5;
    if (drivingRover && activeDriveRover?.group?.visible) {
      const rPos = activeDriveRover.group.position;
      const rYaw = activeDriveRover.group.rotation.y;
      const camDist = 6.9 + Math.min(1.6, Math.abs(roverThrottleVel) * 0.065) + (roverAirState.airborne ? 0.75 : 0);
      const elevAng = Math.max(0.06, Math.min(1.08, -pitch));
      const horizDist = camDist * Math.cos(elevAng);
      const heightOff = camDist * Math.sin(elevAng);
      const targetX = rPos.x - Math.sin(rYaw) * 0.4;
      const targetY = rPos.y + 1.45;
      const targetZ = rPos.z - Math.cos(rYaw) * 0.4;
      const desiredX = targetX + Math.sin(yaw) * horizDist;
      const desiredZ = targetZ + Math.cos(yaw) * horizDist;
      const groundUnderCam = sampleElevSceneY(desiredX, desiredZ);
      const desiredY = Math.max(targetY + heightOff, groundUnderCam + 0.65);

      if (!chaseCamInit || snappedThisFrame) {
        chaseCamPos.set(desiredX, desiredY, desiredZ);
        chaseLookTarget.set(targetX, targetY, targetZ);
        chaseCamInit = true;
      } else {
        const kCam = Math.min(1, dt * 11);
        chaseCamPos.x += (desiredX - chaseCamPos.x) * kCam;
        chaseCamPos.y += (desiredY - chaseCamPos.y) * kCam;
        chaseCamPos.z += (desiredZ - chaseCamPos.z) * kCam;
        const kTgt = Math.min(1, dt * 15);
        chaseLookTarget.x += (targetX - chaseLookTarget.x) * kTgt;
        chaseLookTarget.y += (targetY - chaseLookTarget.y) * kTgt;
        chaseLookTarget.z += (targetZ - chaseLookTarget.z) * kTgt;
      }
      const shake = Math.min(0.025, Math.abs(roverThrottleVel) * 0.0022);
      camera.position.set(chaseCamPos.x, chaseCamPos.y + Math.sin(clockT * 16) * shake, chaseCamPos.z);
      camera.lookAt(chaseLookTarget);
    } else if (thirdPersonWalk) {
      if (eyeBaseY == null || snappedThisFrame || Math.abs(player.y - eyeBaseY) > 0.8) eyeBaseY = player.y;
      else eyeBaseY += (player.y - eyeBaseY) * Math.min(1, dt * 14);
      const headX = px;
      const headY = eyeBaseY + EYE_HEIGHT_M - phys.crouch + 0.15;
      const headZ = pz;
      const cp = Math.cos(pitch);
      const viewX = -Math.sin(yaw) * cp;
      const viewY = Math.sin(pitch);
      const viewZ = -Math.cos(yaw) * cp;
      const dist = 3.4;
      let camX = headX - viewX * dist + right.x * 0.55;
      let camY = headY - viewY * dist + 0.3;
      let camZ = headZ - viewZ * dist + right.z * 0.55;
      if (habitatStation.group.visible) {
        const t = habitatStation.clipCameraSegment(headX, headY, headZ, camX, camY, camZ);
        if (t < 1) {
          const k = Math.max(0, t - 0.04);
          camX = headX + (camX - headX) * k;
          camY = headY + (camY - headY) * k;
          camZ = headZ + (camZ - headZ) * k;
        }
        const ceil = habitatStation.ceilingAt(camX, camZ);
        if (ceil != null) camY = Math.min(camY, ceil - 0.25);
      }
      camY = Math.max(camY, sampleElevSceneY(camX, camZ) + 0.35);
      if (!thirdCamInit || snappedThisFrame) {
        thirdCamPos.set(camX, camY, camZ);
        thirdCamInit = true;
      } else {
        // follow quickly, but snap inwards at once so walls never get between camera and walker
        const k = Math.min(1, dt * 14);
        thirdCamPos.x += (camX - thirdCamPos.x) * k;
        thirdCamPos.y += (camY - thirdCamPos.y) * k;
        thirdCamPos.z += (camZ - thirdCamPos.z) * k;
        if (Math.hypot(camX - headX, camZ - headZ) < Math.hypot(thirdCamPos.x - headX, thirdCamPos.z - headZ)) {
          thirdCamPos.set(camX, camY, camZ);
        }
      }
      camera.position.copy(thirdCamPos);
      camera.rotation.order = "YXZ";
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
      camera.rotation.z = 0;
    } else {
      const tip = Math.max(0, -pitch);
      const eyeFwd = EYE_FORWARD_M + tip * 0.1;
      if (eyeBaseY == null || snappedThisFrame || Math.abs(player.y - eyeBaseY) > 0.8) eyeBaseY = player.y;
      else eyeBaseY += (player.y - eyeBaseY) * Math.min(1, dt * 14);
      camera.position.set(
        px + fwd.x * eyeFwd + right.x * swayX,
        eyeBaseY + EYE_HEIGHT_M - phys.crouch - tip * 0.07 + swayY,
        pz + fwd.z * eyeFwd + right.z * swayX
      );
      camera.rotation.order = "YXZ";
      camera.rotation.y = yaw + micro(0.6, 0.0007);
      camera.rotation.x = pitch + micro(0.9, 0.0006);
      camera.rotation.z = Math.sin(ph) * 0.0025 * amt;
    }

    // Orbit-view arrival: the camera starts high above the walker looking down, then drops in two
    // stepped beats to the visor (camera only; physics and the walker are already on the ground).
    if (arrival) {
      const t = (now - arrival.t0) / 1000;
      const ease = (x) => {
        const c = Math.max(0, Math.min(1, x));
        return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
      };
      const H0 = arrival.reduced ? 0 : 240;
      const H1 = 48;
      let h;
      let moving = false;
      if (arrival.reduced) h = 0;
      else if (t < 0.3) h = H0;
      else if (t < 0.85) {
        h = H0 - (H0 - H1) * ease((t - 0.3) / 0.55);
        moving = true;
      } else if (t < 1.15) h = H1;
      else if (t < 1.95) {
        h = H1 * (1 - ease((t - 1.15) / 0.8));
        moving = true;
      } else h = 0;
      if (t > 2.3 || arrival.reduced) arrival = null;
      else {
        const look = Math.min(1, h / H1);
        camera.rotation.order = "YXZ";
        camera.position.y += h;
        camera.rotation.x = camera.rotation.x * (1 - look) + -1.48 * look;
        if (moving) {
          camera.position.x += (Math.random() - 0.5) * 0.002 * h;
          camera.position.z += (Math.random() - 0.5) * 0.002 * h;
        }
      }
    }

    // Rocket landing cinematic: no characters on screen, the camera belongs to the sequence
    if (landing.active) {
      if (self?.group) self.group.visible = false;
      // no characters on screen: the station crew stays out of sight until the landing is over
      npcManager.npcGroup.visible = false;
      landingHidNpcs = true;
      landing.update(dt, camera, clockT);
    } else if (landingHidNpcs) {
      landingHidNpcs = false;
      npcManager.npcGroup.visible = habitatStation.group.visible;
    }

    // Smoothly animate live multiplayer crewmates
    const lerpAlpha = Math.min(1, dt * 12);
    for (const remote of remoteAvatars.values()) {
      const prevRx = remote.cur.x;
      const prevRz = remote.cur.z;
      remote.cur.x += (remote.target.x - remote.cur.x) * lerpAlpha;
      remote.cur.y += (remote.target.y - remote.cur.y) * lerpAlpha;
      remote.cur.z += (remote.target.z - remote.cur.z) * lerpAlpha;
      remote.cur.yaw = lerpAngleRad(remote.cur.yaw, remote.target.yaw, lerpAlpha);
      const rStep = Math.hypot(remote.cur.x - prevRx, remote.cur.z - prevRz);
      const rSpeed = dt > 0 ? Math.max(rStep / dt, remote.target.speed * 0.5) : 0;
      remote.group.position.set(remote.cur.x, remote.cur.y, remote.cur.z);
      remote.group.rotation.y = remote.cur.yaw;
      const remoteFeet = footSample(remote.cur.x, remote.cur.z, remote.cur.yaw, remote.cur.y);
      remote.avatar.update(dt, rStep < 20 ? rStep : 0, rStep < 20 ? rSpeed : 0, remote.target.airborne, null, {
        ...remoteFeet,
        lean: 0.08,
      });
    }

    // Throttled broadcast of local position/yaw/mode to crewmates + 2D planner
    const curLon = xToLon(px);
    const curLat = zToLat(pz);
    const movedOrTurned =
      !lastSentPose ||
      Math.hypot(px - lastSentPose.x, pz - lastSentPose.z) > 0.04 ||
      Math.abs(player.y - lastSentPose.y) > 0.04 ||
      Math.abs(yaw - lastSentPose.yaw) > 0.03 ||
      !player.grounded !== lastSentPose.airborne;
    if (now - lastMpSendMs > 1200 || (movedOrTurned && now - lastMpSendMs > 65)) {
      lastMpSendMs = now;
      lastSentPose = { x: px, y: player.y, z: pz, yaw, airborne: !player.grounded };
      const posePayload = {
        x: Number(px.toFixed(3)),
        y: Number(player.y.toFixed(3)),
        z: Number(pz.toFixed(3)),
        lon: Number(curLon.toFixed(6)),
        lat: Number(curLat.toFixed(6)),
        yaw: Number(yaw.toFixed(4)),
        speed: Number(groundSpeed.toFixed(2)),
        airborne: !player.grounded,
        freeRoam,
        alongM: Number(alongM.toFixed(1)),
      };
      mp?.sendState(posePayload);
      onLocalPose?.(posePayload);
    }
    updateContactShadows();

    // Update windblown Mars aerosol dust, kickup plumes & REMS atmospheric haze + dust optical depth
    const atm = marsFx.update(dt, camera.position, clockT, {
      dustEnabled: Boolean(devCfg.realisticDust),
      weatherEnabled: Boolean(devCfg.realisticWeather),
    });
    const tau = devCfg.dustTau ?? 0.5;
    const tauDim = Math.exp(-0.28 * (tau - 0.5));
    const weatherDim = devCfg.realisticWeather ? 1.0 - atm.gustFactor * 0.14 : 1.0;
    const tauFogScale = 0.55 + tau * 0.85;
    if (scene.fog) {
      scene.fog.density = atm.fogDensity * tauFogScale;
      // Fog takes the horizon colour, dimmed through twilight to near-black at night.
      const tw = Math.max(0, Math.min(1, (sunState.elevationRad + 0.32) / 0.44));
      scene.fog.color.copy(HORIZON).multiplyScalar(0.025 + 0.975 * tw * tw * (3 - 2 * tw));
    }

    // sun, moons and shadow box follow the walker
    const texel = (2 * shadowHalfM) / shadowMapPx;
    const groundY = sampleElevSceneY(px, pz);
    sun.target.position.set(Math.round(px / texel) * texel, Math.round(groundY / texel) * texel, Math.round(pz / texel) * texel);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 400);
    sky.position.copy(camera.position);
    skyMoons.position.copy(camera.position);
    celestial.group.position.copy(camera.position);
    updateMoons(camera.position);
    footsteps.update(dt, phys.g || surfaceG);
    rockField.update(px, pz, sampleElevSceneY, Boolean(devCfg.superGraphics));
    historicRovers.update(dt, { sampleElevY: sampleElevSceneY, observerPos: camera.position, clockT });
    if (npcManager.npcGroup.visible) {
      npcManager.update(dt, { x: px, z: pz, y: player.y }, clockT, {
        activeNpcId: npcDialogueUi.getActiveNpc()?.id || null,
        terrainSampler: sampleElevSceneY,
      });
    }
    dustDevil.update(dt, px, pz, groundY, Boolean(devCfg.dustDevil));
    lensMat.uniforms.uDust.value = Math.min(1, lensMat.uniforms.uDust.value + step / 650);
    const sunUpNow = sunUp(sunState.elevationRad);
    sun.intensity = baseSunIntensity * (sunState.fluxWm2 / 590) * tauDim * weatherDim * sunTransit * sunUpNow;
    sun.castShadow = sunUpNow > 0.01;
    window.MartianWeather?.update?.({
      THREE,
      scene,
      camera,
      sun,
      hemiLight,
      player: { x: px, y: player.y, z: pz },
      groundY,
      dt,
      sampleElevY: sampleElevSceneY,
    });
    // The sun moves ~0.25°/min: refresh the direction every 30 s, re-bake terrain shadows every ~10 min.
    if (now - sunStateStampMs > 30000) {
      refreshSun({ rebake: now - lastSunBakeMs > 600000 });
    }

    // the HUD text & rover reticle inspection only need ~10 updates a second
    hudTimer += dt;
    if (hudTimer > 0.1) {
      hudTimer = 0;
      const metW = metabolicPowerW({
        eta: phys.eta,
        gMs2: phys.g || surfaceG,
        speedMs: drivingRover ? 0 : groundSpeed,
        gradePercent: phys.gradePercent,
      });
      const metEl = document.getElementById("hud-metabolic");
      if (metEl) {
        const svf = skyViewFactor(sampleElevSceneY, px, pz);
        metEl.textContent = `METABOLIC: ${metW.toFixed(0)} W · ${oxygenLitresPerMin(metW).toFixed(2)} L/min O₂ (Pandolf stand-in) · SVF ${svf.toFixed(2)} illustrative`;
      }
      updateCrewHudSummary();
      if (freeRoam) {
        updateHudReadouts(alongM, xToLon(px), zToLat(pz), phys.slopeDeg);
      } else {
        updateHudReadouts(alongM, sample.lon, sample.lat);
      }
      if (optZoom > 1) {
        const readout = document.getElementById("hud-zoom-readout");
        camera.getWorldDirection(lookDir);
        let dist = 1.5;
        let hit = null;
        for (let i = 0; i < 22; i++) {
          const x = camera.position.x + lookDir.x * dist;
          const y = camera.position.y + lookDir.y * dist;
          const z = camera.position.z + lookDir.z * dist;
          if (y < sampleElevSceneY(x, z) + 0.2) {
            hit = dist;
            break;
          }
          dist *= 1.28;
        }
        if (readout) readout.textContent = hit ? `${optZoom}×  ${hit.toFixed(0)} m` : `${optZoom}×`;
      }
      if (!isMapOpen() && !hasOpenModalOverlay()) {
        const aimX = isPointerLocked() ? null : lastMouseClient.valid ? lastMouseClient.x : null;
        const aimY = isPointerLocked() ? null : lastMouseClient.valid ? lastMouseClient.y : null;
        const hitNpc = pickTargetNpc(aimX, aimY);
        const nearNpc =
          !hitNpc && !drivingRover && npcManager.npcGroup.visible
            ? npcManager.getNearestInteractableNpc(freePos.x, freePos.z, 4.4, freePos, lookDir)?.npc || null
            : null;
        const activeTargetNpc = hitNpc || nearNpc;
        const hitSpec = activeTargetNpc ? null : pickHistoricRover(aimX, aimY);
        if (activeTargetNpc !== hoveredNpcEntry || hitSpec !== hoveredRoverSpec) {
          hoveredNpcEntry = activeTargetNpc;
          hoveredRoverSpec = hitSpec;
          reticleEl?.classList.toggle("target-rover", Boolean(activeTargetNpc || hitSpec));
          if (roverTargetEl) {
            const tr = isTrLang();
            if (activeTargetNpc) {
              const s = activeTargetNpc.spec;
              const roleText = (tr ? s.role?.tr || s.role?.en : s.role?.en) || s.tagText || "";
              roverTargetEl.textContent = `${s.name.toUpperCase()}${roleText ? ` (${roleText})` : ""} · ${
                tr ? "KONUŞ [E] / TIKLA" : "TALK [E] / CLICK"
              }`;
              roverTargetEl.classList.add("visible");
            } else if (hitSpec) {
              roverTargetEl.textContent = `${hitSpec.name.toUpperCase()} (${hitSpec.mission}) · ${
                tr ? "ETKİLEŞİM [E] / TIKLA" : "INTERACT [E] / CLICK"
              }`;
              roverTargetEl.classList.add("visible");
            } else {
              roverTargetEl.classList.remove("visible");
            }
          }
        }
      } else if (hoveredNpcEntry || hoveredRoverSpec) {
        hoveredNpcEntry = null;
        hoveredRoverSpec = null;
        reticleEl?.classList.remove("target-rover");
        roverTargetEl?.classList.remove("visible");
      }
    }
    curvAnchor.value.set(camera.position.x, camera.position.z);
    followEndless(camera.position);
    updateCorridorChunks(camera.position.x, camera.position.z, dt);

    goldSlide += (goldVisor - goldSlide) * Math.min(1, dt * 6.0);
    if (Math.abs(goldVisor - goldSlide) < 0.002) goldSlide = goldVisor;

    camera.getWorldDirection(lookDir);
    if (evaLampOn && !drivingRover) {
      const autoBoost = sunState.elevationRad < 0.25 ? 1.55 : 1.0;
      evaLamp.intensity = 28.0 * autoBoost;
      evaLamp.position.copy(camera.position).add(new THREE.Vector3(0, 0.14, 0));
      evaLamp.target.position.copy(camera.position).addScaledVector(lookDir, 12);
      evaLamp.target.updateMatrixWorld();
    } else {
      evaLamp.intensity = 0;
    }

    const headingDeg = (((-yaw * 180) / Math.PI) % 360 + 360) % 360;
    const pitchDeg = (pitch * 180) / Math.PI;
    const stopCoord = nextPovStop?.geometry?.coordinates;
    const stopBearingDeg =
      Array.isArray(stopCoord) && stopCoord.length >= 2 && Number.isFinite(curLon) && Number.isFinite(curLat)
        ? marsBearingDeg([curLon, curLat], stopCoord)
        : NaN;
    const sunBearingDeg = (((Math.atan2(sunDir.x, -sunDir.z) * 180) / Math.PI) % 360 + 360) % 360;
    updateWaveguideOptics(headingDeg, pitchDeg, heightEnv.molaElevM(px, pz), stopBearingDeg, sunBearingDeg);

    adaptResolution(dt * 1000, now);
    lensMat.uniforms.uTime.value = clockT;
    lensMat.uniforms.uGold.value = goldVisor;
    lensMat.uniforms.uGoldSlide.value = goldSlide;
    lensMat.uniforms.uOptZoom.value = optZoom;
    lensMat.uniforms.uGlint.value = Math.max(0, lookDir.dot(sunDir)) * sunUpNow;
    lensMat.uniforms.uExposure.value = 1.0;
    rtUniforms.uRtTime.value = clockT;
    rtUniforms.uRtSunDir.value.copy(sunDir);
    if (devCfg.rayTracing) {
      lensMat.uniforms.uRtProj.value.copy(camera.projectionMatrix);
      lensMat.uniforms.uRtInvProj.value.copy(camera.projectionMatrixInverse);
    }
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(lensScene, lensCam);
  }
  // Stream in the 1 m terrain where the EVA starts before the first frame (veil still up).
  if (routeCoords.length > 1) await warmCorridorAt(lonToX(routeCoords[0][0]), latToZ(routeCoords[0][1]));
  else await warmCorridorAt(freePos.x, freePos.z);
  requestAnimationFrame(animate);
  loadingVeil?.classList.add("done");

  return {
    onResize: () => {
      onResize();
    },
    dropLocalPing,
    visitRoverSite,
    deployToHardwareSite,
    returnToHabitat,
    getActiveSiteId: () => activeSiteId,
    syncAlongM: (s) => {
      // Crew route sync: move this walker onto the shared route position (the route is at Gale).
      const target = Math.max(0, Math.min(totalDist, Number(s) || 0));
      if (routeCoords.length < 2) return;
      if (!isGaleSite()) switchSite(getHistoricRoverById("curiosity"));
      const rp = routePoint(target);
      teleportToLocal(rp.x, rp.z, { keepYaw: false });
      alongM = target; // after the teleport, so the ±80 m route search starts from the synced point
      if (scrubber) scrubber.value = alongM.toFixed(1);
    },
    /** Teleport to a lon/lat anywhere on Mars (HiRISE at Gale, procedural relief elsewhere). */
    teleportTo: (lon, lat) => visitLocation(lon, lat, { keepYaw: true }),
    visitLocation,
    /**
     * Rocket landing cinematic, then the EVA starts beside the lander. `site` is the caption.
     * The lander touches down about 47 m south-east of where you will stand.
     */
    playLanding: ({ site = null } = {}) => {
      keys.clear();
      dragging = false;
      const yaw = autoYaw + userYaw;
      // the lander touches down on open ground: the habitat station lies north of the entry point,
      // so the pad is to the south-east of where you will stand (about 47 m away)
      const padX = freePos.x + 30;
      const padZ = freePos.z + 36;
      landing.start({ x: freePos.x, z: freePos.z, yaw, padX, padZ, site: site || undefined });
    },
    isLandingActive: () => landing.active,
    seekLanding: (t) => landing.seek(t),
    /** Camera drop from ~240 m to the visor after an Orbit-view descent. */
    playArrivalDrop: () => {
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
      arrival = { t0: performance.now(), reduced };
    },
    getLonLat: () => ({ lon: xToLon(player.x), lat: zToLat(player.z), siteId: activeSiteId }),
    setSunMode,
    getSunMode: () => sunMode,
    cycleTex: () => setTexMode((texMode + 1) % TEX.length),
    openRoverPov: openNextPov,
  };
}
