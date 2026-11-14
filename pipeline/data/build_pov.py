"""Cache Curiosity POV JPEG stills and per-stop POV JSON files (SHOULD-03).

Reads stops from data/processed/routing/stops.json if present,
otherwise falls back to docs/contracts/stops.json (marked is_example_stop=True).
Uses data/processed/science/msl-raw-images-cache.json (never api.nasa.gov/mars-photos).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .common import DATA_SCIENCE, REPO_ROOT, http_get_bytes, utc_now_iso, write_json


def _load_stops() -> tuple[list[dict[str, Any]], str, bool]:
    processed_stops = REPO_ROOT / "data" / "processed" / "routing" / "stops.json"
    contract_stops = REPO_ROOT / "docs" / "contracts" / "stops.json"

    if processed_stops.exists():
        data = json.loads(processed_stops.read_text(encoding="utf-8"))
        return data.get("features") or [], "data/processed/routing/stops.json", False
    data = json.loads(contract_stops.read_text(encoding="utf-8"))
    return data.get("features") or [], "docs/contracts/stops.json", True


def _pick_image(
    stop_props: dict[str, Any],
    boxwork_items: list[dict[str, Any]],
    latest_items: list[dict[str, Any]],
    used_ids: set[str],
) -> dict[str, Any] | None:
    sol_hint = stop_props.get("sol_hint")
    kind = str(stop_props.get("kind") or "")

    # Prefer Navcam / Mastcam medium-or-small JPEGs so files stay compact
    preferred_pool = boxwork_items if (sol_hint or "boxwork" in kind) else (latest_items + boxwork_items)
    nav_first = sorted(
        preferred_pool,
        key=lambda item: (
            0 if "NAV" in str(item.get("camera") or "").upper() else 1,
            abs(int(item.get("sol") or 0) - int(sol_hint)) if sol_hint else 0,
        ),
    )
    for item in nav_first:
        img_id = item.get("imageid")
        url = item.get("medium_url") or item.get("small_url")
        if img_id and url and img_id not in used_ids:
            used_ids.add(img_id)
            return item
    return None


def build_pov() -> dict[str, Any]:
    """Download compact Curiosity POV JPEGs for each stop and write pov/*.json."""
    cache_path = DATA_SCIENCE / "msl-raw-images-cache.json"
    if not cache_path.exists():
        raise FileNotFoundError(
            f"Missing {cache_path}. Run `python -m pipeline.data.run_must07 --only pov` first."
        )

    cache = json.loads(cache_path.read_text(encoding="utf-8"))
    latest_items = cache.get("latest_items") or []
    boxwork_items = cache.get("boxwork_items") or []

    stops, stops_source, is_example_stops = _load_stops()
    pov_dir = DATA_SCIENCE / "pov"
    pov_dir.mkdir(parents=True, exist_ok=True)

    used_ids: set[str] = set()
    index_entries: list[dict[str, Any]] = []

    for feat in stops:
        props = feat.get("properties") or {}
        stop_id = props.get("id") or "unknown-stop"
        picked = _pick_image(props, boxwork_items, latest_items, used_ids)

        if picked is None:
            entry = {
                "contract": "martian-mappers.pov.v1",
                "status": "empty",
                "fetched_at": utc_now_iso(),
                "stop_id": stop_id,
                "stops_source": stops_source,
                "is_example_stop": is_example_stops or bool(props.get("is_example")),
                "sol": None,
                "camera": None,
                "image_relpath": None,
                "credit": "NASA / JPL-Caltech",
                "missing": True,
                "missing_label": "No cached rover image matched this stop yet.",
            }
            write_json(pov_dir / f"{stop_id}.json", entry)
            index_entries.append(entry)
            continue

        img_url = picked.get("medium_url") or picked.get("small_url")
        jpg_path = pov_dir / f"{stop_id}.jpg"
        relpath = f"data/processed/science/pov/{stop_id}.jpg"
        missing = False
        missing_label = ""
        byte_size = 0

        try:
            img_bytes = http_get_bytes(img_url, timeout=30)
            jpg_path.write_bytes(img_bytes)
            byte_size = len(img_bytes)
        except Exception as exc:
            missing = True
            missing_label = f"Download failed ({exc}); image unavailable offline."

        entry = {
            "contract": "martian-mappers.pov.v1",
            "status": "cached" if not missing else "unavailable",
            "fetched_at": utc_now_iso(),
            "note": (
                "Cached Curiosity rover raw image still for offline demo. "
                + ("Linked to placeholder stops until PRE-07 locks real stops." if is_example_stops else "Linked to locked stops.")
            ),
            "stop_id": stop_id,
            "stop_name": props.get("name"),
            "stops_source": stops_source,
            "is_example_stop": is_example_stops or bool(props.get("is_example")),
            "imageid": picked.get("imageid"),
            "sol": picked.get("sol"),
            "camera": picked.get("camera"),
            "title": picked.get("title"),
            "date_taken_utc": picked.get("date_taken_utc"),
            "image_relpath": relpath if not missing else None,
            "bytes": byte_size,
            "source_url": img_url,
            "credit": picked.get("credit") or "NASA/JPL-Caltech",
            "missing": missing,
            "missing_label": missing_label,
        }
        write_json(pov_dir / f"{stop_id}.json", entry)
        index_entries.append(entry)

    index_payload = {
        "contract": "martian-mappers.pov-index.v1",
        "fetched_at": utc_now_iso(),
        "stops_source": stops_source,
        "count": len(index_entries),
        "stops": index_entries,
    }
    write_json(pov_dir / "index.json", index_payload)
    return index_payload


if __name__ == "__main__":
    out = build_pov()
    ok = sum(1 for s in out["stops"] if not s.get("missing"))
    print(f"POV stills cached: {ok}/{out['count']} stops (source={out['stops_source']})")
