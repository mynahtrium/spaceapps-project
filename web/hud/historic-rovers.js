/**
 * NASA Historic Mars Rovers 3D Assembly & Multi-Rover Placement Manager (`web/hud/historic-rovers.js`).
 *
 * Renders ALL 5 iconic NASA Mars rovers — Sojourner, Spirit, Opportunity, Curiosity,
 * and Perseverance — simultaneously across scattered safe-slope Martian terrain spots:
 *  - Perseverance loads NASA's official 68-mesh GLB (`mars-2020-perseverance.glb`).
 *  - Curiosity, Spirit, Opportunity, and Sojourner use museum-grade multi-part 3D
 *    engineering assemblies with open-spoked chevron/cleat wheels, crinkled Kapton
 *    bump foil, parabolic HGA feedhorns, solar cell busbars, articulated IDD/robotic
 *    arms, stereo optic domes, and JPL/NASA canvas decals.
 *  - Every mesh tags `userData.historicRoverId` for reticle raycast inspection & modal info.
 */

import { resolveRoverObbCollision } from "./experimental-rover.js";

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
    g.fillStyle = "#0a1730";
    g.fillRect(0, 0, w, h);
    // Crisp dark photovoltaic cell rectangles + silver-gold busbars
    for (let y = 0; y < h; y += 32) {
      for (let x = 0; x < w; x += 24) {
        g.fillStyle = (x + y) % 48 === 0 ? "#12294d" : "#0e213f";
        g.fillRect(x + 2, y + 2, 20, 28);
      }
    }
    g.strokeStyle = "#3c6cb0";
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
    g.strokeStyle = "#d1af61";
    g.lineWidth = 1.5;
    for (let y = 16; y < h; y += 32) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
  });

  const kaptonTex = createCanvasTex(THREE, 256, 256, (g, w, h) => {
    g.fillStyle = "#b07628";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 320; i++) {
      const x = (i * 47 + Math.floor(i / 7) * 19) % w;
      const y = (i * 83 + Math.floor(i / 5) * 11) % h;
      const rw = 6 + (i % 22);
      const rh = 3 + ((i * 3) % 14);
      g.fillStyle = i % 3 === 0 ? "rgba(248, 198, 86, 0.38)" : i % 3 === 1 ? "rgba(86, 46, 12, 0.34)" : "rgba(202, 138, 42, 0.25)";
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
        g.strokeStyle = i % 2 === 0 ? "#d4d4d4" : "#3a3a3a";
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
    g.fillStyle = "#ebe6dc";
    g.fillRect(0, 0, w, h);
    // Panel seam framing & bolted hatches
    g.strokeStyle = "#8c857b";
    g.lineWidth = 3;
    g.strokeRect(8, 8, w - 16, h - 16);
    g.strokeStyle = "#b8b0a3";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(w * 0.42, 10);
    g.lineTo(w * 0.42, h - 10);
    g.moveTo(w * 0.72, 10);
    g.lineTo(w * 0.72, h - 10);
    g.stroke();

    // Recessed dark avionics louver grille
    g.fillStyle = "#1f242c";
    g.fillRect(28, 34, 150, 32);
    g.strokeStyle = "#4b5563";
    g.lineWidth = 2;
    for (let lx = 36; lx < 172; lx += 12) {
      g.beginPath();
      g.moveTo(lx, 36);
      g.lineTo(lx, 64);
      g.stroke();
    }

    // Braided orange & obsidian wiring harness sweep (Curiosity iconic side silhouette)
    g.lineCap = "round";
    g.strokeStyle = "#d97706";
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(24, 118);
    g.bezierCurveTo(150, 88, 310, 155, 488, 112);
    g.stroke();
    g.strokeStyle = "#18181b";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(24, 128);
    g.bezierCurveTo(150, 98, 310, 165, 488, 122);
    g.stroke();

    // Gold circular thermal ports & JPL red-blue livery block
    for (const px of [246, 286, 336]) {
      g.fillStyle = "#b47b2b";
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

  const merEmblemTex = createCanvasTex(THREE, 256, 128, (g, w, h) => {
    g.fillStyle = "#9f6922";
    g.fillRect(0, 0, w, h);
    // Gold Kapton crinkle texture base
    for (let i = 0; i < 64; i++) {
      g.fillStyle = i % 2 === 0 ? "rgba(245, 195, 86, 0.25)" : "rgba(62, 34, 10, 0.25)";
      g.fillRect((i * 37) % w, (i * 53) % h, 18, 10);
    }
    // White calibration plate + NASA circular meatball emblem
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
    g.fillStyle = "#2f3339";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#915235"; // Martian ferric dust packed along rims
    g.fillRect(0, 0, w, h * 0.16);
    g.fillRect(0, h * 0.84, w, h * 0.16);
    g.strokeStyle = "#b4bac4";
    g.lineWidth = 5;
    for (let x = -32; x < w + 32; x += 22) {
      g.beginPath();
      g.moveTo(x, 10);
      g.lineTo(x + 12, h / 2);
      g.lineTo(x, h - 10);
      g.stroke();
    }
  });
  if (chevronTireTex) {
    chevronTireTex.wrapS = THREE.RepeatWrapping;
    chevronTireTex.repeat.set(3, 1);
  }

  return { solarTex, kaptonTex, kaptonBumpTex, mslBodyTex, merEmblemTex, chevronTireTex };
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
 * Open-spoked hollow rover wheel matching NASA Curiosity/MER titanium spring wheels:
 * thin cylindrical drum (open ended so daylight shows through!), outer beadlock rings,
 * curved inner spokes, and central machined drive hub.
 */
function buildHollowSpokedWheel(THREE, radius, width, tireMat, hubMat, spokes = 6, cleatCount = 12) {
  const wg = new THREE.Group();

  const shellMat = tireMat.clone();
  shellMat.side = THREE.DoubleSide;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 24, 1, true), shellMat);
  drum.rotation.z = Math.PI / 2;
  wg.add(drum);

  // Inner dark metallic barrel liner slightly inset
  const hubCollar = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.28, radius * 0.28, width * 0.92, 14),
    hubMat
  );
  hubCollar.rotation.z = Math.PI / 2;
  wg.add(hubCollar);

  // Outer machined rim flanges (open rings)
  const flangeGeom = new THREE.TorusGeometry(radius * 0.94, Math.max(0.006, radius * 0.055), 8, 22);
  flangeGeom.rotateY(Math.PI / 2);
  for (const sx of [-width * 0.46, width * 0.46]) {
    const ring = new THREE.Mesh(flangeGeom, hubMat);
    ring.position.x = sx;
    wg.add(ring);
  }

  // Curved titanium flex-spokes visible cleanly inside hollow wheel rim
  const spokeLen = radius * 0.72;
  const spokeGeom = new THREE.BoxGeometry(width * 0.14, spokeLen, Math.max(0.01, radius * 0.085));
  for (let i = 0; i < spokes; i++) {
    const ang = (i / spokes) * Math.PI * 2;
    const sp = new THREE.Mesh(spokeGeom, hubMat);
    sp.position.set(
      width * 0.12,
      Math.cos(ang) * radius * 0.54,
      Math.sin(ang) * radius * 0.54
    );
    sp.rotation.x = ang + 0.34; // signature NASA spiral flex-spoke tilt
    wg.add(sp);
  }

  // Outer circumferential cleats for close-up crisp silhouette
  const cleatGeom = new THREE.BoxGeometry(width * 0.9, Math.max(0.005, radius * 0.045), Math.max(0.01, radius * 0.11));
  for (let c = 0; c < cleatCount; c++) {
    const a = (c / cleatCount) * Math.PI * 2;
    const cl = new THREE.Mesh(cleatGeom, hubMat);
    cl.position.set(0, Math.cos(a) * radius, Math.sin(a) * radius);
    cl.rotation.x = -a;
    wg.add(cl);
  }

  return wg;
}

function buildSojournerMesh(THREE, tex) {
  const root = new THREE.Group();
  const kaptonMat = new THREE.MeshStandardMaterial({
    color: 0xd99b38,
    map: tex.kaptonTex,
    bumpMap: tex.kaptonBumpTex,
    bumpScale: 0.012,
    roughness: 0.32,
    metalness: 0.78,
  });
  const solarMat = new THREE.MeshStandardMaterial({
    map: tex.solarTex,
    roughness: 0.22,
    metalness: 0.65,
  });
  const aluMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.38, metalness: 0.86 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.62, metalness: 0.48 });
  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x735b4d,
    map: tex.chevronTireTex,
    roughness: 0.8,
    metalness: 0.38,
  });

  // Warm Electronics Box (WEB) wrapped in crinkled Kapton MLI + silver side brackets
  const web = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.48), kaptonMat);
  web.position.set(0, 0.17, 0);
  root.add(web);
  for (const sx of [-0.185, 0.185]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.04, 0.46), aluMat);
    rail.position.set(sx, 0.18, 0);
    root.add(rail);
  }

  // Signature overhanging notched Mars Pathfinder solar panel deck
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.022, 0.66), aluMat);
  frame.position.set(0, 0.26, 0);
  root.add(frame);
  const solar = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.012, 0.62), solarMat);
  solar.position.set(0, 0.273, 0);
  root.add(solar);
  const rearDeckTab = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.018, 0.08), aluMat);
  rearDeckTab.position.set(0.08, 0.258, 0.35);
  root.add(rearDeckTab);

  // Silver UHF whip antenna + yellow base collar & MAE quartz disc
  const whipCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.05, 8), kaptonMat);
  whipCollar.position.set(-0.17, 0.29, 0.21);
  root.add(whipCollar);
  const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.008, 0.36, 8), aluMat);
  whip.position.set(-0.17, 0.47, 0.21);
  root.add(whip);
  const whipTip = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 8), aluMat);
  whipTip.position.set(-0.17, 0.65, 0.21);
  root.add(whipTip);

  // Front (-Z) twin stereo monochrome cameras + red laser stripe projector bar
  for (const sx of [-0.08, 0.08]) {
    const cam = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.038, 0.042), darkMat);
    cam.position.set(sx, 0.19, -0.25);
    root.add(cam);
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.018, 10),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.15, metalness: 0.85 })
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.set(sx, 0.19, -0.275);
    root.add(lens);
  }

  // Rear (+Z) deployed APXS alpha-proton-X-ray spectrometer drum on fork
  const apxsArm = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.025, 0.14), aluMat);
  apxsArm.position.set(0.09, 0.16, 0.29);
  root.add(apxsArm);
  const apxsHead = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.068, 14), kaptonMat);
  apxsHead.rotation.x = Math.PI / 2;
  apxsHead.position.set(0.09, 0.16, 0.37);
  root.add(apxsHead);

  // 6 tiny open-spoked cleated aluminum wheels + stainless rocker-bogie Y-linkages
  const wheelR = 0.068;
  const wheelW = 0.084;
  for (const side of [-1, 1]) {
    const xPos = side * 0.235;
    for (const zPos of [-0.23, 0.0, 0.23]) {
      const w = buildHollowSpokedWheel(THREE, wheelR, wheelW, tireMat, aluMat, 4, 8);
      w.position.set(xPos, wheelR, zPos);
      root.add(w);
    }
    const strutFront = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.28, 8), aluMat);
    strutFront.position.set(side * 0.205, 0.14, -0.115);
    strutFront.rotation.x = 0.45;
    root.add(strutFront);
    const strutRear = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.28, 8), aluMat);
    strutRear.position.set(side * 0.205, 0.14, 0.115);
    strutRear.rotation.x = -0.45;
    root.add(strutRear);
    const crossTube = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.12, 8), aluMat);
    crossTube.rotation.z = Math.PI / 2;
    crossTube.position.set(side * 0.18, 0.18, 0);
    root.add(crossTube);
  }

  return root;
}

function buildMerMesh(THREE, tex, variant) {
  const root = new THREE.Group();
  const isOppy = variant === "mer-opportunity";

  const kaptonMat = new THREE.MeshStandardMaterial({
    color: 0xcf9434,
    map: tex.kaptonTex,
    bumpMap: tex.kaptonBumpTex,
    bumpScale: 0.018,
    roughness: 0.32,
    metalness: 0.82,
  });
  const solarMat = new THREE.MeshStandardMaterial({
    map: tex.solarTex,
    roughness: 0.24,
    metalness: 0.56,
  });
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

  // Tapered Warm Electronics Box (WEB) wrapped in crinkled Kapton MLI + NASA meatball plaques
  const web = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.39, 0.9), kaptonMat);
  web.position.set(0, 0.44, 0.04);
  root.add(web);
  for (const sx of [-0.425, 0.425]) {
    const sideDecal = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.3, 0.56), emblemMat);
    sideDecal.position.set(sx, 0.45, 0.04);
    root.add(sideDecal);
  }
  const frontAppliance = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.22, 0.08), darkMat);
  frontAppliance.position.set(0, 0.42, -0.43);
  root.add(frontAppliance);

  // Iconic swept butterfly triangular MER solar array wings (~2.32 m wide, 1.56 m fore-aft)
  const centerDeck = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.032, 1.15), solarMat);
  centerDeck.position.set(0, 0.65, 0.04);
  root.add(centerDeck);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.026, 0.98), solarMat);
    wing.position.set(side * 0.84, 0.67, 0.06);
    wing.rotation.z = side * 0.055;
    wing.rotation.y = side * -0.14; // characteristic butterfly taper
    root.add(wing);
    const wingTrim = new THREE.Mesh(new THREE.BoxGeometry(0.69, 0.03, 0.042), kaptonMat);
    wingTrim.position.set(side * 0.82, 0.67, 0.54);
    wingTrim.rotation.z = side * 0.055;
    wingTrim.rotation.y = side * -0.14;
    root.add(wingTrim);
    // Diagonal wing support strut under solar array
    const underStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.66, 8), strutMat);
    underStrut.position.set(side * 0.62, 0.53, 0.08);
    underStrut.rotation.z = side * 1.12;
    root.add(underStrut);
  }
  const rearWing = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.026, 0.48), solarMat);
  rearWing.position.set(0, 0.66, 0.74);
  rearWing.rotation.x = 0.04;
  root.add(rearWing);

  // Tall white Pancam Mast Assembly (PMA) + dual recessed optical lenses + solar azimuth collar
  const mastBase = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.11, 0.11, 14), kaptonMat);
  mastBase.position.set(0.14, 0.7, -0.34);
  root.add(mastBase);
  const mastTube = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.064, 0.72, 14), creamMat);
  mastTube.position.set(0.14, 1.07, -0.34);
  root.add(mastTube);
  // Black helical mast wiring wrap
  const mastCable = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.008, 6, 16), darkMat);
  mastCable.position.set(0.14, 1.14, -0.34);
  mastCable.rotation.x = Math.PI / 2 - 0.18;
  root.add(mastCable);
  const pmaCross = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.15), creamMat);
  pmaCross.position.set(0.14, 1.44, -0.34);
  root.add(pmaCross);
  for (const dx of [-0.15, 0.15]) {
    const pancamPod = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.08, 0.12), creamMat);
    pancamPod.position.set(0.14 + dx, 1.49, -0.35);
    root.add(pancamPod);
    const lensRing = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.045, 12), darkMat);
    lensRing.rotation.x = Math.PI / 2;
    lensRing.position.set(0.14 + dx, 1.49, -0.42);
    root.add(lensRing);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 12), opticGlass);
    glass.rotation.x = Math.PI / 2;
    glass.position.set(0.14 + dx, 1.49, -0.425);
    root.add(glass);
  }
  for (const dx of [-0.045, 0.045]) {
    const navEye = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.055, 10), opticGlass);
    navEye.rotation.x = Math.PI / 2;
    navEye.position.set(0.14 + dx, 1.43, -0.415);
    root.add(navEye);
  }

  // Rear gimbaled parabolic copper-gold High-Gain Antenna dish + tripod feedhorn + LGA whip
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
  const hgaPivot = new THREE.Group();
  hgaPivot.position.set(-0.2, 0.86, 0.44);
  hgaPivot.rotation.set(-0.82, isOppy ? 0.32 : -0.24, 0.25);
  const dish = new THREE.Mesh(dishGeom, hgaMat);
  hgaPivot.add(dish);
  const dishFeed = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.024, 0.18, 10), darkMat);
  dishFeed.position.set(0, 0.09, 0);
  hgaPivot.add(dishFeed);
  const dishTip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.024, 0.03, 10), kaptonMat);
  dishTip.position.set(0, 0.18, 0);
  hgaPivot.add(dishTip);
  root.add(hgaPivot);

  const lga = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.024, 0.62, 8), darkMat);
  lga.position.set(0.15, 0.97, 0.38);
  root.add(lga);

  // Articulated 3-joint Instrument Deployment Device (IDD) arm + RAT / Mössbauer / MI turret
  const iddShoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.1, 10), strutMat);
  iddShoulder.position.set(-0.15, 0.46, -0.44);
  root.add(iddShoulder);
  const iddBoom1 = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.058, 0.36), creamMat);
  iddBoom1.position.set(-0.16, 0.45, -0.62);
  iddBoom1.rotation.x = -0.18;
  root.add(iddBoom1);
  const iddBoom2 = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.048, 0.28), strutMat);
  iddBoom2.position.set(-0.16, 0.39, -0.84);
  iddBoom2.rotation.x = isOppy ? 0.35 : -0.42;
  root.add(iddBoom2);
  const iddTurret = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.13, 14), darkMat);
  iddTurret.rotation.z = Math.PI / 2;
  iddTurret.position.set(-0.16, isOppy ? 0.34 : 0.42, -0.98);
  root.add(iddTurret);
  const ratHead = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.08, 12), kaptonMat);
  ratHead.rotation.x = Math.PI / 2;
  ratHead.position.set(-0.16, isOppy ? 0.34 : 0.42, -1.06);
  root.add(ratHead);

  // 6 open-spoked rocker-bogie wheels + articulated aluminum Y-tubes
  const wheelR = 0.128;
  const wheelW = 0.156;
  for (const side of [-1, 1]) {
    const wx = side * 0.57;
    const bogieZ = [-0.66, 0.02, 0.62];
    for (const wz of bogieZ) {
      const w = buildHollowSpokedWheel(THREE, wheelR, wheelW, tireMat, strutMat, 6, 12);
      w.position.set(wx, wheelR, wz);
      root.add(w);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.14, 10), strutMat);
      collar.position.set(wx, wheelR + 0.11, wz);
      root.add(collar);
    }
    const frontLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.72, 10), strutMat);
    frontLeg.position.set(side * 0.49, 0.31, -0.34);
    frontLeg.rotation.x = -0.48;
    frontLeg.rotation.z = side * 0.18;
    root.add(frontLeg);
    const rearLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.64, 10), strutMat);
    rearLeg.position.set(side * 0.49, 0.3, 0.32);
    rearLeg.rotation.x = 0.46;
    rearLeg.rotation.z = side * 0.18;
    root.add(rearLeg);
  }

  return root;
}

function buildCuriosityMesh(THREE, tex) {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    map: tex.mslBodyTex,
    roughness: 0.4,
    metalness: 0.22,
  });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe7e2d6, roughness: 0.44, metalness: 0.18 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x16191e, roughness: 0.48, metalness: 0.76 });
  const tiMat = new THREE.MeshStandardMaterial({ color: 0xa1a8b3, roughness: 0.34, metalness: 0.88 });
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
    metalness: 0.48,
  });

  // Main MSL warm electronics hull + lower aluminum skid tub + rear MMRTG cradle
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.62, 1.94), bodyMat);
  chassis.position.set(0, 0.84, 0.04);
  root.add(chassis);
  const bellyPlate = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.08, 1.72), darkMetal);
  bellyPlate.position.set(0, 0.5, 0.04);
  root.add(bellyPlate);

  // Top rover avionics deck, sample inlet funnels & SAM vent stacks
  const topTrim = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.06, 1.78), whiteMat);
  topTrim.position.set(0, 1.16, 0.04);
  root.add(topTrim);
  const diffCrossTube = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.38, 12), darkMetal);
  diffCrossTube.rotation.z = Math.PI / 2;
  diffCrossTube.position.set(0, 1.24, -0.05);
  root.add(diffCrossTube);

  // Gimbaled hexagonal white High-Gain Antenna dish + tripod feedhorn
  const hgaDeck = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.25, 0.032, 18), whiteMat);
  hgaDeck.position.set(-0.24, 1.28, 0.5);
  hgaDeck.rotation.set(0.38, -0.25, 0);
  root.add(hgaDeck);
  const hgaFeed = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.14, 8), darkMetal);
  hgaFeed.position.set(-0.24, 1.35, 0.52);
  hgaFeed.rotation.x = 0.38;
  root.add(hgaFeed);

  // Signature rear tilted Pu-238 MMRTG + 8 finned cooling manifolds + heat exchanger tubes
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
  root.add(rtgGroup);

  // UHF rear helical antenna mast
  const uhfPole = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.056, 0.48, 12), darkMetal);
  uhfPole.position.set(0.34, 1.4, 0.78);
  root.add(uhfPole);

  // Front skirt stereo Hazard Avoidance Cameras (Hazcams) + REMS boom sensor stubs
  for (const sx of [-0.34, -0.24, 0.24, 0.34]) {
    const haz = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.04), darkMetal);
    haz.position.set(sx, 0.68, -0.94);
    root.add(haz);
  }

  // Tall Remote Sensing Mast (RSM) + Iconic square white ChemCam head & dual Mastcam lenses
  const mastCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.11, 0.14, 14), darkMetal);
  mastCollar.position.set(0.24, 1.24, -0.56);
  root.add(mastCollar);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.08, 0.94, 16), whiteMat);
  mast.position.set(0.24, 1.66, -0.56);
  root.add(mast);
  const mastAzRing = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.08, 14), goldMat);
  mastAzRing.position.set(0.24, 1.98, -0.56);
  root.add(mastAzRing);
  const headBox = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.26, 0.34), whiteMat);
  headBox.position.set(0.24, 2.15, -0.56);
  root.add(headBox);
  const chemBezel = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.06, 18), darkMetal);
  chemBezel.rotation.x = Math.PI / 2;
  chemBezel.position.set(0.14, 2.17, -0.74);
  root.add(chemBezel);
  const chemGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.068, 18), lensMat);
  chemGlass.rotation.x = Math.PI / 2;
  chemGlass.position.set(0.14, 2.17, -0.745);
  root.add(chemGlass);
  for (const lx of [0.3, 0.38]) {
    const mc = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.055, 0.06), darkMetal);
    mc.position.set(lx, 2.11, -0.74);
    root.add(mc);
    const mcLens = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.07, 10), lensMat);
    mcLens.rotation.x = Math.PI / 2;
    mcLens.position.set(lx, 2.11, -0.745);
    root.add(mcLens);
  }

  // Extended front 5-axis Robotic Sample Arm + rotary drill/MAHLI/APXS turret (Curiosity reference pose!)
  const armShoulder = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.26), darkMetal);
  armShoulder.position.set(-0.2, 0.72, -0.98);
  root.add(armShoulder);
  const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.82, 12), tiMat);
  upperArm.rotation.x = Math.PI / 2;
  upperArm.position.set(-0.22, 0.68, -1.39);
  root.add(upperArm);
  const elbowJoint = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.14, 14), darkMetal);
  elbowJoint.rotation.z = Math.PI / 2;
  elbowJoint.position.set(-0.22, 0.7, -1.78);
  root.add(elbowJoint);
  const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.68, 12), whiteMat);
  forearm.position.set(-0.22, 1.04, -1.78);
  root.add(forearm);
  const turret = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.36), darkMetal);
  turret.position.set(-0.22, 1.4, -1.78);
  root.add(turret);
  const drillNose = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.025, 0.22, 12), tiMat);
  drillNose.rotation.x = Math.PI / 2;
  drillNose.position.set(-0.22, 1.42, -2.02);
  root.add(drillNose);
  const turretGold = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.18, 12), goldMat);
  turretGold.rotation.z = Math.PI / 2;
  turretGold.position.set(-0.04, 1.4, -1.78);
  root.add(turretGold);

  // Rocker-Bogie Differential + 6 HOLLOW OPEN-SPOKED Titanium Chevron Mars Wheels
  const wheelR = 0.255;
  const wheelW = 0.39;
  for (const side of [-1, 1]) {
    const wx = side * 1.19;
    const wheelZs = [-1.06, 0.08, 1.09];
    for (const wz of wheelZs) {
      const w = buildHollowSpokedWheel(THREE, wheelR, wheelW, tireMat, tiMat, 6, 16);
      w.position.set(wx, wheelR, wz);
      root.add(w);
      const steerKnuckle = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.048, 0.22, 10), darkMetal);
      steerKnuckle.position.set(wx, wheelR + 0.21, wz);
      root.add(steerKnuckle);
      const forkArm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.16), tiMat);
      forkArm.position.set(wx - side * 0.08, wheelR + 0.1, wz);
      root.add(forkArm);
    }
    const rockerMain = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 1.24, 10), darkMetal);
    rockerMain.position.set(side * 0.94, 0.74, -0.5);
    rockerMain.rotation.x = 0.98;
    rockerMain.rotation.z = side * 0.22;
    root.add(rockerMain);

    const bogieRear = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 1.08, 10), darkMetal);
    bogieRear.position.set(side * 1.04, 0.53, 0.58);
    bogieRear.rotation.x = 1.38;
    root.add(bogieRear);

    const rockerPivot = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.16, 12), tiMat);
    rockerPivot.rotation.z = Math.PI / 2;
    rockerPivot.position.set(side * 0.72, 0.92, 0.02);
    root.add(rockerPivot);
  }

  return root;
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

  gltfScene.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      obj.userData.historicRoverId = roverId;
    }
  });
  return gltfScene;
}

/**
 * Create a single rover 3D group (`THREE.Group`) with all child meshes tagged
 * for raycast inspection (`userData.historicRoverId = roverSpec.id`).
 */
export function createHistoricRoverGroup(THREE, gltfLoader, roverSpec, sharedTex = null) {
  const tex = sharedTex || makeSharedTextures(THREE);
  const outer = new THREE.Group();
  outer.name = `historic-rover-${roverSpec.id}`;
  outer.userData.historicRoverId = roverSpec.id;

  let body;
  if (roverSpec.modelKind === "sojourner") {
    body = buildSojournerMesh(THREE, tex);
  } else if (roverSpec.modelKind === "mer-spirit" || roverSpec.modelKind === "mer-opportunity") {
    body = buildMerMesh(THREE, tex, roverSpec.modelKind);
  } else {
    body = buildCuriosityMesh(THREE, tex);
  }
  outer.add(body);

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
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  if (roverSpec.modelKind === "perseverance-glb" && roverSpec.glbUrl && gltfLoader) {
    body.userData.isStandIn = true;
    gltfLoader
      .loadAsync(roverSpec.glbUrl)
      .then((gltf) => {
        if (!gltf?.scene || !outer.parent) return;
        const real = normalizePerseveranceGltf(THREE, gltf.scene, roverSpec.id);
        outer.remove(body);
        outer.add(real);
        outer.traverse((obj) => {
          obj.userData.historicRoverId = roverSpec.id;
        });
      })
      .catch((err) => console.warn("[historic-rovers] Failed loading NASA GLB:", roverSpec.glbUrl, err));
  }

  return outer;
}

