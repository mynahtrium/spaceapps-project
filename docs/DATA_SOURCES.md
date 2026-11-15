# Data sources actually used (Backend 1, terrain)

Fetched on **14 November 2026** over HTTPS with certificate checks on. Raw copies stay in `data/raw/` (gitignored). Everything under `data/processed/terrain/` is **our own calculation** from these inputs, not a NASA product.

| Input | What it is | Source |
|---|---|---|
| DTEEC_019698_1750_019988_1750_U01 | HiRISE 1 m digital terrain model (MRO), Gale crater / Mount Sharp | [PDS HiRISE DTM folder](https://hirise-pds.lpl.arizona.edu/PDS/DTM/ESP/ORB_019600_019699/ESP_019698_1750_ESP_019988_1750/) |
| ESP_019698_1750_RED_A_01_ORTHO | HiRISE 25 cm orthoimage (read at about 2 m per pixel for the preview) | same folder |
| MSL_waypoints.json | Curiosity waypoints (Sol, lat, lon, tilt, ...) behind NASA's Mars Maps viewer; not a documented API and may change | [mars.nasa.gov MMGIS](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json) |

Derived: `slope-preview.png`, `slope_stats.json`, `cost-map.json`, `height-preview.png`, `ortho-preview.png`, `tilt-check.json` (scripts in `pipeline/terrain/`).

Honesty notes: slope limits (10/15/20 deg) are lunar stand-ins; the crop centre is a placeholder until the stops are locked (PRE-07); the DTM-vs-tilt comparison is weak (medians 9.0 vs 8.6 deg at 5 m, r about 0.15).

## Whole-Mars globe and dust (visor map, added 14 November 2026)

These files came from the `demo-1` branch (Cinar D.); full source list in `data/demo/mars-global-sources.json`.

| File | What it is | Source |
|---|---|---|
| `data/demo/globe/mola-8ppd.png` | NASA MGS MOLA MEGDR global elevation (megt90n000eb, 16 px/deg averaged to 8), 2880 x 1440, height = R*256 + G - 32768; built by `pipeline/globe/build_mola_grid.py`, fetched 2026-11-15 | [PDS MOLA MEGDR](https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.lbl) |
| `data/demo/mars-viking-global.jpg` | Viking MDIM 2.1 colourised global mosaic, stitched from Mars Trek zoom-3 tiles | [Mars Trek WMTS](https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/WMTSCapabilities.xml) |
| `data/demo/mars-mola-shaded.jpg` | MOLA colour shaded relief, stitched from Mars Trek zoom-3 tiles | [Mars Trek WMTS](https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/WMTSCapabilities.xml) |

Honesty notes: the globe's relief is exaggerated x9 in radius and x7 in shading so craters read from orbit. The day/night line uses the Sun for 15:00 local time at Gale (the walk's fixed clock) and today's Mars season. Crater centres and sizes are approximate IAU Gazetteer values (about 1 degree). Wind-blown dust is a visual effect, not a weather model.
