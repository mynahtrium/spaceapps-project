# Libraries, tools and code citations

Everything the Martian Mappers code is built on, in one place. The NASA Space Apps form limits the number of citations, so all code, library, tool and AI-assistant citations are bundled here instead. NASA data and resources are cited on the form and in [SUBMISSION.md](./SUBMISSION.md) and [DATA_SOURCES.md](./DATA_SOURCES.md).

All libraries are open source and used under their own licences (MIT, BSD, Apache 2.0, ISC or similar). Versions are the ranges pinned in `package.json` and `pipeline/requirements.txt`. No team member is named.

## Browser app: 3D, rendering and physics

| Library | Used for | Link |
|---|---|---|
| three.js (vendored r170) | 3D rendering | https://github.com/mrdoob/three.js |
| three-mesh-bvh | Fast ray and collision queries on terrain meshes | https://github.com/gkjohnson/three-mesh-bvh |
| postprocessing | Bloom and screen effects | https://github.com/pmndrs/postprocessing |
| N8AO | Ambient occlusion | https://github.com/N8python/n8ao |
| 3DTilesRendererJS | Globe controls and ellipsoid maths | https://github.com/NASA-AMMOS/3DTilesRendererJS |
| tween.js | Globe camera animation | https://github.com/tweenjs/tween.js |
| Rapier (rapier.js) | Walker collisions | https://github.com/dimforge/rapier.js |
| MARTINI | Terrain meshing | https://github.com/mapbox/martini |
| detect-gpu | Graphics presets | https://github.com/pmndrs/detect-gpu |

## Browser app: geodesy and astronomy

| Library | Used for | Link |
|---|---|---|
| GeographicLib (geographiclib-js) | Geodesy | https://github.com/geographiclib/geographiclib-js |
| astronomy-engine | Earth and Mars positions | https://github.com/cosinekitty/astronomy |

## Browser app: utilities and input

| Library | Used for | Link |
|---|---|---|
| Zod | Settings validation | https://github.com/colinhacks/zod |
| mitt | Event emitter | https://github.com/developit/mitt |
| Joymap | Gamepad input | https://github.com/nkzw-tech/joymap |
| dualsense-ts | DualSense controller support | https://github.com/nsfm/dualsense-ts |
| nipplejs | Touch joystick | https://github.com/yoannmoinet/nipplejs |
| sirv | Static file server | https://github.com/lukeed/sirv |

## Data pipeline (Python)

| Library | Used for | Link |
|---|---|---|
| Python | Pipeline language | https://www.python.org/ |
| GDAL | Raster reading and conversion | https://github.com/OSGeo/gdal |
| rasterio | Raster I/O | https://github.com/rasterio/rasterio |
| NumPy | Array maths | https://numpy.org/ |
| SciPy | Filtering and resampling | https://scipy.org/ |
| scikit-image | Image processing | https://scikit-image.org/ |
| Pillow | Image files | https://python-pillow.org/ |
| OWSLib | WMTS capabilities | https://github.com/geopython/OWSLib |
| pyproj | Map projections | https://github.com/pyproj4/pyproj |
| HTTPX | Downloads | https://www.python-httpx.org/ |

## Runtime, testing and hosting

| Tool | Used for | Link |
|---|---|---|
| Node.js | Static server and automated tests (`node --test`) | https://nodejs.org/ |
| Vite | Dev server and build | https://github.com/vitejs/vite |
| Playwright | End-to-end browser tests | https://github.com/microsoft/playwright |
| Git and GitHub | Version control (private repository) | https://github.com/ |

## Non-NASA data and papers

| Resource | Used for | Link |
|---|---|---|
| Global CTX mosaic of Mars (Murray Lab, Caltech), served by Esri OnMars | Planner base map | https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer?f=pjson |
| University of Arizona HiRISE operations | Hosts the HiRISE DTMs and orthoimages | https://www.uahirise.org/ |
| USGS Astrogeology: Phobos Viking global mosaic | Phobos surface map | https://astrogeology.usgs.gov/search/map/phobos_viking_global_mosaic_5m |
| USGS Astrogeology: Mars and satellites map products | Deimos map | https://fdp.astrogeology.usgs.gov/fdp/mars/ |
| PDS Geosciences Node, Washington University in St. Louis | Hosts MOLA | https://pds-geosciences.wustl.edu/ |
| Yale Bright Star Catalogue | Night-sky stars | http://tdc-www.harvard.edu/catalogs/bsc5.html |
| HYG star database | Night-sky stars | https://github.com/astronexus/HYG-Database |
| Hassler et al. 2014, Mars' surface radiation environment measured with Curiosity (Science) | Dose rate | https://doi.org/10.1126/science.1244797 |
| Millan et al. 2022, Sedimentary organics in Glen Torridon, Gale crater (JGR Planets) | Science context | https://doi.org/10.1029/2021JE007107 |
| Allison & McEwen 2000, A post-Pathfinder evaluation of areocentric solar coordinates (Planet. Space Sci.) | Mars24 algorithm | https://doi.org/10.1016/S0032-0633(99)00092-6 |
| Archinal et al. 2011, IAU WGCCRE report 2009 | Mars pole and prime meridian | https://doi.org/10.1007/s10569-010-9320-4 |
| Thomas 1989, The shapes of small satellites (Icarus) | Phobos and Deimos radii | https://doi.org/10.1016/0019-1035(89)90089-4 |

## AI coding assistants

AI tools helped build the app, pipeline scripts and documents. The team chose the challenge, site and science goal and reviewed every result. The full log is in [AI_USE.md](./AI_USE.md).

| Tool | Link |
|---|---|
| Claude Code (Anthropic) | https://www.claude.com/product/claude-code |
| Google Antigravity and Gemini | https://antigravity.google/ |
| Cursor, with the Grok model | https://cursor.com/ |
