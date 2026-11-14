"""Query PDS ODE REST for CRISM MTRDR coverage over Gale / Mount Sharp (SHOULD-04).

Matches the martian-mappers.layer-crism.v1 contract in docs/contracts/layers-crism.json.
If ODE is unreachable or returns no products, writes an honest empty/unavailable state.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

from .common import DATA_RAW, DATA_SCIENCE, http_get_json, utc_now_iso, write_json

ODE_REST_URL = "https://oderest.rsl.wustl.edu/live2/"

# Covers DTEEC_001488 + DTEEC_019698 Gale / Mount Sharp footprints
GALE_BBOX = {
    "minlat": -5.04,
    "maxlat": -4.72,
    "westernlon": 137.24,
    "easternlon": 137.44,
}


def build_crism_index() -> dict[str, Any]:
    """Query ODE REST for CRISM MTRDR products overlapping the Gale / Mount Sharp site."""
    params = {
        "query": "product",
        "results": "m",
        "output": "JSON",
        "target": "mars",
        "ihid": "MRO",
        "iid": "CRISM",
        "pt": "MTRDR",
        **GALE_BBOX,
    }
    query_url = f"{ODE_REST_URL}?{urlencode(params)}"

    products: list[dict[str, Any]] = []
    status = "cached"
    note = "CRISM MTRDR product metadata queried from PDS Geosciences ODE REST."

    try:
        raw = http_get_json(query_url, timeout=45)
        write_json(DATA_RAW / "crism" / "ode_crism_mtrdr_gale.json", raw)

        outer = raw.get("ODEResults") or {}
        prod_block = outer.get("Products") or {}
        raw_products = prod_block.get("Product") or []
        if isinstance(raw_products, dict):
            raw_products = [raw_products]

        for p in raw_products:
            product_name = p.get("Product_name") or ""
            products.append(
                {
                    "pdsid": p.get("pdsid") or product_name.rsplit(".", 1)[0] or None,
                    "product_name": product_name or None,
                    "product_type": p.get("pt") or "MTRDR",
                    "observation_type": p.get("Observation_type"),
                    "observation_time": p.get("Observation_time"),
                    "map_scale_m": p.get("Map_scale"),
                    "comment": p.get("Comment"),
                    "center_lat": p.get("Center_latitude"),
                    "center_lon": p.get("Center_longitude"),
                    "product_url": p.get("ProductURL") or p.get("External_url"),
                    "files_url": p.get("FilesURL"),
                    "label_url": p.get("LabelURL"),
                }
            )
        if not products:
            status = "empty"
            note = "ODE REST responded 200 but returned 0 MTRDR products for the bbox."
    except Exception as exc:
        status = "unavailable"
        note = f"ODE REST query failed ({exc}); CRISM overlay skipped for now."

    payload = {
        "contract": "martian-mappers.layer-crism.v1",
        "status": status,
        "fetched_at": utc_now_iso(),
        "note": note,
        "kind": "spectral",
        "mission": "MRO CRISM",
        "ode_rest": "https://oderest.rsl.wustl.edu/",
        "pds_geosciences": "https://pds-geosciences.wustl.edu/missions/mro/crism.htm",
        "query_bbox": GALE_BBOX,
        "product_count": len(products),
        "products": products,
        "overlay_relpath": "data/processed/science/tiles/crism/",
        "legend_note": "Show only mapped browse bands you can cite. Do not invent mineral detections.",
    }
    write_json(DATA_SCIENCE / "layers-crism.json", payload)
    return payload


if __name__ == "__main__":
    out = build_crism_index()
    print(f"layers-crism.json written: status={out['status']}, products={out['product_count']}")
