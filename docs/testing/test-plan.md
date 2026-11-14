# Test plan — Martian Mappers

**Owner:** Bug tester 1 (Asil). Tester 2 (Eymen) reviews frontend and demo, and covers this plan if Tester 1 is busy.
**Clock:** Hours 0–16 are MUST. This file is the walk. The Turkish checkbox list is [must-checklist.md](./must-checklist.md). Field names are in [contract-checklist.md](./contract-checklist.md).
**Pass rule:** [ROADMAP.md](../../ROADMAP.md) §7. A missing piece becomes `FALLBACK` (load `docs/contracts/` or a labelled static file) and is written in the sign-off table. Do not invent a pass.

**Kısa not (Türkçe):** Bu dosya saat 16 MUST yürüyüşüdür. 14 Kasım 2026 12:59 belge incelemesinde yalnızca Backend 1 arazi dosyaları ilk PASS’tir. Duraklar kilitli değil (PRE-07). Rota, HiRISE maliyet kırpmasının üzerinde değil. `web/` içinde uygulama yok. Saat 16 onayı **verilmedi**.

Checked against `main` commit `d2c4695` on 2026-11-14 12:59 Europe/Istanbul. That was a **document review** (files on disk). It was not a browser demo.

## How to mark a row

| Mark | Meaning |
|---|---|
| `PASS` | The definition-of-done item works, and the honesty label is visible |
| `FAIL` | It does not work, and there is no fallback in place |
| `FALLBACK` | The live piece failed or is missing; the demo uses the named static file, and the UI says so |
| `NOT YET` | The owning files are not in the build under test |

Write the mark, the date, the git commit, and your first name in the sign-off table at the bottom. Do not tick another role’s science as real if `is_example` is still true.

## A. Every pull request (before merge)

Do this on the PR diff. One tester approval is enough. The author does not merge their own PR. Merge to `main` only when the team asks.

- [ ] The diff stays in that role’s folders ([ROADMAP.md](../../ROADMAP.md) §2). Testers may edit `docs/testing/`, `docs/AI_USE.md`, their comms note, and their own board and log lines.
- [ ] No `.env`, API key, token, or private key. `NASA_API_KEY` appears only as a name.
- [ ] No `data/raw/`, and no `*.tif`, PDS `.IMG`, or JP2.
- [ ] `docs/coordination/AGENT_LOG.md` has a new entry in the same commit, with `Commit: this commit`.
- [ ] If a **contract field name or meaning** changed: example JSON, [docs/contracts/CHANGES.md](../contracts/CHANGES.md), a handoff, and a board question are in the same PR. Tell Frontend 1 and both testers.
- [ ] Processed JSON still loads with the fallback in `docs/contracts/` (see the contract checklist).
- [ ] New AI help has a row in [docs/AI_USE.md](../AI_USE.md), or this log already names that tool and purpose.

## B. MUST walk (hours 14–16)

Definition of done: cropped terrain and a slope/hazard cost map, a safe route between **locked** stops (or a labelled static route), a 3D first-person view, a helmet HUD with distance, slope, next stop, and suit O₂ (O₂ marked as a placeholder), a MapLibre planner that sends `mm:set-route`, and an offline path (local JSON plus a local height preview). Sources and honesty notes must be reachable on screen.

| ID | Check | How | Result on `d2c4695` |
|---|---|---|---|
| B1 | Cropped Mount Sharp DTM, slope, roughness, `cost-map.json`, height preview, tilt note | Files under `data/processed/terrain/`. Open `cost-map.json`. Confirm `tilt_validation_note`, preview PNGs, and blocked cells (`9e99` or the file’s `blocked_sentinel`). | **PASS (first pass, files only).** 395×395 cells, about 5.06 m, sentinel `9e99`, 28,509 blocked cells (18.3%). Slope, ortho, and height previews are on disk. Crop centre is still a placeholder. The tilt note records the 14 Nov waypoint check (no systematic under-read at ~5 m; weak correlation; keep a safety margin). Raster is **not** frozen. |
| B2 stops | Habitat, two lake-sediment stops, boxwork bonus, inside DTEEC_019698, `is_example` false only after PRE-07 | Compare `data/processed/routing/stops.json` with [STOP_COORDINATE_CHECK.md](./STOP_COORDINATE_CHECK.md). Footprint used here: 4.73–5.04°S, 137.31–137.44°E ([AGENTS.md](../../AGENTS.md)). | **NOT YET (lock).** All four points fall inside that lat/lon box. All four still have `is_example: true`. Names are candidates or contract placeholders, not locked outcrops. HiView confirmation is still open (PRE-07). |
| B2 route | Path avoids blocked cells on the **real** cost grid; distance and climb are filled; static `route.json` exists if the solver is down | Read `route_method`, `cost_map_used`, `totals`, and `profile`. If `cost_map_used` is the example contract, do not call the HiRISE route safe. | **NOT YET.** `route.json` exists (`dijkstra_8_neighbour`, 947.1 m, placeholder 71 min). `cost_map_used` is `docs/contracts/cost-map.json`, not the HiRISE crop. Climb and descent are null. The crop’s north edge is about 4.813°S; the stops sit about 0.7–0.9 km farther north (Mars radius 3,389.5 km). |
| B2 HUD file | Samples include distance, slope class, next stop, and a labelled O₂ placeholder | See the contract checklist. The processed file nests samples under `primary` and `samples`. | **GAP (shape).** Fields exist on `primary`. `slope_deg` and elevation are null. O₂ formula is present and labelled illustrative. Not a HUD on screen. |
| F1 map | MapLibre shows the same stops and route | Open the planner in a browser. | **NOT YET.** `web/planner/` is a README only. |
| F1 bridge | Planner fires `mm:set-route` once with the static route | Browser event, or the shared helper in `web/shared/`. | **NOT YET.** |
| F1 HUD | Distance, slope (number and colour), next stop name, suit O₂ with a placeholder label | Read the helmet overlay. O₂ must not look like a real suit model. | **NOT YET.** |
| Offline | Demo still runs with local JSON and the height preview if Wi-Fi is off | Disconnect, reload. | **NOT YET** for the app. Local terrain JSON and `height-preview.png` are already in the repo. |
| Honesty | Lunar slope stand-in, DTM/tilt caveat, and O₂ placeholder are visible in the UI | Credits or on-screen notes. | **NOT YET** (no UI). The JSON notes exist. |

Hour-16 sign-off: **not given.** Fallback for the demo, until the gaps close, is `docs/contracts/` plus the Backend 1 previews. Say that on the slide if the team demos before the route sits on the crop.

## C. SHOULD regression (after each SHOULD merge; sign-off at hour 32)

Start this list when a SHOULD PR merges. Do not treat file existence as a UI pass.

- [ ] `dose.json` uses 0.64 ± 0.12 mSv/day ([Hassler et al., Science 2014](https://www.science.org/doi/10.1126/science.1244797)) times EVA duration. No spatial “radiation map” of rocks.
- [ ] `alerts.json` is a **cache**. The banner still shows if the network is off. Live DONKI is not required on stage.
- [ ] Each stop has a POV still, or `missing: true` with an honest label. No invented image.
- [ ] Planner can show REMS and/or THEMIS. CRISM only if the metadata is really there.
- [ ] **Demo-safe:** `DEMO_SAFE=1` or `?demo=1` reads only `data/demo/` and does not call the network, NASA, or DONKI (board SHOULD-07).
- [ ] 15° / 20° toggle is optional. SHOULD can pass without it.

Document review on `d2c4695` (not a SHOULD sign-off):

- Dose math matches the formula it cites: 0.64 × (1.6 h / 24) = 0.0427 mSv, uncertainty 0.008 mSv. Duration is still the **example** 96 minutes (`route_source`: `docs/contracts/route.json`), not the processed route’s 71 minutes. PDS RAD tables are recorded as unavailable (expired TLS). That limit stays visible.
- Alerts: status `cached`, 13 items, each with `mars_in_impact_list: true`, banner text present. Queried window 2026-10-15 to 2026-11-14.
- Weather: CAB/NASA daily summary, 4,745 sols, latest Sol 4995 in the file. No hourly curve in the file. The dated contract key `sol_range_available_as_of_2026-11-11` is absent (see the contract checklist).
- POV: four JPEGs and JSON sidecars. `missing` is false. Stops are still examples.
- `data/demo/` has the science fixtures (22 files, including POV and six THEMIS tiles). It does **not** yet have `cost-map.json`, `stops.json`, `route.json`, or `hud-telemetry.json`.
- The loader and the network-off check are **NOT YET** (`web/` has no app). SHOULD-07 / SHOULD-08 stay open.

## D. STRETCH gate (hours 32–40)

Do not start WebXR or paired-rover mode while section B is `FAIL` or unsigned. If stretch starts, add three checks: the default view still works, VR can be left in one step, and the Curiosity traverse overlay can be hidden in one step. Nothing new after hour 40.

## E. Submit checks (hours 40–44, with Tester 2)

- [ ] Feature freeze. No last feature.
- [ ] SI-tools paragraph is written from [docs/AI_USE.md](../AI_USE.md). Disclosure is required. AI/SI was not used to invent the challenge idea. The form answer is not shown to judges. This sentence is **provisionally official** (13 Nov pages read with an unverified certificate; confirm with a cert-valid fetch). Guide: [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/).
- [ ] Video plan stays at 30 seconds or less, English subtitles, no under-18 face or voice. Official length stays **UNVERIFIED** until that cert-valid read (PRE-05 / PRE-06).
- [ ] Sources, lunar slope stand-in, tilt caveat, and placeholder O₂ / walk time are on the slides.

## Sign-off (this branch)

| Item | Mark | Tester | Commit reviewed | Notes |
|---|---|---|---|---|
| B1 terrain / cost map | PASS (first pass, files) | Asil (T1), earlier Gemini pass; re-read by Grok (Cursor) | `d2c4695` | Re-crop and freeze after PRE-07. |
| B2 stops | NOT YET | Asil (T1) | `d2c4695` | Inside the DTM **box**; not locked; not HiView-confirmed. |
| B2 route on real cost grid | NOT YET | Asil (T1) | `d2c4695` | Example Dijkstra on the contract grid. |
| F1 planner, bridge, HUD | NOT YET | Asil (T1) | `d2c4695` | No app under `web/`. |
| Offline app | NOT YET | Asil (T1) | `d2c4695` | Local terrain files exist. |
| MUST hour-16 sign-off | **not given** | Asil (T1) | `d2c4695` | Do not demo this as a finished MUST build. |
| SHOULD-08 | NOT YET | — | `d2c4695` | Science JSON is cached; UI and demo-safe loader are not. |
