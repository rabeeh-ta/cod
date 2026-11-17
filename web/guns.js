/* Saltline's extra guns: a pump shotgun and a bolt-action sniper rifle.

   The game builds its own two guns (the rifle and the pistol) in code. These two come from models: scripts/gun-assets.mjs
   turns each downloaded model into a small binary and a few textures in web/guns/, and this file loads them and makes
   each one a gun the game can hold, with the same parts the game's own guns have:

     the look         the model, its moving parts (pump, bolt, magazine), where the hands sit
     the handling     where it is held at the hip and when aiming, how it sways, kicks and settles
     the shot         damage, spread, pellets, the flash, the case thrown out on the pump or the bolt
     the reload       its own timeline: what the gun, the parts and the left hand do, and when the rounds arrive
     the sound        shots made by the game's own gunshot synthesiser so they sit in its mix; pump, shells and bolt made here

   The game reaches this file through the hooks in scripts/gun-hooks.mjs and nowhere else:
     __SALTLINE_GUNS.build(d, table, list)   called while the game sets up its guns; adds ours to the same table
     weapon.primary                           the gun the player brought (rifle, shotgun or sniper); swap and "1" pick it
     weapon.adsFov                            how far the view narrows when aiming (the sniper's scope)
     def.shoot / def.ownShell                 a gun that fires or ejects its own way

   For the rest of the page:  window.__SALTLINE_GUNS = { list, name(id), ready, pick(id), choice() }                    */
(() => {
  'use strict';
  const TAU = Math.PI * 2, clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }, span = (v, a, b) => clamp((v - a) / (b - a), 0, 1);
  const KEY = 'saltline.mp.loadout';
  const read = k => { try { return localStorage.getItem(k); } catch { return null; } }, write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

  /* ------------------------------------------------------------------ the two guns, in numbers
     Positions are in the gun's own space (see scripts/gun-assets.mjs): metres, muzzle toward -Z, trigger at the origin.
     grip is where the right hand holds it; the model is set so that this point lies where the rifle's grip does, so the
     right hand, the hip pose and the way other players carry it all carry over. hip moves the whole gun from where the
     rifle is held: keep it small. The arms are only so long, and a gun held further out than the rifle is a gun the
     hands cannot reach (they hang in the air under it).                                                              */
  const SPEC = {
    shotgun: {
      name: 'PAC-12 Breakwater', short: 'Shotgun', line: 'Nine pellets. Kills in one shot up close, fades by twenty metres.',
      def: {
        magSize: 6, reserve: 64, rpm: 300, damage: 13, pellets: 9, range: 70, auto: false, adsTime: 0.2, inspect: false,
        flashLight: 75, flashScale: 1.55, smoke: true, ownShell: true, reloadAfter: 0.22,     // after the last shell: once the pump has thrown the case out
        cone: 0.05, coneAds: 0.038, falloff: [7, 22, 0.22],                 // full damage to 7 m, down to 22% of it at 22 m and beyond
        spread: { hip: 0.012, ads: 0.006, moveHip: 0.012, moveAds: 0.006, bloomHip: 0.012, bloomAds: 0.006, air: 0.03, crouch: 0.002, shot: 0.35, decay: 2.4 },
      },
      kick: { pitch: 0.05, yaw: 0.012, shake: 0.5, back: 2.3, rise: 3.3, yawV: 1.6, roll: 2.4, up: 0.3, side: 0.16 },
      grip: [0, -0.014, 0.068], support: [0, 0.026, -0.3], sightY: 0.087, adsZ: -0.17, hip: [0.012, -0.022, -0.03],     // support: the pump's underside is at 0.005, a hand's cup is 21 mm below its centre
      cycle: { from: 0.02, back: 0.08, fwd: 0.17, travel: 0.085 },        // the pump after each shot, in seconds since the shot: a fast slam, done before the next shot (0.2 s)
      reload: { start: 0.46, each: 0.5, insert: 0.3, end: 0.4, rack: 0.62 },
    },
    sniper: {
      name: 'PAC-98 Lookout', short: 'Sniper', line: 'One shot, one bolt. Kills with a single hit; slow to aim and to fire again.',
      def: {
        magSize: 5, reserve: 25, rpm: 120, damage: 105, range: 400, auto: false, adsTime: 0.34, inspect: false,
        flashLight: 85, flashScale: 1.7, smoke: true, ownShell: true, adsFov: 15, reloadAfter: 0.3,     // after the last round: straight to the magazine; the bolt is worked at the end
        spread: { hip: 0.055, ads: 0.0002, moveHip: 0.03, moveAds: 0.007, bloomHip: 0.02, bloomAds: 0.004, air: 0.09, crouch: 0.006, shot: 1, decay: 1.2 },
      },
      kick: { pitch: 0.07, yaw: 0.016, shake: 0.62, back: 3.1, rise: 4.2, yawV: 2, roll: 2.6, up: 0.36, side: 0.2 },
      grip: [0, -0.04, 0.055], support: [0, 0.039, -0.27], sightY: 0.1315, adsZ: -0.15, hip: [0.02, -0.05, -0.03],        // support: the fore-end's underside is at 0.018
      cycle: { from: 0.05, lift: 0.11, back: 0.2, fwd: 0.3, down: 0.36, done: 0.46, travel: 0.085, turn: 1.05 },   // the bolt after each shot
      reload: { tac: 2.5, empty: 3.4, atMag: 0.42, out: 0.6, away: 0.95, back: 1.35, insert: 1.72, seat: 1.86, done: 2.3, bolt: 2.3 },
    },
  };
  const IDS = ['rifle', 'shotgun', 'sniper'];
  const list = [{ id: 'rifle', name: 'PAC-9 Longshore', short: 'Rifle', line: 'Automatic. Thirty rounds, good at every range.' }, ...Object.keys(SPEC).map(id => ({ id, name: SPEC[id].name, short: SPEC[id].short, line: SPEC[id].line }))];

  /* ------------------------------------------------------------------ models */
  const assets = {};
  function load(id) {
    if (assets[id]) return assets[id];
    return (assets[id] = Promise.all([fetch(`/guns/${id}.json`).then(r => r.json()), fetch(`/guns/${id}.bin`).then(r => r.arrayBuffer())]).then(([manifest, bin]) => ({ manifest, bin })));
  }
  const ready = Promise.all(Object.keys(SPEC).map(id => load(id).catch(e => { console.error('[guns] ' + id + ' did not load: ' + e); return null; })));

  function geometries(T, { manifest, bin }, shift) {
    return manifest.parts.map(p => {
      const g = new T.BufferGeometry(); let at = p.at; const pad = n => (n + 3) & ~3;
      const pos = new Float32Array(bin.slice(at, at + p.vertices * 12)); at += pad(p.vertices * 12);
      const nrm = new Int8Array(bin.slice(at, at + p.vertices * 3)); at += pad(p.vertices * 3);
      const uv = new Float32Array(bin.slice(at, at + p.vertices * 8)); at += pad(p.vertices * 8);
      const idx = p.wide ? new Uint32Array(bin.slice(at, at + p.indices * 4)) : new Uint16Array(bin.slice(at, at + p.indices * 2));
      for (let i = 0; i < pos.length; i += 3) { pos[i] += shift[0]; pos[i + 1] += shift[1]; pos[i + 2] += shift[2]; }
      g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(nrm, 3, true)); g.setAttribute('uv', new T.BufferAttribute(uv, 2)); g.setIndex(new T.BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      return { part: p, geo: g };
    });
  }
  function materials(T, manifest, id) {
    const loader = new T.TextureLoader(), tex = (file, srgb) => { if (!file) return null; const t = loader.load('/guns/' + file); t.flipY = false; t.anisotropy = 8; if (srgb) t.colorSpace = T.SRGBColorSpace; return t; };
    return manifest.materials.map((m, i) => {
      if (m.glass) { const g = new T.MeshStandardMaterial({ color: 0x05070a, roughness: 0.08, metalness: 0.9 }); g.name = `${id}_glass`; return g; }
      const orm = tex(m.orm, false);
      const mat = new T.MeshStandardMaterial({ color: new T.Color(...m.color), map: tex(m.map, true), normalMap: tex(m.normal, false), roughnessMap: orm, metalnessMap: orm, aoMap: m.ao ? orm : null, roughness: m.orm ? 1 : m.roughness, metalness: m.orm ? 1 : m.metalness });
      mat.name = `${id}_${i}`;
      return mat;
    });
  }

  /* ------------------------------------------------------------------ one gun the game can hold */
  let G = null, weapon = null;
  function makeRig(d, table, id) {
    const T = d.G.THREE, S = d.S, spec = SPEC[id], def = spec.def, rifle = table.rifle, H = rifle.holds, rnd = d.rng;
    const V = (x, y, z) => new T.Vector3(x, y, z), root = new T.Group(), model = new T.Group();
    root.name = 'viewmodel-' + id; root.add(model);          // the model has a group of its own: the scope hides it without touching root, which the game shows and hides itself
    // the model is set so its grip lies where the rifle's grip does
    const RIFLE_GRIP = [0, -0.1, 0.073], RIFLE_FORE = [0, 0, -0.255], shift = RIFLE_GRIP.map((v, a) => v - spec.grip[a]);
    const at = p => [p[0] + shift[0], p[1] + shift[1], p[2] + shift[2]];
    const P = { muzzle: at([0, 0, -0.7]), eject: at([0.02, 0.05, -0.1]), support: at(spec.support) };
    const moving = {};                                                     // name -> { group, rest: Vector3 }
    const info = { tris: 0, meshes: 0 };
    // the flash is the game's own, borrowed from the rifle and given its own material so each gun flashes by itself
    const flash = rifle.flash.clone(); flash.material = rifle.flash.material.clone(); flash.visible = false; root.add(flash);

    load(id).then(a => {
      if (!a) return;
      const m = a.manifest, mats = materials(T, m, id), pts = m.points;
      Object.assign(P, { muzzle: at(pts.muzzle), eject: at(pts.eject), port: at(pts.port), boltAxis: pts.boltAxis && at(pts.boltAxis), sight: at(pts.sight) });
      rig.muzzle = P.muzzle; rig.eject = P.eject; flash.position.fromArray(P.muzzle);
      for (const { part, geo } of geometries(T, a, shift)) {
        const mesh = d.mk(geo, mats[part.material]); mesh.layers.mask = root.layers.mask; mesh.name = id + ':' + part.name;
        if (part.name === 'body') model.add(mesh);
        else {
          let mv = moving[part.name];
          if (!mv) { mv = moving[part.name] = { group: new T.Group(), rest: V(0, 0, 0) }; mv.group.layers.mask = root.layers.mask; model.add(mv.group); }
          // the bolt turns about the bore, so its group sits on that line
          if (part.name === 'bolt' && P.boltAxis) { mv.rest.fromArray(P.boltAxis); geo.translate(-P.boltAxis[0], -P.boltAxis[1], -P.boltAxis[2]); mv.group.position.copy(mv.rest); }
          mv.group.add(mesh);
        }
        info.meshes++;
      }
      info.tris = m.triangles;
      console.log(`[guns] ${spec.name}: ${m.triangles} tris, ${info.meshes} meshes`);
    });

    /* the handling: the rifle's, with this gun's own kick. Views are where the gun sits at the hip, when aiming, on the
       run and during a reload; the game blends between them. */
    const motion = JSON.parse(JSON.stringify(rifle.motion));
    Object.assign(motion.recoil, { back: spec.kick.back, rise: spec.kick.rise, yaw: spec.kick.yawV, roll: spec.kick.roll, up: spec.kick.up, side: spec.kick.side, first: 1 });
    const sightY = spec.sightY + shift[1];
    const RELOAD = id === 'shotgun' ? { p: [-0.035, 0.03, 0.05], r: [0.3, 0.1, 0.62] } : { p: [-0.02, 0.012, 0.04], r: [0.12, 0.3, 0.42] };
    const RACK = id === 'shotgun' ? { p: [0, 0.008, 0.03], r: [-0.1, 0, 0.2] } : { p: [0.012, 0.004, 0.035], r: [-0.05, -0.06, 0.34] };
    const views = rifle.views.map(v => ({ name: v.name, HIP: { p: v.HIP.p.map((c, a) => c + spec.hip[a]), r: v.HIP.r }, ADS: { p: [0, -sightY, spec.adsZ], r: [0, 0, 0] }, SPRINT: v.SPRINT, SPRINT_ARC: v.SPRINT_ARC, RELOAD, RACK }));

    /* state */
    let since = 9, cycled = true, trig = 0, grip = 1, locked = false, shellOut = true;
    const left = { p: V(0, 0, 0), q: new T.Quaternion(), pose: new Float32Array(H.fore.pose.length), busy: false }, right = { on: 0, p: V(0, 0, 0) };
    const fore = V(...P.support).sub(V(...RIFLE_FORE)), tmp = V(0, 0, 0), tv = V(0, 0, 0), tw = V(0, 0, 0), eul = new T.Euler();
    // where the left hand goes to hold a point of this gun: the rifle's hold on its handguard, carried there
    const holdAt = (out, point, dx, dy, dz) => out.copy(H.fore.p).add(tw.set(point[0] - RIFLE_FORE[0] + dx, point[1] - RIFLE_FORE[1] + dy, point[2] - RIFLE_FORE[2] + dz));
    const mixPose = (out, a, b, t) => { for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * t; };
    const play = (name, o) => { try { d.G.audio && d.G.audio.play && d.G.audio.play(name, Object.assign({ gain: 1, jitter: 0.02 }, o)); } catch { /* sound is never worth a crash */ } };
    function throwCase() {
      const fx = d.G.fx, cam = d.G.camera; if (!fx || !fx.shell || !cam) return;
      root.updateWorldMatrix(true, false); tmp.fromArray(P.eject).applyMatrix4(root.matrixWorld);
      tv.set(1.6 + rnd() * 1.1, 1.0 + rnd() * 0.8, 0.5 - rnd() * 0.6).applyQuaternion(cam.quaternion); if (d.G.player && d.G.player.vel) tv.add(d.G.player.vel);
      fx.shell(tmp, tv);
    }
    const setPart = (name, x, y, z) => { const m = moving[name]; if (m) m.group.position.set(m.rest.x + x, m.rest.y + y, m.rest.z + z); };
    function restParts() { if (moving.stock) moving.stock.group.visible = true; setPart('pump', 0, 0, 0); setPart('bolt', 0, 0, 0); setPart('mag', 0, 0, 0); if (moving.bolt) moving.bolt.group.rotation.set(0, 0, 0); if (moving.mag) moving.mag.group.visible = true; }

    /* the action after a shot. Shotgun: the pump comes back (the case flies) and goes home. Sniper: the bolt lifts, comes
       back (the case flies), goes home and turns down, worked by the right hand. Returns how far through it is, 0..1 */
    function cycle(t) {
      const c = spec.cycle;
      if (id === 'shotgun') {
        const k = t < c.from ? 0 : t < c.back ? ease(span(t, c.from, c.back)) : 1 - ease(span(t, c.back + 0.04, c.fwd));
        setPart('pump', 0, 0, c.travel * k);
        return { k, hand: 0 };
      }
      const lift = ease(span(t, c.lift, c.lift + 0.1)) * (1 - ease(span(t, c.down, c.down + 0.1)));
      const back = ease(span(t, c.lift + 0.09, c.back)) * (1 - ease(span(t, c.fwd - 0.12, c.fwd)));
      setPart('bolt', 0, 0, c.travel * back);
      if (moving.bolt) moving.bolt.group.rotation.z = c.turn * lift;
      return { k: back, hand: ease(span(t, c.from, c.lift)) * (1 - ease(span(t, c.down + 0.06, c.done))), lift };
    }

    const rig = {
      id, name: spec.name, root, model, flash, muzzle: P.muzzle, eject: P.eject, sight: [0, sightY, 0], info,
      slot: { id, name: spec.name, ammo: def.magSize, magSize: def.magSize, reserve: def.reserve },
      def, views, view: 0,
      get pose() { return api.inspect ? Object.assign({}, views[rig.view], { HIP: api.inspect }) : views[rig.view]; },      // inspect: hold the gun side-on, for looking at the hands
      setView(v) { rig.view = clamp(v | 0, 0, views.length - 1); },
      motion,
      reloadTime(empty) {
        if (id === 'sniper') return empty ? spec.reload.empty : spec.reload.tac;
        const r = spec.reload, n = Math.max(1, Math.min(def.magSize - rig.slot.ammo, rig.slot.reserve));
        return r.start + n * r.each + r.end + (empty ? r.rack : 0);
      },
      reset() { since = 9; cycled = true; shellOut = true; locked = false; left.busy = false; right.on = 0; restParts(); },
      cancelReload() { left.busy = false; restParts(); },
      endReload() { left.busy = false; restParts(); },
      shot(last) {
        since = 0; cycled = false; shellOut = false;
        if (d.arms) { d.arms.right.impulse(1); d.arms.left.impulse(0.8); }
        if (last) locked = true;
      },
      recoil(burst, scale, player) {
        const k = spec.kick, ads = S.adsE, crouch = player.crouching ? 0.85 : 1, j = 0.9 + rnd() * 0.2;
        if (player.addRecoil) player.addRecoil(k.pitch * scale * j, (rnd() - 0.5) * 2 * k.yaw * scale);
        if (player.addShake) player.addShake(k.shake * scale);
        const R = motion.recoil, rot = j * crouch * lerp(1, R.adsRot, ads), pos = j * crouch * lerp(1, R.adsPos, ads);
        S.kZ.v += R.back * j * crouch * lerp(1, R.adsBack, ads); S.kP.v += R.rise * rot; S.kY.v += (rnd() - 0.5) * R.yaw * rot; S.kR.v += (rnd() - 0.5) * R.roll * rot;
        S.kU.v += R.up * pos * (0.7 + 0.6 * rnd()); S.kX.v += (rnd() - 0.5) * 2 * R.side * pos;
      },
      /* every frame while this gun is in the hands */
      parts(dt, finger) {
        trig = finger; since += dt; if (api.freeze != null) since = api.freeze;            // freeze: hold the action at a moment, for looking at it
        if (!S.reload) {
          const c = spec.cycle, end = id === 'shotgun' ? c.fwd : c.done, st = cycle(since);
          right.on = st.hand;
          if (since < end + 0.05) {
            // sounds and the case, each once
            if (id === 'shotgun') {
              if (!shellOut && since >= c.from + 0.06) { shellOut = true; if (rig.slot.ammo > 0 || true) { play('shotgun_pump_back'); throwCase(); S.kZ.v += 0.5; S.kP.v += 0.5; S.bump.v -= 0.12; } }
              if (!cycled && since >= c.back + 0.06) { cycled = true; play('shotgun_pump_fwd'); S.kZ.v -= 0.55; S.kP.v -= 0.4; S.bump.v += 0.1; }
            } else {
              if (!shellOut && since >= c.lift + 0.12) { shellOut = true; play('sniper_bolt_open'); throwCase(); S.kZ.v += 0.45; S.kR.v += 0.5; }
              if (!cycled && since >= c.fwd - 0.1) { cycled = true; play('sniper_bolt_close'); S.kZ.v -= 0.6; S.kR.v -= 0.4; S.bump.v += 0.08; }
              S.rackW = Math.max(S.rackW, st.hand * 0.75);
            }
          }
        }
        if (moving.stock) moving.stock.group.visible = S.adsE < 0.55;            // the eye is where the stock would be
        scope(rig, dt);
      },
      /* the reload, t seconds in. The shotgun takes its shells one at a time and can be fired between them; the rifle
         swaps its magazine and, if it ran dry, works the bolt. */
      reload(R, t) {
        const r = spec.reload, slot = rig.slot; left.busy = true; since = 9; right.on = 0;
        const ramp = Math.min(ease(t / 0.3), 1 - ease((t - (R.T - 0.42)) / 0.36));
        S.reloadW = ramp;
        if (id === 'shotgun') {
          const n = R.shells || (R.shells = Math.max(1, Math.min(def.magSize - slot.ammo, slot.reserve)));
          if (!R.f.go) { R.f.go = 1; R.in = 0; }
          // fire is pressed and there is a shell in it: stop loading and shoot
          if (d.G.input && d.G.input.fire && slot.ammo > 0 && t > 0.25 && t < R.T - 0.2 && !R.empty) { R.t = R.T; return; }
          const k = Math.floor((t - r.start) / r.each), u = (t - r.start) - k * r.each;           // which shell, and how far into it
          if (k >= 0 && k < n && u >= r.insert && R.in <= k && slot.reserve > 0 && slot.ammo < def.magSize) { R.in = k + 1; slot.ammo++; slot.reserve--; play('shotgun_shell'); S.bump.v += 0.35; S.kR.v -= 0.35; if (d.arms) d.arms.left.impulse(0.6); }
          const loading = t >= r.start && k < n;
          // left hand: off the pump, down for a shell, up to the port, push; then back to the pump
          const portP = holdAt(tmp, P.port, -0.01, -0.012, 0.03), belt = tv.set(-0.14, -0.3, 0.14).add(portP);
          const a = t < r.start ? ease(span(t, 0.05, r.start)) : loading ? 1 : 1 - ease(span(t, r.start + n * r.each, r.start + n * r.each + r.end * 0.8));
          const fetch = loading ? (u < r.insert ? 1 - ease(span(u, 0.02, r.insert)) : ease(span(u, r.insert + 0.03, r.each))) : 0;      // 1 = at the belt, 0 = at the port
          left.p.copy(H.fore.p).add(fore).lerp(portP, a).lerp(belt, fetch * a);
          left.q.copy(H.fore.q); mixPose(left.pose, H.fore.pose, H.pinch.pose, a);
          // the pump after an empty reload
          if (R.empty) {
            const t0 = R.T - r.rack + 0.08, kk = ease(span(t, t0, t0 + 0.16)) * (1 - ease(span(t, t0 + 0.22, t0 + 0.4)));
            setPart('pump', 0, 0, spec.cycle.travel * kk);
            if (!R.f.pb && t >= t0 + 0.05) { R.f.pb = 1; play('shotgun_pump_back'); S.kZ.v += 0.5; S.bump.v -= 0.1; }
            if (!R.f.pf && t >= t0 + 0.26) { R.f.pf = 1; play('shotgun_pump_fwd'); S.kZ.v -= 0.55; locked = false; }
            S.rackW = ease(span(t, t0 - 0.1, t0 + 0.1)) * (1 - ease(span(t, t0 + 0.34, R.T)));
            if (t >= t0 - 0.05) left.p.z += spec.cycle.travel * kk;
          } else locked = false;
          return;
        }
        // sniper: magazine out, a fresh one in, then the bolt if it ran dry
        const ev = d.ev;
        if (ev(R, 'magout', r.out)) { play('reload_magout', { pitch: 0.82 }); S.bump.v -= 0.25; }
        if (ev(R, 'maginsert', r.insert)) { play('reload_maginsert', { pitch: 0.84 }); S.bump.v += 0.1; S.kR.v += 0.4; }
        if (ev(R, 'magin', r.seat)) { play('reload_magin', { pitch: 0.82 }); S.bump.v += 0.8; S.kR.v -= 0.5; if (d.arms) d.arms.left.impulse(1); if (!R.empty) locked = false; }
        const magP = holdAt(tmp, P.port, 0, -0.03, 0.02), away = tv.set(-0.1, -0.36, 0.14).add(magP);
        const toMag = ease(span(t, 0.06, r.atMag)), off = t < r.out ? 0 : t < r.back ? ease(span(t, r.out, r.away)) : 1 - ease(span(t, r.back, r.insert));
        const home = ease(span(t, r.seat + 0.08, r.done));
        left.p.copy(H.fore.p).add(fore).lerp(magP, toMag * (1 - home)).lerp(away, off * (1 - home));
        left.q.copy(H.fore.q); mixPose(left.pose, H.fore.pose, H.pinch.pose, toMag * (1 - home));
        if (moving.mag) { const dz = off; setPart('mag', -0.03 * dz, -0.34 * dz - (t >= r.out && t < r.seat ? 0.012 * (1 - dz) : 0), 0.12 * dz); moving.mag.group.visible = !(t > r.away && t < r.back); }
        if (R.empty) {
          const t0 = r.bolt, c = spec.cycle, tt = t - t0 + c.from, st = cycle(Math.max(0, tt));
          right.on = st.hand;
          if (!R.f.bo && tt >= c.lift + 0.12) { R.f.bo = 1; play('sniper_bolt_open'); if (!shellOut) { shellOut = true; throwCase(); } S.kZ.v += 0.4; }
          if (!R.f.bc && tt >= c.fwd - 0.1) { R.f.bc = 1; play('sniper_bolt_close'); S.kZ.v -= 0.6; locked = false; }
          S.rackW = st.hand * 0.75;
        }
      },
      armTargets(B, dt) {
        rifle.armTargets(B, dt);                                           // the rifle's hands, then moved to where this gun's are
        const idle = S.spV.x > 0.3 || S.reload || S.hol > 0.12 ? 0 : 1;
        grip += (idle - grip) * (1 - Math.exp(-16 * dt));
        mixPose(B.r.pose, H.grip.pose, H.trigger.pose, ease(grip)); B.r.trig = trig * grip;
        if (right.on > 0.001 && moving.bolt) {                             // the right hand goes to the bolt handle
          const g = moving.bolt.group; eul.set(0, 0, g.rotation.z);                 // the knob, 4 cm out to the right of the bore, turned with the bolt
          tmp.set(0.041, -0.0335, 0.002).applyEuler(eul).add(g.position).add(tv.set(-0.02, -0.035, 0.07)).sub(tv.set(RIFLE_GRIP[0], RIFLE_GRIP[1], RIFLE_GRIP[2]));
          B.r.p.addScaledVector(tmp, right.on); mixPose(B.r.pose, B.r.pose, H.handle.pose, right.on * 0.7); B.r.trig = 0;
        }
        if (left.busy) { B.l.p.copy(left.p); B.l.q.copy(left.q); B.l.pose.set(left.pose); }
        else { B.l.p.copy(H.fore.p).add(fore); B.l.q.copy(H.fore.q); B.l.pose.set(H.fore.pose); if (moving.pump) B.l.p.z += moving.pump.group.position.z - moving.pump.rest.z; }
      },
      snapArms() { grip = S.spV.x > 0.3 || S.reload || S.hol > 0.12 ? 0 : 1; },
      setLocked(b) { locked = !!b; },
      get locked() { return locked; },
      holds: H,
    };
    if (def.pellets) def.shoot = pellets;
    return rig;
  }

  /* A shotgun's shot: every pellet is its own ray in a cone round the aim, and loses force with distance. The first
     pellet is returned to the game (it draws that tracer); the others draw their own. */
  let scratch = null;
  function pellets(g, from, dir, def) {
    const T = g.THREE; scratch = scratch || { u: new T.Vector3(), v: new T.Vector3(), d: new T.Vector3(), m: new T.Vector3(), e: new T.Vector3() };
    const { u, v, d, m, e } = scratch, cone = Math.tan(lerp(def.cone, def.coneAds, g.weapon ? g.weapon.ads : 0)), [near, far, least] = def.falloff;
    u.set(0, 1, 0); if (Math.abs(dir.y) > 0.95) u.set(1, 0, 0); u.cross(dir).normalize(); v.copy(dir).cross(u);
    let first = null; g.weapon.muzzleWorld(m);
    for (let i = 0; i < def.pellets; i++) {
      const a = Math.random() * TAU, r = cone * Math.sqrt(Math.random());
      d.copy(dir).addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r).normalize();
      const wall = g.physics.raycast(from, d, def.range), body = g.enemies.raycast(from, d, wall ? wall.dist : def.range), dist = body ? body.dist : wall ? wall.dist : def.range;
      const hit = g.combat.playerShot(from, d.clone(), { damage: def.damage * lerp(1, least, span(dist, near, far)), range: def.range });
      if (i === 0) first = hit;
      else if (g.fx && g.fx.tracer) { if (hit && hit.point) e.copy(hit.point); else e.copy(from).addScaledVector(d, def.range); g.fx.tracer(m, e); }
    }
    return first;
  }

  /* ------------------------------------------------------------------ the scope
     Aiming the sniper narrows the view (weapon.adsFov) and, once the eye is at the glass, the gun gives way to the scope
     picture: a black surround, a fine cross with range marks, a little glass shade. The look slows with the zoom, so a
     hand's movement covers the same distance on screen. */
  let scopeEl = null, scopeOn = 0, shown = true, baseSens = null;
  function scopeUi() {
    if (scopeEl) return scopeEl;
    const css = document.createElement('style');
    css.textContent = `.gun-scope { position: absolute; inset: 0; z-index: 4; pointer-events: none; opacity: 0; }
      .gun-scope svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }`;
    document.head.appendChild(css);
    scopeEl = document.createElement('div'); scopeEl.className = 'gun-scope'; scopeEl.setAttribute('aria-hidden', 'true');
    const marks = [-30, -20, -10, 10, 20, 30].map(v => `<line x1="${v}" y1="-0.9" x2="${v}" y2="0.9"/><line x1="-0.9" y1="${v}" x2="0.9" y2="${v}"/>`).join('');
    scopeEl.innerHTML = `<svg viewBox="-50 -50 100 100" preserveAspectRatio="xMidYMid meet">
      <defs><radialGradient id="gun-scope-glass"><stop offset="0.72" stop-color="#000" stop-opacity="0"/><stop offset="0.94" stop-color="#000" stop-opacity="0.38"/><stop offset="1" stop-color="#000" stop-opacity="0.9"/></radialGradient>
      <mask id="gun-scope-hole"><rect x="-1000" y="-1000" width="2000" height="2000" fill="#fff"/><circle r="46" fill="#000"/></mask></defs>
      <circle r="46" fill="url(#gun-scope-glass)"/>
      <rect x="-1000" y="-1000" width="2000" height="2000" fill="#000" mask="url(#gun-scope-hole)"/>
      <circle r="46" fill="none" stroke="#0b0d0f" stroke-width="1.6"/>
      <g stroke="#0b0d0f" stroke-width="0.14" stroke-linecap="butt"><line x1="-46" y1="0" x2="-2.2" y2="0"/><line x1="2.2" y1="0" x2="46" y2="0"/><line x1="0" y1="-46" x2="0" y2="-2.2"/><line x1="0" y1="2.2" x2="0" y2="46"/>${marks}</g>
      <g stroke="#0b0d0f" stroke-width="0.9"><line x1="-46" y1="0" x2="-33" y2="0"/><line x1="33" y1="0" x2="46" y2="0"/><line x1="0" y1="33" x2="0" y2="46"/></g>
      <circle r="0.16" fill="#c8402c"/></svg>`;
    (document.getElementById('app') || document.body).appendChild(scopeEl);
    return scopeEl;
  }
  function scope(rig, dt) {
    const has = !!rig.def.adsFov && visible, ads = weapon ? weapon.ads : 0, want = has && G.player && G.player.alive !== false ? ease(span(ads, 0.38, 0.72)) : 0;
    if (!has && scopeOn === 0) return;
    scoped = rig;
    zoomNow += (zoomTo - zoomNow) * (1 - Math.exp(-dt * 32));          // the wheel's zoom, eased so it glides
    // the scope picture comes up as the rifle comes up, and the rifle is gone before its own dark eyepiece can fill the view
    scopeOn = want > scopeOn ? Math.min(want, scopeOn + dt / 0.05) : Math.max(want, scopeOn - dt / 0.05);
    scopeUi().style.opacity = scopeOn.toFixed(3);
    const hide = scopeOn > 0.22;
    if (hide === shown) { shown = !hide; rig.model.visible = shown; try { weapon.arms.setVisible(shown && visible); } catch { /* fine */ } }
    // slow the look with the zoom
    const inp = G.input;
    if (inp && typeof inp.sensitivity === 'number') {
      if (baseSens == null || (!has && scopeOn === 0)) baseSens = null;
      if (has && ads > 0.02) { if (baseSens == null) baseSens = inp.sensitivity; const base = (G.player && G.player.baseFov) || 74; inp.sensitivity = baseSens * lerp(1, scopeSens() * Math.tan(zoomNow * Math.PI / 360) / Math.tan(base * Math.PI / 360), ease(ads)); }
      else if (baseSens != null) { inp.sensitivity = baseSens; baseSens = null; }
    }
  }
  function scopeOff() {
    scopeOn = 0; if (scopeEl) scopeEl.style.opacity = '0';
    if (!shown) { shown = true; if (scoped) scoped.model.visible = true; if (visible) try { weapon.arms.setVisible(true); } catch { /* fine */ } }
    if (baseSens != null && G && G.input) { G.input.sensitivity = baseSens; baseSens = null; }
  }
  /* How fast the view turns through the scope, as a share of the matched speed (1 = a hand's movement covers the same
     distance on screen as without the scope). The player sets it in Settings, under Mouse sensitivity. */
  const SCOPE_KEY = 'saltline.scopeSens', scopeSens = () => { const v = parseFloat(read(SCOPE_KEY)); return Number.isFinite(v) ? clamp(v, 0.2, 3) : 1; };
  function scopeSetting() {
    const wait = setInterval(() => {
      const sens = document.getElementById('s-sens'), row = sens && sens.closest('.row'); if (!row) return; clearInterval(wait);
      const mine = document.createElement('div'); mine.className = 'row';
      mine.innerHTML = '<label for="s-scope">Scope sensitivity</label><div class="slider"><input id="s-scope" type="range" min="0.2" max="3" step="0.05"><output></output></div>';
      row.after(mine);
      const input = mine.querySelector('input'), out = mine.querySelector('output'), show = () => { out.textContent = (+input.value).toFixed(2) + 'x'; };
      input.value = String(scopeSens()); show();
      input.addEventListener('input', () => { write(SCOPE_KEY, input.value); show(); });
    }, 500);
  }
  /* Through the scope the wheel is the zoom ring: it glides between 2x (41 degrees) and 10x (8.6 degrees), and it does not
     change weapon (neither does the swap key) until the rifle is lowered. */
  const ZOOM = { wide: 41.3, tight: 8.6 };                       // against the usual 74 degree view: 2x and 10x. It starts at 2x and then stays where the wheel left it
  let zoomTo = ZOOM.wide, zoomNow = ZOOM.wide;
  const inScope = () => scopeOn > 0.15 && !!scoped && !!weapon && weapon.current === scoped.id;
  window.addEventListener('wheel', e => {
    if (!inScope()) return;
    zoomTo = clamp(zoomTo * Math.exp(clamp(e.deltaY, -240, 240) * 0.008), ZOOM.tight, ZOOM.wide);
    e.stopImmediatePropagation(); e.preventDefault();
  }, { capture: true, passive: false });
  window.addEventListener('keydown', e => { if (inScope() && (window.__SALTLINE_KEYS || {})[e.code] === 'swap') { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  let visible = true, scoped = null;                           // visible: the game is showing the gun (false with the knife or a grenade in hand, and when down)

  /* ------------------------------------------------------------------ sound
     Shots come from the game's own gunshot synthesiser with heavier settings, so they sit in the same mix as the rifle
     and get the same echo. The pump, the shells and the bolt are made here: each is a few struck-metal tones and a
     short hiss of sliding steel. */
  function sounds(consts) {
    const tbl = consts.sounds, gs = consts.gunSound; if (!tbl || !gs || !gs.shot || !gs.rifle) return;
    const base = gs.rifle, shotgun = Object.assign({}, base, {
      len: 0.95, n: 4, pitch: [1, 0.96, 1.04, 0.985], bright: [1, 1.06, 0.95, 1.03],
      layers: [[52, 190, 2.5, 0.2, 0.2], [190, 820, 2.5, 0.15, 0.085], [820, 4200, 1.35, 0.06, 0.034]],
      hold: 0.03, holdTau: 0.012, drive: 1.9, blast: 3.0, f0: 118, f1: 44, tauF: 0.04, tauA: 0.085, thump: 0.36, lpEnd: 620, lpMid: 2300, lpMidTau: 0.09, shelf: 0.85, plateau: 0.84, mech: [],
    }), sniper = Object.assign({}, base, {
      len: 1.15, n: 3, pitch: [1, 0.97, 1.03], bright: [1, 1.05, 0.96],
      layers: [[64, 240, 2.1, 0.17, 0.19], [240, 1250, 2.5, 0.13, 0.07], [1250, 7500, 2.0, 0.075, 0.03]],
      hold: 0.028, holdTau: 0.011, drive: 1.85, blast: 3.6, f0: 165, f1: 52, tauF: 0.034, tauA: 0.075, thump: 0.3, lpEnd: 760, lpMid: 3000, lpMidTau: 0.085, lpTopTau: 0.0042, shelf: 0.7, plateau: 0.84, mech: [],
    });
    tbl.shotgun_shot = { gen: (sr, rng, v) => gs.shot(sr, rng, v, shotgun), n: 4, sr: 44100, peak: 0.97, bus: 'gun', max: 6, pri: 9 };
    tbl.sniper_shot = { gen: (sr, rng, v) => gs.shot(sr, rng, v, sniper), n: 3, sr: 44100, peak: 0.97, bus: 'gun', max: 5, pri: 9 };
    const mech = (make, peak) => ({ gen: (sr, rng) => make(sr, typeof rng === 'function' ? rng : Math.random), n: 1, sr: 44100, peak, bus: 'gun', max: 2, pri: 7 });
    tbl.shotgun_pump_back = mech((sr, r) => metal(sr, r, 0.3, [[0, 0.75, [[640, 0.02, 1], [1380, 0.014, 0.7], [2450, 0.009, 0.5], [3900, 0.006, 0.3]]], [0.055, 0.5, [[880, 0.022, 1], [1900, 0.012, 0.6]]]], [[0.004, 0.085, 1500, 0.5]], 150), 0.6);
    tbl.shotgun_pump_fwd = mech((sr, r) => metal(sr, r, 0.34, [[0.07, 1, [[520, 0.03, 1], [1120, 0.02, 0.8], [2100, 0.012, 0.6], [3300, 0.008, 0.35], [5200, 0.004, 0.2]]], [0.078, 0.5, [[240, 0.045, 1]]]], [[0, 0.075, 1900, 0.42]], 120), 0.72);
    tbl.shotgun_shell = mech((sr, r) => metal(sr, r, 0.26, [[0.012, 0.5, [[1450, 0.008, 1], [2900, 0.005, 0.5]]], [0.085, 1, [[760, 0.02, 1], [1650, 0.012, 0.7], [3100, 0.006, 0.4]]], [0.09, 0.45, [[210, 0.04, 1]]]], [[0.02, 0.06, 2600, 0.3]], 180), 0.46);
    tbl.sniper_bolt_open = mech((sr, r) => metal(sr, r, 0.36, [[0, 0.7, [[1150, 0.012, 1], [2500, 0.008, 0.6], [4100, 0.005, 0.35]]], [0.15, 1, [[700, 0.024, 1], [1500, 0.015, 0.7], [2900, 0.008, 0.45]]]], [[0.03, 0.12, 2300, 0.5]], 160), 0.6);
    tbl.sniper_bolt_close = mech((sr, r) => metal(sr, r, 0.34, [[0.115, 1, [[600, 0.028, 1], [1300, 0.018, 0.8], [2600, 0.01, 0.5], [4400, 0.005, 0.25]]], [0.19, 0.75, [[980, 0.014, 1], [2150, 0.009, 0.6]]], [0.12, 0.4, [[230, 0.04, 1]]]], [[0, 0.11, 2100, 0.5]], 140), 0.7);
    if (gs.mix && gs.mix.weapon) {
      const r = gs.mix.weapon.rifle;
      gs.mix.weapon.shotgun = Object.assign({}, r, { shot: 'shotgun_shot', n: 4, gain: 1.2, tail: 1.35, duck: 0.6, shellPitch: 0.72 });
      gs.mix.weapon.sniper = Object.assign({}, r, { shot: 'sniper_shot', n: 3, gain: 1.22, tail: 1.6, duck: 0.65, shellPitch: 0.86 });
    }
  }
  /* struck and sliding steel. hits: [at seconds, gain, [[hz, decay seconds, gain], ...]]; slides: [at, length, hz, gain] */
  function metal(sr, rnd, seconds, hits, slides, hp) {
    const n = Math.round(sr * seconds), out = new Float32Array(n);
    for (const [at, gain, modes] of hits) {
      const i0 = Math.round(at * sr);
      for (const [hz, decay, g] of modes) { const f = hz * (0.97 + rnd() * 0.06), ph = rnd() * TAU; for (let i = i0; i < n; i++) { const t = (i - i0) / sr; if (t > decay * 7) break; out[i] += gain * g * Math.exp(-t / decay) * Math.sin(TAU * f * t + ph); } }
      for (let i = i0, k = 0; k < sr * 0.004 && i < n; i++, k++) out[i] += gain * 0.7 * (rnd() * 2 - 1) * Math.exp(-k / (sr * 0.0012));     // the click itself
    }
    for (const [at, len, hz, gain] of slides) {
      const i0 = Math.round(at * sr), m = Math.round(len * sr), f = 2 * Math.sin(Math.PI * Math.min(hz, sr * 0.15) / sr); let low = 0, band = 0;
      for (let k = 0; k < m && i0 + k < n; k++) { const x = rnd() * 2 - 1, e = Math.sin(Math.PI * k / m); low += f * band; band += f * (x - low - 0.9 * band); out[i0 + k] += gain * band * e * e * (0.6 + 0.4 * Math.sin(k * 0.021)); }
    }
    let lo = 0; const a = 1 - Math.exp(-TAU * hp / sr);
    for (let i = 0; i < n; i++) { lo += a * (out[i] - lo); out[i] -= lo; }
    const fade = Math.round(sr * 0.012); for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
    return out;
  }

  /* ------------------------------------------------------------------ in a match with other players
     What goes over the wire keeps its old meaning: in a shot 0 is the rifle and 1 the pistol, a hit of kind 1 is the knife
     and 2 a grenade, and a player carrying 2 has the knife out. The new guns take the next numbers. */
  const CODE = { rifle: 0, pistol: 1, shotgun: 2, sniper: 3 }, KIND = { shotgun: 3, sniper: 4 }, CARRY = { shotgun: 3, sniper: 4 };
  const LABEL = { rifle: 'Rifle', shotgun: 'Shotgun', sniper: 'Sniper', knife: 'Knife', frag: 'Grenade', barrel: 'Barrel' };
  const wire = {
    code: id => CODE[id] || 0,
    shotSound: c => (c === 2 ? 'shotgun_shot' : c === 3 ? 'sniper_shot' : c ? 'pistol_shot' : 'rifle_shot'),
    kind: id => KIND[id] || 0,
    kindName: k => (k === 3 ? 'shotgun' : k === 4 ? 'sniper' : 'rifle'),
    carry: id => CARRY[id] || 0,
    // kill feed: the same plain silhouettes as the game's own
    icons: {
      shotgun: '<svg viewBox="0 0 60 18" width="40" height="12"><path d="M0 6h12l3-2h43v2h2v2H44v1.500H27V8h-9l-3 2.500-2 6H7l2-6H6l-3 4.500H0z"/></svg>',
      sniper: '<svg viewBox="0 0 60 18" width="40" height="12"><path d="M0 7h10l2-2h14V2h3V0h12v2h3v3h16v1.500H44V8H31l-1 2h-3l1-2h-5l-2 3-2 5h-6l2-6H9l-3 5H0z"/></svg>',
    },
    /* Another player, as drawn here, holds a gun built from the same model the first-person view uses. The game makes
       the rifle; this adds the others beside it and shows the one that player carries. */
    carried(rifleGroup, T, g) {
      const all = new T.Group(), made = { 0: rifleGroup }; all.add(rifleGroup);
      const make = id => {
        const rig = g.weapon && g.weapon.rigs[id]; if (!rig || !rig.info.meshes) return null;
        const grp = new T.Group(), src = rig.root; let n = 0;
        src.traverse(o => { if (!o.isMesh || !o.material || !o.material.isMeshStandardMaterial) return; const m = new T.Mesh(o.geometry, o.material); m.castShadow = n < 2; m.frustumCulled = false; if (o.parent && o.parent !== src) { m.position.copy(o.parent.position); m.quaternion.copy(o.parent.quaternion); } grp.add(m); n++; });
        all.add(grp); return grp;
      };
      let showing = 0;
      all.userData.setGun = w => {
        const want = w === 3 || w === 4 ? w : 0; if (want === showing && made[want]) return;
        if (!made[want]) { made[want] = make(want === 3 ? 'shotgun' : 'sniper'); if (!made[want]) return; }      // its model has not arrived yet: keep what is shown
        for (const k of Object.keys(made)) if (made[k]) made[k].visible = +k === want;
        showing = want;
      };
      return all;
    },
    /* The card a player sees when they go down: under the game's "Dropped by" line, what did it and from how far, and
       the three guns to come back with. 1, 2 and 3 choose (or a tap, on a touch screen); the choice holds for every life after. */
    down(card, killer, cause, headshot, g) {
      let how = card.querySelector('.gun-how');
      if (!how) {
        const css = document.createElement('style');
        css.textContent = `.mp-down .gun-how { display: block; min-height: 12px; margin-top: 10px; font: 500 12px/1 var(--f-mono); font-style: normal; letter-spacing: .1em; text-transform: uppercase; color: var(--bone-dim); }
          .mp-down .gun-pick { display: grid; justify-items: center; gap: 10px; margin: 20px auto 0; width: min(700px, 90vw); }
          .mp-down .gun-pick u { font: 600 11px/1 var(--f-label); text-decoration: none; letter-spacing: .28em; margin-right: -.28em; text-transform: uppercase; color: var(--bone-dim); }
          /* room for the cards: the card sits a little higher, and the scoreboard shown with it drops to the bottom of the screen */
          .mp-down:has(.gun-pick) { top: 7%; }
          #app:has(.mp-down.on) .mp-board { top: auto; bottom: 4%; transform: translateX(-50%); }`;
        document.head.appendChild(css);
        how = document.createElement('i'); how.className = 'gun-how';
        const pick = document.createElement('div'); pick.className = 'gun-pick'; pick.innerHTML = '<u>Come back with</u>';
        card.insertBefore(how, card.querySelector('span')); card.append(pick);          // what did it sits right under who did it, above the countdown
        document.addEventListener('keydown', e => { if (!card.classList.contains('on')) return; const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code); if (i >= 0 && list[i]) { api.pick(list[i].id); mark(); } });
      }
      const bits = [];
      if (killer && LABEL[cause]) bits.push(LABEL[cause]);
      if (killer && killer.pos && g.player && g.player.pos) bits.push(Math.max(1, Math.round(Math.hypot(killer.pos.x - g.player.pos.x, killer.pos.y - g.player.pos.y, killer.pos.z - g.player.pos.z))) + ' m');
      if (killer && headshot) bits.push('Headshot');
      how.textContent = bits.join('  ·  ');
      mount(card.querySelector('.gun-pick'), true);
      pointer(card);
    },
    // a spawn takes up the gun that was chosen, and starts the protected seconds
    spawn(g) { scopeOff(); if (ptr) ptr.style.display = 'none'; if (cardsEl) for (const b of cardsEl.children) b.classList.remove('at'); const w = g.weapon, id = api.choice(); if (w && w.rigs[id]) { w.primary = id; w.slots[0] = w.rigs[id].slot; if (w.current !== id) w.equip(id); } shield(g); },
    /* Protection after a spawn, as others see it: the player's outline glows white and flickers. The glow is added to
       that avatar's own materials when it is made (a rim that is bright where the surface turns away from the eye), and
       switched on from the pose the game gives it every frame. */
    avatar(av) { for (const e of av.mats || []) rim(e.m); },
    posed(gun, mats, s) {
      const held = gun.children[0]; if (held && held.userData.setGun) held.userData.setGun(s.gun);
      const t = performance.now() * 0.001, glow = s.prot ? 0.62 + 0.3 * Math.sin(t * 13) + 0.08 * Math.sin(t * 47) : 0;
      for (const e of mats) if (e.m.userData.rim) e.m.userData.rim.value = glow;
    },
  };
  function rim(m) {
    if (!m || m.userData.rim || !m.isMeshStandardMaterial) return;
    const u = (m.userData.rim = { value: 0 }), before = m.onBeforeCompile, key = m.customProgramCacheKey;
    m.onBeforeCompile = function (shader, renderer) {
      if (before) before.call(this, shader, renderer);
      shader.uniforms.uSpawnGlow = u;
      shader.fragmentShader = 'uniform float uSpawnGlow;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  { float spawnRim = 1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0); totalEmissiveRadiance += uSpawnGlow * (0.16 + 2.4 * spawnRim * spawnRim * spawnRim) * vec3(1.0, 1.0, 1.0); }');
    };
    m.customProgramCacheKey = function () { return (key ? key.call(this) : '') + '|spawn-glow'; };
    m.needsUpdate = true;
  }
  /* ... and as the player sees it themselves: a soft white edge on the screen that flickers the same way, and a count of
     the seconds left. It goes the moment the game ends the protection (time up, or they fired). */
  let shieldEl = null, shieldRun = 0;
  function shield(g) {
    if (!shieldEl) {
      const css = document.createElement('style');
      css.textContent = `.gun-shield { position: absolute; inset: 0; z-index: 3; pointer-events: none; opacity: 0; transition: opacity .25s ease; box-shadow: inset 0 0 90px 12px rgba(255, 255, 255, .5), inset 0 0 0 2px rgba(255, 255, 255, .55); }
        .gun-shield.on { opacity: var(--glow, .8); }
        .gun-shield b { position: absolute; left: 50%; bottom: 21%; transform: translateX(-50%); font: 500 12px/1 var(--f-mono, monospace); letter-spacing: .18em; text-transform: uppercase; color: #fff; text-shadow: 0 0 10px rgba(255, 255, 255, .8), var(--shadow, 0 1px 2px #000); white-space: nowrap; }
        @media (prefers-reduced-motion: reduce) { .gun-shield { transition: none; } }`;
      document.head.appendChild(css);
      shieldEl = document.createElement('div'); shieldEl.className = 'gun-shield'; shieldEl.setAttribute('role', 'status'); shieldEl.appendChild(document.createElement('b'));
      (document.getElementById('app') || document.body).appendChild(shieldEl);
    }
    const run = ++shieldRun, t0 = performance.now(), still = matchMedia('(prefers-reduced-motion: reduce)').matches; let last = -1;
    const tick = () => {
      const P = g.player, t = (performance.now() - t0) / 1000, on = run === shieldRun && P && P.invulnerable && P.alive !== false && P.enabled !== false && t < 6;
      if (!on) { if (run === shieldRun) shieldEl.classList.remove('on'); return; }
      if (t > 0.05) shieldEl.classList.add('on');
      shieldEl.style.setProperty('--glow', still ? '0.7' : (0.62 + 0.3 * Math.sin(t * 13) + 0.08 * Math.sin(t * 47)).toFixed(3));
      const left = Math.max(1, Math.ceil(5 - t)); if (left !== last) { last = left; shieldEl.firstChild.textContent = 'Protected  ' + left + '  ·  ends when you fire'; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* Choosing the next gun during a match: B opens a panel over the game with the three guns, large.

     The mouse is captured while playing, so there is no pointer to click with. The panel is worked the way the mouse
     and keys already move: slide the mouse (or A / D, or the arrows) to move along the cards, click (or Enter) to take
     the one that is lit; 1, 2 and 3 take a gun straight away. While it is open the player stands still and a click
     never fires. On a touch screen, or where the mouse is free, the cards are simply tapped or clicked.

     The gun in the hands never changes in the middle of a life: the pick is the gun to come back with. */
  let menuEl = null;
  function gunMenu(g) {
    const css = document.createElement('style');
    css.textContent = `.gun-menu { position: absolute; inset: 0; z-index: 60; display: grid; place-items: center; padding: 16px; opacity: 0; pointer-events: none; transition: opacity .16s ease;
        background: radial-gradient(ellipse at 50% 50%, rgba(11, 13, 15, .9) 0%, rgba(11, 13, 15, .8) 60%, rgba(11, 13, 15, .66) 100%); }      /* over the game's own text, so nothing shows through the panel */
      .gun-menu.on { opacity: 1; pointer-events: auto; }
      .gun-menu-panel { display: grid; justify-items: center; gap: 22px; width: min(1040px, 100%); text-align: center; }
      .gun-menu-head { display: grid; gap: 10px; justify-items: center; }
      .gun-menu-head u { font: 600 12px/1 var(--f-label); text-decoration: none; letter-spacing: .28em; margin-right: -.28em; text-transform: uppercase; color: var(--signal, #ffb347); }
      .gun-menu-head strong { font: 900 clamp(34px, 5.4vw, 60px)/.92 var(--f-display); letter-spacing: .06em; text-transform: uppercase; color: var(--bone, #e8e4da); }
      .gun-menu-head small { font: 400 17px/1.3 var(--f-label); color: var(--bone-dim, rgba(232, 228, 218, .64)); }
      .gun-menu-cards { width: 100%; }
      .gun-menu-keys { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 22px; font: 500 12px/1 var(--f-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--bone-dim, rgba(232, 228, 218, .64)); }
      .gun-menu-keys kbd { margin-right: 6px; }
      .gun-menu-said { min-height: 22px; font: 700 22px/1 var(--f-display); letter-spacing: .06em; text-transform: uppercase; color: var(--signal, #ffb347); }
      .mp-ui .gun-key { position: absolute; right: var(--gr); bottom: calc(264px + var(--sab)); display: flex; align-items: center; gap: 8px; opacity: 0; transition: opacity .25s; font: 600 11px/1 var(--f-label); letter-spacing: .26em; text-transform: uppercase; color: rgba(232, 228, 218, .82); text-shadow: var(--shadow); }
      .mp-ui .gun-key kbd { letter-spacing: 0; } .mp-ui .gun-key b { font-weight: 600; margin-right: -.1em; }
      .mp-ui.live.play .gun-key { opacity: 1; }
      @media (max-height: 560px) { .mp-ui .gun-key { bottom: calc(238px + var(--sab)); } .gun-menu-panel { gap: 12px; } .gun-menu-head small { display: none; } }
      @media (prefers-reduced-motion: reduce) { .gun-menu { transition: none; } }`;
    document.head.appendChild(css);
    menuEl = document.createElement('div'); menuEl.className = 'gun-menu'; menuEl.setAttribute('role', 'dialog'); menuEl.setAttribute('aria-label', 'Gun for your next life');
    menuEl.innerHTML = `<div class="gun-menu-panel">
      <div class="gun-menu-head"><u>Next life</u><strong>Choose your gun</strong><small>The gun in your hands stays until you go down.</small></div>
      <div class="gun-menu-cards"></div>
      <div class="gun-menu-said" role="status"></div>
      <div class="gun-menu-keys"><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd>Take a gun</span><span><kbd>A</kbd><kbd>D</kbd>or the mouse: move</span><span><kbd>Click</kbd>or<kbd style="margin-left:6px">Enter</kbd>Take the lit one</span><span><kbd>B</kbd>Close</span></div></div>`;
    (document.getElementById('app') || document.body).appendChild(menuEl);
    const said = menuEl.querySelector('.gun-menu-said'), host = menuEl.querySelector('.gun-menu-cards');
    let at = 0, slide = 0, froze = false, closing = 0;
    const isOpen = () => menuEl.classList.contains('on'), locked = () => !!document.pointerLockElement;
    const light = i => { at = (i + list.length) % list.length; for (const [k, b] of [...cardsEl.children].entries()) b.classList.toggle('at', k === at); };
    function open() {
      clearTimeout(closing); said.textContent = ''; mount(host, 'big');
      light(Math.max(0, list.findIndex(x => x.id === api.choice()))); slide = 0;
      menuEl.classList.add('on');
      // stand still while choosing: nothing moves, looks or fires until it is closed
      try { if (g.player && g.player.alive !== false && g.player.enabled !== false) { g.input.setGameplay(false); froze = true; } } catch { /* fine */ }
    }
    function close() {
      clearTimeout(closing); menuEl.classList.remove('on'); if (cardsEl) { cardsEl.classList.remove('big'); for (const b of cardsEl.children) b.classList.remove('at'); }
      if (froze) { froze = false; try { if (g.game.state === 'playing' && g.player && g.player.alive !== false && g.player.enabled !== false) g.input.setGameplay(true); } catch { /* fine */ } }
    }
    function take(i) {
      const gun = list[(i + list.length) % list.length]; light(i); api.pick(gun.id); mark();
      said.textContent = gun.short + ' from your next life';
      clearTimeout(closing); closing = setTimeout(close, 750);
    }
    picked.push(id => { if (isOpen()) take(list.findIndex(x => x.id === id)); });      // a tap or a click on a card, where there is a pointer
    // every key and click goes to the panel while it is open, before the game sees it
    window.addEventListener('keydown', e => {
      const live = !!document.querySelector('.mp-live') && g.game && g.game.state === 'playing';
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (!isOpen()) { if (live && e.code === 'KeyB' && !e.repeat && g.player && g.player.alive !== false && g.player.enabled !== false) { open(); e.stopImmediatePropagation(); } return; }
      const i = ['Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3'].indexOf(e.code);
      if (i >= 0) take(i % 3);
      else if (e.code === 'KeyA' || e.code === 'ArrowLeft') light(at - 1);
      else if (e.code === 'KeyD' || e.code === 'ArrowRight') light(at + 1);
      else if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') take(at);
      else if ((e.code === 'KeyB' && !e.repeat) || e.code === 'Escape') close();
      else if (e.code === 'KeyP') return;                                                // pause still pauses
      e.stopImmediatePropagation(); if (e.code !== 'Escape') e.preventDefault();
    }, true);
    window.addEventListener('keyup', e => { if (isOpen()) e.stopImmediatePropagation(); }, true);
    document.addEventListener('mousemove', e => {
      if (!isOpen() || !locked()) return;
      slide += e.movementX || 0;
      if (Math.abs(slide) > 110) { light(at + Math.sign(slide)); slide = 0; }
    }, true);
    document.addEventListener('mousedown', e => {
      if (!isOpen()) return;
      if (locked()) { take(at); e.stopImmediatePropagation(); e.preventDefault(); }       // captured mouse: the click takes the lit card and never fires
      else if (!e.target.closest || !e.target.closest('.gun-card')) { e.stopImmediatePropagation(); if (e.target === menuEl) close(); }
    }, true);
    menuEl.addEventListener('mouseover', e => { const b = e.target.closest && e.target.closest('.gun-card'); if (b && !locked()) light([...cardsEl.children].indexOf(b)); });
    // it closes by itself if the player goes down or the game stops being played
    setInterval(() => { if (isOpen() && (!g.game || g.game.state !== 'playing' || !g.player || g.player.alive === false || g.player.enabled === false)) { froze = false; close(); } }, 150);
    // the key, in the list of keys at the right of the screen
    const legend = setInterval(() => { const ui = document.querySelector('.mp-ui'); if (!ui) return; clearInterval(legend); const row = document.createElement('div'); row.className = 'gun-key'; row.innerHTML = '<kbd>B</kbd><b>Next gun</b>'; ui.appendChild(row); }, 300);
  }

  /* ------------------------------------------------------------------ choosing a gun: three cards
     One row of three cards, the same wherever a gun is chosen: the first screen, the card shown when down, and B in a
     match. Each card shows the gun itself, turning, with its numbers in the corner, and its name underneath. It is one
     set of cards, moved to wherever it is needed.

     The turning guns are the real models, drawn by the game's own renderer into a small picture that is copied onto
     each card (one card a frame, and only while the cards are on screen). The rifle is the game's own model. */
  const STATS = { rifle: [['Damage', '26'], ['Rate', '720'], ['Rounds', '30']], shotgun: [['Damage', '9 x 13'], ['Rate', '300'], ['Rounds', '6']], sniper: [['Damage', '105'], ['Rate', '120'], ['Rounds', '5']] };
  const picked = [];                                                             // told when a card is chosen
  let cardsEl = null;
  function cards() {
    if (cardsEl) return cardsEl;
    const css = document.createElement('style');
    css.textContent = `.gun-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; width: 100%; pointer-events: auto; white-space: normal; text-shadow: none; text-align: left; }
      .gun-card { appearance: none; display: grid; grid-template-rows: auto auto; margin: 0; padding: 0; min-width: 0; cursor: pointer; text-align: left; color: var(--bone, #e8e4da); background: rgba(11, 13, 15, .78); border: 1px solid var(--line, rgba(232, 228, 218, .2)); border-radius: 2px; transition: border-color .18s ease, background .18s ease; }
      .gun-card:hover { border-color: var(--bone-dim, rgba(232, 228, 218, .64)); }
      .gun-card:focus-visible { outline: 2px solid var(--signal, #ffb347); outline-offset: 2px; }
      .gun-card[aria-pressed="true"] { border-color: var(--signal, #ffb347); background: rgba(34, 27, 16, .86); }
      .gun-card .gun-view { position: relative; display: block; aspect-ratio: 16 / 10; overflow: hidden; border-bottom: 1px solid var(--line, rgba(232, 228, 218, .2)); background: radial-gradient(ellipse at 50% 62%, rgba(232, 228, 218, .1), rgba(232, 228, 218, 0) 68%); }
      .gun-card[aria-pressed="true"] .gun-view { border-bottom-color: rgba(255, 179, 71, .45); }
      .gun-card canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
      .gun-card kbd { position: absolute; left: 8px; top: 8px; font: 500 11px/1 var(--f-mono, monospace); color: var(--bone-dim, rgba(232, 228, 218, .64)); }
      .gun-card dl { position: absolute; right: 8px; bottom: 7px; margin: 0; display: grid; grid-template-columns: auto auto; gap: 3px 8px; font: 500 10px/1 var(--f-mono, monospace); letter-spacing: .08em; text-transform: uppercase; text-align: right; text-shadow: 0 1px 2px rgba(0, 0, 0, .8); }
      .gun-card dt { color: var(--bone-dim, rgba(232, 228, 218, .64)); } .gun-card dd { margin: 0; color: var(--bone, #e8e4da); font-variant-numeric: tabular-nums; }
      .gun-card .gun-name { display: grid; gap: 6px; padding: 10px 10px 11px; }
      .gun-card strong { font: 700 17px/1.05 var(--f-display, Impact, sans-serif); letter-spacing: .03em; text-transform: uppercase; }
      .gun-card[aria-pressed="true"] strong { color: var(--signal, #ffb347); }
      .gun-card small { font: 500 10px/1 var(--f-mono, monospace); letter-spacing: .14em; text-transform: uppercase; color: var(--bone-dim, rgba(232, 228, 218, .64)); }
      .gun-cards.compact { gap: 8px; } .gun-cards.compact .gun-view { aspect-ratio: 16 / 9; } .gun-cards.compact .gun-name { padding: 9px 10px 10px; gap: 5px; } .gun-cards.compact strong { font-size: 16px; }
      /* large, for the panel opened in a match; a card that is lit (the one a click will take) lifts and brightens */
      .gun-cards.big { gap: 16px; }
      .gun-cards.big .gun-card { transition: border-color .12s ease, background .12s ease, transform .12s ease; }
      .gun-cards.big .gun-name { padding: 16px 16px 18px; gap: 9px; } .gun-cards.big strong { font-size: clamp(18px, 2.3vw, 28px); } .gun-cards.big small { font-size: 12px; }
      .gun-cards.big dl { right: 14px; bottom: 12px; gap: 5px 12px; font-size: 12px; } .gun-cards.big kbd { left: 14px; top: 14px; font-size: 15px; }
      .gun-card.at { border-color: var(--bone, #e8e4da); background: rgba(40, 44, 48, .92); transform: translateY(-6px); }
      .gun-card.at[aria-pressed="true"] { border-color: var(--signal, #ffb347); background: rgba(44, 34, 18, .94); }
      @media (max-width: 520px) { .gun-card dl { display: none; } .gun-card strong { font-size: 13px; } }
      @media (prefers-reduced-motion: reduce) { .gun-card, .gun-cards.big .gun-card { transition: none; } .gun-card.at { transform: none; } }`;
    document.head.appendChild(css);
    cardsEl = document.createElement('div'); cardsEl.className = 'gun-cards'; cardsEl.setAttribute('role', 'group'); cardsEl.setAttribute('aria-label', 'Gun');
    cardsEl.innerHTML = list.map((gun, i) => `<button type="button" class="gun-card" data-gun="${gun.id}" aria-pressed="false">
      <span class="gun-view"><canvas width="384" height="240" aria-hidden="true"></canvas><kbd>${i + 1}</kbd><dl>${STATS[gun.id].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></span>
      <span class="gun-name"><strong>${gun.name}</strong><small>${gun.short}</small></span></button>`).join('');
    cardsEl.addEventListener('click', e => { const b = e.target.closest('[data-gun]'); if (!b) return; api.pick(b.dataset.gun); mark(); for (const f of picked) f(b.dataset.gun); });
    mark();
    return cardsEl;
  }
  /* A pointer for the card shown when down. The game keeps the mouse captured, so the browser shows no cursor: this
     draws one that follows the mouse, lights the card under it and takes that card on a click. It is there only while
     the card is up, and it is not needed (and not shown) where the mouse is free or the screen is touched. */
  let ptr = null, ptrCard = null, px = 0, py = 0;
  function pointer(card) {
    if (!ptr) {
      const css = document.createElement('style');
      css.textContent = '.gun-pointer { position: fixed; left: 0; top: 0; z-index: 2000; width: 22px; height: 22px; pointer-events: none; display: none; filter: drop-shadow(0 1px 2px rgba(0,0,0,.8)); }';
      document.head.appendChild(css);
      ptr = document.createElement('div'); ptr.className = 'gun-pointer'; ptr.setAttribute('aria-hidden', 'true');
      ptr.innerHTML = '<svg viewBox="0 0 22 22" width="22" height="22"><path d="M2 1.5v16l4.4-3.9 2.9 6.6 2.6-1.1-2.9-6.5H15z" fill="#e8e4da" stroke="#0b0d0f" stroke-width="1.2" stroke-linejoin="round"/></svg>';
      document.body.appendChild(ptr);
      const under = () => { const el = document.elementFromPoint(px, py), c = el && el.closest ? el.closest('.gun-card') : null; if (cardsEl) for (const b of cardsEl.children) b.classList.toggle('at', b === c); return c; };
      const up = () => ptrCard && ptrCard.classList.contains('on') && !!document.pointerLockElement;
      document.addEventListener('mousemove', e => {
        if (!up()) { if (ptr.style.display !== 'none') { ptr.style.display = 'none'; if (cardsEl && !(menuEl && menuEl.classList.contains('on'))) for (const b of cardsEl.children) b.classList.remove('at'); } return; }
        px = clamp(px + (e.movementX || 0), 0, innerWidth - 2); py = clamp(py + (e.movementY || 0), 0, innerHeight - 2);
        ptr.style.display = 'block'; ptr.style.transform = `translate(${px}px, ${py}px)`; under();
      }, true);
      document.addEventListener('mousedown', e => { if (!up()) return; const c = under(); if (c) { api.pick(c.dataset.gun); mark(); } e.stopImmediatePropagation(); e.preventDefault(); }, true);
    }
    ptrCard = card;
    // start on the cards, so one small move reaches any of them
    const r = cardsEl ? cardsEl.getBoundingClientRect() : null; px = r && r.width ? r.left + r.width / 2 : innerWidth / 2; py = r && r.height ? r.top + r.height / 2 : innerHeight / 2;
    if (document.pointerLockElement) { ptr.style.display = 'block'; ptr.style.transform = `translate(${px}px, ${py}px)`; }
  }
  const mark = () => { if (!cardsEl) return; const id = api.choice(); for (const b of cardsEl.children) b.setAttribute('aria-pressed', String(b.dataset.gun === id)); };
  function mount(host, size) { const el = cards(); el.classList.toggle('compact', size === true || size === 'compact'); el.classList.toggle('big', size === 'big'); for (const b of el.children) b.classList.remove('at'); if (el.parentNode !== host) host.appendChild(el); mark(); spin(); return el; }      // size: 'compact', 'big' or nothing

  let turning = null;
  function turntable() {
    if (turning || !G || !G.renderer || !G.scene || !weapon) return turning;
    const T = G.THREE, r = G.renderer, W = 384, H = 240, rt = new T.WebGLRenderTarget(W, H), scene = new T.Scene(), cam = new T.PerspectiveCamera(22, W / H, 0.1, 10);
    cam.position.set(0, 0.26, 2.05); cam.lookAt(0, 0, 0); cam.layers.enableAll();
    const key = new T.DirectionalLight(0xfff1dc, 6), fill = new T.DirectionalLight(0xa9c2e0, 3.2), back = new T.DirectionalLight(0xffffff, 4); key.position.set(1.2, 1.8, 1.6); fill.position.set(-1.6, 0.4, 1.0); back.position.set(0.2, 1.2, -2);
    scene.add(key, fill, back, new T.HemisphereLight(0xe6ecf5, 0x5a544a, 2.2));  // a lot of light: these are black guns on a dark card
    const guns = {}, buf = new Uint8Array(W * H * 4), gamma = new Uint8ClampedArray(256); for (let v = 0; v < 256; v++) gamma[v] = Math.round(255 * Math.pow(Math.min(1, (v / 255) * 1.7), 1 / 2.2));     // lifted, then to screen values
    const build = id => {
      const rig = weapon.rigs[id]; if (!rig || (id !== 'rifle' && !rig.info.meshes)) return null;
      const pivot = new T.Group(), body = new T.Group(), src = rig.root; let n = 0;
      src.traverse(o => { if (!o.isMesh || !o.material || !o.material.isMeshStandardMaterial || o.material.name === 'weapon_markings') return; const m = new T.Mesh(o.geometry, o.material); m.frustumCulled = false; if (o.parent && o.parent !== src) { m.position.copy(o.parent.position); m.quaternion.copy(o.parent.quaternion); } body.add(m); n++; });
      if (!n) return null;
      const box = new T.Box3().setFromObject(body), c = box.getCenter(new T.Vector3()), size = box.getSize(new T.Vector3());
      body.position.sub(c); pivot.add(body); pivot.scale.setScalar(1.22 / Math.max(size.x, size.y, size.z)); scene.add(pivot);
      return pivot;
    };
    const tone = new T.Color();
    return (turning = { draw(i, canvas, t) {
      const id = list[i].id; if (!guns[id]) guns[id] = build(id); if (!guns[id]) return;
      for (const k of Object.keys(guns)) if (guns[k]) guns[k].visible = k === id;
      guns[id].rotation.y = Math.PI / 2 + t * 0.65 + i * 0.9;
      scene.environment = G.scene.environment; scene.environmentIntensity = 1.1;
      // borrow the game's renderer for one small picture, and give it back exactly as it was
      const was = { rt: r.getRenderTarget(), auto: r.autoClear, shadows: r.shadowMap.autoUpdate, alpha: r.getClearAlpha() }; r.getClearColor(tone);
      try {
        r.shadowMap.autoUpdate = false; r.autoClear = true; r.setClearColor(0x000000, 0); r.setRenderTarget(rt); r.clear(); r.render(scene, cam); r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
      } finally { r.setRenderTarget(was.rt); r.autoClear = was.auto; r.shadowMap.autoUpdate = was.shadows; r.setClearColor(tone, was.alpha); }
      const ctx = canvas.getContext('2d'), img = ctx.createImageData(W, H), d = img.data;
      for (let y = 0; y < H; y++) { let s = (H - 1 - y) * W * 4, o = y * W * 4; for (let x = 0; x < W; x++, s += 4, o += 4) { d[o] = gamma[buf[s]]; d[o + 1] = gamma[buf[s + 1]]; d[o + 2] = gamma[buf[s + 2]]; d[o + 3] = buf[s + 3]; } }
      ctx.putImageData(img, 0, 0);
    } });
  }
  let spinning = false;
  function spin() {
    if (spinning) return; spinning = true;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches; let i = 0, failed = 0, drawn = 0;
    const tick = () => {
      const el = cardsEl, host = el && el.isConnected ? el.closest('.net-gate, .mp-down, .gun-menu') : null;
      const live = !!host && (host.classList.contains('net-gate') ? !host.hidden : host.classList.contains('on'));
      if (live && window.__ready && failed < 3 && !(still && drawn >= list.length * 4)) {
        try { const tt = turntable(); if (tt) { tt.draw(i, el.children[i].querySelector('canvas'), still ? 0.6 : performance.now() / 1000); drawn++; } }
        catch (e) { failed++; console.error('[guns] card picture: ' + (e && e.stack || e)); }
        i = (i + 1) % list.length;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------------ ammo on the map
     Two places on every map hold a set of ammunition, lying on top of something that is already there (a crate, a
     stack, a barrier). Come within reach and hold the reload key: a ring fills, and every gun's reserve is full again.
     The set is then gone for everyone, and a new one is there a minute and a half later.

     The two places are found, not listed: among the map's own solid boxes, the two low tops furthest from each other.
     Every player's game finds the same two. Who took which set, and when, travels with each player's state. */
  const AMMO = { back: 90, hold: 1.2, reach: 2.4 };
  const stations = [], taken = [];                                            // taken: what this player took, [[place, second], ...]
  let ammoEl = null, holding = false;
  function ammoPile(T) {
    const g = new T.Group(), mat = (c, r, m) => new T.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
    const olive = mat(0x4a5235, 0.62, 0.35), dark = mat(0x23261d, 0.5, 0.6);
    const box = (m, w, h, d, x, y, z, yaw = 0) => { const o = new T.Mesh(new T.BoxGeometry(w, h, d), m); o.position.set(x, y + h / 2, z); o.rotation.y = yaw; o.castShadow = o.receiveShadow = true; g.add(o); return o; };
    for (const [x, z, yaw, y] of [[-0.14, 0.02, 0.12, 0], [0.16, -0.05, -0.2, 0], [0.02, 0, 0.5, 0.19]]) {              // three steel cans, one on the others
      box(olive, 0.28, 0.18, 0.15, x, y, z, yaw); box(dark, 0.29, 0.02, 0.16, x, y + 0.18, z, yaw); box(dark, 0.1, 0.012, 0.02, x, y + 0.2, z, yaw);
    }
    for (const o of g.children) o.position.z -= 0.16;                                                                   // the cans stand at the back
    // the nine boxes in two meshes, one per material: two draws where there were nine, nothing different to see
    for (const m of [olive, dark]) {
      const parts = g.children.filter(o => o.isMesh && o.material === m); if (parts.length < 2) continue;
      let nv = 0, ni = 0; for (const o of parts) { o.updateMatrix(); nv += o.geometry.attributes.position.count; ni += o.geometry.index.count; }
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint16Array(ni), v = new T.Vector3(), nm = new T.Matrix3();
      let vo = 0, io = 0;
      for (const o of parts) {
        const ge = o.geometry, P = ge.attributes.position, N = ge.attributes.normal, U = ge.attributes.uv; nm.getNormalMatrix(o.matrix);
        for (let k = 0; k < P.count; k++) { v.fromBufferAttribute(P, k).applyMatrix4(o.matrix); pos.set([v.x, v.y, v.z], (vo + k) * 3); v.fromBufferAttribute(N, k).applyMatrix3(nm).normalize(); nor.set([v.x, v.y, v.z], (vo + k) * 3); uv[(vo + k) * 2] = U.getX(k); uv[(vo + k) * 2 + 1] = U.getY(k); }
        for (let k = 0; k < ge.index.count; k++) idx[io++] = ge.index.getX(k) + vo;
        vo += P.count; g.remove(o); ge.dispose();
      }
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.BufferAttribute(nor, 3)); geo.setAttribute('uv', new T.BufferAttribute(uv, 2)); geo.setIndex(new T.BufferAttribute(idx, 1)); geo.computeBoundingSphere();
      const one = new T.Mesh(geo, m); one.castShadow = one.receiveShadow = true; g.add(one);
    }
    // in front of them, the loose rounds: the model in web/guns/ammo.* (six kinds of cartridge), when it has arrived
    load('ammo').then(a => {
      if (!a) return;
      const mats = materials(T, a.manifest, 'ammo'), set = new T.Group();
      for (const { part, geo } of geometries(T, a, [0, 0, 0])) { const m = new T.Mesh(geo, mats[part.material]); m.castShadow = m.receiveShadow = true; set.add(m); }
      set.scale.setScalar(1.05); set.position.set(0, 0, 0.17); g.add(set);
    }).catch(e => console.error('[guns] ammo model: ' + e));
    return g;
  }
  function ammoSetup(g) {
    const T = g.THREE, ph = g.physics, B = ph.bounds, tops = [];
    for (const b of ph.boxes || []) {
      if (b.bulletOnly || b.playerOnly) continue;
      const w = b.max.x - b.min.x, d = b.max.z - b.min.z, y = b.max.y, x = (b.min.x + b.max.x) / 2, z = (b.min.z + b.max.z) / 2;
      if (y < 0.5 || y > 1.45 || w < 0.7 || d < 0.7 || w > 3.2 || d > 3.2) continue;
      if (B && (x < B.min.x + 3 || x > B.max.x - 3 || z < B.min.z + 3 || z > B.max.z - 3)) continue;
      if (Math.abs(ph.groundHeight(x, z, y + 0.05) - y) > 0.02 || ph.groundHeight(x, z, y + 2.2) > y + 0.02) continue;      // its own top, and nothing over it
      let walk = 0; for (let a = 0; a < 8; a++) { const px = x + Math.cos(a * Math.PI / 4) * (Math.max(w, d) / 2 + 0.7), pz = z + Math.sin(a * Math.PI / 4) * (Math.max(w, d) / 2 + 0.7); if (ph.groundHeight(px, pz, 0.4) < 0.1 && (!ph.nav || !ph.nav.isWalkable || ph.nav.isWalkable(px, pz))) walk++; }
      if (walk >= 3) tops.push({ x, y, z });
    }
    let best = null;
    for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) { const dd = Math.hypot(tops[i].x - tops[j].x, tops[i].z - tops[j].z); if (!best || dd > best.dd + 1e-6) best = { dd, a: tops[i], b: tops[j] }; }
    if (!best) { console.warn('[guns] no place for ammo on this map'); return; }
    for (const p of [best.a, best.b]) { const pile = ammoPile(T); pile.position.set(p.x, p.y, p.z); pile.rotation.y = (p.x * 7 + p.z * 3) % 6.28; g.scene.add(pile); stations.push({ x: p.x, y: p.y, z: p.z, pile, taken: 0 }); }
    const css = document.createElement('style');
    css.textContent = `.gun-ammo { position: absolute; left: 50%; top: 58%; z-index: 5; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; opacity: 0; pointer-events: none; transition: opacity .15s ease; font: 500 12px/1 var(--f-mono, monospace); letter-spacing: .12em; text-transform: uppercase; color: var(--bone, #e8e4da); text-shadow: var(--shadow, 0 1px 2px #000); white-space: nowrap; }
      .gun-ammo.on { opacity: 1; }
      .gun-ammo svg { width: 46px; height: 46px; transform: rotate(-90deg); }
      .gun-ammo circle { fill: none; stroke-width: 4; }
      .gun-ammo .track { stroke: rgba(232, 228, 218, .25); } .gun-ammo .fill { stroke: var(--signal, #ffb347); stroke-linecap: butt; stroke-dasharray: 119.4; stroke-dashoffset: 119.4; }
      .gun-ammo.wait .fill { stroke: rgba(232, 228, 218, .6); }
      @media (prefers-reduced-motion: reduce) { .gun-ammo { transition: none; } }`;
    document.head.appendChild(css);
    ammoEl = document.createElement('div'); ammoEl.className = 'gun-ammo'; ammoEl.setAttribute('role', 'status');
    ammoEl.innerHTML = '<svg viewBox="0 0 46 46" aria-hidden="true"><circle class="track" cx="23" cy="23" r="19"/><circle class="fill" cx="23" cy="23" r="19"/></svg><span></span>';
    (document.getElementById('app') || document.body).appendChild(ammoEl);
    const ring = ammoEl.querySelector('.fill'), text = ammoEl.querySelector('span'), keyName = () => { const k = Object.keys(window.__SALTLINE_KEYS || {}).find(c => window.__SALTLINE_KEYS[c] === 'reload') || 'KeyR'; return k.replace(/^Key|^Digit/, ''); };
    const isReload = e => (window.__SALTLINE_KEYS || {})[e.code] === 'reload';
    window.addEventListener('keydown', e => { if (isReload(e)) holding = true; });
    window.addEventListener('keyup', e => { if (isReload(e)) holding = false; });
    window.addEventListener('blur', () => { holding = false; });
    document.addEventListener('pointerdown', e => { if (e.target.closest && e.target.closest('.t-reload')) holding = true; }, true);
    document.addEventListener('pointerup', () => { if (!document.pointerLockElement) holding = false; }, true);
    let prog = 0, last = performance.now(), doneUntil = 0;
    const tick = () => {
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000), sec = Date.now() / 1000, P = g.player; last = now;
      for (const st of stations) st.pile.visible = sec - st.taken >= AMMO.back;
      const live = !!document.querySelector('.mp-live') && g.game && g.game.state === 'playing' && P && P.alive !== false && P.enabled !== false && !(menuEl && menuEl.classList.contains('on'));
      let near = null; if (live) for (const st of stations) if (Math.hypot(st.x - P.pos.x, st.z - P.pos.z) < AMMO.reach && Math.abs(st.y - P.pos.y) < 2.2) near = st;
      if (!near) { prog = 0; if (now > doneUntil) ammoEl.classList.remove('on'); }
      else {
        const left = AMMO.back - (sec - near.taken);
        if (left > 0) { prog = 0; if (now > doneUntil) { ammoEl.className = 'gun-ammo on wait'; ring.style.strokeDashoffset = String(119.4 * (left / AMMO.back)); text.textContent = 'Ammo back in ' + Math.floor(left / 60) + ':' + String(Math.ceil(left % 60) % 60).padStart(2, '0'); } }
        else {
          prog = holding ? prog + dt / AMMO.hold : 0;
          ammoEl.className = 'gun-ammo on'; ring.style.strokeDashoffset = String(119.4 * (1 - Math.min(1, prog))); text.textContent = 'Hold ' + keyName() + '  ·  Restock ammo';
          if (prog >= 1) {
            prog = 0; holding = false; near.taken = Math.round(sec); const i = stations.indexOf(near), row = taken.find(r => r[0] === i); if (row) row[1] = near.taken; else taken.push([i, near.taken]);
            for (const rig of Object.values(weapon.rigs)) rig.slot.reserve = rig.def.reserve;
            try { g.audio.play('reload_magin', { gain: 1, pitch: 0.9 }); g.audio.play('gear_rustle', { gain: 1 }); } catch { /* fine */ }
            text.textContent = 'Ammo restocked'; ring.style.strokeDashoffset = '0'; doneUntil = now + 1400;
          }
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  Object.assign(wire, {
    ammoWire: () => (taken.length ? taken.map(r => r.slice()) : null),
    ammoSeen(list) { if (!Array.isArray(list)) return; const sec = Date.now() / 1000; for (const r of list) { const st = Array.isArray(r) && stations[r[0]], t = +r[1]; if (st && Number.isFinite(t) && t <= sec + 5 && t > st.taken) st.taken = t; } },
  });

  /* ------------------------------------------------------------------ what the game calls */
  const api = (window.__SALTLINE_GUNS = {
    ...wire, list, ready, spec: SPEC, ammo: stations,
    name: id => (list.find(g => g.id === id) || list[0]).name,
    short: id => (list.find(g => g.id === id) || list[0]).short,
    mount: (host, size) => mount(host, size),                           // the three cards, put into this element
    choice: () => (IDS.includes(read(KEY)) ? read(KEY) : 'rifle'),
    // the gun to bring: remembered, and taken up at the next spawn (or now, with take)
    pick(id, take) {
      if (!IDS.includes(id)) return false;
      write(KEY, id);
      if (weapon) {
        weapon.primary = id; weapon.slots[0] = weapon.rigs[id].slot;
        // take: put away what is held and draw this one (the game's own switch, with its sounds); if that is not possible, just hold it
        if (take && weapon.current !== id) try { scopeOff(); if (weapon.root && weapon.root.visible && weapon.switchTo) weapon.switchTo(id); else weapon.equip(id); } catch { try { weapon.equip(id); } catch { /* fine */ } }
      }
      return true;
    },
    build(d, table, guns) {
      G = d.G;
      for (const id of Object.keys(SPEC)) { try { const rig = makeRig(d, table, id); table[id] = rig; guns.push(rig); } catch (e) { console.error('[guns] ' + id + ' could not be built: ' + (e && e.stack || e)); } }
      const wait = setInterval(() => { if (d.G.weapon) { clearInterval(wait); api.attach(d.G); } }, 50);          // the weapon module is still being made at this point
    },
    // once the weapon module exists
    attach(g) {
      G = g; weapon = g.weapon; if (!weapon || weapon.__guns) return; weapon.__guns = 1;
      weapon.primary = 'rifle';
      Object.defineProperty(weapon, 'adsFov', { get: () => { const r = weapon.rigs[weapon.current]; return visible && r && r.def.adsFov ? zoomNow : 0; } });
      const setVisible = weapon.setVisible; weapon.setVisible = b => { visible = !!b; if (!b) scopeOff(); return setVisible(b); };
      const reset = weapon.reset; weapon.reset = () => { scopeOff(); return reset(); };
      g.events.on('weapon:switch', scopeOff);
      try { gunMenu(g); } catch (e) { console.error('[guns] menu: ' + e); }
      scopeSetting(); musicSetting();
      const whenBuilt = setInterval(() => { if (!window.__ready) return; clearInterval(whenBuilt); try { ammoSetup(g); } catch (e) { console.error('[guns] ammo: ' + (e && e.stack || e)); } }, 300);
    },
  });

  /* The music's own volume (Settings, under Master volume). The game mixes music at one fixed level; this scales that
     level, before the sound engine starts and again whenever the slider moves. Half by default: at full it sat over
     the footsteps and voices. */
  const MUSIC_KEY = 'saltline.musicVol', musicVol = () => { const v = parseFloat(read(MUSIC_KEY)); return Number.isFinite(v) ? clamp(v, 0, 1.5) : 0.5; };
  let musicBase = null, mixer = null;
  function music(consts) {
    mixer = consts && consts.gunSound && consts.gunSound.mix; if (!mixer) return;
    if (musicBase == null) musicBase = mixer.musicBus;
    mixer.musicBus = musicBase * musicVol();
    try { if (mixer.musicNode) mixer.musicNode.gain.value = mixer.musicBus; } catch { /* fine */ }
  }
  function musicSetting() {
    const wait = setInterval(() => {
      const vol = document.getElementById('s-vol'), row = vol && vol.closest('.row'); if (!row) return; clearInterval(wait);
      const mine = document.createElement('div'); mine.className = 'row';
      mine.innerHTML = '<label for="s-music">Music volume</label><div class="slider"><input id="s-music" type="range" min="0" max="1.5" step="0.05"><output></output></div>';
      row.after(mine);
      const input = mine.querySelector('input'), out = mine.querySelector('output'), show = () => { out.textContent = Math.round(+input.value * 100) + '%'; };
      input.value = String(musicVol()); show();
      input.addEventListener('input', () => { write(MUSIC_KEY, input.value); show(); if (G) music(G.consts); });
    }, 500);
  }

  // sounds must be in the game's table before its sound engine starts: the map script's boot call is the moment
  const boot = window.__SALTLINE_BOOT;
  window.__SALTLINE_BOOT = async g => { try { sounds(g.consts); music(g.consts); } catch (e) { console.error('[guns] sounds: ' + (e && e.stack || e)); } return boot ? boot(g) : undefined; };
})();
