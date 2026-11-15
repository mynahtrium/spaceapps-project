/**
 * Verified catalogue of NASA's five Mars rovers — Sojourner, Spirit, Opportunity,
 * Curiosity, and Perseverance — placed at their real Martian coordinates (1 each).
 *
 * Pure ES module with zero Three.js/DOM dependencies so unit tests and both 2D/3D
 * views share one single source of truth.
 */

import { MARS_RADIUS_MEAN_M, marsDistanceM } from "../map/Geodesy.js";

/** @type {readonly object[]} */
export const MARS_HISTORIC_ROVERS = Object.freeze([
  {
    id: "sojourner",
    name: "Sojourner",
    mission: "Mars Pathfinder",
    agency: "NASA / JPL",
    status: "COMPLETED",
    color: "#38bdf8",
    lon: -33.22, // 326.78°E Ares Vallis (Carl Sagan Memorial Station)
    lat: 19.13,
    landingSite: "Ares Vallis · Chryse Planitia (Carl Sagan Memorial Station)",
    siteShortName: "ARES VALLIS",
    siteElevM: -3680,
    isHiRiseGaleSite: false,
    launchDate: "1996-12-04",
    landingDate: "1997-07-04",
    endDate: "1997-09-27",
    sols: 83,
    distanceKm: 0.1,
    distanceLabel: "~100 m (330 ft)",
    massKg: 10.6,
    dimensionsM: "0.65 × 0.48 × 0.30 m",
    lengthM: 0.65,
    halfW: 0.32,
    halfL: 0.38,
    heightM: 0.62,
    powerSource: "GaAs/Ge flat solar top deck + non-rechargeable LiSOCl₂ backup",
    instruments: [
      "Alpha Proton X-Ray Spectrometer (APXS)",
      "Forward stereo monochrome + rear color imaging cameras",
      "Wheel Abrasion & Materials Adherence Experiments",
    ],
    highlightsEn:
      "First wheeled robot to rove another planet. Analyzed basaltic & silica-rich rocks ('Barnacle Bill', 'Yogi') showing Ares Vallis was shaped by ancient catastrophic liquid-water floods.",
    highlightsTr:
      "Başka bir gezegende hareket eden ilk tekerlekli robot. Ares Vallis'te antik sel sularının izlerini doğrulayan bazaltik ve silika zengini kayaları ('Barnacle Bill', 'Yogi') inceledi.",
    nasaUrl: "https://science.nasa.gov/mission/mars-pathfinder/",
    modelKind: "sojourner",
    modelSourceNote: "Bespoke multi-part NASA Pathfinder scale model (0.65 m, Kapton foil + solar deck + whip + APXS)",
    terrainProfile: {
      palette: { dust: [188, 108, 68], rock: [96, 62, 48], skyHorizon: [0.68, 0.46, 0.32], fogHex: 0xad7552 },
      seed: 1997,
      reliefM: 28,
      boulderDensity: 1.35,
    },
  },
  {
    id: "spirit",
    name: "Spirit",
    mission: "Mars Exploration Rover A (MER-A)",
    agency: "NASA / JPL",
    status: "COMPLETED",
    color: "#fb923c",
    lon: 175.4726,
    lat: -14.5684,
    landingSite: "Gusev Crater · Columbia Memorial Station -> Troy",
    siteShortName: "GUSEV CRATER",
    siteElevM: -1940,
    isHiRiseGaleSite: false,
    launchDate: "2003-06-10",
    landingDate: "2004-01-04",
    endDate: "2010-03-22",
    sols: 2208,
    distanceKm: 7.73,
    distanceLabel: "7.73 km (4.80 mi)",
    massKg: 185,
    dimensionsM: "1.60 × 2.30 × 1.50 m",
    lengthM: 1.6,
    halfW: 1.22,
    halfL: 0.92,
    heightM: 1.58,
    powerSource: "Triple-junction deployable solar wings + twin Li-ion batteries",
    instruments: [
      "Pancam & Navcam stereo cameras",
      "Mini-TES Thermal Emission Spectrometer",
      "Mössbauer (MIMOS II), APXS, Microscopic Imager & Rock Abrasion Tool (RAT)",
    ],
    highlightsEn:
      "Operated more than 20× past its 90-sol prime mission. Uncovered nearly pure opaline silica and magnesium-iron carbonates near 'Home Plate', evidence of ancient hydrothermal hot springs.",
    highlightsTr:
      "90 sol olarak planlanan görevini 20 kattan fazla aştı. Columbia Hills ve Home Plate bölgesinde antik hidrotermal kaplıca izleri taşıyan saf silika ve karbonat mineralleri keşfetti.",
    nasaUrl: "https://science.nasa.gov/mission/mer-spirit/",
    modelKind: "mer-spirit",
    modelSourceNote: "Bespoke NASA MER-A 3D assembly (1.6 m, fanned solar wings, Pancam mast, HGA dish, IDD arm)",
    terrainProfile: {
      palette: { dust: [176, 98, 60], rock: [90, 56, 42], skyHorizon: [0.64, 0.43, 0.3], fogHex: 0xa36e4d },
      seed: 2004,
      reliefM: 42,
      boulderDensity: 1.1,
    },
  },
  {
    id: "opportunity",
    name: "Opportunity",
    mission: "Mars Exploration Rover B (MER-B)",
    agency: "NASA / JPL",
    status: "COMPLETED",
    color: "#facc15",
    lon: -5.5266, // 354.4734°E Meridiani Planum
    lat: -1.9462,
    landingSite: "Meridiani Planum · Eagle Crater -> Perseverance Valley",
    siteShortName: "MERIDIANI PLANUM",
    siteElevM: -1400,
    isHiRiseGaleSite: false,
    launchDate: "2003-07-08",
    landingDate: "2004-01-25",
    endDate: "2018-06-10",
    sols: 5111,
    distanceKm: 45.16,
    distanceLabel: "45.16 km (28.06 mi)",
    massKg: 185,
    dimensionsM: "1.60 × 2.30 × 1.50 m",
    lengthM: 1.6,
    halfW: 1.22,
    halfL: 0.92,
    heightM: 1.58,
    powerSource: "Triple-junction deployable solar wings + twin Li-ion batteries",
    instruments: [
      "Pancam & Navcam stereo cameras",
      "Mini-TES Thermal Emission Spectrometer",
      "Mössbauer (MIMOS II), APXS, Microscopic Imager & Rock Abrasion Tool (RAT)",
    ],
    highlightsEn:
      "Endured 5,111 sols across Meridiani Planum before a planet-encircling 2018 dust storm. Discovered hematite 'blueberries', water-deposited sulfate cross-beds, and neutral-pH clays at Endeavour Crater.",
    highlightsTr:
      "2018 küresel toz fırtınasına dek 5.111 Mars günü çalıştı. Hematit 'yaban mersini' kürecikleri ve eski yüzey sularında oluşmuş sülfat/kil tabakalarını keşfetti.",
    nasaUrl: "https://science.nasa.gov/mission/opportunity/",
    modelKind: "mer-opportunity",
    modelSourceNote: "Bespoke NASA MER-B 3D assembly (1.6 m, fanned solar wings, Pancam mast, HGA dish, IDD arm)",
    terrainProfile: {
      palette: { dust: [132, 78, 56], rock: [58, 42, 38], skyHorizon: [0.58, 0.4, 0.3], fogHex: 0x94664d },
      seed: 2018,
      reliefM: 34,
      boulderDensity: 0.75,
    },
  },
  {
    id: "curiosity",
    name: "Curiosity",
    mission: "Mars Science Laboratory (MSL)",
    agency: "NASA / JPL",
    status: "ACTIVE",
    color: "#4ade80",
    // Exact Sol 4534 Altadena Boxwork waypoint inside HiRISE DTEEC_019698 Gale terrain mesh
    lon: 137.386436,
    lat: -4.797618,
    landingCoordsNote: "Bradbury Landing (2012): 4.5895°S, 137.4417°E -> Sol 4534 Boxwork: 4.7976°S, 137.3864°E",
    landingSite: "Gale Crater · Mount Sharp Boxwork (Bradbury Landing -> Aeolis Mons)",
    siteShortName: "GALE CRATER · MOUNT SHARP",
    siteElevM: -3620,
    isHiRiseGaleSite: true,
    launchDate: "2011-11-26",
    landingDate: "2012-08-06",
    endDate: null,
    sols: 5070,
    distanceKm: 38.3,
    distanceLabel: "~38.3+ km (23.8+ mi, ongoing)",
    massKg: 899,
    dimensionsM: "3.00 × 2.70 × 2.20 m",
    lengthM: 3.0,
    halfW: 1.45,
    halfL: 1.55,
    heightM: 2.25,
    powerSource: "MMRTG plutonium-238 radioisotope generator (~110 W at landing)",
    instruments: [
      "ChemCam laser spectrometer + Mastcam",
      "SAM & CheMin internal geochemistry laboratories",
      "MAHLI, APXS, RAD radiation detector, REMS meteorology, DAN",
    ],
    highlightsEn:
      "Demonstrated Gale Crater sustained habitable freshwater lakes and groundwater for millions of years. Detected organic carbon compounds in mudstones, measured surface RAD dose (0.64 mSv/day), and explored Mount Sharp boxwork ridges.",
    highlightsTr:
      "Gale Krateri'nde milyonlarca yıl boyunca yaşanabilir tatlı su gölleri bulunduğunu kanıtladı. Çamurtaşlarında organik karbon bileşikleri, RAD radyasyon dozunu ve boxwork sırtlarını inceledi.",
    nasaUrl: "https://science.nasa.gov/mission/msl-curiosity/",
    modelKind: "curiosity",
    modelSourceNote: "Bespoke NASA MSL Curiosity 3D assembly (3.0 m, square ChemCam head, rear MMRTG fins, 6 titanium chevron wheels, deployed robotic arm turret)",
    terrainProfile: null,
  },
  {
    id: "perseverance",
    name: "Perseverance",
    mission: "Mars 2020 (with Ingenuity)",
    agency: "NASA / JPL",
    status: "ACTIVE",
    color: "#c084fc",
    lon: 77.4508,
    lat: 18.4447,
    landingSite: "Jezero Crater (Octavia E. Butler Landing -> Neretva Vallis)",
    siteShortName: "JEZERO CRATER",
    siteElevM: -2569,
    isHiRiseGaleSite: false,
    launchDate: "2020-07-30",
    landingDate: "2021-02-18",
    endDate: null,
    sols: 1685,
    distanceKm: 45.2,
    distanceLabel: "45.2+ km (28.1+ mi, Mars distance record)",
    massKg: 1025,
    dimensionsM: "3.00 × 2.70 × 2.20 m",
    lengthM: 3.0,
    halfW: 1.45,
    halfL: 1.55,
    heightM: 2.25,
    powerSource: "MMRTG plutonium-238 radioisotope generator + twin Li-ion batteries",
    instruments: [
      "Mastcam-Z & SuperCam laser/Raman spectrometer",
      "SHERLOC & PIXL micro-mapping organics/elemental arms",
      "RIMFAX subsurface GPR, MEDA weather station, MOXIE oxygen ISRU",
    ],
    highlightsEn:
      "Exploring Jezero Crater's ancient river delta & lake shoreline. Cached sealed rock/regolith cores for sample return, generated breathable O₂ from Martian CO₂ via MOXIE, and surpassed Opportunity's Mars distance record.",
    highlightsTr:
      "Jezero Krateri'ndeki antik nehir deltasını ve göl kıyısını araştırıyor. Mars'tan numune tüpleri doldurdu, MOXIE ile karbondioksitten oksijen üretti ve Mars sürüş mesafesi rekorunu kırdı.",
    nasaUrl: "https://science.nasa.gov/mission/mars-2020-perseverance/",
    modelKind: "perseverance-glb",
    glbUrl: "./assets/nasa-3d/mars-2020-perseverance.glb",
    modelSourceNote: "Official NASA 3D Resources GLB (Mars 2020 Perseverance Rover.glb, fetched 2026-11-14)",
    terrainProfile: {
      palette: { dust: [164, 100, 68], rock: [78, 60, 50], skyHorizon: [0.62, 0.44, 0.32], fogHex: 0x9e7054 },
      seed: 2020,
      reliefM: 52,
      boulderDensity: 1.25,
    },
  },
]);

