/**
 * First-Person Mount Sharp 3D Terrain, AR Science Stop Beacons & Helmet HUD (`web/hud/hud3d.js`).
 * Decodes Backend 1's 8-bit RGB height-preview.png (value = R*256 + G), renders free-roam 1st-person
 * camera-relative WASD walking at 1.7m eye height with Pointer Lock mouse look and AR stop labels.
 */

import * as THREE from "three";
import { classifySlope, onJumpToCoord } from "../shared/route-bridge.js";

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

function makeArLabelSprite(title, kind, distText) {
  const canvas = document.createElement("canvas");
  canvas.width = 380;
  canvas.height = 110;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "rgba(8, 14, 24, 0.84)";
  ctx.strokeStyle = kind === "habitat" ? "#22c55e" : kind === "boxwork_bonus" ? "#f59e0b" : "#38bdf8";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(6, 6, 368, 98, 16);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#7dd3fc";
  ctx.font = "bold 20px monospace";
  ctx.fillText(kind.toUpperCase(), 22, 36);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px sans-serif";
  const shortTitle = title.length > 28 ? title.slice(0, 27) + "…" : title;
  ctx.fillText(shortTitle, 22, 66);

  ctx.fillStyle = "#cbd5e1";
  ctx.font = "bold 20px monospace";
  ctx.fillText(distText, 22, 92);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(26, 7.5, 1);
  sprite.userData = { canvas, ctx, tex, title, kind, lastDist: distText };
  return sprite;
}

function updateArLabelDist(sprite, distM) {
  const distText = `${distM.toFixed(0)} m`;
  if (sprite.userData.lastDist === distText) return;
  sprite.userData.lastDist = distText;
  const { ctx, tex, title, kind } = sprite.userData;

  ctx.clearRect(0, 0, 380, 110);
  ctx.fillStyle = "rgba(8, 14, 24, 0.84)";
  ctx.strokeStyle = kind === "habitat" ? "#22c55e" : kind === "boxwork_bonus" ? "#f59e0b" : "#38bdf8";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(6, 6, 368, 98, 16);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#7dd3fc";
  ctx.font = "bold 20px monospace";
  ctx.fillText(kind.toUpperCase(), 22, 36);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px sans-serif";
  const shortTitle = title.length > 28 ? title.slice(0, 27) + "…" : title;
  ctx.fillText(shortTitle, 22, 66);

  ctx.fillStyle = "#fde68a";
  ctx.font = "bold 20px monospace";
  ctx.fillText(`AR DIST: ${distText}`, 22, 92);

  tex.needsUpdate = true;
}

function compassLabel(deg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return `${String(Math.round(((deg % 360) + 360) % 360)).padStart(3, "0")}° ${dirs[idx]}`;
}

