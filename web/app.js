/**
 * Martian Mappers Application Entry (`app.js`).
 *
 * Mounts unified First-Person Astronaut Visor:
 * - Shared void-filled HiRISE DEM (`loadDemSamplerFromData`)
 * - Shared `TileSourceRegistry` with `demoSafe` zero-network guard & attribution tracking
 * - 3D Terrain & Helmet HUD (`initHud3D` / `HighResMarsTerrainEngine`)
 * - 2D/2.5D Tactical MapLibre Dock (`initPlanner` / `MapLibreMarsAdapter` or `LegacyMapAdapter`)
 */

import { shouldUseHighResMap } from "./map/IMapAdapter.js";
import { TileSourceRegistry } from "./map/TileSourceRegistry.js";
import { initHud3D } from "./hud/hud3d.js";
import { initPlanner } from "./planner/planner.js";
import { loadAllProjectData, loadDemSamplerFromData } from "./shared/data-loader.js";
import {
  buildCumulativeDistances,
  closestAlongM,
  dispatchSetRoute,
} from "./shared/route-bridge.js";

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderScienceCards(data) {
  const rp = data.route?.properties || {};
  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setText(
    "sum-distance",
    rp.distance_m != null ? `${Number(rp.distance_m).toFixed(0)} m` : "no NASA value"
  );
  setText(
    "sum-climb",
    rp.climb_m != null ? `+${Number(rp.climb_m).toFixed(1)} m` : "no NASA value"
  );
  setText(
    "sum-duration",
    rp.duration_min_placeholder != null
      ? `${Number(rp.duration_min_placeholder).toFixed(0)} min*`
      : "no NASA value"
  );
  const evaDose = data.dose?.dose_estimate_mSv ?? data.dose?.total_eva_dose_msv;
  setText(
    "sum-dose",
    evaDose != null ? `${Number(evaDose).toFixed(3)} mSv*` : "no NASA value"
  );

  // DONKI Space Weather banner
  const donkiEl = document.getElementById("donki-banner");
  if (donkiEl) {
    const a = data.alerts;
    if (!a) {
      donkiEl.innerHTML = `<strong>DONKI Mars Space Weather:</strong> no NASA value`;
    } else if (a.banner?.text) {
      donkiEl.innerHTML = `<strong>DONKI Mars Space Weather:</strong> ${escapeHtml(a.banner.text)}`;
    } else {
      const impCount = Array.isArray(a.alerts) ? a.alerts.length : 0;
      const fetchDate = a.queried_at || a.fetch_date || "cached";
      donkiEl.innerHTML = `<strong>DONKI Mars Space Weather:</strong> ${escapeHtml(a.status || "Nominal")} · Impacts: ${impCount} <br><small>Queried: ${escapeHtml(fetchDate)}</small>`;
    }
  }

  // REMS Atmosphere card
  const wxEl = document.getElementById("weather-box");
  if (wxEl) {
    const w = data.weather;
    const ls = w?.latest_sol || w?.recent_7_sols?.[0];
    if (!w || !ls) {
      wxEl.innerHTML = `<strong>Curiosity REMS Weather:</strong> no NASA value`;
    } else {
      const airT =
        ls.air_min_C != null && ls.air_max_C != null
          ? `${ls.air_min_C}..${ls.air_max_C} °C`
          : "no NASA value";
      const gndT =
        ls.ground_min_C != null && ls.ground_max_C != null
          ? `${ls.ground_min_C}..${ls.ground_max_C} °C`
          : "--";
      const pres = ls.pressure_Pa != null ? `${ls.pressure_Pa} Pa` : "no NASA value";
      const win = w.chosen_window
        ? `<br><small>EVA window: ${escapeHtml(w.chosen_window.local_true_solar_time_start)}–${escapeHtml(w.chosen_window.local_true_solar_time_end)} LTST (${escapeHtml(ls.atmo_opacity || "Sunny")})</small>`
        : "";
      wxEl.innerHTML = `<strong>Curiosity REMS (Sol ${escapeHtml(ls.sol)}):</strong> Air ${escapeHtml(airT)} · Gnd ${escapeHtml(gndT)} · P ${escapeHtml(pres)}${win}`;
    }
  }

  // RAD Radiation card
  const doseEl = document.getElementById("dose-box");
  if (doseEl) {
    const d = data.dose;
    if (!d) {
      doseEl.innerHTML = `<strong>RAD Dose Budget:</strong> no NASA value`;
    } else {
      const baseRate = d.baseline_rate_mSv_per_day ?? d.baseline_rate_msv_per_day ?? 0.64;
      const errRate = d.baseline_uncertainty_mSv_per_day ?? d.baseline_uncertainty_msv_per_day ?? 0.12;
      const evaUnc = d.dose_uncertainty_mSv != null ? ` ± ${Number(d.dose_uncertainty_mSv).toFixed(4)}` : "";
      doseEl.innerHTML = `<strong>RAD Surface Dose:</strong> ${baseRate} ± ${errRate} mSv/day (GCR) · Walk budget: ${evaDose != null ? `${Number(evaDose).toFixed(4)}${evaUnc} mSv` : "no NASA value"} <br><small>${escapeHtml(d.note || "Time & shielding problem; not mapped by rock type.")}</small>`;
    }
  }
}

