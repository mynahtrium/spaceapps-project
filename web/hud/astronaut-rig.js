/**
 * Procedural rig and walk cycle for a static NASA 3D Resources spacesuit (`web/hud/astronaut-rig.js`).
 *
 * The NASA glTF has no skeleton, so this builds one from the mesh itself:
 *  - finds the leg columns in a slice just above the boots and centres the suit on them,
 *  - places hip / knee / ankle joints at standard proportions of a 1.80 m body,
 *  - writes skin weights from each vertex position (legs, pelvis, spine, chest, head, and the two
 *    arms on shoulder joints; the model's arms reach forward, so a rest rotation lowers them),
 *  - drives a gait cycle (hip, knee and ankle angles, pelvis bob and twist, torso counter-rotation)
 *    from distance actually walked, so feet keep step with speed. Running and jumping poses too.
 * Forward is -Z (the suit's hands and visor face -Z), right is +X.
 */

import * as THREE from "three";
import { FROUDE_LOPE_MS, HIP_NEUTRAL_RAD, KNEE_NEUTRAL_RAD } from "../physics/SuitBiomechanics.js";

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const BONES = [
  "root",
  "pelvis",
  "spine",
  "chest",
  "head",
  "thighL",
  "shinL",
  "footL",
  "thighR",
  "shinR",
  "footR",
  "armL",
  "armR",
  "foreL",
  "foreR",
  "handL",
  "handR",
];
const B = Object.fromEntries(BONES.map((n, i) => [n, i]));

/** Load the glTF and turn it into skinned geometry plus joint positions (shared by all instances). */
export async function loadSuitRig(loader, url, heightM) {
  const isMarkIII = /mark/i.test(url);
  const gltf = await loader.loadAsync(url);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const s = heightM / (box.max.y - box.min.y);

  const parts = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    g.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    g.scale(s, s, s);
    const m = o.material.clone();
    // The export marks every material as transmissive; a suit is opaque fabric and metal.
    if ("transmission" in m) m.transmission = 0;
    // DoubleSide prevents interior cuffs, collar edges, and inner-leg seam folds from culling into visible cuts.
    m.side = THREE.DoubleSide;
    if (isMarkIII) {
      // Preserve authored PBR textures (suit atlas, ESA patch, aluminum waist ring) without turning metals black.
      m.roughness = Math.max(m.roughness ?? 0.6, 0.35);
      m.metalness = Math.min(m.metalness ?? 0, 0.18);
    } else {
      m.roughness = Math.max(m.roughness ?? 0.8, 0.55);
      // Suit fabric and painted metal: the export's high metalness renders black without reflections.
      m.metalness = Math.min(m.metalness ?? 0, 0.08);
      if (!m.map) {
        // Preserve NASA suit glTF textures & shading detail while allowing clean regional White/Orange zones
        m.onBeforeCompile = (shader) => {
          shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nattribute float aSuitWhite;\nvarying float vSuitWhite;")
            .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSuitWhite = aSuitWhite;");
          shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", "#include <common>\nvarying float vSuitWhite;")
            .replace(
              "#include <map_fragment>",
              `#include <map_fragment>
              float suitLum = clamp(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)) * 1.48, 0.20, 1.0);
              vec3 nasaOrange = vec3(0.92, 0.36, 0.07) * suitLum;
              vec3 nasaWhite  = vec3(0.93, 0.95, 0.97) * suitLum;
              diffuseColor.rgb = mix(nasaOrange, nasaWhite, vSuitWhite);`
            );
        };
      }
    }
    const partName = o.name || o.parent?.name || "";
    parts.push({ geometry: g, material: m, partName });
  });

  // Centre on the leg columns (slice just above the boots), and find each leg's x.
  const H = heightM / 1.8; // proportions below are for a 1.80 m body
  let sx = 0;
  let sz = 0;
  let n = 0;
  const lx = [];
  const rx = [];
  const v = new THREE.Vector3();
  for (const p of parts) {
    const pos = p.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (v.y > 0.15 * H && v.y < 0.45 * H) {
        sx += v.x;
        sz += v.z;
        n++;
      }
    }
  }
  const cx = n ? sx / n : 0;
  const cz = n ? sz / n : 0;
  for (const p of parts) p.geometry.translate(-cx, 0, -cz);
  if (!isMarkIII) cylindrifyLegs(parts, H);
  for (const p of parts) {
    const pos = p.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (v.y > 0.15 * H && v.y < 0.45 * H) (v.x < 0 ? lx : rx).push(v.x);
    }
  }
  const mean = (a, d) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : d);
  const legL = mean(lx, -0.14 * H);
  const legR = mean(rx, 0.14 * H);

  // joint heights in metres for a 1.80 m body (H scales them for other heights)
  const J = isMarkIII
    ? {
        hipY: 0.72 * H,
        kneeY: 0.46 * H,
        ankleY: 0.14 * H,
        spineY: 1.04 * H,
        chestY: 1.26 * H,
        neckY: 1.44 * H,
        shoulderY: 1.25 * H,
        shoulderX: 0.18 * H,
        legL,
        legR,
        arm: {
          L: {
            shoulder: new THREE.Vector3(-0.20 * H, 1.265 * H, -0.145 * H),
            elbow: new THREE.Vector3(-0.312 * H, 1.149 * H, -0.218 * H),
            wrist: new THREE.Vector3(-0.3244 * H, 1.0781 * H, -0.2781 * H),
            hand: new THREE.Vector3(-0.2957 * H, 0.9509 * H, -0.4491 * H),
          },
          R: {
            shoulder: new THREE.Vector3(0.19 * H, 1.265 * H, -0.185 * H),
            elbow: new THREE.Vector3(0.2907 * H, 1.1489 * H, -0.2663 * H),
            wrist: new THREE.Vector3(0.2934 * H, 1.094 * H, -0.3198 * H),
            hand: new THREE.Vector3(0.2222 * H, 0.969 * H, -0.4867 * H),
          },
        },
      }
    : {
        hipY: 0.92 * H,
        kneeY: 0.5 * H,
        ankleY: 0.1 * H,
        spineY: 1.1 * H,
        chestY: 1.33 * H,
        neckY: 1.5 * H,
        shoulderY: 1.31 * H,
        shoulderX: 0.29 * H,
        legL,
        legR,
      };

  if (!isMarkIII) {
    // Measure each arm from the mesh: hand = farthest arm vertices from the shoulder joint,
    // elbow = arm vertices at about 42% of that reach (upper arm of a 1.80 m body is ~0.30 m).
    J.arm = {};
    for (const [side, sign] of [
      ["L", -1],
      ["R", 1],
    ]) {
      const sh = new THREE.Vector3(sign * J.shoulderX, J.shoulderY, 0);
      const pts = [];
      for (const p of parts) {
        const pos = p.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          if (Math.sign(v.x) !== sign) continue;
          if (armWeight(v.x, v.y, v.z, J, H) > 0.9) pts.push([v.x, v.y, v.z, v.distanceTo(sh)]);
        }
      }
      const dMax = pts.reduce((m, q) => Math.max(m, q[3]), 0) || 0.7 * H;
      const avg = (sel, fallback) => {
        const list = pts.filter(sel);
        if (!list.length) return fallback;
        const a = [0, 0, 0];
        for (const q of list) for (let k = 0; k < 3; k++) a[k] += q[k];
        return new THREE.Vector3(a[0] / list.length, a[1] / list.length, a[2] / list.length);
      };
      const dE = 0.42 * dMax;
      const elbow = avg((q) => Math.abs(q[3] - dE) < 0.03 * H, sh.clone().add(new THREE.Vector3(0, -0.3 * H, 0)));
      const hand = avg((q) => q[3] > 0.9 * dMax, elbow.clone().add(new THREE.Vector3(0, -0.35 * H, 0)));
      // wrist: the glove starts about 0.13 H before the fingertip cluster, along the forearm axis
      const axis = hand.clone().sub(elbow).normalize();
      const wristProj = hand.clone().sub(elbow).dot(axis) - 0.13 * H;
      const wrist = elbow.clone().addScaledVector(axis, wristProj);
      J.arm[side] = { shoulder: sh, elbow, hand, dE, axis, wristProj, wrist };
    }
  } else {
    for (const side of ["L", "R"]) {
      const a = J.arm[side];
      a.axis = a.hand.clone().sub(a.elbow).normalize();
      a.dE = a.elbow.distanceTo(a.shoulder);
      a.wristProj = a.wrist.clone().sub(a.elbow).dot(a.axis);
    }
  }

  // Precompute lateral Torso_HUT boundary vertices so Mark III arm scye seams stay 100% welded to the HUT.
  const torsoBoundaryPts = [];
  if (isMarkIII) {
    for (const p of parts) {
      if (!/Torso_HUT/i.test(p.partName)) continue;
      const pos = p.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        if (Math.abs(v.x) > 0.12 * H && v.y > 1.0 * H && v.y < 1.38 * H) {
          torsoBoundaryPts.push(v.x, v.y, v.z);
        }
      }
    }
  }

  // Skin weights & clean anatomical NASA White/Orange color-zone masks from vertex position.
  for (const p of parts) {
    const pos = p.geometry.attributes.position;
    const idx = new Uint16Array(pos.count * 4);
    const wts = new Float32Array(pos.count * 4);
    const suitWhite = isMarkIII ? null : new Float32Array(pos.count);
    const isArmPart = isMarkIII && /^Arm_(L|R)$/i.test(p.partName);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      let dScye = 1;
      if (isArmPart && torsoBoundaryPts.length) {
        let bestSq = Infinity;
        for (let k = 0; k < torsoBoundaryPts.length; k += 3) {
          const dx = v.x - torsoBoundaryPts[k];
          const dy = v.y - torsoBoundaryPts[k + 1];
          const dz = v.z - torsoBoundaryPts[k + 2];
          const dSq = dx * dx + dy * dy + dz * dz;
          if (dSq < bestSq) bestSq = dSq;
        }
        dScye = Math.sqrt(bestSq);
      }
      const list = isMarkIII
        ? weightsForMarkIII(v.x, v.y, v.z, p.partName, dScye, J, H)
        : weightsFor(v.x, v.y, v.z, J, H);
      for (let k = 0; k < 4; k++) {
        idx[i * 4 + k] = list[k] ? list[k][0] : 0;
        wts[i * 4 + k] = list[k] ? list[k][1] : 0;
      }
      if (suitWhite) suitWhite[i] = suitWhiteZone(v.x, v.y, v.z, J, H);
    }
    p.geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(idx, 4));
    p.geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(wts, 4));
    if (suitWhite) p.geometry.setAttribute("aSuitWhite", new THREE.Float32BufferAttribute(suitWhite, 1));
  }

  // Measure actual boot sole footprint from the loaded NASA suit mesh (left/right boot bounds).
  let minBootZ = Infinity;
  let maxBootZ = -Infinity;
  let minBootX = Infinity;
  let maxBootX = -Infinity;
  for (const p of parts) {
    const pos = p.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (v.y <= J.ankleY * 0.95) {
        if (v.z < minBootZ) minBootZ = v.z;
        if (v.z > maxBootZ) maxBootZ = v.z;
        if (v.x < 0) {
          if (v.x < minBootX) minBootX = v.x;
          if (v.x > maxBootX) maxBootX = v.x;
        }
      }
    }
  }
  const bootLengthM = Number.isFinite(maxBootZ - minBootZ) ? Math.max(0.24, Math.min(0.42, maxBootZ - minBootZ)) : 0.32;
  const bootWidthM = Number.isFinite(maxBootX - minBootX) ? Math.max(0.10, Math.min(0.19, maxBootX - minBootX)) : 0.14;
  const kind = isMarkIII ? "mark-iii" : /aces/i.test(url) ? "aces" : "eva";
  const bootBounds = { lengthM: bootLengthM, widthM: bootWidthM, kind };

  return { parts, J, H, bootBounds };
}

/** Regularize inner-leg bulges and ankle-to-thigh contours into clean, spaced cylindrical suit legs. */
function cylindrifyLegs(parts, H) {
  const bins = 16;
  const yMin = 0.16 * H;
  const yMax = 0.74 * H;
  const spanY = yMax - yMin;
  const prof = { L: [], R: [] };
  for (let b = 0; b < bins; b++) {
    const yb0 = yMin + (b / bins) * spanY;
    const yb1 = yMin + ((b + 1) / bins) * spanY;
    const acc = {
      L: { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, sx: 0, sz: 0, c: 0 },
      R: { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, sx: 0, sz: 0, c: 0 },
    };
    for (const p of parts) {
      const pos = p.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y < yb0 || y >= yb1) continue;
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const s = x < 0 ? acc.L : acc.R;
        if (x < s.minX) s.minX = x;
        if (x > s.maxX) s.maxX = x;
        if (z < s.minZ) s.minZ = z;
        if (z > s.maxZ) s.maxZ = z;
        s.sx += x;
        s.sz += z;
        s.c++;
      }
    }
    const yMid = 0.5 * (yb0 + yb1);
    for (const [side, defX] of [["L", -0.152 * H], ["R", 0.152 * H]]) {
      const s = acc[side];
      const cx = s.c ? 0.5 * (0.5 * (s.minX + s.maxX) + s.sx / s.c) : defX;
      const cz = s.c ? 0.5 * (0.5 * (s.minZ + s.maxZ) + s.sz / s.c) : 0;
      prof[side].push({ y: yMid, cx, cz });
    }
  }
  for (const side of ["L", "R"]) {
    for (let pass = 0; pass < 3; pass++) {
      const arr = prof[side];
      prof[side] = arr.map((cur, i) => {
        const a = arr[Math.max(0, i - 1)];
        const c = arr[Math.min(arr.length - 1, i + 1)];
        return {
          y: cur.y,
          cx: (a.cx + 2 * cur.cx + c.cx) * 0.25,
          cz: (a.cz + 2 * cur.cz + c.cz) * 0.25,
        };
      });
    }
  }
  const sampleCenter = (side, y) => {
    const arr = prof[side];
    const t = ((y - arr[0].y) / (arr[arr.length - 1].y - arr[0].y)) * (arr.length - 1);
    const i0 = Math.max(0, Math.min(arr.length - 2, Math.floor(t)));
    const f = Math.max(0, Math.min(1, t - i0));
    return {
      cx: arr[i0].cx * (1 - f) + arr[i0 + 1].cx * f,
      cz: arr[i0].cz * (1 - f) + arr[i0 + 1].cz * f,
    };
  };

  for (const p of parts) {
    const pos = p.geometry.attributes.position;
    const norm = p.geometry.attributes.normal;
    let moved = false;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < 0.18 * H || y > 0.76 * H) continue;
      const wEnv = smooth(0.18 * H, 0.24 * H, y) * (1 - smooth(0.64 * H, 0.76 * H, y));
      if (wEnv <= 1e-4) continue;
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const sign = x < 0 ? -1 : 1;
      const { cx, cz } = sampleCenter(sign < 0 ? "L" : "R", y);
      const dx = x - cx;
      const dz = z - cz;
      const r = Math.hypot(dx, dz);
      if (r < 0.025 * H) continue;
      const ux = dx / r;
      const uz = dz / r;
      const targetCx = sign * 0.152 * H;
      const targetCz = -0.005 * H;
      const targetR = (0.093 + 0.013 * smooth(0.22 * H, 0.62 * H, y)) * H;
      const cxMix = cx + (targetCx - cx) * 0.92;
      const czMix = cz + (targetCz - cz) * 0.85;
      const rMix = r + (targetR - r) * 0.9;
      pos.setX(i, x + (cxMix + ux * rMix - x) * wEnv);
      pos.setZ(i, z + (czMix + uz * rMix - z) * wEnv);
      if (norm) {
        const nx = norm.getX(i);
        const ny = norm.getY(i);
        const nz = norm.getZ(i);
        const kN = 0.78 * wEnv;
        const bx = nx + (ux - nx) * kN;
        const by = ny * (1 - kN * 0.7);
        const bz = nz + (uz - nz) * kN;
        const bl = Math.hypot(bx, by, bz) || 1;
        norm.setXYZ(i, bx / bl, by / bl, bz / bl);
      }
      moved = true;
    }
    if (moved) {
      pos.needsUpdate = true;
      if (norm) norm.needsUpdate = true;
    }
  }
}

function weightsFor(x, y, z, J, H) {
  const list = weightsForBody(x, y, z, J, H);
  // glove: whatever the forearm bone holds beyond the wrist goes to the hand bone (smooth over ~5 cm)
  const side = x < 0 ? "L" : "R";
  const a = J.arm?.[side];
  if (!a) return list;
  const fore = B[`fore${side}`];
  const hand = B[`hand${side}`];
  const i = list.findIndex((e) => e[0] === fore);
  if (i < 0) return list;
  const proj = (x - a.elbow.x) * a.axis.x + (y - a.elbow.y) * a.axis.y + (z - a.elbow.z) * a.axis.z;
  const t = smooth(a.wristProj - 0.03 * H, a.wristProj + 0.025 * H, proj);
  if (t <= 0.001) return list;
  const w = list[i][1];
  list[i] = [fore, w * (1 - t)];
  list.push([hand, w * t]);
  return normalise(list.filter((e) => e[1] > 1e-3));
}

/**
 * Node-aware skinning weights for the 12-node Mark III hard-upper-torso spacesuit.
 * Prevents L/R leg cross-talk, seals the arm scye to chest, and isolates gloves on the wrist bearing.
 */
function weightsForMarkIII(x, y, z, partName, dScye, J, H) {
  if (/Head_Helmet/i.test(partName)) return [[B.head, 1]];

  if (/Torso_HUT/i.test(partName)) {
    const wSpine = (1 - smooth(1.02 * H, 1.18 * H, y)) * 0.35;
    return normalise([
      [B.chest, 1 - wSpine],
      [B.spine, wSpine],
    ]);
  }

  if (/Waist_Spine/i.test(partName)) {
    const wChest = smooth(1.05 * H, 1.125 * H, y) * 0.65;
    const wPel = (1 - smooth(0.995 * H, 1.05 * H, y)) * 0.85;
    const wSpine = Math.max(0, 1 - wChest - wPel);
    return normalise([
      [B.pelvis, wPel],
      [B.spine, wSpine],
      [B.chest, wChest],
    ]);
  }

  if (/Pelvis_Brief/i.test(partName)) {
    const wSpine = smooth(0.96 * H, 1.02 * H, y) * 0.15;
    const wThigh =
      (1 - smooth(0.67 * H, 0.76 * H, y)) * 0.18 * smooth(0.03 * H, 0.08 * H, Math.abs(x));
    const thighBone = x < 0 ? B.thighL : B.thighR;
    return normalise([
      [B.pelvis, Math.max(0, 1 - wSpine - wThigh)],
      [B.spine, wSpine],
      [thighBone, wThigh],
    ]);
  }

  const armMatch = /^Arm_(L|R)$/i.exec(partName);
  if (armMatch) {
    const side = armMatch[1].toUpperCase();
    const a = J.arm[side];
    const wChest = 1 - smooth(0.005 * H, 0.055 * H, dScye);
    const armShare = 1 - wChest;
    // Parameterize along shoulder -> elbow -> wrist polyline (0 = shoulder, 1 = elbow, 2 = wrist).
    const pVec = new THREE.Vector3(x, y, z);
    const seg1 = a.elbow.clone().sub(a.shoulder);
    const seg2 = a.wrist.clone().sub(a.elbow);
    const l1Sq = Math.max(1e-8, seg1.lengthSq());
    const l2Sq = Math.max(1e-8, seg2.lengthSq());
    const u1 = Math.max(0, Math.min(1, pVec.clone().sub(a.shoulder).dot(seg1) / l1Sq));
    const u2 = Math.max(0, Math.min(1, pVec.clone().sub(a.elbow).dot(seg2) / l2Sq));
    const d1Sq = pVec.distanceToSquared(a.shoulder.clone().addScaledVector(seg1, u1));
    const d2Sq = pVec.distanceToSquared(a.elbow.clone().addScaledVector(seg2, u2));
    const tPoly = d1Sq <= d2Sq ? u1 : 1 + u2;
    const wFore = smooth(0.65, 1.35, tPoly);
    return normalise([
      [B.chest, wChest],
      [B[`arm${side}`], armShare * (1 - wFore)],
      [B[`fore${side}`], armShare * wFore],
    ]);
  }

  const handMatch = /^Hand_(L|R)$/i.exec(partName);
  if (handMatch) {
    const side = handMatch[1].toUpperCase();
    return [[B[`hand${side}`], 1]];
  }

  const legMatch = /^Leg_(L|R)$/i.exec(partName);
  if (legMatch) {
    const side = legMatch[1].toUpperCase();
    const tPel = smooth(0.63 * H, 0.71 * H, y);
    const tKnee = smooth(J.kneeY - 0.08 * H, J.kneeY + 0.08 * H, y);
    const tAnkle = smooth(0.11 * H, 0.19 * H, y);
    const legShare = 1 - tPel;
    const lower = legShare * (1 - tKnee);
    return normalise([
      [B.pelvis, tPel],
      [B[`thigh${side}`], legShare * tKnee],
      [B[`shin${side}`], lower * tAnkle],
      [B[`foot${side}`], lower * (1 - tAnkle)],
    ]);
  }

  const bootMatch = /^Boot_(L|R)$/i.exec(partName);
  if (bootMatch) {
    const side = bootMatch[1].toUpperCase();
    const tAnkle = smooth(0.11 * H, 0.19 * H, y);
    return normalise([
      [B[`shin${side}`], tAnkle],
      [B[`foot${side}`], 1 - tAnkle],
    ]);
  }

  return weightsFor(x, y, z, J, H);
}

function weightsForBody(x, y, z, J, H) {
  const out = [];
  const add = (b, w) => {
    if (w > 1e-3) out.push([b, w]);
  };
  const ax = Math.abs(x);

  // Helmet / head: hard cut so it can be hidden cleanly for the wearer's own view.
  if (y > J.neckY && ax < 0.26 * H && z > -0.3 * H) {
    add(B.head, 1);
    return out;
  }

  // Arms & wrists: compute armWeight first so leg/hip vertices can never be captured by forearm/hand locks.
  const wArm = armWeight(x, y, z, J, H);
  const aHand = J.arm?.[x < 0 ? "L" : "R"];
  if (wArm > 0.5 && aHand) {
    const dHand = Math.hypot(x - aHand.hand.x, y - aHand.hand.y, z - aHand.hand.z);
    const dSh = Math.hypot(x - aHand.shoulder.x, y - aHand.shoulder.y, z - aHand.shoulder.z);
    if (dHand < 0.21 * H || dSh > aHand.dE + 0.09 * H) {
      add(x < 0 ? B.foreL : B.foreR, 1);
      return out;
    }
  }

  // Arms: upper arm on the shoulder joint, forearm and glove on the elbow joint.
  if (wArm > 0) {
    const a = aHand;
    let tFore = 0;
    if (a) {
      const d = Math.hypot(x - a.shoulder.x, y - a.shoulder.y, z - a.shoulder.z);
      tFore = smooth(a.dE - 0.05 * H, a.dE + 0.05 * H, d);
    }
    add(x < 0 ? B.armL : B.armR, wArm * (1 - tFore));
    add(x < 0 ? B.foreL : B.foreR, wArm * tFore);
    if (wArm >= 0.999) return normalise(out);
  }
  const rest = 1 - wArm;

  // Torso: pelvis -> spine -> chest.
  if (y >= J.hipY + 0.06 * H) {
    const tChest = smooth(J.spineY, J.chestY, y);
    const tSpine = smooth(J.hipY + 0.06 * H, J.spineY, y);
    add(B.chest, rest * tChest);
    add(B.spine, rest * tSpine * (1 - tChest));
    add(B.pelvis, rest * (1 - tSpine));
    return normalise(out);
  }
  // Legs: strict left/right split below the crotch seam prevents inner-leg tearing; pelvis anchors groin seam.
  const tR = x < 0 ? 0 : 1;
  const tCrotch = smooth(0.68 * H, 0.77 * H, y) * (1 - smooth(0.025 * H, 0.10 * H, ax));
  const tPel = Math.max(smooth(0.74 * H, J.hipY + 0.06 * H, y), tCrotch);
  const leg = (thigh, shin, foot, share) => {
    if (share <= 0) return;
    const tKnee = smooth(J.kneeY - 0.11 * H, J.kneeY + 0.11 * H, y); // 1 = thigh
    const tAnkle = smooth(J.ankleY - 0.04 * H, J.ankleY + 0.07 * H, y); // 1 = shin
    const legShare = rest * share * (1 - tPel);
    add(thigh, legShare * tKnee);
    add(shin, legShare * (1 - tKnee) * tAnkle);
    add(foot, legShare * (1 - tKnee) * (1 - tAnkle));
  };
  leg(B.thighL, B.shinL, B.footL, 1 - tR);
  leg(B.thighR, B.shinR, B.footR, tR);
  add(B.pelvis, rest * tPel);
  return normalise(out);
}

// Arms: outboard of the torso (upper arm, elbow) or cleanly in front of it (forearm, glove).
// Balanced Left & Right capture keeps hands anchored cleanly without touching hip, thigh, or chest geometry.
function armWeight(x, y, z, J, H) {
  if (y <= 0.84 * H || y >= 1.44 * H) return 0;
  if (y > J.neckY && Math.abs(x) < 0.26 * H && z > -0.3 * H) return 0; // helmet
  const ax = Math.abs(x);
  const side = y >= 0.86 * H ? smooth(0.22 * H, 0.255 * H, ax) : 0;
  const thumbPocket = y >= 0.88 * H && y <= 1.04 * H && ax >= 0.18 * H ? smooth(-0.18 * H, -0.205 * H, z) : 0;
  const thumbInner = y >= 0.88 * H && y <= 1.04 * H && ax >= 0.212 * H ? smooth(-0.148 * H, -0.162 * H, z) : 0;
  const front = ax >= 0.18 * H ? smooth(-0.20 * H, -0.28 * H, z) : smooth(-0.26 * H, -0.34 * H, z);
  return Math.max(side, thumbPocket, thumbInner, front) * (1 - smooth(1.32 * H, 1.44 * H, y));
}

// Structured anatomical NASA White (1.0) vs NASA International Orange (0.0) suit panels.
function suitWhiteZone(x, y, z, J, H) {
  const ax = Math.abs(x);
  const a = J.arm?.[x < 0 ? "L" : "R"];
  if (a) {
    const dHand = Math.hypot(x - a.hand.x, y - a.hand.y, z - a.hand.z);
    if (dHand < 0.115 * H) return 1.0; // Clean white/light pressurized glove fingers
    if (dHand < 0.15 * H) return 0.0; // Orange wrist bearing ring
    const wArm = armWeight(x, y, z, J, H);
    if (wArm > 0.5) {
      const dSh = Math.hypot(x - a.shoulder.x, y - a.shoulder.y, z - a.shoulder.z);
      return smooth(a.dE + 0.02 * H, a.dE + 0.06 * H, dSh); // Orange upper arm -> White forearm sleeve
    }
  }
  // Upper chest / torso life-support harness: clean NASA White chest panel (smooth band avoids polygon sawteeth)
  const chestWhite =
    smooth(1.06 * H, 1.10 * H, y) * (1 - smooth(1.40 * H, 1.44 * H, y)) * (1 - smooth(0.18 * H, 0.22 * H, ax));
  // Lower leg / shin panels: NASA White above ankle ring and below knee pad
  const shinWhite =
    smooth(J.ankleY + 0.04 * H, J.ankleY + 0.065 * H, y) * (1 - smooth(J.kneeY - 0.055 * H, J.kneeY - 0.03 * H, y));
  return Math.max(chestWhite, shinWhite);
}

