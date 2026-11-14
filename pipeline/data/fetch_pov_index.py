"""Fetch and cache Curiosity (MSL) raw image feed metadata (MUST-07).

Uses the undocumented MMGIS/NASA RSS raw_images feed (never api.nasa.gov/mars-photos).
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from .common import DATA_RAW, DATA_SCIENCE, http_get_json, utc_now_iso, write_json

RAW_IMAGE_FEED = "https://mars.nasa.gov/rss/api/"


def _build_feed_url(num: int = 40, sol_min: int | None = None, sol_max: int | None = None) -> str:
    params = [
        "feed=raw_images",
        "category=msl",
        "feedtype=json",
        f"num={num}",
        "page=0",
        "order=sol+desc",
    ]
    if sol_min is not None:
        params.append(f"condition_2={quote(f'{sol_min}:sol:gte')}")
    if sol_max is not None:
        params.append(f"condition_3={quote(f'{sol_max}:sol:lte')}")
    return f"{RAW_IMAGE_FEED}?{'&'.join(params)}"


def _slim_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    slimmed: list[dict[str, Any]] = []
    for item in items:
        img_files = item.get("image_files") or {}
        slimmed.append(
            {
                "imageid": item.get("imageid"),
                "sol": item.get("sol"),
                "camera": (item.get("camera") or {}).get("instrument"),
                "title": item.get("title"),
                "date_taken_utc": item.get("date_taken_utc"),
                "credit": item.get("credit"),
                "medium_url": img_files.get("medium"),
                "small_url": img_files.get("small"),
                "full_res_url": img_files.get("full_res"),
            }
        )
    return slimmed


def fetch_pov_index() -> dict[str, Any]:
    """Cache recent MSL raw images and boxwork-window (Sol 4534-4700) metadata."""
    raw_dir = DATA_RAW / "msl"
    latest_url = _build_feed_url(num=30)
    boxwork_url = _build_feed_url(num=30, sol_min=4534, sol_max=4700)

    latest_data = http_get_json(latest_url, timeout=45)
    boxwork_data = http_get_json(boxwork_url, timeout=45)

    write_json(raw_dir / "msl_raw_latest.json", latest_data)
    write_json(raw_dir / "msl_raw_boxwork_4534_4700.json", boxwork_data)

    latest_images = latest_data.get("images") or latest_data.get("items") or []
    boxwork_images = boxwork_data.get("images") or boxwork_data.get("items") or []

    summary = {
        "fetched_at": utc_now_iso(),
        "sources": {
            "latest": latest_url,
            "boxwork_4534_4700": boxwork_url,
        },
        "latest_count": len(latest_images),
        "boxwork_count": len(boxwork_images),
        "latest_items": _slim_items(latest_images),
        "boxwork_items": _slim_items(boxwork_images),
    }
    write_json(DATA_SCIENCE / "msl-raw-images-cache.json", summary)
    return summary


if __name__ == "__main__":
    result = fetch_pov_index()
    print(
        f"MSL raw images cached: latest={result['latest_count']}, "
        f"boxwork={result['boxwork_count']}"
    )
