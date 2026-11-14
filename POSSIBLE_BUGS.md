# Possible Bugs & Integration Risks (`main`)

**Last checked:** 2026-11-14 13:43 Europe/Istanbul (commit `5542207`)  
**Checked by:** Eymen (`ParongUs`, Bug tester 2)  
**Scope:** Static analysis of `pipeline/`, `data/processed/`, `data/demo/`, `web/`, and `docs/contracts/` after the 5-branch backend merge (`terrain`, `costmap`, `stops`, `routing`, `science`).

---

## 1. Critical / Blocking Issues

### [BUG-01] `web/` has no application code yet (`MUST-08`, `MUST-09`, `MUST-10`)
- **Where:** `web/planner/`, `web/hud/`, `web/shared/`
- **What:** Only `README.md` placeholder files exist; there is no MapLibre planner, three.js 3D view, or `mm:set-route` bridge yet, and Frontend 1 (`F1`) tasks on `docs/coordination/BOARD.md` are still `todo` / `TBD`.
- **Impact:** Blocks the Hour-16 MUST demo and all demo recordings.
- **Suggested fix:** Frontend 1 claims `MUST-08`..`MUST-10` and scaffolds the static web app loading `data/processed/` with fallback to `docs/contracts/`.

### [BUG-02] `route.json` still has `null` elevation/climb and points `dose_mSv_see` to `docs/contracts/dose.json`
- **Where:** `data/processed/routing/route.json`
- **What:**
  - *(Fixed since last check)* `cost-map.json` now covers all 4 stops in `stops.json` (`lat -4.8169..-4.7832`, `lon 137.3728..137.4065`), and `route.json` now uses `dijkstra_8_neighbour` on `data/processed/terrain/cost-map.json` (`distance_m: 790.3`, `duration_min_placeholder: 59.3`).
  - *(Still open)* `totals.climb_m`, `totals.descent_m`, `profile[].elev_m`, and `profile[].slope_deg` are all `null` because `build_route.py` does not sample elevation from `height-preview.png` (`height_preview_elevation_range_m`) or the DTM.
  - Also `totals.dose_mSv_see` still points to `"docs/contracts/dose.json"` instead of `"data/processed/science/dose.json"`.
- **Suggested fix:** Sample elevation/slope along the path from `height-preview.png` (or DTM) in `build_route.py` if time permits, and point `dose_mSv_see` to `data/processed/science/dose.json`.

### [BUG-03] `hud-telemetry.json` top-level schema mismatch vs. contract
- **Where:** `data/processed/routing/hud-telemetry.json` vs. `docs/contracts/hud-telemetry.json`
- **What:** `docs/contracts/hud-telemetry.json` defines `along_route_m`, `slope_deg`, `next_stop_id`, `suit_o2_remaining_percent`, etc. at the **top level** of the JSON object. `data/processed/routing/hud-telemetry.json` wraps them inside `primary` and `samples[]`, so those keys are missing at the top level.
- **Impact:** If Frontend 1 reads top-level keys per the contract, the HUD will show `undefined`.
- **Suggested fix:** Frontend 1 should read `data.primary ?? data` (supporting both), and Backend 2 should document the wrapper in `docs/contracts/CHANGES.md` and `docs/coordination/HANDOFFS.md`.

---

## 2. Sync, Pipeline & Contract Warnings

### [BUG-04] `cost-map.json` key differences vs. contract
- **Where:** `data/processed/terrain/cost-map.json` vs. `docs/contracts/cost-map.json`
- **What:** Processed file uses `cost_row_major` (instead of `example_cost_row_major`) as a 1D flat array (`156025` floats = `395 × 395`).
- **Suggested fix:** Frontend 1 must support `cost_row_major ?? example_cost_row_major` and use `grid.nrows` / `grid.ncols` to index the 1D array.

### [BUG-05] `dose.json` is out of sync with the latest `route.json` duration (`71.0 min` vs. `59.3 min`)
- **Where:** `data/processed/science/dose.json` and `data/demo/dose.json`
- **What:** `dose.json` now reads `data/processed/routing/route.json`, **but** it was generated against the older `71.0 min` route (`0.0315 mSv`). The merged `route.json` is now `59.3 min` (`790.3 m`).
- **Suggested fix:** Backend 3 re-runs `pipeline/data/build_dose.py` (and `export_demo_fixtures.py`) so `dose.json` reflects `59.3 min` (`~0.0263 mSv`).

### [BUG-06] `data/demo/` is missing terrain & routing fixtures (`SHOULD-07`)
- **Where:** `data/demo/`
- **What:** Only Backend 3's science fixtures (`alerts.json`, `dose.json`, `weather.json`, `layers-*.json`, `pov/`, `tiles/`) are in `data/demo/`. Terrain (`cost-map.json`, `height-preview.png`) and routing (`stops.json`, `route.json`, `hud-telemetry.json`) fixtures are not copied into `data/demo/` yet.
- **Suggested fix:** After `PRE-07` lock, Backend 1 and Backend 2 copy small frozen fixtures into `data/demo/` so `?demo=1` works 100% offline.

### [BUG-07] Demo slides/script note: DTM tilt under-read claim was not confirmed in `MUST-03`
- **Where:** `data/processed/terrain/tilt-check.json` vs. `docs/demo/slides-outline.md` & `docs/demo/script.md`
- **What:** Backend 1's `MUST-03` check over 176 Curiosity waypoints found median DTM slope (`9.0°` at 5 m) and rover tilt (`8.6°`) agree closely (weak correlation `r = 0.11–0.15`), rather than a systematic under-read.
- **Suggested fix:** Update slide/script wording before Hour 40 freeze to reflect the actual `tilt-check.json` finding while keeping the safety-margin note.

### [BUG-08] Duplicate `crop_window.py` in `pipeline/terrain/` and `pipeline/costmap/`
- **Where:** `pipeline/terrain/crop_window.py` and `pipeline/costmap/crop_window.py`
- **What:** Both files are identical 85-line copies created during the backend folder split. Editing one without the other can cause silent crop/coordinate drift between terrain previews and the cost map.
- **Suggested fix:** Keep both files identical if edited before final integration, or consolidate into one shared helper after freeze.

### [BUG-09] `PRE-07` still blocked (`is_example: true` across stops, route, and dose)
- **Where:** `data/processed/routing/stops.json`, `route.json`, `data/processed/science/dose.json`
- **What:** All stops are still `is_example: true` and `dose.json` has `status: "example"`.
- **Suggested fix:** Team locks real Curiosity/Mount Sharp stops (`PRE-07`), then re-runs B1 → B2 → B3 once so `is_example` can be cleared.

---

## 3. Passed Checks (as of `5542207`)
- **Python syntax:** 28 / 28 files in `pipeline/` compiled cleanly (`py_compile`).
- **Cost-map ↔ Stops alignment:** 4 / 4 stops in `stops.json` now sit inside `cost-map.json` bounds.
- **Secrets & bulky files:** No `.env`, API keys, `.IMG`, `.tif`, or `.jp2` files tracked in git.
- **Static size:** `data/` total is **3.23 MB** (well under the ~100 MB target).
