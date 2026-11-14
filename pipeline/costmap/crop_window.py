"""Compatibility re-export of ``pipeline/terrain/crop_window.py``.

Kept under ``pipeline/costmap/`` so direct scripts in either directory can
import ``crop_window`` without duplicating window/projection logic (BUG-08).
"""
import importlib.util
from pathlib import Path

_TERRAIN_CROP_WINDOW = Path(__file__).resolve().parents[1] / "terrain" / "crop_window.py"
_SPEC = importlib.util.spec_from_file_location("_terrain_crop_window", _TERRAIN_CROP_WINDOW)
if _SPEC is None or _SPEC.loader is None:
    raise ImportError(f"Could not load canonical crop_window from {_TERRAIN_CROP_WINDOW}")
_MOD = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MOD)

MARS_R_M = _MOD.MARS_R_M
LON0 = _MOD.LON0
DTM_LON_WEST = _MOD.DTM_LON_WEST
DTM_LON_EAST = _MOD.DTM_LON_EAST
DTM_LAT_SOUTH = _MOD.DTM_LAT_SOUTH
DTM_LAT_NORTH = _MOD.DTM_LAT_NORTH
STOP_FILES = _MOD.STOP_FILES

lonlat_to_xy = _MOD.lonlat_to_xy
xy_to_lonlat = _MOD.xy_to_lonlat
load_example_stops = _MOD.load_example_stops
crop_xy = _MOD.crop_xy

__all__ = [
    "MARS_R_M",
    "LON0",
    "DTM_LON_WEST",
    "DTM_LON_EAST",
    "DTM_LAT_SOUTH",
    "DTM_LAT_NORTH",
    "STOP_FILES",
    "lonlat_to_xy",
    "xy_to_lonlat",
    "load_example_stops",
    "crop_xy",
]
