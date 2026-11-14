# pipeline/routing/

Owned by **Backend 2** (Doruk).

## Scripts

| Script | Purpose |
|---|---|
| `write_stops.py` | Writes `data/processed/routing/stops.json` (example / PRE-07 open) |
| `build_route.py` | Dijkstra on a covering cost map, else labelled geodesic fallback; writes `route.json` + `hud-telemetry.json` |
| `dijkstra_grid.py` | 8-neighbour Dijkstra |
| `mars_geo.py` | Mars mean-radius distances |

```bash
# from repo root
python3 pipeline/routing/write_stops.py
python3 pipeline/routing/build_route.py
```

Needs `numpy` (`pip install -r pipeline/routing/requirements.txt`).

## PRE-07

Stops stay `status: example` / `is_example: true` until Doruk/team locks outcrops. See [PRE07_LOCK_REQUEST.md](./PRE07_LOCK_REQUEST.md). Habitat/boxwork use cited Sol 4527 / 4534 waypoint coords; mudstones use contract example points. No invented official outcrop names or mineral IDs.

Backend 1's current cost-map crop does **not** cover those lon/lats — `build_route.py` therefore writes a labelled Mars-radius geodesic fallback until B1 re-crops after lock.