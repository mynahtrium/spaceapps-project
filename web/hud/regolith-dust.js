/**
 * Regolith dust kicked up by boots, wheels, jumps and landings, plus fading tire tracks
 * (`web/hud/regolith-dust.js`).
 *
 * Two particle populations, both stepped on the CPU and drawn as `THREE.Points`:
 *  - Sand grains (~0.1-1 mm): ballistic arcs under Mars gravity (3.71 m/s²). The atmosphere is
 *    about 1 % of Earth's, so drag on a grain is small; grains land and stop.
 *  - Fine dust (a few µm): leaves the ground with the grains but is slowed quickly by the thin air,
 *    spreads out and falls at a few centimetres per second, so a puff lingers and drifts before it
 *    settles. It is lit by the sun with strong forward scattering (bright when looking towards it).
 * Both take the colour of the ground they came from (`sampleGroundColor`), so dust kicked off dark
 * rock is darker than dust kicked off bright soil.
 *
 * Illustrative, not a simulation: drag rates, settling speed and the light breeze are chosen to
 * look like rover and lander footage, not computed from a particle-size distribution.
 * There is no weather: no dust devils, storms or gusts.
 */

export const MARS_G = 3.71;

/** Tunables. Rates are per second; speeds in m/s. */
export const DUST_PHYSICS = Object.freeze({
  grainDrag: 0.35, // velocity decay of sand grains in the thin CO2 air
  fineDrag: 2.4, // fine dust is slowed within ~0.5 s
  fineSettle: 0.07, // terminal fall speed of fine dust
  fineSpread: 0.55, // growth of a puff's radius, m/s, slowing with age
  breezeX: 0.45, // steady light breeze the fine dust drifts with
  breezeZ: 0.2,
  grainRestitution: 0.12, // grains barely bounce on loose soil
});

/** Default dust colour (sRGB 0-1) when no ground colour is known: Mars bright-region dust. */
export const DEFAULT_DUST_RGB = Object.freeze([0.69, 0.5, 0.36]);

/**
 * One step of a sand grain. `p` = { x, y, z, vx, vy, vz }; `groundY` is the surface under it.
 * Returns true while the grain is still flying.
 */
export function stepGrain(p, dt, groundY, g = MARS_G, cfg = DUST_PHYSICS) {
  const k = Math.exp(-cfg.grainDrag * dt);
  p.vx *= k;
  p.vz *= k;
  p.vy = p.vy * k - g * dt;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.z += p.vz * dt;
  if (p.y <= groundY) {
    p.y = groundY;
    if (p.vy < -0.6) {
      p.vy = -p.vy * cfg.grainRestitution;
      p.vx *= 0.35;
      p.vz *= 0.35;
      return true;
    }
    p.vx = p.vy = p.vz = 0;
    return false;
  }
  return true;
}

/**
 * One step of a fine-dust puff. Drag pulls its velocity towards the breeze plus a slow settling
 * fall; it never goes below the ground. `p.r` (radius) grows as the puff spreads.
 */
export function stepFine(p, dt, groundY, cfg = DUST_PHYSICS) {
  const k = Math.exp(-cfg.fineDrag * dt);
  p.vx = cfg.breezeX + (p.vx - cfg.breezeX) * k;
  p.vz = cfg.breezeZ + (p.vz - cfg.breezeZ) * k;
  p.vy = -cfg.fineSettle + (p.vy + cfg.fineSettle) * k;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.z += p.vz * dt;
  if (p.y < groundY + p.r * 0.35) {
    p.y = groundY + p.r * 0.35;
    if (p.vy < 0) p.vy = 0;
  }
  p.r += cfg.fineSpread * dt / (1 + p.age * 1.6);
  p.age += dt;
}

const FINE_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  varying vec3 vWorld;
  uniform float uScale;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 mv = viewMatrix * world;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize * uScale / max(0.05, -mv.z), 0.0, 512.0);
    vAlpha = aAlpha;
    vColor = aColor;
  }
