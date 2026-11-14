/**
 * Drivable crew rovers (`web/hud/experimental-rover.js`).
 *
 * Visuals for three vehicles, all driven by the rigid-body physics in
 * `web/physics/VehicleDynamics.js`: real Gale crater gravity (~3.72 m/s²), a spring-damper per wheel
 * that can only push, tyre grip from each wheel's own load, power-limited electric drive. Nothing
 * here launches a vehicle: it leaves the ground only where the terrain falls away faster than Mars
 * gravity can follow (a real crest or a drop).
 *
 *  - sev:     NASA SEV / MMSEV pressurized rover (NASA 3D Resources GLB, procedural fallback)
 *  - chariot: the SEV "Chariot" chassis driven without the cabin, crew standing at the aft station
 *  - lrv:     Apollo LRV-class open rover (Apollo numbers stand in for a Mars version)
 *
 * The chassis origin is the ground point under the chassis centre at static ride height; wheel
 * pods sit at their static height and move with the physics suspension travel.
 */

import {
  VEHICLE_IDS,
  VEHICLE_SPECS,
  createVehicleBody,
  dampVehicleAlong,
  getVehicleSpec,
  shiftVehicle,
  stepVehicle,
  vehiclePose,
} from "../physics/VehicleDynamics.js";

export const ROVER_COLLISION_RADIUS_M = 2.45;
export const ROVER_WHEEL_RADIUS_M = 0.345;
export const ROVER_OBB_HALF_W = 1.66;
export const ROVER_OBB_HALF_L = 2.42;
export const ROVER_OBB_HEIGHT_M = 3.25;

const MMSEV_POD_DROP_OFFSET_Y = 0.055;

