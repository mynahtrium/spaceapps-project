/**
 * Martian Mappers app shell (`web/app.js`): Plan (2D mission planner), Globe (pick a site), and
 * Rehearse 3D (walk the planned route on measured terrain).
 */

import { loadAllProjectData } from "./shared/data-loader.js";
import { initPlannerView } from "./planner/planner-view.js";
import { renderSourcesHtml } from "./shared/sources.js";
import { GRAPHICS_LEVELS } from "./shared/graphics-profile.js";
import { loadDevSettings, saveDevSettings } from "./shared/dev-settings.js";

const $ = (s) => document.querySelector(s);
const views = { plan: $("#plan-view"), globe: $("#orbit-view"), rehearse: $("#rehearse-view") };
let current = "plan";
let planner = null;
let eva = null;
let evaLoading = null;
let orbit = null;

function openModal(title, html) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = html;
  $("#modal-backdrop").hidden = false;
  $("#modal-close").focus();
}
$("#modal-close").addEventListener("click", () => ($("#modal-backdrop").hidden = true));
$("#modal-backdrop").addEventListener("click", (e) => {
  if (e.target.id === "modal-backdrop") $("#modal-backdrop").hidden = true;
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#modal-backdrop").hidden) $("#modal-backdrop").hidden = true;
});

async function ensureEva(data) {
  if (eva) return eva;
  if (!evaLoading) {
    evaLoading = import("./eva/eva-view.js")
      .then(({ initEvaView }) => initEvaView(views.rehearse, data))
      .then((api) => (eva = api))
      .catch((err) => {
        evaLoading = null;
        views.rehearse.insertAdjacentHTML("beforeend", `<div class="view-error">3D view failed to start: ${String(err?.message || err)}</div>`);
        throw err;
      });
  }
  return evaLoading;
}

async function ensureOrbit(data) {
  if (orbit) return orbit;
  const { initOrbitView } = await import("./orbit/orbit-view.js");
  orbit = initOrbitView(views.globe, {
    demoSafe: data.demoSafe,
    getPlayerLonLat: () => {
      const s = planner?.getMission()?.stops?.[0];
      return s ? { lon: s.lon, lat: s.lat } : null;
    },
    onLand: (lon, lat) => {
      switchView("plan", data);
      planner?.focus(lon, lat);
    },
  });
  return orbit;
}

async function switchView(name, data) {
  current = name;
  for (const [k, el] of Object.entries(views)) el.classList.toggle("active", k === name);
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  if (name !== "globe") orbit?.hide?.();
  if (name !== "rehearse") eva?.hide();
  if (name === "plan") planner?.show();
  if (name === "globe") (await ensureOrbit(data)).show?.();
  if (name === "rehearse") {
    const api = await ensureEva(data);
    if (current === "rehearse") api.show();
  }
}

function graphicsPanel() {
  const cfg = loadDevSettings();
  const opts = GRAPHICS_LEVELS.map((l) => `<option value="${l}" ${cfg.quality === l ? "selected" : ""}>${l}</option>`).join("");
  openModal(
    "Graphics",
    `<label class="field">Quality <select id="gfx-quality">${opts}</select></label>
     <p class="dim">Affects the 3D rehearsal only: render resolution, shadows, and how far the 1 m terrain streams.</p>`
  );
  $("#gfx-quality").addEventListener("change", (e) => saveDevSettings({ quality: e.target.value }));
}

async function boot() {
  const data = await loadAllProjectData();
  $("#badge-demo").hidden = !data.demoSafe;
  const banner = data.alerts?.banner;
  if (banner?.text) {
    const el = $("#spacewx");
    el.hidden = false;
    el.className = `spacewx spacewx-${banner.level || "info"}`;
    el.textContent = `Space weather · ${banner.text}`;
  }
  $("#btn-sources").addEventListener("click", () => openModal("Sources & limits", renderSourcesHtml(data.sources)));
  $("#btn-settings").addEventListener("click", graphicsPanel);
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => switchView(t.dataset.view, data)));

  planner = await initPlannerView(views.plan, data, {
    demoSafe: data.demoSafe,
    canRehearse: (lon, lat) => {
      const b = data.costMap?.bounds;
      return Boolean(b) && lon >= b.west_lon_deg && lon <= b.east_lon_deg && lat >= b.south_lat_deg && lat <= b.north_lat_deg;
    },
    onRehearse: async ({ mission, route, stops }) => {
      await switchView("rehearse", data);
      await eva.setMission({ route, stops, startDate: mission.startUtc });
      return null;
    },
  });

  // keep a handle for debugging in the browser console
  window.__MM_APP__ = {
    data,
    get planner() {
      return planner;
    },
    get eva() {
      return eva;
    },
  };
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML("beforeend", `<div class="view-error">Start-up failed: ${String(err?.message || err)}</div>`);
});
