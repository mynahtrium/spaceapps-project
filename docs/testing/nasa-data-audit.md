# NASA Data & Demo-Safe Verification Log

**Checked:** 2026-11-14 15:21 Europe/Istanbul (commit `2b217d1`)  
**Reviewer:** Eymen (`ParongUs`, Bug tester 2)  
**Reference:** `docs/roles/prompts/eymen.md` §4

---

## 1. Source & Fetch Date Audit (`data/processed/`)

| File | Source / Citation Fields Found | Fetch / Computed Date | Result |
|---|---|---|---|
| `data/processed/terrain/cost-map.json` | HiRISE `DTEEC_019698` & `slope_stats.json` / `tilt-check.json` notes | 2026-11-14 | **PASS** (example-stop crop until `PRE-07` lock) |
| `data/processed/routing/stops.json` | MSL waypoints (`Sol 4527`, `Sol 4534`) + contract example mudstones | 2026-11-14 | **PASS** (`status: example` until `PRE-07` lock) |
| `data/processed/routing/route.json` | `data/processed/terrain/cost-map.json`, Mars radius | 2026-11-14 | **PASS** (`status: example`) |
| `data/processed/routing/hud-telemetry.json` | Derived from `route.json`, O₂ formula & placeholder note | 2026-11-14 | **PASS** (O₂ labelled illustrative placeholder) |
| `data/processed/science/alerts.json` | `source: "DONKI WSAEnlilSimulations (cached)"`, `source_urls: ["https://api.nasa.gov/", "https://ccmc.gsfc.nasa.gov/tools/DONKI/"]` | `2026-11-14T09:08:04Z` (via `donki-cache.json`) | **PASS** (live DONKI cache, Mars in `impactList`) |
| `data/processed/science/donki-cache.json` | `source: "NASA CCMC DONKI API (api.nasa.gov/DONKI)"` | `fetched_at: "2026-11-14T09:08:04Z"` | **PASS** |
| `data/processed/science/dose.json` | `baseline_source: "Hassler et al., Science 2014..."`, `baseline_url` | `computed_at: "2026-11-14T10:52:56Z"` | **PASS** (`baseline × duration`, no spatial rock map) |
| `data/processed/science/weather.json` | `archive_url` (NASA/CAB REMS RSS), `pds_archive_url` | `fetched_at: "2026-11-14T09:19:11Z"` | **PASS** |
| `data/processed/science/pov/index.json` | MSL raw-image feed (`msl-raw-images-cache.json`), never `mars-photos` | `fetched_at: "2026-11-14T10:04:55Z"` | **PASS** |
| `data/processed/science/layers-themis.json` | Mars Trek THEMIS Day/Night IR WMTS | `fetched_at: "2026-11-14T09:15:56Z"` | **PASS** |
| `data/processed/science/layers-crism.json` | PDS ODE REST API (`oderest.rsl.wustl.edu`) | `fetched_at: "2026-11-14T09:16:15Z"` | **PASS** |

## 2. Secrets, Deprecated APIs & Placeholder Labels

- **Secrets / `DEMO_KEY`:** `0` `.env` files or API key values in git. `DEMO_KEY` only appears in `pipeline/data/common.py` and `fetch_donki.py` as a refusal guard.
- **Deprecated `mars-photos`:** Never used in code (only mentioned in comments as "never use").
- **UI Labels (`web/index.html`):** Lunar slope stand-in label, `MUST-03` tilt caveat, and suit O₂ placeholder label are present in the UI.

## 3. `?demo=1` (Demo-Safe) Audit — **FAIL (Needs Fix)**

- **FAIL 1 (`web/planner/planner.js`):** Lines 19, 150, 166 register `https://trek.nasa.gov/...` WMTS tile URLs even when `?demo=1` is active (violates zero-network rule in `SHOULD-07`).
- **FAIL 2 (`web/index.html`):** MapLibre GL JS and Three.js load from `https://unpkg.com/...` CDN instead of local vendor files.
- **FAIL 3 (`web/shared/data-loader.js`):** Line 141–143 points `orthoPreviewUrl` to `../data/processed/terrain/ortho-preview.png` even when `demoSafe === true`.
- **FAIL 4 (`data/demo/` sync):** After commit `2b217d1`, `cost-map.json`, `stops.json`, `route.json`, and `hud-telemetry.json` in `data/demo/` are out of sync with `data/processed/`.
