/**
 * Mars Habitat Station (`web/hud/mars-habitat.js`)
 *
 * Built from the team's three hand-drawn orthographic blueprints (SAĞ = right side, ÜST = top-down
 * floor plan, ÖN = front). The floor plan sets the layout; the side and front sketches set the
 * relative heights (the purple dormitory is the tallest block, the hub modules are the lowest).
 *
 * Local frame: +X = right (airlock side), +Z = front (garage doors open towards +Z), y = 0 is the
 * levelled pad. The pressurized deck sits DECK m above the pad; ramps lead down to the ground.
 *
 *   x: -18 ............ -12 .......................... 5 ....... 18 ............... 32
 *   z: -28 ┌──────────── PURPLE dormitory ─────────────┐
 *          │   3 double rows of 3-tier bunk stacks      │
 *   z:  -9 ├───┬────────────────────────────────────────┴─────────┐
 *          │ P │            YELLOW cafeteria / mess hall          │
 *          │ I │                                                  │
 *   z:   4 │ N └──────────────────────────────────────────────────┼──── RED airlock ───┐  ← entry
 *          │ K              L-shaped corridor (bottom leg)        │  (stabilization)   │
 *   z:  10 ├──────────────────────────────────────────────────────┼────────────────────┘
 *          │              GREEN 5-bay rover garage                │
 *   z:  22 └── bay 1 ── bay 2 ── bay 3 ── bay 4 ── bay 5 ─────────┘
 *                ↓        ↓        ↓        ↓        ↓     ramps onto the Martian surface
 *
 * The station itself is fictional (illustrative design values); wall screens that show Mars data
 * cite their source or say "illustrative" in their footer.
 */

import { getHistoricRoverById } from "../shared/mars-rovers.js";
import { mergeStaticMeshes } from "./merge-static.js";
import {
  createShelfAtlas,
  drawFloorDecalOnCtx,
  drawSignOnCtx,
  drawTelemetryScreenOnCtx,
  makeHabitatTextures,
  remapPlaneUV,
} from "./habitat-textures.js";

export const HABITAT_ZONES = Object.freeze([
  {
    id: "redAirlock",
    nameEn: "Red Zone — Pressurized Airlock & Stabilization Chamber",
    nameTr: "Kırmızı Bölge — Hava Kilidi ve Dengeleme Alanı",
    color: "#ef4444",
  },
  {
    id: "pinkCorridor",
    nameEn: "Pink Zone — L-Shaped Corridor & Telemetry Hub",
    nameTr: "Pembe Bölge — Koridor ve Bilgi Ekranları",
    color: "#ec4899",
  },
  {
    id: "yellowCafeteria",
    nameEn: "Yellow Zone — Cafeteria & Mess Hall",
    nameTr: "Sarı Bölge — Kafeterya",
    color: "#eab308",
  },
  {
    id: "purpleDormitory",
    nameEn: "Purple Zone — 3-Tier Bunk Cabin Dormitory",
    nameTr: "Mor Bölge — 3 Katlı Kabin Yataklar",
    color: "#a855f7",
  },
  {
    id: "greenGarage",
    nameEn: "Green Zone — 5-Bay Rover Garage & Spawn Hangar",
    nameTr: "Yeşil Bölge — Araç Garajı ve Spawn Bölümü",
    color: "#22c55e",
  },
]);

// ---------------------------------------------------------------------------------------------
// Layout (metres, local frame)
// ---------------------------------------------------------------------------------------------
const DECK = 0.5; // pressurized floor above the pad
const DORM_RISE = 0.6; // dormitory deck is raised again (taller block in the side / front views)
const DORM_FLOOR = DECK + DORM_RISE;
const H_HUB = 4.2;
const H_GARAGE = 7.6;
const H_DORM = 6.0;
const T = 0.36; // wall thickness
const HUB_TOP = DECK + H_HUB;
const GARAGE_TOP = DECK + H_GARAGE;
const DORM_TOP = DORM_FLOOR + H_DORM;

const RECTS = Object.freeze({
  pinkL: { minX: -18, maxX: -12, minZ: -9, maxZ: 4 },
  pinkB: { minX: -18, maxX: 18, minZ: 4, maxZ: 10 },
  yellow: { minX: -12, maxX: 18, minZ: -9, maxZ: 4 },
  purple: { minX: -16, maxX: 5, minZ: -28, maxZ: -9 },
  red: { minX: 18, maxX: 32, minZ: 4, maxZ: 10 },
  green: { minX: -18, maxX: 18, minZ: 10, maxZ: 22 },
});
const ZONE_OF_RECT = Object.freeze({
  pinkL: "pinkCorridor",
  pinkB: "pinkCorridor",
  yellow: "yellowCafeteria",
  purple: "purpleDormitory",
  red: "redAirlock",
  green: "greenGarage",
});

const BAY_X = Object.freeze([-14.4, -7.2, 0.0, 7.2, 14.4]);
const HISTORIC_BAY_IDS = Object.freeze(["sojourner", "spirit", "opportunity", "curiosity", "perseverance"]);
const PIER_X = Object.freeze([-18, -10.8, -3.6, 3.6, 10.8, 18]);
const BAY_DOOR_W = 5.9;
const BAY_DOOR_H = 5.2;
const BAY_FRONT_Z = 22;
const RAMP_LEN = 5.0; // garage ramps, z 22 -> 27
const RAMP_HALF_W = 2.9;
const HANGAR_OPEN_RADIUS = 24;

const DORM_DOORS = Object.freeze([
  { x: -14, w: 2.6 },
  { x: 0, w: 2.6 },
]);
const DORM_RAMP_LEN = 4.5; // inside the hub, z -9 -> -4.5

const AIRLOCK_DOOR_Z = 7;
const AIRLOCK_DOOR_W = 2.6;
const AIRLOCK_DOOR_H = 3.0;
const AIRLOCK_RAMP = Object.freeze({ x0: 32, x1: 36.5, z0: 5.2, z1: 8.8 });

/** Transit Terminal (hologram table at the corridor junction) and where a returning walker arrives. */
const TRANSIT_TERMINAL = Object.freeze({ x: -15, z: 7 });
const TRANSIT_ARRIVAL = Object.freeze({ x: -11.6, z: 7, yaw: Math.PI / 2 }); // facing the terminal (-X)

/** Where the walker spawns, relative to the station origin (+Z = in front of the garage). */
export const ENTRY_OFFSET_Z = 40;

// Terrain under and around the station is levelled to the pad height and blended back out.
const PAD = Object.freeze({ minX: -26, maxX: 44, minZ: -36, maxZ: 46 });
const PAD_BLEND = 10;

// ---------------------------------------------------------------------------------------------
// Wall screen content. Footers carry the honesty label (source, or "illustrative").
// ---------------------------------------------------------------------------------------------
const SCREEN_SPECS = Object.freeze([
  {
    title: "MARS ATMOSPHERE · SOL CYCLE",
    tag: "GALE",
    kind: "graph",
    yLabels: ["HIGH", "", "", "", "LOW"],
    series: [
      { label: "AIR TEMP", color: "#f97316", fn: (t) => 0.18 + 0.62 * Math.max(0, Math.sin(Math.PI * (t - 0.22) * 1.6)) ** 0.8 },
      { label: "PRESSURE", color: "#38bdf8", fn: (t) => 0.55 + 0.08 * Math.cos(2 * Math.PI * (t + 0.1)) + 0.03 * Math.cos(4 * Math.PI * t) },
    ],
    footer: "Illustrative curve in the style of Curiosity REMS data — not live",
  },
  {
    title: "STATION POWER BUS",
    tag: "HAB-1",
    kind: "bars",
    bars: [
      { label: "SOLAR ARRAY", v: 0.72, color: "#facc15" },
      { label: "BATTERY BANK", v: 0.88, color: "#22c55e" },
      { label: "LIFE SUPPORT", v: 0.41, color: "#38bdf8" },
      { label: "ROVER CHARGERS", v: 0.63, color: "#a855f7" },
      { label: "HYDROPONICS", v: 0.29, color: "#4ade80" },
    ],
    footer: "Illustrative values — the station is a design concept",
  },
  {
    title: "TERRAIN MAP · MOUNT SHARP",
    tag: "SCHEMATIC",
    kind: "map",
    footer: "Schematic only — the planner shows the HiRISE DTM slope map",
  },
  {
    title: "RADIATION · DOSE BUDGET",
    tag: "MSL RAD",
    kind: "text",
    lines: [
      "GCR BASELINE  0.64 ± 0.12 mSv/day",
      "4 h EVA, OPEN GROUND  ≈ 0.11 mSv",
      "DOSE CHANGES WITH TIME, NOT PLACE",
      "SHELTER: HABITAT / ROVER CABIN",
    ],
    footer: "Source: Hassler et al., Science 2014 (Curiosity RAD)",
  },
  {
    title: "SPACE WEATHER · DONKI",
    tag: "CCMC",
    kind: "text",
    lines: ["WSA-ENLIL RUNS WITH MARS IMPACT", "CME / SEP WATCH FOR EVA WINDOW", "SEE HUD BANNER FOR CACHED RUNS", "STATUS ON THIS PANEL: DEMO"],
    footer: "Source: NASA CCMC DONKI — this panel is a placeholder",
  },
  {
    title: "ROVER BAY ROSTER",
    tag: "GREEN ZONE",
    kind: "text",
    lines: [
      "01 SOJOURNER     1997 PATHFINDER",
      "02 SPIRIT        2004 MER-A",
      "03 OPPORTUNITY   2004 MER-B",
      "04 CURIOSITY     2012 MSL",
      "05 PERSEVERANCE  2021 MARS 2020",
      "APRON: 2 DRIVABLE CREW ROVERS",
    ],
    footer: "Landing years: NASA mission pages · models are procedural",
  },
  {
    title: "CREW DORMITORY",
    tag: "PURPLE ZONE",
    kind: "text",
    lines: ["36 STACKS × 3 TIERS = 108 BERTHS", "RAISED DECK +0.6 m", "MARS g = 3.71 m/s² (0.38 g)", "LIGHTS-OUT 22:00 LMST"],
    footer: "Berth count and schedule are illustrative design values",
  },
  {
    title: "AIRLOCK CYCLE",
    tag: "A-1",
    kind: "text",
    lines: ["1  SUIT + PLSS CHECK", "2  INNER DOOR SEALED", "3  PUMP DOWN TO ~6 mbar (MARS)", "4  OUTER DOOR OPENS"],
    footer: "Mars surface ~6 mbar (NASA) · cycle steps illustrative",
  },
  {
    id: "tasks",
    title: "EVA TASKS · ROTA",
    tag: "[E] MISSION ROUTER",
    kind: "tasks",
    interactive: true,
    accent: "#22d3ee",
    footer: "Slope limits: NASA lunar ConOps stand-ins · ETA & energy illustrative",
  },
]);

