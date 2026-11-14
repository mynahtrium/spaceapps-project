"""Download only the DTM rows the crop needs, with retries, into a local sparse .IMG.

The PDS server sometimes drops long range reads. This fetches the label record and
the row band around the current crop window in 4 MB chunks, retries each chunk, and
resumes after an interruption. Rows outside the band stay zero in the local file and
are never read by make_slope.py.

Usage (from repo root):
    .venv/Scripts/python pipeline/terrain/fetch_dtm.py [--margin-rows 64]

Output: data/raw/terrain/DTEEC_019698_1750_019988_1750_U01.IMG (gitignored)
"""
import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

import rasterio

sys.path.insert(0, str(Path(__file__).resolve().parent))
from crop_window import crop_xy, load_example_stops  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DTM_ID = "DTEEC_019698_1750_019988_1750_U01"
DTM_URL = (
    "https://hirise-pds.lpl.arizona.edu/PDS/DTM/ESP/ORB_019600_019699/"
    "ESP_019698_1750_ESP_019988_1750/" + DTM_ID + ".IMG"
)
LOCAL = ROOT / "data/raw/terrain" / (DTM_ID + ".IMG")
CHUNK = 4 * 1024 * 1024


def get_range(start, end, tries=10):
    for i in range(tries):
        try:
            req = urllib.request.Request(DTM_URL, headers={"Range": f"bytes={start}-{end}"})
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            if len(data) == end - start + 1:
                return data
        except Exception as e:  # noqa: BLE001 - retry any network error
            print(f"  retry {i + 1} for {start}-{end}: {e}")
        time.sleep(min(30, 2 ** i))
    raise SystemExit(f"failed to fetch bytes {start}-{end}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--margin-rows", type=int, default=64)
    a = ap.parse_args()

    stops = load_example_stops(ROOT)
    cx, cy, half = crop_xy(stops, min_half_m=1000.0)
    with rasterio.open("/vsicurl/" + DTM_URL) as ds:
        r0, _ = ds.index(cx - half, cy + half)
        r1, _ = ds.index(cx + half, cy - half)
        width, height = ds.width, ds.height
    row_bytes = width * 4
    with urllib.request.urlopen(urllib.request.Request(DTM_URL, method="HEAD"), timeout=60) as r:
        total = int(r.headers["Content-Length"])
    label_bytes = total - height * row_bytes
    r0, r1 = max(0, r0 - a.margin_rows), min(height, r1 + a.margin_rows)
    band = (label_bytes + r0 * row_bytes, label_bytes + r1 * row_bytes - 1)

    LOCAL.parent.mkdir(parents=True, exist_ok=True)
    state_path = LOCAL.with_suffix(".progress.json")
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    if state.get("band") != list(band):
        state = {"band": list(band), "done": []}
    if not LOCAL.exists() or LOCAL.stat().st_size != total:
        with open(LOCAL, "wb") as f:
            f.truncate(total)
        state["done"] = []

    jobs = [(0, label_bytes - 1)] + [
        (s, min(s + CHUNK - 1, band[1])) for s in range(band[0], band[1] + 1, CHUNK)
    ]
    done = {tuple(j) for j in state["done"]}
    print(f"rows {r0}-{r1}, {(band[1] - band[0] + 1) / 1e6:.1f} MB in {len(jobs)} chunks, {len(done)} already done")
    with open(LOCAL, "r+b") as f:
        for k, (s, e) in enumerate(jobs, 1):
            if (s, e) in done:
                continue
            f.seek(s)
            f.write(get_range(s, e))
            state["done"].append([s, e])
            state_path.write_text(json.dumps(state))
            print(f"  chunk {k}/{len(jobs)} ok")
    state["rows"] = [r0, r1]
    state_path.write_text(json.dumps(state))
    print("local DTM ready:", LOCAL.relative_to(ROOT), "rows", r0, r1)


if __name__ == "__main__":
    main()
