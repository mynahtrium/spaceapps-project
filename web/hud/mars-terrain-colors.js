/**
 * Shared Mars elevation hypsometry, geological slope/strata coloring, and GLSL shader helpers.
 * Single source of truth for both walkable 3D terrain shaders and 2D/3D tactical map canvases.
 */

export const MOLA_PALETTE_STOPS = [
  [0.0, 0.24, 0.12, 0.56],  // Deep basins / Hellas floor (-8 km)
  [0.18, 0.16, 0.36, 0.86], // Deep plains
  [0.36, 0.15, 0.72, 0.68], // Lowlands transition
  [0.52, 0.42, 0.8, 0.25],  // Mid-altitude plains
  [0.68, 0.92, 0.72, 0.2],  // Highlands
  [0.84, 0.85, 0.31, 0.2],  // Shield / volcanic rise
  [0.94, 0.86, 0.62, 0.56], // High edifice shoulders
  [1.0, 0.97, 0.96, 0.95],  // Olympus / Tharsis peak crests (+21 km)
];

/**
 * Sample NASA MGS MOLA hypsometric elevation color ramp at normalized height t in [0..1].
 * Returns [r, g, b] in [0..1].
 */
export function sampleMolaPaletteRgb(t) {
  const c = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0.5));
  for (let i = 0; i < MOLA_PALETTE_STOPS.length - 1; i++) {
    const a = MOLA_PALETTE_STOPS[i];
    const b = MOLA_PALETTE_STOPS[i + 1];
    if (c <= b[0]) {
      const u = (c - a[0]) / (b[0] - a[0] || 1);
      return [
        a[1] + (b[1] - a[1]) * u,
        a[2] + (b[2] - a[2]) * u,
        a[3] + (b[3] - a[3]) * u,
      ];
    }
  }
  const last = MOLA_PALETTE_STOPS[MOLA_PALETTE_STOPS.length - 1];
  return [last[1], last[2], last[3]];
}

/**
 * Color class for traversability slope hazard overlays matching NASA EVA safety thresholds.
 * <=10 deg: emerald, 10-15 deg: amber, 15-20 deg: crimson, >20 deg: blocked violet.
 */
export function sampleSlopeHazardColor(slopeDeg) {
  if (slopeDeg > 20) return { r: 168, g: 85, b: 247, alpha: 0.62 };
  if (slopeDeg > 15) return { r: 239, g: 68, b: 68, alpha: 0.52 };
  if (slopeDeg > 10) return { r: 245, g: 158, b: 11, alpha: 0.4 };
  return { r: 34, g: 197, b: 94, alpha: 0.25 };
}

/**
 * Emit a self-contained GLSL `sampleMolaRamp(float t)` function matching `MOLA_PALETTE_STOPS`.
 */
export function buildMolaPaletteGlsl() {
  const lines = ["vec3 mmSampleMolaRamp(float t) {", "  float c = clamp(t, 0.0, 1.0);"];
  for (let i = 0; i < MOLA_PALETTE_STOPS.length - 1; i++) {
    const a = MOLA_PALETTE_STOPS[i];
    const b = MOLA_PALETTE_STOPS[i + 1];
    const cond = i === 0 ? "if" : "else if";
    const span = (b[0] - a[0]).toFixed(4);
    lines.push(
      `  ${cond} (c <= ${b[0].toFixed(4)}) return mix(vec3(${a[1].toFixed(3)}, ${a[2].toFixed(3)}, ${a[3].toFixed(3)}), vec3(${b[1].toFixed(3)}, ${b[2].toFixed(3)}, ${b[3].toFixed(3)}), (c - ${a[0].toFixed(4)}) / ${span});`
    );
  }
  const last = MOLA_PALETTE_STOPS[MOLA_PALETTE_STOPS.length - 1];
  lines.push(`  return vec3(${last[1].toFixed(3)}, ${last[2].toFixed(3)}, ${last[3].toFixed(3)});`);
  lines.push("}");
  return lines.join("\n");
}
