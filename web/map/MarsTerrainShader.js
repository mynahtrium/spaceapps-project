/**
 * Custom Martian PBR Terrain Shader (`MarsTerrainShader`),
 * Reoriented Normal Mapping (`blendRNM`), Multi-Scale Rotated Dust/Mudstone Albedo + Normals,
 * Martian Golden-Afternoon Sun & Dust Atmospheric Scattering, and Sky Dome.
 */

import { createMartianPbrTextureSets } from "./MarsPbrTextures.js";

export function createMartianMicroDetailTextures(THREE, size = 256) {
  return createMartianPbrTextureSets(THREE, size);
}

const VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
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
    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D u_macroMap;
  uniform float u_hasMacroMap;
  uniform sampler2D u_terrainNormal;
  uniform sampler2D u_dustAlbedo;
  uniform sampler2D u_rockAlbedo;
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

  vec3 sampleDualNormal(sampler2D tex, vec2 worldXZ, float closeScale, float farScale, float farMix) {
    mat2 rot = mat2(0.8435, -0.5371, 0.5371, 0.8435);
    vec3 nClose = texture2D(tex, worldXZ * closeScale).xyz * 2.0 - 1.0;
    vec3 nFar = texture2D(tex, (rot * worldXZ) * farScale).xyz * 2.0 - 1.0;
    vec3 mixed = mix(nClose, nFar, farMix);
    return normalize(vec3(mixed.xy, max(0.18, mixed.z)));
  }

  vec3 sampleDualAlbedo(sampler2D tex, vec2 worldXZ, float closeScale, float farScale, float farMix) {
    mat2 rot = mat2(0.8435, -0.5371, 0.5371, 0.8435);
    vec3 aClose = texture2D(tex, worldXZ * closeScale).rgb;
    vec3 aFar = texture2D(tex, (rot * worldXZ) * farScale).rgb;
    vec3 blended = mix(aClose, aFar, 0.35 + 0.55 * farMix);
    // Multiply slight macro patch variation so wide dust plains never repeat uniformly
    vec3 patchTint = texture2D(tex, worldXZ * 0.0045).rgb;
    return blended * (0.72 + 0.56 * patchTint);
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
    float farMix = smoothstep(22.0, 260.0, viewDist);
    float closeFade = 1.0 - smoothstep(90.0, 580.0, viewDist);

    // Rich surface material blend: sandy ripples in flat hollows -> fractured mudstone on slopes/ridges
    float rockMask = smoothstep(3.5, 13.5, slopeDeg);

    vec3 dustAlb = sampleDualAlbedo(u_dustAlbedo, v_worldPos.xz, 0.11, 0.024, farMix);
    vec3 rockAlb = sampleDualAlbedo(u_rockAlbedo, v_worldPos.xz, 0.13, 0.028, farMix);

    vec3 dustN = sampleDualNormal(u_dustDetailNormal, v_worldPos.xz, 0.11, 0.024, farMix);
    vec3 rockN = sampleDualNormal(u_rockDetailNormal, v_worldPos.xz, 0.13, 0.028, farMix);

    vec3 surfaceAlbedo = mix(dustAlb, rockAlb, rockMask);
    // Subtle Mount Sharp sedimentary stratigraphic color bands exposed on steeper slopes
    float strataBand = 0.5 + 0.5 * sin(v_elevM * 0.75 + sin(v_worldPos.x * 0.018) * 1.4);
    surfaceAlbedo = mix(surfaceAlbedo, surfaceAlbedo * vec3(1.16, 1.12, 1.04), strataBand * rockMask * 0.34);

    vec3 microN = normalize(mix(dustN, rockN, rockMask));
    float nStrength = mix(0.45, 0.92, closeFade) + rockMask * 0.20;
    vec3 dampedMicro = normalize(mix(vec3(0.0, 0.0, 1.0), microN, clamp(nStrength, 0.25, 1.0)));
    vec3 tangentN = blendRNM(macroTangentN, dampedMicro);

    // Tangent (East, North, Up) -> Three.js world (+X East, +Y Up, +Z South = -North)
    vec3 worldN = normalize(vec3(tangentN.x, tangentN.z, -tangentN.y));

    if (u_mode == 1) {
      vec3 ramp = slopeHazardRamp(slopeDeg, u_strictSlopeDeg);
      if (u_hasMacroMap > 0.5) {
        vec3 macroRgb = texture2D(u_macroMap, clamp(v_macroUv, 0.002, 0.998)).rgb;
        ramp = mix(macroRgb, ramp, 0.5);
      }
      surfaceAlbedo = mix(surfaceAlbedo * 0.85, ramp, 0.72);
    } else if (u_mode == 2) {
      surfaceAlbedo = mix(surfaceAlbedo * 0.45, elevationStrataRamp(v_elevM), 0.78);
    } else if (u_hasMacroMap > 0.5) {
      // In mode 0 (Mars PBR), modulate crisp micro-textures with stretched orbital HiRISE ortho albedo
      vec3 macroRgb = texture2D(u_macroMap, clamp(v_macroUv, 0.002, 0.998)).rgb;
      float lum = dot(macroRgb, vec3(0.299, 0.587, 0.114));
      float contrast = clamp(0.65 + (lum - 0.44) * 1.55, 0.38, 1.45);
      surfaceAlbedo *= mix(1.0, contrast, 0.55 + 0.30 * farMix);
    }

    // Slope steepness accent (> limit rim darkening in PBR mode)
    if (u_mode == 0 && slopeDeg > u_strictSlopeDeg) {
      surfaceAlbedo = mix(surfaceAlbedo, vec3(0.48, 0.17, 0.12), 0.30);
    }

    // Lighting: warm golden afternoon Mars sun + dusty sky bounce + rock specular
    vec3 sunDir = normalize(u_sunDir);
    vec3 viewDir = normalize(cameraPosition - v_worldPos);
    float ndotl = max(dot(worldN, sunDir), 0.0);
    float skyFill = 0.5 + 0.5 * worldN.y;
    vec3 ambient = mix(vec3(0.16, 0.09, 0.07), vec3(0.39, 0.27, 0.21), skyFill);

    vec3 halfVec = normalize(sunDir + viewDir);
    float shininess = mix(10.0, 28.0, rockMask);
    float spec = pow(max(dot(worldN, halfVec), 0.0), shininess) * mix(0.03, 0.14, rockMask) * ndotl;

    vec3 color = surfaceAlbedo * (ambient * 0.62 + vec3(1.24, 0.98, 0.78) * ndotl * 1.12)
               + vec3(1.0, 0.86, 0.72) * spec;

    // Interactive hover / reticle ground ring
    if (u_cursorActive > 0.5) {
      float d = length(v_worldPos.xz - u_cursorRtc.xz);
      float ring = smoothstep(0.9, 0.2, abs(d - 4.2)) + smoothstep(0.9, 0.0, d) * 0.55;
      color = mix(color, vec3(0.25, 0.92, 0.98), clamp(ring, 0.0, 0.85));
    }

    // Distance atmospheric scattering (clear out to ~1.5 km, warm dusty horizon beyond)
    float fogFactor = 1.0 - exp(-pow(viewDist * u_fogDensity, 1.35));
    color = mix(color, u_fogColor, clamp(fogFactor, 0.0, 0.78));

    // Filmic contrast + gamma
    color = (color * (2.2 * color + 0.08)) / (color * (1.85 * color + 0.62) + 0.06);
    color = pow(clamp(color, 0.0, 1.0), vec3(1.0 / 2.15));

    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(color, 1.0);
  }
