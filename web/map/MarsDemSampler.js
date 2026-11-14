/**
 * Shared Mars HiRISE DEM Grid Sampler, Void-Filler, Slope Computer, and Terrarium Tile Rasterizer.
 *
 * Works identically in main browser thread, WebWorkers, and Node.js tests without DOM/Canvas dependencies.
 * Consumes the Gale Crater DTEEC_019698 height-preview buffer (R*256 + G, 0 = NoData) + bounds metadata.
 */

import {
  areoidOffsetM,
  clampLatDeg,
  decodeHiRiseRgb16Pixel,
  encodeTerrariumPixel,
  marsDistanceM,
  normalizeLonDeg,
  tileToLonLatBounds,
  toLngLat,
} from "./Geodesy.js";

/**
 * Multi-pass neighbor averaging void filler for Float32 elevation grids containing NaN holes.
 * @param {Float32Array} grid Row-major north-to-south elevations (NaN = hole)
 * @param {number} ncols
 * @param {number} nrows
 * @param {number} [maxPasses=8]
 * @returns {{ filled: Float32Array, holeCountBefore: number, holeCountAfter: number }}
 */
export function fillElevationVoids(grid, ncols, nrows, maxPasses = 8) {
  const work = new Float32Array(grid);
  let holeCountBefore = 0;
  for (let i = 0; i < work.length; i++) {
    if (!Number.isFinite(work[i])) holeCountBefore++;
  }
  if (holeCountBefore === 0) {
    return { filled: work, holeCountBefore: 0, holeCountAfter: 0 };
  }

  let next = new Float32Array(work);
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = 0;
    next.set(work);
    for (let r = 0; r < nrows; r++) {
      for (let c = 0; c < ncols; c++) {
        const idx = r * ncols + c;
        if (Number.isFinite(work[idx])) continue;
        let sum = 0;
        let count = 0;
        for (let dr = -1; dr <= 1; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= nrows) continue;
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const cc = c + dc;
            if (cc < 0 || cc >= ncols) continue;
            const v = work[rr * ncols + cc];
            if (Number.isFinite(v)) {
              const weight = dr === 0 || dc === 0 ? 1.0 : 0.7071;
              sum += v * weight;
              count += weight;
            }
          }
        }
        if (count > 0) {
          next[idx] = sum / count;
          changed++;
        }
      }
    }
    work.set(next);
    if (changed === 0) break;
  }

  // Fallback fill any deep remaining islands with global valid median/mean
  let validSum = 0;
  let validCount = 0;
  let holeCountAfter = 0;
  for (let i = 0; i < work.length; i++) {
    if (Number.isFinite(work[i])) {
      validSum += work[i];
      validCount++;
    } else {
      holeCountAfter++;
    }
  }
  if (holeCountAfter > 0 && validCount > 0) {
    const mean = validSum / validCount;
    for (let i = 0; i < work.length; i++) {
      if (!Number.isFinite(work[i])) work[i] = mean;
    }
  }

  return { filled: work, holeCountBefore, holeCountAfter };
}

/**
 * Decode an RGBA uint8 buffer of height-preview.png into a void-filled Float32Array (meters).
 * @param {Uint8Array|Uint8ClampedArray} rgba
 * @param {number} ncols
 * @param {number} nrows
 * @param {number} minElevM
 * @param {number} maxElevM
 * @returns {{ raw: Float32Array, filled: Float32Array, holeCountBefore: number, holeCountAfter: number }}
 */
export function decodeHiRiseHeightRgbaBuffer(rgba, ncols, nrows, minElevM, maxElevM) {
  const raw = new Float32Array(ncols * nrows);
  for (let i = 0; i < raw.length; i++) {
    const p = i * 4;
    raw[i] = decodeHiRiseRgb16Pixel(rgba[p], rgba[p + 1], minElevM, maxElevM);
  }
  const { filled, holeCountBefore, holeCountAfter } = fillElevationVoids(raw, ncols, nrows, 12);
  return { raw, filled, holeCountBefore, holeCountAfter };
}

/**
 * Bilinearly sampled Mars HiRISE DEM container with slope + Terrarium tile synthesis.
 */
