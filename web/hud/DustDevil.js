/**
 * Convective Martian dust column (`web/hud/DustDevil.js`) powered by `three.quarks` (`BatchedRenderer`).
 * Off unless the dev toggle is on. Drift is visual; it is not a REMS vortex replay.
 */

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
  OrbitOverLife,
  ParticleSystem,
  PiecewiseBezier,
  SizeOverLife,
} from "three.quarks";

export function createDustDevil(THREE, externalBatchedRenderer = null) {
  const batchedRenderer = externalBatchedRenderer || new BatchedRenderer();
  const points = new THREE.Group();
  points.name = "MarsDustDevilGroup";
  points.visible = false;
  points.frustumCulled = false;

  const material = new THREE.MeshBasicMaterial({
    color: 0xc4926a,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const vortexSystem = new ParticleSystem({
    duration: 6,
    looping: true,
    prewarm: true,
    startLife: new IntervalValue(2.5, 5.2),
    startSpeed: new IntervalValue(14, 34),
    startSize: new IntervalValue(2.2, 6.8),
    startColor: new ColorRange(
      new THREE.Vector4(0.82, 0.58, 0.42, 0.42),
      new THREE.Vector4(0.68, 0.46, 0.32, 0.26)
    ),
    worldSpace: false,
    maxParticle: 480,
    emissionOverTime: new ConstantValue(90),
    shape: new ConeEmitter({
      radius: 4.2,
      arc: Math.PI * 2,
      thickness: 0.85,
      angle: 0.14,
    }),
    material,
    renderOrder: 2,
  });

  // ConeEmitter emits along local +Z by default; rotate -90 deg around X so the funnel rises along +Y.
  vortexSystem.emitter.rotation.x = -Math.PI / 2;

  vortexSystem.addBehavior(
    new SizeOverLife(new PiecewiseBezier([[new Bezier(0.45, 0.95, 1.45, 2.1), 0]]))
  );
  vortexSystem.addBehavior(
    new OrbitOverLife(new IntervalValue(2.2, 4.4), new THREE.Vector3(0, 0, 1))
  );
  vortexSystem.addBehavior(
    new ApplyForce(new THREE.Vector3(0, 0, 6.5), new ConstantValue(1))
  );
  vortexSystem.addBehavior(
    new ColorOverLife(
      new Gradient(
        [
          [new THREE.Vector3(0.82, 0.58, 0.42), 0],
          [new THREE.Vector3(0.74, 0.50, 0.36), 0.6],
          [new THREE.Vector3(0.66, 0.44, 0.31), 1],
        ],
        [
          [0.0, 0],
          [0.42, 0.18],
          [0.32, 0.72],
          [0.0, 1],
        ]
      )
    )
  );

  batchedRenderer.addSystem(vortexSystem);
  points.add(vortexSystem.emitter);
  if (!externalBatchedRenderer) {
    points.add(batchedRenderer);
  }

  const anchor = { x: 40, z: -30 };

  function update(dt, px, pz, groundY, visible) {
    points.visible = Boolean(visible);
    if (!visible) return;
    const step = Math.min(0.1, Math.max(0.001, dt || 0.016));
    anchor.x += step * 1.4;
    anchor.z += step * 0.6;
    if (Math.hypot(anchor.x - px, anchor.z - pz) > 90) {
      anchor.x = px + 36;
      anchor.z = pz - 28;
    }
    vortexSystem.emitter.position.set(anchor.x, groundY, anchor.z);
    if (!points.parent && points.type !== "Scene") points.type = "Scene";
    points.updateMatrixWorld(true);
    if (!externalBatchedRenderer) {
      batchedRenderer.update(step);
    }
  }

  return { points, update, batchedRenderer, system: vortexSystem };
}
