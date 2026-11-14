/**
 * Pressurized Experimental Mars Rover (`experimental-rover.js`).
 *
 * Uses NASA 3D Resources' official Multi-Mission Space Exploration Vehicle
 * (`web/assets/nasa-3d/mmsev-rover.glb`, Draco-compressed GLB) cleanly oriented
 * cockpit-forward (`-Z`), with baked static mesh wheels swapped for 6 articulated,
 * steering, rolling, terrain-conforming NASA spring-mesh dual-wheel pods.
 *
 * Features solid Oriented Rounded-Box (OBB) collision, 4-point + per-pod Martian
 * DEM slope conformance, spring-damper suspension physics, weight transfer, and LED
 * head/taillights. Keeps the procedural 6-wheel chevron rover as offline fallback.
 */

export const MARS_GRAVITY_MS2 = 3.71;
export const ROVER_FLIGHT_G = 9.4;
export const ROVER_COLLISION_RADIUS_M = 2.45;
export const ROVER_WHEEL_RADIUS_M = 0.345;
export const ROVER_OBB_HALF_W = 1.66;
export const ROVER_OBB_HALF_L = 2.42;
export const ROVER_OBB_HEIGHT_M = 3.25;

// Exact scaled axle layout matching NASA `mmsev-rover.glb` bogie spindles after
// cockpit-forward (`Math.PI`) alignment (`x = ±1.339 m`, `z = [-0.969, +0.370, +1.708]`).
const MMSEV_POD_AXLES = [
  { z: -0.969, role: "front" },
  { z: 0.37, role: "mid" },
  { z: 1.708, role: "rear" },
];
const MMSEV_TRACK_HALF_W = 1.339;
const MMSEV_POD_DROP_OFFSET_Y = 0.055;

/**
 * Computes a world-space spawn position beside a walker at `(x, z)` facing `yaw`
 * (`yaw = 0` looks along `-Z`, matching Three.js camera & `hud3d.js`).
 */
export function computeSpawnBesideOffset(x, z, yaw = 0, rightM = 3.8, fwdM = 2.8) {
  const sinY = Math.sin(yaw);
  const cosY = Math.cos(yaw);
  return {
    x: x + cosY * rightM - sinY * fwdM,
    z: z - sinY * rightM - cosY * fwdM,
  };
}

/**
 * Pure vertical ballistic & crest-launch stepper for Mars heavy-chassis vehicle flight.
 * Absorbs normal terrain ripples on bogie travel and launches cleanly only on real fast crests
 * or abrupt maneuvers, returning crisply under heavy chassis gravity (`ROVER_FLIGHT_G`) with zero floaty hang.
 */
export function stepRoverBallisticPhysics(
  state,
  { groundY, slopeClimbVy = 0, bumpImpulseVy = 0, horizSpeed = 0, dt = 0.016, marsG = ROVER_FLIGHT_G }
) {
  const s = state;
  const safeDt = Math.max(0.001, Math.min(0.05, dt));
  if (s.posY == null || !Number.isFinite(s.posY) || Math.abs(groundY - (s.prevGroundY ?? groundY)) > 6.0) {
    s.posY = groundY;
    s.velY = 0;
    s.prevGroundY = groundY;
    s.airborne = false;
    s.airTime = 0;
    s.peakLaunchVy = 0;
    s.landingCooldown = 0;
    return { launched: false, landed: false, impactSpeed: 0 };
  }

  const groundRiseRate = Math.max(-8, Math.min(10, (groundY - s.prevGroundY) / safeDt));
  s.prevGroundY = groundY;
  s.landingCooldown = Math.max(0, (s.landingCooldown || 0) - safeDt);

  if (!s.airborne) {
    if (s.landingCooldown > 0) {
      s.posY = groundY;
      s.velY = 0;
      s.peakLaunchVy = 0;
      s.airTime = 0;
      return { launched: false, landed: false, impactSpeed: 0 };
    }
    const rawClimb = Math.max(groundRiseRate * 0.48 + slopeClimbVy * 0.45, slopeClimbVy * 0.78) + bumpImpulseVy;
    // Bogie suspension absorbs minor upward velocity (< 0.55 m/s) before chassis frame separates
    const effectiveClimb = Math.max(-4, Math.min(3.8, rawClimb - 0.55));
    s.peakLaunchVy = Math.max((s.peakLaunchVy || 0) * Math.exp(-safeDt * 8.5), effectiveClimb);

    const ballisticY = s.posY + s.peakLaunchVy * safeDt - 0.5 * marsG * safeDt * safeDt;
    const clearance = ballisticY - groundY;
    const shouldLaunch =
      (clearance > 0.065 && s.peakLaunchVy > 1.85 && horizSpeed > 8.8) || bumpImpulseVy > 2.1;

    if (shouldLaunch) {
      s.airborne = true;
      s.velY = Math.min(3.8, Math.max(s.peakLaunchVy, bumpImpulseVy > 2.1 ? bumpImpulseVy : 1.9));
      s.posY = Math.max(s.posY, groundY) + s.velY * safeDt;
      s.airTime = 0;
      s.peakLaunchVy = 0;
      return { launched: true, landed: false, impactSpeed: 0 };
    }

    s.posY = groundY;
    s.velY = Math.min(0, effectiveClimb);
    s.airTime = 0;
    return { launched: false, landed: false, impactSpeed: 0 };
  }

  s.airTime = (s.airTime || 0) + safeDt;
  s.velY -= marsG * safeDt;
  s.posY += s.velY * safeDt;

  if (s.posY <= groundY + 0.01 && (s.airTime > 0.05 || s.velY <= 0)) {
    const impactSpeed = Math.max(0, groundRiseRate - s.velY);
    s.posY = groundY;
    s.velY = 0;
    s.airborne = false;
    s.airTime = 0;
    s.peakLaunchVy = 0;
    s.landingCooldown = 0.28;
    return { launched: false, landed: true, impactSpeed };
  }

  return { launched: false, landed: false, impactSpeed: 0 };
}

