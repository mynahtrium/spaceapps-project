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
7. After 14 November, work happens on a branch and a PR, not as silent edits to `main`.

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
| PRE-02 | First-session onboarding interview; write `docs/team/profiles/<name>.md` | All | TBD | TBD | todo | first session | No personal data; see [profiles/README.md](../team/profiles/README.md) |
| PRE-03 | Installs (Git, Python 3, editor; GDAL for B1) | All / B1 | TBD | TBD | todo | before 14 Nov | No project pipeline yet |
| PRE-04 | Personal `NASA_API_KEY` in a local gitignored `.env` only | B3 | TBD | TBD | todo | before 14 Nov | Never commit or paste the key |
| PRE-05 | Read 13 Nov Resources tab, submission guide, judging guide | All | TBD | TBD | todo | 13 Nov | **UNVERIFIED** until those pages appear |
| PRE-06 | Update [JUDGING_CHECKLIST.md](../JUDGING_CHECKLIST.md) from the official 13 Nov judging guide | T1, T2 | TBD | TBD | todo | 13 Nov | Checklist is explicitly **UNVERIFIED** until this is done |
| PRE-07 | Lock route stops on paper / HiView (inside DTEEC_019698) | B2 + team | TBD | TBD | todo | before hour 0 | No application code; testers record ids in `docs/testing/` |

### MUST (hours 0–16)

| ID | Task | Owner role | Human | Agent | Status | Due | Notes |
|---|---|---|---|---|---|---|---|
| MUST-01 | Download and crop DTM + ortho; first slope preview | B1 | TBD | TBD | todo | hour 6 | `pipeline/terrain/`, `data/processed/terrain/` |
| MUST-02 | Cost / hazard map + `cost-map.json` + height preview for 3D | B1 | TBD | TBD | todo | hour 10 | Contract: `docs/contracts/cost-map.json` |
| MUST-03 | Tilt check vs Curiosity waypoints; freeze MUST raster | B1 | TBD | TBD | todo | hour 16 | Note DTM under-read |
| MUST-04 | Write locked `stops.json` | B2 | TBD | TBD | todo | hour 2 | Clear `is_example` on real stops |
| MUST-05 | A\* / Dijkstra route (or labelled hand-drawn fallback) + `route.json` | B2 | TBD | TBD | todo | hour 10 | Static fallback required |
| MUST-06 | `hud-telemetry.json` samples (distance, slope, next stop, placeholder O₂) | B2 | TBD | TBD | todo | hour 16 | |
| MUST-07 | Background caches only (REMS, RAD, DONKI, images) — do not block MUST | B3 | TBD | TBD | todo | hour 16 | SHOULD products come later |
| MUST-08 | Scaffold planner + 3D scene; load contract JSON | F1 | TBD | TBD | todo | hour 2 | `web/planner/`, `web/hud/` |
| MUST-09 | 3D first-person terrain from B1 preview; `mm:set-route` from planner | F1 | TBD | TBD | todo | hour 10 | |
| MUST-10 | Basic HUD: distance, slope, next stop, suit O₂ (labelled placeholder) | F1 | TBD | TBD | todo | hour 16 | Fallback to `docs/contracts/` |
| MUST-11 | MUST test plan + sign-off | T1 | TBD | TBD | todo | hour 16 | |
| MUST-12 | Review early PRs; rough demo walk | T1, T2 | TBD | TBD | todo | hour 16 | |

### SHOULD (hours 16–32)

| ID | Task | Owner role | Human | Agent | Status | Due | Notes |
|---|---|---|---|---|---|---|---|
| SHOULD-01 | Dose budget `dose.json` (RAD baseline × duration) | B3 | TBD | TBD | todo | hour 22 | No spatial radiation map |
| SHOULD-02 | Cached DONKI / WSA-Enlil `alerts.json` + banner copy | B3 | TBD | TBD | todo | hour 22 | Cache only; personal key |
| SHOULD-03 | POV stills for each stop, or honest empty state | B3 | TBD | TBD | todo | hour 28 | |
| SHOULD-04 | REMS weather window + THEMIS (CRISM if ready) layer metadata | B3 | TBD | TBD | todo | hour 32 | |
| SHOULD-05 | HUD / planner: dose card, DONKI banner, POV, weather/thermal toggles | F1 | TBD | TBD | todo | hour 32 | |
| SHOULD-06 | Optional 15° / 20° mask and route toggle | B1, B2, F1 | TBD | TBD | todo | hour 32 | Nice, not required to pass SHOULD |
| SHOULD-07 | **Demo-safe mode** (must-have): `DEMO_SAFE=1` or `?demo=1` loads only `data/demo/` fixtures; no network, NASA, or DONKI calls | F1 (implement); B1–B3 (fixtures); T1 (verify) | TBD | TBD | todo | hour 32 | Spec: [ROADMAP.md](../../ROADMAP.md) § Demo-safe and [docs/contracts/README.md](../contracts/README.md). Implementation after 14 Nov. |
| SHOULD-08 | SHOULD sign-off | T1, T2 | TBD | TBD | todo | hour 32 | Include the demo-safe tester check |

### STRETCH (hours 32–40) and submit

| ID | Task | Owner role | Human | Agent | Status | Due | Notes |
|---|---|---|---|---|---|---|---|
| STRETCH-01 | WebXR headset mode that does not break the default view | F1 | TBD | TBD | todo | hour 40 | Start only if MUST/SHOULD are solid |
| STRETCH-02 | Paired rover mode (Curiosity traverse as precursor path) | B2, F1 | TBD | TBD | todo | hour 40 | |
| SUB-01 | Feature freeze; 30-second video; slides; SI-tools paragraph | T2, T1, F1 | TBD | TBD | todo | hour 44 | Nothing new after hour 40 |
| SUB-02 | Submit early; backup recording; tagged or noted commit | All | TBD | TBD | todo | hour 48 | |

### Docs already landed (12 November 2026)

| ID | Task | Owner role | Human | Agent | Status | Due | Notes |
|---|---|---|---|---|---|---|---|
| DOC-01 | Roadmap, roles, contracts, Git workflow | docs | — | Grok Bot | done | 12 Nov | Commit `29e8686` |
| DOC-02 | Coordination board, handoffs, agent log, onboarding, standup, decisions, judging checklist, demo-safe spec | docs | — | Grok Bot | review | 12 Nov | This change; commit field `this commit` in AGENT_LOG |

## Questions for other roles

Add a row when you need an answer. Cross it out or mark `answered` when done. First names or nicknames only.

| Date | From (role) | To (role) | Question | Status |
|---|---|---|---|---|
| — | — | — | _(none yet)_ | — |

When a question is about a **contract field change**, also add a line to [docs/contracts/CHANGES.md](../contracts/CHANGES.md) and a [handoff](./HANDOFFS.md) for the owning role, Frontend 1, and both testers.
