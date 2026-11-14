# Demo path — record this (Tester 2)

**Owner:** Bug tester 2 (Eymen)  
**Date:** 2026-11-14 (Europe/Istanbul)  
**Task:** MUST-12 rough demo walk, ahead of SUB-01

Two show options. Ship either one. Do not put under-18 faces, voices, or likenesses in either.

1. **30-second screen recording** below (English subtitles in [demo-path.srt](./demo-path.srt)). Silent, or a royalty-free instrumental with no voice.
2. **7-slide alternative** in [slides-outline.md](./slides-outline.md). Speaker lines for those seven slides are at the bottom of this file.

`web/planner/` and `web/hud/` are still README-only (MUST-08, MUST-09, MUST-10 are `todo`). Do not record a “Start EVA” click. The live click script in [script.md](./script.md) waits until that UI exists.

Stops and `route.json` are **examples** (`status: example`, `is_example: true`). PRE-07 has not locked outcrop names. Say that on the recording.

---

## 30-second video (record now)

Hard cut at **29 seconds** so a player does not show 0:31. Resolution 1920×1080, `.mp4`. Burn in [demo-path.srt](./demo-path.srt), or the subtitle column below. Full-screen the image; hide bookmarks, mail, and any name that is not a first name.

Open files from disk. No NASA or DONKI calls during the take. Science copies also sit in `data/demo/` (`science-manifest.json`). Terrain previews and the route are **not** in that demo-safe folder yet.

| Time | Open this file | English subtitle (burn in) | Do not say |
|---|---|---|---|
| 0–5 s | `data/processed/terrain/slope-preview.png` | A crew at Curiosity's Mount Sharp needs a slope-aware walk. | That Gale is a human landing site. It is a rover site. |
| 5–11 s | Same preview, then `data/processed/terrain/ortho-preview.png` | Example stops only. Outcrops are not locked. Red means steeper than 20 degrees. | That this crop contains the stops. It does not (see numbers). |
| 11–18 s | `data/processed/science/pov/stop-mudstone-a.jpg`, then `stop-boxwork-bonus.jpg` | Primary goal: ancient lake mudstones. Boxwork ridges are the bonus stop. | That these photos were taken at locked outcrops. They are cached Curiosity stills tied to example stop ids. |
| 18–24 s | Caption card (type the two lines in the numbers card below; no HUD exists) | Dose is time times Curiosity's RAD rate, plus a cached DONKI alert. Not a map of rocks. | A radiation map. Any dose other than **0.0427 ± 0.008 mSv**. |
| 24–29 s | Title card: **Martian Mappers — NASA Space Apps 2026** | Martian Mappers. NASA data. Lunar slope stand-in. Oxygen is a placeholder. | Team surnames, ages, school, or a voiceover. |

**Caption card text (18–24 s), two lines only:**

- Dose placeholder: **0.0427 ± 0.008 mSv** (0.64 ± 0.12 mSv/day × 96 min). Hassler et al., *Science* 2014. Duration is still the contract placeholder, not the 71 min example route.
- DONKI: “13 WSA-Enlil runs list Mars (latest predicted arrival 2026-11-13T12:00Z, glancing blow).” Full sentence is the `banner.text` in `data/processed/science/alerts.json`.

**POV credits, if a corner bug is needed:** mudstone still is Curiosity Navcam, Sol 5073, NASA/JPL-Caltech. Boxwork still is Mastcam (`MAST_RIGHT`), Sol 4698, NASA/JPL-Caltech/MSSS. Both are linked to example stops.

**Türkçe prova (altyazı İngilizce kalır):** “Mürettebat, Curiosity’nin Mount Sharp’ta çalıştığı yerde eğime göre yürümeli. Duraklar henüz örnek. Asıl hedef eski göl çamurtaşları; boxwork bonus. Doz, süre çarpı RAD oranı; kaya radyasyon haritası değil.”

---

## Numbers to read from files (14 Nov)

Do not round these into a different claim.

| Item | Say this | Source |
|---|---|---|
| Slope crop | First pass, centre 4.83°S, 137.39°E, about 5 m cells. Median slope 9.7°. About 28% of cells steeper than 15°, about 18% steeper than 20°. No no-data in this crop. Centre is a placeholder until PRE-07. | `data/processed/terrain/slope_stats.json` |
| Crop vs stops | Crop north edge is 4.813°S. Example stops sit near 4.797–4.802°S, **outside** this crop. The example route was run on `docs/contracts/cost-map.json`, not on this HiRISE grid. | `cost-map.json` `bounds`; `data/processed/routing/route.json` `cost_map_used` |
| Route | Example id `eva-example-pre07-scaffold-001`. Order: habitat → mudstone A → mudstone B → boxwork bonus → habitat. File states **947.1 m**. Climb is null. **71 min** is an Earth-hiking placeholder (13.33 m/min). | `data/processed/routing/route.json` |
| Leg sum | The four `legs` are 220.9 + 125.3 + 376.6 + 67.5 m = **790.3 m**, which is not 947.1 m. On stage, say only **947.1 m** (the file total) and do not add the legs until Backend 2 confirms them. | same file; board question 14 Nov |
| HUD sample (for later) | Example primary sample: 526.1 m travelled, 420.9 m left, next stop the Sol 4534 boxwork candidate, slope **unknown**, suit O₂ **44.4%** labelled placeholder. | `data/processed/routing/hud-telemetry.json` `primary` |
| Dose | **0.0427 ± 0.008 mSv** from the **96 min** contract route. Do not swap in 71 min until Backend 3 re-runs `dose.json`. RAD RDR archive did not load on 14 Nov (expired TLS). Baseline stays Hassler et al. 2014. | `data/processed/science/dose.json` |
| Space weather | Banner level `warn`. Window 2026-10-15 to 2026-11-14. 13 Mars impacts. Latest predicted arrival 2026-11-13T12:00Z (glancing blow). | `data/processed/science/alerts.json` `banner.text` |
| Weather | REMS daily summary, Sol 4995 (2026-08-25): air −71 to −5 °C, ground −84 to 4 °C, 777 Pa, sunny, UV moderate. Chosen window 06:46–09:30 LTST. No hourly curve was invented. | `data/processed/science/weather.json` |
| Tilt check | 176 waypoints, Sol 4400–5073. At ~5 m, median DTM slope 9.0° and median rover tilt 8.6° (difference −0.06°). Correlation weak (r about 0.15). **No systematic under-read** at that scale. The 11 Nov note (4–10° DTM vs 9–17° rover at four boxwork sols) was not confirmed on this sample. First pass, not a validation. Keep a safety margin. | `data/processed/terrain/tilt-check.json`; `cost-map.json` `tilt_validation_note` |
| Slope limits | 15° and 20° are lunar stand-ins (NASA Exploration EVA ConOps; LPSC 2023 #1413). Not a published Mars suit limit. | `cost-map.json` `slope_limit_note` |

Stop ids, all `is_example: true`: `stop-habitat` (Sol 4527 candidate, 137.3875°E, 4.7972°S), `stop-mudstone-a` (137.39°E, 4.80°S), `stop-mudstone-b` (137.3915°E, 4.8015°S), `stop-boxwork-bonus` (Sol 4534 candidate, 137.3864°E, 4.7976°S). No official mudstone outcrop name. Source: `data/processed/routing/stops.json`.

---

## 7-slide alternative (if you do not record)

Build the deck from [slides-outline.md](./slides-outline.md). Seven slides including title. English only. No photos of people. One sentence to say on each:

1. **Title.** Martian Mappers: a walking plan for lower Mount Sharp, if a crew visited where Curiosity worked.
2. **Goal.** Ancient lake mudstones first. Boxwork (Altadena member, Sol 4534 context) is the bonus stop. Gale is not a landing site.
3. **Data.** HiRISE slope, Mars Trek context, Curiosity waypoints, RAD, REMS, and a cached DONKI Mars alert. Offline files, fetched 11–14 Nov 2026.
4. **Route.** Example Dijkstra, 947.1 m stated, 71 min placeholder. Stops are not locked and are not inside today’s HiRISE crop.
5. **HUD plan.** The 3D visor is not on screen yet. When it is, it will show distance, slope, next stop, and a labelled oxygen placeholder (example sample: 44.4%).
6. **Honesty.** Lunar slope stand-in. Tilt check found no systematic under-read (weak correlation). Dose is time × RAD rate, still on a 96 min placeholder. Oxygen and walk time are placeholders.
7. **Close.** Human team chose the site and the science goal. AI tools helped write docs and code; the list is in `docs/AI_USE.md`. Web demo-safe mode is not verified yet.

---

## After the web app exists

Only then use the click beats in [script.md](./script.md) and the “after the HUD” table in [video-beats.md](./video-beats.md). Cut any line the build cannot show. Re-record if PRE-07 locks different coordinates, if Backend 2 fixes the 947.1 m vs 790.3 m legs, or if Backend 3 refreshes `dose.json` from the 71 min route.
