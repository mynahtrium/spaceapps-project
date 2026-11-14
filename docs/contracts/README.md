# Interface contracts (example payloads)

These JSON files are **static sample data**, not computed science products and not application code. Coordinates are **placeholders** near Curiosity's published Mount Sharp traverse (about 4.80°S, 137.39°E). They are not locked outcrops. A 13 November 2026 check of NASA's [MSL waypoints](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json) is in [docs/testing/STOP_COORDINATE_CHECK.md](../testing/STOP_COORDINATE_CHECK.md): the example points in [stops.json](./stops.json) are about 100–900 m off the traverse and stay illustrative; stop values in that file were not changed.

After 14 November 2026, backends write real (still small) files under `data/processed/` using the **same field names**. The web app must load `data/processed/...` first and fall back here if a file is missing.

| File | Owner | Optional API |
|---|---|---|
| [cost-map.json](./cost-map.json) | Backend 1 | `GET /api/cost-map` |
| [stops.json](./stops.json) | Backend 2 | `GET /api/stops` |
| [route.json](./route.json) | Backend 2 | `GET /api/route` |
| [hud-telemetry.json](./hud-telemetry.json) | Backend 2 | `GET /api/hud/telemetry?along_m=` |
| [dose.json](./dose.json) | Backend 3 | `GET /api/dose` |
| [alerts.json](./alerts.json) | Backend 3 | `GET /api/alerts` |
| [weather.json](./weather.json) | Backend 3 | `GET /api/weather` |
| [layers-themis.json](./layers-themis.json) | Backend 3 | `GET /api/layers/themis` |
| [layers-crism.json](./layers-crism.json) | Backend 3 | `GET /api/layers/crism` |
| [pov-example.json](./pov-example.json) | Backend 3 | `GET /api/stops/:id/pov` |

Planner → HUD in the browser: event `mm:set-route` with a `route` object (see [ROADMAP.md](../../ROADMAP.md) §3).

If you change a field name, meaning, or file, you must in the **same PR**:

1. Update the example JSON in this folder, and after 14 November any matching `data/processed/` and `data/demo/` fixtures.
2. Add a row to [CHANGES.md](./CHANGES.md).
3. Tell whoever uses that file.

Do not silently rename fields. The same rule is in [AGENTS.md](../../AGENTS.md).

## Demo-safe fixtures

Demo-safe mode (`DEMO_SAFE=1` or `?demo=1`) must load **only** bundled files from [data/demo/](../../data/demo/README.md) — the same field names as these contracts, frozen for the stage machine, with **no network, NASA, or DONKI calls**. This is a **spec** until 14 November (no application code in this folder). Frontend 1 owns the loader; backends own the fixture files; Tester 1 checks that the network stays quiet. See [ROADMAP.md](../../ROADMAP.md) and board task SHOULD-07.
