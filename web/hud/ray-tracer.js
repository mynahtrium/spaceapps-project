/**
 * Hybrid Real-Time GPU Ray Tracer (`web/hud/ray-tracer.js`).
 *
 * Implements genuine per-pixel WebGL2 ray tracing / ray marching without hardware DXR:
 *  1. 16-bit mirrored heightfield GPU texture (`buildHeightfieldRtTexture`) sampled in GLSL
 *     with exact manual bilinear interpolation across the entire Mars terrain & mirrored ring.
 *  2. Per-pixel dynamic ray-marched penumbra soft sun shadows (`rtTraceShadow`), 6-azimuth
 *     multi-ray hemisphere global illumination & warm ochre bounce radiosity (`rtTraceGI`),
 *     and grazing terrain Fresnel sky/sun reflections.
 *  3. Per-pixel world-space reflection ray tracing (`rtTraceReflectionRay`) on metallic,
 *     solar-panel, Kapton-foil, and glass surfaces (MMSEV rover, historic rovers, suit visor).
 *  4. Screen-space depth-buffer ray marching in the post pass (`RT_LENS_PARS_GLSL` /
 *     `RT_LENS_APPLY_GLSL`): edge-aware FXAA, jittered contact RTAO / single-bounce SSGI,
 *     and linear-Z screen-space reflections (SSR).
 */

export const RT_HEIGHT_GLSL = /* glsl */ `
uniform float uRtEnabled;
uniform float uRtHeightOn;
uniform sampler2D uRtHeightTex;
uniform vec2 uRtHeightSize;
uniform vec2 uRtOrigin;
uniform vec2 uRtPeriod;
uniform float uRtElevMin;
uniform float uRtElevSpan;
uniform vec3 uRtSunDir;
uniform float uRtTime;

float rtIgn(vec2 p) {
  vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
  return fract(magic.z * fract(dot(p, magic.xy)));
}

float rtDecodeTexel(vec2 texelCoord) {
  vec2 uv = (texelCoord + 0.5) / uRtHeightSize;
  vec4 c = texture2D(uRtHeightTex, uv);
  float val16 = (c.r * 255.0 * 256.0 + c.g * 255.0) / 65535.0;
  return uRtElevMin + val16 * uRtElevSpan;
}

float rtSampleHeight(vec2 worldXZ) {
  if (uRtHeightOn < 0.5) return 0.0;
  vec2 uv = fract((worldXZ - uRtOrigin) / uRtPeriod);
  vec2 px = uv * uRtHeightSize - 0.5;
  vec2 i0 = floor(px);
  vec2 f = px - i0;
  float h00 = rtDecodeTexel(mod(i0, uRtHeightSize));
  float h10 = rtDecodeTexel(mod(i0 + vec2(1.0, 0.0), uRtHeightSize));
  float h01 = rtDecodeTexel(mod(i0 + vec2(0.0, 1.0), uRtHeightSize));
  float h11 = rtDecodeTexel(mod(i0 + vec2(1.0, 1.0), uRtHeightSize));
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

vec3 rtSampleNormal(vec2 worldXZ) {
  float eps = 1.6;
  float hL = rtSampleHeight(worldXZ - vec2(eps, 0.0));
  float hR = rtSampleHeight(worldXZ + vec2(eps, 0.0));
  float hD = rtSampleHeight(worldXZ - vec2(0.0, eps));
  float hU = rtSampleHeight(worldXZ + vec2(0.0, eps));
  return normalize(vec3(hL - hR, 2.0 * eps, hD - hU));
}

vec3 rtMarsSky(vec3 dir, vec3 sunDir) {
  float h = clamp(dir.y, -0.05, 1.0);
  vec3 zenith = vec3(0.46, 0.31, 0.24);
  vec3 horizon = vec3(0.76, 0.52, 0.36);
  vec3 col = mix(horizon, zenith, pow(max(0.0, h), 0.58));
  float mu = max(dot(normalize(dir), normalize(sunDir)), 0.0);
  col += vec3(0.95, 0.78, 0.62) * pow(mu, 10.0) * 0.34;
  col += vec3(1.6, 1.38, 1.15) * smoothstep(0.9994, 0.99985, mu) * 2.2;
  return col;
}

float rtTraceShadow(vec3 worldPos, vec3 sunDir, float maxDist, float jitter) {
  if (uRtHeightOn < 0.5 || sunDir.y <= 0.02) return 1.0;
  float res = 1.0;
  float t = 0.75 + jitter * 0.85;
  for (int i = 0; i < 24; i++) {
    vec3 p = worldPos + sunDir * t;
    float h = rtSampleHeight(p.xz);
    float diff = p.y - h;
    if (diff < 0.0) return 0.0;
    res = min(res, clamp(6.5 * diff / max(t, 0.8), 0.0, 1.0));
    if (res < 0.01) return 0.0;
    t += max(0.9, t * 0.19);
    if (t > maxDist) break;
  }
  return clamp(res, 0.0, 1.0);
}

void rtTraceGI(vec3 worldPos, vec3 normal, vec3 sunDir, float jitter, out float skyVis, out vec3 bounceGI) {
  skyVis = 1.0;
  bounceGI = vec3(0.0);
  if (uRtHeightOn < 0.5) return;
  float occSum = 0.0;
  vec3 bounceAccum = vec3(0.0);
  float baseAng = jitter * 6.2831853;
  for (int i = 0; i < 6; i++) {
    float ang = baseAng + float(i) * 1.04719755;
    vec2 dirXZ = vec2(cos(ang), sin(ang));
    float maxSlope = 0.0;
    float hitDist = 0.0;
    vec2 hitXZ = worldPos.xz;
    float hitH = worldPos.y;
    for (int s = 0; s < 3; s++) {
      float d = (s == 0) ? 3.2 : ((s == 1) ? 9.5 : 22.0);
      vec2 sampleXZ = worldPos.xz + dirXZ * d;
      float h = rtSampleHeight(sampleXZ);
      float slope = (h - worldPos.y) / d;
      if (slope > maxSlope) {
        maxSlope = slope;
        hitDist = d;
        hitXZ = sampleXZ;
        hitH = h;
      }
    }
    float horizonBlock = clamp(maxSlope * 1.45, 0.0, 1.0);
    occSum += horizonBlock;
    if (horizonBlock > 0.05 && hitDist > 0.1) {
      vec3 hitN = rtSampleNormal(hitXZ);
      float hitSun = max(0.0, dot(hitN, sunDir));
      float facing = max(
        0.2,
        dot(normal, normalize(vec3(hitXZ.x - worldPos.x, max(0.4, hitH - worldPos.y), hitXZ.y - worldPos.z)))
      );
      bounceAccum += vec3(1.18, 0.52, 0.24) * hitSun * horizonBlock * facing * 0.44;
    }
  }
  skyVis = clamp(1.0 - (occSum / 6.0) * 0.78, 0.18, 1.0);
  bounceGI = bounceAccum / 6.0;
}

vec3 rtTraceReflectionRay(vec3 origin, vec3 rayDir, vec3 sunDir, float jitter) {
  if (uRtHeightOn > 0.5 && rayDir.y < 0.25) {
    float t = 0.4 + jitter * 0.4;
    float prevT = 0.0;
    for (int i = 0; i < 14; i++) {
      vec3 p = origin + rayDir * t;
      float h = rtSampleHeight(p.xz);
      if (p.y <= h) {
        float midT = 0.5 * (prevT + t);
        vec3 hitP = origin + rayDir * midT;
        vec3 hitN = rtSampleNormal(hitP.xz);
        float ndl = max(0.0, dot(hitN, sunDir));
        float sh = rtTraceShadow(vec3(hitP.x, rtSampleHeight(hitP.xz) + 0.15, hitP.z), sunDir, 90.0, jitter);
        vec3 regolith = vec3(0.56, 0.25, 0.14);
        vec3 litTerrain = regolith * (vec3(0.18, 0.11, 0.09) + vec3(1.25, 0.96, 0.78) * ndl * sh);
        float fog = 1.0 - exp(-midT * 0.0045);
        return mix(litTerrain, rtMarsSky(rayDir, sunDir), fog);
      }
      prevT = t;
      t += max(0.7, t * 0.34);
      if (t > 120.0) break;
    }
  }
  return rtMarsSky(rayDir, sunDir);
}
`;

export const RT_LENS_PARS_GLSL = /* glsl */ `
uniform sampler2D tDepth;
uniform float uRtEnabled;
uniform mat4 uRtProj;
uniform mat4 uRtInvProj;

vec3 rtReconstructViewPos(vec2 uv, float depth) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 v = uRtInvProj * ndc;
  return v.xyz / max(abs(v.w), 1e-5);
}

vec2 rtProjectViewToUv(vec3 viewPos, out float linearZ) {
  vec4 clip = uRtProj * vec4(viewPos, 1.0);
  vec2 uv = (clip.xy / max(abs(clip.w), 1e-5)) * 0.5 + 0.5;
  linearZ = -viewPos.z;
  return uv;
}

vec3 rtFxaaSample(sampler2D tex, vec2 uv, vec2 res) {
  vec2 px = 1.0 / max(res, vec2(1.0));
  vec3 cM = texture2D(tex, uv).rgb;
  vec3 cNW = texture2D(tex, uv + vec2(-px.x, -px.y)).rgb;
  vec3 cNE = texture2D(tex, uv + vec2(px.x, -px.y)).rgb;
  vec3 cSW = texture2D(tex, uv + vec2(-px.x, px.y)).rgb;
  vec3 cSE = texture2D(tex, uv + vec2(px.x, px.y)).rgb;
  vec3 luma = vec3(0.299, 0.587, 0.114);
  float lM = dot(cM, luma);
  float lNW = dot(cNW, luma);
  float lNE = dot(cNE, luma);
  float lSW = dot(cSW, luma);
  float lSE = dot(cSE, luma);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.03, lMax * 0.1)) return cM;
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float dirReduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir * rcpDirMin, vec2(-4.0), vec2(4.0)) * px;
  vec3 a = 0.5 * (texture2D(tex, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tex, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = 0.5 * a + 0.25 * (texture2D(tex, uv - dir * 0.5).rgb + texture2D(tex, uv + dir * 0.5).rgb);
  float lB = dot(b, luma);
  return (lB < lMin || lB > lMax) ? a : b;
}

vec3 rtScreenSpacePass(sampler2D diffTex, vec3 baseCol, vec2 uv, vec2 res, float jitter) {
  if (uRtEnabled < 0.5) return baseCol;
  float depth = texture2D(tDepth, uv).r;
  if (depth >= 0.99985) return baseCol;

  vec2 px = 1.0 / max(res, vec2(1.0));
  vec3 P = rtReconstructViewPos(uv, depth);
  float dist = -P.z;
  if (dist > 140.0 || dist <= 0.02) return baseCol;

  float dL = texture2D(tDepth, uv - vec2(px.x, 0.0)).r;
  float dR = texture2D(tDepth, uv + vec2(px.x, 0.0)).r;
  float dD = texture2D(tDepth, uv - vec2(0.0, px.y)).r;
  float dU = texture2D(tDepth, uv + vec2(0.0, px.y)).r;
  vec3 pL = rtReconstructViewPos(uv - vec2(px.x, 0.0), dL);
  vec3 pR = rtReconstructViewPos(uv + vec2(px.x, 0.0), dR);
  vec3 pD = rtReconstructViewPos(uv - vec2(0.0, px.y), dD);
  vec3 pU = rtReconstructViewPos(uv + vec2(0.0, px.y), dU);
  vec3 dX = (abs(pR.z - P.z) < abs(P.z - pL.z)) ? (pR - P) : (P - pL);
  vec3 dY = (abs(pU.z - P.z) < abs(P.z - pD.z)) ? (pU - P) : (P - pD);
  vec3 N = normalize(cross(dX, dY));
  vec3 V = normalize(-P);
  if (dot(N, V) < 0.0) N = -N;

  // 1. Screen-space ray-traced contact AO + short-range SSGI bounce
  float ao = 0.0;
  vec3 ssgi = vec3(0.0);
  float aoRadius = clamp(dist * 0.045, 0.22, 1.35);
  for (int i = 0; i < 6; i++) {
    float ang = (float(i) + jitter) * 1.04719755;
    float r = aoRadius * (0.35 + 0.65 * fract(jitter * 1.7 + float(i) * 0.37));
    vec3 dirV = normalize(N + vec3(cos(ang), sin(ang), 0.25) * 0.85);
    vec3 sampleV = P + dirV * r;
    float rayZ;
    vec2 suv = rtProjectViewToUv(sampleV, rayZ);
    if (suv.x > 0.01 && suv.x < 0.99 && suv.y > 0.01 && suv.y < 0.99) {
      float sd = texture2D(tDepth, suv).r;
      vec3 hitV = rtReconstructViewPos(suv, sd);
      float deltaZ = rayZ - (-hitV.z);
      if (deltaZ > 0.02 && deltaZ < aoRadius * 1.65) {
        float w = 1.0 - smoothstep(0.0, aoRadius * 1.65, deltaZ);
        ao += w;
        ssgi += texture2D(diffTex, suv).rgb * w * 0.16;
      }
    }
  }
  ao = clamp(1.0 - (ao / 6.0) * 0.56, 0.4, 1.0);
  vec3 outCol = baseCol * ao + (ssgi / 6.0) * ao;

  // 2. Screen-space ray-traced reflections (SSR) weighted by grazing Fresnel & surface smoothness
  float nVar = length(dX - (pR - pL) * 0.5) + length(dY - (pU - pD) * 0.5);
  float flatness = exp(-nVar * 12.0);
  float fresnel = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
  float ssrWeight = clamp(fresnel * flatness * (1.0 - smoothstep(45.0, 130.0, dist)), 0.0, 0.36);
  if (ssrWeight > 0.012) {
    vec3 R = reflect(-V, N);
    if (R.z < 0.35) {
      float stepLen = 0.28 + jitter * 0.22;
      for (int s = 0; s < 14; s++) {
        vec3 rayV = P + R * stepLen;
        float rayZ;
        vec2 ruv = rtProjectViewToUv(rayV, rayZ);
        if (ruv.x < 0.01 || ruv.x > 0.99 || ruv.y < 0.01 || ruv.y > 0.99 || rayZ <= 0.05) break;
        float sd = texture2D(tDepth, ruv).r;
        float hitZ = -rtReconstructViewPos(ruv, sd).z;
        float dz = rayZ - hitZ;
        float thickness = max(0.35, stepLen * 0.28);
        if (dz > 0.0 && dz < thickness) {
          float edge = smoothstep(0.0, 0.08, min(min(ruv.x, 1.0 - ruv.x), min(ruv.y, 1.0 - ruv.y)));
          vec3 reflCol = texture2D(diffTex, ruv).rgb;
          outCol = mix(outCol, reflCol, ssrWeight * edge);
          break;
        }
        stepLen += max(0.35, stepLen * 0.32);
      }
    }
  }
  return outCol;
}
`;

function mirrorWrap01(t) {
  const m = ((t % 2) + 2) % 2;
  return m <= 1 ? m : 2 - m;
}

/**
 * Packs any height sampler `sampleHeight(x, z)` into a 2N x 2N mirrored 16-bit RGBA DataTexture
 * covering `period = (2*worldW, 2*worldH)` around `origin = (-worldW/2, -worldH/2)`.
 */
export function buildHeightfieldRtData(sampleHeight, worldW, worldH, res = 192) {
  const n = Math.max(32, Math.floor(res));
  const N = 2 * n;
  const heights = new Float32Array(N * N);
  let minH = Infinity;
  let maxH = -Infinity;
  for (let r = 0; r < N; r++) {
    const mz = (mirrorWrap01((r + 0.5) / n) - 0.5) * worldH;
    for (let c = 0; c < N; c++) {
      const mx = (mirrorWrap01((c + 0.5) / n) - 0.5) * worldW;
      const h = Number(sampleHeight(mx, mz)) || 0;
      heights[r * N + c] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }
  const span = Math.max(1, maxH - minH);
  const out = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const norm = Math.max(0, Math.min(1, (heights[i] - minH) / span));
    const q = Math.round(norm * 65535);
    const o = i * 4;
    out[o] = (q >> 8) & 255;
    out[o + 1] = q & 255;
    out[o + 2] = 0;
    out[o + 3] = 255;
  }
  return {
    data: out,
    width: N,
    height: N,
    minH,
    span,
  };
}

export function buildHeightfieldRtTexture(THREE, sampleHeight, worldW, worldH, res = 192) {
  const packed = buildHeightfieldRtData(sampleHeight, worldW, worldH, res);
  const tex = new THREE.DataTexture(packed.data, packed.width, packed.height, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return {
    texture: tex,
    width: packed.width,
    height: packed.height,
    minH: packed.minH,
    span: packed.span,
  };
}

export function createRayTracerUniforms(THREE, worldW, worldH, sunDir, heightInfo) {
  return {
    uRtEnabled: { value: 0 },
    uRtHeightOn: { value: heightInfo ? 1 : 0 },
    uRtHeightTex: { value: heightInfo?.texture || null },
    uRtHeightSize: { value: new THREE.Vector2(heightInfo?.width || 1, heightInfo?.height || 1) },
    uRtOrigin: { value: new THREE.Vector2(-worldW / 2, -worldH / 2) },
    uRtPeriod: { value: new THREE.Vector2(2 * worldW, 2 * worldH) },
    uRtElevMin: { value: heightInfo?.minH || 0 },
    uRtElevSpan: { value: heightInfo?.span || 1 },
    uRtSunDir: { value: sunDir.clone() },
    uRtTime: { value: 0 },
  };
}

/**
 * Patches any MeshStandardMaterial-based 3D object hierarchy (rovers, solar panels, glass hatches,
 * astronaut visor/suit) so when Ray Tracing is active, reflective surfaces trace real-time rays
 * against the Mars terrain heightfield + analytical sky + sun, plus receive dynamic ridge shadows
 * and warm Martian terrain bounce GI.
 */
export function patchObjectRayTracer(THREE, root, rtUniforms, { reflectScale = 1.0 } = {}) {
  if (!THREE || !root || !rtUniforms) return;
  const seen = new Set();
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat || (!mat.isMeshStandardMaterial && !mat.isMeshPhysicalMaterial)) continue;
      if (seen.has(mat) || mat.userData?.rtPatched) continue;
      seen.add(mat);
      mat.userData = { ...(mat.userData || {}), rtPatched: true };
      const prevCompile = mat.onBeforeCompile;
      const prevCacheKey = mat.customProgramCacheKey;
      mat.customProgramCacheKey = () =>
        `${prevCacheKey ? prevCacheKey.call(mat) : ""}|mm-rt-obj-${reflectScale.toFixed(2)}`;
      mat.onBeforeCompile = (shader, renderer) => {
        if (prevCompile) prevCompile.call(mat, shader, renderer);
        Object.assign(shader.uniforms, rtUniforms);
        shader.uniforms.uRtReflectScale = { value: reflectScale };
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vRtWorldPos;")
          .replace(
            "#include <project_vertex>",
            "vec4 rtWPos = modelMatrix * vec4(transformed, 1.0);\nvRtWorldPos = rtWPos.xyz;\n#include <project_vertex>"
          );
        const dirChunk = THREE.ShaderChunk.lights_fragment_begin.replace(
          "getDirectionalLightInfo( directionalLight, directLight );",
          "getDirectionalLightInfo( directionalLight, directLight );\n\t\t\tif (uRtEnabled > 0.5) {\n\t\t\t\tvec3 rtN0 = normalize((vec4(geometryNormal, 0.0) * viewMatrix).xyz);\n\t\t\t\tfloat rtJ0 = rtIgn(gl_FragCoord.xy + fract(uRtTime) * 43.0);\n\t\t\t\tdirectLight.color *= mix(0.28, 1.0, rtTraceShadow(vRtWorldPos + rtN0 * 0.08, uRtSunDir, 150.0, rtJ0));\n\t\t\t}"
        );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            `#include <common>\nvarying vec3 vRtWorldPos;\nuniform float uRtReflectScale;\n${RT_HEIGHT_GLSL}`
          )
          .replace("#include <lights_fragment_begin>", dirChunk)
          .replace(
            "#include <lights_fragment_end>",
            `#include <lights_fragment_end>
            if (uRtEnabled > 0.5) {
              vec3 rtWN = normalize((vec4(geometryNormal, 0.0) * viewMatrix).xyz);
              vec3 rtWV = normalize((vec4(geometryViewDir, 0.0) * viewMatrix).xyz);
              vec3 rtR = reflect(-rtWV, rtWN);
              float rtJ2 = rtIgn(gl_FragCoord.xy + fract(uRtTime * 1.7) * 61.0);
              float gloss = pow(clamp(1.0 - material.roughness, 0.0, 1.0), 1.65);
              float ndv = clamp(dot(rtWN, rtWV), 0.0, 1.0);
              vec3 f0 = material.specularColor;
              vec3 fresnel = f0 + (vec3(1.0) - f0) * pow(1.0 - ndv, 5.0);
              float reflMask = clamp(gloss * (0.28 + 0.72 * max(metalnessFactor, pow(1.0 - ndv, 2.5))), 0.0, 0.92) * uRtReflectScale;
              if (reflMask > 0.015) {
                vec3 tracedRefl = rtTraceReflectionRay(vRtWorldPos + rtWN * 0.08, rtR, uRtSunDir, rtJ2);
                reflectedLight.indirectSpecular += tracedRefl * fresnel * reflMask * 0.95;
              }
              float groundFacing = clamp(-rtWN.y * 0.5 + 0.5, 0.0, 1.0);
              reflectedLight.indirectDiffuse += material.diffuseColor * vec3(0.55, 0.24, 0.12) * groundFacing * 0.32;
            }`
          );
      };
      mat.needsUpdate = true;
    }
  });
}
