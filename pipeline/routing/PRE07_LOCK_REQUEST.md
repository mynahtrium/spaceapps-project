# PRE-07 — stop lock request (Backend 2)

**Date:** 2026-11-14 11:54 Europe/Istanbul  
**From:** Doruk / Backend 2 (Grok in Cursor)  
**Status:** Not locked. Do not copy these into `data/processed/routing/stops.json` as final stops until Doruk / the team answers.

MUST-04 (locked `stops.json`), MUST-05 (route), and MUST-06 (HUD telemetry) are blocked until this decision lands. Example points in `docs/contracts/stops.json` stay `is_example: true` only.

## Footprint (already checked)

Every stop must sit inside HiRISE DTM **DTEEC_019698**: about **4.73–5.04°S, 137.31–137.44°E** ([AGENTS.md](../../AGENTS.md); [DTM index](https://hirise-pds.lpl.arizona.edu/PDS/INDEX/DTMCUMINDEX.TAB)).

Waypoint numbers below are from NASA's [MSL waypoints](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json), as recorded in [docs/testing/STOP_COORDINATE_CHECK.md](../../docs/testing/STOP_COORDINATE_CHECK.md) (13 Nov 2026). They are **rover positions**, not locked science outcrop names.

## What Doruk / the team must decide

Reply on the board question (or in this PR) with **yes/no or alternate coords** for each row. Prefer official outcrop names + citations. Do not invent mineral IDs.

| Stop | Decision needed | Cited candidate (not locked) | Source |
|---|---|---|---|
| Habitat / EVA start | Exact lat/lon (and name if any) | Option A: Sol **4527** at **-4.79721368, 137.38750650** (near boxwork entry, flatter approach) | MSL waypoints |
| Lake-sediment mudstone A | **Official outcrop name** + lat/lon inside DTEEC_019698 | **None locked.** Example contract point is illustrative only | Need NASA / Curiosity / Resources pick |
| Lake-sediment mudstone B (or contact) | Same | **None locked.** Example contract point is illustrative only | Need NASA / Curiosity / Resources pick |
| Boxwork bonus (Altadena) | Confirm using Sol **4534** entry or another Sol | Sol **4534** at **-4.79761763, 137.38643610**; science context: Altadena member boxwork | MSL waypoints; [NASA boxwork release](https://www.nasa.gov/missions/mars-science-laboratory/curiosity-rover/nasas-curiosity-mars-rover-starts-unpacking-boxwork-formations/) |

Primary science goal (already locked 12 Nov): ancient lake sediments / habitability (organics in mudstones). Boxwork is a **bonus** stop only ([docs/DECISIONS.md](../../docs/DECISIONS.md)).

## Temporary scaffolding (optional second answer)

Until PRE-07 locks, may Backend 2 scaffold A\* / Dijkstra against the **example** `docs/contracts/` cost map and stops (keeping `status: example` / `is_example: true` on outputs)?

- **Yes** — proceed with labelled example `data/processed/routing/` fixtures, then re-run after lock + Backend 1 cost map.  
- **No** — wait for locked stops before any routing outputs.

## After lock

1. Testers record chosen ids/coords in `docs/testing/`.  
2. Backend 2 writes `data/processed/routing/stops.json` (MUST-04), clears `is_example` on real stops, cites sources.  
3. Backend 1 crops DTM to cover every stop; Backend 3 picks POV Sols.
