/**
 * Planetary-scale spherical Mars model, coordinate transforms, and offline topography/albedo
 * (`web/hud/mars-globe.js`).
 *
 * Used strictly in offline demo mode (`?demo=1`) so the 3D terrain curves on Mars's real
 * spherical radius (3,389.5 km; 21,297 km circumference) with continuous great-circle physics
 * and seamless transition out of the 2 km HiRISE Gale Crater DTM across the globe.
 */

import {
  MARS_RADIUS_EQ_M,
  MARS_RADIUS_MEAN_M,
  MARS_RADIUS_POLAR_M,
  clampLatDeg,
  marsDistanceM,
  normalizeLonDeg,
} from "../map/Geodesy.js";

export { MARS_RADIUS_MEAN_M, MARS_RADIUS_EQ_M, MARS_RADIUS_POLAR_M };
export const MARS_CIRCUMFERENCE_M = 2 * Math.PI * MARS_RADIUS_MEAN_M;

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Notable Mars planetary landmarks (planetocentric lon/lat, MOLA reference elevation). */
export const MARS_LANDMARKS = [
  { id: "gale", nameEn: "Gale Crater (Mount Sharp)", nameTr: "Gale Krateri (Sharp Dağı)", lon: 137.39, lat: -4.8, elevM: -3620, radiusKm: 77 },
  { id: "olympus", nameEn: "Olympus Mons", nameTr: "Olympus Mons", lon: -133.8, lat: 18.65, elevM: 21229, radiusKm: 310 },
  { id: "ascraeus", nameEn: "Ascraeus Mons", nameTr: "Ascraeus Mons", lon: -104.1, lat: 11.9, elevM: 18225, radiusKm: 220 },
  { id: "pavonis", nameEn: "Pavonis Mons", nameTr: "Pavonis Mons", lon: -113.0, lat: 1.5, elevM: 14058, radiusKm: 185 },
  { id: "arsia", nameEn: "Arsia Mons", nameTr: "Arsia Mons", lon: -120.1, lat: -8.3, elevM: 17761, radiusKm: 215 },
  { id: "valles", nameEn: "Valles Marineris", nameTr: "Valles Marineris", lon: -69.0, lat: -13.9, elevM: -6800, radiusKm: 400 },
  { id: "hellas", nameEn: "Hellas Planitia", nameTr: "Hellas Havzası", lon: 70.5, lat: -42.4, elevM: -7152, radiusKm: 1100 },
  { id: "jezero", nameEn: "Jezero Crater (Perseverance)", nameTr: "Jezero Krateri", lon: 77.58, lat: 18.38, elevM: -2570, radiusKm: 22.5 },
  { id: "elysium", nameEn: "Elysium Mons", nameTr: "Elysium Mons", lon: 147.2, lat: 25.0, elevM: 14127, radiusKm: 180 },
  { id: "syrtis", nameEn: "Syrtis Major", nameTr: "Syrtis Major", lon: 68.0, lat: 8.4, elevM: 1200, radiusKm: 550 },
  { id: "argyre", nameEn: "Argyre Planitia", nameTr: "Argyre Havzası", lon: -44.0, lat: -49.7, elevM: -5200, radiusKm: 430 },
  { id: "isidis", nameEn: "Isidis Planitia", nameTr: "Isidis Havzası", lon: 87.0, lat: 12.9, elevM: -3600, radiusKm: 560 },
  { id: "npole", nameEn: "Planum Boreum (N. Pole)", nameTr: "Kuzey Kutbu (Boreum)", lon: 0.0, lat: 86.5, elevM: 2400, radiusKm: 500 },
  { id: "spole", nameEn: "Planum Australe (S. Pole)", nameTr: "Güney Kutbu (Australe)", lon: 0.0, lat: -86.5, elevM: 2900, radiusKm: 500 },
];

/**
 * Convert planetocentric [lonDeg, latDeg] to right-handed unit vector (+Y = North Pole,
 * +X = Prime Meridian lon 0, -Z = 90°E).
 */
