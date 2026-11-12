# Frontend 1 — planner map and 3D helmet HUD

You own the web app: a 2D MapLibre planner that **sends the route** into a **3D first-person terrain view** with a **helmet HUD**. VR / WebXR is stretch only (hours 32–40). You are the only person writing in `web/`.

Read first: [ROADMAP.md](../../ROADMAP.md), [AGENTS.md](../../AGENTS.md), [docs/contracts/README.md](../contracts/README.md), [docs/GITHUB_WORKFLOW.md](../GITHUB_WORKFLOW.md), [skills/map-ui/SKILL.md](../../skills/map-ui/SKILL.md), [skills/hud-3d/SKILL.md](../../skills/hud-3d/SKILL.md).

**No application code before 14 November 2026** (no `.js` / `.ts`, no `package.json` in this repo until then). You may watch tutorials and sketch the HUD on paper.

## Responsibilities

- Planner: MapLibre on Mars Trek (or cached / fallback) tiles, hazard overlay, stops, route, later THEMIS/CRISM/weather toggles, source legend.
- 3D: default is [three.js](https://threejs.org/) heightmap from Backend 1's preview. Use CesiumJS only if you already know it. Do not learn a new 3D engine during hours 0–16.
- HUD MUST show **distance**, **slope**, **next stop**, and **suit O₂** (O₂ labelled as a placeholder).
- Load `data/processed/**` first, then fall back to `docs/contracts/*.json`, so you can demo even when backends are late.
- Static web app; cache for offline. Optional backend APIs are nice; they must not be required on stage.
- No under-18 faces or voices in any capture.

## Owned folders

- `web/planner/`
- `web/hud/`
- `web/shared/` (including the `mm:set-route` bridge, from 14 Nov)
- `web/README.md`

Do not edit `pipeline/` or `data/processed/` (read only). If a JSON field is wrong, open an issue or ask the owning backend to fix it.

## Tasks by phase

**Pre-14 Nov:** Account, practice PR, browser ready, short MapLibre + three.js intros, paper sketch of the visor (four MUST readouts).

**Hours 0–2:** Scaffold both views. Hook dummy HUD numbers from `docs/contracts/hud-telemetry.json`.

**Hours 2–10:** First-person camera. Drop in Backend 1's height preview when it appears (flat plane until then). Planner shows example then real stops/route. Implement `mm:set-route`.

**Hours 10–16:** HUD complete (distance, slope + colour class, next stop, O₂ %). Texture the mesh with ortho or slope colour. MUST polish. Missing files must fall back, not crash.

**Hours 16–32:** Dose card, DONKI banner, POV lightbox at stops, weather note, THEMIS (and CRISM if present) toggles, credits panel.

**Hours 32–40:** Stretch WebXR only if MUST/SHOULD are solid. Must degrade if WebXR is missing. Paired rover overlay with Backend 2 if ready. **No new work after hour 40.**

**Hours 40–48:** Freeze. Help Tester 2 record the 30-second screen video (captions, no under-18 likenesses) and run the live demo flow.

## Handoffs

You **receive** cost/height previews (B1, ~hour 6–16), stops/route/telemetry (B2, ~hour 0–16), dose/alerts/POV/weather/layers (B3, ~hour 16–32).

You **give** testers a URL or `web/` static entry point at hour 14–16, and a frozen demo at hour 40.

## Definition of done (MUST)

A reviewer can open the web app, see a 2D route, start the EVA, and walk or play back a 3D first-person view with the four HUD fields. If processed data is missing, contract JSON still drives a showable walk.

## Checklist

- [ ] Planner sends route to HUD
- [ ] Four MUST HUD fields visible and labelled (O₂ placeholder)
- [ ] Fallback to `docs/contracts/` works
- [ ] Offline enough for the demo room
- [ ] Credits / honesty notes visible
- [ ] AI use logged

## Ready-to-paste prompt for your coding agent

```
You are helping Frontend 1 on the private NASA Space Apps 2026 repo nasathingamajig (team Martian Mappers).

Read AGENTS.md, ROADMAP.md, docs/roles/frontend-1-hud.md, docs/contracts/README.md, skills/map-ui/SKILL.md, and skills/hud-3d/SKILL.md before editing.

Rules: If today is before 14 November 2026, do not write application code (.js/.ts/.py), package.json, or notebooks. Docs only. Never commit secrets. Only edit web/planner/, web/hud/, web/shared/, and web/README.md. Log AI use in docs/AI_USE.md. Branches: frontend-1/short-topic. A bug tester reviews every PR.

Product: a web app. 2D MapLibre planner sends a route to a 3D first-person three.js heightmap view with a helmet HUD. WebXR is stretch only after hour 32 and must not break the default view. CesiumJS only if I already know it. Load data/processed/ first, then fall back to docs/contracts/ sample JSON. Do not require a live API.

MUST HUD fields: distance, slope, next stop, suit O2. Suit O2 and walking time are illustrative placeholders — label them. Slope limits are lunar stand-ins. Do not draw a fake spatial radiation map. Use Mars lon/lat as in the contracts (GeoJSON is lon, lat). Aim for a tablet-friendly layout plus a full-screen visor.

Site: Gale / Mount Sharp. Science goal: ancient lake sediments / habitability (organics in mudstones); boxwork is a bonus stop. Example coordinates in the contracts are placeholders.

Task: [DESCRIBE THE TASK]
```
