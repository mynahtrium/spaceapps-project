/**
 * 3D route rehearsal (`web/eva/eva-view.js`): walk a planned EVA on measured terrain.
 *
 * What is real here, and where it comes from:
 *   - Ground: HiRISE DTM DTEEC_009149 (1 m) in the Gale corridor; MGS MOLA beyond it (see terrain.js).
 *   - Sun, Phobos, Deimos, stars: Mars24 / JPL mean elements / Yale BSC for the mission date at the site.
 *   - Gravity: latitude and elevation dependent Mars gravity (physics/MarsGravityField.js).
 *   - Slope tiers: NASA lunar EVA ConOps limits, used as stand-ins (not Mars limits).
 *   - Dose: Curiosity RAD surface baseline (Hassler et al. 2014) x elapsed time.
 *   - Weather line: latest Curiosity REMS sol from the NASA/CAB feed, labelled with its sol.
 * What is a model or rendering choice (labelled in the HUD and Sources): the sky colour gradient,
 * fixed dust optical depth, walking speeds (physics/SuitBiomechanics.js), and the HiRISE colour tint.
 */

import * as THREE from "three";
import { sunStateAt, moonFromSurface, formatHoursHM } from "../hud/MarsEphemeris.js";
import { createCelestialSky } from "../hud/MarsCelestialSky.js";
import { createAtmosphericHazeUniforms, updateAtmosphericHazeUniforms } from "../hud/MarsAtmosphereHaze.js";
import { createMarsPostPipeline, effectivePixelRatio } from "../hud/post-pipeline.js";
import { createMarsBody, stepPhysicsWorld } from "../physics/MarsPhysicsWorld.js";
import { createVehicleBody, placeVehicle, stepVehicle, vehiclePose } from "../physics/VehicleDynamics.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import {
  buildCumulativeDistances,
  classifySlope,
  marsBearingDeg,
  marsDistanceM,
} from "../shared/route-bridge.js";
import { loadDevSettings, subscribeDevSettings } from "../shared/dev-settings.js";
import { resolveGraphics } from "../shared/graphics-profile.js";
import { GaleCorridor } from "../map/GaleCorridor.js";
import { loadMolaGlobe, sampleMolaM } from "../map/RealSiteTerrain.js";
import { createRealTerrain } from "./terrain.js";
import { DEFAULT_DUST_TAU, SKY_GROUND, SKY_HORIZON, SKY_ZENITH, createMoons, createSkyDome } from "./sky.js";

const EYE_HEIGHT_M = 1.64; // eye level of a 1.80 m astronaut
const SEV_LENGTH_M = 14.7 * 0.3048; // NASA SEV fact sheet FS-2011-08-045-JSC: length 14.7 ft
const SEV_ENTER_M = 8; // walk within this distance of the rover to get in
const RAD_BASELINE_MSV_PER_DAY = 0.64; // Hassler et al. 2014 (Science 343, 1244797)
const DEG = Math.PI / 180;

const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const fmtLat = (lat) => `${fmt(Math.abs(lat), 4)}°${lat < 0 ? "S" : "N"}`;
const fmtLon = (lon) => `${fmt(((lon % 360) + 360) % 360, 4)}°E`;
const fmtDist = (m) => (m >= 1000 ? `${fmt(m / 1000, 2)} km` : `${fmt(m, 0)} m`);
const CARD = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const cardinal = (deg) => CARD[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

const SOURCE_LABEL = {
  "hirise-1m": "HiRISE DTM 1 m",
  "hirise-8m": "HiRISE DTM 8 m overview (1 m loading)",
  mola: "MGS MOLA ~7.4 km",
  none: "no elevation data",
};

function hudTemplate() {
  return `
  <div class="eva-hud" aria-live="off">
    <div class="eva-panel eva-tl">
      <div class="eva-title">ROUTE REHEARSAL · <span data-k="site">GALE CRATER</span></div>
      <div data-k="pos">—</div>
      <div data-k="elev">—</div>
      <div class="dim" data-k="src">—</div>
      <div data-k="time">—</div>
      <div class="dim" data-k="sun">—</div>
    </div>
    <div class="eva-compass"><span data-k="hdg">000° N</span> · <span data-k="pitch">+0°</span></div>
    <div class="eva-panel eva-tr">
      <div><span class="lbl">SLOPE</span> <b data-k="slope">—</b> <span class="tier" data-k="tier">—</span></div>
      <div class="dim">tiers are NASA lunar EVA limits used as stand-ins</div>
      <div><span class="lbl">ROUTE</span> <b data-k="along">—</b> / <span data-k="total">—</span></div>
      <div><span class="lbl">OFF ROUTE</span> <span data-k="off">—</span></div>
      <div><span class="lbl">NEXT</span> <b data-k="next">—</b></div>
      <div class="dim" data-k="nextd">—</div>
    </div>
    <div class="eva-panel eva-bl">
      <div><span class="lbl">EVA CLOCK</span> <b data-k="clock">00:00:00</b></div>
      <div><span class="lbl">DOSE</span> <b data-k="dose">—</b> <span class="dim">RAD baseline × time (Hassler 2014)</span></div>
      <div data-k="drive" hidden></div>
      <div class="dim" data-k="donki">—</div>
      <div class="dim" data-k="wx">—</div>
    </div>
    <div class="eva-hint" data-k="hint">Click to look around · WASD walk · Shift faster · Space jump · E get in / out of the SEV · Esc release mouse</div>
    <div class="eva-reticle">+</div>
    <div class="eva-labels" data-k="labels"></div>
    <div class="eva-loading" data-k="loading">Loading HiRISE terrain…</div>
  </div>`;
}

/**
 * @param {HTMLElement} root container element (the view section)
 * @param {object} data   output of loadAllProjectData()
 * @returns api { show, hide, setMission, getLonLat, onResize, dispose }
 */
export async function initEvaView(root, data, { onStatus = null } = {}) {
  root.insertAdjacentHTML("beforeend", hudTemplate());
  const hud = root.querySelector(".eva-hud");
  const el = Object.fromEntries([...hud.querySelectorAll("[data-k]")].map((n) => [n.dataset.k, n]));
  const setLoading = (t) => {
    el.loading.textContent = t || "";
    el.loading.hidden = !t;
  };

  setLoading("Loading HiRISE DTM DTEEC_009149…");
  const corridor = await GaleCorridor.load(data.assets.corridorBaseUrl);
  if (!corridor) {
    setLoading("HiRISE corridor data could not be loaded. The 3D view needs data/demo/corridor/.");
    throw new Error("corridor data missing");
  }
  setLoading("Loading MGS MOLA global topography…");
  await loadMolaGlobe();

  let devCfg = loadDevSettings();
  const hwHint = { cores: navigator.hardwareConcurrency, memoryGb: navigator.deviceMemory };
  let gfx = resolveGraphics(devCfg, hwHint);

  // ---------- renderer ----------
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(effectivePixelRatio(window.devicePixelRatio, gfx.pixelRatioCap, gfx.renderScale));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = gfx.shadowPx > 0;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  root.prepend(renderer.domElement);
  renderer.domElement.classList.add("eva-canvas");

  const scene = new THREE.Scene();
  const HORIZON = new THREE.Color(...SKY_HORIZON);
  const ZENITH = new THREE.Color(...SKY_ZENITH);
  const GROUND = new THREE.Color(...SKY_GROUND);
  scene.fog = new THREE.FogExp2(HORIZON.getHex(), 0.00042);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100000);
  camera.rotation.order = "YXZ";

  // ---------- mission time and site (sun follows the real date at the real site) ----------
  const site = { lat: (corridor.bounds.south_lat_deg + corridor.bounds.north_lat_deg) / 2, lon: (corridor.bounds.west_lon_deg + corridor.bounds.east_lon_deg) / 2 };
  let missionStart = new Date(); // set by the planner; default: now
  let evaElapsedS = 0;
  const missionDate = () => new Date(missionStart.getTime() + evaElapsedS * 1000);
  let sunState = sunStateAt(missionDate(), { latDeg: site.lat, lonEastDeg: site.lon });
  const sunDir = new THREE.Vector3(sunState.x, sunState.y, sunState.z).normalize();

  const sun = new THREE.DirectionalLight(0xfff0de, 3.4);
  sun.castShadow = gfx.shadowPx > 0;
  if (sun.castShadow) {
    sun.shadow.mapSize.set(gfx.shadowPx, gfx.shadowPx);
    Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 900 });
    sun.shadow.bias = -0.00015;
    sun.shadow.normalBias = 0.025;
  }
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xc99a76, 0x2e1a12, 0.22);
  scene.add(hemi);

  const atmoUniforms = createAtmosphericHazeUniforms(THREE, {
    horizonColor: HORIZON,
    zenithColor: ZENITH,
    groundColor: GROUND,
    sunDir,
    sunElev: sunState.elevationRad,
    tau: DEFAULT_DUST_TAU,
  });
  const sky = createSkyDome(THREE, { sunDir, sunState, horizon: HORIZON, zenith: ZENITH, ground: GROUND });
  scene.add(sky);
  const moons = createMoons(THREE, {
    sunDir,
    moonFromSurface,
    phobosMapUrl: "./assets/moons/phobos-viking-usgs-2k.jpg",
    deimosMapUrl: "./assets/moons/deimos-viking-usgs-1k.jpg",
  });
  scene.add(moons.group);
  const celestial = createCelestialSky(THREE);
  scene.add(celestial.group);

  // image-based light from the same sky, rebuilt when the sun moves
  const envGeom = new THREE.SphereGeometry(50, 32, 16);
  function rebuildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(envGeom, sky.material));
    const prev = scene.environment;
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    prev?.dispose?.();
    const up = Math.max(0, Math.min(1, (sunState.elevationRad + 0.02) / 0.12));
    scene.environmentIntensity = 0.5 * (0.18 + 0.82 * up);
    pmrem.dispose();
  }

  // ---------- terrain ----------
  setLoading("Building terrain…");
  const terrain = createRealTerrain(THREE, {
    corridor,
    scene,
    renderer,
    atmoUniforms,
    getGfx: () => gfx,
    sampleMolaM,
    vikingUrl: "./assets/mars-globe/mars-viking-color-4k.jpg",
  });

  // ---------- route and stops ----------
  let route = data.route;
  let stops = data.stops;
  let routeCoords = [];
  let cumDist = [0];
  let totalM = 0;
  let routeLine = null;
  const routeMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9, depthTest: true });
  const stopGroup = new THREE.Group();
  scene.add(stopGroup);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5 });
  let stopLabels = [];

  function rebuildRouteLine() {
    if (routeLine) {
      scene.remove(routeLine);
      routeLine.geometry.dispose();
      routeLine = null;
    }
    if (routeCoords.length < 2) return;
    const pts = [];
    for (let i = 0; i < routeCoords.length - 1; i++) {
      const [lonA, latA] = routeCoords[i];
      const [lonB, latB] = routeCoords[i + 1];
      const ax = terrain.lonToX(lonA);
      const az = terrain.latToZ(latA);
      const bx = terrain.lonToX(lonB);
      const bz = terrain.latToZ(latB);
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        pts.push(x, terrain.surfaceY(x, z) + 0.12, z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    routeLine = new THREE.Line(g, routeMat);
    routeLine.frustumCulled = false;
    scene.add(routeLine);
  }

  function rebuildStops() {
    for (const c of [...stopGroup.children]) {
      stopGroup.remove(c);
      c.geometry?.dispose();
    }
    el.labels.innerHTML = "";
    stopLabels = [];
    for (const f of stops?.features || []) {
      const [lon, lat] = f.geometry.coordinates;
      const x = terrain.lonToX(lon);
      const z = terrain.latToZ(lat);
      const y = terrain.surfaceY(x, z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 8), poleMat);
      pole.position.set(x, y + 0.6, z);
      pole.castShadow = true;
      stopGroup.add(pole);
      const lbl = document.createElement("div");
      lbl.className = "eva-stop-label";
      lbl.textContent = f.properties?.name || f.properties?.id || "Stop";
      el.labels.appendChild(lbl);
      stopLabels.push({ f, x, z, pole, lbl });
    }
  }

  function setRoute(r, s) {
    route = r || null;
    if (s) stops = s;
    routeCoords = route?.geometry?.coordinates || [];
    cumDist = buildCumulativeDistances(routeCoords);
    totalM = cumDist[cumDist.length - 1] || 0;
    rebuildRouteLine();
    rebuildStops();
    computeStopAlong();
    progressS = 0;
    el.total.textContent = totalM ? fmtDist(totalM) : "no route";
  }

  /**
   * Distance along the route of the closest point to (lon, lat), and the distance off it. The route can
   * loop back to its start, so the search stays within `windowM` of the last known progress `nearS`.
   */
  function routeProgress(lon, lat, nearS = null, windowM = 150) {
    if (routeCoords.length < 2) return { alongM: 0, offM: NaN };
    let best = Infinity;
    let bestS = 0;
    const x = terrain.lonToX(lon);
    const z = terrain.latToZ(lat);
    for (let i = 0; i < routeCoords.length - 1; i++) {
      if (nearS != null && (cumDist[i + 1] < nearS - windowM || cumDist[i] > nearS + windowM)) continue;
      const ax = terrain.lonToX(routeCoords[i][0]);
      const az = terrain.latToZ(routeCoords[i][1]);
      const bx = terrain.lonToX(routeCoords[i + 1][0]);
      const bz = terrain.latToZ(routeCoords[i + 1][1]);
      const vx = bx - ax;
      const vz = bz - az;
      const len2 = vx * vx + vz * vz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / len2));
      const d = Math.hypot(ax + vx * t - x, az + vz * t - z);
      if (d < best) {
        best = d;
        bestS = cumDist[i] + (cumDist[i + 1] - cumDist[i]) * t;
      }
    }
    return { alongM: bestS, offM: best };
  }

  /** Each stop's distance along the route, found in order (stop k is searched after stop k - 1). */
  let stopAlong = [];
  let progressS = 0;
  function computeStopAlong() {
    stopAlong = [];
    let s = 0;
    for (const f of stops?.features || []) {
      const [lon, lat] = f.geometry.coordinates;
      // forward search from the previous stop: only segments at or after s
      let best = Infinity;
      let bestS = s;
      const x = terrain.lonToX(lon);
      const z = terrain.latToZ(lat);
      for (let i = 0; i < routeCoords.length - 1; i++) {
        if (cumDist[i + 1] < s) continue;
        const ax = terrain.lonToX(routeCoords[i][0]);
        const az = terrain.latToZ(routeCoords[i][1]);
        const bx = terrain.lonToX(routeCoords[i + 1][0]);
        const bz = terrain.latToZ(routeCoords[i + 1][1]);
        const vx = bx - ax;
        const vz = bz - az;
        const len2 = vx * vx + vz * vz || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / len2));
        const d = Math.hypot(ax + vx * t - x, az + vz * t - z);
        if (d < best - 1e-6) {
          best = d;
          bestS = cumDist[i] + (cumDist[i + 1] - cumDist[i]) * t;
          if (d < 0.5) break; // the first pass close to the stop is the visit
        }
      }
      stopAlong.push({ f, s: bestS });
      s = bestS;
    }
  }

  // ---------- walker ----------
  const startLonLat = () => routeCoords[0] || stops?.features?.[0]?.geometry?.coordinates || [site.lon, site.lat];
  const phys = createMarsBody({ x: 0, z: 0, y: 0, grounded: true });
  let yaw = 0;
  let pitch = -0.05;
  const env = {
    sampleHeight: (x, z) => terrain.surfaceY(x, z),
    molaElevM: (x, z) => terrain.elevBase + terrain.surfaceY(x, z),
  };

  // ---------- SEV pressurized rover (NASA 3D Resources MMSEV model, fact-sheet dynamics) ----------
  const sevGroup = new THREE.Group();
  scene.add(sevGroup);
  let sev = null; // VehicleDynamics body
  let driving = false;
  {
    const draco = new DRACOLoader();
    draco.setDecoderPath("./vendor/addons/libs/draco/gltf/");
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(draco);
    gltfLoader
      .loadAsync("./assets/nasa-3d/mmsev-rover.glb")
      .then((gltf) => {
        const model = gltf.scene;
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const scale = SEV_LENGTH_M / Math.max(size.x, size.z, 0.01);
        model.scale.setScalar(scale);
        model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
        const wrapper = new THREE.Group();
        wrapper.rotation.y = size.x > size.z ? Math.PI / 2 : Math.PI; // long axis along -z (forward)
        wrapper.add(model);
        wrapper.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        sevGroup.add(wrapper);
      })
      .catch((err) => console.warn("[eva] SEV model failed to load:", err));
  }
  function parkSev(x, z, yaw) {
    const sample = (px, pz) => terrain.surfaceY(px, pz);
    if (!sev) sev = createVehicleBody("sev", x, z, yaw, sample);
    else placeVehicle(sev, x, z, yaw, sample);
    syncSevMesh();
  }
  function syncSevMesh() {
    if (!sev) return;
    const pose = vehiclePose(sev);
    sevGroup.position.copy(pose.origin);
    sevGroup.quaternion.set(pose.q.x, pose.q.y, pose.q.z, pose.q.w);
  }

  async function placeAt(lon, lat, faceRoute = true) {
    const x = terrain.lonToX(lon);
    const z = terrain.latToZ(lat);
    if (terrain.insideCorridor(x, z)) {
      setLoading("Loading 1 m terrain…");
      await terrain.warmAt(x, z);
      setLoading("");
    }
    phys.x = phys.prevX = x;
    phys.z = phys.prevZ = z;
    phys.y = phys.prevY = terrain.surfaceY(x, z);
    phys.vx = phys.vz = phys.vy = 0;
    phys.grounded = true;
    if (faceRoute && routeCoords.length > 1) {
      const nx = terrain.lonToX(routeCoords[1][0]);
      const nz = terrain.latToZ(routeCoords[1][1]);
      yaw = Math.atan2(-(nx - x), -(nz - z));
    }
    driving = false;
    // the SEV waits 7 m to the walker's right, facing the same way
    parkSev(x + Math.cos(yaw) * 7, z - Math.sin(yaw) * 7, yaw);
  }

  // ---------- input ----------
  const keys = new Set();
  let active = false;
  const onKey = (e, down) => {
    if (!active) return;
    const k = e.key.toLowerCase();
    if (down) keys.add(k);
    else keys.delete(k);
    if (down && k === "e" && !e.repeat) toggleDrive();
    if (down && k === " " && phys.grounded) {
      phys.jumpQueued = true;
      e.preventDefault();
    }
  };
  function toggleDrive() {
    if (!sev) return;
    if (driving) {
      // step out beside the driver's door (left side)
      const pose = vehiclePose(sev);
      const x = pose.origin.x - Math.cos(pose.yaw) * 2.6;
      const z = pose.origin.z + Math.sin(pose.yaw) * 2.6;
      phys.x = phys.prevX = x;
      phys.z = phys.prevZ = z;
      phys.y = phys.prevY = terrain.surfaceY(x, z);
      phys.vx = phys.vz = phys.vy = 0;
      yaw = pose.yaw;
      driving = false;
      return;
    }
    const pose = vehiclePose(sev);
    if (Math.hypot(pose.origin.x - phys.x, pose.origin.z - phys.z) <= SEV_ENTER_M) {
      driving = true;
      camOffset = 0;
    }
  }
  const kd = (e) => onKey(e, true);
  const ku = (e) => onKey(e, false);
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);
  window.addEventListener("blur", () => keys.clear());
  renderer.domElement.addEventListener("click", () => {
    if (document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
  });
  // drag-to-look when the pointer is not locked (touchpads, embedded browsers)
  let drag = null;
  renderer.domElement.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener("pointerup", () => (drag = null));
  let camOffset = 0; // chase-camera yaw offset from the rover heading while driving
  const look = (dx, dy) => {
    if (driving) camOffset -= dx * 0.0028;
    else yaw -= dx * 0.0028;
    pitch = Math.max(-1.35, Math.min(1.35, pitch - dy * 0.0024));
  };
  window.addEventListener("pointermove", (e) => {
    if (!active) return;
    if (document.pointerLockElement === renderer.domElement) look(e.movementX, e.movementY);
    else if (drag) {
      look(e.clientX - drag.x, e.clientY - drag.y);
      drag = { x: e.clientX, y: e.clientY };
    }
  });

  // ---------- post-processing (no helmet bezel or grain: this is a planning view) ----------
  const post = createMarsPostPipeline({ THREE, renderer, scene, camera });
  post.applySettings({ ao: gfx.ao, aa: gfx.aa, bloom: gfx.bloom });
  post.setVisor({ visorOn: false });

  const unsubSettings = subscribeDevSettings((cfg) => {
    devCfg = cfg;
    gfx = resolveGraphics(devCfg, hwHint);
    renderer.setPixelRatio(effectivePixelRatio(window.devicePixelRatio, gfx.pixelRatioCap, gfx.renderScale));
    post.applySettings({ ao: gfx.ao, aa: gfx.aa, bloom: gfx.bloom });
    onResize();
  });

  function onResize() {
    const w = root.clientWidth || window.innerWidth;
    const h = root.clientHeight || window.innerHeight;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    post.setSize(w, h);
  }
  window.addEventListener("resize", onResize);

  // ---------- sun refresh ----------
  let sunRefreshT = 0;
  let lastEnvSunEl = NaN;
  function refreshSun() {
    sunState = sunStateAt(missionDate(), { latDeg: site.lat, lonEastDeg: site.lon });
    sunDir.set(sunState.x, sunState.y, sunState.z).normalize();
    const up = Math.max(0, Math.min(1, (sunState.elevationRad + 0.02) / 0.12));
    sun.intensity = 3.4 * up * (sunState.fluxWm2 / 590);
    hemi.intensity = 0.04 + 0.18 * up;
    sky.material.uniforms.uSunElev.value = sunState.elevationRad;
    sky.material.uniforms.uSunCos.value = Math.cos(sunState.sunAngularRad * 0.5);
    updateAtmosphericHazeUniforms(atmoUniforms, { sunElev: sunState.elevationRad, tau: DEFAULT_DUST_TAU });
    celestial.update(sunState);
    if (!(Math.abs(sunState.elevationRad - lastEnvSunEl) < 0.02)) {
      lastEnvSunEl = sunState.elevationRad;
      rebuildEnvironment();
    }
  }
  refreshSun();

  // ---------- data lines that do not change per frame ----------
  {
    const w = data.weather?.latest_sol;
    el.wx.textContent = w
      ? `REMS sol ${w.sol} (latest in feed, not mission day): air ${w.air_min_C}…${w.air_max_C} °C · ${w.pressure_Pa} Pa`
      : "REMS weather: not available";
    const c = data.alerts?.counts;
    const marsRuns = (data.alerts?.alerts || []).filter((a) => a.mars_in_impact_list && !a.is_example).length;
    el.donki.textContent = c
      ? `DONKI ${data.alerts.window?.start || ""}–${data.alerts.window?.end || ""}: ${marsRuns} WSA-Enlil runs list Mars · SEP ${c.SEP}`
      : "DONKI: not available";
  }

  // ---------- loop ----------
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const proj = new THREE.Vector3();
  let last = performance.now();
  let hudT = 0;
  let routeRefreshT = 0;
  let raf = 0;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!active) return;

    // walk
    fwd.set(0, 0, -1).applyAxisAngle(UP, yaw);
    right.set(1, 0, 0).applyAxisAngle(UP, yaw);
    let wx = 0;
    let wz = 0;
    if (keys.has("w") || keys.has("arrowup")) (wx += fwd.x), (wz += fwd.z);
    if (keys.has("s") || keys.has("arrowdown")) (wx -= fwd.x), (wz -= fwd.z);
    if (keys.has("d") || keys.has("arrowright")) (wx += right.x), (wz += right.z);
    if (keys.has("a") || keys.has("arrowleft")) (wx -= right.x), (wz -= right.z);
    const moving = wx !== 0 || wz !== 0;
    if (driving && sev) {
      const throttle = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
      const steer = (keys.has("a") || keys.has("arrowleft") ? 1 : 0) - (keys.has("d") || keys.has("arrowright") ? 1 : 0);
      stepVehicle(sev, { throttle, steer, brake: keys.has(" ") }, { sampleHeight: (x, z) => terrain.surfaceY(x, z) }, dt);
      syncSevMesh();
      const pose = vehiclePose(sev);
      phys.x = pose.origin.x;
      phys.z = pose.origin.z;
      phys.y = pose.origin.y;
      phys.slopeDeg = (Math.acos(Math.max(-1, Math.min(1, pose.up.y))) * 180) / Math.PI;
      if (Math.abs(sev.forwardSpeed) > 0.05) evaElapsedS += dt;
    } else {
      if (sev && !sev.sleeping) {
        stepVehicle(sev, {}, { sampleHeight: (x, z) => terrain.surfaceY(x, z) }, dt);
        syncSevMesh();
      }
      stepPhysicsWorld(
        phys,
        dt,
        { wishX: wx, wishZ: wz, run: keys.has("shift"), speedMultiplier: 1, slopeLimitDeg: 20, latDeg: terrain.zToLat(phys.z) },
        env
      );
      // the parked rover is solid
      if (sev) {
        const pose = vehiclePose(sev);
        const dx = phys.x - pose.origin.x;
        const dz = phys.z - pose.origin.z;
        const c = Math.cos(pose.yaw);
        const sn = Math.sin(pose.yaw);
        const lx = dx * c - dz * sn; // rover-local right
        const lz = dx * sn + dz * c; // rover-local back
        const hw = 1.9;
        const hl = SEV_LENGTH_M / 2 + 0.4;
        if (Math.abs(lx) < hw && Math.abs(lz) < hl) {
          const px = hw - Math.abs(lx);
          const pz = hl - Math.abs(lz);
          const nlx = px < pz ? Math.sign(lx) * hw : lx;
          const nlz = px < pz ? lz : Math.sign(lz) * hl;
          phys.x = pose.origin.x + nlx * c + nlz * sn;
          phys.z = pose.origin.z - nlx * sn + nlz * c;
          phys.vx = phys.vz = 0;
        }
      }
      if (moving || !phys.grounded) evaElapsedS += dt;
    }
    const lonNow = terrain.xToLon(phys.x);
    const latNow = terrain.zToLat(phys.z);

    terrain.update(phys.x, phys.z, dt);
    if (driving && sev) {
      // chase camera behind the rover; mouse orbits it
      const pose = vehiclePose(sev);
      const camYaw = pose.yaw + camOffset;
      const dist = 11;
      const el = Math.max(0.08, Math.min(1.2, 0.28 - pitch));
      camera.position.set(
        pose.origin.x + Math.sin(camYaw) * dist * Math.cos(el),
        pose.origin.y + 1.6 + dist * Math.sin(el),
        pose.origin.z + Math.cos(camYaw) * dist * Math.cos(el)
      );
      camera.position.y = Math.max(camera.position.y, terrain.surfaceY(camera.position.x, camera.position.z) + 0.6);
      camera.lookAt(pose.origin.x, pose.origin.y + 1.6, pose.origin.z);
    } else {
      camera.position.set(phys.x, phys.y + EYE_HEIGHT_M - (phys.crouch || 0), phys.z);
      camera.position.y = Math.max(camera.position.y, terrain.surfaceY(camera.position.x, camera.position.z) + 0.3);
      camera.rotation.set(pitch, yaw, 0);
    }

    // sun follows the camera; shadow box around the walker
    sun.position.copy(camera.position).addScaledVector(sunDir, 400);
    sun.target.position.copy(camera.position);
    sky.position.copy(camera.position);
    celestial.group.position.copy(camera.position);
    sunRefreshT -= dt;
    if (sunRefreshT <= 0) {
      sunRefreshT = 2;
      refreshSun();
    }
    const skyCol = HORIZON.clone().lerp(ZENITH, 0.4).multiplyScalar(Math.max(0.03, Math.min(1, (sunState.elevationRad + 0.3) / 0.42)));
    moons.update(sunState, camera, skyCol);

    routeRefreshT -= dt;
    if (routeRefreshT <= 0) {
      routeRefreshT = 3; // re-drape the route once finer chunks have streamed in
      rebuildRouteLine();
      for (const s of stopLabels) s.pole.position.y = terrain.surfaceY(s.x, s.z) + 0.6;
    }

    // stop labels
    const w = root.clientWidth;
    const h = root.clientHeight;
    for (const s of stopLabels) {
      proj.set(s.x, s.pole.position.y + 0.9, s.z);
      const dist = proj.distanceTo(camera.position);
      proj.project(camera);
      const vis = proj.z < 1 && Math.abs(proj.x) < 1.1 && Math.abs(proj.y) < 1.1 && dist < 3000;
      s.lbl.style.display = vis ? "block" : "none";
      if (vis) {
        s.lbl.style.transform = `translate(${((proj.x + 1) / 2) * w}px, ${((1 - proj.y) / 2) * h}px) translate(-50%, -100%)`;
        s.lbl.dataset.dist = fmtDist(dist);
      }
    }

    hudT -= dt;
    if (hudT <= 0) {
      hudT = 0.2;
      updateHud(lonNow, latNow);
    }
    post.render(dt);
  }

  function updateHud(lon, lat) {
    const src = terrain.sourceAt(phys.x, phys.z);
    const elevM = terrain.elevBase + phys.y;
    el.pos.textContent = `${fmtLat(lat)} ${fmtLon(lon)}`;
    el.elev.textContent = `ELEV ${fmt(elevM, 0)} m (MOLA areoid)`;
    el.src.textContent = `ground: ${SOURCE_LABEL[src]}`;
    el.time.textContent = `LTST ${formatHoursHM(sunState.ltstHours)} · Ls ${fmt(sunState.lsDeg, 1)}° · ${missionDate().toISOString().slice(0, 16)}Z`;
    el.sun.textContent = `sun el ${fmt(sunState.elevationRad / DEG, 1)}° az ${fmt(((sunState.azimuthRad / DEG) % 360 + 360) % 360, 0)}° (Mars24)`;
    const viewYaw = driving && sev ? vehiclePose(sev).yaw + camOffset : yaw;
    const hdg = ((-viewYaw / DEG) % 360 + 360) % 360;
    el.hdg.textContent = `${fmt(hdg, 0).padStart(3, "0")}° ${cardinal(hdg)}`;
    el.pitch.textContent = `${pitch >= 0 ? "+" : ""}${fmt(pitch / DEG, 0)}°`;
    const slope = phys.slopeDeg || 0;
    const tier = classifySlope(slope, 20);
    el.slope.textContent = `${fmt(slope, 1)}°`;
    el.tier.textContent = tier.label;
    el.tier.className = `tier tier-${tier.level}`;
    const t = evaElapsedS;
    el.clock.textContent = [Math.floor(t / 3600), Math.floor((t % 3600) / 60), Math.floor(t % 60)].map((v) => String(v).padStart(2, "0")).join(":");
    el.dose.textContent = `${fmt((RAD_BASELINE_MSV_PER_DAY * t) / 86400, 4)} mSv`;
    el.drive.hidden = !driving;
    if (driving && sev) el.drive.innerHTML = `<span class="lbl">SEV</span> <b>${fmt(Math.abs(sev.forwardSpeed) * 3.6, 1)} km/h</b> <span class="dim">top ~10 km/h (NASA SEV fact sheet); W/S drive · A/D steer · Space brake · E get out</span>`;
    if (routeCoords.length > 1) {
      let p = routeProgress(lon, lat, progressS);
      if (!(p.offM < 60)) p = routeProgress(lon, lat); // far off the route: search all of it
      progressS = p.alongM;
      el.along.textContent = fmtDist(p.alongM);
      el.off.textContent = fmtDist(p.offM);
      const next = stopAlong.find((st) => st.s > p.alongM + 3);
      if (next) {
        const c = next.f.geometry.coordinates;
        el.next.textContent = next.f.properties?.name || next.f.properties?.id || "stop";
        el.nextd.textContent = `${fmtDist(marsDistanceM([lon, lat], c))} straight · ${fmtDist(next.s - p.alongM)} by route · bearing ${fmt(marsBearingDeg([lon, lat], c), 0)}°`;
      } else {
        el.next.textContent = "end of route";
        el.nextd.textContent = "";
      }
    }
    onStatus?.({ lon, lat, elevM, src });
  }

  // ---------- start ----------
  setRoute(route, stops);
  const [sLon, sLat] = startLonLat();
  await placeAt(sLon, sLat);
  onResize();
  setLoading("");
  raf = requestAnimationFrame(frame);

  return {
    show() {
      active = true;
      hud.hidden = false;
      onResize();
    },
    hide() {
      active = false;
      keys.clear();
      if (document.pointerLockElement) document.exitPointerLock?.();
    },
    onResize,
    /** Load a mission from the planner: route, stops and start time; walker goes to the start. */
    async setMission({ route: r, stops: s, startDate } = {}) {
      if (startDate) missionStart = new Date(startDate);
      evaElapsedS = 0;
      setRoute(r, s);
      const [lon, lat] = startLonLat();
      await placeAt(lon, lat);
      refreshSun();
    },
    /** True when (lon, lat) has measured terrain the 3D view can show (HiRISE corridor for now). */
    canRehearseAt(lon, lat) {
      return terrain.insideCorridor(terrain.lonToX(lon), terrain.latToZ(lat));
    },
    getLonLat: () => [terrain.xToLon(phys.x), terrain.zToLat(phys.z)],
    terrainInfo: () => ({ molaOffsetM: terrain.molaOffsetM, bounds: corridor.bounds }),
    /** State snapshot for tests and debugging. */
    debugState: () => {
      const pose = sev ? vehiclePose(sev) : null;
      return {
        driving,
        walker: { x: phys.x, y: phys.y, z: phys.z, yaw },
        sev: pose ? { x: pose.origin.x, y: pose.origin.y, z: pose.origin.z, yaw: pose.yaw, speed: sev.forwardSpeed, modelLoaded: sevGroup.children.length > 0 } : null,
      };
    },
    dispose() {
      cancelAnimationFrame(raf);
      unsubSettings?.();
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
    },
  };
}
