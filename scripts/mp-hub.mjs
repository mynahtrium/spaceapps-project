/**
 * Zero-dependency RFC 6455 WebSocket + Room Relay Hub (`scripts/mp-hub.mjs`).
 * Manages Martian Mappers EVA multiplayer rooms, peer presence, kinematic states,
 * shared science beacon pings, route sync, and EVA radio comms.
 */

import crypto from "node:crypto";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_FRAME_BYTES = 256 * 1024;

export function computeWebSocketAccept(secKey) {
  return crypto
    .createHash("sha1")
    .update(String(secKey).trim() + WS_GUID, "utf8")
    .digest("base64");
}

export function encodeWsFrame(opcode, payload = Buffer.alloc(0)) {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8");
  const len = buf.length;
  let header;
  if (len < 126) {
    header = Buffer.allocUnsafe(2);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, buf]);
}

export function decodeWsFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let payloadLen = b1 & 0x7f;
    let cursor = offset + 2;

    if (payloadLen === 126) {
      if (cursor + 2 > buffer.length) break;
      payloadLen = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (payloadLen === 127) {
      if (cursor + 8 > buffer.length) break;
      const bigLen = buffer.readBigUInt64BE(cursor);
      if (bigLen > BigInt(MAX_FRAME_BYTES)) {
        return { frames, remaining: Buffer.alloc(0), error: "Frame too large" };
      }
      payloadLen = Number(bigLen);
      cursor += 8;
    }

    if (payloadLen > MAX_FRAME_BYTES) {
      return { frames, remaining: Buffer.alloc(0), error: "Frame too large" };
    }

    const maskBytes = masked ? 4 : 0;
    if (cursor + maskBytes + payloadLen > buffer.length) break;

    let payload;
    if (masked) {
      const m0 = buffer[cursor];
      const m1 = buffer[cursor + 1];
      const m2 = buffer[cursor + 2];
      const m3 = buffer[cursor + 3];
      cursor += 4;
      payload = Buffer.allocUnsafe(payloadLen);
      const key = [m0, m1, m2, m3];
      for (let i = 0; i < payloadLen; i++) {
        payload[i] = buffer[cursor + i] ^ key[i & 3];
      }
    } else {
      payload = Buffer.from(buffer.subarray(cursor, cursor + payloadLen));
    }

    frames.push({ fin, opcode, payload });
    offset = cursor + payloadLen;
  }

  return { frames, remaining: buffer.subarray(offset), error: null };
}

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
    if (!peer || !peer.socket || peer.socket.destroyed || !peer.socket.writable) return;
    try {
      peer.socket.write(encodeWsFrame(0x1, JSON.stringify(msg)));
    } catch {
      /* ignore broken pipe; close event cleans up */
    }
  }

  function broadcast(room, msg, excludeId = null) {
    const encoded = encodeWsFrame(0x1, JSON.stringify(msg));
    for (const [pid, peer] of room.peers.entries()) {
      if (pid === excludeId) continue;
      if (!peer.socket || peer.socket.destroyed || !peer.socket.writable) continue;
      try {
        peer.socket.write(encoded);
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

  function handleUpgrade(req, socket, head) {
    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    const reqUrl = new URL(req.url || "/ws", "http://localhost");
    const roomId = sanitizeRoomId(reqUrl.searchParams.get("room"));
    const room = getOrCreateRoom(roomId);
    if (room.peers.size >= maxPeersPerRoom) {
      socket.write("HTTP/1.1 503 Room Full\r\n\r\n");
      socket.destroy();
      return;
    }

    const accept = computeWebSocketAccept(key);
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "\r\n",
      ].join("\r\n")
    );
    socket.setNoDelay?.(true);

    const peer = {
      id: crypto.randomUUID(),
      callsign: "AST-" + String(Math.floor(100 + Math.random() * 900)),
      color: "#38bdf8",
      role: "eva",
      socket,
      lastState: null,
      lastSeenAt: Date.now(),
    };
    room.peers.set(peer.id, peer);

    // Send initial room roster + existing pings immediately
    sendJson(peer, {
      type: "welcome",
      room: room.id,
      assignedId: peer.id,
      peers: [...room.peers.values()].filter((p) => p.id !== peer.id).map(publicPeerInfo),
      pins: room.pins,
      routeSync: room.routeSync,
    });

    let rxBuf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
    let fragChunks = [];
    let fragOpcode = 0;

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

    function processChunk(chunk) {
      rxBuf = rxBuf.length ? Buffer.concat([rxBuf, chunk]) : chunk;
      const { frames, remaining, error } = decodeWsFrames(rxBuf);
      rxBuf = remaining;
      if (error) {
        socket.destroy();
        return;
      }
      for (const f of frames) {
        if (f.opcode === 0x8) {
          try {
            socket.write(encodeWsFrame(0x8));
          } catch {
            /* ignore */
          }
          socket.end();
          return;
        }
        if (f.opcode === 0x9) {
          try {
            socket.write(encodeWsFrame(0xA, f.payload));
          } catch {
            /* ignore */
          }
          continue;
        }
        if (f.opcode === 0xA) continue;

        if (f.opcode === 0x1) {
          if (f.fin) {
            handleMessageText(f.payload.toString("utf8"));
          } else {
            fragOpcode = 0x1;
            fragChunks = [f.payload];
          }
        } else if (f.opcode === 0x0 && fragOpcode === 0x1) {
          fragChunks.push(f.payload);
          if (f.fin) {
            const full = Buffer.concat(fragChunks);
            fragChunks = [];
            fragOpcode = 0;
            handleMessageText(full.toString("utf8"));
          }
        }
      }
    }

    if (rxBuf.length > 0) processChunk(Buffer.alloc(0));
    socket.on("data", processChunk);
    socket.on("close", () => removePeer(room, peer.id));
    socket.on("error", () => removePeer(room, peer.id));
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

  return { handleUpgrade, getStats };
}
