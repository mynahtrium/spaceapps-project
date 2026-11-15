/**
 * Procedural Mars landers, the Ingenuity helicopter, and the site markers used at hardware sites
 * (`web/hud/mars-landers.js`).
 *
 * Each builder returns a THREE.Group in metres with its origin on the ground, sized to the overall
 * dimensions in `shared/mars-hardware.js` (span / deck width / height). They are simplified scale
 * models built from primitives, not NASA CAD: proportions follow the published dimensions, small
 * details are representative.
 */

import { mergeStaticMeshes } from "./merge-static.js";
import { formatHardwareDims, formatHardwareLatLon } from "../shared/mars-hardware.js";

function makeKit(THREE) {
  const std = (p) => new THREE.MeshStandardMaterial(p);
  const M = {
    foil: std({ color: 0xc9a04a, roughness: 0.38, metalness: 1.0 }),
    white: std({ color: 0xe9e7e1, roughness: 0.6, metalness: 0.08 }),
    grey: std({ color: 0x8d949c, roughness: 0.45, metalness: 0.75 }),
    dark: std({ color: 0x22262c, roughness: 0.55, metalness: 0.7 }),
    black: std({ color: 0x101114, roughness: 0.8, metalness: 0.2 }),
    solar: std({ color: 0x16264f, roughness: 0.28, metalness: 0.65 }),
    solarRib: std({ color: 0xb9a26a, roughness: 0.5, metalness: 0.7 }),
    copper: std({ color: 0xb87333, roughness: 0.4, metalness: 0.9 }),
    lens: std({ color: 0x0b1626, roughness: 0.05, metalness: 0.9 }),
    carbon: std({ color: 0x1a1b1e, roughness: 0.5, metalness: 0.3 }),
  };
  const add = (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const box = (parent, w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) =>
    add(parent, new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz);
  const cyl = (parent, r, h, mat, x, y, z, { r2 = r, seg = 16, rx = 0, ry = 0, rz = 0 } = {}) =>
    add(parent, new THREE.CylinderGeometry(r, r2, h, seg), mat, x, y, z, rx, ry, rz);
  /** Thin strut between two points. */
  const strut = (parent, a, b, r, mat) => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const m = add(parent, new THREE.CylinderGeometry(r, r, len, 8), mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    return m;
  };
  const dish = (parent, r, depth, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const rr = (r * i) / 10;
      pts.push(new THREE.Vector2(rr, depth * (rr / r) ** 2));
    }
    const m = add(parent, new THREE.LatheGeometry(pts, 28), mat, x, y, z, rx, ry, rz);
    m.material = mat;
    return m;
  };
  /** Round fan-fold solar array (Phoenix / InSight "UltraFlex"): disc, 10 gore ribs, hub. */
  const roundArray = (parent, r, x, y, z) => {
    cyl(parent, r, 0.025, M.solar, x, y, z, { seg: 10 });
    cyl(parent, r * 1.01, 0.012, M.solarRib, x, y - 0.014, z, { seg: 10 });
    for (let k = 0; k < 5; k++) box(parent, r * 2, 0.03, 0.02, M.solarRib, x, y + 0.004, z, 0, (k * Math.PI) / 5, 0);
    cyl(parent, r * 0.12, 0.05, M.grey, x, y, z, { seg: 12 });
  };
  /** Landing leg: main strut + two side braces + footpad. */
  const leg = (parent, top, foot, padR, braceA, braceB) => {
    strut(parent, top, foot, 0.035, M.grey);
    strut(parent, braceA, foot, 0.02, M.grey);
    strut(parent, braceB, foot, 0.02, M.grey);
    cyl(parent, padR, 0.04, M.grey, foot[0], 0.02, foot[2], { r2: padR * 1.1, seg: 16 });
  };
  return { M, add, box, cyl, strut, dish, roundArray, leg };
}

