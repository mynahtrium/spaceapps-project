#!/usr/bin/env python3
"""Build the equirectangular Mars globe textures used by the Orbit view.

Stitches NASA Mars Trek WMTS tiles (equirectangular, 2^(z+1) x 2^z tiles of 256 px at zoom z)
into one image per layer and writes them to web/assets/mars-globe/.

Layers:
  - Viking MDIM 2.1 colour mosaic (NASA / USGS), day-side surface colour.
  - MGS MOLA colour-shaded relief, the alternate "elevation" layer.

Stitching uses Pillow when installed, otherwise ImageMagick (`magick`).
Run once from the repository root:  python3 pipeline/globe/fetch_globe_texture.py [--zoom 3]
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

TREK = "https://trek.nasa.gov/tiles/Mars/EQ"
LAYERS = {
    "mars-viking-color": "Mars_Viking_MDIM21_ClrMosaic_global_232m",
    "mars-mola-shade": "Mars_MGS_MOLA_ClrShade_merge_global_463m",
}
TILE = 256
ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "web" / "assets" / "mars-globe"


def fetch(url: str, dest: Path, tries: int = 4) -> None:
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "mars-globe-builder/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                dest.write_bytes(resp.read())
            return
        except Exception as exc:  # noqa: BLE001 - retry any network error
            if attempt == tries - 1:
                raise RuntimeError(f"failed: {url}: {exc}") from exc
            time.sleep(1.5 * (attempt + 1))


def stitch(tiles: list[list[Path]], out: Path, quality: int) -> None:
    rows, cols = len(tiles), len(tiles[0])
    try:
        from PIL import Image  # type: ignore

        canvas = Image.new("RGB", (cols * TILE, rows * TILE))
        for r, row in enumerate(tiles):
            for c, p in enumerate(row):
                canvas.paste(Image.open(p).convert("RGB"), (c * TILE, r * TILE))
        canvas.save(out, "JPEG", quality=quality, optimize=True, progressive=True)
        return
    except ImportError:
        pass
    magick = shutil.which("magick")
    if not magick:
        sys.exit("Need Pillow (pip install pillow) or ImageMagick (magick) to stitch tiles.")
    row_files = []
    for r, row in enumerate(tiles):
        rf = out.with_name(f".row{r}.png")
        subprocess.run([magick, *map(str, row), "+append", str(rf)], check=True)
        row_files.append(rf)
    subprocess.run(
        [magick, *map(str, row_files), "-append", "-strip", "-interlace", "Plane", "-quality", str(quality), str(out)],
        check=True,
    )
    for rf in row_files:
        rf.unlink(missing_ok=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--zoom", type=int, default=3, help="Trek zoom level (3 -> 4096x2048)")
    ap.add_argument("--quality", type=int, default=86)
    args = ap.parse_args()
    z = args.zoom
    cols, rows = 2 ** (z + 1), 2**z
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        for name, layer in LAYERS.items():
            grid: list[list[Path]] = []
            for r in range(rows):
                row = []
                for c in range(cols):
                    p = tmpdir / f"{name}_{r}_{c}.jpg"
                    fetch(f"{TREK}/{layer}/1.0.0/default/default028mm/{z}/{r}/{c}.jpg", p)
                    row.append(p)
                grid.append(row)
                print(f"{name}: row {r + 1}/{rows}", flush=True)
            out = OUT_DIR / f"{name}-{cols * TILE // 1024}k.jpg"
            stitch(grid, out, args.quality)
            print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
