# 7-Slide Presentation Outline — Martian Mappers

**Owner:** Bug tester 2 (Eymen)  
**Purpose:** Serves both as the live pitch deck and as the **7-slide submission alternative/companion** to the ≤30 s video (provisionally official from the 13 Nov `curl -k` read of the [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/); confirm with a cert-valid fetch when available).  
**Rules:** All slide text in **English** (for Global Judging compliance), **7 slides maximum including title and intro**, no under-18 photos/likenesses/surnames, explicit scientific honesty notes and NASA data citations.

---

## Slide 1 — Title & Mission Overview
- **Title:** **Martian Mappers: Gale Crater / Mount Sharp EVA Traverse Planner & 3D Helmet HUD**
- **Subtitle:** NASA Space Apps Challenge 2026 — *Interplanetary Survival Guide: Martian Map*
- **Team:** Martian Mappers (first names / nicknames only; no personal data)
- **Visual:** Split screenshot of the 2D MapLibre planner and 3D first-person Helmet HUD at lower Mount Sharp.
- **One-line pitch:** A multi-mission web planner that computes a hazard-aware walking route across lower Mount Sharp and streams live telemetry into a 3D astronaut visor.

---

## Slide 2 — The Challenge & Our Science Goal at Mount Sharp
- **Why Gale Crater / Mount Sharp?**
  - Ground-truth laboratory: we frame the mission as *"if a human crew visited where Curiosity studied lower Mount Sharp"* (acknowledging Gale is a rover site, not a human landing candidate).
- **Primary Science Goal:**
  - **Ancient lake sediments & habitability / biosignature potential** (organics preserved in mudstones).
- **Bonus Science Stop:**
  - **Boxwork unit (Altadena member)** entered by Curiosity on Sol 4534 (~4.80°S, 137.39°E): cemented ridges (~5 m wide, phyllosilicate-rich) and hollows (10–20 m across, siderite-bearing) recording late groundwater history ([Siebach et al.](https://hal.science/hal-05494691); [Altadena Member paper](https://doi.org/10.2110/sepmmisc.26.066)).

---

## Slide 3 — Multi-Mission NASA Data Stack (5+ Layers, 4+ Missions)
- **Topography & Hazards (MRO HiRISE):** 1 m DTM (`DTEEC_019698` covering 4.73–5.04°S, 137.31–137.44°E; `DTEEC_001488`) + 25 cm orthoimage to resolve 5 m boxwork ridges and boulders.
- **Regional Context (Mars Trek WMTS):** CTX 5 m optical mosaic (MRO), MOLA 463 m shaded relief (MGS), THEMIS 100 m Day/Night IR thermal mosaics (Mars Odyssey), CRISM spectral metadata (MRO).
- **Ground Truth & Environment (MSL Curiosity):**
  - Rover waypoints & `tilt` (Sols 4534–5070) to validate orbital slope models.
  - **RAD** surface radiation baseline (**0.64 ± 0.12 mSv/day**, Hassler et al., *Science* 2014 + PDS RDR archive).
  - **REMS** surface temperature / weather windows + MSL raw camera POV stills at stops.
- **Space Weather (NASA CCMC DONKI):** Cached **WSA-Enlil** solar-wind simulations filtered for `"Mars"` in `impactList`.
- *(Fetch dates: 11–14 November 2026. Science fixtures are already in `data/demo/`. The web `?demo=1` switch is not built yet.)*

---

## Slide 4 — Hazard Cost Map & Optimal A* / Dijkstra Routing
- **What is on disk (14 Nov), say it is a first pass:**
  - HiRISE crop of DTEEC_019698, centre 4.83°S, 137.39°E (placeholder until PRE-07), ~5 m cells. Median slope 9.7°. About 28% of cells steeper than 15°, about 18% steeper than 20°. No no-data in this crop (`slope_stats.json`).
  - Example route `eva-example-pre07-scaffold-001`: 8-neighbour Dijkstra on **`docs/contracts/cost-map.json`**, not on this crop. The crop’s north edge is 4.813°S; example stops are near 4.80°S, outside it.
  - Stated length **947.1 m**. Climb null. **71 min** is an Earth-hiking placeholder. The four legs sum to 790.3 m — do not add them on the slide until Backend 2 confirms the total.
- **Visual:** `slope-preview.png` with the colour key (green ≤10°, amber 10–15°, red 15–20°, blocked >20°) and a caption that the loop is an example: Habitat → mudstone stops → boxwork bonus → habitat.

---

## Slide 5 — 2D MapLibre Planner → 3D First-Person Helmet HUD
- **Not built yet (14 Nov).** `web/planner/`, `web/hud/`, and `web/shared/` are README-only. MUST-08–10 are `todo`. This slide describes the plan. Do not show a fake screenshot of a visor.
- **Planned readouts** (the example HUD file already has one sample): distance travelled **526.1 m**, remaining **420.9 m**, next stop **boxwork bonus (example)**, slope **unknown** until the path sits on a covering DTM, suit O₂ **44.4%** with the label “illustrative placeholder”.
- **When it exists:** the planner sends the route with `mm:set-route`. Loads `data/processed/` first, then `docs/contracts/`, and only `data/demo/` in `?demo=1`. Science fixtures are already in `data/demo/`. Terrain previews and the route are not in that folder yet.

---

## Slide 6 — Radiation Dose Budget, Space Weather & Scientific Honesty
- **Time-Based Radiation Model (Not a Fake Rock Map):**
  - Galactic Cosmic Ray dose does not vary meaningfully across a 10 km walk; it varies with **time** and **shielding**.
  - `EVA Dose = RAD Baseline (0.64 ± 0.12 mSv/day) × EVA Duration`, paired with a **DONKI WSA-Enlil** banner alerting the crew to predicted CME/SEP arrivals at Mars.
- **On the dose card today:** **0.0427 ± 0.008 mSv**, from the **96 min** contract-route placeholder. The example route file says 71 min. Do not mix them until `dose.json` is rebuilt. RAD RDR tables did not load on 14 Nov (expired TLS); the baseline stays Hassler et al. 2014.
- **DONKI banner (cached, no live call on stage):** 13 WSA-Enlil runs list Mars between 2026-10-15 and 2026-11-14. Latest predicted arrival 2026-11-13T12:00Z (glancing blow).
- **Transparent scientific caveats:**
  - **Slope thresholds (15° / 20°):** Lunar EVA stand-ins (NASA Exploration EVA ConOps; LPSC 2023 #1413). No Mars-specific suit limit was found.
  - **DTM vs rover tilt (14 Nov, 176 waypoints, Sol 4400–5073):** At about 5 m, median DTM slope 9.0° and median rover tilt 8.6° (difference −0.06°). Correlation is weak (r about 0.15). This does **not** confirm the 11 Nov note that the 1 m DTM under-read tilt at four boxwork sols. Rover tilt and DTM slope are related, not the same measurement. Keep a safety margin. First pass, not a validation (`tilt-check.json`).
  - **Suit O₂ and walk time:** Illustrative placeholders (linear O₂ drain; Earth-hiking speed).

---

## Slide 7 — Impact, Verification & AI/SI Tool Disclosure
- **Why It Matters:** Bridges orbital planetary GIS and human-scale surface operations with an honest, offline-ready open architecture.
- **What is verified, and what is not (14 Nov):**
  - Example route only. PRE-07 outcrop lock is open. Stops are outside the current HiRISE cost crop. `?demo=1` has not been run: there is no web app yet. Science JSON and stills are copied under `data/demo/`.
- **AI / SI Tools Disclosure (per NASA Space Apps guidelines):**
  - The project concept, site choice, and scientific framing were created by the human team.
  - AI coding assistants (Grok Bot, Gemini / Antigravity, Claude) were used for documentation scaffolding, data pipeline scripts, and UI implementation, with all changes logged in `docs/coordination/AGENT_LOG.md` and `docs/AI_USE.md`. No NASA logos or branding were generated or modified by AI.
