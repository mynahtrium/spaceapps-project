/**
 * Mars Habitat Station 3D Module
 * Combines 3 orthographic blueprint projections (Right Side, Top-Down Floor Plan, Front View)
 * into a unified 5-zone walkable & drivable habitat complex on Mars.
 *
 * Zones (local coordinates around base origin (originX, originZ), +Z is South/Front Garage Exit):
 * - Red Zone (Airlock / Stabilization Chamber - Dengeleme Alani): +X right entrance extension
 * - Pink Zone (Main Corridor & Info Displays): L-shaped hall wrapping Left & Bottom of Yellow Cafeteria
 * - Yellow Zone (Cafeteria & Common Area): Central enclosed social/dining hub
 * - Purple Zone (3-Tier Bunk Cabin Dormitory): Elevated (+0.8m) & tall (7.8m) rear module with 24 bunks
 * - Green Zone (Rover Garage & Vehicle Spawn Bay): Front section with 5 open bays & exit lanes
 */

import { getHistoricRoverById } from "../shared/mars-rovers.js";

export const HABITAT_ZONES = Object.freeze([
  { id: "redAirlock", nameEn: "Red Zone — Airlock & Stabilization Chamber", color: "#ef4444" },
  { id: "pinkCorridor", nameEn: "Pink Zone — Main Corridor & Info Displays", color: "#ec4899" },
  { id: "yellowCafeteria", nameEn: "Yellow Zone — Cafeteria & Common Area", color: "#eab308" },
  { id: "purpleDormitory", nameEn: "Purple Zone — 3-Tier Bunk Cabin Dormitory", color: "#a855f7" },
  { id: "greenGarage", nameEn: "Green Zone — Rover Garage & Vehicle Spawn Bay", color: "#22c55e" },
]);

const BAY_X_CENTERS = Object.freeze([-14.4, -7.2, 0.0, 7.2, 14.4]);
const HISTORIC_BAY_IDS = Object.freeze(["sojourner", "spirit", "opportunity", "curiosity", "perseverance"]);

const WALL_HEIGHT_HUB = 4.4;
const WALL_HEIGHT_GARAGE = 5.4;
const WALL_HEIGHT_DORM = 7.8;
const DORM_ELEV_M = 0.8;

