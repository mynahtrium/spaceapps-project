/**
 * Unified Map Adapter Contract (IMapAdapter) + Event Emitter Base + Rollback Feature Flag.
 *
 * Isolates the rest of the Martian Mappers UI (`planner.js`, `hud3d.js`, `app.js`)
 * from direct MapLibre or Three.js internals using the Strangler-Fig pattern.
 *
 * Flip `?legacyMap=1` in URL or `window.MM_USE_HIGHRES_MAP = false` for instant rollback.
 */

export function shouldUseHighResMap() {
  if (typeof window === "undefined") return true;
  if (window.MM_USE_HIGHRES_MAP === false) return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("legacyMap") === "1") return false;
  } catch {
    // ignore non-standard locations
  }
  return true;
}

/**
 * Abstract interface & reusable pub-sub helper for Mars 2D/3D Map Adapters.
 */
export class BaseMapAdapter {
  constructor(name = "BaseMapAdapter") {
    this.adapterName = name;
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
    this._mounted = false;
  }

  /**
   * Subscribe to adapter events:
   * - 'viewchange': { center: [lon, lat], zoom, pitch, bearing, elevM }
   * - 'click': { lon, lat, elevM, slopeDeg, x, y, lngLat }
   * - 'hover': { lon, lat, elevM, slopeDeg, x, y }
   * - 'tileerror': { providerId, message, status }
   * - 'attributionchange': Array<{ id, label, sourceUrl, fetchDate }>
   * @param {string} event
   * @param {Function} fn
   */
  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const set = this._listeners.get(event);
    if (set) set.delete(fn);
  }

  emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.warn(`[${this.adapterName}] listener error on '${event}':`, err);
      }
    }
  }

  /** @param {HTMLElement} _container @param {object} _options */
  async mount(_container, _options = {}) {
    throw new Error(`${this.adapterName}.mount() must be implemented`);
  }

  unmount() {
    this._listeners.clear();
    this._mounted = false;
  }

  resize() {}

  /** @param {{ center?: [number, number], zoom?: number, pitch?: number, bearing?: number }} _view */
  setView(_view) {}

  /** @param {{ center?: [number, number], zoom?: number, pitch?: number, bearing?: number, durationMs?: number }} _view */
  flyTo(_view) {}

  /** @returns {{ center: [number, number], zoom: number, pitch: number, bearing: number }} */
  getView() {
    return { center: [137.39, -4.8], zoom: 14, pitch: 0, bearing: 0 };
  }

  /** @returns {{ west: number, south: number, east: number, north: number }} */
  getBounds() {
    return {
      west: 137.372831,
      south: -4.816946,
      east: 137.406542,
      north: -4.783236,
    };
  }

  /** @param {[number, number]} _lonLat @returns {[number, number]|null} */
  project(_lonLat) {
    return null;
  }

  /** @param {[number, number]} _screenXY @returns {[number, number]|null} */
  unproject(_screenXY) {
    return null;
  }

  /** @param {string} _providerId */
  setTerrainSource(_providerId) {}

  /** @param {string} _providerId */
  setImageryProvider(_providerId) {}

  /** @param {number} _factor */
  setTerrainExaggeration(_factor) {}

  /** @param {string} _id @param {object} _featureCollection @param {object} [_style] */
  addGeoJsonLayer(_id, _featureCollection, _style = {}) {}

  /** @param {string} _id @param {object} _featureCollection */
  updateGeoJsonLayer(_id, _featureCollection) {}

  /** @param {string} _id */
  removeLayer(_id) {}

  /** @param {string} _id @param {boolean} _visible */
  setLayerVisibility(_id, _visible) {}

  /** @param {[number, number]} _lonLat @returns {number|null} */
  sampleElevation(_lonLat) {
    return null;
  }

  /** @param {Array<[number, number]>} _coords */
  sampleElevationProfile(_coords) {
    return [];
  }

  /** @returns {Array<{ id: string, label: string, sourceUrl?: string, fetchDate?: string }>} */
  getActiveAttributions() {
    return [];
  }
}
