/**
 * High-Resolution Mars 2D / 2.5D Tactical MapLibre Adapter (`MapLibreMarsAdapter`).
 *
 * Implements `IMapAdapter`:
 * - Custom `mars-eq://` protocol reprojecting Mars Trek / OnMars Equirectangular tiles
 *   scanline-by-scanline into Web Mercator `EPSG:3857` PNGs with zero tile-boundary seams.
 * - Custom `mars-dem://` Terrarium RGB protocol rasterizing HiRISE DTEEC_019698 elevation
 *   into 256x256 Terrarium PNGs for live MapLibre 2.5D/3D `raster-dem` hillshade + terrain.
 * - Cascading fallback via `TileSourceRegistry` + synthetic Mars hillshade tiles when offline/`?demo=1`.
 * - Seamless degradation to `Fallback2DMap` (zero-dep Canvas 2D) if MapLibre or WebGL is missing.
 */

import { BaseMapAdapter } from "./IMapAdapter.js";
import { Fallback2DMap } from "./Fallback2DMap.js";
import {
  clampLatDeg,
  lonLatToMarsEquirectTile,
  mercatorNormalizedToLonLat,
  mercatorZoomToMarsEquirectZoom,
  normalizeLonDeg,
  tileToLonLatBounds,
  toLngLat,
} from "./Geodesy.js";

const protocolsRegistered = new Set();

