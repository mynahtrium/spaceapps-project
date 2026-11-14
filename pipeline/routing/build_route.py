"""Build route.json + hud-telemetry.json under data/processed/routing/.

Prefers Backend 1 cost-map.json when every stop is inside its bounds; else falls
back to docs/contracts example cost map; else a labelled Mars-radius geodesic
polyline (hand-drawn-style fallback). Always writes static JSON. status stays
example while PRE-07 is open.
"""

from __future__ import annotations

import json
import math
import sys
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
from write_stops import build_stops

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


def leg_distances(coords: dict[str, tuple[float, float]]) -> list[dict]:
    legs = []
    for a, b in zip(STOP_ORDER, STOP_ORDER[1:]):
        lon1, lat1 = coords[a]
        lon2, lat2 = coords[b]
        legs.append(
            {
                "from": a,
                "to": b,
                "distance_m": round(haversine_m(lon1, lat1, lon2, lat2), 1),
            }
        )
    return legs


def build_profile(line: list[list[float]], n: int = 6) -> list[dict]:
    if len(line) < 2:
        return []
    s_at = [0.0]
    for i in range(1, len(line)):
        s_at.append(s_at[-1] + haversine_m(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]))
    total = s_at[-1] or 1.0
    profile = []
    for i in range(n):
        target = total * i / (n - 1) if n > 1 else 0.0
        # find segment
        j = 0
        while j + 1 < len(s_at) and s_at[j + 1] < target:
            j += 1
        # placeholder slope / elev (no DTM at these lon/lat yet)
        profile.append(
            {
                "s_m": round(target, 1),
                "elev_m": None,
                "slope_deg": None,
                "note": "Elevation/slope null until route sits on a covering HiRISE cost/DTM crop.",
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
    coords: dict[str, tuple[float, float]],
    planned_min: float,
    n_samples: int = 8,
) -> dict:
    # cumulative s
    s_at = [0.0]
    for i in range(1, len(line)):
        s_at.append(s_at[-1] + haversine_m(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]))
    total = s_at[-1]

    # stop cumulative distances along order
    stop_s = {STOP_ORDER[0]: 0.0}
    acc = 0.0
    for a, b in zip(STOP_ORDER, STOP_ORDER[1:]):
        lon1, lat1 = coords[a]
        lon2, lat2 = coords[b]
        acc += haversine_m(lon1, lat1, lon2, lat2)
        stop_s[b] = acc  # last write for habitat closing is total

    samples = []
    for i in range(n_samples):
        target = total * (i + 1) / (n_samples + 1)
        j = 0
        while j + 1 < len(s_at) and s_at[j + 1] < target:
            j += 1
        if j + 1 >= len(line):
            lon, lat = line[-1]
            heading = 0.0
        else:
            t = 0.0 if s_at[j + 1] == s_at[j] else (target - s_at[j]) / (s_at[j + 1] - s_at[j])
            lon = line[j][0] + (line[j + 1][0] - line[j][0]) * t
            lat = line[j][1] + (line[j + 1][1] - line[j][1]) * t
            heading = bearing_deg(line[j][0], line[j][1], line[j + 1][0], line[j + 1][1])

        # next stop: first stop in order with stop_s > target (excluding start at 0 if target>0)
        next_id = STOP_ORDER[-1]
        for sid in STOP_ORDER[1:]:
            if stop_s.get(sid, total) >= target - 1e-6:
                next_id = sid
                break
        dist_to_next = max(0.0, stop_s.get(next_id, total) - target)
        elapsed = (target / total) * planned_min if total > 0 else 0.0
        o2 = max(0.0, 100.0 * (1.0 - elapsed / planned_min)) if planned_min > 0 else 0.0

        samples.append(
            {
                "contract": "martian-mappers.hud-telemetry.v1",
                "status": "example",
                "note": "Example HUD sample along the example route. Not real-time suit telemetry.",
                "route_id": route_id,
                "along_route_m": round(target, 1),
                "position": {"lat_deg": round(lat, 7), "lon_deg": round(lon, 7), "elev_m": None},
                "heading_deg": round(heading, 1),
                "distance_travelled_m": round(target, 1),
                "distance_to_next_stop_m": round(dist_to_next, 1),
                "distance_remaining_m": round(max(0.0, total - target), 1),
                "slope_deg": None,
                "slope_class": "unknown",
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

    # Contract allows a single sample; ship array + a primary "mid" sample for simple loaders.
    mid = samples[len(samples) // 2]
    return {
        "contract": "martian-mappers.hud-telemetry.v1",
        "status": "example",
        "note": (
            "Array of example HUD samples along the example route, plus `primary` for loaders "
            "that expect one object. Slope/elev null until a covering DTM crop exists."
        ),
        "route_id": route_id,
        "primary": mid,
        "samples": samples,
    }


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

    legs = leg_distances(coords)
    # Prefer polyline length for totals when Dijkstra; else sum of legs
    poly_m = 0.0
    for i in range(1, len(line)):
        poly_m += haversine_m(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1])
    total_m = poly_m if method == "dijkstra_8_neighbour" else sum(leg["distance_m"] for leg in legs)
    planned_min = total_m / WALK_SPEED_M_PER_MIN if WALK_SPEED_M_PER_MIN > 0 else 0.0
    route_id = "eva-example-pre07-scaffold-001"

    route = {
        "contract": "martian-mappers.route.v1",
        "status": "example",
        "note": (
            "Example route while PRE-07 is open. Not locked science stops. "
            + method_note
        ),
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
            "climb_m": None,
            "descent_m": None,
            "duration_min_placeholder": round(planned_min, 1),
            "duration_note": (
                "Placeholder duration using a slow Earth-hiking stand-in "
                f"({WALK_SPEED_M_PER_MIN:.2f} m/min). Label it as such in the UI."
            ),
            "climb_note": "Climb/descent null until the path sits on a covering DTM/cost crop.",
        },
        "geometry": {"type": "LineString", "coordinates": line},
        "legs": legs,
        "profile": build_profile(line),
        "totals": {
            "distance_m": round(total_m, 1),
            "climb_m": None,
            "descent_m": None,
            "duration_min_placeholder": round(planned_min, 1),
            "dose_mSv_see": "docs/contracts/dose.json",
        },
    }

    hud = build_hud(route_id, line, names, coords, planned_min)

    (OUT_DIR / "route.json").write_text(json.dumps(route, indent=2) + "\n")
    (OUT_DIR / "hud-telemetry.json").write_text(json.dumps(hud, indent=2) + "\n")
    print("method", method, "cost", cm_label)
    print("distance_m", round(total_m, 1), "duration_min_placeholder", round(planned_min, 1))
    print("wrote", (OUT_DIR / "route.json").relative_to(ROOT))
    print("wrote", (OUT_DIR / "hud-telemetry.json").relative_to(ROOT))


if __name__ == "__main__":
    main()
