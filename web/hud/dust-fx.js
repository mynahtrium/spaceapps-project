/**
 * Martian regolith footstep, jump takeoff, and landing dust effect system.
 * Uses a pre-allocated 4x3 sprite atlas billboard pool + ballistic sand grain pool
 * tuned for Mars gravity (3.71 m/s^2) and thin atmospheric drag.
 */

export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 3;
export const ATLAS_COUNT = ATLAS_COLS * ATLAS_ROWS;

// Cell indices from the 4x3 Mars dust sprite atlas (row-major from top-left):
// 0: diagonal billowing plume, 1: curved vortex curl, 2: wide wispy ground cloud,
// 3: radial burst, 4: C-shaped curl, 5: compact bright puff, 6: wide diamond puff,
// 7: undulating ground wave, 8: swept wind tail, 9: U-curl blast,
// 10: dense impact burst, 11: low skimming ground streak.
export const GROUND_SHEAR_CELLS = [2, 7, 8, 11, 1, 9];
export const BILLOW_PLUME_CELLS = [0, 3, 4, 5, 6, 10];
export const IMPACT_BURST_CELLS = [3, 5, 10, 1, 9, 6];

export const MAX_PUFFS = 192;
export const MAX_GRAINS = 320;

const _vTmp1 = { x: 0, y: 0, z: 0 };
const _vTmp2 = { x: 0, y: 0, z: 0 };

/**
 * Compute normalized UV bounds (u0, v0, u1, v1) for an atlas cell with flipY=true.
 * Adds a half-texel inset to prevent bleeding from neighboring cells.
 */
export function computeDustAtlasUv(cellIndex, cols = ATLAS_COLS, rows = ATLAS_ROWS, inset = 0.004) {
  const safe = ((Math.floor(cellIndex) % (cols * rows)) + cols * rows) % (cols * rows);
  const col = safe % cols;
  const row = Math.floor(safe / cols);
  const cellW = 1 / cols;
  const cellH = 1 / rows;
  const u0 = col * cellW + inset;
  const u1 = (col + 1) * cellW - inset;
  // OpenGL / Three.js flipY=true maps v=1 to top of image (row 0).
  const v1 = 1 - row * cellH - inset;
  const v0 = 1 - (row + 1) * cellH + inset;
  return { u0, v0, u1, v1 };
}

/**
 * Advance a single billowing dust puff particle state in-place for dt seconds.
 * Returns true if the particle remains alive, false if expired.
 */
export function stepDustPuff(p, dt, windX = 0.16, windZ = -0.09) {
  p.age += dt;
  if (p.age >= p.life) {
    p.alive = false;
    return false;
  }
  const drag = Math.exp(-p.drag * dt);
  p.vx = p.vx * drag + windX * p.windCoupling * dt;
  p.vy = p.vy * drag + p.buoyancy * dt;
  p.vz = p.vz * drag + windZ * p.windCoupling * dt;

  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.z += p.vz * dt;

  p.rot += p.angVel * dt;
  p.angVel *= Math.exp(-1.1 * dt);

  const t = p.age / p.life;
  // Expand briskly at impact, then keep diffusing gently as opacity fades out.
  p.size = p.startSize + (p.endSize - p.startSize) * (1 - Math.pow(1 - t, 2.1));

  const fadeIn = Math.min(1, p.age / Math.max(0.03, p.fadeIn));
  const fadeOut = Math.pow(Math.max(0, 1 - Math.max(0, t - 0.14) / 0.86), 1.45);
  p.alpha = p.peakAlpha * fadeIn * fadeOut;
  return true;
}

/**
 * Advance a single ballistic regolith grain under Martian gravity along its spawn normal.
 * Returns true if the grain remains alive, false if expired.
 */
export function stepDustGrain(g, dt, marsG = 3.71) {
  g.age += dt;
  if (g.age >= g.life) {
    g.alive = false;
    return false;
  }
  const drag = Math.exp(-0.45 * dt);
  g.vx = (g.vx - g.nx * marsG * dt) * drag;
  g.vy = (g.vy - g.ny * marsG * dt) * drag;
  g.vz = (g.vz - g.nz * marsG * dt) * drag;

  g.x += g.vx * dt;
  g.y += g.vy * dt;
  g.z += g.vz * dt;

  // Distance above local tangent ground plane passing through spawn origin
  const height = (g.x - g.gx) * g.nx + (g.y - g.gy) * g.ny + (g.z - g.gz) * g.nz;
  const vn = g.vx * g.nx + g.vy * g.ny + g.vz * g.nz;
  if (height < 0 && vn < 0) {
    g.x -= height * g.nx;
    g.y -= height * g.ny;
    g.z -= height * g.nz;
    if (!g.bounced && vn < -0.35) {
      // Small damped regolith bounce and lateral scatter
      const bounceImpulse = -(1 + 0.24) * vn;
      g.vx = g.vx * 0.62 + bounceImpulse * g.nx;
      g.vy = g.vy * 0.62 + bounceImpulse * g.ny;
      g.vz = g.vz * 0.62 + bounceImpulse * g.nz;
      g.bounced = true;
    } else {
      g.vx *= 0.25;
      g.vy *= 0.25;
      g.vz *= 0.25;
      // Trim remaining life once settled on the surface
      g.age = Math.max(g.age, g.life * 0.72);
    }
  }

  const t = g.age / g.life;
  g.alpha = g.peakAlpha * Math.min(1, g.age / 0.03) * Math.pow(Math.max(0, 1 - t), 0.9);
  return true;
}

function normalizeOrFallback(v, fx, fy, fz, out) {
  const vx = v?.x ?? fx;
  const vy = v?.y ?? fy;
  const vz = v?.z ?? fz;
  const len = Math.hypot(vx, vy, vz);
  if (len > 1e-5) {
    out.x = vx / len;
    out.y = vy / len;
    out.z = vz / len;
  } else {
    out.x = fx;
    out.y = fy;
    out.z = fz;
  }
  return out;
}

/**
 * Orthonormal tangent basis (t1, t2) orthogonal to unit normal n.
 */
function buildTangentBasis(n, fwdHint, t1, t2) {
  const hx = fwdHint ? fwdHint.x : 0;
  const hy = fwdHint ? fwdHint.y : 0;
  const hz = fwdHint ? fwdHint.z : 1;
  // Project forward hint onto tangent plane
  const dot = hx * n.x + hy * n.y + hz * n.z;
  let fx = hx - dot * n.x;
  let fy = hy - dot * n.y;
  let fz = hz - dot * n.z;
  let fl = Math.hypot(fx, fy, fz);
  if (fl < 1e-4) {
    // Pick an arbitrary vector not parallel to n
    const ax = Math.abs(n.y) < 0.9 ? 0 : 1;
    const ay = Math.abs(n.y) < 0.9 ? 1 : 0;
    const az = 0;
    fx = ay * n.z - az * n.y;
    fy = az * n.x - ax * n.z;
    fz = ax * n.y - ay * n.x;
    fl = Math.hypot(fx, fy, fz) || 1;
  }
  t1.x = fx / fl;
  t1.y = fy / fl;
  t1.z = fz / fl;
  // t2 = n x t1
  t2.x = n.y * t1.z - n.z * t1.y;
  t2.y = n.z * t1.x - n.x * t1.z;
  t2.z = n.x * t1.y - n.y * t1.x;
}

function createFallbackPuffTexture(THREE) {
  if (typeof document === "undefined") return null;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size * 0.5, size * 0.5, size * 0.06, size * 0.5, size * 0.5, size * 0.48);
  g.addColorStop(0.0, "rgba(214, 152, 108, 0.92)");
  g.addColorStop(0.45, "rgba(186, 124, 84, 0.55)");
  g.addColorStop(1.0, "rgba(154, 98, 66, 0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randRange(a, b) {
  return a + Math.random() * (b - a);
}

/**
 * Create a batched Three.js Martian dust cloud + ballistic sand grain system.
 */
