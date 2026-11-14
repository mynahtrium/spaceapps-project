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
    menu_demo: "3D MARS GLOBE DEMO (?demo=1)",
    menu_planner: "ROUTE PLANNER",
    menu_credits: "SOURCES & HONESTY",
    foot_sources:
      "DATA: NASA / MRO HiRISE (UArizona), MGS MOLA, VIKING MDIM 2.1, CTX, THEMIS, CRISM, MSL CURIOSITY, DONKI · ASTRONAUT: NASA 3D RESOURCES",
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
    menu_demo: "3B MARS KÜRESİ DEMOSU (?demo=1)",
    menu_planner: "ROTA PLANLAYICI",
    menu_credits: "KAYNAKLAR VE DÜRÜSTLÜK",
    foot_sources:
      "VERİ: NASA / MRO HiRISE (UArizona), MGS MOLA, VIKING MDIM 2.1, CTX, THEMIS, CRISM, MSL CURIOSITY, DONKI · ASTRONOT: NASA 3D RESOURCES",
  },
};

function readLang() {
  try {
    return localStorage.getItem("mm-lang") === "tr" ? "tr" : "en";
  } catch {
    return "en";
  }
}

function initStartScreen({ onEva, onDemo, onPlanner, onCredits }) {
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
    const topDemoBtn = document.getElementById("btn-demo-3d");
    if (topDemoBtn) topDemoBtn.textContent = lang === "tr" ? "3B Mars Küresi" : "3D Mars Demo";
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

  const actions = { eva: onEva, demo: onDemo, planner: onPlanner, credits: onCredits };
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

  applyLang();
  show();
  return { show, hide };
}

