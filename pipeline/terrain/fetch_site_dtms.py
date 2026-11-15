#!/usr/bin/env python3
"""Cut a small real-elevation window around each landing site from public HiRISE DTMs.

For every site this reads only the needed rows of the PDS DTM (HTTP Range requests on the
uncompressed .IMG), so nothing larger than a few MB is downloaded per site. The window is
resampled to a regular grid and written as:

    data/demo/sites/<site>/height.bin   little-endian uint16, row-major, north row first
    data/demo/sites/<site>/meta.json    grid size, spacing, height offset/scale, source, bounds

Height (m, areoid) = offset + value * scale.  0xFFFF = no data (filled from neighbours).

Sources: HiRISE DTMs, University of Arizona / NASA MRO (https://hirise-pds.lpl.arizona.edu/PDS/DTM/),
selected from DTMCUMINDEX.TAB by footprint. Needs Python 3 + numpy only (no GDAL).

Usage:  python3 pipeline/terrain/fetch_site_dtms.py [--out data/demo/sites] [--size-m 2000] [--step-m 2]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import re
import urllib.request
from pathlib import Path

import numpy as np

PDS = "https://hirise-pds.lpl.arizona.edu/PDS/"
MARS_R_M = 3396190.0  # equatorial radius used by the HiRISE DTM labels

# site id -> (lat, lon east, DTM path under PDS/, what the site is)
SITES = {
    "perseverance": (18.4447, 77.4508, "DTM/ESP/ORB_045900_045999/ESP_045994_1985_ESP_046060_1985/DTEEC_045994_1985_046060_1985_U01.IMG", "Jezero crater, Octavia E. Butler landing site"),
    "spirit": (-14.5684, 175.4726, "DTM/PSP/ORB_001500_001599/PSP_001513_1655_PSP_001777_1650/DTEEC_001513_1655_001777_1650_U01.IMG", "Gusev crater, Columbia Hills"),
    "opportunity": (-1.9462, 354.4734, "DTM/ESP/ORB_021700_021799/ESP_021747_1780_ESP_022380_1780/DTEEC_021747_1780_022380_1780_U01.IMG", "Meridiani Planum, Victoria crater DTM"),
    "insight": (4.5024, 135.6234, "DTM/ESP/ORB_037200_037299/ESP_037262_1845_ESP_036761_1845/DTEEC_037262_1845_036761_1845_U01.IMG", "Elysium Planitia, InSight landing ellipse"),
    "sojourner": (19.13, 326.78, "DTM/PSP/ORB_002300_002399/PSP_002391_1995_PSP_001890_1995/DTEEC_002391_1995_001890_1995_A01.IMG", "Ares Vallis, Mars Pathfinder site"),
    "phoenix": (68.2188, 234.2508, "DTM/PSP/ORB_008500_008599/PSP_008591_2485_PSP_008644_2485/DTEPC_008591_2485_008644_2485_U01.IMG", "Vastitas Borealis, Phoenix landing site"),
}


def http_range(url: str, start: int, end: int) -> bytes:
    req = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}", "User-Agent": "martian-mappers-pipeline"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def read_label(url: str) -> dict:
    head = http_range(url, 0, 65535).decode("latin-1")
    end = head.find("\nEND\r") if "\nEND\r" in head else head.find("\nEND\n")
    text = head[: end if end > 0 else len(head)]
    lab: dict = {}
    for m in re.finditer(r"^\s*([A-Z0-9_^]+)\s*=\s*(.+?)\s*$", text, re.M):
        k, v = m.group(1), m.group(2).strip().strip('"')
        lab.setdefault(k, v)
    return lab


def num(v: str) -> float:
    return float(re.match(r"[-+0-9.eE]+", v).group(0))


def cut_site(site: str, out_dir: Path, size_m: float, step_m: float) -> dict:
    lat, lon, path, desc = SITES[site]
    url = PDS + path
    lab = read_label(url)
    rec = int(num(lab["RECORD_BYTES"]))
    lines = int(num(lab["LINES"]))
    samples = int(num(lab["LINE_SAMPLES"]))
    hdr_records = int(num(lab["^IMAGE"])) - 1 if "^IMAGE" in lab else int(num(lab.get("LABEL_RECORDS", "1")))
    data_start = hdr_records * rec
    scale_m = num(lab["MAP_SCALE"])
    c_lat = num(lab["CENTER_LATITUDE"])
    c_lon = num(lab["CENTER_LONGITUDE"])
    l_off = num(lab["LINE_PROJECTION_OFFSET"])
    s_off = num(lab["SAMPLE_PROJECTION_OFFSET"])
    r_m = num(lab.get("A_AXIS_RADIUS", "3396.19")) * 1000.0
    if lab.get("MAP_PROJECTION_TYPE", "").upper() != "EQUIRECTANGULAR":
        raise SystemExit(f"{site}: projection {lab.get('MAP_PROJECTION_TYPE')} not handled")

    # PDS equirectangular: x = R (lon - lon0) cos(lat0), y = R lat; sample = x/scale + s_off, line = l_off - y/scale
    def to_px(la: float, lo: float) -> tuple[float, float]:
        x = r_m * math.radians(lo - c_lon) * math.cos(math.radians(c_lat))
        y = r_m * math.radians(la)
        return x / scale_m + s_off, l_off - y / scale_m

    s0, l0 = to_px(lat, lon)
    half = int(size_m / 2 / scale_m)
    li0, li1 = max(0, int(l0) - half), min(lines, int(l0) + half)
    si0, si1 = max(0, int(s0) - half), min(samples, int(s0) + half)
    if li1 - li0 < 50 or si1 - si0 < 50:
        raise SystemExit(f"{site}: site falls outside the DTM raster")
    raw = http_range(url, data_start + li0 * rec, data_start + li1 * rec - 1)
    block = np.frombuffer(raw, dtype="<f4").reshape(li1 - li0, rec // 4)[:, si0:si1].astype(np.float64)
    bad = ~np.isfinite(block) | (block < -1e4) | (block > 3e4)
    # MISSING_CONSTANT is a hex float (16#FF7FFFFB#, about -3.4e38); the range test above catches it
    block[bad] = np.nan

    k = max(1, int(round(step_m / scale_m)))
    h = block[: (block.shape[0] // k) * k, : (block.shape[1] // k) * k]
    h = np.nanmean(h.reshape(h.shape[0] // k, k, h.shape[1] // k, k), axis=(1, 3))
    valid = np.isfinite(h)
    frac = float(valid.mean())
    if frac < 0.3:
        raise SystemExit(f"{site}: only {frac:.0%} of the window has data")
    # fill holes by repeated neighbour averaging (edges of the DTM strip)
    for _ in range(400):
        if valid.all():
            break
        p = np.pad(np.where(valid, h, 0.0), 1)
        c = np.pad(valid.astype(float), 1)
        s = p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]
        n = c[:-2, 1:-1] + c[2:, 1:-1] + c[1:-1, :-2] + c[1:-1, 2:]
        fill = (~valid) & (n > 0)
        h[fill] = s[fill] / n[fill]
        valid = valid | fill
    lo_h, hi_h = float(np.nanmin(h)), float(np.nanmax(h))
    q = max(0.01, (hi_h - lo_h) / 65534.0)
    u16 = np.clip(np.round((h - lo_h) / q), 0, 65534).astype("<u2")

    d = out_dir / site
    d.mkdir(parents=True, exist_ok=True)
    (d / "height.bin").write_bytes(u16.tobytes())
    # geographic bounds of the cut (approximate: equirectangular around the site)
    rows, cols = u16.shape
    cell = scale_m * k
    dlat = math.degrees(cell * rows / r_m)
    dlon = math.degrees(cell * cols / (r_m * math.cos(math.radians(lat))))
    meta = {
        "site": site,
        "description": desc,
        "width": cols,
        "height": rows,
        "spacingM": cell,
        "heightOffsetM": lo_h,
        "heightScaleM": q,
        "minHeightM": lo_h,
        "maxHeightM": hi_h,
        "centerLat": lat,
        "centerLonE": lon,
        "bounds": {"south": lat - dlat / 2, "north": lat + dlat / 2, "west": lon - dlon / 2, "east": lon + dlon / 2},
        "validFraction": round(frac, 3),
        "source": {
            "product": Path(path).stem,
            "url": url,
            "provider": "HiRISE DTM, University of Arizona / NASA MRO",
            "fetched": dt.date.today().isoformat(),
            "nativeScaleM": scale_m,
        },
    }
    (d / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"{site}: {cols}x{rows} @ {cell:.2f} m, {lo_h:.0f}..{hi_h:.0f} m, data {frac:.0%}")
    return meta


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/demo/sites")
    ap.add_argument("--size-m", type=float, default=2000.0)
    ap.add_argument("--step-m", type=float, default=2.0)
    ap.add_argument("sites", nargs="*", default=list(SITES))
    a = ap.parse_args()
    out = Path(a.out)
    index = {}
    for s in a.sites:
        try:
            m = cut_site(s, out, a.size_m, a.step_m)
            index[s] = {k: m[k] for k in ("description", "width", "height", "spacingM", "centerLat", "centerLonE", "bounds")}
        except SystemExit as e:
            print(f"SKIP {e}")
    prev = {}
    out.mkdir(parents=True, exist_ok=True)
    idx_path = out / "index.json"
    if idx_path.exists():
        prev = json.loads(idx_path.read_text()).get("sites", {})
    prev.update(index)
    idx_path.write_text(json.dumps({"sites": prev}, indent=2) + "\n")


if __name__ == "__main__":
    main()
