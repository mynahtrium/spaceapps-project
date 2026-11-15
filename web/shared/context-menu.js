/**
 * Custom right-click menu (`web/shared/context-menu.js`).
 *
 * Replaces the browser context menu with a mission-styled one whose items depend on
 * where you right-clicked. Uses `@floating-ui/dom` (`computePosition`, `flip`, `shift`)
 * for viewport-aware positioning and flipping.
 */

import { computePosition, flip, shift } from "@floating-ui/dom";

const DRAG_PX = 5;

/**
 * Drop hidden items, trim leading/trailing separators and collapse repeated ones.
 * Item shape: { label, hint?, action?, disabled?, hidden?, danger? } or { separator: true }
 * or { heading: "TEXT" }.
 */
export function normalizeItems(items) {
  const out = [];
  for (const it of items || []) {
    if (!it || it.hidden) continue;
    if (it.separator) {
      if (out.length === 0 || out[out.length - 1].separator) continue;
      out.push({ separator: true });
      continue;
    }
    if (it.heading) {
      if (out.length && out[out.length - 1].separator) out.pop();
      if (out.length && out[out.length - 1].heading) out.pop();
      out.push({ heading: String(it.heading) });
      continue;
    }
    out.push(it);
  }
  while (out.length && (out[out.length - 1].separator || out[out.length - 1].heading)) out.pop();
  return out;
}

/**
 * Synchronous viewport flip + shift helper matching `@floating-ui/dom` `right-start` +
 * `flip({ fallbackPlacements: ["left-start"] })` + `shift({ padding: margin })`.
 */
export function clampMenuPosition(x, y, w, h, vw, vh, margin = 8) {
  const flippedLeft = x + w + margin > vw ? x - w : x;
  const shiftedTop = y + h + margin > vh ? vh - h - margin : y;
  return {
    left: Math.max(margin, flippedLeft),
    top: Math.max(margin, shiftedTop),
  };
}

/** True when the browser's own menu is more useful (copy/paste, links). */
export function wantsNativeMenu(target, { shiftKey = false, selectionText = "" } = {}) {
  if (shiftKey) return true;
  if (selectionText && selectionText.trim()) return true;
  const el = target?.closest ? target : target?.parentElement;
  if (!el?.closest) return false;
  return Boolean(el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], a[href]'));
}

