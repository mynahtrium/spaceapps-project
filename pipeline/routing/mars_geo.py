"""Mars distance helpers. Mean radius 3389.5 km (AGENTS.md)."""

from __future__ import annotations

import math

MARS_RADIUS_M = 3_389_500.0


def haversine_m(lon1_deg: float, lat1_deg: float, lon2_deg: float, lat2_deg: float) -> float:
    """Great-circle distance on a sphere of Mars mean radius."""
    lon1, lat1, lon2, lat2 = map(math.radians, (lon1_deg, lat1_deg, lon2_deg, lat2_deg))
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * MARS_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def interpolate_lonlat(
    lon1: float, lat1: float, lon2: float, lat2: float, n_seg: int
) -> list[list[float]]:
    """Linear lon/lat samples including start, excluding end (caller closes)."""
    if n_seg < 1:
        return [[lon1, lat1]]
    out: list[list[float]] = []
    for i in range(n_seg):
        t = i / n_seg
        out.append([lon1 + (lon2 - lon1) * t, lat1 + (lat2 - lat1) * t])
    return out


def bearing_deg(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    lon1r, lat1r, lon2r, lat2r = map(math.radians, (lon1, lat1, lon2, lat2))
    dlon = lon2r - lon1r
    x = math.sin(dlon) * math.cos(lat2r)
    y = math.cos(lat1r) * math.sin(lat2r) - math.sin(lat1r) * math.cos(lat2r) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0
