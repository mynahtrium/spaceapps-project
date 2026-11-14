/**
 * One convective dust column. Off unless the dev toggle is on.
 * Drift is visual; it is not a REMS vortex replay.
 */

export function createDustDevil(THREE) {
  const count = 420;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seeds = [];
  for (let i = 0; i < count; i++) {
    const h = Math.random();
    const a = Math.random() * Math.PI * 2;
    const rad = (0.35 + Math.random() * 0.65) * (4 + h * 14);
    seeds.push({ h, a, rad });
    pos[i * 3] = Math.cos(a) * rad;
    pos[i * 3 + 1] = h * 180;
    pos[i * 3 + 2] = Math.sin(a) * rad;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xc4926a,
    size: 2.4,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    fog: true,
  });
  const points = new THREE.Points(geo, mat);
  points.visible = false;
  points.frustumCulled = false;
  const anchor = { x: 40, z: -30 };

  function update(dt, px, pz, groundY, visible) {
    points.visible = visible;
    if (!visible) return;
    anchor.x += dt * 1.4;
    anchor.z += dt * 0.6;
    if (Math.hypot(anchor.x - px, anchor.z - pz) > 90) {
      anchor.x = px + 36;
      anchor.z = pz - 28;
    }
    points.position.set(anchor.x, groundY, anchor.z);
    const arr = geo.attributes.position.array;
    for (let i = 0; i < count; i++) {
      const s = seeds[i];
      s.a += dt * (1.6 + s.h * 2.2);
      const wobble = 1 + 0.15 * Math.sin(s.h * 12 + s.a);
      arr[i * 3] = Math.cos(s.a) * s.rad * wobble;
      arr[i * 3 + 1] = s.h * 180;
      arr[i * 3 + 2] = Math.sin(s.a) * s.rad * wobble * (0.7 + s.h);
    }
    geo.attributes.position.needsUpdate = true;
  }

  return { points, update };
}
