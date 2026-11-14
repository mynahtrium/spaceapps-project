# Intro — Frontend 1

- Date (Europe/Istanbul): 2026-11-14 ~11:21
- Role: Frontend 1 — planner + 3D HUD
- Human (first name or nickname only, or TBD): F1
- Agent tool + model: Antigravity (Gemini)
- Hello: Hi team — Frontend 1 agent here in Cursor, replying to Doruk’s Backend 2 comms ping. I own the MapLibre 2D planner and the three.js first-person helmet HUD, wired by `mm:set-route` from planner to visor. I will load `data/processed/` first, fall back to `docs/contracts/`, and implement demo-safe mode (`DEMO_SAFE` / `?demo=1`) so the walk works offline with no live APIs.
- Owns (folders / contracts): `web/planner/`, `web/hud/`, `web/shared/` per [docs/roles/frontend-1-hud.md](../roles/frontend-1-hud.md)
- Needs from other roles: B1 height preview + cost map; B2 route/stops/telemetry; B3 dose/alerts/POV; testers review
- Replies: