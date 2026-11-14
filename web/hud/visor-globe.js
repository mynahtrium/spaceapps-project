/**
 * Whole-Mars globe for the visor map (`web/hud/visor-globe.js`).
 *
 * A real sphere, not a picture: the surface is pushed out by NASA MGS MOLA elevation
 * (2880 x 1440, 8 px/deg, radius x9 so relief reads at planet scale), shaded per pixel with
 * normals from the same MOLA grid, and lit by the Sun where it really is for the walk's
 * local time at Gale (subsolar point from the Mars season), so the day/night terminator is real.
 * Albedo is the Viking MDIM 2.1 colour mosaic, or a black-and-white version of it ("Untitled"
 * look, the default), or the MOLA colour shaded relief. Craters, volcanoes and landing sites are
 * labelled. Everything loads the first time the map opens, so it costs nothing at start-up.
 *
 * Coordinates: planetocentric degrees, east-positive longitude. Object space +Y = north pole,
 * +X = 0 deg E, -Z = 90 deg E (the same convention as the demo-1 globe).
 */

import * as THREE from "three";
import { galeSunState } from "./MarsEphemeris.js";

const R_MARS_M = 3389500;
const EXAG = 9; // radial relief exaggeration (Olympus Mons +21 km becomes +5.6 % of the radius)
const NORMAL_K = 7; // slope exaggeration for shading, so 2-3 km deep craters read from orbit
const DEG = Math.PI / 180;
const DEM_OFFSET_M = 12000; // DEM PNG: R = (elev + 12000) >> 8, G = (elev + 12000) & 255
const SEG_LON = 360;
const SEG_LAT = 180;
const ZOOM_MIN = 1;
const ZOOM_MAX = 6;

/**
 * Named features. Crater centres and diameters are approximate IAU Gazetteer values (to about
 * 1 deg); landing sites are the published touchdown points. `tier` decides from which zoom a
 * label shows (1 always, 2 from 1.8x, 3 from 3x).
 */
