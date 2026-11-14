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

### 2026-11-14 13:30 Europe/Istanbul — MUST-02 / MUST-03 (fixes)

- Human: Cagan
- Agent tool + model: Claude Code (Claude Sonnet 5.5)
- Role: backend-1
- Task id: MUST-02, MUST-03
- Files changed: pipeline/terrain/make_cost_map.py, make_slope.py, requirements.txt (scipy), data/processed/terrain/cost-map.json and height-preview.png (regenerated), docs/contracts/cost-map.json (note fields) and CHANGES.md, docs/roles/backend-1-terrain.md, skills/dem-to-slope/SKILL.md, docs/AI_USE.md, docs/DATA_SOURCES.md (new), .gitattributes (new), docs/coordination/HANDOFFS.md, docs/coordination/AGENT_LOG.md
- Why: Fixed the height preview (16-bit grey PNG becomes an 8-bit RGB encoding; decoded back to the expected range with 53,969 distinct levels). Softened the "DTM under-reads tilt" wording in files Backend 1 owns, since MUST-03 did not confirm it. Added scipy to requirements, an AI_USE row, a data-sources file and a .gitattributes to stop LF/CRLF warnings. Other roles' files still carry the old wording; flagged in a handoff, not edited.
- Commit: this commit
- Next step: Open the PR for a tester; re-run the scripts once stops are locked (PRE-07).
- Previous commit: 638e466

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

### 2026-11-14 12:59 Europe/Istanbul — MUST-11

- Human: Asil
- Agent tool + model: Grok (Cursor agent)
- Role: tester-1
- Task id: MUST-11
- Files changed: docs/testing/test-plan.md (new), docs/testing/contract-checklist.md (new), docs/testing/README.md, docs/testing/must-checklist.md (pointer only), docs/AI_USE.md, docs/comms/intro-tester-1.md, docs/coordination/BOARD.md (MUST-11 and one T1 question), docs/coordination/AGENT_LOG.md
- Why: Wrote the MUST test plan and the contract checklist from a document review of main `d2c4695`. Rolled AGENT_LOG tool-and-purpose rows into docs/AI_USE.md without deleting existing rows. Did not sign hour-16 MUST: stops are still examples, the route uses the contract cost grid, and web/ has no app. No pipeline or web code edits. No secrets.
- Commit: this commit
- Next step: Tester 2 reviews branch `tester/review`. Do not merge to main until asked. Re-walk the plan after PRE-07 and after Frontend 1 lands. Previous commit on main before this branch: d2c4695.

### 2026-11-14 13:03 Europe/Istanbul — MUST-12

- Human: Eymen
- Agent tool + model: Grok (Cursor)
- Role: tester-2
- Task id: MUST-12
- Files changed: docs/demo/demo-path.md (new), docs/demo/demo-path.srt (new), docs/demo/README.md, docs/demo/script.md, docs/demo/video-beats.md, docs/demo/slides-outline.md, docs/demo/submission-checklist.md, docs/comms/note-tester-2-demo-path.md (new), docs/comms/intro-tester-2.md, docs/comms/README.md, docs/coordination/BOARD.md, docs/coordination/HANDOFFS.md, docs/AI_USE.md, docs/coordination/AGENT_LOG.md
- Why: Scripted the record-now demo path. The web HUD is not built, so the 29 s English-subtitled cut uses the slope preview, two Curiosity stills, and a caption card (no under-18 faces or voices), with the 7-slide outline as the alternative. Aligned numbers to the example route (947.1 m stated; legs sum to 790.3 m — flagged, not papered over), the 96 min dose card (0.0427 ± 0.008 mSv), and the 14 Nov tilt check (no systematic under-read). No pipeline or web code. No secrets.
- Commit: this commit
- Next step: Tester 1 reviews branch tester/demo. Do not merge to main unless asked. Re-record after PRE-07, after Backend 2 confirms the route total, and when MUST-08–10 can be clicked.

### 2026-11-14 13:05 Europe/Istanbul — MUST-01 (crop plan)

- Human: Cagan
- Agent tool + model: Grok (Cursor)
- Role: backend-1
- Task id: MUST-01
- Files changed: docs/comms/intro-backend-1.md, docs/coordination/BOARD.md, docs/coordination/AGENT_LOG.md
- Why: Posted the Backend 1 ship note before the recrop. Will cover every example stop already in docs/contracts/stops.json and data/processed/routing/stops.json with a HiRISE DTM and ortho crop on backend/terrain, then the cost grid on backend/costmap. No official outcrop names. No merge to main.
- Commit: this commit
- Next step: Run the DTEEC_019698 crop and slope preview on backend/terrain, then the cost map on backend/costmap.

### 2026-11-14 13:07 Europe/Istanbul — MUST-01 (example-stop HiRISE crop)

- Human: Cagan
- Agent tool + model: Grok (Cursor)
- Role: backend-1
- Task id: MUST-01
- Files changed: pipeline/terrain/crop_window.py, make_slope.py, crop_ortho.py, README.md, data/processed/terrain/slope-preview.png, slope_stats.json, ortho-preview.png, README.md, docs/coordination/BOARD.md, docs/coordination/AGENT_LOG.md
- Why: Recropped DTEEC_019698 and the matching RED ortho so every example stop already in docs/contracts/stops.json and data/processed/routing/stops.json is inside a 2 km window (centre about 4.800°S, 137.390°E). Averaged 1 m to ~5.06 m. Median slope 11.6°; 36% of cells above 15°; 24% above 20°; no no-data in this crop. Raw GeoTIFFs stay gitignored. Ids are the example ids already in those files. PRE-07 is still open. Cost grid is the next commit on backend/costmap, so cost-map.json on this branch is still the earlier placeholder-centre grid.
- Commit: this commit
- Next step: Build the cost map and height preview for this same window on backend/costmap.

### 2026-11-14 13:10 Europe/Istanbul — MUST-02 (example-stop cost grid)

- Human: Cagan
- Agent tool + model: Grok (Cursor)
- Role: backend-1
- Task id: MUST-02
- Files changed: pipeline/costmap/make_cost_map.py, pipeline/costmap/crop_window.py, pipeline/costmap/README.md, data/processed/terrain/cost-map.json, height-preview.png, README.md, docs/comms/intro-backend-1.md, docs/coordination/BOARD.md, docs/coordination/AGENT_LOG.md
- Why: Rebuilt the hazard cost grid and 16-bit height preview on the same ~2 km DTEEC_019698 window as the terrain crop (395×395 cells, ~5.06 m, 23.8% blocked at the 20° lunar stand-in). Every example point in docs/contracts/stops.json and data/processed/routing/stops.json is inside the bounds (137.373–137.407°E, 4.817–4.783°S). The contract example boxwork point lands on a 20.8° cell, so that one cell is the blocked sentinel. The routing example at the cited Sol 4534 point is 14.0°. No official outcrop names. No raw rasters. PRE-07 is still open. Slope and ortho PNGs that match this window are on backend/terrain; this branch still has the earlier placeholder-centre previews.
- Commit: this commit
- Next step: Testers review backend/terrain and backend/costmap. Re-run both after PRE-07 locks real outcrops. Do not merge to main unless asked.

### 2026-11-14 13:34 Europe/Istanbul — MUST-12 (static analysis & POSSIBLE_BUGS.md)

- Human: Eymen (ParongUs)
- Agent tool + model: Gemini (Antigravity)
- Role: tester-2
- Task id: MUST-12
- Files changed: POSSIBLE_BUGS.md (new), docs/coordination/AGENT_LOG.md
- Why: Audited `main` (`pipeline/`, `data/processed/`, `data/demo/`, `web/`, `docs/contracts/`), verified all 24 Python files compile, checked for secrets/bulky files and `data/` size (3.23 MB), and documented 7 bugs/integration risks in `POSSIBLE_BUGS.md` (empty `web/`, `cost-map.json` vs `stops.json` bounds mismatch, `hud-telemetry.json` wrapper mismatch, `dose.json` stale duration, missing terrain/routing `data/demo/` fixtures, and `MUST-03` tilt wording update).
- Commit: this commit
- Next step: Share `POSSIBLE_BUGS.md` findings with Frontend 1 and Backends 1–3; update demo script/slides after `PRE-07` lock and `MUST-03` wording.
### 2026-11-14 12:57 Europe/Istanbul — MUST-04/05/06 (B2 ship note + regenerate)

