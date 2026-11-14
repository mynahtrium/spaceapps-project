# Task board

Single place to see who is doing what. Update this file in the same PR as the work (or in a tiny follow-up PR the same hour). Human names are **first name or nickname only**. No phone numbers, emails, addresses, or school names.

Related: [ROADMAP.md](../../ROADMAP.md), [HANDOFFS.md](./HANDOFFS.md), [AGENT_LOG.md](./AGENT_LOG.md), [STANDUP.md](./STANDUP.md), [docs/DECISIONS.md](../DECISIONS.md), [docs/JUDGING_CHECKLIST.md](../JUDGING_CHECKLIST.md).

## Claim-before-start rules

1. **Claim before you start.** Set `status` to `doing`, put your first name or nickname under **Human**, and your agent tool under **Agent**. Do this in a short commit or at the top of the work PR.
2. Do not start a task that is already `doing` or `review` unless the current owner asked you to help, and then note that in **Notes**.
3. Allowed statuses: `todo` · `doing` · `blocked` · `review` · `done`.
4. When you are blocked, set `blocked`, add a row in **Questions for other roles**, and write a [handoff](./HANDOFFS.md) if files are involved.
5. When the work is ready for a tester (or for the next role), set `review` and link the PR. A tester moves it to `done` after sign-off (or the owner does, after the tester approves the PR).
6. Stay in your owned folders ([ROADMAP.md](../../ROADMAP.md) §2). One person, one doing-task when you can; finish or split rather than sitting on five.
7. After 14 November, work happens on a **long-lived role branch** (and a PR when ready), not as silent edits to `main`. **Merge to `main` only when asked.** After every prompt: pull, then push your current branch (no force).
8. **Visor pass (14 Nov):** prompts in [docs/roles/prompts/](../roles/prompts/README.md). Cagan (Claude, first) owns terrain, cost map, and routing. Cetin (profile CC) owns science and live DONKI via `NASA_API_KEY`. Divarci owns the visor. Eymen reviews. Doruk compiles. Asil stays on Tester 1. See [AGENTS.md](../../AGENTS.md) § Standing branch and sync rules.

## Status words

| Status | Meaning |
|---|---|
| `todo` | Not started; anyone in the owning role may claim it |
| `doing` | Claimed; someone is working on it |
| `blocked` | Cannot proceed; see Questions |
| `review` | PR open or waiting on a tester / the next role |
| `done` | Merged and accepted for this milestone |

## Tasks

Seeded from [ROADMAP.md](../../ROADMAP.md). Humans and agent tools stay `TBD` until onboarding interviews and [docs/team/ROSTER.md](../team/ROSTER.md) are filled. Due times are on the **hackathon clock** unless dated.

### Prep (before 14 November — docs and accounts only)

