/**
 * Gale sun, star hour angles, and moon rates for the visor.
 * Solar longitude follows the NASA GISS Mars24 / Allison & McEwen coefficients.
 * Star places use the IAU 2015 Mars pole. This is not a JPL ephemeris.
 * Scene axes: +X east, +Y up, +Z south.
 */

const DEG = Math.PI / 180;
const J2000_JD = 2451545.0;
const OBLIQUITY = 25.19 * DEG;
const GALE_LAT = -4.8 * DEG;
const POLE_RA = 317.68143;
const POLE_DEC = 52.8865;

export const PHOBOS_PERIOD_S = 7 * 3600 + 39 * 60 + 13.8;
export const DEIMOS_PERIOD_S = 30 * 3600 + 17 * 60 + 55;
/** Sky rate that carries Phobos across a 0.35° solar disc in about 32 seconds. */
export const PHOBOS_SKY_RATE_RAD_S = (0.35 * DEG) / 32;
export const DEIMOS_SKY_RATE_RAD_S = (2 * Math.PI) / DEIMOS_PERIOD_S;

/** Bright stars, J2000 RA/Dec in degrees and visual magnitude. Real catalog entries, not a random field. */
export const BRIGHT_STARS = [
  [101.287, -16.716, -1.46],
  [95.988, -52.696, -0.74],
  [213.915, 19.182, -0.05],
  [219.902, -60.834, -0.01],
  [279.234, 38.784, 0.03],
  [79.172, 45.998, 0.08],
  [78.634, -8.202, 0.13],
  [114.825, 5.225, 0.34],
  [88.793, 7.407, 0.5],
  [24.429, -57.237, 0.46],
  [210.956, -60.373, 0.61],
  [297.696, 8.868, 0.77],
  [186.649, -63.099, 0.76],
  [68.98, 16.509, 0.85],
  [201.298, -11.161, 0.97],
  [247.352, -26.432, 1.09],
  [116.329, 28.026, 1.14],
  [344.413, -29.622, 1.16],
  [310.358, 45.28, 1.25],
  [191.93, -59.689, 1.25],
  [152.093, 11.967, 1.4],
  [104.656, -28.972, 1.5],
  [113.649, 31.888, 1.58],
  [187.791, -57.113, 1.63],
  [263.402, -37.104, 1.62],
  [81.283, 6.35, 1.64],
  [81.573, 28.608, 1.65],
  [138.3, -69.717, 1.68],
  [84.053, -1.202, 1.69],
  [332.058, -46.961, 1.74],
  [85.19, -1.943, 1.77],
  [193.507, 55.96, 1.77],
  [165.932, 61.751, 1.79],
  [51.081, 49.861, 1.79],
  [107.098, -26.393, 1.84],
  [276.043, -34.385, 1.85],
  [125.628, -59.509, 1.86],
  [206.885, 49.313, 1.86],
  [89.882, 44.947, 1.9],
  [252.166, -69.028, 1.91],
  [99.428, 16.399, 1.93],
  [306.412, -56.735, 1.94],
  [37.954, 89.264, 1.98],
  [114.827, -26.431, 1.5],
  [107.098, -26.393, 1.84],
];

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function wrap360(deg) {
  return ((deg % 360) + 360) % 360;
}

export function julianDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Areocentric solar longitude, degrees, Mars24 equation of centre. */
export function marsSolarLongitudeDeg(date) {
  const d = julianDate(date) - J2000_JD;
  const Mdeg = wrap360(19.387 + 0.52402075 * d);
  const Mr = Mdeg * DEG;
  const alpha = 270.3863 + 0.5240384 * d;
  const centre =
    (10.691 + 3e-7 * d) * Math.sin(Mr) +
    0.623 * Math.sin(2 * Mr) +
    0.05 * Math.sin(3 * Mr) +
    0.005 * Math.sin(4 * Mr) +
    0.0005 * Math.sin(5 * Mr);
  return wrap360(alpha + centre);
}

export function heliocentricDistanceAu(lsDeg) {
  const e = 0.0934;
  const ls = lsDeg * DEG;
  return (1.52368 * (1 - e * e)) / (1 + e * Math.cos(ls - 251 * DEG));
}

