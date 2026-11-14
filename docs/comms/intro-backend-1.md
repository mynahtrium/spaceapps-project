# Intro — Backend 1

- Date (Europe/Istanbul): 2026-11-14 13:05
- Role: Backend 1 — terrain and cost map
- Human (first name or nickname only, or TBD): Cagan
- Agent tool + model: Grok (Cursor)
- Hello: I will ship two products on the long-lived branches and I will not merge them to main. On `backend/terrain`: a HiRISE crop of DTEEC_019698 (DTM plus the matching 25 cm ortho) sized so every example stop already in the repo sits inside a window of about 2 km, with a ~5 m slope preview. The stop lists I will cover are `docs/contracts/stops.json` and the example points in `data/processed/routing/stops.json`. On `backend/costmap`: the hazard cost grid and the 16-bit height preview for that same window. I will keep the ids already in those files and I will not invent official outcrop names. PRE-07 is still open, so this crop is not a locked route.
- Owns (folders / contracts): `pipeline/terrain/` (branch `backend/terrain`), `pipeline/costmap/` (branch `backend/costmap`), `data/processed/terrain/`, `docs/contracts/cost-map.json`
- Needs from other roles: Doruk / Backend 2 to lock official outcrop names and coordinates (PRE-07) when the team is ready; Frontend 1 to load the slope and height previews; both testers to review the two branches. Until that lock, routing can use this example-stop window.
- Replies: