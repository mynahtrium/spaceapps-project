/**
 * Simple authored tripod and sample cache at science stops.
 * Not scanned instruments.
 */

export function createFieldKits(THREE, stops, lonToX, latToZ, sampleY) {
  const group = new THREE.Group();
  group.visible = false;
  const metal = new THREE.MeshStandardMaterial({ color: 0xc5c8cc, roughness: 0.45, metalness: 0.35 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.8, metalness: 0 });
  if (!stops?.features) return group;
  for (const f of stops.features) {
    if (f.properties?.kind === "habitat" || f.properties?.role === "start") continue;
    const [lon, lat] = f.geometry?.coordinates || [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const x = lonToX(lon) + 1.4;
    const z = latToZ(lat) + 0.8;
    const y = sampleY(x, z);
    const kit = new THREE.Group();
    const legs = [
      [0.16, 0, 0.1],
      [-0.12, 0, 0.14],
      [0.02, 0, -0.16],
    ];
    for (const [lx, , lz] of legs) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.72, 5), metal);
      leg.position.set(lx, 0.34, lz);
      leg.rotation.z = -lx * 1.4;
      leg.rotation.x = lz * 1.2;
      kit.add(leg);
    }
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.12), metal);
    head.position.set(0, 0.74, 0);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.22), cloth);
    box.position.set(0.55, 0.1, 0.2);
    kit.add(head, box);
    kit.position.set(x, y, z);
    group.add(kit);
  }
  return group;
}
