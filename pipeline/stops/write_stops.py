"""Write data/processed/routing/stops.json (example / not locked).

Uses cited MSL waypoint candidates from PRE07_LOCK_REQUEST.md for habitat and
boxwork bonus, and docs/contracts example points for the two mudstone placeholders.
All features keep is_example: true. Does not invent official outcrop names or mineral IDs.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))
OUT = ROOT / "data/processed/routing/stops.json"

# Cited MSL waypoints (docs/testing/STOP_COORDINATE_CHECK.md, PRE07_LOCK_REQUEST.md).
# Coordinates are rover positions, not locked science outcrop names.
SOL_4527 = {"lat": -4.79721368, "lon": 137.38750650, "sol": 4527}
SOL_4534 = {"lat": -4.79761763, "lon": 137.38643610, "sol": 4534}

# Example contract mudstone placeholders (docs/contracts/stops.json) — still illustrative.
MUD_A = {"lon": 137.39, "lat": -4.8}
MUD_B = {"lon": 137.3915, "lat": -4.8015}


def build_stops() -> dict:
    return {
        "contract": "martian-mappers.stops.v1",
        "status": "example",
        "note": (
            "PRE-07 still open. Habitat uses cited Sol 4527 waypoint; boxwork bonus uses cited "
            "Sol 4534 waypoint (MSL waypoints.json via STOP_COORDINATE_CHECK.md). Mudstone stops "
            "are docs/contracts example points only — not official outcrop names. All is_example "
            "true. Do not treat as locked. Inside DTEEC_019698 footprint check is required at lock."
        ),
        "crs": "mars-geographic-planetocentric",
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "id": "stop-habitat",
                    "name": "Habitat / EVA start (example — Sol 4527 candidate)",
                    "kind": "habitat",
                    "science_summary": (
                        "Illustrative EVA start at the cited Curiosity Sol 4527 waypoint "
                        "(near boxwork entry). Not a human landing-site claim. Gale is a rover "
                        "site. PRE-07 not locked."
                    ),
                    "sol_hint": SOL_4527["sol"],
                    "source": "MSL waypoints Sol 4527 (cited candidate; not locked)",
                    "is_example": True,
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [SOL_4527["lon"], SOL_4527["lat"]],
                },
            },
            {
                "type": "Feature",
                "properties": {
                    "id": "stop-mudstone-a",
                    "name": "Lake-sediment mudstone A (example)",
                    "kind": "lake_sediment",
                    "science_summary": (
                        "Placeholder for a mudstone / ancient-lake-sediment stop supporting the "
                        "habitability and organics science goal. Official outcrop name and "
                        "coordinates still required at PRE-07 lock. No mineral IDs invented."
                    ),
                    "sol_hint": None,
                    "source": "docs/contracts/stops.json example point",
                    "is_example": True,
                },
                "geometry": {"type": "Point", "coordinates": [MUD_A["lon"], MUD_A["lat"]]},
            },
            {
                "type": "Feature",
                "properties": {
                    "id": "stop-mudstone-b",
                    "name": "Lake-sediment contact B (example)",
                    "kind": "lake_sediment",
                    "science_summary": (
                        "Placeholder second sediment or contact stop from the example contract. "
                        "Do not invent mineral IDs. Replace at PRE-07 lock."
                    ),
                    "sol_hint": None,
                    "source": "docs/contracts/stops.json example point",
                    "is_example": True,
                },
                "geometry": {"type": "Point", "coordinates": [MUD_B["lon"], MUD_B["lat"]]},
            },
            {
                "type": "Feature",
                "properties": {
                    "id": "stop-boxwork-bonus",
                    "name": "Boxwork bonus (example — Sol 4534 candidate)",
                    "kind": "boxwork_bonus",
                    "science_summary": (
                        "Bonus stop candidate at the cited Curiosity Sol 4534 boxwork-entry "
                        "waypoint (Altadena member context). Primary goal remains lake sediments "
                        "/ habitability. PRE-07 not locked."
                    ),
                    "sol_hint": SOL_4534["sol"],
                    "source": "MSL waypoints Sol 4534 (cited candidate; not locked)",
                    "is_example": True,
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [SOL_4534["lon"], SOL_4534["lat"]],
                },
            },
        ],
    }


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = build_stops()
    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    print("wrote", OUT.relative_to(ROOT), "features", len(payload["features"]))


if __name__ == "__main__":
    main()
