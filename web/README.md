# Web App (`web/`) — Frontend 1

Static single-page web app for the **Martian Mappers** Gale Crater / Mount Sharp Marswalk:

- **3D Helmet HUD (`web/hud/hud3d.js`)**: Three.js first-person terrain decoded from `height-preview.png` (`R*256 + G`), textured with HiRISE ortho or slope preview, with auto-walk playback, scrubber, mouse-drag look, WASD free-roam toggle, and MUST visor readouts (distance, slope + class, next stop, placeholder suit O₂).
- **Orbit View (`web/orbit/orbit-view.js`)**: three.js Mars globe (bundled Viking MDIM 2.1 colour / MOLA relief, `web/assets/mars-globe/`, rebuilt by `pipeline/globe/fetch_globe_texture.py`), real day/night terminator (Mars24 subsolar point), Phobos & Deimos from a JPL Horizons-fitted series, real Sun/Earth/bright-star directions, time warp, and click-to-land anywhere with a stepped zoom-in into the Bodycam (HiRISE at Gale, procedural relief elsewhere; real local solar time or fixed daylight). Keys in Bodycam: `O` orbit.
- **Shared Bridge (`web/shared/`)**: `data-loader.js` (`data/processed/` -> `docs/contracts/` fallback, or `?demo=1` -> `data/demo/` only) and `route-bridge.js` (`mm:set-route` + Mars radius `3,389.5 km` helpers).

## How to run

From the **repository root**:

```bash
python -m http.server 8000
```

- Normal mode: `http://localhost:8000/web/`
- Demo-safe mode (offline fixtures only, no Trek/external calls): `http://localhost:8000/web/?demo=1`
