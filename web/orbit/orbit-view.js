/**
 * Orbit view (`web/orbit/orbit-view.js`): Mars as a globe seen from space.
 *
 * - Surface: NASA/USGS Viking MDIM 2.1 colour mosaic (or MGS MOLA colour-shaded relief), 4096×2048,
 *   bundled in web/assets/mars-globe/ so the view works offline / in demo-safe mode.
 * - Day/night: real subsolar point from the Mars24 algorithm for the current (or time-warped) date.
 * - Phobos & Deimos: real positions from a JPL Horizons-fitted series (MarsEphemeris.js). Moon *sizes*
 *   are exaggerated ×8 so they are visible; their orbits are to scale.
 * - Stars: real bright-star catalogue placed through the IAU Mars rotation; Sun and Earth directions are real.
 * - Click the surface to pick a landing site; "Land here" plays a stepped zoom-in, then hands off to the
 *   Bodycam through `onLand(lon, lat, { sunMode })`.
 *
 * Scene frame: unit = Mars mean radius. Body-fixed (X 0°E, Y 90°E, Z north) maps to three.js as
 * (x, y, z) = (X, Z, -Y), which is exactly how THREE.SphereGeometry lays out an equirectangular texture.
 */

import * as THREE from "three";
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
import {
  MARS_ORBITERS,
  MARS_SURFACE_HARDWARE,
  orbiterElements,
  orbiterPositionAtAnomaly,
  orbiterPositionKm,
} from "../shared/mars-hardware.js";

const DEG = Math.PI / 180;
const MOON_SIZE_EXAGGERATION = 8;
const MIN_DIST = 1.0022; // ≈ 7.5 km altitude
const MAX_DIST = 24;
const HOME_DIST = 3.4;
const R_KM = MARS_MEAN_RADIUS_KM;

const GLOBE_LAYERS = [
  { id: "viking", label: "Viking colour", url: "./assets/mars-globe/mars-viking-color-4k.jpg" },
  { id: "mola", label: "MOLA relief", url: "./assets/mars-globe/mars-mola-shade-4k.jpg" },
];

/** Body-fixed [X, Y, Z] -> three.js vector. */
function bfToVec3(v, out = new THREE.Vector3()) {
  return out.set(v[0], v[2], -v[1]);
}

