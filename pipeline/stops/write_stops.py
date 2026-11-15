"""Write data/processed/routing/stops.json (example / not locked).

Uses cited MSL waypoint candidates from PRE07_LOCK_REQUEST.md for habitat and
boxwork bonus, and two real Curiosity drill sites in the clay-bearing Glen Torridon unit for the
lake-sediment stops (Glen Etive 1, Mary Anning 3), at the rover's parked position on the drill sol.
All features keep is_example: true until the team locks PRE-07. No mineral IDs are invented.
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

# Glen Torridon drill sites: rover position from MSL_waypoints.json at the parked waypoint before
# drilling (no drive in between). Glen Etive 1: parked Sol 2481, drilled Sol 2486.
# Mary Anning 3: parked Sol 2829, drilled ~Sol 2870 (go-for-drill post, sols 2870-2871).
MUD_A = {"lon": 137.3835412, "lat": -4.73030915, "sol": 2486, "parked_sol": 2481}
MUD_B = {"lon": 137.3911375, "lat": -4.72930656, "sol": 2870, "parked_sol": 2829}
GLEN_ETIVE_BLOG = "https://science.nasa.gov/blog/sols-2485-2487-affirm-etive-we-are-go-for-drilling-at-glen-etive-1/"
MARY_ANNING_BLOG = "https://science.nasa.gov/blog/sols-2870-2871-we-are-go-for-drilling/"
MILLAN_2022 = "https://doi.org/10.1029/2021JE007107"
BENNETT_2023 = "https://ntrs.nasa.gov/citations/20230001618"


WAYPOINTS_URL = "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json"
FETCH_DATE = "2026-11-14"
GT_FETCH_DATE = "2026-11-15"
SOURCES = [
    {
        "name": "Curiosity (MSL) waypoints, NASA Mars Maps / MMGIS layer",
        "product_id": "MSL_waypoints.json",
        "url": WAYPOINTS_URL,
        "fetch_date": FETCH_DATE,
        "used_for": "stop-habitat (Sol 4527), stop-boxwork-bonus (Sol 4534), Glen Etive 1 (Sol 2481) and Mary Anning 3 (Sol 2829) coordinates",
    },
    {
        "name": "NASA Curiosity blog, Sols 2485-2487: go for drilling at Glen Etive 1 (L. Thompson, 2 Aug 2019)",
        "url": GLEN_ETIVE_BLOG,
        "fetch_date": GT_FETCH_DATE,
        "used_for": "stop-mudstone-a target name and drill sol",
    },
    {
        "name": "NASA Curiosity blog, Sols 2870-2871: go for drilling Mary Anning 3 (S. Schwenzer, 31 Aug 2020)",
        "url": MARY_ANNING_BLOG,
        "fetch_date": GT_FETCH_DATE,
        "used_for": "stop-mudstone-b target name, drill sol and SAM wet-chemistry plan",
    },
    {
        "name": "Millan et al. 2022, Sedimentary organics in Glen Torridon, Gale Crater, Mars (JGR Planets)",
        "url": MILLAN_2022,
        "fetch_date": GT_FETCH_DATE,
        "used_for": "organics detected by SAM in Glen Torridon samples; clays may have helped preserve them",
    },
    {
        "name": "Bennett et al. 2023, The Curiosity rover's exploration of Glen Torridon (JGR Planets)",
        "url": BENNETT_2023,
        "fetch_date": GT_FETCH_DATE,
        "used_for": "lowest Glen Torridon strata continue the lacustrine Murray formation; highest clay abundances of the mission",
    },
]


def build_stops() -> dict:
    return {
        "contract": "martian-mappers.stops.v1",
        "status": "example",
        "note": (
            "PRE-07 still open. Habitat uses cited Sol 4527 waypoint; boxwork bonus uses cited "
            "Sol 4534 waypoint. The two lake-sediment stops are real Curiosity drill sites in the "
            "Glen Torridon clay-bearing unit (Glen Etive 1, Mary Anning 3), at the rover's parked "
            "waypoint. All four sit inside DTEEC_009149 (the streamed corridor terrain). All "
            "is_example true until the team locks the stops."
        ),
        "sources": SOURCES,
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
                    "source_url": WAYPOINTS_URL,
                    "source_fetch_date": FETCH_DATE,
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
                    "name": "Glen Etive 1 drill site (Glen Torridon, Sol 2486)",
                    "kind": "lake_sediment",
                    "science_summary": (
                        "Curiosity drilled Glen Etive 1 on Sol 2486 in Glen Torridon, the clay-bearing "
                        "unit with the highest clay abundances of the mission. Bennett et al. (2023) "
                        "read the lowest Glen Torridon strata as a continuation of the lacustrine "
                        "Murray formation. Position is the rover's parked waypoint (Sol 2481)."
                    ),
                    "sol_hint": MUD_A["sol"],
                    "source": "NASA Curiosity blog Sols 2485-2487; MSL waypoints Sol 2481; Bennett et al. 2023",
                    "source_url": GLEN_ETIVE_BLOG,
                    "source_fetch_date": GT_FETCH_DATE,
                    "is_example": True,
                },
                "geometry": {"type": "Point", "coordinates": [MUD_A["lon"], MUD_A["lat"]]},
            },
            {
                "type": "Feature",
                "properties": {
                    "id": "stop-mudstone-b",
                    "name": "Mary Anning 3 drill site (Glen Torridon, ~Sol 2870)",
                    "kind": "lake_sediment",
                    "science_summary": (
                        "Curiosity drilled Mary Anning 3 (go-for-drill post, Sols 2870-2871) for a SAM "
                        "wet-chemistry experiment. SAM found sulfur-bearing organic molecules in Glen "
                        "Torridon samples; Millan et al. (2022) suggest clay minerals helped preserve "
                        "ancient organic matter. Position is the rover's parked waypoint (Sol 2829)."
                    ),
                    "sol_hint": MUD_B["sol"],
                    "source": "NASA Curiosity blog Sols 2870-2871; MSL waypoints Sol 2829; Millan et al. 2022",
                    "source_url": MARY_ANNING_BLOG,
                    "source_fetch_date": GT_FETCH_DATE,
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
                    "source_url": WAYPOINTS_URL,
                    "source_fetch_date": FETCH_DATE,
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
