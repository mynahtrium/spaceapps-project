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


def _file_is_example(data: dict[str, Any], features: list[dict[str, Any]]) -> bool:
    """True when the stops file or any feature is still an example."""
    if str(data.get("status") or "").lower() == "example":
        return True
    return any(bool((feat.get("properties") or {}).get("is_example")) for feat in features)


def _load_stops() -> tuple[list[dict[str, Any]], str, bool]:
    processed_stops = REPO_ROOT / "data" / "processed" / "routing" / "stops.json"
    contract_stops = REPO_ROOT / "docs" / "contracts" / "stops.json"

    if processed_stops.exists():
        data = json.loads(processed_stops.read_text(encoding="utf-8"))
        features = data.get("features") or []
        return features, "data/processed/routing/stops.json", _file_is_example(data, features)
    data = json.loads(contract_stops.read_text(encoding="utf-8"))
    features = data.get("features") or []
    return features, "docs/contracts/stops.json", _file_is_example(data, features)


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


def build_pov(allow_download: bool = True) -> dict[str, Any]:
    """Write per-stop POV JSON. Download a JPEG only when allow_download is true and the file is missing."""
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
        image_bytes_source = "missing"

        if jpg_path.exists() and jpg_path.stat().st_size > 0:
            byte_size = jpg_path.stat().st_size
            image_bytes_source = "existing-file"
        elif not allow_download:
            missing = True
            image_bytes_source = "skipped"
            missing_label = "Live image download skipped. JPEG is not on disk."
        else:
            try:
                img_bytes = http_get_bytes(img_url, timeout=30)
                jpg_path.write_bytes(img_bytes)
                byte_size = len(img_bytes)
                image_bytes_source = "downloaded"
            except Exception as exc:
                missing = True
                image_bytes_source = "download-failed"
                missing_label = f"Download failed ({exc}); image unavailable offline."

        link_note = (
            "Linked to placeholder stops until PRE-07 locks real stops."
            if is_example_stops
            else "Linked to locked stops."
        )
        reuse_note = (
            " JPEG reused from disk; not re-downloaded."
            if image_bytes_source == "existing-file"
            else ""
        )

        # Keep the image identity that belongs to the JPEG already on disk.
        # Re-picking from the cache can select a different frame than that file.
        prior: dict[str, Any] = {}
        prior_path = pov_dir / f"{stop_id}.json"
        if image_bytes_source == "existing-file" and prior_path.exists():
            try:
                loaded = json.loads(prior_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                loaded = None
            if isinstance(loaded, dict) and loaded.get("imageid"):
                prior = loaded

        entry = {
            "contract": "martian-mappers.pov.v1",
            "status": "cached" if not missing else "unavailable",
            "fetched_at": utc_now_iso(),
            "note": "Cached Curiosity rover raw image still for offline demo. " + link_note + reuse_note,
            "image_bytes_source": image_bytes_source,
            "stop_id": stop_id,
            "stop_name": props.get("name"),
            "stops_source": stops_source,
            "is_example_stop": is_example_stops or bool(props.get("is_example")),
            "imageid": prior.get("imageid") or picked.get("imageid"),
            "sol": prior.get("sol") if prior else picked.get("sol"),
            "camera": prior.get("camera") if prior else picked.get("camera"),
            "title": prior.get("title") if prior else picked.get("title"),
            "date_taken_utc": prior.get("date_taken_utc") if prior else picked.get("date_taken_utc"),
            "image_relpath": relpath if not missing else None,
            "bytes": byte_size,
            "source_url": prior.get("source_url") or img_url,
            "credit": prior.get("credit") or picked.get("credit") or "NASA/JPL-Caltech",
            "missing": missing,
            "missing_label": missing_label,
        }
        write_json(pov_dir / f"{stop_id}.json", entry)
        index_entries.append(entry)

    index_payload = {
        "contract": "martian-mappers.pov-index.v1",
        "fetched_at": utc_now_iso(),
        "stops_source": stops_source,
        "is_example_stops": is_example_stops,
        "count": len(index_entries),
        "stops": index_entries,
    }
    write_json(pov_dir / "index.json", index_payload)
    return index_payload


if __name__ == "__main__":
    out = build_pov()
    ok = sum(1 for s in out["stops"] if not s.get("missing"))
    print(f"POV stills cached: {ok}/{out['count']} stops (source={out['stops_source']})")