function lonLatToVec3(lonDeg, latDeg, r = 1, out = new THREE.Vector3()) {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  return out.set(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
}

function vec3ToLonLat(v) {
  const r = v.length() || 1;
  return { lon: Math.atan2(-v.z, v.x) / DEG, lat: Math.asin(Math.max(-1, Math.min(1, v.y / r))) / DEG };
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
    // Close to the ground, add fine procedural grain so the 5 km texels don't read as flat blur
    // (decorative texture only, not mapped geology).
    if (uDetail > 0.001) {
      vec2 q = vUv * vec2(4096.0, 2048.0);
      float g = noise(q * 3.0) * 0.5 + noise(q * 11.0) * 0.3 + noise(q * 37.0) * 0.2;
      albedo *= mix(1.0, 0.78 + 0.44 * g, uDetail);
    }
    float ndl = dot(n, normalize(uSunDir));
    float day = smoothstep(-0.05, 0.08, ndl);
    float lambert = pow(max(ndl, 0.0), 0.8);
    vec3 lit = albedo * (0.05 + 1.1 * lambert);
    // warm band along the terminator (dusty twilight)
    float band = smoothstep(-0.09, 0.0, ndl) * (1.0 - smoothstep(0.0, 0.14, ndl));
    lit += vec3(0.42, 0.17, 0.06) * band * 0.22;
    vec3 night = albedo * 0.012 + vec3(0.002, 0.0025, 0.004);
    vec3 col = mix(night, lit, day);
    // thin dusty atmosphere on the sunlit limb
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

  // ---------- renderer ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); // capped for low-end GPUs
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  wrap.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.0005, 2000);

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
  let layerIdx = 0;
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
  // Decorative faint background field (seeded, not a catalogue) so the sky is not empty between real stars.
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
    // Orbit drawn in the inertial frame, rotated into the globe frame at the current instant (a closed ellipse).
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

  // ---------- labels ----------
  const labelEls = new Map();
  function label(id, html, cls = "") {
    let el = labelEls.get(id);
    if (!el) {
      el = document.createElement("div");
      el.className = `orbit-label ${cls}`;
      labelsEl.appendChild(el);
      labelEls.set(id, el);
    }
    if (el.dataset.html !== html) {
      el.innerHTML = html;
      el.dataset.html = html;
    }
    return el;
  }
  const sites = MARS_HISTORIC_ROVERS.map((r) => ({
    id: `rover-${r.id}`,
    lon: r.lon,
    lat: r.lat,
    html: `<span class="dot" style="background:${r.color}"></span>${r.name}${r.isHiRiseGaleSite ? " · HiRISE" : ""}`,
    rover: r,
  }));
  // The three landers (Viking 1, Phoenix, InSight) at their listed coordinates.
  for (const h of MARS_SURFACE_HARDWARE) {
    if (h.kind !== "lander") continue;
    sites.push({
      id: `hw-${h.id}`,
      lon: h.lon,
      lat: h.lat,
      html: `<span class="dot" style="background:#fbbf24"></span>${h.name}`,
      rover: { name: h.name, siteShortName: h.site.split("·")[0].trim().toUpperCase(), isHiRiseGaleSite: false },
      hardwareId: h.id,
    });
  }

  // ---------- orbiters ----------
  // Altitudes and inclinations are the nominal science orbits; the plane orientation and the
  // position along each track are illustrative (no live ephemeris), and the labels say so.
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
    // Near the surface, tilt the view from nadir toward the northern horizon (up to ~45°) for a sense of altitude.
    const alt = cam.dist - 1;
    const tilt = alt < 0.03 ? 1 - alt / 0.03 : 0;
    if (tilt > 0) {
      const aheadDeg = (alt * Math.tan(tilt * 45 * DEG)) / DEG;
      lonLatToVec3(cam.lon, cam.lat + aheadDeg * (cam.lat > 80 ? -1 : 1), 1, tmpV);
      camera.lookAt(tmpV);
    } else {
      camera.lookAt(0, 0, 0);
    }
    camera.near = Math.max(0.00005, alt * 0.25);
    camera.far = 2000;
    camera.updateProjectionMatrix();
  }

  const pointers = new Map();
  let dragMoved = 0;
  let pinchStart = null;
  let lastMove = 0;
  const canvas = renderer.domElement;
  canvas.addEventListener("pointerdown", (e) => {
    if (descent) return;
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
    // degrees per pixel: proportional to visible arc so the ground tracks the cursor at any zoom
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
    cam.tLon = cam.lon + wrap180(hit.lon - cam.lon);
    cam.tLat = hit.lat;
    cam.tDist = clampDist(1 + (cam.tDist - 1) * 0.45);
  });
  function clampDist(d) {
    return Math.max(MIN_DIST, Math.min(MAX_DIST, d));
  }

  // ---------- picking ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const unitSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  function pickSurface(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const p = raycaster.ray.intersectSphere(unitSphere, tmpV);
    return p ? vec3ToLonLat(p) : null;
  }
  function projectToScreen(v) {
    tmpV2.copy(v).project(camera);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    return { x: (tmpV2.x * 0.5 + 0.5) * w, y: (-tmpV2.y * 0.5 + 0.5) * h, front: tmpV2.z < 1 };
  }
  function surfaceVisible(v) {
    // A surface point is visible when it faces the camera.
    return tmpV2.copy(camera.position).sub(v).dot(v) > 0;
  }

  let pick = null; // { lon, lat, site }
  let simDate = new Date();
  function siteNear(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    let best = null;
    let bestD = 14;
    for (const s of sites) {
      const v = lonLatToVec3(s.lon, s.lat, 1, new THREE.Vector3());
      if (!surfaceVisible(v)) continue;
      const sp = projectToScreen(v);
      const d = Math.hypot(sp.x + rect.left - clientX, sp.y + rect.top - clientY);
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
    if (confirmGoBtn) confirmGoBtn.textContent = tr ? "Buraya in" : "Land here";
    if (confirmCancelBtn) confirmCancelBtn.textContent = tr ? "İptal" : "Cancel";
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
    });
  });
  homeBtn?.addEventListener("click", () => {
    const p = getPlayerLonLat?.();
    if (!p) return;
    cam.tLon = cam.lon + wrap180(p.lon - cam.lon);
    cam.tLat = p.lat;
    cam.tDist = Math.min(cam.tDist, 1.6);
  });

  // ---------- time ----------
  let warp = 1;
  let simBaseReal = Date.now();
  let simBase = Date.now();
  function setWarp(w) {
    simBase = simDate.getTime();
    simBaseReal = Date.now();
    warp = w;
    if (w === 1) simBase = Date.now(); // "Live" snaps back to now
    warpBtns.forEach((b) => b.classList.toggle("active", Number(b.dataset.warp) === w));
  }
  warpBtns.forEach((b) => b.addEventListener("click", () => setWarp(Number(b.dataset.warp) || 1)));

  // ---------- descent (stepped, GTA-style "switch" zoom) ----------
  let descent = null;
  const STEPS_KM = [2000, 400, 60, 8];
  function startDescent(lon, lat, landOpts) {
    if (reducedMotion()) {
      descentEl.classList.add("on", "flash");
      setTimeout(() => finishDescent(lon, lat, landOpts), 450);
      descent = { reduced: true };
      return;
    }
    descent = {
      lon,
      lat,
      landOpts,
      t0: performance.now(),
      from: { lon: cam.lon, lat: cam.lat, dist: cam.dist },
      stepIdx: -1,
    };
    cam.vLon = cam.vLat = 0;
    descentEl.classList.add("on");
    descentEl.classList.remove("flash", "whoosh");
  }
  function finishDescent(lon, lat, landOpts) {
    descent = null;
    onLand?.(lon, lat, landOpts);
    // Reset the overlay a moment later (the view is hidden by then).
    setTimeout(() => {
      descentEl.classList.remove("on", "flash", "whoosh");
      if (descentAltEl) descentAltEl.textContent = "";
    }, 120);
  }
  const easeInOut = (x) => {
    const c = Math.max(0, Math.min(1, x));
    return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
  };
  const easeExpo = (x) => {
    const c = Math.max(0, Math.min(1, x));
    return c === 1 ? 1 : 1 - Math.pow(2, -10 * c);
  };
  function updateDescent(now) {
    if (!descent || descent.reduced) return;
    const t = (now - descent.t0) / 1000;
    const ALIGN = 0.9;
    const STEP = 0.36;
    const HOLD = 0.34;
    const startDist = Math.max(descent.from.dist, 1 + STEPS_KM[0] / R_KM + 0.05);
    let shake = 0;
    if (t < ALIGN) {
      // swing over the target, pulling out a little first if we are already close
      const k = easeInOut(t / ALIGN);
      cam.lon = descent.from.lon + wrap180(descent.lon - descent.from.lon) * k;
      cam.lat = descent.from.lat + (descent.lat - descent.from.lat) * k;
      cam.dist = descent.from.dist + (startDist - descent.from.dist) * k;
      descentAltEl.textContent = `ALT ${Math.round((cam.dist - 1) * R_KM).toLocaleString()} km`;
    } else {
      const tt = t - ALIGN;
      const idx = Math.floor(tt / (STEP + HOLD));
      const local = tt - idx * (STEP + HOLD);
      cam.lon = descent.lon;
      cam.lat = descent.lat;
      if (idx >= STEPS_KM.length) {
        cam.dist = 1 + STEPS_KM[STEPS_KM.length - 1] / R_KM;
        if (!descentEl.classList.contains("flash")) {
          descentEl.classList.add("flash");
          const { lon, lat, landOpts } = descent;
          descent.done = true;
          setTimeout(() => finishDescent(lon, lat, landOpts), 320);
        }
        return;
      }
      const fromKm = idx === 0 ? (startDist - 1) * R_KM : STEPS_KM[idx - 1];
      const toKm = STEPS_KM[idx];
      if (local < STEP) {
        const k = easeExpo(local / STEP);
        // interpolate altitude in log space so each punch feels the same
        const km = Math.exp(Math.log(fromKm) + (Math.log(toKm) - Math.log(fromKm)) * k);
        cam.dist = 1 + km / R_KM;
        descentEl.classList.add("whoosh");
        shake = (1 - k) * 0.6;
      } else {
        cam.dist = 1 + toKm / R_KM;
        descentEl.classList.remove("whoosh");
        shake = Math.max(0, 0.25 - (local - STEP) * 1.2);
      }
      if (descentAltEl) descentAltEl.textContent = `ALT ${Math.round((cam.dist - 1) * R_KM).toLocaleString()} km`;
      if (descent.stepIdx !== idx) {
        descent.stepIdx = idx;
        if (idx === 2) loadDetailPatch(descent.lon, descent.lat);
      }
    }
    cam.tLon = cam.lon;
    cam.tLat = cam.lat;
    cam.tDist = cam.dist;
    descent.shake = shake;
  }

  // ---------- optional high-res patch for the last descent steps (network only) ----------
  let patchKey = null;
  function loadDetailPatch(lon, lat) {
    if (demoSafe) return; // demo-safe: bundled globe only, zero network
    const z = 7; // Viking MDIM 2.1 at ~330 m/px
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
      if (ok < n * n) return; // only use a complete patch
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      globeUniforms.uPatch.value?.dispose?.();
      globeUniforms.uPatch.value = tex;
      // uv: u = (lon+180)/360, v = 1 - (90-lat)/180 (row 0 at the top)
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
    simDate = new Date(simBase + (Date.now() - simBaseReal) * warp);

    updateDescent(now);
    if (!descent) {
      // inertia after a flick, then ease toward targets
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
    // decorative field rotates with the real sky (inertial -> body-fixed)
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
      m.mesh.lookAt(0, 0, 0); // tidally locked: long axis toward Mars
      if (now - m.ringStamp > (warp > 1 ? 120 : 2000)) {
        updateMoonRing(m, simDate);
        m.ringStamp = now;
      }
    }

    // orbiters (illustrative position along a real-altitude, real-inclination track)
    for (const o of orbiters) {
      const inertial = orbiterPositionKm(o, simDate.getTime() / 1000);
      bfToVec3(marsInertialToBodyFixed(inertial, simDate), o.marker.position).multiplyScalar(1 / R_KM);
      if (now - o.ringStamp > (warp > 1 ? 120 : 1500)) {
        updateOrbiterRing(o, simDate);
        o.ringStamp = now;
      }
    }

    renderer.render(scene, camera);
    updateLabels(sub);

    if (now - infoStamp > 250) {
      infoStamp = now;
      updateInfo(sub);
    }
    if (lastHover && now - hoverStamp > 60 && !descent) {
      hoverStamp = now;
      updateHover(sub);
    }
  }

  function updateLabels(sub) {
    const used = new Set();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const put = (id, v, html, cls, surface) => {
      if (surface ? !surfaceVisible(v) : occludedByGlobe(v)) return;
      const sp = projectToScreen(v);
      if (!sp.front || sp.x < -40 || sp.y < -20 || sp.x > w + 40 || sp.y > h + 20) return;
      const el = label(id, html, cls);
      el.style.transform = `translate(${(sp.x - 4).toFixed(1)}px, ${(sp.y - 6).toFixed(1)}px)`;
      el.style.display = "";
      used.add(id);
    };
    if (!descent || descent.stepIdx < 1) {
      for (const s of sites) put(s.id, lonLatToVec3(s.lon, s.lat), s.html, "", true);
      const p = getPlayerLonLat?.();
      if (p && Number.isFinite(p.lon)) {
        put("you", lonLatToVec3(p.lon, p.lat), `<span class="dot"></span>${isTr() ? "SEN" : "YOU"}`, "you", true);
      }
      for (const m of moons) {
        tmpV.copy(m.mesh.position);
        put(m.name, tmpV.clone(), `${m.label} <span style="opacity:.55">×${MOON_SIZE_EXAGGERATION} size</span>`, "moon", false);
      }
      for (const o of orbiters) {
        const alt = o.periKm === o.apoKm ? `${o.periKm} km` : `${o.periKm.toLocaleString()} × ${o.apoKm.toLocaleString()} km`;
        put(
          `orb-${o.id}`,
          o.marker.position.clone(),
          `<span class="dot" style="background:${o.color}"></span>${o.name} <span style="opacity:.55">${alt} · ${isTr() ? "temsili konum" : "illustrative position"}</span>`,
          "moon",
          false
        );
      }
      put("sun", sunSprite.position.clone().add(skyGroup.position), "Sun", "moon", false);
      put("earth", earthSprite.position.clone().add(skyGroup.position), "Earth", "moon", false);
      // subsolar marker
      put("subsolar", lonLatToVec3(sub.lonEastDeg, sub.latDeg), "☀ noon", "", true);
    }
    if (pick && !confirmEl.hidden) put("pick", lonLatToVec3(pick.lon, pick.lat), `<span class="dot"></span>`, "pick", true);
    for (const [id, el] of labelEls) if (!used.has(id)) el.style.display = "none";
  }

  function occludedByGlobe(v) {
    // segment camera -> v intersects the unit sphere before reaching v?
    const o = camera.position;
    const d = tmpV2.copy(v).sub(o);
    const len = d.length();
    d.divideScalar(len);
    const b = o.dot(d);
    const c = o.lengthSq() - 1;
    const disc = b * b - c;
    if (disc < 0) return false;
    const t = -b - Math.sqrt(disc);
    return t > 0 && t < len;
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
        ? `İRTİFA ${altKm} km · SÜRÜKLE: DÖNDÜR · TEKERLEK: YAKINLAŞ · YÜZEYE TIKLA: İNİŞ NOKTASI SEÇ`
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
  }
  window.addEventListener("resize", () => active && onResize());

  return {
    /** Show the view; with `from` the camera starts close over that point and eases out (Bodycam -> orbit). */
    show({ from = null } = {}) {
      active = true;
      onResize();
      descentEl.classList.remove("on", "flash", "whoosh");
      if (from && Number.isFinite(from.lon)) {
        cam.lon = cam.tLon = from.lon;
        cam.lat = cam.tLat = Math.max(-89, Math.min(89, from.lat));
        cam.dist = 1 + 6 / R_KM;
        cam.tDist = reducedMotion() ? HOME_DIST : 2.6;
        if (reducedMotion()) cam.dist = HOME_DIST;
      }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    },
    hide() {
      active = false;
      cancelAnimationFrame(raf);
      confirmEl.hidden = true;
    },
    onResize,
    flyTo(lon, lat, dist = 1.6) {
      cam.tLon = cam.lon + wrap180(lon - cam.lon);
      cam.tLat = lat;
      cam.tDist = clampDist(dist);
    },
    isActive: () => active,
  };
}
