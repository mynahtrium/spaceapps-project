"""Fetch and cache PDS REMS and RAD directory indexes (MUST-07).

Downloads the top-level DATA/ HTML directory listings into data/raw/
and writes a compact index of available Sol folders to data/processed/science/.
Handles each archive independently and records any network/TLS error honestly.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .common import DATA_RAW, DATA_SCIENCE, http_get_bytes, utc_now_iso, write_json

REMS_DATA_URL = "https://atmos.nmsu.edu/PDS/data/mslrem_1001/DATA/"
RAD_DATA_URL = "https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/DATA/"


def _extract_sol_folders(html_text: str) -> list[str]:
    """Extract SOL_* directory names from an Apache/PDS directory listing."""
    matches = re.findall(r'href="(SOL_[^"/]+/?)"', html_text, flags=re.IGNORECASE)
    seen: list[str] = []
    for m in matches:
        clean = m.rstrip("/")
        if clean not in seen:
            seen.append(clean)
    return sorted(seen)


def _fetch_archive(name: str, url: str, out_dir: Path) -> dict[str, Any]:
    """Fetch one PDS archive listing and return status metadata."""
    try:
        html_text = http_get_bytes(url, timeout=30).decode("utf-8", errors="replace")
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "DATA_index.html").write_text(html_text, encoding="utf-8")
        folders = _extract_sol_folders(html_text)
        return {
            "url": url,
            "status": "ok",
            "folder_count": len(folders),
            "latest_folders": folders[-10:],
        }
    except Exception as exc:
        return {
            "url": url,
            "status": "unavailable",
            "error": str(exc),
            "folder_count": 0,
            "latest_folders": [],
        }


def fetch_pds_indexes() -> dict[str, Any]:
    """Fetch REMS and RAD DATA directory listings and summarize available Sol folders."""
    rems_info = _fetch_archive("rems", REMS_DATA_URL, DATA_RAW / "rems")
    rad_info = _fetch_archive("rad", RAD_DATA_URL, DATA_RAW / "rad")

    summary = {
        "fetched_at": utc_now_iso(),
        "rems": rems_info,
        "rad": rad_info,
    }
    write_json(DATA_SCIENCE / "pds-archives-index.json", summary)
    return summary


if __name__ == "__main__":
    result = fetch_pds_indexes()
    print(
        f"PDS indexes: REMS={result['rems']['status']} ({result['rems']['folder_count']}), "
        f"RAD={result['rad']['status']} ({result['rad']['folder_count']})"
    )
