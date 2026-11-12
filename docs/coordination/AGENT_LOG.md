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
