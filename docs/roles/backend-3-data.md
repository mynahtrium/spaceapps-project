# Backend 3 — data services

You own REMS weather, the RAD dose budget, DONKI alerts, THEMIS / CRISM layer metadata, and Curiosity POV stills. You do not block the hour-16 MUST demo: Frontend 1 can ship 3D + HUD without you. Your SHOULD work (hours 16–32) is what makes the science story complete.

Read first: [ROADMAP.md](../../ROADMAP.md), [AGENTS.md](../../AGENTS.md) data-layer table, [docs/contracts/](../contracts/) (`dose.json`, `alerts.json`, `weather.json`, `layers-themis.json`, `layers-crism.json`, `pov-example.json`), [docs/GITHUB_WORKFLOW.md](../GITHUB_WORKFLOW.md), [skills/data-fetching/SKILL.md](../../skills/data-fetching/SKILL.md).

**No application code and no project data pipeline before 14 November 2026.** You may request a personal [api.nasa.gov](https://api.nasa.gov/) key before then and store it only in a local gitignored `.env`.


## Session start and end

Follow the checklist in [AGENTS.md](../../AGENTS.md): `git pull`; read [BOARD.md](../coordination/BOARD.md), [HANDOFFS.md](../coordination/HANDOFFS.md), the latest [AGENT_LOG.md](../coordination/AGENT_LOG.md) entries, and all [profiles](../team/profiles/). **First session:** run the [onboarding interview](../team/profiles/README.md) **before any other work**. Claim a board task, work on a `ROLE/short-topic` branch, test, append the agent log in the same commit (`Commit: this commit`), update the board, and open a PR for a tester. At 6-hour marks, append [STANDUP.md](../coordination/STANDUP.md).
## Responsibilities

- Cache small JSON and a few images so the demo works offline.
- Dose ≈ RAD baseline (0.64 ± 0.12 mSv/day, [Hassler et al., Science 2014](https://www.science.org/doi/10.1126/science.1244797)) × EVA duration, plus real RAD tables if you parse them. **No spatial radiation map of rocks.**
- DONKI: **WSAEnlilSimulations**, look for `"Mars"` in `impactList`. CME/SEP/GST also worked in the 11 November 2026 check; FLR returned 404. Never use NASA's shared demo key.
- POV: undocumented MSL raw-image feed; do not use `api.nasa.gov/mars-photos` (404 in that check).
- Cite sources and fetch dates. Do not invent mineral detections or weather values.

- By hour 32, copy frozen dose, alerts, weather, layer, and POV fixtures into `data/demo/` for demo-safe mode (Frontend 1 owns the loader). Those copies must not require a network call.

## Owned folders

- `pipeline/data/`
- `data/processed/science/`
- `docs/contracts/dose.json`, `alerts.json`, `weather.json`, `layers-themis.json`, `layers-crism.json`, `pov-example.json`

## Tasks by phase

**Pre-14 Nov:** Account, practice PR, obtain `NASA_API_KEY` locally, read the data-layer notes, do not start the project pipeline.

**Hours 0–16:** Background downloads and caches (REMS, RAD, waypoints, DONKI, image list). Help Backend 1 with waypoint tilts if asked. Do **not** require the frontend to wait on your SHOULD files for MUST sign-off.

**Hours 16–22:** Write real `dose.json` and cached `alerts.json`. Hand off to Frontend 1.

**Hours 22–28:** Cached POV stills for each locked stop (`pov/<id>.json` + small JPEGs). REMS weather and a recommended cooler EVA window.

**Hours 28–32:** THEMIS layer metadata (Trek WMTS; cache the demo bbox). CRISM if it is going well; otherwise skip and say so.

**Hours 32–40:** Optional stretch (predicted-conditions slider data, sky-view inputs). Stop new work at hour 40.

**Hours 40–48:** Freeze. Provide source lines for slides.

## Handoffs

| When | You give | To |
|---|---|---|
| Hour 0–16 | Cached files landing in `data/processed/science/` (even if incomplete) | Yourself, then F1 |
| Hour ~22 | `dose.json`, `alerts.json` | Frontend 1, testers |
| Hour ~28 | POV JSON + images, `weather.json` | Frontend 1 |
| Hour ~32 | THEMIS (and maybe CRISM) metadata / cached tiles | Frontend 1 planner |

You **receive** locked `stops.json` at hours 0–2 so you can choose POV Sols near each stop.

## Definition of done (your part of SHOULD)

Dose card and DONKI banner have real cached data and citations. Each stop has a photo or an honest empty state. At least one of REMS or THEMIS is in the planner. Everything needed on stage is on disk, not a live NASA call.

## Checklist

- [ ] `.env` exists locally and is not committed
- [ ] DONKI cache present
- [ ] Dose uses the cited baseline (and Sol tables if parsed)
- [ ] POV credits listed
- [ ] No invented numbers
- [ ] AI use logged

## Ready-to-paste prompt for your coding agent

```
You are helping Backend 3 on the private NASA Space Apps 2026 repo nasathingamajig (team Martian Mappers).

Read AGENTS.md, ROADMAP.md, docs/roles/backend-3-data.md, skills/data-fetching/SKILL.md, and the contract files dose.json, alerts.json, weather.json, layers-themis.json, layers-crism.json, pov-example.json.

Rules: If today is before 14 November 2026, do not write application code or start the project data pipeline. A personal NASA API key may exist only as NASA_API_KEY in a local gitignored .env — never print or commit it. Do not touch folders I do not own. Log AI use in docs/AI_USE.md. Branches: backend-3/short-topic. A bug tester reviews every PR.

Do not invent science values. Mark gaps UNVERIFIED. Do not build a spatial radiation map of rocks. DONKI: use WSAEnlilSimulations and Mars in impactList; cache JSON. Do not call api.nasa.gov/mars-photos (404 as of 11 Nov 2026). Prefer small cached files for an offline demo. Official Resources tab and judging guide (13 Nov) were UNVERIFIED until re-checked.

Site: Gale / Mount Sharp. Science goal: ancient lake sediments / habitability (organics in mudstones); boxwork is a bonus stop.

First session: interview your human before other work (docs/team/profiles/README.md). At every session start, read BOARD, HANDOFFS, the latest AGENT_LOG entries, and all profiles. Claim a board task before starting. Append docs/coordination/AGENT_LOG.md in the same commit (Commit: this commit).

Task: [DESCRIBE THE TASK]
```
