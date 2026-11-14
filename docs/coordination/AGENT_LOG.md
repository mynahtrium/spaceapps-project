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

### 2026-11-14 11:30 Europe/Istanbul — PRE-02

- Human: CC
- Agent tool + model: Antigravity (Gemini 4 Hydrogen Medium)
- Role: backend-3
- Task id: PRE-02
- Files changed: docs/team/profiles/cc.md, docs/comms/intro-backend-3.md, docs/coordination/AGENT_LOG.md
- Why: Completed first-session onboarding interview for CC (Backend 3 — data) and filled Human in docs/comms/intro-backend-3.md; pushed directly to main as requested.
- Commit: this commit
- Next step: Check local environment (.env / NASA_API_KEY / Python), claim MUST-07 on BOARD.md, and start background data caches (REMS, RAD, waypoints, DONKI, MSL raw images).

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