/** Spec of a drivable vehicle with its collision box flattened (halfW, halfL, heightM). */
export function getDrivableVehicleSpec(id = "sev") {
  const s = getVehicleSpec(id === "mmsev" ? "sev" : id);
  return { ...s, halfW: s.box.halfW, halfL: s.box.halfL, heightM: s.box.height };
}
export const DRIVABLE_VEHICLES = Object.freeze(VEHICLE_IDS.map((id) => getDrivableVehicleSpec(id)));

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
 * Exact Oriented Rounded-Box (OBB) collision push-out in world XZ + vertical roof tolerance.
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
  if (entityY != null && Number.isFinite(entityY) && Number.isFinite(roverY)) {
    if (entityY > roverY + roofHeight + 0.25) {
      return { hit: false, x: entityX, z: entityZ, nx: 0, nz: 0, pen: 0 };
    }
  }

  const cosY = Math.cos(roverYaw);
  const sinY = Math.sin(roverYaw);
  const dx = entityX - roverX;
  const dz = entityZ - roverZ;
  const lx = dx * cosY - dz * sinY;
  const lz = dx * sinY + dz * cosY;

  const clampedX = Math.max(-halfW, Math.min(halfW, lx));
  const clampedZ = Math.max(-halfL, Math.min(halfL, lz));
  const ux = lx - clampedX;
  const uz = lz - clampedZ;
  const distSq = ux * ux + uz * uz;

  if (distSq >= entityRadius * entityRadius) {
    return { hit: false, x: entityX, z: entityZ, nx: 0, nz: 0, pen: 0 };
  }

  let outLx;
  let outLz;
  let normLx;
  let normLz;
  let pen;
  if (distSq > 1e-8) {
    const dist = Math.sqrt(distSq);
    pen = entityRadius - dist;
    normLx = ux / dist;
    normLz = uz / dist;
    outLx = clampedX + normLx * entityRadius;
    outLz = clampedZ + normLz * entityRadius;
  } else {
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

function makeDoorDecalTexture(THREE, badgeText = "MM-EXP 01", subText = "GALE CRATER // PRESSURIZED") {
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
  g.fillText(badgeText, 16, 46);
  g.font = "600 13px ui-monospace, SFMono-Regular, Menlo, monospace";
  g.fillStyle = "#475569";
  g.fillText(subText, 16, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeMarsSpringTireTexture(THREE) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");

  g.fillStyle = "#15171b";
  g.fillRect(0, 0, 256, 256);

  g.strokeStyle = "rgba(182, 174, 158, 0.56)";
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

function buildArticulatedDualWheelPods(THREE, axleLayout, trackHalfW, radius, podCenterY, dual = true, rimAccent = 0xb98a4a) {
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
    color: rimAccent,
    roughness: 0.34,
    metalness: 0.78,
  });
  const strutDarkMat = new THREE.MeshStandardMaterial({
    color: 0x2c3038,
    roughness: 0.55,
    metalness: 0.7,
  });

  const tireW = dual ? 0.175 : 0.34;
  const dualOffsets = dual ? [-0.145, 0.145] : [0];
  const tireGeom = new THREE.CylinderGeometry(radius, radius, tireW, 24, 1, false);
  tireGeom.rotateZ(Math.PI / 2);

  const rimGeom = new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, tireW + 0.012, 16);
  rimGeom.rotateZ(Math.PI / 2);

  const hubGeom = new THREE.CylinderGeometry(radius * 0.28, radius * 0.31, tireW + 0.03, 12);
  hubGeom.rotateZ(Math.PI / 2);

  const cleatGeom = new THREE.BoxGeometry(tireW * 0.94, 0.026, 0.062);
  const axleShaftGeom = new THREE.CylinderGeometry(0.068, 0.068, dual ? 0.37 : 0.42, 12);
  axleShaftGeom.rotateZ(Math.PI / 2);
  const yokeCollarGeom = new THREE.CylinderGeometry(0.085, 0.085, 0.28, 12);

  const wheels = [];
  const frontSteerKnuckles = [];
  const rearSteerKnuckles = [];
  const pods = [];

  for (const ax of axleLayout) {
    for (const side of [-1, 1]) {
      const podRoot = new THREE.Group();
      podRoot.position.set(side * trackHalfW, podCenterY, ax.z);
      wheelGroup.add(podRoot);

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

      for (const dualOff of dualOffsets) {
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
        smoothPodY: 0,
      });
      if (ax.role === "front") frontSteerKnuckles.push(knuckle);
      else if (ax.role === "rear") rearSteerKnuckles.push(knuckle);
    }
  }

  return { wheelGroup, wheels, frontSteerKnuckles, rearSteerKnuckles, pods };
}

