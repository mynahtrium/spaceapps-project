# Codebase index

Generated from a scan of tracked files (620). Excludes `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules`. Vendored three.js / MapLibre / loaders in `web/vendor/` (about 60k lines) are not described.

## Top level

| Path | What it is |
|---|---|
| `web/` | Static browser app (ES modules, no bundler). Entry `web/index.html` → `web/app.js` |
| `scripts/` | `server.mjs` static server + multiplayer WebSocket upgrade; `mp-hub.mjs` room hub; `start-app.sh`, `start.bat` |
| `pipeline/` | Python data pipeline (DTM → slope → cost map → route; NASA science fetchers) |
| `data/processed/` | Pipeline outputs (route, stops, terrain, science JSON, THEMIS tiles, POV stills) |
| `data/demo/` | Frozen offline fixtures for `?demo=1` (incl. 336 corridor terrain chunks) |
| `docs/` | Data sources, decisions, AI-use log, demo script, test plans, JSON `contracts/` |
| `skills/` | Agent skill notes (routing, map-ui, hud-3d, dem-to-slope, data-fetching, ai-use-log) |
| `vercel.json` | Redirects `/` → `/web/` |

## web/ (browser app)

**Entry**: `index.html` (start screen, EVA HUD view, Orbit view, planner/map overlays), `app.js` (boot, themes, start menu, EN/TR language, wiring of HUD / orbit / multiplayer / route bridge), `styles.css`.

### `web/hud/` (first-person EVA, three.js)
- `hud3d.js`: main scene, camera as astronaut eyes, input, vehicle driving, ties every module below together.
- Walker and crew: `astronaut-rig.js`, `footsteps.js`, `npc-system.js`, `npc-knowledge.js`, `npc-dialogue-ui.js`.
- Vehicles: `experimental-rover.js` (drivable MMSEV), `rover-dynamics.js`, `rover-rig.js`, `rover-dash.js`, `historic-rovers.js` (Sojourner, Spirit, Opportunity, etc.), `mars-landers.js` (landers, Ingenuity, site markers).
- World: `terrain-surface.js` (HiRISE DEM bicubic surface), `GaleVista.js` (horizon), `MarsRockField.js`, `FieldKits.js`, `mars-habitat.js` + `habitat-textures.js`, `merge-static.js`.
- Sky and atmosphere: `MarsEphemeris.js`, `MarsCelestialSky.js`, `mars-fx.js`, `wind-dust.js`, `DustDevil.js`, `ray-tracer.js` (hybrid GPU ray tracing option).
- `landing-sequence.js`: entry, descent and landing cinematic.

### `web/map/` (terrain and map engine)
- Adapter layer: `IMapAdapter.js` (contract, rollback flag), `MapLibreMarsAdapter.js` (2D/2.5D), `LegacyMapAdapter.js` (`?legacyMap=1`), `Fallback2DMap.js` (canvas, no dependencies).
- Terrain pipeline: `HighResMarsTerrainEngine.js`, `TileSourceRegistry.js` (fallback cascade), `MarsDemSampler.js`, `TerrainMeshBuilder.js`, `terrain.worker.js` + `TerrainWorkerPool.js`, `MarsTerrainShader.js`, `MarsPbrTextures.js`, `GaleCorridor.js` (streamed corridor chunks).
- `Geodesy.js`: Mars projection, tile maths, RTC datum.

### `web/physics/`
`MarsConstants.js`, `MarsGravityField.js`, `MarsPhysicsWorld.js` (120 Hz walker), `VehicleDynamics.js`, `Terramechanics.js`, `SuitBiomechanics.js`, `MetabolicPlssModel.js`, `MarsAcoustics.js`.

### `web/shared/`
`data-loader.js` (loads `data/processed` → `data/demo` → `docs/contracts` fallback), `route-bridge.js` (`mm:set-route` events, polyline utils), `multiplayer.js` (client; WebSocket + fallback transport), `mars-rovers.js` and `mars-hardware.js` (catalogues), `audioEngine.js` (procedural Web Audio), `gamepad.js` + `gamepad-ui.js`, `context-menu.js`, `dev-settings.js`.

### Other
- `web/orbit/orbit-view.js`: Mars globe, landing-site picking.
- `web/planner/`: `planner.js` (map/route planner, THEMIS/CTX layers), `map-gamepad.js`.
- `web/assets/`: 4k globe textures, dust atlas, NASA GLBs (Perseverance, MMSEV, spacesuits).
- `web/vendor/`: three.module.js, GLTF/DRACO loaders, BufferGeometryUtils, MapLibre.
- `web/tests/` (Node test runner, `node --test web/tests/*.test.mjs`): context-menu, corridor, ephemeris, fallback, geodesy, multiplayer, npc-system, physics, route-bridge, rover-dynamics, vehicles.

## scripts/
- `server.mjs`: `createServerApp`, `startServer` (port 8000, host 0.0.0.0), MIME map, LAN IP listing, mounts multiplayer hub.
- `mp-hub.mjs`: hand-rolled WebSocket framing, `createMultiplayerHub` (rooms ≤16 peers, ≤24 pins).

## pipeline/ (Python)
- `terrain/`: `fetch_dtm.py`, `crop_window.py`, `crop_ortho.py`, `make_slope.py`, `make_relief.py`, `build_corridor.py` (streamed chunks), `tilt_check.py`.
- `costmap/`: `make_cost_map.py`, `make_corridor_cost_map.py`, `crop_window.py` (re-export).
- `routing/`: `dijkstra_grid.py`, `build_route.py` (stops → route.json + telemetry), `mars_geo.py`.
- `stops/write_stops.py`.
- `data/` (stdlib only): fetchers (`fetch_donki`, `fetch_pds_indexes`, `fetch_pov_index`, `fetch_waypoints`), builders (`build_alerts`, `build_dose`, `build_layers_themis`, `build_crism_index`, `build_pov`, `build_weather`), runners (`run_must07`, `run_phase2`, `run_phase3`, `run_examples`), `export_demo_fixtures.py`, `common.py`, `example_fixtures.py`.
- `globe/fetch_globe_texture.py`.

## data/
- `processed/routing`: `route.json`, `stops.json`, `hud-telemetry.json`.
- `processed/terrain`: `cost-map.json`, `relief.*`, `hillshade.png`, slope/height/ortho previews, textures, `slope_stats.json`.
- `processed/science`: alerts, dose, DONKI cache, weather, THEMIS/CRISM layers, PDS index, MSL caches, `pov/` stills, `tiles/themis/`.
- `demo/`: same shapes for offline mode, plus `corridor/` (3 files + 336 chunks) and `pov/`, `tiles/`.

## docs/
`DATA_SOURCES.md`, `DECISIONS.md`, `AI_USE.md`, `AI_USE_LOG.md`, `JUDGING_CHECKLIST.md`, `GITHUB_WORKFLOW.md`, `RESOURCES_UNOFFICIAL.md`; `contracts/` (versioned JSON shapes: route, stops, cost-map, corridor, alerts, dose, weather, layers, pov, hud-telemetry); `demo/` (script, beats, slides, submission checklist); `testing/` (test plan, checklists, NASA data audit).

## Data flow

DTM (HiRISE) → `terrain/*` → `costmap/*` → `routing/build_route.py` → `data/processed/routing/*` → `web/shared/data-loader.js` → planner map + HUD telemetry. Science fetchers → `data/processed/science/*` → `export_demo_fixtures.py` → `data/demo/*`. Load order in the browser: processed → demo → contracts.
