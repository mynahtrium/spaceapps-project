/**
 * Wind-blown dust around the walker (`web/hud/wind-dust.js`). Visual only.
 *
 * Three layers that move with one gusting wind:
 *  - saltation: sand grains hopping a hand's height over the ground near your boots (on Mars
 *    sand moves in low hops; at 600 Pa it takes strong gusts, so the layer swells with each gust),
 *  - suspended dust: fine motes hanging in the air for tens of metres, bright when you look
 *    towards the Sun (forward scattering), nearly invisible with the Sun behind you,
 *  - drifting dust sheets: soft plumes from the dust atlas sliding over the ground in gusts.
 * Particles live in boxes that follow the camera and wrap, so the cost is constant.
 */

const SALT_N = 700;
const MOTE_N = 1100;
const SHEET_N = 14;
const SALT_R = 9; // metres around the walker
const MOTE_R = 26;
const SHEET_R = 70;

const POINT_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * uScale / max(0.4, -mv.z), 1.0, 3.5);
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * mv;
  }
`;

const POINT_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c) * 4.0;
    if (d > 1.0) discard;
    float a = (1.0 - d) * vAlpha * uOpacity;
    gl_FragColor = vec4(uColor, a);
  }
`;

const SHEET_VERT = /* glsl */ `
  attribute vec2 aCorner;
  attribute vec4 aUvRect;
  attribute vec2 aSizeAlpha;
  uniform vec3 uCamRight;
  uniform vec3 uCamUp;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vec3 p = position + uCamRight * aCorner.x * aSizeAlpha.x + vec3(0.0, 1.0, 0.0) * (aCorner.y + 0.5) * aSizeAlpha.x * 0.45;
    vUv = mix(aUvRect.xy, aUvRect.zw, aCorner + 0.5);
    vAlpha = aSizeAlpha.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const SHEET_FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vec4 t = texture2D(uAtlas, vUv);
    float a = t.a * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor * (0.75 + 0.35 * t.r), a);
  }
`;

