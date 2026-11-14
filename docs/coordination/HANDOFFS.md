# Handoffs

Use this file when work leaves your role and someone else must pick it up (a finished cost map, a contract field change, a blocked download, a demo note). **Append** a new block at the bottom; do not edit old blocks except to fill "Received" when you pick it up.

Also add a one-line pointer in [BOARD.md](./BOARD.md) (status `review` or a row in **Questions for other roles**).

Log the same change in [AGENT_LOG.md](./AGENT_LOG.md) and, if you changed `docs/contracts/`, in [docs/contracts/CHANGES.md](../contracts/CHANGES.md).

## How to use

1. Copy the template below.
2. Fill every field you can. Link files and the board task id.
3. Put the receiving role in the title and, if you know them, their first name or nickname only (see profiles). No phone numbers, emails, addresses, or school names.
4. Open or update the pull request if the files are in git.
5. The receiver sets **Received** to the date and a short "yes, I have it" or a question.

## Template

```md
### HANDOFF-YYYYMMDD-HHMM — from <role> to <role>

- Date (Europe/Istanbul):
- From (role, first name or nickname only, agent tool):
- To (role, name if known):
- Board task id:
- What is ready:
- Paths (files or folders):
- How to try it:
- What is not done / known limits:
- Please do next:
- Contract field changed? (yes/no — if yes, also update docs/contracts/CHANGES.md):
- Received: (leave blank until the other role fills this)
```

## Log

<!-- Append new handoffs below this line. Newest at the bottom. -->

### HANDOFF-20261114-1154 — from Backend 2 to Doruk / team (+ Testers)

- Date (Europe/Istanbul): 2026-11-14 11:54
- From (role, first name or nickname only, agent tool): Backend 2, Doruk, Grok (Cursor)
- To (role, name if known): Doruk / team; Testers 1–2 to record chosen ids after lock
- Board task id: PRE-07 (blocks MUST-04, MUST-05, MUST-06)
- What is ready: Stop-lock decision request with cited Sol 4527 / 4534 waypoint candidates and open mudstone outcrop slots — [pipeline/routing/PRE07_LOCK_REQUEST.md](../../pipeline/routing/PRE07_LOCK_REQUEST.md). No invented outcrop names. Example `docs/contracts/stops.json` unchanged.
- Paths (files or folders): `pipeline/routing/PRE07_LOCK_REQUEST.md`, board Questions row, this handoff
- How to try it: Answer the board question (or PR comment) with locked names/coords; optional yes/no on example-grid routing scaffold
- What is not done / known limits: Mudstone outcrop names and final coordinates are not chosen. Resources tab still may be UNVERIFIED. HiView confirmation still needed for any pick.
- Please do next: Lock the four stops (or reject candidates and supply alternates inside DTEEC_019698). Testers copy the locked ids into `docs/testing/`. Then Backend 2 runs MUST-04.
- Contract field changed? (yes/no — if yes, also update docs/contracts/CHANGES.md): no
- Received: 2026-11-14 12:02 (Asil / Tester 1) — Alındı; durak kilitleme kararı bekleniyor.

### HANDOFF-20261114-1200 — from backend-1 to backend-2, frontend-1, testers

- Date (Europe/Istanbul): 2026-11-14 12:00
- From (role, first name or nickname only, agent tool): backend-1, Cagan, Claude Code
- To (role, name if known): backend-2 (Doruk), frontend-1, tester-1, tester-2 (Eymen)
- Board task id: MUST-02
- What is ready: first-pass cost map for a 2 km x 2 km crop of DTEEC_019698 (395 x 395 cells, ~5.06 m), slope colour preview, 16-bit height preview, ortho preview.
- Paths (files or folders): `data/processed/terrain/cost-map.json`, `slope-preview.png`, `height-preview.png`, `ortho-preview.png`; scripts in `pipeline/terrain/`
- How to try it: `.venv/Scripts/python pipeline/terrain/make_slope.py` then `make_cost_map.py` (packages in `pipeline/terrain/requirements.txt`). Bounds are in `cost-map.json` (about 4.813–4.847°S, 137.373–137.407°E). Cost is a multiplier; multiply by step length. `9e99` = blocked (no-data or slope above 20°; 18% of cells). Rows run north to south.
- What is not done / known limits: crop centre is a placeholder (near Curiosity Sol 5070); re-run once stops are locked (PRE-07). No ortho-based obstacles yet. Not checked against Curiosity tilt (MUST-03). Slope limits are lunar stand-ins; the DTM under-reads rover tilt. Height preview is scaled 0–65535 over `height_preview_elevation_range_m` (about -3575 to -3219 m).
- Please do next: Backend 2 can start routing on this grid; Frontend 1 can load the height preview in the 3D view; testers check the bounds against HiView.
- Contract field changed? (yes/no — if yes, also update docs/contracts/CHANGES.md): yes, additive only (see CHANGES.md)
- Received: 2026-11-14 12:02 (Asil / Tester 1) — Alındı ve must-checklist.md üzerinden doğrulandı (PASS).

### HANDOFF-20261114-1217 — from Backend 3 to Frontend 1, Tester 1, Tester 2 (and Backend 1)

- Date (Europe/Istanbul): 2026-11-14 12:17
- From (role, first name or nickname only, agent tool): Backend 3, CC, Antigravity (Gemini)
- To (role, name if known): Frontend 1, Tester 1 (Asil), Tester 2 (Eymen), Backend 1 (Cagan)
- Board task id: MUST-07, SHOULD-01, SHOULD-02, SHOULD-04 (THEMIS/CRISM pass)
- What is ready:
  - `data/processed/science/alerts.json` (30-day cached DONKI window 2026-10-15..2026-11-14 with 13 WSA-Enlil Mars impacts + banner copy)
  - `data/processed/science/dose.json` (Hassler et al. 2014 RAD baseline 0.64 +/- 0.12 mSv/day; currently computed against placeholder 96 min route duration until Backend 2 ships `route.json`)
  - `data/processed/science/layers-themis.json` + 6 cached Gale sample PNG tiles (`tiles/themis/{day,night}/z{4,6,8}_*.png`)
  - `data/processed/science/layers-crism.json` (9 MRO CRISM MTRDR product metadata records over Gale from ODE REST)
  - `data/processed/science/msl-waypoints-cache.json` (1,389 MSL waypoints with `tilt` through Sol 5073 for B1 MUST-03 reference)
- Paths (files or folders): `pipeline/data/`, `data/processed/science/`
- How to try it: Run `python -m pipeline.data.run_must07` and `python -m pipeline.data.run_phase2` (stdlib only, no extra pip packages required; `.env` with `NASA_API_KEY` needed only for DONKI re-fetch).
- What is not done / known limits:
  - REMS (`atmos.nmsu.edu`) reset connections and RAD RDR (`pds-ppi.igpp.ucla.edu`) failed TLS certificate expiration check on 2026-11-14; both recorded honestly as `unavailable`. `weather.json` (REMS window) and `pov/<id>.json` + JPEG stills (`SHOULD-03`) are next once `stops.json` locks.
  - `dose.json` uses `docs/contracts/route.json` duration (`96 min`) until `data/processed/routing/route.json` exists.
- Please do next:
  - Frontend 1: wire `alerts.json`, `dose.json`, and `layers-themis.json` from `data/processed/science/` (with fallback to `docs/contracts/`).
  - Backend 2: let us know when `stops.json` and `route.json` land so we regenerate `dose.json` and fetch per-stop POV stills.
  - Testers: review PR / verify offline JSON contracts.
- Contract field changed? (yes/no — if yes, also update docs/contracts/CHANGES.md): no (kept contract field names; additive metadata fields only)
- Received:
