# Cetin — data collection and APIs

You are the coding agent for **Cetin** on the private NASA Space Apps 2026 repo nasathingamajig (team Martian Mappers). Cetin's tool is **Gemini** (Antigravity). Cetin was profiled as **CC**. Same person. One profile: [docs/team/profiles/cc.md](../../team/profiles/cc.md). Do not create a second profile.

Explain to Cetin in **Turkish**, medium detail.

Run **beside** Cagan, after Cagan's Claude session has started. You do not block terrain or routing, and you do not edit those trees.

## 1. Grill

Before any other work, ask: "Bu oturumda hangi takma adsin? Cagan, Divarci, Eymen, Cetin, Doruk? CC, Cetin ile ayni kisi."

Done when they confirm the nickname **Cetin** (or CC, meaning Cetin) in chat.

If they name Cagan, Divarci, Eymen, or Doruk, stop. Tell them to open that file instead:

- Cagan → [cagan.md](./cagan.md)
- Divarci → [divarci.md](./divarci.md)
- Eymen → [eymen.md](./eymen.md)
- Doruk → [doruk.md](./doruk.md)

## 2. Session start

Follow [AGENTS.md](../../../AGENTS.md) session start. Read [BOARD.md](../../coordination/BOARD.md), [HANDOFFS.md](../../coordination/HANDOFFS.md), the latest [AGENT_LOG.md](../../coordination/AGENT_LOG.md) entries, and every profile. Stay on `backend/science`, then `git pull`. Claim one board task in your folders before editing code.

If the role line in `cc.md` is only "Backend 3 — data", set it to **data collection and APIs** the next time you edit that profile, and say the pack nickname is Cetin. No phone, email, address, school name, or other personal data.

Rules: [AGENTS.md](../../../AGENTS.md), [ROADMAP.md](../../../ROADMAP.md), [docs/GITHUB_WORKFLOW.md](../../GITHUB_WORKFLOW.md). Older sheet: [backend-3-data.md](../backend-3-data.md). Fetch notes: [skills/data-fetching/SKILL.md](../../../skills/data-fetching/SKILL.md).

## 3. What you own

Write only here:

- `pipeline/data/`
- `data/processed/science/`
- Science contract JSON: `docs/contracts/dose.json`, `alerts.json`, `weather.json`, `layers-themis.json`, `layers-crism.json`, `pov-example.json` (a field change also needs [docs/contracts/CHANGES.md](../../contracts/CHANGES.md), a handoff, and a board question)

Leave `pipeline/terrain/`, `pipeline/costmap/`, `pipeline/routing/`, `pipeline/stops/`, `data/processed/terrain/`, `data/processed/routing/`, and `web/` alone.

## 4. NASA data

The visor reads your cache. Every value is a response you fetched, with source URL, product id, and `fetched_at`. The personal key is `NASA_API_KEY` in the gitignored `.env`. On 14 November 2026 that key was present on the orchestrator machine. Load it from the environment. Never print it, paste it into chat, or commit `.env`. Refuse `DEMO_KEY`.

First science action: run the live DONKI fetch (`pipeline/data/fetch_donki.py`) against `https://api.nasa.gov/DONKI/` for WSAEnlilSimulations, CME, SEP, and GST. Keep runs whose `impactList` location contains Mars. Skip FLR (404 on 11 November 2026). Write `donki-cache.json` and `alerts.json` from that response. A file labelled "live DONKI was skipped" is not the file the visor reads once the key works.

Other feeds, same rule:

- REMS weather from the PDS atmospheres archive.
- RAD dose rate from the PDS PPI RAD RDR archive. `dose.json` multiplies the published Hassler et al. 2014 baseline (about 0.64 ± 0.12 mSv/day) by the route duration. Dose is a time budget. There is no spatial radiation map of rocks.
- MSL waypoints and the MSL raw-image feed for POV. `api.nasa.gov/mars-photos` stayed 404 on 11 November 2026; do not call it.
- THEMIS and CRISM pointers from Trek WMTS and ODE / PDS, small enough to commit.

If a fetch fails, keep the last real cache and mark the gap **UNVERIFIED**. Write a labelled example only for that gap.

## 5. Deliver

Static JSON the visor can fetch with the network off, copied from the live responses above:

- `dose.json`
- `alerts.json` and `donki-cache.json`
- `weather.json`
- `layers-themis.json` and `layers-crism.json`
- POV JSON for each stop, or an honest empty state. Cached images stay small.

Done when each product is present, its `fetched_at` and source URL match a real response, and `alerts.json` is from the live DONKI call when `NASA_API_KEY` is set.

Copy a small frozen fixture into `data/demo/` when you change a file the demo-safe switch must serve. Paths inside demo fixtures must point at `data/demo/`, not at `data/processed/`.

## 6. Session end

Re-run the science script you touched. Append [AGENT_LOG.md](../../coordination/AGENT_LOG.md) in the same commit (`Commit: this commit`). Update the board. Hand off new science files to Divarci and Eymen. `git pull` then `git push` `backend/science`. Open a PR for Eymen. Merge to `main` only when Doruk asks.
