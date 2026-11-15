/**
 * Interactive Astronaut NPC Spawner, Animation & Static Anchor System (`web/hud/npc-system.js`).
 *
 * Responsibilities:
 *  1. Spawns the 7 active Astronaut/Engineer NPCs in front of each of the 7 Mars vehicles in the
 *     Green Zone (Rover Garage / Vehicle Spawn Bay), using NASA suit geometry (`createAstronaut`)
 *     plus floating helmet name/title tags, subtle idle animations, and smooth player-facing turns.
 *  2. Strictly enforces the Static Anchor Rule for the 2 drivable vehicles (`mmsev` and
 *     `mars_robo_concept`): NPC 1 and NPC 2 are parented directly to `npcGroup` in the world scene
 *     (NEVER parented to vehicle meshes) and remain stationary at their initial bay parking spots
 *     when the player drives either rover away.
 *  3. Provides a modular disabled/placeholder `spawnCorridorScreenNPCs()` function for future
 *     Pink Zone corridor screen NPCs (NOT spawned yet).
 */

import { MARS_STATION_NPCS, CORRIDOR_SCREEN_NPC_SPECS } from "./npc-knowledge.js";
import { mergeStaticMeshes } from "./merge-static.js";

const NPC_COLLISION_RADIUS_M = 0.48;
const NPC_HEIGHT_M = 1.85;
const NPC_FACE_PLAYER_DIST_M = 6.5;

function normalizeAngleRad(a) {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

function lerpAngleRad(current, target, alpha) {
  const diff = normalizeAngleRad(target - current);
  return normalizeAngleRad(current + diff * Math.min(1, Math.max(0, alpha)));
}

/**
 * Computes a bay coordinate cleanly in front of a parked vehicle whose local forward is `-Z`.
 */
export function computeSpotInFrontOfVehicle(vx, vz, vYaw = 0, standoffM = 3.2, sideOffsetM = 0) {
  const sinY = Math.sin(vYaw);
  const cosY = Math.cos(vYaw);
  const fwdX = -sinY;
  const fwdZ = -cosY;
  const rightX = cosY;
  const rightZ = -sinY;
  return {
    x: vx + fwdX * standoffM + rightX * sideOffsetM,
    z: vz + fwdZ * standoffM + rightZ * sideOffsetM,
    // Look outward along the same general heading (+slight turn back toward rover nose? Face outward toward visitor)
    yaw: normalizeAngleRad(vYaw),
  };
}

/**
 * Disabled / Placeholder Spawner for Pink Zone (Corridor) Info Screen NPCs.
 * Kept modular and intentionally disabled until corridor info screens are added to the scene.
 */
export function spawnCorridorScreenNPCs({ scene = null, suitRig = null, sampleElevY = null, forceEnable = false } = {}) {
  if (!forceEnable) {
    return {
      spawned: false,
      count: 0,
      reason: "Pink Zone corridor screens not yet implemented — placeholder disabled by default.",
      specs: CORRIDOR_SCREEN_NPC_SPECS,
      npcs: [],
    };
  }
  // Future modular spawn hook when `forceEnable: true` is passed after corridor screens exist:
  return {
    spawned: true,
    count: CORRIDOR_SCREEN_NPC_SPECS.length,
    reason: "Enabled via forceEnable flag",
    specs: CORRIDOR_SCREEN_NPC_SPECS,
    hasScene: Boolean(scene),
    hasSuitRig: Boolean(suitRig),
    hasTerrainSampler: typeof sampleElevY === "function",
    npcs: [],
  };
}

function buildProceduralSuitStandIn(THREE, accentHex = "#38bdf8") {
  const root = new THREE.Group();
  const suitWhite = new THREE.MeshStandardMaterial({ color: 0xe8edf3, roughness: 0.58, metalness: 0.08 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.42, metalness: 0.25 });
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.78, metalness: 0.15 });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0xd99b26,
    roughness: 0.18,
    metalness: 0.85,
    emissive: 0x2b1704,
    emissiveIntensity: 0.3,
  });

  // Legs
  for (const sx of [-0.14, 0.14]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.085, 0.84, 8), suitWhite);
    leg.position.set(sx, 0.44, 0);
    leg.castShadow = true;
    root.add(leg);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.11, 0.24), bootMat);
    boot.position.set(sx, 0.055, -0.04);
    boot.castShadow = true;
    root.add(boot);
  }

  // Torso + chest accent panel + PLSS backpack
  const chest = new THREE.Group();
  chest.position.set(0, 1.18, 0);
  root.add(chest);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.56, 0.28), suitWhite);
  torso.castShadow = true;
  chest.add(torso);

  const badgePanel = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.03), accentMat);
  badgePanel.position.set(0, 0.06, -0.145);
  chest.add(badgePanel);

  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.48, 0.18), suitWhite);
  pack.position.set(0, 0.02, 0.21);
  pack.castShadow = true;
  chest.add(pack);

  // Arms
  for (const sx of [-0.30, 0.30]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.58, 8), suitWhite);
    arm.position.set(sx, -0.02, -0.02);
    arm.rotation.z = sx < 0 ? 0.12 : -0.12;
    arm.castShadow = true;
    chest.add(arm);

    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.06, 8), accentMat);
    cuff.position.set(sx * 1.08, -0.25, -0.02);
    chest.add(cuff);
  }

  // Head + Helmet
  const head = new THREE.Group();
  head.position.set(0, 0.36, 0);
  chest.add(head);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.165, 14, 12), suitWhite);
  helmet.castShadow = true;
  head.add(helmet);

  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.145, 14, 10, 0, Math.PI, 0.35, 1.8), visorMat);
  visor.position.set(0, 0.01, -0.035);
  visor.rotation.y = Math.PI;
  head.add(visor);

  // Merge static sub-meshes per articulated level while keeping head and chest animation pivots intact.
  const markNoMerge = (node, flag) => {
    node.traverse((o) => {
      if (!o.userData) o.userData = {};
      if (flag) o.userData.noMerge = true;
      else delete o.userData.noMerge;
    });
  };
  markNoMerge(chest, true);
  mergeStaticMeshes(THREE, root, { castShadow: true, receiveShadow: true });
  markNoMerge(chest, false);
  markNoMerge(head, true);
  mergeStaticMeshes(THREE, chest, { castShadow: true, receiveShadow: true });
  markNoMerge(head, false);
  mergeStaticMeshes(THREE, head, { castShadow: true, receiveShadow: true });

  return {
    group: root,
    bones: { head, chest, spine: chest },
    isStandIn: true,
    update() {},
  };
}