function rand(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * @param {object} o
 * @param {typeof import("three")} o.THREE
 * @param {import("three").Scene} o.scene
 * @param {(x:number, z:number) => number} o.groundY   terrain height under (x, z)
 * @param {import("three").Vector3} o.sunDir
 * @param {string} [o.atlasUrl]
 */
export function createWindDust({ THREE, scene, groundY, sunDir, atlasUrl = "./assets/dust/mars-dust-atlas.png" }) {
  const rnd = rand(4242);
  const group = new THREE.Group();
  group.name = "wind-dust";
  scene.add(group);

  // ---------- saltation grains ----------
  const salt = {
    pos: new Float32Array(SALT_N * 3),
    size: new Float32Array(SALT_N),
    alpha: new Float32Array(SALT_N),
    ox: new Float32Array(SALT_N), // position relative to the moving box origin
    oz: new Float32Array(SALT_N),
    hop: new Float32Array(SALT_N), // hop phase 0..1
    hopLen: new Float32Array(SALT_N), // hop duration (s)
    hopH: new Float32Array(SALT_N), // hop height (m)
    sp: new Float32Array(SALT_N), // speed factor
  };
  for (let i = 0; i < SALT_N; i++) {
    salt.ox[i] = (rnd() * 2 - 1) * SALT_R;
    salt.oz[i] = (rnd() * 2 - 1) * SALT_R;
    salt.hop[i] = rnd();
    salt.hopLen[i] = 0.25 + rnd() * 0.45;
    salt.hopH[i] = 0.02 + rnd() * rnd() * 0.22;
    salt.sp[i] = 0.6 + rnd() * 0.7;
    salt.size[i] = 0.9 + rnd() * 1.6;
  }
  const saltGeom = new THREE.BufferGeometry();
  saltGeom.setAttribute("position", new THREE.BufferAttribute(salt.pos, 3).setUsage(THREE.DynamicDrawUsage));
  saltGeom.setAttribute("aSize", new THREE.BufferAttribute(salt.size, 1));
  saltGeom.setAttribute("aAlpha", new THREE.BufferAttribute(salt.alpha, 1).setUsage(THREE.DynamicDrawUsage));
  const saltMat = new THREE.ShaderMaterial({
    vertexShader: POINT_VERT,
    fragmentShader: POINT_FRAG,
    uniforms: {
      uScale: { value: 30 },
      uColor: { value: new THREE.Color().setRGB(0.74, 0.5, 0.34, THREE.SRGBColorSpace) },
      uOpacity: { value: 0.9 },
    },
    transparent: true,
    depthWrite: false,
  });
  const saltPts = new THREE.Points(saltGeom, saltMat);
  saltPts.frustumCulled = false;
  group.add(saltPts);

  // ---------- suspended dust motes ----------
  const mote = {
    pos: new Float32Array(MOTE_N * 3),
    size: new Float32Array(MOTE_N),
    alpha: new Float32Array(MOTE_N),
    ox: new Float32Array(MOTE_N),
    oy: new Float32Array(MOTE_N),
    oz: new Float32Array(MOTE_N),
    ph: new Float32Array(MOTE_N),
  };
  for (let i = 0; i < MOTE_N; i++) {
    mote.ox[i] = (rnd() * 2 - 1) * MOTE_R;
    mote.oz[i] = (rnd() * 2 - 1) * MOTE_R;
    mote.oy[i] = 0.1 + rnd() * rnd() * 9; // denser near the ground
    mote.ph[i] = rnd() * Math.PI * 2;
    mote.size[i] = 0.6 + rnd() * 1.2;
    mote.alpha[i] = 0.25 + rnd() * 0.75;
  }
  const moteGeom = new THREE.BufferGeometry();
  moteGeom.setAttribute("position", new THREE.BufferAttribute(mote.pos, 3).setUsage(THREE.DynamicDrawUsage));
  moteGeom.setAttribute("aSize", new THREE.BufferAttribute(mote.size, 1));
  moteGeom.setAttribute("aAlpha", new THREE.BufferAttribute(mote.alpha, 1));
  const moteMat = new THREE.ShaderMaterial({
    vertexShader: POINT_VERT,
    fragmentShader: POINT_FRAG,
    uniforms: {
      uScale: { value: 30 },
      uColor: { value: new THREE.Color().setRGB(1.0, 0.86, 0.7, THREE.SRGBColorSpace) },
      uOpacity: { value: 0.3 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const motePts = new THREE.Points(moteGeom, moteMat);
  motePts.frustumCulled = false;
  group.add(motePts);

  // ---------- drifting dust sheets (atlas billboards, upright) ----------
  const sheet = {
    x: new Float32Array(SHEET_N),
    z: new Float32Array(SHEET_N),
    size: new Float32Array(SHEET_N),
    age: new Float32Array(SHEET_N),
    life: new Float32Array(SHEET_N),
    cell: new Uint8Array(SHEET_N),
  };
  const sPos = new Float32Array(SHEET_N * 4 * 3);
  const sCorner = new Float32Array(SHEET_N * 4 * 2);
  const sUv = new Float32Array(SHEET_N * 4 * 4);
  const sSA = new Float32Array(SHEET_N * 4 * 2);
  const sIdx = new Uint16Array(SHEET_N * 6);
  const corners = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];
  const CELLS = [0, 3, 4, 5, 6, 10]; // billowing plume cells of the 4 x 3 atlas
  for (let i = 0; i < SHEET_N; i++) {
    for (let c = 0; c < 4; c++) {
      sCorner[(i * 4 + c) * 2] = corners[c][0];
      sCorner[(i * 4 + c) * 2 + 1] = corners[c][1];
    }
    sIdx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  const sheetGeom = new THREE.BufferGeometry();
  sheetGeom.setAttribute("position", new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage));
  sheetGeom.setAttribute("aCorner", new THREE.BufferAttribute(sCorner, 2));
  sheetGeom.setAttribute("aUvRect", new THREE.BufferAttribute(sUv, 4).setUsage(THREE.DynamicDrawUsage));
  sheetGeom.setAttribute("aSizeAlpha", new THREE.BufferAttribute(sSA, 2).setUsage(THREE.DynamicDrawUsage));
  sheetGeom.setIndex(new THREE.BufferAttribute(sIdx, 1));
  const sheetMat = new THREE.ShaderMaterial({
    vertexShader: SHEET_VERT,
    fragmentShader: SHEET_FRAG,
    uniforms: {
      uAtlas: { value: null },
      uColor: { value: new THREE.Color().setRGB(0.66, 0.45, 0.32, THREE.SRGBColorSpace) },
      uCamRight: { value: new THREE.Vector3(1, 0, 0) },
      uCamUp: { value: new THREE.Vector3(0, 1, 0) },
    },
    transparent: true,
    depthWrite: false,
  });
  const sheetMesh = new THREE.Mesh(sheetGeom, sheetMat);
  sheetMesh.frustumCulled = false;
  sheetMesh.visible = false; // until the atlas loads
  group.add(sheetMesh);
  new THREE.TextureLoader().load(atlasUrl, (t) => {
    t.colorSpace = THREE.NoColorSpace;
    sheetMat.uniforms.uAtlas.value = t;
    sheetMesh.visible = true;
  });
  const setCell = (i, cell) => {
    const col = cell % 4;
    const row = Math.floor(cell / 4);
    const u0 = col / 4 + 0.004;
    const u1 = (col + 1) / 4 - 0.004;
    const v1 = 1 - row / 3 - 0.004;
    const v0 = 1 - (row + 1) / 3 + 0.004;
    for (let c = 0; c < 4; c++) sUv.set([u0, v0, u1, v1], (i * 4 + c) * 4);
  };
  const respawnSheet = (i, cx, cz, upwind) => {
    // start upwind of the walker so the sheet drifts across the view
    const a = rnd() * Math.PI * 2;
    const r = 15 + rnd() * (SHEET_R - 15);
    sheet.x[i] = cx + Math.cos(a) * r + (upwind ? -wind.x * 25 : 0);
    sheet.z[i] = cz + Math.sin(a) * r + (upwind ? -wind.z * 25 : 0);
    sheet.size[i] = 6 + rnd() * 12;
    sheet.age[i] = 0;
    sheet.life[i] = 7 + rnd() * 9;
    sheet.cell[i] = CELLS[Math.floor(rnd() * CELLS.length)];
    setCell(i, sheet.cell[i]);
  };

  // ---------- wind ----------
  const wind = { x: 0.8, z: -0.6, speed: 4, gust: 0 }; // unit direction (towards), m/s
  let windHeading = Math.atan2(-0.6, 0.8);
  let t = 0;
  let enabled = true;
  let started = false;
  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const viewDir = new THREE.Vector3();
  const wrap = (v, r) => ((((v + r) % (2 * r)) + 2 * r) % (2 * r)) - r;

  function update(dt, camera, strength = 1) {
    group.visible = enabled && strength > 0.01;
    if (!group.visible) return;
    dt = Math.min(0.05, Math.max(0, dt));
    t += dt;
    const cx = camera.position.x;
    const cz = camera.position.z;
    if (!started) {
      started = true;
      for (let i = 0; i < SHEET_N; i++) {
        respawnSheet(i, cx, cz, false);
        sheet.age[i] = rnd() * sheet.life[i];
      }
    }

    // wind: a slowly veering direction, 2-6 m/s with gusts to ~11 m/s every 6-20 s
    windHeading += Math.sin(t * 0.031) * 0.02 * dt;
    wind.x = Math.cos(windHeading);
    wind.z = Math.sin(windHeading);
    const g = Math.max(0, Math.sin(t * 0.37) * Math.sin(t * 0.113 + 1.2));
    wind.gust = g * g;
    wind.speed = (3 + 2 * Math.sin(t * 0.05) + 6 * wind.gust) * strength;
    const k = wind.speed;

    // saltation: grains hop downwind, visible mostly during gusts
    const saltVis = Math.min(1, 0.35 + wind.gust * 1.6) * strength;
    for (let i = 0; i < SALT_N; i++) {
      salt.ox[i] = wrap(salt.ox[i] + wind.x * k * salt.sp[i] * dt * 0.7, SALT_R);
      salt.oz[i] = wrap(salt.oz[i] + wind.z * k * salt.sp[i] * dt * 0.7, SALT_R);
      salt.hop[i] += dt / salt.hopLen[i];
      if (salt.hop[i] >= 1) salt.hop[i] -= 1;
      const h = salt.hop[i];
      const x = cx + salt.ox[i];
      const z = cz + salt.oz[i];
      const y = groundY(x, z) + 0.01 + salt.hopH[i] * (0.5 + wind.gust) * 4 * h * (1 - h);
      salt.pos[i * 3] = x;
      salt.pos[i * 3 + 1] = y;
      salt.pos[i * 3 + 2] = z;
      const edge = 1 - Math.max(Math.abs(salt.ox[i]), Math.abs(salt.oz[i])) / SALT_R;
      salt.alpha[i] = Math.min(1, edge * 4) * saltVis * (0.5 + 0.5 * Math.sin(h * Math.PI));
    }
    saltGeom.attributes.position.needsUpdate = true;
    saltGeom.attributes.aAlpha.needsUpdate = true;

    // suspended motes: drift with the wind, slow turbulent wobble
    for (let i = 0; i < MOTE_N; i++) {
      const ph = mote.ph[i];
      mote.ox[i] = wrap(mote.ox[i] + (wind.x * k * 0.55 + Math.sin(t * 0.7 + ph) * 0.15) * dt, MOTE_R);
      mote.oz[i] = wrap(mote.oz[i] + (wind.z * k * 0.55 + Math.cos(t * 0.6 + ph) * 0.15) * dt, MOTE_R);
      const x = cx + mote.ox[i];
      const z = cz + mote.oz[i];
      mote.pos[i * 3] = x;
      mote.pos[i * 3 + 1] = groundY(x, z) + mote.oy[i] + Math.sin(t * 0.9 + ph) * 0.12;
      mote.pos[i * 3 + 2] = z;
    }
    moteGeom.attributes.position.needsUpdate = true;
    // forward scattering: dust glows when you look towards the Sun
    camera.getWorldDirection(viewDir);
    const toSun = Math.max(0, viewDir.dot(sunDir));
    moteMat.uniforms.uOpacity.value = (0.06 + 0.55 * toSun ** 3 + 0.12 * wind.gust) * strength;

    // dust sheets: drift and fade in / out; stronger in gusts
    camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    sheetMat.uniforms.uCamRight.value.copy(camRight);
    sheetMat.uniforms.uCamUp.value.copy(camUp);
    for (let i = 0; i < SHEET_N; i++) {
      sheet.age[i] += dt;
      sheet.x[i] += wind.x * k * 0.8 * dt;
      sheet.z[i] += wind.z * k * 0.8 * dt;
      const far = Math.hypot(sheet.x[i] - cx, sheet.z[i] - cz) > SHEET_R * 1.3;
      if (sheet.age[i] > sheet.life[i] || far) respawnSheet(i, cx, cz, true);
      const life = sheet.age[i] / sheet.life[i];
      const fade = Math.sin(Math.min(1, life) * Math.PI);
      const a = fade * (0.03 + 0.15 * wind.gust) * strength;
      const y = groundY(sheet.x[i], sheet.z[i]) - 0.3;
      const grow = sheet.size[i] * (0.8 + 0.5 * life);
      for (let c = 0; c < 4; c++) {
        const o = i * 4 + c;
        sPos[o * 3] = sheet.x[i];
        sPos[o * 3 + 1] = y;
        sPos[o * 3 + 2] = sheet.z[i];
        sSA[o * 2] = grow;
        sSA[o * 2 + 1] = a;
      }
    }
    sheetGeom.attributes.position.needsUpdate = true;
    sheetGeom.attributes.aUvRect.needsUpdate = true;
    sheetGeom.attributes.aSizeAlpha.needsUpdate = true;
  }

  return {
    group,
    update,
    wind,
    setEnabled(on) {
      enabled = Boolean(on);
      group.visible = enabled;
    },
    /** Point sizes are in pixels at 1 m; keep them right when the render size changes. */
    setPixelScale(heightPx) {
      const s = heightPx / 260;
      saltMat.uniforms.uScale.value = s;
      moteMat.uniforms.uScale.value = s;
    },
  };
}
