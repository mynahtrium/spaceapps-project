# Possible Bugs & Integration Risks (`main`)

**Last checked:** 2026-11-14 15:31 Europe/Istanbul (commit `20fc36f`)  
**Checked by:** Eymen (`ParongUs`, Bug tester 2)  
**Scope:** Deep verification of `web/` JS syntax (`node --check`), DOM ID matching, `?demo=1` network guards, `data/demo/` sync (`20fc36f`), and NASA data citations. See [docs/testing/nasa-data-audit.md](./docs/testing/nasa-data-audit.md).

---

## 1. Critical / Blocking Issues

### [BUG-12] `web/index.html` loads `maplibre-gl` and `three.js` from `unpkg.com` CDN (`SHOULD-07` offline risk)
- **Where:** `web/index.html` (lines 7, 12, 193)
- **What:**
  - *(Verified OK)* `web/planner/planner.js` already guards `trek.nasa.gov` CTX and THEMIS WMTS tiles behind `if (!demoSafe)` (lines 15, 146).
  - *(Still open)* `web/index.html` loads `maplibre-gl` CSS/JS and `three.js` from `https://unpkg.com/...` CDN. If stage Wi-Fi is off and the browser cache is cold, MapLibre and Three.js will fail to load even in `?demo=1` mode.
- **Suggested fix (Frontend 1):** Vendor `maplibre-gl` and `three.js` locally under `web/vendor/` (or ensure browser cache is pre-warmed on the demo machine).

### [FIXED] [BUG-13] `data/demo/` synced with `data/processed/` (`20fc36f`)
- Verified 1:1 match for `cost-map.json`, `stops.json`, `route.json`, `hud-telemetry.json`, `alerts.json`, and `dose.json`.

### [FIXED] [BUG-14] `orthoPreviewUrl` now serves from `data/demo/` in `?demo=1` (`20fc36f`)
- `data/demo/ortho-preview.png` is bundled and `web/shared/data-loader.js` points `orthoPreviewUrl` to `${baseTerrainDir}/ortho-preview.png`.

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

## 3. Passed Checks (as of `20fc36f` — 2026-11-14 15:31)
- **Web JS syntax & DOM IDs:** `node --check` passed on all 5 JS files (`app.js`, `planner.js`, `hud3d.js`, `data-loader.js`, `route-bridge.js`); `0` missing DOM `getElementById` references against `web/index.html`.
- **Demo-Safe Sync (`20fc36f`):** `data/processed/` and `data/demo/` match 1:1 on all core JSONs, and `data/demo/ortho-preview.png` is bundled. `planner.js` properly skips `trek.nasa.gov` tiles when `?demo=1` is active.
- **NASA Data & Citations (`eymen.md` §4):** All 11 processed terrain/routing/science JSONs have NASA/PDS source citations and fetch/compute dates; `alerts.json` & `donki-cache.json` are from live `api.nasa.gov/DONKI` (`2026-11-14T09:08:04Z`); `dose.json` uses Hassler et al. 2014 × duration; O₂ & lunar slope limits are labelled placeholders in `web/index.html`.
- **Secrets & Deprecated APIs:** `0` `.env` files, API keys, or `DEMO_KEY` values in repo; `api.nasa.gov/mars-photos` is never used.
- **Python syntax & JSON validity:** 28 / 28 `.py` files compile; 0 `NaN`/`Infinity` in `data/`.
