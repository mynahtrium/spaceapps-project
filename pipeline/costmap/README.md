# pipeline/costmap/

Owned by **Backend 1** (cost / hazard map). Long-lived branch: `backend/costmap`.

`make_cost_map.py` writes `data/processed/terrain/cost-map.json` and `height-preview.png`.

The window is the same example-stop crop as `pipeline/terrain/` (about 2 km around the points in `docs/contracts/stops.json` and `data/processed/routing/stops.json`). Those ids are examples. PRE-07 has not locked official outcrop names. `crop_window.py` here matches the terrain helper so this branch can build the grid without the other branch checked out. Slope and block averaging still come from `pipeline/terrain/make_slope.py`.

Cost is a multiplier (`1 + (slope/10°)² + k_rough * TRI`). `9e99` means blocked (no-data or slope above the 20° lunar stand-in). Multiply by step length when routing. Rows run north to south.
