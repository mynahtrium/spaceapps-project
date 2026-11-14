/**
 * Dedicated WebWorker for off-main-thread Mars terrain meshing, 1-px border analytical normal
 * synthesis, optional Terrarium rasterization, and zero-copy Transferable buffer emission.
 */

import { makeLocalTangentOrigin } from "./Geodesy.js";
import { MarsDemSampler } from "./MarsDemSampler.js";
import { buildMarsTerrainTilePayload } from "./TerrainMeshBuilder.js";

/** @type {MarsDemSampler|null} */
let demSampler = null;
/** @type {ReturnType<typeof makeLocalTangentOrigin>|null} */
let rtcOrigin = null;
/** @type {Map<string, AbortController>} */
const activeJobs = new Map();

self.addEventListener("message", async (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "INIT_DEM") {
    try {
      const elevations = new Float32Array(msg.elevationsBuffer);
      const rawElevations = msg.rawElevationsBuffer
        ? new Float32Array(msg.rawElevationsBuffer)
        : null;
      demSampler = new MarsDemSampler({
        bounds: msg.bounds,
        ncols: msg.ncols,
        nrows: msg.nrows,
        cellSizeM: msg.cellSizeM,
        elevations,
        rawElevations,
        minElevM: msg.minElevM,
        maxElevM: msg.maxElevM,
      });
      rtcOrigin = msg.rtcAnchor
        ? makeLocalTangentOrigin(
            msg.rtcAnchor.lonDeg,
            msg.rtcAnchor.latDeg,
            msg.rtcAnchor.elevM
          )
        : makeLocalTangentOrigin(
            (msg.bounds.west_lon_deg + msg.bounds.east_lon_deg) * 0.5,
            (msg.bounds.south_lat_deg + msg.bounds.north_lat_deg) * 0.5,
            msg.minElevM
          );
      self.postMessage({ type: "INIT_OK", jobId: msg.jobId });
    } catch (err) {
      self.postMessage({
        type: "JOB_ERROR",
        jobId: msg.jobId,
        error: err?.message || String(err),
      });
    }
    return;
  }

  if (msg.type === "ABORT_JOB") {
    const ctrl = activeJobs.get(msg.jobId);
    if (ctrl) {
      ctrl.abort();
      activeJobs.delete(msg.jobId);
    }
    return;
  }

  if (msg.type === "BUILD_TILE") {
    if (!demSampler || !rtcOrigin) {
      self.postMessage({
        type: "JOB_ERROR",
        jobId: msg.jobId,
        error: "Worker DEM not initialized",
      });
      return;
    }

    const controller = new AbortController();
    activeJobs.set(msg.jobId, controller);

    try {
      if (controller.signal.aborted) {
        self.postMessage({ type: "JOB_ABORTED", jobId: msg.jobId });
        return;
      }

      const payload = buildMarsTerrainTilePayload({
        demSampler,
        bounds: msg.bounds,
        rtcOrigin,
        segments: msg.segments ?? 48,
        normalTexSize: msg.normalTexSize ?? 128,
        exaggeration: msg.exaggeration ?? 1.0,
        skirtDepthM: msg.skirtDepthM ?? 120,
      });

      if (controller.signal.aborted) {
        self.postMessage({ type: "JOB_ABORTED", jobId: msg.jobId });
        return;
      }

      const transferables = [
        payload.positions.buffer,
        payload.normals.buffer,
        payload.uvs.buffer,
        payload.indices.buffer,
        payload.normalMapRgba.buffer,
      ];

      self.postMessage(
        {
          type: "TILE_BUILT",
          jobId: msg.jobId,
          tileKey: msg.tileKey,
          payload,
        },
        transferables
      );
    } catch (err) {
      if (controller.signal.aborted || err?.name === "AbortError") {
        self.postMessage({ type: "JOB_ABORTED", jobId: msg.jobId });
      } else {
        self.postMessage({
          type: "JOB_ERROR",
          jobId: msg.jobId,
          error: err?.message || String(err),
        });
      }
    } finally {
      activeJobs.delete(msg.jobId);
    }
  }
});