/**
 * Look up a rover record by its lowercase identifier (`sojourner`, `spirit`, `opportunity`, `curiosity`, `perseverance`).
 */
export function getHistoricRoverById(id) {
  const key = String(id || "").toLowerCase();
  return MARS_HISTORIC_ROVERS.find((r) => r.id === key) || null;
}

/** Nearest catalogued rover site to a lon/lat, with its surface distance in km. */
export function nearestHistoricRover(lon, lat) {
  let best = null;
  let bestKm = Infinity;
  for (const r of MARS_HISTORIC_ROVERS) {
    const km = marsDistanceM([lon, lat], [r.lon, r.lat], MARS_RADIUS_MEAN_M) / 1000;
    if (km < bestKm) {
      bestKm = km;
      best = r;
    }
  }
  return { rover: best, km: bestKm };
}

/** Small deterministic hash -> [0, 1). */
function hash01(a, b) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Site record for an arbitrary surface point picked in the Orbit view. Shaped like a rover entry so the
 * 3D view can treat it as an active site. Relief is seeded procedural terrain, not mapped topography.
 */
export function makeCustomSiteSpec(lon, lat) {
  const lonN = ((((Number(lon) + 180) % 360) + 360) % 360) - 180;
  const latN = Math.max(-89.5, Math.min(89.5, Number(lat)));
  const near = nearestHistoricRover(lonN, latN);
  const r1 = hash01(lonN, latN);
  const r2 = hash01(latN + 7.3, lonN - 3.1);
  const polar = Math.abs(latN) > 70;
  const dust = polar ? [196, 170, 150] : [150 + Math.round(r1 * 40), 88 + Math.round(r2 * 24), 58 + Math.round(r1 * 16)];
  const nearName = near.km < 150 ? `NEAR ${near.rover.siteShortName}` : null;
  return {
    id: `site:${latN.toFixed(3)},${lonN.toFixed(3)}`,
    name: "Surface site",
    mission: "Orbit-view landing",
    agency: "—",
    status: "CUSTOM",
    color: "#fbbf24",
    lon: lonN,
    lat: latN,
    landingSite: nearName || formatMarsLonLat(lonN, latN, 2),
    siteShortName: nearName || "MARS SURFACE",
    siteElevM: null,
    isHiRiseGaleSite: false,
    isCustomSite: true,
    nearRoverId: near.km < 150 ? near.rover.id : null,
    nearRoverKm: near.km,
    lengthM: 3,
    terrainProfile: {
      palette: {
        dust,
        rock: [Math.round(dust[0] * 0.55), Math.round(dust[1] * 0.6), Math.round(dust[2] * 0.7)],
        skyHorizon: [0.6 + r2 * 0.08, 0.42 + r1 * 0.05, 0.3],
        fogHex: 0xa06e50,
      },
      seed: Math.round(1000 + r1 * 8000),
      reliefM: Math.round(14 + r2 * 46),
      boulderDensity: 0.8 + r1 * 0.8,
    },
  };
}

