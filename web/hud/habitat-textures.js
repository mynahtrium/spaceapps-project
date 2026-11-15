/**
 * Procedural canvas textures for the Mars Habitat Station (`web/hud/habitat-textures.js`).
 *
 * Everything is drawn at load time on <canvas> (no image files, nothing fetched, so `?demo=1`
 * stays offline). In Node (the test runner) there is no `document`, so every maker returns null
 * and the materials simply render without a map.
 */

import seedrandom from "seedrandom";
import { createNoise2D } from "simplex-noise";
// three/addons/loaders/KTX2Loader.js
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

function rng(seed) {
  return seedrandom(String(seed));
}

function noise2DForSeed(seed) {
  return createNoise2D(seedrandom(`habitat-noise:${seed}`));
}

export function createHabitatKtx2Loader(renderer = null, transcoderPath = "./vendor/basis/") {
  if (typeof document === "undefined" || !renderer) return null;
  try {
    const loader = new KTX2Loader();
    loader.setTranscoderPath(transcoderPath);
    if (typeof loader.detectSupport === "function") {
      loader.detectSupport(renderer);
    }
    return loader;
  } catch {
    return null;
  }
}

export function loadHabitatKtx2OrFallback(loader, url, fallbackTexture, onReady = null) {
  if (!loader || !url || typeof document === "undefined") {
    onReady?.(fallbackTexture);
    return fallbackTexture;
  }
  try {
    loader.load(
      url,
      (ktxTex) => {
        if (fallbackTexture) {
          ktxTex.wrapS = fallbackTexture.wrapS;
          ktxTex.wrapT = fallbackTexture.wrapT;
          ktxTex.repeat.copy(fallbackTexture.repeat);
          ktxTex.colorSpace = fallbackTexture.colorSpace;
        }
        onReady?.(ktxTex);
      },
      undefined,
      () => onReady?.(fallbackTexture)
    );
  } catch {
    onReady?.(fallbackTexture);
  }
  return fallbackTexture;
}

function canvasTexture(THREE, w, h, draw, { repeat = true, srgb = true } = {}) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = 8;
  return t;
}

function speckle(g, w, h, r, n, dark, light) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = r() < 0.5 ? dark : light;
    g.fillRect(r() * w, r() * h, 1 + r() * 1.5, 1 + r() * 1.5);
  }
}

/** White / light-grey composite hull plating with panel seams and rivets (512 px = 4 m). */
function hullTexture(THREE) {
  return canvasTexture(THREE, 512, 512, (g, w, h) => {
    const r = rng(11);
    g.fillStyle = "#d8dce1";
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, r, 9000, "rgba(120,128,138,0.10)", "rgba(255,255,255,0.18)");
    // rows of panels: 1 m tall rows (128 px), panel widths 1.5-2 m, staggered
    for (let row = 0; row < 4; row++) {
      const y = row * 128;
      let x = row % 2 ? -96 : 0;
      while (x < w) {
        const pw = r() < 0.5 ? 192 : 256;
        const tint = 216 + Math.floor(r() * 18) - 9;
        g.fillStyle = `rgb(${tint},${tint + 3},${tint + 7})`;
        g.fillRect(x + 3, y + 3, pw - 6, 122);
        // seam: dark groove plus a highlight lip
        g.fillStyle = "#8f979f";
        g.fillRect(x, y, pw, 2);
        g.fillRect(x, y, 2, 128);
        g.fillStyle = "rgba(255,255,255,0.65)";
        g.fillRect(x + 2, y + 2, pw - 2, 1);
        g.fillRect(x + 2, y + 2, 1, 126);
        // rivets along panel edges
        g.fillStyle = "#9aa2ab";
        for (let k = 12; k < pw - 6; k += 24) {
          g.beginPath();
          g.arc(x + k, y + 8, 1.6, 0, Math.PI * 2);
          g.arc(x + k, y + 120, 1.6, 0, Math.PI * 2);
          g.fill();
        }
        // occasional access hatch
        if (r() < 0.18) {
          g.strokeStyle = "#a5adb6";
          g.lineWidth = 2;
          g.strokeRect(x + pw * 0.3, y + 34, 46, 46);
        }
        x += pw;
      }
    }
    // faint dust settling towards the bottom of each row
    for (let row = 0; row < 4; row++) {
      const grad = g.createLinearGradient(0, row * 128 + 80, 0, row * 128 + 128);
      grad.addColorStop(0, "rgba(160,110,80,0)");
      grad.addColorStop(1, "rgba(160,110,80,0.07)");
      g.fillStyle = grad;
      g.fillRect(0, row * 128 + 80, w, 48);
    }
  });
}

