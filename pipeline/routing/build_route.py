"""Build route.json + hud-telemetry.json under data/processed/routing/.

Prefers Backend 1 cost-map.json when every stop is inside its bounds; else falls
back to docs/contracts example cost map; else a labelled Mars-radius geodesic
polyline (hand-drawn-style fallback). Always writes static JSON. status stays
example while PRE-07 is open.
"""

from __future__ import annotations

import json
import math
import os
import struct
import sys
import zlib
from pathlib import Path

import numpy as np

_HERE = Path(__file__).resolve().parent
_STOPS = _HERE.parent / "stops"
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))
if str(_STOPS) not in sys.path:
    sys.path.insert(0, str(_STOPS))

from dijkstra_grid import route_through_stops
from mars_geo import MARS_RADIUS_M, bearing_deg, haversine_m, interpolate_lonlat
from write_stops import SOURCES as STOP_SOURCES, build_stops

TERRAIN_SOURCE = {
    "name": "HiRISE DTM (MRO), PDS",
    "product_id": "DTEEC_009149_1750_009294_1750_U01",
    "url": "https://hirise-pds.lpl.arizona.edu/PDS/DTM/PSP/ORB_009100_009199/PSP_009149_1750_PSP_009294_1750/DTEEC_009149_1750_009294_1750_U01.IMG",
    "fetch_date": "2026-11-15",
    "used_for": "cost grid (data/processed/terrain/cost-map.json) and height preview the route, profile and HUD samples are computed on",
}
ROUTE_SOURCES = [TERRAIN_SOURCE] + STOP_SOURCES

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "data/processed/routing"
PROCESSED_COST = ROOT / "data/processed/terrain/cost-map.json"
CONTRACT_COST = ROOT / "docs/contracts/cost-map.json"

STOP_ORDER = [
    "stop-habitat",
    "stop-mudstone-a",
    "stop-mudstone-b",
    "stop-boxwork-bonus",
    "stop-habitat",
]

# Earth-hiking placeholder ~0.8 km/h effective (very conservative EVA stand-in). Label it.
WALK_SPEED_M_PER_MIN = 800.0 / 60.0  # ~13.3 m/min
BLOCKED = 9e99


def load_stops() -> dict:
    path = OUT_DIR / "stops.json"
    if path.exists():
        return json.loads(path.read_text())
    return build_stops()


def stop_lonlat(stops: dict) -> dict[str, tuple[float, float]]:
    out: dict[str, tuple[float, float]] = {}
    for f in stops["features"]:
        lon, lat = f["geometry"]["coordinates"]
        out[f["properties"]["id"]] = (float(lon), float(lat))
    return out


def stop_names(stops: dict) -> dict[str, str]:
    return {f["properties"]["id"]: f["properties"]["name"] for f in stops["features"]}


def load_cost(path: Path) -> dict:
    return json.loads(path.read_text())


def cost_array(cm: dict) -> np.ndarray:
    g = cm["grid"]
    nrows, ncols = int(g["nrows"]), int(g["ncols"])
    key = "cost_row_major" if "cost_row_major" in cm else "example_cost_row_major"
    arr = np.asarray(cm[key], dtype=np.float64).reshape(nrows, ncols)
    return arr


def in_bounds(lon: float, lat: float, bounds: dict) -> bool:
    return (
        bounds["west_lon_deg"] <= lon <= bounds["east_lon_deg"]
        and bounds["south_lat_deg"] <= lat <= bounds["north_lat_deg"]
    )


def lonlat_to_rowcol(lon: float, lat: float, cm: dict) -> tuple[int, int]:
    b = cm["bounds"]
    ncols = int(cm["grid"]["ncols"])
    nrows = int(cm["grid"]["nrows"])
    # row_major north_to_south: row 0 = north
    col = (lon - b["west_lon_deg"]) / (b["east_lon_deg"] - b["west_lon_deg"]) * ncols
    row = (b["north_lat_deg"] - lat) / (b["north_lat_deg"] - b["south_lat_deg"]) * nrows
    c = int(min(ncols - 1, max(0, math.floor(col))))
    r = int(min(nrows - 1, max(0, math.floor(row))))
    return r, c


