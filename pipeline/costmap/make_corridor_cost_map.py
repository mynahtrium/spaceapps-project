"""Corridor slope / hazard cost map (~5 m cells) from the same DTM as the streamed 3D terrain.

Reads the corridor window through pipeline/terrain/build_corridor.py (DTEEC_009149, co-registered
to the Curiosity waypoint frame) so routing runs on exactly the ground the walker stands on.

Writes (data/processed/terrain/):
  cost-map.json       martian-mappers.cost-map.v1 shape, now covering habitat -> Glen Torridon
  height-preview.png  8-bit RGB, value = R*256 + G over height_preview_elevation_range_m
  slope-preview.png   slope classes (green <=10, amber 10-15, red 15-20, dark > 20 deg)
  texture-relief.jpg  copy of the corridor overview imagery (illustrative Mars tint)
  ortho-preview.png   greyscale overview imagery

Cost per cell (AGENTS.md): 1 + (slope/10 deg)^2 + k_rough * TRI; blocked if slope > 20 deg.
Slope limits are illustrative lunar stand-ins, not a Mars limit.
"""

from __future__ import annotations

import importlib.util
import json
import math
import shutil
import struct
import subprocess
import zlib
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "processed" / "terrain"
CORRIDOR = ROOT / "data" / "demo" / "corridor"

_spec = importlib.util.spec_from_file_location("build_corridor", ROOT / "pipeline" / "terrain" / "build_corridor.py")
bc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bc)

BLOCK = 5  # DTM pixels per cost cell (~5.06 m)
SLOPE_LIMIT = 20.0
K_ROUGH = 0.05
BLOCKED = 9e99


