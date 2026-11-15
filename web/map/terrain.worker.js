/**
 * WebWorker Off-Main-Thread Mars Terrain Mesh & Analytical Normal Map Generator.
 *
 * Uses `comlink` RPC (`Comlink.expose` + `Comlink.transfer`) for zero-copy
 * ArrayBuffer transfer back to the main thread.
 */

import * as Comlink from "../../node_modules/comlink/dist/esm/comlink.mjs";
import { makeLocalTangentOrigin } from "./Geodesy.js";
import { MarsDemSampler } from "./MarsDemSampler.js";
import { buildMarsTerrainTilePayload } from "./TerrainMeshBuilder.js";

let demSampler = null;
let rtcOrigin = null;

const terrainWorkerApi = {
  /**
   * Initialize or update the worker's in-memory DEM raster and RTC origin.
   */
  initDem({ metadata, heights, rtcOriginSpec } = {}) {
    if (metadata && heights) {
      demSampler = new MarsDemSampler({
        metadata,
        heights: heights instanceof Float32Array ? heights : new Float32Array(heights),
      });
    }
    if (rtcOriginSpec) {
      rtcOrigin = makeLocalTangentOrigin(
        rtcOriginSpec.lonDeg,
        rtcOriginSpec.latDeg,
        rtcOriginSpec.elevM
      );
    }
    return true;
  },

  /**
   * Build a terrain tile mesh + analytical normal map and transfer buffers zero-copy via Comlink.
   */
  buildTile({
    tileKey,
    bounds,
    rtcOrigin: customRtcOrigin,
    segments = 48,
    normalTexSize = 128,
    exaggeration = 1.0,
    skirtDepthM = 120,
    maxError = -1,
  }) {
    const activeRtcOrigin = customRtcOrigin || rtcOrigin;
    if (!demSampler || !activeRtcOrigin) {
      throw new Error("terrain.worker: initDem must be called before buildTile");
    }
    const payload = buildMarsTerrainTilePayload({
      demSampler,
      bounds,
      rtcOrigin: activeRtcOrigin,
      segments,
      normalTexSize,
      exaggeration,
      skirtDepthM,
      maxError,
    });
    return Comlink.transfer(
      { tileKey, ...payload },
      [
        payload.positions.buffer,
        payload.normals.buffer,
        payload.uvs.buffer,
        payload.indices.buffer,
        payload.normalMapRgba.buffer,
      ]
    );
  },
};

if (typeof self !== "undefined" && typeof self.addEventListener === "function") {
  Comlink.expose(terrainWorkerApi);
}

export { terrainWorkerApi };
