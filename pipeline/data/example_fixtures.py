"""Labelled DONKI example fixtures for machines with no NASA_API_KEY.

Does not call the network. Does not overwrite a real donki-cache.json or alerts.json.
The single Mars arrival below is the 11 November 2026 planning-check example already
published in docs/contracts/alerts.json (predicted arrival 2025-05-08 12:00Z). It is
not a new measurement and not a live forecast.
"""

from __future__ import annotations

from typing import Any

from .common import DATA_SCIENCE, write_json

# Cited example only. See docs/contracts/alerts.json and AGENTS.md (checked 11 Nov 2026).
EXAMPLE_ARRIVAL = "2025-05-08T12:00:00Z"
EXAMPLE_ID = "example-enlil-2025-05"
EXAMPLE_NOTE = (
    "Labelled example. Live DONKI was not called because NASA_API_KEY is absent. "
    "This repeats the 11 Nov 2026 planning-check example in docs/contracts/alerts.json "
    "(a May 2025 WSA-Enlil query listed a Mars arrival at 2025-05-08 12:00Z). "
    "Not a live forecast. Counts were not fetched. "
    "A real data/processed/science/donki-cache.json or alerts.json, if present, is left unchanged."
)


def write_donki_example() -> dict[str, Any]:
    """Write donki-cache.example.json. Leave any real cache file alone."""
    payload: dict[str, Any] = {
        "contract_hint": "martian-mappers.donki-cache.v1",
        "status": "example",
        "is_example": True,
        "live_fetch": "skipped",
        "fetched_at": None,
        "window": None,
        "source": "Labelled example from docs/contracts/alerts.json (11 Nov 2026 planning check)",
        "source_urls": [
            "https://api.nasa.gov/",
            "https://ccmc.gsfc.nasa.gov/tools/DONKI/",
        ],
        "note": EXAMPLE_NOTE,
        "counts": {
            "WSAEnlilSimulations": None,
            "CME": None,
            "SEP": None,
            "GST": None,
        },
        "mars_impact_count": 1,
        "mars_impacts": [
            {
                "simulationID": EXAMPLE_ID,
                "modelCompletionTime": None,
                "au": None,
                "location": "Mars",
                "arrivalTime": EXAMPLE_ARRIVAL,
                "isGlancingBlow": None,
                "link": "https://ccmc.gsfc.nasa.gov/tools/DONKI/",
                "is_example": True,
            }
        ],
    }
    write_json(DATA_SCIENCE / "donki-cache.example.json", payload)
    return payload


def write_alerts_example() -> dict[str, Any]:
    """Write alerts.example.json in the alerts.v1 shape. Leave alerts.json alone."""
    payload: dict[str, Any] = {
        "contract": "martian-mappers.alerts.v1",
        "status": "example",
        "is_example": True,
        "live_fetch": "skipped",
        "source": "DONKI WSAEnlilSimulations (labelled example, not a live query)",
        "source_urls": [
            "https://api.nasa.gov/",
            "https://ccmc.gsfc.nasa.gov/tools/DONKI/",
        ],
        "note": EXAMPLE_NOTE,
        "queried_at": None,
        "window": None,
        "counts": {
            "WSAEnlilSimulations": None,
            "CME": None,
            "SEP": None,
            "GST": None,
        },
        "cache_relpath": "data/processed/science/donki-cache.example.json",
        "alerts": [
            {
                "id": EXAMPLE_ID,
                "type": "WSA-Enlil",
                "mars_in_impact_list": True,
                "predicted_arrival": EXAMPLE_ARRIVAL,
                "is_example": True,
            }
        ],
        "banner": {
            "level": "info",
            "text": (
                "Example only: cached planning-check WSA-Enlil lists a predicted Mars arrival "
                "at 2025-05-08 12:00Z. Live DONKI was skipped (no NASA_API_KEY). "
                "Not a live forecast."
            ),
        },
    }
    write_json(DATA_SCIENCE / "alerts.example.json", payload)
    return payload
