/* Saltline network adapter: runs the game outside claude.ai, on Cloudflare.
   The multiplayer layer was written against the claude.ai artifact runtime (window.claude.use('room' | 'user' |
   'permissions' | 'db' | 'dictation' | 'tts')). This file provides the same interface:
     room        -> a WebSocket to a Cloudflare Durable Object (one per room code, max 10 players)
     user        -> an anonymous id kept in localStorage
     permissions -> everything granted except the mic, which follows the browser's own permission
     dictation   -> drives VOICE CHAT. The game's mic key (V), its touch MIC button and its "Mic on/off" HUD all
                    work as before, but instead of speech-to-text the mic now goes out as live audio (WebRTC,
                    peer to peer, signalled through the room's Durable Object, STUN/TURN from Cloudflare)
     tts         -> speechSynthesis, reads typed radio messages aloud
     db          -> not provided (the original only used it for connection diagnostics)
   It also owns the first screen (Deathmatch quick play · Room · Solo) and the room badge.
   Loaded as a plain <script> right before the multiplayer layer, so window.claude exists when that layer starts. */
(() => {
  'use strict';

  const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
  const MAX = 10;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: lasts this visit */ } },
  };
  const rnd = n => { const a = 'abcdefghijkmnpqrstuvwxyz23456789', b = crypto.getRandomValues(new Uint8Array(n)); let s = ''; for (const x of b) s += a[x % 32]; return s; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const G = () => window.__G;
  const gameState = () => { const g = G(); return g && g.game ? g.game.state : ''; };
  const hudMsg = (t, s) => { try { G().hud.message(t, s); } catch { /* not ready */ } };

  // Rounds are 5-minute slices of Date.now() in the multiplayer layer (nothing else in the game reads it), so players
  // whose clocks disagree would disagree on when a round ends. Every room hello carries the server's time: follow it.
  const realNow = Date.now.bind(Date);
  let skew = 0;
  Date.now = () => realNow() + skew;

  let uid = store.get('saltline.uid');
  if (!uid || !/^[A-Za-z0-9_-]{6,40}$/.test(uid)) { uid = 'u-' + rnd(16); store.set('saltline.uid', uid); }
  const peerId = rnd(10); // per tab; reused across reconnects so other players don't see a new person
  const quickTry = +(new URLSearchParams(location.search).get('try') || 1); // read before the URL is tidied

  /* ------------------------------------------------------------------ room: the presence channel */
  function makeRoom(code, hooks) {
    const peers = new Map();
    let me = { peer: peerId, by: uid, kind: 'viewer', presence: {}, sameTab: true };
    let ws = null, open = false, joined = false, dead = false, tries = 0, notifyT = 0, pingT = 0;
    const sent = {}; // key -> JSON of the value last sent, so only changed keys go on the wire
    const listeners = new Set();

    const list = () => joined ? [me, ...peers.values()] : [];
    const peerOf = (peer, by, p) => ({ peer, by, kind: 'viewer', presence: p || {}, sameTab: false });

    function notify(now) {
      if (notifyT) return;
      notifyT = setTimeout(() => {
        notifyT = 0;
        const ps = list();
        for (const l of listeners) try { l.cb({ peers: ps }); } catch (e) { console.error('[net]', e); }
        hooks.onCount(ps.length);
      }, now ? 0 : 80);
    }
    function fatal(why) {
      if (dead) return;
      dead = true; open = false; joined = false; clearInterval(pingT);
      for (const l of listeners) try { l.dead && l.dead({ code: why }); } catch { /* fine */ }
      hooks.onFatal(why);
    }
    const sendRaw = m => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };

    function connect() {
      if (dead) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const sock = new WebSocket(`${proto}//${location.host}/api/rooms/${code}/ws?peer=${peerId}&uid=${encodeURIComponent(uid)}`);
      ws = sock;
      sock.onopen = () => { open = true; };
      sock.onmessage = ev => {
        if (ev.data === 'pong') return;
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        handle(m);
      };
      sock.onclose = ev => {
        if (ws !== sock) return; // an older socket we already replaced
        open = false;
        if (ev.code === 4004) return fatal('not_found');
        if (ev.code === 4001) return fatal('full');
        if (ev.code === 4000) return fatal('bad_request');
        if (dead) return;
        // transient drop: keep the roster, reconnect with backoff; the game shows "Reconnecting"
        setTimeout(connect, Math.min(8000, 400 * 2 ** tries++) + Math.random() * 300);
      };
    }

    function handle(m) {
      if (m.t === 'error') { // sent right before a refusal close; act on it here rather than wait for the close
        if (m.code === 'not_found' || m.code === 'full' || m.code === 'bad_request') { fatal(m.code); try { ws.close(); } catch { /* fine */ } }
        return;
      }
      if (m.t === 'hello') {
        tries = 0;
        if (typeof m.now === 'number') skew = m.now - realNow(); // one-way delay (tens of ms) is close enough for round ends
        peers.clear();
        for (const p of m.peers || []) peers.set(p.peer, peerOf(p.peer, p.by, p.p));
        joined = true;
        if (Object.keys(me.presence).length) sendRaw({ t: 'p', full: true, d: me.presence }); // after a reconnect
        clearInterval(pingT); pingT = setInterval(() => { if (ws && ws.readyState === 1) ws.send('ping'); }, 20000);
        hooks.onHello([...peers.keys()]);
        notify(true);
      } else if (m.t === 'join') {
        peers.set(m.peer, peerOf(m.peer, m.by, {}));
        hooks.onJoin(m.peer);
        notify();
      } else if (m.t === 'leave') {
        peers.delete(m.peer);
        hooks.onLeave(m.peer);
        notify();
      } else if (m.t === 'p') {
        const p = peers.get(m.peer);
        if (!p || !m.d || typeof m.d !== 'object') return;
        // a new presence object each time: the game spots changes by identity
        peers.set(m.peer, { ...p, presence: m.full ? m.d : Object.assign({}, p.presence, m.d) });
        notify();
      } else if (m.t === 'sig' && m.from && m.d) {
        hooks.onSig(m.from, m.d);
      }
    }

    connect();

    return {
      code,
      presence(obj) {
        if (dead) return Promise.reject({ code: 'lost' });
        const d = {};
        let changed = false;
        for (const k of Object.keys(obj || {})) {
          const v = obj[k] === undefined ? null : obj[k];
          const j = JSON.stringify(v);
          if (sent[k] !== j) { sent[k] = j; d[k] = v; changed = true; }
        }
        me = { ...me, presence: { ...me.presence, ...obj } };
        if (changed && joined) sendRaw({ t: 'p', d });
        return Promise.resolve();
      },
      onPeers(cb, onDead) {
        const l = { cb, dead: onDead };
        listeners.add(l);
        if (joined) notify(true);
        return () => listeners.delete(l);
      },
      peers: list,
      connected: () => open && joined,
      leave() { dead = true; clearInterval(pingT); try { ws && ws.close(1000, 'leave'); } catch { /* fine */ } return Promise.resolve(); },
      // for voice
      sig(to, d) { sendRaw({ t: 'sig', to, d }); },
      mine: () => me.presence,
      get: peer => peers.get(peer),
    };
  }

  /* ------------------------------------------------------------------ voice chat: WebRTC mesh, audio only
     Every pair of players gets one RTCPeerConnection; the player with the smaller peer id makes the offer, so the two
     sides never collide. Each connection is created with an audio transceiver from the start and the mic is attached or
     detached with replaceTrack, so switching the mic on or off never needs a new offer. 10 players = 9 connections
     each, ~30 kbps per voice: fine for audio. */
  const voice = (() => {
    const conns = new Map(); // peer -> {pc, sender, audio, cands}
    const chains = new Map(); // peer -> promise, so each peer's signalling runs in order
    let room = null, ice = null, mic = null, micOn = false;
    const blocked = new Set(); // audio elements waiting for a user gesture before they may play
    const STUN = [{ urls: ['stun:stun.cloudflare.com:3478'] }];
    const offerer = peer => peerId < peer;
    const supported = typeof RTCPeerConnection === 'function' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

    function play(a) { const p = a.play(); if (p && p.catch) p.catch(() => blocked.add(a)); }
    const unblock = () => { for (const a of blocked) { blocked.delete(a); play(a); } };
    addEventListener('pointerdown', unblock, true); addEventListener('keydown', unblock, true);

    async function iceServers() {
      if (ice) return ice;
      try { const r = await fetch('/api/ice?room=' + room.code); if (r.ok) ice = (await r.json()).iceServers; } catch { /* STUN below */ }
      return ice || STUN;
    }
    function queue(peer, fn) {
      const next = (chains.get(peer) || Promise.resolve()).then(fn).catch(e => console.warn('[voice]', peer, e && e.message || e));
      chains.set(peer, next);
      return next;
    }
    function close(peer) {
      const c = conns.get(peer); if (!c) return;
      conns.delete(peer);
      try { c.pc.close(); } catch { /* fine */ }
      c.audio.srcObject = null; c.audio.remove(); blocked.delete(c.audio);
    }
    function make(peer, servers) {
      close(peer);
      const pc = new RTCPeerConnection({ iceServers: servers });
      const audio = document.createElement('audio');
      audio.autoplay = true; audio.setAttribute('playsinline', ''); audio.hidden = true;
      document.body.appendChild(audio);
      const c = { pc, sender: null, audio, cands: [] };
      pc.onicecandidate = e => { if (e.candidate && conns.get(peer) === c) room.sig(peer, { k: 'cand', c: e.candidate.toJSON() }); };
      pc.ontrack = e => { audio.srcObject = (e.streams && e.streams[0]) || new MediaStream([e.track]); play(audio); };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' && conns.get(peer) === c && offerer(peer)) {
          setTimeout(() => { if (conns.get(peer) === c && room.get(peer)) call(peer); }, 1500 + Math.random() * 1500);
        }
      };
      conns.set(peer, c);
      return c;
    }
    async function attach(c) {
      c.sender && await c.sender.replaceTrack(micOn && mic ? mic.getAudioTracks()[0] : null).catch(() => {});
    }
    async function flush(c) {
      for (const cand of c.cands.splice(0)) await c.pc.addIceCandidate(cand).catch(() => {});
    }
    function call(peer) {
      return queue(peer, async () => {
        const c = make(peer, await iceServers());
        c.sender = c.pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
        await attach(c);
        await c.pc.setLocalDescription(await c.pc.createOffer());
        room.sig(peer, { k: 'offer', sdp: c.pc.localDescription.sdp });
      });
    }
    function onSig(from, d) {
      if (!supported || !room) return;
      queue(from, async () => {
        if (d.k === 'offer' && typeof d.sdp === 'string') {
          const c = make(from, await iceServers()); // every offer comes from a fresh connection on the other side
          await c.pc.setRemoteDescription({ type: 'offer', sdp: d.sdp });
          const tr = c.pc.getTransceivers()[0];
          if (tr) { tr.direction = 'sendrecv'; c.sender = tr.sender; }
          await attach(c);
          await c.pc.setLocalDescription(await c.pc.createAnswer());
          room.sig(from, { k: 'answer', sdp: c.pc.localDescription.sdp });
          await flush(c);
        } else if (d.k === 'answer' && typeof d.sdp === 'string') {
          const c = conns.get(from);
          if (c && c.pc.signalingState === 'have-local-offer') { await c.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp }); await flush(c); }
        } else if (d.k === 'cand' && d.c) {
          const c = conns.get(from); if (!c) return;
          if (c.pc.remoteDescription) await c.pc.addIceCandidate(d.c).catch(() => {}); else c.cands.push(d.c);
        }
      });
    }

    // who you hear: everyone while you're both in the room lobby; in a match, the players in the same match
    // (and in Team play only your own team, like the game's radio)
    function audible(peer) {
      const mine = room.mine() || {}, p = (room.get(peer) || {}).presence || {};
      const live = x => (x.m === 'dm' || x.m === 'tdm') && Array.isArray(x.p);
      if (!live(mine)) return !live(p);
      return live(p) && p.m === mine.m && (mine.m !== 'tdm' || p.tm === mine.tm);
    }
    const nameOf = peer => { const p = (room.get(peer) || {}).presence || {}; return (typeof p.n === 'string' && p.n.trim()) || 'Breacher ' + peer.slice(-3).toUpperCase(); };

    return {
      supported,
      bind(r) { room = r; },
      onHello(list) {
        if (!supported) return;
        for (const peer of [...conns.keys()]) if (!list.includes(peer)) close(peer);
        for (const peer of list) {
          const c = conns.get(peer);
          if (offerer(peer) && (!c || c.pc.connectionState === 'failed' || c.pc.connectionState === 'closed')) call(peer);
        }
      },
      onJoin(peer) { if (supported && offerer(peer)) call(peer); },
      onLeave(peer) { close(peer); chains.delete(peer); },
      onSig,
      async micOn() {
        if (!mic) mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        micOn = true;
        for (const c of conns.values()) attach(c);
      },
      micOff() {
        micOn = false;
        for (const c of conns.values()) attach(c);
        if (mic) { mic.getTracks().forEach(t => t.stop()); mic = null; } // releases the mic, so the browser's mic light goes off
      },
      debug: () => ({ mic: micOn, peers: [...conns].map(([peer, c]) => ({ peer, state: c.pc.connectionState, muted: c.audio.muted, hearing: !!c.audio.srcObject })) }),
      // runs a few times a second: mute who you shouldn't hear, report who is talking
      tick() {
        const talking = [];
        if (!room) return talking;
        for (const [peer, c] of conns) {
          const on = audible(peer);
          if (c.audio.muted === on) c.audio.muted = !on;
          if (!on) continue;
          try {
            const r = c.pc.getReceivers()[0], s = r && r.getSynchronizationSources && r.getSynchronizationSources()[0];
            if (s && s.audioLevel > 0.04 && performance.timeOrigin + performance.now() - s.timestamp < 500) talking.push(nameOf(peer));
          } catch { /* not connected yet */ }
        }
        return talking;
      },
    };
  })();

  /* ------------------------------------------------------------------ the runtime the game expects */
  let micGranted = false;
  async function micState() {
    if (!voice.supported) return 'unavailable';
    try { const r = await navigator.permissions.query({ name: 'microphone' }); return r.state; } catch { return micGranted ? 'granted' : 'prompt'; }
  }
  async function micRequest() {
    const st = await micState();
    if (st !== 'prompt') return st;
    // the game asks once on load; on the open web a mic prompt nobody asked for is rude, so wait for a key or tap
    if (navigator.userActivation && !navigator.userActivation.isActive) return 'prompt';
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach(t => t.stop());
      micGranted = true;
      return 'granted';
    } catch { return 'denied'; }
  }
  const permissions = {
    async state(name) {
      if (name) return name === 'dictation' ? micState() : name === 'db' ? 'denied' : 'granted';
      return { room: 'granted', user: 'granted', db: 'denied', dictation: await micState() };
    },
    async request(names) {
      const out = { room: 'granted', user: 'granted', db: 'denied' };
      if ((names || []).includes('dictation')) out.dictation = await micRequest();
      return out;
    },
    manage() { return Promise.reject({ code: 'unsupported' }); }, // the game then explains where to switch it on
  };

  // the game's radio mic, wired to voice chat: start() opens the mic to the room, stop() closes it
  function makeVoiceMic() {
    const fns = [];
    const emit = e => { for (const f of fns) try { f(e); } catch { /* fine */ } };
    return {
      onPartial() {}, onFinal() {}, onState(f) { fns.push(f); },
      async start() {
        emit({ state: 'starting' });
        try { await voice.micOn(); } catch (e) {
          const code = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'not_granted' : 'error';
          emit({ state: 'idle', reason: code });
          throw { code };
        }
        emit({ state: 'listening' });
      },
      async stop() { voice.micOff(); emit({ state: 'idle' }); },
    };
  }

  function makeTts() {
    if (!('speechSynthesis' in window)) return null;
    const S = window.speechSynthesis;
    const VOICES = { buttery: { pitch: .85, rate: 1 }, airy: { pitch: 1.25, rate: 1.05 }, glassy: { pitch: 1.05, rate: 1.12 }, rounded: { pitch: .7, rate: .95 } };
    const names = Object.keys(VOICES);
    return {
      add(items) {
        const lang = (navigator.language || 'en').slice(0, 2);
        const vs = S.getVoices().filter(v => v.lang && v.lang.startsWith(lang));
        for (const it of items || []) {
          const u = new SpeechSynthesisUtterance(String(it && it.text || '').slice(0, 200));
          const o = VOICES[it && it.voice] || {};
          u.pitch = o.pitch || 1; u.rate = o.rate || 1;
          const i = names.indexOf(it && it.voice);
          if (vs.length && i >= 0) u.voice = vs[i % vs.length];
          S.speak(u);
        }
        return Promise.resolve();
      },
      stop() { S.cancel(); return Promise.resolve(); },
    };
  }

  let resolveRoom;
  const roomReady = new Promise(r => { resolveRoom = r; });
  const session = { kind: '', code: '' }; // kind: '' (choosing) | 'public' | 'private' | 'solo' | 'dead'
  let room = null;
  function startRoom(code, kind) {
    if (room) return;
    session.kind = kind; session.code = code;
    document.documentElement.classList.toggle('net-public', kind === 'public');
    room = makeRoom(code, {
      onHello: l => voice.onHello(l), onJoin: p => voice.onJoin(p), onLeave: p => voice.onLeave(p), onSig: (f, d) => voice.onSig(f, d),
      onCount: n => ui.count(n), onFatal: why => ui.fatal(why),
    });
    voice.bind(room);
    resolveRoom(room);
  }
  const tts = makeTts(), voiceMic = makeVoiceMic();
  window.__net = { session, voice: () => voice.debug() }; // for the console: __net.voice()
  const user = { id: () => Promise.resolve(uid), profiles: () => Promise.resolve({}) };

  window.claude = {
    use(name) {
      switch (name) {
        case 'room': return roomReady;
        case 'user': return Promise.resolve(user);
        case 'permissions': return Promise.resolve(permissions);
        case 'dictation': return roomReady.then(r => (r && voice.supported ? voiceMic : null));
        case 'tts': return Promise.resolve(tts);
        default: return Promise.resolve(null);
      }
    },
  };

  /* ------------------------------------------------------------------ first screen, room badge, voice panel */
  const ui = (() => {
    const css = document.createElement('style');
    css.textContent = `
      .net-gate { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; overflow-y: auto;
        padding: max(28px, env(safe-area-inset-top)) var(--gr, 16px) max(28px, env(safe-area-inset-bottom)) max(var(--gl, 16px), 6vw);
        background: linear-gradient(90deg, rgba(11,13,15,.96) 0%, rgba(11,13,15,.88) 38%, rgba(11,13,15,.45) 72%, rgba(11,13,15,.2) 100%);
        color: var(--bone, #e8e4da); font-family: var(--f-label, 'Barlow Condensed', sans-serif); -webkit-user-select: none; user-select: none; }
      .net-gate[hidden] { display: none; }
      .net-card { width: 100%; max-width: 460px; display: flex; flex-direction: column; gap: 22px; }
      .net-eyebrow { display: flex; gap: 10px; align-items: center; font: 500 12px/1 var(--f-mono, monospace); letter-spacing: .14em; text-transform: uppercase; color: var(--bone-dim, rgba(232,228,218,.64)); }
      .net-eyebrow .tag { padding: 4px 6px; background: var(--signal, #ffb347); color: var(--ink, #0b0d0f); }
      .net-word { margin: -6px 0 -4px; font: 900 clamp(64px, 15vw, 112px)/.84 var(--f-display, Impact, sans-serif); letter-spacing: .01em; }
      .net-name { display: flex; flex-direction: column; gap: 8px; }
      .net-name span, .net-k { font: 500 11px/1 var(--f-mono, monospace); letter-spacing: .14em; text-transform: uppercase; color: var(--bone-dim, rgba(232,228,218,.64)); }
      .net-in { background: rgba(232,228,218,.05); border: 1px solid var(--line, rgba(232,228,218,.2)); border-radius: 2px; color: var(--bone, #e8e4da);
        font: 500 20px/1 var(--f-label, sans-serif); padding: 12px 14px; -webkit-user-select: text; user-select: text; min-width: 0; }
      .net-in::placeholder { color: var(--bone-faint, rgba(232,228,218,.24)); }
      .net-in:focus { outline: none; border-color: var(--signal, #ffb347); }
      .net-modes { display: flex; flex-direction: column; border-top: 1px solid var(--line, rgba(232,228,218,.2)); }
      .net-mode { appearance: none; display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 2px 16px; width: 100%; text-align: left;
        background: transparent; border: 0; border-bottom: 1px solid var(--line, rgba(232,228,218,.2)); color: inherit; padding: 16px 4px; cursor: pointer; transition: padding .18s ease, background .18s ease; }
      .net-mode b { font: 700 32px/1 var(--f-display, Impact, sans-serif); letter-spacing: .02em; text-transform: uppercase; }
      .net-mode span { grid-column: 1; font-size: 17px; line-height: 1.3; color: var(--bone-dim, rgba(232,228,218,.64)); }
      .net-mode i { grid-column: 2; grid-row: 1 / span 2; font: 500 22px/1 var(--f-mono, monospace); font-style: normal; color: var(--bone-faint, rgba(232,228,218,.24)); transition: color .18s ease, transform .18s ease; }
      .net-mode:hover:not(:disabled), .net-mode:focus-visible { padding-left: 12px; background: linear-gradient(90deg, rgba(255,179,71,.1), transparent 70%); outline: none; }
      .net-mode:hover:not(:disabled) i, .net-mode:focus-visible i, .net-mode[aria-expanded="true"] i { color: var(--signal, #ffb347); }
      .net-mode[aria-expanded="true"] i { transform: rotate(45deg); }
      .net-mode.lead b { color: var(--signal, #ffb347); }
      .net-mode:disabled { cursor: default; opacity: .55; }
      .net-room { display: grid; grid-template-columns: 1fr; gap: 12px; padding: 4px 4px 18px; border-bottom: 1px solid var(--line, rgba(232,228,218,.2)); }
      .net-room[hidden] { display: none; }
      .net-row { display: flex; gap: 8px; }
      .net-code { flex: 1; font-family: var(--f-mono, monospace); letter-spacing: .3em; text-transform: uppercase; }
      .net-btn { appearance: none; border: 1px solid var(--line, rgba(232,228,218,.2)); background: transparent; color: var(--bone, #e8e4da); border-radius: 2px;
        font: 600 16px/1 var(--f-label, sans-serif); letter-spacing: .08em; text-transform: uppercase; padding: 13px 18px; cursor: pointer; white-space: nowrap; }
      .net-btn:hover:not(:disabled) { border-color: var(--bone-dim, rgba(232,228,218,.64)); }
      .net-btn.primary { background: var(--signal, #ffb347); border-color: var(--signal, #ffb347); color: var(--ink, #0b0d0f); }
      .net-btn.primary:hover:not(:disabled) { background: var(--signal-hot, #ffc977); }
      .net-btn:disabled { opacity: .5; cursor: default; }
      .net-btn:focus-visible { outline: 2px solid var(--signal, #ffb347); outline-offset: 2px; }
      .net-status { min-height: 20px; margin: -8px 0 0; font-size: 16px; color: var(--bone-dim, rgba(232,228,218,.64)); }
      .net-status.err { color: var(--alarm, #ff5a40); }
      .net-status.busy::before { content: ''; display: inline-block; width: 8px; height: 8px; margin-right: 10px; border-radius: 50%; background: var(--signal, #ffb347); animation: net-pulse 1s ease-in-out infinite; }
      @keyframes net-pulse { 50% { opacity: .25; } }
      @media (max-width: 640px) { .net-gate { background: rgba(11,13,15,.9); align-items: flex-start; } .net-mode b { font-size: 28px; } }

      .net-badge { position: fixed; z-index: 900; top: max(14px, env(safe-area-inset-top)); right: var(--gr, 16px); display: flex; align-items: center; gap: 10px;
        padding: 8px 8px 8px 12px; background: var(--plate-solid, rgba(11,13,15,.9)); border: 1px solid var(--line, rgba(232,228,218,.2)); border-radius: 2px;
        color: var(--bone, #e8e4da); font: 500 12px/1 var(--f-mono, monospace); letter-spacing: .1em; text-transform: uppercase; }
      .net-badge[hidden] { display: none; }
      .net-badge b { font-weight: 500; color: var(--signal, #ffb347); letter-spacing: .2em; }
      .net-badge .dim { color: var(--bone-dim, rgba(232,228,218,.64)); }
      .net-badge button { appearance: none; background: transparent; border: 1px solid var(--line, rgba(232,228,218,.2)); border-radius: 2px; color: var(--bone, #e8e4da);
        font: inherit; letter-spacing: .08em; padding: 7px 9px; cursor: pointer; }
      .net-badge button:hover { border-color: var(--bone-dim, rgba(232,228,218,.64)); }
      @media (max-width: 520px) { .net-badge .dim { display: none; } }

      .net-talk { position: fixed; z-index: 800; left: var(--gl, 16px); top: calc(max(14px, env(safe-area-inset-top)) + 84px); display: flex; flex-direction: column; gap: 6px; pointer-events: none; }
      .net-talk div { display: flex; align-items: center; gap: 8px; padding: 6px 10px 6px 8px; background: var(--plate, rgba(11,13,15,.6)); border-left: 2px solid var(--signal, #ffb347);
        font: 600 15px/1 var(--f-label, sans-serif); letter-spacing: .04em; color: var(--bone, #e8e4da); text-shadow: var(--shadow); }
      .net-talk i { width: 10px; height: 10px; border-radius: 50%; background: var(--signal, #ffb347); animation: net-pulse .7s ease-in-out infinite; }

      /* while the first screen is up, only the 3D scene shows behind it */
      html.net-gate-open #ui, html.net-gate-open #boot { visibility: hidden; }
      /* quick play has no room lobby: the first screen is home, so the game's title screen must never paint, not even for a frame */
      html.net-public #ui .m-title { visibility: hidden !important; }
      /* the room lobby: solo lives on the first screen now, and there is no permissions menu outside claude.ai */
      .mp-lobby [data-mp="solo"], .mp-lobby [data-mp="perms"] { display: none !important; }
    `;
    document.head.appendChild(css);

    const gate = document.createElement('div');
    gate.className = 'net-gate'; gate.hidden = true;
    gate.innerHTML = `
      <div class="net-card">
        <div class="net-eyebrow"><span class="tag">B4</span><span>Up to 10 players a match</span></div>
        <h1 class="net-word">SALTLINE</h1>
        <label class="net-name"><span>Your name</span><input class="net-in" data-net="name" maxlength="16" placeholder="Breacher" autocomplete="off" spellcheck="false"></label>
        <div class="net-modes">
          <button type="button" class="net-mode lead" data-net="dm"><b>Deathmatch</b><span>Jump into an open match. Everyone for themselves.</span><i>&rarr;</i></button>
          <button type="button" class="net-mode" data-net="room" aria-expanded="false"><b>Room</b><span>Play with friends. Make a room and share the code.</span><i>+</i></button>
          <form class="net-room" hidden novalidate>
            <button type="button" class="net-btn primary" data-net="create">Create a room</button>
            <div class="net-k">or join with a code</div>
            <div class="net-row">
              <input class="net-in net-code" data-net="code" maxlength="6" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Room code">
              <button type="submit" class="net-btn">Join</button>
            </div>
          </form>
          <button type="button" class="net-mode" data-net="solo"><b>Solo</b><span>The mission. Cut the relays and hold the berth.</span><i>&rarr;</i></button>
        </div>
        <p class="net-status" role="status"></p>
      </div>`;
    const $ = s => gate.querySelector(s);
    const nameIn = $('[data-net="name"]'), codeIn = $('[data-net="code"]'), roomForm = $('.net-room'), roomBtn = $('[data-net="room"]'), statusEl = $('.net-status');
    const allBtns = () => [...gate.querySelectorAll('button')];

    new MutationObserver(() => document.documentElement.classList.toggle('net-gate-open', !gate.hidden)).observe(gate, { attributes: true, attributeFilter: ['hidden'] });
    const badge = document.createElement('div'); badge.className = 'net-badge'; badge.hidden = true;
    const talk = document.createElement('div'); talk.className = 'net-talk';

    let count = 0, busy = false, joiningDm = false;
    const status = (t, kind) => { statusEl.textContent = t || ''; statusEl.className = 'net-status' + (kind ? ' ' + kind : ''); };
    const setBusy = b => { busy = b; for (const x of allBtns()) x.disabled = b; };
    const showGate = () => { if (!gate.hidden) return; gate.hidden = false; setBusy(false); };

    // name: the game reads it from localStorage when it starts, and from its own name field after that
    nameIn.value = store.get('saltline.mp.name') || '';
    nameIn.addEventListener('input', () => {
      const v = nameIn.value.replace(/[\u0000-\u001f\u007f<>]/g, '').slice(0, 16);
      store.set('saltline.mp.name', v.trim());
      const mpName = document.getElementById('mp-name');
      if (mpName && mpName.value !== v) { mpName.value = v; mpName.dispatchEvent(new Event('input')); }
    });

    // wait for the game, then press one of its own buttons (so its own flow and checks run)
    async function press(selector, timeout = 20000) {
      for (let t = 0; t < timeout; t += 150) {
        const b = document.querySelector(selector);
        if (b && !b.disabled && gameState() === 'title') { b.click(); return true; }
        await sleep(150);
      }
      return false;
    }

    async function quickPlay() {
      if (busy) return;
      if (session.kind === 'public' && room) { // already in a public room: back into its match
        setBusy(true); status('Joining the match…', 'busy');
        joiningDm = true;
        const ok = await press('.mp-lobby [data-mp="join-dm"]');
        joiningDm = false;
        if (ok) { gate.hidden = true; status(''); } else status('Could not join. Try again.', 'err');
        setBusy(false);
        return;
      }
      if (session.kind) { location.assign('/?play=dm'); return; } // the game connects once per page; start over
      setBusy(true); status('Finding a match…', 'busy');
      try {
        const r = await fetch('/api/quick', { method: 'POST' });
        if (!r.ok) throw new Error(String(r.status));
        const { code } = await r.json();
        startRoom(code, 'public');
        status(gameState() === 'title' ? 'Joining the match…' : 'Loading the yard…', 'busy');
        joiningDm = true;
        const ok = await press('.mp-lobby [data-mp="join-dm"]', 30000);
        joiningDm = false;
        if (ok) { gate.hidden = true; status(''); } else status('Could not join. Check your connection and try again.', 'err');
      } catch { joiningDm = false; status('Could not reach the server. Check your connection and try again.', 'err'); }
      setBusy(false);
    }

    function enterPrivate(code) {
      if (session.kind) { location.assign('/r/' + code); return; }
      history.replaceState(null, '', '/r/' + code);
      gate.hidden = true;
      startRoom(code, 'private');
      renderBadge();
    }
    async function createRoom() {
      if (busy) return;
      setBusy(true); status('Creating a room…', 'busy');
      try {
        const r = await fetch('/api/rooms', { method: 'POST' });
        if (!r.ok) throw new Error(String(r.status));
        const { code } = await r.json();
        status('');
        enterPrivate(code);
      } catch { status('Could not create a room. Check your connection and try again.', 'err'); }
      setBusy(false);
    }
    async function joinRoom() {
      if (busy) return;
      const code = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!CODE_RE.test(code)) { status('Room codes are 6 letters and numbers.', 'err'); codeIn.focus(); return; }
      setBusy(true); status('Looking for room ' + code + '…', 'busy');
      try {
        const info = await (await fetch('/api/rooms/' + code)).json();
        if (!info.exists) status(`No room ${code}. It may have expired.`, 'err');
        else if (info.players >= info.max) status(`Room ${code} is full (${info.max} players).`, 'err');
        else { status(''); enterPrivate(code); }
      } catch { status('Could not reach the server. Check your connection and try again.', 'err'); }
      setBusy(false);
    }
    async function solo() {
      if (busy) return;
      if (session.kind === 'public' || session.kind === 'private') { location.assign('/?play=solo'); return; }
      if (!session.kind) { session.kind = 'solo'; resolveRoom(null); }
      setBusy(true); status(gameState() === 'title' ? '' : 'Loading the yard…', 'busy');
      await press('.mp-lobby [data-mp="solo"]', 30000); // the game's solo title: difficulty, settings, Deploy
      gate.hidden = true; status(''); setBusy(false);
    }

    gate.addEventListener('click', ev => {
      const b = ev.target.closest('button[data-net]'); if (!b || b.disabled) return;
      const a = b.dataset.net;
      if (a === 'dm') quickPlay();
      else if (a === 'solo') solo();
      else if (a === 'create') createRoom();
      else if (a === 'room') {
        const open = roomForm.hidden;
        roomForm.hidden = !open; roomBtn.setAttribute('aria-expanded', String(open));
        if (open) setTimeout(() => codeIn.focus({ preventScroll: true }), 0);
      }
    });
    roomForm.addEventListener('submit', ev => { ev.preventDefault(); joinRoom(); });
    for (const inp of [nameIn, codeIn]) for (const t of ['keydown', 'keyup']) inp.addEventListener(t, ev => ev.stopPropagation()); // keep typing out of the game
    codeIn.addEventListener('input', () => { codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); status(''); });

    // the solo title's "Multiplayer" button opens this screen instead of the room lobby
    addEventListener('click', ev => {
      const b = ev.target.closest && ev.target.closest('[data-mp="to-lobby-title"]');
      if (b && session.kind !== 'private') { ev.stopPropagation(); ev.preventDefault(); status(''); showGate(); }
    }, true);

    function renderBadge() {
      badge.textContent = '';
      if (session.kind !== 'private' || !session.code) return;
      const code = session.code;
      const btn = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', fn); return b; };
      const tag = document.createElement('span'); tag.innerHTML = 'Room <b></b>'; tag.querySelector('b').textContent = code;
      const n = document.createElement('span'); n.className = 'dim'; n.textContent = count ? count + '/' + MAX : '';
      const copy = btn('Copy invite', async () => {
        try { await navigator.clipboard.writeText(location.origin + '/r/' + code); copy.textContent = 'Copied'; } catch { copy.textContent = code; }
        setTimeout(() => { copy.textContent = 'Copy invite'; }, 1600);
      });
      badge.append(tag, n, copy, btn('Leave', () => location.assign('/')));
    }

    // back to the title after a quick-play match: bring this screen up in the same tick, not on the next poll
    (function hook() {
      const g = G();
      if (!g || !g.events || typeof g.events.on !== 'function') { setTimeout(hook, 200); return; }
      g.events.on('game:state', e => { if (e && e.state === 'title' && session.kind === 'public' && !joiningDm) showGate(); });
    })();

    // a few times a second: which overlay belongs on screen, and who is talking
    let talkSig = '';
    setInterval(() => {
      const st = gameState(), onTitle = st === 'title';
      // after a quick-play match the game drops back to its title: this screen is home
      if (session.kind === 'public' && onTitle && !joiningDm) showGate();
      const showBadge = session.kind === 'private' && onTitle && gate.hidden;
      if (badge.hidden === showBadge) badge.hidden = !showBadge;
      const room = document.querySelector('[data-net-room]');
      const roomText = session.code && session.kind !== 'dead' ? (session.kind === 'public' ? 'Open match' : 'Room ' + session.code) : 'Online room';
      if (room && room.textContent !== roomText) room.textContent = roomText;
      const names = st === 'playing' || st === 'paused' || onTitle ? voice.tick() : [];
      const sig = names.join('|');
      if (sig !== talkSig) {
        talkSig = sig; talk.textContent = '';
        for (const n of names) { const d = document.createElement('div'); d.append(document.createElement('i'), n); talk.appendChild(d); }
      }
    }, 250);

    function mount() {
      document.body.append(gate, badge, talk);
      const path = location.pathname.match(/^\/r\/([A-Za-z0-9]{6})\/?$/);
      const code = path ? path[1].toUpperCase() : '';
      const play = new URLSearchParams(location.search).get('play');
      if (CODE_RE.test(code)) { startRoom(code, 'private'); renderBadge(); return; }
      if (location.search) history.replaceState(null, '', '/');
      gate.hidden = false;
      if (play === 'dm') quickPlay();
      else if (play === 'solo') solo();
    }
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

    return {
      count(n) { if (n !== count) { count = n; renderBadge(); } },
      fatal(why) {
        const { code, kind } = session;
        session.kind = 'dead'; session.code = '';
        badge.hidden = true;
        if (kind === 'public') { // the open match filled up between finding it and joining: find another
          if (quickTry < 3) { location.assign('/?play=dm&try=' + (quickTry + 1)); return; }
          showGate(); status('Every open match filled up just now. Try again.', 'err');
          return;
        }
        history.replaceState(null, '', '/');
        showGate();
        roomForm.hidden = false; roomBtn.setAttribute('aria-expanded', 'true');
        codeIn.value = code;
        status(why === 'full' ? `Room ${code} is full (${MAX} players).` : why === 'not_found' ? `No room ${code}. It may have expired.` : 'Could not join that room.', 'err');
      },
    };
  })();
})();
