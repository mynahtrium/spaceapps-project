"""Build data/processed/science/dose.json (SHOULD-01).

Uses Curiosity RAD baseline rate (0.64 +/- 0.12 mSv/day, Hassler et al., Science 2014)
multiplied by EVA duration from data/processed/routing/route.json (or falls back to
docs/contracts/route.json with explicit placeholder labelling until Backend 2 ships).
"""

from __future__ import annotations

import json
from typing import Any

from .common import DATA_SCIENCE, REPO_ROOT, utc_now_iso, write_json

BASELINE_RATE_MSV_PER_DAY = 0.64
BASELINE_UNCERTAINTY_MSV_PER_DAY = 0.12


def _read_duration_minutes() -> tuple[float, str, bool, str, str | None]:
    """Return duration_min, source path, is_fallback, route status, route id."""
    processed_route = REPO_ROOT / "data" / "processed" / "routing" / "route.json"
    contract_route = REPO_ROOT / "docs" / "contracts" / "route.json"

    for candidate, relpath, is_fallback in (
        (processed_route, "data/processed/routing/route.json", False),
        (contract_route, "docs/contracts/route.json", True),
    ):
        if not candidate.exists():
            continue
        data = json.loads(candidate.read_text(encoding="utf-8"))
        totals = data.get("totals") or {}
        props = data.get("properties") or {}
        route_status = str(data.get("status") or "unknown")
        route_id = data.get("route_id") or props.get("id")
        for key in ("duration_min_placeholder", "duration_min", "estimated_duration_min"):
            val = totals.get(key) if totals.get(key) is not None else props.get(key)
            if isinstance(val, (int, float)) and val > 0:
                return float(val), relpath, is_fallback, route_status, route_id

    return 96.0, "default-96min-fallback", True, "unknown", None


def _rad_archive_status() -> str:
    idx_path = DATA_SCIENCE / "pds-archives-index.json"
    if not idx_path.exists():
        return "PDS RAD RDR archive index not yet checked."
    idx = json.loads(idx_path.read_text(encoding="utf-8"))
    rad = idx.get("rad") or {}
    if rad.get("status") == "ok":
        return f"PDS RAD RDR archive reachable ({rad.get('folder_count')} Sol folders)."
    return (
        "PDS RAD RDR archive unavailable during fetch on 2026-11-14 "
        f"({rad.get('error', 'TLS/network error')}); using published Hassler et al. 2014 baseline."
    )


def build_dose() -> dict[str, Any]:
    """Compute EVA radiation dose budget and write data/processed/science/dose.json."""
    duration_min, route_source, is_fallback, route_status, route_id = _read_duration_minutes()
    duration_h = round(duration_min / 60.0, 3)

    dose_msv = round(BASELINE_RATE_MSV_PER_DAY * (duration_h / 24.0), 4)
    dose_unc_msv = round(BASELINE_UNCERTAINTY_MSV_PER_DAY * (duration_h / 24.0), 4)

    if route_status == "example":
        dose_status = "example"
    elif is_fallback:
        dose_status = "placeholder-duration"
    else:
        dose_status = "computed"

    example_clause = " PRE-07 has not locked this route." if route_status == "example" else ""
    payload = {
        "contract": "martian-mappers.dose.v1",
        "status": dose_status,
        "is_example": dose_status == "example",
        "computed_at": utc_now_iso(),
        "note": (
            "Galactic cosmic-ray dose rate hardly changes over a ~10 km walk; "
            "dose depends on EVA duration, space weather, and shielding — never a spatial rock map."
        ),
        "baseline_rate_mSv_per_day": BASELINE_RATE_MSV_PER_DAY,
        "baseline_uncertainty_mSv_per_day": BASELINE_UNCERTAINTY_MSV_PER_DAY,
        "baseline_source": "Hassler et al., Science 2014, Curiosity RAD first ~300 sols, Gale elevation about -4.4 km MOLA",
        "baseline_url": "https://www.science.org/doi/10.1126/science.1244797",
        "route_source": route_source,
        "route_status": route_status,
        "route_id": route_id,
        "eva_duration_min_placeholder": round(duration_min, 1),
        "eva_duration_h_placeholder": duration_h,
        "duration_note": (
            "Walking duration uses a placeholder Earth-hiking assumption from "
            f"{route_source} (route status: {route_status}). Label as a placeholder in the UI."
            + example_clause
        ),
        "dose_estimate_mSv": dose_msv,
        "dose_uncertainty_mSv": dose_unc_msv,
        "dose_formula": "baseline_rate_mSv_per_day * (eva_duration_h_placeholder / 24)",
        "rad_tables_sol_range_available": _rad_archive_status(),
        "shielding_note": (
            "Habitat or rover vs open ground matters more than horizontal position. "
            "A sky-view factor raster is stretch only and must be labelled illustrative."
        ),
    }
    write_json(DATA_SCIENCE / "dose.json", payload)
    return payload


if __name__ == "__main__":
    out = build_dose()
    print(
        f"dose.json written: {out['dose_estimate_mSv']} +/- {out['dose_uncertainty_mSv']} mSv "
        f"for {out['eva_duration_h_placeholder']} h (source={out['route_source']})"
    )