/**
 * Pure 2D Oriented Rounded-Box (OBB) push-out collider so both the hull,
 * cantilevered cockpit nose, rear bulkhead, and all 6 protruding dual-wheel pods
 * are completely solid from any approach angle or jump height below roof clearance.
 */
export function resolveRoverObbCollision(
  roverX,
  roverZ,
  roverYaw,
  roverY,
  entityX,
  entityZ,
  entityRadius = 0.42,
  entityY = null,
  halfW = ROVER_OBB_HALF_W,
  halfL = ROVER_OBB_HALF_L,
  roofHeight = ROVER_OBB_HEIGHT_M
) {
  if (entityY != null && roverY != null) {
    if (entityY > roverY + roofHeight || entityY + 1.85 < roverY - 0.35) {
      return { hit: false, x: entityX, z: entityZ, nx: 0, nz: 0, pen: 0 };
    }
  }

  const dx = entityX - roverX;
  const dz = entityZ - roverZ;
  // Local frame where `right = (cosY, -sinY)` and `back (+Z_local) = (sinY, cosY)`.
  const cosY = Math.cos(roverYaw);
  const sinY = Math.sin(roverYaw);
  const lx = dx * cosY - dz * sinY;
  const lz = dx * sinY + dz * cosY;

  const clampedX = Math.max(-halfW, Math.min(halfW, lx));
  const clampedZ = Math.max(-halfL, Math.min(halfL, lz));
  let ux = lx - clampedX;
  let uz = lz - clampedZ;
  const distSq = ux * ux + uz * uz;

  let outLx = lx;
  let outLz = lz;
  let normLx = 0;
  let normLz = 0;
  let pen = 0;

  if (distSq > 1e-8) {
    const dist = Math.sqrt(distSq);
    if (dist >= entityRadius) {
      return { hit: false, x: entityX, z: entityZ, nx: 0, nz: 0, pen: 0 };
    }
    pen = entityRadius - dist;
    normLx = ux / dist;
    normLz = uz / dist;
    outLx = clampedX + normLx * entityRadius;
    outLz = clampedZ + normLz * entityRadius;
  } else {
    // Inside solid box core: eject along shortest face normal
    const penLeft = halfW + lx;
    const penRight = halfW - lx;
    const penFront = halfL + lz;
    const penBack = halfL - lz;
    const minFace = Math.min(penLeft, penRight, penFront, penBack);
    pen = minFace + entityRadius;
    if (minFace === penLeft) {
      normLx = -1;
      outLx = -halfW - entityRadius;
    } else if (minFace === penRight) {
      normLx = 1;
      outLx = halfW + entityRadius;
    } else if (minFace === penFront) {
      normLz = -1;
      outLz = -halfL - entityRadius;
    } else {
      normLz = 1;
      outLz = halfL + entityRadius;
    }
  }

  // Transform back into world space: inverse of local projection
  const nx = normLx * cosY + normLz * sinY;
  const nz = -normLx * sinY + normLz * cosY;
  return {
    hit: true,
    x: roverX + outLx * cosY + outLz * sinY,
    z: roverZ - outLx * sinY + outLz * cosY,
    nx,
    nz,
    pen,
  };
}

function makeSolarTexture(THREE) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#102344";
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "#3668a8";
  g.lineWidth = 2;
  for (let i = 0; i <= 128; i += 16) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 128);
    g.stroke();
  }
  g.strokeStyle = "#b89b52";
  g.lineWidth = 1.5;
  for (let j = 0; j <= 128; j += 32) {
    g.beginPath();
    g.moveTo(0, j);
    g.lineTo(128, j);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeDoorDecalTexture(THREE) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 96;
  const g = c.getContext("2d");
  g.fillStyle = "#eceae4";
  g.fillRect(0, 0, 256, 96);
  g.fillStyle = "#d95b26";
  g.fillRect(0, 0, 256, 16);
  g.fillStyle = "#1b2432";
  g.fillRect(0, 78, 256, 18);
  g.fillStyle = "#111827";
  g.font = "bold 24px ui-monospace, SFMono-Regular, Menlo, monospace";
  g.fillText("MM-EXP 01", 16, 46);
  g.font = "600 13px ui-monospace, SFMono-Regular, Menlo, monospace";
  g.fillStyle = "#475569";
  g.fillText("GALE CRATER // PRESSURIZED", 16, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Generates a high-contrast NASA Glenn / JPL flexible titanium spring-mesh tire tread
 * texture with interwoven chevron wires and warm Gale hematite regolith dusting.
 */
function makeMarsSpringTireTexture(THREE) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");

  g.fillStyle = "#1d1f23";
  g.fillRect(0, 0, 256, 256);

  // Subtle woven nitinol wire-mesh diamond lattice
  g.strokeStyle = "#494d54";
  g.lineWidth = 2;
  for (let i = -256; i < 512; i += 14) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 128, 256);
    g.stroke();
    g.beginPath();
    g.moveTo(i + 128, 0);
    g.lineTo(i, 256);
    g.stroke();
  }

  // Deep herringbone traction cleats along circumference (V = around tire)
  for (let y = 0; y < 256; y += 22) {
    g.fillStyle = "#2b2f36";
    g.beginPath();
    g.moveTo(14, y);
    g.lineTo(128, y + 10);
    g.lineTo(242, y);
    g.lineTo(242, y + 7);
    g.lineTo(128, y + 17);
    g.lineTo(14, y + 7);
    g.closePath();
    g.fill();

    // Subtle Martian regolith dust nestled in cleat troughs
    g.fillStyle = "rgba(156, 86, 52, 0.42)";
    g.fillRect(24, y + 14, 208, 4);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 3);
  return tex;
}

