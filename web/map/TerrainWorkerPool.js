/**
 * Mars Terrain WebWorker Pool powered by `comlink` with Automatic Main-Thread Fallback.
 *
 * - Spawns `Math.min(4, navigator.hardwareConcurrency || 2)` module WebWorkers wrapped with `Comlink.wrap`.
 * - Broadcasts the loaded HiRISE DEM grid once to all workers (`initDem`) so tile
 *   requests only send lightweight bounds + RTC origin metadata.
 * - Falls back transparently to main-thread execution in Node.js unit tests or if
 *   module WebWorkers fail to initialize.
 */

import * as Comlink from "../../node_modules/comlink/dist/esm/comlink.mjs";
import { makeLocalTangentOrigin } from "./Geodesy.js";
import { buildMarsTerrainTilePayload } from "./TerrainMeshBuilder.js";

function makeAbortError() {
  const err = new Error("Terrain tile build aborted");
  err.name = "AbortError";
  return err;
}

export class TerrainWorkerPool {
  /**
   * @param {object} [options]
   * @param {number} [options.maxWorkers=4]
   * @param {number} [options.workerCount]
   * @param {string|URL} [options.workerUrl]
   * @param {boolean} [options.forceMainThread=false]
   * @param {boolean} [options.forceFallback=false]
   */
  constructor({
    maxWorkers = 4,
    workerCount = null,
    workerUrl = null,
    forceMainThread = false,
    forceFallback = false,
  } = {}) {
    const hw =
      typeof navigator !== "undefined" && Number.isFinite(navigator.hardwareConcurrency)
        ? navigator.hardwareConcurrency
        : 2;
    this.workerCount = Math.max(1, Math.min(workerCount || maxWorkers, hw));
    this.workerUrl = workerUrl || new URL("./terrain.worker.js", import.meta.url);
    this.forceFallback = Boolean(forceMainThread || forceFallback) || typeof Worker === "undefined";

    /** @type {Array<{ worker: Worker, api: any, busy: boolean }>} */
    this.workers = [];
    /** @type {Array<{ run: (slot: any) => void, reject: (err: Error) => void, priority: number, signal?: AbortSignal }>} */
    this.queue = [];
    this.demSampler = null;
    this.rtcOrigin = null;
    this.rtcOriginSpec = null;
    this._disposed = false;

    if (!this.forceFallback) {
      this._spawnWorkers();
    }
  }

  _spawnWorkers() {
    for (let i = 0; i < this.workerCount; i++) {
      try {
        const w = new Worker(this.workerUrl, { type: "module" });
        const api = Comlink.wrap(w);
        const slot = { worker: w, api, busy: false };
        this.workers.push(slot);
      } catch (_err) {
        this.forceFallback = true;
        this._terminateWorkers();
        break;
      }
    }
  }

  _terminateWorkers() {
    for (const slot of this.workers) {
      try {
        slot.api?.[Comlink.releaseProxy]?.();
        slot.worker.terminate();
      } catch (_e) {
        // ignore termination errors
      }
    }
    this.workers.length = 0;
  }

  /**
   * Initialize or update the shared DEM grid across all workers and the main-thread fallback.
   *
   * @param {import('./MarsDemSampler.js').MarsDemSampler} demSampler
   * @param {{ lonDeg: number, latDeg: number, elevM: number }} [rtcOriginSpec]
   */
  async initDem(demSampler, rtcOriginSpec = null) {
    this.demSampler = demSampler;
    this.rtcOriginSpec = rtcOriginSpec;
    if (rtcOriginSpec && Number.isFinite(rtcOriginSpec.lonDeg) && Number.isFinite(rtcOriginSpec.latDeg)) {
      this.rtcOrigin = makeLocalTangentOrigin(
        rtcOriginSpec.lonDeg,
        rtcOriginSpec.latDeg,
        rtcOriginSpec.elevM ?? 0
      );
    }

    if (this.forceFallback || this.workers.length === 0) {
      return;
    }

    const serialized = typeof demSampler?.serialize === "function" ? demSampler.serialize() : null;
    if (!serialized) return;

    await Promise.all(
      this.workers.map(async (slot) => {
        const heightsCopy = new Float32Array(serialized.heights);
        try {
          await slot.api.initDem(
            Comlink.transfer(
              {
                metadata: serialized.metadata,
                heights: heightsCopy,
                rtcOriginSpec,
              },
              [heightsCopy.buffer]
            )
          );
        } catch (_err) {
          this.forceFallback = true;
        }
      })
    );
  }