/**
 * Manages ALL 5 historic NASA Mars rovers simultaneously across scattered terrain spots.
 */
export function createHistoricRoverManager(THREE, gltfLoader, scene) {
  const sharedTex = makeSharedTextures(THREE);
  const roster = new Map();
  let focusedId = "curiosity";

  function clearAll() {
    for (const entry of roster.values()) {
      if (entry.group && scene) scene.remove(entry.group);
    }
    roster.clear();
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
    const fr = sampleWheel(hw, -hl);
    const bl = sampleWheel(-hw, hl);
    const br = sampleWheel(hw, hl);
    const avgY = (fl + fr + bl + br) * 0.25;
    const frontY = (fl + fr) * 0.5;
    const backY = (bl + br) * 0.5;
    const leftY = (fl + bl) * 0.5;
    const rightY = (fr + br) * 0.5;

    group.position.y = avgY;
    group.rotation.order = "YXZ";
    group.rotation.x = Math.max(-0.42, Math.min(0.42, Math.atan2(frontY - backY, 2 * hl)));
    group.rotation.z = Math.max(-0.42, Math.min(0.42, Math.atan2(leftY - rightY, 2 * hw)));
  }

  function groundAll(sampleElevY) {
    if (!sampleElevY) return;
    for (const entry of roster.values()) {
      groundEntry(entry, sampleElevY);
    }
  }

  function spawnAllScattered(placements, { sampleElevY = null, focusId = "curiosity" } = {}) {
    clearAll();
    if (focusId) focusedId = focusId;
    if (!Array.isArray(placements)) return;

    for (const p of placements) {
      const spec = p?.spec;
      if (!spec) continue;
      const group = createHistoricRoverGroup(THREE, gltfLoader, spec, sharedTex);
      const x = Number.isFinite(p.x) ? p.x : 0;
      const z = Number.isFinite(p.z) ? p.z : 0;
      const yaw = Number.isFinite(p.yaw) ? p.yaw : -0.35;
      group.position.set(x, sampleElevY ? sampleElevY(x, z) : 0, z);
      group.rotation.y = yaw;
      const entry = { id: spec.id, spec, group, baseX: x, baseZ: z, yaw };
      if (sampleElevY) groundEntry(entry, sampleElevY);
      if (scene) scene.add(group);
      roster.set(spec.id, entry);
    }
  }

  // Legacy convenience wrapper spawning 1 or focusing 1 entry
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
    const group = createHistoricRoverGroup(THREE, gltfLoader, roverSpec, sharedTex);
    group.position.set(x, sampleElevY ? sampleElevY(x, z) : 0, z);
    group.rotation.y = yaw;
    const entry = { id: roverSpec.id, spec: roverSpec, group, baseX: x, baseZ: z, yaw };
    if (sampleElevY) groundEntry(entry, sampleElevY);
    if (scene) scene.add(group);
    roster.set(roverSpec.id, entry);
    return group;
  }

  /**
   * Keeps every scattered historic rover mapped cleanly to the periodic world window
   * nearest the observer (`period = 2 * worldW`), so crossing a world edge never pops rovers out of sight.
   */
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
    wrapAllRelativeTo,
    resolveCollision,
    setFocusId,
    getEntry,
    getInteractiveGroups: () => Array.from(roster.values(), (e) => e.group),
    getAllEntries: () => Array.from(roster.values()),
    getActiveSpec: () => roster.get(focusedId)?.spec || roster.values().next().value?.spec || null,
    getActiveGroup: () => roster.get(focusedId)?.group || roster.values().next().value?.group || null,
  };
}
