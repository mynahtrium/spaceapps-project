# Agent log

Append-only record of **every change**. One entry per change (one PR, or one commit if you are landing a single docs fix). Newest entry at the **bottom**.

This log is mandatory: **write the entry before every commit**, in the **same commit** as the files you changed. See the commit-hash rule below. The same rule is in [AGENTS.md](../../AGENTS.md).

Do not put secrets, API keys, phone numbers, emails, addresses, school names, or other personal data here. First name or nickname only.

## Entry template

Copy and fill:

```md
### YYYY-MM-DD HH:MM Europe/Istanbul — <TASK-ID>

- Human: (first name or nickname only)
- Agent tool + model: (for example Claude, Gemini, Grok, DeepSeek — plus a model name if you know it)
- Role: (backend-1, backend-2, backend-3, frontend-1, tester-1, tester-2, docs)
- Task id: (from BOARD.md, or `n/a`)
- Files changed:
- Why:
- Commit: this commit
- Next step:
```

Optional helper: from the repo root, run `scripts/log-entry.sh` to print a blank entry with the current Europe/Istanbul timestamp, then paste it at the bottom of this file and fill it in.

## Commit-hash rule (simple)

1. Add your log entry in the **same commit** as the work.
2. In the **Commit** field write exactly: `this commit`.
3. Do **not** amend, rebase, or force-push just to paste a hash afterwards.
4. If a tester later needs the exact SHA, they run `git log` on this file, or you mention the short hash of the **previous** change in your **next** entry's **Next step** or as `- Previous commit: abc1234`.

Optional Git reminder: `git config commit.template .gitmessage` (see [docs/GITHUB_WORKFLOW.md](../GITHUB_WORKFLOW.md)).

## How this feeds `docs/AI_USE.md`

- **AGENT_LOG** is the detailed trail of what every agent did (files, task ids, commits).
- **[docs/AI_USE.md](../AI_USE.md)** is the short submission disclosure (date, tool, what it was used for, what was kept or changed). The official FAQ requires that description (**UNVERIFIED** exact form until the 13 November submission guide).
- Tester 1, before submission (hours 40–44) and at least once on 13–14 November, reads this log, groups work by tool, and **fills or updates AI_USE.md** so every distinct tool and purpose is listed. Authors may add an AI_USE row themselves when they first use a tool or when the kind of work changes; they do not need a new AI_USE row for every tiny commit if this log already covers it.

## Entries

### 2026-11-12 11:30 Europe/Istanbul — DOC-02

- Human: (docs pass; no onboarding profile in this change)
- Agent tool + model: Grok Bot (Cursor agent)
- Role: docs
- Task id: DOC-02
- Files changed: coordination docs (BOARD, HANDOFFS, AGENT_LOG, STANDUP, LOADING_AGENTS_MD), GEMINI.md, short CLAUDE.md, team profile template, DECISIONS.md, JUDGING_CHECKLIST.md, contracts CHANGES.md and README, data/demo/README.md, scripts/log-entry.sh, .gitmessage, plus updates to AGENTS.md, README.md, ROADMAP.md, GITHUB_WORKFLOW.md, role sheets, Cursor rules, .env.example, and AI_USE.md
- Why: Doruk asked to prepare multi-agent coordination, a first-session onboarding interview, an append-only agent log, 6-hour standups, a demo-safe spec, a decision record, and a judging checklist (still UNVERIFIED until 13 Nov). Docs and config only; no application code.
- Commit: this commit
- Next step: Testers and each role run the onboarding interview on their first session; claim PRE-* tasks on the board; on 13 Nov do PRE-05 and PRE-06.

### 2026-11-13 08:12 Europe/Istanbul — PRE-05/PRE-06 (partial)

- Human: Doruk via Ari
- Agent tool + model: Grok Bot (Scout)
- Role: docs
- Task id: PRE-05/PRE-06 (partial)
- Files changed: docs/JUDGING_CHECKLIST.md, ROADMAP.md, AGENTS.md, README.md, docs/AI_USE.md, docs/roles/tester-1.md, docs/roles/tester-2.md, docs/coordination/BOARD.md, docs/coordination/AGENT_LOG.md, docs/contracts/README.md, docs/testing/README.md, docs/testing/STOP_COORDINATE_CHECK.md (new)
- Why: Partial 13 November pass of PRE-05 / PRE-06. The official challenge Details and Resources tabs and the 2026 judging guide could not be read (certificate error / HTTP 500), so judging criteria, the "do not build early" rule, the SI-tools form, and official video length stay UNVERIFIED. Recorded confirmed submission window and guardian / register-before-start rules from official pages that did load, and a Curiosity waypoint reference (stops still unlocked; stops.json unchanged).
- Commit: this commit
- Next step: Retry the official Resources tab, Project Submission Guide, and judging guide when the challenge page loads; then finish PRE-05 / PRE-06. PRE-07 (lock stops on HiView) is still open.

### 2026-11-13 08:14 Europe/Istanbul — n/a

- Human: Doruk via Ari
- Agent tool + model: Grok Bot (Scout)
- Role: docs
- Task id: n/a
- Files changed: AGENTS.md, docs/coordination/AGENT_LOG.md
- Why: Align the Site bullet with the 12 November decision: the site is Gale crater / Mount Sharp, not the boxwork unit. Kept the Sol 4534 / 5070 waypoint facts. Boxwork remains a bonus stop (already stated in the science-goal bullet).
- Commit: this commit
- Next step: none from this wording fix.

### 2026-11-13 17:12 Europe/Istanbul — PRE-05/PRE-06 (unofficial sources)

- Human: Doruk via Ari
- Agent tool + model: Grok Bot (Scout)
- Role: docs
- Task id: PRE-05/PRE-06 (unofficial sources)
- Files changed: docs/JUDGING_CHECKLIST.md, docs/RESOURCES_UNOFFICIAL.md (new), docs/coordination/AGENT_LOG.md
- Why: Official challenge HTTPS still fails certificate checks (HTTP 500). A curl -k fetch of the official hostname returned the challenge Details and Resources tab, plus the Judging & Awards Guide and Project Submission Guide (TLS not verified). Recorded those provisionally, kept all existing UNVERIFIED markers, labelled local-event and third-party lists UNOFFICIAL, and mapped named datasets. Did not change ROADMAP.md or DECISIONS.md.
- Commit: this commit
- Next step: Testers confirm the official guides with a certificate-valid fetch before closing PRE-05 / PRE-06. Consider adding the Curiosity Mount Sharp path animation as a story reference (PRE-07 / demo), without unlocking stops.

### 2026-11-13 17:15 Europe/Istanbul — PRE-06 follow-up

- Human: Doruk via Ari
- Agent tool + model: Grok Bot (Scout)
- Role: docs
- Task id: PRE-06 follow-up
- Files changed: docs/DECISIONS.md, docs/roles/tester-2.md, docs/demo/README.md, docs/roles/tester-1.md, docs/AI_USE.md, docs/roles/backend-1-terrain.md, docs/roles/backend-2-routing.md, docs/roles/backend-3-data.md, docs/roles/frontend-1-hud.md, docs/JUDGING_CHECKLIST.md, ROADMAP.md, docs/RESOURCES_UNOFFICIAL.md, AGENTS.md, docs/coordination/AGENT_LOG.md
- Why: Recorded a pending 13 Nov decision (demo: English-subtitled video of 30 s or less with a public no-login link, or a 7-slide alternative; disclose AI/SI and never use it to come up with the challenge idea) and matching role/demo/AI_USE notes. Noted Global Award eligibility via Mars Trek, HiRISE, and Curiosity RAD. Recorded Curiosity's proposed path up Mount Sharp as a route-story reference, not a data pipeline. All additions labelled provisionally official (official pages read 13 Nov with an unverified certificate via curl -k; confirm with a cert-valid fetch on 14 Nov 08:00) and linked the Project Submission Guide. PRE-05 / PRE-06 stay open.
- Commit: this commit
- Next step: Confirm the official Project Submission Guide with a certificate-valid fetch on 14 Nov 08:00; Doruk to confirm the new DECISIONS row. Do not close PRE-05 / PRE-06 until then.

### 2026-11-13 17:47 Europe/Istanbul — PRE-06 follow-up (decision locked)

- Human: Doruk via Lumi/Ari
- Agent tool + model: Grok Bot (Scout)
- Role: docs
- Task id: PRE-06 follow-up (decision locked)
- Files changed: docs/DECISIONS.md, docs/coordination/AGENT_LOG.md
- Why: Locked the 13 Nov demo/AI decision after Doruk's confirmation ("Yes, lock the demo and AI decision"), relayed via Lumi and Ari at 13 Nov 2026, 17:46 Europe/Istanbul. Replaced pending-confirmation wording in the DECISIONS row with locked status. Role sheets, docs/demo/README.md, and docs/AI_USE.md had no pending-Doruk wording, so they were left unchanged. Kept the provisionally official source label (confirm with a cert-valid fetch on 14 Nov 08:00).
- Commit: this commit
- Next step: Confirm the official Project Submission Guide with a certificate-valid fetch on 14 Nov 08:00. PRE-05 / PRE-06 stay open until then.

### 2026-11-14 11:19 Europe/Istanbul — PRE-02

- Human: Doruk
- Agent tool + model: Grok (Cursor)
- Role: Backend 2
- Task id: PRE-02
- Files changed: docs/team/profiles/doruk.md (new), docs/coordination/BOARD.md, docs/coordination/AGENT_LOG.md
- Why: First-session onboarding interview for Doruk (Backend 2). Profile only; no personal data; no application code.
- Commit: this commit
- Next step: Claim B2 prep/MUST tasks (PRE-01 roster username if needed, PRE-07 stop lock with team, MUST-04 stops.json).

### 2026-11-14 11:21 Europe/Istanbul — comms intros

- Human: Doruk
- Agent tool + model: Grok (Cursor) + role subagents for B1/B3/F1/T1/T2
- Role: Backend 2
- Task id: PRE-02 follow-on (agent comms)
- Files changed: docs/comms/README.md (new), intro-backend-1.md, intro-backend-2.md, intro-backend-3.md, intro-frontend-1.md, intro-tester-1.md, intro-tester-2.md (new), docs/coordination/README.md
- Why: Establish docs/comms channel; Doruk/B2 introduced; other five role agents wrote matching intros (humans TBD until their onboardings).
- Commit: this commit
- Next step: Other humans run onboarding and fill Human on their intro files; Doruk asked to push this work to main (no feature-branch PR).

### 2026-11-14 11:22 Europe/Istanbul — PRE-02 / MUST-12

- Human: Eymen
- Agent tool + model: Gemini (Antigravity)
- Role: tester-2
- Task id: PRE-02, MUST-12 (plus PRE-05/PRE-06 TLS re-check)
- Files changed: docs/team/profiles/eymen.md (new), docs/demo/README.md, docs/demo/script.md (new), docs/demo/video-beats.md (new), docs/demo/slides-outline.md (new), docs/demo/submission-checklist.md (new), docs/coordination/BOARD.md, docs/AI_USE.md, docs/coordination/AGENT_LOG.md
- Why: Completed Eymen's first-session onboarding interview (Bug tester 2, first name only, no personal data) and created Tester 2's full demo preparation suite in `docs/demo/` (2–3 min live demo script, ≤30 s English-subtitled video beat sheet with no under-18 voices/faces, 7-slide deck outline, and hours 40–48 submission & `?demo=1` rehearsal checklist). Also re-checked `www.spaceappschallenge.org` TLS status on 14 Nov 11:19 (still failing certificate validation; kept UNVERIFIED / provisionally official labels intact) and claimed MUST-12 for Tester 2 on `BOARD.md`.
- Commit: this commit
- Next step: Open/merge the `tester-2/onboarding-and-demo-docs` PR; review incoming `web/` and `pipeline/` PRs during MUST (hours 0–16) and run the hour-16 rough demo walk.

