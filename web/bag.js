/* Saltline's bag: what a player carries in a match, and the guns left on the ground.

   A player carries two things, a gun and the knife to start with. Going down drops every gun they had (never the
   knife) where they fell; anyone can walk up to a gun on the ground and hold the pick-up key (G) to take it in exchange
   for what is in their hands, which goes down in its place. So a player may end up with two guns, two of the same gun,
   or two knives. B opens the bag, a drawer at the bottom right: the two things in their order (1 and 2), dragged up or
   down (or the arrow keys) to change which is which.

   Ammunition belongs to the kind of gun: the spare rounds for every rifle a player carries are one pool, so two rifles
   share it and each keeps only what is in its own magazine. A gun on the ground carries the rounds in it and its share
   of the spare: all of it when it was its owner's last gun of that kind, half when another stays with them.

   The room keeps the list of what is on the ground and decides who gets what (src/worker.js): the first take of an item
   wins. A gun lies there for a minute, blinking through its last five seconds, and a new round clears them. Only in a
   match with other players (Deathmatch, Team deathmatch); solo play keeps the game's own rifle-and-knife.

   The game reaches this file through scripts/bag-hooks.mjs, and the window objects those hooks make:
     __SALTLINE_KNIFE  set(on), on, busy     the knife in the hands (the multiplayer layer's own)
     __SALTLINE_KB     code(id), name(id)    the keys from Settings > Controls ('pickup', 'bag', 'swap')
     __SALTLINE_KIT    knife(), rifle()      models for the ground: the knife, the rifle as other players carry it
     __SALTLINE_ICONS                        the kill feed's silhouettes, for the drawer and the panel
     __SALTLINE_MATCH  live, mode, round, alive, peer
   For the rest of the page and the checks:  window.__SALTLINE_BAG                                                  */
