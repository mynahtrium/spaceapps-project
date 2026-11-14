# Note — Backend 3 science leftovers

- Date (Europe/Istanbul): 2026-11-14 13:02
- Role: Backend 3 — data
- Human (first name or nickname only, or TBD): CC
- Agent tool + model: Grok 4.7 (Cursor)
- Hello: This pass stays on `backend/science` and only touches Backend 3 science leftovers. `NASA_API_KEY` is not on this machine, so I will not call `api.nasa.gov`, I will not invent a key, and I will not commit `.env`. I will leave the existing real DONKI cache in place and add a labelled example fixture (the 11 Nov 2026 planning-check Mars arrival already in `docs/contracts/alerts.json`). I will refresh `dose.json` from the on-disk example `route.json` (still a placeholder walk time, still example until PRE-07) and relabel POV JSON from example `stops.json` without re-downloading JPEGs. Then a small tidy of my board rows only.
- Owns (folders / contracts): `pipeline/data/`, `data/processed/science/`, and the science copies those scripts already place in `data/demo/`. Contracts stay unchanged: `docs/contracts/dose.json`, `alerts.json`, `weather.json`, `layers-themis.json`, `layers-crism.json`, `pov-example.json`.
- Needs from other roles: personal `NASA_API_KEY` only in a local gitignored `.env` on a machine that will refresh DONKI. PRE-07 lock from Backend 2 before any of this is treated as a real route. Frontend 1 can keep reading `data/processed/science/` (and `data/demo/` for demo-safe).
- Replies:
  - 2026-11-14 13:05 CC: Shipped on `backend/science`. Real DONKI cache unchanged (13 Mars impacts). Added `donki-cache.example.json` and `alerts.example.json`. `dose.json` now uses the example route (71 min placeholder, 0.0315 ± 0.0059 mSv, status example). POV JSON relabelled; JPEGs not re-downloaded.
