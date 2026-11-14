/**
 * Mars Geodesy, Projection, Tile Math, and Relative-To-Center (RTC) Datum Utilities.
 *
 * Adapted for Gale Crater / Mount Sharp (Curiosity rover site).
 * References:
 * - Mean Mars radius: 3,389.5 km (IAU / AGENTS.md)
 * - Equatorial Mars radius: 3,396.19 km (IAU 2015 / HiRISE DTEEC PDS DTM labels)
 * - Polar Mars radius: 3,376.20 km (IAU 2015 spheroid)
 * - Horizontal frame: Mars planetocentric [longitude, latitude] in degrees (East positive, South negative)
 * - Vertical frame: MOLA Mars areoid (meters; DTEEC_019698 elevations -3850.6..-3369.3 m)
 */

export const MARS_RADIUS_MEAN_M = 3389500;
export const MARS_RADIUS_EQ_M = 3396190;
export const MARS_RADIUS_POLAR_M = 3376200;
export const WEB_MERCATOR_MAX_LAT_DEG = 85.05112877980659;

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * Wrap longitude into [-180, 180]. Handles Mars PDS 0..360 east-longitude inputs safely.
 * A positive input that lands exactly on the antimeridian is kept as +180 (so 180 stays 180, not -180).
 * @param {number} lonDeg
 * @returns {number}
 */
export function normalizeLonDeg(lonDeg) {
  if (!Number.isFinite(lonDeg)) {
    throw new RangeError(`Invalid longitude: ${lonDeg}`);
  }
  const wrapped = ((((lonDeg + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 && lonDeg > 0 ? 180 : wrapped;
}

/**
 * Clamp latitude into [-90, 90].
 * @param {number} latDeg
 * @returns {number}
 */
export function clampLatDeg(latDeg, maxAbsLat = 90) {
  if (!Number.isFinite(latDeg)) {
    throw new RangeError(`Invalid latitude: ${latDeg}`);
  }
  return Math.max(-maxAbsLat, Math.min(maxAbsLat, latDeg));
}

/**
 * Enforce strict GeoJSON [lon, lat] coordinate order across arrays or objects.
 * @param {number[]|{lon?:number,lng?:number,lat:number}} coord
 * @returns {[number, number]}
 */
export function toLngLat(coord) {
  let lon;
  let lat;
  if (Array.isArray(coord) && coord.length >= 2) {
    lon = Number(coord[0]);
    lat = Number(coord[1]);
  } else if (coord && typeof coord === "object") {
    lon = Number(coord.lon ?? coord.lng);
    lat = Number(coord.lat);
  } else {
    throw new TypeError("Coordinate must be [lon, lat] or { lon/lng, lat }");
  }
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new RangeError(`Non-finite coordinate: [${lon}, ${lat}]`);
  }
  if (lat < -90 || lat > 90) {
    throw new RangeError(`Latitude out of bounds [-90, 90]: ${lat} (did you swap [lat, lon]?)`);
  }
  return [normalizeLonDeg(lon), lat];
}

/**
 * MOLA areoid vertical datum offset (meters).
 * Gale DTEEC_019698 and Curiosity waypoints share MOLA areoid heights, so offset is 0 m.
 * @param {number} _latDeg
 * @param {number} _lonDeg
 * @returns {number}
 */
export function areoidOffsetM(_latDeg, _lonDeg) {
  return 0;
}

/**
 * Great-circle Haversine distance in meters on Mars (mean radius 3,389.5 km by default).
 * @param {number[]|{lon?:number,lng?:number,lat:number}} a
 * @param {number[]|{lon?:number,lng?:number,lat:number}} b
 * @param {number} [radiusM=MARS_RADIUS_MEAN_M]
 * @returns {number}
 */
export function marsDistanceM(a, b, radiusM = MARS_RADIUS_MEAN_M) {
  const [lon1, lat1] = toLngLat(a);
  const [lon2, lat2] = toLngLat(b);
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = wrapLongitudeDeltaDeg(lon2 - lon1) * DEG2RAD;
  const phi1 = lat1 * DEG2RAD;
  const phi2 = lat2 * DEG2RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(phi1) * Math.cos(phi2) * sinLon * sinLon;
  return 2 * radiusM * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

/**
 * Initial forward azimuth bearing in degrees clockwise from Mars true North [0, 360).
 * @param {number[]|{lon?:number,lng?:number,lat:number}} a
 * @param {number[]|{lon?:number,lng?:number,lat:number}} b
 * @returns {number}
 */
export function marsBearingDeg(a, b) {
  const [lon1, lat1] = toLngLat(a);
  const [lon2, lat2] = toLngLat(b);
  const phi1 = lat1 * DEG2RAD;
  const phi2 = lat2 * DEG2RAD;
  const dLon = wrapLongitudeDeltaDeg(lon2 - lon1) * DEG2RAD;
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * RAD2DEG) + 360) % 360;
}

/**
 * Shortest signed longitudinal delta wrapped to [-180, 180] degrees.
 * Prevents paths crossing ±180° from taking the long way around Mars.
 * @param {number} deltaLonDeg
 * @returns {number}
 */
export function wrapLongitudeDeltaDeg(deltaLonDeg) {
  let d = ((deltaLonDeg + 180) % 360 + 360) % 360 - 180;
  if (d === -180 && deltaLonDeg > 0) d = 180;
  return d;
}

/**
 * Unwrap sequential [lon, lat] path vertices across the antimeridian so longitudes vary smoothly.
 * @param {Array<number[]>} coords
 * @returns {Array<[number, number]>}
 */
export function interpolateAntimeridianPath(coords) {
  if (!Array.isArray(coords) || coords.length === 0) return [];
  const out = [];
  let prevLon = null;
  for (const pt of coords) {
    const [lonRaw, lat] = toLngLat(pt);
    if (prevLon === null) {
      out.push([lonRaw, lat]);
      prevLon = lonRaw;
    } else {
      const unwrapped = prevLon + wrapLongitudeDeltaDeg(lonRaw - prevLon);
      out.push([unwrapped, lat]);
      prevLon = unwrapped;
    }
  }
  return out;
}

/**
 * Convert [lon, lat] to normalized Web Mercator [x, y] in [0, 1] (top-left origin).
 * @param {number} lonDeg
 * @param {number} latDeg
 * @returns {{ x: number, y: number }}
 */
export function lonLatToMercatorNormalized(lonDeg, latDeg) {
  const lon = normalizeLonDeg(lonDeg);
  const lat = clampLatDeg(latDeg, WEB_MERCATOR_MAX_LAT_DEG);
  const x = (lon + 180) / 360;
  const sinLat = Math.sin(lat * DEG2RAD);
  const y = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  return { x, y };
}

/**
 * Inverse normalized Web Mercator [x, y] in [0, 1] -> [lon, lat] in degrees.
 * @param {number} nx
 * @param {number} ny
 * @returns {[number, number]}
 */
export function mercatorNormalizedToLonLat(nx, ny) {
  const lon = normalizeLonDeg(nx * 360 - 180);
  const n = Math.PI * (1 - 2 * ny);
  const lat = Math.atan(Math.sinh(n)) * RAD2DEG;
  return [lon, clampLatDeg(lat)];
}

/**
 * Convert [lon, lat] to Web Mercator meters (Mars equatorial radius 3,396.19 km).
 * @param {number} lonDeg
 * @param {number} latDeg
 * @param {number} [radiusM=MARS_RADIUS_EQ_M]
 * @returns {{ x: number, y: number }}
 */
export function lonLatToMercatorMeters(lonDeg, latDeg, radiusM = MARS_RADIUS_EQ_M) {
  const lon = normalizeLonDeg(lonDeg);
  const lat = clampLatDeg(latDeg, WEB_MERCATOR_MAX_LAT_DEG);
  const x = radiusM * lon * DEG2RAD;
  const y = radiusM * Math.log(Math.tan(Math.PI / 4 + (lat * DEG2RAD) / 2));
  return { x, y };
}

/**
 * Convert Web Mercator meters -> [lon, lat] in degrees.
 * @param {number} xM
 * @param {number} yM
 * @param {number} [radiusM=MARS_RADIUS_EQ_M]
 * @returns {[number, number]}
 */
export function mercatorMetersToLonLat(xM, yM, radiusM = MARS_RADIUS_EQ_M) {
  const lon = normalizeLonDeg((xM / radiusM) * RAD2DEG);
  const lat = (2 * Math.atan(Math.exp(yM / radiusM)) - Math.PI / 2) * RAD2DEG;
  return [lon, clampLatDeg(lat)];
}

/**
 * Web Mercator Slippy Tile index { z, x, y } for [lon, lat].
 * @param {number} lonDeg
 * @param {number} latDeg
 * @param {number} z
 * @returns {{ z: number, x: number, y: number }}
 */
export function lonLatToTile(lonDeg, latDeg, z) {
  const zoom = Math.max(0, Math.floor(z));
  const n = 2 ** zoom;
  const { x: nx, y: ny } = lonLatToMercatorNormalized(lonDeg, latDeg);
  const x = Math.max(0, Math.min(n - 1, Math.floor(nx * n)));
  const y = Math.max(0, Math.min(n - 1, Math.floor(ny * n)));
  return { z: zoom, x, y };
}

/**
 * Geographic bounds { west, south, east, north } for a Web Mercator Slippy tile (z, x, y).
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @returns {{ west: number, south: number, east: number, north: number }}
 */
export function tileToLonLatBounds(z, x, y) {
  const n = 2 ** z;
  const [west, north] = mercatorNormalizedToLonLat(x / n, y / n);
  const [east, south] = mercatorNormalizedToLonLat((x + 1) / n, (y + 1) / n);
  return { west, south, east, north };
}

/**
 * Ground resolution (meters/pixel) on Mars at a given latitude and Web Mercator zoom.
 * @param {number} latDeg
 * @param {number} z
 * @param {number} [tileSize=256]
 * @param {number} [radiusM=MARS_RADIUS_EQ_M]
 * @returns {number}
 */
export function metersPerPixelAtLat(
  latDeg,
  z,
  tileSize = 256,
  radiusM = MARS_RADIUS_EQ_M
) {
  const cosLat = Math.max(0.01, Math.cos(clampLatDeg(latDeg) * DEG2RAD));
  return (2 * Math.PI * radiusM * cosLat) / (tileSize * 2 ** z);
}

/**
 * Select Web Mercator tile zoom matching camera altitude and viewport height.
 * @param {number} viewportHeightPx
 * @param {number} latDeg
 * @param {number} cameraAltM
 * @param {number} [fovDeg=55]
 * @param {number} [tileSize=256]
 * @returns {number}
 */
export function computeTargetZoom(
  viewportHeightPx,
  latDeg,
  cameraAltM,
  fovDeg = 55,
  tileSize = 256
) {
  const alt = Math.max(10, cameraAltM);
  const groundSpanM = 2 * alt * Math.tan((fovDeg * 0.5) * DEG2RAD);
  const targetMpp = groundSpanM / Math.max(128, viewportHeightPx);
  const cosLat = Math.max(0.01, Math.cos(clampLatDeg(latDeg) * DEG2RAD));
  const rawZ = Math.log2(
    (2 * Math.PI * MARS_RADIUS_EQ_M * cosLat) / (tileSize * targetMpp)
  );
  return Math.max(0, Math.min(20, Math.round(rawZ)));
}

/**
 * Mars Trek / ArcGIS OnMars Equirectangular (EPSG:4326 2:1) tile index.
 * Grid has nCols = 2^(eqZ + 1), nRows = 2^eqZ, covering lon [-180, 180], lat [+90, -90].
 * @param {number} lonDeg
 * @param {number} latDeg
 * @param {number} eqZ
 * @returns {{ z: number, col: number, row: number }}
 */
export function lonLatToMarsEquirectTile(lonDeg, latDeg, eqZ) {
  const z = Math.max(0, Math.floor(eqZ));
  const nCols = 2 ** (z + 1);
  const nRows = 2 ** z;
  const lon = normalizeLonDeg(lonDeg);
  const lat = clampLatDeg(latDeg);
  const col = Math.max(0, Math.min(nCols - 1, Math.floor(((lon + 180) / 360) * nCols)));
  const row = Math.max(0, Math.min(nRows - 1, Math.floor(((90 - lat) / 180) * nRows)));
  return { z, col, row };
}

/**
 * Geographic bounds { west, south, east, north } for a Mars Equirectangular tile.
 * @param {number} eqZ
 * @param {number} col
 * @param {number} row
 * @returns {{ west: number, south: number, east: number, north: number }}
 */
export function marsEquirectTileToBounds(eqZ, col, row) {
  const nCols = 2 ** (eqZ + 1);
  const nRows = 2 ** eqZ;
  const west = -180 + (col / nCols) * 360;
  const east = -180 + ((col + 1) / nCols) * 360;
  const north = 90 - (row / nRows) * 180;
  const south = 90 - ((row + 1) / nRows) * 180;
  return { west, south, east, north };
}

/**
 * Map a Web Mercator zoom z to a Mars Trek Equirectangular LOD level.
 * At eqZ = z - 1, equirectangular longitude column count (2^z) equals Web Mercator (2^z).
 * @param {number} mercatorZ
 * @param {number} [maxEqZ=9]
 * @returns {number}
 */
export function mercatorZoomToMarsEquirectZoom(mercatorZ, maxEqZ = 9) {
  return Math.max(0, Math.min(maxEqZ, Math.floor(mercatorZ) - 1));
}

/**
 * Compute 3D planetocentric Mars ECEF coordinates (float64 meters).
 * X points to (0°N, 0°E), Y points to (0°N, 90°E), Z points to Mars North Pole (+90°N).
 * @param {number} lonDeg
 * @param {number} latDeg
 * @param {number} [elevM=0]
 * @param {number} [radiusM=MARS_RADIUS_MEAN_M]
 * @returns {{ x: number, y: number, z: number }}
 */
export function lonLatHeightToMarsECEF(
  lonDeg,
  latDeg,
  elevM = 0,
  radiusM = MARS_RADIUS_MEAN_M
) {
  const lon = normalizeLonDeg(lonDeg) * DEG2RAD;
  const lat = clampLatDeg(latDeg) * DEG2RAD;
  const r = radiusM + elevM + areoidOffsetM(latDeg, lonDeg);
  const cosLat = Math.cos(lat);
  return {
    x: r * cosLat * Math.cos(lon),
    y: r * cosLat * Math.sin(lon),
    z: r * Math.sin(lat),
  };
}

/**
 * Create a high-precision Float64 Relative-To-Center (RTC) local tangent anchor
 * aligned with Three.js axes: +X = East, +Y = Up (radial normal), +Z = South (-North).
 * @param {number} anchorLonDeg
 * @param {number} anchorLatDeg
 * @param {number} [anchorElevM=0]
 * @param {number} [radiusM=MARS_RADIUS_MEAN_M]
 */
export function makeLocalTangentOrigin(
  anchorLonDeg,
  anchorLatDeg,
  anchorElevM = 0,
  radiusM = MARS_RADIUS_MEAN_M
) {
  const lonRad = normalizeLonDeg(anchorLonDeg) * DEG2RAD;
  const latRad = clampLatDeg(anchorLatDeg) * DEG2RAD;
  const ecef = lonLatHeightToMarsECEF(anchorLonDeg, anchorLatDeg, anchorElevM, radiusM);

  const sinLon = Math.sin(lonRad);
  const cosLon = Math.cos(lonRad);
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);

  // Basis vectors in ECEF
  const east = { x: -sinLon, y: cosLon, z: 0 };
  const up = { x: cosLat * cosLon, y: cosLat * sinLon, z: sinLat };
  // South = cross(east, up) = (-sinLat*cosLon, -sinLat*sinLon, cosLat) -> wait: North is (-sinLat*cosLon, -sinLat*sinLon, cosLat)
  // Let's verify: at lat=0, lon=0: up=(1,0,0), east=(0,1,0). North=(0,0,1). South=(0,0,-1).
  // In Three.js right-handed space: +X = East, +Y = Up, +Z = South -> cross(X, Y) = cross(East, Up) = South!
  // Let's check cross(east, up):
  // x: east.y*up.z - east.z*up.y = cosLon*sinLat
  // y: east.z*up.x - east.x*up.z = sinLon*sinLat
  // z: east.x*up.y - east.y*up.x = -sinLon*cosLat*sinLon - cosLon*cosLat*cosLon = -cosLat
  // At lat=0, lon=0: cross(east, up) = (0, 0, -1) = South! Right-handed verified.
  const north = { x: -sinLat * cosLon, y: -sinLat * sinLon, z: cosLat };
  const south = { x: -north.x, y: -north.y, z: -north.z };

  return {
    lonDeg: normalizeLonDeg(anchorLonDeg),
    latDeg: anchorLatDeg,
    elevM: anchorElevM,
    radiusM,
    ecef,
    east,
    up,
    north,
    south,
  };
}

/**
 * Project geographic [lon, lat, elevM] into Float32-safe local RTC coordinates around `origin`.
 * Three.js scene axes: x = East (m), y = Up (m), z = South (m, so North is -z).
 * @param {number} lonDeg
 * @param {number} latDeg
 * @param {number} elevM
 * @param {ReturnType<typeof makeLocalTangentOrigin>} origin
 * @returns {{ x: number, y: number, z: number }}
 */
export function lonLatElevToLocalRTC(lonDeg, latDeg, elevM, origin) {
  const p = lonLatHeightToMarsECEF(lonDeg, latDeg, elevM, origin.radiusM);
  const dx = p.x - origin.ecef.x;
  const dy = p.y - origin.ecef.y;
  const dz = p.z - origin.ecef.z;
  return {
    x: dx * origin.east.x + dy * origin.east.y + dz * origin.east.z,
    y: dx * origin.up.x + dy * origin.up.y + dz * origin.up.z,
    z: dx * origin.south.x + dy * origin.south.y + dz * origin.south.z,
  };
}

/**
 * Inverse transform: local RTC (x=East, y=Up, z=South) back to [lon, lat, elevM].
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {ReturnType<typeof makeLocalTangentOrigin>} origin
 * @returns {{ lon: number, lat: number, elevM: number }}
 */
export function localRTCToLonLatElev(x, y, z, origin) {
  const ex =
    origin.ecef.x +
    x * origin.east.x +
    y * origin.up.x +
    z * origin.south.x;
  const ey =
    origin.ecef.y +
    x * origin.east.y +
    y * origin.up.y +
    z * origin.south.y;
  const ez =
    origin.ecef.z +
    x * origin.east.z +
    y * origin.up.z +
    z * origin.south.z;
  const r = Math.hypot(ex, ey, ez);
  const lon = normalizeLonDeg(Math.atan2(ey, ex) * RAD2DEG);
  const lat = Math.asin(Math.max(-1, Math.min(1, ez / r))) * RAD2DEG;
  const elevM = r - origin.radiusM - areoidOffsetM(lat, lon);
  return { lon, lat, elevM };
}

/**
 * Terrarium RGB elevation decoder: elevation_m = (R * 256 + G + B / 256) - 32768.
 * Covers [-32768 m, +32767.996 m] with 1/256 m (~0.0039 m) vertical resolution.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {number}
 */
export function decodeTerrariumPixel(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

/**
 * Terrarium RGB elevation encoder (exact inverse of decodeTerrariumPixel).
 * @param {number} elevM
 * @returns {[number, number, number]}
 */
export function encodeTerrariumPixel(elevM) {
  const clamped = Math.max(-32768, Math.min(32767.99609375, elevM));
  const v = clamped + 32768;
  const r = Math.floor(v / 256);
  const remAfterR = v - r * 256;
  const g = Math.floor(remAfterR);
  const b = Math.max(0, Math.min(255, Math.round((remAfterR - g) * 256)));
  // Handle rounding carry when b == 256 would happen (clamped above to 255)
  return [
    Math.max(0, Math.min(255, r)),
    Math.max(0, Math.min(255, g)),
    b,
  ];
}

/**
 * Decode Mars HiRISE height-preview.png pixel (R*256 + G, 0 = NoData).
 * Valid 1..65535 maps linearly onto [minElevM, maxElevM].
 * @param {number} r
 * @param {number} g
 * @param {number} minElevM
 * @param {number} maxElevM
 * @returns {number} NaN if NoData (0), otherwise elevation in meters.
 */
export function decodeHiRiseRgb16Pixel(r, g, minElevM, maxElevM) {
  const code = (r << 8) | g;
  if (code === 0) return Number.NaN;
  const t = (code - 1) / 65534;
  return minElevM + t * (maxElevM - minElevM);
}
