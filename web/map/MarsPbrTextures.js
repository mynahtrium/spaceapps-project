/**
 * Procedural 100%-Offline Martian PBR Surface Texture Synthesizer (`MarsPbrTextures`).
 *
 * Generates seamless tileable RGBA diffuse albedo + tangent normal + roughness maps
 * directly in memory using periodic fBm + periodic Voronoi rock fractures (zero external files,
 * zero API keys, zero copyright risk):
 * - Material 1 (Regolith & Sand): Aeolian wind ripples, dark mafic basalt grains, ochre dust,
 *   scattered mineral pebbles, ripple-crest highlight normals.
 * - Material 2 (Gale Mudstone & Fractured Bedrock): Cellular Voronoi mudstone slabs,
 *   dark crevice ambient occlusion, layered bedding strata, pale sulfate veins, blocky normals.
 */

function hash2(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function periodicValueNoise(u, v, freq, seed = 0) {
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

  const a = hash2(wx0, wy0, seed);
  const b = hash2(wx1, wy0, seed);
  const c = hash2(wx0, wy1, seed);
  const d = hash2(wx1, wy1, seed);
  const top = a + (b - a) * sx;
  const bot = c + (d - c) * sx;
  return top + (bot - top) * sy;
}

function periodicFbm(u, v, baseFreq, octaves = 4, seed = 0) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = baseFreq;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicValueNoise(u, v, freq, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * Tileable periodic Voronoi F2 - F1 distance (gives sharp rock polygon boundaries & slab cracks).
 */
function periodicVoronoiEdge(u, v, cells, seed = 0) {
  const x = u * cells;
  const y = v * cells;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let d1Sq = 99;
  let d2Sq = 99;
  let cellGx = 0;
  let cellGy = 0;

  for (let dy = -1; dy <= 1; dy++) {
    const gy = (((iy + dy) % cells) + cells) % cells;
    for (let dx = -1; dx <= 1; dx++) {
      const gx = (((ix + dx) % cells) + cells) % cells;
      const ox = hash2(gx, gy, seed);
      const oy = hash2(gx, gy, seed + 137);
      const vx = ix + dx + 0.15 + ox * 0.7 - x;
      const vy = iy + dy + 0.15 + oy * 0.7 - y;
      const distSq = vx * vx + vy * vy;
      if (distSq < d1Sq) {
        d2Sq = d1Sq;
        d1Sq = distSq;
        cellGx = gx;
        cellGy = gy;
      } else if (distSq < d2Sq) {
        d2Sq = distSq;
      }
    }
  }
  const d1 = Math.sqrt(d1Sq);
  const d2 = Math.sqrt(d2Sq);
  return { edge: d2 - d1, d1, cellId: hash2(cellGx, cellGy, seed + 99) };
}

function buildNormalFromHeight(heights, size, strength, roughnessFn) {
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
      const idx = (y * size + x) * 4;
      rgba[idx] = Math.round(((-dx * inv) * 0.5 + 0.5) * 255);
      rgba[idx + 1] = Math.round(((-dy * inv) * 0.5 + 0.5) * 255);
      rgba[idx + 2] = Math.round(((1 * inv) * 0.5 + 0.5) * 255);
      rgba[idx + 3] = Math.max(30, Math.min(250, Math.round(roughnessFn(heights[y * size + x]))));
    }
  }
  return rgba;
}

function makeRepeatDataTex(THREE, rgba, size, srgb = false) {
  const tex = new THREE.DataTexture(rgba, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  if (srgb && THREE.SRGBColorSpace) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Create full Martian PBR texture sets (Albedo + Normal/Roughness) for dust ripples & fractured mudstone.
 * @param {typeof import('three')} THREE
 * @param {number} [size=256]
 */
export function createMartianPbrTextureSets(THREE, size = 256) {
  const dustH = new Float32Array(size * size);
  const dustAlbedo = new Uint8Array(size * size * 4);

  const rockH = new Float32Array(size * size);
  const rockAlbedo = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;
      const p = i * 4;

      // --- 1. Aeolian Wind-Rippled Martian Regolith + Pebbles ---
      const macroDust = periodicFbm(u, v, 4, 4, 11);
      const warp = periodicFbm(u, v, 8, 3, 27) * 0.16;
      const phase = ((u * 14 + v * 3 + warp * 10) % 1 + 1) % 1;
      // Asymmetric wind ripple crest (steep lee face, gentle stoss slope)
      const ripple = phase < 0.72 ? phase / 0.72 : (1 - phase) / 0.28;
      const pebbleNoise = periodicValueNoise(u, v, 64, 41);
      const fineGrit = periodicValueNoise(u, v, 128, 73);
      const pebbleBump = pebbleNoise > 0.76 ? (pebbleNoise - 0.76) * 2.8 : 0;

      const dHeight = ripple * 0.48 + macroDust * 0.34 + pebbleBump * 0.42 + fineGrit * 0.14;
      dustH[i] = dHeight;

      // Color: bright dusty ripple crests, dark basaltic sand troughs, pale clasts & dark mafic gravel
      const troughDark = Math.pow(1 - ripple, 1.4) * 0.32;
      let rD = 182 - troughDark * 78 + (macroDust - 0.5) * 48;
      let gD = 109 - troughDark * 52 + (macroDust - 0.5) * 28;
      let bD = 72 - troughDark * 34 + (macroDust - 0.5) * 18;
      if (pebbleNoise > 0.78) {
        // Pale sulfate clast pebble vs dark basalt cobble
        const brightClast = fineGrit > 0.52;
        if (brightClast) {
          rD += 38;
          gD += 34;
          bD += 26;
        } else {
          rD *= 0.62;
          gD *= 0.60;
          bD *= 0.62;
        }
      } else {
        rD += (fineGrit - 0.5) * 22;
        gD += (fineGrit - 0.5) * 16;
        bD += (fineGrit - 0.5) * 12;
      }

      dustAlbedo[p] = Math.max(15, Math.min(248, Math.round(rD)));
      dustAlbedo[p + 1] = Math.max(12, Math.min(235, Math.round(gD)));
      dustAlbedo[p + 2] = Math.max(10, Math.min(220, Math.round(bD)));
      dustAlbedo[p + 3] = 255;

      // --- 2. Fractured Layered Gale Mudstone + Mineral Veins ---
      const warpU = u + (periodicFbm(u, v, 6, 3, 5) - 0.5) * 0.05;
      const warpV = v + (periodicFbm(u, v, 6, 3, 9) - 0.5) * 0.05;
      const slabs = periodicVoronoiEdge(warpU, warpV, 8, 101);
      const subCracks = periodicVoronoiEdge(warpU, warpV, 18, 203);

      const crack = Math.min(1, slabs.edge / 0.085);
      const subCrack = Math.min(1, subCracks.edge / 0.055);
      const bedding = Math.sin((v * 16 + periodicFbm(u, v, 8, 3, 33) * 4.2) * Math.PI * 2) * 0.5 + 0.5;
      const pit = periodicValueNoise(u, v, 64, 88);
      const pitGrit = periodicValueNoise(u, v, 128, 117);

      const rHeight =
        crack * 0.55 +
        subCrack * 0.22 +
        bedding * 0.22 +
        (slabs.cellId - 0.5) * 0.14 +
        pit * 0.16 +
        pitGrit * 0.08;
      rockH[i] = rHeight;

      // Slab tint + pale gypsum/sulfate vein seams along fractures + deep dark crevice AO
      const veinMask = slabs.edge > 0.018 && slabs.edge < 0.042 && slabs.cellId > 0.58 ? 1 : 0;
      const ao = 0.25 + 0.75 * Math.min(crack, 0.35 + 0.65 * subCrack);
      const bedTint = bedding * 36 + (slabs.cellId - 0.5) * 30;
      let rR = (132 + bedTint + (pit - 0.5) * 28) * ao;
      let gR = (84 + bedTint * 0.68 + (pit - 0.5) * 20) * ao;
      let bR = (63 + bedTint * 0.5 + (pit - 0.5) * 16) * ao;
      if (veinMask) {
        rR = rR * 0.35 + 214 * 0.65;
        gR = gR * 0.35 + 195 * 0.65;
        bR = bR * 0.35 + 168 * 0.65;
      }

      rockAlbedo[p] = Math.max(12, Math.min(248, Math.round(rR)));
      rockAlbedo[p + 1] = Math.max(10, Math.min(238, Math.round(gR)));
      rockAlbedo[p + 2] = Math.max(8, Math.min(228, Math.round(bR)));
      rockAlbedo[p + 3] = 255;
    }
  }

  const dustNormalRgba = buildNormalFromHeight(dustH, size, 4.2, (h) => 220 - h * 40);
  const rockNormalRgba = buildNormalFromHeight(rockH, size, 5.4, (h) => 195 - h * 65);

  return {
    dustAlbedoTex: makeRepeatDataTex(THREE, dustAlbedo, size, false),
    dustNormalTex: makeRepeatDataTex(THREE, dustNormalRgba, size, false),
    rockAlbedoTex: makeRepeatDataTex(THREE, rockAlbedo, size, false),
    rockNormalTex: makeRepeatDataTex(THREE, rockNormalRgba, size, false),
  };
}
