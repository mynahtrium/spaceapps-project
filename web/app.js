/**
 * Main entry point (`web/app.js`).
 * Loads processed / demo-safe / contract data, initializes the 2D Planner and 3D Helmet HUD,
 * and handles view switching and modals (Curiosity POV + Credits & Honesty).
 */

import { loadAllProjectData, loadDemSamplerFromData } from "./shared/data-loader.js";
import { TileSourceRegistry } from "./map/TileSourceRegistry.js";
import { buildInviteUrl, MultiplayerClient } from "./shared/multiplayer.js";
import { dispatchSetRoute, marsDistanceM } from "./shared/route-bridge.js";
import { initPlanner } from "./planner/planner.js";
import { initHud3D } from "./hud/hud3d.js";
import { FULL_REALISM_PRESET, loadDevSettings, resetDevSettings, saveDevSettings } from "./shared/dev-settings.js";

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
    menu_dev: "DEV",
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
    menu_dev: "GELİŞTİRİCİ",
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

function initStartScreen({ onEva, onPlanner, onCredits, onDev }) {
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
    typeIntro();
  };
  document.getElementById("lang-en").onclick = () => setLang("en");
  document.getElementById("lang-tr").onclick = () => setLang("tr");
  const devBtn = document.getElementById("btn-dev-settings");
  if (devBtn) devBtn.onclick = () => onDev?.();

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
    onDev: () => ready.then((a) => a.dev()),
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
          <li><strong>Astronaut model:</strong> NASA 3D Resources (github.com/nasa/NASA-3D-Resources), Z2 Spacesuit or Mark III Spacesuit glTF, scaled to a 1.80 m astronaut. The NASA model has no skeleton, so the app builds one from the mesh. Mars gravity (3.71 m/s²) drives jumps, falls, momentum, slope traction, and dust settling.</li>
          <li><strong>Pressurized Rover &amp; Environment:</strong> Official NASA 3D Resources <code>Space Exploration Vehicle</code> (MMSEV Draco GLB, fetched 2026-11-14) with 4-point DEM slope alignment &amp; spring-damper suspension, plus REMS-inspired dust haze and surface wind gust particles.</li>
          <li><strong>Shadows:</strong> crisp real-time sun shadows near the walker; further away, terrain shadows are precomputed by marching the HiRISE-derived height grid towards the sun.</li>
        </ul>
        <p><strong>Rendering:</strong> real-time WebGL rasterisation with physically based materials, shadow maps, ACES tone mapping and a helmet-camera lens pass (barrel distortion, chromatic aberration, grain, vignette). It is not ray tracing. The textured terrain colour is an illustrative Mars tint over greyscale HiRISE imagery. Terrain beyond the real 2 km tile is a mirrored copy, not data. Close-range ground grain (wind ripples, pebbles, fractured mudstone slabs) is procedurally generated in the browser for visual texture only; it is not mapped geology.</p>
        <p><strong>2D map:</strong> MapLibre with Mars Trek CTX / THEMIS / MOLA tiles reprojected from Mars equirectangular, and hillshade / optional 3D tilt from the HiRISE-derived height preview. In demo-safe mode no tiles are fetched; an offline shaded relief is drawn from the local height grid.</p>
      </div>
    `;
    modalBackdrop.classList.add("open");
  }

  btnCredits.onclick = openCreditsModal;

  function openDevSettingsModal() {
    const tr = readLang() === "tr";
    const s = loadDevSettings();
    modalTitle.textContent = tr ? "GELİŞTİRİCİ AYARLARI // DENEYSEL" : "DEVELOPER SETTINGS // EXPERIMENTAL";
    modalBody.innerHTML = `
      <div class="dev-panel">
        <div class="dev-note">
          ${
            tr
              ? "Değişiklikler anlık olarak 3D Bodycam görünümüne uygulanır ve tarayıcıda saklanır."
              : "Changes apply live to the 3D Bodycam view and persist locally in your browser."
          }
        </div>

        <label class="dev-row">
          <div>
            <div class="dev-label">${tr ? "Ekrandaki Çerçeve & Lens Efekti" : "Bodycam Frame & Lens Effect"}</div>
            <div class="dev-sub">${
              tr
                ? "Kavisli kask vizörü siyah çerçevesi, kenar karartması, kromatik sapma ve film greni."
                : "Curved visor bezel frame, edge vignette, barrel distortion, chromatic aberration & grain."
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

        <label class="dev-row dev-row-exp">
          <div>
            <div class="dev-label">
              ${tr ? "Deneysel Süper Grafikler" : "Experimental Super Graphics"}
              <span class="dev-badge-exp">${tr ? "DENEYSEL" : "EXPERIMENTAL"}</span>
            </div>
            <div class="dev-sub">${
              tr
                ? "Uyarlamalı çözünürlük düşürmeyi kapatır, 2× DPR + 1.25× supersampling, 4× MSAA, 4096 px yumuşak güneş gölgeleri ve yüksek mikro-detay açar (GPU yoğun)."
                : "Locks off adaptive downscale, enables up to 2× DPR + 1.25× supersampling, 4× MSAA, 4096 px PCFSoft sun shadows & high terrain micro-relief (heavy GPU)."
            }</div>
          </div>
          <input type="checkbox" id="dev-super-gfx" ${s.superGraphics ? "checked" : ""} />
        </label>

        <label class="dev-row dev-row-exp">
          <div>
            <div class="dev-label">
              ${tr ? "Deneysel Mars Aracı — NASA MMSEV (Yanında Doğar)" : "Experimental Mars Rover — NASA MMSEV (Spawns Beside You)"}
              <span class="dev-badge-exp">${tr ? "DENEYSEL" : "EXPERIMENTAL"}</span>
            </div>
            <div class="dev-sub">${
              tr
                ? "NASA 3D Resources gerçek basınçlı MMSEV aracını yanında oluşturur (katı çarpışma + süspansiyon + F tuşuyla sürüş)."
                : "Spawns the official NASA 3D Resources pressurized MMSEV rover beside you (solid collision + suspension + press F to drive)."
            }</div>
          </div>
          <input type="checkbox" id="dev-exp-rover" ${s.experimentalRover ? "checked" : ""} />
        </label>

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
            <div class="dev-label">${tr ? "Gerçekçi Mars Fizikleri (Momentum & Süspansiyon)" : "Realistic Mars Physics (Momentum, Slope Slide & Suspension)"}</div>
            <div class="dev-sub">${
              tr
                ? "Adım ataleti/momentumu, 24° üstü dik yokuşta regolit kayması, iniş tepkisi ve rover süspansiyon yaylanmasını uygular."
                : "Applies walker inertia/momentum, steep >24° regolith slope slip, landing shock & rover spring-damper suspension."
            }</div>
          </div>
          <input type="checkbox" id="dev-realistic-physics" ${s.realisticPhysics ? "checked" : ""} />
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
            <div class="dev-label">${tr ? "Kamera Görüş Açısı (FOV)" : "Camera Field of View (FOV)"}</div>
            <div class="dev-sub"><span id="dev-fov-val">${Math.round(s.fov)}°</span></div>
          </div>
          <input class="dev-range" type="range" id="dev-fov" min="60" max="110" step="1" value="${s.fov}" />
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

        <div class="dev-actions">
          <button class="btn primary" type="button" id="dev-full-realism">${tr ? "Tüm Gerçekçiliği Aç" : "Enable Full Realism"}</button>
          <button class="btn" type="button" id="dev-reset">${tr ? "Varsayılanlara Sıfırla" : "Reset Defaults"}</button>
        </div>
      </div>
    `;

    const frameToggle = document.getElementById("dev-frame-toggle");
    const frameStrength = document.getElementById("dev-frame-strength");
    const frameStrengthVal = document.getElementById("dev-frame-strength-val");
    const speedRange = document.getElementById("dev-speed");
    const speedVal = document.getElementById("dev-speed-val");
    const superToggle = document.getElementById("dev-super-gfx");
    const expRoverToggle = document.getElementById("dev-exp-rover");
    const realisticTexToggle = document.getElementById("dev-realistic-tex");
    const realisticDustToggle = document.getElementById("dev-realistic-dust");
    const realisticPhysicsToggle = document.getElementById("dev-realistic-physics");
    const realisticWeatherToggle = document.getElementById("dev-realistic-weather");
    const fovRange = document.getElementById("dev-fov");
    const fovVal = document.getElementById("dev-fov-val");
    const cleanToggle = document.getElementById("dev-clean-hud");
    const fullRealismBtn = document.getElementById("dev-full-realism");
    const resetBtn = document.getElementById("dev-reset");

    const syncUi = (cfg) => {
      if (frameToggle) frameToggle.checked = cfg.frameEffect;
      if (frameStrength) {
        frameStrength.value = String(cfg.frameStrength);
        frameStrength.disabled = !cfg.frameEffect;
      }
      if (frameStrengthVal) frameStrengthVal.textContent = `${Math.round(cfg.frameStrength * 100)}%`;
      if (speedRange) speedRange.value = String(cfg.speedMultiplier);
      if (speedVal) speedVal.textContent = `${cfg.speedMultiplier.toFixed(2)}×`;
      if (superToggle) superToggle.checked = cfg.superGraphics;
      if (expRoverToggle) expRoverToggle.checked = cfg.experimentalRover;
      if (realisticTexToggle) realisticTexToggle.checked = cfg.realisticTextures;
      if (realisticDustToggle) realisticDustToggle.checked = cfg.realisticDust;
      if (realisticPhysicsToggle) realisticPhysicsToggle.checked = cfg.realisticPhysics;
      if (realisticWeatherToggle) realisticWeatherToggle.checked = cfg.realisticWeather;
      if (fovRange) fovRange.value = String(cfg.fov);
      if (fovVal) fovVal.textContent = `${Math.round(cfg.fov)}°`;
      if (cleanToggle) cleanToggle.checked = cfg.cleanHud;
    };

    syncUi(s);
    frameToggle?.addEventListener("change", () => syncUi(saveDevSettings({ frameEffect: frameToggle.checked })));
    frameStrength?.addEventListener("input", () => syncUi(saveDevSettings({ frameStrength: parseFloat(frameStrength.value) })));
    speedRange?.addEventListener("input", () => syncUi(saveDevSettings({ speedMultiplier: parseFloat(speedRange.value) })));
    modalBody.querySelectorAll(".dev-preset").forEach((btn) => {
      btn.addEventListener("click", () => syncUi(saveDevSettings({ speedMultiplier: parseFloat(btn.dataset.speed) })));
    });
    superToggle?.addEventListener("change", () => syncUi(saveDevSettings({ superGraphics: superToggle.checked })));
    expRoverToggle?.addEventListener("change", () =>
      syncUi(saveDevSettings({ experimentalRover: expRoverToggle.checked }))
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
    fovRange?.addEventListener("input", () => syncUi(saveDevSettings({ fov: parseFloat(fovRange.value) })));
    cleanToggle?.addEventListener("change", () => syncUi(saveDevSettings({ cleanHud: cleanToggle.checked })));
    fullRealismBtn?.addEventListener("click", () => syncUi(saveDevSettings(FULL_REALISM_PRESET)));
    resetBtn?.addEventListener("click", () => syncUi(resetDevSettings()));

    modalBackdrop.classList.add("open");
  }

  const initDev = loadDevSettings();
  const visorOverlayEl = document.querySelector(".visor-overlay");
  if (visorOverlayEl) {
    visorOverlayEl.classList.toggle("no-frame", !initDev.frameEffect);
    visorOverlayEl.classList.toggle("clean-hud", Boolean(initDev.cleanHud));
  }

  let hudApi = null;
  let plannerApi = null;
  let lastSelfPose = null;

  const mp = new MultiplayerClient({ demoSafe: data.demoSafe, role: "planner" });

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
    badge.style.color = color || "#38bdf8";
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
      selfRow.innerHTML = `<span><span class="crew-dot" style="background:${mp.color};"></span>${mp.callsign} (YOU)</span><span>${mp.role.toUpperCase()}</span>`;
      mpRosterEl.appendChild(selfRow);

      for (const peer of mp.peers.values()) {
        const row = document.createElement("div");
        row.className = "crew-row";
        const left = document.createElement("span");
        const dot = document.createElement("span");
        dot.className = "crew-dot";
        dot.style.background = peer.color || "#38bdf8";
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
    if (hudView.classList.contains("active") && hudApi?.dropLocalPing) {
      hudApi.dropLocalPing("Science Beacon");
    } else if (plannerApi?.getLastProbePoint) {
      const pt = plannerApi.getLastProbePoint();
      mp.dropPing({ lon: pt.lon, lat: pt.lat, elevM: pt.elevM, label: "Planner Pin" });
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
    plannerApi?.updateCrewOverlay?.(lastSelfPose);
  });
  mp.on("peerjoin", (peer) => {
    showToast(`${peer.callsign} joined EVA room ${mp.room}`);
    appendChatLine({ callsign: "SYS", color: "#34d399", text: `${peer.callsign} connected` });
    renderCrewUi();
    plannerApi?.updateCrewOverlay?.(lastSelfPose);
  });
  mp.on("peerleave", (peer) => {
    showToast(`${peer.callsign} left EVA`);
    appendChatLine({ callsign: "SYS", color: "#94a3b8", text: `${peer.callsign} disconnected` });
    renderCrewUi();
    plannerApi?.updateCrewOverlay?.(lastSelfPose);
  });
  mp.on("peerstate", () => {
    plannerApi?.updateCrewOverlay?.(lastSelfPose);
    if (crewDrawer?.classList.contains("open")) renderCrewUi();
  });
  mp.on("pins", (pins) => {
    plannerApi?.updatePinsOverlay?.(pins);
  });
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

  function switchToHud() {
    plannerView.classList.remove("active");
    hudView.classList.add("active");
    btnTabPlanner.classList.remove("active");
    btnTabHud.classList.add("active");
    mp.setRole("eva");
    if (hudApi) hudApi.onResize();
  }

  function switchToPlanner() {
    hudView.classList.remove("active");
    plannerView.classList.add("active");
    btnTabHud.classList.remove("active");
    btnTabPlanner.classList.add("active");
    mp.setRole("planner");
    requestAnimationFrame(() => plannerApi?.adapter?.resize?.());
  }

  const startEva = () => {
    if (data.route) dispatchSetRoute(data.route, 0);
    switchToHud();
  };

  btnTabPlanner.onclick = switchToPlanner;
  btnTabHud.onclick = switchToHud;

  resolveReady({
    eva: startEva,
    planner: switchToPlanner,
    credits: openCreditsModal,
    dev: openDevSettingsModal,
  });

  plannerApi = initPlanner(data, {
    demSampler,
    registry,
    mp,
    onOpenPov: openPovModal,
    onStartEva: switchToHud,
  });

  await mp.connect();
  renderCrewUi();

  window.__MM_APP__ = {
    data,
    demSampler,
    registry,
    mp,
    get plannerApi() {
      return plannerApi;
    },
    get hudApi() {
      return hudApi;
    },
  };
  hudApi = await initHud3D(data, {
    mp,
    onLocalPose: (pose) => {
      lastSelfPose = pose;
      plannerApi?.updateCrewOverlay?.(pose);
    },
    onBackToPlanner: switchToPlanner,
    onOpenPov: openPovModal,
  });
}

boot();
