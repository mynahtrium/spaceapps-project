/**
 * Entry, descent and landing cinematic (`web/hud/landing-sequence.js`).
 *
 * A crew lander drops out of the sky over the landing site, lights its engines to brake (a
 * supersonic-retropropulsion-style burn), deploys its legs, and settles in a storm of blasted
 * regolith. No characters are shown. Then the camera glides to the walker's eyes beside the lander
 * and the EVA starts there; the lander stays on the ground as a landmark.
 *
 * Kinematics are simple and honest: free fall at constant speed (terminal velocity in thin air),
 * a constant-deceleration burn from the ignition height to a hover height, then a slow final
 * descent. Mars gravity is ~3.71 m/s^2, so the burn needs only modest thrust. The vehicle is a
 * generic illustrative lander, not a specific NASA or commercial design.
 *
 * Shots (one camera, cut with short fades): aerial chase while falling, a long ground shot during
 * the burn, a close low shot for touchdown and the dust storm, then a glide to the visor.
 */

const H_START = 720; // m above the pad
const V_FALL = 95; // m/s, falling before ignition
const H_IGNITE = 300;
const H_HOVER = 9;
const V_HOVER = 3.2;
const V_TOUCH = 1.3;
const SETTLE_S = 2.6; // dust settles before the camera goes to the visor
const GLIDE_S = 2.4;

const FLAME_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const FLAME_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uThrottle;
  uniform float uOuter;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    // vUv.y: 1 at the nozzle, 0 at the tip of the plume; vUv.x runs round the cone
    float along = vUv.y;
    // soft silhouette: bright where the surface faces the camera, fading at the rim
    float facing = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);
    float turb = noise(vec2(vUv.x * 14.0, along * 9.0 - uTime * 26.0));
    float turb2 = noise(vec2(vUv.x * 31.0 + 7.0, along * 17.0 - uTime * 41.0));
    float body = smoothstep(0.0, 0.92, along) * (0.72 + 0.5 * turb * turb2 + 0.12 * turb);
    // raw engine light: white-blue core at the throat, yellow-orange body, red-brown tail
    vec3 core = vec3(0.92, 0.95, 1.0);
    vec3 mid = vec3(1.0, 0.72, 0.32);
    vec3 tail = vec3(0.85, 0.3, 0.1);
    vec3 col = mix(tail, mid, smoothstep(0.1, 0.55, along));
    col = mix(col, core, pow(smoothstep(0.6, 1.0, along), 1.6));
    // shock diamonds: stationary bright rings in the exhaust column
    float dia = pow(0.5 + 0.5 * sin(along * 46.0), 6.0) * smoothstep(0.35, 0.95, along);
    col += vec3(1.0, 0.85, 0.65) * dia * 0.8 * (1.0 - 0.4 * uOuter);
    float a = body * facing * uThrottle * mix(1.0, 0.32, uOuter);
    gl_FragColor = vec4(col * a * 1.5, a);
  }
