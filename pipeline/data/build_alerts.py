"""Build data/processed/science/alerts.json from cached DONKI data (SHOULD-02).

Matches the martian-mappers.alerts.v1 contract in docs/contracts/alerts.json.
"""

from __future__ import annotations

import json
from typing import Any

from .common import DATA_SCIENCE, write_json


def build_alerts() -> dict[str, Any]:
    """Read donki-cache.json and write contract-compliant alerts.json."""
    cache_path = DATA_SCIENCE / "donki-cache.json"
    if not cache_path.exists():
        raise FileNotFoundError(
            f"Missing {cache_path}. Run `python -m pipeline.data.run_must07 --only donki` first."
        )

    cache = json.loads(cache_path.read_text(encoding="utf-8"))
    impacts = cache.get("mars_impacts") or []
    counts = cache.get("counts") or {}
    window = cache.get("window") or {}

    alerts: list[dict[str, Any]] = []
    for hit in sorted(impacts, key=lambda x: x.get("arrivalTime") or "", reverse=True):
        sim_id = hit.get("simulationID") or "unknown-enlil"
        alerts.append(
            {
                "id": sim_id,
                "type": "WSA-Enlil",
                "mars_in_impact_list": True,
                "predicted_arrival": hit.get("arrivalTime"),
                "model_completion_time": hit.get("modelCompletionTime"),
                "is_glancing_blow": hit.get("isGlancingBlow"),
                "au": hit.get("au"),
                "link": hit.get("link"),
                "is_example": False,
            }
        )

    if alerts:
        latest = alerts[0]
        arrival = latest.get("predicted_arrival") or "unknown time"
        glancing = " (glancing blow)" if latest.get("is_glancing_blow") else ""
        banner_level = "warn"
        banner_text = (
            f"DONKI cache ({window.get('startDate')} to {window.get('endDate')}): "
            f"{len(alerts)} WSA-Enlil runs list Mars in impactList "
            f"(latest predicted arrival {arrival}{glancing}; "
            f"{counts.get('CME', 0)} CMEs, {counts.get('SEP', 0)} SEPs, {counts.get('GST', 0)} GSTs in window)."
        )
    else:
        banner_level = "info"
        banner_text = (
            f"DONKI cache ({window.get('startDate')} to {window.get('endDate')}): "
            f"0 WSA-Enlil Mars impacts in window "
            f"({counts.get('CME', 0)} CMEs, {counts.get('SEP', 0)} SEPs, {counts.get('GST', 0)} GSTs)."
        )

    payload = {
        "contract": "martian-mappers.alerts.v1",
        "status": "cached",
        "source": "DONKI WSAEnlilSimulations (cached)",
        "source_urls": [
            "https://api.nasa.gov/",
            "https://ccmc.gsfc.nasa.gov/tools/DONKI/",
        ],
        "note": (
            "Generated from cached personal-key DONKI query (WSAEnlilSimulations, CME, SEP, GST). "
            "FLR endpoint omitted (404 in planning checks). Offline-safe; no live call in UI."
        ),
        "queried_at": cache.get("fetched_at"),
        "window": window,
        "counts": counts,
        "cache_relpath": "data/processed/science/donki-cache.json",
        "alerts": alerts,
        "banner": {
            "level": banner_level,
            "text": banner_text,
        },
    }
    write_json(DATA_SCIENCE / "alerts.json", payload)
    return payload


if __name__ == "__main__":
    out = build_alerts()
    print(f"alerts.json written: {len(out['alerts'])} Mars impact alerts")
