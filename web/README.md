# Web App (`web/`) — Frontend 1

Static single-page web app for the **Martian Mappers** Gale Crater / Mount Sharp Marswalk Planner:

- **2D Planner (`web/planner/planner.js`)**: MapLibre GL JS with Mars Trek CTX/THEMIS base layers (skipped in `?demo=1`), local HiRISE ortho & slope previews, 15°/20° strict hazard toggle, CRISM footprints, elevation/slope profile, Curiosity POV lightbox, DONKI space weather banner, REMS weather, and RAD dose card.
- **3D Helmet HUD (`web/hud/hud3d.js`)**: Three.js first-person terrain decoded from `height-preview.png` (`R*256 + G`), textured with HiRISE ortho or slope preview, with auto-walk playback, scrubber, mouse-drag look, WASD free-roam toggle, and MUST visor readouts (distance, slope + class, next stop, placeholder suit O₂).
- **Shared Bridge (`web/shared/`)**: `data-loader.js` (`data/processed/` -> `docs/contracts/` fallback, or `?demo=1` -> `data/demo/` only) and `route-bridge.js` (`mm:set-route` + Mars radius `3,389.5 km` helpers).

## How to run

From the **repository root**:

```bash
python -m http.server 8000
```

- Normal mode: `http://localhost:8000/web/`
- Demo-safe mode (offline fixtures only, no Trek/external calls): `http://localhost:8000/web/?demo=1`
