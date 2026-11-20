/* The path of a cooked grenade, shown while the frag key is held: where it would go if it were let go now.
   What is drawn follows what reads best in other shooters (Critical Ops draws its arc only up to the first thing the
   grenade would hit; PUBG's own guide warns that a long arc misleads, and Apex players trust its landing mark over its
   line): red dots along the flight up to the first thing it hits, a ring lying on that surface, and a target where it
   ends up after any bounces, which is where it goes off (or comes to rest before the fuse runs out). The target faces the
   eye and keeps its size on screen at any distance; it and the ring show through walls and floors; the dots do not, so
   what is in the way can still be seen.
   The throw is the game's own (releaseFrag: from just in front of the eye, at FRAG.speed along the view, FRAG.lift up,
   half the player's run added) and the flight is the game's own steps (stepFrags, in fixed 1/120 s steps since gun hook
   24, with gun hook 22's floor ray), so the dots are where the grenade will be. Only the thrower sees it. The game calls
   step() every frame from stepFrags (gun hook 23); net.js loads this file. */
(() => {
  'use strict';
  const DT = 1 / 120, MAX_STEPS = 520, RESIM_MS = 40, GAP = 0.5, SKIP = 2.0, COLOR = 0xff3b30;
  let T = null, dots = null, ring = null, fill = null, endMark = null, geo = null, lastSim = 0, lastStep = 0;
  let pos, vel, dir, o, down, up, tmp;
  const MAX_DOTS = 160, path = [];
  // the game puts its cook label (Let go to throw, and the fuse bar) just under the crosshair: right where a throw lands on
  // screen, over the ring and the target. It moves down near the bottom of the view, out of the way of the aim
  { const st = document.createElement('style'); st.textContent = '.mp-cook { top: auto !important; bottom: calc(96px + var(--sab, 0px)) !important; }'; document.head.appendChild(st); }
  let impact = null, impactN = null, end = null, endN = null;

  // where it goes off: a target (ring and dot, outlined dark so it reads on sky and on stone) that always faces the eye
  function target() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    for (const [w, col] of [[16, 'rgba(11,13,15,.55)'], [9, '#ff3b30']]) { x.lineWidth = w; x.strokeStyle = col; x.beginPath(); x.arc(64, 64, 42, 0, Math.PI * 2); x.stroke(); }
    x.fillStyle = 'rgba(11,13,15,.55)'; x.beginPath(); x.arc(64, 64, 15, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#ff3b30'; x.beginPath(); x.arc(64, 64, 11, 0, Math.PI * 2); x.fill();
    const t = new T.CanvasTexture(c); t.needsUpdate = true; return t;
  }
  function disc() {          // a soft round dot
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,1)'); g.addColorStop(0.75, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const t = new T.CanvasTexture(c); t.needsUpdate = true; return t;
  }
  function make(G) {
    T = G.THREE;
    pos = new T.Vector3(); vel = new T.Vector3(); dir = new T.Vector3(); o = new T.Vector3(); down = new T.Vector3(0, -1, 0); up = new T.Vector3(0, 1, 0); tmp = new T.Vector3();
    geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(new Float32Array(MAX_DOTS * 3), 3)); geo.setDrawRange(0, 0);
    // the same few pixels near and far: near dots do not smear over the aim, far ones stay visible
    dots = new T.Points(geo, new T.PointsMaterial({ color: COLOR, size: 7 * Math.min(2, window.devicePixelRatio || 1), sizeAttenuation: false, map: disc(), transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, fog: false }));
    // the marks where it lands are seen through anything (walls, floors, roofs), so a throw over or into a building can be aimed
    const flat = (g, op) => new T.Mesh(g, new T.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: op, depthWrite: false, depthTest: false, side: T.DoubleSide, toneMapped: false, fog: false }));
    ring = flat(new T.RingGeometry(0.34, 0.46, 48), 0.9); fill = flat(new T.CircleGeometry(0.34, 48), 0.22);
    // the same size on screen near and far (about 5% of its height, some 30 px on a laptop), seen through anything
    endMark = new T.Sprite(new T.SpriteMaterial({ map: target(), transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false, fog: false }));
    endMark.scale.set(0.11, 0.11, 1);
    for (const m of [dots, ring, fill, endMark]) { m.frustumCulled = false; m.renderOrder = m === dots ? 50 : m === endMark ? 61 : 60; m.visible = false; G.scene.add(m); }
    // hide when the game stops asking (paused, menus, down)
    dots.onBeforeRender = () => { if (performance.now() - lastStep > 150) hide(); };
  }
  function hide() { if (dots) dots.visible = ring.visible = fill.visible = endMark.visible = false; }

  // the flight, step by step as stepFrags flies a grenade, from the throw releaseFrag would make now
  function simulate(G, P, FRAG, fuse) {
    const ph = G.physics, d = P.forward, e = P.eye, pv = P.vel || { x: 0, z: 0 };
    pos.set(e.x + d.x * 0.55, e.y - 0.12 + d.y * 0.55, e.z + d.z * 0.55);
    vel.set(d.x * FRAG.speed + pv.x * 0.5, d.y * FRAG.speed + FRAG.lift, d.z * FRAG.speed + pv.z * 0.5);
    path.length = 0; path.push(pos.clone()); impact = null; impactN = null; endN = null;
    let t = Math.max(0.05, fuse), still = 0;
    for (let s = 0; s < MAX_STEPS && t > 0; s++) {
      vel.y -= FRAG.gravity * DT;
      const len = vel.length() * DT;
      let hit = null;
      if (len > 1e-5) { dir.copy(vel).normalize(); try { hit = ph.raycast(pos, dir, len + 0.07); } catch { hit = null; } }
      if (hit && hit.normal) {
        const n = hit.normal, vn = vel.x * n.x + vel.y * n.y + vel.z * n.z;
        if (!impact) { impact = hit.point.clone(); impactN = n.clone(); }
        pos.copy(hit.point).addScaledVector(n, 0.07);
        if (vn < 0) {
          vel.addScaledVector(n, -(1 + FRAG.bounce) * vn);
          const k = n.y > 0.5 ? 0.72 : 0.85; vel.x *= k; vel.z *= k;
          if (n.y > 0.5 && Math.abs(vel.y) < 1.2) vel.y = 0;
        }
      } else pos.addScaledVector(vel, DT);
      let floor = -1e9, fn = null;
      try { const ce = ph.raycast(o.set(pos.x, pos.y, pos.z), up, 0.6), lift = ce ? Math.max(0, ce.dist - 0.02) : 0.6; const dn = ph.raycast(o.set(pos.x, pos.y + lift, pos.z), down, lift + 1.5); if (dn) { floor = dn.point.y; fn = dn.normal; } } catch { floor = -1e9; }
      if (pos.y < floor + 0.06 && pos.y > floor - 1.5) {
        if (!impact) { impact = new T.Vector3(pos.x, floor, pos.z); impactN = fn ? fn.clone() : up.clone(); }
        endN = fn;
        pos.y = floor + 0.06; if (vel.y < 0) { vel.y = -vel.y * FRAG.bounce; vel.x *= 0.72; vel.z *= 0.72; if (vel.y < 1.2) vel.y = 0; }
      }
      if (pos.y < -6) break;
      t -= DT;
      if (!impact) path.push(pos.clone());
      if (vel.lengthSq() < 0.04) { if (++still > 8) break; } else still = 0;
    }
    end = pos.clone();
  }

  // dots every 50 cm along the flight to the first hit, leaving the first two metres clear of the view
  function placeDots() {
    const A = geo.attributes.position.array; let n = 0, along = 0, next = SKIP;
    for (let i = 1; i < path.length && n < MAX_DOTS; i++) {
      const a = path[i - 1], b = path[i], seg = a.distanceTo(b);
      while (next <= along + seg && n < MAX_DOTS) { tmp.lerpVectors(a, b, seg > 1e-6 ? (next - along) / seg : 0); A.set([tmp.x, tmp.y, tmp.z], n * 3); n++; next += GAP; }
      along += seg;
    }
    geo.attributes.position.needsUpdate = true; geo.setDrawRange(0, n);
    return n;
  }
  function lay(mesh, at, n) {
    const nn = n && n.y < 0 ? n.clone().negate() : (n || up);
    mesh.position.copy(at).addScaledVector(nn, 0.03);
    mesh.quaternion.setFromUnitVectors(tmp.set(0, 0, 1), nn);
    mesh.visible = true;
  }

  window.__SALTLINE_FRAGPATH = {
    step(G, P, FRAG, cook) {
      if (!G || !G.THREE || !G.scene) return;
      if (!dots) make(G);
      lastStep = performance.now();
      if (!cook || !P || !P.eye || !P.forward) { hide(); return; }
      if (lastStep - lastSim > RESIM_MS || !dots.visible) {
        lastSim = lastStep; simulate(G, P, FRAG, cook.t);
        dots.visible = placeDots() > 0;
        if (impact) { lay(ring, impact, impactN); lay(fill, impact, impactN); } else ring.visible = fill.visible = false;
        // where it ends up, when that is away from the first hit
        // where it goes off, always: lifted a little so it sits on the floor rather than in it
        if (end) { endMark.position.copy(end); endMark.position.y += 0.12; endMark.visible = true; } else endMark.visible = false;
      }
    },
    // for checking from the console: the flight of a throw from where the player is now
    simulate(G, P, FRAG, fuse) { if (!dots) make(G); simulate(G, P, FRAG, fuse); return { impact: impact && impact.toArray(), end: end && end.toArray(), dots: placeDots() }; },
  };
})();
