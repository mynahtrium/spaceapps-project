/**
 * Physically-inspired Martian Atmospheric Scattering & Refractive Haze (`web/hud/MarsAtmosphereHaze.js`).
 *
 * Replaces flat uniform Three.js `FogExp2` on distant terrain and Gale Crater / Mount Sharp
 * horizon massifs with height-stratified, wavelength-dispersed Mie/Rayleigh light scattering:
 * - Preserves crisp foreground visibility (< ~280 m) around the walker, rovers, habitat & 1 m chunks.
 * - Veils lower-resolution distant overview / mirrored terrain (> ~450 m) in layered luminous mist.
 * - Applies RGB Beer-Lambert dispersion (blue scatters faster than amber/red), solar forward Mie
 *   aureole + low-Sun Martian blue forward scatter, and subtle horizon thermal-refraction sheen.
 * - Converges smoothly into the exact `SKY_FRAG` sky colour at the far horizon across day, twilight & night.
 */

export const MARS_ATMO_HAZE_VERT_PARS = /* glsl */ `
varying vec3 vAtmoWorldPos;
`;

export const MARS_ATMO_HAZE_FRAG_PARS = /* glsl */ `
varying vec3 vAtmoWorldPos;
uniform vec3 uAtmoHorizon;
uniform vec3 uAtmoZenith;
uniform vec3 uAtmoGround;
uniform vec3 uAtmoSunDir;
uniform float uAtmoSunElev;
uniform float uAtmoTau;
uniform float uAtmoDensity;
uniform float uAtmoBaseY;
uniform float uAtmoTime;
uniform float uAtmoEnabled;

vec3 mmAtmoInscatter(vec3 rayDir, vec3 sunDir, float tau, float sunElev) {
  vec3 d = normalize(rayDir);
  float h = d.y;
  float t = max(0.2, tau);
  vec3 col = mix(uAtmoHorizon, uAtmoZenith, pow(clamp(h, 0.0, 1.0), 0.55));
  col *= mix(vec3(1.0), vec3(0.62, 0.38, 0.22), smoothstep(0.45, 2.8, t));
  col = mix(col, uAtmoGround, smoothstep(0.0, -0.08, h));

  float day = smoothstep(-0.32, 0.12, sunElev);
  float above = smoothstep(-0.03, 0.02, sunElev);
  col *= mix(0.012, 1.0, day);

  float s = max(dot(d, normalize(sunDir)), 0.0);
  col += vec3(0.55, 0.62, 0.75) * pow(s, 900.0) * 1.8 * above;
  col += vec3(0.40, 0.48, 0.62) * pow(s, 60.0) * 0.55 * day;
  col += vec3(0.32, 0.19, 0.11) * pow(s, 6.0) * 0.38 * day;

  float lowSun = smoothstep(0.38, -0.02, sunElev);
  float fwd = smoothstep(0.86, 0.992, s);
  col += vec3(0.18, 0.34, 0.62) * fwd * lowSun * exp(-t * 0.22) * smoothstep(-0.3, -0.02, sunElev);
  return col;
}

vec3 mmMarsAtmoHaze(vec3 surfCol, vec3 worldPos, vec3 camPos) {
  vec3 ray = worldPos - camPos;
  float dist = length(ray);
  vec3 d = ray / max(dist, 0.001);

  float dNear = max(0.0, dist - 420.0);
  float tau = max(0.15, uAtmoTau);
  float tauFactor = 0.68 + clamp(tau, 0.15, 3.0) * 0.64;
  float dens = max(0.25, uAtmoDensity) * tauFactor;

  // Height-stratified Martian dust blanket: denser in Gale basin, thinner over high Mount Sharp peaks
  float hScale = 440.0;
  float h0 = max(0.0, camPos.y - uAtmoBaseY) / hScale;
  float h1 = max(0.0, worldPos.y - uAtmoBaseY) / hScale;
  float dh = h1 - h0;
  float pathH = abs(dh) > 0.002 ? (exp(-h0) - exp(-h1)) / dh : exp(-0.5 * (h0 + h1));
  pathH = clamp(pathH, 0.24, 1.35);

  // Gentle boundary-layer thermal/dust refraction wave across distant mountain ridges
  float farMask = smoothstep(750.0, 2800.0, dist);
  float shimmer = sin(worldPos.x * 0.0026 + worldPos.z * 0.0021 + uAtmoTime * 0.45)
                * cos(worldPos.y * 0.016 - worldPos.z * 0.0019 - uAtmoTime * 0.32);

  float baseAir = dist * 0.00011;
  float dustVeil = (dNear * 0.00054 + 0.36 * smoothstep(950.0, 3400.0, dist)) * pathH;
  float farHorizonMerge = 3.8 * smoothstep(8200.0, 13600.0, dist);
  float optDepth = (baseAir + dustVeil * (1.0 + 0.09 * shimmer * farMask) + farHorizonMerge) * dens;

  // Chromatic Beer-Lambert extinction: shorter blue wavelengths scatter faster than warm amber/red
  vec3 extCoeff = vec3(0.72, 0.96, 1.32);
  vec3 trans = exp(-optDepth * extCoeff);

  vec3 scatterCol = mmAtmoInscatter(d, uAtmoSunDir, tau, uAtmoSunElev);

  // Grazing-angle atmospheric refraction sheen & subtle vertical spectral dispersion near horizon
  float day = smoothstep(-0.32, 0.12, uAtmoSunElev);
  float grazing = exp(-abs(d.y) * 15.0) * smoothstep(650.0, 3000.0, dist);
  float mu = max(dot(d, normalize(uAtmoSunDir)), 0.0);
  vec3 dispTint = mix(
    vec3(1.06, 0.98, 0.90),
    vec3(0.92, 0.99, 1.11),
    clamp(0.5 + d.y * 8.5 + 0.14 * shimmer, 0.0, 1.0)
  );
  vec3 refractedMist = scatterCol * mix(vec3(1.0), dispTint, 0.55 * grazing);
  refractedMist += uAtmoHorizon * (0.14 * pow(mu, 4.0) * grazing * day);
  // Subtle cool opalescent Rayleigh lift at oblique grazing angles under daylight
  refractedMist += vec3(0.11, 0.14, 0.18) * (grazing * (1.0 - mu) * 0.22 * day * exp(-0.35 * tau));

  return mix(refractedMist, surfCol, trans);
}
`;

