/**
 * NASA Historic Mars Rovers 3D Assembly, Hierarchical Rig & Placement Manager (`web/hud/historic-rovers.js`).
 *
 * Builds and rigs ALL 5 iconic NASA Mars rovers in order — Curiosity, Sojourner,
 * Spirit, Opportunity, and Perseverance — with unified kinematic rigs (`userData.rig`):
 *  - Curiosity: ribbed white/cream MSL hull, orange/black cable harness, ChemCam/Mastcam
 *    head + REMS booms, extended L-pose 5-DOF drill/turret arm, tilted gold MMRTG, UHF truss,
 *    hollow S-spoked chevron titanium wheels on rocker-bogie suspension.
 *  - Sojourner: gold Kapton WEB, notched dark-blue Pathfinder solar deck + MAE quartz disc,
 *    rear-left UHF whip, front stereo camera bar, articulated rear APXS fork, 6 cleated wheels.
 *  - Spirit & Opportunity (MER-A / MER-B): swept butterfly solar wings with perimeter frames,
 *    Kapton WEB with NASA meatball plates, Pancam/Navcam mast, gimbaled HGA dish + LGA mast,
 *    articulated 3-joint IDD turret arm, 6 spiral-spoked cleated rocker-bogie wheels.
 *  - Perseverance: golden-tan Mars 2020 hull, SuperCam/Mastcam-Z mast + MEDA booms, heavy
 *    5-DOF SHERLOC/PIXL coring-drill arm, 48-cleat tall titanium wheels, plus node-bound
 *    rigging when NASA's official 68-mesh `mars-2020-perseverance.glb` finishes loading.
 */

import { resolveRoverObbCollision } from "./experimental-rover.js";
import { collectRigNodes, mergeRigidParts, mergeStaticMeshes } from "./merge-static.js";

function createCanvasTex(THREE, w, h, drawFn, { linear = false } = {}) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  drawFn(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeSharedTextures(THREE) {
  const solarTex = createCanvasTex(THREE, 256, 256, (g, w, h) => {
    g.fillStyle = "#09162e";
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) {
      for (let x = 0; x < w; x += 24) {
        g.fillStyle = (x + y) % 48 === 0 ? "#132c52" : "#0d203e";
        g.fillRect(x + 2, y + 2, 20, 28);
      }
    }
    g.strokeStyle = "#487bc2";
    g.lineWidth = 1.5;
    for (let x = 0; x <= w; x += 24) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    for (let y = 0; y <= h; y += 32) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    g.strokeStyle = "#d9b664";
    g.lineWidth = 1.4;
    for (let y = 16; y < h; y += 32) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
  });

  const kaptonTex = createCanvasTex(THREE, 256, 256, (g, w, h) => {
    g.fillStyle = "#b37829";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 340; i++) {
      const x = (i * 47 + Math.floor(i / 7) * 19) % w;
      const y = (i * 83 + Math.floor(i / 5) * 11) % h;
      const rw = 6 + (i % 22);
      const rh = 3 + ((i * 3) % 14);
      g.fillStyle =
        i % 3 === 0
          ? "rgba(250, 202, 92, 0.4)"
          : i % 3 === 1
            ? "rgba(82, 44, 12, 0.34)"
            : "rgba(205, 140, 44, 0.28)";
      g.fillRect(x, y, rw, rh);
    }
  });

  const kaptonBumpTex = createCanvasTex(
    THREE,
    256,
    256,
    (g, w, h) => {
      g.fillStyle = "#808080";
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 420; i++) {
        const x1 = (i * 53) % w;
        const y1 = (i * 97) % h;
        const x2 = x1 + ((i % 2 === 0 ? 1 : -1) * (10 + (i % 18)));
        const y2 = y1 + (4 + (i % 14));
        g.strokeStyle = i % 2 === 0 ? "#d8d8d8" : "#363636";
        g.lineWidth = 1.5 + (i % 2);
        g.beginPath();
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        g.stroke();
      }
    },
    { linear: true }
  );

  const mslBodyTex = createCanvasTex(THREE, 512, 256, (g, w, h) => {
    g.fillStyle = "#eae4d8";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#8c8478";
    g.lineWidth = 3;
    g.strokeRect(8, 8, w - 16, h - 16);

    // Structural panel ribs & thermal radiator vertical fins
    g.strokeStyle = "#bab2a4";
    g.lineWidth = 2;
    for (const xFrac of [0.22, 0.42, 0.68, 0.84]) {
      g.beginPath();
      g.moveTo(w * xFrac, 10);
      g.lineTo(w * xFrac, h - 10);
      g.stroke();
    }

    // Recessed dark avionics louver grille
    g.fillStyle = "#1f242c";
    g.fillRect(28, 32, 148, 34);
    g.strokeStyle = "#525b69";
    g.lineWidth = 2;
    for (let lx = 36; lx < 170; lx += 11) {
      g.beginPath();
      g.moveTo(lx, 34);
      g.lineTo(lx, 64);
      g.stroke();
    }

    // Braided orange & obsidian wiring harness sweep (Curiosity iconic side silhouette)
    g.lineCap = "round";
    g.strokeStyle = "#d97706";
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(22, 118);
    g.bezierCurveTo(150, 86, 310, 158, 490, 110);
    g.stroke();
    g.strokeStyle = "#18181b";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(22, 128);
    g.bezierCurveTo(150, 96, 310, 168, 490, 120);
    g.stroke();

    // Gold circular thermal ports & JPL red-blue livery block
    for (const px of [242, 284, 332]) {
      g.fillStyle = "#b57c2c";
      g.beginPath();
      g.arc(px, 68, 12, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#475569";
      g.lineWidth = 2;
      g.stroke();
    }
    g.fillStyle = "#b91c1c";
    g.fillRect(28, 186, 74, 24);
    g.fillStyle = "#ffffff";
    g.font = "bold 16px ui-monospace, SFMono-Regular, Menlo, monospace";
    g.fillText("JPL", 46, 204);
    g.fillStyle = "#1d4ed8";
    g.beginPath();
    g.arc(134, 198, 16, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#ef4444";
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(114, 204);
    g.lineTo(156, 191);
    g.stroke();
  });

  const perseveranceBodyTex = createCanvasTex(THREE, 512, 256, (g, w, h) => {
    g.fillStyle = "#dfc6a0";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#8a704c";
    g.lineWidth = 3;
    g.strokeRect(8, 8, w - 16, h - 16);

    // Golden-tan thermal shroud panels & dark sensor brackets
    g.fillStyle = "#c8a472";
    g.fillRect(20, 20, 160, 74);
    g.strokeStyle = "#7a6140";
    g.lineWidth = 2;
    g.strokeRect(20, 20, 160, 74);

    g.fillStyle = "#1c1f26";
    g.fillRect(210, 28, 140, 44);
    for (let lx = 220; lx < 344; lx += 14) {
      g.strokeStyle = "#525866";
      g.beginPath();
      g.moveTo(lx, 32);
      g.lineTo(lx, 68);
      g.stroke();
    }

    // Braided gold/black umbilical harness
    g.lineCap = "round";
    g.strokeStyle = "#b47b2b";
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(24, 134);
    g.bezierCurveTo(160, 102, 320, 166, 488, 124);
    g.stroke();
    g.strokeStyle = "#18181b";
    g.lineWidth = 3.5;
    g.beginPath();
    g.moveTo(24, 144);
    g.bezierCurveTo(160, 112, 320, 176, 488, 134);
    g.stroke();

    // Nameplate & NASA emblem
    g.fillStyle = "#111827";
    g.fillRect(26, 184, 152, 26);
    g.fillStyle = "#f8fafc";
    g.font = "bold 14px ui-monospace, SFMono-Regular, Menlo, monospace";
    g.fillText("PERSEVERANCE", 36, 202);
  });

  const merEmblemTex = createCanvasTex(THREE, 256, 128, (g, w, h) => {
    g.fillStyle = "#9f6922";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 64; i++) {
      g.fillStyle = i % 2 === 0 ? "rgba(245, 195, 86, 0.25)" : "rgba(62, 34, 10, 0.25)";
      g.fillRect((i * 37) % w, (i * 53) % h, 18, 10);
    }
    g.fillStyle = "#f1ece2";
    g.fillRect(72, 16, 112, 96);
    g.fillStyle = "#1d4ed8";
    g.beginPath();
    g.arc(128, 64, 34, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#dc2626";
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(92, 74);
    g.quadraticCurveTo(128, 36, 168, 56);
    g.stroke();
    g.fillStyle = "#ffffff";
    g.font = "bold 20px sans-serif";
    g.fillText("NASA", 99, 71);
  });

  const chevronTireTex = createCanvasTex(THREE, 256, 128, (g, w, h) => {
    g.fillStyle = "#2b2f36";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#8d5034"; // Martian ferric dust packed along rims
    g.fillRect(0, 0, w, h * 0.14);
    g.fillRect(0, h * 0.86, w, h * 0.14);
    // Curiosity zigzag chevron grousers + small rectangular perforation dots
    g.strokeStyle = "#c0c6d0";
    g.lineWidth = 5;
    for (let x = -32; x < w + 32; x += 22) {
      g.beginPath();
      g.moveTo(x, 12);
      g.lineTo(x + 12, h / 2);
      g.lineTo(x, h - 12);
      g.stroke();
      g.fillStyle = "#15181c";
      g.fillRect(x + 14, h * 0.34, 4, 8);
      g.fillRect(x + 14, h * 0.6, 4, 8);
    }
  });
  if (chevronTireTex) {
    chevronTireTex.wrapS = THREE.RepeatWrapping;
    chevronTireTex.repeat.set(3, 1);
  }

  const perseveranceTireTex = createCanvasTex(THREE, 256, 128, (g, w, h) => {
    g.fillStyle = "#1f232a";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#87533b";
    g.fillRect(0, 0, w, h * 0.11);
    g.fillRect(0, h * 0.89, w, h * 0.11);
    // Mars 2020 48 gentle wavy cleats (no Morse perforations)
    g.strokeStyle = "#d0d5dd";
    g.lineWidth = 3.5;
    for (let x = -16; x < w + 16; x += 14) {
      g.beginPath();
      g.moveTo(x, 10);
      g.quadraticCurveTo(x + 5, h * 0.5, x, h - 10);
      g.stroke();
    }
  });
  if (perseveranceTireTex) {
    perseveranceTireTex.wrapS = THREE.RepeatWrapping;
    perseveranceTireTex.repeat.set(3, 1);
  }

  return {
    solarTex,
    kaptonTex,
    kaptonBumpTex,
    mslBodyTex,
    perseveranceBodyTex,
    merEmblemTex,
    chevronTireTex,
    perseveranceTireTex,
  };
}

function makeRoverPlaqueSprite(THREE, rover) {
  const tex = createCanvasTex(THREE, 384, 96, (g, w, h) => {
    g.fillStyle = "rgba(8, 10, 14, 0.88)";
    g.fillRect(4, 10, w - 8, h - 20);
    g.strokeStyle = rover.color || "#ffffff";
    g.lineWidth = 3;
    g.strokeRect(4, 10, w - 8, h - 20);
    g.fillStyle = rover.color || "#ffffff";
    g.fillRect(14, 24, 10, 48);
    g.fillStyle = "#f8fafc";
    g.font = "bold 28px ui-monospace, SFMono-Regular, Menlo, monospace";
    g.fillText(rover.name.toUpperCase(), 34, 48);
    g.fillStyle = "#cbd5e1";
    g.font = "16px ui-monospace, SFMono-Regular, Menlo, monospace";
    g.fillText(`${rover.mission} · CLICK FOR INFO`, 34, 72);
  });
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(rover.lengthM < 1 ? 1.2 : 1.95, rover.lengthM < 1 ? 0.3 : 0.49, 1);
  sp.position.set(0, rover.heightM + (rover.lengthM < 1 ? 0.42 : 0.62), 0);
  sp.userData.isPlaque = true;
  return sp;
}

/**
 * Open-spoked hollow rover wheel matching NASA Curiosity/MER/Perseverance titanium spring wheels:
 * thin cylindrical drum (open ended so daylight shows through!), outer beadlock rings,
 * S-curved or spiral inner flex-spokes, machined central drive hub, and outer tread cleats.
 */
function buildHollowSpokedWheel(THREE, radius, width, tireMat, hubMat, optsOrSpokes = 6, legacyCleatCount = 12) {
  const opts =
    typeof optsOrSpokes === "object" && optsOrSpokes !== null
      ? optsOrSpokes
      : { spokes: optsOrSpokes, cleatCount: legacyCleatCount, curvedSpokes: true };
  const spokes = opts.spokes ?? 6;
  const cleatCount = opts.cleatCount ?? 12;
  const curvedSpokes = opts.curvedSpokes !== false;
  const dustRingColor = opts.dustRingColor || null;

  const wg = new THREE.Group();

  const shellMat = tireMat.clone();
  shellMat.side = THREE.DoubleSide;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 24, 1, true), shellMat);
  drum.rotation.z = Math.PI / 2;
  wg.add(drum);

  // Machined inner hub cylinder + end-cap drive flange
  const hubCollar = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.27, radius * 0.27, width * 0.9, 14),
    hubMat
  );
  hubCollar.rotation.z = Math.PI / 2;
  wg.add(hubCollar);

  // Outer machined rim flanges (open beadlock rings)
  const flangeGeom = new THREE.TorusGeometry(radius * 0.95, Math.max(0.006, radius * 0.052), 8, 22);
  flangeGeom.rotateY(Math.PI / 2);
  const flangeMat = dustRingColor
    ? new THREE.MeshStandardMaterial({ color: dustRingColor, roughness: 0.7, metalness: 0.45 })
    : hubMat;
  for (const sx of [-width * 0.46, width * 0.46]) {
    const ring = new THREE.Mesh(flangeGeom, flangeMat);
    ring.position.x = sx;
    wg.add(ring);
  }

  // Curved S-shaped titanium flex-spokes visible inside the hollow drum
  const spokeThick = Math.max(0.008, radius * 0.075);
  const segLen = radius * 0.4;
  const spokeSegGeom = new THREE.BoxGeometry(width * 0.13, segLen, spokeThick);
  for (let i = 0; i < spokes; i++) {
    const ang = (i / spokes) * Math.PI * 2;
    const spokePivot = new THREE.Group();
    spokePivot.position.x = width * 0.12;
    spokePivot.rotation.x = ang;

    const innerSeg = new THREE.Mesh(spokeSegGeom, hubMat);
    innerSeg.position.set(0, radius * 0.39, curvedSpokes ? radius * 0.06 : 0);
    innerSeg.rotation.x = curvedSpokes ? 0.42 : 0.25;
    spokePivot.add(innerSeg);

    const outerSeg = new THREE.Mesh(spokeSegGeom, hubMat);
    outerSeg.position.set(0, radius * 0.72, curvedSpokes ? -radius * 0.05 : radius * 0.06);
    outerSeg.rotation.x = curvedSpokes ? -0.38 : 0.25;
    spokePivot.add(outerSeg);

    wg.add(spokePivot);
  }

  // Outer circumferential cleats for close-up crisp silhouette
  const cleatGeom = new THREE.BoxGeometry(
    width * 0.9,
    Math.max(0.005, radius * 0.042),
    Math.max(0.009, radius * 0.095)
  );
  for (let c = 0; c < cleatCount; c++) {
    const a = (c / cleatCount) * Math.PI * 2;
    const cl = new THREE.Mesh(cleatGeom, hubMat);
    cl.position.set(0, Math.cos(a) * radius, Math.sin(a) * radius);
    cl.rotation.x = -a;
    wg.add(cl);
  }

  return wg;
}

function captureRigRestPose(rig) {
  return {
    mastYawY: rig.mastYaw?.rotation.y ?? 0,
    mastPitchX: rig.mastPitch?.rotation.x ?? 0,
    hgaYawY: rig.hgaYaw?.rotation.y ?? 0,
    hgaPitchX: rig.hgaPitch?.rotation.x ?? 0,
    shoulderYawY: rig.arm?.shoulderYaw?.rotation.y ?? 0,
    shoulderPitchX: rig.arm?.shoulderPitch?.rotation.x ?? 0,
    elbowPitchX: rig.arm?.elbowPitch?.rotation.x ?? 0,
    wristPitchX: rig.arm?.wristPitch?.rotation.x ?? 0,
    turretRollZ: rig.arm?.turretRoll?.rotation.z ?? 0,
  };
}

/**
 * Helper to create a wheel mounted inside a corner steering knuckle (or fixed mid mount)
 * inside a suspension group, registering spin & steering pivots cleanly.
 */
function attachWheelAssembly(
  THREE,
  parentGroup,
  { side, slot, lx, ly, lz, worldX, worldZ, radius, width, tireMat, hubMat, wheelOpts, steerable, wheelsOut, knucklesOut }
) {
  let mount = parentGroup;
  if (steerable) {
    const knuckle = new THREE.Group();
    knuckle.name = `steer-${side < 0 ? "L" : "R"}-${slot}`;
    knuckle.position.set(lx, ly, lz);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.16, radius * 0.17, radius * 0.85, 10), hubMat);
    strut.position.y = radius * 0.82;
    knuckle.add(strut);
    const forkArm = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.18, radius * 0.22, radius * 0.56),
      hubMat
    );
    forkArm.position.set(-side * (width * 0.22), radius * 0.36, 0);
    knuckle.add(forkArm);
    parentGroup.add(knuckle);
    knucklesOut.push(knuckle);
    mount = knuckle;
  }

  const spinPivot = buildHollowSpokedWheel(THREE, radius, width, tireMat, hubMat, wheelOpts);
  spinPivot.name = `wheel-${side < 0 ? "L" : "R"}-${slot}`;
  spinPivot.position.set(steerable ? 0 : lx, steerable ? 0 : ly, steerable ? 0 : lz);
  spinPivot.userData.wheelMeta = { side, slot, lx: worldX, lz: worldZ, radius };
  mount.add(spinPivot);
  wheelsOut.push(spinPivot);
  return spinPivot;
}

/**
 * 1. NASA Mars Science Laboratory — CURIOSITY
 * Matches reference image: cream/white ribbed chassis with braided orange/black harness,
 * tall ChemCam/Mastcam mast with twin REMS wind booms, rear tilted gold-finned MMRTG,
 * rear-left UHF antenna truss, extended L-pose 5-DOF drill/turret arm, and 6 S-spoked chevron wheels.
 */
function buildCuriosityMesh(THREE, tex) {
  const root = new THREE.Group();
  const chassisGroup = new THREE.Group();
  chassisGroup.name = "curiosity-chassis";
  root.add(chassisGroup);

  const bodyMat = new THREE.MeshStandardMaterial({ map: tex.mslBodyTex, roughness: 0.4, metalness: 0.22 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d5, roughness: 0.42, metalness: 0.18 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x171a20, roughness: 0.48, metalness: 0.76 });
  const tiMat = new THREE.MeshStandardMaterial({ color: 0xa6adb8, roughness: 0.34, metalness: 0.88 });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xcf9434,
    map: tex.kaptonTex,
    bumpMap: tex.kaptonBumpTex,
    bumpScale: 0.015,
    roughness: 0.32,
    metalness: 0.8,
  });
  const lensMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0c4a6e,
    emissiveIntensity: 0.55,
    roughness: 0.1,
    metalness: 0.9,
  });
  const tireMat = new THREE.MeshStandardMaterial({
    map: tex.chevronTireTex,
    roughness: 0.76,
    metalness: 0.46,
  });

  // Main MSL chassis + lower aluminum belly tub + top deck + differential cross-bar
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.62, 1.94), bodyMat);
  chassis.position.set(0, 0.84, 0.04);
  chassisGroup.add(chassis);
  const bellyPlate = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.08, 1.72), darkMetal);
  bellyPlate.position.set(0, 0.5, 0.04);
  chassisGroup.add(bellyPlate);
  const topTrim = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.06, 1.78), whiteMat);
  topTrim.position.set(0, 1.16, 0.04);
  chassisGroup.add(topTrim);

  // Differential pivot tube across deck
  const diffBar = new THREE.Group();
  diffBar.position.set(0, 1.24, -0.04);
  const diffCrossTube = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 1.42, 12), darkMetal);
  diffCrossTube.rotation.z = Math.PI / 2;
  diffBar.add(diffCrossTube);
  const diffCenterBoss = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.14, 12), tiMat);
  diffBar.add(diffCenterBoss);
  chassisGroup.add(diffBar);

  // Gimbaled hexagonal white High-Gain Antenna dish (hgaYaw -> hgaPitch)
  const hgaYaw = new THREE.Group();
  hgaYaw.position.set(-0.24, 1.26, 0.52);
  const hgaPedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.045, 0.14, 10), darkMetal);
  hgaPedestal.position.y = 0.05;
  hgaYaw.add(hgaPedestal);
  const hgaPitch = new THREE.Group();
  hgaPitch.position.set(0, 0.11, 0);
  hgaPitch.rotation.set(0.42, 0, 0);
  const hgaDeck = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.25, 0.03, 6), whiteMat);
  hgaPitch.add(hgaDeck);
  const hgaFeed = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.15, 8), darkMetal);
  hgaFeed.position.y = 0.08;
  hgaPitch.add(hgaFeed);
  hgaYaw.add(hgaPitch);
  chassisGroup.add(hgaYaw);

  // Rear tilted Pu-238 MMRTG + 8 finned cooling manifolds + heat tubes
  const rtgGroup = new THREE.Group();
  rtgGroup.position.set(0, 0.96, 1.14);
  rtgGroup.rotation.x = -0.58;
  const rtgCore = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.205, 0.66, 16), goldMat);
  rtgCore.rotation.x = Math.PI / 2;
  rtgGroup.add(rtgCore);
  for (let i = 0; i < 8; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 0.6), whiteMat);
    fin.rotation.z = (i * Math.PI) / 4;
    rtgGroup.add(fin);
  }
  const rtgCap = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.08, 14), darkMetal);
  rtgCap.rotation.x = Math.PI / 2;
  rtgCap.position.set(0, 0, 0.35);
  rtgGroup.add(rtgCap);
  chassisGroup.add(rtgGroup);

  // Rear-left black cylindrical UHF antenna on open 4-strut truss (matches Curiosity ref photo)
  const uhfTruss = new THREE.Group();
  uhfTruss.position.set(0.32, 1.24, 0.8);
  for (const sx of [-0.055, 0.055]) {
    for (const sz of [-0.055, 0.055]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.22, 6), darkMetal);
      leg.position.set(sx, 0.1, sz);
      uhfTruss.add(leg);
    }
  }
  const uhfCan = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.26, 14), darkMetal);
  uhfCan.position.y = 0.32;
  uhfTruss.add(uhfCan);
  chassisGroup.add(uhfTruss);

  // Front & rear stereo Hazcams
  for (const sz of [-0.94, 1.01]) {
    for (const sx of [-0.34, -0.24, 0.24, 0.34]) {
      const haz = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.048, 0.04), darkMetal);
      haz.position.set(sx, 0.68, sz);
      chassisGroup.add(haz);
    }
  }

  // Articulated Remote Sensing Mast (mastYaw -> mastPitch) + REMS wind booms + ChemCam/Mastcam/Navcam head
  const mastYaw = new THREE.Group();
  mastYaw.position.set(0.24, 1.19, -0.56);
  const mastCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.11, 0.14, 14), darkMetal);
  mastCollar.position.y = 0.06;
  mastYaw.add(mastCollar);
  const mastShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.08, 0.94, 16), whiteMat);
  mastShaft.position.y = 0.48;
  mastYaw.add(mastShaft);
  const mastAzRing = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.092, 0.075, 14), goldMat);
  mastAzRing.position.y = 0.78;
  mastYaw.add(mastAzRing);
  // Twin black REMS horizontal wind sensor booms mid-mast
  for (const dir of [-1, 1]) {
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.24, 8), darkMetal);
    boom.rotation.z = Math.PI / 2;
    boom.position.set(dir * 0.14, 0.54, 0);
    mastYaw.add(boom);
  }

  const mastPitch = new THREE.Group();
  mastPitch.position.set(0, 0.96, 0);
  const headBox = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.34), whiteMat);
  mastPitch.add(headBox);
  const chemBezel = new THREE.Mesh(new THREE.CylinderGeometry(0.074, 0.074, 0.06, 18), darkMetal);
  chemBezel.rotation.x = Math.PI / 2;
  chemBezel.position.set(-0.1, 0.02, -0.18);
  mastPitch.add(chemBezel);
  const chemGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.054, 0.068, 18), lensMat);
  chemGlass.rotation.x = Math.PI / 2;
  chemGlass.position.set(-0.1, 0.02, -0.185);
  mastPitch.add(chemGlass);
  for (const lx of [0.06, 0.14]) {
    const mc = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.055, 0.06), darkMetal);
    mc.position.set(lx, -0.04, -0.18);
    mastPitch.add(mc);
    const mcLens = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.07, 10), lensMat);
    mcLens.rotation.x = Math.PI / 2;
    mcLens.position.set(lx, -0.04, -0.185);
    mastPitch.add(mcLens);
  }
  const navBar = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.09), darkMetal);
  navBar.position.set(0, -0.15, -0.12);
  mastPitch.add(navBar);
  mastYaw.add(mastPitch);
  chassisGroup.add(mastYaw);

  // Hierarchical 5-DOF Robotic Sample Arm (extended L-pose matching Curiosity reference image)
  const shoulderYaw = new THREE.Group();
  shoulderYaw.position.set(-0.22, 0.72, -0.98);
  const armShoulder = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.24), darkMetal);
  shoulderYaw.add(armShoulder);

  const shoulderPitch = new THREE.Group();
  shoulderPitch.position.set(0, -0.03, -0.06);
  const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.78, 12), tiMat);
  upperArm.rotation.x = Math.PI / 2;
  upperArm.position.set(0, 0, -0.38);
  shoulderPitch.add(upperArm);

  const elbowPitch = new THREE.Group();
  elbowPitch.position.set(0, 0, -0.76);
  const elbowJoint = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.14, 14), darkMetal);
  elbowJoint.rotation.z = Math.PI / 2;
  elbowPitch.add(elbowJoint);
  const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.68, 12), whiteMat);
  forearm.position.set(0, 0.34, 0);
  elbowPitch.add(forearm);

  const wristPitch = new THREE.Group();
  wristPitch.position.set(0, 0.68, 0);
  const turretRoll = new THREE.Group();
  const turret = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.34), darkMetal);
  turretRoll.add(turret);
  const turretGold = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.18, 12), goldMat);
  turretGold.rotation.z = Math.PI / 2;
  turretGold.position.set(0.18, 0, 0);
  turretRoll.add(turretGold);
  const toolSpin = new THREE.Group();
  toolSpin.position.set(0, 0.02, -0.2);
  const drillNose = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.022, 0.22, 12), tiMat);
  drillNose.rotation.x = Math.PI / 2;
  toolSpin.add(drillNose);
  turretRoll.add(toolSpin);

  wristPitch.add(turretRoll);
  elbowPitch.add(wristPitch);
  shoulderPitch.add(elbowPitch);
  shoulderYaw.add(shoulderPitch);
  chassisGroup.add(shoulderYaw);

  // Articulated Rocker-Bogie Suspension (rockerL/R -> bogieL/R -> steerKnuckles -> 6 wheels)
  const wheelR = 0.255;
  const wheelW = 0.39;
  const wheels = [];
  const steerKnuckles = [];
  const rockers = {};
  const bogies = {};
  const wheelOpts = { spokes: 6, cleatCount: 16, curvedSpokes: true };

  for (const side of [-1, 1]) {
    const key = side < 0 ? "L" : "R";
    const wx = side * 1.19;

    const rocker = new THREE.Group();
    rocker.name = `curiosity-rocker-${key}`;
    rocker.position.set(side * 0.72, 0.92, 0.02);
    const pivotHub = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.16, 12), tiMat);
    pivotHub.rotation.z = Math.PI / 2;
    rocker.add(pivotHub);

    // Front rocker tube to front wheel knuckle (world Z = -1.06 -> local Z = -1.08)
    const frontTube = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 1.24, 10), darkMetal);
    frontTube.position.set(side * 0.22, -0.18, -0.52);
    frontTube.rotation.x = 0.98;
    frontTube.rotation.z = side * 0.22;
    rocker.add(frontTube);

    attachWheelAssembly(THREE, rocker, {
      side,
      slot: "front",
      lx: wx - side * 0.72,
      ly: wheelR - 0.92,
      lz: -1.08,
      worldX: wx,
      worldZ: -1.06,
      radius: wheelR,
      width: wheelW,
      tireMat,
      hubMat: tiMat,
      wheelOpts,
      steerable: true,
      wheelsOut: wheels,
      knucklesOut: steerKnuckles,
    });

    // Rear bogie sub-frame pivoted off the aft rocker arm
    const rearArm = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.74, 10), darkMetal);
    rearArm.position.set(side * 0.2, -0.21, 0.28);
    rearArm.rotation.x = 1.05;
    rearArm.rotation.z = side * 0.22;
    rocker.add(rearArm);

    const bogie = new THREE.Group();
    bogie.name = `curiosity-bogie-${key}`;
    bogie.position.set(side * 0.32, -0.39, 0.56);
    const bogieCross = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 1.08, 10), darkMetal);
    bogieCross.position.set(side * 0.04, 0, 0);
    bogieCross.rotation.x = 1.48;
    bogie.add(bogieCross);

    // Mid wheel (world Z = 0.08 -> local Z = -0.50 relative to bogie)
    attachWheelAssembly(THREE, bogie, {
      side,
      slot: "mid",
      lx: wx - side * 1.04,
      ly: wheelR - 0.53,
      lz: -0.5,
      worldX: wx,
      worldZ: 0.08,
      radius: wheelR,
      width: wheelW,
      tireMat,
      hubMat: tiMat,
      wheelOpts,
      steerable: false,
      wheelsOut: wheels,
      knucklesOut: steerKnuckles,
    });

    // Rear wheel (world Z = 1.09 -> local Z = +0.51 relative to bogie)
    attachWheelAssembly(THREE, bogie, {
      side,
      slot: "rear",
      lx: wx - side * 1.04,
      ly: wheelR - 0.53,
      lz: 0.51,
      worldX: wx,
      worldZ: 1.09,
      radius: wheelR,
      width: wheelW,
      tireMat,
      hubMat: tiMat,
      wheelOpts,
      steerable: true,
      wheelsOut: wheels,
      knucklesOut: steerKnuckles,
    });

    rocker.add(bogie);
    root.add(rocker);
    rockers[key] = rocker;
    bogies[key] = bogie;
  }

  const rig = {
    kind: "curiosity",
    chassis: chassisGroup,
    rockerL: rockers.L,
    rockerR: rockers.R,
    bogieL: bogies.L,
    bogieR: bogies.R,
    diffBar,
    wheels,
    steerKnuckles,
    mastYaw,
    mastPitch,
    hgaYaw,
    hgaPitch,
    arm: { shoulderYaw, shoulderPitch, elbowPitch, wristPitch, turretRoll, toolSpin },
  };
  rig.restPose = captureRigRestPose(rig);
  root.userData.rig = rig;
  return root;
}

/**
 * 2. NASA Mars Pathfinder — SOJOURNER
 * Matches reference image: gold Kapton WEB with silver rails, flat dark-blue solar panel deck
 * with stepped/notched silver-white perimeter frame + MAE quartz disc, tall rear-left UHF whip,
 * front stereo monochrome camera bar, rear articulated APXS drum, and 6 cleated aluminum wheels.
 */
function buildSojournerMesh(THREE, tex) {
  const root = new THREE.Group();
  const chassisGroup = new THREE.Group();
  chassisGroup.name = "sojourner-chassis";
  root.add(chassisGroup);

  const kaptonMat = new THREE.MeshStandardMaterial({
    color: 0xd99b38,
    map: tex.kaptonTex,
    bumpMap: tex.kaptonBumpTex,
    bumpScale: 0.012,
    roughness: 0.32,
    metalness: 0.78,
  });
  const solarMat = new THREE.MeshStandardMaterial({ map: tex.solarTex, roughness: 0.22, metalness: 0.65 });
  const aluMat = new THREE.MeshStandardMaterial({ color: 0xd5d9e0, roughness: 0.36, metalness: 0.86 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.62, metalness: 0.48 });
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.15, metalness: 0.85 });
  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x735b4d,
    map: tex.chevronTireTex,
    roughness: 0.8,
    metalness: 0.38,
  });

  // Warm Electronics Box (WEB) wrapped in crinkled Kapton MLI + silver side brackets
  const web = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.48), kaptonMat);
  web.position.set(0, 0.17, 0);
  chassisGroup.add(web);
  for (const sx of [-0.185, 0.185]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.04, 0.46), aluMat);
    rail.position.set(sx, 0.18, 0);
    chassisGroup.add(rail);
  }

  // Signature overhanging stepped/notched Pathfinder solar panel deck + MAE disc
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.022, 0.66), aluMat);
  frame.position.set(0, 0.26, 0);
  chassisGroup.add(frame);
  const solar = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.012, 0.61), solarMat);
  solar.position.set(0, 0.273, 0);
  chassisGroup.add(solar);
  const rearDeckTab = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.018, 0.08), aluMat);
  rearDeckTab.position.set(0.08, 0.258, 0.35);
  chassisGroup.add(rearDeckTab);
  const maeDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.012, 12), aluMat);
  maeDisc.position.set(0.14, 0.282, 0.22);
  chassisGroup.add(maeDisc);

  const diffBar = new THREE.Group();
  diffBar.position.set(0, 0.24, 0);
  const diffRod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.38, 8), aluMat);
  diffRod.rotation.z = Math.PI / 2;
  diffBar.add(diffRod);
  chassisGroup.add(diffBar);

  // Rear-left tall UHF whip antenna (hgaYaw -> hgaPitch gimbaled flex base)
  const hgaYaw = new THREE.Group();
  hgaYaw.position.set(-0.17, 0.27, 0.21);
  const whipCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.05, 8), kaptonMat);
  whipCollar.position.y = 0.02;
  hgaYaw.add(whipCollar);
  const hgaPitch = new THREE.Group();
  hgaPitch.position.y = 0.04;
  const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.008, 0.38, 8), aluMat);
  whip.position.y = 0.19;
  hgaPitch.add(whip);
  const whipTip = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 8), aluMat);
  whipTip.position.y = 0.38;
  hgaPitch.add(whipTip);
  hgaYaw.add(hgaPitch);
  chassisGroup.add(hgaYaw);

  // Front (-Z) twin stereo monochrome cameras + laser projector bar (mastYaw -> mastPitch)
  const mastYaw = new THREE.Group();
  mastYaw.position.set(0, 0.19, -0.25);
  const mastPitch = new THREE.Group();
  for (const sx of [-0.08, 0.08]) {
    const cam = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.038, 0.042), darkMat);
    cam.position.set(sx, 0, 0);
    mastPitch.add(cam);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.018, 10), lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(sx, 0, -0.025);
    mastPitch.add(lens);
  }
  mastYaw.add(mastPitch);
  chassisGroup.add(mastYaw);

  // Rear (+Z) articulated APXS deployment fork
  const shoulderYaw = new THREE.Group();
  shoulderYaw.position.set(0.09, 0.16, 0.23);
  const shoulderPitch = new THREE.Group();
  const apxsArm = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.024, 0.12), aluMat);
  apxsArm.position.set(0, 0, 0.06);
  shoulderPitch.add(apxsArm);
  const elbowPitch = new THREE.Group();
  elbowPitch.position.set(0, 0, 0.12);
  const wristPitch = new THREE.Group();
  const turretRoll = new THREE.Group();
  const toolSpin = new THREE.Group();
  const apxsHead = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.068, 14), kaptonMat);
  apxsHead.rotation.x = Math.PI / 2;
  apxsHead.position.set(0, 0, 0.035);
  toolSpin.add(apxsHead);
  turretRoll.add(toolSpin);
  wristPitch.add(turretRoll);
  elbowPitch.add(wristPitch);
  shoulderPitch.add(elbowPitch);
  shoulderYaw.add(shoulderPitch);
  chassisGroup.add(shoulderYaw);

  // Rocker-Bogie suspension + 6 cleated aluminum wheels
  const wheelR = 0.068;
  const wheelW = 0.084;
  const wheels = [];
  const steerKnuckles = [];
  const rockers = {};
  const bogies = {};
  const wheelOpts = { spokes: 5, cleatCount: 10, curvedSpokes: false };

  for (const side of [-1, 1]) {
    const key = side < 0 ? "L" : "R";
    const xPos = side * 0.235;

    const rocker = new THREE.Group();
    rocker.name = `sojourner-rocker-${key}`;
    rocker.position.set(side * 0.18, 0.18, 0);
    const crossTube = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.08, 8), aluMat);
    crossTube.rotation.z = Math.PI / 2;
    rocker.add(crossTube);
    const strutFront = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.26, 8), aluMat);
    strutFront.position.set(side * 0.025, -0.04, -0.115);
    strutFront.rotation.x = 0.95;
    rocker.add(strutFront);

    attachWheelAssembly(THREE, rocker, {
      side,
      slot: "front",
      lx: xPos - side * 0.18,
      ly: wheelR - 0.18,
      lz: -0.23,
      worldX: xPos,
      worldZ: -0.23,
      radius: wheelR,
      width: wheelW,
      tireMat,
      hubMat: aluMat,
      wheelOpts,
      steerable: true,
      wheelsOut: wheels,
      knucklesOut: steerKnuckles,
    });

    const bogie = new THREE.Group();
    bogie.name = `sojourner-bogie-${key}`;
    bogie.position.set(side * 0.025, -0.04, 0.115);
    const strutRear = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.26, 8), aluMat);
    strutRear.rotation.x = 1.45;
    bogie.add(strutRear);

    attachWheelAssembly(THREE, bogie, {
      side,
      slot: "mid",
      lx: xPos - side * 0.205,
      ly: wheelR - 0.14,
      lz: -0.115,
      worldX: xPos,
      worldZ: 0.0,
      radius: wheelR,
      width: wheelW,
      tireMat,
      hubMat: aluMat,
      wheelOpts,
      steerable: false,
      wheelsOut: wheels,
      knucklesOut: steerKnuckles,
    });

    attachWheelAssembly(THREE, bogie, {
      side,
      slot: "rear",
      lx: xPos - side * 0.205,
      ly: wheelR - 0.14,
      lz: 0.115,
      worldX: xPos,
      worldZ: 0.23,
      radius: wheelR,
      width: wheelW,
      tireMat,
      hubMat: aluMat,
      wheelOpts,
      steerable: true,
      wheelsOut: wheels,
      knucklesOut: steerKnuckles,
    });

    rocker.add(bogie);
    root.add(rocker);
    rockers[key] = rocker;
    bogies[key] = bogie;
  }

  const rig = {
    kind: "sojourner",
    chassis: chassisGroup,
    rockerL: rockers.L,
    rockerR: rockers.R,
    bogieL: bogies.L,
    bogieR: bogies.R,
    diffBar,
    wheels,
    steerKnuckles,
    mastYaw,
    mastPitch,
    hgaYaw,
    hgaPitch,
    arm: { shoulderYaw, shoulderPitch, elbowPitch, wristPitch, turretRoll, toolSpin },
  };
  rig.restPose = captureRigRestPose(rig);
  root.userData.rig = rig;
  return root;
}

/**
 * 3 & 4. NASA Mars Exploration Rovers — SPIRIT (MER-A) & OPPORTUNITY (MER-B)
 * Matches reference images: swept butterfly solar wings with crisp silver/white trim & diagonal struts,
 * crinkled Kapton WEB + NASA meatball plates, tall cream Pancam Mast Assembly + twin Navcam barrels,
 * gimbaled HGA dish + vertical LGA whip, MarsDial, articulated 3-joint IDD turret arm, and 6 spiral-spoked wheels.
 */
function buildMerMesh(THREE, tex, variant) {
  const root = new THREE.Group();
  const isOppy = variant === "mer-opportunity";
  const chassisGroup = new THREE.Group();
  chassisGroup.name = `${variant}-chassis`;
  root.add(chassisGroup);

  const kaptonMat = new THREE.MeshStandardMaterial({
    color: 0xcf9434,
    map: tex.kaptonTex,
    bumpMap: tex.kaptonBumpTex,
    bumpScale: 0.018,
    roughness: 0.32,
    metalness: 0.82,
  });
  const solarMat = new THREE.MeshStandardMaterial({ map: tex.solarTex, roughness: 0.24, metalness: 0.56 });
  const creamMat = new THREE.MeshStandardMaterial({ color: 0xe7dfd2, roughness: 0.44, metalness: 0.18 });
  const strutMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.32, metalness: 0.86 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c2028, roughness: 0.56, metalness: 0.52 });
  const opticGlass = new THREE.MeshStandardMaterial({
    color: 0x22d3ee,
    emissive: 0x083344,
    emissiveIntensity: 0.45,
    roughness: 0.12,
    metalness: 0.88,
  });
  const emblemMat = new THREE.MeshStandardMaterial({
    map: tex.merEmblemTex,
    bumpMap: tex.kaptonBumpTex,
    bumpScale: 0.008,
    roughness: 0.42,
    metalness: 0.35,
  });
  const tireMat = new THREE.MeshStandardMaterial({
    color: isOppy ? 0x3b3532 : 0x5c473e,
    map: tex.chevronTireTex,
    roughness: 0.82,
    metalness: 0.34,
  });

  // Tapered Warm Electronics Box (WEB) wrapped in crinkled Kapton MLI + NASA meatball plates
  const web = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.39, 0.9), kaptonMat);
  web.position.set(0, 0.44, 0.04);
  chassisGroup.add(web);
  for (const sx of [-0.425, 0.425]) {
    const sideDecal = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.3, 0.56), emblemMat);
    sideDecal.position.set(sx, 0.45, 0.04);
    chassisGroup.add(sideDecal);
  }
  const frontAppliance = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.22, 0.09), isOppy ? kaptonMat : darkMat);
  frontAppliance.position.set(0, 0.42, -0.43);
  chassisGroup.add(frontAppliance);

  // Swept butterfly triangular MER solar array wings + perimeter trim + under-wing struts
  const centerDeck = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.032, 1.15), solarMat);
  centerDeck.position.set(0, 0.65, 0.04);
  chassisGroup.add(centerDeck);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.026, 0.98), solarMat);
    wing.position.set(side * 0.84, 0.67, 0.06);
    wing.rotation.z = side * 0.055;
    wing.rotation.y = side * -0.14;
    chassisGroup.add(wing);
    const wingTrim = new THREE.Mesh(new THREE.BoxGeometry(0.69, 0.03, 0.042), isOppy ? darkMat : creamMat);
    wingTrim.position.set(side * 0.82, 0.67, 0.54);
    wingTrim.rotation.z = side * 0.055;
    wingTrim.rotation.y = side * -0.14;
    chassisGroup.add(wingTrim);
    const underStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.66, 8), strutMat);
    underStrut.position.set(side * 0.62, 0.53, 0.08);
    underStrut.rotation.z = side * 1.12;
    chassisGroup.add(underStrut);
  }
  const rearWing = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.026, 0.48), solarMat);
  rearWing.position.set(0, 0.66, 0.74);
  rearWing.rotation.x = 0.04;
  chassisGroup.add(rearWing);

  // MarsDial calibration target on rear deck + differential cross bar
  const marsDial = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.042, 0.04, 12), creamMat);
  marsDial.position.set(0.32, 0.68, 0.34);
  chassisGroup.add(marsDial);
  const diffBar = new THREE.Group();
  diffBar.position.set(0, 0.58, 0.04);
  const diffRod = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.92, 8), strutMat);
  diffRod.rotation.z = Math.PI / 2;
  diffBar.add(diffRod);
  chassisGroup.add(diffBar);

  // Tall white Pancam Mast Assembly (mastYaw -> mastPitch) + stereo Pancam & twin cylindrical Navcams
  const mastYaw = new THREE.Group();
  mastYaw.position.set(0.14, 0.66, -0.34);
  const mastBase = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.11, 0.11, 14), kaptonMat);
  mastBase.position.y = 0.04;
  mastYaw.add(mastBase);
  const mastTube = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.064, 0.72, 14), creamMat);
  mastTube.position.y = 0.41;
  mastYaw.add(mastTube);
  const mastCable = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.008, 6, 16), darkMat);
  mastCable.position.y = 0.48;
  mastCable.rotation.x = Math.PI / 2 - 0.18;
  mastYaw.add(mastCable);

  const mastPitch = new THREE.Group();
  mastPitch.position.y = 0.78;
  const pmaCross = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.09, 0.15), creamMat);
  mastPitch.add(pmaCross);
  for (const dx of [-0.16, 0.16]) {
    const pancamPod = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.085, 0.12), creamMat);
    pancamPod.position.set(dx, 0.055, -0.01);
    mastPitch.add(pancamPod);
    const lensRing = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.045, 12), darkMat);
    lensRing.rotation.x = Math.PI / 2;
    lensRing.position.set(dx, 0.055, -0.08);
    mastPitch.add(lensRing);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 12), opticGlass);
    glass.rotation.x = Math.PI / 2;
    glass.position.set(dx, 0.055, -0.085);
    mastPitch.add(glass);
  }
  for (const dx of [-0.05, 0.05]) {
    const navBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.095, 12), creamMat);
    navBarrel.rotation.x = Math.PI / 2;
    navBarrel.position.set(dx, -0.015, -0.09);
    mastPitch.add(navBarrel);
    const navEye = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.02, 10), opticGlass);
    navEye.rotation.x = Math.PI / 2;
    navEye.position.set(dx, -0.015, -0.14);
    mastPitch.add(navEye);
  }
  mastYaw.add(mastPitch);
  chassisGroup.add(mastYaw);

  // Rear gimbaled parabolic copper-gold High-Gain Antenna dish (hgaYaw -> hgaPitch) + LGA mast
  const hgaMat = new THREE.MeshStandardMaterial({
    color: isOppy ? 0xb48a5a : 0xd6b07c,
    roughness: 0.34,
    metalness: 0.72,
    side: THREE.DoubleSide,
  });
  const dishPoints = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.12, 0.016),
    new THREE.Vector2(0.22, 0.058),
    new THREE.Vector2(0.245, 0.072),
  ];
  const dishGeom = new THREE.LatheGeometry(dishPoints, 24);
  const hgaYaw = new THREE.Group();
  hgaYaw.position.set(-0.2, 0.72, 0.44);
  hgaYaw.rotation.y = isOppy ? 0.32 : -0.24;
  const hgaPed = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.03, 0.14, 10), strutMat);
  hgaPed.position.y = 0.07;
  hgaYaw.add(hgaPed);
  const hgaPitch = new THREE.Group();
  hgaPitch.position.y = 0.14;
  hgaPitch.rotation.set(-0.82, 0, 0.2);
  const dish = new THREE.Mesh(dishGeom, hgaMat);
  hgaPitch.add(dish);
  const dishFeed = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.024, 0.18, 10), darkMat);
  dishFeed.position.set(0, 0.09, 0);
  hgaPitch.add(dishFeed);
  const dishTip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.024, 0.03, 10), kaptonMat);
  dishTip.position.set(0, 0.18, 0);
  hgaPitch.add(dishTip);
  hgaYaw.add(hgaPitch);
  chassisGroup.add(hgaYaw);

  const lga = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.024, 0.64, 8), isOppy ? strutMat : darkMat);
  lga.position.set(0.15, 0.98, 0.38);
  chassisGroup.add(lga);

  // Hierarchical 3-joint Instrument Deployment Device (IDD) arm + RAT / Mössbauer / MI turret
  const shoulderYaw = new THREE.Group();
  shoulderYaw.position.set(-0.16, 0.46, -0.44);
  const iddShoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.1, 10), strutMat);
  shoulderYaw.add(iddShoulder);

  const shoulderPitch = new THREE.Group();
  shoulderPitch.rotation.x = isOppy ? -0.24 : -0.14;
  const iddBoom1 = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.056, 0.36), creamMat);
  iddBoom1.position.set(0, 0, -0.18);
  shoulderPitch.add(iddBoom1);

  const elbowPitch = new THREE.Group();
  elbowPitch.position.set(0, 0, -0.36);
  elbowPitch.rotation.x = isOppy ? 0.56 : -0.32;
  const iddBoom2 = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.048, 0.28), strutMat);
  iddBoom2.position.set(0, 0, -0.14);
  elbowPitch.add(iddBoom2);

  const wristPitch = new THREE.Group();
  wristPitch.position.set(0, 0, -0.28);
  const turretRoll = new THREE.Group();
  const iddTurret = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.13, 14), darkMat);
  iddTurret.rotation.z = Math.PI / 2;
  turretRoll.add(iddTurret);
  const toolSpin = new THREE.Group();
  toolSpin.position.set(0, 0, -0.09);
  const ratHead = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.08, 12), kaptonMat);
  ratHead.rotation.x = Math.PI / 2;
  toolSpin.add(ratHead);
  turretRoll.add(toolSpin);

  wristPitch.add(turretRoll);
  elbowPitch.add(wristPitch);
  shoulderPitch.add(elbowPitch);
  shoulderYaw.add(shoulderPitch);
  chassisGroup.add(shoulderYaw);

  // Rocker-Bogie suspension + 6 spiral-spoked cleated wheels
  const wheelR = 0.128;
  const wheelW = 0.156;
  const wheels = [];
  const steerKnuckles = [];
  const rockers = {};
  const bogies = {};
  const wheelOpts = {
    spokes: 6,
    cleatCount: 12,
    curvedSpokes: true,
    dustRingColor: isOppy ? 0xa35a3c : null,
  };

  for (const side of [-1, 1]) {
    const key = side < 0 ? "L" : "R";
    const wx = side * 0.57;

    const rocker = new THREE.Group();
    rocker.name = `${variant}-rocker-${key}`;
    rocker.position.set(side * 0.44, 0.42, 0.0);
    const rockerHub = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.08, 10), strutMat);
    rockerHub.rotation.z = Math.PI / 2;
    rocker.add(rockerHub);

    const frontLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.72, 10), strutMat);
    frontLeg.position.set(side * 0.07, -0.11, -0.34);
    frontLeg.rotation.x = 1.08;
    frontLeg.rotation.z = side * 0.16;
    rocker.add(frontLeg);

    attachWheelAssembly(THREE, rocker, {
      side,
      slot: "front",
      lx: wx - side * 0.44,
      ly: wheelR - 0.42,
      lz: -0.66,
      worldX: wx,
      worldZ: -0.66,
      radius: wheelR,
      width: wheelW,
      tireMat,
      hubMat: strutMat,
      wheelOpts,
      steerable: true,
      wheelsOut: wheels,
      knucklesOut: steerKnuckles,
    });

    const bogie = new THREE.Group();
    bogie.name = `${variant}-bogie-${key}`;
    bogie.position.set(side * 0.09, -0.14, 0.32);
    const rearLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.64, 10), strutMat);
    rearLeg.rotation.x = 1.46;
    bogie.add(rearLeg);

    attachWheelAssembly(THREE, bogie, {
      side,
      slot: "mid",
      lx: wx - side * 0.53,
      ly: wheelR - 0.28,
      lz: -0.3,
      worldX: wx,
      worldZ: 0.02,
      radius: wheelR,
      width: wheelW,
      tireMat,
      hubMat: strutMat,
      wheelOpts,
      steerable: false,
      wheelsOut: wheels,
      knucklesOut: steerKnuckles,
    });

    attachWheelAssembly(THREE, bogie, {
      side,
      slot: "rear",
      lx: wx - side * 0.53,
      ly: wheelR - 0.28,
      lz: 0.3,
      worldX: wx,
      worldZ: 0.62,
      radius: wheelR,
      width: wheelW,
      tireMat,
      hubMat: strutMat,
      wheelOpts,
      steerable: true,
      wheelsOut: wheels,
      knucklesOut: steerKnuckles,
    });

    rocker.add(bogie);
    root.add(rocker);
    rockers[key] = rocker;
    bogies[key] = bogie;
  }

  const rig = {
    kind: variant,
    chassis: chassisGroup,
    rockerL: rockers.L,
    rockerR: rockers.R,
    bogieL: bogies.L,
    bogieR: bogies.R,
    diffBar,
    wheels,
    steerKnuckles,
    mastYaw,
    mastPitch,
    hgaYaw,
    hgaPitch,
    arm: { shoulderYaw, shoulderPitch, elbowPitch, wristPitch, turretRoll, toolSpin },
  };
  rig.restPose = captureRigRestPose(rig);
  root.userData.rig = rig;
  return root;
}

/**
 * 5. NASA Mars 2020 — PERSEVERANCE (Procedural Scale + Hierarchical Rig)
 * Matches reference image: golden-tan ribbed chassis & dorsal harness, SuperCam circular eye +
 * underslung twin Mastcam-Z barrels + wide Navcam wings + MEDA wind booms, heavy 2.1 m 5-DOF arm
 * with SHERLOC/PIXL/WATSON/coring-drill turret, rear angled MMRTG, RIMFAX unit, and 48-cleat wheels.
 */
function buildPerseveranceMesh(THREE, tex) {
  const root = new THREE.Group();
  const chassisGroup = new THREE.Group();
  chassisGroup.name = "perseverance-chassis";
  root.add(chassisGroup);

  const bodyMat = new THREE.MeshStandardMaterial({ map: tex.perseveranceBodyTex, roughness: 0.38, metalness: 0.26 });
  const tanMat = new THREE.MeshStandardMaterial({ color: 0xe3cca6, roughness: 0.42, metalness: 0.2 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x16191f, roughness: 0.48, metalness: 0.78 });
  const tiMat = new THREE.MeshStandardMaterial({ color: 0xaab2bd, roughness: 0.32, metalness: 0.88 });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xd49b3b,
    map: tex.kaptonTex,
    bumpMap: tex.kaptonBumpTex,
    bumpScale: 0.015,
    roughness: 0.3,
    metalness: 0.82,
  });
  const lensMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0c4a6e,
    emissiveIntensity: 0.6,
    roughness: 0.08,
    metalness: 0.92,
  });
  const tireMat = new THREE.MeshStandardMaterial({
    map: tex.perseveranceTireTex,
    roughness: 0.72,
    metalness: 0.52,
  });

  // Main Perseverance golden-tan body + belly skid + RIMFAX rear radar pod
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.64, 2.02), bodyMat);
  chassis.position.set(0, 0.86, 0.04);
  chassisGroup.add(chassis);
  const bellyPlate = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.08, 1.8), darkMetal);
  bellyPlate.position.set(0, 0.51, 0.04);
  chassisGroup.add(bellyPlate);
  const topDeck = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 1.86), tanMat);
  topDeck.position.set(0, 1.19, 0.04);
  chassisGroup.add(topDeck);
  const rimfax = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.14, 0.22), darkMetal);
  rimfax.position.set(0, 0.62, 1.06);
  chassisGroup.add(rimfax);

  const diffBar = new THREE.Group();
  diffBar.position.set(0, 1.26, -0.04);
  const diffCrossTube = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 1.44, 12), darkMetal);
  diffCrossTube.rotation.z = Math.PI / 2;
  diffBar.add(diffCrossTube);
  chassisGroup.add(diffBar);

  // Gimbaled hexagonal HGA dish (hgaYaw -> hgaPitch)
  const hgaYaw = new THREE.Group();
  hgaYaw.position.set(-0.26, 1.28, 0.52);
  const hgaPed = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.044, 0.14, 10), darkMetal);
  hgaPed.position.y = 0.05;
  hgaYaw.add(hgaPed);
  const hgaPitch = new THREE.Group();
  hgaPitch.position.y = 0.11;
  hgaPitch.rotation.set(0.4, 0, 0);
  const hgaDeck = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.25, 0.032, 6), tanMat);
  hgaPitch.add(hgaDeck);
  const hgaFeed = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.15, 8), darkMetal);
  hgaFeed.position.y = 0.08;
  hgaPitch.add(hgaFeed);
  hgaYaw.add(hgaPitch);
  chassisGroup.add(hgaYaw);

  // Rear tilted Pu-238 MMRTG + 8 radiator fins + UHF mast
  const rtgGroup = new THREE.Group();
  rtgGroup.position.set(0, 0.98, 1.18);
  rtgGroup.rotation.x = -0.58;
  const rtgCore = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.21, 0.68, 16), goldMat);
  rtgCore.rotation.x = Math.PI / 2;
  rtgGroup.add(rtgCore);
  for (let i = 0; i < 8; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.52, 0.62), tanMat);
    fin.rotation.z = (i * Math.PI) / 4;
    rtgGroup.add(fin);
  }
  chassisGroup.add(rtgGroup);

  const uhfPole = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.058, 0.5, 12), darkMetal);
  uhfPole.position.set(0.36, 1.44, 0.8);
  chassisGroup.add(uhfPole);

  // Remote Sensing Mast (mastYaw -> mastPitch): MEDA wind booms + SuperCam + twin Mastcam-Z + wide Navcams
  const mastYaw = new THREE.Group();
  mastYaw.position.set(0.24, 1.22, -0.58);
  const mastCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.11, 0.14, 14), darkMetal);
  mastCollar.position.y = 0.06;
  mastYaw.add(mastCollar);
  const mastShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.08, 0.94, 16), tanMat);
  mastShaft.position.y = 0.48;
  mastYaw.add(mastShaft);
  for (const dir of [-1, 1]) {
    const medaBoom = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.25, 8), darkMetal);
    medaBoom.rotation.z = Math.PI / 2;
    medaBoom.position.set(dir * 0.15, 0.56, 0);
    mastYaw.add(medaBoom);
  }

  const mastPitch = new THREE.Group();
  mastPitch.position.y = 0.96;
  const headBox = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.24, 0.34), tanMat);
  mastPitch.add(headBox);
  const superCamRing = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.06, 18), darkMetal);
  superCamRing.rotation.x = Math.PI / 2;
  superCamRing.position.set(-0.08, 0.02, -0.18);
  mastPitch.add(superCamRing);
  const superCamEye = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.068, 18), lensMat);
  superCamEye.rotation.x = Math.PI / 2;
  superCamEye.position.set(-0.08, 0.02, -0.185);
  mastPitch.add(superCamEye);
  // Underslung Mastcam-Z stereo zoom pods + wide Navcam bar
  for (const mx of [-0.14, 0.14]) {
    const mz = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.075, 0.12), darkMetal);
    mz.position.set(mx, -0.14, -0.14);
    mastPitch.add(mz);
    const mzEye = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.05, 12), lensMat);
    mzEye.rotation.x = Math.PI / 2;
    mzEye.position.set(mx, -0.14, -0.2);
    mastPitch.add(mzEye);
  }
  mastYaw.add(mastPitch);
  chassisGroup.add(mastYaw);

  // Heavy 5-DOF Coring-Drill / SHERLOC / PIXL Robotic Arm
  const shoulderYaw = new THREE.Group();
  shoulderYaw.position.set(-0.24, 0.74, -1.02);
  const armBase = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.26), darkMetal);
  shoulderYaw.add(armBase);

  const shoulderPitch = new THREE.Group();
  shoulderPitch.position.set(0, -0.02, -0.08);
  const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.054, 0.84, 12), tiMat);
  upperArm.rotation.x = Math.PI / 2;
  upperArm.position.set(0, 0, -0.4);
  shoulderPitch.add(upperArm);

  const elbowPitch = new THREE.Group();
  elbowPitch.position.set(0, 0, -0.8);
  const elbowJoint = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.16, 14), darkMetal);
  elbowJoint.rotation.z = Math.PI / 2;
  elbowPitch.add(elbowJoint);
  const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.68, 12), tanMat);
  forearm.position.set(0, 0.34, 0);
  elbowPitch.add(forearm);

  const wristPitch = new THREE.Group();
  wristPitch.position.set(0, 0.68, 0);
  const turretRoll = new THREE.Group();
  const turret = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.28, 0.38), darkMetal);
  turretRoll.add(turret);
  const sherloc = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.18), goldMat);
  sherloc.position.set(0.18, 0.04, -0.14);
  turretRoll.add(sherloc);
  const toolSpin = new THREE.Group();
  toolSpin.position.set(0, 0, -0.24);
  const coringDrill = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.026, 0.26, 12), tiMat);
  coringDrill.rotation.x = Math.PI / 2;
  toolSpin.add(coringDrill);
  turretRoll.add(toolSpin);

  wristPitch.add(turretRoll);
  elbowPitch.add(wristPitch);
  shoulderPitch.add(elbowPitch);
  shoulderYaw.add(shoulderPitch);
  chassisGroup.add(shoulderYaw);

  // Rocker-Bogie suspension + 6 narrow/tall 48-cleat titanium wheels
  const wheelR = 0.262;
  const wheelW = 0.34;
  const wheels = [];
  const steerKnuckles = [];
  const rockers = {};
  const bogies = {};
  const wheelOpts = { spokes: 6, cleatCount: 20, curvedSpokes: true };

  for (const side of [-1, 1]) {
    const key = side < 0 ? "L" : "R";
    const wx = side * 1.19;

    const rocker = new THREE.Group();
    rocker.name = `perseverance-rocker-${key}`;
    rocker.position.set(side * 0.72, 0.94, 0.02);
    const pivotHub = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.16, 12), tiMat);
    pivotHub.rotation.z = Math.PI / 2;
    rocker.add(pivotHub);

    const frontTube = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 1.26, 10), darkMetal);
    frontTube.position.set(side * 0.22, -0.18, -0.53);
    frontTube.rotation.x = 0.98;
    frontTube.rotation.z = side * 0.22;
    rocker.add(frontTube);

    attachWheelAssembly(THREE, rocker, {
      side,
      slot: "front",
      lx: wx - side * 0.72,
      ly: wheelR - 0.94,
      lz: -1.1,
      worldX: wx,
      worldZ: -1.08,
      radius: wheelR,
      width: wheelW,
      tireMat,
      hubMat: tiMat,
      wheelOpts,
      steerable: true,
      wheelsOut: wheels,
      knucklesOut: steerKnuckles,
    });

    const rearArm = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.76, 10), darkMetal);
    rearArm.position.set(side * 0.2, -0.22, 0.28);
    rearArm.rotation.x = 1.05;
    rearArm.rotation.z = side * 0.22;
    rocker.add(rearArm);

    const bogie = new THREE.Group();
    bogie.name = `perseverance-bogie-${key}`;
    bogie.position.set(side * 0.32, -0.4, 0.57);
    const bogieCross = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 1.1, 10), darkMetal);
    bogieCross.position.set(side * 0.04, 0, 0);
    bogieCross.rotation.x = 1.48;
    bogie.add(bogieCross);

    attachWheelAssembly(THREE, bogie, {
      side,
      slot: "mid",
      lx: wx - side * 1.04,
      ly: wheelR - 0.54,
      lz: -0.51,
      worldX: wx,
      worldZ: 0.06,
      radius: wheelR,
      width: wheelW,
      tireMat,
      hubMat: tiMat,
      wheelOpts,
      steerable: false,
      wheelsOut: wheels,
      knucklesOut: steerKnuckles,
    });

    attachWheelAssembly(THREE, bogie, {
      side,
      slot: "rear",
      lx: wx - side * 1.04,
      ly: wheelR - 0.54,
      lz: 0.52,
      worldX: wx,
      worldZ: 1.09,
      radius: wheelR,
      width: wheelW,
      tireMat,
      hubMat: tiMat,
      wheelOpts,
      steerable: true,
      wheelsOut: wheels,
      knucklesOut: steerKnuckles,
    });

    rocker.add(bogie);
    root.add(rocker);
    rockers[key] = rocker;
    bogies[key] = bogie;
  }

  const rig = {
    kind: "perseverance",
    chassis: chassisGroup,
    rockerL: rockers.L,
    rockerR: rockers.R,
    bogieL: bogies.L,
    bogieR: bogies.R,
    diffBar,
    wheels,
    steerKnuckles,
    mastYaw,
    mastPitch,
    hgaYaw,
    hgaPitch,
    arm: { shoulderYaw, shoulderPitch, elbowPitch, wristPitch, turretRoll, toolSpin },
  };
  rig.restPose = captureRigRestPose(rig);
  root.userData.rig = rig;
  return root;
}

/**
 * Bind hierarchical articulation rig onto NASA's 68-mesh `mars-2020-perseverance.glb`
 * by discovering its named head, HGA dish, robotic arm chain, and suspension nodes.
 */
function bindPerseveranceGltfRig(gltfScene) {
  const byName = new Map();
  gltfScene.traverse((o) => {
    if (o.name) byName.set(o.name, o);
  });

  const rig = {
    kind: "perseverance",
    chassis: byName.get("Body") || gltfScene,
    rockerL: null,
    rockerR: null,
    bogieL: null,
    bogieR: null,
    diffBar: byName.get("suspension") || null,
    wheels: [],
    steerKnuckles: [],
    mastYaw: byName.get("top") || byName.get("Cylinder") || null,
    mastPitch: byName.get("head") || null,
    hgaYaw: byName.get("antenna_hg") || null,
    hgaPitch: null,
    arm: {
      shoulderYaw: byName.get("arm.003") || null,
      shoulderPitch: byName.get("arm.002") || null,
      elbowPitch: byName.get("arm") || null,
      wristPitch: byName.get("arm.004") || null,
      turretRoll: byName.get("turret_obj") || null,
      toolSpin: byName.get("corring_drill") || null,
    },
  };
  rig.restPose = captureRigRestPose(rig);
  gltfScene.userData.rig = rig;
  return rig;
}

function wrapAngleRad(a) {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function dampAngle(cur, target, rate) {
  return cur + wrapAngleRad(target - cur) * Math.min(1, rate);
}

function clampVal(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Live per-frame hierarchical kinematics & rocker-bogie suspension articulation
 * for any of the 5 rigged NASA Mars rovers.
 */
export function stepRoverRigKinematics(
  rig,
  {
    dt = 0.016,
    clockT = 0,
    relObserverX = null,
    relObserverY = 0,
    relObserverZ = null,
    wheelDeltaHeights = null,
    driveSpeed = 0,
    steerAngle = 0,
  } = {}
) {
  if (!rig) return;
  const rest = rig.restPose || captureRigRestPose(rig);
  const stepDt = Math.max(0, Math.min(0.1, Number(dt) || 0));
  const rate = Math.min(1, stepDt * 4.5);

  // 1. Rocker-Bogie differential suspension from 6-wheel terrain deltas [fl, ml, rl, fr, mr, rr]
  if (Array.isArray(wheelDeltaHeights) && wheelDeltaHeights.length === 6) {
    const [fl, ml, rl, fr, mr, rr] = wheelDeltaHeights;
    const span = rig.kind === "sojourner" ? 0.24 : rig.kind === "mer-spirit" || rig.kind === "mer-opportunity" ? 0.66 : 1.08;
    const rockL = clampVal((fl - (ml + rl) * 0.5) / span, -0.34, 0.34);
    const rockR = clampVal((fr - (mr + rr) * 0.5) / span, -0.34, 0.34);
    const bogL = clampVal((ml - rl) / span, -0.38, 0.38);
    const bogR = clampVal((mr - rr) / span, -0.38, 0.38);
    if (rig.rockerL) rig.rockerL.rotation.x += (rockL - rig.rockerL.rotation.x) * rate;
    if (rig.rockerR) rig.rockerR.rotation.x += (rockR - rig.rockerR.rotation.x) * rate;
    if (rig.bogieL) rig.bogieL.rotation.x += (bogL - rig.bogieL.rotation.x) * rate;
    if (rig.bogieR) rig.bogieR.rotation.x += (bogR - rig.bogieR.rotation.x) * rate;
    if (rig.diffBar) {
      const diffTilt = clampVal((rockL - rockR) * 0.6, -0.25, 0.25);
      rig.diffBar.rotation.z += (diffTilt - rig.diffBar.rotation.z) * rate;
    }
  }

  // 2. Remote Sensing / Pancam Mast azimuth & elevation tracking
  let targetMastYaw = rest.mastYawY + Math.sin(clockT * 0.42) * 0.42;
  let targetMastPitch = rest.mastPitchX + Math.sin(clockT * 0.65) * 0.08;
  if (Number.isFinite(relObserverX) && Number.isFinite(relObserverZ)) {
    const dist = Math.hypot(relObserverX, relObserverZ);
    if (dist > 0.6 && dist < 24) {
      // Rover forward faces -Z, so yaw=0 points along -Z
      const lookYaw = Math.atan2(-relObserverX, -relObserverZ);
      targetMastYaw = clampVal(wrapAngleRad(lookYaw), -1.65, 1.65);
      targetMastPitch = clampVal(Math.atan2(relObserverY, dist), -0.38, 0.48);
    }
  }
  if (rig.mastYaw) {
    rig.mastYaw.rotation.y = dampAngle(rig.mastYaw.rotation.y, targetMastYaw, rate);
  }
  if (rig.mastPitch) {
    rig.mastPitch.rotation.x += (targetMastPitch - rig.mastPitch.rotation.x) * rate;
  }

  // 3. Gimbaled High-Gain Antenna Earth-tracking slow sweep
  if (rig.hgaYaw) {
    const hgaYawTarget = rest.hgaYawY + Math.sin(clockT * 0.28 + 0.7) * 0.22;
    rig.hgaYaw.rotation.y = dampAngle(rig.hgaYaw.rotation.y, hgaYawTarget, rate * 0.7);
  }
  if (rig.hgaPitch) {
    const hgaPitchTarget = rest.hgaPitchX + Math.cos(clockT * 0.33) * 0.08;
    rig.hgaPitch.rotation.x += (hgaPitchTarget - rig.hgaPitch.rotation.x) * rate * 0.7;
  }

  // 4. Hierarchical Robotic Arm & Drill / Turret gentle science inspection cycle
  if (rig.arm) {
    const amp = rig.kind === "sojourner" ? 0.55 : 1.0;
    const { shoulderYaw, shoulderPitch, elbowPitch, wristPitch, turretRoll, toolSpin } = rig.arm;
    if (shoulderYaw) {
      const ty = rest.shoulderYawY + Math.sin(clockT * 0.35) * 0.14 * amp;
      shoulderYaw.rotation.y = dampAngle(shoulderYaw.rotation.y, ty, rate);
    }
    if (shoulderPitch) {
      const tp = rest.shoulderPitchX + Math.sin(clockT * 0.48 + 0.5) * 0.08 * amp;
      shoulderPitch.rotation.x += (tp - shoulderPitch.rotation.x) * rate;
    }
    if (elbowPitch) {
      const te = rest.elbowPitchX + Math.cos(clockT * 0.52) * 0.11 * amp;
      elbowPitch.rotation.x += (te - elbowPitch.rotation.x) * rate;
    }
    if (wristPitch) {
      const tw = rest.wristPitchX + Math.sin(clockT * 0.6 + 1.1) * 0.09 * amp;
      wristPitch.rotation.x += (tw - wristPitch.rotation.x) * rate;
    }
    if (turretRoll) {
      const tr = rest.turretRollZ + Math.sin(clockT * 0.38) * 0.22 * amp;
      turretRoll.rotation.z += (tr - turretRoll.rotation.z) * rate;
    }
    if (toolSpin) {
      toolSpin.rotation.z += stepDt * 1.4 * amp;
    }
  }

  // 5. Wheel rotation & 4-wheel Ackermann corner steering knuckles
  if (Array.isArray(rig.wheels)) {
    for (const w of rig.wheels) {
      const r = w.userData?.wheelMeta?.radius || 0.2;
      if (Math.abs(driveSpeed) > 1e-4) {
        w.rotation.x -= (driveSpeed * stepDt) / Math.max(0.05, r);
      }
    }
  }
  if (Array.isArray(rig.steerKnuckles)) {
    const clampedSteer = clampVal(steerAngle || 0, -0.55, 0.55);
    for (const k of rig.steerKnuckles) {
      const isRear = k.name.endsWith("-rear");
      const targetSteer = isRear ? -clampedSteer : clampedSteer;
      k.rotation.y += (targetSteer - k.rotation.y) * rate;
    }
  }
}

/**
 * Merge static sub-primitives inside a historic rover (`body` or cached GLB) while keeping every
 * articulated rig node (`rocker*`, `bogie*`, `mast*`, `hga*`, `arm.*`, `steerKnuckles`, `wheels`)
 * intact and independently animatable.
 */
function compactHistoricRoverMeshes(THREE, root, rig) {
  if (!root || typeof THREE?.BufferGeometry !== "function") return;
  const articulated = [];
  const pushNode = (node) => {
    if (node && node !== root && !articulated.includes(node)) articulated.push(node);
  };
  if (rig) {
    if (rig.chassis && rig.chassis !== root) pushNode(rig.chassis);
    for (const node of [
      rig.rockerL,
      rig.rockerR,
      rig.bogieL,
      rig.bogieR,
      rig.diffBar,
      rig.mastYaw,
      rig.mastPitch,
      rig.hgaYaw,
      rig.hgaPitch,
      rig.arm?.shoulderYaw,
      rig.arm?.shoulderPitch,
      rig.arm?.elbowPitch,
      rig.arm?.wristPitch,
      rig.arm?.turretRoll,
      rig.arm?.toolSpin,
    ]) {
      pushNode(node);
    }
    for (const node of rig.steerKnuckles || []) pushNode(node);
    for (const node of rig.wheels || []) pushNode(node);
  }

  const lockNoMerge = (nodes) => {
    const saved = [];
    for (const sub of nodes) {
      sub.traverse((o) => {
        saved.push([o, o.userData?.noMerge]);
        if (!o.userData) o.userData = {};
        o.userData.noMerge = true;
      });
    }
    return () => {
      for (const [o, prev] of saved) {
        if (prev === undefined) delete o.userData.noMerge;
        else o.userData.noMerge = prev;
      }
    };
  };

  // Merge non-articulated hull/chassis/solar parts attached to root
  const unlockAll = lockNoMerge(articulated);
  mergeStaticMeshes(THREE, root);
  unlockAll();

  // Merge static children inside each articulated node while protecting nested articulated subtrees
  for (let i = 0; i < articulated.length; i++) {
    const node = articulated[i];
    if (!node.parent || !node.children?.length) continue;
    const nested = [];
    for (let j = 0; j < articulated.length; j++) {
      if (i === j) continue;
      let p = articulated[j].parent;
      while (p) {
        if (p === node) {
          nested.push(articulated[j]);
          break;
        }
        p = p.parent;
      }
    }
    const unlockNested = lockNoMerge(nested);
    mergeStaticMeshes(THREE, node);
    unlockNested();
  }
}

function stripTransmissiveMaterials(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const m of mats) {
      // Clear KHR_materials_transmission: even a single visible lens with transmission > 0 forces
      // Three.js WebGLRenderer into a full second opaque scene render + mipmap pre-pass every frame.
      if (m && "transmission" in m && m.transmission > 0) {
        m.transmission = 0;
        m.transparent = true;
        m.opacity = 0.72;
        m.roughness = 0.08;
        m.needsUpdate = true;
      }
    }
  });
}

// One download per GLB url for the whole session (rescatter / site switches reuse it).
const gltfCache = new Map();
function loadGltfCached(THREE, loader, url) {
  if (!gltfCache.has(url)) {
    const p = loader.loadAsync(url).then((gltf) => {
      if (gltf?.scene) {
        stripTransmissiveMaterials(gltf.scene);
        const rig = bindPerseveranceGltfRig(gltf.scene);
        compactHistoricRoverMeshes(THREE, gltf.scene, rig);
      }
      return gltf;
    });
    p.catch(() => gltfCache.delete(url));
    gltfCache.set(url, p);
  }
  return gltfCache.get(url);
}

function disposeRoverGroup(group, sharedTexSet) {
  group.traverse((o) => {
    if (o.userData?.sharedAsset) return;
    if (!o.isSprite) o.geometry?.dispose?.();
    if (o.userData?.sharedMaterial) return; // merged from a cached GLB: its materials stay in use
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "alphaMap"]) {
        const t = m[key];
        if (t && !sharedTexSet.has(t)) t.dispose?.();
      }
      m.dispose?.();
    }
  });
}

function normalizePerseveranceGltf(THREE, gltfScene, roverId) {
  gltfScene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gltfScene);
  const size = new THREE.Vector3();
  box.getSize(size);

  const horizMax = Math.max(size.x, size.z, 0.001);
  const s = 3.0 / horizMax;
  gltfScene.scale.setScalar(s);

  if (size.x > size.z * 1.12) {
    gltfScene.rotation.y = Math.PI / 2;
  } else {
    gltfScene.rotation.y = Math.PI;
  }
  gltfScene.updateMatrixWorld(true);

  const seatedBox = new THREE.Box3().setFromObject(gltfScene);
  const seatedCenter = new THREE.Vector3();
  seatedBox.getCenter(seatedCenter);
  gltfScene.position.set(-seatedCenter.x, -seatedBox.min.y, -seatedCenter.z);

  stripTransmissiveMaterials(gltfScene);
  gltfScene.traverse((obj) => {
    if (obj.isMesh) {
      if (obj.geometry && !obj.geometry.boundingSphere) obj.geometry.computeBoundingSphere();
      const r = (obj.geometry?.boundingSphere?.radius ?? 0.5) * s;
      obj.castShadow = r > 0.16;
      obj.receiveShadow = true;
      obj.userData.historicRoverId = roverId;
    }
  });
  bindPerseveranceGltfRig(gltfScene);
  return gltfScene;
}

/**
 * Create a single rover 3D group (`THREE.Group`) with all child meshes tagged
 * for raycast inspection (`userData.historicRoverId = roverSpec.id`) and an attached
 * hierarchical `userData.rig`.
 */
export function createHistoricRoverGroup(
  THREE,
  gltfLoader,
  roverSpec,
  sharedTex = null,
  onModelLoaded = null,
  sharedTexSet = null
) {
  const tex = sharedTex || makeSharedTextures(THREE);
  const outer = new THREE.Group();
  outer.name = `historic-rover-${roverSpec.id}`;
  outer.userData.historicRoverId = roverSpec.id;

  let body;
  if (roverSpec.modelKind === "sojourner") {
    body = buildSojournerMesh(THREE, tex);
  } else if (roverSpec.modelKind === "mer-spirit" || roverSpec.modelKind === "mer-opportunity") {
    body = buildMerMesh(THREE, tex, roverSpec.modelKind);
  } else if (roverSpec.modelKind === "perseverance-glb" || roverSpec.id === "perseverance") {
    body = buildPerseveranceMesh(THREE, tex);
  } else {
    body = buildCuriosityMesh(THREE, tex);
  }
  compactHistoricRoverMeshes(THREE, body, body.userData.rig);
  outer.add(body);
  outer.userData.rig = body.userData.rig;

  // Ground locator ring so every historic mission stands out cleanly across red regolith
  const ringR = roverSpec.lengthM < 1 ? 0.72 : 1.85;
  const locator = new THREE.Mesh(
    new THREE.RingGeometry(ringR - 0.05, ringR, 40),
    new THREE.MeshBasicMaterial({
      color: roverSpec.color || "#4ade80",
      transparent: true,
      opacity: 0.48,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  locator.rotation.x = -Math.PI / 2;
  locator.position.y = 0.045;
  locator.userData.isLocator = true;
  outer.add(locator);

  const plaque = makeRoverPlaqueSprite(THREE, roverSpec);
  outer.add(plaque);

  outer.traverse((obj) => {
    obj.userData.historicRoverId = roverSpec.id;
    if (obj.isMesh && !obj.userData.isLocator) {
      if (obj.geometry && !obj.geometry.boundingSphere) obj.geometry.computeBoundingSphere();
      const r = obj.geometry?.boundingSphere?.radius ?? 0.4;
      obj.castShadow = r > 0.14;
      obj.receiveShadow = true;
    }
  });
  // one mesh per material and moving part instead of ~200 small ones (see merge-static.js)
  mergeRigidParts(THREE, body, collectRigNodes(body.userData.rig));


  if (roverSpec.modelKind === "perseverance-glb" && roverSpec.glbUrl && gltfLoader) {
    body.userData.isStandIn = true;
    loadGltfCached(THREE, gltfLoader, roverSpec.glbUrl)
      .then((gltf) => {
        if (!gltf?.scene || !outer.parent) return;
        const inst = gltf.scene.clone(true);
        inst.traverse((o) => {
          o.userData.sharedAsset = true;
          // A transmissive material makes three.js draw the whole scene a second time, every
          // frame, for the refraction behind one small glass part. Plain transparency instead.
          for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
            if (m.transmission > 0) {
              m.transmission = 0;
              m.transparent = true;
              m.opacity = Math.min(m.opacity, 0.45);
              m.needsUpdate = true;
            }
          }
        });
        const real = normalizePerseveranceGltf(THREE, inst, roverSpec.id);
        outer.remove(body);
        const texSet =
          sharedTexSet || new Set(Object.values(tex || {}).filter((t) => t?.isTexture));
        disposeRoverGroup(body, texSet);
        outer.add(real);
        outer.userData.rig = real.userData.rig || body.userData.rig;
        outer.traverse((obj) => {
          obj.userData.historicRoverId = roverSpec.id;
        });
        mergeRigidParts(THREE, real, collectRigNodes(real.userData.rig));
        if (typeof onModelLoaded === "function") onModelLoaded(outer);
      })
      .catch((err) => console.warn("[historic-rovers] Failed loading NASA GLB:", roverSpec.glbUrl, err));
  }

  return outer;
}

/**
 * Manages ALL 5 historic NASA Mars rovers simultaneously across scattered terrain spots.
 */
export function createHistoricRoverManager(THREE, gltfLoader, scene, { onModelLoaded = null } = {}) {
  const sharedTex = makeSharedTextures(THREE);
  const sharedTexSet = new Set(Object.values(sharedTex).filter((t) => t?.isTexture));
  const roster = new Map();
  let interactiveGroupsCache = null;
  let allEntriesCache = null;
  let focusedId = "curiosity";
  const modelLoadedCb = typeof onModelLoaded === "function" ? onModelLoaded : null;

  function clearAll() {
    for (const entry of roster.values()) {
      if (entry.group && scene) scene.remove(entry.group);
      if (entry.group) disposeRoverGroup(entry.group, sharedTexSet);
    }
    roster.clear();
    interactiveGroupsCache = null;
    allEntriesCache = null;
  }

  function groundEntry(entry, sampleElevY) {
    if (!entry?.group || !entry?.spec || !sampleElevY) return;
    const { group, spec } = entry;
    const x = group.position.x;
    const z = group.position.z;
    const yaw = group.rotation.y;
    const hw = Math.max(0.24, (spec.halfW || 1.2) * 0.72);
    const hl = Math.max(0.28, (spec.halfL || 1.4) * 0.72);
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const sampleWheel = (lx, lz) => sampleElevY(x + lx * cosY + lz * sinY, z - lx * sinY + lz * cosY);

    const fl = sampleWheel(-hw, -hl);
    const ml = sampleWheel(-hw, 0);
    const rl = sampleWheel(-hw, hl);
    const fr = sampleWheel(hw, -hl);
    const mr = sampleWheel(hw, 0);
    const rr = sampleWheel(hw, hl);
    const avgY = (fl + rl + fr + rr) * 0.25;
    const frontY = (fl + fr) * 0.5;
    const backY = (rl + rr) * 0.5;
    const leftY = (fl + rl) * 0.5;
    const rightY = (fr + rr) * 0.5;

    group.position.y = avgY;
    group.rotation.order = "YXZ";
    group.rotation.x = Math.max(-0.42, Math.min(0.42, Math.atan2(frontY - backY, 2 * hl)));
    group.rotation.z = Math.max(-0.42, Math.min(0.42, Math.atan2(leftY - rightY, 2 * hw)));

    entry.wheelDeltaHeights = [fl - avgY, ml - avgY, rl - avgY, fr - avgY, mr - avgY, rr - avgY];
  }

  function groundAll(sampleElevY) {
    if (!sampleElevY) return;
    for (const entry of roster.values()) {
      groundEntry(entry, sampleElevY);
    }
  }

  function update(dt, { sampleElevY = null, observerPos = null, clockT = 0 } = {}) {
    for (const entry of roster.values()) {
      const { group } = entry;
      const rig = group?.userData?.rig;
      if (!rig) continue;
      if (sampleElevY && !entry.wheelDeltaHeights) groundEntry(entry, sampleElevY);

      let relX = null;
      let relY = 0;
      let relZ = null;
      if (observerPos) {
        const dx = observerPos.x - group.position.x;
        const dy = observerPos.y - (group.position.y + 1.2);
        const dz = observerPos.z - group.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 55 * 55 && !(entry.driveSpeed > 0)) continue;
        const cosY = Math.cos(group.rotation.y);
        const sinY = Math.sin(group.rotation.y);
        relX = dx * cosY - dz * sinY;
        relY = dy;
        relZ = dx * sinY + dz * cosY;
      }

      stepRoverRigKinematics(rig, {
        dt,
        clockT,
        relObserverX: relX,
        relObserverY: relY,
        relObserverZ: relZ,
        wheelDeltaHeights: entry.wheelDeltaHeights || null,
        // set while you drive this rover (hud3d.js): wheels turn and the corner wheels steer
        driveSpeed: entry.driveSpeed || 0,
        steerAngle: entry.steerAngle || 0,
      });
    }
  }

  function spawnAllScattered(placements, { sampleElevY = null, focusId = "curiosity" } = {}) {
    clearAll();
    if (focusId) focusedId = focusId;
    if (!Array.isArray(placements)) return;

    for (const p of placements) {
      const spec = p?.spec;
      if (!spec) continue;
      let group = null;
      group = createHistoricRoverGroup(THREE, gltfLoader, spec, sharedTex, () => modelLoadedCb?.(group));
      const x = Number.isFinite(p.x) ? p.x : 0;
      const z = Number.isFinite(p.z) ? p.z : 0;
      const yaw = Number.isFinite(p.yaw) ? p.yaw : -0.35;
      group.position.set(x, sampleElevY ? sampleElevY(x, z) : 0, z);
      group.rotation.y = yaw;
      const entry = { id: spec.id, spec, group, baseX: x, baseZ: z, yaw, wheelDeltaHeights: null };
      if (sampleElevY) groundEntry(entry, sampleElevY);
      if (scene) scene.add(group);
      roster.set(spec.id, entry);
      if (modelLoadedCb) modelLoadedCb(group);
    }
  }

  function spawnForSite(roverSpec, { x = 0, z = 0, yaw = -0.35, sampleElevY = null } = {}) {
    if (!roverSpec) return null;
    focusedId = roverSpec.id;
    const existing = roster.get(roverSpec.id);
    if (existing) {
      existing.group.position.set(x, sampleElevY ? sampleElevY(x, z) : existing.group.position.y, z);
      existing.group.rotation.y = yaw;
      existing.baseX = x;
      existing.baseZ = z;
      existing.yaw = yaw;
      if (sampleElevY) groundEntry(existing, sampleElevY);
      return existing.group;
    }
    let group = null;
    group = createHistoricRoverGroup(
      THREE,
      gltfLoader,
      roverSpec,
      sharedTex,
      () => modelLoadedCb?.(group),
      sharedTexSet
    );
    group.position.set(x, sampleElevY ? sampleElevY(x, z) : 0, z);
    group.rotation.y = yaw;
    const entry = { id: roverSpec.id, spec: roverSpec, group, baseX: x, baseZ: z, yaw, wheelDeltaHeights: null };
    if (sampleElevY) groundEntry(entry, sampleElevY);
    if (scene) scene.add(group);
    roster.set(roverSpec.id, entry);
    interactiveGroupsCache = null;
    allEntriesCache = null;
    if (modelLoadedCb) modelLoadedCb(group);
    return group;
  }

  function wrapAllRelativeTo(refX, refZ, periodX, periodZ) {
    if (!Number.isFinite(periodX) || periodX <= 0 || !Number.isFinite(periodZ) || periodZ <= 0) return;
    for (const entry of roster.values()) {
      const kX = Math.round((refX - entry.baseX) / periodX);
      const kZ = Math.round((refZ - entry.baseZ) / periodZ);
      entry.group.position.x = entry.baseX + kX * periodX;
      entry.group.position.z = entry.baseZ + kZ * periodZ;
    }
  }

  function resolveCollision(entityX, entityZ, entityRadius = 0.45, entityY = null) {
    let best = { hit: false, x: entityX, z: entityZ, nx: 0, nz: 0, pen: 0 };
    let cx = entityX;
    let cz = entityZ;
    for (const entry of roster.values()) {
      const { group, spec } = entry;
      const maxR = Math.max(spec.halfW || 1.25, spec.halfL || 1.4) + entityRadius + 0.5;
      const dx = cx - group.position.x;
      const dz = cz - group.position.z;
      if (dx * dx + dz * dz > maxR * maxR) continue;
      const col = resolveRoverObbCollision(
        group.position.x,
        group.position.z,
        group.rotation.y,
        group.position.y,
        cx,
        cz,
        entityRadius,
        entityY,
        spec.halfW || 1.25,
        spec.halfL || 1.4,
        spec.heightM || 1.8
      );
      if (col.hit) {
        cx = col.x;
        cz = col.z;
        if (!best.hit || col.pen > best.pen) {
          best = col;
        }
        best.x = cx;
        best.z = cz;
      }
    }
    return best;
  }

  function setFocusId(id) {
    if (id && roster.has(id)) focusedId = id;
  }

  function getEntry(id) {
    return roster.get(String(id || "").toLowerCase()) || null;
  }

  return {
    spawnAllScattered,
    spawnForSite,
    clearAll,
    clearActive: clearAll,
    groundOnTerrain: groundAll,
    groundAll,
    update,
    wrapAllRelativeTo,
    resolveCollision,
    setFocusId,
    getEntry,
    getInteractiveGroups: () => (interactiveGroupsCache ||= Array.from(roster.values(), (e) => e.group)),
    getAllEntries: () => (allEntriesCache ||= Array.from(roster.values())),
    getActiveSpec: () => roster.get(focusedId)?.spec || roster.values().next().value?.spec || null,
    getActiveGroup: () => roster.get(focusedId)?.group || roster.values().next().value?.group || null,
  };
}