def write_png_rgb(path: Path, rgb: np.ndarray) -> None:
    h, w, _ = rgb.shape
    raw = b"".join(b"\x00" + rgb[y].astype(np.uint8).tobytes() for y in range(h))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> None:
    manifest = json.loads((CORRIDOR / "manifest.json").read_text())
    g, _ = bc.load_heights()  # (nz, nx) vertex grid, metres
    g = g[:-1, :-1]  # drop the shared edge row/col -> 5376 x 2048 pixels
    nz, nx = g.shape
    rows, cols = nz // BLOCK, nx // BLOCK
    blk = g[: rows * BLOCK, : cols * BLOCK].reshape(rows, BLOCK, cols, BLOCK).mean(axis=(1, 3))

    lat_mid = 0.5 * (manifest["bounds"]["north_lat_deg"] + manifest["bounds"]["south_lat_deg"])
    cell_z = BLOCK * bc.DTM_SCALE
    cell_x = BLOCK * bc.DTM_SCALE * math.cos(math.radians(lat_mid))
    dzdr, dzdc = np.gradient(blk, cell_z, cell_x)
    slope = np.degrees(np.arctan(np.hypot(dzdr, dzdc)))
    pad = np.pad(blk, 1, mode="edge")
    tri = np.zeros_like(blk)
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr or dc:
                tri += np.abs(pad[1 + dr : 1 + dr + rows, 1 + dc : 1 + dc + cols] - blk)
    tri /= 8.0
    cost = 1.0 + (slope / 10.0) ** 2 + K_ROUGH * tri
    cost = np.where(slope > SLOPE_LIMIT, BLOCKED, cost)

    b = manifest["bounds"]
    dlon = (b["east_lon_deg"] - b["west_lon_deg"]) * (cols * BLOCK) / nx
    dlat = (b["north_lat_deg"] - b["south_lat_deg"]) * (rows * BLOCK) / nz
    bounds = {
        "west_lon_deg": b["west_lon_deg"],
        "south_lat_deg": b["north_lat_deg"] - dlat,
        "east_lon_deg": b["west_lon_deg"] + dlon,
        "north_lat_deg": b["north_lat_deg"],
    }
    emin, emax = float(blk.min()), float(blk.max())
    zlo, zhi = math.floor(emin) - 1.0, math.ceil(emax) + 1.0

    old = json.loads((OUT / "cost-map.json").read_text())
    cm = {
        "contract": "martian-mappers.cost-map.v1",
        "sources": manifest["sources"][:1] + manifest["sources"][2:],
        "status": (
            "Corridor crop from the habitat / boxwork stops north to the Glen Torridon drill sites "
            "(Glen Etive 1, Mary Anning 3). Same DTM and registration as the streamed 3D terrain."
        ),
        "crs": "mars-geographic-planetocentric",
        "mars_radius_km": 3389.5,
        "mars_radius_equatorial_km": 3396.19,
        "cell_size_m": round(cell_z, 4),
        "grid": {"ncols": cols, "nrows": rows, "row_major": "north_to_south"},
        "bounds": bounds,
        "dtm_product_id": "DTEEC_009149_1750_009294_1750_U01",
        "registration_note": (
            "Shifted %+d samples / %+d lines into the Curiosity waypoint frame (fit to %d waypoints, "
            "residual std %.2f m)." % (
                manifest["registration"]["dtm_sample_shift"], manifest["registration"]["dtm_line_shift"],
                manifest["registration"]["waypoints"], manifest["registration"]["residual_std_m"],
            )
        ),
        "resample_note": "1 m DTM block-averaged to 5 x 5 pixel cells (~5.06 m); no void cells in this corridor.",
        "slope_limit_deg": SLOPE_LIMIT,
        "slope_limit_strict_deg": 15,
        "slope_limit_note": old.get("slope_limit_note"),
        "slope_classes": old.get("slope_classes"),
        "cost_formula": old.get("cost_formula"),
        "k_rough_example": K_ROUGH,
        "roughness_note": old.get("roughness_note"),
        "tilt_validation_note": old.get("tilt_validation_note"),
        "preview_png_relpath": "data/processed/terrain/slope-preview.png",
        "height_preview_png_relpath": "data/processed/terrain/height-preview.png",
        "height_preview_elevation_range_m": [zlo, zhi],
        "cost_row_major": [round(float(v), 3) if v < BLOCKED else BLOCKED for v in cost.ravel()],
        "blocked_sentinel": BLOCKED,
        "units": old.get("units"),
        "height_preview_encoding": old.get("height_preview_encoding"),
        "slope_stats": {
            "share_gt_15_deg": round(float((slope > 15).mean()), 4),
            "share_gt_20_deg": round(float((slope > 20).mean()), 4),
            "median_deg": round(float(np.median(slope)), 2),
        },
    }
    (OUT / "cost-map.json").write_text(json.dumps(cm, separators=(",", ":")) + "\n")

    val = np.clip(np.round((blk - zlo) / (zhi - zlo) * 65535), 1, 65535).astype(np.int64)
    write_png_rgb(OUT / "height-preview.png", np.stack([val >> 8, val & 255, np.zeros_like(val)], axis=-1))
    cls = np.zeros(slope.shape + (3,), dtype=np.uint8)
    cls[...] = (34, 197, 94)
    cls[slope > 10] = (245, 158, 11)
    cls[slope > 15] = (239, 68, 68)
    cls[slope > 20] = (60, 20, 20)
    write_png_rgb(OUT / "slope-preview.png", cls)
    shutil.copyfile(CORRIDOR / "overview.jpg", OUT / "texture-relief.jpg")
    subprocess.run(
        ["vips", "colourspace", str(CORRIDOR / "overview.jpg"), str(OUT / "ortho-preview.png"), "b-w"],
        check=True, stderr=subprocess.DEVNULL,
    )
    print(f"cost map {cols}x{rows} cells, slope median {cm['slope_stats']['median_deg']} deg, "
          f">20 deg {100 * cm['slope_stats']['share_gt_20_deg']:.1f}%")


if __name__ == "__main__":
    main()