/**
 * Strips baked static frozen wheel triangles from NASA's merged `MMSEV` mesh cleanly
 * below the spindle yoke (`|sx| > 1.065 && sy < 0.618`) in pre-flip scaled space.
 */
function stripStaticWheelTriangles(THREE, model) {
  model.updateMatrixWorld(true);
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();

  model.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
    const srcGeom = obj.geometry;
    const pos = srcGeom.attributes.position;
    const mat = obj.matrixWorld;
    const index = srcGeom.index;

    const isWheelTri = (ia, ib, ic) => {
      v0.fromBufferAttribute(pos, ia).applyMatrix4(mat);
      v1.fromBufferAttribute(pos, ib).applyMatrix4(mat);
      v2.fromBufferAttribute(pos, ic).applyMatrix4(mat);
      const cx = (v0.x + v1.x + v2.x) / 3;
      const cy = (v0.y + v1.y + v2.y) / 3;
      // Wheel pods live completely outside chassis (`|x| > 1.065 m`) and below spindle collar (`y < 0.618 m`)
      return Math.abs(cx) > 1.065 && cy < 0.618;
    };

    if (index) {
      const srcArr = index.array;
      const kept = [];
      for (let i = 0; i < srcArr.length; i += 3) {
        if (!isWheelTri(srcArr[i], srcArr[i + 1], srcArr[i + 2])) {
          kept.push(srcArr[i], srcArr[i + 1], srcArr[i + 2]);
        }
      }
      if (kept.length < srcArr.length) {
        const TypedArr = srcArr.constructor === Uint32Array ? Uint32Array : Uint16Array;
        srcGeom.setIndex(new THREE.BufferAttribute(new TypedArr(kept), 1));
      }
    }
  });
}

/**
 * Builds 6 high-detail articulated NASA JPL/Glenn spring-mesh dual-wheel pods
 * aligned to exact MMSEV bogie hubs (`front`, `mid`, `rear`, left & right).
 */
