/**
 * Martian Atmosphere, Ground-Hugging Aeolian Dust & Multi-Stage Impact Plumes (`web/hud/mars-fx.js`).
 *
 * Powered by `three.quarks` (`BatchedRenderer`, `ParticleSystem`) with procedural Simplex-noise
 * particle sprites (`simplex-noise` + `seedrandom`):
 * 1. Sparse sunlit saltation motes drifting in the REMS convective wind field.
 * 2. Expanding kinetic bootstep & rover tire plumes (`emitBurst`).
 * 3. Pro Jump & Landing Impact FX (`emitJumpBurst`): 360° radial ground shockwave dust skirt,
 *    dual-boot convection vortex plumes, and ballistic 3.71 m/s^2 Martian regolith pebbles/clods.
 * 4. Dynamic Gale crater atmospheric haze (`FogExp2`).
 */

import * as THREE from "three";
import seedrandom from "seedrandom";
import { createNoise2D } from "simplex-noise";
import {
  ApplyForce,
  BatchedRenderer,
  Bezier,
  ColorOverLife,
  ColorRange,
  ConeEmitter,
  ConstantValue,
  Gradient,
  IntervalValue,
  ParticleSystem,
  PiecewiseBezier,
  RotationOverLife,
  SizeOverLife,
  SphereEmitter,
} from "three.quarks";

const PLUME_MAX = 480;
const CLOD_MAX = 260;
const MOTE_MAX = 160;
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

function makeWispyDustTexture() {
  const sz = 64;
  const data = new Uint8Array(sz * sz * 4);
  const noise2D = createNoise2D(seedrandom("mars-wispy-dust-sprite-v2"));
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
      const fbm = 0.78 + 0.16 * noise2D(u * 4.5, v * 4.5) + 0.08 * noise2D(u * 9.0, v * 9.0);
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

function makeClodTexture() {
  const sz = 32;
  const data = new Uint8Array(sz * sz * 4);
  const noise2D = createNoise2D(seedrandom("mars-clod-sprite-v2"));
  for (let y = 0; y < sz; y++) {
    const v = (y + 0.5) / sz - 0.5;
    for (let x = 0; x < sz; x++) {
      const u = (x + 0.5) / sz - 0.5;
      const r = Math.hypot(u, v);
      const facet = 0.34 + 0.09 * noise2D(u * 5.0, v * 5.0);
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

export function createMarsFxSystem(scene, sampleElevSceneY, externalBatchedRenderer = null) {
  const batchedRenderer = externalBatchedRenderer || new BatchedRenderer();
  const fxGroup = new THREE.Group();
  fxGroup.name = "MarsQuarksFxGroup";
  scene.add(fxGroup);
  if (!externalBatchedRenderer) {
    scene.add(batchedRenderer);
  }

  const wispTex = makeWispyDustTexture();
  const clodTex = makeClodTexture();

  const plumeMat = new THREE.MeshBasicMaterial({
    map: wispTex,
    color: 0xe49c69,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const clodMat = new THREE.MeshBasicMaterial({
    map: clodTex,
    color: 0x9b5130,
    transparent: true,
    opacity: 0.94,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const moteMat = new THREE.MeshBasicMaterial({
    map: wispTex,
    color: 0xf2b07e,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  // 1. Expanding kinetic bootstep, landing shockwave & rover wheel plumes
  const plumeSystem = new ParticleSystem({
    duration: 4,
    looping: true,
    startLife: new IntervalValue(0.75, 1.65),
    startSpeed: new IntervalValue(0.4, 1.6),
    startSize: new IntervalValue(0.32, 0.78),
    startRotation: new IntervalValue(0, Math.PI * 2),
    startColor: new ColorRange(
      new THREE.Vector4(0.92, 0.64, 0.44, 0.76),
      new THREE.Vector4(0.78, 0.50, 0.34, 0.56)
    ),
    worldSpace: true,
    maxParticle: PLUME_MAX,
    emissionOverTime: new ConstantValue(0),
    shape: new ConeEmitter({ radius: 0.18, angle: 0.65 }),
    material: plumeMat,
    renderOrder: 3,
  });
  plumeSystem.emitter.rotation.x = -Math.PI / 2;
  plumeSystem.addBehavior(
    new SizeOverLife(new PiecewiseBezier([[new Bezier(0.45, 1.15, 1.95, 2.55), 0]]))
  );
  plumeSystem.addBehavior(new RotationOverLife(new IntervalValue(-1.8, 1.8)));
  const windForceVec = new THREE.Vector3(0.8, -MARS_GRAVITY_MS2 * 0.22, 0.3);
  plumeSystem.addBehavior(new ApplyForce(windForceVec, new ConstantValue(1)));
  plumeSystem.addBehavior(
    new ColorOverLife(
      new Gradient(
        [
          [new THREE.Vector3(0.92, 0.64, 0.44), 0],
          [new THREE.Vector3(0.82, 0.54, 0.37), 0.55],
          [new THREE.Vector3(0.72, 0.46, 0.31), 1],
        ],
        [
          [0.0, 0],
          [0.74, 0.16],
          [0.42, 0.62],
          [0.0, 1],
        ]
      )
    )
  );

  // 2. Ballistic Martian regolith pebbles & soil clods (3.71 m/s^2 gravity)
  const clodSystem = new ParticleSystem({
    duration: 4,
    looping: true,
    startLife: new IntervalValue(0.9, 1.85),
    startSpeed: new IntervalValue(1.1, 2.8),
    startSize: new IntervalValue(0.03, 0.075),
    startRotation: new IntervalValue(0, Math.PI * 2),
    startColor: new ColorRange(
      new THREE.Vector4(0.68, 0.38, 0.22, 0.95),
      new THREE.Vector4(0.52, 0.27, 0.16, 0.9)
    ),
    worldSpace: true,
    maxParticle: CLOD_MAX,
    emissionOverTime: new ConstantValue(0),
    shape: new ConeEmitter({ radius: 0.14, angle: 0.55 }),
    material: clodMat,
    renderOrder: 4,
  });
  clodSystem.emitter.rotation.x = -Math.PI / 2;
  clodSystem.addBehavior(new RotationOverLife(new IntervalValue(-6.5, 6.5)));
  clodSystem.addBehavior(
    new ApplyForce(new THREE.Vector3(0, -MARS_GRAVITY_MS2, 0), new ConstantValue(1))
  );

  // 3. Ambient sunlit saltation motes around the camera
  const moteSystem = new ParticleSystem({
    duration: 6,
    looping: true,
    startLife: new IntervalValue(1.8, 3.6),
    startSpeed: new IntervalValue(0.4, 1.4),
    startSize: new IntervalValue(0.04, 0.11),
    startColor: new ColorRange(
      new THREE.Vector4(0.95, 0.72, 0.52, 0.28),
      new THREE.Vector4(0.84, 0.58, 0.40, 0.16)
    ),
    worldSpace: true,
    maxParticle: MOTE_MAX,
    emissionOverTime: new ConstantValue(18),
    shape: new SphereEmitter({ radius: 14, thickness: 0.9 }),
    material: moteMat,
    renderOrder: 2,
  });
  moteSystem.addBehavior(new ApplyForce(windForceVec, new ConstantValue(0.45)));

  fxGroup.add(plumeSystem.emitter, clodSystem.emitter, moteSystem.emitter);
  batchedRenderer.addSystem(plumeSystem);
  batchedRenderer.addSystem(clodSystem);
  batchedRenderer.addSystem(moteSystem);

  let dustActive = true;
  let lastWindState = computeAtmosphericState(0, true);

  function ensureSceneRoot() {
    let r = fxGroup;
    while (r.parent) r = r.parent;
    if (r.type !== "Scene") r.type = "Scene";
  }

  function spawnCustomParticles(sys, maxCount, count, x, y, z, configureParticle) {
    if (!dustActive || count <= 0) return;
    ensureSceneRoot();
    const spawnCount = Math.min(count, Math.max(0, maxCount - sys.particleNum));
    if (spawnCount <= 0) return;
    const before = sys.particleNum;
    sys.emitter.position.set(x, y, z);
    sys.emitter.updateMatrixWorld(true);
    sys.spawn(spawnCount, sys.emissionState, sys.emitter.matrixWorld);
    for (let i = 0; i < spawnCount; i++) {
      const p = sys.particles[before + i];
      if (p && configureParticle) configureParticle(p, i, spawnCount);
    }
  }

  function emitBurst(x, y, z, count = 8, speedScale = 1.0, baseVx = 0, baseVz = 0) {
    spawnCustomParticles(plumeSystem, PLUME_MAX, count, x, y + 0.08, z, (p) => {
      const ang = Math.random() * Math.PI * 2;
      const radial = (0.35 + Math.random() * 1.1) * speedScale;
      const bSize = 0.36 + Math.random() * 0.42 * Math.max(0.7, speedScale);
      p.position.set(
        x + (Math.random() - 0.5) * 0.28,
        y + 0.06 + Math.random() * 0.12,
        z + (Math.random() - 0.5) * 0.28
      );
      p.velocity.set(
        baseVx + Math.cos(ang) * radial,
        (0.45 + Math.random() * 1.0) * speedScale,
        baseVz + Math.sin(ang) * radial
      );
      p.startSize.set(bSize, bSize, bSize);
      p.size.copy(p.startSize);
      p.life = 0.72 + Math.random() * 0.85;
    });
  }

  function emitJumpBurst(
    x,
    y,
    z,
    { mode = "landing", impactSpeed = 1.7, rightX = 1, rightZ = 0, fwdX = 0, fwdZ = -1, vx = 0, vz = 0 } = {}
  ) {
    if (!dustActive) return;
    const isLanding = mode === "landing";
    const power = isLanding ? Math.max(0.85, Math.min(2.35, 0.75 + impactSpeed * 0.38)) : 1.05;

    const ringCount = isLanding ? Math.min(34, Math.round(18 + power * 7)) : 16;
    spawnCustomParticles(plumeSystem, PLUME_MAX, ringCount, x, y + 0.06, z, (p, k, total) => {
      const theta = (k / total) * Math.PI * 2 + (Math.random() - 0.5) * 0.28;
      const side = (k % 2 === 0 ? -1 : 1) * 0.15;
      const radialSpeed = (isLanding ? 2.1 + Math.random() * 2.2 : 1.3 + Math.random() * 1.4) * power;
      const backBias = isLanding ? 0.15 : -0.45;
      const bSize = (isLanding ? 0.34 : 0.28) + Math.random() * 0.28 * power;
      p.position.set(
        x + rightX * side + Math.cos(theta) * 0.18,
        y + 0.04 + Math.random() * 0.07,
        z + rightZ * side + Math.sin(theta) * 0.18
      );
      p.velocity.set(
        vx * 0.25 + Math.cos(theta) * radialSpeed + fwdX * backBias,
        (isLanding ? 0.16 + Math.random() * 0.38 : 0.22 + Math.random() * 0.45) * power,
        vz * 0.25 + Math.sin(theta) * radialSpeed + fwdZ * backBias
      );
      p.startSize.set(bSize, bSize, bSize);
      p.size.copy(p.startSize);
      p.life = isLanding ? 0.95 + Math.random() * 0.85 : 0.72 + Math.random() * 0.55;
    });

    const coreCount = isLanding ? Math.min(14, Math.round(7 + power * 3)) : 6;
    spawnCustomParticles(plumeSystem, PLUME_MAX, coreCount, x, y + 0.12, z, (p, k) => {
      const side = (k % 2 === 0 ? -1 : 1) * 0.16;
      const ang = Math.random() * Math.PI * 2;
      const spr = (0.3 + Math.random() * 0.75) * power;
      const bSize = 0.48 + Math.random() * 0.42 * power;
      p.position.set(
        x + rightX * side + (Math.random() - 0.5) * 0.14,
        y + 0.1 + Math.random() * 0.18,
        z + rightZ * side + (Math.random() - 0.5) * 0.14
      );
      p.velocity.set(
        vx * 0.2 + Math.cos(ang) * spr,
        (isLanding ? 0.68 + Math.random() * 0.95 : 0.52 + Math.random() * 0.75) * power,
        vz * 0.2 + Math.sin(ang) * spr
      );
      p.startSize.set(bSize, bSize, bSize);
      p.size.copy(p.startSize);
      p.life = isLanding ? 1.15 + Math.random() * 0.95 : 0.85 + Math.random() * 0.65;
    });

    const clodCount = isLanding ? Math.min(30, Math.round(14 + power * 7)) : 10;
    spawnCustomParticles(clodSystem, CLOD_MAX, clodCount, x, y + 0.07, z, (p, k) => {
      const side = (k % 2 === 0 ? -1 : 1) * 0.15;
      const ang = Math.random() * Math.PI * 2;
      const horiz = (isLanding ? 1.0 + Math.random() * 2.4 : 0.8 + Math.random() * 1.7) * power;
      const vert = (isLanding ? 1.25 + Math.random() * 2.0 : 1.05 + Math.random() * 1.5) * power;
      const cSize = 0.028 + Math.random() * 0.048 * Math.min(1.4, power);
      p.position.set(
        x + rightX * side + Math.cos(ang) * 0.12,
        y + 0.06 + Math.random() * 0.08,
        z + rightZ * side + Math.sin(ang) * 0.12
      );
      p.velocity.set(
        vx * 0.25 + Math.cos(ang) * horiz - fwdX * (isLanding ? 0 : 0.6),
        vert,
        vz * 0.25 + Math.sin(ang) * horiz - fwdZ * (isLanding ? 0 : 0.6)
      );
      p.startSize.set(cSize, cSize, cSize);
      p.size.copy(p.startSize);
      p.life = 1.15 + Math.random() * 0.9;
    });
  }

  function clampParticlesToGround(sys, minOffset, bounceRestitution) {
    if (!sampleElevSceneY) return;
    for (let i = 0; i < sys.particleNum; i++) {
      const p = sys.particles[i];
      if (!p || !p.position) continue;
      const groundY = sampleElevSceneY(p.position.x, p.position.z);
      if (p.position.y < groundY + minOffset) {
        p.position.y = groundY + minOffset;
        if (p.velocity && p.velocity.y < 0) {
          p.velocity.y *= -bounceRestitution;
          p.velocity.x *= 0.72;
          p.velocity.z *= 0.72;
        }
      }
    }
  }

  function update(dt, camPos, clockT, { dustEnabled = true, weatherEnabled = true } = {}) {
    lastWindState = computeAtmosphericState(clockT, weatherEnabled);
    dustActive = Boolean(dustEnabled);
    fxGroup.visible = dustActive;
    if (!externalBatchedRenderer) {
      batchedRenderer.visible = dustActive;
    }

    if (scene.fog) {
      scene.fog.color.setHex(lastWindState.fogColorHex);
      scene.fog.density += (lastWindState.fogDensity - scene.fog.density) * Math.min(1, dt * 2.5);
    }
    if (!dustActive) return lastWindState;

    const step = Math.min(0.1, Math.max(0.001, dt || 0.016));
    windForceVec.set(
      lastWindState.windX * 0.38,
      -MARS_GRAVITY_MS2 * 0.22,
      lastWindState.windZ * 0.38
    );

    if (camPos) {
      const groundAtCam = sampleElevSceneY ? sampleElevSceneY(camPos.x, camPos.z) : camPos.y - 1.7;
      moteSystem.emitter.position.set(camPos.x, groundAtCam + 0.85, camPos.z);
    }
    ensureSceneRoot();
    fxGroup.updateMatrixWorld(true);
    if (!externalBatchedRenderer) {
      batchedRenderer.update(step);
    }

    clampParticlesToGround(plumeSystem, 0.05, 0.15);
    clampParticlesToGround(clodSystem, 0.025, 0.28);

    return lastWindState;
  }

  function shiftParticles(dx, dz) {
    if (!Number.isFinite(dx) || !Number.isFinite(dz) || (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6)) return;
    for (const sys of [plumeSystem, clodSystem, moteSystem]) {
      for (let i = 0; i < sys.particleNum; i++) {
        const p = sys.particles[i];
        if (p && p.position) {
          p.position.x += dx;
          p.position.z += dz;
        }
      }
    }
  }

  return {
    emitBurst,
    emitJumpBurst,
    shiftParticles,
    update,
    getWindState: () => lastWindState,
    batchedRenderer,
    systems: { plumeSystem, clodSystem, moteSystem },
  };
}
