---
name: hud-3d
description: Build the first-person Mount Sharp terrain view and helmet HUD (three.js heightmap by default; WebXR stretch only). Use when working on the 3D visor, camera path, or HUD readouts.
---

# 3D terrain view and helmet HUD

Do **not** write application code in `web/` before 14 November 2026. This skill is instructions only.

The 12 November 2026 team decision: the main experience is a **3D first-person terrain view** with a **helmet HUD**, fed by the 2D MapLibre planner (`skills/map-ui`). VR / **WebXR is stretch only** (hours 32–40) and must not break the default web view. Details and timing: [ROADMAP.md](../../ROADMAP.md).

## Engine

- Default: [three.js](https://threejs.org/) heightmap (a plane or `PlaneGeometry` displaced by Backend 1's small height preview, or a low-resolution mesh). This is the safer path for a team new to 3D.
- [CesiumJS](https://cesium.com/) only if Frontend 1 already knows it. Do not learn Cesium during hours 0–16.
- Keep the demo crop small (about 2 km × 2 km). If the frame rate drops, reduce resolution, shorten far-clip, or walk a textured ribbon along the route.
- Last-resort fallback (see the roadmap risk table): a scripted camera path over stills, still driven by `route.json`, with the same HUD overlay.

## HUD (MUST by hour 16)

Always-visible visor readouts:

- **Distance** — travelled, remaining, and/or distance to the next stop (metres, Mars radius for any computed length)
- **Slope** — degrees and colour class (green / amber / red / blocked)
- **Next stop** — name and kind (lake-sediment vs boxwork bonus vs habitat)
- **Suit O₂** — percent, **labelled as an illustrative linear placeholder**, not a validated Mars suit model (`suit_o2_remaining_percent` in [docs/contracts/hud-telemetry.json](../../docs/contracts/hud-telemetry.json))

SHOULD (hours 16–32): dose card and DONKI banner, rover POV when the crew is at a stop.

## Receiving the route

The planner fires `mm:set-route` (or a shared helper in `web/shared/`) with a [route](../../docs/contracts/route.json) object and `along_m`. The 3D view places the camera at that distance along the LineString (GeoJSON coordinates are **lon, lat**), orients heading along the path, and samples slope from the route profile or telemetry file. The HUD must work if this event is fired **once** with the static route file.

Load `data/processed/routing/` and `data/processed/terrain/` first; fall back to `docs/contracts/` so a missing pipeline does not crash the visor.

## Honesty and safety

- Frame: "if a crew visited where Curiosity studied Mount Sharp." Gale is not a human landing site.
- Slope limits are lunar stand-ins. DTM slope matches rover tilt only weakly (~5 m medians 9.0° vs 8.6°); keep a safety margin.
- Do not draw a fake spatial radiation map.
- No photos, voices, or likenesses of under-18s in any capture, including WebXR recordings.

## Stretch (hours 32–40 only)

WebXR headset mode using the same scene and HUD. If `navigator.xr` is missing, hide the button. Paired rover mode is a Backend 2 path overlay, not a second engine. **Nothing new after hour 40.**
