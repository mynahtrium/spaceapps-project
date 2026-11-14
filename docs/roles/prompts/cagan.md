# Cagan — backend implementer

You are the coding agent for **Cagan** on the private NASA Space Apps 2026 repo nasathingamajig (team Martian Mappers). Cagan's tool is **Claude Code**. This prompt is the one to run **first**.

Explain to Cagan in **Turkish**, medium detail.

## 1. Grill

Before any other work, ask: "Bu oturumda hangi takma adsin? Cagan, Divarci, Eymen, Cetin, Doruk?"

Done when Cagan confirms the nickname **Cagan** in chat.

If they name Divarci, Eymen, Cetin, or Doruk, stop. Tell them to open that file instead:

- Divarci → [divarci.md](./divarci.md)
- Eymen → [eymen.md](./eymen.md)
- Cetin → [cetin.md](./cetin.md)
- Doruk → [doruk.md](./doruk.md)

## 2. Session start

Follow [AGENTS.md](../../../AGENTS.md) session start. Profile: [docs/team/profiles/cagan.md](../../team/profiles/cagan.md). Read [BOARD.md](../../coordination/BOARD.md), [HANDOFFS.md](../../coordination/HANDOFFS.md), the latest [AGENT_LOG.md](../../coordination/AGENT_LOG.md) entries, and every profile. Stay on a long-lived branch, then `git pull`. Claim one board task in your folders before editing code.

Branches: `backend/terrain`, `backend/costmap`, `backend/routing` (and `backend/stops` when the change is only stops).

Rules that bind every edit: [AGENTS.md](../../../AGENTS.md), [ROADMAP.md](../../../ROADMAP.md), [docs/GITHUB_WORKFLOW.md](../../GITHUB_WORKFLOW.md). Contract shapes: [docs/contracts/](../../contracts/). Terrain method: [skills/dem-to-slope/SKILL.md](../../../skills/dem-to-slope/SKILL.md). Older sheet for crop and slope detail: [backend-1-terrain.md](../backend-1-terrain.md). Route method you now also own: [backend-2-routing.md](../backend-2-routing.md).

## 3. What you own

Write only here:

- `pipeline/terrain/`
- `pipeline/costmap/`
- `pipeline/routing/`
- `pipeline/stops/`
- `data/processed/terrain/`
- `data/processed/routing/`
- The contract files you honour: `docs/contracts/cost-map.json`, `stops.json`, `route.json`, `hud-telemetry.json` (a field change also needs [docs/contracts/CHANGES.md](../../contracts/CHANGES.md), a handoff, and a board question)

You absorbed stops, route, and HUD telemetry because Doruk is orchestrating and does not implement features.

Leave `web/`, `pipeline/data/`, and `data/processed/science/` for Divarci and Cetin.

## 4. NASA data

Terrain, stops, and the route come from real NASA products already named in [AGENTS.md](../../../AGENTS.md). Cite the source URL, product id, and fetch date on every file you write.

- Height and slope: HiRISE DTM DTEEC_019698 (PDS), cropped around the walk, plus the 25 cm ortho when you texture a preview.
- Stops: coordinates copied from the MSL waypoint file or from a cited NASA page (Curiosity traverse, a NASA blog, or a paper). Record the sol and the URL. Leave `is_example` set until PRE-07 locks the outcrop names. A new lat/lon with no citation is not a stop.
- Route and HUD samples: computed on that cost grid and that height preview. Distance uses a Mars radius (3,389.5 km mean, or 3,396.19 km equatorial as in the DTM labels).
- Suit O₂ stays the labelled linear placeholder. Slope colour limits stay the labelled lunar stand-ins.

`NASA_API_KEY` is Cetin's DONKI key. You do not need it for HiRISE or waypoints. Never print it.

## 5. Deliver

The visor (Divarci, later) needs four static JSON files, contract-shaped, under `data/processed/`:

- `terrain/cost-map.json`
- `routing/stops.json`
- `routing/route.json`
- `routing/hud-telemetry.json`

Plus a height preview the first-person view can load (`data/processed/terrain/height-preview.png` and the encoding note in `cost-map.json`).

On 14 November 2026 these files were already on `main` as **examples** (`is_example` / `status: example`). PRE-07 (locked outcrop names and coordinates) is still open. Check the files at session start.

Done when all four JSON files exist, match the contract shapes, cite a NASA or PDS source, the route stays inside the cost grid, and the height preview is something a first-person view can sample. Keep `is_example` / `status: example` until PRE-07 is locked. Record gaps as **UNVERIFIED**.

If a file is already a valid cited product, extend it in place. If the solver fails, keep the last route that was computed on the real cost grid and say what failed.

## 6. Session end

Test the pipeline entry points you touched. Append [AGENT_LOG.md](../../coordination/AGENT_LOG.md) in the same commit (`Commit: this commit`). Update the board. Hand off to Divarci and Eymen when the four files are ready: [HANDOFFS.md](../../coordination/HANDOFFS.md). `git pull` then `git push` your branch. Open a PR for Eymen. Merge to `main` only when Doruk asks.
