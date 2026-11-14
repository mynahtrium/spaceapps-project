/**
 * Dual-transport EVA Multiplayer Client (`web/shared/multiplayer.js`).
 *
 * Supports two seamless zero-dependency transports:
 * 1. `BroadcastChannel` (`mm-eva-mp:<room>`): same-browser multi-tab multiplayer, works even
 *    with a static `python3 -m http.server` AND in `?demo=1` with zero network calls.
 * 2. Same-origin / LAN WebSocket (`/ws?room=<room>`): cross-device multiplayer when served
 *    via `node scripts/server.mjs` (or `./scripts/start-app.sh` / `start.bat`). Automatically
 *    skipped in `?demo=1` unless the user explicitly enables LAN relay.
 */

const SUIT_PALETTE = [
  "#38bdf8",
  "#34d399",
  "#f59e0b",
  "#f472b6",
  "#a78bfa",
  "#fb7185",
  "#2dd4bf",
  "#facc15",
];

export function sanitizeRoomCode(raw) {
  const clean = String(raw || "GALE-01")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 24);
  return clean || "GALE-01";
}

export function sanitizeCallsign(raw, fallback = "AST-1") {
  const clean = String(raw || "")
    .trim()
    .slice(0, 20);
  return clean || fallback;
}

export function colorForPeerId(id) {
  const s = String(id || "ast");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return SUIT_PALETTE[(h >>> 0) % SUIT_PALETTE.length];
}

export function lerpAngleRad(a, b, t) {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export function buildInviteUrl(locationHref, roomId, forceOrigin = null) {
  try {
    const base = forceOrigin ? new URL("/web/", forceOrigin) : new URL(locationHref);
    base.searchParams.set("room", sanitizeRoomCode(roomId));
    return base.toString();
  } catch {
    return `?room=${encodeURIComponent(sanitizeRoomCode(roomId))}`;
  }
}

function makePeerUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "ast-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
}

