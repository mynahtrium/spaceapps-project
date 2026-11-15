/**
 * Habitat Tasks mission staging & vehicle-aware multi-route planner (`web/shared/task-router.js`).
 *
 * Pure ES module with zero Three.js or DOM dependencies so Node tests and the 3D HUD share one
 * planning implementation (works completely offline under `?demo=1`).
 *
 * Honesty notes:
 * - Slope hazard tiers (green <= 10 deg, amber 10-15 deg, red 15-20 deg, blocked > 20 deg) use
 *   NASA lunar EVA ConOps stand-in limits, not Mars vehicle limits.
 * - Predicted drive durations, energy draw, and suitability scores are illustrative engineering
 *   estimates derived from `DRIVABLE_VEHICLES` parameters and sampled local terrain geometry.
 */

import { marsBearingDeg, marsDistanceM } from "../map/Geodesy.js";
import { MARS_HISTORIC_ROVERS, getHistoricRoverById, sampleProceduralSiteHeightM } from "./mars-rovers.js";

/**
 * Physical & mobility profiles for the 2 garage drivable vehicles (`mmsev`, `nasa_concept`).
 * Values match `DRIVABLE_VEHICLES` in `web/hud/experimental-rover.js`.
 */
export const TASK_VEHICLE_PROFILES = Object.freeze({
  mmsev: Object.freeze({
    id: "mmsev",
    nameEn: "NASA MMSEV Pressurized 6×6",
    nameTr: "NASA MMSEV Basınçlı 6×6",
    shortLabel: "MMSEV 6×6",
    badgeColor: "#f59e0b",
    massKg: 1850,
    powerKw: 31.5,
    wheelTorqueMaxNm: 2639.25,
    topSpeedMs: 18.5,
    boostSpeedMs: 25.5,
    wheelRadiusM: 0.345,
    trackHalfW: 1.339,
    halfW: 1.66,
    halfL: 2.42,
    heightM: 3.25,
    slopeTorque: 1.3,
    comfortSlopeDeg: 10.5,
    limitSlopeDeg: 15.0,
    hardMaxSlopeDeg: 20.0,
    roughnessTolerance: 0.45,
    strengthEn: "Pressurized shirt-sleeve cabin; ideal for smooth valleys and gentle grades (≤ 11°).",
    strengthTr: "Basınçlı astronot kabini; düzgün vadiler ve yumuşak eğimler (≤ 11°) için idealdir.",
  }),
  nasa_concept: Object.freeze({
    id: "nasa_concept",
    nameEn: "NASA Mars Rover Concept 6×6",
    nameTr: "NASA Mars Rover Konsepti 6×6",
    shortLabel: "MARS CONCEPT",
    badgeColor: "#38bdf8",
    massKg: 2250,
    powerKw: 45.45,
    wheelTorqueMaxNm: 4837.5,
    topSpeedMs: 22.0,
    boostSpeedMs: 31.0,
    wheelRadiusM: 0.52,
    trackHalfW: 1.48,
    halfW: 1.82,
    halfL: 3.15,
    heightM: 2.85,
    slopeTorque: 1.4,
    comfortSlopeDeg: 14.5,
    limitSlopeDeg: 18.5,
    hardMaxSlopeDeg: 23.0,
    roughnessTolerance: 0.78,
    strengthEn: "High-torque drive (4,838 N·m) & 0.52 m spring-mesh tires; handles steeper rocky ridges.",
    strengthTr: "Yüksek torklu çekiş (4.838 N·m) ve 0,52 m yaylı tekerlekler; dik ve taşlı sırtları aşar.",
  }),
});

export function getTaskVehicleProfile(vehicleId) {
  const key = String(vehicleId || "").toLowerCase();
  if (key === "mars_robo_concept" || key === "nasa_concept") return TASK_VEHICLE_PROFILES.nasa_concept;
  return TASK_VEHICLE_PROFILES.mmsev;
}

export function getTaskTargetRovers() {
  return MARS_HISTORIC_ROVERS;
}

export function getTaskTargetRover(roverId) {
  return getHistoricRoverById(roverId) || MARS_HISTORIC_ROVERS[0];
}

/** Local terrain slope in degrees estimated with central finite differences. */
export function estimateTerrainSlopeDeg(sampleElevY, x, z, stepM = 3.0) {
  if (typeof sampleElevY !== "function") return 0;
  const gx = (sampleElevY(x + stepM, z) - sampleElevY(x - stepM, z)) / (2 * stepM);
  const gz = (sampleElevY(x, z + stepM) - sampleElevY(x, z - stepM)) / (2 * stepM);
  return Math.atan(Math.hypot(gx, gz)) * (180 / Math.PI);
}

/** Sample local habitat pad slope across the main footprint to pick a smooth staging site. */
function samplePadMaxSlopeDeg(sampleElevY, habX, habZ) {
  if (typeof sampleElevY !== "function") return 0;
  const pts = [
    [habX - 18, habZ - 20],
    [habX + 20, habZ - 20],
    [habX, habZ + 8],
    [habX - 16, habZ + 32],
    [habX + 16, habZ + 32],
  ];
  let worst = 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const s = estimateTerrainSlopeDeg(sampleElevY, pts[i][0], pts[i][1], 4.0);
    worst = Math.max(worst, s);
    sum += s;
  }
  return worst * 0.65 + (sum / pts.length) * 0.35;
}

/**
 * Selects a smooth Habitat staging position `(habX, habZ)` ~520..780 m north of `(targetX, targetZ)`
 * so the habitat's garage bays (`+Z` outward ramp) open toward the target rover expedition zone.
 */
export function selectHabitatStagingSpot({
  targetX = 0,
  targetZ = 0,
  sampleElevY = null,
  worldW = 2064,
  worldH = 5439,
  minDistM = 520,
  maxDistM = 780,
} = {}) {
  const halfX = Math.max(240, worldW * 0.42);
  const halfZ = Math.max(240, worldH * 0.42);
  const clampX = (x) => Math.max(-halfX + 60, Math.min(halfX - 60, x));
  const clampZ = (z) => Math.max(-halfZ + 60, Math.min(halfZ - 60, z));

  let best = null;
  const distSteps = [600, 680, 540, 740];
  const latSteps = [-160, -90, 0, 90, 160, -240, 240];

  for (const dist of distSteps) {
    for (const dx of latSteps) {
      const clampedDist = Math.max(minDistM, Math.min(maxDistM, dist));
      const candX = clampX(targetX + dx);
      // Prefer north (-Z) so south-facing garage (+Z) drives out straight toward target
      let candZ = targetZ - clampedDist;
      if (candZ < -halfZ + 80) {
        candZ = clampZ(targetZ + clampedDist);
      }
      const actualDist = Math.hypot(targetX - candX, targetZ - candZ);
      if (actualDist < 360) continue;

      const padSlope = samplePadMaxSlopeDeg(sampleElevY, candX, candZ);
      const exitSlope = estimateTerrainSlopeDeg(sampleElevY, candX, candZ + 44, 4.0);
      const distPenalty = Math.abs(actualDist - 640) * 0.015;
      const score = padSlope + exitSlope * 0.5 + distPenalty;

      if (!best || score < best.score) {
        best = {
          score,
          habX: candX,
          habZ: candZ,
          padSlopeDeg: padSlope,
        };
      }
    }
  }

  const habX = best ? best.habX : clampX(targetX);
  const habZ = best ? best.habZ : clampZ(targetZ - 620);
  // Garage apron exit lies +Z outside bays (BAY_FRONT_Z=22, apron outer edge=44)
  const startX = habX;
  const startZ = targetZ >= habZ ? habZ + 44 : habZ - 42;

  return {
    habX,
    habZ,
    startX,
    startZ,
    targetX,
    targetZ,
    distanceM: Math.round(Math.hypot(targetX - habX, targetZ - habZ)),
    straightDistM: Math.hypot(targetX - startX, targetZ - startZ),
    padSlopeDeg: best ? best.padSlopeDeg : 0,
  };
}

/**
 * Evaluate a terrain sampler for any historic rover spec on its own landing region:
 * - Curiosity uses the provided Gale HiRISE sampler (`galeSampleY`) and real Gale lon/lat->scene converter.
 * - Other 4 rovers use their deterministic `sampleProceduralSiteHeightM` field centered at `(0, 0)`.
 */
export function buildSiteElevationSampler(roverSpec, { galeSampleY = null, lonToX = null, latToZ = null } = {}) {
  const isGale = Boolean(roverSpec?.isHiRiseGaleSite);
  if (isGale && typeof galeSampleY === "function") {
    const targetX = typeof lonToX === "function" ? lonToX(roverSpec.lon) : -131.1;
    const targetZ = typeof latToZ === "function" ? latToZ(roverSpec.lat) : 1544.05;
    return {
      isGale: true,
      targetX,
      targetZ,
      sampleElevY: galeSampleY,
    };
  }
  return {
    isGale: false,
    targetX: 0,
    targetZ: 0,
    sampleElevY: (x, z) => sampleProceduralSiteHeightM(roverSpec, x, z),
  };
}

