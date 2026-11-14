# Data sources actually used (Backend 1, terrain)

Fetched on **14 November 2026** over HTTPS with certificate checks on. Raw copies stay in `data/raw/` (gitignored). Everything under `data/processed/terrain/` is **our own calculation** from these inputs, not a NASA product.

| Input | What it is | Source |
|---|---|---|
| DTEEC_019698_1750_019988_1750_U01 | HiRISE 1 m digital terrain model (MRO), Gale crater / Mount Sharp | [PDS HiRISE DTM folder](https://hirise-pds.lpl.arizona.edu/PDS/DTM/ESP/ORB_019600_019699/ESP_019698_1750_ESP_019988_1750/) |
| ESP_019698_1750_RED_A_01_ORTHO | HiRISE 25 cm orthoimage (read at about 2 m per pixel for the preview) | same folder |
| MSL_waypoints.json | Curiosity waypoints (Sol, lat, lon, tilt, ...) behind NASA's Mars Maps viewer; not a documented API and may change | [mars.nasa.gov MMGIS](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json) |

Derived: `slope-preview.png`, `slope_stats.json`, `cost-map.json`, `height-preview.png`, `ortho-preview.png`, `tilt-check.json` (scripts in `pipeline/terrain/`).

Honesty notes: slope limits (10/15/20 deg) are lunar stand-ins; the crop centre is a placeholder until the stops are locked (PRE-07); the DTM-vs-tilt comparison is weak (medians 9.0 vs 8.6 deg at 5 m, r about 0.15).
