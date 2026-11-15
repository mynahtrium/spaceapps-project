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
from pathlib import Path

from pyproj import CRS, Transformer
from shapely.geometry import MultiPoint, Point, box

MARS_R_M = 3396190.0
LON0 = 137.38
_MARS_GEOG_CRS = CRS.from_proj4(f"+proj=longlat +R={MARS_R_M} +no_defs")
_MARS_EQC_CRS = CRS.from_proj4(
    f"+proj=eqc +lat_ts=0 +lat_0=0 +lon_0={LON0} +x_0=0 +y_0=0 +R={MARS_R_M} +units=m +no_defs"
)
_TO_XY = Transformer.from_crs(_MARS_GEOG_CRS, _MARS_EQC_CRS, always_xy=True)
_TO_LONLAT = Transformer.from_crs(_MARS_EQC_CRS, _MARS_GEOG_CRS, always_xy=True)
# Footprint recorded from the cumulative DTM index on 11 November 2026.
DTM_LON_WEST = 137.31
DTM_LON_EAST = 137.44
DTM_LAT_SOUTH = -5.04
DTM_LAT_NORTH = -4.73
_DTM_FOOTPRINT = box(DTM_LON_WEST, DTM_LAT_SOUTH, DTM_LON_EAST, DTM_LAT_NORTH)
STOP_FILES = (
    "docs/contracts/stops.json",
    "data/processed/routing/stops.json",
)


def lonlat_to_xy(lon, lat):
    x, y = _TO_XY.transform(float(lon), float(lat))
    return float(x), float(y)


def xy_to_lonlat(x, y):
    lon, lat = _TO_LONLAT.transform(float(x), float(y))
    return float(lon), float(lat)


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
        if not _DTM_FOOTPRINT.covers(Point(float(s["lon"]), float(s["lat"])))
    ]
    if outside:
        ids = ", ".join(f"{s['id']} ({s['lon']}, {s['lat']}) from {s['source']}" for s in outside)
        raise SystemExit("example stop is outside the documented DTEEC_019698 footprint: " + ids)
    return stops


def crop_xy(stops, min_half_m=1000.0, edge_margin_m=200.0):
    """Centre on the stop bounding box. Half-size is at least 1 km, and larger if needed."""
    lons = [float(stop["lon"]) for stop in stops]
    lats = [float(stop["lat"]) for stop in stops]
    xs, ys = _TO_XY.transform(lons, lats)
    for stop, x, y in zip(stops, xs, ys):
        stop["x"] = float(x)
        stop["y"] = float(y)
    minx, miny, maxx, maxy = MultiPoint(list(zip(xs, ys))).bounds
    cx = 0.5 * (minx + maxx)
    cy = 0.5 * (miny + maxy)
    half = max(
        float(min_half_m),
        0.5 * (maxx - minx) + edge_margin_m,
        0.5 * (maxy - miny) + edge_margin_m,
    )
    return float(cx), float(cy), float(half)