(() => {
  'use strict';
  const TTL = 60000, BLINK = 5000, REACH = 1.6, HOLD = 0.45, SETTLE = 6000, KEEP = 'saltline.bag', KEEP_MS = 10 * 60 * 1000;
  const KINDS = ['rifle', 'shotgun', 'sniper'];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const still = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const isGun = it => !!it && KINDS.includes(it.g);

  let G = null, room = null;
  const M = () => window.__SALTLINE_MATCH || null, K = () => window.__SALTLINE_KNIFE || null, GUNS = () => window.__SALTLINE_GUNS || null;
  const W = () => (G && G.weapon) || null, P = () => (G && G.player) || null;
  const keyCode = id => { const kb = window.__SALTLINE_KB; return kb ? kb.code(id) : ({ pickup: 'KeyG', bag: 'KeyB', swap: 'KeyX' })[id]; };
  const keyName = id => { const kb = window.__SALTLINE_KB; const n = kb ? kb.name(id) : ({ pickup: 'G', bag: 'B', swap: 'X' })[id]; return n || ''; };
  const nameOf = g => (g === 'knife' ? 'Knife' : GUNS() ? GUNS().name(g) : g);
  const shortOf = g => (g === 'knife' ? 'Knife' : GUNS() ? GUNS().short(g) : g);
  const iconOf = g => { const I = window.__SALTLINE_ICONS || {}; return I[g] || I.rifle || ''; };
  const defOf = g => { const w = W(); return w && w.rigs[g] ? w.rigs[g].def : { magSize: 0, reserve: 0 }; };

  /* ------------------------------------------------------------------ what this player carries */
  const bag = {
    slots: [],        // [{ g, m }] in order: 1 and 2. m: rounds in that gun's magazine
    held: 0,          // which slot is in the hands
    pool: { rifle: 0, shotgun: 0, sniper: 0 },   // spare rounds, by kind of gun
    loaded: -1,       // the slot whose rounds are in its gun's magazine in the game (one magazine per kind of gun there)
    want: -1,         // a slot waiting for the draw of a gun of the kind already out
    dead: false,      // gone down: nothing more until the next spawn
    active: false,    // set up for this life in a match
    pending: null,    // a take sent, its answer not back: { id, i, it, put, t0, dead?, stale? }
  };
  const on = () => !!(bag.active && M() && M().live && W());
  const alive = () => !!(M() && M().alive && P() && P().enabled !== false && G.game && G.game.state === 'playing');

  // the magazine and spare in the game, read back into the slot they belong to
  function save() {
    const w = W(); if (!w || bag.loaded < 0) return;
    const it = bag.slots[bag.loaded]; if (!isGun(it) || w.current !== it.g) return;
    const s = w.rigs[it.g].slot; it.m = s.ammo; bag.pool[it.g] = s.reserve;
  }
  // a slot's rounds into its gun in the game
  function load(i) {
    const w = W(), it = bag.slots[i]; if (!w || !isGun(it)) return;
    const r = w.rigs[it.g]; r.slot.ammo = it.m; r.slot.reserve = bag.pool[it.g];
    w.primary = it.g; w.slots[0] = r.slot; bag.loaded = i;
  }
  // the spare rounds of every kind into the game's guns (each kind has one there), so whatever is drawn reads the pool
  function mirror() { const w = W(); if (!w) return; for (const g of KINDS) if (w.rigs[g]) w.rigs[g].slot.reserve = bag.pool[g]; }
  function fresh(g) {
    if (!KINDS.includes(g)) g = 'rifle';
    bag.slots = [{ g, m: defOf(g).magSize }, { g: 'knife', m: 0 }]; bag.held = 0; bag.loaded = -1; bag.want = -1;
    bag.pool = { rifle: 0, shotgun: 0, sniper: 0 }; bag.pool[g] = defOf(g).reserve;
  }

  /* The hands, made to match the slot held. anim: draw a gun with the game's own holster and draw; otherwise it just
     appears (behind the knife, or at a spawn). */
  function apply(anim) {
    const w = W(), kn = K(); if (!w || !kn) return;
    const it = bag.slots[bag.held], other = bag.slots[1 - bag.held];
    if (!isGun(it)) {
      // the knife: the gun behind it is the other slot's, ready for the next swap
      if (isGun(other)) { if (bag.loaded !== 1 - bag.held || w.current !== other.g) { save(); if (w.current !== other.g) try { w.equip(other.g); } catch { /* fine */ } load(1 - bag.held); } }
      kn.set(true); return;
    }
    if (kn.on || !anim) {
      save(); if (w.current !== it.g) try { w.equip(it.g); } catch { /* fine */ }
      load(bag.held); bag.want = -1; kn.set(false); return;
    }
    save();
    if (w.pending) {                 // a switch already under way: the game's own switch is sent to this gun instead
      if (w.current !== it.g) { load(bag.held); bag.want = -1; } else bag.want = bag.held;
      try { w.switchTo(it.g); } catch { /* the frame puts it right */ }
      return;
    }
    if (w.current !== it.g) { load(bag.held); bag.want = -1; try { w.switchTo(it.g); } catch { try { w.equip(it.g); } catch { /* fine */ } } return; }
    // the same kind of gun as the one out: put it away and draw it again; its rounds go in once it is out of sight
    bag.want = bag.held;
    let drew = false; try { drew = !!(w.redraw && w.redraw()); } catch { drew = false; }
    if (!drew && !w.pending) { load(bag.held); bag.want = -1; }
  }
  function select(i) {
    if (!on() || !alive() || bag.pending || bag.dead || !bag.slots[i]) return false;
    const kn = K(); if (!kn || kn.busy) return false;
    const it = bag.slots[i], showing = isGun(it) ? !kn.on && bag.loaded === i && W().current === it.g && bag.want < 0 : kn.on;
    if (i === bag.held && showing) return false;
    save(); bag.held = i; apply(true); keep(); return true;
  }

  /* ------------------------------------------------------------------ keeping it across a reload (this tab, this room, this round) */
  function keep() {
    const m = M(); if (!bag.active || bag.dead || !m || !room) return;
    save();
    try { sessionStorage.setItem(KEEP, JSON.stringify({ code: room.code, peer: m.peer, rd: m.round, md: m.mode, slots: bag.slots, held: bag.held, pool: bag.pool, t: Date.now() })); } catch { /* private mode: a reload starts fresh */ }
  }
  const forget = () => { try { sessionStorage.removeItem(KEEP); } catch { /* fine */ } };
  function restore() {
    const m = M(); if (!m || !room) return false;
    let k = null; try { k = JSON.parse(sessionStorage.getItem(KEEP) || 'null'); } catch { k = null; }
    if (!k || k.code !== room.code || k.peer !== m.peer || k.rd !== m.round || k.md !== m.mode || !(Date.now() - k.t < KEEP_MS)) return false;
    if (!Array.isArray(k.slots) || k.slots.length !== 2) return false;
    const slots = k.slots.map(s => (s && (KINDS.includes(s.g) || s.g === 'knife') ? { g: s.g, m: s.g === 'knife' ? 0 : clamp(s.m | 0, 0, defOf(s.g).magSize) } : null));
    if (slots.some(s => !s)) return false;
    bag.slots = slots; bag.held = k.held === 1 ? 1 : 0; bag.loaded = -1; bag.want = -1;
    bag.pool = { rifle: 0, shotgun: 0, sniper: 0 }; for (const g of KINDS) bag.pool[g] = clamp((k.pool && k.pool[g]) | 0, 0, 9999);
    return true;
  }

  /* ------------------------------------------------------------------ the ground */
  const ground = new Map();    // id -> { it, obj, built, glint }
  let groundRoot = null, ringMesh = null, T = null, glintMat = null;
  const GLINT_FAR = 25, GLINT_FADE = 18;      // every gun on the ground glints, faintly, out to 25 m: a gun in the shade is a dark shape otherwise
  function glintMaterial() {
    if (glintMat) return glintMat;
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const core = x.createRadialGradient(32, 32, 0, 32, 32, 30); core.addColorStop(0, 'rgba(255,248,232,1)'); core.addColorStop(0.18, 'rgba(255,226,170,.75)'); core.addColorStop(0.5, 'rgba(255,190,110,.12)'); core.addColorStop(1, 'rgba(255,190,110,0)');
    x.fillStyle = core; x.fillRect(0, 0, 64, 64);
    for (const [w, h] of [[60, 2.2], [2.2, 60]]) { const g = x.createRadialGradient(32, 32, 0, 32, 32, 30); g.addColorStop(0, 'rgba(255,244,220,.9)'); g.addColorStop(1, 'rgba(255,244,220,0)'); x.fillStyle = g; x.fillRect(32 - w / 2, 32 - h / 2, w, h); }      // four short rays: a glint, not a lamp
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
    glintMat = new T.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, depthWrite: false, depthTest: true, blending: T.AdditiveBlending, opacity: 0.6 });
    return glintMat;
  }
  const templates = {};        // kind -> { group, lift } (a model lying on its side, its lowest point at 0)
  function template(g) {
    if (templates[g]) return templates[g];
    const kit = window.__SALTLINE_KIT; if (!kit || !T) return null;
    let src = null;
    try {
      if (g === 'knife') src = kit.knife();
      else if (g === 'rifle') src = kit.rifle();
      else {
        const r = W() && W().rigs[g]; if (!r || !r.info || !r.info.meshes) return null;        // its model is still on the way
        src = new T.Group(); let n = 0;
        r.root.traverse(o => { if (!o.isMesh || !o.material || !o.material.isMeshStandardMaterial || o === r.flash) return; const m = new T.Mesh(o.geometry, o.material); m.castShadow = n < 2; if (o.parent && o.parent !== r.root && o.parent !== r.model) { m.position.copy(o.parent.position); m.quaternion.copy(o.parent.quaternion); } src.add(m); n++; });
        if (!n) return null;
      }
    } catch (e) { console.error('[bag] model ' + g + ': ' + e); return null; }
    if (!src) return null;
    // on its side: the right side up, the muzzle along the drop's own direction, a slight tilt as a gun rests on its grip
    const group = new T.Group(), body = new T.Group(); body.add(src);
    body.rotation.set(0, 0, g === 'knife' ? Math.PI / 2 : -Math.PI / 2 + 0.06);
    src.traverse(o => { if (o.isMesh) { o.layers.set(0); o.frustumCulled = true; o.castShadow = true; o.receiveShadow = false; } });     // layer 0: the world. Layer 1 is the gun pass, drawn over everything
    group.add(body); group.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(group), lift = -box.min.y + 0.004;
    body.position.y = lift; body.position.z = -(box.min.z + box.max.z) / 2;     // centred on the spot along its length
    return (templates[g] = { group, size: box.getSize(new T.Vector3()) });
  }
  function build(e) {
    const t = template(e.it.g); if (!t) return false;
    const obj = t.group.clone(true); obj.position.set(e.it.x, e.it.y, e.it.z); obj.rotation.y = e.it.yw;
    obj.name = 'drop:' + e.it.id; obj.userData.drop = e.it.id;
    const glint = new T.Sprite(glintMaterial().clone()); glint.position.set(0, Math.min(0.16, t.size.y + 0.07), 0); glint.renderOrder = 3; glint.layers.set(0); glint.userData.phase = Math.random() * 6.28;
    obj.add(glint); e.glint = glint;
    groundRoot.add(obj); e.obj = obj; e.built = true; return true;
  }
  function ensureRoot() {
    if (groundRoot || !G || !G.scene) return !!groundRoot;
    T = G.THREE; groundRoot = new T.Group(); groundRoot.name = 'bag-ground'; G.scene.add(groundRoot);
    // the ring under the gun the pick-up would take
    const geo = new T.RingGeometry(0.27, 0.33, 40); geo.rotateX(-Math.PI / 2);
    ringMesh = new T.Mesh(geo, new T.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false }));
    ringMesh.visible = false; ringMesh.renderOrder = 2; groundRoot.add(ringMesh);
    return true;
  }
  function addItem(it) {
    if (!it || typeof it.id !== 'string' || ground.has(it.id)) return;
    ground.set(it.id, { it, obj: null, built: false });
  }
  function removeItem(id) {
    const e = ground.get(id); if (!e) return;
    if (e.glint) { e.glint.material.dispose(); e.glint = null; }
    if (e.obj && e.obj.parent) e.obj.parent.remove(e.obj);
    ground.delete(id);
  }
  function clearGround() { for (const id of [...ground.keys()]) removeItem(id); if (ringMesh) ringMesh.visible = false; }
  const serverNow = () => (room && room.serverNow ? room.serverNow() : Date.now());
  const left = it => it.at + TTL - serverNow();
  const here = it => { const m = M(); return !!(m && m.live && it.md === m.mode && it.rd === m.round); };

  function onDrops(d) {
    if (!d) return;
    if (Array.isArray(d.list)) {
      const keepIds = new Set(d.list.map(x => x.id));
      for (const id of [...ground.keys()]) if (!keepIds.has(id)) removeItem(id);
      for (const it of d.list) addItem(it);
      // an answer lost on the way (a reconnect, a refused message): the list says how the swap went
      // (the take went before any list asked for after it, on the same connection; a hello comes on a new one, and a
      // take sent on the old one either went through, leaving its put marked with us, or was lost)
      const p = bag.pending;
      if (p && (d.hello || p.asked)) settle(!!d.list.find(x => x.of === p.id && x.tk === (M() && M().peer)), p.it);
    }
    if (d.took) {
      removeItem(d.took.id);
      const p = bag.pending; if (p && p.id === d.took.id) settle(d.took.by === (M() && M().peer), d.took.item);
    }
    if (Array.isArray(d.add)) for (const it of d.add) addItem(it);
    if (d.fail) { const p = bag.pending; if (p && p.id === d.fail) settle(false); }
  }

  /* ------------------------------------------------------------------ going down: every gun to the ground */
  const _v = {}; let rayO = null, rayD = null;
  function floorAt(x, y, z) {
    const ph = G.physics; if (!ph || !ph.raycast) return y;
    rayO = rayO || new T.Vector3(); rayD = rayD || new T.Vector3();
    try {
      // like a grenade: the ray starts up to 60 cm up but never above a ceiling, and finds what is under it
      const ce = ph.raycast(rayO.set(x, y + 0.05, z), rayD.set(0, 1, 0), 0.6), lift = ce ? Math.max(0, ce.dist - 0.02) : 0.6;
      const dn = ph.raycast(rayO.set(x, y + 0.05 + lift, z), rayD.set(0, -1, 0), lift + 60);
      return dn ? dn.point.y : y;
    } catch { return y; }
  }
  function clearTo(x, y, z, dx, dz, d) {
    const ph = G.physics; if (!ph || !ph.raycast) return true;
    try { const h = ph.raycast(rayO.set(x, y + 0.3, z), rayD.set(dx, 0, dz), d + 0.12); return !h; } catch { return true; }
  }
  // where n things land around a spot: side by side across the way the player faced, far enough apart to pick either
  function spots(x, y, z, yaw, n) {
    if (n <= 1) return [[x, z, yaw]];
    const sx = Math.cos(yaw), sz = -Math.sin(yaw), fx = -Math.sin(yaw), fz = -Math.cos(yaw), D = 0.34;
    const tries = [[sx, sz], [-sx, -sz], [fx, fz], [-fx, -fz]], out = [];
    for (const [dx, dz] of tries) { if (out.length >= n) break; if (clearTo(x, y, z, dx, dz, D)) out.push([x + dx * D, z + dz * D, yaw + (out.length ? 0.35 : -0.25)]); }
    while (out.length < n) out.push([x, z, yaw + out.length * 0.6]);
    return out;
  }
  function share(i) {           // the spare rounds that go with slot i's gun when it leaves this player
    const it = bag.slots[i]; if (!isGun(it)) return 0;
    const same = bag.slots.filter((s, k) => k !== i && s && s.g === it.g && !(bag.pending && k === bag.pending.i && bag.dead)).length;
    return same ? Math.floor(bag.pool[it.g] / 2) : bag.pool[it.g];
  }
  function died() {
    if (!on() || bag.dead) return;
    save(); forget(); closeDrawer();
    const p = P(), m = M(); bag.dead = true;
    if (!room || !p || !p.pos) return;
    ensureRoot();
    const x = p.pos.x, y = p.pos.y, z = p.pos.z, yaw = p.yaw || 0;
    const fy = floorAt(x, y, z);
    if (bag.pending) bag.pending.dead = { x, y: fy, z, yaw };
    // the guns that leave with this death; one in the middle of a swap waits for the room's answer (see settle)
    const guns = bag.slots.map((s, i) => ({ s, i })).filter(({ s, i }) => isGun(s) && !(bag.pending && i === bag.pending.i));
    if (!guns.length) return;
    const pool = { ...bag.pool }, count = {};
    for (const { s } of guns) count[s.g] = (count[s.g] || 0) + 1;
    const at = spots(x, fy, z, yaw, guns.length), items = [];
    guns.forEach(({ s }, k) => {
      const r = count[s.g] > 1 ? Math.ceil(pool[s.g] / count[s.g]) : pool[s.g];
      pool[s.g] -= r; count[s.g]--;
      const [ix, iz, iyw] = at[k];
      items.push({ g: s.g, m: s.m | 0, r: Math.max(0, r | 0), x: ix, y: floorAt(ix, fy + 0.3, iz), z: iz, yw: iyw, rd: m.round, md: m.mode });
    });
    room.drop(items);
  }
  function dropAtDeath(p, item) {     // after a death in the middle of a swap: whatever ended up ours goes down where we fell
    const d = p && p.dead, m = M(); if (!d || !room || !m || !item) return;
    if (item.g !== 'knife') room.drop([{ g: item.g, m: item.m | 0, r: item.r | 0, x: d.x + 0.2, y: d.y, z: d.z, yw: d.yaw + 1.1, rd: m.round, md: m.mode }]);
  }

  /* ------------------------------------------------------------------ picking up */
  let target = null, nearby = 0, armed = false, prog = 0, flash = { t: 0, text: '' };   // armed: the key went down since the last take
  function canPick() {
    const kn = K();
    return on() && alive() && !bag.dead && !bag.pending && bag.slots.length === 2 && kn && !kn.busy;
  }
  function findTarget() {
    target = null; nearby = 0;
    const p = P(); if (!p || !p.pos || !alive() || bag.dead) return;
    const cam = G.camera; let fx = 0, fz = -1;
    if (cam) { const e = cam.matrixWorld.elements; fx = -e[8]; fz = -e[10]; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l; }
    let best = 1e9;
    for (const e of ground.values()) {
      if (!e.obj || !here(e.it)) continue;            // a blinking gun can still be picked up
      const it = e.it, dx = it.x - p.pos.x, dz = it.z - p.pos.z, dy = it.y - p.pos.y, d = Math.hypot(dx, dz);
      if (d > REACH || dy < -1.0 || dy > 0.95) continue;
      // nothing solid between the chest and the gun (a gun on the other side of a thin wall is not in reach)
      try {
        const o = rayO || (rayO = new T.Vector3()), dir = rayD || (rayD = new T.Vector3());
        o.set(p.pos.x, p.pos.y + 1.0, p.pos.z); dir.set(it.x - o.x, it.y + 0.12 - o.y, it.z - o.z); const L = dir.length(); dir.multiplyScalar(1 / L);
        const h = G.physics.raycast(o, dir, L); if (h && h.dist < L - 0.15) continue;
      } catch { /* no physics: trust the distance */ }
      nearby++;
      const ang = d > 0.45 ? Math.acos(clamp((dx * fx + dz * fz) / d, -1, 1)) : 0, score = d + 0.9 * ang;
      if (score < best) { best = score; target = e; }
    }
    if (nearby) nearby--;
  }
  function putFor(i) {          // what goes down in exchange for the thing in slot i
    save();
    const it = bag.slots[i]; if (!it) return null;
    if (!isGun(it)) return { g: 'knife', m: 0, r: 0 };
    return { g: it.g, m: it.m | 0, r: share(i) };
  }
  function startTake(e) {
    if (!canPick() || !room || !e) return;
    const put = putFor(bag.held); if (!put) return;
    bag.pending = { id: e.it.id, i: bag.held, it: { ...e.it }, put, t0: performance.now(), asked: false };
    noFire(true);
    if (!room.take(e.it.id, put)) settle(false);
  }
  function settle(ok, item) {
    const p = bag.pending; if (!p) return;
    bag.pending = null; noFire(false); prog = 0;
    if (p.stale) return;                                    // a new life began meanwhile: what it was about belongs to the last one
    if (p.dead) { if (ok) dropAtDeath(p, item || p.it); else dropAtDeath(p, { ...p.put }); return; }
    if (!ok) { flash = { t: performance.now(), text: 'Too late: it is gone' }; return; }
    const got = item || p.it, i = p.i, old = bag.slots[i];
    if (isGun(old)) { bag.pool[old.g] = Math.max(0, bag.pool[old.g] - (p.put.r | 0)); if (bag.loaded === i) bag.loaded = -1; }
    const inMag = isGun(got) ? clamp(got.m | 0, 0, defOf(got.g).magSize) : 0;
    bag.slots[i] = got.g === 'knife' ? { g: 'knife', m: 0 } : { g: got.g, m: inMag };
    if (isGun(got)) bag.pool[got.g] = clamp(bag.pool[got.g] + (got.r | 0) + Math.max(0, (got.m | 0) - inMag), 0, 9999);     // rounds that would not fit the magazine go with the spare
    mirror();                         // the old gun's spare left with it: the game hears it before anything reads it back
    bag.held = i; apply(true);
    try { G.audio.play('reload_magin', { gain: 0.7, pitch: 1.1 }); } catch { /* fine */ }
    keep(); renderDrawer(true);
  }
  let noFireWas = null;
  function noFire(onIt) {
    const w = W(); if (!w || !w.debug) return;
    if (onIt) { if (noFireWas === null) noFireWas = !!w.debug.noFire; w.debug.noFire = true; }
    else if (noFireWas !== null && !(drawerOpen || bag.pending)) { w.debug.noFire = noFireWas; noFireWas = null; }
  }

  /* ------------------------------------------------------------------ the drawer (B) and the pick-up panel: the look */
  const css = `
    /* the multiplayer HUD carries the class "touch" on a touch screen, and the game's own ".touch { display: none }" (its
       touch-controls layer, shown with .on) hid all of it there: the frag button, the minimap, the kill feed, and the
       bag's buttons. The HUD's own touch styles show it was meant to be seen */
    .mp-ui.touch { display: block; }
    .bag, .bagp, .bag-cursor, .bag-key, .bag-pickbtn, .bag-btn { font-family: var(--f-label, 'Barlow Condensed', sans-serif); }
    .bag { position: absolute; right: var(--gr, 16px); bottom: calc(150px + var(--sab, 0px)); z-index: 40; width: min(328px, calc(100vw - 32px)); padding: 12px 12px 10px;
      background: rgba(11, 13, 15, .82); border: 1px solid rgba(232, 228, 218, .16); color: var(--bone, #e8e4da);
      opacity: 0; visibility: hidden; transform: translateY(10px); pointer-events: none;
      transition: opacity .14s ease-in, transform .14s ease-in, visibility 0s linear .14s; }
    .bag.on { opacity: 1; visibility: visible; transform: none; pointer-events: auto; transition: opacity .18s cubic-bezier(.2,.7,.2,1), transform .18s cubic-bezier(.2,.7,.2,1), visibility 0s; }
    .bag-head { display: flex; align-items: baseline; gap: 10px; margin: 0 2px 10px; }
    .bag-head b { font: 600 12px/1 var(--f-label); letter-spacing: .28em; text-transform: uppercase; color: var(--signal, #ffb347); }
    .bag-head span { margin-left: auto; font: 500 10px/1 var(--f-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--bone-dim, rgba(232,228,218,.64)); }
    .bag-head kbd { margin-right: 5px; }
    .bag-rows { position: relative; display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
    .bag-row { position: relative; display: grid; grid-template-columns: 22px 44px 1fr auto 14px; align-items: center; gap: 10px; height: 56px; padding: 0 10px 0 12px;
      background: rgba(232, 228, 218, .05); border: 1px solid rgba(232, 228, 218, .12); cursor: grab; touch-action: none; user-select: none;
      transition: transform .18s cubic-bezier(.2,.7,.2,1), background .12s, border-color .12s; }
    .bag-row::before { content: ''; position: absolute; left: -1px; top: -1px; bottom: -1px; width: 3px; background: var(--signal, #ffb347); opacity: 0; transition: opacity .12s; }
    .bag-row.held::before { opacity: 1; }
    .bag-row.held { background: rgba(255, 179, 71, .08); border-color: rgba(255, 179, 71, .34); }
    .bag-row.at { background: rgba(232, 228, 218, .1); border-color: rgba(232, 228, 218, .3); }
    .bag-row.lift { z-index: 2; cursor: grabbing; transition: background .12s, border-color .12s; background: rgba(28, 31, 34, .96); border-color: rgba(255, 179, 71, .6); box-shadow: 0 8px 22px rgba(0, 0, 0, .45); }
    .bag-row kbd { justify-self: start; letter-spacing: 0; }
    .bag-ic { display: grid; place-items: center; height: 24px; color: var(--bone, #e8e4da); }
    .bag-ic svg { width: 44px; height: auto; max-height: 22px; fill: currentColor; }
    .bag-nm { min-width: 0; display: grid; gap: 4px; }
    .bag-nm b { font: 800 19px/1 var(--f-display); letter-spacing: .05em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bag-nm small { font: 600 10px/1 var(--f-label); letter-spacing: .24em; text-transform: uppercase; color: var(--bone-dim, rgba(232,228,218,.64)); }
    .bag-row.held .bag-nm small { color: var(--signal, #ffb347); }
    .bag-am { font: 500 13px/1 var(--f-mono); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
    .bag-am i { font-style: normal; color: var(--bone-dim, rgba(232,228,218,.64)); }
    .bag-grip { width: 8px; height: 16px; justify-self: end; opacity: .45; background: radial-gradient(circle, currentColor 1.1px, transparent 1.4px) 0 0 / 4px 4px; }
    .bag-foot { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 10px 2px 0; font: 500 10px/1 var(--f-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--bone-dim, rgba(232,228,218,.64)); }
    .bag-foot kbd { margin-right: 4px; }
    .bag-shut { display: none; position: absolute; top: 6px; right: 6px; width: 34px; height: 34px; border: 0; background: none; color: var(--bone, #e8e4da); font: 600 18px/1 var(--f-mono); }
    .is-touch .bag-shut { display: block; } .is-touch .bag-head span, .is-touch .bag-foot { display: none; }
    .bag-cursor { position: absolute; left: 0; top: 0; z-index: 41; width: 14px; height: 14px; margin: -7px 0 0 -7px; border: 1.5px solid var(--bone, #e8e4da); border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,.5), inset 0 0 0 1px rgba(0,0,0,.35); pointer-events: none; display: none; }
    .bag-cursor::after { content: ''; position: absolute; left: 50%; top: 50%; width: 3px; height: 3px; margin: -1.5px 0 0 -1.5px; border-radius: 50%; background: var(--signal, #ffb347); }
    .bag-cursor.on { display: block; } .bag-cursor.grab { border-color: var(--signal, #ffb347); }
    #app.bag-open .mp-ui .gun-key, #app.bag-open .mp-ui .bag-key, #app.bag-open .mp-ui .mp-knife, #app.bag-open .mp-ui .mp-mic, #app.bag-open .mp-ui .mp-frag { visibility: hidden; }
    .mp-ui .bag-key { position: absolute; right: var(--gr); bottom: calc(264px + var(--sab)); display: flex; align-items: center; gap: 8px; opacity: 0; transition: opacity .25s; font: 600 11px/1 var(--f-label); letter-spacing: .26em; text-transform: uppercase; color: rgba(232, 228, 218, .82); text-shadow: var(--shadow); }
    .mp-ui .bag-key kbd { letter-spacing: 0; } .mp-ui .bag-key b { font-weight: 600; margin-right: -.1em; }
    .mp-ui.live.play .bag-key { opacity: 1; }
    @media (max-height: 560px) { .mp-ui .bag-key { bottom: calc(238px + var(--sab)); } .bag { bottom: calc(118px + var(--sab)); } .bag-row { height: 48px; } }
    .is-touch .mp-ui .bag-key { display: none; }

    .bagp { position: absolute; left: 50%; top: 55.5%; z-index: 39; min-width: 260px; max-width: calc(100vw - 32px); padding: 10px 14px 12px; transform: translate(-50%, 6px);
      background: rgba(11, 13, 15, .74); border: 1px solid rgba(232, 228, 218, .16); color: var(--bone, #e8e4da); pointer-events: none;
      opacity: 0; visibility: hidden; transition: opacity .12s ease-in, transform .12s ease-in, visibility 0s linear .12s; }
    .bagp.on { opacity: 1; visibility: visible; transform: translate(-50%, 0); transition: opacity .16s cubic-bezier(.2,.7,.2,1), transform .16s cubic-bezier(.2,.7,.2,1), visibility 0s; }
    .bagp-top { display: grid; grid-template-columns: 44px 1fr auto; align-items: center; gap: 10px; }
    .bagp-ic svg { width: 44px; height: auto; max-height: 20px; fill: currentColor; display: block; }
    .bagp-nm { font: 800 20px/1 var(--f-display); letter-spacing: .05em; text-transform: uppercase; white-space: nowrap; }
    .bagp-am { font: 500 13px/1 var(--f-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .bagp-am i { font-style: normal; color: var(--bone-dim, rgba(232,228,218,.64)); }
    .bagp-act { display: flex; align-items: center; gap: 10px; margin-top: 10px; font: 600 12px/1 var(--f-label); letter-spacing: .2em; text-transform: uppercase; color: rgba(232, 228, 218, .86); }
    .bagp-act b { font-weight: 700; color: var(--bone, #e8e4da); }
    .bagp-key { position: relative; display: grid; place-items: center; width: 32px; height: 32px; flex: none; }
    .bagp-key svg { position: absolute; inset: 0; transform: rotate(-90deg); }
    .bagp-key circle { fill: none; stroke-width: 2.5; }
    .bagp-key .bg { stroke: rgba(232, 228, 218, .22); } .bagp-key .fg { stroke: var(--signal, #ffb347); stroke-dasharray: 87.96; stroke-dashoffset: 87.96; }
    .bagp-key kbd { position: relative; margin: 0; letter-spacing: 0; }
    .bagp-life { height: 2px; margin-top: 10px; background: rgba(232, 228, 218, .14); }
    .bagp-life i { display: block; height: 100%; background: rgba(232, 228, 218, .6); transform-origin: left; }
    .bagp.ending .bagp-life i { background: var(--signal, #ffb347); }
    .bagp.ending.blink .bagp-life i { opacity: .25; }
    .bagp-more { display: block; margin-top: 8px; font: 500 10px/1 var(--f-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--bone-dim, rgba(232,228,218,.64)); }
    .bagp-more:empty { display: none; }
    .bagp.gone .bagp-act { color: var(--signal, #ffb347); }
    .is-touch .bagp-key { display: none; }

    .bag-pickbtn, .bag-btn { display: none; position: absolute; pointer-events: auto; touch-action: none; border: 1.5px solid rgba(232, 228, 218, .55); background: rgba(11, 13, 15, .38); color: var(--bone, #e8e4da); font: 600 10px/1 var(--f-label); letter-spacing: .14em; text-transform: uppercase; padding: 0; -webkit-tap-highlight-color: transparent; }
    .bag-pickbtn { width: 64px; height: 64px; right: calc(268px + var(--sar, 0px)); bottom: calc(84px + var(--sab, 0px)); border-radius: 50%; }
    .bag-pickbtn svg { position: absolute; inset: -4px; width: calc(100% + 8px); height: calc(100% + 8px); transform: rotate(-90deg); pointer-events: none; }
    .bag-pickbtn circle { fill: none; stroke: var(--signal, #ffb347); stroke-width: 3; stroke-dasharray: 226.2; stroke-dashoffset: 226.2; }
    .bag-pickbtn.press { background: rgba(255, 179, 71, .22); border-color: var(--signal, #ffb347); }
    .bag-btn { width: 42px; height: 42px; right: calc(162px + var(--sar, 0px)); top: calc(12px + var(--sat, 0px)); }
    .bag-btn.press, .bag-btn[aria-expanded="true"] { background: rgba(255, 179, 71, .22); border-color: var(--signal, #ffb347); }
    .is-touch .mp-ui.live.play .bag-btn { display: block; }
    .is-touch .mp-ui.live.play .bag-pickbtn.near { display: block; }
    @media (prefers-reduced-motion: reduce) { .bag, .bag.on, .bagp, .bagp.on { transform: none; } .bag-row, .bag-row.lift { transition: background .12s, border-color .12s; } .bagp.ending.blink .bagp-life i { opacity: 1; } }`;

  let drawer = null, rowsEl = null, cursor = null, panel = null, legend = null, pickBtn = null, bagBtn = null, drawerOpen = false;
  function ui() {
    if (drawer) return true;
    const host = document.querySelector('.mp-ui'); if (!host) return false;
    const st = document.createElement('style'); st.id = 'bag-style'; st.textContent = css; document.head.appendChild(st);
    drawer = document.createElement('div'); drawer.className = 'bag'; drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-label', 'Bag'); drawer.setAttribute('aria-hidden', 'true');
    drawer.innerHTML = `<div class="bag-head"><b>Bag</b><span><kbd data-k="bag">B</kbd>Close</span></div>
      <ol class="bag-rows" aria-label="What you carry: 1 and 2"></ol>
      <div class="bag-foot"><span><kbd>↑</kbd><kbd>↓</kbd>or drag: change order</span><span><kbd>1</kbd><kbd>2</kbd>hold</span></div>
      <button type="button" class="bag-shut" aria-label="Close the bag">×</button>`;
    rowsEl = drawer.querySelector('.bag-rows');
    cursor = document.createElement('div'); cursor.className = 'bag-cursor';
    panel = document.createElement('div'); panel.className = 'bagp'; panel.setAttribute('role', 'status'); panel.setAttribute('aria-live', 'polite');
    panel.innerHTML = `<div class="bagp-top"><span class="bagp-ic"></span><b class="bagp-nm"></b><span class="bagp-am"></span></div>
      <div class="bagp-act"><span class="bagp-key"><svg viewBox="0 0 32 32" aria-hidden="true"><circle class="bg" cx="16" cy="16" r="14"/><circle class="fg" cx="16" cy="16" r="14"/></svg><kbd data-k="pickup">G</kbd></span><span class="bagp-say"></span></div>
      <div class="bagp-life"><i></i></div><small class="bagp-more"></small>`;
    legend = document.createElement('div'); legend.className = 'bag-key'; legend.innerHTML = '<kbd data-k="bag">B</kbd><b>Bag</b>';
    pickBtn = document.createElement('button'); pickBtn.type = 'button'; pickBtn.className = 'bag-pickbtn'; pickBtn.setAttribute('aria-label', 'Hold to pick up');
    pickBtn.innerHTML = '<svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="36"/></svg><span>Pick up</span>';
    bagBtn = document.createElement('button'); bagBtn.type = 'button'; bagBtn.className = 'bag-btn'; bagBtn.setAttribute('aria-label', 'Bag'); bagBtn.setAttribute('aria-expanded', 'false'); bagBtn.textContent = 'Bag';
    host.append(drawer, cursor, panel, legend, pickBtn, bagBtn);
    wireDrawer(); keyCaps();
    return true;
  }
  function keyCaps() {
    if (!drawer) return;
    for (const k of document.querySelectorAll('.bag [data-k], .bagp [data-k], .bag-key [data-k]')) { const n = keyName(k.dataset.k); k.textContent = n || '–'; }
  }

  function rowHtml(i) {
    const it = bag.slots[i]; if (!it) return '';
    const held = i === bag.held, gun = isGun(it);
    return `<li class="bag-row${held ? ' held' : ''}" data-i="${i}" aria-label="${i + 1}: ${nameOf(it.g)}${held ? ', in your hands' : ''}">
      <kbd>${i + 1}</kbd><span class="bag-ic" aria-hidden="true">${iconOf(it.g)}</span>
      <span class="bag-nm"><b>${nameOf(it.g)}</b><small>${held ? 'In your hands' : shortOf(it.g)}</small></span>
      <span class="bag-am">${gun ? `${it.m}<i> / ${bag.pool[it.g]}</i>` : ''}</span><span class="bag-grip" aria-hidden="true"></span></li>`;
  }
  let drawnSig = '';
  function renderDrawer(force) {
    if (!drawer || (!drawerOpen && !force)) return;
    save();
    const sig = JSON.stringify([bag.slots, bag.held, bag.pool]);
    if (!force && sig === drawnSig) return;
    if (drag) return;                                        // never rebuild under a drag
    drawnSig = sig; rowsEl.innerHTML = rowHtml(0) + rowHtml(1);
  }
  function openDrawer() {
    if (!on() || !alive() || bag.dead || !ui()) return;
    drawerOpen = true; drawnSig = ''; renderDrawer(true); keyCaps();
    drawer.classList.add('on'); drawer.setAttribute('aria-hidden', 'false'); bagBtn.setAttribute('aria-expanded', 'true');
    const app = document.getElementById('app'); if (app) app.classList.add('bag-open');
    // the cursor starts in the middle of the drawer
    const r = drawer.getBoundingClientRect(), hr = drawer.parentNode.getBoundingClientRect(); cx = r.left - hr.left + r.width * 0.5; cy = r.top - hr.top + r.height * 0.45;
    showCursor(); noFire(true);
  }
  function closeDrawer() {
    if (!drawer || !drawerOpen) return;
    drawerOpen = false; endDrag(false);
    drawer.classList.remove('on'); drawer.setAttribute('aria-hidden', 'true'); bagBtn.setAttribute('aria-expanded', 'false');
    cursor.classList.remove('on', 'grab');
    const app = document.getElementById('app'); if (app) app.classList.remove('bag-open');
    noFire(false);
  }
  function reorder() {
    if (bag.pending || bag.slots.length !== 2) return false;
    save();
    bag.slots.reverse(); bag.held = 1 - bag.held;
    if (bag.loaded >= 0) bag.loaded = 1 - bag.loaded;
    if (bag.want >= 0) bag.want = 1 - bag.want;
    keep(); return true;
  }
  // the two rows trade places, animated from where each was (FLIP)
  function reorderAnimated() {
    if (!rowsEl) { reorder(); return; }
    const before = [...rowsEl.children].map(r => r.getBoundingClientRect().top);
    if (!reorder()) return;
    drawnSig = ''; renderDrawer(true);
    if (still()) return;
    const rows = [...rowsEl.children];
    rows.forEach((r, k) => { const was = before[1 - k]; if (was == null) return; const dy = was - r.getBoundingClientRect().top; r.style.transition = 'none'; r.style.transform = `translateY(${dy}px)`; });
    void rowsEl.offsetWidth;
    rows.forEach(r => { r.style.transition = ''; r.style.transform = ''; });
  }

  // dragging a row: with the captured mouse (a cursor of our own, moved by the mouse) or a finger / a free pointer
  let cx = 0, cy = 0, drag = null;
  const locked = () => !!document.pointerLockElement;
  function showCursor() { if (!cursor) return; cursor.classList.toggle('on', drawerOpen && locked()); cursor.style.transform = `translate(${cx}px, ${cy}px)`; }
  function rowAt(x, y) {
    const hr = drawer.parentNode.getBoundingClientRect(), el = document.elementFromPoint(hr.left + x, hr.top + y);
    return el && el.closest ? el.closest('.bag-row') : null;
  }
  function beginDrag(row, y) {
    if (!row || bag.pending) return;
    drag = { row, i: +row.dataset.i, y0: y, dy: 0, moved: false, h: row.getBoundingClientRect().height + 6 };
    row.classList.add('lift'); if (cursor) cursor.classList.add('grab');
  }
  function moveDrag(y) {
    if (!drag) return;
    const dir = drag.i === 0 ? 1 : -1;                       // the top row goes down to trade, the bottom row up
    drag.dy = clamp(y - drag.y0, dir > 0 ? -6 : -drag.h - 10, dir > 0 ? drag.h + 10 : 6);
    if (Math.abs(drag.dy) > 4) drag.moved = true;
    drag.row.style.transform = `translateY(${drag.dy}px)`;
    const other = rowsEl.children[1 - drag.i], past = drag.dy * dir > drag.h * 0.5;
    if (other) other.style.transform = past ? `translateY(${-dir * drag.h}px)` : '';
  }
  function endDrag(commit) {
    if (!drag) return;
    const d = drag; drag = null; if (cursor) cursor.classList.remove('grab');
    const dir = d.i === 0 ? 1 : -1, past = commit && d.dy * dir > d.h * 0.5;
    if (past) {
      // the rows are already where they go: rebuild in the new order without a jump
      reorder(); drawnSig = ''; renderDrawer(true);
    } else {
      d.row.classList.remove('lift'); d.row.style.transform = '';
      const other = rowsEl && rowsEl.children[1 - d.i]; if (other) other.style.transform = '';
      if (commit && !d.moved) select(d.i);                    // a click on a row takes it in hand
    }
  }
  function wireDrawer() {
    // a finger, or a mouse that is not captured
    rowsEl.addEventListener('pointerdown', e => {
      if (locked() || !drawerOpen) return;
      const row = e.target.closest('.bag-row'); if (!row) return;
      e.preventDefault(); e.stopPropagation(); try { row.setPointerCapture(e.pointerId); } catch { /* fine */ }
      beginDrag(row, e.clientY);
    });
    rowsEl.addEventListener('pointermove', e => { if (drag && !locked()) moveDrag(e.clientY); });
    rowsEl.addEventListener('pointerup', e => { if (drag && !locked()) endDrag(true); e.stopPropagation(); });
    rowsEl.addEventListener('pointercancel', () => endDrag(false));
    drawer.querySelector('.bag-shut').addEventListener('click', e => { e.stopPropagation(); closeDrawer(); });
    drawer.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });   // a touch in the drawer is not a look-around swipe
    // touch buttons: the bag, and holding to pick up
    bagBtn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); bagBtn.classList.add('press'); if (drawerOpen) closeDrawer(); else openDrawer(); });
    bagBtn.addEventListener('pointerup', () => bagBtn.classList.remove('press'));
    bagBtn.addEventListener('pointercancel', () => bagBtn.classList.remove('press'));
    const tdown = e => { e.preventDefault(); e.stopPropagation(); holdingTouch = true; armed = true; pressT = performance.now(); picking = null; pickBtn.classList.add('press'); try { pickBtn.setPointerCapture(e.pointerId); } catch { /* fine */ } };
    const tup = () => { holdingTouch = false; armed = false; pickBtn.classList.remove('press'); };
    pickBtn.addEventListener('pointerdown', tdown); pickBtn.addEventListener('pointerup', tup); pickBtn.addEventListener('pointercancel', tup); pickBtn.addEventListener('lostpointercapture', tup);
    for (const b of [bagBtn, pickBtn]) b.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
  }

  /* ------------------------------------------------------------------ keys and the mouse */
  let holdingKey = false, holdingTouch = false;
  const typing = e => e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  window.addEventListener('keydown', e => {
    if (typing(e) || !on()) return;
    const pick = keyCode('pickup'), bg = keyCode('bag');
    if (pick && e.code === pick) { holdingKey = true; if (!e.repeat) { armed = true; pressT = performance.now(); picking = null; } return; }
    if (bg && e.code === bg && !e.repeat) {
      if (drawerOpen) closeDrawer(); else if (alive() && !bag.dead) openDrawer();
      e.preventDefault(); e.stopImmediatePropagation(); return;
    }
    if (drawerOpen && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) { if (!e.repeat) reorderAnimated(); e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('keyup', e => { const pick = keyCode('pickup'); if (pick && e.code === pick) { holdingKey = false; armed = false; } }, true);
  window.addEventListener('blur', () => { holdingKey = false; armed = false; holdingTouch = false; endDrag(false); });
  // while the bag is open the mouse belongs to it: it moves our cursor, not the view, and a click never fires
  window.addEventListener('mousemove', e => {
    if (!drawerOpen || !locked()) return;
    e.stopImmediatePropagation();
    const hr = drawer.parentNode.getBoundingClientRect();
    cx = clamp(cx + (e.movementX || 0), 0, hr.width); cy = clamp(cy + (e.movementY || 0), 0, hr.height);
    showCursor();
    if (drag) moveDrag(cy);
    else { const r = rowAt(cx, cy); for (const x of rowsEl.children) x.classList.toggle('at', x === r); }
  }, true);
  window.addEventListener('mousedown', e => {
    if (!drawerOpen) return;
    if (locked()) { e.stopImmediatePropagation(); e.preventDefault(); if (e.button === 0) beginDrag(rowAt(cx, cy), cy); return; }
    if (!e.target.closest || !e.target.closest('.bag')) { e.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('mouseup', e => { if (drawerOpen && locked() && e.button === 0 && drag) { endDrag(true); } }, true);
  window.addEventListener('wheel', e => { if (drawerOpen) e.stopImmediatePropagation(); }, { capture: true, passive: true });
  window.addEventListener('contextmenu', e => { if (drawerOpen) e.preventDefault(); }, true);

  /* ------------------------------------------------------------------ every frame */
  let lastKeep = 0, lastT = 0, capsN = 0;
  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now(), dt = Math.min(0.1, (now - (lastT || now)) / 1000); lastT = now;
    if (!G) return;
    const live = on();
    if (!live) { if (drawerOpen) closeDrawer(); if (panel) panel.classList.remove('on'); if (pickBtn) pickBtn.classList.remove('near'); if (ringMesh) ringMesh.visible = false; if (groundRoot) groundRoot.visible = false; return; }
    if (!ensureRoot()) return;
    ui(); groundRoot.visible = true;
    // the game and the bag agree: the rounds in the gun out go back to its slot
    const w = W(), kn = K();
    if (w && kn && !bag.dead && alive()) {
      save();
      // the gun of the kind already out, drawn again: its rounds go in once it is out of sight (see apply)
      if (bag.want >= 0 && !w.pending) { load(bag.want); bag.want = -1; }
      // anything else that changed the hands is put right (the game's own switch keys, a stray draw)
      const it = bag.slots[bag.held];
      if (it && !bag.pending && !w.pending && bag.want < 0) {
        if (isGun(it) && (kn.on || w.current !== it.g || bag.loaded !== bag.held) && !kn.busy) apply(false);
        else if (!isGun(it) && !kn.on && !kn.busy) apply(false);
      }
      if (now - lastKeep > 1500) { lastKeep = now; keep(); }
    }
    // the guns on the ground: built when their model is there, blinking at the end, gone after a minute; each with its glint
    const blinkOn = still() ? true : Math.floor(now / 140) % 2 === 0, cm = G.camera && G.camera.matrixWorld.elements, ts = now / 1000, calm = still();
    for (const [id, e] of ground) {
      const l = left(e.it);
      if (l <= 0) { removeItem(id); continue; }
      if (!e.built && !build(e)) continue;
      e.obj.visible = here(e.it) && (l > BLINK || blinkOn);
      if (e.glint && e.obj.visible && cm) {
        const d = Math.hypot(cm[12] - e.it.x, cm[13] - e.it.y, cm[14] - e.it.z), fade = d >= GLINT_FAR ? 0 : d <= GLINT_FADE ? 1 : 1 - (d - GLINT_FADE) / (GLINT_FAR - GLINT_FADE);
        e.glint.visible = fade > 0;
        if (fade > 0) { const pulse = calm ? 0.55 : 0.42 + 0.3 * (0.5 + 0.5 * Math.sin(ts * 3.6 + e.glint.userData.phase)); e.glint.material.opacity = pulse * fade; const sz = Math.min(0.42, 0.13 + d * 0.012); e.glint.scale.set(sz, sz, 1); }
      }
    }
    // the take, if its answer is slow: ask for the list (the answer settles it); in the end, give up on it
    const p = bag.pending;
    if (p && !p.asked && now - p.t0 > 1500) { p.asked = true; if (room) room.askDrops(); }
    if (p && now - p.t0 > SETTLE) settle(false);
    // what the pick-up would take, and the hold
    findTarget();
    const want = armed && (holdingKey || holdingTouch);
    if (target && want && canPick()) {
      // timed from the press itself when the gun was already in reach; from now when it came into reach while the key was held, or the aim moved to another gun
      if (picking !== target.it.id) { holdT0 = picking === null && pressT && now - pressT < 250 ? pressT : now; picking = target.it.id; }
      prog = (now - holdT0) / 1000 / HOLD;
      if (prog >= 1) { prog = 1; armed = false; startTake(target); }
    } else if (!bag.pending) { prog = 0; picking = null; }
    paintPanel(now);
    if (ringMesh) {
      const show = !!(target && target.obj);
      ringMesh.visible = show;
      if (show) { ringMesh.position.set(target.it.x, target.it.y + 0.012, target.it.z); const s = 1 + 0.06 * Math.sin(now / 180) * (still() ? 0 : 1); ringMesh.scale.set(s, 1, s); ringMesh.material.opacity = 0.55 + 0.35 * clamp(prog, 0, 1); }
    }
    if (drawerOpen) { if (!alive() || bag.dead) closeDrawer(); else renderDrawer(false); }
    if (++capsN % 60 === 0) keyCaps();                       // a key changed in Settings shows here within a second
  }
  let picking = null, holdT0 = 0, pressT = 0, paintSig = '';
  function paintPanel(now) {
    if (!panel) return;
    const gone = flash.text && now - flash.t < 1100;
    const e = target || null;
    const show = !!(e || gone) && alive() && !bag.dead;
    panel.classList.toggle('on', show);
    pickBtn.classList.toggle('near', !!e && canPick());
    if (!show) { paintSig = ''; return; }
    const it = e ? e.it : null, l = it ? left(it) : 0;
    const keyN = keyName('pickup'), heldIt = bag.slots[bag.held];
    let say;
    if (bag.pending) say = 'Swapping…';
    else if (gone && !e) say = flash.text;
    else if (!keyN && !document.documentElement.classList.contains('is-touch')) say = 'Set a key for Pick up in Settings';
    else say = `Hold to swap for <b>${heldIt ? shortOf(heldIt.g) : ''}</b>`;
    if (document.documentElement.classList.contains('is-touch') && !bag.pending && e) say = `Hold Pick up: swap for <b>${heldIt ? shortOf(heldIt.g) : ''}</b>`;
    const sig = JSON.stringify([it && it.id, it && it.g, say, nearby, keyN]);
    if (sig !== paintSig) {
      paintSig = sig;
      if (it) {
        panel.querySelector('.bagp-ic').innerHTML = iconOf(it.g);
        panel.querySelector('.bagp-nm').textContent = nameOf(it.g);
        panel.querySelector('.bagp-am').innerHTML = isGun(it) ? `${it.m}<i> + ${it.r}</i>` : '';
      }
      panel.querySelector('.bagp-say').innerHTML = say;
      panel.querySelector('.bagp-more').textContent = nearby > 0 && it ? `+${nearby} more here · look at one to choose` : '';
      panel.querySelector('[data-k="pickup"]').textContent = keyN || '–';
    }
    panel.classList.toggle('gone', !!(gone && !e));
    const fg = panel.querySelector('.fg'), k = bag.pending ? 1 : clamp(prog, 0, 1);
    fg.style.strokeDashoffset = String(87.96 * (1 - k));
    const pc = pickBtn.querySelector('circle'); if (pc) pc.style.strokeDashoffset = String(226.2 * (1 - k));
    panel.querySelector('.bagp-life i').style.transform = `scaleX(${clamp(l / TTL, 0, 1).toFixed(3)})`;
    panel.classList.toggle('ending', !!it && l < BLINK);
    panel.classList.toggle('blink', Math.floor(now / 250) % 2 === 0);
  }

  /* ------------------------------------------------------------------ what the game calls (scripts/bag-hooks.mjs) */
  const api = (window.__SALTLINE_BAG = {
    on,
    swap() { if (bag.slots.length === 2) return select(1 - bag.held); return false; },
    key(i) { return select(i); },
    died() { try { died(); } catch (e) { console.error('[bag] died: ' + (e && e.stack || e)); } },
    // a life begins: the gun chosen and the knife; on joining, what this tab carried a moment ago in this room and round
    spawn(g, first) {
      G = g || G; if (!G) return;
      if (bag.pending) bag.pending.stale = true;
      bag.pending = null; prog = 0; armed = false;
      { const w = W(); if (w && w.debug && noFireWas !== null) { w.debug.noFire = noFireWas; noFireWas = null; } }
      closeDrawer(); bag.dead = false;
      const m = M(); if (!m || !m.live) { bag.active = false; return; }
      bag.active = true;
      if (!(first && restore())) fresh(GUNS() ? GUNS().choice() : 'rifle');
      mirror(); apply(false); keep();
    },
    left() { closeDrawer(); clearGround(); bag.active = false; bag.dead = false; if (bag.pending) bag.pending.stale = true; bag.pending = null; forget(); noFire(false); },
    refill() {      // an ammo pile: every kind of gun carried back to at least a full spare
      if (!on()) return false;
      save(); for (const it of bag.slots) if (isGun(it)) bag.pool[it.g] = Math.max(bag.pool[it.g], defOf(it.g).reserve);
      mirror(); keep(); return true;
    },
    otherName() { const it = bag.slots[1 - bag.held]; return it ? shortOf(it.g) : 'Knife'; },
    holdFire: () => !!(drawerOpen || bag.pending),
    // for the checks only: put a given bag in the hands (as if it had been picked up that way)
    put(o) {
      if (!on() || !o || !Array.isArray(o.slots) || o.slots.length !== 2) return false;
      bag.slots = o.slots.map(x => ({ g: x.g, m: x.g === 'knife' ? 0 : x.m | 0 })); bag.held = o.held === 1 ? 1 : 0; bag.loaded = -1; bag.want = -1;
      bag.pool = { rifle: 0, shotgun: 0, sniper: 0, ...(o.pool || {}) }; mirror(); apply(false); keep(); renderDrawer(true); return true;
    },
    // for the checks (scripts/drops-check.mjs): what this player carries, and what lies around
    state() {
      save();
      return { active: bag.active, dead: bag.dead, slots: bag.slots.map(s => ({ ...s })), held: bag.held, pool: { ...bag.pool }, loaded: bag.loaded, want: bag.want, pending: bag.pending ? { id: bag.pending.id, i: bag.pending.i } : null,
        drawer: drawerOpen, target: target ? target.it.id : null, nearby, prog,
        ground: [...ground.values()].map(e => ({ ...e.it, shown: !!(e.obj && e.obj.visible), left: Math.round(left(e.it)) })),
        hands: { knife: !!(K() && K().on), gun: W() ? W().current : null, ammo: W() && W().rigs[W().current] ? W().rigs[W().current].slot.ammo : null, reserve: W() && W().rigs[W().current] ? W().rigs[W().current].slot.reserve : null } };
    },
  });

  // the game and the room, once they are there
  const wait = setInterval(() => {
    if (!window.__G || !window.__G.weapon) return;
    clearInterval(wait); G = window.__G;
    try { G.events.on('weapon:switch', ev => { if (ev && ev.phase === 'draw' && bag.want >= 0 && bag.slots[bag.want] && bag.slots[bag.want].g === ev.to) { load(bag.want); bag.want = -1; } }); } catch { /* the frame does it */ }
    requestAnimationFrame(frame);
    if (typeof window.__SALTLINE_ROOM !== 'function') return;
    Promise.resolve(window.__SALTLINE_ROOM()).then(r => { if (!r || !r.onDrops) return; room = r; r.onDrops(onDrops); }, () => {});
  }, 200);
})();
