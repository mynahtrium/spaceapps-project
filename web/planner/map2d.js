/**
 * Minimal 2D map for Mars in its native equirectangular (planetocentric, east-positive) frame
 * (`web/planner/map2d.js`). NASA Mars Trek and the OnMars CTX mosaic both serve equirectangular tiles,
 * so drawing them needs no reprojection: a local plate carree scaled by cos(latitude) at the view centre.
 *
 * Layers:
 *   { kind: "tiles", id, label, url(z, row, col), tilePx, maxZ, minZ, opacity }
 *   { kind: "image", id, label, url, bounds: { west, east, south, north }, opacity }
 *   { kind: "canvas", id, label, canvas, bounds, opacity }        (e.g. a computed slope raster)
 * Vector drawing goes through `onDraw(ctx, view)` callbacks.
 */

const MARS_R_M = 3389500;
const DEG = Math.PI / 180;

export function createMap2D(canvas, { center = [137.39, -4.77], metersPerPixel = 20, onClick, onHover, onDraw } = {}) {
  const ctx = canvas.getContext("2d");
  const view = { lon: center[0], lat: center[1], mpp: metersPerPixel, w: 1, h: 1, dpr: 1 };
  const layers = [];
  const tileCache = new Map(); // url -> { img, ok, failed }
  let dirty = false;
  const drawHooks = onDraw ? [onDraw] : [];

  const kx = () => MARS_R_M * DEG * Math.cos(view.lat * DEG);
  const ky = () => MARS_R_M * DEG;
  function project(lon, lat) {
    let dl = lon - view.lon;
    dl = ((dl + 540) % 360) - 180;
    return [(dl * kx()) / view.mpp + view.w / 2, ((view.lat - lat) * ky()) / view.mpp + view.h / 2];
  }
  function unproject(x, y) {
    let lon = view.lon + ((x - view.w / 2) * view.mpp) / kx();
    lon = ((lon + 540) % 360) - 180;
    return [lon, view.lat - ((y - view.h / 2) * view.mpp) / ky()];
  }
  function viewBounds() {
    const [west, north] = unproject(0, 0);
    const [east, south] = unproject(view.w, view.h);
    return { west, east, south, north };
  }

  function invalidate() {
    if (!dirty) {
      dirty = true;
      requestAnimationFrame(render);
    }
  }

  function getTile(url) {
    let t = tileCache.get(url);
    if (!t) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      t = { img, ok: false, failed: false };
      img.onload = () => {
        t.ok = true;
        invalidate();
      };
      img.onerror = () => {
        t.failed = true;
      };
      img.src = url;
      tileCache.set(url, t);
      if (tileCache.size > 900) tileCache.delete(tileCache.keys().next().value);
    }
    return t;
  }

  function drawImageBounds(img, b, opacity, srcRect = null) {
    const [xw, y0] = project(b.west, b.north);
    const wPx = ((b.east - b.west) * kx()) / view.mpp;
    const hPx = ((b.north - b.south) * ky()) / view.mpp;
    const worldPx = (360 * kx()) / view.mpp;
    ctx.globalAlpha = opacity ?? 1;
    // an image may need drawing one world-width to either side (dateline, or a global mosaic)
    for (const x0 of [xw - worldPx, xw, xw + worldPx]) {
      if (x0 + wPx < 0 || x0 > view.w || y0 + hPx < 0 || y0 > view.h) continue;
      const [sx, sy, sw, sh] = srcRect || [0, 0, img.naturalWidth || img.width, img.naturalHeight || img.height];
      // clip to the viewport so a zoomed-in global mosaic is not drawn kilometres wide
      const cx0 = Math.max(0, x0);
      const cy0 = Math.max(0, y0);
      const cx1 = Math.min(view.w, x0 + wPx);
      const cy1 = Math.min(view.h, y0 + hPx);
      const fx = sw / wPx;
      const fy = sh / hPx;
      ctx.drawImage(img, sx + (cx0 - x0) * fx, sy + (cy0 - y0) * fy, (cx1 - cx0) * fx, (cy1 - cy0) * fy, cx0, cy0, cx1 - cx0, cy1 - cy0);
    }
    ctx.globalAlpha = 1;
  }

  function drawTiles(L) {
    const degPerScreenPx = view.mpp / ky();
    const ideal = Math.log2(180 / (L.tilePx * degPerScreenPx));
    const z = Math.max(L.minZ ?? 0, Math.min(L.maxZ, Math.ceil(ideal - 0.3)));
    const tileDeg = 180 / 2 ** z;
    const b = viewBounds();
    const r0 = Math.max(0, Math.floor((90 - b.north) / tileDeg));
    const r1 = Math.min(2 ** z - 1, Math.floor((90 - b.south) / tileDeg));
    const c0 = Math.floor((b.west + 180) / tileDeg);
    let c1 = Math.floor((b.east + 180) / tileDeg);
    if (c1 < c0) c1 += 2 ** (z + 1);
    const cols = 2 ** (z + 1);
    if ((r1 - r0 + 1) * (c1 - c0 + 1) > 400) return;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cc = ((c % cols) + cols) % cols;
        const tb = { west: -180 + cc * tileDeg, east: -180 + (cc + 1) * tileDeg, north: 90 - r * tileDeg, south: 90 - (r + 1) * tileDeg };
        const t = getTile(L.url(z, r, cc));
        if (t.ok) {
          drawImageBounds(t.img, tb, L.opacity);
          continue;
        }
        // until it arrives, draw the parent tile's matching quarter (if cached)
        for (let up = 1; up <= 4 && z - up >= (L.minZ ?? 0); up++) {
          const pz = z - up;
          const k = 2 ** up;
          const pr = Math.floor(r / k);
          const pc = Math.floor(cc / k);
          const pt = tileCache.get(L.url(pz, pr, pc));
          if (pt?.ok) {
            const s = L.tilePx / k;
            drawImageBounds(pt.img, tb, L.opacity, [(cc % k) * s, (r % k) * s, s, s]);
            break;
          }
        }
      }
    }
  }

  function render() {
    dirty = false;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = "#0b0d10";
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.imageSmoothingEnabled = view.mpp > 2;
    for (const L of layers) {
      if (L.visible === false) continue;
      if (L.kind === "tiles") drawTiles(L);
      else if (L.kind === "image") {
        if (!L._img) {
          L._img = new Image();
          L._img.onload = invalidate;
          L._img.src = L.url;
        }
        if (L._img.complete && L._img.naturalWidth) drawImageBounds(L._img, L.bounds, L.opacity);
      } else if (L.kind === "canvas" && L.canvas) drawImageBounds(L.canvas, L.bounds, L.opacity);
    }
    for (const h of drawHooks) h(ctx, api);
    drawScale();
  }

  function drawScale() {
    const targetPx = 120;
    const raw = targetPx * view.mpp;
    const pow = 10 ** Math.floor(Math.log10(raw));
    const nice = [1, 2, 5, 10].map((k) => k * pow).filter((v) => v <= raw).pop() || pow;
    const px = nice / view.mpp;
    const x = 16;
    const y = view.h - 18;
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + px, y);
    ctx.stroke();
    ctx.fillStyle = "#e5e7eb";
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, x, y - 6);
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    view.dpr = Math.min(2, window.devicePixelRatio || 1);
    view.w = Math.max(1, r.width);
    view.h = Math.max(1, r.height);
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    invalidate();
  }

  // ---------- interaction ----------
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, lon: view.lon, lat: view.lat, moved: false, button: e.button };
  });
  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    if (drag && api.dragHandler?.move) {
      if (api.dragHandler.move(...unproject(mx, my))) {
        drag.moved = true;
        return;
      }
    }
    if (drag) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 3) drag.moved = true;
      view.lon = drag.lon - (dx * view.mpp) / kx();
      view.lat = Math.max(-89, Math.min(89, drag.lat + (dy * view.mpp) / ky()));
      invalidate();
    }
    onHover?.(...unproject(mx, my), mx, my);
  });
  canvas.addEventListener("pointerup", (e) => {
    const r = canvas.getBoundingClientRect();
    const d = drag;
    drag = null;
    api.dragHandler?.end?.();
    if (d && !d.moved) onClick?.(...unproject(e.clientX - r.left, e.clientY - r.top), e);
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const [lon, lat] = unproject(mx, my);
      const f = Math.exp(e.deltaY * 0.0015);
      view.mpp = Math.max(0.25, Math.min(60000, view.mpp * f));
      // keep the point under the cursor fixed
      const [lon2, lat2] = unproject(mx, my);
      view.lon += lon - lon2;
      view.lat = Math.max(-89, Math.min(89, view.lat + (lat - lat2)));
      invalidate();
    },
    { passive: false }
  );
  new ResizeObserver(resize).observe(canvas);

  const api = {
    view,
    layers,
    project,
    unproject,
    viewBounds,
    invalidate,
    resize,
    dragHandler: null,
    addLayer(L) {
      layers.push(L);
      invalidate();
      return L;
    },
    setLayerVisible(id, on) {
      const L = layers.find((l) => l.id === id);
      if (L) L.visible = on;
      invalidate();
    },
    addDrawHook(fn) {
      drawHooks.push(fn);
    },
    flyTo(lon, lat, mpp = view.mpp) {
      view.lon = lon;
      view.lat = lat;
      view.mpp = mpp;
      invalidate();
    },
    fitBounds(b, padPx = 40) {
      view.lon = (b.west + b.east) / 2;
      view.lat = (b.south + b.north) / 2;
      const wm = (b.east - b.west) * kx();
      const hm = (b.north - b.south) * ky();
      view.mpp = Math.max(0.25, Math.max(wm / Math.max(1, view.w - 2 * padPx), hm / Math.max(1, view.h - 2 * padPx)));
      invalidate();
    },
    metersPerPixel: () => view.mpp,
  };
  resize();
  return api;
}
