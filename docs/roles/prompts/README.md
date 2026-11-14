# Agent prompts — current assignment

These five files are the assignment for the astronaut-visor pass. Paste **one** file into that person's agent. Each file is self-contained.

Technical contracts, hour-by-hour tasks, and folder details stay in the older sheets in [docs/roles/](../README.md) and in [ROADMAP.md](../../../ROADMAP.md). If a prompt and an older sheet disagree about **who owns a folder**, the prompt wins.

Asil is not in this pack. [tester-1.md](../tester-1.md) stays as it is.

## Product

A first-person view from the astronaut's eyes. The helmet HUD sits in front of the face. That HUD holds a map, the route, and the MUST readouts (distance, slope, next stop, suit O₂ labelled as a placeholder). The route and the stops are also drawn on the terrain (AR). Divarci builds that view. Everyone else supplies the files it reads, or reviews them, or compiles the branches.

## NASA data

The visor shows cached NASA and PDS products, each with a source URL, a product id, and a fetch date. A personal key is in the gitignored `.env` as `NASA_API_KEY` (present on the orchestrator machine on 14 November 2026). Agents load that name from the environment. They never write the value into git, chat, the board, or a prompt. `DEMO_KEY` is refused.

`api.nasa.gov` is for DONKI: WSAEnlilSimulations (Mars in `impactList`), CME, SEP, and GST. Curiosity pictures use the MSL raw-image feed. `api.nasa.gov/mars-photos` stayed 404 on 11 November 2026. Terrain is HiRISE PDS. Waypoints are the MSL waypoint file. Suit O₂ stays a labelled placeholder. Slope limits stay labelled lunar stand-ins. Dose stays the published RAD baseline times walk time.

If a fetch fails, keep the last real cache and mark the gap **UNVERIFIED**. A labelled example is only for that gap, and the HUD says it is an example.

## Run order

1. **Cagan** — paste [cagan.md](./cagan.md) into Claude Code first. Backend implementer: terrain, cost map, stops, route, HUD telemetry.
2. **Cetin** — paste [cetin.md](./cetin.md) into Gemini. Data and APIs, beside Cagan, in the science tree only. Profile nickname CC is Cetin. First science action is a live DONKI fetch with `NASA_API_KEY`.
3. **Divarci** — paste [divarci.md](./divarci.md) when Cagan's four JSON files are on disk (`cost-map.json`, `stops.json`, `route.json`, `hud-telemetry.json` under `data/processed/`), or when Doruk says to proceed on [docs/contracts/](../../contracts/) samples. UI: the visor.
4. **Eymen** — paste [eymen.md](./eymen.md). Debugging and PR review as each branch is ready. Demo docs stay his for the later freeze.
5. **Doruk** — paste [doruk.md](./doruk.md) into Grok in Cursor. Orchestrator. Compiles the four branches when each owner says the unit is ready. No feature code in `pipeline/` or `web/`.

## Compile

Doruk merges a role branch only after that owner says the unit is ready and Eymen has reviewed it. No force-push. `main` only when Doruk chooses to integrate.
