# pipeline/routing/

Owned by **Backend 2** (Doruk).

## Scripts

| Script | Purpose |
|---|---|
| `build_route.py` | Dijkstra on a covering cost map, else labelled geodesic fallback; writes `route.json` + `hud-telemetry.json` |
| `dijkstra_grid.py` | 8-neighbour Dijkstra |
| `mars_geo.py` | Mars mean-radius distances |

```bash
# from repo root
python3 pipeline/stops/write_stops.py
python3 pipeline/routing/build_route.py
```

Needs `numpy` (`pip install -r pipeline/routing/requirements.txt`).

## PRE-07

Stops stay `status: example` / `is_example: true` until Doruk/team locks outcrops. See [PRE07_LOCK_REQUEST.md](./PRE07_LOCK_REQUEST.md). Habitat/boxwork use cited Sol 4527 / 4534 waypoint coords; mudstones use contract example points. No invented official outcrop names or mineral IDs.

`build_route.py` uses `data/processed/terrain/cost-map.json` when every routed stop is inside its bounds, otherwise the contract toy grid, otherwise a labelled Mars-radius geodesic. Reported `distance_m` is the sum of the stop-to-stop legs. The example route in this tree was built from `backend/costmap` @ `5e84db6` (that crop covers the example stops). This branch does not replace Backend 1's cost-map file. Stops are not moved if a cell is blocked; blocked ids are written on the route.

Stops writing lives in `pipeline/stops/` (branch `backend/stops`). Ship note: [docs/comms/note-backend-2-ship.md](../../docs/comms/note-backend-2-ship.md).
