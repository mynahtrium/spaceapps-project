# pipeline/terrain/

Owned by **Backend 1**. Long-lived branch: `backend/terrain`. See [docs/roles/backend-1-terrain.md](../../docs/roles/backend-1-terrain.md).

| Script | What it writes |
|---|---|
| `crop_window.py` | Window around the example stops already in the repo |
| `make_slope.py` | Gitignored 1 m DTM crop, `slope-preview.png`, `slope_stats.json` |
| `crop_ortho.py` | Gitignored ortho crop and `ortho-preview.png` (same footprint) |
| `tilt_check.py` | `tilt-check.json` (MUST-03, earlier pass) |

`make_slope.py` reads `docs/contracts/stops.json` and `data/processed/routing/stops.json` and refuses to finish if any of those points falls outside the crop. The ids in those files are examples. PRE-07 has not locked official outcrop names, and these scripts do not invent any.

Cost / hazard grid and the height preview are `pipeline/costmap/` on branch `backend/costmap`. Raw GeoTIFFs stay in `data/raw/` and are not committed. Slope class colours are lunar stand-ins (green ≤ 10°, amber 10–15°, red 15–20°, black blocked > 20°, grey no-data).
