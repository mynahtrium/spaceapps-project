/**
 * Zero-dependency HiDPI HTML5 Canvas 2D Mars Tactical Map.
 *
 * Used by:
 * - LegacyMapAdapter (Strangler-Fig `?legacyMap=1` rollback path)
 * - MapLibreMarsAdapter automatic fallback when `maplibregl` or WebGL2 is unavailable offline.
 */

import { BaseMapAdapter } from "./IMapAdapter.js";
import { MARS_RADIUS_MEAN_M, marsDistanceM, toLngLat } from "./Geodesy.js";

const GALE_DEFAULT_CENTER = [137.3897, -4.8001];

export class Fallback2DMap extends BaseMapAdapter {
  /**
   * @param {object} [opts]
   * @param {import('./MarsDemSampler.js').MarsDemSampler|null} [opts.demSampler]
   * @param {boolean} [opts.demoSafe=false]
   * @param {string|null} [opts.slopePreviewUrl]
   * @param {string|null} [opts.orthoPreviewUrl]
   */
  constructor(opts = {}) {
    super(opts.adapterName || "Fallback2DMap");
    this.demSampler = opts.demSampler || null;
    this.demoSafe = Boolean(opts.demoSafe);
    this.slopePreviewUrl = opts.slopePreviewUrl || null;
    this.orthoPreviewUrl = opts.orthoPreviewUrl || null;
    this.bounds = opts.bounds || {
      west: 137.372831,
      south: -4.816946,
      east: 137.406542,
      north: -4.783236,
    };
    this.center = [...GALE_DEFAULT_CENTER];
    this.zoom = 14.2;
    this.pitch = 0;
    this.bearing = 0;
    this.exaggeration = 1.0;

    /** @type {Map<string, { fc: object, style: object, visible: boolean }>} */
    this.layers = new Map();
    /** @type {Map<string, { img: HTMLImageElement, visible: boolean }>} */
    this.rasterOverlays = new Map();
    this._activeImagery = "hirise-slope";
    this._canvas = null;
    this._ctx = null;
    this._container = null;
    this._dragging = false;
    this._dragMoved = false;
    this._lastPt = null;
    this._ro = null;
    this._attributions = [
      {
        id: "hirise-dtm-local",
        label: "HiRISE DTM DTEEC_019698 (NASA/JPL/UArizona, local processed grid)",
        sourceUrl: "https://hirise-pds.lpl.arizona.edu/",
        fetchDate: "2026-11-14",
      },
    ];
  }

  async mount(container, options = {}) {
    this._container = container;
    if (options.center) this.center = toLngLat(options.center);
    if (typeof options.zoom === "number") this.zoom = options.zoom;
    if (options.demSampler) this.demSampler = options.demSampler;

    container.innerHTML = "";
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.cursor = "grab";
    canvas.setAttribute("aria-label", "Mars Gale Crater 2D fallback map");
    container.appendChild(canvas);

    this._canvas = canvas;
    this._ctx = canvas.getContext("2d");
    this._mounted = true;

    this._loadOverlayImage("slope-preview", this.slopePreviewUrl, true);
    if (this.orthoPreviewUrl) {
      this._loadOverlayImage("hirise-ortho", this.orthoPreviewUrl, false);
    }

    this._bindEvents(canvas);
    this.resize();
    this.emit("attributionchange", this.getActiveAttributions());
    return this;
  }

  _loadOverlayImage(id, url, visible) {
    if (!url || typeof Image === "undefined") return;
    const img = new Image();
    img.onload = () => {
      this.rasterOverlays.set(id, { img, visible });
      this._render();
    };
    img.onerror = () => {
      this.emit("tileerror", { providerId: id, message: `Failed to load ${url}`, status: 0 });
    };
    img.src = url;
  }

