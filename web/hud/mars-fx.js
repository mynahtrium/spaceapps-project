/**
 * Martian Atmosphere, Ground-Hugging Aeolian Dust & Multi-Stage Impact Plumes (`web/hud/mars-fx.js`).
 *
 * Zero external textures — synthesizes organic wispy dust & angular basalt/hematite regolith clods
 * in memory and drives:
 * 1. Low, sparse ground-skimming aeolian dust wisps hugging the terrain floor (`0.04..0.56 m`).
 * 2. Sparse eye-level sunlit saltation grains (`0.06..1.95 m` max) keeping the mountain horizon sharp.
 * 3. Expanding kinetic bootstep & rover tire plumes (`0.55x -> 2.75x` billow + wind shear).
 * 4. Pro Jump & Landing Impact FX (`emitJumpBurst`): 360° radial ground shockwave dust skirt,
 *    dual-boot convection vortex plumes, and ballistic 3.71 m/s^2 Martian regolith pebbles/clods.
 * 5. Dynamic Gale crater atmospheric haze (`FogExp2`).
 */

import * as THREE from "three";

const WISP_COUNT = 100;
const MOTE_COUNT = 160;
const PLUME_COUNT = 420;
const CLOD_COUNT = 220;
const AMBIENT_SPAN_M = 40;
const MOTE_HEIGHT_M = 1.95;
const WISP_HEIGHT_M = 0.56;
const MARS_GRAVITY_MS2 = 3.71;

export function computeAtmosphericState(clockT, weatherEnabled) {
  if (!weatherEnabled) {
    return {
      windX: 2.0,
      windZ: 0.8,
      gustFactor: 0.2,
      fogDensity: 0.00042,
      fogColorHex: 0xc27f54,
      ambientOpacity: 0.18,
    };
  }
  const waveA = Math.sin(clockT * 0.14 + 0.8) * 0.5 + 0.5;
  const waveB = Math.sin(clockT * 0.37 + 2.1) * 0.5 + 0.5;
  const gust = 0.28 + 0.52 * waveA + 0.2 * waveB;
  const windAngle = 0.38 + Math.sin(clockT * 0.07) * 0.38;
  const windSpeed = 3.6 + gust * 8.4; // m/s REMS daytime convective wind gusts
  return {
    windX: Math.cos(windAngle) * windSpeed,
    windZ: Math.sin(windAngle) * windSpeed,
    gustFactor: gust,
    fogDensity: 0.00062 + gust * 0.00052,
    fogColorHex: 0xb9764c,
    ambientOpacity: 0.22 + gust * 0.24,
  };
}

/**
 * Generates an organic multi-lobe billowing dust cloud texture (`128x128 RGBA`)
 * so particles read as swirling silicate/hematite dust wisps rather than geometric dots.
 */
function makeWispyDustTexture() {
  const sz = 128;
  const data = new Uint8Array(sz * sz * 4);
  const blobs = [
    [0.5, 0.5, 0.44, 0.65],
    [0.36, 0.44, 0.31, 0.45],
    [0.64, 0.54, 0.32, 0.45],
    [0.46, 0.63, 0.28, 0.4],
    [0.56, 0.35, 0.26, 0.38],
  ];
  for (let y = 0; y < sz; y++) {
    const v = (y + 0.5) / sz;
    for (let x = 0; x < sz; x++) {
      const u = (x + 0.5) / sz;
      const radial = Math.hypot(u - 0.5, v - 0.5) * 2.0;
      const edgeFade = Math.max(0, 1.0 - radial * radial);

      let density = 0;
      for (const [bx, by, br, bw] of blobs) {
        const d = Math.hypot(u - bx, v - by) / br;
        if (d < 1) density += Math.pow(1 - d * d, 1.8) * bw;
      }
      const fbm =
        0.78 +
        0.14 * Math.sin(u * 19.0 + Math.cos(v * 17.0) * 2.1) +
        0.08 * Math.cos(v * 31.0 - u * 23.0);
      const alpha = Math.max(0, Math.min(1, density * edgeFade * fbm));
      const shade = 0.88 + 0.12 * (1 - v);
      const lum = Math.max(0, Math.min(255, Math.round(shade * 255)));
      const idx = (y * sz + x) * 4;
      data[idx] = lum;
      data[idx + 1] = lum;
      data[idx + 2] = lum;
      data[idx + 3] = Math.round(alpha * 255);
    }
  }
  const tex = new THREE.DataTexture(data, sz, sz, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates an angular regolith grit/pebble sprite (`64x64 RGBA`) for crisp ballistic
 * Martian soil clods thrown up on jumps, landings, and hard footsteps.
 */
function makeClodTexture() {
  const sz = 64;
  const data = new Uint8Array(sz * sz * 4);
  for (let y = 0; y < sz; y++) {
    const v = (y + 0.5) / sz - 0.5;
    for (let x = 0; x < sz; x++) {
      const u = (x + 0.5) / sz - 0.5;
      const ang = Math.atan2(v, u);
      const r = Math.hypot(u, v);
      const facet = 0.34 + 0.08 * Math.sin(ang * 3.0 + 0.7) + 0.05 * Math.cos(ang * 5.0 - 1.2);
      const inside = r < facet ? Math.min(1, (facet - r) * 14.0) : 0;
      const lit = Math.max(0.45, Math.min(1.0, 0.82 - v * 0.7 - u * 0.25));
      const idx = (y * sz + x) * 4;
      data[idx] = Math.round(lit * 255);
      data[idx + 1] = Math.round(lit * 255);
      data[idx + 2] = Math.round(lit * 255);
      data[idx + 3] = Math.round(inside * 255);
    }
  }
  const tex = new THREE.DataTexture(data, sz, sz, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

const DUST_VERT = `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aAngle;
  uniform float uPixelHeight;
  uniform float uNearFadeStart;
  uniform float uNearFadeEnd;
  varying float vAlpha;
  varying float vAngle;
  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    float dist = max(0.35, -mvPos.z);
    float nearFade = smoothstep(uNearFadeStart, uNearFadeEnd, dist);
    float farFade = 1.0 - smoothstep(16.0, 32.0, dist);
    vAlpha = aAlpha * nearFade * farFade;
    vAngle = aAngle;
    gl_PointSize = clamp(aSize * (uPixelHeight / dist), 1.5, 220.0);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const DUST_FRAG = `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vAngle;
  void main() {
    if (vAlpha <= 0.004) discard;
    vec2 p = gl_PointCoord - vec2(0.5);
    float c = cos(vAngle);
    float s = sin(vAngle);
    vec2 ruv = vec2(p.x * c - p.y * s, p.x * s + p.y * c) + vec2(0.5);
    vec4 tex = texture2D(uMap, ruv);
    float a = tex.a * vAlpha * uOpacity;
    if (a <= 0.004) discard;
    gl_FragColor = vec4(tex.rgb * uColor, a);
  }
`;

function makeDustMaterial(tex, colorHex, opacity = 1.0, nearStart = 0.65, nearEnd = 2.2) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: tex },
      uColor: { value: new THREE.Color(colorHex) },
      uOpacity: { value: opacity },
      uPixelHeight: { value: typeof window !== "undefined" ? window.innerHeight * 0.72 : 650 },
      uNearFadeStart: { value: nearStart },
      uNearFadeEnd: { value: nearEnd },
    },
    vertexShader: DUST_VERT,
    fragmentShader: DUST_FRAG,
    transparent: true,
    depthWrite: false,
  });
}

export function createMarsFxSystem(scene, sampleElevSceneY) {
  const wispTex = makeWispyDustTexture();
  const clodTex = makeClodTexture();

  // ---------- 1. Low, sparse ground-skimming aeolian dust wisps (0.04..0.56 m above sand) ----------
  const wispPos = new Float32Array(WISP_COUNT * 3);
  const wispSize = new Float32Array(WISP_COUNT);
  const wispAlpha = new Float32Array(WISP_COUNT);
  const wispAngle = new Float32Array(WISP_COUNT);
  const wispSeeds = new Float32Array(WISP_COUNT * 4);
  for (let i = 0; i < WISP_COUNT; i++) {
    wispPos[i * 3] = (Math.random() - 0.5) * AMBIENT_SPAN_M;
    wispPos[i * 3 + 1] = 0.05 + Math.random() * WISP_HEIGHT_M;
    wispPos[i * 3 + 2] = (Math.random() - 0.5) * AMBIENT_SPAN_M;
    wispSize[i] = 0.85 + Math.random() * 1.25;
    wispAlpha[i] = 0.1 + Math.random() * 0.15;
    wispAngle[i] = Math.random() * Math.PI * 2;
    wispSeeds[i * 4] = 0.75 + Math.random() * 0.85; // wind factor
    wispSeeds[i * 4 + 1] = Math.random() * Math.PI * 2; // wave phase
    wispSeeds[i * 4 + 2] = 0.04 + Math.random() * 0.44; // tight ground-floor height
    wispSeeds[i * 4 + 3] = (Math.random() - 0.5) * 0.5; // spin rate
  }
  const wispGeom = new THREE.BufferGeometry();
  wispGeom.setAttribute("position", new THREE.BufferAttribute(wispPos, 3));
  wispGeom.setAttribute("aSize", new THREE.BufferAttribute(wispSize, 1));
  wispGeom.setAttribute("aAlpha", new THREE.BufferAttribute(wispAlpha, 1));
  wispGeom.setAttribute("aAngle", new THREE.BufferAttribute(wispAngle, 1));
  const wispMat = makeDustMaterial(wispTex, 0xd88f60, 0.34, 0.85, 2.5);
  const wispPoints = new THREE.Points(wispGeom, wispMat);
  wispPoints.frustumCulled = false;
  scene.add(wispPoints);

  // ---------- 2. Sparse sunlit saltation grains & suspended dust motes (< 1.95 m) ----------
  const motePos = new Float32Array(MOTE_COUNT * 3);
  const moteSize = new Float32Array(MOTE_COUNT);
  const moteAlpha = new Float32Array(MOTE_COUNT);
  const moteAngle = new Float32Array(MOTE_COUNT);
  const moteSeeds = new Float32Array(MOTE_COUNT * 3);
  for (let i = 0; i < MOTE_COUNT; i++) {
    motePos[i * 3] = (Math.random() - 0.5) * AMBIENT_SPAN_M;
    motePos[i * 3 + 1] = 0.06 + Math.random() * MOTE_HEIGHT_M;
    motePos[i * 3 + 2] = (Math.random() - 0.5) * AMBIENT_SPAN_M;
    moteSize[i] = 0.04 + Math.random() * 0.08;
    moteAlpha[i] = 0.22 + Math.random() * 0.32;
    moteAngle[i] = Math.random() * Math.PI * 2;
    moteSeeds[i * 3] = 0.85 + Math.random() * 0.85;
    moteSeeds[i * 3 + 1] = Math.random() * Math.PI * 2;
    moteSeeds[i * 3 + 2] = 0.4 + Math.random() * 1.1;
  }
  const moteGeom = new THREE.BufferGeometry();
  moteGeom.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
  moteGeom.setAttribute("aSize", new THREE.BufferAttribute(moteSize, 1));
  moteGeom.setAttribute("aAlpha", new THREE.BufferAttribute(moteAlpha, 1));
  moteGeom.setAttribute("aAngle", new THREE.BufferAttribute(moteAngle, 1));
  const moteMat = makeDustMaterial(wispTex, 0xf2b07e, 0.36, 0.7, 2.0);
  const motePoints = new THREE.Points(moteGeom, moteMat);
  motePoints.frustumCulled = false;
  scene.add(motePoints);

  // ---------- 3. Expanding kinetic bootstep, landing shockwave & rover wheel plumes ----------
  const plumePos = new Float32Array(PLUME_COUNT * 3);
  const plumeSize = new Float32Array(PLUME_COUNT);
  const plumeAlpha = new Float32Array(PLUME_COUNT);
  const plumeAngle = new Float32Array(PLUME_COUNT);
  const plumeVel = new Float32Array(PLUME_COUNT * 3);
  const plumeBaseSize = new Float32Array(PLUME_COUNT);
  const plumeGrowth = new Float32Array(PLUME_COUNT);
  const plumePeakAlpha = new Float32Array(PLUME_COUNT);
  const plumeSpin = new Float32Array(PLUME_COUNT);
  const plumeLife = new Float32Array(PLUME_COUNT);
  const plumeMaxLife = new Float32Array(PLUME_COUNT);
  for (let i = 0; i < PLUME_COUNT; i++) {
    plumePos[i * 3 + 1] = -9999;
    plumeSize[i] = 0.5;
    plumeAlpha[i] = 0;
    plumeGrowth[i] = 2.2;
    plumePeakAlpha[i] = 0.72;
    plumeMaxLife[i] = 1;
  }
  const plumeGeom = new THREE.BufferGeometry();
  plumeGeom.setAttribute("position", new THREE.BufferAttribute(plumePos, 3));
  plumeGeom.setAttribute("aSize", new THREE.BufferAttribute(plumeSize, 1));
  plumeGeom.setAttribute("aAlpha", new THREE.BufferAttribute(plumeAlpha, 1));
  plumeGeom.setAttribute("aAngle", new THREE.BufferAttribute(plumeAngle, 1));
  // Lower nearFadeStart slightly so looking down at boot landing plumes remains vibrant & dramatic!
  const plumeMat = makeDustMaterial(wispTex, 0xe49c69, 0.92, 0.42, 1.35);
  const plumePoints = new THREE.Points(plumeGeom, plumeMat);
  plumePoints.frustumCulled = false;
  scene.add(plumePoints);

  // ---------- 4. Ballistic Martian regolith pebbles & soil clods (3.71 m/s^2 + ground bounce) ----------
  const clodPos = new Float32Array(CLOD_COUNT * 3);
  const clodSize = new Float32Array(CLOD_COUNT);
  const clodAlpha = new Float32Array(CLOD_COUNT);
  const clodAngle = new Float32Array(CLOD_COUNT);
  const clodVel = new Float32Array(CLOD_COUNT * 3);
  const clodSpin = new Float32Array(CLOD_COUNT);
  const clodLife = new Float32Array(CLOD_COUNT);
  const clodMaxLife = new Float32Array(CLOD_COUNT);
  const clodBounced = new Uint8Array(CLOD_COUNT);
  for (let i = 0; i < CLOD_COUNT; i++) {
    clodPos[i * 3 + 1] = -9999;
    clodSize[i] = 0.05;
    clodAlpha[i] = 0;
    clodMaxLife[i] = 1;
  }
  const clodGeom = new THREE.BufferGeometry();
  clodGeom.setAttribute("position", new THREE.BufferAttribute(clodPos, 3));
  clodGeom.setAttribute("aSize", new THREE.BufferAttribute(clodSize, 1));
  clodGeom.setAttribute("aAlpha", new THREE.BufferAttribute(clodAlpha, 1));
  clodGeom.setAttribute("aAngle", new THREE.BufferAttribute(clodAngle, 1));
  const clodMat = makeDustMaterial(clodTex, 0x9b5130, 0.94, 0.35, 0.9);
  const clodPoints = new THREE.Points(clodGeom, clodMat);
  clodPoints.frustumCulled = false;
  scene.add(clodPoints);

  let plumeCursor = 0;
  let clodCursor = 0;
  let lastWindState = computeAtmosphericState(0, true);

  function spawnPlumeParticle(x, y, z, vx, vy, vz, baseSize, life, growth = 2.2, peakAlpha = 0.72, spin = 1.4) {
    const i = plumeCursor;
    plumeCursor = (plumeCursor + 1) % PLUME_COUNT;
    plumePos[i * 3] = x;
    plumePos[i * 3 + 1] = y;
    plumePos[i * 3 + 2] = z;
    plumeVel[i * 3] = vx;
    plumeVel[i * 3 + 1] = vy;
    plumeVel[i * 3 + 2] = vz;
    plumeBaseSize[i] = baseSize;
    plumeGrowth[i] = growth;
    plumePeakAlpha[i] = peakAlpha;
    plumeSize[i] = baseSize * 0.45;
    plumeAngle[i] = Math.random() * Math.PI * 2;
    plumeSpin[i] = (Math.random() - 0.5) * spin * 2;
    plumeLife[i] = life;
    plumeMaxLife[i] = life;
    plumeAlpha[i] = peakAlpha * 0.85;
  }

  function spawnClodParticle(x, y, z, vx, vy, vz, size, life) {
    const i = clodCursor;
    clodCursor = (clodCursor + 1) % CLOD_COUNT;
    clodPos[i * 3] = x;
    clodPos[i * 3 + 1] = y;
    clodPos[i * 3 + 2] = z;
    clodVel[i * 3] = vx;
    clodVel[i * 3 + 1] = vy;
    clodVel[i * 3 + 2] = vz;
    clodSize[i] = size;
    clodAngle[i] = Math.random() * Math.PI * 2;
    clodSpin[i] = (Math.random() - 0.5) * 9.0;
    clodLife[i] = life;
    clodMaxLife[i] = life;
    clodAlpha[i] = 1.0;
    clodBounced[i] = 0;
  }

  function emitBurst(x, y, z, count = 8, speedScale = 1.0, baseVx = 0, baseVz = 0) {
    if (!plumePoints.visible) return;
    for (let k = 0; k < count; k++) {
      const ang = Math.random() * Math.PI * 2;
      const radial = (0.35 + Math.random() * 1.1) * speedScale;
      const bSize = 0.36 + Math.random() * 0.42 * Math.max(0.7, speedScale);
      const life = 0.72 + Math.random() * 0.85;
      spawnPlumeParticle(
        x + (Math.random() - 0.5) * 0.28,
        y + 0.06 + Math.random() * 0.12,
        z + (Math.random() - 0.5) * 0.28,
        baseVx + Math.cos(ang) * radial,
        (0.45 + Math.random() * 1.0) * speedScale,
        baseVz + Math.sin(ang) * radial,
        bSize,
        life,
        2.1,
        0.68,
        1.6
      );
    }
  }

  /**
   * Pro multi-stage Martian jump & landing FX:
   * - Stage A: Low radial 360° ground shockwave vortex skirt curling fast outward along the regolith
   * - Stage B: Localized left & right boot impact convection plumes drifting downrange in Gale wind
   * - Stage C: Crisp ballistic regolith clods & pebbles obeying 3.71 m/s^2 gravity + ground bounce
   */
  function emitJumpBurst(
    x,
    y,
    z,
    { mode = "landing", impactSpeed = 1.7, rightX = 1, rightZ = 0, fwdX = 0, fwdZ = -1, vx = 0, vz = 0 } = {}
  ) {
    if (!plumePoints.visible) return;
    const isLanding = mode === "landing";
    const power = isLanding ? Math.max(0.85, Math.min(2.35, 0.75 + impactSpeed * 0.38)) : 1.05;

    // 1. 360° expanding radial ground-hugging shockwave torus around boot contact patch
    const ringCount = isLanding ? Math.min(34, Math.round(18 + power * 7)) : 16;
    for (let k = 0; k < ringCount; k++) {
      const theta = (k / ringCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.28;
      const side = (k % 2 === 0 ? -1 : 1) * 0.15;
      const bx = x + rightX * side + Math.cos(theta) * 0.18;
      const bz = z + rightZ * side + Math.sin(theta) * 0.18;
      const radialSpeed = (isLanding ? 2.1 + Math.random() * 2.2 : 1.3 + Math.random() * 1.4) * power;
      const backBias = isLanding ? 0.15 : -0.45;
      spawnPlumeParticle(
        bx,
        y + 0.04 + Math.random() * 0.07,
        bz,
        vx * 0.25 + Math.cos(theta) * radialSpeed + fwdX * backBias,
        (isLanding ? 0.16 + Math.random() * 0.38 : 0.22 + Math.random() * 0.45) * power,
        vz * 0.25 + Math.sin(theta) * radialSpeed + fwdZ * backBias,
        (isLanding ? 0.34 : 0.28) + Math.random() * 0.28 * power,
        isLanding ? 0.95 + Math.random() * 0.85 : 0.72 + Math.random() * 0.55,
        isLanding ? 2.85 : 2.25,
        isLanding ? 0.76 : 0.62,
        2.4
      );
    }

    // 2. Dual-boot churning convection column rising gently under both feet
    const coreCount = isLanding ? Math.min(14, Math.round(7 + power * 3)) : 6;
    for (let k = 0; k < coreCount; k++) {
      const side = (k % 2 === 0 ? -1 : 1) * 0.16;
      const ang = Math.random() * Math.PI * 2;
      const spr = (0.3 + Math.random() * 0.75) * power;
      spawnPlumeParticle(
        x + rightX * side + (Math.random() - 0.5) * 0.14,
        y + 0.1 + Math.random() * 0.18,
        z + rightZ * side + (Math.random() - 0.5) * 0.14,
        vx * 0.2 + Math.cos(ang) * spr,
        (isLanding ? 0.68 + Math.random() * 0.95 : 0.52 + Math.random() * 0.75) * power,
        vz * 0.2 + Math.sin(ang) * spr,
        0.48 + Math.random() * 0.42 * power,
        isLanding ? 1.15 + Math.random() * 0.95 : 0.85 + Math.random() * 0.65,
        2.45,
        isLanding ? 0.64 : 0.52,
        1.9
      );
    }

    // 3. Ballistic Martian soil clods & pebbles arcing under 3.71 m/s^2 + ground bounce
    const clodCount = isLanding ? Math.min(30, Math.round(14 + power * 7)) : 10;
    for (let k = 0; k < clodCount; k++) {
      const side = (k % 2 === 0 ? -1 : 1) * 0.15;
      const ang = Math.random() * Math.PI * 2;
      const horiz = (isLanding ? 1.0 + Math.random() * 2.4 : 0.8 + Math.random() * 1.7) * power;
      const vert = (isLanding ? 1.25 + Math.random() * 2.0 : 1.05 + Math.random() * 1.5) * power;
      spawnClodParticle(
        x + rightX * side + Math.cos(ang) * 0.12,
        y + 0.06 + Math.random() * 0.08,
        z + rightZ * side + Math.sin(ang) * 0.12,
        vx * 0.25 + Math.cos(ang) * horiz - fwdX * (isLanding ? 0 : 0.6),
        vert,
        vz * 0.25 + Math.sin(ang) * horiz - fwdZ * (isLanding ? 0 : 0.6),
        0.028 + Math.random() * 0.048 * Math.min(1.4, power),
        1.15 + Math.random() * 0.9
      );
    }
  }

  function update(dt, camPos, clockT, { dustEnabled = true, weatherEnabled = true } = {}) {
    lastWindState = computeAtmosphericState(clockT, weatherEnabled);

    wispPoints.visible = dustEnabled;
    motePoints.visible = dustEnabled;
    plumePoints.visible = dustEnabled;
    clodPoints.visible = dustEnabled;

    if (scene.fog) {
      scene.fog.color.setHex(lastWindState.fogColorHex);
      scene.fog.density += (lastWindState.fogDensity - scene.fog.density) * Math.min(1, dt * 2.5);
    }
    if (!dustEnabled) return lastWindState;

    const pxH = typeof window !== "undefined" ? window.innerHeight * 0.72 : 650;
    wispMat.uniforms.uPixelHeight.value = pxH;
    moteMat.uniforms.uPixelHeight.value = pxH;
    plumeMat.uniforms.uPixelHeight.value = pxH;
    clodMat.uniforms.uPixelHeight.value = pxH;

    const half = AMBIENT_SPAN_M * 0.5;
    const cx = camPos.x;
    const cz = camPos.z;
    const cy = camPos.y;

    // 1. Low, sparse ground-hugging aeolian dust wisps
    wispMat.uniforms.uOpacity.value = 0.2 + lastWindState.gustFactor * 0.24;
    for (let i = 0; i < WISP_COUNT; i++) {
      const idx = i * 3;
      const sIdx = i * 4;
      const wMul = wispSeeds[sIdx];
      const ph = wispSeeds[sIdx + 1];
      const baseAlt = wispSeeds[sIdx + 2];
      const spin = wispSeeds[sIdx + 3];

      let px = wispPos[idx] + lastWindState.windX * wMul * dt * 0.52;
      let pz = wispPos[idx + 2] + lastWindState.windZ * wMul * dt * 0.52;
      const dx = px - cx;
      const dz = pz - cz;
      if (dx > half) px -= AMBIENT_SPAN_M;
      else if (dx < -half) px += AMBIENT_SPAN_M;
      if (dz > half) pz -= AMBIENT_SPAN_M;
      else if (dz < -half) pz += AMBIENT_SPAN_M;

      const groundY = sampleElevSceneY ? sampleElevSceneY(px, pz) : cy - 2;
      const swirlY = (Math.sin(clockT * 1.15 + ph) * 0.5 + 0.5) * 0.14 * (0.5 + lastWindState.gustFactor);
      wispPos[idx] = px;
      wispPos[idx + 1] = groundY + baseAlt + swirlY;
      wispPos[idx + 2] = pz;
      wispAngle[i] += spin * dt;
    }
    wispGeom.attributes.position.needsUpdate = true;
    wispGeom.attributes.aAngle.needsUpdate = true;

    // 2. Sparse sunlit saltation grains near surface
    moteMat.uniforms.uOpacity.value = lastWindState.ambientOpacity;
    for (let i = 0; i < MOTE_COUNT; i++) {
      const idx = i * 3;
      const wMul = moteSeeds[idx];
      const ph = moteSeeds[idx + 1];
      const f = moteSeeds[idx + 2];

      let px = motePos[idx] + lastWindState.windX * wMul * dt * 0.62;
      let py = motePos[idx + 1] + (Math.sin(clockT * f + ph) * 0.34 - 0.08) * dt;
      let pz = motePos[idx + 2] + lastWindState.windZ * wMul * dt * 0.62;

      const dx = px - cx;
      const dz = pz - cz;
      if (dx > half) px -= AMBIENT_SPAN_M;
      else if (dx < -half) px += AMBIENT_SPAN_M;
      if (dz > half) pz -= AMBIENT_SPAN_M;
      else if (dz < -half) pz += AMBIENT_SPAN_M;

      const groundY = sampleElevSceneY ? sampleElevSceneY(px, pz) : cy - 2;
      if (py < groundY + 0.04 || py > groundY + MOTE_HEIGHT_M) {
        py = groundY + 0.06 + Math.random() * (MOTE_HEIGHT_M * 0.85);
      }
      motePos[idx] = px;
      motePos[idx + 1] = py;
      motePos[idx + 2] = pz;
      moteAngle[i] += 0.35 * dt;
    }
    moteGeom.attributes.position.needsUpdate = true;

    // 3. Expanding kinetic boot, shockwave & tire dust plumes
    let anyPlume = false;
    for (let i = 0; i < PLUME_COUNT; i++) {
      if (plumeLife[i] <= 0) continue;
      anyPlume = true;
      plumeLife[i] -= dt;
      const idx = i * 3;
      if (plumeLife[i] <= 0) {
        plumePos[idx + 1] = -9999;
        plumeAlpha[i] = 0;
        continue;
      }

      const ageFrac = 1 - Math.max(0, Math.min(1, plumeLife[i] / plumeMaxLife[i]));
      // Aerodynamic regolith cloud expansion decelerates horizontally into ambient Mars breeze
      const dragRate = 2.4 + ageFrac * 1.4;
      plumeVel[idx] += (lastWindState.windX * 0.42 - plumeVel[idx]) * Math.min(1, dt * dragRate);
      plumeVel[idx + 2] += (lastWindState.windZ * 0.42 - plumeVel[idx + 2]) * Math.min(1, dt * dragRate);
      plumeVel[idx + 1] -= MARS_GRAVITY_MS2 * 0.24 * dt;

      plumePos[idx] += plumeVel[idx] * dt;
      plumePos[idx + 1] += plumeVel[idx + 1] * dt;
      plumePos[idx + 2] += plumeVel[idx + 2] * dt;

      const groundY = sampleElevSceneY ? sampleElevSceneY(plumePos[idx], plumePos[idx + 2]) : -9999;
      if (plumePos[idx + 1] < groundY + 0.05) {
        plumePos[idx + 1] = groundY + 0.05;
        if (plumeVel[idx + 1] < 0) plumeVel[idx + 1] *= -0.15;
      }

      plumeSize[i] = plumeBaseSize[i] * (0.45 + Math.pow(ageFrac, 0.72) * plumeGrowth[i]);
      plumeAngle[i] += plumeSpin[i] * (1 - ageFrac * 0.45) * dt;
      plumeAlpha[i] =
        Math.sin(Math.min(1, ageFrac * 4.2) * (Math.PI * 0.5)) *
        Math.pow(1 - ageFrac, 1.45) *
        plumePeakAlpha[i];
    }
    if (anyPlume) {
      plumeGeom.attributes.position.needsUpdate = true;
      plumeGeom.attributes.aSize.needsUpdate = true;
      plumeGeom.attributes.aAlpha.needsUpdate = true;
      plumeGeom.attributes.aAngle.needsUpdate = true;
    }

    // 4. Ballistic Martian regolith clods & pebbles (true 3.71 m/s^2 gravity + bounce)
    let anyClod = false;
    for (let i = 0; i < CLOD_COUNT; i++) {
      if (clodLife[i] <= 0) continue;
      anyClod = true;
      clodLife[i] -= dt;
      const idx = i * 3;
      if (clodLife[i] <= 0) {
        clodPos[idx + 1] = -9999;
        clodAlpha[i] = 0;
        continue;
      }

      clodVel[idx + 1] -= MARS_GRAVITY_MS2 * dt;
      clodPos[idx] += clodVel[idx] * dt;
      clodPos[idx + 1] += clodVel[idx + 1] * dt;
      clodPos[idx + 2] += clodVel[idx + 2] * dt;
      clodAngle[i] += clodSpin[i] * dt;

      const groundY = sampleElevSceneY ? sampleElevSceneY(clodPos[idx], clodPos[idx + 2]) : -9999;
      if (clodPos[idx + 1] <= groundY + 0.025) {
        clodPos[idx + 1] = groundY + 0.025;
        if (!clodBounced[i] && clodVel[idx + 1] < -0.45) {
          clodBounced[i] = 1;
          clodVel[idx + 1] = -clodVel[idx + 1] * 0.28;
          clodVel[idx] *= 0.55;
          clodVel[idx + 2] *= 0.55;
          clodSpin[i] *= 0.5;
        } else {
          clodVel[idx] *= 0.7;
          clodVel[idx + 1] = 0;
          clodVel[idx + 2] *= 0.7;
          clodSpin[i] = 0;
        }
      }
      const ageFrac = 1 - Math.max(0, Math.min(1, clodLife[i] / clodMaxLife[i]));
      clodAlpha[i] = ageFrac < 0.7 ? 0.92 : Math.max(0, (1 - ageFrac) / 0.3) * 0.92;
    }
    if (anyClod) {
      clodGeom.attributes.position.needsUpdate = true;
      clodGeom.attributes.aAlpha.needsUpdate = true;
      clodGeom.attributes.aAngle.needsUpdate = true;
    }

    return lastWindState;
  }

  return {
    emitBurst,
    emitJumpBurst,
    update,
    getWindState: () => lastWindState,
  };
}
