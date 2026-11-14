# Possible Bugs & Integration Risks (`main`)

**Last checked:** 2026-11-14 16:48 Europe/Istanbul (commit `2860d7e`)  
**Checked by:** Eymen (`ParongUs`, Bug tester 2)  
**Scope:** Live browser test + code/manifest audit of the new Bodycam / Mark III Spacesuit HUD (`2860d7e`). See [docs/testing/nasa-data-audit.md](./docs/testing/nasa-data-audit.md).

---

## 1. Critical / Blocking Issues

### [FIXED] [BUG-12] `web/index.html` CDN dependencies vendored locally (`SHOULD-07`)
- **Where:** `web/vendor/` (`maplibre-gl.css`, `maplibre-gl.js`, `three.module.js`) and `web/index.html`
- **Status:** Fixed on 2026-11-14 15:33 — downloaded `maplibre-gl@4.7.1` and `three@0.170.0` (`2.18 MB` total) into `web/vendor/` and updated `web/index.html` to load them locally. `?demo=1` now makes **0** external network requests.

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

### [FIXED] [BUG-15] 3D HUD `NEXT` stop shows the *nearest* stop instead of the *upcoming* stop along `route.legs`
- **Where:** `web/hud/hud3d.js` (`updateHudReadouts`) and `web/shared/route-bridge.js` (`resolveNextStopAlongRoute`)
- **Status:** Fixed — `resolveNextStopAlongRoute(activeRoute, stops, sM, [lon, lat])` walks `activeRoute.legs` (`to ?? to_stop_id` and cumulative `distance_m`) for the current `sM` so `NEXT` tracks the upcoming stop and counts down route distance cleanly, falling back to `marsDistanceM` only if `legs` are absent.

### [FIXED] [BUG-16] 3D HUD `remaining` distance (`824.7 m`) disagrees with `route.json` `totals.distance_m` (`790.3 m`)
- **Where:** `web/hud/hud3d.js` (`totalDist`, `toGeomDist`, `updateHudReadouts`) and `web/shared/route-bridge.js`
- **Status:** Fixed — `totalDist` uses `activeRoute.totals.distance_m` (`790.3 m`) when present (falling back to Mars spherical polyline length `geomTotalDist`), `toGeomDist(s)` maps reported walk progress proportionally onto `geomTotalDist` for `sampleAlongRoute`, and `updateHudReadouts` receives `alongM` directly so `0.0 m → 790.3 m`, `remaining`, `profile`, and `scrubber` match `route.json` and the 2D planner.

---

## 3. Passed Checks (as of `2860d7e` — 2026-11-14 16:48)
- **Live Browser Test (`?demo=1`):** Tested `http://localhost:8000/web/?demo=1` with **0 console errors** — 2D planner, `Begin EVA` transition, rigged NASA Mark III spacesuit, `Play` walking animation, `Tex: relief` ↔ `Tex: ortho`, `Rover POV` modal, and all 4 MUST HUD readouts worked.
- **Web JS syntax & DOM IDs:** `node --check` passed on all 6 non-vendor JS files (`app.js`, `astronaut-rig.js`, `planner.js`, `hud3d.js`, `data-loader.js`, `route-bridge.js`); `0` missing DOM `getElementById` references.
- **Demo-Safe & Assets (`2860d7e`):** `data/demo/science-manifest.json` has `0` missing/unlisted files (`texture-relief.jpg` included); `web/assets/nasa-3d/SOURCE.md` cites `NASA-3D-Resources` (`2026-11-14`); `data/` (15.33 MB) + `web/` (4.17 MB) = **19.50 MB** total.
- **Secrets & Deprecated APIs:** `0` `.env` files, API keys, or `DEMO_KEY` values in repo; `api.nasa.gov/mars-photos` is never used.
