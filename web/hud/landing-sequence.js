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
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FLAME_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uThrottle;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    // vUv.y: 1 at the nozzle, 0 at the tip of the plume
    float along = vUv.y;
    float flick = 0.82 + 0.18 * hash(vec2(floor(uTime * 40.0), vUv.x * 7.0));
    float core = smoothstep(0.0, 0.85, along);
    vec3 hot = vec3(1.0, 0.93, 0.78);
    vec3 warm = vec3(1.0, 0.55, 0.18);
    vec3 col = mix(warm, hot, pow(core, 2.0));
    // shock diamonds: bright bands near the nozzle
    float diamonds = 0.5 + 0.5 * sin(along * 38.0 - uTime * 6.0);
    col += vec3(0.35, 0.3, 0.25) * diamonds * smoothstep(0.55, 1.0, along);
    float a = core * flick * uThrottle;
    gl_FragColor = vec4(col * a, a);
  }
`;

function buildLander(THREE) {
  const g = new THREE.Group();
  g.name = "crew-lander";
  const hull = new THREE.MeshStandardMaterial({ color: 0xdedcd6, roughness: 0.42, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.6, metalness: 0.5 });
  const shield = new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.85, metalness: 0.1 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc89b3c, roughness: 0.3, metalness: 0.9 });
  const add = (geom, mat, x, y, z) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const R = 2.1;
  // engine section, tank, crew cabin, nose
  add(new THREE.CylinderGeometry(R, R * 1.06, 2.2, 40), shield, 0, 2.6, 0);
  add(new THREE.CylinderGeometry(R, R, 7.5, 40), hull, 0, 7.45, 0);
  add(new THREE.CylinderGeometry(R * 1.01, R * 1.01, 0.35, 40), dark, 0, 11.3, 0);
  add(new THREE.CylinderGeometry(R * 0.92, R, 2.6, 40), hull, 0, 12.75, 0);
  add(new THREE.ConeGeometry(R * 0.92, 3.4, 40), hull, 0, 15.75, 0);
  // cabin windows (dark band) and a hatch
  add(new THREE.CylinderGeometry(R * 0.935, R * 0.935, 0.42, 40, 1, true, -0.6, 1.2), dark, 0, 13.1, 0);
  add(new THREE.BoxGeometry(1.1, 1.8, 0.12), dark, 0, 9.0, -R - 0.02);
  // engine bells
  const bells = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const bell = add(new THREE.CylinderGeometry(0.34, 0.7, 1.3, 24, 1, true), dark, Math.cos(a) * 0.95, 0.95, Math.sin(a) * 0.95);
    bell.material = new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.45, metalness: 0.8, side: THREE.DoubleSide, emissive: 0x000000 });
    bells.push(bell);
  }
  // gold thermal blanket ring
  add(new THREE.CylinderGeometry(R * 1.07, R * 1.07, 0.3, 40), gold, 0, 1.6, 0);

  // landing legs: hinge at the skirt, swing out and down when deployed
  const legs = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const hinge = new THREE.Group();
    hinge.position.set(Math.cos(a) * R * 0.95, 3.82, Math.sin(a) * R * 0.95); // feet reach the ground when deployed
    hinge.rotation.y = -a;
    g.add(hinge);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.22, 4.2, 0.3), dark);
    strut.position.y = -2.1;
    strut.castShadow = true;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.16, 20), dark);
    pad.position.y = -4.2;
    pad.castShadow = true;
    hinge.add(strut, pad);
    legs.push({ hinge, a });
  }

  // three engine plumes (open cones pointing down) + a glow light
  const flameMat = new THREE.ShaderMaterial({
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    uniforms: { uTime: { value: 0 }, uThrottle: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const flames = [];
  for (const bell of bells) {
    const geom = new THREE.ConeGeometry(0.62, 7, 20, 1, true);
    geom.rotateX(Math.PI); // tip down
    const f = new THREE.Mesh(geom, flameMat);
    f.position.set(bell.position.x, bell.position.y - 0.65 - 3.5, bell.position.z);
    f.frustumCulled = false;
    f.renderOrder = 5;
    g.add(f);
    flames.push(f);
  }
  const glow = new THREE.PointLight(0xffa04a, 0, 90, 1.6);
  glow.position.set(0, -2, 0);
  g.add(glow);
  return { group: g, legs, flames, flameMat, glow };
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

  // each hinge's local +X points radially outwards; turning it about local Z swings the foot out
  function placeLegs(deploy) {
    for (const leg of L.legs) leg.hinge.rotation.z = 0.04 + 0.44 * deploy;
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
    s = { t: reduced ? T_END - GLIDE_S * 0.4 : 0, ...o, groundY: sampleY(o.padX, o.padZ), shake: 0, dustAcc: 0, touched: false };
    s.fogBase = scene.fog?.density ?? null;
    L.group.visible = true;
    L.group.position.set(o.padX, s.groundY + H_START, o.padZ);
    L.group.rotation.set(0, o.yaw + 0.7, 0);
    placeLegs(0);
    ui.sub.textContent = o.site || "GALE CRATER · MOUNT SHARP";
    overlay.classList.add("on");
    document.body.classList.add("landing-active");
    setFade(1);
  }

  function finish() {
    if (!s) return;
    if (scene.fog && s.fogBase != null) scene.fog.density = s.fogBase;
    const pad = { x: s.padX, z: s.padZ };
    s = null;
    overlay.classList.remove("on");
    document.body.classList.remove("landing-active");
    setFade(0);
    L.flameMat.uniforms.uThrottle.value = 0;
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
  function update(dt, camera, clockT) {
    if (!s) return false;
    s.t += Math.min(0.05, dt);
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
    for (const f of L.flames) f.scale.set(1, 0.6 + p.throttle * 0.9, 1);
    L.glow.intensity = p.throttle * 260;

    // blasted regolith: the closer the engines get to the ground, the more and faster the dust
    if (marsFx && p.throttle > 0.05 && p.h < 70) {
      const k = 1 - p.h / 70;
      s.dustAcc += dt * (40 + 260 * k) * p.throttle;
      while (s.dustAcc >= 1) {
        s.dustAcc -= 1;
        const a = Math.random() * Math.PI * 2;
        const r = 1 + Math.random() * (3 + 10 * k);
        const x = s.padX + Math.cos(a) * r;
        const z = s.padZ + Math.sin(a) * r;
        marsFx.emitBurst(x, sampleY(x, z), z, 3, 1.2 + 2.2 * k, Math.cos(a) * 9 * k, Math.sin(a) * 9 * k);
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
    s.shake *= Math.exp(-dt * 2.2);

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
      const startPos = new THREE.Vector3(cx, sampleY(cx, cz) + 2.4, cz);
      camera.position.lerpVectors(startPos, eyePos, e);
      m4.lookAt(startPos, look.set(pad.x, gy + 6, pad.z), UP);
      camQ.setFromRotationMatrix(m4);
      camera.quaternion.slerpQuaternions(camQ, eyeQuat, e);
      setFade(0);
      overlay.classList.toggle("ending", u > 0.4);
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