class MinHeap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  push(idx, f) {
    const arr = this.items;
    let i = arr.length;
    arr.push({ idx, f });
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (arr[p].f <= f) break;
      arr[i] = arr[p];
      i = p;
    }
    arr[i] = { idx, f };
  }
  pop() {
    const arr = this.items;
    const top = arr[0];
    const last = arr.pop();
    if (arr.length > 0) {
      arr[0] = last;
      let i = 0;
      const len = arr.length;
      while (true) {
        const l = (i << 1) + 1;
        const r = l + 1;
        let small = i;
        if (l < len && arr[l].f < arr[small].f) small = l;
        if (r < len && arr[r].f < arr[small].f) small = r;
        if (small === i) break;
        const tmp = arr[i];
        arr[i] = arr[small];
        arr[small] = tmp;
        i = small;
      }
    }
    return top;
  }
}

const DIRS_8 = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Check if `(x, z)` lies inside an axis-aligned box list. */
function isBlockedByBoxes(x, z, boxes) {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return true;
  }
  return false;
}

function segmentHitsBoxes(x0, z0, x1, z1, boxes) {
  if (!boxes.length) return false;
  const dist = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.max(2, Math.ceil(dist / 6));
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    if (isBlockedByBoxes(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, boxes)) return true;
  }
  return false;
}

/**
 * Generates 3 terrain-aware route options (`safe`, `balanced`, `direct`) between the Habitat garage exit
 * and the target historic rover, then evaluates all 3 specifically for the chosen drivable vehicle.
 */
