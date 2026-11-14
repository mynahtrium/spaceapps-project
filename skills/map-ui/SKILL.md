---
name: map-ui
description: Build the static MapLibre planner map on Mars Trek tiles and send the chosen route to the 3D helmet HUD. Use when working on the 2D planner, layers, or the planner-to-HUD bridge.
---

# Map UI (2D planner)

Do **not** write application code in `web/` before 14 November 2026. This skill is instructions only.

The 12 November 2026 team decision: this MapLibre planner is how the crew **picks and inspects** a route. The main immersive display is the 3D first-person HUD (`skills/hud-3d`). The planner **sends the route** to that view (`mm:set-route` or `web/shared/` helper). Format is a web app; WebXR is stretch only and lives in the 3D view, not here.

Contracts: [docs/contracts/README.md](../../docs/contracts/README.md). Timing: [ROADMAP.md](../../ROADMAP.md).

## Base layers

Pull CTX, THEMIS (day/night), and MOLA shaded relief from [Mars Trek WMTS](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars). Capabilities URLs are listed in [AGENTS.md](../../AGENTS.md) and `skills/data-fetching/SKILL.md`.

Pre-download and **cache the tiles needed for the demo bbox** so the map works offline. Size target: under ~100 MB of static files for the whole demo (planner + HUD + caches). If Trek is unreachable, show Backend 1's slope / ortho preview as the base map.

## Local layers (from the pipeline, after 14 November)

- HiRISE 25 cm orthophoto tiles (`gdal2tiles`) or a cropped preview
- Slope / hazard overlay with a legend (green ≤ 10°, amber 10–15°, red 15–20°, blocked > 20°)
- Route GeoJSON and locked science stops (lake-sediment / mudstone stops plus a boxwork bonus; habitat start)
- Curiosity traverse (optional comparison, stretch / paired rover)
- THEMIS (SHOULD) and CRISM (if Backend 3 delivers it)

## Planner behaviour (MUST)

- Show stops and the current route from `data/processed/routing/` with fallback to `docs/contracts/`.
- A clear control (for example "Start EVA") fires `mm:set-route` with the `route` object and `along_m = 0`.
- Do not require a live routing API. If `POST /api/route` exists, use it only to replace the line, and fall back to the last static `route.json` on failure.

## Other panels (SHOULD, hours 16–32)

- Elevation / slope profile along the route
- Rover point-of-view still for the selected stop
- Dose / time card and space-weather banner (also on the HUD)
- REMS weather / cooler EVA window note
- Plain-language legend and a source list with fetch dates
- Optional toggle for the stricter 15° slope limit vs 20°

## Coordinate and honesty rules

- Mars web maps use Mars lat/lon on the same tile scheme as Earth. GeoJSON is **lon, lat**. Distances must use a Mars radius (3,389.5 km mean, or 3,396.19 km equatorial in the DTM labels). [ATS Mars Atlas notes](https://labs.allthingsspatial.io/about/mars-atlas/).
- Label slope limits as **illustrative lunar stand-ins**. Note that DTM slope matches rover-reported tilt only weakly (~5 m medians 9.0° vs 8.6°); keep a safety margin.
- Do not draw a fake spatial "radiation map" of rocks. Walking time is a placeholder if it uses an Earth hiking formula.
- No photos, video, voices, or likenesses of under-18s in the demo or any screen recording.

## MVP (MUST at hour 16) vs later

MUST: planner shows the route and sends it to a working 3D HUD (distance, slope, next stop, placeholder O₂). SHOULD adds dose, DONKI, POV, weather/thermal. Stretch (after hour 32, off the planner's critical path): paired rover path, sliders. Nothing new after hour 40.