function buildProceduralMmsevVisuals(THREE) {
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
  const solarMat = new THREE.MeshStandardMaterial({ map: makeSolarTexture(THREE), color: 0xffffff, roughness: 0.28, metalness: 0.35 });
  const decalMat = new THREE.MeshStandardMaterial({ map: makeDoorDecalTexture(THREE), roughness: 0.46, metalness: 0.05 });

  const addM = (parent, geom, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    if (rx || ry || rz) m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  addM(procGroup, new THREE.BoxGeometry(1.75, 0.22, 3.6), frameMat, 0, 0.56, 0);
  addM(procGroup, new THREE.BoxGeometry(1.5, 0.18, 1.45), foilMat, 0, 0.52, 0.95);
  addM(procGroup, new THREE.BoxGeometry(2.04, 1.18, 2.75), hullMat, 0, 1.24, 0.18);
  addM(procGroup, new THREE.BoxGeometry(1.94, 0.62, 1.05), hullMat, 0, 0.98, -1.42, 0.24, 0, 0);
  addM(procGroup, new THREE.BoxGeometry(2.06, 0.1, 2.82), accentMat, 0, 0.72, 0.18);
  addM(procGroup, new THREE.PlaneGeometry(1.32, 0.5), decalMat, -1.03, 1.28, -0.05, 0, -Math.PI / 2, 0);
  addM(procGroup, new THREE.PlaneGeometry(1.32, 0.5), decalMat, 1.03, 1.28, -0.05, 0, Math.PI / 2, 0);
  addM(procGroup, new THREE.BoxGeometry(1.76, 0.54, 0.28), visorMat, 0, 1.45, -1.24, -0.38, 0, 0);
  addM(procGroup, new THREE.CylinderGeometry(0.62, 0.68, 0.95, 14), foilMat, 0, 1.28, 1.62, Math.PI / 2, 0, 0);
  for (const sx of [-0.72, 0.72]) {
    addM(procGroup, new THREE.BoxGeometry(0.95, 0.05, 1.95), solarMat, sx, 1.95, 0.68, 0.05, 0, sx < 0 ? 0.1 : -0.1);
  }
  return { procGroup };
}


/** Apollo LRV-class open rover: aluminium frame, two seats, console, high-gain dish, fenders. */
function buildLrvVisuals(THREE) {
  const g = new THREE.Group();
  const alu = new THREE.MeshStandardMaterial({ color: 0xb9bec5, roughness: 0.42, metalness: 0.75 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6, metalness: 0.5 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x5e6c7b, roughness: 0.85, metalness: 0.05 });
  const fenderMat = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.55, metalness: 0.2, side: THREE.DoubleSide });
  const foil = new THREE.MeshStandardMaterial({ color: 0xd4a42a, roughness: 0.3, metalness: 0.85 });
  const dishMat = new THREE.MeshStandardMaterial({
    color: 0xe8e8e8,
    roughness: 0.35,
    metalness: 0.4,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85,
  });
  const add = (geom, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  // chassis: 3.1 m frame (NSSDC), ~0.36 m ground clearance under it
  add(new THREE.BoxGeometry(1.25, 0.07, 3.1), alu, 0, 0.6, 0);
  add(new THREE.BoxGeometry(1.15, 0.025, 1.55), dark, 0, 0.645, 0.1);
  for (const x of [-0.62, 0.62]) add(new THREE.BoxGeometry(0.05, 0.09, 3.1), alu, x, 0.6, 0);
  // seats (webbing) and footrests
  for (const x of [-0.32, 0.32]) {
    add(new THREE.BoxGeometry(0.48, 0.05, 0.46), seatMat, x, 0.82, 0.22);
    add(new THREE.BoxGeometry(0.48, 0.46, 0.04), seatMat, x, 1.04, 0.45, -0.22);
    add(new THREE.BoxGeometry(0.04, 0.2, 0.46), alu, x - 0.24, 0.72, 0.22);
    add(new THREE.BoxGeometry(0.04, 0.2, 0.46), alu, x + 0.24, 0.72, 0.22);
  }
  // control and display console with the T-handle hand controller between the seats
  add(new THREE.BoxGeometry(0.42, 0.3, 0.16), dark, 0, 1.0, -0.42, -0.25);
  add(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 8), alu, 0, 0.86, 0.02);
  add(new THREE.BoxGeometry(0.12, 0.025, 0.025), dark, 0, 0.97, 0.02);
  // forward electronics with gold foil, rear tool pallet
  add(new THREE.BoxGeometry(0.95, 0.22, 0.42), foil, 0, 0.75, -1.3);
  add(new THREE.BoxGeometry(1.0, 0.32, 0.5), dark, 0, 0.8, 1.38);
  // high-gain umbrella dish on its mast (front left), low-gain helix, TV camera
  add(new THREE.CylinderGeometry(0.018, 0.018, 1.05, 8), alu, -0.42, 1.18, -1.2);
  const dish = add(new THREE.SphereGeometry(0.46, 24, 6, 0, Math.PI * 2, 0, 0.55), dishMat, -0.42, 1.72, -1.2, -0.9);
  dish.castShadow = true;
  add(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 8), alu, 0.42, 1.0, -1.2);
  add(new THREE.CylinderGeometry(0.035, 0.035, 0.28, 10), dark, 0.42, 1.48, -1.2);
  add(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 8), alu, 0, 1.0, -1.42);
  add(new THREE.BoxGeometry(0.16, 0.14, 0.24), dark, 0, 1.36, -1.42);
  // fenders over the four wheels (open half shells)
  for (const z of [-1.15, 1.15]) {
    for (const x of [-0.915, 0.915]) {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.3, 18, 1, true, -Math.PI / 2, Math.PI), fenderMat);
      f.rotation.z = Math.PI / 2;
      f.position.set(x, 0.409, z);
      f.castShadow = true;
      g.add(f);
    }
  }
  return g;
}