function makeTelemetryScreenTexture(THREE, title, subtitle, lines, accentHex) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d");

  g.fillStyle = "#080d16";
  g.fillRect(0, 0, 512, 256);

  g.strokeStyle = accentHex;
  g.lineWidth = 4;
  g.strokeRect(6, 6, 500, 244);

  g.fillStyle = accentHex;
  g.fillRect(14, 14, 484, 38);
  g.fillStyle = "#04080f";
  g.font = "bold 20px monospace";
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.fillText(title, 22, 33);

  g.fillStyle = "#94a3b8";
  g.font = "bold 14px monospace";
  g.fillText(subtitle, 20, 72);

  g.fillStyle = "#e2e8f0";
  g.font = "15px monospace";
  lines.forEach((line, idx) => {
    g.fillText(line, 20, 108 + idx * 30);
  });

  // Mini telemetry bar graphic at bottom
  g.fillStyle = "rgba(56, 189, 248, 0.25)";
  g.fillRect(20, 212, 472, 22);
  g.fillStyle = accentHex;
  for (let i = 0; i < 16; i++) {
    const h = 6 + ((i * 7 + lines.length * 3) % 14);
    g.fillRect(26 + i * 29, 232 - h, 18, h);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSignTexture(THREE, label, accentHex, bg = "#0b111b") {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 96;
  const g = c.getContext("2d");
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 96);
  g.strokeStyle = accentHex;
  g.lineWidth = 5;
  g.strokeRect(4, 4, 248, 88);
  g.fillStyle = "#f8fafc";
  g.font = "bold 28px monospace";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(label, 128, 48);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createMarsHabitatStation(THREE, { originX = 0, originZ = 0, rawSampleElevY = null } = {}) {
  const group = new THREE.Group();
  let baseX = originX;
  let baseZ = originZ;
  let baseY = rawSampleElevY ? rawSampleElevY(originX, originZ) : 0;

  group.position.set(baseX, baseY, baseZ);

  const colliders = [];

  // Materials — clean sci-fi metallic exterior/interior with color-coded architectural zone accents
  const extMetalMat = new THREE.MeshStandardMaterial({ color: 0xb8c0ca, roughness: 0.36, metalness: 0.68 });
  const darkFrameMat = new THREE.MeshStandardMaterial({ color: 0x222730, roughness: 0.56, metalness: 0.72 });
  const floorDeckMat = new THREE.MeshStandardMaterial({ color: 0x363d47, roughness: 0.72, metalness: 0.38 });
  const padConcreteMat = new THREE.MeshStandardMaterial({ color: 0x453a35, roughness: 0.9, metalness: 0.1 });
  const glassRoofMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0c4a6e,
    emissiveIntensity: 0.32,
    roughness: 0.15,
    metalness: 0.4,
    transparent: true,
    opacity: 0.68,
  });

  const makeZoneGlowMat = (hex) =>
    new THREE.MeshStandardMaterial({
      color: hex,
      emissive: hex,
      emissiveIntensity: 1.55,
      roughness: 0.25,
      metalness: 0.2,
    });

  const redGlowMat = makeZoneGlowMat(0xef4444);
  const pinkGlowMat = makeZoneGlowMat(0xec4899);
  const yellowGlowMat = makeZoneGlowMat(0xeab308);
  const purpleGlowMat = makeZoneGlowMat(0xa855f7);
  const greenGlowMat = makeZoneGlowMat(0x22c55e);

  const addBox = (parent, x, y, z, w, h, d, mat, { collide = false, topY = h + y } = {}) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y + h * 0.5, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    if (collide) {
      colliders.push({
        minX: x - w * 0.5,
        maxX: x + w * 0.5,
        minZ: z - d * 0.5,
        maxZ: z + d * 0.5,
        maxY: topY,
      });
    }
    return mesh;
  };

  // Foundation apron slab so vehicles & station sit cleanly above dust
  const foundationGroup = new THREE.Group();
  foundationGroup.name = "stationFoundation";
  group.add(foundationGroup);
  addBox(foundationGroup, 1.5, -0.18, 0.5, 49.0, 0.18, 59.0, padConcreteMat);

  // =========================================================================
  // 1. RED ZONE — Airlock & Stabilization Chamber (+X right entrance extension)
  // =========================================================================
  const redZone = new THREE.Group();
  redZone.name = "redAirlock";
  group.add(redZone);
  addBox(redZone, 22.5, 0, 2.0, 9.0, 0.08, 8.0, floorDeckMat);
  // Side walls (North & South) + Roof + Exterior threshold
  addBox(redZone, 22.5, 0, -2.0, 9.0, WALL_HEIGHT_HUB, 0.45, extMetalMat, { collide: true });
  addBox(redZone, 22.5, 0, 6.0, 9.0, WALL_HEIGHT_HUB, 0.45, extMetalMat, { collide: true });
  addBox(redZone, 22.5, WALL_HEIGHT_HUB, 2.0, 9.4, 0.35, 8.4, darkFrameMat);
  // Front & back bulkhead frames with walkable center doorways (z = 2.0, width 3.2m)
  addBox(redZone, 27.0, 0, -0.8, 0.45, WALL_HEIGHT_HUB, 2.4, extMetalMat, { collide: true });
  addBox(redZone, 27.0, 0, 4.8, 0.45, WALL_HEIGHT_HUB, 2.4, extMetalMat, { collide: true });
  addBox(redZone, 27.0, 3.1, 2.0, 0.5, 1.3, 3.3, darkFrameMat);
  // Red zone neon framing + exterior entry arrow guiding inside (-X)
  addBox(redZone, 27.25, 0.12, 2.0, 0.1, 3.0, 3.4, redGlowMat);
  addBox(redZone, 28.8, 0.03, 2.0, 2.6, 0.04, 0.9, redGlowMat);
  addBox(redZone, 22.5, 3.9, 2.0, 8.2, 0.14, 0.25, redGlowMat);
  // Airlock pressure scrubber consoles along interior sides
  addBox(redZone, 22.5, 0, -1.25, 1.8, 2.1, 0.65, darkFrameMat, { collide: true });
  addBox(redZone, 22.5, 0, 5.25, 1.8, 2.1, 0.65, darkFrameMat, { collide: true });
  const airlockSignTex = makeSignTexture(THREE, "AIRLOCK // RED", "#ef4444");
  const airlockSign = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 1.1),
    new THREE.MeshBasicMaterial({ map: airlockSignTex, color: 0xffffff })
  );
  airlockSign.position.set(27.32, 3.85, 2.0);
  airlockSign.rotation.y = Math.PI / 2;
  redZone.add(airlockSign);

  // =========================================================================
  // 2. PINK ZONE — L-Shaped Main Corridor & Mars Info Displays
  // =========================================================================
  const pinkZone = new THREE.Group();
  pinkZone.name = "pinkCorridor";
  group.add(pinkZone);
  // Bottom horizontal hall (x: -18..+18, z: -2..+4) + Left vertical hall (x: -18..-12, z: -14..-2)
  addBox(pinkZone, 0.0, 0, 1.0, 36.0, 0.06, 6.0, floorDeckMat);
  addBox(pinkZone, -15.0, 0, -8.0, 6.0, 0.06, 12.0, floorDeckMat);
  addBox(pinkZone, 0.0, WALL_HEIGHT_HUB, 1.0, 36.2, 0.32, 6.2, darkFrameMat);
  addBox(pinkZone, -15.0, WALL_HEIGHT_HUB, -8.0, 6.2, 0.32, 12.2, darkFrameMat);
  // Pink floor trim rails & ceiling lighting strips
  addBox(pinkZone, 0.0, 0.07, 1.0, 33.5, 0.02, 0.28, pinkGlowMat);
  addBox(pinkZone, -15.0, 0.07, -8.0, 0.28, 0.02, 11.5, pinkGlowMat);
  // Outer East wall of bottom hall (with doorway to Red Airlock at z = 2.0)
  addBox(pinkZone, 18.0, 0, -0.8, 0.45, WALL_HEIGHT_HUB, 2.4, extMetalMat, { collide: true });
  addBox(pinkZone, 18.0, 0, 3.8, 0.45, WALL_HEIGHT_HUB, 1.0, extMetalMat, { collide: true });
  addBox(pinkZone, 18.0, 3.1, 2.0, 0.5, 1.3, 3.3, darkFrameMat);
  // Outer West wall of left L-corridor
  addBox(pinkZone, -18.0, 0, -5.0, 0.45, WALL_HEIGHT_HUB, 18.2, extMetalMat, { collide: true });
  // East side of bottom hall northern partition (from Cafeteria east wall x=14..18)
  addBox(pinkZone, 16.0, 0, -2.0, 4.0, WALL_HEIGHT_HUB, 0.42, extMetalMat, { collide: true });

  // 6 glowing Mars telemetry & science info displays mounted along the Pink L-Corridor walls
  const telemetrySpecs = [
    {
      title: "GALE REMS WEATHER",
      sub: "CURIOSITY METEOROLOGY · SOL 5070",
      lines: ["AIR TEMP: -72 C .. -4 C", "PRESSURE: 7.4 mbar CO2", "UV INDEX: HIGH · WIND 6 m/s"],
      x: 11.0,
      z: 3.7,
      ry: Math.PI,
    },
    {
      title: "RAD DOSE BUDGET",
      sub: "MSL RAD · HASSLER ET AL.",
      lines: ["GCR BASE: 0.64 +/- 0.12 mSv/d", "EVA 4h:   0.107 mSv OPEN", "SHELTER:  -48% REGOLITH"],
      x: 3.0,
      z: 3.7,
      ry: Math.PI,
    },
    {
      title: "DONKI SPACE WEATHER",
      sub: "CCMC WSA-ENLIL · MARS",
      lines: ["SEP PROTON ALERT: NOMINAL", "CME ARRIVAL WINDOW: CLEAR", "SOLAR FLUX: 590 W/m2"],
      x: -5.0,
      z: 3.7,
      ry: Math.PI,
    },
    {
      title: "BOXWORK TRAVERSE",
      sub: "ALTADENA MEMBER · HiRISE 1m",
      lines: ["PRIMARY: MUDSTONE ORGANICS", "BONUS: BOXWORK RIDGES 5m", "SAFETY MARGIN: < 15 DEG SLOPE"],
      x: -17.68,
      z: -3.5,
      ry: Math.PI / 2,
    },
    {
      title: "ROVER BAY ROSTER",
      sub: "GREEN ZONE · 5 LAUNCH LANES",
      lines: ["DRIVABLE: MMSEV + CONCEPT", "DISPLAY: SOJOURNER SPIRIT", "OPP CURIOSITY PERSEVERANCE"],
      x: -17.68,
      z: -7.8,
      ry: Math.PI / 2,
    },
    {
      title: "CREW DORM PODS",
      sub: "PURPLE ZONE · +0.8m DECK",
      lines: ["24 BUNK CABINS (8 x 3 TIERS)", "PRESSURE: 700 mbar O2/N2", "GRAVITY: 3.711 m/s2 (0.38g)"],
      x: -17.68,
      z: -12.0,
      ry: Math.PI / 2,
    },
  ];

  for (const scr of telemetrySpecs) {
    const tex = makeTelemetryScreenTexture(THREE, scr.title, scr.sub, scr.lines, "#f472b6");
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.48, 0.12), darkFrameMat);
    bezel.position.set(scr.x, 1.95, scr.z);
    bezel.rotation.y = scr.ry;
    pinkZone.add(bezel);
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 1.3),
      new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff })
    );
    panel.position.set(scr.x, 1.95, scr.z);
    panel.rotation.y = scr.ry;
    panel.translateZ(0.07);
    pinkZone.add(panel);
  }

  // =========================================================================
  // 3. YELLOW ZONE — Cafeteria & Common Area (Kafeterya)
  // =========================================================================
  const yellowZone = new THREE.Group();
  yellowZone.name = "yellowCafeteria";
  group.add(yellowZone);
  // x: -12..+14 (26m wide), z: -14..-2 (12m deep)
  addBox(yellowZone, 1.0, 0, -8.0, 26.0, 0.06, 12.0, floorDeckMat);
  addBox(yellowZone, 1.0, WALL_HEIGHT_HUB, -8.0, 26.2, 0.34, 12.2, extMetalMat);
  addBox(yellowZone, 1.0, WALL_HEIGHT_HUB + 0.12, -8.0, 10.0, 0.26, 4.0, glassRoofMat);
  addBox(yellowZone, 1.0, 3.9, -2.2, 24.0, 0.14, 0.22, yellowGlowMat);
  // Walls enclosing Yellow Zone with open doorway arches:
  // South partition (z = -2): doorway around x = 0 (width 4.0m)
  addBox(yellowZone, -7.0, 0, -2.0, 10.0, WALL_HEIGHT_HUB, 0.42, extMetalMat, { collide: true });
  addBox(yellowZone, 8.0, 0, -2.0, 12.0, WALL_HEIGHT_HUB, 0.42, extMetalMat, { collide: true });
  // East exterior wall (x = +14, solid)
  addBox(yellowZone, 14.0, 0, -8.0, 0.45, WALL_HEIGHT_HUB, 12.2, extMetalMat, { collide: true });
  // West partition (x = -12): doorway into Pink left hall at z = -8 (width 3.6m)
  addBox(yellowZone, -12.0, 0, -4.1, 0.42, WALL_HEIGHT_HUB, 4.2, extMetalMat, { collide: true });
  addBox(yellowZone, -12.0, 0, -11.9, 0.42, WALL_HEIGHT_HUB, 4.2, extMetalMat, { collide: true });

  // Sci-fi dining tables, seating & food dispensers inside Yellow Zone
  for (const [tx, tz] of [
    [-5.0, -5.8],
    [4.5, -5.8],
    [-5.0, -10.2],
    [4.5, -10.2],
  ]) {
    addBox(yellowZone, tx, 0, tz, 2.8, 0.78, 1.3, extMetalMat, { collide: true });
    addBox(yellowZone, tx, 0.78, tz, 2.5, 0.04, 1.05, yellowGlowMat);
    for (const sx of [-0.9, 0.9]) {
      for (const sz of [-0.95, 0.95]) {
        addBox(yellowZone, tx + sx, 0, tz + sz, 0.46, 0.48, 0.46, darkFrameMat);
      }
    }
  }
  // 3 Food & Hydration Dispensers along East wall (x = 13.1)
  for (const dz of [-4.5, -8.0, -11.5]) {
    addBox(yellowZone, 13.0, 0, dz, 0.95, 2.25, 1.8, darkFrameMat, { collide: true });
    addBox(yellowZone, 12.5, 0.95, dz, 0.08, 0.85, 1.3, yellowGlowMat);
  }

  // =========================================================================
  // 4. PURPLE ZONE — Elevated 3-Tier Bunk Cabin Dormitory (3 Katli Kabin Yataklar)
  // =========================================================================
  const purpleZone = new THREE.Group();
  purpleZone.name = "purpleDormitory";
  group.add(purpleZone);
  // x: -18..+18 (36m wide), z: -28..-14 (14m deep), elevated +0.8m floor, 7.8m roof height!
  addBox(purpleZone, 0, 0, -21.0, 36.2, DORM_ELEV_M, 14.2, darkFrameMat);
  addBox(purpleZone, 0, DORM_ELEV_M, -21.0, 35.8, 0.05, 13.8, floorDeckMat);
  // Tall outer module walls + roof
  addBox(purpleZone, 0, DORM_ELEV_M, -28.0, 36.2, WALL_HEIGHT_DORM - DORM_ELEV_M, 0.5, extMetalMat, {
    collide: true,
    topY: WALL_HEIGHT_DORM,
  });
  addBox(purpleZone, -18.0, DORM_ELEV_M, -21.0, 0.5, WALL_HEIGHT_DORM - DORM_ELEV_M, 14.2, extMetalMat, {
    collide: true,
    topY: WALL_HEIGHT_DORM,
  });
  addBox(purpleZone, 18.0, DORM_ELEV_M, -21.0, 0.5, WALL_HEIGHT_DORM - DORM_ELEV_M, 14.2, extMetalMat, {
    collide: true,
    topY: WALL_HEIGHT_DORM,
  });
  // South partition wall (z = -14) with 2 open stair/ramp portals:
  // West ramp portal (x: -17..-13 from Pink Left wing) & East/Center portal (x: +4.5..+7.5 from Yellow)
  addBox(purpleZone, -4.0, DORM_ELEV_M, -14.0, 17.5, WALL_HEIGHT_DORM - DORM_ELEV_M, 0.45, extMetalMat, {
    collide: true,
    topY: WALL_HEIGHT_DORM,
  });
  addBox(purpleZone, 12.8, DORM_ELEV_M, -14.0, 10.4, WALL_HEIGHT_DORM - DORM_ELEV_M, 0.45, extMetalMat, {
    collide: true,
    topY: WALL_HEIGHT_DORM,
  });
  // Purple Dormitory towering roof + glowing purple exterior ribs (visible in Front & Right views)
  addBox(purpleZone, 0, WALL_HEIGHT_DORM, -21.0, 36.8, 0.42, 14.8, extMetalMat);
  addBox(purpleZone, 0, WALL_HEIGHT_DORM - 0.35, -13.7, 36.6, 0.24, 0.24, purpleGlowMat);
  addBox(purpleZone, 18.2, WALL_HEIGHT_DORM - 0.35, -21.0, 0.24, 0.24, 14.4, purpleGlowMat);
  addBox(purpleZone, 0, DORM_ELEV_M + 0.08, -21.0, 32.0, 0.02, 0.35, purpleGlowMat);

  // Visible sloped access ramps connecting lower deck up to the +0.8m Purple Dormitory deck
  for (const rampX of [-15.0, 6.0]) {
    const rampGeom = new THREE.BoxGeometry(3.2, 0.14, 2.8);
    const ramp = new THREE.Mesh(rampGeom, purpleGlowMat);
    ramp.position.set(rampX, DORM_ELEV_M * 0.5, -12.8);
    ramp.rotation.x = Math.atan2(DORM_ELEV_M, 2.6);
    ramp.receiveShadow = true;
    purpleZone.add(ramp);
  }

  // 8 Three-Tier Vertical Bunk Cabin Stacks (4 along North wall, 4 along South wall = 24 sleeping pods)
  const mattressMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.85, metalness: 0.05 });
  for (const rowZ of [-26.2, -16.0]) {
    for (const bx of [-12.0, -4.0, 4.0, 12.0]) {
      // Skip blocking East portal at x = +4..+8 on South row: nudge East-south stack to +12 / +16
      const podX = rowZ > -20 && bx === 4.0 ? 15.6 : bx;
      // Frame columns
      addBox(purpleZone, podX, DORM_ELEV_M, rowZ, 4.8, 5.8, 2.4, darkFrameMat, { collide: true, topY: WALL_HEIGHT_DORM });
      for (let tier = 0; tier < 3; tier++) {
        const ty = DORM_ELEV_M + 0.45 + tier * 1.85;
        addBox(purpleZone, podX, ty, rowZ, 4.4, 0.22, 2.1, extMetalMat);
        addBox(purpleZone, podX, ty + 0.22, rowZ, 3.8, 0.18, 1.75, mattressMat);
        // Purple ambient berth light strip
        const lightZ = rowZ < -21 ? rowZ + 1.12 : rowZ - 1.12;
        addBox(purpleZone, podX, ty + 1.25, lightZ, 3.2, 0.09, 0.1, purpleGlowMat);
      }
      // Vertical access ladder on walkway-facing side
      const ladderZ = rowZ < -21 ? rowZ + 1.25 : rowZ - 1.25;
      addBox(purpleZone, podX - 2.15, DORM_ELEV_M, ladderZ, 0.08, 5.5, 0.08, extMetalMat);
      addBox(purpleZone, podX - 1.65, DORM_ELEV_M, ladderZ, 0.08, 5.5, 0.08, extMetalMat);
      for (let rung = 0; rung < 12; rung++) {
        addBox(purpleZone, podX - 1.9, DORM_ELEV_M + 0.42 + rung * 0.44, ladderZ, 0.5, 0.05, 0.06, extMetalMat);
      }
    }
  }

  // =========================================================================
  // 5. GREEN ZONE — Rover Garage & 5-Bay Vehicle Spawn Bay (Araba Spawn Bolumu)
  // =========================================================================
  const greenZone = new THREE.Group();
  greenZone.name = "greenGarage";
  group.add(greenZone);
  // x: -18..+18 (36m wide), z: +4..+18 (14m deep), roof height 5.4m
  addBox(greenZone, 0, 0, 11.0, 36.2, 0.06, 14.2, floorDeckMat);
  addBox(greenZone, 0, WALL_HEIGHT_GARAGE, 11.0, 36.6, 0.38, 14.6, extMetalMat);
  addBox(greenZone, -18.0, 0, 11.0, 0.48, WALL_HEIGHT_GARAGE, 14.2, extMetalMat, { collide: true });
  addBox(greenZone, 18.0, 0, 11.0, 0.48, WALL_HEIGHT_GARAGE, 14.2, extMetalMat, { collide: true });
  // Green north header beam above Pink<->Green archways
  addBox(greenZone, 0, 3.8, 4.0, 36.0, WALL_HEIGHT_GARAGE - 3.8, 0.36, darkFrameMat);

  // Structural piers between the 5 wide Rover Bay doors along z = +18
  for (const px of [-18.0, -10.8, -3.6, 3.6, 10.8, 18.0]) {
    addBox(greenZone, px, 0, 18.0, 1.5, WALL_HEIGHT_GARAGE, 0.85, darkFrameMat, { collide: true });
    addBox(greenZone, px, 0.35, 18.46, 0.24, WALL_HEIGHT_GARAGE - 0.6, 0.08, greenGlowMat);
  }
  // Upper lintel beam above all 5 open bay portals (clear bay doorway height = 4.5m!)
  addBox(greenZone, 0, 4.55, 18.0, 36.4, WALL_HEIGHT_GARAGE - 4.55, 0.9, extMetalMat);
  addBox(greenZone, 0, 4.5, 18.46, 36.2, 0.16, 0.08, greenGlowMat);

  // 5 numbered Bay Signs + glowing green exit lanes with outward Martian surface arrows
  BAY_X_CENTERS.forEach((bx, idx) => {
    const signTex = makeSignTexture(THREE, `BAY 0${idx + 1}`, "#22c55e");
    const signMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.85),
      new THREE.MeshBasicMaterial({ map: signTex, color: 0xffffff })
    );
    signMesh.position.set(bx, 5.0, 18.48);
    greenZone.add(signMesh);

    // Interior/Exterior exit lane floor runway stripes & glowing outward arrow head at z = +29
    addBox(greenZone, bx - 1.9, 0.03, 18.0, 0.16, 0.02, 22.0, greenGlowMat);
    addBox(greenZone, bx + 1.9, 0.03, 18.0, 0.16, 0.02, 22.0, greenGlowMat);
    addBox(greenZone, bx, 0.03, 21.0, 0.28, 0.02, 16.0, greenGlowMat);
    const arrowTip = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.4, 3), greenGlowMat);
    arrowTip.position.set(bx, 0.05, 29.5);
    arrowTip.rotation.x = Math.PI / 2;
    greenZone.add(arrowTip);
  });

  // Interior warm ceiling bay lights
  for (const lx of [-10.0, 0.0, 10.0]) {
    const garageLight = new THREE.PointLight(0xd9f99d, 1.6, 22, 1.5);
    garageLight.position.set(lx, 4.2, 11.0);
    greenZone.add(garageLight);
  }
  const hubLight = new THREE.PointLight(0xfde68a, 1.5, 26, 1.5);
  hubLight.position.set(1.0, 3.8, -7.0);
  yellowZone.add(hubLight);
  const dormLight = new THREE.PointLight(0xe9d5ff, 1.6, 26, 1.5);
  dormLight.position.set(0.0, 6.4, -21.0);
  purpleZone.add(dormLight);

  function setBasePose(newOriginX, newOriginZ, sampler = rawSampleElevY) {
    baseX = newOriginX;
    baseZ = newOriginZ;
    baseY = sampler ? sampler(newOriginX, newOriginZ) : 0;
    group.position.set(baseX, baseY, baseZ);
  }

  function sampleElevWithHabitat(x, z, rawTerrainY) {
    const lx = x - baseX;
    const lz = z - baseZ;

    // Smooth blend weight into flat station foundation pad (lx in [-26..+33], lz in [-34..+34])
    const padHalfW = 29.5;
    const padHalfL = 34.0;
    const padCx = 3.5;
    const padCz = 0.0;
    const dx = Math.max(0, Math.abs(lx - padCx) - (padHalfW - 6.0));
    const dz = Math.max(0, Math.abs(lz - padCz) - (padHalfL - 6.0));
    const edgeDist = Math.hypot(dx, dz);
    if (edgeDist >= 8.0) return rawTerrainY;

    const flatT = edgeDist <= 0 ? 1 : 1 - Math.pow(edgeDist / 8.0, 2) * (3 - 2 * (edgeDist / 8.0));
    let groundY = rawTerrainY + (baseY - rawTerrainY) * flatT;

    // Purple Dormitory +0.8m elevated deck & access ramps
    if (lx >= -17.6 && lx <= 17.6 && lz >= -27.8 && lz <= -14.2) {
      return Math.max(groundY, baseY + DORM_ELEV_M);
    }
    if (lz > -14.2 && lz <= -11.4) {
      const rampT = Math.max(0, Math.min(1, (-11.4 - lz) / 2.8));
      const inWestRamp = lx >= -17.2 && lx <= -12.8;
      const inEastRamp = lx >= 4.2 && lx <= 7.8;
      if (inWestRamp || inEastRamp) {
        return Math.max(groundY, baseY + rampT * DORM_ELEV_M);
      }
    }
    return groundY;
  }

  function resolveCollision(entityX, entityZ, entityRadius = 0.42, entityY = null) {
    const relY = entityY != null && Number.isFinite(entityY) ? entityY - baseY : 0;
    let outX = entityX - baseX;
    let outZ = entityZ - baseZ;
    let anyHit = false;
    let outNx = 0;
    let outNz = 0;
    let maxPen = 0;

    for (const c of colliders) {
      if (relY > c.maxY - 0.1) continue;
      const cx = Math.max(c.minX, Math.min(c.maxX, outX));
      const cz = Math.max(c.minZ, Math.min(c.maxZ, outZ));
      const dx = outX - cx;
      const dz = outZ - cz;
      const dSq = dx * dx + dz * dz;
      if (dSq >= entityRadius * entityRadius) continue;

      anyHit = true;
      if (dSq > 1e-8) {
        const d = Math.sqrt(dSq);
        const pen = entityRadius - d;
        const nx = dx / d;
        const nz = dz / d;
        outX = cx + nx * entityRadius;
        outZ = cz + nz * entityRadius;
        if (pen > maxPen) {
          maxPen = pen;
          outNx = nx;
          outNz = nz;
        }
      } else {
        const pL = outX - c.minX;
        const pR = c.maxX - outX;
        const pT = outZ - c.minZ;
        const pB = c.maxZ - outZ;
        const m = Math.min(pL, pR, pT, pB);
        let nx = 0;
        let nz = 0;
        if (m === pL) {
          nx = -1;
          outX = c.minX - entityRadius;
        } else if (m === pR) {
          nx = 1;
          outX = c.maxX + entityRadius;
        } else if (m === pT) {
          nz = -1;
          outZ = c.minZ - entityRadius;
        } else {
          nz = 1;
          outZ = c.maxZ + entityRadius;
        }
        const pen = m + entityRadius;
        if (pen > maxPen) {
          maxPen = pen;
          outNx = nx;
          outNz = nz;
        }
      }
    }

    return {
      hit: anyHit,
      x: baseX + outX,
      z: baseZ + outZ,
      nx: outNx,
      nz: outNz,
      pen: maxPen,
    };
  }

  function getBayPlacements() {
    const historicPlacements = HISTORIC_BAY_IDS.map((id, idx) => ({
      id,
      spec: getHistoricRoverById(id),
      x: baseX + BAY_X_CENTERS[idx],
      z: baseZ + 11.4,
      yaw: Math.PI, // face +Z (out through open Green Garage bays)
      slopeDeg: 0,
      bayNumber: idx + 1,
    })).filter((p) => p.spec);

    const drivablePlacements = [
      {
        vehicleType: "mmsev",
        x: baseX + BAY_X_CENTERS[1],
        z: baseZ + 25.0,
        yaw: Math.PI,
        bayNumber: 2,
      },
      {
        vehicleType: "nasa_concept",
        x: baseX + BAY_X_CENTERS[3],
        z: baseZ + 25.0,
        yaw: Math.PI,
        bayNumber: 4,
      },
    ];

    const entryPoint = {
      x: baseX + 0.0,
      z: baseZ + 33.5,
      yaw: 0, // face North (-Z) overlooking all 5 Green Garage bays + both drivable rovers
    };

    const airlockEntryPoint = {
      x: baseX + 30.5,
      z: baseZ + 2.0,
      yaw: Math.PI / 2,
    };

    return { historicPlacements, drivablePlacements, entryPoint, airlockEntryPoint };
  }

  return {
    group,
    zones: HABITAT_ZONES,
    get baseX() {
      return baseX;
    },
    get baseY() {
      return baseY;
    },
    get baseZ() {
      return baseZ;
    },
    setBasePose,
    sampleElevWithHabitat,
    resolveCollision,
    getBayPlacements,
  };
}
