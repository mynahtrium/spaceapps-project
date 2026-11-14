/**
 * Main entry point (`web/app.js`).
 * Loads processed / demo-safe / contract data, initializes the 2D Planner and 3D Helmet HUD,
 * and handles view switching and modals (Curiosity POV + Credits & Honesty).
 */

import { loadAllProjectData, loadDemSamplerFromData } from "./shared/data-loader.js";
import { TileSourceRegistry } from "./map/TileSourceRegistry.js";
import { buildInviteUrl, MultiplayerClient } from "./shared/multiplayer.js";
import { dispatchSetRoute, dispatchVisitRoverSite, marsDistanceM, onOpenRoverInfo } from "./shared/route-bridge.js";
import { formatMarsLonLat, getHistoricRoverById } from "./shared/mars-rovers.js";
import { initPlanner } from "./planner/planner.js";
import { initHud3D } from "./hud/hud3d.js";
import { initOrbitView } from "./orbit/orbit-view.js";
import { FULL_REALISM_PRESET, loadDevSettings, resetDevSettings, saveDevSettings } from "./shared/dev-settings.js";
import { initContextMenu } from "./shared/context-menu.js";

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
    menu_orbit: "ORBIT VIEW",
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
    menu_orbit: "YÖRÜNGE GÖRÜNÜMÜ",
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