function buildArticulatedDualWheelPods(THREE, axleLayout, trackHalfW, radius, podCenterY) {
  const wheelGroup = new THREE.Group();
  const tireTex = makeMarsSpringTireTexture(THREE);

  const tireMat = new THREE.MeshStandardMaterial({
    map: tireTex,
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0.34,
  });
  const sidewallMat = new THREE.MeshStandardMaterial({
    color: 0x20242b,
    roughness: 0.68,
    metalness: 0.42,
  });
  const beadlockMat = new THREE.MeshStandardMaterial({
    color: 0x6f7782,
    roughness: 0.36,
    metalness: 0.8,
  });
  const bronzeHubMat = new THREE.MeshStandardMaterial({
    color: 0xb98a4a,
    roughness: 0.34,
    metalness: 0.78,
  });
  const strutDarkMat = new THREE.MeshStandardMaterial({
    color: 0x2c3038,
    roughness: 0.55,
    metalness: 0.7,
  });

  const tireW = 0.175;
  const dualHalfSpread = 0.145; // 2 wheels per pod spanning `±0.232m`, matching NASA `[1.09..1.59]` pod footprint
  const tireGeom = new THREE.CylinderGeometry(radius, radius, tireW, 24, 1, false);
  tireGeom.rotateZ(Math.PI / 2);

  const rimGeom = new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, tireW + 0.012, 16);
  rimGeom.rotateZ(Math.PI / 2);

  const hubGeom = new THREE.CylinderGeometry(radius * 0.28, radius * 0.31, tireW + 0.03, 12);
  hubGeom.rotateZ(Math.PI / 2);

  const cleatGeom = new THREE.BoxGeometry(tireW * 0.94, 0.022, 0.055);
  const axleShaftGeom = new THREE.CylinderGeometry(0.068, 0.068, dualHalfSpread * 2 + 0.08, 12);
  axleShaftGeom.rotateZ(Math.PI / 2);
  const yokeCollarGeom = new THREE.CylinderGeometry(0.085, 0.085, 0.24, 12);

  const wheels = [];
  const frontSteerKnuckles = [];
  const rearSteerKnuckles = [];
  const pods = [];

  for (const ax of axleLayout) {
    for (const side of [-1, 1]) {
      const podRoot = new THREE.Group();
      podRoot.position.set(side * trackHalfW, podCenterY, ax.z);
      wheelGroup.add(podRoot);

      // Steering knuckle + vertical yoke sleeve joining onto NASA's overhead bogie strut
      const knuckle = new THREE.Group();
      podRoot.add(knuckle);

      const collar = new THREE.Mesh(yokeCollarGeom, strutDarkMat);
      collar.position.set(0, radius * 0.72, 0);
      collar.castShadow = true;
      collar.receiveShadow = true;
      knuckle.add(collar);

      const axleBar = new THREE.Mesh(axleShaftGeom, strutDarkMat);
      axleBar.castShadow = true;
      knuckle.add(axleBar);

      const spinner = new THREE.Group();
      knuckle.add(spinner);

      for (const dualOff of [-dualHalfSpread, dualHalfSpread]) {
        const tire = new THREE.Mesh(tireGeom, tireMat);
        tire.position.x = dualOff;
        tire.castShadow = true;
        tire.receiveShadow = true;
        spinner.add(tire);

        const rim = new THREE.Mesh(rimGeom, beadlockMat);
        rim.position.x = dualOff;
        rim.castShadow = true;
        spinner.add(rim);

        const hub = new THREE.Mesh(hubGeom, bronzeHubMat);
        hub.position.x = dualOff;
        spinner.add(hub);

        // Inner dark beadlock ring + 10 perimeter titanium traction cleats per wheel
        for (let c = 0; c < 10; c++) {
          const ang = (c / 10) * Math.PI * 2;
          const cleat = new THREE.Mesh(cleatGeom, sidewallMat);
          cleat.position.set(dualOff, Math.sin(ang) * (radius - 0.004), Math.cos(ang) * (radius - 0.004));
          cleat.rotation.x = ang;
          cleat.castShadow = true;
          spinner.add(cleat);
        }
      }

      wheels.push(spinner);
      pods.push({
        podRoot,
        knuckle,
        spinner,
        lx: side * trackHalfW,
        lz: ax.z,
        baseY: podCenterY,
        role: ax.role,
      });
      if (ax.role === "front") frontSteerKnuckles.push(knuckle);
      else if (ax.role === "rear") rearSteerKnuckles.push(knuckle);
    }
  }

  return { wheelGroup, wheels, frontSteerKnuckles, rearSteerKnuckles, pods };
}

