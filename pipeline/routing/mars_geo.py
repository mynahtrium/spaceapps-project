"""Mars geodesic distance, bearing, and interpolation via pyproj.Geod.

Uses Mars mean radius 3389.5 km (AGENTS.md) as a spherical Mars datum so
geodesic distances, bearings, and great-circle waypoints match repo conventions.
"""

from __future__ import annotations

from pyproj import Geod

MARS_RADIUS_M = 3_389_500.0
MARS_EQUATORIAL_RADIUS_M = 3_396_190.0
MARS_POLAR_RADIUS_M = 3_376_200.0

MARS_GEOD = Geod(a=MARS_RADIUS_M, b=MARS_RADIUS_M)
MARS_ELLIPSOID_GEOD = Geod(a=MARS_EQUATORIAL_RADIUS_M, b=MARS_POLAR_RADIUS_M)


def haversine_m(lon1_deg: float, lat1_deg: float, lon2_deg: float, lat2_deg: float) -> float:
    """Great-circle distance (m) on a sphere of Mars mean radius."""
    if lon1_deg == lon2_deg and lat1_deg == lat2_deg:
        return 0.0
    _, _, dist_m = MARS_GEOD.inv(lon1_deg, lat1_deg, lon2_deg, lat2_deg)
    return float(dist_m)


def interpolate_lonlat(
    lon1: float, lat1: float, lon2: float, lat2: float, n_seg: int
) -> list[list[float]]:
    """Geodesic lon/lat samples including start, excluding end (caller closes)."""
    if n_seg <= 1:
        return [[float(lon1), float(lat1)]]
    if lon1 == lon2 and lat1 == lat2:
        return [[float(lon1), float(lat1)] for _ in range(n_seg)]
    mid = MARS_GEOD.npts(lon1, lat1, lon2, lat2, n_seg - 1)
    return [[float(lon1), float(lat1)]] + [[float(lon), float(lat)] for lon, lat in mid]


def bearing_deg(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Forward azimuth (degrees clockwise from north) along the Mars sphere."""
    if lon1 == lon2 and lat1 == lat2:
        return 0.0
    az12, _, _ = MARS_GEOD.inv(lon1, lat1, lon2, lat2)
    return float((az12 + 360.0) % 360.0)
