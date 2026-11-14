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
  onSetRoute,
  onTeleport,
  resolveNextStopAlongRoute,
  sampleAlongRoute,
} from "../shared/route-bridge.js";
import { createAstronaut, loadSuitRig } from "./astronaut-rig.js";
import { gamepad } from "../shared/gamepad.js";
import { createVisorGlobe } from "./visor-globe.js";
import { createFootsteps } from "./footsteps.js";
import { galeSunState, PHOBOS_SKY_RATE_RAD_S, DEIMOS_SKY_RATE_RAD_S } from "./MarsEphemeris.js";
import { createCelestialSky } from "./MarsCelestialSky.js";
import { createRockField } from "./MarsRockField.js";
import { createGaleVista } from "./GaleVista.js";
import { createDustDevil } from "./DustDevil.js";
import { createMarsDustSystem } from "./dust-fx.js";
import { createWindDust } from "./wind-dust.js";
import { createFieldKits } from "./FieldKits.js";
import { lerpAngleRad } from "../shared/multiplayer.js";
import { createMartianPbrTextureSets } from "../map/MarsPbrTextures.js";
import { loadDevSettings, subscribeDevSettings } from "../shared/dev-settings.js";
import { MARS_GEODESY } from "../physics/MarsConstants.js";
import { ellipsoidMetersPerDeg } from "../physics/MarsGravityField.js";
import { metabolicPowerW, oxygenLitresPerMin, skyViewFactor } from "../physics/MetabolicPlssModel.js";
import { createMarsBody, stepPhysicsWorld } from "../physics/MarsPhysicsWorld.js";
import { downhillLeanRad, torsoLeanRad } from "../physics/SuitBiomechanics.js";

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
// The rig (arm rest pose, elbow and shoulder measurements) is tuned on the Mark III planetary suit;
// the ACES launch/entry suit holds its arms differently and looks wrong with it, so it is only a fallback.
const SUIT_MODELS = [
  { url: "./assets/nasa-3d/mark-iii-spacesuit.glb", label: "NASA MARK III · PROCEDURAL GAIT" },
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

// Small tileable value-noise texture for close-range ground detail (visual only).
function makeDetailTexture(size = 256) {
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
    { n: 8, w: 0.45 },
    { n: 16, w: 0.25 },
    { n: 32, w: 0.17 },
    { n: 64, w: 0.13 },
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
    float s = max(dot(d, normalize(uSunDir)), 0.0);
    float disc = smoothstep(uSunCos - 0.00002, min(0.9999992, uSunCos + 0.0000015), s);
    col += vec3(1.6, 1.65, 1.8) * disc * exp(-0.18 * tau);
    col += vec3(0.55, 0.62, 0.75) * pow(s, 900.0) * 6.0;
    col += vec3(0.40, 0.48, 0.62) * pow(s, 60.0) * 0.6;
    col += vec3(0.30, 0.18, 0.10) * pow(s, 6.0) * 0.35;
    float lowSun = smoothstep(0.38, -0.02, uSunElev);
    float fwd = smoothstep(0.90, 0.992, s);
    col += vec3(0.18, 0.34, 0.62) * fwd * lowSun * exp(-tau * 0.22);
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
    float s = max(dot(d, normalize(uSunDir)), 0.0);
    col += vec3(0.55, 0.62, 0.75) * pow(s, 900.0) * 6.0;
    col += vec3(0.40, 0.48, 0.62) * pow(s, 60.0) * 0.6;
    col += vec3(0.30, 0.18, 0.10) * pow(s, 6.0) * 0.35;
    float lowSun = smoothstep(0.38, -0.02, uSunElev);
    float fwd = smoothstep(0.90, 0.992, s);
    col += vec3(0.18, 0.34, 0.62) * fwd * lowSun * exp(-tau * 0.22);
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

// Eyes through clear polycarbonate. Gold tint, magnifier, and rare cosmic-ray ticks are uniforms.
const LENS_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uDistort;
  uniform float uFrameZoom;
  uniform float uAberration;
  uniform float uGrain;
  uniform float uVignette;
  uniform float uExposure;
  uniform float uGold;
  uniform float uOptZoom;
  uniform float uGlint;
  uniform float uRay;
  uniform float uDust;
  varying vec2 vUv;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    float aspect = uResolution.x / uResolution.y;
    vec2 c = vUv - 0.5;
    c.x *= aspect;
    float r2 = dot(c, c);
    vec2 d = c * (1.0 + uDistort * r2 + 0.35 * uDistort * r2 * r2);
    d *= uFrameZoom / max(1.0, uOptZoom);
    d.x /= aspect;
    vec2 uv = d + 0.5;
    vec2 dir = normalize(c + 1e-5) / vec2(aspect, 1.0);
    float ca = uAberration * r2;
    vec3 col;
    col.r = texture2D(tDiffuse, uv + dir * ca).r;
    col.g = texture2D(tDiffuse, uv).g;
    col.b = texture2D(tDiffuse, uv - dir * ca).b;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) col = vec3(0.0);

    col *= uExposure;
    vec3 gold = col * vec3(1.15, 0.78, 0.38);
    gold = mix(gold, gold * vec3(0.72, 0.62, 0.4), 0.35);
    col = mix(col, gold, uGold);
    float helm = smoothstep(0.45, 1.25, length(c));
    col *= mix(1.0, 0.12, helm * uVignette);
    col += vec3(0.42, 0.32, 0.24) * helm * helm * 0.16 * (1.0 - 0.45 * uGold);
    float scratch = uGlint * pow(max(0.0, 1.0 - abs(c.y) * 3.0), 2.0) * (0.5 + 0.5 * sin(c.x * 140.0 + c.y * 40.0));
    col += vec3(1.0, 0.95, 0.85) * scratch * 0.08;

    // dust on the outside of the visor: fixed specks that catch the light (more when you face the
    // Sun) and a faint film low on the glass; both build up as you walk (uDust 0.2 .. 1)
    vec2 gs = vUv * vec2(aspect, 1.0) * 70.0;
    vec2 cid = floor(gs);
    vec2 off = vec2(hash(cid + 3.1), hash(cid + 7.7)) - 0.5;
    float speck = step(1.0 - 0.09 * uDust, hash(cid)) * smoothstep(0.2, 0.0, length(fract(gs) - 0.5 - off * 0.5));
    col += vec3(0.95, 0.8, 0.62) * speck * (0.05 + 0.22 * uGlint);
    float film = uDust * smoothstep(0.42, 0.0, vUv.y) * 0.35;
    col = mix(col, col * vec3(1.02, 0.94, 0.86) + vec3(0.035, 0.024, 0.014), film);

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

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>

    float g = hash(vUv * uResolution + fract(uTime * 37.0) * 91.0) - 0.5;
    gl_FragColor.rgb += g * uGrain * (1.0 - 0.6 * dot(gl_FragColor.rgb, vec3(0.333)));
  }