function blobFromRgba(rgba, width, height) {
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(width, height);
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(width, height);
    img.data.set(rgba);
    ctx.putImageData(img, 0, 0);
    return c.convertToBlob({ type: "image/png" });
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(width, height);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
  return new Promise((resolve) => c.toBlob(resolve, "image/png"));
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

async function canvasToArrayBuffer(canvas) {
  if (typeof canvas.convertToBlob === "function") {
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return blob.arrayBuffer();
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob.arrayBuffer();
}

/**
 * Shared state for custom MapLibre protocols (`mars-eq://` and `mars-dem://`)
 * pointing to the currently active adapter's registry and DEM sampler.
 */
const activeProtocolContext = {
  registry: null,
  demSampler: null,
};

const demTileCache = new Map();
let transparentTileBytesPromise = null;

function getTransparentTileBytes() {
  if (!transparentTileBytesPromise) {
    transparentTileBytesPromise = blobFromRgba(new Uint8ClampedArray([0, 0, 0, 0]), 1, 1).then((b) =>
      b.arrayBuffer()
    );
  }
  return transparentTileBytesPromise;
}

function ensureProtocolsRegistered(maplibregl) {
  if (!maplibregl || typeof maplibregl.addProtocol !== "function") return;

  if (!protocolsRegistered.has("mars-dem")) {
    protocolsRegistered.add("mars-dem");
    maplibregl.addProtocol("mars-dem", async (params) => {
      const m = /mars-dem:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
      if (!m || !activeProtocolContext.demSampler) {
        return { data: (await getTransparentTileBytes()).slice(0) };
      }
      const z = Number(m[1]);
      const x = Number(m[2]);
      const y = Number(m[3]);
      const key = `${z}:${x}:${y}`;
      let bytes = demTileCache.get(key);
      if (!bytes) {
        // MapLibre's 3D terrain renders black when the ground sits ~3.6 km below datum (the camera and
        // depth range assume heights near zero). Encode heights above the local minimum instead: the
        // relief and hillshade are unchanged; true elevations for the UI still come from the sampler.
        const sampler = activeProtocolContext.demSampler;
        const base = Number.isFinite(sampler.minElevM) ? Math.floor(sampler.minElevM) - 20 : 0;
        const rgba = sampler.rasterizeTerrariumTileRGBA(z, x, y, 256, base);
        const blob = await blobFromRgba(rgba, 256, 256);
        bytes = await blob.arrayBuffer();
        if (demTileCache.size > 96) {
          const oldest = demTileCache.keys().next().value;
          demTileCache.delete(oldest);
        }
        demTileCache.set(key, bytes);
      }
      return { data: bytes.slice(0) };
    });
  }

  if (!protocolsRegistered.has("mars-eq")) {
    protocolsRegistered.add("mars-eq");
    maplibregl.addProtocol("mars-eq", async (params, abortController) => {
      const m = /mars-eq:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
      if (!m || !activeProtocolContext.registry) {
        return { data: (await getTransparentTileBytes()).slice(0) };
      }
      const layerId = m[1];
      const z = Number(m[2]);
      const x = Number(m[3]);
      const y = Number(m[4]);
      const reg = activeProtocolContext.registry;
      const dem = activeProtocolContext.demSampler;

      const chain =
        layerId === "themis-night"
          ? ["themis-night", "themis-day"]
          : layerId === "themis-day"
            ? ["themis-day"]
            : layerId === "mola-color"
              ? ["mola-color"]
              : reg.getImageryCascade(layerId);

      const bounds = tileToLonLatBounds(z, x, y);
      const eqZ = mercatorZoomToMarsEquirectZoom(z, 9);
      const nCols = 2 ** (eqZ + 1);
      const nRows = 2 ** eqZ;

      const tlTile = lonLatToMarsEquirectTile(bounds.west, bounds.north, eqZ);
      const brTile = lonLatToMarsEquirectTile(
        bounds.east - 1e-6,
        clampLatDeg(bounds.south),
        eqZ
      );

      const rowStart = Math.max(0, Math.min(tlTile.row, brTile.row));
      const rowEnd = Math.min(nRows - 1, Math.max(tlTile.row, brTile.row));
      const colSpan = brTile.col >= tlTile.col ? brTile.col - tlTile.col : brTile.col + nCols - tlTile.col;

      // Collect unique equirectangular (col, row) tiles intersecting this Mercator tile
      const seenTiles = new Set();
      const tileCoords = [];
      for (let r = rowStart; r <= rowEnd; r++) {
        for (let dc = 0; dc <= colSpan; dc++) {
          const col = (((tlTile.col + dc) % nCols) + nCols) % nCols;
          const k = `${col}:${r}`;
          if (!seenTiles.has(k)) {
            seenTiles.add(k);
            tileCoords.push({ col, row: r });
          }
        }
      }

      try {
        const fetchedTiles = new Map();
        await Promise.all(
          tileCoords.map(async ({ col, row }) => {
            const res = await reg.fetchWithCascade(chain, {
              eqZ,
              col,
              row,
              signal: abortController.signal,
              responseType: "blob",
            });
            const bitmap = await createImageBitmap(
              res.data instanceof Blob ? res.data : new Blob([res.data])
            );
            fetchedTiles.set(`${col}:${row}`, {
              bitmap,
              actualZ: res.eqZ,
              actualCol: res.col,
              actualRow: res.row,
            });
          })
        );

        const size = 256;
        const canvas = makeCanvas(size, size);
        const ctx = canvas.getContext("2d");

        // Exact Mercator -> Equirectangular scanline reprojection
        const nMerc = 2 ** z;
        for (let py = 0; py < size; py++) {
          const ny = (y + (py + 0.5) / size) / nMerc;
          const [, lat] = mercatorNormalizedToLonLat(x / nMerc, ny);
          const rowExact = ((90 - lat) / 180) * nRows;
          const reqRow = Math.max(0, Math.min(nRows - 1, Math.floor(rowExact)));

          for (let dc = 0; dc <= colSpan; dc++) {
            const colNorm = (((tlTile.col + dc) % nCols) + nCols) % nCols;
            const rec = fetchedTiles.get(`${colNorm}:${reqRow}`);
            if (!rec) continue;

            const { bitmap, actualZ, actualCol, actualRow } = rec;
            const actCols = 2 ** (actualZ + 1);
            const actRows = 2 ** actualZ;
            const tileLonW = -180 + (actualCol / actCols) * 360;
            const tileLonE = -180 + ((actualCol + 1) / actCols) * 360;
            const tileLatN = 90 - (actualRow / actRows) * 180;
            const tileLatS = 90 - ((actualRow + 1) / actRows) * 180;

            const spanLonW = Math.max(bounds.west, tileLonW);
            const spanLonE = Math.min(bounds.east, tileLonE);
            if (spanLonE <= spanLonW) continue;

            const dstX0 = ((spanLonW - bounds.west) / (bounds.east - bounds.west)) * size;
            const dstX1 = ((spanLonE - bounds.west) / (bounds.east - bounds.west)) * size;
            const rawSrcX0 = ((spanLonW - tileLonW) / (tileLonE - tileLonW)) * bitmap.width;
            const rawSrcX1 = ((spanLonE - tileLonW) / (tileLonE - tileLonW)) * bitmap.width;
            const srcX0 = Math.max(0, Math.min(bitmap.width - 0.01, rawSrcX0));
            const srcW = Math.max(0.01, Math.min(bitmap.width - srcX0, rawSrcX1 - srcX0));
            const srcY = Math.max(
              0,
              Math.min(
                bitmap.height - 1,
                Math.floor(((tileLatN - lat) / (tileLatN - tileLatS)) * bitmap.height)
              )
            );

            ctx.drawImage(
              bitmap,
              srcX0,
              srcY,
              srcW,
              1,
              dstX0,
              py,
              Math.max(1, dstX1 - dstX0),
              1
            );
          }
        }

        for (const rec of fetchedTiles.values()) rec.bitmap.close?.();
        const data = await canvasToArrayBuffer(canvas);
        return { data };
      } catch (err) {
        if (err?.name === "AbortError") throw err;
        // Offline / ?demo=1 fallback for MOLA color: render hypsometric elevation ramp from local DEM
        if (layerId === "mola-color" && dem) {
          const rgba = renderMolaColorTileRgba(dem, z, x, y, 256);
          const blob = await blobFromRgba(rgba, 256, 256);
          return { data: await blob.arrayBuffer() };
        }
        // Overlay layers outside cached/offline coverage stay transparent rather than obscuring basemap
        if (layerId === "themis-day" || layerId === "themis-night" || layerId === "mola-color") {
          return { data: (await getTransparentTileBytes()).slice(0) };
        }
        // Fallback: generate procedural Martian DEM shaded tile so offline/?demo=1 shows topography smoothly
        if (dem) {
          const rgba = renderShadedReliefTileRgba(dem, z, x, y, 256);
          const blob = await blobFromRgba(rgba, 256, 256);
          return { data: await blob.arrayBuffer() };
        }
        return { data: (await getTransparentTileBytes()).slice(0) };
      }
    });
  }
}

/**
 * Render an offline Mars shaded-relief RGBA tile directly from the local DEM sampler.
 */
function renderShadedReliefTileRgba(dem, z, x, y, size = 256) {
  const rgba = new Uint8ClampedArray(size * size * 4);
  const n = 2 ** z;
  const tx0 = x / n;
  const ty0 = y / n;
  const txSpan = 1 / n;

  for (let py = 0; py < size; py++) {
    const ny = ty0 + ((py + 0.5) / size) * txSpan;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * ny))) * 180) / Math.PI;
    for (let px = 0; px < size; px++) {
      const nx = tx0 + ((px + 0.5) / size) * txSpan;
      const lon = normalizeLonDeg(nx * 360 - 180);
      const inside =
        lon >= dem.bounds.west_lon_deg &&
        lon <= dem.bounds.east_lon_deg &&
        lat >= dem.bounds.south_lat_deg &&
        lat <= dem.bounds.north_lat_deg;
      const idx = (py * size + px) * 4;
      if (!inside) {
        rgba[idx] = 32;
        rgba[idx + 1] = 21;
        rgba[idx + 2] = 17;
        rgba[idx + 3] = 255;
        continue;
      }
      const info = dem.sampleSlopeAndNormal([lon, lat]);
      if (!info) {
        rgba[idx] = 44;
        rgba[idx + 1] = 28;
        rgba[idx + 2] = 22;
        rgba[idx + 3] = 255;
        continue;
      }
      // High-contrast Mars afternoon hillshade + 20m stratigraphic contour lines
      const dot = Math.max(0.18, Math.min(1.35, info.normal.x * 0.62 + info.normal.y * 0.42 + info.normal.z * -0.66));
      const tElev = Math.max(0, Math.min(1, (info.elevM + 3850.6) / 481.3));
      const contourDist = Math.abs((((info.elevM % 20) + 20) % 20) - 10);
      const contourBoost = contourDist > 9.1 ? 0.82 : 1.0;
      const speck = (((px * 73 + py * 139) ^ (px * py)) & 7) - 3;
      rgba[idx] = Math.min(255, Math.max(12, Math.round((128 + tElev * 64 + speck * 1.5) * dot * contourBoost)));
      rgba[idx + 1] = Math.min(255, Math.max(10, Math.round((78 + tElev * 40 + speck) * dot * contourBoost)));
      rgba[idx + 2] = Math.min(255, Math.max(8, Math.round((54 + tElev * 26 + speck * 0.8) * dot * contourBoost)));
      rgba[idx + 3] = 255;
    }
  }
  return rgba;
}

