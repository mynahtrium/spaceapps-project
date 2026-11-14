# Contract checklist

**Owner:** Bug tester 1 (Asil)
**Use this on every PR** that adds or edits JSON under `docs/contracts/`, `data/processed/`, or `data/demo/`.
**Shapes:** [docs/contracts/README.md](../contracts/README.md) and [ROADMAP.md](../../ROADMAP.md) §3.
**This review:** `main` `d2c4695`, 2026-11-14 12:59 Europe/Istanbul. Document review only. No pipeline or web code was run or edited.

Frontend 1 must load `data/processed/...` first, then the matching file in `docs/contracts/`. Demo-safe mode (`DEMO_SAFE=1` or `?demo=1`) may load **only** `data/demo/`. If a demo file is missing, show an empty state and do not call the network.

## Steps (one file at a time)

1. Open the example in `docs/contracts/`.
2. Open the processed file in the table below. If `data/demo/` has a copy, open that too.
3. `contract` must be the same id string (for example `martian-mappers.stops.v1`).
4. Every **required** field below must exist, at the nesting the table names. Extra fields are allowed only when [CHANGES.md](../contracts/CHANGES.md) or this checklist already mentions them.
5. `status` and `is_example` must not say the stops are locked while PRE-07 is open.
6. Search the diff for `NASA_API_KEY`, `api_key`, and private-key blocks. A name in a note is fine. A value is not.
7. If the PR changes a field **name or meaning** in `docs/contracts/`, stop and require CHANGES.md, a handoff, and a board question in that same PR.

Marks: `PASS` (required fields present and honest), `GAP` (Frontend or the owner must handle a shape difference before the UI binds), `NOT YET` (file or loader missing). `PASS` here is not a MUST sign-off.

## Required fields

| File | Id | Required (processed may add fields; do not drop these) |
|---|---|---|
| `cost-map.json` | `martian-mappers.cost-map.v1` | `contract`, `status`, `crs`, `mars_radius_km`, `cell_size_m`, `bounds` (`west_lon_deg`, `south_lat_deg`, `east_lon_deg`, `north_lat_deg`), `grid`, `slope_limit_deg`, `slope_classes`, `blocked_sentinel`, `tilt_validation_note` or an equivalent honesty note, a preview path. Grid key may be `cost_row_major` (real) or `example_cost_row_major` (sample). |
| `stops.json` | `martian-mappers.stops.v1` | GeoJSON `FeatureCollection`. Each feature: `properties.id`, `name`, `kind`, `science_summary`, `is_example`; geometry `Point` in lon, lat. Kinds for MUST: `habitat`, `lake_sediment` (two), `boxwork_bonus`. |
| `route.json` | `martian-mappers.route.v1` | `route_id`, `stop_order`, `geometry` LineString (lon, lat), `legs`, `profile[]` with `s_m`, `elev_m`, `slope_deg`, `totals.distance_m`, `totals.climb_m`, `totals.duration_min_placeholder`, `mars_radius_km`, `slope_limit_note`. |
| `hud-telemetry.json` | `martian-mappers.hud-telemetry.v1` | On the sample object (file root **or** `primary` / each `samples[]` item): `along_route_m`, `position`, `distance_travelled_m`, `distance_to_next_stop_m`, `distance_remaining_m`, `slope_deg`, `slope_class`, `next_stop_id`, `next_stop_name`, `suit_o2_remaining_percent`, `suit_o2_note`. |
| `dose.json` | `martian-mappers.dose.v1` | `baseline_rate_mSv_per_day` (0.64), `baseline_uncertainty_mSv_per_day` (0.12), `baseline_source`, `baseline_url`, `eva_duration_h_placeholder`, `dose_estimate_mSv`, `dose_formula`, `shielding_note`. |
| `alerts.json` | `martian-mappers.alerts.v1` | `source`, `alerts[]` with `mars_in_impact_list`, `banner.text`. `status` should be `cached` once the demo cache exists. |
| `weather.json` | `martian-mappers.weather.v1` | `instrument`, `archive_url`, `site`, `samples` or a latest-sol object, `chosen_window`, `recommended_eva_window_note`. |
| `layers-themis.json` | `martian-mappers.layer-themis.v1` | `kind`, `mission`, `day`, `night`, `legend_note`. |
| `layers-crism.json` | `martian-mappers.layer-crism.v1` | `kind`, `mission`, `products`, `legend_note`. Empty `products` is allowed if the note says CRISM was skipped. |
| POV still | `martian-mappers.pov.v1` | Per stop: `stop_id`, `image_relpath` or `missing: true`, `missing_label`, `credit`. Path in the repo is `data/processed/science/pov/<id>.json` (the contract sample is `docs/contracts/pov-example.json`). The index file uses `martian-mappers.pov-index.v1`. |

`mm:set-route` is a browser event, not a JSON file. Payload is the route object plus `along_m` (0 at demo start). See ROADMAP §3.

## Review on `d2c4695` (2026-11-14 12:59 Europe/Istanbul)

Pattern search of `data/**/*.json` found no `NASA_API_KEY` or `api_key` value. `DEMO_SAFE` appears only as a description in `data/demo/science-manifest.json`.

