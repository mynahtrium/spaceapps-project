---
name: routing
description: Build a slope and hazard cost map and run A* or Dijkstra between Marswalk stops. Use when planning the boxwork route, profiles, or dose/time totals.
---

# Routing on a hazard cost map

Do **not** write routing code before 14 November 2026. This skill is instructions only.

Inputs: slope, roughness, and hazard rasters from `skills/dem-to-slope`. Output: a route GeoJSON, an elevation/slope profile, and totals (distance, climb, time, dose) for the web map (`skills/map-ui`).

## Stops (Concept A)

Landing / habitat point → **ridge top** → **ridge wall** → **hollow** → back. Science goal: why did groundwater harden some ridges? Curiosity describes ridges ~5 m wide and hollows 10–20 m across and 1–2 m deep. Pick stops on the 25 cm ortho, not only on the 1 m DTM.

## Cost map (suggestion; tune on real data)

```
cost = step_length × (1 + (slope / 10°)² + k_rough × roughness)
cost = ∞  if slope > limit, or the cell is no-data / an obstacle
```

Obstacles: no-data cells, slope above the selected limit (20°, or 15° if the strict toggle is on), plus ridge walls and boulder fields taken from the 25 cm orthophoto (simple texture / edges, or a few hand-drawn polygons for the demo). Automatic boulder detection is a stretch.

## Search

8-neighbour **Dijkstra / A\*** on the grid. Python's [`skimage.graph.route_through_array`](https://scikit-image.org/docs/stable/api/skimage.graph.html) does this in a few lines. After 14 November, a minimal call looks like:

```python
# Illustrative only — do not add this module before 14 November 2026.
# from skimage.graph import route_through_array
# indices, weight = route_through_array(cost, start, end, fully_connected=True)
```

Export the path as GeoJSON (Mars lat/lon, same tile scheme as the web map).

## Distances, time, and dose

- Use a Mars radius (3,389.5 km mean, or 3,396.19 km equatorial from the DTM labels). Earth-radius lengths will be wrong. See [ATS Mars Atlas notes](https://labs.allthingsspatial.io/about/mars-atlas/).
- Walking-speed formulas (for example Tobler's hiking function) are **Earth hiking** assumptions. Label any duration as a placeholder.
- Slope limits and the 2 km walking-EVA radius are **lunar stand-ins** from the [Exploration EVA ConOps](https://www.nasa.gov/wp-content/uploads/2020/01/topic_1-_eva_lunar_surface_concept_of_operations.pdf) and [LPSC 2023 #1413](https://www.hou.usra.edu/meetings/lpsc2023/pdf/1413.pdf). Say so.
- Dose ≈ RAD baseline × EVA duration. Curiosity RAD measured about **0.64 ± 0.12 mSv/day** (dose equivalent, GCR) in its first ~300 sols at Gale (about −4.4 km MOLA). [Hassler et al., Science 2014](https://www.science.org/doi/10.1126/science.1244797). Also show the real RAD tables for the relevant Sols. Do **not** invent a spatial radiation map of rocks. Add a DONKI WSA-Enlil banner for predicted Mars arrivals (see `skills/data-fetching` and `skills/map-ui`).

## Outputs

- Route GeoJSON and stop points
- Profile: distance vs elevation vs slope
- Totals: distance, climb, placeholder time, dose estimate
- Optional: a comparison line against Curiosity's real traverse ([MSL traverse](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json))

Keep outputs small and in `data/processed/`. Never commit cost rasters as `*.tif` unless the team later decides a tiny preview belongs in-repo.