async function boot() {
  // Show the start screen at once; its actions wait until the data and views are ready.
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));
  const goDemo3D = () => {
    const u = new URL(window.location.href);
    u.searchParams.set("demo", "1");
    window.location.href = u.toString();
  };
  const start = initStartScreen({
    onEva: () => ready.then((a) => a.eva()),
    onDemo: goDemo3D,
    onPlanner: () => ready.then((a) => a.planner()),
    onCredits: () => ready.then((a) => a.credits()),
  });
  let hudApi = null;
  const btnDemo3D = document.getElementById("btn-demo-3d");
  if (btnDemo3D) btnDemo3D.onclick = goDemo3D;
  document.getElementById("btn-menu").onclick = () => {
    if (hudApi?.isAwaitingInitialLanding?.()) return;
    start.show();
  };

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
    if (btnDemo3D) btnDemo3D.style.display = "none";
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
    const dynamicItems = (data.sources || [])
      .map((s) => {
        const safeName = String(s.name || s.dataset || "Dataset")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        const safeUrl = s.url ? String(s.url).replace(/"/g, "&quot;") : "";
        const safeNote = s.note
          ? ` — ${String(s.note).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}`
          : "";
        const link = safeUrl
          ? ` <a href="${safeUrl}" target="_blank" rel="noopener">[source]</a>`
          : "";
        return `<li><strong>${safeName}</strong> (${s.fetchDate || "2026-11-14"})${safeNote}${link}</li>`;
      })
      .join("");
    modalBody.innerHTML = `
      <div style="font-size:12px;line-height:1.55;">
        <p><strong>Site Framing:</strong> "If a crew visited where Curiosity studied Mount Sharp." Gale crater is a rover site, not a human landing candidate. Primary science goal: ancient lake sediments and habitability / biosignature potential (organics in mudstones); boxwork unit (Altadena member) is a bonus stop.</p>
        <p><strong>Honesty &amp; Placeholders:</strong></p>
        <ul>
          <li><strong>Slope limits (20° / 15°):</strong> Illustrative lunar stand-ins — <a href="https://www.nasa.gov/wp-content/uploads/2020/01/topic_1-_eva_lunar_surface_concept_of_operations.pdf" target="_blank" rel="noopener">NASA Exploration EVA ConOps</a> (20° walk, 2 km radius) &amp; <a href="https://www.hou.usra.edu/meetings/lpsc2023/pdf/1413.pdf" target="_blank" rel="noopener">LPSC 2023 #1413</a> (15° strict traverse threshold). DTM slope matches Curiosity rover tilt only weakly (5 m medians 9.0° vs 8.6° over 176 waypoints); keep a safety margin.</li>
          <li><strong>Suit O₂ &amp; Walking Time:</strong> Illustrative linear / Earth-hiking placeholders (1.4 m/s walk, 2.5 m/s Shift run), not validated Mars suit models. Mars gravity (3.71 m/s²) is used for jumps and falls.</li>
          <li><strong>Radiation Dose:</strong> <a href="https://www.science.org/doi/10.1126/science.1244797" target="_blank" rel="noopener">Hassler et al. (Science 2014)</a> Curiosity RAD baseline (0.64 ± 0.12 mSv/day GCR at −4.4 km MOLA) × EVA duration. No spatial rock radiation map.</li>
        </ul>
        <p><strong>NASA Planetary, Orbital &amp; Surface Datasets (fetched 2026-11-11 to 2026-11-14):</strong></p>
        <ul>
          <li><strong>MRO HiRISE DTM &amp; 25 cm Orthoimage (<code>DTEEC_019698_1750_019988_1750_U01</code>):</strong> 1 m elevation grid (~5 m processed preview), slope, roughness, hillshade, and 25 cm optical surface texture for Gale Crater / Mount Sharp. Source: <a href="https://hirise-pds.lpl.arizona.edu/PDS/DTM/ESP/ORB_019600_019699/ESP_019698_1750_ESP_019988_1750/DTEEC_019698_1750_019988_1750_U01.IMG" target="_blank" rel="noopener">UArizona HiRISE PDS DTM</a></li>
          <li><strong>NASA MGS MOLA MEGDR 16ppd &amp; 4ppd Global Topography (<code>MEGT90N000EB.IMG</code> / <code>MEGT90N000CB.IMG</code>, Dataset <code>MGS-M-MOLA-5-MEGDR-L3-V1.0</code>):</strong> real global Mars elevation (&minus;8,135 m to +21,159 m above the IAU2000 GMM3 areoid, 0.0625&deg; / ~3.7 km/px source downsampled cleanly to 2880&times;1440 lossless 16-bit PNG in <code>data/demo/mars-mola-dem.png</code>) driving the 3D displaced planetary terrain globe, normal-mapped 3D relief shading, and spherical surface topography. Source: <a href="https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.lbl" target="_blank" rel="noopener">PDS Geosciences MOLA 16ppd Label</a></li>
          <li><strong>NASA / USGS Mars Viking MDIM 2.1 Colorized Global Mosaic (<code>Mars_Viking_MDIM21_ClrMosaic_global_232m</code>):</strong> true planetary global Mars color mosaic from Mars Trek WMTS zoom 3 tiles (16&times;8 = 128 tiles) stitched offline into 2880&times;1440 <code>data/demo/mars-viking-global.jpg</code>. Source: <a href="https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/WMTSCapabilities.xml" target="_blank" rel="noopener">Mars Trek Viking MDIM 2.1 WMTS</a></li>
          <li><strong>NASA MGS MOLA Color Shaded Relief Merge (<code>Mars_MGS_MOLA_ClrShade_merge_global_463m</code>):</strong> Mars Trek WMTS zoom 3 shaded-relief hypsometric tiles (16&times;8 = 128 tiles) stitched offline into 2048&times;1024 <code>data/demo/mars-mola-shaded.jpg</code> and used in MapLibre &amp; the 3D terrain globe. Source: <a href="https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/WMTSCapabilities.xml" target="_blank" rel="noopener">Mars Trek MOLA Color Shaded Relief WMTS</a></li>
          <li><strong>MRO CTX 5 m Global Mosaic:</strong> regional optical context via <a href="https://trek.nasa.gov/tiles/Mars/EQ/CTX_beta01_uncontrolled_5m_Caltech/1.0.0/WMTSCapabilities.xml" target="_blank" rel="noopener">NASA Mars Trek CTX WMTS</a> &amp; <a href="https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer" target="_blank" rel="noopener">Esri/USGS OnMars CTX</a>.</li>
          <li><strong>Mars Odyssey THEMIS 100 m Thermal IR:</strong> <a href="https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml" target="_blank" rel="noopener">THEMIS Day IR</a> &amp; <a href="https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml" target="_blank" rel="noopener">THEMIS Night IR</a> WMTS + cached Gale sample tiles (<code>z4/z6/z8</code>).</li>
          <li><strong>MRO CRISM 18 m MTRDR Mineralogy:</strong> 9 spectral target products queried via <a href="https://oderest.rsl.wustl.edu/" target="_blank" rel="noopener">PDS Geosciences ODE REST</a> (<a href="https://pds-geosciences.wustl.edu/missions/mro/crism.htm" target="_blank" rel="noopener">MRO CRISM Archive</a>).</li>
          <li><strong>MSL Curiosity Traverse, REMS Weather &amp; Rover POV Imagery:</strong> <a href="https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json" target="_blank" rel="noopener">MMGIS Waypoints</a> (1,389 sols; habitat &amp; boxwork example points), <a href="https://mars.nasa.gov/rss/api/?feed=weather&amp;category=msl&amp;feedtype=json" target="_blank" rel="noopener">CAB/NASA REMS daily weather</a> (4,745 sols; <a href="https://atmos.nmsu.edu/PDS/data/mslrem_1001/DATA/" target="_blank" rel="noopener">PDS REMS</a>), and <a href="https://mars.nasa.gov/rss/api/?feed=raw_images&amp;category=msl&amp;feedtype=json" target="_blank" rel="noopener">Curiosity Raw Images</a> (Sol 5073 Navcam &amp; Sol 4698 Mastcam, credit NASA/JPL-Caltech/MSSS).</li>
          <li><strong>NASA DONKI Space Weather:</strong> cached 30-day WSA-Enlil Mars impact simulations, CME, SEP &amp; GST events via <a href="https://api.nasa.gov/" target="_blank" rel="noopener">api.nasa.gov</a> &amp; <a href="https://ccmc.gsfc.nasa.gov/tools/DONKI/" target="_blank" rel="noopener">CCMC DONKI</a>.</li>
          <li><strong>Astronaut 3D Model:</strong> <a href="https://github.com/nasa/NASA-3D-Resources" target="_blank" rel="noopener">NASA 3D Resources</a> Mark III Spacesuit glTF (<code>web/assets/nasa-3d/mark-iii-spacesuit.glb</code>, scaled to 1.80 m, procedural mesh-derived skeleton + walk/run cycle).</li>
        </ul>
        ${dynamicItems ? `<p><strong>Loaded Dataset Manifest Records (${data.sources.length}):</strong></p><ul>${dynamicItems}</ul>` : ""}
        <p><strong>Rendering &amp; 3D/2D Maps:</strong> Real-time WebGL rasterisation with physically based materials, ACES tone mapping, real-time sun shadows + precomputed terrain sun-mask shadows, and helmet-camera lens pass. In <code>?demo=1</code> mode, the interactive 3D Mars globe renders a WebGL terrain-displaced sphere from real NASA MGS MOLA MEGDR topography with normal-mapped relief shadows, Viking MDIM 2.1 color, and MOLA Color Shaded Relief, seamlessly blended into the 1 m HiRISE Gale DTM on the surface. MapLibre 2D/3D planner renders equirectangular-reprojected Trek tiles or offline Hillshade/Terrarium relief in demo-safe mode.</p>
      </div>
    `;
    modalBackdrop.classList.add("open");
  }

  btnCredits.onclick = openCreditsModal;

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
    if (data.demoSafe && hudApi?.isAwaitingInitialLanding?.()) return;
    hudView.classList.remove("active");
    plannerView.classList.add("active");
    btnTabHud.classList.remove("active");
    btnTabPlanner.classList.add("active");
    mp.setRole("planner");
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

  if (data.demoSafe) {
    start.hide();
    switchToHud();
    hudApi?.setMapOpen?.(true, "globe");
  }
}

boot();
