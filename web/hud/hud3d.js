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
// three/addons/loaders/KTX2Loader.js, three/addons/controls/PointerLockControls.js
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import seedrandom from "seedrandom";
import { createNoise2D } from "simplex-noise";
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
import {
  MARS_ATMO_HAZE_FRAG_APPLY,
  MARS_ATMO_HAZE_FRAG_PARS,
  MARS_ATMO_HAZE_VERT_PARS,
  createAtmosphericHazeUniforms,
  patchAtmosphericHaze,
  updateAtmosphericHazeUniforms,
} from "./MarsAtmosphereHaze.js";
import { createLandingSequence } from "./landing-sequence.js";
import { createRoverDynamics, roverParamsFor, roverParamsForHistoric } from "./rover-dynamics.js";
import { resolveRoverObbCollision as obbPushOut } from "./experimental-rover.js";
import { attachSuspensionRig } from "./rover-rig.js";
import { createRoverDash } from "./rover-dash.js";
import { gamepad } from "../shared/gamepad.js";
import { createFieldKits } from "./FieldKits.js";
import { createMartianPbrTextureSets } from "../map/MarsPbrTextures.js";
import {
  loadDevSettings,
  saveDevSettings,
  subscribeDevSettings,
} from "../shared/dev-settings.js";
import {
  buildHardwareSummary,
  chunkSegmentsFor,
  estimateSceneVramMb,
  resolveGraphics,
} from "../shared/graphics-profile.js";
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
import { createRegolithDust } from "./regolith-dust.js";
import { drawTelemetryScreenOnCtx } from "./habitat-textures.js";
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
import {
  buildSiteElevationSampler,
  computeTaskProgress,
  generateVehicleRoutes,
  getTaskTargetRover,
  getTaskVehicleProfile,
  isTeleportLockedForTask,
  selectHabitatStagingSpot,
} from "../shared/task-router.js";
import { createTaskGuide3D, createTaskUiController } from "./hud-tasks.js";
import { GaleCorridor, buildCorridorSubCellGeometry, chunkSlopeRgba } from "../map/GaleCorridor.js";
import { computeBvhForObject, createMarsPostPipeline, effectivePixelRatio, installBvhAcceleration } from "./post-pipeline.js";

const ASTRONAUT_HEIGHT_M = 1.8;
// Column dust optical depth used for the sky, moons, haze and fog: a typical clear-season value
// at Gale (Curiosity Mastcam tau is mostly 0.3-0.8 outside dust-storm season). Fixed: no weather.
const MARS_DUST_TAU = 0.5;
const EYE_HEIGHT_M = 1.64; // eye level inside the helmet of a 1.80 m astronaut
const EYE_FORWARD_M = 0.36; // at the visor, ahead of the suit's deep chest so the legs show when looking down
const PARTNER_AHEAD_M = 6;
const PARTNER_COLLISION_R = 1.05; // solid suit + backpack + 0.36 m visor clearance
const TILE_RING = 1; // mirrored copies out to 1 tile in every direction (3x3 = >6km x 16km, well past fog horizon)

// NASA 3D Resources models, tried in order (first one that loads wins). The Z2 suit
// (16.9 MB, NASA's Mars-oriented prototype) can be added in front of this list once downloaded
// to ./assets/nasa-3d/z2-spacesuit.glb.
const SUIT_MODELS = [
  {
    url: "./assets/nasa-3d/mark-iii-spacesuit.glb",
    label: "NASA MARK III · H-SUIT MESH · PROCEDURAL GAIT",
  },
  {
    url: "./assets/nasa-3d/advanced-crew-escape-suit.glb",
    label: "NASA ACES · LAUNCH/ENTRY MESH · PROCEDURAL GAIT",
  },
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

// Tileable Simplex-noise texture (simplex-noise + seedrandom) for close-range ground detail,
// paired with KTX2Loader for pre-baked .ktx2 textures when available.
function makeDetailTexture(size = 512) {
  const rng = seedrandom("mars-ground-detail-simplex-v2");
  const noise2D = createNoise2D(rng);
  const samplePeriodicSimplex = (u, v, freq) => {
    const a = u * Math.PI * 2;
    const b = v * Math.PI * 2;
    const r = freq / (Math.PI * 2);
    const n1 = noise2D(Math.cos(a) * r, Math.sin(a) * r + Math.cos(b) * r * 0.71);
    const n2 = noise2D(Math.sin(b) * r, Math.cos(b) * r - Math.sin(a) * r * 0.71);
    return 0.5 + 0.25 * (n1 + n2);
  };
  const octaves = [
    { n: 8, w: 0.36 },
    { n: 16, w: 0.24 },
    { n: 32, w: 0.18 },
    { n: 64, w: 0.13 },
    { n: 128, w: 0.09 },
  ];
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      let val = 0;
      for (const o of octaves) {
        val += samplePeriodicSimplex(u, v, o.n) * o.w;
      }
      const p = (y * size + x) * 4;
      const byte = Math.max(0, Math.min(255, Math.round(val * 255)));
      data[p] = data[p + 1] = data[p + 2] = byte;
      data[p + 3] = 255;
    }
  }
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    if (ctx) {
      const img = ctx.createImageData(size, size);
      img.data.set(data);
      ctx.putImageData(img, 0, 0);
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.NoColorSpace;
      return tex;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
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

/**
 * Mars sky dome: the project's own butterscotch gradient shader (dust-tau tint, small solar disc,
 * blue sunset glow, twilight and night). Driven by the `uZenith`, `uHorizon`, `uGround`, `uSunDir`,
 * `uTau`, `uSunElev` and `uSunCos` uniforms that `refreshSun`, `applyDevSettings` and the
 * environment rebuild write to.
 */
function createMarsSkyDome(THREE, { zenith, horizon, ground, sunDir, sunState }) {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(12500, 48, 24),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: zenith },
        uHorizon: { value: horizon },
        uGround: { value: ground },
        uSunDir: { value: sunDir },
        uTau: { value: 0.5 },
        uSunElev: { value: sunState.elevationRad },
        uSunCos: { value: Math.cos(sunState.sunAngularRad * 0.5) },
      },
    })
  );
  sky.renderOrder = -2;
  return sky;
}

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

