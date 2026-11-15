/**
 * EVA mission planner (`web/planner/planner-view.js`): plan a surface walk or drive on real Mars data.
 *
 * Map layers (all real; offline mode uses only the bundled ones):
 *   - CTX global mosaic, ~5 m (Murray Lab / Caltech, served by Esri OnMars)          online
 *   - Viking MDIM 2.1 colour, 232 m; THEMIS Day IR 100 m; MOLA shaded relief (NASA Mars Trek)  online
 *   - Viking MDIM 2.1 colour and MOLA shaded relief, 4096 x 2048 global (bundled)      offline
 *   - HiRISE orthoimage over the Gale corridor (bundled, colour-tinted greyscale)      offline
 *   - Slope tiers computed in the browser from the HiRISE DTMs                        offline
 */

import { createMap2D } from "./map2d.js";
import { findRoute, sampleGrid, slopeGrid } from "./routing.js";
import { loadTerrainSources } from "./terrain-sources.js";
import {
  DEFAULT_PARAMS,
  SOURCES,
  STOP_KINDS,
  evaluateMission,
  makeStopId,
  missionToRoute,
  missionToStops,
  newMission,
  parseMission,
  syncLegs,
} from "./mission.js";
import { sunStateAt, formatHoursHM } from "../hud/MarsEphemeris.js";
import { sampleMolaM } from "../map/RealSiteTerrain.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtKm = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
const fmtDur = (s) => {
  if (!Number.isFinite(s)) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return `${h} h ${String(m).padStart(2, "0")} min`;
};
const fmtLL = (lon, lat) => `${Math.abs(lat).toFixed(5)}°${lat < 0 ? "S" : "N"} ${(((lon % 360) + 360) % 360).toFixed(5)}°E`;
const TIER_RGBA = { green: [52, 211, 153, 90], amber: [251, 191, 36, 130], red: [248, 113, 113, 150], blocked: [127, 29, 29, 190] };

function panelTemplate() {
  return `
  <div class="pl-root">
    <canvas class="pl-map"></canvas>
    <div class="pl-hover" data-k="hover">—</div>
    <div class="pl-layers" data-k="layers"></div>
    <aside class="pl-side">
      <div class="pl-sec">
        <input class="pl-name" data-k="name" aria-label="Mission name" />
        <div class="pl-row">
          <label>Site <select data-k="site"></select></label>
        </div>
        <div class="pl-row">
          <label>EVA start (UTC) <input type="datetime-local" step="60" data-k="start" /></label>
        </div>
        <div class="pl-row dim" data-k="startInfo">—</div>
      </div>
      <div class="pl-sec">
        <div class="pl-h">Stops <span class="dim">click the map to add</span></div>
        <div class="pl-tools">
          <button class="btn" data-a="add" aria-pressed="false">Add stops</button>
          <button class="btn" data-a="routeAll">Route all legs</button>
          <button class="btn" data-a="preset">Gale preset</button>
          <button class="btn" data-a="clear">Clear</button>
        </div>
        <ol class="pl-stops" data-k="stops"></ol>
      </div>
      <div class="pl-sec">
        <div class="pl-h">Parameters</div>
        <div class="pl-params" data-k="params"></div>
      </div>
      <div class="pl-sec">
        <div class="pl-h">Plan</div>
        <div data-k="totals" class="pl-totals">—</div>
        <canvas class="pl-profile" data-k="profile" height="110"></canvas>
        <table class="pl-timeline" data-k="timeline"></table>
        <ul class="pl-issues" data-k="issues"></ul>
      </div>
      <div class="pl-sec pl-actions">
        <button class="btn primary" data-a="rehearse">Rehearse in 3D</button>
        <button class="btn" data-a="export">Export plan</button>
        <label class="btn">Import plan<input type="file" accept="application/json,.json" data-k="import" hidden /></label>
      </div>
      <div class="pl-sec dim pl-foot" data-k="foot"></div>
    </aside>
  </div>`;
}

/**
 * @param root view element
 * @param data loadAllProjectData() output
 * @param opts { demoSafe, onRehearse(mission) -> Promise<string|null>, canRehearse(lon, lat) -> bool }
 */
