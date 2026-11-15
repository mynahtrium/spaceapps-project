"""Copy frozen Backend 3 science outputs into data/demo/ for demo-safe mode (SHOULD-07).

Copies only small static JSON and cached PNG/JPEG assets from data/processed/science/
into data/demo/ (never raw data, never secrets, no network calls).
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any

from .common import DATA_SCIENCE, REPO_ROOT, utc_now_iso, write_json

DEMO_DIR = REPO_ROOT / "data" / "demo"
_PROCESSED_PREFIX_RE = re.compile(r"data/processed/(?:terrain|routing|science)/")

SCIENCE_JSON_FILES = (
    "alerts.json",
    "alerts.example.json",
    "donki-cache.json",
    "donki-cache.example.json",
    "dose.json",
    "weather.json",
    "layers-themis.json",
    "layers-crism.json",
)


def _rewrite_demo_paths(obj: Any) -> Any:
    """Rewrite data/processed/<domain>/ paths to data/demo/ for offline demo fixtures."""
    if isinstance(obj, dict):
        return {k: _rewrite_demo_paths(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_rewrite_demo_paths(item) for item in obj]
    if isinstance(obj, str):
        return _PROCESSED_PREFIX_RE.sub("data/demo/", obj)
    return obj


def _copy_or_rewrite_json(src: Path, dst: Path) -> None:
    """Copy asset to data/demo/, rewriting processed paths to data/demo/ inside JSON files."""
    if src.suffix.lower() != ".json":
        shutil.copy2(src, dst)
        return
    raw_bytes = src.stat().st_size
    data = json.loads(src.read_text(encoding="utf-8"))
    rewritten = _rewrite_demo_paths(data)
    if raw_bytes > 100_000:
        dst.write_text(json.dumps(rewritten, separators=(",", ":")), encoding="utf-8")
    else:
        write_json(dst, rewritten)


def export_demo_fixtures() -> dict[str, Any]:
    """Copy Backend 3 frozen outputs (plus terrain/routing previews) to data/demo/."""
    DEMO_DIR.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []

    for fname in SCIENCE_JSON_FILES:
        src = DATA_SCIENCE / fname
        if src.exists():
            dst = DEMO_DIR / fname
            _copy_or_rewrite_json(src, dst)
            copied.append(fname)

    for folder_name in ("pov", "tiles"):
        src_dir = DATA_SCIENCE / folder_name
        if src_dir.exists():
            dst_dir = DEMO_DIR / folder_name
            dst_dir.mkdir(parents=True, exist_ok=True)
            for p in sorted(src_dir.rglob("*")):
                if p.is_file():
                    rel = p.relative_to(src_dir)
                    dst = dst_dir / rel
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    _copy_or_rewrite_json(p, dst)
                    copied.append(str(dst.relative_to(DEMO_DIR)).replace("\\", "/"))

    # Also copy frozen terrain and routing fixtures so ?demo=1 works 100% offline (BUG-06).
    extra_sources = [
        REPO_ROOT / "data" / "processed" / "terrain" / "cost-map.json",
        REPO_ROOT / "data" / "processed" / "terrain" / "slope-preview.png",
        REPO_ROOT / "data" / "processed" / "terrain" / "height-preview.png",
        REPO_ROOT / "data" / "processed" / "terrain" / "ortho-preview.png",
        REPO_ROOT / "data" / "processed" / "terrain" / "texture-relief.jpg",
        REPO_ROOT / "data" / "processed" / "routing" / "stops.json",
        REPO_ROOT / "data" / "processed" / "routing" / "route.json",
        REPO_ROOT / "data" / "processed" / "routing" / "hud-telemetry.json",
    ]
    for src in extra_sources:
        if src.exists():
            dst = DEMO_DIR / src.name
            _copy_or_rewrite_json(src, dst)
            copied.append(src.name)

    # Preserve pre-bundled global Mars assets in data/demo/ inside the manifest.
    for global_name in (
        "mars-global-sources.json",
        "mars-mola-dem.png",
        "mars-mola-shaded.jpg",
        "mars-viking-global.jpg",
    ):
        if (DEMO_DIR / global_name).exists() and global_name not in copied:
            copied.append(global_name)

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
