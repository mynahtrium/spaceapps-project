/**
 * Browser ES-module entry for `seedrandom`.
 *
 * The npm package ships CommonJS / UMD only, which a browser cannot `import` by name.
 * `web/index.html` maps the bare `seedrandom` specifier here; loading the UMD build as a
 * side effect installs `Math.seedrandom`, which is re-exported as the default export.
 * Node (tests) resolves `seedrandom` to the package itself and never loads this file.
 *
 * Called without `this`, the factory returns a new generator and leaves `Math.random` untouched.
 */
import "../../node_modules/seedrandom/seedrandom.min.js";

const seedrandom = Math.seedrandom;

export default seedrandom;