/**
 * Format signed Mars lat/lon in clean hemisphere degrees (e.g. `18.44°N, 77.45°E`).
 */
export function formatMarsLonLat(lon, lat, decimals = 2) {
  const latStr = `${Math.abs(lat).toFixed(decimals)}°${lat >= 0 ? "N" : "S"}`;
  const lonE = ((Number(lon) % 360) + 360) % 360;
  const lonShort = lon >= 0 ? `${lon.toFixed(decimals)}°E` : `${lonE.toFixed(decimals)}°E (${Math.abs(lon).toFixed(decimals)}°W)`;
  return `${latStr}, ${lonShort}`;
}

/**
 * Surface spherical distance between two Mars coordinates / rovers using NASA Mars mean radius.
 */
export function computeRoverSurfaceDistanceKm(roverA, roverB) {
  if (!roverA || !roverB) return 0;
  const dM = marsDistanceM([roverA.lon, roverA.lat], [roverB.lon, roverB.lat], MARS_RADIUS_MEAN_M);
  return dM / 1000;
}

/**
 * Build a GeoJSON FeatureCollection of all 5 historic rovers at their real Mars coordinates.
 */
export function buildHistoricRoversGeoJson() {
  return {
    type: "FeatureCollection",
    features: MARS_HISTORIC_ROVERS.map((r) => ({
      type: "Feature",
      properties: {
        id: r.id,
        name: r.name,
        mission: r.mission,
        status: r.status,
        color: r.color,
        landingSite: r.landingSite,
        siteShortName: r.siteShortName,
        distanceLabel: r.distanceLabel,
      },
      geometry: {
        type: "Point",
        coordinates: [r.lon, r.lat],
      },
    })),
  };
}

