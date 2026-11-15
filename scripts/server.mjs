/**
 * Martian Mappers static server (`scripts/server.mjs`).
 *
 * Serves the repository root (`/web/`, `/data/`, `/docs/`, `/node_modules/`) via `sirv`.
 * Dotfiles are never served. No APIs, no WebSockets.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sirv from "sirv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "..");

export function listLanIpv4Addresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const entries of Object.values(ifaces)) {
    if (!entries) continue;
    for (const info of entries) {
      if (info.family === "IPv4" && !info.internal) {
        out.push(info.address);
      }
    }
  }
  return out;
}

export function createServerApp({ rootDir = DEFAULT_ROOT } = {}) {
  const safeRoot = path.resolve(rootDir);
  const assets = sirv(safeRoot, {
    dev: true,
    dotfiles: false,
    etag: true,
  });

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || "/", "http://localhost");
    let pathname;
    try {
      pathname = decodeURIComponent(reqUrl.pathname);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Bad Request");
      return;
    }

    if (pathname === "/" || pathname === "/web") {
      res.writeHead(302, { Location: `/web/${reqUrl.search || ""}` });
      res.end();
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "text/plain" });
      res.end("Method Not Allowed");
      return;
    }

    if (/(?:^|[\\/])\./.test(pathname)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    assets(req, res, () => {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    });
  });

  return { server };
}

export async function startServer({ port = 8000, host = "0.0.0.0", rootDir = DEFAULT_ROOT } = {}) {
  const { server } = createServerApp({ rootDir });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  return { server, port: actualPort, host };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(DEFAULT_ROOT, "package.json"), "utf8"));
    const deps = Object.keys(pkg.dependencies || {});
    const missing = deps.some((d) => !fs.existsSync(path.join(DEFAULT_ROOT, "node_modules", d)));
    if (missing) {
      console.log("Installing missing npm packages in node_modules...");
      execSync("npm install --no-audit --no-fund", { cwd: DEFAULT_ROOT, stdio: "inherit" });
    }
  } catch {
    /* ignore auto-install check failure */
  }
  const port = Number(process.env.PORT || process.argv[2] || 8000);
  const host = process.env.HOST || "0.0.0.0";
  const { port: boundPort } = await startServer({ port, host });
  console.log(`Martian Mappers server listening on http://${host}:${boundPort}/web/`);
  console.log(`Offline data    : http://localhost:${boundPort}/web/?demo=1`);
  console.log(`Live data       : http://localhost:${boundPort}/web/`);
  for (const ip of listLanIpv4Addresses()) console.log(`On this network : http://${ip}:${boundPort}/web/`);
}
