"""MUST-03: compare HiRISE DTM slope with Curiosity's reported tilt at its waypoints.

Downloads MSL_waypoints.json into data/raw/terrain/ if missing, reads one DTM window
covering the selected waypoints (HTTP range reads), and samples slope at two scales:
  * 1 m  (native DTM grid)
  * ~5 m (5 x 5 moving average, the same scale as cost-map.json)

Usage (from repo root):
    .venv/Scripts/python pipeline/terrain/tilt_check.py [--min-sol 4400]

Output:
    data/processed/terrain/tilt-check.json

Rover tilt is the body tilt over a ~3 m wheelbase, so it is not the same quantity as
terrain slope; waypoint positions may also be offset from the DTM by a few metres.
Treat the result as a calibration hint, not a validation.
"""
import argparse
import json
import sys
from pathlib import Path

import httpx
import numpy as np
import rasterio
from rasterio.windows import Window
from scipy.ndimage import uniform_filter
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
from pipeline.terrain.make_slope import DTM_URL  # noqa: E402
from pipeline.terrain.crop_window import lonlat_to_xy  # noqa: E402
from pipeline.terrain.terrain_ops import slope_deg as _xr_slope_deg  # noqa: E402

WAYPOINTS_URL = "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json"
ROOT = Path(__file__).resolve().parents[2]
MARGIN_M = 20


@retry(
    reraise=True,
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    retry=retry_if_exception_type(httpx.HTTPError),
)
def _fetch_waypoints_json(url: str) -> bytes:
    with httpx.Client(follow_redirects=True, timeout=30.0) as client:
        resp = client.get(url)
        resp.raise_for_status()
        return resp.content


def load_waypoints(path):
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(_fetch_waypoints_json(WAYPOINTS_URL))
    feats = json.loads(path.read_text())["features"]
    return [f["properties"] for f in feats]


def slope_deg(z, cell):
    return _xr_slope_deg(z, cell)


def summary(dtm, tilt):
    ok = np.isfinite(dtm)
    d, t = dtm[ok], tilt[ok]
    diff = t - d
    return {
        "n": int(ok.sum()),
        "dtm_slope_median_deg": round(float(np.median(d)), 2),
        "rover_tilt_median_deg": round(float(np.median(t)), 2),
        "tilt_minus_dtm_median_deg": round(float(np.median(diff)), 2),
        "tilt_minus_dtm_p25_p75_deg": [round(float(np.percentile(diff, q)), 2) for q in (25, 75)],
        "share_dtm_below_tilt": round(float((diff > 0).mean()), 3),
        "pearson_r": round(float(np.corrcoef(d, t)[0, 1]), 3),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-sol", type=int, default=4400)
    a = ap.parse_args()

    wps = load_waypoints(ROOT / "data/raw/terrain/MSL_waypoints.json")
    wps = [
        p for p in wps
        if p["sol"] >= a.min_sol and p.get("tilt") is not None
        and -5.04 <= p["lat"] <= -4.73 and 137.31 <= p["lon"] <= 137.44
    ]
    xy = np.array([lonlat_to_xy(p["lon"], p["lat"]) for p in wps])

    with rasterio.open("/vsicurl/" + DTM_URL) as ds:
        res = ds.res[0]
        r0, c0 = ds.index(xy[:, 0].min() - MARGIN_M, xy[:, 1].max() + MARGIN_M)
        r1, c1 = ds.index(xy[:, 0].max() + MARGIN_M, xy[:, 1].min() - MARGIN_M)
        win = Window(c0, r0, c1 - c0, r1 - r0)
        z = ds.read(1, window=win).astype("float64")
        nodata = ds.nodata
        inv = ~ds.window_transform(win)
    z[(z == nodata) | (z < -1e6)] = np.nan

    s1 = slope_deg(z, res)
    z5 = uniform_filter(np.nan_to_num(z, nan=np.nanmean(z)), size=5)
    s5 = slope_deg(z5, res)
    s5[~np.isfinite(z)] = np.nan

    rows = []
    for p, (x, y) in zip(wps, xy):
        c, r = inv * (x, y)
        r, c = int(round(r)), int(round(c))
        inside = 0 <= r < z.shape[0] and 0 <= c < z.shape[1]
        rows.append({
            "sol": p["sol"],
            "lat": p["lat"],
            "lon": p["lon"],
            "rover_tilt_deg": p["tilt"],
            "dtm_slope_1m_deg": round(float(s1[r, c]), 2) if inside and np.isfinite(s1[r, c]) else None,
            "dtm_slope_5m_deg": round(float(s5[r, c]), 2) if inside and np.isfinite(s5[r, c]) else None,
        })

    tilt = np.array([r["rover_tilt_deg"] for r in rows], dtype=float)
    d1 = np.array([np.nan if r["dtm_slope_1m_deg"] is None else r["dtm_slope_1m_deg"] for r in rows])
    d5 = np.array([np.nan if r["dtm_slope_5m_deg"] is None else r["dtm_slope_5m_deg"] for r in rows])

    result = {
        "task": "MUST-03",
        "status": "first-pass calibration hint, not a validation",
        "dtm_product_id": "DTEEC_019698_1750_019988_1750_U01",
        "waypoints_source": WAYPOINTS_URL,
        "waypoints_filter": {"min_sol": a.min_sol, "inside_dtm_box": True},
        "scale_1m": summary(d1, tilt),
        "scale_5m": summary(d5, tilt),
        "notes": [
            "Rover tilt is body tilt over a ~3 m wheelbase; DTM slope is terrain gradient. They are related, not identical.",
            "Waypoint positions may be offset from the DTM by a few metres; no co-registration was done.",
            "Rover drives choose gentle ground, so this sample is biased toward low slopes.",
        ],
        "samples": rows,
    }
    out = ROOT / "data/processed/terrain/tilt-check.json"
    out.write_text(json.dumps(result, indent=1) + "\n")
    print(json.dumps({k: result[k] for k in ("scale_1m", "scale_5m")}, indent=2))
    print("window px", z.shape)


if __name__ == "__main__":
    main()
