# AGENTS.md — nasathingamajig (Martian Mappers)

Team **Martian Mappers**, [NASA Space Apps Challenge 2026](https://www.spaceappschallenge.org/) (hackathon 14–15 November 2026).

This repository is a Gale crater / Mount Sharp **Marswalk planner** for the official challenge [Interplanetary Survival Guide: Martian Map](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/) (Intermediate; last published 28 October 2026).

**Decisions on 12 November 2026:** stay at **Gale / Mount Sharp** (Curiosity). The primary science goal is **ancient lake sediments and habitability / biosignature potential (organics in mudstones)**. The boxwork unit (Altadena member) is a **bonus stop**, not the only target. The product is a **web app**: a 2D [MapLibre](https://maplibre.org/maplibre-gl-js/docs/) planner map **sends the route** to a **3D first-person terrain view** with a **helmet HUD**. VR / WebXR is **stretch only**. The team is six people (three backend, one frontend, two bug testers), new to GitHub and to map / 3D work, registered with a guardian, aiming to win in a full 48 hours.

The hour-by-hour plan, folder ownership, and interface contracts are in [ROADMAP.md](./ROADMAP.md). Role sheets: [docs/roles/](./docs/roles/). Beginner Git: [docs/GITHUB_WORKFLOW.md](./docs/GITHUB_WORKFLOW.md). Example JSON: [docs/contracts/](./docs/contracts/). Coordination: [docs/coordination/BOARD.md](./docs/coordination/BOARD.md), [HANDOFFS.md](./docs/coordination/HANDOFFS.md), [AGENT_LOG.md](./docs/coordination/AGENT_LOG.md), [STANDUP.md](./docs/coordination/STANDUP.md). Decisions: [docs/DECISIONS.md](./docs/DECISIONS.md). Judging (still **UNVERIFIED**; 13 November guide unread): [docs/JUDGING_CHECKLIST.md](./docs/JUDGING_CHECKLIST.md).

**Research and planning only until 14 November 2026.** A local event's challenge post (seen as a search snippet, not confirmed on the official page) says starting the build early can lead to disqualification. That rule remains **UNVERIFIED**: a 13 November 2026 re-check could not read the official challenge Details or Resources tabs, the Project Submission Guide, or the 2026 judging guide (certificate error / HTTP 500). Confirmed submission and registration rules from pages that did load are in [ROADMAP.md](./ROADMAP.md) §1 and the Rules section below.

This file is the **single source of truth** for coding agents and teammates (data sources, design rules, and constraints). [CLAUDE.md](./CLAUDE.md), [GEMINI.md](./GEMINI.md), and `.cursor/rules/` are short pointers **to this file**. For Grok and DeepSeek, see [docs/coordination/LOADING_AGENTS_MD.md](./docs/coordination/LOADING_AGENTS_MD.md). Skills live in `skills/*/SKILL.md`.

## Site and science goal (Gale / Mount Sharp)

- **Site:** boxwork unit (Altadena member) on lower Mount Sharp, Gale crater (Curiosity). Curiosity entered it on Sol 4534 (May 2025) at about 4.80°S, 137.39°E, and was at about 4.83°S, 137.39°E on Sol 5070 (10 November 2026), from NASA's waypoint file. Orbital mapping shows boxwork exposed for about 14 km west of the traverse. [Siebach et al. overview](https://hal.science/hal-05494691)
- **Science goal (12 November 2026 decision):** plan a short walk whose **primary** stops support **ancient lake sediments and habitability / biosignature potential (organics in mudstones)**. The boxwork unit is a **bonus stop**. Curiosity's boxwork work remains useful context: ridges ~5 m wide and hollows 10–20 m across and 1–2 m deep; ridges rich in phyllosilicates, hollows containing siderite. [Altadena Member paper](https://doi.org/10.2110/sepmmisc.26.066) · [NASA press release](https://www.nasa.gov/missions/mars-science-laboratory/curiosity-rover/nasas-curiosity-mars-rover-starts-unpacking-boxwork-formations/). Exact lake-sediment outcrop names and coordinates are **not locked in this file** — choose them against official NASA / Curiosity sources and the 13 November Resources tab (**UNVERIFIED** until then), inside the DTM footprint already checked below. Do not invent outcrop IDs or mineral detections.
- **Terrain:** HiRISE 1 m DTMs cover the site. [DTEEC_019698](https://hirise-pds.lpl.arizona.edu/PDS/DTM/ESP/ORB_019600_019699/ESP_019698_1750_ESP_019988_1750/DTEEC_019698_1750_019988_1750_U01.IMG) covers 4.73–5.04°S, 137.31–137.44°E (includes the traverse). [DTEEC_001488](https://hirise-pds.lpl.arizona.edu/PDS/DTM/PSP/ORB_001400_001499/PSP_001488_1750_PSP_001752_1750/DTEEC_001488_1750_001752_1750_U02.IMG) covers 4.72–4.95°S, 137.24–137.35°E (west of the traverse). That DTM comes from stereo pair PSP_001752_1750 (10 December 2006). NASA's boxwork picture [PIA26306](https://science.nasa.gov/photojournal/hirise-views-mount-sharps-boxwork/) is dated the same day; a [search result](https://www.uahirise.org/PSP_001752_1750) ties PIA26306 to that observation. Confirm in [HiView](https://www.uahirise.org/hiview/) that the boxwork is inside the footprint before committing.
- **Framing caveat:** Gale is a rover site, not a human landing candidate. Frame the product as "if a crew visited where Curiosity studied Mount Sharp."
- **Backup:** Jezero crater / Perseverance only if the locked Mount Sharp stops cannot be placed inside the DTM footprint (unlikely given DTEEC_019698). Concept C (Protonilus Mensae) remains a poor fit (no rover ground truth).

Indicative (not validated) terrain notes from the 11 November 2026 planning check: in a 1 km × 7.4 km strip of DTEEC_019698 (about 4.79–4.81°S), 32% of valid 1 m pixels were steeper than 20° and 46% steeper than 15° (median 14°). The 1 m DTM under-reads local slope versus rover-reported tilts (4–10° under the rover vs 9–17° reported at four boxwork Sols — a steady offset, so relative slopes are still usable, but add a safety margin and say so). About a quarter of that sampled strip had no-data pixels (shares above are on valid pixels only). The 1 m DTM barely resolves 5 m ridges — use the 25 cm orthophoto to see them.

## Data layers

Links and access notes were checked on 11 November 2026. Re-check the official Resources tab on 13 November.

| Layer | Role | Access |
|---|---|---|
| HiRISE orthoimage (optical, 25 cm) | See ridges and obstacles | [PDS DTM + ortho folders](https://hirise-pds.lpl.arizona.edu/PDS/DTM/) · [HiView](https://www.uahirise.org/hiview/) |
| HiRISE DTM (topographic, 1 m) | Slope, roughness, routing surface | [Cumulative DTM index](https://hirise-pds.lpl.arizona.edu/PDS/INDEX/DTMCUMINDEX.TAB) · [DTM page for 001488](https://www.uahirise.org/dtm/dtm.php?ID=PSP_001488_1750) |
| CTX mosaic (optical context, 5 m) | Regional context tiles | [Trek WMTS capabilities](https://trek.nasa.gov/tiles/Mars/EQ/CTX_beta01_uncontrolled_5m_Caltech/1.0.0/WMTSCapabilities.xml) |
| MOLA shaded relief (global, 463 m) | Regional topography | [Trek WMTS capabilities](https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/WMTSCapabilities.xml) |
| HRSC–MOLA blended DEM (global, 200 m) | Broader elevation (11.4 GB; use windowed GDAL reads) | [USGS Astropedia page](https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m) |
| THEMIS day/night IR (~100 m) | Thermal mosaics | [Day IR WMTS](https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml) · [Night IR WMTS](https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml) |
| CRISM mineral maps (MTRDR) | Spectral / science stops | [ODE REST API](https://oderest.rsl.wustl.edu/) · [CRISM at PDS Geosciences](https://pds-geosciences.wustl.edu/missions/mro/crism.htm) |
| Orbital Data Explorer (ODE) | Search orbital products by area | [ODE Mars](https://ode.rsl.wustl.edu/mars/) (docs page returned 403 on 11 November 2026) |
| REMS (Curiosity atmosphere) | Weather for EVA window | [REMS archive](https://atmos.nmsu.edu/PDS/data/mslrem_1001/DATA/) · [REMS overview](https://atmos.nmsu.edu/data_and_services/atmospheres_data/MARS/curiosity/rems.html) (latest folder Sol 4710–4843 as of the check) |
| RAD (Curiosity radiation) | Surface dose rates | [RAD RDR archive](https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/DATA/) (latest folder Sol 4710–4843 as of the check) |
| DONKI (space weather) | CME, SEP, GST, and WSA-Enlil Mars arrival predictions | [api.nasa.gov](https://api.nasa.gov/) (DONKI section) · [CCMC DONKI](https://ccmc.gsfc.nasa.gov/tools/DONKI/) |
| Curiosity traverse | Waypoints, elevation, tilt (ground-truth for slope) | [MSL waypoints](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json) · [MSL traverse](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json) |
| Curiosity raw images | Rover point-of-view at stops | [MSL raw image feed](https://mars.nasa.gov/rss/api/?feed=raw_images&category=msl&feedtype=json&num=2&page=0&order=sol+desc) |
| Mars Trek tiles | Base-map WMTS (CTX, THEMIS, MOLA) | [Mars Trek](https://trek.nasa.gov/mars/) · [WMTS API docs](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars) |
| PDS / ODE archives | Official data holdings | [Geosciences](https://pds-geosciences.wustl.edu/) · [Imaging](https://pds-imaging.jpl.nasa.gov/) · [Atmospheres](https://pds-atmospheres.nmsu.edu/) · [Planetary Plasma Interactions](https://pds-ppi.igpp.ucla.edu/) · [MSL Analyst's Notebook](https://an.rsl.wustl.edu/msl/mslbrowser/) |

Backup-site layers for Concept B include [MEDA](https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/), [M20 waypoints](https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json), [M20 traverse](https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json), and [PDS Geosciences Mars 2020](https://pds-geosciences.wustl.edu/missions/mars2020/index.htm). 8 CRISM MTRDR products overlap the 001488 footprint (ODE query); CTX has 174 observations over the same footprint. REMS and RAD archives through Sol 4843 cover the boxwork Sols 4534–4700.

Practical notes from the 11 November 2026 check:

- Find DTMs via the [cumulative DTM index](https://hirise-pds.lpl.arizona.edu/PDS/INDEX/DTMCUMINDEX.TAB). The Gale box (4.4–5.9°S, 137.0–138.2°E) lists 20 DTM products; those of interest are 001488, 009149 and 019698.
- GDAL has a [PDS driver](https://gdal.org/en/stable/drivers/raster/pds.html). Test JP2 orthos early; they need OpenJPEG. HTTP range requests work on the DTM `.IMG` files (tested, 206). The 019698 file is 18,270 lines × 7,426 samples of 32-bit floats; the label takes the first 29,704-byte record; ~58,586 pixels per degree.
- Traverse and raw-image feeds are the data behind NASA's [Mars Maps (MMGIS)](https://mars.nasa.gov/maps/) viewer, not a documented public API, and could change. Waypoint properties include `sol`, `lat`, `lon`, `elev_geoid`, `roll`, `pitch`, `tilt`, `dist_total_m`. Use `tilt` to check the slope model. Do not use the older `api.nasa.gov/mars-photos` endpoints (404 for both rovers on 11 November 2026). Sol filters on the raw-image feed need URL-encoded parameters (`condition_2=4600:sol:gte` and similar).
- DONKI: use the **WSAEnlilSimulations** endpoint and look for `"Mars"` in each run's `impactList` (example from a May 2025 query: predicted arrival 2025-05-08 12:00Z). That is the best "predicted radiation conditions at Mars" signal available from these endpoints. CME, SEP and GST endpoints worked; the FLR (flare) endpoint returned 404. NASA's shared demo key is rate-limited — use a personal key via `NASA_API_KEY` and cache JSON for the demo.
- Distances must use a Mars radius (3,389.5 km mean, or 3,396.19 km equatorial as in the DTM labels) or lengths will be wrong. [ATS Mars Atlas notes](https://labs.allthingsspatial.io/about/mars-atlas/) explains this trap.

**UNVERIFIED / not working as of 11 November 2026:**

- NASA Ames Mars climate reference runs (listed on [Space Data Atlas](https://spacedata.swapniltamse.com/challenges/martian-map/)); host `data.nas.nasa.gov` failed TLS / returned a server error. Treat as unavailable until checked on 13 November.
- PDS Imaging Atlas API docs (the page returned 403).
- The Resources tab on the official challenge page (opens 13 November).
- A Zenodo "MSL/RAD dose rates" product suggested by a search (blocked, 403).
- The USGS Planetary Geologic Mapping Program page returned 403 (**UNVERIFIED**); [SIM 3292 Geologic Map of Mars](https://pubs.usgs.gov/sim/3292/) itself returned 200.

## Stack (planned, starting 14 November)

- **Preprocessing:** Python plus GDAL command-line tools, with `rasterio`, `numpy`, `scikit-image`, `shapely` / `geopandas`. Output only small files: cropped slope/hazard previews, route GeoJSON, a few JSON tables, a height preview for the 3D view.
- **2D planner:** a static [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) map (Leaflet only if MapLibre fails). Base layers from Mars Trek WMTS (CTX, THEMIS, MOLA). Local layers: HiRISE / hazard / route / stops. The planner **sends the route** to the 3D view (`mm:set-route`; see [ROADMAP.md](./ROADMAP.md) §3).
- **3D + helmet HUD (MUST):** first-person terrain, default [three.js](https://threejs.org/) heightmap. [CesiumJS](https://cesium.com/) only if Frontend 1 already knows it. MUST HUD fields: distance, slope, next stop, suit O₂ (O₂ is an illustrative placeholder).
- **Optional APIs:** Backends may add thin local endpoints, but **static JSON fallbacks are required** (`data/processed/` first, then `docs/contracts/`).
- **Panels (SHOULD):** elevation/slope profile, rover POV at stops, dose/time card, DONKI space-weather banner, weather / thermal toggles.
- **Hosting:** static files plus optional local API. Pre-download and cache everything the demo needs so it works offline. Size target: under ~100 MB of static files.
- **Stretch only (hours 32–40):** WebXR headset mode; paired rover path. Nothing new after hour 40.

## Slope / hazard cost map and routing

1. Resample the DTM to 2–5 m cells (average blocks). The 1 m terrain model has stereo noise; averaging to 5 m changed the share of steep pixels from 32% to 26% (>20°) in the planning test strip.
2. Slope with `gdaldem slope` (see [gdaldem](https://gdal.org/en/stable/programs/gdaldem.html)); roughness / TRI with `gdaldem roughness` or `TRI`.
3. Obstacles: treat no-data cells and slope above the limit as blocked. Add ridge walls and boulder fields from the 25 cm orthophoto (simple bright/dark texture or edge density, or hand-drawn polygons for the demo). Automatic boulder detection is a stretch.
4. Suggested cost per cell (tune on the real data): `cost = step_length × (1 + (slope / 10°)² + k_rough × roughness)`; `cost = ∞` if slope > limit.
5. Search: 8-neighbour **Dijkstra / A\*** on the grid. Python has [`skimage.graph.route_through_array`](https://scikit-image.org/docs/stable/api/skimage.graph.html), which does this in a few lines. Run it between stops: habitat / start → lake-sediment / mudstone stops → boxwork bonus → back. Always also write a static `route.json` so the demo works if a routing API is down.
6. Output: route as GeoJSON, plus a profile (distance vs elevation vs slope), totals (distance, climb, placeholder time), and HUD telemetry samples. Dose is produced by Backend 3 from the duration.

Slope limits are **illustrative lunar numbers**, not a Mars-specific limit (none was found in the planning note). NASA's [Exploration EVA Concept of Operations](https://www.nasa.gov/wp-content/uploads/2020/01/topic_1-_eva_lunar_surface_concept_of_operations.pdf) describes astronauts walking up/down/across a slope of up to 20° and traverses of up to 2 km away from the lander, with EVAs of up to 8 hours (6±2 h typical); Apollo 15 crossed ~17° slopes. A published traverse planner ([LPSC 2023 abstract 1413](https://www.hou.usra.edu/meetings/lpsc2023/pdf/1413.pdf)) used Dijkstra on a 5 m raster, minimising cumulative slope with a penalised 15° per-pixel threshold, and treated 2 km as a walking-EVA radius. Mars gravity and suit weight differ, so say these are stand-ins. Suggested colours: green ≤ 10°, amber 10–15°, red 15–20°, blocked > 20°, with a toggle for the stricter 15° limit. Walking-speed formulas (for example Tobler's hiking function) are Earth hiking assumptions and must be labelled as placeholders.

## Radiation dose budget and DONKI alerts

Over a ~10 km walk the galactic cosmic-ray dose rate hardly changes with place; it changes with **time** (solar cycle, solar particle events) and **shielding** (habitat/rover vs open ground). Do not invent a "radiation map" of rocks.

- Baseline: Curiosity's RAD measured about **0.64 ± 0.12 mSv/day** (dose equivalent, galactic cosmic rays) in its first ~300 sols, at the Gale crater elevation (about −4.4 km MOLA). [Hassler et al., Science 2014](https://www.science.org/doi/10.1126/science.1244797)
- Dose budget: dose ≈ baseline rate × EVA duration (duration comes from the route/speed). Add a space-weather banner from DONKI WSA-Enlil runs that list Mars in the impact list, and show the baseline from the real RAD tables for the actual Sols.
- Stretch (label "illustrative"): a sky-view factor raster from the DTM (how much sky a point sees) as a crude proxy for how much natural shielding terrain gives.

## Planned repo layout

Folder **ownership** (do not edit someone else's tree): [ROADMAP.md](./ROADMAP.md) §2.

```
data/raw/                     # originals; gitignored, never commit
data/processed/terrain/       # Backend 1
data/processed/routing/       # Backend 2
data/processed/science/       # Backend 3
pipeline/terrain|routing|data # Backends 1, 2, 3 (no application code until 14 Nov)
web/planner|hud|shared        # Frontend 1 (no application code until 14 Nov)
docs/contracts/               # example JSON shapes (sample data, not code)
docs/roles/                   # one sheet per person
docs/testing/                 # Tester 1
docs/demo/                    # Tester 2
docs/GITHUB_WORKFLOW.md
docs/AI_USE.md
docs/coordination/            # board, handoffs, agent log, standup
docs/team/profiles/           # first-name or nickname only; no personal data
docs/DECISIONS.md
docs/JUDGING_CHECKLIST.md     # UNVERIFIED until 13 Nov
data/demo/                    # demo-safe fixtures (after 14 Nov)
ROADMAP.md
AGENTS.md
CLAUDE.md
GEMINI.md
README.md
.env.example
skills/                       # includes hud-3d
.cursor/rules/
```

## Conventions

- English for code identifiers and commit messages. User-facing demo copy may be English (and Turkish if the team wants it); keep source citations in English.
- No secrets in the repository, in notes, or in pull requests. Never commit `.env` or a real key.
- Cite every data source and the date it was fetched. Keep a source list in the product and the submission.
- Prefer small derived products over committing raw rasters (`*.tif`, PDS `.IMG`, JP2, and `data/raw/` are gitignored).
- Use a Mars radius for distances; keep coordinates as Mars lat/lon consistent with Trek / WMTS tiles.
- Be honest in the UI and on slides: lunar slope limit used as a stand-in; the DTM under-reads rover tilt; radiation is mostly a time problem; list data sources and dates.
- The challenge text suggests "at least three kinds of data" and space weather; those are suggestions, not hard rules. Aim for 3+ data types from 3+ missions anyway (for example HiRISE image + DTM slope [MRO]; THEMIS thermal [Odyssey]; CRISM spectral [MRO]; Curiosity REMS/RAD [MSL]; DONKI space weather).
- Time frame may be a past period, a predicted future period, or none (stable topography/geology).
- Rover point-of-view images are encouraged so the explorer knows what to expect.
- Suit O₂ and walking time on the HUD are **illustrative placeholders** and must be labelled as such.
- Work only in owned folders; open small PRs; a bug tester reviews before merge ([docs/GITHUB_WORKFLOW.md](./docs/GITHUB_WORKFLOW.md)).
- Claim a board task before starting ([docs/coordination/BOARD.md](./docs/coordination/BOARD.md)). Append [AGENT_LOG.md](./docs/coordination/AGENT_LOG.md) **in the same commit** (Commit field: `this commit`). Stand up every 6 hours during the event ([STANDUP.md](./docs/coordination/STANDUP.md)).
- Contract field changes need a row in [docs/contracts/CHANGES.md](./docs/contracts/CHANGES.md) and a notice to the owner, Frontend 1, and both testers ([HANDOFFS.md](./docs/coordination/HANDOFFS.md) + a board question).

## How to run (planned, from 14 November)

Nothing in `pipeline/` or `web/` is built yet. After 14 November 2026:

1. Install Python 3, GDAL (with OpenJPEG for JP2), and either a current Node toolchain or a simple static file server for `web/`.
2. Copy `.env.example` to `.env` and set `NASA_API_KEY` (free key from [api.nasa.gov](https://api.nasa.gov/); never commit it).
3. Download the listed products into `data/raw/` (see `skills/data-fetching/SKILL.md`). Do not start this data pipeline before 14 November.
4. Run the forthcoming Backend 1–3 steps to write `data/processed/terrain/`, `routing/`, and `science/` (see the skills and [ROADMAP.md](./ROADMAP.md)).
5. Serve `web/` as static files. The planner (`skills/map-ui`) loads processed JSON then falls back to `docs/contracts/`. The 3D HUD (`skills/hud-3d`) receives the route from the planner. Cache Trek tiles and DONKI JSON for an offline demo. Stay under ~100 MB of static files if possible. A live API is optional and must not be required on stage.
6. Append [docs/coordination/AGENT_LOG.md](./docs/coordination/AGENT_LOG.md) in the same commit as the work (Commit: `this commit`). Tester 1 rolls that log into [docs/AI_USE.md](./docs/AI_USE.md) for the submission (see `skills/ai-use-log/SKILL.md`).

## Rules (must follow)

1. **No application code and no project data pipeline before 14 November 2026.** Reading, tool installs, choosing roles, documentation, practice PRs, and onboarding interviews are fine. Starting the build early may disqualify the team — this remains **UNVERIFIED** (the Project Submission Guide could not be read on 13 November).
2. **No secrets.** The NASA API key lives only in the environment variable `NASA_API_KEY` (and a local, gitignored `.env`). `.env.example` may contain placeholder names only (including the planned `DEMO_SAFE` flag).
3. **Log every change** in [docs/coordination/AGENT_LOG.md](./docs/coordination/AGENT_LOG.md) **in the same commit** as the work. Write `this commit` in the Commit field; do not amend or force-push just to add a hash (see that file). Tester 1 uses this log to keep [docs/AI_USE.md](./docs/AI_USE.md) complete for the submission. The official FAQ says each submission must describe how "SI tools" were used; the exact form wording remains **UNVERIFIED** (the 13 November submission guide could not be read).
4. **No photos, video, voices or likenesses of under-18s** in the demo or submission. Prefer screen recording plus captions (or an adult / synthetic voice if the official guide allows — still **UNVERIFIED**). The [official terms](https://www.spaceappschallenge.org/legal/) (updated 7 August 2026) require under-18s to be registered by a parent or legal guardian and accompanied by that parent/legal guardian throughout the event, and require every participant to register online before the event starts. Profiles may contain a **first name or nickname only** — no phone numbers, emails, addresses, school names, or other personal data.
5. **Cite data sources** in the product and the submission. Keep the sources list.
6. **Keep this repository private.** Do not make it public and do not connect hosting, billing, or deployment integrations from this scaffolding.
7. Re-read the official challenge, FAQ, Resources tab, Project Submission Guide, and judging guide when they can be loaded. A 13 November check could not read the challenge Details or Resources tabs or the 2026 judging guide (certificate error / HTTP 500). Do not treat past-year judging categories as confirmed for 2026. [docs/JUDGING_CHECKLIST.md](./docs/JUDGING_CHECKLIST.md) has a Status 2026-11-13 note and stays **UNVERIFIED**; board tasks PRE-05 and PRE-06 remain `todo`.
8. **Claim a task** on [docs/coordination/BOARD.md](./docs/coordination/BOARD.md) before starting work. Follow the session checklist below.

## Session start and end

Do this at **every** agent session (mirrored briefly in [docs/GITHUB_WORKFLOW.md](./docs/GITHUB_WORKFLOW.md) and the role sheets).

**Start**

1. `git checkout main && git pull` (then create or update your branch; do not work on `main` after 14 November).
2. Read [BOARD.md](./docs/coordination/BOARD.md), [HANDOFFS.md](./docs/coordination/HANDOFFS.md), the latest [AGENT_LOG.md](./docs/coordination/AGENT_LOG.md) entries, and **all** [docs/team/profiles/](./docs/team/profiles/) (except you may skip `_TEMPLATE.md`).
3. **First session** with this human: run the onboarding interview in [docs/team/profiles/README.md](./docs/team/profiles/README.md) **before any other work**, and write their profile (first name or nickname only; no personal data).
4. Claim a task on the board (`todo` → `doing`, add first name or nickname and agent tool).
5. Work only in owned folders, on a `ROLE/short-topic` branch.

**End**

6. Test, or review docs, in line with the task.
7. Append an **AGENT_LOG** entry (Commit: `this commit`). Update BOARD, and write a handoff or contract CHANGES row if needed. If the event clock is at a 6-hour mark, append [STANDUP.md](./docs/coordination/STANDUP.md) (Done / Next / Blocked).
8. Commit, push, and open a PR for a tester. Do not merge your own PR.

## Standup (every 6 hours)

During the hackathon, at hours 0, 6, 12, 18, 24, 30, 36, and 42, each role appends three lines to [docs/coordination/STANDUP.md](./docs/coordination/STANDUP.md): **Done**, **Next**, **Blocked**. If you miss a slot, catch up at the next session.

## Contract changes

If you change a field name, meaning, or file under `docs/contracts/`, you must, in the **same PR**: (1) update the example JSON, (2) add a row to [docs/contracts/CHANGES.md](./docs/contracts/CHANGES.md), and (3) notify the owning role, Frontend 1, and both testers with a [handoff](./docs/coordination/HANDOFFS.md) and a [board question](./docs/coordination/BOARD.md). Do not silently rename fields. After 14 November also update any matching `data/processed/` and `data/demo/` fixtures.

## 48-hour plan (after kickoff)

The detailed hour-by-hour plan, dependencies, contracts, definitions of done, and fallbacks are in [ROADMAP.md](./ROADMAP.md). Summary of the 12 November 2026 timing:

- **Pre-14 November:** accounts, practice PR, installs, NASA API key in a local `.env`, read the 13 November Resources tab and judging guide (still **UNVERIFIED**; unread on 13 November), lock stops on paper / HiView (PRE-07; see [docs/testing/STOP_COORDINATE_CHECK.md](./docs/testing/STOP_COORDINATE_CHECK.md)). No application code.
- **Hours 0–16 MUST:** terrain + slope, a safe route, 3D first-person view, basic HUD (distance, slope, next stop, suit O₂).
- **Hours 16–32 SHOULD:** radiation dose budget, DONKI banner, POV photos at stops, weather / thermal layers.
- **Hours 32–40 STRETCH:** WebXR, paired rover mode. **Nothing new after hour 40.**
- **Hours 40–44:** freeze, planned 30-second video (official length **UNVERIFIED**), slides. **Hours 44–48:** submit early on the Team page's Project tab. Official window, from the [2026 landing page](https://www.spaceappschallenge.org/2026/): opens Saturday 14 November 09:00 and closes Sunday 15 November 23:59 **local event time**. Keep a backup recording.

**Presentation reminders:** planned 30-second video with no under-18 faces or voices (screen recording + captions + music); official video length remains **UNVERIFIED**. Be honest on slides (lunar slope stand-in, DTM under-reads tilt, radiation is a time problem, O₂ and walk time are placeholders). Past-year judging categories (impact, creativity, validity, relevance, presentation) are still **UNVERIFIED** for 2026 — the 13 November guide could not be read.

## Open questions for the team

Answered on 12 November 2026: Gale / Mount Sharp with a lake-sediment science goal and boxwork as a bonus stop; web app with 3D HUD fed by a MapLibre planner (WebXR stretch only); six people in the roles in [docs/roles/](./docs/roles/); registered with a guardian.

Still open:

- Exact locked outcrop names and coordinates (choose against official NASA sources and the 13 November Resources tab; must sit inside DTEEC_019698).
- Which local or virtual event? (Start times set the 48-hour clock.)
- Who is assigned to each of the six roles (add GitHub usernames in [docs/team/ROSTER.md](./docs/team/ROSTER.md))?

## Sources (checked 11 November 2026)

[Official challenge](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/) · [Official FAQ](https://www.spaceappschallenge.org/resources/participant-faqs/) · [NASA boxwork release](https://www.nasa.gov/missions/mars-science-laboratory/curiosity-rover/nasas-curiosity-mars-rover-starts-unpacking-boxwork-formations/) · [HiRISE boxwork image](https://science.nasa.gov/photojournal/hirise-views-mount-sharps-boxwork/) · [Sol 4553 blog](https://science.nasa.gov/blog/sol-4553-back-to-the-boxwork/) · [HiRISE DTM index](https://hirise-pds.lpl.arizona.edu/PDS/INDEX/DTMCUMINDEX.TAB) · [ODE REST](https://oderest.rsl.wustl.edu/) · [Mars Trek](https://trek.nasa.gov/mars/) · [NASA lunar EVA ConOps](https://www.nasa.gov/wp-content/uploads/2020/01/topic_1-_eva_lunar_surface_concept_of_operations.pdf) · [LPSC 2023 #1413](https://www.hou.usra.edu/meetings/lpsc2023/pdf/1413.pdf) · [Hassler et al. 2014](https://www.science.org/doi/10.1126/science.1244797)

Planning content in this file is based on the team's internal planning note (Scout, 11 November 2026). It does not replace the official challenge page or the 13 November guides.
