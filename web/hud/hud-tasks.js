/**
 * Tasks Mission Terminal UI, Terrain Minimap, Debrief Card, and 3D Ground Route Guide (`web/hud/hud-tasks.js`).
 *
 * All Tasks planning works from any monitor inside the Mars Habitat (`[E]` / click) or via the Transit Terminal.
 * Offline `?demo=1` safe (zero network requests).
 */

import { drawTelemetryScreenOnCtx } from "./habitat-textures.js";
import {
  TASK_VEHICLE_PROFILES,
  computeRoverRegionSummary,
  computeTaskProgress,
  generateVehicleRoutes,
  getTaskTargetRover,
  getTaskTargetRovers,
  getTaskVehicleProfile,
  selectHabitatStagingSpot,
} from "../shared/task-router.js";

function escHtml(v) {
  return String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function fmtDuration(sec, tr) {
  const s = Math.max(1, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m <= 0) return tr ? `${remS} sn` : `${remS}s`;
  return tr ? `${m} dk ${String(remS).padStart(2, "0")} sn` : `${m}m ${String(remS).padStart(2, "0")}s`;
}

/** Pre-bakes terrain elevation + NASA lunar EVA ConOps slope hazard shading onto an offscreen canvas. */
function buildTerrainBackdropBitmap(bundle, width, height) {
  if (!bundle?.grid || typeof document === "undefined") return null;
  const { nx, nz, elev, slope, elevMin, elevMax } = bundle.grid;
  const off = document.createElement("canvas");
  off.width = width;
  off.height = height;
  const ctx = off.getContext("2d");
  const img = ctx.createImageData(width, height);
  const data = img.data;
  const spanElev = Math.max(1, elevMax - elevMin);

  for (let py = 0; py < height; py++) {
    const gz = Math.min(nz - 1.001, Math.max(0, (py / Math.max(1, height - 1)) * (nz - 1)));
    const z0 = Math.floor(gz);
    const z1 = Math.min(nz - 1, z0 + 1);
    const tz = gz - z0;
    const r0 = z0 * nx;
    const r1 = z1 * nx;
    for (let px = 0; px < width; px++) {
      const gx = Math.min(nx - 1.001, Math.max(0, (px / Math.max(1, width - 1)) * (nx - 1)));
      const x0 = Math.floor(gx);
      const x1 = Math.min(nx - 1, x0 + 1);
      const tx = gx - x0;

      const eTop = elev[r0 + x0] + (elev[r0 + x1] - elev[r0 + x0]) * tx;
      const eBot = elev[r1 + x0] + (elev[r1 + x1] - elev[r1 + x0]) * tx;
      const eVal = eTop + (eBot - eTop) * tz;

      const sTop = slope[r0 + x0] + (slope[r0 + x1] - slope[r0 + x0]) * tx;
      const sBot = slope[r1 + x0] + (slope[r1 + x1] - slope[r1 + x0]) * tx;
      const sVal = sTop + (sBot - sTop) * tz;

      const tElev = (eVal - elevMin) / spanElev;
      // Warm Martian hypsometric base shaded gently by local grade tiers
      let r = 24 + tElev * 56;
      let g = 29 + tElev * 42;
      let b = 38 + tElev * 30;
      if (sVal > 20) {
        r += 96;
        g -= 10;
      } else if (sVal > 15) {
        r += 66;
        g += 12;
      } else if (sVal > 10) {
        r += 34;
        g += 24;
      }
      // Subtle contour bands every ~7% elevation
      const contour = Math.abs(((tElev * 14) % 1) - 0.5);
      if (contour < 0.045) {
        r += 18;
        g += 20;
        b += 24;
      }

      const o = (py * width + px) * 4;
      data[o] = Math.max(0, Math.min(255, r | 0));
      data[o + 1] = Math.max(0, Math.min(255, g | 0));
      data[o + 2] = Math.max(0, Math.min(255, b | 0));
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return off;
}

/** Renders the terrain map + all 3 routes + Habitat & Target Rover markers (+ optional player cursor). */
export function renderTaskTerrainCanvas(
  canvas,
  {
    bundle,
    backdropCanvas = null,
    selectedRouteId = null,
    habX = 0,
    habZ = 0,
    targetX = 0,
    targetZ = 0,
    targetRover = null,
    player = null, // { x, z, yawRad }
    zoomedFollow = false,
  }
) {
  if (!canvas || !bundle?.bounds) return;
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);

  const b = bundle.bounds;
  const worldSpanX = Math.max(10, b.maxX - b.minX);
  const worldSpanZ = Math.max(10, b.maxZ - b.minZ);

  let viewMinX = b.minX;
  let viewMaxX = b.maxX;
  let viewMinZ = b.minZ;
  let viewMaxZ = b.maxZ;
  if (zoomedFollow && player) {
    const halfSpan = 210;
    const aspect = w / Math.max(1, h);
    viewMinX = player.x - halfSpan * aspect;
    viewMaxX = player.x + halfSpan * aspect;
    viewMinZ = player.z - halfSpan;
    viewMaxZ = player.z + halfSpan;
  }

  const toPx = (x, z) => ({
    x: ((x - viewMinX) / Math.max(1, viewMaxX - viewMinX)) * w,
    y: ((z - viewMinZ) / Math.max(1, viewMaxZ - viewMinZ)) * h,
  });

  ctx.fillStyle = "#08101c";
  ctx.fillRect(0, 0, w, h);

  if (backdropCanvas) {
    if (zoomedFollow && player) {
      const sx = ((viewMinX - b.minX) / worldSpanX) * backdropCanvas.width;
      const sy = ((viewMinZ - b.minZ) / worldSpanZ) * backdropCanvas.height;
      const sw = ((viewMaxX - viewMinX) / worldSpanX) * backdropCanvas.width;
      const sh = ((viewMaxZ - viewMinZ) / worldSpanZ) * backdropCanvas.height;
      ctx.drawImage(backdropCanvas, sx, sy, sw, sh, 0, 0, w, h);
    } else {
      ctx.drawImage(backdropCanvas, 0, 0, w, h);
    }
  }

  // Faint coordinate grid
  ctx.strokeStyle = "rgba(148,163,184,0.16)";
  ctx.lineWidth = 1;
  const gridStep = zoomedFollow ? 100 : 250;
  const gx0 = Math.floor(viewMinX / gridStep) * gridStep;
  for (let gx = gx0; gx <= viewMaxX; gx += gridStep) {
    const p = toPx(gx, viewMinZ);
    ctx.beginPath();
    ctx.moveTo(p.x, 0);
    ctx.lineTo(p.x, h);
    ctx.stroke();
  }
  const gz0 = Math.floor(viewMinZ / gridStep) * gridStep;
  for (let gz = gz0; gz <= viewMaxZ; gz += gridStep) {
    const p = toPx(viewMinX, gz);
    ctx.beginPath();
    ctx.moveTo(0, p.y);
    ctx.lineTo(w, p.y);
    ctx.stroke();
  }

  // Draw non-selected routes first, then selected route on top with outer glow
  const routes = bundle.routes || [];
  const ordered = [
    ...routes.filter((r) => r.id !== selectedRouteId),
    ...routes.filter((r) => r.id === selectedRouteId),
  ];

  for (const rt of ordered) {
    if (!rt?.points?.length) continue;
    const isSel = rt.id === selectedRouteId;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (isSel) {
      ctx.strokeStyle = rt.color;
      ctx.shadowColor = rt.color;
      ctx.shadowBlur = 10;
      ctx.lineWidth = 3.4;
      ctx.globalAlpha = 1;
    } else {
      ctx.strokeStyle = rt.color;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.52;
    }
    ctx.beginPath();
    rt.points.forEach((pt, idx) => {
      const p = toPx(pt.x, pt.z);
      if (idx === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  // Habitat garage marker
  const habP = toPx(habX, habZ);
  ctx.save();
  ctx.fillStyle = "#38bdf8";
  ctx.strokeStyle = "#03101d";
  ctx.lineWidth = 1.5;
  ctx.fillRect(habP.x - 5.5, habP.y - 5.5, 11, 11);
  ctx.strokeRect(habP.x - 5.5, habP.y - 5.5, 11, 11);
  ctx.font = "bold 9px monospace";
  ctx.fillStyle = "#e0f2fe";
  ctx.fillText("HAB", Math.min(w - 28, Math.max(4, habP.x + 8)), Math.min(h - 6, Math.max(11, habP.y + 3)));
  ctx.restore();

  // Target historic rover marker (clamp directional arrow on edge if zoomed out of view)
  const tgtP = toPx(targetX, targetZ);
  const inView = tgtP.x >= 6 && tgtP.x <= w - 6 && tgtP.y >= 6 && tgtP.y <= h - 6;
  const tgtColor = targetRover?.color || "#f43f5e";
  ctx.save();
  if (inView) {
    ctx.strokeStyle = tgtColor;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(tgtP.x, tgtP.y, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = tgtColor;
    ctx.beginPath();
    ctx.arc(tgtP.x, tgtP.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "bold 9px monospace";
    ctx.fillStyle = "#fef2f2";
    const lbl = (targetRover?.name || "TARGET").slice(0, 6).toUpperCase();
    ctx.fillText(lbl, Math.min(w - 42, Math.max(4, tgtP.x + 11)), Math.min(h - 6, Math.max(12, tgtP.y + 3)));
  } else if (zoomedFollow) {
    const cx = w * 0.5;
    const cy = h * 0.5;
    const ang = Math.atan2(tgtP.y - cy, tgtP.x - cx);
    const ex = cx + Math.cos(ang) * (w * 0.43);
    const ey = cy + Math.sin(ang) * (h * 0.43);
    ctx.translate(ex, ey);
    ctx.rotate(ang);
    ctx.fillStyle = tgtColor;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-5, -5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Live player / driven rover cursor
  if (player) {
    const pp = toPx(player.x, player.z);
    ctx.save();
    ctx.translate(pp.x, pp.y);
    // scene yaw 0 -> -Z (north = -Y on canvas), yaw > 0 rotates counter-clockwise (+X left when looking south)
    ctx.rotate(-(player.yawRad || 0));
    ctx.fillStyle = "#facc15";
    ctx.strokeStyle = "#08101c";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // North label
  ctx.fillStyle = "rgba(226,232,240,0.65)";
  ctx.font = "bold 9px monospace";
  ctx.fillText("N ↑", 6, 12);
}

/** Builds & manages 3D ground route ribbons, directional pylons, bay ring, and target beacon. */
export function createTaskGuide3D(THREE, scene) {
  const group = new THREE.Group();
  group.name = "task-route-guide";
  group.visible = false;
  scene.add(group);

  let builtState = null;
  let bayRingMesh = null;
  let beaconColumnMesh = null;
  let beaconRingMesh = null;
  const pylonRings = [];
  const sampleUpdateTargets = [];

  function disposeResources() {
    while (group.children.length) {
      const child = group.children[0];
      group.remove(child);
      child.traverse?.((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose();
        }
      });
    }
    bayRingMesh = null;
    beaconColumnMesh = null;
    beaconRingMesh = null;
    pylonRings.length = 0;
    sampleUpdateTargets.length = 0;
  }

  /** Resample a route polyline cleanly every ~4.5 m so ribbon segments conform closely to terrain. */
  function densifyPoints(points, stepM = 4.5) {
    const out = [];
    if (!points || points.length === 0) return out;
    out.push({ x: points[0].x, z: points[0].z });
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      const sub = Math.max(1, Math.ceil(d / stepM));
      for (let k = 1; k <= sub; k++) {
        const t = k / sub;
        out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      }
    }
    return out;
  }

  function buildRibbonMesh(densePts, widthM, yOffsetM, colorHex, opacity, sampleY) {
    const n = densePts.length;
    if (n < 2) return null;
    const positions = new Float32Array(n * 2 * 3);
    const uvs = new Float32Array(n * 2 * 2);
    const indices = [];
    const halfW = widthM * 0.5;
    let accum = 0;

    for (let i = 0; i < n; i++) {
      const p = densePts[i];
      const prev = densePts[Math.max(0, i - 1)];
      const next = densePts[Math.min(n - 1, i + 1)];
      if (i > 0) accum += Math.hypot(p.x - prev.x, p.z - prev.z);
      let dx = next.x - prev.x;
      let dz = next.z - prev.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const nx = -dz * halfW;
      const nz = dx * halfW;

      const xL = p.x + nx;
      const zL = p.z + nz;
      const xR = p.x - nx;
      const zR = p.z - nz;
      const yL = (sampleY ? sampleY(xL, zL) : 0) + yOffsetM;
      const yR = (sampleY ? sampleY(xR, zR) : 0) + yOffsetM;

      positions[i * 6] = xL;
      positions[i * 6 + 1] = yL;
      positions[i * 6 + 2] = zL;
      positions[i * 6 + 3] = xR;
      positions[i * 6 + 4] = yR;
      positions[i * 6 + 5] = zR;

      uvs[i * 4] = 0;
      uvs[i * 4 + 1] = accum * 0.08;
      uvs[i * 4 + 2] = 1;
      uvs[i * 4 + 3] = accum * 0.08;

      if (i < n - 1) {
        const v0 = i * 2;
        const v1 = v0 + 1;
        const v2 = v0 + 2;
        const v3 = v0 + 3;
        indices.push(v0, v2, v1, v1, v2, v3);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    geom.computeBoundingSphere();

    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex),
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const m = new THREE.Mesh(geom, mat);
    m.renderOrder = 3;
    sampleUpdateTargets.push({ kind: "ribbon", mesh: m, halfW, densePts, yOffsetM });
    return m;
  }

  function build({ routes, selectedRouteId, targetRover, targetX, targetZ, sampleY, bayPosition }) {
    disposeResources();
    builtState = { routes, selectedRouteId, targetRover, targetX, targetZ, bayPosition };
    const selRoute = routes.find((r) => r.id === selectedRouteId) || routes[0];
    if (!selRoute) return;

    // 1. Dim ground guide lines for the 2 alternate routes so player can compare terrain corridors
    for (const rt of routes) {
      if (rt.id === selRoute.id) continue;
      const dense = densifyPoints(rt.points, 8.0);
      const dimRibbon = buildRibbonMesh(dense, 0.55, 0.16, rt.color, 0.22, sampleY);
      if (dimRibbon) group.add(dimRibbon);
    }

    // 2. Selected glowing route: wide soft halo ribbon + crisp bright core strip
    const selDense = densifyPoints(selRoute.points, 4.5);
    const haloRibbon = buildRibbonMesh(selDense, 2.35, 0.14, selRoute.color, 0.34, sampleY);
    if (haloRibbon) group.add(haloRibbon);
    const coreRibbon = buildRibbonMesh(selDense, 0.62, 0.22, selRoute.color, 0.88, sampleY);
    if (coreRibbon) group.add(coreRibbon);

    // 3. Waypoint pylons every ~55 m along selected route
    const postGeo = new THREE.CylinderGeometry(0.05, 0.08, 2.0, 8);
    const haloRingGeo = new THREE.TorusGeometry(0.32, 0.04, 6, 18);
    let nextPylonAt = 42;
    for (let i = 1; i < selRoute.points.length - 1; i++) {
      const pt = selRoute.points[i];
      if (pt.sM < nextPylonAt) continue;
      nextPylonAt = pt.sM + 55;
      const next = selRoute.points[Math.min(selRoute.points.length - 1, i + 1)];
      const yaw = Math.atan2(next.x - pt.x, next.z - pt.z);
      const py = sampleY ? sampleY(pt.x, pt.z) : 0;

      const post = new THREE.Group();
      post.position.set(pt.x, py, pt.z);
      post.rotation.y = yaw;

      const poleMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(selRoute.color),
        transparent: true,
        opacity: 0.72,
      });
      const pole = new THREE.Mesh(postGeo.clone(), poleMat);
      pole.position.y = 1.0;
      post.add(pole);

      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.86,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(haloRingGeo.clone(), ringMat);
      ring.position.y = 1.85;
      post.add(ring);
      pylonRings.push(ring);

      group.add(post);
      sampleUpdateTargets.push({ kind: "obj", obj: post, x: pt.x, z: pt.z, yOff: 0 });
    }
    postGeo.dispose();
    haloRingGeo.dispose();

    // 4. Bay floor pulse ring around selected drivable rover until driven away
    if (bayPosition) {
      const by = (sampleY ? sampleY(bayPosition.x, bayPosition.z) : 0) + 0.14;
      const bayGeo = new THREE.RingGeometry(2.4, 3.05, 40);
      bayGeo.rotateX(-Math.PI / 2);
      const bayMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(selRoute.color),
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      bayRingMesh = new THREE.Mesh(bayGeo, bayMat);
      bayRingMesh.position.set(bayPosition.x, by, bayPosition.z);
      group.add(bayRingMesh);
      sampleUpdateTargets.push({ kind: "obj", obj: bayRingMesh, x: bayPosition.x, z: bayPosition.z, yOff: 0.14 });
    }

    // 5. Tall discovery beacon & 13.5 m arrival circle at target rover
    const tgtColor = targetRover?.color || "#f43f5e";
    const ty = sampleY ? sampleY(targetX, targetZ) : 0;
    const arrGeo = new THREE.RingGeometry(12.6, 13.5, 64);
    arrGeo.rotateX(-Math.PI / 2);
    const arrMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(tgtColor),
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    beaconRingMesh = new THREE.Mesh(arrGeo, arrMat);
    beaconRingMesh.position.set(targetX, ty + 0.18, targetZ);
    group.add(beaconRingMesh);
    sampleUpdateTargets.push({ kind: "obj", obj: beaconRingMesh, x: targetX, z: targetZ, yOff: 0.18 });

    const colGeo = new THREE.CylinderGeometry(0.22, 0.95, 56, 16, 1, true);
    const colMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(tgtColor),
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    beaconColumnMesh = new THREE.Mesh(colGeo, colMat);
    beaconColumnMesh.position.set(targetX, ty + 28.0, targetZ);
    group.add(beaconColumnMesh);
    sampleUpdateTargets.push({ kind: "obj", obj: beaconColumnMesh, x: targetX, z: targetZ, yOff: 28.0 });

    group.visible = true;
  }

  function rebuildHeights(sampleY) {
    if (!group.visible || !sampleY) return;
    for (const item of sampleUpdateTargets) {
      if (item.kind === "obj") {
        item.obj.position.y = sampleY(item.x, item.z) + item.yOff;
      } else if (item.kind === "ribbon") {
        const pos = item.mesh.geometry.attributes.position;
        const pts = item.densePts;
        const n = pts.length;
        for (let i = 0; i < n; i++) {
          const p = pts[i];
          const prev = pts[Math.max(0, i - 1)];
          const next = pts[Math.min(n - 1, i + 1)];
          let dx = next.x - prev.x;
          let dz = next.z - prev.z;
          const len = Math.hypot(dx, dz) || 1;
          dx /= len;
          dz /= len;
          const nx = -dz * item.halfW;
          const nz = dx * item.halfW;
          pos.setY(i * 2, sampleY(p.x + nx, p.z + nz) + item.yOffsetM);
          pos.setY(i * 2 + 1, sampleY(p.x - nx, p.z - nz) + item.yOffsetM);
        }
        pos.needsUpdate = true;
      }
    }
  }

  function update(dt, clockT, playerX, playerZ, selectedDrvX, selectedDrvZ) {
    if (!group.visible || !builtState) return;
    for (let i = 0; i < pylonRings.length; i++) {
      pylonRings[i].rotation.y = clockT * 1.4 + i * 0.4;
      pylonRings[i].position.y = 1.82 + Math.sin(clockT * 2.5 + i * 0.6) * 0.09;
    }
    if (bayRingMesh && builtState.bayPosition) {
      const moved = Math.hypot(selectedDrvX - builtState.bayPosition.x, selectedDrvZ - builtState.bayPosition.z) > 10;
      bayRingMesh.visible = !moved;
      if (bayRingMesh.visible) {
        const s = 1 + Math.sin(clockT * 3.0) * 0.06;
        bayRingMesh.scale.set(s, 1, s);
        bayRingMesh.material.opacity = 0.5 + 0.3 * Math.sin(clockT * 3.2);
      }
    }
    if (beaconColumnMesh && beaconRingMesh) {
      const d = Math.hypot(builtState.targetX - playerX, builtState.targetZ - playerZ);
      const fade = Math.max(0, Math.min(1, (d - 14) / 28));
      beaconColumnMesh.material.opacity = 0.28 * fade;
      beaconColumnMesh.visible = fade > 0.02;
      beaconRingMesh.material.opacity = 0.38 + 0.2 * Math.sin(clockT * 2.6);
    }
  }

  return {
    group,
    build,
    rebuildHeights,
    update,
    clear: () => {
      group.visible = false;
      builtState = null;
      disposeResources();
    },
  };
}

/**
 * Coordinates the Pink Corridor Tasks screen modal, live HUD Minimap, and Mission Debrief card.
 */
export function createTaskUiController({
  hudView,
  visorOverlay,
  isTrLang,
  planForRoverAndVehicle,
  getActiveTask,
  onStartTask,
  onAbortTask,
  onReturnToCorridor,
  onReleasePointerLock,
}) {
  const panelEl = document.createElement("div");
  panelEl.id = "hud-task-panel";
  panelEl.className = "hud-task-panel";
  panelEl.setAttribute("role", "dialog");
  panelEl.setAttribute("aria-modal", "true");
  panelEl.setAttribute("aria-label", "Habitat Tasks & Route Planner");
  hudView.appendChild(panelEl);

  const minimapEl = document.createElement("aside");
  minimapEl.id = "hud-task-minimap";
  minimapEl.className = "hud-task-minimap";
  minimapEl.hidden = true;
  (visorOverlay || hudView).appendChild(minimapEl);

  const debriefEl = document.createElement("div");
  debriefEl.id = "hud-task-debrief";
  debriefEl.className = "hud-task-debrief";
  debriefEl.setAttribute("role", "dialog");
  debriefEl.setAttribute("aria-label", "Task Complete Debrief");
  hudView.appendChild(debriefEl);

  let sourceSpec = null;
  let activeTab = "tasks";
  let selectedRoverId = "perseverance";
  let selectedVehicleId = "mmsev";
  let selectedRouteId = "safe";
  let currentPlan = null;
  let previewBackdrop = null;
  let liveBackdrop = null;
  let livePlanKey = "";
  let minimapZoomed = false;
  let lastMinimapDrawMs = 0;

  const isOpen = () => panelEl.classList.contains("open");
  const isDebriefOpen = () => debriefEl.classList.contains("open");

  function close() {
    panelEl.classList.remove("open");
  }

  function closeDebrief() {
    debriefEl.classList.remove("open");
  }

  function refreshPlan(autoPickRecommended = false) {
    currentPlan = planForRoverAndVehicle(selectedRoverId, selectedVehicleId);
    previewBackdrop = buildTerrainBackdropBitmap(currentPlan.bundle, 360, 232);
    if (autoPickRecommended && currentPlan?.bundle?.routes?.length) {
      const rec = currentPlan.bundle.routes.find((r) => r.recommended) || currentPlan.bundle.routes[0];
      selectedRouteId = rec.id;
    } else if (!currentPlan?.bundle?.routes?.some((r) => r.id === selectedRouteId)) {
      selectedRouteId = currentPlan?.bundle?.routes?.[0]?.id || "safe";
    }
  }

  function drawPreviewCanvas() {
    const cvs = panelEl.querySelector("#tp-preview-canvas");
    if (!cvs || !currentPlan) return;
    renderTaskTerrainCanvas(cvs, {
      bundle: currentPlan.bundle,
      backdropCanvas: previewBackdrop,
      selectedRouteId,
      habX: currentPlan.staging.habX,
      habZ: currentPlan.staging.habZ,
      targetX: currentPlan.targetX,
      targetZ: currentPlan.targetZ,
      targetRover: currentPlan.targetRover,
      player: null,
      zoomedFollow: false,
    });
  }

  function renderPanel() {
    const tr = isTrLang();
    if (!currentPlan) refreshPlan(true);
    const rovers = getTaskTargetRovers();
    const tgt = currentPlan.targetRover;
    const veh = currentPlan.vehicle;
    const routes = currentPlan.bundle.routes;
    const regionSum = computeRoverRegionSummary(tgt);
    const activeTask = getActiveTask();
    const isTaskRunning = activeTask?.status === "active";

    const roverButtons = rovers
      .map((r) => {
        const active = r.id === selectedRoverId ? " active" : "";
        const dataTag = r.isHiRiseGaleSite
          ? tr ? "HiRISE 1m" : "HiRISE 1m"
          : tr ? "Prosedürel" : "Procedural";
        return `<button class="tk-chip${active}" type="button" data-tk-rover="${escHtml(r.id)}">
          <span class="tk-dot" style="background:${escHtml(r.color)};"></span>
          <span class="tk-chip-main">
            <b>${escHtml(r.name)}</b>
            <i>${escHtml(r.siteShortName)} · ${r.year} · ${dataTag}</i>
          </span>
        </button>`;
      })
      .join("");

    const vehicleCards = ["mmsev", "nasa_concept"]
      .map((vid) => {
        const vp = TASK_VEHICLE_PROFILES[vid];
        const active = vid === selectedVehicleId ? " active" : "";
        return `<button class="tk-veh${active}" type="button" data-tk-veh="${escHtml(vp.id)}">
          <div class="tk-veh-top">
            <span class="tk-dot" style="background:${escHtml(vp.badgeColor)};"></span>
            <b>${escHtml(tr ? vp.nameTr : vp.nameEn)}</b>
            <span>${vp.id === "mmsev" ? "BAY 02" : "BAY 04"}</span>
          </div>
          <div class="tk-veh-specs">${vp.massKg.toLocaleString("en-US")} kg · ${vp.powerKw} kW · ${Math.round(vp.wheelTorqueMaxNm).toLocaleString("en-US")} N·m · Ø ${(vp.wheelRadiusM * 2).toFixed(2)} m</div>
          <p class="tk-veh-note">${escHtml(tr ? vp.strengthTr : vp.strengthEn)}</p>
        </button>`;
      })
      .join("");

    const routeCards = routes
      .map((rt) => {
        const active = rt.id === selectedRouteId ? " active" : "";
        const badgeText =
          rt.recommended
            ? tr ? "ÖNERİLEN" : "RECOMMENDED"
            : rt.tier === "caution"
            ? tr ? "ZORLU" : "CAUTION"
            : tr ? "UYGUN" : "SUITABLE";
        const slopeCls =
          rt.maxSlopeDeg > 15 ? "slope-red" : rt.maxSlopeDeg > 10 ? "slope-amber" : "slope-green";
        return `<button class="tk-route${active}" type="button" data-tk-route="${escHtml(rt.id)}" style="--rt-col:${escHtml(rt.color)};">
          <div class="tk-route-head">
            <span class="tk-route-name"><i class="tk-swatch" style="background:${escHtml(rt.color)};"></i>${escHtml(tr ? rt.nameTr : rt.nameEn)}</span>
            <span class="tk-suit tk-tier-${escHtml(rt.tier)}">${rt.suitabilityPct}% · ${badgeText}</span>
          </div>
          <div class="tk-route-metrics">
            <span><b>${rt.distanceM} m</b> ${tr ? "rota" : "path"}</span>
            <span><b class="slope-pill ${slopeCls}">${rt.maxSlopeDeg}° max</b> (${rt.avgSlopeDeg}° avg)</span>
            <span>+${rt.elevGainM}m / -${rt.elevLossM}m</span>
            <span>~${fmtDuration(rt.estDriveSec, tr)} · ${rt.estEnergyKwh} kWh</span>
          </div>
          <p class="tk-route-reason">${escHtml(tr ? rt.reasonTr : rt.reasonEn)} <em>(${escHtml(rt.altVehicleShortLabel)}: ${rt.altSuitabilityPct}%)</em></p>
        </button>`;
      })
      .join("");

    const showTelem = Boolean(sourceSpec && sourceSpec.kind !== "tasks" && activeTab === "telemetry");
    panelEl.classList.toggle("is-telemetry", showTelem);
    const tabsHtml =
      sourceSpec && sourceSpec.kind !== "tasks"
        ? `<div class="tk-tabs" role="tablist">
            <button class="tk-tab${activeTab === "tasks" ? " active" : ""}" type="button" data-tk-tab="tasks">${
              tr ? "🛰️ EVA Görev Ayarla (Tasks)" : "🛰️ Plan EVA Task"
            }</button>
            <button class="tk-tab${activeTab === "telemetry" ? " active" : ""}" type="button" data-tk-tab="telemetry">${
              tr ? "📊 Ekran Telemetrisi:" : "📊 Screen Telemetry:"
            } ${escHtml(sourceSpec.title || "TELEMETRY")}</button>
          </div>`
        : "";
    const telemPaneHtml =
      sourceSpec && sourceSpec.kind !== "tasks"
        ? `<div class="tk-telemetry-pane"${showTelem ? "" : " hidden"}>
            <canvas id="tk-telemetry-canvas" width="768" height="432"></canvas>
            <div class="tk-telemetry-meta">
              <span class="tk-telemetry-tag">${escHtml(sourceSpec.tag || "HABITAT")}</span>
              <span>${escHtml(sourceSpec.footer || "")}</span>
            </div>
          </div>`
        : "";

    panelEl.innerHTML = `
      <div class="tk-head">
        <div>
          <div class="tk-kicker">${
            sourceSpec?.title
              ? `${escHtml(sourceSpec.title)} · ${tr ? "YAŞAM ALANI GÖREV TERMİNALİ · TASKS" : "HABITAT MISSION TERMINAL · TASKS"}`
              : tr
                ? "YAŞAM ALANI GÖREV TERMİNALİ · TASKS"
                : "HABITAT MISSION TERMINAL · TASKS"
          }</div>
          <h2 class="tk-title">${tr ? "Mars Keşif Görevi Planla & Araç/Rota Seç" : "Plan Rover Search Task · Vehicle & Route Selector"}</h2>
        </div>
        <div class="tk-head-actions">
          ${
            isTaskRunning
              ? `<button class="btn tk-abort" type="button" data-tk-act="abort">${tr ? "Aktif Görevi İptal Et" : "Abort Active Task"}</button>`
              : ""
          }
          <button id="hud-task-close" class="btn" type="button" data-tk-act="close">${tr ? "Kapat [Esc / E]" : "Close [Esc / E]"}</button>
        </div>
      </div>${tabsHtml}${telemPaneHtml}

      <div class="tk-cols">
        <div class="tk-left">
          <section class="tk-sec">
            <div class="tk-sec-lbl">${tr ? "1. HEDEF NASA ROVER SEÇ (5)" : "1. SELECT TARGET NASA ROVER (5)"}</div>
            <div class="tk-rover-grid">${roverButtons}</div>
            <div class="tk-target-brief">
              <b>${escHtml(tgt.name)} (${escHtml(tgt.mission)}, ${tgt.year})</b> · ${escHtml(tgt.site)}
              <span>${
                tgt.isHiRiseGaleSite
                  ? tr
                    ? "Bölge arazisi: Gerçek MRO HiRISE Gale Krateri DTM"
                    : "Region relief: Real MRO HiRISE Gale Crater DTM"
                  : tr
                  ? `Bölge arazisi: İniş koordinatına göre deterministik prosedürel rölyef · Gale'den ${regionSum.marsArcKm} km`
                  : `Region relief: Deterministic procedural relief at landing coordinates · ${regionSum.marsArcKm} km from Gale`
              }</span>
            </div>
          </section>

          <section class="tk-sec">
            <div class="tk-sec-lbl">${tr ? "2. GARAJDAN SÜRÜLECEK ARAÇ SEÇ (2)" : "2. SELECT GARAGE DRIVABLE VEHICLE (2)"}</div>
            <div class="tk-veh-grid">${vehicleCards}</div>
          </section>
        </div>

        <div class="tk-right">
          <div class="tk-sec-lbl">${
            tr
              ? `3. ${veh.shortLabel} İÇİN 3 ARAZİ ROTASI (HAB → ${tgt.name.toUpperCase()} · ${currentPlan.staging.distanceM} m)`
              : `3. TOP 3 TERRAIN ROUTES FOR ${veh.shortLabel} (HAB → ${tgt.name.toUpperCase()} · ${currentPlan.staging.distanceM} m)`
          }</div>
          <div class="tk-map-wrap">
            <canvas id="tp-preview-canvas" width="360" height="232"></canvas>
            <div class="tk-map-legend">
              <span><i style="background:#38bdf8;"></i>HAB (${tr ? "Kuzey Hazırlık" : "North Staging"})</span>
              <span><i style="background:${escHtml(tgt.color)};"></i>${escHtml(tgt.name)}</span>
              <span><i style="background:#9a3412;"></i>&gt;15° Slope</span>
            </div>
          </div>
          <div class="tk-routes">${routeCards}</div>
        </div>
      </div>

      <div class="tk-foot">
        <p class="tk-honesty">${
          tr
            ? "Dürüstlük Notu: Eğim limitleri (≤10° yeşil, 10–15° sarı, 15–20° kırmızı, >20° blok) NASA Ay EVA ConOps örnekleridir. Sürüş süresi, kWh ve Curiosity dışındaki 4 bölge kabartması açıklayıcı tahminlerdir. Başlatıldığında Üs hedef bölgeye konuşlanır; görev bitene veya iptal edilene kadar ışınlanma kilitlenir."
            : "Honesty Note: Slope thresholds (≤10° green, 10–15° amber, 15–20° red, >20° blocked) use NASA lunar EVA ConOps stand-ins. Drive ETA, kWh, and relief at non-Curiosity regions are illustrative. Starting deploys Habitat to the target region and locks all teleports until located or aborted."
        }</p>
        <div class="tk-cta">
          <button id="hud-task-start" class="btn primary tk-start-btn" type="button" data-tk-act="start">
            ${tr ? "GÖREVİ BAŞLAT · ROTA VE GARACI KUR ▸" : "DEPLOY & START TASK · SET ROUTE ▸"}
          </button>
        </div>
      </div>
    `;
    if (showTelem) {
      const tcv = panelEl.querySelector("#tk-telemetry-canvas");
      const tctx = tcv?.getContext?.("2d");
      if (tctx && sourceSpec) drawTelemetryScreenOnCtx(tctx, 0, 0, tcv.width, tcv.height, sourceSpec, "#22d3ee");
    } else {
      drawPreviewCanvas();
    }
  }

  function open(spec = null) {
    onReleasePointerLock?.();
    sourceSpec = spec && typeof spec === "object" ? spec : null;
    activeTab = "tasks";
    const active = getActiveTask();
    if (active?.status === "active") {
      selectedRoverId = active.targetRoverId;
      selectedVehicleId = active.vehicleId;
      selectedRouteId = active.selectedRouteId;
    }
    refreshPlan(!active || active.status !== "active");
    renderPanel();
    panelEl.classList.add("open");
  }

  panelEl.addEventListener("click", (ev) => {
    const tabBtn = ev.target.closest?.("[data-tk-tab]");
    if (tabBtn) {
      ev.stopPropagation();
      activeTab = tabBtn.dataset.tkTab === "telemetry" ? "telemetry" : "tasks";
      renderPanel();
      return;
    }
    const rBtn = ev.target.closest?.("[data-tk-rover]");
    if (rBtn) {
      ev.stopPropagation();
      selectedRoverId = rBtn.dataset.tkRover;
      refreshPlan(true);
      renderPanel();
      return;
    }
    const vBtn = ev.target.closest?.("[data-tk-veh]");
    if (vBtn) {
      ev.stopPropagation();
      selectedVehicleId = vBtn.dataset.tkVeh;
      refreshPlan(true);
      renderPanel();
      return;
    }
    const rtBtn = ev.target.closest?.("[data-tk-route]");
    if (rtBtn) {
      ev.stopPropagation();
      selectedRouteId = rtBtn.dataset.tkRoute;
      renderPanel();
      return;
    }
    const act = ev.target.closest?.("[data-tk-act]")?.dataset.tkAct;
    if (!act) return;
    ev.stopPropagation();
    if (act === "close") close();
    else if (act === "abort") {
      close();
      onAbortTask?.();
    } else if (act === "start") {
      if (!currentPlan) refreshPlan(true);
      const picked =
        currentPlan.bundle.routes.find((r) => r.id === selectedRouteId) || currentPlan.bundle.routes[0];
      close();
      onStartTask?.({
        plan: currentPlan,
        selectedRoute: picked,
      });
    }
  });

  function toggleMinimapZoom() {
    minimapZoomed = !minimapZoomed;
    lastMinimapDrawMs = 0;
  }

  function ensureMinimapDom(task, tr) {
    const tgt = getTaskTargetRover(task.targetRoverId);
    const veh = getTaskVehicleProfile(task.vehicleId);
    const rt = task.selectedRoute;
    const key = `${task.id}|${tr ? "tr" : "en"}|${minimapZoomed ? "z" : "o"}`;
    if (livePlanKey !== key) {
      livePlanKey = key;
      liveBackdrop = buildTerrainBackdropBitmap(task.bundle, 228, 174);
      minimapEl.innerHTML = `
        <div class="tkm-head">
          <span class="tkm-title"><b>${tr ? "GÖREV" : "TASK"}:</b> ${escHtml(tgt.name.toUpperCase())}</span>
          <span class="tkm-lock" title="${tr ? "Görev süresince ışınlanma kilitli" : "Teleports locked during task"}">🔒 TELEPORT</span>
        </div>
        <div class="tkm-sub">
          <span style="color:${escHtml(rt.color)};">● ${escHtml(tr ? rt.nameTr : rt.nameEn)}</span>
          <span>${escHtml(veh.shortLabel)}</span>
        </div>
        <canvas id="tkm-canvas" width="228" height="174"></canvas>
        <div class="tkm-stats">
          <div><span>${tr ? "HEDEF" : "TARGET"}</span><b id="tkm-dist">— m</b></div>
          <div><span>${tr ? "ROTA" : "ROUTE"}</span><b id="tkm-prog">0 / ${rt.distanceM} m</b></div>
          <div><span>${tr ? "SAPMA" : "OFF-RT"}</span><b id="tkm-off">0 m</b></div>
        </div>
        <div class="tkm-actions">
          <button class="btn tkm-btn" type="button" data-tkm="zoom">[N] ${
            minimapZoomed ? (tr ? "Genel" : "Overview") : tr ? "Yakın" : "Zoom"
          }</button>
          <button class="btn tkm-btn tkm-abort" type="button" data-tkm="abort">${tr ? "İptal Et" : "Abort"}</button>
        </div>
      `;
    }
  }

  minimapEl.addEventListener("click", (ev) => {
    const act = ev.target.closest?.("[data-tkm]")?.dataset.tkm;
    if (!act) return;
    ev.stopPropagation();
    if (act === "zoom") toggleMinimapZoom();
    else if (act === "abort") onAbortTask?.();
  });

  function updateMinimap(task, progress, playerPose, nowMs) {
    if (!task || task.status !== "active") {
      minimapEl.hidden = true;
      return null;
    }
    minimapEl.hidden = false;
    const tr = isTrLang();
    ensureMinimapDom(task, tr);

    if (nowMs - lastMinimapDrawMs >= 90) {
      lastMinimapDrawMs = nowMs;
      const distEl = minimapEl.querySelector("#tkm-dist");
      const progEl = minimapEl.querySelector("#tkm-prog");
      const offEl = minimapEl.querySelector("#tkm-off");
      if (distEl) distEl.textContent = `${Math.round(progress.directDistM)} m`;
      if (progEl) progEl.textContent = `${Math.round(progress.alongM)} / ${Math.round(progress.totalRouteM)} m`;
      if (offEl) {
        offEl.textContent = `${Math.round(progress.offRouteM)} m`;
        offEl.style.color = progress.offRouteM > 45 ? "#fbbf24" : "#86efac";
      }
      const cvs = minimapEl.querySelector("#tkm-canvas");
      const tgt = getTaskTargetRover(task.targetRoverId);
      renderTaskTerrainCanvas(cvs, {
        bundle: task.bundle,
        backdropCanvas: liveBackdrop,
        selectedRouteId: task.selectedRouteId,
        habX: task.habX,
        habZ: task.habZ,
        targetX: task.targetX,
        targetZ: task.targetZ,
        targetRover: tgt,
        player: playerPose,
        zoomedFollow: minimapZoomed,
      });
    }
  }

  function showDebrief(summary) {
    onReleasePointerLock?.();
    const tr = isTrLang();
    const tgt = getTaskTargetRover(summary.targetRoverId);
    const veh = getTaskVehicleProfile(summary.vehicleId);
    const rt = summary.selectedRoute;
    debriefEl.innerHTML = `
      <div class="tkd-card">
        <div class="tkd-kicker">${tr ? "HEDEF ROVER BULUNDU · GÖREV TAMAMLANDI" : "TARGET ROVER LOCATED · TASK COMPLETE"}</div>
        <h2 class="tkd-title">${escHtml(tgt.name)} (${escHtml(tgt.mission)}, ${tgt.year})</h2>
        <p class="tkd-site">${escHtml(tgt.site)} · ${escHtml(tgt.siteShortName)}</p>
        <dl class="tkd-dl">
          <dt>${tr ? "Kullanılan Araç" : "Driven Vehicle"}</dt><dd>${escHtml(tr ? veh.nameTr : veh.nameEn)}</dd>
          <dt>${tr ? "Seçilen Rota" : "Selected Route"}</dt><dd>${escHtml(tr ? rt.nameTr : rt.nameEn)} (${rt.suitabilityPct}%)</dd>
          <dt>${tr ? "Gerçek Süre / Yol" : "Elapsed Time / Travel"}</dt><dd>${fmtDuration(summary.elapsedSec, tr)} · ${Math.round(summary.travelledM)} m</dd>
          <dt>${tr ? "Karşılaşılan Max Eğim" : "Peak Encountered Slope"}</dt><dd>${summary.peakSlopeDeg.toFixed(1)}°</dd>
        </dl>
        <p class="tkd-honesty">${
          tgt.isHiRiseGaleSite
            ? tr
              ? "Arazi: Gerçek MRO HiRISE DTM. Işınlanma kilidi açıldı."
              : "Terrain: Real MRO HiRISE DTM. All teleports unlocked."
            : tr
            ? "Arazi: Prosedürel kabartma. Görev tamamlandığı için Orbit ve saha ışınlanması yeniden açıldı."
            : "Terrain: Procedural relief. Orbit and site teleports are now unlocked."
        }</p>
        <div class="tkd-actions">
          <button class="btn primary" type="button" data-tkd="keep">${tr ? "Bölgede Kal (Serbest Keşif)" : "Keep Exploring Region"}</button>
          <button class="btn" type="button" data-tkd="corridor">${tr ? "Üs Koridoruna Dön" : "Return to Habitat Corridor"}</button>
        </div>
      </div>
    `;
    debriefEl.classList.add("open");
  }

  debriefEl.addEventListener("click", (ev) => {
    const act = ev.target.closest?.("[data-tkd]")?.dataset.tkd;
    if (!act) return;
    ev.stopPropagation();
    closeDebrief();
    if (act === "corridor") onReturnToCorridor?.();
  });

  function handleKeyDown(e) {
    const k = e.key.toLowerCase();
    if (isOpen()) {
      e.preventDefault();
      if (e.key === "Escape" || k === "e") close();
      if (e.key === "Escape") e.stopImmediatePropagation?.();
      return true;
    }
    if (isDebriefOpen()) {
      e.preventDefault();
      if (e.key === "Escape" || k === "e") closeDebrief();
      if (e.key === "Escape") e.stopImmediatePropagation?.();
      return true;
    }
    return false;
  }

  return {
    open,
    close,
    closeDebrief,
    isOpen,
    isDebriefOpen,
    toggleMinimapZoom,
    updateMinimap,
    showDebrief,
    handleKeyDown,
    computeProgressForTask: computeTaskProgress,
  };
}
