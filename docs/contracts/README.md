# Interface contracts (example payloads)

These JSON files are **static sample data**, not computed science products and not application code. Coordinates are **placeholders** near Curiosity's published Mount Sharp traverse (about 4.80°S, 137.39°E). They are not locked outcrops.

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

If you change a field name, update this folder, `data/processed/` (once it exists), the roadmap table, and tell Frontend 1 and both testers in the same PR.