function finish(THREE, g, name) {
  g.name = name;
  mergeStaticMeshes(THREE, g);
  return g;
}

/** Viking 1 lander: ~3.0 m across the legs, 2.2 m to the top of the dish. */
export function buildViking1(THREE) {
  const g = new THREE.Group();
  const { M, box, cyl, strut, dish, leg, add } = makeKit(THREE);
  const deckY = 0.95;
  // six-sided aluminium body
  cyl(g, 0.86, 0.46, M.white, 0, deckY - 0.23, 0, { seg: 6 });
  cyl(g, 0.88, 0.03, M.grey, 0, deckY, 0, { seg: 6 });
  cyl(g, 0.84, 0.03, M.dark, 0, deckY - 0.47, 0, { seg: 6 });
  // three legs, 120° apart, footpads on a ~1.45 m circle (3 m footprint)
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3 + Math.PI / 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const top = [c * 0.78, deckY - 0.2, s * 0.78];
    const foot = [c * 1.42, 0.04, s * 1.42];
    const pa = [Math.cos(a + 0.6) * 0.8, deckY - 0.42, Math.sin(a + 0.6) * 0.8];
    const pb = [Math.cos(a - 0.6) * 0.8, deckY - 0.42, Math.sin(a - 0.6) * 0.8];
    leg(g, top, foot, 0.16, pa, pb);
  }
  // two RTGs under wind covers, on opposite sides
  for (const sx of [-1, 1]) {
    box(g, 0.5, 0.42, 0.62, M.white, sx * 0.62, deckY + 0.23, -0.35, 0, sx * 0.25, 0);
    box(g, 0.52, 0.03, 0.64, M.grey, sx * 0.62, deckY + 0.45, -0.35, 0, sx * 0.25, 0);
  }
  // propellant tanks and terminal descent engines
  for (const sx of [-1, 1]) {
    add(g, new THREE.SphereGeometry(0.24, 16, 12), M.foil, sx * 0.95, deckY - 0.2, 0.25);
  }
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3 - Math.PI / 6;
    cyl(g, 0.1, 0.16, M.dark, Math.cos(a) * 0.62, deckY - 0.56, Math.sin(a) * 0.62, { r2: 0.14, seg: 14 });
  }
  // S-band high-gain dish on its mast (top at 2.2 m)
  cyl(g, 0.035, 0.95, M.grey, 0.2, deckY + 0.47, -0.45, { seg: 10 });
  dish(g, 0.38, 0.1, M.white, 0.2, 1.94, -0.45, -0.5, 0.4, 0);
  cyl(g, 0.02, 0.2, M.grey, 0.2, 1.98, -0.45, { seg: 6 });
  // two facsimile cameras (cylinders with slits)
  for (const sx of [-0.28, 0.28]) {
    cyl(g, 0.07, 0.52, M.white, sx, deckY + 0.26, 0.5, { seg: 14 });
    box(g, 0.03, 0.2, 0.02, M.lens, sx, deckY + 0.36, 0.57);
  }
  // meteorology boom and UHF antenna
  strut(g, [-0.7, deckY, 0.3], [-1.25, deckY + 0.75, 0.55], 0.02, M.grey);
  box(g, 0.12, 0.06, 0.06, M.white, -1.25, deckY + 0.78, 0.55);
  cyl(g, 0.012, 0.55, M.grey, -0.35, deckY + 0.28, -0.6, { seg: 6 });
  cyl(g, 0.09, 0.02, M.grey, -0.35, deckY + 0.55, -0.6, { seg: 12 });
  // surface sampler: housing, extended boom, scoop
  box(g, 0.22, 0.2, 0.34, M.grey, 0.05, deckY + 0.12, 0.72);
  strut(g, [0.05, deckY + 0.12, 0.85], [0.3, 0.22, 2.0], 0.022, M.grey);
  box(g, 0.1, 0.08, 0.16, M.dark, 0.3, 0.2, 2.04, 0.5, 0, 0);
  // seismometer, GCMS inlet, biology processor
  box(g, 0.16, 0.12, 0.14, M.foil, -0.45, deckY + 0.07, 0.15);
  cyl(g, 0.06, 0.14, M.grey, 0.5, deckY + 0.08, 0.2, { seg: 10 });
  box(g, 0.3, 0.1, 0.24, M.dark, 0.1, deckY + 0.06, 0.1);
  return finish(THREE, g, "viking1Lander");
}

/** Phoenix: 5.5 m across the two round arrays, 1.5 m deck, 2.2 m to the top of the mast. */
export function buildPhoenix(THREE) {
  const g = new THREE.Group();
  const { M, box, cyl, strut, roundArray, leg, add } = makeKit(THREE);
  const deckY = 0.98;
  cyl(g, 0.76, 0.06, M.white, 0, deckY, 0, { seg: 8 });
  cyl(g, 0.6, 0.34, M.foil, 0, deckY - 0.2, 0, { seg: 8 });
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3 + Math.PI / 6;
    const c = Math.cos(a);
    const s = Math.sin(a);
    leg(
      g,
      [c * 0.58, deckY - 0.1, s * 0.58],
      [c * 0.95, 0.04, s * 0.95],
      0.14,
      [Math.cos(a + 0.7) * 0.58, deckY - 0.34, Math.sin(a + 0.7) * 0.58],
      [Math.cos(a - 0.7) * 0.58, deckY - 0.34, Math.sin(a - 0.7) * 0.58]
    );
  }
  // two round arrays: deck 1.5 m + 2 x 2.0 m = 5.5 m span along X
  for (const sx of [-1, 1]) {
    roundArray(g, 1.0, sx * 1.75, deckY + 0.02, 0);
    strut(g, [sx * 0.6, deckY, 0], [sx * 0.8, deckY + 0.02, 0], 0.03, M.grey);
  }
  // thrusters and tanks under the deck
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    cyl(g, 0.05, 0.12, M.dark, Math.cos(a) * 0.45, deckY - 0.44, Math.sin(a) * 0.45, { r2: 0.07, seg: 10 });
  }
  add(g, new THREE.SphereGeometry(0.2, 14, 10), M.foil, 0.2, deckY - 0.28, -0.2);
  add(g, new THREE.SphereGeometry(0.2, 14, 10), M.foil, -0.2, deckY - 0.28, 0.2);
  // SSI camera mast (top at 2.2 m) and MET weather mast
  cyl(g, 0.03, 1.1, M.grey, 0.3, deckY + 0.58, -0.35, { seg: 10 });
  box(g, 0.22, 0.12, 0.14, M.white, 0.3, 2.14, -0.35);
  for (const sx of [-0.06, 0.06]) cyl(g, 0.03, 0.04, M.lens, 0.3 + sx, 2.14, -0.27, { seg: 10, rx: Math.PI / 2 });
  cyl(g, 0.018, 0.95, M.grey, -0.45, deckY + 0.5, -0.3, { seg: 8 });
  for (const y of [0.3, 0.6, 0.9]) box(g, 0.1, 0.02, 0.02, M.white, -0.45, deckY + y, -0.3);
  cyl(g, 0.012, 0.18, M.copper, -0.45, deckY + 1.04, -0.3, { seg: 6 });
  // instrument boxes: TEGA ovens, MECA wet chemistry lab, lidar
  box(g, 0.36, 0.2, 0.26, M.grey, -0.2, deckY + 0.13, 0.25);
  for (let k = 0; k < 4; k++) box(g, 0.07, 0.02, 0.22, M.dark, -0.33 + k * 0.09, deckY + 0.24, 0.25);
  box(g, 0.3, 0.16, 0.24, M.white, 0.28, deckY + 0.11, 0.2);
  cyl(g, 0.07, 0.2, M.dark, 0.0, deckY + 0.13, -0.45, { seg: 12 });
  // UHF helix antenna
  cyl(g, 0.05, 0.28, M.copper, -0.5, deckY + 0.17, 0.05, { seg: 10 });
  // robotic arm reaching the ground, with scoop and arm camera
  strut(g, [0.45, deckY + 0.08, 0.45], [0.75, deckY + 0.55, 1.05], 0.03, M.grey);
  strut(g, [0.75, deckY + 0.55, 1.05], [0.95, 0.2, 1.95], 0.026, M.grey);
  cyl(g, 0.05, 0.1, M.dark, 0.75, deckY + 0.55, 1.05, { seg: 10, rz: Math.PI / 2 });
  box(g, 0.14, 0.1, 0.18, M.dark, 0.95, 0.16, 1.99, 0.5, 0, 0);
  box(g, 0.06, 0.06, 0.08, M.lens, 0.9, 0.34, 1.86);
  return finish(THREE, g, "phoenixLander");
}

/** InSight: 6.0 m across the two round wings, 1.56 m deck, ~1.0 m tall, SEIS dome on the ground. */
export function buildInSight(THREE) {
  const g = new THREE.Group();
  const { M, box, cyl, strut, roundArray, leg, add } = makeKit(THREE);
  const deckY = 0.86;
  cyl(g, 0.79, 0.06, M.white, 0, deckY, 0, { seg: 10 });
  cyl(g, 0.62, 0.3, M.foil, 0, deckY - 0.18, 0, { seg: 10 });
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3 + Math.PI / 6;
    const c = Math.cos(a);
    const s = Math.sin(a);
    leg(
      g,
      [c * 0.6, deckY - 0.1, s * 0.6],
      [c * 0.92, 0.04, s * 0.92],
      0.14,
      [Math.cos(a + 0.7) * 0.6, deckY - 0.3, Math.sin(a + 0.7) * 0.6],
      [Math.cos(a - 0.7) * 0.6, deckY - 0.3, Math.sin(a - 0.7) * 0.6]
    );
  }
  // two round wings: deck 1.56 m + 2 x 2.22 m = 6.0 m span along X
  for (const sx of [-1, 1]) {
    roundArray(g, 1.11, sx * 1.89, deckY + 0.02, 0);
    strut(g, [sx * 0.62, deckY, 0], [sx * 0.8, deckY + 0.02, 0], 0.03, M.grey);
  }
  // deck: UHF helix, two medium-gain horns, pressure inlet, TWINS booms, RISE antennas
  cyl(g, 0.05, 0.14, M.copper, -0.15, deckY + 0.1, -0.4, { seg: 10 });
  for (const sx of [-0.5, 0.5]) cyl(g, 0.07, 0.1, M.grey, sx, deckY + 0.08, -0.35, { r2: 0.04, seg: 12, rx: 0.6 });
  cyl(g, 0.09, 0.06, M.white, 0.2, deckY + 0.06, 0.1, { seg: 14 });
  for (const sx of [-0.6, 0.6]) box(g, 0.04, 0.1, 0.16, M.grey, sx, deckY + 0.08, 0.25, 0, sx * 0.5, 0);
  box(g, 0.34, 0.08, 0.3, M.dark, -0.25, deckY + 0.07, 0.3);
  // instrument deployment arm, reaching towards the instruments on the ground (+Z)
  strut(g, [0.3, deckY + 0.05, 0.5], [0.5, deckY + 0.14, 1.2], 0.028, M.grey);
  strut(g, [0.5, deckY + 0.14, 1.2], [0.42, 0.55, 1.75], 0.024, M.grey);
  cyl(g, 0.045, 0.09, M.dark, 0.5, deckY + 0.14, 1.2, { seg: 10, rz: Math.PI / 2 });
  box(g, 0.08, 0.1, 0.08, M.dark, 0.42, 0.5, 1.77);
  // SEIS under its wind-and-thermal shield dome, with the flat tether back to the lander
  add(g, new THREE.SphereGeometry(0.36, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.white, -0.35, 0.02, 1.75).scale.y = 0.75;
  cyl(g, 0.4, 0.05, M.foil, -0.35, 0.03, 1.75, { r2: 0.46, seg: 22 });
  strut(g, [-0.3, deckY - 0.3, 0.55], [-0.33, 0.03, 1.4], 0.012, M.copper);
  // HP3 heat probe housing
  box(g, 0.3, 0.26, 0.24, M.dark, 0.9, 0.2, 1.6);
  cyl(g, 0.02, 0.4, M.grey, 0.9, 0.3, 1.6, { seg: 8 });
  strut(g, [0.4, deckY - 0.3, 0.55], [0.88, 0.05, 1.45], 0.012, M.copper);
  return finish(THREE, g, "insightLander");
}

/** Ingenuity: 0.14 x 0.20 m fuselage, two 1.2 m coaxial rotors, 0.49 m tall. */
export function buildIngenuity(THREE) {
  const g = new THREE.Group();
  const { M, box, cyl, strut } = makeKit(THREE);
  const bodyY = 0.2;
  box(g, 0.14, 0.16, 0.2, M.foil, 0, bodyY, 0);
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    strut(g, [sx * 0.06, bodyY + 0.06, sz * 0.09], [sx * 0.3, 0.012, sz * 0.3], 0.006, M.carbon);
    cyl(g, 0.018, 0.012, M.dark, sx * 0.3, 0.006, sz * 0.3, { seg: 8 });
  }
  cyl(g, 0.012, 0.21, M.grey, 0, bodyY + 0.185, 0, { seg: 8 });
  box(g, 1.2, 0.008, 0.07, M.carbon, 0, bodyY + 0.16, 0, 0, 0.5, 0.03);
  box(g, 1.2, 0.008, 0.07, M.carbon, 0, bodyY + 0.24, 0, 0, 2.1, -0.03);
  box(g, 0.17, 0.006, 0.09, M.solar, 0, 0.487, 0);
  cyl(g, 0.004, 0.06, M.copper, 0.03, 0.46, 0.05, { seg: 5 });
  box(g, 0.03, 0.02, 0.005, M.lens, 0, bodyY - 0.04, 0.101);
  return finish(THREE, g, "ingenuity");
}

export function buildLanderById(THREE, id) {
  if (id === "viking1") return buildViking1(THREE);
  if (id === "phoenix") return buildPhoenix(THREE);
  if (id === "insight") return buildInSight(THREE);
  return null;
}

// ---------------------------------------------------------------------------------------------
// Site markers
// ---------------------------------------------------------------------------------------------
function infoTexture(THREE, hw, tr) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 640;
  c.height = 360;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(4,14,26,0.92)";
  g.fillRect(0, 0, 640, 360);
  g.strokeStyle = "#22d3ee";
  g.lineWidth = 6;
  g.strokeRect(5, 5, 630, 350);
  g.fillStyle = "#22d3ee";
  g.fillRect(5, 5, 630, 58);
  g.fillStyle = "#03101c";
  g.font = "bold 34px monospace";
  g.textBaseline = "middle";
  g.fillText(hw.name.toUpperCase(), 20, 35);
  g.fillStyle = "#e2e8f0";
  g.font = "24px monospace";
  const rows = [
    `${hw.mission} · ${hw.years}`,
    hw.site,
    formatHardwareLatLon(hw),
    `${tr ? "BOYUT" : "SIZE"}  ${formatHardwareDims(hw)}`,
    `${tr ? "KÜTLE" : "MASS"}  ${hw.massKg.toLocaleString("en-US")} kg`,
  ];
  rows.forEach((r, i) => g.fillText(r, 20, 100 + i * 42));
  g.fillStyle = "#94a3b8";
  g.font = "18px monospace";
  g.fillText(tr ? "[E] / TIKLA BİLGİ · ölçekli model, prosedürel arazi" : "[E] / CLICK FOR INFO · scale model on procedural relief", 20, 326);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Info beacon: a slim pylon with a glowing ring and a data panel facing the staging pad. */
export function buildInfoBeacon(THREE, hw, { tr = false } = {}) {
  const g = new THREE.Group();
  g.name = "infoBeacon";
  g.userData.screenTarget = { kind: "hardwareInfo", hwId: hw.id };
  const glow = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 2.2, roughness: 0.4 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x30353c, roughness: 0.45, metalness: 0.85 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 0.12, 20), metal);
  base.position.y = 0.06;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.5, 12), metal);
  pole.position.y = 0.85;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 8, 28), glow);
  ring.position.y = 1.66;
  ring.rotation.x = Math.PI / 2;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), glow);
  tip.position.y = 1.66;
  for (const m of [base, pole, ring, tip]) {
    m.castShadow = true;
    g.add(m);
  }
  const map = infoTexture(THREE, hw, tr);
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 0.9),
    new THREE.MeshBasicMaterial({ map, color: map ? 0xffffff : 0x0a1a2a, transparent: true, opacity: 0.94, side: THREE.DoubleSide, toneMapped: false })
  );
  panel.position.set(0, 1.25, 0.12);
  g.add(panel);
  const hitCyl = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 0.9, 2.0, 10),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  hitCyl.position.y = 1.0;
  hitCyl.userData.screenTarget = { kind: "hardwareInfo", hwId: hw.id };
  g.add(hitCyl);
  g.userData.ring = ring;
  return g;
}

function labelTexture(THREE, lines, color) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 160;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(4,14,26,0.9)";
  g.fillRect(0, 0, 512, 160);
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.strokeRect(4, 4, 504, 152);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#f8fafc";
  g.font = "bold 38px monospace";
  g.fillText(lines[0], 256, 56);
  g.fillStyle = color;
  g.font = "bold 26px monospace";
  g.fillText(lines[1] || "", 256, 112);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Staging pad (4 m disc) with the glowing recall transponder in its centre. */
export function buildReturnPad(THREE, { tr = false } = {}) {
  const g = new THREE.Group();
  g.name = "returnPad";
  g.userData.screenTarget = { kind: "returnPad" };
  const glow = new THREE.MeshStandardMaterial({ color: 0x34d399, emissive: 0x34d399, emissiveIntensity: 2.4, roughness: 0.4 });
  const plate = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.6, metalness: 0.7 });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.1, 0.08, 40), plate);
  pad.position.y = 0.04;
  pad.receiveShadow = true;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.04, 8, 56), glow);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.09;
  const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.1, 14), plate);
  pylon.position.set(0, 0.63, -1.2);
  pylon.castShadow = true;
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 8, 32), glow);
  halo.position.set(0, 1.35, -1.2);
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.13), glow);
  core.position.set(0, 1.35, -1.2);
  g.add(pad, rim, pylon, halo, core);
  const map = labelTexture(THREE, tr ? ["ÜSSE DÖNÜŞ", "[E] / [H] / TIKLA"] : ["RETURN TO HABITAT", "[E] / [H] / CLICK"], "#34d399");
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 0.47),
    new THREE.MeshBasicMaterial({ map, color: map ? 0xffffff : 0x0a1a2a, transparent: true, side: THREE.DoubleSide, toneMapped: false })
  );
  sign.position.set(0, 1.95, -1.2);
  g.add(sign);
  const hitCyl = new THREE.Mesh(
    new THREE.CylinderGeometry(0.95, 0.95, 2.3, 10),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  hitCyl.position.set(0, 1.15, -1.2);
  hitCyl.userData.screenTarget = { kind: "returnPad" };
  g.add(hitCyl);
  g.userData.halo = halo;
  g.userData.core = core;
  return g;
}
