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
- *(All fetch dates: 11–14 November 2026; works 100% offline via `?demo=1` fixtures.)*

---

## Slide 4 — Hazard Cost Map & Optimal A* / Dijkstra Routing
- **Terrain Pipeline (`pipeline/terrain/` & `pipeline/routing/`):**
  1. Resample 1 m HiRISE DTM to 2–5 m cells to suppress stereo noise (reducing >20° noise share from 32% to 26% in our planning strip).
  2. Compute slope (`gdaldem slope`) and roughness / TRI (`gdaldem roughness`), masking no-data cells (~25% of raw strip) and slopes above threshold as impassable (`cost = ∞`).
  3. Minimize step cost `step_length × (1 + (slope / 10°)² + k_rough × roughness)` across 8 neighbours (`skimage.graph.route_through_array`) using Mars radius (**3,389.5 km** mean / **3,396.19 km** equatorial).
- **Visual:** Slope/hazard map showing Green (≤10°), Amber (10–15°), Red (15–20°), Blocked (>20°), and the computed safe loop connecting Habitat → Mudstone stops → Boxwork bonus → Habitat.

---

## Slide 5 — 2D MapLibre Planner → 3D First-Person Helmet HUD
- **Seamless Two-View Architecture (`web/planner/` + `web/hud/`):**
  - **2D Planner:** Layer toggles (CTX, THEMIS thermal, HiRISE hazard mask, 15°/20° threshold), stop inspector with Curiosity POV stills, elevation/slope profile.
  - **Browser Route Bridge (`mm:set-route`):** Clicking *Start EVA* sends the GeoJSON route and profile directly into the **three.js 3D first-person terrain visor**.
  - **Helmet HUD Readouts:** Distance (travelled / to next stop), real-time slope angle & colour class, next stop cue, and suit O₂ % bar.
- **Resilience:** Loads `data/processed/` first, falls back to `docs/contracts/`, and locks to local `data/demo/` in `?demo=1` offline stage mode.

---

## Slide 6 — Radiation Dose Budget, Space Weather & Scientific Honesty
- **Time-Based Radiation Model (Not a Fake Rock Map):**
  - Galactic Cosmic Ray dose does not vary meaningfully across a 10 km walk; it varies with **time** and **shielding**.
  - `EVA Dose = RAD Baseline (0.64 ± 0.12 mSv/day) × EVA Duration`, paired with a **DONKI WSA-Enlil** banner alerting the crew to predicted CME/SEP arrivals at Mars.
- **Transparent Scientific Caveats (Shown in UI & Docs):**
  - **Slope thresholds (15° / 20°):** Stand-ins from NASA's *Lunar Exploration EVA Concept of Operations* and LPSC 2023 #1413 (no Mars-specific suit slope limit is published).
  - **DTM vs. Rover Tilt:** The 1 m HiRISE DTM under-reads local slope vs. Curiosity's onboard tilt sensors (4–10° DTM vs. 9–17° rover tilt at four boxwork Sols) — we apply a conservative margin and report the offset.
  - **Suit O₂ & Walk Speed:** Explicitly labelled as **illustrative placeholders** (linear O₂ drain / Earth hiking speed).

---

## Slide 7 — Impact, Verification & AI/SI Tool Disclosure
- **Why It Matters:** Bridges orbital planetary GIS and human-scale surface operations with an honest, offline-ready open architecture.
- **Verification Summary:**
  - Route verified inside `DTEEC_019698` footprint; zero blocked/no-data crossings; offline `?demo=1` network-off check passed.
- **AI / SI Tools Disclosure (per NASA Space Apps guidelines):**
  - The project concept, site choice, and scientific framing were created by the human team.
  - AI coding assistants (Grok Bot, Gemini / Antigravity, Claude) were used for documentation scaffolding, data pipeline scripts, and UI implementation, with all changes logged in `docs/coordination/AGENT_LOG.md` and `docs/AI_USE.md`. No NASA logos or branding were generated or modified by AI.