### 2026-11-14 11:30 Europe/Istanbul — PRE-02

- Human: Asil
- Agent tool + model: Gemini (Gemini 3.8 Flash)
- Role: tester-1
- Task id: PRE-02
- Files changed: docs/team/profiles/asil.md, docs/team/ROSTER.md, docs/coordination/BOARD.md, docs/AI_USE.md, docs/coordination/AGENT_LOG.md
- Why: Completed first-session onboarding interview for Asil (Tester 1); created profile, updated roster and board.
- Commit: this commit
- Next step: Draft MUST test checklist in docs/testing/ (MUST-11) and review judging checklist (PRE-06).

### 2026-11-14 11:30 Europe/Istanbul — PRE-02

- Human: CC
- Agent tool + model: Antigravity (Gemini 4 Hydrogen Medium)
- Role: backend-3
- Task id: PRE-02
- Files changed: docs/team/profiles/cc.md, docs/comms/intro-backend-3.md, docs/coordination/AGENT_LOG.md
- Why: Completed first-session onboarding interview for CC (Backend 3 — data) and filled Human in docs/comms/intro-backend-3.md; pushed directly to main as requested.
- Commit: this commit
- Next step: Check local environment (.env / NASA_API_KEY / Python), claim MUST-07 on BOARD.md, and start background data caches (REMS, RAD, waypoints, DONKI, MSL raw images).

### 2026-11-14 12:08 Europe/Istanbul — MUST-07 (initial caches)

- Human: CC
- Agent tool + model: Antigravity (Gemini 4 Hydrogen Medium)
- Role: backend-3
- Task id: MUST-07
- Files changed: docs/coordination/BOARD.md, docs/coordination/AGENT_LOG.md, pipeline/data/__init__.py, pipeline/data/common.py, pipeline/data/fetch_donki.py, pipeline/data/fetch_waypoints.py, pipeline/data/fetch_pov_index.py, pipeline/data/fetch_pds_indexes.py, pipeline/data/run_must07.py, data/processed/science/donki-cache.json, data/processed/science/msl-waypoints-cache.json, data/processed/science/msl-raw-images-cache.json, data/processed/science/pds-archives-index.json
- Why: Claimed MUST-07 and created Backend 3 background data-fetching scripts + initial processed caches (DONKI 30-day window with 13 Mars impacts, 1,389 MSL waypoints through Sol 5073, 30 latest + 30 boxwork MSL raw images). Recorded REMS (connection reset) and RAD (expired TLS cert) as unavailable without bypassing TLS.
- Commit: this commit
- Next step: Build SHOULD contract outputs (alerts.json, dose.json, weather.json, pov stills, THEMIS layers) once Backend 2 locks stops.json / route.json, or generate alerts.json from donki-cache.json next.

### 2026-11-14 11:32 Europe/Istanbul — MUST-11

- Human: Asil
- Agent tool + model: Gemini (Gemini 3.8 Flash)
- Role: tester-1
- Task id: MUST-11
- Files changed: docs/testing/must-checklist.md, docs/coordination/BOARD.md, docs/coordination/AGENT_LOG.md
- Why: Drafted beginner-friendly MUST test checklist covering PR gating, B1/B2/F1 criteria, and fallback requirements for hour 16 sign-off.
- Commit: this commit
- Next step: Review incoming PRs and coordinate with B1, B2, B3, F1 as MUST tasks get claimed.

### 2026-11-14 11:40 Europe/Istanbul — PRE-02 / MUST-01 (claim)

- Human: Cagan
- Agent tool + model: Claude Code (Claude Sonnet 5.5)
- Role: backend-1
- Task id: PRE-02, MUST-01
- Files changed: docs/team/profiles/cagan.md (new), docs/coordination/BOARD.md, docs/coordination/AGENT_LOG.md
- Why: Ran the onboarding interview (skills and GitHub username not asked) and wrote Cagan's profile. Claimed MUST-01 as Backend 1. Tried a first slope preview and cost map locally, then Cagan asked to drop it; none of that code or data is in this commit.
- Commit: this commit
- Next step: Install GDAL/rasterio and start MUST-01 again.

### 2026-11-14 11:22 Europe/Istanbul — PRE-02 / MUST-12

- Human: Eymen
- Agent tool + model: Gemini (Antigravity)
- Role: tester-2
- Task id: PRE-02, MUST-12 (plus PRE-05/PRE-06 TLS re-check)
- Files changed: docs/team/profiles/eymen.md (new), docs/demo/README.md, docs/demo/script.md (new), docs/demo/video-beats.md (new), docs/demo/slides-outline.md (new), docs/demo/submission-checklist.md (new), docs/coordination/BOARD.md, docs/AI_USE.md, docs/coordination/AGENT_LOG.md
- Why: Completed Eymen's first-session onboarding interview (Bug tester 2, first name only, no personal data) and created Tester 2's full demo preparation suite in `docs/demo/` (2–3 min live demo script, ≤30 s English-subtitled video beat sheet with no under-18 voices/faces, 7-slide deck outline, and hours 40–48 submission & `?demo=1` rehearsal checklist). Also re-checked `www.spaceappschallenge.org` TLS status on 14 Nov 11:19 (still failing certificate validation; kept UNVERIFIED / provisionally official labels intact) and claimed MUST-12 for Tester 2 on `BOARD.md`.
- Commit: this commit
- Next step: Open/merge the `tester-2/onboarding-and-demo-docs` PR; review incoming `web/` and `pipeline/` PRs during MUST (hours 0–16) and run the hour-16 rough demo walk.

### 2026-11-14 11:42 Europe/Istanbul — PRE-01 / PRE-02

- Human: Eymen (ParongUs)
- Agent tool + model: Gemini (Antigravity)
- Role: tester-2
- Task id: PRE-01, PRE-02
- Files changed: docs/team/ROSTER.md, docs/team/profiles/eymen.md, docs/comms/intro-tester-2.md, docs/coordination/AGENT_LOG.md
- Why: Recorded Eymen's GitHub username (`ParongUs`) on the team roster, in his profile (`eymen.md`), and updated `docs/comms/intro-tester-2.md` with his human name and agent tool.
- Commit: this commit
- Next step: Watch for other teammates' PRs to review as Tester 2; support MUST milestones.

### 2026-11-14 11:54 Europe/Istanbul — PRE-07

- Human: Doruk
- Agent tool + model: Grok (Cursor)
- Role: Backend 2
- Task id: PRE-07
- Files changed: pipeline/routing/PRE07_LOCK_REQUEST.md (new), pipeline/routing/README.md, docs/coordination/BOARD.md, docs/coordination/HANDOFFS.md, docs/coordination/AGENT_LOG.md
- Why: Next B2 MUST work (MUST-04/05/06) needs locked stops. Did not invent outcrop names or clear is_example. Claimed PRE-07 as blocked and filed a cited lock request + board question for Doruk/team.
- Commit: this commit
- Next step: Doruk/team answers PRE-07 lock (and optional example-scaffold yes/no); then MUST-04.

### 2026-11-14 11:55 Europe/Istanbul — MUST-01 (DTM crop, slope and ortho previews)

