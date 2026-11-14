# Divarci — UI designer

You are the coding agent for **Divarci** on the private NASA Space Apps 2026 repo nasathingamajig (team Martian Mappers). Divarci designs and builds the astronaut visor.

Explain to Divarci in the language they choose during the grill.

## 1. Grill

Before any other work, ask which nickname they are: Cagan, Divarci, Eymen, Cetin, or Doruk.

Done when they confirm **Divarci** in chat.

If they name Cagan, Eymen, Cetin, or Doruk, stop and name the other file:

- Cagan → [cagan.md](./cagan.md)
- Eymen → [eymen.md](./eymen.md)
- Cetin → [cetin.md](./cetin.md)
- Doruk → [doruk.md](./doruk.md)

There is no `docs/team/profiles/divarci.md` yet. After they confirm the nickname, run the interview in [docs/team/profiles/README.md](../../team/profiles/README.md) and write that profile (first name or nickname only) before feature work. Their role on this pass is **UI designer**. Also ask Turkish or English, and short, medium, or detailed explanations. Then use that for the rest of the session.

## 2. Session start

Follow [AGENTS.md](../../../AGENTS.md) session start. Read [BOARD.md](../../coordination/BOARD.md), [HANDOFFS.md](../../coordination/HANDOFFS.md), the latest [AGENT_LOG.md](../../coordination/AGENT_LOG.md) entries, and every profile. Branch: `frontend/planner-hud`. `git pull`, then claim one board task in `web/` before editing code.

Rules: [AGENTS.md](../../../AGENTS.md), [ROADMAP.md](../../../ROADMAP.md), [docs/GITHUB_WORKFLOW.md](../../GITHUB_WORKFLOW.md). Older sheet: [frontend-1-hud.md](../frontend-1-hud.md). Skills: [skills/hud-3d/SKILL.md](../../../skills/hud-3d/SKILL.md), [skills/map-ui/SKILL.md](../../../skills/map-ui/SKILL.md).

## 3. What you own

Write only here:

- `web/planner/`
- `web/hud/`
- `web/shared/`
- `web/README.md`
- `web/index.html`, `web/app.js`, `web/styles.css`

Leave `pipeline/` and `data/processed/` alone. If a JSON field is wrong, ask the owner (Cagan or Cetin) to fix it.

## 4. Gate

Start visor code when these four files are on disk:

- `data/processed/terrain/cost-map.json`
- `data/processed/routing/stops.json`
- `data/processed/routing/route.json`
- `data/processed/routing/hud-telemetry.json`

On 14 November 2026 they were already on `main`. Confirm them at session start. If one is missing, stop and tell Doruk. Doruk may instead tell you to proceed on [docs/contracts/](../../contracts/) samples. Say on screen when a sample is an example.

`web/` already has a 2D MapLibre planner plus a separate three.js walk (F1, 14 November). The product for this pass is one first-person view. Keep the working MUST readouts, the `mm:set-route` bridge, the contract fallback, and `?demo=1` while you move the map onto the visor.

## 5. NASA data

Every science number, picture, and banner on the visor is a field from Cagan's or Cetin's cached NASA or PDS JSON. Show the source and the fetch date in the credits panel. A missing field is an honest empty state ("no NASA value"), not a number you invent.

Read order: `data/processed/`, then `docs/contracts/`. In `?demo=1` or `DEMO_SAFE=1`, read only `data/demo/` and make no network call, including no call to `api.nasa.gov`.

Bind the HUD like this:

- Map and route line: `route.json` and `stops.json` (Mars lat/lon).
- Terrain underfoot: `height-preview.png` with the encoding note in `cost-map.json`.
- AR markers in the world: the same stops and the route, drawn on the mesh.
- Distance, slope, next stop: `hud-telemetry.json`.
- Suit O₂: the placeholder field, labelled as a placeholder.
- Dose and the space-weather banner: `dose.json` and `alerts.json` from Cetin's live DONKI cache. If `alerts.json` says live DONKI was skipped, show that sentence. Do not replace it with a forecast you wrote.
- Weather, THEMIS, CRISM, rover POV: the science JSON and cached images. Empty state when the file is missing.

WebXR stays stretch and must leave this default view working.

## 6. Done

A reviewer can open the app, stand in the first-person view, see the map and the route on the HUD, see the same route on the terrain, and read distance, slope, next stop, and placeholder O₂. Credits list the NASA and PDS sources. Demo-safe mode makes no network calls.

## 7. Session end

Check the visor in a browser: start the walk, confirm the four readouts change along the route, and confirm a missing file shows an empty state. Append [AGENT_LOG.md](../../coordination/AGENT_LOG.md) in the same commit (`Commit: this commit`). Update the board. Hand off to Eymen. `git pull` then `git push` `frontend/planner-hud`. Open a PR. Merge to `main` only when Doruk asks.
