/**
 * Main entry point (`web/app.js`) for the Unified Astronaut Visor.
 * Loads processed / demo-safe / contract data, binds the visor map + 3D terrain + AR markers,
 * and handles Curiosity POV & NASA Sources/Credits modals.
 */

import { loadAllProjectData } from "./shared/data-loader.js";
import { initPlanner } from "./planner/planner.js";
import { initHud3D } from "./hud/hud3d.js";

async function boot() {
  const data = await loadAllProjectData();

  if (data.demoSafe) {
    document.getElementById("badge-demo").style.display = "inline-block";
    const toggle = document.getElementById("link-demo-toggle");
    if (toggle) {
      toggle.textContent = "Exit ?demo=1";
      toggle.href = "./";
    }
  }

  if (
    data.stops?.status === "example" ||
    data.dose?.is_example === true
  ) {
    document.getElementById("badge-example").style.display = "inline-block";
  }

  const modalBackdrop = document.getElementById("modal-backdrop");
  const modalTitle = document.getElementById("modal-title");
  const modalBody = document.getElementById("modal-body");
  document.getElementById("modal-close").onclick = () => modalBackdrop.classList.remove("open");
  modalBackdrop.onclick = (e) => {
    if (e.target === modalBackdrop) modalBackdrop.classList.remove("open");
  };

  function openPovModal(povEntry) {
    modalTitle.textContent = `Curiosity Rover POV — ${povEntry.stop_name || "Stop"}`;
    if (!povEntry || povEntry.missing) {
      modalBody.innerHTML = `
        <div class="science-card empty-state" style="padding:14px;">
          ${povEntry?.missing_label || "no NASA value — Curiosity POV still unavailable for this stop."}
        </div>
      `;
      modalBackdrop.classList.add("open");
      return;
    }
    const imgUrl = `${data.assets.povBaseUrl}/${povEntry.stop_id}.jpg`;
    modalBody.innerHTML = `
      <img class="modal-img" src="${imgUrl}" alt="${povEntry.title || "Curiosity POV"}" onerror="this.outerHTML='<div class=empty-state>no NASA value — image failed to load</div>'" />
      <div style="font-size:12px;line-height:1.5;">
        <div><strong>${povEntry.title || "Curiosity Raw Image"}</strong></div>
        <div>Sol ${povEntry.sol ?? "—"} · Camera: ${povEntry.camera ?? "—"} · Taken: ${povEntry.date_taken_utc ?? "—"}</div>
        <div>Image ID: <code>${povEntry.imageid ?? "—"}</code> · Credit: ${povEntry.credit ?? "NASA/JPL-Caltech"}</div>
        <div class="hud-sub">${povEntry.note || ""}</div>
      </div>
    `;
    modalBackdrop.classList.add("open");
  }

  function openCreditsModal() {
    modalTitle.textContent = "NASA & PDS Data Sources, Citations & Honesty Notes";
    const dtmId = data.costMap?.dtm_product_id_planned || "DTEEC_019698_1750_019988_1750_U01";
    const crismCount = data.crism?.product_count ?? 0;
    const alertsDate = data.alerts?.queried_at || "no NASA value";
    const weatherDate = data.weather?.fetched_at || "no NASA value";
    const doseDate = data.dose?.computed_at || "no NASA value";
    const povDate = data.povIndex?.fetched_at || "no NASA value";
    const themisDate = data.themis?.fetched_at || "no NASA value";
    const crismDate = data.crism?.fetched_at || "no NASA value";

    modalBody.innerHTML = `
      <div style="font-size:12px;line-height:1.55;">
        <p><strong>Site Framing:</strong> "If a crew visited where Curiosity studied Mount Sharp." Gale crater is a rover site, not a human landing candidate. Primary science goal: ancient lake sediments and habitability / biosignature potential (organics in mudstones); boxwork unit (Altadena member) is a bonus stop.</p>
        <p><strong>Honesty &amp; Placeholders:</strong></p>
        <ul>
          <li><strong>Slope limits (20° / 15°):</strong> Illustrative lunar stand-ins (NASA Exploration EVA ConOps / LPSC 2023 #1413). DTM slope matches Curiosity rover tilt only weakly (5 m medians 9.0° vs 8.6° over 176 waypoints); keep a safety margin.</li>
          <li><strong>Suit O₂ &amp; Walking Time:</strong> Illustrative linear / Earth-hiking placeholders, not validated Mars suit models.</li>
          <li><strong>Radiation Dose:</strong> Hassler et al. (Science 2014) Curiosity RAD baseline (0.64 ± 0.12 mSv/day) × EVA duration. No spatial rock radiation map.</li>
        </ul>
        <p><strong>Cached NASA &amp; PDS Products (loaded from ${data.demoSafe ? "data/demo/ only" : "data/processed/ (with docs/contracts/ fallback)"}):</strong></p>
        <ul>
          <li><strong>MRO HiRISE DTM &amp; Ortho:</strong> <code>${dtmId}</code> (<a href="https://hirise-pds.lpl.arizona.edu/PDS/DTM/" target="_blank" style="color:#7dd3fc;">PDS DTM Archive</a>)</li>
          <li><strong>MRO CTX &amp; Odyssey THEMIS:</strong> Mars Trek WMTS (fetched ${themisDate})</li>
          <li><strong>MRO CRISM:</strong> ${crismCount} MTRDR records from PDS Geosciences ODE REST (fetched ${crismDate})</li>
          <li><strong>MSL Curiosity Traverse &amp; REMS Weather:</strong> MMGIS waypoints + CAB/NASA REMS feed (fetched ${weatherDate})</li>
          <li><strong>MSL Curiosity Raw Images (POV):</strong> ${data.povIndex?.count ?? 0} cached stills (fetched ${povDate})</li>
          <li><strong>Curiosity RAD Dose Budget:</strong> ${data.dose?.baseline_source || "Hassler et al. 2014"} (computed ${doseDate})</li>
          <li><strong>NASA DONKI Space Weather:</strong> ${data.alerts?.source || "no NASA value"} (queried ${alertsDate})</li>
        </ul>
      </div>
    `;
    modalBackdrop.classList.add("open");
  }

  document.getElementById("btn-credits").onclick = openCreditsModal;

  const plannerApi = initPlanner(data, { onOpenPov: openPovModal });

  await initHud3D(data, {
    onOpenPov: openPovModal,
    onPositionChange: (lon, lat) => {
      plannerApi.updateAstronautPosition(lon, lat);
    },
  });
}

boot();
