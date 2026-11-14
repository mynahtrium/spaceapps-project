/**
 * Custom Martian PBR Terrain Shader, CC0 Procedural Micro-Detail Normal Synthesis,
 * Slope-Driven Regolith/Mudstone Blending, Reoriented Normal Mapping (`blendRNM`),
 * Martian Dust Atmospheric Scattering, and Sky Dome.
 */

function fract(x) {
  return x - Math.floor(x);
}

function hash2(x, y) {
  return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);
}

function periodicNoise(u, v, freq) {
  const x = u * freq;
  const y = v * freq;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const wx0 = ((ix % freq) + freq) % freq;
  const wy0 = ((iy % freq) + freq) % freq;
  const wx1 = (wx0 + 1) % freq;
  const wy1 = (wy0 + 1) % freq;

  const a = hash2(wx0, wy0);
  const b = hash2(wx1, wy0);
  const c = hash2(wx0, wy1);
  const d = hash2(wx1, wy1);
  const top = a + (b - a) * sx;
  const bot = c + (d - c) * sx;
  return top + (bot - top) * sy;
}

/**
 * Generate seamless RGBA8 tangent-space normal + roughness DataTextures in memory (CC0 clean).
 * @param {typeof import('three')} THREE
 */
export function createMartianMicroDetailTextures(THREE, size = 256) {
  const buildNormalTex = (heightFn, strength) => {
    const heights = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        heights[y * size + x] = heightFn(u, v);
      }
    }
    const rgba = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      const ym = (y - 1 + size) % size;
      const yp = (y + 1) % size;
      for (let x = 0; x < size; x++) {
        const xm = (x - 1 + size) % size;
        const xp = (x + 1) % size;
        const hL = heights[y * size + xm];
        const hR = heights[y * size + xp];
        const hD = heights[ym * size + x];
        const hU = heights[yp * size + x];
        const dx = (hR - hL) * strength;
        const dy = (hU - hD) * strength;
        const inv = 1 / Math.hypot(-dx, -dy, 1);
        const h = heights[y * size + x];
        const idx = (y * size + x) * 4;
        rgba[idx] = Math.round(((-dx * inv) * 0.5 + 0.5) * 255);
        rgba[idx + 1] = Math.round(((-dy * inv) * 0.5 + 0.5) * 255);
        rgba[idx + 2] = Math.round(((1 * inv) * 0.5 + 0.5) * 255);
        rgba[idx + 3] = Math.max(40, Math.min(245, Math.round(170 - h * 50)));
      }
    }
    const tex = new THREE.DataTexture(rgba, size, size, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  };

  // Aeolian sand ripples + fine regolith pebbles
  const dustTex = buildNormalTex((u, v) => {
    const warp = periodicNoise(u, v, 8) * 0.14;
    const ripples = Math.sin((u * 12 + v * 3 + warp * 8) * Math.PI * 2) * 0.35;
    const grain = periodicNoise(u, v, 32) * 0.4 + periodicNoise(u, v, 64) * 0.25;
    return ripples + grain;
  }, 1.35);

  // Layered mudstone fractures + coarse cobble pitting
  const rockTex = buildNormalTex((u, v) => {
    const strata = Math.sin((v * 14 + periodicNoise(u, v, 6) * 1.8) * Math.PI * 2) * 0.38;
    const crack = Math.abs(periodicNoise(u, v, 16) - 0.5) * -0.9;
    const pit = periodicNoise(u, v, 48) * 0.45;
    return strata + crack + pit;
  }, 2.15);

  return { dustTex, rockTex };
}

const VERTEX_SHADER = /* glsl */ `
  uniform vec4 u_uvScaleOffset;
  uniform float u_exaggeration;
  uniform float u_anchorElevM;

  varying vec2 v_uv;
  varying vec2 v_macroUv;
  varying vec3 v_worldPos;
  varying float v_elevM;

  void main() {
    v_uv = uv;
    v_macroUv = uv * u_uvScaleOffset.xy + u_uvScaleOffset.zw;
    vec4 world = modelMatrix * vec4(position, 1.0);
    v_worldPos = world.xyz;
    v_elevM = u_anchorElevM + (world.y / max(0.01, u_exaggeration));
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D u_macroMap;
  uniform float u_hasMacroMap;
  uniform sampler2D u_terrainNormal;
  uniform sampler2D u_dustDetailNormal;
  uniform sampler2D u_rockDetailNormal;

  uniform int u_mode; // 0: Martian PBR, 1: Lunar Stand-In Slope Hazard, 2: Elevation Strata
  uniform float u_strictSlopeDeg;
  uniform vec3 u_sunDir;
  uniform vec3 u_fogColor;
  uniform float u_fogDensity;
  uniform vec3 u_cursorRtc;
  uniform float u_cursorActive;

  varying vec2 v_uv;
  varying vec2 v_macroUv;
  varying vec3 v_worldPos;
  varying float v_elevM;

  // Reoriented Normal Mapping (RNM) in tangent space (+Z Up)
  vec3 blendRNM(vec3 n1, vec3 n2) {
    vec3 t = n1 + vec3(0.0, 0.0, 1.0);
    vec3 u = vec3(-n2.x, -n2.y, n2.z);
    return normalize(t * dot(t, u) - u * t.z);
  }

  vec3 sampleRotatedDetail(sampler2D tex, vec2 worldXZ, float scale1, float scale2) {
    vec2 uv1 = worldXZ * scale1;
    // Golden-ratio rotation eliminates obvious axial repetition
    mat2 rot = mat2(0.8435, -0.5371, 0.5371, 0.8435);
    vec2 uv2 = (rot * worldXZ) * scale2;
    vec3 d1 = texture2D(tex, uv1).xyz * 2.0 - 1.0;
    vec3 d2 = texture2D(tex, uv2).xyz * 2.0 - 1.0;
    return normalize(vec3(d1.xy * 0.65 + d2.xy * 0.35, max(0.15, d1.z)));
  }

  vec3 slopeHazardRamp(float slopeDeg, float strictDeg) {
    float greenMax = 10.0;
    float amberMax = strictDeg < 16.0 ? 13.0 : 15.0;
    if (slopeDeg <= greenMax) return vec3(0.18, 0.64, 0.40);
    if (slopeDeg <= amberMax) return vec3(0.86, 0.58, 0.14);
    if (slopeDeg <= strictDeg) return vec3(0.84, 0.25, 0.18);
    return vec3(0.32, 0.10, 0.14);
  }

  vec3 elevationStrataRamp(float elevM) {
    float t = clamp((elevM + 3850.6) / 481.3, 0.0, 1.0);
    vec3 lowClay = vec3(0.46, 0.28, 0.20);
    vec3 midMudstone = vec3(0.68, 0.44, 0.30);
    vec3 upperSulfate = vec3(0.78, 0.62, 0.46);
    vec3 c = mix(lowClay, midMudstone, smoothstep(0.0, 0.55, t));
    c = mix(c, upperSulfate, smoothstep(0.50, 1.0, t));
    float contour = 1.0 - smoothstep(0.0, 0.55, abs(fract(elevM / 10.0) - 0.5) * 2.0);
    return mix(c, vec3(0.95, 0.85, 0.72), contour * 0.22);
  }

  void main() {
    vec4 normSample = texture2D(u_terrainNormal, v_uv);
    // Tangent space normal: x = East, y = North, z = Up
    vec3 macroTangentN = normalize(normSample.xyz * 2.0 - 1.0);
    float slopeDeg = normSample.a * 45.0;

    float viewDist = length(cameraPosition - v_worldPos);
    float microFade = 1.0 - smoothstep(55.0, 380.0, viewDist);

    vec3 dustN = sampleRotatedDetail(u_dustDetailNormal, v_worldPos.xz, 0.22, 0.67);
    vec3 rockN = sampleRotatedDetail(u_rockDetailNormal, v_worldPos.xz, 0.18, 0.53);
    float rockMask = smoothstep(5.5, 18.0, slopeDeg);
    vec3 microN = normalize(mix(dustN, rockN, rockMask));
    vec3 dampedMicro = normalize(mix(vec3(0.0, 0.0, 1.0), microN, microFade * (0.62 + 0.35 * rockMask)));
    vec3 tangentN = blendRNM(macroTangentN, dampedMicro);

    // Tangent (East, North, Up) -> Three.js world (+X East, +Y Up, +Z South = -North)
    vec3 worldN = normalize(vec3(tangentN.x, tangentN.z, -tangentN.y));

    // High-frequency Martian micro-grain & basaltic speckle in close-up regolith
    float microGrain = clamp(0.5 + microN.x * 0.85 + microN.y * 0.65, 0.0, 1.0);
    float strataBand = 0.5 + 0.5 * sin(v_elevM * 0.65 + sin(v_worldPos.x * 0.022) * 1.6);
    float ridgeBand = smoothstep(4.0, 16.0, slopeDeg);

    vec3 darkBasalt = vec3(0.28, 0.18, 0.15);
    vec3 dustAlbedo = vec3(0.62, 0.37, 0.23);
    vec3 mudstoneAlbedo = vec3(0.45, 0.29, 0.22);
    vec3 paleVein = vec3(0.75, 0.59, 0.44);

    vec3 baseAlbedo = mix(dustAlbedo, darkBasalt, (1.0 - microGrain) * 0.38 * microFade);
    baseAlbedo = mix(baseAlbedo, mudstoneAlbedo, ridgeBand * 0.78);
    baseAlbedo = mix(baseAlbedo, paleVein, strataBand * (0.14 + 0.28 * ridgeBand));

    if (u_hasMacroMap > 0.5) {
      vec2 mUv = clamp(v_macroUv, 0.002, 0.998);
      vec3 macroRgb = texture2D(u_macroMap, mUv).rgb;
      if (u_mode == 1) {
        vec3 ramp = slopeHazardRamp(slopeDeg, u_strictSlopeDeg);
        baseAlbedo = mix(baseAlbedo * (0.75 + 0.5 * microGrain), mix(macroRgb, ramp, 0.50), 0.78);
      } else {
        // Stretch HiRISE / slope map contrast so orbital features pop clearly on slopes
        float lum = dot(macroRgb, vec3(0.299, 0.587, 0.114));
        float stretched = clamp(0.5 + (lum - 0.45) * 1.75, 0.15, 1.35);
        vec3 tinted = baseAlbedo * (0.55 + 0.82 * stretched);
        baseAlbedo = mix(baseAlbedo, tinted, 0.82);
      }
    } else if (u_mode == 1) {
      baseAlbedo = mix(baseAlbedo, slopeHazardRamp(slopeDeg, u_strictSlopeDeg), 0.68);
    } else if (u_mode == 2) {
      baseAlbedo = elevationStrataRamp(v_elevM) * (0.82 + 0.35 * microGrain * microFade);
    }

    // Subtle steepness cue (> strict limit warning edge darkening in PBR mode)
    if (u_mode == 0 && slopeDeg > u_strictSlopeDeg) {
      baseAlbedo = mix(baseAlbedo, vec3(0.48, 0.17, 0.12), 0.32);
    }

    // Topographic ambient cavity darkening inside fine rock/ripple crevices
    float cavity = 0.84 + 0.26 * microGrain * microFade;
    vec3 sunDir = normalize(u_sunDir);
    vec3 viewDir = normalize(cameraPosition - v_worldPos);
    float ndotl = max(dot(worldN, sunDir), 0.0);
    float skyFill = 0.5 + 0.5 * worldN.y;
    vec3 ambient = mix(vec3(0.19, 0.11, 0.08), vec3(0.43, 0.30, 0.23), skyFill);

    vec3 halfVec = normalize(sunDir + viewDir);
    float shininess = mix(12.0, 32.0, rockMask);
    float spec = pow(max(dot(worldN, halfVec), 0.0), shininess) * mix(0.03, 0.12, rockMask) * ndotl;

    vec3 color = baseAlbedo * cavity * (ambient * 0.68 + vec3(1.18, 0.96, 0.78) * ndotl * 1.05) + vec3(1.0, 0.86, 0.72) * spec;

    // Live interactive hover / reticle terrain ring
    if (u_cursorActive > 0.5) {
      float d = length(v_worldPos.xz - u_cursorRtc.xz);
      float ring = smoothstep(1.2, 0.25, abs(d - 5.5)) + smoothstep(1.2, 0.0, d) * 0.5;
      color = mix(color, vec3(0.25, 0.92, 0.98), clamp(ring, 0.0, 0.85));
    }

    // Gentle Martian airborne dust distance haze (preserves ridge visibility up to 2+ km)
    float fogFactor = 1.0 - exp(-pow(viewDist * u_fogDensity, 1.35));
    color = mix(color, u_fogColor, clamp(fogFactor, 0.0, 0.84));

    // Gentle tone-mapping
    color = color / (color + vec3(0.85));
    color = pow(max(color, 0.0), vec3(1.0 / 2.15));

    gl_FragColor = vec4(color, 1.0);
  }
`;