function buildProceduralRoverVisuals(THREE) {
  const procGroup = new THREE.Group();

  const frameMat = new THREE.MeshStandardMaterial({ color: 0x262b33, roughness: 0.72, metalness: 0.65 });
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xe6e2da, roughness: 0.44, metalness: 0.08 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xd95b26, roughness: 0.48, metalness: 0.1 });
  const foilMat = new THREE.MeshStandardMaterial({ color: 0xd4a42a, roughness: 0.28, metalness: 0.88 });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0xc27b2b,
    roughness: 0.14,
    metalness: 0.62,
    emissive: 0x2a1404,
    emissiveIntensity: 0.35,
  });
  const tireMat = new THREE.MeshStandardMaterial({
    map: makeMarsSpringTireTexture(THREE),
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.24,
  });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.78 });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xff3b2f,
    emissive: 0xdc2626,
    emissiveIntensity: 1.5,
    roughness: 0.25,
  });
  const solarMat = new THREE.MeshStandardMaterial({
    map: makeSolarTexture(THREE),
    color: 0xffffff,
    roughness: 0.28,
    metalness: 0.35,
  });
  const decalMat = new THREE.MeshStandardMaterial({
    map: makeDoorDecalTexture(THREE),
    roughness: 0.46,
    metalness: 0.05,
  });

  const addShadowMesh = (parent, geom, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    if (rx || ry || rz) m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  addShadowMesh(procGroup, new THREE.BoxGeometry(1.75, 0.22, 3.6), frameMat, 0, 0.56, 0);
  addShadowMesh(procGroup, new THREE.BoxGeometry(1.5, 0.18, 1.45), foilMat, 0, 0.52, 0.95);
  for (const sx of [-0.92, 0.92]) {
    addShadowMesh(procGroup, new THREE.BoxGeometry(0.14, 0.12, 3.2), frameMat, sx, 0.52, 0);
  }
  addShadowMesh(procGroup, new THREE.BoxGeometry(2.04, 1.18, 2.75), hullMat, 0, 1.24, 0.18);
  addShadowMesh(procGroup, new THREE.BoxGeometry(1.94, 0.62, 1.05), hullMat, 0, 0.98, -1.42, 0.24, 0, 0);
  addShadowMesh(procGroup, new THREE.BoxGeometry(2.06, 0.1, 2.82), accentMat, 0, 0.72, 0.18);

  const doorGeom = new THREE.PlaneGeometry(1.32, 0.5);
  const portDecal = addShadowMesh(procGroup, doorGeom, decalMat, -1.03, 1.28, -0.05, 0, -Math.PI / 2, 0);
  portDecal.castShadow = false;
  const stbdDecal = addShadowMesh(procGroup, doorGeom, decalMat, 1.03, 1.28, -0.05, 0, Math.PI / 2, 0);
  stbdDecal.castShadow = false;

  addShadowMesh(procGroup, new THREE.BoxGeometry(1.76, 0.54, 0.28), visorMat, 0, 1.45, -1.24, -0.38, 0, 0);
  addShadowMesh(procGroup, new THREE.BoxGeometry(0.12, 0.36, 0.95), visorMat, -1.0, 1.48, -0.68);
  addShadowMesh(procGroup, new THREE.BoxGeometry(0.12, 0.36, 0.95), visorMat, 1.0, 1.48, -0.68);

  addShadowMesh(procGroup, new THREE.CylinderGeometry(0.55, 0.62, 0.2, 16), hullMat, 0, 1.9, -0.3);
  addShadowMesh(procGroup, new THREE.CylinderGeometry(0.62, 0.68, 0.95, 14), foilMat, 0, 1.28, 1.62, Math.PI / 2, 0, 0);
  addShadowMesh(procGroup, new THREE.CylinderGeometry(0.5, 0.5, 0.16, 14), frameMat, 0, 1.28, 2.08, Math.PI / 2, 0, 0);

  addShadowMesh(procGroup, new THREE.BoxGeometry(1.98, 0.16, 0.24), frameMat, 0, 0.72, -1.94);
  for (const lx of [-0.68, 0.68]) {
    addShadowMesh(procGroup, new THREE.BoxGeometry(0.18, 0.09, 0.08), tailMat, lx, 0.92, 1.82);
  }
  for (const sx of [-0.72, 0.72]) {
    addShadowMesh(procGroup, new THREE.BoxGeometry(0.95, 0.05, 1.95), solarMat, sx, 1.95, 0.68, 0.05, 0, sx < 0 ? 0.1 : -0.1);
  }

  const mastBase = new THREE.Group();
  mastBase.position.set(-0.62, 1.88, -0.72);
  procGroup.add(mastBase);
  addShadowMesh(mastBase, new THREE.CylinderGeometry(0.045, 0.055, 0.62, 10), frameMat, 0, 0.31, 0);
  const mastHead = new THREE.Group();
  mastHead.position.set(0, 0.64, 0);
  mastBase.add(mastHead);
  addShadowMesh(mastHead, new THREE.BoxGeometry(0.32, 0.14, 0.2), hullMat, 0, 0, 0);
  for (const ex of [-0.08, 0.08]) {
    addShadowMesh(mastHead, new THREE.CylinderGeometry(0.036, 0.036, 0.08, 10), frameMat, ex, 0, -0.1, Math.PI / 2, 0, 0);
  }

  const dishGroup = new THREE.Group();
  dishGroup.position.set(0.65, 2.02, 1.25);
  procGroup.add(dishGroup);
  addShadowMesh(dishGroup, new THREE.CylinderGeometry(0.035, 0.035, 0.35, 8), frameMat, 0, 0.16, 0);
  addShadowMesh(dishGroup, new THREE.ConeGeometry(0.32, 0.12, 14, 1, true), hullMat, 0, 0.38, 0, Math.PI * 0.72, 0, 0);

  const procWheelR = 0.46;
  const wheelGeom = new THREE.CylinderGeometry(procWheelR, procWheelR, 0.38, 20);
  wheelGeom.rotateZ(Math.PI / 2);
  const rimGeom = new THREE.CylinderGeometry(0.24, 0.24, 0.4, 12);
  rimGeom.rotateZ(Math.PI / 2);
  const cleatGeom = new THREE.BoxGeometry(0.4, 0.04, 0.07);

  const wheels = [];
  const frontSteerKnuckles = [];
  const rearSteerKnuckles = [];
  for (const wz of [-1.42, 0.0, 1.42]) {
    for (const side of [-1, 1]) {
      const knuckle = new THREE.Group();
      knuckle.position.set(side * 1.28, procWheelR, wz);
      procGroup.add(knuckle);

      addShadowMesh(
        procGroup,
        new THREE.CylinderGeometry(0.045, 0.045, 0.56, 8),
        frameMat,
        side * 1.0,
        0.58,
        wz,
        0,
        0,
        side * 1.15
      );

      const spinner = new THREE.Group();
      knuckle.add(spinner);
      addShadowMesh(spinner, wheelGeom, tireMat);
      addShadowMesh(spinner, rimGeom, hubMat);
      for (let c = 0; c < 8; c++) {
        const ang = (c / 8) * Math.PI * 2;
        const cleat = new THREE.Mesh(cleatGeom, frameMat);
        cleat.position.set(0, Math.sin(ang) * procWheelR, Math.cos(ang) * procWheelR);
        cleat.rotation.x = ang;
        cleat.castShadow = true;
        spinner.add(cleat);
      }

      wheels.push(spinner);
      if (wz < -0.5) frontSteerKnuckles.push(knuckle);
      else if (wz > 0.5) rearSteerKnuckles.push(knuckle);
    }
  }

  return { procGroup, wheels, frontSteerKnuckles, rearSteerKnuckles, mastHead, dishGroup };
}