`;

/** Canvas texture for the hull: weld seams, panel lines, rivets, scorching and lettering. */
function makeHullTextures(THREE) {
  const W = 1024;
  const H = 1024;
  const TEX_W = 512;
  const TEX_H = 512;
  const make = (draw) => {
    const c = document.createElement("canvas");
    c.width = TEX_W;
    c.height = TEX_H;
    const g = c.getContext("2d");
    if (g) {
      g.save();
      g.scale(TEX_W / W, TEX_H / H);
      draw(g);
      g.restore();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  };
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rings = [0.1, 0.27, 0.45, 0.63, 0.79, 0.92];
  const map = make((g) => {
    g.fillStyle = "#d9d6cf";
    g.fillRect(0, 0, W, H);
    // brushed / painted panel mottling
    for (let i = 0; i < 700; i++) {
      g.fillStyle = `rgba(${rnd() < 0.5 ? "255,255,255" : "90,86,80"},${0.02 + rnd() * 0.035})`;
      g.fillRect(rnd() * W, rnd() * H, 4 + rnd() * 72, 2 + rnd() * 4);
    }
    // vertical panel lines and horizontal welds, rivets along the welds
    g.strokeStyle = "rgba(60,58,54,0.55)";
    g.lineWidth = 1.2;
    for (let i = 0; i < 12; i++) {
      g.beginPath();
      g.moveTo((i / 12) * W, 0);
      g.lineTo((i / 12) * W, H);
      g.stroke();
    }
    g.lineWidth = 2.2;
    for (const r of rings) {
      g.beginPath();
      g.moveTo(0, r * H);
      g.lineTo(W, r * H);
      g.stroke();
      g.fillStyle = "rgba(70,66,60,0.7)";
      for (let x = 0; x < W; x += 14) g.fillRect(x, r * H - 7, 2.4, 2.4);
    }
    // team stripe and lettering (upright on the texture: v runs up the body)
    g.fillStyle = "#1f3f73";
    g.fillRect(0, H * 0.36, W, 22);
    g.fillStyle = "#c8452b";
    g.fillRect(0, H * 0.36 + 26, W, 6);
    g.save();
    g.translate(W * 0.25, H * 0.52);
    g.rotate(-Math.PI / 2);
    g.fillStyle = "#1c1c1c";
    g.font = "700 74px sans-serif";
    g.textAlign = "center";
    g.fillText("MARTIAN MAPPERS", 0, 0);
    g.font = "500 30px sans-serif";
    g.fillText("EDL-01  ·  CREW LANDER", 0, 46);
    g.restore();
    // scorch: heat and engine soot darken the lower body, streaks climb up
    const grad = g.createLinearGradient(0, H, 0, H * 0.45);
    grad.addColorStop(0, "rgba(18,12,8,0.85)");
    grad.addColorStop(0.5, "rgba(40,28,18,0.35)");
    grad.addColorStop(1, "rgba(40,28,18,0)");
    g.fillStyle = grad;
    g.fillRect(0, H * 0.45, W, H * 0.55);
    for (let i = 0; i < 90; i++) {
      const x = rnd() * W;
      g.strokeStyle = `rgba(25,18,12,${0.1 + rnd() * 0.25})`;
      g.lineWidth = 1 + rnd() * 4;
      g.beginPath();
      g.moveTo(x, H);
      g.lineTo(x + (rnd() - 0.5) * 20, H * (0.45 + rnd() * 0.4));
      g.stroke();
    }
    // wind-blown rust-coloured dust on the lower hull
    for (let i = 0; i < 380; i++) {
      g.fillStyle = `rgba(170,105,64,${rnd() * 0.08})`;
      g.fillRect(rnd() * W, H * (0.5 + rnd() * 0.5), 2 + rnd() * 10, 2 + rnd() * 4);
    }
  });
  map.colorSpace = THREE.SRGBColorSpace;
  const bump = make((g) => {
    g.fillStyle = "#808080";
    g.fillRect(0, 0, W, H);
    g.strokeStyle = "#202020";
    g.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      g.beginPath();
      g.moveTo((i / 12) * W, 0);
      g.lineTo((i / 12) * W, H);
      g.stroke();
    }
    g.lineWidth = 5;
    for (const r of rings) {
      g.beginPath();
      g.moveTo(0, r * H);
      g.lineTo(W, r * H);
      g.stroke();
      g.fillStyle = "#e0e0e0";
      for (let x = 0; x < W; x += 14) g.fillRect(x, r * H - 7, 3, 3);
    }
  });
  return { map, bump };
}

function buildLander(THREE) {
  const g = new THREE.Group();
  g.name = "crew-lander";
  const tex = makeHullTextures(THREE);
  const hull = new THREE.MeshStandardMaterial({
    map: tex.map,
    bumpMap: tex.bump,
    bumpScale: 2.2,
    color: 0xffffff,
    roughness: 0.55,
    metalness: 0.22,
    envMapIntensity: 1.1,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d2025, roughness: 0.6, metalness: 0.6 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.28, metalness: 0.92 });
  const scorched = new THREE.MeshStandardMaterial({ color: 0x2c2118, roughness: 0.82, metalness: 0.25 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc89b3c, roughness: 0.3, metalness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c1118, roughness: 0.08, metalness: 0.9, envMapIntensity: 1.6 });
  const add = (parent, geom, mat, x = 0, y = 0, z = 0, cast = true) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const R = 2.1;

  // main hull as one smooth profile: skirt, barrel, shoulder, ogive nose (lathe, u = round, v = up)
  const prof = [
    [R * 1.06, 1.7],
    [R * 1.06, 2.5],
    [R * 1.0, 2.9],
    [R, 11.4],
    [R * 0.99, 12.0],
    [R * 0.94, 13.0],
    [R * 0.84, 14.3],
    [R * 0.66, 15.7],
    [R * 0.44, 16.9],
    [R * 0.2, 17.7],
    [0.0, 18.0],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const body = add(g, new THREE.LatheGeometry(prof, 36), hull);
  // lathe v follows the profile length: stretch it so the texture seams land where drawn
  const uv = body.geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 1.0);

  // heat-scorched engine skirt, a gold thermal band, interstage ring
  add(g, new THREE.CylinderGeometry(R * 1.04, R * 1.1, 1.5, 36, 1, true), scorched, 0, 2.2, 0);
  add(g, new THREE.CylinderGeometry(R * 1.08, R * 1.08, 0.28, 36), gold, 0, 3.05, 0);
  add(g, new THREE.TorusGeometry(R * 1.01, 0.07, 6, 36), steel, 0, 11.4, 0, false).rotation.x = Math.PI / 2;

  // crew windows: a row of dark panes with frames
  for (let i = 0; i < 6; i++) {
    const a = -0.9 + (i / 5) * 1.8;
    const x = Math.sin(a) * (R * 0.93);
    const z = -Math.cos(a) * (R * 0.93);
    const frame = add(g, new THREE.BoxGeometry(0.42, 0.5, 0.1), dark, x, 13.0, z, false);
    frame.rotation.y = -a;
    const pane = add(g, new THREE.BoxGeometry(0.3, 0.38, 0.06), glass, x * 1.012, 13.0, z * 1.012, false);
    pane.rotation.y = -a;
  }

  // side hatch with a frame, a handle and a short ladder
  const hatchA = Math.PI * 0.5;
  const hx = Math.cos(hatchA) * R;
  const hz = Math.sin(hatchA) * R;
  const hatch = new THREE.Group();
  hatch.position.set(hx, 8.6, hz);
  hatch.rotation.y = -hatchA + Math.PI / 2;
  g.add(hatch);
  add(hatch, new THREE.BoxGeometry(1.5, 2.2, 0.1), dark, 0, 0, 0.0, false);
  add(hatch, new THREE.BoxGeometry(1.25, 1.95, 0.06), hull, 0, 0, 0.06, false);
  add(hatch, new THREE.BoxGeometry(0.28, 0.07, 0.07), steel, 0.4, 0, 0.12, false);
  for (let i = 0; i < 6; i++) add(hatch, new THREE.CylinderGeometry(0.035, 0.035, 0.7, 8), steel, 0, -2.4 - i * 0.5, 0.18, false).rotation.z = Math.PI / 2;
  for (const sx of [-0.35, 0.35]) add(hatch, new THREE.CylinderGeometry(0.04, 0.04, 3.2, 8), steel, sx, -3.7, 0.18, false);

  // cold-gas attitude thrusters: four clusters near the shoulder (they puff during the fall)
  const rcs = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const cluster = new THREE.Group();
    cluster.position.set(Math.cos(a) * R * 0.97, 12.2, Math.sin(a) * R * 0.97);
    cluster.rotation.y = -a;
    g.add(cluster);
    add(cluster, new THREE.BoxGeometry(0.22, 0.5, 0.3), dark, 0, 0, 0.1, false);
    for (const dy of [-0.18, 0.18]) {
      const n = add(cluster, new THREE.CylinderGeometry(0.03, 0.07, 0.16, 10), steel, 0.14, dy, 0.1, false);
      n.rotation.z = -Math.PI / 2;
    }
    rcs.push({ cluster, a });
  }

  // engines: four gimballed bells (lathe), turbopump boxes and feed lines
  const bellProf = [
    [0.2, 0.0],
    [0.16, 0.18],
    [0.24, 0.55],
    [0.4, 0.95],
    [0.58, 1.3],
    [0.68, 1.55],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const bellGeom = new THREE.LatheGeometry(bellProf, 16);
  const bellMat = new THREE.MeshStandardMaterial({
    color: 0x3b332c,
    roughness: 0.4,
    metalness: 0.9,
    side: THREE.DoubleSide,
  });
  const bellPos = [
    [0, 0],
    [1.15, 0],
    [-0.575, 1.0],
    [-0.575, -1.0],
  ];
  const nozzle = [];
  for (const [bx, bz] of bellPos) {
    const eng = new THREE.Group();
    eng.position.set(bx, 3.2, bz);
    g.add(eng);
    // bell hangs below the skirt: flip so the wide mouth points down
    const bell = add(eng, bellGeom, bellMat, 0, 0, 0);
    bell.rotation.x = Math.PI;
    bell.position.y = 0;
    add(eng, new THREE.CylinderGeometry(0.24, 0.3, 0.5, 16), steel, 0, 0.2, 0, false);
    add(eng, new THREE.BoxGeometry(0.35, 0.3, 0.3), dark, 0.32, 0.45, 0, false);
    add(eng, new THREE.TorusGeometry(0.43, 0.03, 6, 16), steel, 0, -0.95, 0, false).rotation.x = Math.PI / 2;
    nozzle.push({ x: bx, z: bz, y: 3.2 - 1.55 });
  }

  // landing legs: a main strut with a telescoping piston and a crush-core foot, plus a brace
  const legs = [];
  const braceGeom = new THREE.CylinderGeometry(0.06, 0.06, 1, 10);
  braceGeom.translate(0, 0.5, 0);
  const strutGeom = new THREE.CylinderGeometry(0.13, 0.16, 2.9, 14);
  const pistonGeom = new THREE.CylinderGeometry(0.075, 0.075, 2.6, 12);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const hinge = new THREE.Group();
    hinge.position.set(Math.cos(a) * R * 0.98, 3.9, Math.sin(a) * R * 0.98);
    hinge.rotation.y = -a;
    g.add(hinge);
    add(hinge, new THREE.BoxGeometry(0.4, 0.5, 0.5), dark, -0.05, 0, 0, false); // hinge block
    add(hinge, strutGeom, dark, 0, -1.45, 0);
    const piston = add(hinge, pistonGeom, steel, 0, -3.0, 0);
    const foot = new THREE.Group();
    foot.position.set(0, -4.35, 0);
    hinge.add(foot);
    add(foot, new THREE.CylinderGeometry(0.62, 0.74, 0.14, 14), dark, 0, 0, 0, false);
    add(foot, new THREE.CylinderGeometry(0.5, 0.5, 0.2, 14), gold, 0, 0.16, 0, false); // crush honeycomb
    const brace = add(g, braceGeom, steel, 0, 0, 0);
    legs.push({ hinge, a, brace, piston, foot, anchor: new THREE.Vector3(Math.cos(a) * R * 0.99, 7.4, Math.sin(a) * R * 0.99) });
  }
  const _u = new THREE.Vector3(0, 1, 0);
  const _d = new THREE.Vector3();
  const _m = new THREE.Vector3();
  function setDeploy(d) {
    const th = 0.04 + 0.44 * d;
    const ext = 0.72 + 0.28 * d; // the piston extends as the leg opens
    for (const leg of legs) {
      leg.hinge.rotation.z = th;
      leg.piston.position.y = -2.2 - 0.8 * ext;
      leg.foot.position.y = -3.55 - 0.8 * ext;
      // brace: from a hull anchor to a point on the main strut
      const sx = Math.sin(th) * 2.3;
      const sy = -Math.cos(th) * 2.3;
      _m.set(leg.hinge.position.x + sx * Math.cos(leg.a), leg.hinge.position.y + sy, leg.hinge.position.z + sx * Math.sin(leg.a));
      _d.copy(_m).sub(leg.anchor);
      const len = _d.length();
      leg.brace.position.copy(leg.anchor);
      leg.brace.quaternion.setFromUnitVectors(_u, _d.divideScalar(len || 1));
      leg.brace.scale.set(1, len, 1);
    }
  }
  setDeploy(0);

  // exhaust plumes: an inner bright cone and a wide faint one per engine (shader), plus engine glow
  const mkFlame = (outer) =>
    new THREE.ShaderMaterial({
      vertexShader: FLAME_VERT,
      fragmentShader: FLAME_FRAG,
      uniforms: { uTime: { value: 0 }, uThrottle: { value: 0 }, uOuter: { value: outer } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  const flameMat = mkFlame(0);
  const flameOuterMat = mkFlame(1);
  const flames = [];
  for (const n of nozzle) {
    const inner = new THREE.ConeGeometry(0.55, 8.5, 16, 1, true);
    inner.rotateX(Math.PI); // tip down
    inner.translate(0, -4.25, 0);
    const outer = new THREE.ConeGeometry(0.95, 6.5, 16, 1, true);
    outer.rotateX(Math.PI);
    outer.translate(0, -3.25, 0);
    for (const [geom, mat] of [
      [inner, flameMat],
      [outer, flameOuterMat],
    ]) {
      const f = new THREE.Mesh(geom, mat);
      f.position.set(n.x, n.y + 0.05, n.z);
      f.frustumCulled = false;
      f.renderOrder = 5;
      g.add(f);
      flames.push(f);
    }
  }
  const glow = new THREE.PointLight(0xffa04a, 0, 120, 1.5);
  glow.position.set(0, -1.5, 0);
  g.add(glow);

  // cold-gas puffs (sprites: soft white points) at the thruster clusters
  const puffMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  const puffs = rcs.map((r) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), puffMat.clone());
    m.position.set(Math.cos(r.a) * (R + 0.5), 12.2, Math.sin(r.a) * (R + 0.5));
    m.visible = false;
    g.add(m);
    return m;
  });
  function updateRcs(t, active) {
    puffs.forEach((m, i) => {
      const phase = (t * 1.7 + i * 0.37) % 1;
      const on = active && phase < 0.16 && Math.sin(t * 2.3 + i * 5.1) > 0.2;
      m.visible = on;
      if (on) {
        const k = phase / 0.16;
        m.material.opacity = 0.7 * (1 - k);
        m.scale.setScalar(0.5 + k * 2.2);
      }
    });
  }
  return { group: g, legs, flames, flameMat, flameOuterMat, glow, setDeploy, updateRcs };
}

export function createLandingSequence(THREE, scene, { marsFx = null, sampleY }) {
  const L = buildLander(THREE);
  L.group.visible = false;
  scene.add(L.group);

  // overlay: letterbox bars, caption, fades
  const overlay = document.createElement("div");
  overlay.className = "landing-cine";
  overlay.innerHTML = `
    <div class="lc-bar lc-top"></div><div class="lc-bar lc-bot"></div>
    <div class="lc-caption"><div class="lc-title" data-k="title">ENTRY · DESCENT · LANDING</div><div class="lc-sub" data-k="sub">—</div></div>
    <div class="lc-skip" data-k="skip">PRESS ANY KEY TO SKIP</div>
    <div class="lc-fade" data-k="fade"></div>`;
  document.body.appendChild(overlay);
  const ui = Object.fromEntries([...overlay.querySelectorAll("[data-k]")].map((n) => [n.dataset.k, n]));

  // burn kinematics
  const D_BURN = H_IGNITE - H_HOVER;
  const A_BURN = (V_FALL * V_FALL - V_HOVER * V_HOVER) / (2 * D_BURN);
  const T_FALL = (H_START - H_IGNITE) / V_FALL;
  const T_BURN = (V_FALL - V_HOVER) / A_BURN;
  const T_FINAL = (2 * H_HOVER) / (V_HOVER + V_TOUCH);
  const T_TOUCH = T_FALL + T_BURN + T_FINAL;
  const T_END = T_TOUCH + SETTLE_S + GLIDE_S;

  let s = null; // running state
  const tmp = new THREE.Vector3();
  const startPos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const eyePos = new THREE.Vector3();
  const eyeQuat = new THREE.Quaternion();
  const camQ = new THREE.Quaternion();
  const m4 = new THREE.Matrix4();
  const UP = new THREE.Vector3(0, 1, 0);

  /** height above the pad and vertical speed at time t */
  function profile(t) {
    if (t < T_FALL) return { h: H_START - V_FALL * t, v: -V_FALL, throttle: 0 };
    if (t < T_FALL + T_BURN) {
      const u = t - T_FALL;
      return { h: H_IGNITE - (V_FALL * u - 0.5 * A_BURN * u * u), v: -(V_FALL - A_BURN * u), throttle: 1 };
    }
    if (t < T_TOUCH) {
      const u = t - T_FALL - T_BURN;
      const acc = (V_HOVER - V_TOUCH) / T_FINAL;
      return { h: Math.max(0, H_HOVER - (V_HOVER * u - 0.5 * acc * u * u)), v: -(V_HOVER - acc * u), throttle: 0.45 };
    }
    const after = t - T_TOUCH;
    return { h: 0, v: 0, throttle: Math.max(0, 0.45 * (1 - after / 0.6)) };
  }

  function placeLegs(deploy) {
    L.setDeploy(deploy);
  }

  function setFade(a) {
    ui.fade.style.opacity = String(Math.max(0, Math.min(1, a)));
  }

  /**
   * @param {{x:number,z:number,yaw:number,padX:number,padZ:number,site?:string}} o
   *   x/z: where the walker will stand; pad: where the lander touches down
   */
  function start(o) {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    s = { t: reduced ? T_END - GLIDE_S * 0.4 : 0, ...o, groundY: sampleY(o.padX, o.padZ), shake: 0, dustAcc: 0, touched: false, isEnding: false };
    s.fogBase = scene.fog?.density ?? null;
    L.group.visible = true;
    L.group.position.set(o.padX, s.groundY + H_START, o.padZ);
    L.group.rotation.set(0, o.yaw + 0.7, 0);
    placeLegs(0);
    ui.sub.textContent = o.site || "GALE CRATER · MOUNT SHARP";
    overlay.classList.remove("ending");
    overlay.classList.add("on");
    document.body.classList.add("landing-active");
    setFade(1);
  }

  function finish() {
    if (!s) return;
    if (scene.fog && s.fogBase != null) scene.fog.density = s.fogBase;
    const pad = { x: s.padX, z: s.padZ };
    s = null;
    overlay.classList.remove("on", "ending");
    document.body.classList.remove("landing-active");
    setFade(0);
    L.flameMat.uniforms.uThrottle.value = 0;
    L.flameOuterMat.uniforms.uThrottle.value = 0;
    L.updateRcs(0, false);
    L.glow.intensity = 0;
    // the lander stays where it landed
    L.group.position.y = sampleY(pad.x, pad.z);
    placeLegs(1);
    return pad;
  }

  /** Jump to a time in the sequence (for checking shots). */
  function seek(t) {
    if (s) s.t = Math.max(0, Math.min(T_END - 0.05, t));
  }

  /** Jump to the end (any key). */
  function skip() {
    if (!s) return;
    s.t = Math.max(s.t, T_END - 0.6);
  }

  /**
   * Advance and, while running, take over the camera. `camera` arrives already posed at the walker's
   * eyes for this frame (used as the end of the glide). Returns true while the cinematic runs.
   */
  function warmup(renderer, camera) {
    if (!renderer || !camera || typeof renderer.compile !== "function") return;
    const wasVisible = L.group.visible;
    const prevInner = L.flameMat.uniforms.uThrottle.value;
    const prevOuter = L.flameOuterMat.uniforms.uThrottle.value;
    L.group.visible = true;
    L.flameMat.uniforms.uThrottle.value = 0.5;
    L.flameOuterMat.uniforms.uThrottle.value = 0.5;
    try {
      renderer.compile(scene, camera);
    } finally {
      L.flameMat.uniforms.uThrottle.value = prevInner;
      L.flameOuterMat.uniforms.uThrottle.value = prevOuter;
      L.group.visible = wasVisible;
    }
  }

  function update(dt, camera, clockT) {
    if (!s) return false;
    const stepDt = Math.min(0.05, Math.max(0, Number(dt) || 0));
    s.t += stepDt;
    const t = s.t;
    eyePos.copy(camera.position);
    eyeQuat.copy(camera.quaternion);

    const p = profile(Math.min(t, T_TOUCH + SETTLE_S));
    const gy = s.groundY;
    const rocketY = gy + p.h;
    L.group.position.set(s.padX, rocketY, s.padZ);
    // a small attitude wobble while falling and during the burn, none once down
    const wob = p.h > 1 ? Math.min(1, p.h / 200) : 0;
    L.group.rotation.x = Math.sin(clockT * 0.7) * 0.03 * wob;
    L.group.rotation.z = Math.cos(clockT * 0.55) * 0.03 * wob;
    placeLegs(Math.max(0, Math.min(1, (40 - p.h) / 25)));
    L.flameMat.uniforms.uTime.value = clockT;
    L.flameMat.uniforms.uThrottle.value = p.throttle;
    L.flameOuterMat.uniforms.uTime.value = clockT;
    L.flameOuterMat.uniforms.uThrottle.value = p.throttle;
    const flick = 1 + 0.06 * Math.sin(clockT * 47) + 0.04 * Math.sin(clockT * 83);
    for (const f of L.flames) f.scale.set(1, (0.55 + p.throttle * 0.95) * flick, 1);
    L.updateRcs(clockT, p.h > 12);
    L.glow.intensity = p.throttle * 260;

    // blasted regolith: the closer the engines get to the ground, the more and faster the dust
    if (marsFx && p.throttle > 0.05 && p.h < 70) {
      const k = 1 - p.h / 70;
      s.dustAcc = Math.min(3, s.dustAcc + stepDt * (16 + 64 * k) * p.throttle);
      let bursts = 0;
      while (s.dustAcc >= 1 && bursts < 3) {
        s.dustAcc -= 1;
        bursts++;
        const a = Math.random() * Math.PI * 2;
        const r = 1 + Math.random() * (3 + 10 * k);
        const x = s.padX + Math.cos(a) * r;
        const z = s.padZ + Math.sin(a) * r;
        marsFx.emitBurst(x, gy, z, 2, 1.2 + 2.2 * k, Math.cos(a) * 9 * k, Math.sin(a) * 9 * k);
      }
    }
    if (!s.touched && t >= T_TOUCH) {
      s.touched = true;
      s.shake = 1;
      marsFx?.emitJumpBurst?.(s.padX, gy, s.padZ, {
        mode: "land",
        impactSpeed: 4.5,
        rightX: 1,
        rightZ: 0,
        fwdX: 0,
        fwdZ: -1,
        vx: 0,
        vz: 0,
      });
    }
    s.shake *= Math.exp(-stepDt * 2.2);

    // thinner haze while the camera is high, so the crater floor reads from the air
    if (scene.fog && s.fogBase != null) scene.fog.density = s.fogBase * (0.3 + 0.7 * Math.min(1, Math.max(0, 1 - (p.h - 60) / 300)));

    // ---- camera shots ----
    const pad = tmp.set(s.padX, gy, s.padZ);
    let fade = 0;
    const T_B = T_FALL + 0.6; // cut to the ground shot just after ignition
    const T_C = T_FALL + T_BURN * 0.72; // cut to the close shot for the touchdown
    if (t < T_B) {
      // A: aerial chase beside the falling lander, ground far below
      camera.position.set(pad.x + 34, rocketY + 14, pad.z + 46);
      look.set(pad.x, rocketY + 6, pad.z);
      fade = Math.max(1 - t / 0.8, t > T_B - 0.25 ? (t - (T_B - 0.25)) / 0.25 : 0);
    } else if (t < T_C) {
      // B: long ground shot looking up at the burn
      const u = (t - T_B) / (T_C - T_B);
      camera.position.set(pad.x + 70 - 10 * u, sampleY(pad.x + 70, pad.z + 48) + 2.2, pad.z + 48 - 6 * u);
      look.set(pad.x, rocketY + 4, pad.z);
      fade = Math.max(1 - (t - T_B) / 0.25, t > T_C - 0.25 ? (t - (T_C - 0.25)) / 0.25 : 0);
    } else if (t < T_TOUCH + SETTLE_S) {
      // C: close, low, slowly orbiting; touchdown and the dust storm
      const u = (t - T_C) / (T_TOUCH + SETTLE_S - T_C);
      const ang = 0.9 + u * 0.35;
      const dist = 30 - 6 * u;
      const cx = pad.x + Math.cos(ang) * dist;
      const cz = pad.z + Math.sin(ang) * dist;
      camera.position.set(cx, sampleY(cx, cz) + 2.4, cz);
      look.set(pad.x, Math.max(gy + 6, rocketY + 5), pad.z);
      fade = 1 - (t - T_C) / 0.25;
    } else {
      // D: glide from the close shot to the walker's eyes
      const u = Math.min(1, (t - T_TOUCH - SETTLE_S) / GLIDE_S);
      const e = u * u * (3 - 2 * u);
      const ang = 1.25;
      const cx = pad.x + Math.cos(ang) * 24;
      const cz = pad.z + Math.sin(ang) * 24;
      startPos.set(cx, sampleY(cx, cz) + 2.4, cz);
      camera.position.lerpVectors(startPos, eyePos, e);
      m4.lookAt(startPos, look.set(pad.x, gy + 6, pad.z), UP);
      camQ.setFromRotationMatrix(m4);
      camera.quaternion.slerpQuaternions(camQ, eyeQuat, e);
      setFade(0);
      const endingNow = u > 0.4;
      if (endingNow !== s.isEnding) {
        s.isEnding = endingNow;
        overlay.classList.toggle("ending", endingNow);
      }
      if (u >= 1) {
        finish();
        return false;
      }
      return true;
    }
    if (s.shake > 0.01) {
      camera.position.x += (Math.random() - 0.5) * 0.35 * s.shake;
      camera.position.y += (Math.random() - 0.5) * 0.35 * s.shake;
    }
    camera.lookAt(look);
    setFade(fade);
    return true;
  }

  return {
    start,
    warmup,
    update,
    skip,
    seek,
    get active() {
      return Boolean(s);
    },
    get lander() {
      return L.group;
    },
    /** total running time in seconds (for tests / UI) */
    duration: T_END,
    timeline: { T_FALL, T_BURN, T_FINAL, T_TOUCH, T_END, A_BURN },
  };
}
