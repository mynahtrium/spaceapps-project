"""MUST-01: crop the 25 cm HiRISE orthoimage to the same footprint as the DTM crop.

Run make_slope.py first (it writes data/raw/terrain/dtm_crop_1m.tif).
That crop is the example-stop window, not a locked outcrop map.

Outputs:
    data/raw/terrain/ortho_crop.tif            (gitignored, ~1 m / pixel preview of the 25 cm image)
    data/processed/terrain/ortho-preview.png   (small, 1000 x 1000)
"""
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds
from skimage.io import imsave

ORTHO_URL = (
    "https://hirise-pds.lpl.arizona.edu/PDS/DTM/ESP/ORB_019600_019699/"
    "ESP_019698_1750_ESP_019988_1750/ESP_019698_1750_RED_A_01_ORTHO.JP2"
)
ROOT = Path(__file__).resolve().parents[2]
OUT_PX = 1000  # preview size; the ortho is read at reduced resolution on purpose


def main():
    raw = ROOT / "data/raw/terrain"
    out = ROOT / "data/processed/terrain"
    with rasterio.open(raw / "dtm_crop_1m.tif") as dtm:
        b = dtm.bounds
    with rasterio.open("/vsicurl/" + ORTHO_URL) as ds:
        win = from_bounds(b.left, b.bottom, b.right, b.top, ds.transform)
        img = ds.read(1, window=win, out_shape=(OUT_PX, OUT_PX), resampling=Resampling.average)
        transform = rasterio.transform.from_bounds(b.left, b.bottom, b.right, b.top, OUT_PX, OUT_PX)
        crs = ds.crs
    with rasterio.open(
        raw / "ortho_crop.tif", "w", driver="GTiff", height=OUT_PX, width=OUT_PX,
        count=1, dtype="uint8", crs=crs, transform=transform,
    ) as dst:
        dst.write(img, 1)
    imsave(out / "ortho-preview.png", img.astype(np.uint8), check_contrast=False)
    print("ortho crop", img.shape, "valid share", float((img > 0).mean()))


if __name__ == "__main__":
    main()
