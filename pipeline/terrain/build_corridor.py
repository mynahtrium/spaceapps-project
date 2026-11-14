"""Build the streamed Gale corridor terrain (real HiRISE DTM + 25 cm orthoimage) as small chunks.

Source products (MRO HiRISE, PDS, fetched 2026-11-15):
  DTEEC_009149_1750_009294_1750_U01.IMG   1 m DTM, 32-bit floats, equirectangular (centre lon 137.41)
  PSP_009149_1750_RED_A_01_ORTHO.JP2      25 cm orthoimage on the same projection

The corridor runs from south of the habitat / boxwork stops north to the Glen Torridon drill sites
(Glen Etive 1, Mary Anning 3). It is 8 x 21 chunks of 256 x 256 DTM pixels (~2.06 x 5.44 km).

Registration: Curiosity waypoint lon/lat (MSL localisation frame) and this DTM differ by a constant
shift. Fitting 478 waypoints inside the corridor gives -60 samples / +14 lines (about 60 m E-W,
14 m N-S); the elevation residual spread drops from 6.2 m to 2.35 m. Everything here is written in
the waypoint frame so the stops, route and traverse sit on the right rocks.

Needs only numpy plus the `opj_decompress` and `vips` command-line tools (no GDAL / Pillow).

Inputs (gitignored, data/raw/hirise/):
  dtm9149_rows_from_2900.f32   DTM lines 2900..8319, all 6749 samples, little-endian float32
                               (HTTP range read of the .IMG; commands in pipeline/terrain/README.md)
  PSP_009149_1750_RED_A_01_ORTHO.JP2 / .LBL

Output: data/demo/corridor/ (used by both normal and demo-safe mode; no network at runtime)
  manifest.json, overview.bin, overview.jpg, chunks/h_<i>_<j>.bin, chunks/t_<i>_<j>.jpg

Height files: gzip of row-delta-coded little-endian int16 over uint16 levels,
  elev_m = elev_min_m + level * elev_step_m. Rows run north to south, columns west to east.
"""

from __future__ import annotations

import gzip
import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "hirise"
OUT = ROOT / "data" / "demo" / "corridor"

# --- DTM label values (DTEEC_009149_1750_009294_1750_U01.IMG) ---
R_M = 3396190.0
DTM_SCALE = 1.0117467945795
DTM_LOFF = -273961.50000001
DTM_SOFF = 3319.5000000001
CENTER_LON = 137.41
DTM_SAMPLES = 6749
ROWS_FILE = RAW / "dtm9149_rows_from_2900.f32"
ROWS_FIRST_LINE = 2900
ROWS_COUNT = ROWS_FILE.stat().st_size // (4 * DTM_SAMPLES) if ROWS_FILE.exists() else 0
NODATA_BELOW = -9000.0

# --- registration to the Curiosity waypoint frame (DTM px = nominal px + shift) ---
REG_DS = -60
REG_DL = 14
REG_FIT = {"waypoints": 478, "residual_std_m": 2.35, "unshifted_std_m": 6.24, "median_dtm_minus_rover_m": 8.72}

# --- corridor, in DTM pixels ---
CHUNK = 256
NCX = 8
NCZ = 21
FRAME_S0 = 1045  # west edge, as a nominal (waypoint-frame) DTM sample
FRAME_L0 = 2900  # north edge, as a nominal (waypoint-frame) DTM line
S0 = FRAME_S0 + REG_DS  # first DTM sample actually read
L0 = FRAME_L0 + REG_DL  # first DTM line actually read
OVERVIEW_STEP = 8  # overview grid = every 8th vertex (~8 m)
TEX_PX = 512  # per-chunk imagery, ~0.5 m per pixel
OVERVIEW_TEX_DIV = 2  # overview imagery ~2 m per pixel (relative to DTM pixels)
FETCH_DATE = "2026-11-15"


def deg_per_px(scale: float) -> float:
    return math.degrees(scale / R_M)


def nominal_px_to_lonlat(s: float, l: float) -> tuple[float, float]:
    """Inverse of the label projection (pixel centres, 0-based), waypoint frame."""
    x = (s + 0.5 - DTM_SOFF) * DTM_SCALE
    y = (DTM_LOFF - l - 0.5) * DTM_SCALE
    return CENTER_LON + math.degrees(x / R_M), math.degrees(y / R_M)


def load_heights() -> np.ndarray:
    a = np.memmap(ROWS_FILE, dtype="<f4", mode="r", shape=(ROWS_COUNT, DTM_SAMPLES))
    nz, nx = NCZ * CHUNK + 1, NCX * CHUNK + 1
    r0 = L0 - ROWS_FIRST_LINE
    rows = np.clip(np.arange(nz) + r0, 0, ROWS_COUNT - 1)
    cols = np.clip(np.arange(nx) + S0, 0, DTM_SAMPLES - 1)
    g = np.array(a[rows][:, cols], dtype=np.float64)
    bad = ~((g > NODATA_BELOW) & (g < 0))
    holes = int(bad.sum())
    if holes:
        # Diffuse valid neighbours into small voids (none expected in this corridor).
        for _ in range(400):
            if not bad.any():
                break
            p = np.pad(np.where(bad, np.nan, g), 1, mode="edge")
            nb = np.stack([p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]])
            fill = np.nanmean(nb, axis=0)
            ok = bad & ~np.isnan(fill)
            g[ok] = fill[ok]
            bad &= ~ok
    return g, holes


def encode_levels(levels: np.ndarray) -> bytes:
    lv = levels.astype(np.int32)
    d = np.empty_like(lv)
    d[:, 0] = lv[:, 0]
    d[:, 1:] = np.diff(lv, axis=1)
    if d[:, 1:].min() < -32768 or d[:, 1:].max() > 32767:
        raise SystemExit("delta out of int16 range")
    # first column holds absolute uint16 levels; store them as uint16 bit pattern
    out = d.astype(np.int64)
    out[:, 0] = lv[:, 0]
    raw = (out & 0xFFFF).astype("<u2").tobytes()
    return gzip.compress(raw, compresslevel=9, mtime=0)


def ortho_label() -> dict:
    txt = (RAW / "PSP_009149_1750_RED_A_01_ORTHO.LBL").read_text(errors="replace")

    def num(key):
        m = re.search(rf"^\s*{key}\s*=\s*([-0-9.Ee+]+)", txt, re.M)
        if not m:
            raise SystemExit(f"ortho label missing {key}")
        return float(m.group(1))

    return {
        "scale": num("MAP_SCALE"),
        "loff": num("LINE_PROJECTION_OFFSET"),
        "soff": num("SAMPLE_PROJECTION_OFFSET"),
        "center_lon": num("CENTER_LONGITUDE"),
        "lines": int(num("LINES")),
        "samples": int(num("LINE_SAMPLES")),
    }


def dtm_px_to_ortho_px(s: float, l: float, ol: dict) -> tuple[float, float]:
    """DTM pixel (0-based centre) -> ortho pixel, via projected metres on the same ellipsoid."""
    x = (s + 0.5 - DTM_SOFF) * DTM_SCALE + R_M * math.radians(CENTER_LON - ol["center_lon"])
    y = (DTM_LOFF - l - 0.5) * DTM_SCALE
    return ol["soff"] + x / ol["scale"] - 0.5, ol["loff"] - y / ol["scale"] - 0.5


def mars_tint(gray: np.ndarray) -> np.ndarray:
    """Illustrative Mars colour ramp over greyscale HiRISE RED radiance (same idea as texture-relief)."""
    g = np.clip(gray.astype(np.float32) / 255.0, 0, 1)
    stops = np.array([0.0, 0.35, 0.7, 1.0], dtype=np.float32)
    cols = np.array([[46, 28, 20], [128, 78, 50], [196, 136, 92], [236, 196, 156]], dtype=np.float32)
    out = np.empty(g.shape + (3,), dtype=np.float32)
    for c in range(3):
        out[..., c] = np.interp(g, stops, cols[:, c])
    return np.clip(out, 0, 255).astype(np.uint8)


def write_jpeg(rgb: np.ndarray, path: Path, quality: int = 82) -> None:
    h, w, _ = rgb.shape
    with tempfile.NamedTemporaryFile(suffix=".ppm", delete=False) as f:
        f.write(f"P6 {w} {h} 255\n".encode())
        f.write(rgb.tobytes())
        tmp = f.name
    subprocess.run(["vips", "copy", tmp, f"{path}[Q={quality},strip]"], check=True)
    Path(tmp).unlink()


def read_pgm(path: Path) -> np.ndarray:
    data = path.read_bytes()
    # Header tokens may be separated by '#' comment lines (opj_decompress writes one).
    m = re.match(rb"P5(?:\s|#[^\n]*\n)+(\d+)(?:\s|#[^\n]*\n)+(\d+)(?:\s|#[^\n]*\n)+(\d+)\s", data)
    if not m:
        raise SystemExit(f"not a binary PGM: {path}")
    w, h, mx = int(m.group(1)), int(m.group(2)), int(m.group(3))
    body = data[m.end():]
    dt = np.uint8 if mx < 256 else ">u2"
    arr = np.frombuffer(body, dtype=dt, count=w * h).reshape(h, w)
    if mx >= 256:
        arr = (arr.astype(np.float32) * (255.0 / mx)).astype(np.uint8)
    return arr


