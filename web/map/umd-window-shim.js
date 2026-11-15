/**
 * Lets a UMD script that only knows how to attach itself to `window` load inside a Web Worker.
 *
 * `geographiclib-geodesic.min.js` ends with `window.geodesic = geo`, which throws
 * "window is not defined" in `terrain.worker.js`. Import this module immediately before such a
 * script: in a worker it aliases `window` to the worker global for the duration of the import.
 * The importer removes the alias again (see `Geodesy.js`) so worker code that tests
 * `typeof window` still sees a worker. Does nothing on the main thread or in Node.
 */
export const shimmedWindow = typeof window === "undefined" && typeof self !== "undefined";

if (shimmedWindow) self.window = self;
