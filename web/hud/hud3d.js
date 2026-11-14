/**
 * First-Person Mount Sharp 3D Bodycam Helmet Visor (`web/hud/hud3d.js`).
 *
 * Features:
 * - Dynamic Martian sky dome (butterscotch/salmon-ochre day, forward-scattered dusty-blue sunset/sunrise halo,
 *   procedural night starfield, matching dynamic FogExp2) and Gale Crater (4.8°S) solar ephemeris.
 * - Physically-inspired lighting: ACESFilmic tone mapping + dynamic sun-glare exposure adaptation,
 *   2048x2048 PCFSoftShadowMap Sun light, dynamic HemisphereLight ground bounce, and camera-mounted SpotLight headlamp (L).
 * - Orbiting Martian moons: Phobos (potato-shaped cratered regolith, prograde rising in WEST & setting in EAST)
 *   and Deimos (smaller, slower, rising in EAST & setting in WEST) with realistic solar phases.
 * - High-resolution terrain mesh (`height-preview.png` R*256+G) with LOD endless mirrored ring,
 *   world-space micro-detail shader (sand ripples, grit, fractured mudstone normals, slope-based roughness),
 *   650 instanced shadow-casting surface rocks, and drifting Martian dust motes.
 * - Wide-angle Bodycam optics (90° FOV, gait head-bob/sway/roll, suit breathing sway, look inertia)
 *   and single-pass custom WebGLRenderTarget post-processing (barrel fisheye, radial chromatic aberration,
 *   HDR bloom/halation, occluded Sun lens flare & visor micro-scratches, CMOS grain, helmet rim vignette).
 * - 100% offline / `?demo=1` safe (core `three` only, no external CDNs, graceful texture-relief fallback).
 */

import * as THREE from "three";
import {
  buildCumulativeDistances,
  classifySlope,
  onJumpToCoord,
  onSetRoute,
  sampleAlongRoute,
} from "../shared/route-bridge.js";

const SOL_LENGTH_HR = 24.62;
const GALE_LAT_RAD = (-4.8 * Math.PI) / 180;
const SOLAR_DECL_RAD = (-7.9 * Math.PI) / 180; // Matches Ls ~341° in REMS weather summary

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

function formatSolClock(solHours) {
  const wrapped = ((solHours % SOL_LENGTH_HR) + SOL_LENGTH_HR) % SOL_LENGTH_HR;
  const hh = Math.floor(wrapped);
  const mm = Math.floor((wrapped - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function compassLabel(deg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const norm = ((deg % 360) + 360) % 360;
  const idx = Math.round(norm / 45) % 8;
  return `${String(Math.round(norm)).padStart(3, "0")}° ${dirs[idx]}`;
}

function makeSeededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeArLabelSprite(title, kind, distText) {
  const canvas = document.createElement("canvas");
  canvas.width = 380;
  canvas.height = 110;
  const ctx = canvas.getContext("2d");

  const borderCol =
    kind === "habitat" ? "#22c55e" : kind === "boxwork_bonus" ? "#f59e0b" : "#38bdf8";

  ctx.fillStyle = "rgba(8, 14, 24, 0.84)";
  ctx.strokeStyle = borderCol;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(6, 6, 368, 98, 16);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#7dd3fc";
  ctx.font = "bold 20px monospace";
  ctx.fillText(kind.toUpperCase(), 22, 36);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px sans-serif";
  const shortTitle = title.length > 28 ? title.slice(0, 27) + "…" : title;
  ctx.fillText(shortTitle, 22, 66);

  ctx.fillStyle = "#cbd5e1";
  ctx.font = "bold 20px monospace";
  ctx.fillText(distText, 22, 92);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(26, 7.5, 1);
  sprite.userData = { canvas, ctx, tex, title, kind, borderCol, lastDist: distText };
  return sprite;
}

function updateArLabelDist(sprite, distM) {
  const distText = `${distM.toFixed(0)} m`;
  if (sprite.userData.lastDist === distText) return;
  sprite.userData.lastDist = distText;
  const { ctx, tex, title, kind, borderCol } = sprite.userData;

  ctx.clearRect(0, 0, 380, 110);
  ctx.fillStyle = "rgba(8, 14, 24, 0.84)";
  ctx.strokeStyle = borderCol;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(6, 6, 368, 98, 16);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#7dd3fc";
  ctx.font = "bold 20px monospace";
  ctx.fillText(kind.toUpperCase(), 22, 36);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px sans-serif";
  const shortTitle = title.length > 28 ? title.slice(0, 27) + "…" : title;
  ctx.fillText(shortTitle, 22, 66);

  ctx.fillStyle = "#fde68a";
  ctx.font = "bold 20px monospace";
  ctx.fillText(`AR DIST: ${distText}`, 22, 92);

  tex.needsUpdate = true;
}

function makeMoonMarkerSprite(name, motionLabel, accentHex) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 68;
  const ctx = canvas.getContext("2d");

  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 2.5;
  ctx.fillStyle = "rgba(7, 11, 19, 0.72)";
  ctx.beginPath();
  ctx.roundRect(4, 4, 248, 60, 10);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 21px monospace";
  ctx.fillText(name, 16, 31);

  ctx.fillStyle = accentHex;
  ctx.font = "bold 16px monospace";
  ctx.fillText(motionLabel, 16, 54);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(430, 114, 1);
  return sprite;
}

function makeMoonRegolithTexture(seed, craterCount, baseLight) {
  const w = 512;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const rng = makeSeededRng(seed);

  ctx.fillStyle = `rgb(${baseLight}, ${baseLight - 3}, ${baseLight - 6})`;
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 650; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const rx = 4 + rng() * 24;
    const ry = 2 + rng() * 12;
    const v = Math.round(baseLight + (rng() - 0.5) * 34);
    ctx.fillStyle = `rgba(${v}, ${v - 2}, ${v - 4}, 0.22)`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < craterCount; i++) {
    const cx = rng() * w;
    const cy = rng() * h;
    const r = 3 + Math.pow(rng(), 2.2) * 34;
    const grad = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    const floor = Math.max(24, baseLight - 36);
    const rim = Math.min(220, baseLight + 34);
    grad.addColorStop(0, `rgba(${floor}, ${floor - 2}, ${floor - 3}, 0.72)`);
    grad.addColorStop(0.7, `rgba(${floor + 8}, ${floor + 6}, ${floor + 4}, 0.45)`);
    grad.addColorStop(0.88, `rgba(${rim}, ${rim - 2}, ${rim - 5}, 0.42)`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function createMoonMesh({ radius, detail, seed, stretch, stickneyImpact, craterCount, baseLight }) {
  const geom = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geom.attributes.position;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const stickneyDir = new THREE.Vector3(0.75, 0.25, 0.61).normalize();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.copy(v).normalize();
    const lump =
      0.08 * Math.sin(n.x * 3.1 + seed) * Math.cos(n.y * 2.7 - seed * 0.4) +
      0.045 * Math.cos(n.z * 5.3 + n.x * 3.8 + seed * 0.7) +
      0.025 * Math.sin(n.y * 9.2 + n.z * 7.4);
    let rScale = 1.0 + lump;
    if (stickneyImpact) {
      const d = n.distanceTo(stickneyDir);
      if (d < 0.62) {
        const bowl = Math.cos((d / 0.62) * Math.PI * 0.5);
        rScale -= 0.16 * bowl * bowl;
      }
    }
    v.multiplyScalar(rScale);
    v.x *= stretch[0];
    v.y *= stretch[1];
    v.z *= stretch[2];
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geom.computeVertexNormals();

  const tex = makeMoonRegolithTexture(seed, craterCount, baseLight);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: tex },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSkyScatter: { value: new THREE.Color(0x523026) },
      uBrightness: { value: 1.55 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      void main() {
        vUv = uv;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform vec3 uSunDir;
      uniform vec3 uSkyScatter;
      uniform float uBrightness;
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      void main() {
        vec3 n = normalize(vWorldNormal);
        vec3 s = normalize(uSunDir);
        float ndotl = smoothstep(-0.06, 0.85, dot(n, s));
        vec3 albedo = texture2D(uMap, vUv).rgb;
        vec3 lit = albedo * (ndotl * uBrightness + 0.025);
        float dayVeil = smoothstep(-0.08, 0.35, s.y) * 0.65;
        vec3 col = lit + uSkyScatter * (1.0 - ndotl * 0.45) * dayVeil;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    fog: false,
    toneMapped: true,
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.frustumCulled = false;
  return mesh;
}

function createProceduralSky(scene) {
  const skyGeom = new THREE.SphereGeometry(9800, 48, 32);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: new THREE.Vector3(-0.6, 0.5, 0.4).normalize() },
      uHorizonColor: { value: new THREE.Color(0xc87d55) },
      uZenithColor: { value: new THREE.Color(0x2b2224) },
      uFogColor: { value: new THREE.Color(0xb87352) },
    },
    vertexShader: `
      varying vec3 vSkyDir;
      void main() {
        vSkyDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uSunDir;
      uniform vec3 uHorizonColor;
      uniform vec3 uZenithColor;
      uniform vec3 uFogColor;
      varying vec3 vSkyDir;

      void main() {
        vec3 dir = normalize(vSkyDir);
        vec3 sunDir = normalize(uSunDir);
        float sunAlt = sunDir.y;
        float sunDot = clamp(dot(dir, sunDir), -1.0, 1.0);
        float viewElev = clamp(dir.y, -0.25, 1.0);
        float posElev = max(viewElev, 0.0);

        float dayFactor = smoothstep(-0.08, 0.25, sunAlt);
        float highDay = smoothstep(0.12, 0.55, sunAlt);
        float twilight = smoothstep(-0.14, 0.03, sunAlt) * (1.0 - smoothstep(0.10, 0.32, sunAlt));

        // Base butterscotch/salmon-ochre horizon to thin amber-slate zenith
        float horizonCurve = pow(1.0 - posElev, 2.35);
        vec3 midSky = mix(uZenithColor, uHorizonColor * 0.52, 0.45);
        vec3 daySky = mix(midSky, uHorizonColor, horizonCurve);
        daySky = mix(uZenithColor, daySky, smoothstep(-0.06, 0.45, posElev + 0.12));
        daySky *= mix(0.28, 1.12, highDay);

        // Night sky (deep Martian indigo-slate)
        vec3 nightSky = mix(vec3(0.004, 0.006, 0.012), vec3(0.012, 0.014, 0.024), horizonCurve);
        vec3 skyCol = mix(nightSky, daySky, dayFactor);

        // Seamless Martian dust horizon lock so distant fogged ridges never look transparent
        float dustBand = 1.0 - smoothstep(0.0, 0.15, posElev);
        skyCol = mix(skyCol, uFogColor, dustBand * 0.92);

        // Authentic Martian twilight: cool dusty-blue forward-scattering halo around low Sun
        // surrounded by rusty-amber outer twilight
        float forwardCone = pow(max(sunDot, 0.0), 10.0) * 0.72 + pow(max(sunDot, 0.0), 34.0) * 1.15;
        float wideScatter = pow(max(sunDot, 0.0), 2.2) * (1.0 - smoothstep(0.0, 0.45, abs(viewElev)));
        vec3 blueHalo = vec3(0.22, 0.46, 0.84) * forwardCone + vec3(0.55, 0.78, 1.02) * pow(max(sunDot, 0.0), 90.0);
        vec3 rustTwilight = vec3(0.46, 0.11, 0.042) * wideScatter * (1.0 - smoothstep(0.84, 0.99, sunDot));
        skyCol += (blueHalo * 1.15 + rustTwilight * 0.85) * twilight * smoothstep(-0.02, 0.06, viewElev);

        // Daytime fine dust Mie glare around sun
        float dayGlare = pow(max(sunDot, 0.0), 18.0) * 0.28 * dayFactor;
        skyCol += mix(vec3(0.95, 0.62, 0.42), vec3(0.55, 0.74, 0.96), twilight * 0.75) * dayGlare;

        // Crisp Martian solar disc + HDR corona (occluded below mathematical horizon)
        float aboveHorizon = smoothstep(-0.02, 0.008, viewElev);
        float sunAbove = smoothstep(-0.02, 0.018, sunAlt);
        float sunDisc = smoothstep(0.99982, 0.99994, sunDot);
        float sunCorona = pow(max(sunDot, 0.0), 240.0);
        vec3 discTint = mix(vec3(0.78, 0.90, 1.08), vec3(1.0, 0.94, 0.85), smoothstep(0.03, 0.28, sunAlt));
        skyCol += discTint * (sunDisc * 9.5 + sunCorona * 2.2) * aboveHorizon * sunAbove;

        // Below-horizon base matches distant ground haze seamlessly
        float belowGround = smoothstep(-0.18, 0.0, viewElev);
        skyCol = mix(uFogColor * 0.88, skyCol, belowGround);

        gl_FragColor = vec4(skyCol, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: true,
  });

  const skyMesh = new THREE.Mesh(skyGeom, skyMat);
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = -10;
  scene.add(skyMesh);

  // Procedural Starfield
  const starCount = 1650;
  const positions = new Float32Array(starCount * 3);
  const colors = new Float32Array(starCount * 3);
  const sizes = new Float32Array(starCount);
  const rng = makeSeededRng(20261114);

  for (let i = 0; i < starCount; i++) {
    const u = rng();
    const v = rng();
    const theta = u * Math.PI * 2;
    const cosPhi = 0.05 + v * 0.95; // Upper sky hemisphere above horizon dust
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
    const r = 9300;
    positions[i * 3] = r * sinPhi * Math.cos(theta);
    positions[i * 3 + 1] = r * cosPhi;
    positions[i * 3 + 2] = r * sinPhi * Math.sin(theta);

    const temp = rng();
    const mag = 0.35 + Math.pow(rng(), 2.4) * 0.85;
    if (temp < 0.25) {
      colors[i * 3] = 0.78 * mag;
      colors[i * 3 + 1] = 0.87 * mag;
      colors[i * 3 + 2] = 1.0 * mag;
    } else if (temp < 0.78) {
      colors[i * 3] = 0.96 * mag;
      colors[i * 3 + 1] = 0.96 * mag;
      colors[i * 3 + 2] = 0.94 * mag;
    } else {
      colors[i * 3] = 1.0 * mag;
      colors[i * 3 + 1] = 0.80 * mag;
      colors[i * 3 + 2] = 0.62 * mag;
    }
    sizes[i] = 1.8 + Math.pow(rng(), 3.0) * 4.0;
  }

  const starGeom = new THREE.BufferGeometry();
  starGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  starGeom.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  starGeom.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));

  const starMat = new THREE.ShaderMaterial({
    uniforms: {
      uNightAlpha: { value: 0.0 },
      uTime: { value: 0.0 },
    },
    vertexShader: `
      attribute vec3 aColor;
      attribute float aSize;
      varying vec3 vStarCol;
      varying float vPhase;
      varying float vElevFade;
      void main() {
        vStarCol = aColor;
        vPhase = position.x * 0.03 + position.z * 0.05;
        vElevFade = smoothstep(0.03, 0.22, normalize(position).y);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPos;
        gl_PointSize = aSize;
      }
    `,
    fragmentShader: `
      uniform float uNightAlpha;
      uniform float uTime;
      varying vec3 vStarCol;
      varying float vPhase;
      varying float vElevFade;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float core = smoothstep(0.5, 0.08, d);
        float twinkle = 0.88 + 0.12 * sin(uTime * 2.1 + vPhase);
        vec3 col = vStarCol * core * twinkle * 1.4;
        float alpha = core * uNightAlpha * vElevFade;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: true,
  });

  const starPoints = new THREE.Points(starGeom, starMat);
  starPoints.frustumCulled = false;
  starPoints.renderOrder = -9;
  scene.add(starPoints);

  return { skyMesh, skyMat, starPoints, starMat };
}

function createFlippedIndexGeometry(sourceGeom) {
  const flipped = new THREE.BufferGeometry();
  flipped.attributes = sourceGeom.attributes;
  const srcIdx = sourceGeom.index.array;
  const rev = new srcIdx.constructor(srcIdx.length);
  for (let i = 0; i < srcIdx.length; i += 3) {
    rev[i] = srcIdx[i];
    rev[i + 1] = srcIdx[i + 2];
    rev[i + 2] = srcIdx[i + 1];
  }
  flipped.setIndex(new THREE.BufferAttribute(rev, 1));
  flipped.boundingBox = sourceGeom.boundingBox ? sourceGeom.boundingBox.clone() : null;
  flipped.boundingSphere = sourceGeom.boundingSphere ? sourceGeom.boundingSphere.clone() : null;
  return flipped;
}

function buildRockGeometry(seed = 42, mode = "angular") {
  const geom =
    mode === "slab"
      ? new THREE.CylinderGeometry(0.56, 0.64, 0.42, 7, 1)
      : new THREE.DodecahedronGeometry(0.55, 1);
  const pos = geom.attributes.position;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.copy(v).normalize();
    if (mode === "slab") {
      const ledge =
        0.19 * Math.sin(n.x * 3.8 + seed) +
        0.15 * Math.cos(n.z * 4.4 - seed * 0.6) +
        0.08 * Math.sin((n.x + n.z) * 7.1);
      v.x *= 1.0 + ledge;
      v.z *= 1.0 + ledge * 0.85;
      v.y *= 1.0 + 0.12 * Math.cos(n.x * 5.2 + n.z * 4.8 + seed);
    } else {
      const ang =
        0.24 * Math.sin(n.x * 4.7 + seed) +
        0.17 * Math.cos(n.y * 5.1 - n.z * 3.9) +
        0.11 * Math.sin(n.z * 8.3 + n.x * 6.2);
      v.multiplyScalar(1.0 + ang);
      if (v.y < -0.15) v.y *= 0.55; // flatter seated underside
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geom.computeVertexNormals();
  return geom;
}

function buildTextureColorSampler(img) {
  if (!img || !img.width || !img.height) return null;
  const w = Math.min(512, img.width);
  const h = Math.min(512, img.height);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  try {
    return { w, h, data: ctx.getImageData(0, 0, w, h).data };
  } catch {
    return null;
  }
}

function sampleMapColorRgb(sampler, u, v, outRgb) {
  if (!sampler) {
    outRgb[0] = 0.56;
    outRgb[1] = 0.36;
    outRgb[2] = 0.27;
    return outRgb;
  }
  const { w, h, data } = sampler;
  const cu = Math.max(0, Math.min(1, u)) * (w - 1);
  const cv = Math.max(0, Math.min(1, v)) * (h - 1);
  const ix = Math.round(cu);
  const iy = Math.round(cv);

  // Average a tiny 3x3 patch so isolated single-pixel speckles don't make mismatched outliers
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    const py = Math.max(0, Math.min(h - 1, iy + dy));
    for (let dx = -1; dx <= 1; dx++) {
      const px = Math.max(0, Math.min(w - 1, ix + dx));
      const idx = (py * w + px) * 4;
      sr += data[idx];
      sg += data[idx + 1];
      sb += data[idx + 2];
      n++;
    }
  }
  outRgb[0] = sr / (n * 255);
  outRgb[1] = sg / (n * 255);
  outRgb[2] = sb / (n * 255);
  return outRgb;
}

function makeDustParticleTexture() {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 16);
  g.addColorStop(0, "rgba(255, 224, 198, 1.0)");
  g.addColorStop(0.45, "rgba(235, 180, 145, 0.45)");
  g.addColorStop(1, "rgba(200, 140, 110, 0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createBodycamPostPipeline(renderer, w, h) {
  const canHalfFloat =
    renderer.capabilities.isWebGL2 &&
    (renderer.extensions.has("EXT_color_buffer_float") ||
      renderer.extensions.has("EXT_color_buffer_half_float"));

  const rtType = canHalfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const pixelRatio = renderer.getPixelRatio();
  const rt = new THREE.WebGLRenderTarget(
    Math.max(1, Math.floor(w * pixelRatio)),
    Math.max(1, Math.floor(h * pixelRatio)),
    {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: rtType,
      depthBuffer: true,
    }
  );

  const postScene = new THREE.Scene();
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const postMat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: rt.texture },
      uResolution: { value: new THREE.Vector2(w * pixelRatio, h * pixelRatio) },
      uAspect: { value: w / Math.max(1, h) },
      uTime: { value: 0 },
      uSunScreenPos: { value: new THREE.Vector2(0.5, 0.5) },
      uSunGlare: { value: 0.0 },
      uSunColor: { value: new THREE.Color(0xffb884) },
      uNightFactor: { value: 0.0 },
      uIsHDR: { value: canHalfFloat ? 1.0 : 0.0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform vec2 uResolution;
      uniform float uAspect;
      uniform float uTime;
      uniform vec2 uSunScreenPos;
      uniform float uSunGlare;
      uniform vec3 uSunColor;
      uniform float uNightFactor;
      uniform float uIsHDR;
      varying vec2 vUv;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float scratchLine(vec2 uv, vec2 p0, vec2 dir, float len, float width) {
        vec2 rel = uv - p0;
        float proj = clamp(dot(rel, dir), 0.0, len);
        float d = length(rel - dir * proj);
        return smoothstep(width, 0.0, d);
      }

      void main() {
        // 1. Barrel / Fisheye lens distortion (k1 = -0.14, k2 = 0.04)
        vec2 centered = vUv - 0.5;
        vec2 aspectPos = vec2(centered.x * uAspect, centered.y);
        float r2 = dot(aspectPos, aspectPos);
        float distFactor = 1.0 / max(0.55, 1.0 - 0.14 * r2 + 0.04 * r2 * r2);
        vec2 baseUv = 0.5 + centered * distFactor * 0.91;

        // 2. Radial Chromatic Aberration (0.0025 * r^2)
        vec2 radDir = length(centered) > 0.0001 ? normalize(centered) : vec2(0.0);
        vec2 caOffset = radDir * (0.0025 * r2);
        vec2 uvR = clamp(baseUv + caOffset, 0.001, 0.999);
        vec2 uvG = clamp(baseUv, 0.001, 0.999);
        vec2 uvB = clamp(baseUv - caOffset, 0.001, 0.999);

        float colR = texture2D(tDiffuse, uvR).r;
        vec3 colG = texture2D(tDiffuse, uvG).rgb;
        float colB = texture2D(tDiffuse, uvB).b;
        vec3 hdr = vec3(colR, colG.g, colB);

        // 3. Single-pass HDR Bloom / Halation
        vec3 bloom = vec3(0.0);
        float thresh = uIsHDR > 0.5 ? 0.95 : 0.78;
        vec2 texel = 1.0 / max(uResolution, vec2(1.0));
        for (int i = 0; i < 8; i++) {
          float ang = float(i) * 0.78539816;
          vec2 o1 = vec2(cos(ang), sin(ang)) * texel * 6.5;
          vec2 o2 = vec2(cos(ang + 0.39), sin(ang + 0.39)) * texel * 17.0;
          vec3 s1 = texture2D(tDiffuse, clamp(uvG + o1, 0.001, 0.999)).rgb;
          vec3 s2 = texture2D(tDiffuse, clamp(uvG + o2, 0.001, 0.999)).rgb;
          bloom += max(s1 - thresh, 0.0) * 0.62 + max(s2 - thresh, 0.0) * 0.38;
        }
        hdr += bloom * 0.15;

        // 4. Sun Lens Flare & Visor Micro-Scratch / Dust Glare
        if (uSunGlare > 0.005) {
          vec2 sc = uSunScreenPos - 0.5;
          vec2 scA = vec2(sc.x * uAspect, sc.y);
          float sr2 = dot(scA, scA);
          vec2 sunDistorted = 0.5 + sc * (1.0 - 0.14 * sr2 + 0.04 * sr2 * sr2) / 0.91;

          vec2 delta = (vUv - sunDistorted) * vec2(uAspect, 1.0);
          float sd = length(delta);

          // Atmospheric sun halation + anamorphic streak
          float halo = exp(-sd * 6.2) * 0.32 + exp(-sd * 16.0) * 0.48;
          float streak = exp(-abs(delta.y) * 58.0) * exp(-abs(delta.x) * 2.5) * 0.24;

          // Subtle opposite lens ghost ring
          vec2 ghostCenter = 1.0 - sunDistorted;
          float gd = length((vUv - ghostCenter) * vec2(uAspect, 1.0));
          float ghost = smoothstep(0.11, 0.075, gd) * smoothstep(0.03, 0.075, gd) * 0.07;

          // Micro-scratches & dust specks on the curved helmet visor glass
          float glareCone = pow(max(1.0 - sd * 0.9, 0.0), 2.2);
          float sA = scratchLine(vUv, vec2(0.28, 0.32), normalize(vec2(0.85, 0.52)), 0.24, 0.0018);
          float sB = scratchLine(vUv, vec2(0.62, 0.68), normalize(vec2(-0.78, 0.62)), 0.18, 0.0016);
          float sC = scratchLine(vUv, vec2(0.42, 0.74), normalize(vec2(0.92, -0.38)), 0.21, 0.0015);
          float sD = scratchLine(vUv, vec2(0.19, 0.58), normalize(vec2(0.64, 0.77)), 0.15, 0.0016);
          vec2 dustCell = floor(vUv * vec2(44.0 * uAspect, 44.0));
          vec2 dustLocal = fract(vUv * vec2(44.0 * uAspect, 44.0)) - 0.5;
          float dustSeed = hash21(dustCell);
          float dustSpeck = step(0.965, dustSeed) * smoothstep(0.24, 0.04, length(dustLocal));
          float visorImperf = (sA + sB + sC + sD) * 0.45 + dustSpeck * 0.35;

          hdr += uSunColor * (halo + streak + ghost + visorImperf * glareCone * 0.85) * uSunGlare;
        }

        // Apply renderer ACESFilmicToneMapping + sRGB transfer
        gl_FragColor = vec4(hdr, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>

        // 5. Dynamic CMOS Film Grain (stronger in shadows & Martian twilight/night)
        float luma = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
        float noise = hash21(floor(vUv * uResolution) + fract(uTime * 23.7) * 512.0) - 0.5;
        float grainAmp = mix(0.022, 0.056, 1.0 - smoothstep(0.04, 0.36, luma)) + uNightFactor * 0.024;
        gl_FragColor.rgb = clamp(gl_FragColor.rgb + noise * grainAmp, 0.0, 1.0);

        // 6. Elliptical Helmet Rim Vignette
        vec2 vigUv = (vUv - 0.5) * vec2(1.0, 1.10);
        float vigR2 = dot(vigUv, vigUv);
        float vig = smoothstep(0.58, 0.17, vigR2);
        gl_FragColor.rgb *= mix(0.18, 1.0, vig);
      }
    `,
    depthTest: false,
    depthWrite: false,
    toneMapped: true,
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat);
  quad.frustumCulled = false;
  postScene.add(quad);

  function resize(newW, newH) {
    const pr = renderer.getPixelRatio();
    const rw = Math.max(1, Math.floor(newW * pr));
    const rh = Math.max(1, Math.floor(newH * pr));
    rt.setSize(rw, rh);
    postMat.uniforms.uResolution.value.set(rw, rh);
    postMat.uniforms.uAspect.value = newW / Math.max(1, newH);
  }

  return { rt, postScene, postCamera, postMat, resize };
}

export async function initHud3D(data, { onOpenPov, onPositionChange }) {
  const { costMap, stops, route, telemetry, povIndex, assets } = data;
  const wrap = document.getElementById("hud-canvas-wrap");

  const bounds = costMap?.bounds || {
    west_lon_deg: 137.372831,
    south_lat_deg: -4.816946,
    east_lon_deg: 137.406542,
    north_lat_deg: -4.783236,
  };
  const ncols = costMap?.grid?.ncols || 395;
  const nrows = costMap?.grid?.nrows || 395;
  const cellSizeM = costMap?.cell_size_m || 5.059;
  const worldW = ncols * cellSizeM;
  const worldH = nrows * cellSizeM;
  const [elevMin, elevMax] = costMap?.height_preview_elevation_range_m || [-3850.6, -3369.3];

  const lonToX = (lon) =>
    ((lon - bounds.west_lon_deg) / (bounds.east_lon_deg - bounds.west_lon_deg) - 0.5) * worldW;
  const latToZ = (lat) =>
    (0.5 - (lat - bounds.south_lat_deg) / (bounds.north_lat_deg - bounds.south_lat_deg)) * worldH;
  const xToLon = (x) =>
    bounds.west_lon_deg + (x / worldW + 0.5) * (bounds.east_lon_deg - bounds.west_lon_deg);
  const zToLat = (z) =>
    bounds.south_lat_deg + (0.5 - z / worldH) * (bounds.north_lat_deg - bounds.south_lat_deg);

  // Renderer, Scene, Wide-Angle Bodycam Camera (90° FOV)
  const EYE_HEIGHT_M = 1.7;
  const initW = wrap.clientWidth || window.innerWidth;
  const initH = wrap.clientHeight || window.innerHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(initW, initH);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  wrap.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x3a2319);
  scene.fog = new THREE.FogExp2(0xc47e58, 0.00095);

  const camera = new THREE.PerspectiveCamera(90, initW / Math.max(1, initH), 0.35, 12000);
  scene.add(camera);

  // Sky dome + procedural starfield
  const { skyMesh, skyMat, starPoints, starMat } = createProceduralSky(scene);

  // Dynamic Sun DirectionalLight (2048x2048 soft shadows tightly tracking player)
  const sunLight = new THREE.DirectionalLight(0xffe7cf, 2.2);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -150;
  sunLight.shadow.camera.right = 150;
  sunLight.shadow.camera.top = 150;
  sunLight.shadow.camera.bottom = -150;
  sunLight.shadow.camera.near = 20;
  sunLight.shadow.camera.far = 1100;
  sunLight.shadow.bias = -0.00045;
  sunLight.shadow.normalBias = 0.06;
  scene.add(sunLight);
  scene.add(sunLight.target);

  // Ground-Bounce HemisphereLight
  const hemiLight = new THREE.HemisphereLight(0x6b4a3e, 0xc97b4b, 0.85);
  scene.add(hemiLight);

  // Camera-Mounted Helmet Headlamp (SpotLight, toggled via L key or button)
  const headlamp = new THREE.SpotLight(0xeef6ff, 0.0, 125, Math.PI / 4.6, 0.65, 1.45);
  headlamp.position.set(0.14, 0.06, -0.05);
  headlamp.target.position.set(0.0, -0.35, -12.0);
  headlamp.castShadow = false;
  camera.add(headlamp);
  camera.add(headlamp.target);

  // Orbiting Martian Moons: Phobos (west -> east) & Deimos (east -> west)
  const moonsGroup = new THREE.Group();
  scene.add(moonsGroup);
  const phobosMesh = createMoonMesh({
    radius: 76,
    detail: 3,
    seed: 17,
    stretch: [1.26, 0.88, 0.98],
    stickneyImpact: true,
    craterCount: 38,
    baseLight: 118,
  });
  const deimosMesh = createMoonMesh({
    radius: 27,
    detail: 2,
    seed: 73,
    stretch: [1.14, 0.92, 0.96],
    stickneyImpact: false,
    craterCount: 16,
    baseLight: 142,
  });
  moonsGroup.add(phobosMesh);
  moonsGroup.add(deimosMesh);

  const moonMarkersGroup = new THREE.Group();
  scene.add(moonMarkersGroup);
  const phobosMarker = makeMoonMarkerSprite("PHOBOS", "PROGRADE W → E", "#7dd3fc");
  const deimosMarker = makeMoonMarkerSprite("DEIMOS", "RETRO E → W", "#fcd34d");
  moonMarkersGroup.add(phobosMarker);
  moonMarkersGroup.add(deimosMarker);

  // Decode height-preview.png (8-bit RGB: R*256 + G)
  let elevGrid = null;
  let imgW = 0;
  let imgH = 0;

  try {
    const hImg = await loadImage(assets.heightPreviewUrl);
    imgW = hImg.width;
    imgH = hImg.height;
    const c = document.createElement("canvas");
    c.width = imgW;
    c.height = imgH;
    const ctx = c.getContext("2d");
    ctx.drawImage(hImg, 0, 0);
    const px = ctx.getImageData(0, 0, imgW, imgH).data;
    elevGrid = new Float32Array(imgW * imgH);

    for (let i = 0; i < imgW * imgH; i++) {
      const r = px[i * 4];
      const g = px[i * 4 + 1];
      const val = r * 256 + g;
      elevGrid[i] = val === 0 ? elevMin : elevMin + (val / 65535) * (elevMax - elevMin);
    }
  } catch {
    // Fallback: flat terrain
  }

  function mirrorWrap(t) {
    const m = ((t % 2) + 2) % 2;
    return m > 1 ? 2 - m : m;
  }

  function sampleElevGridBilinear(u, v) {
    if (!elevGrid) return 0;
    const fx = Math.max(0, Math.min(1, u)) * (imgW - 1);
    const fy = Math.max(0, Math.min(1, v)) * (imgH - 1);
    const x0 = Math.min(imgW - 2, Math.floor(fx));
    const y0 = Math.min(imgH - 2, Math.floor(fy));
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const tx = fx - x0;
    const ty = fy - y0;
    const ha = elevGrid[y0 * imgW + x0] - elevMin;
    const hb = elevGrid[y1 * imgW + x0] - elevMin;
    const hc = elevGrid[y1 * imgW + x1] - elevMin;
    const hd = elevGrid[y0 * imgW + x1] - elevMin;
    if (tx + ty <= 1) {
      return ha + (hd - ha) * tx + (hb - ha) * ty;
    }
    const ux = 1 - tx;
    const uy = 1 - ty;
    return hc + (hb - hc) * ux + (hd - hc) * uy;
  }

  const segW = elevGrid && imgW > 1 ? Math.max(320, imgW - 1) : 320;
  const segH = elevGrid && imgH > 1 ? Math.max(320, imgH - 1) : 320;
  const hiGeom = new THREE.PlaneGeometry(worldW, worldH, segW, segH);
  hiGeom.rotateX(-Math.PI / 2);

  const midSeg = segW % 2 === 0 ? Math.max(96, Math.floor(segW / 2)) : 128;
  const midGeom = new THREE.PlaneGeometry(worldW, worldH, midSeg, midSeg);
  midGeom.rotateX(-Math.PI / 2);

  const loSeg = 96;
  const loGeom = new THREE.PlaneGeometry(worldW, worldH, loSeg, loSeg);
  loGeom.rotateX(-Math.PI / 2);

  if (elevGrid) {
    const posHi = hiGeom.attributes.position;
    if (segW === imgW - 1 && segH === imgH - 1) {
      for (let i = 0; i < posHi.count; i++) {
        const ix = i % imgW;
        const iy = Math.floor(i / imgW);
        posHi.setY(i, elevGrid[iy * imgW + ix] - elevMin);
      }
    } else {
      const cols = segW + 1;
      for (let i = 0; i < posHi.count; i++) {
        const ix = i % cols;
        const iy = Math.floor(i / cols);
        posHi.setY(i, sampleElevGridBilinear(ix / segW, iy / segH));
      }
    }
    hiGeom.computeVertexNormals();

    const posMid = midGeom.attributes.position;
    const midCols = midSeg + 1;
    for (let i = 0; i < posMid.count; i++) {
      const ix = i % midCols;
      const iy = Math.floor(i / midCols);
      posMid.setY(i, sampleElevGridBilinear(ix / midSeg, iy / midSeg));
    }
    midGeom.computeVertexNormals();

    const posLo = loGeom.attributes.position;
    const loCols = loSeg + 1;
    for (let i = 0; i < posLo.count; i++) {
      const ix = i % loCols;
      const iy = Math.floor(i / loCols);
      posLo.setY(i, sampleElevGridBilinear(ix / loSeg, iy / loSeg));
    }
    loGeom.computeVertexNormals();
  }

  const hiGeomFlip = createFlippedIndexGeometry(hiGeom);
  const midGeomFlip = createFlippedIndexGeometry(midGeom);
  const loGeomFlip = createFlippedIndexGeometry(loGeom);

  function sampleMeshY(x, z) {
    if (!elevGrid) return 0;
    const u = mirrorWrap(x / worldW + 0.5);
    const v = mirrorWrap(z / worldH + 0.5);
    return sampleElevGridBilinear(u, v);
  }
  const sampleElevSceneY = sampleMeshY;

  const COLLAR_OFFSETS = [
    [0.6, 0],
    [-0.6, 0],
    [0, 0.6],
    [0, -0.6],
    [0.42, 0.42],
    [-0.42, 0.42],
    [0.42, -0.42],
    [-0.42, -0.42],
  ];

  function getSafeEyeY(x, z) {
    let eyeY = sampleMeshY(x, z) + EYE_HEIGHT_M;
    for (let i = 0; i < COLLAR_OFFSETS.length; i++) {
      const ny = sampleMeshY(x + COLLAR_OFFSETS[i][0], z + COLLAR_OFFSETS[i][1]);
      if (ny + 0.55 > eyeY) eyeY = ny + 0.55;
    }
    return eyeY;
  }

  function sampleSlopeDeg(x, z) {
    if (!elevGrid) return null;
    const d = Math.max(2, cellSizeM * 0.5);
    const gx = (sampleMeshY(x + d, z) - sampleMeshY(x - d, z)) / (2 * d);
    const gz = (sampleMeshY(x, z + d) - sampleMeshY(x, z - d)) / (2 * d);
    return (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
  }

  // Textures: Relief (illustrative Mars tint in normal mode) -> Ortho (?demo=1 default) -> Slope
  const texLoader = new THREE.TextureLoader();
  const texOptions = [];
  let terrainMat = null;
  let texIdx = 0;
  const btnTex = document.getElementById("hud-tex");
  const rockBatches = [];
  const rgbScratch = [0.56, 0.36, 0.27];
  const rockRecolorColor = new THREE.Color();

  function recolorRocksFromActiveMap() {
    if (!rockBatches.length) return;
    const activeOpt = texOptions[texIdx] || null;
    if (activeOpt && !activeOpt.sampler && activeOpt.tex?.image?.complete) {
      activeOpt.sampler = buildTextureColorSampler(activeOpt.tex.image);
    }
    const sampler =
      activeOpt?.sampler || texOptions.find((o) => o.sampler)?.sampler || null;
    const isSlopeMap = Boolean(activeOpt?.isSlope);

    for (let b = 0; b < rockBatches.length; b++) {
      const { mesh, meta } = rockBatches[b];
      for (let i = 0; i < mesh.count; i++) {
        const m = meta[i];
        sampleMapColorRgb(sampler, m.u, m.v, rgbScratch);
        rockRecolorColor.setRGB(
          rgbScratch[0],
          rgbScratch[1],
          rgbScratch[2],
          THREE.SRGBColorSpace
        );
        if (isSlopeMap) {
          const jitter = 0.85 + (m.shadeMul - 0.78) * 0.65;
          rockRecolorColor.multiplyScalar(jitter);
        } else {
          // Match terrain shader flat-dust / steep-bedrock tone & add natural stone variation
          const slopeToneR = 1.04 - m.steep * 0.34;
          const slopeToneG = 0.99 - m.steep * 0.38;
          const slopeToneB = 0.95 - m.steep * 0.38;
          rockRecolorColor.r *= slopeToneR * m.shadeMul * (1 + m.warmShift);
          rockRecolorColor.g *= slopeToneG * m.shadeMul;
          rockRecolorColor.b *= slopeToneB * m.shadeMul * (1 - m.warmShift * 0.85);
        }
        mesh.setColorAt(i, rockRecolorColor);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  let reliefOpt = null;
  let orthoOpt = null;
  let slopeOpt = null;

  const slopeTex = texLoader.load(assets.slopePreviewUrl, (loadedTex) => {
    if (slopeOpt && loadedTex?.image) {
      slopeOpt.sampler = buildTextureColorSampler(loadedTex.image);
      if (texOptions[texIdx] === slopeOpt) recolorRocksFromActiveMap();
    }
  });
  slopeTex.colorSpace = THREE.SRGBColorSpace;
  slopeTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  slopeOpt = { label: "Tex: Slope", tex: slopeTex, isRelief: false, isSlope: true, sampler: null };

  const orthoTex = assets.orthoPreviewUrl
    ? texLoader.load(assets.orthoPreviewUrl, (loadedTex) => {
        if (orthoOpt && loadedTex?.image) {
          orthoOpt.sampler = buildTextureColorSampler(loadedTex.image);
          if (texOptions[texIdx] === orthoOpt || !texOptions[texIdx]?.sampler) {
            recolorRocksFromActiveMap();
          }
        }
      })
    : slopeTex;
  if (assets.orthoPreviewUrl) {
    orthoTex.colorSpace = THREE.SRGBColorSpace;
    orthoTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    orthoOpt = { label: "Tex: Ortho", tex: orthoTex, isRelief: false, isSlope: false, sampler: null };
  }

  let reliefTex = null;
  if (assets.reliefPreviewUrl) {
    reliefTex = texLoader.load(
      assets.reliefPreviewUrl,
      (loadedTex) => {
        if (reliefOpt && loadedTex?.image) {
          reliefOpt.sampler = buildTextureColorSampler(loadedTex.image);
          if (texOptions[texIdx] === reliefOpt) recolorRocksFromActiveMap();
        }
      },
      undefined,
      () => {
        // Graceful fallback if texture-relief.jpg is missing in non-demo mode
        const idx = texOptions.findIndex((o) => o.isRelief);
        if (idx >= 0) texOptions.splice(idx, 1);
        if (texIdx >= texOptions.length) texIdx = 0;
        if (terrainMat && texOptions[texIdx]) {
          terrainMat.map = texOptions[texIdx].tex;
          terrainMat.needsUpdate = true;
          terrainShaderUniforms.uSlopeTexMode.value = texOptions[texIdx].isSlope ? 1.0 : 0.0;
        }
        if (btnTex && texOptions[texIdx]) btnTex.textContent = texOptions[texIdx].label;
        recolorRocksFromActiveMap();
      }
    );
    reliefTex.colorSpace = THREE.SRGBColorSpace;
    reliefTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    reliefOpt = {
      label: "Tex: Relief (Tint)",
      tex: reliefTex,
      isRelief: true,
      isSlope: false,
      sampler: null,
    };
    texOptions.push(reliefOpt);
  }
  if (orthoOpt) texOptions.push(orthoOpt);
  texOptions.push(slopeOpt);

  // Terrain material with world-space micro-detail shader (ripples, grit, bedrock fractures, slope roughness)
  const terrainShaderUniforms = {
    uSlopeTexMode: { value: texOptions[0].isSlope ? 1.0 : 0.0 },
  };

  terrainMat = new THREE.MeshStandardMaterial({
    map: texOptions[0].tex,
    roughness: 0.92,
    metalness: 0.03,
  });
  terrainMat.customProgramCacheKey = () => "mars-micro-terrain-v1";
  terrainMat.onBeforeCompile = (shader) => {
    shader.uniforms.uSlopeTexMode = terrainShaderUniforms.uSlopeTexMode;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vTerrainWorldPos;
varying vec3 vTerrainWorldNormal;`
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
vec4 mmTerrainWp = modelMatrix * vec4( transformed, 1.0 );
vTerrainWorldPos = mmTerrainWp.xyz;
vTerrainWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uSlopeTexMode;
varying vec3 vTerrainWorldPos;
varying vec3 vTerrainWorldNormal;

float mmHash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float mmNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mmHash(i), mmHash(i + vec2(1.0, 0.0)), u.x),
    mix(mmHash(i + vec2(0.0, 1.0)), mmHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float mmFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * mmNoise(p);
    p *= 2.13;
    a *= 0.5;
  }
  return v;
}

float mmMicroHeight(vec2 wp, float dustMask, float rockMask) {
  float warp = mmNoise(wp * 0.22) * 2.1;
  float ripplePhase = (wp.x * 0.72 + wp.y * 0.69) * 14.5 + warp;
  float ripples = sin(ripplePhase) * 0.5 + 0.5;
  ripples = pow(ripples, 1.4);
  float grit = mmFbm(wp * 3.8);
  float cracks = abs(mmNoise(wp * 1.15) - 0.5) * 2.0;
  float rockTex = smoothstep(0.08, 0.55, cracks) * 0.65 + grit * 0.35;
  return ripples * dustMask * 0.36 + grit * 0.38 + rockTex * rockMask * 0.52;
}`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
float mmSlopeCos = clamp(abs(normalize(vTerrainWorldNormal).y), 0.0, 0.99999);
float mmSlopeDeg = acos(mmSlopeCos) * 57.2957795;
float mmSteep = smoothstep(8.0, 18.0, mmSlopeDeg);
float mmFlatDust = 1.0 - smoothstep(4.0, 11.0, mmSlopeDeg);
float mmViewDist = length(vViewPosition);
float mmDetailFade = 1.0 - smoothstep(32.0, 185.0, mmViewDist);
float mmMicroH = mmMicroHeight(vTerrainWorldPos.xz, mmFlatDust, mmSteep);

if (uSlopeTexMode < 0.5) {
  // Subtle Martian dust brightening in flat hollows & darker fractured mudstone/basalt on steep slopes
  vec3 dustTint = vec3(1.13, 1.01, 0.92);
  vec3 rockTint = vec3(0.62, 0.54, 0.51);
  vec3 slopeColMod = mix(vec3(1.0), dustTint, mmFlatDust * 0.55);
  slopeColMod = mix(slopeColMod, rockTint, mmSteep * 0.65);
  float gritMod = mix(1.0, 0.86 + 0.28 * mmMicroH, mmDetailFade);
  diffuseColor.rgb *= slopeColMod * gritMod;
} else {
  diffuseColor.rgb *= mix(1.0, 0.92 + 0.16 * mmMicroH, mmDetailFade);
}`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
float mmSlopeCosR = clamp(abs(normalize(vTerrainWorldNormal).y), 0.0, 0.99999);
float mmSlopeDegR = acos(mmSlopeCosR) * 57.2957795;
float mmSteepR = smoothstep(8.0, 18.0, mmSlopeDegR);
float mmRoughMicro = mmNoise(vTerrainWorldPos.xz * 2.7);
roughnessFactor = clamp(mix(0.96, 0.84, mmSteepR) + (mmRoughMicro - 0.5) * 0.08, 0.72, 0.99);`
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
{
  float mmDistN = length(vViewPosition);
  float mmFadeN = 1.0 - smoothstep(25.0, 165.0, mmDistN);
  if (mmFadeN > 0.01) {
    float mmSlopeCosN = clamp(abs(normalize(vTerrainWorldNormal).y), 0.0, 0.99999);
    float mmSlopeDegN = acos(mmSlopeCosN) * 57.2957795;
    float mmSteepN = smoothstep(8.0, 18.0, mmSlopeDegN);
    float mmFlatN = 1.0 - smoothstep(4.0, 11.0, mmSlopeDegN);
    vec2 wp = vTerrainWorldPos.xz;
    float eps = 0.065;
    float hC = mmMicroHeight(wp, mmFlatN, mmSteepN);
    float hX = mmMicroHeight(wp + vec2(eps, 0.0), mmFlatN, mmSteepN);
    float hZ = mmMicroHeight(wp + vec2(0.0, eps), mmFlatN, mmSteepN);
    vec3 gradWorld = vec3((hX - hC) / eps, 0.0, (hZ - hC) / eps);
    vec3 gradView = (viewMatrix * vec4(gradWorld, 0.0)).xyz;
    float strength = mix(0.28, 0.42, mmSteepN) * mmFadeN;
    normal = normalize(normal - gradView * strength);
  }
}`
      );
  };

  const terrainMesh = new THREE.Mesh(hiGeom, terrainMat);
  terrainMesh.castShadow = true;
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);

  // Endless terrain: 7x7 mirrored copies with LOD on outer rings & proper CCW winding
  const TILE_RING = 3;
  const endless = new THREE.Group();
  const mirrorTiles = [];
  for (let i = -TILE_RING; i <= TILE_RING; i++) {
    for (let j = -TILE_RING; j <= TILE_RING; j++) {
      const ring = Math.max(Math.abs(i), Math.abs(j));
      const isInner = ring <= 1;
      const oddParity = (Math.abs(i) + Math.abs(j)) % 2 === 1;
      let tileGeom;
      if (isInner) {
        tileGeom = oddParity ? hiGeomFlip : hiGeom;
      } else if (ring === 2) {
        tileGeom = oddParity ? midGeomFlip : midGeom;
      } else {
        tileGeom = oddParity ? loGeomFlip : loGeom;
      }
      const copy = new THREE.Mesh(tileGeom, terrainMat);
      copy.position.set(i * worldW, 0, j * worldH);
      copy.scale.set(i % 2 === 0 ? 1 : -1, 1, j % 2 === 0 ? 1 : -1);
      copy.receiveShadow = isInner;
      copy.castShadow = isInner;
      copy.userData = { i, j, isInner };
      if (i === 0 && j === 0) {
        copy.visible = false;
        endless.userData.centre = copy;
      }
      endless.add(copy);
      mirrorTiles.push(copy);
    }
  }
  scene.add(endless);
  const period = { x: 2 * worldW, z: 2 * worldH };

  function followEndless(pos) {
    endless.position.set(
      Math.round(pos.x / period.x) * period.x,
      0,
      Math.round(pos.z / period.z) * period.z
    );
    endless.userData.centre.visible = endless.position.x !== 0 || endless.position.z !== 0;
  }

  // Build route & stop avoidance list so scattered rocks never obstruct stops or routes
  const avoidPoints = [];
  if (stops?.features) {
    for (const f of stops.features) {
      const [lon, lat] = f.geometry.coordinates;
      avoidPoints.push([lonToX(lon), latToZ(lat), 10.0]);
    }
  }
  if (route?.geometry?.coordinates?.length) {
    const coords = route.geometry.coordinates;
    const stride = Math.max(1, Math.floor(coords.length / 80));
    for (let i = 0; i < coords.length; i += stride) {
      avoidPoints.push([lonToX(coords[i][0]), latToZ(coords[i][1]), 5.5]);
    }
  }

  // Scatter 1,600 map-colored, multi-scale Martian rocks across angular blocks & mudstone slabs
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.90,
    metalness: 0.04,
  });
  const rockRng = makeSeededRng(90421);
  const dummy = new THREE.Object3D();
  const upVec = new THREE.Vector3(0, 1, 0);
  const slopeNormalVec = new THREE.Vector3();
  const slopeAlignQuat = new THREE.Quaternion();
  const rockSpinQuat = new THREE.Quaternion();
  const rockSpinEuler = new THREE.Euler();
  const halfW = worldW * 0.5 - 8;
  const halfH = worldH * 0.5 - 8;

  function scatterRockBatch(count, mode, seed) {
    const geom = buildRockGeometry(seed, mode);
    const mesh = new THREE.InstancedMesh(geom, rockMat, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const meta = [];

    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 8) {
      attempts++;
      // Bias 35% close to the main EVA start/stops, 35% across the walk valley, 30% across the whole tile
      let rx;
      let rz;
      if (placed < count * 0.35) {
        rx = -60 + (rockRng() - 0.5) * 380;
        rz = -80 + (rockRng() - 0.5) * 380;
      } else if (placed < count * 0.70) {
        rx = (rockRng() - 0.5) * 1050;
        rz = (rockRng() - 0.5) * 1050;
      } else {
        rx = (rockRng() - 0.5) * (halfW * 2);
        rz = (rockRng() - 0.5) * (halfH * 2);
      }

      // Multi-tier Martian boulder & gravel size distribution
      const tierRoll = rockRng();
      let scaleBase;
      if (tierRoll < 0.32) {
        scaleBase = 0.09 + rockRng() * 0.16; // Pebbles / coarse gravel
      } else if (tierRoll < 0.62) {
        scaleBase = 0.26 + rockRng() * 0.44; // Cobbles
      } else if (tierRoll < 0.83) {
        scaleBase = 0.72 + rockRng() * 0.92; // Medium outcrop blocks
      } else if (tierRoll < 0.95) {
        scaleBase = 1.72 + rockRng() * 1.85; // Large Mars boulders
      } else {
        scaleBase = 3.70 + rockRng() * 3.40; // Giant outcrop boulders / monuments
      }

      let tooClose = false;
      for (let k = 0; k < avoidPoints.length; k++) {
        const dx = rx - avoidPoints[k][0];
        const dz = rz - avoidPoints[k][1];
        const minClear = avoidPoints[k][2] + (scaleBase > 2.0 ? scaleBase * 0.65 : 0);
        if (dx * dx + dz * dz < minClear * minClear) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      // Diverse aspect ratios (wide slabs, tall spires, elongated prisms, chunky blocks)
      const shapeRoll = rockRng();
      let sx;
      let sy;
      let sz;
      if (mode === "slab") {
        if (shapeRoll < 0.62) {
          sx = scaleBase * (1.30 + rockRng() * 1.00);
          sy = scaleBase * (0.24 + rockRng() * 0.28);
          sz = scaleBase * (1.15 + rockRng() * 0.85);
        } else {
          sx = scaleBase * (1.60 + rockRng() * 1.05);
          sy = scaleBase * (0.32 + rockRng() * 0.36);
          sz = scaleBase * (0.65 + rockRng() * 0.45);
        }
      } else if (shapeRoll < 0.28) {
        // Broad squat boulder
        sx = scaleBase * (1.10 + rockRng() * 0.60);
        sy = scaleBase * (0.45 + rockRng() * 0.30);
        sz = scaleBase * (1.00 + rockRng() * 0.55);
      } else if (shapeRoll < 0.52) {
        // Upright fractured spire / talus pillar
        sx = scaleBase * (0.60 + rockRng() * 0.35);
        sy = scaleBase * (1.25 + rockRng() * 0.80);
        sz = scaleBase * (0.60 + rockRng() * 0.35);
      } else if (shapeRoll < 0.76) {
        // Elongated fractured wedge
        sx = scaleBase * (1.40 + rockRng() * 0.90);
        sy = scaleBase * (0.55 + rockRng() * 0.40);
        sz = scaleBase * (0.55 + rockRng() * 0.35);
      } else {
        // Chunky sub-angular Mars rock
        sx = scaleBase * (0.80 + rockRng() * 0.55);
        sy = scaleBase * (0.70 + rockRng() * 0.50);
        sz = scaleBase * (0.80 + rockRng() * 0.55);
      }

      const ry = sampleElevSceneY(rx, rz);
      const footR = Math.min(6.0, Math.max(0.5, Math.max(sx, sz) * 0.42));
      const hEast = sampleElevSceneY(rx + footR, rz);
      const hWest = sampleElevSceneY(rx - footR, rz);
      const hSouth = sampleElevSceneY(rx, rz + footR);
      const hNorth = sampleElevSceneY(rx, rz - footR);
      const baseFloor = Math.min(ry, hEast, hWest, hSouth, hNorth);
      const gx = (hEast - hWest) / (2 * footR);
      const gz = (hSouth - hNorth) / (2 * footR);
      const slopeTan = Math.hypot(gx, gz);
      const steepFactor = Math.min(1, Math.max(0, (Math.atan(slopeTan) * 180 / Math.PI - 8) / 10));

      // Align tilt subtly to local terrain normal so slabs & boulders sit flush on slopes
      slopeNormalVec.set(-gx * 0.65, 1.0, -gz * 0.65).normalize();
      slopeAlignQuat.setFromUnitVectors(upVec, slopeNormalVec);
      rockSpinEuler.set(
        (rockRng() - 0.5) * (mode === "slab" ? 0.16 : 0.34),
        rockRng() * Math.PI * 2,
        (rockRng() - 0.5) * (mode === "slab" ? 0.16 : 0.34)
      );
      rockSpinQuat.setFromEuler(rockSpinEuler);
      dummy.quaternion.copy(slopeAlignQuat).multiply(rockSpinQuat);

      const embedY = mode === "slab" ? sy * 0.10 : sy * 0.16;
      dummy.position.set(rx, Math.min(ry, baseFloor + sy * 0.25) + embedY, rz);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);

      meta.push({
        u: Math.max(0, Math.min(1, rx / worldW + 0.5)),
        v: Math.max(0, Math.min(1, rz / worldH + 0.5)),
        shadeMul: 0.78 + rockRng() * 0.38,
        warmShift: (rockRng() - 0.45) * 0.14,
        steep: steepFactor,
      });
      placed++;
    }

    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    rockBatches.push({ mesh, meta });
  }

  scatterRockBatch(950, "angular", 42);
  scatterRockBatch(650, "slab", 108);
  recolorRocksFromActiveMap();

  // Floating Martian Dust Motes (wrap locally around camera, catch sunlight & headlamp)
  const DUST_COUNT = 440;
  const DUST_BOX_XZ = 36;
  const DUST_BOX_Y = 10;
  const dustOffsets = new Float32Array(DUST_COUNT * 3);
  const dustPhases = new Float32Array(DUST_COUNT);
  const dustRng = makeSeededRng(7182);
  for (let i = 0; i < DUST_COUNT; i++) {
    dustOffsets[i * 3] = (dustRng() - 0.5) * DUST_BOX_XZ;
    dustOffsets[i * 3 + 1] = (dustRng() - 0.3) * DUST_BOX_Y;
    dustOffsets[i * 3 + 2] = (dustRng() - 0.5) * DUST_BOX_XZ;
    dustPhases[i] = dustRng() * Math.PI * 2;
  }
  const dustPositions = new Float32Array(DUST_COUNT * 3);
  const dustGeom = new THREE.BufferGeometry();
  dustGeom.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
  const dustMat = new THREE.PointsMaterial({
    map: makeDustParticleTexture(),
    color: 0xe6a887,
    size: 0.11,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const dustPoints = new THREE.Points(dustGeom, dustMat);
  dustPoints.frustumCulled = false;
  scene.add(dustPoints);

  // AR Group: Science Stop Beacons + Floating AR Labels on centre tile
  const arGroup = new THREE.Group();
  scene.add(arGroup);

  const stopSprites = [];
  if (stops?.features) {
    stops.features.forEach((f) => {
      const [lon, lat] = f.geometry.coordinates;
      const sx = lonToX(lon);
      const sz = latToZ(lat);
      const sy = sampleElevSceneY(sx, sz);
      const kind = f.properties.kind || "stop";
      const col = kind === "habitat" ? 0x22c55e : kind === "boxwork_bonus" ? 0xf59e0b : 0x38bdf8;

      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 1.8, 22, 12),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.72 })
      );
      beacon.position.set(sx, sy + 11, sz);
      arGroup.add(beacon);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(2.5, 3.6, 24),
        new THREE.MeshBasicMaterial({
          color: col,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(sx, sy + 0.5, sz);
      arGroup.add(ring);

      const sprite = makeArLabelSprite(f.properties.name || f.properties.id, kind, "— m");
      sprite.position.set(sx, sy + 26, sz);
      arGroup.add(sprite);
      stopSprites.push({ sprite, x: sx, z: sz });
    });
  }

  // Post-processing pipeline (single-pass WebGLRenderTarget + ShaderMaterial)
  const postPipeline = createBodycamPostPipeline(renderer, initW, initH);

  // State & Controls (Pure 1st-person camera-relative WASD walking at 1.7m human eye height)
  const clamp = (val, lo, hi) => Math.max(lo, Math.min(hi, val));
  const startBoundsHalfW = worldW * 0.5 - 2;
  const startBoundsHalfH = worldH * 0.5 - 2;

  const firstStopCoord = stops?.features?.[0]?.geometry?.coordinates;
  const startLon = firstStopCoord?.[0] ?? (bounds.west_lon_deg + bounds.east_lon_deg) * 0.5;
  const startLat = firstStopCoord?.[1] ?? (bounds.south_lat_deg + bounds.north_lat_deg) * 0.5;
  const startX = clamp(lonToX(startLon), -startBoundsHalfW, startBoundsHalfW);
  const startZ = clamp(latToZ(startLat), -startBoundsHalfH, startBoundsHalfH);

  let initialYaw = 0;
  const secondStopCoord = stops?.features?.[1]?.geometry?.coordinates;
  if (secondStopCoord) {
    const adx = lonToX(secondStopCoord[0]) - startX;
    const adz = latToZ(secondStopCoord[1]) - startZ;
    if (Math.hypot(adx, adz) > 0.5) initialYaw = Math.atan2(-adx, -adz);
  }

  let speedMult = 1;
  let targetYaw = initialYaw;
  let targetPitch = -0.04;
  let yawOffset = initialYaw;
  let pitchOffset = -0.04;
  let walkedM = 0;
  const freePos = new THREE.Vector3(startX, getSafeEyeY(startX, startZ), startZ);
  const keys = new Set();

  // Bodycam, Headlamp & Sol Time state
  let bodycamFxEnabled = true;
  let headlampMode = "auto"; // "auto" | "on" | "off"
  let solTime = 15.5; // 15:30 LTST late afternoon for dramatic Mount Sharp shadows
  let solAutoCycle = true;
  let walkIntensity = 0;
  let stepPhase = 0;
  let smoothExposure = 1.15;
  let smoothGlare = 0;

  // Pointer Lock mouse look (click 3D view to lock cursor; Esc to unlock) + drag fallback
  const reticleEl = document.getElementById("hud-reticle");
  const lockHintEl = document.getElementById("hud-lock-hint");
  const condensationEl = document.getElementById("visor-condensation");
  const solClockEl = document.getElementById("hud-sol-clock");
  const solSliderEl = document.getElementById("hud-sol-slider");
  const solValEl = document.getElementById("hud-sol-time-val");
  const btnSolAuto = document.getElementById("hud-sol-auto");
  const btnFx = document.getElementById("hud-fx-toggle");
  const btnHeadlamp = document.getElementById("hud-headlamp-toggle");
  const btnMoons = document.getElementById("hud-moons-toggle");

  let dragging = false;
  let movedWhileDragging = false;
  let lastX = 0;
  let lastY = 0;

  const isLocked = () => document.pointerLockElement === renderer.domElement;

  function syncLockUi() {
    const locked = isLocked();
    reticleEl?.classList.toggle("locked", locked);
    if (lockHintEl) {
      lockHintEl.textContent = locked
        ? "Mouse Locked · Esc: Unlock · WASD: Walk"
        : "Click 3D view: Lock Mouse (Esc: Unlock)";
    }
    if (locked) dragging = false;
  }

  document.addEventListener("pointerlockchange", syncLockUi);
  document.addEventListener("pointerlockerror", syncLockUi);

  renderer.domElement.addEventListener("click", () => {
    if (movedWhileDragging) {
      movedWhileDragging = false;
      return;
    }
    if (!isLocked() && renderer.domElement.requestPointerLock) {
      try {
        const res = renderer.domElement.requestPointerLock();
        if (res && typeof res.catch === "function") res.catch(() => {});
      } catch {
        // Fallback drag look remains active if pointer lock is blocked
      }
    }
  });

  window.addEventListener("mousemove", (e) => {
    if (!isLocked()) return;
    targetYaw -= e.movementX * 0.0026;
    targetPitch = clamp(targetPitch - e.movementY * 0.0022, -1.25, 1.15);
  });

  renderer.domElement.addEventListener("pointerdown", (e) => {
    if (isLocked()) return;
    dragging = true;
    movedWhileDragging = false;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener("pointerup", () => (dragging = false));
  window.addEventListener("pointermove", (e) => {
    if (isLocked() || !dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (Math.hypot(dx, dy) > 3) movedWhileDragging = true;
    targetYaw -= dx * 0.004;
    targetPitch = clamp(targetPitch - dy * 0.003, -1.25, 1.15);
    lastX = e.clientX;
    lastY = e.clientY;
  });

  function toggleHeadlamp() {
    headlampMode = headlampMode === "auto" ? "on" : headlampMode === "on" ? "off" : "auto";
    syncHeadlampUi();
  }

  function syncHeadlampUi(isAutoLit = false) {
    if (!btnHeadlamp) return;
    if (headlampMode === "on") {
      btnHeadlamp.textContent = "Headlamp (L): ON";
      btnHeadlamp.classList.add("active");
    } else if (headlampMode === "off") {
      btnHeadlamp.textContent = "Headlamp (L): OFF";
      btnHeadlamp.classList.remove("active");
    } else {
      btnHeadlamp.textContent = isAutoLit ? "Headlamp (L): AUTO*" : "Headlamp (L): AUTO";
      btnHeadlamp.classList.toggle("active", isAutoLit);
    }
  }

  window.addEventListener("keydown", (e) => {
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const k = e.key.toLowerCase();
    if (k === "l" && !e.repeat) {
      toggleHeadlamp();
      return;
    }
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(k)) {
      if (k.startsWith("arrow")) e.preventDefault();
      keys.add(k);
    }
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener("blur", () => keys.clear());

  // UI Controls
  const btnSpeed = document.getElementById("hud-speed");
  const btnAr = document.getElementById("hud-ar-toggle");
  const btnResetLook = document.getElementById("hud-reset-look");
  const btnPov = document.getElementById("hud-pov-btn");

  if (btnTex) {
    btnTex.textContent = texOptions[0].label;
    if (texOptions.length <= 1) btnTex.disabled = true;
  }

  btnSpeed?.addEventListener("click", () => {
    speedMult = speedMult === 1 ? 2 : speedMult === 2 ? 5 : 1;
    btnSpeed.textContent = `${speedMult}x`;
  });

  btnTex?.addEventListener("click", () => {
    if (texOptions.length <= 1) return;
    texIdx = (texIdx + 1) % texOptions.length;
    terrainMat.map = texOptions[texIdx].tex;
    terrainMat.needsUpdate = true;
    terrainShaderUniforms.uSlopeTexMode.value = texOptions[texIdx].isSlope ? 1.0 : 0.0;
    btnTex.textContent = texOptions[texIdx].label;
    recolorRocksFromActiveMap();
  });

  btnAr?.addEventListener("click", () => {
    arGroup.visible = !arGroup.visible;
    btnAr.textContent = arGroup.visible ? "AR: ON" : "AR: OFF";
    btnAr.classList.toggle("active", arGroup.visible);
  });

  btnMoons?.addEventListener("click", () => {
    moonMarkersGroup.visible = !moonMarkersGroup.visible;
    btnMoons.textContent = moonMarkersGroup.visible ? "Moons: ON" : "Moons: OFF";
    btnMoons.classList.toggle("active", moonMarkersGroup.visible);
  });

  btnFx?.addEventListener("click", () => {
    bodycamFxEnabled = !bodycamFxEnabled;
    btnFx.textContent = bodycamFxEnabled ? "Bodycam FX: ON" : "Bodycam FX: OFF";
    btnFx.classList.toggle("active", bodycamFxEnabled);
  });

  btnHeadlamp?.addEventListener("click", toggleHeadlamp);

  solSliderEl?.addEventListener("input", () => {
    solTime = Number(solSliderEl.value) || 0;
  });
  solSliderEl?.addEventListener("change", () => {
    solSliderEl.blur();
  });

  btnSolAuto?.addEventListener("click", () => {
    solAutoCycle = !solAutoCycle;
    btnSolAuto.textContent = solAutoCycle ? "Auto-Cycle: ON" : "Auto-Cycle: OFF";
    btnSolAuto.classList.toggle("active", solAutoCycle);
  });

  btnResetLook?.addEventListener("click", () => {
    targetYaw = initialYaw;
    targetPitch = -0.04;
    yawOffset = initialYaw;
    pitchOffset = -0.04;
  });

  // Jump directly to a science stop coordinate when clicked in the Stops drawer
  onJumpToCoord(({ coord }) => {
    const rx = clamp(lonToX(coord[0]), -startBoundsHalfW, startBoundsHalfW);
    const rz = clamp(latToZ(coord[1]), -startBoundsHalfH, startBoundsHalfH);
    freePos.set(rx, getSafeEyeY(rx, rz), rz);
  });

  // Preserve `mm:set-route` listener compatibility
  onSetRoute(({ route: incomingRoute, along_m }) => {
    const coords = incomingRoute?.geometry?.coordinates;
    if (!coords?.length) return;
    const cum = buildCumulativeDistances(coords);
    const s = Number(along_m) || 0;
    const sample = sampleAlongRoute(coords, cum, s);
    const rx = clamp(lonToX(sample.lon), -startBoundsHalfW, startBoundsHalfW);
    const rz = clamp(latToZ(sample.lat), -startBoundsHalfH, startBoundsHalfH);
    freePos.set(rx, getSafeEyeY(rx, rz), rz);
    walkedM = sample.sM;
    const rad = (-sample.headingDeg * Math.PI) / 180;
    targetYaw = rad;
    yawOffset = rad;
  });

  const compassEl = document.getElementById("hud-compass");

  function updateHudReadouts(sM, camX, camZ) {
    for (const st of stopSprites) {
      updateArLabelDist(st.sprite, Math.hypot(st.x - camX, st.z - camZ));
    }

    if (compassEl) {
      const lookHeadingDeg = (-yawOffset * 180) / Math.PI;
      compassEl.textContent = `HDG ${compassLabel(lookHeadingDeg)}`;
    }

    const primaryTel = telemetry?.primary || telemetry;
    if (!elevGrid && !primaryTel && !stops?.features?.length) {
      document.getElementById("hud-dist").textContent = "no NASA value";
      document.getElementById("hud-dist-sub").textContent = "terrain / telemetry missing";
      document.getElementById("hud-slope").textContent = "no NASA value";
      document.getElementById("hud-next-stop").textContent = "no NASA value";
      document.getElementById("hud-next-kind").textContent = "stops.json missing";
      document.getElementById("hud-o2").textContent = "no NASA value";
      return;
    }

    const slopeDeg = sampleSlopeDeg(camX, camZ) ?? primaryTel?.slope_deg ?? null;
    const slopeClass = classifySlope(slopeDeg, 20);

    let nextStop = stops?.features?.[0] || null;
    let minStopDist = Infinity;
    if (stops?.features?.length) {
      for (const f of stops.features) {
        const dx = lonToX(f.geometry.coordinates[0]) - camX;
        const dz = latToZ(f.geometry.coordinates[1]) - camZ;
        const d = Math.hypot(dx, dz);
        if (d < minStopDist) {
          minStopDist = d;
          nextStop = f;
        }
      }
    }

    const budgetM = 2500;
    const frac = Math.min(1, sM / budgetM);
    const o2Pct =
      sM === 0 && primaryTel?.suit_o2_remaining_percent != null
        ? primaryTel.suit_o2_remaining_percent
        : Math.max(0, 100 * (1 - frac));

    const inCentreTile = Math.abs(camX) <= worldW * 0.5 && Math.abs(camZ) <= worldH * 0.5;
    document.getElementById("hud-dist").textContent = `${sM.toFixed(1)} m`;
    document.getElementById("hud-dist-sub").textContent = inCentreTile
      ? `WASD Walk (1.7m) · Next: ${minStopDist < Infinity ? minStopDist.toFixed(0) + " m" : "no NASA value"}`
      : `Mirrored copy (real DTM on centre tile) · Next: ${minStopDist < Infinity ? minStopDist.toFixed(0) + " m" : "—"}`;
    document.getElementById("hud-slope").textContent =
      slopeDeg != null ? `${Number(slopeDeg).toFixed(1)}°` : "no NASA value";

    const badge = document.getElementById("hud-slope-badge");
    if (badge) {
      badge.textContent = slopeClass.id;
      badge.className = `slope-badge slope-${slopeClass.id}`;
    }

    // Subtle visor condensation pulse during steep climbs (>15°) or low placeholder O2 (<25%)
    if (condensationEl) {
      const stressed = (slopeDeg != null && slopeDeg > 15) || o2Pct < 25;
      condensationEl.classList.toggle("active", stressed);
    }

    document.getElementById("hud-next-stop").textContent =
      nextStop?.properties?.name || primaryTel?.next_stop_name || "no NASA value";
    document.getElementById("hud-next-kind").textContent =
      nextStop?.properties?.kind || "stops.json";

    document.getElementById("hud-o2").textContent = `${o2Pct.toFixed(1)}%`;
    const o2Fill = document.getElementById("hud-o2-fill");
    if (o2Fill) o2Fill.style.width = `${o2Pct.toFixed(1)}%`;

    if (btnPov) {
      btnPov.onclick = () => {
        if (!nextStop) {
          onOpenPov({
            stop_name: "Unknown Stop",
            missing: true,
            missing_label: "no NASA value — stops.json missing",
          });
          return;
        }
        const entry = povIndex?.stops?.find((s) => s.stop_id === nextStop.properties.id);
        onOpenPov(
          entry || {
            stop_id: nextStop.properties.id,
            stop_name: nextStop.properties.name,
            missing: true,
            missing_label: "no NASA value — POV image missing",
          }
        );
      };
    }
  }

  const onResize = () => {
    const w = wrap.clientWidth || window.innerWidth;
    const h = wrap.clientHeight || window.innerHeight;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    postPipeline.resize(w, h);
  };
  window.addEventListener("resize", onResize);

  // Reusable math objects
  const moveForward = new THREE.Vector3();
  const moveRight = new THREE.Vector3();
  const moveVec = new THREE.Vector3();
  const sunDir = new THREE.Vector3();
  const camForward = new THREE.Vector3();
  const sunWorldVec = new THREE.Vector3();
  const sunProjected = new THREE.Vector3();

  // Palette helpers for smooth solar elevation lighting
  const colSunNoon = new THREE.Color(0xfff0dd);
  const colSunLow = new THREE.Color(0xff8b4a);
  const colSunWork = new THREE.Color();

  const colSkyDay = new THREE.Color(0x6b4a3e);
  const colSkyNight = new THREE.Color(0x161b29);
  const colBounceDay = new THREE.Color(0xc97b4b);
  const colBounceNight = new THREE.Color(0x221614);

  const colFogDay = new THREE.Color(0xc47e58);
  const colFogSunset = new THREE.Color(0x824c3e);
  const colFogNight = new THREE.Color(0x0c101b);
  const colFogWork = new THREE.Color();

  const colDustDay = new THREE.Color(0xe6a887);
  const colDustNight = new THREE.Color(0x3a485e);

  function computeSunDirection(hours, outVec) {
    const hourAngle = ((hours / SOL_LENGTH_HR) - 0.5) * Math.PI * 2;
    const cosPhi = Math.cos(GALE_LAT_RAD);
    const sinPhi = Math.sin(GALE_LAT_RAD);
    const cosDec = Math.cos(SOLAR_DECL_RAD);
    const sinDec = Math.sin(SOLAR_DECL_RAD);
    const cosH = Math.cos(hourAngle);
    const sinH = Math.sin(hourAngle);

    const xEast = -cosDec * sinH;
    const yUp = cosPhi * cosDec * cosH + sinPhi * sinDec;
    const zSouth = sinPhi * cosDec * cosH - cosPhi * sinDec;
    return outVec.set(xEast, yUp, zSouth).normalize();
  }

  function isSunTerrainOccluded(camPos, sDir) {
    if (!elevGrid || sDir.y <= 0.01) return true;
    for (let step = 12; step <= 1400; step += 48) {
      const rx = camPos.x + sDir.x * step;
      const ry = camPos.y + sDir.y * step;
      const rz = camPos.z + sDir.z * step;
      if (sampleMeshY(rx, rz) > ry + 0.6) return true;
    }
    return false;
  }

  let prevT = performance.now();
  let lastAutoLitState = null;

  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min(0.1, (now - prevT) / 1000);
    const elapsedS = now * 0.001;
    prevT = now;

    // 1. Advance Sol Time
    if (solAutoCycle) {
      solTime = (solTime + dt * 0.03) % SOL_LENGTH_HR;
      if (solSliderEl && document.activeElement !== solSliderEl) {
        solSliderEl.value = solTime.toFixed(2);
      }
    }
    const clockStr = formatSolClock(solTime);
    if (solValEl) solValEl.textContent = clockStr;
    if (solClockEl) solClockEl.textContent = `SOL 4534 // LTST ${clockStr}`;

    // 2. Movement & Realistic Gait Physics
    const fwdInput =
      (keys.has("w") || keys.has("arrowup") ? 1 : 0) -
      (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
    const strafeInput =
      (keys.has("d") || keys.has("arrowright") ? 1 : 0) -
      (keys.has("a") || keys.has("arrowleft") ? 1 : 0);

    const isMoving = fwdInput !== 0 || strafeInput !== 0;
    const sprint = keys.has("shift");

    if (isMoving) {
      const moveSpeed = 10 * speedMult * (sprint ? 2.2 : 1.0);
      moveForward.set(-Math.sin(yawOffset), 0, -Math.cos(yawOffset));
      moveRight.set(Math.cos(yawOffset), 0, -Math.sin(yawOffset));
      moveVec
        .set(0, 0, 0)
        .addScaledVector(moveForward, fwdInput)
        .addScaledVector(moveRight, strafeInput);
      if (moveVec.lengthSq() > 0) {
        moveVec.normalize();
        const prevX = freePos.x;
        const prevZ = freePos.z;
        freePos.x += moveVec.x * moveSpeed * dt;
        freePos.z += moveVec.z * moveSpeed * dt;
        walkedM += Math.hypot(freePos.x - prevX, freePos.z - prevZ);
      }
    }

    // Smooth camera inertia on look & stride intensity
    const lookLerp = 1 - Math.exp(-28 * dt);
    yawOffset += (targetYaw - yawOffset) * lookLerp;
    pitchOffset += (targetPitch - pitchOffset) * lookLerp;

    const targetWalk = isMoving ? clamp((sprint ? 1.25 : 0.95) * Math.min(2.0, 0.75 + speedMult * 0.2), 0, 1.5) : 0;
    walkIntensity += (targetWalk - walkIntensity) * (1 - Math.exp(-10 * dt));
    stepPhase += dt * (sprint ? 10.4 : 7.6) * Math.min(2.2, 0.75 + speedMult * 0.25);

    const gaitY = Math.sin(stepPhase * 2.0) * 0.042 * walkIntensity;
    const gaitSway = Math.cos(stepPhase) * 0.028 * walkIntensity;
    const gaitRoll = Math.sin(stepPhase) * 0.011 * walkIntensity;
    const breathY = Math.sin(elapsedS * 1.45) * 0.008 * (1 - Math.min(1, walkIntensity));
    const breathPitch = Math.sin(elapsedS * 0.9) * 0.0022 * (1 - Math.min(1, walkIntensity));
    const breathRoll = Math.cos(elapsedS * 0.72) * 0.0016 * (1 - Math.min(1, walkIntensity));

    freePos.y = getSafeEyeY(freePos.x, freePos.z);

    // Subtle slope pitch compensation when walking uphill/downhill
    moveForward.set(-Math.sin(yawOffset), 0, -Math.cos(yawOffset));
    moveRight.set(Math.cos(yawOffset), 0, -Math.sin(yawOffset));

    camera.position.copy(freePos);
    camera.position.y += gaitY + breathY;
    camera.position.addScaledVector(moveRight, gaitSway);

    camera.rotation.order = "YXZ";
    camera.rotation.y = yawOffset;
    camera.rotation.x = pitchOffset + breathPitch;
    camera.rotation.z = gaitRoll + breathRoll;

    // 3. Solar Ephemeris & Dynamic Martian Sky/Fog/Lights
    computeSunDirection(solTime, sunDir);
    const sunAlt = sunDir.y;
    const dayFactor = clamp((sunAlt + 0.06) / 0.34, 0, 1);
    const highSun = clamp((sunAlt - 0.05) / 0.45, 0, 1);
    const twilightFactor =
      clamp((sunAlt + 0.14) / 0.17, 0, 1) * (1 - clamp((sunAlt - 0.10) / 0.22, 0, 1));
    const nightFactor = 1 - clamp((sunAlt + 0.10) / 0.26, 0, 1);

    skyMesh.position.copy(camera.position);
    starPoints.position.copy(camera.position);
    skyMat.uniforms.uSunDir.value.copy(sunDir);
    starMat.uniforms.uNightAlpha.value = nightFactor;
    starMat.uniforms.uTime.value = elapsedS;

    // Fog smoothly transitions between noon dust, russet twilight, and slate night,
    // locked to the sky dome's dusty horizon color so distant mountains look solid.
    colFogWork.copy(colFogNight).lerp(colFogSunset, clamp((sunAlt + 0.12) / 0.18, 0, 1));
    colFogWork.lerp(colFogDay, highSun);
    scene.fog.color.copy(colFogWork);
    scene.background.copy(colFogWork);
    skyMat.uniforms.uFogColor.value.copy(colFogWork);
    scene.fog.density = 0.00095 + twilightFactor * 0.00028 + highSun * 0.00010;

    // Sun DirectionalLight
    sunLight.target.position.copy(camera.position);
    sunLight.position.copy(camera.position).addScaledVector(sunDir, 520);
    colSunWork.copy(colSunLow).lerp(colSunNoon, highSun);
    sunLight.color.copy(colSunWork);
    const sunIntensity = sunAlt <= -0.01 ? 0.0 : 1.1 + 1.5 * highSun;
    sunLight.intensity = sunIntensity * clamp((sunAlt + 0.01) / 0.06, 0, 1);
    sunLight.castShadow = sunLight.intensity > 0.05;

    // Ground-Bounce HemisphereLight
    hemiLight.color.copy(colSkyNight).lerp(colSkyDay, dayFactor);
    hemiLight.groundColor.copy(colBounceNight).lerp(colBounceDay, dayFactor);
    hemiLight.intensity = 0.20 + 0.68 * dayFactor;

    // Helmet Headlamp (auto-assists in twilight/night unless manually disabled)
    const autoAssist = sunAlt < 0.09;
    if (headlampMode === "auto" && lastAutoLitState !== autoAssist) {
      lastAutoLitState = autoAssist;
      syncHeadlampUi(autoAssist);
    }
    const wantHeadlamp = headlampMode === "on" || (headlampMode === "auto" && autoAssist);
    const targetLampIntensity = wantHeadlamp ? (sunAlt < 0.04 ? 4.8 : 2.6) : 0.0;
    headlamp.intensity += (targetLampIntensity - headlamp.intensity) * (1 - Math.exp(-10 * dt));

    // 4. Orbiting Martian Moons (Phobos West->East, Deimos East->West)
    const phobosPhase = (solTime - 14.23) * ((2 * Math.PI) / 11.1);
    const px = Math.sin(phobosPhase);
    const py = Math.cos(phobosPhase);
    const pz = -0.18 + 0.12 * Math.sin(phobosPhase * 0.7);
    const pLen = Math.hypot(px, py, pz);
    phobosMesh.position.set(
      camera.position.x + (px / pLen) * 7600,
      camera.position.y + (py / pLen) * 7600,
      camera.position.z + (pz / pLen) * 7600
    );
    phobosMesh.lookAt(camera.position);
    phobosMesh.visible = py / pLen > -0.04;
    phobosMesh.material.uniforms.uSunDir.value.copy(sunDir);
    phobosMesh.material.uniforms.uSkyScatter.value.copy(colFogWork);
    phobosMarker.position.copy(phobosMesh.position).add(new THREE.Vector3(0, 210, 0));
    phobosMarker.visible = phobosMesh.visible && moonMarkersGroup.visible;

    const deimosPhase = -0.52 + (solTime - 15.5) * ((2 * Math.PI) / 131.5);
    const dx = -Math.sin(deimosPhase);
    const dy = Math.cos(deimosPhase);
    const dz = 0.26;
    const dLen = Math.hypot(dx, dy, dz);
    deimosMesh.position.set(
      camera.position.x + (dx / dLen) * 8200,
      camera.position.y + (dy / dLen) * 8200,
      camera.position.z + (dz / dLen) * 8200
    );
    deimosMesh.lookAt(camera.position);
    deimosMesh.visible = dy / dLen > -0.04;
    deimosMesh.material.uniforms.uSunDir.value.copy(sunDir);
    deimosMesh.material.uniforms.uSkyScatter.value.copy(colFogWork);
    deimosMarker.position.copy(deimosMesh.position).add(new THREE.Vector3(0, 160, 0));
    deimosMarker.visible = deimosMesh.visible && moonMarkersGroup.visible;

    // 5. Floating Martian Dust Motes (modulo wrapped around camera + lit by sun/headlamp)
    const dustAttr = dustGeom.attributes.position;
    for (let i = 0; i < DUST_COUNT; i++) {
      const ph = dustPhases[i];
      const ox = dustOffsets[i * 3] + elapsedS * 0.42 + Math.sin(elapsedS * 0.7 + ph) * 0.6;
      const oy = dustOffsets[i * 3 + 1] + Math.sin(elapsedS * 0.55 + ph * 1.3) * 0.35;
      const oz = dustOffsets[i * 3 + 2] + elapsedS * 0.18 + Math.cos(elapsedS * 0.6 + ph) * 0.5;
      const wx = camera.position.x + ((((ox - camera.position.x) % DUST_BOX_XZ) + DUST_BOX_XZ * 1.5) % DUST_BOX_XZ) - DUST_BOX_XZ * 0.5;
      const wy = camera.position.y + ((((oy - camera.position.y) % DUST_BOX_Y) + DUST_BOX_Y * 1.5) % DUST_BOX_Y) - DUST_BOX_Y * 0.5;
      const wz = camera.position.z + ((((oz - camera.position.z) % DUST_BOX_XZ) + DUST_BOX_XZ * 1.5) % DUST_BOX_XZ) - DUST_BOX_XZ * 0.5;
      dustAttr.setXYZ(i, wx, wy, wz);
    }
    dustAttr.needsUpdate = true;
    dustMat.color.copy(colDustNight).lerp(colDustDay, dayFactor);
    if (wantHeadlamp) dustMat.color.lerp(colSunNoon, 0.35);
    dustMat.opacity = wantHeadlamp ? 0.46 : 0.22 + 0.18 * dayFactor;

    // 6. Dynamic Tone-Mapping Exposure & Sun Glare Adaptation
    camera.getWorldDirection(camForward);
    const sunAlign = Math.max(0, camForward.dot(sunDir));
    const targetExp = sunLight.intensity > 0.05 ? 1.21 - 0.26 * Math.pow(sunAlign, 3.0) : 1.30;
    smoothExposure += (targetExp - smoothExposure) * (1 - Math.exp(-5 * dt));
    renderer.toneMappingExposure = smoothExposure;

    // 7. Endless Terrain, HUD & Map Sync
    const hudLon = clamp(xToLon(freePos.x), -180, 180);
    const hudLat = clamp(zToLat(freePos.z), -85, 85);
    updateHudReadouts(walkedM, freePos.x, freePos.z);
    if (onPositionChange) onPositionChange(hudLon, hudLat, walkedM);
    followEndless(camera.position);

    // 8. Render Scene (Single-pass Bodycam Post-Processing OR Raw Direct Render)
    if (bodycamFxEnabled) {
      camera.updateMatrixWorld();
      sunWorldVec.copy(camera.position).addScaledVector(sunDir, 6800);
      sunProjected.copy(sunWorldVec).project(camera);

      const inFront = sunProjected.z < 1.0 && sunDir.y > -0.02 && sunAlign > 0.25;
      const occluded = !inFront || isSunTerrainOccluded(camera.position, sunDir);
      const targetGlare = occluded ? 0.0 : clamp((sunAlign - 0.25) / 0.75, 0, 1) * clamp((sunDir.y + 0.02) / 0.15, 0, 1);
      smoothGlare += (targetGlare - smoothGlare) * (1 - Math.exp(-12 * dt));

      postPipeline.postMat.uniforms.uTime.value = elapsedS;
      postPipeline.postMat.uniforms.uSunScreenPos.value.set(
        (sunProjected.x + 1) * 0.5,
        (sunProjected.y + 1) * 0.5
      );
      postPipeline.postMat.uniforms.uSunGlare.value = smoothGlare;
      postPipeline.postMat.uniforms.uSunColor.value.copy(colSunWork);
      postPipeline.postMat.uniforms.uNightFactor.value = nightFactor;

      renderer.setRenderTarget(postPipeline.rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(postPipeline.postScene, postPipeline.postCamera);
    } else {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }
  }
  requestAnimationFrame(animate);

  return { onResize };
}
