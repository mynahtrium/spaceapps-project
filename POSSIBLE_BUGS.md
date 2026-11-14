# Possible Bugs & Integration Risks (`main`)

**Checked:** 2026-11-14 13:33 Europe/Istanbul  
**Checked by:** Eymen (`ParongUs`, Bug tester 2)  
**Scope:** Static analysis of `pipeline/`, `data/processed/`, `data/demo/`, `web/`, and `docs/contracts/` on `main` (commit `7374fa6`).

---

## 1. Critical / Blocking Issues

### [BUG-01] `web/` has no application code yet (`MUST-08`, `MUST-09`, `MUST-10`)
- **Where:** `web/planner/`, `web/hud/`, `web/shared/`
- **What:** Only `README.md` placeholder files exist; there is no MapLibre planner, three.js 3D view, or `mm:set-route` bridge yet, and Frontend 1 (`F1`) tasks on `docs/coordination/BOARD.md` are still `todo` / `TBD`.
- **Impact:** Blocks the Hour-16 MUST demo and all demo recordings.
- **Suggested fix:** Frontend 1 claims `MUST-08`..`MUST-10` and scaffolds the static web app loading `data/processed/` with fallback to `docs/contracts/`.

### [BUG-02] Terrain `cost-map.json` bounds do not cover `stops.json` (`PRE-07` blocker)
- **Where:** `data/processed/terrain/cost-map.json` vs. `data/processed/routing/stops.json` & `data/processed/routing/route.json`
- **What:**
  - `cost-map.json` covers `lat: -4.8468 .. -4.8131`, `lon: 137.3731 .. 137.4068` (centred near Sol 5070).
  - `stops.json` stops sit at `lat: -4.7972 .. -4.8015`, `lon: 137.3864 .. 137.3915` (0 / 4 stops inside the terrain crop).
  - Because `stops.json` falls outside `cost-map.json`, `pipeline/routing/build_route.py` fell back to `docs/contracts/cost-map.json`, leaving `climb_m: null`, `descent_m: null`, and `profile[].elev_m: null` / `slope_deg: null` in `route.json`.
- **Suggested fix:** Once `PRE-07` locks the real stop coordinates, Backend 1 re-runs `make_slope.py` and `make_cost_map.py` centred on the locked stops, then Backend 2 re-runs `build_route.py`.

### [BUG-03] `hud-telemetry.json` top-level schema mismatch vs. contract
- **Where:** `data/processed/routing/hud-telemetry.json` vs. `docs/contracts/hud-telemetry.json`
- **What:** `docs/contracts/hud-telemetry.json` defines `along_route_m`, `slope_deg`, `next_stop_id`, `suit_o2_remaining_percent`, etc. at the **top level** of the JSON object. `data/processed/routing/hud-telemetry.json` wraps them inside `primary` and `samples[]`, so those keys are missing at the top level.
- **Impact:** If Frontend 1 reads top-level keys per the contract, the HUD will show `undefined` when switching to `data/processed/routing/hud-telemetry.json`.
- **Suggested fix:** Either Frontend 1 reads `data.primary ?? data` (supporting both), or Backend 2 documents the wrapper in `docs/contracts/CHANGES.md` and `docs/coordination/HANDOFFS.md`.

---

## 2. Sync & Contract Warnings

### [BUG-04] `cost-map.json` key differences vs. contract
- **Where:** `data/processed/terrain/cost-map.json` vs. `docs/contracts/cost-map.json`
- **What:** Processed file uses `cost_row_major` (instead of `example_cost_row_major`) and `roughness_note` (instead of `note`). Both are expected for real vs. example data, and `cost_row_major` is a 1D flat array (`156025` floats = `395 × 395`).
- **Suggested fix:** Frontend 1 and Backend 2 must support `cost_row_major ?? example_cost_row_major` and use `grid.nrows` / `grid.ncols` to index the 1D array.

### [BUG-05] `dose.json` still uses contract route duration (`96.0 min`) instead of `processed/routing/route.json` (`71.0 min`)
- **Where:** `data/processed/science/dose.json`
- **What:** `dose.json` was generated before `data/processed/routing/route.json` landed (`route_source: "docs/contracts/route.json"`, `status: "placeholder-duration"`).
- **Suggested fix:** Backend 3 re-runs `pipeline/data/build_dose.py` after Backend 2 generates the final route on the covering DTM.

### [BUG-06] `data/demo/` is missing terrain & routing fixtures (`SHOULD-07`)
- **Where:** `data/demo/`
- **What:** Only Backend 3's science fixtures (`alerts.json`, `dose.json`, `weather.json`, `layers-*.json`, `pov/`, `tiles/`) are currently in `data/demo/`. Terrain (`cost-map.json`, `height-preview.png`) and routing (`stops.json`, `route.json`, `hud-telemetry.json`) fixtures are not copied into `data/demo/` yet.
- **Suggested fix:** After MUST/PRE-07 freeze, Backend 1 and Backend 2 copy small frozen fixtures into `data/demo/` so `?demo=1` works 100% offline.

### [BUG-07] Demo slides/script note: DTM tilt under-read claim was not confirmed in `MUST-03`
- **Where:** `data/processed/terrain/tilt-check.json` vs. `docs/demo/slides-outline.md` & `docs/demo/script.md`
- **What:** Backend 1's `MUST-03` check over 176 Curiosity waypoints found median DTM slope (`9.0°` at 5 m) and rover tilt (`8.6°`) agree closely (weak correlation `r = 0.11–0.15`), rather than a systematic under-read.
- **Suggested fix:** Update slide/script wording before Hour 40 freeze to reflect the actual `tilt-check.json` finding while keeping the safety-margin note.

---

## 3. Passed Checks (as of `7374fa6`)
- **Python syntax:** 24 / 24 files in `pipeline/` compiled cleanly (`py_compile`).
- **Secrets & bulky files:** No `.env`, API keys, `.IMG`, `.tif`, or `.jp2` files tracked in git.
- **Static size:** `data/` total is **3.23 MB** (well under the ~100 MB target).