export function generateVehicleRoutes({
  sampleElevY,
  startX,
  startZ,
  targetX,
  targetZ,
  habX = null,
  habZ = null,
  vehicleId = "mmsev",
  cellSizeM = 16,
} = {}) {
  const sampler = typeof sampleElevY === "function" ? sampleElevY : () => 0;
  const vehicle = getTaskVehicleProfile(vehicleId);
  const altVehicle = vehicle.id === "mmsev" ? TASK_VEHICLE_PROFILES.nasa_concept : TASK_VEHICLE_PROFILES.mmsev;

  const spanX = Math.abs(targetX - startX);
  const spanZ = Math.abs(targetZ - startZ);
  const padM = Math.max(260, Math.min(400, Math.hypot(spanX, spanZ) * 0.48));
  const minX = Math.min(startX, targetX) - padM;
  const maxX = Math.max(startX, targetX) + padM;
  const minZ = Math.min(startZ, targetZ) - padM;
  const maxZ = Math.max(startZ, targetZ) + padM;

  let stepM = Math.max(12, Number(cellSizeM) || 16);
  while ((maxX - minX) / stepM > 84 || (maxZ - minZ) / stepM > 84) {
    stepM += 2;
  }
  const nx = Math.max(18, Math.ceil((maxX - minX) / stepM) + 1);
  const nz = Math.max(18, Math.ceil((maxZ - minZ) / stepM) + 1);
  const totalCells = nx * nz;

  const elev = new Float32Array(totalCells);
  const slope = new Float32Array(totalCells);
  const rough = new Float32Array(totalCells);
  const blocked = new Uint8Array(totalCells);

  const obstacleBoxes = [];
  if (Number.isFinite(habX) && Number.isFinite(habZ)) {
    // Keep the habitat building footprint clear so routes depart smoothly from the south/north apron
    obstacleBoxes.push({
      minX: habX - 24,
      maxX: habX + 38,
      minZ: habZ - 32,
      maxZ: habZ + 29,
    });
  }

  for (let j = 0; j < nz; j++) {
    const wz = minZ + j * stepM;
    const row = j * nx;
    for (let i = 0; i < nx; i++) {
      const wx = minX + i * stepM;
      elev[row + i] = sampler(wx, wz);
      if (isBlockedByBoxes(wx, wz, obstacleBoxes)) {
        // Keep exact start/target cell unblocked just in case
        if (Math.hypot(wx - startX, wz - startZ) > stepM * 1.1 && Math.hypot(wx - targetX, wz - targetZ) > stepM * 1.1) {
          blocked[row + i] = 1;
        }
      }
    }
  }

  const inv2Step = 1 / (2 * stepM);
  let elevMin = Infinity;
  let elevMax = -Infinity;
  for (let j = 0; j < nz; j++) {
    const jm = Math.max(0, j - 1);
    const jp = Math.min(nz - 1, j + 1);
    for (let i = 0; i < nx; i++) {
      const im = Math.max(0, i - 1);
      const ip = Math.min(nx - 1, i + 1);
      const idx = j * nx + i;
      const e = elev[idx];
      if (e < elevMin) elevMin = e;
      if (e > elevMax) elevMax = e;
      const gx = (elev[j * nx + ip] - elev[j * nx + im]) * inv2Step;
      const gz = (elev[jp * nx + i] - elev[jm * nx + i]) * inv2Step;
      slope[idx] = Math.atan(Math.hypot(gx, gz)) * (180 / Math.PI);
      const avgN = 0.25 * (elev[j * nx + ip] + elev[j * nx + im] + elev[jp * nx + i] + elev[jm * nx + i]);
      rough[idx] = Math.min(1.5, Math.abs(e - avgN) / (stepM * 0.14));
    }
  }

  const toGrid = (wx, wz) => ({
    ci: Math.max(1, Math.min(nx - 2, Math.round((wx - minX) / stepM))),
    cj: Math.max(1, Math.min(nz - 2, Math.round((wz - minZ) / stepM))),
  });
  const sG = toGrid(startX, startZ);
  const tG = toGrid(targetX, targetZ);
  const startIdx = sG.cj * nx + sG.ci;
  const goalIdx = tG.cj * nx + tG.ci;
  blocked[startIdx] = 0;
  blocked[goalIdx] = 0;

  // Axis basis from start -> target for lateral flank diversity weighting
  const dirX = targetX - startX;
  const dirZ = targetZ - startZ;
  const mainLen = Math.hypot(dirX, dirZ) || 1;
  const ux = dirX / mainLen;
  const uz = dirZ / mainLen;
  const px = -uz; // lateral unit vector
  const pz = ux;

  const corridorPenalty = new Float32Array(totalCells);

  function solveAStar(mode, hardCapDeg, lateralBiasSign = 0) {
    const gCost = new Float32Array(totalCells).fill(Infinity);
    const parent = new Int32Array(totalCells).fill(-1);
    const closed = new Uint8Array(totalCells);
    const heap = new MinHeap();

    gCost[startIdx] = 0;
    heap.push(startIdx, Math.hypot(tG.ci - sG.ci, tG.cj - sG.cj) * stepM);

    while (heap.size > 0) {
      const { idx } = heap.pop();
      if (idx === goalIdx) break;
      if (closed[idx]) continue;
      closed[idx] = 1;

      const ci = idx % nx;
      const cj = (idx / nx) | 0;
      const eA = elev[idx];
      const wxA = minX + ci * stepM;
      const wzA = minZ + cj * stepM;

      for (let d = 0; d < DIRS_8.length; d++) {
        const ni = ci + DIRS_8[d][0];
        const nj = cj + DIRS_8[d][1];
        if (ni < 0 || ni >= nx || nj < 0 || nj >= nz) continue;
        const nIdx = nj * nx + ni;
        if (closed[nIdx] || blocked[nIdx]) continue;

        const dHoriz = DIRS_8[d][2] * stepM;
        const segSlope = Math.atan2(Math.abs(elev[nIdx] - eA), dHoriz) * (180 / Math.PI);
        const cellSlope = Math.max(slope[nIdx], segSlope);
        if (cellSlope > hardCapDeg && nIdx !== goalIdx) continue;

        const cellRough = rough[nIdx];
        const wxB = minX + ni * stepM;
        const wzB = minZ + nj * stepM;
        const rx = wxB - startX;
        const rz = wzB - startZ;
        const along = Math.max(0, Math.min(1, (rx * ux + rz * uz) / mainLen));
        const bell = Math.sin(along * Math.PI); // 0 at endpoints, 1 mid-route
        const lateralSigned = (rx * px + rz * pz) / Math.max(120, mainLen * 0.28);

        let mult = 1.0;
        if (mode === "safe") {
          const sNorm = cellSlope / 9.5;
          mult = 1.0 + Math.pow(sNorm, 2.5) * 2.8 + cellRough * 2.2;
          // Gentle preference for lower/valley elevation on "safe"
          const eFrac = elevMax > elevMin ? (elev[nIdx] - elevMin) / (elevMax - elevMin) : 0.5;
          mult += eFrac * 0.35;
        } else if (mode === "balanced") {
          const sNorm = cellSlope / 12.0;
          mult = 1.0 + Math.pow(sNorm, 2.0) * 1.45 + cellRough * 1.25;
        } else {
          // direct / ridge express
          const sNorm = cellSlope / 16.5;
          mult = 1.0 + Math.pow(sNorm, 1.55) * 0.55 + cellRough * 0.5;
        }

        // Encourage visibly distinct flanking arcs between the 3 suggested routes without leaving smooth ground
        if (lateralBiasSign !== 0) {
          const wantSide = lateralBiasSign * 0.85;
          const off = Math.abs(lateralSigned - wantSide);
          mult += bell * Math.min(0.9, off * 0.35);
        }
        mult += bell * corridorPenalty[nIdx];

        const nextG = gCost[idx] + dHoriz * mult;
        if (nextG < gCost[nIdx]) {
          gCost[nIdx] = nextG;
          parent[nIdx] = idx;
          const h = Math.hypot(tG.ci - ni, tG.cj - nj) * stepM;
          heap.push(nIdx, nextG + h * 1.02);
        }
      }
    }

    if (parent[goalIdx] === -1) return null;
    const rawCells = [];
    let cur = goalIdx;
    while (cur !== -1) {
      rawCells.push(cur);
      cur = parent[cur];
    }
    rawCells.reverse();
    return rawCells;
  }

  function markCorridorPenalty(cells, weight, radiusCells = 3) {
    if (!cells) return;
    const skipHead = Math.min(6, Math.floor(cells.length * 0.15));
    const skipTail = Math.max(skipHead + 1, Math.floor(cells.length * 0.85));
    for (let k = skipHead; k < skipTail; k++) {
      const idx = cells[k];
      const ci = idx % nx;
      const cj = (idx / nx) | 0;
      for (let dj = -radiusCells; dj <= radiusCells; dj++) {
        for (let di = -radiusCells; di <= radiusCells; di++) {
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || ni >= nx || nj < 0 || nj >= nz) continue;
          const d = Math.hypot(di, dj);
          if (d > radiusCells) continue;
          const w = weight * (1 - d / (radiusCells + 0.5));
          corridorPenalty[nj * nx + ni] += w;
        }
      }
    }
  }

  function cellsToPoints(cells) {
    const raw = [
      { x: startX, z: startZ },
      ...cells.slice(1, -1).map((idx) => ({
        x: minX + (idx % nx) * stepM,
        z: minZ + ((idx / nx) | 0) * stepM,
      })),
      { x: targetX, z: targetZ },
    ];

    // String-pull / shortcut safe turns only when terrain & obstacle constraints still hold
    const pulled = [raw[0]];
    let anchor = 0;
    while (anchor < raw.length - 1) {
      let far = Math.min(raw.length - 1, anchor + 5);
      while (far > anchor + 1) {
        if (!segmentHitsBoxes(raw[anchor].x, raw[anchor].z, raw[far].x, raw[far].z, obstacleBoxes)) {
          const mx = (raw[anchor].x + raw[far].x) * 0.5;
          const mz = (raw[anchor].z + raw[far].z) * 0.5;
          const midSlope = estimateTerrainSlopeDeg(sampler, mx, mz, 3.0);
          if (midSlope <= 20) break;
        }
        far--;
      }
      pulled.push(raw[far]);
      anchor = far;
    }

    // One Chaikin corner-smoothing pass + fixed-step resampling (~14 m) for clean 3D ribbons
    const dense = [];
    let cumM = 0;
    for (let i = 0; i < pulled.length - 1; i++) {
      const a = pulled[i];
      const b = pulled[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      const sub = Math.max(1, Math.round(segLen / 14));
      for (let k = i === 0 ? 0 : 1; k <= sub; k++) {
        const t = k / sub;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        const prev = dense[dense.length - 1];
        if (prev) cumM += Math.hypot(x - prev.x, z - prev.z);
        dense.push({
          x,
          z,
          y: sampler(x, z),
          sM: cumM,
          slopeDeg: estimateTerrainSlopeDeg(sampler, x, z, 3.0),
        });
      }
    }
    return dense;
  }

  function evaluateRoute(strategy, points) {
    let distM = 0;
    let gainM = 0;
    let lossM = 0;
    let maxSlopeDeg = 0;
    let slopeSum = 0;
    let roughSum = 0;

    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      const localS = Math.max(pt.slopeDeg, i > 0 ? Math.atan2(Math.abs(pt.y - points[i - 1].y), Math.max(1, Math.hypot(pt.x - points[i - 1].x, pt.z - points[i - 1].z))) * (180 / Math.PI) : 0);
      pt.segSlopeDeg = localS;
      if (localS > maxSlopeDeg) maxSlopeDeg = localS;
      slopeSum += localS;
      const eAboveAvg =
        0.25 * (sampler(pt.x + 6, pt.z) + sampler(pt.x - 6, pt.z) + sampler(pt.x, pt.z + 6) + sampler(pt.x, pt.z - 6)) -
        pt.y;
      roughSum += Math.min(1.5, Math.abs(eAboveAvg) / 0.85);
      if (i > 0) {
        const d = Math.hypot(pt.x - points[i - 1].x, pt.z - points[i - 1].z);
        distM += d;
        const dy = pt.y - points[i - 1].y;
        if (dy > 0) gainM += dy;
        else lossM += -dy;
      }
    }
    const nPts = Math.max(1, points.length);
    const avgSlopeDeg = slopeSum / nPts;
    const roughnessScore = roughSum / nPts;

    const scoreVehicle = (veh) => {
      // Lower score deduction when slopes stay under comfort ceiling; harsher penalty beyond limitSlopeDeg
      const excessMax = Math.max(0, maxSlopeDeg - veh.comfortSlopeDeg);
      const overLimit = Math.max(0, maxSlopeDeg - veh.limitSlopeDeg);
      const excessAvg = Math.max(0, avgSlopeDeg - veh.comfortSlopeDeg * 0.68);
      const roughPenalty = Math.max(0, roughnessScore - veh.roughnessTolerance) * 28;
      const distPenalty = Math.max(0, (distM / Math.max(100, Math.hypot(targetX - startX, targetZ - startZ)) - 1.08) * 14);
      const torqueBonus = veh.id === "nasa_concept" ? Math.min(9, avgSlopeDeg * 0.65) : Math.max(0, (11 - maxSlopeDeg) * 0.8);
      const rawScore = 96 - excessMax * 3.1 - overLimit * 5.2 - excessAvg * 2.2 - roughPenalty - distPenalty + torqueBonus * 0.35;
      const pct = Math.max(32, Math.min(99, Math.round(rawScore)));
      const tier =
        maxSlopeDeg > veh.limitSlopeDeg + 1.5 || pct < 66
          ? "caution"
          : pct >= 84
            ? "recommended"
            : "suitable";

      // Illustrative speed & drive time factoring vehicle power, top speed & slope
      const effectiveSpeedMs =
        veh.topSpeedMs *
        0.58 *
        Math.max(0.42, 1 - avgSlopeDeg / (veh.hardMaxSlopeDeg * 1.45)) *
        Math.max(0.65, 1 - roughnessScore * (1 - veh.roughnessTolerance) * 0.35);
      const estDriveSec = Math.round(distM / Math.max(3.5, effectiveSpeedMs));
      const estEnergyKwh = Number(((veh.powerKw * 0.42 * estDriveSec + gainM * veh.massKg * 0.0022) / 3600).toFixed(2));
      return { pct, tier, estDriveSec, estEnergyKwh };
    };

    const fit = scoreVehicle(vehicle);
    const altFit = scoreVehicle(altVehicle);

    const slopeTierEn =
      maxSlopeDeg <= 10 ? "Green (≤10°)" : maxSlopeDeg <= 15 ? "Amber (10–15°)" : maxSlopeDeg <= 20 ? "Red (15–20°)" : ">20° Steep";
    const slopeTierTr =
      maxSlopeDeg <= 10 ? "Yeşil (≤10°)" : maxSlopeDeg <= 15 ? "Sarı (10–15°)" : maxSlopeDeg <= 20 ? "Kırmızı (15–20°)" : ">20° Dik";

    let reasonEn = "";
    let reasonTr = "";
    if (vehicle.id === "mmsev") {
      if (maxSlopeDeg <= vehicle.comfortSlopeDeg) {
        reasonEn = `Gentle max slope (${maxSlopeDeg.toFixed(1)}°) & smooth valley floor fit MMSEV's pressurized cabin and 0.345 m wheels.`;
        reasonTr = `Düşük azami eğim (${maxSlopeDeg.toFixed(1)}°) ve düzgün vadi zemini MMSEV'in basınçlı kabini ve 0,345 m tekerlekleriyle tam uyumlu.`;
      } else if (maxSlopeDeg <= vehicle.limitSlopeDeg) {
        reasonEn = `Moderate ${maxSlopeDeg.toFixed(1)}° climbs demand careful throttle in MMSEV (2,639 N·m drive); monitor pitch/roll.`;
        reasonTr = `${maxSlopeDeg.toFixed(1)}°'lik orta tırmanışlar MMSEV'de (2.639 N·m) kontrollü gaz gerektirir; yanal eğimi izleyin.`;
      } else {
        reasonEn = `${maxSlopeDeg.toFixed(1)}° slope exceeds MMSEV's 15° comfort threshold — Mars Concept handles this ridge more safely.`;
        reasonTr = `${maxSlopeDeg.toFixed(1)}° eğim MMSEV'in 15° konfor sınırını aşıyor — Mars Konsepti bu sırtı daha güvenli tırmanır.`;
      }
    } else {
      if (strategy === "safe") {
        reasonEn = `Longest flat detour (${Math.round(distM)} m); safe for Mars Concept, though its 4,838 N·m drive can also clear faster ridges.`;
        reasonTr = `En uzun düz geçiş (${Math.round(distM)} m); Mars Konsepti için güvenli ancak 4.838 N·m torkuyla daha kısa sırtlara da uygundur.`;
      } else if (maxSlopeDeg <= vehicle.limitSlopeDeg) {
        reasonEn = `4,838 N·m torque and 0.52 m Nitinol spring-mesh tires easily master this ${maxSlopeDeg.toFixed(1)}° corridor.`;
        reasonTr = `4.838 N·m tork ve 0,52 m Nitinol yaylı tekerlekler bu ${maxSlopeDeg.toFixed(1)}°'lik parkuru rahatça aşar.`;
      } else {
        reasonEn = `Steep ${maxSlopeDeg.toFixed(1)}° grade near the 20° lunar EVA ceiling; use controlled climb speed on ridge crests.`;
        reasonTr = `20° ay EVA sınırına yakın dik ${maxSlopeDeg.toFixed(1)}° eğim; sırt geçişlerinde hızınızı düşürün.`;
      }
    }

    return {
      id: strategy.id,
      color: strategy.color,
      nameEn: strategy.nameEn,
      nameTr: strategy.nameTr,
      taglineEn: strategy.taglineEn,
      taglineTr: strategy.taglineTr,
      points,
      distanceM: Math.round(distM),
      elevGainM: Math.round(gainM),
      elevLossM: Math.round(lossM),
      maxSlopeDeg: Number(maxSlopeDeg.toFixed(1)),
      avgSlopeDeg: Number(avgSlopeDeg.toFixed(1)),
      roughnessScore: Number(roughnessScore.toFixed(2)),
      slopeTierEn,
      slopeTierTr,
      estDriveSec: fit.estDriveSec,
      estEnergyKwh: fit.estEnergyKwh,
      suitabilityPct: fit.pct,
      tier: fit.tier,
      recommended: false,
      altVehicleShortLabel: altVehicle.shortLabel,
      altSuitabilityPct: altFit.pct,
      reasonEn,
      reasonTr,
    };
  }

  const strategies = [
    {
      id: "safe",
      color: "#22c55e",
      nameEn: "Route A · Safe Valley Detour",
      nameTr: "Rota A · Güvenli Vadi Rotası",
      taglineEn: "Lowest slope & roughness",
      taglineTr: "En düşük eğim ve engebe",
      bias: -1,
      cap: 15,
    },
    {
      id: "balanced",
      color: "#38bdf8",
      nameEn: "Route B · Balanced Recon Arc",
      nameTr: "Rota B · Dengeli Keşif Koridoru",
      taglineEn: "Efficiency vs terrain grade",
      taglineTr: "Süre ve eğim dengesi",
      bias: 1,
      cap: 18.5,
    },
    {
      id: "direct",
      color: "#f59e0b",
      nameEn: "Route C · Direct Crest / Ridge",
      nameTr: "Rota C · Kısa Sırt Kestirmesi",
      taglineEn: "Shortest path, steeper climbs",
      taglineTr: "En kısa mesafe, daha dik geçiş",
      bias: 0,
      cap: 23,
    },
  ];

  const routes = [];
  for (const st of strategies) {
    let cells = solveAStar(st.id, st.cap, st.bias);
    if (!cells) cells = solveAStar(st.id, 30, st.bias);
    if (!cells) cells = solveAStar(st.id, 65, 0);
    if (!cells) {
      cells = [startIdx, goalIdx];
    }
    markCorridorPenalty(cells, st.id === "safe" ? 0.55 : 0.45, 3);
    const pts = cellsToPoints(cells);
    routes.push(evaluateRoute(st, pts));
  }

  // Flag highest suitability route as recommended for this specific vehicle
  let bestRoute = routes[0];
  for (const r of routes) {
    if (r.suitabilityPct > bestRoute.suitabilityPct) bestRoute = r;
  }
  if (bestRoute) bestRoute.recommended = true;

  return {
    vehicle,
    routes,
    bounds: { minX, maxX, minZ, maxZ },
    grid: { nx, nz, stepM, elev, slope, elevMin, elevMax },
  };
}

