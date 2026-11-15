# Codebase index

Generated from a scan of tracked files. Excludes `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules`. Vendored three.js / loaders in `web/vendor/` (about 60k lines) are not described.

## Top level

| Path | What it is |
|---|---|
| `web/` | Static browser app (ES modules, no bundler). Entry `web/index.html` → `web/app.js` |
| `scripts/` | `server.mjs` static server + multiplayer WebSocket upgrade; `mp-hub.mjs` room hub; `start-app.sh`, `start.bat` |
| `pipeline/` | Python data pipeline (DTM → slope → cost map → route; NASA science fetchers) |
| `data/processed/` | Pipeline outputs (route, stops, terrain, science JSON, THEMIS tiles, POV stills) |
| `data/demo/` | Frozen offline fixtures for `?demo=1` (incl. 336 corridor terrain chunks) |
| `docs/` | Data sources, decisions, AI-use log, demo script, test plans, JSON `contracts/` |
| `skills/` | Agent skill notes (routing, hud-3d, dem-to-slope, data-fetching, ai-use-log) |
| `vercel.json` | Redirects `/` → `/web/` |

## web/ (browser app)

**Entry**: `index.html` (start screen, EVA HUD view, Orbit view), `app.js` (boot, themes, start menu, EN/TR language, wiring of HUD / orbit / multiplayer / route bridge), `styles.css`.

### `web/hud/` (first-person EVA, three.js)
- `hud3d.js`: main scene, camera as astronaut eyes, input, vehicle driving, ties every module below together.
- Walker and crew: `astronaut-rig.js`, `footsteps.js`, `npc-system.js`, `npc-knowledge.js`, `npc-dialogue-ui.js`.
- Vehicles: `experimental-rover.js` (drivable MMSEV), `concept-rover-model.js` (sculpted NASA Mars Rover Concept 6x6 body and hollow wheels), `rover-dynamics.js`, `rover-rig.js`, `rover-dash.js`, `historic-rovers.js` (Sojourner, Spirit, Opportunity, etc.), `mars-landers.js` (landers, Ingenuity, site markers).
- World: `GaleVista.js` (horizon), `MarsRockField.js`, `FieldKits.js`, `mars-habitat.js` + `habitat-textures.js`, `merge-static.js` (bakes rigid parts of a model into one mesh per material to cut draw calls).
- Sky and atmosphere: `MarsEphemeris.js`, `MarsCelestialSky.js`, `regolith-dust.js` (kicked-up dust and tire tracks); `post-pipeline.js` (ambient occlusion, bloom, anti-aliasing, visor pass).
- `landing-sequence.js`: entry, descent and landing cinematic.
- `MarsAtmosphereHaze.js`: height-layered aerial-perspective haze patched into terrain and horizon materials.
- `hud-tasks.js`: Tasks mission terminal (habitat monitors), terrain minimap, debrief card, 3D ground route guide.

### `web/map/` (terrain and map engine)
- Terrain pipeline: `TileSourceRegistry.js` (fallback cascade), `MarsDemSampler.js`, `TerrainMeshBuilder.js`, `terrain.worker.js` + `TerrainWorkerPool.js`, `MarsPbrTextures.js`, `GaleCorridor.js` (streamed corridor chunks).
- `Geodesy.js`: Mars projection, tile maths, RTC datum.
- `umd-window-shim.js`: lets the `geographiclib-geodesic` UMD build load inside `terrain.worker.js`.

### `web/physics/`
`MarsConstants.js`, `MarsGravityField.js`, `MarsPhysicsWorld.js` (120 Hz walker), `VehicleDynamics.js`, `Terramechanics.js`, `SuitBiomechanics.js`, `MetabolicPlssModel.js`, `MarsAcoustics.js`.

### `web/shared/`
`data-loader.js` (loads `data/processed` → `data/demo` → `docs/contracts` fallback), `route-bridge.js` (`mm:set-route` events, polyline utils), `multiplayer.js` (client; WebSocket + fallback transport), `mars-rovers.js` and `mars-hardware.js` (catalogues), `audioEngine.js` (procedural Web Audio), `gamepad.js` + `gamepad-ui.js`, `task-router.js` (Tasks staging and vehicle-aware route planner, no DOM), `context-menu.js`, `dev-settings.js` (stored settings), `graphics-profile.js` (graphics presets: resolution, MSAA, shadows, terrain radius).

### Other
- `web/orbit/orbit-view.js`: Mars globe, landing-site picking.
- `web/assets/`: 4k globe textures, NASA GLBs (Perseverance, MMSEV, spacesuits).
- `web/vendor/`: three.module.js, GLTF/DRACO loaders, BufferGeometryUtils.
- npm packages: `web/index.html` holds the import map that points bare imports (`three.quarks`, `postprocessing`, `simplex-noise`, …) at files in `node_modules/`, so run `npm install` first. Packages with no browser ES build go through a shim (`web/shared/seedrandom-esm.js`, `web/shared/tone-esm.js`). `web/tests/importmap.test.mjs` fails when an import is missing from the map.
- `web/tests/` (Node test runner, `node --test web/tests/*.test.mjs`): context-menu, corridor, ephemeris, fallback, geodesy, multiplayer, npc-system, physics, route-bridge, rover-dynamics, server, task-router, atmosphere-haze, audio-engine, vehicles.

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

DTM (HiRISE) → `terrain/*` → `costmap/*` → `routing/build_route.py` → `data/processed/routing/*` → `web/shared/data-loader.js` → HUD telemetry and the Orbit view. Science fetchers → `data/processed/science/*` → `export_demo_fixtures.py` → `data/demo/*`. Load order in the browser: processed → demo → contracts.
