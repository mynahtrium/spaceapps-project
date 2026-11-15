/**
 * Sources & Honesty panel content (`web/shared/sources.js`). Every data set the app draws or computes
 * with, with its fetch date, plus the limits a planner must know. Keep in step with docs/DATA_SOURCES.md.
 */

export const STATIC_SOURCES = [
  { group: "Terrain", name: "HiRISE DTM DTEEC_009149_1750_009294_1750_U01 (MRO), 1 m", url: "https://hirise-pds.lpl.arizona.edu/PDS/DTM/PSP/ORB_009100_009199/PSP_009149_1750_PSP_009294_1750/", date: "2026-11-15", use: "3D terrain and routing in the Gale corridor" },
  { group: "Terrain", name: "HiRISE orthoimage PSP_009149_1750_RED_A_01_ORTHO (MRO), 25 cm", url: "https://hirise-pds.lpl.arizona.edu/PDS/DTM/PSP/ORB_009100_009199/PSP_009149_1750_PSP_009294_1750/", date: "2026-11-15", use: "ground imagery (shown at ~0.5 m)" },
  { group: "Terrain", name: "HiRISE DTMs at Jezero, Gusev, Meridiani, Elysium, Ares Vallis (MRO), 2 m windows", url: "https://hirise-pds.lpl.arizona.edu/PDS/DTM/", date: "2026-11-15", use: "routing and slope at those landing sites" },
  { group: "Terrain", name: "MGS MOLA MEGDR global topography (16 px/deg, averaged to 8)", url: "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.lbl", date: "2026-11-15", use: "far horizon in 3D (Gale rim, Mount Sharp); routing outside HiRISE coverage" },
  { group: "Imagery", name: "Viking MDIM 2.1 colour mosaic (NASA / USGS) via NASA Mars Trek", url: "https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/WMTSCapabilities.xml", date: "2026-11-14", use: "globe, planner base map, far terrain colour" },
  { group: "Imagery", name: "MGS MOLA colour shaded relief via NASA Mars Trek", url: "https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/WMTSCapabilities.xml", date: "2026-11-14", use: "globe and planner relief layer" },
  { group: "Imagery", name: "CTX global mosaic (Murray Lab, Caltech), served by Esri OnMars", url: "https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer?f=pjson", date: "live (online mode only)", use: "planner base map, ~5 m" },
  { group: "Imagery", name: "Mars Odyssey THEMIS Day IR 100 m via NASA Mars Trek", url: "https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml", date: "live (online mode only)", use: "planner thermal layer" },
  { group: "Imagery", name: "USGS Phobos Viking mosaic (DLR control) and Deimos map", url: "https://astrogeology.usgs.gov/search/map/phobos_viking_global_mosaic_5m", date: "2026-11-15", use: "moon surfaces in the 3D sky" },
  { group: "Curiosity", name: "MSL waypoints (NASA Mars Maps)", url: "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json", date: "2026-11-14", use: "Gale stop coordinates; DTM registration (residual 2.35 m)" },
  { group: "Curiosity", name: "REMS daily weather feed (NASA / Centro de Astrobiología)", url: "https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json", date: "2026-11-14", use: "latest-sol weather line (not the mission day)" },
  { group: "Space weather", name: "NASA CCMC DONKI (WSA-Enlil, CME, SEP, GST) via api.nasa.gov", url: "https://ccmc.gsfc.nasa.gov/tools/DONKI/", date: "2026-11-14", use: "space-weather banner" },
  { group: "Models", name: "Mars24 sunclock algorithm (NASA GISS; Allison & McEwen 2000)", url: "https://www.giss.nasa.gov/tools/mars24/help/algorithm.html", date: "algorithm", use: "local solar time, sun position, Ls" },
  { group: "Models", name: "JPL SSD planetary satellite mean elements", url: "https://ssd.jpl.nasa.gov/sats/elem/", date: "algorithm", use: "Phobos and Deimos positions (mean elements, not SPICE)" },
  { group: "Models", name: "Yale Bright Star Catalogue / HYG", url: "http://tdc-www.harvard.edu/catalogs/bsc5.html", date: "catalogue", use: "night sky" },
  { group: "Limits", name: "NASA EVA Lunar Surface Concept of Operations", url: "https://www.nasa.gov/wp-content/uploads/2020/01/topic_1-_eva_lunar_surface_concept_of_operations.pdf", date: "2026-11-12", use: "slope limits 10 / 15 / 20° (stand-ins)" },
  { group: "Limits", name: "NASA Space Exploration Vehicle fact sheet FS-2011-08-045-JSC", url: "https://www.nasa.gov/wp-content/uploads/2015/08/464826main_sev_factsheet_508.pdf", date: "2026-11-15", use: "rover speed ~10 km/h; Apollo walk-back limit ~6 miles" },
  { group: "Limits", name: "Hassler et al. 2014, Mars' surface radiation environment (Curiosity RAD)", url: "https://doi.org/10.1126/science.1244797", date: "paper", use: "dose rate 0.64 ± 0.12 mSv/day" },
];

export const HONESTY = [
  "Slope limits (green ≤ 10°, amber 10–15°, red 15–20°, blocked > 20°) are NASA lunar EVA values used as stand-ins. No Mars-specific limit is published.",
  "DTM slope matches Curiosity's measured tilt only weakly (5 m medians 9.0° vs 8.6° over 176 waypoints). Keep a safety margin.",
  "Radiation is a time problem, not a place problem: dose = 0.64 mSv/day × EVA time. Solar particle events come on top; check DONKI.",
  "Walking pace, stop times and the EVA limit are planner inputs, not data. No validated Mars suited-walking speed is published.",
  "Outside HiRISE DTMs the only global elevation is MOLA at ~7.4 km. Routes there show large-scale relief only and are flagged.",
  "HiRISE ground imagery is the greyscale RED band with a colour tint. The tint is not measured colour.",
  "Sky colour is a rendering gradient with a fixed dust optical depth (τ = 0.5), not a measured sky.",
  "Gale crater is a rover site, not a human landing candidate. The scenario is: if a crew visited where Curiosity studied Mount Sharp.",
];

export function renderSourcesHtml(dataSources = []) {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const rows = STATIC_SOURCES.map(
    (s) => `<tr><td>${esc(s.group)}</td><td><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></td><td>${esc(s.use)}</td><td>${esc(s.date)}</td></tr>`
  ).join("");
  const extra = dataSources
    .filter((s) => !STATIC_SOURCES.some((x) => x.url === s.url))
    .map((s) => `<tr><td>${esc(s.dataset)}</td><td>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>` : esc(s.name)}</td><td>${esc(s.note)}</td><td>${esc(s.fetchDate)}</td></tr>`)
    .join("");
  return `
    <h3>Limits you must know</h3>
    <ul class="honesty">${HONESTY.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>
    <h3>Data and models</h3>
    <table class="sources"><tr><th>Group</th><th>Source</th><th>Used for</th><th>Fetched</th></tr>${rows}${extra}</table>
    <p class="dim">AI coding assistants helped write this software; see docs/AI_USE.md. Team members are not named here.</p>`;
}
