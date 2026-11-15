/**
 * Browser ES-module entry for `tone`.
 *
 * Tone's ES build depends on `standardized-audio-context`, whose module files use
 * extension-less imports that a browser cannot load without a bundler. `web/index.html`
 * maps the bare `tone` specifier here instead; loading Tone's single-file UMD build as a
 * side effect installs `globalThis.Tone`, which is re-exported as the default export.
 * Loaded on demand by `audioEngine.js`, from local `node_modules` (no network in `?demo=1`).
 */
import "../../node_modules/tone/build/Tone.js";

const Tone = globalThis.Tone;

export default Tone;