def rowcol_to_lonlat(r: float, c: float, cm: dict) -> tuple[float, float]:
    b = cm["bounds"]
    ncols = int(cm["grid"]["ncols"])
    nrows = int(cm["grid"]["nrows"])
    lon = b["west_lon_deg"] + (c + 0.5) / ncols * (b["east_lon_deg"] - b["west_lon_deg"])
    lat = b["north_lat_deg"] - (r + 0.5) / nrows * (b["north_lat_deg"] - b["south_lat_deg"])
    return lon, lat


def stop_block_report(cm: dict, coords: dict[str, tuple[float, float]]) -> list[dict]:
    """Cell under each stop. Does not move a stop off a blocked cell."""
    cost = cost_array(cm)
    sent = float(cm.get("blocked_sentinel", BLOCKED))
    seen: list[str] = []
    for sid in STOP_ORDER:
        if sid not in seen:
            seen.append(sid)
    report: list[dict] = []
    for sid in seen:
        lon, lat = coords[sid]
        if not in_bounds(lon, lat, cm["bounds"]):
            report.append(
                {
                    "id": sid,
                    "blocked": True,
                    "reason": "outside cost-map bounds",
                }
            )
            continue
        r, c = lonlat_to_rowcol(lon, lat, cm)
        val = float(cost[r, c])
        blocked = (not math.isfinite(val)) or val >= sent
        report.append(
            {
                "id": sid,
                "row": r,
                "col": c,
                "blocked": blocked,
                "reason": "blocked cost cell" if blocked else "passable",
            }
        )
    return report


def contract_blocked_points(cm: dict) -> list[dict]:
    """Blocked points in the contract example file. Does not move them."""
    path = ROOT / "docs/contracts/stops.json"
    if not path.exists():
        return []
    doc = json.loads(path.read_text())
    sent = float(cm.get("blocked_sentinel", BLOCKED))
    cost = cost_array(cm)
    found: list[dict] = []
    for feature in doc.get("features", []):
        sid = feature["properties"]["id"]
        lon, lat = feature["geometry"]["coordinates"]
        lon, lat = float(lon), float(lat)
        if not in_bounds(lon, lat, cm["bounds"]):
            found.append(
                {
                    "id": sid,
                    "lon": lon,
                    "lat": lat,
                    "source": "docs/contracts/stops.json",
                    "blocked": True,
                    "reason": "outside cost-map bounds",
                }
            )
            continue
        r, c = lonlat_to_rowcol(lon, lat, cm)
        val = float(cost[r, c])
        if (not math.isfinite(val)) or val >= sent:
            found.append(
                {
                    "id": sid,
                    "lon": lon,
                    "lat": lat,
                    "row": r,
                    "col": c,
                    "source": "docs/contracts/stops.json",
                    "blocked": True,
                    "reason": "blocked cost cell",
                }
            )
    return found


def pick_cost_map(coords: dict[str, tuple[float, float]]) -> tuple[dict | None, Path | None, str]:
    ordered_ids: list[str] = []
    for sid in STOP_ORDER:
        if sid not in ordered_ids:
            ordered_ids.append(sid)
    points = [coords[sid] for sid in ordered_ids]

    for path, label in (
        (PROCESSED_COST, "data/processed/terrain/cost-map.json"),
        (CONTRACT_COST, "docs/contracts/cost-map.json"),
    ):
        if not path.exists():
            continue
        cm = load_cost(path)
        bounds = cm["bounds"]
        if all(in_bounds(lon, lat, bounds) for lon, lat in points):
            return cm, path, label
    return None, None, "none"


def geodesic_coords(coords: dict[str, tuple[float, float]], seg_per_leg: int = 8) -> list[list[float]]:
    line: list[list[float]] = []
    for a, b in zip(STOP_ORDER, STOP_ORDER[1:]):
        lon1, lat1 = coords[a]
        lon2, lat2 = coords[b]
        line.extend(interpolate_lonlat(lon1, lat1, lon2, lat2, seg_per_leg))
    # close at final stop
    lon_f, lat_f = coords[STOP_ORDER[-1]]
    line.append([lon_f, lat_f])
    return line