  _bindEvents(canvas) {
    canvas.addEventListener("pointerdown", (e) => {
      this._dragging = true;
      this._dragMoved = false;
      this._lastPt = [e.clientX, e.clientY];
      canvas.style.cursor = "grabbing";
    });
    window.addEventListener("pointermove", (e) => {
      if (this._dragging && this._lastPt) {
        const dx = e.clientX - this._lastPt[0];
        const dy = e.clientY - this._lastPt[1];
        if (Math.abs(dx) + Math.abs(dy) > 2) this._dragMoved = true;
        this._lastPt = [e.clientX, e.clientY];
        const scale = this._degPerPixel();
        this.center = [this.center[0] - dx * scale.lon, this.center[1] + dy * scale.lat];
        this._render();
        this.emit("viewchange", this.getView());
      } else if (this._mounted && e.target === canvas) {
        const rect = canvas.getBoundingClientRect();
        const lonLat = this.unproject([e.clientX - rect.left, e.clientY - rect.top]);
        if (lonLat) {
          const info = this.demSampler ? this.demSampler.sampleSlopeAndNormal(lonLat) : null;
          this.emit("hover", {
            lon: lonLat[0],
            lat: lonLat[1],
            elevM: info ? info.elevM : null,
            slopeDeg: info ? info.slopeDeg : null,
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
          });
        }
      }
    });
    window.addEventListener("pointerup", () => {
      if (this._dragging) {
        this._dragging = false;
        canvas.style.cursor = "grab";
      }
    });
    canvas.addEventListener("click", (e) => {
      if (this._dragMoved) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const lonLat = this.unproject([x, y]);
      if (!lonLat) return;
      const info = this.demSampler ? this.demSampler.sampleSlopeAndNormal(lonLat) : null;
      this.emit("click", {
        lon: lonLat[0],
        lat: lonLat[1],
        lngLat: { lng: lonLat[0], lat: lonLat[1] },
        elevM: info ? info.elevM : null,
        slopeDeg: info ? info.slopeDeg : null,
        x,
        y,
      });
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.zoom = Math.max(10, Math.min(19, this.zoom - Math.sign(e.deltaY) * 0.45));
        this._render();
        this.emit("viewchange", this.getView());
      },
      { passive: false }
    );
    if (typeof ResizeObserver !== "undefined" && this._container) {
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(this._container);
    }
  }

  unmount() {
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
    if (this._container) this._container.innerHTML = "";
    super.unmount();
  }

  resize() {
    if (!this._canvas || !this._container) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(120, this._container.clientWidth || 300);
    const h = Math.max(120, this._container.clientHeight || 200);
    this._canvas.width = Math.round(w * dpr);
    this._canvas.height = Math.round(h * dpr);
    if (this._ctx) this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._cssWidth = w;
    this._cssHeight = h;
    this._render();
  }

  _degPerPixel() {
    const lonSpanBase = 0.036 / 2 ** (this.zoom - 14);
    const px = Math.max(200, this._cssWidth || 320);
    const lon = lonSpanBase / px;
    const lat = lon / Math.max(0.2, Math.cos((this.center[1] * Math.PI) / 180));
    return { lon, lat };
  }

  setView(view = {}) {
    if (view.center) this.center = toLngLat(view.center);
    if (typeof view.zoom === "number") this.zoom = view.zoom;
    if (typeof view.pitch === "number") this.pitch = view.pitch;
    if (typeof view.bearing === "number") this.bearing = view.bearing;
    this._render();
    this.emit("viewchange", this.getView());
  }

  flyTo(view = {}) {
    this.setView(view);
  }

  getView() {
    return {
      center: [...this.center],
      zoom: this.zoom,
      pitch: this.pitch,
      bearing: this.bearing,
    };
  }

  getBounds() {
    const w = this._cssWidth || 320;
    const h = this._cssHeight || 220;
    const tl = this.unproject([0, 0]);
    const br = this.unproject([w, h]);
    return { west: tl[0], south: br[1], east: br[0], north: tl[1] };
  }

  project(lonLat) {
    const [lon, lat] = toLngLat(lonLat);
    const w = this._cssWidth || 320;
    const h = this._cssHeight || 220;
    const scale = this._degPerPixel();
    return [
      w / 2 + (lon - this.center[0]) / scale.lon,
      h / 2 - (lat - this.center[1]) / scale.lat,
    ];
  }

  unproject(screenXY) {
    const w = this._cssWidth || 320;
    const h = this._cssHeight || 220;
    const scale = this._degPerPixel();
    return [
      this.center[0] + (screenXY[0] - w / 2) * scale.lon,
      this.center[1] - (screenXY[1] - h / 2) * scale.lat,
    ];
  }

  setTerrainSource(_providerId) {}

  setImageryProvider(providerId) {
    this._activeImagery = providerId;
    this._render();
  }

  setTerrainExaggeration(factor) {
    this.exaggeration = Number(factor) || 1;
  }

