/**
 * Main entry point (`web/app.js`).
 * Loads processed / demo-safe / contract data, initializes the 2D Planner and 3D Helmet HUD,
 * and handles view switching and modals (Curiosity POV + Credits & Honesty).
 */

import { loadAllProjectData, loadDemSamplerFromData } from "./shared/data-loader.js";
import { TileSourceRegistry } from "./map/TileSourceRegistry.js";
import { dispatchSetRoute } from "./shared/route-bridge.js";
import { initPlanner } from "./planner/planner.js";
import { initHud3D } from "./hud/hud3d.js";

const I18N = {
  en: {
    title: "MARTIAN MAPPERS",
    lines: [
      "GALE CRATER / MOUNT SHARP — MARS",
      "EVA RECORD 01 · CURIOSITY TRAVERSE CONTEXT",
      "IF A CREW VISITED WHERE CURIOSITY STUDIED MOUNT SHARP.",
      "TERRAIN: HiRISE DTEEC_019698 · ROUTE: EXAMPLE, STOPS NOT LOCKED",
    ],
    menu_eva: "BEGIN EVA",
    menu_planner: "ROUTE PLANNER",
    menu_credits: "SOURCES & HONESTY",
    foot_sources:
      "DATA: NASA / MRO HiRISE (UArizona), MSL CURIOSITY, MARS TREK, DONKI · ASTRONAUT MODEL: NASA 3D RESOURCES · EXAMPLE ROUTE, STOPS NOT LOCKED (PRE-07)",
  },
  tr: {
    title: "MARTIAN MAPPERS",
    lines: [
      "GALE KRATERİ / MOUNT SHARP — MARS",
      "EVA KAYDI 01 · CURIOSITY GÜZERGÂHI",
      "BİR EKİP CURIOSITY'NİN MOUNT SHARP'I İNCELEDİĞİ YERE GİTSEYDİ.",
      "ARAZİ: HiRISE DTEEC_019698 · ROTA: ÖRNEK, DURAKLAR KİLİTLİ DEĞİL",
    ],
    menu_eva: "EVA'YA BAŞLA",
    menu_planner: "ROTA PLANLAYICI",
    menu_credits: "KAYNAKLAR VE DÜRÜSTLÜK",
    foot_sources:
      "VERİ: NASA / MRO HiRISE (UArizona), MSL CURIOSITY, MARS TREK, DONKI · ASTRONOT MODELİ: NASA 3D RESOURCES · ÖRNEK ROTA, DURAKLAR KİLİTLİ DEĞİL (PRE-07)",
  },
};

function readLang() {
  try {
    return localStorage.getItem("mm-lang") === "tr" ? "tr" : "en";
  } catch {
    return "en";
  }
}

function initStartScreen({ onEva, onPlanner, onCredits }) {
  const screen = document.getElementById("start-screen");
  const linesEl = document.getElementById("start-lines");
  const menu = document.getElementById("start-menu");
  const items = [...menu.querySelectorAll(".menu-item")];
  let lang = readLang();
  let typingToken = 0;
  let focusIdx = 0;

  function applyLang() {
    const t = I18N[lang];
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n;
      if (t[key]) el.textContent = t[key];
    });
    document.getElementById("lang-en").style.color = lang === "en" ? "#fff" : "";
    document.getElementById("lang-tr").style.color = lang === "tr" ? "#fff" : "";
  }

  async function typeIntro() {
    const token = ++typingToken;
    const t = I18N[lang];
    menu.classList.remove("shown");
    linesEl.innerHTML = "";
    const title = document.createElement("span");
    title.className = "title";
    linesEl.appendChild(title);
    const caret = document.createElement("span");
    caret.className = "caret";
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sleep = (ms) => new Promise((r) => setTimeout(r, reduce ? 0 : ms));
    const type = async (el, text, ms) => {
      for (const ch of text) {
        if (token !== typingToken) return false;
        el.textContent += ch;
        el.after(caret);
        await sleep(ms);
      }
      return true;
    };
    if (!(await type(title, t.title, 55))) return;
    for (const line of t.lines) {
      const row = document.createElement("div");
      linesEl.appendChild(row);
      await sleep(180);
      if (!(await type(row, line, 16))) return;
    }
    if (token === typingToken) menu.classList.add("shown");
  }

  function setFocus(i) {
    focusIdx = (i + items.length) % items.length;
    items.forEach((el, k) => el.classList.toggle("focus", k === focusIdx));
  }

  function hide() {
    screen.classList.add("hidden");
  }

  function show() {
    screen.classList.remove("hidden");
    typeIntro();
    setFocus(0);
  }

  const actions = { eva: onEva, planner: onPlanner, credits: onCredits };
  items.forEach((el, k) => {
    el.addEventListener("mouseenter", () => setFocus(k));
    el.addEventListener("click", () => {
      const act = el.dataset.action;
      if (act !== "credits") hide();
      actions[act]?.();
    });
  });

  window.addEventListener("keydown", (e) => {
    if (screen.classList.contains("hidden")) return;
    if (e.key === "ArrowDown") setFocus(focusIdx + 1);
    else if (e.key === "ArrowUp") setFocus(focusIdx - 1);
    else if (e.key === "Enter") items[focusIdx].click();
    else return;
    e.preventDefault();
  });

  const setLang = (l) => {
    lang = l;
    try {
      localStorage.setItem("mm-lang", l);
    } catch {
      /* storage blocked: keep the in-memory choice */
    }
    applyLang();
    typeIntro();
  };
  document.getElementById("lang-en").onclick = () => setLang("en");
  document.getElementById("lang-tr").onclick = () => setLang("tr");

  applyLang();
  show();
  return { show, hide };
}

async function boot() {
  // Show the start screen at once; its actions wait until the data and views are ready.
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));
  const start = initStartScreen({
    onEva: () => ready.then((a) => a.eva()),
    onPlanner: () => ready.then((a) => a.planner()),
    onCredits: () => ready.then((a) => a.credits()),
  });
  document.getElementById("btn-menu").onclick = () => start.show();

  const data = await loadAllProjectData();
  // High-res Mars map stack: HiRISE DEM sampler + tile registry (demo-safe = zero network).
  const demSampler = await loadDemSamplerFromData(data);
  const registry = new TileSourceRegistry({
    demoSafe: data.demoSafe,
    themisMetadata: data.themis,
    demoTileBaseUrl: data.assets?.themisTileBaseUrl,
  });

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
          <li><strong>Astronaut model:</strong> NASA 3D Resources (github.com/nasa/NASA-3D-Resources), Z2 Spacesuit or Mark III Spacesuit glTF, scaled to a 1.80 m astronaut. The NASA model has no skeleton, so the app builds one from the mesh (hips, knees, ankles, spine, head, shoulders) and drives a walk / run cycle from distance walked; the model's forward-reaching arms are lowered at the shoulders and swing opposite to the legs. Mars gravity (3.71 m/s²) is used for jumps and falls; walking pace (1.4 m/s) and a light run with Shift (2.5 m/s) are placeholders.</li><li><strong>Shadows:</strong> crisp real-time sun shadows near the walker; further away, terrain shadows are precomputed by marching the HiRISE-derived height grid towards the sun.</li>
        </ul>
        <p><strong>Rendering:</strong> real-time WebGL rasterisation with physically based materials, shadow maps, ACES tone mapping and a helmet-camera lens pass (barrel distortion, chromatic aberration, grain, vignette). It is not ray tracing. The textured terrain colour is an illustrative Mars tint over greyscale HiRISE imagery. Terrain beyond the real 2 km tile is a mirrored copy, not data. Close-range ground grain (wind ripples, pebbles, fractured mudstone slabs) is procedurally generated in the browser for visual texture only; it is not mapped geology.</p>
        <p><strong>2D map:</strong> MapLibre with Mars Trek CTX / THEMIS / MOLA tiles reprojected from Mars equirectangular, and hillshade / optional 3D tilt from the HiRISE-derived height preview. In demo-safe mode no tiles are fetched; an offline shaded relief is drawn from the local height grid.</p>
      </div>
    `;
    modalBackdrop.classList.add("open");
  }

  btnCredits.onclick = openCreditsModal;

  let hudApi = null;
  let plannerApi = null;
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
    requestAnimationFrame(() => plannerApi?.adapter?.resize?.());
  }

  btnTabPlanner.onclick = switchToPlanner;
  btnTabHud.onclick = switchToHud;
  btnStartEva.onclick = () => {
    if (data.route) dispatchSetRoute(data.route, 0);
    switchToHud();
  };

  resolveReady({ eva: () => btnStartEva.onclick(), planner: switchToPlanner, credits: openCreditsModal });

  plannerApi = initPlanner(data, {
    demSampler,
    registry,
    onOpenPov: openPovModal,
    onStartEva: switchToHud,
  });

  window.__MM_APP__ = { data, demSampler, registry, get plannerApi() { return plannerApi; } };
  hudApi = await initHud3D(data, {
    onBackToPlanner: switchToPlanner,
    onOpenPov: openPovModal,
  });
}

boot();
