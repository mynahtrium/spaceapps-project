---
name: dem-to-slope
description: Turn a HiRISE (or other) Mars DTM into slope, roughness, and hazard rasters with GDAL. Use when building the cost-map inputs for routing.
---

# DEM to slope and hazard rasters

Do **not** write pipeline code or process project DTMs before 14 November 2026. This skill is instructions only.

See the design in [AGENTS.md](../../AGENTS.md) and [ROADMAP.md](../../ROADMAP.md). Role: [docs/roles/backend-1-terrain.md](../../docs/roles/backend-1-terrain.md). Inputs come from `skills/data-fetching`. Outputs (`data/processed/terrain/`, contract [cost-map.json](../../docs/contracts/cost-map.json)) feed `skills/routing` and the 3D HUD height preview (`skills/hud-3d`).

## Goals

From a HiRISE 1 m DTM (PDS `.IMG`), produce small derived rasters in `data/processed/`:

- Slope (degrees)
- Roughness or TRI
- A binary or classified hazard mask (no-data and slope above the limit are blocked)

Crop to ~2 km × 2 km around the planned walk before heavy processing.

## Processing notes (from the 11 November 2026 planning check)

1. **Resample to 2–5 m cells** (average blocks). The 1 m terrain model has stereo noise; averaging to 5 m changed the share of steep pixels from 32% to 26% (>20°) in a 1 km × 7.4 km test strip of DTEEC_019698 (about 4.79–4.81°S). Those figures are indicative, not a validated product.
2. **Slope** with `gdaldem slope` ([documentation](https://gdal.org/en/stable/programs/gdaldem.html)). **Roughness / TRI** with `gdaldem roughness` or `TRI`.
3. The 1 m DTM **under-reads local slope** versus Curiosity's reported tilts (4–10° under the rover vs 9–17° at four boxwork Sols — a steady offset, so relative slopes are usable). Add a safety margin and say so in the demo. Check against waypoint `tilt` in [MSL waypoints](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json).
4. About a quarter of the sampled DTM strip had no-data pixels. Treat no-data as blocked. Report statistics on valid pixels only.
5. The 1 m DTM barely resolves 5 m ridges. Use the 25 cm orthophoto to see ridge walls and boulders (simple texture / edge density, or hand-drawn polygons for the demo).
6. Use a Mars radius / the DTM's stated pixel size when computing slope. GDAL's [PDS driver](https://gdal.org/en/stable/drivers/raster/pds.html) should read the label; verify scale. Equatorial radius in the DTM labels: 3,396.19 km. Mean radius commonly used for distances: 3,389.5 km.

## Slope-limit colours (illustrative lunar stand-ins)

No Mars-specific slope limit was found. NASA's [Exploration EVA Concept of Operations](https://www.nasa.gov/wp-content/uploads/2020/01/topic_1-_eva_lunar_surface_concept_of_operations.pdf) cites up to 20° and traverses up to 2 km from the lander. [LPSC 2023 abstract 1413](https://www.hou.usra.edu/meetings/lpsc2023/pdf/1413.pdf) used a penalised 15° per-pixel threshold on a 5 m raster. **Label these as lunar stand-ins.**

Suggested classes: green ≤ 10°, amber 10–15°, red 15–20°, blocked > 20°, with a toggle for the stricter 15° limit.

## Illustrative commands (after 14 November)

```bash
# After the DTM is in data/raw/ and cropped as needed:
# 1) average-resample to 5 m (pixel size must match the DTM's CRS units)
gdalwarp -tr 5 5 -r average data/processed/dtm_crop.tif data/processed/dtm_5m.tif

# 2) slope in degrees
gdaldem slope -p data/processed/dtm_5m.tif data/processed/slope_deg.tif

# 3) roughness
gdaldem roughness data/processed/dtm_5m.tif data/processed/roughness.tif

# 4) optional preview PNG for the web map
gdaldem color-relief data/processed/slope_deg.tif docs/slope-colors.txt data/processed/slope_preview.png
```

Tune `-tr` from the product label, not from this snippet. Do not commit `*.tif` or raw `.IMG` files. Keep only small PNG tiles / previews if they are needed in-repo; prefer generating them at build time after 14 November.

## Honesty

State in the UI: stereo noise was reduced by resampling; the DTM under-reads rover tilt; no-data gaps are treated as blocked; slope limits are illustrative.
