"""Shared terrain derivative and image I/O helpers backed by xarray-spatial and Pillow.

Centralises slope, Terrain Ruggedness Index (TRI), hillshade, and PNG/JPEG
writing so ``make_slope.py``, ``tilt_check.py``, ``make_cost_map.py``,
``make_corridor_cost_map.py``, ``make_relief.py``, and ``crop_ortho.py`` share
one implementation rather than duplicating ``np.gradient``, 8-neighbour loops,
or hand-rolled PNG encoders.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image
import xarray as xr
import xrspatial


def to_dataarray(z: np.ndarray, cell_x: float, cell_y: float | None = None) -> xr.DataArray:
    """Wrap a 2D north-up elevation array in an ``xarray.DataArray`` with metric coords."""
    arr = np.asarray(z, dtype=np.float64)
    if arr.ndim != 2:
        raise ValueError(f"Expected 2D elevation grid, got shape {arr.shape}")
    cy = float(cell_x if cell_y is None else cell_y)
    cx = float(cell_x)
    rows, cols = arr.shape
    return xr.DataArray(
        arr,
        dims=("y", "x"),
        coords={
            "y": np.arange(rows, dtype=np.float64) * -cy,
            "x": np.arange(cols, dtype=np.float64) * cx,
        },
    )


def slope_deg(z: np.ndarray, cell_x: float, cell_y: float | None = None) -> np.ndarray:
    """Compute surface slope in degrees using ``xrspatial.slope`` (Horn planar method)."""
    arr = np.asarray(z, dtype=np.float64)
    da = to_dataarray(arr, cell_x, cell_y)
    out = xrspatial.slope(da, method="planar", boundary="nearest").to_numpy().astype(np.float64)
    return np.where(np.isfinite(arr), out, np.nan)


def roughness_tri(z: np.ndarray, cell_x: float = 1.0, cell_y: float | None = None) -> np.ndarray:
    """Compute Riley Terrain Ruggedness Index (m) using ``xrspatial.tri``."""
    arr = np.asarray(z, dtype=np.float64)
    da = to_dataarray(arr, cell_x, cell_y)
    out = xrspatial.tri(da, boundary="nearest").to_numpy().astype(np.float64)
    return np.where(np.isfinite(arr), out, np.nan)


def hillshade(
    z: np.ndarray,
    cell_x: float,
    cell_y: float | None = None,
    azimuth_deg: float = 315.0,
    altitude_deg: float = 40.0,
) -> np.ndarray:
    """Compute normalised [0, 1] shaded relief using ``xrspatial.hillshade``."""
    arr = np.asarray(z, dtype=np.float64)
    da = to_dataarray(arr, cell_x, cell_y)
    hs = (
        xrspatial.hillshade(
            da,
            azimuth=float(azimuth_deg),
            angle_altitude=float(altitude_deg),
            boundary="nearest",
        )
        .to_numpy()
        .astype(np.float64)
    )
    return np.clip(hs, 0.0, 1.0)


def save_image(path: Path | str, arr: np.ndarray, *, quality: int = 90) -> None:
    """Save an 8-bit grayscale (``L``) or RGB (``RGB``) image via Pillow."""
    out_path = Path(path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img_u8 = np.asarray(arr, dtype=np.uint8)
    mode = "L" if img_u8.ndim == 2 else "RGB"
    img = Image.fromarray(img_u8, mode=mode)
    suffix = out_path.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        img.save(out_path, format="JPEG", quality=int(quality), optimize=True)
    else:
        img.save(out_path, format="PNG")
