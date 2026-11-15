/**
 * Martian Mappers Static + Multiplayer WebSocket Server (`scripts/server.mjs`).
 *
 * Serves the repository root (`/web/`, `/data/`, `/docs/`) with zero npm dependencies
 * and hosts RFC 6455 WebSocket EVA multiplayer rooms on `/ws?room=<code>`.
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createMultiplayerHub } from "./mp-hub.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "..");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".stl": "model/stl",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

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

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || "/", "http://localhost");
    let pathname;
    try {
      pathname = decodeURIComponent(reqUrl.pathname);
    } catch {
      // A malformed %-escape must not throw out of the handler and kill the server.
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Bad Request");
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
      const cpus = os.cpus() || [];
      const body = JSON.stringify({
        ok: true,
        totalMemGb: +(os.totalmem() / 1073741824).toFixed(1),
        freeMemGb: +(os.freemem() / 1073741824).toFixed(1),
        cpuModel: String(cpus[0]?.model || "").trim(),
        cpuCores: cpus.length || 4,
      });
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(body);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "text/plain" });
      res.end("Method Not Allowed");
      return;
    }

    const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    // The server listens on the LAN. Never serve dotfiles or dot-directories
    // (.env holds NASA_API_KEY; .git holds the private repository).
    if (rel.split(/[\\/]/).some((seg) => seg.startsWith("."))) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }
    let filePath = path.resolve(safeRoot, rel);
    if (filePath !== safeRoot && !filePath.startsWith(safeRoot + path.sep)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
      return;
    }

    fs.stat(filePath, (err, st) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }
      if (st.isDirectory()) {
        if (!pathname.endsWith("/")) {
          res.writeHead(301, { Location: pathname + "/" + reqUrl.search });
          res.end();
          return;
        }
        filePath = path.join(filePath, "index.html");
      }

      fs.stat(filePath, (err2, st2) => {
        if (err2 || !st2.isFile()) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const mime = MIME_TYPES[ext] || "application/octet-stream";
        res.writeHead(200, {
          "Content-Type": mime,
          "Content-Length": st2.size,
          "Cache-Control": "no-cache",
        });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        const stream = fs.createReadStream(filePath);
        stream.on("error", () => {
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
        stream.pipe(res);
      });
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
  const port = Number(process.env.PORT || 8000);
  const host = process.env.HOST || "0.0.0.0";
  const { port: boundPort } = await startServer({ port, host });
  console.log(`Martian Mappers Multiplayer + Static server listening on http://${host}:${boundPort}/web/`);
  console.log(`Local Demo-Safe : http://localhost:${boundPort}/web/?demo=1`);
  console.log(`Local Normal    : http://localhost:${boundPort}/web/`);
  for (const ip of listLanIpv4Addresses()) {
    console.log(`LAN Multiplayer : http://${ip}:${boundPort}/web/?room=GALE-01`);
  }
}
