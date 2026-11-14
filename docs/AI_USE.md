# AI / SI-tool use log

NASA Space Apps submissions must describe how "SI tools" (AI tools) were used. See the [Official FAQ](https://www.spaceappschallenge.org/resources/participant-faqs/), `skills/ai-use-log/SKILL.md`, and the [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/). A later 13 November `curl -k` reading of that guide is provisionally official (official pages read 13 Nov with an unverified certificate via curl -k; confirm with a cert-valid fetch on 14 Nov 08:00): **disclosure is required**; AI/SI tools must **not** be used to come up with the challenge idea; the SI form answer is **not shown to judges** (judges can still see watermarks, descriptive text, or metadata in the project). Confirm with a cert-valid fetch on 14 November 08:00.

Add a row the same day you use a tool. Do not put secrets, API keys, or personal data in this file.

| Date | Tool | What it was used for | What was kept / changed |
|---|---|---|---|
| 2026-11-12 | Grok Bot (Cursor agent) | Created this private repo's documentation and scaffolding only (AGENTS.md, CLAUDE.md, Cursor rules, skills, README, .gitignore, .env.example, this log). No application code. Content was based on the team's 11 November 2026 planning note. | Kept as the initial commit after drafting. Facts and links were taken from that note; items the note marked unverified (Resources tab, judging guide, and other 11 November gaps) stay marked **UNVERIFIED**. The team should correct anything that does not match official pages. |
| 2026-11-12 | Grok Bot (Cursor agent) | Wrote the 48-hour roadmap, six role sheets with agent prompts, GitHub beginner workflow, interface-contract example JSON, hud-3d skill, and updates to AGENTS.md / CLAUDE.md / README.md / Cursor rules / existing skills so they match the 12 November 2026 decisions (Gale / Mount Sharp lake-sediment goal, boxwork as a bonus stop, 3D HUD fed by a MapLibre planner, six-person roles, MUST/SHOULD/STRETCH timing). Docs and sample JSON only — no application code. | Kept as a docs-only commit on main. New science-goal and format text follows Doruk's decisions; exact outcrop coordinates are labelled as examples / still to be locked. Resources tab, judging guide, and other 11 November gaps stay **UNVERIFIED**. Suit O₂ and walk time are documented as placeholders. The team should correct anything that does not match official pages. |
| 2026-11-12 | Grok Bot (Cursor agent) | Coordination docs pass: GEMINI.md; board, handoffs, agent log, standup, Grok/DeepSeek loading note; onboarding interview and profile template; decision record; judging checklist (UNVERIFIED until 13 Nov); demo-safe spec; contract change log; log-entry helper and commit template. Updated AGENTS.md, CLAUDE.md, README, ROADMAP, workflow, role sheets, and Cursor rules. Docs and config only — no application code. | Kept as a docs/config commit on main. AGENTS.md remains the single source of truth. Judging categories and some Grok/DeepSeek UI steps stay **UNVERIFIED**. Profiles forbid personal data because team members are minors. |
| 2026-11-14 | Gemini (Gemini 3.8 Flash) | Onboarding interview with Asil (Tester 1); created docs/team/profiles/asil.md, updated ROSTER.md and BOARD.md. | Kept as drafted based directly on Asil's interview responses. |

## How to add an entry

Copy this row shape:

```
| YYYY-MM-DD | Tool name | Short description of the task | Kept as-is / edited (what changed) / rejected |
```