/**
 * Tracks player/rover progress against the selected task route and target rover coordinates.
 */
export function computeTaskProgress({
  routePoints = [],
  curX = 0,
  curZ = 0,
  targetX = 0,
  targetZ = 0,
  arriveRadiusM = 13.5,
} = {}) {
  const directDistM = Math.hypot(targetX - curX, targetZ - curZ);
  const targetArrived = directDistM <= arriveRadiusM;

  let nearestIdx = 0;
  let offRouteM = directDistM;
  let alongM = 0;
  const totalRouteM = routePoints.length ? routePoints[routePoints.length - 1].sM : directDistM;

  if (routePoints.length >= 2) {
    offRouteM = Infinity;
    for (let i = 0; i < routePoints.length - 1; i++) {
      const a = routePoints[i];
      const b = routePoints[i + 1];
      const vx = b.x - a.x;
      const vz = b.z - a.z;
      const l2 = vx * vx + vz * vz || 1e-6;
      const t = Math.max(0, Math.min(1, ((curX - a.x) * vx + (curZ - a.z) * vz) / l2));
      const px = a.x + vx * t;
      const pz = a.z + vz * t;
      const d = Math.hypot(curX - px, curZ - pz);
      if (d < offRouteM) {
        offRouteM = d;
        nearestIdx = t >= 0.5 ? i + 1 : i;
        alongM = a.sM + (b.sM - a.sM) * t;
      }
    }
  }

  let nextIdx = nearestIdx;
  while (nextIdx < routePoints.length - 1 && routePoints[nextIdx].sM < alongM + 38) {
    nextIdx++;
  }
  const nextWaypoint = routePoints[nextIdx] || { x: targetX, z: targetZ, sM: totalRouteM };
  const remainingRouteM = Math.max(0, totalRouteM - alongM);

  // Scene azimuth: 0° = North (-Z), 90° = East (+X), 180° = South (+Z), 270° = West (-X)
  const bearingTo = (tx, tz) => {
    const dx = tx - curX;
    const dz = tz - curZ;
    return (((Math.atan2(dx, -dz) * 180) / Math.PI) % 360 + 360) % 360;
  };

  return {
    nearestIdx,
    alongM,
    totalRouteM,
    remainingRouteM,
    directDistM,
    offRouteM,
    nextWaypoint,
    bearingToNextDeg: bearingTo(nextWaypoint.x, nextWaypoint.z),
    bearingToTargetDeg: bearingTo(targetX, targetZ),
    targetArrived,
  };
}

/**
 * Computes surface summary metadata (spherical distance from Gale habitat for mission briefing UI).
 */
export function computeRoverRegionSummary(targetRover, galeOriginLonLat = [137.38752, -4.79725]) {
  if (!targetRover) return { marsArcKm: 0, marsBearingDeg: 0 };
  const distM = marsDistanceM(galeOriginLonLat, [targetRover.lon, targetRover.lat]);
  const bearingDeg = marsBearingDeg(galeOriginLonLat, [targetRover.lon, targetRover.lat]);
  return {
    marsArcKm: Number((distM / 1000).toFixed(1)),
    marsBearingDeg: Math.round(bearingDeg),
  };
}

/** Single guard checked by UI / orbit / fleet / transit actions to block teleporting during active Tasks. */
export function isTeleportLockedForTask(taskState) {
  return Boolean(taskState && taskState.status === "active");
}
