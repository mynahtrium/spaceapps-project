/**
 * Controller on the map (`web/planner/map-gamepad.js`).
 *
 * While the map is on screen and a controller is connected:
 *   left stick  moves a crosshair (the teleport target); near the edge it pans the map
 *   right stick turns the view (left/right); up/down tilts it in 3D, zooms in 2D
 *   LT / RT     zoom out / in
 *   A           teleport to the crosshair        B  back to the 3D view (handled in app.js)
 * Works with the MapLibre map (3D terrain in demo mode, 2D otherwise) and the 2D fallback map,
 * through the shared map adapter interface (getView / setView / unproject / sampleElevation).
 */

import { gamepad } from "../shared/gamepad.js";

const CSS = `
.pad-crosshair { position: absolute; width: 34px; height: 34px; margin: -17px 0 0 -17px; pointer-events: none;
  z-index: 6; display: none; }
.pad-crosshair.on { display: block; }
.pad-crosshair::before, .pad-crosshair::after { content: ""; position: absolute; background: #fff;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.7); }
.pad-crosshair::before { left: 16px; top: 0; width: 2px; height: 34px; }
.pad-crosshair::after { top: 16px; left: 0; height: 2px; width: 34px; }
.pad-crosshair .ring { position: absolute; inset: 9px; border: 1.5px solid #fff; border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.6); }
.pad-map-hint { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 6;
  background: rgba(0,0,0,0.82); border: 1px solid rgba(255,255,255,0.25); padding: 7px 12px;
  font-size: 10px; letter-spacing: 0.14em; color: rgba(255,255,255,0.85); white-space: nowrap; display: none; }
.pad-map-hint.on { display: block; }
`;

export function initMapGamepad({ adapter, container, isActive, is3d, onTeleport, probeTextEl }) {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const host = container.parentElement || container; // #map-container (positioned)
  const cross = document.createElement("div");
  cross.className = "pad-crosshair";
  cross.innerHTML = '<div class="ring"></div>';
  const hint = document.createElement("div");
  hint.className = "pad-map-hint";
  host.append(cross, hint);

  let cx = null; // crosshair position in container pixels
  let cy = null;
  let last = performance.now();
  let lastReadout = 0;

  const size = () => [container.clientWidth || 1, container.clientHeight || 1];

  function centerCrosshair() {
    const [w, h] = size();
    cx = w / 2;
    cy = h / 2;
  }

  function target() {
    if (cx == null) centerCrosshair();
    const ll = adapter.unproject?.([cx, cy]);
    return ll && Number.isFinite(ll[0]) && Number.isFinite(ll[1]) ? { lon: ll[0], lat: ll[1] } : null;
  }

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const on = isActive() && gamepad.connected && !document.getElementById("pad-setup")?.classList.contains("open");
    cross.classList.toggle("on", on);
    hint.classList.toggle("on", on);
    if (on) {
      if (cx == null) centerCrosshair();
      const threeD = is3d();
      hint.textContent = `LEFT STICK TARGET · RIGHT STICK ${threeD ? "TURN / TILT" : "TURN / ZOOM"} · LT/RT ZOOM · A TELEPORT · B BACK`;
      const [w, h] = size();
      const view = adapter.getView?.() || {};
      const next = { ...view };
      let changed = false;

      // crosshair (left stick, not the swapped/inverted look settings)
      const mv = gamepad.move();
      if (mv.x || mv.y) {
        const speed = 520 * dt;
        cx += mv.x * speed;
        cy -= mv.y * speed;
        // near the edge, pan the map instead of leaving the screen
        const m = 46;
        let panX = 0;
        let panY = 0;
        if (cx < m) (panX = cx - m), (cx = m);
        if (cx > w - m) (panX = cx - (w - m)), (cx = w - m);
        if (cy < m) (panY = cy - m), (cy = m);
        if (cy > h - m) (panY = cy - (h - m)), (cy = h - m);
        if ((panX || panY) && view.center) {
          const c = adapter.unproject?.([w / 2 + panX, h / 2 + panY]);
          if (c) (next.center = c), (changed = true);
        }
      }

      // right stick: turn, and tilt (3D) or zoom (2D)
      const lk = gamepad.look();
      if (lk.x && view.bearing != null) {
        next.bearing = view.bearing + lk.x * 90 * dt;
        changed = true;
      }
      if (lk.y) {
        if (threeD && view.pitch != null) next.pitch = Math.max(0, Math.min(80, view.pitch - lk.y * 55 * dt));
        else if (view.zoom != null) next.zoom = view.zoom + lk.y * 1.2 * dt;
        changed = true;
      }

      // triggers zoom
      const zIn = gamepad.buttons[7] || 0;
      const zOut = gamepad.buttons[6] || 0;
      if ((zIn > 0.05 || zOut > 0.05) && view.zoom != null) {
        next.zoom = Math.max(9, Math.min(19, (next.zoom ?? view.zoom) + (zIn - zOut) * 1.6 * dt));
        changed = true;
      }

      if (changed) adapter.setView?.(next);
      cross.style.left = `${cx}px`;
      cross.style.top = `${cy}px`;

      // readout under the crosshair, a few times a second
      if (probeTextEl && now - lastReadout > 120) {
        lastReadout = now;
        const t = target();
        if (t) {
          const e = adapter.sampleElevation?.([t.lon, t.lat]);
          const elev = Number.isFinite(e) ? `${e.toFixed(1)} m` : "no data";
          probeTextEl.textContent = `${t.lat.toFixed(5)}°, ${t.lon.toFixed(5)}° · ${elev} · A TO TELEPORT`;
        }
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    /** A on the map: teleport to the crosshair. Returns true if it teleported. */
    confirm() {
      const t = target();
      if (!t) return false;
      onTeleport(t.lon, t.lat);
      return true;
    },
    /** Put the crosshair on a place (e.g. where the walker is) when the map opens. */
    focus(lon, lat) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      const view = adapter.getView?.() || {};
      adapter.setView?.({ ...view, center: [lon, lat] });
      centerCrosshair();
    },
  };
}
