/* The whole map on the pause screen, in the top right corner (the pause card has the top left).
   It is drawn the way the minimap draws its corner, from the same walk grid (G.physics.nav), but whole and with north
   up: the outlines of everything players walk round, the two ammo sets (dim while a set is gone), you (the arrow, the
   way you face), your team in Team deathmatch, and an opponent for three seconds after they fire. That is no more than
   the minimap shows, so pausing tells nobody anything extra.
   net.js loads it. It reads window.__G, window.__SALTLINE_MATCH (map hook 7 in scripts/map-hooks.mjs) and
   window.__SALTLINE_GUNS.ammo. It draws only while the pause card is up (not while Settings or Controls is open over
   the right side), ten times a second, and needs room beside the card: on a narrow screen it stays away. */
(() => {
  'use strict';
  const CELL = 0.5, MAX_CELLS = 360000, SHOT_MS = 3000, GAP = 24, MAX_W = 460, MIN_W = 180;
  const css = document.createElement('style');
  css.textContent = `
    .net-map { position: absolute; z-index: 2; top: max(24px, calc(12px + var(--sat, 0px))); right: max(24px, var(--gr, 24px));
      padding: 14px 16px 13px; background: var(--plate-solid, rgba(11,13,15,.9)); border: 1px solid var(--line, rgba(232,228,218,.2));
      border-top: 3px solid var(--signal, #ffb347); pointer-events: none; opacity: 0; visibility: hidden; transition: opacity .2s ease, visibility 0s linear .2s; }
    .net-map.on { opacity: 1; visibility: visible; transition: opacity .2s ease, visibility 0s; }
    .net-map-name { margin: 0 0 11px; font: 600 12px/1 var(--f-label, sans-serif); letter-spacing: .28em; text-transform: uppercase; color: var(--steel, #8d9aa3); }
    .net-map canvas { display: block; }
    .net-map-key { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 11px 0 0; padding: 0; list-style: none; font: 500 11px/1 var(--f-label, sans-serif); letter-spacing: .2em; text-transform: uppercase; color: var(--bone-dim, rgba(232,228,218,.64)); }
    .net-map-key li { display: flex; align-items: center; gap: 7px; }
    .net-map-key li[hidden] { display: none; }
    .net-map-key i { flex: none; display: block; width: 10px; height: 10px; }
    .net-map-key .you { background: var(--bone, #e8e4da); clip-path: polygon(50% 0, 100% 100%, 50% 76%, 0 100%); }
    .net-map-key .mate { width: 8px; height: 8px; margin: 1px; background: var(--bone, #e8e4da); transform: rotate(45deg); }
    .net-map-key .ammo { width: 8px; height: 8px; border: 1.5px solid var(--signal, #ffb347); background: rgba(255,179,71,.35); box-sizing: border-box; }
    .net-map-key .shot { width: 8px; height: 8px; margin: 1px; border-radius: 50%; background: var(--alarm, #ff5a40); }
    @media (prefers-reduced-motion: reduce) { .net-map, .net-map.on { transition: none; } }`;
  document.head.appendChild(css);

  let G = null, el = null, cv = null, ctx = null, key = null, grid = null, paint = null, on = false, gone = false;

  // which cells players can walk on, over the part of the map they can reach (the bounds can run far past it: Maram's desert)
  function makeGrid() {
    const ph = G.physics, nav = ph && ph.nav;
    if (!nav || typeof nav.isWalkable !== 'function') return null;
    const b = ph.bounds || { min: { x: -40, z: -30 }, max: { x: 40, z: 30 } };
    const walk = (x, z) => { try { return !!nav.isWalkable(x, z); } catch { return false; } };
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let z = b.min.z + 1; z < b.max.z; z += 2) for (let x = b.min.x + 1; x < b.max.x; x += 2) if (walk(x, z)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    if (!(x1 > x0 && z1 > z0)) return null;
    x0 = Math.max(b.min.x, x0 - 4); z0 = Math.max(b.min.z, z0 - 4); x1 = Math.min(b.max.x, x1 + 4); z1 = Math.min(b.max.z, z1 + 4);
    let cell = CELL; while ((x1 - x0) * (z1 - z0) / (cell * cell) > MAX_CELLS) cell *= 1.5;
    const nx = Math.ceil((x1 - x0) / cell), nz = Math.ceil((z1 - z0) / cell), open = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) open[j * nx + i] = walk(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell) ? 1 : 0;
    return { open, nx, nz, x0, z0, cell, w: nx * cell, h: nz * cell };
  }

  // the outlines, drawn once for the size shown: what stands next to open ground is a line, the mass behind it stays faint (as on the minimap)
  function paintGrid(W, H) {
    const g = grid, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'), sx = W / g.nx, sz = H / g.nz;
    for (const edgePass of [false, true]) {
      x.fillStyle = edgePass ? 'rgba(232,228,218,.5)' : 'rgba(232,228,218,.1)';
      for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) {
        if (g.open[j * g.nx + i]) continue;
        let edge = false;
        for (let dj = -1; dj <= 1 && !edge; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, q = j + dj; if (a >= 0 && q >= 0 && a < g.nx && q < g.nz && g.open[q * g.nx + a]) { edge = true; break; } }
        if (edge !== edgePass) continue;
        const px = Math.round(i * sx), pz = Math.round(j * sz);
        x.fillRect(px, pz, Math.round((i + 1) * sx) - px, Math.round((j + 1) * sz) - pz);
      }
    }
    return c;
  }

  function build() {
    const card = document.querySelector('#ui [data-s="paused"]');
    if (!card || !card.parentElement) return false;
    el = document.createElement('div'); el.className = 'net-map'; el.setAttribute('role', 'img');
    const maps = window.__saltlineMaps, name = maps && maps.name ? maps.name(maps.id) : 'Map';
    el.setAttribute('aria-label', 'Map of ' + name + '. The arrow is you');
    el.innerHTML = '<p class="net-map-name"></p><canvas></canvas><ul class="net-map-key"><li><i class="you"></i>You</li><li data-k="mate"><i class="mate"></i>Team</li><li data-k="ammo"><i class="ammo"></i>Ammo</li><li data-k="shot"><i class="shot"></i>Firing</li></ul>';
    el.querySelector('.net-map-name').textContent = name;
    cv = el.querySelector('canvas'); ctx = cv.getContext('2d'); key = el.querySelector('.net-map-key');
    card.parentElement.appendChild(el);
    return true;
  }

  // the size: as wide as the room right of the pause card allows (up to 460 px), as tall as the screen allows, in the map's own shape
  function layout() {
    const card = document.querySelector('#ui [data-s="paused"]'), r = card ? card.getBoundingClientRect() : null;
    if (!r || !grid) return false;
    const chrome = 16 * 2 + 2, free = innerWidth - r.right - GAP - Math.max(24, parseFloat(getComputedStyle(el).right) || 24) - chrome;
    let w = Math.min(MAX_W, free), h = w * grid.h / grid.w;
    const hMax = innerHeight - 48 - 80;
    if (h > hMax) { h = hMax; w = h * grid.w / grid.h; }
    if (w < MIN_W || h < 120) return false;
    w = Math.floor(w); h = Math.floor(h);
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = Math.round(w * dpr), H = Math.round(h * dpr);
    // the panel's width is set with its padding and border in it: the game's own rules decide box-sizing inside #ui
    if (!paint || paint.width !== W || paint.height !== H) { cv.width = W; cv.height = H; cv.style.width = w + 'px'; cv.style.height = h + 'px'; el.style.boxSizing = 'border-box'; el.style.width = (w + chrome) + 'px'; paint = paintGrid(W, H); }
    return true;
  }

  function draw() {
    const P = G.player, c = ctx, W = cv.width, H = cv.height, d = W / parseFloat(cv.style.width), k = W / grid.w / d, now = performance.now();
    const M = window.__SALTLINE_MATCH, live = !!(M && M.live), tdm = live && M.mode === 'tdm';
    const ammo = (window.__SALTLINE_GUNS && window.__SALTLINE_GUNS.ammo) || [];
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H); c.drawImage(paint, 0, 0);
    c.setTransform(d, 0, 0, d, 0, 0);
    const at = (x, z) => [(x - grid.x0) * k, (z - grid.z0) * k];
    for (const st of ammo) {
      const [x, y] = at(st.x, st.z), up = !st.pile || st.pile.visible !== false;
      c.fillStyle = up ? 'rgba(255,179,71,.35)' : 'rgba(232,228,218,.06)'; c.fillRect(x - 4.5, y - 4.5, 9, 9);
      c.strokeStyle = up ? '#ffb347' : 'rgba(232,228,218,.4)'; c.lineWidth = 1.5; c.strokeRect(x - 4.5, y - 4.5, 9, 9);
    }
    let mateCss = '';
    if (live) for (const R of M.players()) {
      if (!R || !R.visible || !R.alive || !R.pos) continue;
      const [x, y] = at(R.pos.x, R.pos.z);
      if (tdm && R.tm === M.team) {
        if (!mateCss && R.css) mateCss = R.css;
        c.beginPath(); c.moveTo(x, y - 5.5); c.lineTo(x + 5.5, y); c.lineTo(x, y + 5.5); c.lineTo(x - 5.5, y); c.closePath();
        c.fillStyle = R.css || '#e8e4da'; c.fill(); c.strokeStyle = 'rgba(11,13,15,.85)'; c.lineWidth = 1.5; c.stroke();
        continue;
      }
      const age = now - (R.shotAt || -1e9);
      if (age < SHOT_MS) { c.globalAlpha = 1 - age / SHOT_MS * 0.7; c.beginPath(); c.arc(x, y, 4.5, 0, Math.PI * 2); c.fillStyle = '#ff5a40'; c.fill(); c.globalAlpha = 1; }
    }
    if (P && P.alive && P.pos) {
      const [x, y] = at(P.pos.x, P.pos.z);
      c.save(); c.translate(x, y); c.rotate(-(P.yaw || 0));
      c.beginPath(); c.moveTo(0, -8.5); c.lineTo(6, 6.5); c.lineTo(0, 3.2); c.lineTo(-6, 6.5); c.closePath();
      c.fillStyle = '#e8e4da'; c.fill(); c.strokeStyle = 'rgba(11,13,15,.9)'; c.lineWidth = 1.5; c.stroke();
      c.restore();
    }
    const show = (k2, v) => { const li = key.querySelector('[data-k="' + k2 + '"]'); if (li && li.hidden === v) li.hidden = !v; };
    show('mate', tdm); show('ammo', ammo.length > 0); show('shot', live);
    // the key's diamond takes the team's colour once a teammate is on the map, so Red's diamonds do not read as the red dot of a shooter
    const mi = key.querySelector('.mate'); if (mi && mi.dataset.c !== mateCss) { mi.dataset.c = mateCss; mi.style.background = mateCss; }
  }

  function pausedUp() {
    if (!G || !G.game || G.game.state !== 'paused') return false;
    const card = document.querySelector('#ui [data-s="paused"]');
    if (!card || (card.parentElement && card.parentElement.classList.contains('panel-open'))) return false;   // Settings and Controls open over the right side
    return getComputedStyle(card).display !== 'none' && getComputedStyle(card).visibility !== 'hidden';
  }

  function tick() {
    if (gone) return;
    G = window.__G || null;
    const want = pausedUp() && !!window.__ready;
    if (want && !el && !build()) return;
    if (want && !grid) { grid = makeGrid(); if (!grid) { gone = true; return; } }   // a map with no walk grid: nothing to draw, ever
    const fits = want && layout();
    if (fits) try { draw(); } catch (e) { console.error('[fullmap] ' + (e && e.stack || e)); gone = true; el.classList.remove('on'); return; }
    if (el && fits !== on) { on = fits; el.classList.toggle('on', on); }
  }
  setInterval(tick, 100);
  addEventListener('resize', () => { paint = null; });
})();
