/**
 * High-Resolution Mars 3D Terrain & Helmet-Visor Engine (`HighResMarsTerrainEngine`).
 *
 * Implements the `IMapAdapter` contract on top of Three.js:
 * - CDLOD Quadtree terrain manager with skirted meshes & SSE <= 2.5 px split criterion
 * - Parent-tile fallback while child meshes stream off-main-thread via TerrainWorkerPool
 * - Byte-budgeted GPU TileLRUCache with pinned active keys and full `.dispose()` cleanup
 * - Relative-To-Center (RTC) Float64 -> Float32 origin preventing WebGL vertex jitter
 * - `logarithmicDepthBuffer: true` for centimeter boulder details + kilometer crater rim horizon
 * - Custom Mars PBR Shader (HiRISE ortho / Slope stand-in / Strata + rotated micro-detail normals + Mars dust sky)
 * - Terrain-draped subdivided AR route tube (+0.38 m ground offset) and stop beacons
 * - First-person astronaut collision clamping (>= groundY + 1.4 m) and screen-to-terrain raycasting
 */

import { BaseMapAdapter } from "./IMapAdapter.js";
import {
  MARS_RADIUS_MEAN_M,
  localRTCToLonLatElev,
  lonLatElevToLocalRTC,
  makeLocalTangentOrigin,
  marsBearingDeg,
  marsDistanceM,
  toLngLat,
} from "./Geodesy.js";
import { TileLRUCache } from "./TileSourceRegistry.js";
import { TerrainWorkerPool } from "./TerrainWorkerPool.js";
import {
  createMarsSkyDome,
  createMarsTerrainMaterial,
  createMartianMicroDetailTextures,
} from "./MarsTerrainShader.js";

const MAX_QUADTREE_DEPTH = 3; // Depth 3 => ~250 m leaf tiles with 48x48 mesh (~5 m post = full DTM res)
const TARGET_SSE_PX = 2.5;
const ASTRONAUT_EYE_HEIGHT_M = 1.75;
const MIN_CLEARANCE_M = 1.35;

export class HighResMarsTerrainEngine extends BaseMapAdapter {
  /**
   * @param {object} opts
   * @param {typeof import('three')} opts.THREE
   * @param {import('./MarsDemSampler.js').MarsDemSampler} opts.demSampler
   * @param {boolean} [opts.demoSafe=false]
   * @param {string|null} [opts.orthoPreviewUrl]
   * @param {string|null} [opts.slopePreviewUrl]
   */
  constructor(opts) {
    super("HighResMarsTerrainEngine");
    this.THREE = opts.THREE;
    this.demSampler = opts.demSampler;
    this.demoSafe = Boolean(opts.demoSafe);
    this.orthoPreviewUrl = this.demoSafe ? null : opts.orthoPreviewUrl || null;
    this.slopePreviewUrl = opts.slopePreviewUrl || null;

    this.rootBounds = {
      west: opts.demSampler.bounds.west_lon_deg,
      south: opts.demSampler.bounds.south_lat_deg,
      east: opts.demSampler.bounds.east_lon_deg,
      north: opts.demSampler.bounds.north_lat_deg,
    };
    const midLon = (this.rootBounds.west + this.rootBounds.east) * 0.5;
    const midLat = (this.rootBounds.south + this.rootBounds.north) * 0.5;
    const midElev = opts.demSampler.sampleElevation([midLon, midLat], true) ?? -3600;
    this.rtcOrigin = makeLocalTangentOrigin(midLon, midLat, midElev);

    this.exaggeration = 1.0;
    this.mode = 0; // 0: Mars PBR, 1: Lunar Stand-In Slope, 2: Elevation Strata
    this.strictSlopeDeg = 20.0;
    this.arVisible = true;

    this._workerPool = new TerrainWorkerPool({ poolSize: 3 });
    /** @type {TileLRUCache} */
    this._tileGpuCache = new TileLRUCache(72 * 1024 * 1024, (_key, rec) => {
      this._disposeTileRecord(rec);
    });
    /** @type {Map<string, AbortController>} */
    this._inflightTiles = new Map();
    /** @type {Map<string, object>} */
    this._nodeMeta = new Map();
    this._activeMeshList = [];

    this._renderer = null;
    this._scene = null;
    this._camera = null;
    this._terrainGroup = null;
    this._overlayGroup = null;
    this._geoLayers = new Map();

    this._microDetail = null;
    this._orthoTex = null;
    this._slopeTex = null;
    this._activeMacroTex = null;

    // Camera state (in geo coords + local FPS angles)
    this._camLonLat = [midLon, midLat];
    this._camHeightOffsetM = ASTRONAUT_EYE_HEIGHT_M;
    this._yawRad = 0;
    this._pitchRad = -0.14;
    this._flyState = null;

    this._rockFieldMesh = null;

    this._raycaster = null;
    this._rafId = null;
    this._ro = null;
    this._container = null;
    this._width = 800;
    this._height = 500;
    this._pointerDragging = false;
    this._dragMoved = false;
    this._lastPointer = [0, 0];
    this._hoverNdc = null;
    this._hoverCursorRtc = null;
    this._needsTileEval = true;
  }

