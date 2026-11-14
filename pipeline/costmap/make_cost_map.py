"""MUST-02: cost / hazard map and a height preview for the 3D view.

Run make_slope.py first (it writes data/raw/terrain/dtm_crop_1m.tif).

Usage (from repo root):
    python3 pipeline/costmap/make_cost_map.py

Outputs (data/processed/terrain/):
    cost-map.json       contract: docs/contracts/cost-map.json (cost is a multiplier; 9e99 = blocked)
    height-preview.png  16-bit height, scaled over height_preview_elevation_range_m
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
import rasterio
from skimage.io import imsave

_TERRAIN = Path(__file__).resolve().parents[1] / "terrain"
sys.path.insert(0, str(_TERRAIN))
from make_slope import CELL_M, LON0, MARS_R_M, block_mean, slope_deg  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SLOPE_LIMIT_DEG = 20.0  # illustrative lunar stand-in
K_ROUGH = 0.05
BLOCKED = 9e99


def roughness_tri(z):
    """Terrain Ruggedness Index: mean absolute elevation difference to the 8 neighbours (m)."""
    p = np.pad(z, 1, mode="edge")
    h, w = z.shape
    diffs = [
        np.abs(p[1 + dy : 1 + dy + h, 1 + dx : 1 + dx + w] - z)
        for dy in (-1, 0, 1)
        for dx in (-1, 0, 1)
        if (dy, dx) != (0, 0)
    ]
    return np.mean(diffs, axis=0)


def xy_to_lonlat(x, y):
    k = MARS_R_M * math.pi / 180.0
    return x / k + LON0, y / k


def main():
    raw = ROOT / "data/raw/terrain/dtm_crop_1m.tif"
    out = ROOT / "data/processed/terrain"
    out.mkdir(parents=True, exist_ok=True)

    with rasterio.open(raw) as ds:
        z = ds.read(1).astype("float32")
        nodata = ds.nodata
        res = ds.res[0]
        t = ds.transform
    z[z == nodata] = np.nan
    z[z < -1e6] = np.nan

    f = max(1, round(CELL_M / res))
    zc = block_mean(z, f)
    cell = f * res
    s = slope_deg(zc, cell)
    rough = roughness_tri(zc)

    # float64: the 9e99 sentinel overflows float32 to inf (invalid in JSON)
    cost = (1 + (s / 10.0) ** 2 + K_ROUGH * rough).astype("float64")
    blocked = ~np.isfinite(s) | ~np.isfinite(rough) | (s > SLOPE_LIMIT_DEG)
    cost = np.where(blocked, BLOCKED, np.round(cost, 2))

    zmin, zmax = float(np.nanmin(zc)), float(np.nanmax(zc))
    h16 = np.where(np.isfinite(zc), (zc - zmin) / (zmax - zmin), 0) * 65535
    imsave(out / "height-preview.png", h16.astype("uint16"), check_contrast=False)

    west, north = t.c, t.f
    east, south = west + zc.shape[1] * cell, north - zc.shape[0] * cell
    w_lon, n_lat = xy_to_lonlat(west, north)
    e_lon, s_lat = xy_to_lonlat(east, south)

    cost_map = {
        "contract": "martian-mappers.cost-map.v1",
        "status": "first-pass, not validated (crop centre is a placeholder until stops are locked)",
        "crs": "mars-geographic-planetocentric",
        "mars_radius_km": 3389.5,
        "mars_radius_equatorial_km": 3396.19,
        "cell_size_m": round(cell, 3),
        "grid": {"ncols": int(zc.shape[1]), "nrows": int(zc.shape[0]), "row_major": "north_to_south"},
        "bounds": {
            "west_lon_deg": round(w_lon, 6),
            "south_lat_deg": round(s_lat, 6),
            "east_lon_deg": round(e_lon, 6),
            "north_lat_deg": round(n_lat, 6),
        },
        "dtm_product_id_planned": "DTEEC_019698_1750_019988_1750_U01",
        "resample_note": "1 m DTM block-averaged to ~5 m cells; cells with fewer than half valid pixels are no-data.",
        "slope_limit_deg": 20,
        "slope_limit_strict_deg": 15,
        "slope_limit_note": "Illustrative lunar stand-ins (EVA ConOps up to 20 deg; LPSC 2023 #1413 used a 15 deg penalty). No Mars-specific limit was found. Say so in the UI.",
        "slope_classes": [
            {"id": "green", "max_deg": 10, "meaning": "preferred"},
            {"id": "amber", "min_deg": 10, "max_deg": 15, "meaning": "caution"},
            {"id": "red", "min_deg": 15, "max_deg": 20, "meaning": "steep"},
            {"id": "blocked", "min_deg": 20, "meaning": "impassable in this setting, plus no-data"},
        ],
        "cost_formula": "1 + (slope_deg / 10)^2 + k_rough * roughness_m; multiply by step length when routing; blocked if slope > limit or no-data",
        "k_rough_example": K_ROUGH,
        "roughness_note": "roughness = TRI (mean absolute elevation difference to 8 neighbours, metres) on the ~5 m grid",
        "tilt_validation_note": "MUST-03 (14 Nov 2026, 176 Curiosity waypoints, Sol 4400-5073, see tilt-check.json): median DTM slope 9.0 deg at 5 m vs median rover tilt 8.6 deg, so no systematic under-read at this scale, but correlation is weak (r about 0.15) and rovers pick gentle ground. The 11 Nov planning check had found the 1 m DTM under-reading tilt at four boxwork Sols (4-10 deg vs 9-17 deg). Keep a safety margin and say so; do not call the cost map validated.",
        "preview_png_relpath": "data/processed/terrain/slope-preview.png",
        "height_preview_png_relpath": "data/processed/terrain/height-preview.png",
        "height_preview_elevation_range_m": [round(zmin, 1), round(zmax, 1)],
        "cost_row_major": [float(v) for v in cost.ravel()],
        "blocked_sentinel": BLOCKED,
        "units": {"cost": "relative", "slope": "degrees"},
    }
    (out / "cost-map.json").write_text(json.dumps(cost_map, separators=(",", ":")) + "\n")
    print("grid", zc.shape, "blocked share", float((cost >= BLOCKED).mean()), "elev", zmin, zmax)


if __name__ == "__main__":
    main()
