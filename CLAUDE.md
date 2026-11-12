# CLAUDE.md

This is the Claude Code entry point for **nasathingamajig** (team Martian Mappers, NASA Space Apps 2026).

**Read [AGENTS.md](./AGENTS.md) and [ROADMAP.md](./ROADMAP.md) first** and follow them. AGENTS.md has data-layer links, design rules, and constraints. ROADMAP.md has the hour-by-hour plan, folder ownership, interface contracts, definitions of done, and fallbacks. Role sheets: [docs/roles/](./docs/roles/). Git: [docs/GITHUB_WORKFLOW.md](./docs/GITHUB_WORKFLOW.md). Example JSON: [docs/contracts/](./docs/contracts/). Skills: `skills/*/SKILL.md` (including `skills/hud-3d`). Cursor rules: `.cursor/rules/`.

## Locked decisions (12 November 2026)

- Site: **Gale / Mount Sharp**. Science goal: **ancient lake sediments and habitability / organics in mudstones**; **boxwork is a bonus stop**. Exact outcrops are locked against official sources (13 November Resources tab is **UNVERIFIED** until read) and must sit inside the checked HiRISE DTM footprint.
- Format: web app. 2D MapLibre planner **sends the route** to a **3D first-person** terrain view with a **helmet HUD**. Default 3D: three.js heightmap. WebXR is **stretch only**.
- Team: six people — Backend 1 terrain, Backend 2 routing, Backend 3 data, Frontend 1 planner+HUD, Testers 1 and 2. Edit only owned folders.

## Key rules

1. **Do not write application code or start the project data pipeline before 14 November 2026.** Docs, installs, practice PRs, and role decisions are fine. A local event post (seen as a snippet, not confirmed on the official page) says starting early can disqualify the team. Confirm in the Project Submission Guide (expected 13 November).
2. **No secrets.** Never commit `.env`, API keys, or credentials. The NASA API key is only `NASA_API_KEY` in the environment (see `.env.example` for the placeholder name).
3. **Log every AI / "SI tool" use** in [docs/AI_USE.md](./docs/AI_USE.md). The submission must describe how these tools were used.
4. **No photos, video, voices, or likenesses of under-18s** in the demo or submission.
5. **Cite data sources** and fetch dates. Do not invent facts; mark unchecked items **UNVERIFIED**. Suit O₂ and walk time are illustrative placeholders and must be labelled. Slope limits are lunar stand-ins. Do not invent a spatial radiation map of rocks.
6. Keep this repository **private**. Do not add hosting or deployment integrations. Do not force-push `main`.
7. After 14 November, prefer small derived products in `data/processed/`; keep raw downloads in gitignored `data/raw/`. Use a Mars radius for distances. Load `data/processed/` first, then fall back to `docs/contracts/`. A live API is optional.

When in doubt, follow AGENTS.md and ROADMAP.md, stay in the caller's owned folders, and ask before adding application code.
