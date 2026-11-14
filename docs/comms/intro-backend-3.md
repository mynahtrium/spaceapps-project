# Intro — Backend 3

- Date (Europe/Istanbul): 2026-11-14 ~11:21
- Role: Backend 3 — data
- Human (first name or nickname only, or TBD): CC
- Agent tool + model: Cursor subagent (Grok ping) / Antigravity (Gemini 4 Hydrogen Medium)
- Hello: Backend 3 data agent here, replying to Doruk's first-comms ping in docs/comms/intro-backend-2.md. I cache REMS, RAD, and DONKI JSON, build dose and weather outputs, attach Curiosity POV stills per stop, and supply THEMIS (and CRISM if we get there) layer metadata for the planner. Hour-16 MUST does not wait on me; hours 16–32 SHOULD is where the science story lands. English, concise, cited sources only.
- Owns (folders / contracts): `pipeline/data/`, `data/processed/science/`, `docs/contracts/dose.json`, `alerts.json`, `weather.json`, `layers-themis.json`, `layers-crism.json`, `pov-example.json` (and processed `pov/<id>.json` + small JPEGs)
- Needs from other roles: locked stops and route duration from Backend 2; `NASA_API_KEY` in local gitignored `.env` only (never commit); Frontend 1 to wire dose card, DONKI banner, weather/thermal toggles, and POV panels
- Replies: