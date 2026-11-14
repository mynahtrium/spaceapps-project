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
import { lerpAngleRad } from "../shared/multiplayer.js";
import { createMartianPbrTextureSets } from "../map/MarsPbrTextures.js";
import { loadDevSettings, subscribeDevSettings } from "../shared/dev-settings.js";
import {
  ROVER_FLIGHT_G,
  computeSpawnBesideOffset,
  createExperimentalRover,
  stepRoverBallisticPhysics,
} from "./experimental-rover.js";
import { createMarsFxSystem } from "./mars-fx.js";

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
  let pbrHigh = null;
  let terrainShaderRef = null;
  let suitWeaveTex = null;

  function ensureHighResPbr() {
    if (pbrHigh) return pbrHigh;
    pbrHigh = createMartianPbrTextureSets(THREE, 512);
    for (const t of [pbrHigh.dustAlbedoTex, pbrHigh.rockAlbedoTex, pbrHigh.dustNormalTex, pbrHigh.rockNormalTex]) {
      t.anisotropy = maxAniso;
    }
    pbrHigh.dustNormalTex.repeat.set(640, 640);
    return pbrHigh;
  }

  function ensureSuitWeaveNormal() {
    if (suitWeaveTex) return suitWeaveTex;
    const sz = 128;
    const data = new Uint8Array(sz * sz * 4);
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        // Woven ortho-fabric micro-ripstop pattern
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
    shader.uniforms.pbrDust = { value: devCfg.realisticTextures ? ensureHighResPbr().dustAlbedoTex : pbr.dustAlbedoTex };
    shader.uniforms.pbrRock = { value: devCfg.realisticTextures ? ensureHighResPbr().rockAlbedoTex : pbr.rockAlbedoTex };
    shader.uniforms.sunMask = { value: sunMask };
    shader.uniforms.sunMaskOn = { value: sunMask ? 1 : 0 };
    shader.uniforms.sunMaskPeriod = { value: new THREE.Vector2(2 * worldW, 2 * worldH) };
    shader.uniforms.sunMaskOrigin = { value: new THREE.Vector2(-worldW / 2, -worldH / 2) };
    shader.uniforms.uSuperDetail = superDetailUniform;
    shader.uniforms.uRealisticTex = realisticTexUniform;
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
          float detailGain = mix(0.40, 0.56, max(uSuperDetail, uRealisticTex * 0.85));
          diffuseColor.rgb *= (1.0 - detailGain * 0.65) + detailGain * dA * 0.6 + detailGain * dB * 0.4;
          // Close-range ground detail: ripples / pebbles on dust, slabs + veins on rock patches.
          vec3 mmDust = texture2D(pbrDust, vMapUv * mix(640.0, 960.0, max(uSuperDetail, uRealisticTex))).rgb;
          vec3 mmRock = texture2D(pbrRock, vMapUv * mix(290.0, 460.0, max(uSuperDetail, uRealisticTex)) + 0.37).rgb;
          float mmRockMask = smoothstep(0.48, 0.66, texture2D(detailMap, vMapUv * 41.0 + 0.11).r);
          vec3 mmGround = mix(mmDust, mmRock, mmRockMask);
          float mmLum = dot(mmGround, vec3(0.299, 0.587, 0.114)) / 0.40;
          float mmRichLum = mix(mmLum, pow(clamp(mmLum, 0.18, 2.1), 1.38), uRealisticTex);
          float mmMineralGlint = uRealisticTex * smoothstep(0.92, 0.995, dB) * 0.18;
          diffuseColor.rgb *= mix(1.0, clamp(mmRichLum, 0.22, 1.95), mix(0.7, 0.96, max(uSuperDetail, uRealisticTex)));
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
      const poleH = isStart ? 4.6 : 2.4;
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

  // ---------- astronauts (NASA 3D Resources, procedural walk/run/jump suit rig) ----------
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
  const sharedDraco = new DRACOLoader();
  sharedDraco.setDecoderPath("./vendor/addons/libs/draco/gltf/");
  const sharedGltfLoader = new GLTFLoader();
  sharedGltfLoader.setDRACOLoader(sharedDraco);
  {
    for (const m of SUIT_MODELS) {
      try {
        const rig = await loadSuitRig(sharedGltfLoader, m.url, ASTRONAUT_HEIGHT_M);
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
  rover.attachRealModel(sharedGltfLoader);
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
  let justTeleportedOrWrapped = false;
  let drivingRover = false;
  let roverThrottleVel = 0;
  let roverVelX = 0;
  let roverVelZ = 0;
  let roverSteer = 0;
  let prevRoverSteer = 0;
  let roverLandingImpact = 0;
  const roverAirState = {
    posY: null,
    velY: 0,
    prevGroundY: null,
    airborne: false,
    airTime: 0,
    peakLaunchVy: 0,
    landingCooldown: 0,
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
  }
  let roverWasOn = false;
  let nearRoverPrompted = false;
  let prevFirstPersonPitch = -0.12;
  let chaseCamInit = false;
  const chaseCamPos = new THREE.Vector3();
  const chaseLookTarget = new THREE.Vector3();
  let baseSunIntensity = 3.6;
  let walkVelX = 0;
  let walkVelZ = 0;
  let prevFootStepCount = 0;
  let roverDustAcc = 0;
  const keys = new Set();

  const hudView = document.getElementById("hud-view");
  const reticleEl = document.querySelector(".hud-reticle");
  const mapOverlayEl = document.getElementById("hud-map-overlay");
  const isMapOpen = () => Boolean(mapOverlayEl?.classList.contains("open"));
  const isHudActive = () => Boolean(hudView?.classList.contains("active"));
  const isPointerLocked = () => document.pointerLockElement === renderer.domElement;
  const hasOpenModalOverlay = () => Boolean(document.querySelector(".modal-backdrop.open, #crew-drawer.open"));

  function releasePointerLock() {
    if (document.pointerLockElement) {
      try {
        document.exitPointerLock?.();
      } catch {}
    }
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
    if (isMapOpen() || !isHudActive()) return;
    if (e.button === 0) requestCrosshairLock();
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
    // Clamp transient Pointer Lock cursor warp spikes
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
    const elev = elevMin + sampleElevSceneY(x, z);
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
      freePos.set(p.x, 0, p.z);
      userYaw = routeHeading(alongM);
      partnerPos.set(p.x, 0, p.z);
      player.init = false;
      justTeleportedOrWrapped = true;
      drivingRover = false;
      roverThrottleVel = 0;
      chaseCamInit = false;
      syncDrivingCameraVisualState(false);
      if (self?.group) self.group.visible = true;
      if (devCfg.experimentalRover && rover) {
        rover.group.visible = true;
        rover.spawnBeside(p.x, p.z, userYaw, sampleElevSceneY);
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
          const smIdx = (y * sunMaskW + x) * 4;
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
    document.querySelector(".hud-reticle")?.classList.toggle("hidden", next);
    if (next) {
      keys.clear();
      dragging = false;
      releasePointerLock();
      syncMapStaticText();
      renderTacticalMap();
    } else {
      pendingTeleport = null;
      hoverTarget = null;
      if (mapConfirmEl) mapConfirmEl.style.display = "none";
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
  }

  function renderTacticalMap() {
    if (!mapCtx || !mapCanvasEl || !isMapOpen()) return;
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
    if (e.key === "Escape") {
      if (isPointerLocked()) {
        releasePointerLock();
        return;
      }
      if (isMapOpen()) {
        e.preventDefault();
        setMapOpen(false);
        return;
      }
    }
    if (isMapOpen()) return;

    keys.add(k);
    if (k === "f" && !e.repeat && devCfg.experimentalRover && rover.group.visible) {
      const tr = isTrLang();
      if (drivingRover) {
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
        let wx = wrapSceneCoord(exitPt.x, worldW).val;
        let wz = wrapSceneCoord(exitPt.z, worldH).val;
        const wy = sampleElevSceneY(wx, wz);
        const outCol = rover.resolveCollision(wx, wz, PARTNER_COLLISION_R + 0.08, wy);
        if (outCol.hit) {
          wx = wrapSceneCoord(outCol.x, worldW).val;
          wz = wrapSceneCoord(outCol.z, worldH).val;
        }
        freePos.set(wx, 0, wz);
        player.x = wx;
        player.z = wz;
        player.y = sampleElevSceneY(wx, wz);
        player.vy = 0;
        player.grounded = true;
        player.init = true;
        justTeleportedOrWrapped = true;
        syncDrivingCameraVisualState(false);
        if (self?.group) self.group.visible = true;
        showWrapNotice(tr ? "MARS ARACINDAN İNİLDİ (BİNMEK: F)" : "EXITED MARS ROVER (PRESS F TO BOARD)");
      } else {
        const dist = Math.hypot(freePos.x - rover.group.position.x, freePos.z - rover.group.position.z);
        if (dist <= 5.4) {
          drivingRover = true;
          resetRoverMotionState();
          prevFirstPersonPitch = pitch;
          pitch = -0.25;
          autoYaw = 0;
          userYaw = rover.group.rotation.y;
          chaseCamInit = false;
          syncDrivingCameraVisualState(true);
          if (self?.group) self.group.visible = false;
          showWrapNotice(
            tr
              ? "3. ŞAHIS SÜRÜŞ · W/S GAZ · A/D DİREKSİYON · SHIFT TURBO · F İN"
              : "3RD-PERSON DRIVE · W/S DRIVE · A/D STEER · SHIFT BOOST · F EXIT"
          );
        }
      }
      return;
    }
    if (k === "p") {
      dropLocalPing("EVA Waypoint");
    }
    if (k === " " && !drivingRover) {
      e.preventDefault();
      if (player.grounded) {
        player.vy = JUMP_SPEED_MS;
        player.grounded = false;
        if (devCfg.realisticDust) {
          const jYaw = autoYaw + userYaw;
          marsFx.emitJumpBurst(freePos.x, player.y, freePos.z, {
            mode: "takeoff",
            impactSpeed: 1.55,
            rightX: Math.cos(jYaw),
            rightZ: -Math.sin(jYaw),
            fwdX: -Math.sin(jYaw),
            fwdZ: -Math.cos(jYaw),
            vx: walkVelX,
            vz: walkVelZ,
          });
        }
      }
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

  function syncDrivingCameraVisualState(isDriving3p) {
    const visorOverlay = document.querySelector(".visor-overlay");
    if (visorOverlay) {
      visorOverlay.classList.toggle("driving-3p", Boolean(isDriving3p));
    }
    if (isDriving3p) {
      lensMat.uniforms.uFrameZoom.value = 1.0;
      lensMat.uniforms.uDistort.value = 0.0;
      lensMat.uniforms.uAberration.value = 0.0012;
      lensMat.uniforms.uVignette.value = 0.25;
    } else {
      const strength = devCfg.frameEffect ? devCfg.frameStrength : 0;
      lensMat.uniforms.uFrameZoom.value = devCfg.frameEffect ? 1.0 - 0.12 * Math.min(1, strength) : 1.0;
      lensMat.uniforms.uDistort.value = 0.26 * strength;
      lensMat.uniforms.uAberration.value = 0.006 * strength;
      lensMat.uniforms.uVignette.value = 1.05 * strength;
    }
  }

  function applyDevSettings(cfg) {
    devCfg = cfg;
    const visorOverlay = document.querySelector(".visor-overlay");
    if (visorOverlay) {
      visorOverlay.classList.toggle("no-frame", !cfg.frameEffect);
      visorOverlay.classList.toggle("clean-hud", Boolean(cfg.cleanHud));
      visorOverlay.classList.toggle("driving-3p", Boolean(drivingRover));
    }

    syncDrivingCameraVisualState(drivingRover);
    const strength = cfg.frameEffect ? cfg.frameStrength : 0;
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
    sun.intensity = baseSunIntensity;
    hemiLight.intensity = wantSuper ? 0.28 : 0.22;
    renderer.toneMappingExposure = wantSuper ? 1.06 : 1.0;

    const wantRover = Boolean(cfg.experimentalRover);
    rover.group.visible = wantRover;
    if (wantRover && !roverWasOn) {
      resetRoverMotionState();
      rover.spawnBeside(freePos.x, freePos.z, autoYaw + userYaw, sampleElevSceneY);
      nearRoverPrompted = false;
      if (hudView.classList.contains("active")) {
        showWrapNotice(
          isTrLang()
            ? "DENEYSEL MARS ARACI YANINDA OLUŞTU (BİNMEK/İNMEK: F)"
            : "EXPERIMENTAL MARS ROVER SPAWNED BESIDE YOU (PRESS F TO DRIVE)"
        );
      }
    } else if (!wantRover && drivingRover) {
      drivingRover = false;
      resetRoverMotionState();
      chaseCamInit = false;
      syncDrivingCameraVisualState(false);
      if (self?.group) self.group.visible = true;
    }
    roverWasOn = wantRover;
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

  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min(0.1, (now - prevT) / 1000);
    prevT = now;
    clockT += dt;
    if (!hudView.classList.contains("active")) return; // do not render while hidden

    // progress along the route = the route point nearest to you (for the HUD only)
    alongM = nearestAlongRoute(freePos.x, freePos.z, alongM);
    const sample = sampleAlongRoute(routeCoords, cumDist, toGeomDist(alongM));
    let px;
    let pz;
    let walkerSlopeRad = 0;
    let roverLateralSpeed = 0;
    if (freeRoam && drivingRover && devCfg.experimentalRover && rover.group.visible) {
      const rYaw0 = rover.group.rotation.y;
      const fx0 = -Math.sin(rYaw0);
      const fz0 = -Math.cos(rYaw0);
      const rx0 = Math.cos(rYaw0);
      const rz0 = -Math.sin(rYaw0);
      let vFwd = roverVelX * fx0 + roverVelZ * fz0;
      let vLat = roverVelX * rx0 + roverVelZ * rz0;
      let steerJerk = 0;

      if (!isMapOpen()) {
        const run = keys.has("shift");
        const throttle =
          (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
        const steerIn =
          (keys.has("a") || keys.has("arrowleft") ? 1 : 0) - (keys.has("d") || keys.has("arrowright") ? 1 : 0);
        prevRoverSteer = roverSteer;
        roverSteer += (steerIn - roverSteer) * Math.min(1, dt * 9.5);
        steerJerk = dt > 0 ? Math.abs(roverSteer - prevRoverSteer) / dt : 0;

        const mult = devCfg.speedMultiplier || 1;
        const targetVel = throttle > 0 ? (run ? 21.0 : 12.5) * mult : throttle < 0 ? -8.0 * mult : 0;

        if (!roverAirState.airborne) {
          const gHere = sampleElevSceneY(rover.group.position.x, rover.group.position.z);
          const gAheadSlope = sampleElevSceneY(
            rover.group.position.x + fx0 * 1.4,
            rover.group.position.z + fz0 * 1.4
          );
          const gBehindSlope = sampleElevSceneY(
            rover.group.position.x - fx0 * 1.4,
            rover.group.position.z - fz0 * 1.4
          );
          const slopePitch = Math.atan2(gAheadSlope - gBehindSlope, 2.8);
          const reversingInput = throttle !== 0 && throttle * vFwd < -0.6;
          const driveRate = reversingInput ? 13.5 : throttle !== 0 ? (run ? 10.5 : 7.5) : 2.8;
          let nextVFwd = vFwd + (targetVel - vFwd) * Math.min(1, dt * driveRate);
          if (devCfg.realisticPhysics) {
            // Mars 3.71 m/s^2 gravity pulls downhill / loads steep uphill climbs
            nextVFwd -= MARS_G * Math.sin(slopePitch) * dt * 1.05;
          }

          // Steep cliff guard only (> 52 deg sheer wall)
          const probeAhead = sampleElevSceneY(
            rover.group.position.x + Math.sign(nextVFwd || 1) * fx0 * 2.2,
            rover.group.position.z + Math.sign(nextVFwd || 1) * fz0 * 2.2
          );
          const slopeAheadDeg = Math.abs(Math.atan2(probeAhead - gHere, 2.2)) * (180 / Math.PI);
          if (devCfg.realisticPhysics && slopeAheadDeg > 52 && probeAhead > gHere) {
            nextVFwd *= Math.exp(-dt * 8);
          }

          const speedAuth = Math.min(1, Math.abs(nextVFwd) / 3.2) * 0.78 + 0.22;
          const turnDir = Math.abs(nextVFwd) > 0.35 ? Math.sign(nextVFwd) : 0.45;
          const deltaYaw = roverSteer * turnDir * 1.65 * speedAuth * dt;
          rover.group.rotation.y += deltaYaw;
          userYaw += deltaYaw;

          // Loose Martian regolith powerslide when whipping sharply at high speed
          const rYaw1 = rover.group.rotation.y;
          const fx1 = -Math.sin(rYaw1);
          const fz1 = -Math.cos(rYaw1);
          const rx1 = Math.cos(rYaw1);
          const rz1 = -Math.sin(rYaw1);
          const curVx = fx0 * nextVFwd + rx0 * vLat;
          const curVz = fz0 * nextVFwd + rz0 * vLat;
          const projFwd = curVx * fx1 + curVz * fz1;
          const projLat = curVx * rx1 + curVz * rz1;
          const driftingTurn = Math.abs(roverSteer) > 0.45 && Math.abs(projFwd) > 8.5;
          const latGrip = driftingTurn ? 6.2 : 12.5;
          const dampedLat = projLat * Math.exp(-dt * latGrip);
          roverVelX = fx1 * projFwd + rx1 * dampedLat;
          roverVelZ = fz1 * projFwd + rz1 * dampedLat;
          roverThrottleVel = projFwd;
          roverLateralSpeed = dampedLat;
        } else {
          // Mid-air attitude yaw + ballistic momentum preservation
          const deltaYaw = roverSteer * 0.48 * dt;
          rover.group.rotation.y += deltaYaw;
          userYaw += deltaYaw;
          const drag = Math.exp(-dt * 0.06);
          roverVelX *= drag;
          roverVelZ *= drag;
          const rYaw1 = rover.group.rotation.y;
          roverThrottleVel = roverVelX * -Math.sin(rYaw1) + roverVelZ * -Math.cos(rYaw1);
          roverLateralSpeed = roverVelX * Math.cos(rYaw1) - roverVelZ * Math.sin(rYaw1);
        }
      } else {
        roverVelX *= Math.exp(-dt * 4);
        roverVelZ *= Math.exp(-dt * 4);
        roverThrottleVel *= Math.exp(-dt * 4);
      }

      rover.group.position.x += roverVelX * dt;
      rover.group.position.z += roverVelZ * dt;

      // Solid OBB collision while driving so rover never ghosts through crew astronauts
      const resolveDrivingActor = (actorPos) => {
        if (!actorPos) return;
        const hit = rover.resolveCollision(actorPos.x, actorPos.z, PARTNER_COLLISION_R + 0.08, actorPos.y);
        if (hit.hit) {
          rover.group.position.x -= hit.nx * hit.pen;
          rover.group.position.z -= hit.nz * hit.pen;
          roverVelX *= 0.25;
          roverVelZ *= 0.25;
          roverThrottleVel *= 0.25;
        }
      };
      if (partner && partner.group.visible) resolveDrivingActor(partner.group.position);
      for (const remote of remoteAvatars.values()) resolveDrivingActor(remote.group.position);

      const wx = wrapSceneCoord(rover.group.position.x, worldW);
      const wz = wrapSceneCoord(rover.group.position.z, worldH);
      if (wx.wrapped || wz.wrapped) {
        rover.group.position.x = wx.val;
        rover.group.position.z = wz.val;
        roverAirState.posY = null;
        roverAirState.prevGroundY = null;
        roverAirState.airborne = false;
        justTeleportedOrWrapped = true;
      }

      // 3D crest launch, Martian 0.38g parabolic flight, and spring-shock touchdown impact
      const horizSpeed = Math.hypot(roverVelX, roverVelZ);
      const supportGroundY = rover.sampleSupportGroundY(sampleElevSceneY);
      let slopeClimbVy = 0;
      let bumpImpulseVy = 0;
      if (horizSpeed > 0.8 && !roverAirState.airborne) {
        const dirX = roverVelX / horizSpeed;
        const dirZ = roverVelZ / horizSpeed;
        const hBackVel = sampleElevSceneY(rover.group.position.x - dirX * 1.15, rover.group.position.z - dirZ * 1.15);
        const hNow = sampleElevSceneY(rover.group.position.x, rover.group.position.z);
        slopeClimbVy = Math.max(0, (hNow - hBackVel) / 1.15) * horizSpeed;
        // Sudden lateral whip, powerslide drift, or uneven wheel bump pops suspension vertically
        const hLeft = sampleElevSceneY(
          rover.group.position.x + Math.cos(rover.group.rotation.y) * 1.34,
          rover.group.position.z - Math.sin(rover.group.rotation.y) * 1.34
        );
        const hRight = sampleElevSceneY(
          rover.group.position.x - Math.cos(rover.group.rotation.y) * 1.34,
          rover.group.position.z + Math.sin(rover.group.rotation.y) * 1.34
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
        dt,
        marsG: ROVER_FLIGHT_G,
      });
      if (airStep.launched && devCfg.realisticDust) {
        for (const sideSign of [-1, 1]) {
          const emit = rover.getWheelDustEmitPoint(sideSign);
          marsFx.emitBurst(emit.x, sampleElevSceneY(emit.x, emit.z), emit.z, 5, 1.35, -roverVelX * 0.2, -roverVelZ * 0.2);
        }
      }
      roverLandingImpact = airStep.landed ? airStep.impactSpeed : 0;
      if (airStep.landed && devCfg.realisticDust && airStep.impactSpeed > 1.0) {
        const rYawL = rover.group.rotation.y;
        marsFx.emitJumpBurst(rover.group.position.x, supportGroundY, rover.group.position.z, {
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
          const emit = rover.getWheelDustEmitPoint(sideSign);
          marsFx.emitBurst(emit.x, sampleElevSceneY(emit.x, emit.z), emit.z, 6, 1.75, -roverVelX * 0.28, -roverVelZ * 0.28);
        }
      }

      rover.update(dt, {
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
      });
      if (devCfg.realisticDust && !roverAirState.airborne && (Math.abs(roverThrottleVel) > 0.7 || Math.abs(roverLateralSpeed) > 1.2)) {
        const speedMag = Math.hypot(roverThrottleVel, roverLateralSpeed);
        roverDustAcc += dt * Math.min(44, 10 + speedMag * 2.8);
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
            Math.min(6, burstCount),
            Math.min(1.95, 0.7 + speedMag * 0.12),
            -fx * roverThrottleVel * 0.24,
            -fz * roverThrottleVel * 0.24
          );
        }
      }
      freePos.x = rover.group.position.x;
      freePos.z = rover.group.position.z;
      walkVelX = 0;
      walkVelZ = 0;
      px = freePos.x;
      pz = freePos.z;
    } else if (freeRoam) {
      if (!isMapOpen()) {
        const run = keys.has("shift");
        fwd.set(0, 0, -1).applyAxisAngle(UP, userYaw);
        right.set(1, 0, 0).applyAxisAngle(UP, userYaw);
        moveDir.set(0, 0, 0);
        if (keys.has("w") || keys.has("arrowup")) moveDir.add(fwd);
        if (keys.has("s") || keys.has("arrowdown")) moveDir.sub(fwd);
        if (keys.has("d") || keys.has("arrowright")) moveDir.add(right);
        if (keys.has("a") || keys.has("arrowleft")) moveDir.sub(right);
        const hereY = sampleElevSceneY(freePos.x, freePos.z);
        let desiredVx = 0;
        let desiredVz = 0;
        if (moveDir.lengthSq() > 0) {
          moveDir.normalize();
          // slow down on steep ground (uphill or downhill), like a suited walker would
          const ahead = sampleElevSceneY(freePos.x + moveDir.x * 1.5, freePos.z + moveDir.z * 1.5);
          const signedPitch = Math.atan2(ahead - hereY, 1.5);
          walkerSlopeRad = signedPitch;
          const slopeDeg = Math.abs(signedPitch) * (180 / Math.PI);
          const slowdown = devCfg.realisticPhysics
            ? Math.min(1, Math.max(0.26, 1 - Math.max(0, slopeDeg - 9) / 21))
            : Math.min(1, Math.max(0.35, 1 - Math.max(0, slopeDeg - 10) / 22));
          const v =
            (run ? RUN_SPEED_MS : WALK_SPEED_MS) *
            (devCfg.speedMultiplier || 1) *
            slowdown *
            (player.grounded ? 1 : 0.65);
          desiredVx = moveDir.x * v;
          desiredVz = moveDir.z * v;
        } else {
          const aheadIdle = sampleElevSceneY(freePos.x + fwd.x * 1.2, freePos.z + fwd.z * 1.2);
          walkerSlopeRad = Math.atan2(aheadIdle - hereY, 1.2);
        }

        if (devCfg.realisticPhysics) {
          // Physical regolith momentum + inertia, and loose scree slide down slopes > 22 deg
          const accelK = moveDir.lengthSq() > 0 ? (player.grounded ? 11.5 : 2.2) : player.grounded ? 9.5 : 0.6;
          const alpha = Math.min(1, dt * accelK);
          walkVelX += (desiredVx - walkVelX) * alpha;
          walkVelZ += (desiredVz - walkVelZ) * alpha;

          if (player.grounded) {
            const e = 0.8;
            const gx = (sampleElevSceneY(freePos.x + e, freePos.z) - sampleElevSceneY(freePos.x - e, freePos.z)) / (2 * e);
            const gz = (sampleElevSceneY(freePos.x, freePos.z + e) - sampleElevSceneY(freePos.x, freePos.z - e)) / (2 * e);
            const gradMag = Math.hypot(gx, gz);
            const slopeDegHere = Math.atan(gradMag) * (180 / Math.PI);
            if (slopeDegHere > 22 && gradMag > 1e-4) {
              const slip = Math.min(2.6, (slopeDegHere - 22) * 0.14);
              walkVelX += (-gx / gradMag) * slip * dt * 4.5;
              walkVelZ += (-gz / gradMag) * slip * dt * 4.5;
            }
          }
          freePos.x += walkVelX * dt;
          freePos.z += walkVelZ * dt;
        } else {
          walkVelX = desiredVx;
          walkVelZ = desiredVz;
          freePos.x += desiredVx * dt;
          freePos.z += desiredVz * dt;
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

      // Solid collision against visible NPC partner, parked rover, or live crewmates so free-roam cannot clip through them
      if (partner && partner.group.visible) {
        pushApart(partner.group.position);
      }
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
          const vn = walkVelX * col.nx + walkVelZ * col.nz;
          if (vn < 0) {
            walkVelX -= col.nx * vn;
            walkVelZ -= col.nz * vn;
          }
        }
        rover.update(dt, {
          sampleElevY: sampleElevSceneY,
          speed: 0,
          steer: 0,
          clockT,
          driving: false,
          physicsEnabled: Boolean(devCfg.realisticPhysics),
        });
        const distR = Math.hypot(freePos.x - rover.group.position.x, freePos.z - rover.group.position.z);
        if (distR <= 4.6 && !nearRoverPrompted) {
          nearRoverPrompted = true;
          showWrapNotice(
            isTrLang() ? "DENEYSEL MARS ARACI · BİNMEK İÇİN [F] TUŞUNA BAS" : "EXPERIMENTAL MARS ROVER · PRESS [F] TO DRIVE"
          );
        } else if (distR > 6.2) {
          nearRoverPrompted = false;
        }
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
    const ground = sampleElevSceneY(px, pz);
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
      player.y = ground;
      player.vy = 0;
      player.grounded = true;
    }
    if (player.grounded && player.y - ground > 0.25) player.grounded = false; // stepped off a drop
    if (!player.grounded) {
      player.vy -= MARS_G * dt;
      player.y += player.vy * dt;
      if (player.y <= ground) {
        const impactVy = Math.abs(player.vy);
        player.y = ground;
        player.vy = 0;
        player.grounded = true;
        if (devCfg.realisticDust && !drivingRover && impactVy > 0.6) {
          const jYaw = autoYaw + userYaw;
          marsFx.emitJumpBurst(px, ground, pz, {
            mode: "landing",
            impactSpeed: impactVy,
            rightX: Math.cos(jYaw),
            rightZ: -Math.sin(jYaw),
            fwdX: -Math.sin(jYaw),
            fwdZ: -Math.cos(jYaw),
            vx: walkVelX,
            vz: walkVelZ,
          });
        }
      }
    } else {
      player.y = ground;
    }
    const yaw = autoYaw + userYaw;
    const snappedThisFrame = justTeleportedOrWrapped;
    const step = !justTeleportedOrWrapped && movedXZ < 20 ? movedXZ : 0; // ignore teleport/wrap jumps
    justTeleportedOrWrapped = false;
    const groundSpeed = dt > 0 ? step / dt : 0;

    // own body: rigged walk driven by distance actually covered
    self.group.position.set(px, player.y, pz);
    self.group.rotation.y = yaw;
    if (drivingRover) {
      self.group.visible = false;
    } else {
      self.group.visible = suitRig != null;
    }
    // walking direction in the body frame, so strafing side-steps and S walks backwards
    let gaitDir = null;
    if (step > 1e-5) {
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      gaitDir = { f: (mvx * fx + mvz * fz) / movedXZ, s: (mvx * -fz + mvz * fx) / movedXZ };
    }
    self.update(dt, step, groundSpeed, !player.grounded, gaitDir);
    self.group.updateMatrixWorld(true);

    // Bootstep Martian regolith kickup puffs on foot plant while walking/running
    const footStepIdx = Math.floor((self.phase ?? 0) / Math.PI);
    if (footStepIdx !== prevFootStepCount) {
      prevFootStepCount = footStepIdx;
      if (devCfg.realisticDust && !drivingRover && player.grounded && groundSpeed > 0.35 && movedXZ > 1e-5) {
        const runFast = groundSpeed > 1.9;
        marsFx.emitBurst(
          px,
          ground,
          pz,
          runFast ? 7 : 4,
          runFast ? 1.15 : 0.72,
          -(mvx / movedXZ) * groundSpeed * 0.18,
          -(mvz / movedXZ) * groundSpeed * 0.18
        );
      }
    }

    // helmet camera at the visor (or cupola view when driving the experimental rover)
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
      camera.position.set(
        chaseCamPos.x,
        chaseCamPos.y + Math.sin(clockT * 16) * shake,
        chaseCamPos.z
      );
      camera.lookAt(chaseLookTarget);
    } else {
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
      remote.avatar.update(dt, rStep < 20 ? rStep : 0, rStep < 20 ? rSpeed : 0, remote.target.airborne, null);
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

    // Update windblown Mars aerosol dust, kickup plumes & REMS atmospheric haze
    const atm = marsFx.update(dt, camera.position, clockT, {
      dustEnabled: Boolean(devCfg.realisticDust),
      weatherEnabled: Boolean(devCfg.realisticWeather),
    });
    sun.intensity = baseSunIntensity * (devCfg.realisticWeather ? 1.0 - atm.gustFactor * 0.14 : 1.0);

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
      if (freeRoam) {
        updateHudReadouts(alongM, xToLon(px), zToLat(pz), computeLocalSlopeDeg(px, pz));
      } else {
        updateHudReadouts(alongM, sample.lon, sample.lat);
      }
    }
    followEndless(camera.position);
    if (isMapOpen()) renderTacticalMap();

    adaptResolution(dt * 1000, now);
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
    dropLocalPing,
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
