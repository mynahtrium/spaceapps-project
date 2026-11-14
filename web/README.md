# Web App (`web/`) — Divarci (UI Designer / Frontend 1)

Unified first-person **astronaut visor HUD** for the **Martian Mappers** Gale Crater / Mount Sharp Marswalk Planner (`frontend/planner-hud`):

- **First-Person 3D Terrain & AR Markers (`web/hud/hud3d.js`)**: Three.js terrain decoded from Backend 1's 8-bit RGB `height-preview.png` (`R*256 + G`), textured with HiRISE ortho or slope preview, with AR route tube + waypoints and floating AR stop beacons/labels directly over the terrain mesh. Includes `▶ Walk EVA`, speed (`1x`/`2x`/`5x`), scrubber, mouse-drag free look, WASD free-roam toggle, and the four MUST visor readouts (distance, slope + class, next stop, placeholder suit O₂).
- **Visor Tactical Map & Science Drawer (`web/planner/planner.js`)**: MapLibre GL JS mounted directly on the helmet visor with a live pulsing astronaut marker, Expand/Hide toggles, Mars Trek CTX/THEMIS (disabled in `?demo=1`), local slope hazard + 15°/20° strict toggle, CRISM footprints, clickable elevation profile (`mm:set-route`), DONKI space weather banner, RAD dose card, REMS weather, and Curiosity POV lightbox with honest `"no NASA value"` empty states.
- **Shared Bridge (`web/shared/`)**: `data-loader.js` (`data/processed/` → `docs/contracts/` fallback, or `?demo=1` → `data/demo/` only) and `route-bridge.js` (`mm:set-route` + Mars radius `3,389.5 km` helpers).

## How to run

From the **repository root**:

```bash
python -m http.server 8000
```

- Normal mode: `http://localhost:8000/web/`
- Demo-safe mode (offline `data/demo/` fixtures only, no external tile/NASA calls): `http://localhost:8000/web/?demo=1`
