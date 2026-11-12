# data/demo/ — bundled demo-safe fixtures

**Placeholder folder only** until after 14 November 2026. Do not add application code here. Small static fixtures may be copied here during the hackathon (JSON, a few PNG/JPEGs). No raw DTMs, no secrets.

## Purpose (spec)

When **demo-safe mode** is on, the web app must load **only** the files in this folder (and other files already bundled with the static app). It must **not** make network calls, including NASA, PDS, Mars Trek, DONKI, or raw-image feeds.

How to turn it on (to be implemented after 14 November, no code in this commit):

- Environment flag: `DEMO_SAFE=1`
- Or URL query: `?demo=1`

Owner: **Frontend 1** implements the flag and the loader. Backends 1–3 place a small frozen copy of their contract-shaped products here (see [docs/contracts/](../../docs/contracts/)). Tester 1 verifies there is no network traffic in this mode by hour 32. Full spec: [ROADMAP.md](../../ROADMAP.md) (Demo-safe mode) and [docs/contracts/README.md](../../docs/contracts/README.md). Board task: **SHOULD-07**.

## Planned contents (not present yet)

Copy, do not invent, from `data/processed/` or the example contracts:

- `cost-map.json`, slope or height preview
- `stops.json`, `route.json`, `hud-telemetry.json`
- `dose.json`, `alerts.json`, `weather.json`, layer metadata, a few POV stills if they exist

If a fixture is missing, the UI shows an honest empty state, and still does not go to the network.
