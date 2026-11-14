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

  // Scene, Camera, Renderer
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x21140f);
  scene.fog = new THREE.FogExp2(0x3a2319, 0.00072);

  const camera = new THREE.PerspectiveCamera(
    68,
    wrap.clientWidth / Math.max(1, wrap.clientHeight),
    0.5,
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

  // Decode height-preview.png (8-bit RGB: R*256 + G)
  const segW = 197;
  const segH = 197;
  const geom = new THREE.PlaneGeometry(worldW, worldH, segW, segH);
  geom.rotateX(-Math.PI / 2);

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

    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);
      const u = Math.max(0, Math.min(1, vx / worldW + 0.5));
      const v = Math.max(0, Math.min(1, vz / worldH + 0.5));
      const ix = Math.min(imgW - 1, Math.floor(u * (imgW - 1)));
      const iy = Math.min(imgH - 1, Math.floor(v * (imgH - 1)));
      pos.setY(i, elevGrid[iy * imgW + ix] - elevMin);
    }
    geom.computeVertexNormals();
  } catch {
    // Fallback: flat terrain
  }

  function sampleElevSceneY(x, z) {
    if (!elevGrid) return 0;
    const u = Math.max(0, Math.min(1, x / worldW + 0.5));
    const v = Math.max(0, Math.min(1, z / worldH + 0.5));
    const fx = u * (imgW - 1);
    const fy = v * (imgH - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(imgW - 1, x0 + 1);
    const y1 = Math.min(imgH - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const e00 = elevGrid[y0 * imgW + x0];
    const e10 = elevGrid[y0 * imgW + x1];
    const e01 = elevGrid[y1 * imgW + x0];
    const e11 = elevGrid[y1 * imgW + x1];
    const top = e00 + (e10 - e00) * tx;
    const bot = e01 + (e11 - e01) * tx;
    return top + (bot - top) * ty - elevMin;
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

  // State & Controls
  let playing = false;
  let speedMult = 1;
  let freeRoam = false;
  let yawOffset = 0;
  let pitchOffset = -0.06;
  const freePos = new THREE.Vector3(0, 10, 0);
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
    pitchOffset = Math.max(-0.8, Math.min(0.8, pitchOffset - (e.clientY - lastY) * 0.003));
    lastX = e.clientX;
    lastY = e.clientY;
  });

  window.addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

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

  btnPlay?.addEventListener("click", () => {
    playing = !playing;
    btnPlay.textContent = playing ? "⏸ Pause" : "▶ Walk EVA";
  });

  scrubber?.addEventListener("input", () => {
    alongM = parseFloat(scrubber.value) || 0;
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
    btnFreeRoam.textContent = freeRoam ? "Free-Roam: ON (WASD)" : "Free-Roam: OFF";
    if (freeRoam) freePos.copy(camera.position);
  });

  btnResetLook?.addEventListener("click", () => {
    yawOffset = 0;
    pitchOffset = -0.06;
  });

  // Listen for mm:set-route
  onSetRoute(({ route: newRoute, along_m }) => {
    alongM = along_m || 0;
    freeRoam = false;
    if (btnFreeRoam) btnFreeRoam.textContent = "Free-Roam: OFF";
    rebuildRouteRibbon(newRoute);
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
    if (!activeRoute && !primaryTel) {
      document.getElementById("hud-dist").textContent = "no NASA value";
      document.getElementById("hud-dist-sub").textContent = "route.json / hud-telemetry.json missing";
      document.getElementById("hud-slope").textContent = "no NASA value";
      document.getElementById("hud-next-stop").textContent = "no NASA value";
      document.getElementById("hud-next-kind").textContent = "stops.json missing";
      document.getElementById("hud-o2").textContent = "no NASA value";
      return;
    }

    const frac = totalDist > 0 ? sM / totalDist : 0;
    const rem = Math.max(0, totalDist - sM);

    const prof = activeRoute?.profile || [];
    let slopeDeg = primaryTel?.slope_deg ?? null;
    if (prof.length > 1) {
      let i = 0;
      while (i < prof.length - 2 && prof[i + 1].s_m < sM) i++;
      slopeDeg = prof[i].slope_deg ?? slopeDeg;
    }
    const slopeClass = classifySlope(slopeDeg, 20);

    let nextStop = stops?.features?.[0] || null;
    let minStopDist = Infinity;
    if (stops?.features?.length) {
      for (const f of stops.features) {
        const dx = lonToX(f.geometry.coordinates[0]) - lonToX(lon);
        const dz = latToZ(f.geometry.coordinates[1]) - latToZ(lat);
        const d = Math.hypot(dx, dz);
        if (d < minStopDist) {
          minStopDist = d;
          nextStop = f;
        }
      }
    }

    const o2Pct =
      sM === 0 && primaryTel?.suit_o2_remaining_percent != null && !activeRoute
        ? primaryTel.suit_o2_remaining_percent
        : Math.max(0, 100 * (1 - frac));

    document.getElementById("hud-dist").textContent = `${sM.toFixed(1)} m`;
    document.getElementById("hud-dist-sub").textContent =
      `Rem: ${rem.toFixed(1)} m · Next: ${minStopDist < Infinity ? minStopDist.toFixed(0) + " m" : "no NASA value"}`;
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

  // Animation Loop (no forced camera yaw on turns — user keeps full control of look direction)
  let prevT = performance.now();
  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min(0.1, (now - prevT) / 1000);
    prevT = now;

    if (playing && !freeRoam) {
      alongM += dt * 12 * speedMult;
      if (alongM > totalDist) alongM = 0;
      if (scrubber) scrubber.value = alongM.toFixed(1);
    }

    const sample = sampleAlongRoute(routeCoords, cumDist, alongM);
    const rx = lonToX(sample.lon);
    const rz = latToZ(sample.lat);

    if (freeRoam) {
      const moveSpeed = 30 * dt;
      const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yawOffset);
      const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yawOffset);
      if (keys.has("w") || keys.has("arrowup")) freePos.addScaledVector(forward, moveSpeed);
      if (keys.has("s") || keys.has("arrowdown")) freePos.addScaledVector(forward, -moveSpeed);
      if (keys.has("d") || keys.has("arrowright")) freePos.addScaledVector(right, moveSpeed);
      if (keys.has("a") || keys.has("arrowleft")) freePos.addScaledVector(right, -moveSpeed);
      freePos.y = sampleElevSceneY(freePos.x, freePos.z) + 2.2;
      camera.position.copy(freePos);
      camera.rotation.order = "YXZ";
      camera.rotation.y = yawOffset;
      camera.rotation.x = pitchOffset;
    } else {
      const ry = sampleElevSceneY(rx, rz);
      camera.position.set(rx, ry + 2.2, rz);
      camera.rotation.order = "YXZ";
      camera.rotation.y = yawOffset;
      camera.rotation.x = pitchOffset;
    }

    updateHudReadouts(sample.sM, sample.lon, sample.lat, camera.position.x, camera.position.z);
    if (onPositionChange) onPositionChange(sample.lon, sample.lat, sample.sM);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);

  return { onResize };
}
