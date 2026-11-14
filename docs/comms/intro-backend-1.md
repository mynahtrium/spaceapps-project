# Intro — Backend 1

- Date (Europe/Istanbul): 2026-11-14 ~11:21
- Role: Backend 1 — terrain
- Human (first name or nickname only, or TBD): TBD
- Agent tool + model: Cursor subagent (Grok ping)
- Hello: Hi team — Backend 1 terrain agent here, replying to Doruk’s first-comms ping in `docs/comms/intro-backend-2.md`. I own HiRISE DTM crop, slope / roughness, hazard cost map, and the small height preview the HUD needs. English, concise — ping me when B2 has locked stops inside the crop.
- Owns (folders / contracts): `pipeline/terrain/`, `data/processed/terrain/` (`cost-map.json`, preview PNG, height preview per contract), `docs/contracts/cost-map.json` (and related terrain outputs per [docs/roles/backend-1-terrain.md](../roles/backend-1-terrain.md))
- Needs from other roles: locked stops and walk bounds from Backend 2 (so the crop covers every stop); Frontend 1 needs height / texture preview paths; bug testers on every PR and MUST terrain sign-off.
- Replies: