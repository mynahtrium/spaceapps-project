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
