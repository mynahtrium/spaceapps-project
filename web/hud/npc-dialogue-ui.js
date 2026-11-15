/**
 * Interactive Astronaut NPC Dialogue HUD Overlay Controller (`web/hud/npc-dialogue-ui.js`).
 *
 * Opens a NASA-themed sci-fi comms panel when the player interacts with any stationed NPC
 * (`[E]` or click), pauses player walking/driving controls while active, supports both
 * Quick-Select Preset Questions and Free-Text Custom Questions via `queryNpcWithHook`,
 * and cleanly releases controls upon close.
 */

import { getNpcSpecById, queryNpcWithHook } from "./npc-knowledge.js";

export function initNpcDialogueUi({ onOpen = null, onClose = null, getLang = null } = {}) {
  const modalEl = document.getElementById("npc-dialogue-modal");
  const panelEl = modalEl?.querySelector(".npc-dialogue-panel");
  const dotEl = document.getElementById("npc-dlg-dot");
  const channelEl = document.getElementById("npc-dlg-channel");
  const nameEl = document.getElementById("npc-dlg-name");
  const roleEl = document.getElementById("npc-dlg-role");
  const vehicleEl = document.getElementById("npc-dlg-vehicle");
  const closeBtn = document.getElementById("npc-dlg-close");
  const messagesEl = document.getElementById("npc-dlg-messages");
  const presetsLblEl = document.getElementById("npc-dlg-presets-lbl");
  const presetsEl = document.getElementById("npc-dlg-presets");
  const formEl = document.getElementById("npc-dlg-form");
  const inputEl = document.getElementById("npc-dlg-input");
  const sendBtn = document.getElementById("npc-dlg-send");

  let activeSpec = null;

  const currentLang = () => {
    if (typeof getLang === "function") return getLang() === "tr" ? "tr" : "en";
    try {
      return localStorage.getItem("mm-lang") === "tr" ? "tr" : "en";
    } catch {
      return "en";
    }
  };

  function isOpen() {
    return Boolean(modalEl?.classList.contains("open"));
  }

  function appendMessage(senderType, senderLabel, text, sourceNote = "") {
    if (!messagesEl) return;
    const item = document.createElement("div");
    item.className = `npc-msg ${senderType === "user" ? "user" : "npc"}`;

    const head = document.createElement("div");
    head.className = "npc-msg-sender";
    head.textContent = senderLabel;
    item.appendChild(head);

    const body = document.createElement("div");
    body.className = "npc-msg-body";
    body.textContent = text;
    item.appendChild(body);

    if (sourceNote && senderType !== "user") {
      const src = document.createElement("div");
      src.className = "npc-msg-source";
      src.textContent = `SOURCE // ${sourceNote}`;
      item.appendChild(src);
    }

    messagesEl.appendChild(item);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderPresets(spec, lang) {
    if (!presetsEl || !spec) return;
    presetsEl.innerHTML = "";
    const isTr = lang === "tr";
    for (const preset of spec.presets || []) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "npc-preset-btn";
      btn.textContent = isTr ? preset.label.tr : preset.label.en;
      btn.addEventListener("click", () => {
        if (!activeSpec) return;
        const activeLang = currentLang();
        const qText = activeLang === "tr" ? preset.question.tr : preset.question.en;
        const aText = activeLang === "tr" ? preset.answer.tr : preset.answer.en;
        appendMessage("user", activeLang === "tr" ? "SEN (EVA-01)" : "YOU (EVA-01)", qText);
        appendMessage(
          "npc",
          activeSpec.shortName || activeSpec.name,
          aText,
          "NASA Mission Archives & Project Baseline"
        );
      });
      presetsEl.appendChild(btn);
    }
  }

  function applyLocalizedChrome(spec, lang) {
    const isTr = lang === "tr";
    if (channelEl) {
      channelEl.textContent = isTr ? "EVA İLETİŞİM // YEŞİL BÖLGE GARAJI" : "EVA COMMS // GREEN ZONE GARAGE BAY";
    }
    if (closeBtn) {
      closeBtn.textContent = isTr ? "Kapat (ESC)" : "Close (ESC)";
    }
    if (presetsLblEl) {
      presetsLblEl.textContent = isTr ? "HIZLI SORULAR" : "QUICK-SELECT TOPICS";
    }
    if (inputEl) {
      inputEl.placeholder = isTr
        ? "Mars atmosferi, yerçekimi, su, fırtınalar veya bu gezgin hakkında bir soru sor…"
        : "Ask anything about Mars atmosphere, gravity, water, dust storms, or this rover…";
    }
    if (sendBtn) {
      sendBtn.textContent = isTr ? "Sor" : "Ask";
    }
    if (spec) {
      if (nameEl) nameEl.textContent = spec.name;
      if (roleEl) roleEl.textContent = isTr ? spec.role.tr : spec.role.en;
      if (vehicleEl) vehicleEl.textContent = isTr ? spec.vehicleName.tr : spec.vehicleName.en;
      if (dotEl && spec.accentHex) {
        dotEl.style.background = spec.accentHex;
        dotEl.style.boxShadow = `0 0 8px ${spec.accentHex}`;
      }
    }
  }

  function openForNpc(specOrEntry) {
    const rawId = specOrEntry?.spec?.id || specOrEntry?.id;
    const spec = (rawId ? getNpcSpecById(rawId) : null) || specOrEntry?.spec || specOrEntry;
    if (!spec || !modalEl) return false;

    activeSpec = spec;
    const lang = currentLang();
    const isTr = lang === "tr";

    applyLocalizedChrome(spec, lang);
    if (messagesEl) messagesEl.innerHTML = "";
    appendMessage("npc", spec.shortName || spec.name, isTr ? spec.greeting.tr : spec.greeting.en);
    renderPresets(spec, lang);

    if (inputEl) inputEl.value = "";
    modalEl.classList.add("open");
    if (typeof onOpen === "function") onOpen(spec);

    // Focus custom question box shortly after pointer-lock exit settles
    setTimeout(() => {
      if (isOpen()) inputEl?.focus?.({ preventScroll: true });
    }, 35);
    return true;
  }

  function close() {
    if (!modalEl || !isOpen()) return false;
    const closedSpec = activeSpec;
    modalEl.classList.remove("open");
    activeSpec = null;
    if (typeof onClose === "function") onClose(closedSpec);
    return true;
  }

  async function handleCustomSubmit(ev) {
    ev?.preventDefault?.();
    if (!activeSpec || !inputEl) return;
    const rawText = inputEl.value.trim();
    if (!rawText) return;
    const lang = currentLang();
    const specSnapshot = activeSpec;
    inputEl.value = "";

    appendMessage("user", lang === "tr" ? "SEN (EVA-01)" : "YOU (EVA-01)", rawText);
    const res = await queryNpcWithHook(specSnapshot.id, rawText, { lang });
    if (!isOpen() || activeSpec?.id !== specSnapshot.id) return;
    appendMessage(
      "npc",
      specSnapshot.shortName || specSnapshot.name,
      res.answer,
      res.sourceNote || "NASA Mars Archives"
    );
  }

  closeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    close();
  });

  modalEl?.addEventListener("click", (e) => {
    if (e.target === modalEl) {
      close();
    }
  });

  // Prevent canvas camera/walk clicks from bleeding through the panel
  panelEl?.addEventListener("pointerdown", (e) => e.stopPropagation());
  modalEl?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation?.();
      e.stopPropagation();
      close();
      return;
    }
    e.stopPropagation();
  });

  window.addEventListener("keydown", (e) => {
    if (!isOpen()) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation?.();
      close();
    }
  });

  formEl?.addEventListener("submit", handleCustomSubmit);

  return {
    isOpen,
    getActiveNpc: () => activeSpec,
    openForNpc,
    close,
  };
}