export const GLOBE_FEATURES = [
  // the walk
  { id: "gale", name: "Gale crater", kind: "crater", lon: 137.8, lat: -5.4, dKm: 154, tier: 1, hideLabel: true },
  // big basins and craters
  { id: "hellas", name: "Hellas Planitia", kind: "basin", lon: 70.5, lat: -42.4, dKm: 2300, tier: 1 },
  { id: "argyre", name: "Argyre Planitia", kind: "basin", lon: -43.0, lat: -49.7, dKm: 1800, tier: 1 },
  { id: "isidis", name: "Isidis Planitia", kind: "basin", lon: 87.0, lat: 12.9, dKm: 1350, tier: 1 },
  { id: "huygens", name: "Huygens", kind: "crater", lon: 55.6, lat: -14.0, dKm: 467, tier: 2 },
  { id: "schiaparelli", name: "Schiaparelli", kind: "crater", lon: 16.8, lat: -2.7, dKm: 459, tier: 2 },
  { id: "cassini", name: "Cassini", kind: "crater", lon: 32.1, lat: 23.4, dKm: 415, tier: 2 },
  { id: "antoniadi", name: "Antoniadi", kind: "crater", lon: 60.8, lat: 21.5, dKm: 394, tier: 2 },
  { id: "herschel", name: "Herschel", kind: "crater", lon: 130.1, lat: -14.5, dKm: 304, tier: 2 },
  { id: "newton", name: "Newton", kind: "crater", lon: -158.1, lat: -40.8, dKm: 298, tier: 2 },
  { id: "copernicus", name: "Copernicus", kind: "crater", lon: -169.2, lat: -49.2, dKm: 294, tier: 2 },
  { id: "lyot", name: "Lyot", kind: "crater", lon: 29.3, lat: 50.5, dKm: 236, tier: 2 },
  { id: "gusev", name: "Gusev", kind: "crater", lon: 175.4, lat: -14.5, dKm: 166, tier: 2 },
  { id: "hale", name: "Hale", kind: "crater", lon: -36.4, lat: -35.7, dKm: 150, tier: 3 },
  { id: "holden", name: "Holden", kind: "crater", lon: -34.0, lat: -26.4, dKm: 140, tier: 3 },
  { id: "korolev", name: "Korolev", kind: "crater", lon: 164.5, lat: 73.0, dKm: 81, tier: 3 },
  { id: "eberswalde", name: "Eberswalde", kind: "crater", lon: -33.0, lat: -24.0, dKm: 65, tier: 3 },
  { id: "jezero", name: "Jezero", kind: "crater", lon: 77.5, lat: 18.4, dKm: 49, tier: 2 },
  { id: "endeavour", name: "Endeavour", kind: "crater", lon: -5.2, lat: -2.3, dKm: 22, tier: 3 },
  // volcanoes, canyons, plains, poles
  { id: "olympus", name: "Olympus Mons", kind: "mons", lon: -133.8, lat: 18.65, dKm: 600, tier: 1 },
  { id: "ascraeus", name: "Ascraeus Mons", kind: "mons", lon: -104.1, lat: 11.9, dKm: 460, tier: 2 },
  { id: "pavonis", name: "Pavonis Mons", kind: "mons", lon: -113.0, lat: 1.5, dKm: 375, tier: 2 },
  { id: "arsia", name: "Arsia Mons", kind: "mons", lon: -120.1, lat: -8.3, dKm: 435, tier: 2 },
  { id: "elysium", name: "Elysium Mons", kind: "mons", lon: 147.2, lat: 25.0, dKm: 400, tier: 2 },
  { id: "valles", name: "Valles Marineris", kind: "region", lon: -69.0, lat: -13.9, dKm: 4000, tier: 1 },
  { id: "syrtis", name: "Syrtis Major", kind: "region", lon: 68.0, lat: 8.4, dKm: 1300, tier: 2 },
  { id: "utopia", name: "Utopia Planitia", kind: "region", lon: 117.5, lat: 46.7, dKm: 3300, tier: 1 },
  { id: "acidalia", name: "Acidalia Planitia", kind: "region", lon: -21.0, lat: 49.8, dKm: 2300, tier: 2 },
  { id: "boreum", name: "Planum Boreum", kind: "region", lon: 0, lat: 87, dKm: 1000, tier: 1 },
  { id: "australe", name: "Planum Australe", kind: "region", lon: 160, lat: -84, dKm: 1000, tier: 1 },
  // landing sites
  { id: "viking1", name: "Viking 1", kind: "site", lon: -49.97, lat: 22.48, tier: 3 },
  { id: "viking2", name: "Viking 2", kind: "site", lon: 134.29, lat: 47.64, tier: 3 },
  { id: "pathfinder", name: "Pathfinder", kind: "site", lon: -33.55, lat: 19.13, tier: 3 },
  { id: "spirit", name: "Spirit", kind: "site", lon: 175.47, lat: -14.57, tier: 3 },
  { id: "opportunity", name: "Opportunity", kind: "site", lon: -5.53, lat: -1.95, tier: 3 },
  { id: "phoenix", name: "Phoenix", kind: "site", lon: -125.75, lat: 68.22, tier: 3 },
  { id: "curiosity", name: "Curiosity", kind: "site", lon: 137.44, lat: -4.59, tier: 3 },
  { id: "insight", name: "InSight", kind: "site", lon: 135.62, lat: 4.5, tier: 3 },
  { id: "perseverance", name: "Perseverance", kind: "site", lon: 77.45, lat: 18.44, tier: 3 },
  { id: "zhurong", name: "Zhurong", kind: "site", lon: 109.93, lat: 25.07, tier: 3 },
];

export function lonLatToDir(lonDeg, latDeg, out = new THREE.Vector3()) {
  const phi = latDeg * DEG;
  const lam = lonDeg * DEG;
  return out.set(Math.cos(phi) * Math.cos(lam), Math.sin(phi), -Math.cos(phi) * Math.sin(lam));
}

export function dirToLonLat(v) {
  const len = v.length() || 1;
  const lat = Math.asin(Math.max(-1, Math.min(1, v.y / len))) / DEG;
  let lon = Math.atan2(-v.z, v.x) / DEG;
  if (lon > 180) lon -= 360;
  if (lon <= -180) lon += 360;
  return { lon, lat };
}

/** Great-circle distance in km on the mean sphere. */
export function marsSurfaceKm(lon1, lat1, lon2, lat2) {
  const a = lonLatToDir(lon1, lat1);
  const b = lonLatToDir(lon2, lat2);
  return (Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) * R_MARS_M) / 1000;
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vDir;
  void main() {
    vUv = uv;
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uAlbedo;
  uniform sampler2D uNormal;
  uniform vec3 uSun;
  uniform vec3 uView;
  uniform float uMono;
  uniform float uSunMix;
  varying vec2 vUv;
  varying vec3 vDir;
  void main() {
    vec3 alb = texture2D(uAlbedo, vUv).rgb;
    vec3 n = normalize(texture2D(uNormal, vUv).xyz * 2.0 - 1.0);
    float lum = dot(alb, vec3(0.299, 0.587, 0.114));
    vec3 mono = vec3(clamp((lum - 0.5) * 1.35 + 0.55, 0.0, 1.0));
    alb = mix(alb, mono, uMono);
    // sunlit side: relief from the MOLA normals, cut by the real terminator on the smooth sphere
    float day = smoothstep(-0.1, 0.12, dot(vDir, uSun));
    float sunL = max(dot(n, uSun), 0.0) * 1.3 * day + 0.03;
    // "visor lamp": light from the viewer, so the night side can still be read
    float lamp = 0.18 + 0.95 * max(dot(n, normalize(uView + 0.35 * vec3(0.3, 0.6, 0.0))), 0.0);
    float light = mix(lamp, sunL, uSunMix);
    vec3 col = alb * light;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const HAZE_FRAG = /* glsl */ `
  uniform vec3 uSun;
  uniform float uSunMix;
  uniform float uMono;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vDir;
  void main() {
    float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6);
    float lit = mix(1.0, smoothstep(-0.25, 0.3, dot(vDir, uSun)), uSunMix);
    vec3 tint = mix(vec3(0.95, 0.62, 0.42), vec3(0.85), uMono);
    gl_FragColor = vec4(tint * rim * lit * 0.55, rim * lit * 0.55);
  }
`;

const HAZE_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = cameraPosition - wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

async function loadBitmap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const blob = await res.blob();
  return createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function bitmapPixels(bmp) {
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height).data;
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.host        element the globe canvas fills (position: relative)
 * @param {string} opts.dataBase         URL of the folder with mars-mola-dem.png etc.
 * @param {{lon:number, lat:number}} [opts.walkSite]  where the HiRISE walk is (marked as YOU by default)
 * @param {(hit: object) => void} [opts.onPick]   click / A on the surface
 * @param {(hit: object|null) => void} [opts.onHover]
 */
export function createVisorGlobe({ host, dataBase, walkSite = { lon: 137.39, lat: -4.8 }, onPick, onHover }) {
  const state = {
    cLon: walkSite.lon,
    cLat: walkSite.lat + 8,
    zoom: 1,
    layer: "mono", // "mono" | "viking" | "mola"
    sunMix: 1, // 1 = real Sun, 0 = visor lamp (see the night side)
    player: { ...walkSite },
    target: null,
    open: false,
  };

  // ---------- DOM ----------
  const canvas = document.createElement("canvas");
  canvas.className = "globe-canvas";
  const labels = document.createElement("div");
  labels.className = "globe-labels";
  const status = document.createElement("div");
  status.className = "globe-status";
  status.textContent = "LOADING MOLA ELEVATION · VIKING MOSAIC";
  host.append(canvas, labels, status);

  const featureEls = GLOBE_FEATURES.map((f) => {
    const el = document.createElement("div");
    el.className = `globe-label globe-${f.kind}`;
    el.innerHTML = `<i></i><span>${f.name}</span>`;
    labels.appendChild(el);
    return { f, el, pos: new THREE.Vector3() };
  });
  const youEl = document.createElement("div");
  youEl.className = "globe-you";
  youEl.innerHTML = "<i></i><span>YOU · GALE CRATER</span>";
  labels.appendChild(youEl);
  const targetEl = document.createElement("div");
  targetEl.className = "globe-target";
  targetEl.innerHTML = "<i></i>";
  labels.appendChild(targetEl);

  // ---------- three.js ----------
  let renderer = null;
  let scene = null;
  let camera = null;
  let globeMat = null;
  let hazeMat = null;
  let dem = null; // { e: Float32Array, w, h }
  let textures = {};
  let raf = 0;
  let ready = null;

  function demAt(lon, lat) {
    if (!dem) return 0;
    const { e, w, h } = dem;
    let fx = ((lon + 180) / 360) * w - 0.5;
    const fy = Math.max(0, Math.min(h - 1.001, ((90 - lat) / 180) * h - 0.5));
    fx = ((fx % w) + w) % w;
    const x0 = Math.floor(fx);
    const x1 = (x0 + 1) % w;
    const y0 = Math.floor(fy);
    const y1 = Math.min(h - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const a = e[y0 * w + x0] + (e[y0 * w + x1] - e[y0 * w + x0]) * tx;
    const b = e[y1 * w + x0] + (e[y1 * w + x1] - e[y1 * w + x0]) * tx;
    return a + (b - a) * ty;
  }
  const radiusAt = (lon, lat) => 1 + (demAt(lon, lat) / R_MARS_M) * EXAG;

  function surfacePoint(lon, lat, out = new THREE.Vector3()) {
    return lonLatToDir(lon, lat, out).multiplyScalar(radiusAt(lon, lat));
  }

  function buildNormalMap() {
    // object-space normals of the (exaggerated) MOLA surface, 2048 x 1024, row 0 = north
    const nw = 2048;
    const nh = 1024;
    const data = new Uint8Array(nw * nh * 4);
    const dLon = 360 / nw;
    const dLat = 180 / nh;
    const mPerDegLat = (R_MARS_M * Math.PI) / 180;
    const up = new THREE.Vector3();
    for (let r = 0; r < nh; r++) {
      const lat = 90 - (r + 0.5) * dLat;
      const phi = lat * DEG;
      const cosP = Math.max(0.05, Math.cos(phi));
      const sinP = Math.sin(phi);
      for (let c = 0; c < nw; c++) {
        const lon = -180 + (c + 0.5) * dLon;
        const lam = lon * DEG;
        const gE = (demAt(lon + dLon, lat) - demAt(lon - dLon, lat)) / (2 * dLon * mPerDegLat * cosP);
        const gN = (demAt(lon, lat + dLat) - demAt(lon, lat - dLat)) / (2 * dLat * mPerDegLat);
        const cl = Math.cos(lam);
        const sl = Math.sin(lam);
        // up, east and north unit vectors at (lon, lat) in object space
        up.set(cosP * cl, sinP, -cosP * sl);
        const ex = -sl;
        const ez = -cl;
        const nx = -sinP * cl;
        const ny = cosP;
        const nz = sinP * sl;
        let x = up.x - NORMAL_K * (gE * ex + gN * nx);
        let y = up.y - NORMAL_K * gN * ny;
        let z = up.z - NORMAL_K * (gE * ez + gN * nz);
        const l = Math.hypot(x, y, z) || 1;
        x /= l;
        y /= l;
        z /= l;
        const o = (r * nw + c) * 4;
        data[o] = (x * 0.5 + 0.5) * 255;
        data[o + 1] = (y * 0.5 + 0.5) * 255;
        data[o + 2] = (z * 0.5 + 0.5) * 255;
        data[o + 3] = 255;
      }
    }
    const t = new THREE.DataTexture(data, nw, nh, THREE.RGBAFormat);
    t.flipY = false;
    t.wrapS = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  }

  function buildGlobeGeometry() {
    const cols = SEG_LON + 1;
    const rows = SEG_LAT + 1;
    const pos = new Float32Array(cols * rows * 3);
    const uv = new Float32Array(cols * rows * 2);
    const v = new THREE.Vector3();
    for (let r = 0; r < rows; r++) {
      const lat = 90 - (r / SEG_LAT) * 180;
      for (let c = 0; c < cols; c++) {
        const lon = -180 + (c / SEG_LON) * 360;
        surfacePoint(lon, lat, v);
        const i = r * cols + c;
        pos[i * 3] = v.x;
        pos[i * 3 + 1] = v.y;
        pos[i * 3 + 2] = v.z;
        uv[i * 2] = c / SEG_LON;
        uv[i * 2 + 1] = r / SEG_LAT;
      }
    }
    const idx = [];
    for (let r = 0; r < SEG_LAT; r++) {
      for (let c = 0; c < SEG_LON; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const d = a + cols;
        const e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  function buildGraticule() {
    const pts = [];
    const strong = [];
    const push = (arr, a, b) => arr.push(a.x, a.y, a.z, b.x, b.y, b.z);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const r = 1.0015;
    for (let lat = -60; lat <= 60; lat += 30) {
      for (let lon = -180; lon < 180; lon += 2) {
        lonLatToDir(lon, lat, a).multiplyScalar(r);
        lonLatToDir(lon + 2, lat, b).multiplyScalar(r);
        push(lat === 0 ? strong : pts, a, b);
      }
    }
    for (let lon = -180; lon < 180; lon += 30) {
      for (let lat = -88; lat < 88; lat += 2) {
        lonLatToDir(lon, lat, a).multiplyScalar(r);
        lonLatToDir(lon, lat + 2, b).multiplyScalar(r);
        push(lon === 0 ? strong : pts, a, b);
      }
    }
    const mk = (arr, opacity) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      return new THREE.LineSegments(
        g,
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false })
      );
    };
    const grp = new THREE.Group();
    grp.add(mk(pts, 0.09), mk(strong, 0.22));
    return grp;
  }

  function buildStars() {
    const n = 1400;
    const p = new Float32Array(n * 3);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1;
      const t = rnd() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      p[i * 3] = s * Math.cos(t) * 60;
      p[i * 3 + 1] = u * 60;
      p[i * 3 + 2] = s * Math.sin(t) * 60;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    return new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: 0xffffff, size: 1.1, sizeAttenuation: false, transparent: true, opacity: 0.55 })
    );
  }

  function sunDirection() {
    // the walk's clock is fixed at 15:00 local true solar time at Gale, so the subsolar point
    // is 45 deg of longitude west of Gale, at the Sun's declination for today's Mars season
    const s = galeSunState(new Date(), 15);
    const subLon = walkSite.lon - 15 * (s.ltstHours - 12);
    return lonLatToDir(subLon, s.declinationRad / DEG);
  }

  async function load() {
    const [demBmp, vikBmp, molaBmp] = await Promise.all([
      loadBitmap(`${dataBase}mars-mola-dem.png`),
      loadBitmap(`${dataBase}mars-viking-global.jpg`),
      loadBitmap(`${dataBase}mars-mola-shaded.jpg`).catch(() => null),
    ]);
    const px = bitmapPixels(demBmp);
    const e = new Float32Array(demBmp.width * demBmp.height);
    for (let i = 0; i < e.length; i++) e[i] = ((px[i * 4] << 8) | px[i * 4 + 1]) - DEM_OFFSET_M;
    dem = { e, w: demBmp.width, h: demBmp.height };

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // shader works on the images' own values
    renderer.setClearColor(0x000000, 1);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 1, 0.01, 200);

    const tex = (bmp) => {
      if (!bmp) return null;
      const t = new THREE.Texture(bmp);
      t.flipY = false;
      t.wrapS = THREE.RepeatWrapping;
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      t.colorSpace = THREE.NoColorSpace;
      t.needsUpdate = true;
      return t;
    };
    textures = { viking: tex(vikBmp), mola: tex(molaBmp) || tex(vikBmp) };
    const normalTex = buildNormalMap();

    globeMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uAlbedo: { value: textures.viking },
        uNormal: { value: normalTex },
        uSun: { value: sunDirection() },
        uView: { value: new THREE.Vector3(0, 0, 1) },
        uMono: { value: 1 },
        uSunMix: { value: 1 },
      },
    });
    scene.add(new THREE.Mesh(buildGlobeGeometry(), globeMat));
    hazeMat = new THREE.ShaderMaterial({
      vertexShader: HAZE_VERT,
      fragmentShader: HAZE_FRAG,
      uniforms: { uSun: globeMat.uniforms.uSun, uSunMix: globeMat.uniforms.uSunMix, uMono: globeMat.uniforms.uMono },
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.035, 96, 48), hazeMat));
    scene.add(buildGraticule(), buildStars());
    for (const fe of featureEls) surfacePoint(fe.f.lon, fe.f.lat, fe.pos);
    status.textContent = "";
    applyLayer();
  }

  function applyLayer() {
    if (!globeMat) return;
    globeMat.uniforms.uAlbedo.value = state.layer === "mola" ? textures.mola : textures.viking;
    globeMat.uniforms.uMono.value = state.layer === "mono" ? 1 : 0;
    globeMat.uniforms.uSunMix.value = state.sunMix;
  }

  function camDistance() {
    return 1 + 3.3 / state.zoom;
  }

  function syncCamera() {
    const d = camDistance();
    lonLatToDir(state.cLon, state.cLat, camera.position).multiplyScalar(d);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    globeMat.uniforms.uView.value.copy(camera.position).normalize();
  }

  function resize() {
    const w = Math.max(64, host.clientWidth);
    const h = Math.max(64, host.clientHeight);
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || camera.aspect !== w / h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    return { w, h };
  }

  const _p = new THREE.Vector3();
  const _toCam = new THREE.Vector3();
  function placeLabel(el, world, w, h, show) {
    if (!show) {
      el.style.display = "none";
      return;
    }
    _toCam.copy(camera.position).sub(world);
    const facing = _toCam.normalize().dot(_p.copy(world).normalize());
    if (facing < 0.08) {
      el.style.display = "none";
      return;
    }
    _p.copy(world).project(camera);
    el.style.display = "";
    el.style.transform = `translate(${((_p.x + 1) / 2) * w}px, ${((1 - _p.y) / 2) * h}px)`;
    el.style.opacity = String(Math.min(1, (facing - 0.08) * 5));
  }

  const _w = new THREE.Vector3();
  function frame(now) {
    raf = state.open ? requestAnimationFrame(frame) : 0;
    if (!renderer) return;
    const { w, h } = resize();
    syncCamera();
    renderer.render(scene, camera);
    for (const fe of featureEls) placeLabel(fe.el, fe.pos, w, h, !fe.f.hideLabel && (fe.f.tier === 1 || state.zoom >= (fe.f.tier === 2 ? 1.8 : 3)));
    placeLabel(youEl, surfacePoint(state.player.lon, state.player.lat, _w), w, h, true);
    youEl.classList.toggle("pulse", Math.floor(now / 600) % 2 === 0);
    if (state.target) placeLabel(targetEl, surfacePoint(state.target.lon, state.target.lat, _w), w, h, true);
    else targetEl.style.display = "none";
  }

  // ---------- picking ----------
  const ray = new THREE.Raycaster();
  /** Surface point under a normalised screen position (0..1, 0..1), or null off the planet. */
  function pickNormalized(u, v) {
    if (!camera || !dem) return null;
    syncCamera();
    ray.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), camera);
    // ray / sphere at the mean radius, then once more at the local surface radius
    let r = 1;
    let hit = null;
    for (let k = 0; k < 3; k++) {
      const o = ray.ray.origin;
      const d = ray.ray.direction;
      const b = o.dot(d);
      const c = o.lengthSq() - r * r;
      const disc = b * b - c;
      if (disc < 0) return hit;
      const t = -b - Math.sqrt(disc);
      const p = o.clone().addScaledVector(d, t);
      hit = dirToLonLat(p);
      r = radiusAt(hit.lon, hit.lat);
    }
    return describe(hit.lon, hit.lat);
  }

  function describe(lon, lat) {
    const elevM = demAt(lon, lat);
    let nearest = null;
    let best = Infinity;
    for (const f of GLOBE_FEATURES) {
      const km = marsSurfaceKm(lon, lat, f.lon, f.lat);
      const reach = f.dKm ? f.dKm / 2 : 30;
      if (km < reach && km < best) {
        best = km;
        nearest = f;
      }
    }
    const walkKm = marsSurfaceKm(lon, lat, state.player.lon, state.player.lat);
    return { lon, lat, elevM, feature: nearest, walkKm };
  }

  // ---------- input ----------
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, lon: state.cLon, lat: state.cLat, moved: 0 };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    if (drag) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
      const k = 0.32 / state.zoom;
      state.cLon = wrapLon(drag.lon - dx * k / Math.max(0.3, Math.cos(state.cLat * DEG)));
      state.cLat = Math.max(-85, Math.min(85, drag.lat + dy * k));
    } else {
      onHover?.(pickNormalized((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height));
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    const rect = canvas.getBoundingClientRect();
    if (drag && drag.moved < 5) {
      const hit = pickNormalized((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
      if (hit) {
        state.target = hit;
        onPick?.(hit);
      }
    }
    drag = null;
  });
  canvas.addEventListener("pointerleave", () => onHover?.(null));
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      // zoom toward the point under the cursor
      const rect = canvas.getBoundingClientRect();
      const hit = pickNormalized((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
      const before = state.zoom;
      zoomBy(Math.exp(-e.deltaY * 0.0015));
      const f = state.zoom / before;
      if (hit && f > 1) {
        const k = 1 - 1 / f;
        let dLon = hit.lon - state.cLon;
        if (dLon > 180) dLon -= 360;
        if (dLon < -180) dLon += 360;
        state.cLon = wrapLon(state.cLon + dLon * k);
        state.cLat = Math.max(-85, Math.min(85, state.cLat + (hit.lat - state.cLat) * k));
      }
    },
    { passive: false }
  );

  function wrapLon(l) {
    return ((((l + 180) % 360) + 360) % 360) - 180;
  }

  function zoomBy(f) {
    state.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, state.zoom * f));
  }

  return {
    /** Start loading (once) and rendering. */
    open() {
      state.open = true;
      ready = ready || load().catch((err) => {
        status.textContent = `GLOBE DATA FAILED TO LOAD · ${err.message || err}`;
        throw err;
      });
      if (!raf) raf = requestAnimationFrame(frame);
      return ready;
    },
    close() {
      state.open = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    get ready() {
      return Boolean(renderer);
    },
    get zoom() {
      return state.zoom;
    },
    get layer() {
      return state.layer;
    },
    get sunLit() {
      return state.sunMix > 0.5;
    },
    setLayer(layer) {
      state.layer = layer;
      applyLayer();
    },
    cycleLayer() {
      const order = ["mono", "viking", "mola"];
      state.layer = order[(order.indexOf(state.layer) + 1) % order.length];
      applyLayer();
      return state.layer;
    },
    toggleSun() {
      state.sunMix = state.sunMix > 0.5 ? 0 : 1;
      applyLayer();
      return state.sunMix > 0.5;
    },
    setPlayer(lon, lat) {
      state.player = { lon, lat };
    },
    setTarget(hit) {
      state.target = hit;
    },
    focus(lon, lat, zoom) {
      state.cLon = lon;
      state.cLat = Math.max(-85, Math.min(85, lat));
      if (zoom) state.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
    },
    /** Spin by degrees of view (controller right stick). */
    spin(dLon, dLat) {
      state.cLon = wrapLon(state.cLon + dLon / Math.max(0.3, Math.cos(state.cLat * DEG)));
      state.cLat = Math.max(-85, Math.min(85, state.cLat + dLat));
    },
    zoomBy,
    pickNormalized,
    describe,
    elevationAt: demAt,
  };
}