  addGeoJsonLayer(id, fc, style = {}) {
    this.layers.set(id, { fc, style, visible: style.visible !== false });
    this._render();
  }

  updateGeoJsonLayer(id, fc) {
    const entry = this.layers.get(id);
    if (entry) {
      entry.fc = fc;
      this._render();
    } else {
      this.addGeoJsonLayer(id, fc, {});
    }
  }

  removeLayer(id) {
    this.layers.delete(id);
    this._render();
  }

  setLayerVisibility(id, visible) {
    const ov = this.rasterOverlays.get(id);
    if (ov) ov.visible = Boolean(visible);
    const vec = this.layers.get(id);
    if (vec) vec.visible = Boolean(visible);
    this._render();
  }

  sampleElevation(lonLat) {
    return this.demSampler ? this.demSampler.sampleElevation(lonLat, false) : null;
  }

  sampleElevationProfile(coords) {
    return this.demSampler ? this.demSampler.sampleProfile(coords) : [];
  }

  getActiveAttributions() {
    return [...this._attributions];
  }

  _render() {
    const ctx = this._ctx;
    if (!ctx) return;
    const w = this._cssWidth || 320;
    const h = this._cssHeight || 220;

    // Martian regolith background
    ctx.fillStyle = "#19110d";
    ctx.fillRect(0, 0, w, h);

    // Draw georeferenced HiRISE raster overlays
    const [bx0, by0] = this.project([this.bounds.west, this.bounds.north]);
    const [bx1, by1] = this.project([this.bounds.east, this.bounds.south]);
    for (const [id, ov] of this.rasterOverlays.entries()) {
      if (!ov.visible || !ov.img) continue;
      ctx.save();
      ctx.globalAlpha = id === "slope-preview" ? 0.72 : 0.88;
      ctx.drawImage(ov.img, bx0, by0, bx1 - bx0, by1 - by0);
      ctx.restore();
    }

    // Subtle lat/lon graticule
    ctx.strokeStyle = "rgba(255, 210, 170, 0.12)";
    ctx.lineWidth = 1;
    for (let lon = 137.36; lon <= 137.42; lon += 0.01) {
      const [px] = this.project([lon, this.center[1]]);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
    for (let lat = -4.83; lat <= -4.77; lat += 0.01) {
      const [, py] = this.project([this.center[0], lat]);
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
      ctx.stroke();
    }

    // GeoJSON vector overlays
    for (const [id, layer] of this.layers.entries()) {
      if (!layer.visible || !layer.fc || !Array.isArray(layer.fc.features)) continue;
      for (const feat of layer.fc.features) {
        const g = feat.geometry;
        if (!g) continue;
        if (g.type === "LineString") {
          ctx.beginPath();
          g.coordinates.forEach((pt, idx) => {
            const [px, py] = this.project(pt);
            if (idx === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.strokeStyle = layer.style.color || "#38bdf8";
          ctx.lineWidth = layer.style.width || 3;
          ctx.stroke();
        } else if (g.type === "Point") {
          const [px, py] = this.project(g.coordinates);
          ctx.beginPath();
          ctx.arc(px, py, layer.style.radius || 5, 0, Math.PI * 2);
          ctx.fillStyle =
            id === "astronaut-pos"
              ? "#22d3ee"
              : layer.style.color || (feat.properties?.kind === "bonus" ? "#fbbf24" : "#34d399");
          ctx.fill();
          ctx.strokeStyle = "#0b0f17";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          if (feat.properties?.name || feat.properties?.id) {
            ctx.fillStyle = "#f8fafc";
            ctx.font = "10px monospace";
            ctx.fillText(feat.properties.id || feat.properties.name, px + 7, py + 3);
          }
        }
      }
    }

    // Mars scale bar (bottom-left)
    const leftLon = this.unproject([14, h - 18]);
    const rightLon = this.unproject([94, h - 18]);
    const barM = Math.round(marsDistanceM(leftLon, rightLon, MARS_RADIUS_MEAN_M));
    ctx.fillStyle = "rgba(10, 15, 24, 0.72)";
    ctx.fillRect(10, h - 26, 92, 18);
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(14, h - 12);
    ctx.lineTo(94, h - 12);
    ctx.stroke();
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "10px monospace";
    ctx.fillText(`${barM} m (Mars)`, 16, h - 15);
  }
}
