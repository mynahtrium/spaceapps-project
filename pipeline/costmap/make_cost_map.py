"""MUST-02: cost / hazard map and a height preview for the 3D view.

Usage (from repo root):
    python3 pipeline/costmap/make_cost_map.py

The grid covers the example stops already in the repo (same window as
pipeline/terrain/make_slope.py). Those ids are examples. This does not
lock outcrops (PRE-07) and does not invent official names.

If data/raw/terrain/dtm_crop_1m.tif already covers that window it is
reused. Otherwise the script reads DTEEC_019698 over HTTP. The GeoTIFF
stays gitignored.

Outputs (data/processed/terrain/):
    cost-map.json       contract: docs/contracts/cost-map.json (cost is a multiplier; 9e99 = blocked)
    height-preview.png  16-bit height, scaled over height_preview_elevation_range_m
"""
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window
from skimage.io import imsave

_HERE = Path(__file__).resolve().parent
_TERRAIN = _HERE.parent / "terrain"
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_TERRAIN))
from crop_window import crop_xy, load_example_stops, xy_to_lonlat  # noqa: E402
from make_slope import CELL_M, block_mean, slope_deg  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DTM_URL = (
    "https://hirise-pds.lpl.arizona.edu/PDS/DTM/ESP/ORB_019600_019699/"
    "ESP_019698_1750_ESP_019988_1750/DTEEC_019698_1750_019988_1750_U01.IMG"
)
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


def read_stop_window(stops, half):
    """Read the 1 m DTM for the example-stop window. Reuse a local crop when it covers it."""
    cx, cy, half = crop_xy(stops, min_half_m=half)
    west, north = cx - half, cy + half
    east, south = cx + half, cy - half
    raw_dir = ROOT / "data/raw/terrain"
    raw_dir.mkdir(parents=True, exist_ok=True)
    tif = raw_dir / "dtm_crop_1m.tif"
    source = "/vsicurl/" + DTM_URL
    if tif.is_file():
        with rasterio.open(tif) as ds:
            b = ds.bounds
            if b.left <= west + ds.res[0] and b.bottom <= south + ds.res[0] and b.right >= east - ds.res[0] and b.top >= north - ds.res[0]:
                source = tif
    with rasterio.open(source) as ds:
        r0, c0 = ds.index(west, north)
        r1, c1 = ds.index(east, south)
        if r0 < 0 or c0 < 0 or r1 > ds.height or c1 > ds.width or r1 <= r0 or c1 <= c0:
            raise SystemExit(f"cost-map window falls outside the DTM ({r0},{c0})-({r1},{c1})")
        for stop in stops:
            row, col = ds.index(stop["x"], stop["y"])
            if not (r0 <= row < r1 and c0 <= col < c1):
                raise SystemExit(f"example stop {stop['id']} from {stop['source']} is outside the cost grid")
        win = Window(c0, r0, c1 - c0, r1 - r0)
        z = ds.read(1, window=win).astype("float32")
        nodata = ds.nodata
        transform = ds.window_transform(win)
        res = ds.res[0]
        profile = ds.profile | {
            "driver": "GTiff",
            "height": z.shape[0],
            "width": z.shape[1],
            "transform": transform,
        }
    if source != tif:
        finite = np.where(np.isfinite(z) & (z > -1e6), z, nodata).astype("float32")
        with rasterio.open(tif, "w", **profile) as dst:
            dst.write(finite, 1)
    return z, nodata, res, transform


def main():
    out = ROOT / "data/processed/terrain"
    out.mkdir(parents=True, exist_ok=True)

    stops = load_example_stops(ROOT)
    _cx, _cy, half = crop_xy(stops)
    z, nodata, res, t = read_stop_window(stops, half)
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
    for stop in stops:
        col = int((stop["x"] - west) / cell)
        row = int((north - stop["y"]) / cell)
        if not (0 <= row < zc.shape[0] and 0 <= col < zc.shape[1]):
            raise SystemExit(f"example stop {stop['id']} from {stop['source']} is outside the ~5 m cost grid")
        print(stop["source"], stop["id"], "cell", row, col, "slope", float(s[row, col]), "cost", float(cost[row, col]))

    cost_map = {
        "contract": "martian-mappers.cost-map.v1",
        "status": "example-stop crop, not a locked route (PRE-07 still open). Covers every example point in docs/contracts/stops.json and data/processed/routing/stops.json. The contract example boxwork point can still fall in a blocked cell. Matching slope and ortho previews are on branch backend/terrain.",
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