/**
 * Create a custom Martian PBR ShaderMaterial for a quadtree tile or terrain surface.
 * @param {typeof import('three')} THREE
 * @param {object} opts
 */
export function createMarsTerrainMaterial(THREE, opts = {}) {
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      u_macroMap: { value: opts.macroMap || null },
      u_hasMacroMap: { value: opts.macroMap ? 1.0 : 0.0 },
      u_terrainNormal: { value: opts.terrainNormal || null },
      u_dustDetailNormal: { value: opts.dustDetailNormal },
      u_rockDetailNormal: { value: opts.rockDetailNormal },
      u_uvScaleOffset: {
        value: new THREE.Vector4(
          opts.uvScale?.[0] ?? 1.0,
          opts.uvScale?.[1] ?? 1.0,
          opts.uvOffset?.[0] ?? 0.0,
          opts.uvOffset?.[1] ?? 0.0
        ),
      },
      u_exaggeration: { value: opts.exaggeration ?? 1.0 },
      u_anchorElevM: { value: opts.anchorElevM ?? -3600 },
      u_mode: { value: opts.mode ?? 0 },
      u_strictSlopeDeg: { value: opts.strictSlopeDeg ?? 20.0 },
      u_sunDir: {
        value: new THREE.Vector3(0.56, 0.48, -0.67).normalize(),
      },
      u_fogColor: { value: new THREE.Color(0xb8764d) },
      u_fogDensity: { value: 0.00022 },
      u_cursorRtc: { value: new THREE.Vector3(0, 0, 0) },
      u_cursorActive: { value: 0.0 },
    },
    side: THREE.FrontSide,
  });
  return material;
}

/**
 * Create a Martian sky dome with butterscotch horizon dust scattering and zenith twilight gradient.
 * @param {typeof import('three')} THREE
 */
export function createMarsSkyDome(THREE, radius = 6500) {
  const geo = new THREE.SphereGeometry(radius, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      u_sunDir: { value: new THREE.Vector3(0.56, 0.48, -0.67).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 v_dir;
      void main() {
        v_dir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 u_sunDir;
      varying vec3 v_dir;
      void main() {
        vec3 d = normalize(v_dir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 horizon = vec3(0.75, 0.48, 0.31);
        vec3 midSky = vec3(0.49, 0.32, 0.25);
        vec3 zenith = vec3(0.16, 0.14, 0.20);
        vec3 sky = mix(horizon, midSky, smoothstep(0.0, 0.25, h));
        sky = mix(sky, zenith, smoothstep(0.20, 0.88, h));

        // Mars dusty forward-scattering Mie solar halo (famous pale bluish halo near Sun)
        float sunCos = max(dot(d, normalize(u_sunDir)), 0.0);
        sky += vec3(0.72, 0.78, 0.88) * pow(sunCos, 24.0) * 0.28;
        sky += vec3(1.0, 0.94, 0.86) * pow(sunCos, 380.0) * 1.1;

        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "MarsAtmosphereSkyDome";
  mesh.frustumCulled = false;
  return mesh;
}