/** Brushed-aluminium anti-slip diamond tread plate (256 px = 0.8 m). */
function diamondPlateTexture(THREE) {
  return canvasTexture(THREE, 256, 256, (g, w, h) => {
    const r = rng(23);
    g.fillStyle = "#8b929a";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? "255,255,255" : "40,44,50"},${0.05 + r() * 0.06})`;
      g.fillRect(0, r() * h, w, 1);
    }
    const step = 32;
    for (let yy = 0; yy < h; yy += step) {
      for (let xx = 0; xx < w; xx += step) {
        const flip = ((xx + yy) / step) % 2 === 0;
        g.save();
        g.translate(xx + step / 2, yy + step / 2);
        g.rotate(flip ? Math.PI / 4 : -Math.PI / 4);
        g.fillStyle = "#5f666e";
        g.fillRect(-11, -2, 22, 5);
        g.fillStyle = "#c3c9cf";
        g.fillRect(-11, -3, 22, 3);
        g.restore();
      }
    }
  });
}

/** Open steel floor grating over a dark service trench (256 px = 0.5 m). */
function grateTexture(THREE) {
  return canvasTexture(THREE, 256, 256, (g, w, h) => {
    g.fillStyle = "#1b1e22";
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      g.fillStyle = "#6f7780";
      g.fillRect(x, 0, 5, h);
      g.fillStyle = "#a0a8b1";
      g.fillRect(x, 0, 2, h);
    }
    for (let y = 0; y < h; y += 64) {
      g.fillStyle = "#7c858e";
      g.fillRect(0, y, w, 6);
      g.fillStyle = "#b2bac2";
      g.fillRect(0, y, w, 2);
    }
  });
}

/** Light composite floor tiles for the cafeteria and dormitory (512 px = 2 m). */
function compositeFloorTexture(THREE, base = "#b9b5ae") {
  return canvasTexture(THREE, 512, 512, (g, w, h) => {
    const r = rng(37);
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, r, 14000, "rgba(70,66,60,0.16)", "rgba(255,255,255,0.20)");
    g.strokeStyle = "rgba(60,58,54,0.55)";
    g.lineWidth = 2;
    for (let i = 0; i <= 2; i++) {
      g.beginPath();
      g.moveTo(i * 256, 0);
      g.lineTo(i * 256, h);
      g.moveTo(0, i * 256);
      g.lineTo(w, i * 256);
      g.stroke();
    }
  });
}

/** Horizontal brushed-steel streaks (256 px = 1 m). */
function brushedTexture(THREE) {
  return canvasTexture(THREE, 256, 256, (g, w, h) => {
    const r = rng(41);
    g.fillStyle = "#a9b0b8";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? "255,255,255" : "50,55,62"},${0.04 + r() * 0.08})`;
      g.fillRect(r() * w - 40, r() * h, 40 + r() * 160, 1);
    }
  });
}

/** Yellow-and-black hazard chevrons (256 px = 0.6 m). */
function hazardTexture(THREE) {
  return canvasTexture(THREE, 256, 256, (g, w, h) => {
    const r = rng(53);
    g.fillStyle = "#f0bd12";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#121212";
    for (let k = -h; k < w + h; k += 64) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k + 32, 0);
      g.lineTo(k + 32 + h, h);
      g.lineTo(k + h, h);
      g.closePath();
      g.fill();
    }
    speckle(g, w, h, r, 2400, "rgba(80,60,40,0.25)", "rgba(255,255,255,0.12)");
  });
}

/** Corrugated hangar-door slat (256 px = 1 m). */
function slatTexture(THREE) {
  return canvasTexture(THREE, 256, 256, (g, w, h) => {
    const r = rng(61);
    g.fillStyle = "#c9ced4";
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) {
      const grad = g.createLinearGradient(0, y, 0, y + 32);
      grad.addColorStop(0, "#e8ebee");
      grad.addColorStop(0.5, "#b4bac1");
      grad.addColorStop(1, "#8e959d");
      g.fillStyle = grad;
      g.fillRect(0, y, w, 32);
    }
    speckle(g, w, h, r, 3000, "rgba(140,90,60,0.10)", "rgba(255,255,255,0.12)");
  });
}

/** Dark-blue photovoltaic cell grid for the roof array (256 px = 1 m). */
function solarTexture(THREE) {
  return canvasTexture(THREE, 256, 256, (g, w, h) => {
    g.fillStyle = "#0d1a3a";
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) {
      for (let x = 0; x < w; x += 32) {
        const grad = g.createLinearGradient(x, y, x + 32, y + 32);
        grad.addColorStop(0, "#1d3b7a");
        grad.addColorStop(1, "#0a1630");
        g.fillStyle = grad;
        g.fillRect(x + 1, y + 1, 30, 30);
        g.fillStyle = "rgba(200,210,230,0.35)";
        g.fillRect(x + 1, y + 15, 30, 1);
      }
    }
  });
}

export function makeHabitatTextures(THREE) {
  return {
    hull: hullTexture(THREE),
    diamond: diamondPlateTexture(THREE),
    grate: grateTexture(THREE),
    composite: compositeFloorTexture(THREE),
    dormFloor: compositeFloorTexture(THREE, "#8f8aa0"),
    brushed: brushedTexture(THREE),
    hazard: hazardTexture(THREE),
    slat: slatTexture(THREE),
    solar: solarTexture(THREE),
  };
}

function drawSignOnCtx(g, ox, oy, w, h, lines, accentHex, bg = "#0b111b") {
  const list = Array.isArray(lines) ? lines : [lines];
  g.save();
  g.translate(ox, oy);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = accentHex;
  g.lineWidth = 8;
  g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = accentHex;
  g.fillRect(6, 6, 22, h - 12);
  g.textAlign = "center";
  g.textBaseline = "middle";
  const n = list.length;
  list.forEach((line, i) => {
    const size = i === 0 ? Math.floor(h * (n > 1 ? 0.3 : 0.42)) : Math.floor(h * 0.2);
    g.font = `bold ${size}px monospace`;
    g.fillStyle = i === 0 ? "#f8fafc" : "#94a3b8";
    g.fillText(line, w / 2 + 10, h * ((i + 0.5) / n) + (n > 1 ? (i === 0 ? 6 : -4) : 0));
  });
  g.restore();
}

/** A sign: light text on a dark plate with a coloured border (non-repeating). */
export function makeSignTexture(THREE, lines, accentHex, { w = 512, h = 160, bg = "#0b111b" } = {}) {
  return canvasTexture(THREE, w, h, (g) => drawSignOnCtx(g, 0, 0, w, h, lines, accentHex, bg), { repeat: false });
}

function drawFloorDecalOnCtx(g, ox, oy, w, h, text, colorHex) {
  g.save();
  g.translate(ox, oy);
  g.beginPath();
  g.rect(0, 0, w, h);
  g.clip();
  g.clearRect(0, 0, w, h);
  g.fillStyle = colorHex;
  g.globalAlpha = 0.85;
  g.font = `bold ${Math.round(h * 0.58)}px monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + 4);
  const r = rng(text.length * 97 + text.charCodeAt(text.length - 1));
  g.globalCompositeOperation = "destination-out";
  const sx = w / 512;
  const sy = h / 256;
  for (let i = 0; i < 650; i++) {
    g.globalAlpha = 0.25 + r() * 0.5;
    g.fillRect(r() * w, r() * h, (2 + r() * 6) * sx, (1 + r() * 2) * sy);
  }
  g.restore();
}

/** Painted floor marking (transparent background). */
export function makeFloorDecalTexture(THREE, text, colorHex) {
  return canvasTexture(THREE, 512, 256, (g, w, h) => drawFloorDecalOnCtx(g, 0, 0, w, h, text, colorHex), { repeat: false });
}

function drawTelemetryScreenOnCtx(g, ox, oy, destW, destH, spec, accentHex = "#f472b6") {
  const W = 768;
  const H = 432;
  g.save();
  g.translate(ox, oy);
  g.scale(destW / W, destH / H);
  g.beginPath();
  g.rect(0, 0, W, H);
  g.clip();
  const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#071425");
      bg.addColorStop(1, "#02060e");
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      // header
      g.fillStyle = accentHex;
      g.fillRect(0, 0, W, 52);
      g.fillStyle = "#03070f";
      g.font = "bold 28px monospace";
      g.textBaseline = "middle";
      g.textAlign = "left";
      g.fillText(spec.title, 18, 27);
      if (spec.tag) {
        g.textAlign = "right";
        g.font = "bold 18px monospace";
        g.fillText(spec.tag, W - 16, 27);
      }
      g.textAlign = "left";
      const top = 70;
      const bottom = H - 46;
      const left = 24;
      const right = W - 24;
      if (spec.kind === "graph") {
        g.strokeStyle = "rgba(148,163,184,0.25)";
        g.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
          const y = top + ((bottom - top) * i) / 4;
          g.beginPath();
          g.moveTo(left + 50, y);
          g.lineTo(right, y);
          g.stroke();
        }
        g.fillStyle = "#94a3b8";
        g.font = "15px monospace";
        (spec.yLabels || []).forEach((lab, i, arr) => {
          g.fillText(lab, left, top + ((bottom - top) * i) / Math.max(1, arr.length - 1));
        });
        for (const s of spec.series || []) {
          g.strokeStyle = s.color;
          g.lineWidth = 3;
          g.beginPath();
          for (let i = 0; i <= 120; i++) {
            const t = i / 120;
            const v = s.fn(t); // 0..1, 1 = top
            const x = left + 50 + (right - left - 50) * t;
            const y = bottom - (bottom - top) * v;
            if (i === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.stroke();
        }
        g.font = "bold 16px monospace";
        (spec.series || []).forEach((s, i) => {
          g.fillStyle = s.color;
          g.fillText(`■ ${s.label}`, left + 60 + i * 260, top + 14);
        });
      } else if (spec.kind === "bars") {
        const bars = spec.bars || [];
        const rowH = (bottom - top) / Math.max(1, bars.length);
        g.font = "bold 18px monospace";
        bars.forEach((b, i) => {
          const y = top + i * rowH + rowH * 0.2;
          g.fillStyle = "#cbd5e1";
          g.fillText(b.label, left, y + rowH * 0.3);
          g.fillStyle = "rgba(148,163,184,0.18)";
          g.fillRect(left + 270, y, right - left - 270, rowH * 0.55);
          g.fillStyle = b.color || accentHex;
          g.fillRect(left + 270, y, (right - left - 270) * b.v, rowH * 0.55);
          g.fillStyle = "#f8fafc";
          g.fillText(b.text || `${Math.round(b.v * 100)}%`, right - 110, y + rowH * 0.3);
        });
      } else if (spec.kind === "map") {
        const r = rng(91);
        const noise2D = noise2DForSeed(91);
        const cols = 48;
        const rows = 22;
        const cw = (right - left) / cols;
        const ch = (bottom - top) / rows;
        const field = (x, y) =>
          0.5 +
          0.32 * noise2D(x * 0.08, y * 0.08) +
          0.16 * noise2D(x * 0.2, y * 0.2);
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const v = Math.max(0, Math.min(1, field(x, y) + (r() - 0.5) * 0.06));
            g.fillStyle = `rgb(${Math.floor(60 + 160 * v)},${Math.floor(30 + 70 * v)},${Math.floor(20 + 30 * v)})`;
            g.fillRect(left + x * cw, top + y * ch, cw + 1, ch + 1);
          }
        }
        g.strokeStyle = "#38bdf8";
        g.lineWidth = 4;
        g.setLineDash([12, 8]);
        g.beginPath();
        const pts = [
          [0.08, 0.8],
          [0.22, 0.62],
          [0.4, 0.66],
          [0.55, 0.42],
          [0.72, 0.36],
          [0.88, 0.18],
        ];
        pts.forEach(([u, v], i) => {
          const x = left + (right - left) * u;
          const y = top + (bottom - top) * v;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        });
        g.stroke();
        g.setLineDash([]);
        pts.forEach(([u, v], i) => {
          g.fillStyle = i === 0 ? "#22c55e" : "#facc15";
          g.beginPath();
          g.arc(left + (right - left) * u, top + (bottom - top) * v, 7, 0, Math.PI * 2);
          g.fill();
        });
      } else if (spec.kind === "tasks") {
        // Split schematic: terrain + 3 route options on the left, interactive terminal summary on the right
        const mapW = 368;
        const mapH = bottom - top - 8;
        g.fillStyle = "rgba(3,10,20,0.88)";
        g.fillRect(left, top + 2, mapW, mapH);
        g.strokeStyle = "rgba(56,189,248,0.45)";
        g.lineWidth = 2;
        g.strokeRect(left, top + 2, mapW, mapH);
        // contour rings
        g.strokeStyle = "rgba(148,163,184,0.22)";
        g.lineWidth = 1.2;
        for (let r = 28; r <= 120; r += 26) {
          g.beginPath();
          g.ellipse(left + mapW * 0.52, top + mapH * 0.48, r * 1.15, r * 0.72, -0.35, 0, Math.PI * 2);
          g.stroke();
        }
        // 3 candidate routes: green (safe), cyan (balanced), amber (direct)
        const routes = [
          { color: "#22c55e", pts: [[0.18, 0.22], [0.16, 0.56], [0.36, 0.78], [0.8, 0.8]] },
          { color: "#38bdf8", pts: [[0.18, 0.22], [0.46, 0.44], [0.64, 0.66], [0.8, 0.8]] },
          { color: "#f59e0b", pts: [[0.18, 0.22], [0.58, 0.34], [0.8, 0.8]] },
        ];
        routes.forEach((rt) => {
          g.strokeStyle = rt.color;
          g.lineWidth = 4;
          g.beginPath();
          rt.pts.forEach(([u, v], i) => {
            const x = left + 12 + (mapW - 24) * u;
            const y = top + 12 + (mapH - 20) * v;
            if (i === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          });
          g.stroke();
        });
        // Hab + target markers
        g.fillStyle = "#38bdf8";
        g.fillRect(left + 12 + (mapW - 24) * 0.18 - 8, top + 12 + (mapH - 20) * 0.22 - 8, 16, 16);
        g.fillStyle = "#f43f5e";
        g.beginPath();
        g.arc(left + 12 + (mapW - 24) * 0.8, top + 12 + (mapH - 20) * 0.8, 9, 0, Math.PI * 2);
        g.fill();
        g.font = "bold 14px monospace";
        g.fillStyle = "#e2e8f0";
        g.fillText("HAB", left + 38, top + 28);
        g.fillText("ROVER ?", left + mapW - 92, top + mapH - 18);

        const rx = left + mapW + 24;
        g.fillStyle = "#67e8f9";
        g.font = "bold 24px monospace";
        g.fillText("MISSIONS · GÖREVLER", rx, top + 26);
        g.fillStyle = "#e2e8f0";
        g.font = "18px monospace";
        const rows = [
          "1. TARGET: 5 NASA ROVERS",
          "2. VEHICLE: MMSEV / CONCEPT",
          "3. PICK A/B/C SUITABLE ROUTE",
          "4. DRIVE FROM BAY & LOCATE",
        ];
        rows.forEach((ln, i) => g.fillText(ln, rx, top + 72 + i * 36));
        g.fillStyle = "rgba(34,211,238,0.18)";
        g.fillRect(rx, bottom - 56, right - rx, 42);
        g.strokeStyle = "#22d3ee";
        g.lineWidth = 2;
        g.strokeRect(rx, bottom - 56, right - rx, 42);
        g.fillStyle = "#cffafe";
        g.font = "bold 19px monospace";
        g.fillText("PRESS [E] / CLICK TO OPEN", rx + 16, bottom - 35);
      } else {
        g.font = "22px monospace";
        g.fillStyle = "#e2e8f0";
        (spec.lines || []).forEach((line, i) => {
          g.fillStyle = i === 0 ? "#f8fafc" : "#cbd5e1";
          g.fillText(line, left, top + 24 + i * 38);
        });
      }
      // footer: source / honesty label + interactive EVA Tasks affordance badge
      g.fillStyle = "rgba(15,23,42,0.9)";
      g.fillRect(0, H - 36, W, 36);
      g.fillStyle = "#94a3b8";
      g.font = "15px monospace";
      g.fillText(spec.footer || "", 16, H - 17);
      if (spec.kind !== "tasks") {
        const badge = "[E] / CLICK · EVA TASKS";
        g.save();
        g.font = "bold 12px monospace";
        const bw = Math.ceil(g.measureText(badge).width) + 16;
        const bx = W - bw - 10;
        const by = H - 29;
        g.fillStyle = "rgba(14,165,233,0.2)";
        g.fillRect(bx, by, bw, 22);
        g.strokeStyle = "rgba(56,189,248,0.72)";
        g.lineWidth = 1.5;
        g.strokeRect(bx + 0.5, by + 0.5, bw - 1, 21);
        g.fillStyle = "#7dd3fc";
        g.textBaseline = "middle";
        g.fillText(badge, bx + 8, by + 11);
        g.restore();
      }
      // scanlines
      g.fillStyle = "rgba(255,255,255,0.025)";
      for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
  g.restore();
}

export { drawSignOnCtx, drawFloorDecalOnCtx, drawTelemetryScreenOnCtx };

/**
 * Telemetry wall screens. `spec.kind` is one of "graph", "bars", "map", "text", "tasks".
 * `spec.footer` must carry the honesty note (source or "illustrative").
 */
export function makeTelemetryScreenTexture(THREE, spec, accentHex = "#f472b6") {
  return canvasTexture(THREE, 768, 432, (g, w, h) => drawTelemetryScreenOnCtx(g, 0, 0, w, h, spec, accentHex), { repeat: false });
}

/**
 * Dynamic shelf-packed canvas atlas so many signs/screens/decals share one texture and merge
 * into one draw call per zone. Works offline; in Node (no DOM) returns `texture: null` + valid UVs.
 */
export function createShelfAtlas(THREE, width = 2048, height = 1024, { pad = 4, bg = null } = {}) {
  const hasDom = typeof document !== "undefined";
  const canvas = hasDom ? document.createElement("canvas") : null;
  const g = canvas ? canvas.getContext("2d") : null;
  let texture = null;
  if (canvas) {
    canvas.width = width;
    canvas.height = height;
    if (bg) {
      g.fillStyle = bg;
      g.fillRect(0, 0, width, height);
    } else {
      g.clearRect(0, 0, width, height);
    }
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
  }
  let cx = pad;
  let cy = pad;
  let rowH = 0;
  function alloc(w, h, drawFn) {
    if (cx + w + pad > width) {
      cx = pad;
      cy += rowH + pad;
      rowH = 0;
    }
    if (cy + h + pad > height) {
      return null;
    }
    const px = cx;
    const py = cy;
    cx += w + pad;
    if (h > rowH) rowH = h;
    if (g && drawFn) drawFn(g, px, py, w, h);
    return {
      u0: (px + 1) / width,
      u1: (px + w - 1) / width,
      v0: 1 - (py + h - 1) / height,
      v1: 1 - (py + 1) / height,
    };
  }
  function finalize() {
    if (texture) texture.needsUpdate = true;
  }
  return { texture, alloc, finalize };
}

/** Remap a PlaneGeometry's [0,1] UVs into a packed atlas sub-rectangle. */
export function remapPlaneUV(geo, rect) {
  if (!rect) return geo;
  const uv = geo.attributes.uv;
  const du = rect.u1 - rect.u0;
  const dv = rect.v1 - rect.v0;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, rect.u0 + uv.getX(i) * du, rect.v0 + uv.getY(i) * dv);
  }
  uv.needsUpdate = true;
  return geo;
}
