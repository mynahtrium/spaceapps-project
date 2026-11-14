"""MUST-01: crop HiRISE DTEEC_019698, average-resample to ~5 m, compute slope, write a preview.

Usage (from repo root):
    .venv/Scripts/python pipeline/terrain/make_slope.py [--lat -4.83] [--lon 137.39] [--half-km 1.0]

Outputs:
    data/raw/terrain/dtm_crop_1m.tif          (gitignored)
    data/processed/terrain/slope-preview.png  (class colours)
    data/processed/terrain/slope_stats.json

The crop centre is a placeholder near Curiosity's Sol 5070 position until the stops are locked (PRE-07).
Slope limits are lunar stand-ins; DTM slope vs rover tilt is only a weak match (see tilt_check.py).
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window
from skimage.io import imsave

DTM_URL = (
    "https://hirise-pds.lpl.arizona.edu/PDS/DTM/ESP/ORB_019600_019699/"
    "ESP_019698_1750_ESP_019988_1750/DTEEC_019698_1750_019988_1750_U01.IMG"
)
MARS_R_M = 3396190.0  # radius used by the DTM label
LON0 = 137.38  # central meridian of the DTM projection
CELL_M = 5  # target cell size in metres
ROOT = Path(__file__).resolve().parents[2]


def lonlat_to_xy(lon, lat):
    k = MARS_R_M * math.pi / 180.0
    return (lon - LON0) * k, lat * k


def block_mean(a, f):
    """Average f x f blocks; a cell needs at least half valid pixels, else NaN."""
    h, w = (a.shape[0] // f) * f, (a.shape[1] // f) * f
    b = a[:h, :w].reshape(h // f, f, w // f, f)
    valid = np.isfinite(b)
    cnt = valid.sum(axis=(1, 3))
    s = np.where(valid, b, 0).sum(axis=(1, 3))
    out = np.full(cnt.shape, np.nan, dtype="float32")
    ok = cnt >= (f * f) // 2
    out[ok] = s[ok] / cnt[ok]
    return out


def slope_deg(z, cell):
    dzdy, dzdx = np.gradient(z, cell)
    return np.degrees(np.arctan(np.hypot(dzdx, dzdy)))


def classify(s):
    c = np.full(s.shape, 4, dtype="uint8")  # 4 = no data
    ok = np.isfinite(s)
    c[ok & (s <= 10)] = 0
    c[ok & (s > 10) & (s <= 15)] = 1
    c[ok & (s > 15) & (s <= 20)] = 2
    c[ok & (s > 20)] = 3  # blocked
    return c


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lat", type=float, default=-4.83)
    ap.add_argument("--lon", type=float, default=137.39)
    ap.add_argument("--half-km", type=float, default=1.0)
    a = ap.parse_args()

    raw = ROOT / "data/raw/terrain"
    out = ROOT / "data/processed/terrain"
    raw.mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)

    cx, cy = lonlat_to_xy(a.lon, a.lat)
    half = a.half_km * 1000
    with rasterio.open("/vsicurl/" + DTM_URL) as ds:
        res = ds.res[0]
        r0, c0 = ds.index(cx - half, cy + half)
        r1, c1 = ds.index(cx + half, cy - half)
        win = Window(c0, r0, c1 - c0, r1 - r0)
        z = ds.read(1, window=win).astype("float32")
        nodata = ds.nodata
        profile = ds.profile | {
            "driver": "GTiff",
            "height": z.shape[0],
            "width": z.shape[1],
            "transform": ds.window_transform(win),
        }
    z[z == nodata] = np.nan
    z[z < -1e6] = np.nan
    with rasterio.open(raw / "dtm_crop_1m.tif", "w", **profile) as dst:
        dst.write(np.where(np.isfinite(z), z, nodata).astype("float32"), 1)

    f = max(1, round(CELL_M / res))
    zc = block_mean(z, f)
    cell = f * res
    s = slope_deg(zc, cell)
    cls = classify(s)

    palette = np.array(
        [[46, 160, 67], [240, 180, 40], [220, 80, 50], [30, 30, 30], [120, 120, 120]],
        dtype="uint8",
    )
    imsave(out / "slope-preview.png", palette[cls], check_contrast=False)

    valid = np.isfinite(s)
    stats = {
        "status": "first-pass preview, not validated",
        "crop_centre_lat_lon": [a.lat, a.lon],
        "half_size_km": a.half_km,
        "native_res_m": res,
        "cell_size_m": cell,
        "shape_rows_cols": list(s.shape),
        "mars_radius_m": MARS_R_M,
        "valid_fraction": float(valid.mean()),
        "slope_median_deg": float(np.nanmedian(s)) if valid.any() else None,
        "share_gt_15_deg": float((s[valid] > 15).mean()) if valid.any() else None,
        "share_gt_20_deg": float((s[valid] > 20).mean()) if valid.any() else None,
        "classes": "0 <=10, 1 10-15, 2 15-20, 3 >20 (blocked), 4 no data",
        "note": "Lunar slope limits are stand-ins; DTM slope is only weakly matched to rover tilt (MUST-03).",
    }
    (out / "slope_stats.json").write_text(json.dumps(stats, indent=2) + "\n")
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