export const MARS_ATMO_HAZE_FRAG_APPLY = /* glsl */ `
#ifdef USE_FOG
  if (uAtmoEnabled > 0.5) {
    gl_FragColor.rgb = mmMarsAtmoHaze(gl_FragColor.rgb, vAtmoWorldPos, cameraPosition);
  } else {
    #include <fog_fragment>
  }
#endif
`;

/**
 * Map `mars-fx` dynamic `fogDensity` (calm vs REMS dust gusts) into a bounded haze multiplier.
 */
export function computeHazeDensityFactor(fogDensity, baseFogDensity = 0.00042) {
  const base = Number.isFinite(Number(baseFogDensity)) && Number(baseFogDensity) > 0 ? Number(baseFogDensity) : 0.00042;
  const dens = Number.isFinite(Number(fogDensity)) && Number(fogDensity) > 0 ? Number(fogDensity) : base;
  const ratio = dens / base;
  return Math.max(0.75, Math.min(1.65, 1.0 + (ratio - 1.0) * 0.28));
}

/**
 * Create shared uniforms for Martian atmospheric scattering & refractive haze.
 * `horizonColor`, `zenithColor`, `groundColor`, and `sunDir` are referenced directly so
 * site/sun changes in `hud3d.js` propagate automatically.
 */
export function createAtmosphericHazeUniforms(
  THREE,
  { horizonColor, zenithColor, groundColor, sunDir, sunElev = 0.45, tau = 0.5, baseY = 0.0 } = {}
) {
  return {
    uAtmoHorizon: { value: horizonColor || new THREE.Color(0.62, 0.43, 0.3) },
    uAtmoZenith: { value: zenithColor || new THREE.Color(0.23, 0.15, 0.12) },
    uAtmoGround: { value: groundColor || new THREE.Color(0.3, 0.19, 0.13) },
    uAtmoSunDir: { value: sunDir || new THREE.Vector3(0.5, 0.5, 0.5).normalize() },
    uAtmoSunElev: { value: sunElev },
    uAtmoTau: { value: tau },
    uAtmoDensity: { value: 1.0 },
    uAtmoBaseY: { value: baseY },
    uAtmoTime: { value: 0.0 },
    uAtmoEnabled: { value: 1.0 },
  };
}