def decode_ortho(ol: dict, reduce: int) -> tuple[np.ndarray, float, float]:
    """Decode the corridor window of the JP2 at 1/2**reduce resolution. Returns (img, ortho_s0, ortho_l0)."""
    s_a, l_a = dtm_px_to_ortho_px(S0 - 0.5, L0 - 0.5, ol)
    s_b, l_b = dtm_px_to_ortho_px(S0 + NCX * CHUNK - 0.5, L0 + NCZ * CHUNK - 0.5, ol)
    x0, y0 = int(math.floor(s_a + 0.5)), int(math.floor(l_a + 0.5))
    x1, y1 = int(math.ceil(s_b + 0.5)), int(math.ceil(l_b + 0.5))
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(ol["samples"], x1), min(ol["lines"], y1)
    tmpdir = Path(tempfile.mkdtemp(dir=RAW))
    out = tmpdir / "win.pgm"
    subprocess.run(
        [
            "opj_decompress", "-i", str(RAW / "PSP_009149_1750_RED_A_01_ORTHO.JP2"), "-o", str(out),
            "-d", f"{x0},{y0},{x1},{y1}", "-r", str(reduce), "-quiet",
        ],
        check=True,
    )
    img = read_pgm(out)
    shutil.rmtree(tmpdir)
    return img, x0, y0


