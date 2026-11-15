import test from "node:test";
import assert from "node:assert/strict";

import {
  createMultiplayerHub,
  sanitizeRoomId,
} from "../../scripts/mp-hub.mjs";
import { startServer } from "../../scripts/server.mjs";
import {
  buildInviteUrl,
  lerpAngleRad,
  MultiplayerClient,
  sanitizeCallsign,
  sanitizeRoomCode,
} from "../shared/multiplayer.js";

test("Multiplayer helper functions sanitize rooms, wrap yaw angles, and build invite URLs", () => {
  assert.equal(sanitizeRoomCode("  gale 02! "), "GALE02");
  assert.equal(sanitizeRoomCode(""), "GALE-01");
  assert.equal(sanitizeRoomId("  gale 02! "), "GALE02");
  assert.equal(sanitizeCallsign("  ", "AST-9"), "AST-9");
  assert.equal(sanitizeCallsign("Atlas", "AST-9"), "Atlas");

  // Shortest-path angle lerp across +/- PI seam
  const wrapped = lerpAngleRad(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
  assert.ok(Math.abs(Math.abs(wrapped) - Math.PI) < 0.05, `expected near PI, got ${wrapped}`);

  const invite = buildInviteUrl("http://localhost:8765/web/?demo=1", "EVA 42");
  assert.equal(invite, "http://localhost:8765/web/?demo=1&room=EVA42");
});

test("createMultiplayerHub enforces room and pin caps over ws WebSocketServer", async () => {
  const hub = createMultiplayerHub({ maxPeersPerRoom: 1, maxPinsPerRoom: 2 });
  assert.ok(hub.wss, "hub exposes underlying ws WebSocketServer instance");
  assert.deepEqual(hub.getStats(), { roomCount: 0, totalPeers: 0, rooms: [] });
});

test("Server /api/hw/info endpoint returns systeminformation hardware snapshot", async () => {
  const { server, port } = await startServer({ port: 0, host: "127.0.0.1" });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/hw/info`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.ok(json.totalMemGb > 0);
    assert.ok(json.cpuCores >= 1);
  } finally {
    server.close();
  }
});

test("Multiplayer server relays rooms, state, beacons, and chat over live WebSockets", async () => {
  const { server, port } = await startServer({ port: 0, host: "127.0.0.1" });
  try {
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws?room=MARS-TEST`);
    const q1 = [];
    const q2 = [];
    const waitFor = (queue, predicate, label) =>
      new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
          const idx = queue.findIndex(predicate);
          if (idx >= 0) return resolve(queue.splice(idx, 1)[0]);
          if (Date.now() - start > 3000) return reject(new Error(`Timeout waiting for ${label}`));
          setTimeout(check, 10);
        };
        check();
      });

    ws1.addEventListener("message", (ev) => q1.push(JSON.parse(ev.data)));
    await new Promise((r) => ws1.addEventListener("open", r, { once: true }));
    await waitFor(q1, (m) => m.type === "welcome", "ws1 welcome");

    ws1.send(JSON.stringify({ type: "hello", id: "p1", callsign: "AST-1", color: "#38bdf8", role: "eva" }));
    ws1.send(
      JSON.stringify({
        type: "ping",
        seq: 1,
        pin: { id: "pin-1", lon: 137.39, lat: -4.8, elevM: -3630, label: "Mudstone" },
      })
    );

    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws?room=MARS-TEST`);
    ws2.addEventListener("message", (ev) => q2.push(JSON.parse(ev.data)));
    await new Promise((r) => ws2.addEventListener("open", r, { once: true }));

    const w2 = await waitFor(q2, (m) => m.type === "welcome", "ws2 welcome");
    assert.equal(w2.peers.length, 1);
    assert.equal(w2.peers[0].callsign, "AST-1");
    assert.equal(w2.pins.length, 1);
    assert.equal(w2.pins[0].label, "Mudstone");

    ws2.send(JSON.stringify({ type: "hello", id: "p2", callsign: "AST-2", color: "#34d399", role: "planner" }));
    const joinMsg = await waitFor(q1, (m) => m.type === "peer-join", "ws1 peer-join");
    assert.equal(joinMsg.peer.callsign, "AST-2");

    ws1.send(JSON.stringify({ type: "state", seq: 2, state: { x: 12.5, y: 1.1, z: -8, lon: 137.391, lat: -4.801, yaw: 0.4 } }));
    const stMsg = await waitFor(q2, (m) => m.type === "state", "ws2 state");
    assert.equal(stMsg.callsign, "AST-1");
    assert.equal(stMsg.state.x, 12.5);

    ws2.send(JSON.stringify({ type: "chat", seq: 1, text: "Slope steep ahead" }));
    const chatMsg = await waitFor(q1, (m) => m.type === "chat", "ws1 chat");
    assert.equal(chatMsg.callsign, "AST-2");
    assert.equal(chatMsg.text, "Slope steep ahead");

    const statusRes = await fetch(`http://127.0.0.1:${port}/api/mp/status`);
    assert.equal(statusRes.status, 200);
    const statusJson = await statusRes.json();
    assert.equal(statusJson.ok, true);
    assert.equal(statusJson.ws, true);
    assert.equal(statusJson.totalPeers, 2);

    ws1.close();
    ws2.close();
    await new Promise((r) => setTimeout(r, 40));
  } finally {
    server.close();
  }
});

