// Saltline on Cloudflare.
//   Worker          — serves the game (static assets) and a small API.
//   Room (DO)       — one Durable Object per room code. Holds up to 10 WebSockets, relays each player's presence
//                     (position, aim, hits, …) to everyone else, and relays WebRTC signalling for voice chat.
//   Matchmaker (DO) — one per continent, map and mode. Knows the public rooms there and how full they are, so quick
//                     play can drop a player into an open match on the map and mode they picked, or start a new one.
//   Census (DO)     — one for the whole game. Every room, public or private, reports its player count here, so the
//                     first screen and the HUD can show how many people are online and where.
//
// API
//   POST /api/quick   {map?, mode?} -> 200 { code, map, mode }   quick play: an open public room near you, on that map,
//                                                                 for that mode (Team deathmatch players meet only each other)
//   POST /api/rooms   {map?, mode?} -> 201 { code, max, map, mode }  create a private room on that map
//   GET  /api/rooms/:code        -> 200 { exists, players, max, map, mode }  check before joining (the page loads the room's map)
//                                   A room starts on the map it was made with; anyone in a private room can change it
//                                   (the 'map' message below). No map, or one this server doesn't know, means the harbour ("terminal"). mode is 'dm' (Deathmatch) or 'tdm' (Team
//                                   deathmatch): the mode a room opens on; players in a room can still pick either.
//   GET  /api/rooms/:code/ws     -> WebSocket upgrade            join (?peer=…&uid=…)
//   GET  /api/ice?room=CODE      -> 200 { iceServers }           STUN/TURN for voice (TURN when a key is configured)
//   GET  /api/online             -> 200 { online, dm:{players, matches}, rooms:{players, rooms} }
//                                                                 players connected right now: in quick-play
//                                                                 Deathmatch (public rooms) and in private rooms
//
// Wire protocol (JSON text frames; "ping" -> "pong" is answered without waking the object)
//   server -> client  {t:'hello', you, code, max, now, map, peers:[{peer, by, p}]}
//                     {t:'join', peer, by} · {t:'leave', peer} · {t:'p', peer, d, full?} · {t:'sig', from, d}
//                     {t:'map', map, peer}   the room's map changed (to everyone, the one who changed it too): every
//                                            page reloads into it
//                     {t:'error', code}  followed by a close (4000 bad request, 4001 full, 4004 no such room)
//   client -> server  {t:'p', d:{…changed presence keys…}, full?:true} · {t:'sig', to, d}
//                     {t:'map', d:{map}}      change a private room's map (public rooms keep theirs: quick play finds them by map)

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
const MAPS = ["terminal", "colosseum", "alpine", "maram"];
const MODES = ["dm", "tdm"]; // Deathmatch and Team deathmatch; the first is the default // the first is the game's own harbour; the others are the files in web/maps/
const STUN_ONLY = [{ urls: ["stun:stun.cloudflare.com:3478"] }];
const CENSUS_AUDIT_MS = 60 * 1000; // how often the census re-checks rooms that have been quiet
const CENSUS_STALE_MS = 2 * 60 * 1000; // a room quiet this long is asked for its real count

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