/** NASA Chariot: the SEV mobility chassis without the pressurized cabin; crew drive standing aft. */
function buildChariotVisuals(THREE) {
  const g = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x262b33, roughness: 0.72, metalness: 0.65 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.8, metalness: 0.4 });
  const foilMat = new THREE.MeshStandardMaterial({ color: 0xd4a42a, roughness: 0.28, metalness: 0.88 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xc8a046, roughness: 0.4, metalness: 0.8 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe6e2da, roughness: 0.44, metalness: 0.08 });
  const add = (geom, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(1.75, 0.22, 3.6), frameMat, 0, 0.56, 0);
  add(new THREE.BoxGeometry(1.5, 0.18, 1.45), foilMat, 0, 0.52, 0.95);
  add(new THREE.BoxGeometry(2.3, 0.06, 3.5), deckMat, 0, 0.71, 0);
  // battery / avionics boxes forward, work-package interface aft
  add(new THREE.BoxGeometry(1.4, 0.45, 0.9), whiteMat, 0, 0.97, -1.25);
  add(new THREE.BoxGeometry(0.9, 0.35, 0.35), frameMat, 0, 0.9, 1.78);
  // aft driving station: two standing turrets with railings and hand controllers
  for (const x of [-0.6, 0.6]) {
    add(new THREE.CylinderGeometry(0.34, 0.38, 0.12, 20), deckMat, x, 0.8, 0.95);
    add(new THREE.TorusGeometry(0.4, 0.025, 8, 28), railMat, x, 1.75, 0.95, Math.PI / 2);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.95, 8), railMat, x + Math.cos(a) * 0.4, 1.28, 0.95 + Math.sin(a) * 0.4);
    }
    add(new THREE.BoxGeometry(0.22, 0.18, 0.12), frameMat, x, 1.55, 0.6, -0.35);
  }
  // cargo rails along the sides
  for (const x of [-1.12, 1.12]) add(new THREE.BoxGeometry(0.04, 0.04, 3.2), railMat, x, 0.95, 0);
  return g;
}

export function createExperimentalRover(THREE) {
  const group = new THREE.Group();
  group.rotation.order = "YXZ"; // rotation.y stays the heading when the chassis pitches and rolls
  const bodyRoot = new THREE.Group();
  group.add(bodyRoot);

  let hasRealMmsevModel = false;
  let nasaModelRoot = null;

  const axlesOf = (spec) =>
    spec.axles.map((z, i) => ({ z, role: spec.steerAxles[i] > 0 ? "front" : spec.steerAxles[i] < 0 ? "rear" : "mid" }));
  const podsFor = (spec, dual, accent) =>
    buildArticulatedDualWheelPods(THREE, axlesOf(spec), spec.trackHalfW, spec.wheelRadius, spec.wheelRadius, dual, accent);

  // SEV / MMSEV (NASA GLB + articulated dual pods, procedural fallback)
  const sevContainer = new THREE.Group();
  const sevFallback = buildProceduralMmsevVisuals(THREE);
  sevContainer.add(sevFallback.procGroup);
  const sevRig = podsFor(VEHICLE_SPECS.sev, true, 0xb98a4a);
  sevContainer.add(sevRig.wheelGroup);

  // Chariot (SEV chassis without the cabin)
  const chariotContainer = new THREE.Group();
  chariotContainer.add(buildChariotVisuals(THREE));
  const chariotRig = podsFor(VEHICLE_SPECS.chariot, true, 0xb98a4a);
  chariotContainer.add(chariotRig.wheelGroup);

  // Apollo LRV-class open rover (single wire-mesh-style wheels)
  const lrvContainer = new THREE.Group();
  lrvContainer.add(buildLrvVisuals(THREE));
  const lrvRig = podsFor(VEHICLE_SPECS.lrv, false, 0xc9cdd2);
  lrvContainer.add(lrvRig.wheelGroup);

  const rigs = {
    sev: { container: sevContainer, rig: sevRig, head: [0, 1.15, -2.6], tailY: 1.05, tailZ: 1.98 },
    chariot: { container: chariotContainer, rig: chariotRig, head: [0, 1.0, -1.75], tailY: 0.95, tailZ: 1.9 },
    lrv: { container: lrvContainer, rig: lrvRig, head: [0, 0.95, -1.62], tailY: 0.85, tailZ: 1.62 },
  };
  for (const r of Object.values(rigs)) bodyRoot.add(r.container);

  // Shared lights (moved per vehicle, so switching does not change the scene's light count)
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xffe4b5, emissiveIntensity: 2.3, roughness: 0.2 });
  const lamps = [-0.5, 0.5].map((lx) => {
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 12), lampMat);
    lamp.rotation.x = Math.PI / 2;
    lamp.userData.lx = lx;
    bodyRoot.add(lamp);
    return lamp;
  });
  const headlight = new THREE.PointLight(0xffdfb3, 2.0, 26, 1.5);
  bodyRoot.add(headlight);
  const highBeam = new THREE.SpotLight(0xffe7c2, 5.4, 52, 0.58, 0.65, 1.3);
  bodyRoot.add(highBeam);
  bodyRoot.add(highBeam.target);
  const tailBarMat = new THREE.MeshStandardMaterial({ color: 0xff4938, emissive: 0xef4444, emissiveIntensity: 1.4, roughness: 0.24 });
  const tailBars = [-0.52, 0.52].map((lx) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.055, 0.045), tailBarMat);
    bar.userData.lx = lx;
    bar.castShadow = true;
    bodyRoot.add(bar);
    return bar;
  });

  let activeId = "sev";
  let body = null;

  function applyVehicleVisibility() {
    for (const [id, r] of Object.entries(rigs)) r.container.visible = id === activeId;
    sevFallback.procGroup.visible = !hasRealMmsevModel;
    const r = rigs[activeId];
    const [hx, hy, hz] = r.head;
    for (const lamp of lamps) lamp.position.set(lamp.userData.lx, hy - 0.25, hz + 0.58);
    headlight.position.set(hx, hy, hz);
    highBeam.position.set(hx, hy + 0.07, hz + 0.42);
    highBeam.target.position.set(0, 0.1, hz - 18);
    for (const bar of tailBars) bar.position.set(bar.userData.lx, r.tailY, r.tailZ);
  }

  function getActiveSpec() {
    return getDrivableVehicleSpec(activeId);
  }

  async function attachRealModel(gltfLoader, url = "./assets/nasa-3d/mmsev-rover.glb") {
    if (hasRealMmsevModel || !gltfLoader) return false;
    try {
      const gltf = await gltfLoader.loadAsync(url);
      const model = gltf?.scene;
      if (!model) return false;
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      const scale = 4.65 / Math.max(size.x, size.z, 0.01);
      model.position.set(-center.x * scale, -box.min.y * scale + MMSEV_POD_DROP_OFFSET_Y, -center.z * scale);
      model.scale.setScalar(scale);
      stripStaticWheelTriangles(THREE, model);
      const wrapper = new THREE.Group();
      wrapper.rotation.y = Math.PI;
      wrapper.add(model);
      wrapper.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.material) {
          o.material.envMapIntensity = 0.85;
          if (o.material.normalMap && o.material.normalScale) o.material.normalScale.set(0.8, 0.8);
          o.material.needsUpdate = true;
        }
      });
      sevContainer.add(wrapper);
      nasaModelRoot = wrapper;
      hasRealMmsevModel = true;
      applyVehicleVisibility();
      return true;
    } catch (err) {
      console.warn("NASA MMSEV rover model failed, keeping procedural fallback:", err);
      return false;
    }
  }

  /** Copy the physics pose to the meshes: chassis transform, suspension travel, wheel spin and steer. */
  function syncVisual() {
    if (!body) return;
    const pose = vehiclePose(body);
    group.position.set(pose.origin.x, pose.origin.y, pose.origin.z);
    group.quaternion.set(body.q.x, body.q.y, body.q.z, body.q.w);
    const rig = rigs[activeId].rig;
    body.wheels.forEach((w, i) => {
      const pod = rig.pods[i];
      if (!pod) return;
      pod.podRoot.position.y = pod.baseY + w.s;
      pod.spinner.rotation.x = -w.spin;
      pod.knuckle.rotation.y = w.steerRad;
    });
  }

  /** Switch vehicle type. A vehicle already standing somewhere is replaced in place. */
  function setVehicle(id, sampleElevY = null) {
    activeId = VEHICLE_SPECS[id] ? id : "sev";
    applyVehicleVisibility();
    if (body && sampleElevY) {
      const pose = vehiclePose(body);
      body = createVehicleBody(activeId, pose.origin.x, pose.origin.z, pose.yaw, sampleElevY);
      syncVisual();
    }
    return activeId;
  }

  function spawnBeside(x, z, yaw, sampleElevY) {
    const pos = computeSpawnBesideOffset(x, z, yaw, 3.8, 2.8);
    body = createVehicleBody(activeId, pos.x, pos.z, yaw, sampleElevY);
    syncVisual();
    return group.position;
  }

  /**
   * Advance the physics and update the meshes.
   * input: { throttle, steer (+ left), brake, crab, speedMultiplier }
   */
  function step(dt, input, sampleElevY, { driving = false, braking = false } = {}) {
    if (!body || !group.visible || !sampleElevY) return body;
    stepVehicle(body, input || {}, { sampleHeight: sampleElevY }, dt);
    tailBarMat.emissiveIntensity = braking ? 3.8 : driving ? 1.7 : 0.7;
    syncVisual();
    return body;
  }

  /** Move the vehicle without changing its motion (seamless world wrap). */
  function shift(dx, dz) {
    if (body) shiftVehicle(body, dx, dz);
    group.position.x += dx;
    group.position.z += dz;
  }

  /** Push the vehicle out of a contact (normal points from the vehicle to the other body) and stop it going in. */
  function pushOut(nx, nz, pen) {
    if (!body) return;
    shiftVehicle(body, -nx * pen, -nz * pen);
    dampVehicleAlong(body, -nx, -nz, 0.2);
    syncVisual();
  }

  function resolveCollision(entityX, entityZ, entityRadius = 0.42, entityY = null) {
    if (!group.visible) return { hit: false, x: entityX, z: entityZ, nx: 0, nz: 0, pen: 0 };
    const spec = getActiveSpec();
    return resolveRoverObbCollision(
      group.position.x,
      group.position.z,
      group.rotation.y,
      group.position.y,
      entityX,
      entityZ,
      entityRadius,
      entityY,
      spec.halfW,
      spec.halfL,
      spec.heightM
    );
  }

  function getWheelDustEmitPoint(sideSign) {
    const spec = getActiveSpec();
    const yaw = group.rotation.y;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const zBack = spec.axles[spec.axles.length - 1];
    const xSide = spec.trackHalfW * sideSign;
    return {
      x: group.position.x + rx * xSide - fx * zBack,
      z: group.position.z + rz * xSide - fz * zBack,
    };
  }

  applyVehicleVisibility();

  return {
    group,
    bodyRoot,
    headlight,
    get body() {
      return body;
    },
    get radius() {
      const s = getActiveSpec();
      return Math.max(s.halfW, s.halfL);
    },
    get vehicleType() {
      return activeId;
    },
    get hasRealModel() {
      return hasRealMmsevModel;
    },
    get nasaModelRoot() {
      return nasaModelRoot;
    },
    getActiveSpec,
    attachRealModel,
    setVehicle,
    spawnBeside,
    step,
    shift,
    pushOut,
    resolveCollision,
    getWheelDustEmitPoint,
  };
}
