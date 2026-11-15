/**
 * Low-poly, high-craft sculpted 3D model for the NASA Mars Rover Concept 6×6
 * (`web/hud/concept-rover-model.js`).
 *
 * Designed from the Parker Brothers / NASA Kennedy Space Center Mars Rover Concept
 * reference silhouette using custom indexed BufferGeometries (faceted stealth cab,
 * recessed trapezoidal chin viewport, sweeping brushed-silver chine fender rails,
 * 3-plane raked cyan cockpit glass with minimalist interior, dual roof brow intakes,
 * ribbed waist neck, octagonal beveled rear science lab, solar shoulders, pressure
 * tanks, and 6×6 crowned hollow airless wheels with radial louver vanes).
 *
 * Budget: ~4,800–5,600 triangles total across the full chassis + 6 wheels, with
 * synchronous Node-compatible geometry (CanvasTextures skipped cleanly when
 * `typeof document === "undefined"`).
 */

function makeCanvasTex(THREE, w, h, drawFn, { linear = false, repeatX = 1, repeatY = 1, wrap = false } = {}) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  drawFn(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (wrap || repeatX !== 1 || repeatY !== 1) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
  }
  return tex;
}

function drawNasaMeatball(g, cx, cy, r) {
  // Deep NASA blue sphere
  g.fillStyle = "#0b3d91";
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();

  // Subtle star specks inside sphere
  g.fillStyle = "rgba(255,255,255,0.85)";
  const stars = [
    [-0.52, -0.35],
    [-0.25, -0.58],
    [0.34, -0.48],
    [0.58, -0.15],
    [-0.45, 0.42],
    [0.42, 0.45],
  ];
  for (const [sx, sy] of stars) {
    g.fillRect(cx + sx * r, cy + sy * r, Math.max(1.5, r * 0.03), Math.max(1.5, r * 0.03));
  }

  // White orbital swoosh
  g.strokeStyle = "#f8fafc";
  g.lineWidth = Math.max(2, r * 0.055);
  g.beginPath();
  g.ellipse(cx, cy, r * 1.14, r * 0.36, -0.34, 0, Math.PI * 2);
  g.stroke();

  // Red vector chevron
  g.strokeStyle = "#fc3d21";
  g.lineWidth = Math.max(3, r * 0.105);
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(cx - r * 0.72, cy + r * 0.46);
  g.lineTo(cx + r * 0.04, cy - r * 0.74);
  g.lineTo(cx + r * 0.68, cy + r * 0.36);
  g.stroke();

  // Crisp NASA wordmark
  g.fillStyle = "#ffffff";
  g.font = `bold ${Math.round(r * 0.48)}px sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("NASA", cx, cy + r * 0.05);
}

function drawMonochromeUsFlag(g, fx, fy, fw, fh, starsOnRight = false) {
  g.fillStyle = "#f1f5f9";
  g.fillRect(fx, fy, fw, fh);

  // 13 alternating etched slate/silver stripes
  g.fillStyle = "#525c6b";
  for (let s = 0; s < 13; s += 2) {
    g.fillRect(fx, fy + s * (fh / 13), fw, fh / 13);
  }

  const cw = fw * 0.43;
  const ch = fh * (7 / 13);
  const cx = starsOnRight ? fx + fw - cw : fx;
  g.fillStyle = "#333d4b";
  g.fillRect(cx, fy, cw, ch);

  g.fillStyle = "#f8fafc";
  const rows = 4;
  const cols = 5;
  for (let sy = 0; sy < rows; sy++) {
    for (let sx = 0; sx < cols; sx++) {
      const px = cx + (sx + 0.65) * (cw / (cols + 0.3));
      const py = fy + (sy + 0.65) * (ch / (rows + 0.3));
      g.fillRect(px - 1, py - 1, 2.6, 2.6);
    }
  }

  g.strokeStyle = "#1e293b";
  g.lineWidth = 2.5;
  g.strokeRect(fx, fy, fw, fh);
}

function makeConceptTextures(THREE) {
  // 1. Brushed titanium-silver armor albedo, bump & roughness maps
  const silverMap = makeCanvasTex(
    THREE,
    512,
    512,
    (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#c8cfd8");
      grad.addColorStop(0.55, "#9ea7b4");
      grad.addColorStop(0.88, "#6f7783");
      grad.addColorStop(1, "#555c66");
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);

      // Subtle directional brushed aluminum grain
      for (let i = 0; i < 420; i++) {
        const y = (i * 79) % h;
        const x = (i * 137) % w;
        const len = 36 + (i % 90);
        g.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.06)";
        g.fillRect(x, y, len, 1.5);
      }

      // Clean aerospace panel seam lines + rivets
      g.strokeStyle = "rgba(22, 26, 33, 0.72)";
      g.lineWidth = 3;
      g.strokeRect(8, 8, w - 16, h - 16);
      for (const frac of [0.34, 0.68]) {
        g.beginPath();
        g.moveTo(w * frac, 8);
        g.lineTo(w * frac, h - 8);
        g.stroke();
      }
      g.beginPath();
      g.moveTo(8, h * 0.52);
      g.lineTo(w - 8, h * 0.52);
      g.stroke();

      g.fillStyle = "rgba(30, 36, 46, 0.65)";
      for (let rx = 24; rx < w - 16; rx += 32) {
        g.fillRect(rx, 14, 3, 3);
        g.fillRect(rx, h - 18, 3, 3);
      }

      // Light Martian ferric dust gradient near bottom rocker seam
      const dustGrad = g.createLinearGradient(0, h * 0.84, 0, h);
      dustGrad.addColorStop(0, "rgba(148, 78, 48, 0)");
      dustGrad.addColorStop(1, "rgba(148, 78, 48, 0.24)");
      g.fillStyle = dustGrad;
      g.fillRect(0, h * 0.84, w, h * 0.16);
    },
    { wrap: true }
  );

  const silverBump = makeCanvasTex(
    THREE,
    256,
    256,
    (g, w, h) => {
      g.fillStyle = "#808080";
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 240; i++) {
        g.fillStyle = i % 2 === 0 ? "#8a8a8a" : "#767676";
        g.fillRect((i * 53) % w, (i * 97) % h, 28 + (i % 40), 1);
      }
      g.strokeStyle = "#282828";
      g.lineWidth = 2.5;
      g.strokeRect(4, 4, w - 8, h - 8);
      for (const frac of [0.34, 0.68]) {
        g.beginPath();
        g.moveTo(w * frac, 4);
        g.lineTo(w * frac, h - 4);
        g.stroke();
      }
      g.fillStyle = "#b8b8b8";
      for (let rx = 12; rx < w - 8; rx += 16) {
        g.fillRect(rx, 7, 2, 2);
        g.fillRect(rx, h - 9, 2, 2);
      }
    },
    { linear: true, wrap: true }
  );

  // 2. Dark matte composite / carbon weave chassis texture
  const carbonMap = makeCanvasTex(
    THREE,
    256,
    256,
    (g, w, h) => {
      g.fillStyle = "#181b21";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#20242c";
      for (let y = 0; y < h; y += 8) {
        for (let x = 0; x < w; x += 8) {
          if (((x + y) / 8) % 2 === 0) g.fillRect(x, y, 4, 4);
        }
      }
      g.strokeStyle = "rgba(8, 10, 14, 0.75)";
      g.lineWidth = 3;
      g.strokeRect(6, 6, w - 12, h - 12);
    },
    { wrap: true, repeatX: 2, repeatY: 2 }
  );

  const carbonBump = makeCanvasTex(
    THREE,
    128,
    128,
    (g, w, h) => {
      g.fillStyle = "#808080";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#949494";
      for (let y = 0; y < h; y += 4) {
        for (let x = 0; x < w; x += 4) {
          if (((x + y) / 4) % 2 === 0) g.fillRect(x, y, 2, 2);
        }
      }
    },
    { linear: true, wrap: true, repeatX: 2, repeatY: 2 }
  );

  // 3. Cab side flank textures (left & right with forward-facing US flag + panel seams)
  const makeCabFlank = (starsOnRight) =>
    makeCanvasTex(THREE, 512, 256, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#cfd6df");
      grad.addColorStop(0.55, "#a3acb8");
      grad.addColorStop(1, "#6b7380");
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);

      for (let i = 0; i < 240; i++) {
        g.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.05)" : "rgba(15,23,42,0.05)";
        g.fillRect((i * 89) % w, (i * 43) % h, 44, 1.5);
      }

      // Door seam & vertical split line
      g.strokeStyle = "#222730";
      g.lineWidth = 3;
      g.strokeRect(6, 6, w - 12, h - 12);
      const splitX = starsOnRight ? w * 0.36 : w * 0.64;
      g.beginPath();
      g.moveTo(splitX, 8);
      g.lineTo(splitX, h - 8);
      g.stroke();

      // Etched monochrome US Flag centered on forward half of cab door
      const fw = 124;
      const fh = 72;
      const fx = starsOnRight ? w * 0.5 - 24 : w * 0.5 - fw + 24;
      const fy = 44;
      drawMonochromeUsFlag(g, fx, fy, fw, fh, starsOnRight);

      // Lower Martian dust smudge
      const dust = g.createLinearGradient(0, h * 0.78, 0, h);
      dust.addColorStop(0, "rgba(152, 82, 50, 0)");
      dust.addColorStop(1, "rgba(152, 82, 50, 0.25)");
      g.fillStyle = dust;
      g.fillRect(0, h * 0.78, w, h * 0.22);
    });

  const cabFlankLeftMap = makeCabFlank(false);
  const cabFlankRightMap = makeCabFlank(true);

  // 4. NASA Meatball circular medallion texture (hood & rear lab flank)
  const nasaBadgeMap = makeCanvasTex(THREE, 256, 256, (g, w, h) => {
    g.fillStyle = "#22262e";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#cbd5e1";
    g.lineWidth = 10;
    g.beginPath();
    g.arc(128, 128, 114, 0, Math.PI * 2);
    g.stroke();
    drawNasaMeatball(g, 128, 128, 96);
  });

  // 5. 6-Cell (2x3) recessed louver grille texture
  const louverMap = makeCanvasTex(THREE, 256, 160, (g, w, h) => {
    g.fillStyle = "#111419";
    g.fillRect(0, 0, w, h);
    const cols = 3;
    const rows = 2;
    const pad = 10;
    const cw = (w - pad * 2) / cols;
    const ch = (h - pad * 2) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c0 = 0; c0 < cols; c0++) {
        const x = pad + c0 * cw;
        const y = pad + r * ch;
        g.fillStyle = "#080a0e";
        g.fillRect(x + 4, y + 4, cw - 8, ch - 8);
        g.strokeStyle = "#dce2ea";
        g.lineWidth = 4;
        g.strokeRect(x + 3, y + 3, cw - 6, ch - 6);
        g.fillStyle = "#2d333d";
        for (let sl = y + 14; sl < y + ch - 10; sl += 12) {
          g.fillRect(x + 9, sl, cw - 18, 4);
        }
      }
    }
  });

  // 6. Perforated hexagonal honeycomb grille (rear lab forward shoulder + rear corner cutouts)
  const hexGrilleMap = makeCanvasTex(THREE, 256, 256, (g, w, h) => {
    g.fillStyle = "#484f5b";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#080a0e";
    const r = 10;
    const dx = r * 1.75;
    const dy = r * 1.55;
    for (let row = 0; row * dy < h + r; row++) {
      for (let col = 0; col * dx < w + r; col++) {
        const cx = col * dx + (row & 1 ? dx * 0.5 : 0);
        const cy = row * dy;
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
          const px = cx + Math.cos(a) * (r * 0.78);
          const py = cy + Math.sin(a) * (r * 0.78);
          if (k === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.fill();
      }
    }
    g.strokeStyle = "#cbd5e1";
    g.lineWidth = 8;
    g.strokeRect(4, 4, w - 8, h - 8);
  });

  // 7. Photovoltaic solar cell array
  const solarMap = makeCanvasTex(THREE, 256, 256, (g, w, h) => {
    g.fillStyle = "#0c1b36";
    g.fillRect(0, 0, w, h);
    const cols = 4;
    const rows = 6;
    const cw = w / cols;
    const ch = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c0 = 0; c0 < cols; c0++) {
        const x = c0 * cw;
        const y = r * ch;
        g.fillStyle = (r + c0) % 2 === 0 ? "#122952" : "#0e2245";
        g.fillRect(x + 2, y + 2, cw - 4, ch - 4);
        g.strokeStyle = "rgba(148, 184, 232, 0.35)";
        g.lineWidth = 1;
        g.strokeRect(x + 2, y + 2, cw - 4, ch - 4);
      }
    }
    g.strokeStyle = "#c8ccd4";
    g.lineWidth = 2.5;
    for (let x = 0; x <= w; x += cw) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    g.strokeStyle = "#c9a653";
    g.lineWidth = 1.5;
    for (let y = ch / 2; y < h; y += ch) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
  });

  // 8. Articulated waist accordion bellows
  const bellowsMap = makeCanvasTex(THREE, 128, 128, (g, w, h) => {
    g.fillStyle = "#16191f";
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 24) {
      const grad = g.createLinearGradient(x, 0, x + 24, 0);
      grad.addColorStop(0, "#0b0d11");
      grad.addColorStop(0.5, "#2b303a");
      grad.addColorStop(1, "#0b0d11");
      g.fillStyle = grad;
      g.fillRect(x, 0, 24, h);
    }
  });

  const bellowsBump = makeCanvasTex(
    THREE,
    128,
    128,
    (g, w, h) => {
      for (let x = 0; x < w; x += 24) {
        const grad = g.createLinearGradient(x, 0, x + 24, 0);
        grad.addColorStop(0, "#202020");
        grad.addColorStop(0.5, "#e0e0e0");
        grad.addColorStop(1, "#202020");
        g.fillStyle = grad;
        g.fillRect(x, 0, 24, h);
      }
    },
    { linear: true }
  );

  // 9. Concept Rover 3-slot side utility louver bar
  const utilityRailMap = makeCanvasTex(THREE, 256, 64, (g, w, h) => {
    g.fillStyle = "#262b33";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#cbd5e1";
    g.lineWidth = 3;
    g.strokeRect(3, 3, w - 6, h - 6);
    const slotW = 64;
    for (let i = 0; i < 3; i++) {
      const sx = 20 + i * 74;
      g.fillStyle = "#080a0e";
      g.fillRect(sx, 16, slotW, 32);
      g.strokeStyle = "#94a3b8";
      g.lineWidth = 2;
      g.strokeRect(sx, 16, slotW, 32);
    }
  });

  return {
    silverMap,
    silverBump,
    carbonMap,
    carbonBump,
    cabFlankLeftMap,
    cabFlankRightMap,
    nasaBadgeMap,
    louverMap,
    hexGrilleMap,
    solarMap,
    bellowsMap,
    bellowsBump,
    utilityRailMap,
  };
}

function makeConceptWheelTextures(THREE) {
  // 5 ribs per tile * repeatY(4) = 20 tread arches aligned 1:1 with 20 inner radial vanes.
  // Clear alpha gaps along the shoulders let daylight shine right through the open tread slots.
  const tireMap = makeCanvasTex(
    THREE,
    512,
    512,
    (g, w, h) => {
      g.clearRect(0, 0, w, h);
      const ribs = 5;
      const pitch = h / ribs; // 102.4 px

      // Continuous solid edge bead hoops (alpha = 255)
      g.fillStyle = "#16191f";
      g.fillRect(0, 0, 22, h);
      g.fillRect(w - 22, 0, 22, h);

      // Continuous center hex spine carrier (alpha = 255)
      g.fillStyle = "#14171c";
      g.fillRect(166, 0, 180, h);

      for (let i = 0; i < ribs; i++) {
        const y0 = i * pitch;
        const padH = pitch * 0.68;

        // Arched transverse tread rib across full width (leaving 32% daylight louver gap on shoulders)
        g.fillStyle = "#1e222a";
        g.fillRect(14, y0, w - 28, padH);

        // Beveled rib highlight edge
        g.fillStyle = "#2d333e";
        g.fillRect(16, y0 + 2, w - 32, 6);
        g.fillStyle = "#101217";
        g.fillRect(16, y0 + padH - 6, w - 32, 6);

        // Shoulder diagonal tread grooves
        g.fillStyle = "#12151a";
        for (const sx of [78, 124, 388, 434]) {
          g.fillRect(sx - 3, y0 + 10, 6, padH - 20);
        }

        // Signature silver chevron arrow accents along left & right tire shoulders
        g.fillStyle = "#cfd6df";
        for (const [cx, dir] of [
          [42, 1],
          [w - 42, -1],
        ]) {
          const cy = y0 + padH * 0.5;
          g.beginPath();
          g.moveTo(cx - dir * 10, cy - 11);
          g.lineTo(cx + dir * 10, cy);
          g.lineTo(cx - dir * 10, cy + 11);
          g.lineTo(cx - dir * 4, cy);
          g.closePath();
          g.fill();
        }
      }

      // Honeycomb hexagonal center grip pads along center crown
      const hexR = 13;
      for (let row = 0; row < 24; row++) {
        const cy = row * (h / 24) + 10;
        for (const bx of [194, 225, 256, 287, 318]) {
          const cx = bx + (row & 1 ? 8 : -8);
          g.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2;
            const px = cx + Math.cos(a) * hexR;
            const py = cy + Math.sin(a) * (hexR * 0.86);
            if (k === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
          }
          g.closePath();
          g.fillStyle = "#242932";
          g.fill();
          g.strokeStyle = "#3f4654";
          g.lineWidth = 2;
          g.stroke();
        }
      }

      // Subtle Martian regolith dust settled in recessed tread seams
      g.fillStyle = "rgba(154, 86, 52, 0.28)";
      for (let i = 0; i < ribs; i++) {
        g.fillRect(166, i * pitch + pitch * 0.74, 180, 7);
      }
    },
    { wrap: true, repeatX: 1, repeatY: 4 }
  );

  const tireBump = makeCanvasTex(
    THREE,
    256,
    256,
    (g, w, h) => {
      g.fillStyle = "#303030";
      g.fillRect(0, 0, w, h);
      const ribs = 5;
      const pitch = h / ribs;
      for (let i = 0; i < ribs; i++) {
        g.fillStyle = "#b8b8b8";
        g.fillRect(8, i * pitch + 2, w - 16, pitch * 0.64);
      }
      g.fillStyle = "#e0e0e0";
      for (let row = 0; row < 16; row++) {
        const cy = row * (h / 16) + 8;
        for (const bx of [96, 112, 128, 144, 160]) {
          g.beginPath();
          g.arc(bx + (row & 1 ? 4 : -4), cy, 5, 0, Math.PI * 2);
          g.fill();
        }
      }
    },
    { linear: true, wrap: true, repeatX: 1, repeatY: 4 }
  );

  // Machined brushed-silver beadlock rim ring texture with 24 recessed hex bolts/notches
  const rimRingMap = makeCanvasTex(THREE, 256, 256, (g, w, h) => {
    const cx = w * 0.5;
    const cy = h * 0.5;
    const grad = g.createRadialGradient(cx, cy, 48, cx, cy, 128);
    grad.addColorStop(0, "#7c8490");
    grad.addColorStop(0.25, "#e2e8f0");
    grad.addColorStop(0.7, "#cbd5e1");
    grad.addColorStop(1, "#64748b");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    // 24 machined beadlock perimeter bolts & radial scallops
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const bx = cx + Math.cos(a) * 102;
      const by = cy + Math.sin(a) * 102;
      g.fillStyle = "#1e293b";
      g.beginPath();
      g.arc(bx, by, 4.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#f8fafc";
      g.beginPath();
      g.arc(bx - 1, by - 1, 2.2, 0, Math.PI * 2);
      g.fill();
    }
  });

  return { tireMap, tireBump, rimRingMap };
}

// -----------------------------------------------------------------------------
// Low-poly indexed geometry helpers (guarantee outward winding & shared layouts)
// -----------------------------------------------------------------------------

function cross(ax, ay, az, bx, by, bz) {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

function normalize3(x, y, z) {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

function buildIndexedMeshFromArrays(THREE, pos, nrm, uv, idx) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  geom.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geom.setIndex(idx);
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

/**
 * Emits a planar quad `(p0, p1, p2, p3)` with automatic outward winding verified
 * against `outHint = [hx, hy, hz]`, storing flat per-face normals and matching UVs.
 */
function pushOrientedQuad(pos, nrm, uv, idx, p0, p1, p2, p3, outHint, uvs = [[0, 1], [1, 1], [1, 0], [0, 0]]) {
  const e1x = p1[0] - p0[0];
  const e1y = p1[1] - p0[1];
  const e1z = p1[2] - p0[2];
  const e2x = p2[0] - p0[0];
  const e2y = p2[1] - p0[1];
  const e2z = p2[2] - p0[2];
  let [nx, ny, nz] = cross(e1x, e1y, e1z, e2x, e2y, e2z);
  const dot = nx * outHint[0] + ny * outHint[1] + nz * outHint[2];
  let q = [p0, p1, p2, p3];
  let quv = uvs;
  if (dot < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
    q = [p0, p3, p2, p1];
    quv = [uvs[0], uvs[3], uvs[2], uvs[1]];
  }
  const [unx, uny, unz] = normalize3(nx, ny, nz);
  const base = pos.length / 3;
  for (let i = 0; i < 4; i++) {
    pos.push(q[i][0], q[i][1], q[i][2]);
    nrm.push(unx, uny, unz);
    uv.push(quv[i][0], quv[i][1]);
  }
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * Emits a triangle `(p0, p1, p2)` with automatic outward winding verified against `outHint`.
 */
function pushOrientedTri(pos, nrm, uv, idx, p0, p1, p2, outHint, uvs = [[0, 0], [1, 0], [0.5, 1]]) {
  let [nx, ny, nz] = cross(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2], p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
  const dot = nx * outHint[0] + ny * outHint[1] + nz * outHint[2];
  let tri = [p0, p1, p2];
  let tuv = uvs;
  if (dot < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
    tri = [p0, p2, p1];
    tuv = [uvs[0], uvs[2], uvs[1]];
  }
  const [unx, uny, unz] = normalize3(nx, ny, nz);
  const base = pos.length / 3;
  for (let i = 0; i < 3; i++) {
    pos.push(tri[i][0], tri[i][1], tri[i][2]);
    nrm.push(unx, uny, unz);
    uv.push(tuv[i][0], tuv[i][1]);
  }
  idx.push(base, base + 1, base + 2);
}

/**
 * Builds a watertight bilaterally-symmetric faceted hull from ordered Z-stations.
 * Each station supplies `{ z, half: [[x, y], ...] }` ordered from bottom-center (`x=0`)
 * up the `+X` flank to top-center (`x=0`).
 */
function createSculptedHullGeometry(THREE, stations, { capFront = true, capBack = true } = {}) {
  const pos = [];
  const nrm = [];
  const uv = [];
  const idx = [];

  const rings = stations.map((st) => {
    const h = st.half;
    const full = [];
    for (let i = 0; i < h.length; i++) full.push([h[i][0], h[i][1], st.z]);
    for (let i = h.length - 2; i >= 1; i--) full.push([-h[i][0], h[i][1], st.z]);
    return full;
  });

  const zMin = stations[0].z;
  const zSpan = Math.max(0.01, stations[stations.length - 1].z - zMin);
  const segCount = rings[0].length;

  for (let s = 0; s < rings.length - 1; s++) {
    const r0 = rings[s];
    const r1 = rings[s + 1];
    const u0 = (stations[s].z - zMin) / zSpan;
    const u1 = (stations[s + 1].z - zMin) / zSpan;
    for (let j = 0; j < segCount; j++) {
      const jn = (j + 1) % segCount;
      const a = r0[j];
      const b = r0[jn];
      const c = r1[jn];
      const d = r1[j];
      // Outward normal for CCW XY loop extruded along +Z is dRing x dZ
      const [nx, ny, nz] = cross(b[0] - a[0], b[1] - a[1], b[2] - a[2], d[0] - a[0], d[1] - a[1], d[2] - a[2]);
      const v0 = j / segCount;
      const v1 = (j + 1) / segCount;
      pushOrientedQuad(pos, nrm, uv, idx, a, b, c, d, [nx, ny, nz], [
        [u0, v0],
        [u0, v1],
        [u1, v1],
        [u1, v0],
      ]);
    }
  }

  const addCap = (ring, zSign) => {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const p of ring) {
      cx += p[0];
      cy += p[1];
      cz += p[2];
    }
    const n = ring.length;
    const center = [cx / n, cy / n, cz / n];
    for (let j = 0; j < n; j++) {
      const a = ring[j];
      const b = ring[(j + 1) % n];
      pushOrientedTri(pos, nrm, uv, idx, center, a, b, [0, 0, zSign], [
        [0.5, 0.5],
        [0.5 + a[0] * 0.3, 0.5 + (a[1] - center[1]) * 0.3],
        [0.5 + b[0] * 0.3, 0.5 + (b[1] - center[1]) * 0.3],
      ]);
    }
  };

  if (capFront) addCap(rings[0], -1);
  if (capBack) addCap(rings[rings.length - 1], 1);

  return buildIndexedMeshFromArrays(THREE, pos, nrm, uv, idx);
}

/**
 * Creates a crisp 44-triangle chamfered box (indexed BufferGeometry) whose beveled edges
 * catch realistic specular highlights instead of sharp block edges.
 */
function createChamferBoxGeometry(THREE, w, h, d, bevel = 0.025) {
  const bx = Math.min(bevel, w * 0.25);
  const by = Math.min(bevel, h * 0.25);
  const bz = Math.min(bevel, d * 0.25);
  const hx = w * 0.5;
  const hy = h * 0.5;
  const hz = d * 0.5;
  const ix = hx - bx;
  const iy = hy - by;
  const iz = hz - bz;

  // Build using an extruded 4-station chamfered profile along Z
  const stations = [
    {
      z: -hz,
      half: [
        [0, -iy],
        [ix, -iy],
        [ix, iy],
        [0, iy],
      ],
    },
    {
      z: -iz,
      half: [
        [0, -hy],
        [ix, -hy],
        [hx, -iy],
        [hx, iy],
        [ix, hy],
        [0, hy],
      ],
    },
    {
      z: iz,
      half: [
        [0, -hy],
        [ix, -hy],
        [hx, -iy],
        [hx, iy],
        [ix, hy],
        [0, hy],
      ],
    },
    {
      z: hz,
      half: [
        [0, -iy],
        [ix, -iy],
        [ix, iy],
        [0, iy],
      ],
    },
  ];
  // First/last stations have crisp small corner chamfers so there are zero degenerate triangles
  const cx = Math.max(0.001, ix - bx * 0.18);
  const cy = Math.max(0.001, iy - by * 0.18);
  stations[0].half = [
    [0, -iy],
    [cx, -iy],
    [ix, -cy],
    [ix, cy],
    [cx, iy],
    [0, iy],
  ];
  stations[3].half = stations[0].half;
  return createSculptedHullGeometry(THREE, stations, { capFront: true, capBack: true });
}

/**
 * Creates a clean planar quad BufferGeometry from 4 exact 3D points `[tl, tr, br, bl]`.
 */
function createQuadGeometry(THREE, tl, tr, br, bl, outHint, uvs) {
  const pos = [];
  const nrm = [];
  const uv = [];
  const idx = [];
  pushOrientedQuad(pos, nrm, uv, idx, tl, tr, br, bl, outHint, uvs);
  return buildIndexedMeshFromArrays(THREE, pos, nrm, uv, idx);
}

/**
 * Creates a clean planar triangle BufferGeometry from 3 exact 3D points `[p0, p1, p2]`.
 */
function createTriGeometry(THREE, p0, p1, p2, outHint, uvs) {
  const pos = [];
  const nrm = [];
  const uv = [];
  const idx = [];
  pushOrientedTri(pos, nrm, uv, idx, p0, p1, p2, outHint, uvs);
  return buildIndexedMeshFromArrays(THREE, pos, nrm, uv, idx);
}

/**
 * Crowned/domed outer tire shell (20 radial segments x 4 axial rings = 160 tris)
 * with smooth barrel curvature matching the iconic Concept Rover wheels.
 */
function createConceptTireShellGeometry(THREE, radius, width, radialSegs = 20) {
  const halfW = width * 0.5;
  // [xOffset, radiusScale, uCoord] — 4 axial quad strips give a smooth barrel crown in 160 tris
  const profile = [
    [-halfW, radius * 0.895, 0.0],
    [-halfW * 0.56, radius * 0.978, 0.24],
    [0, radius * 1.0, 0.5],
    [halfW * 0.56, radius * 0.978, 0.76],
    [halfW, radius * 0.895, 1.0],
  ];

  const pos = [];
  const nrm = [];
  const uv = [];
  const idx = [];
  const cols = radialSegs + 1;

  for (let r = 0; r < profile.length; r++) {
    const [px, pr, pu] = profile[r];
    for (let s = 0; s <= radialSegs; s++) {
      const ang = (s / radialSegs) * Math.PI * 2;
      const ny = Math.sin(ang);
      const nz = Math.cos(ang);
      pos.push(px, ny * pr, nz * pr);
      // Approximate domed outward normal
      const slopeTilt = r === 0 ? -0.34 : r === profile.length - 1 ? 0.34 : r === 1 ? -0.14 : r === 3 ? 0.14 : 0;
      const [nx, uNy, uNz] = normalize3(slopeTilt, ny, nz);
      nrm.push(nx, uNy, uNz);
      uv.push(pu, s / radialSegs);
    }
  }

  for (let r = 0; r < profile.length - 1; r++) {
    for (let s = 0; s < radialSegs; s++) {
      const a = r * cols + s;
      const b = a + cols;
      const c = b + 1;
      const d = a + 1;
      idx.push(a, b, d, b, c, d);
    }
  }

  return buildIndexedMeshFromArrays(THREE, pos, nrm, uv, idx);
}

/**
 * Builds both machined brushed-silver notched beadlock rim rings (outer + inner faces,
 * beveled inner lips) into one compact indexed BufferGeometry (~192 tris total).
 */
function createConceptBeadlockRimGeometry(THREE, innerR, outerR, width, radialSegs = 24) {
  const pos = [];
  const nrm = [];
  const uv = [];
  const idx = [];
  const halfW = width * 0.47;
  const bevelW = width * 0.43;

  for (const faceSign of [-1, 1]) {
    const xFace = faceSign * halfW;
    const xInnerLip = faceSign * bevelW;
    const base = pos.length / 3;

    // 3 rings per rim face: inner beveled lip, inner corner, outer rim edge
    const rings = [
      [xInnerLip, innerR * 0.96, 0.34],
      [xFace, innerR, 0.38],
      [xFace, outerR, 0.5],
    ];
    for (let r = 0; r < rings.length; r++) {
      const [rx, rr, uvScale] = rings[r];
      for (let s = 0; s <= radialSegs; s++) {
        const ang = (s / radialSegs) * Math.PI * 2;
        const c = Math.cos(ang);
        const sn = Math.sin(ang);
        pos.push(rx, sn * rr, c * rr);
        const [nx, ny, nz] = r === 0 ? normalize3(faceSign * 0.35, -sn, -c) : [faceSign, 0, 0];
        nrm.push(nx, ny, nz);
        uv.push(0.5 + c * uvScale, 0.5 + sn * uvScale);
      }
    }
    const cols = radialSegs + 1;
    for (let r = 0; r < rings.length - 1; r++) {
      for (let s = 0; s < radialSegs; s++) {
        const a = base + r * cols + s;
        const b = a + cols;
        const c = b + 1;
        const d = a + 1;
        if (faceSign > 0) idx.push(a, d, b, b, d, c);
        else idx.push(a, b, d, b, c, d);
      }
    }
  }

  return buildIndexedMeshFromArrays(THREE, pos, nrm, uv, idx);
}

/**
 * Builds 20 angled structural radial vane louvers lining the hollow rim interior
 * in one single indexed BufferGeometry (160 tris per wheel).
 */
function createConceptWheelVanesGeometry(THREE, innerR, outerR, width, vaneCount = 20) {
  const pos = [];
  const nrm = [];
  const uv = [];
  const idx = [];
  const hx = width * 0.43;
  const thick = 0.014;

  for (let i = 0; i < vaneCount; i++) {
    const ang = (i / vaneCount) * Math.PI * 2;
    const ny = Math.sin(ang);
    const nz = Math.cos(ang);
    // Tangent vector around wheel circumference
    const ty = nz;
    const tz = -ny;
    // Slight turbine pitch twist for authentic louver look
    const twist = 0.028;

    const pInA = [-hx, ny * innerR - ty * thick, nz * innerR - tz * thick];
    const pInB = [-hx, ny * innerR + ty * thick, nz * innerR + tz * thick];
    const pOutA = [-hx, ny * outerR - ty * thick + ty * twist, nz * outerR - tz * thick + tz * twist];
    const pOutB = [-hx, ny * outerR + ty * thick + ty * twist, nz * outerR + tz * thick + tz * twist];

    const qInA = [hx, pInA[1], pInA[2]];
    const qInB = [hx, pInB[1], pInB[2]];
    const qOutA = [hx, pOutA[1], pOutA[2]];
    const qOutB = [hx, pOutB[1], pOutB[2]];

    // 4 longitudinal faces per vane (top/bottom/2 sides; ends hidden inside rim rings)
    pushOrientedQuad(pos, nrm, uv, idx, pInA, pOutA, qOutA, qInA, [0, -ty, -tz]);
    pushOrientedQuad(pos, nrm, uv, idx, pOutB, pInB, qInB, qOutB, [0, ty, tz]);
    pushOrientedQuad(pos, nrm, uv, idx, pInB, pInA, qInA, qInB, [0, -ny, -nz]);
    pushOrientedQuad(pos, nrm, uv, idx, pOutA, pOutB, qOutB, qOutA, [0, ny, nz]);
  }

  return buildIndexedMeshFromArrays(THREE, pos, nrm, uv, idx);
}

/**
 * Builds an articulated 6×6 hollow domed airless wheel assembly matching the
 * NASA Mars Rover Concept vehicle (~540 triangles per wheel, ~3,240 for all 6).
 */
export function buildConceptHollowWheels(THREE, axleLayout, trackHalfW, radius) {
  const wheelGroup = new THREE.Group();
  const { tireMap, tireBump, rimRingMap } = makeConceptWheelTextures(THREE);

  const tireMat = new THREE.MeshStandardMaterial({
    map: tireMap,
    bumpMap: tireBump,
    bumpScale: 0.018,
    color: tireMap ? 0xffffff : 0x1e222a,
    alphaTest: 0.45,
    roughness: 0.84,
    metalness: 0.16,
    side: THREE.DoubleSide,
  });
  const silverRimMat = new THREE.MeshStandardMaterial({
    map: rimRingMap,
    color: rimRingMap ? 0xffffff : 0xd4dae3,
    roughness: 0.26,
    metalness: 0.86,
  });
  const vaneMat = new THREE.MeshStandardMaterial({
    color: 0x22262f,
    roughness: 0.54,
    metalness: 0.66,
  });
  const carrierMat = new THREE.MeshStandardMaterial({
    color: 0x1b1f26,
    roughness: 0.56,
    metalness: 0.72,
  });

  const tireW = 0.58;
  const outerBarrelGeom = createConceptTireShellGeometry(THREE, radius, tireW, 20);
  const rimRingGeom = createConceptBeadlockRimGeometry(THREE, radius * 0.66, radius * 0.895, tireW, 20);
  const vanesGeom = createConceptWheelVanesGeometry(THREE, radius * 0.69, radius * 0.88, tireW, 20);

  // Inboard upright carrier (tucked on the inner third of the wheel so outer face stays hollow)
  const hubDrumGeom = new THREE.CylinderGeometry(radius * 0.32, radius * 0.34, 0.08, 8);
  hubDrumGeom.rotateZ(Math.PI / 2);
  const uprightPostGeom = new THREE.BoxGeometry(0.07, radius * 0.62, 0.12);
  const spokeArmGeom = new THREE.BoxGeometry(0.05, 0.06, radius * 0.66);

  const customDepthMat = tireMap
    ? new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        map: tireMap,
        alphaTest: 0.45,
      })
    : null;

  const wheels = [];
  const frontSteerKnuckles = [];
  const rearSteerKnuckles = [];
  const pods = [];

  for (const ax of axleLayout) {
    for (const side of [-1, 1]) {
      const podRoot = new THREE.Group();
      podRoot.position.set(side * trackHalfW, radius, ax.z);
      wheelGroup.add(podRoot);

      const knuckle = new THREE.Group();
      podRoot.add(knuckle);

      // Inboard steering knuckle / brake drum tucked cleanly at -side * 0.22 (leaves hollow view open!)
      const hubDrum = new THREE.Mesh(hubDrumGeom, carrierMat);
      hubDrum.position.x = -side * 0.21;
      hubDrum.castShadow = true;
      knuckle.add(hubDrum);

      const upright = new THREE.Mesh(uprightPostGeom, carrierMat);
      upright.position.set(-side * 0.23, radius * 0.26, 0);
      upright.castShadow = true;
      knuckle.add(upright);

      for (const ang of [0, Math.PI / 2]) {
        const spoke = new THREE.Mesh(spokeArmGeom, vaneMat);
        spoke.position.x = -side * 0.21;
        spoke.rotation.x = ang;
        knuckle.add(spoke);
      }

      const spinner = new THREE.Group();
      knuckle.add(spinner);

      const outerBarrel = new THREE.Mesh(outerBarrelGeom, tireMat);
      outerBarrel.castShadow = true;
      outerBarrel.receiveShadow = true;
      if (customDepthMat) outerBarrel.customDepthMaterial = customDepthMat;
      spinner.add(outerBarrel);

      const rimRings = new THREE.Mesh(rimRingGeom, silverRimMat);
      rimRings.castShadow = true;
      rimRings.receiveShadow = true;
      spinner.add(rimRings);

      const vanes = new THREE.Mesh(vanesGeom, vaneMat);
      vanes.castShadow = true;
      vanes.receiveShadow = true;
      spinner.add(vanes);

      wheels.push(spinner);
      pods.push({
        podRoot,
        knuckle,
        spinner,
        lx: side * trackHalfW,
        lz: ax.z,
        baseY: radius,
        role: ax.role,
        hubInset: 0.22,
        smoothPodY: 0,
      });
      if (ax.role === "front") frontSteerKnuckles.push(knuckle);
      else if (ax.role === "rear") rearSteerKnuckles.push(knuckle);
    }
  }

  return { wheelGroup, wheels, frontSteerKnuckles, rearSteerKnuckles, pods };
}

/**
 * Builds the sculpted, low-poly faceted NASA Mars Rover Concept body (~1,800 triangles).
 */
export function buildNasaConceptRoverVisuals(THREE) {
  const procGroup = new THREE.Group();
  const tex = makeConceptTextures(THREE);

  const carbonMat = new THREE.MeshStandardMaterial({
    map: tex.carbonMap,
    bumpMap: tex.carbonBump,
    bumpScale: 0.008,
    color: tex.carbonMap ? 0xffffff : 0x191d24,
    roughness: 0.72,
    metalness: 0.28,
  });
  const gunmetalMat = new THREE.MeshStandardMaterial({
    map: tex.silverMap,
    bumpMap: tex.silverBump,
    bumpScale: 0.006,
    color: 0x454d59,
    roughness: 0.42,
    metalness: 0.72,
  });
  const silverArmorMat = new THREE.MeshStandardMaterial({
    map: tex.silverMap,
    bumpMap: tex.silverBump,
    bumpScale: 0.006,
    color: tex.silverMap ? 0xf1f5f9 : 0xadb6c2,
    roughness: 0.28,
    metalness: 0.78,
  });
  const cabFlankLeftMat = new THREE.MeshStandardMaterial({
    map: tex.cabFlankLeftMap,
    bumpMap: tex.silverBump,
    bumpScale: 0.005,
    color: tex.cabFlankLeftMap ? 0xffffff : 0xadb6c2,
    roughness: 0.3,
    metalness: 0.76,
  });
  const cabFlankRightMat = new THREE.MeshStandardMaterial({
    map: tex.cabFlankRightMap,
    bumpMap: tex.silverBump,
    bumpScale: 0.005,
    color: tex.cabFlankRightMap ? 0xffffff : 0xadb6c2,
    roughness: 0.3,
    metalness: 0.76,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x52c7f2,
    roughness: 0.08,
    metalness: 0.66,
    emissive: 0x0a3952,
    emissiveIntensity: 0.24,
    transparent: true,
    opacity: 0.76,
    side: THREE.DoubleSide,
  });
  const darkGlassMat = new THREE.MeshStandardMaterial({
    color: 0x1d4e6b,
    roughness: 0.12,
    metalness: 0.72,
    emissive: 0x072436,
    emissiveIntensity: 0.22,
  });
  const blueLedMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 2.0,
    roughness: 0.2,
  });
  const tankMat = new THREE.MeshStandardMaterial({
    color: 0xdce2ea,
    roughness: 0.32,
    metalness: 0.35,
  });
  const nasaBadgeMat = new THREE.MeshStandardMaterial({
    map: tex.nasaBadgeMap,
    color: tex.nasaBadgeMap ? 0xffffff : 0x1e40af,
    roughness: 0.34,
    metalness: 0.35,
  });
  const louverMat = new THREE.MeshStandardMaterial({
    map: tex.louverMap,
    color: tex.louverMap ? 0xffffff : 0x111827,
    roughness: 0.45,
    metalness: 0.58,
  });
  const hexGrilleMat = new THREE.MeshStandardMaterial({
    map: tex.hexGrilleMap,
    color: tex.hexGrilleMap ? 0xffffff : 0x1f2937,
    roughness: 0.42,
    metalness: 0.64,
  });
  const solarMat = new THREE.MeshStandardMaterial({
    map: tex.solarMap,
    color: tex.solarMap ? 0xffffff : 0x0e2245,
    roughness: 0.2,
    metalness: 0.46,
  });
  const bellowsMat = new THREE.MeshStandardMaterial({
    map: tex.bellowsMap,
    bumpMap: tex.bellowsBump,
    bumpScale: 0.022,
    color: tex.bellowsMap ? 0xffffff : 0x16191f,
    roughness: 0.78,
    metalness: 0.18,
  });
  const utilityRailMat = new THREE.MeshStandardMaterial({
    map: tex.utilityRailMap,
    color: tex.utilityRailMap ? 0xffffff : 0x2d333d,
    roughness: 0.44,
    metalness: 0.62,
  });

  const add = (geom, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    if (rx || ry || rz) m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    procGroup.add(m);
    return m;
  };

  // =========================================================================
  // 1. CONTINUOUS SCULPTED LOWER CHASSIS TUB (narrow at all 3 axles for lock)
  // =========================================================================
  const tubStations = [
    { z: -2.84, half: [[0, 0.62], [0.68, 0.62], [0.78, 0.78], [0.80, 1.14], [0, 1.14]] },
    { z: -2.48, half: [[0, 0.62], [0.64, 0.62], [0.74, 0.78], [0.74, 1.24], [0, 1.24]] },
    { z: -1.36, half: [[0, 0.62], [0.66, 0.62], [0.76, 0.78], [0.76, 1.24], [0, 1.24]] },
    { z: -1.22, half: [[0, 0.62], [0.78, 0.62], [0.94, 0.80], [0.94, 1.22], [0, 1.22]] },
    { z: -0.18, half: [[0, 0.62], [0.78, 0.62], [0.94, 0.80], [0.94, 1.22], [0, 1.22]] },
    { z: -0.04, half: [[0, 0.62], [0.64, 0.62], [0.76, 0.78], [0.76, 1.24], [0, 1.24]] },
    { z: 0.94, half: [[0, 0.62], [0.64, 0.62], [0.76, 0.78], [0.76, 1.24], [0, 1.24]] },
    { z: 1.12, half: [[0, 0.62], [0.70, 0.62], [0.82, 0.78], [0.82, 1.24], [0, 1.24]] },
    { z: 1.42, half: [[0, 0.62], [0.64, 0.62], [0.76, 0.78], [0.76, 1.24], [0, 1.24]] },
    { z: 2.54, half: [[0, 0.62], [0.64, 0.62], [0.76, 0.78], [0.76, 1.24], [0, 1.24]] },
    { z: 2.68, half: [[0, 0.64], [0.72, 0.64], [0.88, 0.82], [0.88, 1.22], [0, 1.22]] },
    { z: 3.02, half: [[0, 0.66], [0.64, 0.66], [0.82, 0.86], [0.82, 1.20], [0, 1.20]] },
  ];
  add(createSculptedHullGeometry(THREE, tubStations), carbonMat);

  // Mid-chassis side armor doors & hydraulic conduit pipes behind front wheel
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.08, 0.34, 0.82), gunmetalMat, sx * 0.95, 0.96, -0.70);
    for (const py of [0.84, 0.98]) {
      add(
        new THREE.CylinderGeometry(0.018, 0.018, 0.78, 6),
        silverArmorMat,
        sx * 0.98,
        py,
        -1.26,
        Math.PI / 2,
        0,
        0
      );
    }
  }

  // =========================================================================
  // 2. TRAPEZOIDAL NOSE CHIN BEZEL, RECESSED VIEWPORT & SLOPED NOSE DECK
  // =========================================================================
  // Front chin bumper frame around recessed glass (top brow, bottom splitter, angled cheeks)
  add(createChamferBoxGeometry(THREE, 1.90, 0.13, 0.32, 0.02), carbonMat, 0, 1.18, -2.96);
  add(createChamferBoxGeometry(THREE, 1.56, 0.11, 0.34, 0.02), carbonMat, 0, 0.66, -2.92);
  for (const sx of [-1, 1]) {
    // Angled chin side cheek frames
    add(
      new THREE.BoxGeometry(0.16, 0.56, 0.34),
      carbonMat,
      sx * 0.81,
      0.92,
      -2.94,
      0.06,
      0,
      sx * -0.18
    );
    // Subtle dark headlight recesses flanking nose brow at x=±0.58, y=1.18, z=-3.05
    add(new THREE.BoxGeometry(0.18, 0.11, 0.06), gunmetalMat, sx * 0.58, 1.18, -3.09);
  }

  // Recessed trapezoidal chin glass viewport + dark interior footwell backing
  add(
    createQuadGeometry(
      THREE,
      [-0.74, 1.12, -2.94],
      [0.74, 1.12, -2.94],
      [0.64, 0.71, -2.82],
      [-0.64, 0.71, -2.82],
      [0, -0.3, -1]
    ),
    glassMat
  );
  add(
    createQuadGeometry(
      THREE,
      [-0.72, 1.10, -2.82],
      [0.72, 1.10, -2.82],
      [0.62, 0.71, -2.74],
      [-0.62, 0.71, -2.74],
      [0, 0, -1]
    ),
    carbonMat
  );

  // Forward-sloping nose deck with subtle dihedral ridge + NASA badge pad
  const hoodStations = [
    { z: -3.08, half: [[0, 1.18], [0.88, 1.18], [0.88, 1.23], [0, 1.25]] },
    { z: -2.22, half: [[0, 1.38], [0.82, 1.38], [0.82, 1.44], [0, 1.47]] },
  ];
  add(createSculptedHullGeometry(THREE, hoodStations), gunmetalMat);
  add(new THREE.BoxGeometry(0.52, 0.04, 0.52), gunmetalMat, 0, 1.36, -2.62, -0.25, 0, 0);
  add(new THREE.CylinderGeometry(0.21, 0.21, 0.025, 16), nasaBadgeMat, 0, 1.38, -2.62, -0.25, 0, 0);

  // =========================================================================
  // 3. SWEPT SILVER CHINE BLADES, FACETED CAB FLANKS & SAIL DETAILS
  // =========================================================================
  for (const sx of [-1, 1]) {
    // Sweeping front silver chine fender rail (nose outer corner -> front wheel arch -> A-pillar)
    const chinePos = [];
    const chineNrm = [];
    const chineUv = [];
    const chineIdx = [];
    const chinePts = [
      // [outerBot, outerTop, innerTop, u]
      [[sx * 0.96, 1.14, -3.08], [sx * 0.96, 1.24, -3.04], [sx * 0.87, 1.23, -3.04], 0.0],
      [[sx * 1.05, 1.35, -2.26], [sx * 1.06, 1.47, -2.22], [sx * 0.82, 1.44, -2.20], 0.35],
      [[sx * 1.11, 1.40, -1.86], [sx * 1.10, 1.62, -1.78], [sx * 0.86, 1.66, -1.76], 0.65],
      [[sx * 1.13, 1.24, -1.36], [sx * 1.13, 1.68, -1.36], [sx * 0.96, 1.72, -1.36], 1.0],
    ];
    for (let i = 0; i < chinePts.length - 1; i++) {
      const [ob0, ot0, it0, u0] = chinePts[i];
      const [ob1, ot1, it1, u1] = chinePts[i + 1];
      // Outer angled fascia
      pushOrientedQuad(chinePos, chineNrm, chineUv, chineIdx, ot0, ot1, ob1, ob0, [sx, 0.1, -0.1], [
        [u0, 1],
        [u1, 1],
        [u1, 0],
        [u0, 0],
      ]);
      // Upper beveled shoulder shelf
      pushOrientedQuad(chinePos, chineNrm, chineUv, chineIdx, it0, it1, ot1, ot0, [sx * 0.3, 1, -0.2], [
        [u0, 1],
        [u1, 1],
        [u1, 0],
        [u0, 0],
      ]);
      // Underside arch soffit (clears front wheel cleanly)
      pushOrientedQuad(chinePos, chineNrm, chineUv, chineIdx, ob0, ob1, [sx * 0.74, ob1[1], ob1[2]], [sx * 0.74, ob0[1], ob0[2]], [0, -1, 0]);
    }
    // Front tip bevel cap
    pushOrientedTri(chinePos, chineNrm, chineUv, chineIdx, chinePts[0][0], chinePts[0][1], chinePts[0][2], [0, 0, -1]);
    add(buildIndexedMeshFromArrays(THREE, chinePos, chineNrm, chineUv, chineIdx), silverArmorMat);

    // Sweeping upper A-pillar roof rail framing the cockpit side glass
    const aPos = [];
    const aNrm = [];
    const aUv = [];
    const aIdx = [];
    const aPts = [
      [[sx * 0.84, 1.44, -2.20], [sx * 0.86, 1.48, -2.18]],
      [[sx * 0.86, 2.22, -0.92], [sx * 0.88, 2.28, -0.92]],
      [[sx * 0.99, 2.16, -0.60], [sx * 0.95, 2.28, -0.60]],
      [[sx * 0.98, 2.18, 0.16], [sx * 0.82, 2.30, 0.16]],
    ];
    for (let i = 0; i < aPts.length - 1; i++) {
      const [lo0, hi0] = aPts[i];
      const [lo1, hi1] = aPts[i + 1];
      pushOrientedQuad(aPos, aNrm, aUv, aIdx, hi0, hi1, lo1, lo0, [sx * 0.6, 0.8, -0.2]);
    }
    add(buildIndexedMeshFromArrays(THREE, aPos, aNrm, aUv, aIdx), silverArmorMat);

    // Main sculpted lower/mid cab flank (z = -1.36 .. +0.16) mapped to US flag flank texture
    const flankMat = sx < 0 ? cabFlankLeftMat : cabFlankRightMat;
    const flankUvs =
      sx < 0
        ? [
            [0, 1],
            [1, 1],
            [1, 0],
            [0, 0],
          ]
        : [
            [1, 1],
            [0, 1],
            [0, 0],
            [1, 0],
          ];
    // Lower/mid door facet (z = -1.36 .. -0.34) + rear step-up over middle wheel (z = -0.34 .. +0.16)
    add(
      createQuadGeometry(
        THREE,
        [sx * 1.13, 1.68, -1.36],
        [sx * 1.11, 1.68, -0.34],
        [sx * 1.13, 1.19, -0.34],
        [sx * 1.13, 1.24, -1.36],
        [sx, 0, 0],
        flankUvs
      ),
      flankMat
    );
    add(
      createQuadGeometry(
        THREE,
        [sx * 1.11, 1.68, -0.34],
        [sx * 1.09, 1.68, 0.16],
        [sx * 1.09, 1.32, 0.16],
        [sx * 1.13, 1.19, -0.34],
        [sx, 0, 0],
        [
          [0.05, 1],
          [0.2, 1],
          [0.2, 0.2],
          [0.05, 0],
        ]
      ),
      silverArmorMat
    );

    // Underside sill soffit & front/rear cab wheel-well bulkheads (watertight from low angles)
    add(
      createQuadGeometry(
        THREE,
        [sx * 1.13, 1.24, -1.36],
        [sx * 1.13, 1.19, -0.34],
        [sx * 0.94, 1.21, -0.34],
        [sx * 0.76, 1.24, -1.36],
        [0, -1, 0]
      ),
      carbonMat
    );
    add(
      createQuadGeometry(
        THREE,
        [sx * 1.13, 1.19, -0.34],
        [sx * 1.09, 1.32, 0.16],
        [sx * 0.76, 1.24, 0.16],
        [sx * 0.94, 1.21, -0.34],
        [0, -1, 0]
      ),
      carbonMat
    );
    // Front wheel-well bulkhead at z = -1.36 & rear cab bulkhead at z = +0.16
    add(
      createQuadGeometry(
        THREE,
        [sx * 0.76, 1.72, -1.36],
        [sx * 1.13, 1.68, -1.36],
        [sx * 1.13, 1.24, -1.36],
        [sx * 0.76, 1.24, -1.36],
        [0, 0, -1]
      ),
      carbonMat
    );
    add(
      createQuadGeometry(
        THREE,
        [sx * 0.85, 2.20, 0.16],
        [sx * 0.98, 2.18, 0.16],
        [sx * 1.09, 1.32, 0.16],
        [sx * 0.85, 1.22, 0.16],
        [0, 0, 1]
      ),
      carbonMat
    );

    // Upper sail panel behind side quarter window (z = -0.60 .. +0.16)
    add(
      createQuadGeometry(
        THREE,
        [sx * 0.99, 2.16, -0.60],
        [sx * 0.98, 2.18, 0.16],
        [sx * 1.09, 1.68, 0.16],
        [sx * 1.11, 1.68, -0.60],
        [sx, 0.22, 0]
      ),
      silverArmorMat
    );

    // Upper sail trapezoidal porthole window + light metallic frame
    add(
      new THREE.BoxGeometry(0.045, 0.20, 0.36),
      silverArmorMat,
      sx * 1.04,
      1.98,
      -0.40,
      0,
      0,
      sx * 0.22
    );
    add(
      new THREE.BoxGeometry(0.055, 0.13, 0.27),
      darkGlassMat,
      sx * 1.045,
      1.98,
      -0.40,
      0,
      0,
      sx * 0.22
    );

    // Stepped upper-rear cab vent window ahead of waist
    add(
      new THREE.BoxGeometry(0.05, 0.28, 0.24),
      silverArmorMat,
      sx * 1.07,
      1.84,
      -0.05,
      0,
      0,
      sx * 0.22
    );
    add(
      new THREE.BoxGeometry(0.058, 0.20, 0.17),
      gunmetalMat,
      sx * 1.075,
      1.84,
      -0.05,
      0,
      0,
      sx * 0.22
    );

    // 3D-framed 2x3 six-cell lower cab air intake louver box
    add(new THREE.BoxGeometry(0.065, 0.34, 0.52), silverArmorMat, sx * 1.13, 1.43, -0.18);
    add(
      createQuadGeometry(
        THREE,
        [sx * 1.168, 1.57, -0.41],
        [sx * 1.168, 1.57, 0.05],
        [sx * 1.168, 1.29, 0.05],
        [sx * 1.168, 1.29, -0.41],
        [sx, 0, 0]
      ),
      louverMat
    );
  }

  // =========================================================================
  // 4. FACETED 3-PLANE COCKPIT WINDSHIELD, MULLION, WIPERS & INTERIOR HINT
  // =========================================================================
  // Center V-crowned dual-pane front windshield
  for (const sx of [-1, 1]) {
    add(
      createQuadGeometry(
        THREE,
        [0, 2.27, -0.96],
        [sx * 0.86, 2.22, -0.92],
        [sx * 0.82, 1.44, -2.20],
        [0, 1.47, -2.25],
        [sx * 0.08, 0.85, -0.55]
      ),
      glassMat
    );
    // Swept side-quarter cockpit glass (bridges A-pillar to chine rail)
    add(
      createQuadGeometry(
        THREE,
        [sx * 0.86, 2.21, -0.92],
        [sx * 0.99, 2.15, -0.60],
        [sx * 1.10, 1.68, -0.60],
        [sx * 0.83, 1.45, -2.18],
        [sx * 0.92, 0.36, -0.18]
      ),
      glassMat
    );
    // Sleek brushed-silver windshield wiper blade along lower glass corner
    add(
      new THREE.BoxGeometry(0.52, 0.025, 0.035),
      silverArmorMat,
      sx * 0.42,
      1.52,
      -2.16,
      -0.25,
      sx * -0.14,
      sx * 0.08
    );
  }

  // Center carbon windshield spine mullion
  add(
    new THREE.BoxGeometry(0.095, 0.08, 1.54),
    carbonMat,
    0,
    1.87,
    -1.60,
    -0.55,
    0,
    0
  );

  // Minimalist cockpit interior behind translucent glass (dash, glowing telemetry strip, twin seats)
  add(new THREE.BoxGeometry(1.42, 0.24, 0.38), carbonMat, 0, 1.38, -1.78, -0.22, 0, 0);
  add(new THREE.BoxGeometry(0.86, 0.05, 0.04), blueLedMat, 0, 1.48, -1.74, -0.4, 0, 0);
  add(new THREE.BoxGeometry(1.66, 0.92, 0.14), carbonMat, 0, 1.66, -0.46);
  for (const sx of [-0.38, 0.38]) {
    add(new THREE.BoxGeometry(0.42, 0.62, 0.14), gunmetalMat, sx, 1.64, -0.96, 0.16, 0, 0);
  }

  // =========================================================================
  // 5. CAB ROOF DECK & TWIN DUAL ROOF BROW AIR INTAKES WITH BLUE LED ACCENTS
  // =========================================================================
  const cabRoofStations = [
    { z: -0.94, half: [[0, 2.22], [0.88, 2.20], [0.88, 2.26], [0, 2.29]] },
    { z: -0.52, half: [[0, 2.24], [0.95, 2.18], [0.82, 2.30], [0, 2.34]] },
    { z: 0.16, half: [[0, 2.24], [0.96, 2.18], [0.82, 2.30], [0, 2.34]] },
  ];
  add(createSculptedHullGeometry(THREE, cabRoofStations), gunmetalMat);

  for (const sx of [-0.46, 0.46]) {
    add(createChamferBoxGeometry(THREE, 0.62, 0.17, 0.52, 0.024), gunmetalMat, sx, 2.31, -0.98, -0.14, 0, 0);
    add(new THREE.BoxGeometry(0.48, 0.08, 0.06), carbonMat, sx, 2.28, -1.23);
    add(new THREE.BoxGeometry(0.44, 0.045, 0.04), blueLedMat, sx, 2.28, -1.25);
  }

  // =========================================================================
  // 6. ARTICULATED WAIST NECK BELLOWS (z = +0.16 .. +0.58)
  // =========================================================================
  const waistStations = [
    { z: 0.14, half: [[0, 1.08], [0.86, 1.12], [0.86, 2.14], [0.58, 2.26], [0, 2.28]] },
    { z: 0.58, half: [[0, 1.08], [0.86, 1.12], [0.86, 2.14], [0.58, 2.26], [0, 2.28]] },
  ];
  add(createSculptedHullGeometry(THREE, waistStations), bellowsMat);

  // =========================================================================
  // 7. OCTAGONAL BEVELED REAR SCIENCE LAB MODULE (z = +0.56 .. +3.02)
  // =========================================================================
  // Lower wheel-arch sill rises cleanly to y = 1.35 at x = ±1.13 so rear steered/compressed wheels never clip
  const labStations = [
    { z: 0.56, half: [[0, 1.06], [0.76, 1.06], [0.96, 1.30], [0.94, 1.86], [0.58, 2.32], [0, 2.36]] },
    { z: 0.82, half: [[0, 1.06], [0.76, 1.06], [1.13, 1.35], [1.10, 1.88], [0.66, 2.38], [0, 2.42]] },
    { z: 2.78, half: [[0, 1.06], [0.76, 1.06], [1.13, 1.35], [1.10, 1.88], [0.66, 2.38], [0, 2.42]] },
    { z: 3.02, half: [[0, 1.10], [0.72, 1.10], [0.96, 1.32], [0.94, 1.84], [0.58, 2.30], [0, 2.34]] },
  ];
  add(createSculptedHullGeometry(THREE, labStations), gunmetalMat);

  // Sloped upper roof shoulder tilt (from (1.10, 1.88) to (0.66, 2.38): dx=0.44, dy=0.50 -> atan2(0.50, 0.44)=0.849 rad)
  const shoulderAngle = Math.atan2(0.50, 0.44); // ~0.849 rad
  for (const sx of [-1, 1]) {
    // 7a. Forward angled perforated hex grille bezel on upper shoulder (z = +0.82 .. +1.34)
    add(
      new THREE.BoxGeometry(0.56, 0.045, 0.54),
      silverArmorMat,
      sx * 0.88,
      2.13,
      1.08,
      0,
      0,
      sx * -shoulderAngle
    );
    add(
      new THREE.BoxGeometry(0.46, 0.052, 0.44),
      hexGrilleMat,
      sx * 0.88,
      2.13,
      1.08,
      0,
      0,
      sx * -shoulderAngle
    );

    // 7b. Circular raised NASA Meatball medallion pod on rear lab flank (outer face +Y when sx=-1 -> rz=+PI/2, sx=+1 -> rz=-PI/2)
    add(
      new THREE.CylinderGeometry(0.22, 0.23, 0.05, 14),
      silverArmorMat,
      sx * 1.12,
      1.62,
      1.16,
      0,
      0,
      sx < 0 ? Math.PI / 2 : -Math.PI / 2
    );
    add(
      new THREE.CylinderGeometry(0.19, 0.19, 0.056, 14),
      nasaBadgeMat,
      sx * 1.125,
      1.62,
      1.16,
      0,
      sx < 0 ? Math.PI / 2 : -Math.PI / 2,
      sx < 0 ? Math.PI / 2 : -Math.PI / 2
    );

    // 7c. Cylindrical white/silver pressurized O2/N2 tank along diagonal shoulder seam
    const tankGrp = new THREE.Group();
    tankGrp.position.set(sx * 0.90, 2.13, 1.44);
    tankGrp.rotation.set(0.16, 0, sx * -shoulderAngle);
    const tankCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.56, 10), tankMat);
    tankCyl.castShadow = true;
    tankCyl.receiveShadow = true;
    tankGrp.add(tankCyl);
    for (const endY of [-0.28, 0.28]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.082, 0.06, 10), silverArmorMat);
      cap.position.y = endY + Math.sign(endY) * 0.03;
      if (endY < 0) cap.rotation.x = Math.PI;
      tankGrp.add(cap);
    }
    for (const bandY of [-0.15, 0.15]) {
      const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.035, 10), gunmetalMat);
      strap.position.y = bandY;
      tankGrp.add(strap);
    }
    procGroup.add(tankGrp);

    // 7d. 2x2 framed photovoltaic solar panels on both sloped rear roof shoulders
    for (const sz of [1.86, 2.46]) {
      add(
        new THREE.BoxGeometry(0.56, 0.035, 0.54),
        silverArmorMat,
        sx * 0.89,
        2.14,
        sz,
        0,
        0,
        sx * -shoulderAngle
      );
      add(
        new THREE.BoxGeometry(0.48, 0.042, 0.46),
        solarMat,
        sx * 0.89,
        2.14,
        sz,
        0,
        0,
        sx * -shoulderAngle
      );
    }

    // 7e. Protruding chamfered 3-slot side utility rail pod above rear wheel
    add(createChamferBoxGeometry(THREE, 0.15, 0.20, 1.06, 0.025), silverArmorMat, sx * 1.16, 1.50, 2.20);
    add(
      createQuadGeometry(
        THREE,
        [sx * 1.24, 1.57, sx < 0 ? 2.68 : 1.72],
        [sx * 1.24, 1.57, sx < 0 ? 1.72 : 2.68],
        [sx * 1.24, 1.43, sx < 0 ? 1.72 : 2.68],
        [sx * 1.24, 1.43, sx < 0 ? 2.68 : 1.72],
        [sx, 0, 0]
      ),
      utilityRailMat
    );

    // 7f. Rear corner diagonal hex-cutout step bezel (matches bottom-right corner of reference photo)
    add(
      new THREE.BoxGeometry(0.28, 0.24, 0.08),
      silverArmorMat,
      sx * 0.90,
      1.18,
      2.96,
      0.14,
      sx * -0.45,
      0
    );
    add(
      new THREE.BoxGeometry(0.20, 0.16, 0.09),
      hexGrilleMat,
      sx * 0.90,
      1.18,
      2.965,
      0.14,
      sx * -0.45,
      0
    );

    // Taillight housing bezels aligned with shared tailBars at (x=±0.52, y=1.22, z=3.04)
    add(new THREE.BoxGeometry(0.24, 0.095, 0.055), carbonMat, sx * 0.52, 1.22, 3.01);
  }

  // 7g. Top faceted cyan glass observation skylight cupola on rear lab roof crown
  add(new THREE.BoxGeometry(0.88, 0.06, 0.72), gunmetalMat, 0, 2.43, 1.44);
  const cupola = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 0.17, 4), glassMat);
  cupola.position.set(0, 2.53, 1.44);
  cupola.rotation.y = Math.PI / 4;
  cupola.scale.set(1.05, 1.0, 1.32);
  cupola.castShadow = true;
  procGroup.add(cupola);

  // 7h. Stern airlock EVA hatch door & vertical grab bar
  add(createChamferBoxGeometry(THREE, 0.84, 0.88, 0.07, 0.016), silverArmorMat, 0, 1.72, 3.00);
  add(new THREE.BoxGeometry(0.44, 0.24, 0.08), darkGlassMat, 0, 1.90, 3.01);
  add(new THREE.BoxGeometry(0.05, 0.34, 0.05), gunmetalMat, 0.28, 1.62, 3.05);

  return { procGroup };
}

/**
 * Counts total triangles across all meshes under a Three.js Object3D subtree.
 */
export function countGeometryTriangles(root) {
  let tris = 0;
  root?.traverse?.((obj) => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
    const g = obj.geometry;
    tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  });
  return Math.round(tris);
}
