// Saltline on Cloudflare.
//   Worker          — serves the game (static assets) and a small API.
//   Room (DO)       — one Durable Object per room code. Holds up to 10 WebSockets, relays each player's presence
//                     (position, aim, hits, …) to everyone else, and relays WebRTC signalling for voice chat.
//   Matchmaker (DO) — one per continent. Knows the public rooms there and how full they are, so quick play
//                     can drop a player into an open match or start a new one.
//
// API
//   POST /api/quick              -> 200 { code }                 quick play: an open public room near you
//   POST /api/rooms              -> 201 { code, max }            create a private room
//   GET  /api/rooms/:code        -> 200 { exists, players, max } check before joining
//   GET  /api/rooms/:code/ws     -> WebSocket upgrade            join (?peer=…&uid=…)
//   GET  /api/ice?room=CODE      -> 200 { iceServers }           STUN/TURN for voice (TURN when a key is configured)
//
// Wire protocol (JSON text frames; "ping" -> "pong" is answered without waking the object)
//   server -> client  {t:'hello', you, code, max, now, peers:[{peer, by, p}]}
//                     {t:'join', peer, by} · {t:'leave', peer} · {t:'p', peer, d, full?} · {t:'sig', from, d}
//                     {t:'error', code}  followed by a close (4000 bad request, 4001 full, 4004 no such room)
//   client -> server  {t:'p', d:{…changed presence keys…}, full?:true} · {t:'sig', to, d}

import { DurableObject } from "cloudflare:workers";

const MAX_PLAYERS = 10;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I — easy to read aloud
const CODE_LEN = 6;
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
const PEER_RE = /^[a-z0-9]{6,16}$/;
const UID_RE = /^[A-Za-z0-9_-]{6,40}$/;
const EMPTY_TTL_MS = 30 * 60 * 1000; // an empty room is deleted after 30 minutes
const MAX_MSG_BYTES = 12288;
const MAX_MSGS_PER_SEC = 60; // presence is ~15/s; voice setup sends a short burst of ICE candidates
const STUN_ONLY = [{ urls: ["stun:stun.cloudflare.com:3478"] }];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  let s = "";
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length]; // 256 % 32 === 0, so unbiased
  return s;
}

async function createRoom(env, opts) {
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    if (await env.ROOMS.getByName(code).create(code, opts)) return code;
  }
  return null;
}

async function iceServers(env) {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return STUN_ONLY;
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: 4 * 3600 }),
    });
    if (!r.ok) return STUN_ONLY;
    const { iceServers } = await r.json();
    // port 53 is blocked by browsers and only makes ICE wait for a timeout
    return iceServers.map((s) => ({ ...s, urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) }));
  } catch {
    return STUN_ONLY;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/quick") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      const region = String(request.cf?.continent || "XX").replace(/[^A-Z]/g, "") || "XX";
      const mm = "mm-" + region;
      const code = await env.MATCH.getByName(mm).assign(mm);
      return code ? json({ code }) : json({ error: "busy" }, 503);
    }

    if (path === "/api/rooms") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      const code = await createRoom(env, {});
      return code ? json({ code, max: MAX_PLAYERS }, 201) : json({ error: "busy" }, 503);
    }

    if (path === "/api/ice") {
      // only for rooms that exist, so the endpoint can't be used as a free TURN credential mint
      const code = String(url.searchParams.get("room") || "").toUpperCase();
      if (!CODE_RE.test(code) || !(await env.ROOMS.getByName(code).info()).exists) return json({ error: "not_found" }, 404);
      return json({ iceServers: await iceServers(env) });
    }

    const m = path.match(/^\/api\/rooms\/([A-Za-z0-9]{6})(\/ws)?$/);
    if (m) {
      const code = m[1].toUpperCase();
      if (!CODE_RE.test(code)) return json({ exists: false, players: 0, max: MAX_PLAYERS }, 404);
      const room = env.ROOMS.getByName(code);
      if (m[2]) {
        if (request.headers.get("Upgrade") !== "websocket") return json({ error: "expected_websocket" }, 426);
        return room.fetch(request);
      }
      return json(await room.info());
    }

    if (path.startsWith("/api/")) return json({ error: "not_found" }, 404);
    return env.ASSETS.fetch(request);
  },
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // keep-alive pings are answered by the runtime, so an idle lobby can hibernate
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.rate = new WeakMap(); // ws -> {t, n}; in memory only, which is fine
  }

  // live sockets, excluding ones we replaced or are closing
  sockets(except) {
    return this.ctx.getWebSockets().filter((ws) => {
      if (ws === except) return false;
      const a = ws.deserializeAttachment();
      return a && !a.dead;
    });
  }

  broadcast(msg, except) {
    const s = typeof msg === "string" ? msg : JSON.stringify(msg);
    for (const ws of this.sockets(except)) {
      try { ws.send(s); } catch { /* closing; its close handler cleans up */ }
    }
  }

  // public rooms tell their matchmaker how full they are
  async report(n) {
    const mm = await this.ctx.storage.get("mm");
    if (!mm) return;
    const code = await this.ctx.storage.get("code");
    try { await this.env.MATCH.getByName(mm).report(code, n); } catch { /* next change reports again */ }
  }

  async create(code, opts = {}) {
    if (await this.ctx.storage.get("code")) return false; // code already taken
    const now = Date.now();
    await this.ctx.storage.put({ code, createdAt: now, emptySince: now, ...(opts.mm ? { mm: opts.mm } : {}) });
    await this.ctx.storage.setAlarm(now + EMPTY_TTL_MS);
    return true;
  }

  async info() {
    const exists = !!(await this.ctx.storage.get("code"));
    return { exists, players: exists ? this.sockets().length : 0, max: MAX_PLAYERS };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const peer = url.searchParams.get("peer") || "";
    const by = url.searchParams.get("uid") || "";
    const code = await this.ctx.storage.get("code");

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const done = () => new Response(null, { status: 101, webSocket: client });
    const refuse = (closeCode, reason) => {
      server.serializeAttachment({ dead: true });
      server.send(JSON.stringify({ t: "error", code: reason }));
      server.close(closeCode, reason);
      return done();
    };

    if (!code) return refuse(4004, "not_found");
    if (!PEER_RE.test(peer) || !UID_RE.test(by)) return refuse(4000, "bad_request");

    // a reconnect from the same tab reuses its peer id: retire the stale socket quietly
    for (const ws of this.sockets()) {
      const a = ws.deserializeAttachment();
      if (a.peer === peer) {
        ws.serializeAttachment({ ...a, dead: true });
        try { ws.close(4009, "replaced"); } catch { /* already gone */ }
      }
    }
    const others = this.sockets();
    if (others.length >= MAX_PLAYERS) return refuse(4001, "full");

    server.serializeAttachment({ peer, by, p: {} });
    server.send(JSON.stringify({
      t: "hello", you: peer, code, max: MAX_PLAYERS, now: Date.now(),
      peers: others.map((ws) => { const a = ws.deserializeAttachment(); return { peer: a.peer, by: a.by, p: a.p }; }),
    }));
    this.broadcast({ t: "join", peer, by }, server);
    this.report(others.length + 1);
    return done();
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > MAX_MSG_BYTES) return;
    const now = Date.now();
    let r = this.rate.get(ws);
    if (!r || now - r.t >= 1000) { r = { t: now, n: 0 }; this.rate.set(ws, r); }
    if (++r.n > MAX_MSGS_PER_SEC) return;

    let m;
    try { m = JSON.parse(message); } catch { return; }
    if (!m || !m.d || typeof m.d !== "object" || Array.isArray(m.d)) return;
    const a = ws.deserializeAttachment();
    if (!a || a.dead) return;

    if (m.t === "p") {
      a.p = m.full ? m.d : Object.assign(a.p || {}, m.d);
      // the attachment survives hibernation, so late joiners get the full picture in their hello
      try { ws.serializeAttachment(a); } catch { /* over 16 KB: still relay, just not remembered */ }
      this.broadcast(m.full ? { t: "p", peer: a.peer, d: m.d, full: true } : { t: "p", peer: a.peer, d: m.d }, ws);
    } else if (m.t === "sig" && typeof m.to === "string") {
      // voice chat: offers, answers and ICE candidates go to one peer only
      const out = JSON.stringify({ t: "sig", from: a.peer, d: m.d });
      for (const s of this.sockets(ws)) {
        if (s.deserializeAttachment().peer === m.to) { try { s.send(out); } catch { /* gone */ } }
      }
    }
  }

  async webSocketClose(ws) { await this.gone(ws); }
  async webSocketError(ws) { await this.gone(ws); }

  async gone(ws) {
    const a = ws.deserializeAttachment();
    if (a && a.dead && !a.peer) { try { ws.close(1000, "refused"); } catch { /* done */ } return; } // refused before it joined
    ws.serializeAttachment({ ...(a || {}), dead: true });
    const rest = this.sockets(ws);
    // a replaced socket shares its peer id with the new one: don't announce a leave for it
    if (a && a.peer && !rest.some((s) => s.deserializeAttachment().peer === a.peer)) {
      this.broadcast({ t: "leave", peer: a.peer }, ws);
    }
    await this.report(rest.length);
    if (!rest.length) {
      const now = Date.now();
      await this.ctx.storage.put("emptySince", now);
      await this.ctx.storage.setAlarm(now + EMPTY_TTL_MS);
    }
  }

  async alarm() {
    if (this.sockets().length) {
      await this.ctx.storage.setAlarm(Date.now() + EMPTY_TTL_MS);
      return;
    }
    const emptySince = (await this.ctx.storage.get("emptySince")) || 0;
    const due = emptySince + EMPTY_TTL_MS;
    if (Date.now() < due) { await this.ctx.storage.setAlarm(due); return; }
    await this.report(0);
    await this.ctx.storage.deleteAll(); // the code is free again
  }
}

// Quick play. Keeps {code: {n, pending, t}} for the public rooms on one continent.
// Rooms are filled fullest-first so players end up together instead of alone in ten half-empty rooms.
export class Matchmaker extends DurableObject {
  async rooms() {
    if (!this.map) this.map = (await this.ctx.storage.get("rooms")) || {};
    return this.map;
  }
  async save() { await this.ctx.storage.put("rooms", this.map); }

  async assign(name) {
    const rooms = await this.rooms();
    const now = Date.now();
    let best = null, bestLoad = -1;
    for (const [code, r] of Object.entries(rooms)) {
      if (now - r.t > 20000) r.pending = 0; // assigned players who never showed up
      const load = r.n + (r.pending || 0);
      if (load < MAX_PLAYERS && load > bestLoad) { best = code; bestLoad = load; }
    }
    if (!best) {
      best = await createRoom(this.env, { mm: name });
      if (!best) return null;
      rooms[best] = { n: 0, pending: 0, t: now };
    }
    rooms[best].pending = (rooms[best].pending || 0) + 1;
    rooms[best].t = now;
    await this.save();
    return best;
  }

  async report(code, n) {
    const rooms = await this.rooms();
    if (n <= 0) delete rooms[code];
    else rooms[code] = { n, pending: Math.max(0, ((rooms[code] && rooms[code].pending) || 0) - 1), t: Date.now() };
    await this.save();
  }
}
