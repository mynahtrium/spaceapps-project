"""MUST-01: crop HiRISE DTEEC_019698 around the example stops, resample, write slope.

Usage (from repo root):
    python3 pipeline/terrain/make_slope.py [--min-half-km 1.0]

The window is the bounding box of the example stops in
docs/contracts/stops.json and data/processed/routing/stops.json, expanded
to at least 2 km across. Those ids are examples. This does not lock
outcrops (PRE-07) and does not invent official names.

Outputs:
    data/raw/terrain/dtm_crop_1m.tif          (gitignored)
    data/processed/terrain/slope-preview.png  (class colours)
    data/processed/terrain/slope_stats.json

Slope limits are lunar stand-ins; DTM slope vs rover tilt is only a weak match (see data/processed/terrain/tilt-check.json).
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window
from skimage.io import imsave

sys.path.insert(0, str(Path(__file__).resolve().parent))
from crop_window import LON0, MARS_R_M, crop_xy, load_example_stops, lonlat_to_xy, xy_to_lonlat  # noqa: E402

DTM_URL = (
    "https://hirise-pds.lpl.arizona.edu/PDS/DTM/ESP/ORB_019600_019699/"
    "ESP_019698_1750_ESP_019988_1750/DTEEC_019698_1750_019988_1750_U01.IMG"
)
CELL_M = 5  # target cell size in metres
ROOT = Path(__file__).resolve().parents[2]


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
    ap.add_argument("--min-half-km", type=float, default=1.0)
    a = ap.parse_args()

    raw = ROOT / "data/raw/terrain"
    out = ROOT / "data/processed/terrain"
    raw.mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)

    stops = load_example_stops(ROOT)
    cx, cy, half = crop_xy(stops, min_half_m=a.min_half_km * 1000.0)
    centre_lon, centre_lat = xy_to_lonlat(cx, cy)
    covered = []
    # Prefer the local row band from fetch_dtm.py (the PDS server drops long range reads).
    local_dtm = ROOT / "data/raw/terrain" / DTM_URL.rsplit("/", 1)[-1]
    dtm_path = str(local_dtm) if local_dtm.exists() else "/vsicurl/" + DTM_URL
    with rasterio.open(dtm_path) as ds:
        res = ds.res[0]
        west, north = cx - half, cy + half
        east, south = cx + half, cy - half
        r0, c0 = ds.index(west, north)
        r1, c1 = ds.index(east, south)
        if r0 < 0 or c0 < 0 or r1 > ds.height or c1 > ds.width or r1 <= r0 or c1 <= c0:
            raise SystemExit(f"crop window falls outside the DTM ({r0},{c0})-({r1},{c1})")
        for stop in stops:
            row, col = ds.index(stop["x"], stop["y"])
            inside = r0 <= row < r1 and c0 <= col < c1
            covered.append({
                "id": stop["id"],
                "lon": round(stop["lon"], 7),
                "lat": round(stop["lat"], 7),
                "source": stop["source"],
                "inside_crop": bool(inside),
            })
        missed = [item["id"] for item in covered if not item["inside_crop"]]
        if missed:
            raise SystemExit("example stops outside the crop: " + ", ".join(missed))
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
        "status": "example-stop crop, not a locked route (PRE-07 still open)",
        "dtm_product_id": "DTEEC_019698_1750_019988_1750_U01",
        "crop_centre_lat_lon": [round(centre_lat, 6), round(centre_lon, 6)],
        "half_size_km": round(half / 1000.0, 3),
        "native_res_m": res,
        "cell_size_m": cell,
        "shape_rows_cols": list(s.shape),
        "mars_radius_m": MARS_R_M,
        "example_stops": covered,
        "valid_fraction": float(valid.mean()),
        "slope_median_deg": float(np.nanmedian(s)) if valid.any() else None,
        "share_gt_15_deg": float((s[valid] > 15).mean()) if valid.any() else None,
        "share_gt_20_deg": float((s[valid] > 20).mean()) if valid.any() else None,
        "classes": "0 <=10, 1 10-15, 2 15-20, 3 >20 (blocked), 4 no data",
        "note": "Window covers example stop points already in the repo. Ids are not official outcrop names. Lunar slope limits are stand-ins. MUST-03 found no systematic DTM under-read at ~5 m over 176 waypoints, with weak correlation; keep a safety margin.",
    }
    (out / "slope_stats.json").write_text(json.dumps(stats, indent=2) + "\n")
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