// ---------------------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------------------
function makeMaterials(THREE, tex) {
  const std = (p, tile = 2) => {
    const m = new THREE.MeshStandardMaterial(p);
    m.userData.tile = tile;
    return m;
  };
  const glow = (hex, intensity = 1.6) =>
    std({ color: hex, emissive: hex, emissiveIntensity: intensity, roughness: 0.35, metalness: 0.1 });
  const additive = (hex, opacity) =>
    new THREE.MeshBasicMaterial({
      color: hex,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  return {
    hull: std({ color: 0xffffff, map: tex.hull, roughness: 0.52, metalness: 0.18 }, 4),
    hullInterior: std({ color: 0xf4f3f0, map: tex.hull, roughness: 0.62, metalness: 0.06 }, 4),
    titanium: std({ color: 0x3b4048, roughness: 0.4, metalness: 0.85 }),
    titaniumDark: std({ color: 0x23272d, roughness: 0.5, metalness: 0.8 }),
    steel: std({ color: 0xffffff, map: tex.brushed, roughness: 0.3, metalness: 0.92 }, 1),
    diamond: std({ color: 0xffffff, map: tex.diamond, roughness: 0.42, metalness: 0.85 }, 0.8),
    grate: std({ color: 0xffffff, map: tex.grate, roughness: 0.5, metalness: 0.8 }, 0.5),
    composite: std({ color: 0xffffff, map: tex.composite, roughness: 0.68, metalness: 0.05 }, 2),
    dormFloor: std({ color: 0xffffff, map: tex.dormFloor, roughness: 0.85, metalness: 0.02 }, 2),
    hazard: std({ color: 0x5c6168, roughness: 0.6, metalness: 0.35 }, 0.6),
    slat: std({ color: 0xffffff, map: tex.slat, roughness: 0.45, metalness: 0.55 }, 1),
    solar: std({ color: 0xffffff, map: tex.solar, roughness: 0.25, metalness: 0.6 }, 1),
    whiteGloss: std({ color: 0xf3f5f7, roughness: 0.22, metalness: 0.05 }),
    rubber: std({ color: 0x18191c, roughness: 0.92, metalness: 0 }),
    seat: std({ color: 0x2b3442, roughness: 0.75, metalness: 0.05 }),
    fabric: std({ color: 0x8a90b0, roughness: 0.95, metalness: 0 }),
    blanket: std({ color: 0x5b3a8c, roughness: 0.95, metalness: 0 }),
    pillow: std({ color: 0xe8e6ef, roughness: 0.95, metalness: 0 }),
    shutter: std({ color: 0x544680, roughness: 0.9, metalness: 0 }),
    leaf: std({ color: 0x3c9a3a, roughness: 0.8, metalness: 0 }),
    leafLight: std({ color: 0x6cc24a, roughness: 0.8, metalness: 0 }),
    soil: std({ color: 0x3a2a22, roughness: 1, metalness: 0 }),
    toolRed: std({ color: 0x6e737a, roughness: 0.38, metalness: 0.55 }),
    redPaint: std({ color: 0xd9dbde, roughness: 0.5, metalness: 0.1 }),
    craneYellow: std({ color: 0x9aa0a7, roughness: 0.45, metalness: 0.5 }),
    paintYellow: std({ color: 0xc9ccd0, roughness: 0.65, metalness: 0.05 }),
    suit: std({ color: 0xebe8e0, roughness: 0.85, metalness: 0.02 }),
    visor: std({ color: 0xd4a017, roughness: 0.12, metalness: 1.0 }),
    cable: std({ color: 0x15161a, roughness: 0.6, metalness: 0.1 }),
    regolithPad: std({ color: 0x5b4a40, roughness: 0.96, metalness: 0.02 }, 3),
    doorPaint: std({ color: 0x59616b, roughness: 0.48, metalness: 0.6 }),
    viewport: std({ color: 0x101316, roughness: 0.05, metalness: 0.9 }),
    // Built opaque so the static merge bakes it; switched to transparent once merging is done.
    glass: std({ color: 0xdfe3e7, roughness: 0.04, metalness: 0.3, opacity: 0.2, depthWrite: false }),
    // every light in the station is plain white (Cagan: no coloured lighting); the names are kept so
    // the builders below need no changes
    ledRed: glow(0xf4f6f8, 1.6),
    ledPink: glow(0xf4f6f8, 1.6),
    ledYellow: glow(0xf4f6f8, 1.6),
    ledPurple: glow(0xf4f6f8, 1.6),
    ledGreen: glow(0xf4f6f8, 1.6),
    ledCool: glow(0xf4f6f8, 1.4),
    warmPanel: glow(0xf4f6f8, 1.5),
    coolPanel: glow(0xf4f6f8, 1.6),
    growLight: glow(0xf4f6f8, 1.8),
    readingLight: glow(0xf4f6f8, 1.6),
    statusGreen: glow(0xf4f6f8, 1.6),
    statusCyan: glow(0xf4f6f8, 1.6),
    amber: glow(0xf4f6f8, 1.6),
    beacon: glow(0xf4f6f8, 2.0),
    beamRed: additive(0xffffff, 0.07),
    holo: new THREE.MeshBasicMaterial({
      color: 0xe8ecf0,
      wireframe: true,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    holoCone: additive(0xffffff, 0.06),
  };
}

// ---------------------------------------------------------------------------------------------
// Station
// ---------------------------------------------------------------------------------------------
export function createMarsHabitatStation(THREE, { originX = 0, originZ = 0, rawSampleElevY = null } = {}) {
  const group = new THREE.Group();
  group.name = "marsHabitatStation";
  let baseX = originX;
  let baseZ = originZ;
  let baseY = rawSampleElevY ? rawSampleElevY(originX, originZ) : 0;
  group.position.set(baseX, baseY, baseZ);

  const tex = makeHabitatTextures(THREE);
  const M = makeMaterials(THREE, tex);
  const colliders = [];
  const hangarDoors = [];
  const airlockDoors = [];
  const beaconBeams = [];
  const interactiveGroup = new THREE.Group();
  interactiveGroup.name = "habitatInteractiveTargets";
  group.add(interactiveGroup);
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  let holo = null;
  let craneBridge = null;
  let craneTrolley = null;
  let craneCable = null;
  let craneHook = null;
  let airlockLight = null;
  let clock = 0;

  // ---------- primitives ----------
  /** BoxGeometry with UVs scaled to metres so tiled textures keep one texel density. */
  function boxGeo(w, h, d, tile = 2) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const dims = [
      [d, h],
      [d, h],
      [w, d],
      [w, d],
      [w, h],
      [w, h],
    ];
    for (let f = 0; f < 6; f++) {
      const [du, dv] = dims[f];
      for (let j = 0; j < 4; j++) {
        const i = f * 4 + j;
        uv.setXY(i, (uv.getX(i) * du) / tile, (uv.getY(i) * dv) / tile);
      }
    }
    return g;
  }

  function mesh(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rx || ry || rz) m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  function collider(minX, maxX, minZ, maxZ, minY, maxY, { walk = true, cam = true, dyn = null } = {}) {
    const c = { minX, maxX, minZ, maxZ, minY, maxY, walk, cam, dyn };
    colliders.push(c);
    return c;
  }

  /** Box whose bottom sits at y0 (centre x/z). opts.collide adds a collider; opts.walk=false = camera only. */
  function bx(parent, cx, y0, cz, w, h, d, mat, opts = {}) {
    const m = mesh(parent, boxGeo(w, h, d, mat.userData?.tile ?? 2), mat, cx, y0 + h / 2, cz);
    if (opts.collide) {
      collider(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2, y0, y0 + h, { walk: opts.walk !== false });
    }
    return m;
  }

  function cyl(parent, r, h, mat, x, y, z, { axis = "y", seg = 16, r2 = r, open = false } = {}) {
    const g = new THREE.CylinderGeometry(r, r2, h, seg, 1, open);
    if (axis === "x") g.rotateZ(Math.PI / 2);
    else if (axis === "z") g.rotateX(Math.PI / 2);
    return mesh(parent, g, mat, x, y, z);
  }

  /** Thin extruded triangle/polygon. pts are [u, v] in the plane; plane "zy" or "xy". */
  function prism(parent, pts, thickness, mat, plane, offset) {
    const shape = new THREE.Shape();
    shape.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
    if (plane === "zy") {
      g.rotateY(-Math.PI / 2); // u -> z, extrusion -> -x
      return mesh(parent, g, mat, offset + thickness, 0, 0);
    }
    return mesh(parent, g, mat, 0, 0, offset);
  }

  const portholeGeoCache = new Map();
  function portholeBezelGeo(size, r, depth) {
    const key = `${size}|${r}|${depth}`;
    if (portholeGeoCache.has(key)) return portholeGeoCache.get(key);
    const s = size / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-s, -s);
    shape.lineTo(s, -s);
    shape.lineTo(s, s);
    shape.lineTo(-s, s);
    shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, r, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 28 });
    g.translate(0, 0, -depth / 2);
    portholeGeoCache.set(key, g);
    return g;
  }

  const virtualLights = [];
  const pooledAnchors = [new THREE.Group(), new THREE.Group()];
  const pooledPointLights = [
    new THREE.PointLight(0xffffff, 0, 24, 1.6),
    new THREE.PointLight(0xffffff, 0, 24, 1.6),
  ];
  for (let i = 0; i < pooledPointLights.length; i++) {
    pooledAnchors[i].add(pooledPointLights[i]);
    group.add(pooledAnchors[i]);
  }

  function pointLight(_parent, _color, intensity, distance, x, y, z, decay = 1.6) {
    // Register virtual emitter driven by the 2 pooled scene PointLights nearest the actor
    // so shader programs compile for only 2 habitat PointLights instead of 7+.
    const emitter = { x, y, z, intensity, baseIntensity: intensity, distance, decay };
    virtualLights.push(emitter);
    return emitter;
  }

  const signAtlas = createShelfAtlas(THREE, 2048, 1024, { pad: 4, bg: "#0b111b" });
  const screenAtlas = createShelfAtlas(THREE, 2048, 1024, { pad: 4, bg: "#02060e" });
  const decalAtlas = createShelfAtlas(THREE, 1024, 512, { pad: 4, bg: null });
  const signMat = new THREE.MeshBasicMaterial({
    map: signAtlas.texture,
    color: signAtlas.texture ? 0xffffff : 0x0b111b,
    toneMapped: false,
  });
  const screenMat = new THREE.MeshBasicMaterial({
    map: screenAtlas.texture,
    color: screenAtlas.texture ? 0xd8d8d8 : 0x0b1a2e,
    toneMapped: false,
  });
  // Built opaque so mergeStaticMeshes bakes the 5 bay decals into 1 mesh; switched to transparent after merging.
  const decalMat = new THREE.MeshStandardMaterial({
    map: decalAtlas.texture,
    color: decalAtlas.texture ? 0xffffff : 0x888888,
    roughness: 0.7,
    depthWrite: false,
    opacity: decalAtlas.texture ? 1 : 0,
  });

  const taskScreens = [];
  const screenRects = new Map();
  function allocScreenRect(idx) {
    const key = idx % SCREEN_SPECS.length;
    if (!screenRects.has(key)) {
      const spec = SCREEN_SPECS[key];
      const accentHex = spec.accent || "#e6e9ee";
      screenRects.set(
        key,
        screenAtlas.alloc(512, 288, (g, ox, oy, w, h) => drawTelemetryScreenOnCtx(g, ox, oy, w, h, spec, accentHex))
      );
    }
    return screenRects.get(key);
  }

  /** Wall-mounted monitor, tilted down a little. ry turns the screen's +Z normal to face the room. */
  function wallScreen(parent, idx, x, yc, z, ry, w = 2.0, accent = "#f472b6", ledMat = M.ledPink) {
    const spec = SCREEN_SPECS[idx % SCREEN_SPECS.length];
    const h = (w * 9) / 16;
    const grp = new THREE.Group();
    grp.position.set(x, yc, z);
    grp.rotation.order = "YXZ";
    grp.rotation.y = ry;
    grp.rotation.x = 0.1;
    mesh(grp, boxGeo(w + 0.14, h + 0.14, 0.08), M.titaniumDark, 0, 0, 0);
    // Wall bracket sits strictly behind the chassis (-0.14..-0.04) with no penetration.
    mesh(grp, boxGeo(0.34, 0.34, 0.1), M.titanium, 0, 0, -0.09);
    const scrGeo = remapPlaneUV(new THREE.PlaneGeometry(w, h), allocScreenRect(idx));
    const scr = new THREE.Mesh(scrGeo, screenMat);
    scr.position.z = 0.043;
    grp.add(scr);
    mesh(grp, boxGeo(w * 0.6, 0.025, 0.02), ledMat, 0, -h / 2 - 0.085, 0.04);
    parent.add(grp);

    // Unmerged mouse-pick proxy matching the front face of the wall monitor
    const hitWrap = new THREE.Group();
    hitWrap.position.set(x, yc, z);
    hitWrap.rotation.order = "YXZ";
    hitWrap.rotation.y = ry;
    hitWrap.rotation.x = 0.1;
    const hitPlane = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.14, h + 0.14), hitMat);
    hitPlane.position.z = 0.05;
    hitPlane.userData.screenTarget = {
      kind: spec.interactive ? "taskScreen" : "wallScreen",
      spec,
      localX: x,
      localY: yc,
      localZ: z,
    };
    taskScreens.push({ localX: x, localY: yc, localZ: z, ry, spec });
    hitWrap.add(hitPlane);
    interactiveGroup.add(hitWrap);

    return grp;
  }

  const signRects = new Map();
  function allocSignRect(lines, wTex, hTex) {
    const key = `${Array.isArray(lines) ? lines.join("|") : lines}|${wTex}x${hTex}`;
    if (!signRects.has(key)) {
      signRects.set(
        key,
        signAtlas.alloc(wTex, hTex, (g, ox, oy, pw, ph) => drawSignOnCtx(g, ox, oy, pw, ph, lines, "#e6e9ee"))
      );
    }
    return signRects.get(key);
  }

  function signPlane(parent, lines, accent, x, yc, z, ry, w, h, { doubleSide = false } = {}) {
    const hTex = Math.max(80, Math.round((400 * h) / w));
    const rect = allocSignRect(lines, 400, hTex);
    if (doubleSide) {
      const grp = new THREE.Group();
      grp.position.set(x, yc, z);
      grp.rotation.y = ry;
      mesh(grp, boxGeo(w + 0.04, h + 0.04, 0.016), M.titaniumDark, 0, 0, 0);
      const frontGeo = remapPlaneUV(new THREE.PlaneGeometry(w, h), rect);
      const front = new THREE.Mesh(frontGeo, signMat);
      front.position.z = 0.01;
      grp.add(front);
      const backGeo = remapPlaneUV(new THREE.PlaneGeometry(w, h), rect);
      const back = new THREE.Mesh(backGeo, signMat);
      back.position.z = -0.01;
      back.rotation.y = Math.PI;
      grp.add(back);
      parent.add(grp);
      return grp;
    }
    const geo = remapPlaneUV(new THREE.PlaneGeometry(w, h), rect);
    const m = new THREE.Mesh(geo, signMat);
    m.position.set(x, yc, z);
    m.rotation.y = ry;
    parent.add(m);
    return m;
  }

  // ---------- walls with real openings ----------
  /**
   * A straight wall. axis "x": runs along X at z = at; axis "z": runs along Z at x = at.
   * openings: { c, w, y0?, y1, kind: "door" | "window" | "porthole", noFrame? } along the wall.
   * Sides are ±1 along the wall normal (+z for axis "x", +x for axis "z").
   */
  function wall(parent, o) {
    const {
      axis,
      at,
      from,
      to,
      y0,
      y1,
      t = T,
      mat = M.hull,
      openings = [],
      ribSides = [],
      ribEvery = 2.4,
      ledSides = [],
      ledMat = null,
      ledY = y1 - 0.45,
      ledRange = [from, to],
      kickSides = [],
      kickRange = [from, to],
      frameGlow = null,
    } = o;
    const ops = openings
      .map((p) => ({ ...p, a0: p.c - p.w / 2, a1: p.c + p.w / 2, b0: p.y0 ?? y0, b1: p.y1 }))
      .sort((p, q) => p.a0 - q.a0);

    const place = (a0, a1, b0, b1, m, { collide = false, walk = true, thick = t, off = 0 } = {}) => {
      if (a1 - a0 < 1e-3 || b1 - b0 < 1e-3) return null;
      const c = (a0 + a1) / 2;
      const len = a1 - a0;
      if (axis === "x") return bx(parent, c, b0, at + off, len, b1 - b0, thick, m, { collide, walk });
      return bx(parent, at + off, b0, c, thick, b1 - b0, len, m, { collide, walk });
    };
    const P = (a, off, y) => (axis === "x" ? [a, y, at + off] : [at + off, y, a]);

    let cur = from;
    for (const p of ops) {
      place(cur, p.a0, y0, y1, mat, { collide: true });
      place(p.a0, p.a1, p.b1, y1, mat, { collide: true, walk: false });
      if (p.b0 > y0 + 0.01) place(p.a0, p.a1, y0, p.b0, mat, { collide: true, walk: p.kind !== "door" });
      cur = p.a1;

      if (p.kind === "porthole") {
        const size = p.w;
        const r = size * 0.4;
        const yc = (p.b0 + p.b1) / 2;
        const [x, , z] = P((p.a0 + p.a1) / 2, 0, 0);
        const ry = axis === "x" ? 0 : Math.PI / 2;
        mesh(parent, portholeBezelGeo(size, r, t + 0.08), M.titanium, x, yc, z, 0, ry, 0);
        const glass = new THREE.CylinderGeometry(r - 0.005, r - 0.005, 0.03, 28);
        if (axis === "x") glass.rotateX(Math.PI / 2);
        else glass.rotateZ(Math.PI / 2);
        mesh(parent, glass, M.glass, x, yc, z);
        for (const s of [-1, 1]) {
          const [rx2, , rz2] = P((p.a0 + p.a1) / 2, s * (t / 2 + 0.055), 0);
          mesh(parent, new THREE.TorusGeometry(r + 0.02, 0.04, 8, 28), M.steel, rx2, yc, rz2, 0, ry, 0);
        }
        collider(...camBox(axis, at, p.a0, p.a1, t), p.b0, p.b1, { walk: false });
        continue;
      }

      if (p.noFrame) {
        if (p.kind === "window") {
          place(p.a0, p.a1, p.b0, p.b1, M.glass, { thick: 0.03 });
          collider(...camBox(axis, at, p.a0, p.a1, t), p.b0, p.b1, { walk: false });
        }
        continue;
      }

      // Proud surface architrave trims on both wall faces (avoids burying solid frames inside concrete)
      const fw = p.kind === "door" ? 0.14 : 0.08;
      const trimT = 0.06;
      for (const s of [-1, 1]) {
        const off = s * (t / 2 + trimT / 2);
        place(p.a0 - fw, p.a0, p.b0, p.b1, M.titanium, { thick: trimT, off });
        place(p.a1, p.a1 + fw, p.b0, p.b1, M.titanium, { thick: trimT, off });
        place(p.a0 - fw, p.a1 + fw, p.b1, p.b1 + fw, M.titanium, { thick: trimT, off });
        if (p.kind === "window") place(p.a0 - fw, p.a1 + fw, p.b0 - fw, p.b0, M.titanium, { thick: trimT, off });
      }
      if (p.kind === "window") {
        // Split mullions and glass panes cleanly so mullions never slice through glass
        const n = Math.max(0, Math.round((p.a1 - p.a0) / 2) - 1);
        let gx = p.a0;
        for (let k = 1; k <= n; k++) {
          const a = p.a0 + ((p.a1 - p.a0) * k) / (n + 1);
          place(gx, a - 0.04, p.b0, p.b1, M.glass, { thick: 0.03 });
          place(a - 0.04, a + 0.04, p.b0, p.b1, M.titanium, { thick: 0.12 });
          gx = a + 0.04;
        }
        place(gx, p.a1, p.b0, p.b1, M.glass, { thick: 0.03 });
        collider(...camBox(axis, at, p.a0, p.a1, t), p.b0, p.b1, { walk: false });
      }
      if (frameGlow) {
        for (const s of [-1, 1]) {
          place(p.a0, p.a1, p.b1 + fw + 0.02, p.b1 + fw + 0.07, frameGlow, { thick: 0.04, off: s * (t / 2 + 0.02) });
        }
      }
    }
    place(cur, to, y0, y1, mat, { collide: true });

    const inOpening = (a, pad, onlyBelow = null) =>
      ops.some((p) => a > p.a0 - pad && a < p.a1 + pad && (onlyBelow == null || p.b1 > onlyBelow));

    // structural ribs (avoid kick plates and LED strip elevation if on the same wall face)
    const ribsOnSide = new Map();
    for (const s of ribSides) {
      const xs = [];
      const ry0 = kickSides.includes(s) ? y0 + 0.22 : y0;
      const splitAtLed = Boolean(ledMat && ledSides.includes(s));
      for (let a = from + 0.6; a < to - 0.4; a += ribEvery) {
        if (inOpening(a, 0.3)) continue;
        xs.push(a);
        if (splitAtLed && ledY > ry0 && ledY + 0.06 < y1) {
          place(a - 0.09, a + 0.09, ry0, ledY, M.titanium, { thick: 0.1, off: s * (t / 2 + 0.05) });
          place(a - 0.09, a + 0.09, ledY + 0.06, y1, M.titanium, { thick: 0.1, off: s * (t / 2 + 0.05) });
        } else {
          place(a - 0.09, a + 0.09, ry0, y1, M.titanium, { thick: 0.1, off: s * (t / 2 + 0.05) });
        }
      }
      ribsOnSide.set(s, xs);
    }
    // kick plates (skip door openings and stay within kickRange)
    const [kf0, kf1] = kickRange;
    for (const s of kickSides) {
      let k0 = kf0;
      for (const p of ops.filter((q) => q.kind === "door")) {
        const end = Math.min(kf1, p.a0 - 0.14);
        if (end > k0) place(k0, end, y0, y0 + 0.22, M.steel, { thick: 0.04, off: s * (t / 2 + 0.02) });
        k0 = Math.max(kf0, p.a1 + 0.14);
      }
      if (kf1 > k0) place(k0, kf1, y0, y0 + 0.22, M.steel, { thick: 0.04, off: s * (t / 2 + 0.02) });
    }
    // LED accent strip (broken where openings or ribs on the same face cross it)
    if (ledMat) {
      const [lf0, lf1] = ledRange;
      for (const s of ledSides) {
        const cuts = [];
        for (const p of ops) {
          if (p.b1 > ledY - 0.15) cuts.push([p.a0 - 0.2, p.a1 + 0.2]);
        }
        for (const rx of ribsOnSide.get(s) || []) {
          cuts.push([rx - 0.09, rx + 0.09]);
        }
        cuts.sort((a, b) => a[0] - b[0]);
        let l0 = lf0;
        for (const [c0, c1] of cuts) {
          const end = Math.min(lf1, c0);
          if (end > l0 + 0.01) place(l0, end, ledY, ledY + 0.06, ledMat, { thick: 0.04, off: s * (t / 2 + 0.02) });
          l0 = Math.max(l0, Math.max(lf0, c1));
        }
        if (lf1 > l0 + 0.01) place(l0, lf1, ledY, ledY + 0.06, ledMat, { thick: 0.04, off: s * (t / 2 + 0.02) });
      }
    }
  }

  function camBox(axis, at, a0, a1, t) {
    return axis === "x" ? [a0, a1, at - t / 2, at + t / 2] : [at - t / 2, at + t / 2, a0, a1];
  }

  function floorSlab(parent, r, mat) {
    bx(parent, (r.minX + r.maxX) / 2, DECK - 0.06, (r.minZ + r.maxZ) / 2, r.maxX - r.minX, 0.06, r.maxZ - r.minZ, mat);
  }

  // ---------- corridor shell (angled bulkheads + ribbed arches) ----------
  const CH_LOW = HUB_TOP - 0.87; // clears door/window frameGlow tops (3.73)
  const CH_HIGH = HUB_TOP - 0.08;
  const CH_RUN = 0.88;
  const CH_W = Math.hypot(CH_RUN, CH_HIGH - CH_LOW);
  const CH_ANG = Math.atan2(CH_HIGH - CH_LOW, CH_RUN);
  const CH_MID = (CH_LOW + CH_HIGH) / 2;

  function chamfer(parent, axis, face, sd, from, to, ledMat, { ledBreaks = [] } = {}) {
    const L = to - from;
    const mid = (from + to) / 2;
    const offFace = 0.46;
    if (axis === "x") {
      mesh(parent, boxGeo(L, 0.05, CH_W, 4), M.hullInterior, mid, CH_MID, face + sd * offFace, sd > 0 ? -CH_ANG : CH_ANG, 0, 0);
    } else {
      mesh(parent, boxGeo(CH_W, 0.05, L, 4), M.hullInterior, face + sd * offFace, CH_MID, mid, 0, 0, sd > 0 ? CH_ANG : -CH_ANG);
    }
    // Draw LED strips between optional break intervals so chamfer LEDs never intersect door headers
    const breaks = [...ledBreaks].sort((a, b) => a[0] - b[0]);
    let cur = from;
    const addLed = (s0, s1) => {
      if (s1 - s0 < 0.02) return;
      const m = (s0 + s1) / 2;
      if (axis === "x") bx(parent, m, CH_LOW - 0.04, face + sd * 0.05, s1 - s0, 0.04, 0.04, ledMat);
      else bx(parent, face + sd * 0.05, CH_LOW - 0.04, m, 0.04, 0.04, s1 - s0, ledMat);
    };
    for (const [b0, b1] of breaks) {
      addLed(cur, Math.min(to, b0));
      cur = Math.max(cur, b1);
    }
    addLed(cur, to);
  }

  function arch(parent, axis, p, faceA, faceB, pilasterA = true, pilasterB = true, { braceA = true, braceB = true } = {}) {
    const span = faceB - faceA - 1.88;
    const mid = (faceA + faceB) / 2;
    const braceW = CH_W - 0.08;
    const ribShiftH = 0.52;
    const ribShiftY = CH_MID - 0.095;
    if (axis === "x") {
      bx(parent, p, HUB_TOP - 0.2, mid, 0.25, 0.14, span, M.titanium);
      if (braceA) mesh(parent, boxGeo(0.25, 0.09, braceW), M.titanium, p, ribShiftY, faceA + ribShiftH, -CH_ANG, 0, 0);
      if (braceB) mesh(parent, boxGeo(0.25, 0.09, braceW), M.titanium, p, ribShiftY, faceB - ribShiftH, CH_ANG, 0, 0);
      if (pilasterA) bx(parent, p, DECK + 0.44, faceA + 0.06, 0.25, CH_LOW - 0.04 - (DECK + 0.44), 0.12, M.titanium);
      if (pilasterB) bx(parent, p, DECK + 0.44, faceB - 0.06, 0.25, CH_LOW - 0.04 - (DECK + 0.44), 0.12, M.titanium);
    } else {
      bx(parent, mid, HUB_TOP - 0.2, p, span, 0.14, 0.25, M.titanium);
      if (braceA) mesh(parent, boxGeo(braceW, 0.09, 0.25), M.titanium, faceA + ribShiftH, ribShiftY, p, 0, 0, CH_ANG);
      if (braceB) mesh(parent, boxGeo(braceW, 0.09, 0.25), M.titanium, faceB - ribShiftH, ribShiftY, p, 0, 0, -CH_ANG);
      if (pilasterA) bx(parent, faceA + 0.06, DECK + 0.44, p, 0.12, CH_LOW - 0.04 - (DECK + 0.44), 0.25, M.titanium);
      if (pilasterB) bx(parent, faceB - 0.06, DECK + 0.44, p, 0.12, CH_LOW - 0.04 - (DECK + 0.44), 0.25, M.titanium);
    }
  }

  // ---------- zone groups ----------
  const zone = {};
  for (const z of HABITAT_ZONES) {
    const g = new THREE.Group();
    g.name = z.id;
    const s = new THREE.Group();
    s.name = `${z.id}-static`;
    g.add(s);
    group.add(g);
    zone[z.id] = { g, s };
  }
  const shell = new THREE.Group();
  shell.name = "stationShell";
  group.add(shell);

  buildShell(shell);
  buildPink(zone.pinkCorridor);
  buildYellow(zone.yellowCafeteria);
  buildPurple(zone.purpleDormitory);
  buildGreen(zone.greenGarage);
  buildRed(zone.redAirlock);

  signAtlas.finalize();
  screenAtlas.finalize();
  decalAtlas.finalize();

  // Bake static parts: one draw call per material per zone instead of thousands.
  for (const g of [shell, ...Object.values(zone).map((z) => z.s)]) mergeStaticMeshes(THREE, g);
  // Closed-roof interior wings do not receive direct sun; skip casting sun shadows from enclosed rooms.
  for (const zId of ["pinkCorridor", "yellowCafeteria", "purpleDormitory", "redAirlock"]) {
    zone[zId]?.s?.traverse((o) => {
      if (o.isMesh) o.castShadow = false;
    });
  }
  M.glass.transparent = true;
  M.glass.needsUpdate = true;
  decalMat.transparent = true;
  decalMat.needsUpdate = true;
  group.traverse((o) => {
    if (
      o.isMesh &&
      (o.material === M.glass || o.material === decalMat || o.material === signMat || o.material === screenMat)
    ) {
      o.castShadow = false;
    }
  });

  // =============================================================================================
  // Shell: foundation plinth, levelling jacks, roofs with LED fascia, roof equipment, apron
  // =============================================================================================
  function buildShell(S) {
    const plinths = [
      { minX: -18.18, maxX: 18.18, minZ: -9.18, maxZ: 22.5 },
      { minX: 18.18, maxX: 32.18, minZ: 3.82, maxZ: 10.18 },
      { minX: -16.18, maxX: 5.18, minZ: -28.18, maxZ: -9.18 },
    ];
    const canPlaceJack = (x, z) => {
      for (const q of plinths) {
        if (x > q.minX - 0.31 && x < q.maxX + 0.31 && z > q.minZ - 0.31 && z < q.maxZ + 0.31) return false;
      }
      if (z > 21.8 && BAY_X.some((c) => Math.abs(x - c) <= RAMP_HALF_W + 0.45)) return false;
      if (x > 31.5 && z >= AIRLOCK_RAMP.z0 - 0.45 && z <= AIRLOCK_RAMP.z1 + 0.45) return false;
      return true;
    };
    const jack = (x, z) => {
      if (!canPlaceJack(x, z)) return;
      cyl(S, 0.3, 0.06, M.titanium, x, 0.03, z, { seg: 14 });
      cyl(S, 0.1, 0.32, M.steel, x, 0.22, z, { seg: 12 });
      cyl(S, 0.16, 0.06, M.titanium, x, 0.41, z, { seg: 12 });
    };
    for (const p of plinths) {
      bx(S, (p.minX + p.maxX) / 2, -0.4, (p.minZ + p.maxZ) / 2, p.maxX - p.minX, DECK - 0.06 + 0.4, p.maxZ - p.minZ, M.titaniumDark);
      for (let x = p.minX + 1.2; x < p.maxX - 0.5; x += 4) {
        jack(x, p.minZ - 0.34);
        jack(x, p.maxZ + 0.34);
      }
      for (let z = p.minZ + 1.2; z < p.maxZ - 0.5; z += 4) {
        jack(p.minX - 0.34, z);
        jack(p.maxX + 0.34, z);
      }
    }

    // roofs: disjoint slabs + non-overlapping titanium fascia + outer LED bands on exterior edges
    const o = T / 2 + 0.22; // 0.40 m standard exterior overhang
    const buildRoof = (slabs, yTop, led, edges) => {
      for (const s of slabs) {
        bx(S, (s.minX + s.maxX) / 2, yTop, (s.minZ + s.maxZ) / 2, s.maxX - s.minX, 0.32, s.maxZ - s.minZ, M.hull);
        collider(s.minX, s.maxX, s.minZ, s.maxZ, yTop - 0.05, yTop + 0.32, { walk: false });
      }
      for (const e of edges) {
        const L = e.to - e.from;
        const m = (e.from + e.to) / 2;
        if (e.side === "n" || e.side === "s") {
          const dir = e.side === "n" ? -1 : 1;
          const z = e.line + dir * 0.04;
          bx(S, m, yTop - 0.05, z, L, 0.42, 0.08, M.titanium);
          bx(S, m, yTop - 0.22, e.line + dir * 0.105, L, 0.06, 0.05, led);
        } else {
          const dir = e.side === "w" ? -1 : 1;
          const x = e.line + dir * 0.04;
          bx(S, x, yTop - 0.05, m, 0.08, 0.42, L, M.titanium);
          bx(S, e.line + dir * 0.105, yTop - 0.22, m, 0.05, 0.06, L, led);
        }
      }
    };
    // Hub roof stops flush at Purple (z = -8.82), Garage (z = 9.82), and Red (x = 18.18) while keeping exterior overhangs.
    buildRoof(
      [
        { minX: -18 - o, maxX: 18 + T / 2, minZ: -9 + T / 2, maxZ: 10 - T / 2 },
        { minX: -18 - o, maxX: -16 - T / 2, minZ: -9 - o, maxZ: -9 + T / 2 },
        { minX: 5 + T / 2, maxX: 18 + o, minZ: -9 - o, maxZ: -9 + T / 2 },
        { minX: 18 + T / 2, maxX: 18 + o, minZ: -9 + T / 2, maxZ: 4 - o - 0.08 },
      ],
      HUB_TOP,
      M.ledPink,
      [
        { side: "w", line: -18 - o, from: -9 - o, to: 10 - T / 2 },
        { side: "n", line: -9 - o, from: -18 - o, to: -16 - T / 2 },
        { side: "n", line: -9 - o, from: 5 + T / 2, to: 18 + o },
        { side: "e", line: 18 + o, from: -9 - o, to: 4 - o - 0.08 },
      ]
    );
    buildRoof(
      [{ minX: 18 + T / 2, maxX: 32 + o, minZ: 4 - o, maxZ: 10 + T / 2 }],
      HUB_TOP,
      M.ledRed,
      [
        { side: "n", line: 4 - o, from: 18 + T / 2, to: 32 + o },
        { side: "s", line: 10 + T / 2, from: 18 + T / 2, to: 32 + o },
        { side: "e", line: 32 + o, from: 4 - o, to: 10 + T / 2 },
      ]
    );
    buildRoof(
      [{ minX: -18 - o, maxX: 18 + o, minZ: 10 - T / 2, maxZ: 22.3 + o }],
      GARAGE_TOP,
      M.ledGreen,
      [
        { side: "s", line: 22.3 + o, from: -18 - o, to: 18 + o },
        { side: "w", line: -18 - o, from: 10 - T / 2, to: 22.3 + o },
        { side: "e", line: 18 + o, from: 10 - T / 2, to: 22.3 + o },
      ]
    );
    buildRoof(
      [{ minX: -16 - o, maxX: 5 + o, minZ: -28 - o, maxZ: -9 + T / 2 }],
      DORM_TOP,
      M.ledPurple,
      [
        { side: "n", line: -28 - o, from: -16 - o, to: 5 + o },
        { side: "s", line: -9 + T / 2, from: -16 - o, to: 5 + o },
        { side: "w", line: -16 - o, from: -28 - o, to: -9 + T / 2 },
        { side: "e", line: 5 + o, from: -28 - o, to: -9 + T / 2 },
      ]
    );

    // dormitory roof: tilted solar array, comms dish, antenna mast (with rx = +0.3, -Z edge is high, +Z edge is low)
    for (const [x, z] of [
      [-8.5, -14],
      [-3, -14],
      [-8.5, -19],
      [-3, -19],
    ]) {
      const yb = DORM_TOP + 0.32;
      cyl(S, 0.05, 0.78, M.steel, x - 1.8, yb + 0.39, z - 0.6);
      cyl(S, 0.05, 0.78, M.steel, x + 1.8, yb + 0.39, z - 0.6);
      cyl(S, 0.05, 0.42, M.steel, x - 1.8, yb + 0.21, z + 0.6);
      cyl(S, 0.05, 0.42, M.steel, x + 1.8, yb + 0.21, z + 0.6);
      mesh(S, boxGeo(4.3, 0.04, 2.1), M.titanium, x, yb + 0.62, z, 0.3, 0, 0);
      mesh(S, boxGeo(4.2, 0.06, 2.0, 1), M.solar, x, yb + 0.675, z, 0.3, 0, 0);
    }
    {
      const yb = DORM_TOP + 0.32;
      cyl(S, 0.14, 1.6, M.titanium, -12, yb + 0.8, -23.5);
      const dishPts = [];
      for (let i = 0; i <= 12; i++) {
        const r = (1.25 * i) / 12;
        dishPts.push(new THREE.Vector2(r, 0.3 * (r / 1.25) ** 2));
      }
      const dish = new THREE.LatheGeometry(dishPts, 32);
      mesh(S, dish, M.whiteGloss, -12, yb + 1.7, -23.5, -0.75, 0.6, 0);
      const feed = new THREE.Group();
      feed.position.set(-12, yb + 1.7, -23.5);
      feed.rotation.set(-0.75, 0.6, 0);
      S.add(feed);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        const strut = new THREE.CylinderGeometry(0.02, 0.02, 1.0, 6);
        strut.translate(0, 0.5, 0);
        const m = mesh(feed, strut, M.steel, Math.cos(a) * 1.1, 0.25, Math.sin(a) * 1.1);
        m.rotation.z = Math.cos(a) * 0.85;
        m.rotation.x = -Math.sin(a) * 0.85;
      }
      cyl(feed, 0.09, 0.25, M.titaniumDark, 0, 0.95, 0);
      // antenna mast with a beacon (beacon material pulses in update())
      cyl(S, 0.06, 4.2, M.steel, 2.5, yb + 2.1, -25.5, { seg: 8 });
      for (const sx of [-1, 1]) cyl(S, 0.03, 0.54, M.steel, 2.5 + sx * 0.33, yb + 3.2, -25.5, { axis: "x", seg: 6 });
      cyl(S, 0.09, 0.16, M.beacon, 2.5, yb + 4.28, -25.5);
    }
    // garage roof: radiator fins and HVAC (2.0 m fin length keeps 0.50 m clear spacing between fins)
    for (const z of [13.5, 16, 18.5]) {
      for (const x of [-12, 12]) {
        bx(S, x, GARAGE_TOP + 0.32, z, 0.5, 0.12, 2.0, M.titanium);
        bx(S, x, GARAGE_TOP + 0.44, z, 0.08, 1.38, 2.0, M.whiteGloss);
      }
    }
    for (const x of [-3, 3]) {
      bx(S, x, GARAGE_TOP + 0.32, 16, 2.2, 1.0, 2.2, M.hull);
      cyl(S, 0.75, 0.06, M.titaniumDark, x, GARAGE_TOP + 1.35, 16, { seg: 24 });
      cyl(S, 0.12, 0.08, M.steel, x, GARAGE_TOP + 1.42, 16);
    }
    // hub roof: HVAC units and vent stacks
    for (const [x, z] of [
      [-6, -3],
      [8, -3],
      [8, 6.5],
    ]) {
      bx(S, x, HUB_TOP + 0.32, z, 2.4, 0.9, 1.6, M.hull);
      bx(S, x, HUB_TOP + 1.22, z, 2.5, 0.06, 1.7, M.titanium);
      cyl(S, 0.5, 0.05, M.titaniumDark, x - 0.55, HUB_TOP + 1.305, z, { seg: 20 });
      cyl(S, 0.5, 0.05, M.titaniumDark, x + 0.55, HUB_TOP + 1.305, z, { seg: 20 });
    }
    for (const [x, z] of [
      [-14, 1],
      [-1, 2],
      [14, -6],
    ]) {
      cyl(S, 0.18, 1.4, M.steel, x, HUB_TOP + 1.02, z);
      cyl(S, 0.26, 0.12, M.titanium, x, HUB_TOP + 1.78, z);
    }
  }

  // =============================================================================================
  // PINK — L-shaped corridor & telemetry hub
  // =============================================================================================
  function buildPink({ g, s: S }) {
    floorSlab(S, RECTS.pinkL, M.grate);
    floorSlab(S, RECTS.pinkB, M.grate);
    // Break floor LED around the hologram plinth (x = -15, r = 0.78) so strips never clip the base.
    bx(S, -16.55, DECK, 7, 1.5, 0.012, 0.09, M.ledPink);
    bx(S, 1.55, DECK, 7, 31.5, 0.012, 0.09, M.ledPink);
    bx(S, -16.6, DECK, -2.5, 0.09, 0.012, 12.2, M.ledPink);

    // west exterior wall (corridor stretch) with portholes — butts cleanly before north cap (-9.18) and garage wall (9.82)
    wall(S, {
      axis: "z",
      at: -18,
      from: -9.18,
      to: 9.82,
      y0: DECK,
      y1: HUB_TOP,
      openings: [-6, 0, 6].map((c) => ({ c, w: 1.0, y0: DECK + 1.3, y1: DECK + 2.3, kind: "porthole" })),
      ribSides: [-1],
      kickSides: [1],
      kickRange: [-8.82, 9.82],
    });
    // short north cap west of the dormitory (between west wall x=-17.82 and dorm wall x=-16.18)
    wall(S, { axis: "x", at: -9, from: -17.82, to: -16.18, y0: DECK, y1: HUB_TOP, ribSides: [-1] });
    // corridor <-> garage wall (full garage height) with two crew doors and an observation window
    wall(S, {
      axis: "x",
      at: 10,
      from: -18.18,
      to: 18.18,
      y0: DECK,
      y1: GARAGE_TOP,
      openings: [
        { c: -10.8, w: 2.0, y1: DECK + 3.0, kind: "door" },
        { c: 10.8, w: 2.0, y1: DECK + 3.0, kind: "door" },
        { c: 0, w: 10, y0: DECK + 1.1, y1: DECK + 3.1, kind: "window" },
      ],
      ribSides: [1],
      ribEvery: 3.0,
      kickSides: [-1, 1],
      kickRange: [-17.82, 17.82],
      ledSides: [1],
      ledMat: M.ledGreen,
      ledY: DECK + 4.3,
      ledRange: [-17.82, 17.82],
      frameGlow: M.ledGreen,
    });

    // angled bulkheads, ribbed ceiling arches, recessed LED (trim corners & break LEDs at arch ribs)
    const zLegArches = [-7.5, -4.5, -1.5, 1.5];
    const xMainArches = [];
    for (let x = -13.5; x <= 16.6; x += 3) xMainArches.push(x);
    const zArchBreaks = zLegArches.map((z) => [z - 0.14, z + 0.14]);
    chamfer(S, "z", -17.82, 1, -8.8, 9.1, M.ledPink, zArchBreaks);
    chamfer(S, "z", -12.18, -1, -8.56, 3.55, M.ledPink, zArchBreaks);
    chamfer(
      S,
      "x",
      4.18,
      1,
      -11.5,
      17.82,
      M.ledPink,
      xMainArches.filter((x) => x > -11.5).map((x) => [x - 0.14, x + 0.14])
    );
    chamfer(
      S,
      "x",
      9.82,
      -1,
      -17.12,
      17.82,
      M.ledPink,
      xMainArches.map((x) => [x - 0.14, x + 0.14])
    );
    // Ceiling soffit strips sit cleanly above arch crown beams (arch crown top is HUB_TOP - 0.06)
    bx(S, -15, HUB_TOP - 0.055, -2.4, 0.4, 0.04, 12.4, M.coolPanel);
    bx(S, 0, HUB_TOP - 0.055, 7, 34.2, 0.04, 0.4, M.coolPanel);
    for (const z of zLegArches) arch(S, "z", z, -17.82, -12.18, true, !(z > -4.2 && z < -0.8));
    for (const x of xMainArches) {
      const nearYellowDoor = x > 0.7 && x < 5.3;
      const nearYellowWin = x > -10.3 && x < -3.7;
      const nearGarageDoor = Math.abs(Math.abs(x) - 10.8) < 1.3;
      const nearObsWin = Math.abs(x) < 5.3;
      arch(S, "x", x, 4.18, 9.82, !(nearYellowDoor || nearYellowWin) && x > -12, !(nearGarageDoor || nearObsWin));
    }

    dormRamp(S, DORM_DOORS[0].x);

    // floor conduits with brackets (cleared inside the ±0.04 wall kick plates)
    for (const [a0, a1] of [[-8.6, 9.6]]) {
      for (const dx of [0.18, 0.3]) cyl(S, 0.045, a1 - a0, M.steel, -17.82 + dx, DECK + 0.32, (a0 + a1) / 2, { axis: "z", seg: 10 });
      for (let z = a0 + 0.5; z < a1; z += 1.6) bx(S, -17.61, DECK, z, 0.28, 0.32, 0.06, M.titanium);
    }
    for (const [a0, a1] of [
      [-11.6, 0.6],
      [5.4, 17.6],
    ]) {
      for (const dz of [0.18, 0.3]) cyl(S, 0.045, a1 - a0, M.steel, (a0 + a1) / 2, DECK + 0.32, 4.18 + dz, { axis: "x", seg: 10 });
      for (let x = a0 + 0.5; x < a1; x += 1.6) bx(S, x, DECK, 4.39, 0.06, 0.32, 0.28, M.titanium);
    }

    // telemetry wall screens (angled, cleared of pilasters and window/door frames)
    const ys = DECK + 2.05;
    // north wall (to the cafeteria), between the arches — central screen upgraded to interactive Tasks terminal
    wallScreen(S, 8, -2.75, ys, 4.33, 0, 1.95, "#22d3ee", M.statusCyan);
    signPlane(S, ["EVA TASKS · GÖREVLER", "[E] ROVER & ROTA SEÇ"], "#22d3ee", -2.75, ys + 0.88, 4.34, 0, 1.9, 0.36);
    wallScreen(S, 1, 9.0, ys, 4.33, 0);
    wallScreen(S, 3, 12.0, ys, 4.33, 0);
    wallScreen(S, 7, 15.0, ys, 4.33, 0);
    // south wall (to the garage) — west junction screen upgraded to interactive Tasks terminal
    wallScreen(S, 8, -15.0, ys, 9.67, Math.PI, 1.95, "#22d3ee", M.statusCyan);
    signPlane(S, ["EVA TASKS · GÖREVLER", "[E] ROVER & ROTA SEÇ"], "#22d3ee", -15.0, ys + 0.88, 9.65, Math.PI, 1.9, 0.36);
    wallScreen(S, 5, -6.1, ys, 9.67, Math.PI, 1.55);
    wallScreen(S, 6, 6.1, ys, 9.67, Math.PI, 1.55);
    wallScreen(S, 4, 15.0, ys, 9.67, Math.PI);
    // left leg of the L
    wallScreen(S, 3, -17.67, ys, -3.0, Math.PI / 2);
    wallScreen(S, 0, -17.67, ys, 3.0, Math.PI / 2);
    wallScreen(S, 2, -12.33, ys, -6.0, -Math.PI / 2);
    wallScreen(S, 1, -12.33, ys, 2.85, -Math.PI / 2, 1.7);

    // hanging direction signs — rods connect cleanly from sign top (DECK+3.56) up to roof soffit (HUB_TOP)
    const hang = (lines, x, z, ry, w = 2.6) => {
      signPlane(S, lines, "#ec4899", x, DECK + 3.25, z, ry, w, 0.62, { doubleSide: true });
      cyl(S, 0.015, 0.62, M.steel, x - w * 0.4 * Math.cos(ry), DECK + 3.88, z + w * 0.4 * Math.sin(ry), { seg: 6 });
      cyl(S, 0.015, 0.62, M.steel, x + w * 0.4 * Math.cos(ry), DECK + 3.88, z - w * 0.4 * Math.sin(ry), { seg: 6 });
    };
    hang(["AIRLOCK →", "HAVA KİLİDİ"], 9.0, 7, Math.PI / 2);
    hang(["← DORM · CAFE", "YATAKHANE · KAFETERYA"], -3.0, 7, Math.PI / 2, 3.0);
    hang(["↑ DORMITORY", "3 KATLI KABİNLER"], -15, 0.0, 0);
    hang(["TRANSIT TERMINAL", "CLICK SITE SELECTOR"], TRANSIT_TERMINAL.x, TRANSIT_TERMINAL.z + 1.6, 0, 2.4);

    // holographic terrain table at the corridor junction
    {
      const x = TRANSIT_TERMINAL.x;
      const z = TRANSIT_TERMINAL.z;
      cyl(S, 0.78, 0.14, M.titaniumDark, x, DECK + 0.07, z, { seg: 32 });
      cyl(S, 0.42, 0.73, M.titanium, x, DECK + 0.505, z, { seg: 24, r2: 0.55 });
      cyl(S, 0.82, 0.09, M.whiteGloss, x, DECK + 0.915, z, { seg: 40 });
      cyl(S, 0.62, 0.02, M.statusCyan, x, DECK + 0.97, z, { seg: 40 });
      mesh(S, new THREE.TorusGeometry(0.85, 0.025, 8, 48), M.ledPink, x, DECK + 0.93, z, Math.PI / 2, 0, 0);
      collider(x - 0.88, x + 0.88, z - 0.88, z + 0.88, DECK, DECK + 1.0);
      holo = new THREE.Group();
      holo.position.set(x, DECK + 1.25, z);
      const terr = new THREE.PlaneGeometry(1.4, 1.4, 28, 28);
      terr.rotateX(-Math.PI / 2);
      const pos = terr.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i);
        const pz = pos.getZ(i);
        const h = 0.16 * Math.exp(-((px + 0.1) ** 2 + (pz - 0.05) ** 2) * 3.2) + 0.03 * Math.sin(px * 9) * Math.cos(pz * 7);
        pos.setY(i, h);
      }
      const terrMesh = new THREE.Mesh(terr, M.holo);
      holo.add(terrMesh);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.25, 32, 1, true), M.holoCone);
      cone.rotation.x = Math.PI;
      cone.position.y = -0.185;
      holo.add(cone);
      g.add(holo);

      const termHit = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 1.9, 12), hitMat);
      termHit.position.set(x, DECK + 0.95, z);
      termHit.userData.screenTarget = { kind: "terminal", localX: x, localY: DECK + 0.95, localZ: z };
      interactiveGroup.add(termHit);
    }

    pointLight(g, 0xffe6f2, 7, 18, 3, HUB_TOP - 0.6, 7);
    pointLight(g, 0xffe6f2, 6, 16, -15, HUB_TOP - 0.6, -2);
  }

  // =============================================================================================
  // YELLOW — cafeteria & mess hall
  // =============================================================================================
  function dormRamp(S, cx) {
    // Slope begins at z = -8.82 (south face of the -9 dividing wall) with a level deck inside the door jamb.
    const zTop = -8.82;
    const zBot = -9 + DORM_RAMP_LEN;
    const run = zBot - zTop;
    const Lr = Math.hypot(run, DORM_RISE);
    const ang = Math.atan2(DORM_RISE, run);
    const zc = (zTop + zBot) / 2;
    const yc = (DECK + DORM_FLOOR) / 2;
    bx(S, cx, DORM_FLOOR - 0.08, -9, 2.58, 0.08, T, M.diamond);
    mesh(S, boxGeo(2.6, 0.08, Lr, 0.8), M.diamond, cx, yc - 0.04, zc, ang, 0, 0);
    bx(S, cx, DECK, zBot - 0.12, 2.6, 0.012, 0.22, M.hazard);
    for (const sx of [-1, 1]) {
      const xEdge = cx + sx * 1.3;
      prism(S, [[zTop, DECK], [zTop, DORM_FLOOR], [zBot, DECK]], 0.06, M.titanium, "zy", sx > 0 ? xEdge : xEdge - 0.06);
      // handrail posts end flush at rail underside (ySurf + 0.97)
      for (const t of [0.1, 0.5, 0.9]) {
        const z = zTop + t * run;
        const ySurf = DORM_FLOOR - t * DORM_RISE;
        cyl(S, 0.028, 0.97, M.steel, xEdge + sx * 0.06, ySurf + 0.485, z, { seg: 8 });
      }
      mesh(S, boxGeo(0.06, 0.06, Lr + 0.16), M.steel, xEdge + sx * 0.06, yc + 1.0, zc, ang, 0, 0);
      mesh(S, boxGeo(0.02, 0.024, Lr), M.ledYellow, xEdge + sx * 0.02, yc + 1.0, zc, ang, 0, 0);
      collider(xEdge + sx * 0.06 - 0.05, xEdge + sx * 0.06 + 0.05, zTop, zBot, DECK, DORM_FLOOR + 1.0);
    }
  }

  function buildYellow({ g, s: S }) {
    floorSlab(S, RECTS.yellow, M.composite);
    // south wall to the corridor: main door + glass partition (butt-jointed at -11.82..18.18)
    wall(S, {
      axis: "x",
      at: 4,
      from: -11.82,
      to: 18.18,
      y0: DECK,
      y1: HUB_TOP,
      mat: M.hullInterior,
      openings: [
        { c: 3, w: 4, y1: DECK + 3.0, kind: "door" },
        { c: -7, w: 6, y0: DECK + 1.0, y1: DECK + 3.0, kind: "window" },
      ],
      kickSides: [-1, 1],
      kickRange: [-11.82, 17.82],
      ledSides: [-1],
      ledMat: M.ledYellow,
      ledY: HUB_TOP - 0.26,
      ledRange: [-11.82, 17.82],
      frameGlow: M.ledYellow,
    });
    // west wall to the corridor's left leg (owns L-corner at z=4, stops under dorm wall at -8.82)
    wall(S, {
      axis: "z",
      at: -12,
      from: -8.82,
      to: 4.18,
      y0: DECK,
      y1: HUB_TOP,
      mat: M.hullInterior,
      openings: [{ c: -2.5, w: 3, y1: DECK + 3.0, kind: "door" }],
      kickSides: [-1, 1],
      kickRange: [-8.82, 3.82],
      ledSides: [1],
      ledMat: M.ledYellow,
      ledY: HUB_TOP - 0.26,
      ledRange: [-8.82, 3.82],
      frameGlow: M.ledYellow,
    });
    // east exterior wall with portholes (between north cap -9 and south wall 4)
    wall(S, {
      axis: "z",
      at: 18,
      from: -8.82,
      to: 3.82,
      y0: DECK,
      y1: HUB_TOP,
      openings: [0.2, 2.5].map((c) => ({ c, w: 1.0, y0: DECK + 1.3, y1: DECK + 2.3, kind: "porthole" })),
      ribSides: [1],
      kickSides: [-1],
      kickRange: [-8.82, 3.82],
      ledSides: [-1],
      ledMat: M.ledYellow,
      ledY: HUB_TOP - 0.26,
      ledRange: [-8.82, 3.82],
    });
    // north exterior stretch behind the hydroponic wall
    wall(S, {
      axis: "x",
      at: -9,
      from: 5.18,
      to: 18.18,
      y0: DECK,
      y1: HUB_TOP,
      ribSides: [-1],
      ledSides: [1],
      ledMat: M.ledYellow,
      ledY: HUB_TOP - 0.26,
      ledRange: [5.18, 17.82],
    });

    // warm ceiling light panels (flush with ceiling slab and housing bottom)
    for (const x of [-6.5, 3, 12]) {
      for (const z of [-6.2, -1.4]) {
        bx(S, x, HUB_TOP - 0.06, z, 3.5, 0.06, 1.3, M.titanium);
        bx(S, x, HUB_TOP - 0.1, z, 3.2, 0.04, 1.05, M.warmPanel);
      }
    }

    dormRamp(S, 0);

    // dining tables (single stadium ExtrudeGeometry top on twin pedestals) with bolted swivel stools
    const pillShape = new THREE.Shape();
    pillShape.absarc(-0.85, 0, 0.55, Math.PI / 2, (3 * Math.PI) / 2, false);
    pillShape.absarc(0.85, 0, 0.55, -Math.PI / 2, Math.PI / 2, false);
    pillShape.closePath();
    const pillGeo = new THREE.ExtrudeGeometry(pillShape, { depth: 0.06, bevelEnabled: false, curveSegments: 20 });
    pillGeo.rotateX(-Math.PI / 2);

    for (const [tx, tz] of [
      [-8, -5.8],
      [-8, -0.8],
      [-3.4, -0.8],
      [5, -5.8],
      [11, -5.8],
      [6, -0.8],
    ]) {
      const yTop = DECK + 0.74;
      mesh(S, pillGeo, M.whiteGloss, tx, yTop, tz);
      bx(S, tx, yTop - 0.04, tz, 2.4, 0.04, 0.9, M.steel);
      for (const px of [-0.6, 0.6]) {
        cyl(S, 0.32, 0.04, M.titanium, tx + px, DECK + 0.02, tz, { seg: 20 });
        cyl(S, 0.07, 0.66, M.steel, tx + px, DECK + 0.37, tz, { seg: 12 });
      }
      for (const sz of [-0.95, 0.95]) {
        for (const sx of [-0.75, 0, 0.75]) {
          cyl(S, 0.2, 0.03, M.titanium, tx + sx, DECK + 0.015, tz + sz, { seg: 16 });
          cyl(S, 0.045, 0.4, M.steel, tx + sx, DECK + 0.23, tz + sz, { seg: 8 });
          cyl(S, 0.215, 0.02, M.steel, tx + sx, DECK + 0.44, tz + sz, { seg: 20 });
          cyl(S, 0.21, 0.08, M.seat, tx + sx, DECK + 0.49, tz + sz, { seg: 20 });
          collider(tx + sx - 0.22, tx + sx + 0.22, tz + sz - 0.22, tz + sz + 0.22, DECK, DECK + 0.54);
        }
      }
      collider(tx - 1.42, tx + 1.42, tz - 0.58, tz + 0.58, DECK, yTop + 0.06);
    }

    // food synthesis / coffee / water dispensers on the east wall (cleared of kick plate at x >= 17.78)
    const dispensers = [
      { z: -7.0, label: ["FOOD SYNTH", "YEMEK"] },
      { z: -4.8, label: ["COFFEE", "KAHVE"] },
      { z: -2.6, label: ["H2O", "SU"] },
    ];
    for (const d of dispensers) {
      const x = 17.38;
      bx(S, x, DECK, d.z, 0.76, 2.2, 1.3, M.whiteGloss);
      bx(S, x, DECK + 2.2, d.z, 0.8, 0.08, 1.34, M.titanium);
      bx(S, x - 0.395, DECK + 0.9, d.z, 0.03, 0.62, 0.84, M.titaniumDark);
      bx(S, x - 0.46, DECK + 0.88, d.z, 0.1, 0.04, 0.72, M.steel);
      cyl(S, 0.032, 0.12, M.steel, x - 0.445, DECK + 1.42, d.z, { seg: 10 });
      bx(S, x - 0.39, DECK + 0.2, d.z, 0.02, 0.5, 1.0, M.titaniumDark);
      for (const ez of [-0.61, 0.61]) bx(S, x - 0.395, DECK + 0.1, d.z + ez, 0.02, 2.0, 0.04, M.ledYellow);
      signPlane(S, d.label, "#eab308", x - 0.388, DECK + 1.82, d.z, -Math.PI / 2, 0.95, 0.42);
      for (const cz of [0.22, 0.32]) cyl(S, 0.04, 0.09, M.whiteGloss, x - 0.45, DECK + 0.965, d.z + cz, { seg: 10, r2: 0.032 });
      collider(x - 0.4, x + 0.4, d.z - 0.66, d.z + 0.66, DECK, DECK + 2.3);
    }
    // galley island
    {
      const x = 13.5;
      const z = -1.0;
      bx(S, x, DECK, z, 2.6, 0.1, 1.0, M.titaniumDark);
      bx(S, x, DECK + 0.1, z, 2.6, 0.85, 1.0, M.whiteGloss);
      bx(S, x, DECK + 0.95, z, 2.8, 0.05, 1.2, M.steel);
      bx(S, x, DECK + 0.9, z + 0.51, 2.5, 0.03, 0.02, M.ledYellow);
      bx(S, x, DECK + 0.9, z - 0.51, 2.5, 0.03, 0.02, M.ledYellow);
      for (const [ox, oz, w, h] of [
        [-0.8, 0.1, 0.5, 0.18],
        [-0.2, -0.15, 0.36, 0.12],
        [0.6, 0.12, 0.6, 0.08],
      ]) {
        bx(S, x + ox, DECK + 1.0, z + oz, w, h, 0.36, M.whiteGloss);
      }
      collider(x - 1.4, x + 1.4, z - 0.6, z + 0.6, DECK, DECK + 1.0);
    }

    // hydroponic plant wall (oxygen + food), green LED grow lights
    {
      const zBack = -8.82;
      const posts = [5.7, 8.6, 11.5, 14.4, 17.3];
      for (const px of posts) bx(S, px, DECK, zBack + 0.36, 0.08, 3.65, 0.08, M.titanium);
      bx(S, 11.5, DECK, zBack + 0.03, 11.7, 3.65, 0.04, M.titaniumDark);
      bx(S, 11.5, DECK + 3.65, zBack + 0.36, 11.68, 0.06, 0.08, M.titanium);
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const leafGeo = new THREE.IcosahedronGeometry(1, 0);
      for (const ty of [0.35, 1.15, 1.95, 2.75]) {
        for (let b = 0; b < posts.length - 1; b++) {
          const cx = (posts[b] + posts[b + 1]) / 2;
          const y = DECK + ty;
          bx(S, cx, y, zBack + 0.36, 2.78, 0.18, 0.6, M.whiteGloss);
          bx(S, cx, y + 0.18, zBack + 0.36, 2.66, 0.02, 0.5, M.soil);
          bx(S, cx, y + 0.72, zBack + 0.42, 2.66, 0.04, 0.12, M.growLight);
          for (let k = 0; k < 8; k++) {
            const px = cx - 1.2 + (k + 0.5) * 0.3 + (rnd() - 0.5) * 0.06;
            const pz = zBack + 0.36 + (rnd() - 0.5) * 0.22;
            const sz = 0.08 + rnd() * 0.05;
            const sy = sz * (1.1 + rnd() * 0.45);
            const m1 = mesh(S, leafGeo, k % 2 ? M.leaf : M.leafLight, px, y + 0.2 + sy + 0.01, pz, rnd(), rnd() * 3, 0);
            m1.scale.set(sz, sy, sz);
            const sz2 = sz * 0.65;
            const m2 = mesh(S, leafGeo, M.leaf, px + 0.05, y + 0.2 + sy * 1.35 + sz2, pz - 0.04, rnd(), rnd() * 3, 0);
            m2.scale.setScalar(sz2);
          }
        }
      }
      signPlane(S, ["HYDROPONICS", "O2 + FOOD · OKSİJEN + BESİN"], "#22c55e", 11.5, DECK + 3.92, zBack + 0.41, 0, 3.6, 0.46);
      collider(5.6, 17.4, zBack, zBack + 0.68, DECK, DECK + 3.65);
    }

    signPlane(S, ["MESS HALL", "KAFETERYA"], "#eab308", 3, DECK + 3.56, 3.81, Math.PI, 2.8, 0.54);
    signPlane(S, ["DORMITORY ↑", "YATAKHANE"], "#a855f7", 0, 4.5, -8.81, 0, 2.2, 0.34);

    pointLight(g, 0xffe2b0, 8, 22, 3, HUB_TOP - 0.6, -2.5);
  }

  // =============================================================================================
  // PURPLE — raised 3-tier bunk cabin dormitory
  // =============================================================================================
  function buildPurple({ g, s: S }) {
    const r = RECTS.purple;
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    // Inset podium slab inside perimeter wall faces (-15.82..4.82, -27.82..-9.18) to avoid wall intersections
    bx(S, cx, DECK - 0.06, cz, r.maxX - r.minX - T, DORM_RISE + 0.03, r.maxZ - r.minZ - T, M.titanium);
    bx(S, cx, DORM_FLOOR - 0.03, cz, r.maxX - r.minX - T, 0.03, r.maxZ - r.minZ - T, M.dormFloor);

    const doorOps = DORM_DOORS.map((d) => ({ c: d.x, w: d.w, y0: DORM_FLOOR, y1: DORM_FLOOR + 2.7, kind: "door" }));
    wall(S, {
      axis: "x",
      at: -9,
      from: -16.18,
      to: 5.18,
      y0: DECK,
      y1: DORM_TOP,
      mat: M.hull,
      openings: doorOps,
      ledSides: [-1],
      ledMat: M.ledPurple,
      ledY: DORM_TOP - 0.5,
      ledRange: [-15.82, 4.82],
      frameGlow: M.ledPurple,
    });
    const portholes = (cs) => cs.map((c) => ({ c, w: 0.9, y0: DORM_FLOOR + 2.45, y1: DORM_FLOOR + 3.35, kind: "porthole" }));
    wall(S, {
      axis: "z",
      at: -16,
      from: -27.82,
      to: -9.18,
      y0: DECK,
      y1: DORM_TOP,
      openings: portholes([-12.6, -17.2, -21.8, -26.0]),
      ribSides: [-1],
      ledSides: [1],
      ledMat: M.ledPurple,
      ledY: DORM_TOP - 0.5,
      ledRange: [-27.82, -9.18],
    });
    wall(S, {
      axis: "z",
      at: 5,
      from: -27.82,
      to: -9.18,
      y0: DECK,
      y1: DORM_TOP,
      openings: portholes([-12.6, -17.2, -21.8, -26.0]),
      ribSides: [1],
      ledSides: [-1],
      ledMat: M.ledPurple,
      ledY: DORM_TOP - 0.5,
      ledRange: [-27.82, -9.18],
    });
    wall(S, {
      axis: "x",
      at: -28,
      from: -16.18,
      to: 5.18,
      y0: DECK,
      y1: DORM_TOP,
      openings: portholes([-12, -5.5, 1]),
      ribSides: [-1],
      ledSides: [1],
      ledMat: M.ledPurple,
      ledY: DORM_TOP - 0.5,
      ledRange: [-15.82, 4.82],
    });

    // 3 double rows of 3-tier sleeping pods (the three purple stripes in the top-down plan)
    const STRIPES = [-12.5, -5.5, 1.5];
    const POD_LEN = 2.3;
    const N_PODS = 6;
    const Z0 = -11.75;
    const DEPTH = 1.3;
    const STACK_H = 3.6;
    const TIER = 1.16;
    const zEnd = Z0 - N_PODS * POD_LEN;
    const zMid = (Z0 + zEnd) / 2;
    let podSeed = 3;
    const podRnd = () => ((podSeed = (podSeed * 48271) % 2147483647) / 2147483647);
    const collarGeo = new THREE.TorusGeometry(0.32, 0.022, 8, 18);
    for (const c of STRIPES) {
      bx(S, c, DORM_FLOOR, zMid, DEPTH * 2, 0.12, N_PODS * POD_LEN, M.titaniumDark);
      bx(S, c, DORM_FLOOR + 0.12, zMid, 0.08, STACK_H - 0.12, N_PODS * POD_LEN, M.hullInterior);
      bx(S, c, DORM_FLOOR + STACK_H, zMid, DEPTH * 2 + 0.1, 0.08, N_PODS * POD_LEN + 0.1, M.titanium);
      bx(S, c, DORM_FLOOR + STACK_H + 0.08, zMid, DEPTH * 2 - 0.2, 0.03, N_PODS * POD_LEN - 0.4, M.ledPurple);
      collider(c - DEPTH - 0.05, c + DEPTH + 0.05, zEnd - 0.05, Z0 + 0.05, DORM_FLOOR, DORM_FLOOR + STACK_H + 0.1);
      for (const s of [-1, 1]) {
        const divW = DEPTH - 0.04;
        const xMid = c + s * (0.04 + divW / 2);
        const xFace = c + s * DEPTH;
        for (let k = 0; k <= N_PODS; k++) {
          bx(S, xMid, DORM_FLOOR + 0.12, Z0 - k * POD_LEN, divW, STACK_H - 0.12, 0.06, M.hullInterior);
        }
        for (let k = 0; k < N_PODS; k++) {
          const z0 = Z0 - k * POD_LEN;
          const zc = z0 - POD_LEN / 2;
          for (let i = 0; i < 3; i++) {
            const y = DORM_FLOOR + 0.12 + i * TIER;
            bx(S, xMid, y, zc, divW, 0.08, POD_LEN - 0.08, M.titanium); // berth platform
            bx(S, xMid, y + 0.08, z0 - 0.95, 1.12, 0.16, 1.74, M.fabric); // recessed mattress
            bx(S, xMid, y + 0.24, z0 - 0.3, 0.62, 0.1, 0.34, M.pillow);
            bx(S, xMid, y + 0.24, z0 - 1.42, 1.12, 0.04, 0.8, M.blanket);
            // storage locker at the foot of the berth
            bx(S, xMid, y + 0.08, z0 - 2.04, 1.12, 0.55, 0.34, M.hullInterior);
            bx(S, xMid, y + 0.15, z0 - 1.862, 1.0, 0.42, 0.016, M.titaniumDark);
            bx(S, xMid + s * 0.35, y + 0.33, z0 - 1.844, 0.14, 0.03, 0.02, M.steel);
            // personal reading light under the berth above, on the spine
            bx(S, c + s * 0.1, y + 0.98, z0 - 0.38, 0.05, 0.05, 0.22, M.readingLight);
            // privacy shutter on proud outer track rails (strictly between rails y+0.10..y+0.96)
            bx(S, xFace + s * 0.025, y + 0.98, zc, 0.05, 0.04, POD_LEN - 0.06, M.steel);
            bx(S, xFace + s * 0.025, y + 0.0, zc, 0.05, 0.1, POD_LEN - 0.06, M.steel);
            const shutLen = (POD_LEN - 0.1) * (0.2 + 0.55 * podRnd());
            bx(S, xFace + s * 0.025, y + 0.12, zEndOf(z0) + 0.05 + shutLen / 2, 0.024, 0.82, shutLen, M.shutter);
            bx(S, xFace - s * 0.12, y + 1.09, zc, 0.03, 0.02, POD_LEN - 0.4, M.ledPurple);
          }
          // brushed-steel access ladder at the head end of the stack (rungs fit cleanly inside 0.38 m gap)
          const lx = xFace + s * 0.08;
          for (const lz of [z0 - 0.1, z0 - 0.52]) bx(S, lx, DORM_FLOOR, lz, 0.04, STACK_H, 0.04, M.steel);
          for (let rr = 0; rr < 11; rr++) cyl(S, 0.018, 0.38, M.steel, lx, DORM_FLOOR + 0.3 + rr * 0.3, z0 - 0.31, { axis: "z", seg: 8 });
        }
      }
    }
    function zEndOf(z0) {
      return z0 - POD_LEN;
    }

    // wall lockers along the side walkways (trims sit proud on locker door face)
    for (const [x, s] of [
      [-15.82, 1],
      [4.82, -1],
    ]) {
      for (let k = 0; k < 7; k++) {
        const z = -12.2 - k * 2.0;
        const xm = x + s * 0.23;
        bx(S, xm, DORM_FLOOR, z, 0.45, 2.1, 1.92, M.hullInterior);
        bx(S, xm + s * 0.23, DORM_FLOOR + 0.05, z, 0.01, 2.0, 0.02, M.titaniumDark);
        for (const hz of [-0.18, 0.18]) bx(S, xm + s * 0.245, DORM_FLOOR + 1.0, z + hz, 0.03, 0.14, 0.03, M.steel);
        bx(S, xm + s * 0.23, DORM_FLOOR + 1.82, z, 0.01, 0.06, 1.6, M.ledPurple);
      }
      collider(Math.min(x, x + s * 0.46), Math.max(x, x + s * 0.46), -26.2, -11.2, DORM_FLOOR, DORM_FLOOR + 2.1);
    }

    // ceiling: light strips over the walkways and air ducts with non-overlapping torus collar rings
    for (const wx of [-14.6, -9, -2, 3.6]) {
      bx(S, wx, DORM_TOP - 0.06, -18.5, 0.6, 0.06, 17.4, M.titanium);
      bx(S, wx, DORM_TOP - 0.1, -18.5, 0.45, 0.04, 17.2, M.coolPanel);
    }
    for (const dx of [-9, -2]) {
      cyl(S, 0.3, 18.4, M.steel, dx + 1.1, DORM_TOP - 0.62, -18.5, { axis: "z", seg: 18 });
      for (let z = -26.5; z < -10; z += 3) mesh(S, collarGeo, M.titanium, dx + 1.1, DORM_TOP - 0.62, z);
    }

    wallScreen(S, 6, -9, DORM_FLOOR + 2.2, -27.67, 0, 2.0, "#c084fc", M.ledPurple);
    signPlane(S, ["DORMITORY", "3 KATLI KABİN YATAKLAR"], "#a855f7", -14, DORM_FLOOR + 3.26, -9.2, Math.PI, 2.4, 0.56);
    signPlane(S, ["DORMITORY", "YATAKHANE"], "#a855f7", -14, DORM_FLOOR + 3.25, -8.8, 0, 2.0, 0.5);

    pointLight(g, 0xeadcff, 8, 22, -5.5, DORM_TOP - 0.9, -18.5);
  }

  // =============================================================================================
  // GREEN — 5-bay rover garage & spawn hangar
  // =============================================================================================
  function buildGreen({ g, s: S }) {
    floorSlab(S, RECTS.green, M.diamond);
    for (const sx of [-1, 1]) {
      wall(S, {
        axis: "z",
        at: 18 * sx,
        from: 10.18,
        to: 21.5,
        y0: DECK,
        y1: GARAGE_TOP,
        openings: [13, 19].map((c) => ({ c, w: 3.0, y0: DECK + 5.3, y1: DECK + 6.5, kind: "window" })),
        ribSides: [sx],
        ribEvery: 2.0,
        kickSides: [-sx],
        kickRange: [10.18, 21.5],
        ledSides: [-sx],
        ledMat: M.ledGreen,
        ledY: DECK + 4.3,
        ledRange: [10.23, 21.5],
      });
    }
    // front piers between the 5 bays (stop cleanly at BAY_DOOR_H so header rests flush on top)
    for (const px of PIER_X) {
      const w = Math.abs(px) === 18 ? 1.0 : 1.2;
      bx(S, px, DECK, BAY_FRONT_Z, w, BAY_DOOR_H, 1.0, M.hull, { collide: true });
      for (const e of [-1, 1]) bx(S, px + (e * w) / 2, DECK, BAY_FRONT_Z + 0.54, 0.1, BAY_DOOR_H, 0.08, M.titanium);
      bx(S, px, DECK + 0.4, BAY_FRONT_Z + 0.525, 0.14, BAY_DOOR_H - 0.6, 0.04, M.ledGreen);
      // door guide tracks on the pier sides
      for (const e of [-1, 1]) {
        if (Math.abs(px + e * w) > 18.5) continue;
        bx(S, px + e * (w / 2 + 0.05), DECK, BAY_FRONT_Z - 0.2, 0.1, BAY_DOOR_H, 0.16, M.titaniumDark);
      }
    }
    // header over the doors (camera-only collider: rovers fit under it)
    bx(S, 0, DECK + BAY_DOOR_H, BAY_FRONT_Z, 37.0, H_GARAGE - BAY_DOOR_H, 1.0, M.hull, { collide: true, walk: false });
    bx(S, 0, DECK + BAY_DOOR_H, BAY_FRONT_Z + 0.53, 37.0, 0.16, 0.06, M.titanium);
    bx(S, 0, DECK + BAY_DOOR_H + 0.16, BAY_FRONT_Z + 0.525, 37.0, 0.05, 0.05, M.ledGreen);
    signPlane(S, ["MARS HABITAT STATION · HAB-1", "MARTIAN MAPPERS · GALE CRATER"], "#22c55e", 0, DECK + 7.0, BAY_FRONT_Z + 0.515, 0, 9.5, 1.1);

    BAY_X.forEach((c, i) => {
      signPlane(S, `BAY 0${i + 1}`, "#22c55e", c, DECK + 6.0, BAY_FRONT_Z + 0.515, 0, 2.4, 0.72);
      // inside: overhead door tracks cantilevered cleanly from the front header (clear of the gantry crane sweep)
      for (const e of [-1, 1]) {
        bx(S, c + e * 2.98, DECK + BAY_DOOR_H - 0.16, BAY_FRONT_Z - 3.2, 0.08, 0.1, 5.8, M.titanium);
        bx(S, c + e * 2.98, DECK + BAY_DOOR_H - 0.06, BAY_FRONT_Z - 0.59, 0.06, 1.25, 0.08, M.steel);
      }
      // threshold and floor markings
      bx(S, c, DECK, BAY_FRONT_Z - 0.3, BAY_DOOR_W, 0.012, 0.5, M.hazard);
      for (const e of [-1, 1]) {
        const outerWallBay = Math.abs(c + e * 3.0) > 17.0;
        bx(S, c + e * 3.0, DECK, outerWallBay ? 17.3 : 15.9, 0.12, 0.01, outerWallBay ? 8.0 : 10.8, M.paintYellow);
      }
      const decalRect = decalAtlas.alloc(340, 170, (ctx, ox, oy, w, h) => drawFloorDecalOnCtx(ctx, ox, oy, w, h, `0${i + 1}`, "#d9dce0"));
      const decal = new THREE.Mesh(remapPlaneUV(new THREE.PlaneGeometry(1.8, 0.9), decalRect), decalMat);
      decal.rotation.x = -Math.PI / 2;
      decal.position.set(c, DECK + 0.014, 20.1);
      S.add(decal);

      // charging pedestal with a floor-routed cable docking at a cradle clear of all 5 bay rovers
      const px = c + 2.3;
      const pz = 11.2;
      bx(S, px, DECK, pz, 0.5, 1.45, 0.4, M.whiteGloss);
      bx(S, px, DECK + 1.45, pz, 0.56, 0.06, 0.46, M.titanium);
      bx(S, px, DECK + 1.0, pz + 0.21, 0.3, 0.2, 0.02, M.statusGreen);
      bx(S, px, DECK + 0.1, pz + 0.21, 0.04, 0.8, 0.02, M.ledGreen);
      const dockX = c + 1.95;
      const dockZ = 13.25;
      bx(S, dockX, DECK, dockZ, 0.36, 0.08, 0.44, M.titanium);
      bx(S, dockX, DECK + 0.08, dockZ, 0.22, 0.22, 0.28, M.titaniumDark);
      bx(S, dockX, DECK + 0.3, dockZ, 0.12, 0.02, 0.14, M.ledGreen);
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(px - 0.25, DECK + 0.92, pz),
        new THREE.Vector3(px - 0.36, DECK + 0.24, 11.8),
        new THREE.Vector3(dockX, DECK + 0.045, 12.35),
        new THREE.Vector3(dockX, DECK + 0.045, 12.85),
        new THREE.Vector3(dockX, DECK + 0.2, dockZ - 0.12),
      ]);
      mesh(S, new THREE.TubeGeometry(curve, 36, 0.032, 8, false), M.cable);
      collider(px - 0.28, px + 0.28, pz - 0.23, pz + 0.23, DECK, DECK + 1.5);
      collider(dockX - 0.2, dockX + 0.2, dockZ - 0.24, dockZ + 0.24, DECK, DECK + 0.4);

      // high-bay ceiling lights mounted flush into roof soffit (above crane bridge top y = 7.90)
      for (const z of [13, 19]) {
        bx(S, c, GARAGE_TOP - 0.14, z, 1.5, 0.14, 0.6, M.titanium);
        bx(S, c, GARAGE_TOP - 0.18, z, 1.36, 0.04, 0.48, M.coolPanel);
      }

      // exterior ramp down to the Martian surface
      const Lr = Math.hypot(RAMP_LEN, DECK);
      const ang = Math.atan2(DECK, RAMP_LEN);
      const zc = BAY_FRONT_Z + RAMP_LEN / 2;
      mesh(S, boxGeo(RAMP_HALF_W * 2, 0.08, Lr, 0.8), M.diamond, c, DECK / 2 - 0.04, zc, ang, 0, 0);
      for (const e of [-1, 1]) {
        mesh(S, boxGeo(0.25, 0.012, Lr, 0.6), M.hazard, c + e * (RAMP_HALF_W - 0.14), DECK / 2 + 0.007, zc, ang, 0, 0);
        const xEdge = c + e * RAMP_HALF_W;
        prism(S, [[BAY_FRONT_Z, 0], [BAY_FRONT_Z, DECK], [BAY_FRONT_Z + RAMP_LEN, 0]], 0.06, M.titanium, "zy", e > 0 ? xEdge : xEdge - 0.06);
        for (let k = 0; k < 5; k++) {
          const z = BAY_FRONT_Z + 0.65 + k * 0.9;
          const y = DECK * (1 - (z - BAY_FRONT_Z) / RAMP_LEN);
          bx(S, xEdge + e * 0.085, y - 0.06, z, 0.05, 0.05, 0.16, M.ledGreen);
        }
      }
      bx(S, c, 0, BAY_FRONT_Z + RAMP_LEN + 0.1, RAMP_HALF_W * 2, 0.035, 0.2, M.titanium);
    });

    // back wall: tool chests and pegboards (cleared forward of ribs at z <= 10.28)
    for (const x of [-16.2, -13.4, -7.6, -4.8, 4.8, 7.6, 13.4, 16.2]) {
      const z = 10.62;
      bx(S, x, DECK + 0.12, z, 1.2, 1.0, 0.6, M.toolRed);
      bx(S, x, DECK + 1.12, z, 1.22, 0.07, 0.62, M.titaniumDark);
      for (let j = 0; j < 5; j++) {
        bx(S, x, DECK + 0.3 + j * 0.18, z + 0.306, 1.12, 0.012, 0.012, M.titaniumDark);
        bx(S, x, DECK + 0.37 + j * 0.18, z + 0.324, 0.6, 0.025, 0.024, M.steel);
      }
      for (const ex of [-0.5, 0.5]) for (const ez of [-0.22, 0.22]) cyl(S, 0.06, 0.05, M.rubber, x + ex, DECK + 0.06, z + ez, { axis: "x", seg: 10 });
      if (Math.abs(x) > 6) {
        bx(S, x, DECK + 1.5, 10.305, 1.3, 1.0, 0.03, M.titaniumDark);
        for (let k = 0; k < 5; k++) bx(S, x - 0.5 + k * 0.25, DECK + 1.7 + (k % 2) * 0.2, 10.335, 0.05, 0.35, 0.03, M.steel);
      }
      collider(x - 0.62, x + 0.62, z - 0.32, z + 0.32, DECK, DECK + 1.2);
    }
    // spare-wheel racks on the side walls (cleared inside ±17.78 kick plates)
    for (const sx of [-1, 1]) {
      const x = 17.51 * sx;
      bx(S, x, DECK, 12.1, 0.5, 0.08, 1.8, M.titanium);
      bx(S, x, DECK + 2.2, 12.1, 0.5, 0.06, 1.8, M.titanium);
      for (const z of [11.5, 12.7]) for (const y of [0.5, 1.55]) cyl(S, 0.42, 0.24, M.rubber, x, DECK + y, z, { axis: "x", seg: 20 });
      collider(x - 0.3, x + 0.3, 11.1, 13.1, DECK, DECK + 2.3);
    }
    signPlane(S, ["ROVER GARAGE", "ARAÇ SPAWN BÖLÜMÜ"], "#22c55e", 0, DECK + 5.0, 10.3, 0, 5.2, 1.1);

    // gantry crane: wall/header-bracketed runways along X, moving bridge + trolley + hoist (zero ceiling/track interference)
    for (const zr of [10.75, 20.95]) {
      const bz = zr < 15 ? 10.54 : 21.15;
      const bd = zr < 15 ? 0.72 : 0.7;
      bx(S, 0, DECK + 6.68, zr, 35.0, 0.36, 0.06, M.craneYellow);
      bx(S, 0, DECK + 7.04, zr, 35.0, 0.04, 0.32, M.craneYellow);
      bx(S, 0, DECK + 6.64, zr, 35.0, 0.04, 0.32, M.craneYellow);
      bx(S, 0, DECK + 7.08, zr, 35.0, 0.03, 0.08, M.steel);
      for (let x = -16; x <= 16; x += 4) bx(S, x, DECK + 6.54, bz, 0.26, 0.1, bd, M.titanium);
    }
    craneBridge = new THREE.Group();
    craneBridge.name = "gantryBridge";
    const body = new THREE.Group();
    craneBridge.add(body);
    bx(body, 0, DECK + 7.34, 15.85, 0.5, 0.06, 9.76, M.craneYellow);
    bx(body, 0, DECK + 6.94, 15.85, 0.5, 0.06, 9.76, M.craneYellow);
    bx(body, 0, DECK + 7.0, 15.85, 0.08, 0.34, 9.76, M.craneYellow);
    for (const e of [-1, 1]) bx(body, e * 0.045, DECK + 7.07, 15.85, 0.01, 0.2, 9.2, M.hazard);
    for (const zr of [10.75, 20.95]) {
      bx(body, 0, DECK + 7.28, zr, 1.5, 0.12, 0.44, M.craneYellow);
      for (const ez of [-0.14, 0.14]) bx(body, 0, DECK + 7.12, zr + ez, 1.5, 0.16, 0.06, M.craneYellow);
      for (const ex of [-0.55, 0.55]) cyl(body, 0.08, 0.1, M.titaniumDark, ex, DECK + 7.19, zr, { axis: "z", seg: 12 });
    }
    mergeStaticMeshes(THREE, body);
    craneTrolley = new THREE.Group();
    craneTrolley.position.z = 15.85;
    bx(craneTrolley, 0, DECK + 6.54, 0, 0.9, 0.4, 0.8, M.craneYellow);
    cyl(craneTrolley, 0.16, 0.7, M.titaniumDark, 0, DECK + 6.38, 0, { axis: "x", seg: 16 });
    craneCable = cyl(craneTrolley, 0.016, 1, M.cable, 0, DECK + 6.22, 0, { seg: 6 });
    craneHook = new THREE.Group();
    bx(craneHook, 0, -0.22, 0, 0.28, 0.22, 0.16, M.craneYellow);
    cyl(craneHook, 0.025, 0.04, M.steel, 0, -0.24, 0, { seg: 8 });
    mesh(craneHook, new THREE.TorusGeometry(0.08, 0.022, 6, 14, Math.PI * 1.4), M.steel, 0, -0.365, 0, 0, 0, Math.PI * 0.8);
    craneTrolley.add(craneHook);
    craneBridge.add(craneTrolley);
    g.add(craneBridge);

    // segmented overhead sectional doors (4 slats per bay, optimized draw count)
    const N_SLATS = 4;
    const slatH = BAY_DOOR_H / N_SLATS;
    BAY_X.forEach((c) => {
      const door = new THREE.Group();
      door.name = "hangarDoor";
      door.position.x = c;
      const slats = [];
      for (let k = 0; k < N_SLATS; k++) {
        const slat = new THREE.Group();
        bx(slat, 0, -slatH / 2 + 0.01, 0, BAY_DOOR_W, slatH - 0.02, 0.1, M.slat);
        bx(slat, 0, slatH / 2 - 0.05, 0.06, BAY_DOOR_W, 0.04, 0.02, M.titanium);
        if (k === 0) bx(slat, 0, -slatH / 2 + 0.02, 0.06, BAY_DOOR_W, 0.24, 0.02, M.hazard);
        if (k === 1) {
          for (let w = 0; w < 4; w++) {
            for (const fz of [-0.055, 0.055]) bx(slat, -2.1 + w * 1.4, -0.15, fz, 0.8, 0.34, 0.01, M.viewport);
          }
        }
        mergeStaticMeshes(THREE, slat);
        door.add(slat);
        slats.push(slat);
      }
      g.add(door);
      const col = collider(c - BAY_DOOR_W / 2, c + BAY_DOOR_W / 2, BAY_FRONT_Z - 0.2, BAY_FRONT_Z + 0.2, DECK, DECK + BAY_DOOR_H, {
        dyn: { solid: false },
      });
      const d = { cx: c, open: 1, slats, slatH, collider: col };
      poseHangarDoor(d);
      hangarDoors.push(d);
    });

    // apron in front of the bays: sintered-regolith pad sitting flush below terrain surface (top -0.005)
    bx(S, 0, -0.155, 34.25, 42, 0.15, 23.5, M.regolithPad);
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(-0.9, 0);
    arrowShape.lineTo(0.9, 0);
    arrowShape.lineTo(0, -1.5);
    arrowShape.closePath();
    const arrowGeo = new THREE.ShapeGeometry(arrowShape);
    arrowGeo.rotateX(-Math.PI / 2); // tip points +Z (outwards), face up
    for (const c of BAY_X) {
      for (const e of [-1, 1]) bx(S, c + e * 2.9, -0.005, 34.6, 0.15, 0.01, 14.6, M.paintYellow);
      for (let z = 28.5; z < 41; z += 2.4) bx(S, c, -0.005, z, 0.18, 0.012, 1.2, M.ledGreen);
      mesh(S, arrowGeo, M.ledGreen, c, 0.002, 42.2);
    }

    pointLight(g, 0xeaf6ff, 9, 24, -9, DECK + 6.0, 16);
    pointLight(g, 0xeaf6ff, 9, 24, 9, DECK + 6.0, 16);
  }

  function poseHangarDoor(d) {
    const travel = BAY_DOOR_H - 0.25;
    const yHoriz = DECK + BAY_DOOR_H - 0.12;
    d.slats.forEach((slat, k) => {
      const p = k * d.slatH + d.slatH / 2 + d.open * travel; // distance along the track from the floor
      if (p <= BAY_DOOR_H - d.slatH * 0.35) {
        slat.position.set(0, DECK + p, BAY_FRONT_Z);
        slat.rotation.x = 0;
      } else {
        const q = p - (BAY_DOOR_H - d.slatH * 0.35);
        slat.position.set(0, yHoriz, BAY_FRONT_Z - 0.3 - q);
        slat.rotation.x = -Math.PI / 2;
      }
    });
    d.collider.dyn.solid = d.open < 0.82;
  }

  // =============================================================================================
  // RED — pressurized airlock & stabilization chamber (Dengeleme Alanı)
  // =============================================================================================
  function buildRed({ g, s: S }) {
    floorSlab(S, RECTS.red, M.grate);
    const doorOp = { c: AIRLOCK_DOOR_Z, w: AIRLOCK_DOOR_W, y1: DECK + AIRLOCK_DOOR_H, kind: "door", noFrame: true };
    wall(S, {
      axis: "z",
      at: 18,
      from: 4.18,
      to: 9.82,
      y0: DECK,
      y1: HUB_TOP,
      mat: M.hullInterior,
      openings: [doorOp],
      ledSides: [1],
      ledMat: M.ledRed,
      ledY: HUB_TOP - 0.16,
      ledRange: [4.18, 9.82],
    });
    wall(S, {
      axis: "z",
      at: 32,
      from: 4.18,
      to: 9.82,
      y0: DECK,
      y1: HUB_TOP,
      openings: [doorOp],
      ribSides: [1],
      ledSides: [-1],
      ledMat: M.ledRed,
      ledY: HUB_TOP - 0.16,
      ledRange: [4.18, 9.82],
    });
    wall(S, {
      axis: "x",
      at: 4,
      from: 18.18,
      to: 32.18,
      y0: DECK,
      y1: HUB_TOP,
      ribSides: [-1],
      kickSides: [1],
      kickRange: [18.18, 31.82],
      ledSides: [1],
      ledMat: M.ledRed,
      ledY: HUB_TOP - 0.16,
      ledRange: [18.18, 31.82],
    });
    wall(S, {
      axis: "x",
      at: 10,
      from: 18.18,
      to: 32.18,
      y0: DECK,
      y1: HUB_TOP,
      openings: [{ c: 25, w: 0.8, y0: DECK + 2.55, y1: DECK + 3.35, kind: "porthole" }],
      ribSides: [1],
      kickSides: [-1],
      kickRange: [18.18, 31.82],
      ledSides: [-1],
      ledMat: M.ledRed,
      ledY: HUB_TOP - 0.16,
      ledRange: [18.18, 31.82],
    });

    // ceiling light strips and twin stabilization arches (framing center console/bench without blocking)
    bx(S, 25, HUB_TOP - 0.06, 5.6, 12.8, 0.04, 0.3, M.coolPanel);
    bx(S, 25, HUB_TOP - 0.06, 8.4, 12.8, 0.04, 0.3, M.coolPanel);
    bx(S, 25, HUB_TOP - 0.05, 7, 12.8, 0.03, 0.08, M.ledRed);
    const beamBottom = HUB_TOP - 0.4;
    for (const ax of [23.3, 26.7]) {
      for (const z of [4.36, 9.64]) {
        bx(S, ax, DECK, z, 0.28, beamBottom - DECK, 0.26, M.titanium);
        bx(S, ax, DECK + 0.2, z + (z < 7 ? 0.14 : -0.14), 0.06, beamBottom - DECK - 0.4, 0.02, M.ledRed);
      }
      bx(S, ax, beamBottom, 7, 0.28, 0.28, 5.54, M.titanium);
      bx(S, ax, beamBottom - 0.03, 7, 0.06, 0.03, 5.2, M.ledRed);
    }

    // heavy bulkhead door collars (proud exterior/interior casings clear of wall core), pocket tracks, thresholds
    for (const dx of [18, 32]) {
      const sIn = dx < 25 ? 1 : -1;
      const xPocket = dx + sIn * 0.3; // 18.30 and 31.70 — sliding leaves ride strictly inside room clear of walls
      for (const sx of [-1, 1]) {
        const xCasing = dx + sx * (T / 2 + 0.02);
        for (const e of [-1, 1]) {
          const zj = AIRLOCK_DOOR_Z + e * (AIRLOCK_DOOR_W / 2 + 0.13);
          bx(S, xCasing, DECK, zj, 0.04, AIRLOCK_DOOR_H, 0.26, M.titanium);
          if (sx !== sIn) bx(S, dx + sx * (T / 2 + 0.05), DECK, zj, 0.02, AIRLOCK_DOOR_H, 0.14, M.hazard);
        }
        bx(S, xCasing, DECK + AIRLOCK_DOOR_H, AIRLOCK_DOOR_Z, 0.04, 0.28, AIRLOCK_DOOR_W + 0.52, M.titanium);
      }
      // Pocket slide rails above & below the interior sliding leaves
      bx(S, xPocket, DECK + AIRLOCK_DOOR_H, AIRLOCK_DOOR_Z, 0.18, 0.1, 5.3, M.steel);
      bx(S, xPocket, DECK, AIRLOCK_DOOR_Z, 0.18, 0.014, 5.3, M.titaniumDark);
      bx(S, dx < 25 ? 17.71 : 31.61, DECK, AIRLOCK_DOOR_Z, 0.22, 0.015, AIRLOCK_DOOR_W + 0.2, M.hazard);
      for (const e of [-1, 1]) {
        cyl(S, 0.06, 1.0, M.steel, xPocket, DECK + AIRLOCK_DOOR_H + 0.22, AIRLOCK_DOOR_Z + e * 0.9, { axis: "z", seg: 12 });
        cyl(S, 0.09, 0.45, M.titaniumDark, xPocket, DECK + AIRLOCK_DOOR_H + 0.22, AIRLOCK_DOOR_Z + e * 1.55, { axis: "z", seg: 12 });
      }
    }

    // sliding blast doors on interior pocket tracks with non-overlapping circular viewports (animated, interlocked)
    for (const dx of [18, 32]) {
      const sIn = dx < 25 ? 1 : -1;
      const door = new THREE.Group();
      door.name = "airlockDoor";
      door.position.set(dx + sIn * 0.3, 0, AIRLOCK_DOOR_Z);
      const halves = [];
      for (const e of [-1, 1]) {
        const half = new THREE.Group();
        const hw = AIRLOCK_DOOR_W / 2 + 0.03;
        bx(half, 0, DECK + 0.015, e * 0.06, 0.14, AIRLOCK_DOOR_H - 0.02, hw - 0.12, M.doorPaint);
        bx(half, 0, DECK + 0.015, -e * (hw / 2 - 0.06), 0.15, AIRLOCK_DOOR_H - 0.02, 0.12, M.hazard);
        for (const sx of [-1, 1]) {
          for (const y of [0.7, 2.35]) bx(half, sx * 0.078, DECK + y, 0, 0.016, 0.12, hw - 0.14, M.titanium);
          const vp = new THREE.CylinderGeometry(0.19, 0.19, 0.012, 24);
          vp.rotateZ(Math.PI / 2);
          mesh(half, vp, M.viewport, sx * 0.076, DECK + 1.65, 0.05 * e);
          mesh(half, new THREE.TorusGeometry(0.21, 0.038, 8, 24), M.steel, sx * 0.09, DECK + 1.65, 0.05 * e, 0, Math.PI / 2, 0);
        }
        mergeStaticMeshes(THREE, half);
        door.add(half);
        halves.push({ g: half, e, hw });
      }
      g.add(door);
      const col = collider(dx - 0.16, dx + 0.16, AIRLOCK_DOOR_Z - AIRLOCK_DOOR_W / 2, AIRLOCK_DOOR_Z + AIRLOCK_DOOR_W / 2, DECK, DECK + AIRLOCK_DOOR_H, {
        dyn: { solid: true },
      });
      const d = { x: dx, open: 0, halves, collider: col };
      poseAirlockDoor(d);
      airlockDoors.push(d);
    }

    // rotating warning beacons: 1 shared LatheGeometry double-cone per beacon, mounted clear of walls/roof
    const beamLathe = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.24, -0.95),
        new THREE.Vector2(0.035, 0),
        new THREE.Vector2(0.24, 0.95),
      ],
      18
    );
    beamLathe.rotateZ(Math.PI / 2);
    const beacon = (x, yCenter, z, mat) => {
      cyl(S, 0.1, 0.12, M.titaniumDark, x, yCenter + 0.1, z, { seg: 16 });
      cyl(S, 0.085, 0.16, mat, x, yCenter - 0.04, z, { seg: 16 });
      const beam = new THREE.Group();
      beam.position.set(x, yCenter - 0.04, z);
      beam.add(new THREE.Mesh(beamLathe, M.beamRed));
      g.add(beam);
      beaconBeams.push(beam);
    };
    for (const bxPos of [19.6, 30.4]) {
      for (const bzPos of [5.35, 8.65]) beacon(bxPos, HUB_TOP - 0.16, bzPos, M.beacon);
    }
    // exterior roof-edge amber mast beacon over East airlock doorway
    cyl(S, 0.05, 0.36, M.titaniumDark, 32.02, HUB_TOP + 0.46, AIRLOCK_DOOR_Z, { seg: 12 });
    beacon(32.02, HUB_TOP + 0.72, AIRLOCK_DOOR_Z, M.amber);

    // O2 scrubbers / CO2 removal units on the north wall (cleared forward of kick plate z=4.22 and twin arches)
    for (const x of [21.3, 28.7]) {
      const z = 4.58;
      bx(S, x, DECK, z, 2.2, 2.6, 0.7, M.hullInterior);
      bx(S, x, DECK + 0.25, z + 0.36, 2.0, 2.1, 0.02, M.titaniumDark);
      for (const fx of [-0.55, 0.55]) {
        cyl(S, 0.34, 0.05, M.titanium, x + fx, DECK + 1.55, z + 0.395, { axis: "z", seg: 24 });
        cyl(S, 0.3, 0.02, M.titaniumDark, x + fx, DECK + 1.55, z + 0.43, { axis: "z", seg: 24 });
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3;
          mesh(S, boxGeo(0.18, 0.045, 0.014), M.steel, x + fx + 0.17 * Math.cos(a), DECK + 1.55 + 0.17 * Math.sin(a), z + 0.448, 0, 0, a);
        }
        cyl(S, 0.06, 0.03, M.steel, x + fx, DECK + 1.55, z + 0.455, { axis: "z", seg: 10 });
      }
      for (let k = 0; k < 5; k++) bx(S, x, DECK + 0.35 + k * 0.12, z + 0.38, 1.7, 0.04, 0.02, M.steel);
      [M.statusGreen, M.amber, M.statusCyan].forEach((m, k) => bx(S, x - 0.5 + k * 0.5, DECK + 2.26, z + 0.38, 0.12, 0.06, 0.02, m));
      for (const px of [-0.7, 0.7]) cyl(S, 0.075, 1.0, M.steel, x + px, DECK + 3.1, z + 0.06, { seg: 12 });
      signPlane(S, ["O2 SCRUBBER", "CO2 REMOVAL"], "#ef4444", x, DECK + 2.48, z + 0.38, 0, 1.2, 0.26);
      collider(x - 1.1, x + 1.1, z - 0.36, z + 0.42, DECK, DECK + 2.6);
    }
    cyl(S, 0.08, 9.8, M.steel, 25, DECK + 3.6, 4.64, { axis: "x", seg: 14 });
    // bench between the scrubbers (strictly between twin arches x=23.3 and x=26.7)
    bx(S, 25, DECK + 0.42, 4.54, 2.7, 0.08, 0.5, M.steel);
    for (const ex of [-1.15, 1.15]) bx(S, 25 + ex, DECK, 4.54, 0.08, 0.42, 0.42, M.titanium);
    collider(23.62, 26.38, 4.28, 4.8, DECK, DECK + 0.52);

    // twin spacesuit racks flanking center console + extended PLSS suit hangers reaching the rails
    for (const [rx0, rx1, cxRack] of [
      [19.7, 22.9, 21.3],
      [27.1, 30.3, 28.7],
    ]) {
      bx(S, cxRack, DECK + 2.24, 9.6, rx1 - rx0, 0.08, 0.08, M.titanium);
      for (const px of [rx0 + 0.04, rx1 - 0.04]) bx(S, px, DECK, 9.6, 0.08, 2.24, 0.08, M.titanium);
      collider(rx0, rx1, 9.0, 9.78, DECK, DECK + 2.35);
    }
    [20.6, 22.0, 28.0, 29.4].forEach((x, i) => buildSuit(S, x, 9.24, i === 0));
    bx(S, 25, DECK, 9.44, 1.6, 0.95, 0.6, M.hullInterior);
    bx(S, 25, DECK + 0.95, 9.44, 1.66, 0.04, 0.66, M.steel);
    wallScreen(S, 7, 25, DECK + 1.65, 9.55, Math.PI, 1.4, "#ef4444", M.ledRed);
    collider(24.2, 25.8, 9.14, 9.8, DECK, DECK + 1.0);

    signPlane(S, ["STABILIZATION CHAMBER", "DENGELEME ALANI"], "#ef4444", 18.24, DECK + 3.68, AIRLOCK_DOOR_Z, Math.PI / 2, 2.6, 0.52);
    signPlane(S, ["AIRLOCK A-1", "HAVA KİLİDİ"], "#ef4444", 17.8, DECK + 3.68, AIRLOCK_DOOR_Z, -Math.PI / 2, 2.4, 0.52);
    signPlane(S, ["AIRLOCK A-1 · ENTRY", "HAVA KİLİDİ · GİRİŞ"], "#ef4444", 32.21, DECK + 3.62, AIRLOCK_DOOR_Z, Math.PI / 2, 3.2, 0.6);

    // exterior ramp with handrails starting cleanly at exterior face x = 32.18, apron pad top at -0.005
    {
      const { x0, x1, z0, z1 } = AIRLOCK_RAMP;
      const xr0 = x0 + 0.18;
      const L = x1 - xr0;
      const Lr = Math.hypot(L, DECK);
      const ang = Math.atan2(DECK, L);
      bx(S, x0, DECK - 0.08, AIRLOCK_DOOR_Z, T, 0.08, AIRLOCK_DOOR_W - 0.02, M.diamond);
      mesh(S, boxGeo(Lr, 0.08, z1 - z0, 0.8), M.diamond, (xr0 + x1) / 2, DECK / 2 - 0.04, AIRLOCK_DOOR_Z, 0, 0, -ang);
      prism(S, [[xr0, 0], [xr0, DECK], [x1, 0]], 0.06, M.titanium, "xy", z0 - 0.06);
      prism(S, [[xr0, 0], [xr0, DECK], [x1, 0]], 0.06, M.titanium, "xy", z1);
      for (const z of [z0 + 0.05, z1 - 0.05]) {
        for (const t of [0.08, 0.5, 0.92]) {
          const x = xr0 + t * L;
          cyl(S, 0.028, 0.97, M.steel, x, DECK * (1 - t) + 0.485, z, { seg: 8 });
        }
        mesh(S, boxGeo(Lr, 0.06, 0.06), M.steel, (xr0 + x1) / 2, DECK / 2 + 1.0, z, 0, 0, -ang);
        collider(xr0, x1, z - 0.05, z + 0.05, 0, DECK + 1.0);
      }
      bx(S, x1 + 0.1, 0, AIRLOCK_DOOR_Z, 0.2, 0.035, z1 - z0, M.titanium);
      bx(S, 37.2, -0.155, 7, 9.8, 0.15, 8.2, M.regolithPad);
    }

    airlockLight = pointLight(g, 0xff3a24, 2, 14, 25, HUB_TOP - 0.7, 7, 2);
  }

  function poseAirlockDoor(d) {
    for (const h of d.halves) h.g.position.z = h.e * (h.hw / 2 + d.open * (h.hw - 0.05));
    d.collider.dyn.solid = d.open < 0.85;
  }

  /** A pressure suit hanging on the rack (faces -Z, into the airlock). */
  function buildSuit(S, x, z, commander) {
    const y = DECK;
    bx(S, x, y + 0.92, z + 0.36, 0.56, 0.78, 0.28, M.whiteGloss); // PLSS backpack
    bx(S, x, y + 1.7, z + 0.36, 0.09, 0.56, 0.08, M.titanium); // suspension strut up to rack rail
    bx(S, x, y + 2.24, z + 0.36, 0.12, 0.08, 0.22, M.titanium); // clamp around rail
    const torso = mesh(S, new THREE.CapsuleGeometry(0.24, 0.36, 6, 14), M.suit, x, y + 1.4, z);
    torso.scale.set(1.18, 1, 0.92);
    mesh(S, new THREE.TorusGeometry(0.16, 0.035, 8, 20), M.steel, x, y + 1.8, z, Math.PI / 2, 0, 0);
    mesh(S, new THREE.TorusGeometry(0.24, 0.03, 8, 22), M.steel, x, y + 1.08, z, Math.PI / 2, 0, 0);
    mesh(S, new THREE.SphereGeometry(0.19, 22, 16), M.whiteGloss, x, y + 1.97, z);
    mesh(
      S,
      new THREE.SphereGeometry(0.197, 22, 14, Math.PI * 1.5 - Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.26, Math.PI * 0.42),
      M.visor,
      x,
      y + 1.97,
      z
    );
    for (const e of [-1, 1]) {
      mesh(S, new THREE.CylinderGeometry(0.075, 0.065, 0.62, 12), M.suit, x + e * 0.33, y + 1.33, z, 0, 0, e * 0.1);
      mesh(S, new THREE.SphereGeometry(0.075, 12, 10), M.suit, x + e * 0.36, y + 0.98, z);
      mesh(S, new THREE.CylinderGeometry(0.1, 0.09, 0.74, 12), M.suit, x + e * 0.12, y + 0.75, z);
      bx(S, x + e * 0.12, y + 0.22, z - 0.04, 0.16, 0.16, 0.3, M.titaniumDark);
      if (commander) mesh(S, new THREE.CylinderGeometry(0.079, 0.077, 0.07, 12), M.redPaint, x + e * 0.335, y + 1.48, z, 0, 0, e * 0.1);
    }
    bx(S, x, y + 1.3, z - 0.27, 0.3, 0.14, 0.1, M.titaniumDark);
    bx(S, x + 0.08, y + 1.35, z - 0.325, 0.06, 0.03, 0.01, M.statusCyan);
  }

  // =============================================================================================
  // Runtime API
  // =============================================================================================
  function setBasePose(newOriginX, newOriginZ, sampler = rawSampleElevY) {
    baseX = newOriginX;
    baseZ = newOriginZ;
    baseY = sampler ? sampler(newOriginX, newOriginZ) : 0;
    group.position.set(baseX, baseY, baseZ);
  }

  function inRect(r, lx, lz, pad = 0) {
    return lx >= r.minX - pad && lx <= r.maxX + pad && lz >= r.minZ - pad && lz <= r.maxZ + pad;
  }

  /** Local deck height (above the pad) at a local point, or null when outside the station. */
  function deckHeightLocal(lx, lz) {
    if (inRect(RECTS.purple, lx, lz, T / 2) && lz < RECTS.purple.maxZ) return DORM_FLOOR;
    for (const d of DORM_DOORS) {
      if (Math.abs(lx - d.x) <= d.w / 2 && lz >= -9 && lz <= -9 + DORM_RAMP_LEN) {
        return DECK + (DORM_RISE * (-9 + DORM_RAMP_LEN - lz)) / DORM_RAMP_LEN;
      }
    }
    for (const key of ["pinkL", "pinkB", "yellow", "red", "green"]) {
      if (inRect(RECTS[key], lx, lz, T / 2)) return DECK;
    }
    if (lz >= BAY_FRONT_Z && lz <= BAY_FRONT_Z + RAMP_LEN) {
      for (const c of BAY_X) {
        if (Math.abs(lx - c) <= RAMP_HALF_W) return DECK * (1 - (lz - BAY_FRONT_Z) / RAMP_LEN);
      }
    }
    const ar = AIRLOCK_RAMP;
    if (lx >= ar.x0 && lx <= ar.x1 && lz >= ar.z0 && lz <= ar.z1) return DECK * (1 - (lx - ar.x0) / (ar.x1 - ar.x0));
    return null;
  }

  /** Terrain only: levelled pad under and around the station, blended back into the raw ground. */
  function sampleTerrainWithHabitat(x, z, rawTerrainY) {
    const lx = x - baseX;
    const lz = z - baseZ;
    const dx = Math.max(0, PAD.minX - lx, lx - PAD.maxX);
    const dz = Math.max(0, PAD.minZ - lz, lz - PAD.maxZ);
    const d = Math.hypot(dx, dz);
    if (d >= PAD_BLEND) return rawTerrainY;
    const t = d / PAD_BLEND;
    const s = t * t * (3 - 2 * t);
    return baseY + (rawTerrainY - baseY) * s;
  }

  /** Deck or ramp world Y at (x, z), or null outside station decks/ramps. */
  function sampleDeckElev(x, z) {
    const deck = deckHeightLocal(x - baseX, z - baseZ);
    return deck == null ? null : baseY + deck;
  }

  /** What a walker or rover stands on: deck, dormitory deck, ramps, or the levelled pad. */
  function sampleElevWithHabitat(x, z, rawTerrainY) {
    const ground = sampleTerrainWithHabitat(x, z, rawTerrainY);
    const deckY = sampleDeckElev(x, z);
    return deckY == null ? ground : Math.max(ground, deckY);
  }

  function zoneAt(x, z) {
    const lx = x - baseX;
    const lz = z - baseZ;
    for (const key of ["purple", "red", "green", "yellow", "pinkL", "pinkB"]) {
      if (inRect(RECTS[key], lx, lz)) return ZONE_OF_RECT[key];
    }
    return null;
  }

  function resolveCollision(entityX, entityZ, entityRadius = 0.42, entityY = null) {
    const relY = entityY != null && Number.isFinite(entityY) ? entityY - baseY : DECK;
    let outX = entityX - baseX;
    let outZ = entityZ - baseZ;
    let anyHit = false;
    let outNx = 0;
    let outNz = 0;
    let maxPen = 0;

    for (const c of colliders) {
      if (!c.walk) continue;
      if (c.dyn && !c.dyn.solid) continue;
      if (relY > c.maxY - 0.1) continue; // standing above it
      if (c.minY > relY + 1.6) continue; // overhead
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

    return { hit: anyHit, x: baseX + outX, z: baseZ + outZ, nx: outNx, nz: outNz, pen: maxPen };
  }

  /**
   * Fraction t in [0, 1] of the segment a -> b (world space) that is free of station walls, roofs
   * and closed doors. Used to pull a 3rd-person camera in front of walls. Boxes that already
   * contain `a` are ignored so standing next to a wall does not collapse the camera.
   */
  function clipCameraSegment(ax, ay, az, bx2, by, bz, pad = 0.18) {
    const o = [ax - baseX, ay - baseY, az - baseZ];
    const dvec = [bx2 - ax, by - ay, bz - az];
    let best = 1;
    for (const c of colliders) {
      if (!c.cam) continue;
      if (c.dyn && !c.dyn.solid) continue;
      const mn = [c.minX - pad, c.minY - pad, c.minZ - pad];
      const mx = [c.maxX + pad, c.maxY + pad, c.maxZ + pad];
      if (o[0] > mn[0] && o[0] < mx[0] && o[1] > mn[1] && o[1] < mx[1] && o[2] > mn[2] && o[2] < mx[2]) continue;
      let t0 = 0;
      let t1 = best;
      let ok = true;
      for (let k = 0; k < 3 && ok; k++) {
        if (Math.abs(dvec[k]) < 1e-9) {
          if (o[k] < mn[k] || o[k] > mx[k]) ok = false;
        } else {
          let ta = (mn[k] - o[k]) / dvec[k];
          let tb = (mx[k] - o[k]) / dvec[k];
          if (ta > tb) [ta, tb] = [tb, ta];
          t0 = Math.max(t0, ta);
          t1 = Math.min(t1, tb);
          if (t0 > t1) ok = false;
        }
      }
      if (ok && t0 < best) best = t0;
    }
    return Math.max(0, Math.min(1, best));
  }

  /** Ceiling height (world Y) over a point inside the station, or null outside. */
  function ceilingAt(x, z) {
    const lx = x - baseX;
    const lz = z - baseZ;
    if (inRect(RECTS.purple, lx, lz)) return baseY + DORM_TOP;
    if (inRect(RECTS.green, lx, lz)) return baseY + GARAGE_TOP;
    for (const key of ["pinkL", "pinkB", "yellow", "red"]) if (inRect(RECTS[key], lx, lz)) return baseY + HUB_TOP;
    return null;
  }

  const approach = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));
  const actorPts = [];

  /**
   * Animate doors, beacons, hologram and crane. `actors` are world {x, z} points (the walker and
   * the driven rover); hangar doors open when one is near, airlock doors open one at a time.
   */
  function update(dt, { actors = [] } = {}) {
    const step = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    clock += step;
    actorPts.length = 0;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      if (a && Number.isFinite(a.x) && Number.isFinite(a.z)) {
        actorPts.push({ x: a.x - baseX, z: a.z - baseZ });
      }
    }
    const p0x = actorPts.length ? actorPts[0].x : 0;
    const p0z = actorPts.length ? actorPts[0].z : 16;
    const farFromHab = Math.hypot(p0x, p0z - 12) > 125;

    for (let i = 0; i < hangarDoors.length; i++) {
      const d = hangarDoors[i];
      let near = false;
      if (!farFromHab) {
        for (let j = 0; j < actorPts.length; j++) {
          if (Math.hypot(actorPts[j].x - d.cx, actorPts[j].z - BAY_FRONT_Z) < HANGAR_OPEN_RADIUS) {
            near = true;
            break;
          }
        }
      }
      const want = near ? 1 : 0;
      const next = approach(d.open, want, step * 0.3);
      if (next !== d.open) {
        d.open = next;
        poseHangarDoor(d);
      }
    }
    let cycling = false;
    for (let i = 0; i < airlockDoors.length; i++) {
      const d = airlockDoors[i];
      let otherOpen = false;
      for (let j = 0; j < airlockDoors.length; j++) {
        if (airlockDoors[j] !== d && airlockDoors[j].open >= 0.02) {
          otherOpen = true;
          break;
        }
      }
      let near = false;
      if (!farFromHab && !otherOpen) {
        for (let j = 0; j < actorPts.length; j++) {
          const p = actorPts[j];
          if (Math.abs(p.x - d.x) < 3.6 && Math.abs(p.z - AIRLOCK_DOOR_Z) < 3.0) {
            near = true;
            break;
          }
        }
      }
      const want = near ? 1 : 0;
      const next = approach(d.open, want, step * 0.75);
      if (next !== d.open) {
        d.open = next;
        poseAirlockDoor(d);
      }
      if (d.open > 0) cycling = true;
    }

    if (airlockLight) airlockLight.intensity = cycling ? 1 + 6 * (0.5 + 0.5 * Math.sin(clock * 9.8)) : 0.8 + 0.6 * (0.5 + 0.5 * Math.sin(clock * 2.24));

    // Bind the 2 pooled hardware PointLights to the 2 virtual emitters nearest the actor.
    if (farFromHab || !virtualLights.length) {
      for (let k = 0; k < pooledPointLights.length; k++) pooledPointLights[k].intensity = 0;
      return;
    }
    let bestIdx0 = -1;
    let bestD0 = Infinity;
    let bestIdx1 = -1;
    let bestD1 = Infinity;
    for (let i = 0; i < virtualLights.length; i++) {
      const vl = virtualLights[i];
      const dx = vl.x - p0x;
      const dz = vl.z - p0z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD0) {
        bestD1 = bestD0;
        bestIdx1 = bestIdx0;
        bestD0 = d2;
        bestIdx0 = i;
      } else if (d2 < bestD1) {
        bestD1 = d2;
        bestIdx1 = i;
      }
    }
    const sel0 = bestIdx0 >= 0 ? virtualLights[bestIdx0] : null;
    const sel1 = bestIdx1 >= 0 ? virtualLights[bestIdx1] : null;
    for (let k = 0; k < 2; k++) {
      const pl = pooledPointLights[k];
      const src = k === 0 ? sel0 : sel1;
      if (!src) {
        pl.intensity = 0;
      } else {
        pooledAnchors[k].position.set(src.x, src.y, src.z);
        pl.intensity = src.intensity;
        pl.distance = src.distance;
        pl.decay = src.decay;
      }
    }

    const rate = cycling ? 7 : 1.6;
    const pulse = 0.5 + 0.5 * Math.sin(clock * rate * 1.4);
    M.beacon.emissiveIntensity = cycling ? 0.8 + 3.0 * pulse : 0.7 + 0.9 * pulse;
    M.amber.emissiveIntensity = 1.2 + 1.2 * pulse;
    M.beamRed.opacity = cycling ? 0.22 : 0.07;
    for (let i = 0; i < beaconBeams.length; i++) beaconBeams[i].rotation.y += step * rate;

    if (holo) {
      holo.rotation.y += step * 0.35;
      holo.position.y = DECK + 1.25 + Math.sin(clock * 1.3) * 0.02;
      M.holo.opacity = 0.6 + 0.2 * Math.sin(clock * 5.0);
    }
    if (craneBridge) {
      craneBridge.position.x = 11 * Math.sin(clock * 0.05);
      craneTrolley.position.z = 15.85 + 3.4 * Math.sin(clock * 0.083 + 1.0);
      const L = 0.45 + 0.12 * Math.sin(clock * 0.21);
      craneCable.scale.y = L;
      craneCable.position.y = DECK + 6.22 - L / 2;
      craneHook.position.y = DECK + 6.22 - L;
    }
  }

  /** True when world (x, z) falls inside the habitat modules, foundation jacks, ramps, or aprons. */
  function isOnFootprint(x, z, pad = 1.5) {
    const lx = x - baseX;
    const lz = z - baseZ;
    for (const key of ["purple", "red", "green", "yellow", "pinkL", "pinkB"]) {
      if (inRect(RECTS[key], lx, lz, pad)) return true;
    }
    if (lx >= -21 - pad && lx <= 21 + pad && lz >= BAY_FRONT_Z && lz <= 46 + pad) return true;
    if (lx >= 31.5 && lx <= 42.1 + pad && lz >= 2.9 - pad && lz <= 11.1 + pad) return true;
    return false;
  }

  function getBayPlacements() {
    const historicPlacements = HISTORIC_BAY_IDS.map((id, idx) => ({
      id,
      spec: getHistoricRoverById(id),
      x: baseX + BAY_X[idx],
      z: baseZ + 15.8,
      yaw: Math.PI, // nose towards +Z, out through the bay door
      slopeDeg: 0,
      bayNumber: idx + 1,
    })).filter((p) => p.spec);

    const drivablePlacements = [
      { vehicleType: "mmsev", x: baseX + BAY_X[1], z: baseZ + 33.0, yaw: Math.PI, bayNumber: 2 },
      { vehicleType: "nasa_concept", x: baseX + BAY_X[3], z: baseZ + 33.0, yaw: Math.PI, bayNumber: 4 },
    ];

    // Stand on the apron looking north at the 5 bays and the 2 drivable rovers.
    const entryPoint = { x: baseX, z: baseZ + ENTRY_OFFSET_Z, yaw: 0 };
    const airlockEntryPoint = { x: baseX + 38.5, z: baseZ + AIRLOCK_DOOR_Z, yaw: Math.PI / 2 };
    return { historicPlacements, drivablePlacements, entryPoint, airlockEntryPoint };
  }

  /** World positions of the Transit Terminal and the return arrival point (inside the Pink Corridor). */
  function getTransitPoints() {
    return {
      terminal: { x: baseX + TRANSIT_TERMINAL.x, z: baseZ + TRANSIT_TERMINAL.z },
      arrival: { x: baseX + TRANSIT_ARRIVAL.x, z: baseZ + TRANSIT_ARRIVAL.z, yaw: TRANSIT_ARRIVAL.yaw },
    };
  }

  /** World positions of all interactive Habitat wall screens (Tasks & Telemetry). */
  function getTaskScreens() {
    return taskScreens.map((t) => ({
      x: baseX + t.localX,
      y: baseY + t.localY,
      z: baseZ + t.localZ,
      localX: t.localX,
      localZ: t.localZ,
      ry: t.ry,
      spec: t.spec,
    }));
  }

  // initial pose of the animated parts
  update(0, { actors: [] });

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
    sampleDeckElev,
    sampleElevWithHabitat,
    sampleTerrainWithHabitat,
    resolveCollision,
    clipCameraSegment,
    ceilingAt,
    zoneAt,
    isOnFootprint,
    update,
    getBayPlacements,
    getTransitPoints,
    getTaskScreens,
    getInteractiveGroup: () => interactiveGroup,
    hangarDoors,
    airlockDoors,
  };
}

export const HABITAT_LAYOUT = Object.freeze({ DECK, DORM_FLOOR, HUB_TOP, GARAGE_TOP, DORM_TOP, RECTS, BAY_X, BAY_FRONT_Z });
