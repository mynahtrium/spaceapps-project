/**
 * 3D helmet view of the Mount Sharp walk (`web/hud/hud3d.js`).
 *
 * The camera is the astronaut's eyes. Escape leaves this view for the mission UI.
 * Symbology is drawn on the inner visor. The suit is NASA's Advanced Crew Escape Suit
 * when that mesh loads, with a procedural gait, slope-matched feet, and synthesized footsteps.
 *
 * - Terrain: Backend's 8-bit RGB height-preview.png (value = R*256 + G) on the real 2 km tile,
 *   surrounded by mirrored copies so the ground never ends (copies are visual, not data).
 * - Astronaut: NASA 3D Resources spacesuit glTF, scaled to 1.80 m and rigged procedurally
 *   (astronaut-rig.js) with a distance-driven walk / run cycle. You see through a helmet camera;
 *   your own helmet is hidden, so looking down shows your legs and gloves. A second crew member
 *   walks ahead on the route (buddy EVA).
 * - Physics: Gale gravity, 180 kg suited inertia, boot traction, slope slip, ballistic jumps
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
import { createWindDust } from "./wind-dust.js";
import { gamepad } from "../shared/gamepad.js";
import { createFieldKits } from "./FieldKits.js";
import { lerpAngleRad } from "../shared/multiplayer.js";
import { createMartianPbrTextureSets } from "../map/MarsPbrTextures.js";
import { loadDevSettings, saveDevSettings, subscribeDevSettings } from "../shared/dev-settings.js";
import { MARS_GEODESY } from "../physics/MarsConstants.js";
import { ellipsoidMetersPerDeg } from "../physics/MarsGravityField.js";
import { metabolicPowerW, oxygenLitresPerMin, skyViewFactor } from "../physics/MetabolicPlssModel.js";
import { createMarsBody, stepPhysicsWorld } from "../physics/MarsPhysicsWorld.js";
import { downhillLeanRad, JUMP_SPEED_MS, torsoLeanRad } from "../physics/SuitBiomechanics.js";
import {
  ROVER_FLIGHT_G,
  computeSpawnBesideOffset,
  createExperimentalRover,
  getDrivableVehicleSpec,
  stepAdvancedRoverPhysics,
  stepRoverBallisticPhysics,
} from "./experimental-rover.js";
import { createRoverDynamics } from "./rover-dynamics.js";
import { attachSuspensionRig } from "./rover-rig.js";
import { createRoverDash } from "./rover-dash.js";
import { createMarsFxSystem } from "./mars-fx.js";
import { MARS_RADIUS_MEAN_M } from "../map/Geodesy.js";
import {
  MARS_HISTORIC_ROVERS,
  getHistoricRoverById,
  makeCustomSiteSpec,
  sampleProceduralSiteHeightM,
  scatterHistoricRoverCoords,
} from "../shared/mars-rovers.js";
import { createHistoricRoverManager } from "./historic-rovers.js";
import {
  RT_HEIGHT_GLSL,
  RT_LENS_PARS_GLSL,
  buildHeightfieldRtData,
  buildHeightfieldRtTexture,
  createRayTracerUniforms,
  patchObjectRayTracer,
} from "./ray-tracer.js";

const ASTRONAUT_HEIGHT_M = 1.8;
const EYE_HEIGHT_M = 1.64; // eye level inside the helmet of a 1.80 m astronaut
const EYE_FORWARD_M = 0.36; // at the visor, ahead of the suit's deep chest so the legs show when looking down
const WALK_SPEED_MS = 1.4; // placeholder walking pace (Earth hiking stand-in)
const RUN_SPEED_MS = 2.5; // a light suited run (Shift); clearly faster than walking, not a sprint
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
  const isTrLang = () => {
    try {
      return localStorage.getItem("mm-lang") === "tr";
    } catch {
      return false;
    }
  };

  const bounds = costMap?.bounds || {
    west_lon_deg: 137.372831,
    south_lat_deg: -4.816946,
    east_lon_deg: 137.406542,
    north_lat_deg: -4.783236,
  };
  const ncols = costMap?.grid?.ncols || 395;
  const nrows = costMap?.grid?.nrows || 395;
  const cellSizeM = costMap?.cell_size_m || 5.059;
  const worldW = ncols * cellSizeM;
  const worldH = nrows * cellSizeM;
  const [elevMin, elevMax] = costMap?.height_preview_elevation_range_m || [-3850.6, -3369.3];

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
  const windDust = createWindDust({ THREE, scene, groundY: (x, z) => sampleElevSceneY(x, z), sunDir });
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
  try {
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
  // At Gale (Curiosity), samples real HiRISE DTM; at other rover sites, uses deterministic site relief.
  function sampleElevSceneY(x, z) {
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

  const rtHeightInfo = buildHeightfieldRtTexture(THREE, sampleElevSceneY, worldW, worldH, 192);
  const rtUniforms = createRayTracerUniforms(THREE, worldW, worldH, sunDir, rtHeightInfo);
  function refreshRtHeightfield() {
    const packed = buildHeightfieldRtData(sampleElevSceneY, worldW, worldH, 192);
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

  function buildTerrainGeometry(seg) {
    const g = new THREE.PlaneGeometry(worldW, worldH, seg, seg);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, sampleElevSceneY(pos.getX(i), pos.getZ(i)));
    g.computeVertexNormals();
    return addSkirt(g, seg, 40);
  }

  // Tiles of different vertex density meet with small height mismatches along their edges, which
  // open thin cracks where the sky shows through. A skirt (a strip hanging 40 m down from every
  // edge, textured like the edge) fills those cracks without changing the visible surface.
  function addSkirt(g, seg, depth) {
    const n = seg + 1;
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    const nor = g.attributes.normal;
    const ring = [];
    for (let i = 0; i < n; i++) ring.push(i); // north edge
    for (let j = 1; j < n; j++) ring.push(j * n + seg); // east edge
    for (let i = seg - 1; i >= 0; i--) ring.push(seg * n + i); // south edge
    for (let j = seg - 1; j >= 1; j--) ring.push(j * n); // west edge
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

  const fullSeg = elevGrid ? Math.min(imgW - 1, 394) : 1;
  let terrainGeom = buildTerrainGeometry(fullSeg);
  // mirrored copies are seen from far away through fog: a quarter of the vertex density is plenty
  let copyGeom = buildTerrainGeometry(Math.max(1, Math.floor(fullSeg / 4)));

  // ---------- far terrain shadows (baked) ----------
  // The real-time shadow map only covers the ground near the walker. For the rest, march from every
  // terrain cell towards the sun through the height grid and store how much of the sun is visible.
  // The mirrored terrain repeats every 2 tiles in world space, so one mask over that period, sampled
  // with world x/z and repeat wrapping, is correct for the real tile and every mirrored copy.
  // The old full-resolution bake froze the page for ~5 s at start-up and again at every re-bake
  // (every 10 min, and when switching sun mode): 790 x 790 cells, each marching up to 700 m.
  // Now: one texel per 2 x 2 DTM cells (the shadow edge is soft anyway), rays of 2-cell steps that
  // stop as soon as they are above the highest point of the terrain, and the work is cut into
  // ~6 ms slices between frames. The finished mask replaces the old one in one swap (no flicker).
  const SUN_MASK_SLICE_MS = 6;
  let sunBakeJob = null;
  function startSunMaskBake(onDone) {
    const n = elevGrid ? imgW : 0;
    if (!n) return null;
    const N = 2 * n; // DTM cells across one mirror period
    const M = Math.ceil(N / 2); // mask texels across the period
    const out = new Uint8Array(M * M * 4);
    const finish = () => {
      const tex = new THREE.DataTexture(out, M, M, THREE.RGBAFormat);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      onDone(tex);
    };
    if (sunDir.y <= 0.0) {
      // Sun below the horizon: nothing is directly lit (the sun light is also switched off).
      for (let i = 0; i < out.length; i += 4) out[i + 3] = 255;
      finish();
      return null;
    }
    if (sunDir.y > 0.995) {
      out.fill(255); // sun at the zenith: no terrain shadows
      finish();
      return null;
    }
    const cell = worldW / n;
    const H = new Float32Array(N * N);
    let hMax = -Infinity;
    for (let r = 0; r < N; r++) {
      const sr = r < n ? r : 2 * n - 1 - r;
      for (let c = 0; c < N; c++) {
        const sc = c < n ? c : 2 * n - 1 - c;
        const h = elevGrid[sr * imgW + sc];
        H[r * N + c] = h;
        if (h > hMax) hMax = h;
      }
    }
    const horiz = Math.max(1e-4, Math.hypot(sunDir.x, sunDir.z));
    const tanSun = sunDir.y / horiz;
    const STEP = 2; // DTM cells per ray step
    const dx = (sunDir.x / horiz) * STEP; // towards the sun (x = columns, east)
    const dz = (sunDir.z / horiz) * STEP; // z = rows, south
    const stepM = STEP * cell;
    const maxSteps = Math.ceil(700 / stepM);
    const SOFT = 0.012; // about the sun disc plus dust: soft edge in tan(angle)
    const wrapN = (v) => ((v % N) + N) % N;
    let row = 0;
    const job = { cancelled: false };
    function bakeRow(mr) {
      const r = Math.min(N - 1, mr * 2);
      for (let mc = 0; mc < M; mc++) {
        const c = Math.min(N - 1, mc * 2);
        const h0 = H[r * N + c];
        let worst = -1e9;
        for (let k = 1; k <= maxSteps; k++) {
          if (h0 + (tanSun + SOFT) * k * stepM > hMax) break; // above every hill from here on
          const fx = c + dx * k;
          const fz = r + dz * k;
          const x0 = Math.floor(fx);
          const z0 = Math.floor(fz);
          const tx = fx - x0;
          const tz = fz - z0;
          const a = wrapN(x0);
          const b = wrapN(x0 + 1);
          const ra = wrapN(z0) * N;
          const rb = wrapN(z0 + 1) * N;
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
        const o = (mr * M + mc) * 4;
        out[o] = out[o + 1] = out[o + 2] = Math.round(lit * 255);
        out[o + 3] = 255;
      }
    }
    const slice = () => {
      if (job.cancelled) return;
      const t0 = performance.now();
      while (row < M && performance.now() - t0 < SUN_MASK_SLICE_MS) bakeRow(row++);
      if (row >= M) finish();
      else setTimeout(slice, 0);
    };
    setTimeout(slice, 0);
    return job;
  }
  function applySunMask(tex) {
    const prev = sunMask;
    sunMask = tex;
    if (terrainShaderRef?.uniforms?.sunMask) terrainShaderRef.uniforms.sunMask.value = tex;
    prev?.dispose?.();
  }
  /** Re-bake in the background for the current sun direction (cancels a bake still running). */
  function rebakeSunMask() {
    if (sunBakeJob) sunBakeJob.cancelled = true;
    sunBakeJob = startSunMaskBake((tex) => {
      sunBakeJob = null;
      applySunMask(tex);
    });
  }
  // until the first bake finishes the whole ground counts as lit
  let sunMask = null;
  if (elevGrid) {
    const M0 = Math.ceil((2 * imgW) / 2);
    const lit = new Uint8Array(M0 * M0 * 4).fill(255);
    sunMask = new THREE.DataTexture(lit, M0, M0, THREE.RGBAFormat);
    sunMask.wrapS = sunMask.wrapT = THREE.RepeatWrapping;
    sunMask.magFilter = sunMask.minFilter = THREE.LinearFilter;
    sunMask.needsUpdate = true;
    setTimeout(rebakeSunMask, 400); // after the first frames are on screen
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
  const reliefUrl = assets.reliefTextureUrl || assets.heightPreviewUrl.replace(/height-preview\.png$/, "texture-relief.jpg");
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
  pbr.dustNormalTex.repeat.set(960, 960);
  let pbrHigh = null;
  let terrainShaderRef = null;
  let suitWeaveTex = null;

  function ensureHighResPbr() {
    if (pbrHigh) return pbrHigh;
    pbrHigh = createMartianPbrTextureSets(THREE, 1024);
    for (const t of [pbrHigh.dustAlbedoTex, pbrHigh.rockAlbedoTex, pbrHigh.dustNormalTex, pbrHigh.rockNormalTex]) {
      t.anisotropy = maxAniso;
    }
    pbrHigh.dustNormalTex.repeat.set(960, 960);
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
  terrainMat.onBeforeCompile = (shader) => {
    terrainShaderRef = shader;
    shader.uniforms.detailMap = { value: detailTex };
    shader.uniforms.uCurvAnchor = curvAnchor;
    shader.uniforms.uCurvInv2N = curvInv2N;
    shader.uniforms.uCurvInv2M = curvInv2M;
    shader.uniforms.pbrDust = { value: devCfg.realisticTextures ? ensureHighResPbr().dustAlbedoTex : pbr.dustAlbedoTex };
    shader.uniforms.pbrRock = { value: devCfg.realisticTextures ? ensureHighResPbr().rockAlbedoTex : pbr.rockAlbedoTex };
    shader.uniforms.sunMask = { value: sunMask };
    shader.uniforms.sunMaskOn = { value: sunMask ? 1 : 0 };
    shader.uniforms.sunMaskPeriod = { value: new THREE.Vector2(2 * worldW, 2 * worldH) };
    shader.uniforms.sunMaskOrigin = { value: new THREE.Vector2(-worldW / 2, -worldH / 2) };
    shader.uniforms.uSuperDetail = superDetailUniform;
    shader.uniforms.uRealisticTex = realisticTexUniform;
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
        `#include <common>\nvarying vec2 vMmWorldXZ;\nvarying vec3 vRtWorldPos;\nvarying float vMmSlope;\nvarying float vMmElev;\nuniform sampler2D sunMask;\nuniform float sunMaskOn;\nuniform vec2 sunMaskPeriod;\nuniform vec2 sunMaskOrigin;\n${RT_HEIGHT_GLSL}`
      )
      .replace(
        "#include <lights_fragment_begin>",
        "float mmMaskVis = sunMaskOn > 0.5 ? texture2D(sunMask, (vMmWorldXZ - sunMaskOrigin) / sunMaskPeriod).r : 1.0;\nfloat mmSunVis = mmMaskVis;\nif (uRtEnabled > 0.5) {\n  float rtShJ = rtIgn(gl_FragCoord.xy + fract(uRtTime) * 53.0);\n  float rtSh = rtTraceShadow(vRtWorldPos + vec3(0.0, 0.14, 0.0), uRtSunDir, 260.0, rtShJ);\n  mmSunVis = mix(rtSh, min(rtSh, mmMaskVis), 0.35);\n}\n" +
          sunChunk
      )
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
        if (uRtEnabled > 0.5) {
          float rtJGi = rtIgn(gl_FragCoord.xy + fract(uRtTime * 1.37) * 79.0);
          vec3 rtWN = normalize((vec4(geometryNormal, 0.0) * viewMatrix).xyz);
          vec3 rtWV = normalize((vec4(geometryViewDir, 0.0) * viewMatrix).xyz);
          float rtSkyVis;
          vec3 rtBounce;
          rtTraceGI(vRtWorldPos + rtWN * 0.08, rtWN, uRtSunDir, rtJGi, rtSkyVis, rtBounce);
          reflectedLight.indirectDiffuse *= rtSkyVis;
          reflectedLight.indirectDiffuse += diffuseColor.rgb * rtBounce;
          float rtFresnel = pow(1.0 - clamp(dot(rtWN, rtWV), 0.0, 1.0), 5.0);
          if (rtFresnel > 0.025) {
            vec3 rtReflDir = reflect(-rtWV, rtWN);
            vec3 rtSkySpec = rtMarsSky(rtReflDir, uRtSunDir);
            reflectedLight.indirectSpecular += rtSkySpec * rtFresnel * 0.18 * rtSkyVis;
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
          float dA = texture2D(detailMap, vMapUv * 173.0).r;
          float dB = texture2D(detailMap, vMapUv * 911.0).r;
          float mmSlopeMix = smoothstep(0.03, 0.30, vMmSlope);
          vec2 mmElevWarp = (vec2(dA - 0.5, dB - 0.5) * 0.0020 + vec2(sin(vMmElev * 0.42), cos(vMmElev * 0.42)) * 0.0010) * mmSlopeMix;
          vec3 mmAltTex = texture2D(map, vMapUv + mmElevWarp).rgb;
          diffuseColor.rgb = mix(diffuseColor.rgb, mmAltTex, 0.45 * mmSlopeMix);
          float detailGain = mix(0.46, 0.62, max(uSuperDetail, uRealisticTex * 0.90));
          diffuseColor.rgb *= (1.0 - detailGain * 0.65) + detailGain * dA * 0.6 + detailGain * dB * 0.4;
          // Close-range ground detail: ripples / pebbles on dust, slabs + veins on rock patches + fine sub-meter grit.
          vec3 mmDust = texture2D(pbrDust, vMapUv * mix(720.0, 1080.0, max(uSuperDetail, uRealisticTex))).rgb;
          vec3 mmRock = texture2D(pbrRock, vMapUv * mix(320.0, 520.0, max(uSuperDetail, uRealisticTex)) + 0.37).rgb;
          vec3 mmMicro = texture2D(pbrDust, vMapUv * mix(2200.0, 3200.0, max(uSuperDetail, uRealisticTex)) + 0.19).rgb;
          float mmRockMask = clamp(max(smoothstep(0.48, 0.66, texture2D(detailMap, vMapUv * 41.0 + 0.11).r), mmSlopeMix * 0.62), 0.0, 1.0);
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
  };

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

  const rover = createExperimentalRover(THREE);
  rover.group.visible = false;
  scene.add(rover.group);
  // rigid-body chassis + six spring-damper struts (rover-dynamics.js), visible running gear
  // (rover-rig.js) and the digital instrument cluster shown while you drive (rover-dash.js)
  const roverSim = createRoverDynamics(THREE);
  const roverRig = attachSuspensionRig(THREE, rover, roverSim);
  const roverDash = createRoverDash(document.getElementById("visor-overlay") || document.querySelector(".visor-overlay") || hudView);
  patchObjectRayTracer(THREE, rover.group, rtUniforms, { reflectScale: 1.18 });
  rover.attachRealModel(sharedGltfLoader).then((ok) => {
    if (ok) patchObjectRayTracer(THREE, rover.group, rtUniforms, { reflectScale: 1.18 });
  });

  const historicRovers = createHistoricRoverManager(THREE, sharedGltfLoader, scene, {
    onModelLoaded: (grp) => patchObjectRayTracer(THREE, grp, rtUniforms, { reflectScale: 1.12 }),
  });
  function reScatterHistoricRovers(originX = 0, originZ = 0) {
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
    return placements;
  }
  reScatterHistoricRovers(0, 0);

  const marsFx = createMarsFxSystem(scene, sampleElevSceneY);

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
  let pitch = -0.12;
  let autoYaw = routeCoords.length > 1 ? routeHeading(0) : 0;
  const freePos = new THREE.Vector3(0, 0, 0);
  // start at the beginning of the route, facing along it
  if (routeCoords.length > 1) {
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
    roverDynState.yaw = rover?.group?.rotation?.y || 0;
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
    Boolean(document.querySelector(".modal-backdrop.open, #crew-drawer.open, #esc-menu.open"));

  const raycaster = new THREE.Raycaster();
  const rayNdc = new THREE.Vector2();
  const lastMouseClient = { x: 0, y: 0, valid: false };
  let hoveredRoverSpec = null;

  function pickHistoricRover(clientX = null, clientY = null) {
    const groups = historicRovers.getInteractiveGroups();
    if (!groups || groups.length === 0) return null;
    if (isPointerLocked() || clientX == null || clientY == null) {
      rayNdc.set(0, 0);
    } else {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      rayNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      rayNdc.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    }
    raycaster.setFromCamera(rayNdc, camera);
    const hits = raycaster.intersectObjects(groups, true);
    if (hits.length > 0 && hits[0].distance <= 115) {
      let obj = hits[0].object;
      while (obj && !obj.userData?.historicRoverId) obj = obj.parent;
      const rId = obj?.userData?.historicRoverId;
      return rId ? getHistoricRoverById(rId) : null;
    }
    return null;
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
      const directHit = pickHistoricRover(isPointerLocked() ? null : e.clientX, isPointerLocked() ? null : e.clientY);
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
    const b = document.getElementById("hud-tex");
    if (b) b.textContent = `Tex: ${TEX[texMode].label}`;
    return TEX[texMode].label;
  }
  btnTex?.addEventListener("click", () => setTexMode((texMode + 1) % TEX.length));

  // Wrap boundary helper: keeps coordinates inside the real 2x2 km tile by wrapping opposite edges
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
    if (rover?.group) {
      rover.group.position.x += dx;
      rover.group.position.z += dz;
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

  // A new route from the planner (Begin EVA): stand at its start, facing along it.
  onSetRoute((detail) => {
    const newRoute = detail?.route;
    const nextAlong = Number(detail?.alongM ?? detail?.along_m ?? 0) || 0;
    rebuildRouteRibbon(newRoute);
    alongM = nextAlong;
    autoYaw = 0;
    if (routeCoords.length > 1) {
      const p = routePoint(alongM);
      userYaw = routeHeading(alongM);
      partnerPos.set(p.x, 0, p.z);
      snapPhys(p.x, p.z);
      drivingRover = false;
      resetRoverMotionState();
      chaseCamInit = false;
      syncDrivingCameraVisualState(false);
      if (self?.group) self.group.visible = suitRig != null;
      if (devCfg.experimentalRover && rover) {
        rover.group.visible = true;
        rover.spawnBeside(p.x, p.z, userYaw, sampleElevSceneY);
        roverDynState.yaw = rover.group.rotation.y;
        nearRoverPrompted = false;
      }
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
    fleetPanelEl.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
      <span style="font-size:9.5px;letter-spacing:0.15em;color:var(--faint);text-transform:uppercase;">${
        tr ? "MARS ROVER FİLOSU (5 RASTGELE KONUM)" : "MARS ROVER FLEET (5 SCATTERED ON MAP)"
      }</span>
      <button id="hud-fleet-rescatter" class="btn" type="button" style="padding:2px 7px;font-size:9px;">${
        tr ? "Karıştır" : "Rescatter"
      }</button>
    </div>`;
    fleetPanelEl.querySelector("#hud-fleet-rescatter")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      reScatterHistoricRovers(freePos.x, freePos.z);
      renderHudFleetPanel();
      showWrapNotice(
        tr ? "5 NASA ROVER RASTGELE KONUMLARA YERLEŞTİRİLDİ" : "ALL 5 NASA ROVERS RESCATTERED ACROSS TERRAIN"
      );
    });
    for (const r of MARS_HISTORIC_ROVERS) {
      const entry = historicRovers.getEntry(r.id);
      const distStr = entry
        ? `${Math.round(Math.hypot(entry.group.position.x - freePos.x, entry.group.position.z - freePos.z))} m`
        : "—";
      const row = document.createElement("div");
      row.className = `hud-fleet-row ${r.id === activeSiteId ? "current" : ""}`;
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:7px;min-width:0;">
          <span class="fleet-dot" style="background:${r.color};"></span>
          <div style="min-width:0;">
            <div style="font-size:11px;color:#fff;letter-spacing:0.08em;">${r.name} <span style="color:var(--faint);font-size:9.5px;">· ${distStr}</span></div>
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
    }
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
      if (isGaleSite() && elevGrid) rebakeSunMask();
      lastSunBakeMs = performance.now();
    }
    if (terrainShaderRef?.uniforms?.sunMaskOn) {
      terrainShaderRef.uniforms.sunMaskOn.value = isGaleSite() && sunMask ? 1 : 0;
    }
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
    activeSiteRover = spec;
    activeSiteId = spec.id;
    historicRovers.setFocusId(spec.isCustomSite ? spec.nearRoverId : spec.id);
    const gale = isGaleSite();
    galeStopsGroup.visible = gale;
    fieldKits.visible = Boolean(devCfg.superGraphics) && gale;
    galeVista.visible = Boolean(devCfg.superGraphics) && gale;
    const nextMain = buildTerrainGeometry(fullSeg);
    const nextCopy = buildTerrainGeometry(Math.max(1, Math.floor(fullSeg / 4)));
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
    // The five NASA rovers stand near you at their own sites, at Gale, and near custom landings
    // within 150 km of a rover site; far from any of them the area is empty.
    const showRovers = !spec.isCustomSite || Boolean(spec.nearRoverId);
    if (showRovers) reScatterHistoricRovers(0, 0);
    else historicRovers.clearAll();
    if (fleetBtnEl) fleetBtnEl.textContent = showRovers ? `Rovers: ${spec.name} (5)` : "Rovers (5)";

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
      const standX = wrapSceneCoord(rx - Math.sin(rYaw) * standDist * 0.55 - 1.6, worldW * 2).val;
      const standZ = wrapSceneCoord(rz - Math.cos(rYaw) * standDist, worldH * 2).val;
      teleportToLocal(standX, standZ, { keepYaw: true });
      autoYaw = 0;
      userYaw = Math.atan2(-(rx - standX), -(rz - standZ));
      pitch = -0.09;

      if (devCfg.experimentalRover && rover.group.visible) {
        rover.spawnBeside(standX, standZ, userYaw + Math.PI * 0.5, sampleElevSceneY);
        roverDynState.yaw = rover.group.rotation.y;
      }
    }

    if (fleetBtnEl) fleetBtnEl.textContent = `Rovers: ${spec.name} (5)`;
    renderHudFleetPanel();
    const tr = isTrLang();
    showWrapNotice(
      tr
        ? `${spec.siteShortName} · ${spec.name.toUpperCase()} (${spec.mission}) — BİLGİ İÇİN TIKLA`
        : `${spec.siteShortName} · ${spec.name.toUpperCase()} (${spec.mission}) — CLICK ROVER FOR INFO`
    );
  }

  onVisitRoverSite((detail) => {
    if (detail?.roverId) visitRoverSite(detail.roverId, { approachRover: true, switchTerrain: true });
  });
  if (fleetBtnEl) fleetBtnEl.textContent = `Rovers (5)`;
  renderHudFleetPanel();

  let goldVisor = 0;
  let optZoom = 1;
  let arrival = null; // { t0, reduced } while the orbit arrival drop plays
  let nextPovStop = null;

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
  syncOpticsOverlayUi();

  window.addEventListener("keydown", (e) => {
    if (!hudView.classList.contains("active")) return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
    const modalOpen = document.getElementById("modal-backdrop")?.classList.contains("open");
    const crewOpen = document.getElementById("crew-drawer")?.classList.contains("open");
    const escMenuOpen = document.getElementById("esc-menu")?.classList.contains("open");
    const menuOpen = !document.getElementById("start-screen")?.classList.contains("hidden");
    if (modalOpen || crewOpen || escMenuOpen || menuOpen) return;

    const k = e.key.toLowerCase();
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
      const nextCfg = saveDevSettings({ rayTracing: !devCfg.rayTracing });
      applyDevSettings(nextCfg);
      showWrapNotice(
        isTrLang()
          ? `RAY TRACING: ${nextCfg.rayTracing ? "AÇIK (GPU YOĞUN)" : "KAPALI"}`
          : `RAY TRACING: ${nextCfg.rayTracing ? "ON (HEAVY GPU)" : "OFF"}`
      );
      return;
    }

    if (k === "e" && !e.repeat) {
      const tr = isTrLang();
      if (drivingRover && devCfg.experimentalRover && rover.group.visible) {
        drivingRover = false;
        resetRoverMotionState();
        chaseCamInit = false;
        pitch = prevFirstPersonPitch;
        const exitPt = computeSpawnBesideOffset(
          rover.group.position.x,
          rover.group.position.z,
          rover.group.rotation.y,
          -2.75,
          0.0
        );
        let wx = wrapSceneCoord(exitPt.x, worldW * 2).val;
        let wz = wrapSceneCoord(exitPt.z, worldH * 2).val;
        const wy = sampleElevSceneY(wx, wz);
        const outCol = rover.resolveCollision(wx, wz, PARTNER_COLLISION_R + 0.08, wy);
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

      const targetRover =
        hoveredRoverSpec ||
        pickHistoricRover(
          isPointerLocked() ? null : lastMouseClient.valid ? lastMouseClient.x : null,
          isPointerLocked() ? null : lastMouseClient.valid ? lastMouseClient.y : null
        );
      if (targetRover) {
        openRoverInfoSafe(targetRover, { toggleKey: "e" });
        return;
      }

      if (devCfg.experimentalRover && rover.group.visible) {
        const dist = Math.hypot(freePos.x - rover.group.position.x, freePos.z - rover.group.position.z);
        if (dist <= 5.4) {
          drivingRover = true;
          resetRoverMotionState();
          roverSim.reset(rover.group.position.x, rover.group.position.z, rover.group.rotation.y, sampleElevSceneY);
          prevFirstPersonPitch = pitch;
          pitch = -0.25;
          autoYaw = 0;
          userYaw = rover.group.rotation.y;
          roverDynState.yaw = rover.group.rotation.y;
          chaseCamInit = false;
          syncDrivingCameraVisualState(true);
          if (self?.group) self.group.visible = false;
          showWrapNotice(
            tr
              ? "3. ŞAHIS SÜRÜŞ · W/S GAZ · A/D DİREKSİYON · SPACE DRİFT · E İN"
              : "3RD-PERSON DRIVE · W/S DRIVE · A/D STEER · SPACE DRIFT · E EXIT"
          );
          return;
        }
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
  const perfStats = { fps: 0, frameMs: 0, cpuMs: 0, sceneMs: 0, updMs: 0, calls: 0, tris: 0, geoms: 0, tex: 0, refreshMs: 16.7 };

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
    const pr = renderer.getPixelRatio() * renderScale;
    rt.setSize(Math.max(1, Math.floor(w * pr)), Math.max(1, Math.floor(h * pr)));
    lensMat.uniforms.uResolution.value.set(w * pr, h * pr);
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
    const wantRt = Boolean(cfg.rayTracing);
    const q = cfg.quality || "performance";
    // performance: 1 pixel per CSS pixel, no MSAA, 1024 px shadow map, lighter dust (aims at the
    // monitor's refresh rate); balanced: MSAA 2 and 2048 px shadows; quality: 1.25x resolution
    const targetPr = Math.min(window.devicePixelRatio || 1, wantSuper ? 2.0 : q === "quality" ? 1.25 : 1.0);
    windDust.setDetail(q === "quality" ? 1 : q === "balanced" ? 0.7 : 0.45);
    renderer.setPixelRatio(targetPr);
    renderScale = wantSuper ? 1.25 : 1.0;

    // WebGL2 MSAA render targets cannot attach a DepthTexture, so when Ray Tracing is active
    // we switch to samples: 0 + DepthTexture (paired with FXAA + SSR/RTAO in LENS_FRAG).
    const wantSamples = wantRt ? 0 : wantSuper ? 4 : q === "performance" ? 0 : 2;
    if (rtSamples !== wantSamples || rtHasDepth !== wantRt) {
      rtSamples = wantSamples;
      rtHasDepth = wantRt;
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
    rtUniforms.uRtEnabled.value = wantRt ? 1 : 0;

    const wantShadowPx = wantSuper ? 4096 : q === "performance" ? 1024 : SHADOW_MAP_PX;
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
    if (terrainShaderRef?.uniforms) {
      terrainShaderRef.uniforms.pbrDust.value = activePbr.dustAlbedoTex;
      terrainShaderRef.uniforms.pbrRock.value = activePbr.rockAlbedoTex;
    }
    realisticTexUniform.value = wantRealTex ? 1.0 : 0.0;
    const baseNorm = wantSuper ? 0.95 : 0.55;
    const normScale = wantRealTex ? baseNorm + 0.45 : baseNorm;
    terrainMat.normalScale.set(normScale, normScale);
    terrainMat.roughness = wantRealTex ? 0.85 : 0.96;
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

    const vSpec = getDrivableVehicleSpec();
    if (drvVehEl) drvVehEl.textContent = vSpec.shortLabel;

    const wantRover = Boolean(cfg.experimentalRover);
    rover.group.visible = wantRover;
    if (wantRover && !roverWasOn) {
      resetRoverMotionState();
      rover.spawnBeside(freePos.x, freePos.z, autoYaw + userYaw, sampleElevSceneY);
      roverDynState.yaw = rover.group.rotation.y;
      nearRoverPrompted = false;
      if (hudView.classList.contains("active")) {
        showWrapNotice(
          isTrLang()
            ? `${vSpec.nameTr.toUpperCase()} YANINDA OLUŞTU (BİN: E)`
            : `${vSpec.nameEn.toUpperCase()} SPAWNED BESIDE YOU (E TO BOARD)`
        );
      }
    } else if (!wantRover && drivingRover) {
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
  // The target is the monitor's refresh rate, found from the shortest frame interval seen (about 8.3 ms
  // on a 120 Hz screen, 16.7 ms on 60 Hz): if frames take clearly longer than that the render
  // resolution drops in 5 % steps (floor 50 %), and it comes back when there is headroom. The old
  // rule only reacted above 24 ms, i.e. it accepted anything under ~41 fps.
  let refreshMs = 16.7;
  let refreshWindowStart = 0;
  const refreshSamples = [];
  const COMMON_HZ = [240, 165, 144, 120, 100, 90, 75, 60, 50, 30];
  function adaptResolution(frameMs, now) {
    // display refresh estimate: the 25th percentile of the frame intervals over rolling 4 s windows
    // (a stutter followed by a catch-up frame must not look like a faster screen), snapped to a
    // common refresh rate when it is within 7 %
    if (frameMs > 2 && frameMs < 80 && refreshSamples.length < 2000) refreshSamples.push(frameMs);
    if (now - refreshWindowStart > 4000) {
      if (refreshSamples.length > 40) {
        refreshSamples.sort((x, y) => x - y);
        const q = refreshSamples[Math.floor(refreshSamples.length * 0.25)];
        const hz = 1000 / q;
        const near = COMMON_HZ.find((c) => Math.abs(hz - c) / c < 0.07);
        refreshMs = Math.max(4.1, Math.min(34, near ? 1000 / near : q));
      }
      refreshSamples.length = 0;
      refreshWindowStart = now;
    }
    perfStats.refreshMs = refreshMs;
    if (frameMs > 70 || document.hidden) return; // a load stall or a background tab says nothing about the GPU
    frameAvg += (frameMs - frameAvg) * 0.08;
    if (devCfg.superGraphics) return;
    if (now - lastScaleChange < 700) return;
    let next = renderScale;
    if (frameAvg > refreshMs * 1.3 && renderScale > 0.5) next = Math.max(0.5, renderScale - 0.05);
    else if (frameAvg < refreshMs * 1.12 && renderScale < 1) next = Math.min(1, renderScale + 0.025);
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

  // F3: small readout of frame rate, CPU time, draw calls and triangles (to see what costs what)
  let perfEl = null;
  let perfOn = false;
  window.addEventListener("keydown", (e) => {
    if (e.key !== "F3") return;
    e.preventDefault();
    perfOn = !perfOn;
    if (perfOn && !perfEl) {
      perfEl = document.createElement("div");
      perfEl.id = "perf-hud";
      perfEl.className = "perf-hud";
      document.body.appendChild(perfEl);
    }
    if (perfEl) perfEl.style.display = perfOn ? "block" : "none";
  });
  let perfLastDraw = 0;

  const lookDir = new THREE.Vector3();
  function animate(now) {
    requestAnimationFrame(animate);
    const cpuStart = performance.now();
    const dt = Math.min(0.1, (now - prevT) / 1000);
    prevT = now;
    clockT += dt;
    if (!hudView.classList.contains("active")) return; // do not render while hidden

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

    if (freeRoam && drivingRover && devCfg.experimentalRover && rover.group.visible) {
      const rYaw0 = rover.group.rotation.y;
      const fx0 = -Math.sin(rYaw0);
      const fz0 = -Math.cos(rYaw0);
      const rx0 = Math.cos(rYaw0);
      const rz0 = -Math.sin(rYaw0);
      let steerJerk = 0;

      let dyn = null;
      {
        // inputs: keyboard, or controller (RT / LT or left stick for the pedals, left stick to steer)
        const padOk = !padBlocked();
        const st = padOk ? gamepad.move() : { x: 0, y: 0 };
        const rt = padOk ? gamepad.buttons[7] || 0 : 0;
        const lt = padOk ? gamepad.buttons[6] || 0 : 0;
        const keyThrottle =
          (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
        const keySteer =
          (keys.has("a") || keys.has("arrowleft") ? 1 : 0) - (keys.has("d") || keys.has("arrowright") ? 1 : 0);
        const mapBlocked = isMapOpen();
        const throttle = mapBlocked ? 0 : keyThrottle || (rt - lt) || (Math.abs(st.y) > 0.2 ? st.y : 0);
        const steerIn = mapBlocked ? 0 : keySteer || -st.x;
        const handbrake = !mapBlocked && (keys.has(" ") || (padOk && gamepad.isDown("jump")));
        const boost = keys.has("shift") || (padOk && gamepad.isDown("pin"));
        prevRoverSteer = roverSteer;
        roverSteer += (steerIn - roverSteer) * Math.min(1, dt * 10.5);
        steerJerk = dt > 0 ? Math.abs(roverSteer - prevRoverSteer) / dt : 0;

        const prevYaw = roverSim.attitude().yaw;
        roverSim.step(dt, { throttle, steer: roverSteer, boost, handbrake }, {
          sampleY: sampleElevSceneY,
          sampleNormal,
        });
        const rs = roverSim.state;

        // bumping into crewmates and the historic rovers: push the rover back out and bleed speed
        roverRig.sync();
        const pushOut = (x, z, radius, y) => {
          const hit = rover.resolveCollision(x, z, radius, y);
          if (!hit.hit) return;
          roverSim.setPosition(rs.pos.x - hit.nx * hit.pen, rs.pos.z - hit.nz * hit.pen);
          roverSim.scaleVelocity(0.25);
          roverRig.sync();
        };
        if (partner && partner.group.visible) pushOut(partner.group.position.x, partner.group.position.z, PARTNER_COLLISION_R + 0.08, partner.group.position.y);
        for (const remote of remoteAvatars.values()) {
          pushOut(remote.group.position.x, remote.group.position.z, PARTNER_COLLISION_R + 0.08, remote.group.position.y);
        }
        for (const histEntry of historicRovers.getAllEntries()) {
          const hPos = histEntry.group?.position;
          const hSpec = histEntry.spec;
          if (!hPos || !hSpec) continue;
          pushOut(hPos.x, hPos.z, Math.max(hSpec.halfW || 1.2, hSpec.halfL || 1.3) * 0.72, hPos.y);
        }

        // endless terrain: the wrap moves rover.group; carry the simulation with it
        applySeamlessWorldWrap(rover.group.position.x, rover.group.position.z);
        if (rover.group.position.x !== rs.pos.x || rover.group.position.z !== rs.pos.z) {
          roverSim.setPosition(rover.group.position.x, rover.group.position.z);
          roverRig.sync();
        }

        const att = roverSim.attitude();
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
        for (const wh of roverSim.wheels) if (wh.contact) slipMax = Math.max(slipMax, wh.slip);
        const drifting = Math.abs(rs.vLat) > 1.2 && Math.abs(rs.vLong) > 2;
        dyn = {
          drifting,
          braking: rs.brake > 0.1 || handbrake,
          slipRatio: slipMax,
          gear: rs.gear,
          rpmNorm: Math.min(1, rs.motorRpm / 4000),
          spec: rover.getActiveSpec(),
        };

        // dust when a wheel lands hard or the rover touches down after a crest
        if (rs.landingImpact > 1.0 && devCfg.realisticDust) {
          const rYawL = att.yaw;
          marsFx.emitJumpBurst(rs.pos.x, sampleElevSceneY(rs.pos.x, rs.pos.z), rs.pos.z, {
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
        const P = roverSim.params;
        const strutOrder = [0, 1, 2, 3, 4, 5]; // FL FR ML MR RL RR (dynamics order)
        roverDash.update({
          speedKmh: rs.vLong * 3.6,
          rpm: rs.motorRpm,
          gear: rs.gear,
          powerKw: rs.powerW / 1000,
          torquePct: rs.torquePct,
          batteryPct: (100 * rs.batteryKWh) / P.batteryKWh,
          accel: rs.accel,
          pitchDeg: (att.pitch * 180) / Math.PI,
          rollDeg: (att.roll * 180) / Math.PI,
          headingDeg: (-att.yaw * 180) / Math.PI,
          odoKm: rs.odometerM / 1000,
          struts: strutOrder.map((i) => roverSim.wheels[i].comp / P.maxComp),
          slipPct: slipMax * 100,
          airborne: rs.airborne,
          wheelspin: rs.tractionLimited && Math.abs(rs.pedal) > 0.3,
          handbrake,
          boost,
        });
        if (drvSpdEl) drvSpdEl.textContent = String(Math.round(Math.abs(rs.vLong) * 3.6));
        if (drvGearEl) drvGearEl.textContent = rs.gear;
        if (drvRpmEl) drvRpmEl.style.width = `${Math.round(Math.min(1, rs.motorRpm / 4000) * 100)}%`;
      }

      if (devCfg.realisticDust && !roverAirState.airborne && (Math.abs(roverThrottleVel) > 0.7 || Math.abs(roverLateralSpeed) > 1.2 || dyn?.drifting)) {
        const speedMag = Math.hypot(roverThrottleVel, roverLateralSpeed) + (dyn?.drifting ? 4.5 : 0);
        roverDustAcc += dt * Math.min(54, 10 + speedMag * 3.1);
        const burstCount = Math.floor(roverDustAcc);
        if (burstCount > 0) {
          roverDustAcc -= burstCount;
          const rYaw = rover.group.rotation.y;
          const fx = -Math.sin(rYaw);
          const fz = -Math.cos(rYaw);
          const sideSign = Math.random() < 0.5 ? -1 : 1;
          const emit = rover.getWheelDustEmitPoint(sideSign);
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

      phys.x = rover.group.position.x;
      phys.z = rover.group.position.z;
      phys.y = rover.group.position.y;
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
      if (!isMapOpen()) {
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
          const strict = document.getElementById("toggle-strict-15")?.checked;
          stepPhysicsWorld(
            phys,
            dt,
            {
              wishX: moveDir.x,
              wishZ: moveDir.z,
              run: keys.has("shift") || padRun,
              speedMultiplier: (devCfg.speedMultiplier || 1) * stickPace,
              slopeLimitDeg: strict ? 15 : 20,
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
            const slopeDeg = Math.abs(Math.atan2(ahead - here, 1.5)) * (180 / Math.PI);
            const slowdown = Math.min(1, Math.max(0.35, 1 - Math.max(0, slopeDeg - 10) / 22));
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
      if (devCfg.experimentalRover && rover.group.visible) {
        const col = rover.resolveCollision(
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
        // parked: the same suspension model holds it on its springs; if it was (re)spawned
        // somewhere else, start the simulation from there
        const rsP = roverSim.state;
        if (Math.hypot(rsP.pos.x - rover.group.position.x, rsP.pos.z - rover.group.position.z) > 0.5) {
          roverSim.reset(rover.group.position.x, rover.group.position.z, rover.group.rotation.y, sampleElevSceneY);
        }
        roverSim.step(dt, { throttle: 0, steer: 0, boost: false, handbrake: true }, { sampleY: sampleElevSceneY, sampleNormal });
        roverRig.sync();
        const distR = Math.hypot(freePos.x - rover.group.position.x, freePos.z - rover.group.position.z);
        if (distR <= 4.6 && !nearRoverPrompted) {
          nearRoverPrompted = true;
          showWrapNotice(
            isTrLang() ? "DENEYSEL MARS ARACI · BİNMEK İÇİN [E] TUŞUNA BAS" : "EXPERIMENTAL MARS ROVER · PRESS [E] TO DRIVE"
          );
        } else if (distR > 6.2) {
          nearRoverPrompted = false;
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
    const swayY = Math.sin(ph * 2) * 0.004 * amt;
    const swayX = Math.sin(ph) * 0.003 * amt;
    const micro = (f, a) => Math.sin(clockT * f) * a + Math.sin(clockT * f * 2.17 + 1.3) * a * 0.5;
    if (drivingRover && rover.group.visible) {
      const rPos = rover.group.position;
      const rYaw = rover.group.rotation.y;
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
    dustDevil.update(dt, px, pz, groundY, Boolean(devCfg.dustDevil));
    windDust.setPixelScale(renderer.domElement.height);
    windDust.update(dt, camera, devCfg.windDust === false ? 0 : 1);
    lensMat.uniforms.uDust.value = Math.min(1, lensMat.uniforms.uDust.value + step / 650);
    const sunUpNow = sunUp(sunState.elevationRad);
    sun.intensity = baseSunIntensity * (sunState.fluxWm2 / 590) * tauDim * weatherDim * sunTransit * sunUpNow;
    sun.castShadow = sunUpNow > 0.01;
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
        const hitSpec = pickHistoricRover(
          isPointerLocked() ? null : lastMouseClient.valid ? lastMouseClient.x : null,
          isPointerLocked() ? null : lastMouseClient.valid ? lastMouseClient.y : null
        );
        if (hitSpec !== hoveredRoverSpec) {
          hoveredRoverSpec = hitSpec;
          reticleEl?.classList.toggle("target-rover", Boolean(hitSpec));
          if (roverTargetEl) {
            if (hitSpec) {
              const tr = isTrLang();
              roverTargetEl.textContent = `${hitSpec.name.toUpperCase()} (${hitSpec.mission}) · ${
                tr ? "ETKİLEŞİM [E] / TIKLA" : "INTERACT [E] / CLICK"
              }`;
              roverTargetEl.classList.add("visible");
            } else {
              roverTargetEl.classList.remove("visible");
            }
          }
        }
      }
    }
    curvAnchor.value.set(camera.position.x, camera.position.z);
    followEndless(camera.position);

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
      Array.isArray(stopCoord) && stopCoord.length >= 2 ? marsBearingDeg([curLon, curLat], stopCoord) : NaN;
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
    const renderStart = performance.now();
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    perfStats.sceneMs += (performance.now() - renderStart - perfStats.sceneMs) * 0.1;
    perfStats.updMs += (renderStart - cpuStart - perfStats.updMs) * 0.1;
    perfStats.calls = renderer.info.render.calls;
    perfStats.tris = renderer.info.render.triangles;
    perfStats.geoms = renderer.info.memory.geometries;
    perfStats.tex = renderer.info.memory.textures;
    renderer.setRenderTarget(null);
    renderer.render(lensScene, lensCam);
    perfStats.cpuMs += (performance.now() - cpuStart - perfStats.cpuMs) * 0.1;
    perfStats.frameMs += (dt * 1000 - perfStats.frameMs) * 0.1;
    if (perfOn && now - perfLastDraw > 250) {
      perfLastDraw = now;
      const fps = perfStats.frameMs > 0 ? 1000 / perfStats.frameMs : 0;
      perfEl.textContent =
        `${fps.toFixed(0)} FPS · frame ${perfStats.frameMs.toFixed(1)} ms · CPU ${perfStats.cpuMs.toFixed(1)} ms (update ${perfStats.updMs.toFixed(1)} + submit ${perfStats.sceneMs.toFixed(1)})\n` +
        `target ${(1000 / perfStats.refreshMs).toFixed(0)} Hz · render scale ${(renderScale * 100).toFixed(0)}% · ` +
        `pixel ratio ${renderer.getPixelRatio().toFixed(2)}\n` +
        `draw calls ${perfStats.calls} · triangles ${(perfStats.tris / 1000).toFixed(0)}k · geoms ${perfStats.geoms} · textures ${perfStats.tex}`;
    }
  }
  requestAnimationFrame(animate);
  loadingVeil?.classList.add("done");

  return {
    onResize: () => {
      onResize();
    },
    dropLocalPing,
    visitRoverSite,
    getLonLat: () => ({ lon: xToLon(player.x), lat: zToLat(player.z) }),
    getActiveSiteId: () => activeSiteId,
    perf: () => ({ ...perfStats, renderScale, pixelRatio: renderer.getPixelRatio() }),
    /** Per top-level scene object: visible meshes, how many cast shadows, triangles (for tuning). */
    perfBreakdown: () =>
      scene.children.map((c, i) => {
        let meshes = 0;
        let casters = 0;
        let tris = 0;
        c.traverse((o) => {
          if (!o.isMesh && !o.isPoints && !o.isLine) return;
          let vis = true;
          for (let q = o; q; q = q.parent) if (!q.visible) vis = false;
          if (!vis) return;
          meshes++;
          if (o.castShadow) casters++;
          const g = o.geometry;
          tris += g?.index ? g.index.count / 3 : (g?.attributes?.position?.count || 0) / 3;
        });
        return { i, type: c.type, name: c.name || c.constructor.name, visible: c.visible, meshes, casters, tris: Math.round(tris) };
      }),
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
