/**
 * Martian Mappers Static + Multiplayer WebSocket Server (`scripts/server.mjs`).
 *
 * Serves the repository root (`/web/`, `/data/`, `/docs/`, `/node_modules/`) via `sirv`,
 * provides hardware telemetry on `/api/hw/info` via `systeminformation`,
 * and hosts WebSocket EVA multiplayer rooms on `/ws?room=<code>`.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sirv from "sirv";
import si from "systeminformation";

import { createMultiplayerHub } from "./mp-hub.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "..");

let cachedHwInfo = null;
let pendingHwPromise = null;

async function getSystemHardwareInfo() {
  if (cachedHwInfo) return cachedHwInfo;
  if (!pendingHwPromise) {
    pendingHwPromise = Promise.all([si.mem(), si.cpu()])
      .then(([mem, cpu]) => {
        cachedHwInfo = {
          ok: true,
          totalMemGb: +(Number(mem?.total || 0) / 1073741824).toFixed(1),
          freeMemGb: +(Number(mem?.available || mem?.free || 0) / 1073741824).toFixed(1),
          cpuModel: `${cpu?.manufacturer || ""} ${cpu?.brand || ""}`.trim(),
          cpuCores: Number(cpu?.cores) || 4,
        };
        return cachedHwInfo;
      })
      .finally(() => {
        pendingHwPromise = null;
      });
  }
  return pendingHwPromise;
}

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
  const hub = createMultiplayerHub();
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

    if (pathname === "/api/mp/status") {
      const hostHdr = req.headers.host || "localhost:8000";
      const portMatch = hostHdr.match(/:(\d+)$/);
      const port = portMatch ? portMatch[1] : "8000";
      const lanUrls = listLanIpv4Addresses().map((ip) => `http://${ip}:${port}/web/`);
      const body = JSON.stringify({
        ok: true,
        ws: true,
        ...hub.getStats(),
        lanUrls,
      });
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(body);
      return;
    }

    if (pathname === "/api/hw/info") {
      try {
        const hwInfo = await getSystemHardwareInfo();
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(hwInfo));
      } catch {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false }));
      }
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

  server.on("upgrade", (req, socket, head) => {
    const reqUrl = new URL(req.url || "/", "http://localhost");
    if (reqUrl.pathname === "/ws") {
      hub.handleUpgrade(req, socket, head);
    } else {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
    }
  });

  return { server, hub };
}

export async function startServer({ port = 8000, host = "0.0.0.0", rootDir = DEFAULT_ROOT } = {}) {
  const { server, hub } = createServerApp({ rootDir });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  return { server, hub, port: actualPort, host };
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
  console.log(`Martian Mappers Multiplayer + Static server listening on http://${host}:${boundPort}/web/`);
  console.log(`Local Demo-Safe : http://localhost:${boundPort}/web/?demo=1`);
  console.log(`Local Normal    : http://localhost:${boundPort}/web/`);
  for (const ip of listLanIpv4Addresses()) {
    console.log(`LAN Multiplayer : http://${ip}:${boundPort}/web/?room=GALE-01`);
  }
}