export function updateAtmosphericHazeUniforms(
  uniforms,
  { sunElev, tau, fogDensity, baseY, time, enabled } = {}
) {
  if (!uniforms) return;
  if (Number.isFinite(sunElev)) uniforms.uAtmoSunElev.value = sunElev;
  if (Number.isFinite(tau)) uniforms.uAtmoTau.value = tau;
  if (Number.isFinite(fogDensity)) uniforms.uAtmoDensity.value = computeHazeDensityFactor(fogDensity);
  if (Number.isFinite(baseY)) uniforms.uAtmoBaseY.value = baseY;
  if (Number.isFinite(time)) uniforms.uAtmoTime.value = time;
  if (typeof enabled === "boolean") uniforms.uAtmoEnabled.value = enabled ? 1.0 : 0.0;
}

/**
 * Patch any `MeshStandardMaterial` / `MeshPhysicalMaterial` hierarchy (such as `GaleVista`)
 * to use Martian refractive atmospheric haze (and optional Mars planetary curvature drop).
 */
export function patchAtmosphericHaze(THREE, rootOrMaterial, atmoUniforms, { curvature = null } = {}) {
  if (!THREE || !rootOrMaterial || !atmoUniforms) return;
  const seen = new Set();
  const applyToMat = (mat) => {
    if (!mat || (!mat.isMeshStandardMaterial && !mat.isMeshPhysicalMaterial)) return;
    if (seen.has(mat) || mat.userData?.atmoHazePatched) return;
    seen.add(mat);
    mat.userData = { ...(mat.userData || {}), atmoHazePatched: true };
    const prevCompile = mat.onBeforeCompile;
    const prevCacheKey = mat.customProgramCacheKey;
    const tag = curvature ? "mm-atmo-haze-curv" : "mm-atmo-haze";
    mat.customProgramCacheKey = () => `${prevCacheKey ? prevCacheKey.call(mat) : ""}|${tag}`;
    mat.onBeforeCompile = (shader, renderer) => {
      if (prevCompile) prevCompile.call(mat, shader, renderer);
      Object.assign(shader.uniforms, atmoUniforms);
      if (curvature) {
        shader.uniforms.uCurvAnchor = curvature.uCurvAnchor;
        shader.uniforms.uCurvInv2N = curvature.uCurvInv2N;
        shader.uniforms.uCurvInv2M = curvature.uCurvInv2M;
      }

      const vertPars = curvature
        ? `${MARS_ATMO_HAZE_VERT_PARS}\nuniform vec2 uCurvAnchor;\nuniform float uCurvInv2N;\nuniform float uCurvInv2M;`
        : MARS_ATMO_HAZE_VERT_PARS;

      const projReplacement = curvature
        ? `vec4 mmAtmoWorld = modelMatrix * vec4(transformed, 1.0);
vAtmoWorldPos = mmAtmoWorld.xyz;
float mmAtmoDx = mmAtmoWorld.x - uCurvAnchor.x;
float mmAtmoDz = mmAtmoWorld.z - uCurvAnchor.y;
mmAtmoWorld.y += -mmAtmoDx * mmAtmoDx * uCurvInv2N - mmAtmoDz * mmAtmoDz * uCurvInv2M;
vec4 mvPosition = viewMatrix * mmAtmoWorld;
gl_Position = projectionMatrix * mvPosition;`
        : `vec4 mmAtmoWorld = modelMatrix * vec4(transformed, 1.0);
vAtmoWorldPos = mmAtmoWorld.xyz;
#include <project_vertex>`;

      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${vertPars}`)
        .replace("#include <project_vertex>", projReplacement);

      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${MARS_ATMO_HAZE_FRAG_PARS}`)
        .replace("#include <fog_fragment>", MARS_ATMO_HAZE_FRAG_APPLY);
    };
    mat.needsUpdate = true;
  };

  if (rootOrMaterial.isMaterial) {
    applyToMat(rootOrMaterial);
    return;
  }
  rootOrMaterial.traverse?.((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) applyToMat(m);
  });
}
