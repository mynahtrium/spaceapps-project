/**
 * Mars time, Sun, Earth, star and moon geometry for the visor and the Orbit view.
 *
 * - Mars time / Sun: NASA GISS Mars24 algorithm (Allison & McEwen 2000, Planet. Space Sci. 48),
 *   including the planetary perturbation terms and TT - UTC.
 * - Mars orientation: IAU WGCCRE 2009 pole and prime meridian (α0, δ0, W).
 * - Earth / Mars heliocentric positions: JPL "Keplerian elements for approximate positions of the
 *   major planets" (Standish), J2000 mean elements, good to well under a degree as seen from Mars.
 * - Phobos / Deimos: JPL SSD planetary-satellite mean orbital elements (Laplace plane, epoch J2000),
 *   propagated with constant rates. A mean-element approximation, not a JPL SPICE ephemeris.
 *
 * Frames:
 *   ICRF       — J2000 equatorial, unit vectors [x, y, z].
 *   Mars-inertial — +Z = Mars north pole, +X = ascending node of the Mars equator on the ICRF equator.
 *   Body-fixed — Mars-inertial rotated by W about +Z: +X at 0°E, +Y at 90°E, +Z north (planetocentric, east-positive).
 *   Scene (surface visor) — +X east, +Y up, +Z south.
 */

const DEG = Math.PI / 180;
const J2000_JD = 2451545.0;
const TT_MINUS_UTC_S = 69.184; // 37 leap seconds + 32.184 s, unchanged since 2017
const EARTH_OBLIQUITY_J2000 = 23.43928 * DEG;
const GALE_LAT_DEG = -4.8;
const GALE_LON_E_DEG = 137.4;

export const MARS_SOL_S = 88775.244;
export const MARS_MEAN_RADIUS_KM = 3389.5;
export const PHOBOS_PERIOD_S = 7 * 3600 + 39 * 60 + 13.8;
export const DEIMOS_PERIOD_S = 30 * 3600 + 17 * 60 + 55;
/** Sky rate that carries Phobos across a 0.35° solar disc in about 32 seconds. */
export const PHOBOS_SKY_RATE_RAD_S = (0.35 * DEG) / 32;
export const DEIMOS_SKY_RATE_RAD_S = (2 * Math.PI) / DEIMOS_PERIOD_S;

/** Bright stars, J2000 RA/Dec in degrees and visual magnitude. Real catalog entries, not a random field. */
export const BRIGHT_STARS = [
  [101.287, -16.716, -1.46], // Sirius
  [95.988, -52.696, -0.74], // Canopus
  [213.915, 19.182, -0.05], // Arcturus
  [219.902, -60.834, -0.01], // Rigil Kentaurus
  [279.234, 38.784, 0.03], // Vega
  [79.172, 45.998, 0.08], // Capella
  [78.634, -8.202, 0.13], // Rigel
  [114.825, 5.225, 0.34], // Procyon
  [88.793, 7.407, 0.5], // Betelgeuse
  [24.429, -57.237, 0.46], // Achernar
  [210.956, -60.373, 0.61], // Hadar
  [297.696, 8.868, 0.77], // Altair
  [186.649, -63.099, 0.76], // Acrux
  [68.98, 16.509, 0.85], // Aldebaran
  [201.298, -11.161, 0.97], // Spica
  [247.352, -26.432, 1.09], // Antares
  [116.329, 28.026, 1.14], // Pollux
  [344.413, -29.622, 1.16], // Fomalhaut
  [310.358, 45.28, 1.25], // Deneb
  [191.93, -59.689, 1.25], // Mimosa
  [152.093, 11.967, 1.4], // Regulus
  [104.656, -28.972, 1.5], // Adhara
  [113.649, 31.888, 1.58], // Castor
  [187.791, -57.113, 1.63], // Gacrux
  [263.402, -37.104, 1.62], // Shaula
  [81.283, 6.35, 1.64], // Bellatrix
  [81.573, 28.608, 1.65], // Elnath
  [138.3, -69.717, 1.68], // Miaplacidus
  [84.053, -1.202, 1.69], // Alnilam
  [332.058, -46.961, 1.74], // Alnair
  [85.19, -1.943, 1.77], // Alnitak
  [193.507, 55.96, 1.77], // Alioth
  [165.932, 61.751, 1.79], // Dubhe
  [51.081, 49.861, 1.79], // Mirfak
  [107.098, -26.393, 1.84], // Wezen
  [276.043, -34.385, 1.85], // Kaus Australis
  [125.628, -59.509, 1.86], // Avior
  [206.885, 49.313, 1.86], // Alkaid
  [89.882, 44.947, 1.9], // Menkalinan
  [252.166, -69.028, 1.91], // Atria
  [99.428, 16.399, 1.93], // Alhena
  [306.412, -56.735, 1.94], // Peacock
  [37.954, 89.264, 1.98], // Polaris
];

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function wrap360(deg) {
  return ((deg % 360) + 360) % 360;
}

/** Wrap to (-180, 180]. */
function wrap180(deg) {
  const w = wrap360(deg);
  return w > 180 ? w - 360 : w;
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ---------------------------------------------------------------- Mars24 time

export function julianDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Terrestrial Time Julian date. */
export function terrestrialJD(date) {
  return julianDate(date) + TT_MINUS_UTC_S / 86400;
}

const PBS_TERMS = [
  [0.0071, 2.2353, 49.409],
  [0.0057, 2.7543, 168.173],
  [0.0039, 1.1177, 191.837],
  [0.0037, 15.7866, 21.736],
  [0.0021, 2.1354, 15.704],
  [0.002, 2.4694, 95.528],
  [0.0018, 32.8493, 49.095],
];

/** Mars24 orbital quantities (degrees) for a date. */
export function marsOrbitState(date) {
  const dt = terrestrialJD(date) - J2000_JD;
  const M = wrap360(19.3871 + 0.52402073 * dt);
  const alphaFMS = 270.3871 + 0.524038496 * dt;
  let pbs = 0;
  for (const [A, tau, phi] of PBS_TERMS) pbs += A * Math.cos(((0.985626 * dt) / tau + phi) * DEG);
  const Mr = M * DEG;
  const nuMinusM =
    (10.691 + 3.0e-7 * dt) * Math.sin(Mr) +
    0.623 * Math.sin(2 * Mr) +
    0.05 * Math.sin(3 * Mr) +
    0.005 * Math.sin(4 * Mr) +
    0.0005 * Math.sin(5 * Mr) +
    pbs;
  const ls = wrap360(alphaFMS + nuMinusM);
  const lsr = ls * DEG;
  const eotDeg = 2.861 * Math.sin(2 * lsr) - 0.071 * Math.sin(4 * lsr) + 0.002 * Math.sin(6 * lsr) - nuMinusM;
  const decDeg = Math.asin(0.42565 * Math.sin(lsr)) / DEG + 0.25 * Math.sin(lsr);
  return { dtJ2000: dt, M, ls, nuMinusM, eotDeg, decDeg };
}

/** Areocentric solar longitude Ls, degrees. */
export function marsSolarLongitudeDeg(date) {
  return marsOrbitState(date).ls;
}

/** Mars Sol Date (Mars24 C-2). */
export function marsSolDate(date) {
  return (terrestrialJD(date) - 2451549.5) / 1.0274912517 + 44796.0 - 0.0009626;
}

/** Coordinated Mars Time (mean solar time at the prime meridian), hours [0, 24). */
export function coordinatedMarsTimeHours(date) {
  const h = (24 * marsSolDate(date)) % 24;
  return h < 0 ? h + 24 : h;
}

/** Local true solar time (hours [0,24)) at an east longitude. */
export function localTrueSolarTimeHours(date, lonEastDeg) {
  const { eotDeg } = marsOrbitState(date);
  const h = coordinatedMarsTimeHours(date) + lonEastDeg / 15 + eotDeg / 15;
  return ((h % 24) + 24) % 24;
}

/** Subsolar point: planetocentric latitude and east longitude (degrees, lon in (-180, 180]). */
export function subsolarPoint(date) {
  const { eotDeg, decDeg } = marsOrbitState(date);
  const westDeg = coordinatedMarsTimeHours(date) * 15 + eotDeg + 180;
  return { latDeg: decDeg, lonEastDeg: wrap180(-westDeg) };
}

export function heliocentricDistanceAu(lsDeg) {
  const e = 0.0934;
  const ls = lsDeg * DEG;
  return (1.52368 * (1 - e * e)) / (1 + e * Math.cos(ls - 251 * DEG));
}

/** Format hours as HH:MM. */
export function formatHoursHM(h) {
  const t = ((h % 24) + 24) % 24;
  let hh = Math.floor(t);
  let mm = Math.round((t - hh) * 60);
  if (mm === 60) {
    mm = 0;
    hh = (hh + 1) % 24;
  }
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// ------------------------------------------------------- Mars orientation (IAU)

function marsPoleAxes(date) {
  const T = (terrestrialJD(date) - J2000_JD) / 36525;
  const ra = (317.68143 - 0.1061 * T) * DEG;
  const dec = (52.8865 - 0.0609 * T) * DEG;
  const pole = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  const xAxis = norm([-pole[1], pole[0], 0]);
  const yAxis = cross(pole, xAxis);
  return { pole, xAxis, yAxis };
}

const J2000_AXES = marsPoleAxes(new Date(Date.UTC(2000, 0, 1, 12)));

/** IAU prime-meridian angle W, degrees. */
export function marsRotationAngleDeg(date) {
  const d = terrestrialJD(date) - J2000_JD;
  return wrap360(176.63 + 350.89198226 * d);
}

/** ICRF unit/any vector -> Mars-inertial vector. */
export function icrfToMarsInertial(v, axes = J2000_AXES) {
  return [dot(v, axes.xAxis), dot(v, axes.yAxis), dot(v, axes.pole)];
}

/** Mars-inertial vector -> body-fixed vector at a date. */
export function marsInertialToBodyFixed(v, date) {
  const w = marsRotationAngleDeg(date) * DEG;
  const c = Math.cos(w);
  const s = Math.sin(w);
  return [c * v[0] + s * v[1], -s * v[0] + c * v[1], v[2]];
}

/** J2000 vector into a frame whose +Z is the IAU Mars north pole (RA/Dec in that frame, radians). */
export function marsEquatorialRad(raDeg, decDeg) {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const c = Math.cos(dec);
  const m = icrfToMarsInertial([c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec)]);
  return { ra: Math.atan2(m[1], m[0]), dec: Math.asin(clamp(m[2], -1, 1)) };
}

/** Mars-inertial RA/Dec (radians) -> body-fixed unit vector. */
export function marsRaDecToBodyFixed(raRad, decRad, date) {
  const c = Math.cos(decRad);
  return marsInertialToBodyFixed([c * Math.cos(raRad), c * Math.sin(raRad), Math.sin(decRad)], date);
}

/** Body-fixed unit vector for planetocentric lat / east lon (degrees). */
export function lonLatToBodyFixed(lonEastDeg, latDeg) {
  const la = latDeg * DEG;
  const lo = lonEastDeg * DEG;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

/**
 * Body-fixed direction (or a vector already relative to the observer) -> local horizon.
 * Returns elevation/azimuth (radians, azimuth north->east) and the scene unit vector (+X east, +Y up, +Z south).
 */
export function bodyFixedToHorizon(v, latDeg, lonEastDeg) {
  const la = latDeg * DEG;
  const lo = lonEastDeg * DEG;
  const E = [-Math.sin(lo), Math.cos(lo), 0];
  const N = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const U = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const n = norm(v);
  const e = dot(n, E);
  const nn = dot(n, N);
  const u = dot(n, U);
  return { el: Math.asin(clamp(u, -1, 1)), az: Math.atan2(e, nn), x: e, y: u, z: -nn };
}

/** Elevation/azimuth to scene unit vector (+X east, +Y up, +Z south). */
export function altAzToScene(el, az) {
  const c = Math.cos(el);
  return { x: c * Math.sin(az), y: Math.sin(el), z: -c * Math.cos(az) };
}

/**
 * Classical horizon transform for a Mars-equatorial RA/Dec, kept for callers that track a local
 * sidereal angle themselves. Azimuth is from north toward east.
 */
export function horizonOf(raRad, decRad, lstRad, latRad = GALE_LAT_DEG * DEG) {
  const ha = lstRad - raRad;
  const sinEl = Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(ha);
  const el = Math.asin(clamp(sinEl, -1, 1));
  const east = -Math.cos(decRad) * Math.sin(ha);
  const north = Math.cos(latRad) * Math.sin(decRad) - Math.sin(latRad) * Math.cos(decRad) * Math.cos(ha);
  return { el, az: Math.atan2(east, north) };
}

// --------------------------------------------------- planets (JPL mean elements)

const PLANET_ELEMENTS = {
  // a (AU), e, I, L, long. peri, long. node (deg) and their per-century rates
  earth: [
    [1.00000261, 0.00000562],
    [0.01671123, -0.00004392],
    [-0.00001531, -0.01294668],
    [100.46457166, 35999.37244981],
    [102.93768193, 0.32327364],
    [0.0, 0.0],
  ],
  mars: [
    [1.52371034, 0.00001847],
    [0.0933941, 0.00007882],
    [1.84969142, -0.00813131],
    [-4.55343205, 19140.30268499],
    [-23.94362959, 0.44441088],
    [49.55953891, -0.29257343],
  ],
};

function solveKepler(M, e) {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return E;
}

/** Heliocentric ICRF position (AU) of "earth" or "mars". */
export function heliocentricIcrfAu(planet, date) {
  const T = (terrestrialJD(date) - J2000_JD) / 36525;
  const el = PLANET_ELEMENTS[planet].map(([v0, rate]) => v0 + rate * T);
  const [a, e, I, L, varpi, Omega] = el;
  const w = (varpi - Omega) * DEG;
  const M = wrap180(L - varpi) * DEG;
  const E = solveKepler(M, e);
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const cO = Math.cos(Omega * DEG);
  const sO = Math.sin(Omega * DEG);
  const cI = Math.cos(I * DEG);
  const sI = Math.sin(I * DEG);
  const xe = (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp;
  const ye = (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp;
  const ze = sw * sI * xp + cw * sI * yp;
  const ce = Math.cos(EARTH_OBLIQUITY_J2000);
  const se = Math.sin(EARTH_OBLIQUITY_J2000);
  return [xe, ce * ye - se * ze, se * ye + ce * ze];
}

/** Sun direction from Mars in the body-fixed frame (unit) and distance in AU, from the planet elements. */
export function sunBodyFixedFromElements(date) {
  const m = heliocentricIcrfAu("mars", date);
  const v = marsInertialToBodyFixed(icrfToMarsInertial([-m[0], -m[1], -m[2]]), date);
  return { dir: norm(v), au: Math.hypot(m[0], m[1], m[2]) };
}

/** Earth direction from Mars in the body-fixed frame (unit) and distance in AU. */
export function earthBodyFixed(date) {
  const m = heliocentricIcrfAu("mars", date);
  const e = heliocentricIcrfAu("earth", date);
  const d = [e[0] - m[0], e[1] - m[1], e[2] - m[2]];
  return { dir: norm(marsInertialToBodyFixed(icrfToMarsInertial(d), date)), au: Math.hypot(d[0], d[1], d[2]) };
}

// ------------------------------------------------------ moons (JPL mean elements)

/**
 * Phobos / Deimos: compact series in the Mars-inertial frame, least-squares fitted (2026-11-14) to
 * JPL Horizons state vectors (ICRF, Mars-centred, 10-day steps over 2014–2040).
 * Longitude λ = n·d + L0 + L1·t + L2·t² + equation-of-centre terms (apsides precessing at `wdot`),
 * latitude β = node-regressing inclination terms (`ndot`) + a fixed Laplace-plane tilt term.
 * d = TT days from J2000, t = (d - 9500) / 1000. Fit residuals: ≤0.04° in λ, ≤0.012° in β over the fit span.
 * Radii use the mean distance (Phobos e ≈ 0.015 → ±140 km is ignored).
 */
export const MARS_MOONS = {
  phobos: {
    aKm: 9376.0,
    radiusKm: 11.08,
    n: 1128.8447569,
    L: [216.025693, 0.17824581, 0.00963173],
    ec: [1.62555088, -0.59833284, -0.00750858, 0.00665374],
    wdot: 0.43573222,
    lat: [-1.05403528, -0.21201625, 0.01017302, 0.02399854],
    ndot: -0.43573222,
  },
  deimos: {
    aKm: 23457.5,
    radiusKm: 6.2,
    n: 285.161879,
    L: [258.744517, -0.06011435, -0.00243774],
    ec: [0.00897606, -0.01726494, 0.00054477, 0.00219646],
    wdot: 0.03650468,
    lat: [1.05971772, -1.43893754, -0.63735052, 0.63109342],
    ndot: -0.01807262,
  },
};

/** Position (km) of "phobos" or "deimos" in the Mars-inertial frame. */
export function marsMoonInertial(name, date) {
  const m = MARS_MOONS[name];
  const d = terrestrialJD(date) - J2000_JD;
  const t = (d - 9500) / 1000;
  const lamMean = m.n * d + m.L[0] + m.L[1] * t + m.L[2] * t * t;
  const lm = (lamMean - m.wdot * d) * DEG;
  const lam =
    (lamMean + m.ec[0] * Math.sin(lm) + m.ec[1] * Math.cos(lm) + m.ec[2] * Math.sin(2 * lm) + m.ec[3] * Math.cos(2 * lm)) * DEG;
  const u = lam - m.ndot * d * DEG;
  const beta =
    (m.lat[0] * Math.sin(u) + m.lat[1] * Math.cos(u) + m.lat[2] * Math.sin(lam) + m.lat[3] * Math.cos(lam)) * DEG;
  const cb = Math.cos(beta);
  return [m.aKm * cb * Math.cos(lam), m.aKm * cb * Math.sin(lam), m.aKm * Math.sin(beta)];
}

/** Position (km) of "phobos" or "deimos" in the Mars body-fixed frame. */
export function marsMoonBodyFixed(name, date) {
  return marsInertialToBodyFixed(marsMoonInertial(name, date), date);
}

/** Topocentric direction of a moon from a surface point, as horizon + scene vector. */
export function moonFromSurface(name, date, latDeg, lonEastDeg) {
  const m = marsMoonBodyFixed(name, date);
  const o = lonLatToBodyFixed(lonEastDeg, latDeg).map((c) => c * MARS_MEAN_RADIUS_KM);
  const rel = [m[0] - o[0], m[1] - o[1], m[2] - o[2]];
  return { ...bodyFixedToHorizon(rel, latDeg, lonEastDeg), distKm: Math.hypot(rel[0], rel[1], rel[2]) };
}

// ------------------------------------------------------------------ sun states

/**
 * Sun (and sky frame) state at a surface point.
 * With `ltstHours` set, the date is shifted to the nearest moment (within ±12 h) when that point
 * has that local true solar time, so the sun, stars, Earth and moons stay mutually consistent.
 */
export function sunStateAt(date = new Date(), { latDeg = GALE_LAT_DEG, lonEastDeg = GALE_LON_E_DEG, ltstHours = null } = {}) {
  let effDate = date;
  const realLtst = localTrueSolarTimeHours(date, lonEastDeg);
  if (ltstHours != null && Number.isFinite(ltstHours)) {
    let dh = ltstHours - realLtst;
    dh = ((dh + 12) % 24 + 24) % 24 - 12;
    effDate = new Date(date.getTime() + (dh / 24) * MARS_SOL_S * 1000);
  }
  const orbit = marsOrbitState(effDate);
  const sub = subsolarPoint(effDate);
  const h = bodyFixedToHorizon(lonLatToBodyFixed(sub.lonEastDeg, sub.latDeg), latDeg, lonEastDeg);
  const rAu = heliocentricDistanceAu(orbit.ls);
  return {
    x: h.x,
    y: h.y,
    z: h.z,
    elevationRad: h.el,
    azimuthRad: h.az,
    declinationRad: orbit.decDeg * DEG,
    lsDeg: orbit.ls,
    ltstHours: localTrueSolarTimeHours(effDate, lonEastDeg),
    realLtstHours: realLtst,
    lstRad: (marsRotationAngleDeg(effDate) + lonEastDeg) * DEG,
    latDeg,
    lonEastDeg,
    date: effDate,
    realDate: date,
    subsolar: sub,
    rAu,
    sunAngularRad: 0.00935 / rAu, // ~0.35° at 1.524 AU, full diameter in radians
    fluxWm2: 590 * (1.524 / rAu) ** 2,
  };
}

/** Sun at Gale for a fixed local true solar time so the visor opens in daylight. */
export function galeSunState(date = new Date(), ltstHours = 15) {
  return sunStateAt(date, { latDeg: GALE_LAT_DEG, lonEastDeg: GALE_LON_E_DEG, ltstHours });
}

/** Earth as seen from a surface point (defaults to Gale). */
export function earthFromGale(date, _lstRad, latDeg = GALE_LAT_DEG, lonEastDeg = GALE_LON_E_DEG) {
  return bodyFixedToHorizon(earthBodyFixed(date).dir, latDeg, lonEastDeg);
}
