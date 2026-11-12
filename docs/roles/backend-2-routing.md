# Backend 2 — routing and science stops

You own the walk: locked science stops, the A\* / Dijkstra (or equivalent) router, `route.json`, and HUD telemetry along the path. You are not building the 3D scene or fetching REMS/DONKI.

Read first: [ROADMAP.md](../../ROADMAP.md), [AGENTS.md](../../AGENTS.md), [docs/contracts/stops.json](../contracts/stops.json), [route.json](../contracts/route.json), [hud-telemetry.json](../contracts/hud-telemetry.json), [docs/GITHUB_WORKFLOW.md](../GITHUB_WORKFLOW.md), [skills/routing/SKILL.md](../../skills/routing/SKILL.md).

**No application code before 14 November 2026.**


## Session start and end

Follow the checklist in [AGENTS.md](../../AGENTS.md): `git pull`; read [BOARD.md](../coordination/BOARD.md), [HANDOFFS.md](../coordination/HANDOFFS.md), the latest [AGENT_LOG.md](../coordination/AGENT_LOG.md) entries, and all [profiles](../team/profiles/). **First session:** run the [onboarding interview](../team/profiles/README.md) **before any other work**. Claim a board task, work on a `ROLE/short-topic` branch, test, append the agent log in the same commit (`Commit: this commit`), update the board, and open a PR for a tester. At 6-hour marks, append [STANDUP.md](../coordination/STANDUP.md).
## Responsibilities

- Turn the team's locked stops into `stops.json` (habitat, lake-sediment / mudstone stops, boxwork bonus).
- Build a cost-following route that avoids blocked cells. Optional thin `GET`/`POST /api/route` — but a **static `route.json` is required** so the demo works if the API is down.
- Emit a path profile and HUD telemetry samples (distance, slope, next stop, placeholder O₂).
- Distances use a Mars radius (3,389.5 km mean, or 3,396.19 km equatorial from the DTM labels). Walking time is an Earth-hiking placeholder and must be labelled.

- By hour 32, copy frozen `stops.json`, `route.json`, and telemetry fixtures into `data/demo/` for demo-safe mode (Frontend 1 owns the loader).

## Owned folders

- `pipeline/routing/`
- `data/processed/routing/`
- `docs/contracts/stops.json`, `route.json`, `hud-telemetry.json`

## Tasks by phase

**Pre-14 Nov:** Account, practice PR, read A\* / Dijkstra at a high level, **lock stop candidates** with the team on HiView / official maps (paper or a notes issue — no project code). Every stop must sit inside DTEEC_019698.

**Hours 0–2:** Write locked stops to `data/processed/routing/stops.json` (clear `is_example` on real stops; cite official names).

**Hours 2–10:** As soon as Backend 1's cost map exists, run 8-neighbour Dijkstra / A\* (for example `skimage.graph.route_through_array`) habitat → mudstone stops → boxwork bonus → back. If the solver fails, **manually draw** a clearly safe path on the hazard map and label it. Write `route.json`.

**Hours 10–16:** `hud-telemetry.json` samples along the path. Suit O₂ = linear placeholder from elapsed / planned time (document the formula). Freeze a static route for the MUST demo.

**Hours 16–32:** Optional 15° vs 20° recompute; optional compare-to-Curiosity traverse. `POST /api/route` only if the static file remains the fallback.

**Hours 32–40:** Stretch: paired rover mode (Curiosity traverse as a precursor path). Stop new work at hour 40.

**Hours 40–48:** Freeze. Help testers explain "why this route" on slides.

## Handoffs

| When | You give | To |
|---|---|---|
| Hour 0–2 | Locked `stops.json` | Everyone (especially B3 for POV Sols, F1 for map pins) |
| Hour ~10 | `route.json` + profile | Frontend 1, testers |
| Hour ~14 | `hud-telemetry.json` | Frontend 1 HUD |
| Hour 32–40 | Optional rover-comparison path | Frontend 1 |

You **receive** `cost-map.json` and bounds from Backend 1 around hours 6–10. If it is late, keep developing against the example contract grid, then re-run on the real cost map.

## Definition of done (your part of MUST)

Stops are the locked ones, not the example names (unless the team failed to lock — then keep examples and say so). A route file loads in the planner and HUD without a running API. Totals include distance and climb. Time and O₂ are labelled placeholders.

## Checklist

- [ ] Stops inside the DTM footprint
- [ ] Each stop has id, name, kind, coordinates, science summary, citation when locked
- [ ] Route avoids blocked cells (or a labelled hand-drawn fallback)
- [ ] Mars radius used for length
- [ ] Static fallback works
- [ ] AI use logged

## Ready-to-paste prompt for your coding agent

```
You are helping Backend 2 on the private NASA Space Apps 2026 repo nasathingamajig (team Martian Mappers).

Read AGENTS.md, ROADMAP.md, docs/roles/backend-2-routing.md, docs/contracts/stops.json, route.json, hud-telemetry.json, and skills/routing/SKILL.md before editing.

Rules: If today is before 14 November 2026, do not write application code, package.json, notebooks, or a data pipeline. Never commit secrets or data/raw. Do not touch folders I do not own (pipeline/routing/, data/processed/routing/, and the three contract files above). Log AI use in docs/AI_USE.md. Small branches named backend-2/short-topic; a bug tester reviews every PR.

Site: Gale / Mount Sharp. Science goal: ancient lake sediments / habitability (organics in mudstones); boxwork is a bonus stop. Example coordinates in docs/contracts are placeholders only. Use Mars radius 3389.5 km mean for distances. Slope limits are lunar stand-ins. Suit O2 in HUD telemetry is a linear placeholder (remaining % = 100 * (1 - elapsed/planned)) and must be labelled. Walking time is an Earth hiking placeholder.

After 14 Nov, implement 8-neighbour A* or Dijkstra on Backend 1's cost map (skimage.graph.route_through_array is acceptable). Always write static JSON the frontend can fetch. An HTTP API is optional and must fall back to those files. If the solver fails, produce a carefully drawn safe GeoJSON and label it.

First session: interview your human before other work (docs/team/profiles/README.md). At every session start, read BOARD, HANDOFFS, the latest AGENT_LOG entries, and all profiles. Claim a board task before starting. Append docs/coordination/AGENT_LOG.md in the same commit (Commit: this commit).

Task: [DESCRIBE THE TASK]
```