| Processed file | Demo copy | Mark | What was checked |
|---|---|---|---|
| `data/processed/terrain/cost-map.json` | no | **PASS** (fields) | Same contract id as the example. Required bounds, grid 395×395, cell about 5.06 m, slope limits 20 and 15, four slope classes, sentinel `9e99`, DTM id `DTEEC_019698_1750_019988_1750_U01`. Real grid is `cost_row_major` (example key `example_cost_row_major` removed). Additive fields already logged in CHANGES.md: `height_preview_png_relpath`, `height_preview_elevation_range_m`, `roughness_note`. PNGs exist: `slope-preview.png`, `ortho-preview.png`, `height-preview.png`. `status` still says first-pass, crop not locked. |
| `data/processed/routing/stops.json` | no | **PASS** (shape) / lock **NOT YET** | Four features, required properties, `is_example: true` on all. Habitat and boxwork use cited Sol 4527 / 4534 coordinates; mudstones copy the contract example points. All four lon/lat values sit inside 4.73–5.04°S, 137.31–137.44°E. They sit **outside** the cost-map crop (north of 4.813°S by about 0.7–0.9 km). Extra `source` property. |
| `data/processed/routing/route.json` | no | **GAP** | Required route fields exist. `status` is `example`. `route_method` is `dijkstra_8_neighbour`. `cost_map_used` is `docs/contracts/cost-map.json`, not the HiRISE crop. Totals: distance 947.1 m, climb null, descent null, duration placeholder 71 min. Profile elevation and slope are null. Extra keys `route_method` and `cost_map_used` are fine if Frontend ignores unknown keys. |
| `data/processed/routing/hud-telemetry.json` | no | **GAP** | Contract example is **flat**. Processed root has `route_id`, `primary`, and `samples` only. Required HUD fields are on `primary` and on each sample, not on the root. `slope_class` is `unknown` where `slope_deg` is null. Suit O₂ note and formula match the example (`max(0, 100 * (1 - elapsed_min / planned_eva_min))`). One check: elapsed 39.5 min of 71 min → 44.4% remaining, matching `primary`. Frontend must read `primary` (or `samples[]`). Do not expect `along_route_m` on the root. |
| `data/processed/science/dose.json` | `data/demo/dose.json` (same keys) | **PASS** (math) / duration **GAP** | Baseline 0.64 ± 0.12, Hassler URL present, formula `baseline_rate_mSv_per_day * (eva_duration_h_placeholder / 24)`. 0.64 × (1.6 / 24) = 0.0427 mSv; 0.12 × (1.6 / 24) = 0.008 mSv. Matches the file. `route_source` is still `docs/contracts/route.json` (96 min). Processed `route.json` says 71 min. Refresh after PRE-07. `rad_tables_sol_range_available` records the PDS RAD TLS failure. No rock radiation map. |
| `data/processed/science/alerts.json` | `data/demo/alerts.json` | **PASS** (cache file) | `status: cached`. 13 alerts, every `mars_in_impact_list` is true. `banner.level` and `banner.text` exist. Window 2026-10-15 to 2026-11-14. Extra `window` and `counts`. Not a UI test. |
| `data/processed/science/weather.json` | `data/demo/weather.json` | **GAP** (one key) | `instrument`, `archive_url`, `site`, `samples`, `chosen_window`, `recommended_eva_window_note` exist. Latest sol in file: 4995; `total_sols_in_feed`: 4745. The example’s dated key `sol_range_available_as_of_2026-11-11` is **absent**. Frontend should use `latest_sol` / `total_sols_in_feed`, not that dated name. Daily min/max only. |
| `data/processed/science/layers-themis.json` | `data/demo/layers-themis.json` | **PASS** (metadata) | `kind`, `mission`, `day`, `night`, `legend_note`, `cached_tiles_relpath`. Six Gale sample tiles are in `data/processed/science/tiles/themis/` and copied under `data/demo/tiles/themis/`. Not a planner toggle test. |
| `data/processed/science/layers-crism.json` | `data/demo/layers-crism.json` | **PASS** (metadata) | Contract id `martian-mappers.layer-crism.v1`. `product_count` is 9 and `products` has 9 records. `legend_note` present. Not an overlay test. |
| `data/processed/science/pov/*.json` | `data/demo/pov/` | **PASS** (files) / stops **NOT YET** | Habitat sidecar id is `martian-mappers.pov.v1` with `stop_id`, `image_relpath`, `credit` (`NASA/JPL-Caltech`), `missing: false`. JPEG exists beside it. `is_example_stop` is true. Index id is `martian-mappers.pov-index.v1` with `count` 4. `stops_source` on the index still points at `docs/contracts/stops.json`. Re-fetch when stops lock. |

## What Frontend 1 should assume

- Cost grid: read `cost_row_major`. If that key is missing, fall back to `example_cost_row_major`.
- HUD: read `primary` when the root has no `along_route_m`.
- Dose card: show the baseline, the estimate, and the words placeholder duration. Hide nothing if the file is present; if the file is missing, hide the card.
- Alerts: if `alerts.json` is missing, hide the banner. Do not call DONKI from the page.
- Weather: do not require `sol_range_available_as_of_2026-11-11`.
- Demo-safe: science fixtures are in `data/demo/`. Terrain, stops, route, and HUD fixtures are **not** there yet. Missing file → empty state, no network.

## Sign-off

| Check | Mark | Date | Commit |
|---|---|---|---|
| Required fields on processed JSON listed above | PASS, except the HUD root shape and the weather dated key (both GAP, not silent renames of `docs/contracts/`) | 2026-11-14 | `d2c4695` |
| `docs/contracts/` examples still parse as the fallback shapes | PASS (unread by an app; files still match the README table) | 2026-11-14 | `d2c4695` |
| Demo-safe network-off | NOT YET | 2026-11-14 | `d2c4695` |
| Contract field rename in this review | none by Tester 1 | 2026-11-14 | `d2c4695` |