export function lonLatToUnitVec(lonDeg, latDeg) {
  const phi = latDeg * DEG2RAD;
  const lam = lonDeg * DEG2RAD;
  const cPhi = Math.cos(phi);
  return {
    ux: cPhi * Math.cos(lam),
    uy: Math.sin(phi),
    uz: -cPhi * Math.sin(lam),
  };
}

/**
 * Convert unit vector (+Y North, +X lon 0, -Z lon 90E) back to [lonDeg, latDeg].
 */
export function unitVecToLonLat(ux, uy, uz) {
  const len = Math.hypot(ux, uy, uz) || 1;
  const ny = Math.max(-1, Math.min(1, uy / len));
  const latDeg = Math.asin(ny) * RAD2DEG;
  const lonDeg = normalizeLonDeg(Math.atan2(-uz, ux) * RAD2DEG);
  return { lonDeg, latDeg };
}

/**
 * Advance tangentially across a spherical Mars of radius (MARS_RADIUS_MEAN_M + altM)
 * along local tangent East/North increments (eastM, northM), returning updated planetocentric
 * lon/lat and parallel-transport yaw adjustment (so walking across polar latitudes stays smooth).
 */
export function stepOnMarsSphere(lonDeg, latDeg, altM, eastM, northM, _yawRad = 0) {
  const stepM = Math.hypot(eastM, northM);
  if (stepM <= 1e-9) {
    return { lonDeg: normalizeLonDeg(lonDeg), latDeg: clampLatDeg(latDeg), deltaYawRad: 0 };
  }
  const r = MARS_RADIUS_MEAN_M + (Number.isFinite(altM) ? altM : 0);
  const phi = clampLatDeg(latDeg) * DEG2RAD;
  const lam = normalizeLonDeg(lonDeg) * DEG2RAD;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const cosLam = Math.cos(lam);
  const sinLam = Math.sin(lam);

  // Unit radial position u, tangent East e, tangent North n
  const ux = cosPhi * cosLam;
  const uy = sinPhi;
  const uz = -cosPhi * sinLam;
  const ex = -sinLam;
  const ey = 0;
  const ez = -cosLam;
  const nx = -sinPhi * cosLam;
  const ny = cosPhi;
  const nz = sinPhi * sinLam;

  // Tangent unit direction along surface step
  const tx = (eastM * ex + northM * nx) / stepM;
  const ty = (eastM * ey + northM * ny) / stepM;
  const tz = (eastM * ez + northM * nz) / stepM;

  const theta = stepM / r;
  const cT = Math.cos(theta);
  const sT = Math.sin(theta);

  const ux2 = ux * cT + tx * sT;
  const uy2 = uy * cT + ty * sT;
  const uz2 = uz * cT + tz * sT;
  const next = unitVecToLonLat(ux2, uy2, uz2);

  // Parallel transport of North reference heading across deltaLon at high latitudes
  let dLon = next.lonDeg - normalizeLonDeg(lonDeg);
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  const deltaYawRad = -(dLon * DEG2RAD) * Math.sin(0.5 * (phi + next.latDeg * DEG2RAD));

  return { lonDeg: next.lonDeg, latDeg: next.latDeg, deltaYawRad };
}

/**
 * Project planetocentric (lonDeg, latDeg, altM) onto the local curved-sphere tangent frame
 * anchored at (refLonDeg, refLatDeg, refElevM) with Mars center at (0, -MARS_RADIUS_MEAN_M, 0).
 * +X = East, +Y = radial Up, +Z = South. Cancellation-free half-angle formulation keeps
 * sub-millimetre WebGL Float32 precision everywhere on Mars.
 */
export function marsLonLatAltToLocalScene(
  lonDeg,
  latDeg,
  altM,
  refLonDeg,
  refLatDeg,
  refElevM = 0
) {
  const phi0 = refLatDeg * DEG2RAD;
  const lam0 = refLonDeg * DEG2RAD;
  const phi = latDeg * DEG2RAD;
  const lam = lonDeg * DEG2RAD;
  const dPhi = phi - phi0;
  let dLam = lam - lam0;
  if (dLam > Math.PI) dLam -= 2 * Math.PI;
  if (dLam < -Math.PI) dLam += 2 * Math.PI;

  const h = (Number.isFinite(altM) ? altM : 0) - refElevM;
  const r = MARS_RADIUS_MEAN_M + h;
  const sinDPhi2 = Math.sin(0.5 * dPhi);
  const sinDLam2 = Math.sin(0.5 * dLam);
  const cPhi = Math.cos(phi);
  const cPhi0 = Math.cos(phi0);
  const sPhi0 = Math.sin(phi0);

  const x = r * cPhi * Math.sin(dLam);
  const z = -r * (Math.sin(dPhi) + 2 * sPhi0 * cPhi * sinDLam2 * sinDLam2);
  const y = h - 2 * r * (sinDPhi2 * sinDPhi2 + cPhi0 * cPhi * sinDLam2 * sinDLam2);
  return { x, y, z };
}

/**
 * Invert local horizontal tangent offset (x East, z South) near (refLonDeg, refLatDeg)
 * back to planetocentric (lonDeg, latDeg) on the sphere.
 */
export function localSceneXZToLonLat(x, z, refLonDeg, refLatDeg) {
  const R = MARS_RADIUS_MEAN_M;
  const rho2 = x * x + z * z;
  const uyLocal = rho2 < R * R ? Math.sqrt(R * R - rho2) / R : 0;
  const uEast = x / R;
  const uNorth = -z / R;

  // Normalize in case rho >= R
  const inv = 1 / (Math.hypot(uEast, uyLocal, uNorth) || 1);
  const le = uEast * inv;
  const lu = uyLocal * inv;
  const ln = uNorth * inv;

  const phi0 = refLatDeg * DEG2RAD;
  const lam0 = refLonDeg * DEG2RAD;
  const sPhi0 = Math.sin(phi0);
  const cPhi0 = Math.cos(phi0);
  const sLam0 = Math.sin(lam0);
  const cLam0 = Math.cos(lam0);

  const ux = lu * cPhi0 * cLam0 - le * sLam0 - ln * sPhi0 * cLam0;
  const uy = lu * sPhi0 + ln * cPhi0;
  const uz = -lu * cPhi0 * sLam0 - le * cLam0 + ln * sPhi0 * sLam0;
  return unitVecToLonLat(ux, uy, uz);
}

/** Radial outward sphere unit normal at scene position (x, y, z). */
export function sphereNormalAtLocal(x, y, z) {
  const ny = y + MARS_RADIUS_MEAN_M;
  const inv = 1 / (Math.hypot(x, ny, z) || 1);
  return [x * inv, ny * inv, z * inv];
}

// ---------- Deterministic 3D-on-sphere noise & planetary terrain synthesis ----------

function hash3(ix, iy, iz) {
  let n = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 2147483647);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise3D(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const tx = smooth(x - ix);
  const ty = smooth(y - iy);
  const tz = smooth(z - iz);

  const c000 = hash3(ix, iy, iz);
  const c100 = hash3(ix + 1, iy, iz);
  const c010 = hash3(ix, iy + 1, iz);
  const c110 = hash3(ix + 1, iy + 1, iz);
  const c001 = hash3(ix, iy, iz + 1);
  const c101 = hash3(ix + 1, iy, iz + 1);
  const c011 = hash3(ix, iy + 1, iz + 1);
  const c111 = hash3(ix + 1, iy + 1, iz + 1);

  const x00 = c000 + (c100 - c000) * tx;
  const x10 = c010 + (c110 - c010) * tx;
  const x01 = c001 + (c101 - c001) * tx;
  const x11 = c011 + (c111 - c011) * tx;
  const y0 = x00 + (x10 - x00) * ty;
  const y1 = x01 + (x11 - x01) * ty;
  return y0 + (y1 - y0) * tz;
}

function fbm3D(x, y, z, octaves = 5) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1.0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += (valueNoise3D(x * freq, y * freq, z * freq) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.04;
  }
  return sum / (norm || 1);
}

