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

      /* players online: a line under the match tally in the objective box */
      .net-online { display: flex; align-items: center; gap: 7px; margin-top: 7px; font: 600 11px/1 var(--f-label, sans-serif); letter-spacing: .22em;
        text-transform: uppercase; color: rgba(232, 228, 218, .72); text-shadow: var(--shadow); }
      .net-online[hidden] { display: none; }
      .net-online i { width: 6px; height: 6px; border-radius: 50%; background: var(--signal, #ffb347); animation: net-pulse 2.4s ease-in-out infinite; }
      .net-online b { font-weight: 600; color: var(--bone, #e8e4da); }

      /* live numbers on the first screen */
      .net-live { display: inline-flex; align-items: center; gap: 8px; color: var(--bone, #e8e4da); }
      .net-live i { width: 7px; height: 7px; border-radius: 50%; background: var(--signal, #ffb347); animation: net-pulse 2.4s ease-in-out infinite; }
      .net-mode em { grid-column: 1; margin-top: 4px; font: 500 11px/1.2 var(--f-mono, monospace); font-style: normal; letter-spacing: .12em; text-transform: uppercase; color: var(--signal, #ffb347); }
      .net-mode em:empty { display: none; }
      /* map: the game's own segmented control, as on its settings panel */
      .net-map { display: grid; gap: 8px; margin-top: 16px; }
      /* the guns: beside the menu where there is room, under it where there is not */
      .net-guns { display: grid; gap: 12px; width: min(980px, 54vw); margin-left: auto; padding-left: 28px; margin-right: max(0px, 2vw); }
      .net-guns[hidden] { display: none; }
      @media (max-width: 1100px) { .net-gate { flex-wrap: wrap; align-content: center; gap: 22px; } .net-guns { width: 100%; max-width: 460px; margin: 0; } }
      .net-map[hidden] { display: none; }
      .net-map .seg button { min-height: 36px; font-size: 12px; background: rgba(11, 13, 15, .45); }
      .net-map .seg button[aria-pressed="true"] { background: var(--bone, #e8e4da); }
      .net-map .seg button:disabled { opacity: .6; cursor: default; }

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
      @media (prefers-reduced-motion: reduce) { #view, .net-load { transition: none; } }
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
        <div class="net-eyebrow"><span class="tag">B4</span><span data-net-stat="online">Up to 10 players a match</span></div>
        <h1 class="net-word">SALTLINE</h1>
        <label class="net-name"><span>Your name</span><input class="net-in" data-net="name" maxlength="16" placeholder="Breacher" autocomplete="off" spellcheck="false"></label>
        <div class="net-map" hidden><span class="net-k" id="net-map-l">Map</span><div class="seg" role="group" aria-labelledby="net-map-l"></div></div>
        <div class="net-modes">
          <button type="button" class="net-mode lead" data-net="dm"><b>Deathmatch</b><span>Jump into an open match. Everyone for themselves.</span><em data-net-stat="dm"></em><i>&rarr;</i></button>
          <button type="button" class="net-mode" data-net="room" aria-expanded="false"><b>Room</b><span>Play with friends. Make a room and share the code.</span><em data-net-stat="rooms"></em><i>+</i></button>
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
      </div>
      <div class="net-guns" hidden><span class="net-k">Gun</span><div data-net="guns"></div></div>`;
    const $ = s => gate.querySelector(s);
    const nameIn = $('[data-net="name"]'), codeIn = $('[data-net="code"]'), roomForm = $('.net-room'), roomBtn = $('[data-net="room"]'), statusEl = $('.net-status');
    const allBtns = () => [...gate.querySelectorAll('button')];

    new MutationObserver(() => { document.documentElement.classList.toggle('net-gate-open', !gate.hidden); showGuns(); }).observe(gate, { attributes: true, attributeFilter: ['hidden'] });
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
      ['16 Nov 2026', ['The shotgun fires four times faster: tap, tap, tap', 'Scope sensitivity has its own slider in Settings', 'Through the scope the mouse wheel zooms in and out']],
      ['16 Nov 2026', ['Two new guns: the PAC-12 Breakwater shotgun and the PAC-98 Lookout sniper rifle, with a scope', 'Choose your gun on the first screen and each time you go down; B picks the gun for your next life', 'Ammo sets at two places on every map: hold the reload key beside one to restock. A new set arrives 90 seconds later', 'Back in the fight 2 seconds after going down, then protected for 5 seconds (it ends when you fire)', 'The card shown when you go down says what hit you, from how far, and whether it was a headshot', 'Every gun reloads by itself after its last round', 'Statues, doorways and scaffolds in the Colosseum stands']],
      ['16 Nov 2026', ['A second map: the Colosseum, with a map choice on the first screen', 'The minimap and grenade markers draw again', 'The first screen stays dark with a loading line until the map is ready']],
      ['13 Nov 2026', ['A new round restarts every player: position, health and ammo', 'Louder voice chat with its own volume setting, and louder enemy footsteps']],
    ];
    const CREDITS = 'Shotgun: "Simple old shotgun" by SuperMopsek (CC BY 4.0). Sniper rifle: "SV-98 | Contract Wars" by xlisov (CC BY-NC 4.0). Ammunition: "Ammo Set" by Guy in a Poncho (CC BY 4.0). All from sketchfab.com.';
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
    const badge = document.createElement('div'); badge.className = 'net-badge'; badge.hidden = true;
    const talk = document.createElement('div'); talk.className = 'net-talk';

    let count = 0, busy = false, joiningDm = false;
    /* Maps. The game builds one map per page load (see web/maps.js), so picking another reloads the page into it.
       Quick play and new rooms use the map on screen; a room keeps its map, and joining one loads that map first. */
    const maps = window.__saltlineMaps || { list: [{ id: 'terminal', name: 'Saltline Terminal' }], id: 'terminal', ready: Promise.resolve('terminal'), name: () => 'Saltline Terminal', choose: () => false };
    const mapId = () => maps.id, loadingText = () => (mapId() === 'terminal' ? 'Loading the yard…' : 'Loading the arena…');   // a room link learns its map a moment after the page starts, so always ask
    const post = path => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ map: mapId() }) });
    // reload into a map (and a path) without changing the one the player has chosen as theirs
    const visit = (id, path) => maps.choose(id, path, false) || (location.assign(path), true);
    /* The gun to go in with: three cards beside the menu (web/guns.js draws them and keeps the choice). The same cards
       are shown again each time the player goes down. They are one set, so they are put back here whenever this screen returns. */
    const guns = window.__SALTLINE_GUNS, gunBox = $('.net-guns'), gunHost = $('[data-net="guns"]');
    const showGuns = () => { if (guns && guns.mount && !gate.hidden) { gunBox.hidden = false; guns.mount(gunHost, 'big'); } };
    const mapBox = $('.net-map'), mapSeg = mapBox.querySelector('.seg');
    if (maps.list.length > 1) {
      mapBox.hidden = false;
      for (const m of maps.list) { const b = document.createElement('button'); b.type = 'button'; b.dataset.map = m.id; b.textContent = m.name; mapSeg.appendChild(b); }
      const paint = () => { for (const x of mapSeg.children) x.setAttribute('aria-pressed', String(x.dataset.map === mapId())); $('[data-net="solo"] span').textContent = mapId() === 'terminal' ? 'The mission. Cut the relays and hold the berth.' : 'The mission, on Saltline Terminal.'; };
      paint(); maps.ready.then(paint);
      mapSeg.addEventListener('click', ev => {
        const b = ev.target.closest('button[data-map]'); if (!b || b.disabled || busy || b.dataset.map === mapId()) return;
        for (const x of mapSeg.children) x.setAttribute('aria-pressed', String(x === b));
        setBusy(true); status('Loading ' + maps.name(b.dataset.map) + '…', 'busy');
        maps.choose(b.dataset.map, '/');
      });
    }
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
      if (session.kind) { visit(mapId(), '/?play=dm'); return; } // the game connects once per page; start over, on the same map
      setBusy(true); status('Finding a match…', 'busy');
      try {
        const r = await post('/api/quick');
        if (!r.ok) throw new Error(String(r.status));
        const { code } = await r.json();
        startRoom(code, 'public');
        status(gameState() === 'title' ? 'Joining the match…' : loadingText(), 'busy');
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
        const r = await post('/api/rooms');
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
        else if (info.map && info.map !== mapId() && maps.list.some(m => m.id === info.map)) { status('Loading ' + maps.name(info.map) + '…', 'busy'); visit(info.map, '/r/' + code); return; } // the room plays another map: load it, then join
        else { status(''); enterPrivate(code); }
      } catch { status('Could not reach the server. Check your connection and try again.', 'err'); }
      setBusy(false);
    }
    async function solo() {
      if (busy) return;
      if (mapId() !== 'terminal') { setBusy(true); status('Loading Saltline Terminal…', 'busy'); visit('terminal', '/?play=solo'); return; } // the mission is set in the harbour
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

    // /api/online -> { online, dm: {players, matches}, rooms: {players, rooms} }, or null when the server can't be reached
    async function fetchStats() {
      try { const r = await fetch('/api/online', { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; }
    }
    const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

    // live numbers on the first screen: who's online, how many in Deathmatch, how many rooms are going.
    // Refreshed every 10 s while the screen is up.
    const gateStats = (() => {
      const onlineEl = $('[data-net-stat="online"]'), dmEl = $('[data-net-stat="dm"]'), roomsEl = $('[data-net-stat="rooms"]');
      const fallback = onlineEl.textContent;
      let at = 0, inflight = false;
      function render(s) {
        if (!s || !s.online) { onlineEl.textContent = fallback; dmEl.textContent = ''; roomsEl.textContent = ''; return; }
        onlineEl.textContent = '';
        const live = document.createElement('span'); live.className = 'net-live';
        live.append(document.createElement('i'), s.online + ' online now');
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
      if (session.kind === 'public' && onTitle && !joiningDm) showGate();
      const showBadge = session.kind === 'private' && onTitle && gate.hidden;
      if (badge.hidden === showBadge) badge.hidden = !showBadge;
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
      document.body.append(gate, badge, talk);
      const path = location.pathname.match(/^\/r\/([A-Za-z0-9]{6})\/?$/);
      const code = path ? path[1].toUpperCase() : '';
      const play = new URLSearchParams(location.search).get('play');
      if (CODE_RE.test(code)) {
        startRoom(code, 'private'); renderBadge();
        // maps.js already asked this room for its map before the game started; if that answer came too late, load the right map now
        Promise.all([fetch('/api/rooms/' + code).then(r => r.json()), maps.ready]).then(([info, now]) => { if (info && info.exists && info.map && info.map !== now && maps.list.some(m => m.id === info.map)) visit(info.map, '/r/' + code); }).catch(() => {});
        return;
      }
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
          if (quickTry < 3) { visit(mapId(), '/?play=dm&try=' + (quickTry + 1)); return; }
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