export async function initPlannerView(root, data, { demoSafe = false, onRehearse = null, canRehearse = null } = {}) {
  root.insertAdjacentHTML("beforeend", panelTemplate());
  const q = (k) => root.querySelector(`[data-k="${k}"]`);
  const btn = (a) => root.querySelector(`[data-a="${a}"]`);
  const terr = await loadTerrainSources(data);
  const slopeCache = new Map();
  const slopeOf = (g) => {
    let s = slopeCache.get(g.id);
    if (!s || g.id === "mola") {
      s = slopeGrid(g);
      if (g.id !== "mola") slopeCache.set(g.id, s);
    }
    return s;
  };

  // ---------- mission state ----------
  let mission = newMission({ name: "Gale EVA plan" });
  let selectedId = null;
  let addMode = false;
  let result = null;
  const STORAGE_KEY = "mm-planner-mission";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const p = parseMission(saved);
      if (p.ok) mission = p.mission;
    }
  } catch {
    /* private mode: start fresh */
  }
  const persist = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mission));
    } catch {
      /* not essential */
    }
  };

  // ---------- map ----------
  const map = createMap2D(root.querySelector(".pl-map"), {
    center: [137.389, -4.771],
    metersPerPixel: 4,
    onClick: (lon, lat) => onMapClick(lon, lat),
    onHover: (lon, lat) => hover(lon, lat),
  });

  const corridorBounds = (() => {
    const b = data.costMap?.bounds;
    return b ? { west: b.west_lon_deg, east: b.east_lon_deg, south: b.south_lat_deg, north: b.north_lat_deg } : null;
  })();
  const LAYERS = [];
  const addLayer = (L, on = true) => {
    L.visible = on;
    LAYERS.push(L);
    map.addLayer(L);
  };
  // bundled (offline) global mosaics
  addLayer({ kind: "image", id: "viking-global", label: "Viking MDIM 2.1 colour (5 km/px, bundled)", url: "./assets/mars-globe/mars-viking-color-4k.jpg", bounds: { west: -180, east: 180, south: -90, north: 90 } });
  addLayer({ kind: "image", id: "mola-global", label: "MOLA shaded relief (bundled)", url: "./assets/mars-globe/mars-mola-shade-4k.jpg", bounds: { west: -180, east: 180, south: -90, north: 90 }, opacity: 1 }, false);
  if (!demoSafe) {
    addLayer({ kind: "tiles", id: "viking", label: "Viking MDIM 2.1 colour 232 m (Mars Trek)", tilePx: 256, maxZ: 7, url: (z, r, c) => `https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/${z}/${r}/${c}.jpg` });
    addLayer({ kind: "tiles", id: "ctx", label: "CTX mosaic ~5 m (Murray Lab / Esri OnMars)", tilePx: 512, maxZ: 12, url: (z, r, c) => `https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/${z}/${r}/${c}` });
    addLayer({ kind: "tiles", id: "themis", label: "THEMIS Day IR 100 m (Mars Trek)", tilePx: 256, maxZ: 9, opacity: 0.85, url: (z, r, c) => `https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/default/default028mm/${z}/${r}/${c}.png` }, false);
  }
  if (data.assets?.corridorBaseUrl && corridorBounds) {
    addLayer({ kind: "image", id: "hirise", label: "HiRISE ortho, Gale corridor (~2 m, tinted)", url: `${data.assets.corridorBaseUrl}/overview.jpg`, bounds: await corridorManifestBounds(data.assets.corridorBaseUrl, corridorBounds) });
  }
  // slope tiers from every HiRISE DTM grid
  for (const g of terr.grids) {
    addLayer({ kind: "canvas", id: `slope-${g.id}`, group: "slope", label: "", canvas: null, bounds: { west: g.west, east: g.east, south: g.south, north: g.north }, grid: g, opacity: 1 }, false);
  }
  LAYERS.push({ id: "slope", label: "Slope tiers from HiRISE DTMs (lunar stand-in limits)", virtual: true, visible: false });

  function buildSlopeCanvas(g) {
    const s = slopeOf(g);
    const c = document.createElement("canvas");
    c.width = g.nx;
    c.height = g.nz;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(g.nx, g.nz);
    const lim = mission.params.slopeLimitDeg;
    const caut = mission.params.slopeCautionDeg;
    for (let i = 0; i < g.nx * g.nz; i++) {
      const v = s[i];
      const t = !Number.isFinite(v) ? null : v <= 10 ? "green" : v <= caut ? "amber" : v <= lim ? "red" : "blocked";
      const col = t ? TIER_RGBA[t] : [0, 0, 0, 0];
      img.data.set(col, i * 4);
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function renderLayerPanel() {
    const el = q("layers");
    el.innerHTML = LAYERS.filter((L) => !L.group)
      .map((L) => `<label><input type="checkbox" data-layer="${L.id}" ${L.visible ? "checked" : ""}/> ${esc(L.label)}</label>`)
      .join("");
    el.querySelectorAll("input").forEach((inp) =>
      inp.addEventListener("change", () => {
        const id = inp.dataset.layer;
        const L = LAYERS.find((x) => x.id === id);
        L.visible = inp.checked;
        if (id === "slope") {
          for (const S of LAYERS.filter((x) => x.group === "slope")) {
            if (inp.checked && !S.canvas) S.canvas = buildSlopeCanvas(S.grid);
            map.setLayerVisible(S.id, inp.checked);
          }
        } else map.setLayerVisible(id, inp.checked);
      })
    );
  }
  renderLayerPanel();

  // ---------- vector overlay: legs and stops ----------
  map.addDrawHook((ctx, m) => {
    for (const leg of mission.legs) {
      ctx.beginPath();
      leg.coords.forEach(([lon, lat], k) => {
        const [x, y] = m.project(lon, lat);
        if (k) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.lineWidth = 3;
      ctx.strokeStyle = leg.mode === "drive" ? "#f59e0b" : "#38bdf8";
      ctx.setLineDash(leg.routed ? [] : [7, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    mission.stops.forEach((s, k) => {
      const [x, y] = m.project(s.lon, s.lat);
      ctx.beginPath();
      ctx.arc(x, y, s.id === selectedId ? 9 : 7, 0, Math.PI * 2);
      ctx.fillStyle = s.kind === "rover" ? "#f59e0b" : s.kind === "science" ? "#e5e7eb" : "#22c55e";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#0b0d10";
      ctx.stroke();
      ctx.fillStyle = "#0b0d10";
      ctx.font = "bold 10px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(String(k + 1), x, y + 3.5);
      ctx.textAlign = "left";
      ctx.fillStyle = "#f8fafc";
      ctx.font = "12px ui-sans-serif, system-ui";
      ctx.fillText(s.name, x + 11, y - 9);
    });
  });

  // ---------- elevation for any point (finest real grid, else MOLA) ----------
  function elevAt(lon, lat) {
    const g = terr.at(lon, lat);
    if (g) {
      const v = sampleGrid(g, lon, lat);
      if (v != null) return v;
    }
    return sampleMolaM(lat, lon);
  }
  function hover(lon, lat) {
    const g = terr.at(lon, lat);
    let txt = fmtLL(lon, lat);
    if (g) {
      const e = sampleGrid(g, lon, lat);
      const s = sampleGrid(g, lon, lat, slopeOf(g));
      txt += ` · ${e != null ? `${Math.round(e)} m` : "no data"} · slope ${s != null ? `${s.toFixed(1)}°` : "—"} · ${g.label}`;
    } else {
      const m = sampleMolaM(lat, lon);
      txt += ` · ${m != null ? `${Math.round(m)} m` : "—"} · MOLA ~7.4 km (no HiRISE DTM here)`;
    }
    q("hover").textContent = `${txt} · ${(map.metersPerPixel() * 1).toFixed(1)} m/px`;
  }

  // ---------- stops ----------
  function onMapClick(lon, lat) {
    const hit = mission.stops.find((s) => {
      const [x, y] = map.project(s.lon, s.lat);
      const [cx, cy] = map.project(lon, lat);
      return Math.hypot(x - cx, y - cy) < 10;
    });
    if (hit) {
      selectedId = hit.id;
      render();
      return;
    }
    if (!addMode) return;
    const n = mission.stops.length;
    mission.stops.push({ id: makeStopId(), name: n === 0 ? "EVA start" : `Stop ${n + 1}`, kind: n === 0 ? "start" : "science", lon, lat, dwellMin: n === 0 ? 0 : mission.params.defaultDwellMin });
    changed();
  }

  async function routeLeg(leg) {
    const a = mission.stops.find((s) => s.id === leg.from);
    const b = mission.stops.find((s) => s.id === leg.to);
    const g = terr.pick([a.lon, a.lat], [b.lon, b.lat]);
    if (!g) return { ok: false, reason: "no-elevation-data" };
    const r = findRoute(g, [a.lon, a.lat], [b.lon, b.lat], { slopeLimitDeg: mission.params.slopeLimitDeg, slope: slopeOf(g) });
    if (r.ok) {
      leg.coords = r.coords;
      leg.routed = true;
      leg.grid = { id: g.id, label: g.label, resolutionM: Math.round(g.resolutionM * 10) / 10, coarse: Boolean(g.coarse) };
    } else {
      leg.routed = false;
      leg.routeError = r.reason;
    }
    return r;
  }

  function changed() {
    syncLegs(mission);
    persist();
    render();
  }

  // ---------- rendering of the side panel ----------
  const SITE_OPTIONS = [{ id: "gale-hirise", label: "Gale crater · HiRISE corridor (1 m / 5 m)" }, ...terr.grids.filter((g) => g.id !== "gale-hirise").map((g) => ({ id: g.id, label: g.label }))];
  q("site").innerHTML = SITE_OPTIONS.map((o) => `<option value="${o.id}">${esc(o.label)}</option>`).join("");
  q("site").addEventListener("change", () => {
    const g = terr.grids.find((x) => x.id === q("site").value);
    if (g) map.fitBounds(g);
  });

  function paramRow(key, label, unit, note, step = "any") {
    return `<label class="pl-param"><span>${esc(label)}</span><input type="number" step="${step}" min="0" data-p="${key}" value="${mission.params[key]}" /> <span class="dim">${esc(unit)}</span><small class="dim">${note}</small></label>`;
  }

  function renderParams() {
    q("params").innerHTML = [
      paramRow("walkPaceKmh", "Walking pace", "km/h", "planner input, not data: no validated Mars suited-walking speed is published"),
      paramRow("sevSpeedKmh", "Rover (SEV) speed", "km/h", `<a href="${SOURCES.sevSpeed.url}" target="_blank" rel="noopener">NASA SEV fact sheet</a>: about 10 km/h`),
      paramRow("defaultDwellMin", "Time at each science stop", "min", "planner input"),
      paramRow("evaLimitH", "EVA duration limit", "h", "planner input for this plan"),
      paramRow("walkBackLimitKm", "Walk-back limit", "km", `<a href="${SOURCES.walkBack.url}" target="_blank" rel="noopener">NASA SEV fact sheet</a>: Apollo walk-back about 6 miles`),
      paramRow("slopeLimitDeg", "Slope limit", "°", `<a href="${SOURCES.slope.url}" target="_blank" rel="noopener">NASA lunar EVA ConOps</a>, stand-in`),
      paramRow("slopeCautionDeg", "Slope caution", "°", "lunar stand-in"),
    ].join("");
    q("params").querySelectorAll("input").forEach((inp) =>
      inp.addEventListener("change", () => {
        const v = Number(inp.value);
        if (Number.isFinite(v) && v >= 0) mission.params[inp.dataset.p] = v;
        if (inp.dataset.p.startsWith("slope")) for (const S of LAYERS.filter((x) => x.group === "slope")) S.canvas = S.visible ? buildSlopeCanvas(S.grid) : null;
        changed();
      })
    );
  }

  function renderStops() {
    const el = q("stops");
    el.innerHTML = mission.stops
      .map((s, k) => {
        const leg = mission.legs[k];
        const legHtml = leg
          ? `<div class="pl-leg">
              <select data-leg="${k}" data-f="mode"><option value="walk" ${leg.mode === "walk" ? "selected" : ""}>walk</option><option value="drive" ${leg.mode === "drive" ? "selected" : ""}>drive (SEV)</option></select>
              <button class="btn sm" data-leg="${k}" data-f="route">${leg.routed ? "re-route" : "route"}</button>
              <span class="dim">${leg.routed ? `on ${esc(leg.grid?.label || "")}` : leg.routeError ? `no route: ${esc(leg.routeError)}` : "straight line"}</span>
            </div>`
          : "";
        return `<li class="${s.id === selectedId ? "sel" : ""}" data-id="${s.id}">
          <div class="pl-stop">
            <input data-f="name" value="${esc(s.name)}" aria-label="Stop name" />
            <select data-f="kind">${STOP_KINDS.map((kk) => `<option ${kk === s.kind ? "selected" : ""}>${kk}</option>`).join("")}</select>
            <input data-f="dwellMin" type="number" min="0" step="5" value="${s.dwellMin ?? 0}" title="minutes at this stop" />
            <button class="btn sm" data-f="up" title="Move up">↑</button>
            <button class="btn sm" data-f="del" title="Remove">✕</button>
          </div>
          <div class="dim">${fmtLL(s.lon, s.lat)}${s.source ? ` · ${esc(s.source)}` : ""}</div>
          ${legHtml}
        </li>`;
      })
      .join("");
    el.querySelectorAll("li").forEach((li) => {
      const s = mission.stops.find((x) => x.id === li.dataset.id);
      li.addEventListener("click", (e) => {
        if (e.target.closest("input,select,button")) return;
        selectedId = s.id;
        map.flyTo(s.lon, s.lat);
        render();
      });
      li.querySelector('[data-f="name"]').addEventListener("change", (e) => {
        s.name = e.target.value || s.name;
        changed();
      });
      li.querySelector('[data-f="kind"]').addEventListener("change", (e) => {
        s.kind = e.target.value;
        changed();
      });
      li.querySelector('[data-f="dwellMin"]').addEventListener("change", (e) => {
        s.dwellMin = Math.max(0, Number(e.target.value) || 0);
        changed();
      });
      li.querySelector('[data-f="up"]').addEventListener("click", () => {
        const i = mission.stops.indexOf(s);
        if (i > 0) [mission.stops[i - 1], mission.stops[i]] = [mission.stops[i], mission.stops[i - 1]];
        changed();
      });
      li.querySelector('[data-f="del"]').addEventListener("click", () => {
        mission.stops = mission.stops.filter((x) => x !== s);
        changed();
      });
    });
    el.querySelectorAll("[data-leg]").forEach((n) => {
      const leg = mission.legs[Number(n.dataset.leg)];
      if (n.dataset.f === "mode") n.addEventListener("change", () => ((leg.mode = n.value), changed()));
      if (n.dataset.f === "route")
        n.addEventListener("click", async () => {
          n.disabled = true;
          n.textContent = "routing…";
          await new Promise((r) => setTimeout(r, 10));
          await routeLeg(leg);
          changed();
        });
    });
  }

  function drawProfile() {
    const c = q("profile");
    const w = (c.width = c.clientWidth * (window.devicePixelRatio || 1));
    const h = (c.height = 110 * (window.devicePixelRatio || 1));
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    const pts = [];
    let off = 0;
    for (const L of result?.legs || []) {
      for (const p of L.pts) if (p.elev != null) pts.push({ s: off + p.s, e: p.elev, mode: L.mode });
      off += L.lengthM;
    }
    if (pts.length < 2) return;
    const e0 = Math.min(...pts.map((p) => p.e));
    const e1 = Math.max(...pts.map((p) => p.e));
    const X = (s) => (s / off) * (w - 8) + 4;
    const Y = (e) => h - 14 - ((e - e0) / Math.max(1, e1 - e0)) * (h - 28);
    ctx.lineWidth = 2;
    for (let k = 1; k < pts.length; k++) {
      ctx.strokeStyle = pts[k].mode === "drive" ? "#f59e0b" : "#38bdf8";
      ctx.beginPath();
      ctx.moveTo(X(pts[k - 1].s), Y(pts[k - 1].e));
      ctx.lineTo(X(pts[k].s), Y(pts[k].e));
      ctx.stroke();
    }
    ctx.fillStyle = "#94a3b8";
    ctx.font = `${10 * (window.devicePixelRatio || 1)}px ui-monospace, monospace`;
    ctx.fillText(`${Math.round(e1)} m`, 6, 12 * (window.devicePixelRatio || 1));
    ctx.fillText(`${Math.round(e0)} m · ${fmtKm(off)}`, 6, h - 3);
  }

  function renderResult() {
    const sunAt = (date, lon, lat) => sunStateAt(date, { latDeg: lat, lonEastDeg: lon });
    result = mission.stops.length ? evaluateMission(mission, { elevAt, sunAt }) : null;
    if (!result) {
      q("totals").textContent = "Add at least two stops.";
      q("timeline").innerHTML = "";
      q("issues").innerHTML = "";
      drawProfile();
      return;
    }
    const t = result.totals;
    const asc = result.legs.reduce((a, l) => a + l.ascent, 0);
    const desc = result.legs.reduce((a, l) => a + l.descent, 0);
    q("totals").innerHTML = `
      <div><b>${fmtKm(t.walkM + t.driveM)}</b> total · walk ${fmtKm(t.walkM)} · drive ${fmtKm(t.driveM)}</div>
      <div>+${Math.round(asc)} m / −${Math.round(desc)} m elevation</div>
      <div><b>${fmtDur(t.totalS)}</b> EVA (walk ${fmtDur(t.walkS)} at the planned pace, drive ${fmtDur(t.driveS)})</div>
      <div>Dose ≈ <b>${t.doseMsv.toFixed(3)} mSv</b> <span class="dim">= 0.64 mSv/day × duration (<a href="${SOURCES.dose.url}" target="_blank" rel="noopener">Hassler 2014</a>); excludes solar events</span></div>`;
    q("timeline").innerHTML =
      `<tr><th>#</th><th>stop</th><th>arrive</th><th>LTST</th><th>sun el</th></tr>` +
      result.timeline
        .map((ev, k) => {
          const el = ev.sun ? (ev.sun.elevationRad * 180) / Math.PI : NaN;
          return `<tr class="${el < 0 ? "bad" : ""}"><td>${k + 1}</td><td>${esc(ev.name)}</td><td>+${fmtDur(ev.arriveS)}</td><td>${ev.sun ? formatHoursHM(ev.sun.ltstHours) : "—"}</td><td>${Number.isFinite(el) ? `${el.toFixed(0)}°` : "—"}</td></tr>`;
        })
        .join("");
    q("issues").innerHTML = result.issues.length
      ? result.issues.map((i) => `<li class="iss-${i.level}">${esc(i.text)}</li>`).join("")
      : `<li class="iss-ok">No constraint violations for these inputs.</li>`;
    drawProfile();
  }

  function renderHeader() {
    q("name").value = mission.name;
    const d = new Date(mission.startUtc);
    q("start").value = Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 16) : "";
    const s0 = mission.stops[0];
    if (s0 && Number.isFinite(d.getTime())) {
      const sun = sunStateAt(d, { latDeg: s0.lat, lonEastDeg: s0.lon });
      q("startInfo").textContent = `At the start: LTST ${formatHoursHM(sun.ltstHours)}, Ls ${sun.lsDeg.toFixed(1)}°, sun ${((sun.elevationRad * 180) / Math.PI).toFixed(1)}° (Mars24)`;
    } else q("startInfo").textContent = "Add a start stop to see local solar time.";
  }

  function render() {
    renderHeader();
    renderStops();
    renderResult();
    map.invalidate();
  }

  // ---------- header and actions ----------
  q("name").addEventListener("change", () => ((mission.name = q("name").value || mission.name), changed()));
  q("start").addEventListener("change", () => {
    const v = q("start").value;
    if (v) mission.startUtc = new Date(`${v}:00Z`).toISOString();
    changed();
  });
  btn("add").addEventListener("click", () => {
    addMode = !addMode;
    btn("add").setAttribute("aria-pressed", String(addMode));
    btn("add").classList.toggle("active", addMode);
    root.querySelector(".pl-map").style.cursor = addMode ? "crosshair" : "";
  });
  btn("clear").addEventListener("click", () => {
    if (!mission.stops.length || confirm("Remove all stops from this plan?")) {
      mission.stops = [];
      changed();
    }
  });
  btn("routeAll").addEventListener("click", async () => {
    btn("routeAll").disabled = true;
    btn("routeAll").textContent = "Routing…";
    await new Promise((r) => setTimeout(r, 10));
    for (const leg of mission.legs) await routeLeg(leg);
    btn("routeAll").disabled = false;
    btn("routeAll").textContent = "Route all legs";
    changed();
  });
  btn("preset").addEventListener("click", () => {
    // Real Curiosity waypoint coordinates for the four Gale stops (data/demo/stops.json, cited there).
    const feats = data.stops?.features || [];
    if (!feats.length) return;
    mission = newMission({ name: "Gale crater: Glen Torridon drill sites", startUtc: mission.startUtc });
    const NAMES = {
      "stop-habitat": "EVA start (Curiosity Sol 4527 waypoint)",
      "stop-boxwork-bonus": "Boxwork unit (Curiosity Sol 4534 waypoint)",
    };
    mission.stops = feats.map((f, k) => ({
      id: f.properties.id,
      name: NAMES[f.properties.id] || f.properties.name || f.properties.id,
      kind: k === 0 ? "start" : "science",
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      dwellMin: k === 0 ? 0 : DEFAULT_PARAMS.defaultDwellMin,
      source: "Curiosity waypoint, NASA Mars Maps MSL_waypoints.json",
    }));
    const start = mission.stops[0];
    mission.stops.push({ ...start, id: `${start.id}-return`, name: `${start.name} (return)`, kind: "return", dwellMin: 0 });
    changed();
    map.fitBounds(boundsOf(mission.stops), 60);
  });
  btn("export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ ...mission, evaluation: result ? { totals: result.totals, issues: result.issues } : null }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${mission.name.replace(/[^\w-]+/g, "_") || "eva-plan"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  q("import").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const p = parseMission(await f.text());
    if (!p.ok) {
      alert(`Could not import: ${p.error}`);
      return;
    }
    mission = p.mission;
    changed();
    if (mission.stops.length) map.fitBounds(boundsOf(mission.stops), 60);
  });
  btn("rehearse").addEventListener("click", async () => {
    if (mission.stops.length < 2) return alert("Add at least two stops first.");
    const s0 = mission.stops[0];
    if (canRehearse && !canRehearse(s0.lon, s0.lat)) {
      return alert(
        "The 3D rehearsal needs 1 m HiRISE terrain at the start of the walk. It is available in the Gale corridor now; other sites follow as their HiRISE DTMs are added."
      );
    }
    const msg = await onRehearse?.({ mission, route: missionToRoute(mission), stops: missionToStops(mission) });
    if (msg) alert(msg);
  });

  q("foot").innerHTML =
    "Elevation and slope come from the finest real grid under each point: HiRISE DTMs where they exist, MGS MOLA (~7.4 km) elsewhere. " +
    "Slope limits are NASA lunar EVA values used as stand-ins. Dose counts the galactic cosmic-ray baseline only; check the DONKI banner for solar events.";

  function boundsOf(stops) {
    const lons = stops.map((s) => s.lon);
    const lats = stops.map((s) => s.lat);
    return { west: Math.min(...lons), east: Math.max(...lons), south: Math.min(...lats), north: Math.max(...lats) };
  }

  renderParams();
  syncLegs(mission);
  render();
  if (mission.stops.length) map.fitBounds(boundsOf(mission.stops), 60);
  else if (corridorBounds) map.fitBounds(corridorBounds, 30);

  return {
    show() {
      map.resize();
    },
    hide() {},
    /** Centre the planner on a point chosen on the globe. */
    focus(lon, lat) {
      const g = terr.at(lon, lat);
      if (g) map.fitBounds(g, 30);
      else map.flyTo(lon, lat, 200);
    },
    getMission: () => mission,
  };
}

async function corridorManifestBounds(baseUrl, fallback) {
  try {
    const m = await (await fetch(`${baseUrl}/manifest.json`)).json();
    const b = m.bounds;
    return { west: b.west_lon_deg, east: b.east_lon_deg, south: b.south_lat_deg, north: b.north_lat_deg };
  } catch {
    return fallback;
  }
}
