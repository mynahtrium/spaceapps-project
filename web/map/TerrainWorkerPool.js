/**
 * Priority-Scheduled WebWorker Pool for Mars Terrain Meshing & Normal Synthesis.
 *
 * - Supports `AbortSignal` cancellation for panned-away / out-of-frustum tiles.
 * - Transfers Float32/Uint32/Uint8 buffers zero-copy between workers and main thread.
 * - Falls back automatically to direct async `TerrainMeshBuilder` execution when
 *   WebWorkers are unavailable (Node.js tests or restricted sandboxes).
 */

import { makeLocalTangentOrigin } from "./Geodesy.js";
import { buildMarsTerrainTilePayload } from "./TerrainMeshBuilder.js";

function makeAbortError(msg = "Terrain job aborted") {
  const err = new Error(msg);
  err.name = "AbortError";
  return err;
}

export class TerrainWorkerPool {
  /**
   * @param {object} [opts]
   * @param {number} [opts.poolSize]
   * @param {string} [opts.workerUrl]
   * @param {boolean} [opts.forceMainThread=false]
   */
  constructor(opts = {}) {
    const hw = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
    this.poolSize = Math.max(1, Math.min(4, opts.poolSize ?? Math.min(3, hw)));
    this.workerUrl = opts.workerUrl || new URL("./terrain.worker.js", import.meta.url).href;
    this.forceMainThread = Boolean(opts.forceMainThread) || typeof Worker === "undefined";

    /** @type {Array<{ worker: Worker, busyJobId: string|null, ready: boolean }>} */
    this._workers = [];
    /** @type {Array<object>} */
    this._queue = [];
    /** @type {Map<string, object>} */
    this._pending = new Map();

    this._demSampler = null;
    this._rtcOrigin = null;
    this._nextId = 1;
    this._disposed = false;
  }

  /**
   * Share the decoded Mars DEM grid and RTC tangent origin with all workers (and fallback).
   * @param {import('./MarsDemSampler.js').MarsDemSampler} demSampler
   * @param {{ lonDeg: number, latDeg: number, elevM: number }} rtcAnchor
   */
  async initDem(demSampler, rtcAnchor) {
    this._demSampler = demSampler;
    this._rtcOrigin = makeLocalTangentOrigin(
      rtcAnchor.lonDeg,
      rtcAnchor.latDeg,
      rtcAnchor.elevM
    );

    if (this.forceMainThread) return;

    try {
      await this._ensureWorkers();
    } catch (err) {
      console.warn("[TerrainWorkerPool] Module Worker unavailable; using main-thread fallback:", err);
      this.forceMainThread = true;
      return;
    }

    const initPromises = this._workers.map(
      (slot) =>
        new Promise((resolve, reject) => {
          const jobId = `init_${this._nextId++}`;
          const elevCopy = new Float32Array(demSampler.elevations);
          const rawCopy = demSampler.rawElevations
            ? new Float32Array(demSampler.rawElevations)
            : null;
          const transferables = [elevCopy.buffer];
          if (rawCopy) transferables.push(rawCopy.buffer);

          const onMsg = (e) => {
            if (!e.data || e.data.jobId !== jobId) return;
            slot.worker.removeEventListener("message", onMsg);
            if (e.data.type === "INIT_OK") {
              slot.ready = true;
              resolve();
            } else {
              reject(new Error(e.data.error || "Worker init failed"));
            }
          };
          slot.worker.addEventListener("message", onMsg);
          slot.worker.postMessage(
            {
              type: "INIT_DEM",
              jobId,
              bounds: demSampler.bounds,
              ncols: demSampler.ncols,
              nrows: demSampler.nrows,
              cellSizeM: demSampler.cellSizeM,
              minElevM: demSampler.minElevM,
              maxElevM: demSampler.maxElevM,
              rtcAnchor,
              elevationsBuffer: elevCopy.buffer,
              rawElevationsBuffer: rawCopy ? rawCopy.buffer : null,
            },
            transferables
          );
        })
    );

    try {
      await Promise.all(initPromises);
    } catch (err) {
      console.warn("[TerrainWorkerPool] Worker INIT_DEM failed; falling back to main thread:", err);
      this.disposeWorkersOnly();
      this.forceMainThread = true;
    }
  }

  async _ensureWorkers() {
    if (this._workers.length > 0) return;
    for (let i = 0; i < this.poolSize; i++) {
      const worker = new Worker(this.workerUrl, { type: "module" });
      const slot = { worker, busyJobId: null, ready: false };
      worker.addEventListener("message", (e) => this._handleWorkerMessage(slot, e.data));
      worker.addEventListener("error", (err) => {
        console.warn("[TerrainWorkerPool] Worker error:", err?.message || err);
        if (slot.busyJobId && this._pending.has(slot.busyJobId)) {
          const job = this._pending.get(slot.busyJobId);
          this._pending.delete(slot.busyJobId);
          job.reject(new Error("Worker crashed"));
        }
        slot.busyJobId = null;
        this._pump();
      });
      this._workers.push(slot);
    }
  }

  _handleWorkerMessage(slot, msg) {
    if (!msg || !msg.jobId || msg.type === "INIT_OK") return;
    const job = this._pending.get(msg.jobId);
    slot.busyJobId = null;

    if (job) {
      this._pending.delete(msg.jobId);
      if (job.cleanupSignal) job.cleanupSignal();

      if (msg.type === "TILE_BUILT") {
        job.resolve(msg.payload);
      } else if (msg.type === "JOB_ABORTED") {
        job.reject(makeAbortError());
      } else {
        job.reject(new Error(msg.error || "Worker tile error"));
      }
    }
    this._pump();
  }

  /**
   * Build a terrain tile mesh + analytical normal map off-main-thread.
   * Lower `priority` runs first (e.g. camera distance in meters).
   */
  buildTile(params, { priority = 1000, signal = null } = {}) {
    if (this._disposed) {
      return Promise.reject(new Error("TerrainWorkerPool disposed"));
    }
    if (!this._demSampler || !this._rtcOrigin) {
      return Promise.reject(new Error("DEM not initialized"));
    }
    if (signal?.aborted) {
      return Promise.reject(makeAbortError());
    }

    if (this.forceMainThread) {
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(makeAbortError());
        if (signal) signal.addEventListener("abort", onAbort, { once: true });
        Promise.resolve().then(() => {
          if (signal) signal.removeEventListener("abort", onAbort);
          if (signal?.aborted) {
            reject(makeAbortError());
            return;
          }
          try {
            const payload = buildMarsTerrainTilePayload({
              demSampler: this._demSampler,
              bounds: params.bounds,
              rtcOrigin: this._rtcOrigin,
              segments: params.segments,
              normalTexSize: params.normalTexSize,
              exaggeration: params.exaggeration,
              skirtDepthM: params.skirtDepthM,
            });
            resolve(payload);
          } catch (err) {
            reject(err);
          }
        });
      });
    }

    return new Promise((resolve, reject) => {
      const jobId = `tile_${this._nextId++}`;
      const job = {
        jobId,
        params,
        priority,
        signal,
        resolve,
        reject,
        slot: null,
        cleanupSignal: null,
      };

      if (signal) {
        const onAbort = () => {
          // Remove from queue or signal active worker
          const qIdx = this._queue.indexOf(job);
          if (qIdx >= 0) this._queue.splice(qIdx, 1);
          this._pending.delete(jobId);
          if (job.slot) {
            job.slot.worker.postMessage({ type: "ABORT_JOB", jobId });
            job.slot.busyJobId = null;
          }
          reject(makeAbortError());
          this._pump();
        };
        signal.addEventListener("abort", onAbort, { once: true });
        job.cleanupSignal = () => signal.removeEventListener("abort", onAbort);
      }

      this._queue.push(job);
      this._queue.sort((a, b) => a.priority - b.priority);
      this._pump();
    });
  }

  _pump() {
    if (this._disposed || this.forceMainThread) return;
    while (this._queue.length > 0) {
      const freeSlot = this._workers.find((w) => w.ready && !w.busyJobId);
      if (!freeSlot) break;
      const job = this._queue.shift();
      if (!job || job.signal?.aborted) continue;
      freeSlot.busyJobId = job.jobId;
      job.slot = freeSlot;
      this._pending.set(job.jobId, job);
      freeSlot.worker.postMessage({
        type: "BUILD_TILE",
        jobId: job.jobId,
        tileKey: job.params.tileKey,
        bounds: job.params.bounds,
        segments: job.params.segments,
        normalTexSize: job.params.normalTexSize,
        exaggeration: job.params.exaggeration,
        skirtDepthM: job.params.skirtDepthM,
      });
    }
  }

  disposeWorkersOnly() {
    for (const slot of this._workers) {
      try {
        slot.worker.terminate();
      } catch {
        // ignore
      }
    }
    this._workers = [];
  }

  dispose() {
    this._disposed = true;
    while (this._queue.length > 0) {
      const job = this._queue.shift();
      if (job.cleanupSignal) job.cleanupSignal();
      job.reject(makeAbortError("Pool disposed"));
    }
    for (const job of this._pending.values()) {
      if (job.cleanupSignal) job.cleanupSignal();
      job.reject(makeAbortError("Pool disposed"));
    }
    this._pending.clear();
    this.disposeWorkersOnly();
  }
}