def leg_distances(line: list[list[float]], coords: dict[str, tuple[float, float]]) -> list[dict]:
    """Walked length of each leg, measured along the routed line between consecutive stops.

    Straight-line stop-to-stop distance understates the walk once the route detours around
    blocked slopes, so the leg ends are found on the line (searching forward) and summed there.
    """
    idx = [0]
    for sid in STOP_ORDER[1:]:
        lon, lat = coords[sid]
        start = idx[-1]
        best, best_d = start, float("inf")
        for i in range(start, len(line)):
            d = haversine_m(line[i][0], line[i][1], lon, lat)
            if d < best_d:
                best, best_d = i, d
        idx.append(best)
    idx[-1] = len(line) - 1
    legs = []
    for k, (a, b) in enumerate(zip(STOP_ORDER, STOP_ORDER[1:])):
        dist = 0.0
        for i in range(idx[k] + 1, idx[k + 1] + 1):
            dist += haversine_m(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1])
        legs.append({"from": a, "to": b, "distance_m": round(dist, 1)})
    return legs


def load_height_grid(cm: dict) -> np.ndarray | None:
    """Decode height-preview.png (8-bit RGB R*256+G or 16-bit grey) into elevation_m array."""
    rel = cm.get("height_preview_png_relpath")
    rng = cm.get("height_preview_elevation_range_m")
    if not rel or not rng or len(rng) != 2:
        return None
    png_path = ROOT / rel
    if not png_path.exists():
        return None
    raw = png_path.read_bytes()
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    pos = 8
    idat = bytearray()
    w = h = bd = ct = 0
    while pos < len(raw):
        ln = struct.unpack(">I", raw[pos : pos + 4])[0]
        ctype = raw[pos + 4 : pos + 8]
        data = raw[pos + 8 : pos + 8 + ln]
        pos += 12 + ln
        if ctype == b"IHDR":
            w, h, bd, ct = struct.unpack(">IIBB", data[:10])
        elif ctype == b"IDAT":
            idat.extend(data)
    bpp = 3 if (bd, ct) == (8, 2) else (2 if (bd, ct) == (16, 0) else 0)
    if bpp == 0 or w <= 0 or h <= 0:
        return None
    decomp = zlib.decompress(bytes(idat))
    row_bytes = 1 + w * bpp
    prev = bytearray(w * bpp)
    grid = np.full((h, w), np.nan, dtype=np.float64)
    zmin, zmax = float(rng[0]), float(rng[1])
    for y in range(h):
        off = y * row_bytes
        ftype = decomp[off]
        scan = bytearray(decomp[off + 1 : off + 1 + w * bpp])
        if ftype == 1:
            for i in range(bpp, len(scan)):
                scan[i] = (scan[i] + scan[i - bpp]) & 255
        elif ftype == 2:
            for i in range(len(scan)):
                scan[i] = (scan[i] + prev[i]) & 255
        elif ftype == 3:
            for i in range(len(scan)):
                a = scan[i - bpp] if i >= bpp else 0
                scan[i] = (scan[i] + ((a + prev[i]) >> 1)) & 255
        elif ftype == 4:
            for i in range(len(scan)):
                a = scan[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                scan[i] = (scan[i] + pr) & 255
        prev = scan
        for x in range(w):
            val = (scan[x * bpp] << 8) | scan[x * bpp + 1]
            if val > 0:
                grid[y, x] = zmin + (val / 65535.0) * (zmax - zmin)
    return grid


def sample_elev_and_slope(
    lon: float,
    lat: float,
    cm: dict | None,
    elev_grid: np.ndarray | None,
) -> tuple[float | None, float | None]:
    """Sample elevation (m) and local slope (deg) at lon/lat from height grid."""
    if cm is None or elev_grid is None or not in_bounds(lon, lat, cm["bounds"]):
        return None, None
    r, c = lonlat_to_rowcol(lon, lat, cm)
    h, w = elev_grid.shape
    if not (0 <= r < h and 0 <= c < w):
        return None, None
    z = elev_grid[r, c]
    if not math.isfinite(z):
        return None, None
    cell_m = float(cm.get("cell_size_m") or 5.0)
    r0, r1 = max(0, r - 1), min(h - 1, r + 1)
    c0, c1 = max(0, c - 1), min(w - 1, c + 1)
    zx0, zx1 = elev_grid[r, c0], elev_grid[r, c1]
    zy0, zy1 = elev_grid[r0, c], elev_grid[r1, c]
    dx = (c1 - c0) * cell_m
    dy = (r1 - r0) * cell_m
    dzdx = (zx1 - zx0) / dx if (dx > 0 and math.isfinite(zx0) and math.isfinite(zx1)) else 0.0
    dzdy = (zy1 - zy0) / dy if (dy > 0 and math.isfinite(zy0) and math.isfinite(zy1)) else 0.0
    slope = math.degrees(math.atan(math.hypot(dzdx, dzdy)))
    return round(float(z), 1), round(float(slope), 1)


def compute_climb_descent(
    line: list[list[float]], cm: dict | None, elev_grid: np.ndarray | None
) -> tuple[float | None, float | None]:
    if cm is None or elev_grid is None or len(line) < 2:
        return None, None
    elevs = [sample_elev_and_slope(pt[0], pt[1], cm, elev_grid)[0] for pt in line]
    valid = [e for e in elevs if e is not None]
    if len(valid) < 2:
        return None, None
    climb = 0.0
    descent = 0.0
    for a, b in zip(valid, valid[1:]):
        diff = b - a
        if diff > 0:
            climb += diff
        elif diff < 0:
            descent += -diff
    return round(climb, 1), round(descent, 1)


def build_profile(
    total_m: float,
    line: list[list[float]],
    cm: dict | None,
    elev_grid: np.ndarray | None,
    n: int = 8,
) -> list[dict]:
    """Distance samples of the reported total with sampled elevation and slope."""
    poly = [0.0]
    for i in range(1, len(line)):
        poly.append(poly[-1] + haversine_m(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]))
    poly_total = poly[-1]
    profile = []
    for i in range(n):
        frac = i / (n - 1) if n > 1 else 0.0
        target = total_m * frac
        arc = poly_total * frac
        j = 0
        while j + 1 < len(poly) and poly[j + 1] < arc:
            j += 1
        if j + 1 >= len(line):
            lon, lat = line[-1]
        else:
            span = poly[j + 1] - poly[j]
            t = 0.0 if span == 0 else (arc - poly[j]) / span
            lon = line[j][0] + (line[j + 1][0] - line[j][0]) * t
            lat = line[j][1] + (line[j + 1][1] - line[j][1]) * t
        elev_m, slope = sample_elev_and_slope(lon, lat, cm, elev_grid)
        profile.append(
            {
                "s_m": round(target, 1),
                "elev_m": elev_m,
                "slope_deg": slope,
            }
        )
    return profile


