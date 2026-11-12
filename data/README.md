# data/

- `raw/` — original downloads (HiRISE DTM/ortho, CRISM, rover tables, cached tiles). **Gitignored. Never commit.**
- `processed/terrain/` — Backend 1 (cost map, previews)
- `processed/routing/` — Backend 2 (stops, route, telemetry)
- `processed/science/` — Backend 3 (dose, alerts, weather, layers, POV)

Do not start the project data pipeline before 14 November 2026. Example JSON shapes (not computed products) live in [docs/contracts/](../docs/contracts/).
- `demo/` — bundled fixtures for demo-safe mode (`DEMO_SAFE=1` / `?demo=1`). Placeholder README only until after 14 November 2026.