// Helmet lens state (distortion, gold visor, zoom). The frame itself is drawn by post-pipeline.js;
// lensMat only holds these uniforms.
const LENS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

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

  void main() {
    float aspect = uResolution.x / max(1.0, uResolution.y);
    vec2 c = vUv - 0.5;
    c.x *= aspect;
    float r2 = dot(c, c);
    float dist = 1.0 + uDistort * r2 + 0.35 * uDistort * r2 * r2;
    vec2 d = (c * dist * uFrameZoom) / max(1.0, uOptZoom);
    d.x /= aspect;
    vec2 uv = clamp(d + 0.5, 0.0, 1.0);
    vec3 col = texture2D(tDiffuse, uv).rgb * uExposure;
    float goldAmt = clamp(max(uGoldSlide, uGold * 0.001), 0.0, 1.0);
    if (goldAmt > 0.002) {
      vec3 goldCol = (col / (1.0 + col * 0.14)) * vec3(1.16, 0.80, 0.36);
      col = mix(col, goldCol, goldAmt);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

export async function initHud3D(
  data,
  { onOpenMenu = null, onBackToPlanner, onOpenPov, onOpenRoverInfo = null, onLocalPose = null, onOpenOrbit = null }
) {
  const openPauseMenu = onOpenMenu || onBackToPlanner;
  const { costMap, route, stops, telemetry, dose, alerts, weather, povIndex, assets } = data;
  let surfaceG = 3.717;
  const wrap = document.getElementById("hud-canvas-wrap");
  const loadingVeil = document.getElementById("hud-loading");
  // The veil names the step it is on, so a stuck load shows where; slow steps give up after a while
  // (the suit falls back to the next model, then to a stand-in) instead of hanging forever.
  // It writes into the stage line only: the veil also holds the animation and a note.
  const loadStage = (t) => {
    const el = document.getElementById("hud-loading-stage");
    if (el) el.textContent = t;
  };
  const withTimeout = (promise, ms, label) =>
    Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms / 1000} s`)), ms))]);
  let devCfg = loadDevSettings();
  // hint text for the device used last: keyboard key, or the bound controller button's glyph
  const kh = (key, action) => gamepad.hint(key, action);
  const isTrLang = () => {
    try {
      return localStorage.getItem("mm-lang") === "tr";
    } catch {
      return false;
    }
  };

  // Loading screen: name the step that is running, and give the browser a moment to paint it
  // (setTimeout, not requestAnimationFrame, which never fires in a background tab).
  const loadingStageEl = document.getElementById("hud-loading-stage");
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const setLoadStage = async (en, tr) => {
    if (loadingStageEl) loadingStageEl.textContent = isTrLang() ? tr : en;
    await pause(20);
  };
  // Every texture and model goes through three's default loading manager. The loading screen stays
  // up until it is idle, so no model pops in (and no shader compiles) after the EVA has started.
  let loadsBusy = false;
  let onLoadsIdle = null;
  THREE.DefaultLoadingManager.onStart = () => {
    loadsBusy = true;
  };
  THREE.DefaultLoadingManager.onLoad = () => {
    loadsBusy = false;
    onLoadsIdle?.();
  };
  /** Resolves when nothing is downloading or decoding, or after `maxMs` (a stuck file must not block the EVA). */
  const waitForLoads = async (maxMs) => {
    const t0 = performance.now();
    for (;;) {
      await pause(60); // lets finished loads attach their models
      if (!loadsBusy) return true;
      const left = maxMs - (performance.now() - t0);
      if (left <= 0) return false;
      await Promise.race([new Promise((r) => (onLoadsIdle = r)), pause(left)]);
      onLoadsIdle = null;
    }
  };
  await setLoadStage("Reading HiRISE elevation", "HiRISE yükseklik verisi okunuyor");

  // Streamed HiRISE corridor (habitat -> Glen Torridon, real 1 m DTM in chunks). When it is missing,
  // the world falls back to the single height-preview tile.
  const corridor = assets.corridorBaseUrl
    ? await withTimeout(GaleCorridor.load(assets.corridorBaseUrl), 40000, "corridor terrain").catch((err) => {
        console.warn("[corridor] gave up:", err?.message || err);
        return null; // the single height tile is used instead
      })
    : null;

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
  /** True when a lon/lat lies on the real HiRISE Gale corridor tile. */
  const insideGaleTile = (lon, lat) =>
    lon >= bounds.west_lon_deg &&
    lon <= bounds.east_lon_deg &&
    lat >= bounds.south_lat_deg &&
    lat <= bounds.north_lat_deg;
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
  const galeLonToX = (lon) => ((lon - bounds.west_lon_deg) / (bounds.east_lon_deg - bounds.west_lon_deg) - 0.5) * worldW;
  const galeLatToZ = (lat) => (0.5 - (lat - bounds.south_lat_deg) / (bounds.north_lat_deg - bounds.south_lat_deg)) * worldH;
  const xToLon = (x) => {
    if (isGaleSite()) {
      const u = x / worldW + 0.5;
      return bounds.west_lon_deg + u * (bounds.east_lon_deg - bounds.west_lon_deg);
    }
    const rad = Math.PI / 180;
    const mPerDeg = MARS_RADIUS_MEAN_M * cosLatClamped(activeSiteRover.lat) * rad;
    const lon = activeSiteRover.lon + x / mPerDeg;
    return ((((lon + 180) % 360) + 360) % 360) - 180;
  };
  const zToLat = (z) => {
    if (isGaleSite()) {
      const v = 0.5 - z / worldH;
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
    loadStage(isTrLang() ? "Durakların zemini yükleniyor" : "Loading the ground at the stops");
    await Promise.all(jobs);
  }

  await setLoadStage("Building the surface", "Yüzey oluşturuluyor");
  // ---------- renderer, scene, camera ----------
  const scene = new THREE.Scene();
  const HORIZON = new THREE.Color(0.62, 0.43, 0.3);
  scene.fog = new THREE.FogExp2(HORIZON.getHex(), 0.00042);

  const camera = new THREE.PerspectiveCamera(78, 1, 0.06, 15000);

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  // Performance: draw at most 1.25 device pixels per CSS pixel; adaptive scaling below lowers it further.
  // Graphics preset (pixel ratio, MSAA, shadows, terrain radius...): see shared/graphics-profile.js.
  const gfxHw = (() => {
    let gpu = "";
    let driverVramMb = 0;
    let maxTextureSize = 4096;
    try {
      const gl = renderer.getContext();
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
      maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096;
      const nvx = gl.getExtension("NVX_gpu_memory_info") || gl.getExtension("WEBGL_memory_info");
      if (nvx) {
        const dedKb = Number(gl.getParameter(0x9047)) || Number(gl.getParameter(0x9048)) || 0;
        if (dedKb > 0) driverVramMb = Math.round(dedKb / 1024);
      } else {
        const ati = gl.getExtension("ATI_meminfo");
        if (ati) {
          const vboFree = gl.getParameter(0x87FB);
          if (vboFree && vboFree[0] > 0) driverVramMb = Math.round(vboFree[0] / 1024);
        }
      }
    } catch {
      /* the GPU name is only a hint */
    }
    return {
      gpu,
      driverVramMb,
      maxTextureSize,
      cores: navigator.hardwareConcurrency,
      memoryGb: navigator.deviceMemory,
      mobile: /Android|iPhone|iPad/i.test(navigator.userAgent),
    };
  })();
  let hwSummary = buildHardwareSummary(gfxHw);
  let gfx = resolveGraphics(devCfg, gfxHw);

  const getLiveHardwareTelemetry = () => {
    const mInfo = renderer.info?.memory || { geometries: 0, textures: 0 };
    const w = (typeof rt !== "undefined" && rt?.width) || renderer.domElement?.width || 1920;
    const h = (typeof rt !== "undefined" && rt?.height) || renderer.domElement?.height || 1080;
    const samples = gfx.aa === "msaa" ? 4 : 0;
    const sceneVramMb = estimateSceneVramMb({
      rtWidth: w,
      rtHeight: h,
      rtSamples: samples,
      rtHasDepth: gfx.ao !== "off",
      shadowPx: gfx.shadowMapPx || 0,
      textures: mInfo.textures || 0,
      geometries: mInfo.geometries || 0,
      triangles: renderer.info?.render?.triangles || 0,
      realisticTextures: Boolean(devCfg.realisticTextures),
    });
    const mem = typeof performance !== "undefined" ? performance.memory : null;
    const jsHeapUsedMb = mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : 0;
    const jsHeapLimitMb = mem ? Math.round(mem.jsHeapSizeLimit / 1048576) : 0;
    return {
      ...hwSummary,
      sceneVramMb,
      jsHeapUsedMb,
      jsHeapLimitMb,
      geometries: mInfo.geometries || 0,
      textures: mInfo.textures || 0,
      rtWidth: w,
      rtHeight: h,
      gfxLevel: gfx.level,
      antialias: gfx.aa,
      ambientOcclusion: gfx.ao,
    };
  };
  if (typeof window !== "undefined") {
    window.__mmGetHardwareTelemetry = getLiveHardwareTelemetry;
    const isDemo = new URLSearchParams(window.location.search).has("demo");
    if (!isDemo && typeof fetch === "function") {
      fetch("/api/hw/info", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data && data.ok) {
            if (Number(data.totalMemGb) > 0) gfxHw.osRamGb = Number(data.totalMemGb);
            if (Number(data.freeMemGb) >= 0) gfxHw.osFreeRamGb = Number(data.freeMemGb);
            if (data.cpuModel) gfxHw.cpuModel = String(data.cpuModel);
            if (Number(data.cpuCores) > 0) gfxHw.cores = Number(data.cpuCores);
            hwSummary = buildHardwareSummary(gfxHw);
            gfx = resolveGraphics(devCfg, gfxHw);
            window.dispatchEvent(new CustomEvent("mm:hw-info", { detail: getLiveHardwareTelemetry() }));
          }
        })
        .catch(() => {
          /* static server without /api/hw/info: client-side hardware detection remains active */
        });
    }
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, gfx.pixelRatioCap));
  renderer.info.autoReset = false; // reset once per frame, so the counters cover every pass
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCF: crisp enough, far cheaper than PCFSoft
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
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
  const SHADOW_HALF_M = 18; // crisp texel density around the walker at lower GPU fill cost
  const SHADOW_MAP_PX = 1024;
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
  // height-layered aerial-perspective haze (MarsAtmosphereHaze.js), at the fixed dust optical depth
  const atmoUniforms = createAtmosphericHazeUniforms(THREE, {
    horizonColor: HORIZON,
    zenithColor: ZENITH,
    groundColor: SKY_GROUND,
    sunDir,
    sunElev: sunState.elevationRad,
    tau: MARS_DUST_TAU,
    baseY: 0.0,
  });
  installBvhAcceleration(THREE);
  const sky = createMarsSkyDome(THREE, {
    zenith: ZENITH,
    horizon: HORIZON,
    ground: SKY_GROUND,
    sunDir,
    sunState,
  });
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
    const hImg = await withTimeout(loadImage(assets.heightPreviewUrl), 30000, "height map");
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

  const CHUNK_SUBDIV = 2; // split 256x256 corridor data blocks into 128x128 px (~129 m) terrain chunks
  const chunkMeshes = new Map(); // "a,b" -> { a, b, ci, cj, seg, edgeMask, mesh, ready, disposed }

  // Bilinear height (scene Y, metres above site base), mirror-wrapped beyond the tile.
  // At Gale (Curiosity), samples real HiRISE DTM (1 m detail chunks where streamed in and visible,
  // else the overview grid); at other rover sites, uses deterministic site relief.
  function rawSampleElevSceneY(x, z) {
    if (corridor && isGaleSite()) {
      if (chunkMeshes.size > 0) {
        const cell = corridor.subSceneCellOf(x, z, CHUNK_SUBDIV);
        const cm = chunkMeshes.get(`${cell.a},${cell.b}`);
        if (!cm || !cm.ready || !cm.mesh?.visible) return sampleBaseSceneY(x, z);
        const d = corridor.sampleDetail(x, z);
        if (d === null) return sampleBaseSceneY(x, z);
        const detailY = d - elevMin;
        const mask = cm.edgeMask ?? 15;
        if (mask !== 15) {
          const subW = corridor.chunkW / CHUNK_SUBDIV;
          const subH = corridor.chunkH / CHUNK_SUBDIV;
          const lx = x - (-corridor.worldW / 2 + cell.a * subW);
          const lz = z - (-corridor.worldH / 2 + cell.b * subH);
          let edgeDistM = Infinity;
          if (!(mask & 4)) edgeDistM = Math.min(edgeDistM, lx);
          if (!(mask & 8)) edgeDistM = Math.min(edgeDistM, subW - lx);
          if (!(mask & 1)) edgeDistM = Math.min(edgeDistM, lz);
          if (!(mask & 2)) edgeDistM = Math.min(edgeDistM, subH - lz);
          if (edgeDistM < 10) {
            const t = Math.max(0, edgeDistM / 10);
            const s = t * t * (3 - 2 * t);
            const baseY = sampleBaseSceneY(x, z);
            return baseY + (detailY - baseY) * s;
          }
        }
        return detailY;
      }
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

  /** Direct Gale HiRISE elevation query regardless of currently loaded procedural site. */
  function sampleGaleGridSceneY(x, z) {
    if (corridor && isGaleSite()) return rawSampleElevSceneY(x, z);
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

  computeBvhForObject(THREE, habitatStation.group);
  computeBvhForObject(THREE, rockField.group);
  computeBvhForObject(THREE, galeVista);

  /** Unit ground normal. Pass `out` to reuse an object (hot paths); without it a new one is returned. */
  function sampleNormal(x, z, out = { x: 0, y: 1, z: 0 }) {
    const e = 0.35;
    const nx = sampleRenderedSurfaceY(x - e, z) - sampleRenderedSurfaceY(x + e, z);
    const nz = sampleRenderedSurfaceY(x, z - e) - sampleRenderedSurfaceY(x, z + e);
    const ny = 2 * e;
    const len = Math.hypot(nx, ny, nz) || 1;
    out.x = nx / len;
    out.y = ny / len;
    out.z = nz / len;
    return out;
  }

  function footSample(x, z, yaw, bodyY) {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const one = (side) => {
      const px = x + fx * 0.16 + rx * side * 0.12;
      const pz = z + fz * 0.16 + rz * side * 0.12;
      return { dy: sampleRenderedSurfaceY(px, pz) - bodyY, n: sampleNormal(px, pz) };
    };
    const L = one(-1);
    const R = one(1);
    return { footDyL: L.dy, footDyR: R.dy, normalL: L.n, normalR: R.n };
  }

  // The base mesh (whole tile / corridor overview) never uses the streamed detail: detail chunks
  // draw their own meshes on top, and the base is cut away under them in the shader.
  function buildTerrainGeometry(segX, segZ = segX, { includeHabitat = true } = {}) {
    const g = new THREE.PlaneGeometry(worldW, worldH, segX, segZ);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const baseY = sampleBaseSceneY(x, z);
      pos.setY(i, includeHabitat ? withHabitat(x, z, baseY) : baseY);
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

  // Corridor: high-res 1 m chunks cover 720 m around player, so ~16 m base overview grid suffices; single tile caps at ~192x192.
  const fullSeg = elevGrid ? (corridor ? Math.max(1, Math.floor((imgW - 1) / 2)) : Math.min(imgW - 1, 192)) : 1;
  const fullSegZ = corridor ? Math.max(1, Math.floor((imgH - 1) / 2)) : fullSeg;
  const copySeg = Math.max(1, Math.floor(fullSeg / 3));
  const copySegZ = Math.max(1, Math.floor(fullSegZ / 3));
  let terrainGeom = buildTerrainGeometry(fullSeg, fullSegZ, { includeHabitat: true });
  // immediate mirrored ring keeps full overview resolution (without a phantom habitat pad)
  let ringCopyGeom = buildTerrainGeometry(fullSeg, fullSegZ, { includeHabitat: false });
  // mirrored copies are seen from far away through fog: a third of the vertex density is plenty
  let copyGeom = buildTerrainGeometry(copySeg, copySegZ, { includeHabitat: false });

  function rebuildMainTerrainGeometries(includeHabitat) {
    const nextMain = buildTerrainGeometry(fullSeg, fullSegZ, { includeHabitat });
    const nextRingCopy = buildTerrainGeometry(fullSeg, fullSegZ, { includeHabitat: false });
    const nextCopy = buildTerrainGeometry(copySeg, copySegZ, { includeHabitat: false });
    terrainMesh.geometry = nextMain;
    for (const child of endless.children) {
      if (child.isMesh) {
        child.geometry = child === endless.userData.centre ? nextMain : child.userData.ring <= 1 ? nextRingCopy : nextCopy;
      }
    }
    terrainGeom.dispose();
    ringCopyGeom.dispose();
    copyGeom.dispose();
    terrainGeom = nextMain;
    ringCopyGeom = nextRingCopy;
    copyGeom = nextCopy;
  }

  // ---------- far terrain shadows (baked) ----------
  // The real-time shadow map only covers the ground near the walker. For the rest, march from every
  // terrain cell towards the sun through the height grid and store how much of the sun is visible.
  // The mirrored terrain repeats every 2 tiles in world space, so one mask over that period, sampled
  // with world x/z and repeat wrapping, is correct for the real tile and every mirrored copy.
  // This bake used to run in one go: about 0.7 M cells x up to 90 ray steps, a freeze of several
  // seconds at start-up, again every 10 min, on every site change and sun-mode switch (the landing
  // cut-scene from the Orbit view hit it). Now: one texel per 2 x 2 height cells (the edge is soft
  // anyway), rays of 2-cell steps that stop once they are above the highest point, and the work is
  // done in ~6 ms slices between frames. The new mask replaces the old one in one swap.
  const SUN_MASK_SLICE_MS = 2;
  const SUN_MASK_WORKER_SRC = `self.onmessage=function(e){var d=e.data,H=new Float32Array(d.H),NX=d.NX,NZ=d.NZ,MX=d.MX,MZ=d.MZ,stepM=d.stepM,dx=d.dx,dz=d.dz,maxSteps=d.maxSteps,tanSun=d.tanSun,SOFT=d.SOFT,hMax=d.hMax,out=new Uint8Array(MX*MZ*4),lim=tanSun+SOFT,inv2S=1/(2*SOFT);for(var mr=0;mr<MZ;mr++){var r=mr*2;if(r>=NZ)r=NZ-1;for(var mc=0;mc<MX;mc++){var c=mc*2;if(c>=NX)c=NX-1;var h0=H[r*NX+c],worst=-1e9;for(var k=1;k<=maxSteps;k++){var ks=k*stepM;if(h0+lim*ks>hMax)break;var fx=c+dx*k,fz=r+dz*k,x0=fx|0;if(fx<x0)x0--;var z0=fz|0;if(fz<z0)z0--;var tx=fx-x0,tz=fz-z0,a=x0%NX;if(a<0)a+=NX;var b=a+1;if(b>=NX)b-=NX;var rz0=z0%NZ;if(rz0<0)rz0+=NZ;var rz1=rz0+1;if(rz1>=NZ)rz1-=NZ;var ra=rz0*NX,rb=rz1*NX,h=(H[ra+a]*(1-tx)+H[ra+b]*tx)*(1-tz)+(H[rb+a]*(1-tx)+H[rb+b]*tx)*tz,t=(h-h0)/ks;if(t>worst){worst=t;if(worst>lim)break;}}var lit=(tanSun-worst)*inv2S+0.5;lit=lit<0?0:lit>1?1:lit;var o=(mr*MX+mc)*4;out[o]=out[o+1]=out[o+2]=(lit*255+0.5)|0;out[o+3]=255;}}self.postMessage(out.buffer,[out.buffer]);};`;
  let sunBakeJob = null;
  function startSunMaskBake(onDone) {
    const val = sunDir.y <= 0.0 ? 0 : 255;
    const out = new Uint8Array([val, val, val, 255]);
    const tex = new THREE.DataTexture(out, 1, 1, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    onDone?.(tex);
    return { cancelled: false, cancel() {} };
  }
  function rebakeSunMask() {
    if (sunBakeJob?.cancel) sunBakeJob.cancel();
    sunBakeJob = startSunMaskBake((tex) => {
      sunBakeJob = null;
      const prev = sunMask;
      sunMask = tex;
      try {
        sunMaskU.value = tex;
      } catch {
        /* not created yet */
      }
      if (prev && prev !== tex) prev.dispose?.();
    });
  }
  let sunMask = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  sunMask.wrapS = sunMask.wrapT = THREE.RepeatWrapping;
  sunMask.magFilter = sunMask.minFilter = THREE.LinearFilter;
  sunMask.needsUpdate = true;

  // ---------- terrain material & KTX2 texture loader ----------
  const texLoader = new THREE.TextureLoader();
  const ktx2Loader = new KTX2Loader();
  ktx2Loader.setTranscoderPath("./vendor/addons/libs/basis/");
  try {
    ktx2Loader.detectSupport(renderer);
  } catch {
    /* headless / test contexts fall back to procedural & standard textures */
  }
  const prepTex = (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    return t;
  };
  const maxTexDim = Math.min(2048, renderer?.capabilities?.maxTextureSize || 2048);
  const upscaledTexSet = new WeakSet();
  function upscaleWithFillers(tex) {
    if (!tex || upscaledTexSet.has(tex)) return tex;
    upscaledTexSet.add(tex);
    tex.anisotropy = maxAniso;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }
  const orthoTex = prepTex(
    texLoader.load(assets.orthoPreviewUrl, (t) => {
      if (texMode === 1) upscaleWithFillers(t);
    })
  );
  const slopeTex = prepTex(
    texLoader.load(assets.slopePreviewUrl, (t) => {
      if (texMode === 2) upscaleWithFillers(t);
    })
  );
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
        upscaleWithFillers(orthoTex);
        terrainMat.map = orthoTex;
        terrainMat.needsUpdate = true;
        syncChunkMaterials();
        const b = document.getElementById("hud-tex");
        if (b) b.textContent = "Tex: ortho";
      }
    })
  );
  const detailTex = makeDetailTexture();
  // Round normal-map repeat counts to even integers so sub-chunks (u/v = 0.5) and mirror-wrapped
  // chunks share identical phase at every boundary without normal seams.
  const evenRepeat = (v) => Math.max(2, Math.round(v / 2) * 2);
  // Offline procedural Mars ground (map branch): wind-rippled regolith + fractured mudstone slabs.
  const pbr = createMartianPbrTextureSets(THREE, 512);
  for (const t of [pbr.dustAlbedoTex, pbr.rockAlbedoTex, pbr.dustNormalTex, pbr.rockNormalTex]) t.anisotropy = maxAniso;
  pbr.dustNormalTex.repeat.set(evenRepeat((960 * worldW) / UV_REF_M), evenRepeat((960 * worldH) / UV_REF_M));
  let pbrHigh = null;
  let terrainShaderRef = null;
  let suitWeaveTex = null;

  function ensureHighResPbr() {
    if (pbrHigh) return pbrHigh;
    pbrHigh = createMartianPbrTextureSets(THREE, 1024);
    for (const t of [pbrHigh.dustAlbedoTex, pbrHigh.rockAlbedoTex, pbrHigh.dustNormalTex, pbrHigh.rockNormalTex]) {
      t.anisotropy = maxAniso;
    }
    pbrHigh.dustNormalTex.repeat.set(evenRepeat((960 * worldW) / UV_REF_M), evenRepeat((960 * worldH) / UV_REF_M));
    return pbrHigh;
  }

  function ensureSuitWeaveNormal() {
    if (suitWeaveTex) return suitWeaveTex;
    const sz = 128;
    const rng = seedrandom("mars-suit-weave-normal-v2");
    const weaveNoise = createNoise2D(rng);
    const data = new Uint8Array(sz * sz * 4);
    for (let y = 0; y < sz; y++) {
      const v = y / sz;
      for (let x = 0; x < sz; x++) {
        const u = x / sz;
        const gx = weaveNoise(u * 24, v * 4) * 0.28;
        const gy = weaveNoise(u * 4 + 7.3, v * 24 + 3.1) * 0.28;
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
  patchAtmosphericHaze(THREE, galeVista, atmoUniforms, {
    curvature: { uCurvAnchor: curvAnchor, uCurvInv2N: curvInv2N, uCurvInv2M: curvInv2M },
  });
  const terrainMat = new THREE.MeshStandardMaterial({
    map: reliefTex,
    normalMap: pbr.dustNormalTex,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.96,
    metalness: 0.0,
  });
  terrainMat.envMapIntensity = 0.7; // ground in shade stays dark; the suit keeps the full sky light
  terrainMat.customProgramCacheKey = () => "mm-terrain";
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
  const CHUNK_TARGET_COUNT = 32; // load the 32 nearest 128x128 chunks around the explorer
  const covCellU = {
    value: new THREE.Vector2(corridor ? corridor.chunkW / CHUNK_SUBDIV : 1, corridor ? corridor.chunkH / CHUNK_SUBDIV : 1),
  };

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
    Object.assign(shader.uniforms, atmoUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec2 vMmWorldXZ;\nvarying vec3 vRtWorldPos;\nvarying float vMmSlope;\nvarying float vMmElev;\nuniform vec2 uCurvAnchor;\nuniform float uCurvInv2N;\nuniform float uCurvInv2M;\n${MARS_ATMO_HAZE_VERT_PARS}`
      )
      .replace(
        "#include <project_vertex>",
        "vMmSlope = 1.0 - clamp(abs(normal.y), 0.0, 1.0);\nvMmElev = transformed.y;\nvec4 mmWorld = modelMatrix * vec4(transformed, 1.0);\nvMmWorldXZ = mmWorld.xz;\nvRtWorldPos = mmWorld.xyz;\nvAtmoWorldPos = mmWorld.xyz;\nfloat mmDx = mmWorld.x - uCurvAnchor.x;\nfloat mmDz = mmWorld.z - uCurvAnchor.y;\nmmWorld.y += -mmDx * mmDx * uCurvInv2N - mmDz * mmDz * uCurvInv2M;\nvec4 mvPosition = viewMatrix * mmWorld;\ngl_Position = projectionMatrix * mvPosition;"
      );
    const sunChunk = THREE.ShaderChunk.lights_fragment_begin.replace(
      "getDirectionalLightInfo( directionalLight, directLight );",
      "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= mmSunVis;"
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec2 vMmWorldXZ;\nvarying vec3 vRtWorldPos;\nvarying float vMmSlope;\nvarying float vMmElev;\nuniform sampler2D sunMask;\nuniform float sunMaskOn;\nuniform vec2 sunMaskPeriod;\nuniform vec2 sunMaskOrigin;\nuniform vec2 uMmUvScale;\nuniform float uCovOn;\nuniform sampler2D uCov;\nuniform vec2 uCovOrigin;\nuniform vec2 uCovCell;\n${MARS_ATMO_HAZE_FRAG_PARS}`
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
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        float mmNormFade = smoothstep(220.0, 950.0, length(vRtWorldPos - cameraPosition));
        normal = normalize(mix(normal, nonPerturbedNormal, 0.85 * mmNormFade));`
      )
      .replace(
        "#include <lights_fragment_begin>",
        "float mmMaskVis = sunMaskOn > 0.5 ? texture2D(sunMask, (vMmWorldXZ - sunMaskOrigin) / sunMaskPeriod).r : 1.0;\nfloat mmSunVis = mmMaskVis;\n" +
          sunChunk
      )
      .replace(
        "#include <map_pars_fragment>",
        "#include <map_pars_fragment>\nuniform sampler2D detailMap;\nuniform sampler2D pbrDust;\nuniform sampler2D pbrRock;\nuniform float uSuperDetail;\nuniform float uRealisticTex;"
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        #ifdef USE_MAP
          // World-space continuous detail UV so detail chunks, sub-chunks, mirrored copies and the
          // overview mesh share seamless procedural rock/dust/grit masks across every border.
          float mmCamDist = length(vRtWorldPos - cameraPosition);
          float mmNearDetail = 1.0 - smoothstep(240.0, 720.0, mmCamDist);
          float mmFarSoft = smoothstep(420.0, 1550.0, mmCamDist);
          if (mmFarSoft > 0.01) {
            vec2 mmBlurR = vec2(0.0028) * mmFarSoft;
            vec3 mmBlurTex = (
              texture2D(map, clamp(vMapUv + vec2(mmBlurR.x, 0.0), vec2(0.002), vec2(0.998))).rgb +
              texture2D(map, clamp(vMapUv - vec2(mmBlurR.x, 0.0), vec2(0.002), vec2(0.998))).rgb +
              texture2D(map, clamp(vMapUv + vec2(0.0, mmBlurR.y), vec2(0.002), vec2(0.998))).rgb +
              texture2D(map, clamp(vMapUv - vec2(0.0, mmBlurR.y), vec2(0.002), vec2(0.998))).rgb
            ) * 0.25;
            diffuseColor.rgb = mix(diffuseColor.rgb, mmBlurTex * diffuse, 0.88 * mmFarSoft);
          }
          vec2 mmUv = (vMmWorldXZ - sunMaskOrigin) / ${UV_REF_M.toFixed(1)};
          float dA = texture2D(detailMap, mmUv * 173.0).r;
          float dB = texture2D(detailMap, mmUv * 911.0).r;
          float mmSlopeMix = smoothstep(0.03, 0.30, vMmSlope);
          vec2 mmElevWarp = (vec2(dA - 0.5, dB - 0.5) * 0.0020 + vec2(sin(vMmElev * 0.42), cos(vMmElev * 0.42)) * 0.0010) * mmSlopeMix;
          vec2 mmWarpedUv = clamp(vMapUv + mmElevWarp / max(uMmUvScale, vec2(0.05)), vec2(0.002), vec2(0.998));
          vec3 mmAltTex = texture2D(map, mmWarpedUv).rgb;
          diffuseColor.rgb = mix(diffuseColor.rgb, mmAltTex, 0.45 * mmSlopeMix * mmNearDetail);
          float detailGain = mix(0.46, 0.62, max(uSuperDetail, uRealisticTex * 0.90)) * mmNearDetail;
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
          diffuseColor.rgb *= mix(1.0, clamp(mmRichLum, 0.22, 1.95), mix(0.82, 0.98, max(uSuperDetail, uRealisticTex)) * mmNearDetail);
          diffuseColor.rgb *= mix(1.0, clamp(mmMicroLum, 0.62, 1.42), 0.42 * mmNearDetail);
          diffuseColor.rgb += vec3(mmMineralGlint, mmMineralGlint * 0.72, mmMineralGlint * 0.48) * mmNearDetail;
        #endif`
      )
      .replace("#include <fog_fragment>", MARS_ATMO_HAZE_FRAG_APPLY);
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
      const ring = Math.max(Math.abs(i), Math.abs(j));
      const geom = i === 0 && j === 0 ? terrainGeom : ring <= 1 ? ringCopyGeom : copyGeom;
      const copy = new THREE.Mesh(geom, terrainMat);
      copy.position.set(i * worldW, 0, j * worldH);
      copy.scale.set(i % 2 === 0 ? 1 : -1, 1, j % 2 === 0 ? 1 : -1);
      copy.receiveShadow = true;
      copy.userData.mirrorCopy = true;
      copy.userData.ring = ring;
      if (i === 0 && j === 0) {
        copy.visible = false; // the real tile sits here until the ring moves
        endless.userData.centre = copy;
      }
      endless.add(copy);
    }
  }
  scene.add(endless);
  /** Lower presets draw fewer mirrored copies of the overview terrain (the fog hides the rest). */
  function applyMirrorRing(ring) {
    for (const copy of endless.children) {
      if (copy !== endless.userData.centre) copy.visible = copy.userData.ring <= ring;
    }
  }
  const period = { x: 2 * worldW, z: 2 * worldH };
  function followEndless(pos) {
    endless.position.set(Math.round(pos.x / period.x) * period.x, 0, Math.round(pos.z / period.z) * period.z);
    endless.userData.centre.visible = endless.position.x !== 0 || endless.position.z !== 0;
  }

  // ---------- streamed 1 m detail chunks (Gale corridor) ----------
  // Each ~129 m (128x128 px) scene sub-cell near the walker gets its own mesh built from the real
  // 1 m DTM chunk (mirrored copies reuse the same data, flipped). Always keeps the 32 nearest
  // 128x128 chunks loaded; far cells are dropped and the overview mesh shows again there.
  const chunkGroup = new THREE.Group();
  scene.add(chunkGroup);
  const chunkTexEntries = new Map(); // data-chunk index -> { tex, slope, refs, loaded, failed, waiters }
  const chunkNormalClones = new Map(); // shared normal map -> clone tiled for one chunk
  const DATA_RADIUS_M = 520; // detail radius/LOD spacing respect gfx preset while keeping 32 nearest 128x128 sub-chunks
  let chunkPlanT = 0;
  let chunkPlanCell = "";
  let chunkBuildQueue = [];
  let covDirty = true;
  let covA0 = Number.NaN;
  let covB0 = Number.NaN;
  let onCorridorMeshShown = null;
  if (corridor) {
    corridor.onChunkLoaded(() => {
      chunkPlanT = 0; // new data: queue the cells that were waiting for it
    });
  }

  function chunkNormalFor(src) {
    let t = chunkNormalClones.get(src);
    if (!t) {
      t = src.clone(); // shares the image with the base mesh's normal map
      t.repeat.set(evenRepeat((960 * corridor.chunkW) / UV_REF_M), evenRepeat((960 * corridor.chunkH) / UV_REF_M));
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

  const chunkMatPool = [];
  function makeChunkMaterial(e) {
    const map = chunkMapFor(e);
    const normalMap = chunkNormalFor(terrainMat.normalMap);
    if (chunkMatPool.length > 0) {
      const m = chunkMatPool.pop();
      m.map = map;
      m.normalMap = normalMap;
      m.normalScale.copy(terrainMat.normalScale);
      m.roughness = terrainMat.roughness;
      m.envMapIntensity = terrainMat.envMapIntensity;
      m.userData.mm.uMmUvScale.value.set(corridor.chunkW / UV_REF_M, corridor.chunkH / UV_REF_M);
      m.userData.mm.uCovOn.value = 0;
      return m;
    }
    const m = new THREE.MeshStandardMaterial({
      map,
      normalMap,
      normalScale: terrainMat.normalScale.clone(),
      roughness: terrainMat.roughness,
      metalness: 0.0,
    });
    m.envMapIntensity = terrainMat.envMapIntensity;
    m.userData.mm = makeTerrainMmUniforms(corridor.chunkW, corridor.chunkH, false);
    m.customProgramCacheKey = () => "mm-terrain";
    m.onBeforeCompile = patchTerrainShader;
    return m;
  }

  /** Keep chunk materials in step with the base terrain material (dev settings, texture mode). */
  // High-resolution sliding terrain patch (3 m spacing across 384 x 384 m) for off-Gale / procedural sites
  // so local hill geometry matches physics/camera elevation instead of coarse 16–49 m overview triangles.
  const PROC_CELL_M = 64;
  const PROC_SEG = 128;
  const PROC_SPAN_M = PROC_CELL_M * 6; // 384 m
  const PROC_HALF_M = PROC_SPAN_M * 0.5;
  const PROC_STEP_M = PROC_SPAN_M / PROC_SEG; // 3.0 m
  const PROC_N = PROC_SEG + 1;
  const PROC_PAD_N = PROC_N + 2;
  const procHeights = new Float32Array(PROC_PAD_N * PROC_PAD_N);
  let procDetailKey = "";
  let covWasProcedural = false;

  const procBaseG = new THREE.PlaneGeometry(PROC_SPAN_M, PROC_SPAN_M, PROC_SEG, PROC_SEG);
  procBaseG.rotateX(-Math.PI / 2);
  const procGeom = addSkirt(procBaseG, PROC_SEG, PROC_SEG, 40);
  procBaseG.dispose();
  const procRing = [];
  for (let i = 0; i < PROC_N; i++) procRing.push(i);
  for (let j = 1; j <= PROC_SEG; j++) procRing.push(j * PROC_N + PROC_SEG);
  for (let i = PROC_SEG - 1; i >= 0; i--) procRing.push(PROC_SEG * PROC_N + i);
  for (let j = PROC_SEG - 1; j >= 1; j--) procRing.push(j * PROC_N);

  const procMat = terrainMat.clone();
  procMat.customProgramCacheKey = () => "mm-terrain";
  procMat.onBeforeCompile = patchTerrainShader;
  procMat.userData.mm = makeTerrainMmUniforms(worldW, worldH, false);

  const procDetailMesh = new THREE.Mesh(procGeom, procMat);
  procDetailMesh.receiveShadow = true;
  procDetailMesh.castShadow = false;
  procDetailMesh.visible = false;
  scene.add(procDetailMesh);

  function updateProceduralDetail(px, pz) {
    const ca = Math.floor(px / PROC_CELL_M);
    const cb = Math.floor(pz / PROC_CELL_M);
    const key = `${ca},${cb}`;
    if (key === procDetailKey && covWasProcedural) return;
    procDetailKey = key;
    covWasProcedural = true;

    const cx = ca * PROC_CELL_M;
    const cz = cb * PROC_CELL_M;
    procDetailMesh.position.set(cx, 0, cz);

    const pos = procGeom.attributes.position;
    const uv = procGeom.attributes.uv;
    const nor = procGeom.attributes.normal;
    for (let pj = -1; pj <= PROC_SEG + 1; pj++) {
      const wz = cz - PROC_HALF_M + pj * PROC_STEP_M;
      const row = (pj + 1) * PROC_PAD_N;
      for (let pi = -1; pi <= PROC_SEG + 1; pi++) {
        const wx = cx - PROC_HALF_M + pi * PROC_STEP_M;
        procHeights[row + pi + 1] = withHabitat(wx, wz, sampleBaseSceneY(wx, wz));
      }
    }

    const inv2Step = 1 / (2 * PROC_STEP_M);
    let idx = 0;
    for (let j = 0; j < PROC_N; j++) {
      const wz = cz - PROC_HALF_M + j * PROC_STEP_M;
      const v = mirrorWrap(0.5 - wz / worldH);
      const rMid = (j + 1) * PROC_PAD_N;
      const rUp = j * PROC_PAD_N;
      const rDn = (j + 2) * PROC_PAD_N;
      for (let i = 0; i < PROC_N; i++) {
        const wx = cx - PROC_HALF_M + i * PROC_STEP_M;
        const cCol = i + 1;
        pos.setY(idx, procHeights[rMid + cCol]);
        uv.setXY(idx, mirrorWrap(wx / worldW + 0.5), v);
        const gx = (procHeights[rMid + cCol + 1] - procHeights[rMid + cCol - 1]) * inv2Step;
        const gz = (procHeights[rDn + cCol] - procHeights[rUp + cCol]) * inv2Step;
        const ny = 1 / Math.hypot(gx, 1, gz);
        nor.setXYZ(idx, -gx * ny, ny, -gz * ny);
        idx++;
      }
    }

    const base = PROC_N * PROC_N;
    for (let k = 0; k < procRing.length; k++) {
      const src = procRing[k];
      const sy = pos.getY(src);
      const su = uv.getX(src);
      const sv = uv.getY(src);
      const snx = nor.getX(src);
      const sny = nor.getY(src);
      const snz = nor.getZ(src);
      const o0 = base + 2 * k;
      const o1 = o0 + 1;
      pos.setY(o0, sy);
      pos.setY(o1, sy - 40);
      uv.setXY(o0, su, sv);
      uv.setXY(o1, su, sv);
      nor.setXYZ(o0, snx, sny, snz);
      nor.setXYZ(o1, snx, sny, snz);
    }
    pos.needsUpdate = true;
    uv.needsUpdate = true;
    nor.needsUpdate = true;
    procGeom.computeBoundingBox();
    procGeom.computeBoundingSphere();

    // Carve the matching 384 x 384 m aperture [ca-3..ca+2] x [cb-3..cb+2] out of overview terrainMat.
    const a0 = ca - COV_N / 2;
    const b0 = cb - COV_N / 2;
    covA0 = a0;
    covB0 = b0;
    covDirty = false;
    covData.fill(0);
    for (let ib = 5; ib <= 10; ib++) {
      for (let ia = 5; ia <= 10; ia++) {
        covData[(ib * COV_N + ia) * 4] = 255;
      }
    }
    covTex.needsUpdate = true;
    covOriginU.value.set(a0 * PROC_CELL_M, b0 * PROC_CELL_M);
    covCellU.value.set(PROC_CELL_M, PROC_CELL_M);
  }

  function syncChunkMaterials() {
    const norm = chunkNormalFor(terrainMat.normalMap);
    for (const c of chunkMeshes.values()) {
      const m = c.mesh.material;
      m.map = chunkMapFor(c.texEntry);
      m.normalMap = norm;
      m.normalScale.copy(terrainMat.normalScale);
      m.roughness = terrainMat.roughness;
    }
    if (procMat.map !== terrainMat.map || procMat.normalMap !== terrainMat.normalMap) {
      procMat.map = terrainMat.map;
      procMat.normalMap = terrainMat.normalMap;
      procMat.needsUpdate = true;
    }
    procMat.normalScale.copy(terrainMat.normalScale);
    procMat.roughness = terrainMat.roughness;
    procMat.color.copy(terrainMat.color);
  }

  function disposeChunk(key, c) {
    c.disposed = true;
    chunkGroup.remove(c.mesh);
    c.mesh.geometry.dispose();
    if (chunkMatPool.length < 64) {
      c.mesh.material.map = null;
      chunkMatPool.push(c.mesh.material);
    } else {
      c.mesh.material.dispose();
    }
    releaseChunkTex(c.texEntry);
    chunkMeshes.delete(key);
    covDirty = true;
  }

  function planCorridorChunks(px, pz) {
    corridor.update(px, pz, Math.min(DATA_RADIUS_M, gfx.detailRadiusM + 160));
    const nearest = corridor.selectNearestSubCells(px, pz, CHUNK_TARGET_COUNT, CHUNK_SUBDIV);
    const want = new Map();
    for (const item of nearest) {
      const key = `${item.a},${item.b}`;
      let seg = Math.min(128, chunkSegmentsFor(gfx, item.d));
      // hysteresis: a mesh keeps its finer grid until it is 20 % past the boundary, so walking
      // along a level-of-detail line does not rebuild the same chunk again and again
      const cur = chunkMeshes.get(key);
      if (cur && seg < cur.seg && Math.min(128, chunkSegmentsFor(gfx, item.d / 1.2)) >= cur.seg) seg = cur.seg;
      want.set(key, { a: item.a, b: item.b, d: item.d, seg, edgeMask: 15 });
    }
    const hasDetailNeighbor = (na, nb) => {
      if (!want.has(`${na},${nb}`)) return false;
      const dc = corridor.dataChunkForSubCell(na, nb, CHUNK_SUBDIV);
      return Boolean(corridor.chunkHeights(dc.ci, dc.cj));
    };
    for (const w of want.values()) {
      w.edgeMask =
        (hasDetailNeighbor(w.a, w.b - 1) ? 1 : 0) |
        (hasDetailNeighbor(w.a, w.b + 1) ? 2 : 0) |
        (hasDetailNeighbor(w.a - 1, w.b) ? 4 : 0) |
        (hasDetailNeighbor(w.a + 1, w.b) ? 8 : 0);
    }
    for (const [key, c] of chunkMeshes) if (!want.has(key)) disposeChunk(key, c);
    chunkBuildQueue = [...want.entries()]
      .filter(([key, w]) => {
        const cur = chunkMeshes.get(key);
        return !cur || cur.seg !== w.seg || cur.edgeMask !== w.edgeMask;
      })
      .map(([, w]) => w)
      .sort((p, q) => p.d - q.d);
  }

  function buildQueuedChunks(budgetMs) {
    const t0 = performance.now();
    let built = 0;
    while (chunkBuildQueue.length && (built === 0 || performance.now() - t0 < budgetMs)) {
      const w = chunkBuildQueue.shift();
      const key = `${w.a},${w.b}`;
      const edgeMask = w.edgeMask ?? 15;
      const g = buildCorridorSubCellGeometry(
        THREE,
        corridor,
        w.a,
        w.b,
        w.seg,
        elevMin,
        30,
        withHabitat,
        CHUNK_SUBDIV,
        edgeMask
      );
      if (!g) continue; // data still on its way; the next plan queues it again
      built++;
      const existing = chunkMeshes.get(key);
      if (existing) {
        existing.mesh.geometry.dispose();
        existing.mesh.geometry = g;
        existing.seg = w.seg;
        existing.edgeMask = edgeMask;
        if (existing.ready) onCorridorMeshShown?.(existing);
        continue;
      }
      const { ci, cj } = corridor.dataChunkForSubCell(w.a, w.b, CHUNK_SUBDIV);
      const e = chunkTexEntry(ci, cj);
      e.refs++;
      const c = { a: w.a, b: w.b, ci, cj, seg: w.seg, edgeMask, texEntry: e, ready: false, disposed: false };
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
        onCorridorMeshShown?.(c);
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
    const { chunkW: subW, chunkH: subH } = corridor.subCellSize(CHUNK_SUBDIV);
    covOriginU.value.set(-corridor.worldW / 2 + a0 * subW, -corridor.worldH / 2 + b0 * subH);
  }

  /** Per frame: stream data, (re)build a few meshes within a time budget, keep the cut-out mask current. */
  function updateCorridorChunks(px, pz, dt) {
    const on = isGaleSite();
    if (!on) {
      chunkGroup.visible = false;
      procDetailMesh.visible = true;
      terrainMat.userData.mm.uCovOn.value = 1;
      updateProceduralDetail(px, pz);
      return;
    }
    procDetailMesh.visible = false;
    if (covWasProcedural) {
      covWasProcedural = false;
      covDirty = true;
      if (corridor) {
        covCellU.value.set(corridor.chunkW / CHUNK_SUBDIV, corridor.chunkH / CHUNK_SUBDIV);
      }
    }
    if (!corridor) {
      chunkGroup.visible = false;
      terrainMat.userData.mm.uCovOn.value = 0;
      return;
    }
    chunkGroup.visible = true;
    terrainMat.userData.mm.uCovOn.value = 1;
    const { a, b } = corridor.subSceneCellOf(px, pz, CHUNK_SUBDIV);
    const cellKey = `${a},${b}`;
    chunkPlanT -= dt;
    if (chunkPlanT <= 0 || cellKey !== chunkPlanCell) {
      chunkPlanT = 0.25;
      chunkPlanCell = cellKey;
      planCorridorChunks(px, pz);
    }
    buildQueuedChunks(4);
    updateCoverage(a, b);
  }

  /** Drop every detail mesh so they are rebuilt (e.g. after the habitat pad moved). */
  function invalidateCorridorChunks() {
    for (const [key, c] of chunkMeshes) disposeChunk(key, c);
    chunkPlanT = 0;
    procDetailKey = "";
  }

  /** Load the data around a point and build its meshes now (start of the EVA, teleports). */
  async function warmCorridorAt(px, pz) {
    if (!corridor || !isGaleSite()) return;
    await corridor.warmup(px, pz, DATA_RADIUS_M, 6000);
    planCorridorChunks(px, pz);
    buildQueuedChunks(250);
    const { a, b } = corridor.subSceneCellOf(px, pz, CHUNK_SUBDIV);
    updateCoverage(a, b);
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

  /** Exact triangle-plane height on a uniform grid geometry (PlaneGeometry / corridor chunk mesh). */
  function sampleGridGeometryY(geom, x0, z0, w, h, segX, segZ, x, z) {
    const pos = geom?.attributes?.position?.array;
    if (!pos || segX < 1 || segZ < 1) return null;
    const fx = Math.max(0, Math.min(segX - 1e-6, ((x - x0) / w) * segX));
    const fz = Math.max(0, Math.min(segZ - 1e-6, ((z - z0) / h) * segZ));
    const p = Math.min(segX - 1, Math.floor(fx));
    const q = Math.min(segZ - 1, Math.floor(fz));
    const tx = fx - p;
    const tz = fz - q;
    const nv = segX + 1;
    const i0 = (q * nv + p) * 3 + 1;
    const i1 = i0 + 3;
    const i2 = i0 + nv * 3;
    const i3 = i2 + 3;
    const y00 = pos[i0];
    const y10 = pos[i1];
    const y01 = pos[i2];
    const y11 = pos[i3];
    if (tx + tz <= 1) return y00 + (y10 - y00) * tx + (y01 - y00) * tz;
    return y11 + (y01 - y11) * (1 - tx) + (y10 - y11) * (1 - tz);
  }

  /** Height of the terrain mesh currently drawn on screen (detail chunk triangles once visible, else overview/mirror triangles). */
  function sampleRenderedTerrainY(x, z) {
    if (!isGaleSite() && procDetailMesh.visible) {
      const px0 = procDetailMesh.position.x - PROC_HALF_M;
      const pz0 = procDetailMesh.position.z - PROC_HALF_M;
      if (x >= px0 && x <= px0 + PROC_SPAN_M && z >= pz0 && z <= pz0 + PROC_SPAN_M) {
        const y = sampleGridGeometryY(procGeom, px0, pz0, PROC_SPAN_M, PROC_SPAN_M, PROC_SEG, PROC_SEG, x, z);
        if (y !== null) return y;
      }
    }
    if (corridor && isGaleSite()) {
      const cell = corridor.subSceneCellOf(x, z, CHUNK_SUBDIV);
      const cm = chunkMeshes.get(`${cell.a},${cell.b}`);
      if (cm && cm.ready && cm.mesh.visible) {
        const { chunkW: subW, chunkH: subH } = corridor.subCellSize(CHUNK_SUBDIV);
        const x0 = -corridor.worldW / 2 + cm.a * subW;
        const z0 = -corridor.worldH / 2 + cm.b * subH;
        const y = sampleGridGeometryY(cm.mesh.geometry, x0, z0, subW, subH, cm.seg, cm.seg, x, z);
        if (y !== null) return y;
        const d = corridor.sampleDetail(x, z);
        return withHabitat(x, z, d !== null ? d - elevMin : sampleBaseSceneY(x, z));
      }
    }
    if (Math.abs(x) <= worldW * 0.5 && Math.abs(z) <= worldH * 0.5) {
      const y = sampleGridGeometryY(terrainGeom, -worldW * 0.5, -worldH * 0.5, worldW, worldH, fullSeg, fullSegZ, x, z);
      if (y !== null) return y;
      return withHabitat(x, z, sampleBaseSceneY(x, z));
    }
    const ci = Math.round((x - endless.position.x) / worldW);
    const cj = Math.round((z - endless.position.z) / worldH);
    const ring = Math.max(Math.abs(ci), Math.abs(cj));
    if (ring === 0 && endless.userData.centre?.visible) {
      const lx = x - endless.position.x;
      const lz = z - endless.position.z;
      const y = sampleGridGeometryY(terrainGeom, -worldW * 0.5, -worldH * 0.5, worldW, worldH, fullSeg, fullSegZ, lx, lz);
      if (y !== null) return y;
    }
    const sx = ci % 2 === 0 ? 1 : -1;
    const sz = cj % 2 === 0 ? 1 : -1;
    const lx = (x - (endless.position.x + ci * worldW)) * sx;
    const lz = (z - (endless.position.z + cj * worldH)) * sz;
    const copyG = ring <= 1 ? ringCopyGeom : copyGeom;
    const cSegX = ring <= 1 ? fullSeg : copySeg;
    const cSegZ = ring <= 1 ? fullSegZ : copySegZ;
    const y = sampleGridGeometryY(copyG, -worldW * 0.5, -worldH * 0.5, worldW, worldH, cSegX, cSegZ, lx, lz);
    return y !== null ? y : sampleBaseSceneY(x, z);
  }

  /** Height of the terrain mesh currently drawn on screen (including habitat decks and ramps). */
  function sampleRenderedSurfaceY(x, z) {
    const groundY = sampleRenderedTerrainY(x, z);
    if (!habitatStation.group.visible) return groundY;
    const deckY = habitatStation.sampleDeckElev(x, z);
    return deckY !== null ? Math.max(groundY, deckY) : groundY;
  }

  /** True when (x, z) lies inside any habitat module floor/deck or entry ramp (suppresses dirt dust and footprints). */
  function isInsideHabitat(x, z) {
    return (
      habitatStation.group.visible &&
      (habitatStation.zoneAt(x, z) !== null || habitatStation.sampleDeckElev(x, z) !== null)
    );
  }

  // ---------- route ----------
  let activeRoute = route;
  let routeCoords = activeRoute?.geometry?.coordinates || [];
  let cumDist = buildCumulativeDistances(routeCoords);
  let geomTotalDist = cumDist[cumDist.length - 1] || 1;
  let totalDist = Number(activeRoute?.totals?.distance_m) > 0 ? Number(activeRoute.totals.distance_m) : geomTotalDist;
  let alongM = 0;
  let offRouteWalkM = 0;

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
        loadStage(isTrLang() ? "NASA giysi modeli yükleniyor" : "Loading the NASA suit model");
        const suitT0 = performance.now();
        const rig = await withTimeout(loadSuitRig(sharedGltfLoader, m.url, ASTRONAUT_HEIGHT_M), 25000, m.url);
        console.info(`suit model ready in ${Math.round(performance.now() - suitT0)} ms (${m.url})`);
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
  computeBvhForObject(THREE, self.group);

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

  const roverMmsev = createExperimentalRover(THREE, "mmsev", { withLights: false });
  const roverConcept = createExperimentalRover(THREE, "nasa_concept", { withLights: false });
  const drivableRovers = [roverMmsev, roverConcept];
  let activeDriveRover = roverConcept;
  for (const r of drivableRovers) {
    r.group.visible = true;
    scene.add(r.group);
    computeBvhForObject(THREE, r.group);
    // rigid-body chassis + six spring-damper struts (rover-dynamics.js) and the visible running
    // gear that follows them (rover-rig.js); the parameters come from each vehicle's own spec
    r.sim = createRoverDynamics(THREE, roverParamsFor(r.getActiveSpec()));
    r.rig = attachSuspensionRig(THREE, r, r.sim);
  }
  // ---- historic NASA rovers (Sojourner ... Perseverance) can be driven too ----
  // Each one gets the rigid-body model with its own size and mass while you drive it; the model's
  // own rig turns the wheels, steers the corner wheels and tilts the rocker-bogies.
  let preHistoricRover = null;
  function makeHistoricDriveAdapter(entry) {
    const spec = entry.spec;
    const group = entry.group;
    const P = roverParamsForHistoric(spec);
    const sim = createRoverDynamics(THREE, P);
    sim.reset(group.position.x, group.position.z, group.rotation.y, sampleRenderedSurfaceY);
    const label = String(spec.name || spec.id).toUpperCase();
    const rig = {
      sync() {
        const st = sim.state;
        const a = sim.attitude();
        const w = sim.wheels; // FL FR ML MR RL RR
        // Historic rover meshes only articulate rocker-bogie pitch, not vertical strut translation;
        // lift the group by the deepest bump compression beyond static sag so no wheel clips the floor.
        let maxExcessComp = 0;
        for (let i = 0; i < w.length; i++) {
          if (w[i].contact) maxExcessComp = Math.max(maxExcessComp, w[i].comp - P.sagM);
        }
        group.position.set(st.pos.x, st.pos.y + maxExcessComp, st.pos.z);
        group.rotation.order = "YXZ";
        group.rotation.set(a.pitch, a.yaw, a.roll);
        // stay put when the endless terrain re-centres (the manager places rovers from base x/z)
        entry.baseX = group.position.x;
        entry.baseZ = group.position.z;
        // wheels and corner steering on the model; rocker-bogie tilt from the strut travel
        entry.driveSpeed = st.vLong;
        entry.steerAngle = st.steerCmd * P.steerMaxRad;
        const d = (i) => -(w[i].comp - P.sagM);
        entry.wheelDeltaHeights = [d(0), d(2), d(4), d(1), d(3), d(5)];
      },
    };
    return {
      isHistoricAdapter: true,
      chaseDist: Math.max(2.2, 2.9 * Math.max(spec.halfL || 1, spec.halfW || 1)),
      entry,
      group,
      sim,
      rig,
      getActiveSpec: () => ({ id: spec.id, shortLabel: label, nameEn: spec.name, nameTr: spec.name }),
      getWheelDustEmitPoint(side) {
        const yaw = group.rotation.y;
        const hw = P.trackHalfW * side;
        const zb = P.axleZ[2];
        return {
          x: group.position.x + Math.cos(yaw) * hw + Math.sin(yaw) * zb,
          z: group.position.z - Math.sin(yaw) * hw + Math.cos(yaw) * zb,
        };
      },
      sampleSupportGroundY: (fn) => fn(group.position.x, group.position.z),
      resolveCollision: (x, z, radius = 0.42, y = null) =>
        obbPushOut(
          group.position.x,
          group.position.z,
          group.rotation.y,
          group.position.y,
          x,
          z,
          radius,
          y,
          Math.max(0.3, spec.halfW || 1.2),
          Math.max(0.35, spec.halfL || 1.4),
          spec.heightM || 2.2
        ),
      spawnBeside() {
        return group.position;
      },
      release() {
        entry.driveSpeed = 0;
        entry.steerAngle = 0;
        entry.wheelDeltaHeights = null; // the manager re-seats it on the ground next frame
      },
    };
  }
  const MAX_NPC_INTERACT_DIST_M = 4.8;
  const MAX_ROVER_INTERACT_DIST_M = 6.5;

  /** The historic rover you are standing next to (within reach of its body), or null. */
  function nearestHistoricEntry(x, z) {
    if (freecamActive) return null;
    let best = null;
    let bestD = Infinity;
    for (const e of historicRovers.getAllEntries()) {
      if (!e?.group?.visible || !e.spec) continue;
      const d = Math.hypot(e.group.position.x - x, e.group.position.z - z);
      const reach = Math.min(MAX_ROVER_INTERACT_DIST_M, Math.max(e.spec.halfL || 1, e.spec.halfW || 1) + 3.8);
      if (d <= reach && d < bestD) {
        best = e;
        bestD = d;
      }
    }
    return best;
  }

  // digital instrument cluster along the bottom while driving (rover-dash.js)
  const roverDash = createRoverDash(
    document.getElementById("visor-overlay") || document.querySelector(".visor-overlay") || hudView
  );
  roverMmsev
    .attachRealModel(sharedGltfLoader, "./assets/nasa-3d/mmsev-rover.glb", {
      castShadow: gfx.shadowPx >= 2048,
    })
    .then((ok) => {
      if (ok) computeBvhForObject(THREE, roverMmsev.group);
    });

  const historicRovers = createHistoricRoverManager(THREE, sharedGltfLoader, scene, {
    onModelLoaded: (grp) => computeBvhForObject(THREE, grp),
  });
  const npcManager = createNpcManager(THREE, scene, {
    suitRig,
    createAstronautFn: createAstronaut,
    sampleElevY: sampleElevSceneY,
  });
  computeBvhForObject(THREE, npcManager.npcGroup);
  npcManager.npcGroup.visible = habitatStation.group.visible;

  let stationedAtHabitat = true;
  function stationDrivableRoversAtHabitat({ resetNpcAnchors = false } = {}) {
    const bays = habitatStation.getBayPlacements();
    for (const dp of bays.drivablePlacements) {
      const target = dp.vehicleType === "nasa_concept" ? roverConcept : roverMmsev;
      target.group.visible = habitatStation.group.visible;
      target.placeAt(dp.x, dp.z, dp.yaw, sampleRenderedSurfaceY);
      target.update(0.016, { sampleElevY: sampleRenderedSurfaceY, speed: 0, steer: 0, driving: false, physicsEnabled: false });
      target.sim?.reset(dp.x, dp.z, dp.yaw, sampleRenderedSurfaceY);
      target.rig?.sync();

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
      sampleElevY: sampleRenderedSurfaceY,
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
      sampleElevY: sampleRenderedSurfaceY,
      focusId: activeSiteId,
    });
    npcManager.syncHistoricRoverNpcs(historicRovers, { bayCenter: { x: originX, z: originZ } });
    return placements;
  }
  stationRoversAtHabitat({ includeDrivable: true, resetNpcAnchors: true });

  // Dust kicked up by boots, wheels, jumps and landings, and fading tire tracks. It takes the
  // colour of the ground it came from once a ground-colour sampler is set (setDustGroundColor).
  let dustGroundColor = null;
  const marsFx = createRegolithDust(THREE, scene, {
    sampleGroundY: (x, z) => sampleRenderedSurfaceY(x, z),
    sampleGroundColor: (x, z, out) => (dustGroundColor ? dustGroundColor(x, z, out) : false),
  });
  let roverTrackDist = 0;
  // rocket landing cinematic at the start of an EVA (landing-sequence.js); the lander stays as a landmark
  const landing = createLandingSequence(THREE, scene, { marsFx, sampleY: sampleElevSceneY });
  let landingHidNpcs = false;

  const lightRig = new THREE.Group();
  lightRig.name = "stable-lights";
  scene.add(lightRig);
  const stableLights = [];
  /** Move the local lights under `root` into the always-visible rig (see the note before the loop). */
  function stabilizeLights(root) {
    if (!root) return;
    const found = [];
    root.traverse((o) => {
      if (o.isLight && (o.isPointLight || o.isSpotLight)) found.push(o);
    });
    for (const l of found) {
      const anchor = new THREE.Object3D();
      anchor.name = "light-anchor";
      l.parent.add(anchor);
      anchor.position.copy(l.position);
      lightRig.add(l);
      stableLights.push({ l, anchor, saved: l.intensity, parked: false });
    }
  }
  function syncStableLights() {
    for (const e of stableLights) {
      let vis = true;
      for (let q = e.anchor; q; q = q.parent) {
        if (!q.visible) {
          vis = false;
          break;
        }
      }
      e.anchor.getWorldPosition(e.l.position);
      if (!vis) {
        if (!e.parked) {
          e.saved = e.l.intensity;
          e.parked = true;
        } else if (e.l.intensity !== 0) e.saved = e.l.intensity; // someone set it while hidden
        e.l.intensity = 0;
      } else if (e.parked) {
        e.l.intensity = e.saved;
        e.parked = false;
      }
    }
  }

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
      // the rendered surface, not the coarser elevation grid: a blob on the grid height floats
      // above or sinks into the mesh the player actually sees
      const gy = sampleRenderedSurfaceY(footPos.x, footPos.z);
      const lift = Math.max(0, footPos.y - gy - 0.08); // ankle bone sits ~8 cm above the sole
      c.mesh.material.opacity = Math.max(0, 1 - lift / 0.35);
      const e = 0.3;
      nrm
        .set(
          sampleRenderedSurfaceY(footPos.x - e, footPos.z) - sampleRenderedSurfaceY(footPos.x + e, footPos.z),
          2 * e,
          sampleRenderedSurfaceY(footPos.x, footPos.z - e) - sampleRenderedSurfaceY(footPos.x, footPos.z + e)
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
    computeBvhForObject(THREE, avatar.group);
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
      const txt = `AST-1 · 1.80 M · ${suitLabel}`;
      if (crewEl.textContent !== txt) crewEl.textContent = txt;
    }
    if (summaryEl) summaryEl.textContent = `MARS g ${surfaceG.toFixed(3)} M/S² · CREW: 2 (BUDDY EVA)`;
  }
  updateCrewHudSummary();

  // ---------- EVA floodlamp & optical visor pass (zero 3D helmet frame) ----------
  const evaLamp = new THREE.SpotLight(0xfff5e4, 0, 52, Math.PI * 0.25, 0.52, 1.25);
  evaLamp.castShadow = false;
  scene.add(evaLamp, evaLamp.target);
  let evaLampOn = false;
  let roverLampOverride = null; // null = automatic (dark), true / false = driver's choice
  let goldSlide = 0;

  const dummyDepthTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  dummyDepthTex.needsUpdate = true;
  // drawing-buffer size of the 3D frame (CSS size x pixel ratio x render scale)
  const rt = { width: 1, height: 1 };
  let lastPostKey = "";
  const postPipeline = createMarsPostPipeline({ THREE, renderer, scene, camera });
  const lensMat = new THREE.ShaderMaterial({
    vertexShader: LENS_VERT,
    fragmentShader: LENS_FRAG,
    depthTest: false,
    depthWrite: false,
    toneMapped: true,
    uniforms: {
      tDiffuse: { value: dummyDepthTex },
      tDepth: { value: dummyDepthTex },
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
  let eyeBaseY = null;
  const heightEnv = {
    sampleHeight: sampleRenderedSurfaceY,
    molaElevM: (x, z) => activeElevBaseM() + sampleRenderedSurfaceY(x, z),
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
    phys.y = sampleRenderedSurfaceY(x, z);
    syncPlayerFromPhys();
    eyeBaseY = phys.y;
    justTeleportedOrWrapped = true;
    lastMoveYaw = null;
  }
  let partnerS = PARTNER_AHEAD_M;
  let justTeleportedOrWrapped = false;
  let teleportSeq = 0;
  let lastMoveYaw = null;

  onCorridorMeshShown = (chunk) => {
    if (!corridor || !isGaleSite() || !player.init) return;
    const cell = corridor.subSceneCellOf(phys.x, phys.z, CHUNK_SUBDIV);
    if (cell.a === chunk.a && cell.b === chunk.b && phys.grounded) {
      phys.y = sampleRenderedSurfaceY(phys.x, phys.z);
      syncPlayerFromPhys();
      eyeBaseY = phys.y;
      justTeleportedOrWrapped = true;
    }
    const checkRoverChunk = (drv) => {
      if (!drv?.group?.visible || !drv.sim?.setPosition) return;
      const gx = drv.group.position.x;
      const gz = drv.group.position.z;
      const rc = corridor.subSceneCellOf(gx, gz, CHUNK_SUBDIV);
      if (Math.abs(rc.a - chunk.a) <= 1 && Math.abs(rc.b - chunk.b) <= 1) {
        drv.sim.setPosition(gx, gz, sampleRenderedSurfaceY);
      }
    };
    for (const drvR of drivableRovers) checkRoverChunk(drvR);
    if (activeDriveRover?.isHistoricAdapter) checkRoverChunk(activeDriveRover);
    footsteps.reprojectAll(sampleRenderedSurfaceY, sampleNormal);
  };
  let drivingRover = false;
  // [F4] freecam state: 6-DOF flying camera independent of walker / rover physics
  let freecamActive = false;
  let freecamYaw = 0;
  let freecamPitch = -0.12;
  let freecamSpeed = 18;
  const freecamPos = new THREE.Vector3();
  const freecamVel = new THREE.Vector3();
  const freecamFwd = new THREE.Vector3();
  const freecamRight = new THREE.Vector3();
  const freecamWish = new THREE.Vector3();
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
        ".modal-backdrop.open, #npc-dialogue-modal.open, #crew-drawer.open, #esc-menu.open, #hud-transit-panel.open, #hud-fleet-panel.open, #hud-task-panel.open"
      )
    );

  const raycaster = new THREE.Raycaster();
  const rayNdc = new THREE.Vector2();
  const pickHistoricGroups = [];
  const pickScreenRoots = [];
  const lastMouseClient = { x: 0, y: 0, valid: false };
  let cachedCanvasRect = null;
  let hoveredRoverSpec = null;
  let hoveredNpcEntry = null;
  let hoveredScreenTarget = null;

  function setRaycasterFromView(clientX = null, clientY = null) {
    if (isPointerLocked() || clientX == null || clientY == null) {
      rayNdc.set(0, 0);
    } else {
      const rect = cachedCanvasRect && cachedCanvasRect.width > 0 ? cachedCanvasRect : (cachedCanvasRect = renderer.domElement.getBoundingClientRect());
      if (rect.width <= 0 || rect.height <= 0) return false;
      rayNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      rayNdc.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    }
    raycaster.setFromCamera(rayNdc, camera);
    return true;
  }

  const NPC_TALK_MAX_DIST_M = 4.6;
  function isNpcInTalkRange(entry) {
    if (!entry) return false;
    const distXZ = Math.hypot(entry.x - freePos.x, entry.z - freePos.z);
    if (distXZ > NPC_TALK_MAX_DIST_M || Math.abs(entry.y - freePos.y) > 2.8) return false;
    if (
      habitatStation.group.visible &&
      habitatStation.clipCameraSegment(freePos.x, freePos.y + 1.5, freePos.z, entry.x, entry.y + 1.5, entry.z) < 0.96
    ) {
      return false;
    }
    return true;
  }

  function findNearbyTalkNpc() {
    if (drivingRover || !npcManager.npcGroup.visible) return null;
    const nearNpcHit = npcManager.getNearestInteractableNpc(freePos.x, freePos.z, NPC_TALK_MAX_DIST_M, freePos, lookDir);
    return nearNpcHit?.npc && isNpcInTalkRange(nearNpcHit.npc) ? nearNpcHit : null;
  }

  function pickTargetNpc(clientX = null, clientY = null) {
    if (!npcManager.npcGroup.visible || freecamActive || drivingRover) return null;
    if (!setRaycasterFromView(clientX, clientY)) return null;
    const maxRayDist = thirdPersonWalk ? 8.0 : NPC_TALK_MAX_DIST_M + 1.4;
    const hit = npcManager.pickNpc(raycaster, maxRayDist, freePos, MAX_NPC_INTERACT_DIST_M);
    return isNpcInTalkRange(hit) ? hit : null;
  }

  function pickHistoricRover(clientX = null, clientY = null) {
    if (freecamActive || drivingRover) return null;
    const groups = historicRovers.getInteractiveGroups();
    if (!groups || groups.length === 0) return null;
    if (!setRaycasterFromView(clientX, clientY)) return null;
    pickHistoricGroups.length = 0;
    const maxP2 = MAX_ROVER_INTERACT_DIST_M * MAX_ROVER_INTERACT_DIST_M;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const pdx = g.position.x - freePos.x;
      const pdz = g.position.z - freePos.z;
      if (pdx * pdx + pdz * pdz > maxP2) continue;
      if (raycaster.ray.distanceSqToPoint(g.position) <= 12.25) {
        pickHistoricGroups.push(g);
      }
    }
    if (pickHistoricGroups.length === 0) return null;
    const hits = raycaster.intersectObjects(pickHistoricGroups, true);
    if (hits.length > 0 && hits[0].distance <= 10.0) {
      let obj = hits[0].object;
      while (obj && !obj.userData?.historicRoverId) obj = obj.parent;
      const rId = obj?.userData?.historicRoverId;
      return rId ? getHistoricRoverById(rId) : null;
    }
    return null;
  }

  function pickInteractiveScreen(clientX = null, clientY = null) {
    if (freecamActive || drivingRover) return null;
    pickScreenRoots.length = 0;
    if (habitatStation.group.visible) {
      const habScreens = habitatStation.getInteractiveGroup?.();
      if (habScreens) pickScreenRoots.push(habScreens);
    }
    if (hardwareSite) {
      if (hardwareSite.beacon) pickScreenRoots.push(hardwareSite.beacon);
      if (hardwareSite.pad) pickScreenRoots.push(hardwareSite.pad);
    }
    if (pickScreenRoots.length === 0) return null;
    if (!setRaycasterFromView(clientX, clientY)) return null;
    const maxRayDist = thirdPersonWalk ? 9.5 : 6.5;
    const hits = raycaster.intersectObjects(pickScreenRoots, true);
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      if (hit.distance > maxRayDist) break;
      let obj = hit.object;
      while (obj && !obj.userData?.screenTarget) obj = obj.parent;
      const target = obj?.userData?.screenTarget;
      if (!target) continue;
      if (Math.hypot(hit.point.x - freePos.x, hit.point.z - freePos.z) > 6.2) continue;
      if (
        habitatStation.group.visible &&
        habitatStation.clipCameraSegment(freePos.x, freePos.y + 1.5, freePos.z, hit.point.x, hit.point.y, hit.point.z, 0.01) < 0.96
      ) {
        continue;
      }
      return target;
    }
    return null;
  }

  function activateScreenTarget(target) {
    if (!target) return false;
    if (target.kind === "taskScreen" || (target.kind === "wallScreen" && target.spec)) {
      taskUi.open(target.spec || null);
      return true;
    }
    if (target.kind === "terminal") {
      openTransitPanel();
      return true;
    }
    if (target.kind === "hardwareInfo") {
      openTransitPanel({ infoId: target.hwId || hardwareSite?.hw?.id || null });
      return true;
    }
    if (target.kind === "returnPad") {
      returnToHabitat();
      return true;
    }
    return false;
  }

  function findNearestDrivableEntry(x, z, maxDistM = 5.2) {
    if (freecamActive) return null;
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
  const plcCameraProxy = new THREE.PerspectiveCamera(78, 1, 0.06, 15000);
  plcCameraProxy.rotation.order = "YXZ";
  const pointerLockControls = new PointerLockControls(plcCameraProxy, renderer.domElement);
  pointerLockControls.pointerSpeed = 1.2;
  pointerLockControls.addEventListener("change", () => {
    if (landing.active || isMapOpen() || !isHudActive() || hasOpenModalOverlay()) {
      plcCameraProxy.rotation.set(0, 0, 0, "YXZ");
      return;
    }
    const dYaw = plcCameraProxy.rotation.y;
    const dPitch = plcCameraProxy.rotation.x;
    plcCameraProxy.rotation.set(0, 0, 0, "YXZ");
    if (dYaw === 0 && dPitch === 0) return;
    if (freecamActive) {
      freecamYaw += dYaw;
      freecamPitch = Math.max(-1.53, Math.min(1.53, freecamPitch + dPitch));
      return;
    }
    userYaw += dYaw;
    const minPitch = drivingRover ? -1.08 : -1.35;
    const maxPitch = drivingRover ? -0.06 : 1.42;
    pitch = Math.max(minPitch, Math.min(maxPitch, pitch + dPitch));
  });

  function releasePointerLock() {
    if (document.pointerLockElement) {
      manualUnlockPending = true;
      setTimeout(() => {
        manualUnlockPending = false;
      }, 140);
      try {
        pointerLockControls.unlock?.();
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
    onReply: (spec, text, lang) => {
      if (spec?.id) npcManager.setNpcSpeech?.(spec.id, text, lang);
    },
    getLang: () => (isTrLang() ? "tr" : "en"),
  });

  function openNpcDialogueSafe(npcOrSpec) {
    if (!npcOrSpec) return;
    if (Number.isFinite(npcOrSpec.x) && !isNpcInTalkRange(npcOrSpec)) return;
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
      plcCameraProxy.rotation.set(0, 0, 0, "YXZ");
      pointerLockControls.lock();
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
      const hitScreen = pickInteractiveScreen(cx, cy);
      if (hitScreen && activateScreenTarget(hitScreen)) {
        e.preventDefault?.();
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
    // When pointer-locked, PointerLockControls handles first-person Euler look via its "change" event.
    if (locked || !dragging) return;
    if (landing.active) return;
    if (isMapOpen() || !isHudActive()) {
      dragging = false;
      return;
    }
    const rawDx = e.clientX - lastX;
    const rawDy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    const dx = Math.abs(rawDx) > 320 ? 0 : rawDx;
    const dy = Math.abs(rawDy) > 320 ? 0 : rawDy;
    if (dx === 0 && dy === 0) return;
    const sensX = 0.0035;
    const sensY = 0.003;
    if (freecamActive) {
      freecamYaw -= dx * sensX;
      freecamPitch = Math.max(-1.53, Math.min(1.53, freecamPitch - dy * sensY));
      return;
    }
    userYaw -= dx * sensX;
    const minPitch = drivingRover ? -1.08 : -1.35;
    const maxPitch = drivingRover ? -0.06 : 1.42;
    pitch = Math.max(minPitch, Math.min(maxPitch, pitch - dy * sensY));
  });
  renderer.domElement.addEventListener(
    "wheel",
    (e) => {
      if (!freecamActive || !isHudActive() || hasOpenModalOverlay()) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      freecamSpeed = Math.max(2, Math.min(240, freecamSpeed * factor));
      showWrapNotice(
        isTrLang()
          ? `SERBEST KAMERA HIZI: ${freecamSpeed.toFixed(0)} m/sn`
          : `FREECAM SPEED: ${freecamSpeed.toFixed(0)} m/s`
      );
    },
    { passive: false }
  );
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
  const btnPov = document.getElementById("hud-pov-btn");
  const btnGold = document.getElementById("hud-gold-btn");
  const btnLamp = document.getElementById("hud-lamp-btn");
  const optGoldPill = document.getElementById("hud-opt-gold");
  const optLampPill = document.getElementById("hud-opt-lamp");
  const optZoomPill = document.getElementById("hud-opt-zoom");

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
  let customSiteTex = null;
  function buildCustomSiteTexture(spec) {
    if (typeof document === "undefined") return null;
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const img = ctx.createImageData(size, size);
    const data = img.data;
    const prof = spec?.terrainProfile || {};
    const pal = prof.palette || {};
    const dust = pal.dust || [182, 118, 82];
    const rock = pal.rock || [110, 74, 56];
    const sand = pal.sand || dust;
    const highlight = [
      Math.min(255, Math.round(dust[0] * 1.12 + 8)),
      Math.min(255, Math.round(dust[1] * 1.1 + 6)),
      Math.min(255, Math.round(dust[2] * 1.08 + 4)),
    ];
    const rough = Math.max(0.2, Math.min(1.6, Number(prof.roughness) || 0.75));
    const rng = seedrandom(`mars-custom-site-${spec?.lon ?? 0}:${spec?.lat ?? 0}`);
    const noise2D = createNoise2D(rng);
    const sampleSiteNoise = (u, v, period) => 0.5 + 0.5 * noise2D(u * period, v * period);
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const n0 = sampleSiteNoise(u, v, 4);
        const n1 = sampleSiteNoise(u + 3.1, v + 1.7, 12);
        const n2 = sampleSiteNoise(u + 7.4, v + 5.2, 32);
        const n3 = sampleSiteNoise(u + 11.9, v + 9.8, 64);
        const dune = 0.5 + 0.5 * Math.sin((u * 4 + v * 1.5 + n0 * 0.9) * Math.PI * 2);
        const rockW = Math.max(0, Math.min(1, (n1 * 0.55 + n2 * 0.35 + n3 * 0.25 - 0.38) * (1.2 + rough * 0.6)));
        const dustW = Math.max(0, Math.min(1, (dune * 0.5 + n0 * 0.5 - 0.45) * 1.3));
        let r = sand[0] * (1 - rockW) + rock[0] * rockW;
        let g = sand[1] * (1 - rockW) + rock[1] * rockW;
        let b = sand[2] * (1 - rockW) + rock[2] * rockW;
        r = r * (1 - dustW * 0.45) + highlight[0] * (dustW * 0.45);
        g = g * (1 - dustW * 0.45) + highlight[1] * (dustW * 0.45);
        b = b * (1 - dustW * 0.45) + highlight[2] * (dustW * 0.45);
        const micro = 0.92 + n3 * 0.16;
        const idx = (y * size + x) * 4;
        data[idx] = Math.max(0, Math.min(255, Math.round(r * micro)));
        data[idx + 1] = Math.max(0, Math.min(255, Math.round(g * micro)));
        data[idx + 2] = Math.max(0, Math.min(255, Math.round(b * micro)));
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    if (customSiteTex) customSiteTex.dispose();
    customSiteTex = new THREE.CanvasTexture(canvas);
    customSiteTex.wrapS = THREE.MirroredRepeatWrapping;
    customSiteTex.wrapT = THREE.MirroredRepeatWrapping;
    customSiteTex.repeat.set(12, 36);
    customSiteTex.colorSpace = THREE.SRGBColorSpace;
    customSiteTex.needsUpdate = true;
    return customSiteTex;
  }

  const TEX = [
    { tex: reliefTex, label: "relief" },
    { tex: orthoTex, label: "ortho" },
    { tex: slopeTex, label: "slope" },
  ];
  function setTexMode(i) {
    texMode = i;
    if (texMode === 0 && !reliefOk) texMode = 1;
    if (texMode === 1) upscaleWithFillers(orthoTex);
    else if (texMode === 2) upscaleWithFillers(slopeTex);
    else upscaleWithFillers(reliefTex);
    terrainMat.map = isGaleSite() || !customSiteTex ? TEX[texMode].tex : customSiteTex;
    terrainMat.needsUpdate = true;
    syncChunkMaterials();
    const b = document.getElementById("hud-tex");
    if (b) b.textContent = isGaleSite() ? `Tex: ${TEX[texMode].label}` : "Tex: globe";
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
          activeDriveRover.spawnBeside(p.x, p.z, userYaw, sampleRenderedSurfaceY);
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
    const prevX = phys.x;
    const prevZ = phys.z;
    const wx = wrapSceneCoord(tx, worldW * 2).val;
    const wz = wrapSceneCoord(tz, worldH * 2).val;
    const lon = xToLon(wx);
    const lat = zToLat(wz);

    teleportSeq++;
    const seq = teleportSeq;
    if (isGaleSite()) {
      const nearestGeomS = closestAlongM(routeCoords, cumDist, lon, lat);
      alongM = geomTotalDist > 0 ? (nearestGeomS / geomTotalDist) * totalDist : 0;
    } else {
      alongM = 0;
    }

    if (Math.hypot(wx - prevX, wz - prevZ) > 12) {
      footsteps.clear();
    }

    followEndless({ x: wx, y: 0, z: wz });
    snapPhys(wx, wz);

    autoYaw = 0;
    if (!keepYaw && isGaleSite() && routeCoords.length > 1) {
      const rp = routePoint(alongM);
      const distToRoute = Math.hypot(rp.x - wx, rp.z - wz);
      userYaw = distToRoute > 5 ? Math.atan2(-(rp.x - wx), -(rp.z - wz)) : routeHeading(alongM);
    }
    pitch = Math.max(-0.55, Math.min(0.25, keepYaw ? pitch : -0.06));
    followEndless({ x: player.x, y: player.y, z: player.z });
    if (!isGaleSite()) {
      updateCorridorChunks(wx, wz, 0);
    }

    if (corridor && isGaleSite()) {
      const cell = corridor.subSceneCellOf(wx, wz, CHUNK_SUBDIV);
      const cm = chunkMeshes.get(`${cell.a},${cell.b}`);
      if (corridor.sampleDetail(wx, wz) === null || !cm || !cm.ready) {
        warmCorridorAt(wx, wz).then(() => {
          if (seq !== teleportSeq || !isGaleSite()) return;
          if (phys.grounded && Math.hypot(phys.x - wx, phys.z - wz) < 8) {
            phys.y = sampleRenderedSurfaceY(phys.x, phys.z);
            syncPlayerFromPhys();
            eyeBaseY = phys.y;
            justTeleportedOrWrapped = true;
          }
          footsteps.reprojectAll(sampleRenderedSurfaceY, sampleNormal);
        });
      }
    }
  }

  onTeleport(({ lon, lat }) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    if (isTaskLocked()) {
      showTaskLockNotice();
      return;
    }
    visitLocation(lon, lat, { keepYaw: false });
  });

  function renderHudFleetPanel() {
    if (!fleetPanelEl) return;
    const tr = isTrLang();
    const locked = isTaskLocked();
    const disAttr = locked ? "disabled title='Teleports locked while Task active'" : "";
    fleetPanelEl.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
      <span style="font-size:9.5px;letter-spacing:0.15em;color:var(--faint);text-transform:uppercase;">${
        tr ? "MARS ÜSSÜ & ROVER FİLOSU (7 ARAÇ)" : "MARS HABITAT & ROVER FLEET (7 VEHICLES)"
      }${locked ? " · 🔒 TASK" : ""}</span>
      <div style="display:flex;gap:4px;">
        <button id="hud-fleet-habitat" class="btn primary" type="button" ${disAttr} style="padding:2px 7px;font-size:9px;">${
          tr ? "Üs Garajı" : "Habitat Bay"
        }</button>
        <button id="hud-fleet-rescatter" class="btn" type="button" ${disAttr} style="padding:2px 7px;font-size:9px;">${
          tr ? "Karıştır" : "Rescatter"
        }</button>
      </div>
    </div>`;
    fleetPanelEl.querySelector("#hud-fleet-habitat")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (isTaskLocked()) {
        showTaskLockNotice();
        return;
      }
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
      if (isTaskLocked()) {
        showTaskLockNotice();
        return;
      }
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
      const lockedRow = isTaskLocked() ? "disabled title='Teleports locked while Task active'" : "";
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:7px;min-width:0;">
          <span class="fleet-dot" style="background:${vSpec.badgeColor};"></span>
          <div style="min-width:0;">
            <div style="font-size:11px;color:#fff;letter-spacing:0.06em;">${
              tr ? vSpec.nameTr : vSpec.nameEn
            } <span style="color:var(--faint);font-size:9.5px;">· ${dDist}</span></div>
            <div style="font-size:9px;color:var(--faint);">${tr ? `Sürülebilir · [${kh("E", "interact")}] ile bin` : `Drivable · Press [${kh("E", "interact")}] to drive`}</div>
          </div>
        </div>
        <div style="display:flex;gap:5px;flex:none;">
          <button class="btn" type="button" data-drv-go ${lockedRow} style="padding:3px 7px;font-size:9.5px;">${
            tr ? "Git" : "Locate"
          }</button>
          <button class="btn primary" type="button" data-drv-drive ${lockedRow} style="padding:3px 7px;font-size:9.5px;">${
            tr ? "Sür" : "Drive"
          }</button>
        </div>
      `;
      row.querySelector("[data-drv-go]")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (isTaskLocked()) {
          showTaskLockNotice();
          return;
        }
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
        showWrapNotice(`${vSpec.shortLabel} · ${tr ? `BİNMEK İÇİN [${kh("E", "interact")}]` : `PRESS [${kh("E", "interact")}] TO DRIVE`}`);
      });
      row.querySelector("[data-drv-drive]")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (isTaskLocked()) {
          showTaskLockNotice();
          return;
        }
        fleetPanelEl.classList.remove("open");
        rInstance.group.visible = true;
        activeDriveRover = rInstance;
        drivingRover = true;
        resetRoverMotionState();
        rInstance.sim.reset(rInstance.group.position.x, rInstance.group.position.z, rInstance.group.rotation.y, sampleRenderedSurfaceY);
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
          <button class="btn primary" type="button" data-hud-go ${isTaskLocked() ? "disabled title='Teleports locked while Task active'" : ""} style="padding:3px 7px;font-size:9.5px;">${
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
        if (isTaskLocked()) {
          showTaskLockNotice();
          return;
        }
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
    updateAtmosphericHazeUniforms(atmoUniforms, { sunElev: sunState.elevationRad });
    celestial.update(sunState);
    const up = sunUp(sunState.elevationRad);
    // Night: no direct sun, a faint sky/starlight floor so the ground stays readable.
    hemiLight.intensity = (gfx.level === "ultra" ? 0.28 : 0.22) * (0.32 + 0.68 * up);
    renderer.toneMappingExposure = (gfx.level === "ultra" ? 1.06 : 1.0) * (1 + 0.55 * (1 - up));
    if (rebake) {
      rebuildEnvironment();
      if (isGaleSite() && elevGrid) rebakeSunMask();
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
  let landerWasVisibleAtGale = false;
  function switchSite(spec) {
    if (!spec || spec.id === activeSiteId) return false;
    if (isGaleSite()) landerWasVisibleAtGale = Boolean(landing.lander?.visible);
    clearHardwareSite();
    footsteps.clear();
    alongM = 0;
    offRouteWalkM = 0;
    procDetailKey = "";
    activeSiteRover = spec;
    activeSiteId = spec.id;
    historicRovers.setFocusId(spec.isCustomSite ? spec.nearRoverId : spec.id);
    const gale = isGaleSite();
    // Spawn Station (Habitat), its NPC crew, and the Gale landing pod stay strictly at Gale's spawn.
    habitatStation.group.visible = gale;
    npcManager.npcGroup.visible = gale;
    chunkGroup.visible = gale;
    if (gale) {
      habitatStation.setBasePose(initRouteOriginX, initRouteOriginZ - ENTRY_OFFSET_Z, rawSampleElevSceneY);
      invalidateCorridorChunks(); // detail meshes carry the habitat pad; rebuild them
      if (landing.lander) landing.lander.visible = landerWasVisibleAtGale;
    } else if (landing.lander) {
      landing.lander.visible = false;
    }
    galeStopsGroup.visible = gale;
    fieldKits.visible = gfx.sceneDetail && gale;
    galeVista.visible = gale && (gfx.sceneDetail || gfx.level !== "low");
    rebuildMainTerrainGeometries(gale);

    if (gale) {
      terrainMat.map = TEX[texMode].tex;
      terrainMat.color.setHex(0xffffff);
      terrainMat.needsUpdate = true;
      syncChunkMaterials();
      const b = document.getElementById("hud-tex");
      if (b) b.textContent = `Tex: ${TEX[texMode].label}`;
      HORIZON.setRGB(0.62, 0.43, 0.3);
      scene.fog.color.copy(HORIZON);
    } else {
      const gTex = buildCustomSiteTexture(spec);
      if (gTex) terrainMat.map = gTex;
      terrainMat.color.setHex(0xffffff);
      terrainMat.needsUpdate = true;
      syncChunkMaterials();
      const b = document.getElementById("hud-tex");
      if (b) b.textContent = "Tex: globe";
      const pal = spec.terrainProfile?.palette;
      if (pal?.skyHorizon) {
        HORIZON.setRGB(pal.skyHorizon[0], pal.skyHorizon[1], pal.skyHorizon[2]);
        scene.fog.color.copy(HORIZON);
      }
    }
    procMat.color.copy(terrainMat.color);
    if (procMat.map !== terrainMat.map) {
      procMat.map = terrainMat.map;
      procMat.needsUpdate = true;
    }

    sunSite.lat = spec.lat;
    sunSite.lon = spec.lon;
    refreshSun({ rebake: true });

    if (gale) {
      for (const r of drivableRovers) r.group.visible = true;
      stationRoversAtHabitat({ includeDrivable: true, resetNpcAnchors: true });
    } else {
      for (const r of drivableRovers) r.group.visible = false;
      historicRovers.clearAll();
      if (!spec.isCustomSite && !spec.isHardwareSite) {
        historicRovers.spawnForSite(spec, {
          x: 0,
          z: 0,
          yaw: -0.35,
          sampleElevY: sampleRenderedSurfaceY,
        });
        historicRovers.setFocusId(spec.id);
      }
      if (!spec.isHardwareSite && devCfg.experimentalRover && activeDriveRover?.group) {
        activeDriveRover.group.visible = true;
        activeDriveRover.spawnBeside(3.0, 2.4, Math.PI * 0.5, sampleRenderedSurfaceY);
        roverDynState.yaw = activeDriveRover.group.rotation.y;
        stationedAtHabitat = false;
      }
    }
    if (fleetBtnEl) fleetBtnEl.textContent = gale ? `Rovers: ${spec.name} (7)` : `Site: ${spec.name}`;
    updateCorridorChunks(phys.x, phys.z, 0);
    return true;
  }

  /**
   * Put the walker at any lat/lon on Mars. Inside the Gale HiRISE tile this is a precise teleport onto the
   * real DTM; anywhere else the site switches to seeded procedural relief centred on that point.
   */
  function visitLocation(lon, lat, { keepYaw = true, sun = null, globeSample = null } = {}) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    if (isTaskLocked()) {
      showTaskLockNotice();
      return false;
    }
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
      const spec = makeCustomSiteSpec(lon, lat, globeSample);
      // Force a rebuild even when landing twice on the same rounded point.
      if (spec.id === activeSiteId) activeSiteId = null;
      switchSite(spec);
      offRouteWalkM = 0;
      teleportToLocal(0, 0, { keepYaw: true });
      if (!keepYaw) {
        autoYaw = 0;
        pitch = -0.06;
      }
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
    if (isTaskLocked()) {
      showTaskLockNotice();
      return false;
    }
    const spec = getHistoricRoverById(roverId) || getHistoricRoverById("curiosity");
    if (!spec) return;
    if (switchTerrain && spec.id !== activeSiteId) {
      switchSite(spec);
    } else if (!activeSiteRover?.isCustomSite) {
      historicRovers.setFocusId(spec.id);
    }

    let entry = historicRovers.getEntry(spec.id);
    if (!entry) {
      if (isGaleSite()) {
        reScatterHistoricRovers(freePos.x, freePos.z);
      } else {
        historicRovers.spawnForSite(spec, {
          x: 0,
          z: 0,
          yaw: -0.35,
          sampleElevY: sampleRenderedSurfaceY,
        });
      }
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
        activeDriveRover.spawnBeside(standX, standZ, userYaw + Math.PI * 0.5, sampleRenderedSurfaceY);
        roverDynState.yaw = activeDriveRover.group.rotation.y;
      }
    }

    if (fleetBtnEl) fleetBtnEl.textContent = isGaleSite() ? `Rovers: ${spec.name} (7)` : `Site: ${spec.name}`;
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
    if (isTaskLocked()) {
      showTaskLockNotice();
      return false;
    }
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
      historicRovers.spawnForSite(getHistoricRoverById(hw.id), { x: 0, z: 0, yaw: Math.PI, sampleElevY: sampleRenderedSurfaceY });
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
      activeDriveRover.spawnBeside(padX + 2.2, padZ + 2.0, Math.PI * 0.5, sampleRenderedSurfaceY);
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
    if (isTaskLocked()) {
      showTaskLockNotice();
      return false;
    }
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

  function visitHabitatStation() {
    if (isTaskLocked()) {
      showTaskLockNotice();
      return false;
    }
    closeTransitPanel();
    leaveRoverForTransit();
    if (!freeRoam && btnFreeRoam) btnFreeRoam.click();
    const gale = getHistoricRoverById("curiosity");
    if (activeSiteId !== gale.id) switchSite(gale);
    else clearHardwareSite();
    const ep = habitatStation.getBayPlacements().entryPoint;
    teleportToLocal(ep.x, ep.z, { keepYaw: true });
    autoYaw = 0;
    userYaw = ep.yaw;
    pitch = -0.05;
    thirdCamInit = false;
    stationRoversAtHabitat({ includeDrivable: true, resetNpcAnchors: true });
    renderHudFleetPanel();
    if (fleetBtnEl) fleetBtnEl.textContent = "Rovers (7)";
    showWrapNotice(isTrLang() ? "MARS ÜSSÜ · BAŞLANGIÇ İSTASYONU" : "MARS HABITAT · SPAWN STATION");
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
    const taskLocked = isTaskLocked();
    const lockNote = taskLocked
      ? `<p class="tp-note" style="color:#fbbf24;">🔒 ${
          tr
            ? "Aktif bir Görev yürütülürken saha konuşlanma / ışınlanma kilitlidir. Önce görevi tamamlayın veya iptal edin."
            : "Site deployment / teleportation is locked while an EVA Task is active. Locate the target rover or abort the task first."
        }</p>`
      : "";
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
        ${lockNote}
        <div class="tp-actions">
          ${here && !taskLocked ? `<button class="btn primary" data-act="return" type="button">${tr ? "Üsse dön [H]" : "Return to habitat [H]"}</button>` : ""}
          <button class="btn" data-act="list" type="button">${tr ? "Tüm sahalar" : "All sites"}</button>
          <button class="btn" data-act="tasks" type="button">${tr ? "🛰️ EVA Görev Ayarla (Tasks)" : "🛰️ Plan EVA Task"}</button>
        </div>
      </div>`;
    } else {
      const rows = MARS_SURFACE_HARDWARE.map(
        (h, i) => `<button class="tp-row${h.id === here ? " current" : ""}" data-hw="${h.id}" type="button" ${taskLocked ? "disabled" : ""}>
          <span class="tp-key">${i + 1}</span>
          <span class="tp-main"><b>${esc(h.name)}</b><i>${esc(h.mission)} · ${esc(h.years)} · ${h.kind === "rover" ? (tr ? "gezgin" : "rover") : tr ? "iniş aracı" : "lander"}</i></span>
          <span class="tp-coord">${esc(formatHardwareLatLon(h))}<i>${esc(h.site)}</i></span>
          <span class="tp-dim">${esc(formatHardwareDims(h))}<i>${h.massKg.toLocaleString("en-US")} kg</i></span>
          <span class="tp-go">${taskLocked ? (tr ? "🔒 KİLİTLİ" : "🔒 LOCKED") : h.id === here ? (tr ? "BURADASIN" : "HERE") : tr ? "IŞINLA ▸" : "DEPLOY ▸"}</span>
        </button>`
      ).join("");
      const drv = activeDriveRover?.getActiveSpec?.();
      body = `<div class="tp-rows">${rows}</div>
        ${lockNote}
        <label class="tp-check"><input type="checkbox" data-act="bring" ${transitBringRover ? "checked" : ""}/> ${
          tr ? "Aktif aracı da getir" : "Bring the active rover"
        }${drv ? ` (${esc(drv.shortLabel)})` : ""}</label>
        <p class="tp-note">${
          tr
            ? "Hazırlık pisti donanımdan 15 m uzaktadır. Koordinatlar yayımlanmış iniş noktalarıdır; saha arazisi prosedüreldir (haritalanmış topoğrafya değil)."
            : "Staging pad is 15 m from the hardware. Coordinates are the published landing sites; site terrain is procedural relief, not mapped topography."
        }</p>
        <div class="tp-actions">
          ${here && !taskLocked ? `<button class="btn primary" data-act="return" type="button">${tr ? "Üsse dön [H]" : "Return to habitat [H]"}</button>` : ""}
          <button class="btn" data-act="tasks" type="button">${tr ? "🛰️ EVA Görev Ayarla (Tasks)" : "🛰️ Plan EVA Task"}</button>
        </div>`;
    }
    transitPanelEl.innerHTML = `<div class="tp-head">
        <span>${info ? (tr ? "SAHA BİLGİSİ" : "SITE INFO") : tr ? "NASA SAHA KONUŞLANMA SEÇİCİ" : "NASA SITE DEPLOYMENT SELECTOR"}</span>
        <button class="btn" data-act="close" type="button">${tr ? "Kapat [Esc]" : "Close [Esc]"}</button>
      </div>${body}`;
    transitPanelEl.classList.add("open");
  }
  function openWallScreenPanel(spec) {
    if (!spec) return;
    const tr = isTrLang();
    releasePointerLock();
    keys.clear();
    const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    transitPanelEl.innerHTML = `<div class="tp-head">
        <span>${esc(spec.title || "TELEMETRY")} · ${esc(spec.tag || "HABITAT")}</span>
        <button class="btn" data-act="close" type="button">${tr ? "Kapat [Esc]" : "Close [Esc]"}</button>
      </div>
      <div class="tp-card">
        <canvas id="hud-wallscreen-canvas" width="768" height="432" style="width:100%;height:auto;display:block;border:1px solid rgba(34,211,238,0.28);background:#02060e;"></canvas>
        <p class="tp-note">${esc(spec.footer || "")}</p>
        <div class="tp-actions">
          <button class="btn primary" data-act="tasks" type="button">${tr ? "🛰️ EVA Görev Ayarla (Tasks)" : "🛰️ Plan EVA Task"}</button>
        </div>
      </div>`;
    transitPanelEl.classList.add("open");
    const cv = transitPanelEl.querySelector("#hud-wallscreen-canvas");
    const ctx = cv?.getContext?.("2d");
    if (ctx) drawTelemetryScreenOnCtx(ctx, 0, 0, 768, 432, spec, "#f472b6");
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
    else if (act === "tasks") {
      closeTransitPanel();
      taskUi.open(null);
    }
    else if (act === "bring") transitBringRover = Boolean(ev.target.checked);
  });

  /** Nearby screen/pad target: "terminal", "return", "info" or null. */
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
      if (findNearbyTaskScreen()) return "taskScreen";
    }
    return null;
  }
  /** Per frame: spin the markers, keep the walker out of a lander, and show the click prompt once. */
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
          if (phys.grounded) {
            phys.y = sampleRenderedSurfaceY(phys.x, phys.z);
            freePos.y = phys.y;
          }
          syncPlayerFromPhys();
        }
      }
    }
    const target = transitPanelIsOpen() || taskUi?.isOpen?.() ? transitPrompt : transitTargetNearby() || "";
    if (target !== transitPrompt) {
      transitPrompt = target;
      const tr = isTrLang();
      const ek = kh("E", "interact");
      if (target === "terminal") showWrapNotice(tr ? `TRANSİT TERMİNALİ · SAHA SEÇİCİ İÇİN [${ek}]` : `TRANSIT TERMINAL · PRESS [${ek}] FOR SITE SELECTOR`);
      else if (target === "return") showWrapNotice(tr ? `DÖNÜŞ FENERİ · ÜSSE DÖNMEK İÇİN [${ek}]` : `RETURN BEACON · PRESS [${ek}] TO RETURN TO HABITAT`);
      else if (target === "info") showWrapNotice(tr ? `${hardwareSite.hw.name.toUpperCase()} · BİLGİ İÇİN [${ek}]` : `${hardwareSite.hw.name.toUpperCase()} · PRESS [${ek}] FOR INFO`);
      else if (target === "taskScreen") {
        const nearScr = findNearbyTaskScreen();
        const titlePrefix = nearScr?.spec?.title ? `${nearScr.spec.title} · ` : "";
        showWrapNotice(
          tr
            ? `${titlePrefix}EVA TASKS · GÖREV & ROTA AYARLAMAK İÇİN [${ek}] / TIKLA`
            : `${titlePrefix}EVA TASKS · PRESS [${ek}] OR CLICK TO PLAN TASK`
        );
      }
    }
  }

  // ---------- Pink Corridor Tasks system (mission routing, 3D paths, minimap & teleport lock) ----------
  const taskGuide3d = createTaskGuide3D(THREE, scene);
  let activeTask = null;
  let latestTaskProgress = null;
  let taskLastChunkRebuildCount = 0;

  function isTaskLocked() {
    return isTeleportLockedForTask(activeTask);
  }
  function showTaskLockNotice() {
    showWrapNotice(
      isTrLang()
        ? "GÖREV AKTİF · HEDEF BULUNANA VEYA İPTAL EDİLENE KADAR IŞINLANMA KİLİTLİ"
        : "TASK ACTIVE · TELEPORTS LOCKED UNTIL TARGET ROVER LOCATED OR ABORTED"
    );
  }

  function planTaskForRoverAndVehicle(roverId, vehicleId) {
    const targetRover = getTaskTargetRover(roverId);
    const veh = getTaskVehicleProfile(vehicleId);
    const targetX = targetRover.isHiRiseGaleSite ? galeLonToX(targetRover.lon) : 0;
    const targetZ = targetRover.isHiRiseGaleSite ? galeLatToZ(targetRover.lat) : 0;
    const sampler = buildSiteElevationSampler(targetRover, { galeSampleY: sampleGaleGridSceneY });
    const staging = selectHabitatStagingSpot({ targetX, targetZ, sampleElevY: sampler });
    const startX = staging.habX + (veh.id === "nasa_concept" ? 6 : -6);
    const startZ = staging.habZ + 43;
    const bundle = generateVehicleRoutes({
      sampleElevY: sampler,
      startX,
      startZ,
      targetX,
      targetZ,
      habX: staging.habX,
      habZ: staging.habZ,
      vehicleId: veh.id,
      cellSizeM: 16,
    });
    return { targetRover, vehicle: bundle.vehicle, targetX, targetZ, staging, startX, startZ, bundle, sampler };
  }

  function deployHabitatAtTaskPose(siteSpec, habX, habZ, targetRover, targetX, targetZ, { habDx, habDy, habDz, keepYaw, keepPitch }) {
    if (drivingRover) {
      drivingRover = false;
      resetRoverMotionState();
      chaseCamInit = false;
      syncDrivingCameraVisualState(false);
      if (self?.group) self.group.visible = suitRig != null;
    }
    if (!freeRoam && btnFreeRoam) btnFreeRoam.click();
    clearHardwareSite();
    if (activeSiteId !== siteSpec.id) {
      switchSite(siteSpec);
    }

    habitatStation.group.visible = true;
    npcManager.npcGroup.visible = true;
    habitatStation.setBasePose(habX, habZ, rawSampleElevSceneY);
    if (siteSpec.isHiRiseGaleSite) invalidateCorridorChunks();
    rebuildMainTerrainGeometries(true);
    procDetailKey = "";
    covWasProcedural = false;

    const newPlayerX = habX + habDx;
    const newPlayerZ = habZ + habDz;
    updateCorridorChunks(newPlayerX, newPlayerZ, 0);
    refreshRtHeightfield();

    for (const r of drivableRovers) r.group.visible = true;
    stationRoversAtHabitat({ includeDrivable: true, resetNpcAnchors: true });
    partnerPos.set(habX, 0, habZ + 38);

    // Keep the 4 non-target historic rovers in the Habitat garage bays; deploy ONLY the target rover in the wild.
    const placements = habitatStation.getBayPlacements().historicPlacements.map((p) =>
      p.id === targetRover.id ? { ...p, x: targetX, z: targetZ, yaw: -0.35 } : p
    );
    historicRovers.spawnAllScattered(placements, {
      sampleElevY: sampleRenderedSurfaceY,
      focusId: targetRover.id,
    });
    historicRovers.setFocusId(targetRover.id);

    // Pre-select player's chosen drivable rover in Bay 02 or Bay 04
    activeDriveRover = getTaskVehicleProfile(activeTask?.vehicleId).id === "nasa_concept" ? roverConcept : roverMmsev;
    if (drvVehEl) drvVehEl.textContent = activeDriveRover.getActiveSpec().shortLabel;

    // Keep player seamlessly at the exact same spot inside the Pink Corridor
    teleportToLocal(newPlayerX, newPlayerZ, { keepYaw: true });
    autoYaw = 0;
    userYaw = keepYaw;
    pitch = keepPitch;
    if (Number.isFinite(habDy)) {
      phys.y = habitatStation.baseY + habDy;
      freePos.y = phys.y;
      syncPlayerFromPhys();
    }
    thirdCamInit = false;
  }

  function startTaskMission({ plan, selectedRoute }) {
    if (!plan || !selectedRoute) return;
    closeTransitPanel();
    taskUi.closeDebrief();
    const tr = isTrLang();
    const habDx = freePos.x - habitatStation.baseX;
    const habDy = phys.y - habitatStation.baseY;
    const habDz = freePos.z - habitatStation.baseZ;
    const keepYaw = userYaw;
    const keepPitch = pitch;

    activeTask = {
      id: `${plan.targetRover.id}-${plan.vehicle.id}-${selectedRoute.id}-${Date.now()}`,
      status: "active",
      targetRoverId: plan.targetRover.id,
      vehicleId: plan.vehicle.id,
      selectedRouteId: selectedRoute.id,
      selectedRoute,
      bundle: plan.bundle,
      habX: plan.staging.habX,
      habZ: plan.staging.habZ,
      targetX: plan.targetX,
      targetZ: plan.targetZ,
      startX: plan.startX,
      startZ: plan.startZ,
      startTimeSec: clockT,
      peakSlopeDeg: 0,
      travelledM: 0,
      lastX: freePos.x,
      lastZ: freePos.z,
      wrongVehicleWarned: false,
    };

    deployHabitatAtTaskPose(
      plan.targetRover,
      plan.staging.habX,
      plan.staging.habZ,
      plan.targetRover,
      plan.targetX,
      plan.targetZ,
      { habDx, habDy, habDz, keepYaw, keepPitch }
    );
    activeTask.lastX = freePos.x;
    activeTask.lastZ = freePos.z;

    const bays = habitatStation.getBayPlacements().drivablePlacements;
    const pickedBay = bays.find((b) => b.vehicleType === plan.vehicle.id);
    taskLastChunkRebuildCount = chunkMeshes.size;
    taskGuide3d.build({
      routes: plan.bundle.routes,
      selectedRouteId: selectedRoute.id,
      targetRover: plan.targetRover,
      targetX: plan.targetX,
      targetZ: plan.targetZ,
      sampleY: sampleRenderedSurfaceY,
      bayPosition: pickedBay ? { x: pickedBay.x, z: pickedBay.z } : null,
    });

    if (plan.targetRover.isHiRiseGaleSite && corridor) {
      const midX = (plan.staging.habX + plan.targetX) * 0.5;
      const midZ = (plan.staging.habZ + plan.targetZ) * 0.5;
      corridor.warmup(midX, midZ, 900, 6000).then(() => {
        if (activeTask?.status === "active" && activeTask.targetRoverId === "curiosity") {
          taskGuide3d.rebuildHeights(sampleRenderedSurfaceY);
        }
      });
    }

    latestTaskProgress = computeTaskProgress({
      routePoints: selectedRoute.points,
      curX: freePos.x,
      curZ: freePos.z,
      targetX: plan.targetX,
      targetZ: plan.targetZ,
      arriveRadiusM: 13.5,
    });
    renderHudFleetPanel();
    if (fleetBtnEl) fleetBtnEl.textContent = tr ? `Görev: ${plan.targetRover.name}` : `Task: ${plan.targetRover.name}`;
    showWrapNotice(
      tr
        ? `GÖREV BAŞLADI: ${plan.targetRover.name.toUpperCase()} ARANIYOR · ${plan.vehicle.shortLabel} (BAY 0${plan.vehicle.id === "nasa_concept" ? 4 : 2}) VE IŞIKLI ROTAYI TAKİP ET`
        : `TASK STARTED: FIND ${plan.targetRover.name.toUpperCase()} · HEAD TO ${plan.vehicle.shortLabel} (BAY 0${plan.vehicle.id === "nasa_concept" ? 4 : 2}) & FOLLOW ROUTE`
    );
  }

  function abortTaskMission() {
    if (!activeTask || activeTask.status !== "active") return;
    const wasInHabitat = isInsideHabitat(freePos.x, freePos.z);
    const habDx = freePos.x - habitatStation.baseX;
    const habDy = phys.y - habitatStation.baseY;
    const habDz = freePos.z - habitatStation.baseZ;
    const keepYaw = userYaw;
    const keepPitch = pitch;

    activeTask.status = "aborted";
    latestTaskProgress = null;
    taskGuide3d.clear();
    taskUi.closeDebrief();
    taskUi.updateMinimap(null, null, null, 0);

    if (drivingRover) {
      drivingRover = false;
      resetRoverMotionState();
      chaseCamInit = false;
      syncDrivingCameraVisualState(false);
      if (self?.group) self.group.visible = suitRig != null;
    }

    const gale = getHistoricRoverById("curiosity");
    if (activeSiteId !== gale.id) {
      switchSite(gale);
    } else {
      clearHardwareSite();
      habitatStation.group.visible = true;
      npcManager.npcGroup.visible = true;
      habitatStation.setBasePose(initRouteOriginX, initRouteOriginZ - ENTRY_OFFSET_Z, rawSampleElevSceneY);
      invalidateCorridorChunks();
      rebuildMainTerrainGeometries(true);
      refreshRtHeightfield();
      stationRoversAtHabitat({ includeDrivable: true, resetNpcAnchors: true });
    }
    if (wasInHabitat) {
      teleportToLocal(habitatStation.baseX + habDx, habitatStation.baseZ + habDz, { keepYaw: true });
      autoYaw = 0;
      userYaw = keepYaw;
      pitch = keepPitch;
      if (Number.isFinite(habDy)) {
        phys.y = habitatStation.baseY + habDy;
        freePos.y = phys.y;
        syncPlayerFromPhys();
      }
    } else {
      const pt = habitatStation.getTransitPoints().arrival;
      teleportToLocal(pt.x, pt.z, { keepYaw: true });
      autoYaw = 0;
      userYaw = pt.yaw;
      pitch = -0.05;
    }
    if (fleetBtnEl) fleetBtnEl.textContent = "Rovers (7)";
    renderHudFleetPanel();
    showWrapNotice(
      isTrLang() ? "GÖREV İPTAL EDİLDİ · IŞINLANMA KİLİDİ AÇILDI" : "TASK ABORTED · TELEPORT LOCK RELEASED"
    );
  }

  const taskUi = createTaskUiController({
    hudView,
    visorOverlay: document.getElementById("visor-overlay") || document.querySelector(".visor-overlay"),
    isTrLang,
    planForRoverAndVehicle: planTaskForRoverAndVehicle,
    getActiveTask: () => activeTask,
    onStartTask: startTaskMission,
    onAbortTask: abortTaskMission,
    onReturnToCorridor: () => {
      if (drivingRover) {
        drivingRover = false;
        resetRoverMotionState();
        chaseCamInit = false;
        syncDrivingCameraVisualState(false);
        if (self?.group) self.group.visible = suitRig != null;
      }
      const pt = habitatStation.getTransitPoints().arrival;
      teleportToLocal(pt.x, pt.z, { keepYaw: true });
      autoYaw = 0;
      userYaw = pt.yaw;
      pitch = -0.05;
      thirdCamInit = false;
    },
    onReleasePointerLock: releasePointerLock,
  });

  function findNearbyTaskScreen() {
    if (!habitatStation.group.visible || drivingRover || freecamActive) return null;
    const list = habitatStation.getTaskScreens?.() || [];
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < list.length; i++) {
      const scr = list[i];
      const d = Math.hypot(freePos.x - scr.x, freePos.z - scr.z);
      if (d >= 3.05 || Math.abs(freePos.y - (scr.y - 1.5)) >= 2.8) continue;
      // Offset into the room along screen normal so the mounting wall itself doesn't self-occlude.
      const nx = Math.sin(scr.ry || 0);
      const nz = Math.cos(scr.ry || 0);
      if (
        habitatStation.clipCameraSegment?.(
          freePos.x,
          freePos.y + 1.5,
          freePos.z,
          scr.x + nx * 0.25,
          scr.y,
          scr.z + nz * 0.25,
          0.01
        ) < 0.96
      ) {
        continue;
      }
      if (d < bestD) {
        bestD = d;
        best = scr;
      }
    }
    return best;
  }

  function tryTaskScreenInteract() {
    const aimX = isPointerLocked() ? null : lastMouseClient.valid ? lastMouseClient.x : null;
    const aimY = isPointerLocked() ? null : lastMouseClient.valid ? lastMouseClient.y : null;
    const hit = pickInteractiveScreen(aimX, aimY);
    if (hit?.kind === "taskScreen" || hit?.kind === "wallScreen") {
      taskUi.open(hit.spec || null);
      return true;
    }
    const near = !findNearestDrivableEntry(freePos.x, freePos.z, 5.2) ? findNearbyTaskScreen() : null;
    if (near) {
      taskUi.open(near.spec || null);
      return true;
    }
    return false;
  }

  onVisitRoverSite((detail) => {
    if (detail?.roverId) {
      if (isTaskLocked()) showTaskLockNotice();
      else visitRoverSite(detail.roverId, { approachRover: true, switchTerrain: true });
    }
  });
  if (fleetBtnEl) fleetBtnEl.textContent = `Rovers (7)`;
  renderHudFleetPanel();

  let goldVisor = 0;
  let optZoom = 1;
  let arrival = null; // { t0, reduced } while the orbit arrival drop plays
  let nextPovStop = null;

  // the old ray-tracing / DLSS pills, if a cached page still has them
  document.getElementById("hud-opt-rt")?.remove();
  document.getElementById("hud-opt-dlss")?.remove();

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
    const lampShown = drivingRover ? roverHeadlightsActive() : evaLampOn;
    if (btnLamp) {
      const lampName = drivingRover ? "Headlights" : "Flashlight";
      const lk = kh("F", "lamp");
      btnLamp.textContent = lampShown ? `${lampName}: ON (${lk})` : `${lampName} (${lk})`;
      btnLamp.classList.toggle("is-active", lampShown);
    }
    if (optGoldPill) {
      optGoldPill.textContent = goldOn ? "VISOR: GOLD" : "VISOR: CLR";
      optGoldPill.classList.toggle("gold", goldOn);
    }
    if (optLampPill) {
      optLampPill.textContent = lampShown ? "LIGHT: ON" : "LIGHT: OFF";
      optLampPill.classList.toggle("active", lampShown);
    }
    if (optZoomPill) {
      optZoomPill.textContent = `MAG: ${optZoom}×`;
      optZoomPill.classList.toggle("active", optZoom > 1);
    }
  }

  function toggleGoldVisor() {
    goldVisor = goldVisor > 0.5 ? 0 : 1;
    syncOpticsOverlayUi();
  }

  // Rover headlights are automatic in the dark; F / R3 overrides them on or off while driving.
  function roverHeadlightsActive() {
    return roverLampOverride ?? (evaLampOn || sunState.elevationRad < 0.22);
  }
  function toggleHelmetLamp() {
    if (drivingRover) roverLampOverride = !roverHeadlightsActive();
    else evaLampOn = !evaLampOn;
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
    const escMenuOpen = document.getElementById("esc-menu")?.classList.contains("open");
    const menuOpen = !document.getElementById("start-screen")?.classList.contains("hidden");
    if (modalOpen || escMenuOpen || menuOpen || npcDialogueUi.isOpen()) return;

    const k = e.key.toLowerCase();
    if (taskUi.handleKeyDown(e)) return;
    if (transitPanelIsOpen()) {
      e.preventDefault();
      if (e.key === "Escape") closeTransitPanel();
      else if (k === "h" && hardwareSite) returnToHabitat();
      else if (/^[1-8]$/.test(k) && transitPanelEl.querySelector("[data-hw]") && !isTaskLocked()) {
        deployToHardwareSite(MARS_SURFACE_HARDWARE[Number(k) - 1].id);
      }
      if (e.key === "Escape") e.stopImmediatePropagation?.();
      return;
    }
    if (k === "n" && !e.repeat && isTaskLocked()) {
      e.preventDefault();
      taskUi.toggleMinimapZoom();
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
    if ((k === "m" || k === "o") && !e.repeat) {
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

    if (e.key === "F4" && !e.repeat) {
      e.preventDefault();
      freecamActive = !freecamActive;
      if (freecamActive) {
        freecamPos.copy(camera.position);
        freecamVel.set(0, 0, 0);
        freecamYaw = autoYaw + userYaw;
        freecamPitch = pitch;
        if (!drivingRover) self?.setHeadVisible?.(true);
        showWrapNotice(
          isTrLang()
            ? "SERBEST KAMERA AKTİF [F4] · WASD HAREKET · SPACE/E YUKARI · Q/C AŞAĞI · SHIFT HIZLI · TEKERLEK HIZ"
            : "FREECAM ACTIVE [F4] · WASD MOVE · SPACE/E UP · Q/C DOWN · SHIFT FAST · SCROLL SPEED"
        );
      } else {
        freecamVel.set(0, 0, 0);
        if (!drivingRover) self?.setHeadVisible?.(thirdPersonWalk);
        showWrapNotice(
          isTrLang()
            ? "SERBEST KAMERA KAPALI [F4] · EVA GÖRÜNÜMÜNE DÖNÜLDÜ"
            : "FREECAM OFF [F4] · RETURNED TO EVA VIEW"
        );
      }
      return;
    }

    if (freecamActive) {
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
      if (k === " ") e.preventDefault();
      keys.add(k);
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

    if (k === "v" && !e.repeat && !drivingRover) {
      toggleWalkCamera();
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
        if (activeDriveRover.isHistoricAdapter) {
          activeDriveRover.release();
          activeDriveRover = preHistoricRover || roverConcept;
          preHistoricRover = null;
        }
        showWrapNotice(tr ? `MARS ARACINDAN İNİLDİ (BİNMEK: ${kh("E", "interact")})` : `EXITED MARS ROVER (PRESS ${kh("E", "interact")} TO BOARD)`);
        return;
      }

      if (tryTaskScreenInteract()) return;

      const aimX = isPointerLocked() ? null : lastMouseClient.valid ? lastMouseClient.x : null;
      const aimY = isPointerLocked() ? null : lastMouseClient.valid ? lastMouseClient.y : null;
      const targetNpc = pickTargetNpc(aimX, aimY);
      if (targetNpc) {
        openNpcDialogueSafe(targetNpc);
        return;
      }

      // a Tasks wall screen in reach: E / Y opens the mission terminal (screens also take clicks)
      if (tryTaskScreenInteract()) return;

      // standing next to a historic rover: E (or Y) drives it; from further away E still opens its card
      const histEntry = nearestHistoricEntry(freePos.x, freePos.z);
      if (histEntry && !drivableHit) {
        preHistoricRover = activeDriveRover?.isHistoricAdapter ? preHistoricRover : activeDriveRover;
        activeDriveRover = makeHistoricDriveAdapter(histEntry);
        const hs = activeDriveRover.getActiveSpec();
        if (drvVehEl) drvVehEl.textContent = hs.shortLabel;
        drivingRover = true;
        resetRoverMotionState();
        prevFirstPersonPitch = pitch;
        pitch = -0.25;
        autoYaw = 0;
        userYaw = histEntry.group.rotation.y;
        roverDynState.yaw = histEntry.group.rotation.y;
        chaseCamInit = false;
        syncDrivingCameraVisualState(true);
        if (self?.group) self.group.visible = false;
        showWrapNotice(
          tr
            ? `${hs.shortLabel} · UZAKTAN SÜRÜŞ (GERÇEKTE ÇOK DAHA YAVAŞ) · ${gamepad.usingPad ? "RT/LT · SOL ÇUBUK" : "W/S · A/D"} · ${kh("E", "interact")} İN`
            : `${hs.shortLabel} · TELEOPERATED DRIVE (THE REAL ROVER IS FAR SLOWER) · ${gamepad.usingPad ? "RT/LT · L-STICK" : "W/S · A/D"} · ${kh("E", "interact")} EXIT`
        );
        return;
      }

      const nearestDrivable = drivableHit?.rover || null;
      if (nearestDrivable) {
        activeDriveRover = nearestDrivable;
        const drvSpec = activeDriveRover.getActiveSpec();
        if (drvVehEl) drvVehEl.textContent = drvSpec.shortLabel;
        drivingRover = true;
        resetRoverMotionState();
        activeDriveRover.sim.reset(
          activeDriveRover.group.position.x,
          activeDriveRover.group.position.z,
          activeDriveRover.group.rotation.y,
          sampleRenderedSurfaceY
        );
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
            ? `${drvSpec.shortLabel} · 3. ŞAHIS SÜRÜŞ · ${gamepad.usingPad ? "RT GAZ · LT FREN · SOL ÇUBUK DİREKSİYON" : "W/S GAZ-FREN · A/D DİREKSİYON · SPACE DRİFT"} · ${kh("E", "interact")} İN`
            : `${drvSpec.shortLabel} · 3RD-PERSON DRIVE · ${gamepad.usingPad ? "RT GAS · LT BRAKE · L-STICK STEER" : "W/S DRIVE · A/D STEER · SPACE DRIFT"} · ${kh("E", "interact")} EXIT`
        );
        return;
      }
      return;
    }

    keys.add(k);
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
  const padSetupEl = document.getElementById("pad-setup");
  const startScreenEl = document.getElementById("start-screen");
  /** `uiBlocked` = hasOpenModalOverlay(), passed in so the loop queries the DOM once per frame. */
  const padBlockedGiven = (uiBlocked) =>
    Boolean(padSetupEl?.classList.contains("open") || (startScreenEl && !startScreenEl.classList.contains("hidden")) || uiBlocked);
  const padBlocked = () => padBlockedGiven(hasOpenModalOverlay());
  // One-line controls hint under the HUD: keyboard keys, or the controller layout once a pad is used.
  const controlsHintEl = document.getElementById("hud-controls-hint");
  function renderControlsHint() {
    if (!controlsHintEl) return;
    const tr = isTrLang();
    const g = (a) => gamepad.glyphFor(a);
    controlsHintEl.textContent = gamepad.usingPad
      ? tr
        ? `SOL ÇUBUK HAREKET · SAĞ ÇUBUK KAMERA · ${g("run")} HIZLI KOŞU · ${g("jump")} ZIPLA · ${g("interact")} ETKİLEŞİM · ${g("pin")} LANDMARK · ${g("camera")} KAMERA · ${g("lamp")} FAR/FENER · ${g("throttle")}/${g("brake")} GAZ/FREN · ${g("map")} HARİTA · ${g("menu")} MENÜ`
        : `L-STICK MOVE · R-STICK CAMERA · ${g("run")} SPRINT · ${g("jump")} JUMP · ${g("interact")} INTERACT · ${g("pin")} LANDMARK · ${g("camera")} CAMERA · ${g("lamp")} LIGHTS · ${g("throttle")}/${g("brake")} GAS/BRAKE · ${g("map")} MAP · ${g("menu")} MENU`
      : tr
        ? "WASD HAREKET · SHIFT HIZLI KOŞU · SPACE ZIPLA · E ETKİLEŞİM (ARAÇLAR & İNSANLAR) · P LANDMARK · V KAMERA · F FENER · M HARİTA · ESC MENÜ"
        : "WASD MOVE · SHIFT SPRINT · SPACE JUMP · E INTERACT (VEHICLES & CREW) · P LANDMARK · V CAMERA · F LIGHT · M MAP · ESC MENU";
  }
  renderControlsHint();
  gamepad.onInputModeChange(() => {
    renderControlsHint();
    syncOpticsOverlayUi();
  });
  gamepad.onConnectionChange(renderControlsHint);

  /** Helmet camera <-> third person while walking (V key, L3 on a controller). */
  function toggleWalkCamera() {
    if (drivingRover) return;
    thirdPersonWalk = !thirdPersonWalk;
    thirdCamInit = false;
    self?.setHeadVisible?.(thirdPersonWalk);
    document.getElementById("visor-overlay")?.classList.toggle("third-person", thirdPersonWalk);
    const pad = kh("V", "camera");
    showWrapNotice(
      isTrLang()
        ? thirdPersonWalk ? `3. ŞAHIS KAMERA · [${pad}] KASK` : `KASK KAMERASI · [${pad}] 3. ŞAHIS`
        : thirdPersonWalk ? `3RD-PERSON CAMERA · [${pad}] HELMET` : `HELMET CAMERA · [${pad}] 3RD PERSON`
    );
  }

  gamepad.onPress(({ actions }) => {
    if (landing.active) return landing.skip();
    if (!isHudActive() || padBlocked()) return;
    if (actions.includes("interact")) {
      // same as the E key: board / leave any vehicle (historic rovers too), talk to crew
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "e", bubbles: true }));
      return;
    }
    if (actions.includes("lamp")) {
      toggleHelmetLamp();
      gamepad.triggerHaptic?.(0.25, 45);
      return;
    }
    if (actions.includes("pin")) {
      dropLocalPing("Landmark");
    }
    if (actions.includes("back") && optZoom > 1) {
      optZoom = 1;
      camera.fov = BASE_FOV;
      camera.updateProjectionMatrix();
      hudView?.classList.remove("zoom-active");
    }
    if (actions.includes("camera")) toggleWalkCamera();
    // bumpers (jump, sprint) only act on foot; triggers only while driving
    if (drivingRover) return;
    for (const a of actions) {
      if (a === "jump") {
        if (devCfg.realisticPhysics) {
          if (phys.grounded) {
            phys.jumpQueued = true;
            gamepad.triggerHaptic?.(0.35, 55);
          }
        } else if (phys.grounded) {
          phys.vy = JUMP_SPEED_MS;
          phys.grounded = false;
          player.vy = JUMP_SPEED_MS;
          player.grounded = false;
          gamepad.triggerHaptic?.(0.35, 55);
        }
      } else if (a === "pov") document.getElementById("hud-pov-btn")?.click();
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

    if (isTaskLocked() && latestTaskProgress) {
      const tr = isTrLang();
      const tgtR = getTaskTargetRover(activeTask.targetRoverId);
      setText("hud-dist", `${latestTaskProgress.directDistM.toFixed(0)} m`);
      setText(
        "hud-dist-sub",
        tr
          ? `rota kalan ${latestTaskProgress.remainingRouteM.toFixed(0)} m · sapma ${latestTaskProgress.offRouteM.toFixed(0)} m`
          : `route left ${latestTaskProgress.remainingRouteM.toFixed(0)} m · off-rt ${latestTaskProgress.offRouteM.toFixed(0)} m`
      );
      setText("hud-next-stop", `${tr ? "HEDEF" : "FIND"} ${tgtR.name.toUpperCase()}`);
      setText(
        "hud-next-kind",
        `${tr ? activeTask.selectedRoute.nameTr : activeTask.selectedRoute.nameEn} · ${activeTask.selectedRoute.suitabilityPct}%`
      );
    } else if (onRoute) {
      setText("hud-dist", `${sM.toFixed(1)} m`);
      const stopDistLabel = nextMode === "leg" ? "next stop" : "nearest stop";
      setText(
        "hud-dist-sub",
        `remaining ${rem.toFixed(1)} m · ${stopDistLabel} ${nextStopDist < Infinity ? nextStopDist.toFixed(0) + " m" : "—"}`
      );
      setText("hud-next-stop", nextStop?.properties?.name || "—");
      setText("hud-next-kind", nextStop?.properties?.kind || "—");
    } else {
      setText("hud-dist", "OFF-ROUTE");
      setText("hud-dist-sub", `EVA route is at Gale · here: ${activeSiteRover.siteShortName}`);
      setText("hud-next-stop", "—");
      setText("hud-next-kind", "no science stops at this site");
    }
    setText("hud-slope", `${Number(slopeDeg).toFixed(1)}°`);
    const badge = document.getElementById("hud-slope-badge");
    if (badge) {
      badge.textContent = slopeClass.id;
      badge.className = `slope-badge slope-${slopeClass.id}`;
    }

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
  let displayMs = 16.7; // shortest recent frame = the display's refresh interval (or the FPS limit)
  let lastScaleChange = 0;
  let gfxApplied = false;
  let lastDrawMs = 0;
  let perfKeyOn = false;
  let perfDraws = 0;
  let perfTris = 0;
  // F3 / "Show performance stats": frame rate and renderer counters. A geometry or texture count
  // that keeps climbing while you stand still is a leak.
  const perfEl = document.createElement("div");
  perfEl.id = "hud-perf";
  perfEl.className = "hud-perf";
  perfEl.hidden = true;
  hudView.appendChild(perfEl);
  window.addEventListener("keydown", (e) => {
    if (e.key !== "F3" || !hudView.classList.contains("active")) return;
    e.preventDefault();
    perfKeyOn = !perfKeyOn;
    perfEl.hidden = !(devCfg.showPerf || perfKeyOn);
  });

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

  let viewW = 1;
  let viewH = 1;
  let lastQualityKey = "";

  // Render resolution: the pixel ratio carries the render scale, and the composer sizes every
  // buffer (AO included) from the drawing buffer, so all passes stay the same size as the frame.
  const resizeRenderTarget = () => {
    const pr = effectivePixelRatio(window.devicePixelRatio || 1, gfx.pixelRatioCap, renderScale);
    if (Math.abs(renderer.getPixelRatio() - pr) > 1e-4) renderer.setPixelRatio(pr);
    postPipeline.setSize(viewW, viewH);
    rt.width = Math.max(1, Math.floor(viewW * pr));
    rt.height = Math.max(1, Math.floor(viewH * pr));
    lensMat.uniforms.uResolution.value.set(rt.width, rt.height);
  };

  const onResize = () => {
    const w = wrap.clientWidth || window.innerWidth;
    const topOff = document.body.classList.contains("in-hud") ? 0 : 44;
    const h = wrap.clientHeight || window.innerHeight - topOff;
    viewW = w;
    viewH = h;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    cachedCanvasRect = renderer.domElement.getBoundingClientRect();
    resizeRenderTarget();
    marsFx.setViewportHeight(h * renderer.getPixelRatio(), camera.fov);
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
    lensMat.uniforms.uGrain.value = 0.014 * Math.max(0.35, strength);
    lensMat.uniforms.uGold.value = goldVisor;
    lensMat.uniforms.uOptZoom.value = optZoom;

    if (camera.fov !== cfg.fov) {
      camera.fov = cfg.fov;
      camera.updateProjectionMatrix();
    }

    const prevGfx = gfx;
    gfx = resolveGraphics(cfg, gfxHw);
    const wantSuper = gfx.level === "ultra";
    if (roverMmsev?.nasaModelRoot) {
      const mmsevShadow = gfx.shadowPx >= 2048;
      roverMmsev.nasaModelRoot.traverse((o) => {
        if (o.isMesh) o.castShadow = mmsevShadow;
      });
    }
    if (!gfxApplied || prevGfx.level !== gfx.level || prevGfx.renderScale !== gfx.renderScale || !gfx.adaptive) {
      renderScale = gfx.renderScale;
    } else renderScale = Math.max(gfx.minScale, Math.min(gfx.renderScale, renderScale));
    // terrain radius or level of detail changed: plan the chunks again on the next frame
    if (prevGfx.detailRadiusM !== gfx.detailRadiusM || prevGfx.lodNearM !== gfx.lodNearM || prevGfx.lodSegs !== gfx.lodSegs) {
      chunkPlanT = 0;
    }
    applyMirrorRing(gfx.mirrorRing);
    gfxApplied = true;
    if (perfEl) perfEl.hidden = !(cfg.showPerf || perfKeyOn);

    const postKey = `${gfx.ao}|${gfx.aa}|${gfx.bloom}`;
    if (postKey !== lastPostKey) {
      lastPostKey = postKey;
      postPipeline.applySettings({ ao: gfx.ao, aa: gfx.aa, bloom: gfx.bloom });
    }
    syncOpticsOverlayUi();

    // "shadows off" keeps a small map allocated but the sun stops casting (see the loop)
    const wantShadowPx = gfx.shadowPx || 512;
    const wantShadowHalf = gfx.shadowHalfM;
    const wantShadowType = gfx.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
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
    rockField.group.visible = gfx.sceneDetail;
    galeVista.visible = isGaleSite() && (gfx.sceneDetail || gfx.level !== "low");
    fieldKits.visible = gfx.sceneDetail && isGaleSite();
    const tau = MARS_DUST_TAU;
    sky.material.uniforms.uTau.value = tau;
    sky.material.uniforms.uSunElev.value = sunState.elevationRad;
    for (const moon of [phobos, deimos]) {
      moon.material.uniforms.uTau.value = tau;
      moon.material.uniforms.uSunElev.value = sunState.elevationRad;
    }
    updateAtmosphericHazeUniforms(atmoUniforms, { sunElev: sunState.elevationRad, tau: MARS_DUST_TAU });
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
      activeDriveRover.spawnBeside(freePos.x, freePos.z, autoYaw + userYaw, sampleRenderedSurfaceY);
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
    const qualityKey = `${gfx.level}|${wantSuper}`;
    if (lastQualityKey && lastQualityKey !== qualityKey) {
      chunkPlanT = 0;
      chunkPlanCell = "";
    }
    lastQualityKey = qualityKey;
    onResize();
  }

  // Adaptive resolution: the 3D scene renders into rt, so its size can drop when frames are slow
  // and come back when there is headroom. Disabled when Experimental Super Graphics is active.
  // "Fast" is measured against the display's own frame time (the shortest frame seen lately), so
  // the resolution also climbs back on a 60 Hz screen, where no frame is ever shorter than 16.7 ms.
  function adaptResolution(now) {
    if (!gfx.adaptive) return;
    if (now - lastScaleChange < 1200) return;
    let next = renderScale;
    if (frameAvg > Math.max(24, displayMs * 1.45) && renderScale > gfx.minScale) {
      next = Math.max(gfx.minScale, renderScale - 0.1);
    } else if (frameAvg < Math.max(15, displayMs * 1.12) && renderScale < gfx.renderScale) {
      next = Math.min(gfx.renderScale, renderScale + 0.05);
    }
    if (next !== renderScale) {
      renderScale = next;
      lastScaleChange = now;
      resizeRenderTarget();
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
  const perfEnabled =
    typeof window !== "undefined" &&
    (/(?:[?&])perf=1(?:&|$)/.test(window.location.search || "") ||
      (() => {
        try {
          return window.localStorage?.getItem("mm-perf") === "1";
        } catch {
          return false;
        }
      })());
  const perfOverlayEl = perfEnabled && typeof document !== "undefined" ? document.createElement("div") : null;
  const perfSamples = perfEnabled ? new Float32Array(120) : null;
  const perfScratch = perfEnabled ? new Float32Array(120) : null;
  let perfCursor = 0;
  let perfFilled = 0;
  let perfLastUiMs = 0;
  let perfLastStamp = 0;
  if (perfOverlayEl) {
    perfOverlayEl.id = "hud-perf-readout";
    perfOverlayEl.style.cssText =
      "position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:99999;pointer-events:none;font:600 11px/1.35 ui-monospace,Consolas,monospace;color:#7ef9ff;background:rgba(4,10,16,0.82);border:1px solid rgba(126,249,255,0.45);border-radius:6px;padding:4px 9px;white-space:pre;letter-spacing:0.02em;";
    perfOverlayEl.textContent = "PERF: warming up...";
    document.body.appendChild(perfOverlayEl);
  }
  let wasHudHidden = false;
  let svfLastX = NaN;
  let svfLastZ = NaN;
  let cachedSvf = 0.75;
  const activeBeamDir = new THREE.Vector3();

  // scratch objects for the loop: nothing below allocates per frame
  const NO_STICK = Object.freeze({ x: 0, y: 0 });
  const habActors = [{ x: 0, z: 0 }];
  const habUpdateOpts = { actors: habActors };
  const driveInput = { throttle: 0, steer: 0, boost: false, handbrake: false };
  // `park` lets the dynamics put a rover that has settled on its springs to sleep
  const PARKED_INPUT = Object.freeze({ throttle: 0, steer: 0, boost: false, handbrake: true, park: true });
  const wheelNormal = { x: 0, y: 1, z: 0 };
  const roverEnv = { sampleY: sampleRenderedSurfaceY, sampleNormal: (x, z) => sampleNormal(x, z, wheelNormal) };
  const dashStruts = [0, 0, 0, 0, 0, 0];
  const strikes = [];
  const gaitDirScratch = { f: 0, s: 0 };
  const gaitOpts = {
    crouch: 0,
    lean: 0,
    brake: 0,
    reset: false,
    footDyL: 0,
    footDyR: 0,
    normalL: null,
    normalR: null,
    onStrike: (side) => strikes.push(side),
  };
  let strictSlopeEl = null;
  let metabolicEl = null;
  let zoomReadoutEl = null;
  function animate(now) {
    requestAnimationFrame(animate);
    // FPS limit: skip display frames until the chosen interval has passed
    if (gfx.fpsLimit && now - lastDrawMs < 1000 / gfx.fpsLimit - 2) return;
    lastDrawMs = now;
    const frameMs = now - prevT;
    const dt = Math.min(0.1, frameMs / 1000);
    prevT = now;
    if (!hudView.classList.contains("active")) {
      wasHudHidden = true;
      return; // nothing runs while the view is hidden
    }
    const resumedFromHide = wasHudHidden || frameMs > 250;
    wasHudHidden = false;
    const perfT0 = perfOverlayEl ? performance.now() : 0;
    syncStableLights();
    clockT += dt;
    if (frameMs < 250) {
      frameAvg += (frameMs - frameAvg) * 0.05;
      displayMs = frameMs < displayMs ? frameMs : displayMs + (frameMs - displayMs) * 0.002;
    }
    renderer.info.reset();
    // one DOM query per frame for "is a menu or dialog open", shared by everything below
    const uiBlocked = hasOpenModalOverlay();

    // habitat: bay doors / airlock doors open for the walker and the driven rover
    if (habitatStation.group.visible) {
      habActors.length = 1;
      habActors[0].x = freePos.x;
      habActors[0].z = freePos.z;
      if (drivingRover && activeDriveRover?.group) habActors.push(activeDriveRover.group.position);
      habitatStation.update(dt, habUpdateOpts);
    }
    updateTransit(dt);

    // controller look (right stick), off while a menu, dialog or the setup screen has the pad
    const padBusy = padBlockedGiven(uiBlocked);
    const lk = padBusy ? NO_STICK : gamepad.look();
    if (lk.x || lk.y) {
      if (freecamActive) {
        freecamYaw -= lk.x * 2.6 * dt;
        freecamPitch = Math.max(-1.53, Math.min(1.53, freecamPitch + lk.y * 1.9 * dt));
      } else {
        userYaw -= lk.x * 2.6 * dt;
        const minP = drivingRover ? -1.08 : -1.35;
        const maxP = drivingRover ? -0.06 : 1.42;
        pitch = Math.max(minP, Math.min(maxP, pitch + lk.y * 1.9 * dt));
      }
    }

    // progress along the route = the route point nearest to you (for the HUD only)
    alongM = nearestAlongRoute(freePos.x, freePos.z, alongM);
    const sample = sampleAlongRoute(routeCoords, cumDist, toGeomDist(alongM));
    let px = player.x;
    let pz = player.z;
    const prevX = player.x;
    const prevZ = player.z;
    let roverLateralSpeed = 0;

    if (freecamActive) {
      // [F4] 6-DOF Freecam flight: walker / rover stays parked while camera flies freely
      if (!uiBlocked) {
        const cp = Math.cos(freecamPitch);
        freecamFwd.set(-Math.sin(freecamYaw) * cp, Math.sin(freecamPitch), -Math.cos(freecamYaw) * cp);
        freecamRight.set(Math.cos(freecamYaw), 0, -Math.sin(freecamYaw));
        freecamWish.set(0, 0, 0);
        if (keys.has("w") || keys.has("arrowup")) freecamWish.add(freecamFwd);
        if (keys.has("s") || keys.has("arrowdown")) freecamWish.sub(freecamFwd);
        if (keys.has("d") || keys.has("arrowright")) freecamWish.add(freecamRight);
        if (keys.has("a") || keys.has("arrowleft")) freecamWish.sub(freecamRight);
        if (keys.has(" ") || keys.has("e")) freecamWish.y += 1;
        if (keys.has("q") || keys.has("c") || keys.has("control")) freecamWish.y -= 1;
        if (!padBusy && freecamWish.lengthSq() === 0) {
          const st = gamepad.move();
          if (Math.hypot(st.x, st.y) > 0.05) {
            freecamWish.addScaledVector(freecamFwd, st.y).addScaledVector(freecamRight, st.x);
          }
        }
        if (freecamWish.lengthSq() > 1) freecamWish.normalize();
        const boostMult = keys.has("shift") ? 3.5 : keys.has("alt") ? 0.25 : 1.0;
        const targetSpeed = freecamSpeed * boostMult;
        const blend = Math.min(1, dt * 11);
        freecamVel.x += (freecamWish.x * targetSpeed - freecamVel.x) * blend;
        freecamVel.y += (freecamWish.y * targetSpeed - freecamVel.y) * blend;
        freecamVel.z += (freecamWish.z * targetSpeed - freecamVel.z) * blend;
      } else {
        freecamVel.multiplyScalar(Math.max(0, 1 - dt * 10));
      }
      freecamPos.addScaledVector(freecamVel, dt);
      const minCamY = sampleElevSceneY(freecamPos.x, freecamPos.z) + 0.35;
      if (freecamPos.y < minCamY) {
        freecamPos.y = minCamY;
        if (freecamVel.y < 0) freecamVel.y = 0;
      }
      for (const idleDrv of drivableRovers) {
        if (!idleDrv.group.visible) continue;
        if (idleDrv.sim.step(dt, PARKED_INPUT, roverEnv)) idleDrv.rig.sync();
      }
    } else if (freeRoam && drivingRover && activeDriveRover?.group?.visible) {
      const rYaw0 = activeDriveRover.group.rotation.y;
      const fx0 = -Math.sin(rYaw0);
      const fz0 = -Math.cos(rYaw0);
      const rx0 = Math.cos(rYaw0);
      const rz0 = -Math.sin(rYaw0);
      let steerJerk = 0;

      let dyn = null;
      {
        const sim = activeDriveRover.sim;
        const rig = activeDriveRover.rig;
        // inputs: keyboard, or Xbox controller (RT throttle, LT brake/reverse, left stick steer).
        // The bumpers belong to walking (LB jump, RB sprint); handbrake and boost stay on Space / Shift.
        const padOk = !padBusy;
        const st = padOk ? gamepad.move() : NO_STICK;
        const rt = padOk ? gamepad.analog("throttle") : 0;
        const lt = padOk ? gamepad.analog("brake") : 0;
        const keyThrottle =
          (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
        const keySteer =
          (keys.has("a") || keys.has("arrowleft") ? 1 : 0) - (keys.has("d") || keys.has("arrowright") ? 1 : 0);
        const mapBlocked = uiBlocked;
        const throttle = mapBlocked ? 0 : keyThrottle || (rt - lt);
        const steerIn = mapBlocked ? 0 : keySteer || -st.x;
        const handbrake = !mapBlocked && keys.has(" ");
        const boost = !mapBlocked && keys.has("shift");
        prevRoverSteer = roverSteer;
        roverSteer += (steerIn - roverSteer) * Math.min(1, dt * 10.5);
        steerJerk = dt > 0 ? Math.abs(roverSteer - prevRoverSteer) / dt : 0;

        const prevYaw = sim.attitude().yaw;
        driveInput.throttle = throttle;
        driveInput.steer = roverSteer;
        driveInput.boost = boost;
        driveInput.handbrake = handbrake;
        sim.step(dt, driveInput, roverEnv);
        const rs = sim.state;

        // bumping into crewmates, other vehicles, habitat, historic rovers, and NPCs: push out and bleed speed
        rig.sync();
        const pushOut = (x, z, radius, y) => {
          const hit = activeDriveRover.resolveCollision(x, z, radius, y);
          if (!hit.hit) return;
          sim.setPosition(rs.pos.x - hit.nx * hit.pen, rs.pos.z - hit.nz * hit.pen, roverEnv.sampleY);
          sim.scaleVelocity(0.25);
          rig.sync();
        };
        if (partner && partner.group.visible) pushOut(partner.group.position.x, partner.group.position.z, PARTNER_COLLISION_R + 0.08, partner.group.position.y);
        for (const otherDrv of drivableRovers) {
          if (otherDrv === activeDriveRover || !otherDrv.group.visible) continue;
          pushOut(otherDrv.group.position.x, otherDrv.group.position.z, otherDrv.radius * 0.72, otherDrv.group.position.y);
        }
        if (habitatStation.group.visible) {
          const hitHab = habitatStation.resolveCollision(rs.pos.x, rs.pos.z, 1.75, rs.pos.y);
          if (hitHab.hit) {
            sim.setPosition(hitHab.x, hitHab.z, roverEnv.sampleY);
            sim.scaleVelocity(0.25);
            rig.sync();
          }
        }
        for (const histEntry of historicRovers.getAllEntries()) {
          if (histEntry.group === activeDriveRover.group) continue; // the rover you are driving
          const hPos = histEntry.group?.position;
          const hSpec = histEntry.spec;
          if (!hPos || !hSpec) continue;
          pushOut(hPos.x, hPos.z, Math.max(hSpec.halfW || 1.2, hSpec.halfL || 1.3) * 0.72, hPos.y);
        }
        if (npcManager.npcGroup.visible) {
          for (const npcEntry of npcManager.getAllNpcs()) {
            pushOut(npcEntry.x, npcEntry.z, 0.52, npcEntry.y);
          }
        }

        // endless terrain: the wrap moves activeDriveRover.group; carry the simulation with it
        applySeamlessWorldWrap(activeDriveRover.group.position.x, activeDriveRover.group.position.z);
        if (activeDriveRover.group.position.x !== rs.pos.x || activeDriveRover.group.position.z !== rs.pos.z) {
          sim.setPosition(activeDriveRover.group.position.x, activeDriveRover.group.position.z, roverEnv.sampleY);
          rig.sync();
        }

        const att = sim.attitude();
        let dYaw = att.yaw - prevYaw;
        dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
        userYaw += dYaw; // the chase camera turns with the rover

        // values the rest of the frame (camera, dust, crew sync) reads
        roverVelX = rs.vel.x;
        roverVelZ = rs.vel.z;
        roverThrottleVel = rs.vLong;
        roverLateralSpeed = rs.vLat;
        roverAirState.airborne = rs.airborne;
        roverAirState.posY = rs.pos.y;
        roverAirState.velY = rs.vel.y;
        roverLandingImpact = rs.landingImpact;
        let slipMax = 0;
        for (const wh of sim.wheels) if (wh.contact) slipMax = Math.max(slipMax, wh.slip);
        const drifting = Math.abs(rs.vLat) > 1.2 && Math.abs(rs.vLong) > 2;
        dyn = {
          drifting,
          braking: rs.brake > 0.1 || handbrake,
          slipRatio: slipMax,
          gear: rs.gear,
          rpmNorm: Math.min(1, rs.motorRpm / 4000),
          spec: activeDriveRover.getActiveSpec(),
        };

        // dust when a wheel lands hard or the rover touches down after a crest
        if (rs.landingImpact > 1.0 && !isInsideHabitat(rs.pos.x, rs.pos.z)) {
          const rYawL = att.yaw;
          marsFx.emitJumpBurst(rs.pos.x, sampleRenderedSurfaceY(rs.pos.x, rs.pos.z), rs.pos.z, {
            mode: "land",
            impactSpeed: Math.max(1.2, rs.landingImpact * 1.15),
            rightX: Math.cos(rYawL),
            rightZ: -Math.sin(rYawL),
            fwdX: -Math.sin(rYawL),
            fwdZ: -Math.cos(rYawL),
            vx: rs.vel.x,
            vz: rs.vel.z,
          });
        }

        // instrument cluster
        const P = sim.params;
        for (let i = 0; i < 6; i++) dashStruts[i] = sim.wheels[i].comp / P.maxComp; // FL FR ML MR RL RR
        roverDash.update({
          speedKmh: rs.vLong * 3.6,
          rpm: rs.motorRpm,
          gear: rs.gear,
          powerKw: rs.powerW / 1000,
          maxPowerKw: rs.maxPowerKw,
          hp: rs.hp,
          maxHp: rs.maxHp,
          torquePct: rs.torquePct,
          wheelTorqueNm: rs.wheelTorqueNm,
          maxWheelTorqueNm: rs.maxWheelTorqueNm,
          massKg: rs.massKg,
          weightN: rs.weightN,
          batteryPct: (100 * rs.batteryKWh) / P.batteryKWh,
          accel: rs.accel,
          pitchDeg: (att.pitch * 180) / Math.PI,
          rollDeg: (att.roll * 180) / Math.PI,
          headingDeg: (-att.yaw * 180) / Math.PI,
          odoKm: rs.odometerM / 1000,
          struts: dashStruts,
          slipPct: slipMax * 100,
          airborne: rs.airborne,
          wheelspin: rs.tractionLimited && Math.abs(rs.pedal) > 0.3,
          handbrake,
          boost,
        });
        if (drvSpdEl) drvSpdEl.textContent = String(Math.round(Math.abs(rs.vLong) * 3.6));
        if (drvGearEl) drvGearEl.textContent = rs.gear;
        if (drvRpmEl) drvRpmEl.style.width = `${Math.round(Math.min(1, rs.motorRpm / 4000) * 100)}%`;
        if (drvSlipEl) {
          const slipPct = Math.round(slipMax * 100);
          drvSlipEl.classList.toggle("drifting", drifting);
          drvSlipEl.textContent = rs.airborne
            ? "AIRBORNE"
            : drifting
              ? `DRIFT ${slipPct}%`
              : `GRIP ${Math.max(0, 100 - slipPct)}%`;
        }
        for (const idleDrv of drivableRovers) {
          if (idleDrv === activeDriveRover || !idleDrv.group.visible) continue;
          const rsIdle = idleDrv.sim.state;
          if (Math.hypot(rsIdle.pos.x - idleDrv.group.position.x, rsIdle.pos.z - idleDrv.group.position.z) > 0.5) {
            idleDrv.sim.reset(idleDrv.group.position.x, idleDrv.group.position.z, idleDrv.group.rotation.y, sampleRenderedSurfaceY);
          }
          if (idleDrv.sim.step(dt, PARKED_INPUT, roverEnv)) idleDrv.rig.sync();
        }

        if (
          !isInsideHabitat(rs.pos.x, rs.pos.z) &&
          !roverAirState.airborne &&
          (Math.abs(roverThrottleVel) > 0.7 || Math.abs(roverLateralSpeed) > 1.2 || dyn?.drifting)
        ) {
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
              sampleRenderedSurfaceY(emit.x, emit.z),
              emit.z,
              Math.min(7, burstCount),
              Math.min(2.15, 0.72 + speedMag * 0.13),
              -fx * roverThrottleVel * 0.24 - Math.cos(rYaw) * roverLateralSpeed * 0.22,
              -fz * roverThrottleVel * 0.24 + Math.sin(rYaw) * roverLateralSpeed * 0.22
            );
          }
        }
      }

      // tire tracks: one segment per wheel side every ~0.45 m of travel, fading over minutes
      if (!roverAirState.airborne && !isInsideHabitat(activeDriveRover.group.position.x, activeDriveRover.group.position.z)) {
        roverTrackDist += Math.hypot(roverThrottleVel, roverLateralSpeed) * dt;
        if (roverTrackDist >= 0.45) {
          roverTrackDist = 0;
          const tYaw = activeDriveRover.group.rotation.y;
          const tw = Math.max(0.25, Math.min(0.6, (activeDriveRover.getActiveSpec().trackHalfW || 1) * 0.28));
          for (const side of [-1, 1]) {
            const w = activeDriveRover.getWheelDustEmitPoint(side);
            marsFx.stampTrack(w.x, sampleRenderedSurfaceY(w.x, w.z), w.z, sampleNormal(w.x, w.z), tYaw, tw, 0.5);
          }
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
      if (!uiBlocked) {
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
              slopeLimitDeg: (strictSlopeEl ||= document.getElementById("toggle-strict-15"))?.checked ? 15 : 20,
              latDeg: zToLat(phys.z),
            },
            heightEnv
          );
        } else {
          const run = keys.has("shift") || padRun;
          const here = sampleRenderedSurfaceY(phys.x, phys.z);
          let desiredVx = 0;
          let desiredVz = 0;
          if (moveDir.lengthSq() > 0) {
            const ahead = sampleRenderedSurfaceY(phys.x + moveDir.x * 1.5, phys.z + moveDir.z * 1.5);
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
          const groundSimple = sampleRenderedSurfaceY(phys.x, phys.z);
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
      if (wrapRes.wrapped && isGaleSite()) {
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
        // parked: settle briefly on its springs, then sleep until moved/re-seeded
        const rsP = drvR.sim.state;
        if (Math.hypot(rsP.pos.x - drvR.group.position.x, rsP.pos.z - drvR.group.position.z) > 0.5) {
          drvR.sim.reset(drvR.group.position.x, drvR.group.position.z, drvR.group.rotation.y, sampleRenderedSurfaceY);
        }
        if (drvR.sim.step(dt, PARKED_INPUT, roverEnv)) drvR.rig.sync();
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
            ? `${nSpec.nameTr.toUpperCase()} · BİNMEK İÇİN [${kh("E", "interact")}] TUŞUNA BAS`
            : `${nSpec.nameEn.toUpperCase()} · PRESS [${kh("E", "interact")}] TO DRIVE`
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
        const pushedGroundY = sampleElevSceneY(freePos.x, freePos.z) - (phys.sinkM || 0);
        if (phys.y < pushedGroundY) phys.y = pushedGroundY;
        phys.vx *= 0.2;
        phys.vz *= 0.2;
        if (phys.grounded) phys.y = sampleRenderedSurfaceY(phys.x, phys.z);
      }
      syncPlayerFromPhys();
      px = phys.x;
      pz = phys.z;

      if (!isInsideHabitat(px, pz)) {
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
      const ground = sampleRenderedSurfaceY(px, pz);
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
    if (!isGaleSite() && !landing.active && freeRoam) offRouteWalkM += step;
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
      gaitDir = gaitDirScratch;
      gaitDir.f = (mvx * fx + mvz * fz) / movedXZ;
      gaitDir.s = (mvx * -fz + mvz * fx) / movedXZ;
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
    strikes.length = 0;
    if (snappedThisFrame) groundSpeedSm = 0;
    groundSpeedSm += (groundSpeed - groundSpeedSm) * Math.min(1, dt * 9);
    if (groundSpeedSm < 0.03 && step === 0) groundSpeedSm = 0;
    gaitOpts.crouch = phys.crouch;
    gaitOpts.lean = lean;
    gaitOpts.brake = brake;
    gaitOpts.reset = snappedThisFrame;
    gaitOpts.footDyL = feet.footDyL;
    gaitOpts.footDyR = feet.footDyR;
    gaitOpts.normalL = feet.normalL;
    gaitOpts.normalR = feet.normalR;
    self.update(dt, step, groundSpeedSm, !player.grounded, gaitDir, gaitOpts);
    self.group.updateMatrixWorld(true);
    if (!drivingRover && !snappedThisFrame) {
      for (const side of strikes) {
        const bone = side === "L" ? self.bones.footL : self.bones.footR;
        if (!bone) continue;
        bone.getWorldPosition(footPos);
        const gy = sampleRenderedSurfaceY(footPos.x, footPos.z);
        const n = sampleNormal(footPos.x, footPos.z);
        footsteps.play(side, phys.faciesId);
        if (!isInsideHabitat(footPos.x, footPos.z)) {
          footsteps.stamp(footPos.x, gy, footPos.z, n, lastMoveYaw ?? yaw, phys.faciesId, side);
          if (groundSpeed > 0.35 && movedXZ > 1e-5) {
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
    if (freecamActive) {
      camera.position.copy(freecamPos);
      camera.rotation.order = "YXZ";
      camera.rotation.y = freecamYaw;
      camera.rotation.x = freecamPitch;
      camera.rotation.z = 0;
    } else if (drivingRover && activeDriveRover?.group?.visible) {
      const rPos = activeDriveRover.group.position;
      const rYaw = activeDriveRover.group.rotation.y;
      // chase distance scales with the vehicle: 6.9 m behind the MMSEV, about 2 m behind Sojourner
      const camBase = activeDriveRover.chaseDist ?? 6.9;
      const camDist = camBase + Math.min(1.6 * (camBase / 6.9), Math.abs(roverThrottleVel) * 0.065) + (roverAirState.airborne ? 0.75 : 0);
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
      camY = Math.max(camY, sampleRenderedSurfaceY(camX, camZ) + 0.35);
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
      const headX = px;
      const headY = Math.max(player.y, eyeBaseY) + EYE_HEIGHT_M - phys.crouch;
      const headZ = pz;
      let camX = px + fwd.x * eyeFwd + right.x * swayX;
      let camY = headY - tip * 0.07 + swayY;
      let camZ = pz + fwd.z * eyeFwd + right.z * swayX;
      if (habitatStation.group.visible) {
        const t = habitatStation.clipCameraSegment(headX, headY, headZ, camX, camY, camZ);
        if (t < 1) {
          const k = Math.max(0, t - 0.05);
          camX = headX + (camX - headX) * k;
          camY = headY + (camY - headY) * k;
          camZ = headZ + (camZ - headZ) * k;
        }
        const ceil = habitatStation.ceilingAt(camX, camZ);
        if (ceil != null) camY = Math.min(camY, ceil - 0.18);
      }
      camY = Math.max(camY, sampleRenderedSurfaceY(camX, camZ) + 0.25);
      camera.position.set(camX, camY, camZ);
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

    // Throttled report of local position/yaw/mode to the app (orbit view needs it)
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
      onLocalPose?.(posePayload);
    }
    updateContactShadows();

    // Kicked-up dust and grains, lit by the current sun. No weather: wind, gusts and storms are gone.
    marsFx.update(dt, camera.position, { sunDir, sunUp: sunUp(sunState.elevationRad) });
    const tauFogScale = 0.55 + MARS_DUST_TAU * 0.85;
    if (scene.fog) {
      scene.fog.density = 0.00042 * tauFogScale;
      // Fog takes the horizon colour, dimmed through twilight to near-black at night.
      const tw = Math.max(0, Math.min(1, (sunState.elevationRad + 0.32) / 0.44));
      scene.fog.color.copy(HORIZON).multiplyScalar(0.025 + 0.975 * tw * tw * (3 - 2 * tw));
    }
    updateAtmosphericHazeUniforms(atmoUniforms, {
      sunElev: sunState.elevationRad,
      tau: MARS_DUST_TAU,
      fogDensity: scene.fog ? scene.fog.density : 0.00042,
      baseY: isGaleSite() ? 0.0 : Math.min(0.0, camera.position.y - 25.0),
      time: clockT,
    });

    // sun, moons and shadow box follow the walker (or freecam)
    const texel = (2 * shadowHalfM) / shadowMapPx;
    const focusX = freecamActive ? camera.position.x : px;
    const focusZ = freecamActive ? camera.position.z : pz;
    const groundY = sampleElevSceneY(focusX, focusZ);
    const snapX = Math.round(focusX / texel) * texel;
    const snapY = Math.round(groundY / texel) * texel;
    const snapZ = Math.round(focusZ / texel) * texel;
    sun.target.position.set(snapX, snapY, snapZ);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 400);
    sky.position.copy(camera.position);
    skyMoons.position.copy(camera.position);
    celestial.group.position.copy(camera.position);
    updateMoons(camera.position);
    footsteps.update(dt, phys.g || surfaceG);
    rockField.update(focusX, focusZ, sampleElevSceneY, gfx.sceneDetail, habitatStation?.isOnFootprint);
    historicRovers.update(dt, { sampleElevY: sampleRenderedSurfaceY, observerPos: camera.position, clockT });
    const detailLodR = gfx.level === "low" ? 14 : gfx.level === "medium" ? 18 : 26;
    if (roverMmsev?.nasaModelRoot) {
      const dxM = roverMmsev.group.position.x - camera.position.x;
      const dzM = roverMmsev.group.position.z - camera.position.z;
      roverMmsev.setDetailLod(activeDriveRover === roverMmsev || dxM * dxM + dzM * dzM <= detailLodR * detailLodR);
    }
    if (npcManager.npcGroup.visible) {
      npcManager.update(dt, { x: px, z: pz, y: player.y }, clockT, {
        activeNpcId: npcDialogueUi.getActiveNpc()?.id || null,
        terrainSampler: sampleElevSceneY,
        detailDistM: detailLodR,
        camera,
        lang: isTrLang() ? "tr" : "en",
      });
    }
    lensMat.uniforms.uDust.value = Math.min(1, lensMat.uniforms.uDust.value + step / 650);
    const sunUpNow = sunUp(sunState.elevationRad);
    sun.intensity = baseSunIntensity * (sunState.fluxWm2 / 590) * sunTransit * sunUpNow;
    sun.castShadow = gfx.shadowPx > 0 && sunUpNow > 0.01;
    // Shadows render every frame: a throttled shadow map left moving crew, rovers and the suit
    // with shadows that lagged behind them ("floating silhouettes").
    renderer.shadowMap.needsUpdate = sun.castShadow;
    // The sun moves ~0.25°/min: refresh the direction every 30 s, re-bake terrain shadows every ~10 min.
    if (now - sunStateStampMs > 30000) {
      refreshSun({ rebake: now - lastSunBakeMs > 600000 });
    }

    // the HUD text & rover reticle inspection only need ~10 updates a second (skipped during landing cinematic)
    if (!landing.active) {
      hudTimer += dt;
    }
    if (!landing.active && hudTimer > 0.1) {
      hudTimer = 0;
      const metW = metabolicPowerW({
        eta: phys.eta,
        gMs2: phys.g || surfaceG,
        speedMs: drivingRover ? 0 : groundSpeed,
        gradePercent: phys.gradePercent,
      });
      if (!perfEl.hidden) {
        const ri = renderer.info;
        const hwTel = getLiveHardwareTelemetry();
        const heapTxt = hwTel.jsHeapLimitMb > 0 ? `${hwTel.jsHeapUsedMb}/${hwTel.jsHeapLimitMb} MB` : "n/a";
        const ramTxt = hwTel.freeRamGb !== null
          ? `${(hwTel.ramGb - hwTel.freeRamGb).toFixed(1)}/${hwTel.ramGb} GB RAM`
          : `${hwTel.ramGb} GB RAM`;
        perfEl.textContent =
          `${Math.round(1000 / Math.max(1, frameAvg))} fps · ${frameAvg.toFixed(1)} ms · ${gfx.level} · scale ${renderScale.toFixed(2)}\n` +
          `GPU: ${hwTel.gpuName} · VRAM ~${hwTel.sceneVramMb} MB / ${hwTel.vramGb} GB${hwTel.vramShared ? " (shared)" : ""}\n` +
          `MEM: ${ramTxt} · JS heap ${heapTxt} · CPU ${hwTel.cores}T\n` +
          `draws ${perfDraws} · tris ${(perfTris / 1000).toFixed(0)}k · chunks ${chunkMeshes.size} · geo ${ri.memory.geometries} · tex ${ri.memory.textures}`;
      }
      const metEl = (metabolicEl ||= document.getElementById("hud-metabolic"));
      if (metEl) {
        if (!Number.isFinite(svfLastX) || Math.hypot(px - svfLastX, pz - svfLastZ) >= 0.75) {
          svfLastX = px;
          svfLastZ = pz;
          cachedSvf = skyViewFactor(sampleElevSceneY, px, pz);
        }
        metEl.textContent = `METABOLIC: ${metW.toFixed(0)} W · ${oxygenLitresPerMin(metW).toFixed(2)} L/min O₂ (Pandolf stand-in) · SVF ${cachedSvf.toFixed(2)} illustrative`;
      }
      updateCrewHudSummary();
      if (freeRoam) {
        updateHudReadouts(isGaleSite() ? alongM : offRouteWalkM, xToLon(px), zToLat(pz), phys.slopeDeg);
      } else {
        updateHudReadouts(alongM, sample.lon, sample.lat);
      }
      if (typeof window !== "undefined" && window.MartianAudio?.update) {
        let nearestRoverDistM = 40;
        if (drivingRover) {
          nearestRoverDistM = 0;
        } else {
          for (const drv of drivableRovers) {
            if (!drv?.group?.visible) continue;
            nearestRoverDistM = Math.min(
              nearestRoverDistM,
              Math.hypot(drv.group.position.x - px, drv.group.position.z - pz)
            );
          }
          for (const hEntry of historicRovers.getAllEntries()) {
            const hp = hEntry?.group?.position;
            if (!hp || !hEntry.group.visible) continue;
            nearestRoverDistM = Math.min(nearestRoverDistM, Math.hypot(hp.x - px, hp.z - pz));
          }
        }
        const roverSimState = drivingRover ? activeDriveRover?.sim?.state : null;
        window.MartianAudio.update({
          speedKmh: roverSimState ? Math.abs(roverSimState.vLong) * 3.6 : 0,
          walkSpeedMs: drivingRover ? 0 : groundSpeed,
          slopeDeg: freeRoam ? phys.slopeDeg : 0,
          isDriving: Boolean(drivingRover),
          isThirdPerson: Boolean(thirdPersonWalk || drivingRover || freecamActive),
          inHabitat: Boolean(isInsideHabitat(px, pz)),
          motorLoad: roverSimState ? Math.min(1, (roverSimState.motorRpm || 0) / 4000) : 0,
          nearestRoverDistM,
          viewMode: isHudActive() ? "hud" : "orbit",
        });
      }
      if (optZoom > 1) {
        const readout = (zoomReadoutEl ||= document.getElementById("hud-zoom-readout"));
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
      if (!uiBlocked) {
        const aimX = isPointerLocked() ? null : lastMouseClient.valid ? lastMouseClient.x : null;
        const aimY = isPointerLocked() ? null : lastMouseClient.valid ? lastMouseClient.y : null;
        const activeTargetNpc = pickTargetNpc(aimX, aimY);
        const hitScreen = activeTargetNpc ? null : pickInteractiveScreen(aimX, aimY);
        const hitSpec = activeTargetNpc || hitScreen ? null : pickHistoricRover(aimX, aimY);
        if (activeTargetNpc !== hoveredNpcEntry || hitScreen !== hoveredScreenTarget || hitSpec !== hoveredRoverSpec) {
          hoveredNpcEntry = activeTargetNpc;
          hoveredScreenTarget = hitScreen;
          hoveredRoverSpec = hitSpec;
          const anyHover = Boolean(activeTargetNpc || hitScreen || hitSpec);
          reticleEl?.classList.toggle("target-rover", anyHover);
          if (renderer?.domElement) {
            renderer.domElement.style.cursor = anyHover && !isPointerLocked() ? "pointer" : "";
          }
          if (roverTargetEl) {
            const tr = isTrLang();
            if (activeTargetNpc) {
              const s = activeTargetNpc.spec;
              const roleText = (tr ? s.role?.tr || s.role?.en : s.role?.en) || s.tagText || "";
              roverTargetEl.textContent = `${s.name.toUpperCase()}${roleText ? ` (${roleText})` : ""} · ${
                tr ? `KONUŞ [${kh("E", "interact")}] / TIKLA` : `TALK [${kh("E", "interact")}] / CLICK`
              }`;
              roverTargetEl.classList.add("visible");
            } else if (hitScreen) {
              if (hitScreen.kind === "taskScreen") {
                roverTargetEl.textContent = tr
                  ? "EVA TASKS · GÖREV & ROTA PLANLAYICI [E / TIKLA]"
                  : "EVA TASKS · ROVER MISSION ROUTER [E / CLICK]";
              } else if (hitScreen.kind === "terminal") {
                roverTargetEl.textContent = tr
                  ? "TRANSİT TERMİNALİ · SAHA & TASKS İÇİN TIKLA"
                  : "TRANSIT TERMINAL · CLICK FOR SITES & TASKS";
              } else if (hitScreen.kind === "wallScreen") {
                roverTargetEl.textContent = `${hitScreen.spec?.title || "SCREEN"} · ${
                  tr ? "EVA TASKS / TELEMETRİ [E / TIKLA]" : "EVA TASKS / TELEMETRY [E / CLICK]"
                }`;
              } else if (hitScreen.kind === "hardwareInfo") {
                roverTargetEl.textContent = `${hardwareSite?.hw?.name?.toUpperCase() || "INFO"} · ${
                  tr ? "BİLGİ İÇİN TIKLA" : "CLICK FOR INFO"
                }`;
              } else {
                roverTargetEl.textContent = tr ? "ÜSSE DÖN · TIKLA" : "RETURN TO HABITAT · CLICK";
              }
              roverTargetEl.classList.add("visible");
            } else if (hitSpec) {
              roverTargetEl.textContent = `${hitSpec.name.toUpperCase()} (${hitSpec.mission}) · ${
                tr ? `ETKİLEŞİM [${kh("E", "interact")}] / TIKLA` : `INTERACT [${kh("E", "interact")}] / CLICK`
              }`;
              roverTargetEl.classList.add("visible");
            } else {
              roverTargetEl.classList.remove("visible");
            }
          }
        }
      } else if (hoveredNpcEntry || hoveredScreenTarget || hoveredRoverSpec) {
        hoveredNpcEntry = null;
        hoveredScreenTarget = null;
        hoveredRoverSpec = null;
        reticleEl?.classList.remove("target-rover");
        roverTargetEl?.classList.remove("visible");
        if (renderer?.domElement) renderer.domElement.style.cursor = "";
      }
    }
    curvAnchor.value.set(camera.position.x, camera.position.z);
    if (landing.active) {
      followEndless(freePos);
      if (!isGaleSite()) updateCorridorChunks(freePos.x, freePos.z, dt);
    } else {
      const chunkFocus = drivingRover && activeDriveRover?.group ? activeDriveRover.group.position : camera.position;
      followEndless(chunkFocus);
      updateCorridorChunks(chunkFocus.x, chunkFocus.z, dt);
    }

    goldSlide += (goldVisor - goldSlide) * Math.min(1, dt * 6.0);
    if (Math.abs(goldVisor - goldSlide) < 0.002) goldSlide = goldVisor;

    camera.getWorldDirection(lookDir);
    if (drivingRover && activeDriveRover && roverHeadlightsActive()) {
      const autoBoost = sunState.elevationRad < 0.25 ? 1.45 : 1.0;
      evaLamp.intensity = 18.0 * autoBoost;
      const rp = activeDriveRover.group.position;
      const rYaw = activeDriveRover.group.rotation.y;
      activeBeamDir.set(-Math.sin(rYaw), -0.09, -Math.cos(rYaw)).normalize();
      evaLamp.position.set(rp.x + activeBeamDir.x * 2.2, rp.y + 1.25, rp.z + activeBeamDir.z * 2.2);
      evaLamp.target.position.copy(evaLamp.position).addScaledVector(activeBeamDir, 18);
      evaLamp.target.updateMatrixWorld();
    } else if (evaLampOn && !drivingRover) {
      const autoBoost = sunState.elevationRad < 0.25 ? 1.55 : 1.0;
      evaLamp.intensity = 28.0 * autoBoost;
      evaLamp.position.set(camera.position.x, camera.position.y + 0.14, camera.position.z);
      evaLamp.target.position.copy(camera.position).addScaledVector(lookDir, 12);
      evaLamp.target.updateMatrixWorld();
    } else {
      evaLamp.intensity = 0;
    }

    if (activeTask?.status === "active" && !landing.active) {
      const stepD = Math.hypot(px - activeTask.lastX, pz - activeTask.lastZ);
      if (stepD < 180) activeTask.travelledM += stepD;
      activeTask.lastX = px;
      activeTask.lastZ = pz;
      const curSlope = drivingRover ? computeLocalSlopeDeg(px, pz) : phys.slopeDeg;
      if (Number.isFinite(curSlope)) activeTask.peakSlopeDeg = Math.max(activeTask.peakSlopeDeg, curSlope);

      latestTaskProgress = computeTaskProgress({
        routePoints: activeTask.selectedRoute.points,
        curX: px,
        curZ: pz,
        targetX: activeTask.targetX,
        targetZ: activeTask.targetZ,
        arriveRadiusM: 13.5,
      });

      const chosenRover = activeTask.vehicleId === "nasa_concept" ? roverConcept : roverMmsev;
      taskGuide3d.update(dt, clockT, px, pz, chosenRover.group.position.x, chosenRover.group.position.z);
      if (isGaleSite() && chunkMeshes.size !== taskLastChunkRebuildCount) {
        taskLastChunkRebuildCount = chunkMeshes.size;
        taskGuide3d.rebuildHeights(sampleRenderedSurfaceY);
      }

      if (drivingRover && !activeTask.wrongVehicleWarned && activeDriveRover?.getActiveSpec?.()?.id !== activeTask.vehicleId) {
        activeTask.wrongVehicleWarned = true;
        const expected = getTaskVehicleProfile(activeTask.vehicleId).shortLabel;
        showWrapNotice(
          isTrLang()
            ? `NOT: SEÇİLİ GÖREV ARACI ${expected} — ROTALAR BU ARACA GÖRE HESAPLANDI`
            : `NOTE: TASK PLANNED FOR ${expected} — ROUTE SCORES REFLECT THAT VEHICLE`
        );
      }

      if (latestTaskProgress.targetArrived) {
        activeTask.status = "completed";
        const tgtR = getTaskTargetRover(activeTask.targetRoverId);
        const completionSummary = {
          targetRoverId: activeTask.targetRoverId,
          vehicleId: activeTask.vehicleId,
          selectedRoute: activeTask.selectedRoute,
          elapsedSec: Math.max(1, clockT - activeTask.startTimeSec),
          travelledM: activeTask.travelledM,
          peakSlopeDeg: activeTask.peakSlopeDeg,
        };
        taskGuide3d.clear();
        taskUi.updateMinimap(null, null, null, now);
        if (fleetBtnEl) fleetBtnEl.textContent = isGaleSite() ? `Rovers: ${tgtR.name} (7)` : `Site: ${tgtR.name}`;
        renderHudFleetPanel();
        showWrapNotice(
          isTrLang()
            ? `HEDEF ROVER BULUNDU: ${tgtR.name.toUpperCase()} · IŞINLANMA KİLİDİ AÇILDI`
            : `TARGET ROVER LOCATED: ${tgtR.name.toUpperCase()} · TELEPORTS UNLOCKED`
        );
        taskUi.showDebrief(completionSummary);
      } else {
        taskUi.updateMinimap(activeTask, latestTaskProgress, { x: px, z: pz, yawRad: yaw }, now);
      }
    } else {
      taskUi.updateMinimap(null, null, null, now);
    }

    const headingDeg = (((-yaw * 180) / Math.PI) % 360 + 360) % 360;
    const pitchDeg = (pitch * 180) / Math.PI;
    const stopCoord = nextPovStop?.geometry?.coordinates;
    const stopBearingDeg =
      isTaskLocked() && latestTaskProgress
        ? latestTaskProgress.bearingToNextDeg
        : Array.isArray(stopCoord) && stopCoord.length >= 2 && Number.isFinite(curLon) && Number.isFinite(curLat)
        ? marsBearingDeg([curLon, curLat], stopCoord)
        : NaN;
    const sunBearingDeg = (((Math.atan2(sunDir.x, -sunDir.z) * 180) / Math.PI) % 360 + 360) % 360;
    updateWaveguideOptics(headingDeg, pitchDeg, heightEnv.molaElevM(px, pz), stopBearingDeg, sunBearingDeg);

    if (!resumedFromHide) adaptResolution(now);
    lensMat.uniforms.uTime.value = clockT;
    lensMat.uniforms.uGold.value = goldVisor;
    lensMat.uniforms.uGoldSlide.value = goldSlide;
    lensMat.uniforms.uOptZoom.value = optZoom;
    lensMat.uniforms.uGlint.value = Math.max(0, lookDir.dot(sunDir)) * sunUpNow;
    lensMat.uniforms.uExposure.value = 1.0;
    const perfRenderT0 = perfOverlayEl ? performance.now() : 0;
    postPipeline.setVisor({ visorOn: lensMat.uniforms.uBezelScale.value > 0.001, glint: lensMat.uniforms.uGlint.value, sunDir });
    postPipeline.render(dt);
    const sceneCalls = perfOverlayEl ? renderer.info.render.calls : 0;
    const sceneTris = perfOverlayEl ? renderer.info.render.triangles : 0;
    perfDraws = renderer.info.render.calls;
    perfTris = renderer.info.render.triangles;
    if (perfOverlayEl) {
      const renderMs = performance.now() - perfRenderT0;
      const simMs = perfRenderT0 - perfT0;
      if (!resumedFromHide && perfLastStamp > 0) {
        const frameIntervalMs = Math.min(250, Math.max(0.1, now - perfLastStamp));
        perfSamples[perfCursor] = frameIntervalMs;
        perfCursor = (perfCursor + 1) % perfSamples.length;
        if (perfFilled < perfSamples.length) perfFilled++;
      }
      perfLastStamp = now;
      if (now - perfLastUiMs >= 300 && perfFilled > 0) {
        perfLastUiMs = now;
        let sum = 0;
        for (let i = 0; i < perfFilled; i++) {
          const v = perfSamples[i];
          perfScratch[i] = v;
          sum += v;
        }
        const sorted = perfScratch.subarray(0, perfFilled).sort();
        const avgMs = sum / perfFilled;
        const p95Ms = sorted[Math.min(perfFilled - 1, Math.floor(perfFilled * 0.95))];
        const fps = avgMs > 0 ? 1000 / avgMs : 0;
        const mem = performance.memory;
        const heapStr = mem ? `${(mem.usedJSHeapSize / 1048576).toFixed(1)}/${(mem.jsHeapSizeLimit / 1048576).toFixed(0)}MB` : "n/a";
        const mInfo = renderer.info.memory;
        const pCount = renderer.info.programs ? renderer.info.programs.length : 0;
        const hwTel = getLiveHardwareTelemetry();
        const ramStr = hwTel.freeRamGb !== null
          ? `${(hwTel.ramGb - hwTel.freeRamGb).toFixed(1)}/${hwTel.ramGb}GB`
          : `${hwTel.ramGb}GB`;
        perfOverlayEl.textContent =
          `FPS ${fps.toFixed(1)} | avg ${avgMs.toFixed(1)}ms p95 ${p95Ms.toFixed(1)}ms sim ${simMs.toFixed(1)}ms ren ${renderMs.toFixed(1)}ms | GPU: ${hwTel.gpuName}\n` +
          `VRAM ~${hwTel.sceneVramMb}MB/${hwTel.vramGb}GB${hwTel.vramShared ? "(sh)" : ""} | RAM ${ramStr} | heap ${heapStr} | CPU ${hwTel.cores}T | calls ${sceneCalls} tris ${Math.round(sceneTris / 1000)}k ch ${chunkMeshes.size} | geo ${mInfo.geometries} tex ${mInfo.textures} prog ${pCount} | rt ${rt.width}x${rt.height} aa=${gfx.aa} ao=${gfx.ao} sc=${renderScale.toFixed(2)} q=${gfx.level}`;
      }
    }
  }
  // Stream in the 1 m terrain where the EVA starts and precompile the lander before the first frame (veil still up).
  await setLoadStage("Streaming 1 m terrain", "1 m arazi yükleniyor");
  if (routeCoords.length > 1) await warmCorridorAt(lonToX(routeCoords[0][0]), latToZ(routeCoords[0][1]));
  else await warmCorridorAt(freePos.x, freePos.z);
  await setLoadStage("Loading suit and rover models", "Giysi ve araç modelleri yükleniyor");
  if (!(await waitForLoads(45000))) console.warn("some assets were still loading after 45 s; starting without them");
  // ---------- no mid-game shader recompiles ----------
  // three.js builds every lit shader for the exact number of lights in view. Showing or hiding a
  // group that holds a light (the station, a rover's headlights, the lander's engine glow) changed
  // that number and recompiled every material at once: the freezes at cut-scenes and site changes.
  // The lights now live in one always-visible rig; each follows an anchor left where it used to be
  // and is dimmed to 0 (not removed) while its owner is hidden.
  stabilizeLights(habitatStation.group);
  for (const r of drivableRovers) stabilizeLights(r.group);
  stabilizeLights(landing.lander);
  syncStableLights();
  // Pre-build only the lander's shaders so the landing cut-scene does not hitch. (A whole-scene
  // renderer.compile() here blocked weak or integrated GPUs for minutes before the loading screen
  // lifted: the "stuck on loading" other players saw. Light counts no longer change at run time, see
  // the light rig above, so nothing else needs pre-compiling.)
  try {
    const t0 = performance.now();
    landing.warmup?.(renderer, camera);
    console.info(`lander shaders compiled in ${Math.round(performance.now() - t0)} ms`);
  } catch (err) {
    console.warn("lander shader warm-up failed", err);
  }

  requestAnimationFrame(animate);
  loadingVeil?.classList.add("done");

  return {
    onResize: () => {
      onResize();
    },
    visitRoverSite,
    deployToHardwareSite,
    returnToHabitat,
    visitHabitatStation,
    getActiveSiteId: () => activeSiteId,
    isTaskActive: isTaskLocked,
    showTaskLockNotice,
    abortTask: abortTaskMission,
    syncAlongM: (s) => {
      if (isTaskLocked()) {
        showTaskLockNotice();
        return;
      }
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
    /** Snapshot of the driven vehicle's rigid-body state (for checking the physics). */
    roverDebug: () => {
      const st = activeDriveRover.sim.state;
      return {
        driving: drivingRover,
        pos: st.pos.toArray().map((v) => +v.toFixed(2)),
        vel: st.vel.toArray().map((v) => +v.toFixed(2)),
        ang: st.angVel.toArray().map((v) => +v.toFixed(2)),
        comps: activeDriveRover.sim.wheels.map((w) => +w.comp.toFixed(2)),
        contacts: activeDriveRover.sim.wheels.filter((w) => w.contact).length,
        airborne: st.airborne,
        group: activeDriveRover.group.position.toArray().map((v) => +v.toFixed(2)),
        id: activeDriveRover.getActiveSpec().id,
        ground: +sampleElevSceneY(activeDriveRover.group.position.x, activeDriveRover.group.position.z).toFixed(2),
        support: +activeDriveRover.sampleSupportGroundY(sampleElevSceneY).toFixed(2),
        walker: [+freePos.x.toFixed(2), +freePos.z.toFixed(2)],
        historic: historicRovers.getAllEntries().map((e) => [e.spec?.id, +Math.hypot(e.group.position.x - freePos.x, e.group.position.z - freePos.z).toFixed(1), e.group.visible]),
        npcDialog: document.querySelector(".npc-dialogue-backdrop.open") ? "open" : "closed",
      };
    },
    /** Visible meshes and triangles per top-level scene object: shows what the draw calls go to. */
    sceneBreakdown: () => {
      const rows = [];
      for (const top of scene.children) {
        let meshes = 0;
        let tris = 0;
        let casters = 0;
        let twoPass = 0;
        const walk = (o) => {
          if (!o.visible) return;
          if (o.isMesh || o.isPoints || o.isSprite || o.isLine) {
            meshes += Array.isArray(o.material) ? o.material.length : 1;
            const g = o.geometry;
            const n = g?.index ? g.index.count : g?.attributes?.position?.count || 0;
            tris += (n / 3) * (o.isInstancedMesh ? o.count : 1);
            if (o.castShadow) casters++;
            // three draws a transparent double-sided mesh twice (back faces, then front faces)
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const mt of mats) if (mt?.transparent && mt.side === THREE.DoubleSide && !mt.forceSinglePass) twoPass++;
          }
          for (const c of o.children) walk(c);
        };
        walk(top);
        if (meshes) rows.push({ name: top.name || top.type, meshes, casters, twoPass, tris: Math.round(tris) });
      }
      return rows.sort((p, q) => q.meshes - p.meshes);
    },
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