/**
 * Render an offline MOLA-style hypsometric color ramp overlay from the local Gale DEM.
 */
function renderMolaColorTileRgba(dem, z, x, y, size = 256) {
  const rgba = new Uint8ClampedArray(size * size * 4);
  const n = 2 ** z;
  const tx0 = x / n;
  const ty0 = y / n;
  const txSpan = 1 / n;
  const stops = [
    [0.0, 42, 62, 168],
    [0.25, 34, 152, 198],
    [0.5, 92, 188, 92],
    [0.75, 232, 168, 48],
    [1.0, 224, 72, 48],
  ];

  for (let py = 0; py < size; py++) {
    const ny = ty0 + ((py + 0.5) / size) * txSpan;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * ny))) * 180) / Math.PI;
    for (let px = 0; px < size; px++) {
      const nx = tx0 + ((px + 0.5) / size) * txSpan;
      const lon = normalizeLonDeg(nx * 360 - 180);
      const info = dem.sampleSlopeAndNormal([lon, lat]);
      const idx = (py * size + px) * 4;
      if (!info) {
        rgba[idx + 3] = 0;
        continue;
      }
      const t = Math.max(0, Math.min(1, (info.elevM + 3850.6) / 481.3));
      let s0 = stops[0];
      let s1 = stops[stops.length - 1];
      for (let i = 0; i < stops.length - 1; i++) {
        if (t >= stops[i][0] && t <= stops[i + 1][0]) {
          s0 = stops[i];
          s1 = stops[i + 1];
          break;
        }
      }
      const frac = s1[0] > s0[0] ? (t - s0[0]) / (s1[0] - s0[0]) : 0;
      const shade = Math.max(0.55, Math.min(1.25, 0.72 + info.normal.x * 0.35 + info.normal.z * -0.35));
      rgba[idx] = Math.min(255, Math.round((s0[1] + (s1[1] - s0[1]) * frac) * shade));
      rgba[idx + 1] = Math.min(255, Math.round((s0[2] + (s1[2] - s0[2]) * frac) * shade));
      rgba[idx + 2] = Math.min(255, Math.round((s0[3] + (s1[3] - s0[3]) * frac) * shade));
      rgba[idx + 3] = 225;
    }
  }
  return rgba;
}