`;

export async function initHud3D(data, { onBackToPlanner, onOpenPov, mp = null, onLocalPose = null }) {
  const { costMap, route, stops, telemetry, dose, alerts, weather, povIndex, assets } = data;
  let surfaceG = 3.717;
  const wrap = document.getElementById("hud-canvas-wrap");
  const loadingVeil = document.getElementById("hud-loading");

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

  // Convert [lon, lat] <-> local scene X, Z (metres, centred at 0,0)
  const lonToX = (lon) =>
    ((lon - bounds.west_lon_deg) / (bounds.east_lon_deg - bounds.west_lon_deg) - 0.5) * worldW;
  const latToZ = (lat) =>
    (0.5 - (lat - bounds.south_lat_deg) / (bounds.north_lat_deg - bounds.south_lat_deg)) * worldH;
  const xToLon = (x) =>
    bounds.west_lon_deg + (x / worldW + 0.5) * (bounds.east_lon_deg - bounds.west_lon_deg);
  const zToLat = (z) =>
    bounds.south_lat_deg + (0.5 - z / worldH) * (bounds.north_lat_deg - bounds.south_lat_deg);

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

  // Afternoon at Gale from the Mars24 solar longitude, not a fixed vector.
  const sunState = galeSunState(new Date(), 15);
  const sunDir = new THREE.Vector3(sunState.x, sunState.y, sunState.z).normalize();
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
  const moonSpin = new THREE.Vector3();
  const phobosDir = new THREE.Vector3();
  const deimosDir = new THREE.Vector3();
  function dirNearSun(out, angleRad, elevBias) {
    const c = Math.cos(angleRad);
    const s = Math.sin(angleRad);
    out.set(sunDir.x * c - sunDir.z * s, sunDir.y + elevBias, sunDir.x * s + sunDir.z * c);
    if (out.lengthSq() < 1e-6) out.set(0, 1, 0);
    return out.normalize();
  }
  function updateMoons(tSec, camPos = camera.position) {
    // Epoch puts Phobos just west of the Sun so a real-rate transit starts soon after the visor opens.
    const pAng = (tSec - 18) * PHOBOS_SKY_RATE_RAD_S;
    dirNearSun(phobosDir, pAng, 0);
    phobos.position.copy(phobosDir).multiplyScalar(PHOBOS_ORBIT_R);
    phobos.lookAt(camPos);
    const dAng = 1.15 + tSec * DEIMOS_SKY_RATE_RAD_S;
    dirNearSun(deimosDir, dAng, 0.08);
    deimos.position.copy(deimosDir).multiplyScalar(DEIMOS_ORBIT_R);
    deimos.lookAt(camPos);
    const sep = Math.acos(Math.max(-1, Math.min(1, phobosDir.dot(sunDir))));
    const limit = sunState.sunAngularRad * 0.5 + 0.1 * (Math.PI / 180);
    sunTransit = sep < limit ? 1 - 0.35 * (1 - sep / limit) : 1;
  }
  updateMoons(0);
  const celestial = createCelestialSky(THREE);
  celestial.update({ ...sunState, date: new Date() });
  scene.add(celestial.group);
  const rockField = createRockField(THREE);
  scene.add(rockField.group);
  const galeVista = createGaleVista(THREE);
  scene.add(galeVista);
  const dustDevil = createDustDevil(THREE);
  scene.add(dustDevil.points);
  // boot dust (footsteps, take-off, landing) and the wind-blown dust around you
  const dustFx = createMarsDustSystem({ THREE, scene, horizonColor: HORIZON, sunDir });
  const windDust = createWindDust({ THREE, scene, groundY: (x, z) => sampleElevSceneY(x, z), sunDir });
  const _dustPos = new THREE.Vector3();
  const _dustNrm = new THREE.Vector3();
  const _dustMove = new THREE.Vector3();
  let fxWasGrounded = true;

  // Image-based light from the same sky, so suits and rocks pick up the dusty sky and ground bounce.
  {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), sky.material));
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    scene.environmentIntensity = 0.5;
    pmrem.dispose();
  }

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

  // Bilinear height (scene Y, metres above elevMin), mirror-wrapped beyond the real tile.
  function sampleElevSceneY(x, z) {
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
  const terrainGeom = buildTerrainGeometry(fullSeg);
  // mirrored copies are seen from far away through fog: a quarter of the vertex density is plenty
  const copyGeom = buildTerrainGeometry(Math.max(1, Math.floor(fullSeg / 4)));

  // ---------- far terrain shadows (baked) ----------
  // The real-time shadow map only covers the ground near the walker. For the rest, march from every
  // terrain cell towards the sun through the height grid and store how much of the sun is visible.
  // The mirrored terrain repeats every 2 tiles in world space, so one mask over that period, sampled
  // with world x/z and repeat wrapping, is correct for the real tile and every mirrored copy.
  // Start-up cost: the old full-resolution bake took ~5 s before anything showed. Now it runs at
  // half resolution (one texel per 2 x 2 DTM cells, ~10 m: the shadow edge is soft anyway), stops a
  // ray as soon as it rises above the highest point of the terrain, and runs in small slices after
  // the world is on screen. Until it finishes, the mask is all lit (no terrain shadows yet).
  function createSunMaskBaker() {
    const n = elevGrid ? imgW : 0;
    if (!n) return null;
    const N = 2 * n; // DTM cells across one mirror period
    const M = Math.ceil(N / 2); // mask texels across the period
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
    const horiz = Math.hypot(sunDir.x, sunDir.z) || 1e-6;
    const tanSun = sunDir.y / horiz;
    const STEP = 2; // DTM cells per ray step
    const dx = (sunDir.x / horiz) * STEP; // towards the sun (x = columns, east)
    const dz = (sunDir.z / horiz) * STEP; // z = rows, south
    const stepM = STEP * cell;
    const maxSteps = Math.ceil(700 / stepM);
    const SOFT = 0.012; // about the sun disc plus dust: soft edge in tan(angle)
    const out = new Uint8Array(M * M * 4).fill(255);
    const wrap = (v) => ((v % N) + N) % N;
    const tex = new THREE.DataTexture(out, M, M, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    let row = 0;
    let shade = 0;
    function bakeRow(mr) {
      const r = Math.min(N - 1, mr * 2);
      for (let mc = 0; mc < M; mc++) {
        const c = Math.min(N - 1, mc * 2);
        const h0 = H[r * N + c];
        let worst = -1e9;
        for (let k = 1; k <= maxSteps; k++) {
          if (h0 + (tanSun + SOFT) * k * stepM > hMax) break; // the ray is above every hill now
          const fx = c + dx * k;
          const fz = r + dz * k;
          const x0 = Math.floor(fx);
          const z0 = Math.floor(fz);
          const tx = fx - x0;
          const tz = fz - z0;
          const a = wrap(x0);
          const b = wrap(x0 + 1);
          const ra = wrap(z0) * N;
          const rb = wrap(z0 + 1) * N;
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
        if (lit < 0.5) shade++;
      }
    }
    return {
      tex,
      /** Bake rows for up to `budgetMs`; true once the whole mask is done. */
      step(budgetMs) {
        const t0 = performance.now();
        while (row < M && performance.now() - t0 < budgetMs) bakeRow(row++);
        if (row >= M) {
          tex.needsUpdate = true;
          return true;
        }
        return false;
      },
      get shadeShare() {
        return shade / (M * M);
      },
    };
  }
  const sunBaker = createSunMaskBaker();
  const sunMask = sunBaker?.tex || null;
  if (sunBaker) {
    const bakeT0 = performance.now();
    const slice = () => {
      if (sunBaker.step(10)) {
        console.info(
          `sun mask baked in the background in ${Math.round(performance.now() - bakeT0)} ms, ` +
            `${(100 * sunBaker.shadeShare).toFixed(1)}% of ground in terrain shadow`
        );
      } else setTimeout(slice, 0);
    };
    setTimeout(slice, 300); // after the first frames are on screen
  }

  // ---------- terrain material ----------
  const texLoader = new THREE.TextureLoader();
  const prepTex = (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    return t;
  };
  const orthoTex = prepTex(texLoader.load(assets.orthoPreviewUrl));
  const slopeTex = prepTex(texLoader.load(assets.slopePreviewUrl));
  const reliefUrl = assets.reliefTextureUrl || assets.heightPreviewUrl.replace(/height-preview\.png$/, "texture-relief.jpg");
  let reliefOk = true;
  let texMode = 0; // 0 relief, 1 ortho, 2 slope
  const reliefTex = prepTex(
    texLoader.load(reliefUrl, undefined, undefined, () => {
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
  const pbr = createMartianPbrTextureSets(THREE, 256);
  for (const t of [pbr.dustAlbedoTex, pbr.rockAlbedoTex, pbr.dustNormalTex, pbr.rockNormalTex]) t.anisotropy = maxAniso;
  pbr.dustNormalTex.repeat.set(640, 640);

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
  terrainMat.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: detailTex };
    shader.uniforms.uCurvAnchor = curvAnchor;
    shader.uniforms.uCurvInv2N = curvInv2N;
    shader.uniforms.uCurvInv2M = curvInv2M;
    shader.uniforms.pbrDust = { value: pbr.dustAlbedoTex };
    shader.uniforms.pbrRock = { value: pbr.rockAlbedoTex };
    shader.uniforms.sunMask = { value: sunMask };
    shader.uniforms.sunMaskOn = { value: sunMask ? 1 : 0 };
    shader.uniforms.sunMaskPeriod = { value: new THREE.Vector2(2 * worldW, 2 * worldH) };
    shader.uniforms.sunMaskOrigin = { value: new THREE.Vector2(-worldW / 2, -worldH / 2) };
    shader.uniforms.uSuperDetail = superDetailUniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec2 vMmWorldXZ;\nuniform vec2 uCurvAnchor;\nuniform float uCurvInv2N;\nuniform float uCurvInv2M;"
      )
      .replace(
        "#include <project_vertex>",
        "vec4 mmWorld = modelMatrix * vec4(transformed, 1.0);\nvMmWorldXZ = mmWorld.xz;\nfloat mmDx = mmWorld.x - uCurvAnchor.x;\nfloat mmDz = mmWorld.z - uCurvAnchor.y;\nmmWorld.y += -mmDx * mmDx * uCurvInv2N - mmDz * mmDz * uCurvInv2M;\nvec4 mvPosition = viewMatrix * mmWorld;\ngl_Position = projectionMatrix * mvPosition;"
      );
    const sunChunk = THREE.ShaderChunk.lights_fragment_begin.replace(
      "getDirectionalLightInfo( directionalLight, directLight );",
      "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= mmSunVis;"
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec2 vMmWorldXZ;\nuniform sampler2D sunMask;\nuniform float sunMaskOn;\nuniform vec2 sunMaskPeriod;\nuniform vec2 sunMaskOrigin;"
      )
      .replace(
        "#include <lights_fragment_begin>",
        "float mmSunVis = sunMaskOn > 0.5 ? texture2D(sunMask, (vMmWorldXZ - sunMaskOrigin) / sunMaskPeriod).r : 1.0;\n" +
          sunChunk
      )
      .replace(
        "#include <map_pars_fragment>",
        "#include <map_pars_fragment>\nuniform sampler2D detailMap;\nuniform sampler2D pbrDust;\nuniform sampler2D pbrRock;\nuniform float uSuperDetail;"
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        #ifdef USE_MAP
          float dA = texture2D(detailMap, vMapUv * 173.0).r;
          float dB = texture2D(detailMap, vMapUv * 911.0).r;
          float detailGain = mix(0.40, 0.54, uSuperDetail);
          diffuseColor.rgb *= (1.0 - detailGain * 0.65) + detailGain * dA * 0.6 + detailGain * dB * 0.4;
          // Close-range ground detail: ripples / pebbles on dust, slabs + veins on rock patches.
          vec3 mmDust = texture2D(pbrDust, vMapUv * mix(640.0, 920.0, uSuperDetail)).rgb;
          vec3 mmRock = texture2D(pbrRock, vMapUv * mix(290.0, 440.0, uSuperDetail) + 0.37).rgb;
          float mmRockMask = smoothstep(0.48, 0.66, texture2D(detailMap, vMapUv * 41.0 + 0.11).r);
          vec3 mmGround = mix(mmDust, mmRock, mmRockMask);
          float mmLum = dot(mmGround, vec3(0.299, 0.587, 0.114)) / 0.40;
          diffuseColor.rgb *= mix(1.0, clamp(mmLum, 0.30, 1.75), mix(0.7, 0.92, uSuperDetail));
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

  // ---------- stop markers: survey poles with a small lamp ----------
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
      // You spawn on the start stop, so it gets no marker; the others are knee-high survey stakes
      // (the old 2.4-4.6 m poles stood as a white line through the middle of the view).
      if (isStart) return;
      const poleH = isStart ? 0.55 : 0.45;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, poleH, 8), poleMat);
      pole.position.set(sx, sy + poleH * 0.5, sz);
      pole.castShadow = true;
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(isStart ? 0.05 : 0.04, 12, 8),
        isStart ? startLampMat : lampMat
      );
      lamp.position.set(sx, sy + poleH + 0.03, sz);
      scene.add(pole, lamp);
    });
  }
  const fieldKits = createFieldKits(THREE, stops, lonToX, latToZ, sampleElevSceneY);
  scene.add(fieldKits);
  const footsteps = createFootsteps(THREE, scene);

  // ---------- route ----------
  let routeLineMesh = null;
  let activeRoute = route;
  let routeCoords = activeRoute?.geometry?.coordinates || [];
  let cumDist = buildCumulativeDistances(routeCoords);
  let geomTotalDist = cumDist[cumDist.length - 1] || 1;
  let totalDist = Number(activeRoute?.totals?.distance_m) > 0 ? Number(activeRoute.totals.distance_m) : geomTotalDist;
  let alongM = 0;

  const toGeomDist = (s) => (geomTotalDist > 0 && totalDist > 0 ? (s / totalDist) * geomTotalDist : s);

  function rebuildRouteRibbon(r) {
    if (routeLineMesh) scene.remove(routeLineMesh);
    activeRoute = r;
    routeCoords = r?.geometry?.coordinates || [];
    cumDist = buildCumulativeDistances(routeCoords);
    geomTotalDist = cumDist[cumDist.length - 1] || 1;
    totalDist = Number(activeRoute?.totals?.distance_m) > 0 ? Number(activeRoute.totals.distance_m) : geomTotalDist;
    const pts = routeCoords.map(([lon, lat]) => {
      const x = lonToX(lon);
      const z = latToZ(lat);
      return new THREE.Vector3(x, sampleElevSceneY(x, z) + 0.12, z);
    });
    if (pts.length > 1) {
      routeLineMesh = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, fog: true })
      );
      // route line hidden in the 3D view (Cagan's request); the route data still drives the HUD
    }
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
    return { group: g, update() {}, phase: 0, amount: 0 };
  };
  {
    const draco = new DRACOLoader();
    draco.setDecoderPath("./vendor/addons/libs/draco/gltf/");
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    for (const m of SUIT_MODELS) {
      try {
        const rig = await loadSuitRig(loader, m.url, ASTRONAUT_HEIGHT_M);
        suitRig = rig;
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
      crewEl.innerHTML = `${cs} · 1.80 M · <span id="hud-suit">${suitLabel}</span>`;
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

  // ---------- bodycam lens pass ----------
  let rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 });
  let rtSamples = 2;
  const lensMat = new THREE.ShaderMaterial({
    vertexShader: LENS_VERT,
    fragmentShader: LENS_FRAG,
    depthTest: false,
    depthWrite: false,
    toneMapped: true,
    uniforms: {
      tDiffuse: { value: rt.texture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uDistort: { value: 0.26 },
      uFrameZoom: { value: 0.88 },
      uAberration: { value: 0.006 },
      uGrain: { value: 0.07 },
      uVignette: { value: 1.05 },
      uExposure: { value: 1.0 },
      uGold: { value: 0 },
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
    molaElevM: (x, z) => elevMin + sampleElevSceneY(x, z),
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
  }
  let partnerS = PARTNER_AHEAD_M;
  let justTeleportedOrWrapped = false;
  const keys = new Set();
  phys.y = sampleElevSceneY(phys.x, phys.z);
  syncPlayerFromPhys();
  justTeleportedOrWrapped = false;

  const mapOverlayEl = document.getElementById("hud-map-overlay");
  const isMapOpen = () => Boolean(mapOverlayEl?.classList.contains("open"));

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  renderer.domElement.addEventListener("pointerdown", (e) => {
    footsteps.resume();
    if (isMapOpen()) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener("pointerup", () => (dragging = false));
  window.addEventListener("pointermove", (e) => {
    if (!dragging || isMapOpen()) return;
    userYaw -= (e.clientX - lastX) * 0.0035;
    pitch = Math.max(-1.35, Math.min(1.42, pitch - (e.clientY - lastY) * 0.003));
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const dropLocalPing = (label = "Science Beacon") => {
    if (!mp) return null;
    const x = player.init ? player.x : lonToX(routeCoords[0]?.[0] ?? 137.39);
    const z = player.init ? player.z : latToZ(routeCoords[0]?.[1] ?? -4.8);
    const lon = xToLon(x);
    const lat = zToLat(z);
    const elev = elevMin + sampleElevSceneY(x, z);
    return mp.dropPing({ lon, lat, elevM: elev, label });
  };

  const hudView = document.getElementById("hud-view");
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener("blur", () => keys.clear());

  const btnPlay = document.getElementById("hud-play");
  const scrubber = document.getElementById("hud-scrubber");
  const btnSpeed = document.getElementById("hud-speed");
  const btnTex = document.getElementById("hud-tex");
  const btnFreeRoam = document.getElementById("hud-freeroam");
  const btnBack = document.getElementById("hud-back-planner");
  const btnPing = document.getElementById("hud-ping");
  const btnPov = document.getElementById("hud-pov-btn");
  const btnMap = document.getElementById("hud-map-btn");

  btnPing?.addEventListener("click", () => dropLocalPing("EVA Waypoint"));

  btnBack?.addEventListener("click", () => {
    playing = false;
    if (btnPlay) btnPlay.textContent = "Play";
    setMapOpen(false);
    onBackToPlanner();
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
    const wx = wrapSceneCoord(tx, worldW).val;
    const wz = wrapSceneCoord(tz, worldH).val;
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
    teleportToLocal(lonToX(lon), latToZ(lat), { keepYaw: false });
  });

  // ---------- Tactical Mars 3D Elevation Map (toggled via M key) ----------
  const mapCanvasEl = document.getElementById("hud-map-canvas");
  const mapCtx = mapCanvasEl?.getContext("2d") || null;
  const mapHoverEl = document.getElementById("hud-map-hover");
  const mapModeBtn = document.getElementById("hud-map-mode");
  const mapCloseBtn = document.getElementById("hud-map-close");
  const mapConfirmEl = document.getElementById("hud-map-confirm");
  const mapConfirmQEl = document.getElementById("hud-map-confirm-q");
  const mapConfirmMetaEl = document.getElementById("hud-map-confirm-meta");
  const mapConfirmYesBtn = document.getElementById("hud-map-confirm-yes");
  const mapConfirmNoBtn = document.getElementById("hud-map-confirm-no");

  const isTrLang = () => {
    try {
      return localStorage.getItem("mm-lang") === "tr";
    } catch {
      return false;
    }
  };

  let mapLayerMode = "elevation"; // "elevation" | "hazard"
  let pendingTeleport = null; // { tx, tz, lon, lat, elevMola, slopeDeg, distM }
  let hoverTarget = null;

  // ---- Whole-Mars globe (default map scope). The local scope is the HiRISE strip you walk on. ----
  let mapScope = "globe"; // "globe" | "local"
  let globePick = null;
  let globeFocused = false;
  const globeHost = document.getElementById("hud-globe-host");
  const mapScopeBtn = document.getElementById("hud-map-scope");
  const globeLayerBtn = document.getElementById("hud-globe-layer");
  const globeSunBtn = document.getElementById("hud-globe-sun");
  const globeInfoEl = document.getElementById("hud-globe-info");
  const globeInfoTitleEl = document.getElementById("hud-globe-info-title");
  const globeInfoMetaEl = document.getElementById("hud-globe-info-meta");
  const globeLocalBtn = document.getElementById("hud-globe-local");
  const globeInfoCloseBtn = document.getElementById("hud-globe-info-close");
  const walkSite = {
    lon: (bounds.west_lon_deg + bounds.east_lon_deg) / 2,
    lat: (bounds.south_lat_deg + bounds.north_lat_deg) / 2,
  };
  const LOCAL_REACH_KM = 90; // inside Gale crater: offer the local (walkable) map
  const fmtLonLat = (lon, lat, d = 2) =>
    `${Math.abs(lat).toFixed(d)}°${lat < 0 ? "S" : "N"} ${Math.abs(lon).toFixed(d)}°${lon < 0 ? "W" : "E"}`;
  const globeReadout = (hit) => {
    const tr = isTrLang();
    const where = hit.feature ? ` · ${hit.feature.name.toUpperCase()}` : "";
    const km = hit.walkKm < 10 ? hit.walkKm.toFixed(1) : Math.round(hit.walkKm).toLocaleString("en-US");
    return (
      `${fmtLonLat(hit.lon, hit.lat)} · MOLA ${Math.round(hit.elevM).toLocaleString("en-US")} m${where} · ` +
      `${km} km ${tr ? "SENDEN" : "FROM YOU"}`
    );
  };
  const globeHoverHint = () =>
    isTrLang()
      ? "SÜRÜKLE: DÖNDÜR · TEKER: YAKINLAŞ · TIKLA: İNCELE · GALE İÇİNDE: YEREL HARİTA"
      : "DRAG: SPIN · WHEEL: ZOOM · CLICK: INSPECT · INSIDE GALE: LOCAL MAP";
  function showGlobeInfo(hit) {
    if (!globeInfoEl) return;
    globePick = hit;
    if (!hit) {
      globeInfoEl.style.display = "none";
      globe?.setTarget(null);
      return;
    }
    const tr = isTrLang();
    const f = hit.feature;
    const kindTr = { crater: "krater", basin: "havza", mons: "volkan", region: "bölge", site: "iniş yeri" };
    if (globeInfoTitleEl) {
      let title = tr ? "Adsız arazi" : "Unnamed terrain";
      if (f) {
        const kind = tr ? kindTr[f.kind] || f.kind : f.kind === "site" ? "landing site" : f.kind;
        title = f.dKm ? `${f.name} · ${kind} ${Math.round(f.dKm)} km` : `${f.name} · ${kind}`;
      }
      globeInfoTitleEl.textContent = title;
    }
    const near = hit.walkKm < LOCAL_REACH_KM;
    if (globeInfoMetaEl) {
      let note;
      if (near) {
        note = tr
          ? "Gale içinde: yerel 1 m HiRISE haritasında ışınlanabilirsin."
          : "Inside Gale: you can teleport on the local 1 m HiRISE map.";
      } else {
        note = tr
          ? "Yürünebilir arazi yalnızca Gale'deki HiRISE şeridi; burası sadece incelenebilir."
          : "Only the Gale HiRISE strip is walkable; this point is for looking at.";
      }
      globeInfoMetaEl.innerHTML =
        `${fmtLonLat(hit.lon, hit.lat, 3)}<br/>` +
        `<strong>MOLA:</strong> ${Math.round(hit.elevM).toLocaleString("en-US")} m ${tr ? "(areoide göre)" : "(vs the areoid)"}<br/>` +
        `<strong>${tr ? "Senden" : "From you"}:</strong> ${Math.round(hit.walkKm).toLocaleString("en-US")} km<br/>` +
        note;
    }
    if (globeLocalBtn) {
      globeLocalBtn.style.display = near ? "" : "none";
      globeLocalBtn.textContent = tr ? "Yerel haritayı aç" : "Open local map";
    }
    if (globeInfoCloseBtn) globeInfoCloseBtn.textContent = tr ? "Kapat" : "Close";
    globeInfoEl.style.display = "block";
    globe?.setTarget(hit);
  }
  const globe = globeHost
    ? createVisorGlobe({
        host: globeHost,
        dataBase: new URL("../data/demo/", window.location.href).href,
        walkSite,
        onPick: (hit) => showGlobeInfo(hit),
        onHover: (hit) => {
          if (mapHoverEl && mapScope === "globe") mapHoverEl.textContent = hit ? globeReadout(hit) : globeHoverHint();
        },
      })
    : null;
  let localHoverText = mapHoverEl?.textContent || "";
  function setMapScope(next) {
    const wasGlobe = mapScope === "globe";
    mapScope = next === "local" ? "local" : "globe";
    const isGlobe = mapScope === "globe";
    mapOverlayEl?.classList.toggle("scope-globe", isGlobe);
    mapOverlayEl?.classList.toggle("scope-local", !isGlobe);
    pendingTeleport = null;
    if (mapConfirmEl) mapConfirmEl.style.display = "none";
    if (!isGlobe) showGlobeInfo(null);
    if (isGlobe && isMapOpen()) globe?.open().catch(() => {});
    else globe?.close();
    syncMapStaticText();
    if (mapHoverEl) {
      if (!wasGlobe && isGlobe) localHoverText = mapHoverEl.textContent;
      mapHoverEl.textContent = isGlobe ? globeHoverHint() : localHoverText;
    }
    renderTacticalMap();
  }
  mapScopeBtn?.addEventListener("click", () => setMapScope(mapScope === "globe" ? "local" : "globe"));
  globeLayerBtn?.addEventListener("click", () => {
    globe?.cycleLayer();
    syncMapStaticText();
  });
  globeSunBtn?.addEventListener("click", () => {
    globe?.toggleSun();
    syncMapStaticText();
  });
  globeLocalBtn?.addEventListener("click", () => setMapScope("local"));
  globeInfoCloseBtn?.addEventListener("click", () => showGlobeInfo(null));

  // Build Martian-themed 3D elevation + slope base canvases directly from `elevGrid` (1:1 with 3D terrain)
  const mapBases = (() => {
    const w = elevGrid ? imgW : 256;
    const h = elevGrid ? imgH : 256;
    const elevCanvas = document.createElement("canvas");
    elevCanvas.width = w;
    elevCanvas.height = h;
    const hazCanvas = document.createElement("canvas");
    hazCanvas.width = w;
    hazCanvas.height = h;
    const eCtx = elevCanvas.getContext("2d");
    const hCtx = hazCanvas.getContext("2d");
    const eImg = eCtx.createImageData(w, h);
    const hImg = hCtx.createImageData(w, h);

    let minE = elevMin;
    let maxE = elevMax;
    if (elevGrid) {
      minE = Infinity;
      maxE = -Infinity;
      for (let i = 0; i < elevGrid.length; i++) {
        if (elevGrid[i] < minE) minE = elevGrid[i];
        if (elevGrid[i] > maxE) maxE = elevGrid[i];
      }
    }
    const spanE = Math.max(1, maxE - minE);

    const elevMaxLabel = document.getElementById("hud-map-elev-max");
    const elevMidLabel = document.getElementById("hud-map-elev-mid");
    const elevMinLabel = document.getElementById("hud-map-elev-min");
    if (elevMaxLabel) elevMaxLabel.textContent = `${Math.round(maxE)} m`;
    if (elevMidLabel) elevMidLabel.textContent = `${Math.round((minE + maxE) * 0.5)} m`;
    if (elevMinLabel) elevMinLabel.textContent = `${Math.round(minE)} m`;

    // Gale Crater / Mount Sharp hypsometric palette matching the 3D scene's dust/rock colors
    const stopsCol = [
      [0.0, 59, 32, 22],
      [0.25, 111, 59, 36],
      [0.5, 168, 93, 56],
      [0.75, 207, 134, 83],
      [1.0, 237, 196, 152],
    ];
    const sampleMarsRamp = (t) => {
      const c = Math.max(0, Math.min(1, t));
      for (let s = 0; s < stopsCol.length - 1; s++) {
        const a = stopsCol[s];
        const b = stopsCol[s + 1];
        if (c <= b[0]) {
          const u = (c - a[0]) / (b[0] - a[0] || 1);
          return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
        }
      }
      const last = stopsCol[stopsCol.length - 1];
      return [last[1], last[2], last[3]];
    };

    const sunMaskData = sunMask?.image?.data || null;
    const sunMaskW = sunMask?.image?.width || 0;
    const stepM = worldW / Math.max(1, w - 1);
    const minorInterval = 20;
    const majorInterval = 60;

    for (let y = 0; y < h; y++) {
      const ym = Math.max(0, y - 1);
      const yp = Math.min(h - 1, y + 1);
      for (let x = 0; x < w; x++) {
        const xm = Math.max(0, x - 1);
        const xp = Math.min(w - 1, x + 1);

        const eC = elevGrid ? elevGrid[y * w + x] : minE + (1 - y / h) * spanE;
        const eL = elevGrid ? elevGrid[y * w + xm] : eC;
        const eR = elevGrid ? elevGrid[y * w + xp] : eC;
        const eU = elevGrid ? elevGrid[ym * w + x] : eC;
        const eD = elevGrid ? elevGrid[yp * w + x] : eC;

        const gx = (eR - eL) / ((xp - xm || 1) * stepM);
        const gz = (eD - eU) / ((yp - ym || 1) * stepM);
        const nLen = Math.hypot(-gx, 1, -gz) || 1;
        const nx = -gx / nLen;
        const ny = 1 / nLen;
        const nz = -gz / nLen;
        const ndotl = Math.max(0, nx * sunDir.x + ny * sunDir.y + nz * sunDir.z);

        let sunVis = 1.0;
        if (sunMaskData && sunMaskW > 0) {
          // the mask has one texel per 2 x 2 DTM cells (and may still be baking: then all lit)
          const smIdx = ((y >> 1) * sunMaskW + (x >> 1)) * 4;
          sunVis = (sunMaskData[smIdx] ?? 255) / 255;
        }

        const shade = (0.44 + 0.78 * ndotl) * (0.76 + 0.24 * sunVis);
        const baseRgb = sampleMarsRamp((eC - minE) / spanE);

        let r = baseRgb[0] * shade;
        let g = baseRgb[1] * shade;
        let b = baseRgb[2] * shade;

        // Elevation contour lines (20 m minor, 60 m major)
        const minorBand = Math.floor((eC - minE) / minorInterval);
        const majorBand = Math.floor((eC - minE) / majorInterval);
        const minNeighborBand = Math.min(
          Math.floor((eR - minE) / minorInterval),
          Math.floor((eD - minE) / minorInterval)
        );
        const majNeighborBand = Math.min(
          Math.floor((eR - minE) / majorInterval),
          Math.floor((eD - minE) / majorInterval)
        );
        if (majorBand !== majNeighborBand) {
          r = r * 0.52 + 245 * 0.48;
          g = g * 0.52 + 206 * 0.48;
          b = b * 0.52 + 166 * 0.48;
        } else if (minorBand !== minNeighborBand) {
          r *= 0.74;
          g *= 0.74;
          b *= 0.74;
        }

        const p = (y * w + x) * 4;
        eImg.data[p] = Math.max(0, Math.min(255, Math.round(r)));
        eImg.data[p + 1] = Math.max(0, Math.min(255, Math.round(g)));
        eImg.data[p + 2] = Math.max(0, Math.min(255, Math.round(b)));
        eImg.data[p + 3] = 255;

        // Hazard overlay: blend slope class on top of Martian hillshade
        const slopeDeg = Math.atan(Math.hypot(gx, gz)) * (180 / Math.PI);
        let hr = 34;
        let hg = 197;
        let hb = 94;
        let alpha = 0.28;
        if (slopeDeg > 20) {
          hr = 168;
          hg = 85;
          hb = 247;
          alpha = 0.62;
        } else if (slopeDeg > 15) {
          hr = 239;
          hg = 68;
          hb = 68;
          alpha = 0.5;
        } else if (slopeDeg > 10) {
          hr = 245;
          hg = 158;
          hb = 11;
          alpha = 0.38;
        }
        hImg.data[p] = Math.round(r * (1 - alpha) + hr * alpha);
        hImg.data[p + 1] = Math.round(g * (1 - alpha) + hg * alpha);
        hImg.data[p + 2] = Math.round(b * (1 - alpha) + hb * alpha);
        hImg.data[p + 3] = 255;
      }
    }

    eCtx.putImageData(eImg, 0, 0);
    hCtx.putImageData(hImg, 0, 0);
    return { elevCanvas, hazCanvas, minE, maxE };
  })();

  function syncMapStaticText() {
    const tr = isTrLang();
    const tEl = document.getElementById("hud-map-title");
    const sEl = document.getElementById("hud-map-sub");
    const etEl = document.getElementById("hud-map-elev-title");
    const cnEl = document.getElementById("hud-map-contour-note");
    const ktEl = document.getElementById("hud-map-key-title");
    if (tEl) {
      tEl.textContent = tr
        ? "GALE KRATERİ / MOUNT SHARP — 3B YÜKSELTİ HARİTASI"
        : "GALE CRATER / MOUNT SHARP — 3D ELEVATION MAP";
    }
    if (sEl) {
      sEl.textContent = tr
        ? "HiRISE 1 m DTM KABARTMA · IŞINLANMAK İÇİN HARİTAYA TIKLA · KENARLAR KARŞIYA BAĞLANIR"
        : "HiRISE 1 m DTM RELIEF · CLICK ANY POINT TO TELEPORT · OPPOSITE EDGES WRAP";
    }
    if (etEl) etEl.textContent = tr ? "MOLA 3B YÜKSELTİ (m)" : "MOLA 3D ELEVATION (m)";
    if (cnEl) {
      cnEl.textContent = tr
        ? "20 m ara / 60 m ana eşyükselti eğrileri · canlı 3B arazi normalleri ve güneş açısı ile gölgelenmiş."
        : "20 m minor / 60 m major contours · shaded by live 3D terrain normals & sun angle.";
    }
    if (ktEl) ktEl.textContent = tr ? "İŞARETLER VE SINIR" : "MARKERS & WRAP";
    if (mapModeBtn) {
      mapModeBtn.textContent =
        mapLayerMode === "elevation"
          ? tr
            ? "Katman: Yükselti 3B"
            : "Layer: Elevation 3D"
          : tr
            ? "Katman: Eğim Tehlikesi"
            : "Layer: Slope Hazard";
    }
    if (mapCloseBtn) mapCloseBtn.textContent = tr ? "Kapat (M)" : "Close (M)";
    if (mapConfirmQEl) {
      mapConfirmQEl.textContent = tr ? "Buraya ışınlanmak istiyor musun?" : "Do you want to teleport here?";
    }
    if (mapConfirmYesBtn) mapConfirmYesBtn.textContent = tr ? "Evet, Işınlan" : "Yes, Teleport";
    if (mapConfirmNoBtn) mapConfirmNoBtn.textContent = tr ? "İptal" : "Cancel";
    if (btnMap) btnMap.textContent = isMapOpen() ? (tr ? "Harita: Açık" : "Map (M): ON") : tr ? "Harita (M)" : "Map (M)";
    syncGlobeText(tr, tEl, sEl, etEl, cnEl);
  }

  // legend values of the local strip, kept so the globe scope can swap them and back
  const legendEls = ["hud-map-elev-max", "hud-map-elev-mid", "hud-map-elev-min"].map((id) => document.getElementById(id));
  let localLegend = null;
  function syncGlobeText(tr, tEl, sEl, etEl, cnEl) {
    const isGlobe = mapScope === "globe";
    if (mapScopeBtn) {
      if (isGlobe) mapScopeBtn.textContent = tr ? "Görünüm: Küre" : "Scope: Globe";
      else mapScopeBtn.textContent = tr ? "Görünüm: Yerel" : "Scope: Local";
    }
    if (globeLayerBtn) {
      const L = globe?.layer || "mono";
      const names = tr
        ? { mono: "Katman: Siyah-beyaz", viking: "Katman: Viking renk", mola: "Katman: MOLA kabartma" }
        : { mono: "Layer: B/W", viking: "Layer: Viking colour", mola: "Layer: MOLA relief" };
      globeLayerBtn.textContent = names[L];
    }
    if (globeSunBtn) {
      const sun = globe ? globe.sunLit : true;
      if (sun) globeSunBtn.textContent = tr ? "Işık: Güneş" : "Light: Sun";
      else globeSunBtn.textContent = tr ? "Işık: Kask lambası" : "Light: Visor lamp";
    }
    if (!localLegend) localLegend = legendEls.map((el) => el?.textContent || "");
    legendEls.forEach((el, i) => {
      if (el) el.textContent = isGlobe ? ["+21,229 m", "+6,500 m", "-8,200 m"][i] : localLegend[i];
    });
    if (!isGlobe) return;
    if (tEl) tEl.textContent = tr ? "MARS — KÜRESEL 3B HARİTA" : "MARS — GLOBAL 3D MAP";
    if (sEl) {
      sEl.textContent = tr
        ? "MOLA YÜKSELTİ ×9 · VIKING MOZAİĞİ · GALE'DE 15:00 GÜNEŞİ · SÜRÜKLE · TEKER · TIKLA"
        : "MOLA RELIEF ×9 · VIKING MOSAIC · SUN AT 15:00 GALE TIME · DRAG · WHEEL · CLICK";
    }
    if (etEl) etEl.textContent = tr ? "MOLA KÜRESEL YÜKSELTİ (m)" : "MOLA GLOBAL ELEVATION (m)";
    if (cnEl) {
      cnEl.textContent = tr
        ? "NASA MGS MOLA MEGDR (8 px/derece), yarıçap ×9 abartılı; gece/gündüz sınırı Mars mevsimine göre gerçek güneş konumundan."
        : "NASA MGS MOLA MEGDR (8 px/deg), radius exaggerated ×9; the day/night line comes from the real Sun position for the Mars season.";
    }
  }

  function formatPointMetrics(tx, tz) {
    const wx = wrapSceneCoord(tx, worldW).val;
    const wz = wrapSceneCoord(tz, worldH).val;
    const lon = xToLon(wx);
    const lat = zToLat(wz);
    const elevMola = elevMin + sampleElevSceneY(wx, wz);
    const slopeDeg = computeLocalSlopeDeg(wx, wz);
    const distM = Math.hypot(wx - player.x, wz - player.z);
    return { tx: wx, tz: wz, lon, lat, elevMola, slopeDeg, distM };
  }

  function updatePendingConfirmCard() {
    if (!mapConfirmEl) return;
    if (!pendingTeleport) {
      mapConfirmEl.style.display = "none";
      return;
    }
    const tr = isTrLang();
    syncMapStaticText();
    const { lon, lat, elevMola, slopeDeg, distM } = pendingTeleport;
    const slopeWarn =
      slopeDeg > 20
        ? tr
          ? " · UYARI: >20° DİK YAMAÇ!"
          : " · WARNING: >20° STEEP CLIFF!"
        : "";
    if (mapConfirmMetaEl) {
      mapConfirmMetaEl.innerHTML =
        `${Math.abs(lat).toFixed(5)}°${lat < 0 ? "S" : "N"}, ${lon.toFixed(5)}°E<br/>` +
        `<strong>${tr ? "3B Yükselti" : "3D Elevation"}:</strong> ${elevMola.toFixed(1)} m MOLA<br/>` +
        `<strong>${tr ? "Eğim" : "Slope"}:</strong> ${slopeDeg.toFixed(1)}°${slopeWarn}<br/>` +
        `<strong>${tr ? "Mesafe" : "Distance"}:</strong> ${distM.toFixed(0)} m`;
    }
    mapConfirmEl.style.display = "block";
  }

  function setMapOpen(open) {
    if (!mapOverlayEl) return;
    const next = Boolean(open);
    mapOverlayEl.classList.toggle("open", next);
    if (next) {
      keys.clear();
      dragging = false;
      if (globe) {
        const here = { lon: xToLon(player.x), lat: zToLat(player.z) };
        globe.setPlayer(here.lon, here.lat);
        if (!globeFocused) {
          globe.focus(here.lon, here.lat + 4, 1);
          globeFocused = true;
        }
      }
      setMapScope(mapScope);
    } else {
      pendingTeleport = null;
      hoverTarget = null;
      if (mapConfirmEl) mapConfirmEl.style.display = "none";
      showGlobeInfo(null);
      globe?.close();
      syncMapStaticText();
    }
  }

  btnMap?.addEventListener("click", () => setMapOpen(!isMapOpen()));
  mapCloseBtn?.addEventListener("click", () => setMapOpen(false));
  mapOverlayEl?.addEventListener("click", (e) => {
    if (e.target === mapOverlayEl) setMapOpen(false);
  });
  mapModeBtn?.addEventListener("click", () => {
    mapLayerMode = mapLayerMode === "elevation" ? "hazard" : "elevation";
    syncMapStaticText();
    renderTacticalMap();
  });
  mapConfirmYesBtn?.addEventListener("click", () => {
    if (!pendingTeleport) return;
    teleportToLocal(pendingTeleport.tx, pendingTeleport.tz, { keepYaw: true });
    setMapOpen(false);
  });
  mapConfirmNoBtn?.addEventListener("click", () => {
    pendingTeleport = null;
    updatePendingConfirmCard();
    renderTacticalMap();
  });

  if (mapCanvasEl) {
    const pointerToLocal = (e) => {
      const rect = mapCanvasEl.getBoundingClientRect();
      const u = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
      const v = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
      return { tx: (u - 0.5) * worldW, tz: (v - 0.5) * worldH };
    };
    mapCanvasEl.addEventListener("mousemove", (e) => {
      const { tx, tz } = pointerToLocal(e);
      hoverTarget = formatPointMetrics(tx, tz);
      if (mapHoverEl) {
        const tr = isTrLang();
        const { lat, lon, elevMola, slopeDeg, distM } = hoverTarget;
        mapHoverEl.textContent =
          `${Math.abs(lat).toFixed(5)}°${lat < 0 ? "S" : "N"}, ${lon.toFixed(5)}°E · ` +
          `${tr ? "YÜKSELTİ" : "3D ELEV"}: ${elevMola.toFixed(1)} m · ` +
          `${tr ? "EĞİM" : "SLOPE"}: ${slopeDeg.toFixed(1)}° · ${distM.toFixed(0)} m`;
      }
      renderTacticalMap();
    });
    mapCanvasEl.addEventListener("mouseleave", () => {
      hoverTarget = null;
      renderTacticalMap();
    });
    mapCanvasEl.addEventListener("click", (e) => {
      const { tx, tz } = pointerToLocal(e);
      pendingTeleport = formatPointMetrics(tx, tz);
      updatePendingConfirmCard();
      renderTacticalMap();
    });

    // ---- Controller on the local map ----
    // Left stick moves a crosshair over the map and updates the readout; A picks the point (the
    // confirm card appears); A again teleports; B cancels the card, then closes the map.
    const padCross = document.createElement("div");
    padCross.className = "pad-crosshair";
    padCross.innerHTML = '<div class="ring"></div>';
    (mapCanvasEl.parentElement || document.body).appendChild(padCross);
    let padCx = 0.5; // crosshair as a fraction of the canvas
    let padCy = 0.5;
    let padLast = performance.now();
    const padFrame = (now) => {
      const dt = Math.min(0.1, (now - padLast) / 1000);
      padLast = now;
      const live = isMapOpen() && gamepad.connected && !document.getElementById("pad-setup")?.classList.contains("open");
      padCross.classList.toggle("on", live && !pendingTeleport);
      if (live && mapScope === "globe" && globe) {
        // left stick: crosshair + readout; right stick: spin; LT / RT: zoom
        const mv = gamepad.move();
        if (mv.x || mv.y) {
          padCx = Math.max(0.02, Math.min(0.98, padCx + mv.x * 0.5 * dt));
          padCy = Math.max(0.02, Math.min(0.98, padCy - mv.y * 0.5 * dt));
          const hit = globe.pickNormalized(padCx, padCy);
          if (mapHoverEl) mapHoverEl.textContent = hit ? `${globeReadout(hit)} · A` : globeHoverHint();
        }
        const lk = gamepad.look();
        if (lk.x || lk.y) globe.spin((lk.x * 70 * dt) / globe.zoom, (lk.y * 70 * dt) / globe.zoom);
        const zIn = gamepad.buttons[7] || 0;
        const zOut = gamepad.buttons[6] || 0;
        if (zIn > 0.05 || zOut > 0.05) globe.zoomBy(Math.exp((zIn - zOut) * 1.4 * dt));
        padCross.style.left = `${padCx * 100}%`;
        padCross.style.top = `${padCy * 100}%`;
      } else if (live) {
        const mv = gamepad.move();
        if (mv.x || mv.y) {
          padCx = Math.max(0.02, Math.min(0.98, padCx + mv.x * 0.5 * dt));
          padCy = Math.max(0.02, Math.min(0.98, padCy - mv.y * 0.5 * dt));
          if (!pendingTeleport) {
            hoverTarget = formatPointMetrics((padCx - 0.5) * worldW, (padCy - 0.5) * worldH);
            if (mapHoverEl) {
              const { lat, lon, elevMola, slopeDeg } = hoverTarget;
              mapHoverEl.textContent =
                `${Math.abs(lat).toFixed(5)}°${lat < 0 ? "S" : "N"}, ${lon.toFixed(5)}°E · ` +
                `${elevMola.toFixed(1)} m · ${slopeDeg.toFixed(1)}° · A`;
            }
            renderTacticalMap();
          }
        }
        padCross.style.left = `${padCx * 100}%`;
        padCross.style.top = `${padCy * 100}%`;
      }
      requestAnimationFrame(padFrame);
    };
    requestAnimationFrame(padFrame);

    gamepad.onPress(({ button, actions }) => {
      if (!isMapOpen()) return;
      if (document.getElementById("pad-setup")?.classList.contains("open")) return;
      if (!document.getElementById("start-screen")?.classList.contains("hidden")) return;
      if (actions.includes("map")) return; // View closes the map in app.js
      if (actions.includes("pin")) return setMapScope(mapScope === "globe" ? "local" : "globe");
      if (mapScope === "globe") {
        if (actions.includes("texture")) {
          globe?.cycleLayer();
          syncMapStaticText();
        } else if (button === 0) {
          if (globePick && globePick.walkKm < LOCAL_REACH_KM) setMapScope("local");
          else showGlobeInfo(globe?.pickNormalized(padCx, padCy) || null);
        } else if (button === 1) {
          if (globePick) showGlobeInfo(null);
          else setMapOpen(false);
        }
        return;
      }
      if (button === 0) {
        if (pendingTeleport) mapConfirmYesBtn?.click();
        else {
          pendingTeleport = formatPointMetrics((padCx - 0.5) * worldW, (padCy - 0.5) * worldH);
          updatePendingConfirmCard();
          renderTacticalMap();
        }
      } else if (button === 1) {
        if (pendingTeleport) mapConfirmNoBtn?.click();
        else setMapOpen(false);
      }
    });
  }

  function renderTacticalMap() {
    if (!mapCtx || !mapCanvasEl || !isMapOpen() || mapScope === "globe") return;
    const W = mapCanvasEl.width;
    const H = mapCanvasEl.height;
    const baseImg = mapLayerMode === "hazard" ? mapBases.hazCanvas : mapBases.elevCanvas;

    mapCtx.clearRect(0, 0, W, H);
    mapCtx.imageSmoothingEnabled = true;
    mapCtx.drawImage(baseImg, 0, 0, W, H);

    // Subtle Martian coordinate grid
    mapCtx.strokeStyle = "rgba(255, 224, 194, 0.14)";
    mapCtx.lineWidth = 1;
    for (let k = 1; k < 4; k++) {
      const p = (k / 4) * W;
      mapCtx.beginPath();
      mapCtx.moveTo(p, 0);
      mapCtx.lineTo(p, H);
      mapCtx.moveTo(0, p);
      mapCtx.lineTo(W, p);
      mapCtx.stroke();
    }

    // Wrap-around border frame cue
    mapCtx.save();
    mapCtx.setLineDash([6, 5]);
    mapCtx.strokeStyle = "rgba(245, 198, 146, 0.45)";
    mapCtx.lineWidth = 2;
    mapCtx.strokeRect(3, 3, W - 6, H - 6);
    mapCtx.restore();

    const toCanvasXY = (x, z) => [
      Math.max(0, Math.min(W, (x / worldW + 0.5) * W)),
      Math.max(0, Math.min(H, (z / worldH + 0.5) * H)),
    ];

    // Science stops + start mast
    if (stops?.features) {
      stops.features.forEach((f, idx) => {
        const [lon, lat] = f.geometry.coordinates;
        const [cx, cy] = toCanvasXY(lonToX(lon), latToZ(lat));
        const isStart = idx === 0 || f.properties?.kind === "habitat";
        mapCtx.beginPath();
        mapCtx.arc(cx, cy, isStart ? 6 : 5, 0, Math.PI * 2);
        mapCtx.fillStyle = isStart ? "#4ade80" : "#ffffff";
        mapCtx.fill();
        mapCtx.lineWidth = 1.5;
        mapCtx.strokeStyle = "#000000";
        mapCtx.stroke();

        const rawName = (f.properties?.name || f.properties?.id || "").split("(")[0].trim();
        mapCtx.font = "600 10px monospace";
        mapCtx.fillStyle = "rgba(0, 0, 0, 0.78)";
        const tw = mapCtx.measureText(rawName).width;
        const lx = Math.min(W - tw - 12, cx + 9);
        const ly = Math.max(14, cy - 6);
        mapCtx.fillRect(lx - 3, ly - 9, tw + 6, 13);
        mapCtx.fillStyle = isStart ? "#bbf7d0" : "#f8fafc";
        mapCtx.fillText(rawName, lx, ly + 1);
      });
    }

    // Pending teleport crosshair
    if (pendingTeleport) {
      const [tx, ty] = toCanvasXY(pendingTeleport.tx, pendingTeleport.tz);
      mapCtx.save();
      mapCtx.strokeStyle = "#fbbf24";
      mapCtx.lineWidth = 2;
      mapCtx.beginPath();
      mapCtx.arc(tx, ty, 10, 0, Math.PI * 2);
      mapCtx.moveTo(tx - 15, ty);
      mapCtx.lineTo(tx + 15, ty);
      mapCtx.moveTo(tx, ty - 15);
      mapCtx.lineTo(tx, ty + 15);
      mapCtx.stroke();
      mapCtx.restore();
    } else if (hoverTarget) {
      const [hx, hy] = toCanvasXY(hoverTarget.tx, hoverTarget.tz);
      mapCtx.save();
      mapCtx.strokeStyle = "rgba(255, 255, 255, 0.55)";
      mapCtx.lineWidth = 1;
      mapCtx.beginPath();
      mapCtx.arc(hx, hy, 7, 0, Math.PI * 2);
      mapCtx.stroke();
      mapCtx.restore();
    }

    // Astronaut live position + gaze cone (yaw=0 -> North -Z -> canvas UP)
    const [ax, ay] = toCanvasXY(player.x, player.z);
    const totalYaw = autoYaw + userYaw;
    const dirX = -Math.sin(totalYaw);
    const dirY = -Math.cos(totalYaw);
    const coneAngle = Math.atan2(dirY, dirX);

    mapCtx.save();
    mapCtx.beginPath();
    mapCtx.moveTo(ax, ay);
    mapCtx.arc(ax, ay, 36, coneAngle - 0.55, coneAngle + 0.55);
    mapCtx.closePath();
    const grad = mapCtx.createRadialGradient(ax, ay, 2, ax, ay, 36);
    grad.addColorStop(0, "rgba(56, 189, 248, 0.52)");
    grad.addColorStop(1, "rgba(56, 189, 248, 0.0)");
    mapCtx.fillStyle = grad;
    mapCtx.fill();

    mapCtx.beginPath();
    mapCtx.arc(ax, ay, 6, 0, Math.PI * 2);
    mapCtx.fillStyle = "#38bdf8";
    mapCtx.fill();
    mapCtx.lineWidth = 2;
    mapCtx.strokeStyle = "#ffffff";
    mapCtx.stroke();
    mapCtx.restore();

    // Scale bar & North indicator
    const pxPer500m = (500 / worldW) * W;
    mapCtx.fillStyle = "rgba(10, 6, 4, 0.75)";
    mapCtx.fillRect(10, H - 30, pxPer500m + 18, 20);
    mapCtx.strokeStyle = "#f7dec4";
    mapCtx.lineWidth = 2;
    mapCtx.beginPath();
    mapCtx.moveTo(18, H - 15);
    mapCtx.lineTo(18 + pxPer500m, H - 15);
    mapCtx.stroke();
    mapCtx.fillStyle = "#f7dec4";
    mapCtx.font = "bold 10px monospace";
    mapCtx.fillText("500 m", 18, H - 19);
    mapCtx.fillText("N ↑", W - 32, 20);
  }

  let goldVisor = 0;
  let optZoom = 1;
  let nextPovStop = null;

  window.addEventListener("keydown", (e) => {
    if (!hudView.classList.contains("active")) return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
    const modalOpen = document.getElementById("modal-backdrop")?.classList.contains("open");
    const menuOpen = !document.getElementById("start-screen")?.classList.contains("hidden");
    if (modalOpen || menuOpen) return;

    const k = e.key.toLowerCase();
    if (k === "m" && !e.repeat) {
      e.preventDefault();
      setMapOpen(!isMapOpen());
      return;
    }
    if (e.key === "Escape" && isMapOpen()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      setMapOpen(false);
      return;
    }
    if (isMapOpen()) return;

    if (k === "g" && !e.repeat) {
      goldVisor = goldVisor > 0.5 ? 0 : 1;
      return;
    }
    if (k === "z" && !e.repeat) {
      optZoom = optZoom === 1 ? 3 : optZoom === 3 ? 8 : 1;
      const reticle = document.getElementById("hud-zoom-reticle");
      const readout = document.getElementById("hud-zoom-readout");
      if (reticle) reticle.hidden = optZoom === 1;
      if (readout) readout.textContent = `${optZoom}×`;
      return;
    }

    keys.add(k);
    if (k === "p") {
      dropLocalPing("EVA Waypoint");
    }
    if (k === " ") {
      e.preventDefault();
      if (phys.grounded) phys.jumpQueued = true;
    }
  });

  // Controller buttons in the 3D view (layout and rebinding: shared/gamepad.js + setup screen).
  // Menus, dialogs and the map are handled in app.js / the map layer.
  gamepad.onPress(({ actions }) => {
    if (!hudView.classList.contains("active")) return;
    if (document.getElementById("pad-setup")?.classList.contains("open")) return;
    if (!document.getElementById("start-screen")?.classList.contains("hidden")) return;
    if (document.getElementById("modal-backdrop")?.classList.contains("open")) return;
    if (isMapOpen()) return;
    for (const a of actions) {
      if (a === "jump") {
        if (phys.grounded) phys.jumpQueued = true;
      } else if (a === "pin") dropLocalPing("Landmark");
      else if (a === "texture") document.getElementById("hud-tex")?.click();
      else if (a === "pov") document.getElementById("hud-pov-btn")?.click();
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
    const frac = totalDist > 0 ? sM / totalDist : 0;
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
      viewLabelEl.textContent = `GALE CRATER · MOUNT SHARP · ${Math.abs(lat).toFixed(4)}°${latHem} ${lon.toFixed(4)}°E`;
    }

    const { stop: nextStop, distanceM: nextStopDist, mode: nextMode } = resolveNextStopAlongRoute(
      activeRoute,
      stops,
      sM,
      [lon, lat]
    );

    const o2Pct = Math.max(0, 100 * (1 - frac)); // illustrative linear placeholder

    document.getElementById("hud-dist").textContent = `${sM.toFixed(1)} m`;
    const stopDistLabel = nextMode === "leg" ? "next stop" : "nearest stop";
    document.getElementById("hud-dist-sub").textContent = `remaining ${rem.toFixed(1)} m · ${stopDistLabel} ${
      nextStopDist < Infinity ? nextStopDist.toFixed(0) + " m" : "—"
    }`;
    document.getElementById("hud-slope").textContent = `${Number(slopeDeg).toFixed(1)}°`;
    const badge = document.getElementById("hud-slope-badge");
    if (badge) {
      badge.textContent = slopeClass.id;
      badge.className = `slope-badge slope-${slopeClass.id}`;
    }
    document.getElementById("hud-next-stop").textContent = nextStop?.properties?.name || "—";
    document.getElementById("hud-next-kind").textContent = nextStop?.properties?.kind || "—";
    document.getElementById("hud-o2").textContent = `${o2Pct.toFixed(1)}%`;
    const o2Fill = document.getElementById("hud-o2-fill");
    if (o2Fill) o2Fill.style.width = `${o2Pct.toFixed(1)}%`;

    if (clockEl) {
      const t = Math.floor(sM / WALK_SPEED_MS);
      const hh = String(Math.floor(t / 3600)).padStart(2, "0");
      const mm = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
      const ss = String(t % 60).padStart(2, "0");
      clockEl.textContent = `LTST 15:00 · T+${hh}:${mm}:${ss}  (WALK-TIME PLACEHOLDER)`;
    }
    nextPovStop = nextStop;
  }

  let devCfg = loadDevSettings();
  let renderScale = 1;
  let frameAvg = 16;
  let lastScaleChange = 0;

  const onResize = () => {
    const w = wrap.clientWidth || window.innerWidth;
    const h = wrap.clientHeight || window.innerHeight - 44;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    const pr = renderer.getPixelRatio() * renderScale;
    rt.setSize(Math.max(1, Math.floor(w * pr)), Math.max(1, Math.floor(h * pr)));
    lensMat.uniforms.uResolution.value.set(w * pr, h * pr);
  };

  function applyDevSettings(cfg) {
    devCfg = cfg;
    const visorOverlay = document.querySelector(".visor-overlay");
    if (visorOverlay) {
      visorOverlay.classList.toggle("no-frame", !cfg.frameEffect);
      visorOverlay.classList.toggle("clean-hud", Boolean(cfg.cleanHud));
    }

    const strength = cfg.frameEffect ? cfg.frameStrength : 0.35;
    lensMat.uniforms.uFrameZoom.value = 1.0 - 0.04 * Math.min(1, strength);
    lensMat.uniforms.uDistort.value = 0.09 * strength;
    lensMat.uniforms.uAberration.value = 0.0035 * strength;
    lensMat.uniforms.uVignette.value = 0.85 * Math.max(0.45, strength);
    lensMat.uniforms.uGrain.value = (cfg.superGraphics ? 0.008 : 0.014) * Math.max(0.35, strength);
    lensMat.uniforms.uGold.value = goldVisor;
    lensMat.uniforms.uOptZoom.value = optZoom;

    if (camera.fov !== cfg.fov) {
      camera.fov = cfg.fov;
      camera.updateProjectionMatrix();
    }

    const wantSuper = Boolean(cfg.superGraphics);
    const targetPr = Math.min(window.devicePixelRatio || 1, wantSuper ? 2.0 : 1.25);
    renderer.setPixelRatio(targetPr);
    renderScale = wantSuper ? 1.25 : 1.0;

    const wantSamples = wantSuper ? 4 : 2;
    if (rtSamples !== wantSamples) {
      rtSamples = wantSamples;
      rt.dispose();
      rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: wantSamples });
      lensMat.uniforms.tDiffuse.value = rt.texture;
    }

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

    terrainMat.normalScale.set(wantSuper ? 0.95 : 0.55, wantSuper ? 0.95 : 0.55);
    superDetailUniform.value = wantSuper ? 1.0 : 0.0;
    sun.intensity = (wantSuper ? 3.95 : 3.6) * (sunState.fluxWm2 / 590);
    hemiLight.intensity = wantSuper ? 0.28 : 0.22;
    renderer.toneMappingExposure = wantSuper ? 1.06 : 1.0;
    rockField.group.visible = wantSuper;
    galeVista.visible = wantSuper;
    fieldKits.visible = wantSuper;
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
    onResize();
  }

  // Adaptive resolution: the 3D scene renders into rt, so its size can drop when frames are slow
  // and come back when there is headroom. Disabled when Experimental Super Graphics is active.
  function adaptResolution(frameMs, now) {
    if (devCfg.superGraphics) return;
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

  const pushApart = (targetPos) => {
    if (!targetPos) return;
    const pdx = freePos.x - targetPos.x;
    const pdz = freePos.z - targetPos.z;
    const pdy = Math.abs((player.init ? player.y : sampleElevSceneY(freePos.x, freePos.z)) - targetPos.y);
    const pDist = Math.hypot(pdx, pdz);
    if (pdy < ASTRONAUT_HEIGHT_M * 0.9 && pDist < PARTNER_COLLISION_R) {
      if (pDist > 1e-4) {
        freePos.x = targetPos.x + (pdx / pDist) * PARTNER_COLLISION_R;
        freePos.z = targetPos.z + (pdz / pDist) * PARTNER_COLLISION_R;
      } else {
        freePos.x -= fwd.x * PARTNER_COLLISION_R;
        freePos.z -= fwd.z * PARTNER_COLLISION_R;
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

    // controller look (right stick), off while a menu, dialog, setup screen or the map has the pad
    const padBusy =
      document.getElementById("pad-setup")?.classList.contains("open") ||
      !document.getElementById("start-screen")?.classList.contains("hidden") ||
      document.getElementById("modal-backdrop")?.classList.contains("open") ||
      isMapOpen();
    const lk = padBusy ? { x: 0, y: 0 } : gamepad.look();
    if (lk.x || lk.y) {
      userYaw -= lk.x * 2.6 * dt;
      pitch = Math.max(-1.35, Math.min(1.42, pitch + lk.y * 1.9 * dt));
    }

    // progress along the route = the route point nearest to you (for the HUD only)
    alongM = nearestAlongRoute(freePos.x, freePos.z, alongM);
    const sample = sampleAlongRoute(routeCoords, cumDist, toGeomDist(alongM));
    let px = player.x;
    let pz = player.z;
    const prevX = player.x;
    const prevZ = player.z;
    if (freeRoam) {
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
        if (moveDir.lengthSq() > 0) moveDir.normalize();
        const strict = document.getElementById("toggle-strict-15")?.checked;
        stepPhysicsWorld(
          phys,
          dt,
          {
            wishX: moveDir.x,
            wishZ: moveDir.z,
            run: keys.has("shift") || (!padBusy && gamepad.isDown("run")),
            speedMultiplier: (devCfg.speedMultiplier || 1) * stickPace,
            slopeLimitDeg: strict ? 15 : 20,
            latDeg: zToLat(phys.z),
          },
          heightEnv
        );
      }
      const wx = wrapSceneCoord(phys.x, worldW);
      const wz = wrapSceneCoord(phys.z, worldH);
      if (wx.wrapped || wz.wrapped) {
        phys.x = wx.val;
        phys.z = wz.val;
        phys.y = sampleElevSceneY(phys.x, phys.z);
        phys.vy = 0;
        phys.grounded = true;
        justTeleportedOrWrapped = true;
        const wLon = xToLon(phys.x);
        const wLat = zToLat(phys.z);
        const nearestGeomS = closestAlongM(routeCoords, cumDist, wLon, wLat);
        alongM = geomTotalDist > 0 ? (nearestGeomS / geomTotalDist) * totalDist : 0;
        const dirs = [];
        if (wx.crossedPosToNeg) dirs.push(isTrLang() ? "DOĞU → BATI" : "EAST → WEST");
        else if (wx.crossedNegToPos) dirs.push(isTrLang() ? "BATI → DOĞU" : "WEST → EAST");
        if (wz.crossedPosToNeg) dirs.push(isTrLang() ? "GÜNEY → KUZEY" : "SOUTH → NORTH");
        else if (wz.crossedNegToPos) dirs.push(isTrLang() ? "KUZEY → GÜNEY" : "NORTH → SOUTH");
        showWrapNotice(
          (isTrLang() ? "HARİTA SINIRI GEÇİLDİ · KARŞI KENAR: " : "MAP BOUNDARY WRAPPED: ") +
            dirs.join(" · ")
        );
      }

      freePos.set(phys.x, phys.y, phys.z);
      if (partner && partner.group.visible) pushApart(partner.group.position);
      for (const remote of remoteAvatars.values()) pushApart(remote.group.position);
      if (freePos.x !== phys.x || freePos.z !== phys.z) {
        phys.x = freePos.x;
        phys.z = freePos.z;
        phys.vx *= 0.2;
        phys.vz *= 0.2;
      }
      syncPlayerFromPhys();
      px = phys.x;
      pz = phys.z;
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
    }

    const yaw = autoYaw + userYaw;
    const movedXZ = Math.hypot(px - prevX, pz - prevZ);
    const mvx = px - prevX;
    const mvz = pz - prevZ;
    const step = !justTeleportedOrWrapped && movedXZ < 20 ? movedXZ : 0;
    justTeleportedOrWrapped = false;
    const groundSpeed = dt > 0 ? step / dt : 0;

    // boot dust: kicked up on take-off, a burst on landing (scaled by impact speed)
    if (movedXZ >= 20) dustFx.clear(); // teleport / wrap: old puffs would hang in the wrong place
    if (movedXZ > 1e-5 && movedXZ < 20) _dustMove.set(mvx, 0, mvz).normalize();
    else _dustMove.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    if (fxWasGrounded !== player.grounded && movedXZ < 20) {
      const gy = sampleElevSceneY(px, pz);
      const n = sampleNormal(px, pz);
      _dustPos.set(px, gy, pz);
      _dustNrm.set(n.x, n.y, n.z);
      if (!player.grounded) dustFx.emitTakeoff(_dustPos, _dustNrm, _dustMove);
      else dustFx.emitLanding(_dustPos, _dustNrm, Math.max(1.6, phys.impactSpeed || 2.4), _dustMove);
    }
    fxWasGrounded = player.grounded;
    lensMat.uniforms.uDust.value = Math.min(1, lensMat.uniforms.uDust.value + step / 650);

    self.group.position.set(px, player.y, pz);
    self.group.rotation.y = yaw;
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
    self.update(dt, step, groundSpeed, !player.grounded, gaitDir, {
      crouch: phys.crouch,
      lean,
      brake,
      ...feet,
      onStrike: (side) => strikes.push(side),
    });
    self.group.updateMatrixWorld(true);
    for (const side of strikes) {
      const bone = side === "L" ? self.bones.footL : self.bones.footR;
      if (!bone) continue;
      bone.getWorldPosition(footPos);
      const gy = sampleElevSceneY(footPos.x, footPos.z);
      const n = sampleNormal(footPos.x, footPos.z);
      footsteps.play(side, phys.faciesId);
      footsteps.stamp(footPos.x, gy, footPos.z, n, yaw, phys.faciesId);
      _dustPos.set(footPos.x, gy, footPos.z);
      _dustNrm.set(n.x, n.y, n.z);
      dustFx.emitFootstep(_dustPos, _dustNrm, _dustMove, Math.min(1.6, 0.45 + groundSpeed / 1.6));
    }

    // helmet camera at the visor, with only a few millimetres of walking sway
    const ph = self.phase ?? 0;
    const amt = Math.min(1, self.amount ?? 0);
    fwd.set(0, 0, -1).applyAxisAngle(UP, yaw);
    right.set(1, 0, 0).applyAxisAngle(UP, yaw);
    const swayY = Math.sin(ph * 2) * 0.004 * amt;
    const swayX = Math.sin(ph) * 0.003 * amt;
    const micro = (f, a) => Math.sin(clockT * f) * a + Math.sin(clockT * f * 2.17 + 1.3) * a * 0.5;
    // looking down tips the head forward a little, like a real neck
    const tip = Math.max(0, -pitch);
    const eyeFwd = EYE_FORWARD_M + tip * 0.1;
    camera.position.set(
      px + fwd.x * eyeFwd + right.x * swayX,
      player.y + EYE_HEIGHT_M - phys.crouch - tip * 0.07 + swayY,
      pz + fwd.z * eyeFwd + right.z * swayX
    );
    camera.rotation.order = "YXZ";
    camera.rotation.y = yaw + micro(0.6, 0.0007);
    camera.rotation.x = pitch + micro(0.9, 0.0006);
    camera.rotation.z = Math.sin(ph) * 0.0025 * amt;

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

    // sun, moons and shadow box follow the walker
    const texel = (2 * shadowHalfM) / shadowMapPx;
    const groundY = sampleElevSceneY(px, pz);
    sun.target.position.set(Math.round(px / texel) * texel, Math.round(groundY / texel) * texel, Math.round(pz / texel) * texel);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 400);
    sky.position.copy(camera.position);
    skyMoons.position.copy(camera.position);
    celestial.group.position.copy(camera.position);
    updateMoons(clockT, camera.position);
    footsteps.update(dt, phys.g || surfaceG);
    rockField.update(px, pz, sampleElevSceneY, Boolean(devCfg.superGraphics));
    dustDevil.update(dt, px, pz, groundY, Boolean(devCfg.dustDevil));
    dustFx.update(dt, camera, sunTransit);
    windDust.setPixelScale(renderer.domElement.height);
    windDust.update(dt, camera, devCfg.windDust === false ? 0 : 1);
    const tauDim = Math.exp(-0.28 * ((devCfg.dustTau ?? 0.5) - 0.5));
    sun.intensity = (devCfg.superGraphics ? 3.95 : 3.6) * (sunState.fluxWm2 / 590) * tauDim * sunTransit;

    // the HUD text only needs ~10 updates a second
    hudTimer += dt;
    if (hudTimer > 0.1) {
      hudTimer = 0;
      const metW = metabolicPowerW({
        eta: phys.eta,
        gMs2: phys.g || surfaceG,
        speedMs: groundSpeed,
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
    }
    curvAnchor.value.set(camera.position.x, camera.position.z);
    followEndless(camera.position);
    if (isMapOpen()) renderTacticalMap();

    adaptResolution(dt * 1000, now);
    lensMat.uniforms.uTime.value = clockT;
    lensMat.uniforms.uGold.value = goldVisor;
    lensMat.uniforms.uOptZoom.value = optZoom;
    camera.getWorldDirection(lookDir);
    lensMat.uniforms.uGlint.value = Math.max(0, lookDir.dot(sunDir));
    const flicker = devCfg.frameEffect
      ? 1.0 + Math.sin(clockT * 0.7) * 0.015 * devCfg.frameStrength + Math.sin(clockT * 13.0) * 0.006 * devCfg.frameStrength
      : 1.0;
    lensMat.uniforms.uExposure.value = flicker;
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(lensScene, lensCam);
  }
  requestAnimationFrame(animate);
  loadingVeil?.classList.add("done");

  return {
    onResize: () => {
      onResize();
    },
    dropLocalPing,
    getLonLat: () => ({ lon: xToLon(player.x), lat: zToLat(player.z) }),
    /** View on the controller: open / close the 3D view's map overlay. */
    toggleMap: () => setMapOpen(!isMapOpen()),
    isMapOpen: () => isMapOpen(),
    syncAlongM: (s) => {
      alongM = Math.max(0, Math.min(totalDist, Number(s) || 0));
      if (freeRoam && btnFreeRoam) btnFreeRoam.click();
      if (scrubber) scrubber.value = alongM.toFixed(1);
    },
    teleportTo: (lon, lat) => {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      if (!freeRoam && btnFreeRoam) btnFreeRoam.click();
      teleportToLocal(lonToX(lon), latToZ(lat), { keepYaw: true });
    },
    cycleTex: () => setTexMode((texMode + 1) % TEX.length),
    openRoverPov: () => {
      const stop = nextPovStop;
      const entry =
        povIndex?.stops?.find((s) => s.stop_id === stop?.properties?.id) || povIndex?.stops?.[0];
      if (entry) onOpenPov(entry);
    },
  };
}
