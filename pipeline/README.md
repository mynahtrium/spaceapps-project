# pipeline/

Backend Python lives in **five** folder-scoped long-lived branches (merged into the full project only in a later pass):

| Folder | Branch | Role |
|---|---|---|
| `terrain/` | `backend/terrain` | Backend 1 — DTM crop, slope, ortho, tilt check |
| `costmap/` | `backend/costmap` | Backend 1 — cost / hazard map + height preview |
| `stops/` | `backend/stops` | Backend 2 — science stops (`stops.json`) |
| `routing/` | `backend/routing` | Backend 2 — Dijkstra / route + HUD telemetry |
| `data/` | `backend/science` | Backend 3 — REMS/RAD/DONKI/POV/weather/layers |

See [ROADMAP.md](../ROADMAP.md) and [docs/roles/](../docs/roles/).
