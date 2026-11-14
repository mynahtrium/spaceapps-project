"""Fetch Mars Trek THEMIS WMTS capabilities, cache sample Gale tiles, and write layers-themis.json.

Matches the martian-mappers.layer-themis.v1 contract in docs/contracts/layers-themis.json.
"""

from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from .common import DATA_RAW, DATA_SCIENCE, http_get_bytes, utc_now_iso, write_json

THEMIS_DAY_CAPS = (
    "https://trek.nasa.gov/tiles/Mars/EQ/"
    "THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml"
)
THEMIS_NIGHT_CAPS = (
    "https://trek.nasa.gov/tiles/Mars/EQ/"
    "THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml"
)

# Gale / Mount Sharp site center (Curiosity traverse / HiRISE DTM 019698)
GALE_LAT = -4.80
GALE_LON = 137.39

NS = {
    "wmts": "http://www.opengis.net/wmts/1.0",
    "ows": "http://www.opengis.net/ows/1.1",
}


def _text(elem: ET.Element | None, path: str) -> str | None:
    if elem is None:
        return None
    found = elem.find(path, NS)
    return found.text.strip() if found is not None and found.text else None


def _parse_capabilities(xml_bytes: bytes) -> dict[str, Any]:
    root = ET.fromstring(xml_bytes)
    layer = root.find(".//wmts:Contents/wmts:Layer", NS)
    if layer is None:
        raise RuntimeError("No <Layer> found in WMTSCapabilities.xml")

    identifier = _text(layer, "ows:Identifier")
    title = _text(layer, "ows:Title") or identifier
    style_id = _text(layer, "wmts:Style/ows:Identifier") or "default"
    tms_id = _text(layer, "wmts:TileMatrixSetLink/wmts:TileMatrixSet") or "default028mm"

    res_url_elem = layer.find("wmts:ResourceURL[@resourceType='tile']", NS)
    template = res_url_elem.attrib.get("template") if res_url_elem is not None else None
    img_format = res_url_elem.attrib.get("format") if res_url_elem is not None else "image/png"

    bbox_elem = layer.find("ows:WGS84BoundingBox", NS)
    lower = _text(bbox_elem, "ows:LowerCorner")
    upper = _text(bbox_elem, "ows:UpperCorner")

    matrices: list[dict[str, Any]] = []
    for tms in root.findall(".//wmts:Contents/wmts:TileMatrixSet", NS):
        if _text(tms, "ows:Identifier") != tms_id:
            continue
        for tm in tms.findall("wmts:TileMatrix", NS):
            tm_id = _text(tm, "ows:Identifier")
            top_left_str = _text(tm, "wmts:TopLeftCorner")
            mw = _text(tm, "wmts:MatrixWidth")
            mh = _text(tm, "wmts:MatrixHeight")
            if tm_id and mw and mh:
                tl_parts = [float(x) for x in top_left_str.split()] if top_left_str else [-180.0, 90.0]
                matrices.append(
                    {
                        "id": tm_id,
                        "matrix_width": int(float(mw)),
                        "matrix_height": int(float(mh)),
                        "top_left_lon": tl_parts[0],
                        "top_left_lat": tl_parts[1],
                    }
                )

    return {
        "identifier": identifier,
        "title": title,
        "style": style_id,
        "tile_matrix_set": tms_id,
        "format": img_format,
        "tile_url_template": template,
        "wgs84_bbox": {"lower": lower, "upper": upper},
        "zoom_levels": [m["id"] for m in matrices],
        "matrices": matrices,
    }


def _latlon_to_tile(lat: float, lon: float, matrix: dict[str, Any]) -> tuple[int, int]:
    """Convert geographic lat/lon to Trek EQ WMTS col/row for a TileMatrix."""
    # Mars Trek EQ spans [-180, 180] lon and [90, -90] lat
    mw = matrix["matrix_width"]
    mh = matrix["matrix_height"]
    norm_lon = ((lon + 180.0) % 360.0) / 360.0
    norm_lat = (90.0 - lat) / 180.0
    col = max(0, min(mw - 1, int(math.floor(norm_lon * mw))))
    row = max(0, min(mh - 1, int(math.floor(norm_lat * mh))))
    return col, row


