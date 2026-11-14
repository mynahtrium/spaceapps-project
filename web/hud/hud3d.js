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
  onSetRoute,
  sampleAlongRoute,
} from "../shared/route-bridge.js";
import { createAstronaut, loadSuitRig } from "./astronaut-rig.js";

const ASTRONAUT_HEIGHT_M = 1.8;
const EYE_HEIGHT_M = 1.64; // eye level inside the helmet of a 1.80 m astronaut
const EYE_FORWARD_M = 0.36; // at the visor, ahead of the suit's deep chest so the legs show when looking down
const WALK_SPEED_MS = 1.4; // placeholder walking pace (Earth hiking stand-in)
const RUN_SPEED_MS = 2.5; // a light suited run (Shift); clearly faster than walking, not a sprint
const MARS_G = 3.71; // m/s^2
const JUMP_SPEED_MS = 1.7; // about 0.4 m apex under Mars gravity
const PARTNER_AHEAD_M = 6;
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
    // Mars: small bluish halo right around the sun, warm dust glow further out
    col += vec3(0.55, 0.62, 0.75) * pow(s, 900.0) * 6.0;
    col += vec3(0.40, 0.48, 0.62) * pow(s, 60.0) * 0.6;
    col += vec3(0.30, 0.18, 0.10) * pow(s, 6.0) * 0.35;
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