export class MapLibreMarsAdapter extends BaseMapAdapter {
  /**
   * @param {object} opts
   * @param {import('./MarsDemSampler.js').MarsDemSampler} opts.demSampler
   * @param {import('./TileSourceRegistry.js').TileSourceRegistry} opts.registry
   * @param {boolean} [opts.demoSafe=false]
   * @param {string|null} [opts.orthoPreviewUrl]
   * @param {string|null} [opts.slopePreviewUrl]
   */
  constructor(opts) {
    super("MapLibreMarsAdapter");
    this.demSampler = opts.demSampler;
    this.registry = opts.registry;
    this.demoSafe = Boolean(opts.demoSafe);
    this.orthoPreviewUrl = opts.orthoPreviewUrl || null; // demo-safe URLs already point at data/demo/
    this.slopePreviewUrl = opts.slopePreviewUrl || null;

    this.map = null;
    this._fallback = null;
    this._container = null;
    this._geoLayers = new Map();
    this._visibility = new Map();
    this._terrainExaggeration = 1.3;
    this._terrain3dEnabled = false;
    this._styleLoaded = false;
    this._pendingOps = [];
  }

  async mount(container, options = {}) {
    this._container = container;
    activeProtocolContext.registry = this.registry;
    activeProtocolContext.demSampler = this.demSampler;

    const maplibregl = typeof window !== "undefined" ? window.maplibregl : null;
    if (!maplibregl) {
      return this._mountFallback(container, options);
    }

    ensureProtocolsRegistered(maplibregl);

    const b = this.demSampler.bounds;
    const center = options.center
      ? toLngLat(options.center)
      : [(b.west_lon_deg + b.east_lon_deg) * 0.5, (b.south_lat_deg + b.north_lat_deg) * 0.5];

    const imgCoords = [
      [b.west_lon_deg, b.north_lat_deg],
      [b.east_lon_deg, b.north_lat_deg],
      [b.east_lon_deg, b.south_lat_deg],
      [b.west_lon_deg, b.south_lat_deg],
    ];

    try {
      const styleSources = {
        "mars-dem": {
          type: "raster-dem",
          tiles: ["mars-dem://{z}/{x}/{y}"],
          tileSize: 256,
          encoding: "terrarium",
          maxzoom: 15,
        },
        "mars-terrain-dem": {
          type: "raster-dem",
          tiles: ["mars-dem://{z}/{x}/{y}"],
          tileSize: 256,
          encoding: "terrarium",
          maxzoom: 15,
        },
        "onmars-ctx": {
          type: "raster",
          tiles: ["mars-eq://trek-ctx/{z}/{x}/{y}"],
          tileSize: 256,
          maxzoom: 16,
        },
        "themis-day": {
          type: "raster",
          tiles: ["mars-eq://themis-day/{z}/{x}/{y}"],
          tileSize: 256,
          maxzoom: 14,
        },
        "themis-night": {
          type: "raster",
          tiles: ["mars-eq://themis-night/{z}/{x}/{y}"],
          tileSize: 256,
          maxzoom: 14,
        },
        "mola-color": {
          type: "raster",
          tiles: ["mars-eq://mola-color/{z}/{x}/{y}"],
          tileSize: 256,
          maxzoom: 12,
        },
      };

      const styleLayers = [
        { id: "bg", type: "background", paint: { "background-color": "#19110d" } },
        {
          id: "onmars-ctx",
          type: "raster",
          source: "onmars-ctx",
          layout: { visibility: "visible" },
          paint: { "raster-opacity": 0.92 },
        },
        {
          id: "mars-hillshade",
          type: "hillshade",
          source: "mars-dem",
          paint: {
            "hillshade-shadow-color": "#160a06",
            "hillshade-highlight-color": "#f6c9a5",
            "hillshade-accent-color": "#b45309",
            "hillshade-exaggeration": 0.65,
            "hillshade-illumination-direction": 315,
          },
        },
      ];

      if (this.orthoPreviewUrl) {
        styleSources["hirise-ortho"] = {
          type: "image",
          url: this.orthoPreviewUrl,
          coordinates: imgCoords,
        };
        styleLayers.push({
          id: "hirise-ortho",
          type: "raster",
          source: "hirise-ortho",
          layout: { visibility: "visible" },
          paint: { "raster-opacity": 0.8 },
        });
      }

      // Spectral/thermal & regional elevation overlays sit above ortho so toggles are immediately visible
      styleLayers.push(
        {
          id: "mola-color",
          type: "raster",
          source: "mola-color",
          layout: { visibility: "none" },
          paint: { "raster-opacity": 0.62 },
        },
        {
          id: "themis-day",
          type: "raster",
          source: "themis-day",
          layout: { visibility: "none" },
          paint: { "raster-opacity": 0.62 },
        },
        {
          id: "themis-night",
          type: "raster",
          source: "themis-night",
          layout: { visibility: "none" },
          paint: { "raster-opacity": 0.62 },
        }
      );

      if (this.slopePreviewUrl) {
        styleSources["slope-preview"] = {
          type: "image",
          url: this.slopePreviewUrl,
          coordinates: imgCoords,
        };
        styleLayers.push({
          id: "slope-preview",
          type: "raster",
          source: "slope-preview",
          layout: { visibility: "visible" },
          paint: { "raster-opacity": 0.36 },
        });
      }

      const wantsTerrain3d = Boolean(options.terrain3d ?? true);
      this._terrain3dEnabled = wantsTerrain3d;

      const map = new maplibregl.Map({
        container,
        center,
        zoom: options.zoom ?? 14.3,
        pitch: options.pitch ?? (wantsTerrain3d ? 52 : 0),
        bearing: options.bearing ?? (wantsTerrain3d ? -14 : 0),
        maxPitch: 85,
        doubleClickZoom: false,
        attributionControl: false,
        style: {
          version: 8,
          sources: styleSources,
          layers: styleLayers,
          ...(wantsTerrain3d
            ? {
                terrain: {
                  source: "mars-terrain-dem",
                  exaggeration: this._terrainExaggeration,
                },
              }
            : {}),
        },
      });
      if (typeof maplibregl.NavigationControl === "function") {
        map.addControl(
          new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true, showZoom: true }),
          "top-left"
        );
      }