function normalise(list) {
  list.sort((a, b) => b[1] - a[1]);
  const top = list.slice(0, 4);
  const sum = top.reduce((s, e) => s + e[1], 0) || 1;
  return top.map(([b, w]) => [b, w / sum]);
}

/** One rigged astronaut in the scene. */
export function createAstronaut(rig, { hideHead = false, handRoll = null, handCurl = null } = {}) {
  const { parts, J, bootBounds } = rig;
  const isMarkIII = bootBounds?.kind === "mark-iii";
  const bones = BONES.map((name) => {
    const b = new THREE.Bone();
    b.name = name;
    return b;
  });
  const [
    root, pelvis, spine, chest, head, thighL, shinL, footL, thighR, shinR, footR, armL, armR, foreL, foreR, handL, handR,
  ] = bones;
  root.add(pelvis);
  pelvis.position.set(0, J.hipY, 0);
  pelvis.add(spine);
  spine.position.set(0, J.spineY - J.hipY, 0);
  spine.add(chest);
  chest.position.set(0, J.chestY - J.spineY, 0);
  chest.add(head);
  head.position.set(0, J.neckY - J.chestY, 0);
  chest.add(armL, armR);
  if (isMarkIII) {
    armL.position.set(J.arm.L.shoulder.x, J.arm.L.shoulder.y - J.chestY, J.arm.L.shoulder.z);
    armR.position.set(J.arm.R.shoulder.x, J.arm.R.shoulder.y - J.chestY, J.arm.R.shoulder.z);
  } else {
    armL.position.set(-J.shoulderX, J.shoulderY - J.chestY, 0);
    armR.position.set(J.shoulderX, J.shoulderY - J.chestY, 0);
  }
  armL.add(foreL);
  armR.add(foreR);
  foreL.position.copy(J.arm.L.elbow).sub(J.arm.L.shoulder);
  foreR.position.copy(J.arm.R.elbow).sub(J.arm.R.shoulder);
  foreL.add(handL);
  foreR.add(handR);
  handL.position.copy(J.arm.L.wrist).sub(J.arm.L.elbow);
  handR.position.copy(J.arm.R.wrist).sub(J.arm.R.elbow);
  for (const [thigh, shin, foot, x] of [
    [thighL, shinL, footL, J.legL],
    [thighR, shinR, footR, J.legR],
  ]) {
    pelvis.add(thigh);
    thigh.position.set(x, 0, 0);
    thigh.add(shin);
    shin.position.set(0, J.kneeY - J.hipY, 0);
    shin.add(foot);
    foot.position.set(0, J.ankleY - J.kneeY, 0);
  }

  root.updateMatrixWorld(true); // bind pose must be current before the inverses are taken
  const skeleton = new THREE.Skeleton(bones);
  const group = new THREE.Group();
  group.add(root);
  for (const p of parts) {
    const mesh = new THREE.SkinnedMesh(p.geometry, p.material);
    mesh.bind(skeleton, new THREE.Matrix4());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  if (hideHead) head.scale.setScalar(1e-4);

  const basePelvisY = J.hipY;
  // Rest pose for the arms: natural clearance beside the pressurized suit with palms facing
  // inward toward the body and thumbs oriented forward/up.
  const AX = new THREE.Vector3(1, 0, 0);
  const AZ = new THREE.Vector3(0, 0, 1);
  const armRest = {};
  const handRest = {};
  const mBind = new THREE.Matrix4();
  const mTarget = new THREE.Matrix4();
  const bX = new THREE.Vector3();
  const bY = new THREE.Vector3();
  const bZ = new THREE.Vector3();
  const tX = new THREE.Vector3();
  const tY = new THREE.Vector3();
  const tZ = new THREE.Vector3();
  const qSwingForeTmp = new THREE.Quaternion();
  const foreInUpper = new THREE.Vector3();
  for (const [side, sign] of [
    ["L", -1],
    ["R", 1],
  ]) {
    const a = J.arm[side];
    const up = a.elbow.clone().sub(a.shoulder).normalize();
    if (isMarkIII) {
      // Pure swing-only upper arm & forearm rest so the pleated elbow hinge stays untwisted
      // and arms hang straight beside the suit without sticking outward.
      const fore = a.wrist.clone().sub(a.elbow).normalize();
      const upTarget = new THREE.Vector3(sign * 0.48, -0.87, -0.11).normalize();
      const foreTarget = new THREE.Vector3(sign * 0.08, -0.972, -0.21).normalize();
      const qS = new THREE.Quaternion().setFromUnitVectors(up, upTarget);
      foreInUpper.copy(fore).applyQuaternion(qS);
      qSwingForeTmp.setFromUnitVectors(foreInUpper, foreTarget);
      const qE = qS.clone().invert().multiply(qSwingForeTmp).multiply(qS);
      const qWorldFore = qS.clone().multiply(qE);
      const elbowAxis = AX.clone().applyQuaternion(qWorldFore.clone().invert()).normalize();
      armRest[side] = { qS, qE, elbowAxis, sign };

      // Circular wrist bearing aligns sculpted Mark III glove with inward palm and forward thumb.
      bZ.copy(a.hand).sub(a.wrist).normalize();
      bY.set(-sign, 0, 0).addScaledVector(bZ, sign * bZ.x).normalize();
      bX.crossVectors(bY, bZ).normalize();
      bY.crossVectors(bZ, bX).normalize();
      mBind.makeBasis(bX, bY, bZ);

      tZ.copy(foreTarget);
      tY.set(0, 0.21, -0.975).normalize();
      tY.addScaledVector(tZ, -tY.dot(tZ)).normalize();
      tX.crossVectors(tY, tZ).normalize();
      tY.crossVectors(tZ, tX).normalize();
      mTarget.makeBasis(tX, tY, tZ);

      const qWorldHand = new THREE.Quaternion().setFromRotationMatrix(
        mTarget.clone().multiply(mBind.clone().transpose())
      );
      handRest[side] = qWorldFore.clone().invert().multiply(qWorldHand);
    } else {
      // Keep upper arm, forearm, and hand collinear straight beside the suit (no elbow bend angle).
      const upTarget = new THREE.Vector3(sign * 0.11, -0.994, -0.02).normalize();
      const qS = new THREE.Quaternion().setFromUnitVectors(up, upTarget);

      bZ.copy(a.hand).sub(a.elbow).normalize();
      bX.set(-sign, 0, 0).addScaledVector(bZ, sign * bZ.x).normalize();
      bY.crossVectors(bZ, bX).normalize();
      bX.crossVectors(bY, bZ).normalize();
      mBind.makeBasis(bX, bY, bZ);

      tZ.copy(upTarget);
      // +X aligns Left palm (+X inward) and Right back (+X outward => Right palm -X inward).
      tY.set(1, 0, 0).addScaledVector(tZ, -tZ.x).normalize();
      tX.crossVectors(tY, tZ).normalize();
      tY.crossVectors(tZ, tX).normalize();
      mTarget.makeBasis(tX, tY, tZ);

      const qWorldFore = new THREE.Quaternion().setFromRotationMatrix(
        mTarget.clone().multiply(mBind.clone().transpose())
      );
      const qE = qS.clone().invert().multiply(qWorldFore);
      const elbowAxis = AX.clone().applyQuaternion(qWorldFore.clone().invert()).normalize();
      armRest[side] = { qS, qE, elbowAxis, sign };
    }
  }
  const qSwing = new THREE.Quaternion();
  const qOut = new THREE.Quaternion();
  const qElbow = new THREE.Quaternion();
  const qWrist = new THREE.Quaternion();
  function poseArm(bone, foreBone, handBone, side, swing, out, elbowFlex = 0, wristFlex = 0) {
    const r = armRest[side];
    const safeOut = Math.max(-0.04, Math.min(1.15, (isMarkIII ? 0 : 0.005) + out));
    qSwing.setFromAxisAngle(AX, swing);
    qOut.setFromAxisAngle(AZ, r.sign * safeOut);
    bone.quaternion.copy(qOut).multiply(qSwing).multiply(r.qS);
    if (elbowFlex !== 0) {
      qElbow.setFromAxisAngle(r.elbowAxis, elbowFlex);
      foreBone.quaternion.copy(r.qE).multiply(qElbow);
    } else {
      foreBone.quaternion.copy(r.qE);
    }
    if (wristFlex !== 0) {
      qWrist.setFromAxisAngle(r.elbowAxis, wristFlex);
      handBone.quaternion.copy(qWrist).multiply(handRest[side]);
    } else {
      handBone.quaternion.copy(handRest[side]);
    }
  }

  if (!isMarkIII) {
    // Hands: the NASA mesh holds the glove palm-forward with spread fingers. A relaxed arm has the
    // palm turned in towards the thigh and the hand slightly curled, so the glove rolls about the
    // forearm axis (pronation) and bends a little at the wrist.
    const ROLL = handRoll ?? 1.35;
    const CURL = handCurl ?? 0.22;
    const qRoll = new THREE.Quaternion();
    const qCurl = new THREE.Quaternion();
    for (const [side, sign] of [
      ["L", -1],
      ["R", 1],
    ]) {
      const axis = J.arm[side].axis; // forearm axis in the bind pose (forearm bone frame = world axes)
      const across = new THREE.Vector3(0, 1, 0).cross(axis).normalize(); // hinge of the wrist
      qRoll.setFromAxisAngle(axis, sign * ROLL);
      qCurl.setFromAxisAngle(across, CURL);
      handRest[side] = new THREE.Quaternion().copy(qRoll).multiply(qCurl);
    }
  }
  poseArm(armL, foreL, handL, "L", 0, 0);
  poseArm(armR, foreR, handR, "R", 0, 0);
  // ACES gloves read small against the bulky sleeves; Mark III gloves are already full scale.
  const handScale = isMarkIII ? 1 : 1.16;
  handL.scale.setScalar(handScale);
  handR.scale.setScalar(handScale);
  let phase = 0;
  let idlePhase = 0;
  let airPhase = 0;
  let amount = 0; // 0 idle .. 1 walk .. ~1.7 sprint
  let air = 0; // 0 grounded .. 1 airborne
  let dirF = 1; // smoothed walking direction relative to the body: forward (+1) / back (-1)
  let dirS = 0; // and sideways: right (+1) / left (-1)
  let prevStanceL = 0;
  let prevStanceR = 0;
  let sSpeed = 0;
  let sLope = 0;
  let sCrouch = 0;
  let sLean = 0;
  let sBrake = 0;
  let sFootDyL = 0;
  let sFootDyR = 0;
  let sDyWeightL = 0;
  let sDyWeightR = 0;
  let hasFootDyL = false;
  let hasFootDyR = false;
  const sNormL = { x: 0, y: 1, z: 0 };
  const sNormR = { x: 0, y: 1, z: 0 };
  let hasNormL = false;
  let hasNormR = false;
  const L1 = Math.max(0.25, J.hipY - J.kneeY);
  const L2 = Math.max(0.22, J.kneeY - J.ankleY);
  const soleDrop = Math.max(0.05, J.ankleY);
  const footUp = new THREE.Vector3();
  const footFwd = new THREE.Vector3();
  const footX = new THREE.Vector3();
  const footZ = new THREE.Vector3();
  const footM = new THREE.Matrix4();
  const qWorld = new THREE.Quaternion();
  const qShin = new THREE.Quaternion();
  const qGait = new THREE.Quaternion();

  function clampUnit(v) {
    return Math.max(-1, Math.min(1, v));
  }

  function smoothNormal(targetObj, hasPrev, raw, k) {
    if (!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y) || !Number.isFinite(raw.z)) {
      if (!hasPrev) return false;
      targetObj.x += (0 - targetObj.x) * k;
      targetObj.y += (1 - targetObj.y) * k;
      targetObj.z += (0 - targetObj.z) * k;
    } else if (!hasPrev) {
      targetObj.x = raw.x;
      targetObj.y = raw.y;
      targetObj.z = raw.z;
    } else {
      targetObj.x += (raw.x - targetObj.x) * k;
      targetObj.y += (raw.y - targetObj.y) * k;
      targetObj.z += (raw.z - targetObj.z) * k;
    }
    const len = Math.hypot(targetObj.x, targetObj.y, targetObj.z) || 1;
    targetObj.x /= len;
    targetObj.y /= len;
    targetObj.z /= len;
    return true;
  }

  const softKneeCap = (k) => (k <= 0 ? 0 : 1.04 * Math.tanh(k / 1.04));

  const hipNeutral = isMarkIII ? 0.02 : HIP_NEUTRAL_RAD;
  const kneeNeutral = isMarkIII ? 0.03 : KNEE_NEUTRAL_RAD;

  /**
   * Two-bone solve. Positive hipX pitches the thigh toward -Z (forward).
   * Knee flex is applied as a negative shin rotation.x, which folds the foot back.
   * Uses terrain-relative height IK (dy vs flat ground) so fast running strides
   * never snap between stance-IK and swing gait at toe-off.
   */
  function solveLeg(gaitHip, gaitKnee, dy, stance, brake, ikWeight = 1, crouchAmount = 0) {
    const hipX = gaitHip + hipNeutral;
    const rawKnee = Math.max(0, gaitKnee + kneeNeutral + brake * 0.36);
    const blend = smooth(0, 0.62, stance) * ikWeight;
    if (!(blend > 0.005) || !Number.isFinite(dy)) return { hipX, knee: softKneeCap(rawKnee) };
    const zReach = -Math.sin(gaitHip) * Math.min(0.28, (L1 + L2) * 0.22);
    const maxD = L1 + L2 - 0.025;
    const minD = Math.abs(L1 - L2) + 0.03;
    const solveForV = (vertical) => {
      const dist = Math.min(maxD, Math.max(minD, Math.hypot(vertical, zReach)));
      const cosKnee = clampUnit((L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2));
      const cosHip = clampUnit((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist));
      return {
        knee: Math.PI - Math.acos(cosKnee),
        hip: Math.atan2(-zReach, vertical) + Math.acos(cosHip),
      };
    };
    const vFlat = Math.max(0.12, pelvis.position.y + crouchAmount - soleDrop);
    const vTerrain = Math.max(0.12, pelvis.position.y - (dy + soleDrop));
    const ik0 = solveForV(vFlat);
    const ikT = solveForV(vTerrain);
    const dHip = Math.max(-0.24, Math.min(0.36, ikT.hip - ik0.hip));
    const dKnee = Math.max(-0.28, Math.min(0.48, ikT.knee - ik0.knee));
    return {
      hipX: hipX + dHip * blend,
      knee: softKneeCap(Math.max(0, rawKnee + dKnee * blend)),
    };
  }

  function alignAnkle(footBone, shinBone, normal, stance) {
    const blend = smooth(0, 0.58, stance);
    if (!(blend > 0.005) || !normal) return;
    footUp.set(normal.x, normal.y, normal.z);
    if (footUp.lengthSq() < 1e-6) return;
    footUp.normalize();
    footFwd.set(0, 0, -1).applyQuaternion(group.quaternion);
    footFwd.addScaledVector(footUp, -footFwd.dot(footUp));
    if (footFwd.lengthSq() < 1e-6) footFwd.set(0, 0, -1);
    footFwd.normalize();
    footZ.copy(footFwd).negate();
    footX.crossVectors(footUp, footZ).normalize();
    footZ.crossVectors(footX, footUp).normalize();
    footM.makeBasis(footX, footUp, footZ);
    qWorld.setFromRotationMatrix(footM);
    shinBone.getWorldQuaternion(qShin);
    qGait.copy(footBone.quaternion);
    footBone.quaternion.copy(qShin.invert()).multiply(qWorld);
    qGait.slerp(footBone.quaternion, blend);
    footBone.quaternion.copy(qGait);
  }

  /**
   * @param dt seconds
   * @param moved metres travelled this frame along the ground
   * @param speed current ground speed (m/s)
   * @param airborne true while falling or jumping
   * @param dir optional walking direction in the body frame: { f: forward, s: right }
   * @param pose optional { crouch, lean, brake, footDyL, footDyR, normalL, normalR, onStrike }
   */
  function update(dt, moved, speed, airborne, dir, pose) {
    if (pose?.reset) {
      sSpeed = 0;
      amount = 0;
      dirF = 0;
      dirS = 0;
      sFootDyL = 0;
      sFootDyR = 0;
      sDyWeightL = 0;
      sDyWeightR = 0;
      hasFootDyL = false;
      hasFootDyR = false;
      hasNormL = false;
      hasNormR = false;
      prevStanceL = 0;
      prevStanceR = 0;
    }
    const safeDt = Math.min(0.05, Math.max(0, dt || 0.016));
    const damp = (rate) => 1 - Math.exp(-rate * safeDt);
    const rawSpeed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
    sSpeed += (rawSpeed - sSpeed) * damp(10.0);
    const lopeTarget = smooth(FROUDE_LOPE_MS - 0.18, FROUDE_LOPE_MS + 0.18, sSpeed);
    sLope += (lopeTarget - sLope) * damp(8.0);
    const stride = 1.4 + sLope * 1.25;
    if (!airborne) phase += (moved / stride) * Math.PI * 2;
    idlePhase += safeDt * 1.45;
    if (airborne || air > 0.01) airPhase += safeDt * 7.4;
    else airPhase = phase;
    const moveGate = smooth(0.03, 0.08, sSpeed);
    const target =
      moveGate *
      ((1 - sLope) * Math.min(1, sSpeed / 1.1) +
        sLope * Math.min(1.75, 1.15 + Math.max(0, sSpeed - FROUDE_LOPE_MS) * 0.22));
    amount += (target - amount) * damp(8.5);
    air += ((airborne ? 1 : 0) - air) * damp(airborne ? 7.5 : 11.0);
    if (dir && sSpeed > 0.05) {
      const k = damp(10.0);
      dirF += (dir.f - dirF) * k;
      dirS += (dir.s - dirS) * k;
    }

    const kPose = damp(16.0);
    sCrouch += ((pose?.crouch || 0) - sCrouch) * kPose;
    sLean += ((pose?.lean || 0) - sLean) * kPose;
    sBrake += ((pose?.brake || 0) - sBrake) * kPose;

    const kDy = damp(10.0);
    if (Number.isFinite(pose?.footDyL)) {
      const clampedL = Math.max(-0.28, Math.min(0.28, pose.footDyL));
      if (!hasFootDyL) {
        sFootDyL = clampedL;
        sDyWeightL = 1;
        hasFootDyL = true;
      } else {
        sFootDyL += (clampedL - sFootDyL) * kDy;
        sDyWeightL += (1 - sDyWeightL) * kDy;
      }
    } else if (hasFootDyL) {
      sDyWeightL += (0 - sDyWeightL) * kDy;
    }

    if (Number.isFinite(pose?.footDyR)) {
      const clampedR = Math.max(-0.28, Math.min(0.28, pose.footDyR));
      if (!hasFootDyR) {
        sFootDyR = clampedR;
        sDyWeightR = 1;
        hasFootDyR = true;
      } else {
        sFootDyR += (clampedR - sFootDyR) * kDy;
        sDyWeightR += (1 - sDyWeightR) * kDy;
      }
    } else if (hasFootDyR) {
      sDyWeightR += (0 - sDyWeightR) * kDy;
    }

    const kNorm = damp(10.0);
    hasNormL = smoothNormal(sNormL, hasNormL, pose?.normalL, kNorm);
    hasNormR = smoothNormal(sNormR, hasNormR, pose?.normalR, kNorm);

    const a = amount;
    const fw = dirF; // forward share of the step (negative = walking backwards)
    const sd = dirS; // sideways share (positive = to the right)
    const side = Math.abs(sd);
    const idleBlend = Math.max(0, 1 - a) * (1 - air);
    const breathe = Math.sin(idlePhase * (1.55 / 1.45));
    const sway = idleBlend * Math.sin(idlePhase * 0.45);
    const breath = idleBlend * (0.012 * breathe + 0.004 * Math.sin(idlePhase * 2.14));
    const legPose = (p) => {
      const s = Math.sin(p) * fw;
      // Soften backward trailing extension while overlapping push-off into knee pick-up
      const hip = a * (0.35 - 0.04 * sLope) * (s + 0.1 * sLope * (1 - Math.cos(2 * p)) * fw);
      const liftEps = 0.16 + 0.16 * sLope;
      const c = Math.cos(p + 0.18 * sLope * fw);
      const cMax = 0.5 * (1 + Math.hypot(1, liftEps));
      const swingLift = (0.5 * (c + Math.hypot(c, liftEps)) / cMax) ** 2;
      const knee = a * ((isMarkIII ? 0.03 : 0.05) + (0.64 + 0.28 * sLope) * (1 - 0.25 * side) * swingLift);
      const rawAnkle = -(hip - knee * 0.78) * 0.56;
      return { hip, knee, ankle: 0.54 * Math.tanh(rawAnkle / 0.54) };
    };
    const L = legPose(phase);
    const R = legPose(phase + Math.PI);
    const reach = a * 0.26 * side;
    const out = (p) => 0.5 + 0.5 * Math.sin(p);
    const leadR = sd > 0;
    const abdR = reach * (leadR ? out(phase + Math.PI) : 0.35 * out(phase + Math.PI));
    const abdL = reach * (leadR ? 0.35 * out(phase) : out(phase));

    // Mid-air low-g dynamic leg kick & arm wing-flap so limbs swing fluidly back and forth instead of freezing.
    const airLegSwing = air * 0.44 * Math.sin(airPhase);
    const airKneeL = air * (0.46 + 0.26 * Math.max(0, Math.cos(airPhase)));
    const airKneeR = air * (0.46 + 0.26 * Math.max(0, -Math.cos(airPhase)));
    const crouch = sCrouch;
    const lean = sLean;
    const brake = sBrake;
    const stanceOf = (knee) => (1 - air) * (1 - smooth(0.04, 0.86, knee));
    const sL = stanceOf(L.knee);
    const sR = stanceOf(R.knee);
    pelvis.position.y =
      basePelvisY -
      a * 0.02 * (Math.sin(phase) ** 2) -
      air * (0.04 + 0.02 * Math.sin(airPhase * 2)) -
      crouch -
      brake * 0.03 +
      breath * 0.15;
    const solvedL = solveLeg(
      L.hip * (1 - air) + airLegSwing,
      L.knee * (1 - air) + airKneeL,
      hasFootDyL ? sFootDyL : undefined,
      sL,
      brake,
      sDyWeightL,
      crouch
    );
    const solvedR = solveLeg(
      R.hip * (1 - air) - airLegSwing,
      R.knee * (1 - air) + airKneeR,
      hasFootDyR ? sFootDyR : undefined,
      sR,
      brake,
      sDyWeightR,
      crouch
    );
    thighL.rotation.set(solvedL.hipX, 0, -abdL - air * 0.07);
    shinL.rotation.set(-solvedL.knee, 0, 0);
    footL.rotation.set(L.ankle * (1 - sL) * (1 - air) - airLegSwing * 0.45, 0, abdL * 0.6);
    thighR.rotation.set(solvedR.hipX, 0, abdR + air * 0.07);
    shinR.rotation.set(-solvedR.knee, 0, 0);
    footR.rotation.set(R.ankle * (1 - sR) * (1 - air) + airLegSwing * 0.45, 0, -abdR * 0.6);

    pelvis.rotation.y = a * 0.075 * Math.sin(phase) * Math.abs(fw);
    pelvis.rotation.z = a * 0.025 * Math.cos(phase) - sd * a * 0.04 - sway * 0.006;
    spine.rotation.y = -a * 0.06 * Math.sin(phase);
    spine.rotation.x = a * (0.04 + 0.10 * sLope) + lean + breath * 0.45;
    spine.rotation.z = sway * 0.008;
    chest.rotation.y = -a * 0.038 * Math.sin(phase);
    chest.rotation.x = breath;

    const fSign = Math.tanh(fw * 4);
    const swingAmp = isMarkIII ? a * (0.28 + 0.18 * sLope) : Math.min(0.24, a * (0.11 + 0.04 * sLope));
    const groundSwing = swingAmp * Math.abs(fw) * (1 - air);
    const gaitSwingL = -groundSwing * Math.sin(phase) * fSign;
    const gaitSwingR = groundSwing * Math.sin(phase) * fSign;
    const fwdBias = isMarkIII ? a * (0.035 + 0.05 * sLope) * Math.abs(fw) * (1 - air) : 0;
    const elbowGaitL = isMarkIII
      ? Math.max(0, gaitSwingL * 0.48) + a * (0.06 + 0.14 * sLope) * (1 - air) + idleBlend * 0.015 * breathe
      : 0;
    const elbowGaitR = isMarkIII
      ? Math.max(0, gaitSwingR * 0.48) + a * (0.06 + 0.14 * sLope) * (1 - air) + idleBlend * 0.015 * breathe
      : 0;
    const wristFollowL = isMarkIII
      ? idleBlend * 0.02 * breathe - groundSwing * 0.14 * Math.sin(phase - 0.35) * fSign
      : 0;
    const wristFollowR = isMarkIII
      ? idleBlend * 0.02 * breathe + groundSwing * 0.14 * Math.sin(phase - 0.35) * fSign
      : 0;
    const flapSwingL = air * (0.12 + 0.28 * Math.sin(airPhase));
    const flapSwingR = air * (0.12 + 0.28 * Math.sin(airPhase + Math.PI * 0.15));
    const flapOut = air * (0.18 + 0.18 * (0.5 - 0.5 * Math.cos(airPhase)));
    const flapElbow = air * (0.10 + 0.08 * Math.sin(airPhase));
    const sideOut = isMarkIII ? a * (0.012 + 0.018 * sLope + side * 0.06) : a * side * 0.08;
    const idleOut = isMarkIII ? idleBlend * 0.004 * (0.5 + 0.5 * breathe) : 0;

    poseArm(
      armL,
      foreL,
      handL,
      "L",
      gaitSwingL + fwdBias + flapSwingL + idleBlend * 0.01 * breathe,
      sideOut + idleOut + flapOut,
      elbowGaitL + flapElbow,
      wristFollowL
    );
    poseArm(
      armR,
      foreR,
      handR,
      "R",
      gaitSwingR + fwdBias + flapSwingR + idleBlend * 0.01 * breathe,
      sideOut + idleOut + flapOut,
      elbowGaitR + flapElbow,
      wristFollowR
    );
    head.rotation.y = a * 0.02 * Math.sin(phase) + sway * 0.015;

    group.updateWorldMatrix(true, true);
    alignAnkle(footL, shinL, hasNormL ? sNormL : null, sL);
    alignAnkle(footR, shinR, hasNormR ? sNormR : null, sR);
    if (!airborne && pose?.onStrike) {
      if (prevStanceL < 0.55 && sL >= 0.55) pose.onStrike("L");
      if (prevStanceR < 0.55 && sR >= 0.55) pose.onStrike("R");
    }
    prevStanceL = sL;
    prevStanceR = sR;
  }

  return {
    group,
    bones: { root, pelvis, spine, chest, head, thighL, shinL, footL, thighR, shinR, footR, armL, armR, foreL, foreR, handL, handR },
    update,
    /** Show the helmet for a 3rd-person camera; hide it for the helmet (1st-person) camera. */
    setHeadVisible(v) {
      head.scale.setScalar(v ? 1 : 1e-4);
    },
    get phase() { return phase; },
    get amount() { return amount; },
  };
}
