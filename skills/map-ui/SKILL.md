---
name: map-ui
description: Build the static MapLibre or Leaflet Marswalk map on Mars Trek tiles, with hazard, route, rover POV, dose, and DONKI panels. Use when working on the web UI.
---

# Map UI

Do **not** write application code in `web/` before 14 November 2026. This skill is instructions only.

The product is a **static** [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) or [Leaflet](https://leafletjs.com/reference.html) web map. No application server. Suggested format: a tablet-style web app first; a helmet-HUD visor view is a stretch.

## Base layers

Pull CTX, THEMIS (day/night), and MOLA shaded relief from [Mars Trek WMTS](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars). Capabilities URLs are listed in [AGENTS.md](../../AGENTS.md) and `skills/data-fetching/SKILL.md`.

Pre-download and **cache the tiles needed for the demo bbox** so the map works offline. Size target: under ~100 MB of static files for the whole demo.

## Local layers (from the pipeline, after 14 November)

- HiRISE 25 cm orthophoto tiles (`gdal2tiles`)
- Slope / hazard overlay with a legend (green ≤ 10°, amber 10–15°, red 15–20°, blocked > 20°)
- Route GeoJSON and the three science stops
- Curiosity traverse (optional comparison)
- CRISM mineral overlay (should-have)

## Panels

- Elevation / slope profile along the route (Chart.js is the planned library)
- Rover point-of-view photo for the nearest Sol at each stop ([MSL raw image feed](https://mars.nasa.gov/rss/api/?feed=raw_images&category=msl&feedtype=json&num=2&page=0&order=sol+desc); cache images)
- Dose / time card: dose ≈ RAD baseline × placeholder EVA duration. Baseline: about **0.64 ± 0.12 mSv/day** ([Hassler et al., Science 2014](https://www.science.org/doi/10.1126/science.1244797)), plus real RAD tables for the relevant Sols
- Space-weather banner from cached DONKI WSA-Enlil runs that list Mars in `impactList`
- Plain-language legend and a source list with fetch dates
- Toggle for the stricter 15° slope limit vs 20°

## Coordinate and honesty rules

- Mars web maps use Mars lat/lon on the same tile scheme as Earth. Distances must use a Mars radius (3,389.5 km mean, or 3,396.19 km equatorial in the DTM labels). [ATS Mars Atlas notes](https://labs.allthingsspatial.io/about/mars-atlas/).
- Label slope limits as **illustrative lunar stand-ins**. Note that the 1 m DTM under-reads rover-reported tilt.
- Do not draw a fake spatial "radiation map" of rocks. Radiation is mostly a time and shielding problem.
- Walking time is a placeholder if it uses an Earth hiking formula.
- No photos, video, voices, or likenesses of under-18s in the demo or any screen recording.

## Stretch (only after the MVP works)

- Full-screen "visor" HUD CSS view with route arrow, slope readout, and a mini-map over a rover panorama
- [CesiumJS](https://cesium.com/) 3D — skip unless someone already knows it
- Predicted-conditions slider; paired-astronaut split route; sky-view factor overlay

## MVP checklist

Web map with at least 3 data types from 3+ missions; hazard map and a route that avoids it between 3 stops, with distance / climb / time; rover POV at each stop; dose estimate and space-weather banner; legend and sources.