/** Fast cellular crater field evaluated on 3D sphere coords (ux, uy, uz) so poles & antimeridian stay seamless. */
function craterField3D(px, py, pz, scale, depthM) {
  const sx = px * scale;
  const sy = py * scale;
  const sz = pz * scale;
  const ix = Math.floor(sx);
  const iy = Math.floor(sy);
  const iz = Math.floor(sz);
  let delta = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx;
        const cy = iy + dy;
        const cz = iz + dz;
        const prob = hash3(cx, cy, cz);
        if (prob < 0.62) continue;
        const jx = cx + 0.2 + 0.6 * hash3(cx + 17, cy + 31, cz + 7);
        const jy = cy + 0.2 + 0.6 * hash3(cx + 53, cy + 11, cz + 29);
        const jz = cz + 0.2 + 0.6 * hash3(cx + 97, cy + 43, cz + 61);
        const d = Math.hypot(sx - jx, sy - jy, sz - jz);
        const rad = 0.22 + 0.24 * hash3(cx + 71, cy + 19, cz + 83);
        const q = d / rad;
        if (q < 1.35) {
          if (q < 0.85) {
            const bowl = Math.cos((q / 0.85) * (Math.PI / 2));
            delta -= depthM * (0.45 + 0.55 * rad) * bowl;
          }
          const rim = Math.exp(-Math.pow((q - 0.94) / 0.14, 2));
          delta += depthM * 0.24 * rim;
        }
      }
    }
  }
  return delta;
}

function smooth01(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** Angular great-circle distance in degrees between [lon1, lat1] and [lon2, lat2]. */
function angularDeg(u, lon2Deg, lat2Deg) {
  const v = lonLatToUnitVec(lon2Deg, lat2Deg);
  const dot = Math.max(-1, Math.min(1, u.ux * v.ux + u.uy * v.uy + u.uz * v.uz));
  return Math.acos(dot) * RAD2DEG;
}

export const MOLA_DEM_OFFSET_M = 12000;

/**
 * Decode an RGBA buffer produced from NASA MGS MOLA MEGDR (`R = (elev + 12000) >> 8`,
 * `G = (elev + 12000) & 255`) back into planetary elevations in metres relative to the areoid.
 */
export function decodeMolaDemRgba(rgba, width, height) {
  const n = width * height;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const raw = (rgba[i * 4] << 8) | rgba[i * 4 + 1];
    out[i] = raw - MOLA_DEM_OFFSET_M;
  }
  return out;
}

/**
 * Create an offline Mars planetary height & albedo model bound to the high-res Gale Crater HiRISE grid
 * and (when provided) real NASA MGS MOLA global elevation & Viking MDIM 2.1 global color mosaic.
 */
export function createMarsGlobalModel({
  elevGrid,
  imgW,
  imgH,
  bounds,
  elevMin,
  elevMax,
  molaGrid = null,
  molaW = 0,
  molaH = 0,
  vikingRgb = null,
  vikingW = 0,
  vikingH = 0,
}) {
  const wLon = bounds?.west_lon_deg ?? 137.372831;
  const eLon = bounds?.east_lon_deg ?? 137.406542;
  const sLat = bounds?.south_lat_deg ?? -4.816946;
  const nLat = bounds?.north_lat_deg ?? -4.783236;
  const dLon = Math.max(1e-6, eLon - wLon);
  const dLat = Math.max(1e-6, nLat - sLat);
  const hasRealMola = Boolean(molaGrid && molaW > 1 && molaH > 1);
  const hasRealViking = Boolean(vikingRgb && vikingW > 1 && vikingH > 1);

  function sampleRealMolaM(lonDeg, latDeg) {
    const lon = normalizeLonDeg(lonDeg);
    const lat = clampLatDeg(latDeg);
    const fx = ((lon + 180) / 360) * molaW - 0.5;
    const fy = Math.max(0, Math.min(molaH - 1, ((90 - lat) / 180) * molaH - 0.5));
    const c0 = ((Math.floor(fx) % molaW) + molaW) % molaW;
    const c1 = (c0 + 1) % molaW;
    const r0 = Math.floor(fy);
    const r1 = Math.min(molaH - 1, r0 + 1);
    const tx = fx - Math.floor(fx);
    const ty = fy - r0;
    const e00 = molaGrid[r0 * molaW + c0];
    const e10 = molaGrid[r0 * molaW + c1];
    const e01 = molaGrid[r1 * molaW + c0];
    const e11 = molaGrid[r1 * molaW + c1];
    const top = e00 + (e10 - e00) * tx;
    const bot = e01 + (e11 - e01) * tx;
    return top + (bot - top) * ty;
  }

  function sampleRealVikingRgb(lonDeg, latDeg) {
    const lon = normalizeLonDeg(lonDeg);
    const lat = clampLatDeg(latDeg);
    const fx = ((lon + 180) / 360) * vikingW - 0.5;
    const fy = Math.max(0, Math.min(vikingH - 1, ((90 - lat) / 180) * vikingH - 0.5));
    const c0 = ((Math.floor(fx) % vikingW) + vikingW) % vikingW;
    const c1 = (c0 + 1) % vikingW;
    const r0 = Math.floor(fy);
    const r1 = Math.min(vikingH - 1, r0 + 1);
    const tx = fx - Math.floor(fx);
    const ty = fy - r0;
    const i00 = (r0 * vikingW + c0) * 4;
    const i10 = (r0 * vikingW + c1) * 4;
    const i01 = (r1 * vikingW + c0) * 4;
    const i11 = (r1 * vikingW + c1) * 4;
    const r =
      ((vikingRgb[i00] + (vikingRgb[i10] - vikingRgb[i00]) * tx) * (1 - ty) +
        (vikingRgb[i01] + (vikingRgb[i11] - vikingRgb[i01]) * tx) * ty) /
      255;
    const g =
      ((vikingRgb[i00 + 1] + (vikingRgb[i10 + 1] - vikingRgb[i00 + 1]) * tx) * (1 - ty) +
        (vikingRgb[i01 + 1] + (vikingRgb[i11 + 1] - vikingRgb[i01 + 1]) * tx) * ty) /
      255;
    const b =
      ((vikingRgb[i00 + 2] + (vikingRgb[i10 + 2] - vikingRgb[i00 + 2]) * tx) * (1 - ty) +
        (vikingRgb[i01 + 2] + (vikingRgb[i11 + 2] - vikingRgb[i01 + 2]) * tx) * ty) /
      255;
    return [r, g, b];
  }

  function sampleHiRiseClampedM(lonDeg, latDeg) {
    if (!elevGrid || !imgW || !imgH) return (elevMin + elevMax) * 0.5;
    const u = Math.max(0, Math.min(1, (lonDeg - wLon) / dLon));
    const v = Math.max(0, Math.min(1, (nLat - latDeg) / dLat));
    const fx = u * (imgW - 1);
    const fy = v * (imgH - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(imgW - 1, x0 + 1);
    const y1 = Math.min(imgH - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const e00 = elevGrid[y0 * imgW + x0];
    const e10 = elevGrid[y0 * imgW + x1];
    const e01 = elevGrid[y1 * imgW + x0];
    const e11 = elevGrid[y1 * imgW + x1];
    const top = e00 + (e10 - e00) * tx;
    const bot = e01 + (e11 - e01) * tx;
    return top + (bot - top) * ty;
  }

  /** Weight [0..1] indicating proximity to the high-resolution HiRISE Gale crop (1 inside, 0 >280m outside). */
  function hiRiseWeightAt(lonDeg, latDeg, featherM = 280) {
    const u = (lonDeg - wLon) / dLon;
    const v = (nLat - latDeg) / dLat;
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return 1;
    const cLon = Math.max(wLon, Math.min(eLon, lonDeg));
    const cLat = Math.max(sLat, Math.min(nLat, latDeg));
    const distOutM = marsDistanceM([cLon, cLat], [lonDeg, latDeg]);
    if (distOutM >= featherM) return 0;
    return 1 - smooth01(distOutM / featherM);
  }

  /** Regional + global planetary Mars elevation (MOLA m) without the local HiRISE patch. */
  function samplePlanetaryBackgroundM(lonDeg, latDeg) {
    const lon = normalizeLonDeg(lonDeg);
    const lat = clampLatDeg(latDeg);
    const u = lonLatToUnitVec(lon, lat);

    if (hasRealMola) {
      // Exact NASA MGS MOLA MEGDR elevation + sub-15km walkable regolith/crater micro-relief
      let h = sampleRealMolaM(lon, lat);
      h += craterField3D(u.ux, u.uy, u.uz, 420, 38);
      h += craterField3D(u.ux, u.uy, u.uz, 1800, 11);
      h += fbm3D(u.ux * 950, u.uy * 950, u.uz * 950, 3) * 12;
      h += fbm3D(u.ux * 7500, u.uy * 7500, u.uz * 7500, 3) * 2.4;
      return h;
    }

    // Procedural fallback when MOLA DEM image is unavailable
    // 1. Crustal dichotomy: southern highlands (+1200 m) vs northern Vastitas Borealis (-4100 m)
    const dichotomyShift = 10 * fbm3D(u.ux * 2.1, u.uy * 2.1, u.uz * 2.1, 3);
    const northBlend = smooth01((lat - (-8 + dichotomyShift)) / 30);
    let h = 1150 * (1 - northBlend) + -4100 * northBlend;

    // Large continental texture & highland cratering
    h += fbm3D(u.ux * 5.2, u.uy * 5.2, u.uz * 5.2, 4) * 950;
    h += fbm3D(u.ux * 22, u.uy * 22, u.uz * 22, 4) * 260;

    // 2. Tharsis bulge + Olympus Mons + Ascraeus/Pavonis/Arsia
    const dTharsis = angularDeg(u, -110, 2);
    if (dTharsis < 52) {
      h += 4200 * Math.pow(Math.cos((dTharsis / 52) * (Math.PI / 2)), 2);
    }
    const volcanoes = [
      { lon: -133.8, lat: 18.65, peak: 23200, rad: 5.5, cald: 0.7 }, // Olympus Mons
      { lon: -104.1, lat: 11.9, peak: 13800, rad: 3.8, cald: 0.5 }, // Ascraeus
      { lon: -113.0, lat: 1.5, peak: 10200, rad: 3.4, cald: 0.45 }, // Pavonis
      { lon: -120.1, lat: -8.3, peak: 13400, rad: 3.9, cald: 0.65 }, // Arsia
      { lon: 147.2, lat: 25.0, peak: 13900, rad: 4.5, cald: 0.4 }, // Elysium Mons
    ];
    for (const v of volcanoes) {
      const dv = angularDeg(u, v.lon, v.lat);
      if (dv < v.rad * 1.4) {
        const q = dv / v.rad;
        const cone = Math.exp(-q * q * 1.7);
        const caldera = dv < v.cald ? 1600 * (1 - dv / v.cald) : 0;
        h += v.peak * cone - caldera;
      }
    }

    // 3. Major impact basins (Hellas, Argyre, Isidis)
    const basins = [
      { lon: 70.5, lat: -42.4, depth: -8400, rad: 18.5, rim: 950 }, // Hellas
      { lon: -44.0, lat: -49.7, depth: -4900, rad: 8.5, rim: 750 }, // Argyre
      { lon: 87.0, lat: 12.9, depth: -3200, rad: 10.5, rim: 650 }, // Isidis
    ];
    for (const b of basins) {
      const db = angularDeg(u, b.lon, b.lat);
      const q = db / b.rad;
      if (q < 1.35) {
        if (q < 0.92) h += b.depth * Math.cos((q / 0.92) * (Math.PI / 2));
        h += b.rim * Math.exp(-Math.pow((q - 0.98) / 0.16, 2));
      }
    }

    // 4. Valles Marineris canyon complex (-93..-46 lon, ~-13.8 lat)
    let dlVm = lon - -69;
    if (dlVm > 180) dlVm -= 360;
    if (dlVm < -180) dlVm += 360;
    const vmW = Math.exp(-Math.pow(dlVm / 19.5, 4));
    if (vmW > 0.01) {
      const canyonLat = -13.5 + 1.8 * Math.sin(dlVm * 0.25);
      const dLatC = Math.abs(lat - canyonLat);
      if (dLatC < 4.5) {
        const trough = Math.exp(-Math.pow(dLatC / 1.45, 2));
        h -= 7200 * vmW * trough;
      }
    }

    // 5. Gale Crater (154 km diameter, center ~137.82E, -5.38S, Aeolis Mons central mound)
    const dGale = angularDeg(u, 137.82, -5.38);
    if (dGale < 2.2) {
      const q = dGale / 1.3; // ~77 km radius = 1.3 deg
      if (q < 1.1) {
        // Basin floor sits around -4500 m MOLA
        const basin = smooth01(1 - q / 1.02);
        h = h * (1 - basin) + -4480 * basin;
      }
      // Steep crater rim ring at ~1.3 deg
      h += 1900 * Math.exp(-Math.pow((dGale - 1.32) / 0.22, 2));
      // Mount Sharp / Aeolis Mons central peak rising up to ~+500 m
      const dSharp = angularDeg(u, 137.82, -5.06);
      if (dSharp < 0.72) {
        const mound = Math.cos((dSharp / 0.72) * (Math.PI / 2));
        h += 4400 * mound * mound;
      }
    }

    // 6. Jezero Crater (77.58E, 18.38N, ~22.5 km radius)
    const dJez = angularDeg(u, 77.58, 18.38);
    if (dJez < 0.75) {
      const q = dJez / 0.38;
      if (q < 0.95) h -= 1400 * Math.cos((q / 0.95) * (Math.PI / 2));
      h += 520 * Math.exp(-Math.pow((q - 0.96) / 0.16, 2));
    }

    // 7. Polar layered ice caps (|lat| > 79 deg)
    if (Math.abs(lat) > 78) {
      const pFrac = smooth01((Math.abs(lat) - 78) / 10);
      h += (lat > 0 ? 5200 : 2100) * pFrac;
    }

    // 8. Mid-scale craters & local regolith topography (crisp walkable 3D hills anywhere on Mars!)
    const roughScale = 1.3 - 0.65 * northBlend;
    h += craterField3D(u.ux, u.uy, u.uz, 55, 340 * roughScale);
    h += craterField3D(u.ux, u.uy, u.uz, 260, 72 * roughScale);
    h += craterField3D(u.ux, u.uy, u.uz, 1800, 14 * roughScale);
    h += fbm3D(u.ux * 950, u.uy * 950, u.uz * 950, 3) * 18;
    h += fbm3D(u.ux * 7500, u.uy * 7500, u.uz * 7500, 3) * 2.6;
    return h;
  }

  /** Seamless global elevation: exact HiRISE DTM inside Gale window, smooth 450 m transition outside. */
  function sampleElevM(lonDeg, latDeg) {
    const lon = normalizeLonDeg(lonDeg);
    const lat = clampLatDeg(latDeg);
    const w = hiRiseWeightAt(lon, lat, 450);
    if (w >= 0.9999) {
      return sampleHiRiseClampedM(lon, lat);
    }
    const bg = samplePlanetaryBackgroundM(lon, lat);
    if (w <= 0) return bg;
    const edgeHi = sampleHiRiseClampedM(lon, lat);
    return bg + (edgeHi - bg) * w;
  }

  /** Realistic planetary Mars albedo [r, g, b] in 0..1 (real Viking MDIM 2.1 mosaic when loaded). */
  function sampleAlbedoRgb(lonDeg, latDeg, elevM) {
    const lon = normalizeLonDeg(lonDeg);
    const lat = clampLatDeg(latDeg);
    const u = lonLatToUnitVec(lon, lat);

    if (hasRealViking) {
      const [vr, vg, vb] = sampleRealVikingRgb(lon, lat);
      const micro = fbm3D(u.ux * 2200, u.uy * 2200, u.uz * 2200, 2) * 0.045;
      // Slight ferric warmth balance so planetary surface meshes cleanly with Gale HiRISE tint
      const r = Math.max(0.04, Math.min(0.98, vr * 1.06 + micro));
      const g = Math.max(0.03, Math.min(0.96, vg * 0.99 + micro * 0.8));
      const b = Math.max(0.02, Math.min(0.94, vb * 0.92 + micro * 0.6));
      return [r, g, b];
    }

    // Procedural fallback
    // Base warm ochre ferric dust
    let r = 0.72;
    let g = 0.43;
    let b = 0.27;

    // Subtle global dust vs dark basalt albedo provinces
    const albedoNoise = fbm3D(u.ux * 6.5 + 1.4, u.uy * 6.5 - 0.7, u.uz * 6.5 + 2.2, 4);
    const basaltMask = smooth01(-albedoNoise * 1.3 - 0.08);
    // Dark volcanic basalt (Syrtis Major / Acidalia / Bagnold dune sands)
    const dSyrtis = angularDeg(u, 68, 8.4);
    const syrtisBoost = dSyrtis < 22 ? smooth01(1 - dSyrtis / 22) * 0.75 : 0;
    const dBagnold = angularDeg(u, 137.42, -4.77);
    const galeSand = dBagnold < 0.35 ? smooth01(1 - dBagnold / 0.35) * 0.4 : 0;
    const darkAmt = Math.min(0.92, basaltMask * 0.55 + syrtisBoost + galeSand);

    r = r * (1 - darkAmt) + 0.31 * darkAmt;
    g = g * (1 - darkAmt) + 0.21 * darkAmt;
    b = b * (1 - darkAmt) + 0.16 * darkAmt;

    // Bright ferric dust on Tharsis / high peaks & canyons
    if (elevM > 4000) {
      const bright = smooth01((elevM - 4000) / 14000) * 0.45;
      r += (0.88 - r) * bright;
      g += (0.58 - g) * bright;
      b += (0.39 - b) * bright;
    }

    // Layered Mount Sharp sedimentary mudstone tint inside Gale Crater
    const dGale = angularDeg(u, 137.82, -5.38);
    if (dGale < 1.5) {
      const strata = 0.5 + 0.5 * Math.sin(elevM * 0.09);
      r = r * 0.85 + (0.64 + strata * 0.14) * 0.15;
      g = g * 0.85 + (0.39 + strata * 0.09) * 0.15;
      b = b * 0.85 + (0.25 + strata * 0.05) * 0.15;
    }

    // Local micro hue variation
    const micro = fbm3D(u.ux * 2200, u.uy * 2200, u.uz * 2200, 2) * 0.06;
    r = Math.max(0.05, Math.min(0.98, r + micro));
    g = Math.max(0.04, Math.min(0.95, g + micro * 0.8));
    b = Math.max(0.03, Math.min(0.92, b + micro * 0.6));

    // Bright CO2/H2O polar ice caps
    const iceNoise = fbm3D(u.ux * 28, u.uy * 28, u.uz * 28, 3) * 3.5;
    if (Math.abs(lat) + iceNoise > 80.5) {
      const ice = smooth01((Math.abs(lat) + iceNoise - 80.5) / 5.5);
      r = r * (1 - ice) + 0.93 * ice;
      g = g * (1 - ice) + 0.89 * ice;
      b = b * (1 - ice) + 0.85 * ice;
    }

    return [r, g, b];
  }

  function sampleRegionLabel(lonDeg, latDeg, isTr = false) {
    const lon = normalizeLonDeg(lonDeg);
    const lat = clampLatDeg(latDeg);
    for (const lm of MARS_LANDMARKS) {
      const dKm = marsDistanceM([lon, lat], [lm.lon, lm.lat]) / 1000;
      if (dKm <= Math.max(45, lm.radiusKm * 1.15)) {
        return isTr ? lm.nameTr : lm.nameEn;
      }
    }
    if (lat > 15) return isTr ? "Kuzey Mars Ovası (Vastitas)" : "Northern Lowlands";
    return isTr ? "Güney Mars Yaylası" : "Southern Highlands";
  }

  return {
    sampleElevM,
    sampleAlbedoRgb,
    hiRiseWeightAt,
    sampleRegionLabel,
    hasRealMola,
    hasRealViking,
    bounds: { west_lon_deg: wLon, east_lon_deg: eLon, south_lat_deg: sLat, north_lat_deg: nLat },
  };
}