  /**
   * Build a terrain tile mesh + analytical normal map off the main thread via Comlink RPC.
   */
  buildTile(params, { priority = 0, signal } = {}) {
    if (this._disposed) {
      return Promise.reject(new Error("TerrainWorkerPool is disposed"));
    }
    if (signal?.aborted) {
      return Promise.reject(makeAbortError());
    }

    if (this.forceFallback || this.workers.length === 0) {
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(makeAbortError());
        if (signal) {
          signal.addEventListener("abort", onAbort, { once: true });
        }
        queueMicrotask(() => {
          if (signal) {
            signal.removeEventListener("abort", onAbort);
          }
          if (signal?.aborted || this._disposed) {
            reject(makeAbortError());
            return;
          }
          try {
            const payload = buildMarsTerrainTilePayload({
              demSampler: params.demSampler || this.demSampler,
              rtcOrigin: params.rtcOrigin || this.rtcOrigin,
              ...params,
            });
            resolve({ tileKey: params.tileKey, ...payload });
          } catch (err) {
            reject(err);
          }
        });
      });
    }

    return new Promise((resolve, reject) => {
      const task = {
        priority,
        signal,
        reject,
        run: async (slot) => {
          if (signal?.aborted) {
            slot.busy = false;
            this._pump();
            reject(makeAbortError());
            return;
          }
          let aborted = false;
          const onAbort = () => {
            aborted = true;
            reject(makeAbortError());
          };
          if (signal) {
            signal.addEventListener("abort", onAbort, { once: true });
          }
          try {
            const payload = await slot.api.buildTile(params);
            if (!aborted) resolve(payload);
          } catch (err) {
            if (!aborted) {
              try {
                const fallbackPayload = buildMarsTerrainTilePayload({
                  demSampler: params.demSampler || this.demSampler,
                  rtcOrigin: params.rtcOrigin || this.rtcOrigin,
                  ...params,
                });
                resolve({ tileKey: params.tileKey, ...fallbackPayload });
              } catch (fallbackErr) {
                reject(fallbackErr || err);
              }
            }
          } finally {
            if (signal) {
              signal.removeEventListener("abort", onAbort);
            }
            slot.busy = false;
            this._pump();
          }
        },
      };

      if (signal) {
        const onQueuedAbort = () => {
          const qIdx = this.queue.indexOf(task);
          if (qIdx !== -1) {
            this.queue.splice(qIdx, 1);
            reject(makeAbortError());
          }
        };
        signal.addEventListener("abort", onQueuedAbort, { once: true });
      }

      this.queue.push(task);
      this.queue.sort((a, b) => a.priority - b.priority);
      this._pump();
    });
  }

  _pump() {
    while (this.queue.length > 0) {
      const idleSlot = this.workers.find((s) => !s.busy);
      if (!idleSlot) break;

      const task = this.queue.shift();
      if (!task) break;
      if (task.signal?.aborted) {
        task.reject(makeAbortError());
        continue;
      }

      idleSlot.busy = true;
      task.run(idleSlot);
    }
  }

  stats() {
    return {
      workerCount: this.workers.length,
      busyWorkers: this.workers.filter((w) => w.busy).length,
      queuedJobs: this.queue.length,
      usingFallback: this.forceFallback || this.workers.length === 0,
    };
  }

  dispose() {
    this._disposed = true;
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      task?.reject(makeAbortError());
    }
    this._terminateWorkers();
  }
}
