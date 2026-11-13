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