/** J2000 vector into a frame whose +Z is the IAU 2015 Mars north pole. */
export function marsEquatorialRad(raDeg, decDeg) {
  const poleRa = POLE_RA * DEG;
  const poleDec = POLE_DEC * DEG;
  const cp = Math.cos(poleDec);
  const pole = [cp * Math.cos(poleRa), cp * Math.sin(poleRa), Math.sin(poleDec)];
  let xAxis = [-pole[1], pole[0], 0];
  const xl = Math.hypot(xAxis[0], xAxis[1], xAxis[2]) || 1;
  xAxis = [xAxis[0] / xl, xAxis[1] / xl, xAxis[2] / xl];
  const yAxis = [
    pole[1] * xAxis[2] - pole[2] * xAxis[1],
    pole[2] * xAxis[0] - pole[0] * xAxis[2],
    pole[0] * xAxis[1] - pole[1] * xAxis[0],
  ];
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const c = Math.cos(dec);
  const s = [c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec)];
  const mx = s[0] * xAxis[0] + s[1] * xAxis[1] + s[2] * xAxis[2];
  const my = s[0] * yAxis[0] + s[1] * yAxis[1] + s[2] * yAxis[2];
  const mz = s[0] * pole[0] + s[1] * pole[1] + s[2] * pole[2];
  return { ra: Math.atan2(my, mx), dec: Math.asin(clamp(mz, -1, 1)) };
}

/**
 * Local horizon at Gale. Azimuth is from north toward east.
 * lstRad is local sidereal-like angle in the same Mars-equatorial RA zero as the stars.
 */
export function horizonOf(raRad, decRad, lstRad, latRad = GALE_LAT) {
  const ha = lstRad - raRad;
  const sinEl = Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(ha);
  const el = Math.asin(clamp(sinEl, -1, 1));
  const east = -Math.cos(decRad) * Math.sin(ha);
  const north = Math.cos(latRad) * Math.sin(decRad) - Math.sin(latRad) * Math.cos(decRad) * Math.cos(ha);
  const az = Math.atan2(east, north);
  return { el, az };
}

export function altAzToScene(el, az) {
  const c = Math.cos(el);
  const len = Math.hypot(c * Math.sin(az), Math.sin(el), -c * Math.cos(az)) || 1;
  return {
    x: (c * Math.sin(az)) / len,
    y: Math.sin(el) / len,
    z: (-c * Math.cos(az)) / len,
  };
}

/**
 * Sun at Gale for a fixed local true solar time so the visor opens in daylight.
 * `ltstHours` 15 is mid-afternoon, the previous hardcoded light.
 */
export function galeSunState(date = new Date(), ltstHours = 15) {
  const lsDeg = marsSolarLongitudeDeg(date);
  const ls = lsDeg * DEG;
  const dec = Math.asin(clamp(Math.sin(OBLIQUITY) * Math.sin(ls), -1, 1));
  const H = 15 * (ltstHours - 12) * DEG;
  const phi = GALE_LAT;
  const sinEl = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
  const el = Math.asin(clamp(sinEl, -1, 1));
  const east = -Math.cos(dec) * Math.sin(H);
  const north = Math.cos(phi) * Math.sin(dec) - Math.sin(phi) * Math.cos(dec) * Math.cos(H);
  const az = Math.atan2(east, north);
  const dir = altAzToScene(el, az);
  const rAu = heliocentricDistanceAu(lsDeg);
  const sunAngularRad = 0.00935 / rAu; // ~0.35° at 1.524 AU, full diameter in radians
  const fluxWm2 = 590 * (1.524 / rAu) ** 2;
  const lst = H + ls;
  return {
    ...dir,
    elevationRad: el,
    azimuthRad: az,
    declinationRad: dec,
    lsDeg,
    ltstHours,
    lstRad: lst,
    rAu,
    sunAngularRad,
    fluxWm2,
  };
}

/** Earth as seen from Mars, circular orbits, then the same horizon frame as the stars. */
export function earthFromGale(date, lstRad) {
  const d = julianDate(date) - J2000_JD;
  const le = wrap360(100.464 + 0.985609 * d) * DEG;
  const lm = wrap360(355.453 + 0.524039 * d) * DEG;
  const ls = marsSolarLongitudeDeg(date);
  const rm = heliocentricDistanceAu(ls);
  const vx = Math.cos(le) - rm * Math.cos(lm);
  const vy = Math.sin(le) - rm * Math.sin(lm);
  const vz = 0;
  // Tilt the ecliptic vector by Mars obliquity into the equatorial frame used with Ls.
  const dec = Math.asin(clamp(Math.sin(OBLIQUITY) * vy / (Math.hypot(vx, vy, vz) || 1), -1, 1));
  const ra = Math.atan2(vy * Math.cos(OBLIQUITY), vx);
  return horizonOf(ra, dec, lstRad);
}
