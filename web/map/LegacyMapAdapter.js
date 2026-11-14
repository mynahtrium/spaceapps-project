/**
 * Strangler-Fig Rollback Adapter (`?legacyMap=1` or `MM_USE_HIGHRES_MAP = false`).
 * Implements the full `IMapAdapter` contract using the zero-dependency 2D Canvas map.
 */

import { Fallback2DMap } from "./Fallback2DMap.js";

export class LegacyMapAdapter extends Fallback2DMap {
  constructor(opts = {}) {
    super({
      ...opts,
      adapterName: "LegacyMapAdapter",
    });
  }
}
