# CLAUDE.md

This is the Claude Code entry point for **nasathingamajig** (team Martian Mappers, NASA Space Apps 2026).

**Read [AGENTS.md](./AGENTS.md) first** and follow it. That file has the project overview, data-layer links, stack, routing and radiation design, repo layout, conventions, how to run (planned from 14 November), and the full rules. Skill instructions are in `skills/*/SKILL.md`. Cursor rules are in `.cursor/rules/`.

## Key rules

1. **Do not write application code or start the project data pipeline before 14 November 2026.** Docs, installs, and role decisions are fine. A local event post (seen as a snippet, not confirmed on the official page) says starting early can disqualify the team. Confirm in the Project Submission Guide (expected 13 November).
2. **No secrets.** Never commit `.env`, API keys, or credentials. The NASA API key is only `NASA_API_KEY` in the environment (see `.env.example` for the placeholder name).
3. **Log every AI / "SI tool" use** in [docs/AI_USE.md](./docs/AI_USE.md). The submission must describe how these tools were used.
4. **No photos, video, voices, or likenesses of under-18s** in the demo or submission.
5. **Cite data sources** and fetch dates. Do not invent facts; mark unchecked items **UNVERIFIED**. The official Resources tab and judging guide arrive 13 November (**UNVERIFIED** until then).
6. Keep this repository **private**. Do not add hosting or deployment integrations.
7. After 14 November, prefer small derived products in `data/processed/`; keep raw downloads in gitignored `data/raw/`. Use a Mars radius for distances.

When in doubt, follow AGENTS.md and ask before adding application code.
