/**
 * Procedural rig and walk cycle for a static NASA 3D Resources spacesuit (`web/hud/astronaut-rig.js`).
 *
 * Character & animation rig ported from the `developermenu` NASA Mark III version:
 *  - preserves authentic NASA spacesuit geometry & textures (FrontSide PBR without canvas recolor hacks),
 *  - finds the leg columns in a slice just above the boots and centres the suit on them,
 *  - places hip / knee / ankle joints at standard proportions of a 1.80 m body,
 *  - writes skin weights from each vertex position (legs, pelvis, spine, chest, head, and the two
 *    arms on shoulder joints; pressurised suit arm rest pose with bent elbows ahead of the hips),
 *  - drives a distance-driven gait cycle (walk, lope, strafe side-steps, jump tuck, opposite arm swing,
 *    and heel-strike callbacks for footsteps/dust).
 * Forward is -Z (the suit's hands and visor face -Z), right is +X.
 */

import * as THREE from "three";

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
    m.side = THREE.FrontSide;
    m.roughness = Math.max(m.roughness ?? 0.8, 0.55);
    // Suit fabric and painted metal: the export's high metalness renders black without reflections.
    m.metalness = Math.min(m.metalness ?? 0, 0.08);
    parts.push({ geometry: g, material: m });
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
  for (const p of parts) {
    p.geometry.translate(-cx, 0, -cz);
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
  const J = {
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

  // Skin weights from position.
  for (const p of parts) {
    const pos = p.geometry.attributes.position;
    const idx = new Uint16Array(pos.count * 4);
    const wts = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const list = weightsFor(v.x, v.y, v.z, J, H);
      for (let k = 0; k < 4; k++) {
        idx[i * 4 + k] = list[k] ? list[k][0] : 0;
        wts[i * 4 + k] = list[k] ? list[k][1] : 0;
      }
    }
    p.geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(idx, 4));
    p.geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(wts, 4));
  }

  // Measure boot sole footprint from the loaded suit mesh for matching boot tread decals.
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
  const bootWidthM = Number.isFinite(maxBootX - minBootX) ? Math.max(0.1, Math.min(0.19, maxBootX - minBootX)) : 0.14;
  const kind = /aces/i.test(url) ? "aces" : /mark/i.test(url) ? "mark-iii" : "eva";

  return { parts, J, H, bootBounds: { lengthM: bootLengthM, widthM: bootWidthM, kind } };
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

  // Arms: upper arm on the shoulder joint, forearm and glove on the elbow joint.
  const wArm = armWeight(x, y, z, J, H);
  if (wArm > 0) {
    const a = J.arm?.[x < 0 ? "L" : "R"];
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
  // Legs: soft left/right split near the crotch, soft pelvis blend near the hips.
  const tR = smooth(-0.04 * H, 0.04 * H, x);
  const tPel = smooth(J.hipY - 0.2 * H, J.hipY + 0.06 * H, y);
  const leg = (thigh, shin, foot, share) => {
    if (share <= 0) return;
    const tKnee = smooth(J.kneeY - 0.05 * H, J.kneeY + 0.05 * H, y); // 1 = thigh
    const tAnkle = smooth(J.ankleY - 0.02 * H, J.ankleY + 0.04 * H, y); // 1 = shin
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

// Arms: outboard of the torso (upper arm, elbow) or in front of it (forearm, glove).
function armWeight(x, y, z, J, H) {
  if (y <= 0.7 * H || y >= 1.47 * H) return 0;
  if (y > J.neckY && Math.abs(x) < 0.26 * H && z > -0.3 * H) return 0; // helmet
  // below 1.0 m only the gloves reach this far forward (thighs stay behind z = -0.2 m)
  const front = smooth(-0.19 * H, -0.29 * H, z) * (y < 1.0 * H ? smooth(-0.21 * H, -0.27 * H, z) : 1);
  // wide blend at the shoulder bearing so turning the arm spreads the stretch over more of the suit
  const side = y >= 1.0 * H ? smooth(0.23 * H, 0.36 * H, Math.abs(x)) : 0;
  return Math.max(front, side) * (1 - smooth(1.28 * H, 1.47 * H, y));
}

function normalise(list) {
  list.sort((a, b) => b[1] - a[1]);
  const top = list.slice(0, 4);
  const sum = top.reduce((s, e) => s + e[1], 0) || 1;
  return top.map(([b, w]) => [b, w / sum]);
}

/** One rigged astronaut in the scene. */
export function createAstronaut(rig, { hideHead = false, handRoll = null, handCurl = null } = {}) {
  const { parts, J } = rig;
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
  armL.position.set(-J.shoulderX, J.shoulderY - J.chestY, 0);
  armR.position.set(J.shoulderX, J.shoulderY - J.chestY, 0);
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
  // Rest pose for the arms. The model reaches forward with bent elbows; turn each upper arm to hang
  // beside the suit (a little out, for the bulky torso) and each forearm forward-down with the
  // elbow bent about 35 degrees, the way suited crews carry their hands.
  const armRest = {};
  for (const [side, sign] of [
    ["L", -1],
    ["R", 1],
  ]) {
    const a = J.arm[side];
    const up = a.elbow.clone().sub(a.shoulder).normalize();
    const fore = a.hand.clone().sub(a.elbow).normalize();
    // pressurised suits hold the upper arms a little forward and out, hands in front of the hips
    const upTarget = new THREE.Vector3(sign * 0.24, -1, -0.34).normalize();
    const foreTarget = new THREE.Vector3(sign * 0.04, -0.62, -0.78).normalize();
    const qS = new THREE.Quaternion().setFromUnitVectors(up, upTarget);
    const foreInUpper = foreTarget.clone().applyQuaternion(qS.clone().invert());
    const qE = new THREE.Quaternion().setFromUnitVectors(fore, foreInUpper);
    armRest[side] = { qS, qE, sign };
  }
  const qSwing = new THREE.Quaternion();
  const qOut = new THREE.Quaternion();
  const qElbow = new THREE.Quaternion();
  const AX = new THREE.Vector3(1, 0, 0);
  const AZ = new THREE.Vector3(0, 0, 1);
  function poseArm(bone, foreBone, side, swing, out, elbowFlex = 0) {
    const r = armRest[side];
    qSwing.setFromAxisAngle(AX, swing);
    qOut.setFromAxisAngle(AZ, -r.sign * out);
    bone.quaternion.copy(qOut).multiply(qSwing).multiply(r.qS);
    if (elbowFlex !== 0) {
      qElbow.setFromAxisAngle(AX, elbowFlex);
      foreBone.quaternion.copy(r.qE).multiply(qElbow);
    } else {
      foreBone.quaternion.copy(r.qE);
    }
  }
  poseArm(armL, foreL, "L", 0, 0);
  poseArm(armR, foreR, "R", 0, 0);

  // Hands: the NASA mesh holds the glove palm-forward with spread fingers. A relaxed arm has the
  // palm turned in towards the thigh and the hand slightly curled, so the glove rolls about the
  // forearm axis (pronation) and bends a little at the wrist.
  const ROLL = handRoll ?? 1.35;
  const CURL = handCurl ?? 0.22;
  const qRoll = new THREE.Quaternion();
  const qCurl = new THREE.Quaternion();
  const handRest = {};
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
  handL.quaternion.copy(handRest.L);
  handR.quaternion.copy(handRest.R);
  // gloves read small against the bulky sleeves: a touch larger, about the wrist
  handL.scale.setScalar(1.16);
  handR.scale.setScalar(1.16);
  let phase = 0;
  let amount = 0; // 0 idle .. 1 walk .. ~1.5 run
  let air = 0; // 0 grounded .. 1 airborne
  let dirF = 1; // smoothed walking direction relative to the body: forward (+1) / back (-1)
  let dirS = 0; // and sideways: right (+1) / left (-1)

  /**
   * @param dt seconds
   * @param moved metres travelled this frame along the ground
   * @param speed current ground speed (m/s)
   * @param airborne true while falling or jumping
   * @param dir optional walking direction in the body frame: { f: forward, s: right }, unit length
   * @param extra optional extra hook object (`onStrike` for bootstep audio/decals)
   */
  function update(dt, moved, speed, airborne, dir, extra = null) {
    if (extra?.reset) {
      amount = 0;
      air = 0;
      dirF = 1;
      dirS = 0;
    }
    const running = speed > 1.9;
    const stride = running ? 2.1 : 1.5; // metres per full gait cycle (two steps)
    const prevPhase = phase;
    if (!airborne) phase += (moved / stride) * Math.PI * 2;
    const target = speed < 0.05 ? 0 : running ? 1.45 : Math.min(1, speed / 1.3);
    amount += (target - amount) * Math.min(1, dt * 6);
    air += ((airborne ? 1 : 0) - air) * Math.min(1, dt * 8);
    if (dir && speed > 0.05) {
      const k = Math.min(1, dt * 8);
      dirF += (dir.f - dirF) * k;
      dirS += (dir.s - dirS) * k;
    }

    if (extra?.onStrike && !airborne && moved > 1e-4 && amount > 0.08) {
      const prevCos = Math.cos(prevPhase);
      const curCos = Math.cos(phase);
      if (prevCos > 0 && curCos <= 0) extra.onStrike("L");
      if (prevCos < 0 && curCos >= 0) extra.onStrike("R");
    }

    const a = amount;
    const fw = dirF; // forward share of the step (negative = walking backwards)
    const sd = dirS; // sideways share (positive = to the right)
    const side = Math.abs(sd);

    const legPose = (p) => {
      const hip = a * 0.33 * Math.sin(p) * fw; // fore-aft swing
      // knees lift the swinging foot in any direction; side steps use a shorter, higher lift
      const knee = a * (0.05 + (running ? 0.85 : 0.6) * (1 - 0.25 * side) * Math.max(0, Math.cos(p)) ** 2);
      const ankle = -(hip - knee) * 0.7;
      return { hip, knee, ankle };
    };
    const L = legPose(phase);
    const R = legPose(phase + Math.PI);
    // Side-stepping: the leading leg reaches out, the trailing leg closes in after it; feet never cross.
    const reach = a * 0.26 * side;
    const out = (p) => 0.5 + 0.5 * Math.sin(p); // 0..1 over the cycle
    const leadR = sd > 0; // moving right: right leg leads
    const abdR = reach * (leadR ? out(phase + Math.PI) : 0.35 * out(phase + Math.PI));
    const abdL = reach * (leadR ? 0.35 * out(phase) : out(phase));
    const tuck = air * 0.45;
    thighL.rotation.x = L.hip + tuck * 0.6;
    thighL.rotation.z = -abdL; // out to the left
    shinL.rotation.x = -(L.knee + tuck);
    footL.rotation.x = L.ankle + tuck * 0.3;
    footL.rotation.z = abdL * 0.6; // keep the sole flat
    thighR.rotation.x = R.hip + tuck * 0.4;
    thighR.rotation.z = abdR; // out to the right
    shinR.rotation.x = -(R.knee + tuck * 0.8);
    footR.rotation.x = R.ankle + tuck * 0.3;
    footR.rotation.z = -abdR * 0.6;

    pelvis.position.y = basePelvisY - a * 0.022 * Math.abs(Math.sin(phase)) - air * 0.03;
    pelvis.rotation.y = a * 0.07 * Math.sin(phase) * Math.abs(fw);
    // weight shifts over the standing leg; leaning slightly into a side step
    pelvis.rotation.z = a * 0.025 * Math.cos(phase) - sd * a * 0.045;
    spine.rotation.y = -a * 0.05 * Math.sin(phase);
    spine.rotation.x = a * (running ? 0.14 : 0.05);
    chest.rotation.y = -a * 0.03 * Math.sin(phase);
    // arms swing opposite to the legs (more when running); forward and out for balance in the air
    const swing = a * (running ? 0.32 : 0.2) * Math.abs(fw); // little arm swing when side-stepping
    const balance = a * side * 0.12; // arms ease out a little for balance on a side step
    const armPhase = Math.sin(phase) * Math.sign(fw || 1);
    poseArm(armL, foreL, "L", -swing * armPhase + air * 0.3, air * 0.25 + balance);
    poseArm(armR, foreR, "R", swing * armPhase + air * 0.3, air * 0.25 + balance);
    head.rotation.y = a * 0.025 * Math.sin(phase);
  }

  return {
    group,
    bones: { root, pelvis, spine, chest, head, thighL, shinL, footL, thighR, shinR, footR, armL, armR, foreL, foreR, handL, handR },
    update,
    get phase() {
      return phase;
    },
    get amount() {
      return amount;
    },
  };
}