  async mount(container, options = {}) {
    const THREE = this.THREE;
    if (!THREE) {
      throw new Error("Three.js module not loaded");
    }
    this._container = container;
    this._width = Math.max(240, container.clientWidth || 800);
    this._height = Math.max(180, container.clientHeight || 500);

    await this._workerPool.initDem(this.demSampler, {
      lonDeg: this.rtcOrigin.lonDeg,
      latDeg: this.rtcOrigin.latDeg,
      elevM: this.rtcOrigin.elevM,
    });

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(this._width, this._height);
    container.innerHTML = "";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.setAttribute("aria-label", "Mars Gale Crater 3D terrain canvas");
    container.appendChild(renderer.domElement);
    this._renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xb8764d);
    this._scene = scene;

    const camera = new THREE.PerspectiveCamera(62, this._width / this._height, 0.25, 16000);
    camera.rotation.order = "YXZ";
    this._camera = camera;

    scene.add(createMarsSkyDome(THREE, 7500));

    const ambientLight = new THREE.AmbientLight(0xd99e7e, 0.65);
    const sunLight = new THREE.DirectionalLight(0xffeed9, 1.35);
    sunLight.position.set(1800, 1500, -2100);
    scene.add(ambientLight, sunLight);

    this._terrainGroup = new THREE.Group();
    this._terrainGroup.name = "QuadtreeTerrainGroup";
    this._overlayGroup = new THREE.Group();
    this._overlayGroup.name = "TerrainOverlayGroup";
    scene.add(this._terrainGroup, this._overlayGroup);

    this._microDetail = createMartianMicroDetailTextures(THREE, 256);
    this._raycaster = new THREE.Raycaster();
    this._hoverCursorRtc = new THREE.Vector3();

    this._loadMacroTextures();
    this._buildRockField();

    if (options.center) this._camLonLat = toLngLat(options.center);
    if (typeof options.bearing === "number") this._yawRad = (-options.bearing * Math.PI) / 180;
    if (typeof options.pitch === "number") {
      this._pitchRad = Math.max(-1.35, Math.min(1.35, ((options.pitch - 90) * Math.PI) / 180));
    }

    this._syncCameraPosition();
    this._bindInteractions(renderer.domElement);

    if (typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(container);
    }

    // Build root node upfront so first frame isn't empty
    await this._ensureTileBuilt("0/0/0", this.rootBounds, 0);
    this._evaluateQuadtree();