def slope_class(slope_deg: float | None) -> str:
    if slope_deg is None:
        return "unknown"
    if slope_deg <= 10:
        return "green"
    if slope_deg <= 15:
        return "amber"
    if slope_deg <= 20:
        return "red"
    return "blocked"


def build_hud(
    route_id: str,
    line: list[list[float]],
    names: dict[str, str],
    reported_total_m: float,
    legs: list[dict],
    planned_min: float,
    cm: dict | None = None,
    elev_grid: np.ndarray | None = None,
    n_samples: int = 8,
) -> dict:
    # Drawn path is for the marker. Reported meters follow the leg sum.
    poly = [0.0]
    for i in range(1, len(line)):
        poly.append(poly[-1] + haversine_m(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]))
    poly_total = poly[-1]

    stop_s: dict[str, float] = {}
    acc = 0.0
    for leg in legs:
        acc = round(acc + leg["distance_m"], 1)
        stop_s[leg["to"]] = acc
    total = reported_total_m

    samples = []
    for i in range(n_samples):
        fraction = (i + 1) / (n_samples + 1)
        target = total * fraction
        arc = poly_total * fraction
        j = 0
        while j + 1 < len(poly) and poly[j + 1] < arc:
            j += 1
        if j + 1 >= len(line):
            lon, lat = line[-1]
            heading = 0.0
        else:
            span = poly[j + 1] - poly[j]
            t = 0.0 if span == 0 else (arc - poly[j]) / span
            lon = line[j][0] + (line[j + 1][0] - line[j][0]) * t
            lat = line[j][1] + (line[j + 1][1] - line[j][1]) * t
            heading = bearing_deg(line[j][0], line[j][1], line[j + 1][0], line[j + 1][1])

        next_id = STOP_ORDER[-1]
        for sid in STOP_ORDER[1:]:
            if stop_s.get(sid, total) >= target - 1e-6:
                next_id = sid
                break
        dist_to_next = max(0.0, stop_s.get(next_id, total) - target)
        elapsed = fraction * planned_min if planned_min > 0 else 0.0
        o2 = max(0.0, 100.0 * (1.0 - elapsed / planned_min)) if planned_min > 0 else 0.0

        elev_m, slope = sample_elev_and_slope(lon, lat, cm, elev_grid)
        samples.append(
            {
                "contract": "martian-mappers.hud-telemetry.v1",
                "status": "example",
                "note": "Example HUD sample along the example route. Not real-time suit telemetry.",
                "sources": ROUTE_SOURCES,
                "route_id": route_id,
                "along_route_m": round(target, 1),
                "position": {"lat_deg": round(lat, 7), "lon_deg": round(lon, 7), "elev_m": elev_m},
                "heading_deg": round(heading, 1),
                "distance_travelled_m": round(target, 1),
                "distance_to_next_stop_m": round(dist_to_next, 1),
                "distance_remaining_m": round(max(0.0, total - target), 1),
                "slope_deg": slope,
                "slope_class": slope_class(slope),
                "next_stop_id": next_id,
                "next_stop_name": names.get(next_id, next_id),
                "elapsed_min_placeholder": round(elapsed, 1),
                "planned_eva_min_placeholder": round(planned_min, 1),
                "suit_o2_remaining_percent": round(o2, 1),
                "suit_o2_formula": "max(0, 100 * (1 - elapsed_min / planned_eva_min))",
                "suit_o2_note": (
                    "Illustrative linear placeholder only. Not a validated Mars suit oxygen "
                    "model. Always label it as a placeholder in the HUD."
                ),
            }
        )

    # Contract expects top-level HUD fields; also include primary & samples[] for richer UIs.
    mid = samples[len(samples) // 2]
    out = dict(mid)
    out["note"] = (
        "Top-level contract HUD fields from mid-route sample, plus `primary` and `samples[]` array. "
        "Not real-time suit telemetry."
    )
    out["primary"] = mid
    out["samples"] = samples
    return out


def dijkstra_line(
    cm: dict, coords: dict[str, tuple[float, float]]
) -> list[list[float]] | None:
    cost = cost_array(cm)
    blocked = float(cm.get("blocked_sentinel", BLOCKED))
    cells = [lonlat_to_rowcol(*coords[sid], cm) for sid in STOP_ORDER]
    # closing habitat is same cell as start — ok
    path = route_through_stops(cost, cells, blocked_sentinel=blocked)
    if path is None:
        return None
    line = []
    for r, c in path:
        lon, lat = rowcol_to_lonlat(r, c, cm)
        line.append([round(lon, 7), round(lat, 7)])
    return line


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stops_path = OUT_DIR / "stops.json"
    if not stops_path.exists():
        stops_path.write_text(json.dumps(build_stops(), indent=2) + "\n")

    stops = load_stops()
    coords = stop_lonlat(stops)
    names = stop_names(stops)

    cm, cm_path, cm_label = pick_cost_map(coords)
    method = "geodesic_fallback"
    line: list[list[float]]
    method_note = ""

    if cm is not None:
        computed = dijkstra_line(cm, coords)
        if computed is not None and len(computed) >= 2:
            line = computed
            method = "dijkstra_8_neighbour"
            method_note = f"Routed on {cm_label}. Slope limit illustrative lunar stand-in."
        else:
            line = geodesic_coords(coords)
            method = "geodesic_fallback"
            method_note = (
                f"Cost map {cm_label} loaded but Dijkstra failed between stops; "
                "labelled Mars-radius geodesic fallback."
            )
    else:
        line = geodesic_coords(coords)
        method = "geodesic_fallback"
        method_note = (
            "Stops lie outside Backend 1 cost-map bounds (and example contract grid). "
            "Labelled Mars-radius geodesic polyline — not a HiRISE hazard-avoiding route. "
            "Re-run after PRE-07 lock and B1 re-crop covering all stops."
        )

    legs = leg_distances(line, coords)
    # Reported distance is the sum of the legs, each measured along the routed line.
    total_m = round(sum(leg["distance_m"] for leg in legs), 1)
    planned_min = total_m / WALK_SPEED_M_PER_MIN if WALK_SPEED_M_PER_MIN > 0 else 0.0
    route_id = "eva-example-pre07-scaffold-001"
    cell_report = stop_block_report(cm, coords) if cm is not None else []
    blocked_ids = [row["id"] for row in cell_report if row["blocked"]]
    contract_blocked = contract_blocked_points(cm) if cm is not None else []
    if blocked_ids:
        block_sentence = (
            "Blocked routed stop cells (stops not moved): " + ", ".join(blocked_ids) + "."
        )
    elif cell_report:
        block_sentence = "No routed example stop sits in a blocked cell. Stops were not moved."
    else:
        block_sentence = "No covering cost map, so stop cells were not tested for blocked cost."
    if contract_blocked:
        bits = [
            f"{row['id']} ({row['lon']}, {row['lat']})" for row in contract_blocked
        ]
        block_sentence += (
            " Blocked contract example points, left where they are: " + "; ".join(bits) + "."
        )
    cost_ref = os.environ.get("ROUTE_COST_MAP_REF", "").strip()
    ref_sentence = f" Cost map ref: {cost_ref}." if cost_ref else ""

    elev_grid = load_height_grid(cm) if cm is not None else None
    climb_m, descent_m = compute_climb_descent(line, cm, elev_grid)
    profile = build_profile(total_m, line, cm, elev_grid)

    route = {
        "contract": "martian-mappers.route.v1",
        "status": "example",
        "note": (
            "Example route while PRE-07 is open. Not locked science stops. "
            + method_note
            + " Reported distance_m is the walked length along the routed line (sum of legs)."
            + ref_sentence
            + " "
            + block_sentence
        ),
        "sources": ROUTE_SOURCES,
        "blocked_stops": blocked_ids,
        "blocked_contract_example_stops": contract_blocked,
        "stop_cells": cell_report,
        "crs": "mars-geographic-planetocentric",
        "mars_radius_km": MARS_RADIUS_M / 1000.0,
        "slope_limit_deg": 20,
        "slope_limit_note": "Illustrative lunar stand-in. Not a Mars-specific limit.",
        "route_id": route_id,
        "route_method": method,
        "cost_map_used": cm_label,
        "stop_order": STOP_ORDER,
        "type": "Feature",
        "properties": {
            "id": route_id,
            "distance_m": round(total_m, 1),
            "climb_m": climb_m,
            "descent_m": descent_m,
            "duration_min_placeholder": round(planned_min, 1),
            "duration_note": (
                "Placeholder duration using a slow Earth-hiking stand-in "
                f"({WALK_SPEED_M_PER_MIN:.2f} m/min). Label it as such in the UI."
            ),
            "climb_note": (
                "Sampled along route from height-preview.png."
                if climb_m is not None
                else "Climb/descent null until the path sits on a covering DTM/cost crop."
            ),
        },
        "geometry": {"type": "LineString", "coordinates": line},
        "legs": legs,
        "profile": profile,
        "totals": {
            "distance_m": round(total_m, 1),
            "climb_m": climb_m,
            "descent_m": descent_m,
            "duration_min_placeholder": round(planned_min, 1),
            "dose_mSv_see": "data/processed/science/dose.json",
        },
    }

    hud = build_hud(route_id, line, names, total_m, legs, planned_min, cm=cm, elev_grid=elev_grid)

    leg_sum = round(sum(leg["distance_m"] for leg in route["legs"]), 1)
    if route["properties"]["distance_m"] != leg_sum or route["totals"]["distance_m"] != leg_sum:
        raise SystemExit(f"distance mismatch {route['totals']['distance_m']} vs legs {leg_sum}")
    if not route["profile"] or route["profile"][-1]["s_m"] != leg_sum:
        raise SystemExit("profile end does not match the leg sum")
    if route["status"] != "example":
        raise SystemExit("status must stay example")

    (OUT_DIR / "route.json").write_text(json.dumps(route, indent=2) + "\n")
    (OUT_DIR / "hud-telemetry.json").write_text(json.dumps(hud, indent=2) + "\n")
    print("method", method, "cost", cm_label)
    print("blocked_stops", blocked_ids)
    print("distance_m", round(total_m, 1), "leg_sum", leg_sum, "duration_min_placeholder", round(planned_min, 1))
    print("wrote", (OUT_DIR / "route.json").relative_to(ROOT))
    print("wrote", (OUT_DIR / "hud-telemetry.json").relative_to(ROOT))


if __name__ == "__main__":
    main()
