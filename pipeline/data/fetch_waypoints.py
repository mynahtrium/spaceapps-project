"""Fetch and cache Curiosity (MSL) waypoints and traverse GeoJSON (MUST-07).

Undocumented MMGIS feeds behind mars.nasa.gov/maps/.
Raw files go to data/raw/msl/; a compact summary goes to data/processed/science/.
"""

from __future__ import annotations

from typing import Any

from .common import DATA_RAW, DATA_SCIENCE, http_get_json, utc_now_iso, write_json

WAYPOINTS_URL = "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json"
TRAVERSE_URL = "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json"


def fetch_waypoints() -> dict[str, Any]:
    """Download MSL waypoints and traverse JSON and write a compact summary."""
    raw_dir = DATA_RAW / "msl"
    waypoints = http_get_json(WAYPOINTS_URL, timeout=45)
    traverse = http_get_json(TRAVERSE_URL, timeout=45)

    write_json(raw_dir / "MSL_waypoints.json", waypoints)
    write_json(raw_dir / "MSL_traverse.json", traverse)

    features = waypoints.get("features") or []
    latest_props = features[-1].get("properties", {}) if features else {}
    recent = []
    for feat in features[-25:]:
        props = feat.get("properties") or {}
        recent.append(
            {
                "sol": props.get("sol"),
                "lat": props.get("lat"),
                "lon": props.get("lon"),
                "elev_geoid": props.get("elev_geoid"),
                "tilt": props.get("tilt"),
                "dist_total_m": props.get("dist_total_m"),
            }
        )

    summary = {
        "fetched_at": utc_now_iso(),
        "sources": {
            "waypoints": WAYPOINTS_URL,
            "traverse": TRAVERSE_URL,
        },
        "waypoint_count": len(features),
        "traverse_feature_count": len(traverse.get("features") or []),
        "latest_waypoint": {
            "sol": latest_props.get("sol"),
            "lat": latest_props.get("lat"),
            "lon": latest_props.get("lon"),
            "elev_geoid": latest_props.get("elev_geoid"),
            "tilt": latest_props.get("tilt"),
            "dist_total_m": latest_props.get("dist_total_m"),
        },
        "recent_waypoints_sample": recent,
    }
    write_json(DATA_SCIENCE / "msl-waypoints-cache.json", summary)
    return summary


if __name__ == "__main__":
    result = fetch_waypoints()
    print(
        f"MSL waypoints cached: count={result['waypoint_count']}, "
        f"latest_sol={result['latest_waypoint'].get('sol')}"
    )