function initStartScreen({ onEva, onOrbit, onPlanner, onCredits, onDev }) {
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

  const actions = { eva: onEva, orbit: onOrbit, planner: onPlanner, credits: onCredits };
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
    onOrbit: () => ready.then((a) => a.orbit()),
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
  const orbitView = document.getElementById("orbit-view");
  const btnTabPlanner = document.getElementById("btn-tab-planner");
  const btnTabHud = document.getElementById("btn-tab-hud");
  const btnTabOrbit = document.getElementById("btn-tab-orbit");
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

  function openHistoricRoverModal(roverOrId) {
    if (document.pointerLockElement) {
      try {
        document.exitPointerLock?.();
      } catch {}
    }
    const rover = typeof roverOrId === "string" ? getHistoricRoverById(roverOrId) : roverOrId;
    if (!rover) return;
    const tr = readLang() === "tr";
    const statusTr = rover.status === "ACTIVE" ? (tr ? "AKTİF GÖREV" : "ACTIVE") : tr ? "TAMAMLANDI" : "COMPLETED";
    const coordsText = formatMarsLonLat(rover.lon, rover.lat, 4);
    modalTitle.textContent = `${rover.name.toUpperCase()} — ${rover.mission}`;
    modalBody.innerHTML = `
      <div style="font-size:12px;line-height:1.55;">
        <div class="rover-modal-hero">
          <div>
            <div style="font-size:15px;color:#fff;letter-spacing:0.08em;"><strong>${rover.name}</strong> · ${rover.agency}</div>
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
          <a href="${rover.nasaUrl}" target="_blank" rel="noopener noreferrer" style="color:#93c5fd;">NASA Mission Page ↗</a>
        </div>

        <div class="rover-modal-actions">
          <button id="rover-modal-visit-3d" class="btn primary" type="button">
            ${tr ? "3D Bölgeye Git (Aracın Yanına)" : "Visit 3D Site (Stand by Rover)"}
          </button>
          <button id="rover-modal-show-2d" class="btn" type="button">
            ${tr ? "2D Haritada Göster" : "Locate on 2D Mars Map"}
          </button>
        </div>
      </div>
    `;
    modalBody.querySelector("#rover-modal-visit-3d")?.addEventListener("click", () => {
      modalBackdrop.classList.remove("open");
      dispatchVisitRoverSite(rover.id);
      switchToHud();
    });
    modalBody.querySelector("#rover-modal-show-2d")?.addEventListener("click", () => {
      modalBackdrop.classList.remove("open");
      switchToPlanner();
      plannerApi?.flyToRover?.(rover.id);
    });
    modalBackdrop.classList.add("open");
  }

  onOpenRoverInfo((detail) => openHistoricRoverModal(detail?.roverId));

  function openCreditsModal() {
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
          <li><strong>MRO HiRISE:</strong> 1 m DTM (<code>DTEEC_019698_1750_019988_1750_U01</code>) &amp; 25 cm orthoimage</li>
          <li><strong>MRO CTX &amp; Odyssey THEMIS:</strong> Mars Trek WMTS mosaics (5 m CTX, 100 m Day/Night IR)</li>
          <li><strong>MRO CRISM:</strong> 9 MTRDR product records via PDS Geosciences ODE REST</li>
          <li><strong>MSL Curiosity:</strong> Traverse waypoints (1,389 sols), CAB/NASA REMS weather (4,745 sols), Navcam/Mastcam raw images</li>
          <li><strong>NASA DONKI:</strong> WSA-Enlil Mars impact simulations (cached 30-day window)</li>
          <li><strong>Astronaut model:</strong> NASA 3D Resources (github.com/nasa/NASA-3D-Resources), Advanced Crew Escape Suit or Mark III Spacesuit glTF, scaled to a 1.80 m astronaut. The NASA model has no skeleton, so the app builds one from the mesh with two-bone leg IK and procedural gait. Gale gravity (3.717 m/s²) drives jumps, falls, momentum, steep-slope slip, and dust settling.</li>
          <li><strong>Pressurized Rover &amp; Environment:</strong> Official NASA 3D Resources <code>Space Exploration Vehicle</code> (MMSEV Draco GLB, fetched 2026-11-14) with 4-point DEM slope alignment &amp; spring-damper suspension, plus REMS-inspired dust haze and surface wind gust particles.</li>
          <li><strong>Historic NASA Mars Rovers (5 sites):</strong> Perseverance (Jezero Crater, NASA 3D Resources <code>Mars 2020 Perseverance Rover.glb</code>, fetched 2026-11-14), Curiosity (Gale Crater Sol 4534 waypoint, MSL scale assembly), Spirit (Gusev Crater, MER-A assembly), Opportunity (Meridiani Planum, MER-B assembly), Sojourner (Ares Vallis, Pathfinder scale assembly). Off-Gale terrain sites use seeded procedural site relief rather than downloaded regional HiRISE tiles.</li>
          <li><strong>Shadows:</strong> crisp real-time sun shadows near the walker; further away, terrain shadows are precomputed by marching the HiRISE-derived height grid towards the sun.</li>
        </ul>
        <p><strong>Rendering:</strong> real-time WebGL rasterisation with physically based materials, shadow maps, ACES tone mapping and a helmet-camera lens pass (barrel distortion, chromatic aberration, grain, vignette). It is not ray tracing. The textured terrain colour is an illustrative Mars tint over greyscale HiRISE imagery. Terrain beyond the real 2 km tile is a mirrored copy, not data. Close-range ground grain (wind ripples, pebbles, fractured mudstone slabs) is procedurally generated in the browser for visual texture only; it is not mapped geology.</p>
        <p><strong>Orbit view:</strong> globe texture is the NASA/USGS Viking MDIM 2.1 colour mosaic (alternate layer: MGS MOLA colour-shaded relief), stitched from NASA Mars Trek tiles at 4096×2048 (about 5 km per pixel) and bundled for offline use; during a landing zoom, online mode overlays ~330 m/px Viking tiles around the target. Day/night uses the real subsolar point from the NASA GISS Mars24 algorithm (Allison &amp; McEwen 2000). Mars orientation follows the IAU WGCCRE pole and prime meridian. Phobos and Deimos positions come from a series fitted to JPL Horizons vectors (agrees with Horizons to ~0.1°); their <em>sizes</em> are drawn 8× larger than scale so they are visible, while orbits are to scale. Sun, Earth and the bright stars are real directions; the faint background star field is decorative. Fine surface grain at very low altitude is procedural. Landing anywhere other than the Gale HiRISE tile uses seeded procedural relief, not mapped topography; the Bodycam sun then follows the real local true solar time of that spot (or a fixed 15:00 daylight mode).</p>
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
              ? "Değişiklikler anlık olarak 3D EVA görünümüne uygulanır ve tarayıcıda saklanır."
              : "Changes apply live to the 3D EVA view and persist locally in your browser."
          }
        </div>

        <label class="dev-row">
          <div>
            <div class="dev-label">${tr ? "Vizör & Optik Lens Efekti" : "Visor & Optical Lens Effects"}</div>
            <div class="dev-sub">${
              tr
                ? "Altın vizör filtresi (G), kask farı (L) ve optik büyütme (Z) ayarları."
                : "Gold sun filter (G), EVA lamp (L), optical zoom (Z), and subtle grain."
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
              ${tr ? "Gerçek Zamanlı Işın İzleme (Ray Tracing)" : "Real-Time Ray Tracing"}
              <span class="dev-badge-exp">${tr ? "GPU RT" : "GPU RT"}</span>
            </div>
            <div class="dev-sub">${
              tr
                ? "Piksel başına GPU yükseklik alanı ışın yürütme: dinamik yumuşak gölgeler, 6 yönlü küresel aydınlatma (GI/AO), araç/vizör/arazi yansıma ışınları ve derinlik tamponu SSR/SSGI (ağır GPU yükü, FPS düşürebilir — R tuşuyla da aç/kapa)."
                : "Per-pixel GPU heightfield ray marching & screen-space rays: dynamic penumbra soft shadows, 6-dir indirect bounce GI/AO, rover/visor/terrain reflection rays & depth SSR (heavy GPU cost, lowers FPS — toggle with R key)."
            }</div>
          </div>
          <input type="checkbox" id="dev-ray-tracing" ${s.rayTracing ? "checked" : ""} />
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
            <div class="dev-label">${tr ? "Toz optik derinliği τ" : "Dust optical depth τ"}</div>
            <div class="dev-sub"><span id="dev-tau-val">${s.dustTau.toFixed(2)}</span> · ${
              tr ? "açık gün 0.5, fırtına 2.8" : "clear day 0.5, storm 2.8"
            }</div>
          </div>
          <input class="dev-range" type="range" id="dev-tau" min="0.35" max="3" step="0.05" value="${s.dustTau}" />
        </label>

        <label class="dev-row">
          <div>
            <div class="dev-label">${tr ? "Toz şeytanı" : "Dust devil"}</div>
            <div class="dev-sub">${
              tr ? "Tek bir görsel sütun. REMS girdabı değil." : "One visual column. Not a REMS vortex replay."
            }</div>
          </div>
          <input type="checkbox" id="dev-devil" ${s.dustDevil ? "checked" : ""} />
        </label>

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
    const roverSpeedRange = document.getElementById("dev-rover-speed");
    const roverSpeedVal = document.getElementById("dev-rover-speed-val");
    const superToggle = document.getElementById("dev-super-gfx");
    const rtToggle = document.getElementById("dev-ray-tracing");
    const expRoverToggle = document.getElementById("dev-exp-rover");
    const realisticTexToggle = document.getElementById("dev-realistic-tex");
    const realisticDustToggle = document.getElementById("dev-realistic-dust");
    const realisticPhysicsToggle = document.getElementById("dev-realistic-physics");
    const realisticWeatherToggle = document.getElementById("dev-realistic-weather");
    const fovRange = document.getElementById("dev-fov");
    const fovVal = document.getElementById("dev-fov-val");
    const tauRange = document.getElementById("dev-tau");
    const tauVal = document.getElementById("dev-tau-val");
    const devilToggle = document.getElementById("dev-devil");
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
      if (roverSpeedRange) roverSpeedRange.value = String(cfg.roverSpeedMultiplier);
      if (roverSpeedVal) roverSpeedVal.textContent = `${cfg.roverSpeedMultiplier.toFixed(2)}×`;
      if (superToggle) superToggle.checked = cfg.superGraphics;
      if (rtToggle) rtToggle.checked = cfg.rayTracing;
      if (expRoverToggle) expRoverToggle.checked = cfg.experimentalRover;
      if (realisticTexToggle) realisticTexToggle.checked = cfg.realisticTextures;
      if (realisticDustToggle) realisticDustToggle.checked = cfg.realisticDust;
      if (realisticPhysicsToggle) realisticPhysicsToggle.checked = cfg.realisticPhysics;
      if (realisticWeatherToggle) realisticWeatherToggle.checked = cfg.realisticWeather;
      if (fovRange) fovRange.value = String(cfg.fov);
      if (fovVal) fovVal.textContent = `${Math.round(cfg.fov)}°`;
      if (tauRange) tauRange.value = String(cfg.dustTau);
      if (tauVal) tauVal.textContent = cfg.dustTau.toFixed(2);
      if (devilToggle) devilToggle.checked = cfg.dustDevil;
      if (cleanToggle) cleanToggle.checked = cfg.cleanHud;
    };

    syncUi(s);
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
    superToggle?.addEventListener("change", () => syncUi(saveDevSettings({ superGraphics: superToggle.checked })));
    rtToggle?.addEventListener("change", () => syncUi(saveDevSettings({ rayTracing: rtToggle.checked })));
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
    tauRange?.addEventListener("input", () => syncUi(saveDevSettings({ dustTau: parseFloat(tauRange.value) })));
    devilToggle?.addEventListener("change", () => syncUi(saveDevSettings({ dustDevil: devilToggle.checked })));
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

  let orbitApi = null;
  function ensureOrbit() {
    if (orbitApi || !orbitView) return orbitApi;
    orbitApi = initOrbitView(orbitView, {
      demoSafe: data.demoSafe,
      isTr: () => readLang() === "tr",
      getPlayerLonLat: () => hudApi?.getLonLat?.() || (lastSelfPose?.lon != null ? lastSelfPose : null),
      onLand: (lon, lat, { sunMode, roverId } = {}) => landFromOrbit(lon, lat, { sunMode, roverId }),
    });
    return orbitApi;
  }

  /** Show exactly one of the three views ("planner" | "orbit" | "hud"). */
  function switchView(name, opts = {}) {
    document.body.classList.toggle("in-hud", name === "hud");
    const views = { planner: plannerView, orbit: orbitView, hud: hudView };
    const tabs = { planner: btnTabPlanner, orbit: btnTabOrbit, hud: btnTabHud };
    for (const [k, el] of Object.entries(views)) el?.classList.toggle("active", k === name);
    for (const [k, el] of Object.entries(tabs)) el?.classList.toggle("active", k === name);
    if (name !== "orbit") orbitApi?.hide();
    if (name === "hud") {
      mp.setRole("eva");
      hudApi?.onResize();
    } else if (name === "planner") {
      mp.setRole("planner");
      requestAnimationFrame(() => plannerApi?.adapter?.resize?.());
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
  const switchToPlanner = () => switchView("planner");
  const switchToOrbit = () => {
    const from = hudView.classList.contains("active") ? hudApi?.getLonLat?.() : null;
    switchView("orbit", { from });
  };

  let pendingLanding = null;
  function landFromOrbit(lon, lat, { sunMode = "local", roverId = null } = {}) {
    if (!hudApi) {
      // The 3D view is still loading (suit / terrain); land as soon as it is ready.
      pendingLanding = [lon, lat, { sunMode, roverId }];
      switchView("hud");
      return;
    }
    if (roverId && roverId !== "curiosity") {
      dispatchVisitRoverSite(roverId);
      hudApi.setSunMode?.(sunMode);
    } else {
      hudApi.visitLocation(lon, lat, { keepYaw: true, sun: sunMode });
    }
    switchView("hud");
    hudApi.playArrivalDrop?.();
    const flash = document.createElement("div");
    flash.className = "arrival-flash";
    document.body.appendChild(flash);
    requestAnimationFrame(() => requestAnimationFrame(() => flash.classList.add("out")));
    setTimeout(() => flash.remove(), 1200);
  }

  const startEva = () => {
    if (data.route) dispatchSetRoute(data.route, 0);
    switchToHud();
  };

  btnTabPlanner.onclick = switchToPlanner;
  btnTabHud.onclick = switchToHud;
  if (btnTabOrbit) btnTabOrbit.onclick = switchToOrbit;

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (document.pointerLockElement) return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
    if (modalBackdrop.classList.contains("open")) {
      e.preventDefault();
      modalBackdrop.classList.remove("open");
      return;
    }
    if (crewDrawer?.classList.contains("open")) {
      e.preventDefault();
      crewDrawer.classList.remove("open");
    }
  });

  // ---------- Custom right-click menu ----------
  function initAppContextMenu() {
    const t = (en, trText) => (readLang() === "tr" ? trText : en);
    const clickId = (id) => () => document.getElementById(id)?.click();
    const activeView = () =>
      hudView.classList.contains("active") ? "hud" : orbitView?.classList.contains("active") ? "orbit" : "planner";
    const probeTextEl = document.getElementById("map-probe-text");

    async function copyCoords(lon, lat, where) {
      const text = formatMarsLonLat(lon, lat, 5);
      let ok = true;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        ok = false;
        window.prompt(t("Copy coordinates:", "Koordinatları kopyala:"), text);
      }
      if (!ok) return;
      const msg = `${t("COPIED", "KOPYALANDI")} · ${text}`;
      if (where === "planner" && probeTextEl) probeTextEl.textContent = msg;
      else showToast(msg);
    }

    function mapItems(ctx) {
      const ll = plannerApi?.lonLatAt?.(ctx.x, ctx.y);
      if (!ll) return [];
      const info = demSampler?.sampleSlopeAndNormal?.([ll.lon, ll.lat]);
      const elev = Number.isFinite(info?.elevM) ? ` · ${Math.round(info.elevM)} m` : "";
      const slope = Number.isFinite(info?.slopeDeg) ? ` · ${info.slopeDeg.toFixed(1)}°` : "";
      return [
        { heading: `${formatMarsLonLat(ll.lon, ll.lat, 4)}${elev}${slope}` },
        { label: t("Teleport here", "Buraya ışınlan"), hint: t("dbl-click", "çift tık"), action: () => plannerApi.teleportTo(ll.lon, ll.lat) },
        {
          label: t("Drop crew pin here", "Buraya ekip işareti bırak"),
          action: () => mp.dropPing({ lon: ll.lon, lat: ll.lat, elevM: info?.elevM ?? null, label: "Planner Pin" }),
        },
        { label: t("Copy coordinates", "Koordinatları kopyala"), action: () => copyCoords(ll.lon, ll.lat, "planner") },
        { label: t("Fit EVA route", "EVA rotasına sığdır"), action: () => plannerApi.fitEva() },
        { separator: true },
      ];
    }

    function hudItems() {
      const pos = hudApi?.getLonLat?.();
      const btnLabel = (id, fallback) => document.getElementById(id)?.textContent?.trim() || fallback;
      return [
        { heading: t("BODYCAM", "VÜCUT KAMERASI") },
        { label: t("Drop waypoint pin", "Yol işareti bırak"), hint: "P", action: clickId("hud-ping") },
        { label: t("Elevation map", "Yükselti haritası"), hint: "M", action: clickId("hud-map-btn") },
        { label: t("Orbit view", "Yörünge görünümü"), hint: "O", action: clickId("hud-orbit-btn") },
        { label: btnLabel("hud-sun-btn", "Sun"), action: clickId("hud-sun-btn") },
        { label: btnLabel("hud-tex", "Texture"), action: clickId("hud-tex") },
        { label: btnLabel("hud-fleet-btn", "Rovers"), action: clickId("hud-fleet-btn") },
        { label: t("Rover POV photo", "Gezgin POV fotoğrafı"), action: clickId("hud-pov-btn") },
        {
          label: t("Copy my coordinates", "Konumumu kopyala"),
          hidden: !Number.isFinite(pos?.lon) || !Number.isFinite(pos?.lat),
          action: () => copyCoords(pos.lon, pos.lat, "hud"),
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
        { label: t("Route planner", "Rota planlayıcı"), disabled: view === "planner", action: switchToPlanner },
        { label: t("Orbit view", "Yörünge görünümü"), disabled: view === "orbit", action: switchToOrbit },
        { label: t("Bodycam EVA", "Vücut kamerası EVA"), disabled: view === "hud", action: switchToHud },
        { separator: true },
        { label: btnCrew?.textContent?.trim() || "Crew", action: () => btnCrew?.click() },
        { label: t("Sources & honesty", "Kaynaklar ve dürüstlük"), action: openCreditsModal },
        { label: t("Developer settings", "Geliştirici ayarları"), action: openDevSettingsModal },
        { label: t("Main menu", "Ana menü"), action: () => start.show() },
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
        if (modalBackdrop.classList.contains("open")) {
          return [{ label: t("Close window", "Pencereyi kapat"), hint: "Esc", action: () => modalBackdrop.classList.remove("open") }];
        }
        if (el?.closest?.("#crew-drawer")) {
          return [{ label: t("Close crew panel", "Ekip panelini kapat"), hint: "Esc", action: () => crewDrawer?.classList.remove("open") }];
        }
        // The in-HUD elevation map has its own click-to-teleport flow; keep it to global items.
        const inHudMap = el?.closest?.("#hud-map-overlay.open");
        const view = activeView();
        const local =
          view === "planner" && el?.closest?.("#map")
            ? mapItems(ctx)
            : view === "hud" && !inHudMap
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
    planner: switchToPlanner,
    credits: openCreditsModal,
    dev: openDevSettingsModal,
  });

  plannerApi = initPlanner(data, {
    demSampler,
    registry,
    mp,
    onOpenPov: openPovModal,
    onOpenRoverInfo: openHistoricRoverModal,
    onVisitRoverSite: (id) => dispatchVisitRoverSite(id),
    onStartEva: switchToHud,
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
    get plannerApi() {
      return plannerApi;
    },
    get hudApi() {
      return hudApi;
    },
    get orbitApi() {
      return orbitApi;
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
    onOpenRoverInfo: openHistoricRoverModal,
    onOpenOrbit: switchToOrbit,
  });
  if (pendingLanding) {
    const args = pendingLanding;
    pendingLanding = null;
    landFromOrbit(...args);
  }
}

boot();
