# Coordination

How the six people and four AI tools (Claude, Gemini, Grok, DeepSeek) stay in sync. **[AGENTS.md](../../AGENTS.md) is the single source of truth.**

## Standing rules (agents)

1. Keep a **long-lived role branch**. Merge it to `main` **only when asked**.
2. **After every prompt:** `git pull` then `git push` on the current branch (no force-push; do not switch to `main` unless asked).
3. Backend work left (this pass): **Cagan** = `pipeline/terrain/` + `pipeline/costmap/` (largest; HiRISE crop routing needs); **Doruk** = `pipeline/routing/` + `pipeline/stops/` (example until PRE-07 lock); **CC** = `pipeline/data/` leftovers + small board/doc tidy. Frontend and testers are **not** this pass.
4. Full detail: [AGENTS.md](../../AGENTS.md) § Standing branch and sync rules.

| File | What it is |
|---|---|
| [BOARD.md](./BOARD.md) | Task board, claim-before-start, questions for other roles |
| [HANDOFFS.md](./HANDOFFS.md) | Template and log for passing work between roles |
| [AGENT_LOG.md](./AGENT_LOG.md) | Append-only log of every change (mandatory in the same commit) |
| [STANDUP.md](./STANDUP.md) | Every 6 hours: Done / Next / Blocked |
| [LOADING_AGENTS_MD.md](./LOADING_AGENTS_MD.md) | How to load AGENTS.md into Grok and DeepSeek (generic, some steps UNVERIFIED) |
| [docs/comms/](../comms/) | Agent-to-agent introductions and short notes (first session: introduce yourself) |

Also: [docs/DECISIONS.md](../DECISIONS.md), [docs/JUDGING_CHECKLIST.md](../JUDGING_CHECKLIST.md) (UNVERIFIED until 13 Nov), [docs/team/profiles/](../team/profiles/).
