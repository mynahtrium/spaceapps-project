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
- Received:

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
- Received:

### HANDOFF-20261114-1330 — from backend-1 to frontend-1, backend-2, testers (follow-up to HANDOFF-20261114-1200)

- Date (Europe/Istanbul): 2026-11-14 13:30
- From (role, first name or nickname only, agent tool): backend-1, Cagan, Claude Code
- To (role, name if known): frontend-1, backend-2 (Doruk), tester-1 (Asil), tester-2 (Eymen)
- Board task id: MUST-02, MUST-03
- What is ready: (1) `data/processed/terrain/height-preview.png` is now an 8-bit RGB PNG: `value = R*256 + G`, `elevation_m = min + value/65535*(max-min)` with min and max from `height_preview_elevation_range_m` in `cost-map.json` (value 0 = no-data). The old 16-bit grey file would be read as 8-bit by a browser canvas. (2) `tilt-check.json`: DTM slope vs Curiosity tilt at 176 waypoints.
- Paths (files or folders): `data/processed/terrain/`, `docs/DATA_SOURCES.md`, `docs/contracts/cost-map.json` (note fields only)
- How to try it: decode a pixel as above; compare the min/max with `height_preview_elevation_range_m`.
- What is not done / known limits: The MUST-03 result does **not** confirm "DTM under-reads rover tilt" (medians 9.0 vs 8.6 deg at 5 m; weak correlation). I fixed that wording in B1-owned files only. Still using the old wording: AGENTS.md, ROADMAP.md, `.cursor/rules/data-and-map.mdc`, `skills/hud-3d`, `skills/map-ui`, `docs/JUDGING_CHECKLIST.md`, `docs/demo/*`, `docs/testing/must-checklist.md`, `docs/roles/tester-2.md`. Owners, please soften it, e.g. "DTM slope matches rover tilt only weakly; we keep a safety margin".
- Please do next: Frontend 1 reads the RGB height PNG; testers and Doruk update the wording in their files; whoever owns AGENTS.md / ROADMAP.md edits those (shared files, ask first).
- Contract field changed? (yes/no — if yes, also update docs/contracts/CHANGES.md): yes, additive (see CHANGES.md)
- Received:
