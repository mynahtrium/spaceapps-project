# Martian Mappers: judging dump and 7-slide deck source

Everything a judge, presenter or slide-maker needs about the project, in one place: both branches, how it works, the data, the numbers, the limits, and a slide-by-slide outline with speaker notes. Paste-ready submission fields are in [SUBMISSION.md](./SUBMISSION.md). No team member is named (team members are minors).

Facts are taken from the repository on 15 November 2026: branch `main` at `a72e39f`, branch `prototype` at `c6d9d78`, and the data files cited inline. Numbers marked *(computed)* were produced by the app on the Gale preset with default planner inputs.

---

## 1. One-line pitch

**Plan a walk on Mars before anyone goes there:** a map-based EVA planner that routes astronauts around dangerous slopes on real NASA terrain, checks the plan against daylight, distance and radiation limits, and lets you walk or drive the route in 3D on 1-metre HiRISE ground.

Challenge: NASA Space Apps 2026, [Interplanetary Survival Guide: Martian Map](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/). The brief asks for a map or tool a Mars astronaut could use on a surface walk, layering data from several NASA missions, with safety and a route in mind.

---

## 2. The two branches: what each one is

The project was built in two stages. Both are in the public repository.

### `main`: the 48-hour immersive EVA simulator (a72e39f)

- **Built:** 12 to 15 November 2026, 230 commits; most work on 14 November (139 commits) and 15 November (83).
- **Size:** about 39,200 lines of browser JavaScript (excluding vendored three.js).
- **Data and route:**
  - A Python/GDAL pipeline turns a 1 m HiRISE DTM into slope, a cost map and a Dijkstra walking route.
  - The real HiRISE corridor terrain (DTEEC_009149, 2.1 × 5.4 km at 1 m) is streamed in 168 chunks around the walker.
- **3D experience:** a first-person "helmet HUD" walk on that terrain, with:
  - Mars gravity and suited-walking physics
  - a drivable pressurized rover (MMSEV)
  - five historic NASA rovers to visit
  - a habitat, an NPC crew with dialogue, and a landing cinematic
  - procedural audio and music
  - LAN multiplayer
  - controller and touch support
  - a GPU ray-tracing experiment
- **Orbit view:** a Mars globe (Viking and MOLA mosaics) with a real day/night line, Phobos and Deimos, and land-anywhere.
- **Science data:** a DONKI space-weather banner, a RAD dose estimate, REMS weather and Curiosity POV images.
- **Its strength:** immersion, and the corridor terrain and Mars24 sun were real.
- **Its weakness:** a lot of what you saw was invented or tuned for looks rather than measured:
  - the world outside the corridor was a mirror copy
  - the crater rim and Mount Sharp on the horizon were drawn from sine waves
  - other landing sites used procedural terrain
  - rocks and ground texture were noise
  - walking time and suit O₂ were placeholders
  - three different rover specs disagreed with each other
  - the 2D planner had been removed

### `prototype`: the refocused planning tool on real data (c6d9d78)

- **Goal:** a tool an astronaut or mission planner could actually use, built only on real, cited data. The game parts were removed and a **planning mode** was added.
- **Size:** about 16,300 lines of browser JavaScript, 59 % smaller than `main`. The diff against `main` is 131 files, +12,854 / −36,203 lines.
- **Commits:** 21 commits on top of `main`. The last one ("turn the EVA game into a Mars EVA planning tool on real data") does most of the refocus.
- **Kept from `main`:**
  - HiRISE corridor streaming
  - Mars24 sun and ephemerides
  - the star catalogue
  - atmosphere haze
  - post-processing
  - walker and vehicle physics
  - the globe
  - the data pipeline and all cached NASA data
- **Removed:**
  - NPCs, audio, the landing cinematic and multiplayer
  - the habitat, historic rovers and landers, and the second rover
  - the astronaut body
  - procedural rocks, horizon and ground, and the mirrored terrain
  - the synthetic terrain fallback
  - 14 npm packages
- **New:**
  - the **Plan** view (map, stops, slope-aware routing, mission timeline, constraint checks, JSON import/export)
  - a lean **Rehearse 3D** view (1 m HiRISE plus a real MOLA horizon, SEV driving)
  - a **Sources & limits** panel
  - planner unit tests
- **Bug fixed on the way:** facing north in 3D turned the whole screen blank. The cause was invalid (NaN) pixels from a bump-mapped rover tyre, which the bloom effect spread over the whole frame. A guard pass before bloom now removes NaN and infinite values.

**How to say it in one sentence:** *"We first built an immersive simulator, then rebuilt it into a planning tool where every number is either NASA data, a cited source, or a value the planner types in."*

---

## 3. What the prototype does (feature list)

### Plan view (the default screen)
- **Map:** Mars in its native equirectangular frame (planetocentric, east-positive). The scale bar and distances use the Mars mean radius, 3,389.5 km.
- **Layers:**
  - **Online only:**
    - CTX global mosaic, about 5 m (Murray Lab / Caltech, via Esri OnMars)
    - Viking MDIM 2.1 colour, 232 m (NASA Mars Trek)
    - THEMIS Day IR, 100 m (Mars Trek)
  - **Bundled, so they also work offline:**
    - Viking and MOLA-shaded global mosaics
    - HiRISE orthoimage of the Gale corridor
    - slope tiers computed in the browser from every HiRISE DTM
- **Hover readout:** latitude and longitude, elevation, slope, and the name and resolution of the data set under the cursor.
- **Stops:** click to add. Each has a name, a type (start / science / rover / return) and a time at the stop. Stops can be reordered and deleted.
- **Legs:**
  - Each leg is either walk or drive (SEV).
  - **Routing:** A* search on the finest real elevation grid that contains the leg:
    - Gale: HiRISE DTEEC_009149 block-averaged to 5.06 m (409 × 1,075 cells).
    - Jezero, Gusev, Meridiani, Elysium and Ares Vallis: HiRISE DTM windows at about 2 m (about 990 × 990 cells, 2 km).
    - Everywhere else: a window of MGS MOLA at 8 px/deg (about 7.4 km), flagged as too coarse for EVA-scale hazards.
  - **Cost** of a step = length × (1 + (slope / 10°)²); cells steeper than the limit are blocked. This is the same formula as the Python pipeline.
- **Outputs:**
  - total distance (walk / drive), ascent and descent
  - EVA duration, and a dose estimate
  - elevation profile coloured by mode
  - timeline: arrival time, local true solar time (LTST) and sun elevation at every stop (Mars24)
  - issues list
- **Constraint checks:**
  - grade above the limit (red) or in the caution band (amber)
  - arrival with the sun below the horizon
  - EVA longer than the limit set for the plan
  - walking further from the last refuge (rover or start) than the walk-back limit
  - legs not yet routed, legs routed on coarse MOLA, and gaps in the elevation data
- **Mission file:** JSON (contract `martian-mappers.mission.v1`), with export and import. The plan is also saved in the browser.
- **Gale preset:** four real Curiosity waypoint coordinates:
  - EVA start, Sol 4527 waypoint
  - Glen Etive 1 drill site
  - Mary Anning 3 drill site
  - boxwork unit, Sol 4534 waypoint
  - plus a return to the start.

### Globe view
- Mars globe with Viking colour and MOLA relief, the real subsolar point (Mars24), and Phobos and Deimos from JPL mean elements.
- Clicking a point opens the planner centred there.

### Rehearse 3D view
- **Ground:** HiRISE DTM DTEEC_009149 at 1 m, streamed in 128 × 128 m meshes around you, with the 25 cm orthoimage shown at about 0.5 m.
- **Horizon:** MGS MOLA out to 70 km, with Viking colour. The real Gale crater rim and Mount Sharp stand on the horizon, and the surface curves on the 3,389.5 km sphere.
- **Sky:**
  - sun position and intensity from Mars24 for the mission date at the site
  - Phobos and Deimos at their true angular size (Thomas 1989 radii, USGS maps)
  - night stars from the Yale Bright Star Catalogue
- **Walker:**
  - Mars gravity varies with latitude and elevation.
  - It jumps under real g and steps onto ledges up to 0.45 m.
- **SEV pressurized rover:**
  - the NASA 3D Resources MMSEV model, scaled to the fact sheet's 14.7 ft (4.48 m)
  - top speed about 10 km/h
  - E to get in or out, chase camera
- **HUD:**
  - position, elevation (MOLA areoid) and which data set is under you
  - LTST, Ls (season), and sun elevation and azimuth
  - heading, slope with its tier
  - progress along the route, distance off the route, and the next stop with its straight-line and by-route distance and bearing
  - EVA clock and dose
  - DONKI and REMS lines
- The planned route is drawn on the ground, and stop markers carry labels.

### Works offline
`?demo=1` loads only bundled files, so a stage demo never depends on a live API. In that mode the live map layers (CTX, Viking tiles, THEMIS) are switched off, and the bundled mosaics are used instead.

---

## 4. Architecture

```
NASA PDS / Mars Trek / mars.nasa.gov / api.nasa.gov
          │  (Python 3 + GDAL / rasterio / NumPy, pipeline/)
          ▼
pipeline/terrain   HiRISE DTM → corridor chunks (1 m, uint16 delta-gzip), overview (8 m), slope, cost map
pipeline/routing   Dijkstra route on the cost map; stops from Curiosity waypoints
pipeline/globe     MOLA MEGDR → 8 px/deg grid; Viking / MOLA mosaics from Trek tiles
pipeline/data      DONKI, REMS feed, RAD baseline, THEMIS/CRISM indexes, Curiosity raw images
          │
          ▼
data/processed/  →  data/demo/ (frozen offline copies)       ← the browser reads these only
          │
          ▼
web/ (static ES modules, no bundler, Node static server scripts/server.mjs)
  app.js                 shell: Plan · Globe · Rehearse 3D · Sources & limits
  planner/map2d.js       equirectangular map engine (tiles, images, canvas overlays, pan/zoom)
  planner/routing.js     slope grid, A* search, MOLA windows, Mars distance (pure, tested)
  planner/mission.js     mission model, timeline, checks, dose (pure, tested)
  planner/terrain-sources.js  loads Gale 5 m, 5 site DTMs, MOLA; picks the finest grid per leg
  planner/planner-view.js     UI
  eva/terrain.js         HiRISE chunks + overview + MOLA far ring, curvature, haze
  eva/sky.js             sky dome, Phobos/Deimos
  eva/eva-view.js        walker, SEV, HUD, route drape
  hud/MarsEphemeris.js   Mars24 sun, Ls, LTST, moons, stars
  physics/*              Mars gravity field, walker, vehicle dynamics
  orbit/orbit-view.js    globe
```

- **Tests:** 82 automated tests (`node --test web/tests/*.test.mjs`), all passing on `prototype`. They cover:
  - planner routing (detour around a ridge, no path, Mars radius)
  - mission maths (time, dose, SEV speed, the four checks, JSON round-trip)
  - corridor streaming and stop heights
  - walker and vehicle physics
  - ephemeris
  - geodesy
  - the server's dotfile protection
  - the import map
- **Pipeline tests:** in `pipeline/tests/`.

---

## 5. Data used (with what it is used for)

| Data | Mission / source | Resolution | Used for |
|---|---|---|---|
| HiRISE DTM DTEEC_009149_1750_009294_1750_U01 | MRO HiRISE (U. Arizona), PDS | 1.01 m posts | 3D ground; 5 m planner grid; cost map |
| HiRISE ortho PSP_009149_1750_RED_A_01_ORTHO | MRO HiRISE | 25 cm | 3D ground imagery (at ~0.5 m), planner overlay |
| HiRISE DTMs at Jezero, Gusev, Meridiani, Elysium, Ares Vallis | MRO HiRISE, PDS | ~2 m (2 km windows) | Planner routing and slope at those sites |
| HiRISE DTM DTEEC_019698 | MRO HiRISE | 1 m (5 m crop) | Slope statistics, rover tilt check |
| MOLA MEGDR megt90n000eb | MGS MOLA, PDS Geosciences | 16 → 8 px/deg (~7.4 km) | 3D horizon (Gale rim, Mount Sharp); routing elsewhere |
| Viking MDIM 2.1 colour | Viking / USGS via Mars Trek | 232 m (tiles); 5 km (bundled) | Globe, planner base, far-terrain colour |
| MOLA colour shaded relief | MGS via Mars Trek | 463 m | Globe, planner layer |
| CTX global mosaic | MRO CTX (Murray Lab) via Esri OnMars | ~5 m | Planner base map (online) |
| THEMIS Day IR | Mars Odyssey via Mars Trek | 100 m | Planner layer (online) |
| MSL waypoints | Curiosity, NASA Mars Maps | — | Stop coordinates; DTM registration |
| REMS daily weather | Curiosity (NASA / CAB) | daily | Weather line (latest sol, labelled) |
| DONKI WSA-Enlil, CME, SEP, GST | NASA CCMC via api.nasa.gov | — | Space-weather banner |
| RAD surface dose | Curiosity, Hassler et al. 2014 | 0.64 ± 0.12 mSv/day | Dose = rate × EVA time |
| Mars24 algorithm | NASA GISS, Allison & McEwen 2000 | — | Local time, sun position, Ls |
| Phobos / Deimos mean elements | JPL SSD | — | Moon positions |
| Phobos / Deimos maps | USGS (Viking, DLR control) | 40 px/deg | Moon surfaces |
| Yale BSC / HYG | catalogues | ~3,000 stars | Night sky |
| EVA Lunar Surface ConOps | NASA | — | Slope limits 10 / 15 / 20° (stand-ins) |
| SEV fact sheet FS-2011-08-045-JSC | NASA JSC | — | Rover ~10 km/h, 6,600 lb, 14.7 ft; walk-back about 6 miles |
| MMSEV 3D model | NASA 3D Resources | — | Rover model |

**Missions represented:** MRO (HiRISE, CTX), MGS (MOLA), Mars Odyssey (THEMIS), Viking, MSL Curiosity (waypoints, REMS, RAD), plus the NASA CCMC space-weather models.

**Also fetched by the pipeline but not drawn yet:**
- CRISM MTRDR product records
- THEMIS Night IR
- the full REMS archive and the RAD archive (the PDS servers failed TLS or reset the connection on 14 November)
- the Curiosity traverse and raw images

**Offline data size:**
- `data/demo/corridor`: 14 MB (336 files)
- `data/demo/sites`: 8.9 MB
- `data/demo/globe`: 5.2 MB
- `web/assets`: 35 MB

---

## 6. Methods worth explaining to judges

1. **Registering HiRISE to the rover.**
   - The HiRISE DTM and Curiosity's own position solutions disagree by tens of metres.
   - We fitted a constant shift (−60 samples, +14 lines) to 478 Curiosity waypoints.
   - The standard deviation fell from 6.24 m to **2.35 m**.
   - So the stops in the planner and in 3D sit where the rover actually was.
2. **Checking the terrain against the rover.**
   - HiRISE slope at 5 m was compared with Curiosity's measured tilt at **176 waypoints** (Sols 4400–5073).
   - Medians were 9.0° (DTM) against 8.6° (rover): no systematic under-reading at this scale.
   - But the correlation is weak (r ≈ 0.15), and rovers choose gentle ground, hence the safety-margin message.
3. **Slope-aware routing.**
   - A* over 8-connected cells. Cost = step length × (1 + (slope/10°)²), and cells over the limit are blocked.
   - Each leg is routed on the finest grid containing both ends.
   - The coarse MOLA fallback is clearly flagged.
   - A test proves it detours through a gap rather than crossing a 40°+ ridge.
4. **Mission timeline.**
   - Arrival times come from leg length ÷ speed plus the time at each stop.
   - Speed is the SEV's cited 10 km/h for drive legs, and the planner's own pace for walking.
   - The sun at each arrival is computed with Mars24 for that date and place.
5. **Radiation as a time problem.**
   - Dose = 0.64 mSv/day (Curiosity RAD, Hassler 2014) × EVA time.
   - It is never drawn as a map, because galactic cosmic-ray dose doesn't change over a few kilometres.
   - Solar events come on top (DONKI).
6. **A real horizon.**
   - Instead of painted mountains, the 3D view loads MOLA out to 70 km and drops vertices by d²/2R for Mars's curvature.
   - The real Gale rim and Mount Sharp therefore appear where they really are.

---

## 7. Results on the Gale preset *(computed)*

- **Inputs:** start 15 November 2026, 19:46 UTC; walking pace 2.0 km/h (planner input); 30 min at each science stop.
- **Route:** all legs routed on the HiRISE 5 m grid. **10.03 km** walked, **+516 m / −516 m**.
- **Duration:** **6 h 31 min** (5 h 01 min walking).
- **Dose:** **0.174 mSv** (galactic cosmic-ray baseline only).
- **Issues found:**
  - the grade reaches **19.4°** on the way to Glen Etive 1 and **18.6°** on the way to the boxwork (caution band)
  - the crew would arrive after sunset at all four later stops: the start time was 16:37 LTST, which is too late
  - the walk exceeds the **9.7 km** walk-back limit
- **What a planner would change:** start in the local morning, or drive the SEV for the long northbound leg.
- **Corridor slope statistics (5 m):**
  - median slope **10.3°**
  - **30.5 %** of cells steeper than 15°
  - **19.3 %** steeper than 20°
  - This terrain needs routing, not a straight line.

---

## 8. Honesty and limits (say these out loud)

- **Slope limits:** green ≤ 10°, amber 10–15°, red 15–20°, blocked > 20°. These are NASA *lunar* EVA ConOps values used as stand-ins, because no Mars limit is published.
- **DTM against rover:** DTM slope matches Curiosity's tilt only weakly, so keep a safety margin.
- **Radiation:** it is a time problem, not a place problem. Dose counts the baseline only, with solar events on top.
- **Planner inputs, not data:**
  - walking pace (no validated Mars suited-walking speed is published; NASA studies give a regression model, not a single speed)
  - time at each stop
  - the EVA time limit
- **Coarse areas:** outside HiRISE DTMs only MOLA exists (about 7.4 km), so routes there are flagged as unsuitable for EVA-scale hazards.
- **Labelled rendering choices:**
  - HiRISE imagery colour is a tint over the greyscale RED band
  - the sky colour is a rendering with a fixed dust optical depth (τ = 0.5)
- **Gale is a rover site,** not a human landing candidate.
- **Not ready yet** (on the roadmap):
  - the rover physics still carries a 2.25× power and torque tuning factor from the game version
  - Phobos and Deimos use mean elements, not SPICE
  - the globe still shows schematic orbiter tracks and some decorative background stars

---

## 9. AI use (required disclosure)

- **Tools:**
  - Claude Code (Anthropic)
  - Gemini and Google Antigravity
  - Grok in Cursor
- **Used for:**
  - documentation scaffolding
  - pipeline scripts
  - the web app
  - this refocus
  - data checks
  - drafting these documents
- **Not used for:** coming up with the challenge idea; the team chose the challenge, site and science goal.
- **Review:** every result was reviewed by the team and checked by running it, with tests, browser checks and data cross-checks.
- **Log:** the full log is in [AI_USE.md](./AI_USE.md).

---

## 10. Judging criteria mapping

The 2026 criteria names could not be read from the official guide; local-event pages list **Influence/Impact, Creativity, Validity, Relevance, Presentation** (see [JUDGING_CHECKLIST.md](./JUDGING_CHECKLIST.md)).

| Criterion | What to point at |
|---|---|
| Impact / Influence | A planner can catch a night arrival, a 19° grade and a walk-back violation before an EVA, on any site with a HiRISE DTM. |
| Creativity | One plan links an orbital map, rover ground truth and a first-person rehearsal; real horizon from MOLA instead of painted mountains. |
| Validity | Real data at every step; registration to 478 rover waypoints (2.35 m); tilt check at 176 waypoints; every limit cited or labelled; 82 tests. |
| Relevance | Exactly the brief: a map a Mars astronaut could use on a surface walk, layering five Mars missions (MRO, MGS, Mars Odyssey, Viking, Curiosity) plus NASA space-weather models, with safety and a route. |
| Presentation | 3-view flow (Plan → Globe → Rehearse), live demo works offline, Sources & limits panel in the app. |

---

## 11. Demo script (about 3 minutes, works with `?demo=1`)

1. **Plan, 0:00–0:40.**
   - Open the app and click **Gale preset**.
   - Point at the four stops: these are real Curiosity drill and waypoint positions.
   - Turn on **Slope tiers**: the corridor is about a third red.
2. **Route, 0:40–1:20.**
   - Click **Route all legs**; the lines bend around red ground.
   - Show the totals and the profile.
3. **Checks, 1:20–1:50.**
   - Read the issues: night arrival, 19.4° grade, walk-back.
   - Change the start time to local morning; the night warnings disappear.
   - Switch the long leg to **drive (SEV)**; the walk-back warning disappears.
4. **Rehearse, 1:50–2:40.**
   - Click **Rehearse in 3D**; you stand at the start.
   - Mount Sharp and the crater rim are visible from MOLA.
   - Walk a few metres: the HUD shows slope, progress and the next stop.
   - Press **E** to drive the SEV at 10 km/h.
5. **Close, 2:40–3:00.**
   - Open **Sources & limits** and say the three honesty lines: lunar slope limits, time-based dose, pace is your input.

---

## 12. Seven-slide deck outline

Rules from the team's earlier notes: English only, 7 slides including the title, no photos, voices or likenesses of under-18s, and cite data on the slides. Screenshots can be taken from the running app (`node scripts/server.mjs`, then `http://localhost:8000/web/?demo=1`).

### Slide 1: Title
- **Title:** Martian Mappers: plan a walk on Mars before anyone goes there
- **Subtitle:** NASA Space Apps 2026 · Interplanetary Survival Guide: Martian Map
- **Visual:** a split image. Left: the Plan view with the routed Gale preset. Right: the Rehearse 3D view with Mount Sharp on the horizon.
- **Speaker note:** "An EVA planner for Mars astronauts, built only on NASA data, where every number tells you where it comes from."

### Slide 2: The problem
- Walking on Mars is limited by slope, daylight, distance from a pressurised refuge, and radiation time.
- The brief: a map an astronaut can use on a surface walk, layering several missions, with safety and a route.
- Our site: Gale crater / lower Mount Sharp, where Curiosity found lake mudstones with preserved organics (Glen Torridon: Glen Etive 1, Mary Anning 3). Gale is a rover site, so the scenario is "if a crew went where Curiosity went".
- **Visual:** the HiRISE corridor with the four stops.
- **Key number:** at 5 m, 30.5 % of the corridor is steeper than 15° and 19.3 % steeper than 20°.

### Slide 3: Real data, five Mars missions
- A table or icon row:
  - MRO HiRISE (1 m DTMs, 25 cm images)
  - MRO CTX (5 m)
  - MGS MOLA (global elevation)
  - Mars Odyssey THEMIS (thermal)
  - Viking (colour)
  - MSL Curiosity (waypoints, REMS weather, RAD dose)
  - NASA CCMC DONKI (space weather)
- **Validation:**
  - HiRISE registered to 478 Curiosity waypoints (residual 2.35 m)
  - HiRISE slope checked against rover tilt at 176 waypoints (median 9.0° vs 8.6°; weak correlation, so keep a margin)
- **Visual:** layer toggles in the planner, CTX vs slope tiers.

### Slide 4: How it works
- **Pipeline:** PDS products → Python/GDAL → elevation grids, cost map, offline cache.
- **Plan:**
  - A* routing on the finest real grid per leg (5 m Gale, 2 m at five landing sites, MOLA elsewhere, flagged)
  - cost = length × (1 + (slope/10°)²)
  - timeline with Mars24 sun
  - dose = 0.64 mSv/day × time
- **Checks:** grade, night, EVA length, walk-back 9.7 km (Apollo, NASA SEV fact sheet).
- **Rehearse:** 1 m HiRISE terrain, real MOLA horizon to 70 km, SEV at 10 km/h.
- **Visual:** the architecture diagram from section 4, simplified to five boxes.

### Slide 5: Results on the Gale plan
- 10.03 km, +516 / −516 m, 6 h 31 min, 0.174 mSv.
- The tool caught:
  - a 19.4° grade
  - four arrivals after sunset (start was 16:37 local time)
  - a walk-back violation
- **Fix shown in the demo:** start in the local morning and drive the long leg in the SEV.
- **Visual:** the issues list and the elevation profile, before and after the fix.

### Slide 6: From simulator to tool (both branches)
- **`main`:** a 48-hour immersive EVA simulator (39k lines). Real corridor terrain, but a mirrored world, painted mountains, an NPC crew, sound, multiplayer.
- **`prototype`:** a refocused planning tool (16k lines). It removes everything not backed by data and adds the planner and a real horizon.
- **Honesty slide content:**
  - slope limits are lunar stand-ins
  - dose is a time problem
  - walking pace is a planner input
  - MOLA areas are coarse
  - image colour is a tint
- **Visual:** two screenshots side by side, "before / after".

### Slide 7: Impact and next steps
- **Impact:** any EVA can be checked against terrain, daylight and walk-back limits before it is flown, and the same workflow works at any HiRISE DTM site.
- **Next steps:**
  - real HiRISE colour
  - the Gale CTX/HiRISE merged DEM and HRSC-MOLA 200 m for the horizon
  - boulders mapped from HiRISE shadows
  - measured dust opacity and REMS/RAD time series
  - Phobos, Deimos and relay-orbiter passes from JPL Horizons
  - a cited suited-walking metabolic model
- **AI-use line:** "AI coding assistants helped build it; the team reviewed every result."
- **Closing line:** "Every number tells you where it comes from."

---

## 13. Questions judges may ask (short answers)

- **Why Gale and not a landing site?**
  - It has the best ground truth: Curiosity's measured positions, tilt, weather and radiation.
  - We say clearly that it is a rover site.
  - The planner also works at Jezero, Gusev, Meridiani, Elysium and Ares Vallis.
- **How accurate are the routes?**
  - As accurate as the grid: 5 m at Gale and 2 m at the landing sites.
  - Within MOLA areas they are flagged as large-scale only.
  - The slope comparison with Curiosity suggests keeping a margin.
- **Why lunar slope limits?**
  - NASA has no published Mars EVA slope limit; the lunar ConOps values are the closest documented ones.
- **Where does walking speed come from?**
  - It's the planner's input. NASA suit studies (Mark III suit, Norcross et al.) give a metabolic regression model rather than a single speed, so we don't invent one.
- **Does it need the internet?**
  - No. `?demo=1` runs from bundled data; live layers add CTX and THEMIS online.
- **Is the code open?**
  - Yes. The repository is public at https://github.com/mynahtrium/spaceapps-project, and all libraries used are open source (see LIBRARIES_CITATIONS.md).

---

## 14. Repository facts

- **Branches:** `main` (a72e39f, the simulator) and `prototype` (c6d9d78 and later, the planning tool). The team also has 16 feature branches on GitHub.
- **Run:**
  1. `npm install`
  2. `node scripts/server.mjs`
  3. open `http://localhost:8000/web/` (add `?demo=1` to run offline)
- **Test:** `node --test web/tests/*.test.mjs` (82 tests pass on `prototype`).
- **Pipeline:** Python 3 with GDAL, rasterio, NumPy and SciPy (pinned in `pipeline/requirements.txt`).
- **Key documents:**
  - [SUBMISSION.md](./SUBMISSION.md): form text and resource links
  - [DATA_SOURCES.md](./DATA_SOURCES.md)
  - [AI_USE.md](./AI_USE.md)
  - [JUDGING_CHECKLIST.md](./JUDGING_CHECKLIST.md)
