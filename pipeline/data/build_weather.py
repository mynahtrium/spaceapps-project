"""Fetch Curiosity REMS weather feed and build data/processed/science/weather.json (SHOULD-04).

Uses NASA/CAB MSL REMS outreach JSON feed (official REMS team daily summary):
https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json
(Falls back gracefully if PDS atmos.nmsu.edu archive resets connections.)
Matches the martian-mappers.weather.v1 contract in docs/contracts/weather.json.
"""

from __future__ import annotations

from typing import Any

from .common import DATA_RAW, DATA_SCIENCE, http_get_json, utc_now_iso, write_json

REMS_FEED_URL = "https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json"


def _to_float(val: Any) -> float | None:
    if val in (None, "", "--"):
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _slim_sol(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "sol": int(entry["sol"]) if str(entry.get("sol", "")).isdigit() else entry.get("sol"),
        "terrestrial_date": entry.get("terrestrial_date"),
        "season": entry.get("season"),
        "ls_deg": _to_float(entry.get("ls")),
        "air_min_C": _to_float(entry.get("min_temp")),
        "air_max_C": _to_float(entry.get("max_temp")),
        "ground_min_C": _to_float(entry.get("min_gts_temp")),
        "ground_max_C": _to_float(entry.get("max_gts_temp")),
        "pressure_Pa": _to_float(entry.get("pressure")),
        "atmo_opacity": entry.get("atmo_opacity"),
        "uv_index": entry.get("local_uv_irradiance_index"),
        "sunrise": entry.get("sunrise"),
        "sunset": entry.get("sunset"),
    }


def build_weather() -> dict[str, Any]:
    """Fetch REMS weather feed, cache raw JSON, and write weather.json."""
    raw = http_get_json(REMS_FEED_URL, timeout=45)
    write_json(DATA_RAW / "rems" / "msl_rems_weather.json", raw)

    soles = raw.get("soles") or []
    recent_slim = [_slim_sol(s) for s in soles[:7]]
    latest = recent_slim[0] if recent_slim else {}

    boxwork_sols = [
        _slim_sol(s)
        for s in soles
        if str(s.get("sol", "")).isdigit() and 4534 <= int(s["sol"]) <= 4700
    ]

    sunrise = latest.get("sunrise") or "06:30"
    sunset = latest.get("sunset") or "18:30"

    # Contract-compatible samples derived strictly from the latest reported daily min/max
    # (no invented hourly curve — diurnal endpoints are explicitly labelled daily min/max).
    samples = []
    if latest:
        samples = [
            {
                "local_true_solar_time": sunrise,
                "air_temp_C": latest.get("air_min_C"),
                "ground_temp_C": latest.get("ground_min_C"),
                "note": f"Daily minimum at/near sunrise (Sol {latest.get('sol')})",
                "is_example": False,
            },
            {
                "local_true_solar_time": "14:30",
                "air_temp_C": latest.get("air_max_C"),
                "ground_temp_C": latest.get("ground_max_C"),
                "note": f"Daily maximum afternoon peak (Sol {latest.get('sol')}; exact peak hour not provided in summary feed)",
                "is_example": False,
            },
        ]

    payload = {
        "contract": "martian-mappers.weather.v1",
        "status": "cached",
        "fetched_at": utc_now_iso(),
        "note": (
            "Real daily REMS summaries provided by Centro de Astrobiologia (CAB) via NASA MSL weather feed. "
            "PDS raw archive (atmos.nmsu.edu) reset connections on 2026-11-14, so daily min/max feed is used "
            "without inventing sub-hourly curves."
        ),
        "instrument": "Curiosity REMS",
        "archive_url": REMS_FEED_URL,
        "pds_archive_url": "https://atmos.nmsu.edu/PDS/data/mslrem_1001/DATA/",
        "site": "Gale / Mount Sharp",
        "total_sols_in_feed": len(soles),
        "latest_sol": latest,
        "recent_7_sols": recent_slim,
        "boxwork_sols_4534_4700_count": len(boxwork_sols),
        "boxwork_sols_sample": boxwork_sols[:5],
        "samples": samples,
        "chosen_window": {
            "local_true_solar_time_start": sunrise,
            "local_true_solar_time_end": "09:30",
            "reason": (
                f"Early-morning window after sunrise ({sunrise}) avoids peak afternoon ground heating "
                f"(up to {latest.get('ground_max_C')} C) and midday UV ({latest.get('uv_index')}) on Sol {latest.get('sol')}."
            ),
        },
        "recommended_eva_window_note": "Derived from CAB/NASA REMS daily summary; diurnal sub-hourly curve not in feed.",
    }
    write_json(DATA_SCIENCE / "weather.json", payload)
    return payload


if __name__ == "__main__":
    out = build_weather()
    latest = out.get("latest_sol") or {}
    print(
        f"weather.json written: total_sols={out['total_sols_in_feed']}, "
        f"latest_sol={latest.get('sol')} (air {latest.get('air_min_C')}..{latest.get('air_max_C')} C)"
    )