- Human: Doruk
- Agent tool + model: Grok (Cursor)
- Role: Backend 2
- Task id: MUST-04, MUST-05, MUST-06
- Files changed: docs/comms/note-backend-2-ship.md (new), docs/comms/intro-backend-2.md, docs/comms/README.md, pipeline/routing/README.md, data/processed/routing/{stops,route,hud-telemetry}.json, docs/coordination/BOARD.md (B2 rows), docs/coordination/AGENT_LOG.md
- Why: Comms ship note; keep example stops/route/HUD working. Dijkstra still on docs/contracts cost-map because B1 crop does not cover stop lon/lats. All is_example. No invented outcrop names. Branches backend/stops + backend/routing; not merging to main.
- Commit: this commit
- Next step: Re-run when Cagan re-crops cost map over stops; clear is_example only after PRE-07 lock.

### 2026-11-14 13:02 Europe/Istanbul — SHOULD-01 (claim)

- Human: CC
- Agent tool + model: Grok 4.7 (Cursor)
- Role: backend-3
- Task id: SHOULD-01
- Files changed: docs/comms/note-backend-3-science-leftovers.md (new), docs/comms/README.md, docs/coordination/BOARD.md, docs/coordination/AGENT_LOG.md
- Why: Posted the Backend 3 note for this pass before editing science files. Claimed SHOULD-01. `NASA_API_KEY` is absent; live DONKI will be skipped; labelled example fixtures will be added without replacing the existing cache. No secrets.
- Commit: this commit
- Next step: Refresh dose from the example route, relabel POV JSON offline, write the labelled DONKI example, and tidy B3 board rows.

### 2026-11-14 13:05 Europe/Istanbul — SHOULD-01 / SHOULD-02 / SHOULD-03 / PRE-04

