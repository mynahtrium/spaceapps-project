# pipeline/terrain/

HiRISE DTM crop, slope, ortho, and tilt check. See [skills/dem-to-slope/SKILL.md](../../skills/dem-to-slope/SKILL.md).

| Script | What it writes |
|---|---|
| `crop_window.py` | Window around the example stops already in the repo |
| `make_slope.py` | Gitignored 1 m DTM crop, `slope-preview.png`, `slope_stats.json` |
| `crop_ortho.py` | Gitignored ortho crop and `ortho-preview.png` (same footprint) |
| `tilt_check.py` | `tilt-check.json` (MUST-03, earlier pass) |
| `fetch_dtm.py` | Resumable, chunked download of only the DTM rows the crop needs (gitignored local `.IMG`); `make_slope.py` uses it when present |
| `make_relief.py` | `hillshade.png`, `texture-ortho.jpg`, `texture-relief.jpg`, closed `relief.stl`, `relief-preview.png`, `relief.json` (and `height-hi.png` in full mode). `--from-preview` builds offline from the 5 m height and ortho previews |

`make_slope.py` reads `docs/contracts/stops.json` and `data/processed/routing/stops.json` and refuses to finish if any of those points falls outside the crop. The ids in those files are examples. PRE-07 has not locked official outcrop names, and these scripts do not invent any.

Cost / hazard grid and the height preview are `pipeline/costmap/` on branch `backend/costmap`. Raw GeoTIFFs stay in `data/raw/` and are not committed. Slope class colours are lunar stand-ins (green ≤ 10°, amber 10–15°, red 15–20°, black blocked > 20°, grey no-data).

## Streamed corridor (habitat to Glen Torridon), 2026-11-15

`build_corridor.py` writes `data/demo/corridor/` (manifest, ~8 m overview, 168 chunks of 1 m heights and ~0.5 m imagery, about 14 MB), which `web/map/GaleCorridor.js` streams in both normal and demo-safe mode. `../costmap/make_corridor_cost_map.py` then rebuilds the cost map and previews on the same ground, and `../routing/build_route.py` routes on it. Only numpy plus the `opj_decompress` and `vips` command-line tools are needed (no GDAL, no Pillow).

Inputs go in `data/raw/hirise/` (gitignored). The DTM is read with HTTP range requests, so only the corridor rows are downloaded (~146 MB):

```sh
B=https://hirise-pds.lpl.arizona.edu/PDS/DTM/PSP/ORB_009100_009199/PSP_009149_1750_PSP_009294_1750
RB=26996   # bytes per DTM line; the label is the first record
curl -r $((RB + 2900*RB))-$((RB + 8320*RB - 1)) -o data/raw/hirise/dtm9149_rows_from_2900.f32 $B/DTEEC_009149_1750_009294_1750_U01.IMG
curl -o data/raw/hirise/PSP_009149_1750_RED_A_01_ORTHO.JP2 $B/PSP_009149_1750_RED_A_01_ORTHO.JP2   # 388 MB
curl -o data/raw/hirise/PSP_009149_1750_RED_A_01_ORTHO.LBL $B/PSP_009149_1750_RED_A_01_ORTHO.LBL
python3 pipeline/terrain/build_corridor.py
python3 pipeline/costmap/make_corridor_cost_map.py
python3 pipeline/routing/build_route.py && python3 -m pipeline.data.build_dose && python3 -m pipeline.data.export_demo_fixtures
```

Registration: Curiosity waypoint coordinates and DTEEC_009149 differ by a constant shift. Searching shifts against 478 waypoints inside the corridor gives -60 samples / +14 lines (about 60 m E-W, 14 m N-S); the DTM-minus-rover elevation spread drops from 6.24 m to 2.35 m (median offset +8.7 m, a datum difference). The pipeline applies that shift so the stops and route sit on the right ground. Re-fit it if the DTM or the waypoint file changes.