// the map and mode a request asks for, from its JSON body
async function choiceOf(request) {
  let body = null;
  try { body = await request.json(); } catch { /* no body: an older page, or a plain POST */ }
  return { map: MAPS.includes(body && body.map) ? body.map : MAPS[0], mode: MODES.includes(body && body.mode) ? body.mode : MODES[0] };
}

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
      const { map, mode } = await choiceOf(request);
      // players only meet others on the same map and in the same mode
      const mm = "mm-" + region + (map === MAPS[0] ? "" : "-" + map) + (mode === MODES[0] ? "" : "-" + mode);
      const code = await env.MATCH.getByName(mm).assign(mm, map, mode);
      return code ? json({ code, map, mode }) : json({ error: "busy" }, 503);
    }

    if (path === "/api/rooms") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      const { map, mode } = await choiceOf(request);
      const code = await createRoom(env, { map, mode });
      return code ? json({ code, max: MAX_PLAYERS, map, mode }, 201) : json({ error: "busy" }, 503);
    }

    if (path === "/api/online") {
      return json(await env.CENSUS.getByName("global").stats());
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
      if (!CODE_RE.test(code)) return json({ exists: false, players: 0, max: MAX_PLAYERS, map: MAPS[0], mode: MODES[0] }, 404);
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

  // every room tells the census how many players it has; public rooms also tell their matchmaker
  async report(n) {
    const code = await this.ctx.storage.get("code");
    if (!code) return;
    const mm = await this.ctx.storage.get("mm");
    try { await this.env.CENSUS.getByName("global").report(code, n, !!mm); } catch { /* the census audits quiet rooms */ }
    if (!mm) return;
    try { await this.env.MATCH.getByName(mm).report(code, n); } catch { /* next change reports again */ }
  }

  async create(code, opts = {}) {
    if (await this.ctx.storage.get("code")) return false; // code already taken
    const now = Date.now();
    const map = MAPS.includes(opts.map) && opts.map !== MAPS[0] ? opts.map : null; // the harbour is the default and is not stored
    const mode = MODES.includes(opts.mode) && opts.mode !== MODES[0] ? opts.mode : null; // so is Deathmatch
    await this.ctx.storage.put({ code, createdAt: now, emptySince: now, ...(opts.mm ? { mm: opts.mm } : {}), ...(map ? { map } : {}), ...(mode ? { mode } : {}) });
    await this.ctx.storage.setAlarm(now + EMPTY_TTL_MS);
    return true;
  }

  async info() {
    const exists = !!(await this.ctx.storage.get("code"));
    const map = (exists && (await this.ctx.storage.get("map"))) || MAPS[0];
    const mode = (exists && (await this.ctx.storage.get("mode"))) || MODES[0];
    return { exists, players: exists ? this.sockets().length : 0, max: MAX_PLAYERS, map, mode };
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

    // a reconnect from the same tab reuses its peer id: retire the stale socket quietly. To everyone else it is the same
    // player carrying on, so they are not told about a join (that made their games forget what they had already seen
    // from this player, and a kill reported in the first message after it was never counted), and the stored state
    // stays until the player's own full state arrives
    let kept = null;
    for (const ws of this.sockets()) {
      const a = ws.deserializeAttachment();
      if (a.peer === peer) {
        kept = a.p || {};
        ws.serializeAttachment({ ...a, dead: true });
        try { ws.close(4009, "replaced"); } catch { /* already gone */ }
      }
    }
    const others = this.sockets();
    if (others.length >= MAX_PLAYERS) return refuse(4001, "full");

    server.serializeAttachment({ peer, by, p: kept || {} });
    const map = (await this.ctx.storage.get("map")) || MAPS[0];
    server.send(JSON.stringify({
      t: "hello", you: peer, code, max: MAX_PLAYERS, now: Date.now(), map,
      peers: others.map((ws) => { const a = ws.deserializeAttachment(); return { peer: a.peer, by: a.by, p: a.p }; }),
    }));
    if (!kept) this.broadcast({ t: "join", peer, by }, server);
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
    } else if (m.t === "map" && MAPS.includes(m.d.map)) {
      // a private room's map, changed from its lobby. Everyone moves to it, so nobody plays a different map in the same room
      if (await this.ctx.storage.get("mm")) return;
      if (m.d.map === MAPS[0]) await this.ctx.storage.delete("map"); else await this.ctx.storage.put("map", m.d.map);
      this.broadcast({ t: "map", map: m.d.map, peer: a.peer });
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

  async assign(name, map, mode) {
    const rooms = await this.rooms();
    const now = Date.now();
    let best = null, bestLoad = -1;
    for (const [code, r] of Object.entries(rooms)) {
      if (now - r.t > 20000) r.pending = 0; // assigned players who never showed up
      const load = r.n + (r.pending || 0);
      if (load < MAX_PLAYERS && load > bestLoad) { best = code; bestLoad = load; }
    }
    if (!best) {
      best = await createRoom(this.env, { mm: name, map, mode });
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

// Players online. Keeps {code: {n, t, pub}} for every room with players in it; pub marks quick-play Deathmatch rooms.
// Rooms report on every join and leave. A room that went away without saying so (a crash, an eviction) would
// leave a stale count, so rooms that have been quiet for a while are asked for their real count now and then.
export class Census extends DurableObject {
  async rooms() {
    if (!this.map) this.map = (await this.ctx.storage.get("rooms")) || {};
    return this.map;
  }
  async save() { await this.ctx.storage.put("rooms", this.map); }

  async report(code, n, pub) {
    const rooms = await this.rooms();
    if (n > 0) rooms[code] = { n, t: Date.now(), pub: !!pub };
    else if (rooms[code]) delete rooms[code];
    else return;
    await this.save();
  }

  async stats() {
    const rooms = await this.rooms();
    const now = Date.now();
    if (now - (this.audited || 0) > CENSUS_AUDIT_MS) {
      this.audited = now;
      const quiet = Object.keys(rooms).filter((code) => now - rooms[code].t > CENSUS_STALE_MS);
      if (quiet.length) {
        await Promise.all(quiet.map(async (code) => {
          try {
            const { players } = await this.env.ROOMS.getByName(code).info();
            if (players > 0) rooms[code] = { ...rooms[code], n: players, t: now };
            else delete rooms[code];
          } catch { /* leave it for the next audit */ }
        }));
        await this.save();
      }
    }
    const dm = { players: 0, matches: 0 }, priv = { players: 0, rooms: 0 };
    for (const r of Object.values(rooms)) {
      const b = r.pub ? dm : priv;
      b.players += r.n;
      if (r.pub) dm.matches++; else priv.rooms++;
    }
    return { online: dm.players + priv.players, dm, rooms: priv };
  }
}