`;

const FINE_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uAmbient;
  uniform vec3 uCamPos;
  uniform float uSunUp;
  varying float vAlpha;
  varying vec3 vColor;
  varying vec3 vWorld;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    if (r > 1.0) discard;
    // soft, slightly lumpy edge so puffs do not read as discs
    float lump = 0.85 + 0.15 * hash(floor(gl_PointCoord * 6.0) + floor(vWorld.xz * 3.0));
    float density = pow(1.0 - r * r, 1.6) * lump;
    vec3 view = normalize(vWorld - uCamPos);
    // Henyey-Greenstein, g = 0.6: Mars dust scatters strongly forward
    float g = 0.6;
    float cosT = dot(view, uSunDir);
    float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5) / 12.566;
    vec3 base = pow(vColor, vec3(2.2)); // ground colours are sRGB
    vec3 lit = base * (uAmbient + uSunColor * uSunUp * (0.35 + hg * 6.0));
    gl_FragColor = vec4(lit, density * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const GRAIN_FRAG = /* glsl */ `
  uniform vec3 uSunColor;
  uniform vec3 uAmbient;
  uniform float uSunUp;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    if (dot(c, c) > 0.25) discard;
    vec3 lit = pow(vColor, vec3(2.2)) * 0.8 * (uAmbient + uSunColor * uSunUp * 0.7);
    gl_FragColor = vec4(lit, vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const TRACK_VERT = /* glsl */ `
  attribute float aBirth;
  varying vec2 vUv;
  varying float vBirth;
  void main() {
    vUv = uv;
    vBirth = aBirth;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const TRACK_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uFadeS;
  varying vec2 vUv;
  varying float vBirth;
  void main() {
    float age = uTime - vBirth;
    if (vBirth < 0.0 || age > uFadeS) discard;
    float fade = 1.0 - smoothstep(uFadeS * 0.45, uFadeS, age);
    // tread: chevron grousers across the track, soft compressed edges
    float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
    float tread = 0.55 + 0.45 * step(0.5, fract(vUv.y * 2.0 + abs(vUv.x - 0.5) * 1.2));
    float a = edge * tread * 0.32 * fade;
    gl_FragColor = vec4(0.12, 0.07, 0.045, a);
  }
`;

/**
 * @param THREE three.js namespace
 * @param scene scene to add the points to
 * @param opts.sampleGroundY  (x, z) => surface height under a point
 * @param opts.sampleGroundColor optional (x, z, out[3]) => out filled with sRGB 0-1 ground colour
 */
export function createRegolithDust(THREE, scene, { sampleGroundY, sampleGroundColor = null, fineMax = 1400, grainMax = 900 } = {}) {
  const groundY = (x, z) => (sampleGroundY ? sampleGroundY(x, z) : 0);
  const colorScratch = [0, 0, 0];
  const groundColor = (x, z) => {
    if (sampleGroundColor && sampleGroundColor(x, z, colorScratch)) return colorScratch;
    colorScratch[0] = DEFAULT_DUST_RGB[0];
    colorScratch[1] = DEFAULT_DUST_RGB[1];
    colorScratch[2] = DEFAULT_DUST_RGB[2];
    return colorScratch;
  };

  function makePool(n) {
    return Array.from({ length: n }, () => ({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 0, age: 0, life: 1, a0: 1, cr: 0, cg: 0, cb: 0 }));
  }
  const fine = makePool(fineMax);
  const grains = makePool(grainMax);
  let fineCursor = 0;
  let grainCursor = 0;

  function makePoints(n, frag, scaleBase) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geom.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    geom.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    geom.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geom.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      vertexShader: FINE_VERT,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uScale: { value: scaleBase },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 0.93, 0.85) },
        uAmbient: { value: new THREE.Color(0.32, 0.22, 0.16) },
        uCamPos: { value: new THREE.Vector3() },
        uSunUp: { value: 1 },
      },
    });
    const pts = new THREE.Points(geom, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    scene.add(pts);
    return pts;
  }
  const finePoints = makePoints(fineMax, FINE_FRAG, 600);
  const grainPoints = makePoints(grainMax, GRAIN_FRAG, 600);

  // ---- tire tracks: instanced quads that fade out over a few minutes ----
  const TRACK_MAX = 1600;
  const TRACK_FADE_S = 240;
  const trackGeom = new THREE.PlaneGeometry(1, 1);
  trackGeom.rotateX(-Math.PI / 2);
  const trackBirth = new Float32Array(TRACK_MAX).fill(-1);
  trackGeom.setAttribute("aBirth", new THREE.InstancedBufferAttribute(trackBirth, 1).setUsage(THREE.DynamicDrawUsage));
  const trackMat = new THREE.ShaderMaterial({
    vertexShader: TRACK_VERT,
    fragmentShader: TRACK_FRAG,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    uniforms: { uTime: { value: 0 }, uFadeS: { value: TRACK_FADE_S } },
  });
  const tracks = new THREE.InstancedMesh(trackGeom, trackMat, TRACK_MAX);
  tracks.frustumCulled = false;
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < TRACK_MAX; i++) tracks.setMatrixAt(i, hidden);
  scene.add(tracks);
  let trackCursor = 0;
  const trackPos = new Float32Array(TRACK_MAX * 2);
  const dummy = new THREE.Object3D();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const qTilt = new THREE.Quaternion();
  const qYaw = new THREE.Quaternion();
  const nrm = new THREE.Vector3();
  let clock = 0;

  /** Lay one tire-track segment (width x length metres) on the ground, aligned with `yaw`. */
  function stampTrack(x, y, z, normal, yaw, widthM = 0.4, lengthM = 0.5) {
    nrm.set(normal?.x ?? 0, normal?.y ?? 1, normal?.z ?? 0);
    if (nrm.lengthSq() < 1e-6) nrm.set(0, 1, 0);
    nrm.normalize();
    qTilt.setFromUnitVectors(yAxis, nrm);
    qYaw.setFromAxisAngle(yAxis, yaw || 0);
    dummy.position.set(x, y + 0.015, z);
    dummy.quaternion.copy(qTilt).multiply(qYaw);
    dummy.scale.set(widthM, 1, lengthM);
    dummy.updateMatrix();
    tracks.setMatrixAt(trackCursor, dummy.matrix);
    trackBirth[trackCursor] = clock;
    trackPos[trackCursor * 2] = x;
    trackPos[trackCursor * 2 + 1] = z;
    trackCursor = (trackCursor + 1) % TRACK_MAX;
    tracks.instanceMatrix.needsUpdate = true;
    trackGeom.attributes.aBirth.needsUpdate = true;
  }

  function spawnFine(x, y, z, vx, vy, vz, r, life, alpha) {
    const p = fine[fineCursor];
    fineCursor = (fineCursor + 1) % fineMax;
    const c = groundColor(x, z);
    Object.assign(p, { alive: true, x, y, z, vx, vy, vz, r, age: 0, life, a0: alpha, cr: c[0], cg: c[1], cb: c[2] });
  }

  function spawnGrain(x, y, z, vx, vy, vz, life) {
    const p = grains[grainCursor];
    grainCursor = (grainCursor + 1) % grainMax;
    const c = groundColor(x, z);
    Object.assign(p, { alive: true, x, y, z, vx, vy, vz, r: 0.012 + Math.random() * 0.018, age: 0, life, a0: 1, cr: c[0], cg: c[1], cb: c[2] });
  }

  /**
   * A kick of dust at (x, y, z): `count` scales how much, `speedScale` how hard, (baseVx, baseVz)
   * the horizontal velocity the material leaves with (e.g. thrown back by a wheel).
   */
  function emitBurst(x, y, z, count = 4, speedScale = 1, baseVx = 0, baseVz = 0) {
    const n = Math.max(1, Math.round(count));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const h = (0.15 + Math.random() * 0.5) * speedScale;
      spawnFine(
        x + (Math.random() - 0.5) * 0.15,
        y + 0.04,
        z + (Math.random() - 0.5) * 0.15,
        baseVx + Math.cos(a) * h,
        (0.25 + Math.random() * 0.55) * speedScale,
        baseVz + Math.sin(a) * h,
        0.08 + Math.random() * 0.08,
        2.5 + Math.random() * 2.5,
        0.32 + Math.random() * 0.2
      );
    }
    const ng = n * 3;
    for (let i = 0; i < ng; i++) {
      const a = Math.random() * Math.PI * 2;
      const h = (0.3 + Math.random() * 1.1) * speedScale;
      spawnGrain(
        x + (Math.random() - 0.5) * 0.1,
        y + 0.03,
        z + (Math.random() - 0.5) * 0.1,
        baseVx * 1.2 + Math.cos(a) * h,
        (0.6 + Math.random() * 1.4) * speedScale,
        baseVz * 1.2 + Math.sin(a) * h,
        4
      );
    }
  }

  /** Jump take-off or a landing: a ring of dust and a spray of grains, scaled by impact speed. */
  function emitJumpBurst(x, y, z, { mode = "landing", impactSpeed = 1.7, vx = 0, vz = 0 } = {}) {
    const landing = mode !== "takeoff";
    const power = landing ? Math.max(0.8, Math.min(2.4, 0.6 + impactSpeed * 0.4)) : 0.9;
    const ring = landing ? Math.round(10 + power * 8) : 8;
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2 + Math.random() * 0.3;
      const h = (0.8 + Math.random() * 0.9) * power;
      spawnFine(x + Math.cos(a) * 0.15, y + 0.03, z + Math.sin(a) * 0.15, vx * 0.2 + Math.cos(a) * h, (0.1 + Math.random() * 0.25) * power, vz * 0.2 + Math.sin(a) * h, 0.1 + Math.random() * 0.08, 3 + Math.random() * 3, 0.38);
    }
    const ng = landing ? Math.round(30 * power) : 18;
    for (let i = 0; i < ng; i++) {
      const a = Math.random() * Math.PI * 2;
      const h = (0.5 + Math.random() * 1.6) * power;
      spawnGrain(x, y + 0.03, z, vx * 0.25 + Math.cos(a) * h, (0.8 + Math.random() * 1.8) * power, vz * 0.25 + Math.sin(a) * h, 4);
    }
  }

  const sunDirU = finePoints.material.uniforms.uSunDir.value;

  /**
   * @param dt seconds
   * @param camPos camera position (for forward scattering)
   * @param light { sunDir, sunUp 0-1 } current sun
   */
  function update(dt, camPos, light = {}) {
    const step = Math.min(0.05, Math.max(0, dt || 0));
    clock += step;
    trackMat.uniforms.uTime.value = clock;
    if (light.sunDir) sunDirU.copy(light.sunDir);
    const sunUp = Number.isFinite(light.sunUp) ? light.sunUp : 1;
    for (const pts of [finePoints, grainPoints]) {
      const u = pts.material.uniforms;
      u.uSunUp.value = sunUp;
      if (light.sunDir) u.uSunDir.value.copy(light.sunDir);
      if (camPos) u.uCamPos.value.copy(camPos);
      // ambient sky light drops towards night
      u.uAmbient.value.setRGB(0.05 + 0.27 * sunUp, 0.035 + 0.185 * sunUp, 0.03 + 0.13 * sunUp);
    }

    // fine dust
    {
      const geom = finePoints.geometry;
      const pos = geom.attributes.position.array;
      const size = geom.attributes.aSize.array;
      const alpha = geom.attributes.aAlpha.array;
      const col = geom.attributes.aColor.array;
      let n = 0;
      for (const p of fine) {
        if (!p.alive) continue;
        if (step > 0) stepFine(p, step, groundY(p.x, p.z));
        const t = p.age / p.life;
        if (t >= 1) {
          p.alive = false;
          continue;
        }
        // quick rise, long fade
        const a = p.a0 * Math.min(1, t * 12) * (1 - t) * (1 - t);
        pos[n * 3] = p.x;
        pos[n * 3 + 1] = p.y;
        pos[n * 3 + 2] = p.z;
        size[n] = p.r * 2;
        alpha[n] = a;
        col[n * 3] = p.cr;
        col[n * 3 + 1] = p.cg;
        col[n * 3 + 2] = p.cb;
        n++;
      }
      geom.setDrawRange(0, n);
      for (const k of ["position", "aSize", "aAlpha", "aColor"]) geom.attributes[k].needsUpdate = true;
    }

    // sand grains
    {
      const geom = grainPoints.geometry;
      const pos = geom.attributes.position.array;
      const size = geom.attributes.aSize.array;
      const alpha = geom.attributes.aAlpha.array;
      const col = geom.attributes.aColor.array;
      let n = 0;
      for (const p of grains) {
        if (!p.alive) continue;
        if (step > 0) {
          const flying = stepGrain(p, step, groundY(p.x, p.z));
          p.age += step;
          // a landed grain is part of the ground again
          if (!flying || p.age > p.life) {
            p.alive = false;
            continue;
          }
        }
        pos[n * 3] = p.x;
        pos[n * 3 + 1] = p.y;
        pos[n * 3 + 2] = p.z;
        size[n] = p.r;
        alpha[n] = 1;
        col[n * 3] = p.cr;
        col[n * 3 + 1] = p.cg;
        col[n * 3 + 2] = p.cb;
        n++;
      }
      geom.setDrawRange(0, n);
      for (const k of ["position", "aSize", "aAlpha", "aColor"]) geom.attributes[k].needsUpdate = true;
    }
  }

  /** Viewport height in pixels, so point sizes stay in metres on screen. */
  function setViewportHeight(px, fovDeg = 78) {
    const s = px / (2 * Math.tan(((fovDeg * Math.PI) / 180) / 2));
    finePoints.material.uniforms.uScale.value = s;
    grainPoints.material.uniforms.uScale.value = s;
  }

  /** The world origin moved by (dx, dz) (endless-terrain recentre): move everything with it. */
  function shiftParticles(dx, dz) {
    if (!Number.isFinite(dx) || !Number.isFinite(dz) || (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6)) return;
    for (const pool of [fine, grains]) {
      for (const p of pool) {
        if (!p.alive) continue;
        p.x += dx;
        p.z += dz;
      }
    }
    for (let i = 0; i < TRACK_MAX; i++) {
      if (trackBirth[i] < 0) continue;
      tracks.getMatrixAt(i, dummy.matrix);
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
      dummy.position.x += dx;
      dummy.position.z += dz;
      dummy.updateMatrix();
      tracks.setMatrixAt(i, dummy.matrix);
    }
    tracks.instanceMatrix.needsUpdate = true;
  }

  function activeCounts() {
    return { fine: fine.filter((p) => p.alive).length, grains: grains.filter((p) => p.alive).length };
  }

  return { emitBurst, emitJumpBurst, stampTrack, update, shiftParticles, setViewportHeight, activeCounts, finePoints, grainPoints, tracks };
}