      this.map = map;

      await new Promise((resolve) => {
        const onReady = () => {
          this._styleLoaded = true;
          this._flushPendingOps();
          resolve();
        };
        if (map.isStyleLoaded()) onReady();
        else map.once("load", onReady);
        map.once("error", (e) => {
          if (!this._styleLoaded) {
            this.emit("tileerror", {
              providerId: "maplibre",
              message: e?.error?.message || "MapLibre load issue",
              status: 0,
            });
          }
        });
      });

      map.on("move", () => this.emit("viewchange", this.getView()));
      map.on("click", (e) => {
        const lonLat = [e.lngLat.lng, e.lngLat.lat];
        const info = this.demSampler.sampleSlopeAndNormal(lonLat);
        this.emit("click", {
          lon: lonLat[0],
          lat: lonLat[1],
          lngLat: e.lngLat,
          elevM: info ? info.elevM : null,
          slopeDeg: info ? info.slopeDeg : null,
          x: e.point.x,
          y: e.point.y,
        });
      });
      map.on("dblclick", (e) => {
        e.preventDefault?.();
        const lonLat = [e.lngLat.lng, e.lngLat.lat];
        const info = this.demSampler.sampleSlopeAndNormal(lonLat);
        this.emit("dblclick", {
          lon: lonLat[0],
          lat: lonLat[1],
          lngLat: e.lngLat,
          elevM: info ? info.elevM : null,
          slopeDeg: info ? info.slopeDeg : null,
          x: e.point.x,
          y: e.point.y,
        });
      });
      map.on("mousemove", (e) => {
        const lonLat = [e.lngLat.lng, e.lngLat.lat];
        const info = this.demSampler.sampleSlopeAndNormal(lonLat);
        this.emit("hover", {
          lon: lonLat[0],
          lat: lonLat[1],
          elevM: info ? info.elevM : null,
          slopeDeg: info ? info.slopeDeg : null,
          x: e.point.x,
          y: e.point.y,
        });
      });