export async function initHud3D(data, { onOpenPov, onPositionChange }) {
  const { costMap, stops, telemetry, povIndex, assets } = data;
  const wrap = document.getElementById("hud-canvas-wrap");

  const bounds = costMap?.bounds || {
    west_lon_deg: 137.372831,
    south_lat_deg: -4.816946,
    east_lon_deg: 137.406542,
    north_lat_deg: -4.783236,
  };
  const ncols = costMap?.grid?.ncols || 395;
  const nrows = costMap?.grid?.nrows || 395;
  const cellSizeM = costMap?.cell_size_m || 5.059;
  const worldW = ncols * cellSizeM;
  const worldH = nrows * cellSizeM;
  const [elevMin, elevMax] = costMap?.height_preview_elevation_range_m || [-3850.6, -3369.3];

  const lonToX = (lon) =>
    ((lon - bounds.west_lon_deg) / (bounds.east_lon_deg - bounds.west_lon_deg) - 0.5) * worldW;
  const latToZ = (lat) =>
    (0.5 - (lat - bounds.south_lat_deg) / (bounds.north_lat_deg - bounds.south_lat_deg)) * worldH;
  const xToLon = (x) =>
    bounds.west_lon_deg + (x / worldW + 0.5) * (bounds.east_lon_deg - bounds.west_lon_deg);
  const zToLat = (z) =>
    bounds.south_lat_deg + (0.5 - z / worldH) * (bounds.north_lat_deg - bounds.south_lat_deg);

  // Scene, Camera, Renderer (near=0.2m for close-up 1.7m eye-height exploration without near-clip)
  const EYE_HEIGHT_M = 1.7;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x21140f);
  scene.fog = new THREE.FogExp2(0x3a2319, 0.00072);

  const camera = new THREE.PerspectiveCamera(
    68,
    wrap.clientWidth / Math.max(1, wrap.clientHeight),
    0.2,
    4000
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(wrap.clientWidth || window.innerWidth, wrap.clientHeight || window.innerHeight);
  wrap.appendChild(renderer.domElement);

  const sun = new THREE.DirectionalLight(0xffe7cf, 1.35);
  sun.position.set(420, 720, 310);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x9a7b6c, 0.68));

  // Decode height-preview.png (8-bit RGB: R*256 + G) and match mesh vertices 1:1 to elevGrid
  let elevGrid = null;
  let imgW = 0;
  let imgH = 0;

  try {
    const hImg = await loadImage(assets.heightPreviewUrl);
    imgW = hImg.width;
    imgH = hImg.height;
    const c = document.createElement("canvas");
    c.width = imgW;
    c.height = imgH;
    const ctx = c.getContext("2d");
    ctx.drawImage(hImg, 0, 0);
    const px = ctx.getImageData(0, 0, imgW, imgH).data;
    elevGrid = new Float32Array(imgW * imgH);

    for (let i = 0; i < imgW * imgH; i++) {
      const r = px[i * 4];
      const g = px[i * 4 + 1];
      const val = r * 256 + g;
      elevGrid[i] = val === 0 ? elevMin : elevMin + (val / 65535) * (elevMax - elevMin);
    }
  } catch {
    // Fallback: flat terrain
  }

  const segW = elevGrid && imgW > 1 ? imgW - 1 : 197;
  const segH = elevGrid && imgH > 1 ? imgH - 1 : 197;
  const geom = new THREE.PlaneGeometry(worldW, worldH, segW, segH);
  geom.rotateX(-Math.PI / 2);

  if (elevGrid) {
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const ix = i % imgW;
      const iy = Math.floor(i / imgW);
      if (ix < imgW && iy < imgH) {
        pos.setY(i, elevGrid[iy * imgW + ix] - elevMin);
      }
    }
    geom.computeVertexNormals();
  }

  // Exact triangle-interpolated surface height matching PlaneGeometry triangulation
  function sampleMeshY(x, z) {
    if (!elevGrid) return 0;
    const u = Math.max(0, Math.min(1, x / worldW + 0.5));
    const v = Math.max(0, Math.min(1, z / worldH + 0.5));
    const fx = u * (imgW - 1);
    const fy = v * (imgH - 1);
    const x0 = Math.min(imgW - 2, Math.floor(fx));
    const y0 = Math.min(imgH - 2, Math.floor(fy));
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const tx = fx - x0;
    const ty = fy - y0;
    const ha = elevGrid[y0 * imgW + x0] - elevMin;
    const hb = elevGrid[y1 * imgW + x0] - elevMin;
    const hc = elevGrid[y1 * imgW + x1] - elevMin;
    const hd = elevGrid[y0 * imgW + x1] - elevMin;
    if (tx + ty <= 1) {
      return ha + (hd - ha) * tx + (hb - ha) * ty;
    }
    const ux = 1 - tx;
    const uy = 1 - ty;
    return hc + (hb - hc) * ux + (hd - hc) * uy;
  }
  const sampleElevSceneY = sampleMeshY;

  const COLLAR_OFFSETS = [
    [0.6, 0],
    [-0.6, 0],
    [0, 0.6],
    [0, -0.6],
    [0.42, 0.42],
    [-0.42, 0.42],
    [0.42, -0.42],
    [-0.42, -0.42],
  ];

  function getSafeEyeY(x, z) {
    let eyeY = sampleMeshY(x, z) + EYE_HEIGHT_M;
    for (let i = 0; i < COLLAR_OFFSETS.length; i++) {
      const ny = sampleMeshY(x + COLLAR_OFFSETS[i][0], z + COLLAR_OFFSETS[i][1]);
      if (ny + 0.55 > eyeY) eyeY = ny + 0.55;
    }
    return eyeY;
  }

  function sampleSlopeDeg(x, z) {
    if (!elevGrid) return null;
    const d = Math.max(2, cellSizeM * 0.5);
    const gx = (sampleMeshY(x + d, z) - sampleMeshY(x - d, z)) / (2 * d);
    const gz = (sampleMeshY(x, z + d) - sampleMeshY(x, z - d)) / (2 * d);
    return (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
  }

  // Textures (use slopePreviewUrl strictly when orthoPreviewUrl is null in ?demo=1)
  const texLoader = new THREE.TextureLoader();
  const slopeTex = texLoader.load(assets.slopePreviewUrl);
  slopeTex.colorSpace = THREE.SRGBColorSpace;
  const orthoTex = assets.orthoPreviewUrl ? texLoader.load(assets.orthoPreviewUrl) : slopeTex;
  if (assets.orthoPreviewUrl) orthoTex.colorSpace = THREE.SRGBColorSpace;

  let useSlopeTex = !assets.orthoPreviewUrl;
  const terrainMat = new THREE.MeshStandardMaterial({
    map: useSlopeTex ? slopeTex : orthoTex,
    roughness: 0.92,
    metalness: 0.04,
  });
  const terrainMesh = new THREE.Mesh(geom, terrainMat);
  scene.add(terrainMesh);

  // AR Group: Science Stop Beacons + Floating AR Labels on Terrain
  const arGroup = new THREE.Group();
  scene.add(arGroup);

  const stopSprites = [];
  if (stops?.features) {
    stops.features.forEach((f) => {
      const [lon, lat] = f.geometry.coordinates;
      const sx = lonToX(lon);
      const sz = latToZ(lat);
      const sy = sampleElevSceneY(sx, sz);
      const kind = f.properties.kind || "stop";
      const col = kind === "habitat" ? 0x22c55e : kind === "boxwork_bonus" ? 0xf59e0b : 0x38bdf8;

      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 1.8, 22, 12),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.72 })
      );
      beacon.position.set(sx, sy + 11, sz);
      arGroup.add(beacon);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(2.5, 3.6, 24),
        new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(sx, sy + 0.5, sz);
      arGroup.add(ring);

      const sprite = makeArLabelSprite(f.properties.name || f.properties.id, kind, "— m");
      sprite.position.set(sx, sy + 26, sz);
      arGroup.add(sprite);
      stopSprites.push({ sprite, x: sx, z: sz });
    });
  }

  // State & Controls (Pure 1st-person camera-relative WASD walking at 1.7m human eye height)
  const clamp = (val, lo, hi) => Math.max(lo, Math.min(hi, val));
  const halfW = worldW * 0.5 - 2;
  const halfH = worldH * 0.5 - 2;

  const firstStopCoord = stops?.features?.[0]?.geometry?.coordinates;
  const startLon = firstStopCoord?.[0] ?? (bounds.west_lon_deg + bounds.east_lon_deg) * 0.5;
  const startLat = firstStopCoord?.[1] ?? (bounds.south_lat_deg + bounds.north_lat_deg) * 0.5;
  const startX = clamp(lonToX(startLon), -halfW, halfW);
  const startZ = clamp(latToZ(startLat), -halfH, halfH);

  let initialYaw = 0;
  const secondStopCoord = stops?.features?.[1]?.geometry?.coordinates;
  if (secondStopCoord) {
    const adx = lonToX(secondStopCoord[0]) - startX;
    const adz = latToZ(secondStopCoord[1]) - startZ;
    if (Math.hypot(adx, adz) > 0.5) initialYaw = Math.atan2(-adx, -adz);
  }

  let speedMult = 1;
  let yawOffset = initialYaw;
  let pitchOffset = -0.04;
  let walkedM = 0;
  const freePos = new THREE.Vector3(startX, getSafeEyeY(startX, startZ), startZ);
  const keys = new Set();

  // Pointer Lock mouse look (click 3D view to lock cursor; Esc to unlock) + drag fallback
  const reticleEl = document.getElementById("hud-reticle");
  const lockHintEl = document.getElementById("hud-lock-hint");
  let dragging = false;
  let movedWhileDragging = false;
  let lastX = 0;
  let lastY = 0;

  const isLocked = () => document.pointerLockElement === renderer.domElement;

  function syncLockUi() {
    const locked = isLocked();
    reticleEl?.classList.toggle("locked", locked);
    if (lockHintEl) {
      lockHintEl.textContent = locked
        ? "Mouse Locked · Esc: Unlock · WASD: Walk"
        : "Click 3D view: Lock Mouse (Esc: Unlock)";
    }
    if (locked) dragging = false;
  }

  document.addEventListener("pointerlockchange", syncLockUi);
  document.addEventListener("pointerlockerror", syncLockUi);

  renderer.domElement.addEventListener("click", () => {
    if (movedWhileDragging) {
      movedWhileDragging = false;
      return;
    }
    if (!isLocked() && renderer.domElement.requestPointerLock) {
      try {
        const res = renderer.domElement.requestPointerLock();
        if (res && typeof res.catch === "function") res.catch(() => {});
      } catch {
        // Fallback drag look remains active if pointer lock is blocked
      }
    }
  });

  window.addEventListener("mousemove", (e) => {
    if (!isLocked()) return;
    yawOffset -= e.movementX * 0.0026;
    pitchOffset = clamp(pitchOffset - e.movementY * 0.0022, -1.25, 1.15);
  });

  renderer.domElement.addEventListener("pointerdown", (e) => {
    if (isLocked()) return;
    dragging = true;
    movedWhileDragging = false;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener("pointerup", () => (dragging = false));
  window.addEventListener("pointermove", (e) => {
    if (isLocked() || !dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (Math.hypot(dx, dy) > 3) movedWhileDragging = true;
    yawOffset -= dx * 0.004;
    pitchOffset = clamp(pitchOffset - dy * 0.003, -1.25, 1.15);
    lastX = e.clientX;
    lastY = e.clientY;
  });

  window.addEventListener("keydown", (e) => {
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(k)) {
      if (k.startsWith("arrow")) e.preventDefault();
      keys.add(k);
    }
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener("blur", () => keys.clear());

  // UI Controls
  const btnSpeed = document.getElementById("hud-speed");
  const btnTex = document.getElementById("hud-tex");
  const btnAr = document.getElementById("hud-ar-toggle");
  const btnResetLook = document.getElementById("hud-reset-look");
  const btnPov = document.getElementById("hud-pov-btn");

  if (btnTex) {
    btnTex.textContent = useSlopeTex ? "Tex: Slope" : "Tex: Ortho";
    if (!assets.orthoPreviewUrl) btnTex.disabled = true;
  }

  btnSpeed?.addEventListener("click", () => {
    speedMult = speedMult === 1 ? 2 : speedMult === 2 ? 5 : 1;
    btnSpeed.textContent = `${speedMult}x`;
  });

  btnTex?.addEventListener("click", () => {
    if (!assets.orthoPreviewUrl) return;
    useSlopeTex = !useSlopeTex;
    terrainMat.map = useSlopeTex ? slopeTex : orthoTex;
    terrainMat.needsUpdate = true;
    btnTex.textContent = useSlopeTex ? "Tex: Slope" : "Tex: Ortho";
  });

  btnAr?.addEventListener("click", () => {
    arGroup.visible = !arGroup.visible;
    btnAr.textContent = arGroup.visible ? "AR: ON" : "AR: OFF";
  });

  btnResetLook?.addEventListener("click", () => {
    yawOffset = initialYaw;
    pitchOffset = -0.04;
  });

  // Jump directly to a science stop coordinate when clicked in the Stops drawer
  onJumpToCoord(({ coord }) => {
    const rx = clamp(lonToX(coord[0]), -halfW, halfW);
    const rz = clamp(latToZ(coord[1]), -halfH, halfH);
    freePos.set(rx, getSafeEyeY(rx, rz), rz);
  });

  const compassEl = document.getElementById("hud-compass");

  function updateHudReadouts(sM, camX, camZ) {
    // Update AR stop distances
    for (const st of stopSprites) {
      updateArLabelDist(st.sprite, Math.hypot(st.x - camX, st.z - camZ));
    }

    // Compass heading from current camera yawOffset
    if (compassEl) {
      const lookHeadingDeg = (-yawOffset * 180) / Math.PI;
      compassEl.textContent = `HDG ${compassLabel(lookHeadingDeg)}`;
    }

    const primaryTel = telemetry?.primary || telemetry;
    if (!elevGrid && !primaryTel && !stops?.features?.length) {
      document.getElementById("hud-dist").textContent = "no NASA value";
      document.getElementById("hud-dist-sub").textContent = "terrain / telemetry missing";
      document.getElementById("hud-slope").textContent = "no NASA value";
      document.getElementById("hud-next-stop").textContent = "no NASA value";
      document.getElementById("hud-next-kind").textContent = "stops.json missing";
      document.getElementById("hud-o2").textContent = "no NASA value";
      return;
    }

    const slopeDeg = sampleSlopeDeg(camX, camZ) ?? primaryTel?.slope_deg ?? null;
    const slopeClass = classifySlope(slopeDeg, 20);

    let nextStop = stops?.features?.[0] || null;
    let minStopDist = Infinity;
    if (stops?.features?.length) {
      for (const f of stops.features) {
        const dx = lonToX(f.geometry.coordinates[0]) - camX;
        const dz = latToZ(f.geometry.coordinates[1]) - camZ;
        const d = Math.hypot(dx, dz);
        if (d < minStopDist) {
          minStopDist = d;
          nextStop = f;
        }
      }
    }

    const budgetM = 2500;
    const frac = Math.min(1, sM / budgetM);
    const o2Pct =
      sM === 0 && primaryTel?.suit_o2_remaining_percent != null
        ? primaryTel.suit_o2_remaining_percent
        : Math.max(0, 100 * (1 - frac));

    document.getElementById("hud-dist").textContent = `${sM.toFixed(1)} m`;
    document.getElementById("hud-dist-sub").textContent =
      `WASD Walk (1.7m) · Next: ${minStopDist < Infinity ? minStopDist.toFixed(0) + " m" : "no NASA value"}`;
    document.getElementById("hud-slope").textContent =
      slopeDeg != null ? `${Number(slopeDeg).toFixed(1)}°` : "no NASA value";

    const badge = document.getElementById("hud-slope-badge");
    if (badge) {
      badge.textContent = slopeClass.id;
      badge.className = `slope-badge slope-${slopeClass.id}`;
    }

    document.getElementById("hud-next-stop").textContent =
      nextStop?.properties?.name || primaryTel?.next_stop_name || "no NASA value";
    document.getElementById("hud-next-kind").textContent =
      nextStop?.properties?.kind || "stops.json";

    document.getElementById("hud-o2").textContent = `${o2Pct.toFixed(1)}%`;
    const o2Fill = document.getElementById("hud-o2-fill");
    if (o2Fill) o2Fill.style.width = `${o2Pct.toFixed(1)}%`;

    if (btnPov) {
      btnPov.onclick = () => {
        if (!nextStop) {
          onOpenPov({ stop_name: "Unknown Stop", missing: true, missing_label: "no NASA value — stops.json missing" });
          return;
        }
        const entry = povIndex?.stops?.find((s) => s.stop_id === nextStop.properties.id);
        onOpenPov(entry || { stop_id: nextStop.properties.id, stop_name: nextStop.properties.name, missing: true, missing_label: "no NASA value — POV image missing" });
      };
    }
  }

  const onResize = () => {
    const w = wrap.clientWidth || window.innerWidth;
    const h = wrap.clientHeight || window.innerHeight;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  window.addEventListener("resize", onResize);

  // Reusable movement vectors for camera-relative WASD
  const moveForward = new THREE.Vector3();
  const moveRight = new THREE.Vector3();
  const moveVec = new THREE.Vector3();

  // Animation Loop (camera-relative WASD at 1.7m eye height, pointer-lock look)
  let prevT = performance.now();
  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min(0.1, (now - prevT) / 1000);
    prevT = now;

    const fwdInput =
      (keys.has("w") || keys.has("arrowup") ? 1 : 0) -
      (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
    const strafeInput =
      (keys.has("d") || keys.has("arrowright") ? 1 : 0) -
      (keys.has("a") || keys.has("arrowleft") ? 1 : 0);

    if (fwdInput !== 0 || strafeInput !== 0) {
      const sprint = keys.has("shift") ? 2.2 : 1;
      const moveSpeed = 10 * speedMult * sprint;
      moveForward.set(-Math.sin(yawOffset), 0, -Math.cos(yawOffset));
      moveRight.set(Math.cos(yawOffset), 0, -Math.sin(yawOffset));
      moveVec
        .set(0, 0, 0)
        .addScaledVector(moveForward, fwdInput)
        .addScaledVector(moveRight, strafeInput);
      if (moveVec.lengthSq() > 0) {
        moveVec.normalize();
        const prevX = freePos.x;
        const prevZ = freePos.z;
        freePos.x = clamp(freePos.x + moveVec.x * moveSpeed * dt, -halfW, halfW);
        freePos.z = clamp(freePos.z + moveVec.z * moveSpeed * dt, -halfH, halfH);
        walkedM += Math.hypot(freePos.x - prevX, freePos.z - prevZ);
      }
    }

    freePos.y = getSafeEyeY(freePos.x, freePos.z);
    camera.position.copy(freePos);
    camera.rotation.order = "YXZ";
    camera.rotation.y = yawOffset;
    camera.rotation.x = pitchOffset;

    const hudLon = xToLon(freePos.x);
    const hudLat = zToLat(freePos.z);
    updateHudReadouts(walkedM, camera.position.x, camera.position.z);
    if (onPositionChange) onPositionChange(hudLon, hudLat, walkedM);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);

  return { onResize };
}