export class MarsDemSampler {
  /**
   * @param {object} opts
   * @param {{ west_lon_deg: number, south_lat_deg: number, east_lon_deg: number, north_lat_deg: number }} opts.bounds
   * @param {number} opts.ncols
   * @param {number} opts.nrows
   * @param {number} opts.cellSizeM
   * @param {Float32Array} opts.elevations Row-major north-to-south void-filled meters
   * @param {Float32Array} [opts.rawElevations] Optional unfilled elevations for NoData masking
   * @param {number} opts.minElevM
   * @param {number} opts.maxElevM
   */
  constructor({ bounds, ncols, nrows, cellSizeM, elevations, rawElevations = null, minElevM, maxElevM }) {
    this.bounds = { ...bounds };
    this.ncols = ncols;
    this.nrows = nrows;
    this.cellSizeM = cellSizeM;
    this.elevations = elevations;
    this.rawElevations = rawElevations;
    this.minElevM = minElevM;
    this.maxElevM = maxElevM;
    this.lonSpanDeg = bounds.east_lon_deg - bounds.west_lon_deg;
    this.latSpanDeg = bounds.north_lat_deg - bounds.south_lat_deg;
  }

  /**
   * Sample void-filled elevation (meters, MOLA areoid) at [lon, lat] via bilinear interpolation.
   * Returns fallback edge-clamped value outside bounds when `clampToBounds=true`, else `null`.
   * @param {number[]|{lon?:number,lng?:number,lat:number}} coord
   * @param {boolean} [clampToBounds=false]
   * @returns {number|null}
   */
  sampleElevation(coord, clampToBounds = false) {
    const [lon, lat] = toLngLat(coord);
    const { west_lon_deg: w, south_lat_deg: s, east_lon_deg: e, north_lat_deg: n } = this.bounds;
    if (!clampToBounds && (lon < w || lon > e || lat < s || lat > n)) {
      return null;
    }
    const uRaw = ((lon - w) / this.lonSpanDeg) * (this.ncols - 1);
    const vRaw = ((n - lat) / this.latSpanDeg) * (this.nrows - 1);
    const u = Math.max(0, Math.min(this.ncols - 1.0001, uRaw));
    const v = Math.max(0, Math.min(this.nrows - 1.0001, vRaw));
    const c0 = Math.floor(u);
    const r0 = Math.floor(v);
    const c1 = Math.min(this.ncols - 1, c0 + 1);
    const r1 = Math.min(this.nrows - 1, r0 + 1);
    const tx = u - c0;
    const ty = v - r0;

    const e00 = this.elevations[r0 * this.ncols + c0];
    const e10 = this.elevations[r0 * this.ncols + c1];
    const e01 = this.elevations[r1 * this.ncols + c0];
    const e11 = this.elevations[r1 * this.ncols + c1];
    const top = e00 + (e10 - e00) * tx;
    const bot = e01 + (e11 - e01) * tx;
    return top + (bot - top) * ty + areoidOffsetM(lat, lon);
  }

  /**
   * Check if raw DTM has valid (non-NoData) coverage at [lon, lat].
   * @param {number[]|{lon?:number,lng?:number,lat:number}} coord
   * @returns {boolean}
   */
  hasValidDataAt(coord) {
    const [lon, lat] = toLngLat(coord);
    const { west_lon_deg: w, south_lat_deg: s, east_lon_deg: e, north_lat_deg: n } = this.bounds;
    if (lon < w || lon > e || lat < s || lat > n) return false;
    if (!this.rawElevations) return true;
    const c = Math.max(0, Math.min(this.ncols - 1, Math.round(((lon - w) / this.lonSpanDeg) * (this.ncols - 1))));
    const r = Math.max(0, Math.min(this.nrows - 1, Math.round(((n - lat) / this.latSpanDeg) * (this.nrows - 1))));
    return Number.isFinite(this.rawElevations[r * this.ncols + c]);
  }

  /**
   * Sample surface slope (degrees) and unit normal { x: East, y: Up, z: South } using finite differences.
   * @param {number[]|{lon?:number,lng?:number,lat:number}} coord
   * @returns {{ slopeDeg: number, aspectDeg: number, normal: { x: number, y: number, z: number }, elevM: number } | null}
   */
  sampleSlopeAndNormal(coord) {
    const [lon, lat] = toLngLat(coord);
    const center = this.sampleElevation([lon, lat], false);
    if (center === null) return null;

    const dLon = this.lonSpanDeg / Math.max(1, this.ncols - 1);
    const dLat = this.latSpanDeg / Math.max(1, this.nrows - 1);
    const zW = this.sampleElevation([lon - dLon, clampLatDeg(lat)], true);
    const zE = this.sampleElevation([lon + dLon, clampLatDeg(lat)], true);
    const zN = this.sampleElevation([lon, clampLatDeg(lat + dLat)], true);
    const zS = this.sampleElevation([lon, clampLatDeg(lat - dLat)], true);

    const dx = Math.max(0.5, this.cellSizeM);
    const dzdx = (zE - zW) / (2 * dx);
    const dzdy = (zN - zS) / (2 * dx);
    const grad = Math.hypot(dzdx, dzdy);
    const slopeDeg = (Math.atan(grad) * 180) / Math.PI;
    // Normal in Three.js (+X East, +Y Up, +Z South):
    // Surface height y(x, z) with North = -z => dy/dz_south = -dzdy
    const nx = -dzdx;
    const ny = 1.0;
    const nz = dzdy;
    const invLen = 1 / Math.hypot(nx, ny, nz);
    const aspectDeg = ((Math.atan2(dzdx, dzdy) * 180) / Math.PI + 360) % 360;
    return {
      elevM: center,
      slopeDeg,
      aspectDeg,
      normal: { x: nx * invLen, y: ny * invLen, z: nz * invLen },
    };
  }