export async function initHud3D(data, { onBackToPlanner, onOpenPov }) {
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

  // Convert [lon, lat] to local scene X, Z (metres, centred at 0,0)
  const lonToX = (lon) =>
    ((lon - bounds.west_lon_deg) / (bounds.east_lon_deg - bounds.west_lon_deg) - 0.5) * worldW;
  const latToZ = (lat) =>
    (0.5 - (lat - bounds.south_lat_deg) / (bounds.north_lat_deg - bounds.south_lat_deg)) * worldH;

  // ---------- renderer, scene, camera ----------
  const scene = new THREE.Scene();
  const HORIZON = new THREE.Color(0.62, 0.43, 0.3);
  scene.fog = new THREE.FogExp2(HORIZON.getHex(), 0.00042);

  const camera = new THREE.PerspectiveCamera(78, 1, 0.05, 9000);

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  wrap.appendChild(renderer.domElement);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // Sun: mid-afternoon, fairly low so the relief throws long shadows.
  const sunDir = new THREE.Vector3(-0.55, 0.42, -0.72).normalize();
  // Mars sees a small sun disc (about 0.35 deg), so near shadows are crisp; the thin dusty sky
  // fills them with a weak reddish light rather than washing them out.
  const SHADOW_HALF_M = 28;
  const SHADOW_MAP_PX = 4096;
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

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(8500, 48, 24),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color(0.23, 0.15, 0.12) },
        uHorizon: { value: HORIZON },
        uGround: { value: new THREE.Color(0.3, 0.19, 0.13) },
        uSunDir: { value: sunDir },
      },
    })
  );
  sky.renderOrder = -1;
  scene.add(sky);

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

  const fullSeg = elevGrid ? Math.min(imgW - 1, 394) : 1;
  const terrainGeom = buildTerrainGeometry(fullSeg);
  const copyGeom = buildTerrainGeometry(Math.max(1, Math.floor(fullSeg / 2)));

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

  const terrainMat = new THREE.MeshStandardMaterial({ map: reliefTex, roughness: 0.96, metalness: 0.0 });
  terrainMat.envMapIntensity = 0.7; // ground in shade stays dark; the suit keeps the full sky light
  terrainMat.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: detailTex };
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
      .replace("#include <map_pars_fragment>", "#include <map_pars_fragment>\nuniform sampler2D detailMap;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        #ifdef USE_MAP
          float dA = texture2D(detailMap, vMapUv * 173.0).r;
          float dB = texture2D(detailMap, vMapUv * 911.0).r;
          diffuseColor.rgb *= 0.62 + 0.55 * dA * 0.6 + 0.55 * dB * 0.4;
        #endif`
      );
  };

  const terrainMesh = new THREE.Mesh(terrainGeom, terrainMat);
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true;
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
  let totalDist = cumDist[cumDist.length - 1] || 1;
  let alongM = 0;

  function rebuildRouteRibbon(r) {
    if (routeLineMesh) scene.remove(routeLineMesh);
    activeRoute = r;
    routeCoords = r?.geometry?.coordinates || [];
    cumDist = buildCumulativeDistances(routeCoords);
    totalDist = cumDist[cumDist.length - 1] || 1;
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
      scene.add(routeLineMesh);
    }
    const scrubberEl = document.getElementById("hud-scrubber");
    if (scrubberEl) {
      scrubberEl.max = totalDist.toFixed(1);
      scrubberEl.value = alongM.toFixed(1);
    }
  }
  if (activeRoute) rebuildRouteRibbon(activeRoute);

  function routePoint(s) {
    const smp = sampleAlongRoute(routeCoords, cumDist, Math.max(0, Math.min(totalDist, s)));
    const x = lonToX(smp.lon);
    const z = latToZ(smp.lat);
    return { x, z, y: sampleElevSceneY(x, z), smp };
  }

  function routeHeading(s) {
    const a = routePoint(s - 2);
    const b = routePoint(s + 4);
    return Math.atan2(-(b.x - a.x), -(b.z - a.z));
  }

  // ---------- astronauts (NASA 3D Resources, procedural rig) ----------
  let self = null;
  let partner = null;
  let suitLabel = "SUIT MODEL UNAVAILABLE";
  {
    const draco = new DRACOLoader();
    draco.setDecoderPath("./vendor/addons/libs/draco/gltf/");
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    for (const m of SUIT_MODELS) {
      try {
        const rig = await loadSuitRig(loader, m.url, ASTRONAUT_HEIGHT_M);
        self = createAstronaut(rig, { hideHead: true });
        partner = createAstronaut(rig);
        suitLabel = m.label + " · RIGGED";
        break;
      } catch (err) {
        console.warn("suit model failed", m.url, err);
      }
    }
  }
  if (!self) {
    // Stand-in: a 1.80 m capsule, labelled in the HUD
    const make = () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.32, ASTRONAUT_HEIGHT_M - 0.64, 6, 16),
        new THREE.MeshStandardMaterial({ color: 0xe9e7e2, roughness: 0.7 })
      );
      body.position.y = ASTRONAUT_HEIGHT_M / 2;
      body.castShadow = true;
      g.add(body);
      return { group: g, update() {}, phase: 0, amount: 0 };
    };
    self = make();
    self.group.visible = false;
    partner = make();
    suitLabel = "STAND-IN (MODEL NOT LOADED)";
  }
  scene.add(self.group, partner.group);
  const suitEl = document.getElementById("hud-suit");
  if (suitEl) suitEl.textContent = suitLabel;

  // ---------- bodycam lens pass ----------
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
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
  let freeRoam = false;
  let userYaw = 0;
  let pitch = -0.12;
  let autoYaw = routeCoords.length > 1 ? routeHeading(0) : 0;
  const freePos = new THREE.Vector3(0, 0, 0);
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
    pitch = Math.max(-1.35, Math.min(0.9, pitch - (e.clientY - lastY) * 0.003));
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const hudView = document.getElementById("hud-view");
  window.addEventListener("keydown", (e) => {
    if (!hudView.classList.contains("active")) return;
    const k = e.key.toLowerCase();
    keys.add(k);
    // walking keys take over from route playback
    if (!freeRoam && ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
      btnFreeRoam?.click();
    }
    if (k === " ") {
      e.preventDefault();
      if (player.grounded) {
        player.vy = JUMP_SPEED_MS;
        player.grounded = false;
      }
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
  const btnPov = document.getElementById("hud-pov-btn");

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

  btnFreeRoam?.addEventListener("click", () => {
    freeRoam = !freeRoam;
    btnFreeRoam.textContent = freeRoam ? "Free-roam: on" : "Free-roam: off";
    if (freeRoam) {
      const p = routePoint(alongM);
      freePos.set(p.x, 0, p.z);
      userYaw += autoYaw;
      autoYaw = 0;
    } else {
      userYaw = 0;
      autoYaw = routeHeading(alongM);
    }
  });

  onSetRoute(({ route: newRoute, along_m }) => {
    alongM = along_m || 0;
    userYaw = 0;
    freeRoam = false;
    if (btnFreeRoam) btnFreeRoam.textContent = "Free-roam: off";
    rebuildRouteRibbon(newRoute);
    autoYaw = routeCoords.length > 1 ? routeHeading(alongM) : 0;
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
  function updateHudReadouts(sM, lon, lat) {
    const frac = totalDist > 0 ? sM / totalDist : 0;
    const rem = Math.max(0, totalDist - sM);

    const prof = activeRoute?.profile || [];
    let slopeDeg = telemetry?.primary?.slope_deg ?? telemetry?.slope_deg ?? 4.0;
    if (prof.length > 1) {
      let i = 0;
      while (i < prof.length - 2 && prof[i + 1].s_m < sM) i++;
      slopeDeg = prof[i].slope_deg ?? slopeDeg;
    }
    const slopeClass = classifySlope(slopeDeg, 20);

    let nextStop = stops?.features?.[0];
    let minStopDist = Infinity;
    if (stops?.features?.length) {
      for (const f of stops.features) {
        const dx = lonToX(f.geometry.coordinates[0]) - lonToX(lon);
        const dz = latToZ(f.geometry.coordinates[1]) - latToZ(lat);
        const dd = Math.hypot(dx, dz);
        if (dd < minStopDist) {
          minStopDist = dd;
          nextStop = f;
        }
      }
    }

    const o2Pct = Math.max(0, 100 * (1 - frac)); // illustrative linear placeholder

    document.getElementById("hud-dist").textContent = `${sM.toFixed(1)} m`;
    document.getElementById("hud-dist-sub").textContent = `remaining ${rem.toFixed(1)} m · nearest stop ${
      minStopDist < Infinity ? minStopDist.toFixed(0) + " m" : "—"
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
    const pr = renderer.getPixelRatio();
    rt.setSize(Math.floor(w * pr), Math.floor(h * pr));
    lensMat.uniforms.uResolution.value.set(w * pr, h * pr);
  };
  window.addEventListener("resize", onResize);
  onResize();

  // ---------- loop ----------
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const moveDir = new THREE.Vector3();
  let prevT = performance.now();
  let clockT = 0;

  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min(0.1, (now - prevT) / 1000);
    prevT = now;
    clockT += dt;
    if (!hudView.classList.contains("active")) return; // do not render while hidden

    if (playing && !freeRoam) {
      const pace = keys.has("shift") ? RUN_SPEED_MS : WALK_SPEED_MS * SPEEDS[speedIdx];
      alongM += dt * pace;
      if (alongM > totalDist) alongM = 0;
      if (scrubber) scrubber.value = alongM.toFixed(1);
    }

    const sample = sampleAlongRoute(routeCoords, cumDist, alongM);
    let px;
    let pz;
    if (freeRoam) {
      const run = keys.has("shift");
      fwd.set(0, 0, -1).applyAxisAngle(UP, userYaw);
      right.set(1, 0, 0).applyAxisAngle(UP, userYaw);
      moveDir.set(0, 0, 0);
      if (keys.has("w") || keys.has("arrowup")) moveDir.add(fwd);
      if (keys.has("s") || keys.has("arrowdown")) moveDir.sub(fwd);
      if (keys.has("d") || keys.has("arrowright")) moveDir.add(right);
      if (keys.has("a") || keys.has("arrowleft")) moveDir.sub(right);
      if (moveDir.lengthSq() > 0) {
        moveDir.normalize();
        // slow down on steep ground (uphill or downhill), like a suited walker would
        const here = sampleElevSceneY(freePos.x, freePos.z);
        const ahead = sampleElevSceneY(freePos.x + moveDir.x * 1.5, freePos.z + moveDir.z * 1.5);
        const slopeDeg = Math.abs(Math.atan2(ahead - here, 1.5)) * (180 / Math.PI);
        const slowdown = Math.min(1, Math.max(0.35, 1 - Math.max(0, slopeDeg - 10) / 22));
        const v = (run ? RUN_SPEED_MS : WALK_SPEED_MS) * slowdown * (player.grounded ? 1 : 0.6);
        freePos.addScaledVector(moveDir, v * dt);
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
    self.update(dt, step, groundSpeed, !player.grounded);

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

    // crew member walking ahead on the route
    if (routeCoords.length > 1) {
      const wantS = alongM + PARTNER_AHEAD_M;
      const prevS = partnerS;
      const maxStep = (keys.has("shift") && !freeRoam ? RUN_SPEED_MS : WALK_SPEED_MS * SPEEDS[speedIdx]) * 1.2 * dt;
      partnerS += Math.max(-maxStep, Math.min(maxStep, wantS - partnerS));
      if (Math.abs(wantS - partnerS) > 30) partnerS = wantS; // scrubber jump
      const pa = routePoint(partnerS);
      const pStep = Math.abs(partnerS - prevS);
      partner.group.position.set(pa.x, pa.y, pa.z);
      partner.group.rotation.y = routeHeading(partnerS);
      partner.update(dt, pStep < 20 ? pStep : 0, dt > 0 && pStep < 20 ? pStep / dt : 0, false);
    }

    // sun and shadow box follow the walker
    const texel = (2 * SHADOW_HALF_M) / SHADOW_MAP_PX;
    sun.target.position.set(Math.round(px / texel) * texel, Math.round(ground / texel) * texel, Math.round(pz / texel) * texel);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 400);
    sky.position.copy(camera.position);

    updateHudReadouts(sample.sM, sample.lon, sample.lat);
    followEndless(camera.position);

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
  };
}
