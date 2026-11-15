/**
 * Orbit view (`web/orbit/orbit-view.js`): Mars as a globe seen from space.
 *
 * - Surface: NASA/USGS Viking MDIM 2.1 colour mosaic (or MGS MOLA colour-shaded relief), 4096×2048,
 *   bundled in web/assets/mars-globe/ so the view works offline / in demo-safe mode.
 * - Geodesy & Picking: NASA-AMMOS `3d-tiles-renderer` (`Ellipsoid`, `GlobeControls`) + Three.js `OrbitControls`.
 * - Labels: `three/addons/renderers/CSS2DRenderer.js` (`CSS2DRenderer`, `CSS2DObject`).
 * - Transitions & Descent: `@tweenjs/tween.js` (`Tween`, `Easing`, `Group`).
 * - Day/night: real subsolar point from the Mars24 algorithm for the current (or time-warped) date.
 * - Phobos & Deimos: real positions from a JPL Horizons-fitted series (MarsEphemeris.js). Moon *sizes*
 *   are exaggerated ×8 so they are visible; their orbits are to scale.
 * - Stars: real bright-star catalogue placed through the IAU Mars rotation; Sun and Earth directions are real.
 * - Click the surface to pick a landing site; "Land here" plays a stepped zoom-in, then hands off to the
 *   Bodycam through `onLand(lon, lat, { sunMode })`.
 */

import * as THREE from "three";
import { Ellipsoid } from "../../node_modules/3d-tiles-renderer/src/three/renderer/math/Ellipsoid.js";
import { GlobeControls } from "../../node_modules/3d-tiles-renderer/src/three/renderer/controls/GlobeControls.js";
import { OrbitControls } from "../../node_modules/three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "../../node_modules/three/examples/jsm/renderers/CSS2DRenderer.js";
import { Easing, Group as TweenGroup, Tween } from "../../node_modules/@tweenjs/tween.js/dist/tween.esm.js";
import { MARS_RADIUS_EQ_M, MARS_RADIUS_POLAR_M } from "../map/Geodesy.js";
import {
  BRIGHT_STARS,
  MARS_MEAN_RADIUS_KM,
  MARS_MOONS,
  coordinatedMarsTimeHours,
  earthBodyFixed,
  formatHoursHM,
  localTrueSolarTimeHours,
  marsEquatorialRad,
  marsInertialToBodyFixed,
  marsMoonInertial,
  marsOrbitState,
  marsRaDecToBodyFixed,
  marsSolDate,
  subsolarPoint,
} from "../hud/MarsEphemeris.js";
import { MARS_HISTORIC_ROVERS } from "../shared/mars-rovers.js";
import { BACK_BUTTON, CONFIRM_BUTTON, gamepad } from "../shared/gamepad.js";
import { ensurePadStyles } from "../shared/gamepad-ui.js";
import {
  MARS_ORBITERS,
  MARS_SURFACE_HARDWARE,
  orbiterElements,
  orbiterPositionAtAnomaly,
  orbiterPositionKm,
} from "../shared/mars-hardware.js";

const DEG = Math.PI / 180;
const MOON_SIZE_EXAGGERATION = 8;
const MIN_DIST = 1.00035; // ≈ 1.2 km altitude (allows zooming into the Gale HiRISE corridor)
const MAX_DIST = 24;
const HOME_DIST = 3.4;
const R_KM = MARS_MEAN_RADIUS_KM;

/**
 * NASA-AMMOS 3DTilesRendererJS Mars ellipsoid definitions:
 * - `MARS_ELLIPSOID`: Physical Mars IAU 2015 ellipsoid in metres.
 * - `MARS_UNIT_ELLIPSOID`: Scene-normalized unit sphere matching the rendered globe mesh.
 */
export const MARS_ELLIPSOID = new Ellipsoid(
  MARS_RADIUS_EQ_M,
  MARS_RADIUS_EQ_M,
  MARS_RADIUS_POLAR_M
);
export const MARS_UNIT_ELLIPSOID = new Ellipsoid(1, 1, 1);

// Registered Gale HiRISE corridor bounds (matches data/demo/corridor/manifest.json)
const GALE_CORRIDOR_BOUNDS = {
  west: 137.37117705900792,
  east: 137.40613392124214,
  south: -4.817449904706224,
  north: -4.725688141341328,
};

const GLOBE_LAYERS = [
  { id: "viking", label: "Viking colour", url: "./assets/mars-globe/mars-viking-color-4k.jpg" },
  { id: "mola", label: "MOLA relief", url: "./assets/mars-globe/mars-mola-shade-4k.jpg" },
];

const _ecefTmp = new THREE.Vector3();
const _ecefHit = new THREE.Vector3();
const _ecefRay = new THREE.Ray();
const _cartoTmp = { lat: 0, lon: 0, height: 0 };

/** Body-fixed [X, Y, Z] -> three.js vector (x = X, y = Z, z = -Y). */
function bfToVec3(v, out = new THREE.Vector3()) {
  return out.set(v[0], v[2], -v[1]);
}

/** Convert (lonDeg, latDeg, radiusUnits) to scene Vector3 via 3d-tiles-renderer Ellipsoid. */
function lonLatToVec3(lonDeg, latDeg, r = 1, out = new THREE.Vector3()) {
  MARS_UNIT_ELLIPSOID.getCartographicToPosition(latDeg * DEG, lonDeg * DEG, r - 1, _ecefTmp);
  return out.set(_ecefTmp.x, _ecefTmp.z, -_ecefTmp.y);
}

/** Convert scene Vector3 to { lon, lat } in degrees via 3d-tiles-renderer Ellipsoid. */
function vec3ToLonLat(v) {
  _ecefTmp.set(v.x, -v.z, v.y);
  MARS_UNIT_ELLIPSOID.getPositionToCartographic(_ecefTmp, _cartoTmp);
  return { lon: _cartoTmp.lon / DEG, lat: _cartoTmp.lat / DEG };
}

const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

function fmtLat(lat, d = 2) {
  return `${Math.abs(lat).toFixed(d)}°${lat < 0 ? "S" : "N"}`;
}
function fmtLonE(lon, d = 2) {
  return `${(((lon % 360) + 360) % 360).toFixed(d)}°E`;
}

