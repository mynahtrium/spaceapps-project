# nasathingamajig — Martian Mappers

Private scaffolding repo for team **Martian Mappers** at [NASA Space Apps Challenge 2026](https://www.spaceappschallenge.org/) (hackathon 14–15 November 2026).

We are planning a Gale crater / Mount Sharp **Marswalk** for the official challenge [Interplanetary Survival Guide: Martian Map](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/).

**Decisions (12 November 2026):** the primary science goal is **ancient lake sediments and habitability / biosignature potential (organics in mudstones)**. The boxwork unit on lower Mount Sharp is a **bonus stop**. The product is a **web app**: a 2D [MapLibre](https://maplibre.org/maplibre-gl-js/docs/) planner **sends the route** to a **3D first-person terrain view** with a **helmet HUD** (three.js heightmap by default). VR / WebXR is stretch only. The team is six people (three backend, one frontend, two bug testers), new to GitHub and to map / 3D work, registered with a guardian.

This repository is still **documentation and scaffolding only**. There is no application code yet. **Do not start the build before 14 November 2026.**

## Where to start

| If you are… | Read this |
|---|---|
| Anyone on the team | This README, then **[ROADMAP.md](./ROADMAP.md)** and **[docs/GITHUB_WORKFLOW.md](./docs/GITHUB_WORKFLOW.md)** |
| Your assigned role | **[docs/roles/](./docs/roles/)** (one sheet each, including a ready-to-paste AI prompt) |
| Wiring data between people | **[docs/contracts/](./docs/contracts/)** (example JSON; sample data, not computed products) |
| An AI coding agent | **[AGENTS.md](./AGENTS.md)** (single source of truth). Short pointers: [CLAUDE.md](./CLAUDE.md), [GEMINI.md](./GEMINI.md). Grok / DeepSeek: [docs/coordination/LOADING_AGENTS_MD.md](./docs/coordination/LOADING_AGENTS_MD.md) |
| Coordinating the six people | [BOARD.md](./docs/coordination/BOARD.md), [HANDOFFS.md](./docs/coordination/HANDOFFS.md), [AGENT_LOG.md](./docs/coordination/AGENT_LOG.md), [STANDUP.md](./docs/coordination/STANDUP.md), [docs/DECISIONS.md](./docs/DECISIONS.md) |

Add your GitHub username in a practice PR on [docs/team/ROSTER.md](./docs/team/ROSTER.md) before 14 November. First agent session: onboarding interview into [docs/team/profiles/](./docs/team/profiles/) (first name or nickname only; no personal data).

## Do not start the build before 14 November 2026

A local event's challenge post (seen as a search snippet, not confirmed on the official page) says starting the build early can lead to disqualification. That rule remains **UNVERIFIED**. Reading, installing tools, choosing roles, locking stops on paper / HiView, and a practice pull request are fine.

A 13 November 2026 re-check could not read the official [Resources tab](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/) or judging guide (certificate error / HTTP 500); treat them as **UNVERIFIED**. Confirmed from official pages that did load: project submission is on the Team page's Project tab and opens Saturday 14 November 09:00 and closes Sunday 15 November 23:59 **local event time** ([2026 landing page](https://www.spaceappschallenge.org/2026/)); under-18s must be registered by and accompanied by a parent or legal guardian, and participants must register before the event starts ([official terms](https://www.spaceappschallenge.org/legal/), updated 7 August 2026). See [ROADMAP.md](./ROADMAP.md).

## Planned product

- **Backend 1:** Python and GDAL — slope / hazard cost map and a small height preview.
- **Backend 2:** A\* / Dijkstra route between locked stops, plus HUD telemetry. Static JSON is required; a live API is optional.
- **Backend 3:** REMS weather, RAD dose budget, DONKI alerts, THEMIS / CRISM layers, Curiosity POV stills (cached).
- **Frontend 1:** MapLibre planner + 3D helmet HUD (distance, slope, next stop, placeholder suit O₂).
- **Testers:** test plans, merge reviews, AI-use log, demo / video / slides.

Full 48-hour timing (MUST 0–16, SHOULD 16–32, STRETCH 32–40, freeze and submit 40–48): **[ROADMAP.md](./ROADMAP.md)**. Design rules and data-layer links: **[AGENTS.md](./AGENTS.md)**.

## Planned layout

```
data/raw/                      # originals; gitignored
data/processed/terrain|routing|science
pipeline/terrain|routing|data  # no code until 14 Nov
web/planner|hud|shared         # no code until 14 Nov
docs/contracts/  docs/roles/  docs/testing/  docs/demo/
docs/coordination/   docs/team/profiles/   data/demo/
ROADMAP.md   docs/GITHUB_WORKFLOW.md   docs/AI_USE.md   docs/DECISIONS.md
```

## How to run (planned, from 14 November)

Until 14 November there is nothing to run.

1. Install Python 3 and GDAL (with OpenJPEG for HiRISE JP2 orthos).
2. Copy `.env.example` to `.env` and set `NASA_API_KEY` (free key from [api.nasa.gov](https://api.nasa.gov/)). Never commit `.env`.
3. Download listed products into `data/raw/` (see `skills/data-fetching/SKILL.md`).
4. Run the forthcoming pipelines to write `data/processed/`.
5. Serve `web/` as static files. Load processed JSON first, then fall back to `docs/contracts/`. Cache tiles and DONKI responses for an offline demo.

## Rules

- No secrets in the repo. NASA API key only via `NASA_API_KEY`.
- Log all AI use in [docs/AI_USE.md](./docs/AI_USE.md). The FAQ requires the submission to describe "SI tools".
- No photos, video, voices, or likenesses of under-18s in the demo or submission.
- Cite data sources. Do not invent facts; mark gaps **UNVERIFIED**.
- Keep this repository private. Do not connect Vercel or other hosting integrations.
- Stay in your owned folders; testers review PRs; never force-push `main`.

## Sources

See the source list at the end of [AGENTS.md](./AGENTS.md). Planning content follows the team's 11 November 2026 internal note plus the 12 November decisions, and does not replace the official challenge page or the 13 November guides.