`;

export function createMarsTerrainMaterial(THREE, opts = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      u_macroMap: { value: opts.macroMap || null },
      u_hasMacroMap: { value: opts.macroMap ? 1.0 : 0.0 },
      u_terrainNormal: { value: opts.terrainNormal || null },
      u_dustAlbedo: { value: opts.dustAlbedo },
      u_rockAlbedo: { value: opts.rockAlbedo },
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
        value: new THREE.Vector3(0.66, 0.34, -0.66).normalize(),
      },
      u_fogColor: { value: new THREE.Color(0xc28359) },
      u_fogDensity: { value: 0.00018 },
      u_cursorRtc: { value: new THREE.Vector3(0, 0, 0) },
      u_cursorActive: { value: 0.0 },
    },
    side: THREE.FrontSide,
  });
}

export function createMarsSkyDome(THREE, radius = 7500) {
  const geo = new THREE.SphereGeometry(radius, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      u_sunDir: { value: new THREE.Vector3(0.66, 0.34, -0.66).normalize() },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 v_dir;
      void main() {
        v_dir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 u_sunDir;
      varying vec3 v_dir;
      void main() {
        vec3 d = normalize(v_dir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 horizon = vec3(0.76, 0.51, 0.35);
        vec3 midSky = vec3(0.52, 0.36, 0.28);
        vec3 zenith = vec3(0.14, 0.13, 0.19);
        vec3 sky = mix(horizon, midSky, smoothstep(0.0, 0.24, h));
        sky = mix(sky, zenith, smoothstep(0.18, 0.85, h));

        float sunCos = max(dot(d, normalize(u_sunDir)), 0.0);
        sky += vec3(0.70, 0.78, 0.90) * pow(sunCos, 22.0) * 0.32;
        sky += vec3(1.0, 0.95, 0.88) * pow(sunCos, 360.0) * 1.15;

        #include <logdepthbuf_fragment>
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "MarsAtmosphereSkyDome";
  mesh.frustumCulled = false;
  return mesh;
}
