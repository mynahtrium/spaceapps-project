/**
 * WebSocket + Room Relay Hub (`scripts/mp-hub.mjs`).
 * Powered by `ws` (`WebSocketServer` in `{ noServer: true }` mode).
 * Manages Martian Mappers EVA multiplayer rooms, peer presence, kinematic states,
 * shared science beacon pings, route sync, and EVA radio comms.
 */

import crypto from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

const MAX_FRAME_BYTES = 256 * 1024;

export function sanitizeRoomId(raw) {
  const clean = String(raw || "GALE-01")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 24);
  return clean || "GALE-01";
}

export function createMultiplayerHub({ maxPeersPerRoom = 16, maxPinsPerRoom = 24 } = {}) {
  const rooms = new Map();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });

  function getOrCreateRoom(roomId) {
    const key = sanitizeRoomId(roomId);
    let room = rooms.get(key);
    if (!room) {
      room = {
        id: key,
        peers: new Map(),
        pins: [],
        routeSync: null,
      };
      rooms.set(key, room);
    }
    return room;
  }

  function sendJson(peer, msg) {
    if (!peer?.ws || peer.ws.readyState !== WebSocket.OPEN) return;
    try {
      peer.ws.send(JSON.stringify(msg));
    } catch {
      /* ignore broken pipe; close event cleans up */
    }
  }

  function broadcast(room, msg, excludeId = null) {
    const payload = JSON.stringify(msg);
    for (const [pid, peer] of room.peers.entries()) {
      if (pid === excludeId) continue;
      if (!peer.ws || peer.ws.readyState !== WebSocket.OPEN) continue;
      try {
        peer.ws.send(payload);
      } catch {
        /* ignore broken pipe */
      }
    }
  }

  function publicPeerInfo(peer) {
    return {
      id: peer.id,
      callsign: peer.callsign,
      color: peer.color,
      role: peer.role,
      state: peer.lastState,
    };
  }

  function removePeer(room, peerId) {
    const peer = room.peers.get(peerId);
    if (!peer) return;
    room.peers.delete(peerId);
    broadcast(room, { type: "peer-leave", id: peer.id, callsign: peer.callsign });
    if (room.peers.size === 0) {
      rooms.delete(room.id);
    }
  }

  function attachPeer(ws, room) {
    const peer = {
      id: crypto.randomUUID(),
      callsign: "AST-" + String(Math.floor(100 + Math.random() * 900)),
      color: "#38bdf8",
      role: "eva",
      ws,
      lastState: null,
      lastSeenAt: Date.now(),
    };
    room.peers.set(peer.id, peer);

    sendJson(peer, {
      type: "welcome",
      room: room.id,
      assignedId: peer.id,
      peers: [...room.peers.values()].filter((p) => p.id !== peer.id).map(publicPeerInfo),
      pins: room.pins,
      routeSync: room.routeSync,
    });

    function handleMessageText(text) {
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      peer.lastSeenAt = Date.now();

      switch (msg.type) {
        case "hello": {
          if (typeof msg.id === "string" && msg.id.length > 0 && msg.id.length <= 64 && !room.peers.has(msg.id)) {
            room.peers.delete(peer.id);
            peer.id = msg.id;
            room.peers.set(peer.id, peer);
          }
          if (typeof msg.callsign === "string" && msg.callsign.trim()) {
            peer.callsign = msg.callsign.trim().slice(0, 20);
          }
          if (typeof msg.color === "string" && /^#[0-9a-fA-F]{6}$/.test(msg.color)) {
            peer.color = msg.color;
          }
          if (typeof msg.role === "string" && msg.role.trim()) {
            peer.role = msg.role.trim().slice(0, 16);
          }
          if (msg.state && typeof msg.state === "object") {
            peer.lastState = msg.state;
          }
          broadcast(room, { type: "peer-join", peer: publicPeerInfo(peer) }, peer.id);
          break;
        }
        case "state": {
          if (!msg.state || typeof msg.state !== "object") return;
          peer.lastState = msg.state;
          broadcast(
            room,
            {
              type: "state",
              id: peer.id,
              callsign: peer.callsign,
              color: peer.color,
              role: peer.role,
              seq: msg.seq,
              state: msg.state,
            },
            peer.id
          );
          break;
        }
        case "ping": {
          const pin = msg.pin;
          if (!pin || typeof pin !== "object") return;
          if (!Number.isFinite(Number(pin.lon)) || !Number.isFinite(Number(pin.lat))) return;
          const cleanPin = {
            id: typeof pin.id === "string" ? pin.id.slice(0, 48) : crypto.randomUUID(),
            lon: Number(pin.lon),
            lat: Number(pin.lat),
            elevM: Number.isFinite(Number(pin.elevM)) ? Number(pin.elevM) : null,
            label: String(pin.label || "Science Beacon").slice(0, 48),
            by: peer.callsign,
            color: peer.color,
            ts: Date.now(),
          };
          if (!room.pins.some((p) => p.id === cleanPin.id)) {
            room.pins.push(cleanPin);
            if (room.pins.length > maxPinsPerRoom) room.pins.shift();
          }
          broadcast(room, { type: "ping", seq: msg.seq, pin: cleanPin }, peer.id);
          break;
        }
        case "clear-pings": {
          room.pins = [];
          broadcast(room, { type: "clear-pings", seq: msg.seq, by: peer.callsign }, peer.id);
          break;
        }
        case "chat": {
          const clean = String(msg.text || "").trim().slice(0, 160);
          if (!clean) return;
          broadcast(
            room,
            {
              type: "chat",
              id: peer.id,
              seq: msg.seq,
              callsign: peer.callsign,
              color: peer.color,
              text: clean,
              ts: Date.now(),
            },
            peer.id
          );
          break;
        }
        case "route-sync": {
          const alongM = Number(msg.alongM);
          if (!Number.isFinite(alongM)) return;
          room.routeSync = {
            alongM,
            playing: Boolean(msg.playing),
            by: peer.callsign,
            ts: Date.now(),
          };
          broadcast(
            room,
            {
              type: "route-sync",
              seq: msg.seq,
              ...room.routeSync,
            },
            peer.id
          );
          break;
        }
        default:
          break;
      }
    }

    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      handleMessageText(typeof data === "string" ? data : data.toString("utf8"));
    });
    ws.on("close", () => removePeer(room, peer.id));
    ws.on("error", () => removePeer(room, peer.id));
  }

  function handleUpgrade(req, socket, head) {
    const reqUrl = new URL(req.url || "/ws", "http://localhost");
    const roomId = sanitizeRoomId(reqUrl.searchParams.get("room"));
    const room = getOrCreateRoom(roomId);
    if (room.peers.size >= maxPeersPerRoom) {
      socket.write("HTTP/1.1 503 Room Full\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
      attachPeer(ws, room);
    });
  }

  function getStats() {
    let totalPeers = 0;
    const summary = [];
    for (const room of rooms.values()) {
      totalPeers += room.peers.size;
      summary.push({ id: room.id, peers: room.peers.size, pins: room.pins.length });
    }
    return { roomCount: rooms.size, totalPeers, rooms: summary };
  }

  return { handleUpgrade, getStats, wss };
}