def _cache_sample_tiles(
    key: str, parsed: dict[str, Any], tile_dir: Path, target_zooms: tuple[str, ...] = ("4", "6", "8")
) -> list[dict[str, Any]]:
    template = parsed.get("tile_url_template")
    if not template:
        return []

    by_id = {m["id"]: m for m in parsed.get("matrices", [])}
    cached: list[dict[str, Any]] = []
    out_dir = tile_dir / key
    out_dir.mkdir(parents=True, exist_ok=True)

    for z in target_zooms:
        matrix = by_id.get(z)
        if not matrix:
            continue
        col, row = _latlon_to_tile(GALE_LAT, GALE_LON, matrix)
        url = (
            template.replace("{Style}", parsed["style"])
            .replace("{TileMatrixSet}", parsed["tile_matrix_set"])
            .replace("{TileMatrix}", str(z))
            .replace("{TileRow}", str(row))
            .replace("{TileCol}", str(col))
        )
        ext = "png" if "png" in (parsed.get("format") or "").lower() else "jpg"
        rel = f"data/processed/science/tiles/themis/{key}/z{z}_r{row}_c{col}.{ext}"
        dest = out_dir / f"z{z}_r{row}_c{col}.{ext}"
        try:
            data = http_get_bytes(url, timeout=30)
            dest.write_bytes(data)
            cached.append(
                {
                    "z": z,
                    "row": row,
                    "col": col,
                    "bytes": len(data),
                    "relpath": rel,
                    "source_url": url,
                }
            )
        except Exception as exc:
            cached.append(
                {
                    "z": z,
                    "row": row,
                    "col": col,
                    "error": str(exc),
                    "source_url": url,
                }
            )
    return cached


def _process_layer(key: str, name: str, caps_url: str, raw_dir: Path, tile_dir: Path) -> dict[str, Any]:
    xml_bytes = http_get_bytes(caps_url, timeout=45)
    raw_dir.mkdir(parents=True, exist_ok=True)
    (raw_dir / f"themis_{key}_WMTSCapabilities.xml").write_bytes(xml_bytes)

    parsed = _parse_capabilities(xml_bytes)
    cached_tiles = _cache_sample_tiles(key, parsed, tile_dir)
    return {
        "name": name,
        "capabilities_url": caps_url,
        "approx_resolution_m": 100,
        "identifier": parsed["identifier"],
        "title": parsed["title"],
        "style": parsed["style"],
        "tile_matrix_set": parsed["tile_matrix_set"],
        "format": parsed["format"],
        "tile_url_template": parsed["tile_url_template"],
        "zoom_levels": parsed["zoom_levels"],
        "wgs84_bbox": parsed["wgs84_bbox"],
        "cached_gale_sample_tiles": cached_tiles,
    }


def build_layers_themis() -> dict[str, Any]:
    """Fetch THEMIS Day/Night IR WMTS capabilities and write layers-themis.json."""
    raw_dir = DATA_RAW / "trek"
    tile_dir = DATA_SCIENCE / "tiles" / "themis"

    day_meta = _process_layer("day", "THEMIS Day IR", THEMIS_DAY_CAPS, raw_dir, tile_dir)
    night_meta = _process_layer("night", "THEMIS Night IR", THEMIS_NIGHT_CAPS, raw_dir, tile_dir)

    payload = {
        "contract": "martian-mappers.layer-themis.v1",
        "status": "cached",
        "fetched_at": utc_now_iso(),
        "note": (
            "Parsed from Mars Trek WMTSCapabilities.xml with sample Gale crater tiles cached locally "
            "for offline demo fallback."
        ),
        "kind": "thermal",
        "mission": "Odyssey THEMIS",
        "day": day_meta,
        "night": night_meta,
        "cached_tiles_relpath": "data/processed/science/tiles/themis/",
        "legend_note": "Relative day/night infrared brightness. Do not over-claim surface mineralogy from THEMIS alone.",
    }
    write_json(DATA_SCIENCE / "layers-themis.json", payload)
    return payload


if __name__ == "__main__":
    out = build_layers_themis()
    day_ok = sum(1 for t in out["day"]["cached_gale_sample_tiles"] if "relpath" in t)
    night_ok = sum(1 for t in out["night"]["cached_gale_sample_tiles"] if "relpath" in t)
    print(f"layers-themis.json written: day_tiles={day_ok}, night_tiles={night_ok}")
