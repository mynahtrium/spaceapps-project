"""Offline regression & unit tests for refactored pipeline libraries (no live network)."""

from __future__ import annotations

import json
import math
from pathlib import Path
import sys
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import httpx
import numpy as np
from PIL import Image
from pydantic import ValidationError
import pytest
from rasterio.fill import fillnodata
import trimesh

from pipeline.contracts import (
    validate_all_repo_contracts,
    validate_contract,
    write_validated_json,
)
from pipeline.costmap import make_corridor_cost_map, make_cost_map
from pipeline.data import build_layers_themis, common
from pipeline.globe import fetch_globe_texture
from pipeline.routing import build_route, dijkstra_grid, mars_geo
from pipeline.stops import write_stops
from pipeline.terrain import build_corridor, crop_window, make_relief, make_slope, terrain_ops, tilt_check


def test_mars_geo_pyproj_geod():
    assert mars_geo.haversine_m(137.38, -4.6, 137.38, -4.6) == 0.0
    # 1 degree along Mars equator using mean sphere radius 3,389.5 km
    expected_eq_1deg = 2.0 * math.pi * mars_geo.MARS_RADIUS_M / 360.0
    assert mars_geo.haversine_m(137.0, 0.0, 138.0, 0.0) == pytest.approx(expected_eq_1deg, rel=1e-6)
    assert mars_geo.bearing_deg(137.38, -4.6, 137.38, -4.5) == pytest.approx(0.0, abs=1e-6)
    assert mars_geo.bearing_deg(137.38, 0.0, 138.38, 0.0) == pytest.approx(90.0, abs=1e-6)
    assert mars_geo.bearing_deg(137.38, -4.6, 137.38, -4.7) == pytest.approx(180.0, abs=1e-6)
    assert mars_geo.bearing_deg(138.38, 0.0, 137.38, 0.0) == pytest.approx(270.0, abs=1e-6)

    pts = mars_geo.interpolate_lonlat(137.38, -4.6, 137.42, -4.6, 4)
    assert len(pts) == 4
    assert pts[0] == pytest.approx([137.38, -4.6], abs=1e-7)
    assert pts[1] == pytest.approx([137.39, -4.6], abs=1e-5)
    assert pts[-1] == pytest.approx([137.41, -4.6], abs=1e-5)


def test_dijkstra_grid_obstacles_and_unreachable():
    cost = np.ones((15, 15), dtype=float)
    cost[2:12, 7] = 1e100
    path = dijkstra_grid.dijkstra(cost, (7, 2), (7, 12))
    assert path is not None
    assert path[0] == (7, 2)
    assert path[-1] == (7, 12)
    assert all(cost[r, c] < 9e99 for r, c in path)

    # Full vertical barrier makes goal unreachable
    cost[:, 7] = 1e100
    assert dijkstra_grid.dijkstra(cost, (7, 2), (7, 12)) is None

    # Same-cell start == goal
    assert dijkstra_grid.dijkstra(np.ones((5, 5)), (2, 2), (2, 2)) == [(2, 2)]

    # Multi-stop chaining on clear grid
    clear = np.ones((10, 10), dtype=float)
    multi = dijkstra_grid.route_through_stops(clear, [(0, 0), (0, 5), (5, 5)])
    assert multi is not None
    assert multi[0] == (0, 0)
    assert (0, 5) in multi
    assert multi[-1] == (5, 5)