export class MultiplayerClient {
  constructor(opts = {}) {
    const urlParams =
      typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
    const storedCallsign = (() => {
      try {
        return typeof localStorage !== "undefined" ? localStorage.getItem("mm-callsign") : null;
      } catch {
        return null;
      }
    })();

    this.id = opts.id || makePeerUuid();
    this.callsign = sanitizeCallsign(
      opts.callsign || urlParams.get("callsign") || storedCallsign,
      "AST-" + String(Math.floor(100 + Math.random() * 900))
    );
    this.color = opts.color || colorForPeerId(this.id);
    this.room = sanitizeRoomCode(opts.room || urlParams.get("room") || "GALE-01");
    this.demoSafe = Boolean(opts.demoSafe);
    this.role = opts.role || "eva";

    this.lanEnabled = !this.demoSafe && opts.lanEnabled !== false;
    this.wsAvailable = false;
    this.wsConnected = false;
    this.bcConnected = false;
    this.lanUrls = [];

    this._seq = 0;
    this._bc = null;
    this._ws = null;
    this._reconnectTimer = null;
    this._helloTimer = null;
    this._pruneTimer = null;
    this._reconnectAttempt = 0;
    this._disposed = false;

    this.peers = new Map();
    this.pins = [];
    this.lastState = null;

    this._listeners = new Map();

    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => this.disconnect(false));
    }
  }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this._listeners.get(event)?.delete(fn);
  }

  _emit(event, detail) {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(detail);
      } catch (err) {
        console.warn(`[mp] listener error (${event}):`, err);
      }
    }
  }

  getStatusSummary() {
    const transport = this.wsConnected
      ? "LAN + TABS"
      : this.bcConnected
        ? this.demoSafe
          ? "LOCAL TABS (DEMO-SAFE)"
          : "LOCAL TABS"
        : "OFFLINE";
    return {
      room: this.room,
      callsign: this.callsign,
      color: this.color,
      peerCount: this.peers.size,
      crewTotal: this.peers.size + 1,
      wsAvailable: this.wsAvailable,
      wsConnected: this.wsConnected,
      bcConnected: this.bcConnected,
      transport,
      lanUrls: this.lanUrls,
    };
  }

  async connect({ room, callsign, lanEnabled } = {}) {
    if (room != null) this.room = sanitizeRoomCode(room);
    if (callsign != null) {
      this.callsign = sanitizeCallsign(callsign, this.callsign);
      try {
        if (typeof localStorage !== "undefined") localStorage.setItem("mm-callsign", this.callsign);
      } catch {
        /* ignore */
      }
    }
    if (typeof lanEnabled === "boolean") this.lanEnabled = lanEnabled;

    this.disconnect(false);
    this._disposed = false;

    this._openBroadcastChannel();
    if (this.lanEnabled) {
      await this._probeAndConnectWs();
    }

    clearInterval(this._helloTimer);
    this._helloTimer = setInterval(() => {
      this._publish({
        type: "hello",
        id: this.id,
        callsign: this.callsign,
        color: this.color,
        role: this.role,
        state: this.lastState,
      });
    }, 3000);

    clearInterval(this._pruneTimer);
    this._pruneTimer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [pid, p] of this.peers.entries()) {
        // LAN-WS peers stay alive via TCP socket; BroadcastChannel peers timeout after 12s silence.
        if (p.source !== "ws" && now - (p.lastSeenAt || 0) > 12000) {
          this.peers.delete(pid);
          changed = true;
          this._emit("peerleave", p);
        }
      }
      if (changed) this._emit("status", this.getStatusSummary());
    }, 4000);

    // Announce immediately over BroadcastChannel
    this._publish({
      type: "hello",
      id: this.id,
      callsign: this.callsign,
      color: this.color,
      role: this.role,
      state: this.lastState,
    });
    this._emit("status", this.getStatusSummary());
    return this.getStatusSummary();
  }

  _openBroadcastChannel() {
    if (typeof BroadcastChannel === "undefined") {
      this.bcConnected = false;
      return;
    }
    try {
      this._bc = new BroadcastChannel(`mm-eva-mp:${this.room}`);
      this._bc.onmessage = (ev) => {
        if (ev?.data) this._handlePacket(ev.data, "bc");
      };
      this.bcConnected = true;
    } catch {
      this.bcConnected = false;
    }
  }

  async _probeAndConnectWs() {
    if (typeof window === "undefined" || typeof fetch !== "function" || typeof WebSocket === "undefined") {
      return;
    }
    const loc = window.location;
    if (loc.protocol !== "http:" && loc.protocol !== "https:") return;

    try {
      const res = await fetch("/api/mp/status", { cache: "no-store" });
      if (!res.ok) {
        this.wsAvailable = false;
        return;
      }
      const info = await res.json();
      if (!info?.ws) {
        this.wsAvailable = false;
        return;
      }
      this.wsAvailable = true;
      this.lanUrls = Array.isArray(info.lanUrls) ? info.lanUrls : [];
      this._emit("status", this.getStatusSummary());
    } catch {
      this.wsAvailable = false;
      return;
    }

    this._openWebSocket();
  }

  _openWebSocket() {
    if (this._disposed || !this.wsAvailable || typeof window === "undefined") return;
    const loc = window.location;
    const proto = loc.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${loc.host}/ws?room=${encodeURIComponent(this.room)}`;

    try {
      const ws = new WebSocket(url);
      this._ws = ws;

      ws.onopen = () => {
        if (this._ws !== ws) return;
        this.wsConnected = true;
        this._reconnectAttempt = 0;
        this._sendWs({
          type: "hello",
          id: this.id,
          callsign: this.callsign,
          color: this.color,
          role: this.role,
          state: this.lastState,
        });
        this._emit("status", this.getStatusSummary());
      };

      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string") return;
        try {
          const msg = JSON.parse(ev.data);
          this._handlePacket(msg, "ws");
        } catch {
          /* ignore malformed JSON */
        }
      };

      ws.onclose = () => {
        if (this._ws !== ws) return;
        this.wsConnected = false;
        this._emit("status", this.getStatusSummary());
        if (!this._disposed && this.lanEnabled) {
          const delay = Math.min(8000, 1000 * Math.pow(1.6, this._reconnectAttempt++));
          clearTimeout(this._reconnectTimer);
          this._reconnectTimer = setTimeout(() => this._openWebSocket(), delay);
        }
      };

      ws.onerror = () => {
        /* onclose handles cleanup/reconnect cleanly */
      };
    } catch {
      this.wsConnected = false;
    }
  }

  _sendWs(packet) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      try {
        this._ws.send(JSON.stringify(packet));
      } catch {
        /* ignore */
      }
    }
  }

  _publish(packet) {
    const out = {
      ...packet,
      id: packet.id || this.id,
      callsign: packet.callsign || this.callsign,
      color: packet.color || this.color,
      role: packet.role || this.role,
      seq: ++this._seq,
    };
    if (this._bc) {
      try {
        this._bc.postMessage(out);
      } catch {
        /* ignore closed channel */
      }
    }
    this._sendWs(out);
  }

  _handlePacket(msg, source) {
    if (!msg || typeof msg !== "object") return;
    const senderId = msg.id;
    if (senderId === this.id) return;

    if (msg.type === "welcome") {
      if (Array.isArray(msg.peers)) {
        for (const p of msg.peers) {
          if (!p?.id || p.id === this.id) continue;
          const peer = this._upsertPeer(p, "ws");
          if (p.state) this._emit("peerstate", peer);
        }
      }
      if (Array.isArray(msg.pins)) {
        for (const pin of msg.pins) {
          if (!this.pins.some((x) => x.id === pin.id)) {
            this.pins.push(pin);
          }
        }
        this._emit("pins", [...this.pins]);
      }
      if (msg.routeSync) {
        this._emit("routesync", msg.routeSync);
      }
      this._emit("status", this.getStatusSummary());
      return;
    }

    if (msg.type === "peer-join" && msg.peer) {
      if (msg.peer.id === this.id) return;
      const isNew = !this.peers.has(msg.peer.id);
      const peer = this._upsertPeer(msg.peer, source);
      if (isNew) this._emit("peerjoin", peer);
      this._emit("status", this.getStatusSummary());
      return;
    }

    if (msg.type === "peer-leave" || msg.type === "bye") {
      const existing = this.peers.get(senderId);
      if (existing) {
        this.peers.delete(senderId);
        this._emit("peerleave", existing);
        this._emit("status", this.getStatusSummary());
      }
      return;
    }

    // Deduplicate sequence numbers across BroadcastChannel + WebSocket dual transport
    if (senderId && typeof msg.seq === "number") {
      const prev = this.peers.get(senderId);
      if (prev && typeof prev.lastSeq === "number" && msg.seq <= prev.lastSeq && msg.type !== "hello") {
        // Still allow seq reset if peer reloaded tab (`hello` resets lastSeq cleanly)
        return;
      }
    }

    if (msg.type === "hello") {
      if (!senderId) return;
      const isNew = !this.peers.has(senderId);
      const peer = this._upsertPeer(
        {
          id: senderId,
          callsign: msg.callsign,
          color: msg.color,
          role: msg.role,
          state: msg.state,
          lastSeq: typeof msg.seq === "number" ? msg.seq : 0,
        },
        source
      );
      if (isNew) {
        this._emit("peerjoin", peer);
        // Reply once so the newly opened BroadcastChannel tab immediately discovers us + our pins!
        if (source === "bc" && this._bc) {
          try {
            this._bc.postMessage({
              type: "hello-ack",
              id: this.id,
              callsign: this.callsign,
              color: this.color,
              role: this.role,
              state: this.lastState,
              pins: this.pins.slice(-12),
            });
          } catch {
            /* ignore */
          }
        }
      }
      if (msg.state) this._emit("peerstate", peer);
      this._emit("status", this.getStatusSummary());
      return;
    }

    if (msg.type === "hello-ack") {
      if (!senderId) return;
      const isNew = !this.peers.has(senderId);
      const peer = this._upsertPeer(msg, source);
      if (Array.isArray(msg.pins) && msg.pins.length > 0) {
        let added = false;
        for (const pin of msg.pins) {
          if (pin?.id && !this.pins.some((x) => x.id === pin.id)) {
            this.pins.push(pin);
            added = true;
          }
        }
        if (added) this._emit("pins", [...this.pins]);
      }
      if (isNew) this._emit("peerjoin", peer);
      if (msg.state) this._emit("peerstate", peer);
      this._emit("status", this.getStatusSummary());
      return;
    }

    if (msg.type === "state" && msg.state) {
      if (!senderId) return;
      const isNew = !this.peers.has(senderId);
      const peer = this._upsertPeer(
        {
          id: senderId,
          callsign: msg.callsign,
          color: msg.color,
          role: msg.role,
          state: msg.state,
          lastSeq: typeof msg.seq === "number" ? msg.seq : undefined,
        },
        source
      );
      if (isNew) {
        this._emit("peerjoin", peer);
        this._emit("status", this.getStatusSummary());
      }
      this._emit("peerstate", peer);
      return;
    }

    if (msg.type === "ping" && msg.pin) {
      if (msg.pin.id && !this.pins.some((p) => p.id === msg.pin.id)) {
        this.pins.push(msg.pin);
        if (this.pins.length > 24) this.pins.shift();
        this._emit("pins", [...this.pins]);
        this._emit("ping", msg.pin);
      }
      return;
    }

    if (msg.type === "clear-pings") {
      this.pins = [];
      this._emit("pins", []);
      return;
    }

    if (msg.type === "chat" && msg.text) {
      this._emit("chat", {
        id: senderId,
        callsign: msg.callsign || "CREW",
        color: msg.color || "#38bdf8",
        text: String(msg.text),
        ts: msg.ts || Date.now(),
      });
      return;
    }

    if (msg.type === "route-sync") {
      this._emit("routesync", {
        alongM: Number(msg.alongM) || 0,
        playing: Boolean(msg.playing),
        by: msg.by || "CREW",
      });
    }
  }

  _upsertPeer(raw, source) {
    const existing = this.peers.get(raw.id);
    const peer = existing || {
      id: raw.id,
      callsign: sanitizeCallsign(raw.callsign, "CREW"),
      color: raw.color || colorForPeerId(raw.id),
      role: raw.role || "eva",
      state: null,
      lastSeq: -1,
      source,
      lastSeenAt: Date.now(),
    };
    if (raw.callsign) peer.callsign = sanitizeCallsign(raw.callsign, peer.callsign);
    if (raw.color) peer.color = raw.color;
    if (raw.role) peer.role = raw.role;
    if (raw.state) peer.state = raw.state;
    if (typeof raw.lastSeq === "number") peer.lastSeq = raw.lastSeq;
    // Prefer "ws" marker once seen over WebSocket so BroadcastChannel reaper doesn't drop LAN peers
    if (source === "ws") peer.source = "ws";
    peer.lastSeenAt = Date.now();
    this.peers.set(peer.id, peer);
    return peer;
  }

  setRole(role) {
    this.role = role || "eva";
    this._publish({
      type: "hello",
      id: this.id,
      callsign: this.callsign,
      color: this.color,
      role: this.role,
      state: this.lastState,
    });
  }

  sendState(state) {
    this.lastState = state;
    this._publish({ type: "state", state });
  }

  dropPing({ lon, lat, elevM = null, label = "Science Beacon" }) {
    const pin = {
      id: makePeerUuid(),
      lon: Number(lon),
      lat: Number(lat),
      elevM: elevM != null ? Number(elevM) : null,
      label: String(label || "Science Beacon").slice(0, 48),
      by: this.callsign,
      color: this.color,
      ts: Date.now(),
    };
    this.pins.push(pin);
    if (this.pins.length > 24) this.pins.shift();
    this._emit("pins", [...this.pins]);
    this._publish({ type: "ping", pin });
    return pin;
  }

  clearPings() {
    this.pins = [];
    this._emit("pins", []);
    this._publish({ type: "clear-pings" });
  }

  sendChat(text) {
    const clean = String(text || "").trim().slice(0, 160);
    if (!clean) return;
    this._publish({ type: "chat", text: clean });
    this._emit("chat", {
      id: this.id,
      callsign: this.callsign,
      color: this.color,
      text: clean,
      ts: Date.now(),
      self: true,
    });
  }

  sendRouteSync(alongM, playing = false) {
    this._publish({ type: "route-sync", alongM: Number(alongM) || 0, playing: Boolean(playing) });
  }

  disconnect(clearPeers = true) {
    this._disposed = true;
    clearInterval(this._helloTimer);
    clearInterval(this._pruneTimer);
    clearTimeout(this._reconnectTimer);
    this._helloTimer = null;
    this._pruneTimer = null;
    this._reconnectTimer = null;

    if (this._bc) {
      try {
        this._bc.postMessage({ type: "bye", id: this.id, callsign: this.callsign });
        this._bc.close();
      } catch {
        /* ignore */
      }
      this._bc = null;
    }
    this.bcConnected = false;

    if (this._ws) {
      const ws = this._ws;
      this._ws = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.wsConnected = false;

    if (clearPeers) {
      this.peers.clear();
      this._emit("status", this.getStatusSummary());
    }
  }
}
