# Possible Bugs & Integration Risks (`main`)

**Last checked:** 2026-11-14 15:21 Europe/Istanbul (commit `2b217d1`)  
**Checked by:** Eymen (`ParongUs`, Bug tester 2)  
**Scope:** Full audit of `web/`, `pipeline/`, `data/processed/`, `data/demo/`, and `docs/roles/prompts/eymen.md` §4 NASA data & `?demo=1` rules. See [docs/testing/nasa-data-audit.md](./docs/testing/nasa-data-audit.md) for the full source/date table.

---

## 1. Critical / Blocking Issues

### [BUG-12] `?demo=1` still makes external network calls to `trek.nasa.gov` and `unpkg.com` (`SHOULD-07` FAIL)
- **Where:** `web/planner/planner.js` (lines 19, 150, 166) and `web/index.html` (lines 7, 12, 193)
- **What:**
  - `planner.js` unconditionally adds `https://trek.nasa.gov/tiles/Mars/EQ/CTX_...`, `THEMIS_DayIR_...`, and `THEMIS_NightIR_...` WMTS sources to MapLibre even when `?demo=1` (`demoSafe === true`) is enabled.
  - `web/index.html` loads `maplibre-gl` CSS/JS and `three.js` from `https://unpkg.com/...` CDN.
- **Impact:** Fails the `SHOULD-07` / `eymen.md` §4 network-off check if stage Wi-Fi is off.
- **Suggested fix (Frontend 1):** Guard `trek.nasa.gov` sources behind `if (!data.demoSafe)` in `planner.js` (using local `slope-preview.png` / cached THEMIS tiles in `?demo=1`), and optionally vendor `maplibre-gl` and `three.js` under `web/vendor/`.

### [BUG-13] `data/demo/` is out of sync with `data/processed/` after commit `2b217d1`
- **Where:** `data/demo/cost-map.json`, `stops.json`, `route.json`, `hud-telemetry.json`
- **What:** Commit `2b217d1` added NASA/PDS citations to `data/processed/` (`cost-map.json`, `stops.json`, `route.json`, `hud-telemetry.json`), but `export_demo_fixtures.py` was not re-run afterwards, so the 4 copies in `data/demo/` are stale.
- **Suggested fix (Backend 3 / Backend 2):** Re-run `python -m pipeline.data.export_demo_fixtures` so `data/demo/` matches `data/processed/`.

### [BUG-14] `orthoPreviewUrl` points to `data/processed/` even in `?demo=1` mode
- **Where:** `web/shared/data-loader.js` (lines 141–143)
- **What:** `orthoPreviewUrl` returns `"../data/processed/terrain/ortho-preview.png"` in both normal and `demoSafe` modes (and `ortho-preview.png` is not bundled in `data/demo/`).
- **Suggested fix:** Bundle `ortho-preview.png` (560 KB) in `data/demo/` via `export_demo_fixtures.py` and switch `orthoPreviewUrl` to `${baseTerrainDir}/ortho-preview.png`.

---

## 2. Open / Tracking Items

### [FIXED] [BUG-01] `web/` application implemented (`3d9636b`, `262e469`, `78acf33`)
- Frontend 1 (`Dıvarcı`) shipped the 2D MapLibre planner, 3D three.js helmet HUD, `mm:set-route` bridge, and `?demo=1` loader. Needs browser sign-off after `BUG-12`..`BUG-14` are addressed.

### [BUG-09] `PRE-07` still blocked (`is_example: true` across stops, route, and dose)
- **Where:** `data/processed/routing/stops.json`, `route.json`, `data/processed/science/dose.json`
- **Suggested fix:** Team locks real Mount Sharp stops (`PRE-07`), then re-runs B1 → B2 → B3 + `export_demo_fixtures.py`.

### [BUG-10] `data/demo/*.json` still contains `"data/processed/..."` strings inside JSON fields
- **Where:** 13 JSON files in `data/demo/`
- **Note:** `web/shared/data-loader.js` already uses `baseTerrainDir` / `baseScienceDir` for top-level assets, which mitigates most of this, though `export_demo_fixtures.py` rewriting `data/processed/*/` → `data/demo/` would make the demo JSONs completely self-consistent.

### [BUG-11] `docs/team/ROSTER.md` missing GitHub usernames for B1–B3 and F1 (`PRE-01`)
- **Where:** `docs/team/ROSTER.md`

---

## 3. Passed Checks (as of `2b217d1` — 2026-11-14 15:21)
- **NASA Data & Citations (`eymen.md` §4):** All 11 processed terrain/routing/science JSONs have NASA/PDS source citations and fetch/compute dates; `alerts.json` & `donki-cache.json` are from live `api.nasa.gov/DONKI` (`2026-11-14T09:08:04Z`); `dose.json` uses Hassler et al. 2014 × duration; O₂ & lunar slope limits are labelled placeholders in `web/index.html`.
- **Secrets & Deprecated APIs:** `0` `.env` files, API keys, or `DEMO_KEY` values in repo; `api.nasa.gov/mars-photos` is never used.
- **Python syntax & JSON validity:** 28 / 28 `.py` files compile; 0 `NaN`/`Infinity` in `data/`.