function wrapSpeechLines(ctx, text, maxWidth, maxLines = 2) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return [""];
  const lines = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const candidate = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = words[i];
      if (lines.length >= maxLines - 1) {
        const remaining = words.slice(i).join(" ");
        let trimmed = remaining;
        while (trimmed.length > 3 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
          trimmed = trimmed.slice(0, -1).trimEnd();
        }
        lines.push(trimmed.length < remaining.length ? `${trimmed}…` : trimmed);
        line = "";
        break;
      }
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

function buildNpcNameplateSprite(THREE, spec) {
  let tex = null;
  let canvas = null;
  let ctx = null;
  let currentLang = "en";
  let currentSpeech = "";

  if (typeof document !== "undefined") {
    try {
      canvas = document.createElement("canvas");
      canvas.width = 560;
      canvas.height = 176;
      ctx = canvas.getContext("2d");
      if (ctx) {
        tex = new THREE.CanvasTexture(canvas);
        if ("colorSpace" in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      }
    } catch {
      tex = null;
      canvas = null;
      ctx = null;
    }
  }

  function redraw({ lang = currentLang, speechText = currentSpeech } = {}) {
    currentLang = lang === "tr" ? "tr" : "en";
    if (typeof speechText === "string") currentSpeech = speechText;
    if (!ctx || !canvas || !tex) return;

    const isTr = currentLang === "tr";
    const accent = spec.accentHex || "#38bdf8";
    const defaultGreeting = isTr ? spec.greeting?.tr || spec.greeting?.en || "" : spec.greeting?.en || "";
    const shownSpeech = (currentSpeech || defaultGreeting).trim();
    const roleLabel = isTr ? spec.role?.tr || spec.role?.en : spec.role?.en;
    const headerTitle = isTr ? `${spec.shortName || spec.name} · ${roleLabel || ""}` : spec.tagText || spec.name;
    const vehicleLabel = isTr ? spec.vehicleName?.tr || spec.vehicleName?.en || spec.vehicleId : spec.vehicleName?.en || spec.vehicleId;
    const promptLine = isTr ? `[E] KONUŞ · TIKLA · ${vehicleLabel}` : `[E] TALK · CLICK · ${vehicleLabel}`;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Outer rounded dark NASA glass pill + speech box
    ctx.fillStyle = "rgba(6, 13, 24, 0.90)";
    ctx.beginPath();
    ctx.roundRect?.(10, 10, 540, 156, 18);
    if (!ctx.roundRect) ctx.rect(10, 10, 540, 156);
    ctx.fill();

    ctx.strokeStyle = accent;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Top accent status dot + Name / Specialty
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(36, 40, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#f8fafc";
    ctx.font = "700 22px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(String(headerTitle).slice(0, 38), 54, 40);

    // Subtle divider between header and speech bubble text
    ctx.fillStyle = "rgba(148, 163, 184, 0.22)";
    ctx.fillRect(26, 62, 508, 1.5);

    // Overhead character speech / dialogue text
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "500 18px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    const quoteText = shownSpeech ? `"${shownSpeech}"` : "";
    const lines = wrapSpeechLines(ctx, quoteText, 504, 2);
    lines.forEach((line, i) => {
      ctx.fillText(line, 28, 86 + i * 24);
    });

    // Prompt Line
    ctx.fillStyle = accent;
    ctx.font = "700 17px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.fillText(promptLine.slice(0, 44), 28, 142);

    tex.needsUpdate = true;
  }

  redraw({ lang: "en", speechText: "" });

  const mat = new THREE.SpriteMaterial({
    map: tex,
    color: 0xffffff,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.name = `npc-tag-${spec.id}`;
  sprite.scale.set(2.8, 0.88, 1);
  sprite.position.set(0, 2.38, 0);
  sprite.userData.npcId = spec.id;
  return { sprite, tex, mat, redraw };
}

function tagNpcHierarchy(obj, npcId) {
  obj.traverse((node) => {
    node.userData = node.userData || {};
    node.userData.npcId = npcId;
  });
}

export function createNpcManager(THREE, scene, { suitRig = null, createAstronautFn = null, sampleElevY = null } = {}) {
  const npcGroup = new THREE.Group();
  npcGroup.name = "mars-station-npcs";
  if (scene) scene.add(npcGroup);

  const npcs = new Map();
  let currentSuitRig = suitRig || null;
  const tmpOrigin = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();

  function setEntryAvatarLod(entry, useHiRes) {
    if (!entry.hiResAvatar) {
      entry.avatar = entry.loResAvatar;
      if (entry.loResAvatar?.group) entry.loResAvatar.group.visible = true;
      entry.avatarGroup = entry.loResAvatar?.group || null;
      return;
    }
    const wantHi = Boolean(useHiRes);
    if (entry.isHiRes === wantHi) return;
    entry.isHiRes = wantHi;
    entry.hiResAvatar.group.visible = wantHi;
    if (entry.loResAvatar?.group) entry.loResAvatar.group.visible = !wantHi;
    entry.avatar = wantHi ? entry.hiResAvatar : entry.loResAvatar;
    entry.avatarGroup = entry.avatar.group;
  }

  function attachAvatarVisuals(entry) {
    if (entry.loResAvatar?.group && entry.group) {
      entry.group.remove(entry.loResAvatar.group);
    }
    if (entry.hiResAvatar?.group && entry.group) {
      entry.group.remove(entry.hiResAvatar.group);
    }

    const addBeacon = (targetGroup) => {
      const beacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 8, 6),
        new THREE.MeshBasicMaterial({ color: entry.spec.accentHex || "#38bdf8" })
      );
      beacon.position.set(0.18, 1.54, 0.08);
      targetGroup.add(beacon);
    };

    const loRes = buildProceduralSuitStandIn(THREE, entry.spec.accentHex);
    addBeacon(loRes.group);
    tagNpcHierarchy(loRes.group, entry.spec.id);
    entry.loResAvatar = loRes;
    entry.group.add(loRes.group);

    let hiRes = null;
    if (currentSuitRig && currentSuitRig.parts && currentSuitRig.J && typeof createAstronautFn === "function") {
      hiRes = createAstronautFn(currentSuitRig, { hideHead: false });
      addBeacon(hiRes.group);
      tagNpcHierarchy(hiRes.group, entry.spec.id);
      entry.group.add(hiRes.group);
    }
    entry.hiResAvatar = hiRes;
    entry.isHiRes = null;
    setEntryAvatarLod(entry, Boolean(hiRes));
  }

  function createNpcEntry(spec, index) {
    const group = new THREE.Group();
    group.name = `npc-${spec.id}`;
    group.userData.npcId = spec.id;
    group.userData.isDrivableVehicleNpc = Boolean(spec.isDrivableVehicle);

    // Subtle ground ring pad under boots
    const padGeom = new THREE.RingGeometry(0.46, 0.56, 28);
    padGeom.rotateX(-Math.PI / 2);
    const padMat = new THREE.MeshBasicMaterial({
      color: spec.accentHex || "#38bdf8",
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.68,
    });
    const groundPad = new THREE.Mesh(padGeom, padMat);
    groundPad.position.set(0, 0.03, 0);
    group.add(groundPad);

    // Reliable invisible raycast hit proxy volume covering astronaut body + helmet
    const hitProxyGeom = new THREE.CylinderGeometry(0.42, 0.44, NPC_HEIGHT_M, 10);
    const hitProxyMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const hitProxy = new THREE.Mesh(hitProxyGeom, hitProxyMat);
    hitProxy.position.set(0, NPC_HEIGHT_M * 0.5, 0);
    hitProxy.userData.npcId = spec.id;
    hitProxy.name = `npc-hit-${spec.id}`;
    group.add(hitProxy);

    const nameplate = buildNpcNameplateSprite(THREE, spec);
    group.add(nameplate.sprite);

    const entry = {
      id: spec.id,
      spec,
      index,
      group,
      hitProxy,
      groundPad,
      nameplate,
      avatar: null,
      avatarGroup: null,
      x: 0,
      y: 0,
      z: 0,
      baseYaw: 0,
      currentYaw: 0,
      anchorX: 0,
      anchorZ: 0,
      anchorYaw: 0,
      anchorInitialized: false,
      lockedStaticAnchor: Boolean(spec.isDrivableVehicle),
      phaseOffset: index * 1.37,
    };

    attachAvatarVisuals(entry);
    tagNpcHierarchy(group, spec.id);
    // CRITICAL: Always parent directly under top-level `npcGroup` (scene space), never a vehicle!
    npcGroup.add(group);
    npcs.set(spec.id, entry);
    return entry;
  }

  // Spawn all 7 active NPCs immediately
  MARS_STATION_NPCS.forEach((spec, idx) => {
    createNpcEntry(spec, idx);
  });

  function setSuitRig(rig) {
    if (!rig || rig === currentSuitRig) return;
    currentSuitRig = rig;
    for (const entry of npcs.values()) {
      attachAvatarVisuals(entry);
    }
  }

  function matchesVehicleId(specVehicleId, queryVehicleId) {
    if (specVehicleId === queryVehicleId) return true;
    return (
      (specVehicleId === "mars_robo_concept" && queryVehicleId === "nasa_concept") ||
      (specVehicleId === "nasa_concept" && queryVehicleId === "mars_robo_concept")
    );
  }

  /**
   * Locks NPC 1 (`mmsev`) or NPC 2 (`mars_robo_concept`) in front of its assigned drivable vehicle's
   * INITIAL parking spot in the Green Zone bay. Subsequent vehicle movement NEVER drags this NPC.
   */
  function anchorDrivableVehicleNpc(
    vehicleId,
    vehicleX,
    vehicleZ,
    vehicleYaw = 0,
    { sideOffsetM = 0.0, standoffM = null, resetAnchor = false, faceYaw = null } = {}
  ) {
    for (const entry of npcs.values()) {
      if (!matchesVehicleId(entry.spec.vehicleId, vehicleId)) continue;
      if (entry.anchorInitialized && !resetAnchor) return entry;

      const dist = Number.isFinite(standoffM) ? standoffM : entry.spec.standoffDistM || 3.6;
      const spot = computeSpotInFrontOfVehicle(vehicleX, vehicleZ, vehicleYaw, dist, sideOffsetM);
      const yawOut = Number.isFinite(faceYaw) ? normalizeAngleRad(faceYaw) : spot.yaw;
      const y = sampleElevY ? sampleElevY(spot.x, spot.z) : entry.y;

      entry.anchorX = spot.x;
      entry.anchorZ = spot.z;
      entry.anchorYaw = yawOut;
      entry.x = spot.x;
      entry.y = y;
      entry.z = spot.z;
      entry.baseYaw = yawOut;
      entry.currentYaw = yawOut;
      entry.anchorInitialized = true;
      entry.lockedStaticAnchor = true;

      entry.group.position.set(entry.x, entry.y, entry.z);
      entry.group.rotation.y = entry.currentYaw;
      return entry;
    }
    return null;
  }

  /**
   * Positions NPCs 3–7 neatly in front of their assigned historic NASA rovers in the bay / surface.
   * Never touches drivable vehicle anchors (NPC 1 & NPC 2).
   */
  function syncHistoricRoverNpcs(historicEntries, { bayCenter = null, sideOffsetM = 0 } = {}) {
    if (!historicEntries) return;
    const list = Array.isArray(historicEntries)
      ? historicEntries
      : typeof historicEntries.getAllEntries === "function"
        ? historicEntries.getAllEntries()
        : Array.from(historicEntries.values?.() || []);

    for (const hEntry of list) {
      const rId = hEntry?.id || hEntry?.spec?.id;
      const pos = hEntry?.group?.position;
      const rYaw = hEntry?.group?.rotation?.y || hEntry?.yaw || 0;
      if (!rId || !pos) continue;

      for (const npc of npcs.values()) {
        if (npc.lockedStaticAnchor || !matchesVehicleId(npc.spec.vehicleId, rId)) continue;

        const dist = npc.spec.standoffDistM || 2.6;
        let sx;
        let sz;
        let faceOutYaw;
        if (bayCenter && Number.isFinite(bayCenter.x) && Number.isFinite(bayCenter.z)) {
          let dirX = -Math.sin(rYaw);
          let dirZ = -Math.cos(rYaw);
          const toCx = bayCenter.x - pos.x;
          const toCz = bayCenter.z - pos.z;
          const len = Math.hypot(toCx, toCz);
          if (len > 0.25) {
            dirX = toCx / len;
            dirZ = toCz / len;
          }
          sx = pos.x + dirX * dist;
          sz = pos.z + dirZ * dist;
          faceOutYaw = Math.atan2(-dirX, -dirZ);
        } else {
          const spot = computeSpotInFrontOfVehicle(pos.x, pos.z, rYaw, dist, sideOffsetM);
          sx = spot.x;
          sz = spot.z;
          faceOutYaw = spot.yaw;
        }
        const sy = sampleElevY ? sampleElevY(sx, sz) : pos.y || 0;

        npc.anchorX = sx;
        npc.anchorZ = sz;
        npc.anchorYaw = faceOutYaw;
        npc.x = sx;
        npc.y = sy;
        npc.z = sz;
        npc.baseYaw = faceOutYaw;
        npc.currentYaw = faceOutYaw;
        npc.anchorInitialized = true;

        npc.group.position.set(sx, sy, sz);
        npc.group.rotation.y = faceOutYaw;
      }
    }
  }

  // The suit meshes are skinned with frustum culling off (their bounds do not follow the bones), so
  // every crew member was drawn and animated even behind the camera. Each one is culled here as a
  // whole against the view, with a sphere wide enough to keep a shadow that reaches into view.
  const viewFrustum = new THREE.Frustum();
  const viewProj = new THREE.Matrix4();
  const cullSphere = new THREE.Sphere(new THREE.Vector3(), 3.5);

  let activeLang = "en";

  function setLanguage(lang) {
    const nextLang = lang === "tr" ? "tr" : "en";
    if (nextLang === activeLang) return;
    activeLang = nextLang;
    for (const entry of npcs.values()) {
      entry.speechText = "";
      entry.nameplate?.redraw?.({ lang: activeLang, speechText: "" });
    }
  }

  function setNpcSpeech(npcId, speechText, lang = activeLang) {
    const entry = npcs.get(npcId);
    if (!entry) return false;
    const nextLang = lang === "tr" ? "tr" : "en";
    activeLang = nextLang;
    entry.speechText = String(speechText || "").trim();
    entry.nameplate?.redraw?.({ lang: nextLang, speechText: entry.speechText });
    return true;
  }

  function update(dt, playerPos, clockT = 0, { activeNpcId = null, terrainSampler = null, lang = null, camera = null, detailDistM = 18 } = {}) {
    if (lang) setLanguage(lang);
    const safeDt = Math.max(0.001, Math.min(0.1, Number(dt) || 0.016));
    const sampler = terrainSampler || sampleElevY;
    if (camera) {
      camera.updateMatrixWorld();
      viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      viewFrustum.setFromProjectionMatrix(viewProj);
    }

    for (const entry of npcs.values()) {
      // Static Anchor safeguard: drivable vehicle NPCs strictly hold their bay anchor coordinates
      if (entry.lockedStaticAnchor && entry.anchorInitialized) {
        entry.x = entry.anchorX;
        entry.z = entry.anchorZ;
      }

      if (sampler && (entry.lastSampleX !== entry.x || entry.lastSampleZ !== entry.z || !Number.isFinite(entry.y))) {
        entry.y = sampler(entry.x, entry.z);
        entry.lastSampleX = entry.x;
        entry.lastSampleZ = entry.z;
      }
      entry.group.position.set(entry.x, entry.y, entry.z);
      if (camera) {
        cullSphere.center.set(entry.x, entry.y + 1, entry.z);
        entry.group.visible = viewFrustum.intersectsSphere(cullSphere);
        if (!entry.group.visible) continue; // out of view: no pose update either
      }

      // Determine whether NPC should turn to face the player (near or actively conversing)
      let wantsPlayerFace = false;
      let targetYaw = entry.baseYaw;
      let playerDist = Infinity;
      const isSpeaking = activeNpcId === entry.id;
      if (playerPos && Number.isFinite(playerPos.x) && Number.isFinite(playerPos.z)) {
        const dx = playerPos.x - entry.x;
        const dz = playerPos.z - entry.z;
        playerDist = Math.hypot(dx, dz);
        if ((isSpeaking || playerDist <= NPC_FACE_PLAYER_DIST_M) && playerDist > 0.15) {
          wantsPlayerFace = true;
          // Local forward of NASA suit & stand-in is -Z -> yaw = atan2(-dx, -dz)
          targetYaw = Math.atan2(-dx, -dz);
        }
      }

      // Swap 88k-tri NASA GLB suit down to 600-tri procedural stand-in beyond detailDistM to save GPU skinning/tris.
      setEntryAvatarLod(entry, isSpeaking || playerDist <= detailDistM);

      // Skip full skeleton breathing/matrix recursion for distant out-of-range NPCs; throttle mid-range NPCs.
      if (!isSpeaking && playerDist > 55) {
        entry.currentYaw = targetYaw;
        entry.group.rotation.y = targetYaw;
        continue;
      }
      let animDt = safeDt;
      if (!isSpeaking && playerDist > 18) {
        entry.lodAccum = (entry.lodAccum || 0) + safeDt;
        if (entry.lodAccum < 0.05) {
          entry.currentYaw = lerpAngleRad(entry.currentYaw, targetYaw, safeDt * (wantsPlayerFace ? 5.2 : 2.0));
          entry.group.rotation.y = entry.currentYaw;
          continue;
        }
        animDt = entry.lodAccum;
        entry.lodAccum = 0;
      } else {
        entry.lodAccum = 0;
      }

      const turnRate = wantsPlayerFace ? 5.2 : 2.0;
      entry.currentYaw = lerpAngleRad(entry.currentYaw, targetYaw, animDt * turnRate);
      entry.group.rotation.y = entry.currentYaw;

      // Update suit breathing cycle cleanly (speed = 0 -> idlePhase drives chest & pelvis breathing)
      if (entry.avatar && typeof entry.avatar.update === "function") {
        entry.avatar.update(animDt, 0, 0, false, null);
      }

      // Layer subtle looking-around & chest idle cadence
      const t = clockT + entry.phaseOffset;
      const head = entry.avatar?.bones?.head;
      if (head) {
        const idleHeadYaw = wantsPlayerFace ? Math.sin(t * 0.9) * 0.04 : Math.sin(t * 0.65) * 0.24;
        const idleHeadPitch = wantsPlayerFace ? 0.03 + Math.sin(t * 1.3) * 0.025 : Math.sin(t * 0.95) * 0.06;
        head.rotation.y = idleHeadYaw;
        head.rotation.x = idleHeadPitch;
      }

      const chest = entry.avatar?.bones?.chest;
      if (chest && entry.avatar?.isStandIn) {
        chest.position.y = 1.18 + Math.sin(t * 1.45) * 0.012;
        chest.rotation.z = Math.sin(t * 0.55) * 0.025;
      }

      // Subtle floating tag bob
      if (entry.nameplate?.sprite) {
        entry.nameplate.sprite.position.y = 2.38 + Math.sin(t * 1.8) * 0.025;
      }
    }
  }

  const pickScratch = [];
  /**
   * Raycast interaction picker (click-to-interact / crosshair aim).
   */
  function pickNpc(raycaster, maxDist = 9.0) {
    if (!raycaster || npcGroup.children.length === 0) return null;
    pickScratch.length = 0;
    const ro = raycaster.ray?.origin;
    const maxR2 = (maxDist + 2.2) * (maxDist + 2.2);
    for (const entry of npcs.values()) {
      if (ro) {
        const dx = entry.x - ro.x;
        const dz = entry.z - ro.z;
        if (dx * dx + dz * dz > maxR2) continue;
      }
      pickScratch.push(entry.group);
    }
    if (pickScratch.length === 0) return null;
    const hits = raycaster.intersectObjects(pickScratch, true);
    if (hits.length > 0 && hits[0].distance <= maxDist) {
      let obj = hits[0].object;
      while (obj && !obj.userData?.npcId) obj = obj.parent;
      const npcId = obj?.userData?.npcId;
      return npcId ? npcs.get(npcId) || null : null;
    }
    return null;
  }

  /**
   * Proximity + facing check (`[E] Talk`) within interaction radius.
   */
  function getNearestInteractableNpc(px, pz, maxDist = 3.2, rayOrigin = null, rayDir = null) {
    let best = null;
    let bestScore = Infinity;
    for (const entry of npcs.values()) {
      const dx = entry.x - px;
      const dz = entry.z - pz;
      const d = Math.hypot(dx, dz);
      if (d > maxDist) continue;
      let score = d;
      if (rayDir && rayOrigin && d > 0.2) {
        tmpOrigin.set(rayOrigin.x, 0, rayOrigin.z);
        tmpDir.set(rayDir.x, 0, rayDir.z).normalize();
        const dot = (dx / d) * tmpDir.x + (dz / d) * tmpDir.z;
        if (dot > 0.5) score -= dot * 0.9;
      }
      if (score < bestScore) {
        bestScore = score;
        best = { npc: entry, distance: d };
      }
    }
    return best;
  }

  /**
   * Solid cylinder push-out so walker or drivable rovers never clip through any stationed NPC.
   */
  function resolveCollision(entityX, entityZ, entityRadius = 0.42, entityY = null) {
    let cx = entityX;
    let cz = entityZ;
    let hit = false;
    let bestPen = 0;
    let nx = 0;
    let nz = 0;
    const minDist = NPC_COLLISION_RADIUS_M + entityRadius;

    for (const entry of npcs.values()) {
      if (Number.isFinite(entityY) && Math.abs(entityY - entry.y) > NPC_HEIGHT_M * 1.1) continue;
      const dx = cx - entry.x;
      const dz = cz - entry.z;
      const dist = Math.hypot(dx, dz);
      if (dist < minDist) {
        const inv = dist > 1e-4 ? 1 / dist : 1;
        const cnx = dist > 1e-4 ? dx * inv : 0;
        const cnz = dist > 1e-4 ? dz * inv : 1;
        const pen = minDist - dist;
        cx = entry.x + cnx * minDist;
        cz = entry.z + cnz * minDist;
        if (pen > bestPen) {
          bestPen = pen;
          nx = cnx;
          nz = cnz;
        }
        hit = true;
      }
    }
    return { hit, x: cx, z: cz, nx, nz, pen: bestPen };
  }

  return {
    npcGroup,
    getAllNpcs: () => Array.from(npcs.values()),
    getNpc: (id) => npcs.get(id) || null,
    getNpcByVehicleId: (vid) => {
      for (const entry of npcs.values()) {
        if (matchesVehicleId(entry.spec.vehicleId, vid)) return entry;
      }
      return null;
    },
    setSuitRig,
    setLanguage,
    setNpcSpeech,
    anchorDrivableVehicleNpc,
    syncHistoricRoverNpcs,
    spawnCorridorScreenNPCs,
    update,
    pickNpc,
    getNearestInteractableNpc,
    resolveCollision,
  };
}
