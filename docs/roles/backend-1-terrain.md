# Backend 1 — terrain and hazard cost map

You own the DEM → slope / hazard cost map (GDAL). The 3D view and the router both wait on your cropped height and cost products. You are not writing the web app or the path finder.

Read first: [ROADMAP.md](../../ROADMAP.md), [AGENTS.md](../../AGENTS.md), [docs/contracts/cost-map.json](../contracts/cost-map.json), [docs/GITHUB_WORKFLOW.md](../GITHUB_WORKFLOW.md), [skills/dem-to-slope/SKILL.md](../../skills/dem-to-slope/SKILL.md), [skills/data-fetching/SKILL.md](../../skills/data-fetching/SKILL.md).

**No application code before 14 November 2026.**

## Responsibilities

- Download (after kickoff) the HiRISE DTM and 25 cm ortho for the locked Mount Sharp walk, crop to ~2 km × 2 km, resample to 2–5 m, compute slope and roughness, build the cost / hazard map, write a small height or slope preview the frontend can load.
- Validate slope against Curiosity waypoint `tilt` and record the known DTM under-read.
- Keep products small. Never commit `data/raw/`, `.env`, or bulky `*.tif` / `.IMG` / JP2.

## Owned folders (do not edit other trees)

- `pipeline/terrain/` — your GDAL / Python steps (from 14 Nov)
- `data/processed/terrain/` — `cost-map.json`, preview PNG, tiny height mesh or raster the web app may fetch
- `docs/contracts/cost-map.json` — field names you must honour

## Tasks by phase

**Pre-14 Nov:** GitHub account, practice PR on [docs/team/ROSTER.md](../team/ROSTER.md), install Git + Python 3 + GDAL with OpenJPEG, run `gdalinfo --formats` on your machine, read the DTM notes in AGENTS.md, sit in the route-lock discussion so the crop contains every stop.

**Hours 0–6:** Download DTM + ortho into `data/raw/`. `gdalinfo`. Crop around the locked walk. Average-resample. First slope preview PNG.

**Hours 6–10:** Roughness / TRI, no-data and slope-limit masks, write `data/processed/terrain/cost-map.json` and previews. Hand off to Backend 2 and Frontend 1.

**Hours 10–16:** Tilt check vs [MSL waypoints](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json). Freeze the MUST raster. Bugfix only after hour 14.

**Hours 16–32:** Optional 15° vs 20° second mask. Help Frontend 1 with an ortho texture if needed. Terrain bugfixes only.

**Hours 32–40:** Stretch only if testers say MUST/SHOULD are solid (for example boulder mask). Stop new work at hour 40.

**Hours 40–48:** Freeze, help the video if a slope layer is shown, do not add features.

## Handoffs

| When | You give | To |
|---|---|---|
| Hour ~6–10 | `cost-map.json` + preview, crop bounds | Backend 2, Frontend 1, testers |
| Hour ~10–16 | Height / texture preview that the 3D view can load | Frontend 1 |
| Hour 16 | Frozen MUST products | Testers (MUST sign-off) |
| Later | Optional 15° mask, better ortho tiles | Frontend 1, Backend 2 |

## Definition of done (your part of MUST)

A documented crop of DTEEC_019698 (or the agreed DTM) with slope / hazard classes, a cost grid or a clearly described preview, `cost-map.json` in the contract shape, and a note about lunar slope limits and DTM under-read. If GDAL fails, still ship a tiny preview and the contract file, and say what failed.

## Checklist

- [ ] GDAL + OpenJPEG installed (before 14 Nov)
- [ ] Practice PR done
- [ ] Crop contains every locked stop
- [ ] `cost-map.json` matches the contract
- [ ] Preview file path in that JSON actually exists (or the UI falls back cleanly)
- [ ] No raw DTM committed
- [ ] AI use logged in `docs/AI_USE.md`

## Ready-to-paste prompt for your coding agent

```
You are helping Backend 1 on the private NASA Space Apps 2026 repo nasathingamajig (team Martian Mappers).

Read AGENTS.md, ROADMAP.md, docs/roles/backend-1-terrain.md, docs/contracts/cost-map.json, and skills/dem-to-slope/SKILL.md before editing.

Rules: If today is before 14 November 2026, do not write application code (.py/.js/.ts), package.json, notebooks, or a data pipeline. Docs and install guidance only. Never commit secrets, .env, data/raw, or bulky rasters. Keep the repo private. Do not touch folders I do not own (pipeline/terrain/, data/processed/terrain/, docs/contracts/cost-map.json). Log AI use in docs/AI_USE.md.

Site: Gale / Mount Sharp. Stay inside HiRISE DTM DTEEC_019698 coverage. Science goal: ancient lake sediments / habitability (organics in mudstones); boxwork is a bonus stop. Slope limits 15°/20° are lunar stand-ins. The 1 m DTM under-reads rover tilt — say so. Use a Mars radius for any distances.

After 14 Nov, work in small git branches (backend-1/short-topic), open a small PR, and wait for a bug tester to review. Prefer GDAL command-line (gdaldem slope, roughness, gdalwarp -r average) and write only small products. If the full DTM fails, fall back to a smaller crop or a tiny preview as in the roadmap risks list.

Task: [DESCRIBE THE TASK]
```
