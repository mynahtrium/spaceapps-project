# Possible Bugs & Integration Risks (`main`)

**Last checked:** 2026-11-14 14:02 Europe/Istanbul (commit `0f200d0`)  
**Checked by:** Eymen (`ParongUs`, Bug tester 2); non-frontend fixes applied by CC (`backend-3`)  
**Scope:** Full repo audit (`pipeline/`, `data/processed/`, `data/demo/`, `web/`, `docs/`) after `tester/demo`, `tester/review`, and `f81df38` landed on `main`.

---

## 1. Critical / Blocking Issues

### [BUG-01] `web/` has no application code yet (`MUST-08`, `MUST-09`, `MUST-10`)
- **Where:** `web/planner/`, `web/hud/`, `web/shared/`
- **What:** Only `README.md` placeholder files exist; there is no MapLibre planner, three.js 3D view, or `mm:set-route` bridge yet, and Frontend 1 (`F1`) tasks on `docs/coordination/BOARD.md` are still `todo` / `TBD`.
- **Impact:** Blocks the Hour-16 MUST demo and all demo recordings.
- **Suggested fix:** Frontend 1 claims `MUST-08`..`MUST-10` and scaffolds the static web app loading `data/processed/` (and `data/demo/` for `?demo=1`) with fallback to `docs/contracts/`. *(Note: `height-preview.png` on `main` is now 8-bit RGB `R*256+G` per `height_preview_encoding` in `cost-map.json`.)*

### [FIXED] [BUG-02] `route.json` elevation/climb & `dose_mSv_see`
- **Where:** `pipeline/routing/build_route.py`, `data/processed/routing/route.json`
- **Status:** Fixed on 2026-11-14 13:55:
  - Added pure-Python PNG decoding of 8-bit RGB (`R*256+G`) `data/processed/terrain/height-preview.png` and finite-difference slope sampling in `build_route.py`.
  - `route.json` now populates `profile[].elev_m`, `profile[].slope_deg`, `totals.climb_m` (`38.3`), `totals.descent_m` (`38.3`), and `totals.dose_mSv_see` (`"data/processed/science/dose.json"`).

### [FIXED] [BUG-03] `hud-telemetry.json` top-level schema compatibility vs. contract
- **Where:** `pipeline/routing/build_route.py`, `data/processed/routing/hud-telemetry.json`, `docs/contracts/CHANGES.md`
- **Status:** Fixed on 2026-11-14 13:55:
  - `hud-telemetry.json` now exposes all flat top-level contract keys (`along_route_m`, `position`, `heading_deg`, `distance_travelled_m`, `distance_to_next_stop_m`, `distance_remaining_m`, `slope_deg`, `slope_class`, `next_stop_id`, `next_stop_name`, `elapsed_min_placeholder`, `planned_eva_min_placeholder`, `suit_o2_remaining_percent`, `suit_o2_formula`, `suit_o2_note`) **alongside** `primary` and `samples[]`.
  - Documented in `docs/contracts/CHANGES.md` and `HANDOFF-20261114-1355`. Frontend 1 can still safely read `data.primary ?? data` or top-level keys directly.

---

## 2. Sync, Pipeline & Contract Warnings

### [BUG-04] `cost-map.json` key differences vs. contract (Frontend 1 note)
- **Where:** `data/processed/terrain/cost-map.json` vs. `docs/contracts/cost-map.json`
- **What:** Processed file uses `cost_row_major` (instead of `example_cost_row_major`) as a 1D flat array (`156025` floats = `395 × 395`). Also includes `height_preview_encoding` (`R*256+G`, `bit_depth=8`, `color_type=2` RGB).
- **Suggested fix:** Frontend 1 must support `cost_row_major ?? example_cost_row_major` and use `grid.nrows` / `grid.ncols` to index the 1D array.

### [FIXED] [BUG-05] `dose.json` synced with latest `route.json` duration (`59.3 min`)
- **Where:** `data/processed/science/dose.json` and `data/demo/dose.json`
- **Status:** Fixed on 2026-11-14 13:55 — re-ran `python -m pipeline.data.build_dose`, updating `dose.json` to `59.3 min` (`0.988 h` → `0.0263 ± 0.0049 mSv`), and re-exported to `data/demo/dose.json`.

### [FIXED] [BUG-06] `data/demo/` now bundles terrain & routing fixtures (`SHOULD-07`)
- **Where:** `pipeline/data/export_demo_fixtures.py`, `data/demo/`
- **Status:** Fixed on 2026-11-14 13:55 — updated `export_demo_fixtures.py` and re-ran it to copy `cost-map.json`, `slope-preview.png`, `height-preview.png`, `stops.json`, `route.json`, and `hud-telemetry.json` alongside the science fixtures (`28` total files listed in `data/demo/science-manifest.json`). Note: re-run again after `PRE-07` locks stops.

### [FIXED] [BUG-07] `MUST-03` tilt validation wording updated across non-frontend docs
- **Where:** `docs/demo/{script.md,slides-outline.md,submission-checklist.md}`, `docs/testing/must-checklist.md`, `docs/roles/tester-2.md`, `docs/JUDGING_CHECKLIST.md`, `.cursor/rules/data-and-map.mdc`, `skills/{hud-3d,map-ui}/SKILL.md`, `AGENTS.md`, `ROADMAP.md`
- **Status:** Fixed on 2026-11-14 13:55 — softened outdated "DTM under-reads tilt" wording to match `tilt-check.json` (~5 m medians `9.0°` vs `8.6°`, weak correlation, keep a safety margin).

### [FIXED] [BUG-08] Duplicate `crop_window.py` consolidated
- **Where:** `pipeline/terrain/crop_window.py` and `pipeline/costmap/crop_window.py`
- **Status:** Fixed on 2026-11-14 13:55 — replaced the duplicate copy in `pipeline/costmap/crop_window.py` with a thin re-export wrapper loading canonical `pipeline/terrain/crop_window.py`.

### [BUG-09] `PRE-07` still blocked (`is_example: true` across stops, route, and dose)
- **Where:** `data/processed/routing/stops.json`, `route.json`, `data/processed/science/dose.json`
- **What:** All stops are still `is_example: true` and `dose.json` has `status: "example"`.
- **Suggested fix:** Team locks real Curiosity/Mount Sharp stops (`PRE-07`), then re-runs B1 → B2 → B3 + `export_demo_fixtures.py` once so `is_example` can be cleared.

### [BUG-10] `data/demo/*.json` still references `data/processed/...` asset paths (`SHOULD-07` risk)
- **Where:** 13 JSON files in `data/demo/` (`cost-map.json`, `route.json`, `dose.json`, `layers-themis.json`, `pov/index.json`, `pov/stop-*.json`, `alerts*.json`, `layers-crism.json`)
- **What:** `export_demo_fixtures.py` copies `data/processed/` JSONs verbatim into `data/demo/`, so fields like `preview_png_relpath` (`data/processed/terrain/slope-preview.png`), `height_preview_png_relpath`, `dose_mSv_see`, and POV/tile paths still point to `data/processed/` instead of `data/demo/`.
- **Impact:** In `?demo=1` mode, if Frontend 1 loads nested asset paths directly from the JSON without rewriting `data/processed/<domain>/` → `data/demo/`, it will read from `data/processed/` (or break if only `data/demo/` is bundled).
- **Suggested fix:** Either rewrite `data/processed/(terrain|routing|science)/` → `data/demo/` in `export_demo_fixtures.py`, or have Frontend 1's `?demo=1` loader normalize `data/processed/*/` paths to `data/demo/`.

---

## 3. Passed Checks (as of `0f200d0` — 2026-11-14 14:02)
- **Python syntax:** 28 / 28 files in `pipeline/` compiled cleanly (`py_compile`); `pipeline/costmap/crop_window.py` wrapper import verified.
- **JSON validity & NaN/Inf:** 49 / 49 `.json` files parsed cleanly with `0` `NaN`/`Infinity` values; 9 / 9 core JSONs match 1:1 between `data/processed/` and `data/demo/`.
- **3D Height PNG format:** `height-preview.png` verified as `395×395` `8-bit RGB` (`bit_depth=8`, `color_type=2`, `332269` bytes) in both `data/processed/terrain/` and `data/demo/`.
- **Cost-map ↔ Stops alignment:** 4 / 4 stops in `stops.json` sit inside `cost-map.json` bounds.
- **Merge hygiene & static size:** `0` conflict markers found; no `.env`, API keys, `.IMG`, `.tif`, or `.jp2` files tracked; `data/` total is **4.50 MB** (well under the ~100 MB target).
