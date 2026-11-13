# Curiosity waypoint check (stops still unlocked)

**Date:** 13 November 2026. **Stops are not locked.** Board task **PRE-07** (HiView / official outcrop picks, all inside DTEEC_019698) is still open. This file is a reference only. Do not treat these numbers as the team's route. The example points in [docs/contracts/stops.json](../contracts/stops.json) were **not** changed.

Source for rover positions: NASA's [MSL waypoints](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json) (GeoJSON; properties `sol`, `lat`, `lon`). Coordinates below are planetocentric latitude, then longitude, as in that file.

## Checked waypoints

| Sol | Role in this check | Latitude | Longitude |
|---|---|---|---|
| 4527 | nearby, before boxwork entry | -4.79721368 | 137.38750650 |
| 4534 | published boxwork entry | -4.79761763 | 137.38643610 |
| 4544 | nearby, after entry | -4.79796004 | 137.38566360 |
| 4560 | nearby, later in the unit | -4.79984723 | 137.38354140 |
| 5070 | latest point in the waypoint file | -4.82567778 | 137.38915320 |

Planning notes sometimes round Sol 4534 to "about 4.80°S, 137.39°E" and Sol 5070 to "about 4.83°S, 137.39°E". The table above is the file's own values.

## Inside the DTEEC_019698 footprint

The 11 November 2026 planning check recorded [DTEEC_019698](https://hirise-pds.lpl.arizona.edu/PDS/DTM/ESP/ORB_019600_019699/ESP_019698_1750_ESP_019988_1750/DTEEC_019698_1750_019988_1750_U01.IMG) coverage as **4.73–5.04°S, 137.31–137.44°E**, from the [cumulative DTM index](https://hirise-pds.lpl.arizona.edu/PDS/INDEX/DTMCUMINDEX.TAB) (see [AGENTS.md](../../AGENTS.md)). All five latitudes and longitudes in the table fall inside that box.

## Example contract stops (illustrative only)

The four example stops in `docs/contracts/stops.json` (all `is_example: true`) sit about **100–900 m** off the Curiosity traverse, measured to the nearest waypoint in the file (Sol 4527). They are placeholders near the published Mount Sharp traverse, not chosen science outcrops:

| Example id | Coordinates (lon, lat in the file) | Approx. distance to nearest waypoint |
|---|---|---|
| `stop-habitat` | 137.388, -4.798 | ~100 m |
| `stop-mudstone-a` | 137.39, -4.8 | ~400 m |
| `stop-mudstone-b` | 137.3915, -4.8015 | ~650 m |
| `stop-boxwork-bonus` | 137.393, -4.803 (`sol_hint` 4534) | ~900 m |

Do not copy these into `data/processed/routing/stops.json` as locked stops.

## Still UNVERIFIED / not locked

- Exact lake-sediment / mudstone **outcrop names** and the team's final stop coordinates (choose against official NASA / Curiosity sources and the 13 November Resources tab, which was still unreadable on 13 November).
- Whether the boxwork unit itself sits inside the [DTEEC_001488](https://hirise-pds.lpl.arizona.edu/PDS/DTM/PSP/ORB_001400_001499/PSP_001488_1750_PSP_001752_1750/DTEEC_001488_1750_001752_1750_U02.IMG) footprint (west of the traverse). Confirm in [HiView](https://www.uahirise.org/hiview/) before relying on that DTM.
- The mudstone (and habitat) **stop picks** for the walk. PRE-07 is still to do.