def test_crop_window_pyproj_and_shapely(tmp_path: Path):
    lon0, lat0 = 137.391, -4.797
    x, y = crop_window.lonlat_to_xy(lon0, lat0)
    lon1, lat1 = crop_window.xy_to_lonlat(x, y)
    assert lon1 == pytest.approx(lon0, abs=1e-9)
    assert lat1 == pytest.approx(lat0, abs=1e-9)

    stops_file = tmp_path / "docs" / "contracts" / "stops.json"
    stops_file.parent.mkdir(parents=True, exist_ok=True)
    stops_file.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"id": "stop-a"},
                        "geometry": {"type": "Point", "coordinates": [137.38, -4.80]},
                    },
                    {
                        "type": "Feature",
                        "properties": {"id": "stop-b"},
                        "geometry": {"type": "Point", "coordinates": [137.39, -4.79]},
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    stops = crop_window.load_example_stops(tmp_path)
    assert len(stops) == 2
    cx, cy, half = crop_window.crop_xy(stops, min_half_m=1000.0)
    assert half >= 1000.0
    assert all(abs(s["x"] - cx) <= half + 1e-6 and abs(s["y"] - cy) <= half + 1e-6 for s in stops)

    # Real repo stops.json contains Glenn Torridon north of DTM_LAT_NORTH (-4.73) -> guarded exit
    with pytest.raises(SystemExit, match="outside the documented DTEEC_019698 footprint"):
        crop_window.load_example_stops(REPO_ROOT)


def test_terrain_ops_xrspatial_and_image_io(tmp_path: Path):
    # X-ramp rising east 4m per 4m pixel => 45 deg slope
    zx = np.broadcast_to(np.arange(12, dtype=float)[None, :] * 4.0, (12, 12)).copy()
    sx = terrain_ops.slope_deg(zx, cell_x=4.0, cell_y=8.0)
    assert sx[5, 5] == pytest.approx(45.0, abs=1e-4)

    # Y-ramp rising south 8m per 8m pixel => 45 deg slope
    zy = np.broadcast_to(np.arange(12, dtype=float)[:, None] * 8.0, (12, 12)).copy()
    sy = terrain_ops.slope_deg(zy, cell_x=4.0, cell_y=8.0)
    assert sy[5, 5] == pytest.approx(45.0, abs=1e-4)

    # NaN preservation
    zx_nan = zx.copy()
    zx_nan[6, 6] = np.nan
    sx_nan = terrain_ops.slope_deg(zx_nan, cell_x=4.0)
    assert np.isnan(sx_nan[6, 6])

    # TRI flat vs peak
    flat = np.full((8, 8), 100.0)
    assert terrain_ops.roughness_tri(flat)[4, 4] == pytest.approx(0.0, abs=1e-9)
    peak = flat.copy()
    peak[4, 4] = 103.0
    assert terrain_ops.roughness_tri(peak)[4, 4] > 0.0

    # Hillshade in [0, 1] and illuminates west-facing ramp brighter when sun in west (270) vs east (90)
    hs_west = terrain_ops.hillshade(zx, cell_x=5.0, azimuth_deg=270.0, altitude_deg=45.0)
    hs_east = terrain_ops.hillshade(zx, cell_x=5.0, azimuth_deg=90.0, altitude_deg=45.0)
    assert 0.0 <= float(hs_west.min()) <= float(hs_west.max()) <= 1.0
    assert float(hs_west[5, 5]) > float(hs_east[5, 5])

    # Image roundtrip via Pillow
    rgb = np.zeros((16, 16, 3), dtype=np.uint8)
    rgb[..., 0] = 42
    rgb[..., 1] = 199
    png_path = tmp_path / "test.png"
    terrain_ops.save_image(png_path, rgb)
    with Image.open(png_path) as im:
        np.testing.assert_array_equal(np.asarray(im), rgb)


def test_make_relief_trimesh_watertight_stl(tmp_path: Path):
    z = np.arange(36, dtype=float).reshape(6, 6) * 0.5 - 4000.0
    stl_path = tmp_path / "relief.stl"
    n_tris = make_relief.write_stl(stl_path, z, cell=5.0, base_m=20.0, exaggeration=1.0)
    # 5x5 grid => 50 top tris, perimeter 4*5=20 edges => 40 wall tris + 20 base tris = 110 tris
    assert n_tris == 110
    assert stl_path.stat().st_size == 84 + 50 * 110
    loaded = trimesh.load(stl_path, force="mesh")
    assert loaded.is_watertight
    assert loaded.is_winding_consistent
    assert loaded.volume > 0
    assert float(loaded.bounds[0, 2]) == pytest.approx(0.0, abs=1e-4)
    assert float(loaded.bounds[1, 2]) >= 20.0


def test_build_route_height_preview_and_fillnodata(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    cm_path = REPO_ROOT / "data/processed/terrain/cost-map.json"
    cm = json.loads(cm_path.read_text(encoding="utf-8"))
    hg = build_route.load_height_grid(cm)
    assert hg is not None
    assert hg.shape == (cm["grid"]["nrows"], cm["grid"]["ncols"])
    lo, hi = cm["height_preview_elevation_range_m"]
    finite = hg[np.isfinite(hg)]
    assert finite.min() >= lo - 0.5
    assert finite.max() <= hi + 0.5

    # Synthetic 16-bit RGB PNG height decode through build_route.load_height_grid (value 0 = NaN)
    synth_png = tmp_path / "h.png"
    arr = np.zeros((2, 2, 3), dtype=np.uint8)
    arr[0, 1, 0], arr[0, 1, 1] = 1, 0       # 256
    arr[1, 0, 0], arr[1, 0, 1] = 255, 255   # 65535
    Image.fromarray(arr, mode="RGB").save(synth_png)
    monkeypatch.setattr(build_route, "ROOT", tmp_path)
    decoded = build_route.load_height_grid(
        {
            "height_preview_png_relpath": "h.png",
            "height_preview_elevation_range_m": [-100.0, 100.0],
        }
    )
    assert decoded is not None and decoded.shape == (2, 2)
    assert np.isnan(decoded[0, 0])
    assert decoded[1, 0] == pytest.approx(100.0, abs=1e-6)
    assert decoded[0, 1] == pytest.approx(-100.0 + (256.0 / 65535.0) * 200.0, abs=1e-4)

    # Verify costmap / terrain wrapper delegation and stops contract build
    assert make_cost_map.roughness_tri(np.ones((6, 6))).shape == (6, 6)
    assert make_slope.slope_deg(np.ones((6, 6)), 5.0).shape == (6, 6)
    assert tilt_check.slope_deg(np.ones((6, 6)), 5.0).shape == (6, 6)
    assert callable(make_corridor_cost_map.main)
    validate_contract(write_stops.build_stops(), contract_id="martian-mappers.stops.v1")

    # Verify rasterio.fill.fillnodata fills holes on DEM array
    dem = np.ones((7, 7), dtype=np.float64) * -3900.0
    dem[3, 3] = np.nan
    filled = fillnodata(dem, mask=np.isfinite(dem).astype(np.uint8), max_search_distance=10.0)
    assert np.isfinite(filled).all()
    assert filled[3, 3] == pytest.approx(-3900.0, abs=1e-6)


@pytest.mark.skipif(
    not (
        (build_corridor.RAW / "PSP_009149_1750_RED_A_01_ORTHO.JP2").exists()
        and (build_corridor.RAW / "PSP_009149_1750_RED_A_01_ORTHO.LBL").exists()
    ),
    reason="raw HiRISE JP2/LBL not present on disk",
)
def test_corridor_windowed_jp2_overview():
    ol = build_corridor.ortho_label()
    img, ox0, oy0 = build_corridor.decode_ortho(ol, reduce=4)
    assert img.dtype == np.uint8
    assert img.ndim == 2
    assert ox0 >= 0 and oy0 >= 0
    assert img.size > 0


def test_common_dotenv_redaction_and_tenacity_retry(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    env_file = tmp_path / ".env"
    env_file.write_text("NASA_API_KEY=secret_test_key_123\nEXISTING_VAR=from_file\n", encoding="utf-8")
    monkeypatch.delenv("NASA_API_KEY", raising=False)
    monkeypatch.setenv("EXISTING_VAR", "already_set")

    loaded = common.load_dotenv(env_file)
    assert loaded == {"NASA_API_KEY": "***", "EXISTING_VAR": "***"}
    assert common.os.environ["NASA_API_KEY"] == "secret_test_key_123"
    assert common.os.environ["EXISTING_VAR"] == "already_set"

    # Refuse DEMO_KEY
    monkeypatch.setenv("NASA_API_KEY", "DEMO_KEY")
    assert common.try_nasa_api_key() is None
    with pytest.raises(RuntimeError, match="DEMO_KEY is not allowed"):
        common.get_nasa_api_key()

    # Redact api_key
    assert common.redact_url("https://api.nasa.gov/x?a=1&api_key=MYSECRET&b=2") == (
        "https://api.nasa.gov/x?a=1&api_key=***&b=2"
    )
    assert common.redact_url("https://api.nasa.gov/x?api_key=MYSECRET") == (
        "https://api.nasa.gov/x?api_key=***"
    )

    # Tenacity retry over httpx.MockTransport (no sleep, no live network)
    attempts = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        if attempts["n"] < 3:
            return httpx.Response(503, text="busy")
        return httpx.Response(200, content=b'{"ok":true}')

    transport = httpx.MockTransport(handler)
    orig_client = httpx.Client

    def client_factory(*args, **kwargs):
        kwargs["transport"] = transport
        return orig_client(*args, **kwargs)

    with (
        patch.object(common.httpx, "Client", side_effect=client_factory),
        patch.object(common._fetch_bytes_with_retry.retry, "sleep", lambda _: None),
    ):
        body = common.http_get_bytes("https://example.test/data?api_key=SECRET", timeout=5)
    assert body == b'{"ok":true}'
    assert attempts["n"] == 3

    # Non-retryable 404 still masks api_key
    def not_found_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, text="missing")

    nf_transport = httpx.MockTransport(not_found_handler)
    with patch.object(common.httpx, "Client", side_effect=lambda *a, **kw: orig_client(*a, transport=nf_transport, **kw)):
        with pytest.raises(RuntimeError) as exc_info:
            common.http_get_bytes("https://example.test/missing?api_key=TOPSECRET", timeout=5)
    assert "TOPSECRET" not in str(exc_info.value)
    assert "api_key=***" in str(exc_info.value)


def test_themis_owslib_capabilities_parsing():
    xml_bytes = b"""<?xml version="1.0" encoding="UTF-8"?>
<Capabilities xmlns="http://www.opengis.net/wmts/1.0"
  xmlns:ows="http://www.opengis.net/ows/1.1"
  version="1.0.0">
  <ows:ServiceIdentification>
    <ows:Title>Mars Trek WMTS</ows:Title>
    <ows:ServiceType>OGC WMTS</ows:ServiceType>
    <ows:ServiceTypeVersion>1.0.0</ows:ServiceTypeVersion>
  </ows:ServiceIdentification>
  <Contents>
    <Layer>
      <ows:Title>THEMIS Day IR</ows:Title>
      <ows:Identifier>THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018</ows:Identifier>
      <ows:WGS84BoundingBox>
        <ows:LowerCorner>-180.0 -90.0</ows:LowerCorner>
        <ows:UpperCorner>180.0 90.0</ows:UpperCorner>
      </ows:WGS84BoundingBox>
      <Style isDefault="true"><ows:Identifier>default</ows:Identifier></Style>
      <Format>image/png</Format>
      <TileMatrixSetLink><TileMatrixSet>default028mm</TileMatrixSet></TileMatrixSetLink>
      <ResourceURL format="image/png" resourceType="tile"
        template="https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_DayIR/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png"/>
    </Layer>
    <TileMatrixSet>
      <ows:Identifier>default028mm</ows:Identifier>
      <ows:SupportedCRS>urn:ogc:def:crs:OGC:1.3:CRS84</ows:SupportedCRS>
      <TileMatrix>
        <ows:Identifier>4</ows:Identifier>
        <ScaleDenominator>17471320.75</ScaleDenominator>
        <TopLeftCorner>-180.0 90.0</TopLeftCorner>
        <TileWidth>256</TileWidth>
        <TileHeight>256</TileHeight>
        <MatrixWidth>32.0</MatrixWidth>
        <MatrixHeight>16.0</MatrixHeight>
      </TileMatrix>
    </TileMatrixSet>
  </Contents>
</Capabilities>"""
    parsed = build_layers_themis._parse_capabilities(xml_bytes)
    assert parsed["identifier"] == "THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018"
    assert parsed["style"] == "default"
    assert parsed["tile_matrix_set"] == "default028mm"
    assert parsed["zoom_levels"] == ["4"]
    assert parsed["matrices"][0]["matrix_width"] == 32
    assert parsed["matrices"][0]["matrix_height"] == 16
    col, row = build_layers_themis._latlon_to_tile(-4.80, 137.39, parsed["matrices"][0])
    assert 0 <= col < 32 and 0 <= row < 16


def test_globe_stitch_and_fetch(tmp_path: Path):
    tiles = []
    for r in range(2):
        row = []
        for c in range(2):
            p = tmp_path / f"tile_{r}_{c}.jpg"
            Image.new("RGB", (256, 256), (r * 100, c * 100, 50)).save(p, "JPEG")
            row.append(p)
        tiles.append(row)
    out = tmp_path / "globe.jpg"
    fetch_globe_texture.stitch(tiles, out, quality=85)
    with Image.open(out) as im:
        assert im.size == (512, 512)

    attempts = {"n": 0}
    orig_client = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        if attempts["n"] == 1:
            return httpx.Response(502, text="bad gateway")
        return httpx.Response(200, content=b"JPEGBYTES")

    dest = tmp_path / "one.jpg"
    with (
        patch.object(
            fetch_globe_texture.httpx,
            "Client",
            side_effect=lambda *a, **kw: orig_client(*a, transport=httpx.MockTransport(handler), **kw),
        ),
        patch.object(fetch_globe_texture._get_tile_bytes.retry, "sleep", lambda _: None),
    ):
        fetch_globe_texture.fetch("https://trek.nasa.gov/tile.jpg", dest, tries=3)
    assert dest.read_bytes() == b"JPEGBYTES"
    assert attempts["n"] == 2


def test_contracts_validate_all_and_reject_bad(tmp_path: Path):
    checked = validate_all_repo_contracts(REPO_ROOT)
    assert len(checked) >= 40

    bad_cost_map = json.loads((REPO_ROOT / "data/demo/cost-map.json").read_text(encoding="utf-8"))
    bad_cost_map["mars_radius_km"] = 6371.0  # Earth radius must be rejected
    with pytest.raises(ValidationError):
        validate_contract(bad_cost_map)

    out_path = tmp_path / "bad.json"
    with pytest.raises(ValidationError):
        write_validated_json(out_path, bad_cost_map, contract_id="martian-mappers.cost-map.v1")
    assert not out_path.exists()
