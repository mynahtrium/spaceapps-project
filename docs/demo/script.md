# Live Demo Script (2–3 Minutes) — Martian Mappers

**Owner:** Bug tester 2 (Eymen)  
**Target duration:** ~2–3 minutes live walkthrough (runs in **demo-safe mode** `?demo=1` from hour 32 onward)  
**Privacy rule (mandatory):** No photos, video, voices, or likenesses of under-18s in any recording or slide.

> **Sync rule:** Keep this script strictly matched to what the app actually renders at each milestone (MUST at hour 16, SHOULD at hour 32, STRETCH at hour 40). Cut any line that the software cannot show on stage.

---

## Pre-flight check before starting the walk

- [ ] App opened with `?demo=1` (or `DEMO_SAFE=1`) so zero live network / NASA / DONKI requests are needed.
- [ ] Browser zoom at 100%, full-screen (`F11`), notifications muted.
- [ ] Both views visible or ready to switch: **2D MapLibre planner** (`web/planner/`) and **3D first-person helmet HUD** (`web/hud/`).
- [ ] Fallback check: if any `data/processed/` file is absent, the UI is cleanly reading from `docs/contracts/` or `data/demo/`.

---

## Beat 1 — Framing the Mission (0:00 – 0:25)

**On screen:** Start on the **3D first-person helmet HUD** looking across lower Mount Sharp (or split view with the 2D planner beside it).

**What to point out (English / Türkçe notlar):**
- **Hook:** *"If a human crew visited where Curiosity explored lower Mount Sharp in Gale Crater, how would they walk safely between science targets?"*  
  *(Eğer bir astronot ekibi Gale Krateri / Mount Sharp'ta Curiosity'nin incelediği bölgeye inseydi, bilimsel hedefler arasında nasıl güvenli yürürdü?)*
- **Honest framing caveat:** Gale Crater is a Curiosity rover site, not a human landing candidate — we frame this as an exploration traverse where we have ground-truth rover data.
- **Primary science goal:** Ancient lake sediments and habitability / biosignature potential (organics in mudstones), with the **Altadena member boxwork unit** (entered by Curiosity on Sol 4534, ~4.80°S, 137.39°E) as our **bonus stop**.

---

## Beat 2 — 2D MapLibre Planner & Hazard Cost Map (0:25 – 1:05)

**On screen:** Focus on the **2D MapLibre planner**.

**Actions & talking points:**
1. **Base context layers:** Show Mars Trek WMTS context (CTX 5 m optical, MOLA shaded relief, and THEMIS thermal layer toggle once SHOULD-05 lands).
2. **HiRISE 1 m DTM slope & hazard overlay (`cost-map.json`):**
   - Point out the colour classes: **Green ≤ 10°**, **Amber 10–15°**, **Red 15–20°**, **Blocked > 20°** (plus no-data pixels masked as blocked).
   - *(Optional SHOULD-06 toggle)*: Flip between the 20° limit and stricter 15° limit.
3. **Science stops (`stops.json`):**
   - Click the **Start / Habitat** point → **Primary lake-sediment / mudstone stops** → **Boxwork bonus stop** (ridges ~5 m wide rich in phyllosilicates, hollows 10–20 m across with siderite).
   - *(SHOULD-03)*: Click a stop to show the cached **Curiosity Rover POV still** (or honest empty state if no image is cached for that Sol).
4. **Honesty callout (say out loud):**
   - *"Our 15° and 20° slope limits are lunar EVA stand-ins from NASA's Exploration EVA Concept of Operations, and the 1 m HiRISE DTM under-reads local rover tilt by roughly 5–7° compared to Curiosity waypoint tilts — so we build in a safety margin and state both caveats in the UI."*

---

## Beat 3 — Sending the Route to the 3D Visor (`mm:set-route`) (1:05 – 1:50)

**On screen:** Click **"Start EVA" / Send Route** in the planner (`mm:set-route` event via `web/shared/route-bridge.js`) and switch focus to the **3D first-person terrain + Helmet HUD**.

**Actions & talking points:**
1. **Route handoff:** Show that the A\* / Dijkstra route (`route.json`) avoids blocked >20° slopes and no-data regions and appears directly in the 3D visor.
2. **Walk along the route (`hud-telemetry.json`):** Advance along the path and point to the **four MUST HUD readouts**:
   - **Distance:** Travelled / remaining / distance to next stop (computed using Mars radius, 3,389.5 km mean / 3,396.19 km equatorial).
   - **Slope:** Current slope in degrees + safety class badge (Green / Amber / Red).
   - **Next stop:** Target stop name and ID.
   - **Suit O₂ (%):** Clearly labelled on the HUD as an **illustrative linear placeholder** (along with placeholder walking duration).

---

## Beat 4 — Radiation Dose Budget, Space Weather & Environment (1:50 – 2:30)

**On screen:** Point to the **Dose & Space-Weather cards** on the HUD / planner *(SHOULD-01, SHOULD-02, SHOULD-04)*.

**Actions & talking points:**
1. **Radiation dose budget (`dose.json`):**
   - Explain why there is **no spatial "radiation map" of rocks**: Galactic Cosmic Ray (GCR) dose over a ~10 km walk changes with **time** and **shielding**, not rock type.
   - We compute `dose ≈ baseline rate × EVA duration` using Curiosity RAD's measured GCR baseline (**0.64 ± 0.12 mSv/day**, Hassler et al., *Science* 2014, plus RAD RDR archive tables).
2. **DONKI space-weather banner (`alerts.json`):**
   - Show the cached **WSA-Enlil simulation** alert banner checking for `"Mars"` in `impactList` (e.g., cached 2025-05-08T12:00Z Mars arrival prediction).
3. **REMS weather window (`weather.json`):**
   - Mention the selected EVA thermal window from Curiosity REMS archive data.

---

## Beat 5 — Credits, Sources & Close (2:30 – 2:50)

**On screen:** Open the **Data Sources & Honesty Credits** panel.

**Closing statement:**
- Highlight that Martian Mappers integrates **3+ data types across 3+ missions**:
  1. **MRO:** HiRISE 1 m DTM (`DTEEC_019698` / `DTEEC_001488`) & 25 cm orthoimage, CTX mosaic, CRISM spectral metadata.
  2. **Mars Odyssey:** THEMIS Day/Night IR thermal mosaics (via NASA Mars Trek WMTS).
  3. **MGS / Mars Express:** MOLA shaded relief & HRSC–MOLA blended DEM context.
  4. **MSL Curiosity:** Waypoints & rover tilt ground truth, REMS atmosphere, RAD radiation dose rates, and raw camera POV stills.
  5. **NASA CCMC DONKI:** WSA-Enlil space-weather Mars arrival predictions.
- Every dataset includes its fetch date, and every placeholder or model limitation is transparently labelled.
