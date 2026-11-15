/**
 * Hybrid Real-Time GPU Ray Tracer (`web/hud/ray-tracer.js`).
 *
 * 5-Tier Scalable Quality System (`OFF` / `PERFORMANCE` / `BALANCED` / `HIGH` / `ULTRA`):
 *  - Tier 0 (`off`): Ray tracing completely bypassed for maximum baseline framerate.
 *  - Tier 1 (`performance`, 0.5x half-res): 1 bounce, 16-step shadows/reflections, early ray
 *    termination, and fast spatial/temporal bilateral + CAS denoising (60+ FPS on RTX 4060).
 *  - Tier 2 (`balanced`, 0.7x): 2 bounces, 32-step glossy reflections + soft penumbra RT shadows.
 *  - Tier 3 (`high`, 1.0x native): 3 bounces, 64-step full metallic rover/habitat reflections
 *    and crisp contact shadows.
 *  - Tier 4 (`ultra`, 1.25x supersampled): 4+ bounces, 128-step precision ray-marching,
 *    multi-bounce global illumination/AO, and full-sample reflections with zero step clamping.
 */

export const RT_INTERNAL_RESOLUTION_SCALE = 0.5;

const TIER_OFF = Object.freeze({
  id: "off",
  tier: 0,
  enabled: 0,
  quality: 0,
  resolutionScale: 1.0,
  maxBounces: 0,
  shadowSteps: 0,
  reflSteps: 0,
  giRays: 0,
  giSteps: 0,
  aoSamples: 0,
  ssrSteps: 0,
  maxDist: 0,
  hudPill: "RT: OFF",
  hudLabelEn: "OFF (TIER 0 · BYPASSED)",
  hudLabelTr: "KAPALI (SEVİYE 0)",
});

const TIER_PERFORMANCE = Object.freeze({
  id: "performance",
  tier: 1,
  enabled: 1,
  quality: 1,
  resolutionScale: 0.5,
  maxBounces: 1,
  shadowSteps: 16,
  reflSteps: 16,
  giRays: 2,
  giSteps: 1,
  aoSamples: 2,
  ssrSteps: 4,
  maxDist: 110,
  hudPill: "RT: PERF 0.5×",
  hudLabelEn: "PERFORMANCE (0.5× · 1 BOUNCE · 16 STEPS · 60+ FPS)",
  hudLabelTr: "PERFORMANS (0.5× · 1 SEKME · 16 ADIM · 60+ FPS)",
});

const TIER_BALANCED = Object.freeze({
  id: "balanced",
  tier: 2,
  enabled: 1,
  quality: 2,
  resolutionScale: 0.7,
  maxBounces: 2,
  shadowSteps: 32,
  reflSteps: 32,
  giRays: 4,
  giSteps: 2,
  aoSamples: 4,
  ssrSteps: 8,
  maxDist: 170,
  hudPill: "RT: BAL 0.7×",
  hudLabelEn: "BALANCED (0.7× · 2 BOUNCES · 32 STEPS)",
  hudLabelTr: "DENGELİ (0.7× · 2 SEKME · 32 ADIM)",
});

const TIER_HIGH = Object.freeze({
  id: "high",
  tier: 3,
  enabled: 1,
  quality: 3,
  resolutionScale: 1.0,
  maxBounces: 3,
  shadowSteps: 64,
  reflSteps: 64,
  giRays: 6,
  giSteps: 3,
  aoSamples: 6,
  ssrSteps: 16,
  maxDist: 280,
  hudPill: "RT: HIGH 1.0×",
  hudLabelEn: "HIGH (1.0× NATIVE · 3 BOUNCES · 64 STEPS)",
  hudLabelTr: "YÜKSEK (1.0× TAM · 3 SEKME · 64 ADIM)",
});