- Human: Cagan
- Agent tool + model: Claude Code (Claude Sonnet 5.5)
- Role: backend-1
- Task id: MUST-01
- Files changed: pipeline/terrain/make_slope.py (new), pipeline/terrain/crop_ortho.py (new), pipeline/terrain/requirements.txt (new), data/processed/terrain/slope-preview.png, slope_stats.json, ortho-preview.png (new), docs/coordination/BOARD.md, docs/coordination/AGENT_LOG.md
- Why: Cropped 2 km x 2 km of DTEEC_019698 (HTTP range reads), averaged 1 m to ~5 m cells, computed slope (median 9.7 deg; 28% of cells above 15 deg, 18% above 20 deg; no no-data in this crop) and wrote a class-coloured preview. Cropped the 25 cm RED_A orthoimage to the same footprint (read at about 2 m per pixel, 1000 x 1000 preview). The two previews show the same gully and ridge pattern. Raw crops are in data/raw/ and are not committed. The crop centre (4.83 S, 137.39 E, near Curiosity Sol 5070) is a placeholder until the stops are locked (PRE-07). Slope limits are lunar stand-ins and the DTM under-reads rover tilt.
- Commit: this commit
- Next step: MUST-02 cost map and height preview for the 3D view; re-crop when stops are locked; tilt check vs MSL waypoints (MUST-03).

### 2026-11-14 12:00 Europe/Istanbul — MUST-02 (first-pass cost map)

- Human: Cagan
- Agent tool + model: Claude Code (Claude Sonnet 5.5 / Opus 5.5)
- Role: backend-1
- Task id: MUST-02
- Files changed: pipeline/terrain/make_cost_map.py (new), data/processed/terrain/cost-map.json, height-preview.png (new), docs/contracts/CHANGES.md, docs/coordination/HANDOFFS.md, docs/coordination/BOARD.md, docs/coordination/AGENT_LOG.md
- Why: Added TRI roughness, the cost grid (multiplier; 9e99 = blocked, 18% of cells) and a 16-bit height preview for the 3D view. cost-map.json (~0.8 MB) parses in Python and Node with no Infinity/NaN. Contract field names kept; additive fields logged in CHANGES.md and handed off to backend-2, frontend-1 and testers. Crop centre is still a placeholder until PRE-07.
- Commit: this commit
- Next step: Tilt check vs MSL waypoints (MUST-03); re-run both scripts when stops are locked.

### 2026-11-14 12:05 Europe/Istanbul — MUST-11 (B1 terrain validation)

- Human: Asil
- Agent tool + model: Gemini (Gemini 3.8 Flash)
- Role: tester-1
- Task id: MUST-11
- Files changed: docs/testing/must-checklist.md, docs/coordination/HANDOFFS.md, docs/coordination/AGENT_LOG.md
- Why: Pulled latest team updates; verified and tested Backend 1 MUST-01 and MUST-02 outputs (crop, slope, TRI roughness, cost-map.json, height preview) against must-checklist.md; signed off section 2.1 as PASS (first pass); acknowledged handoffs from B1 and B2.
- Commit: this commit
- Next step: Wait for team decision on PRE-07 stop locking; review upcoming MUST-04 and routing PRs.

### 2026-11-14 12:05 Europe/Istanbul — MUST-04/05/06 (example scaffold)

- Human: Doruk
- Agent tool + model: Grok (Cursor)
- Role: Backend 2
- Task id: MUST-04, MUST-05, MUST-06
- Files changed: pipeline/routing/{write_stops.py,build_route.py,dijkstra_grid.py,mars_geo.py,requirements.txt,README.md}, data/processed/routing/{stops.json,route.json,hud-telemetry.json,README.md}, docs/coordination/BOARD.md, docs/coordination/AGENT_LOG.md
- Why: End-to-end Backend 2 example scaffold while PRE-07 is open. Habitat/boxwork use cited Sol 4527/4534 waypoints; mudstones use contract example points; all is_example. 8-neighbour Dijkstra with geodesic fallback; HUD samples with labelled O2 placeholder. No official outcrop names or mineral IDs invented. No secrets.
- Commit: this commit
- Next step: Stay on backend-2/routing-must-scaffold (long-lived; merge only at end). Re-run after PRE-07 lock and B1 re-crop; then clear is_example.

### 2026-11-14 12:17 Europe/Istanbul — SHOULD-01, SHOULD-02, SHOULD-04 (Phase 2 science outputs)

- Human: CC
- Agent tool + model: Antigravity (Gemini 4 Hydrogen High)
- Role: backend-3
- Task id: SHOULD-01, SHOULD-02, SHOULD-04
- Files changed: docs/coordination/BOARD.md, docs/coordination/HANDOFFS.md, docs/coordination/AGENT_LOG.md, pipeline/data/build_alerts.py, pipeline/data/build_dose.py, pipeline/data/build_layers_themis.py, pipeline/data/build_crism_index.py, pipeline/data/run_phase2.py, data/processed/science/alerts.json, data/processed/science/dose.json, data/processed/science/layers-themis.json, data/processed/science/layers-crism.json, data/processed/science/tiles/themis/{day,night}/z{4,6,8}_*.png
- Why: Built Phase 2 science outputs from cached/live NASA & PDS sources: alerts.json (13 WSA-Enlil Mars impacts), dose.json (0.0427 +/- 0.008 mSv using Hassler et al. 2014 baseline and placeholder 96 min route duration), layers-themis.json + 6 cached Gale sample PNG tiles (Day/Night IR z4/z6/z8), and layers-crism.json (9 CRISM MTRDR products over Gale via ODE REST). Marked MUST-07 review on BOARD.md and logged handoff to F1/Testers/B1.
- Commit: this commit
- Next step: Once PRE-07/MUST-04 locks stops and Backend 2 produces route.json, re-run build_dose.py, build per-stop POV stills (SHOULD-03), resolve weather.json (SHOULD-04), and copy frozen fixtures into data/demo/ (SHOULD-07).

### 2026-11-14 12:20 Europe/Istanbul — MUST-03 (tilt check, first pass)

- Human: Cagan
- Agent tool + model: Claude Code (Claude Sonnet 5.5)
- Role: backend-1
- Task id: MUST-03
- Files changed: pipeline/terrain/tilt_check.py (new), pipeline/terrain/make_cost_map.py (note text only), data/processed/terrain/tilt-check.json (new), data/processed/terrain/cost-map.json (note text only; grid unchanged), docs/coordination/BOARD.md, docs/coordination/AGENT_LOG.md
- Why: Sampled DTM slope at 176 Curiosity waypoints (Sol 4400-5073, inside DTEEC_019698) and compared it with the rover-reported tilt. At ~5 m scale the medians agree (DTM 9.0 deg, rover 8.6 deg; difference -0.06 deg) and at 1 m the DTM is slightly higher (9.6 deg); correlation is weak (r 0.11-0.15). This does not reproduce the 11 Nov planning note that the DTM under-reads tilt at four boxwork Sols, so that claim is not confirmed over a larger sample. Limits: rover tilt is body tilt over ~3 m, no co-registration of waypoints to the DTM, and rovers drive on gentle ground. The cost-map note was reworded to say this; the safety-margin advice stays. The MUST raster is not frozen yet because the crop centre is still a placeholder (PRE-07).
- Commit: this commit
- Next step: Re-run make_slope.py, make_cost_map.py and tilt_check.py once the stops are locked, then freeze the MUST raster. Tell testers and the slides owner that the "DTM under-reads tilt" wording needs softening.
- Previous commit: 3078ef5

### 2026-11-14 12:20 Europe/Istanbul — SHOULD-03, SHOULD-04, SHOULD-07 (B3 complete)

