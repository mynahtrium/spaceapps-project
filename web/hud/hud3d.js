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
import { lerpAngleRad } from "../shared/multiplayer.js";
import { createMartianPbrTextureSets } from "../map/MarsPbrTextures.js";

const ASTRONAUT_HEIGHT_M = 1.8;
const EYE_HEIGHT_M = 1.64; // eye level inside the helmet of a 1.80 m astronaut
const EYE_FORWARD_M = 0.36; // at the visor, ahead of the suit's deep chest so the legs show when looking down
const WALK_SPEED_MS = 1.4; // placeholder walking pace (Earth hiking stand-in)
const RUN_SPEED_MS = 2.5; // a light suited run (Shift); clearly faster than walking, not a sprint
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
    d *= 0.88; // zoom in so the distorted edges stay inside the frame
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
    float vig = smoothstep(1.25, 0.25, length(c) * uVignette);
    col *= mix(0.25, 1.0, vig);

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

  // Sun: mid-afternoon, fairly low so the relief throws long shadows.
  const sunDir = new THREE.Vector3(-0.55, 0.42, -0.72).normalize();
  // Mars sees a small sun disc (about 0.35 deg), so near shadows are crisp; the thin dusty sky
  // fills them with a weak reddish light rather than washing them out.
  const SHADOW_HALF_M = 20; // about 2 cm per shadow texel around the walker
  const SHADOW_MAP_PX = 2048;
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
  scene.add(new THREE.HemisphereLight(0xc99a76, 0x2e1a12, 0.22));

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
  const phobos = new THREE.Mesh(
    buildMoonGeometry(145, [1.34, 0.9, 0.82], true),
    makeMoonMat(0xd6cbc2, 1.35)
  );
  phobos.renderOrder = -1;
  const deimos = new THREE.Mesh(
    buildMoonGeometry(52, [1.14, 0.95, 0.9], false),
    makeMoonMat(0xf0e4d8, 1.7)
  );
  deimos.renderOrder = -1;
  skyMoons.add(phobos, deimos);
  scene.add(skyMoons);

  const PHOBOS_ORBIT_R = 9600;
  const DEIMOS_ORBIT_R = 10400;
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

  function buildTerrainGeometry(seg) {
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

  const terrainMat = new THREE.MeshStandardMaterial({
    map: reliefTex,
    normalMap: pbr.dustNormalTex,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.96,
    metalness: 0.0,
  });
  terrainMat.envMapIntensity = 0.7; // ground in shade stays dark; the suit keeps the full sky light
  terrainMat.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: detailTex };
    shader.uniforms.pbrDust = { value: pbr.dustAlbedoTex };
    shader.uniforms.pbrRock = { value: pbr.rockAlbedoTex };
    shader.uniforms.sunMask = { value: sunMask };
    shader.uniforms.sunMaskOn = { value: sunMask ? 1 : 0 };
    shader.uniforms.sunMaskPeriod = { value: new THREE.Vector2(2 * worldW, 2 * worldH) };
    shader.uniforms.sunMaskOrigin = { value: new THREE.Vector2(-worldW / 2, -worldH / 2) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vMmWorldXZ;")
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvMmWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;"
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
      .replace("#include <map_pars_fragment>", "#include <map_pars_fragment>\nuniform sampler2D detailMap;\nuniform sampler2D pbrDust;\nuniform sampler2D pbrRock;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        #ifdef USE_MAP
          float dA = texture2D(detailMap, vMapUv * 173.0).r;
          float dB = texture2D(detailMap, vMapUv * 911.0).r;
          diffuseColor.rgb *= 0.74 + 0.40 * dA * 0.6 + 0.40 * dB * 0.4;
          // Close-range ground detail: ripples / pebbles on dust, slabs + veins on rock patches.
          vec3 mmDust = texture2D(pbrDust, vMapUv * 640.0).rgb;
          vec3 mmRock = texture2D(pbrRock, vMapUv * 290.0 + 0.37).rgb;
          float mmRockMask = smoothstep(0.48, 0.66, texture2D(detailMap, vMapUv * 41.0 + 0.11).r);
          vec3 mmGround = mix(mmDust, mmRock, mmRockMask);
          float mmLum = dot(mmGround, vec3(0.299, 0.587, 0.114)) / 0.40;
          diffuseColor.rgb *= mix(1.0, clamp(mmLum, 0.35, 1.6), 0.7);
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
  if (stops?.features) {
    stops.features.forEach((f) => {
      const [lon, lat] = f.geometry.coordinates;
      const sx = lonToX(lon);
      const sz = latToZ(lat);
      const sy = sampleElevSceneY(sx, sz);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.4, 8), poleMat);
      pole.position.set(sx, sy + 1.2, sz);
      pole.castShadow = true;
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), lampMat);
      lamp.position.set(sx, sy + 2.45, sz);
      scene.add(pole, lamp);
    });
  }

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
      const gy = sampleGroundY(footPos.x, footPos.z);
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
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 });
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
  let partnerS = PARTNER_AHEAD_M;
  const keys = new Set();

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  renderer.domElement.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener("pointerup", () => (dragging = false));
  window.addEventListener("pointermove", (e) => {
    if (!dragging) return;
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
  window.addEventListener("keydown", (e) => {
    if (!hudView.classList.contains("active")) return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
    const k = e.key.toLowerCase();
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
    if (player.grounded) {
      player.vy = JUMP_SPEED_MS;
      player.grounded = false;
    }
  }
  // Controller buttons (bindings live in shared/gamepad.js and the setup screen)
  gamepad.onPress(({ actions }) => {
    if (!hudView.classList.contains("active")) return;
    if (document.getElementById("pad-setup")?.classList.contains("open")) return;
    for (const a of actions) {
      if (a === "jump") doJump();
      else if (a === "pin") dropLocalPing("Landmark");
      else if (a === "texture") document.getElementById("hud-tex")?.click();
      else if (a === "pov") document.getElementById("hud-pov-btn")?.click();
    }
  });
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

  btnPing?.addEventListener("click", () => dropLocalPing("EVA Waypoint"));

  btnBack?.addEventListener("click", () => {
    playing = false;
    if (btnPlay) btnPlay.textContent = "Play";
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
  }
  btnTex?.addEventListener("click", () => setTexMode((texMode + 1) % TEX.length));

  // A new route from the planner (Begin EVA): stand at its start, facing along it.
  onSetRoute((detail) => {
    const newRoute = detail?.route;
    const nextAlong = Number(detail?.alongM ?? detail?.along_m ?? 0) || 0;
    rebuildRouteRibbon(newRoute);
    alongM = nextAlong;
    autoYaw = 0;
    if (routeCoords.length > 1) {
      const p = routePoint(alongM);
      freePos.set(p.x, 0, p.z);
      userYaw = routeHeading(alongM);
      partnerPos.set(p.x, 0, p.z);
      player.init = false;
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

  onTeleport(({ lon, lat }) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    const tx = lonToX(lon);
    const tz = latToZ(lat);
    const ty = sampleElevSceneY(tx, tz);

    const nearestGeomS = closestAlongM(routeCoords, cumDist, lon, lat);
    alongM = geomTotalDist > 0 ? (nearestGeomS / geomTotalDist) * totalDist : 0;

    freePos.set(tx, 0, tz);
    player.x = freePos.x;
    player.z = freePos.z;
    player.y = ty;
    player.vy = 0;
    player.grounded = true;
    player.init = true;

    autoYaw = 0;
    if (routeCoords.length > 1) {
      const rp = routePoint(alongM);
      const distToRoute = Math.hypot(rp.x - tx, rp.z - tz);
      userYaw = distToRoute > 5 ? Math.atan2(-(rp.x - tx), -(rp.z - tz)) : routeHeading(alongM);
    }
    pitch = -0.04;
    followEndless({ x: player.x, y: player.y, z: player.z });
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
      clockEl.textContent = `T+${hh}:${mm}:${ss}  (WALK-TIME PLACEHOLDER)`;
    }

    if (btnPov && nextStop) {
      btnPov.onclick = () => {
        const entry = povIndex?.stops?.find((s) => s.stop_id === nextStop.properties.id) || povIndex?.stops?.[0];
        if (entry) onOpenPov(entry);
      };
    }
  }

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

  // Adaptive resolution: the 3D scene renders into rt, so its size can drop when frames are slow
  // and come back when there is headroom. The lens pass scales it to the screen.
  let renderScale = 1;
  let frameAvg = 16;
  let lastScaleChange = 0;
  function adaptResolution(frameMs, now) {
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
  onResize();

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

  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min(0.1, (now - prevT) / 1000);
    prevT = now;
    clockT += dt;
    if (!hudView.classList.contains("active")) return; // do not render while hidden

    // controller look (right stick): about 150 deg/s across, 110 deg/s up/down at full tilt
    const padOpen = document.getElementById("pad-setup")?.classList.contains("open");
    const lk = padOpen ? { x: 0, y: 0 } : gamepad.look();
    if (lk.x || lk.y) {
      userYaw -= lk.x * 2.6 * dt;
      pitch = Math.max(-1.35, Math.min(1.42, pitch + lk.y * 1.9 * dt));
    }

    // progress along the route = the route point nearest to you (for the HUD only)
    alongM = nearestAlongRoute(freePos.x, freePos.z, alongM);
    const sample = sampleAlongRoute(routeCoords, cumDist, toGeomDist(alongM));
    let px;
    let pz;
    if (freeRoam) {
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
      // analog stick: walk slower when the stick is only partly pushed
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
        const v = (run ? RUN_SPEED_MS : WALK_SPEED_MS) * pace * slowdown * (player.grounded ? 1 : 0.6);
        freePos.addScaledVector(moveDir, v * dt);
      }
      // Solid collision against visible NPC partner or live crewmates so free-roam cannot clip through them
      if (partner && partner.group.visible) {
        pushApart(partner.group.position);
      }
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
    const ground = sampleGroundY(px, pz);
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
    if (movedXZ > 20) {
      // scrubber or free-roam toggle moved us far: land on the new spot instead of falling to it
      player.y = ground;
      player.vy = 0;
      player.grounded = true;
    }
    if (player.grounded && player.y - ground > 0.25) player.grounded = false; // stepped off a drop
    if (!player.grounded) {
      player.vy -= MARS_G * dt;
      player.y += player.vy * dt;
      if (player.y <= ground) {
        player.y = ground;
        player.vy = 0;
        player.grounded = true;
      }
    } else {
      player.y = ground;
    }
    const yaw = autoYaw + userYaw;
    const step = movedXZ < 20 ? movedXZ : 0; // ignore scrubber jumps
    const groundSpeed = dt > 0 ? step / dt : 0;

    // own body: rigged walk driven by distance actually covered
    self.group.position.set(px, player.y, pz);
    self.group.rotation.y = yaw;
    // walking direction in the body frame, so strafing side-steps and S walks backwards
    let gaitDir = null;
    if (step > 1e-5) {
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      gaitDir = { f: (mvx * fx + mvz * fz) / movedXZ, s: (mvx * -fz + mvz * fx) / movedXZ };
    }
    self.update(dt, step, groundSpeed, !player.grounded, gaitDir);
    self.group.updateMatrixWorld(true);

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
      player.y + EYE_HEIGHT_M - tip * 0.07 + swayY,
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
      remote.avatar.update(dt, rStep < 20 ? rStep : 0, rStep < 20 ? rSpeed : 0, remote.target.airborne);
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
    const texel = (2 * SHADOW_HALF_M) / SHADOW_MAP_PX;
    sun.target.position.set(Math.round(px / texel) * texel, Math.round(ground / texel) * texel, Math.round(pz / texel) * texel);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 400);
    sky.position.copy(camera.position);
    skyMoons.position.copy(camera.position);
    updateMoons(clockT, camera.position);

    // the HUD text only needs ~10 updates a second
    hudTimer += dt;
    if (hudTimer > 0.1) {
      hudTimer = 0;
      if (freeRoam) {
        updateHudReadouts(alongM, xToLon(px), zToLat(pz), computeLocalSlopeDeg(px, pz));
      } else {
        updateHudReadouts(alongM, sample.lon, sample.lat);
      }
    }
    followEndless(camera.position);

    adaptResolution(dt * 1000, now);
    lensMat.uniforms.uTime.value = clockT;
    lensMat.uniforms.uExposure.value = 1.0 + Math.sin(clockT * 0.7) * 0.015 + Math.sin(clockT * 13.0) * 0.006;
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
    /** Where the walker stands, for centring the map when it opens. */
    getLonLat: () => ({ lon: xToLon(player.x), lat: zToLat(player.z) }),
    syncAlongM: (s) => {
      alongM = Math.max(0, Math.min(totalDist, Number(s) || 0));
      if (freeRoam && btnFreeRoam) btnFreeRoam.click();
      if (scrubber) scrubber.value = alongM.toFixed(1);
    },
    teleportTo: (lon, lat) => {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      const tx = lonToX(lon);
      const tz = latToZ(lat);
      if (!freeRoam && btnFreeRoam) btnFreeRoam.click();
      freePos.set(tx, 0, tz);
      player.x = tx;
      player.z = tz;
      player.y = sampleElevSceneY(tx, tz);
      player.vy = 0;
      player.grounded = true;
    },
  };
}