function renderStopsList(data, routeCoords, cumDist, onSelectStop) {
  const listEl = document.getElementById("stops-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  const features = data.stops?.features || [];
  if (!features.length) {
    listEl.innerHTML = '<li class="stop-item">no NASA value — stops not loaded</li>';
    return;
  }

  for (const feat of features) {
    const p = feat.properties || {};
    const c = feat.geometry?.coordinates;
    const li = document.createElement("li");
    li.className = "stop-item";
    const kindCls = p.kind === "bonus" ? "stop-kind-bonus" : "stop-kind-primary";
    const kindTag = p.kind === "bonus" ? "BONUS" : "PRIMARY";
    li.innerHTML = `
      <div class="stop-head">
        <span>${escapeHtml(p.name || p.id)}</span>
        <span class="${kindCls}">${kindTag}</span>
      </div>
      <div class="stop-desc">${escapeHtml(p.science_summary || "No science note")}</div>
    `;
    li.addEventListener("click", () => {
      if (c && routeCoords.length) {
        const sm = closestAlongM(routeCoords, cumDist, c[0], c[1]);
        dispatchSetRoute(data.route, sm);
      }
      if (onSelectStop) onSelectStop(feat);
    });
    listEl.appendChild(li);
  }
}

async function boot() {
  const data = await loadAllProjectData();
  const demSampler = await loadDemSamplerFromData(data);

  const registry = new TileSourceRegistry({
    demoSafe: data.demoSafe,
    themisMetadata: data.themis,
    demoTileBaseUrl: data.assets?.themisTileBaseUrl,
  });

  // Top badges
  const badgeDemo = document.getElementById("badge-demo");
  const badgeEx = document.getElementById("badge-example");
  const linkDemo = document.getElementById("link-demo-toggle");
  const adapterTag = document.getElementById("map-adapter-tag");

  if (adapterTag) {
    adapterTag.textContent = shouldUseHighResMap()
      ? "(Mars MapLibre + DEM)"
      : "(Legacy 2D Fallback)";
  }

  if (data.demoSafe) {
    badgeDemo?.classList.remove("hidden");
    if (linkDemo) {
      linkDemo.textContent = "Exit Demo-Safe";
      linkDemo.href = "./index.html";
    }
  }
  if (data.isExampleData) {
    badgeEx?.classList.remove("hidden");
  }

  renderScienceCards(data);

  // Modal setup
  const modalBackdrop = document.getElementById("modal-backdrop");
  const modalTitle = document.getElementById("modal-title");
  const modalBody = document.getElementById("modal-body");
  document.getElementById("modal-close")?.addEventListener("click", () => {
    modalBackdrop?.classList.add("hidden");
  });
  modalBackdrop?.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) modalBackdrop.classList.add("hidden");
  });

  const openPovModal = (stopProps) => {
    if (!modalBackdrop || !modalTitle || !modalBody) return;
    const targetId = stopProps?.id || "stop";
    const items = Array.isArray(data.povIndex?.stops)
      ? data.povIndex.stops
      : Array.isArray(data.povIndex?.images)
        ? data.povIndex.images
        : [];
    const match =
      items.find((img) => img.stop_id === targetId || img.id === targetId) || items[0];

    modalTitle.textContent = `Curiosity Rover POV — ${stopProps?.name || match?.stop_name || targetId}`;
    if (!match || match.missing) {
      modalBody.innerHTML = `<p>no NASA value — cached rover POV frame unavailable for ${escapeHtml(targetId)}.</p>`;
    } else {
      const relFile = match.image_relpath ? match.image_relpath.split("/").pop() : "";
      const imgFile = match.local_file || match.filename || relFile;
      const imgUrl = imgFile ? `${data.assets.povBaseUrl}/${imgFile}` : match.image_url || "";
      modalBody.innerHTML = `
        <p><strong>Sol:</strong> ${escapeHtml(match.sol ?? stopProps?.sol_hint ?? "--")} · <strong>Camera:</strong> ${escapeHtml(match.camera || match.instrument || "MSL Navcam/Mastcam")}</p>
        ${imgUrl ? `<img src="${escapeHtml(imgUrl)}" alt="Curiosity rover frame" style="width:100%;border-radius:8px;margin:8px 0;" />` : ""}
        <p>${escapeHtml(match.title || match.caption || stopProps?.science_summary || "")}</p>
        <p><small>Source: ${escapeHtml(match.credit || "NASA/JPL-Caltech")} · Fetched ${escapeHtml(match.fetched_at || match.fetch_date || "cached")}</small></p>
      `;
    }
    modalBackdrop.classList.remove("hidden");
  };

  // Dynamic Attributions footer
  const attribEl = document.getElementById("visor-attributions");
  let liveAttributions = [];
  const mergeAttributions = (incoming) => {
    const map = new Map();
    for (const a of [...liveAttributions, ...incoming]) {
      if (a?.id) map.set(a.id, a);
    }
    liveAttributions = [...map.values()];
    if (attribEl) {
      attribEl.textContent = liveAttributions.map((a) => a.label).join(" · ");
    }
  };

  const openCreditsModal = () => {
    if (!modalBackdrop || !modalTitle || !modalBody) return;
    modalTitle.textContent = "Data Sources, Geodesy & Modeling Caveats";
    const dynRows = liveAttributions
      .map(
        (a) =>
          `<li><strong>${escapeHtml(a.label)}</strong> — ${a.sourceUrl ? `<a href="${escapeHtml(a.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(a.sourceUrl)}</a>` : "local"} (checked ${escapeHtml(a.fetchDate || "2026-11-14")})</li>`
      )
      .join("");
    const jsonRows = (data.sources || [])
      .map(
        (s) =>
          `<li><strong>${escapeHtml(s.dataset)}:</strong> ${escapeHtml(s.name)} ${s.url ? `· <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">source</a>` : ""} (fetched ${escapeHtml(s.fetchDate)})</li>`
      )
      .join("");

    modalBody.innerHTML = `
      <p><strong>Framing:</strong> Gale Crater / Mount Sharp is a robotic Curiosity field site modeled here as a crewed analog Marswalk ("if a crew visited where Curiosity studied").</p>
      <ul>
        <li><strong>Geodesy &amp; Radius:</strong> Horizontal distances use Mars mean radius <code>3,389.5 km</code> (IAU equatorial <code>3,396.19 km</code> in DTM labels). Vertical heights reference the MOLA areoid (<code>-3850.6 m .. -3369.3 m</code> in DTEEC_019698).</li>
        <li><strong>Slope Stand-In Limit:</strong> The <code>20°</code> / strict <code>15°</code> limits are illustrative <em>lunar</em> EVA stand-ins (NASA Exploration EVA ConOps / LPSC 2023 #1413), not Mars suit specs.</li>
        <li><strong>DTM vs Rover Tilt Check (MUST-03):</strong> Comparing 176 Curiosity waypoints against the ~5 m DTM shows only weak match (<code>r ≈ 0.15</code>, medians <code>9.0°</code> vs <code>8.6°</code>); always keep a safety margin.</li>
        <li><strong>Placeholders:</strong> Suit O₂ percentage (linear depletion) and walk duration (Earth-hiking pace) are explicitly illustrative placeholders. Stops marked <code>PRE-07</code> are provisional demo coordinates.</li>
        <li><strong>Radiation:</strong> RAD baseline is <code>0.64 ± 0.12 mSv/day</code> (Hassler et al., 2014). Dose over a ~1 km EVA depends on time and shielding/solar weather, not local rock type.</li>
      </ul>
      <h3>Active Map &amp; Pipeline Citations</h3>
      <ul>${dynRows}${jsonRows}</ul>
    `;
    modalBackdrop.classList.remove("hidden");
  };

  document.getElementById("btn-credits")?.addEventListener("click", openCreditsModal);

  // Mount 3D Engine + 2D/2.5D Tactical Map
  let plannerApi = null;
  let hudApi = null;

  hudApi = await initHud3D(data, {
    demSampler,
    onOpenPov: openPovModal,
    onAttributionsChange: mergeAttributions,
    onPositionChange: ({ lon, lat, alongM }) => {
      if (plannerApi) plannerApi.updateAstronautPosition(lon, lat, alongM);
    },
  });

  plannerApi = await initPlanner(data, {
    demSampler,
    registry,
    onOpenPov: openPovModal,
    onAttributionsChange: mergeAttributions,
    onStrictLimitChange: (limit) => {
      if (hudApi) hudApi.setStrictSlopeLimit(limit);
    },
  });

  // Stops list
  const routeCoords = data.route?.geometry?.coordinates || [];
  const cumDist = buildCumulativeDistances(routeCoords);
  renderStopsList(data, routeCoords, cumDist, (feat) => {
    const c = feat.geometry?.coordinates;
    if (c && plannerApi?.adapter) {
      plannerApi.adapter.flyTo({ center: c, zoom: 15.8 });
    }
  });

  // Dock collapse / expand controls
  const mapDock = document.getElementById("visor-map-dock");
  const sciDock = document.getElementById("visor-science-dock");
  const mapExpandBtn = document.getElementById("btn-map-expand");
  const mapCollapseBtn = document.getElementById("btn-map-collapse");
  const sciCollapseBtn = document.getElementById("btn-science-collapse");

  mapExpandBtn?.addEventListener("click", () => {
    const expanded = mapDock?.classList.toggle("expanded");
    if (mapExpandBtn) mapExpandBtn.textContent = expanded ? "Shrink" : "Expand";
    setTimeout(() => plannerApi?.adapter?.resize(), 220);
  });

  mapCollapseBtn?.addEventListener("click", () => {
    const collapsed = mapDock?.classList.toggle("collapsed");
    if (mapCollapseBtn) mapCollapseBtn.textContent = collapsed ? "Show" : "Hide";
    if (!collapsed) setTimeout(() => plannerApi?.adapter?.resize(), 60);
  });

  sciCollapseBtn?.addEventListener("click", () => {
    const collapsed = sciDock?.classList.toggle("collapsed");
    if (sciCollapseBtn) sciCollapseBtn.textContent = collapsed ? "Show" : "Hide";
  });

  window.addEventListener("resize", () => {
    hudApi?.onResize?.();
    plannerApi?.adapter?.resize?.();
  });

  // Expose debug handle cleanly for smoke tests
  window.__MM_APP__ = { data, demSampler, registry, plannerApi, hudApi };
}

boot().catch((err) => {
  console.error("[Martian Mappers] Boot failure:", err);
  const wrap = document.getElementById("hud-canvas-wrap");
  if (wrap) {
    wrap.innerHTML = `<div class="hud-error-box">Visor boot failed: ${escapeHtml(err.message)}</div>`;
  }
});
