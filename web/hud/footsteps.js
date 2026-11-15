/**
 * Suit-borne footfalls, a quiet Mars-air scuff, boot treads, and low-g dust.
 * No sample files. Silent while the tab is hidden.
 */

import { attenuationDbPerM, lowPassCutoffHz } from "../physics/MarsAcoustics.js";

const DUSTY = new Set(["SIDERITE_HOLLOW", "AEOLIAN_RIPPLE", "STEEP_SCREE"]);
const N_DECAL = 256;
const N_DUST = 48;

export function createFootsteps(THREE, scene) {
  let ctx = null;
  let enabled = true;

  let suitProfile = { lengthM: 0.32, widthM: 0.19, kind: "mark-iii" };

  function paintBootTread(kind) {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 256;
    const g = c.getContext("2d");
    g.clearRect(0, 0, 128, 256);

    // Draw an anatomically contoured wide boot sole silhouette (toe at top y=10, heel at y=246)
    const drawSolePath = () => {
      g.beginPath();
      g.moveTo(64, 10);
      g.bezierCurveTo(106, 10, 120, 44, 118, 90); // outer forefoot
      g.bezierCurveTo(116, 124, 102, 144, 104, 172); // arch waist (outer)
      g.bezierCurveTo(106, 206, 110, 238, 68, 246); // outer heel
      g.bezierCurveTo(22, 246, 16, 208, 20, 172); // inner heel
      g.bezierCurveTo(22, 142, 16, 122, 10, 88); // inner arch/forefoot
      g.bezierCurveTo(8, 42, 24, 10, 64, 10);
      g.closePath();
    };

    drawSolePath();
    g.fillStyle = "rgba(0,0,0,0.44)";
    g.fill();
    g.save();
    drawSolePath();
    g.clip();

    if (kind === "aces") {
      // NASA ACES flight-boot sole: sleek chevron ridges & lighter perimeter border
      g.strokeStyle = "rgba(0,0,0,0.82)";
      g.lineWidth = 4;
      for (let y = 26; y < 236; y += 16) {
        g.beginPath();
        g.moveTo(10, y + 6);
        g.lineTo(64, y);
        g.lineTo(118, y + 6);
        g.stroke();
      }
      g.strokeStyle = "rgba(0,0,0,0.7)";
      g.lineWidth = 5;
      drawSolePath();
      g.stroke();
    } else {
      // NASA Mark III / planetary EVA boot: thick horizontal Apollo-style traction bars + heel cup
      g.fillStyle = "rgba(0,0,0,0.84)";
      for (let y = 24; y < 142; y += 18) {
        g.fillRect(8, y, 112, 9);
      }
      for (let y = 166; y < 232; y += 18) {
        g.fillRect(14, y, 100, 10);
      }
      g.strokeStyle = "rgba(0,0,0,0.86)";
      g.lineWidth = 7;
      drawSolePath();
      g.stroke();
    }
    g.restore();

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  let tread = paintBootTread(suitProfile.kind);

  const decalGeom = new THREE.PlaneGeometry(1, 1);
  decalGeom.rotateX(-Math.PI / 2);
  const decalMat = new THREE.MeshBasicMaterial({
    map: tread,
    transparent: true,
    opacity: 0.74,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });

  function setSuitProfile(profile) {
    if (!profile) return;
    const rawW = Number(profile.widthM) || 0.14;
    suitProfile = {
      lengthM: Math.max(0.22, Math.min(0.45, Number(profile.lengthM) || 0.32)),
      widthM: Math.max(0.175, Math.min(0.27, rawW * 1.45)),
      kind: profile.kind || "mark-iii",
    };
    const nextTex = paintBootTread(suitProfile.kind);
    if (decalMat.map) decalMat.map.dispose();
    decalMat.map = nextTex;
    decalMat.needsUpdate = true;
    tread = nextTex;
  }
  const decals = new THREE.InstancedMesh(decalGeom, decalMat, N_DECAL);
  decals.frustumCulled = false;
  decals.count = N_DECAL;
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < N_DECAL; i++) decals.setMatrixAt(i, hidden);
  scene.add(decals);

  const dustGeom = new THREE.SphereGeometry(0.035, 5, 4);
  const dustMat = new THREE.MeshBasicMaterial({ color: 0xc4a07a, transparent: true, opacity: 0.45, depthWrite: false });
  const dustMesh = new THREE.InstancedMesh(dustGeom, dustMat, N_DUST);
  dustMesh.frustumCulled = false;
  dustMesh.renderOrder = 2;
  for (let i = 0; i < N_DUST; i++) dustMesh.setMatrixAt(i, hidden);
  scene.add(dustMesh);

  const motes = Array.from({ length: N_DUST }, () => ({
    life: 0,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
  }));
  const stamped = Array.from({ length: N_DECAL }, () => ({ active: false, x: 0, z: 0, yaw: 0, side: "L" }));
  let decalCursor = 0;
  let dustCursor = 0;
  const dummy = new THREE.Object3D();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const qTilt = new THREE.Quaternion();
  const qYaw = new THREE.Quaternion();
  const nrm = new THREE.Vector3();

  function audio() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  }

  function play(side, faciesId) {
    if (!enabled || document.hidden) return;
    const ac = audio();
    if (!ac) return;
    if (ac.state === "suspended") ac.resume();
    const now = ac.currentTime;

    // Soft cushioned suit-borne thud with a smooth attack so there is no click.
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const jitter = (Math.random() - 0.5) * 3;
    osc.type = "sine";
    osc.frequency.setValueAtTime((side === "L" ? 54 : 60) + jitter, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.11);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.055, now + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.15);

    // Gentle, muffled regolith brush (warmed noise + smooth bell envelope).
    const dusty = DUSTY.has(faciesId);
    const dur = dusty ? 0.18 : 0.09;
    const rate = ac.sampleRate;
    const buffer = ac.createBuffer(1, Math.max(1, Math.floor(rate * dur)), rate);
    const data = buffer.getChannelData(0);
    let smooth = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      const attack = Math.min(1, t / 0.22);
      const decay = 1 - t;
      const env = attack * decay * decay;
      smooth = smooth * 0.78 + (Math.random() * 2 - 1) * 0.22;
      data[i] = smooth * env;
    }
    const src = ac.createBufferSource();
    src.buffer = buffer;
    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.5;
    const cutoff = lowPassCutoffHz(dusty ? 1.1 : 2.4);
    filter.frequency.value = dusty ? Math.min(680, cutoff) : Math.min(340, cutoff);
    const db = attenuationDbPerM(filter.frequency.value) * 1.6;
    const att = Math.pow(10, -db / 20);
    const sg = ac.createGain();
    sg.gain.value = (dusty ? 0.045 : 0.018) * Math.min(1, att * 5);
    src.connect(filter).connect(sg).connect(ac.destination);
    src.start(now);
  }

  function applyDecalMatrix(idx, x, y, z, normal, yaw, side) {
    nrm.set(normal?.x ?? 0, normal?.y ?? 1, normal?.z ?? 0);
    if (nrm.lengthSq() < 1e-6) nrm.set(0, 1, 0);
    nrm.normalize();
    qTilt.setFromUnitVectors(yAxis, nrm);
    qYaw.setFromAxisAngle(yAxis, yaw || 0);
    dummy.position.set(x, y + 0.012, z);
    dummy.quaternion.copy(qTilt).multiply(qYaw);
    const sx = side === "R" ? -suitProfile.widthM : suitProfile.widthM;
    dummy.scale.set(sx, 1, suitProfile.lengthM);
    dummy.updateMatrix();
    decals.setMatrixAt(idx, dummy.matrix);
  }

  function stamp(x, y, z, normal, yaw, faciesId, side = "L") {
    if (!enabled) return;
    applyDecalMatrix(decalCursor, x, y, z, normal, yaw, side);
    const slot = stamped[decalCursor];
    slot.active = true;
    slot.x = x;
    slot.z = z;
    slot.yaw = yaw || 0;
    slot.side = side;
    decalCursor = (decalCursor + 1) % N_DECAL;
    decals.instanceMatrix.needsUpdate = true;

    if (!DUSTY.has(faciesId)) return;
    for (let k = 0; k < 4; k++) {
      const m = motes[dustCursor];
      m.life = 0.7 + Math.random() * 0.5;
      m.x = x + (Math.random() - 0.5) * 0.08;
      m.y = y + 0.04;
      m.z = z + (Math.random() - 0.5) * 0.08;
      m.vx = (Math.random() - 0.5) * 0.55;
      m.vy = 0.55 + Math.random() * 0.9;
      m.vz = (Math.random() - 0.5) * 0.55;
      dustCursor = (dustCursor + 1) % N_DUST;
    }
  }

  function update(dt, g = 3.72) {
    if (!enabled) return;
    const step = Math.min(0.05, dt);
    for (let i = 0; i < N_DUST; i++) {
      const m = motes[i];
      if (m.life <= 0) {
        dustMesh.setMatrixAt(i, hidden);
        continue;
      }
      m.life -= step;
      m.vy -= g * step;
      m.x += m.vx * step;
      m.y += m.vy * step;
      m.z += m.vz * step;
      const s = Math.max(0, m.life) * 0.8;
      dummy.position.set(m.x, m.y, m.z);
      dummy.quaternion.identity();
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      dustMesh.setMatrixAt(i, dummy.matrix);
    }
    dustMesh.instanceMatrix.needsUpdate = true;
  }

  function clear() {
    for (let i = 0; i < N_DECAL; i++) {
      stamped[i].active = false;
      decals.setMatrixAt(i, hidden);
    }
    decalCursor = 0;
    decals.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < N_DUST; i++) {
      motes[i].life = 0;
      dustMesh.setMatrixAt(i, hidden);
    }
    dustCursor = 0;
    dustMesh.instanceMatrix.needsUpdate = true;
  }

  function reprojectAll(sampleY, sampleNormal = null) {
    if (typeof sampleY !== "function") return 0;
    let updated = 0;
    for (let i = 0; i < N_DECAL; i++) {
      const slot = stamped[i];
      if (!slot.active) continue;
      const y = sampleY(slot.x, slot.z);
      if (!Number.isFinite(y)) continue;
      const n = typeof sampleNormal === "function" ? sampleNormal(slot.x, slot.z) : null;
      applyDecalMatrix(i, slot.x, y, slot.z, n, slot.yaw, slot.side);
      updated++;
    }
    if (updated > 0) decals.instanceMatrix.needsUpdate = true;
    return updated;
  }

  function setEnabled(on) {
    enabled = Boolean(on);
    decals.visible = enabled;
    dustMesh.visible = enabled;
  }

  return { play, stamp, update, clear, reprojectAll, setEnabled, setSuitProfile, resume: () => audio()?.resume?.() };
}
