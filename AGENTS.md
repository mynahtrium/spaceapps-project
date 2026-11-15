# AGENTS.md — nasathingamajig (Martian Mappers)

Guide for coding agents (Claude, Gemini, Cursor, and others). [CLAUDE.md](./CLAUDE.md), [GEMINI.md](./GEMINI.md) and `.cursor/rules/` only point here.

Team **Martian Mappers**, [NASA Space Apps Challenge 2026](https://www.spaceappschallenge.org/), challenge [Interplanetary Survival Guide: Martian Map](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/). The brief asks for a map or tool a Mars astronaut could use on a surface walk, layering data from several NASA missions, with safety and a route in mind.

Team members coordinate work themselves. Do the task you are asked to do; there is no board, role sheet, handoff, standup, or per-change agent log to keep.

## What the product is

A **Marswalk EVA simulator** for Gale crater / lower Mount Sharp, where Curiosity has driven. Frame it as "if a crew visited where Curiosity studied Mount Sharp": Gale is a rover site, not a human landing candidate.

- **Science goal:** ancient lake sediments and habitability / organics in mudstones. Main stops are the Curiosity drill sites Glen Etive 1 and Mary Anning 3 in the Glen Torridon clay-bearing unit; the boxwork unit (Altadena member) is a bonus stop. Stops in `data/processed/routing/stops.json` are still flagged `is_example: true` until the team locks them.
- **Views** (all in `web/`, static ES modules, no bundler):
  - **EVA / HUD** (`web/hud/`): three.js first-person walk on streamed HiRISE corridor terrain, with a helmet HUD (distance, slope, next stop), Mars physics, drivable rovers, habitat, NPC crew, landing cinematic and multiplayer.
  - **Orbit** (`web/orbit/`): Mars globe; pick a site and land.
  - The 2D MapLibre planner was removed (the Orbit view replaced it). The pipeline route still reaches the HUD: `app.js` sends it with the `mm:set-route` event.
- **Pipeline** (`pipeline/`, Python + GDAL): HiRISE DTM → slope → cost map → Dijkstra route, plus NASA science fetchers. Outputs go to `data/processed/`, and demo fixtures to `data/demo/`.

For a file-by-file map see [docs/CODEBASE_INDEX.md](./docs/CODEBASE_INDEX.md). Past choices are in [docs/DECISIONS.md](./docs/DECISIONS.md); [ROADMAP.md](./ROADMAP.md) is a historical plan and is not followed.

## Rules (must follow)

1. **No secrets.** The NASA API key lives only in `NASA_API_KEY` (environment or a gitignored `.env`). `.env.example` holds placeholder names only. Never commit `.env` or a real key. Do not use NASA's shared `DEMO_KEY`.
2. **Team members are minors.** No photos, video, voices or likenesses of under-18s in the demo or submission. Any file that names a team member uses a first name or nickname only, with no contact details, school or other personal data.
3. **Cite data sources** in the product (Sources & Honesty modal) and the submission, with fetch dates. Do not invent facts, outcrop IDs or mineral detections. Mark gaps **UNVERIFIED**.
4. **Keep the repository private.** Do not make it public or add hosting, billing or deployment integrations.
5. **Git:** never force-push `main`. Commit or push only when the person you are working with asks.
6. **`?demo=1` makes zero network requests.** Everything a live API provides needs a static JSON fallback. A live API must never be required on stage.
7. **AI use:** the submission must describe how AI tools were used. Keep [docs/AI_USE.md](./docs/AI_USE.md) accurate when asked.

## Honesty labels

Say these in the UI and on slides:

- **Slope limits** (green ≤ 10°, amber 10–15°, red 15–20°, blocked > 20°) are lunar EVA stand-ins from NASA's [EVA ConOps](https://www.nasa.gov/wp-content/uploads/2020/01/topic_1-_eva_lunar_surface_concept_of_operations.pdf), not Mars limits.
- **DTM slope matches Curiosity's tilt only weakly** (about 5 m medians 9.0° vs 8.6° over 176 waypoints), so keep a safety margin.
- **Radiation is a time problem, not a place problem.** Use dose ≈ RAD baseline (about 0.64 mSv/day, [Hassler et al. 2014](https://www.science.org/doi/10.1126/science.1244797)) × EVA duration, plus DONKI WSA-Enlil runs that list Mars. Do not draw a radiation map of rocks.
- **Placeholders:** walking time, suit O₂ (if shown), terrain colour tint and procedural terrain outside the HiRISE corridor are illustrative and must be labelled.
- Use a **Mars radius** for distances (3,389.5 km mean, or 3,396.19 km equatorial as in the DTM labels).

## Data

| Layer | Mission | Used for | Access |
|---|---|---|---|
| HiRISE DTM (1 m) + orthoimage (25 cm) | MRO | Slope, routing, 3D corridor terrain (DTEEC_009149), wider DTM (DTEEC_019698) | [PDS DTMs](https://hirise-pds.lpl.arizona.edu/PDS/DTM/) · [DTM index](https://hirise-pds.lpl.arizona.edu/PDS/INDEX/DTMCUMINDEX.TAB) |
| CTX mosaic (5 m), MOLA relief | MRO, MGS | Base-map context | [Mars Trek WMTS](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars) |
| THEMIS day/night IR (100 m) | Mars Odyssey | Thermal layer | [Day IR](https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml) · [Night IR](https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml) |
| CRISM MTRDR | MRO | Spectral layer | [ODE REST](https://oderest.rsl.wustl.edu/) |
| REMS weather, RAD dose | Curiosity | Weather, dose baseline | [REMS](https://atmos.nmsu.edu/PDS/data/mslrem_1001/DATA/) · [RAD](https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/DATA/) |
| DONKI (CME, SEP, GST, WSA-Enlil) | NASA CCMC | Space-weather banner | [api.nasa.gov](https://api.nasa.gov/) |
| Waypoints, traverse, raw images | Curiosity | Stop coordinates, tilt check, POV stills | [Waypoints](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json) · [Traverse](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json) · [Raw images](https://mars.nasa.gov/rss/api/?feed=raw_images&category=msl&feedtype=json&num=2&page=0&order=sol+desc) |

Notes:
- The waypoint, traverse and raw-image feeds back NASA's Mars Maps viewer and are not a documented API; they may change. Do not use `api.nasa.gov/mars-photos` (it returns 404).
- Full source list with dates: [docs/DATA_SOURCES.md](./docs/DATA_SOURCES.md).

## Conventions

- English for code identifiers and commit messages. The UI has an EN / TR switch; keep source citations in English.
- Never commit raw rasters: `data/raw/`, `*.tif`, PDS `.IMG` and JP2 are gitignored. Commit small derived products only. Keep static files under about 100 MB.
- Data loads in this order: `data/processed/` → `data/demo/` → `docs/contracts/`.
- If you change a field name, meaning or file under `docs/contracts/`, update the example JSON, add a row to [docs/contracts/CHANGES.md](./docs/contracts/CHANGES.md), and update the matching `data/processed/` and `data/demo/` fixtures in the same commit.
- `web/vendor/` (three.js, loaders) is vendored: do not edit it.
- Task-specific notes are in `skills/*/SKILL.md` (routing, hud-3d, dem-to-slope, data-fetching, ai-use-log).

## How to run and check

1. Copy `.env.example` to `.env` and set `NASA_API_KEY` (only needed for live fetches).
2. Start the app with `scripts/start-app.sh` (or `node scripts/server.mjs`), then open `http://localhost:8000/web/`. Add `?demo=1` for offline mode.
3. After changing `web/`, run `node --check` on edited files and `node --test web/tests/*.test.mjs`.
4. Pipeline: Python 3 and GDAL (with OpenJPEG for JP2). See [pipeline/README.md](./pipeline/README.md).
