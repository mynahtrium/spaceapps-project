/**
 * 3D helmet-cam view of the Mount Sharp walk (`web/hud/hud3d.js`).
 *
 * - Terrain: Backend's 8-bit RGB height-preview.png (value = R*256 + G) on the real 2 km tile,
 *   surrounded by mirrored copies so the ground never ends (copies are visual, not data).
 * - Astronaut: NASA 3D Resources spacesuit glTF, scaled to 1.80 m and rigged procedurally
 *   (astronaut-rig.js) with a distance-driven walk / run cycle. You see through a helmet camera;
 *   your own helmet is hidden, so looking down shows your legs and gloves. A second crew member
 *   walks ahead on the route (buddy EVA).
 * - Physics: Mars gravity (3.71 m/s^2), jumping, falling off drops, slower walking on steep ground.
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
import { createMarsDustSystem } from "./dust-fx.js";
import {
  MARS_WALK_STRIDE_M,
  MARS_WALK_VELOCITY_MS,
  computeFootstepDustIntensity,
  computeMarsCameraSway,
} from "./mars-gait.js";
import { lerpAngleRad } from "../shared/multiplayer.js";
import { createMartianPbrTextureSets } from "../map/MarsPbrTextures.js";
import { loadDevSettings, subscribeDevSettings } from "../shared/dev-settings.js";
import { marsDistanceM, normalizeLonDeg } from "../map/Geodesy.js";
import {
  MARS_LANDMARKS,
  MARS_CIRCUMFERENCE_M,
  MARS_RADIUS_MEAN_M,
  createMarsGlobalModel,
  decodeMolaDemRgba,
  localSceneXZToLonLat,
  lonLatToUnitVec,
  marsLonLatAltToLocalScene,
  sphereNormalAtLocal,
  stepOnMarsSphere,
  unitVecToLonLat,
} from "./mars-globe.js";
import {
  buildMolaPaletteGlsl,
  sampleMolaPaletteRgb,
  sampleSlopeHazardColor,
} from "./mars-terrain-colors.js";

const ASTRONAUT_HEIGHT_M = 1.8;
const EYE_HEIGHT_M = 1.64; // eye level inside the helmet of a 1.80 m astronaut
const EYE_FORWARD_M = 0.36; // at the visor, ahead of the suit's deep chest so the legs show when looking down
const WALK_SPEED_MS = MARS_WALK_VELOCITY_MS; // 0.80 m/s Mars 1/3g inverted-pendulum walk (1.08 m stride)
const RUN_SPEED_MS = 2.25; // light suited jog/bound (Shift) under Mars 1/3g gravity
const MARS_G = 3.71; // m/s^2
const JUMP_SPEED_MS = 1.7; // about 0.4 m apex under Mars gravity
const PARTNER_AHEAD_M = 6;
const PARTNER_COLLISION_R = 1.05; // solid suit + backpack + 0.36 m visor clearance
const TILE_RING = 2; // mirrored copies out to 2 tiles in every direction

// NASA 3D Resources models, tried in order (first one that loads wins). The Z2 suit
// (16.9 MB, NASA's Mars-oriented prototype) can be added in front of this list once downloaded
// to ./assets/nasa-3d/z2-spacesuit.glb.
const SUIT_MODELS = [{ url: "./assets/nasa-3d/mark-iii-spacesuit.glb", label: "NASA MARK III SUIT" }];

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
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
    col = mix(col, uGround, smoothstep(0.0, -0.08, h));
    float s = max(dot(d, normalize(uSunDir)), 0.0);
    // Mars: 0.35 deg sun disc + small bluish dust halo around sun, warm dust glow further out
    col += vec3(1.6, 1.65, 1.8) * smoothstep(0.999965, 0.999992, s);
    col += vec3(0.55, 0.62, 0.75) * pow(s, 900.0) * 6.0;
    col += vec3(0.40, 0.48, 0.62) * pow(s, 60.0) * 0.6;
    col += vec3(0.30, 0.18, 0.10) * pow(s, 6.0) * 0.35;
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
  uniform vec3 uBaseColor;
  uniform float uAlbedoBoost;
  varying vec3 vNormalW;
  varying vec3 vDirW;
  varying vec3 vLocalPos;

  vec3 marsSky(vec3 d) {
    float h = d.y;
    vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
    col = mix(col, uGround, smoothstep(0.0, -0.08, h));
    float s = max(dot(d, normalize(uSunDir)), 0.0);
    col += vec3(0.55, 0.62, 0.75) * pow(s, 900.0) * 6.0;
    col += vec3(0.40, 0.48, 0.62) * pow(s, 60.0) * 0.6;
    col += vec3(0.30, 0.18, 0.10) * pow(s, 6.0) * 0.35;
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

// Bodycam lens: barrel distortion, chromatic aberration, vignette, grain, slight flicker.
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
    d *= uFrameZoom; // zoom slightly when bezel distortion is active, 1.0 when frame effect is disabled
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
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(lum), col, 0.86); // bodycam sensors run a little desaturated
    if (uVignette > 0.001) {
      float vig = smoothstep(1.25, 0.25, length(c) * uVignette);
      col *= mix(0.25, 1.0, vig);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>

    float g = hash(vUv * uResolution + fract(uTime * 37.0) * 91.0) - 0.5;
    gl_FragColor.rgb += g * uGrain * (1.0 - 0.6 * dot(gl_FragColor.rgb, vec3(0.333)));
    gl_FragColor.rgb += 0.012 * sin(vUv.y * uResolution.y * 1.5 + uTime * 30.0) * uGrain;
  }
`;

export async function initHud3D(data, { onBackToPlanner, onOpenPov, mp = null, onLocalPose = null }) {
  const { costMap, route, stops, telemetry, dose, alerts, weather, povIndex, assets } = data;
  const isDemoSphere = Boolean(data.demoSafe);
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
  const midLatBounds = (bounds.south_lat_deg + bounds.north_lat_deg) * 0.5;
  const midLonBounds = (bounds.west_lon_deg + bounds.east_lon_deg) * 0.5;
  const worldW = isDemoSphere
    ? marsDistanceM([bounds.west_lon_deg, midLatBounds], [bounds.east_lon_deg, midLatBounds])
    : ncols * cellSizeM;
  const worldH = isDemoSphere
    ? marsDistanceM([midLonBounds, bounds.south_lat_deg], [midLonBounds, bounds.north_lat_deg])
    : nrows * cellSizeM;
  const [elevMin, elevMax] = costMap?.height_preview_elevation_range_m || [-3850.6, -3369.3];

  const sphereOrigin = {
    lonDeg: midLonBounds,
    latDeg: midLatBounds,
    elevM: elevMin,
  };

  // Convert [lon, lat] <-> local scene X, Z (metres relative to flat tile or current spherical patch)
  const lonToX = (lon, lat = sphereOrigin.latDeg) =>
    isDemoSphere
      ? marsLonLatAltToLocalScene(lon, lat, sphereOrigin.elevM, sphereOrigin.lonDeg, sphereOrigin.latDeg, sphereOrigin.elevM).x
      : ((lon - bounds.west_lon_deg) / (bounds.east_lon_deg - bounds.west_lon_deg) - 0.5) * worldW;
  const latToZ = (lat, lon = sphereOrigin.lonDeg) =>
    isDemoSphere
      ? marsLonLatAltToLocalScene(lon, lat, sphereOrigin.elevM, sphereOrigin.lonDeg, sphereOrigin.latDeg, sphereOrigin.elevM).z
      : (0.5 - (lat - bounds.south_lat_deg) / (bounds.north_lat_deg - bounds.south_lat_deg)) * worldH;
  const xToLon = (x, z = 0) =>
    isDemoSphere
      ? localSceneXZToLonLat(x, z, sphereOrigin.lonDeg, sphereOrigin.latDeg).lonDeg
      : bounds.west_lon_deg + (x / worldW + 0.5) * (bounds.east_lon_deg - bounds.west_lon_deg);
  const zToLat = (z, x = 0) =>
    isDemoSphere
      ? localSceneXZToLonLat(x, z, sphereOrigin.lonDeg, sphereOrigin.latDeg).latDeg
      : bounds.south_lat_deg + (0.5 - z / worldH) * (bounds.north_lat_deg - bounds.south_lat_deg);

  // ---------- renderer, scene, camera ----------
  const scene = new THREE.Scene();
  const HORIZON = new THREE.Color(0.62, 0.43, 0.3);
  scene.fog = new THREE.FogExp2(HORIZON.getHex(), isDemoSphere ? 0.00011 : 0.00042);

  const camera = new THREE.PerspectiveCamera(78, 1, isDemoSphere ? 0.1 : 0.06, isDemoSphere ? 42000 : 15000);

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

  // Sun: mid-afternoon, fairly low so the relief throws long shadows.
  const sunDir = new THREE.Vector3(-0.55, 0.42, -0.72).normalize();
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
    new THREE.SphereGeometry(isDemoSphere ? 35000 : 12500, 48, 24),
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
        uBaseColor: { value: new THREE.Color(baseHex) },
        uAlbedoBoost: { value: albedoBoost },
      },
    });
  }

  const skyMoons = new THREE.Group();
  const moonScale = isDemoSphere ? 2.75 : 1;
  const phobos = new THREE.Mesh(
    buildMoonGeometry(145 * moonScale, [1.34, 0.9, 0.82], true),
    makeMoonMat(0xd6cbc2, 1.35)
  );
  phobos.renderOrder = -1;
  const deimos = new THREE.Mesh(
    buildMoonGeometry(52 * moonScale, [1.14, 0.95, 0.9], false),
    makeMoonMat(0xf0e4d8, 1.7)
  );
  deimos.renderOrder = -1;
  skyMoons.add(phobos, deimos);
  scene.add(skyMoons);

  const PHOBOS_ORBIT_R = isDemoSphere ? 27000 : 9600;
  const DEIMOS_ORBIT_R = isDemoSphere ? 29200 : 10400;
  function updateMoons(tSec, camPos = camera.position) {
    // Phobos orbits faster than Mars rotates -> rises West (-X), drifts East (+X) across upper sky
    const pAngle = 1.05 - tSec * 0.014; // ~0.5 rad above NW horizon at start, gliding W -> E
    const pAzX = -Math.cos(pAngle);
    const pAltY = Math.sin(pAngle) * 0.72 + 0.16;
    const pLatZ = -0.52;
    const pLen = Math.hypot(pAzX, pAltY, pLatZ);
    phobos.position.set(
      (pAzX / pLen) * PHOBOS_ORBIT_R,
      (pAltY / pLen) * PHOBOS_ORBIT_R,
      (pLatZ / pLen) * PHOBOS_ORBIT_R
    );
    phobos.lookAt(camPos); // tidally locked toward viewer / Mars surface
    phobos.rotateZ(0.32);

    // Deimos orbits slower than Mars rotates -> rises East (+X), slowly drifts West (-X)
    const dAngle = 0.85 + tSec * 0.0055;
    const dAzX = Math.cos(dAngle);
    const dAltY = Math.sin(dAngle) * 0.82 + 0.12;
    const dLatZ = -0.34;
    const dLen = Math.hypot(dAzX, dAltY, dLatZ);
    deimos.position.set(
      (dAzX / dLen) * DEIMOS_ORBIT_R,
      (dAltY / dLen) * DEIMOS_ORBIT_R,
      (dLatZ / dLen) * DEIMOS_ORBIT_R
    );
    deimos.lookAt(camPos);
  }
  updateMoons(0);

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

  let molaGrid = null;
  let molaW = 0;
  let molaH = 0;
  let vikingRgb = null;
  let vikingW = 0;
  let vikingH = 0;
  let vikingImgEl = null;
  let molaShadedImgEl = null;
  if (isDemoSphere) {
    const readImgRgba = async (url) => {
      if (!url) return null;
      const im = await loadImage(url);
      const cv = document.createElement("canvas");
      cv.width = im.width;
      cv.height = im.height;
      const cx = cv.getContext("2d");
      cx.drawImage(im, 0, 0);
      return { img: im, w: im.width, h: im.height, data: cx.getImageData(0, 0, im.width, im.height).data };
    };
    const [molaRes, vikingRes, shadedRes] = await Promise.all([
      readImgRgba(assets.demoGlobalMolaDemUrl).catch(() => null),
      readImgRgba(assets.demoGlobalVikingMosaicUrl).catch(() => null),
      loadImage(assets.demoGlobalMolaShadedUrl).catch(() => null),
    ]);
    if (molaRes) {
      molaW = molaRes.w;
      molaH = molaRes.h;
      molaGrid = decodeMolaDemRgba(molaRes.data, molaW, molaH);
    }
    if (vikingRes) {
      vikingW = vikingRes.w;
      vikingH = vikingRes.h;
      vikingRgb = vikingRes.data;
      vikingImgEl = vikingRes.img;
    }
    if (shadedRes) {
      molaShadedImgEl = shadedRes;
    }
  }

  const marsGlobal = isDemoSphere
    ? createMarsGlobalModel({
        elevGrid,
        imgW,
        imgH,
        bounds,
        elevMin,
        elevMax,
        molaGrid,
        molaW,
        molaH,
        vikingRgb,
        vikingW,
        vikingH,
      })
    : null;

  function sampleElevSceneY(x, z) {
    if (isDemoSphere && marsGlobal) {
      const { lonDeg, latDeg } = localSceneXZToLonLat(x, z, sphereOrigin.lonDeg, sphereOrigin.latDeg);
      const altM = marsGlobal.sampleElevM(lonDeg, latDeg);
      return marsLonLatAltToLocalScene(
        lonDeg,
        latDeg,
        altM,
        sphereOrigin.lonDeg,
        sphereOrigin.latDeg,
        sphereOrigin.elevM
      ).y;
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

  function buildTerrainGeometry(seg) {
    if (isDemoSphere) return new THREE.BufferGeometry();
    const g = new THREE.PlaneGeometry(worldW, worldH, seg, seg);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, sampleElevSceneY(pos.getX(i), pos.getZ(i)));
    g.computeVertexNormals();
    return g;
  }

  // Mirrored copies: half the vertex density inside, but every vertex on the tile edge at full
  // density, so each copy meets the real tile and its neighbours exactly (no cracks, no walls).
  // Coarse interior cells that touch the edge are fan-triangulated from their inner corner.
  const COPY_STEP = 2;
  function buildStitchedGeometry(seg, step) {
    const idxOf = new Int32Array((seg + 1) * (seg + 1)).fill(-1);
    const P = [];
    const U = [];
    const keep = (i, j) => (i % step === 0 && j % step === 0) || i === 0 || j === 0 || i === seg || j === seg;
    for (let j = 0; j <= seg; j++) {
      for (let i = 0; i <= seg; i++) {
        if (!keep(i, j)) continue;
        const x = -worldW / 2 + (i / seg) * worldW;
        const z = -worldH / 2 + (j / seg) * worldH;
        idxOf[j * (seg + 1) + i] = P.length / 3;
        P.push(x, sampleElevSceneY(x, z), z);
        U.push(i / seg, 1 - j / seg);
      }
    }
    const id = (i, j) => idxOf[j * (seg + 1) + i];
    const onBorder = (v) => v === 0 || v === seg;
    const index = [];
    for (let j0 = 0; j0 < seg; j0 += step) {
      for (let i0 = 0; i0 < seg; i0 += step) {
        const i1 = Math.min(seg, i0 + step);
        const j1 = Math.min(seg, j0 + step);
        // perimeter, in order: north edge, east edge, south edge, west edge (kept vertices only)
        const ring = [];
        for (let i = i0; i < i1; i++) if (id(i, j0) >= 0) ring.push([i, j0]);
        for (let j = j0; j < j1; j++) if (id(i1, j) >= 0) ring.push([i1, j]);
        for (let i = i1; i > i0; i--) if (id(i, j1) >= 0) ring.push([i, j1]);
        for (let j = j1; j > j0; j--) if (id(i0, j) >= 0) ring.push([i0, j]);
        // fan from a corner whose two edges are not subdivided (not on the tile border)
        let start = ring.findIndex(([i, j]) => (i === i0 || i === i1) && (j === j0 || j === j1) && !onBorder(i) && !onBorder(j));
        if (start < 0) start = 0;
        const r = ring.slice(start).concat(ring.slice(0, start)).map(([i, j]) => id(i, j));
        for (let k = 1; k < r.length - 1; k++) index.push(r[0], r[k], r[k + 1]);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
    // make every triangle face up, like PlaneGeometry after rotateX(-PI/2)
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let t = 0; t < index.length; t += 3) {
      a.fromArray(P, index[t] * 3);
      b.fromArray(P, index[t + 1] * 3);
      c.fromArray(P, index[t + 2] * 3);
      const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
      if (ny < 0) {
        const tmp = index[t + 1];
        index[t + 1] = index[t + 2];
        index[t + 2] = tmp;
      }
    }
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  }

  // Ground height that matches the drawn surface: full detail on the real tile (and the ring's
  // centre copy, which uses the same mesh); the coarser stitched surface on the other copies.
  function sampleGroundY(x, z) {
    if (!elevGrid) return 0;
    const ti = Math.round(x / worldW);
    const tj = Math.round(z / worldH);
    const gx = Math.round(endless.position.x / worldW);
    const gz = Math.round(endless.position.z / worldH);
    const fullTile = (ti === 0 && tj === 0) || (ti === gx && tj === gz);
    if (fullTile) return sampleElevSceneY(x, z);
    const seg = imgW - 1;
    const fx = mirrorWrap(x / worldW + 0.5) * seg;
    const fy = mirrorWrap(z / worldH + 0.5) * (imgH - 1);
    // the edge ring keeps full detail
    if (fx < COPY_STEP || fy < COPY_STEP || fx > seg - COPY_STEP || fy > imgH - 1 - COPY_STEP) {
      return sampleElevSceneY(x, z);
    }
    const x0 = Math.floor(fx / COPY_STEP) * COPY_STEP;
    const y0 = Math.floor(fy / COPY_STEP) * COPY_STEP;
    const x1 = Math.min(seg, x0 + COPY_STEP);
    const y1 = Math.min(imgH - 1, y0 + COPY_STEP);
    const tx = (fx - x0) / COPY_STEP;
    const ty = (fy - y0) / COPY_STEP;
    const e = (i, j) => elevGrid[j * imgW + i];
    const top = e(x0, y0) + (e(x1, y0) - e(x0, y0)) * tx;
    const bot = e(x0, y1) + (e(x1, y1) - e(x0, y1)) * tx;
    return top + (bot - top) * ty - elevMin;
  }

  const fullSeg = elevGrid ? Math.min(imgW - 1, 394) : 1;
  const terrainGeom = buildTerrainGeometry(fullSeg);
  // mirrored copies are seen from far away through fog: a quarter of the vertex density is plenty
  const copyGeom =
    elevGrid && fullSeg % COPY_STEP === 0 ? buildStitchedGeometry(fullSeg, COPY_STEP) : buildTerrainGeometry(fullSeg);

  // ---------- far terrain shadows (baked) ----------
  // The real-time shadow map only covers the ground near the walker. For the rest, march from every
  // terrain cell towards the sun through the height grid and store how much of the sun is visible.
  // The mirrored terrain repeats every 2 tiles in world space, so one mask over that period, sampled
  // with world x/z and repeat wrapping, is correct for the real tile and every mirrored copy.
  function bakeSunMask() {
    const n = elevGrid ? imgW : 0;
    if (!n) return null;
    const N = 2 * n; // cells across one mirror period
    const cell = worldW / n;
    const H = new Float32Array(N * N);
    for (let r = 0; r < N; r++) {
      const sr = r < n ? r : 2 * n - 1 - r;
      for (let c = 0; c < N; c++) {
        const sc = c < n ? c : 2 * n - 1 - c;
        H[r * N + c] = elevGrid[sr * imgW + sc];
      }
    }
    const horiz = Math.hypot(sunDir.x, sunDir.z);
    const tanSun = sunDir.y / horiz;
    const dx = sunDir.x / horiz; // cells per step towards the sun (x = columns, east)
    const dz = sunDir.z / horiz; // z = rows, south
    const maxSteps = Math.ceil(700 / cell);
    const SOFT = 0.012; // about the sun disc plus dust: soft edge in tan(angle)
    const out = new Uint8Array(N * N * 4);
    const wrap = (v) => ((v % N) + N) % N;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const h0 = H[r * N + c];
        let worst = -1e9;
        for (let k = 1; k <= maxSteps; k++) {
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
          const t = (h - h0) / (k * cell);
          if (t > worst) {
            worst = t;
            if (worst > tanSun + SOFT) break; // fully in shadow
          }
        }
        const lit = Math.min(1, Math.max(0, (tanSun - worst) / (2 * SOFT) + 0.5));
        // texture row 0 = smallest world z (north), matching the shader's lookup
        const o = (r * N + c) * 4;
        out[o] = out[o + 1] = out[o + 2] = Math.round(lit * 255);
        out[o + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(out, N, N, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }
  const bakeT0 = performance.now();
  const sunMask = bakeSunMask();
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

  const fallbackSolidTex = (() => {
    const t = new THREE.DataTexture(new Uint8Array([192, 128, 92, 255]), 1, 1, THREE.RGBAFormat);
    t.needsUpdate = true;
    return t;
  })();
  const makeEquirectTex = (src) => {
    if (!src) return null;
    const t = new THREE.Texture(src);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = maxAniso;
    t.needsUpdate = true;
    return t;
  };
  const sharedVikingTex = makeEquirectTex(vikingImgEl);
  const sharedMolaShadedTex = makeEquirectTex(molaShadedImgEl);

  const anchorModUniform = { value: new THREE.Vector2(0, 0) };
  const worldSizeUniform = { value: new THREE.Vector2(worldW, worldH) };
  const texModeUniform = { value: 0 }; // 0: relief + geology, 1: MOLA elevation color, 2: ortho/Viking, 3: slope hazard
  const elevRangeUniform = { value: new THREE.Vector2(elevMin, Math.max(elevMin + 1, elevMax)) };
  const molaPaletteGlsl = buildMolaPaletteGlsl();

  const terrainMat = new THREE.MeshStandardMaterial({
    map: reliefTex,
    normalMap: pbr.dustNormalTex,
    normalScale: new THREE.Vector2(isDemoSphere ? 0.78 : 0.62, isDemoSphere ? 0.78 : 0.62),
    roughness: 0.94,
    metalness: 0.0,
  });
  terrainMat.envMapIntensity = 0.7; // ground in shade stays dark; the suit keeps the full sky light
  const superDetailUniform = { value: 0 };
  terrainMat.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: detailTex };
    shader.uniforms.pbrDust = { value: pbr.dustAlbedoTex };
    shader.uniforms.pbrRock = { value: pbr.rockAlbedoTex };
    shader.uniforms.uTexMode = texModeUniform;
    shader.uniforms.uElevRange = elevRangeUniform;
    shader.uniforms.uVikingMap = { value: sharedVikingTex || fallbackSolidTex };
    shader.uniforms.uMolaShadedMap = { value: sharedMolaShadedTex || fallbackSolidTex };
    shader.uniforms.uHasVikingMap = { value: sharedVikingTex ? 1.0 : 0.0 };
    shader.uniforms.uHasMolaShadedMap = { value: sharedMolaShadedTex ? 1.0 : 0.0 };
    shader.uniforms.sunMask = { value: sunMask };
    shader.uniforms.sunMaskOn = { value: sunMask ? 1 : 0 };
    shader.uniforms.sunMaskPeriod = { value: new THREE.Vector2(2 * worldW, 2 * worldH) };
    shader.uniforms.sunMaskOrigin = { value: new THREE.Vector2(-worldW / 2, -worldH / 2) };
    shader.uniforms.uSuperDetail = superDetailUniform;

    const sharedFragHelpers = `
uniform sampler2D detailMap;
uniform sampler2D pbrDust;
uniform sampler2D pbrRock;
uniform float uSuperDetail;
uniform float uTexMode;
uniform vec2 uElevRange;
uniform sampler2D uVikingMap;
uniform sampler2D uMolaShadedMap;
uniform float uHasVikingMap;
uniform float uHasMolaShadedMap;
${molaPaletteGlsl}
float mmContour(float h, float stepM) {
  float f = fract(h / stepM);
  float d = min(f, 1.0 - f);
  return 1.0 - smoothstep(0.0, 0.055, d);
}
vec3 mmHazardRamp(float slopeDeg) {
  if (slopeDeg > 20.0) return vec3(0.66, 0.33, 0.97);
  if (slopeDeg > 15.0) return vec3(0.94, 0.27, 0.27);
  if (slopeDeg > 10.0) return vec3(0.96, 0.62, 0.04);
  return vec3(0.13, 0.77, 0.37);
}
`;

    if (isDemoSphere) {
      shader.uniforms.uAnchorModUV = anchorModUniform;
      shader.uniforms.uWorldSize = worldSizeUniform;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nattribute float aHiRiseW;\nattribute vec3 aMarsAlbedo;\nattribute vec2 aGlobeUv;\nattribute float aElevM;\nattribute float aSlopeDeg;\nuniform vec2 uAnchorModUV;\nuniform vec2 uWorldSize;\nvarying float vHiRiseW;\nvarying vec3 vMarsAlbedo;\nvarying vec2 vGlobeUv;\nvarying float vElevM;\nvarying float vSlopeDeg;\nvarying vec2 vSeamlessUv;"
        )
        .replace(
          "#include <project_vertex>",
          "#include <project_vertex>\nvHiRiseW = aHiRiseW;\nvMarsAlbedo = aMarsAlbedo;\nvGlobeUv = aGlobeUv;\nvElevM = aElevM;\nvSlopeDeg = aSlopeDeg;\nvSeamlessUv = (transformed.xz / uWorldSize) + uAnchorModUV;"
        );
      const sunChunkSphere = THREE.ShaderChunk.lights_fragment_begin.replace(
        "getDirectionalLightInfo( directionalLight, directLight );",
        "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= mmSunVis;"
      );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying float vHiRiseW;\nvarying vec3 vMarsAlbedo;\nvarying vec2 vGlobeUv;\nvarying float vElevM;\nvarying float vSlopeDeg;\nvarying vec2 vSeamlessUv;\nuniform sampler2D sunMask;\nuniform float sunMaskOn;"
        )
        .replace(
          "#include <lights_fragment_begin>",
          "vec2 hiMaskUv = vec2(vMapUv.x, 1.0 - vMapUv.y) * 0.5;\nfloat rawSunVis = sunMaskOn > 0.5 ? texture2D(sunMask, hiMaskUv).r : 1.0;\nfloat mmSunVis = mix(1.0, rawSunVis, clamp(vHiRiseW, 0.0, 1.0));\n" +
            sunChunkSphere
        )
        .replace(
          "#include <map_pars_fragment>",
          `#include <map_pars_fragment>\n${sharedFragHelpers}`
        )
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
          #ifdef USE_MAP
            float dA = texture2D(detailMap, vSeamlessUv * 173.0).r;
            float dB = texture2D(detailMap, vSeamlessUv * 911.0).r;
            vec3 mmDust = texture2D(pbrDust, vSeamlessUv * mix(640.0, 920.0, uSuperDetail)).rgb;
            vec3 mmRock = texture2D(pbrRock, vSeamlessUv * mix(290.0, 440.0, uSuperDetail) + 0.37).rgb;
            float mmRockMask = smoothstep(0.45, 0.65, texture2D(detailMap, vSeamlessUv * 41.0 + 0.11).r);
            float slopeFactor = smoothstep(9.0, 23.0, vSlopeDeg);
            vec3 mmGround = mix(mmDust, mmRock, clamp(mmRockMask * 0.55 + slopeFactor * 0.72, 0.0, 1.0));
            float mmLum = clamp(dot(mmGround, vec3(0.299, 0.587, 0.114)) / 0.40, 0.34, mix(1.58, 1.75, uSuperDetail));
            float hiW = clamp(vHiRiseW, 0.0, 1.0);

            vec3 globalViking = uHasVikingMap > 0.5 ? texture2D(uVikingMap, vGlobeUv).rgb : vMarsAlbedo;
            vec3 naturalGlobal = mix(vMarsAlbedo, globalViking, 0.88);
            vec3 galeLocal = diffuseColor.rgb;
            vec3 baseColor = mix(naturalGlobal, galeLocal, hiW);

            if (uTexMode < 0.5) {
              // Natural geological relief: sedimentary cliff strata + exposed dark volcanic rock on steep walls + basin/crest tint
              float strata = 0.5 + 0.5 * sin(vElevM * 0.44 + dA * 2.4);
              vec3 cliffBedrock = mix(vec3(0.24, 0.17, 0.14), vec3(0.44, 0.31, 0.25), strata);
              float elevT = clamp((vElevM + 8135.0) / 29294.0, 0.0, 1.0);
              vec3 elevTint = mix(vec3(0.90, 0.87, 0.85), vec3(1.10, 1.02, 0.96), elevT);
              float detailGain = mix(0.36, 0.50, uSuperDetail);
              baseColor = mix(baseColor * elevTint, cliffBedrock, slopeFactor * 0.46);
              baseColor *= (1.0 - detailGain * 0.66) + detailGain * dA * 0.6 + detailGain * dB * 0.4;
              baseColor *= mix(1.0, mmLum, mix(0.68, 0.90, uSuperDetail));
            } else if (uTexMode < 1.5) {
              // NASA MOLA Hypsometric Elevation Color + topographic contour lines
              float globNorm = clamp((vElevM + 8135.0) / 29294.0, 0.0, 1.0);
              float locNorm = clamp((vElevM - uElevRange.x) / max(1.0, uElevRange.y - uElevRange.x), 0.0, 1.0);
              vec3 molaSample = uHasMolaShadedMap > 0.5 ? texture2D(uMolaShadedMap, vGlobeUv).rgb : mmSampleMolaRamp(globNorm);
              vec3 localRamp = mmSampleMolaRamp(mix(globNorm, locNorm, hiW * 0.85));
              vec3 molaCol = mix(mix(molaSample, localRamp, 0.32), localRamp, hiW * 0.75);
              float cMin = mmContour(vElevM, 20.0);
              float cMaj = mmContour(vElevM, 80.0);
              molaCol = mix(molaCol, molaCol * 0.62, cMin * 0.45);
              molaCol = mix(molaCol, vec3(0.97, 0.90, 0.78), cMaj * 0.55);
              baseColor = molaCol * mix(0.84, 1.16, clamp(mmLum * 0.75, 0.0, 1.0));
            } else if (uTexMode < 2.5) {
              // Optical imagery (Viking / HiRISE ortho)
              baseColor = mix(globalViking, galeLocal, hiW);
              baseColor *= 0.80 + 0.30 * dA * 0.6 + 0.30 * dB * 0.4;
              baseColor *= mix(1.0, mmLum, mix(0.55, 0.82, uSuperDetail));
            } else {
              // Live Slope / Hazard overlay across the entire planet
              vec3 haz = mmHazardRamp(vSlopeDeg);
              float hAlpha = vSlopeDeg > 20.0 ? 0.64 : (vSlopeDeg > 15.0 ? 0.54 : (vSlopeDeg > 10.0 ? 0.44 : 0.30));
              baseColor = mix(baseColor * mix(0.85, mmLum, 0.5), haz, hAlpha);
            }
            diffuseColor.rgb = baseColor;
          #endif`
        );
    } else {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform vec2 uElevRange;\nvarying vec2 vMmWorldXZ;\nvarying float vElevM;\nvarying float vSlopeDeg;"
        )
        .replace(
          "#include <project_vertex>",
          "#include <project_vertex>\nvMmWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;\nvElevM = uElevRange.x + transformed.y;\nvSlopeDeg = degrees(acos(clamp(abs(normal.y), 0.0, 1.0)));"
        );
      const sunChunk = THREE.ShaderChunk.lights_fragment_begin.replace(
        "getDirectionalLightInfo( directionalLight, directLight );",
        "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= mmSunVis;"
      );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec2 vMmWorldXZ;\nvarying float vElevM;\nvarying float vSlopeDeg;\nuniform sampler2D sunMask;\nuniform float sunMaskOn;\nuniform vec2 sunMaskPeriod;\nuniform vec2 sunMaskOrigin;"
        )
        .replace(
          "#include <lights_fragment_begin>",
          "float mmSunVis = sunMaskOn > 0.5 ? texture2D(sunMask, (vMmWorldXZ - sunMaskOrigin) / sunMaskPeriod).r : 1.0;\n" +
            sunChunk
        )
        .replace(
          "#include <map_pars_fragment>",
          `#include <map_pars_fragment>\n${sharedFragHelpers}`
        )
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
          #ifdef USE_MAP
            float dA = texture2D(detailMap, vMapUv * 173.0).r;
            float dB = texture2D(detailMap, vMapUv * 911.0).r;
            vec3 mmDust = texture2D(pbrDust, vMapUv * mix(640.0, 920.0, uSuperDetail)).rgb;
            vec3 mmRock = texture2D(pbrRock, vMapUv * mix(290.0, 440.0, uSuperDetail) + 0.37).rgb;
            float mmRockMask = smoothstep(0.45, 0.65, texture2D(detailMap, vMapUv * 41.0 + 0.11).r);
            float slopeFactor = smoothstep(10.0, 23.0, vSlopeDeg);
            vec3 mmGround = mix(mmDust, mmRock, clamp(mmRockMask * 0.55 + slopeFactor * 0.72, 0.0, 1.0));
            float mmLum = clamp(dot(mmGround, vec3(0.299, 0.587, 0.114)) / 0.40, 0.30, mix(1.60, 1.75, uSuperDetail));
            float elevNorm = clamp((vElevM - uElevRange.x) / max(1.0, uElevRange.y - uElevRange.x), 0.0, 1.0);
            float detailGain = mix(0.40, 0.54, uSuperDetail);
            float lumMix = mix(0.70, 0.92, uSuperDetail);

            if (uTexMode < 0.5) {
              // Enriched Gale geology: elevation-toned basins/ridges + stratified mudstone/basalt cliff bands
              float strata = 0.5 + 0.5 * sin(vElevM * 0.52 + dA * 2.3);
              vec3 cliffBedrock = mix(vec3(0.25, 0.17, 0.14), vec3(0.47, 0.32, 0.25), strata);
              vec3 elevTint = mix(vec3(0.90, 0.86, 0.83), vec3(1.10, 1.02, 0.95), elevNorm);
              diffuseColor.rgb = mix(diffuseColor.rgb * elevTint, cliffBedrock, slopeFactor * 0.42);
              diffuseColor.rgb *= (1.0 - detailGain * 0.65) + detailGain * dA * 0.6 + detailGain * dB * 0.4;
              diffuseColor.rgb *= mix(1.0, mmLum, lumMix);
            } else if (uTexMode < 1.5) {
              // MOLA Elevation Hypsometry Mode: NASA elevation color gradient + 10 m / 50 m contours
              vec3 molaCol = mmSampleMolaRamp(elevNorm);
              float cMin = mmContour(vElevM, 10.0);
              float cMaj = mmContour(vElevM, 50.0);
              molaCol = mix(molaCol, molaCol * 0.58, cMin * 0.46);
              molaCol = mix(molaCol, vec3(0.98, 0.91, 0.78), cMaj * 0.58);
              diffuseColor.rgb = molaCol * mix(0.84, 1.16, clamp(mmLum * 0.75, 0.0, 1.0));
            } else if (uTexMode < 2.5) {
              // HiRISE optical imagery
              diffuseColor.rgb *= (1.0 - detailGain * 0.65) + detailGain * dA * 0.6 + detailGain * dB * 0.4;
              diffuseColor.rgb *= mix(1.0, mmLum, lumMix);
            } else {
              // Slope / Hazard map
              diffuseColor.rgb *= 0.80 + 0.30 * dA * 0.6 + 0.30 * dB * 0.4;
              diffuseColor.rgb *= mix(1.0, mmLum, 0.55);
            }
          #endif`
        );
    }
  };

  let innerSphereMesh = null;
  let outerSphereMesh = null;
  let endless = null;
  const period = { x: 2 * worldW, z: 2 * worldH };
  function followEndless(pos) {
    if (isDemoSphere || !endless) return;
    endless.position.set(Math.round(pos.x / period.x) * period.x, 0, Math.round(pos.z / period.z) * period.z);
    endless.userData.centre.visible = endless.position.x !== 0 || endless.position.z !== 0;
  }

  function buildInnerSphereGeometry(refLonDeg, refLatDeg, refElevM) {
    const seg = 184;
    const n = seg + 1;
    const halfSpanM = 460;
    const stepM = (halfSpanM * 2) / seg;
    const count = n * n;
    const elevs = new Float64Array(count);
    const slopes = new Float32Array(count);
    const globeUvs = new Float32Array(count * 2);
    const sphereNorms = new Float32Array(count * 3);
    const basePos = new Float32Array(count * 3);
    const baseUv = new Float32Array(count * 2);
    const baseNrm = new Float32Array(count * 3);
    const baseHiW = new Float32Array(count);
    const baseAlbedo = new Float32Array(count * 3);

    const dLonBounds = Math.max(1e-6, bounds.east_lon_deg - bounds.west_lon_deg);
    const dLatBounds = Math.max(1e-6, bounds.north_lat_deg - bounds.south_lat_deg);

    for (let r = 0; r < n; r++) {
      const zOff = -halfSpanM + r * stepM;
      for (let c = 0; c < n; c++) {
        const xOff = -halfSpanM + c * stepM;
        const idx = r * n + c;
        const { lonDeg, latDeg } = localSceneXZToLonLat(xOff, zOff, refLonDeg, refLatDeg);
        const unwrappedLon = refLonDeg + (((lonDeg - refLonDeg + 540) % 360) - 180);
        const altM = marsGlobal.sampleElevM(lonDeg, latDeg);
        elevs[idx] = altM;
        const p = marsLonLatAltToLocalScene(lonDeg, latDeg, altM, refLonDeg, refLatDeg, refElevM);
        basePos[idx * 3] = p.x;
        basePos[idx * 3 + 1] = p.y;
        basePos[idx * 3 + 2] = p.z;
        const [snx, sny, snz] = sphereNormalAtLocal(p.x, p.y, p.z);
        sphereNorms[idx * 3] = snx;
        sphereNorms[idx * 3 + 1] = sny;
        sphereNorms[idx * 3 + 2] = snz;
        baseUv[idx * 2] = (unwrappedLon - bounds.west_lon_deg) / dLonBounds;
        baseUv[idx * 2 + 1] = (latDeg - bounds.south_lat_deg) / dLatBounds;
        globeUvs[idx * 2] = (unwrappedLon + 180) / 360;
        globeUvs[idx * 2 + 1] = (latDeg + 90) / 180;
        baseHiW[idx] = marsGlobal.hiRiseWeightAt(lonDeg, latDeg, 260);
        const col = marsGlobal.sampleAlbedoRgb(lonDeg, latDeg, altM);
        baseAlbedo[idx * 3] = col[0];
        baseAlbedo[idx * 3 + 1] = col[1];
        baseAlbedo[idx * 3 + 2] = col[2];
      }
    }

    for (let r = 0; r < n; r++) {
      const r0 = Math.max(0, r - 1);
      const r1 = Math.min(n - 1, r + 1);
      for (let c = 0; c < n; c++) {
        const c0 = Math.max(0, c - 1);
        const c1 = Math.min(n - 1, c + 1);
        const idx = r * n + c;
        const dx = (c1 - c0 || 1) * stepM;
        const dz = (r1 - r0 || 1) * stepM;
        const gx = (elevs[r * n + c1] - elevs[r * n + c0]) / dx;
        const gz = (elevs[r1 * n + c] - elevs[r0 * n + c]) / dz;
        const snx = sphereNorms[idx * 3];
        const sny = sphereNorms[idx * 3 + 1];
        const snz = sphereNorms[idx * 3 + 2];
        const nx = snx - gx * sny;
        const ny = sny;
        const nz = snz - gz * sny;
        const inv = 1 / (Math.hypot(nx, ny, nz) || 1);
        baseNrm[idx * 3] = nx * inv;
        baseNrm[idx * 3 + 1] = ny * inv;
        baseNrm[idx * 3 + 2] = nz * inv;
        slopes[idx] = Math.atan(Math.hypot(gx, gz)) * (180 / Math.PI);
      }
    }

    // 16 m downward perimeter skirt prevents any micro-gap with the outer radial horizon ring
    const ring = [];
    for (let c = 0; c < n; c++) ring.push(c);
    for (let r = 1; r < n; r++) ring.push(r * n + seg);
    for (let c = seg - 1; c >= 0; c--) ring.push(seg * n + c);
    for (let r = seg - 1; r >= 1; r--) ring.push(r * n);
    const m = ring.length;
    const total = count + 2 * m;
    const P = new Float32Array(total * 3);
    const U = new Float32Array(total * 2);
    const G = new Float32Array(total * 2);
    const N = new Float32Array(total * 3);
    const W = new Float32Array(total);
    const A = new Float32Array(total * 3);
    const E = new Float32Array(total);
    const S = new Float32Array(total);
    P.set(basePos);
    U.set(baseUv);
    G.set(globeUvs);
    N.set(baseNrm);
    W.set(baseHiW);
    A.set(baseAlbedo);
    for (let i = 0; i < count; i++) E[i] = elevs[i];
    S.set(slopes);

    const indices = [];
    for (let r = 0; r < seg; r++) {
      for (let c = 0; c < seg; c++) {
        const a = r * n + c;
        const b = a + 1;
        const cIdx = (r + 1) * n + c;
        const d = cIdx + 1;
        indices.push(a, cIdx, b, b, cIdx, d);
      }
    }
    for (let k = 0; k < m; k++) {
      const src = ring[k];
      for (const [o, dy] of [
        [count + 2 * k, 0],
        [count + 2 * k + 1, -16],
      ]) {
        P[o * 3] = basePos[src * 3];
        P[o * 3 + 1] = basePos[src * 3 + 1] + dy;
        P[o * 3 + 2] = basePos[src * 3 + 2];
        U[o * 2] = baseUv[src * 2];
        U[o * 2 + 1] = baseUv[src * 2 + 1];
        G[o * 2] = globeUvs[src * 2];
        G[o * 2 + 1] = globeUvs[src * 2 + 1];
        N[o * 3] = baseNrm[src * 3];
        N[o * 3 + 1] = baseNrm[src * 3 + 1];
        N[o * 3 + 2] = baseNrm[src * 3 + 2];
        W[o] = baseHiW[src];
        A[o * 3] = baseAlbedo[src * 3];
        A[o * 3 + 1] = baseAlbedo[src * 3 + 1];
        A[o * 3 + 2] = baseAlbedo[src * 3 + 2];
        E[o] = elevs[src];
        S[o] = slopes[src];
      }
    }
    for (let k = 0; k < m; k++) {
      const a = count + 2 * k;
      const b = count + 2 * ((k + 1) % m);
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(P, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
    g.setAttribute("aGlobeUv", new THREE.BufferAttribute(G, 2));
    g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    g.setAttribute("aHiRiseW", new THREE.BufferAttribute(W, 1));
    g.setAttribute("aMarsAlbedo", new THREE.BufferAttribute(A, 3));
    g.setAttribute("aElevM", new THREE.BufferAttribute(E, 1));
    g.setAttribute("aSlopeDeg", new THREE.BufferAttribute(S, 1));
    g.setIndex(indices);
    g.computeBoundingSphere();
    return g;
  }

  function buildOuterHorizonGeometry(refLonDeg, refLatDeg, refElevM) {
    const rings = 64;
    const sectors = 128;
    const rMin = 365;
    const rMax = 30000;
    const vCount = rings * sectors;
    const P = new Float32Array(vCount * 3);
    const U = new Float32Array(vCount * 2);
    const G = new Float32Array(vCount * 2);
    const N = new Float32Array(vCount * 3);
    const W = new Float32Array(vCount);
    const A = new Float32Array(vCount * 3);
    const E = new Float32Array(vCount);
    const S = new Float32Array(vCount);
    const dLonBounds = Math.max(1e-6, bounds.east_lon_deg - bounds.west_lon_deg);
    const dLatBounds = Math.max(1e-6, bounds.north_lat_deg - bounds.south_lat_deg);

    for (let ri = 0; ri < rings; ri++) {
      const t = ri / (rings - 1);
      const radM = rMin + (rMax - rMin) * (0.14 * t + 0.86 * t * t * t);
      const fd = Math.max(8, radM * 0.025);
      for (let si = 0; si < sectors; si++) {
        const ang = (si / sectors) * Math.PI * 2;
        const xOff = Math.cos(ang) * radM;
        const zOff = Math.sin(ang) * radM;
        const idx = ri * sectors + si;
        const { lonDeg, latDeg } = localSceneXZToLonLat(xOff, zOff, refLonDeg, refLatDeg);
        const unwrappedLon = refLonDeg + (((lonDeg - refLonDeg + 540) % 360) - 180);
        const altM = marsGlobal.sampleElevM(lonDeg, latDeg);
        const p = marsLonLatAltToLocalScene(lonDeg, latDeg, altM, refLonDeg, refLatDeg, refElevM);
        P[idx * 3] = p.x;
        P[idx * 3 + 1] = p.y;
        P[idx * 3 + 2] = p.z;
        U[idx * 2] = (unwrappedLon - bounds.west_lon_deg) / dLonBounds;
        U[idx * 2 + 1] = (latDeg - bounds.south_lat_deg) / dLatBounds;
        G[idx * 2] = (unwrappedLon + 180) / 360;
        G[idx * 2 + 1] = (latDeg + 90) / 180;
        W[idx] = marsGlobal.hiRiseWeightAt(lonDeg, latDeg, 260);
        E[idx] = altM;
        const col = marsGlobal.sampleAlbedoRgb(lonDeg, latDeg, altM);
        A[idx * 3] = col[0];
        A[idx * 3 + 1] = col[1];
        A[idx * 3 + 2] = col[2];

        const pE = localSceneXZToLonLat(xOff + fd, zOff, refLonDeg, refLatDeg);
        const pW = localSceneXZToLonLat(xOff - fd, zOff, refLonDeg, refLatDeg);
        const pS = localSceneXZToLonLat(xOff, zOff + fd, refLonDeg, refLatDeg);
        const pN = localSceneXZToLonLat(xOff, zOff - fd, refLonDeg, refLatDeg);
        const gx = (marsGlobal.sampleElevM(pE.lonDeg, pE.latDeg) - marsGlobal.sampleElevM(pW.lonDeg, pW.latDeg)) / (2 * fd);
        const gz = (marsGlobal.sampleElevM(pS.lonDeg, pS.latDeg) - marsGlobal.sampleElevM(pN.lonDeg, pN.latDeg)) / (2 * fd);
        S[idx] = Math.atan(Math.hypot(gx, gz)) * (180 / Math.PI);
        const [snx, sny, snz] = sphereNormalAtLocal(p.x, p.y, p.z);
        const nx = snx - gx * sny;
        const ny = sny;
        const nz = snz - gz * sny;
        const nInv = 1 / (Math.hypot(nx, ny, nz) || 1);
        N[idx * 3] = nx * nInv;
        N[idx * 3 + 1] = ny * nInv;
        N[idx * 3 + 2] = nz * nInv;
      }
    }

    const indices = [];
    for (let ri = 0; ri < rings - 1; ri++) {
      for (let si = 0; si < sectors; si++) {
        const sNext = (si + 1) % sectors;
        const a = ri * sectors + si;
        const b = ri * sectors + sNext;
        const c = (ri + 1) * sectors + si;
        const d = (ri + 1) * sectors + sNext;
        indices.push(a, b, c, b, d, c);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(P, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
    g.setAttribute("aGlobeUv", new THREE.BufferAttribute(G, 2));
    g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    g.setAttribute("aHiRiseW", new THREE.BufferAttribute(W, 1));
    g.setAttribute("aMarsAlbedo", new THREE.BufferAttribute(A, 3));
    g.setAttribute("aElevM", new THREE.BufferAttribute(E, 1));
    g.setAttribute("aSlopeDeg", new THREE.BufferAttribute(S, 1));
    g.setIndex(indices);
    g.computeBoundingSphere();
    return g;
  }

  function rebuildSphericalTerrain(centerLonDeg, centerLatDeg) {
    if (!isDemoSphere || !marsGlobal) return;
    const cosLat = Math.max(0.18, Math.cos((centerLatDeg * Math.PI) / 180));
    const stepLatDeg = 72 / ((Math.PI / 180) * MARS_RADIUS_MEAN_M);
    const stepLonDeg = stepLatDeg / cosLat;
    const snapLon = normalizeLonDeg(Math.round(centerLonDeg / stepLonDeg) * stepLonDeg);
    const snapLat = Math.max(-89.99, Math.min(89.99, Math.round(centerLatDeg / stepLatDeg) * stepLatDeg));
    const snapElev = marsGlobal.sampleElevM(snapLon, snapLat);

    sphereOrigin.lonDeg = snapLon;
    sphereOrigin.latDeg = snapLat;
    sphereOrigin.elevM = snapElev;

    const eastArcM = (snapLon * (Math.PI / 180)) * MARS_RADIUS_MEAN_M * cosLat;
    const northArcM = (snapLat * (Math.PI / 180)) * MARS_RADIUS_MEAN_M;
    anchorModUniform.value.set(
      (((eastArcM % worldW) + worldW) % worldW) / worldW,
      (((northArcM % worldH) + worldH) % worldH) / worldH
    );

    const gIn = buildInnerSphereGeometry(snapLon, snapLat, snapElev);
    const gOut = buildOuterHorizonGeometry(snapLon, snapLat, snapElev);
    if (!innerSphereMesh) {
      innerSphereMesh = new THREE.Mesh(gIn, terrainMat);
      innerSphereMesh.receiveShadow = true;
      innerSphereMesh.castShadow = false;
      scene.add(innerSphereMesh);
    } else {
      innerSphereMesh.geometry.dispose();
      innerSphereMesh.geometry = gIn;
    }
    if (!outerSphereMesh) {
      outerSphereMesh = new THREE.Mesh(gOut, terrainMat);
      outerSphereMesh.receiveShadow = true;
      outerSphereMesh.castShadow = false;
      scene.add(outerSphereMesh);
    } else {
      outerSphereMesh.geometry.dispose();
      outerSphereMesh.geometry = gOut;
    }
  }

  if (isDemoSphere) {
    rebuildSphericalTerrain(midLonBounds, midLatBounds);
  } else {
    const terrainMesh = new THREE.Mesh(terrainGeom, terrainMat);
    terrainMesh.receiveShadow = true;
    terrainMesh.castShadow = false; // terrain shadows come from the baked sun mask, not the shadow map
    scene.add(terrainMesh);

    // Endless ground: mirrored copies meet the real tile with identical edges. Only the
    // centre tile is data; the ring follows the camera in steps of one mirror period.
    endless = new THREE.Group();
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
  }

  // ---------- stop markers: survey poles with a small lamp ----------
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5, metalness: 0.2 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.5 });
  const startLampMat = new THREE.MeshStandardMaterial({
    color: 0xfef3c7,
    emissive: 0xf59e0b,
    emissiveIntensity: 3.0,
  });
  const stopMarkers = [];
  if (stops?.features) {
    stops.features.forEach((f, idx) => {
      const [lon, lat] = f.geometry.coordinates;
      const isStart = idx === 0 || f.properties?.kind === "habitat";
      const poleH = isStart ? 4.6 : 2.4;
      const group = new THREE.Group();
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(isStart ? 0.032 : 0.025, isStart ? 0.038 : 0.025, poleH, 8),
        poleMat
      );
      pole.position.set(0, poleH * 0.5, 0);
      pole.castShadow = true;
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(isStart ? 0.1 : 0.07, 12, 8),
        isStart ? startLampMat : lampMat
      );
      lamp.position.set(0, poleH + (isStart ? 0.07 : 0.05), 0);
      group.add(pole, lamp);
      scene.add(group);
      stopMarkers.push({ lon, lat, group });
    });
  }
  const _markerUp = new THREE.Vector3(0, 1, 0);
  const _markerNorm = new THREE.Vector3();
  function updateStopMarkerTransforms() {
    for (const sm of stopMarkers) {
      if (isDemoSphere && marsGlobal) {
        const altM = marsGlobal.sampleElevM(sm.lon, sm.lat);
        const p = marsLonLatAltToLocalScene(
          sm.lon,
          sm.lat,
          altM,
          sphereOrigin.lonDeg,
          sphereOrigin.latDeg,
          sphereOrigin.elevM
        );
        const far = Math.hypot(p.x, p.z) > 32000;
        sm.group.visible = !far;
        if (!far) {
          sm.group.position.set(p.x, p.y, p.z);
          const [nx, ny, nz] = sphereNormalAtLocal(p.x, p.y, p.z);
          _markerNorm.set(nx, ny, nz);
          sm.group.quaternion.setFromUnitVectors(_markerUp, _markerNorm);
        }
      } else {
        const sx = lonToX(sm.lon);
        const sz = latToZ(sm.lat);
        sm.group.position.set(sx, sampleElevSceneY(sx, sz), sz);
      }
    }
  }
  updateStopMarkerTransforms();

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
      contacts.push({ who, foot, mesh: m, prevLift: null, dustCooldown: 0 });
    }
  }
  const dustFx = createMarsDustSystem({
    THREE,
    scene,
    atlasUrl: "./assets/dust/mars-dust-atlas.png",
    horizonColor: HORIZON,
    sunDir,
    marsG: MARS_G,
  });
  let lastFootstepFxMs = 0;
  let stepDustFallbackDist = 0;
  const _dustMoveVec = new THREE.Vector3(0, 0, -1);
  const _dustPlayerGroundPos = new THREE.Vector3();
  const _dustPlayerNrm = new THREE.Vector3(0, 1, 0);

  function computeTerrainNormalAtLocalXZ(lx, lz, outNrm) {
    const e = 0.35;
    if (isDemoSphere && marsGlobal) {
      const centerGeo = localSceneXZToLonLat(lx, lz, sphereOrigin.lonDeg, sphereOrigin.latDeg);
      const centerAlt = marsGlobal.sampleElevM(centerGeo.lonDeg, centerGeo.latDeg);
      const centerPos = marsLonLatAltToLocalScene(
        centerGeo.lonDeg,
        centerGeo.latDeg,
        centerAlt,
        sphereOrigin.lonDeg,
        sphereOrigin.latDeg,
        sphereOrigin.elevM
      );
      const [snx, sny, snz] = sphereNormalAtLocal(centerPos.x, centerPos.y, centerPos.z);
      const gE = localSceneXZToLonLat(lx + e, lz, sphereOrigin.lonDeg, sphereOrigin.latDeg);
      const gW = localSceneXZToLonLat(lx - e, lz, sphereOrigin.lonDeg, sphereOrigin.latDeg);
      const gS = localSceneXZToLonLat(lx, lz + e, sphereOrigin.lonDeg, sphereOrigin.latDeg);
      const gN = localSceneXZToLonLat(lx, lz - e, sphereOrigin.lonDeg, sphereOrigin.latDeg);
      const gx = (marsGlobal.sampleElevM(gE.lonDeg, gE.latDeg) - marsGlobal.sampleElevM(gW.lonDeg, gW.latDeg)) / (2 * e);
      const gz = (marsGlobal.sampleElevM(gS.lonDeg, gS.latDeg) - marsGlobal.sampleElevM(gN.lonDeg, gN.latDeg)) / (2 * e);
      return outNrm.set(snx - gx * sny, sny, snz - gz * sny).normalize();
    }
    return outNrm
      .set(
        sampleElevSceneY(lx - e, lz) - sampleElevSceneY(lx + e, lz),
        2 * e,
        sampleElevSceneY(lx, lz - e) - sampleElevSceneY(lx, lz + e)
      )
      .normalize();
  }

  function resolvePlayerGroundContact(lx, lz, outPos, outNrm) {
    if (isDemoSphere && marsGlobal) {
      const geo = localSceneXZToLonLat(lx, lz, sphereOrigin.lonDeg, sphereOrigin.latDeg);
      const altM = marsGlobal.sampleElevM(geo.lonDeg, geo.latDeg);
      const gp = marsLonLatAltToLocalScene(
        geo.lonDeg,
        geo.latDeg,
        altM,
        sphereOrigin.lonDeg,
        sphereOrigin.latDeg,
        sphereOrigin.elevM
      );
      outPos.set(gp.x, gp.y, gp.z);
    } else {
      outPos.set(lx, sampleElevSceneY(lx, lz), lz);
    }
    computeTerrainNormalAtLocalXZ(lx, lz, outNrm);
  }

  const footPos = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const qTilt = new THREE.Quaternion();
  const qYaw = new THREE.Quaternion();
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const _footOff = new THREE.Vector3();
  const _footNorm = new THREE.Vector3();
  function updateContactShadows(dt = 0.016, groundSpeed = 0, airborne = false, moveDirVec = null, nowMs = 0) {
    const canStepDust = !airborne && groundSpeed > 0.14;
    const stepIntensity = computeFootstepDustIntensity(groundSpeed, WALK_SPEED_MS, RUN_SPEED_MS);
    for (const c of contacts) {
      c.mesh.visible = c.who.group.visible;
      if (!c.mesh.visible) continue;
      c.dustCooldown = Math.max(0, c.dustCooldown - dt);
      c.foot.getWorldPosition(footPos);
      let lift = 0;
      if (isDemoSphere && marsGlobal) {
        const geo = localSceneXZToLonLat(footPos.x, footPos.z, sphereOrigin.lonDeg, sphereOrigin.latDeg);
        const gAlt = marsGlobal.sampleElevM(geo.lonDeg, geo.latDeg);
        const gPos = marsLonLatAltToLocalScene(
          geo.lonDeg,
          geo.latDeg,
          gAlt,
          sphereOrigin.lonDeg,
          sphereOrigin.latDeg,
          sphereOrigin.elevM
        );
        const [snx, sny, snz] = sphereNormalAtLocal(gPos.x, gPos.y, gPos.z);
        _footNorm.set(snx, sny, snz);
        _footOff.set(footPos.x - gPos.x, footPos.y - gPos.y, footPos.z - gPos.z);
        const radialHeight = _footOff.dot(_footNorm);
        lift = Math.max(0, radialHeight - 0.08);
        c.mesh.material.opacity = Math.max(0, 1 - lift / 0.35);
        const e = 0.3;
        const gE = localSceneXZToLonLat(footPos.x + e, footPos.z, sphereOrigin.lonDeg, sphereOrigin.latDeg);
        const gW = localSceneXZToLonLat(footPos.x - e, footPos.z, sphereOrigin.lonDeg, sphereOrigin.latDeg);
        const gS = localSceneXZToLonLat(footPos.x, footPos.z + e, sphereOrigin.lonDeg, sphereOrigin.latDeg);
        const gN = localSceneXZToLonLat(footPos.x, footPos.z - e, sphereOrigin.lonDeg, sphereOrigin.latDeg);
        const gx = (marsGlobal.sampleElevM(gE.lonDeg, gE.latDeg) - marsGlobal.sampleElevM(gW.lonDeg, gW.latDeg)) / (2 * e);
        const gz = (marsGlobal.sampleElevM(gS.lonDeg, gS.latDeg) - marsGlobal.sampleElevM(gN.lonDeg, gN.latDeg)) / (2 * e);
        nrm.set(snx - gx * sny, sny, snz - gz * sny).normalize();
        qTilt.setFromUnitVectors(Y_AXIS, nrm);
        qYaw.setFromAxisAngle(Y_AXIS, autoYaw + userYaw);
        c.mesh.quaternion.copy(qTilt).multiply(qYaw);
        c.mesh.position.set(gPos.x + _footNorm.x * 0.02, gPos.y + _footNorm.y * 0.02, gPos.z + _footNorm.z * 0.02);
      } else {
        const gy = sampleElevSceneY(footPos.x, footPos.z);
        lift = Math.max(0, footPos.y - gy - 0.08); // ankle bone sits ~8 cm above the sole
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
      }
      const sc = 1 + lift * 1.5;
      c.mesh.scale.set(sc, 1, sc);
      if (canStepDust && c.prevLift !== null && c.prevLift > 0.022 && lift <= 0.022 && c.dustCooldown <= 0) {
        dustFx.emitFootstep(c.mesh.position, nrm, moveDirVec, stepIntensity);
        c.dustCooldown = 0.22;
        lastFootstepFxMs = nowMs;
        stepDustFallbackDist = 0;
      }
      c.prevLift = lift;
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
    const stLon = Number.isFinite(st.lon) ? normalizeLonDeg(st.lon) : xToLon(Number(st.x) || 0);
    const stLat = Number.isFinite(st.lat) ? st.lat : zToLat(Number(st.z) || 0);
    const stAlt =
      Number.isFinite(st.altM)
        ? st.altM
        : isDemoSphere && marsGlobal
          ? marsGlobal.sampleElevM(stLon, stLat)
          : elevMin + (Number.isFinite(st.y) ? st.y : sampleElevSceneY(lonToX(stLon), latToZ(stLat)));
    let sx;
    let sy;
    let sz;
    if (isDemoSphere && marsGlobal) {
      const p = marsLonLatAltToLocalScene(
        stLon,
        stLat,
        stAlt,
        sphereOrigin.lonDeg,
        sphereOrigin.latDeg,
        sphereOrigin.elevM
      );
      sx = p.x;
      sy = p.y;
      sz = p.z;
    } else {
      sx = Number.isFinite(st.x) ? st.x : Number.isFinite(st.lon) ? lonToX(st.lon) : 0;
      sz = Number.isFinite(st.z) ? st.z : Number.isFinite(st.lat) ? latToZ(st.lat) : 0;
      sy = Number.isFinite(st.y) ? st.y : sampleElevSceneY(sx, sz);
    }
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
      target: {
        x: sx,
        y: sy,
        z: sz,
        lon: stLon,
        lat: stLat,
        altM: stAlt,
        yaw: syaw,
        airborne: Boolean(st.airborne),
        speed: Number(st.speed) || 0,
      },
      cur: { x: sx, y: sy, z: sz, lon: stLon, lat: stLat, altM: stAlt, yaw: syaw },
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

  function updatePingTransforms() {
    for (const g of pingGroup.children) {
      const { lon, lat } = g.userData || {};
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (isDemoSphere && marsGlobal) {
        const altM = marsGlobal.sampleElevM(lon, lat);
        const p = marsLonLatAltToLocalScene(
          lon,
          lat,
          altM,
          sphereOrigin.lonDeg,
          sphereOrigin.latDeg,
          sphereOrigin.elevM
        );
        const far = Math.hypot(p.x, p.z) > 32000;
        g.visible = !far;
        if (!far) {
          g.position.set(p.x, p.y, p.z);
          const [nx, ny, nz] = sphereNormalAtLocal(p.x, p.y, p.z);
          _markerNorm.set(nx, ny, nz);
          g.quaternion.setFromUnitVectors(_markerUp, _markerNorm);
        }
      } else {
        const x = lonToX(lon);
        const z = latToZ(lat);
        g.visible = true;
        g.position.set(x, sampleElevSceneY(x, z), z);
      }
    }
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
      const g = new THREE.Group();
      g.userData = { lon: pin.lon, lat: pin.lat };
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
      pingGroup.add(g);
    }
    updatePingTransforms();
  }

  function updateCrewHudSummary() {
    const crewEl = document.getElementById("hud-crew");
    const summaryEl = document.getElementById("hud-crew-summary");
    if (crewEl) {
      const cs = mp?.callsign || "AST-1";
      crewEl.innerHTML = `${cs} · 1.80 M · <span id="hud-suit">${suitLabel}</span>`;
    }
    if (summaryEl) {
      if (remoteAvatars.size > 0) {
        summaryEl.textContent = `MARS g 3.71 M/S² · CREW: ${1 + remoteAvatars.size} LIVE · ROOM ${mp?.room || "GALE-01"}`;
      } else {
        summaryEl.textContent = "MARS g 3.71 M/S² · CREW: 2 (BUDDY EVA)";
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
      const stLon = Number.isFinite(st.lon) ? normalizeLonDeg(st.lon) : entry.target.lon;
      const stLat = Number.isFinite(st.lat) ? st.lat : entry.target.lat;
      const stAlt =
        Number.isFinite(st.altM)
          ? st.altM
          : isDemoSphere && marsGlobal && Number.isFinite(stLon) && Number.isFinite(stLat)
            ? marsGlobal.sampleElevM(stLon, stLat)
            : entry.target.altM;
      let tx;
      let ty;
      let tz;
      if (isDemoSphere && marsGlobal && Number.isFinite(stLon) && Number.isFinite(stLat)) {
        const p = marsLonLatAltToLocalScene(
          stLon,
          stLat,
          stAlt,
          sphereOrigin.lonDeg,
          sphereOrigin.latDeg,
          sphereOrigin.elevM
        );
        tx = p.x;
        ty = p.y;
        tz = p.z;
      } else {
        tx = Number.isFinite(st.x) ? st.x : Number.isFinite(st.lon) ? lonToX(st.lon) : entry.target.x;
        tz = Number.isFinite(st.z) ? st.z : Number.isFinite(st.lat) ? latToZ(st.lat) : entry.target.z;
        ty = Number.isFinite(st.y) ? st.y : sampleElevSceneY(tx, tz);
      }
      entry.target = {
        x: tx,
        y: ty,
        z: tz,
        lon: stLon,
        lat: stLat,
        altM: stAlt,
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
  const startGeoLon = routeCoords.length > 1 ? routeCoords[0][0] : midLonBounds;
  const startGeoLat = routeCoords.length > 1 ? routeCoords[0][1] : midLatBounds;
  const playerGeo = {
    lon: normalizeLonDeg(startGeoLon),
    lat: startGeoLat,
    altM:
      isDemoSphere && marsGlobal
        ? marsGlobal.sampleElevM(startGeoLon, startGeoLat)
        : elevMin + sampleElevSceneY(lonToX(startGeoLon), latToZ(startGeoLat)),
  };
  const freePos = new THREE.Vector3(0, 0, 0);
  // start at the beginning of the route, facing along it
  if (routeCoords.length > 1) {
    if (isDemoSphere && marsGlobal) {
      const p0 = marsLonLatAltToLocalScene(
        playerGeo.lon,
        playerGeo.lat,
        playerGeo.altM,
        sphereOrigin.lonDeg,
        sphereOrigin.latDeg,
        sphereOrigin.elevM
      );
      freePos.set(p0.x, 0, p0.z);
    } else {
      const p0 = routePoint(0);
      freePos.set(p0.x, 0, p0.z);
    }
    userYaw = autoYaw;
    autoYaw = 0;
  }
  const partnerPos = new THREE.Vector3(freePos.x, 0, freePos.z);
  let partnerYaw = userYaw;
  const player = { x: freePos.x, y: 0, z: freePos.z, vy: 0, grounded: true, init: false };
  let partnerS = PARTNER_AHEAD_M;
  let justTeleportedOrWrapped = false;
  const keys = new Set();

  const mapOverlayEl = document.getElementById("hud-map-overlay");
  const isMapOpen = () => Boolean(mapOverlayEl?.classList.contains("open"));

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  renderer.domElement.addEventListener("pointerdown", (e) => {
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
    if (isDemoSphere && marsGlobal) {
      const lon = playerGeo.lon;
      const lat = playerGeo.lat;
      const elev = playerGeo.altM;
      return mp.dropPing({ lon, lat, elevM: elev, label });
    }
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

  // texture modes: relief (natural geology), mola (MOLA elevation color), ortho (Viking/HiRISE), slope (hazard)
  const TEX = [
    { tex: reliefTex, mode: 0, label: "relief" },
    { tex: reliefTex, mode: 1, label: "mola" },
    { tex: orthoTex, mode: 2, label: "ortho" },
    { tex: slopeTex, mode: 3, label: "slope" },
  ];
  function setTexMode(i) {
    texMode = i;
    if (texMode === 0 && !reliefOk) texMode = 1;
    terrainMat.map = TEX[texMode].tex;
    texModeUniform.value = TEX[texMode].mode;
    terrainMat.needsUpdate = true;
    const b = document.getElementById("hud-tex");
    if (b) b.textContent = `Tex: ${TEX[texMode].label}`;
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

  function repositionSphereEntities() {
    if (!isDemoSphere || !marsGlobal) return;
    updateStopMarkerTransforms();
    updatePingTransforms();
    for (const remote of remoteAvatars.values()) {
      const tLon = remote.target.lon;
      const tLat = remote.target.lat;
      if (Number.isFinite(tLon) && Number.isFinite(tLat)) {
        const tAlt = Number.isFinite(remote.target.altM) ? remote.target.altM : marsGlobal.sampleElevM(tLon, tLat);
        const tp = marsLonLatAltToLocalScene(
          tLon,
          tLat,
          tAlt,
          sphereOrigin.lonDeg,
          sphereOrigin.latDeg,
          sphereOrigin.elevM
        );
        remote.target.x = tp.x;
        remote.target.y = tp.y;
        remote.target.z = tp.z;
      }
      const cLon = remote.cur.lon ?? tLon;
      const cLat = remote.cur.lat ?? tLat;
      if (Number.isFinite(cLon) && Number.isFinite(cLat)) {
        const cAlt = Number.isFinite(remote.cur.altM) ? remote.cur.altM : marsGlobal.sampleElevM(cLon, cLat);
        const cp = marsLonLatAltToLocalScene(
          cLon,
          cLat,
          cAlt,
          sphereOrigin.lonDeg,
          sphereOrigin.latDeg,
          sphereOrigin.elevM
        );
        remote.cur.x = cp.x;
        remote.cur.y = cp.y;
        remote.cur.z = cp.z;
      }
    }
  }

  function rebaseSphereOrigin(centerLonDeg, centerLatDeg) {
    if (!isDemoSphere || !marsGlobal) return;
    const oldPx = player.x;
    const oldPy = player.y;
    const oldPz = player.z;
    rebuildSphericalTerrain(centerLonDeg, centerLatDeg);
    repositionSphereEntities();
    const p = marsLonLatAltToLocalScene(
      playerGeo.lon,
      playerGeo.lat,
      playerGeo.altM,
      sphereOrigin.lonDeg,
      sphereOrigin.latDeg,
      sphereOrigin.elevM
    );
    freePos.set(p.x, 0, p.z);
    player.x = p.x;
    player.y = p.y;
    player.z = p.z;
    if (Number.isFinite(oldPx) && Number.isFinite(oldPy) && Number.isFinite(oldPz)) {
      dustFx.shiftOrigin(p.x - oldPx, p.y - oldPy, p.z - oldPz);
    }
  }

  // A new route from the planner (Begin EVA): stand at its start, facing along it.
  onSetRoute((detail) => {
    const newRoute = detail?.route;
    const nextAlong = Number(detail?.alongM ?? detail?.along_m ?? 0) || 0;
    rebuildRouteRibbon(newRoute);
    alongM = nextAlong;
    autoYaw = 0;
    if (routeCoords.length > 1) {
      if (isDemoSphere && marsGlobal) {
        const smp = sampleAlongRoute(routeCoords, cumDist, Math.max(0, Math.min(geomTotalDist, toGeomDist(alongM))));
        userYaw = routeHeading(alongM);
        teleportToLonLat(smp.lon, smp.lat, { keepYaw: true });
      } else {
        const p = routePoint(alongM);
        freePos.set(p.x, 0, p.z);
        userYaw = routeHeading(alongM);
        partnerPos.set(p.x, 0, p.z);
        player.init = false;
        justTeleportedOrWrapped = true;
      }
    }
  });

  const viewLabelEl = document.getElementById("hud-view-label");

  function computeLocalSlopeDeg(x, z, geoLon = null, geoLat = null) {
    if (isDemoSphere && marsGlobal) {
      const base =
        geoLon != null && geoLat != null
          ? { lonDeg: geoLon, latDeg: geoLat }
          : localSceneXZToLonLat(x, z, sphereOrigin.lonDeg, sphereOrigin.latDeg);
      const pE = localSceneXZToLonLat(2, 0, base.lonDeg, base.latDeg);
      const pW = localSceneXZToLonLat(-2, 0, base.lonDeg, base.latDeg);
      const pS = localSceneXZToLonLat(0, 2, base.lonDeg, base.latDeg);
      const pN = localSceneXZToLonLat(0, -2, base.lonDeg, base.latDeg);
      const hW = marsGlobal.sampleElevM(pW.lonDeg, pW.latDeg);
      const hE = marsGlobal.sampleElevM(pE.lonDeg, pE.latDeg);
      const hN = marsGlobal.sampleElevM(pN.lonDeg, pN.latDeg);
      const hS = marsGlobal.sampleElevM(pS.lonDeg, pS.latDeg);
      const grad = Math.hypot((hE - hW) / 4, (hS - hN) / 4);
      return Math.atan(grad) * (180 / Math.PI);
    }
    const hW = sampleElevSceneY(x - 2, z);
    const hE = sampleElevSceneY(x + 2, z);
    const hN = sampleElevSceneY(x, z - 2);
    const hS = sampleElevSceneY(x, z + 2);
    const grad = Math.hypot((hE - hW) / 4, (hS - hN) / 4);
    return Math.atan(grad) * (180 / Math.PI);
  }

  function teleportToLonLat(lon, lat, { keepYaw = false } = {}) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    if (isDemoSphere && marsGlobal) {
      const normLon = normalizeLonDeg(lon);
      const clampedLat = Math.max(-89.95, Math.min(89.95, lat));
      const altM = marsGlobal.sampleElevM(normLon, clampedLat);
      playerGeo.lon = normLon;
      playerGeo.lat = clampedLat;
      playerGeo.altM = altM;

      const distFromOrigin = marsDistanceM([sphereOrigin.lonDeg, sphereOrigin.latDeg], [normLon, clampedLat]);
      if (distFromOrigin > 120) {
        rebuildSphericalTerrain(normLon, clampedLat);
        repositionSphereEntities();
      }
      const p = marsLonLatAltToLocalScene(
        normLon,
        clampedLat,
        altM,
        sphereOrigin.lonDeg,
        sphereOrigin.latDeg,
        sphereOrigin.elevM
      );
      const distFromRouteM =
        routeCoords.length > 0 ? marsDistanceM([routeCoords[0][0], routeCoords[0][1]], [normLon, clampedLat]) : Infinity;
      if (routeCoords.length > 1 && distFromRouteM < 15000) {
        const nearestGeomS = closestAlongM(routeCoords, cumDist, normLon, clampedLat);
        alongM = geomTotalDist > 0 ? (nearestGeomS / geomTotalDist) * totalDist : 0;
      } else {
        alongM = 0;
      }

      freePos.set(p.x, 0, p.z);
      player.x = p.x;
      player.y = p.y;
      player.z = p.z;
      player.vy = 0;
      player.grounded = true;
      player.init = true;
      justTeleportedOrWrapped = true;

      autoYaw = 0;
      if (!keepYaw && routeCoords.length > 1 && distFromRouteM < 15000) {
        const rp = routePoint(alongM);
        const distToRoute = marsDistanceM([normLon, clampedLat], [rp.smp.lon, rp.smp.lat]);
        userYaw = distToRoute > 5 ? Math.atan2(-(rp.x - p.x), -(rp.z - p.z)) : routeHeading(alongM);
      }
      pitch = Math.max(-0.55, Math.min(0.25, keepYaw ? pitch : -0.06));
      return;
    }
    teleportToLocal(lonToX(lon), latToZ(lat), { keepYaw });
  }

  function teleportToLocal(tx, tz, { keepYaw = false } = {}) {
    if (isDemoSphere && marsGlobal) {
      const { lonDeg, latDeg } = localSceneXZToLonLat(tx, tz, sphereOrigin.lonDeg, sphereOrigin.latDeg);
      teleportToLonLat(lonDeg, latDeg, { keepYaw });
      return;
    }
    const wx = wrapSceneCoord(tx, worldW).val;
    const wz = wrapSceneCoord(tz, worldH).val;
    const ty = sampleElevSceneY(wx, wz);
    const lon = xToLon(wx);
    const lat = zToLat(wz);

    const nearestGeomS = closestAlongM(routeCoords, cumDist, lon, lat);
    alongM = geomTotalDist > 0 ? (nearestGeomS / geomTotalDist) * totalDist : 0;

    freePos.set(wx, 0, wz);
    player.x = wx;
    player.z = wz;
    player.y = ty;
    player.vy = 0;
    player.grounded = true;
    player.init = true;
    justTeleportedOrWrapped = true;

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
    teleportToLonLat(lon, lat, { keepYaw: false });
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
  const mapScopeRowEl = document.getElementById("hud-map-scope-row");
  const mapScopeGlobeBtn = document.getElementById("hud-map-scope-globe");
  const mapScopeWorldBtn = document.getElementById("hud-map-scope-world");
  const mapScopeLocalBtn = document.getElementById("hud-map-scope-local");
  const mapLandmarksEl = document.getElementById("hud-map-landmarks");
  const mapLockBadgeEl = document.getElementById("hud-map-lock-badge");

  const isTrLang = () => {
    try {
      return localStorage.getItem("mm-lang") === "tr";
    } catch {
      return false;
    }
  };

  let mapLayerMode = "elevation"; // "elevation" | "mola" | "hazard"
  let mapScope = isDemoSphere ? "globe" : "local"; // "globe" | "world" | "local"
  let awaitingInitialLanding = Boolean(isDemoSphere);
  let globeCenterLon = playerGeo.lon;
  let globeCenterLat = playerGeo.lat;
  let globeZoom = 1.0;
  let pendingTeleport = null; // { tx, tz, lon, lat, elevMola, slopeDeg, distM, region? }
  let hoverTarget = null;

  // Build Martian-themed 3D elevation + slope base canvases directly from `elevGrid` (1:1 with 3D terrain)
  const mapBases = (() => {
    const w = elevGrid ? imgW : 256;
    const h = elevGrid ? imgH : 256;
    const elevCanvas = document.createElement("canvas");
    elevCanvas.width = w;
    elevCanvas.height = h;
    const molaCanvas = document.createElement("canvas");
    molaCanvas.width = w;
    molaCanvas.height = h;
    const hazCanvas = document.createElement("canvas");
    hazCanvas.width = w;
    hazCanvas.height = h;
    const eCtx = elevCanvas.getContext("2d");
    const mCtx = molaCanvas.getContext("2d");
    const hCtx = hazCanvas.getContext("2d");
    const eImg = eCtx.createImageData(w, h);
    const mImg = mCtx.createImageData(w, h);
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
    const shadeWithContours = (baseR, baseG, baseB, shade, isMajor, isMinor) => {
      let cr = baseR * shade;
      let cg = baseG * shade;
      let cb = baseB * shade;
      if (isMajor) {
        cr = cr * 0.52 + 245 * 0.48;
        cg = cg * 0.52 + 206 * 0.48;
        cb = cb * 0.52 + 166 * 0.48;
      } else if (isMinor) {
        cr *= 0.74;
        cg *= 0.74;
        cb *= 0.74;
      }
      return [
        Math.max(0, Math.min(255, Math.round(cr))),
        Math.max(0, Math.min(255, Math.round(cg))),
        Math.max(0, Math.min(255, Math.round(cb))),
      ];
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
          const smIdx = (y * sunMaskW + x) * 4;
          sunVis = (sunMaskData[smIdx] ?? 255) / 255;
        }

        const shade = (0.44 + 0.78 * ndotl) * (0.76 + 0.24 * sunVis);
        const elevT = (eC - minE) / spanE;

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
        const isMajor = majorBand !== majNeighborBand;
        const isMinor = !isMajor && minorBand !== minNeighborBand;

        const baseRgb = sampleMarsRamp(elevT);
        const [er, eg, eb] = shadeWithContours(baseRgb[0], baseRgb[1], baseRgb[2], shade, isMajor, isMinor);

        const p = (y * w + x) * 4;
        eImg.data[p] = er;
        eImg.data[p + 1] = eg;
        eImg.data[p + 2] = eb;
        eImg.data[p + 3] = 255;

        // NASA MOLA hypsometric color + 3D terrain hillshade & contours
        const molaRgb = sampleMolaPaletteRgb(elevT);
        const [mr, mg, mb] = shadeWithContours(
          molaRgb[0] * 255,
          molaRgb[1] * 255,
          molaRgb[2] * 255,
          shade,
          isMajor,
          isMinor
        );
        mImg.data[p] = mr;
        mImg.data[p + 1] = mg;
        mImg.data[p + 2] = mb;
        mImg.data[p + 3] = 255;

        // Hazard overlay: blend slope class on top of Martian hillshade
        const slopeDeg = Math.atan(Math.hypot(gx, gz)) * (180 / Math.PI);
        const haz = sampleSlopeHazardColor(slopeDeg);
        hImg.data[p] = Math.round(er * (1 - haz.alpha) + haz.r * haz.alpha);
        hImg.data[p + 1] = Math.round(eg * (1 - haz.alpha) + haz.g * haz.alpha);
        hImg.data[p + 2] = Math.round(eb * (1 - haz.alpha) + haz.b * haz.alpha);
        hImg.data[p + 3] = 255;
      }
    }

    eCtx.putImageData(eImg, 0, 0);
    mCtx.putImageData(mImg, 0, 0);
    hCtx.putImageData(hImg, 0, 0);
    return { elevCanvas, molaCanvas, hazCanvas, minE, maxE };
  })();

  // Precompute global Mars MOLA equirectangular shaded textures (demo sphere mode only)
  const globalMarsBases = (() => {
    if (!isDemoSphere || !marsGlobal) return null;
    const gw = 720;
    const gh = 360;
    const elevCanvas = document.createElement("canvas");
    elevCanvas.width = gw;
    elevCanvas.height = gh;
    const hazCanvas = document.createElement("canvas");
    hazCanvas.width = gw;
    hazCanvas.height = gh;
    const eCtx = elevCanvas.getContext("2d");
    const hCtx = hazCanvas.getContext("2d");
    const eImg = eCtx.createImageData(gw, gh);
    const hImg = hCtx.createImageData(gw, gh);
    const dStepDeg = 360 / gw;
    const cellM = MARS_CIRCUMFERENCE_M / gw;

    for (let y = 0; y < gh; y++) {
      const lat = 90 - (y + 0.5) * dStepDeg;
      const latP = Math.min(89.75, lat + dStepDeg);
      const latM = Math.max(-89.75, lat - dStepDeg);
      const cosLat = Math.max(0.25, Math.cos((lat * Math.PI) / 180));
      for (let x = 0; x < gw; x++) {
        const lon = -180 + (x + 0.5) * dStepDeg;
        const eC = marsGlobal.sampleElevM(lon, lat);
        const eE = marsGlobal.sampleElevM(lon + dStepDeg, lat);
        const eW = marsGlobal.sampleElevM(lon - dStepDeg, lat);
        const eN = marsGlobal.sampleElevM(lon, latP);
        const eS = marsGlobal.sampleElevM(lon, latM);

        // Hillshade using real planetary MOLA gradient
        const gx = ((eE - eW) / (2 * cellM * cosLat)) * 4.2;
        const gz = ((eS - eN) / (2 * cellM)) * 4.2;
        const nLen = Math.hypot(-gx, 1, -gz) || 1;
        const nx = -gx / nLen;
        const ny = 1 / nLen;
        const nz = -gz / nLen;
        const ndotl = Math.max(0, nx * sunDir.x + ny * sunDir.y + nz * sunDir.z);
        const shade = 0.62 + 0.55 * ndotl;

        const rgb = marsGlobal.sampleAlbedoRgb(lon, lat, eC);
        const r = Math.max(0, Math.min(255, Math.round(rgb[0] * 255 * shade)));
        const g = Math.max(0, Math.min(255, Math.round(rgb[1] * 255 * shade)));
        const b = Math.max(0, Math.min(255, Math.round(rgb[2] * 255 * shade)));

        const p = (y * gw + x) * 4;
        eImg.data[p] = r;
        eImg.data[p + 1] = g;
        eImg.data[p + 2] = b;
        eImg.data[p + 3] = 255;

        const rawSlopeDeg = Math.atan(Math.hypot((eE - eW) / (2 * cellM * cosLat), (eS - eN) / (2 * cellM))) * (180 / Math.PI);
        const scaledSlope = rawSlopeDeg * 14; // planetary 0.5° cells smooth steep canyon walls
        let hr = 34;
        let hg = 197;
        let hb = 94;
        let alpha = 0.24;
        if (scaledSlope > 20) {
          hr = 168;
          hg = 85;
          hb = 247;
          alpha = 0.62;
        } else if (scaledSlope > 15) {
          hr = 239;
          hg = 68;
          hb = 68;
          alpha = 0.5;
        } else if (scaledSlope > 10) {
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
    return {
      width: gw,
      height: gh,
      eData: eImg.data,
      hData: hImg.data,
      elevCanvas,
      hazCanvas,
      minE: -8200,
      maxE: 21200,
    };
  })();

  const globeScratch = (() => {
    if (!isDemoSphere) return null;
    const size = 224;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    return { size, canvas: c, ctx, img: ctx.createImageData(size, size) };
  })();

  // Real 3D WebGL terrain-displaced Mars globe (NASA MOLA 16ppd relief + normal map + Viking / MOLA Shaded)
  const globe3DState = (() => {
    if (!isDemoSphere || !marsGlobal) return null;
    try {
      const GL_SIZE = 540;
      const EXAGGERATION = 9.5;
      const glRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
      glRenderer.setSize(GL_SIZE, GL_SIZE, false);
      glRenderer.setPixelRatio(1);
      glRenderer.outputColorSpace = THREE.SRGBColorSpace;
      glRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      glRenderer.toneMappingExposure = 1.06;

      const glScene = new THREE.Scene();
      const glCam = new THREE.PerspectiveCamera(34, 1, 0.1, 20);

      const segLon = 240;
      const segLat = 120;
      const cols = segLon + 1;
      const rows = segLat + 1;
      const vCount = cols * rows;
      const positions = new Float32Array(vCount * 3);
      const uvs = new Float32Array(vCount * 2);

      for (let r = 0; r < rows; r++) {
        const vFrac = r / segLat;
        const lat = -90 + vFrac * 180;
        for (let c = 0; c < cols; c++) {
          const uFrac = c / segLon;
          const lon = -180 + uFrac * 360;
          const u = lonLatToUnitVec(lon, lat);
          const elevM = marsGlobal.sampleElevM(lon, lat);
          const rad = 1.0 + (elevM / MARS_RADIUS_MEAN_M) * EXAGGERATION;
          const idx = r * cols + c;
          positions[idx * 3] = u.ux * rad;
          positions[idx * 3 + 1] = u.uy * rad;
          positions[idx * 3 + 2] = u.uz * rad;
          uvs[idx * 2] = uFrac;
          uvs[idx * 2 + 1] = vFrac;
        }
      }

      const indices = [];
      for (let r = 0; r < segLat; r++) {
        for (let c = 0; c < segLon; c++) {
          const a = r * cols + c;
          const b = a + 1;
          const cIdx = (r + 1) * cols + c;
          const d = cIdx + 1;
          indices.push(a, b, d, a, d, cIdx);
        }
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
      geom.setIndex(indices);
      geom.computeVertexNormals();

      // Build crisp 1440x720 tangent-space normal map directly from MOLA elevation gradients
      const nw = 1440;
      const nh = 720;
      const nData = new Uint8Array(nw * nh * 4);
      const dLon = 360 / nw;
      const dLat = 180 / nh;
      const cellSpanM = (MARS_CIRCUMFERENCE_M / nw) * 0.45;
      for (let r = 0; r < nh; r++) {
        // v = r / (nh - 1) maps -90 (south) .. +90 (north) matching flipY=false
        const lat = -90 + (r + 0.5) * dLat;
        const latN = Math.min(89.8, lat + dLat);
        const latS = Math.max(-89.8, lat - dLat);
        const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
        for (let c = 0; c < nw; c++) {
          const lon = -180 + (c + 0.5) * dLon;
          const eW = marsGlobal.sampleElevM(lon - dLon, lat);
          const eE = marsGlobal.sampleElevM(lon + dLon, lat);
          const eS = marsGlobal.sampleElevM(lon, latS);
          const eN = marsGlobal.sampleElevM(lon, latN);
          const gx = ((eE - eW) / (2 * cellSpanM * cosLat)) * 11.5;
          const gy = ((eN - eS) / (2 * cellSpanM)) * 11.5;
          const inv = 1 / (Math.hypot(-gx, -gy, 1) || 1);
          const o = (r * nw + c) * 4;
          nData[o] = Math.max(0, Math.min(255, Math.round((-gx * inv * 0.5 + 0.5) * 255)));
          nData[o + 1] = Math.max(0, Math.min(255, Math.round((-gy * inv * 0.5 + 0.5) * 255)));
          nData[o + 2] = Math.max(0, Math.min(255, Math.round((inv * 0.5 + 0.5) * 255)));
          nData[o + 3] = 255;
        }
      }
      const normalTex = new THREE.DataTexture(nData, nw, nh, THREE.RGBAFormat);
      normalTex.flipY = false;
      normalTex.wrapS = THREE.RepeatWrapping;
      normalTex.wrapT = THREE.ClampToEdgeWrapping;
      normalTex.needsUpdate = true;

      const makeTex = (src) => {
        if (!src) return null;
        const t = new THREE.Texture(src);
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        t.anisotropy = Math.min(8, glRenderer.capabilities.getMaxAnisotropy?.() || 4);
        t.needsUpdate = true;
        return t;
      };

      const vikingTex = makeTex(vikingImgEl) || makeTex(globalMarsBases?.elevCanvas);
      const molaShadedTex = makeTex(molaShadedImgEl) || makeTex(globalMarsBases?.elevCanvas);
      const hazardTex = makeTex(globalMarsBases?.hazCanvas) || vikingTex;

      const mat = new THREE.MeshStandardMaterial({
        map: vikingTex,
        normalMap: normalTex,
        normalScale: new THREE.Vector2(2.35, 2.35),
        roughness: 0.9,
        metalness: 0.03,
      });

      const globeMesh = new THREE.Mesh(geom, mat);
      glScene.add(globeMesh);

      const hemiLight = new THREE.HemisphereLight(0xffdfc4, 0x24120c, 0.58);
      glScene.add(hemiLight);
      const sunLight = new THREE.DirectionalLight(0xfff1e0, 2.35);
      glScene.add(sunLight);

      const raycaster = new THREE.Raycaster();
      const _camRight = new THREE.Vector3();
      const _camUp = new THREE.Vector3();
      const _camFwd = new THREE.Vector3();
      const _sunV = new THREE.Vector3();
      const _pt = new THREE.Vector3();
      let lastKey = "";

      const syncCamera = (cLon, cLat, zoom) => {
        const zClamped = Math.max(0.85, Math.min(3.2, zoom));
        const u = lonLatToUnitVec(cLon, cLat);
        const camDist = 3.65 / zClamped;
        glCam.position.set(u.ux * camDist, u.uy * camDist, u.uz * camDist);
        glCam.up.set(0, 1, 0);
        glCam.lookAt(0, 0, 0);
        glCam.updateMatrixWorld();

        // Keep directional Sun offset ~34 deg East-North relative to current view so shadows show crisp 3D relief
        _camFwd.copy(glCam.position).normalize();
        _camRight.crossVectors(glCam.up, _camFwd).normalize();
        _camUp.crossVectors(_camFwd, _camRight).normalize();
        _sunV
          .copy(_camFwd)
          .multiplyScalar(0.84)
          .addScaledVector(_camRight, 0.44)
          .addScaledVector(_camUp, 0.34)
          .normalize();
        sunLight.position.copy(_sunV).multiplyScalar(10);
      };

      const render = (cLon, cLat, zoom, layerMode) => {
        const targetTex =
          layerMode === "hazard" ? hazardTex : layerMode === "mola" ? molaShadedTex : vikingTex;
        if (targetTex && mat.map !== targetTex) {
          mat.map = targetTex;
          mat.needsUpdate = true;
        }
        const key = `${cLon.toFixed(3)}|${cLat.toFixed(3)}|${zoom.toFixed(3)}|${layerMode}`;
        if (key !== lastKey) {
          syncCamera(cLon, cLat, zoom);
          glRenderer.render(glScene, glCam);
          lastKey = key;
        }
        return glRenderer.domElement;
      };

      const raycastScreen = (uNorm, vNorm, cLon, cLat, zoom) => {
        syncCamera(cLon, cLat, zoom);
        raycaster.setFromCamera({ x: uNorm * 2 - 1, y: -(vNorm * 2 - 1) }, glCam);
        const hits = raycaster.intersectObject(globeMesh, false);
        if (!hits.length) return null;
        const pt = hits[0].point.clone().normalize();
        return unitVecToLonLat(pt.x, pt.y, pt.z);
      };

      const projectLonLat = (lon, lat, W, H, cLon, cLat, zoom) => {
        syncCamera(cLon, cLat, zoom);
        const u = lonLatToUnitVec(lon, lat);
        const altM = marsGlobal.sampleElevM(lon, lat);
        const rad = 1.0 + (altM / MARS_RADIUS_MEAN_M) * EXAGGERATION;
        _pt.set(u.ux * rad, u.uy * rad, u.uz * rad);
        const toCamX = glCam.position.x - _pt.x;
        const toCamY = glCam.position.y - _pt.y;
        const toCamZ = glCam.position.z - _pt.z;
        const visible = u.ux * toCamX + u.uy * toCamY + u.uz * toCamZ > 0.05;
        _pt.project(glCam);
        return {
          x: (_pt.x * 0.5 + 0.5) * W,
          y: (-_pt.y * 0.5 + 0.5) * H,
          visible,
        };
      };

      return {
        canvas: glRenderer.domElement,
        render,
        raycastScreen,
        projectLonLat,
      };
    } catch {
      return null;
    }
  })();

  if (isDemoSphere && mapScopeRowEl) {
    mapScopeRowEl.style.display = "flex";
  }
  if (isDemoSphere && mapLandmarksEl) {
    mapLandmarksEl.style.display = "flex";
    const populateLandmarks = () => {
      const tr = isTrLang();
      mapLandmarksEl.innerHTML = "";
      for (const lm of MARS_LANDMARKS) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "hud-btn hud-map-lm-btn";
        b.textContent = tr ? lm.nameTr : lm.nameEn;
        b.addEventListener("click", () => {
          globeCenterLon = lm.lon;
          globeCenterLat = Math.max(-85, Math.min(85, lm.lat));
          pendingTeleport = formatLonLatMetrics(lm.lon, lm.lat);
          updatePendingConfirmCard();
          renderTacticalMap();
        });
        mapLandmarksEl.appendChild(b);
      }
    };
    populateLandmarks();
  }

  function syncMapStaticText() {
    const tr = isTrLang();
    const tEl = document.getElementById("hud-map-title");
    const sEl = document.getElementById("hud-map-sub");
    const etEl = document.getElementById("hud-map-elev-title");
    const cnEl = document.getElementById("hud-map-contour-note");
    const ktEl = document.getElementById("hud-map-key-title");
    const elevMaxLabel = document.getElementById("hud-map-elev-max");
    const elevMidLabel = document.getElementById("hud-map-elev-mid");
    const elevMinLabel = document.getElementById("hud-map-elev-min");

    if (isDemoSphere) {
      const isInitial = awaitingInitialLanding;
      if (mapOverlayEl) mapOverlayEl.classList.toggle("landing-hero", isInitial);
      if (mapCloseBtn) mapCloseBtn.style.display = isInitial ? "none" : "";
      if (mapLockBadgeEl) {
        mapLockBadgeEl.style.display = isInitial ? "inline-flex" : "none";
        mapLockBadgeEl.textContent = tr ? "ZORUNLU İNİŞ SEÇİMİ" : "LANDING REQUIRED";
      }
      if (tEl) {
        if (isInitial) {
          tEl.textContent = tr
            ? "MARS YÖRÜNGE İNİŞİ — BAŞLANGIÇ NOKTANI SEÇ"
            : "MARS ORBITAL DEPLOYMENT — CHOOSE LANDING SITE";
        } else if (mapScope === "globe") {
          tEl.textContent = tr ? "MARS GEZEGENİ — 3B KÜRE HARİTASI (R = 3.389,5 km)" : "PLANET MARS — 3D SPHERE GLOBE (R = 3,389.5 km)";
        } else if (mapScope === "world") {
          tEl.textContent = tr ? "MARS GEZEGENİ — KÜRESEL MOLA YÜKSELTİ HARİTASI" : "PLANET MARS — GLOBAL MOLA TOPOGRAPHY";
        } else {
          tEl.textContent = tr ? "GALE KRATERİ / MOUNT SHARP — HiRISE YEREL HARİTA" : "GALE CRATER / MOUNT SHARP — HiRISE LOCAL MAP";
        }
      }
      if (sEl) {
        if (isInitial) {
          sEl.textContent = tr
            ? "KÜREYİ ÇEVİR VE İNMEK İSTEDİĞİN NOKTAYA TIKLA (VEYA KEŞİF NOKTASI SEÇ) · İNİŞ SEÇMEDEN ÇIKILAMAZ"
            : "SPIN THE GLOBE & CLICK ANY LANDING COORDINATE (OR PICK A SITE ABOVE) · LANDING PICK REQUIRED";
        } else if (mapScope === "globe") {
          sEl.textContent = tr
            ? "SÜRÜKLE: KÜREYİ ÇEVİR · TIKLA: GEZEGENDEN HERHANGİ BİR NOKTAYA IŞINLAN · SINIR YOK"
            : "DRAG: SPIN MARS GLOBE · CLICK: TELEPORT ANYWHERE ON MARS · NO EDGES";
        } else if (mapScope === "world") {
          sEl.textContent = tr
            ? "360° × 180° GERÇEK MARS BOYUTU (ÇEVRE 21.297 km) · IŞINLANMAK İÇİN TIKLA"
            : "360° × 180° REAL MARS SCALE (21,297 km CIRCUMFERENCE) · CLICK ANYWHERE TO TELEPORT";
        } else {
          sEl.textContent = tr
            ? "HiRISE 1 m DTM ALANI · KÜRESEL ARAZİYLE KESİNTİSİZ BİRLEŞİK · IŞINLANMAK İÇİN TIKLA"
            : "HiRISE 1 m DTM PATCH · SEAMLESSLY BLENDED INTO SPHERICAL MARS · CLICK TO TELEPORT";
        }
      }
      if (etEl) etEl.textContent = tr ? "MOLA 3B YÜKSELTİ (m)" : "MOLA 3D ELEVATION (m)";
      if (mapScope === "local") {
        if (elevMaxLabel) elevMaxLabel.textContent = `${Math.round(mapBases.maxE)} m`;
        if (elevMidLabel) elevMidLabel.textContent = `${Math.round((mapBases.minE + mapBases.maxE) * 0.5)} m`;
        if (elevMinLabel) elevMinLabel.textContent = `${Math.round(mapBases.minE)} m`;
        if (cnEl) {
          cnEl.textContent = tr
            ? "20 m ara / 60 m ana eşyükselti eğrileri · küresel Mars kabartmasına bağlı."
            : "20 m minor / 60 m major contours · seamlessly anchored on the spherical Mars globe.";
        }
      } else {
        if (elevMaxLabel) elevMaxLabel.textContent = "+21,159 m";
        if (elevMidLabel) elevMidLabel.textContent = "+6,512 m";
        if (elevMinLabel) elevMinLabel.textContent = "-8,135 m";
        if (cnEl) {
          cnEl.textContent = tr
            ? "Gerçek NASA MGS MOLA 16ppd + Viking MDIM 2.1 + MOLA Kabartma · Olympus (+21.2 km) → Hellas (-8.1 km)."
            : "Real NASA MGS MOLA 16ppd + Viking MDIM 2.1 + MOLA Relief · Olympus (+21.2 km) → Hellas (-8.1 km).";
        }
      }
      if (ktEl) ktEl.textContent = tr ? "İŞARETLER VE KÜRE" : "MARKERS & GLOBE";
      if (mapScopeGlobeBtn) {
        mapScopeGlobeBtn.textContent = tr ? "Mars 3B Küre" : "Mars 3D Globe";
        mapScopeGlobeBtn.classList.toggle("active", mapScope === "globe");
      }
      if (mapScopeWorldBtn) {
        mapScopeWorldBtn.textContent = tr ? "Mars 2B (360°)" : "Mars 2D (360°)";
        mapScopeWorldBtn.classList.toggle("active", mapScope === "world");
      }
      if (mapScopeLocalBtn) {
        mapScopeLocalBtn.textContent = tr ? "Gale (2 km)" : "Gale (2 km)";
        mapScopeLocalBtn.classList.toggle("active", mapScope === "local");
      }
    } else {
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
    }

    if (mapModeBtn) {
      const molaLabel = tr ? "Katman: MOLA Kabartma 3B" : "Layer: MOLA Relief 3D";
      const hazLabel = tr ? "Katman: Eğim Tehlikesi" : "Layer: Slope Hazard";
      const elevLabel =
        isDemoSphere && mapScope !== "local"
          ? tr
            ? "Katman: Viking + MOLA 3B"
            : "Layer: Viking + MOLA 3D"
          : tr
            ? "Katman: Yükselti 3B"
            : "Layer: Elevation 3D";
      mapModeBtn.textContent = mapLayerMode === "mola" ? molaLabel : mapLayerMode === "hazard" ? hazLabel : elevLabel;
    }
    if (mapCloseBtn) mapCloseBtn.textContent = tr ? "Kapat (M)" : "Close (M)";
    if (mapConfirmQEl) {
      mapConfirmQEl.textContent = awaitingInitialLanding
        ? tr
          ? "Bu koordinata iniş yapmak istiyor musun?"
          : "Deploy and land at this site?"
        : tr
          ? "Buraya ışınlanmak istiyor musun?"
          : "Do you want to teleport here?";
    }
    if (mapConfirmYesBtn) {
      mapConfirmYesBtn.textContent = awaitingInitialLanding
        ? tr
          ? "Evet, Buraya İn"
          : "Yes, Land Here"
        : tr
          ? "Evet, Işınlan"
          : "Yes, Teleport";
    }
    if (mapConfirmNoBtn) mapConfirmNoBtn.textContent = tr ? "İptal" : "Cancel";
    if (btnMap) btnMap.textContent = isMapOpen() ? (tr ? "Harita: Açık" : "Map (M): ON") : tr ? "Harita (M)" : "Map (M)";
  }

  function formatLonLatMetrics(lonDeg, latDeg) {
    const lon = normalizeLonDeg(lonDeg);
    const lat = Math.max(-89.95, Math.min(89.95, latDeg));
    if (isDemoSphere && marsGlobal) {
      const elevMola = marsGlobal.sampleElevM(lon, lat);
      const slopeDeg = computeLocalSlopeDeg(0, 0, lon, lat);
      const distM = marsDistanceM([playerGeo.lon, playerGeo.lat], [lon, lat]);
      const region = marsGlobal.sampleRegionLabel(lon, lat, isTrLang());
      return { tx: lonToX(lon), tz: latToZ(lat), lon, lat, elevMola, slopeDeg, distM, region };
    }
    return formatPointMetrics(lonToX(lon), latToZ(lat));
  }

  function formatPointMetrics(tx, tz) {
    if (isDemoSphere && marsGlobal) {
      const lon = xToLon(tx);
      const lat = zToLat(tz);
      return formatLonLatMetrics(lon, lat);
    }
    const wx = wrapSceneCoord(tx, worldW).val;
    const wz = wrapSceneCoord(tz, worldH).val;
    const lon = xToLon(wx);
    const lat = zToLat(wz);
    const elevMola = elevMin + sampleElevSceneY(wx, wz);
    const slopeDeg = computeLocalSlopeDeg(wx, wz);
    const distM = Math.hypot(wx - player.x, wz - player.z);
    return { tx: wx, tz: wz, lon, lat, elevMola, slopeDeg, distM };
  }

  function formatDistanceText(distM) {
    return distM >= 2000 ? `${(distM / 1000).toFixed(1)} km` : `${distM.toFixed(0)} m`;
  }

  function updatePendingConfirmCard() {
    if (!mapConfirmEl) return;
    if (!pendingTeleport) {
      mapConfirmEl.style.display = "none";
      return;
    }
    const tr = isTrLang();
    syncMapStaticText();
    const { lon, lat, elevMola, slopeDeg, distM, region } = pendingTeleport;
    const slopeWarn =
      slopeDeg > 20
        ? tr
          ? " · UYARI: >20° DİK YAMAÇ!"
          : " · WARNING: >20° STEEP CLIFF!"
        : "";
    if (mapConfirmMetaEl) {
      const regionLine = region ? `<strong>${region}</strong><br/>` : "";
      mapConfirmMetaEl.innerHTML =
        regionLine +
        `${Math.abs(lat).toFixed(4)}°${lat < 0 ? "S" : "N"}, ${lon.toFixed(4)}°E<br/>` +
        `<strong>${tr ? "3B Yükselti" : "3D Elevation"}:</strong> ${elevMola.toFixed(1)} m MOLA<br/>` +
        `<strong>${tr ? "Eğim" : "Slope"}:</strong> ${slopeDeg.toFixed(1)}°${slopeWarn}<br/>` +
        `<strong>${tr ? "Mesafe" : "Distance"}:</strong> ${formatDistanceText(distM)}`;
    }
    mapConfirmEl.style.display = "block";
  }

  function setMapOpen(open, scopeOverride = null) {
    if (!mapOverlayEl) return;
    const next = Boolean(open);
    if (!next && awaitingInitialLanding) {
      return;
    }
    if (next && isDemoSphere && scopeOverride) {
      mapScope = scopeOverride;
    }
    mapOverlayEl.classList.toggle("open", next);
    if (next) {
      keys.clear();
      dragging = false;
      if (isDemoSphere) {
        globeCenterLon = playerGeo.lon;
        globeCenterLat = Math.max(-75, Math.min(75, playerGeo.lat + 14));
      }
      syncMapStaticText();
      renderTacticalMap();
      requestAnimationFrame(() => renderTacticalMap());
    } else {
      pendingTeleport = null;
      hoverTarget = null;
      if (mapConfirmEl) mapConfirmEl.style.display = "none";
      mapOverlayEl.classList.remove("landing-hero");
      syncMapStaticText();
    }
  }

  btnMap?.addEventListener("click", () => {
    if (awaitingInitialLanding) return;
    setMapOpen(!isMapOpen());
  });
  mapCloseBtn?.addEventListener("click", () => {
    if (awaitingInitialLanding) return;
    setMapOpen(false);
  });
  mapOverlayEl?.addEventListener("click", (e) => {
    if (awaitingInitialLanding) return;
    if (e.target === mapOverlayEl) setMapOpen(false);
  });
  mapModeBtn?.addEventListener("click", () => {
    mapLayerMode = mapLayerMode === "elevation" ? "mola" : mapLayerMode === "mola" ? "hazard" : "elevation";
    syncMapStaticText();
    renderTacticalMap();
  });
  const setMapScope = (nextScope) => {
    if (!isDemoSphere) return;
    mapScope = nextScope;
    hoverTarget = null;
    if (nextScope === "globe") {
      globeCenterLon = playerGeo.lon;
      globeCenterLat = Math.max(-85, Math.min(85, playerGeo.lat));
      globeZoom = 1.0;
    }
    syncMapStaticText();
    renderTacticalMap();
  };
  mapScopeGlobeBtn?.addEventListener("click", () => setMapScope("globe"));
  mapScopeWorldBtn?.addEventListener("click", () => setMapScope("world"));
  mapScopeLocalBtn?.addEventListener("click", () => setMapScope("local"));
  mapConfirmYesBtn?.addEventListener("click", () => {
    if (!pendingTeleport) return;
    awaitingInitialLanding = false;
    if (isDemoSphere) {
      teleportToLonLat(pendingTeleport.lon, pendingTeleport.lat, { keepYaw: true });
    } else {
      teleportToLocal(pendingTeleport.tx, pendingTeleport.tz, { keepYaw: true });
    }
    setMapOpen(false);
  });
  mapConfirmNoBtn?.addEventListener("click", () => {
    pendingTeleport = null;
    updatePendingConfirmCard();
    renderTacticalMap();
  });

  const projectOrthoGlobe = (lonDeg, latDeg, cLonDeg, cLatDeg, cx, cy, rPx) => {
    const d2r = Math.PI / 180;
    const lam = lonDeg * d2r;
    const phi = latDeg * d2r;
    const lam0 = cLonDeg * d2r;
    const phi0 = cLatDeg * d2r;
    const sinP0 = Math.sin(phi0);
    const cosP0 = Math.cos(phi0);
    const sinP = Math.sin(phi);
    const cosP = Math.cos(phi);
    const dLam = lam - lam0;
    const cosD = Math.cos(dLam);
    const sinD = Math.sin(dLam);
    const cosC = sinP0 * sinP + cosP0 * cosP * cosD;
    const x = cx + rPx * cosP * sinD;
    const y = cy - rPx * (cosP0 * sinP - sinP0 * cosP * cosD);
    return { x, y, visible: cosC >= 0, cosC };
  };

  const unprojectOrthoGlobe = (px, py, cLonDeg, cLatDeg, cx, cy, rPx) => {
    const nx = (px - cx) / rPx;
    const ny = (cy - py) / rPx;
    const rho2 = nx * nx + ny * ny;
    if (rho2 > 1) return null;
    const rho = Math.sqrt(rho2);
    const d2r = Math.PI / 180;
    const phi0 = cLatDeg * d2r;
    const lam0 = cLonDeg * d2r;
    if (rho < 1e-6) return { lonDeg: normalizeLonDeg(cLonDeg), latDeg: cLatDeg };
    const c = Math.asin(Math.min(1, rho));
    const sinC = Math.sin(c);
    const cosC = Math.cos(c);
    const sinP0 = Math.sin(phi0);
    const cosP0 = Math.cos(phi0);
    const phi = Math.asin(Math.max(-1, Math.min(1, cosC * sinP0 + (ny * sinC * cosP0) / rho)));
    const lam = lam0 + Math.atan2(nx * sinC, rho * cosP0 * cosC - ny * sinP0 * sinC);
    return { lonDeg: normalizeLonDeg(lam / d2r), latDeg: phi / d2r };
  };

  let mapDragState = null;
  let suppressNextMapClick = false;

  if (mapCanvasEl) {
    const canvasCoords = (e) => {
      const rect = mapCanvasEl.getBoundingClientRect();
      const u = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
      const v = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
      return { u, v, cx: u * mapCanvasEl.width, cy: v * mapCanvasEl.height };
    };
    const pointerToTarget = (e) => {
      const { u, v, cx, cy } = canvasCoords(e);
      if (isDemoSphere && mapScope === "globe") {
        if (globe3DState) {
          const hit3D = globe3DState.raycastScreen(u, v, globeCenterLon, globeCenterLat, globeZoom);
          return hit3D ? formatLonLatMetrics(hit3D.lonDeg, hit3D.latDeg) : null;
        }
        const W = mapCanvasEl.width;
        const H = mapCanvasEl.height;
        const rPx = Math.min(W, H) * 0.415;
        const hit = unprojectOrthoGlobe(cx, cy, globeCenterLon, globeCenterLat, W * 0.5, H * 0.5, rPx);
        return hit ? formatLonLatMetrics(hit.lonDeg, hit.latDeg) : null;
      }
      if (isDemoSphere && mapScope === "world") {
        const lon = -180 + u * 360;
        const lat = 90 - v * 180;
        return formatLonLatMetrics(lon, lat);
      }
      return formatPointMetrics((u - 0.5) * worldW, (v - 0.5) * worldH);
    };

    mapCanvasEl.addEventListener(
      "wheel",
      (e) => {
        if (!isDemoSphere || mapScope !== "globe") return;
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.11;
        globeZoom = Math.max(0.85, Math.min(3.2, globeZoom * factor));
        renderTacticalMap();
      },
      { passive: false }
    );

    mapCanvasEl.addEventListener("pointerdown", (e) => {
      if (isDemoSphere && mapScope === "globe") {
        mapDragState = {
          x: e.clientX,
          y: e.clientY,
          moved: 0,
          lon0: globeCenterLon,
          lat0: globeCenterLat,
        };
      }
    });
    window.addEventListener("pointermove", (e) => {
      if (!mapDragState) return;
      const dx = e.clientX - mapDragState.x;
      const dy = e.clientY - mapDragState.y;
      mapDragState.moved = Math.max(mapDragState.moved, Math.hypot(dx, dy));
      if (mapDragState.moved > 3) {
        const cosLat = Math.max(0.35, Math.cos((mapDragState.lat0 * Math.PI) / 180));
        const dragScale = 0.35 / Math.max(0.85, globeZoom);
        globeCenterLon = normalizeLonDeg(mapDragState.lon0 - (dx * dragScale) / cosLat);
        globeCenterLat = Math.max(-85, Math.min(85, mapDragState.lat0 + dy * dragScale));
        renderTacticalMap();
      }
    });
    window.addEventListener("pointerup", () => {
      if (mapDragState) {
        if (mapDragState.moved > 5) suppressNextMapClick = true;
        mapDragState = null;
      }
    });

    mapCanvasEl.addEventListener("mousemove", (e) => {
      if (mapDragState && mapDragState.moved > 3) return;
      hoverTarget = pointerToTarget(e);
      if (mapHoverEl) {
        if (!hoverTarget) {
          mapHoverEl.textContent = isTrLang()
            ? "Sürükle: Mars küresini döndür · Yüzeye tıkla: ışınlan"
            : "Drag: spin Mars globe · Click surface: teleport";
        } else {
          const tr = isTrLang();
          const { lat, lon, elevMola, slopeDeg, distM, region } = hoverTarget;
          const regPrefix = region ? `${region} · ` : "";
          mapHoverEl.textContent =
            regPrefix +
            `${Math.abs(lat).toFixed(4)}°${lat < 0 ? "S" : "N"}, ${lon.toFixed(4)}°E · ` +
            `${tr ? "YÜKSELTİ" : "3D ELEV"}: ${elevMola.toFixed(1)} m · ` +
            `${tr ? "EĞİM" : "SLOPE"}: ${slopeDeg.toFixed(1)}° · ${formatDistanceText(distM)}`;
        }
      }
      renderTacticalMap();
    });
    mapCanvasEl.addEventListener("mouseleave", () => {
      hoverTarget = null;
      renderTacticalMap();
    });
    mapCanvasEl.addEventListener("click", (e) => {
      if (suppressNextMapClick) {
        suppressNextMapClick = false;
        return;
      }
      const picked = pointerToTarget(e);
      if (!picked) return;
      pendingTeleport = picked;
      updatePendingConfirmCard();
      renderTacticalMap();
    });

    // ---- Controller on the Mars map ----
    // Left stick moves a crosshair over the map; right stick spins the globe (Up/Down tilts the
    // pole axis, Left/Right turns it); LT/RT zoom. A picks the point under the crosshair (a
    // confirm card appears); A again teleports; B cancels the card, then closes the map.
    const padCross = document.createElement("div");
    padCross.className = "pad-crosshair";
    padCross.innerHTML = '<div class="ring"></div>';
    (mapCanvasEl.parentElement || document.body).appendChild(padCross);
    let padCx = 0.5; // crosshair position as a fraction of the canvas (u, v)
    let padCy = 0.5;
    let padLast = performance.now();
    const padFrame = (now) => {
      const dt = Math.min(0.1, (now - padLast) / 1000);
      padLast = now;
      const live = isMapOpen() && gamepad.connected && !document.getElementById("pad-setup")?.classList.contains("open");
      padCross.classList.toggle("on", live && !pendingTeleport);
      if (live) {
        let moved = false;
        const mv = gamepad.move();
        if (mv.x || mv.y) {
          padCx = Math.max(0.03, Math.min(0.97, padCx + mv.x * 0.55 * dt));
          padCy = Math.max(0.03, Math.min(0.97, padCy - mv.y * 0.55 * dt));
          moved = true;
        }
        const lk = gamepad.look();
        if (isDemoSphere && mapScope === "globe" && (lk.x || lk.y)) {
          const cosLat = Math.max(0.35, Math.cos((globeCenterLat * Math.PI) / 180));
          const spin = (95 * dt) / Math.max(0.85, globeZoom);
          globeCenterLon = normalizeLonDeg(globeCenterLon + (lk.x * spin) / cosLat);
          globeCenterLat = Math.max(-85, Math.min(85, globeCenterLat + lk.y * spin));
          moved = true;
        }
        const zi = gamepad.buttons[7] || 0;
        const zo = gamepad.buttons[6] || 0;
        if (isDemoSphere && mapScope === "globe" && (zi > 0.05 || zo > 0.05)) {
          globeZoom = Math.max(0.85, Math.min(3.2, globeZoom * (1 + (zi - zo) * 1.4 * dt)));
          moved = true;
        }
        const rect = mapCanvasEl.getBoundingClientRect();
        const ex = rect.left + padCx * rect.width;
        const ey = rect.top + padCy * rect.height;
        padCross.style.left = `${padCx * 100}%`;
        padCross.style.top = `${padCy * 100}%`;
        if (moved && !pendingTeleport) {
          hoverTarget = pointerToTarget({ clientX: ex, clientY: ey });
          if (mapHoverEl && hoverTarget) {
            const { lat, lon, elevMola, slopeDeg, region } = hoverTarget;
            mapHoverEl.textContent =
              (region ? `${region} · ` : "") +
              `${Math.abs(lat).toFixed(4)}°${lat < 0 ? "S" : "N"}, ${lon.toFixed(4)}°E · ${elevMola.toFixed(1)} m · ${slopeDeg.toFixed(1)}° · A`;
          }
          renderTacticalMap();
        }
      }
      requestAnimationFrame(padFrame);
    };
    requestAnimationFrame(padFrame);

    gamepad.onPress(({ button }) => {
      if (!isMapOpen()) return;
      if (document.getElementById("pad-setup")?.classList.contains("open")) return;
      if (!document.getElementById("start-screen")?.classList.contains("hidden")) return;
      if (button === 0) {
        // A: confirm a pending teleport, otherwise pick the point under the crosshair
        if (pendingTeleport) {
          mapConfirmYesBtn?.click();
        } else {
          const rect = mapCanvasEl.getBoundingClientRect();
          const picked = pointerToTarget({ clientX: rect.left + padCx * rect.width, clientY: rect.top + padCy * rect.height });
          if (picked) {
            pendingTeleport = picked;
            updatePendingConfirmCard();
            renderTacticalMap();
          }
        }
      } else if (button === 1) {
        // B: cancel the confirm card first, then close the map (not during the first landing)
        if (pendingTeleport) mapConfirmNoBtn?.click();
        else if (!awaitingInitialLanding) setMapOpen(false);
      }
    });
  }

  function renderGlobe3D(W, H) {
    if (!globalMarsBases && !globe3DState) return;
    const tr = isTrLang();
    mapCtx.fillStyle = "#06080d";
    mapCtx.fillRect(0, 0, W, H);

    // Subtle background starfield (deterministic)
    mapCtx.fillStyle = "rgba(255,255,255,0.48)";
    for (let i = 0; i < 48; i++) {
      const sx = ((i * 197 + 31) % 997) / 997 * W;
      const sy = ((i * 353 + 79) % 991) / 991 * H;
      mapCtx.fillRect(sx, sy, i % 4 === 0 ? 1.6 : 1, i % 4 === 0 ? 1.6 : 1);
    }

    const cx = W * 0.5;
    const cy = H * 0.5;
    const fovRad = (34 * Math.PI) / 180;
    const camDist = 3.65 / Math.max(0.85, Math.min(3.2, globeZoom));
    const appRadiusPx = globe3DState
      ? ((H * 0.5) / Math.tan(fovRad * 0.5)) * (1 / Math.sqrt(Math.max(0.25, camDist * camDist - 1)))
      : Math.min(W, H) * 0.415;

    // Martian dusty atmosphere limb glow
    const halo = mapCtx.createRadialGradient(cx, cy, appRadiusPx * 0.92, cx, cy, appRadiusPx * 1.15);
    halo.addColorStop(0, "rgba(232, 139, 92, 0.34)");
    halo.addColorStop(0.55, "rgba(184, 96, 58, 0.12)");
    halo.addColorStop(1, "rgba(6, 8, 13, 0)");
    mapCtx.fillStyle = halo;
    mapCtx.beginPath();
    mapCtx.arc(cx, cy, appRadiusPx * 1.15, 0, Math.PI * 2);
    mapCtx.fill();

    const projectPoint = (lon, lat) =>
      globe3DState
        ? globe3DState.projectLonLat(lon, lat, W, H, globeCenterLon, globeCenterLat, globeZoom)
        : projectOrthoGlobe(lon, lat, globeCenterLon, globeCenterLat, cx, cy, appRadiusPx);

    if (globe3DState) {
      const glCanvas = globe3DState.render(globeCenterLon, globeCenterLat, globeZoom, mapLayerMode);
      mapCtx.drawImage(glCanvas, 0, 0, W, H);
    } else if (globeScratch) {
      // Headless / 2D-only fallback sphere
      const rPx = appRadiusPx;
      const S = globeScratch.size;
      const imgData = globeScratch.img;
      const pxOut = imgData.data;
      const texData = mapLayerMode === "hazard" ? globalMarsBases.hData : globalMarsBases.eData;
      const gw = globalMarsBases.width;
      const gh = globalMarsBases.height;
      const d2r = Math.PI / 180;
      const phi0 = globeCenterLat * d2r;
      const lam0 = globeCenterLon * d2r;
      const sinP0 = Math.sin(phi0);
      const cosP0 = Math.cos(phi0);
      const halfS = S * 0.5;
      const invHalf = 1 / halfS;
      const lx = 0.46;
      const ly = 0.38;
      const lz = 0.8;

      for (let py = 0; py < S; py++) {
        const ny = (halfS - py - 0.5) * invHalf;
        for (let px = 0; px < S; px++) {
          const nx = (px + 0.5 - halfS) * invHalf;
          const r2 = nx * nx + ny * ny;
          const o = (py * S + px) * 4;
          if (r2 > 1) {
            pxOut[o + 3] = 0;
            continue;
          }
          const nz = Math.sqrt(1 - r2);
          const rho = Math.sqrt(r2);
          let latDeg = globeCenterLat;
          let lonDeg = globeCenterLon;
          if (rho > 1e-6) {
            const c = Math.asin(Math.min(1, rho));
            const sinC = Math.sin(c);
            const cosC = nz;
            const phi = Math.asin(Math.max(-1, Math.min(1, cosC * sinP0 + (ny * sinC * cosP0) / rho)));
            const lam = lam0 + Math.atan2(nx * sinC, rho * cosP0 * cosC - ny * sinP0 * sinC);
            lonDeg = lam / d2r;
            latDeg = phi / d2r;
          }
          let uIdx = Math.floor(((normalizeLonDeg(lonDeg) + 180) / 360) * gw);
          uIdx = ((uIdx % gw) + gw) % gw;
          const vIdx = Math.max(0, Math.min(gh - 1, Math.floor(((90 - latDeg) / 180) * gh)));
          const ti = (vIdx * gw + uIdx) * 4;

          const ndotl = Math.max(0, nx * lx + ny * ly + nz * lz);
          const limbRim = Math.pow(1 - nz, 2.4);
          const shade = 0.42 + 0.72 * ndotl;

          pxOut[o] = Math.min(255, Math.round(texData[ti] * shade + 195 * limbRim * 0.25));
          pxOut[o + 1] = Math.min(255, Math.round(texData[ti + 1] * shade + 115 * limbRim * 0.25));
          pxOut[o + 2] = Math.min(255, Math.round(texData[ti + 2] * shade + 82 * limbRim * 0.25));
          pxOut[o + 3] = 255;
        }
      }
      globeScratch.ctx.putImageData(imgData, 0, 0);
      mapCtx.save();
      mapCtx.beginPath();
      mapCtx.arc(cx, cy, rPx, 0, Math.PI * 2);
      mapCtx.clip();
      mapCtx.imageSmoothingEnabled = true;
      mapCtx.drawImage(globeScratch.canvas, cx - rPx, cy - rPx, rPx * 2, rPx * 2);
      mapCtx.restore();
    }

    mapCtx.save();
    // 30 deg graticule meridians and parallels on visible hemisphere
    mapCtx.strokeStyle = "rgba(255, 224, 194, 0.15)";
    mapCtx.lineWidth = 1;
    for (let lon = -150; lon <= 180; lon += 30) {
      mapCtx.beginPath();
      let pen = false;
      for (let lat = -85; lat <= 85; lat += 5) {
        const pr = projectPoint(lon, lat);
        if (pr.visible) {
          if (!pen) {
            mapCtx.moveTo(pr.x, pr.y);
            pen = true;
          } else {
            mapCtx.lineTo(pr.x, pr.y);
          }
        } else {
          pen = false;
        }
      }
      mapCtx.stroke();
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      mapCtx.beginPath();
      let pen = false;
      for (let lon = -180; lon <= 180; lon += 5) {
        const pr = projectPoint(lon, lat);
        if (pr.visible) {
          if (!pen) {
            mapCtx.moveTo(pr.x, pr.y);
            pen = true;
          } else {
            mapCtx.lineTo(pr.x, pr.y);
          }
        } else {
          pen = false;
        }
      }
      mapCtx.stroke();
    }

    // Major Mars landmarks
    mapCtx.font = "600 10px monospace";
    for (const lm of MARS_LANDMARKS) {
      const pr = projectPoint(lm.lon, lm.lat);
      if (!pr.visible) continue;
      const isGale = lm.id === "gale";
      mapCtx.beginPath();
      mapCtx.arc(pr.x, pr.y, isGale ? 5 : 3.5, 0, Math.PI * 2);
      mapCtx.fillStyle = isGale ? "#4ade80" : "#fde68a";
      mapCtx.fill();
      mapCtx.strokeStyle = "#000000";
      mapCtx.lineWidth = 1.2;
      mapCtx.stroke();

      const label = tr ? lm.nameTr : lm.nameEn;
      const tw = mapCtx.measureText(label).width;
      const lxTxt = Math.min(W - tw - 10, pr.x + 7);
      const lyTxt = Math.max(16, pr.y - 5);
      mapCtx.fillStyle = "rgba(6, 8, 13, 0.72)";
      mapCtx.fillRect(lxTxt - 3, lyTxt - 9, tw + 6, 13);
      mapCtx.fillStyle = isGale ? "#bbf7d0" : "#fef3c7";
      mapCtx.fillText(label, lxTxt, lyTxt + 1);
    }

    // Pending teleport crosshair / hover marker
    if (pendingTeleport) {
      const pr = projectPoint(pendingTeleport.lon, pendingTeleport.lat);
      if (pr.visible) {
        mapCtx.strokeStyle = "#fbbf24";
        mapCtx.lineWidth = 2;
        mapCtx.beginPath();
        mapCtx.arc(pr.x, pr.y, 9, 0, Math.PI * 2);
        mapCtx.moveTo(pr.x - 14, pr.y);
        mapCtx.lineTo(pr.x + 14, pr.y);
        mapCtx.moveTo(pr.x, pr.y - 14);
        mapCtx.lineTo(pr.x, pr.y + 14);
        mapCtx.stroke();
      }
    } else if (hoverTarget) {
      const pr = projectPoint(hoverTarget.lon, hoverTarget.lat);
      if (pr.visible) {
        mapCtx.strokeStyle = "rgba(255,255,255,0.7)";
        mapCtx.lineWidth = 1.2;
        mapCtx.beginPath();
        mapCtx.arc(pr.x, pr.y, 7, 0, Math.PI * 2);
        mapCtx.stroke();
      }
    }

    // Astronaut position + gaze direction on globe
    const pPr = projectPoint(playerGeo.lon, playerGeo.lat);
    if (pPr.visible) {
      const totalYaw = autoYaw + userYaw;
      const ahead = stepOnMarsSphere(playerGeo.lon, playerGeo.lat, playerGeo.altM, -Math.sin(totalYaw) * 90000, -Math.cos(totalYaw) * 90000, totalYaw);
      const aPr = projectPoint(ahead.lonDeg, ahead.latDeg);
      const ang = Math.atan2(aPr.y - pPr.y, aPr.x - pPr.x);
      mapCtx.beginPath();
      mapCtx.moveTo(pPr.x, pPr.y);
      mapCtx.arc(pPr.x, pPr.y, 26, ang - 0.45, ang + 0.45);
      mapCtx.closePath();
      mapCtx.fillStyle = "rgba(56, 189, 248, 0.42)";
      mapCtx.fill();

      mapCtx.beginPath();
      mapCtx.arc(pPr.x, pPr.y, 6, 0, Math.PI * 2);
      mapCtx.fillStyle = "#38bdf8";
      mapCtx.fill();
      mapCtx.lineWidth = 2;
      mapCtx.strokeStyle = "#ffffff";
      mapCtx.stroke();
    }
    mapCtx.restore();

    mapCtx.fillStyle = "rgba(10, 6, 4, 0.78)";
    mapCtx.fillRect(10, H - 30, 326, 20);
    mapCtx.fillStyle = "#f7dec4";
    mapCtx.font = "bold 10px monospace";
    mapCtx.fillText(
      tr
        ? `R = 3.389,5 km · MOLA 3B KABARTMA · YAKINLAŞTIR: ${globeZoom.toFixed(1)}×`
        : `R = 3,389.5 km · MOLA 3D RELIEF · ZOOM: ${globeZoom.toFixed(1)}×`,
      18,
      H - 16
    );
    mapCtx.fillText("N ↑", W - 32, 20);
  }

  function renderGlobalMars2D(W, H) {
    if (!globalMarsBases) return;
    const tr = isTrLang();
    const img =
      mapLayerMode === "hazard"
        ? globalMarsBases.hazCanvas
        : mapLayerMode === "mola" && molaShadedImgEl
          ? molaShadedImgEl
          : globalMarsBases.elevCanvas;
    mapCtx.clearRect(0, 0, W, H);
    mapCtx.imageSmoothingEnabled = true;
    mapCtx.drawImage(img, 0, 0, W, H);

    // 30° lat / 60° lon graticule
    mapCtx.strokeStyle = "rgba(255, 224, 194, 0.16)";
    mapCtx.lineWidth = 1;
    for (let lon = -120; lon <= 120; lon += 60) {
      const x = ((lon + 180) / 360) * W;
      mapCtx.beginPath();
      mapCtx.moveTo(x, 0);
      mapCtx.lineTo(x, H);
      mapCtx.stroke();
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const y = ((90 - lat) / 180) * H;
      mapCtx.beginPath();
      mapCtx.moveTo(0, y);
      mapCtx.lineTo(W, y);
      mapCtx.stroke();
    }

    const toXY = (lon, lat) => [
      ((normalizeLonDeg(lon) + 180) / 360) * W,
      ((90 - Math.max(-90, Math.min(90, lat))) / 180) * H,
    ];

    mapCtx.font = "600 10px monospace";
    for (const lm of MARS_LANDMARKS) {
      const [lx, ly] = toXY(lm.lon, lm.lat);
      const isGale = lm.id === "gale";
      mapCtx.beginPath();
      mapCtx.arc(lx, ly, isGale ? 5 : 3.5, 0, Math.PI * 2);
      mapCtx.fillStyle = isGale ? "#4ade80" : "#fde68a";
      mapCtx.fill();
      mapCtx.strokeStyle = "#000000";
      mapCtx.lineWidth = 1.2;
      mapCtx.stroke();

      const label = tr ? lm.nameTr : lm.nameEn;
      const tw = mapCtx.measureText(label).width;
      const tx = Math.min(W - tw - 8, lx + 6);
      const ty = Math.max(13, ly - 5);
      mapCtx.fillStyle = "rgba(0,0,0,0.74)";
      mapCtx.fillRect(tx - 3, ty - 9, tw + 6, 13);
      mapCtx.fillStyle = isGale ? "#bbf7d0" : "#fef3c7";
      mapCtx.fillText(label, tx, ty + 1);
    }

    if (pendingTeleport) {
      const [px, py] = toXY(pendingTeleport.lon, pendingTeleport.lat);
      mapCtx.strokeStyle = "#fbbf24";
      mapCtx.lineWidth = 2;
      mapCtx.beginPath();
      mapCtx.arc(px, py, 9, 0, Math.PI * 2);
      mapCtx.moveTo(px - 14, py);
      mapCtx.lineTo(px + 14, py);
      mapCtx.moveTo(px, py - 14);
      mapCtx.lineTo(px, py + 14);
      mapCtx.stroke();
    }

    const [ax, ay] = toXY(playerGeo.lon, playerGeo.lat);
    const totalYaw = autoYaw + userYaw;
    const coneAngle = Math.atan2(-Math.cos(totalYaw), -Math.sin(totalYaw));
    mapCtx.beginPath();
    mapCtx.moveTo(ax, ay);
    mapCtx.arc(ax, ay, 24, coneAngle - 0.5, coneAngle + 0.5);
    mapCtx.closePath();
    mapCtx.fillStyle = "rgba(56, 189, 248, 0.44)";
    mapCtx.fill();
    mapCtx.beginPath();
    mapCtx.arc(ax, ay, 5.5, 0, Math.PI * 2);
    mapCtx.fillStyle = "#38bdf8";
    mapCtx.fill();
    mapCtx.lineWidth = 1.8;
    mapCtx.strokeStyle = "#ffffff";
    mapCtx.stroke();

    mapCtx.fillStyle = "rgba(10, 6, 4, 0.78)";
    mapCtx.fillRect(10, H - 30, 260, 20);
    mapCtx.fillStyle = "#f7dec4";
    mapCtx.font = "bold 10px monospace";
    mapCtx.fillText("360° × 180° · C = 21,297 km", 18, H - 16);
    mapCtx.fillText("N ↑", W - 32, 20);
  }

  function renderTacticalMap() {
    if (!mapCtx || !mapCanvasEl || !isMapOpen()) return;
    const W = mapCanvasEl.width;
    const H = mapCanvasEl.height;
    if (isDemoSphere && mapScope === "globe") {
      renderGlobe3D(W, H);
      return;
    }
    if (isDemoSphere && mapScope === "world") {
      renderGlobalMars2D(W, H);
      return;
    }

    const baseImg =
      mapLayerMode === "mola"
        ? mapBases.molaCanvas
        : mapLayerMode === "hazard"
          ? mapBases.hazCanvas
          : mapBases.elevCanvas;

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

    if (!isDemoSphere) {
      // Wrap-around border frame cue (flat wrap mode only)
      mapCtx.save();
      mapCtx.setLineDash([6, 5]);
      mapCtx.strokeStyle = "rgba(245, 198, 146, 0.45)";
      mapCtx.lineWidth = 2;
      mapCtx.strokeRect(3, 3, W - 6, H - 6);
      mapCtx.restore();
    }

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
    const astroX = isDemoSphere ? lonToX(playerGeo.lon) : player.x;
    const astroZ = isDemoSphere ? latToZ(playerGeo.lat) : player.z;
    const [ax, ay] = toCanvasXY(astroX, astroZ);
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
      if (!awaitingInitialLanding) setMapOpen(!isMapOpen());
      return;
    }
    if (e.key === "Escape" && isMapOpen()) {
      e.preventDefault();
      if (!awaitingInitialLanding) setMapOpen(false);
      return;
    }
    if (isMapOpen()) return;

    if (k === "t" && !e.repeat) {
      e.preventDefault();
      setTexMode((texMode + 1) % TEX.length);
      return;
    }

    keys.add(k);
    if (k === "p") {
      dropLocalPing("EVA Waypoint");
    }
    if (k === " ") {
      e.preventDefault();
      doJump();
    }
  });

  function doJump() {
    if (!player.grounded) return;
    player.vy = JUMP_SPEED_MS;
    player.grounded = false;
    const jumpYaw = autoYaw + userYaw;
    _dustMoveVec.set(-Math.sin(jumpYaw), 0, -Math.cos(jumpYaw));
    resolvePlayerGroundContact(player.x, player.z, _dustPlayerGroundPos, _dustPlayerNrm);
    dustFx.emitTakeoff(_dustPlayerGroundPos, _dustPlayerNrm, _dustMoveVec);
  }

  // Controller buttons in the 3D view (layout and rebinding live in shared/gamepad.js)
  const padSetupEl = () => document.getElementById("pad-setup");
  gamepad.onPress(({ button, actions }) => {
    if (!hudView.classList.contains("active")) return;
    if (padSetupEl()?.classList.contains("open")) return;
    if (!document.getElementById("start-screen")?.classList.contains("hidden")) return;
    if (document.getElementById("modal-backdrop")?.classList.contains("open")) return;
    if (isMapOpen()) return; // the map has its own controller handling (below)
    for (const a of actions) {
      if (a === "jump") doJump();
      else if (a === "pin") dropLocalPing("Landmark");
      else if (a === "texture") setTexMode((texMode + 1) % TEX.length);
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
      if (isDemoSphere && marsGlobal) {
        const regName = marsGlobal.sampleRegionLabel(lon, lat, isTrLang());
        const altM = marsGlobal.sampleElevM(lon, lat);
        viewLabelEl.textContent = `${regName} · ${altM.toFixed(0)}m · ${Math.abs(lat).toFixed(4)}°${latHem} ${lon.toFixed(4)}°E`;
      } else {
        viewLabelEl.textContent = `GALE CRATER · MOUNT SHARP · ${Math.abs(lat).toFixed(4)}°${latHem} ${lon.toFixed(4)}°E`;
      }
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
      clockEl.textContent = `T+${hh}:${mm}:${ss}  (WALK-TIME PLACEHOLDER)`;
    }

    if (btnPov && nextStop) {
      btnPov.onclick = () => {
        const entry = povIndex?.stops?.find((s) => s.stop_id === nextStop.properties.id) || povIndex?.stops?.[0];
        if (entry) onOpenPov(entry);
      };
    }
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

    const strength = cfg.frameEffect ? cfg.frameStrength : 0;
    lensMat.uniforms.uFrameZoom.value = cfg.frameEffect ? 1.0 - 0.12 * Math.min(1, strength) : 1.0;
    lensMat.uniforms.uDistort.value = 0.26 * strength;
    lensMat.uniforms.uAberration.value = 0.006 * strength;
    lensMat.uniforms.uVignette.value = 1.05 * strength;
    lensMat.uniforms.uGrain.value = cfg.superGraphics ? 0.025 * strength : 0.07 * strength;

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

    const baseNormal = isDemoSphere ? 0.78 : 0.62;
    terrainMat.normalScale.set(wantSuper ? 0.95 : baseNormal, wantSuper ? 0.95 : baseNormal);
    superDetailUniform.value = wantSuper ? 1.0 : 0.0;
    sun.intensity = wantSuper ? 3.95 : 3.6;
    hemiLight.intensity = wantSuper ? 0.28 : 0.22;
    renderer.toneMappingExposure = wantSuper ? 1.06 : 1.0;
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

  const _sNorm = new THREE.Vector3(0, 1, 0);
  const _qSphereTilt = new THREE.Quaternion();
  const _qLocalYaw = new THREE.Quaternion();
  const _qCamHead = new THREE.Quaternion();
  const _eulerCam = new THREE.Euler(0, 0, 0, "YXZ");
  const _rNorm = new THREE.Vector3(0, 1, 0);
  const _qRemoteTilt = new THREE.Quaternion();
  const _qRemoteYaw = new THREE.Quaternion();

  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min(0.1, (now - prevT) / 1000);
    prevT = now;
    clockT += dt;
    if (!hudView.classList.contains("active")) return; // do not render while hidden

    // controller look (right stick): about 150 deg/s across, 110 deg/s up/down at full tilt
    const padOpen =
      document.getElementById("pad-setup")?.classList.contains("open") ||
      !document.getElementById("start-screen")?.classList.contains("hidden") ||
      isMapOpen();
    const lk = padOpen ? { x: 0, y: 0 } : gamepad.look();
    if (lk.x || lk.y) {
      userYaw -= lk.x * 2.6 * dt;
      pitch = Math.max(-1.35, Math.min(1.42, pitch + lk.y * 1.9 * dt));
    }

    // progress along the route = the route point nearest to you (for the HUD only)
    if (isDemoSphere) {
      const distFromRouteM =
        routeCoords.length > 0 ? marsDistanceM([routeCoords[0][0], routeCoords[0][1]], [playerGeo.lon, playerGeo.lat]) : Infinity;
      if (routeCoords.length > 1 && distFromRouteM < 15000) {
        const nearestGeomS = closestAlongM(routeCoords, cumDist, playerGeo.lon, playerGeo.lat);
        alongM = geomTotalDist > 0 ? (nearestGeomS / geomTotalDist) * totalDist : 0;
      } else {
        alongM = 0;
      }
    } else {
      alongM = nearestAlongRoute(freePos.x, freePos.z, alongM);
    }
    const sample = sampleAlongRoute(routeCoords, cumDist, toGeomDist(alongM));
    let px;
    let py;
    let pz;
    let ground;
    let sphereStepM = 0;
    let sphereGaitDir = null;
    let landingImpactSpeed = 0;

    if (isDemoSphere && marsGlobal) {
      let moveE = 0;
      let moveN = 0;
      if (!isMapOpen()) {
        const run = keys.has("shift") || (!padOpen && gamepad.isDown("run"));
        const stick = padOpen ? { x: 0, y: 0 } : gamepad.move();
        const stickMag = Math.min(1, Math.hypot(stick.x, stick.y));
        const sinY = Math.sin(userYaw);
        const cosY = Math.cos(userYaw);
        const fE = -sinY;
        const fN = cosY;
        const rE = cosY;
        const rN = sinY;
        if (keys.has("w") || keys.has("arrowup")) {
          moveE += fE;
          moveN += fN;
        }
        if (keys.has("s") || keys.has("arrowdown")) {
          moveE -= fE;
          moveN -= fN;
        }
        if (keys.has("d") || keys.has("arrowright")) {
          moveE += rE;
          moveN += rN;
        }
        if (keys.has("a") || keys.has("arrowleft")) {
          moveE -= rE;
          moveN -= rN;
        }
        let pace = 1;
        if (moveE === 0 && moveN === 0 && stickMag > 0) {
          // analog stick: forward is stick up; walk slower when the stick is only partly pushed
          moveE = fE * stick.y + rE * stick.x;
          moveN = fN * stick.y + rN * stick.x;
          pace = stickMag;
        }
        const mLen = Math.hypot(moveE, moveN);
        if (mLen > 0) {
          moveE /= mLen;
          moveN /= mLen;
          const hereAlt = marsGlobal.sampleElevM(playerGeo.lon, playerGeo.lat);
          const aheadGeo = stepOnMarsSphere(playerGeo.lon, playerGeo.lat, hereAlt, moveE * 1.5, moveN * 1.5, userYaw);
          const aheadAlt = marsGlobal.sampleElevM(aheadGeo.lonDeg, aheadGeo.latDeg);
          const slopeDeg = Math.abs(Math.atan2(aheadAlt - hereAlt, 1.5)) * (180 / Math.PI);
          const slowdown = Math.min(1, Math.max(0.35, 1 - Math.max(0, slopeDeg - 10) / 22));
          const v =
            (run ? RUN_SPEED_MS : WALK_SPEED_MS) *
            pace *
            (devCfg.speedMultiplier || 1) *
            slowdown *
            (player.grounded ? 1 : 0.6);
          const distStep = v * dt;
          if (distStep > 0) {
            const nextGeo = stepOnMarsSphere(
              playerGeo.lon,
              playerGeo.lat,
              playerGeo.altM,
              moveE * distStep,
              moveN * distStep,
              userYaw
            );
            playerGeo.lon = nextGeo.lonDeg;
            playerGeo.lat = nextGeo.latDeg;
            userYaw += nextGeo.deltaYawRad;
            sphereStepM = distStep;
            const bSin = Math.sin(userYaw);
            const bCos = Math.cos(userYaw);
            sphereGaitDir = {
              f: moveE * -bSin + moveN * bCos,
              s: moveE * bCos + moveN * bSin,
            };
          }
        }
      }

      // Radial Mars gravity along sphere altitude `playerGeo.altM` (invariant under origin rebase)
      const groundAltM = marsGlobal.sampleElevM(playerGeo.lon, playerGeo.lat);
      if (!player.init || justTeleportedOrWrapped) {
        if (justTeleportedOrWrapped) dustFx.clear();
        playerGeo.altM = groundAltM;
        player.vy = 0;
        player.grounded = true;
        player.init = true;
      }
      const prevGrounded = player.grounded;
      const prevVy = player.vy;
      if (player.grounded && playerGeo.altM - groundAltM > 0.25) {
        player.grounded = false;
      }
      if (!player.grounded) {
        player.vy -= MARS_G * dt;
        playerGeo.altM += player.vy * dt;
        if (playerGeo.altM <= groundAltM) {
          playerGeo.altM = groundAltM;
          player.vy = 0;
          player.grounded = true;
          if (!prevGrounded && !justTeleportedOrWrapped) {
            landingImpactSpeed = Math.max(1.2, Math.abs(prevVy));
          }
        }
      } else {
        playerGeo.altM = groundAltM;
      }

      // Project to local WebGL tangent frame & silently rebase before Float32 drift (>140 m)
      let proj = marsLonLatAltToLocalScene(
        playerGeo.lon,
        playerGeo.lat,
        playerGeo.altM,
        sphereOrigin.lonDeg,
        sphereOrigin.latDeg,
        sphereOrigin.elevM
      );
      if (Math.hypot(proj.x, proj.z) > 140) {
        rebaseSphereOrigin(playerGeo.lon, playerGeo.lat);
        proj = marsLonLatAltToLocalScene(
          playerGeo.lon,
          playerGeo.lat,
          playerGeo.altM,
          sphereOrigin.lonDeg,
          sphereOrigin.latDeg,
          sphereOrigin.elevM
        );
      }

      // Solid collision against remote crewmates in tangent space
      freePos.set(proj.x, 0, proj.z);
      for (const remote of remoteAvatars.values()) {
        pushApart(remote.group.position);
      }
      if (Math.hypot(freePos.x - proj.x, freePos.z - proj.z) > 1e-4) {
        const pushedGeo = localSceneXZToLonLat(freePos.x, freePos.z, sphereOrigin.lonDeg, sphereOrigin.latDeg);
        playerGeo.lon = pushedGeo.lonDeg;
        playerGeo.lat = pushedGeo.latDeg;
        proj = marsLonLatAltToLocalScene(
          playerGeo.lon,
          playerGeo.lat,
          playerGeo.altM,
          sphereOrigin.lonDeg,
          sphereOrigin.latDeg,
          sphereOrigin.elevM
        );
      }

      px = proj.x;
      py = proj.y;
      pz = proj.z;
      player.x = px;
      player.y = py;
      player.z = pz;
      ground = marsLonLatAltToLocalScene(
        playerGeo.lon,
        playerGeo.lat,
        groundAltM,
        sphereOrigin.lonDeg,
        sphereOrigin.latDeg,
        sphereOrigin.elevM
      ).y;
    } else {
      if (freeRoam) {
        if (!isMapOpen()) {
          const run = keys.has("shift") || (!padOpen && gamepad.isDown("run"));
          const stick = padOpen ? { x: 0, y: 0 } : gamepad.move();
          const stickMag = Math.min(1, Math.hypot(stick.x, stick.y));
          fwd.set(0, 0, -1).applyAxisAngle(UP, userYaw);
          right.set(1, 0, 0).applyAxisAngle(UP, userYaw);
          moveDir.set(0, 0, 0);
          if (keys.has("w") || keys.has("arrowup")) moveDir.add(fwd);
          if (keys.has("s") || keys.has("arrowdown")) moveDir.sub(fwd);
          if (keys.has("d") || keys.has("arrowright")) moveDir.add(right);
          if (keys.has("a") || keys.has("arrowleft")) moveDir.sub(right);
          let pace = 1;
          if (moveDir.lengthSq() === 0 && stickMag > 0) {
            moveDir.addScaledVector(fwd, stick.y).addScaledVector(right, stick.x);
            pace = stickMag;
          }
          if (moveDir.lengthSq() > 0) {
            moveDir.normalize();
            // slow down on steep ground (uphill or downhill), like a suited walker would
            const here = sampleElevSceneY(freePos.x, freePos.z);
            const ahead = sampleElevSceneY(freePos.x + moveDir.x * 1.5, freePos.z + moveDir.z * 1.5);
            const slopeDeg = Math.abs(Math.atan2(ahead - here, 1.5)) * (180 / Math.PI);
            const slowdown = Math.min(1, Math.max(0.35, 1 - Math.max(0, slopeDeg - 10) / 22));
            const v =
              (run ? RUN_SPEED_MS : WALK_SPEED_MS) *
              pace *
              (devCfg.speedMultiplier || 1) *
              slowdown *
              (player.grounded ? 1 : 0.6);
            freePos.addScaledVector(moveDir, v * dt);
          }
        }
        // Wrap around to the opposite edge when crossing the 3D map boundary (Mars globe-style loop)
        const wx = wrapSceneCoord(freePos.x, worldW);
        const wz = wrapSceneCoord(freePos.z, worldH);
        if (wx.wrapped || wz.wrapped) {
          freePos.x = wx.val;
          freePos.z = wz.val;
          justTeleportedOrWrapped = true;
          const wLon = xToLon(freePos.x);
          const wLat = zToLat(freePos.z);
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

        // Solid collision against live crewmates so free-roam cannot clip through them
        for (const remote of remoteAvatars.values()) {
          pushApart(remote.group.position);
        }
        px = freePos.x;
        pz = freePos.z;
      } else {
        px = lonToX(sample.lon);
        pz = latToZ(sample.lat);
        // follow the path heading smoothly (no snapping on turns)
        const target = routeHeading(alongM);
        let diff = target - autoYaw;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        autoYaw += diff * Math.min(1, dt * 1.6);
      }

      // Mars gravity: feet follow the ground uphill, but the body falls (3.71 m/s^2) off drops.
      ground = sampleGroundY(px, pz);
      if (!player.init) {
        player.x = px;
        player.z = pz;
        player.y = ground;
        player.init = true;
      }
      const movedXZ = Math.hypot(px - player.x, pz - player.z);
      const mvx = px - player.x;
      const mvz = pz - player.z;
      player.x = px;
      player.z = pz;
      if (justTeleportedOrWrapped || movedXZ > 20) {
        // Teleport, wrap-around, or route reset moved us to a new terrain height: land cleanly on ground
        dustFx.clear();
        player.y = ground;
        player.vy = 0;
        player.grounded = true;
      }
      const prevGrounded = player.grounded;
      const prevVy = player.vy;
      if (player.grounded && player.y - ground > 0.25) player.grounded = false; // stepped off a drop
      if (!player.grounded) {
        player.vy -= MARS_G * dt;
        player.y += player.vy * dt;
        if (player.y <= ground) {
          player.y = ground;
          player.vy = 0;
          player.grounded = true;
          if (!prevGrounded && !justTeleportedOrWrapped && movedXZ < 20) {
            landingImpactSpeed = Math.max(1.2, Math.abs(prevVy));
          }
        }
      } else {
        player.y = ground;
      }
      py = player.y;
      sphereStepM = !justTeleportedOrWrapped && movedXZ < 20 ? movedXZ : 0; // ignore teleport/wrap jumps
      if (sphereStepM > 1e-5) {
        const yw = autoYaw + userYaw;
        const fx = -Math.sin(yw);
        const fz = -Math.cos(yw);
        sphereGaitDir = { f: (mvx * fx + mvz * fz) / movedXZ, s: (mvx * -fz + mvz * fx) / movedXZ };
      }
    }

    const yaw = autoYaw + userYaw;
    const step = justTeleportedOrWrapped ? 0 : sphereStepM;
    justTeleportedOrWrapped = false;
    const groundSpeed = dt > 0 ? step / dt : 0;
    _dustMoveVec.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    if (landingImpactSpeed > 0) {
      resolvePlayerGroundContact(px, pz, _dustPlayerGroundPos, _dustPlayerNrm);
      dustFx.emitLanding(_dustPlayerGroundPos, _dustPlayerNrm, landingImpactSpeed, _dustMoveVec);
    }

    // own body: rigged walk driven by distance actually covered
    self.group.position.set(px, py, pz);
    if (isDemoSphere) {
      const [snx, sny, snz] = sphereNormalAtLocal(px, py, pz);
      _sNorm.set(snx, sny, snz);
      _qSphereTilt.setFromUnitVectors(UP, _sNorm);
      _qLocalYaw.setFromAxisAngle(UP, yaw);
      self.group.quaternion.copy(_qSphereTilt).multiply(_qLocalYaw);
    } else {
      self.group.rotation.set(0, yaw, 0);
    }
    self.update(dt, step, groundSpeed, !player.grounded, sphereGaitDir);
    self.group.updateMatrixWorld(true);

    // helmet camera at the visor: gentle 1/3g inverted-pendulum buoying aligned with the 1.08 m stride
    const ph = self.phase ?? 0;
    const amt = Math.min(1.25, self.amount ?? 0);
    const { swayY, swayX, swayRoll } = computeMarsCameraSway(ph, amt);
    const micro = (f, a) => Math.sin(clockT * f) * a + Math.sin(clockT * f * 2.17 + 1.3) * a * 0.5;
    // looking down tips the head forward a little, like a real neck
    const tip = Math.max(0, -pitch);
    const eyeFwd = EYE_FORWARD_M + tip * 0.1;

    if (isDemoSphere) {
      fwd.set(0, 0, -1).applyQuaternion(self.group.quaternion);
      right.set(1, 0, 0).applyQuaternion(self.group.quaternion);
      camera.position
        .set(px, py, pz)
        .addScaledVector(_sNorm, EYE_HEIGHT_M - tip * 0.07 + swayY)
        .addScaledVector(fwd, eyeFwd)
        .addScaledVector(right, swayX);
      _eulerCam.set(
        pitch + micro(0.9, 0.0006),
        yaw + micro(0.6, 0.0007),
        swayRoll,
        "YXZ"
      );
      _qCamHead.setFromEuler(_eulerCam);
      camera.quaternion.copy(_qSphereTilt).multiply(_qCamHead);
    } else {
      fwd.set(0, 0, -1).applyAxisAngle(UP, yaw);
      right.set(1, 0, 0).applyAxisAngle(UP, yaw);
      camera.position.set(
        px + fwd.x * eyeFwd + right.x * swayX,
        py + EYE_HEIGHT_M - tip * 0.07 + swayY,
        pz + fwd.z * eyeFwd + right.z * swayX
      );
      camera.rotation.order = "YXZ";
      camera.rotation.y = yaw + micro(0.6, 0.0007);
      camera.rotation.x = pitch + micro(0.9, 0.0006);
      camera.rotation.z = swayRoll;
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
      if (Number.isFinite(remote.target.lon) && Number.isFinite(remote.target.lat)) {
        remote.cur.lon = remote.target.lon;
        remote.cur.lat = remote.target.lat;
        remote.cur.altM = remote.target.altM;
      }
      const rStep = Math.hypot(remote.cur.x - prevRx, remote.cur.z - prevRz);
      const rSpeed = dt > 0 ? Math.max(rStep / dt, remote.target.speed * 0.5) : 0;
      remote.group.position.set(remote.cur.x, remote.cur.y, remote.cur.z);
      if (isDemoSphere) {
        const [rnx, rny, rnz] = sphereNormalAtLocal(remote.cur.x, remote.cur.y, remote.cur.z);
        _rNorm.set(rnx, rny, rnz);
        _qRemoteTilt.setFromUnitVectors(UP, _rNorm);
        _qRemoteYaw.setFromAxisAngle(UP, remote.cur.yaw);
        remote.group.quaternion.copy(_qRemoteTilt).multiply(_qRemoteYaw);
      } else {
        remote.group.rotation.y = remote.cur.yaw;
      }
      remote.avatar.update(dt, rStep < 20 ? rStep : 0, rStep < 20 ? rSpeed : 0, remote.target.airborne);
      if (remote.group.visible && rStep > 0 && rStep < 20 && !remote.target.airborne) {
        remote.dustDist = (remote.dustDist || 0) + rStep;
        if (remote.dustDist >= MARS_WALK_STRIDE_M * 0.5) {
          remote.dustDist = 0;
          const distToCam = remote.group.position.distanceTo(camera.position);
          if (distToCam < 45) {
            resolvePlayerGroundContact(remote.cur.x, remote.cur.z, _dustPlayerGroundPos, _dustPlayerNrm);
            _dustMoveVec.set(-Math.sin(remote.cur.yaw), 0, -Math.cos(remote.cur.yaw));
            dustFx.emitFootstep(
              _dustPlayerGroundPos,
              _dustPlayerNrm,
              _dustMoveVec,
              computeFootstepDustIntensity(rSpeed, WALK_SPEED_MS, RUN_SPEED_MS)
            );
          }
        }
      }
    }

    // Throttled broadcast of local position/yaw/mode to crewmates + 2D planner
    const curLon = isDemoSphere ? playerGeo.lon : xToLon(px);
    const curLat = isDemoSphere ? playerGeo.lat : zToLat(pz);
    const movedOrTurned =
      !lastSentPose ||
      Math.hypot(px - lastSentPose.x, pz - lastSentPose.z) > 0.04 ||
      Math.abs(py - lastSentPose.y) > 0.04 ||
      Math.abs(yaw - lastSentPose.yaw) > 0.03 ||
      !player.grounded !== lastSentPose.airborne;
    if (now - lastMpSendMs > 1200 || (movedOrTurned && now - lastMpSendMs > 65)) {
      lastMpSendMs = now;
      lastSentPose = { x: px, y: py, z: pz, yaw, airborne: !player.grounded };
      const posePayload = {
        x: Number(px.toFixed(3)),
        y: Number(py.toFixed(3)),
        z: Number(pz.toFixed(3)),
        lon: Number(curLon.toFixed(6)),
        lat: Number(curLat.toFixed(6)),
        altM: isDemoSphere ? Number(playerGeo.altM.toFixed(2)) : undefined,
        yaw: Number(yaw.toFixed(4)),
        speed: Number(groundSpeed.toFixed(2)),
        airborne: !player.grounded,
        freeRoam,
        alongM: Number(alongM.toFixed(1)),
      };
      mp?.sendState(posePayload);
      onLocalPose?.(posePayload);
    }
    updateContactShadows(dt, groundSpeed, !player.grounded, _dustMoveVec, now);
    // Stride fallback when the suit rig bones have not yet triggered a step while walking/running
    if (player.grounded && groundSpeed > 0.16 && step > 0) {
      stepDustFallbackDist += step;
      if (now - lastFootstepFxMs > 460 && stepDustFallbackDist >= MARS_WALK_STRIDE_M * 0.5) {
        stepDustFallbackDist = 0;
        lastFootstepFxMs = now;
        resolvePlayerGroundContact(px, pz, _dustPlayerGroundPos, _dustPlayerNrm);
        dustFx.emitFootstep(
          _dustPlayerGroundPos,
          _dustPlayerNrm,
          _dustMoveVec,
          computeFootstepDustIntensity(groundSpeed, WALK_SPEED_MS, RUN_SPEED_MS)
        );
      }
    } else {
      stepDustFallbackDist = 0;
    }

    // sun, moons and shadow box follow the walker
    const texel = (2 * shadowHalfM) / shadowMapPx;
    sun.target.position.set(Math.round(px / texel) * texel, Math.round(ground / texel) * texel, Math.round(pz / texel) * texel);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 400);
    sky.position.copy(camera.position);
    skyMoons.position.copy(camera.position);
    updateMoons(clockT, camera.position);

    // the HUD text only needs ~10 updates a second
    hudTimer += dt;
    if (hudTimer > 0.1) {
      hudTimer = 0;
      if (isDemoSphere) {
        updateHudReadouts(alongM, playerGeo.lon, playerGeo.lat, computeLocalSlopeDeg(px, pz, playerGeo.lon, playerGeo.lat));
      } else if (freeRoam) {
        updateHudReadouts(alongM, xToLon(px), zToLat(pz), computeLocalSlopeDeg(px, pz));
      } else {
        updateHudReadouts(alongM, sample.lon, sample.lat);
      }
    }
    followEndless(camera.position);
    if (isMapOpen()) renderTacticalMap();

    adaptResolution(dt * 1000, now);
    dustFx.update(dt, camera, sun.visible ? 1.0 : 0.45);
    lensMat.uniforms.uTime.value = clockT;
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
    setMapOpen,
    isAwaitingInitialLanding: () => awaitingInitialLanding,
    dropLocalPing,
    /** Where the walker stands, for centring the map when it opens. */
    getLonLat: () => ({ lon: xToLon(player.x), lat: zToLat(player.z) }),
    /** Demo mode: View on the controller opens / closes the 3D Mars globe map. Returns true if handled. */
    toggleMarsMap: () => {
      if (!isDemoSphere || !mapOverlayEl) return false;
      if (awaitingInitialLanding && isMapOpen()) return true; // the landing map cannot be closed
      setMapOpen(!isMapOpen());
      return true;
    },
    isMarsMapOpen: () => isMapOpen(),
    syncAlongM: (s) => {
      alongM = Math.max(0, Math.min(totalDist, Number(s) || 0));
      if (freeRoam && btnFreeRoam) btnFreeRoam.click();
      if (scrubber) scrubber.value = alongM.toFixed(1);
    },
    teleportTo: (lon, lat) => {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      if (!freeRoam && btnFreeRoam) btnFreeRoam.click();
      teleportToLonLat(lon, lat, { keepYaw: true });
    },
  };
}
