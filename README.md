# nasathingamajig — Martian Mappers

Private repo for team **Martian Mappers** at [NASA Space Apps Challenge 2026](https://www.spaceappschallenge.org/) (hackathon 14–15 November 2026).

We are building a Gale crater / Mount Sharp **Marswalk** for the official challenge [Interplanetary Survival Guide: Martian Map](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/).

**Decisions (12 November 2026):** the primary science goal is **ancient lake sediments and habitability / biosignature potential (organics in mudstones)**. The boxwork unit on lower Mount Sharp is a **bonus stop**. The product is a **web app**: a **3D first-person terrain view** with a **helmet HUD** (three.js) that follows the pipeline's route, plus an Orbit view for picking a landing site. The 2D MapLibre planner from the first plan was replaced by the Orbit view and removed. VR / WebXR is stretch only.

## Where to start

| If you are… | Read this |
|---|---|
| Anyone on the team | This README, then **[docs/GITHUB_WORKFLOW.md](./docs/GITHUB_WORKFLOW.md)** |
| Wiring data between parts | **[docs/contracts/](./docs/contracts/)** (example JSON shapes) |
| An AI coding agent | **[AGENTS.md](./AGENTS.md)** (single source of truth). Short pointers: [CLAUDE.md](./CLAUDE.md), [GEMINI.md](./GEMINI.md) |
| Looking for past decisions | [docs/DECISIONS.md](./docs/DECISIONS.md) |

Submission is on the Team page's Project tab and closes Sunday 15 November 23:59 **local event time** ([2026 landing page](https://www.spaceappschallenge.org/2026/)). Under-18s must be registered by and accompanied by a parent or legal guardian ([official terms](https://www.spaceappschallenge.org/legal/), updated 7 August 2026).

## Product

- **Bodycam:** three.js first-person walk on HiRISE terrain with a helmet HUD (distance, slope, next stop), science stops with Curiosity POV images, DONKI space-weather alerts and REMS weather, Mars physics, and rovers. Graphics presets are under Settings; F3 shows frame statistics.
- **Orbit view:** Mars globe with real day/night and moons; click to land.
- **Pipeline:** Python and GDAL for the slope / hazard cost map, route, and cached science data.

## Layout

```
data/raw/                      # originals; gitignored
data/processed/terrain|routing|science
data/demo/                     # offline demo fixtures
pipeline/                      # Python preprocessing
web/                           # the app (hud, orbit, map, physics, shared, tests)
docs/contracts/  docs/testing/  docs/demo/
docs/GITHUB_WORKFLOW.md   docs/AI_USE.md   docs/AI_USE_LOG.md   docs/DECISIONS.md
```

## How to run

1. Install Node (or Python 3). For the pipeline: Python 3 and GDAL (with OpenJPEG for HiRISE JP2 orthos).
2. Copy `.env.example` to `.env` and set `NASA_API_KEY` (free key from [api.nasa.gov](https://api.nasa.gov/)). Never commit `.env`.
3. Run `scripts/start-app.sh` (or `node scripts/server.mjs`) and open `http://localhost:8000/web/`. Add `?demo=1` for offline demo-safe mode.
4. Tests: `node --test web/tests/*.test.mjs`.

## Rules

- No secrets in the repo. NASA API key only via `NASA_API_KEY`.
- Note AI use in [docs/AI_USE.md](./docs/AI_USE.md). The FAQ requires the submission to describe "SI tools". The older detailed agent log is in [docs/AI_USE_LOG.md](./docs/AI_USE_LOG.md).
- No photos, video, voices, or likenesses of under-18s in the demo or submission.
- Cite data sources. Do not invent facts; mark gaps **UNVERIFIED**.
- Keep this repository private. Do not connect Vercel or other hosting integrations.
- Never force-push `main`.

## Sources

See [docs/DATA_SOURCES.md](./docs/DATA_SOURCES.md) and the data table in [AGENTS.md](./AGENTS.md). This does not replace the official challenge page.
