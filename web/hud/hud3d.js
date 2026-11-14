/**
 * First-Person Mount Sharp 3D Terrain, AR Route/Stop World Markers & Helmet HUD (`web/hud/hud3d.js`).
 * Decodes Backend 1's 8-bit RGB height-preview.png (value = R*256 + G), renders AR route + stop labels
 * directly on the terrain mesh, receives routes via `mm:set-route`, and updates the visor readouts.
 */

import * as THREE from "three";
import {
  buildCumulativeDistances,
  classifySlope,
  onSetRoute,
  sampleAlongRoute,
} from "../shared/route-bridge.js";

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
  const { costMap, route, stops, telemetry, povIndex, assets } = data;
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

  // AR Group: Route + Stop Beacons + Floating AR Labels on Terrain
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

  let routeGroup = new THREE.Group();
  arGroup.add(routeGroup);
  let activeRoute = route;
  let routeCoords = activeRoute?.geometry?.coordinates || [];
  let cumDist = buildCumulativeDistances(routeCoords);
  let totalDist = cumDist[cumDist.length - 1] || 1;
  let alongM = 0;

  function rebuildRouteRibbon(r) {
    arGroup.remove(routeGroup);
    routeGroup = new THREE.Group();
    arGroup.add(routeGroup);

    activeRoute = r;
    routeCoords = r?.geometry?.coordinates || [];
    cumDist = buildCumulativeDistances(routeCoords);
    totalDist = cumDist[cumDist.length - 1] || 1;

    const pts = routeCoords.map(([lon, lat]) => {
      const x = lonToX(lon);
      const z = latToZ(lat);
      return new THREE.Vector3(x, sampleElevSceneY(x, z) + 0.9, z);
    });

    if (pts.length > 1) {
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, Math.min(400, pts.length * 3), 0.45, 6, false),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9 })
      );
      routeGroup.add(tube);

      // Periodic AR ground markers along the path
      for (let i = 0; i < pts.length; i += 6) {
        const pin = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.65, 0),
          new THREE.MeshBasicMaterial({ color: 0xbae6fd })
        );
        pin.position.copy(pts[i]).add(new THREE.Vector3(0, 1.0, 0));
        routeGroup.add(pin);
      }
    }

    const scrubber = document.getElementById("hud-scrubber");
    if (scrubber) {
      scrubber.max = totalDist.toFixed(1);
      scrubber.value = alongM.toFixed(1);
    }
  }

  if (activeRoute) rebuildRouteRibbon(activeRoute);

  // State & Controls (Default: 1st-person WASD walking at 1.7m human eye height)
  const clamp = (val, lo, hi) => Math.max(lo, Math.min(hi, val));
  const halfW = worldW * 0.5 - 2;
  const halfH = worldH * 0.5 - 2;

  const startLon = routeCoords[0]?.[0] ?? (bounds.west_lon_deg + bounds.east_lon_deg) * 0.5;
  const startLat = routeCoords[0]?.[1] ?? (bounds.south_lat_deg + bounds.north_lat_deg) * 0.5;
  const startX = clamp(lonToX(startLon), -halfW, halfW);
  const startZ = clamp(latToZ(startLat), -halfH, halfH);

  let initialYaw = 0;
  if (routeCoords.length > 1) {
    const ahead = routeCoords[Math.min(4, routeCoords.length - 1)];
    const adx = lonToX(ahead[0]) - startX;
    const adz = latToZ(ahead[1]) - startZ;
    if (Math.hypot(adx, adz) > 0.5) initialYaw = Math.atan2(-adx, -adz);
  }

  let playing = false;
  let speedMult = 1;
  let freeRoam = true;
  let yawOffset = initialYaw;
  let pitchOffset = -0.04;
  let walkedM = 0;
  const freePos = new THREE.Vector3(startX, getSafeEyeY(startX, startZ), startZ);
  const keys = new Set();

  // Mouse drag look
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  renderer.domElement.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener("pointerup", () => (dragging = false));
  window.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    yawOffset -= (e.clientX - lastX) * 0.004;
    pitchOffset = Math.max(-1.25, Math.min(1.15, pitchOffset - (e.clientY - lastY) * 0.003));
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
  const btnPlay = document.getElementById("hud-play");
  const scrubber = document.getElementById("hud-scrubber");
  const btnSpeed = document.getElementById("hud-speed");
  const btnTex = document.getElementById("hud-tex");
  const btnAr = document.getElementById("hud-ar-toggle");
  const btnFreeRoam = document.getElementById("hud-freeroam");
  const btnResetLook = document.getElementById("hud-reset-look");
  const btnPov = document.getElementById("hud-pov-btn");

  if (btnTex) {
    btnTex.textContent = useSlopeTex ? "Tex: Slope" : "Tex: Ortho";
    if (!assets.orthoPreviewUrl) btnTex.disabled = true;
  }
  if (btnFreeRoam) {
    btnFreeRoam.textContent = "Free-Roam: ON (WASD)";
  }

  btnPlay?.addEventListener("click", () => {
    playing = !playing;
    if (playing) {
      freeRoam = false;
      if (btnFreeRoam) btnFreeRoam.textContent = "Free-Roam: OFF";
    }
    btnPlay.textContent = playing ? "⏸ Pause" : "▶ Walk EVA";
  });

  scrubber?.addEventListener("input", () => {
    alongM = parseFloat(scrubber.value) || 0;
    if (freeRoam) {
      const s = sampleAlongRoute(routeCoords, cumDist, alongM);
      const rx = clamp(lonToX(s.lon), -halfW, halfW);
      const rz = clamp(latToZ(s.lat), -halfH, halfH);
      freePos.set(rx, getSafeEyeY(rx, rz), rz);
    }
  });

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

  btnFreeRoam?.addEventListener("click", () => {
    freeRoam = !freeRoam;
    if (freeRoam) {
      playing = false;
      if (btnPlay) btnPlay.textContent = "▶ Walk EVA";
      freePos.x = clamp(camera.position.x, -halfW, halfW);
      freePos.z = clamp(camera.position.z, -halfH, halfH);
      freePos.y = getSafeEyeY(freePos.x, freePos.z);
    }
    btnFreeRoam.textContent = freeRoam ? "Free-Roam: ON (WASD)" : "Free-Roam: OFF";
  });

  btnResetLook?.addEventListener("click", () => {
    yawOffset = initialYaw;
    pitchOffset = -0.04;
  });

  // Listen for mm:set-route (moves astronaut to chosen stop / route point without locking WASD)
  onSetRoute(({ route: newRoute, along_m }) => {
    alongM = along_m || 0;
    rebuildRouteRibbon(newRoute);
    const s = sampleAlongRoute(routeCoords, cumDist, alongM);
    const rx = clamp(lonToX(s.lon), -halfW, halfW);
    const rz = clamp(latToZ(s.lat), -halfH, halfH);
    freePos.set(rx, getSafeEyeY(rx, rz), rz);
  });

  const compassEl = document.getElementById("hud-compass");

  function updateHudReadouts(sM, lon, lat, camX, camZ) {
    // Update AR stop distances
    for (const st of stopSprites) {
      updateArLabelDist(st.sprite, Math.hypot(st.x - camX, st.z - camZ));
    }

    // Compass heading from current camera yawOffset
    if (compassEl) {
      const lookHeadingDeg = (-yawOffset * 180) / Math.PI;
      compassEl.textContent = `HDG ${compassLabel(lookHeadingDeg)}`;
    }

    // Honest empty state if route & telemetry are both missing
    const primaryTel = telemetry?.primary || telemetry;
    if (!activeRoute && !primaryTel && !elevGrid) {
      document.getElementById("hud-dist").textContent = "no NASA value";
      document.getElementById("hud-dist-sub").textContent = "route.json / hud-telemetry.json missing";
      document.getElementById("hud-slope").textContent = "no NASA value";
      document.getElementById("hud-next-stop").textContent = "no NASA value";
      document.getElementById("hud-next-kind").textContent = "stops.json missing";
      document.getElementById("hud-o2").textContent = "no NASA value";
      return;
    }

    const prof = activeRoute?.profile || [];
    let slopeDeg = freeRoam ? sampleSlopeDeg(camX, camZ) : (primaryTel?.slope_deg ?? null);
    if (!freeRoam && prof.length > 1) {
      let i = 0;
      while (i < prof.length - 2 && prof[i + 1].s_m < sM) i++;
      slopeDeg = prof[i].slope_deg ?? slopeDeg;
    } else if (slopeDeg == null) {
      slopeDeg = sampleSlopeDeg(camX, camZ);
    }
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

    const budgetM = totalDist > 0 ? totalDist : 2500;
    const frac = Math.min(1, sM / budgetM);
    const rem = totalDist > 0 ? Math.max(0, totalDist - sM) : null;
    const o2Pct =
      sM === 0 && primaryTel?.suit_o2_remaining_percent != null && !activeRoute
        ? primaryTel.suit_o2_remaining_percent
        : Math.max(0, 100 * (1 - frac));

    document.getElementById("hud-dist").textContent = `${sM.toFixed(1)} m`;
    document.getElementById("hud-dist-sub").textContent = freeRoam
      ? `WASD Walk · Next: ${minStopDist < Infinity ? minStopDist.toFixed(0) + " m" : "no NASA value"}`
      : `Rem: ${rem != null ? rem.toFixed(1) + " m" : "—"} · Next: ${minStopDist < Infinity ? minStopDist.toFixed(0) + " m" : "no NASA value"}`;
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

  // Animation Loop (camera-relative WASD at 1.7m eye height, no forced yaw turns)
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
    const anyWalkKey = fwdInput !== 0 || strafeInput !== 0;

    // Pressing WASD switches seamlessly back to 1st-person manual control from current position
    if (anyWalkKey && !freeRoam) {
      freeRoam = true;
      playing = false;
      if (btnPlay) btnPlay.textContent = "▶ Walk EVA";
      if (btnFreeRoam) btnFreeRoam.textContent = "Free-Roam: ON (WASD)";
      freePos.x = clamp(camera.position.x, -halfW, halfW);
      freePos.z = clamp(camera.position.z, -halfH, halfH);
    }

    if (playing && !freeRoam) {
      alongM += dt * 12 * speedMult;
      if (alongM > totalDist) alongM = 0;
      if (scrubber) scrubber.value = alongM.toFixed(1);
    }

    let hudLon;
    let hudLat;
    let hudDistM;

    if (freeRoam) {
      if (anyWalkKey) {
        const sprint = keys.has("shift") ? 2.2 : 1;
        const moveSpeed = 10 * speedMult * sprint;
        // Derive horizontal forward & right axes directly from current camera yawOffset
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
      hudLon = xToLon(freePos.x);
      hudLat = zToLat(freePos.z);
      hudDistM = walkedM;
    } else {
      const sample = sampleAlongRoute(routeCoords, cumDist, alongM);
      const rx = clamp(lonToX(sample.lon), -halfW, halfW);
      const rz = clamp(latToZ(sample.lat), -halfH, halfH);
      camera.position.set(rx, getSafeEyeY(rx, rz), rz);
      hudLon = sample.lon;
      hudLat = sample.lat;
      hudDistM = sample.sM;
    }

    camera.rotation.order = "YXZ";
    camera.rotation.y = yawOffset;
    camera.rotation.x = pitchOffset;

    updateHudReadouts(hudDistM, hudLon, hudLat, camera.position.x, camera.position.z);
    if (onPositionChange) onPositionChange(hudLon, hudLat, hudDistM);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);

  return { onResize };
}
