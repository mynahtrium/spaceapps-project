---
name: data-fetching
description: Fetch and cache NASA Mars data layers (HiRISE, CTX, MOLA, THEMIS, CRISM, REMS/MEDA, RAD, DONKI, Mars Trek, PDS/ODE) for the Martian Mappers boxwork map. Use when downloading, locating, or documenting data sources.
---

# Data fetching

Do **not** start the project data pipeline or bulk downloads before 14 November 2026. Reading this skill, listing URLs, and installing tools are fine.

Follow the data-layer table and practical notes in [AGENTS.md](../../AGENTS.md). Links below were checked on 11 November 2026. Re-check the official [Resources tab](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/) on 13 November (**UNVERIFIED** until then).

The 12 November 2026 decision keeps the **Gale / Mount Sharp** site and the same DTM / rover data. The science goal is **ancient lake sediments and habitability / organics in mudstones**, with boxwork as a **bonus stop**. Crop around the **locked** stops (chosen on paper / HiView before or at hour 0), not around invented coordinates. Role sheets: Backend 1 uses this skill for DTM/ortho; Backend 3 uses it for REMS, RAD, DONKI, THEMIS, CRISM, and POV.

## Rules

- Store originals in `data/raw/` (gitignored). Never commit raw rasters, PDS `.IMG`, JP2, or `.env`.
- Write only small derived products to `data/processed/`.
- The NASA API key is only `NASA_API_KEY` in the environment. Do not use NASA's shared demo key (it is rate-limited). Cache DONKI JSON for the demo.
- Cite source, product ID, and fetch date. Do not invent coverage. Mark gaps **UNVERIFIED**.
- Distances must use a Mars radius (3,389.5 km mean, or 3,396.19 km equatorial in the DTM labels).

## What to get for Concept A (Gale / Mount Sharp boxwork)

1. **Locate HiRISE DTMs** with the [cumulative DTM index](https://hirise-pds.lpl.arizona.edu/PDS/INDEX/DTMCUMINDEX.TAB). In the Gale box (4.4–5.9°S, 137.0–138.2°E) the products of interest are 001488, 009149 and 019698. Primary files:
   - [DTEEC_019698](https://hirise-pds.lpl.arizona.edu/PDS/DTM/ESP/ORB_019600_019699/ESP_019698_1750_ESP_019988_1750/DTEEC_019698_1750_019988_1750_U01.IMG) (covers the traverse)
   - [DTEEC_001488](https://hirise-pds.lpl.arizona.edu/PDS/DTM/PSP/ORB_001400_001499/PSP_001488_1750_PSP_001752_1750/DTEEC_001488_1750_001752_1750_U02.IMG) (west of the traverse)
   - Matching 25 cm orthos from the same [PDS DTM folders](https://hirise-pds.lpl.arizona.edu/PDS/DTM/). Confirm in [HiView](https://www.uahirise.org/hiview/) that the boxwork is inside the footprint before committing to the site.
2. **CRISM / CTX via ODE:** [ODE REST](https://oderest.rsl.wustl.edu/) and [ODE Mars](https://ode.rsl.wustl.edu/mars/). Query product type `MTRDR` by bounding box. 8 CRISM MTRDR products overlap the 001488 footprint; CTX has 174 observations over the same footprint. See also [CRISM at PDS Geosciences](https://pds-geosciences.wustl.edu/missions/mro/crism.htm).
3. **Rover ground truth:** [MSL waypoints](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json) (through Sol 5070) and [MSL traverse](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json). These are undocumented feeds behind [Mars Maps](https://mars.nasa.gov/maps/) and may change. Use `tilt` to check the slope model.
4. **Weather and radiation:** [REMS archive](https://atmos.nmsu.edu/PDS/data/mslrem_1001/DATA/) and [RAD RDR](https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/DATA/) (both through Sol 4843 as of the check, covering boxwork Sols 4534–4700).
5. **Rover POV images:** [MSL raw image feed](https://mars.nasa.gov/rss/api/?feed=raw_images&category=msl&feedtype=json&num=2&page=0&order=sol+desc). Sol filters need URL-encoded parameters such as `condition_2=4600:sol:gte`. Do **not** use `api.nasa.gov/mars-photos` (404 for both rovers on 11 November 2026).
6. **DONKI:** [api.nasa.gov](https://api.nasa.gov/) DONKI section. Use **WSAEnlilSimulations** and look for `"Mars"` in each run's `impactList`. CME, SEP and GST endpoints worked; FLR returned 404. Cache the JSON.
7. **Base-map tiles (do not bake the world; cache the demo bbox):** [Mars Trek](https://trek.nasa.gov/mars/) / [WMTS docs](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars) — CTX, THEMIS day/night, MOLA shaded relief. Capabilities:
   - [CTX](https://trek.nasa.gov/tiles/Mars/EQ/CTX_beta01_uncontrolled_5m_Caltech/1.0.0/WMTSCapabilities.xml)
   - [MOLA ClrShade](https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/WMTSCapabilities.xml)
   - [THEMIS Day IR](https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml)
   - [THEMIS Night IR](https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml)

Crop early to ~2 km × 2 km around the walk. The HRSC–MOLA 200 m DEM is 11.4 GB — use windowed GDAL reads from the [USGS Astropedia page](https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m) only if needed.

## Illustrative commands (after 14 November)

HTTP range requests work on HiRISE DTM `.IMG` files (tested, 206). GDAL has a [PDS driver](https://gdal.org/en/stable/drivers/raster/pds.html). Test JP2 orthos early; they need OpenJPEG.

```bash
# Example: inspect a PDS DTM after it is downloaded into data/raw/
gdalinfo data/raw/DTEEC_019698_1750_019988_1750_U01.IMG
```

If a windowed read of the large HRSC–MOLA GeoTIFF is needed, use `gdal_translate` / `gdalwarp` with the extent and spatial reference from that product's own label or the USGS page — do not guess an EPSG code.

## Unavailable or unverified as of 11 November 2026

- NASA Ames Mars climate reference runs (`data.nas.nasa.gov` TLS / server errors). Treat as unavailable until checked on 13 November.
- PDS Imaging Atlas API docs (403).
- Official Resources tab (opens 13 November).
- A Zenodo "MSL/RAD dose rates" product (403).
- USGS Planetary Geologic Mapping Program page (403). [SIM 3292](https://pubs.usgs.gov/sim/3292/) itself returned 200.

Backup site (Concept B, Jezero): [DTEEC_002387](https://hirise-pds.lpl.arizona.edu/PDS/DTM/PSP/ORB_002300_002399/PSP_002387_1985_PSP_003798_1985/DTEEC_002387_1985_003798_1985_A01.IMG), [MEDA](https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/), [M20 waypoints](https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json). Perseverance has no RAD-type detector.
