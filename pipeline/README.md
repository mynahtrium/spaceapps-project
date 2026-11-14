# pipeline/

Backend Python, one folder per stage:

| Folder | What it does |
|---|---|
| `terrain/` | DTM crop, slope, ortho, tilt check |
| `costmap/` | cost / hazard map + height preview |
| `stops/` | science stops (`stops.json`) |
| `routing/` | Dijkstra / route + HUD telemetry |
| `data/` | REMS/RAD/DONKI/POV/weather/layers |

See [AGENTS.md](../AGENTS.md).