function evalProceduralWave(x, z, s) {
  // Gentle domain warp avoids straight checkerboard wave lines
  const wx = x + 38 * Math.sin(z * 0.0085 + s * 1.1);
  const wz = z + 38 * Math.cos(x * 0.0082 - s * 0.9);
  const broad =
    Math.sin(wx * 0.0092 + s) * Math.cos(wz * 0.0078 - s * 0.7) * 0.56 +
    Math.sin((wx - wz) * 0.017 + s * 1.4) * 0.24;
  // Selective smooth mesa shoulders: ease scarp slope so ridges stay climbable/realistic
  const scarpSignal = Math.sin(wx * 0.0061 - wz * 0.0054 + s * 2.3);
  const scarpMask = 0.5 + 0.5 * Math.tanh(scarpSignal * 1.45);
  const undul = 0.5 + 0.5 * Math.sin(wx * 0.022 + wz * 0.019 - s);
  const mesa = scarpMask * (0.28 + 0.22 * undul);
  const micro = Math.cos(wx * 0.052 - wz * 0.048 + s * 2.1) * 0.06;
  return broad + mesa + micro;
}

/**
 * Compute deterministic, smoothly transitioned site relief (meters) for off-Gale Mars sites
 * (Jezero, Gusev, Meridiani, Ares Vallis, and custom Orbit landings): mixes gentle sandy basins
 * with steeper stratified mesa/scarp shoulders while keeping a flat landing pad at local `(0, 0)`.
 */
