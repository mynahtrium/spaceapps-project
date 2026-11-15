/**
 * Sky dome, Phobos and Deimos for the 3D rehearsal view (`web/eva/sky.js`).
 *
 * - Sun direction: NASA GISS Mars24 algorithm via `MarsEphemeris.sunStateAt` (real date, real site).
 * - Moon directions and distances: `MarsEphemeris.moonFromSurface` (JPL SSD mean orbital elements).
 * - Moon shapes: triaxial ellipsoids with the published radii (Thomas 1989): Phobos 13.0 x 11.4 x 9.1 km,
 *   Deimos 7.8 x 6.0 x 5.1 km. Not a full shape model. Surface maps: USGS Viking mosaics.
 * - Sky colour is a hand-tuned gradient (RENDERING, not a radiative-transfer model); dust optical depth
 *   is a fixed value until a measured tau series is wired in. Both are stated in Sources & Honesty.
 */

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform float uTau;
  uniform float uSunElev;
  uniform float uSunCos;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float tau = max(0.2, uTau);
    vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
    col *= mix(vec3(1.0), vec3(0.62, 0.38, 0.22), smoothstep(0.45, 2.8, tau));
    col = mix(col, uGround, smoothstep(0.0, -0.08, h));
    float day = smoothstep(-0.32, 0.12, uSunElev);
    float above = smoothstep(-0.03, 0.01, uSunElev);
    col *= mix(0.012, 1.0, day);
    float s = max(dot(d, normalize(uSunDir)), 0.0);
    float disc = smoothstep(uSunCos - 0.00002, min(0.9999992, uSunCos + 0.0000015), s);
    col += vec3(1.6, 1.65, 1.8) * disc * exp(-0.18 * tau) * above;
    col += vec3(0.55, 0.62, 0.75) * pow(s, 900.0) * 6.0 * above;
    col += vec3(0.40, 0.48, 0.62) * pow(s, 60.0) * 0.6 * day;
    col += vec3(0.30, 0.18, 0.10) * pow(s, 6.0) * 0.35 * day;
    float lowSun = smoothstep(0.38, -0.02, uSunElev);
    float fwd = smoothstep(0.90, 0.992, s);
    col += vec3(0.18, 0.34, 0.62) * fwd * lowSun * exp(-tau * 0.22) * smoothstep(-0.3, -0.02, uSunElev);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const MOON_VERT = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vLocalPos;
  void main() {
    vLocalPos = position;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`;

// Lit by the real sun direction; the dark limb takes the sky colour behind it so the moon reads
// against the daytime sky. Albedo comes from the USGS map only (no procedural mottling).
const MOON_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSkyBehind;
  uniform float uAlbedoBoost;
  uniform sampler2D uMap;
  uniform float uHasMap;
  varying vec3 vNormalW;
  varying vec3 vLocalPos;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 p = normalize(vLocalPos);
    vec2 uvm = vec2(atan(p.z, p.x) / 6.2831853 + 0.5, asin(clamp(p.y, -1.0, 1.0)) / 3.1415927 + 0.5);
    float albedo = uHasMap > 0.5 ? texture2D(uMap, uvm).r : 0.5;
    float ndl = max(dot(n, normalize(uSunDir)), 0.0);
    vec3 lit = vec3(albedo * ndl * uAlbedoBoost);
    gl_FragColor = vec4(uSkyBehind + lit, 1.0);
  }
`;

export const SKY_HORIZON = [0.62, 0.43, 0.3];
export const SKY_ZENITH = [0.23, 0.15, 0.12];
export const SKY_GROUND = [0.3, 0.19, 0.13];

/** Dust optical depth used until a measured series (Mastcam tau) is wired in. */
export const DEFAULT_DUST_TAU = 0.5;

export function createSkyDome(THREE, { sunDir, sunState, horizon, zenith, ground }) {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(95000, 48, 24),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: zenith },
        uHorizon: { value: horizon },
        uGround: { value: ground },
        uSunDir: { value: sunDir },
        uTau: { value: DEFAULT_DUST_TAU },
        uSunElev: { value: sunState.elevationRad },
        uSunCos: { value: Math.cos(sunState.sunAngularRad * 0.5) },
      },
    })
  );
  sky.renderOrder = -2;
  sky.frustumCulled = false;
  return sky;
}

function ellipsoid(THREE, [a, b, c]) {
  const g = new THREE.SphereGeometry(1, 40, 28);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * a, pos.getY(i) * b, pos.getZ(i) * c);
  g.computeVertexNormals();
  return g;
}

/**
 * Phobos and Deimos at their true angular size and position for `sunState.date` at the site.
 * Returns { group, update(sunState, camera, horizonColor) }.
 */
export function createMoons(THREE, { sunDir, moonFromSurface, phobosMapUrl, deimosMapUrl }) {
  const group = new THREE.Group();
  const loader = new THREE.TextureLoader();
  const make = (radiiKm, url, boost) => {
    const mapU = { value: null };
    const hasU = { value: 0 };
    if (url) {
      loader.load(url, (tex) => {
        tex.colorSpace = THREE.NoColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        mapU.value = tex;
        hasU.value = 1;
      });
    }
    const mesh = new THREE.Mesh(
      // long axis (a) points at Mars (tidally locked), i.e. at the observer: local +z
      ellipsoid(THREE, [radiiKm[1], radiiKm[2], radiiKm[0]]),
      new THREE.ShaderMaterial({
        vertexShader: MOON_VERT,
        fragmentShader: MOON_FRAG,
        depthWrite: false,
        fog: false,
        uniforms: {
          uSunDir: { value: sunDir },
          uSkyBehind: { value: new THREE.Color() },
          uAlbedoBoost: { value: boost },
          uMap: mapU,
          uHasMap: hasU,
        },
      })
    );
    mesh.renderOrder = -1;
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  };
  const phobos = make([13.0, 11.4, 9.1], phobosMapUrl, 1.35);
  const deimos = make([7.8, 6.0, 5.1], deimosMapUrl, 1.7);
  const dir = new THREE.Vector3();

  function place(mesh, name, sunState, camera, skyColor, sceneR) {
    const m = moonFromSurface(name, sunState.date, sunState.latDeg, sunState.lonEastDeg);
    dir.set(m.x, m.y, m.z).normalize();
    mesh.position.copy(dir).multiplyScalar(sceneR).add(camera.position);
    const trueScale = sceneR / Math.max(1, m.distKm);
    const pxRad = ((camera.fov * Math.PI) / 180) / Math.max(200, window.innerHeight || 900);
    // a moon smaller than about a pixel is held at one pixel, like a star
    const minScale = (sceneR * Math.tan(pxRad * 0.6)) / 6;
    mesh.scale.setScalar(Math.max(trueScale, minScale));
    mesh.lookAt(camera.position);
    mesh.visible = m.el > -0.05;
    mesh.material.uniforms.uSkyBehind.value.copy(skyColor);
    return m;
  }

  function update(sunState, camera, skyColor) {
    const p = place(phobos, "phobos", sunState, camera, skyColor, 88000);
    const d = place(deimos, "deimos", sunState, camera, skyColor, 90000);
    return { phobos: p, deimos: d };
  }

  return { group, update };
}
