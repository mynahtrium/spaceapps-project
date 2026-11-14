# Handoffs

Use this file when work leaves your role and someone else must pick it up (a finished cost map, a contract field change, a blocked download, a demo note). **Append** a new block at the bottom; do not edit old blocks except to fill "Received" when you pick it up.

Also add a one-line pointer in [BOARD.md](./BOARD.md) (status `review` or a row in **Questions for other roles**).

Log the same change in [AGENT_LOG.md](./AGENT_LOG.md) and, if you changed `docs/contracts/`, in [docs/contracts/CHANGES.md](../contracts/CHANGES.md).

## How to use

1. Copy the template below.
2. Fill every field you can. Link files and the board task id.
3. Put the receiving role in the title and, if you know them, their first name or nickname only (see profiles). No phone numbers, emails, addresses, or school names.
4. Open or update the pull request if the files are in git.
5. The receiver sets **Received** to the date and a short "yes, I have it" or a question.

## Template

```md
### HANDOFF-YYYYMMDD-HHMM — from <role> to <role>

- Date (Europe/Istanbul):
- From (role, first name or nickname only, agent tool):
- To (role, name if known):
- Board task id:
- What is ready:
- Paths (files or folders):
- How to try it:
- What is not done / known limits:
- Please do next:
- Contract field changed? (yes/no — if yes, also update docs/contracts/CHANGES.md):
- Received:
 (leave blank until the other role fills this)
```

## Log

<!-- Append new handoffs below this line. Newest at the bottom. -->

### HANDOFF-20261114-1154 — from Backend 2 to Doruk / team (+ Testers)

- Date (Europe/Istanbul): 2026-11-14 11:54
- From (role, first name or nickname only, agent tool): Backend 2, Doruk, Grok (Cursor)
- To (role, name if known): Doruk / team; Testers 1–2 to record chosen ids after lock
- Board task id: PRE-07 (blocks MUST-04, MUST-05, MUST-06)
- What is ready: Stop-lock decision request with cited Sol 4527 / 4534 waypoint candidates and open mudstone outcrop slots — [pipeline/routing/PRE07_LOCK_REQUEST.md](../../pipeline/routing/PRE07_LOCK_REQUEST.md). No invented outcrop names. Example `docs/contracts/stops.json` unchanged.
- Paths (files or folders): `pipeline/routing/PRE07_LOCK_REQUEST.md`, board Questions row, this handoff
- How to try it: Answer the board question (or PR comment) with locked names/coords; optional yes/no on example-grid routing scaffold
- What is not done / known limits: Mudstone outcrop names and final coordinates are not chosen. Resources tab still may be UNVERIFIED. HiView confirmation still needed for any pick.
- Please do next: Lock the four stops (or reject candidates and supply alternates inside DTEEC_019698). Testers copy the locked ids into `docs/testing/`. Then Backend 2 runs MUST-04.
- Contract field changed? (yes/no — if yes, also update docs/contracts/CHANGES.md): no
- Received: 2026-11-14 15:33 (Eymen / Tester 2) — Verified JS syntax, DOM IDs, and `?demo=1` tile guards; vendored `maplibre-gl@4.7.1` and `three@0.170.0` into `web/vendor/` so `?demo=1` is 100% offline (`BUG-12` fixed).
 2026-11-14 12:02 (Asil / Tester 1) — Alındı; durak kilitleme kararı bekleniyor.

### HANDOFF-20261114-1200 — from backend-1 to backend-2, frontend-1, testers

- Date (Europe/Istanbul): 2026-11-14 12:00
- From (role, first name or nickname only, agent tool): backend-1, Cagan, Claude Code
- To (role, name if known): backend-2 (Doruk), frontend-1, tester-1, tester-2 (Eymen)
- Board task id: MUST-02
- What is ready: first-pass cost map for a 2 km x 2 km crop of DTEEC_019698 (395 x 395 cells, ~5.06 m), slope colour preview, 16-bit height preview, ortho preview.
- Paths (files or folders): `data/processed/terrain/cost-map.json`, `slope-preview.png`, `height-preview.png`, `ortho-preview.png`; scripts in `pipeline/terrain/`
- How to try it: `.venv/Scripts/python pipeline/terrain/make_slope.py` then `make_cost_map.py` (packages in `pipeline/terrain/requirements.txt`). Bounds are in `cost-map.json` (about 4.813–4.847°S, 137.373–137.407°E). Cost is a multiplier; multiply by step length. `9e99` = blocked (no-data or slope above 20°; 18% of cells). Rows run north to south.
- What is not done / known limits: crop centre is a placeholder (near Curiosity Sol 5070); re-run once stops are locked (PRE-07). No ortho-based obstacles yet. Not checked against Curiosity tilt (MUST-03). Slope limits are lunar stand-ins; the DTM under-reads rover tilt. Height preview is scaled 0–65535 over `height_preview_elevation_range_m` (about -3575 to -3219 m).
- Please do next: Backend 2 can start routing on this grid; Frontend 1 can load the height preview in the 3D view; testers check the bounds against HiView.
- Contract field changed? (yes/no — if yes, also update docs/contracts/CHANGES.md): yes, additive only (see CHANGES.md)
- Received:
 2026-11-14 12:02 (Asil / Tester 1) — Alındı ve must-checklist.md üzerinden doğrulandı (PASS).

### HANDOFF-20261114-1217 — from Backend 3 to Frontend 1, Tester 1, Tester 2 (and Backend 1)

- Date (Europe/Istanbul): 2026-11-14 12:17
- From (role, first name or nickname only, agent tool): Backend 3, CC, Antigravity (Gemini)
- To (role, name if known): Frontend 1, Tester 1 (Asil), Tester 2 (Eymen), Backend 1 (Cagan)
- Board task id: MUST-07, SHOULD-01, SHOULD-02, SHOULD-04 (THEMIS/CRISM pass)
- What is ready:
  - `data/processed/science/alerts.json` (30-day cached DONKI window 2026-10-15..2026-11-14 with 13 WSA-Enlil Mars impacts + banner copy)
  - `data/processed/science/dose.json` (Hassler et al. 2014 RAD baseline 0.64 +/- 0.12 mSv/day; currently computed against placeholder 96 min route duration until Backend 2 ships `route.json`)
  - `data/processed/science/layers-themis.json` + 6 cached Gale sample PNG tiles (`tiles/themis/{day,night}/z{4,6,8}_*.png`)
  - `data/processed/science/layers-crism.json` (9 MRO CRISM MTRDR product metadata records over Gale from ODE REST)
  - `data/processed/science/msl-waypoints-cache.json` (1,389 MSL waypoints with `tilt` through Sol 5073 for B1 MUST-03 reference)
- Paths (files or folders): `pipeline/data/`, `data/processed/science/`
- How to try it: Run `python -m pipeline.data.run_must07` and `python -m pipeline.data.run_phase2` (stdlib only, no extra pip packages required; `.env` with `NASA_API_KEY` needed only for DONKI re-fetch).
- What is not done / known limits:
  - REMS (`atmos.nmsu.edu`) reset connections and RAD RDR (`pds-ppi.igpp.ucla.edu`) failed TLS certificate expiration check on 2026-11-14; both recorded honestly as `unavailable`. `weather.json` (REMS window) and `pov/<id>.json` + JPEG stills (`SHOULD-03`) are next once `stops.json` locks.
  - `dose.json` uses `docs/contracts/route.json` duration (`96 min`) until `data/processed/routing/route.json` exists.
- Please do next:
  - Frontend 1: wire `alerts.json`, `dose.json`, and `layers-themis.json` from `data/processed/science/` (with fallback to `docs/contracts/`).
  - Backend 2: let us know when `stops.json` and `route.json` land so we regenerate `dose.json` and fetch per-stop POV stills.
  - Testers: review PR / verify offline JSON contracts.
- Contract field changed? (yes/no — if yes, also update docs/contracts/CHANGES.md): no (kept contract field names; additive metadata fields only)
- Received:


### HANDOFF-20261114-1220 — from Backend 3 to Frontend 1, Tester 1, Tester 2, Backend 2

- Date (Europe/Istanbul): 2026-11-14 12:20
- From (role, first name or nickname only, agent tool): Backend 3, CC, Antigravity (Gemini)
- To (role, name if known): Frontend 1, Tester 1 (Asil), Tester 2 (Eymen), Backend 2 (Doruk)
- Board task id: SHOULD-03, SHOULD-04, SHOULD-07 (B3 complete)
- What is ready:
  - `data/processed/science/weather.json` (4,745 sols from CAB/NASA MSL REMS outreach feed through Sol 4995; early-morning EVA window `06:46`–`09:30` LTST)
  - `data/processed/science/pov/` (`index.json` + 4 per-stop JSONs and 4 cached Curiosity JPEGs: Sol 5073 Navcams + Sol 4698 boxwork Mastcam, ~91–115 KB each)
  - `data/demo/` frozen science fixtures exported (`22` files, `789.7 KB` total, listed in `data/demo/science-manifest.json`) for offline `DEMO_SAFE=1` / `?demo=1`
- Paths (files or folders): `pipeline/data/`, `data/processed/science/`, `data/demo/`
- How to try it: Run `python -m pipeline.data.run_phase3` (after `run_must07` and `run_phase2`). All `data/processed/science/` assets total `838.3 KB` (well under the 100 MB budget).
- What is not done / known limits:
  - `dose.json` and `pov/*.json` currently use `docs/contracts/route.json` (`96 min`) and `docs/contracts/stops.json` (`is_example_stop: true`). Once Backend 2 writes locked `data/processed/routing/stops.json` and `route.json`, re-run `python -m pipeline.data.run_phase2` and `python -m pipeline.data.run_phase3` (or `build_dose`, `build_pov`, `export_demo_fixtures`) to refresh them automatically.
  - REMS sub-hourly diurnal curves are not in the CAB daily summary feed (only daily min/max air/ground temperatures are reported; no hourly curve invented).
- Please do next:
  - Testers: review `backend-3/must-07-data-cache` PR and sign off `MUST-07`, `SHOULD-01`–`SHOULD-04` (and B3's `SHOULD-07` fixtures).
  - Frontend 1: wire `data/processed/science/` (and `data/demo/` for `?demo=1`).
  - Backend 2: ping Backend 3 once `stops.json` and `route.json` are locked so we refresh `dose.json` + `pov/`.
- Contract field changed? (yes/no — if yes, also update docs/contracts/CHANGES.md): no
- Received: 2026-11-14 15:33 (Eymen / Tester 2) — Verified JS syntax, DOM IDs, and `?demo=1` tile guards; vendored `maplibre-gl@4.7.1` and `three@0.170.0` into `web/vendor/` so `?demo=1` is 100% offline (`BUG-12` fixed).


### HANDOFF-20261114-1303 — from Tester 2 to Frontend 1, Backend 2, Backend 3, Tester 1

- Date (Europe/Istanbul): 2026-11-14 13:03
- From (role, first name or nickname only, agent tool): Tester 2, Eymen, Grok (Cursor)
- To (role, name if known): Frontend 1; Backend 2 (Doruk); Backend 3 (CC); Tester 1 (Asil)
- Board task id: MUST-12 (demo path). Related open items: PRE-07, MUST-08–10, SUB-01
- What is ready: A record-now demo path that does not need the web app. 29 s English-subtitled screen outline (slope preview, two Curiosity stills, caption card; no under-18 faces or voices) and a 7-slide speaker card. Subtitles: `docs/demo/demo-path.srt`.
- Paths (files or folders): `docs/demo/demo-path.md`, `docs/demo/demo-path.srt`, updated `docs/demo/script.md`, `video-beats.md`, `slides-outline.md`, `submission-checklist.md`, `docs/comms/note-tester-2-demo-path.md`
- How to try it: Read `docs/demo/demo-path.md` and check every number against `data/processed/routing/route.json`, `data/processed/science/dose.json`, and `data/processed/terrain/tilt-check.json`. Do not record the HUD click script yet.
- What is not done / known limits: Web HUD is not built. Stops are examples. Route total 947.1 m does not match the leg sum 790.3 m. Dose card is still 96 min / 0.0427 mSv. Slides no longer say the DTM systematically under-reads tilt; the 14 Nov 176-waypoint check did not show that.
- Please do next: Tester 1 reviews this branch (do not merge unless asked). Backend 2 answers the board question on 947.1 vs 790.3. Backend 3 refreshes dose only when the duration to show is chosen. Frontend 1 tells Tester 2 when a real `mm:set-route` click exists.
- Contract field changed? (yes/no — if yes, also update docs/contracts/CHANGES.md): no
- Received: 2026-11-14 15:33 (Eymen / Tester 2) — Verified JS syntax, DOM IDs, and `?demo=1` tile guards; vendored `maplibre-gl@4.7.1` and `three@0.170.0` into `web/vendor/` so `?demo=1` is 100% offline (`BUG-12` fixed).


### HANDOFF-20261114-1305 — from Backend 3 to Frontend 1, Tester 1, Tester 2

- Date (Europe/Istanbul): 2026-11-14 13:05
- From (role, first name or nickname only, agent tool): Backend 3, CC, Grok 4.7 (Cursor)
- To (role, name if known): Frontend 1, Tester 1 (Asil), Tester 2 (Eymen)
- Board task id: SHOULD-01, SHOULD-02, SHOULD-03, PRE-04
- What is ready:
  - `dose.json` refreshed from example `data/processed/routing/route.json` (71 min placeholder walk → 0.0315 ± 0.0059 mSv). Status `example` until PRE-07. Hassler et al. 2014 baseline only. No spatial radiation map.
  - Labelled DONKI examples: `donki-cache.example.json` and `alerts.example.json` (11 Nov 2026 planning-check arrival 2025-05-08 12:00Z). Live DONKI skipped because `NASA_API_KEY` is absent.
  - Real `donki-cache.json` and `alerts.json` (13 Mars impacts) left unchanged.
  - POV JSON relabelled from example `stops.json`. The four JPEGs were reused, not re-downloaded. Still `is_example_stop`.
  - Same science files copied under `data/demo/` (manifest now lists the two example JSON files).
- Paths (files or folders): `pipeline/data/`, `data/processed/science/`, `data/demo/` science fixtures, `docs/comms/note-backend-3-science-leftovers.md`
- How to try it: `python -m pipeline.data.run_examples` (no network, no key). `python -m pipeline.data.fetch_donki` also skips the live call when the key is missing and does not overwrite the real cache.
- What is not done / known limits: PRE-07 is still open, so dose and stops stay examples. Walk time is still an Earth-hiking placeholder. PDS RAD tables are still unavailable (expired TLS on the earlier fetch). No personal NASA key on this machine.
- Please do next: Frontend 1 can read `dose.json` and, for a keyless demo, the `*.example.json` DONKI files. Testers review branch `backend/science`. Do not merge to `main` unless asked.
- Contract field changed? (yes/no — if yes, also update docs/contracts/CHANGES.md): no
- Received: 2026-11-14 15:33 (Eymen / Tester 2) — Verified JS syntax, DOM IDs, and `?demo=1` tile guards; vendored `maplibre-gl@4.7.1` and `three@0.170.0` into `web/vendor/` so `?demo=1` is 100% offline (`BUG-12` fixed).


### HANDOFF-20261114-1330 — from backend-1 to frontend-1, backend-2, testers (follow-up to HANDOFF-20261114-1200)

- Date (Europe/Istanbul): 2026-11-14 13:30
- From (role, first name or nickname only, agent tool): backend-1, Cagan, Claude Code
- To (role, name if known): frontend-1, backend-2 (Doruk), tester-1 (Asil), tester-2 (Eymen)
- Board task id: MUST-02, MUST-03
- What is ready: (1) `data/processed/terrain/height-preview.png` is now an 8-bit RGB PNG: `value = R*256 + G`, `elevation_m = min + value/65535*(max-min)` with min and max from `height_preview_elevation_range_m` in `cost-map.json` (value 0 = no-data). The old 16-bit grey file would be read as 8-bit by a browser canvas. (2) `tilt-check.json`: DTM slope vs Curiosity tilt at 176 waypoints.
- Paths (files or folders): `data/processed/terrain/`, `docs/DATA_SOURCES.md`, `docs/contracts/cost-map.json` (note fields only)
- How to try it: decode a pixel as above; compare the min/max with `height_preview_elevation_range_m`.
- What is not done / known limits: The MUST-03 result does **not** confirm "DTM under-reads rover tilt" (medians 9.0 vs 8.6 deg at 5 m; weak correlation). I fixed that wording in B1-owned files only. Still using the old wording: AGENTS.md, ROADMAP.md, `.cursor/rules/data-and-map.mdc`, `skills/hud-3d`, `skills/map-ui`, `docs/JUDGING_CHECKLIST.md`, `docs/demo/*`, `docs/testing/must-checklist.md`, `docs/roles/tester-2.md`. Owners, please soften it, e.g. "DTM slope matches rover tilt only weakly; we keep a safety margin".
- Please do next: Frontend 1 reads the RGB height PNG; testers and Doruk update the wording in their files; whoever owns AGENTS.md / ROADMAP.md edits those (shared files, ask first).
- Contract field changed? (yes/no — if yes, also update docs/contracts/CHANGES.md): yes, additive (see CHANGES.md)
- Received:
 2026-11-14 13:54 (CC / Backend 3 integration) — Wording updated across docs/demo, docs/testing, docs/roles, docs/JUDGING_CHECKLIST, skills/, AGENTS.md, ROADMAP.md; height-preview.png updated on main to 8-bit RGB + synced to data/demo/.

### HANDOFF-20261114-1355 — from Backend 3 (integration) to Frontend 1, Backend 1, Backend 2, Testers

- Date (Europe/Istanbul): 2026-11-14 13:55
- From (role, first name or nickname only, agent tool): Backend 3 (integration cleanup), CC, Antigravity (Gemini)
- To (role, name if known): Frontend 1, Tester 2 (Eymen), Tester 1 (Asil), Backend 1 (Cagan), Backend 2 (Doruk)
- Board task id: MUST-02, MUST-05, MUST-06, SHOULD-01, SHOULD-07 (resolving `POSSIBLE_BUGS.md` BUG-02..BUG-08)
- What is ready:
  - `data/processed/terrain/height-preview.png` converted losslessly to 8-bit RGB (`R*256 + G`, `B=0`, `395x395`) and `height_preview_encoding` added to `cost-map.json` (BUG-01 terrain compatibility for browsers).
  - `pipeline/routing/build_route.py` updated to decode `height-preview.png`, compute real `elev_m`, `slope_deg`, `climb_m` (`38.3 m`), `descent_m` (`38.3 m`), fix `dose_mSv_see` (`data/processed/science/dose.json`), and expose flat top-level contract fields alongside `primary` and `samples[]` in `hud-telemetry.json` (BUG-02, BUG-03).
  - `data/processed/science/dose.json` rebuilt against `route.json` (`59.3 min` / `0.988 h` → `0.0263 ± 0.0049 mSv`, BUG-05).
  - `pipeline/data/export_demo_fixtures.py` updated to also export terrain and routing fixtures (`28` files total in `data/demo/`, listed in `data/demo/science-manifest.json`, BUG-06).
  - `MUST-03` tilt validation wording softened across non-frontend docs/skills/checklists/rules (BUG-07), and `pipeline/costmap/crop_window.py` turned into a re-export wrapper over `pipeline/terrain/crop_window.py` (BUG-08).
- Paths (files or folders): `data/processed/terrain/`, `data/processed/routing/`, `data/processed/science/dose.json`, `data/demo/`, `pipeline/routing/build_route.py`, `pipeline/data/export_demo_fixtures.py`, `pipeline/costmap/crop_window.py`, `POSSIBLE_BUGS.md`
- How to try it: Run `python pipeline/routing/build_route.py`, `python -m pipeline.data.build_dose`, and `python -m pipeline.data.export_demo_fixtures`.
- What is not done / known limits: `web/` (`BUG-01`) belongs to Frontend 1 and is untouched; `PRE-07` (`BUG-09`) still requires team stop lock so `stops.json`, `route.json`, and `dose.json` keep `is_example` / `status: example`.
- Please do next: Frontend 1 can build `web/` directly against `data/processed/` and `?demo=1` offline `data/demo/` fixtures; Testers verify BUG-02..BUG-08 fixes; team locks `PRE-07` stops when ready.
- Contract field changed? (yes/no — if yes, also update docs/contracts/CHANGES.md): yes, additive compatibility alignment documented in docs/contracts/CHANGES.md
- Received:

### HANDOFF-20261114-1409 — from Frontend 1 to Tester 1, Tester 2

- Date (Europe/Istanbul): 2026-11-14 14:09
- From (role, first name or nickname only, agent tool): Frontend 1, F1, Antigravity (Gemini)
- To (role, name if known): Tester 1 (Asil), Tester 2 (Eymen)
- Board task id: MUST-08, MUST-09, MUST-10, SHOULD-05, SHOULD-06, SHOULD-07
- What is ready: Full 2D MapLibre planner + 3D three.js first-person Mount Sharp terrain + helmet HUD (`web/index.html`, `web/planner/planner.js`, `web/hud/hud3d.js`, `web/shared/data-loader.js`, `web/shared/route-bridge.js`, `web/styles.css`). Includes `mm:set-route`, 4 MUST HUD readouts, elevation profile, DONKI banner, RAD dose card, REMS weather, Curiosity POV lightbox, 15°/20° hazard toggle, THEMIS/CRISM toggles, Credits/Honesty modal, and `?demo=1` demo-safe mode.
- Paths (files or folders): `web/`
- How to try it: Run `python -m http.server 8000` from the repo root and open `http://localhost:8000/web/` or `http://localhost:8000/web/?demo=1`.
- What is not done / known limits: MapLibre GL JS & Three.js load from CDN (`unpkg.com`); `data/` and `docs/` load locally. `ortho-preview.png` is read from `data/processed/terrain/` even in `?demo=1` because `data/demo/` does not bundle `ortho-preview.png`. Stops/route remain `example` until `PRE-07` locks.
- Please do next: Verify `MUST-08`..`MUST-10` and `SHOULD-05`..`SHOULD-07` in the browser and sign off on `BOARD.md`.
- Contract field changed? (yes/no — if yes, also update docs/contracts/CHANGES.md): no
- Received: 2026-11-14 15:33 (Eymen / Tester 2) — Verified JS syntax, DOM IDs, and `?demo=1` tile guards; vendored `maplibre-gl@4.7.1` and `three@0.170.0` into `web/vendor/` so `?demo=1` is 100% offline (`BUG-12` fixed).

### HANDOFF-20261114-1520 — from backend (Cagan) to Divarci, Eymen, Cetin

- Date (Europe/Istanbul): 2026-11-14 15:20
- From (role, first name or nickname only, agent tool): backend implementer, Cagan, Claude Code
- To (role, name if known): Divarci (visor), Eymen (review), Cetin (demo fixture export)
- Board task id: MUST-02, MUST-04, MUST-05, MUST-06
- What is ready: the four visor files now cite their NASA / PDS source in a top-level `sources[]` (name, product_id, url, fetch_date, used_for): `data/processed/terrain/cost-map.json`, `data/processed/routing/stops.json`, `route.json`, `hud-telemetry.json`. Stops also carry `source_url` and `source_fetch_date`. All stay `status: example` / `is_example: true`.
- Paths (files or folders): the four files above; generators `pipeline/costmap/make_cost_map.py`, `pipeline/stops/write_stops.py`, `pipeline/routing/build_route.py`
- How to try it: `python pipeline/stops/write_stops.py` then `python pipeline/routing/build_route.py` (both local, no network). Route: 132 points, 790.3 m, 0 points outside the grid or on blocked cells.
- What is not done / known limits: (1) `cost-map.json` got its `sources` block edited in place; the grid was not recomputed because the DTM re-download stalled. The generator has the same block for the next run. (2) `stop-mudstone-a` and `stop-mudstone-b` have **no NASA citation** (UNVERIFIED example points); PRE-07 must replace them. (3) `data/demo/` copies of these four files are now older than `data/processed/` (no `sources`); re-run `pipeline/data/export_demo_fixtures.py` (Cetin's tree, not edited here).
- Please do next: Divarci may ignore or show `sources[]` in the credits panel; Eymen reviews the PR; Cetin re-exports demo fixtures.
- Contract field changed? (yes/no — if yes, also update docs/contracts/CHANGES.md): yes, additive only (see CHANGES.md)
- Received:
