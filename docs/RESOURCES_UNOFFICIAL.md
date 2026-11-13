# Challenge resources and datasets (13 November 2026)

A map of NASA and partner datasets and tools named in public copies and in official pages read with `curl -k`. This file does **not** replace the official challenge Resources tab. [ROADMAP.md](../ROADMAP.md) and [docs/DECISIONS.md](./DECISIONS.md) were not changed from these sources.

**Access note:** HTTPS to `www.spaceappschallenge.org` failed certificate verification; HTTP returned 500. Official-hostname pages below were read with `curl -k` on 13 November 2026 (TLS certificate not verified). Label:

- **Official page (curl -k, certificate not verified)** — content from an official Space Apps or NASA URL loaded that way.
- **UNOFFICIAL** — third-party or local-event copies, not the official Resources tab.

Related: [docs/JUDGING_CHECKLIST.md](./JUDGING_CHECKLIST.md).

## Official NASA Data & Resources tab (curl -k, certificate not verified)

Source: [Interplanetary Survival Guide: Martian Map](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/), `lastPublishedAt` `2026-11-13T03:46:20.420900Z` (06:46 Europe/Istanbul). The page’s “NASA Data & Resources” list, with the page’s own short descriptions:

| Dataset / tool | Official link and blurb | Mapping |
|---|---|---|
| JPL Mars Trek | [Mars Trek](https://trek.nasa.gov/mars/) — “NASA web-based portal for exploration of Mars, showcases data collected by NASA at various landing sites.” | **Already in plan.** Primary 2D base-map (CTX, THEMIS, MOLA WMTS). |
| USGS-NASA Planetary Geologic Mapping Program | [Interactive maps — Mars (ArcGIS Hub)](https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars) — “High-quality standardized geologic map of Mars.” | **Already in plan.** The 11 November check had the program page as 403 and [SIM 3292](https://pubs.usgs.gov/sim/3292/) as 200. This ArcGIS Hub URL is a working link to prefer; it does not change the science goal. |
| Curiosity proposed path up Mount Sharp | [Curiosity’s proposed path up Mount Sharp](https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/) — animation of a proposed Curiosity route on lower Mount Sharp; an annotated map labels regions; a flyover video explains them. The challenge text uses boxwork at Mount Sharp as an example science goal. | **New and worth adding** as a story and route-reference for the locked Gale / Mount Sharp walk (not as a new data pipeline). Useful for stop ideas and the demo. |
| NASA Worldview | [Worldview](https://worldview.earthdata.nasa.gov/) — Earth satellite imagery (NASA Earthdata), “the past and the present of this dynamic planet.” | **New, not worth adding** as a Mars data layer. It is an Earth tool. At most a UX inspiration for a layered map; it does not help a Marswalk. |
| Mars Perseverance raw images gallery | [Perseverance raw images](https://mars.nasa.gov/mars2020/multimedia/raw-images/) — “Over 1 million images captured by the rover.” | **Already in plan** as a Concept B / Jezero backup source. **Not worth adding** to the locked Gale / Curiosity walk (use Curiosity raw images for POV). |

The Details text on the same page also names **Mars Trek** and the **USGS-NASA Planetary Geologic Mapping Program** in the Background (already in the table). It suggests (not as a hard rule) considering at least three kinds of data — “optical, thermal, spectral, topographic, geophysical, atmospheric, radiation, and chemical are a few examples” — and mentions space weather, spacesuit mobility, and a route that avoids large obstacles. Those are challenge-text suggestions already reflected in the plan; they are not extra datasets.

Wayback: the [1 November 2026 snapshot](https://web.archive.org/web/20261101080333/https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/) has the Details text (including the Trek / USGS mention and the boxwork / Mount Sharp example) but **not** this Resources-tab link list. The [8 October 2026 snapshot](https://web.archive.org/web/20261008052101/https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/) is a pre–28 October summary only.

## Unofficial third-party lists

### Space Data Atlas (UNOFFICIAL)

Source: [Interplanetary Survival Guide: Martian Map \| Space Data Atlas](https://spacedata.swapniltamse.com/challenges/martian-map/), read 13 November 2026. The page itself says official resource lists open on the Space Apps site on 13 November and that the list below is “suggestions, not the official resource list.”

| Dataset / tool | Link named on that page | Mapping |
|---|---|---|
| Mars Trek WMTS (CTX mosaic, MOLA hillshade) | [CTX WMTS capabilities](https://trek.nasa.gov/tiles/Mars/EQ/CTX_beta01_uncontrolled_5m_Caltech/1.0.0/WMTSCapabilities.xml) (MOLA layer also described) | **Already in plan.** |
| THEMIS day/night IR mosaics | Mentioned in the intro as also in Mars Trek (no separate new catalog). | **Already in plan.** |
| HiRISE images and DTMs (MRO) | [HiRISE PDS](https://hirise-pds.lpl.arizona.edu/PDS/) | **Already in plan.** |
| CRISM MTRDR mineral maps | [ODE Mars](https://ode.rsl.wustl.edu/mars/) | **Already in plan.** |
| NASA Ames Reference Mars Climate Simulations | [data.nas.nasa.gov/mcmcref](https://data.nas.nasa.gov/mcmcref/) | **Already in plan** as unavailable / **UNVERIFIED** (the 11 November check found TLS / server errors on that host). Still not worth adding until the host works. |
| Curiosity RAD surface radiation | [RAD RDR archive](https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/) | **Already in plan.** |
| NASA Image and Video Library API | [images-api.nasa.gov](https://images-api.nasa.gov/search) | **New, not worth adding** as a science layer for the walk (the Atlas describes it as mission artwork and historical photos). |

### UAE challenges listing (UNOFFICIAL)

Source: [The 2026 challenges](https://nasaspaceapps.ae/challenges) (Unique World Robotics / UAE local organizer; the site says it is not the official Space Apps website). Read 13 November 2026. It reprints the official challenge excerpt (layered, integrated view of a location or route; Intermediate; Human Exploration, Mars, Planets & Moons, Software, Space Exploration). **No resource list and no judging criteria.** No new datasets.

## What was not found

- A loadable 2026 Judging and Awards Guide **PDF** (S3 / assets searches did not yield a 2026 file). The HTML guide is at [judging-awards-guide](https://www.spaceappschallenge.org/resources/judging-awards-guide/) (see the checklist).
- archive.today: connection timed out.
- Google cache: returned a Google Search page, not the challenge HTML.
