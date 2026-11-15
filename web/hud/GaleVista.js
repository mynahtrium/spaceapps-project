/**
 * Stratified Gale Crater rim & Mount Sharp (Aeolis Mons) horizon silhouette beyond the mirrored HiRISE tile.
 * +X east, +Z south. Designed with broad wind-carved foothills, steeper layered sedimentary escarpments,
 * and smooth weathered shoulders fading organically into the Mars dust horizon inside camera.far (15 km).
 */

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Build a smooth, layered background mountain massif around Gale Crater.
 * @param {typeof import('three')} THREE
 */
export function createGaleVista(THREE) {
  const inner = 3600;
  const outer = 13600;
  const rings = 44;
  const segs = 256;
  const row = segs + 1;
  const vertCount = (rings + 1) * row;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const indices = [];

  const yAt = (t, r, x, z) => {
    const ang = Math.atan2(x, z); // 0 = south, + toward east (+X)
    // Gentle domain warp along azimuth & radius for natural asymmetrical massif ridges
    const warp =
      0.24 * Math.sin(ang * 3.0 + 0.6) +
      0.13 * Math.cos(ang * 5.0 - 1.1) +
      0.08 * Math.sin(r * 0.00055 + ang * 2.0);
    const aW = ang + warp * smoothstep(0.05, 0.7, t);

    // 1. Mount Sharp (Aeolis Mons) massif to the southeast: broad foothills rising to steep terraced benches
    const seRaw = Math.max(0, Math.cos(aW - Math.PI * 0.27));
    const seMassif = Math.pow(seRaw, 1.85);
    const seApron = smoothstep(0.06, 0.92, t);
    const seSteep = Math.pow(smoothstep(0.24, 0.96, t), 1.45);
    const seButtress =
      0.78 +
      0.22 * Math.sin(aW * 7.0 + t * 2.4) * Math.cos(aW * 4.0 - 0.5) +
      0.12 * Math.sin(aW * 13.0 + r * 0.0007);
    const mound = seMassif * (260 * seApron + 1780 * seSteep) * Math.max(0.55, seButtress);

    // 2. Northern / NW Gale Crater rim rampart with wide passes
    const northRaw = Math.max(0, Math.cos(aW - Math.PI * 0.96));
    const northRim = Math.pow(northRaw, 2.1);
    const rimPass = 0.72 + 0.28 * Math.cos(aW * 5.0 + 0.9);
    const rimRise = northRim * rimPass * (120 * seApron + 640 * Math.pow(smoothstep(0.2, 1.0, t), 1.25));

    // 3. Soft weathered pediment swells in intermediate azimuths
    const swell =
      (75 + 110 * Math.pow(0.5 + 0.5 * Math.sin(aW * 4.0 + 1.4), 1.4)) *
      smoothstep(0.12, 0.95, t);

    const macroH = mound + rimRise + swell;
    // Subtle layered Mount Sharp sedimentary terraces (smoothed, never jagged)
    const terraceBlend = smoothstep(0.18, 0.65, t) * Math.min(1, macroH / 450);
    const strata = (Math.sin(macroH * 0.024 + aW * 1.5) * 18 + Math.sin(macroH * 0.055) * 6) * terraceBlend;

    // Seamless skirt apron from slightly below inner tile level up to mountain flanks
    const entry = smoothstep(0.0, 0.14, t);
    return -10 * (1 - entry) + entry * (macroH + strata);
  };

  const cDust = new THREE.Color(0xa66f4b);
  const cMid = new THREE.Color(0x885237);
  const cDark = new THREE.Color(0x5f3828);
  const cCap = new THREE.Color(0xc29067);
  const tmpCol = new THREE.Color();

  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    // Denser ring spacing near foreground foothills for smooth horizon silhouette
    const radialT = 0.28 * t + 0.72 * t * t;
    const r = inner + (outer - inner) * radialT;
    for (let i = 0; i <= segs; i++) {
      const idx = j * row + i;
      const a = (i / segs) * Math.PI * 2;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      const y = yAt(t, r, x, z);
      positions[idx * 3] = x;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = z;

      // Stratified Martian rock coloration: ochre dust at base/summits, dark basaltic bedding on scarps
      const elevNorm = Math.max(0, Math.min(1, y / 1600));
      const strataBand = 0.5 + 0.5 * Math.sin(y * 0.032 + a * 3.0);
      tmpCol.copy(cDust).lerp(cMid, smoothstep(0.06, 0.52, elevNorm));
      tmpCol.lerp(cDark, smoothstep(0.25, 0.85, elevNorm) * (0.28 + 0.34 * strataBand));
      tmpCol.lerp(cCap, smoothstep(0.72, 1.0, elevNorm) * 0.42);
      colors[idx * 3] = tmpCol.r;
      colors[idx * 3 + 1] = tmpCol.g;
      colors[idx * 3 + 2] = tmpCol.b;
    }
  }

  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * row + i;
      indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.97,
    metalness: 0.0,
    flatShading: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.visible = true;
  return mesh;
}
