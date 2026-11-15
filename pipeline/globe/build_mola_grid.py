#!/usr/bin/env python3
"""Global MOLA topography grid for the browser: real elevation anywhere off the HiRISE windows.

Input : MGS MOLA MEGDR megt90n000eb.img (16 px/deg, MSB int16 metres above the areoid), from
        https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/
Output: data/demo/globe/mola-8ppd.png  2880x1440, 0 E at the left edge, north row first.
        Height (m) = R*256 + G - 32768 (8-bit PNG so the browser canvas can decode it).
        data/demo/globe/mola-8ppd.json  metadata and source.
Usage : python3 pipeline/globe/build_mola_grid.py <megt90n000eb.img> [out_dir]
"""
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

src = Path(sys.argv[1])
out = Path(sys.argv[2] if len(sys.argv) > 2 else "data/demo/globe")
out.mkdir(parents=True, exist_ok=True)
a = np.fromfile(src, dtype=">i2").reshape(2880, 5760).astype(np.float64)
a = a.reshape(1440, 2, 2880, 2).mean(axis=(1, 3))  # 16 -> 8 px/deg
v = np.clip(np.round(a) + 32768, 0, 65535).astype(np.uint16)
rgb = np.zeros((1440, 2880, 3), np.uint8)
rgb[..., 0] = v >> 8
rgb[..., 1] = v & 255
ppm = out / "mola-8ppd.ppm"
ppm.write_bytes(b"P6 2880 1440 255\n" + rgb.tobytes())
subprocess.run(["magick", str(ppm), "-define", "png:compression-level=9", str(out / "mola-8ppd.png")], check=True)
ppm.unlink()
(out / "mola-8ppd.json").write_text(json.dumps({
    "width": 2880, "height": 1440, "pixelsPerDegree": 8, "west": 0, "north": 90,
    "encoding": "height_m = R*256 + G - 32768",
    "minHeightM": float(a.min()), "maxHeightM": float(a.max()),
    "source": {"product": "MGS MOLA MEGDR megt90n000eb (16 ppd, averaged to 8 ppd)",
               "url": "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img",
               "provider": "NASA / GSFC MOLA team, PDS Geosciences Node", "fetched": dt.date.today().isoformat()},
}, indent=2) + "\n")
print("ok", a.min(), a.max())
