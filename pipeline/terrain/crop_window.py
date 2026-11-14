"""Crop window that covers the example stops already in the repo.

Reads point features from docs/contracts/stops.json and, when that file
exists, data/processed/routing/stops.json. Those coordinates are examples.
PRE-07 has not locked official outcrop names, and this module does not
invent any.

The HiRISE DTM DTEEC_019698 is equirectangular with sphere radius
3,396,190 m and central meridian 137.38° (standard parallel 0). That is
the same projection as the PDS label.
"""
import json
import math
from pathlib import Path

MARS_R_M = 3396190.0
LON0 = 137.38
# Footprint recorded from the cumulative DTM index on 11 November 2026.
DTM_LON_WEST = 137.31
DTM_LON_EAST = 137.44
DTM_LAT_SOUTH = -5.04
DTM_LAT_NORTH = -4.73
STOP_FILES = (
    "docs/contracts/stops.json",
    "data/processed/routing/stops.json",
)


def lonlat_to_xy(lon, lat):
    k = MARS_R_M * math.pi / 180.0
    return (lon - LON0) * k, lat * k


def xy_to_lonlat(x, y):
    k = MARS_R_M * math.pi / 180.0
    return x / k + LON0, y / k


def load_example_stops(root):
    """Return example point stops. Same id may appear twice if the files differ."""
    root = Path(root)
    stops = []
    for rel in STOP_FILES:
        path = root / rel
        if not path.is_file():
            continue
        data = json.loads(path.read_text())
        for feat in data.get("features", []):
            geom = feat.get("geometry") or {}
            if geom.get("type") != "Point":
                continue
            coords = geom.get("coordinates") or []
            if len(coords) < 2:
                continue
            lon, lat = float(coords[0]), float(coords[1])
            sid = str((feat.get("properties") or {}).get("id") or "unknown")
            stops.append({"id": sid, "lon": lon, "lat": lat, "source": rel})
    if not stops:
        raise SystemExit("no example stops found in " + ", ".join(STOP_FILES))
    outside = [
        s for s in stops
        if not (DTM_LON_WEST <= s["lon"] <= DTM_LON_EAST and DTM_LAT_SOUTH <= s["lat"] <= DTM_LAT_NORTH)
    ]
    if outside:
        ids = ", ".join(f"{s['id']} ({s['lon']}, {s['lat']}) from {s['source']}" for s in outside)
        raise SystemExit("example stop is outside the documented DTEEC_019698 footprint: " + ids)
    return stops


def crop_xy(stops, min_half_m=1000.0, edge_margin_m=200.0):
    """Centre on the stop bounding box. Half-size is at least 1 km, and larger if needed."""
    xs = []
    ys = []
    for stop in stops:
        x, y = lonlat_to_xy(stop["lon"], stop["lat"])
        stop["x"] = x
        stop["y"] = y
        xs.append(x)
        ys.append(y)
    cx = (min(xs) + max(xs)) / 2.0
    cy = (min(ys) + max(ys)) / 2.0
    half = float(min_half_m)
    for x, y in zip(xs, ys):
        half = max(half, abs(x - cx) + edge_margin_m, abs(y - cy) + edge_margin_m)
    return cx, cy, half