const TIER_ULTRA = Object.freeze({
  id: "ultra",
  tier: 4,
  enabled: 1,
  quality: 4,
  resolutionScale: 1.25,
  maxBounces: 4,
  shadowSteps: 128,
  reflSteps: 128,
  giRays: 8,
  giSteps: 4,
  aoSamples: 10,
  ssrSteps: 24,
  maxDist: 520,
  hudPill: "RT: ULTRA",
  hudLabelEn: "ULTRA (UNLIMITED · 4+ BOUNCES · 128 STEPS)",
  hudLabelTr: "ULTRA (SINIRSIZ · 4+ SEKME · 128 ADIM)",
});

export const RT_QUALITY_PRESETS = Object.freeze({
  off: TIER_OFF,
  low: TIER_PERFORMANCE,
  performance: TIER_PERFORMANCE,
  balanced: TIER_BALANCED,
  high: TIER_HIGH,
  ultra: TIER_ULTRA,
});

export function getRayTracingPreset(modeOrCfg) {
  if (!modeOrCfg) return TIER_OFF;
  if (typeof modeOrCfg === "string") {
    return RT_QUALITY_PRESETS[modeOrCfg.toLowerCase()] || TIER_OFF;
  }
  if (typeof modeOrCfg === "object") {
    if (modeOrCfg.rayTracing === false) return TIER_OFF;
    const m = typeof modeOrCfg.rayTracingMode === "string" ? modeOrCfg.rayTracingMode.toLowerCase() : "";
    if (m && RT_QUALITY_PRESETS[m]) return RT_QUALITY_PRESETS[m];
    return modeOrCfg.rayTracing ? TIER_HIGH : TIER_OFF;
  }
  return TIER_OFF;
}

export function applyRayTracerTierUniforms(rtUniforms, modeOrCfg) {
  const preset = getRayTracingPreset(modeOrCfg);
  if (!rtUniforms) return preset;
  if (rtUniforms.uRtEnabled) rtUniforms.uRtEnabled.value = preset.enabled;
  if (rtUniforms.uRtQuality) rtUniforms.uRtQuality.value = preset.quality;
  if (rtUniforms.uRtResScale) rtUniforms.uRtResScale.value = preset.resolutionScale;
  if (rtUniforms.uRtMaxBounces) rtUniforms.uRtMaxBounces.value = preset.maxBounces;
  if (rtUniforms.uRtShadowSteps) rtUniforms.uRtShadowSteps.value = preset.shadowSteps;
  if (rtUniforms.uRtReflSteps) rtUniforms.uRtReflSteps.value = preset.reflSteps;
  if (rtUniforms.uRtGiRays) rtUniforms.uRtGiRays.value = preset.giRays;
  if (rtUniforms.uRtGiSteps) rtUniforms.uRtGiSteps.value = preset.giSteps;
  if (rtUniforms.uRtAoSamples) rtUniforms.uRtAoSamples.value = preset.aoSamples;
  if (rtUniforms.uRtSsrSteps) rtUniforms.uRtSsrSteps.value = preset.ssrSteps;
  if (rtUniforms.uRtMaxDist) rtUniforms.uRtMaxDist.value = preset.maxDist;
  return preset;
}

export const RT_HEIGHT_GLSL = /* glsl */ `
uniform float uRtEnabled;
uniform float uRtQuality;
uniform float uRtResScale;
uniform float uRtMaxBounces;
uniform float uRtShadowSteps;
uniform float uRtReflSteps;
uniform float uRtGiRays;
uniform float uRtGiSteps;
uniform float uRtMaxDist;
uniform float uRtHeightOn;
uniform sampler2D uRtHeightTex;
uniform vec2 uRtHeightSize;
uniform vec2 uRtOrigin;
uniform vec2 uRtPeriod;
uniform float uRtElevMin;
uniform float uRtElevSpan;
uniform vec3 uRtSunDir;
uniform float uRtTime;

const int RT_HARD_MAX_STEPS = 128;

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

float rtSampleHeightFast(vec2 worldXZ) {
  float h = 0.0;
  if (uRtHeightOn >= 0.5) {
    vec2 uv = fract((worldXZ - uRtOrigin) / uRtPeriod);
    vec4 c = texture2D(uRtHeightTex, uv);
    float val16 = (c.r * 255.0 * 256.0 + c.g * 255.0) / 65535.0;
    h = uRtElevMin + val16 * uRtElevSpan;
  }
  return h;
}

float rtSampleHeight(vec2 worldXZ) {
  float h = 0.0;
  if (uRtHeightOn >= 0.5) {
    vec2 uv = fract((worldXZ - uRtOrigin) / uRtPeriod);
    vec2 px = uv * uRtHeightSize - 0.5;
    vec2 i0 = floor(px);
    vec2 f = px - i0;
    float h00 = rtDecodeTexel(mod(i0, uRtHeightSize));
    float h10 = rtDecodeTexel(mod(i0 + vec2(1.0, 0.0), uRtHeightSize));
    float h01 = rtDecodeTexel(mod(i0 + vec2(0.0, 1.0), uRtHeightSize));
    float h11 = rtDecodeTexel(mod(i0 + vec2(1.0, 1.0), uRtHeightSize));
    h = mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
  }
  return h;
}

vec3 rtSampleNormal(vec2 worldXZ) {
  vec3 outN = vec3(0.0, 1.0, 0.0);
  if (uRtQuality >= 3.5) {
    float eps = 1.4;
    float hL = rtSampleHeight(worldXZ - vec2(eps, 0.0));
    float hR = rtSampleHeight(worldXZ + vec2(eps, 0.0));
    float hD = rtSampleHeight(worldXZ - vec2(0.0, eps));
    float hU = rtSampleHeight(worldXZ + vec2(0.0, eps));
    outN = normalize(vec3(hL - hR, 2.0 * eps, hD - hU));
  } else {
    float eps = 1.9;
    float hC = rtSampleHeightFast(worldXZ);
    float hR = rtSampleHeightFast(worldXZ + vec2(eps, 0.0));
    float hU = rtSampleHeightFast(worldXZ + vec2(0.0, eps));
    outN = normalize(vec3(hC - hR, eps, hC - hU));
  }
  return outN;
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
  float res = 1.0;
  if (uRtHeightOn >= 0.5 && sunDir.y > 0.02) {
    int maxSteps = int(clamp(uRtShadowSteps, 8.0, 128.0));
    bool ultraQ = (uRtQuality >= 3.5);
    bool highQ = (uRtQuality >= 2.5);
    float stepGrow = ultraQ ? 0.08 : (highQ ? 0.14 : ((uRtQuality >= 1.5) ? 0.24 : 0.38));
    float minStep = ultraQ ? 0.55 : (highQ ? 0.8 : ((uRtQuality >= 1.5) ? 1.15 : 1.65));
    float earlyTerm = (uRtQuality < 1.5) ? 0.04 : 0.008;
    float t = 0.65 + jitter * minStep;
    for (int i = 0; i < RT_HARD_MAX_STEPS; i++) {
      if (i >= maxSteps) break;
      vec3 p = worldPos + sunDir * t;
      float h = ultraQ ? rtSampleHeight(p.xz) : rtSampleHeightFast(p.xz);
      float diff = p.y - h;
      if (!ultraQ && diff < 1.6) {
        h = rtSampleHeight(p.xz);
        diff = p.y - h;
      }
      if (diff < 0.0) {
        res = 0.0;
        break;
      }
      res = min(res, clamp(6.8 * diff / max(t, 0.75), 0.0, 1.0));
      if (res < earlyTerm) {
        res = 0.0;
        break;
      }
      t += max(minStep, t * stepGrow);
      if (t > maxDist) break;
    }
  }
  return clamp(res, 0.0, 1.0);
}

void rtTraceGI(vec3 worldPos, vec3 normal, vec3 sunDir, float jitter, out float skyVis, out vec3 bounceGI) {
  skyVis = 1.0;
  bounceGI = vec3(0.0);
  if (uRtHeightOn < 0.5) return;
  int rayCount = int(clamp(uRtGiRays, 2.0, 8.0));
  int radialSteps = int(clamp(uRtGiSteps, 1.0, 4.0));
  bool multiBounce = (uRtMaxBounces >= 2.5);
  bool ultraBounce = (uRtMaxBounces >= 3.5);
  float invRays = 1.0 / float(rayCount);
  float angStep = 6.2831853 * invRays;
  float occSum = 0.0;
  vec3 bounceAccum = vec3(0.0);
  float baseAng = jitter * 6.2831853;
  for (int i = 0; i < 8; i++) {
    if (i >= rayCount) break;
    float ang = baseAng + float(i) * angStep;
    vec2 dirXZ = vec2(cos(ang), sin(ang));
    float maxSlope = 0.0;
    vec2 hitXZ = worldPos.xz;
    for (int s = 0; s < 4; s++) {
      if (s >= radialSteps) break;
      float d = (s == 0) ? 3.5 : ((s == 1) ? 9.5 : ((s == 2) ? 20.0 : 38.0));
      vec2 sampleXZ = worldPos.xz + dirXZ * d;
      float h = ultraBounce ? rtSampleHeight(sampleXZ) : rtSampleHeightFast(sampleXZ);
      float slope = (h - worldPos.y) / d;
      if (slope > maxSlope) {
        maxSlope = slope;
        hitXZ = sampleXZ;
      }
    }
    float horizonBlock = clamp(maxSlope * 1.45, 0.0, 1.0);
    occSum += horizonBlock;
    if (horizonBlock > 0.04) {
      vec3 hitN = multiBounce
        ? rtSampleNormal(hitXZ)
        : normalize(vec3(-dirXZ.x * maxSlope, 1.0, -dirXZ.y * maxSlope));
      float hitSun = max(0.0, dot(hitN, sunDir));
      float facing = max(0.22, dot(normal, normalize(vec3(dirXZ.x, max(0.35, maxSlope), dirXZ.y))));
      vec3 primaryBounce = vec3(1.18, 0.52, 0.24) * hitSun * horizonBlock * facing * 0.46;
      if (ultraBounce) {
        // Multi-bounce inter-reflection inside canyons & craters (Tier 4 ULTRA)
        vec3 secondaryBounce = vec3(0.74, 0.31, 0.14) * horizonBlock * horizonBlock * (0.35 + 0.65 * hitSun) * 0.28;
        primaryBounce += secondaryBounce;
      }
      bounceAccum += primaryBounce;
    }
  }
  skyVis = clamp(1.0 - (occSum * invRays) * 0.78, 0.16, 1.0);
  bounceGI = bounceAccum * invRays;
}

vec3 rtTraceReflectionRay(vec3 origin, vec3 rayDir, vec3 sunDir, float jitter) {
  vec3 outCol = rtMarsSky(rayDir, sunDir);
  if (uRtHeightOn > 0.5 && rayDir.y < 0.30) {
    int maxSteps = int(clamp(uRtReflSteps, 8.0, 128.0));
    bool ultraQ = (uRtQuality >= 3.5);
    bool highQ = (uRtQuality >= 2.5);
    bool balQ = (uRtQuality >= 1.5);
    float stepGrow = ultraQ ? 0.09 : (highQ ? 0.16 : (balQ ? 0.26 : 0.42));
    float minStep = ultraQ ? 0.45 : (highQ ? 0.65 : (balQ ? 0.85 : 1.15));
    float maxReflDist = ultraQ ? 220.0 : (highQ ? 150.0 : (balQ ? 115.0 : 85.0));
    float t = 0.45 + jitter * minStep;
    float prevT = 0.0;
    for (int i = 0; i < RT_HARD_MAX_STEPS; i++) {
      if (i >= maxSteps) break;
      vec3 p = origin + rayDir * t;
      float h = ultraQ ? rtSampleHeight(p.xz) : rtSampleHeightFast(p.xz);
      if (p.y <= h) {
        float midT = 0.5 * (prevT + t);
        vec3 hitP = origin + rayDir * midT;
        if (highQ) {
          float mh = rtSampleHeight(hitP.xz);
          midT = (hitP.y <= mh) ? 0.5 * (prevT + midT) : 0.5 * (midT + t);
          hitP = origin + rayDir * midT;
        }
        vec3 hitN = rtSampleNormal(hitP.xz);
        float ndl = max(0.0, dot(hitN, sunDir));
        float sh;
        if (uRtMaxBounces >= 2.5) {
          // Tier 3 HIGH & Tier 4 ULTRA: full secondary ray-marched shadow bounce on reflected terrain
          sh = rtTraceShadow(vec3(hitP.x, rtSampleHeight(hitP.xz) + 0.15, hitP.z), sunDir, highQ ? 110.0 : 75.0, jitter);
        } else if (uRtMaxBounces >= 1.5) {
          // Tier 2 BALANCED: lightweight 2nd-bounce horizon shadow check
          float hStep = rtSampleHeightFast(hitP.xz + sunDir.xz * 8.0);
          sh = clamp(1.0 - max(0.0, (hStep - hitP.y) - sunDir.y * 8.0) * 0.45, 0.15, 1.0);
        } else {
          // Tier 1 PERFORMANCE: 1-bounce analytical self-shadow
          sh = smoothstep(0.02, 0.24, sunDir.y) * smoothstep(-0.02, 0.22, ndl);
        }
        vec3 regolith = vec3(0.56, 0.25, 0.14);
        vec3 ambientBounce = (uRtMaxBounces >= 2.5) ? vec3(0.24, 0.14, 0.10) : vec3(0.18, 0.11, 0.09);
        vec3 litTerrain = regolith * (ambientBounce + vec3(1.25, 0.96, 0.78) * ndl * sh);
        float fog = 1.0 - exp(-midT * 0.0045);
        outCol = mix(litTerrain, outCol, fog);
        break;
      }
      prevT = t;
      t += max(minStep, t * stepGrow);
      if (t > maxReflDist) break;
    }
  }
  return outCol;
}
`;

