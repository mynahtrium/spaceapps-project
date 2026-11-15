"""Fetch Mars Trek THEMIS WMTS capabilities, cache sample Gale tiles, and write layers-themis.json.

Matches the martian-mappers.layer-themis.v1 contract in docs/contracts/layers-themis.json.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from lxml import etree
from owslib.wmts import WebMapTileService

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
_WMTS_NS = {"wmts": "http://www.opengis.net/wmts/1.0"}


def _normalize_wmts_xml(xml_bytes: bytes) -> bytes:
    """Coerce Mars Trek float MatrixWidth/MatrixHeight ('2.0') to integer strings for OWSLib."""
    root = etree.fromstring(xml_bytes)
    for tag in ("wmts:MatrixWidth", "wmts:MatrixHeight"):
        for elem in root.findall(f".//{tag}", _WMTS_NS):
            if elem.text and "." in elem.text:
                elem.text = str(int(float(elem.text.strip())))
    return etree.tostring(root)


def _parse_capabilities(xml_bytes: bytes, caps_url: str = THEMIS_DAY_CAPS) -> dict[str, Any]:
    wmts = WebMapTileService(caps_url, xml=_normalize_wmts_xml(xml_bytes))
    if not wmts.contents:
        raise RuntimeError("No <Layer> found in WMTSCapabilities.xml")

    layer = next(iter(wmts.contents.values()))
    identifier = layer.id
    title = layer.title or identifier
    style_id = (
        next((sid for sid, meta in (layer.styles or {}).items() if meta.get("isDefault")), None)
        or next(iter(layer.styles or ()), "default")
    )
    tms_id = next(iter(layer.tilematrixsetlinks or ()), "default028mm")

    tile_res = next((r for r in (layer.resourceURLs or []) if r.get("resourceType") == "tile"), None)
    template = tile_res.get("template") if tile_res else None
    img_format = (
        (tile_res.get("format") if tile_res else None)
        or next(iter(layer.formats or ()), "image/png")
    )

    bbox = getattr(layer, "boundingBoxWGS84", None)
    lower = f"{bbox[0]} {bbox[1]}" if bbox and len(bbox) == 4 else None
    upper = f"{bbox[2]} {bbox[3]}" if bbox and len(bbox) == 4 else None

    matrices: list[dict[str, Any]] = []
    tms = (wmts.tilematrixsets or {}).get(tms_id)
    if tms is not None:
        for tm in tms.tilematrix.values():
            tl = tm.topleftcorner or (-180.0, 90.0)
            matrices.append(
                {
                    "id": tm.identifier,
                    "matrix_width": int(tm.matrixwidth),
                    "matrix_height": int(tm.matrixheight),
                    "top_left_lon": float(tl[0]),
                    "top_left_lat": float(tl[1]),
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

    parsed = _parse_capabilities(xml_bytes, caps_url=caps_url)
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
