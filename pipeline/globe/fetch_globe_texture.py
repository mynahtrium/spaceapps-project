#!/usr/bin/env python3
"""Build the equirectangular Mars globe textures used by the Orbit view.

Stitches NASA Mars Trek WMTS tiles (equirectangular, 2^(z+1) x 2^z tiles of 256 px at zoom z)
into one image per layer and writes them to web/assets/mars-globe/.

Layers:
  - Viking MDIM 2.1 colour mosaic (NASA / USGS), day-side surface colour.
  - MGS MOLA colour-shaded relief, the alternate "elevation" layer.

Stitching uses Pillow; tile downloads run concurrently with httpx + tenacity.
Run once from the repository root:  python3 pipeline/globe/fetch_globe_texture.py [--zoom 3]
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import tempfile
from pathlib import Path

import httpx
from PIL import Image
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

TREK = "https://trek.nasa.gov/tiles/Mars/EQ"
LAYERS = {
    "mars-viking-color": "Mars_Viking_MDIM21_ClrMosaic_global_232m",
    "mars-mola-shade": "Mars_MGS_MOLA_ClrShade_merge_global_463m",
}
TILE = 256
ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "web" / "assets" / "mars-globe"
MAX_WORKERS = 8


@retry(
    reraise=True,
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=1.5, min=1.5, max=10.0),
    retry=retry_if_exception_type(httpx.HTTPError),
)
def _get_tile_bytes(client: httpx.Client, url: str) -> bytes:
    resp = client.get(url, timeout=30.0)
    resp.raise_for_status()
    return resp.content


def fetch(url: str, dest: Path, tries: int = 4, *, client: httpx.Client | None = None) -> None:
    attempt = _get_tile_bytes.retry_with(stop=stop_after_attempt(max(1, int(tries))))
    try:
        if client is not None:
            dest.write_bytes(attempt(client, url))
        else:
            with httpx.Client(
                follow_redirects=True,
                headers={"User-Agent": "mars-globe-builder/1.0"},
            ) as owned_client:
                dest.write_bytes(attempt(owned_client, url))
    except Exception as exc:  # noqa: BLE001 - wrap final retry exhaustion cleanly
        raise RuntimeError(f"failed: {url}: {exc}") from exc


def stitch(tiles: list[list[Path]], out: Path, quality: int) -> None:
    rows, cols = len(tiles), len(tiles[0])
    canvas = Image.new("RGB", (cols * TILE, rows * TILE))
    for r, row in enumerate(tiles):
        for c, p in enumerate(row):
            with Image.open(p) as tile_im:
                canvas.paste(tile_im.convert("RGB"), (c * TILE, r * TILE))
    canvas.save(out, "JPEG", quality=quality, optimize=True, progressive=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--zoom", type=int, default=3, help="Trek zoom level (3 -> 4096x2048)")
    ap.add_argument("--quality", type=int, default=86)
    ap.add_argument("--workers", type=int, default=MAX_WORKERS, help="Concurrent HTTP tile downloads")
    args = ap.parse_args()
    z = args.zoom
    cols, rows = 2 ** (z + 1), 2**z
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    limits = httpx.Limits(max_connections=max(4, args.workers * 2), max_keepalive_connections=args.workers)
    with (
        tempfile.TemporaryDirectory() as tmp,
        httpx.Client(
            follow_redirects=True,
            limits=limits,
            headers={"User-Agent": "mars-globe-builder/1.0"},
        ) as client,
    ):
        tmpdir = Path(tmp)
        for name, layer in LAYERS.items():
            grid: list[list[Path]] = []
            jobs: list[tuple[str, Path]] = []
            for r in range(rows):
                row = []
                for c in range(cols):
                    p = tmpdir / f"{name}_{r}_{c}.jpg"
                    url = f"{TREK}/{layer}/1.0.0/default/default028mm/{z}/{r}/{c}.jpg"
                    jobs.append((url, p))
                    row.append(p)
                grid.append(row)
            with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
                list(pool.map(lambda job: fetch(job[0], job[1], client=client), jobs))
            print(f"{name}: fetched {len(jobs)} tiles ({cols}x{rows})", flush=True)
            out = OUT_DIR / f"{name}-{cols * TILE // 1024}k.jpg"
            stitch(grid, out, args.quality)
            print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
