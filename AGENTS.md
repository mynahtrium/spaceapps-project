# AGENTS.md — nasathingamajig (Martian Mappers)

Team **Martian Mappers**, [NASA Space Apps Challenge 2026](https://www.spaceappschallenge.org/) (hackathon 14–15 November 2026).

This repository is a Gale crater / Mount Sharp **Marswalk planner** for the official challenge [Interplanetary Survival Guide: Martian Map](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/) (Intermediate; last published 28 October 2026).

**Decisions on 12 November 2026:** stay at **Gale / Mount Sharp** (Curiosity). The primary science goal is **ancient lake sediments and habitability / biosignature potential (organics in mudstones)**. The boxwork unit (Altadena member) is a **bonus stop**, not the only target. The product is a **web app**: a 2D [MapLibre](https://maplibre.org/maplibre-gl-js/docs/) planner map **sends the route** to a **3D first-person terrain view** with a **helmet HUD**, plus an orbit view of the Mars globe. VR / WebXR is **stretch only**.

This file is the **single source of truth** for coding agents: data sources, design rules, and constraints. [CLAUDE.md](./CLAUDE.md), [GEMINI.md](./GEMINI.md), and `.cursor/rules/` only point here. Skills live in `skills/*/SKILL.md`. Example JSON shapes: [docs/contracts/](./docs/contracts/). Decisions: [docs/DECISIONS.md](./docs/DECISIONS.md).

Team members coordinate tasks, branches, and reviews themselves. Agents do the work they are asked to do; there is no board, role sheet, handoff, or standup process to follow.

## Site and science goal (Gale / Mount Sharp)

- **Site:** Gale crater / Mount Sharp (Curiosity). Curiosity entered the boxwork unit (Altadena member) on lower Mount Sharp on Sol 4534 (May 2025) at about 4.80°S, 137.39°E, and was at about 4.83°S, 137.39°E on Sol 5070 (10 November 2026), from NASA's waypoint file. Orbital mapping shows boxwork exposed for about 14 km west of the traverse. [Siebach et al. overview](https://hal.science/hal-05494691)
- **Science goal (12 November 2026 decision):** plan a short walk whose **primary** stops support **ancient lake sediments and habitability / biosignature potential (organics in mudstones)**. The boxwork unit is a **bonus stop**. Curiosity's boxwork work remains useful context: ridges ~5 m wide and hollows 10–20 m across and 1–2 m deep; ridges rich in phyllosilicates, hollows containing siderite. [Altadena Member paper](https://doi.org/10.2110/sepmmisc.26.066) · [NASA press release](https://www.nasa.gov/missions/mars-science-laboratory/curiosity-rover/nasas-curiosity-mars-rover-starts-unpacking-boxwork-formations/). Exact lake-sediment outcrop names and coordinates are **not locked in this file** — choose them against official NASA / Curiosity sources and the 13 November Resources tab (**UNVERIFIED** until then), inside the DTM footprint already checked below. Do not invent outcrop IDs or mineral detections.
- **Terrain:** HiRISE 1 m DTMs cover the site. [DTEEC_019698](https://hirise-pds.lpl.arizona.edu/PDS/DTM/ESP/ORB_019600_019699/ESP_019698_1750_ESP_019988_1750/DTEEC_019698_1750_019988_1750_U01.IMG) covers 4.73–5.04°S, 137.31–137.44°E (includes the traverse). [DTEEC_001488](https://hirise-pds.lpl.arizona.edu/PDS/DTM/PSP/ORB_001400_001499/PSP_001488_1750_PSP_001752_1750/DTEEC_001488_1750_001752_1750_U02.IMG) covers 4.72–4.95°S, 137.24–137.35°E (west of the traverse). That DTM comes from stereo pair PSP_001752_1750 (10 December 2006). NASA's boxwork picture [PIA26306](https://science.nasa.gov/photojournal/hirise-views-mount-sharps-boxwork/) is dated the same day; a [search result](https://www.uahirise.org/PSP_001752_1750) ties PIA26306 to that observation. Confirm in [HiView](https://www.uahirise.org/hiview/) that the boxwork is inside the footprint before committing.
- **Framing caveat:** Gale is a rover site, not a human landing candidate. Frame the product as "if a crew visited where Curiosity studied Mount Sharp."
- **Backup:** Jezero crater / Perseverance only if the locked Mount Sharp stops cannot be placed inside the DTM footprint (unlikely given DTEEC_019698). Concept C (Protonilus Mensae) remains a poor fit (no rover ground truth).

Indicative (not validated) terrain notes from the 11 November 2026 planning check: in a 1 km × 7.4 km strip of DTEEC_019698 (about 4.79–4.81°S), 32% of valid 1 m pixels were steeper than 20° and 46% steeper than 15° (median 14°). The 1 m DTM under-reads local slope versus rover-reported tilts (4–10° under the rover vs 9–17° reported at four boxwork Sols — a steady offset, so relative slopes are still usable, but add a safety margin and say so). *(14 Nov MUST-03 follow-up: over 176 Curiosity waypoints at ~5 m resolution in `tilt-check.json`, DTM slope matched rover tilt only weakly — medians 9.0° vs 8.6°, no systematic under-read — so keep a safety margin and state weak correlation rather than an under-read.)* About a quarter of that sampled strip had no-data pixels (shares above are on valid pixels only). The 1 m DTM barely resolves 5 m ridges — use the 25 cm orthophoto to see them.

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
| Curiosity proposed path up Mount Sharp | Route-story reference only — not a data pipeline | [Curiosity’s proposed path up Mount Sharp](https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/) (provisionally official (official pages read 13 Nov with an unverified certificate via curl -k; confirm with a cert-valid fetch on 14 Nov 08:00)) |
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

## Stack

- **Preprocessing:** Python plus GDAL command-line tools, with `rasterio`, `numpy`, `scikit-image`, `shapely` / `geopandas`. Output only small files: cropped slope/hazard previews, route GeoJSON, a few JSON tables, a height preview for the 3D view.
- **2D planner:** a static [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) map (Leaflet only if MapLibre fails). Base layers from Mars Trek WMTS (CTX, THEMIS, MOLA). Local layers: HiRISE / hazard / route / stops. The planner **sends the route** to the 3D view (`mm:set-route`; see [ROADMAP.md](./ROADMAP.md) §3).
- **3D + helmet HUD (MUST):** first-person terrain, default [three.js](https://threejs.org/) heightmap. MUST HUD fields: distance, slope, next stop. The suit O₂ gauge was removed from the visor on 15 November 2026; if it comes back, label it an illustrative placeholder.
- **Optional APIs:** Thin local endpoints are fine, but **static JSON fallbacks are required** (`data/processed/` first, then `docs/contracts/`).
- **Panels (SHOULD):** elevation/slope profile, rover POV at stops, dose/time card, DONKI space-weather banner, weather / thermal toggles.
- **Hosting:** static files plus optional local API. Pre-download and cache everything the demo needs so it works offline. Size target: under ~100 MB of static files.
- **Stretch only (hours 32–40):** WebXR headset mode; paired rover path. Nothing new after hour 40.

## Slope / hazard cost map and routing

1. Resample the DTM to 2–5 m cells (average blocks). The 1 m terrain model has stereo noise; averaging to 5 m changed the share of steep pixels from 32% to 26% (>20°) in the planning test strip.
2. Slope with `gdaldem slope` (see [gdaldem](https://gdal.org/en/stable/programs/gdaldem.html)); roughness / TRI with `gdaldem roughness` or `TRI`.
3. Obstacles: treat no-data cells and slope above the limit as blocked. Add ridge walls and boulder fields from the 25 cm orthophoto (simple bright/dark texture or edge density, or hand-drawn polygons for the demo). Automatic boulder detection is a stretch.
4. Suggested cost per cell (tune on the real data): `cost = step_length × (1 + (slope / 10°)² + k_rough × roughness)`; `cost = ∞` if slope > limit.
5. Search: 8-neighbour **Dijkstra / A\*** on the grid. Python has [`skimage.graph.route_through_array`](https://scikit-image.org/docs/stable/api/skimage.graph.html), which does this in a few lines. Run it between stops: habitat / start → lake-sediment / mudstone stops → boxwork bonus → back. Always also write a static `route.json` so the demo works if a routing API is down.
6. Output: route as GeoJSON, plus a profile (distance vs elevation vs slope), totals (distance, climb, placeholder time), and HUD telemetry samples. Dose is computed from the duration (see the radiation section).

Slope limits are **illustrative lunar numbers**, not a Mars-specific limit (none was found in the planning note). NASA's [Exploration EVA Concept of Operations](https://www.nasa.gov/wp-content/uploads/2020/01/topic_1-_eva_lunar_surface_concept_of_operations.pdf) describes astronauts walking up/down/across a slope of up to 20° and traverses of up to 2 km away from the lander, with EVAs of up to 8 hours (6±2 h typical); Apollo 15 crossed ~17° slopes. A published traverse planner ([LPSC 2023 abstract 1413](https://www.hou.usra.edu/meetings/lpsc2023/pdf/1413.pdf)) used Dijkstra on a 5 m raster, minimising cumulative slope with a penalised 15° per-pixel threshold, and treated 2 km as a walking-EVA radius. Mars gravity and suit weight differ, so say these are stand-ins. Suggested colours: green ≤ 10°, amber 10–15°, red 15–20°, blocked > 20°, with a toggle for the stricter 15° limit. Walking-speed formulas (for example Tobler's hiking function) are Earth hiking assumptions and must be labelled as placeholders.

## Radiation dose budget and DONKI alerts

Over a ~10 km walk the galactic cosmic-ray dose rate hardly changes with place; it changes with **time** (solar cycle, solar particle events) and **shielding** (habitat/rover vs open ground). Do not invent a "radiation map" of rocks.

- Baseline: Curiosity's RAD measured about **0.64 ± 0.12 mSv/day** (dose equivalent, galactic cosmic rays) in its first ~300 sols, at the Gale crater elevation (about −4.4 km MOLA). [Hassler et al., Science 2014](https://www.science.org/doi/10.1126/science.1244797)
- Dose budget: dose ≈ baseline rate × EVA duration (duration comes from the route/speed). Add a space-weather banner from DONKI WSA-Enlil runs that list Mars in the impact list, and show the baseline from the real RAD tables for the actual Sols.
- Stretch (label "illustrative"): a sky-view factor raster from the DTM (how much sky a point sees) as a crude proxy for how much natural shielding terrain gives.


## Repo layout

```
data/raw/                     # originals; gitignored, never commit
data/processed/terrain/       # terrain products
data/processed/routing/       # route, stops, HUD telemetry
data/processed/science/       # DONKI, REMS, RAD, POV, THEMIS, CRISM caches
data/demo/                    # demo-safe fixtures (no network)
pipeline/                     # Python / GDAL preprocessing
web/app.js, web/index.html    # entry point, views, modals, right-click menu
web/planner/                  # 2D MapLibre planner
web/hud/                      # 3D first-person view + helmet HUD
web/orbit/                    # Mars globe orbit view
web/map/                      # map adapters, DEM sampler, terrain engine
web/physics/                  # Mars gravity, suit, terramechanics
web/shared/                   # data loader, route bridge, multiplayer, dev settings
web/tests/                    # node --test suites
web/vendor/                   # three.js, MapLibre (do not edit)
docs/contracts/               # example JSON shapes + CHANGES.md
scripts/                      # local server and start script
skills/                       # agent skills (includes hud-3d)
```

## Conventions

- English for code identifiers and commit messages. User-facing copy may be English and Turkish (the app has an EN / TR switch); keep source citations in English.
- Cite every data source and the date it was fetched. Keep the sources list in the product (Sources & Honesty modal) and the submission.
- Prefer small derived products over committing raw rasters (`*.tif`, PDS `.IMG`, JP2, and `data/raw/` are gitignored).
- Use a Mars radius for distances; keep coordinates as Mars lat/lon consistent with Trek / WMTS tiles.
- Be honest in the UI and on slides: lunar slope limit used as a stand-in; DTM slope matches rover tilt only weakly (~5 m medians 9.0° vs 8.6°), so keep a safety margin; radiation is mostly a time problem; list data sources and dates.
- Walking time (and suit O₂, if shown) are **illustrative placeholders** and must be labelled as such. The same goes for procedural terrain away from the Gale HiRISE tile.
- Aim for 3+ data types from 3+ missions (for example HiRISE image + DTM slope [MRO]; THEMIS thermal [Odyssey]; CRISM spectral [MRO]; Curiosity REMS/RAD [MSL]; DONKI space weather). The challenge text suggests this; it is not a hard rule.
- Rover point-of-view images are encouraged so the explorer knows what to expect.
- `?demo=1` (demo-safe) must make **zero network requests**. Static JSON fallbacks are required for anything a live API provides.
- If you change a field name, meaning, or file under `docs/contracts/`, update the example JSON, add a row to [docs/contracts/CHANGES.md](./docs/contracts/CHANGES.md), and update matching `data/processed/` and `data/demo/` fixtures in the same commit.

## How to run

1. Install Node (or Python 3 for a plain static server). For the data pipeline: Python 3 and GDAL (with OpenJPEG for JP2).
2. Copy `.env.example` to `.env` and set `NASA_API_KEY` (free key from [api.nasa.gov](https://api.nasa.gov/); never commit it). Refuse `DEMO_KEY`.
3. Start the app: `scripts/start-app.sh` (or `node scripts/server.mjs`), then open `http://localhost:8000/web/` (`?demo=1` for offline demo-safe mode). The planner loads `data/processed/` and falls back to `data/demo/` and `docs/contracts/`.
4. Check changes: `node --check` on edited JS files and `node --test web/tests/*.test.mjs`.
5. Keep static files under ~100 MB if possible. A live API is optional and must not be required on stage.

## Rules (must follow)

1. **No secrets.** The NASA API key lives only in the environment variable `NASA_API_KEY` (and a local, gitignored `.env`). `.env.example` may contain placeholder names only (including `DEMO_SAFE`).
2. **No photos, video, voices or likenesses of under-18s** in the demo or submission. Prefer screen recording plus captions. Any file in the repo that names a team member uses a **first name or nickname only** — no phone numbers, emails, addresses, school names, or other personal data. The [official terms](https://www.spaceappschallenge.org/legal/) (updated 7 August 2026) require under-18s to be registered and accompanied by a parent or legal guardian.
3. **Cite data sources** in the product and the submission. Do not invent facts, outcrop IDs, or mineral detections. Mark gaps **UNVERIFIED**.
4. **Keep this repository private.** Do not make it public and do not connect hosting, billing, or deployment integrations.
5. **Git:** never commit `.env` or a real key; never force-push `main`. Commit or push only when the person you are working with asks.
6. **AI use:** the official FAQ says each submission must describe how AI tools were used. [docs/AI_USE.md](./docs/AI_USE.md) holds that description; keep it accurate when asked.
7. Past-year judging categories (impact, creativity, validity, relevance, presentation) are **UNVERIFIED** for 2026; see [docs/JUDGING_CHECKLIST.md](./docs/JUDGING_CHECKLIST.md).

## Submission

Official window, from the [2026 landing page](https://www.spaceappschallenge.org/2026/): opens Saturday 14 November 09:00 and closes Sunday 15 November 23:59 **local event time**. Submit early on the Team page's Project tab. **Nothing new after hour 40**; freeze, then record the video (planned 30 s, official length **UNVERIFIED**; no under-18 faces or voices) and make slides. Keep a backup recording. Be honest on slides (lunar slope stand-in, weak DTM–tilt match, radiation is a time problem, O₂ and walk time are placeholders).

## Open questions

- Exact locked outcrop names and coordinates for the stops (choose against official NASA sources; must sit inside DTEEC_019698). Stops stay marked as examples until then.

## Sources (checked 11 November 2026)

[Official challenge](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/) · [Official FAQ](https://www.spaceappschallenge.org/resources/participant-faqs/) · [NASA boxwork release](https://www.nasa.gov/missions/mars-science-laboratory/curiosity-rover/nasas-curiosity-mars-rover-starts-unpacking-boxwork-formations/) · [HiRISE boxwork image](https://science.nasa.gov/photojournal/hirise-views-mount-sharps-boxwork/) · [Sol 4553 blog](https://science.nasa.gov/blog/sol-4553-back-to-the-boxwork/) · [HiRISE DTM index](https://hirise-pds.lpl.arizona.edu/PDS/INDEX/DTMCUMINDEX.TAB) · [ODE REST](https://oderest.rsl.wustl.edu/) · [Mars Trek](https://trek.nasa.gov/mars/) · [NASA lunar EVA ConOps](https://www.nasa.gov/wp-content/uploads/2020/01/topic_1-_eva_lunar_surface_concept_of_operations.pdf) · [LPSC 2023 #1413](https://www.hou.usra.edu/meetings/lpsc2023/pdf/1413.pdf) · [Hassler et al. 2014](https://www.science.org/doi/10.1126/science.1244797)
