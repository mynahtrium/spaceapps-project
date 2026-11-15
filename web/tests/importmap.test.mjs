// The browser loads `web/` as native ES modules: a bare specifier (`import x from "pkg"`) only
// resolves through the import map in `web/index.html`. Node resolves the same specifier from
// `node_modules`, so a missing map entry passes every other test and still breaks the page.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["vendor", "tests", "node_modules", "assets"]);

// Optional enhancements loaded with `import(...).catch(...)`; the code falls back when they
// are absent, and neither package ships a browser-loadable ES build.
const OPTIONAL_DYNAMIC = new Set(["dualsense-ts", "@nkzw/joymap"]);

function readImportMap() {
  const html = fs.readFileSync(path.join(WEB_DIR, "index.html"), "utf8");
  const match = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(match, "web/index.html has an import map");
  return JSON.parse(match[1]).imports;
}

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.m?js$/.test(entry.name)) out.push(full);
  }
  return out;
}

function resolveThroughMap(imports, spec) {
  if (imports[spec]) return imports[spec];
  const prefix = Object.keys(imports)
    .filter((key) => key.endsWith("/") && spec.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? imports[prefix] + spec.slice(prefix.length) : null;
}

const IMPORT_RE =
  /(?:^|[\s;])(?:import|export)\s+(?:[^'"()]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

test("every bare import in web/ resolves through the index.html import map", () => {
  const imports = readImportMap();
  const problems = [];
  for (const file of sourceFiles(WEB_DIR)) {
    const rel = path.relative(WEB_DIR, file);
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] || m[2];
      if (/^(\.|\/|https?:|data:|blob:)/.test(spec)) continue;
      if (m[2] && OPTIONAL_DYNAMIC.has(spec)) continue;
      const target = resolveThroughMap(imports, spec);
      if (!target) problems.push(`${rel}: "${spec}" is not in the import map`);
      else if (!fs.existsSync(path.resolve(WEB_DIR, target))) {
        problems.push(`${rel}: "${spec}" maps to a missing file (${target})`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("every import map target exists on disk", () => {
  const imports = readImportMap();
  const missing = Object.entries(imports)
    .filter(([, target]) => !fs.existsSync(path.resolve(WEB_DIR, target)))
    .map(([spec, target]) => `${spec} -> ${target}`);
  assert.deepEqual(missing, []);
});