      this.registry.onAttributionChange((list) => this.emit("attributionchange", list));
      this.emit("attributionchange", this.getActiveAttributions());
      this._mounted = true;
      return this;
    } catch (err) {
      console.warn("[MapLibreMarsAdapter] Falling back to 2D Canvas:", err);
      return this._mountFallback(container, options);
    }
  }

  async _mountFallback(container, options) {
    this._fallback = new Fallback2DMap({
      demSampler: this.demSampler,
      demoSafe: this.demoSafe,
      orthoPreviewUrl: this.orthoPreviewUrl,
      slopePreviewUrl: this.slopePreviewUrl,
      adapterName: "Fallback2DMap",
    });
    this._fallback.on("viewchange", (v) => this.emit("viewchange", v));
    this._fallback.on("click", (e) => this.emit("click", e));
    this._fallback.on("dblclick", (e) => this.emit("dblclick", e));
    this._fallback.on("hover", (e) => this.emit("hover", e));
    this._fallback.on("attributionchange", (a) => this.emit("attributionchange", a));
    await this._fallback.mount(container, options);
    this._mounted = true;
    return this;
  }

  _runOrQueue(fn) {
    if (this._fallback) {
      fn();
      return;
    }
    if (this.map && this._styleLoaded) fn();
    else this._pendingOps.push(fn);
  }

  _flushPendingOps() {
    while (this._pendingOps.length > 0) {
      const fn = this._pendingOps.shift();
      try {
        fn();
      } catch (err) {
        console.warn("[MapLibreMarsAdapter] deferred op error:", err);
      }
    }
  }

  setTerrain3D(enabled) {
    this._terrain3dEnabled = Boolean(enabled);
    if (!this.map || this._fallback) return;
    this._runOrQueue(() => {
      if (this._terrain3dEnabled) {
        this.map.setTerrain({
          source: "mars-terrain-dem",
          exaggeration: this._terrainExaggeration,
        });
        if (this.map.getPitch() < 30) {
          this.map.easeTo({ pitch: 52, duration: 450 });
        }
      } else {
        this.map.setTerrain(null);
        if (this.map.getPitch() > 5) {
          this.map.easeTo({ pitch: 0, duration: 350 });
        }
      }
    });
  }

  setTerrainExaggeration(factor) {
    this._terrainExaggeration = Math.max(0.5, Math.min(4.0, Number(factor) || 1.0));
    if (this._terrain3dEnabled) this.setTerrain3D(true);
  }

  setImageryProvider(providerId) {
    if (this._fallback) {
      this._fallback.setImageryProvider(providerId);
      return;
    }
    const basemaps = ["onmars-ctx", "themis-day", "themis-night", "mola-color"];
    for (const id of basemaps) {
      this.setLayerVisibility(id, id === providerId);
    }
  }

  resize() {
    if (this._fallback) this._fallback.resize();
    else if (this.map) this.map.resize();
  }

  setView(view = {}) {
    if (this._fallback) {
      this._fallback.setView(view);
      return;
    }
    if (!this.map) return;
    this.map.jumpTo({
      center: view.center ? toLngLat(view.center) : undefined,
      zoom: view.zoom,
      pitch: view.pitch,
      bearing: view.bearing,
    });
  }

  flyTo(view = {}) {
    if (this._fallback) {
      this._fallback.flyTo(view);
      return;
    }
    if (!this.map) return;
    this.map.flyTo({
      center: view.center ? toLngLat(view.center) : undefined,
      zoom: view.zoom,
      pitch: view.pitch,
      bearing: view.bearing,
      duration: view.durationMs ?? 700,
    });
  }

  getView() {
    if (this._fallback) return this._fallback.getView();
    if (!this.map) return super.getView();
    const c = this.map.getCenter();
    return {
      center: [c.lng, c.lat],
      zoom: this.map.getZoom(),
      pitch: this.map.getPitch(),
      bearing: this.map.getBearing(),
    };
  }

  getBounds() {
    if (this._fallback) return this._fallback.getBounds();
    if (!this.map) return super.getBounds();
    const b = this.map.getBounds();
    return {
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    };
  }

  project(lonLat) {
    if (this._fallback) return this._fallback.project(lonLat);
    if (!this.map) return null;
    const p = this.map.project(toLngLat(lonLat));
    return [p.x, p.y];
  }

  unproject(screenXY) {
    if (this._fallback) return this._fallback.unproject(screenXY);
    if (!this.map) return null;
    const ll = this.map.unproject(screenXY);
    return [ll.lng, ll.lat];
  }

  addGeoJsonLayer(id, fc, style = {}) {
    if (this._fallback) {
      this._fallback.addGeoJsonLayer(id, fc, style);
      return;
    }
    this._geoLayers.set(id, { fc, style });
    this._runOrQueue(() => {
      if (!this.map) return;
      const srcId = `${id}-src`;
      if (!this.map.getSource(srcId)) {
        this.map.addSource(srcId, { type: "geojson", data: fc });
      } else {
        this.map.getSource(srcId).setData(fc);
      }

      if (!this.map.getLayer(id)) {
        const kind = style.type || "circle";
        if (kind === "line") {
          this.map.addLayer({
            id,
            type: "line",
            source: srcId,
            layout: {
              "line-cap": "round",
              "line-join": "round",
              visibility: style.visible === false ? "none" : "visible",
            },
            paint: {
              "line-color": style.color || "#38bdf8",
              "line-width": style.width || 3.5,
              ...(style.dasharray ? { "line-dasharray": style.dasharray } : {}),
            },
          });
        } else {
          this.map.addLayer({
            id,
            type: "circle",
            source: srcId,
            layout: {
              visibility: style.visible === false ? "none" : "visible",
            },
            paint: {
              "circle-radius": style.radiusExpr || style.radius || 6,
              "circle-color": style.colorExpr || style.color || "#34d399",
              "circle-stroke-width": style.strokeWidth ?? 1.5,
              "circle-stroke-color": style.strokeColor || "#0b0f17",
            },
          });
        }
      }
    });
  }

  updateGeoJsonLayer(id, fc) {
    if (this._fallback) {
      this._fallback.updateGeoJsonLayer(id, fc);
      return;
    }
    const existing = this._geoLayers.get(id);
    if (existing) existing.fc = fc;
    this._runOrQueue(() => {
      const src = this.map?.getSource(`${id}-src`);
      if (src) src.setData(fc);
    });
  }

  removeLayer(id) {
    if (this._fallback) {
      this._fallback.removeLayer(id);
      return;
    }
    this._geoLayers.delete(id);
    this._runOrQueue(() => {
      if (this.map?.getLayer(id)) this.map.removeLayer(id);
      if (this.map?.getSource(`${id}-src`)) this.map.removeSource(`${id}-src`);
    });
  }

  setLayerVisibility(id, visible) {
    if (this._fallback) {
      this._fallback.setLayerVisibility(id, visible);
      return;
    }
    this._visibility.set(id, Boolean(visible));
    this._runOrQueue(() => {
      if (this.map?.getLayer(id)) {
        this.map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      }
    });
  }

  sampleElevation(lonLat) {
    return this.demSampler.sampleElevation(lonLat, false);
  }

  sampleElevationProfile(coords) {
    return this.demSampler.sampleProfile(coords);
  }

  getActiveAttributions() {
    if (this._fallback) return this._fallback.getActiveAttributions();
    return this.registry.getActiveAttributions();
  }

  unmount() {
    if (this._fallback) this._fallback.unmount();
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    super.unmount();
  }
}