| ID | Task | Owner role | Human | Agent | Status | Due | Notes |
|---|---|---|---|---|---|---|---|
| PRE-01 | GitHub account, collaborator access, practice PR on the roster | All | TBD | TBD | todo | before 14 Nov | [GITHUB_WORKFLOW.md](../GITHUB_WORKFLOW.md) |
| PRE-02 | First-session onboarding interview; write `docs/team/profiles/<name>.md` | All | Doruk (B2), Cagan (B1), CC (B3), Asil (T1), Eymen (T2), F1 (F1) | Grok (Cursor), Claude Code, Antigravity, Gemini | done | first session | Profiles: [doruk.md](../team/profiles/doruk.md), [cagan.md](../team/profiles/cagan.md), [cc.md](../team/profiles/cc.md), [asil.md](../team/profiles/asil.md), [eymen.md](../team/profiles/eymen.md), [f1.md](../team/profiles/f1.md). No personal data; see [profiles/README.md](../team/profiles/README.md) |
| PRE-03 | Installs (Git, Python 3, editor; GDAL for B1) | All / B1 | TBD | TBD | todo | before 14 Nov | No project pipeline yet |
| PRE-04 | Personal `NASA_API_KEY` in a local gitignored `.env` only | B3 | CC | Grok (Cursor) | blocked | before 14 Nov | 2026-11-14: key not on this machine. Live DONKI skipped. Labelled example fixture shipped. Never commit `.env`. |
| PRE-05 | Read 13 Nov Resources tab, submission guide, judging guide | All | TBD | TBD | todo | 13 Nov | **UNVERIFIED** until those pages can be read. Partial pass 13 Nov: the [2026 landing page](https://www.spaceappschallenge.org/2026/) and [official terms](https://www.spaceappschallenge.org/legal/) loaded; official challenge Details, Resources tab, and judging / submission guides were unreadable (certificate error / HTTP 500). Re-checked 14 Nov 11:19: TLS cert validation still fails (`curl` exit 60 / Windows Schannel). |
| PRE-06 | Update [JUDGING_CHECKLIST.md](../JUDGING_CHECKLIST.md) from the official 13 Nov judging guide | T1, T2 | Eymen (T2) | Gemini (Antigravity) | doing | 13 Nov | Checklist is explicitly **UNVERIFIED** until this is done. Partial pass 13 Nov: a Status 2026-11-13 note was added; the 2026 judging guide itself could not be read with a valid TLS cert (re-checked 14 Nov 11:19, still failing TLS), so UNVERIFIED labels stay. |
| PRE-07 | Lock route stops on paper / HiView (inside DTEEC_019698) | B2 + team | Doruk | Grok (Cursor) | blocked | before hour 0 | Needs Doruk/team lock of outcrop names+coords. Request: [pipeline/routing/PRE07_LOCK_REQUEST.md](../../pipeline/routing/PRE07_LOCK_REQUEST.md). Testers record ids in `docs/testing/` after lock. |

### MUST (hours 0–16)

| ID | Task | Owner role | Human | Agent | Status | Due | Notes |
|---|---|---|---|---|---|---|---|
| MUST-01 | Download and crop DTM + ortho; first slope preview | B1 | Cagan | Grok (Cursor) | review | hour 6 | `backend/terrain`: DTEEC_019698 crop centred ~4.800°S, 137.390°E, 2 km, ~5.06 m cells. Covers every example point in `docs/contracts/stops.json` and `data/processed/routing/stops.json`. Median slope 11.6°. Not a PRE-07 lock. |
| MUST-02 | Cost / hazard map + `cost-map.json` + height preview for 3D | B1 | Cagan | Grok (Cursor) | review | hour 10 | `backend/costmap`: 395×395 cells, ~5.06 m, bounds 137.373–137.407°E, 4.817–4.783°S. Every example stop is inside. `height-preview.png` converted to 8-bit RGB (`R*256+G`) + `height_preview_encoding` added. Not a PRE-07 lock. |
| MUST-03 | Tilt check vs Curiosity waypoints; freeze MUST raster | B1 | Cagan | Claude Code | doing | hour 16 | Tilt check done (first pass): no systematic under-read over 176 waypoints, weak correlation; see `data/processed/terrain/tilt-check.json`. Raster freeze waits for PRE-07. |
| MUST-04 | Write locked `stops.json` | B2 | Doruk | Grok (Cursor) | doing | hour 2 | Example on `backend/stops` + `backend/routing` (cited Sol 4527/4534 + contract mudstones). Still `is_example`; clear only after PRE-07 lock. Ship note: [note-backend-2-ship.md](../comms/note-backend-2-ship.md). |
| MUST-05 | A\* / Dijkstra route (or labelled hand-drawn fallback) + `route.json` | B2 | Doruk | Grok (Cursor) | doing | hour 10 | Example Dijkstra on `backend/costmap` @ `5e84db6`. Reported total equals the leg sum (790.3 m). Routed stops are passable. Contract example boxwork point (137.393, -4.803) is blocked and was not moved. Still `status: example`. Climb 38.4 m and descent 38.4 m from the matching height preview. Also: `elev_m`, `slope_deg`, `climb_m` (38.3 m), `descent_m` (38.3 m) populated from `height-preview.png` (`dose_mSv_see` points to `data/processed/science/dose.json`). |
| MUST-06 | `hud-telemetry.json` samples (distance, slope, next stop, placeholder O₂) | B2 | Doruk | Grok (Cursor) | doing | hour 16 | Example samples + `primary` regenerated with the leg-sum distance. Slope/elev still null. Also: distance is the leg sum; slope and elev come from the 16-bit height preview along the path. O₂ stays a labelled placeholder. Still `status: example`. Regenerated with `elev_m`, `slope_deg`, `slope_class`, flat top-level contract fields + `primary` + `samples[]`. |
| MUST-07 | Background caches only (REMS, RAD, DONKI, images) — do not block MUST | B3 | CC | Antigravity (Gemini) | review | hour 16 | Real DONKI cache kept. If `NASA_API_KEY` is missing, live DONKI is skipped and `donki-cache.example.json` is written. SHOULD products are on disk. SHOULD products come later. |
| MUST-08 | Scaffold planner + 3D scene; load contract JSON | F1 | F1 | Antigravity (Gemini) | review | hour 2 | `web/index.html`, `web/planner/`, `web/hud/`, `web/shared/` |
| MUST-09 | 3D first-person terrain from B1 preview; `mm:set-route` from planner | F1 | F1 | Antigravity (Gemini) | review | hour 10 | `height-preview.png` RGB `R*256+G` + `mm:set-route` |
| MUST-10 | Basic HUD: distance, slope, next stop, suit O₂ (labelled placeholder) | F1 | F1 | Antigravity (Gemini) | review | hour 16 | Fallback to `docs/contracts/` |
| MUST-11 | MUST test plan + sign-off | T1 | Asil | Gemini; Grok (Cursor) | review | hour 16 | Drafted in docs/testing/must-checklist.md. Test plan `docs/testing/test-plan.md` and contract checklist `docs/testing/contract-checklist.md` on branch `tester/review`. Document review 14 Nov 12:59 of `d2c4695`: B1 files remain the only first-pass PASS. B2 route is an example Dijkstra on the contract cost grid. F1 app not built. Hour-16 sign-off not given. |
| MUST-12 | Review early PRs; rough demo walk | T1, T2 | Eymen (T2), Asil (T1) | Gemini (Antigravity); Grok (Cursor) | doing | hour 16 | Drafted demo docs in docs/demo/ and test checklist in docs/testing/; ready to review early PRs. 14 Nov Tester 2: record-now path in docs/demo/demo-path.md (example route, PRE-07 open, web HUD not built). 7-slide outline corrected for the 14 Nov tilt check. |

### SHOULD (hours 16–32)

| ID | Task | Owner role | Human | Agent | Status | Due | Notes |
|---|---|---|---|---|---|---|---|
| SHOULD-01 | Dose budget `dose.json` (RAD baseline × duration) | B3 | CC | Grok (Cursor) | review | hour 22 | Example route 59.3 min (0.988 h) placeholder → 0.0263 ± 0.0049 mSv (Hassler 2014 × duration). Status example until PRE-07. No spatial radiation map. |
| SHOULD-02 | Cached DONKI / WSA-Enlil `alerts.json` + banner copy | B3 | CC | Antigravity (Gemini) | review | hour 22 | Real `alerts.json` cache kept (13 Mars impacts). `alerts.example.json` added when `NASA_API_KEY` is missing. |
| SHOULD-03 | POV stills for each stop, or honest empty state | B3 | CC | Antigravity (Gemini) | review | hour 28 | 4 JPEGs reused, not re-downloaded. JSON relabelled from example `stops.json`; still `is_example` until PRE-07. |
| SHOULD-04 | REMS weather window + THEMIS (CRISM if ready) layer metadata | B3 | CC | Antigravity (Gemini) | review | hour 32 | CAB/NASA REMS feed (4,745 sols) + THEMIS tiles + 9 CRISM MTRDR records |
| SHOULD-05 | HUD / planner: dose card, DONKI banner, POV, weather/thermal toggles | F1 | F1 | Antigravity (Gemini) | review | hour 32 | |
| SHOULD-06 | Optional 15° / 20° mask and route toggle | B1, B2, F1 | F1 | Antigravity (Gemini) | review | hour 32 | UI 15°/20° toggle using `cost-map.json` |
| SHOULD-07 | **Demo-safe mode** (must-have): `DEMO_SAFE=1` or `?demo=1` loads only `data/demo/` fixtures; no network, NASA, or DONKI calls | F1 (implement); B1–B3 (fixtures); T1 (verify) | F1 / Doruk | Antigravity (Gemini) | review | hour 32 | `data/demo/` bundles 28 offline fixtures; `web/` vendored `maplibre-gl` + `three` (`BUG-12` fixed) and gated `orthoPreviewUrl` (`BUG-14` fixed) on `orchestrator/map-replacement`. Spec: [ROADMAP.md](../../ROADMAP.md) § Demo-safe. |
| MAP-01 | High-res Mars map & terrain visor replacement (`Geodesy`, `IMapAdapter`, `TileSourceRegistry`, `TerrainWorkerPool`, custom Mars PBR shader, CDLOD quadtree, `mars-eq://` + `mars-dem://` Terrarium protocol, `node --test` suite) | F1 / B2 | Doruk (overriding `web/` on `orchestrator/map-replacement`) | Antigravity (Gemini) | review | hour 32 | Replaces flat map/terrain layer across unified first-person visor & MapLibre 2.5D dock (`?legacyMap=1` rollback preserved). Ready for F1/T1/T2 review. |
| PHYS-01 | Martian visor physics core (Gale gravity, 180 kg inertia, boot traction, ballistic jump, horizon curvature) | F1 | Doruk (overriding `web/` on `frontend/mars-physics`) | Grok (Cursor) | review | hour 32 | No Rapier binary. `#hud-o2` stays the linear placeholder. Slope limits stay lunar stand-ins. PR not opened. |
| SHOULD-08 | SHOULD sign-off | T1, T2 | TBD | TBD | todo | hour 32 | Include the demo-safe tester check |

### STRETCH (hours 32–40) and submit

| ID | Task | Owner role | Human | Agent | Status | Due | Notes |
|---|---|---|---|---|---|---|---|
| STRETCH-01 | WebXR headset mode that does not break the default view | F1 | TBD | TBD | todo | hour 40 | Start only if MUST/SHOULD are solid |
| STRETCH-02 | Paired rover mode (Curiosity traverse as precursor path) | B2, F1 | TBD | TBD | todo | hour 40 | |
| SUB-01 | Feature freeze; 30-second video; slides; SI-tools paragraph | T2, T1, F1 | TBD | TBD | todo | hour 44 | Nothing new after hour 40. Official video length and SI-tools form wording remain **UNVERIFIED**. |
| SUB-02 | Submit early; backup recording; tagged or noted commit | All | TBD | TBD | todo | hour 48 | Official window ([2026 landing page](https://www.spaceappschallenge.org/2026/)): Team page Project tab; opens Saturday 14 November 09:00 and closes Sunday 15 November 23:59 **local event time**. |

### Docs already landed (12 November 2026)

| ID | Task | Owner role | Human | Agent | Status | Due | Notes |
|---|---|---|---|---|---|---|---|
| DOC-01 | Roadmap, roles, contracts, Git workflow | docs | — | Grok Bot | done | 12 Nov | Commit `29e8686` |
| DOC-02 | Coordination board, handoffs, agent log, onboarding, standup, decisions, judging checklist, demo-safe spec | docs | — | Grok Bot | review | 12 Nov | This change; commit field `this commit` in AGENT_LOG |

## Questions for other roles

Add a row when you need an answer. Cross it out or mark `answered` when done. First names or nicknames only.

| Date | From (role) | To (role) | Question | Status |
|---|---|---|---|---|
| 2026-11-14 | B2 (Doruk) | Doruk / team (+ T1/T2 record) | PRE-07: Lock habitat + two lake-sediment mudstone stops (official names + lat/lon inside DTEEC_019698) and confirm boxwork bonus (Sol 4534 candidate cited). Also: allow example-contract routing scaffold until then? See [PRE07_LOCK_REQUEST.md](../../pipeline/routing/PRE07_LOCK_REQUEST.md). | open |
| 2026-11-14 | B3 (CC) | CC / team | PRE-04: this machine has no `NASA_API_KEY`. Live DONKI was skipped. Keep a personal key only in a local gitignored `.env` when refreshing DONKI. The example fixture is the 11 Nov planning-check arrival, not a live forecast. | open |
| 2026-11-14 | T2 (Eymen) | B2 (Doruk) | Example `route.json`: `properties.distance_m` is 947.1 m, but the four legs sum to 790.3 m. Which figure should the demo say until you confirm? `dose.json` is still the 96 min contract placeholder (0.0427 mSv), not the 71 min example route. | open |
| 2026-11-14 | T1 (Asil) | B2, B3, F1 | Document review on `d2c4695`: HUD JSON keeps required fields on `primary` / `samples` (example file is flat); dose still uses the 96 min example route while processed `route.json` totals say 71 min; weather JSON omits `sol_range_available_as_of_2026-11-11`. Please have F1 read `primary`, and have B3 refresh dose after PRE-07. Checklist: [contract-checklist.md](../testing/contract-checklist.md). | open |
| 2026-11-14 | Backend (Cagan) | Divarci, Eymen, Cetin | Additive `sources[]` on the four visor JSON files (see CHANGES.md, HANDOFF-20261114-1520). Cetin: please re-export `data/demo/` so it matches `data/processed/`. Team: the two mudstone example stops have no NASA citation (PRE-07). | open |

When a question is about a **contract field change**, also add a line to [docs/contracts/CHANGES.md](../contracts/CHANGES.md) and a [handoff](./HANDOFFS.md) for the owning role, Frontend 1, and both testers.
