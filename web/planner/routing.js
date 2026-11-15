/**
 * Slope-aware route search on a real elevation grid (`web/planner/routing.js`). Pure module, no DOM.
 *
 * A grid is { nx, nz, dx, dz, elev: Float32Array (row-major, north to south, NaN = no data),
 *             west, east, south, north (degrees), label, resolutionM }.
 *
 * Cost of a step = step length x (1 + (slope / 10 deg)^2), the same formula as the pipeline's cost map
 * (pipeline/costmap/make_cost_map.py). Cells steeper than the limit, or without data, are blocked.
 * Slope limits are NASA lunar EVA ConOps values used as stand-ins; no Mars-specific limit is published.
 */

export const MARS_RADIUS_M = 3389500;
const DEG = Math.PI / 180;

/** Slope in degrees at every cell (central differences; one-sided at edges; NaN next to no-data). */
export function slopeGrid(grid) {
  const { nx, nz, dx, dz, elev } = grid;
  const out = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(nx - 1, i + 1);
      const j0 = Math.max(0, j - 1);
      const j1 = Math.min(nz - 1, j + 1);
      const gx = (elev[j * nx + i1] - elev[j * nx + i0]) / ((i1 - i0) * dx);
      const gz = (elev[j1 * nx + i] - elev[j0 * nx + i]) / ((j1 - j0) * dz);
      out[j * nx + i] = Math.atan(Math.hypot(gx, gz)) / DEG;
    }
  }
  return out;
}

export function lonLatToCell(grid, lon, lat) {
  const fi = ((lon - grid.west) / (grid.east - grid.west)) * grid.nx - 0.5;
  const fj = ((grid.north - lat) / (grid.north - grid.south)) * grid.nz - 0.5;
  return { i: Math.round(fi), j: Math.round(fj), fi, fj };
}

export function cellToLonLat(grid, i, j) {
  return [
    grid.west + ((i + 0.5) / grid.nx) * (grid.east - grid.west),
    grid.north - ((j + 0.5) / grid.nz) * (grid.north - grid.south),
  ];
}

export function gridContains(grid, lon, lat) {
  return lon >= grid.west && lon <= grid.east && lat >= grid.south && lat <= grid.north;
}

/** Bilinear elevation at lon/lat, or null outside / no data. */
export function sampleGrid(grid, lon, lat, field = grid.elev) {
  if (!gridContains(grid, lon, lat)) return null;
  const { fi, fj } = lonLatToCell(grid, lon, lat);
  const i0 = Math.max(0, Math.min(grid.nx - 2, Math.floor(fi)));
  const j0 = Math.max(0, Math.min(grid.nz - 2, Math.floor(fj)));
  const tx = Math.max(0, Math.min(1, fi - i0));
  const tz = Math.max(0, Math.min(1, fj - j0));
  const at = (i, j) => field[j * grid.nx + i];
  const v =
    (at(i0, j0) * (1 - tx) + at(i0 + 1, j0) * tx) * (1 - tz) + (at(i0, j0 + 1) * (1 - tx) + at(i0 + 1, j0 + 1) * tx) * tz;
  return Number.isFinite(v) ? v : null;
}

// ---------- binary heap ----------
class MinHeap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  get size() {
    return this.k.length;
  }
  push(key, val) {
    const k = this.k;
    const v = this.v;
    let n = k.length;
    k.push(key);
    v.push(val);
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (k[p] <= k[n]) break;
      [k[p], k[n]] = [k[n], k[p]];
      [v[p], v[n]] = [v[n], v[p]];
      n = p;
    }
  }
  pop() {
    const k = this.k;
    const v = this.v;
    const top = v[0];
    const lk = k.pop();
    const lv = v.pop();
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let n = 0;
      for (;;) {
        const l = 2 * n + 1;
        const r = l + 1;
        let m = n;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === n) break;
        [k[m], k[n]] = [k[n], k[m]];
        [v[m], v[n]] = [v[n], v[m]];
        n = m;
      }
    }
    return top;
  }
}

/**
 * A* from (lon, lat) to (lon, lat) on `grid`. Returns { ok, coords: [[lon, lat], ...], reason }.
 * `slope` may be passed in (from slopeGrid) to avoid recomputing it for every leg.
 */
