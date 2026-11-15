/**
 * Main entry point (`web/app.js`).
 * Loads processed / demo-safe / contract data, initializes the 3D Helmet HUD and Orbit View,
 * and handles view switching, the ESC command menu, and modals (Curiosity POV + Credits & Honesty).
 */

import { loadAllProjectData, loadDemSamplerFromData } from "./shared/data-loader.js";
import { TileSourceRegistry } from "./map/TileSourceRegistry.js";
import { buildInviteUrl, MultiplayerClient } from "./shared/multiplayer.js";
import { dispatchSetRoute, dispatchVisitRoverSite, marsDistanceM, onOpenRoverInfo } from "./shared/route-bridge.js";
import { formatMarsLonLat, getHistoricRoverById } from "./shared/mars-rovers.js";
import { initHud3D } from "./hud/hud3d.js";
import { initOrbitView } from "./orbit/orbit-view.js";
import {
  FULL_REALISM_PRESET,
  loadDevSettings,
  resetDevSettings,
  saveDevSettings,
  subscribeDevSettings,
} from "./shared/dev-settings.js";

const HUD_THEMES = ["cyan", "untitled", "mono"];
const THEME_LABELS = {
  cyan: { en: "Ice-Cyan Glass", tr: "Buz Mavisi Cam" },
  untitled: { en: "Untitled Blue", tr: "Mavi-Siyah" },
  mono: { en: "Monochrome", tr: "Siyah-Beyaz" },
};

function getThemeLabel(themeId, tr) {
  const id = HUD_THEMES.includes(themeId) ? themeId : "cyan";
  return THEME_LABELS[id][tr ? "tr" : "en"];
}

function applyThemeToDom(cfg) {
  if (typeof document !== "undefined" && document.body) {
    document.body.dataset.theme = cfg?.hudTheme || "cyan";
  }
}

function cycleHudTheme() {
  const cur = loadDevSettings().hudTheme || "cyan";
  const next = HUD_THEMES[(HUD_THEMES.indexOf(cur) + 1) % HUD_THEMES.length];
  return saveDevSettings({ hudTheme: next });
}
import { initContextMenu } from "./shared/context-menu.js";
import { BACK_BUTTON, CONFIRM_BUTTON, gamepad } from "./shared/gamepad.js";
import { initGamepadSetup, mountGamepadSettings } from "./shared/gamepad-ui.js";

function applyAudioToEngine(cfg) {
  const audio = typeof window !== "undefined" ? window.MartianAudio : null;
  if (!audio) return;
  if (typeof cfg?.audioMuted === "boolean" && audio.isMuted?.() !== cfg.audioMuted) {
    audio.setMuted?.(cfg.audioMuted);
  }
  if (typeof cfg?.audioMusic === "boolean" && audio.isMusicEnabled?.() !== cfg.audioMusic) {
    audio.setMusicEnabled?.(cfg.audioMusic);
  }
}

const I18N = {
  en: {
    title: "MARTIAN MAPPERS",
    lines: [
      "GALE CRATER / MOUNT SHARP — MARS",
      "EVA RECORD 01 · CURIOSITY TRAVERSE CONTEXT",
      "IF A CREW VISITED WHERE CURIOSITY STUDIED MOUNT SHARP.",
      "TERRAIN: HiRISE DTEEC_009149, STREAMED 1 M · STOPS: CITED, NOT LOCKED",
    ],
    menu_eva: "BEGIN EVA",
    menu_orbit: "ORBIT VIEW",
    menu_credits: "SOURCES & HONESTY",
    menu_dev: "SETTINGS",
    loading_note: "Elevation data, suit and rover models load once, before the EVA starts.",
    foot_sources:
      "DATA: NASA / MRO HiRISE (UArizona), MSL CURIOSITY, MARS TREK, DONKI · ASTRONAUT MODEL: NASA 3D RESOURCES · EXAMPLE ROUTE, STOPS NOT LOCKED (PRE-07)",
  },
  tr: {
    title: "MARTIAN MAPPERS",
    lines: [
      "GALE KRATERİ / MOUNT SHARP — MARS",
      "EVA KAYDI 01 · CURIOSITY GÜZERGÂHI",
      "BİR EKİP CURIOSITY'NİN MOUNT SHARP'I İNCELEDİĞİ YERE GİTSEYDİ.",
      "ARAZİ: HiRISE DTEEC_009149, 1 M AKIŞLI · DURAKLAR: KAYNAKLI, KİLİTLİ DEĞİL",
    ],
    menu_eva: "EVA'YA BAŞLA",
    menu_orbit: "YÖRÜNGE GÖRÜNÜMÜ",
    menu_credits: "KAYNAKLAR VE DÜRÜSTLÜK",
    menu_dev: "AYARLAR",
    loading_note: "Yükseklik verisi, giysi ve araç modelleri EVA başlamadan önce bir kez yüklenir.",
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

function initStartScreen({ onEva, onOrbit, onCredits, onDev, onLangChange }) {
  const screen = document.getElementById("start-screen");
  const linesEl = document.getElementById("start-lines");
  const menu = document.getElementById("start-menu");
  const items = [...menu.querySelectorAll(".menu-item")];
  let lang = readLang();
  let typingToken = 0;
  let typingSkip = false; // a key or click during the intro finishes it at once
  let focusIdx = 0;

  function applyLang() {
    const t = I18N[lang];
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n;
      if (t[key]) el.textContent = t[key];
    });
    document.getElementById("lang-en").style.color = lang === "en" ? "var(--cyan-bright)" : "";
    document.getElementById("lang-tr").style.color = lang === "tr" ? "var(--cyan-bright)" : "";
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
    typingSkip = false;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sleep = (ms) => (reduce || typingSkip ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
    const type = async (el, text, ms) => {
      for (let i = 0; i < text.length; i++) {
        if (token !== typingToken) return false;
        if (typingSkip) {
          el.textContent += text.slice(i);
          break;
        }
        el.textContent += text[i];
        el.after(caret);
        await sleep(ms);
      }
      el.after(caret);
      return true;
    };
    // quicker than before (55 / 16 / 180 ms): the menu is up in about 1.5 s
    if (!(await type(title, t.title, 24))) return;
    for (const line of t.lines) {
      const row = document.createElement("div");
      linesEl.appendChild(row);
      await sleep(60);
      if (!(await type(row, line, 6))) return;
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

  const actions = { eva: onEva, orbit: onOrbit, credits: onCredits };
  items.forEach((el, k) => {
    el.addEventListener("mouseenter", () => setFocus(k));
    el.addEventListener("click", () => {
      const act = el.dataset.action;
      if (act !== "credits") hide();
      actions[act]?.();
    });
  });

  screen.addEventListener("pointerdown", () => {
    typingSkip = true;
  });
  window.addEventListener("keydown", (e) => {
    if (screen.classList.contains("hidden")) return;
    if (!menu.classList.contains("shown")) typingSkip = true;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
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
    if (!screen.classList.contains("hidden")) typeIntro();
    onLangChange?.(l);
  };
  document.getElementById("lang-en").onclick = () => setLang("en");
  document.getElementById("lang-tr").onclick = () => setLang("tr");
  const devBtn = document.getElementById("btn-dev-settings");
  if (devBtn) devBtn.onclick = () => onDev?.();

  applyLang();
  show();
  return { show, hide, setLang };
}

async function boot() {
  document.body.classList.add("in-hud");
  const initialCfg = loadDevSettings();
  applyThemeToDom(initialCfg);
  applyAudioToEngine(initialCfg);
  subscribeDevSettings((cfg) => {
    applyThemeToDom(cfg);
    applyAudioToEngine(cfg);
    syncEscMenuRef();
  });
  window.addEventListener("click", (e) => {
    const toggleBtn = e.target?.closest?.("#mm-audio-toggle");
    if (toggleBtn && window.MartianAudio) {
      setTimeout(() => {
        saveDevSettings({ audioMuted: Boolean(window.MartianAudio.isMuted?.()) });
      }, 0);
    }
  });
  // Show the start screen at once; its actions wait until the data and views are ready.
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));
  let syncEscMenuRef = () => {};
  let openSettingsModalRef = () => {};
  let activePadSettingsApi = null;
  let currentSettingsTab = "general";
  const start = initStartScreen({
    onEva: () => ready.then((a) => a.eva()),
    onOrbit: () => ready.then((a) => a.orbit()),
    onCredits: () => ready.then((a) => a.credits()),
    onDev: () => ready.then((a) => a.dev()),
    onLangChange: () => syncEscMenuRef(),
  });

  // Controller routing (layout in shared/gamepad.js): Menu = Esc menu, View = map, A confirm, B back;
  // D-pad or left stick move through menus. In-game actions live in hud3d.js, the maps handle
  // their own stick / A / B once open.
  const padSetup = initGamepadSetup({
    onOpen: () => openSettingsModalRef("controls"),
  });
  document.getElementById("btn-pad").onclick = () => openSettingsModalRef();
  const pressKey = (key) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  const isOn = (id, cls) => document.getElementById(id)?.classList.contains(cls);
  const appReady = () => Boolean(window.__MM_APP__);

  function toggleMap() {
    if (isOn("hud-view", "active")) document.getElementById("hud-orbit-btn")?.click(); // 3D view -> orbit globe
    else if (isOn("orbit-view", "active")) document.getElementById("btn-tab-hud")?.click(); // back to 3D
  }

  // move keyboard focus through the controls of an open panel (controller setup / settings modal)
  function moveFocus(rootEl, dir) {
    const items = [...rootEl.querySelectorAll("button, input, select")].filter((e) => !e.disabled && e.offsetParent !== null);
    if (!items.length) return;
    const cur = items.indexOf(document.activeElement);
    const el = document.activeElement;
    if ((dir === "left" || dir === "right") && el?.type === "range" && cur >= 0) {
      const step = Number(el.step) || 0.1;
      el.value = String(Number(el.value) + (dir === "right" ? step : -step));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    const next = cur < 0 ? 0 : (cur + (dir === "up" || dir === "left" ? -1 : 1) + items.length) % items.length;
    items[next].focus();
  }

  gamepad.onNav(({ dir }) => {
    if (padSetup.isOpen) return moveFocus(document.getElementById("pad-setup"), dir);
    if (isOn("modal-backdrop", "open")) return moveFocus(document.getElementById("modal-backdrop"), dir);
    if (isOn("esc-menu", "open")) return moveFocus(document.getElementById("esc-menu"), dir);
    if (!isOn("start-screen", "hidden")) {
      if (dir === "up") pressKey("ArrowUp");
      else if (dir === "down") pressKey("ArrowDown");
    }
  });

  gamepad.onPress(({ button, actions }) => {
    if (padSetup.isOpen) {
      if (button === BACK_BUTTON) padSetup.close();
      else if (button === CONFIRM_BUTTON && document.getElementById("pad-setup").contains(document.activeElement)) {
        document.activeElement.click();
      }
      return;
    }
    if (isOn("modal-backdrop", "open")) {
      const backdropEl = document.getElementById("modal-backdrop");
      const tabBtns = [...backdropEl.querySelectorAll(".settings-tab")];
      if (tabBtns.length > 0 && (button === 4 || button === 5)) {
        const curIdx = Math.max(0, tabBtns.findIndex((b) => b.classList.contains("active")));
        const nextIdx = (curIdx + (button === 5 ? 1 : -1) + tabBtns.length) % tabBtns.length;
        tabBtns[nextIdx]?.click();
        return;
      }
      if (button === BACK_BUTTON) {
        document.getElementById("modal-close")?.click();
      } else if (button === CONFIRM_BUTTON && backdropEl.contains(document.activeElement)) {
        document.activeElement.click();
      }
      return;
    }
    if (!isOn("start-screen", "hidden")) {
      if (button === CONFIRM_BUTTON) pressKey("Enter");
      // B or Menu closes the Esc menu and returns to where you were (once the app has loaded)
      else if ((button === BACK_BUTTON || actions.includes("menu")) && appReady()) start.hide();
      return;
    }
    if (actions.includes("menu")) return start.show();
    if (actions.includes("setup")) return openSettingsModalRef("controls");
    if (actions.includes("map")) return toggleMap(); // opens and closes the map
    if (isOn("orbit-view", "active") && button === BACK_BUTTON) document.getElementById("btn-tab-hud")?.click();
  });

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

  const hudView = document.getElementById("hud-view");
  const orbitView = document.getElementById("orbit-view");
  const btnTabHud = document.getElementById("btn-tab-hud");
  const btnTabOrbit = document.getElementById("btn-tab-orbit");
  const btnCredits = document.getElementById("btn-credits");

  const modalBackdrop = document.getElementById("modal-backdrop");
  const modalCard = modalBackdrop?.querySelector(".modal-card");
  const modalTitle = document.getElementById("modal-title");
  const modalBody = document.getElementById("modal-body");
  let modalToggleKey = null;
  function closeModal() {
    modalBackdrop.classList.remove("open");
    modalCard?.classList.remove("settings-modal");
    activePadSettingsApi = null;
    modalToggleKey = null;
  }
  document.getElementById("modal-close").onclick = closeModal;
  modalBackdrop.onclick = (e) => {
    if (e.target === modalBackdrop) closeModal();
  };

  function openPovModal(povEntry) {
    modalToggleKey = null;
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

  function openHistoricRoverModal(roverOrId, { toggleKey = null } = {}) {
    if (document.pointerLockElement) {
      try {
        document.exitPointerLock?.();
      } catch {}
    }
    const rover = typeof roverOrId === "string" ? getHistoricRoverById(roverOrId) : roverOrId;
    if (!rover) return;
    modalToggleKey = toggleKey || null;
    const tr = readLang() === "tr";
    const statusTr = rover.status === "ACTIVE" ? (tr ? "AKTİF GÖREV" : "ACTIVE") : tr ? "TAMAMLANDI" : "COMPLETED";
    const coordsText = formatMarsLonLat(rover.lon, rover.lat, 4);
    modalTitle.textContent = `${rover.name.toUpperCase()} — ${rover.mission}`;
    modalBody.innerHTML = `
      <div style="font-size:12px;line-height:1.55;">
        <div class="rover-modal-hero">
          <div>
            <div style="font-size:15px;color:var(--cyan-bright);letter-spacing:0.08em;"><strong>${rover.name}</strong> · ${rover.agency}</div>
            <div style="color:var(--faint);font-size:11px;">${rover.landingSite}</div>
            ${rover.landingCoordsNote ? `<div style="color:var(--muted);font-size:10px;margin-top:3px;">${rover.landingCoordsNote}</div>` : ""}
          </div>
          <span class="fleet-status ${rover.status === "ACTIVE" ? "active" : ""}">${statusTr}</span>
        </div>

        <div class="rover-modal-grid">
          <div class="rover-stat">
            <div class="rover-stat-k">${tr ? "MARS KONUMU" : "MARS COORDINATES"}</div>
            <div class="rover-stat-v">${coordsText}</div>
          </div>
          <div class="rover-stat">
            <div class="rover-stat-k">${tr ? "KATEDİLEN MESAFE" : "DISTANCE DRIVEN"}</div>
            <div class="rover-stat-v">${rover.distanceLabel}</div>
          </div>
          <div class="rover-stat">
            <div class="rover-stat-k">${tr ? "FIRLATMA / İNİŞ" : "LAUNCH / LANDING"}</div>
            <div class="rover-stat-v">${rover.launchDate} → ${rover.landingDate}</div>
          </div>
          <div class="rover-stat">
            <div class="rover-stat-k">${tr ? "GÖREV SÜRESİ" : "SOLS / LIFESPAN"}</div>
            <div class="rover-stat-v">${rover.sols.toLocaleString()} sols${rover.endDate ? ` (ended ${rover.endDate})` : " (ongoing)"}</div>
          </div>
          <div class="rover-stat">
            <div class="rover-stat-k">${tr ? "KÜTLE & BOYUT" : "MASS & DIMENSIONS"}</div>
            <div class="rover-stat-v">${rover.massKg} kg · ${rover.dimensionsM}</div>
          </div>
          <div class="rover-stat">
            <div class="rover-stat-k">${tr ? "GÜÇ KAYNAĞI" : "POWER SOURCE"}</div>
            <div class="rover-stat-v">${rover.powerSource}</div>
          </div>
        </div>

        <p style="margin-bottom:8px;">
          <strong>${tr ? "Bilimsel Keşifler:" : "Science Highlights:"}</strong>
          ${tr ? rover.highlightsTr : rover.highlightsEn}
        </p>
        <p style="margin-bottom:8px;">
          <strong>${tr ? "Ana Enstrümanlar:" : "Key Instruments:"}</strong>
          ${rover.instruments.join(" · ")}
        </p>
        <div class="honesty-note">
          <strong>3D Asset:</strong> ${rover.modelSourceNote}.
          <a href="${rover.nasaUrl}" target="_blank" rel="noopener noreferrer" style="color:var(--cyan);">NASA Mission Page ↗</a>
        </div>

        <div class="rover-modal-actions">
          <button id="rover-modal-visit-3d" class="btn primary" type="button">
            ${tr ? "3D Bölgeye Git (Aracın Yanına)" : "Visit 3D Site (Stand by Rover)"}
          </button>
          <button id="rover-modal-show-orbit" class="btn" type="button">
            ${tr ? "Yörünge Görünümü" : "Orbit View"}
          </button>
        </div>
      </div>
    `;
    modalBody.querySelector("#rover-modal-visit-3d")?.addEventListener("click", () => {
      closeModal();
      dispatchVisitRoverSite(rover.id);
      switchToHud();
    });
    modalBody.querySelector("#rover-modal-show-orbit")?.addEventListener("click", () => {
      closeModal();
      switchToOrbit();
    });
    modalBackdrop.classList.add("open");
  }

  onOpenRoverInfo((detail) => openHistoricRoverModal(detail?.roverId, { toggleKey: detail?.toggleKey || null }));

  function openCreditsModal() {
    modalToggleKey = null;
    modalTitle.textContent = "Data Sources, Citations & Honesty Notes";
    modalBody.innerHTML = `
      <div style="font-size:12px;line-height:1.55;">
        <p><strong>Site Framing:</strong> "If a crew visited where Curiosity studied Mount Sharp." Gale crater is a rover site, not a human landing candidate. Primary science goal: ancient lake sediments and habitability / biosignature potential (organics in mudstones); boxwork unit (Altadena member) is a bonus stop.</p>
        <p><strong>Honesty &amp; Placeholders:</strong></p>
        <ul>
          <li><strong>Slope limits (20° / 15°):</strong> Illustrative lunar stand-ins (NASA Exploration EVA ConOps / LPSC 2023 #1413). DTM slope matches Curiosity rover tilt only weakly (5 m medians 9.0° vs 8.6° over 176 waypoints); keep a safety margin.</li>
          <li><strong>Suit O₂ &amp; Walking Time:</strong> Illustrative linear / Earth-hiking placeholders, not validated Mars suit models. The visor also shows a Pandolf metabolic stand-in (watts and L/min); it does not replace the O₂ percentage.</li>
          <li><strong>Walker physics:</strong> Suited mass is 180 kg; weight uses Gale crater gravity anchored at 3.717 m/s² (Lewis et al., Science 2019). Boot traction, facies friction, and sky-view shielding are illustrative stand-ins, not mapped geology or a radiation map.</li>
          <li><strong>Radiation Dose:</strong> Hassler et al. (Science 2014) Curiosity RAD baseline (0.64 ± 0.12 mSv/day) × EVA duration. No spatial rock radiation map.</li>
        </ul>
        <p><strong>Missions &amp; Datasets (fetched 2026-11-14):</strong></p>
        <ul>
          <li><strong>MRO HiRISE:</strong> 1 m DTM (<code>DTEEC_009149_1750_009294_1750_U01</code>) &amp; 25 cm orthoimage (<code>PSP_009149_1750_RED_A_01_ORTHO</code>, shown at ~0.5 m), fetched 2026-11-15. A 2.1 × 5.4 km corridor from the habitat to Glen Torridon is cut into 168 chunks of ~259 m; 1 m chunks stream in around you and an ~8 m overview covers the rest. The terrain is shifted ~60 m east-west and ~14 m north-south onto the Curiosity waypoint frame (fit to 478 waypoints; elevation residual spread 2.35 m), so stops and the traverse sit on the right rocks.</li>
          <li><strong>Lake-sediment stops (Glen Torridon):</strong> Glen Etive 1 (drilled Sol 2486) and Mary Anning 3 (drilled ~Sol 2870), placed at the rover's parked waypoint. Sources: NASA Curiosity blog posts for Sols 2485-2487 and 2870-2871; Bennett et al. 2023 (JGR Planets) for the lacustrine Murray context and the clay-bearing unit; Millan et al. 2022 (JGR Planets) for organics found by SAM in Glen Torridon samples. POV photos are Curiosity Navcam frames from those sols. Stops stay "example" until the team locks them.</li>
          <li><strong>Route:</strong> about 10 km round trip on a 5 m slope cost map from the same DTM (8-neighbour Dijkstra, 20° lunar stand-in limit). Distance is measured along the routed line. At the placeholder walking pace the walk takes about 12.6 h, longer than the 8 h EVA in NASA's lunar ConOps; a real crew would split it or drive part of it.</li>
          <li><strong>MRO CTX &amp; Odyssey THEMIS:</strong> Mars Trek WMTS mosaics (5 m CTX, 100 m Day/Night IR)</li>
          <li><strong>MRO CRISM:</strong> 9 MTRDR product records via PDS Geosciences ODE REST</li>
          <li><strong>MSL Curiosity:</strong> Traverse waypoints (1,389 sols), CAB/NASA REMS weather (4,745 sols), Navcam/Mastcam raw images</li>
          <li><strong>NASA DONKI:</strong> WSA-Enlil Mars impact simulations (cached 30-day window)</li>
          <li><strong>Astronaut model:</strong> NASA 3D Resources (github.com/nasa/NASA-3D-Resources), Advanced Crew Escape Suit or Mark III Spacesuit glTF, scaled to a 1.80 m astronaut. The NASA model has no skeleton, so the app builds one from the mesh with two-bone leg IK and procedural gait. Gale gravity (3.717 m/s²) drives jumps, falls, momentum, and dust settling. The walker never slides: steep grades only slow it, small ledges (under 0.45 m) are stepped onto and taller ones need a jump (gameplay values, not suit data).</li>
          <li><strong>Pressurized Rover &amp; Environment:</strong> Official NASA 3D Resources <code>Space Exploration Vehicle</code> (MMSEV Draco GLB, fetched 2026-11-14) with 4-point DEM slope alignment &amp; spring-damper suspension, plus REMS-inspired dust haze and surface wind gust particles.</li>
          <li><strong>Historic NASA Mars Rovers (5 sites):</strong> Perseverance (Jezero Crater, NASA 3D Resources <code>Mars 2020 Perseverance Rover.glb</code>, fetched 2026-11-14), Curiosity (Gale Crater Sol 4534 waypoint, MSL scale assembly), Spirit (Gusev Crater, MER-A assembly), Opportunity (Meridiani Planum, MER-B assembly), Sojourner (Ares Vallis, Pathfinder scale assembly). Off-Gale terrain sites use seeded procedural site relief rather than downloaded regional HiRISE tiles.</li>
          <li><strong>Shadows:</strong> crisp real-time sun shadows near the walker; further away, terrain shadows are precomputed by marching the HiRISE-derived height grid towards the sun.</li>
        </ul>
        <p><strong>Rendering:</strong> real-time WebGL rasterisation with physically based materials, shadow maps, ACES tone mapping and a helmet-camera lens pass (barrel distortion, chromatic aberration, grain, vignette). It is not ray tracing. The textured terrain colour is an illustrative Mars tint over greyscale HiRISE imagery. Terrain beyond the 2.1 × 5.4 km HiRISE corridor is a mirrored copy, not data. Close-range ground grain (wind ripples, pebbles, fractured mudstone slabs) is procedurally generated in the browser for visual texture only; it is not mapped geology.</p>
        <p><strong>Orbit view:</strong> globe texture is the NASA/USGS Viking MDIM 2.1 colour mosaic (alternate layer: MGS MOLA colour-shaded relief), stitched from NASA Mars Trek tiles at 4096×2048 (about 5 km per pixel) and bundled for offline use; during a landing zoom, online mode overlays ~330 m/px Viking tiles around the target. Day/night uses the real subsolar point from the NASA GISS Mars24 algorithm (Allison &amp; McEwen 2000). Mars orientation follows the IAU WGCCRE pole and prime meridian. Phobos and Deimos positions come from a series fitted to JPL Horizons vectors (agrees with Horizons to ~0.1°); their <em>sizes</em> are drawn 8× larger than scale so they are visible, while orbits are to scale. Sun, Earth and the bright stars are real directions; the faint background star field is decorative. Fine surface grain at very low altitude is procedural. Landing anywhere other than the Gale HiRISE tile uses seeded procedural relief, not mapped topography; the Bodycam sun then follows the real local true solar time of that spot (or a fixed 15:00 daylight mode).</p>
        <p><strong>2D map:</strong> MapLibre with Mars Trek CTX / THEMIS / MOLA tiles reprojected from Mars equirectangular, and hillshade / optional 3D tilt from the HiRISE-derived height preview. In demo-safe mode no tiles are fetched; an offline shaded relief is drawn from the local height grid.</p>
      </div>
    `;
    modalBackdrop.classList.add("open");
  }

  btnCredits.onclick = openCreditsModal;

  function openDevSettingsModal(initialTab) {
    if (document.pointerLockElement) {
      try {
        document.exitPointerLock?.();
      } catch {}
    }
    modalToggleKey = null;
    const validTabs = ["general", "graphics", "simulation", "controls", "developer"];
    const activeTab =
      typeof initialTab === "string" && validTabs.includes(initialTab)
        ? initialTab
        : validTabs.includes(currentSettingsTab)
          ? currentSettingsTab
          : "general";
    currentSettingsTab = activeTab;

    const tr = readLang() === "tr";
    const s = loadDevSettings();
    const audio = typeof window !== "undefined" ? window.MartianAudio : null;
    const isMuted = audio ? Boolean(audio.isMuted?.()) : Boolean(s.audioMuted);
    const isMusicOn = audio ? Boolean(audio.isMusicEnabled?.()) : s.audioMusic !== false;

    modalCard?.classList.add("settings-modal");
    modalTitle.textContent = tr ? "AYARLAR" : "SETTINGS";

    const hudSunTxt = document.getElementById("hud-sun-btn")?.textContent?.trim() || (tr ? "Güneş: gündüz" : "Sun: day");
    const hudGoldEl = document.getElementById("hud-gold-btn");
    const hudLampEl = document.getElementById("hud-lamp-btn");
    const hudTexTxt = document.getElementById("hud-tex")?.textContent?.trim() || (tr ? "Doku: kabartma" : "Tex: relief");

    modalBody.innerHTML = `
      <div class="dev-panel">
        <div class="settings-tabs" role="tablist" aria-label="${tr ? "Ayar Sekmeleri" : "Settings Tabs"}">
          <button class="settings-tab ${activeTab === "general" ? "active" : ""}" type="button" role="tab" data-settings-tab="general">
            ${tr ? "Genel & Arayüz" : "General & HUD"}
          </button>
          <button class="settings-tab ${activeTab === "graphics" ? "active" : ""}" type="button" role="tab" data-settings-tab="graphics">
            ${tr ? "Grafik" : "Graphics"}
          </button>
          <button class="settings-tab ${activeTab === "simulation" ? "active" : ""}" type="button" role="tab" data-settings-tab="simulation">
            ${tr ? "Ses, Fizik & Hava" : "Audio, Physics & Weather"}
          </button>
          <button class="settings-tab ${activeTab === "controls" ? "active" : ""}" type="button" role="tab" data-settings-tab="controls">
            ${tr ? "Kontroller & Kumanda" : "Controls & Gamepad"}
          </button>
          <button class="settings-tab ${activeTab === "developer" ? "active" : ""}" type="button" role="tab" data-settings-tab="developer">
            ${tr ? "Geliştirici" : "Developer"}
          </button>
        </div>

        <div class="dev-note">
          ${
            tr
              ? "Tüm görünüm, grafik, ses, fizik, kontrol ve geliştirici ayarları tek merkezde toplanmıştır. Değişiklikler anlık olarak uygulanır ve tarayıcıda saklanır."
              : "All display, graphics, audio, physics, control, and developer settings in one place. Changes apply live and persist locally in your browser."
          }
        </div>

        <!-- TAB 1: GENERAL & HUD -->
        <div class="settings-tab-pane ${activeTab === "general" ? "active" : ""}" data-settings-pane="general">
          <div class="dev-sec-title">${tr ? "Dil & Tema" : "Language & Theme"}</div>

          <div class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Arayüz Dili" : "Interface Language"}</div>
              <div class="dev-sub">${
                tr
                  ? "Menü, ayarlar ve astronot diyalog dilini değiştirir (veri kaynak atıfları İngilizce kalır)."
                  : "Switches menus, settings, and astronaut dialogue between English and Turkish (source citations stay in English)."
              }</div>
            </div>
            <span class="dev-presets">
              <button class="btn dev-theme-btn ${!tr ? "active" : ""}" type="button" data-settings-lang="en">English (EN)</button>
              <button class="btn dev-theme-btn ${tr ? "active" : ""}" type="button" data-settings-lang="tr">Türkçe (TR)</button>
            </span>
          </div>

          <div class="dev-row">
            <div>
              <div class="dev-label">${tr ? "HUD Görsel Teması" : "HUD Visual Theme"}</div>
              <div class="dev-sub">${
                tr
                  ? "Buz mavisi vizör camı, Untitled mavi-siyah veya sade siyah-beyaz arayüz arasında geçer."
                  : "Switches between Ice-Cyan glass, Untitled blue-on-black, and Monochrome UI."
              }</div>
            </div>
            <span class="dev-presets">
              <button class="btn dev-theme-btn" type="button" data-hud-theme="cyan">${getThemeLabel("cyan", tr)}</button>
              <button class="btn dev-theme-btn" type="button" data-hud-theme="untitled">${getThemeLabel("untitled", tr)}</button>
              <button class="btn dev-theme-btn" type="button" data-hud-theme="mono">${getThemeLabel("mono", tr)}</button>
            </span>
          </div>

          <div class="dev-sec-title">${tr ? "Kamera & Vizör" : "Camera & Visor"}</div>

          <div class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Kamera Görüş Açısı (FOV)" : "Camera Field of View (FOV)"}</div>
              <div class="dev-sub"><span id="dev-fov-val">${Math.round(s.fov)}°</span></div>
            </div>
            <input class="dev-range" type="range" id="dev-fov" min="60" max="110" step="1" value="${s.fov}" />
          </div>

          <label class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Vizör & Optik Lens Efekti" : "Visor & Optical Lens Effects"}</div>
              <div class="dev-sub">${
                tr
                  ? "Kask camı kenar çerçevesi, kromatik sapma, hafif film greni ve vinyet."
                  : "Helmet glass vignette frame, subtle barrel distortion, chromatic aberration, and grain."
              }</div>
            </div>
            <input type="checkbox" id="dev-frame-toggle" ${s.frameEffect ? "checked" : ""} />
          </label>

          <div class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Çerçeve / Lens Şiddeti" : "Lens & Frame Strength"}</div>
              <div class="dev-sub"><span id="dev-frame-strength-val">${Math.round(s.frameStrength * 100)}%</span></div>
            </div>
            <input class="dev-range" type="range" id="dev-frame-strength" min="0.2" max="1.5" step="0.05" value="${s.frameStrength}" />
          </div>

          <label class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Sade Kamera (HUD Metinlerini Gizle)" : "Clean Camera (Hide HUD Telemetry)"}</div>
              <div class="dev-sub">${
                tr ? "3D ekrandaki telemetri yazılarını temiz ekran görüntüsü için gizler." : "Hides telemetry text overlays in 3D view for clean capture."
              }</div>
            </div>
            <input type="checkbox" id="dev-clean-hud" ${s.cleanHud ? "checked" : ""} />
          </label>

          <div class="dev-sec-title">${tr ? "Kask Optikleri & Arazi Katmanı" : "Suit Optics & Surface Layer"}</div>

          <div class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Güneş & Aydınlatma Modu" : "Sun & Lighting Mode"}</div>
              <div class="dev-sub">${
                tr
                  ? "Sabit 15:00 gündüz aydınlatması ile gerçek yerel Mars güneş zamanı arasında geçiş yapar."
                  : "Toggles between fixed 15:00 daylight and real local Mars true solar time."
              }</div>
            </div>
            <button class="btn dev-theme-btn" type="button" id="settings-sun-btn">${hudSunTxt}</button>
          </div>

          <div class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Kask Filtresi & El Feneri" : "Helmet Visor Filter & Flashlight"}</div>
              <div class="dev-sub">${
                tr
                  ? "Altın güneş filtresi (G) ve kask LED el fenerini (F) açıp kapatır."
                  : "Toggles the gold sun visor filter (G) and suit LED headlamp (F)."
              }</div>
            </div>
            <span class="dev-presets">
              <button class="btn dev-theme-btn ${hudGoldEl?.classList.contains("active") ? "active" : ""}" type="button" id="settings-gold-btn">
                ${hudGoldEl?.textContent?.trim() || (tr ? "Altın Vizör (G)" : "Gold (G)")}
              </button>
              <button class="btn dev-theme-btn ${hudLampEl?.classList.contains("active") ? "active" : ""}" type="button" id="settings-lamp-btn">
                ${hudLampEl?.textContent?.trim() || (tr ? "El Feneri (F)" : "Flashlight (F)")}
              </button>
            </span>
          </div>

          <div class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Arazi Yüzey Katmanı" : "Terrain Surface Layer"}</div>
              <div class="dev-sub">${
                tr
                  ? "HiRISE kabartma, Mars dokulu görünüm ve eğim haritası arasında geçiş yapar."
                  : "Cycles between HiRISE shaded relief, Mars textured surface, and slope map."
              }</div>
            </div>
            <button class="btn dev-theme-btn" type="button" id="settings-tex-btn">${hudTexTxt}</button>
          </div>
        </div>

        <!-- TAB 2: GRAPHICS -->
        <div class="settings-tab-pane ${activeTab === "graphics" ? "active" : ""}" data-settings-pane="graphics">
          <div class="dev-sec-title">${tr ? "Kalite & Çözünürlük" : "Quality & Resolution"}</div>

          <label class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Grafik Ön Ayarı" : "Graphics preset"}</div>
              <div class="dev-sub">${
                tr
                  ? "Otomatik, ekran kartına göre seçer. Düşük: eski ve tümleşik kartlar için (gölge haritası yok, yakın arazi, %75 çözünürlük). Ultra: 4096 px yumuşak gölgeler, kayalar, 1.25× çözünürlük."
                  : "Auto picks one from your GPU. Low suits older and integrated GPUs (no shadow map, near terrain only, 75 % resolution). Ultra adds 4096 px soft shadows, rocks and 1.25× resolution."
              }</div>
            </div>
            <select id="dev-quality">
              <option value="auto">${tr ? "Otomatik" : "Auto"}</option>
              <option value="low">${tr ? "Düşük" : "Low"}</option>
              <option value="medium">${tr ? "Orta" : "Medium"}</option>
              <option value="high">${tr ? "Yüksek" : "High"}</option>
              <option value="ultra">Ultra</option>
            </select>
          </label>

          <label class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Gölgeler" : "Shadows"}</div>
              <div class="dev-sub">${
                tr
                  ? "Güneşin giysi, araç ve üs gölgeleri. Arazi gölgeleri her ayarda kalır."
                  : "Sun shadows of the suit, rovers and habitat. Terrain shadows stay on at every setting."
              }</div>
            </div>
            <select id="dev-gfx-shadows" data-gfx="gfxShadows">
              <option value="auto">${tr ? "Ön ayardaki" : "From preset"}</option>
              <option value="off">${tr ? "Kapalı" : "Off"}</option>
              <option value="low">${tr ? "Düşük (1024 px)" : "Low (1024 px)"}</option>
              <option value="high">${tr ? "Yüksek (2048 px)" : "High (2048 px)"}</option>
              <option value="ultra">${tr ? "Ultra (4096 px, yumuşak)" : "Ultra (4096 px, soft)"}</option>
            </select>
          </label>

          <label class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Ayrıntılı Arazi Mesafesi" : "Detailed terrain distance"}</div>
              <div class="dev-sub">${
                tr
                  ? "1 m HiRISE arazisinin çizildiği yarıçap. Ötesinde 8 m genel görünüm kullanılır."
                  : "Radius drawn from the 1 m HiRISE terrain. Beyond it the 8 m overview is used."
              }</div>
            </div>
            <select id="dev-gfx-distance" data-gfx="gfxViewDistance">
              <option value="auto">${tr ? "Ön ayardaki" : "From preset"}</option>
              <option value="near">350 m</option>
              <option value="medium">600 m</option>
              <option value="far">850 m</option>
              <option value="max">1000 m</option>
            </select>
          </label>

          <label class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Çözünürlük" : "Render resolution"}</div>
              <div class="dev-sub">${
                tr
                  ? "3D sahnenin çözünürlüğü. Ön ayarda bırakılırsa kare hızı düşünce kendiliğinden azalır; elle seçilen değer sabit kalır."
                  : "Resolution of the 3D scene. Left on the preset it lowers itself when frames run slow; a value chosen here stays fixed."
              }</div>
            </div>
            <select id="dev-gfx-scale" data-gfx="gfxRenderScale">
              <option value="auto">${tr ? "Ön ayardaki" : "From preset"}</option>
              <option value="0.5">50 %</option>
              <option value="0.75">75 %</option>
              <option value="1">100 %</option>
              <option value="1.25">125 %</option>
            </select>
          </label>

          <label class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Kenar Yumuşatma" : "Anti-aliasing"}</div>
              <div class="dev-sub">${tr ? "Sahne üzerinde MSAA örnek sayısı." : "MSAA samples on the scene."}</div>
            </div>
            <select id="dev-gfx-aa" data-gfx="gfxAntialias">
              <option value="auto">${tr ? "Ön ayardaki" : "From preset"}</option>
              <option value="0">${tr ? "Kapalı" : "Off"}</option>
              <option value="2">2×</option>
              <option value="4">4×</option>
            </select>
          </label>

          <label class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Kare Hızı Sınırı" : "Frame rate limit"}</div>
              <div class="dev-sub">${
                tr
                  ? "Yüksek yenileme hızlı ekranlarda ekran kartı yükünü ve ısıyı azaltır."
                  : "Cuts GPU load and heat on high refresh rate screens."
              }</div>
            </div>
            <select id="dev-fps-limit" data-gfx="fpsLimit">
              <option value="0">${tr ? "Ekranın hızı" : "Screen rate"}</option>
              <option value="30">30 fps</option>
              <option value="60">60 fps</option>
              <option value="120">120 fps</option>
            </select>
          </label>

          <div class="dev-sec-title">${tr ? "Gelişmiş Yüzey & Işın İzleme" : "Advanced Surface & Ray Tracing"}</div>

          <label class="dev-row">
            <div>
              <div class="dev-label">
                ${tr ? "Gerçekçi Dokular (PBR+)" : "Realistic Textures (PBR+)"}
              </div>
              <div class="dev-sub">${
                tr
                  ? "512 px yüksek çözünürlüklü prosedürel regolit ve çatlak kiltaşı normal haritası, derin kırık kontrastı, mineral parıltısı ve uzay giysisi mikro dokusunu açar."
                  : "Upgrades terrain to 512 px procedural regolith & fractured mudstone normal maps, deep crack relief, mineral sheen & suit weave detail."
              }</div>
            </div>
            <input type="checkbox" id="dev-realistic-tex" ${s.realisticTextures ? "checked" : ""} />
          </label>

          <label class="dev-row dev-row-exp">
            <div>
              <div class="dev-label">
                ${tr ? "Gerçek Zamanlı Işın İzleme (Ray Tracing)" : "Real-Time Ray Tracing"}
                <span class="dev-badge-exp">${tr ? "GPU RT" : "GPU RT"}</span>
              </div>
              <div class="dev-sub">${
                tr
                  ? "5 kademeli ölçeklenebilir RT sistemi: KAPALI, PERFORMANS (0.5× · 60+ FPS RTX 4060), DENGELİ (0.7×), YÜKSEK (1.0×) ve ULTRA (Sınırsız · 4+ sekme · 128 adım). R tuşu veya HUD rozeti ile geçiş yapın."
                  : "5-tier scalable RT pipeline: OFF, PERFORMANCE (0.5× · 60+ FPS RTX 4060), BALANCED (0.7×), HIGH (1.0× native), and ULTRA (Unlimited · 4+ bounces · 128 steps). Press R or click the HUD pill to cycle."
              }</div>
            </div>
            <select id="dev-ray-tracing">
              <option value="off" ${(s.rayTracingMode || "off") === "off" ? "selected" : ""}>${tr ? "Seviye 0: Kapalı (OFF)" : "Tier 0: OFF"}</option>
              <option value="performance" ${s.rayTracingMode === "performance" ? "selected" : ""}>${tr ? "Seviye 1: Performans (0.5×)" : "Tier 1: PERFORMANCE (0.5×)"}</option>
              <option value="balanced" ${s.rayTracingMode === "balanced" ? "selected" : ""}>${tr ? "Seviye 2: Dengeli (0.7×)" : "Tier 2: BALANCED (0.7×)"}</option>
              <option value="high" ${s.rayTracingMode === "high" ? "selected" : ""}>${tr ? "Seviye 3: Yüksek (1.0×)" : "Tier 3: HIGH (1.0×)"}</option>
              <option value="ultra" ${s.rayTracingMode === "ultra" ? "selected" : ""}>${tr ? "Seviye 4: Ultra (Sınırsız)" : "Tier 4: ULTRA (Unlimited)"}</option>
            </select>
          </label>

          <label class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Performans Bilgisini Göster" : "Show performance stats"}</div>
              <div class="dev-sub">${
                tr
                  ? "Kare hızı, çizim çağrıları, üçgenler ve bellekteki geometri / doku sayısı. Kısayol: F3."
                  : "Frame rate, draw calls, triangles, and the geometries and textures held in memory. Shortcut: F3."
              }</div>
            </div>
            <input type="checkbox" id="dev-show-perf" ${s.showPerf ? "checked" : ""} />
          </label>
        </div>

        <!-- TAB 3: AUDIO, PHYSICS & WEATHER -->
        <div class="settings-tab-pane ${activeTab === "simulation" ? "active" : ""}" data-settings-pane="simulation">
          <div class="dev-sec-title">${tr ? "Ses & Atmosfer Müziği" : "Audio & Ambience"}</div>

          <label class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Ana Ses & Efektler" : "Master Procedural Audio"}</div>
              <div class="dev-sub">${
                tr
                  ? "Mars rüzgarı, adım sesleri, kask solunumu, telsiz sesleri ve arayüz ses efektlerini açar."
                  : "Enables WebAudio Martian wind, suit breathing, footsteps, rover drive, and UI telemetry chimes."
              }</div>
            </div>
            <input type="checkbox" id="dev-audio-master" ${!isMuted ? "checked" : ""} />
          </label>

          <label class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Uzay & Mars Ambient Müziği" : "Ambient Space Music"}</div>
              <div class="dev-sub">${
                tr
                  ? "Arka planda hafif prosedürel uzay ve Mars ambiyans akorlarını çalar."
                  : "Plays gentle procedural space & Martian harmonic pads in the background."
              }</div>
            </div>
            <input type="checkbox" id="dev-audio-music" ${isMusicOn ? "checked" : ""} />
          </label>

          <div class="dev-sec-title">${tr ? "Mars Fizikleri & Atmosfer" : "Mars Physics & Atmosphere"}</div>

          <label class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Gerçekçi Mars Fizikleri (Momentum & Süspansiyon)" : "Realistic Mars Physics (Momentum, Ledges & Suspension)"}</div>
              <div class="dev-sub">${
                tr
                  ? "Adım ataleti/momentumu, yokuşta yavaşlama, basamak/çıkıntı tırmanma, iniş tepkisi ve rover süspansiyon yaylanmasını uygular."
                  : "Applies walker inertia/momentum, grade slowdown, ledge step-up, landing shock & rover spring-damper suspension."
              }</div>
            </div>
            <input type="checkbox" id="dev-realistic-physics" ${s.realisticPhysics ? "checked" : ""} />
          </label>

          <label class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Gerçekçi Toz Efektleri (Ayak, Tekerlek & Rüzgar)" : "Realistic Mars Dust FX (Boots, Wheels & Wind)"}</div>
              <div class="dev-sub">${
                tr
                  ? "Rüzgarla sürüklenen Mars aerosol toz tanecikleri ile adım, iniş ve tekerlek toz bulutlarını açar."
                  : "Enables wind-drifted Martian aerosol dust grains plus bootstep, landing impact & wheel dust plumes."
              }</div>
            </div>
            <input type="checkbox" id="dev-realistic-dust" ${s.realisticDust ? "checked" : ""} />
          </label>

          <label class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Gerçekçi Mars Havası (Atmosferik Pus & Rüzgar)" : "Realistic Mars Weather (Atmospheric Haze & Gusts)"}</div>
              <div class="dev-sub">${
                tr
                  ? "REMS verisiyle kalibreli tereyağı-hardal Mars atmosfer pusu ve döngüsel toz fırtınası rüzgarlarını simüle eder."
                  : "Simulates REMS-calibrated butterscotch Martian dust haze fog and dynamic surface wind gust fronts."
              }</div>
            </div>
            <input type="checkbox" id="dev-realistic-weather" ${s.realisticWeather ? "checked" : ""} />
          </label>

          <div class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Toz Optik Derinliği τ" : "Dust optical depth τ"}</div>
              <div class="dev-sub">
                <span id="dev-tau-val">${s.dustTau.toFixed(2)}</span>
                <span class="dev-presets">
                  <button class="btn dev-tau-preset" type="button" data-tau="0.5">${tr ? "0.5 Açık" : "0.5 Clear"}</button>
                  <button class="btn dev-tau-preset" type="button" data-tau="1.2">${tr ? "1.2 Puslu" : "1.2 Hazy"}</button>
                  <button class="btn dev-tau-preset" type="button" data-tau="2.8">${tr ? "2.8 Fırtına" : "2.8 Storm"}</button>
                </span>
              </div>
            </div>
            <input class="dev-range" type="range" id="dev-tau" min="0.35" max="3" step="0.05" value="${s.dustTau}" />
          </div>

          <label class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Toz Şeytanı" : "Dust devil"}</div>
              <div class="dev-sub">${
                tr ? "Tek bir görsel sütun. REMS girdabı değil." : "One visual column. Not a REMS vortex replay."
              }</div>
            </div>
            <input type="checkbox" id="dev-devil" ${s.dustDevil ? "checked" : ""} />
          </label>
        </div>

        <!-- TAB 4: CONTROLS & GAMEPAD -->
        <div class="settings-tab-pane ${activeTab === "controls" ? "active" : ""}" data-settings-pane="controls">
          <div class="dev-sec-title">${tr ? "Oyun Kumandası (Gamepad) Ayarları" : "Gamepad Configuration"}</div>
          <div id="settings-pad-mount" class="settings-pad-mount"></div>

          <div class="dev-sec-title" style="margin-top:8px;">${tr ? "Klavye & Fare Kısayolları" : "Keyboard & Mouse Shortcuts"}</div>
          <div class="kbd-grid">
            <div class="kbd-row"><span>${tr ? "Hareket / Sürüş" : "Move / Drive"}</span><kbd class="kbd-key">W A S D</kbd></div>
            <div class="kbd-row"><span>${tr ? "Koşu / Hızlanma" : "Sprint / Boost"}</span><kbd class="kbd-key">Shift</kbd></div>
            <div class="kbd-row"><span>${tr ? "Zıplama / El Freni" : "Jump / Handbrake"}</span><kbd class="kbd-key">Space</kbd></div>
            <div class="kbd-row"><span>${tr ? "Araca Bin / Astronotla Konuş" : "Board Rover / Talk to Crew"}</span><kbd class="kbd-key">E / RB</kbd></div>
            <div class="kbd-row"><span>${tr ? "1. / 3. Şahıs Kamera" : "1st / 3rd Person Camera"}</span><kbd class="kbd-key">V</kbd></div>
            <div class="kbd-row"><span>${tr ? "El Feneri" : "Suit Flashlight"}</span><kbd class="kbd-key">F</kbd></div>
            <div class="kbd-row"><span>${tr ? "Altın Güneş Vizörü" : "Gold Sun Visor"}</span><kbd class="kbd-key">G</kbd></div>
            <div class="kbd-row"><span>${tr ? "Optik Büyütme (Zoom)" : "Optical Zoom"}</span><kbd class="kbd-key">Z</kbd></div>
            <div class="kbd-row"><span>${tr ? "Ray Tracing Kademesi" : "Cycle Ray Tracing Tier"}</span><kbd class="kbd-key">R</kbd></div>
            <div class="kbd-row"><span>${tr ? "Yörünge Görünümü" : "Orbit View"}</span><kbd class="kbd-key">M / O</kbd></div>
            <div class="kbd-row"><span>${tr ? "Yol İşareti Bırak" : "Drop Waypoint Pin"}</span><kbd class="kbd-key">P</kbd></div>
            <div class="kbd-row"><span>${tr ? "Performans İstatistikleri" : "Performance Stats"}</span><kbd class="kbd-key">F3</kbd></div>
          </div>
        </div>

        <!-- TAB 5: DEVELOPER -->
        <div class="settings-tab-pane ${activeTab === "developer" ? "active" : ""}" data-settings-pane="developer">
          <div class="dev-sec-title">${tr ? "Simülasyon Hız Çarpanları" : "Simulation Speed Multipliers"}</div>

          <div class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Yürüyüş & Koşu Hızı" : "Walk / Run Speed Multiplier"}</div>
              <div class="dev-sub">
                <span id="dev-speed-val">${s.speedMultiplier.toFixed(2)}×</span>
                <span class="dev-presets">
                  <button class="btn dev-preset" type="button" data-speed="1">1×</button>
                  <button class="btn dev-preset" type="button" data-speed="2.5">2.5×</button>
                  <button class="btn dev-preset" type="button" data-speed="5">5×</button>
                </span>
              </div>
            </div>
            <input class="dev-range" type="range" id="dev-speed" min="0.5" max="8" step="0.25" value="${s.speedMultiplier}" />
          </div>

          <div class="dev-row">
            <div>
              <div class="dev-label">${tr ? "Araç (Rover) Sürüş Hızı" : "Rover Drive Speed Multiplier"}</div>
              <div class="dev-sub">
                <span id="dev-rover-speed-val">${s.roverSpeedMultiplier.toFixed(2)}×</span>
                <span class="dev-presets">
                  <button class="btn dev-rover-preset" type="button" data-rover-speed="0.5">0.5×</button>
                  <button class="btn dev-rover-preset" type="button" data-rover-speed="1">1×</button>
                  <button class="btn dev-rover-preset" type="button" data-rover-speed="1.5">1.5×</button>
                  <button class="btn dev-rover-preset" type="button" data-rover-speed="2.5">2.5×</button>
                  <button class="btn dev-rover-preset" type="button" data-rover-speed="3.5">3.5×</button>
                </span>
              </div>
            </div>
            <input class="dev-range" type="range" id="dev-rover-speed" min="0.3" max="4" step="0.1" value="${s.roverSpeedMultiplier}" />
          </div>

          <div class="dev-sec-title">${tr ? "Deneysel Özellikler" : "Experimental Features"}</div>

          <label class="dev-row dev-row-exp">
            <div>
              <div class="dev-label">
                ${tr ? "Deneysel Mars Aracı — NASA MMSEV (Yanında Doğar)" : "Experimental Mars Rover — NASA MMSEV (Spawns Beside You)"}
                <span class="dev-badge-exp">${tr ? "DENEYSEL" : "EXPERIMENTAL"}</span>
              </div>
              <div class="dev-sub">${
                tr
                  ? "NASA 3D Resources gerçek basınçlı MMSEV aracını yanında oluşturur (katı çarpışma + süspansiyon + E tuşuyla sürüş)."
                  : "Spawns the official NASA 3D Resources pressurized MMSEV rover beside you (solid collision + suspension + press E to drive)."
              }</div>
            </div>
            <input type="checkbox" id="dev-exp-rover" ${s.experimentalRover ? "checked" : ""} />
          </label>

          <label class="dev-row dev-row-exp">
            <div>
              <div class="dev-label">
                ${tr ? "Süper Grafik Zorlaması (Ultra Override)" : "Super Graphics Override"}
                <span class="dev-badge-exp">${tr ? "DENEYSEL" : "EXPERIMENTAL"}</span>
              </div>
              <div class="dev-sub">${
                tr
                  ? "Otomatik grafik algılamasını devre dışı bırakıp tüm sahneyi Ultra ön ayarına zorlar."
                  : "Overrides automatic GPU tier detection and forces the Ultra preset across the scene."
              }</div>
            </div>
            <input type="checkbox" id="dev-super-gfx" ${s.superGraphics ? "checked" : ""} />
          </label>
        </div>

        <div class="dev-actions">
          <button class="btn primary" type="button" id="dev-full-realism">${tr ? "Tüm Gerçekçiliği Aç" : "Enable Full Realism"}</button>
          <button class="btn" type="button" id="dev-reset">${tr ? "Tümünü Varsayılana Sıfırla" : "Reset All Defaults"}</button>
        </div>
      </div>
    `;

    // Mount Gamepad Settings UI inside Tab 4
    const padMountEl = document.getElementById("settings-pad-mount");
    if (padMountEl) {
      activePadSettingsApi = mountGamepadSettings(padMountEl, {
        tr,
        showCloseButton: false,
      });
    }

    // Tab switching
    const tabBtns = [...modalBody.querySelectorAll(".settings-tab")];
    const tabPanes = [...modalBody.querySelectorAll(".settings-tab-pane")];
    const switchSettingsTab = (tabId) => {
      currentSettingsTab = tabId;
      for (const b of tabBtns) b.classList.toggle("active", b.dataset.settingsTab === tabId);
      for (const p of tabPanes) p.classList.toggle("active", p.dataset.settingsPane === tabId);
    };
    for (const b of tabBtns) {
      b.addEventListener("click", () => switchSettingsTab(b.dataset.settingsTab));
    }

    // Language buttons inside General tab
    modalBody.querySelectorAll("[data-settings-lang]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const nextLang = btn.dataset.settingsLang;
        if (nextLang && nextLang !== readLang()) {
          start.setLang(nextLang);
          openDevSettingsModal(currentSettingsTab);
        }
      });
    });

    // Suit Optics & Surface Layer buttons inside General tab
    const settingsSunBtn = document.getElementById("settings-sun-btn");
    const settingsGoldBtn = document.getElementById("settings-gold-btn");
    const settingsLampBtn = document.getElementById("settings-lamp-btn");
    const settingsTexBtn = document.getElementById("settings-tex-btn");
    const syncHudQuickButtons = () => {
      const sunEl = document.getElementById("hud-sun-btn");
      const goldEl = document.getElementById("hud-gold-btn");
      const lampEl = document.getElementById("hud-lamp-btn");
      const texEl = document.getElementById("hud-tex");
      if (settingsSunBtn && sunEl) settingsSunBtn.textContent = sunEl.textContent.trim();
      if (settingsGoldBtn && goldEl) {
        settingsGoldBtn.textContent = goldEl.textContent.trim();
        settingsGoldBtn.classList.toggle("active", goldEl.classList.contains("active"));
      }
      if (settingsLampBtn && lampEl) {
        settingsLampBtn.textContent = lampEl.textContent.trim();
        settingsLampBtn.classList.toggle("active", lampEl.classList.contains("active"));
      }
      if (settingsTexBtn && texEl) settingsTexBtn.textContent = texEl.textContent.trim();
      syncEscMenuUi();
    };
    settingsSunBtn?.addEventListener("click", () => {
      document.getElementById("hud-sun-btn")?.click();
      syncHudQuickButtons();
    });
    settingsGoldBtn?.addEventListener("click", () => {
      document.getElementById("hud-gold-btn")?.click();
      syncHudQuickButtons();
    });
    settingsLampBtn?.addEventListener("click", () => {
      document.getElementById("hud-lamp-btn")?.click();
      syncHudQuickButtons();
    });
    settingsTexBtn?.addEventListener("click", () => {
      document.getElementById("hud-tex")?.click();
      syncHudQuickButtons();
    });

    const frameToggle = document.getElementById("dev-frame-toggle");
    const frameStrength = document.getElementById("dev-frame-strength");
    const frameStrengthVal = document.getElementById("dev-frame-strength-val");
    const speedRange = document.getElementById("dev-speed");
    const speedVal = document.getElementById("dev-speed-val");
    const roverSpeedRange = document.getElementById("dev-rover-speed");
    const roverSpeedVal = document.getElementById("dev-rover-speed-val");
    const qualitySel = document.getElementById("dev-quality");
    const gfxSelects = [...modalBody.querySelectorAll("select[data-gfx]")];
    const perfToggle = document.getElementById("dev-show-perf");
    const rtToggle = document.getElementById("dev-ray-tracing");
    const expRoverToggle = document.getElementById("dev-exp-rover");
    const superGfxToggle = document.getElementById("dev-super-gfx");
    const realisticTexToggle = document.getElementById("dev-realistic-tex");
    const realisticDustToggle = document.getElementById("dev-realistic-dust");
    const realisticPhysicsToggle = document.getElementById("dev-realistic-physics");
    const realisticWeatherToggle = document.getElementById("dev-realistic-weather");
    const audioMasterToggle = document.getElementById("dev-audio-master");
    const audioMusicToggle = document.getElementById("dev-audio-music");
    const fovRange = document.getElementById("dev-fov");
    const fovVal = document.getElementById("dev-fov-val");
    const tauRange = document.getElementById("dev-tau");
    const tauVal = document.getElementById("dev-tau-val");
    const devilToggle = document.getElementById("dev-devil");
    const cleanToggle = document.getElementById("dev-clean-hud");
    const fullRealismBtn = document.getElementById("dev-full-realism");
    const resetBtn = document.getElementById("dev-reset");
    const themeBtns = [...modalBody.querySelectorAll(".dev-theme-btn[data-hud-theme]")];

    const syncUi = (cfg) => {
      for (const btn of themeBtns) {
        btn.classList.toggle("active", btn.dataset.hudTheme === (cfg.hudTheme || "cyan"));
      }
      if (frameToggle) frameToggle.checked = cfg.frameEffect;
      if (frameStrength) {
        frameStrength.value = String(cfg.frameStrength);
        frameStrength.disabled = !cfg.frameEffect;
      }
      if (frameStrengthVal) frameStrengthVal.textContent = `${Math.round(cfg.frameStrength * 100)}%`;
      if (speedRange) speedRange.value = String(cfg.speedMultiplier);
      if (speedVal) speedVal.textContent = `${cfg.speedMultiplier.toFixed(2)}×`;
      if (roverSpeedRange) roverSpeedRange.value = String(cfg.roverSpeedMultiplier);
      if (roverSpeedVal) roverSpeedVal.textContent = `${cfg.roverSpeedMultiplier.toFixed(2)}×`;
      if (qualitySel) qualitySel.value = cfg.superGraphics ? "ultra" : cfg.quality;
      for (const sel of gfxSelects) sel.value = String(cfg[sel.dataset.gfx]);
      if (perfToggle) perfToggle.checked = cfg.showPerf;
      if (rtToggle) rtToggle.value = cfg.rayTracingMode || (cfg.rayTracing ? "high" : "off");
      if (expRoverToggle) expRoverToggle.checked = cfg.experimentalRover;
      if (superGfxToggle) superGfxToggle.checked = Boolean(cfg.superGraphics);
      if (realisticTexToggle) realisticTexToggle.checked = cfg.realisticTextures;
      if (realisticDustToggle) realisticDustToggle.checked = cfg.realisticDust;
      if (realisticPhysicsToggle) realisticPhysicsToggle.checked = cfg.realisticPhysics;
      if (realisticWeatherToggle) realisticWeatherToggle.checked = cfg.realisticWeather;
      if (audioMasterToggle) audioMasterToggle.checked = !cfg.audioMuted;
      if (audioMusicToggle) {
        audioMusicToggle.checked = cfg.audioMusic !== false;
        audioMusicToggle.disabled = Boolean(cfg.audioMuted);
      }
      if (fovRange) fovRange.value = String(cfg.fov);
      if (fovVal) fovVal.textContent = `${Math.round(cfg.fov)}°`;
      if (tauRange) tauRange.value = String(cfg.dustTau);
      if (tauVal) tauVal.textContent = cfg.dustTau.toFixed(2);
      if (devilToggle) devilToggle.checked = cfg.dustDevil;
      if (cleanToggle) cleanToggle.checked = cfg.cleanHud;
    };

    syncUi(s);
    for (const btn of themeBtns) {
      btn.addEventListener("click", () => syncUi(saveDevSettings({ hudTheme: btn.dataset.hudTheme })));
    }
    frameToggle?.addEventListener("change", () => syncUi(saveDevSettings({ frameEffect: frameToggle.checked })));
    frameStrength?.addEventListener("input", () => syncUi(saveDevSettings({ frameStrength: parseFloat(frameStrength.value) })));
    speedRange?.addEventListener("input", () => syncUi(saveDevSettings({ speedMultiplier: parseFloat(speedRange.value) })));
    modalBody.querySelectorAll(".dev-preset").forEach((btn) => {
      btn.addEventListener("click", () => syncUi(saveDevSettings({ speedMultiplier: parseFloat(btn.dataset.speed) })));
    });
    roverSpeedRange?.addEventListener("input", () =>
      syncUi(saveDevSettings({ roverSpeedMultiplier: parseFloat(roverSpeedRange.value) }))
    );
    modalBody.querySelectorAll(".dev-rover-preset").forEach((btn) => {
      btn.addEventListener("click", () =>
        syncUi(saveDevSettings({ roverSpeedMultiplier: parseFloat(btn.dataset.roverSpeed) }))
      );
    });
    modalBody.querySelectorAll(".dev-tau-preset").forEach((btn) => {
      btn.addEventListener("click", () =>
        syncUi(saveDevSettings({ dustTau: parseFloat(btn.dataset.tau) }))
      );
    });
    qualitySel?.addEventListener("change", () =>
      syncUi(saveDevSettings({ quality: qualitySel.value, superGraphics: false }))
    );
    for (const sel of gfxSelects) {
      sel.addEventListener("change", () => syncUi(saveDevSettings({ [sel.dataset.gfx]: sel.value })));
    }
    perfToggle?.addEventListener("change", () => syncUi(saveDevSettings({ showPerf: perfToggle.checked })));
    rtToggle?.addEventListener("change", () =>
      syncUi(saveDevSettings({ rayTracingMode: rtToggle.value, rayTracing: rtToggle.value !== "off" }))
    );
    expRoverToggle?.addEventListener("change", () =>
      syncUi(saveDevSettings({ experimentalRover: expRoverToggle.checked }))
    );
    superGfxToggle?.addEventListener("change", () =>
      syncUi(saveDevSettings({ superGraphics: superGfxToggle.checked }))
    );
    realisticTexToggle?.addEventListener("change", () =>
      syncUi(saveDevSettings({ realisticTextures: realisticTexToggle.checked }))
    );
    realisticDustToggle?.addEventListener("change", () =>
      syncUi(saveDevSettings({ realisticDust: realisticDustToggle.checked }))
    );
    realisticPhysicsToggle?.addEventListener("change", () =>
      syncUi(saveDevSettings({ realisticPhysics: realisticPhysicsToggle.checked }))
    );
    realisticWeatherToggle?.addEventListener("change", () =>
      syncUi(saveDevSettings({ realisticWeather: realisticWeatherToggle.checked }))
    );
    audioMasterToggle?.addEventListener("change", () =>
      syncUi(saveDevSettings({ audioMuted: !audioMasterToggle.checked }))
    );
    audioMusicToggle?.addEventListener("change", () =>
      syncUi(saveDevSettings({ audioMusic: audioMusicToggle.checked }))
    );
    fovRange?.addEventListener("input", () => syncUi(saveDevSettings({ fov: parseFloat(fovRange.value) })));
    tauRange?.addEventListener("input", () => syncUi(saveDevSettings({ dustTau: parseFloat(tauRange.value) })));
    devilToggle?.addEventListener("change", () => syncUi(saveDevSettings({ dustDevil: devilToggle.checked })));
    cleanToggle?.addEventListener("change", () => syncUi(saveDevSettings({ cleanHud: cleanToggle.checked })));
    fullRealismBtn?.addEventListener("click", () => syncUi(saveDevSettings(FULL_REALISM_PRESET)));
    resetBtn?.addEventListener("click", () => {
      gamepad.reset();
      activePadSettingsApi?.refresh?.();
      syncUi(resetDevSettings());
    });

    modalBackdrop.classList.add("open");
  }
  openSettingsModalRef = openDevSettingsModal;

  const initDev = loadDevSettings();
  const visorOverlayEl = document.querySelector(".visor-overlay");
  if (visorOverlayEl) {
    visorOverlayEl.classList.toggle("no-frame", !initDev.frameEffect);
    visorOverlayEl.classList.toggle("clean-hud", Boolean(initDev.cleanHud));
  }

  let hudApi = null;
  let lastSelfPose = null;

  const mp = new MultiplayerClient({ demoSafe: data.demoSafe, role: "eva" });

  // ---------- Crew & EVA Multiplayer Drawer ----------
  const btnCrew = document.getElementById("btn-crew");
  const crewDrawer = document.getElementById("crew-drawer");
  const mpClose = document.getElementById("mp-close");
  const mpRoomIn = document.getElementById("mp-room");
  const mpCallsignIn = document.getElementById("mp-callsign");
  const mpJoinBtn = document.getElementById("mp-join");
  const mpInviteBtn = document.getElementById("mp-invite");
  const mpDropPingBtn = document.getElementById("mp-drop-ping");
  const mpSyncRouteBtn = document.getElementById("mp-sync-route");
  const mpClearPinsBtn = document.getElementById("mp-clear-pins");
  const mpTransportEl = document.getElementById("mp-transport");
  const mpLanHintEl = document.getElementById("mp-lan-hint");
  const mpRosterEl = document.getElementById("mp-roster");
  const mpChatLogEl = document.getElementById("mp-chat-log");
  const mpChatForm = document.getElementById("mp-chat-form");
  const mpChatInput = document.getElementById("mp-chat-input");
  const toastEl = document.getElementById("hud-comms-toast");

  if (mpRoomIn) mpRoomIn.value = mp.room;
  if (mpCallsignIn) mpCallsignIn.value = mp.callsign;

  let toastTimer = null;
  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.textContent = "";
    }, 5500);
  }

  function appendChatLine({ callsign, color, text }) {
    if (!mpChatLogEl) return;
    const row = document.createElement("div");
    row.className = "crew-chat-line";
    const badge = document.createElement("strong");
    badge.style.color = color || "var(--cyan)";
    badge.textContent = `[${callsign}] `;
    row.appendChild(badge);
    row.appendChild(document.createTextNode(text));
    mpChatLogEl.appendChild(row);
    while (mpChatLogEl.children.length > 40) mpChatLogEl.firstChild.remove();
    mpChatLogEl.scrollTop = mpChatLogEl.scrollHeight;
  }

  function renderCrewUi() {
    const status = mp.getStatusSummary();
    if (btnCrew) btnCrew.textContent = `Crew (${status.crewTotal})`;
    if (mpTransportEl) {
      mpTransportEl.textContent = status.transport;
      mpTransportEl.classList.toggle("live", status.wsConnected || status.peerCount > 0);
    }
    if (mpLanHintEl) {
      if (data.demoSafe) {
        mpLanHintEl.textContent = "Demo-Safe mode: offline same-browser tabs sync via BroadcastChannel (0 network requests).";
      } else if (status.lanUrls?.length > 0) {
        const invite = buildInviteUrl(window.location.href, mp.room, status.lanUrls[0]);
        mpLanHintEl.textContent = `LAN relay online · Share: ${invite}`;
      } else {
        mpLanHintEl.innerHTML =
          "Local tabs active. Start <code>scripts/start-app.sh</code> or <code>node scripts/server.mjs</code> for cross-device LAN.";
      }
    }
    if (mpRosterEl) {
      mpRosterEl.innerHTML = "";
      const selfRow = document.createElement("div");
      selfRow.className = "crew-row";
      // Text nodes only: the callsign can come from the ?callsign= URL parameter.
      const selfLeft = document.createElement("span");
      const selfDot = document.createElement("span");
      selfDot.className = "crew-dot";
      selfDot.style.background = mp.color;
      selfLeft.append(selfDot, `${mp.callsign} (YOU)`);
      const selfRole = document.createElement("span");
      selfRole.textContent = mp.role.toUpperCase();
      selfRow.append(selfLeft, selfRole);
      mpRosterEl.appendChild(selfRow);

      for (const peer of mp.peers.values()) {
        const row = document.createElement("div");
        row.className = "crew-row";
        const left = document.createElement("span");
        const dot = document.createElement("span");
        dot.className = "crew-dot";
        dot.style.background = peer.color || "var(--cyan)";
        left.appendChild(dot);
        let distTxt = peer.role?.toUpperCase() || "EVA";
        if (lastSelfPose?.lon != null && peer.state?.lon != null) {
          const d = marsDistanceM([lastSelfPose.lon, lastSelfPose.lat], [peer.state.lon, peer.state.lat]);
          distTxt = `${d.toFixed(0)} m`;
        }
        left.appendChild(document.createTextNode(`${peer.callsign} · ${distTxt}`));

        const right = document.createElement("span");
        if (peer.state && Number.isFinite(peer.state.lon) && Number.isFinite(peer.state.lat)) {
          const goBtn = document.createElement("button");
          goBtn.className = "btn";
          goBtn.style.padding = "2px 6px";
          goBtn.style.fontSize = "9.5px";
          goBtn.textContent = "Go To";
          goBtn.onclick = () => {
            hudApi?.teleportTo?.(peer.state.lon, peer.state.lat);
            switchToHud();
          };
          right.appendChild(goBtn);
        } else {
          right.textContent = peer.state?.freeRoam ? "FREE" : "ROUTE";
        }
        row.append(left, right);
        mpRosterEl.appendChild(row);
      }
    }
  }

  btnCrew?.addEventListener("click", () => {
    crewDrawer?.classList.toggle("open");
    renderCrewUi();
  });
  mpClose?.addEventListener("click", () => crewDrawer?.classList.remove("open"));
  mpJoinBtn?.addEventListener("click", async () => {
    await mp.connect({
      room: mpRoomIn?.value,
      callsign: mpCallsignIn?.value,
    });
    renderCrewUi();
    showToast(`Joined room ${mp.room} as ${mp.callsign}`);
  });
  mpInviteBtn?.addEventListener("click", async () => {
    const baseOrigin = mp.lanUrls?.[0] || null;
    const url = buildInviteUrl(window.location.href, mp.room, baseOrigin);
    try {
      await navigator.clipboard?.writeText(url);
      showToast(`Copied invite: ${url}`);
    } catch {
      window.prompt("Copy crew invite link:", url);
    }
  });
  mpDropPingBtn?.addEventListener("click", () => {
    if (hudApi?.dropLocalPing) {
      hudApi.dropLocalPing("Science Beacon");
    }
  });
  mpSyncRouteBtn?.addEventListener("click", () => {
    const sM = lastSelfPose?.alongM ?? 0;
    mp.sendRouteSync(sM, false);
    showToast(`Synced crew route timeline to ${sM.toFixed(0)} m`);
  });
  mpClearPinsBtn?.addEventListener("click", () => mp.clearPings());
  mpChatForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const txt = mpChatInput?.value || "";
    if (!txt.trim()) return;
    mp.sendChat(txt);
    if (mpChatInput) mpChatInput.value = "";
  });

  mp.on("status", () => {
    renderCrewUi();
  });
  mp.on("peerjoin", (peer) => {
    showToast(`${peer.callsign} joined EVA room ${mp.room}`);
    appendChatLine({ callsign: "SYS", color: "#34d399", text: `${peer.callsign} connected` });
    renderCrewUi();
  });
  mp.on("peerleave", (peer) => {
    showToast(`${peer.callsign} left EVA`);
    appendChatLine({ callsign: "SYS", color: "#94a3b8", text: `${peer.callsign} disconnected` });
    renderCrewUi();
  });
  mp.on("peerstate", () => {
    if (crewDrawer?.classList.contains("open")) renderCrewUi();
  });
  mp.on("pins", () => {});
  mp.on("ping", (pin) => {
    showToast(`${pin.by} dropped ${pin.label}`);
    appendChatLine({ callsign: pin.by, color: pin.color, text: `Dropped beacon (${pin.lat.toFixed(4)}°, ${pin.lon.toFixed(4)}°)` });
  });
  mp.on("chat", (msg) => {
    appendChatLine(msg);
    if (!msg.self) showToast(`${msg.callsign}: ${msg.text}`);
  });
  mp.on("routesync", (sync) => {
    hudApi?.syncAlongM?.(sync.alongM);
    showToast(`${sync.by || "CREW"} synced route to ${Number(sync.alongM).toFixed(0)} m`);
  });

  let orbitApi = null;
  function ensureOrbit() {
    if (orbitApi || !orbitView) return orbitApi;
    orbitApi = initOrbitView(orbitView, {
      demoSafe: data.demoSafe,
      isTr: () => readLang() === "tr",
      getPlayerLonLat: () => hudApi?.getLonLat?.() || (lastSelfPose?.lon != null ? lastSelfPose : null),
      onLand: (lon, lat, opts = {}) => landFromOrbit(lon, lat, opts),
    });
    return orbitApi;
  }

  /** Show exactly one of the two views ("hud" | "orbit"). */
  function switchView(name, opts = {}) {
    document.body.classList.toggle("in-hud", name === "hud");
    const views = { orbit: orbitView, hud: hudView };
    const tabs = { orbit: btnTabOrbit, hud: btnTabHud };
    for (const [k, el] of Object.entries(views)) el?.classList.toggle("active", k === name);
    for (const [k, el] of Object.entries(tabs)) el?.classList.toggle("active", k === name);
    if (name !== "orbit") orbitApi?.hide();
    if (name === "hud") {
      mp.setRole("eva");
      hudApi?.onResize();
    } else if (name === "orbit") {
      if (document.pointerLockElement) {
        try {
          document.exitPointerLock?.();
        } catch {}
      }
      ensureOrbit()?.show(opts);
    }
  }
  const switchToHud = () => switchView("hud");
  const switchToOrbit = () => {
    const from = hudView.classList.contains("active") ? hudApi?.getLonLat?.() : null;
    switchView("orbit", { from });
  };

  let pendingLanding = null;
  function landFromOrbit(lon, lat, { sunMode = "local", roverId = null, hardwareId = null, siteId = null, stopId = null, globeSample = null } = {}) {
    if (!hudApi) {
      // The 3D view is still loading (suit / terrain); land as soon as it is ready.
      pendingLanding = [lon, lat, { sunMode, roverId, hardwareId, siteId, stopId, globeSample }];
      switchView("hud");
      return;
    }
    if (siteId === "habitat" && hudApi.visitHabitatStation) {
      hudApi.visitHabitatStation({ sun: sunMode });
    } else if (hardwareId && hudApi.deployToHardwareSite) {
      // a lander marker: deploy to its hardware site (scale model + staging pad + return beacon)
      hudApi.deployToHardwareSite(hardwareId);
      hudApi.setSunMode?.(sunMode);
    } else if (roverId) {
      dispatchVisitRoverSite(roverId);
      hudApi.setSunMode?.(sunMode);
    } else {
      hudApi.visitLocation(lon, lat, { keepYaw: false, sun: sunMode, globeSample });
    }
    switchView("hud");
    hudApi.playArrivalDrop?.();
    const flash = document.createElement("div");
    flash.className = "arrival-flash";
    document.body.appendChild(flash);
    requestAnimationFrame(() => requestAnimationFrame(() => flash.classList.add("out")));
    setTimeout(() => flash.remove(), 1200);
  }

  let pendingIntro = false;
  const startEva = () => {
    if (data.route) dispatchSetRoute(data.route, 0);
    switchToHud();
    // land by rocket, then walk from the lander (plays once the 3D view has loaded)
    if (hudApi?.playLanding) hudApi.playLanding({ site: "GALE CRATER · MOUNT SHARP" });
    else pendingIntro = true;
  };

  btnTabHud.onclick = switchToHud;
  if (btnTabOrbit) btnTabOrbit.onclick = switchToOrbit;

  // ---------- ESC Command / Pause Menu ----------
  const escMenu = document.getElementById("esc-menu");
  const escSunBtn = document.getElementById("esc-sun");
  const escGoldBtn = document.getElementById("esc-gold");
  const escLampBtn = document.getElementById("esc-lamp");
  const escTexBtn = document.getElementById("esc-tex");
  const escCrewBtn = document.getElementById("esc-crew");
  const escRoversBtn = document.getElementById("esc-open-rovers");
  const escGoHudBtn = document.getElementById("esc-go-hud");
  const escGoOrbitBtn = document.getElementById("esc-go-orbit");

  function syncEscMenuUi() {
    if (!escMenu) return;
    const tr = readLang() === "tr";
    const inOrbit = Boolean(orbitView?.classList.contains("active"));
    const setText = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };
    setText("esc-title", tr ? "EVA KOMUT MENÜSÜ" : "EVA COMMAND MENU");
    setText(
      "esc-sub",
      inOrbit
        ? tr
          ? "MARS YÖRÜNGE GÖRÜNÜMÜ"
          : "MARS ORBIT VIEW"
        : tr
          ? "GALE KRATERİ · MOUNT SHARP"
          : "GALE CRATER · MOUNT SHARP"
    );
    setText("esc-resume", tr ? "Devam Et (ESC)" : "Resume (ESC)");
    setText("esc-lbl-views", tr ? "GÖRÜNÜMLER VE NAVİGASYON" : "VIEWS & NAVIGATION");
    setText("esc-lbl-eva", tr ? "EVA VE OPTİK KONTROLLER" : "EVA & OPTICS CONTROLS");
    setText("esc-lbl-system", tr ? "GÖREV VE AYARLAR" : "MISSION & SETTINGS");
    setText("esc-go-hud", tr ? "EVA Vücut Kamerası" : "EVA Bodycam");
    setText("esc-go-orbit", tr ? "Yörünge Görünümü (M)" : "Orbit View (M)");
    setText("esc-pin", tr ? "İşaret Bırak (P)" : "Drop Pin (P)");
    setText("esc-pov", tr ? "Gezgin POV Fotoğrafı" : "Rover POV");
    setText("esc-dev", tr ? "Ayarlar" : "Settings");
    setText("btn-pad", tr ? "Ayarlar" : "Settings");
    setText("esc-sources", tr ? "Kaynaklar ve Dürüstlük" : "Sources & Honesty");
    setText("esc-title-btn", tr ? "Başlangıç Ekranı" : "Title Screen");
    setText("esc-hint", tr ? "DEVAM ETMEK İÇİN ESC" : "PRESS ESC TO RESUME");

    const hudSun = document.getElementById("hud-sun-btn")?.textContent?.trim();
    const hudGold = document.getElementById("hud-gold-btn");
    const hudLamp = document.getElementById("hud-lamp-btn");
    const hudTex = document.getElementById("hud-tex")?.textContent?.trim();
    const hudFleet = document.getElementById("hud-fleet-btn")?.textContent?.trim();
    if (escSunBtn && hudSun) escSunBtn.textContent = hudSun;
    if (escGoldBtn) {
      escGoldBtn.textContent = hudGold?.textContent?.trim() || (tr ? "Altın Vizör (G)" : "Gold Visor (G)");
      escGoldBtn.classList.toggle("active", Boolean(hudGold?.classList.contains("active")));
    }
    if (escLampBtn) {
      escLampBtn.textContent = hudLamp?.textContent?.trim() || (tr ? "El Feneri (F)" : "Flashlight (F)");
      escLampBtn.classList.toggle("active", Boolean(hudLamp?.classList.contains("active")));
    }
    if (escTexBtn && hudTex) escTexBtn.textContent = hudTex;
    if (escRoversBtn && hudFleet) escRoversBtn.textContent = hudFleet;
    if (escCrewBtn && btnCrew) escCrewBtn.textContent = btnCrew.textContent.trim();
    escGoHudBtn?.classList.toggle("active", !inOrbit);
    escGoOrbitBtn?.classList.toggle("active", inOrbit);

    const lang = readLang();
    const lEn = document.getElementById("esc-lang-en");
    const lTr = document.getElementById("esc-lang-tr");
    if (lEn) lEn.style.color = lang === "en" ? "var(--cyan-bright)" : "";
    if (lTr) lTr.style.color = lang === "tr" ? "var(--cyan-bright)" : "";
  }
  syncEscMenuRef = syncEscMenuUi;

  function toggleEscMenu(force) {
    if (!escMenu) return;
    const next = typeof force === "boolean" ? force : !escMenu.classList.contains("open");
    if (next && document.pointerLockElement) {
      try {
        document.exitPointerLock?.();
      } catch {}
    }
    escMenu.classList.toggle("open", next);
    if (next) syncEscMenuUi();
  }

  document.getElementById("btn-menu")?.addEventListener("click", () => toggleEscMenu(true));
  document.getElementById("esc-resume")?.addEventListener("click", () => toggleEscMenu(false));
  escMenu?.addEventListener("click", (e) => {
    if (e.target === escMenu) toggleEscMenu(false);
  });
  escGoHudBtn?.addEventListener("click", () => {
    toggleEscMenu(false);
    switchToHud();
  });
  escGoOrbitBtn?.addEventListener("click", () => {
    toggleEscMenu(false);
    switchToOrbit();
  });
  escRoversBtn?.addEventListener("click", () => {
    toggleEscMenu(false);
    switchToHud();
    document.getElementById("hud-fleet-btn")?.click();
  });
  escSunBtn?.addEventListener("click", () => {
    document.getElementById("hud-sun-btn")?.click();
    syncEscMenuUi();
  });
  escGoldBtn?.addEventListener("click", () => {
    document.getElementById("hud-gold-btn")?.click();
    syncEscMenuUi();
  });
  escLampBtn?.addEventListener("click", () => {
    document.getElementById("hud-lamp-btn")?.click();
    syncEscMenuUi();
  });
  escTexBtn?.addEventListener("click", () => {
    document.getElementById("hud-tex")?.click();
    syncEscMenuUi();
  });
  document.getElementById("esc-pin")?.addEventListener("click", () => {
    toggleEscMenu(false);
    switchToHud();
    document.getElementById("hud-ping")?.click();
  });
  document.getElementById("esc-pov")?.addEventListener("click", () => {
    document.getElementById("hud-pov-btn")?.click();
  });
  escCrewBtn?.addEventListener("click", () => {
    toggleEscMenu(false);
    crewDrawer?.classList.add("open");
    renderCrewUi();
  });
  document.getElementById("esc-dev")?.addEventListener("click", () => {
    toggleEscMenu(false);
    openDevSettingsModal();
  });
  document.getElementById("esc-sources")?.addEventListener("click", () => {
    toggleEscMenu(false);
    openCreditsModal();
  });
  document.getElementById("esc-title-btn")?.addEventListener("click", () => {
    toggleEscMenu(false);
    start.show();
  });
  document.getElementById("esc-lang-en")?.addEventListener("click", () => start.setLang("en"));
  document.getElementById("esc-lang-tr")?.addEventListener("click", () => start.setLang("tr"));

  window.addEventListener("keydown", (e) => {
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
    const k = e.key?.toLowerCase?.() || "";
    if (document.body.classList.contains("landing-active")) return; // keys only skip the landing

    if (!e.repeat && modalBackdrop.classList.contains("open") && modalToggleKey && k === modalToggleKey) {
      e.preventDefault();
      e.stopImmediatePropagation?.();
      closeModal();
      return;
    }

    if (e.key === "Escape") {
      if (document.getElementById("npc-dialogue-modal")?.classList.contains("open")) {
        return;
      }
      if (modalBackdrop.classList.contains("open")) {
        e.preventDefault();
        e.stopImmediatePropagation?.();
        closeModal();
        return;
      }
      if (crewDrawer?.classList.contains("open")) {
        e.preventDefault();
        e.stopImmediatePropagation?.();
        crewDrawer.classList.remove("open");
        return;
      }
      if (escMenu?.classList.contains("open")) {
        e.preventDefault();
        e.stopImmediatePropagation?.();
        toggleEscMenu(false);
        return;
      }
      if (document.pointerLockElement) return;
      const startScreen = document.getElementById("start-screen");
      if (startScreen && !startScreen.classList.contains("hidden")) return;
      if (orbitView?.classList.contains("active") || !hudApi) {
        e.preventDefault();
        e.stopImmediatePropagation?.();
        toggleEscMenu(true);
      }
      return;
    }

    if (e.repeat) return;
    if (
      modalBackdrop.classList.contains("open") ||
      crewDrawer?.classList.contains("open") ||
      escMenu?.classList.contains("open") ||
      document.getElementById("npc-dialogue-modal")?.classList.contains("open")
    ) {
      return;
    }
    const startScreen = document.getElementById("start-screen");
    if (startScreen && !startScreen.classList.contains("hidden")) return;

    if (k === "o" && orbitView?.classList.contains("active")) {
      e.preventDefault();
      e.stopImmediatePropagation?.();
      switchToHud();
    }
  });

  // ---------- Custom right-click menu ----------
  function initAppContextMenu() {
    const t = (en, trText) => (readLang() === "tr" ? trText : en);
    const clickId = (id) => () => document.getElementById(id)?.click();
    const activeView = () => (orbitView?.classList.contains("active") ? "orbit" : "hud");

    async function copyCoords(lon, lat) {
      const text = formatMarsLonLat(lon, lat, 5);
      let ok = true;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        ok = false;
        window.prompt(t("Copy coordinates:", "Koordinatları kopyala:"), text);
      }
      if (!ok) return;
      showToast(`${t("COPIED", "KOPYALANDI")} · ${text}`);
    }

    function hudItems() {
      const pos = hudApi?.getLonLat?.();
      const btnLabel = (id, fallback) => document.getElementById(id)?.textContent?.trim() || fallback;
      return [
        { heading: t("BODYCAM", "VÜCUT KAMERASI") },
        { label: t("Drop waypoint pin", "Yol işareti bırak"), hint: "P", action: clickId("hud-ping") },
        { label: t("Orbit view", "Yörünge görünümü"), hint: "M", action: clickId("hud-orbit-btn") },
        { label: btnLabel("hud-sun-btn", "Sun"), action: clickId("hud-sun-btn") },
        { label: btnLabel("hud-gold-btn", "Gold (G)"), action: clickId("hud-gold-btn") },
        { label: btnLabel("hud-lamp-btn", "Flashlight (F)"), action: clickId("hud-lamp-btn") },
        { label: btnLabel("hud-tex", "Texture"), action: clickId("hud-tex") },
        { label: btnLabel("hud-fleet-btn", "Rovers"), action: clickId("hud-fleet-btn") },
        { label: t("Rover POV photo", "Gezgin POV fotoğrafı"), action: clickId("hud-pov-btn") },
        {
          label: t("Copy my coordinates", "Konumumu kopyala"),
          hidden: !Number.isFinite(pos?.lon) || !Number.isFinite(pos?.lat),
          action: () => copyCoords(pos.lon, pos.lat),
        },
        { separator: true },
      ];
    }

    function orbitItems() {
      return [
        { heading: t("ORBIT", "YÖRÜNGE") },
        { label: t("Find me", "Beni bul"), action: clickId("orbit-home") },
        { label: btnLabel("orbit-layer", t("Change layer", "Katmanı değiştir")), action: clickId("orbit-layer") },
        { label: t("Live time", "Canlı zaman"), action: () => document.querySelector('.orbit-warp[data-warp="1"]')?.click() },
        { separator: true },
      ];
      function btnLabel(id, fallback) {
        return document.getElementById(id)?.textContent?.trim() || fallback;
      }
    }

    function globalItems() {
      const view = activeView();
      return [
        { heading: t("GO TO", "GİT") },
        { label: t("Orbit view", "Yörünge görünümü"), disabled: view === "orbit", action: switchToOrbit },
        { label: t("Bodycam EVA", "Vücut kamerası EVA"), disabled: view === "hud", action: switchToHud },
        { label: t("Command menu", "Komut menüsü"), hint: "Esc", action: () => toggleEscMenu(true) },
        { separator: true },
        { label: btnCrew?.textContent?.trim() || "Crew", action: () => btnCrew?.click() },
        { label: t("Settings", "Ayarlar"), action: () => openDevSettingsModal() },
        { label: t("Sources & honesty", "Kaynaklar ve dürüstlük"), action: openCreditsModal },
        { label: t("Title screen", "Başlangıç ekranı"), action: () => start.show() },
      ];
    }

    initContextMenu({
      getItems(ctx) {
        const el = ctx.target?.closest ? ctx.target : ctx.target?.parentElement;
        const startScreen = document.getElementById("start-screen");
        if (startScreen && !startScreen.classList.contains("hidden")) {
          return [...startScreen.querySelectorAll(".menu-item")].map((b) => ({
            label: b.textContent.trim(),
            action: () => b.click(),
          }));
        }
        if (document.getElementById("npc-dialogue-modal")?.classList.contains("open")) {
          return [{ label: t("Close dialogue", "Konuşmayı kapat"), hint: "Esc", action: () => document.getElementById("npc-dlg-close")?.click() }];
        }
        if (modalBackdrop.classList.contains("open")) {
          return [{ label: t("Close window", "Pencereyi kapat"), hint: "Esc", action: closeModal }];
        }
        if (escMenu?.classList.contains("open")) {
          return [{ label: t("Resume", "Devam et"), hint: "Esc", action: () => toggleEscMenu(false) }];
        }
        if (el?.closest?.("#crew-drawer")) {
          return [{ label: t("Close crew panel", "Ekip panelini kapat"), hint: "Esc", action: () => crewDrawer?.classList.remove("open") }];
        }
        const view = activeView();
        const local =
          view === "hud"
            ? hudItems()
            : view === "orbit"
              ? orbitItems()
              : [];
        return [...local, ...globalItems()];
      },
    });
  }

  resolveReady({
    eva: startEva,
    orbit: switchToOrbit,
    credits: openCreditsModal,
    dev: openDevSettingsModal,
  });

  initAppContextMenu();

  await mp.connect();
  renderCrewUi();

  window.__MM_APP__ = {
    data,
    demSampler,
    registry,
    mp,
    openHistoricRoverModal,
    get hudApi() {
      return hudApi;
    },
    get orbitApi() {
      return orbitApi;
    },
  };
  try {
    hudApi = await initHud3D(data, {
    mp,
    onLocalPose: (pose) => {
      lastSelfPose = pose;
    },
    onOpenMenu: () => toggleEscMenu(true),
    onOpenPov: openPovModal,
    onOpenRoverInfo: openHistoricRoverModal,
    onOpenOrbit: switchToOrbit,
    });
  } catch (err) {
    // never leave the loading screen up for ever: say what failed
    console.error("3D view failed to start:", err);
    const veil = document.getElementById("hud-loading");
    veil?.classList.add("failed");
    const stage = document.getElementById("hud-loading-stage");
    if (stage) stage.textContent = `The 3D view could not start: ${String(err?.message || err).slice(0, 160)}. Reload the page to try again.`;
    throw err;
  }
  if (data.route) dispatchSetRoute(data.route, 0);
  if (pendingIntro && !pendingLanding) {
    pendingIntro = false;
    hudApi.playLanding?.({ site: "GALE CRATER · MOUNT SHARP" });
  }
  if (pendingLanding) {
    const args = pendingLanding;
    pendingLanding = null;
    landFromOrbit(...args);
  }
}

boot();
