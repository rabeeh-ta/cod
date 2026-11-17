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
   It also owns the front end around the matches: home, quick play, private match and the room lobby.
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
    // Playback. An <audio> element cannot go above 100%, and voices came through much quieter than the gunfire, so every
    // voice runs through Web Audio instead: peer gain (0 or 1, who you may hear) -> volume (0 to 400%, the Settings
    // slider) -> limiter (so a boosted voice never clips) -> speakers. The <audio> element stays, muted: Chrome only
    // feeds a remote stream into Web Audio while an element is also holding it.
    const VOL_KEY = 'saltline.voiceVol', VOL_MAX = 4;
    let vol = parseFloat(store.get(VOL_KEY)); if (!(vol >= 0 && vol <= VOL_MAX)) vol = 2;
    let actx = null, master = null;
    function out() {
      if (actx) return actx;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        const ctx = new AC(), lim = ctx.createDynamicsCompressor();
        lim.threshold.value = -10; lim.knee.value = 8; lim.ratio.value = 12; lim.attack.value = .003; lim.release.value = .2;
        master = ctx.createGain(); master.gain.value = vol;
        master.connect(lim); lim.connect(ctx.destination);
        actx = ctx;
      } catch { actx = null; }
      return actx;
    }
    function unwire(c) {
      for (const n of [c.src, c.gain]) if (n) try { n.disconnect(); } catch { /* fine */ }
      c.src = c.gain = null;
    }
    function wire(c, stream) {
      unwire(c);
      if (!out()) { c.audio.volume = Math.min(1, vol); return; } // no Web Audio: plain element, 100% at most
      try {
        c.src = actx.createMediaStreamSource(stream);
        c.gain = actx.createGain(); c.gain.gain.value = 0; // the next tick opens it if you may hear this player
        c.src.connect(c.gain); c.gain.connect(master);
        c.audio.muted = true;
      } catch { unwire(c); c.audio.muted = false; c.audio.volume = Math.min(1, vol); }
    }
    const supported = typeof RTCPeerConnection === 'function' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

    function play(a) { const p = a.play(); if (p && p.catch) p.catch(() => blocked.add(a)); }
    const unblock = () => { for (const a of blocked) { blocked.delete(a); play(a); } if (actx && actx.state === 'suspended') actx.resume().catch(() => {}); };
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
      unwire(c);
      c.audio.srcObject = null; c.audio.remove(); blocked.delete(c.audio);
    }
    function make(peer, servers) {
      close(peer);
      const pc = new RTCPeerConnection({ iceServers: servers });
      const audio = document.createElement('audio');
      audio.autoplay = true; audio.setAttribute('playsinline', ''); audio.hidden = true;
      document.body.appendChild(audio);
      const c = { pc, sender: null, audio, cands: [], src: null, gain: null };
      pc.onicecandidate = e => { if (e.candidate && conns.get(peer) === c) room.sig(peer, { k: 'cand', c: e.candidate.toJSON() }); };
      pc.ontrack = e => { const s = (e.streams && e.streams[0]) || new MediaStream([e.track]); audio.srcObject = s; wire(c, s); play(audio); };
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
      // how loud other players' voices are: 0 to 4 (400%), kept for the next visit
      get volume() { return vol; },
      maxVolume: VOL_MAX,
      setVolume(v) {
        vol = Math.max(0, Math.min(VOL_MAX, +v || 0));
        store.set(VOL_KEY, String(vol));
        if (master) master.gain.value = vol;
        for (const c of conns.values()) if (!c.gain) c.audio.volume = Math.min(1, vol);
      },
      debug: () => ({ mic: micOn, volume: vol, boosted: !!actx, peers: [...conns].map(([peer, c]) => ({ peer, state: c.pc.connectionState, muted: c.gain ? c.gain.gain.value === 0 : c.audio.muted, hearing: !!c.audio.srcObject })) }),
      // runs a few times a second: mute who you shouldn't hear, report who is talking
      tick() {
        const talking = [];
        if (!room) return talking;
        for (const [peer, c] of conns) {
          const on = audible(peer);
          if (c.gain) { const g = on ? 1 : 0; if (c.gain.gain.value !== g) c.gain.gain.value = g; }
          else if (c.audio.muted === on) c.audio.muted = !on;
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

  /* ------------------------------------------------------------------ front end (home, quick play, private match, room lobby), voice panel */
  const ui = (() => {
    const css = document.createElement('style');
    css.textContent = `
      /* ---- the front end: home, quick play, private match and the room lobby, before and between matches.
         The game's own look: bone on near-black, the amber signal, condensed display type, square corners. ---- */
      .net-gate { position: fixed; inset: 0; z-index: 1000; display: grid; grid-template-rows: auto minmax(min-content, 1fr) auto; overflow-y: auto; overscroll-behavior: contain;
        padding: max(18px, env(safe-area-inset-top)) max(var(--gr, 16px), 4vw) max(18px, env(safe-area-inset-bottom)) max(var(--gl, 16px), 5vw);
        background: linear-gradient(90deg, rgba(11,13,15,.95) 0%, rgba(11,13,15,.86) 40%, rgba(11,13,15,.5) 74%, rgba(11,13,15,.28) 100%);
        color: var(--bone, #e8e4da); font-family: var(--f-label, 'Barlow Condensed', sans-serif); -webkit-user-select: none; user-select: none; }
      .net-gate[hidden] { display: none; }
      .net-gate button { font-family: inherit; }
      @keyframes net-pulse { 50% { opacity: .25; } }

      /* top bar: the mark and where you are on the left, who you are on the right */
      .fe-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 44px; }
      .fe-brand { display: flex; align-items: baseline; gap: 14px; min-width: 0; }
      .fe-mark { font: 900 26px/1 var(--f-display, Impact, sans-serif); letter-spacing: .02em; }
      .fe-crumb { font: 500 12px/1 var(--f-mono, monospace); letter-spacing: .16em; text-transform: uppercase; color: var(--bone-dim, rgba(232,228,218,.64)); white-space: nowrap; }
      .fe-crumb:not(:empty)::before { content: '/'; margin-right: 14px; color: var(--bone-faint, rgba(232,228,218,.3)); }
      .fe-me { display: flex; align-items: center; gap: 18px; }
      .fe-online { font: 500 11px/1 var(--f-mono, monospace); letter-spacing: .14em; text-transform: uppercase; color: var(--bone-dim, rgba(232,228,218,.64)); white-space: nowrap; }
      .fe-online:empty { display: none; }
      .net-live { display: inline-flex; align-items: center; gap: 8px; color: var(--bone, #e8e4da); }
      .net-live i { width: 7px; height: 7px; border-radius: 50%; background: var(--signal, #ffb347); animation: net-pulse 2.4s ease-in-out infinite; }
      .fe-name { display: flex; align-items: center; border: 1px solid var(--line, rgba(232,228,218,.2)); background: rgba(11,13,15,.6); border-radius: 2px; transition: border-color .18s ease; }
      .fe-name:hover { border-color: var(--bone-dim, rgba(232,228,218,.64)); }
      .fe-name:focus-within { border-color: var(--signal, #ffb347); }
      .fe-name span { padding: 0 0 0 12px; font: 500 10px/1 var(--f-mono, monospace); letter-spacing: .16em; text-transform: uppercase; color: var(--bone-dim, rgba(232,228,218,.64)); }
      .fe-name input { width: 150px; min-width: 0; background: transparent; border: 0; outline: none; color: var(--bone, #e8e4da); font: 600 17px/1 var(--f-label, sans-serif); letter-spacing: .04em;
        padding: 11px 12px; -webkit-user-select: text; user-select: text; }
      .fe-name input::placeholder { color: var(--bone-faint, rgba(232,228,218,.3)); }

      .fe-body { align-self: center; padding: 28px 0 24px; min-width: 0; }
      .fe-screen[hidden] { display: none !important; }
      .fe-split { display: grid; grid-template-columns: minmax(300px, 420px) minmax(0, 1fr); gap: clamp(28px, 4.5vw, 72px); align-items: start; }
      .fe-col { display: flex; flex-direction: column; min-width: 0; }
      .fe-h { margin: 0 0 6px; font: 900 clamp(42px, 4.4vw, 64px)/.9 var(--f-display, Impact, sans-serif); letter-spacing: .01em; text-transform: uppercase; white-space: nowrap; }
      .fe-k { margin: 22px 0 10px; font: 500 11px/1 var(--f-mono, monospace); letter-spacing: .16em; text-transform: uppercase; color: var(--bone-dim, rgba(232,228,218,.64)); }
      .fe-col > .fe-k:first-child { margin-top: 0; }

      /* home: the mark, then the three ways in */
      .fe-home { max-width: 560px; }
      .fe-eyebrow { display: flex; gap: 10px; align-items: center; font: 500 12px/1 var(--f-mono, monospace); letter-spacing: .14em; text-transform: uppercase; color: var(--bone-dim, rgba(232,228,218,.64)); }
      .fe-eyebrow .tag { padding: 4px 6px; background: var(--signal, #ffb347); color: var(--ink, #0b0d0f); }
      .fe-word { margin: 14px 0 30px; font: 900 clamp(72px, 11vw, 148px)/.82 var(--f-display, Impact, sans-serif); letter-spacing: .01em; }
      .fe-menu { display: flex; flex-direction: column; border-top: 1px solid var(--line, rgba(232,228,218,.2)); }
      .fe-item { position: relative; appearance: none; display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 4px 16px; width: 100%; text-align: left; color: inherit;
        background: transparent; border: 0; border-bottom: 1px solid var(--line, rgba(232,228,218,.2)); padding: 18px 8px 18px 20px; cursor: pointer;
        transition: background .18s ease, padding .18s ease; }
      .fe-item::before { content: ''; position: absolute; left: 0; top: -1px; bottom: -1px; width: 3px; background: var(--signal, #ffb347); transform: scaleY(0); transform-origin: 50% 50%; transition: transform .18s ease; }
      .fe-item b { font: 700 38px/1 var(--f-display, Impact, sans-serif); letter-spacing: .02em; text-transform: uppercase; transition: color .18s ease; }
      .fe-item span { grid-column: 1; font-size: 17px; line-height: 1.3; color: var(--bone-dim, rgba(232,228,218,.64)); }
      .fe-item em { grid-column: 1; margin-top: 4px; font: 500 11px/1.2 var(--f-mono, monospace); font-style: normal; letter-spacing: .12em; text-transform: uppercase; color: var(--signal, #ffb347); }
      .fe-item em:empty { display: none; }
      .fe-item i { grid-column: 2; grid-row: 1 / span 3; font: 500 24px/1 var(--f-mono, monospace); font-style: normal; color: var(--bone-faint, rgba(232,228,218,.3)); transition: color .18s ease, transform .18s ease; }
      .fe-item:hover:not(:disabled), .fe-item:focus-visible { padding-left: 28px; background: linear-gradient(90deg, rgba(255,179,71,.12), rgba(255,179,71,0) 70%); outline: none; }
      .fe-item:hover:not(:disabled)::before, .fe-item:focus-visible::before { transform: scaleY(1); }
      .fe-item:hover:not(:disabled) b, .fe-item:focus-visible b { color: var(--signal, #ffb347); }
      .fe-item:hover:not(:disabled) i, .fe-item:focus-visible i { color: var(--signal, #ffb347); transform: translateX(4px); }
      .fe-item:active:not(:disabled) { background: linear-gradient(90deg, rgba(255,179,71,.2), rgba(255,179,71,0) 70%); }
      .fe-item:disabled { cursor: default; opacity: .5; }

      /* a mode: one row of a single choice */
      .fe-modes { display: grid; gap: 8px; }
      .fe-mode { position: relative; appearance: none; display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 3px 12px; width: 100%; text-align: left; color: inherit;
        background: rgba(11,13,15,.6); border: 1px solid var(--line, rgba(232,228,218,.2)); border-radius: 2px; padding: 14px 16px; cursor: pointer;
        transition: border-color .18s ease, background .18s ease, box-shadow .18s ease; }
      .fe-mode b { font: 700 24px/1 var(--f-display, Impact, sans-serif); letter-spacing: .03em; text-transform: uppercase; transition: color .18s ease; }
      .fe-mode span { grid-column: 1; font-size: 15px; line-height: 1.3; color: var(--bone-dim, rgba(232,228,218,.64)); }
      .fe-mode em { grid-column: 2; grid-row: 1; font: 500 11px/1 var(--f-mono, monospace); font-style: normal; letter-spacing: .12em; text-transform: uppercase; color: var(--bone-dim, rgba(232,228,218,.64)); }
      .fe-mode em.live { color: var(--signal, #ffb347); }
      .fe-mode:hover:not(:disabled) { border-color: var(--bone-dim, rgba(232,228,218,.64)); }
      .fe-mode:active:not(:disabled) { background: rgba(34,27,16,.9); }
      .fe-mode:focus-visible { outline: 2px solid var(--signal, #ffb347); outline-offset: 2px; }
      .fe-mode[aria-pressed="true"] { border-color: var(--signal, #ffb347); background: rgba(34,27,16,.86); box-shadow: inset 3px 0 0 var(--signal, #ffb347); }
      .fe-mode[aria-pressed="true"] b { color: var(--signal, #ffb347); }
      .fe-mode:disabled { cursor: default; opacity: .5; }

      /* a map: its picture from above, the name on a dark fade at the bottom */
      .fe-maps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .fe-maps.one { grid-template-columns: minmax(0, 520px); }
      .fe-map { position: relative; appearance: none; display: block; width: 100%; aspect-ratio: 16 / 9; padding: 0; overflow: hidden; cursor: pointer; text-align: left; color: var(--bone, #e8e4da);
        background: #15181b; border: 1px solid var(--line, rgba(232,228,218,.2)); border-radius: 2px; transition: border-color .18s ease; }
      .fe-map img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: transform .45s cubic-bezier(.2, .7, .2, 1), filter .18s ease; filter: saturate(.9) brightness(.92); }
      .fe-map::after { content: ''; position: absolute; inset: 0; background: linear-gradient(to top, rgba(5,6,7,.94) 0%, rgba(5,6,7,.62) 34%, rgba(5,6,7,0) 66%); pointer-events: none; }
      .fe-map::before { content: ''; position: absolute; inset: 0; z-index: 2; box-shadow: inset 0 0 0 2px var(--signal, #ffb347); opacity: 0; transition: opacity .18s ease; pointer-events: none; }
      .fe-map-t { position: absolute; left: 14px; right: 14px; bottom: 12px; z-index: 1; display: grid; gap: 5px; }
      .fe-map-t b { font: 700 clamp(17px, 1.6vw, 24px)/1 var(--f-display, Impact, sans-serif); letter-spacing: .03em; text-transform: uppercase; }
      .fe-map-t small { font-size: 13px; line-height: 1.25; color: var(--bone-dim, rgba(232,228,218,.64)); }
      .fe-map-tag { position: absolute; left: 10px; top: 10px; z-index: 1; padding: 4px 6px; background: var(--signal, #ffb347); color: var(--ink, #0b0d0f); font: 500 10px/1 var(--f-mono, monospace); letter-spacing: .14em; text-transform: uppercase; opacity: 0; transform: translateY(-3px); transition: opacity .18s ease, transform .18s ease; }
      .fe-map:hover:not(:disabled) { border-color: var(--bone-dim, rgba(232,228,218,.64)); }
      .fe-map:hover:not(:disabled) img { transform: scale(1.045); filter: saturate(1) brightness(1); }
      .fe-map:active:not(:disabled) img { transform: scale(1.02); }
      .fe-map:focus-visible { outline: 2px solid var(--signal, #ffb347); outline-offset: 2px; }
      .fe-map[aria-pressed="true"] { border-color: var(--signal, #ffb347); }
      .fe-map[aria-pressed="true"]::before, .fe-map[aria-pressed="true"] .fe-map-tag { opacity: 1; transform: none; }
      .fe-map[aria-pressed="true"] img { filter: saturate(1) brightness(1); }
      .fe-map[aria-pressed="true"] .fe-map-t b { color: var(--signal, #ffb347); }
      .fe-map:disabled { cursor: default; }
      .fe-maps.one .fe-map { cursor: default; } .fe-maps.one .fe-map img { transform: none; }

      /* the one big action of a screen, and the smaller ones */
      .fe-go { margin-top: 22px; display: grid; gap: 12px; }
      .fe-cta { appearance: none; display: grid; gap: 7px; width: 100%; text-align: left; padding: 18px 22px 17px; cursor: pointer; border: 0; border-radius: 2px;
        background: var(--signal, #ffb347); color: var(--ink, #0b0d0f); transition: background .15s ease, transform .1s ease; }
      .fe-cta > span { font: 900 32px/.9 var(--f-display, Impact, sans-serif); letter-spacing: .03em; text-transform: uppercase; }
      .fe-cta small { font: 500 11px/1.2 var(--f-mono, monospace); letter-spacing: .12em; text-transform: uppercase; opacity: .72; }
      .fe-cta small:empty { display: none; }
      .fe-cta:hover:not(:disabled) { background: var(--signal-hot, #ffc977); }
      .fe-cta:active:not(:disabled) { transform: translateY(1px); }
      .fe-cta:focus-visible { outline: 2px solid var(--bone, #e8e4da); outline-offset: 3px; }
      .fe-cta:disabled { cursor: default; opacity: .55; }
      .fe-btn { appearance: none; border: 1px solid var(--line, rgba(232,228,218,.2)); background: rgba(11,13,15,.6); color: var(--bone, #e8e4da); border-radius: 2px;
        font: 600 14px/1 var(--f-label, sans-serif); letter-spacing: .1em; text-transform: uppercase; padding: 12px 15px; cursor: pointer; white-space: nowrap;
        transition: border-color .15s ease, background .15s ease, color .15s ease; }
      .fe-btn:hover:not(:disabled) { border-color: var(--bone-dim, rgba(232,228,218,.64)); background: rgba(11,13,15,.82); }
      .fe-btn:active:not(:disabled) { color: var(--signal, #ffb347); border-color: var(--signal, #ffb347); }
      .fe-btn:focus-visible { outline: 2px solid var(--signal, #ffb347); outline-offset: 2px; }
      .fe-btn:disabled { cursor: default; opacity: .5; }
      .fe-status { min-height: 20px; margin: 0; font-size: 16px; line-height: 1.3; color: var(--bone-dim, rgba(232,228,218,.64)); }
      .fe-status.err { color: var(--alarm, #ff5a40); }
      .fe-status.busy::before { content: ''; display: inline-block; width: 8px; height: 8px; margin-right: 10px; border-radius: 50%; background: var(--signal, #ffb347); animation: net-pulse 1s ease-in-out infinite; }

      /* private match: join with a code */
      .fe-join { display: flex; gap: 8px; }
      .fe-code-in { flex: 1; min-width: 0; background: rgba(11,13,15,.6); border: 1px solid var(--line, rgba(232,228,218,.2)); border-radius: 2px; color: var(--bone, #e8e4da);
        font: 500 20px/1 var(--f-mono, monospace); letter-spacing: .3em; text-transform: uppercase; padding: 11px 14px; -webkit-user-select: text; user-select: text; }
      .fe-code-in::placeholder { color: var(--bone-faint, rgba(232,228,218,.3)); }
      .fe-code-in:hover { border-color: var(--bone-dim, rgba(232,228,218,.64)); }
      .fe-code-in:focus { outline: none; border-color: var(--signal, #ffb347); }
      .fe-or { display: flex; align-items: center; gap: 12px; margin: 30px 0 12px; font: 500 11px/1 var(--f-mono, monospace); letter-spacing: .16em; text-transform: uppercase; color: var(--bone-dim, rgba(232,228,218,.64)); }
      .fe-or::after { content: ''; flex: 1; height: 1px; background: var(--line, rgba(232,228,218,.2)); }

      /* the room lobby */
      .fe-room-h { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
      .fe-code { display: flex; align-items: center; gap: 12px; padding: 0 14px; min-height: 44px; border: 1px solid var(--line, rgba(232,228,218,.2)); background: rgba(11,13,15,.6); border-radius: 2px; }
      .fe-code span { font: 500 10px/1 var(--f-mono, monospace); letter-spacing: .16em; text-transform: uppercase; color: var(--bone-dim, rgba(232,228,218,.64)); }
      .fe-code b { font: 500 22px/1 var(--f-mono, monospace); letter-spacing: .28em; color: var(--signal, #ffb347); }
      .fe-code em { font: 500 11px/1 var(--f-mono, monospace); font-style: normal; letter-spacing: .1em; color: var(--bone-dim, rgba(232,228,218,.64)); }
      .fe-teams { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .fe-teams.ffa { grid-template-columns: minmax(0, 1fr); }
      .fe-team { display: flex; flex-direction: column; border: 1px solid var(--line, rgba(232,228,218,.2)); background: rgba(11,13,15,.6); border-radius: 2px; min-width: 0; }
      .fe-team-h { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 12px 14px 10px; border-bottom: 1px solid var(--line, rgba(232,228,218,.2)); }
      .fe-team-h b { font: 700 22px/1 var(--f-display, Impact, sans-serif); letter-spacing: .04em; text-transform: uppercase; }
      .fe-team-h span { font: 500 11px/1 var(--f-mono, monospace); letter-spacing: .1em; text-transform: uppercase; color: var(--bone-dim, rgba(232,228,218,.64)); white-space: nowrap; }
      .fe-team ul { list-style: none; margin: 0; padding: 6px 0; flex: 1; min-height: 48px; }
      .fe-team li { display: flex; align-items: center; gap: 9px; padding: 6px 14px; font-size: 16px; line-height: 1.2; }
      .fe-team li i { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--bone-dim, rgba(232,228,218,.64)); }
      .fe-team li .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .fe-team li .you { font: 500 10px/1 var(--f-mono, monospace); letter-spacing: .14em; text-transform: uppercase; color: var(--signal, #ffb347); }
      .fe-team li .sc { font: 500 12px/1 var(--f-mono, monospace); color: var(--bone-dim, rgba(232,228,218,.64)); font-variant-numeric: tabular-nums; }
      .fe-team li.empty { color: var(--bone-faint, rgba(232,228,218,.3)); font-size: 15px; }
      .fe-team .fe-btn { margin: 0 10px 10px; }
      .fe-team .fe-join-team { margin: 0 10px 10px; appearance: none; border: 0; border-radius: 2px; padding: 14px 16px 13px; cursor: pointer; text-align: center;
        background: var(--team, #e8e4da); color: #0b0d0f; font: 900 22px/1 var(--f-display, Impact, sans-serif); letter-spacing: .04em; text-transform: uppercase;
        transition: filter .15s ease, transform .1s ease; }
      .fe-team .fe-join-team:hover:not(:disabled) { filter: brightness(1.12); }
      .fe-team .fe-join-team:active:not(:disabled) { transform: translateY(1px); }
      .fe-team .fe-join-team:focus-visible { outline: 2px solid var(--bone, #e8e4da); outline-offset: 3px; }
      .fe-team .fe-join-team:disabled { cursor: default; opacity: .45; }
      .fe-team.mine { border-color: var(--team, #e8e4da); }
      .fe-lead { margin: 10px 0 0; font-size: 17px; line-height: 1.35; color: var(--bone-dim, rgba(232,228,218,.64)); }
      .fe-team-wide { max-width: 560px; }
      .fe-idle { margin: 12px 0 0; font-size: 15px; line-height: 1.35; color: var(--bone-dim, rgba(232,228,218,.64)); }
      .fe-idle:empty { display: none; }
      .fe-idle b { font-weight: 600; color: var(--bone, #e8e4da); }
      .fe-note { margin: 8px 0 0; font-size: 14px; color: var(--bone-dim, rgba(232,228,218,.64)); text-shadow: var(--shadow); }

      /* bottom bar: back (Esc) or leave on the left; fullscreen sits fixed at the right */
      .fe-foot { display: flex; align-items: center; gap: 10px; min-height: 44px; }
      .fe-foot kbd { display: inline-block; margin-right: 8px; padding: 3px 5px; border: 1px solid var(--line, rgba(232,228,218,.2)); border-radius: 2px; font: 500 10px/1 var(--f-mono, monospace); letter-spacing: .08em; color: var(--bone-dim, rgba(232,228,218,.64)); }
      .fe-foot [hidden] { display: none; }

      @media (max-width: 1000px) {
        .fe-split { grid-template-columns: minmax(0, 1fr); }
        .fe-split > .fe-col { max-width: 620px; }
        .net-gate { background: rgba(11,13,15,.88); }
      }
      @media (max-width: 640px) {
        .fe-me .fe-online { display: none; }
        .fe-crumb { display: none; }
        .fe-name input { width: 110px; }
        .fe-item b { font-size: 30px; }
        .fe-maps { grid-template-columns: minmax(0, 1fr); }
        .fe-teams { grid-template-columns: minmax(0, 1fr); }
        .fe-foot { padding-right: 60px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .fe-item, .fe-item::before, .fe-item b, .fe-item i, .fe-mode, .fe-map, .fe-map img, .fe-map::before, .fe-map-tag, .fe-cta, .fe-btn, .fe-name, .fe-team .fe-join-team { transition: none; }
        .fe-map:hover:not(:disabled) img, .fe-map:active:not(:disabled) img { transform: none; }
        .fe-item:hover:not(:disabled) i, .fe-item:focus-visible i { transform: none; }
        .net-live i, .fe-status.busy::before { animation: none; }
      }

      .net-talk { position: fixed; z-index: 800; left: var(--gl, 16px); top: calc(max(14px, env(safe-area-inset-top)) + 84px); display: flex; flex-direction: column; gap: 6px; pointer-events: none; }
      .net-talk div { display: flex; align-items: center; gap: 8px; padding: 6px 10px 6px 8px; background: var(--plate, rgba(11,13,15,.6)); border-left: 2px solid var(--signal, #ffb347);
        font: 600 15px/1 var(--f-label, sans-serif); letter-spacing: .04em; color: var(--bone, #e8e4da); text-shadow: var(--shadow); }
      .net-talk i { width: 10px; height: 10px; border-radius: 50%; background: var(--signal, #ffb347); animation: net-pulse .7s ease-in-out infinite; }

      /* players online: a line under the match tally in the objective box */
      .net-online { display: flex; align-items: center; gap: 7px; margin-top: 7px; font: 600 11px/1 var(--f-label, sans-serif); letter-spacing: .22em;
        text-transform: uppercase; color: rgba(232, 228, 218, .72); text-shadow: var(--shadow); }
      .net-online[hidden] { display: none; }
      .net-online i { width: 6px; height: 6px; border-radius: 50%; background: var(--signal, #ffb347); animation: net-pulse 2.4s ease-in-out infinite; }
      .net-online b { font-weight: 600; color: var(--bone, #e8e4da); }

      /* while the first screen is up, only the 3D scene shows behind it */
      html.net-gate-open #ui, html.net-gate-open #boot { visibility: hidden; }
      /* ... and only once it is a scene. While the game loads, its view holds scratch pictures (a blurred sky, a dark
         square), so the view stays dark until the first real frames, then the map comes up behind the menu. Meanwhile
         the first screen carries the game's own loading line and bar (its loading screen is hidden under this one). */
      #view { transition: opacity .9s ease; }
      html:not(.net-scene) #view { opacity: 0; }
      .net-load { position: absolute; right: max(var(--gr, 16px), 6vw); bottom: max(28px, env(safe-area-inset-bottom)); display: grid; justify-items: end; gap: 14px;
        pointer-events: none; transition: opacity .4s ease; }
      .net-load .boot-sub { text-align: right; }
      .net-load .boot-bar { width: min(240px, 40vw); }
      html.net-scene .net-load { opacity: 0; }
      @media (max-width: 900px) { .net-load { display: none; } }
      /* fullscreen, bottom right of the front end and of the pause screen (the loading line sits above it until the scene is up) */
      .net-fs { position: fixed; z-index: 1001; right: max(var(--gr, 16px), 4vw); bottom: calc(max(18px, env(safe-area-inset-bottom)) + 2px); display: flex; align-items: center; gap: 10px;
        appearance: none; background: rgba(11,13,15,.6); border: 1px solid var(--line, rgba(232,228,218,.2)); border-radius: 2px; color: var(--bone, #e8e4da);
        font: 600 14px/1 var(--f-label, sans-serif); letter-spacing: .12em; text-transform: uppercase; padding: 11px 14px; cursor: pointer;
        transition: border-color .18s ease, background .18s ease, color .18s ease; }
      .net-fs[hidden] { display: none; }
      .net-fs svg { width: 16px; height: 16px; flex: none; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: square; }
      .net-fs:hover { border-color: var(--bone-dim, rgba(232,228,218,.64)); background: rgba(11,13,15,.8); }
      .net-fs:active { color: var(--signal, #ffb347); border-color: var(--signal, #ffb347); }
      .net-fs:focus-visible { outline: 2px solid var(--signal, #ffb347); outline-offset: 2px; }
      .net-fs .exit { display: none; } .net-fs.on .exit { display: block; } .net-fs.on .enter { display: none; }
      .net-load { bottom: calc(max(28px, env(safe-area-inset-bottom)) + 58px); }
      @media (max-width: 640px) { .net-fs { right: var(--gr, 16px); bottom: max(18px, env(safe-area-inset-bottom)); padding: 11px; } .net-fs span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; } }
      @media (prefers-reduced-motion: reduce) { .net-fs { transition: none; } }
      @media (prefers-reduced-motion: reduce) { #view, .net-load { transition: none; } }
      /* quick play has no room lobby: the first screen is home, so the game's title screen must never paint, not even for a frame */
      html.net-public #ui .m-title { visibility: hidden !important; }
      /* the room lobby: solo lives on the first screen now, and there is no permissions menu outside claude.ai */
      .mp-lobby [data-mp="solo"], .mp-lobby [data-mp="perms"] { display: none !important; }
    `;
    document.head.appendChild(css);

    /* The front end, shaped like a console shooter's: a home screen with the ways in, then a screen for each.
         home     Quick play · Private match · Solo mission
         quick    mode (Team deathmatch or Deathmatch), map, gun, then Find match: an open public match on that map, in that mode
         team     after Find match in Team deathmatch: who is on Red and on Blue, and the player picks a side
         private  create a room (mode and map) or join one with a code
         room     the room's lobby: its code to share, its map, a mode, who is on which team (Join Red / Join Blue), your gun
       Leaving a match brings back the screen it was started from. */
    const gate = document.createElement('div');
    gate.className = 'net-gate'; gate.hidden = true;
    gate.innerHTML = `
      <header class="fe-top">
        <div class="fe-brand"><span class="fe-mark">SALTLINE</span><span class="fe-crumb" data-fe="crumb"></span></div>
        <div class="fe-me"><span class="fe-online" data-net-stat="online"></span><label class="fe-name"><span>Name</span><input data-net="name" maxlength="16" placeholder="Breacher" autocomplete="off" spellcheck="false"></label></div>
      </header>
      <main class="fe-body">
        <section class="fe-screen fe-home" data-s="home" aria-label="Saltline">
          <div class="fe-eyebrow"><span class="tag">B4</span><span>Port Authority Breach Unit · up to 10 a match</span></div>
          <h1 class="fe-word">SALTLINE</h1>
          <nav class="fe-menu" aria-label="Play">
            <button type="button" class="fe-item" data-go="quick"><b>Quick play</b><span>Team deathmatch or deathmatch, with whoever is on.</span><em data-net-stat="dm"></em><i aria-hidden="true">&rarr;</i></button>
            <button type="button" class="fe-item" data-go="private"><b>Private match</b><span>Make a room, share the code, play with friends.</span><em data-net-stat="rooms"></em><i aria-hidden="true">&rarr;</i></button>
            <button type="button" class="fe-item" data-act="solo"><b>Solo mission</b><span>Cut the three relays and hold the berth. Saltline Terminal.</span><i aria-hidden="true">&rarr;</i></button>
          </nav>
        </section>

        <section class="fe-screen fe-split" data-s="quick" aria-label="Quick play" hidden>
          <div class="fe-col">
            <h2 class="fe-h">Quick play</h2>
            <div class="fe-k" id="fe-q-mode">Mode</div>
            <div class="fe-modes" role="group" aria-labelledby="fe-q-mode" data-fe="q-modes"></div>
            <div class="fe-go"><button type="button" class="fe-cta" data-act="find"><span>Find match</span><small data-fe="q-sub"></small></button><p class="fe-status" role="status"></p></div>
          </div>
          <div class="fe-col">
            <div class="fe-k" id="fe-q-map">Map</div>
            <div class="fe-maps" role="group" aria-labelledby="fe-q-map" data-fe="q-maps"></div>
            <div class="fe-k">Gun</div>
            <div data-fe="gun-slot"></div>
          </div>
        </section>

        <section class="fe-screen fe-split" data-s="team" aria-label="Choose a team" hidden>
          <div class="fe-col fe-team-wide">
            <h2 class="fe-h">Choose a team</h2>
            <p class="fe-lead" data-fe="t-sub"></p>
            <div class="fe-k">Teams</div>
            <div class="fe-teams" data-fe="t-teams"></div>
            <div class="fe-go"><p class="fe-status" role="status"></p></div>
          </div>
          <div class="fe-col">
            <div class="fe-k">Gun</div>
            <div data-fe="gun-slot"></div>
          </div>
        </section>

        <section class="fe-screen fe-split" data-s="private" aria-label="Private match" hidden>
          <div class="fe-col">
            <h2 class="fe-h">Private match</h2>
            <div class="fe-k" id="fe-p-mode">New room</div>
            <div class="fe-modes" role="group" aria-labelledby="fe-p-mode" data-fe="p-modes"></div>
            <div class="fe-go"><button type="button" class="fe-cta" data-act="create"><span>Create room</span><small data-fe="p-sub"></small></button><p class="fe-status" role="status"></p></div>
            <div class="fe-or">Or join with a code</div>
            <form class="fe-join" novalidate><input class="fe-code-in" data-net="code" maxlength="6" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Room code"><button type="submit" class="fe-btn">Join</button></form>
          </div>
          <div class="fe-col">
            <div class="fe-k" id="fe-p-map">Map for the new room</div>
            <div class="fe-maps" role="group" aria-labelledby="fe-p-map" data-fe="p-maps"></div>
          </div>
        </section>

        <section class="fe-screen fe-split" data-s="room" aria-label="Room lobby" hidden>
          <div class="fe-col">
            <h2 class="fe-h">Private match</h2>
            <div class="fe-room-h"><div class="fe-code"><span>Room</span><b data-fe="code"></b><em data-fe="count"></em></div><button type="button" class="fe-btn" data-act="copy">Copy invite</button></div>
            <div class="fe-k" id="fe-r-mode">Mode</div>
            <div class="fe-modes" role="group" aria-labelledby="fe-r-mode" data-fe="r-modes"></div>
            <div class="fe-k" data-fe="r-who">Players</div>
            <div class="fe-teams" data-fe="teams"></div>
            <p class="fe-idle" data-fe="idle"></p>
            <div class="fe-go"><button type="button" class="fe-cta" data-act="join"><span>Join match</span><small data-fe="r-sub"></small></button><p class="fe-status" role="status"></p></div>
          </div>
          <div class="fe-col">
            <div class="fe-k">Map</div>
            <div class="fe-maps one" data-fe="r-map"></div>
            <p class="fe-note">The map is set when the room is made. For another map, make a new room.</p>
            <div class="fe-k">Gun</div>
            <div data-fe="gun-slot"></div>
          </div>
        </section>
      </main>
      <footer class="fe-foot">
        <button type="button" class="fe-btn" data-act="back" hidden><kbd>Esc</kbd>Back</button>
        <button type="button" class="fe-btn" data-act="leave" hidden>Leave room</button>
      </footer>`;
    const $ = s => gate.querySelector(s);
    const nameIn = $('[data-net="name"]'), codeIn = $('[data-net="code"]');
    const allBtns = () => [...gate.querySelectorAll('button, input')].filter(x => x !== nameIn);

    // fullscreen: one button, bottom right, on these screens and on the pause screen. It takes the whole page, so these
    // screens stay on top of the game; the game's own Settings switch exits it the same way
    const fsBtn = document.createElement('button');
    fsBtn.type = 'button'; fsBtn.className = 'net-fs'; fsBtn.hidden = true; fsBtn.setAttribute('aria-pressed', 'false');
    fsBtn.innerHTML = '<svg class="enter" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 5.5V1h4.5M10.5 1H15v4.5M15 10.5V15h-4.5M5.5 15H1v-4.5"/></svg><svg class="exit" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 1v4.5H1M15 5.5h-4.5V1M10.5 15v-4.5H15M1 10.5h4.5V15"/></svg><span>Fullscreen</span>';
    const fsLabel = fsBtn.querySelector('span'), fsRoot = document.documentElement;
    const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
    const fsOk = !!(fsRoot.requestFullscreen || fsRoot.webkitRequestFullscreen) && document.fullscreenEnabled !== false && document.webkitFullscreenEnabled !== false;
    const fsShow = () => { const on = !!fsEl(); fsBtn.classList.toggle('on', on); fsBtn.setAttribute('aria-pressed', String(on)); fsLabel.textContent = on ? 'Exit fullscreen' : 'Fullscreen'; };
    const fsFail = () => { fsLabel.textContent = 'Not available here'; setTimeout(fsShow, 2500); };
    fsBtn.addEventListener('click', ev => {
      ev.stopPropagation();
      try {
        if (fsEl()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
        const r = (fsRoot.requestFullscreen || fsRoot.webkitRequestFullscreen).call(fsRoot); if (r && r.catch) r.catch(fsFail);
      } catch { fsFail(); }
    });
    for (const t of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(t, fsShow);
    const fsWanted = () => fsOk && (!gate.hidden || gameState() === 'paused');

    new MutationObserver(() => { document.documentElement.classList.toggle('net-gate-open', !gate.hidden); if (!gate.hidden) placeShared(); fsBtn.hidden = !fsWanted(); }).observe(gate, { attributes: true, attributeFilter: ['hidden'] });
    // the loading line: a copy of the game's own, shown until the scene is up (see .net-load above)
    const load = document.createElement('div'); load.className = 'net-load'; load.setAttribute('aria-hidden', 'true');
    load.innerHTML = '<div class="boot-sub"></div><div class="boot-bar"><i></i></div>';
    gate.appendChild(load);
    const sceneUp = setInterval(() => {
      const msg = document.getElementById('boot-msg'), fill = document.getElementById('boot-fill');
      if (msg) load.firstChild.textContent = msg.textContent;
      if (fill) load.lastChild.firstChild.style.width = fill.style.width;
      if (window.__ready || window.__fatal) { clearInterval(sceneUp); document.documentElement.classList.add('net-scene'); }
    }, 80);
    /* The update log: what changed in the game and when, newest first. It sits folded at the very bottom of Settings, for
       whoever goes looking. Add a new entry at the top with each release. */
    const UPDATES = [
      ['17 Nov 2026', ['A new front end: Quick play, Private match and Solo mission, each with its own screen', 'Quick play: pick Team deathmatch or Deathmatch, a map and a gun, then Find match', 'Maps are picked from pictures of them seen from above', 'Rooms have a lobby: the code to share, the map, both modes, and who is on which team',
        'Team deathmatch is Red against Blue, and you pick your side: in a room, or after Find match in Quick play', 'In Team deathmatch every helmet is its team\'s colour', 'Fullscreen at the bottom right of every menu screen and of the pause screen', 'Solo: a Main menu button in the pause menu of a mission']],
      ['17 Nov 2026', ['Ten seconds between rounds: the result stays up with a countdown, nobody moves and nobody can be hurt, then everyone starts fresh']],
      ['17 Nov 2026', ['Team play: a team\'s score is always the sum of its players on the board. Kills of players who left now show as their own row, and a player who reloads keeps their kills in one row', 'A fullscreen button at the bottom right of the first screen', 'Alpine: no more wind sound']],
      ['17 Nov 2026', ['Alpine: the middle house on the north side has a stair and an upper floor whose windows look over the street and the back lane', 'Smoke rises from the two burnt houses, signposts point to the piazza, the church and the well, and washing hangs over the alleys']],
      ['16 Nov 2026', ['A third map: Alpine, a war-ruined mountain village under the real Alps', 'Smoother on every map: about a third less work per frame on the harbour and the Colosseum', 'No more freezes the first time you fire, throw a grenade or see another player: everything is prepared while the game loads', 'Older graphics cards start on Medium; your own choice in Settings still wins']],
      ['17 Nov 2026', ['Alpine\'s houses rebuilt: blast holes, collapsed corners, burnt shells and holed roofs, and the solid parts are exactly where they are drawn', 'The Colosseum draws about a quarter fewer objects each frame, with nothing changed on screen', 'Fewer stutters the first time something happens in a match']],
      ['16 Nov 2026', ['A used grenade comes back after 30 seconds, down from two minutes']],
      ['16 Nov 2026', ['A shot at the head of a player who is peeking now counts']],
      ['16 Nov 2026', ['Music has its own volume in Settings, and starts at half', 'Every life starts with its grenades again']],
      ['16 Nov 2026', ['Four seconds on the card when you go down, with a pointer to pick your gun', 'The shotgun carries 64 spare shells']],
      ['16 Nov 2026', ['The shotgun fires four times faster: tap, tap, tap', 'Scope sensitivity has its own slider in Settings', 'Through the scope the mouse wheel zooms in and out']],
      ['16 Nov 2026', ['Two new guns: the PAC-12 Breakwater shotgun and the PAC-98 Lookout sniper rifle, with a scope', 'Choose your gun on the first screen and each time you go down; B picks the gun for your next life', 'Ammo sets at two places on every map: hold the reload key beside one to restock. A new set arrives 90 seconds later', 'Back in the fight 2 seconds after going down, then protected for 5 seconds (it ends when you fire)', 'The card shown when you go down says what hit you, from how far, and whether it was a headshot', 'Every gun reloads by itself after its last round', 'Statues, doorways and scaffolds in the Colosseum stands']],
      ['16 Nov 2026', ['A second map: the Colosseum, with a map choice on the first screen', 'The minimap and grenade markers draw again', 'The first screen stays dark with a loading line until the map is ready']],
      ['13 Nov 2026', ['A new round restarts every player: position, health and ammo', 'Louder voice chat with its own volume setting, and louder enemy footsteps']],
    ];
    const CREDITS = 'Shotgun: "Simple old shotgun" by SuperMopsek (CC BY 4.0). Sniper rifle: "SV-98 | Contract Wars" by xlisov (CC BY-NC 4.0). Ammunition: "Ammo Set" by Guy in a Poncho (CC BY 4.0). All from sketchfab.com. Alpine: wall, roof and ground textures, and the way the grass is drawn, from Valle Morta by Leonxlnx (MIT); the valley is "Alps Field" by Andreas Mischok, polyhaven.com (CC0).';
    const logCss = document.createElement('style');
    logCss.textContent = `.net-log { margin-top: 26px; border-top: 1px solid var(--line, rgba(232,228,218,.2)); padding-top: 12px; }
      .net-log summary { cursor: pointer; font: 500 11px/1 var(--f-mono, monospace); letter-spacing: .14em; text-transform: uppercase; color: var(--bone-faint, rgba(232,228,218,.4)); list-style: none; }
      .net-log summary::-webkit-details-marker { display: none; }
      .net-log summary:hover, .net-log summary:focus-visible, .net-log[open] summary { color: var(--bone-dim, rgba(232,228,218,.64)); outline: none; }
      .net-log h4 { margin: 16px 0 6px; font: 500 11px/1 var(--f-mono, monospace); letter-spacing: .14em; text-transform: uppercase; color: var(--signal, #ffb347); }
      .net-log ul { margin: 0; padding-left: 18px; } .net-log li { margin: 4px 0; font-size: 15px; line-height: 1.35; color: var(--bone-dim, rgba(232,228,218,.64)); }
      .net-perf { position: fixed; left: 12px; bottom: 12px; z-index: 1200; padding: 8px 10px; background: rgba(11,13,15,.82); border: 1px solid var(--line, rgba(232,228,218,.2)); color: #e8e4da; font: 500 11px/1.5 var(--f-mono, monospace); letter-spacing: .04em; white-space: pre; pointer-events: none; }`;
    document.head.appendChild(logCss);
    const logWait = setInterval(() => {
      const pane = document.querySelector('[data-pane="settings"]'); if (!pane) return; clearInterval(logWait);
      const d = document.createElement('details'); d.className = 'net-log';
      d.innerHTML = '<summary>Update log</summary>' + UPDATES.map(([when, items]) => `<h4>${when}</h4><ul>${items.map(t => `<li>${t}</li>`).join('')}</ul>`).join('') + '<h4>Press F3 in a match</h4><ul><li>Shows frames per second and what the game is drawing, for reporting slow machines</li></ul>';
      pane.appendChild(d);
      const keys = document.querySelector('[data-pane="controls"]'); if (keys) { const c = document.createElement('p'); c.className = 'panel-note'; c.textContent = CREDITS; keys.appendChild(c); }
    }, 500);
    /* F3: a small readout of how the game is running on this machine (for players to send when it is slow) */
    let perfEl = null, perfT = [];
    window.addEventListener('keydown', e => {
      if (e.code !== 'F3') return; e.preventDefault();
      if (perfEl) { perfEl.remove(); perfEl = null; return; }
      perfEl = document.createElement('div'); perfEl.className = 'net-perf'; document.body.appendChild(perfEl); perfT = []; let last = performance.now(), shown = 0;
      const gpu = (() => { try { const g = window.__G.renderer.getContext(), x = g.getExtension('WEBGL_debug_renderer_info'); return x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : 'unknown'; } catch { return 'unknown'; } })();
      const tick = now => {
        if (!perfEl) return; perfT.push(now - last); last = now; if (perfT.length > 300) perfT.shift();
        if (now - shown > 500) { shown = now; const t = perfT.slice().sort((a, b) => a - b), avg = t.reduce((a, b) => a + b, 0) / t.length, st = window.__stats ? window.__stats() : {}, q = window.__G && window.__G.quality;
          perfEl.textContent = `${(1000 / avg).toFixed(0)} fps   slowest 1%: ${(1000 / t[Math.floor(t.length * 0.99)]).toFixed(0)} fps\nquality ${q ? q.name : '?'}   ${st.res ? st.res.join(' x ') : '?'}   scale ${st.scale ?? '?'}\n${st.calls ?? '?'} draws   ${st.tris ? (st.tris / 1e6).toFixed(2) + ' M' : '?'} triangles\n${gpu.slice(0, 70)}`; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const talk = document.createElement('div'); talk.className = 'net-talk';

    let count = 0, busy = false, joining = false;
    /* Maps. The game builds one map per page load (see web/maps.js), so playing another reloads the page into it. Picking
       a map card only marks it; the reload comes with Find match (or with joining a room that plays another map). */
    const maps = window.__saltlineMaps || { list: [{ id: 'terminal', name: 'Saltline Terminal' }], id: 'terminal', ready: Promise.resolve('terminal'), name: () => 'Saltline Terminal', choose: () => false };
    const mapId = () => maps.id, loadingText = () => ({ terminal: 'Loading the yard…', alpine: 'Loading the village…' }[mapId()] || 'Loading the arena…');   // a room link learns its map a moment after the page starts, so always ask
    const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    // reload into a map (and a path) without changing the one the player has chosen as theirs
    const visit = (id, path) => maps.choose(id, path, false) || (location.assign(path), true);
    const MAP_INFO = { terminal: 'Container harbour at first light', colosseum: 'Sand floor of a ruined arena', alpine: 'War-torn village under the Alps' };
    const MODE_LIST = [
      { id: 'tdm', name: 'Team deathmatch', blurb: 'Red against Blue. The team with the most kills in five minutes wins.' },
      { id: 'dm', name: 'Deathmatch', blurb: 'Everyone for themselves. Top of the board wins.' },
    ];
    const modeName = id => (MODE_LIST.find(m => m.id === id) || MODE_LIST[0]).name;
    const pick = { mode: store.get('saltline.mode') === 'dm' ? 'dm' : 'tdm', map: mapId(), newMap: mapId(), newMode: store.get('saltline.mode') === 'dm' ? 'dm' : 'tdm', roomMode: 'tdm', roomMap: mapId() };
    let screen = 'home', roomModeSet = false;

    /* The gun to go in with: three cards (web/guns.js draws them and keeps the choice). They are one set, shown on the
       quick play and room screens, and again each time the player goes down, so they are put back whenever a screen shows them. */
    const guns = window.__SALTLINE_GUNS;
    const cur = () => gate.querySelector(`.fe-screen[data-s="${screen}"]`);
    function placeShared() {
      const slot = cur() && cur().querySelector('[data-fe="gun-slot"]');
      if (slot && guns && guns.mount) guns.mount(slot);
    }
    const status = (t, kind) => { const el = cur() && cur().querySelector('.fe-status'); if (!el) return; el.textContent = t || ''; el.className = 'fe-status' + (kind ? ' ' + kind : ''); };
    const setBusy = b => { busy = b; for (const x of allBtns()) x.disabled = b; };
    const CRUMB = { home: '', quick: 'Quick play', team: 'Quick play · Team deathmatch', private: 'Private match', room: 'Room lobby' };
    function show(s) {
      screen = s;
      for (const sec of gate.querySelectorAll('.fe-screen')) sec.hidden = sec.dataset.s !== s;
      $('[data-fe="crumb"]').textContent = CRUMB[s] || '';
      $('[data-act="back"]').hidden = !(s === 'quick' || s === 'private' || s === 'team');
      $('[data-act="leave"]').hidden = s !== 'room';
      for (const sec of gate.querySelectorAll('.fe-status')) { sec.textContent = ''; sec.className = 'fe-status'; }
      paint(); placeShared();
    }
    const showGate = () => {
      const s = session.kind === 'private' ? 'room' : session.kind === 'public' ? (session.mode === 'tdm' ? 'team' : 'quick') : screen === 'room' || screen === 'team' ? 'home' : screen;
      if (screen !== s || gate.hidden) show(s);
      if (!gate.hidden) return;
      gate.hidden = false; setBusy(false);
    };

    // a mode: one row of a single choice
    function modeRows(host, get, set, counts) {
      if (!host.firstChild) for (const m of MODE_LIST) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'fe-mode'; b.dataset.mode = m.id;
        b.innerHTML = '<b></b><em></em><span></span>'; b.querySelector('b').textContent = m.name; b.querySelector('span').textContent = m.blurb;
        b.addEventListener('click', () => { if (busy) return; set(m.id); paint(); });
        host.appendChild(b);
      }
      for (const b of host.children) {
        b.setAttribute('aria-pressed', String(b.dataset.mode === get()));
        const n = counts ? counts[b.dataset.mode] || 0 : 0, em = b.querySelector('em'), t = counts && n ? n + ' playing' : '';
        if (em.textContent !== t) em.textContent = t; em.classList.toggle('live', !!n);
      }
    }
    // a map: its picture from above (web/maps/cards/), the name on a dark fade
    function mapCard(id, onPick) {
      const b = document.createElement(onPick ? 'button' : 'div'); b.className = 'fe-map'; b.dataset.map = id;
      if (onPick) { b.type = 'button'; b.addEventListener('click', () => { if (!busy) { onPick(id); paint(); } }); }
      b.innerHTML = '<img alt="" loading="lazy" decoding="async"><span class="fe-map-tag">Selected</span><span class="fe-map-t"><b></b><small></small></span>';
      b.querySelector('img').src = '/maps/cards/' + id + '.jpg';
      b.querySelector('b').textContent = maps.name(id); b.querySelector('small').textContent = MAP_INFO[id] || '';
      return b;
    }
    function mapCards(host, get, set) {
      if (!host.firstChild) for (const m of maps.list) host.appendChild(mapCard(m.id, set));
      for (const b of host.children) b.setAttribute('aria-pressed', String(b.dataset.map === get()));
    }

    // who is in this room right now, from the room connection (everyone's lobby presence: mode, team, name, kills this round)
    const roundNo = () => Math.floor(Date.now() / 310000);   // the game's rounds: five minutes and a ten-second break
    function people() {
      if (!room) return [];
      return room.peers().map(p => {
        const pr = p.presence || {}, me = !!p.sameTab;
        const n = typeof pr.n === 'string' && pr.n.trim() ? pr.n.trim().slice(0, 16) : me && nameIn.value.trim() ? nameIn.value.trim().slice(0, 16) : 'Breacher';
        return { me, n, m: pr.m === 'dm' || pr.m === 'tdm' || pr.m === 'solo' ? pr.m : '', tm: pr.tm === 0 || pr.tm === 1 ? pr.tm : -1, k: pr.rd === roundNo() ? Math.max(0, pr.k | 0) : 0, c: typeof pr.c === 'string' && /^#[0-9a-f]{6}$/i.test(pr.c) ? pr.c : '' };
      });
    }
    const TEAMS = [{ name: 'Red', css: '#ff4b3e' }, { name: 'Blue', css: '#3f8cff' }];   // the same as the game's (scripts/gun-hooks.mjs, 16)
    function roster(list, css) {   // css: the team colour for every dot; otherwise each player's own
      const ul = document.createElement('ul');
      if (!list.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Nobody in yet'; ul.appendChild(li); return ul; }
      for (const e of list.sort((a, b) => b.k - a.k)) {
        const li = document.createElement('li'), pip = document.createElement('i'), nm = document.createElement('span'), sc = document.createElement('span');
        if (css || e.c) pip.style.background = css || e.c; nm.className = 'nm'; nm.textContent = e.n; sc.className = 'sc'; sc.textContent = e.k + (e.k === 1 ? ' kill' : ' kills');
        li.append(pip, nm);
        if (e.me) { const y = document.createElement('span'); y.className = 'you'; y.textContent = 'You'; li.appendChild(y); }
        li.appendChild(sc); ul.appendChild(li);
      }
      return ul;
    }
    let teamSig = '';
    function paintRoom() {
      const all = people(), ok = room && room.connected();
      const counts = { dm: all.filter(e => e.m === 'dm').length, tdm: all.filter(e => e.m === 'tdm').length };
      modeRows($('[data-fe="r-modes"]'), () => pick.roomMode, v => { pick.roomMode = v; roomModeSet = true; }, counts);
      $('[data-fe="code"]').textContent = session.code || '';
      $('[data-fe="count"]').textContent = ok ? all.length + '/' + MAX : 'Connecting';
      const mapHost = $('[data-fe="r-map"]');
      if (mapHost.dataset.map !== pick.roomMap) { mapHost.dataset.map = pick.roomMap; mapHost.textContent = ''; mapHost.appendChild(mapCard(pick.roomMap, null)); }
      const tdm = pick.roomMode === 'tdm', teams = $('[data-fe="teams"]');
      const sig = [pick.roomMode, ok, busy, all.map(e => [e.n, e.m, e.tm, e.k, e.c, e.me].join(',')).join(';')].join('|');
      if (sig !== teamSig) {
        teamSig = sig; teams.textContent = ''; teams.classList.toggle('ffa', !tdm);
        $('[data-fe="r-who"]').textContent = tdm ? 'Teams' : 'Players';
        if (tdm) teamBoxes(teams, all, ok);
        else teamBox(teams, 'In the match', '', all.filter(e => e.m === 'dm'), false, -1, ok);
        const idle = all.filter(e => !e.me && e.m !== 'dm' && e.m !== 'tdm'), il = $('[data-fe="idle"]'); il.textContent = '';
        if (idle.length) { il.append('In the lobby: '); idle.forEach((e, i) => { const b = document.createElement('b'); b.textContent = e.n; il.append(b, (e.m === 'solo' ? ' (playing solo)' : '') + (i < idle.length - 1 ? ', ' : '')); }); }
        $('[data-fe="r-sub"]').textContent = !ok ? 'Connecting to the room…' : counts.dm ? counts.dm + ' in the match' : 'Start it. Others join when they are ready';
      }
      // Team deathmatch has no Join match: each player picks Red or Blue
      const join = $('[data-act="join"]'); join.hidden = tdm; join.disabled = busy || !ok;
    }
    // one team: its name in its colour, its kills, who is on it, and the button to join it
    function teamBox(host, title, css, list, tdm, team, ok) {
      const d = document.createElement('div'); d.className = 'fe-team' + (list.some(e => e.me) ? ' mine' : '');
      if (css) d.style.setProperty('--team', css);
      const h = document.createElement('div'); h.className = 'fe-team-h';
      const b = document.createElement('b'); b.textContent = title; if (css) b.style.color = css;
      const s = document.createElement('span'); const kills = list.reduce((a, e) => a + e.k, 0);
      s.textContent = tdm ? kills + (kills === 1 ? ' kill' : ' kills') : list.length + (list.length === 1 ? ' player' : ' players');
      h.append(b, s); d.append(h, roster(list, css));
      if (team === 0 || team === 1) { const j = document.createElement('button'); j.type = 'button'; j.className = 'fe-join-team'; j.dataset.team = String(team); j.textContent = 'Join ' + title; j.disabled = busy || !ok; d.appendChild(j); }
      host.appendChild(d);
    }
    function teamBoxes(host, all, ok) {
      for (const i of [0, 1]) teamBox(host, TEAMS[i].name, TEAMS[i].css, all.filter(e => e.m === 'tdm' && e.tm === i), true, i, ok);
    }
    // quick play, Team deathmatch: the open match is found; now the player picks a side
    let pickSig = '';
    function paintTeam() {
      const all = people(), ok = room && room.connected(), host = $('[data-fe="t-teams"]');
      const inIt = all.filter(e => e.m === 'tdm').length;
      $('[data-fe="t-sub"]').textContent = maps.name(mapId()) + ' · ' + (ok ? inIt ? inIt + (inIt === 1 ? ' player' : ' players') + ' in this match' : 'nobody in this match yet' : 'connecting…');
      const sig = [ok, busy, all.map(e => [e.n, e.m, e.tm, e.k, e.c, e.me].join(',')).join(';')].join('|');
      if (sig === pickSig) return;
      pickSig = sig; host.textContent = ''; teamBoxes(host, all, ok);
    }
    function paint() {
      modeRows($('[data-fe="q-modes"]'), () => pick.mode, v => { pick.mode = v; store.set('saltline.mode', v); });
      mapCards($('[data-fe="q-maps"]'), () => pick.map, v => { pick.map = v; });
      $('[data-fe="q-sub"]').textContent = maps.name(pick.map) + ' · ' + modeName(pick.mode);
      modeRows($('[data-fe="p-modes"]'), () => pick.newMode, v => { pick.newMode = v; });
      mapCards($('[data-fe="p-maps"]'), () => pick.newMap, v => { pick.newMap = v; });
      $('[data-fe="p-sub"]').textContent = maps.name(pick.newMap) + ' · ' + modeName(pick.newMode);
      if (screen === 'room') paintRoom();
      if (screen === 'team') paintTeam();
      $('[data-act="solo"] span').textContent = mapId() === 'terminal' ? 'Cut the three relays and hold the berth. Saltline Terminal.' : 'Cut the three relays and hold the berth. Loads Saltline Terminal.';
    }
    const guess = mapId();
    maps.ready.then(v => { if (pick.map === guess) pick.map = v; if (pick.newMap === guess) pick.newMap = v; pick.roomMap = v; paint(); });

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
    // into the match of this room: Deathmatch, or the team the player picked (0 Red, 1 Blue)
    async function joinMatch(mode, team) {
      if (mode !== 'dm' && team !== 0 && team !== 1) return false;
      joining = true;
      const ok = await press(mode === 'dm' ? '.mp-lobby [data-mp="join-dm"]' : `.mp-lobby [data-mp="join-t${team}"]`, 30000);
      joining = false;
      return ok;
    }

    async function quickPlay(mode) {
      if (busy) return;
      store.set('saltline.mode', mode);
      if (session.kind === 'public' && room && session.mode === mode) { // already in a public room for this mode: back into its match
        if (mode === 'tdm') { show('team'); return; }
        setBusy(true); status('Joining the match…', 'busy');
        const ok = await joinMatch(mode);
        if (ok) { gate.hidden = true; status(''); } else status('Could not join. Try again.', 'err');
        setBusy(false);
        return;
      }
      if (session.kind) { visit(mapId(), '/?play=' + mode); return; } // the game connects once per page; start over, on the same map
      setBusy(true); status('Finding a match…', 'busy');
      try {
        const r = await post('/api/quick', { map: mapId(), mode });
        if (!r.ok) throw new Error(String(r.status));
        const { code } = await r.json();
        startRoom(code, 'public'); session.mode = mode;
        if (mode === 'tdm') { // the match is found: show who is on each side and let the player pick one
          setBusy(false); show('team');
          if (room) room.onPeers(() => { if (screen === 'team' && !gate.hidden) paintTeam(); });
          return;
        }
        status(gameState() === 'title' ? 'Joining the match…' : loadingText(), 'busy');
        const ok = await joinMatch(mode);
        if (ok) { gate.hidden = true; status(''); } else status('Could not join. Check your connection and try again.', 'err');
      } catch { joining = false; status('Could not reach the server. Check your connection and try again.', 'err'); }
      setBusy(false);
    }
    function findMatch() {
      if (busy) return;
      if (pick.map !== mapId()) { setBusy(true); status('Loading ' + maps.name(pick.map) + '…', 'busy'); store.set('saltline.mode', pick.mode); maps.choose(pick.map, '/?play=' + pick.mode); return; }
      quickPlay(pick.mode);
    }

    function enterPrivate(code, info) {
      if (session.kind) { location.assign('/r/' + code); return; }
      history.replaceState(null, '', '/r/' + code);
      startRoom(code, 'private');
      if (info && info.mode && !roomModeSet) pick.roomMode = info.mode === 'dm' ? 'dm' : 'tdm';
      show('room');
    }
    async function createRoom() {
      if (busy) return;
      setBusy(true); status('Creating a room…', 'busy');
      try {
        const r = await post('/api/rooms', { map: pick.newMap, mode: pick.newMode });
        if (!r.ok) throw new Error(String(r.status));
        const { code, map, mode } = await r.json();
        if (map && map !== mapId() && maps.list.some(m => m.id === map)) { status('Loading ' + maps.name(map) + '…', 'busy'); visit(map, '/r/' + code); return; } // the room plays another map: load it, then come in
        status('');
        setBusy(false);
        enterPrivate(code, { mode });
        return;
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
        else if (info.map && info.map !== mapId() && maps.list.some(m => m.id === info.map)) { status('Loading ' + maps.name(info.map) + '…', 'busy'); visit(info.map, '/r/' + code); return; } // the room plays another map: load it, then join
        else { status(''); setBusy(false); enterPrivate(code, info); return; }
      } catch { status('Could not reach the server. Check your connection and try again.', 'err'); }
      setBusy(false);
    }
    async function joinFromRoom(team) {
      if (busy || !room) return;
      const mode = screen === 'team' ? 'tdm' : pick.roomMode, repaint = () => (screen === 'team' ? paintTeam() : paintRoom());
      setBusy(true); repaint(); status(gameState() === 'title' ? 'Joining the match…' : loadingText(), 'busy');
      const ok = await joinMatch(mode, team);
      if (ok) { gate.hidden = true; status(''); } else status('Could not join. Check your connection and try again.', 'err');
      setBusy(false); repaint();
    }
    async function solo() {
      if (busy) return;
      if (mapId() !== 'terminal') { setBusy(true); status('Loading Saltline Terminal…', 'busy'); visit('terminal', '/?play=solo'); return; } // the mission is set in the harbour
      if (session.kind === 'public' || session.kind === 'private') { location.assign('/?play=solo'); return; }
      if (!session.kind) { session.kind = 'solo'; resolveRoom(null); }
      setBusy(true);
      await press('.mp-lobby [data-mp="solo"]', 30000); // the game's solo title: difficulty, settings, Deploy
      gate.hidden = true; setBusy(false);
    }
    function back() {
      if (busy || !(screen === 'quick' || screen === 'private' || screen === 'team')) return false;
      if (screen === 'team') { show('quick'); return true; }
      const from = screen; show('home'); const to = gate.querySelector(`[data-go="${from}"]`); if (to && document.activeElement && gate.contains(document.activeElement)) to.focus({ preventScroll: true });
      return true;
    }

    gate.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b || b.disabled) return;
      if (b.dataset.go) { if (busy) return; show(b.dataset.go); const first = cur().querySelector('.fe-mode[aria-pressed="true"]'); if (first && ev.detail === 0) first.focus({ preventScroll: true }); return; }
      if (b.dataset.team) { joinFromRoom(+b.dataset.team); return; }
      const a = b.dataset.act;
      if (a === 'solo') solo();
      else if (a === 'find') findMatch();
      else if (a === 'create') createRoom();
      else if (a === 'join') joinFromRoom(-1);
      else if (a === 'back') back();
      else if (a === 'leave') location.assign('/');
      else if (a === 'copy') {
        const code = session.code;
        (async () => { try { await navigator.clipboard.writeText(location.origin + '/r/' + code); b.textContent = 'Copied'; } catch { b.textContent = code; } setTimeout(() => { b.textContent = 'Copy invite'; }, 1600); })();
      }
    });
    $('.fe-join').addEventListener('submit', ev => { ev.preventDefault(); joinRoom(); });
    for (const inp of [nameIn, codeIn]) for (const t of ['keydown', 'keyup']) inp.addEventListener(t, ev => { if (ev.key !== 'Escape') ev.stopPropagation(); }); // keep typing out of the game
    codeIn.addEventListener('input', () => { codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); status(''); });
    // Esc goes back a screen
    addEventListener('keydown', ev => { if (ev.key === 'Escape' && !gate.hidden && back()) { ev.preventDefault(); ev.stopPropagation(); } }, true);

    // the solo title's "Multiplayer" button opens these screens instead of the game's own room lobby
    addEventListener('click', ev => {
      const b = ev.target.closest && ev.target.closest('[data-mp="to-lobby-title"]');
      if (b) { ev.stopPropagation(); ev.preventDefault(); show(session.kind === 'private' ? 'room' : 'home'); showGate(); }
    }, true);

    // back to the title after a match: bring these screens up in the same tick, not on the next poll
    (function hook() {
      const g = G();
      if (!g || !g.events || typeof g.events.on !== 'function') { setTimeout(hook, 200); return; }
      g.events.on('game:state', e => { if (e && e.state === 'title' && (session.kind === 'public' || session.kind === 'private') && !joining) showGate(); });
    })();

    // /api/online -> { online, dm: {players, matches}, rooms: {players, rooms} }, or null when the server can't be reached
    async function fetchStats() {
      try { const r = await fetch('/api/online', { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; }
    }
    const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

    // live numbers on the first screen: who's online, how many in quick play, how many rooms are going. Every 10 s while up.
    const gateStats = (() => {
      const onlineEl = $('[data-net-stat="online"]'), dmEl = $('[data-net-stat="dm"]'), roomsEl = $('[data-net-stat="rooms"]');
      let at = 0, inflight = false;
      function render(s) {
        if (!s || !s.online) { onlineEl.textContent = ''; dmEl.textContent = ''; roomsEl.textContent = ''; return; }
        onlineEl.textContent = '';
        const live = document.createElement('span'); live.className = 'net-live';
        live.append(document.createElement('i'), s.online + ' online');
        onlineEl.appendChild(live);
        dmEl.textContent = s.dm.players ? plural(s.dm.players, 'player', 'players') + ' in ' + plural(s.dm.matches, 'match', 'matches') : '';
        roomsEl.textContent = s.rooms.rooms ? plural(s.rooms.rooms, 'room', 'rooms') + ' going · ' + plural(s.rooms.players, 'player', 'players') : '';
      }
      return () => {
        if (gate.hidden || inflight || Date.now() - at < 10000) return;
        inflight = true;
        fetchStats().then(s => { render(s); at = Date.now(); inflight = false; });
      };
    })();

    // players in your match, shown under the tally while you play online. Live from the room connection: counts you plus
    // everyone in the same mode (in a private room, players still in the lobby or in the other mode aren't counted).
    const online = (() => {
      const el = document.createElement('div'); el.className = 'net-online'; el.hidden = true;
      el.innerHTML = '<i></i><span><b></b> in this match</span>';
      const numEl = el.querySelector('b');
      const live = p => p && (p.m === 'dm' || p.m === 'tdm') && Array.isArray(p.p);
      function inMatch() {
        if (!room || !room.connected()) return 0;
        const mine = room.mine() || {};
        if (!live(mine)) return 1;
        return room.peers().filter(x => x.sameTab || (live(x.presence) && x.presence.m === mine.m)).length;
      }
      return (show) => {
        const box = document.querySelector('#ui .h-obj');
        show = show && !!box && box.classList.contains('has');
        if (show && el.parentNode !== box) box.appendChild(el);
        if (el.hidden === show) el.hidden = !show;
        if (!show) return;
        const num = String(Math.max(1, inMatch()));
        if (numEl.textContent !== num) numEl.textContent = num;
      };
    })();

    // a few times a second: which overlay belongs on screen, and who is talking
    let talkSig = '';
    // Settings: a "Voice chat volume" slider under the game's Master volume, built from the game's own row and slider
    function voiceRow() {
      if (!voice.supported || document.getElementById('s-voice')) return;
      const after = document.getElementById('s-vol'), row = after && after.closest('.row');
      if (!row) return;
      const r = document.createElement('div'); r.className = 'row';
      r.innerHTML = '<label for="s-voice">Voice chat volume</label><div class="slider"><input id="s-voice" type="range" min="0" max="' + voice.maxVolume * 100 + '" step="5"><output></output></div>';
      const input = r.querySelector('input'), o = r.querySelector('output');
      const show = () => { o.textContent = Math.round(voice.volume * 100) + '%'; };
      input.value = String(Math.round(voice.volume * 100)); show();
      input.addEventListener('input', () => { voice.setVolume(+input.value / 100); show(); });
      row.after(r);
    }
    setInterval(() => {
      voiceRow();
      const st = gameState(), onTitle = st === 'title';
      // after a quick-play match the game drops back to its title: this screen is home
      if ((session.kind === 'public' || session.kind === 'private') && onTitle && !joining) showGate();
      if (fsBtn.hidden === fsWanted()) fsBtn.hidden = !fsWanted();
      if (screen === 'room' && !gate.hidden) paintRoom();
      if (screen === 'team' && !gate.hidden) paintTeam();
      // solo: the way back to these screens. The solo title's "Multiplayer" button says where it goes, and the pause menu of a
      // mission gets a Main menu button (a fresh page, so nothing of the mission carries over)
      const toMenu = document.querySelector('[data-mp="to-lobby-title"]');
      if (toMenu && toMenu.textContent !== 'Main menu') toMenu.textContent = 'Main menu';
      const pauseActs = session.kind === 'solo' && document.querySelector('#ui [data-s="paused"] .m-actions');
      if (pauseActs && !pauseActs.querySelector('[data-net-menu]')) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.dataset.netMenu = '1'; b.textContent = 'Main menu';
        b.addEventListener('click', ev => { ev.stopPropagation(); location.assign('/'); });
        pauseActs.appendChild(b);
      }
      const room = document.querySelector('[data-net-room]');
      const roomText = session.code && session.kind !== 'dead' ? (session.kind === 'public' ? 'Open match' : 'Room ' + session.code) + ' · ' + maps.name(mapId()) : 'Online room';
      if (room && room.textContent !== roomText) room.textContent = roomText;
      online((session.kind === 'public' || session.kind === 'private') && (st === 'playing' || st === 'paused'));
      gateStats();
      const names = st === 'playing' || st === 'paused' || onTitle ? voice.tick() : [];
      const sig = names.join('|');
      if (sig !== talkSig) {
        talkSig = sig; talk.textContent = '';
        for (const n of names) { const d = document.createElement('div'); d.append(document.createElement('i'), n); talk.appendChild(d); }
      }
    }, 250);

    function mount() {
      document.body.append(gate, fsBtn, talk);
      const path = location.pathname.match(/^\/r\/([A-Za-z0-9]{6})\/?$/);
      const code = path ? path[1].toUpperCase() : '';
      const play = new URLSearchParams(location.search).get('play');
      if (CODE_RE.test(code)) {
        startRoom(code, 'private');
        show('room'); gate.hidden = false;
        if (room) room.onPeers(() => { if (screen === 'room' && !gate.hidden) paintRoom(); });
        // maps.js already asked this room for its map before the game started; if that answer came too late, load the right map now
        Promise.all([fetch('/api/rooms/' + code).then(r => r.json()), maps.ready]).then(([info, now]) => {
          if (info && info.exists && info.map && info.map !== now && maps.list.some(m => m.id === info.map)) { visit(info.map, '/r/' + code); return; }
          if (info && info.mode && !roomModeSet) { pick.roomMode = info.mode === 'dm' ? 'dm' : 'tdm'; paint(); }
        }).catch(() => {});
        return;
      }
      if (location.search) history.replaceState(null, '', '/');
      if (play === 'dm' || play === 'tdm') { pick.mode = play; show('quick'); gate.hidden = false; quickPlay(play); }
      else if (play === 'solo') { show('home'); gate.hidden = false; solo(); }
      else { show('home'); gate.hidden = false; }
    }
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

    return {
      count(n) { if (n !== count) { count = n; if (screen === 'room' && !gate.hidden) paintRoom(); } },
      fatal(why) {
        const { code, kind } = session, mode = session.mode || 'dm';
        session.kind = 'dead'; session.code = '';
        if (kind === 'public') { // the open match filled up between finding it and joining: find another
          if (quickTry < 3) { visit(mapId(), '/?play=' + mode + '&try=' + (quickTry + 1)); return; }
          show('quick'); gate.hidden = false; status('Every open match filled up just now. Try again.', 'err');
          return;
        }
        history.replaceState(null, '', '/');
        show('private'); gate.hidden = false; setBusy(false);
        codeIn.value = code;
        status(why === 'full' ? `Room ${code} is full (${MAX} players).` : why === 'not_found' ? `No room ${code}. It may have expired.` : 'Could not join that room.', 'err');
      },
    };
  })();
})();
