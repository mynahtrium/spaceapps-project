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

  return { parts, J, H };
}

function weightsFor(x, y, z, J, H) {
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

  // Arms: outboard of the torso (upper arm, elbow) or in front of it (forearm, glove).
  let wArm = 0;
  if (y > 0.7 * H && y < 1.47 * H) {
    // below 1.0 m only the gloves reach this far forward (thighs stay behind z = -0.2 m)
    const front = smooth(-0.19 * H, -0.29 * H, z) * (y < 1.0 * H ? smooth(-0.21 * H, -0.27 * H, z) : 1);
    const side = y >= 1.0 * H ? smooth(0.27 * H, 0.33 * H, ax) : 0;
    wArm = Math.max(front, side) * (1 - smooth(1.37 * H, 1.47 * H, y));
  }
  const arm = x < 0 ? B.armL : B.armR;
  if (wArm >= 0.999) {
    add(arm, 1);
    return out;
  }
  const rest = 1 - wArm;
  add(arm, wArm);

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

function normalise(list) {
  list.sort((a, b) => b[1] - a[1]);
  const top = list.slice(0, 4);
  const sum = top.reduce((s, e) => s + e[1], 0) || 1;
  return top.map(([b, w]) => [b, w / sum]);
}

/** One rigged astronaut in the scene. */
export function createAstronaut(rig, { hideHead = false } = {}) {
  const { parts, J } = rig;
  const bones = BONES.map((name) => {
    const b = new THREE.Bone();
    b.name = name;
    return b;
  });
  const [root, pelvis, spine, chest, head, thighL, shinL, footL, thighR, shinR, footR, armL, armR] = bones;
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
  const ARM_REST = -0.75; // lower the model's forward-reaching arms to a relaxed carry
  armL.rotation.x = ARM_REST;
  armR.rotation.x = ARM_REST;
  let phase = 0;
  let amount = 0; // 0 idle .. 1 walk .. ~1.5 run
  let air = 0; // 0 grounded .. 1 airborne

  /**
   * @param dt seconds
   * @param moved metres travelled this frame along the ground
   * @param speed current ground speed (m/s)
   * @param airborne true while falling or jumping
   */
  function update(dt, moved, speed, airborne) {
    const running = speed > 1.9;
    const stride = running ? 2.1 : 1.5; // metres per full gait cycle (two steps)
    if (!airborne) phase += (moved / stride) * Math.PI * 2;
    const target = speed < 0.05 ? 0 : running ? 1.45 : Math.min(1, speed / 1.3);
    amount += (target - amount) * Math.min(1, dt * 6);
    air += ((airborne ? 1 : 0) - air) * Math.min(1, dt * 8);

    const a = amount;
    const legPose = (p) => {
      const hip = a * 0.33 * Math.sin(p);
      const knee = a * (0.05 + (running ? 0.85 : 0.6) * Math.max(0, Math.cos(p)) ** 2);
      return { hip, knee, ankle: -(hip - knee) * 0.7 };
    };
    const L = legPose(phase);
    const R = legPose(phase + Math.PI);
    const tuck = air * 0.45;
    thighL.rotation.x = L.hip + tuck * 0.6;
    shinL.rotation.x = -(L.knee + tuck);
    footL.rotation.x = L.ankle + tuck * 0.3;
    thighR.rotation.x = R.hip + tuck * 0.4;
    shinR.rotation.x = -(R.knee + tuck * 0.8);
    footR.rotation.x = R.ankle + tuck * 0.3;

    pelvis.position.y = basePelvisY - a * 0.022 * Math.abs(Math.sin(phase)) - air * 0.03;
    pelvis.rotation.y = a * 0.07 * Math.sin(phase);
    pelvis.rotation.z = a * 0.025 * Math.cos(phase);
    spine.rotation.y = -a * 0.05 * Math.sin(phase);
    spine.rotation.x = a * (running ? 0.12 : 0.04);
    chest.rotation.y = -a * 0.03 * Math.sin(phase);
    // arms swing opposite to the legs; tucked up a little in the air
    armL.rotation.x = ARM_REST - a * 0.2 * Math.sin(phase) + air * 0.35;
    armR.rotation.x = ARM_REST + a * 0.2 * Math.sin(phase) + air * 0.35;
    // bring the arms in towards the hips (the model's right arm sits wider); out for balance in the air
    armL.rotation.z = 0.06 - air * 0.15;
    armR.rotation.z = -0.16 + air * 0.15;
    head.rotation.y = a * 0.02 * Math.sin(phase);
  }

  return { group, bones: { root, pelvis, spine, chest, head }, update, get phase() { return phase; }, get amount() { return amount; } };
}