- Human: CC
- Agent tool + model: Grok 4.7 (Cursor)
- Role: backend-3
- Task id: SHOULD-01, SHOULD-02, SHOULD-03, PRE-04
- Files changed: pipeline/data/example_fixtures.py (new), pipeline/data/run_examples.py (new), pipeline/data/{common.py,fetch_donki.py,build_dose.py,build_pov.py,export_demo_fixtures.py,README.md}, data/processed/science/{dose.json,alerts.example.json,donki-cache.example.json,pov/*}, data/demo/ science copies of those files, docs/coordination/{BOARD.md,HANDOFFS.md,AGENT_LOG.md}, docs/comms/note-backend-3-science-leftovers.md, docs/AI_USE.md
- Why: NASA_API_KEY is not on this machine. Skipped live DONKI and wrote labelled example fixtures (11 Nov 2026 planning-check arrival only). Left the real 13-impact cache in place. Refreshed dose from the example route (71 min placeholder, 0.0315 ± 0.0059 mSv, status example). Relabelled POV JSON from example stops and reused the four JPEGs. No .env. No contract field changes. Board rows for B3 only.
- Commit: this commit
- Next step: Tester review of backend/science. Re-run dose and POV after PRE-07 locks real stops. A personal NASA_API_KEY in a local gitignored .env is still needed before any live DONKI refresh.

### 2026-11-14 13:19 Europe/Istanbul — MUST-05 distance fix and cost-map re-run

- Human: Doruk
- Agent tool + model: Grok (Cursor Grok 4.7)
- Role: backend-2
- Task id: MUST-05, MUST-06
- Files changed: pipeline/routing/build_route.py, pipeline/routing/README.md, data/processed/routing/route.json, data/processed/routing/hud-telemetry.json, docs/comms/note-backend-2-ship.md, docs/coordination/BOARD.md, docs/coordination/AGENT_LOG.md
- Why: Tester 2 reported the example route total (947.1 m) did not equal the four legs (790.3 m). Reported distance_m is now the sum of the stop-to-stop legs. Re-ran Dijkstra on Cagan's cost map backend/costmap @ 5e84db6 (crop covers the example stops; terrain file on this branch was not replaced). Routed stops are passable and were not moved. The contract example boxwork point at 137.393, -4.803 is blocked and was left in place. status stays example. No invented outcrop names. No secrets.
- Commit: this commit
- Next step: Clear is_example only after PRE-07 lock. Do not merge backend/routing or backend/stops to main until asked.

### 2026-11-14 13:34 Europe/Istanbul — MUST-12 (static analysis & POSSIBLE_BUGS.md)

- Human: Eymen (ParongUs)
- Agent tool + model: Gemini (Antigravity)
- Role: tester-2
- Task id: MUST-12
- Files changed: POSSIBLE_BUGS.md (new), docs/coordination/AGENT_LOG.md
- Why: Audited `main` (`pipeline/`, `data/processed/`, `data/demo/`, `web/`, `docs/contracts/`), verified all 24 Python files compile, checked for secrets/bulky files and `data/` size (3.23 MB), and documented 7 bugs/integration risks in `POSSIBLE_BUGS.md` (empty `web/`, `cost-map.json` vs `stops.json` bounds mismatch, `hud-telemetry.json` wrapper mismatch, `dose.json` stale duration, missing terrain/routing `data/demo/` fixtures, and `MUST-03` tilt wording update).
- Commit: this commit
- Next step: Share `POSSIBLE_BUGS.md` findings with Frontend 1 and Backends 1–3; update demo script/slides after `PRE-07` lock and `MUST-03` wording.

### 2026-11-14 13:40 Europe/Istanbul — Merge all backend branches into main

- Human: CC
- Agent tool + model: Antigravity (Gemini 4 Hydrogen XHigh)
- Role: backend-3 (integration)
- Task id: n/a
- Files changed: docs/comms/README.md, docs/coordination/AGENT_LOG.md, docs/coordination/BOARD.md, docs/coordination/HANDOFFS.md, data/processed/terrain/*, data/processed/routing/*, data/processed/science/*, data/demo/*, pipeline/*
- Why: Pulled latest main (5b9fec6) and merged all five backend branches (backend/terrain, backend/costmap, backend/stops, backend/routing, backend/science) into main so Frontend 1 can start directly on the unified backend outputs.
- Commit: this commit
- Next step: Frontend 1 starts on main; tester branches (tester/review, tester/demo) can review/merge next.

### 2026-11-14 13:44 Europe/Istanbul — MUST-12 (re-audit after 5-branch merge)

- Human: Eymen (ParongUs)
- Agent tool + model: Gemini (Antigravity)
- Role: tester-2
- Task id: MUST-12
- Files changed: POSSIBLE_BUGS.md, docs/coordination/AGENT_LOG.md
- Why: Pulled `5542207` after the 5-branch backend merge (`terrain`, `costmap`, `stops`, `routing`, `science`) and re-ran static checks: 28/28 Python files compile cleanly, 4/4 stops now sit inside `cost-map.json` bounds, and `data/` is 3.23 MB. Updated `POSSIBLE_BUGS.md` with current open issues (empty `web/`, `route.json` null elevation/climb & stale `dose_mSv_see`, `hud-telemetry.json` wrapper mismatch, `dose.json` stale 71.0 min duration vs 59.3 min route, missing terrain/routing `data/demo/` fixtures, duplicate `crop_window.py`, and open `PRE-07`).
- Commit: this commit
- Next step: Monitor Frontend 1 PRs (`web/`) and re-check after `PRE-07` stop lock + `build_dose.py` re-run.

### 2026-11-14 13:44 Europe/Istanbul — MUST-06 height and slope on the example route

- Human: Doruk
- Agent tool + model: Grok (Cursor Grok 4.7)
- Role: backend-2
- Task id: MUST-05, MUST-06
- Files changed: pipeline/routing/build_route.py, pipeline/routing/README.md, data/processed/routing/route.json, data/processed/routing/hud-telemetry.json, docs/comms/note-backend-2-ship.md, docs/coordination/BOARD.md (MUST-05 and MUST-06 rows), docs/coordination/AGENT_LOG.md
- Why: The example route on backend/costmap @ 5e84db6 already reported 790.3 m, matching the four legs, so that fix was not repeated. Climb, descent, profile elevation, and HUD slope now come from the matching 16-bit height preview. Stops stay is_example. The blocked contract example boxwork point was not moved. No invented outcrop names. No secrets. Terrain files were not replaced.
- Commit: this commit
- Next step: Clear is_example only after PRE-07 lock. Do not merge to main until asked.

### 2026-11-14 13:55 Europe/Istanbul — Non-frontend bug & integration fixes (BUG-02..BUG-08)

- Human: CC
- Agent tool + model: Antigravity (Gemini)
- Role: backend-3 (integration cleanup)
- Task id: MUST-02, MUST-05, MUST-06, SHOULD-01, SHOULD-07, MUST-12
- Files changed: data/processed/terrain/height-preview.png, data/processed/terrain/cost-map.json, pipeline/routing/build_route.py, data/processed/routing/route.json, data/processed/routing/hud-telemetry.json, data/processed/science/dose.json, pipeline/data/export_demo_fixtures.py, data/demo/*, pipeline/costmap/crop_window.py, POSSIBLE_BUGS.md, docs/demo/script.md, docs/demo/slides-outline.md, docs/demo/submission-checklist.md, docs/testing/must-checklist.md, docs/roles/tester-2.md, docs/JUDGING_CHECKLIST.md, .cursor/rules/data-and-map.mdc, skills/hud-3d/SKILL.md, skills/map-ui/SKILL.md, AGENTS.md, ROADMAP.md, docs/contracts/CHANGES.md, docs/coordination/BOARD.md, docs/coordination/HANDOFFS.md, docs/coordination/AGENT_LOG.md
- Why: Fixed all non-frontend issues reported in `POSSIBLE_BUGS.md` and `HANDOFF-20261114-1330`: converted `height-preview.png` on `main` to lossless 8-bit RGB (`R*256+G`), populated real `elev_m`/`slope_deg`/`climb_m`/`descent_m` and `dose_mSv_see` in `route.json` (`BUG-02`), exposed flat top-level contract keys alongside `primary`/`samples[]` in `hud-telemetry.json` (`BUG-03`), rebuilt `dose.json` against the 59.3 min route (`0.0263 +/- 0.0049 mSv`, `BUG-05`), exported terrain + routing offline fixtures into `data/demo/` (28 files, `BUG-06`), softened `MUST-03` tilt wording across non-frontend docs (`BUG-07`), and deduplicated `pipeline/costmap/crop_window.py` to re-export `pipeline/terrain/crop_window.py` (`BUG-08`).
- Commit: this commit
- Next step: Frontend 1 implements `web/` (`BUG-01`, `MUST-08`..`MUST-10`, `SHOULD-05`); team locks real stops for `PRE-07` (`BUG-09`).

### 2026-11-14 14:03 Europe/Istanbul — MUST-12 (full re-audit on 0f200d0)

- Human: Eymen (ParongUs)
- Agent tool + model: Gemini (Antigravity)
- Role: tester-2
- Task id: MUST-12
- Files changed: POSSIBLE_BUGS.md, docs/coordination/AGENT_LOG.md
- Why: Re-audited `main` at `0f200d0` after `tester/demo`, `tester/review`, and `f81df38` (`BUG-02`..`BUG-08` fixes). Verified 28/28 Python files compile, 0 `NaN`/`Infinity` values across all `data/` JSONs, 9/9 core JSONs match between `data/processed/` and `data/demo/`, and total `data/` size is 4.50 MB. Found and logged `[BUG-10]`: 13 JSON files in `data/demo/` still reference `data/processed/...` relative asset paths, which could break strict `?demo=1` isolation unless rewritten by `export_demo_fixtures.py` or Frontend 1.
- Commit: this commit
- Next step: Hand off `BUG-10` to Backend 3 / Frontend 1; continue monitoring `web/` (`BUG-01`) and `PRE-07` (`BUG-09`).

### 2026-11-14 14:13 Europe/Istanbul — MUST-12 (deep geometry, telemetry, manifest & link audit)

- Human: Eymen (ParongUs)
- Agent tool + model: Gemini (Antigravity)
- Role: tester-2
- Task id: MUST-12
- Files changed: POSSIBLE_BUGS.md, docs/coordination/AGENT_LOG.md
- Why: Ran deep verification across `main` (`65c2e5e`): checked all 132 route vertices against `cost-map.json` blocked cells (0 hits, 0 out-of-bounds), verified `sum(legs) == 790.30 m`, checked all 8 HUD telemetry samples for `slope_class` / `O2` / distance sums, verified 28/28 `data/demo/science-manifest.json` files on disk, and checked all markdown relative links (0 broken). Logged `[BUG-11]` (missing GitHub usernames for B1–B3 and F1 in `docs/team/ROSTER.md`) and updated `POSSIBLE_BUGS.md`.
- Commit: this commit
- Next step: Await Frontend 1 `web/` scaffold (`BUG-01`), `BUG-10` demo path fix, and `PRE-07` stop lock.

### 2026-11-14 14:09 Europe/Istanbul — PRE-02 / MUST-08..10 / SHOULD-05..07

- Human: F1
- Agent tool + model: Antigravity (Gemini)
- Role: frontend-1
- Task id: PRE-02, MUST-08, MUST-09, MUST-10, SHOULD-05, SHOULD-06, SHOULD-07
- Files changed: docs/team/profiles/f1.md (new), docs/comms/intro-frontend-1.md, docs/coordination/BOARD.md, docs/coordination/HANDOFFS.md, docs/coordination/AGENT_LOG.md, web/index.html (new), web/styles.css (new), web/app.js (new), web/README.md, web/shared/data-loader.js (new), web/shared/route-bridge.js (new), web/planner/planner.js (new), web/hud/hud3d.js (new)
- Why: Completed F1 onboarding profile (PRE-02) and built the full Frontend 1 static web app (2D MapLibre planner + `mm:set-route` bridge + 3D three.js heightmap from `height-preview.png` + helmet HUD with distance, slope/class, next stop, placeholder suit O2 + DONKI, RAD dose, REMS weather, Curiosity POV lightbox, 15°/20° toggle, THEMIS/CRISM toggles, Credits/Honesty modal, and `?demo=1` demo-safe mode). Verified all 27 local web and data URLs return HTTP 200 via `http.server`.
- Commit: this commit
- Next step: Testers 1 & 2 review `web/` in browser and sign off MUST-08..10 and SHOULD-05..07.

### 2026-11-14 14:26 Europe/Istanbul — MUST-09 (smooth 3D camera turns)

- Human: F1
- Agent tool + model: Antigravity (Gemini)
- Role: frontend-1
- Task id: MUST-09
- Files changed: web/hud/hud3d.js, docs/coordination/AGENT_LOG.md
- Why: Replaced abrupt 45-degree Dijkstra segment heading snaps with an 18 m look-ahead bearing, shortest-angle exponential yaw damping, and bilinear elevation sampling so 3D EVA playback turns and walks smoothly.
- Commit: this commit
- Next step: Reload `http://localhost:8000/web/` in browser to verify smooth turns.

### 2026-11-14 14:29 Europe/Istanbul — MUST-09 (keep camera yaw under user control)

- Human: F1
- Agent tool + model: Antigravity (Gemini)
- Role: frontend-1
- Task id: MUST-09
- Files changed: web/hud/hud3d.js, docs/coordination/AGENT_LOG.md
- Why: Removed automatic camera yaw rotation on route turns per F1 request; camera position follows the route while look direction remains strictly user-controlled via mouse drag.
- Commit: this commit
- Next step: Reload `http://localhost:8000/web/` in browser to verify.

### 2026-11-14 14:50 Europe/Istanbul — n/a

- Human: Doruk
- Agent tool + model: Grok (Cursor)
- Role: orchestrator
- Task id: n/a
- Files changed: docs/roles/prompts/README.md, docs/roles/prompts/cagan.md, docs/roles/prompts/cetin.md, docs/roles/prompts/divarci.md, docs/roles/prompts/eymen.md, docs/roles/prompts/doruk.md, docs/roles/README.md, AGENTS.md, docs/team/ROSTER.md, docs/team/profiles/cc.md, docs/coordination/BOARD.md, docs/coordination/AGENT_LOG.md
- Why: Wrote one instruction file per nickname for the astronaut-visor pass (Cagan first in Claude, Cetin beside him, Divarci on the visor, Eymen reviewing, Doruk compiling). Each file starts with a nickname grill. Science and terrain numbers must come from cached NASA and PDS products. Live DONKI uses `NASA_API_KEY` from the gitignored `.env` (present on this machine; the value is not in git). CC's profile nickname for this pack is Cetin.
- Commit: this commit
- Next step: Paste `docs/roles/prompts/cagan.md` into Claude Code. Cetin then runs a live DONKI fetch. Divarci waits until Cagan's four processed JSON files are confirmed.

### 2026-11-14 15:20 Europe/Istanbul — MUST-02 / MUST-04..06 (source citations)

- Human: Cagan
- Agent tool + model: Claude Code (Claude Fable 5.2)
- Role: backend implementer (terrain, costmap, routing, stops)
- Task id: MUST-02, MUST-04, MUST-05, MUST-06
- Files changed: pipeline/costmap/make_cost_map.py, pipeline/stops/write_stops.py, pipeline/routing/build_route.py, data/processed/terrain/cost-map.json, data/processed/routing/stops.json, route.json, hud-telemetry.json, docs/contracts/CHANGES.md, docs/coordination/HANDOFFS.md, docs/coordination/BOARD.md, docs/coordination/AGENT_LOG.md
- Why: Audit against docs/roles/prompts/cagan.md found that none of the four visor files cited a source URL or fetch date. Added an additive `sources[]` block (HiRISE DTEEC_019698 on PDS; MSL_waypoints.json; fetch date 2026-11-14) and per-stop `source_url`. Checked the Sol 4527 and Sol 4534 stop coordinates against the local waypoint file (exact match). Mudstone example stops have no citation and are marked UNVERIFIED. Regenerated stops, route and HUD locally; route numbers unchanged (790.3 m, 132 points, none outside the grid or on blocked cells); all four parse in Node. cost-map.json was edited in place (sources only) because the DTM re-download stalled. Status stays example.
- Commit: this commit
- Next step: Cetin re-exports data/demo fixtures; PRE-07 must replace the two uncited mudstone stops; PR for Eymen.

### 2026-11-14 15:22 Europe/Istanbul — MUST-12 / SHOULD-07 (NASA data & ?demo=1 audit)

- Human: Eymen (ParongUs)
- Agent tool + model: Gemini (Antigravity)
- Role: tester-2
- Task id: MUST-12, SHOULD-07
- Files changed: docs/testing/nasa-data-audit.md (new), POSSIBLE_BUGS.md, docs/coordination/AGENT_LOG.md
- Why: Audited `web/`, `data/processed/`, and `data/demo/` against `docs/roles/prompts/eymen.md` §4 (NASA sources, fetch dates, placeholder labels, secrets/DEMO_KEY, `?demo=1` isolation). Verified all 11 processed JSONs cite NASA/PDS sources and fetch/compute dates (with 0 secrets or `DEMO_KEY`/`mars-photos` usage). Found and logged 3 `?demo=1` / sync bugs: `BUG-12` (`web/planner/planner.js` registers `trek.nasa.gov` tiles and `web/index.html` loads `unpkg.com` CDN even in `?demo=1`), `BUG-13` (`data/demo/` out of sync with `2b217d1` citations in `data/processed/`), and `BUG-14` (`web/shared/data-loader.js` hardcodes `data/processed/terrain/ortho-preview.png` in `?demo=1`).
- Commit: this commit
- Next step: Hand off `BUG-12`/`BUG-14` to Frontend 1 (Dıvarcı) and `BUG-13` (`export_demo_fixtures.py` re-run) to Backend 3 (Çetin).

### 2026-11-14 15:45 Europe/Istanbul — BUG-13 / BUG-14

- Human: Cagan
- Agent tool + model: Claude Code (Claude Sonnet 5.5)
- Role: backend implementer (small edits outside own folders, asked for by Cagan)
- Task id: SHOULD-07 (BUG-13, BUG-14)
- Files changed: pipeline/data/export_demo_fixtures.py (one line, Cetin's tree), web/shared/data-loader.js (one line, Divarci's tree), data/demo/ (re-exported: cost-map, stops, route, hud-telemetry, ortho-preview.png, science-manifest.json), docs/coordination/AGENT_LOG.md
- Why: BUG-13: re-ran the export so the four data/demo/ JSON copies match data/processed/ (all four byte-identical; they now carry sources[]). BUG-14: the export now also copies ortho-preview.png (560 KB) into data/demo/, and orthoPreviewUrl uses baseTerrainDir so ?demo=1 reads data/demo/ instead of data/processed/. Loader passes node --check. Not tested in a browser. BUG-12 (trek.nasa.gov and unpkg.com still loaded in ?demo=1) is Frontend 1's and was not touched.
- Commit: this commit
- Next step: Divarci and Eymen re-check ?demo=1 with the network off; Divarci fixes BUG-12; Cetin to know his export script gained one line.

### 2026-11-14 15:45 Europe/Istanbul — MUST-02 follow-up (relief, textures, STL)

- Human: Cagan
- Agent tool + model: Claude Code (Claude Opus 5.5)
- Role: backend implementer (terrain)
- Task id: MUST-02 follow-up
- Files changed: pipeline/terrain/make_relief.py (new), pipeline/terrain/fetch_dtm.py (new), pipeline/terrain/make_slope.py (uses a local DTM band if present), pipeline/terrain/README.md, data/processed/terrain/ (hillshade.png, texture-ortho.jpg, texture-relief.jpg, relief.stl, relief-preview.png, relief.json), docs/coordination/HANDOFFS.md, docs/coordination/AGENT_LOG.md
- Why: Cagan asked for a better map like a DEM relief model (reference: DEM -> triangulated surface -> STL). Added multi-directional hillshade, an ortho x hillshade texture with an illustrative Mars tint, a closed STL (checked: 0 non-manifold edges, consistent outward winding, positive volume) and an oblique 3D preview rendered without extra libraries. The HiRISE server gave about 5 KB/s, so the products were built offline from the 5 m height preview and the 1000 px ortho preview (same window as cost-map.json). fetch_dtm.py downloads the needed DTM rows in resumable chunks for a later full-resolution run. Fixed a fill bug found on the way: a mean fill of one no-data cell made a 250 m spike; now nearest-neighbour fill. Cost grid and route untouched.
- Commit: this commit
- Next step: When the network allows, run fetch_dtm.py then make_slope.py and make_relief.py (full mode) for 1 m height and 4096 px textures; Divarci wires texture-relief.jpg into the HUD.

- Correction (same day): the entry above was first written with 16:15; the real time was about 15:45. fetch_dtm.py now takes --chunk-kb (default 512) because the server reset 4 MB range requests ten times in a row.

### 2026-11-14 15:32 Europe/Istanbul — MUST-12 / SHOULD-07 (deep web JS & demo sync verification)

- Human: Eymen (ParongUs)
- Agent tool + model: Gemini (Antigravity)
- Role: tester-2
- Task id: MUST-12, SHOULD-07
- Files changed: POSSIBLE_BUGS.md, docs/testing/nasa-data-audit.md, docs/coordination/AGENT_LOG.md
- Why: Pulled `20fc36f` and ran deep verification: `node --check` passed on all 5 JS files in `web/`, `0` missing DOM IDs against `web/index.html`, verified `BUG-13` and `BUG-14` are fixed (`data/demo/` matches `data/processed/` 1:1 and `ortho-preview.png` is bundled), and verified `web/planner/planner.js` already guards `trek.nasa.gov` CTX/THEMIS tiles behind `if (!demoSafe)`. Narrowed `BUG-12` strictly to `web/index.html` CDN links (`unpkg.com` for `maplibre-gl` and `three.js`).
- Commit: this commit
- Next step: Frontend 1 (Dıvarcı) optionally vendors `maplibre-gl` and `three.js` locally (`BUG-12`); team locks `PRE-07` stops (`BUG-09`).

### 2026-11-14 15:34 Europe/Istanbul — SHOULD-07 (fix BUG-12 offline vendoring)

- Human: Eymen (ParongUs)
- Agent tool + model: Gemini (Antigravity)
- Role: tester-2 (requested offline fix in `web/`)
- Task id: SHOULD-07 (BUG-12)
- Files changed: web/vendor/maplibre-gl.css (new), web/vendor/maplibre-gl.js (new), web/vendor/three.module.js (new), web/index.html, POSSIBLE_BUGS.md, docs/testing/nasa-data-audit.md, docs/coordination/HANDOFFS.md, docs/coordination/AGENT_LOG.md
- Why: Vendored `maplibre-gl@4.7.1` and `three@0.170.0` (`2.18 MB` total) into `web/vendor/` and updated `web/index.html` to load them locally instead of `unpkg.com` CDN. Verified `web/index.html` now has 0 external URLs so `?demo=1` runs 100% offline.
- Commit: this commit
- Next step: Run live browser verification at `http://localhost:8000/web/?demo=1` with DevTools Offline mode enabled.

### 2026-11-14 15:59 Europe/Istanbul — MUST-09 follow-up (endless mirrored terrain)

- Human: Cagan
- Agent tool + model: Claude Code (Claude Opus 5.5)
- Role: backend implementer (edit in Divarci's web/ tree at Cagan's request)
- Task id: MUST-09 follow-up
- Files changed: web/hud/hud3d.js, docs/coordination/HANDOFFS.md, docs/coordination/AGENT_LOG.md
- Why: Cagan asked for the map to repeat with no visible border. A raw DEM tile does not tile (about 480 m of relief, with different north and south edges), so the HUD now surrounds the real tile with mirrored copies that share edges exactly, keeps the ring centred on the camera, and mirror-wraps height sampling for free-roam. The mirror maths was checked numerically (edge u = 1 from both sides). Page loads in ?demo=1 with no console errors; the edge crossing itself was not observed by the agent.
- Commit: this commit
- Next step: Divarci reviews; Eymen walks past the edge once.

### 2026-11-14 15:59 Europe/Istanbul — SHOULD-07 / MUST-12 (app launcher scripts)

- Human: Eymen (ParongUs)
- Agent tool + model: Gemini (Antigravity)
- Role: tester-2
- Task id: SHOULD-07, MUST-12
- Files changed: start.bat (new), scripts/start-app.sh (new), docs/coordination/AGENT_LOG.md
- Why: Added one-click/one-command local launcher scripts (`start.bat` for Windows, `scripts/start-app.sh` for bash/macOS/Linux) that start `http.server` on port 8000 and open `http://localhost:8000/web/?demo=1`. Also verified the live app in `?demo=1` mode via browser preview (2D MapLibre planner + 3D three.js helmet HUD + playback, 0 console errors).
- Commit: this commit
- Next step: Team can double-click `start.bat` to launch the demo locally.

### 2026-11-14 16:23 Europe/Istanbul — bodycam simulation and black UI (branch backend/simulation)

- Human: Cagan
- Agent tool + model: Claude Code (Claude Opus 5.5)
- Role: backend implementer (edits in Divarci's web/ tree at Cagan's request)
- Task id: MUST-09 / MUST-10 / SHOULD-05 follow-up
- Files changed: web/index.html, web/styles.css, web/app.js, web/hud/hud3d.js, web/hud/astronaut-rig.js (new), web/planner/planner.js, web/shared/data-loader.js, web/vendor/addons/** (new), web/assets/nasa-3d/** (new), pipeline/data/export_demo_fixtures.py, data/demo/texture-relief.jpg, data/demo/science-manifest.json, docs/coordination/HANDOFFS.md, docs/coordination/AGENT_LOG.md, docs/AI_USE.md
- Why: Cagan asked for a 1.80 m astronaut with a NASA model, photorealistic bodycam-style graphics and a completely new black UI with white text buttons. Used NASA 3D Resources (Mark III spacesuit; Z2 download did not finish). Added PBR lighting, an image-based sky light, shadows, sky, tone mapping and a camera lens pass; true ray tracing is not possible in real time in WebGL, and the UI and credits say so. Follow-up the same session: the NASA model has no skeleton, so a procedural rig was written (joint heights for a 1.80 m body, skin weights from vertex position, distance-driven walk / jog, arms lowered from the model's forward-reaching pose); helmet camera moved in front of the deep chest so the legs show when looking down; camera sway cut to millimetres; third-person camera removed; Mars gravity, jumping and slower jog (2.2 m/s) added. Checked in the browser with side and front renders of the rig and in the live view; no console errors. Cagan pasted a NASA API key in chat: it was not used (NASA 3D Resources need no key) and was not written to any file; Cagan was advised to rotate it.
- Commit: this commit
- Next step: Divarci reviews; push the branch and open a PR only when Cagan asks.

### 2026-11-14 16:49 Europe/Istanbul — shadows and Shift run (branch backend/simulation)

- Human: Cagan
- Agent tool + model: Claude Code (Claude Opus 5.5)
- Role: backend implementer (edits in Divarci's web/ tree at Cagan's request)
- Task id: MUST-09 follow-up
- Files changed: web/hud/hud3d.js, web/index.html, web/app.js, docs/coordination/AGENT_LOG.md
- Why: Cagan said shadows looked unrealistic and Shift did not run. Shadows: near sun shadows now use a 4096 px map over a 56 m box (about 1.4 cm per texel), snapped to texels so edges do not crawl, with lower sky/ambient fill so shade stays dark; far terrain shadows are baked at load by marching the height grid towards the sun over one mirror period (about 1.3 s, 5.5% of ground in terrain shadow at a 25 deg sun) and applied to the sun light only in the terrain shader. Shift: it did nothing in route playback, and in free-roam 2.2 m/s on slopes stayed below the run-pose threshold; now Shift is a light run (2.5 m/s) in both modes, WASD switches to free-roam, and the partner keeps pace. Checked in the browser, no console errors.
- Commit: this commit
- Next step: Divarci reviews web/; push when Cagan asks.

### 2026-11-14 16:48 Europe/Istanbul — MUST-12 (live browser test & HUD bugs BUG-15, BUG-16)

- Human: Eymen (ParongUs)
- Agent tool + model: Gemini (Antigravity)
- Role: tester-2
- Task id: MUST-12
- Files changed: POSSIBLE_BUGS.md, docs/coordination/AGENT_LOG.md
- Why: Ran live browser verification on `2860d7e` (`http://localhost:8000/web/?demo=1`, 0 console errors), checked `node --check` on all 6 non-vendor JS files, verified `0` missing DOM IDs, `data/demo/science-manifest.json` completeness (`texture-relief.jpg` included), and `web/assets/nasa-3d/SOURCE.md` citation. Found and logged 2 HUD logic bugs in `web/hud/hud3d.js`: `BUG-15` (`NEXT` stop shows nearest Euclidean stop instead of upcoming `route.legs` target) and `BUG-16` (3D HUD `remaining` distance `824.7 m` vs `route.json` `790.3 m` due to planar `lonToX`/`latToZ` scaling).
- Commit: this commit
- Next step: Frontend 1 / Cagan fix `BUG-15` and `BUG-16` in `web/hud/hud3d.js`; team locks `PRE-07` (`BUG-09`).

### 2026-11-14 17:09 Europe/Istanbul — elbow joints and suited arm pose

- Human: Cagan
- Agent tool + model: Claude Code (Claude Opus 5.5)
- Role: backend implementer (edit in web/hud at Cagan's request)
- Task id: MUST-09 follow-up
- Files changed: web/hud/astronaut-rig.js, docs/coordination/AGENT_LOG.md
- Why: Cagan said the arms looked odd. The NASA model's arms reach forward with bent elbows; rotating each whole arm from the shoulder pushed the elbows out and stretched the shoulder. Added elbow bones (elbow and hand measured from the mesh), a wider shoulder blend, and a suited rest pose (upper arm slightly forward and out, elbow bent, hands in front of the hips) with opposite-phase swing. Checked with front, back, side and walking renders and in first person (both gloves and boots visible when looking down).
- Commit: this commit
- Next step: none for the arms.

### 2026-11-14 16:53 Europe/Istanbul — Fix BUG-15 & BUG-16 in 3D HUD stop/distance tracking
- Human: Doruk
- Agent tool + model: Gemini (Antigravity)
- Role: coordinator/implementer (`main`)
- Task id: BUG-15, BUG-16
- Files changed: web/shared/route-bridge.js, web/hud/hud3d.js, web/tests/route-bridge.test.mjs, POSSIBLE_BUGS.md, docs/coordination/AGENT_LOG.md
- Why: Fixed `BUG-15` (3D HUD `NEXT` stop showed nearest Euclidean stop instead of upcoming stop along `route.legs`) and `BUG-16` (3D HUD `totalDist`/`remaining` disagreed with `route.json` `totals.distance_m` `790.3 m`). Added `resolveNextStopAlongRoute()` in `web/shared/route-bridge.js` using `legs[].to` / `to_stop_id` and cumulative `distance_m` with `marsDistanceM` fallback, scaled `alongM` onto `geomTotalDist` in `web/hud/hud3d.js`, added `web/tests/route-bridge.test.mjs`, and marked `BUG-15` and `BUG-16` fixed in `POSSIBLE_BUGS.md`.
- Commit: this commit
- Next step: Reload `http://127.0.0.1:8765/web/?demo=1` in browser to verify `NEXT` stop and `790.3 m` readout.

### 2026-11-14 16:54 Europe/Istanbul — MUST-09 / MUST-12 (solid partner astronaut collision)

- Human: Eymen (ParongUs)
- Agent tool + model: Gemini (Antigravity)
- Role: tester-2
- Task id: MUST-09 / MUST-12
- Files changed: web/hud/hud3d.js, docs/coordination/HANDOFFS.md, docs/coordination/AGENT_LOG.md
- Why: Eymen reported that free-roaming into the partner astronaut or turning back onto the route caused the player to clip inside the partner model. Added `PARTNER_COLLISION_R = 1.05` solid horizontal cylinder collision in `freeRoam` and an overlap guard on `partnerS` vs `alongM` in route mode in `web/hud/hud3d.js`, passed `node --check web/hud/hud3d.js`, and logged the cross-folder patch in `HANDOFFS.md`.
- Commit: this commit
- Next step: Divarci / Cagan review `web/hud/hud3d.js` collision patch; Eymen re-tests free-roam and route return collision in browser.
### 2026-11-14 16:36 Europe/Istanbul — High-resolution Mars map & terrain visor replacement (`MAP-01`)
- **Agent:** Gemini (Antigravity) acting for human teammate **Doruk** (`B2`, coordinator/branch override on `orchestrator/map-replacement`)
- **Role / branch:** `orchestrator/map-replacement` (from `main` `a6a14e8`)
- **Files:** `web/map/Geodesy.js`, `web/map/MarsDemSampler.js`, `web/map/IMapAdapter.js`, `web/map/LegacyMapAdapter.js`, `web/map/Fallback2DMap.js`, `web/map/TileSourceRegistry.js`, `web/map/TerrainMeshBuilder.js`, `web/map/terrain.worker.js`, `web/map/TerrainWorkerPool.js`, `web/map/MarsTerrainShader.js`, `web/map/HighResMarsTerrainEngine.js`, `web/map/MapLibreMarsAdapter.js`, `web/vendor/*`, `web/index.html`, `web/styles.css`, `web/app.js`, `web/planner/planner.js`, `web/hud/hud3d.js`, `web/shared/data-loader.js`, `web/shared/route-bridge.js`, `web/tests/geodesy.test.mjs`, `web/tests/fallback.test.mjs`, `docs/coordination/BOARD.md`, `docs/coordination/AGENT_LOG.md`
- **Summary:** Implemented unified `IMapAdapter` + Strangler-Fig `LegacyMapAdapter` (`?legacyMap=1`), Mars geodesy (`3,389.5 km` mean / `3,396.19 km` equatorial, planetocentric ECEF <-> RTC, antimeridian unwrapping, Terrarium & HiRISE 16-bit codecs), multi-tier `TileSourceRegistry` (LRU byte cache, singleflight coalescing, per-provider circuit breaker, hard `?demo=1` network block), off-main-thread `TerrainWorkerPool` (1-px border-clamped analytical normal maps, skirted CDLOD quadtree meshes, `AbortSignal`), custom Martian PBR strata/regolith shader + sky dome, MapLibre `mars-eq://` + `mars-dem://` 2.5D Terrarium hillshade/terrain, unified collision-free astronaut visor UI, and local `web/vendor/` bundling (`BUG-12` + `BUG-14` fixed). Verified 13/13 tests pass (`node --test web/tests/*.test.mjs`) and initial browser verification passed with 0 console/page errors and 0 external requests in `?demo=1` (second pass halted on user browser takeover).
- **Commit:** this commit

### 2026-11-14 16:45 Europe/Istanbul — Offline Martian PBR textures, logdepthbuf shader chunks, and 2D/3D polish (`MAP-01`)
- Human: Doruk
- Agent tool + model: Gemini (Antigravity)
- Role: coordinator/implementer (`orchestrator/map-replacement`)
- Task id: MAP-01
- Files changed: web/map/MarsPbrTextures.js, web/map/MarsTerrainShader.js, web/map/HighResMarsTerrainEngine.js, web/map/MapLibreMarsAdapter.js, web/hud/hud3d.js, web/tests/fallback.test.mjs, docs/coordination/AGENT_LOG.md
- Why: Fixed flat/missing 3D ground textures (especially offline in `?demo=1`), depth-buffer occlusion mismatch, and 2D CTX priority. Added zero-network `256×256` procedural Martian PBR albedo + normal synthesis (`MarsPbrTextures.js` with integer hashing and wind ripples, basalt gravel, Voronoi mudstone slabs, sulfate veins, and crevice AO), `#include <common>` + `#include <logdepthbuf_*>` vertex/fragment chunks in terrain & sky shaders, `520`-instance `InstancedMesh` boulder field, `_slopeTex` isolation from `Mars PBR` mode `0`, tilted default gaze (`-0.14 rad`), `0.09 m` AR route tube, NASA `mars-eq://trek-ctx/{z}/{x}/{y}` priority in `MapLibreMarsAdapter`, `0.36` slope overlay opacity, and regression unit tests in `web/tests/fallback.test.mjs`.
- Commit: this commit
- Next step: User reloads `http://127.0.0.1:8765/web/` and `?demo=1` in browser tab (`Ctl+Shift+R`) to visually confirm textures, boulders, and 2D hillshade/contours.

### 2026-11-14 17:06 Europe/Istanbul — Merge `main` (415e3b9: NASA Mark III suit, physics, shadows, BUG-15/16) into `orchestrator/map-replacement`
- Human: Doruk
- Agent tool + model: Gemini (Antigravity)
- Role: coordinator/implementer (`orchestrator/map-replacement`)
- Task id: MAP-01, BUG-15, BUG-16
- Files changed: web/app.js, web/index.html, web/styles.css, web/planner/planner.js, web/hud/hud3d.js, web/shared/data-loader.js, web/shared/route-bridge.js, web/map/MapLibreMarsAdapter.js, web/map/Fallback2DMap.js, web/map/HighResMarsTerrainEngine.js, web/tests/fallback.test.mjs, web/tests/route-bridge.test.mjs, docs/coordination/AGENT_LOG.md (plus merged `main` files)
- Why: Merged `main` (`415e3b9`) into `orchestrator/map-replacement` combining `main`'s NASA Mark III rigged spacesuit, buddy EVA, Mars gravity/jump/Shift run, endless mirrored terrain + sun mask shadows, start menu (EN/TR), black UI, and `BUG-15`/`BUG-16` fixes with the map-branch's `MapLibreMarsAdapter` (`mars-eq://` Trek WMTS + `mars-dem://` HiRISE hillshade/3D tilt + click elevation/slope probe + offline demo shaded relief) and `MarsPbrTextures` close-range wind-rippled dust / fractured mudstone shader detail on the 3D terrain. Also enabled bundled `data/demo/ortho-preview.png` in `?demo=1` while keeping `demoSafe` 0-network isolation, unified `classifySlope()` `id`/`level` fields, and verified zero missing DOM IDs and 16/16 passing tests.
- Commit: this commit
- Next step: Visually verify `http://127.0.0.1:8765/web/` and `?demo=1` in browser tab (`Ctrl+Shift+R`), then decide whether to open a PR to `main`.

### 2026-11-14 17:22 Europe/Istanbul — free-roam only, single astronaut, contact shadows

- Human: Cagan
- Agent tool + model: Claude Code (Claude Opus 5.5)
- Role: backend implementer (edits in web/ at Cagan's request)
- Task id: MUST-09 follow-up
- Files changed: web/hud/hud3d.js, web/hud/astronaut-rig.js, web/index.html, docs/coordination/AGENT_LOG.md
- Why: Cagan asked for shadows under the feet, then to remove route walking and the per-pixel ray tracing that was tried in between (not committed). Now: you always walk yourself (WASD, Shift run, Space jump) starting at the route start; Play, scrubber, speed and free-roam buttons are gone; the white route line stays as a guide; HUD progress uses the nearest route point within 80 m of the last progress (the route is a loop, so a global nearest search matched the end). The second astronaut (buddy) was then removed at Cagan's request; you are the only astronaut (HUD says CREW: 1). Each boot has a soft contact shadow on the local slope that fades as the foot lifts. Far terrain shadows stay the earlier CPU bake. Checked in the browser: no console errors, HUD starts at 0.0 m / 790.3 m / O2 100%.
- Commit: this commit
- Next step: push when Cagan asks.

### 2026-11-14 17:25 Europe/Istanbul — MAP-01 / MUST-09 / MUST-10: map bug fixes, default 3D planner, map click/dblclick teleport & sky Phobos/Deimos
- Human: Eymen (ParongUs)
- Agent tool + model: Gemini (Antigravity)
- Role: tester-2
- Task id: MAP-01, MUST-09, MUST-10
- Files changed: web/index.html, web/styles.css, web/shared/route-bridge.js, web/map/TileSourceRegistry.js, web/map/MapLibreMarsAdapter.js, web/map/Fallback2DMap.js, web/planner/planner.js, web/hud/hud3d.js, docs/coordination/HANDOFFS.md, docs/coordination/AGENT_LOG.md
- Why: Fixed THEMIS template substitution (`{Style}`, `{TileMatrixSet}`, `.0.0//`) and added offline `?demo=1` Gale sample pyramid step-down (`z=8/6/4`) in `TileSourceRegistry.js`; fixed `mars-eq://` scanline clamping, overlay transparent fallback, overlay layer z-order above `hirise-ortho`, separate `mars-terrain-dem` + LRU DEM tile cache, and enabled 3D terrain by default (`pitch: 52`, `#toggle-3d-map` checked, `NavigationControl`, `doubleClickZoom: false`) in `MapLibreMarsAdapter.js`, `Fallback2DMap.js`, `planner.js`, and `index.html`; fixed `alongM`/`along_m` mismatch and added `mm:teleport` bridge + map single-click `TELEPORT HERE` button & double-click instant teleport into 3D Bodycam `freeRoam` (with terrain grounding, partner astronaut collision guard, and `closestAlongM` sync); added Phobos, Deimos (daytime-sky limb shader, E/W orbital motion), and solar disc to `web/hud/hud3d.js` with raised pitch limit (`1.42` rad) and extended camera/sky far range. Verified `node --check` on all 19 `web/` JS files, 16/16 unit tests (`geodesy.test.mjs`, `fallback.test.mjs`, `route-bridge.test.mjs`), DOM ID consistency, and THEMIS step-down + teleport bridge runtime checks.
- Commit: this commit
- Next step: Hard-reload `http://localhost:8000/web/?demo=1` (`Ctrl+Shift+R`) in browser to visually verify 3D planner, map click/dblclick teleport, THEMIS/MOLA overlays, and Phobos/Deimos in the 3D sky.

### 2026-11-14 17:31 Europe/Istanbul — hide the route line in the 3D view

- Human: Cagan
- Agent tool + model: Claude Code (Claude Opus 5.5)
- Role: backend implementer (edit in web/ at Cagan's request)
- Task id: MUST-09 follow-up
- Files changed: web/hud/hud3d.js, web/index.html, docs/coordination/AGENT_LOG.md
- Why: Cagan asked to remove the route. The white route line is no longer added to the 3D scene and the hint text no longer mentions it. The 2D planner route and route.json are unchanged, and the HUD still uses them for distance, next stop and O2.
- Commit: this commit
- Next step: none.

### 2026-11-14 17:34 Europe/Istanbul — side-step and backward walking animation

- Human: Cagan
- Agent tool + model: Claude Code (Claude Opus 5.5)
- Role: backend implementer (edit in web/hud at Cagan's request)
- Task id: MUST-09 follow-up
- Files changed: web/hud/astronaut-rig.js, web/hud/hud3d.js, docs/coordination/AGENT_LOG.md
- Why: Cagan said the astronaut looked like it walked forward while strafing. hud3d.js now passes the walking direction in the body frame to the rig; the fore-aft leg swing scales with the forward part (reversed when walking backwards), and the sideways part drives a side-step (leading leg reaches out, trailing leg closes, feet do not cross, soles kept flat, pelvis leans into the step, arm swing reduced). Checked with front-view renders of a right and a left side-step.
- Commit: this commit
- Next step: none.

### 2026-11-14 17:39 Europe/Istanbul — 3D view performance

- Human: Cagan
- Agent tool + model: Claude Code (Claude Opus 5.5)
- Role: backend implementer (edit in web/hud at Cagan's request)
- Task id: MUST-09 follow-up
- Files changed: web/hud/hud3d.js, docs/coordination/AGENT_LOG.md
- Why: Cagan reported stutter. Cut per-frame work: pixel ratio capped at 1.25 (was 2), MSAA 4 -> 2 samples, shadow map 4096 -> 2048 px over a 40 m box with PCF instead of PCF-soft, terrain no longer drawn into the shadow map (terrain shadows come from the baked sun mask), mirrored copies at a quarter of the vertex density, HUD text updated 10 times a second, and adaptive render resolution (scene scale drops to 0.55 when frames average over 24 ms and recovers under 15 ms). In the in-app browser the frame rate is capped by vsync (median 13.9 ms before and after), so the gain could not be measured there; no console errors and shadows still render.
- Commit: this commit
- Next step: Cagan checks the frame rate on his machine.

### 2026-11-14 17:38 Europe/Istanbul — MAP-01 / MUST-09 follow-up: MOLA offline ramp, PNG fallback buffer, buffered teleport, Stickney orientation & unit tests
- Human: Eymen (ParongUs)
- Agent tool + model: Antigravity (Gemini)
- Role: tester-2
- Task id: MAP-01, MUST-09
- Files changed: `web/hud/hud3d.js`, `web/map/Fallback2DMap.js`, `web/map/MapLibreMarsAdapter.js`, `web/map/TileSourceRegistry.js`, `web/planner/planner.js`, `web/shared/route-bridge.js`, `web/tests/fallback.test.mjs`, `web/tests/route-bridge.test.mjs`, `docs/coordination/HANDOFFS.md`, `docs/coordination/AGENT_LOG.md`
- Why: Polished map protocol & fallback edge cases on top of `612223b` (keeping Cagan's single-astronaut free-roam HUD & boot contact shadows intact): replaced empty `ArrayBuffer(0)` returns with a valid 1x1 transparent PNG in `MapLibreMarsAdapter.js`, added offline hypsometric `renderMolaColorTileRgba()` for `mola-color`, wired `strict-15` and `unmount()` cleanup in `Fallback2DMap.js`, added pre-selection hover probe in `planner.js`, buffered `dispatchTeleport`/`onTeleport` in `route-bridge.js` for startup calls before `hud3d.js` finishes init, pointed Stickney crater (`+Z`) and `phobos`/`deimos.lookAt(camera.position)` toward the camera in `hud3d.js`, accepted `alongM ?? along_m` in `onSetRoute`, and added unit tests in `web/tests/route-bridge.test.mjs` and `web/tests/fallback.test.mjs`. Verified `node --check` on 22 JS/MJS files and 18/18 Node unit tests.
- Commit: this commit
- Next step: Hard-reload `http://localhost:8000/web/?demo=1` (`Ctrl+Shift+R`) to visually inspect MOLA offline color, double-click teleport, and Phobos/Deimos in browser.

### 2026-11-14 17:48 Europe/Istanbul — fix black 2D map in 3D-terrain mode; one Planner button

- Human: Cagan
- Agent tool + model: Claude Code (Claude Opus 5.5)
- Role: backend implementer (edits in web/ at Cagan's request)
- Task id: MAP-01 follow-up
- Files changed: web/map/MarsDemSampler.js, web/map/MapLibreMarsAdapter.js, web/index.html, docs/coordination/AGENT_LOG.md
- Why: Cagan reported the 2D map was buggy with two Planner buttons. The planner opens in MapLibre 3D terrain mode by default, and the whole map rendered black: the DEM tiles carried true Mars heights (about -3.6 km), which MapLibre's terrain camera/depth setup does not handle. The mars-dem:// tiles now encode heights above the local minimum (minElevM - 20 m); relief and hillshade are unchanged and UI elevations still come from the sampler. Removed the 3D HUD's own Planner button (the top bar one remains). Checked in the browser: map renders in 3D-terrain mode, no console errors; web tests pass.
- Commit: this commit
- Next step: push when Cagan asks.

### 2026-11-14 17:27 Europe/Istanbul — Add dual-transport EVA multiplayer support (BroadcastChannel + LAN WebSocket)
- Human: Doruk
- Agent tool + model: Gemini (Antigravity)
- Role: coordinator/implementer (`main`)
- Task id: STRETCH-MP
- Files changed: scripts/mp-hub.mjs, scripts/server.mjs, scripts/start-app.sh, start.bat, web/shared/multiplayer.js, web/app.js, web/hud/hud3d.js, web/planner/planner.js, web/index.html, web/styles.css, web/tests/multiplayer.test.mjs, docs/coordination/AGENT_LOG.md
- Why: Added zero-dependency multiplayer EVA support across both 2D Mission Control Planner and 3D Bodycam views. Added `scripts/mp-hub.mjs` + `scripts/server.mjs` (pure Node RFC 6455 WebSocket room relay `/ws?room=<code>`, `/api/mp/status` LAN URL discovery, static file serving), updated `scripts/start-app.sh` and `start.bat` to prefer `node scripts/server.mjs` with Python fallback, built dual-transport `web/shared/multiplayer.js` (`BroadcastChannel` always active offline including in `?demo=1` with 0 network calls, plus LAN WebSocket with sequence deduplication), rendered live animated rigged NASA Mark III crewmate avatars with callsign badges, backpack LEDs, solid collision, shared terrain beacon pillars (`P` key / Pin button), Crew/Comms drawer, EVA radio chat, `Go To` crewmate teleport, and live 2D `eva-crew`/`eva-pings` layers. Verified DOM ID audit (0 missing) and 20/20 unit tests (`node --test web/tests/*.test.mjs`).
- Commit: this commit
- Next step: Test two tabs (e.g. Planner + Bodycam or two Bodycam windows) at `http://localhost:8765/web/` or `?room=GALE-01`, and push `main` when ready.

### 2026-11-14 17:39 Europe/Istanbul — Vercel static production config

- Human: Doruk
- Agent tool + model: Grok 4.7 (Cursor)
- Role: docs
- Task id: n/a
- Files changed: vercel.json, .vercelignore, .gitignore, docs/coordination/AGENT_LOG.md
- Why: Published the static Marswalk app to Vercel production (`martian-mappers`). Root redirects to `/web/`. The deploy ignore list leaves out team profiles, coordination notes, pipeline code, secrets, and the relief STL. `.vercel/` stays untracked so link metadata and pulled env files are not committed.
- Commit: this commit
- Next step: Turn off Vercel Authentication if judges should open https://martian-mappers.vercel.app without a Vercel login. Cross-device crew still needs the local server.

### 2026-11-14 17:45 Europe/Istanbul — Merge origin/main into local main

- Human: Doruk
- Agent tool + model: Grok 4.7 (Cursor)
- Role: docs
- Task id: n/a
- Files changed: web/hud/hud3d.js, web/index.html, web/planner/planner.js, web/styles.css, docs/coordination/AGENT_LOG.md
- Why: Local main had the multiplayer commit and the Vercel config; origin/main had the single-astronaut HUD, map teleport, and performance work. Kept both: crew pins, radio, and remote avatars, plus teleport, contact shadows, and CREW: 1 with no AI buddy. `node --check` and 22/22 web tests passed.
- Commit: this commit
- Next step: Push main.

### 2026-11-14 17:52 Europe/Istanbul — terrain seam cracks

- Human: Cagan
- Agent tool + model: Claude Code (Claude Opus 5.5)
- Role: backend implementer (edit in web/hud at Cagan's request)
- Task id: MUST-09 follow-up
- Files changed: web/hud/hud3d.js, docs/coordination/AGENT_LOG.md
- Why: Cagan saw a pale band where the terrain repeats (screenshot at about 4.8169 S, 137.4064 E, the tile's south-east corner). Since the performance change the mirrored copies use a quarter of the real tile's vertex density, so their shared edges no longer line up and thin cracks show the sky. Every terrain tile now has a 40 m skirt hanging from its edges (edge texture, both windings), which closes the cracks without changing the visible surface or the copies' low cost. Teleported near the east edge and looked around: no band seen; the exact corner was not re-checked because Cagan was using the same tab.
- Commit: this commit
- Next step: Cagan checks the corner; push when asked.

### 2026-11-14 18:00 Europe/Istanbul — Taller start marker, M-key 3D Martian elevation map with click-to-teleport confirmation, and opposite-edge map wrap

- Human: Cinar
- Agent tool + model: Gemini (Antigravity)
- Role: frontend implementer (`main`)
- Task id: MUST-09 / MUST-10 follow-up
- Files changed: web/hud/hud3d.js, web/index.html, web/styles.css, docs/coordination/AGENT_LOG.md
- Why: Raised the start/habitat marker pole height from 2.4 m to 4.6 m with a glowing cap lamp; added a tactical 3D Mars elevation map modal (`M` key / `Map (M)` button) rendered 1:1 from `elevGrid` with Martian hypsometric ramp, `sunDir` hillshade, `sunMask` shadows, 20 m / 60 m contours, optional Slope Hazard overlay, click confirmation prompt ("Buraya ışınlanmak istiyor musun?" / "Do you want to teleport here?") showing lat/lon, MOLA elevation, slope, and distance, and exact `sampleElevSceneY` + `justTeleportedOrWrapped` ground snapping on teleport; added toroidal opposite-edge boundary wrapping (`wrapSceneCoord`) with HUD wrap notification toast when walking past any edge of the 3D terrain. Preserved `P` beacon, multiplayer drawer styles, and single Planner button on merge with `origin/main` (`e18cac2`). Verified `node --check`, DOM ID consistency, and all `web/tests/*.mjs` tests.
- Commit: this commit
- Next step: none.

### 2026-11-14 18:43 Europe/Istanbul — MAP-01 / MUST-09 / MUST-12 (Planner border artifact fix + subtle Dev Settings menu)

- Human: Eymen (ParongUs)
- Agent tool + model: Antigravity (Gemini)
- Role: tester-2
- Task id: MAP-01, MUST-09, MUST-12
- Files changed: `web/shared/dev-settings.js`, `web/map/MarsDemSampler.js`, `web/map/MapLibreMarsAdapter.js`, `web/planner/planner.js`, `web/hud/hud3d.js`, `web/app.js`, `web/index.html`, `web/styles.css`, `web/tests/fallback.test.mjs`, `docs/coordination/HANDOFFS.md`, `docs/coordination/AGENT_LOG.md`
- Why: Eymen reported extruded N/S/E/W border cross-lines and tile cutoffs around the HiRISE box on the Planner map, and asked for a low-profile theme-matched Developer Settings button in the menu with frame effect, speed, and experimental super graphics toggles. Added a `smoothstep` 0.0085° outer DEM taper toward `borderMeanElevM` in `MarsDemSampler.js`, `Promise.allSettled` + procedural regional dust context + toned CTX + `minZoom: 11.2` in `MapLibreMarsAdapter.js`, `zoom: 14.7` + dashed HiRISE corridor + zoom-scaled markers + `[ FIT EVA ]` in `planner.js`, and a persistent `dev-settings.js` modal (`#btn-dev-settings` in `.start-foot`) wired live to `hud3d.js` (bodycam frame/lens toggle & strength, speed multiplier, 4096px soft-shadow/4x MSAA/1.25x supersampled Experimental Super Graphics, FOV, clean HUD). Verified live in browser (`0` console/WebGL errors on `?demo=1`), syntax check (`27` files), and `24/24` Node unit tests.
- Commit: this commit
- Next step: Divarci / Doruk / Cagan review cross-folder `web/` changes; Eymen tests via live server on port 8000 (`Ctrl+Shift+R`).
