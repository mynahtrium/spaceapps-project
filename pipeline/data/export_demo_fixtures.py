"""Copy frozen Backend 3 science outputs into data/demo/ for demo-safe mode (SHOULD-07).

Copies only small static JSON and cached PNG/JPEG assets from data/processed/science/
into data/demo/ (never raw data, never secrets, no network calls).
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from .common import DATA_SCIENCE, REPO_ROOT, utc_now_iso, write_json

DEMO_DIR = REPO_ROOT / "data" / "demo"

SCIENCE_JSON_FILES = (
    "alerts.json",
    "alerts.example.json",
    "donki-cache.example.json",
    "dose.json",
    "weather.json",
    "layers-themis.json",
    "layers-crism.json",
)


def export_demo_fixtures() -> dict[str, Any]:
    """Copy Backend 3 frozen outputs to data/demo/."""
    DEMO_DIR.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []

    for fname in SCIENCE_JSON_FILES:
        src = DATA_SCIENCE / fname
        if src.exists():
            dst = DEMO_DIR / fname
            shutil.copy2(src, dst)
            copied.append(fname)

    for folder_name in ("pov", "tiles"):
        src_dir = DATA_SCIENCE / folder_name
        if src_dir.exists():
            dst_dir = DEMO_DIR / folder_name
            shutil.copytree(src_dir, dst_dir, dirs_exist_ok=True)
            for p in sorted(dst_dir.rglob("*")):
                if p.is_file():
                    copied.append(str(p.relative_to(DEMO_DIR)).replace("\\", "/"))

    # Also copy frozen terrain and routing fixtures so ?demo=1 works 100% offline (BUG-06).
    extra_sources = [
        REPO_ROOT / "data" / "processed" / "terrain" / "cost-map.json",
        REPO_ROOT / "data" / "processed" / "terrain" / "slope-preview.png",
        REPO_ROOT / "data" / "processed" / "terrain" / "height-preview.png",
        REPO_ROOT / "data" / "processed" / "routing" / "stops.json",
        REPO_ROOT / "data" / "processed" / "routing" / "route.json",
        REPO_ROOT / "data" / "processed" / "routing" / "hud-telemetry.json",
    ]
    for src in extra_sources:
        if src.exists():
            dst = DEMO_DIR / src.name
            shutil.copy2(src, dst)
            copied.append(src.name)

    manifest = {
        "generated_at": utc_now_iso(),
        "owner": "backend-3",
        "purpose": "Frozen offline fixtures for DEMO_SAFE=1 / ?demo=1 (SHOULD-07)",
        "file_count": len(copied),
        "files": copied,
    }
    write_json(DEMO_DIR / "science-manifest.json", manifest)
    return manifest


if __name__ == "__main__":
    out = export_demo_fixtures()
    print(f"data/demo/ science fixtures exported: {out['file_count']} files")