const GLOBE_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const GLOBE_FRAG = /* glsl */ `
  uniform sampler2D uTex;
  uniform sampler2D uPatch;
  uniform vec4 uPatchRect; // u0, v0, u1, v1
  uniform float uPatchOn;
  uniform sampler2D uGaleTex;
  uniform vec4 uGaleRect; // u0, v0, u1, v1
  uniform float uGaleOn;
  uniform vec3 uSunDir;
  uniform float uHasTex;
  uniform float uDetail;
  varying vec3 vN;
  varying vec2 vUv;
  varying vec3 vWorld;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    vec3 n = normalize(vN);
    vec3 albedo = uHasTex > 0.5 ? texture2D(uTex, vUv).rgb : vec3(0.42, 0.22, 0.12);
    if (uPatchOn > 0.5 && vUv.x > uPatchRect.x && vUv.x < uPatchRect.z && vUv.y > uPatchRect.y && vUv.y < uPatchRect.w) {
      vec2 pu = (vUv - uPatchRect.xy) / (uPatchRect.zw - uPatchRect.xy);
      vec2 edge = min(pu, 1.0 - pu);
      float w = smoothstep(0.0, 0.08, min(edge.x, edge.y));
      albedo = mix(albedo, texture2D(uPatch, pu).rgb, w);
    }
    if (uGaleOn > 0.5 && vUv.x > uGaleRect.x && vUv.x < uGaleRect.z && vUv.y > uGaleRect.y && vUv.y < uGaleRect.w) {
      vec2 gu = (vUv - uGaleRect.xy) / (uGaleRect.zw - uGaleRect.xy);
      vec2 edge = min(gu, 1.0 - gu);
      float gw = smoothstep(0.0, 0.06, min(edge.x, edge.y));
      vec3 galeCol = texture2D(uGaleTex, gu).rgb * vec3(1.06, 0.86, 0.72);
      albedo = mix(albedo, galeCol, gw * 0.92);
    }
    if (uDetail > 0.001) {
      vec2 q = vUv * vec2(4096.0, 2048.0);
      float g = noise(q * 3.0) * 0.5 + noise(q * 11.0) * 0.3 + noise(q * 37.0) * 0.2;
      albedo *= mix(1.0, 0.78 + 0.44 * g, uDetail);
    }
    float ndl = dot(n, normalize(uSunDir));
    float day = smoothstep(-0.05, 0.08, ndl);
    float lambert = pow(max(ndl, 0.0), 0.8);
    vec3 lit = albedo * (0.05 + 1.1 * lambert);
    float band = smoothstep(-0.09, 0.0, ndl) * (1.0 - smoothstep(0.0, 0.14, ndl));
    lit += vec3(0.42, 0.17, 0.06) * band * 0.22;
    vec3 night = albedo * 0.012 + vec3(0.002, 0.0025, 0.004);
    vec3 col = mix(night, lit, day);
    vec3 v = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    col += vec3(0.85, 0.5, 0.32) * fres * 0.38 * smoothstep(-0.25, 0.35, ndl);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const HALO_VERT = /* glsl */ `
  varying vec3 vNView;
  varying vec3 vNWorld;
  void main() {
    vNView = normalize(normalMatrix * normal);
    vNWorld = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HALO_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  varying vec3 vNView;
  varying vec3 vNWorld;
  void main() {
    float i = pow(max(0.0, 0.72 - dot(vNView, vec3(0.0, 0.0, 1.0))), 3.2);
    float sunSide = smoothstep(-0.35, 0.4, dot(vNWorld, normalize(uSunDir)));
    gl_FragColor = vec4(vec3(0.95, 0.58, 0.36) * i * 1.6 * sunSide, 1.0);
  }
`;

function makeGlowTexture(inner = "rgba(255,248,230,1)", mid = "rgba(255,210,150,0.35)") {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.08, inner);
  grad.addColorStop(0.22, mid);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function lumpyMoonGeometry(radius, axes, seed) {
  const geom = new THREE.IcosahedronGeometry(radius, 4);
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, y, z) || 1;
    const nx = x / r;
    const ny = y / r;
    const nz = z / r;
    const lump = 0.06 * Math.sin(nx * 4.1 + seed) * Math.cos(ny * 3.7 - seed) + 0.04 * Math.sin(nz * 6.3 + nx * 2.0);
    const crater = Math.max(0, 1 - Math.hypot(nx - 0.55, ny - 0.2, nz - 0.8) / 0.5);
    const s = 1 + lump - 0.16 * crater * crater;
    pos.setXYZ(i, x * axes[0] * s, y * axes[1] * s, z * axes[2] * s);
  }
  geom.computeVertexNormals();
  return geom;
}

/**
 * @param {HTMLElement} viewEl  the #orbit-view section
 * @param {{ demoSafe?: boolean, onLand?: Function, getPlayerLonLat?: Function, isTr?: Function }} opts
 */
export function initOrbitView(viewEl, { demoSafe = false, onLand = null, getPlayerLonLat = null, isTr = () => false } = {}) {
  const wrap = viewEl.querySelector("#orbit-canvas-wrap");
  const labelsEl = viewEl.querySelector("#orbit-labels");
  const loadingEl = viewEl.querySelector("#orbit-loading");
  const timeEl = viewEl.querySelector("#orbit-time");
  const subsolarEl = viewEl.querySelector("#orbit-subsolar");
  const moonsEl = viewEl.querySelector("#orbit-moons");
  const hoverEl = viewEl.querySelector("#orbit-hover");
  const confirmEl = viewEl.querySelector("#orbit-confirm");
  const confirmTitleEl = viewEl.querySelector("#orbit-confirm-title");
  const confirmMetaEl = viewEl.querySelector("#orbit-confirm-meta");
  const confirmLocalEl = viewEl.querySelector("#orbit-confirm-local");
  const confirmGoBtn = viewEl.querySelector("#orbit-confirm-go");
  const confirmCancelBtn = viewEl.querySelector("#orbit-confirm-cancel");
  const layerBtn = viewEl.querySelector("#orbit-layer");
  const homeBtn = viewEl.querySelector("#orbit-home");
  const warpBtns = [...viewEl.querySelectorAll(".orbit-warp")];
  const descentEl = viewEl.querySelector("#orbit-descent");
  const descentAltEl = viewEl.querySelector("#orbit-descent-alt");
  const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

  // ---------- WebGL & CSS2D renderers ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  wrap.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer({ element: labelsEl || undefined });
  if (labelsEl) {
    labelRenderer.domElement.style.position = "absolute";
    labelRenderer.domElement.style.inset = "0";
    labelRenderer.domElement.style.pointerEvents = "none";
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.0005, 2000);

  // Configure 3d-tiles-renderer GlobeControls + Three.js OrbitControls with Mars ellipsoid
  const globeControls = new GlobeControls(scene, camera, renderer.domElement, null);
  globeControls.setEllipsoid?.(MARS_UNIT_ELLIPSOID);
  globeControls.enabled = false; // Driven via synchronized spherical camera state for nadir Gale alignment
  const orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.enablePan = false;
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.12;
  orbitControls.minDistance = MIN_DIST;
  orbitControls.maxDistance = MAX_DIST;
  orbitControls.enabled = false;

  const tweenGroup = new TweenGroup();

  const sunDir = new THREE.Vector3(1, 0, 0);
  const sunLight = new THREE.DirectionalLight(0xfff1e0, 2.6);
  scene.add(sunLight, new THREE.AmbientLight(0x221a16, 0.12));

  // ---------- globe ----------
  const globeUniforms = {
    uTex: { value: null },
    uHasTex: { value: 0 },
    uPatch: { value: null },
    uPatchRect: { value: new THREE.Vector4(0, 0, 0, 0) },
    uPatchOn: { value: 0 },
    uGaleTex: { value: null },
    uGaleRect: {
      value: new THREE.Vector4(
        (GALE_CORRIDOR_BOUNDS.west + 180) / 360,
        (GALE_CORRIDOR_BOUNDS.south + 90) / 180,
        (GALE_CORRIDOR_BOUNDS.east + 180) / 360,
        (GALE_CORRIDOR_BOUNDS.north + 90) / 180
      ),
    },
    uGaleOn: { value: 0 },
    uSunDir: { value: sunDir },
    uDetail: { value: 0 },
  };
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(1, 192, 96),
    new THREE.ShaderMaterial({ vertexShader: GLOBE_VERT, fragmentShader: GLOBE_FRAG, uniforms: globeUniforms })
  );
  scene.add(globe);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(1.045, 96, 48),
    new THREE.ShaderMaterial({
      vertexShader: HALO_VERT,
      fragmentShader: HALO_FRAG,
      uniforms: { uSunDir: { value: sunDir } },
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    })
  );
  scene.add(halo);

  const texLoader = new THREE.TextureLoader();
  const layerTex = new Map();
  const layerPixels = new Map();
  let layerIdx = 0;

  function captureLayerPixels(id, img) {
    if (!img || layerPixels.has(id)) return;
    try {
      const w = 1024;
      const h = 512;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      layerPixels.set(id, { w, h, data });
    } catch {
      /* ignore pixel capture errors in non-DOM/blocked environments */
    }
  }

  function sampleLayerRgb(buf, uNorm, vTopDown) {
    const u = ((uNorm % 1) + 1) % 1;
    const v = Math.max(0, Math.min(1, vTopDown));
    const fx = u * (buf.w - 1);
    const fy = v * (buf.h - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = (x0 + 1) % buf.w;
    const y1 = Math.min(buf.h - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const idx = (x, y) => (y * buf.w + x) * 4;
    const i00 = idx(x0, y0);
    const i10 = idx(x1, y0);
    const i01 = idx(x0, y1);
    const i11 = idx(x1, y1);
    const b = (k) => {
      const top = buf.data[i00 + k] + (buf.data[i10 + k] - buf.data[i00 + k]) * tx;
      const bot = buf.data[i01 + k] + (buf.data[i11 + k] - buf.data[i01 + k]) * tx;
      return top + (bot - top) * ty;
    };
    return [b(0), b(1), b(2)];
  }

  function sampleGlobeSurface(lon, lat) {
    const u = ((((Number(lon) || 0) + 180) % 360) + 360) % 360 / 360;
    const latC = Math.max(-89.5, Math.min(89.5, Number(lat) || 0));
    const v = (90 - latC) / 180;
    const vik = layerPixels.get("viking");
    const mola = layerPixels.get("mola");
    const colorSrc = vik || mola;
    const reliefSrc = mola || vik;
    if (!colorSrc && !reliefSrc) return null;

    let dust = [168, 98, 66];
    let rock = [92, 54, 42];
    if (colorSrc) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let minLum = Infinity;
      let dark = null;
      const stepU = 1 / colorSrc.w;
      const stepV = 1 / colorSrc.h;
      let n = 0;
      for (let oy = -2; oy <= 2; oy++) {
        for (let ox = -2; ox <= 2; ox++) {
          const rgb = sampleLayerRgb(colorSrc, u + ox * stepU * 0.6, v + oy * stepV * 0.6);
          rSum += rgb[0];
          gSum += rgb[1];
          bSum += rgb[2];
          const lum = rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11;
          if (lum < minLum) {
            minLum = lum;
            dark = rgb;
          }
          n++;
        }
      }
      dust = [Math.round(rSum / n), Math.round(gSum / n), Math.round(bSum / n)];
      rock = dark
        ? [Math.round(dark[0] * 0.72), Math.round(dark[1] * 0.72), Math.round(dark[2] * 0.75)]
        : [Math.round(dust[0] * 0.56), Math.round(dust[1] * 0.6), Math.round(dust[2] * 0.68)];
    }

    const skyHorizon = [
      Math.min(0.76, Math.max(0.42, 0.44 + (dust[0] / 255) * 0.32)),
      Math.min(0.56, Math.max(0.28, 0.28 + (dust[1] / 255) * 0.24)),
      Math.min(0.42, Math.max(0.18, 0.18 + (dust[2] / 255) * 0.18)),
    ];

    const gridN = 16;
    const heightGrid = new Float32Array(gridN * gridN);
    let molaNorm = 0.5;
    let roughness = 0.45;
    let slopeGradX = 0;
    let slopeGradZ = 0;

    if (reliefSrc) {
      const spanDeg = 0.08;
      const halfSpanU = spanDeg / 360;
      const halfSpanV = spanDeg / 180;
      const lum = (rgb) => (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114) / 255;
      const cRgb = sampleLayerRgb(reliefSrc, u, v);
      molaNorm = mola
        ? Math.max(0, Math.min(1, 0.25 + 0.5 * ((cRgb[0] - cRgb[2]) / 255 + 0.5) * 0.7 + lum(cRgb) * 0.3))
        : lum(cRgb);

      let sum = 0;
      let minV = Infinity;
      let maxV = -Infinity;
      for (let row = 0; row < gridN; row++) {
        const vv = v + (row / (gridN - 1) - 0.5) * 2 * halfSpanV;
        for (let col = 0; col < gridN; col++) {
          const uu = u + (col / (gridN - 1) - 0.5) * 2 * halfSpanU;
          const rgb = sampleLayerRgb(reliefSrc, uu, vv);
          const val = lum(rgb);
          heightGrid[row * gridN + col] = val;
          sum += val;
          if (val < minV) minV = val;
          if (val > maxV) maxV = val;
        }
      }
      const mean = sum / (gridN * gridN);
      const span = Math.max(0.02, maxV - minV);
      for (let i = 0; i < heightGrid.length; i++) {
        heightGrid[i] = Math.max(-1, Math.min(1, ((heightGrid[i] - mean) / span) * 2));
      }
      roughness = Math.max(0.18, Math.min(1.0, span * 5.2));
      const eL = lum(sampleLayerRgb(reliefSrc, u - halfSpanU, v));
      const eR = lum(sampleLayerRgb(reliefSrc, u + halfSpanU, v));
      const eN = lum(sampleLayerRgb(reliefSrc, u, v - halfSpanV));
      const eS = lum(sampleLayerRgb(reliefSrc, u, v + halfSpanV));
      slopeGradX = (eR - eL) * 0.04;
      slopeGradZ = (eS - eN) * 0.04;
    }

    return {
      dust,
      rock,
      skyHorizon,
      molaNorm,
      roughness,
      reliefM: Math.round(14 + roughness * 48),
      slopeGradX,
      slopeGradZ,
      heightGrid,
      gridN,
      gridSpanM: 2400,
    };
  }

  function loadLayer(idx) {
    const layer = GLOBE_LAYERS[idx];
    if (layerTex.has(layer.id)) {
      globeUniforms.uTex.value = layerTex.get(layer.id);
      globeUniforms.uHasTex.value = 1;
      return;
    }
    texLoader.load(
      layer.url,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        t.wrapS = THREE.RepeatWrapping;
        layerTex.set(layer.id, t);
        captureLayerPixels(layer.id, t.image);
        if (GLOBE_LAYERS[layerIdx].id === layer.id) {
          globeUniforms.uTex.value = t;
          globeUniforms.uHasTex.value = 1;
        }
        loadingEl?.classList.add("done");
      },
      undefined,
      () => {
        console.warn("[orbit] globe texture failed:", layer.url);
        loadingEl?.classList.add("done");
      }
    );
  }
  loadLayer(0);
  // Preload MOLA shaded-relief pixels quietly for accurate site relief sampling on any Orbit pick
  const molaPreload = new Image();
  molaPreload.crossOrigin = "anonymous";
  molaPreload.onload = () => captureLayerPixels("mola", molaPreload);
  molaPreload.src = GLOBE_LAYERS[1].url;
  // Local Gale HiRISE corridor overview overlay (works offline/demo-safe)
  texLoader.load(
    "../data/demo/corridor/overview.jpg",
    (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      globeUniforms.uGaleTex.value = t;
      globeUniforms.uGaleOn.value = 1;
    },
    undefined,
    () => {}
  );
  function syncLayerBtn() {
    if (layerBtn) layerBtn.textContent = `${isTr() ? "Katman" : "Layer"}: ${GLOBE_LAYERS[layerIdx].label}`;
  }
  syncLayerBtn();
  layerBtn?.addEventListener("click", () => {
    layerIdx = (layerIdx + 1) % GLOBE_LAYERS.length;
    loadLayer(layerIdx);
    syncLayerBtn();
  });

  // ---------- stars, sun, earth ----------
  const skyGroup = new THREE.Group();
  scene.add(skyGroup);
  const SKY_R = 900;
  const realStars = BRIGHT_STARS.map(([ra, dec, mag]) => ({ ...marsEquatorialRad(ra, dec), mag }));
  const FAINT = 1400;
  const starPos = new Float32Array((realStars.length + FAINT) * 3);
  const starCol = new Float32Array((realStars.length + FAINT) * 3);
  const faintDirs = [];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < FAINT; i++) {
    const u = rnd() * 2 - 1;
    const th = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    faintDirs.push([s * Math.cos(th), s * Math.sin(th), u]);
    const b = 0.12 + rnd() * 0.25;
    const k = (realStars.length + i) * 3;
    starCol[k] = b;
    starCol[k + 1] = b;
    starCol[k + 2] = b * (0.9 + rnd() * 0.2);
  }
  realStars.forEach((s, i) => {
    const b = Math.min(1.4, 0.45 + 0.9 * Math.pow(10, -0.3 * s.mag));
    starCol[i * 3] = b;
    starCol[i * 3 + 1] = b * 0.97;
    starCol[i * 3 + 2] = b * 0.92;
  });
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute("color", new THREE.BufferAttribute(starCol, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ size: 1.8, sizeAttenuation: false, vertexColors: true, depthWrite: false, toneMapped: false })
  );
  stars.frustumCulled = false;
  skyGroup.add(stars);

  const sunSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: makeGlowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  );
  sunSprite.scale.setScalar(70);
  skyGroup.add(sunSprite);
  const earthSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture("rgba(190,215,255,1)", "rgba(120,160,255,0.25)"),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
  );
  earthSprite.scale.setScalar(9);
  skyGroup.add(earthSprite);

  // ---------- moons ----------
  const moonDefs = [
    { name: "phobos", label: "Phobos", axes: [13.0, 11.4, 9.1], color: 0x8a7d72 },
    { name: "deimos", label: "Deimos", axes: [7.8, 6.0, 5.1], color: 0xa89a8a },
  ];
  const moons = moonDefs.map((def, k) => {
    const rUnits = (1 / R_KM) * MOON_SIZE_EXAGGERATION;
    const mesh = new THREE.Mesh(
      lumpyMoonGeometry(1, def.axes.map((a) => a * rUnits), k * 1.7 + 0.4),
      new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.95, metalness: 0 })
    );
    scene.add(mesh);
    const ringGeo = new THREE.BufferGeometry();
    ringGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(257 * 3), 3));
    const ring = new THREE.Line(
      ringGeo,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false })
    );
    scene.add(ring);
    return { ...def, mesh, ring, ringStamp: -Infinity, period: 360 / MARS_MOONS[def.name].n };
  });

  function updateMoonRing(m, date) {
    const arr = m.ring.geometry.attributes.position.array;
    const tmp = new THREE.Vector3();
    for (let i = 0; i <= 256; i++) {
      const t = new Date(date.getTime() + ((i / 256) * m.period - m.period / 2) * 86400000);
      const v = marsInertialToBodyFixed(marsMoonInertial(m.name, t), date);
      bfToVec3(v, tmp).multiplyScalar(1 / R_KM);
      arr[i * 3] = tmp.x;
      arr[i * 3 + 1] = tmp.y;
      arr[i * 3 + 2] = tmp.z;
    }
    m.ring.geometry.attributes.position.needsUpdate = true;
    m.ring.geometry.computeBoundingSphere();
  }

  // ---------- CSS2DRenderer labels ----------
  const labelGroup = new THREE.Group();
  scene.add(labelGroup);
  const labelObjects = new Map();
  function upsertCss2DLabel(id, html, cls = "") {
    let entry = labelObjects.get(id);
    if (!entry) {
      const el = document.createElement("div");
      el.className = `orbit-label ${cls}`;
      const obj = new CSS2DObject(el);
      obj.center?.set?.(0, 0.5);
      labelGroup.add(obj);
      entry = { el, obj };
      labelObjects.set(id, entry);
    }
    if (entry.el.dataset.html !== html) {
      entry.el.innerHTML = html;
      entry.el.dataset.html = html;
    }
    return entry;
  }

  const sites = MARS_HISTORIC_ROVERS.map((r) => ({
    id: `rover-${r.id}`,
    lon: r.lon,
    lat: r.lat,
    getHtml: () => `<span class="dot" style="background:${r.color}"></span>${r.name}${r.isHiRiseGaleSite ? " · HiRISE" : ""}`,
    rover: r,
  }));
  // Mars Habitat Station (Spawn) + Gale EVA Corridor stops (aligned with data/processed/routing/stops.json)
  sites.push(
    {
      id: "gale-habitat",
      siteId: "habitat",
      lon: 137.3875065,
      lat: -4.79721368,
      getHtml: () =>
        `<span class="dot" style="background:#38bdf8"></span>${isTr() ? "Mars Üssü · Başlangıç" : "Mars Habitat · Spawn"}`,
      rover: {
        name: "Mars Habitat Station",
        siteShortName: "MARS HABITAT · GALE CRATER",
        isHiRiseGaleSite: true,
      },
    },
    {
      id: "gale-glen-etive",
      stopId: "stop-mudstone-a",
      lon: 137.3835412,
      lat: -4.73030915,
      getHtml: () => `<span class="dot" style="background:#f472b6"></span>Glen Etive 1 · Sol 2486`,
      rover: {
        name: "Glen Etive 1",
        siteShortName: "GLEN ETIVE 1 · GALE HiRISE",
        isHiRiseGaleSite: true,
      },
    },
    {
      id: "gale-mary-anning",
      stopId: "stop-mudstone-b",
      lon: 137.3911375,
      lat: -4.72930656,
      getHtml: () => `<span class="dot" style="background:#a78bfa"></span>Mary Anning 3 · Sol 2870`,
      rover: {
        name: "Mary Anning 3",
        siteShortName: "MARY ANNING 3 · GALE HiRISE",
        isHiRiseGaleSite: true,
      },
    }
  );
  // The three landers (Viking 1, Phoenix, InSight) at their listed coordinates.
  for (const h of MARS_SURFACE_HARDWARE) {
    if (h.kind !== "lander") continue;
    sites.push({
      id: `hw-${h.id}`,
      lon: h.lon,
      lat: h.lat,
      getHtml: () => `<span class="dot" style="background:#fbbf24"></span>${h.name}`,
      rover: { name: h.name, siteShortName: h.site.split("·")[0].trim().toUpperCase(), isHiRiseGaleSite: false },
      hardwareId: h.id,
    });
  }

  // ---------- orbiters ----------
  const orbiterTex = makeGlowTexture("rgba(255,255,255,1)", "rgba(255,255,255,0.3)");
  const orbiters = MARS_ORBITERS.map((def) => {
    const marker = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: orbiterTex, color: def.color, depthWrite: false, toneMapped: false, sizeAttenuation: false })
    );
    marker.scale.setScalar(0.022);
    scene.add(marker);
    const ringGeo = new THREE.BufferGeometry();
    ringGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(193 * 3), 3));
    const ring = new THREE.Line(
      ringGeo,
      new THREE.LineBasicMaterial({ color: def.color, transparent: true, opacity: 0.32, depthWrite: false })
    );
    ring.frustumCulled = false;
    scene.add(ring);
    return { ...def, marker, ring, ringStamp: -Infinity, ...orbiterElements(def) };
  });
  function updateOrbiterRing(o, date) {
    const arr = o.ring.geometry.attributes.position.array;
    const tmp = new THREE.Vector3();
    for (let i = 0; i <= 192; i++) {
      const v = marsInertialToBodyFixed(orbiterPositionAtAnomaly(o, (i / 192) * Math.PI * 2), date);
      bfToVec3(v, tmp).multiplyScalar(1 / R_KM);
      arr[i * 3] = tmp.x;
      arr[i * 3 + 1] = tmp.y;
      arr[i * 3 + 2] = tmp.z;
    }
    o.ring.geometry.attributes.position.needsUpdate = true;
  }

  // ---------- camera control ----------
  const cam = { lon: 137.4, lat: -4.8, dist: HOME_DIST, tLon: 137.4, tLat: -4.8, tDist: HOME_DIST, vLon: 0, vLat: 0 };
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  function placeCamera() {
    lonLatToVec3(cam.lon, cam.lat, cam.dist, camera.position);
    camera.up.set(0, 1, 0);
    // Keep camera aimed straight at nadir (globe center) so screen center matches (cam.lon, cam.lat)
    // and cardinal orientation matches the 3D HUD map (+X east, -Z north).
    camera.lookAt(0, 0, 0);
    const alt = cam.dist - 1;
    camera.near = Math.max(0.00001, alt * 0.25);
    camera.far = 2000;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  const pointers = new Map();
  let dragMoved = 0;
  let pinchStart = null;
  let lastMove = 0;
  const canvas = renderer.domElement;

  // ---------- gamepad crosshair & aiming ----------
  ensurePadStyles();
  const crosshairEl = document.createElement("div");
  crosshairEl.className = "pad-crosshair";
  crosshairEl.innerHTML = `<div class="ring"></div>`;
  wrap.appendChild(crosshairEl);
  let aimU = 0.5;
  let aimV = 0.5;
  let padAimActive = false;
  let prevFrameNow = performance.now();

  canvas.addEventListener("pointerdown", (e) => {
    if (descent) return;
    padAimActive = false;
    crosshairEl.classList.remove("on");
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragMoved = 0;
    wrap.classList.add("dragging");
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: cam.tDist };
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    padAimActive = false;
    crosshairEl.classList.remove("on");
    const p = pointers.get(e.pointerId);
    lastHover = { x: e.clientX, y: e.clientY };
    if (!p || descent) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    dragMoved += Math.abs(dx) + Math.abs(dy);
    if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      cam.tDist = clampDist(1 + (pinchStart.dist - 1) * (pinchStart.d / Math.max(10, d)));
      return;
    }
    const h = canvas.clientHeight || 600;
    const k = ((cam.dist - 1) * 0.9 + 0.002) * (camera.fov / h) * 1.25;
    const lonScale = 1 / Math.max(0.15, Math.cos(cam.lat * DEG));
    cam.vLon = -dx * k * lonScale;
    cam.vLat = dy * k;
    cam.tLon += cam.vLon;
    cam.tLat = Math.max(-89, Math.min(89, cam.tLat + cam.vLat));
    lastMove = performance.now();
  });
  const endPointer = (e) => {
    const had = pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) wrap.classList.remove("dragging");
    if (had && dragMoved < 6 && e.type === "pointerup" && !descent) onPick(e.clientX, e.clientY);
    if (performance.now() - lastMove > 80) {
      cam.vLon = 0;
      cam.vLat = 0;
    }
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (descent) return;
      const f = Math.exp(Math.max(-0.6, Math.min(0.6, e.deltaY * 0.0012)));
      cam.tDist = clampDist(1 + (cam.tDist - 1) * f);
    },
    { passive: false }
  );
  canvas.addEventListener("dblclick", (e) => {
    const hit = pickSurface(e.clientX, e.clientY);
    if (!hit || descent) return;
    flyTo(hit.lon, hit.lat, clampDist(1 + (cam.tDist - 1) * 0.45));
  });
  function clampDist(d) {
    return Math.max(MIN_DIST, Math.min(MAX_DIST, d));
  }

  // ---------- picking via 3d-tiles-renderer Ellipsoid.intersectRay ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pickSurface(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const o = raycaster.ray.origin;
    const d = raycaster.ray.direction;
    _ecefRay.origin.set(o.x, -o.z, o.y);
    _ecefRay.direction.set(d.x, -d.z, d.y).normalize();
    const hit = MARS_UNIT_ELLIPSOID.intersectRay(_ecefRay, _ecefHit);
    if (!hit) return null;
    MARS_UNIT_ELLIPSOID.getPositionToCartographic(_ecefHit, _cartoTmp);
    return { lon: _cartoTmp.lon / DEG, lat: _cartoTmp.lat / DEG };
  }

  function surfaceVisible(v) {
    return tmpV2.copy(camera.position).sub(v).dot(v) > 0;
  }

  let pick = null; // { lon, lat, site }
  let simDate = new Date();
  function siteNear(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    let best = null;
    let bestD = cam.dist < 1.008 ? 8 : 13;
    for (const s of sites) {
      const v = lonLatToVec3(s.lon, s.lat, 1, tmpV);
      if (!surfaceVisible(v)) continue;
      tmpV2.copy(v).project(camera);
      if (tmpV2.z >= 1) continue;
      const sx = (tmpV2.x * 0.5 + 0.5) * w;
      const sy = (-tmpV2.y * 0.5 + 0.5) * h;
      const d = Math.hypot(sx + rect.left - clientX, sy + rect.top - clientY);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }
  function onPick(clientX, clientY) {
    const site = siteNear(clientX, clientY);
    const hit = site ? { lon: site.lon, lat: site.lat } : pickSurface(clientX, clientY);
    if (!hit) {
      pick = null;
      confirmEl.hidden = true;
      return;
    }
    pick = { lon: wrap180(hit.lon), lat: hit.lat, site };
    renderConfirm();
  }
  function onPickGamepad(clientX, clientY) {
    const site = siteNear(clientX, clientY);
    const hit = site ? { lon: site.lon, lat: site.lat } : pickSurface(clientX, clientY);
    if (!hit) return;
    pick = { lon: wrap180(hit.lon), lat: hit.lat, site };
    renderConfirm();
  }
  function renderConfirm() {
    if (!pick) return;
    const tr = isTr();
    const sun = subsolarPoint(simDate);
    const ltst = localTrueSolarTimeHours(new Date(), pick.lon);
    const elev = Math.asin(
      Math.max(-1, Math.min(1, lonLatToVec3(pick.lon, pick.lat).dot(lonLatToVec3(sun.lonEastDeg, sun.latDeg))))
    );
    const subNow = subsolarPoint(new Date());
    const isNightNow = lonLatToVec3(pick.lon, pick.lat).dot(lonLatToVec3(subNow.lonEastDeg, subNow.latDeg)) < 0;
    const gale = pick.site?.rover?.isHiRiseGaleSite;
    const terrain = gale
      ? tr
        ? "Gerçek HiRISE 1 m DTM (Gale)"
        : "Real HiRISE 1 m DTM (Gale tile)"
      : pick.site
        ? tr
          ? `${pick.site.rover.name} sahası · prosedürel arazi`
          : `${pick.site.rover.name} site · procedural relief`
        : tr
          ? "Prosedürel arazi (haritalanmış topoğrafya değil)"
          : "Procedural relief (not mapped topography)";
    confirmTitleEl.textContent = pick.site ? pick.site.rover.siteShortName : tr ? "İNİŞ NOKTASI" : "LANDING SITE";
    confirmMetaEl.innerHTML =
      `${fmtLat(pick.lat, 3)} · ${fmtLonE(pick.lon, 3)}<br/>` +
      `${tr ? "Yerel gerçek güneş saati (şimdi)" : "Local true solar time (now)"}: <strong>${formatHoursHM(ltst)}</strong> · ${
        isNightNow ? (tr ? "GECE" : "NIGHT") : tr ? "GÜNDÜZ" : "DAY"
      }<br/>` +
      (warp !== 1
        ? `${tr ? "Görünen zamanda güneş" : "Sun at shown time"}: ${(elev / DEG).toFixed(0)}°<br/>`
        : "") +
      `${tr ? "Arazi" : "Terrain"}: ${terrain}`;
    const padHint = gamepad.connected;
    if (confirmGoBtn) confirmGoBtn.textContent = tr ? (padHint ? "Buraya in [A]" : "Buraya in") : padHint ? "Land here [A]" : "Land here";
    if (confirmCancelBtn) confirmCancelBtn.textContent = tr ? (padHint ? "İptal [B]" : "İptal") : padHint ? "Cancel [B]" : "Cancel";
    confirmEl.hidden = false;
  }
  confirmCancelBtn?.addEventListener("click", () => {
    pick = null;
    confirmEl.hidden = true;
  });
  confirmGoBtn?.addEventListener("click", () => {
    if (!pick) return;
    confirmEl.hidden = true;
    startDescent(pick.lon, pick.lat, {
      sunMode: confirmLocalEl?.checked === false ? "day" : "local",
      roverId: pick.site?.rover?.id || null,
      hardwareId: pick.site?.hardwareId || null,
      siteId: pick.site?.siteId || null,
      stopId: pick.site?.stopId || null,
      globeSample: sampleGlobeSurface(pick.lon, pick.lat),
    });
  });

  function isOrbitUiBlocked() {
    return Boolean(
      document.querySelector(
        "#modal-backdrop.open, #esc-menu.open, #pad-setup.open, #start-screen:not(.hidden)"
      )
    );
  }

  function pickAtCrosshair() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const cx = rect.left + aimU * rect.width;
    const cy = rect.top + aimV * rect.height;
    lastHover = { x: cx, y: cy };
    onPick(cx, cy);
  }

  function panBy(dlon, dlat) {
    if (descent) return;
    const arcScale = (cam.dist - 1) * 0.9 + 0.004;
    const lonScale = 1 / Math.max(0.15, Math.cos(cam.lat * DEG));
    cam.vLon = 0;
    cam.vLat = 0;
    cam.tLon += (Number(dlon) || 0) * arcScale * lonScale;
    cam.tLat = Math.max(-89, Math.min(89, cam.tLat + (Number(dlat) || 0) * arcScale));
  }

  function zoomBy(factor) {
    if (descent) return;
    const f = Number(factor) > 0 ? Number(factor) : 1;
    cam.tDist = clampDist(1 + (cam.tDist - 1) * f);
  }

  function moveCrosshair(dx, dy) {
    if (descent) return;
    padAimActive = true;
    aimU = Math.max(0.08, Math.min(0.92, aimU + (Number(dx) || 0)));
    aimV = Math.max(0.08, Math.min(0.92, aimV + (Number(dy) || 0)));
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const cx = rect.left + aimU * rect.width;
      const cy = rect.top + aimV * rect.height;
      lastHover = { x: cx, y: cy };
      onPickGamepad(cx, cy);
    }
  }

  function confirmCrosshair() {
    if (descent) return;
    if (pick && !confirmEl.hidden) {
      confirmGoBtn?.click();
    } else {
      padAimActive = true;
      pickAtCrosshair();
    }
  }

  gamepad.onPress(({ button, actions }) => {
    if (!active || descent || isOrbitUiBlocked()) return;
    if (button === CONFIRM_BUTTON || actions.includes("confirm")) {
      confirmCrosshair();
      return;
    }
    if (actions.includes("pin")) {
      padAimActive = true;
      pickAtCrosshair();
      return;
    }
    if (actions.includes("interact")) {
      layerBtn?.click();
      return;
    }
    if (button === BACK_BUTTON || actions.includes("back")) {
      if (pick && !confirmEl.hidden) {
        confirmCancelBtn?.click();
      } else {
        document.getElementById("btn-tab-hud")?.click();
      }
    }
  });
  homeBtn?.addEventListener("click", () => {
    const p = getPlayerLonLat?.();
    if (!p) return;
    flyTo(p.lon, p.lat, Math.min(cam.tDist, 1.6));
  });

  // ---------- time ----------
  let warp = 1;
  let simBaseReal = Date.now();
  let simBase = Date.now();
  function setWarp(w) {
    simBase = simDate.getTime();
    simBaseReal = Date.now();
    warp = w;
    if (w === 1) simBase = Date.now();
    warpBtns.forEach((b) => b.classList.toggle("active", Number(b.dataset.warp) === w));
  }
  warpBtns.forEach((b) => b.addEventListener("click", () => setWarp(Number(b.dataset.warp) || 1)));

  // ---------- descent powered by @tweenjs/tween.js ----------
  let descent = null;
  let descentTimerId = 0;
  const STEPS_KM = [2000, 400, 60, 8];
  function startDescent(lon, lat, landOpts) {
    clearTimeout(descentTimerId);
    tweenGroup.removeAll();
    if (reducedMotion()) {
      descentEl.classList.add("on", "flash");
      descentTimerId = setTimeout(() => finishDescent(lon, lat, landOpts), 450);
      descent = { reduced: true };
      return;
    }
    const startDist = Math.max(cam.dist, 1 + STEPS_KM[0] / R_KM + 0.05);
    const targetLon = cam.lon + wrap180(lon - cam.lon);
    descent = {
      lon,
      lat,
      landOpts,
      stepIdx: -1,
      shake: 0,
    };
    cam.vLon = cam.vLat = 0;
    descentEl.classList.add("on");
    descentEl.classList.remove("flash", "whoosh");

    const alignState = { lon: cam.lon, lat: cam.lat, dist: cam.dist };
    const alignTween = new Tween(alignState, tweenGroup)
      .to({ lon: targetLon, lat, dist: startDist }, 900)
      .easing(Easing.Cubic.InOut)
      .onUpdate(() => {
        if (!descent) return;
        cam.lon = cam.tLon = alignState.lon;
        cam.lat = cam.tLat = alignState.lat;
        cam.dist = cam.tDist = alignState.dist;
        if (descentAltEl) {
          descentAltEl.textContent = `ALT ${Math.round((cam.dist - 1) * R_KM).toLocaleString()} km`;
        }
      });

    let prevTween = alignTween;
    for (let idx = 0; idx < STEPS_KM.length; idx++) {
      const fromKm = idx === 0 ? (startDist - 1) * R_KM : STEPS_KM[idx - 1];
      const toKm = STEPS_KM[idx];
      const stepState = { u: 0 };
      const punchTween = new Tween(stepState, tweenGroup)
        .to({ u: 1 }, 360)
        .easing(Easing.Exponential.Out)
        .onStart(() => {
          if (!descent) return;
          descent.stepIdx = idx;
          if (idx === 2) loadDetailPatch(lon, lat);
          descentEl.classList.add("whoosh");
        })
        .onUpdate(() => {
          if (!descent) return;
          const km = Math.exp(Math.log(fromKm) + (Math.log(toKm) - Math.log(fromKm)) * stepState.u);
          cam.lon = cam.tLon = lon;
          cam.lat = cam.tLat = lat;
          cam.dist = cam.tDist = 1 + km / R_KM;
          descent.shake = (1 - stepState.u) * 0.6;
          if (descentAltEl) {
            descentAltEl.textContent = `ALT ${Math.round((cam.dist - 1) * R_KM).toLocaleString()} km`;
          }
        });

      const holdState = { t: 0 };
      const holdTween = new Tween(holdState, tweenGroup)
        .to({ t: 0.34 }, 340)
        .onStart(() => {
          if (!descent) return;
          cam.dist = cam.tDist = 1 + toKm / R_KM;
          descentEl.classList.remove("whoosh");
        })
        .onUpdate(() => {
          if (!descent) return;
          descent.shake = Math.max(0, 0.25 - holdState.t * 1.2);
          if (descentAltEl) {
            descentAltEl.textContent = `ALT ${Math.round((cam.dist - 1) * R_KM).toLocaleString()} km`;
          }
        });

      prevTween.chain(punchTween);
      punchTween.chain(holdTween);
      prevTween = holdTween;
    }

    prevTween.onComplete(() => {
      if (!descent) return;
      cam.dist = cam.tDist = 1 + STEPS_KM[STEPS_KM.length - 1] / R_KM;
      descent.shake = 0;
      if (!descentEl.classList.contains("flash")) {
        descentEl.classList.add("flash");
        descent.done = true;
        descentTimerId = setTimeout(() => finishDescent(lon, lat, landOpts), 320);
      }
    });

    alignTween.start(performance.now());
  }

  function finishDescent(lon, lat, landOpts) {
    descentTimerId = 0;
    descent = null;
    tweenGroup.removeAll();
    if (!active) {
      descentEl.classList.remove("on", "flash", "whoosh");
      if (descentAltEl) descentAltEl.textContent = "";
      return;
    }
    onLand?.(lon, lat, landOpts);
    setTimeout(() => {
      descentEl.classList.remove("on", "flash", "whoosh");
      if (descentAltEl) descentAltEl.textContent = "";
    }, 120);
  }

  function flyTo(lon, lat, dist = 1.6) {
    const targetLon = cam.lon + wrap180(lon - cam.lon);
    const targetLat = Math.max(-89, Math.min(89, lat));
    const targetDist = clampDist(dist);
    cam.tLon = targetLon;
    cam.tLat = targetLat;
    cam.tDist = targetDist;
    if (reducedMotion()) {
      cam.lon = targetLon;
      cam.lat = targetLat;
      cam.dist = targetDist;
      return;
    }
    new Tween(cam, tweenGroup)
      .to({ tLon: targetLon, tLat: targetLat, tDist: targetDist }, 550)
      .easing(Easing.Cubic.Out)
      .start(performance.now());
  }

  // ---------- optional high-res patch for the last descent steps (network only) ----------
  let patchKey = null;
  function loadDetailPatch(lon, lat) {
    if (demoSafe) return; // demo-safe: bundled globe only, zero network
    const z = 7;
    const cols = 2 ** (z + 1);
    const rows = 2 ** z;
    const col0 = Math.floor(((lon + 180) / 360) * cols) - 1;
    const row0 = Math.floor(((90 - lat) / 180) * rows) - 1;
    const n = 3;
    const key = `${z}/${row0}/${col0}`;
    if (key === patchKey) return;
    patchKey = key;
    const c = document.createElement("canvas");
    c.width = c.height = 256 * n;
    const g = c.getContext("2d");
    let pending = n * n;
    let ok = 0;
    const done = () => {
      if (--pending > 0 || patchKey !== key) return;
      if (ok < n * n) return;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      globeUniforms.uPatch.value?.dispose?.();
      globeUniforms.uPatch.value = tex;
      const u0 = col0 / cols;
      const u1 = (col0 + n) / cols;
      const v1 = 1 - row0 / rows;
      const v0 = 1 - (row0 + n) / rows;
      globeUniforms.uPatchRect.value.set(u0, v0, u1, v1);
      globeUniforms.uPatchOn.value = 1;
    };
    for (let r = 0; r < n; r++) {
      for (let k = 0; k < n; k++) {
        const row = row0 + r;
        const col = (((col0 + k) % cols) + cols) % cols;
        if (row < 0 || row >= rows) {
          done();
          continue;
        }
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          g.drawImage(img, k * 256, r * 256);
          ok++;
          done();
        };
        img.onerror = done;
        img.src = `https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/${z}/${row}/${col}.jpg`;
      }
    }
  }

  // ---------- per-frame ----------
  let active = false;
  let raf = 0;
  let lastHover = null;
  let hoverStamp = 0;
  let infoStamp = 0;
  function frame(now) {
    if (!active) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0.001, (now - prevFrameNow) / 1000));
    prevFrameNow = now;
    simDate = new Date(simBase + (Date.now() - simBaseReal) * warp);
    const uiBlocked = isOrbitUiBlocked();

    tweenGroup.update(now);
    if (!descent) {
      if (!uiBlocked) {
        const mv = gamepad.move();
        if (Math.hypot(mv.x, mv.y) > 0.01) {
          padAimActive = true;
          panBy(mv.x * 58 * dt, mv.y * 58 * dt);
        }
        const zoomIn = gamepad.analog("throttle");
        const zoomOut = gamepad.analog("brake");
        const zoomNet = zoomIn - zoomOut;
        if (Math.abs(zoomNet) > 0.02) {
          zoomBy(Math.exp(-zoomNet * 1.65 * dt));
        }
      }
      if (pointers.size === 0 && (cam.vLon || cam.vLat)) {
        cam.tLon += cam.vLon;
        cam.tLat = Math.max(-89, Math.min(89, cam.tLat + cam.vLat));
        cam.vLon *= 0.9;
        cam.vLat *= 0.9;
        if (Math.abs(cam.vLon) + Math.abs(cam.vLat) < 1e-5) cam.vLon = cam.vLat = 0;
      }
      const k = 0.2;
      cam.lon += (cam.tLon - cam.lon) * k;
      cam.lat += (cam.tLat - cam.lat) * k;
      cam.dist = Math.exp(Math.log(cam.dist - 1) + (Math.log(cam.tDist - 1) - Math.log(cam.dist - 1)) * 0.16) + 1;
    }
    placeCamera();
    if (!descent && !uiBlocked) {
      const rs = gamepad.rightStick();
      if (Math.hypot(rs.x, rs.y) > 0.01) {
        moveCrosshair(rs.x * 0.65 * dt, rs.y * 0.65 * dt);
      }
    }
    if (padAimActive && !descent) {
      crosshairEl.classList.add("on");
      crosshairEl.style.left = `${(aimU * 100).toFixed(2)}%`;
      crosshairEl.style.top = `${(aimV * 100).toFixed(2)}%`;
    } else {
      crosshairEl.classList.remove("on");
    }
    if (descent?.shake) {
      const s = descent.shake * (cam.dist - 1) * 0.02;
      camera.position.x += (Math.random() - 0.5) * s;
      camera.position.y += (Math.random() - 0.5) * s;
      camera.position.z += (Math.random() - 0.5) * s;
    }
    globeUniforms.uDetail.value = Math.max(0, Math.min(1, (0.02 - (cam.dist - 1)) / 0.018));

    // sun & sky
    const sub = subsolarPoint(simDate);
    lonLatToVec3(sub.lonEastDeg, sub.latDeg, 1, sunDir);
    sunLight.position.copy(sunDir).multiplyScalar(10);
    skyGroup.position.copy(camera.position);
    sunSprite.position.copy(sunDir).multiplyScalar(SKY_R * 0.8);
    const e = earthBodyFixed(simDate);
    bfToVec3(e.dir, earthSprite.position).multiplyScalar(SKY_R * 0.79);
    const pos = starGeo.attributes.position.array;
    realStars.forEach((s, i) => {
      bfToVec3(marsRaDecToBodyFixed(s.ra, s.dec, simDate), tmpV).multiplyScalar(SKY_R);
      pos[i * 3] = tmpV.x;
      pos[i * 3 + 1] = tmpV.y;
      pos[i * 3 + 2] = tmpV.z;
    });
    for (let i = 0; i < faintDirs.length; i++) {
      bfToVec3(marsInertialToBodyFixed(faintDirs[i], simDate), tmpV).multiplyScalar(SKY_R);
      const k3 = (realStars.length + i) * 3;
      pos[k3] = tmpV.x;
      pos[k3 + 1] = tmpV.y;
      pos[k3 + 2] = tmpV.z;
    }
    starGeo.attributes.position.needsUpdate = true;

    // moons
    for (const m of moons) {
      const inertial = marsMoonInertial(m.name, simDate);
      bfToVec3(marsInertialToBodyFixed(inertial, simDate), m.mesh.position).multiplyScalar(1 / R_KM);
      m.mesh.lookAt(0, 0, 0);
      if (now - m.ringStamp > (warp > 1 ? 120 : 2000)) {
        updateMoonRing(m, simDate);
        m.ringStamp = now;
      }
    }

    // orbiters
    for (const o of orbiters) {
      const inertial = orbiterPositionKm(o, simDate.getTime() / 1000);
      bfToVec3(marsInertialToBodyFixed(inertial, simDate), o.marker.position).multiplyScalar(1 / R_KM);
      if (now - o.ringStamp > (warp > 1 ? 120 : 1500)) {
        updateOrbiterRing(o, simDate);
        o.ringStamp = now;
      }
    }

    updateLabels(sub);
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);

    if (now - infoStamp > 250) {
      infoStamp = now;
      updateInfo(sub);
    }
    if (lastHover && now - hoverStamp > 60 && !descent) {
      hoverStamp = now;
      updateHover(sub);
    }
  }

  const labelScratch = new THREE.Vector3();
  const labelUsed = new Set();
  function updateLabels(sub) {
    labelUsed.clear();
    const put = (id, v, html, cls, surface) => {
      const vis = surface ? surfaceVisible(v) : !occludedByGlobe(v);
      const entry = upsertCss2DLabel(id, html, cls);
      entry.obj.position.copy(v);
      entry.obj.visible = vis;
      entry.el.style.display = vis ? "" : "none";
      if (vis) labelUsed.add(id);
    };
    if (!descent || descent.stepIdx < 1) {
      for (const s of sites) put(s.id, lonLatToVec3(s.lon, s.lat, 1, labelScratch), s.getHtml ? s.getHtml() : s.html, "", true);
      const p = getPlayerLonLat?.();
      if (p && Number.isFinite(p.lon)) {
        put("you", lonLatToVec3(p.lon, p.lat, 1, labelScratch), `<span class="dot"></span>${isTr() ? "SEN" : "YOU"}`, "you", true);
      }
      for (const m of moons) {
        labelScratch.copy(m.mesh.position);
        put(m.name, labelScratch, `${m.label} <span style="opacity:.55">×${MOON_SIZE_EXAGGERATION} size</span>`, "moon", false);
      }
      for (const o of orbiters) {
        const alt = o.periKm === o.apoKm ? `${o.periKm} km` : `${o.periKm.toLocaleString()} × ${o.apoKm.toLocaleString()} km`;
        put(
          `orb-${o.id}`,
          o.marker.position,
          `<span class="dot" style="background:${o.color}"></span>${o.name} <span style="opacity:.55">${alt} · ${isTr() ? "temsili konum" : "illustrative position"}</span>`,
          "moon",
          false
        );
      }
      put("sun", labelScratch.copy(sunSprite.position).add(skyGroup.position), "Sun", "moon", false);
      put("earth", labelScratch.copy(earthSprite.position).add(skyGroup.position), "Earth", "moon", false);
      put("subsolar", lonLatToVec3(sub.lonEastDeg, sub.latDeg, 1, labelScratch), "☀ noon", "", true);
    }
    if (pick && !confirmEl.hidden) put("pick", lonLatToVec3(pick.lon, pick.lat, 1, labelScratch), `<span class="dot"></span>`, "pick", true);
    for (const [id, entry] of labelObjects) {
      if (!labelUsed.has(id)) {
        entry.obj.visible = false;
        if (entry.el.style.display !== "none") entry.el.style.display = "none";
      }
    }
  }

  function occludedByGlobe(v) {
    const o = camera.position;
    const d = tmpV2.copy(v).sub(o);
    const len = d.length();
    if (len < 1e-6) return false;
    d.divideScalar(len);
    _ecefRay.origin.set(o.x, -o.z, o.y);
    _ecefRay.direction.set(d.x, -d.z, d.y).normalize();
    const hit = MARS_UNIT_ELLIPSOID.intersectRay(_ecefRay, _ecefHit);
    if (!hit) return false;
    const distToHit = _ecefRay.origin.distanceTo(_ecefHit);
    return distToHit > 0 && distToHit < len;
  }

  function updateInfo(sub) {
    const tr = isTr();
    const o = marsOrbitState(simDate);
    const msd = marsSolDate(simDate);
    const utc = simDate.toISOString().replace("T", " ").slice(0, 16);
    timeEl.textContent = `${warp === 1 ? (tr ? "CANLI" : "LIVE") : `×${warp.toLocaleString()}`} · UTC ${utc} · MSD ${Math.floor(msd)} · MTC ${formatHoursHM(
      coordinatedMarsTimeHours(simDate)
    )} · Ls ${o.ls.toFixed(1)}°`;
    subsolarEl.textContent = `${tr ? "Güneş-altı nokta" : "Subsolar point"} ${fmtLat(sub.latDeg)} ${fmtLonE(sub.lonEastDeg)} · Mars24 (NASA GISS)`;
    const parts = moons.map((m) => {
      const v = m.mesh.position;
      const ll = vec3ToLonLat(v);
      const altKm = (v.length() - 1) * R_KM;
      return `${m.label} ${fmtLat(ll.lat, 1)} ${fmtLonE(ll.lon, 1)} · ${Math.round(altKm).toLocaleString()} km`;
    });
    moonsEl.textContent = `${parts.join(" · ")} · JPL Horizons fit · ${
      tr
        ? `${orbiters.length} yörünge aracı: irtifa ve eğim gerçek, yörünge üzerindeki konum temsili`
        : `${orbiters.length} orbiters: altitude and inclination nominal, position along the track illustrative`
    }`;
  }

  function updateHover(sub) {
    const hit = pickSurface(lastHover.x, lastHover.y);
    const tr = isTr();
    const altKm = Math.round((cam.dist - 1) * R_KM).toLocaleString();
    if (!hit) {
      hoverEl.textContent = tr
        ? gamepad.connected
          ? `İRTİFA ${altKm} km · SOL ÇUBUK: HARİTA HAREKET · SAĞ ÇUBUK: KONUM İŞARETLE · RT/LT: YAKINLAŞ · A: ONAYLA`
          : `İRTİFA ${altKm} km · SÜRÜKLE: DÖNDÜR · TEKERLEK: YAKINLAŞ · YÜZEYE TIKLA: İNİŞ NOKTASI SEÇ`
        : gamepad.connected
        ? `ALT ${altKm} km · L-STICK: MOVE MAP · R-STICK: MARK SITE · RT/LT: ZOOM · A: CONFIRM`
        : `ALT ${altKm} km · DRAG TO ROTATE · SCROLL / PINCH TO ZOOM · CLICK THE SURFACE TO PICK A LANDING SITE`;
      return;
    }
    const lt = localTrueSolarTimeHours(simDate, hit.lon);
    const el = Math.asin(
      Math.max(-1, Math.min(1, lonLatToVec3(hit.lon, hit.lat).dot(lonLatToVec3(sub.lonEastDeg, sub.latDeg))))
    ) / DEG;
    const phase = el > 0 ? (tr ? "GÜNDÜZ" : "DAY") : el > -18 ? (tr ? "ALACAKARANLIK" : "TWILIGHT") : tr ? "GECE" : "NIGHT";
    hoverEl.textContent = `${fmtLat(hit.lat)} ${fmtLonE(hit.lon)} · LTST ${formatHoursHM(lt)} · ${phase} (${tr ? "güneş" : "sun"} ${el.toFixed(0)}°) · ${
      tr ? "İRTİFA" : "ALT"
    } ${altKm} km`;
  }

  function onResize() {
    const w = wrap.clientWidth || window.innerWidth;
    const h = wrap.clientHeight || window.innerHeight - 44;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
  }
  window.addEventListener("resize", () => active && onResize());

  return {
    /** Show the view; with `from` the camera starts close over that point and eases out (Bodycam -> orbit). */
    show({ from = null } = {}) {
      active = true;
      prevFrameNow = performance.now();
      if (gamepad.connected) padAimActive = true;
      onResize();
      descentEl.classList.remove("on", "flash", "whoosh");
      if (from && Number.isFinite(from.lon) && Number.isFinite(from.lat)) {
        const fLon = wrap180(from.lon);
        cam.lon = cam.tLon = fLon;
        cam.lat = cam.tLat = Math.max(-89, Math.min(89, from.lat));
        const inGaleRegion =
          fLon >= GALE_CORRIDOR_BOUNDS.west - 0.25 &&
          fLon <= GALE_CORRIDOR_BOUNDS.east + 0.25 &&
          from.lat >= GALE_CORRIDOR_BOUNDS.south - 0.25 &&
          from.lat <= GALE_CORRIDOR_BOUNDS.north + 0.25;
        cam.dist = 1 + 6 / R_KM;
        cam.tDist = inGaleRegion ? (reducedMotion() ? 1.015 : 1.012) : reducedMotion() ? HOME_DIST : 2.6;
        if (reducedMotion() && !inGaleRegion) cam.dist = HOME_DIST;
      }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    },
    hide() {
      active = false;
      crosshairEl.classList.remove("on");
      clearTimeout(descentTimerId);
      descentTimerId = 0;
      descent = null;
      tweenGroup.removeAll();
      descentEl.classList.remove("on", "flash", "whoosh");
      if (descentAltEl) descentAltEl.textContent = "";
      cancelAnimationFrame(raf);
      confirmEl.hidden = true;
    },
    onResize,
    flyTo,
    panBy,
    zoomBy,
    moveCrosshair,
    confirmCrosshair,
    isActive: () => active,
  };
}