export function createExperimentalRover(THREE) {
  const group = new THREE.Group();
  const bodyRoot = new THREE.Group();
  group.add(bodyRoot);

  const fallback = buildProceduralRoverVisuals(THREE);
  bodyRoot.add(fallback.procGroup);

  // Articulated 6x6 Mars Dual-Wheel assembly attached once NASA GLB loads
  const mmsevWheels = buildArticulatedDualWheelPods(
    THREE,
    MMSEV_POD_AXLES,
    MMSEV_TRACK_HALF_W,
    ROVER_WHEEL_RADIUS_M,
    ROVER_WHEEL_RADIUS_M
  );
  mmsevWheels.wheelGroup.visible = false;
  bodyRoot.add(mmsevWheels.wheelGroup);

  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xfff3d6,
    emissive: 0xffe4b5,
    emissiveIntensity: 2.3,
    roughness: 0.2,
  });
  const lamps = [];
  for (const lx of [-0.58, 0.58]) {
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 12), lampMat);
    lamp.position.set(lx, 0.9, -2.02);
    lamp.rotation.x = Math.PI / 2;
    bodyRoot.add(lamp);
    lamps.push(lamp);
  }
  const headlight = new THREE.PointLight(0xffdfb3, 2.0, 24, 1.5);
  headlight.position.set(0, 1.15, -2.6);
  bodyRoot.add(headlight);

  const highBeam = new THREE.SpotLight(0xffe7c2, 5.2, 46, 0.56, 0.65, 1.35);
  highBeam.position.set(0, 1.18, -2.18);
  highBeam.target.position.set(0, 0.12, -18);
  bodyRoot.add(highBeam);
  bodyRoot.add(highBeam.target);

  // Subtle rear amber-red brake/marker tailbars flush against aft airlock ring (`+Z` rear)
  const tailBarMat = new THREE.MeshStandardMaterial({
    color: 0xff4938,
    emissive: 0xef4444,
    emissiveIntensity: 1.75,
    roughness: 0.25,
  });
  const tailBars = [];
  for (const lx of [-0.66, 0.66]) {
    const tb = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.055, 0.045), tailBarMat);
    tb.position.set(lx, 1.08, 2.02);
    tb.visible = false;
    bodyRoot.add(tb);
    tailBars.push(tb);
  }

  let nasaModelRoot = null;
  let hasRealModel = false;

  async function attachRealModel(loader, url = "./assets/nasa-3d/mmsev-rover.glb") {
    if (!loader || hasRealModel) return false;
    try {
      const gltf = await loader.loadAsync(url);
      const model = gltf.scene;
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      const maxSpan = Math.max(size.x, size.z, 0.01);
      const scale = 4.65 / maxSpan;
      // Lift body slightly (`+0.055m`) so articulated dual tires & cleats sit atop `y = 0` without soil clipping
      model.position.set(-center.x * scale, -box.min.y * scale + MMSEV_POD_DROP_OFFSET_Y, -center.z * scale);
      model.scale.setScalar(scale);

      // Remove NASA GLB's frozen pale wireframe wheels cleanly while keeping cabin, trusses & forks intact
      stripStaticWheelTriangles(THREE, model);

      // Native GLB `+Z` holds the cantilevered 4-pane cockpit nose; rotate `Math.PI` so nose aims strictly `-Z` forward
      const wrapper = new THREE.Group();
      wrapper.rotation.y = Math.PI;
      wrapper.add(model);

      wrapper.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.material) {
          o.material.envMapIntensity = 0.85;
          if (o.material.normalMap && o.material.normalScale) {
            o.material.normalScale.set(0.8, 0.8);
          }
          o.material.needsUpdate = true;
        }
      });

      fallback.procGroup.visible = false;
      mmsevWheels.wheelGroup.visible = true;
      for (const tb of tailBars) tb.visible = true;
      bodyRoot.add(wrapper);
      nasaModelRoot = wrapper;
      hasRealModel = true;
      return true;
    } catch (err) {
      console.warn("NASA MMSEV rover model failed, keeping procedural fallback:", err);
      return false;
    }
  }

  let wheelAngle = 0;
  let smoothPitch = 0;
  let smoothRoll = 0;
  let smoothGroundY = null;
  let prevGroundY = null;
  let suspY = 0;
  let suspVelY = 0;
  let prevSpeed = 0;
  let accelSquat = 0;
  let cornerRoll = 0;

  function spawnBeside(x, z, yaw, sampleElevY) {
    const pos = computeSpawnBesideOffset(x, z, yaw, 3.8, 2.8);
    const y = sampleElevY(pos.x, pos.z);
    group.position.set(pos.x, y, pos.z);
    group.rotation.y = yaw;
    smoothGroundY = y;
    prevGroundY = y;
    suspY = 0;
    suspVelY = 0;
    accelSquat = 0;
    cornerRoll = 0;
    smoothPitch = 0;
    smoothRoll = 0;
    bodyRoot.position.set(0, 0, 0);
    bodyRoot.rotation.set(0, 0, 0);
    return group.position;
  }

  function resolveCollision(entityX, entityZ, entityRadius = 0.42, entityY = null) {
    if (!group.visible) return { hit: false, x: entityX, z: entityZ, nx: 0, nz: 0, pen: 0 };
    return resolveRoverObbCollision(
      group.position.x,
      group.position.z,
      group.rotation.y,
      group.position.y,
      entityX,
      entityZ,
      entityRadius,
      entityY,
      ROVER_OBB_HALF_W,
      ROVER_OBB_HALF_L,
      ROVER_OBB_HEIGHT_M
    );
  }

  function sampleSupportGroundY(sampleElevY, x = group.position.x, z = group.position.z, yaw = group.rotation.y) {
    if (!sampleElevY) return 0;
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    const halfW = 1.34;
    const frontZ = hasRealModel ? -0.97 : -1.0;
    const midZ = hasRealModel ? 0.37 : 0.0;
    const rearZ = hasRealModel ? 1.7 : 1.3;
    const pt = (lx, lz) => sampleElevY(x + cosY * lx + sinY * lz, z - sinY * lx + cosY * lz);
    const hFL = pt(-halfW, frontZ);
    const hFR = pt(halfW, frontZ);
    const hML = pt(-halfW, midZ);
    const hMR = pt(halfW, midZ);
    const hRL = pt(-halfW, rearZ);
    const hRR = pt(halfW, rearZ);
    const hC = sampleElevY(x, z);
    const wheelAvg = (hFL + hFR + hML + hMR + hRL + hRR) / 6;
    const peakH = Math.max(hC, hFL, hFR, hML, hMR, hRL, hRR);
    return Math.max(wheelAvg + 0.04, peakH - 0.04);
  }

  function update(
    dt,
    {
      sampleElevY,
      speed = 0,
      steer = 0,
      clockT = 0,
      driving = false,
      physicsEnabled = true,
      airborne = false,
      worldY = null,
      velY = 0,
      lateralSpeed = 0,
      landingImpact = 0,
    } = {}
  ) {
    if (!group.visible || !sampleElevY) return;

    const px = group.position.x;
    const pz = group.position.z;
    const yaw = group.rotation.y;
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);

    const halfW = 1.34;
    const frontZ = hasRealModel ? -0.97 : -1.0;
    const midZ = hasRealModel ? 0.37 : 0.0;
    const rearZ = hasRealModel ? 1.7 : 1.3;
    const samplePt = (lx, lz) => sampleElevY(px + cosY * lx + sinY * lz, pz - sinY * lx + cosY * lz);
    const hFL = samplePt(-halfW, frontZ);
    const hFR = samplePt(halfW, frontZ);
    const hML = samplePt(-halfW, midZ);
    const hMR = samplePt(halfW, midZ);
    const hRL = samplePt(-halfW, rearZ);
    const hRR = samplePt(halfW, rearZ);
    const hC = sampleElevY(px, pz);
    const wheelAvg = (hFL + hFR + hML + hMR + hRL + hRR) / 6;
    const peakH = Math.max(hC, hFL, hFR, hML, hMR, hRL, hRR);
    // Keep chassis riding atop high terrain contact so bumpy craters never swallow tires
    const groundTargetY = Math.max(wheelAvg + 0.04, peakH - 0.04);
    const targetY = airborne && Number.isFinite(worldY) ? worldY : groundTargetY;

    if (smoothGroundY == null || !Number.isFinite(smoothGroundY)) {
      smoothGroundY = targetY;
      prevGroundY = targetY;
    }

    if (landingImpact > 0.3) {
      suspVelY -= Math.min(4.2, landingImpact * 1.35);
      accelSquat = Math.min(0.11, accelSquat + landingImpact * 0.024);
    }

    if (physicsEnabled && dt > 0) {
      if (airborne) {
        // Mid-air ballistic chassis float + slow spring droop toward full rebound extension
        smoothGroundY = targetY;
        prevGroundY = groundTargetY;
        const accelForce = -22.0 * (suspY - 0.06) - 6.0 * suspVelY;
        suspVelY += accelForce * dt;
        suspY = Math.max(-0.045, Math.min(0.22, suspY + suspVelY * dt));
        accelSquat *= Math.exp(-dt * 4);
        cornerRoll += (Math.max(-0.18, Math.min(0.18, -lateralSpeed * 0.025 + steer * 0.14)) - cornerRoll) * Math.min(1, dt * 6);
        prevSpeed = speed;
      } else {
        // Spring-damper chassis suspension responding to Martian crater bump impulse (3.71 m/s^2 frame)
        const dGround = groundTargetY - (prevGroundY ?? groundTargetY);
        prevGroundY = groundTargetY;
        if (Math.abs(dGround) < 0.8) {
          suspVelY -= dGround * 3.8;
        }
        const accelForce = -38.0 * suspY - 7.8 * suspVelY;
        suspVelY += accelForce * dt;
        // Bias minimum suspension drop conservatively so heavy jounces never shove tires into ground
        suspY = Math.max(-0.055, Math.min(0.2, suspY + suspVelY * dt));
        const riseAlpha = groundTargetY > smoothGroundY ? Math.min(1, dt * 28) : Math.min(1, dt * 16);
        smoothGroundY += (groundTargetY - smoothGroundY) * riseAlpha;

        // Weight transfer pitch on Mars traction accel/braking & roll on high-speed turn / powerslide
        const dv = (speed - prevSpeed) / Math.max(0.008, dt);
        prevSpeed = speed;
        const targetSquat = Math.max(-0.095, Math.min(0.095, dv * 0.0042));
        const targetRollDyn = Math.max(-0.11, Math.min(0.11, steer * speed * 0.0085 - lateralSpeed * 0.022));
        accelSquat += (targetSquat - accelSquat) * Math.min(1, dt * 8);
        cornerRoll += (targetRollDyn - cornerRoll) * Math.min(1, dt * 8);
      }
    } else {
      prevSpeed = speed;
      suspY = 0;
      suspVelY = 0;
      accelSquat = 0;
      cornerRoll = 0;
      smoothGroundY = airborne && Number.isFinite(worldY) ? worldY : smoothGroundY + (groundTargetY - smoothGroundY) * Math.min(1, dt * 16);
    }

    group.position.y = smoothGroundY;
    bodyRoot.position.y = suspY;

    const wheelBaseZ = rearZ - frontZ;
    const terrainPitch = Math.atan2((hFL + hFR) * 0.5 - (hRL + hRR) * 0.5, wheelBaseZ);
    const flightPitch = Math.max(-0.38, Math.min(0.42, Math.atan2(velY, Math.max(2.5, Math.abs(speed)))));
    const targetPitch = airborne ? flightPitch : terrainPitch + accelSquat;
    const targetRoll = (airborne ? 0 : Math.atan2((hFR + hMR + hRR) / 3 - (hFL + hML + hRL) / 3, halfW * 2)) + cornerRoll;
    const kTilt = Math.min(1, dt * (airborne ? 6.5 : 10.5));
    smoothPitch += (targetPitch - smoothPitch) * kTilt;
    smoothRoll += (targetRoll - smoothRoll) * kTilt;
    bodyRoot.rotation.x = smoothPitch;
    bodyRoot.rotation.z = smoothRoll;

    const activeRig = hasRealModel ? mmsevWheels : fallback;
    const wheelR = hasRealModel ? ROVER_WHEEL_RADIUS_M : 0.46;
    wheelAngle -= (speed * dt) / wheelR;
    for (const w of activeRig.wheels) w.rotation.x = wheelAngle;

    const steerRad = Math.max(-0.42, Math.min(0.42, steer * 0.36));
    for (const kn of activeRig.frontSteerKnuckles) kn.rotation.y = steerRad;
    for (const kn of activeRig.rearSteerKnuckles) kn.rotation.y = -steerRad * 0.72;

    if (hasRealModel) {
      // Sample each dual-wheel pod footprint (fore/mid/aft) and enforce strict terrain-floor clamping
      // while allowing pods to droop naturally (-0.11m) when unweighted during mid-air flight.
      let chassisLiftNeeded = 0;
      const podContacts = [];
      for (const pod of mmsevWheels.pods) {
        const hPodMax = Math.max(
          samplePt(pod.lx, pod.lz),
          samplePt(pod.lx, pod.lz - 0.26),
          samplePt(pod.lx, pod.lz + 0.26)
        );
        const planeY = smoothGroundY + suspY - pod.lz * Math.sin(smoothPitch) + pod.lx * Math.sin(smoothRoll);
        const minAntiSinkDiff = hPodMax + 0.022 - planeY;
        const desiredDiff = Math.max(-0.12, minAntiSinkDiff);
        if (!airborne && desiredDiff > 0.22) {
          chassisLiftNeeded = Math.max(chassisLiftNeeded, desiredDiff - 0.22);
        }
        podContacts.push({ pod, hPodMax });
      }
      if (!airborne && chassisLiftNeeded > 0) {
        smoothGroundY += chassisLiftNeeded;
        group.position.y = smoothGroundY;
      }
      for (const { pod, hPodMax } of podContacts) {
        const planeY = smoothGroundY + suspY - pod.lz * Math.sin(smoothPitch) + pod.lx * Math.sin(smoothRoll);
        const minAntiSinkDiff = hPodMax + 0.022 - planeY;
        const targetPodDiff = airborne ? Math.max(-0.11, minAntiSinkDiff) : Math.max(-0.12, minAntiSinkDiff);
        pod.podRoot.position.y = pod.baseY + Math.min(0.42, targetPodDiff);
      }
    } else {
      fallback.mastHead.rotation.y = driving ? steerRad * 0.8 : Math.sin(clockT * 0.65) * 0.42;
      fallback.mastHead.rotation.x = driving ? -0.05 : -0.08 + Math.sin(clockT * 0.41) * 0.06;
      fallback.dishGroup.rotation.y = Math.sin(clockT * 0.22) * 0.35;
    }
  }

  /**
   * Returns world-space rear/outer tire emission coordinates for wheel dust plumes.
   */
  function getWheelDustEmitPoint(sideSign) {
    const yaw = group.rotation.y;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const zBack = hasRealModel ? 1.72 : 1.38;
    const xSide = (hasRealModel ? MMSEV_TRACK_HALF_W : 1.26) * sideSign;
    return {
      x: group.position.x + rx * xSide - fx * zBack,
      z: group.position.z + rz * xSide - fz * zBack,
    };
  }

  return {
    group,
    bodyRoot,
    headlight,
    radius: ROVER_COLLISION_RADIUS_M,
    get hasRealModel() {
      return hasRealModel;
    },
    get nasaModelRoot() {
      return nasaModelRoot;
    },
    attachRealModel,
    spawnBeside,
    resolveCollision,
    getWheelDustEmitPoint,
    sampleSupportGroundY,
    update,
  };
}