export function findRoute(grid, from, to, { slopeLimitDeg = 20, slope = null, maxExpansions = 4e6 } = {}) {
  const S = slope || slopeGrid(grid);
  const { nx, nz, dx, dz } = grid;
  const a = lonLatToCell(grid, from[0], from[1]);
  const b = lonLatToCell(grid, to[0], to[1]);
  const inside = (c) => c.i >= 0 && c.j >= 0 && c.i < nx && c.j < nz;
  if (!inside(a) || !inside(b)) return { ok: false, coords: [], reason: "outside-grid" };
  const blocked = (idx) => !(S[idx] <= slopeLimitDeg);
  const start = a.j * nx + a.i;
  const goal = b.j * nx + b.i;
  if (blocked(start)) return { ok: false, coords: [], reason: "start-blocked" };
  if (blocked(goal)) return { ok: false, coords: [], reason: "goal-blocked" };

  const g = new Float64Array(nx * nz).fill(Infinity);
  const came = new Int32Array(nx * nz).fill(-1);
  const closed = new Uint8Array(nx * nz);
  const minStep = Math.min(dx, dz);
  const h = (idx) => {
    const i = idx % nx;
    const j = (idx - i) / nx;
    return Math.hypot((i - b.i) * dx, (j - b.j) * dz) * 0.999; // admissible: cost factor >= 1
  };
  const heap = new MinHeap();
  g[start] = 0;
  heap.push(h(start), start);
  const nbr = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  let expansions = 0;
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) break;
    if (++expansions > maxExpansions) return { ok: false, coords: [], reason: "search-limit" };
    const ci = cur % nx;
    const cj = (cur - ci) / nx;
    for (const [di, dj] of nbr) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
      const n = nj * nx + ni;
      if (closed[n] || blocked(n)) continue;
      const len = Math.hypot(di * dx, dj * dz);
      const s = 0.5 * (S[cur] + S[n]);
      const step = len * (1 + (s / 10) ** 2);
      const ng = g[cur] + step;
      if (ng < g[n]) {
        g[n] = ng;
        came[n] = cur;
        heap.push(ng + h(n), n);
      }
    }
  }
  if (!closed[goal]) return { ok: false, coords: [], reason: "no-path" };
  const cells = [];
  for (let c = goal; c !== -1; c = came[c]) cells.push(c);
  cells.reverse();
  const coords = [from.slice(0, 2)];
  for (let k = 1; k < cells.length - 1; k++) {
    const i = cells[k] % nx;
    coords.push(cellToLonLat(grid, i, (cells[k] - i) / nx));
  }
  coords.push(to.slice(0, 2));
  void minStep;
  return { ok: true, coords: simplify(coords, grid), reason: null, cost: g[goal] };
}

/** Drops collinear points (same grid direction) so the polyline stays small. */
function simplify(coords) {
  if (coords.length < 3) return coords;
  const out = [coords[0]];
  for (let k = 1; k < coords.length - 1; k++) {
    const [ax, ay] = out[out.length - 1];
    const [bx, by] = coords[k];
    const [cx, cy] = coords[k + 1];
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(cross) > 1e-14) out.push(coords[k]);
  }
  out.push(coords[coords.length - 1]);
  return out;
}

/** Great-circle distance on the Mars mean sphere (m). */
export function marsDistance(a, b) {
  const la1 = a[1] * DEG;
  const la2 = b[1] * DEG;
  const dLa = la2 - la1;
  const dLo = (b[0] - a[0]) * DEG;
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
  return 2 * MARS_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Cut a window of the global MOLA grid around a lon/lat box (for routing outside DTM coverage). */
export function molaWindow(mola, { west, east, south, north }, label = "MGS MOLA MEGDR (8 px/deg)") {
  const ppd = mola.ppd;
  const c0 = Math.floor((west + 360) % 360 * ppd);
  const c1 = Math.ceil((east + 360) % 360 * ppd);
  const r0 = Math.floor((90 - north) * ppd);
  const r1 = Math.ceil((90 - south) * ppd);
  const nx = Math.max(2, c1 - c0);
  const nz = Math.max(2, r1 - r0);
  const elev = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const c = (((c0 + i) % mola.w) + mola.w) % mola.w;
      const r = Math.max(0, Math.min(mola.h - 1, r0 + j));
      elev[j * nx + i] = mola.data[r * mola.w + c];
    }
  }
  const lonW = c0 / ppd;
  const latN = 90 - r0 / ppd;
  const midLat = latN - nz / ppd / 2;
  const dz = (Math.PI / 180) * MARS_RADIUS_M / ppd;
  return {
    nx,
    nz,
    dx: dz * Math.cos(midLat * DEG),
    dz,
    elev,
    west: lonW > 180 ? lonW - 360 : lonW,
    east: (lonW > 180 ? lonW - 360 : lonW) + nx / ppd,
    north: latN,
    south: latN - nz / ppd,
    label,
    resolutionM: Math.round(dz),
  };
}
