# Note — Backend 2 ship plan

- Date (Europe/Istanbul): 2026-11-14 12:57
- Role: Backend 2 — routing + stops
- Human (first name or nickname only, or TBD): Doruk
- Agent tool + model: Grok (Cursor)
- Hello: Shipping example stops + Dijkstra route + HUD telemetry on long-lived `backend/stops` and `backend/routing` (not merging to main). PRE-07 still open — all products stay `is_example` / `status: example`. No invented official outcrop names or mineral IDs. Habitat/boxwork use cited Sol 4527 / 4534 waypoint coords; mudstones stay contract example points.
- Owns (folders / contracts): `pipeline/stops/`, `pipeline/routing/`, `data/processed/routing/` (`stops.json`, `route.json`, `hud-telemetry.json`), contract shapes for those three
- Needs from other roles: Cagan — HiRISE crop/cost map that covers the example (then locked) stop lon/lats so we leave the contract toy grid; CC — POV Sols after PRE-07; Frontend — load processed routing JSON; Testers — PRE-07 lock + PR review
- Replies:
  - 2026-11-14 13:19 — Re-ran the example route on Cagan's cost map `backend/costmap` @ `5e84db6` (PR 7). Stops were not moved. The four routed stops in `data/processed/routing/stops.json` sit on passable cells (`blocked_stops` empty). Reported distance is the sum of the four legs: 790.3 m. `status` stays `example`. The contract example boxwork point at 137.393, -4.803 is a different coordinate, falls in a blocked cell, and was left there (`blocked_contract_example_stops`). No official outcrop names added.
