# pipeline/costmap/

Owned by **Backend 1** (cost / hazard map). Long-lived branch: `backend/costmap`.

Scripts: `make_cost_map.py` → `data/processed/terrain/cost-map.json` + height preview.

Depends on `pipeline/terrain/` DTM crop (`make_slope.py` helpers).