export function initContextMenu({ getItems, root = document.body } = {}) {
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  root.appendChild(menu);

  let buttons = [];
  let focusIdx = -1;
  let restoreFocus = null;

  const right = { down: false, x: 0, y: 0, moved: false, pending: null };

  function isOpen() {
    return !menu.hidden;
  }

  function close() {
    if (!isOpen()) return;
    menu.hidden = true;
    menu.replaceChildren();
    buttons = [];
    focusIdx = -1;
    if (restoreFocus && document.contains(restoreFocus)) {
      try {
        restoreFocus.focus({ preventScroll: true });
      } catch {}
    }
    restoreFocus = null;
  }

  function setFocus(i) {
    if (!buttons.length) return;
    focusIdx = (i + buttons.length) % buttons.length;
    buttons[focusIdx].focus({ preventScroll: true });
  }

  function positionMenu(x, y) {
    const r = menu.getBoundingClientRect();
    const initial = clampMenuPosition(x, y, r.width, r.height, window.innerWidth, window.innerHeight, 8);
    menu.style.left = `${initial.left}px`;
    menu.style.top = `${initial.top}px`;

    const virtualReference = {
      getBoundingClientRect() {
        return {
          width: 0,
          height: 0,
          x,
          y,
          top: y,
          left: x,
          right: x,
          bottom: y,
        };
      },
    };

    computePosition(virtualReference, menu, {
      strategy: "fixed",
      placement: "right-start",
      middleware: [
        flip({ padding: 8, fallbackPlacements: ["left-start"] }),
        shift({ padding: 8 }),
      ],
    })
      .then(({ x: fx, y: fy }) => {
        if (!menu.hidden) {
          menu.style.left = `${Math.round(fx)}px`;
          menu.style.top = `${Math.round(fy)}px`;
        }
      })
      .catch(() => {});
  }

  function open(ctx) {
    const items = normalizeItems(getItems?.(ctx));
    if (!items.length) return false;
    menu.replaceChildren();
    buttons = [];
    for (const it of items) {
      if (it.separator) {
        const sep = document.createElement("div");
        sep.className = "ctx-sep";
        sep.setAttribute("role", "separator");
        menu.appendChild(sep);
        continue;
      }
      if (it.heading) {
        const h = document.createElement("div");
        h.className = "ctx-heading";
        h.textContent = it.heading;
        menu.appendChild(h);
        continue;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ctx-item" + (it.danger ? " danger" : "");
      btn.setAttribute("role", "menuitem");
      btn.disabled = Boolean(it.disabled);
      const label = document.createElement("span");
      label.className = "ctx-label";
      label.textContent = it.label;
      btn.appendChild(label);
      if (it.hint) {
        const hint = document.createElement("span");
        hint.className = "ctx-hint";
        hint.textContent = it.hint;
        btn.appendChild(hint);
      }
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        close();
        try {
          it.action?.(ctx);
        } catch (err) {
          console.warn("[context-menu] action failed:", err);
        }
      });
      btn.addEventListener("mouseenter", () => {
        const k = buttons.indexOf(btn);
        if (k >= 0 && !btn.disabled) setFocus(k);
      });
      menu.appendChild(btn);
      if (!btn.disabled) buttons.push(btn);
    }

    restoreFocus = document.activeElement;
    menu.hidden = false;
    positionMenu(ctx.x, ctx.y);
    if (ctx.viaKeyboard) setFocus(0);
    else menu.focus?.({ preventScroll: true });
    return true;
  }

  function contextFromEvent(e, viaKeyboard = false) {
    return { x: e.clientX, y: e.clientY, target: e.target, viaKeyboard };
  }

  menu.tabIndex = -1;
  menu.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener(
    "pointerdown",
    (e) => {
      if (isOpen() && !menu.contains(e.target)) close();
      if (e.button === 2) Object.assign(right, { down: true, x: e.clientX, y: e.clientY, moved: false, pending: null });
    },
    true
  );
  window.addEventListener(
    "pointermove",
    (e) => {
      if (!right.down || right.moved) return;
      if (Math.hypot(e.clientX - right.x, e.clientY - right.y) > DRAG_PX) right.moved = true;
    },
    true
  );
  window.addEventListener(
    "pointerup",
    (e) => {
      if (e.button !== 2 || !right.down) return;
      right.down = false;
      const ctx = right.pending;
      right.pending = null;
      if (ctx && !right.moved) open(ctx);
    },
    true
  );

  document.addEventListener(
    "contextmenu",
    (e) => {
      if (menu.contains(e.target)) return;
      const selectionText = window.getSelection?.()?.toString() || "";
      if (wantsNativeMenu(e.target, { shiftKey: e.shiftKey, selectionText })) {
        close();
        return;
      }
      e.preventDefault();
      close();
      if (document.pointerLockElement) return;
      const viaKeyboard = e.button !== 2 && e.clientX === 0 && e.clientY === 0;
      if (viaKeyboard) {
        const r = e.target?.getBoundingClientRect?.() || { left: 16, bottom: 16 };
        open({ x: r.left + 8, y: r.bottom, target: e.target, viaKeyboard: true });
        return;
      }
      const ctx = contextFromEvent(e);
      if (right.down) right.pending = ctx;
      else if (!right.moved) open(ctx);
    },
    true
  );

  window.addEventListener(
    "keydown",
    (e) => {
      if (!isOpen()) return;
      const k = e.key;
      if (k === "Escape") close();
      else if (k === "ArrowDown") setFocus(focusIdx + 1);
      else if (k === "ArrowUp") setFocus(focusIdx - 1);
      else if (k === "Home") setFocus(0);
      else if (k === "End") setFocus(buttons.length - 1);
      else if (k === "Tab") close();
      else if (k === "Enter" || k === " ") {
        if (focusIdx >= 0) buttons[focusIdx].click();
        else return;
      } else {
        e.stopImmediatePropagation();
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true
  );

  const closeSoon = () => close();
  window.addEventListener("resize", closeSoon);
  window.addEventListener("blur", closeSoon);
  window.addEventListener("wheel", closeSoon, { passive: true, capture: true });
  document.addEventListener("pointerlockchange", closeSoon);

  return { open, close, isOpen, element: menu };
}
