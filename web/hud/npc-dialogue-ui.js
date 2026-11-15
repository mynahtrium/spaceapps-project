/**
 * Interactive Astronaut NPC Dialogue HUD Overlay Controller (`web/hud/npc-dialogue-ui.js`).
 *
 * Rendered reactively with `preact`, `@preact/signals`, `htm`, and `i18next`.
 */

import { h, render } from "preact";
import { signal } from "@preact/signals";
import htm from "htm";
import i18next from "i18next";
import { getNpcSpecById, queryNpcWithHook } from "./npc-knowledge.js";

const html = htm.bind(h);

const NPC_UI_RESOURCES = {
  en: {
    npcDlg: {
      channel: "EVA COMMS // GREEN ZONE GARAGE BAY",
      close: "Close (ESC)",
      presetsLbl: "QUICK-SELECT TOPICS",
      placeholder: "Ask anything about Mars atmosphere, gravity, water, dust storms, or this rover…",
      ask: "Ask",
      youLabel: "YOU (EVA-01)",
    },
  },
  tr: {
    npcDlg: {
      channel: "EVA İLETİŞİM // YEŞİL BÖLGE GARAJI",
      close: "Kapat (ESC)",
      presetsLbl: "HIZLI SORULAR",
      placeholder: "Mars atmosferi, yerçekimi, su, fırtınalar veya bu gezgin hakkında bir soru sor…",
      ask: "Sor",
      youLabel: "SEN (EVA-01)",
    },
  },
};

function ensureNpcUiI18n(lang) {
  if (!i18next.isInitialized) {
    i18next.init({
      lng: lang || "en",
      fallbackLng: "en",
      resources: {
        en: { translation: NPC_UI_RESOURCES.en },
        tr: { translation: NPC_UI_RESOURCES.tr },
      },
    });
  } else {
    for (const lng of ["en", "tr"]) {
      i18next.addResourceBundle(lng, "translation", NPC_UI_RESOURCES[lng], true, true);
    }
  }
}

export function initNpcDialogueUi({ onOpen = null, onClose = null, getLang = null, onReply = null } = {}) {
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

  const activeSpecSig = signal(null);
  const langSig = signal("en");
  const messagesSig = signal([]);

  const currentLang = () => {
    if (typeof getLang === "function") return getLang() === "tr" ? "tr" : "en";
    try {
      return localStorage.getItem("mm-lang") === "tr" ? "tr" : "en";
    } catch {
      return "en";
    }
  };

  ensureNpcUiI18n(currentLang());

  function isOpen() {
    return Boolean(modalEl?.classList.contains("open"));
  }

  function appendMessage(senderType, senderLabel, text, sourceNote = "") {
    messagesSig.value = [
      ...messagesSig.value,
      {
        id: `${Date.now()}-${messagesSig.value.length}`,
        senderType: senderType === "user" ? "user" : "npc",
        senderLabel,
        text,
        sourceNote: senderType !== "user" ? sourceNote : "",
      },
    ];
    if (messagesEl) {
      renderMessagesView();
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  function renderMessagesView() {
    if (!messagesEl) return;
    render(
      html`${messagesSig.value.map(
        (m) => html`
          <div key=${m.id} class=${`npc-msg ${m.senderType}`}>
            <div class="npc-msg-sender">${m.senderLabel}</div>
            <div class="npc-msg-body">${m.text}</div>
            ${m.sourceNote ? html`<div class="npc-msg-source">${`SOURCE // ${m.sourceNote}`}</div>` : null}
          </div>
        `
      )}`,
      messagesEl
    );
  }

  function renderPresetsView() {
    if (!presetsEl) return;
    const spec = activeSpecSig.value;
    const isTr = langSig.value === "tr";
    const list = spec?.presets || [];
    render(
      html`${list.map(
        (preset) => html`
          <button
            key=${preset.id}
            type="button"
            class="npc-preset-btn"
            onClick=${() => {
              const activeSpec = activeSpecSig.value;
              if (!activeSpec) return;
              const activeLang = currentLang();
              langSig.value = activeLang;
              const qText = activeLang === "tr" ? preset.question.tr : preset.question.en;
              const aText = activeLang === "tr" ? preset.answer.tr : preset.answer.en;
              appendMessage("user", i18next.t("npcDlg.youLabel", { lng: activeLang }), qText);
              appendMessage(
                "npc",
                activeSpec.shortName || activeSpec.name,
                aText,
                "NASA Mission Archives & Project Baseline"
              );
              onReply?.(activeSpec, aText, activeLang);
            }}
          >
            ${isTr ? preset.label.tr : preset.label.en}
          </button>
        `
      )}`,
      presetsEl
    );
  }

  function applyLocalizedChrome(spec, lang) {
    ensureNpcUiI18n(lang);
    const isTr = lang === "tr";
    if (channelEl) channelEl.textContent = i18next.t("npcDlg.channel", { lng: lang });
    if (closeBtn) closeBtn.textContent = i18next.t("npcDlg.close", { lng: lang });
    if (presetsLblEl) presetsLblEl.textContent = i18next.t("npcDlg.presetsLbl", { lng: lang });
    if (inputEl) inputEl.placeholder = i18next.t("npcDlg.placeholder", { lng: lang });
    if (sendBtn) sendBtn.textContent = i18next.t("npcDlg.ask", { lng: lang });
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

    const lang = currentLang();
    activeSpecSig.value = spec;
    langSig.value = lang;
    messagesSig.value = [];

    applyLocalizedChrome(spec, lang);
    appendMessage("npc", spec.shortName || spec.name, lang === "tr" ? spec.greeting.tr : spec.greeting.en);
    renderPresetsView();

    if (inputEl) inputEl.value = "";
    modalEl.classList.add("open");
    if (typeof onOpen === "function") onOpen(spec);

    setTimeout(() => {
      if (isOpen()) inputEl?.focus?.({ preventScroll: true });
    }, 35);
    return true;
  }

  function close() {
    if (!modalEl || !isOpen()) return false;
    const closedSpec = activeSpecSig.value;
    modalEl.classList.remove("open");
    activeSpecSig.value = null;
    if (typeof onClose === "function") onClose(closedSpec);
    return true;
  }

  async function handleCustomSubmit(ev) {
    ev?.preventDefault?.();
    const specSnapshot = activeSpecSig.value;
    if (!specSnapshot || !inputEl) return;
    const rawText = inputEl.value.trim();
    if (!rawText) return;
    const lang = currentLang();
    langSig.value = lang;
    inputEl.value = "";

    appendMessage("user", i18next.t("npcDlg.youLabel", { lng: lang }), rawText);
    const res = await queryNpcWithHook(specSnapshot.id, rawText, { lang });
    if (!isOpen() || activeSpecSig.value?.id !== specSnapshot.id) return;
    appendMessage(
      "npc",
      specSnapshot.shortName || specSnapshot.name,
      res.answer,
      res.sourceNote || "NASA Mars Archives"
    );
    onReply?.(specSnapshot, res.answer, lang);
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
    getActiveNpc: () => activeSpecSig.value,
    openForNpc,
    close,
  };
}
