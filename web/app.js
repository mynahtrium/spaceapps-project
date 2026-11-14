/**
 * Main entry point (`web/app.js`).
 * Loads processed / demo-safe / contract data, initializes the 2D Planner and 3D Helmet HUD,
 * and handles view switching and modals (Curiosity POV + Credits & Honesty).
 */

import { loadAllProjectData } from "./shared/data-loader.js";
import { dispatchSetRoute } from "./shared/route-bridge.js";
import { initPlanner } from "./planner/planner.js";
import { initHud3D } from "./hud/hud3d.js";

async function boot() {
  const data = await loadAllProjectData();

  if (data.demoSafe) {
    document.getElementById("badge-demo").style.display = "inline-block";
  }
  if (data.route?.status === "example" || data.stops?.status === "example") {
    document.getElementById("badge-example").style.display = "inline-block";
  }

  const plannerView = document.getElementById("planner-view");
  const hudView = document.getElementById("hud-view");
  const btnTabPlanner = document.getElementById("btn-tab-planner");
  const btnTabHud = document.getElementById("btn-tab-hud");
  const btnStartEva = document.getElementById("btn-start-eva");
  const btnCredits = document.getElementById("btn-credits");

  const modalBackdrop = document.getElementById("modal-backdrop");
  const modalTitle = document.getElementById("modal-title");
  const modalBody = document.getElementById("modal-body");
  document.getElementById("modal-close").onclick = () => modalBackdrop.classList.remove("open");
  modalBackdrop.onclick = (e) => {
    if (e.target === modalBackdrop) modalBackdrop.classList.remove("open");
  };

  function openPovModal(povEntry) {
    modalTitle.textContent = `Curiosity Rover POV — ${povEntry.stop_name}`;
    const imgUrl = `${data.assets.povBaseUrl}/${povEntry.stop_id}.jpg`;
    modalBody.innerHTML = `
      <img class="modal-img" src="${imgUrl}" alt="${povEntry.title}" />
      <div style="font-size:12px;line-height:1.5;">
        <div><strong>${povEntry.title}</strong></div>
        <div>Sol ${povEntry.sol} · Camera: ${povEntry.camera} · Taken: ${povEntry.date_taken_utc}</div>
        <div>Credit: ${povEntry.credit}</div>
        <div class="honesty-note">${povEntry.note}</div>
      </div>
    `;
    modalBackdrop.classList.add("open");
  }

  function openCreditsModal() {
    modalTitle.textContent = "Data Sources, Citations & Honesty Notes";
    modalBody.innerHTML = `
      <div style="font-size:12px;line-height:1.55;">
        <p><strong>Site Framing:</strong> "If a crew visited where Curiosity studied Mount Sharp." Gale crater is a rover site, not a human landing candidate. Primary science goal: ancient lake sediments and habitability / biosignature potential (organics in mudstones); boxwork unit (Altadena member) is a bonus stop.</p>
        <p><strong>Honesty &amp; Placeholders:</strong></p>
        <ul>
          <li><strong>Slope limits (20° / 15°):</strong> Illustrative lunar stand-ins (NASA Exploration EVA ConOps / LPSC 2023 #1413). DTM slope matches Curiosity rover tilt only weakly (5 m medians 9.0° vs 8.6° over 176 waypoints); keep a safety margin.</li>
          <li><strong>Suit O₂ &amp; Walking Time:</strong> Illustrative linear / Earth-hiking placeholders, not validated Mars suit models.</li>
          <li><strong>Radiation Dose:</strong> Hassler et al. (Science 2014) Curiosity RAD baseline (0.64 ± 0.12 mSv/day) × EVA duration. No spatial rock radiation map.</li>
        </ul>
        <p><strong>Missions &amp; Datasets (fetched 2026-11-14):</strong></p>
        <ul>
          <li><strong>MRO HiRISE:</strong> 1 m DTM (<code>DTEEC_019698_1750_019988_1750_U01</code>) &amp; 25 cm orthoimage</li>
          <li><strong>MRO CTX &amp; Odyssey THEMIS:</strong> Mars Trek WMTS mosaics (5 m CTX, 100 m Day/Night IR)</li>
          <li><strong>MRO CRISM:</strong> 9 MTRDR product records via PDS Geosciences ODE REST</li>
          <li><strong>MSL Curiosity:</strong> Traverse waypoints (1,389 sols), CAB/NASA REMS weather (4,745 sols), Navcam/Mastcam raw images</li>
          <li><strong>NASA DONKI:</strong> WSA-Enlil Mars impact simulations (cached 30-day window)</li>
        </ul>
      </div>
    `;
    modalBackdrop.classList.add("open");
  }

  btnCredits.onclick = openCreditsModal;

  let hudApi = null;
  function switchToHud() {
    plannerView.classList.remove("active");
    hudView.classList.add("active");
    btnTabPlanner.classList.remove("active");
    btnTabHud.classList.add("active");
    if (hudApi) hudApi.onResize();
  }

  function switchToPlanner() {
    hudView.classList.remove("active");
    plannerView.classList.add("active");
    btnTabHud.classList.remove("active");
    btnTabPlanner.classList.add("active");
  }

  btnTabPlanner.onclick = switchToPlanner;
  btnTabHud.onclick = switchToHud;
  btnStartEva.onclick = () => {
    if (data.route) dispatchSetRoute(data.route, 0);
    switchToHud();
  };

  initPlanner(data, {
    onOpenPov: openPovModal,
    onStartEva: switchToHud,
  });

  hudApi = await initHud3D(data, {
    onBackToPlanner: switchToPlanner,
    onOpenPov: openPovModal,
  });
}

boot();