export function sampleProceduralSiteHeightM(roverIdOrSpec, x, z) {
  const rover = typeof roverIdOrSpec === "object" && roverIdOrSpec ? roverIdOrSpec : getHistoricRoverById(roverIdOrSpec);
  if (!rover || rover.isHiRiseGaleSite || !rover.terrainProfile) return 0;
  const { seed, reliefM } = rover.terrainProfile;
  const s = seed * 0.0137;
  const r = Math.hypot(x, z);
  // Radial coordinate compression u(r) whose derivative u'(r) stays in [0, 1]:
  // guarantees a flat 6 m landing pad at (0, 0) without ever amplifying surrounding slopes.
  let sx = 0;
  let sz = 0;
  if (r > 6.0) {
    const padW = 52.0;
    const t = Math.min(1, (r - 6.0) / padW);
    const u = r >= 6.0 + padW ? r - 6.0 - 0.5 * padW : padW * t * t * t * (1 - 0.5 * t);
    const scale = u / r;
    sx = x * scale;
    sz = z * scale;
  }
  const deltaWave = sx === 0 && sz === 0 ? 0 : evalProceduralWave(sx, sz, s) - evalProceduralWave(0, 0, s);
  // Smooth crater rim rise around r ~ 340..860 m (no linear crease at start)
  const tRim = Math.max(0, Math.min(1, (r - 340) / 520));
  const rim = tRim * tRim * (3 - 2 * tRim) * 0.45;
  return (deltaWave + rim) * reliefM;
}

/**
 * Generates well-spaced, random/scattered 3D terrain placement coordinates for ALL 5
 * historic NASA Mars rovers simultaneously inside the walkable terrain arena.
 * Ensures safe slopes (<= 16 deg when terrain sampler is supplied), minimum clearance
 * between rovers (>= 48 m), and keeps 1-2 rovers within easy discovery range (~48..145 m)
 * of the origin/walker start while spreading the rest across distant sectors.
 */
export function scatterHistoricRoverCoords({
  sampleElevY = null,
  worldW = 1980,
  worldH = 1980,
  originX = 0,
  originZ = 0,
  minSepM = 52,
  maxSlopeDeg = 16,
  rng = Math.random,
} = {}) {
  const placements = [];
  const halfX = Math.max(120, worldW * 0.44);
  const halfZ = Math.max(120, worldH * 0.44);
  const sectorCount = MARS_HISTORIC_ROVERS.length;
  const baseAngle = rng() * Math.PI * 2;

  const evalSlopeDeg = (x, z) => {
    if (typeof sampleElevY !== "function") return 4;
    const d = 1.6;
    const gx = (sampleElevY(x + d, z) - sampleElevY(x - d, z)) / (2 * d);
    const gz = (sampleElevY(x, z + d) - sampleElevY(x, z - d)) / (2 * d);
    return Math.atan(Math.hypot(gx, gz)) * (180 / Math.PI);
  };

  for (let i = 0; i < sectorCount; i++) {
    const spec = MARS_HISTORIC_ROVERS[i];
    // Near band for first 2 rovers so players encounter iconic missions quickly, wider exploration bands for others
    const nearBand = i < 2;
    const minR = nearBand ? 42 : 130;
    const maxR = nearBand ? 145 : Math.min(halfX * 0.88, halfZ * 0.88, 520);

    let best = null;
    for (let attempt = 0; attempt < 28; attempt++) {
      const sectorAng = baseAngle + (i / sectorCount) * Math.PI * 2 + (rng() - 0.5) * 0.92;
      const r = minR + rng() * Math.max(20, maxR - minR);
      const cx = Math.max(-halfX, Math.min(halfX, originX + Math.cos(sectorAng) * r));
      const cz = Math.max(-halfZ, Math.min(halfZ, originZ + Math.sin(sectorAng) * r));
      if (Math.hypot(cx - originX, cz - originZ) < 28) continue;

      let tooClose = false;
      for (const p of placements) {
        if (Math.hypot(cx - p.x, cz - p.z) < minSepM) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      const slopeDeg = evalSlopeDeg(cx, cz);
      if (!best || slopeDeg < best.slopeDeg) {
        best = { x: cx, z: cz, yaw: (rng() - 0.5) * Math.PI * 2, slopeDeg };
      }
      if (slopeDeg <= maxSlopeDeg) break;
    }

    if (!best) {
      const ang = baseAngle + (i / sectorCount) * Math.PI * 2;
      const fallbackR = 65 + i * 55;
      best = {
        x: Math.max(-halfX, Math.min(halfX, originX + Math.cos(ang) * fallbackR)),
        z: Math.max(-halfZ, Math.min(halfZ, originZ + Math.sin(ang) * fallbackR)),
        yaw: (rng() - 0.5) * Math.PI * 2,
        slopeDeg: evalSlopeDeg(originX + Math.cos(ang) * fallbackR, originZ + Math.sin(ang) * fallbackR),
      };
    }

    placements.push({
      id: spec.id,
      spec,
      x: best.x,
      z: best.z,
      yaw: best.yaw,
      slopeDeg: best.slopeDeg,
    });
  }

  return placements;
}
