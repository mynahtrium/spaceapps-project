"""Fetch and cache NASA DONKI space-weather data for Mars (MUST-07).

Uses personal NASA_API_KEY from environment/.env.
Queries WSAEnlilSimulations (checking impactList for Mars) plus CME, SEP, GST.
Never uses the FLR endpoint (returned 404 in planning checks) or NASA DEMO_KEY.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

from .common import DATA_RAW, DATA_SCIENCE, get_nasa_api_key, http_get_json, utc_now_iso, write_json

DONKI_BASE = "https://api.nasa.gov/DONKI"


def _extract_mars_impacts(enlil_runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return WSA-Enlil entries whose impactList includes Mars."""
    mars_hits: list[dict[str, Any]] = []
    for run in enlil_runs:
        impacts = run.get("impactList") or []
        for impact in impacts:
            location = str(impact.get("location", ""))
            if "mars" in location.lower():
                mars_hits.append(
                    {
                        "simulationID": run.get("simulationID"),
                        "modelCompletionTime": run.get("modelCompletionTime"),
                        "au": run.get("au"),
                        "location": location,
                        "arrivalTime": impact.get("arrivalTime"),
                        "isGlancingBlow": impact.get("isGlancingBlow"),
                        "link": run.get("link"),
                    }
                )
    return mars_hits


def fetch_donki(days_back: int = 30) -> dict[str, Any]:
    """Fetch DONKI endpoints and write raw + compact processed cache."""
    api_key = get_nasa_api_key()
    end_dt = datetime.now(timezone.utc).date()
    start_dt = end_dt - timedelta(days=days_back)

    endpoints = {
        "WSAEnlilSimulations": f"{DONKI_BASE}/WSAEnlilSimulations",
        "CME": f"{DONKI_BASE}/CME",
        "SEP": f"{DONKI_BASE}/SEP",
        "GST": f"{DONKI_BASE}/GST",
    }

    raw_dir = DATA_RAW / "donki"
    raw_dir.mkdir(parents=True, exist_ok=True)

    counts: dict[str, int] = {}
    enlil_runs: list[dict[str, Any]] = []

    for name, base_url in endpoints.items():
        query = urlencode(
            {
                "startDate": start_dt.isoformat(),
                "endDate": end_dt.isoformat(),
                "api_key": api_key,
            }
        )
        data = http_get_json(f"{base_url}?{query}", timeout=45)
        if not isinstance(data, list):
            data = []
        counts[name] = len(data)
        write_json(raw_dir / f"{name}.json", data)
        if name == "WSAEnlilSimulations":
            enlil_runs = data

    mars_impacts = _extract_mars_impacts(enlil_runs)
    summary = {
        "contract_hint": "martian-mappers.donki-cache.v1",
        "fetched_at": utc_now_iso(),
        "window": {
            "startDate": start_dt.isoformat(),
            "endDate": end_dt.isoformat(),
            "days_back": days_back,
        },
        "source": "NASA CCMC DONKI API (api.nasa.gov/DONKI)",
        "counts": counts,
        "mars_impact_count": len(mars_impacts),
        "mars_impacts": mars_impacts,
    }
    write_json(DATA_SCIENCE / "donki-cache.json", summary)
    return summary


if __name__ == "__main__":
    result = fetch_donki()
    print(
        f"DONKI cached: counts={result['counts']}, mars_impacts={result['mars_impact_count']}"
    )
