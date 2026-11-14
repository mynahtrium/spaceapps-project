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

  const tread = (() => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 128;
    const g = c.getContext("2d");
    g.clearRect(0, 0, 64, 128);
    g.fillStyle = "rgba(0,0,0,0.55)";
    g.fillRect(8, 6, 48, 116);
    g.strokeStyle = "rgba(0,0,0,0.8)";
    g.lineWidth = 3;
    for (let y = 14; y < 118; y += 10) {
      g.beginPath();
      g.moveTo(14, y);
      g.lineTo(50, y + 4);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();

  const decalGeom = new THREE.PlaneGeometry(0.32, 0.14);
  decalGeom.rotateX(-Math.PI / 2);
  const decalMat = new THREE.MeshBasicMaterial({
    map: tread,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
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

  function stamp(x, y, z, normal, yaw, faciesId) {
    if (!enabled) return;
    nrm.set(normal?.x ?? 0, normal?.y ?? 1, normal?.z ?? 0);
    if (nrm.lengthSq() < 1e-6) nrm.set(0, 1, 0);
    nrm.normalize();
    qTilt.setFromUnitVectors(yAxis, nrm);
    qYaw.setFromAxisAngle(yAxis, yaw || 0);
    dummy.position.set(x, y + 0.012, z);
    dummy.quaternion.copy(qTilt).multiply(qYaw);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    decals.setMatrixAt(decalCursor, dummy.matrix);
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

  function setEnabled(on) {
    enabled = Boolean(on);
    decals.visible = enabled;
    dustMesh.visible = enabled;
  }

  return { play, stamp, update, setEnabled, resume: () => audio()?.resume?.() };
}