  /**
   * Sample elevation + slope profile along a polyline using Mars radius distance.
   * @param {Array<number[]>} coords
   * @returns {Array<{ lon: number, lat: number, elevM: number|null, slopeDeg: number|null, sM: number }>}
   */
  sampleProfile(coords) {
    if (!Array.isArray(coords) || coords.length === 0) return [];
    const out = [];
    let sM = 0;
    for (let i = 0; i < coords.length; i++) {
      const [lon, lat] = toLngLat(coords[i]);
      if (i > 0) sM += marsDistanceM(coords[i - 1], [lon, lat]);
      const info = this.sampleSlopeAndNormal([lon, lat]);
      out.push({
        lon,
        lat,
        elevM: info ? info.elevM : null,
        slopeDeg: info ? info.slopeDeg : null,
        sM,
      });
    }
    return out;
  }

  /**
   * Rasterize a Web Mercator tile (z, x, y) into an RGBA Terrarium PNG buffer (256x256 default).
   * Used by `mars-dem://` custom MapLibre protocol for 2.5D/3D raster-dem hillshade & terrain.
   * Outside the Gale HiRISE footprint, falls back smoothly to the Mount Sharp ambient regional baseline.
   * @param {number} z
   * @param {number} x
   * @param {number} y
   * @param {number} [size=256]
   * @returns {Uint8ClampedArray}
   */
  rasterizeTerrariumTileRGBA(z, x, y, size = 256) {
    const rgba = new Uint8ClampedArray(size * size * 4);
    const bounds = tileToLonLatBounds(z, x, y);
    const n = 2 ** z;
    const tx0 = x / n;
    const ty0 = y / n;
    const txSpan = 1 / n;

    for (let py = 0; py < size; py++) {
      // Exact Web Mercator latitude per pixel row for crisp alignment with MapLibre tiles
      const ny = ty0 + ((py + 0.5) / size) * txSpan;
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * ny))) * 180) / Math.PI;
      for (let px = 0; px < size; px++) {
        const nx = tx0 + ((px + 0.5) / size) * txSpan;
        const lon = normalizeLonDeg(nx * 360 - 180);
        let elev = this.sampleElevation([lon, lat], false);
        if (elev === null) {
          // Smoothly clamp to boundary elevation with gentle Mount Sharp regional slope fallback
          elev = this.sampleElevation([lon, lat], true);
        }
        const [r, g, b] = encodeTerrariumPixel(elev);
        const idx = (py * size + px) * 4;
        rgba[idx] = r;
        rgba[idx + 1] = g;
        rgba[idx + 2] = b;
        rgba[idx + 3] = 255;
      }
    }
    void bounds;
    return rgba;
  }

  /**
   * Construct a synthetic Gale-like DEM sampler for unit tests without image decoding.
   * @returns {MarsDemSampler}
   */
  static createSyntheticGale(ncols = 64, nrows = 64) {
    const bounds = {
      west_lon_deg: 137.372831,
      south_lat_deg: -4.816946,
      east_lon_deg: 137.406542,
      north_lat_deg: -4.783236,
    };
    const elevations = new Float32Array(ncols * nrows);
    for (let r = 0; r < nrows; r++) {
      const fy = r / (nrows - 1);
      for (let c = 0; c < ncols; c++) {
        const fx = c / (ncols - 1);
        // Sloping Mount Sharp flank (~110m south climb + 15m ridge ripples)
        elevations[r * ncols + c] =
          -3720 + fy * 140 + Math.sin(fx * Math.PI * 5) * Math.cos(fy * Math.PI * 4) * 18;
      }
    }
    return new MarsDemSampler({
      bounds,
      ncols,
      nrows,
      cellSizeM: 31.0,
      elevations,
      minElevM: -3850.6,
      maxElevM: -3369.3,
    });
  }
}
