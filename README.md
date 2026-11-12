# nasathingamajig — Martian Mappers

Private scaffolding repo for team **Martian Mappers** at [NASA Space Apps Challenge 2026](https://www.spaceappschallenge.org/) (hackathon 14–15 November 2026).

We are planning a Gale crater / Mount Sharp **boxwork Marswalk planner** for the official challenge [Interplanetary Survival Guide: Martian Map](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/). The recommended concept is **Concept A: "Boxwork Field Day"** — a layered map that helps an explorer plan a short walk with three science stops (ridge top, ridge wall, hollow) at the boxwork unit (Altadena member) on lower Mount Sharp.

This commit is **documentation and scaffolding only**. There is no application code yet.

## Do not start the build before 14 November 2026

A local event's challenge post (seen as a search snippet, not confirmed on the official page) says starting the build early can lead to disqualification. Reading, installing tools, and choosing roles are fine. Confirm in the Project Submission Guide, which the [Official FAQ](https://www.spaceappschallenge.org/resources/participant-faqs/) says is published on 13 November.

The official **Resources tab** and **judging guide** are expected on 13 November. Treat details from them as **UNVERIFIED** until then.

## Planned product

- **Preprocessing:** Python and GDAL, producing a slope / hazard cost map and an A\* / Dijkstra route between the three stops.
- **Web map:** a static [MapLibre](https://maplibre.org/maplibre-gl-js/docs/) or [Leaflet](https://leafletjs.com/reference.html) app on [Mars Trek](https://trek.nasa.gov/mars/) tiles (CTX, THEMIS, MOLA), plus local HiRISE and hazard overlays.
- **Safety layers:** illustrative slope limits (lunar stand-ins — no Mars-specific limit was found), a radiation **dose budget** from Curiosity RAD, and a [DONKI](https://ccmc.gsfc.nasa.gov/tools/DONKI/) space-weather banner (WSA-Enlil runs that list Mars).

Full design, data-layer links, conventions, and rules: **[AGENTS.md](./AGENTS.md)**. Claude Code should start at **[CLAUDE.md](./CLAUDE.md)**.

## Planned layout

```
data/raw/          # originals; gitignored, never commit
data/processed/    # small derived tiles and GeoJSON (from 14 Nov)
pipeline/          # Python + GDAL steps (no code until 14 Nov)
web/               # static map UI (no code until 14 Nov)
docs/AI_USE.md     # required AI / SI-tool log
skills/            # agent instructions
.cursor/rules/     # Cursor project rules
```

## How to run (planned, from 14 November)

1. Install Python 3 and GDAL (with OpenJPEG for HiRISE JP2 orthos).
2. Copy `.env.example` to `.env` and set `NASA_API_KEY` (free key from [api.nasa.gov](https://api.nasa.gov/)). Never commit `.env`.
3. Download listed products into `data/raw/` (see `skills/data-fetching/SKILL.md`).
4. Run the forthcoming pipeline to write `data/processed/`.
5. Serve `web/` as static files, with tiles and DONKI responses cached for an offline demo.

Until 14 November there is nothing to run.

## Rules

- No secrets in the repo. NASA API key only via `NASA_API_KEY`.
- Log all AI use in [docs/AI_USE.md](./docs/AI_USE.md). The FAQ requires the submission to describe "SI tools".
- No photos, video, voices, or likenesses of under-18s in the demo or submission.
- Cite data sources. Do not invent facts; mark gaps **UNVERIFIED**.
- Keep this repository private.

## Sources

See the source list at the end of [AGENTS.md](./AGENTS.md). Planning content follows the team's 11 November 2026 internal note and does not replace the official challenge page or the 13 November guides.