    this._mounted = true;
    this._startLoop();
    this.emit("attributionchange", this.getActiveAttributions());
    return this;
  }

  _loadMacroTextures() {
    const THREE = this.THREE;
    const loader = new THREE.TextureLoader();

    const configureTex = (tex) => {
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      return tex;
    };

    if (this.slopePreviewUrl) {
      loader.load(
        this.slopePreviewUrl,
        (tex) => {
          this._slopeTex = configureTex(tex);
          if (this.mode === 1) {
            this._activeMacroTex = this._slopeTex;
            this._refreshTileUniforms();
          }
        },
        undefined,
        () => {}
      );
    }

    if (this.orthoPreviewUrl && !this.demoSafe) {
      loader.load(
        this.orthoPreviewUrl,
        (tex) => {
          this._orthoTex = configureTex(tex);
          if (this.mode === 0) {
            this._activeMacroTex = this._orthoTex;
            this._refreshTileUniforms();
          }
        },
        undefined,
        () => {}
      );
    }
  }

  _bindInteractions(dom) {
    dom.addEventListener("pointerdown", (e) => {
      this._pointerDragging = true;
      this._dragMoved = false;
      this._lastPointer = [e.clientX, e.clientY];
      this._flyState = null;
    });

    window.addEventListener("pointermove", (e) => {
      const rect = dom.getBoundingClientRect();
      if (this._pointerDragging) {
        const dx = e.clientX - this._lastPointer[0];
        const dy = e.clientY - this._lastPointer[1];
        if (Math.abs(dx) + Math.abs(dy) > 2) this._dragMoved = true;
        this._lastPointer = [e.clientX, e.clientY];
        this._yawRad += dx * 0.0045;
        this._pitchRad = Math.max(-1.32, Math.min(1.25, this._pitchRad + dy * 0.004));
        this._camera.rotation.y = this._yawRad;
        this._camera.rotation.x = this._pitchRad;
        this.emit("viewchange", this.getView());
      } else if (e.target === dom && rect.width > 0 && rect.height > 0) {
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const hit = this._raycastScreen(x, y);
        if (hit) {
          this._hoverCursorRtc.copy(hit.point);
          this._refreshTileCursor(true);
          this.emit("hover", {
            lon: hit.lon,
            lat: hit.lat,
            elevM: hit.elevM,
            slopeDeg: hit.slopeDeg,
            x,
            y,
          });
        } else {
          this._refreshTileCursor(false);
        }
      }
    });

    window.addEventListener("pointerup", () => {
      this._pointerDragging = false;
    });

    dom.addEventListener("click", (e) => {
      if (this._dragMoved) return;
      const rect = dom.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = this._raycastScreen(x, y);
      if (hit) {
        this.emit("click", {
          lon: hit.lon,
          lat: hit.lat,
          lngLat: { lng: hit.lon, lat: hit.lat },
          elevM: hit.elevM,
          slopeDeg: hit.slopeDeg,
          x,
          y,
        });
      }
    });
  }

  _raycastScreen(x, y) {
    if (!this._raycaster || !this._camera || this._activeMeshList.length === 0) return null;
    const ndcX = (x / Math.max(1, this._width)) * 2 - 1;
    const ndcY = -(y / Math.max(1, this._height)) * 2 + 1;
    this._raycaster.setFromCamera({ x: ndcX, y: ndcY }, this._camera);
    const hits = this._raycaster.intersectObjects(this._activeMeshList, false);
    if (!hits || hits.length === 0) return null;
    const p = hits[0].point;
    const geo = localRTCToLonLatElev(p.x, p.y / this.exaggeration, p.z, this.rtcOrigin);
    const info = this.demSampler.sampleSlopeAndNormal([geo.lon, geo.lat]);
    return {
      point: p,
      lon: geo.lon,
      lat: geo.lat,
      elevM: info ? info.elevM : geo.elevM,
      slopeDeg: info ? info.slopeDeg : null,
    };
  }

  unproject(screenXY) {
    const hit = this._raycastScreen(screenXY[0], screenXY[1]);
    return hit ? [hit.lon, hit.lat] : null;
  }

  project(lonLat) {
    if (!this._camera) return null;
    const [lon, lat] = toLngLat(lonLat);
    const elev = (this.demSampler.sampleElevation([lon, lat], true) ?? this.rtcOrigin.elevM) * this.exaggeration;
    const rtc = lonLatElevToLocalRTC(lon, lat, elev, this.rtcOrigin);
    const v = new this.THREE.Vector3(rtc.x, rtc.y, rtc.z).project(this._camera);
    return [(v.x * 0.5 + 0.5) * this._width, (-v.y * 0.5 + 0.5) * this._height];
  }

  _syncCameraPosition() {
    if (!this._camera) return;
    const groundRaw = this.demSampler.sampleElevation(this._camLonLat, true) ?? this.rtcOrigin.elevM;
    const groundY = groundRaw * this.exaggeration;
    const minEye = Math.max(MIN_CLEARANCE_M, this._camHeightOffsetM);
    const rtc = lonLatElevToLocalRTC(
      this._camLonLat[0],
      this._camLonLat[1],
      groundY + minEye,
      this.rtcOrigin
    );
    this._camera.position.set(rtc.x, rtc.y, rtc.z);
    this._camera.rotation.y = this._yawRad;
    this._camera.rotation.x = this._pitchRad;
    this._needsTileEval = true;
  }

  /**
   * Move astronaut POV along ground (with automatic terrain collision clamping).
   */
  setAstronautPose({ lon, lat, headingDeg = null, pitchRad = null, heightAboveGroundM = ASTRONAUT_EYE_HEIGHT_M }) {
    this._camLonLat = toLngLat([lon, lat]);
    this._camHeightOffsetM = Math.max(MIN_CLEARANCE_M, heightAboveGroundM);
    if (typeof headingDeg === "number" && Number.isFinite(headingDeg)) {
      this._yawRad = (-headingDeg * Math.PI) / 180;
    }
    if (typeof pitchRad === "number" && Number.isFinite(pitchRad)) {
      this._pitchRad = Math.max(-1.32, Math.min(1.25, pitchRad));
    }
    this._syncCameraPosition();
    this.emit("viewchange", this.getView());
  }

  /**
   * Free-roam horizontal step in meters, softly clamped to the Gale HiRISE DEM bounds
   * and ground-collision-clamped strictly >= groundY + MIN_CLEARANCE_M.
   */
  stepForwardMeters(forwardM, strafeM = 0) {
    const yaw = this._yawRad;
    // Camera looks toward (-sin(yaw), -cos(yaw)) in XZ (+X East, +Z South)
    const dirEast = -Math.sin(yaw);
    const dirSouth = -Math.cos(yaw);
    const rightEast = Math.cos(yaw);
    const rightSouth = -Math.sin(yaw);

    const dEastM = dirEast * forwardM + rightEast * strafeM;
    const dSouthM = dirSouth * forwardM + rightSouth * strafeM;

    const currentGround = this.demSampler.sampleElevation(this._camLonLat, true) ?? this.rtcOrigin.elevM;
    const curRtc = lonLatElevToLocalRTC(
      this._camLonLat[0],
      this._camLonLat[1],
      currentGround * this.exaggeration,
      this.rtcOrigin
    );
    const nextGeo = localRTCToLonLatElev(
      curRtc.x + dEastM,
      curRtc.y,
      curRtc.z + dSouthM,
      this.rtcOrigin
    );

    const clampedLon = Math.max(
      this.rootBounds.west + 0.0002,
      Math.min(this.rootBounds.east - 0.0002, nextGeo.lon)
    );
    const clampedLat = Math.max(
      this.rootBounds.south + 0.0002,
      Math.min(this.rootBounds.north - 0.0002, nextGeo.lat)
    );
    this._camLonLat = [clampedLon, clampedLat];
    this._syncCameraPosition();
    this.emit("viewchange", this.getView());
    return { lon: clampedLon, lat: clampedLat };
  }

  setView(view = {}) {
    if (view.center) this._camLonLat = toLngLat(view.center);
    if (typeof view.bearing === "number") this._yawRad = (-view.bearing * Math.PI) / 180;
    if (typeof view.pitch === "number") {
      this._pitchRad = Math.max(-1.32, Math.min(1.25, ((view.pitch - 85) * Math.PI) / 180));
    }
    this._syncCameraPosition();
    this.emit("viewchange", this.getView());
  }

  flyTo(view = {}) {
    const target = view.center ? toLngLat(view.center) : this._camLonLat;
    const durationMs = view.durationMs ?? 700;
    if (durationMs <= 0) {
      this.setView(view);
      return;
    }
    this._flyState = {
      startTime: performance.now(),
      durationMs,
      fromLonLat: [...this._camLonLat],
      toLonLat: target,
      fromYaw: this._yawRad,
      toYaw:
        typeof view.bearing === "number"
          ? (-view.bearing * Math.PI) / 180
          : (-marsBearingDeg(this._camLonLat, target) * Math.PI) / 180,
    };
  }

  getView() {
    const bearingDeg = ((-this._yawRad * 180) / Math.PI + 360) % 360;
    const elevM = this.demSampler.sampleElevation(this._camLonLat, true);
    return {
      center: [...this._camLonLat],
      zoom: 16.5,
      pitch: Math.round((this._pitchRad * 180) / Math.PI + 90),
      bearing: bearingDeg,
      elevM,
    };
  }

  getBounds() {
    return { ...this.rootBounds };
  }

  /**
   * Switch terrain surface shader visualization:
   * - 'mars-pbr' / 'hirise-ortho' -> mode 0 (Martian Regolith/Mudstone PBR + ortho)
   * - 'slope-hazard' -> mode 1 (Lunar stand-in hazard colors + slope preview)
   * - 'elevation-strata' -> mode 2 (Mount Sharp stratigraphic contour bands)
   */
  setImageryProvider(providerId) {
    if (providerId === "slope-hazard" || providerId === "slope") {
      this.mode = 1;
      this._activeMacroTex = this._slopeTex;
    } else if (providerId === "elevation-strata" || providerId === "strata") {
      this.mode = 2;
      this._activeMacroTex = null;
    } else {
      this.mode = 0;
      this._activeMacroTex = this._orthoTex || null;
    }
    this._refreshTileUniforms();
  }

  setStrictSlopeLimit(deg) {
    this.strictSlopeDeg = Number(deg) || 20;
    this._refreshTileUniforms();
  }

  setTerrainExaggeration(factor) {
    const next = Math.max(0.5, Math.min(3.5, Number(factor) || 1.0));
    if (Math.abs(next - this.exaggeration) < 0.01) return;
    this.exaggeration = next;
    // Rebuild cached tiles cleanly at new exaggeration
    for (const ctrl of this._inflightTiles.values()) ctrl.abort();
    this._inflightTiles.clear();
    this._tileGpuCache.clear();
    this._terrainGroup.clear();
    this._activeMeshList = [];
    this._syncCameraPosition();
    this._rebuildAllGeoJsonLayers();
    this._buildRockField();
    this._ensureTileBuilt("0/0/0", this.rootBounds, 0).then(() => this._evaluateQuadtree());
  }

  _refreshTileUniforms() {
    for (const entry of this._tileGpuCache._map.values()) {
      const mat = entry.value.material;
      if (!mat || !mat.uniforms) continue;
      mat.uniforms.u_mode.value = this.mode;
      mat.uniforms.u_strictSlopeDeg.value = this.strictSlopeDeg;
      mat.uniforms.u_macroMap.value = this._activeMacroTex || null;
      mat.uniforms.u_hasMacroMap.value = this._activeMacroTex ? 1.0 : 0.0;
    }
  }

  _refreshTileCursor(active) {
    for (const entry of this._tileGpuCache._map.values()) {
      const mat = entry.value.material;
      if (!mat || !mat.uniforms) continue;
      mat.uniforms.u_cursorActive.value = active ? 1.0 : 0.0;
      if (active) mat.uniforms.u_cursorRtc.value.copy(this._hoverCursorRtc);
    }
  }

  addGeoJsonLayer(id, fc, style = {}) {
    this._geoLayers.set(id, { fc, style, visible: style.visible !== false, group: null });
    this._buildGeoJsonLayer(id);
  }

  updateGeoJsonLayer(id, fc) {
    const rec = this._geoLayers.get(id);
    if (!rec) {
      this.addGeoJsonLayer(id, fc, {});
      return;
    }
    rec.fc = fc;
    this._buildGeoJsonLayer(id);
  }

  removeLayer(id) {
    const rec = this._geoLayers.get(id);
    if (rec?.group) {
      this._disposeObjectGroup(rec.group);
      this._overlayGroup.remove(rec.group);
    }
    this._geoLayers.delete(id);
  }

  setLayerVisibility(id, visible) {
    if (id === "ar-overlays") {
      this.arVisible = Boolean(visible);
      if (this._overlayGroup) this._overlayGroup.visible = this.arVisible;
      return;
    }
    const rec = this._geoLayers.get(id);
    if (rec) {
      rec.visible = Boolean(visible);
      if (rec.group) rec.group.visible = rec.visible;
    }
  }

  _rebuildAllGeoJsonLayers() {
    for (const id of this._geoLayers.keys()) {
      this._buildGeoJsonLayer(id);
    }
  }

  _disposeObjectGroup(group) {
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
  }

  _buildGeoJsonLayer(id) {
    const THREE = this.THREE;
    const rec = this._geoLayers.get(id);
    if (!rec || !this._overlayGroup) return;
    if (rec.group) {
      this._disposeObjectGroup(rec.group);
      this._overlayGroup.remove(rec.group);
    }

    const group = new THREE.Group();
    group.name = `overlay_${id}`;
    group.visible = rec.visible;
    rec.group = group;

    const features = rec.fc?.features || [];
    for (const feat of features) {
      const g = feat.geometry;
      if (!g) continue;

      if (g.type === "LineString" && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
        // Subdivide every ~4 m on Mars so the AR tube conforms tightly over ridges/swales (+0.38 m offset)
        const pts = [];
        for (let i = 0; i < g.coordinates.length - 1; i++) {
          const a = toLngLat(g.coordinates[i]);
          const b = toLngLat(g.coordinates[i + 1]);
          const distM = marsDistanceM(a, b, MARS_RADIUS_MEAN_M);
          const steps = Math.max(1, Math.ceil(distM / 4));
          for (let s = 0; s < (i === g.coordinates.length - 2 ? steps + 1 : steps); s++) {
            const t = s / steps;
            const lon = a[0] + (b[0] - a[0]) * t;
            const lat = a[1] + (b[1] - a[1]) * t;
            const elev = (this.demSampler.sampleElevation([lon, lat], true) ?? this.rtcOrigin.elevM) * this.exaggeration;
            const rtc = lonLatElevToLocalRTC(lon, lat, elev + 0.38, this.rtcOrigin);
            pts.push(new THREE.Vector3(rtc.x, rtc.y, rtc.z));
          }
        }
        if (pts.length >= 2) {
          const curve = new THREE.CatmullRomCurve3(pts);
          const tubeGeo = new THREE.TubeGeometry(curve, Math.min(420, pts.length * 2), 0.09, 6, false);
          const tubeMat = new THREE.MeshBasicMaterial({
            color: rec.style.color || 0x38bdf8,
            transparent: true,
            opacity: 0.72,
          });
          group.add(new THREE.Mesh(tubeGeo, tubeMat));
        }
      } else if (g.type === "Point") {
        const [lon, lat] = toLngLat(g.coordinates);
        const elev = (this.demSampler.sampleElevation([lon, lat], true) ?? this.rtcOrigin.elevM) * this.exaggeration;
        const rtc = lonLatElevToLocalRTC(lon, lat, elev, this.rtcOrigin);
        const isBonus = feat.properties?.kind === "bonus";
        const colorHex = rec.style.color || (isBonus ? 0xfbbf24 : 0x34d399);

        const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 4.5, 8);
        const poleMat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.8 });
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(rtc.x, rtc.y + 2.25, rtc.z);

        const orbGeo = new THREE.OctahedronGeometry(0.55, 0);
        const orbMat = new THREE.MeshBasicMaterial({ color: colorHex, wireframe: true });
        const orb = new THREE.Mesh(orbGeo, orbMat);
        orb.position.set(rtc.x, rtc.y + 5.1, rtc.z);
        orb.userData.stopFeature = feat;

        group.add(pole, orb);
      }
    }

    this._overlayGroup.add(group);
  }

  sampleElevation(lonLat) {
    return this.demSampler.sampleElevation(lonLat, false);
  }

  sampleElevationProfile(coords) {
    return this.demSampler.sampleProfile(coords);
  }

  getActiveAttributions() {
    return [
      {
        id: "hirise-dtm-3d",
        label: "HiRISE DTEEC_019698 1m->5m DTM (NASA/JPL/UArizona)",
        sourceUrl:
          "https://hirise-pds.lpl.arizona.edu/PDS/DTM/ESP/ORB_019600_019699/ESP_019698_1750_ESP_019988_1750/",
        fetchDate: "2026-11-14",
      },
      ...(!this.demoSafe
        ? [
            {
              id: "hirise-ortho-25cm",
              label: "HiRISE 25 cm Orthophoto Preview (ESP_019698_1750)",
              sourceUrl: "https://hirise-pds.lpl.arizona.edu/",
              fetchDate: "2026-11-14",
            },
          ]
        : []),
    ];
  }

  _childBounds(b, qx, qy) {
    const midLon = (b.west + b.east) * 0.5;
    const midLat = (b.south + b.north) * 0.5;
    // qy: 0 = South row, 1 = North row; qx: 0 = West col, 1 = East col
    return {
      west: qx === 0 ? b.west : midLon,
      east: qx === 0 ? midLon : b.east,
      south: qy === 0 ? b.south : midLat,
      north: qy === 0 ? midLat : b.north,
    };
  }

  _buildRockField() {
    const THREE = this.THREE;
    if (!this._scene) return;
    if (this._rockFieldMesh) {
      this._scene.remove(this._rockFieldMesh);
      this._rockFieldMesh.geometry.dispose();
      this._rockFieldMesh.material.dispose();
      this._rockFieldMesh = null;
    }

    const COUNT = 520;
    const rockGeo = new THREE.DodecahedronGeometry(0.42, 0);
    // Slightly flatten & angularize base rock prototype
    const posAttr = rockGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const z = posAttr.getZ(i);
      const jitter = 0.82 + (((i * 73) % 19) / 19) * 0.36;
      posAttr.setXYZ(i, x * jitter, y * 0.62 * jitter, z * jitter);
    }
    rockGeo.computeVertexNormals();

    const rockMat = new THREE.MeshStandardMaterial({
      roughness: 0.92,
      metalness: 0.04,
      flatShading: true,
    });

    const mesh = new THREE.InstancedMesh(rockGeo, rockMat, COUNT);
    mesh.name = "MarsSurfaceRocks";
    mesh.frustumCulled = false;

    const spanLon = this.rootBounds.east - this.rootBounds.west;
    const spanLat = this.rootBounds.north - this.rootBounds.south;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    // Deterministic seeded scatter focused along central ~700m EVA corridor & flanks
    let s = 133742;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };

    const centerLon = this._camLonLat[0];
    const centerLat = this._camLonLat[1];
    let placed = 0;
    for (let i = 0; i < COUNT * 2 && placed < COUNT; i++) {
      // Concentrate 75% within ~400m corridor around EVA area, 25% wider across DTM
      const local = rand() < 0.78;
      const lon = local
        ? centerLon + (rand() - 0.5) * spanLon * 0.42
        : this.rootBounds.west + rand() * spanLon;
      const lat = local
        ? centerLat + (rand() - 0.5) * spanLat * 0.42
        : this.rootBounds.south + rand() * spanLat;
      const dStartM = marsDistanceM([lon, lat], this._camLonLat);
      if (dStartM < 4.5) continue;

      const info = this.demSampler.sampleSlopeAndNormal([lon, lat]);
      if (!info) continue;
      // More boulders near exposed outcrops & slopes
      if (info.slopeDeg < 3.5 && rand() < 0.55) continue;

      const rtc = lonLatElevToLocalRTC(
        lon,
        lat,
        info.elevM * this.exaggeration,
        this.rtcOrigin
      );
      const scaleXZ = 0.35 + Math.pow(rand(), 2.2) * 2.2;
      const scaleY = scaleXZ * (0.45 + rand() * 0.55);
      dummy.position.set(rtc.x, rtc.y - scaleY * 0.14, rtc.z);
      dummy.rotation.set(rand() * 0.5, rand() * Math.PI * 2, rand() * 0.5);
      dummy.scale.set(scaleXZ, scaleY, scaleXZ * (0.75 + rand() * 0.5));
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);

      // Tint between dark mafic basalt (#3c2d28) and dusty mudstone (#9c6142)
      const shade = rand();
      color.setRGB(
        0.24 + shade * 0.38,
        0.16 + shade * 0.22,
        0.13 + shade * 0.14
      );
      mesh.setColorAt(placed, color);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this._scene.add(mesh);
    this._rockFieldMesh = mesh;
  }

  _tileMacroUvScaleOffset(b) {
    const demW = this.rootBounds.west;
    const demE = this.rootBounds.east;
    const demS = this.rootBounds.south;
    const demN = this.rootBounds.north;
    const spanLon = demE - demW;
    const spanLat = demN - demS;
    return {
      scale: [(b.east - b.west) / spanLon, (b.north - b.south) / spanLat],
      offset: [(b.west - demW) / spanLon, (b.south - demS) / spanLat],
    };
  }

  async _ensureTileBuilt(key, bounds, level, priority = 0) {
    if (this._tileGpuCache.has(key)) return this._tileGpuCache.get(key);
    if (this._inflightTiles.has(key)) return null;

    const controller = new AbortController();
    this._inflightTiles.set(key, controller);
    this._nodeMeta.set(key, { key, bounds, level });

    try {
      const payload = await this._workerPool.buildTile(
        {
          tileKey: key,
          bounds,
          segments: level >= 2 ? 48 : 36,
          normalTexSize: level >= 2 ? 128 : 96,
          exaggeration: this.exaggeration,
          skirtDepthM: 120,
        },
        { priority, signal: controller.signal }
      );
      if (!this._mounted) return null;

      const rec = this._uploadTileToGpu(key, bounds, level, payload);
      const bytes =
        payload.positions.byteLength +
        payload.normals.byteLength +
        payload.uvs.byteLength +
        payload.indices.byteLength +
        payload.normalMapRgba.byteLength;
      this._tileGpuCache.set(key, rec, bytes);
      this._needsTileEval = true;
      return rec;
    } catch (err) {
      if (err?.name !== "AbortError") {
        this.emit("tileerror", { providerId: "hirise-dtm-3d", message: err.message, status: 0 });
      }
      return null;
    } finally {
      this._inflightTiles.delete(key);
    }
  }

  _uploadTileToGpu(key, bounds, level, payload) {
    const THREE = this.THREE;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(payload.positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(payload.normals, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(payload.uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(payload.indices, 1));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();

    const normalTex = new THREE.DataTexture(
      payload.normalMapRgba,
      payload.normalTexSize,
      payload.normalTexSize,
      THREE.RGBAFormat
    );
    normalTex.flipY = false;
    normalTex.wrapS = THREE.ClampToEdgeWrapping;
    normalTex.wrapT = THREE.ClampToEdgeWrapping;
    normalTex.minFilter = THREE.LinearFilter;
    normalTex.magFilter = THREE.LinearFilter;
    normalTex.needsUpdate = true;

    const uvMap = this._tileMacroUvScaleOffset(bounds);
    const mat = createMarsTerrainMaterial(THREE, {
      macroMap: this._activeMacroTex,
      terrainNormal: normalTex,
      dustAlbedo: this._microDetail.dustAlbedoTex,
      rockAlbedo: this._microDetail.rockAlbedoTex,
      dustDetailNormal: this._microDetail.dustNormalTex,
      rockDetailNormal: this._microDetail.rockNormalTex,
      uvScale: uvMap.scale,
      uvOffset: uvMap.offset,
      exaggeration: this.exaggeration,
      anchorElevM: this.rtcOrigin.elevM,
      mode: this.mode,
      strictSlopeDeg: this.strictSlopeDeg,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `mars_tile_${key}`;
    mesh.visible = false;
    this._terrainGroup.add(mesh);

    return {
      key,
      bounds,
      level,
      mesh,
      geometry: geo,
      material: mat,
      normalTex,
      centerRtc: payload.centerRtc,
    };
  }

  _disposeTileRecord(rec) {
    if (!rec) return;
    if (rec.mesh && this._terrainGroup) this._terrainGroup.remove(rec.mesh);
    if (rec.geometry) rec.geometry.dispose();
    if (rec.normalTex) rec.normalTex.dispose();
    if (rec.material) rec.material.dispose();
  }

  _evaluateQuadtree() {
    if (!this._camera || !this._tileGpuCache.has("0/0/0")) return;
    this._needsTileEval = false;

    const camPos = this._camera.position;
    const projScale =
      this._height / (2 * Math.tan(((this._camera.fov * Math.PI) / 180) * 0.5));
    const visibleKeys = new Set();
    const desiredKeys = new Set();

    const traverse = (key, bounds, level, col, row) => {
      desiredKeys.add(key);
      const midLon = (bounds.west + bounds.east) * 0.5;
      const midLat = (bounds.south + bounds.north) * 0.5;
      const elev = (this.demSampler.sampleElevation([midLon, midLat], true) ?? this.rtcOrigin.elevM) * this.exaggeration;
      const center = lonLatElevToLocalRTC(midLon, midLat, elev, this.rtcOrigin);
      const dist = Math.max(8, Math.hypot(center.x - camPos.x, center.y - camPos.y, center.z - camPos.z));

      const spanM = marsDistanceM([bounds.west, midLat], [bounds.east, midLat]);
      const geometricErrM = spanM * 0.015;
      const ssePx = (geometricErrM * projScale) / dist;

      const shouldSplit = level < MAX_QUADTREE_DEPTH && ssePx > TARGET_SSE_PX;
      if (shouldSplit) {
        const children = [];
        for (let qy = 0; qy < 2; qy++) {
          for (let qx = 0; qx < 2; qx++) {
            const cCol = col * 2 + qx;
            const cRow = row * 2 + qy;
            const cKey = `${level + 1}/${cCol}/${cRow}`;
            const cBounds = this._childBounds(bounds, qx, qy);
            children.push({ cKey, cBounds, cCol, cRow });
          }
        }
        const allReady = children.every((c) => this._tileGpuCache.has(c.cKey));
        if (allReady) {
          for (const c of children) {
            traverse(c.cKey, c.cBounds, level + 1, c.cCol, c.cRow);
          }
          return;
        }
        // Parent-tile fallback while streaming missing children asynchronously
        for (const c of children) {
          desiredKeys.add(c.cKey);
          if (!this._tileGpuCache.has(c.cKey)) {
            this._ensureTileBuilt(c.cKey, c.cBounds, level + 1, dist);
          }
        }
      }

      if (this._tileGpuCache.has(key)) {
        visibleKeys.add(key);
      } else {
        this._ensureTileBuilt(key, bounds, level, dist);
      }
    };

    traverse("0/0/0", this.rootBounds, 0, 0, 0);

    // Abort in-flight tiles that panned/walked out of view
    for (const [k, ctrl] of this._inflightTiles.entries()) {
      if (!desiredKeys.has(k)) {
        ctrl.abort();
        this._inflightTiles.delete(k);
      }
    }

    this._tileGpuCache.setPinnedKeys([...visibleKeys, "0/0/0"]);
    this._activeMeshList = [];
    for (const [k, entry] of this._tileGpuCache._map.entries()) {
      const show = visibleKeys.has(k);
      entry.value.mesh.visible = show;
      if (show) this._activeMeshList.push(entry.value.mesh);
    }
  }

  _startLoop() {
    const tick = (now) => {
      if (!this._mounted) return;
      this._rafId = requestAnimationFrame(tick);

      if (this._flyState) {
        const t = Math.min(1, (now - this._flyState.startTime) / this._flyState.durationMs);
        const smooth = t * t * (3 - 2 * t);
        this._camLonLat = [
          this._flyState.fromLonLat[0] +
            (this._flyState.toLonLat[0] - this._flyState.fromLonLat[0]) * smooth,
          this._flyState.fromLonLat[1] +
            (this._flyState.toLonLat[1] - this._flyState.fromLonLat[1]) * smooth,
        ];
        this._yawRad =
          this._flyState.fromYaw + (this._flyState.toYaw - this._flyState.fromYaw) * smooth;
        this._syncCameraPosition();
        if (t >= 1) this._flyState = null;
      }

      if (this._needsTileEval) {
        this._evaluateQuadtree();
      }
      this._renderer.render(this._scene, this._camera);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  resize() {
    if (!this._container || !this._renderer || !this._camera) return;
    const w = Math.max(200, this._container.clientWidth || 800);
    const h = Math.max(150, this._container.clientHeight || 500);
    this._width = w;
    this._height = h;
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(w, h);
    this._needsTileEval = true;
  }

  unmount() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
    for (const ctrl of this._inflightTiles.values()) ctrl.abort();
    this._inflightTiles.clear();
    this._tileGpuCache.clear();
    this._workerPool.dispose();
    if (this._rockFieldMesh) {
      if (this._scene) this._scene.remove(this._rockFieldMesh);
      this._rockFieldMesh.geometry.dispose();
      this._rockFieldMesh.material.dispose();
      this._rockFieldMesh = null;
    }
    if (this._renderer) {
      this._renderer.dispose();
      this._renderer = null;
    }
    if (this._container) this._container.innerHTML = "";
    super.unmount();
  }
}
