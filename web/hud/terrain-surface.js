/**
 * NASA HiRISE DEM Conditioning & C1 Bicubic Terrain Surface (`terrain-surface.js`).
 *
 * Preserves NASA DTEEC_019698 elevation values across flat plains and natural steep slopes
 * while selectively relaxing only high-curvature harsh spikes/kinks (`NoData` void fill +
 * curvature-gated despeckling) and interpolating C1-continuous transitions between grid cells
 * and across mirrored endless-ground boundaries.
 */

import { fillElevationVoids } from "../map/MarsDemSampler.js";

/**
 * Periodic triangle-wave wrap in [0, 1] matching mirrored endless-terrain tiles.
 * @param {number} t
 * @returns {number}
 */
export function mirrorWrap01(t) {
  const m = ((t % 2) + 2) % 2;
  return m > 1 ? 2 - m : m;
}

function mirrorIndex(i, maxIdx) {
  if (maxIdx <= 0) return 0;
  let k = i;
  while (k < 0 || k > maxIdx) {
    if (k < 0) k = -k;
    if (k > maxIdx) k = 2 * maxIdx - k;
  }
  return k;
}

/**
 * Selectively relax only sharp, pointy high-curvature needles/kinks while keeping
 * real NASA plains and constant steep slopes (where discrete Laplacian ~ 0) untouched.
 *
 * @param {Float32Array} elevations Row-major void-filled heightfield (meters)
 * @param {number} width
 * @param {number} height
 * @param {object} [opts]
 * @param {number} [opts.deadbandM=0.28] Curvature below this (m) stays bit-exact to NASA grid
 * @param {number} [opts.scaleM=0.55] Soft knee scale for spike relaxation
 * @param {number} [opts.maxBlend=0.72] Max per-pass relaxation toward local 8-neighbor plane
 * @param {number} [opts.passes=4] Relaxation passes
 * @returns {Float32Array}
 */
export function smoothHarshTerrainSpikes(
  elevations,
  width,
  height,
  { deadbandM = 0.28, scaleM = 0.55, maxBlend = 0.72, passes = 4 } = {}
) {
  const cur = new Float32Array(elevations);
  if (!width || !height || width < 3 || height < 3 || passes <= 0) return cur;
  const next = new Float32Array(cur.length);

  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < height; y++) {
      const ym = y > 0 ? y - 1 : 1;
      const yp = y < height - 1 ? y + 1 : height - 2;
      const row = y * width;
      const rowM = ym * width;
      const rowP = yp * width;
      for (let x = 0; x < width; x++) {
        const xm = x > 0 ? x - 1 : 1;
        const xp = x < width - 1 ? x + 1 : width - 2;
        const v = cur[row + x];
        // Weighted 8-neighbor local plane estimate (vanishes on linear steep slopes)
        const avg =
          (cur[row + xm] +
            cur[row + xp] +
            cur[rowM + x] +
            cur[rowP + x] +
            0.5 * (cur[rowM + xm] + cur[rowM + xp] + cur[rowP + xm] + cur[rowP + xp])) /
          6.0;
        const d = v - avg;
        const absD = d < 0 ? -d : d;
        if (absD <= deadbandM) {
          next[row + x] = v;
          continue;
        }
        const excess = absD - deadbandM;
        const alpha = maxBlend * (excess / (excess + scaleM));
        next[row + x] = v - d * alpha;
      }
    }
    cur.set(next);
  }
  return cur;
}

/**
 * Decode 16-bit RGB height-preview pixels (`R*256+G`, `0 = NoData`), fill voids from
 * neighbors, and selectively soften only harsh/pointy spikes.
 *
 * @param {Uint8Array|Uint8ClampedArray} rgba
 * @param {number} width
 * @param {number} height
 * @param {number} elevMinM
 * @param {number} elevMaxM
 * @param {object} [opts]
 * @returns {{ grid: Float32Array, holeCountBefore: number, holeCountAfter: number }}
 */
export function decodeAndConditionElevGrid(rgba, width, height, elevMinM, elevMaxM, opts = {}) {
  const count = width * height;
  const raw = new Float32Array(count);
  const span = elevMaxM - elevMinM;
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const val = rgba[o] * 256 + rgba[o + 1];
    raw[i] = val === 0 ? Number.NaN : elevMinM + (val / 65535) * span;
  }
  const { filled, holeCountBefore, holeCountAfter } = fillElevationVoids(raw, width, height, 12);
  const grid = smoothHarshTerrainSpikes(filled, width, height, opts);
  return { grid, holeCountBefore, holeCountAfter };
}

/**
 * C1 cubic Hermite spline passing strictly through p1 (at t=0) and p2 (at t=1)
 * with damped tension (0.38) to avoid cliff-base overshoot while removing C0 creases.
 */
function cubicHermite(p0, p1, p2, p3, t, tension = 0.38) {
  const t2 = t * t;
  const t3 = t2 * t;
  const m1 = tension * (p2 - p0);
  const m2 = tension * (p3 - p1);
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * p1 + h10 * m1 + h01 * p2 + h11 * m2;
}

/**
 * Sample height from an elevation grid with periodic mirrored boundaries using C1 bicubic
 * interpolation, eliminating angular grid-cell facets and V-creases at mirror edges.
 *
 * @param {Float32Array} grid
 * @param {number} width
 * @param {number} height
 * @param {number} uNorm Normalized X coordinate (wrapped cleanly across mirrored tiles)
 * @param {number} vNorm Normalized Z coordinate (wrapped cleanly across mirrored tiles)
 * @returns {number}
 */
export function sampleMirrorBicubicHeight(grid, width, height, uNorm, vNorm) {
  const maxX = width - 1;
  const maxY = height - 1;
  const fx = mirrorWrap01(uNorm) * maxX;
  const fy = mirrorWrap01(vNorm) * maxY;
  const x1 = Math.floor(fx);
  const y1 = Math.floor(fy);
  const tx = fx - x1;
  const ty = fy - y1;

  const ix0 = mirrorIndex(x1 - 1, maxX);
  const ix1 = mirrorIndex(x1, maxX);
  const ix2 = mirrorIndex(x1 + 1, maxX);
  const ix3 = mirrorIndex(x1 + 2, maxX);

  const r0 = mirrorIndex(y1 - 1, maxY) * width;
  const r1 = mirrorIndex(y1, maxY) * width;
  const r2 = mirrorIndex(y1 + 1, maxY) * width;
  const r3 = mirrorIndex(y1 + 2, maxY) * width;

  const v0 = cubicHermite(grid[r0 + ix0], grid[r0 + ix1], grid[r0 + ix2], grid[r0 + ix3], tx);
  const v1 = cubicHermite(grid[r1 + ix0], grid[r1 + ix1], grid[r1 + ix2], grid[r1 + ix3], tx);
  const v2 = cubicHermite(grid[r2 + ix0], grid[r2 + ix1], grid[r2 + ix2], grid[r2 + ix3], tx);
  const v3 = cubicHermite(grid[r3 + ix0], grid[r3 + ix1], grid[r3 + ix2], grid[r3 + ix3], tx);

  return cubicHermite(v0, v1, v2, v3, ty);
}