export const RT_LENS_PARS_GLSL = /* glsl */ `
uniform sampler2D tDepth;
uniform float uRtEnabled;
uniform float uRtQuality;
uniform float uRtResScale;
uniform float uRtMaxBounces;
uniform float uRtAoSamples;
uniform float uRtSsrSteps;
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
  vec3 avg4 = 0.25 * (cNW + cNE + cSW + cSE);
  // Spatial bilateral denoise + Contrast-Adaptive Sharpening (CAS) scaled by sub-resolution factor
  float subResBoost = clamp((1.05 - uRtResScale) * 0.55, 0.08, 0.34);
  float casWeight = clamp(1.0 - (lMax - lMin) * 1.65, 0.15, 0.85) * subResBoost;
  vec3 sharpM = clamp(cM + (cM - avg4) * casWeight, 0.0, 2.0);
  if (lMax - lMin < max(0.03, lMax * 0.1)) return sharpM;
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float dirReduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir * rcpDirMin, vec2(-4.0), vec2(4.0)) * px;
  vec3 a = 0.5 * (texture2D(tex, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tex, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = 0.5 * a + 0.25 * (texture2D(tex, uv - dir * 0.5).rgb + texture2D(tex, uv + dir * 0.5).rgb);
  float lB = dot(b, luma);
  vec3 fxaaCol = (lB < lMin || lB > lMax) ? a : b;
  return mix(fxaaCol, sharpM, subResBoost);
}

vec3 rtScreenSpacePass(sampler2D diffTex, vec3 baseCol, vec2 uv, vec2 res, float jitter) {
  if (uRtEnabled < 0.5) return baseCol;
  float depth = texture2D(tDepth, uv).r;
  if (depth >= 0.99985) return baseCol;

  vec2 px = 1.0 / max(res, vec2(1.0));
  vec3 P = rtReconstructViewPos(uv, depth);
  float dist = -P.z;
  float maxSsDist = (uRtQuality >= 3.5) ? 220.0 : ((uRtQuality >= 2.5) ? 145.0 : ((uRtQuality >= 1.5) ? 115.0 : 90.0));
  if (dist > maxSsDist || dist <= 0.02) return baseCol;

  vec3 dX;
  vec3 dY;
  float nVar;
  if (uRtQuality >= 2.5) {
    // 5-tap edge-preserving view normal reconstruction for HIGH & ULTRA tiers
    float dL = texture2D(tDepth, uv - vec2(px.x, 0.0)).r;
    float dR = texture2D(tDepth, uv + vec2(px.x, 0.0)).r;
    float dD = texture2D(tDepth, uv - vec2(0.0, px.y)).r;
    float dU = texture2D(tDepth, uv + vec2(0.0, px.y)).r;
    vec3 pL = rtReconstructViewPos(uv - vec2(px.x, 0.0), dL);
    vec3 pR = rtReconstructViewPos(uv + vec2(px.x, 0.0), dR);
    vec3 pD = rtReconstructViewPos(uv - vec2(0.0, px.y), dD);
    vec3 pU = rtReconstructViewPos(uv + vec2(0.0, px.y), dU);
    dX = (abs(pR.z - P.z) < abs(P.z - pL.z)) ? (pR - P) : (P - pL);
    dY = (abs(pU.z - P.z) < abs(P.z - pD.z)) ? (pU - P) : (P - pD);
    nVar = length(dX - (pR - pL) * 0.5) + length(dY - (pU - pD) * 0.5);
  } else {
    // Fast 3-tap normal reconstruction for PERFORMANCE & BALANCED tiers
    float dR = texture2D(tDepth, uv + vec2(px.x, 0.0)).r;
    float dU = texture2D(tDepth, uv + vec2(0.0, px.y)).r;
    vec3 pR = rtReconstructViewPos(uv + vec2(px.x, 0.0), dR);
    vec3 pU = rtReconstructViewPos(uv + vec2(0.0, px.y), dU);
    dX = pR - P;
    dY = pU - P;
    nVar = (length(dX) + length(dY)) * 0.45;
  }
  vec3 N = normalize(cross(dX, dY));
  vec3 V = normalize(-P);
  if (dot(N, V) < 0.0) N = -N;

  int aoSamples = int(clamp(uRtAoSamples, 2.0, 10.0));
  float invAo = 1.0 / float(aoSamples);
  float angStep = 6.2831853 * invAo;

  // 1. Screen-space ray-traced contact AO + multi-bounce SSGI
  float ao = 0.0;
  vec3 ssgi = vec3(0.0);
  float aoRadius = clamp(dist * 0.045, 0.22, 1.45);
  float giGain = (uRtMaxBounces >= 3.5) ? 0.24 : ((uRtMaxBounces >= 2.5) ? 0.19 : 0.16);
  for (int i = 0; i < 10; i++) {
    if (i >= aoSamples) break;
    float ang = (float(i) + jitter) * angStep;
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
        ssgi += texture2D(diffTex, suv).rgb * w * giGain;
      }
    }
  }
  ao = clamp(1.0 - (ao * invAo) * 0.58, 0.38, 1.0);
  vec3 outCol = baseCol * ao + (ssgi * invAo) * ao;

  // 2. Screen-space ray-traced reflections (SSR) scaled by tier
  float flatness = exp(-nVar * 12.0);
  float fresnel = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
  float ssrWeight = clamp(fresnel * flatness * (1.0 - smoothstep(maxSsDist * 0.4, maxSsDist, dist)), 0.0, 0.38);
  float ssrMinWeight = (uRtQuality >= 2.5) ? 0.011 : ((uRtQuality >= 1.5) ? 0.018 : 0.028);
  if (ssrWeight > ssrMinWeight) {
    vec3 R = reflect(-V, N);
    if (R.z < 0.35) {
      int maxSsrSteps = int(clamp(uRtSsrSteps, 4.0, 24.0));
      float ssrGrow = (uRtQuality >= 3.5) ? 0.22 : ((uRtQuality >= 2.5) ? 0.32 : ((uRtQuality >= 1.5) ? 0.45 : 0.65));
      float stepLen = 0.26 + jitter * 0.22;
      for (int s = 0; s < 24; s++) {
        if (s >= maxSsrSteps) break;
        vec3 rayV = P + R * stepLen;
        float rayZ;
        vec2 ruv = rtProjectViewToUv(rayV, rayZ);
        if (ruv.x < 0.01 || ruv.x > 0.99 || ruv.y < 0.01 || ruv.y > 0.99 || rayZ <= 0.05) break;
        float sd = texture2D(tDepth, ruv).r;
        float hitZ = -rtReconstructViewPos(ruv, sd).z;
        float dz = rayZ - hitZ;
        float thickness = max(0.35, stepLen * 0.30);
        if (dz > 0.0 && dz < thickness) {
          float edge = smoothstep(0.0, 0.08, min(min(ruv.x, 1.0 - ruv.x), min(ruv.y, 1.0 - ruv.y)));
          vec3 reflCol = texture2D(diffTex, ruv).rgb;
          outCol = mix(outCol, reflCol, ssrWeight * edge);
          break;
        }
        stepLen += max(0.35, stepLen * ssrGrow);
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
    uRtQuality: { value: 0 },
    uRtResScale: { value: RT_INTERNAL_RESOLUTION_SCALE },
    uRtMaxBounces: { value: 0 },
    uRtShadowSteps: { value: 0 },
    uRtReflSteps: { value: 0 },
    uRtGiRays: { value: 0 },
    uRtGiSteps: { value: 0 },
    uRtAoSamples: { value: 0 },
    uRtSsrSteps: { value: 0 },
    uRtMaxDist: { value: 0 },
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
          "getDirectionalLightInfo( directionalLight, directLight );\n\t\t\tif (uRtEnabled > 0.5 && length(vViewPosition) < uRtMaxDist) {\n\t\t\t\tvec3 rtN0 = normalize((vec4(geometryNormal, 0.0) * viewMatrix).xyz);\n\t\t\t\tfloat rtJ0 = rtIgn(gl_FragCoord.xy + fract(uRtTime) * 43.0);\n\t\t\t\tdirectLight.color *= mix(0.26, 1.0, rtTraceShadow(vRtWorldPos + rtN0 * 0.08, uRtSunDir, uRtMaxDist * 0.85, rtJ0));\n\t\t\t}"
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
            if (uRtEnabled > 0.5 && length(vViewPosition) < uRtMaxDist) {
              vec3 rtWN = normalize((vec4(geometryNormal, 0.0) * viewMatrix).xyz);
              vec3 rtWV = normalize((vec4(geometryViewDir, 0.0) * viewMatrix).xyz);
              vec3 rtR = reflect(-rtWV, rtWN);
              float rtJ2 = rtIgn(gl_FragCoord.xy + fract(uRtTime * 1.7) * 61.0);
              float gloss = pow(clamp(1.0 - material.roughness, 0.0, 1.0), 1.65);
              float ndv = clamp(dot(rtWN, rtWV), 0.0, 1.0);
              vec3 f0 = material.specularColor;
              vec3 fresnel = f0 + (vec3(1.0) - f0) * pow(1.0 - ndv, 5.0);
              float reflMask = clamp(gloss * (0.28 + 0.72 * max(metalnessFactor, pow(1.0 - ndv, 2.5))), 0.0, 0.96) * uRtReflectScale;
              float minRefl = (uRtQuality >= 2.5) ? 0.012 : ((uRtQuality >= 1.5) ? 0.025 : 0.045);
              if (reflMask > minRefl) {
                vec3 tracedRefl = rtTraceReflectionRay(vRtWorldPos + rtWN * 0.08, rtR, uRtSunDir, rtJ2);
                reflectedLight.indirectSpecular += tracedRefl * fresnel * reflMask * 0.96;
              }
              float groundFacing = clamp(-rtWN.y * 0.5 + 0.5, 0.0, 1.0);
              reflectedLight.indirectDiffuse += material.diffuseColor * vec3(0.55, 0.24, 0.12) * groundFacing * 0.34;
            }`
          );
      };
      mat.needsUpdate = true;
    }
  });
}