export function createMarsDustSystem({
  THREE,
  scene,
  atlasUrl = "./assets/dust/mars-dust-atlas.png",
  horizonColor,
  sunDir,
  marsG = 3.71,
} = {}) {
  if (!THREE || !scene) {
    throw new Error("createMarsDustSystem requires THREE and scene");
  }

  const puffs = Array.from({ length: MAX_PUFFS }, () => ({
    alive: false,
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    startSize: 0.25,
    endSize: 0.9,
    size: 0.25,
    rot: 0,
    angVel: 0,
    age: 0,
    life: 1,
    fadeIn: 0.07,
    peakAlpha: 0.65,
    alpha: 0,
    drag: 2.2,
    buoyancy: 0.14,
    windCoupling: 0.85,
    r: 0.82, g: 0.54, b: 0.36,
    u0: 0, v0: 0, u1: 1, v1: 1,
    isAtlas: 1,
  }));
  let puffCursor = 0;

  const grains = Array.from({ length: MAX_GRAINS }, () => ({
    alive: false,
    x: 0, y: 0, z: 0,
    gx: 0, gy: 0, gz: 0,
    nx: 0, ny: 1, nz: 0,
    vx: 0, vy: 0, vz: 0,
    age: 0,
    life: 0.8,
    size: 2.5,
    peakAlpha: 0.9,
    alpha: 0,
    bounced: false,
    r: 0.78, g: 0.49, b: 0.31,
  }));
  let grainCursor = 0;

  // --- Puff geometry & ShaderMaterial ---
  const puffPositions = new Float32Array(MAX_PUFFS * 4 * 3);
  const puffCorners = new Float32Array(MAX_PUFFS * 4 * 2);
  const puffUv = new Float32Array(MAX_PUFFS * 4 * 2);
  const puffParams = new Float32Array(MAX_PUFFS * 4 * 3); // [size, rot, alpha]
  const puffColors = new Float32Array(MAX_PUFFS * 4 * 3);
  const puffIndices = new Uint16Array(MAX_PUFFS * 6);

  const cornerCoords = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];

  for (let i = 0; i < MAX_PUFFS; i++) {
    const vBase = i * 4;
    const iBase = i * 6;
    for (let c = 0; c < 4; c++) {
      puffCorners[(vBase + c) * 2 + 0] = cornerCoords[c][0];
      puffCorners[(vBase + c) * 2 + 1] = cornerCoords[c][1];
    }
    puffIndices[iBase + 0] = vBase + 0;
    puffIndices[iBase + 1] = vBase + 1;
    puffIndices[iBase + 2] = vBase + 2;
    puffIndices[iBase + 3] = vBase + 0;
    puffIndices[iBase + 4] = vBase + 2;
    puffIndices[iBase + 5] = vBase + 3;
  }

  const puffGeom = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(puffPositions, 3);
  const uvAttr = new THREE.BufferAttribute(puffUv, 2);
  const paramAttr = new THREE.BufferAttribute(puffParams, 3);
  const colorAttr = new THREE.BufferAttribute(puffColors, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  uvAttr.setUsage(THREE.DynamicDrawUsage);
  paramAttr.setUsage(THREE.DynamicDrawUsage);
  colorAttr.setUsage(THREE.DynamicDrawUsage);

  puffGeom.setAttribute("position", posAttr);
  puffGeom.setAttribute("aCorner", new THREE.BufferAttribute(puffCorners, 2));
  puffGeom.setAttribute("uv", uvAttr);
  puffGeom.setAttribute("aParams", paramAttr);
  puffGeom.setAttribute("aColor", colorAttr);
  puffGeom.setIndex(new THREE.BufferAttribute(puffIndices, 1));
  puffGeom.setDrawRange(0, 0);

  const fallbackTex = createFallbackPuffTexture(THREE);
  const defaultHorizon = horizonColor ? horizonColor.clone() : new THREE.Color(0.62, 0.43, 0.3);
  const defaultSun = sunDir ? sunDir.clone().normalize() : new THREE.Vector3(-0.55, 0.42, -0.72).normalize();

  const puffUniforms = {
    uMap: { value: fallbackTex },
    uCamRight: { value: new THREE.Vector3(1, 0, 0) },
    uCamUp: { value: new THREE.Vector3(0, 1, 0) },
    uHorizon: { value: defaultHorizon },
    uSunLight: { value: 1.0 },
  };

  let atlasLoaded = false;
  if (atlasUrl && typeof THREE.TextureLoader === "function" && typeof Image !== "undefined") {
    const loader = new THREE.TextureLoader();
    loader.load(
      atlasUrl,
      (tex) => {
        if ("colorSpace" in tex && THREE.SRGBColorSpace) {
          tex.colorSpace = THREE.SRGBColorSpace;
        }
        tex.generateMipmaps = true;
        tex.needsUpdate = true;
        puffUniforms.uMap.value = tex;
        atlasLoaded = true;
      },
      undefined,
      () => {
        // Keep fallback radial puff texture silently offline/in error cases
      }
    );
  }

  const puffMat = new THREE.ShaderMaterial({
    uniforms: puffUniforms,
    vertexShader: `
      attribute vec2 aCorner;
      attribute vec3 aParams;
      attribute vec3 aColor;
      uniform vec3 uCamRight;
      uniform vec3 uCamUp;
      varying vec2 vUv;
      varying float vAlpha;
      varying vec3 vColor;
      varying float vDist;
      void main() {
        vUv = uv;
        float size = aParams.x;
        float rot = aParams.y;
        vAlpha = aParams.z;
        vColor = aColor;
        float cs = cos(rot);
        float sn = sin(rot);
        vec2 rotated = vec2(
          aCorner.x * cs - aCorner.y * sn,
          aCorner.x * sn + aCorner.y * cs
        ) * size;
        vec3 worldPos = position + uCamRight * rotated.x + uCamUp * rotated.y;
        vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
        vDist = -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform vec3 uHorizon;
      uniform float uSunLight;
      varying vec2 vUv;
      varying float vAlpha;
      varying vec3 vColor;
      varying float vDist;
      void main() {
        vec4 texel = texture2D(uMap, vUv);
        float a = texel.a * vAlpha;
        if (a < 0.008) discard;
        // Blend subtle texture luminance with Martian regolith tint + horizon scatter
        vec3 baseCol = mix(vColor, texel.rgb * vColor * 1.32, 0.62) * mix(0.65, 1.06, uSunLight);
        float fogMix = smoothstep(28.0, 200.0, vDist) * 0.72;
        vec3 finalCol = mix(baseCol, uHorizon, fogMix);
        gl_FragColor = vec4(finalCol, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });

  const puffMesh = new THREE.Mesh(puffGeom, puffMat);
  puffMesh.frustumCulled = false;
  puffMesh.renderOrder = 14;
  puffMesh.name = "mars-dust-puffs";
  scene.add(puffMesh);

  // --- Ballistic sand grains Points + ShaderMaterial ---
  const grainPositions = new Float32Array(MAX_GRAINS * 3);
  const grainColors = new Float32Array(MAX_GRAINS * 4); // rgb + alpha
  const grainSizes = new Float32Array(MAX_GRAINS);

  const grainGeom = new THREE.BufferGeometry();
  const gPosAttr = new THREE.BufferAttribute(grainPositions, 3);
  const gColAttr = new THREE.BufferAttribute(grainColors, 4);
  const gSizeAttr = new THREE.BufferAttribute(grainSizes, 1);
  gPosAttr.setUsage(THREE.DynamicDrawUsage);
  gColAttr.setUsage(THREE.DynamicDrawUsage);
  gSizeAttr.setUsage(THREE.DynamicDrawUsage);
  grainGeom.setAttribute("position", gPosAttr);
  grainGeom.setAttribute("aColor", gColAttr);
  grainGeom.setAttribute("aSize", gSizeAttr);
  grainGeom.setDrawRange(0, 0);

  const grainMat = new THREE.ShaderMaterial({
    uniforms: {
      uHorizon: { value: defaultHorizon },
      uSunLight: { value: 1.0 },
    },
    vertexShader: `
      attribute vec4 aColor;
      attribute float aSize;
      varying vec4 vColor;
      varying float vDist;
      void main() {
        vColor = aColor;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vDist = max(0.25, -mvPos.z);
        gl_PointSize = clamp(aSize * (280.0 / vDist), 1.5, 11.0);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uHorizon;
      uniform float uSunLight;
      varying vec4 vColor;
      varying float vDist;
      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float d2 = dot(c, c);
        if (d2 > 0.25) discard;
        float soft = smoothstep(0.25, 0.04, d2);
        vec3 col = mix(vColor.rgb * mix(0.65, 1.05, uSunLight), uHorizon, smoothstep(28.0, 180.0, vDist) * 0.65);
        gl_FragColor = vec4(col, vColor.a * soft);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });

  const grainPoints = new THREE.Points(grainGeom, grainMat);
  grainPoints.frustumCulled = false;
  grainPoints.renderOrder = 15;
  grainPoints.name = "mars-dust-grains";
  scene.add(grainPoints);

  const t1 = { x: 1, y: 0, z: 0 };
  const t2 = { x: 0, y: 0, z: 1 };
  const nrm = { x: 0, y: 1, z: 0 };
  const fwd = { x: 0, y: 0, z: 1 };
  const camRight = new THREE.Vector3(1, 0, 0);
  const camUp = new THREE.Vector3(0, 1, 0);

  function allocPuff() {
    for (let n = 0; n < MAX_PUFFS; n++) {
      const idx = (puffCursor + n) % MAX_PUFFS;
      if (!puffs[idx].alive) {
        puffCursor = (idx + 1) % MAX_PUFFS;
        return puffs[idx];
      }
    }
    const idx = puffCursor;
    puffCursor = (puffCursor + 1) % MAX_PUFFS;
    return puffs[idx];
  }

  function allocGrain() {
    for (let n = 0; n < MAX_GRAINS; n++) {
      const idx = (grainCursor + n) % MAX_GRAINS;
      if (!grains[idx].alive) {
        grainCursor = (idx + 1) % MAX_GRAINS;
        return grains[idx];
      }
    }
    const idx = grainCursor;
    grainCursor = (grainCursor + 1) % MAX_GRAINS;
    return grains[idx];
  }

  function spawnPuff({
    pos,
    normal,
    dirX,
    dirZ,
    lateralSpread,
    upSpeed,
    horizSpeed,
    startSize,
    endSize,
    life,
    peakAlpha,
    drag,
    buoyancy,
    cellIndex,
    brightness = 1.0,
    spawnOffsetT1 = 0,
    spawnOffsetT2 = 0,
    spawnOffsetN = 0.06,
  }) {
    const p = allocPuff();
    p.alive = true;
    p.x = pos.x + t1.x * spawnOffsetT1 + t2.x * spawnOffsetT2 + normal.x * spawnOffsetN;
    p.y = pos.y + t1.y * spawnOffsetT1 + t2.y * spawnOffsetT2 + normal.y * spawnOffsetN;
    p.z = pos.z + t1.z * spawnOffsetT1 + t2.z * spawnOffsetT2 + normal.z * spawnOffsetN;

    const tx = dirX * horizSpeed + t2.x * lateralSpread; // dirX already in world tangent space
    p.vx = dirX * t1.x * horizSpeed + dirZ * t2.x * horizSpeed + normal.x * upSpeed;
    p.vy = dirX * t1.y * horizSpeed + dirZ * t2.y * horizSpeed + normal.y * upSpeed;
    p.vz = dirX * t1.z * horizSpeed + dirZ * t2.z * horizSpeed + normal.z * upSpeed;
    void tx;

    p.startSize = startSize;
    p.endSize = endSize;
    p.size = startSize;
    p.rot = randRange(0, Math.PI * 2);
    p.angVel = randRange(-1.35, 1.35);
    p.age = 0;
    p.life = life;
    p.fadeIn = Math.min(0.08, life * 0.14);
    p.peakAlpha = peakAlpha;
    p.alpha = 0;
    p.drag = drag;
    p.buoyancy = buoyancy;
    p.windCoupling = randRange(0.5, 1.15);

    // Martian ferric regolith warm ochres & cinnamon-sands with subtle variation
    p.r = Math.min(1, randRange(0.76, 0.91) * brightness);
    p.g = Math.min(1, randRange(0.49, 0.63) * brightness);
    p.b = Math.min(1, randRange(0.32, 0.44) * brightness);

    const uv = atlasLoaded
      ? computeDustAtlasUv(cellIndex)
      : { u0: 0, v0: 0, u1: 1, v1: 1 };
    p.u0 = uv.u0;
    p.v0 = uv.v0;
    p.u1 = uv.u1;
    p.v1 = uv.v1;
  }

  function spawnGrain({ pos, normal, tangentA, tangentB, radialSpeed, upSpeed, life, size, offsetN = 0.03 }) {
    const g = allocGrain();
    g.alive = true;
    g.gx = pos.x;
    g.gy = pos.y;
    g.gz = pos.z;
    g.nx = normal.x;
    g.ny = normal.y;
    g.nz = normal.z;

    const rOff = randRange(0.02, 0.11);
    g.x = pos.x + tangentA * rOff + normal.x * offsetN;
    g.y = pos.y + tangentA * 0 + normal.y * offsetN;
    g.z = pos.z + tangentB * rOff + normal.z * offsetN;

    g.vx = tangentA * radialSpeed + normal.x * upSpeed;
    g.vy = tangentB * radialSpeed * 0.15 + normal.y * upSpeed;
    // Compute clean 3D velocity in tangent basis:
    const wvx = t1.x * tangentA * radialSpeed + t2.x * tangentB * radialSpeed + normal.x * upSpeed;
    const wvy = t1.y * tangentA * radialSpeed + t2.y * tangentB * radialSpeed + normal.y * upSpeed;
    const wvz = t1.z * tangentA * radialSpeed + t2.z * tangentB * radialSpeed + normal.z * upSpeed;
    g.vx = wvx;
    g.vy = wvy;
    g.vz = wvz;
    g.x = pos.x + t1.x * tangentA * 0.08 + t2.x * tangentB * 0.08 + normal.x * offsetN;
    g.y = pos.y + t1.y * tangentA * 0.08 + t2.y * tangentB * 0.08 + normal.y * offsetN;
    g.z = pos.z + t1.z * tangentA * 0.08 + t2.z * tangentB * 0.08 + normal.z * offsetN;

    g.age = 0;
    g.life = life;
    g.size = size;
    g.peakAlpha = randRange(0.68, 0.96);
    g.alpha = 0;
    g.bounced = false;
    const shade = randRange(0.75, 1.12);
    g.r = Math.min(1, 0.72 * shade);
    g.g = Math.min(1, 0.44 * shade);
    g.b = Math.min(1, 0.27 * shade);
  }

  /**
   * Emit realistic Martian dust kick + ground-skimming clouds + regolith grains on foot plant.
   * @param {{x:number,y:number,z:number}} pos Ground contact point under boot sole
   * @param {{x:number,y:number,z:number}} normal Terrain surface normal at contact point
   * @param {{x:number,y:number,z:number}|null} moveDirVec Horizontal/surface travel direction
   * @param {number} intensity 0.5 (slow walk) .. 1.6 (fast run / steep downhill plant)
   */
  function emitFootstep(pos, normal, moveDirVec = null, intensity = 1) {
    if (!pos) return;
    const power = Math.max(0.25, Math.min(1.8, intensity));
    // Full vigorous kick when running (power >= 1.15); smoothly scales down to ~40% (60% less) for gentle walking
    const walkScale = power >= 1.15 ? 1 : 0.4 + 0.6 * Math.max(0, (power - 0.4) / 0.75);
    const alphaScale = 0.42 + 0.58 * walkScale;
    const sizeScale = 0.78 + 0.22 * walkScale;
    normalizeOrFallback(normal, 0, 1, 0, nrm);
    normalizeOrFallback(moveDirVec, 0, 0, 1, fwd);
    buildTangentBasis(nrm, fwd, t1, t2);

    // 1) Ground-skimming shear clouds (radial + backward/sideways wake, visible in helmet cam)
    const shearCount = Math.max(1, Math.round((3 + power * 2.5) * walkScale));
    for (let i = 0; i < shearCount; i++) {
      const angle = randRange(-Math.PI, Math.PI);
      // Bias wake slightly backward & sideways from boot sole so camera sees edge curls
      const dirT1 = Math.cos(angle) * 0.85 - 0.35;
      const dirT2 = Math.sin(angle);
      spawnPuff({
        pos,
        normal: nrm,
        dirX: dirT1,
        dirZ: dirT2,
        lateralSpread: 0,
        upSpeed: randRange(0.16, 0.42) * power * sizeScale,
        horizSpeed: randRange(0.45, 1.15) * power,
        startSize: randRange(0.18, 0.28) * (0.85 + 0.25 * power) * sizeScale,
        endSize: randRange(0.58, 1.05) * (0.85 + 0.3 * power) * sizeScale,
        life: randRange(0.75, 1.3),
        peakAlpha: randRange(0.34, 0.56) * Math.min(1.2, 0.72 + power * 0.34) * alphaScale,
        drag: randRange(2.4, 3.6),
        buoyancy: randRange(0.06, 0.16),
        cellIndex: pick(GROUND_SHEAR_CELLS),
        brightness: randRange(0.92, 1.08),
        spawnOffsetT1: dirT1 * 0.12,
        spawnOffsetT2: dirT2 * 0.12,
        spawnOffsetN: randRange(0.05, 0.11),
      });
    }

    // 2) Swirling rising billows trailing in the step wake
    const plumeCount = Math.max(1, Math.round((2 + power * 1.5) * walkScale));
    for (let i = 0; i < plumeCount; i++) {
      const side = randRange(-0.9, 0.9);
      const back = randRange(-0.85, 0.35);
      spawnPuff({
        pos,
        normal: nrm,
        dirX: back,
        dirZ: side,
        lateralSpread: 0,
        upSpeed: randRange(0.38, 0.72) * power * sizeScale,
        horizSpeed: randRange(0.22, 0.58) * power,
        startSize: randRange(0.16, 0.25) * sizeScale,
        endSize: randRange(0.54, 0.92) * (0.85 + 0.25 * power) * sizeScale,
        life: randRange(0.95, 1.6),
        peakAlpha: randRange(0.28, 0.46) * Math.min(1.2, 0.7 + power * 0.32) * alphaScale,
        drag: randRange(1.7, 2.5),
        buoyancy: randRange(0.11, 0.22),
        cellIndex: pick(BILLOW_PLUME_CELLS),
        brightness: randRange(0.95, 1.1),
        spawnOffsetT1: randRange(-0.08, 0.08),
        spawnOffsetT2: randRange(-0.1, 0.1),
        spawnOffsetN: randRange(0.08, 0.16),
      });
    }

    // 3) Ballistic regolith sand/gravel flecks following 3.71 m/s^2 gravity
    const grainCount = Math.max(4, Math.round((12 + power * 9) * walkScale));
    for (let i = 0; i < grainCount; i++) {
      const ang = randRange(-Math.PI, Math.PI);
      spawnGrain({
        pos,
        normal: nrm,
        tangentA: Math.cos(ang) - 0.25,
        tangentB: Math.sin(ang),
        radialSpeed: randRange(0.65, 1.9) * power,
        upSpeed: randRange(0.75, 1.85) * power,
        life: randRange(0.45, 0.95),
        size: randRange(0.45, 0.95),
      });
    }
  }

  /**
   * Emit dramatic radial Martian dust ring + plume + regolith spray on jump landing.
   */
  function emitLanding(pos, normal, impactSpeed = 3.5, moveDirVec = null) {
    if (!pos) return;
    const strength = Math.max(0.75, Math.min(2.6, impactSpeed / 3.2));
    normalizeOrFallback(normal, 0, 1, 0, nrm);
    normalizeOrFallback(moveDirVec, 0, 0, 1, fwd);
    buildTangentBasis(nrm, fwd, t1, t2);

    // 360-degree radial blast ring (10-16 ground puffs)
    const ringCount = Math.round(10 + strength * 4);
    for (let i = 0; i < ringCount; i++) {
      const baseAngle = (i / ringCount) * Math.PI * 2 + randRange(-0.18, 0.18);
      const ca = Math.cos(baseAngle);
      const sa = Math.sin(baseAngle);
      spawnPuff({
        pos,
        normal: nrm,
        dirX: ca,
        dirZ: sa,
        lateralSpread: 0,
        upSpeed: randRange(0.18, 0.55) * strength,
        horizSpeed: randRange(0.95, 2.05) * strength,
        startSize: randRange(0.24, 0.36) * (0.9 + 0.18 * strength),
        endSize: randRange(0.82, 1.48) * (0.85 + 0.22 * strength),
        life: randRange(0.95, 1.65),
        peakAlpha: randRange(0.42, 0.68) * Math.min(1.15, 0.78 + strength * 0.2),
        drag: randRange(2.1, 3.2),
        buoyancy: randRange(0.08, 0.19),
        cellIndex: i % 2 === 0 ? pick(GROUND_SHEAR_CELLS) : pick(IMPACT_BURST_CELLS),
        brightness: randRange(0.9, 1.12),
        spawnOffsetT1: ca * 0.2,
        spawnOffsetT2: sa * 0.2,
        spawnOffsetN: randRange(0.06, 0.14),
      });
    }

    // Central rising mushrooming billows (4-6 clouds)
    const centerCount = Math.round(4 + strength * 1.5);
    for (let i = 0; i < centerCount; i++) {
      const ca = randRange(-0.6, 0.6);
      const sa = randRange(-0.6, 0.6);
      spawnPuff({
        pos,
        normal: nrm,
        dirX: ca,
        dirZ: sa,
        lateralSpread: 0,
        upSpeed: randRange(0.55, 1.15) * strength,
        horizSpeed: randRange(0.2, 0.65) * strength,
        startSize: randRange(0.28, 0.42),
        endSize: randRange(0.9, 1.55) * (0.85 + 0.2 * strength),
        life: randRange(1.15, 1.85),
        peakAlpha: randRange(0.36, 0.54),
        drag: randRange(1.6, 2.3),
        buoyancy: randRange(0.14, 0.26),
        cellIndex: pick(BILLOW_PLUME_CELLS),
        brightness: randRange(0.96, 1.12),
        spawnOffsetT1: randRange(-0.15, 0.15),
        spawnOffsetT2: randRange(-0.15, 0.15),
        spawnOffsetN: randRange(0.1, 0.22),
      });
    }

    // High-count ballistic sand & pebble spray
    const grainCount = Math.round(28 + strength * 14);
    for (let i = 0; i < grainCount; i++) {
      const ang = randRange(-Math.PI, Math.PI);
      spawnGrain({
        pos,
        normal: nrm,
        tangentA: Math.cos(ang),
        tangentB: Math.sin(ang),
        radialSpeed: randRange(0.9, 2.9) * strength,
        upSpeed: randRange(1.1, 2.8) * strength,
        life: randRange(0.55, 1.25),
        size: randRange(0.55, 1.15),
      });
    }
  }

  /**
   * Emit subtle backward/outward push-off kick on jump takeoff.
   */
  function emitTakeoff(pos, normal, moveDirVec = null) {
    if (!pos) return;
    normalizeOrFallback(normal, 0, 1, 0, nrm);
    normalizeOrFallback(moveDirVec, 0, 0, 1, fwd);
    buildTangentBasis(nrm, fwd, t1, t2);

    for (let i = 0; i < 4; i++) {
      const ang = randRange(-Math.PI, Math.PI);
      spawnPuff({
        pos,
        normal: nrm,
        dirX: Math.cos(ang) * 0.7 - 0.35,
        dirZ: Math.sin(ang) * 0.8,
        lateralSpread: 0,
        upSpeed: randRange(0.25, 0.52),
        horizSpeed: randRange(0.55, 1.05),
        startSize: randRange(0.18, 0.26),
        endSize: randRange(0.62, 0.98),
        life: randRange(0.75, 1.2),
        peakAlpha: randRange(0.32, 0.48),
        drag: 2.5,
        buoyancy: 0.12,
        cellIndex: pick(GROUND_SHEAR_CELLS),
        brightness: randRange(0.94, 1.06),
        spawnOffsetN: 0.06,
      });
    }

    for (let i = 0; i < 14; i++) {
      const ang = randRange(-Math.PI, Math.PI);
      spawnGrain({
        pos,
        normal: nrm,
        tangentA: Math.cos(ang) - 0.35,
        tangentB: Math.sin(ang),
        radialSpeed: randRange(0.8, 1.9),
        upSpeed: randRange(0.7, 1.65),
        life: randRange(0.45, 0.9),
        size: randRange(0.45, 0.9),
      });
    }
  }

  function shiftOrigin(dx, dy, dz) {
    for (let i = 0; i < MAX_PUFFS; i++) {
      const p = puffs[i];
      if (!p.alive) continue;
      p.x += dx;
      p.y += dy;
      p.z += dz;
    }
    for (let i = 0; i < MAX_GRAINS; i++) {
      const g = grains[i];
      if (!g.alive) continue;
      g.x += dx;
      g.y += dy;
      g.z += dz;
      g.gx += dx;
      g.gy += dy;
      g.gz += dz;
    }
  }

  function clear() {
    for (let i = 0; i < MAX_PUFFS; i++) puffs[i].alive = false;
    for (let i = 0; i < MAX_GRAINS; i++) grains[i].alive = false;
    puffGeom.setDrawRange(0, 0);
    grainGeom.setDrawRange(0, 0);
  }

  function update(dt, camera, sunVisibility = 1.0) {
    const safeDt = Math.min(0.05, Math.max(0.0001, dt));
    if (camera) {
      camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
      camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
      puffUniforms.uCamRight.value.copy(camRight);
      puffUniforms.uCamUp.value.copy(camUp);
    }
    const sunMix = Math.max(0.15, Math.min(1.0, sunVisibility));
    puffUniforms.uSunLight.value = sunMix;
    grainMat.uniforms.uSunLight.value = sunMix;
    if (horizonColor) {
      puffUniforms.uHorizon.value.copy(horizonColor);
      grainMat.uniforms.uHorizon.value.copy(horizonColor);
    }

    let activePuffs = 0;
    for (let i = 0; i < MAX_PUFFS; i++) {
      const p = puffs[i];
      if (!p.alive) continue;
      if (!stepDustPuff(p, safeDt)) continue;
      const vBase = activePuffs * 4;
      const uvs = [
        [p.u0, p.v0],
        [p.u1, p.v0],
        [p.u1, p.v1],
        [p.u0, p.v1],
      ];
      for (let c = 0; c < 4; c++) {
        const vi = vBase + c;
        puffPositions[vi * 3 + 0] = p.x;
        puffPositions[vi * 3 + 1] = p.y;
        puffPositions[vi * 3 + 2] = p.z;
        puffUv[vi * 2 + 0] = uvs[c][0];
        puffUv[vi * 2 + 1] = uvs[c][1];
        puffParams[vi * 3 + 0] = p.size;
        puffParams[vi * 3 + 1] = p.rot;
        puffParams[vi * 3 + 2] = p.alpha;
        puffColors[vi * 3 + 0] = p.r;
        puffColors[vi * 3 + 1] = p.g;
        puffColors[vi * 3 + 2] = p.b;
      }
      activePuffs++;
    }
    puffGeom.setDrawRange(0, activePuffs * 6);
    if (activePuffs > 0) {
      posAttr.needsUpdate = true;
      uvAttr.needsUpdate = true;
      paramAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;
    }

    let activeGrains = 0;
    for (let i = 0; i < MAX_GRAINS; i++) {
      const g = grains[i];
      if (!g.alive) continue;
      if (!stepDustGrain(g, safeDt, marsG)) continue;
      grainPositions[activeGrains * 3 + 0] = g.x;
      grainPositions[activeGrains * 3 + 1] = g.y;
      grainPositions[activeGrains * 3 + 2] = g.z;
      grainColors[activeGrains * 4 + 0] = g.r;
      grainColors[activeGrains * 4 + 1] = g.g;
      grainColors[activeGrains * 4 + 2] = g.b;
      grainColors[activeGrains * 4 + 3] = g.alpha;
      grainSizes[activeGrains] = g.size;
      activeGrains++;
    }
    grainGeom.setDrawRange(0, activeGrains);
    if (activeGrains > 0) {
      gPosAttr.needsUpdate = true;
      gColAttr.needsUpdate = true;
      gSizeAttr.needsUpdate = true;
    }
  }

  function getActiveCounts() {
    let pCount = 0;
    for (let i = 0; i < MAX_PUFFS; i++) if (puffs[i].alive) pCount++;
    let gCount = 0;
    for (let i = 0; i < MAX_GRAINS; i++) if (grains[i].alive) gCount++;
    return { puffs: pCount, grains: gCount };
  }

  function dispose() {
    scene.remove(puffMesh);
    scene.remove(grainPoints);
    puffGeom.dispose();
    puffMat.dispose();
    grainGeom.dispose();
    grainMat.dispose();
    if (fallbackTex) fallbackTex.dispose();
    if (puffUniforms.uMap.value && puffUniforms.uMap.value !== fallbackTex) {
      puffUniforms.uMap.value.dispose();
    }
  }

  return {
    emitFootstep,
    emitLanding,
    emitTakeoff,
    shiftOrigin,
    clear,
    update,
    getActiveCounts,
    dispose,
    get atlasLoaded() {
      return atlasLoaded;
    },
  };
}