test("MultiplayerClient in demoSafe mode makes zero network calls and relays over BroadcastChannel", async () => {
  const channels = new Map();
  class MockBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      if (!channels.has(name)) channels.set(name, new Set());
      channels.get(name).add(this);
    }
    postMessage(data) {
      for (const ch of channels.get(this.name) || []) {
        if (ch !== this && ch.onmessage) ch.onmessage({ data: structuredClone(data) });
      }
    }
    close() {
      channels.get(this.name)?.delete(this);
    }
  }

  const origBc = globalThis.BroadcastChannel;
  const origFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.BroadcastChannel = MockBroadcastChannel;
  globalThis.fetch = async () => {
    fetchCalls++;
    throw new Error("Network must not be called in demoSafe mode");
  };

  try {
    const a = new MultiplayerClient({ id: "tab-a", callsign: "AST-A", room: "DEMO", demoSafe: true });
    const b = new MultiplayerClient({ id: "tab-b", callsign: "AST-B", room: "DEMO", demoSafe: true });

    let gotState = null;
    b.on("peerstate", (p) => {
      gotState = p;
    });

    await a.connect();
    await b.connect();
    a.sendState({ x: 3, y: 0, z: 4, lon: 137.39, lat: -4.8, yaw: 1.0 });

    assert.equal(fetchCalls, 0);
    assert.equal(a.getStatusSummary().transport, "LOCAL TABS (DEMO-SAFE)");
    assert.equal(gotState?.callsign, "AST-A");
    assert.equal(gotState?.state?.x, 3);

    a.disconnect();
    b.disconnect();
  } finally {
    globalThis.BroadcastChannel = origBc;
    globalThis.fetch = origFetch;
  }
});

test("Static server hides dotfiles (.env, .git) and survives malformed %-escapes", async () => {
  const { server, port } = await startServer({ port: 0, host: "127.0.0.1" });
  try {
    const status = async (p) => (await fetch(`http://127.0.0.1:${port}${p}`)).status;
    assert.equal(await status("/web/"), 200);
    assert.equal(await status("/.env"), 404);
    assert.equal(await status("/.env.example"), 404);
    assert.equal(await status("/.git/config"), 404);
    assert.equal(await status("/web/%2e%2e/.git/HEAD"), 404);
    assert.equal(await status("/%E0%A4%A"), 400);
    assert.equal(await status("/web/"), 200, "server still up after a malformed request");
  } finally {
    server.close();
  }
});
