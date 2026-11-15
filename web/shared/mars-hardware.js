/**
 * Mars surface hardware and orbiters (`web/shared/mars-hardware.js`).
 *
 * Eight surface units (5 rovers, 3 landers) with the coordinates, dimensions and masses the team
 * specified on 15 November 2026 for the Site Deployment Selector, plus six orbiters for the Orbit
 * view. Pure data (no Three.js / DOM) so tests, the 3D view and the orbit view share it.
 *
 * Honesty notes:
 * - Coordinates are the published landing-site coordinates (east-positive, planetocentric as commonly
 *   cited by NASA / mission pages). For rovers that drove far (Spirit, Opportunity, Curiosity,
 *   Perseverance) the unit is shown at the listed point, not at its end-of-mission / current position.
 * - Orbiter altitudes and inclinations are nominal science-orbit values from the agency mission pages.
 *   The orbit plane orientation and the position along the orbit are NOT live ephemerides: the Orbit
 *   view draws them as illustrative tracks and says so.
 * - The 3D sites away from the Gale HiRISE tile use seeded procedural relief, not mapped topography.
 */

import { getHistoricRoverById } from "./mars-rovers.js";

/** Staging pad distance from the hardware (m). */
export const STAGING_PAD_DISTANCE_M = 15;

/** @type {readonly object[]} */
export const MARS_SURFACE_HARDWARE = Object.freeze([
  {
    id: "sojourner",
    kind: "rover",
    name: "Sojourner",
    mission: "Mars Pathfinder",
    agency: "NASA / JPL",
    years: "1997",
    lat: 19.13,
    lon: -33.22, // 326.78°E
    site: "Ares Vallis",
    lengthM: 0.65,
    widthM: 0.48,
    heightM: 0.3,
    massKg: 11.5,
    noteEn: "6-wheel rocker-bogie micro-rover with a flat solar deck.",
    noteTr: "Düz güneş paneli tablalı, 6 tekerlekli rocker-bogie mikro gezgin.",
    nasaUrl: "https://science.nasa.gov/mission/mars-pathfinder/",
  },
  {
    id: "spirit",
    kind: "rover",
    name: "Spirit",
    mission: "MER-A",
    agency: "NASA / JPL",
    years: "2004–2010",
    lat: -14.5718,
    lon: 175.4785,
    site: "Gusev Crater · Columbia Hills",
    lengthM: 1.6,
    widthM: 2.3,
    heightM: 1.5,
    massKg: 185,
    noteEn: "Solar-winged Mars Exploration Rover; width is with the wings deployed.",
    noteTr: "Güneş kanatlı Mars Exploration Rover; genişlik kanatlar açıkken.",
    nasaUrl: "https://science.nasa.gov/mission/mer-spirit/",
  },
  {
    id: "opportunity",
    kind: "rover",
    name: "Opportunity",
    mission: "MER-B",
    agency: "NASA / JPL",
    years: "2004–2018",
    lat: -1.9462,
    lon: -5.5266, // 354.4734°E
    site: "Meridiani Planum",
    lengthM: 1.6,
    widthM: 2.3,
    heightM: 1.5,
    massKg: 185,
    noteEn: "Twin of Spirit; drove more than a marathon across Meridiani Planum.",
    noteTr: "Spirit'in ikizi; Meridiani Planum'da bir maratondan uzun yol katetti.",
    nasaUrl: "https://science.nasa.gov/mission/mer-opportunity/",
  },
  {
    id: "curiosity",
    kind: "rover",
    name: "Curiosity",
    mission: "MSL",
    agency: "NASA / JPL",
    years: "2012–present",
    lat: -4.5895,
    lon: 137.4417,
    site: "Gale Crater · Bradbury Landing",
    lengthM: 3.0,
    widthM: 2.7,
    heightM: 2.2,
    massKg: 899,
    noteEn: "Nuclear (MMRTG) rover with ChemCam mast and robotic arm. Shown at its landing site; it has since climbed Mount Sharp.",
    noteTr: "ChemCam direği ve robot kolu olan nükleer (MMRTG) gezgin. İniş noktasında gösterilir; o günden beri Mount Sharp'a tırmandı.",
    nasaUrl: "https://science.nasa.gov/mission/msl-curiosity/",
  },
  {
    id: "perseverance",
    kind: "rover",
    name: "Perseverance",
    mission: "Mars 2020 + Ingenuity",
    agency: "NASA / JPL",
    years: "2021–present",
    lat: 18.38,
    lon: 77.58,
    site: "Jezero Crater",
    lengthM: 3.0,
    widthM: 2.7,
    heightM: 2.2,
    massKg: 1025,
    companion: {
      id: "ingenuity",
      name: "Ingenuity",
      fuselageM: [0.14, 0.2],
      rotorSpanM: 1.2,
      heightM: 0.49,
      massKg: 1.8,
    },
    noteEn: "Sample-caching rover. The Ingenuity helicopter (1.2 m rotors, 1.8 kg) stands nearby.",
    noteTr: "Numune toplayan gezgin. Ingenuity helikopteri (1,2 m rotor, 1,8 kg) yakınında durur.",
    nasaUrl: "https://science.nasa.gov/mission/mars-2020-perseverance/",
  },
  {
    id: "viking1",
    kind: "lander",
    name: "Viking 1 Lander",
    mission: "Viking 1",
    agency: "NASA",
    years: "1976",
    lat: 22.697,
    lon: -48.222, // 311.778°E
    site: "Chryse Planitia",
    lengthM: 3.0,
    widthM: 3.0,
    heightM: 2.2,
    massKg: 572,
    noteEn: "Three-legged lander with two covered RTGs, a dish antenna and a surface sampler arm.",
    noteTr: "İki kapaklı RTG, çanak anten ve yüzey numune kolu olan üç ayaklı iniş aracı.",
    nasaUrl: "https://science.nasa.gov/mission/viking-1/",
    terrainProfile: {
      palette: { dust: [176, 104, 66], rock: [92, 62, 48], skyHorizon: [0.66, 0.46, 0.33], fogHex: 0xa87454 },
      seed: 1976,
      reliefM: 16,
      boulderDensity: 1.5,
    },
  },
  {
    id: "phoenix",
    kind: "lander",
    name: "Phoenix Mars Lander",
    mission: "Phoenix",
    agency: "NASA / JPL / Univ. of Arizona",
    years: "2008",
    lat: 68.2188,
    lon: -125.7492, // 234.2508°E
    site: "Vastitas Borealis · Green Valley",
    lengthM: 5.5,
    widthM: 1.5,
    heightM: 2.2,
    massKg: 350,
    noteEn: "Polar lander: 5.5 m across its two round solar arrays, 1.5 m deck, digging arm.",
    noteTr: "Kutup iniş aracı: iki yuvarlak güneş paneliyle 5,5 m açıklık, 1,5 m güverte, kazı kolu.",
    nasaUrl: "https://science.nasa.gov/mission/phoenix/",
    terrainProfile: {
      palette: { dust: [186, 150, 122], rock: [110, 92, 80], skyHorizon: [0.66, 0.52, 0.4], fogHex: 0xb08a6c },
      seed: 2008,
      reliefM: 6,
      boulderDensity: 0.7,
    },
  },
  {
    id: "insight",
    kind: "lander",
    name: "InSight Lander",
    mission: "InSight",
    agency: "NASA / JPL",
    years: "2018–2022",
    lat: 4.5024,
    lon: 135.6234,
    site: "Elysium Planitia",
    lengthM: 6.0,
    widthM: 1.56,
    heightM: 1.0,
    massKg: 358,
    noteEn: "Geophysics lander: 6 m across two round solar wings, with the SEIS seismometer dome on the ground.",
    noteTr: "Jeofizik iniş aracı: iki yuvarlak güneş kanadıyla 6 m açıklık, yerde SEIS sismometre kubbesi.",
    nasaUrl: "https://science.nasa.gov/mission/insight/",
    terrainProfile: {
      palette: { dust: [166, 102, 68], rock: [84, 60, 48], skyHorizon: [0.63, 0.45, 0.32], fogHex: 0xa07052 },
      seed: 2018,
      reliefM: 5,
      boulderDensity: 0.6,
    },
  },
]);

export function getSurfaceHardwareById(id) {
  const key = String(id || "").toLowerCase();
  return MARS_SURFACE_HARDWARE.find((h) => h.id === key) || null;
}

/** East-positive 0..360 longitude. */
export function lonEast360(lon) {
  return ((Number(lon) % 360) + 360) % 360;
}

/** "19.13°N, 326.78°E" */
export function formatHardwareLatLon(hw, decimals = 4) {
  const trim = (v) => String(Number(v.toFixed(decimals)));
  return `${trim(Math.abs(hw.lat))}°${hw.lat >= 0 ? "N" : "S"}, ${trim(lonEast360(hw.lon))}°E`;
}

/** "3.00 × 2.70 × 2.20 m" (length × width × height) */
export function formatHardwareDims(hw) {
  return `${hw.lengthM.toFixed(2)} × ${hw.widthM.toFixed(2)} × ${hw.heightM.toFixed(2)} m`;
}

/**
 * Site record (shaped like a rover / custom site entry) for the 3D view: seeded procedural relief
 * centred on the hardware's exact coordinates. The hardware stands at the scene origin and the
 * staging pad is STAGING_PAD_DISTANCE_M south of it.
 */
export function makeHardwareSiteSpec(hwOrId) {
  const hw = typeof hwOrId === "string" ? getSurfaceHardwareById(hwOrId) : hwOrId;
  if (!hw) return null;
  const rover = hw.kind === "rover" ? getHistoricRoverById(hw.id) : null;
  const terrainProfile = hw.terrainProfile || rover?.terrainProfile;
  return {
    id: `hardware:${hw.id}`,
    hardwareId: hw.id,
    isHardwareSite: true,
    isCustomSite: true,
    isHiRiseGaleSite: false,
    nearRoverId: null,
    name: hw.name,
    mission: hw.mission,
    agency: hw.agency,
    status: "HARDWARE SITE",
    color: rover?.color || "#fbbf24",
    lon: hw.lon,
    lat: hw.lat,
    landingSite: hw.site,
    siteShortName: hw.site.split("·")[0].trim().toUpperCase(),
    siteElevM: null,
    lengthM: hw.lengthM,
    terrainProfile,
  };
}

// ---------------------------------------------------------------------------------------------
// Orbiters
// ---------------------------------------------------------------------------------------------
export const MARS_GM_KM3_S2 = 42828.37;
export const MARS_EQ_RADIUS_KM = 3396.19;

/**
 * periKm / apoKm: altitude above the surface. incDeg: nominal inclination. raanDeg / argPeriDeg /
 * phaseDeg only spread the illustrative tracks apart; they are not real orbital elements.
 */
export const MARS_ORBITERS = Object.freeze([
  {
    id: "odyssey",
    name: "2001 Mars Odyssey",
    agency: "NASA",
    since: 2001,
    periKm: 400,
    apoKm: 400,
    incDeg: 93.1,
    raanDeg: 20,
    argPeriDeg: 0,
    phaseDeg: 0,
    color: "#f59e0b",
    role: "THEMIS thermal mapper · communications relay",
  },
  {
    id: "mex",
    name: "Mars Express",
    agency: "ESA",
    since: 2003,
    periKm: 298,
    apoKm: 10107,
    incDeg: 86.3,
    raanDeg: 75,
    argPeriDeg: 345,
    phaseDeg: 140,
    color: "#38bdf8",
    role: "HRSC stereo camera · MARSIS radar",
  },
  {
    id: "mro",
    name: "Mars Reconnaissance Orbiter",
    agency: "NASA",
    since: 2006,
    periKm: 250,
    apoKm: 316,
    incDeg: 93.0,
    raanDeg: 140,
    argPeriDeg: 270,
    phaseDeg: 60,
    color: "#22c55e",
    role: "HiRISE 1 m camera · CTX · CRISM",
  },
  {
    id: "maven",
    name: "MAVEN",
    agency: "NASA",
    since: 2014,
    periKm: 150,
    apoKm: 6200,
    incDeg: 75,
    raanDeg: 210,
    argPeriDeg: 30,
    phaseDeg: 220,
    color: "#f472b6",
    role: "Upper atmosphere · solar-wind interaction",
  },
  {
    id: "tgo",
    name: "ExoMars Trace Gas Orbiter",
    agency: "ESA / Roscosmos",
    since: 2016,
    periKm: 400,
    apoKm: 400,
    incDeg: 74,
    raanDeg: 280,
    argPeriDeg: 0,
    phaseDeg: 300,
    color: "#a78bfa",
    role: "Atmospheric trace gases · data relay",
  },
  {
    id: "hope",
    name: "Hope (Emirates Mars Mission)",
    agency: "UAE Space Agency / MBRSC",
    since: 2021,
    periKm: 20000,
    apoKm: 43000,
    incDeg: 25,
    raanDeg: 330,
    argPeriDeg: 180,
    phaseDeg: 90,
    color: "#fb7185",
    role: "Global weather · climate dynamics",
  },
]);

/** Semi-major axis (km), eccentricity and Keplerian period (s) from the altitudes. */
export function orbiterElements(o) {
  const rp = MARS_EQ_RADIUS_KM + o.periKm;
  const ra = MARS_EQ_RADIUS_KM + o.apoKm;
  const a = (rp + ra) / 2;
  const e = (ra - rp) / (ra + rp);
  const periodS = 2 * Math.PI * Math.sqrt((a * a * a) / MARS_GM_KM3_S2);
  return { a, e, periodS };
}

function solveKepler(M, e) {
  let E = M;
  for (let i = 0; i < 12; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return E;
}

/** Position (km) in a Mars-equatorial inertial frame (z = north pole) at mean anomaly M (rad). */
export function orbiterPositionAtAnomaly(o, M) {
  const { a, e } = orbiterElements(o);
  const E = solveKepler(M, e);
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const d = Math.PI / 180;
  const w = o.argPeriDeg * d;
  const i = o.incDeg * d;
  const O = o.raanDeg * d;
  const x1 = xp * Math.cos(w) - yp * Math.sin(w);
  const y1 = xp * Math.sin(w) + yp * Math.cos(w);
  const y2 = y1 * Math.cos(i);
  const z2 = y1 * Math.sin(i);
  return [x1 * Math.cos(O) - y2 * Math.sin(O), x1 * Math.sin(O) + y2 * Math.cos(O), z2];
}

/** Position (km, Mars-equatorial inertial) at a time in seconds since an arbitrary epoch. */
export function orbiterPositionKm(o, tSeconds) {
  const { periodS } = orbiterElements(o);
  const M = (o.phaseDeg * Math.PI) / 180 + (2 * Math.PI * tSeconds) / periodS;
  return orbiterPositionAtAnomaly(o, M);
}