- Human: CC
- Agent tool + model: Antigravity (Gemini 4 Hydrogen High)
- Role: backend-3
- Task id: SHOULD-03, SHOULD-04, SHOULD-07
- Files changed: docs/coordination/BOARD.md, docs/coordination/HANDOFFS.md, docs/coordination/AGENT_LOG.md, docs/AI_USE.md, pipeline/data/build_weather.py, pipeline/data/build_pov.py, pipeline/data/export_demo_fixtures.py, pipeline/data/run_phase3.py, data/processed/science/weather.json, data/processed/science/pov/*, data/demo/*
- Why: Completed Backend 3 Phase 3 outputs: weather.json from official CAB/NASA REMS daily summary feed (4,745 sols through Sol 4995, no invented hourly curve), 4 cached Curiosity POV JPEGs + per-stop JSONs (marked example stops until PRE-07 locks), and exported 22 frozen science fixtures (789.7 KB) to data/demo/ for demo-safe mode. Marked SHOULD-01..04 review on BOARD.md, logged AI use in docs/AI_USE.md, and added final handoff in HANDOFFS.md.
- Commit: this commit
- Next step: Open PR for backend-3/must-07-data-cache; re-run build_dose, build_pov, and export_demo_fixtures once Backend 2 lands locked stops.json and route.json.

### 2026-11-14 12:45 Europe/Istanbul — backend folder split

- Human: Doruk
- Agent tool + model: Grok (Cursor)
- Role: Backend 2 (repo integration pass)
- Task id: n/a (merge-all + split)
- Files changed: pipeline/README.md, pipeline/costmap/*, pipeline/stops/*, pipeline/routing/build_route.py, pipeline/terrain/README.md, docs/coordination/AGENT_LOG.md
- Why: Merged all existing role branches into main; split backend pipeline into five folder-scoped long-lived branches (terrain, costmap, stops, routing, science). Did not merge those five back together. No secrets.
- Commit: this commit
- Next step: Later pass merges the five backend branches into the full project.

### 2026-11-14 12:52 Europe/Istanbul — standing branch rules

- Human: Doruk
- Agent tool + model: Grok (Cursor)
- Role: docs / Backend 2 (integration)
- Task id: n/a
- Files changed: AGENTS.md, docs/coordination/README.md, docs/coordination/BOARD.md, docs/coordination/AGENT_LOG.md, docs/roles/backend-1-terrain.md, backend-2-routing.md, backend-3-data.md, frontend-1-hud.md, tester-1.md, tester-2.md
- Why: Document long-lived branches (merge to main only when asked), pull-then-push after every prompt, and remaining backend work split (Cagan terrain+costmap; Doruk routing+stops example until PRE-07; CC science leftovers). Frontend/testers marked not this pass. No application code for Cagan/CC; no secrets.
- Commit: this commit
- Next step: Each backend agent continues on its long-lived branch per the split.

### 2026-11-14 13:12 Europe/Istanbul — MUST-02 (example-stop cost map)

- Human: Cagan
- Agent tool + model: Grok (Cursor)
- Role: backend-1
- Task id: MUST-02
- Files changed: pipeline/costmap/make_cost_map.py, pipeline/costmap/crop_window.py, pipeline/costmap/README.md, data/processed/terrain/cost-map.json, height-preview.png, README.md, docs/comms/intro-backend-1.md, docs/coordination/BOARD.md, docs/coordination/AGENT_LOG.md
- Why: Rebuilt the hazard cost grid and 16-bit height preview on the same ~2 km DTEEC_019698 window as the terrain crop (395×395 cells, ~5.06 m, 23.8% blocked at the 20° lunar stand-in). Every example point in docs/contracts/stops.json and data/processed/routing/stops.json is inside the bounds (137.373–137.407°E, 4.817–4.783°S). The contract example boxwork point lands on a 20.8° cell, so that one cell is the blocked sentinel. The routing example at the cited Sol 4534 point is 14.0°. No official outcrop names. No raw rasters. PRE-07 is still open. Slope and ortho PNGs that match this window are on backend/terrain; this branch still has the earlier placeholder-centre previews.
- Commit: this commit
- Next step: Testers review backend/terrain and backend/costmap. Re-run both after PRE-07 locks real outcrops. Do not merge to main unless asked.