def main() -> None:
    for p in (ROWS_FILE, RAW / "PSP_009149_1750_RED_A_01_ORTHO.JP2", RAW / "PSP_009149_1750_RED_A_01_ORTHO.LBL"):
        if not p.exists():
            sys.exit(f"missing input {p} (see pipeline/terrain/README.md for the download commands)")
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "chunks").mkdir(parents=True)

    # The DTM pixel under waypoint-frame pixel (s, l) is (s + REG_DS, l + REG_DL), so the grid
    # is read from (S0, L0) and its edges are reported at (FRAME_S0, FRAME_L0) in lon/lat.
    if L0 + NCZ * CHUNK + 1 > ROWS_FIRST_LINE + ROWS_COUNT:
        sys.exit(f"downloaded rows end at line {ROWS_FIRST_LINE + ROWS_COUNT}; need {L0 + NCZ * CHUNK + 1}")
    g, holes = load_heights()
    nz, nx = g.shape
    emin, emax = float(g.min()), float(g.max())
    lo = math.floor(emin) - 1.0
    step = (math.ceil(emax) + 1.0 - lo) / 65535.0
    levels = np.clip(np.round((g - lo) / step), 0, 65535).astype(np.uint16)

    for cj in range(NCZ):
        for ci in range(NCX):
            blk = levels[cj * CHUNK : cj * CHUNK + CHUNK + 1, ci * CHUNK : ci * CHUNK + CHUNK + 1]
            (OUT / "chunks" / f"h_{ci}_{cj}.bin").write_bytes(encode_levels(blk))

    # Overview: 8x8 box mean around every 8th vertex (keeps far terrain smooth, no aliasing).
    pad = np.pad(g, OVERVIEW_STEP // 2, mode="edge")
    k = OVERVIEW_STEP
    ov_rows = np.arange(0, nz, k)
    ov_cols = np.arange(0, nx, k)
    ov = np.zeros((ov_rows.size, ov_cols.size))
    for a, r in enumerate(ov_rows):
        band = pad[r : r + k + 1]
        for b, c in enumerate(ov_cols):
            ov[a, b] = band[:, c : c + k + 1].mean()
    ov_levels = np.clip(np.round((ov - lo) / step), 0, 65535).astype(np.uint16)
    (OUT / "overview.bin").write_bytes(encode_levels(ov_levels))

    # Imagery: 0.5 m chunks (reduce 1) and a ~2 m overview (reduce 3).
    ol = ortho_label()
    ratio = DTM_SCALE / ol["scale"]  # ortho px per DTM px (4.0)
    img, ox0, oy0 = decode_ortho(ol, 1)
    f = 2.0  # reduce 1
    for cj in range(NCZ):
        for ci in range(NCX):
            s_a, l_a = dtm_px_to_ortho_px(S0 + ci * CHUNK - 0.5, L0 + cj * CHUNK - 0.5, ol)
            px = (s_a + 0.5 - ox0) / f
            py = (l_a + 0.5 - oy0) / f
            size = CHUNK * ratio / f
            xs = np.clip((px + (np.arange(TEX_PX) + 0.5) * size / TEX_PX).astype(int), 0, img.shape[1] - 1)
            ys = np.clip((py + (np.arange(TEX_PX) + 0.5) * size / TEX_PX).astype(int), 0, img.shape[0] - 1)
            write_jpeg(mars_tint(img[np.ix_(ys, xs)]), OUT / "chunks" / f"t_{ci}_{cj}.jpg")
    del img
    img, ox0, oy0 = decode_ortho(ol, 3)
    f = 8.0
    tw, th = (NCX * CHUNK) // OVERVIEW_TEX_DIV, (NCZ * CHUNK) // OVERVIEW_TEX_DIV
    s_a, l_a = dtm_px_to_ortho_px(S0 - 0.5, L0 - 0.5, ol)
    px, py = (s_a + 0.5 - ox0) / f, (l_a + 0.5 - oy0) / f
    span_x, span_y = NCX * CHUNK * ratio / f, NCZ * CHUNK * ratio / f
    xs = np.clip((px + (np.arange(tw) + 0.5) * span_x / tw).astype(int), 0, img.shape[1] - 1)
    ys = np.clip((py + (np.arange(th) + 0.5) * span_y / th).astype(int), 0, img.shape[0] - 1)
    write_jpeg(mars_tint(img[np.ix_(ys, xs)]), OUT / "overview.jpg", quality=80)

    # Bounds in the waypoint frame (pixel edges of the corridor).
    west, north = nominal_px_to_lonlat(FRAME_S0 - 0.5, FRAME_L0 - 0.5)
    east, south = nominal_px_to_lonlat(FRAME_S0 + NCX * CHUNK - 0.5, FRAME_L0 + NCZ * CHUNK - 0.5)
    lat_mid = 0.5 * (north + south)
    manifest = {
        "contract": "martian-mappers.corridor.v1",
        "note": (
            "Real HiRISE 1 m DTM and 25 cm orthoimage (shown at ~0.5 m), chunked for streaming. "
            "Co-registered to the Curiosity waypoint frame by a constant shift fitted to rover waypoints. "
            "Colour is an illustrative Mars tint over greyscale HiRISE RED imagery."
        ),
        "sources": [
            {
                "name": "HiRISE DTM DTEEC_009149_1750_009294_1750_U01",
                "product_id": "DTEEC_009149_1750_009294_1750_U01",
                "url": "https://hirise-pds.lpl.arizona.edu/PDS/DTM/PSP/ORB_009100_009199/PSP_009149_1750_PSP_009294_1750/DTEEC_009149_1750_009294_1750_U01.IMG",
                "fetch_date": FETCH_DATE,
                "used_for": "corridor elevation (lines %d-%d, samples %d-%d)" % (L0, L0 + NCZ * CHUNK, S0, S0 + NCX * CHUNK),
            },
            {
                "name": "HiRISE orthoimage PSP_009149_1750_RED_A_01_ORTHO (25 cm)",
                "product_id": "PSP_009149_1750_RED_A_01_ORTHO",
                "url": "https://hirise-pds.lpl.arizona.edu/PDS/DTM/PSP/ORB_009100_009199/PSP_009149_1750_PSP_009294_1750/PSP_009149_1750_RED_A_01_ORTHO.JP2",
                "fetch_date": FETCH_DATE,
                "used_for": "chunk imagery (~0.5 m) and overview imagery (~2 m)",
            },
            {
                "name": "MSL Curiosity waypoints (registration fit)",
                "url": "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json",
                "fetch_date": FETCH_DATE,
                "used_for": "constant horizontal shift between the waypoint frame and the DTM",
            },
        ],
        "frame": "Curiosity waypoint (MSL localisation) lon/lat, planetocentric, east-positive",
        "registration": {"dtm_sample_shift": REG_DS, "dtm_line_shift": REG_DL, **REG_FIT},
        "bounds": {"west_lon_deg": west, "east_lon_deg": east, "south_lat_deg": south, "north_lat_deg": north},
        "dtm_pixel_m": DTM_SCALE,
        "world_size_m": {
            "x": NCX * CHUNK * DTM_SCALE * math.cos(math.radians(lat_mid)),
            "z": NCZ * CHUNK * DTM_SCALE,
        },
        "chunk_px": CHUNK,
        "chunks_x": NCX,
        "chunks_z": NCZ,
        "chunk_tex_px": TEX_PX,
        "grid_vertices": {"x": nx, "z": nz},
        "overview_step": OVERVIEW_STEP,
        "overview_vertices": {"x": int(ov_cols.size), "z": int(ov_rows.size)},
        "elev_min_m": lo,
        "elev_step_m": step,
        "elev_range_m": [emin, emax],
        "void_cells_filled": holes,
        "height_encoding": "gzip(int16 little-endian row deltas over uint16 levels; first column absolute uint16)",
        "files": {"overview_height": "overview.bin", "overview_texture": "overview.jpg", "chunk_height": "chunks/h_{i}_{j}.bin", "chunk_texture": "chunks/t_{i}_{j}.jpg"},
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    total = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    print(f"corridor written: {NCX}x{NCZ} chunks, elev {emin:.1f}..{emax:.1f} m, holes filled {holes}, {total/1e6:.1f} MB")


if __name__ == "__main__":
    main()
