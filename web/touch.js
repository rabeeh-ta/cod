/* Saltline touch layout. On a touch screen every on-screen button can be moved, resized and faded, the way the layout
   editors of mobile shooters work: Settings → Touch controls → Customise layout. The layout is kept in this browser
   and applied as one style sheet over the game's own buttons, so their code and states (pressed, cooking, mic on) stay
   the game's. Loaded by net.js. */
(() => {
  const KEY = 'saltline.touchLayout.v1';
  // every control the game draws on a touch screen, with its size and place from the game's own CSS
  // (r/b/t: px from the right, bottom or top edge, inside the safe area). sq: square corners. fixed: it can't be moved
  const CONTROLS = [
    { id: 'stick', sel: '.touch .t-stick', name: 'Move stick', label: 'MOVE', w: 116, fixed: true },
    { id: 'fire', sel: '.touch .t-fire', name: 'Fire', label: 'FIRE', w: 86, r: 20, b: 62 },
    { id: 'ads', sel: '.touch .t-ads', name: 'Aim', label: 'AIM', w: 60, r: 120, b: 34 },
    { id: 'jump', sel: '.touch .t-jump', name: 'Jump', label: 'JUMP', w: 60, r: 20, b: 164 },
    { id: 'reload', sel: '.touch .t-reload', name: 'Reload', label: 'RLD', w: 54, r: 108, b: 126 },
    { id: 'swap', sel: '.touch .t-swap', name: 'Swap weapon', label: 'SWAP', w: 54, r: 92, b: 196 },
    { id: 'interact', sel: '.touch .t-interact', name: 'Use', label: 'USE', w: 68, r: 186, b: 96 },
    { id: 'frag', sel: '.mp-fragbtn', name: 'Frag grenade', label: 'FRAG', w: 54, r: 186, b: 24 },
    { id: 'pause', sel: '.touch .t-pause', name: 'Pause', label: 'II', w: 42, r: 12, t: 12, sq: true },
    { id: 'score', sel: '.mp-scorebtn', name: 'Scores', label: 'SCORE', w: 42, r: 62, t: 12, sq: true },
    { id: 'mic', sel: '.mp-micbtn', name: 'Mic', label: 'MIC', w: 42, r: 112, t: 12, sq: true },
  ];
  const SIZE = [0.6, 1.6], OPACITY = [0.2, 1];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const isTouch = () => document.documentElement.classList.contains('is-touch') || (window.matchMedia && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;

  // { id: { x, y (the centre, as a share of the screen; absent = the game's place), s (size), o (opacity) } }
  function load() { try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } }
  function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} }
  let layout = load();

  // the layout as CSS over the game's buttons. Moved buttons are placed by their centre; opacity goes through filter, so
  // it multiplies with the game's own (a spent frag button stays dimmer than a ready one)
  const sheet = document.createElement('style'); sheet.id = 'touch-layout';
  const num = n => +(+n).toFixed(4);
  function apply() {
    let css = '';
    for (const c of CONTROLS) {
      const v = layout[c.id]; if (!v) continue;
      const s = c.fixed ? 1 : num(clamp(+v.s || 1, ...SIZE)), o = num(clamp(v.o == null ? 1 : +v.o, ...OPACITY));
      const moved = !c.fixed && Number.isFinite(+v.x) && Number.isFinite(+v.y);
      const rules = [];
      if (moved) rules.push(`left: ${num(v.x * 100)}% !important`, `top: ${num(v.y * 100)}% !important`, 'right: auto !important', 'bottom: auto !important', `transform: translate(-50%, -50%) scale(${s}) !important`);
      else if (s !== 1) rules.push(`transform: scale(${s}) !important`);
      if (o !== 1) rules.push(`filter: opacity(${o})`);
      if (rules.length) css += `html.is-touch ${c.sel} { ${rules.join('; ')}; }\n`;
    }
    sheet.textContent = css;
    if (!sheet.isConnected) document.head.appendChild(sheet);
  }
  apply();

  // the safe area (notches, rounded corners), measured once per open
  function insets() {
    const p = document.createElement('div');
    p.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.appendChild(p); const cs = getComputedStyle(p);
    const r = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
    p.remove(); return r;
  }

  const style = document.createElement('style');
  style.textContent = `
.tl { position: fixed; inset: 0; z-index: 2000; touch-action: none; user-select: none; -webkit-user-select: none; color: var(--bone, #e8e4da);
  background: linear-gradient(rgba(6, 8, 10, .86), rgba(6, 8, 10, .86)), repeating-linear-gradient(0deg, transparent 0 39px, rgba(232, 228, 218, .05) 39px 40px), repeating-linear-gradient(90deg, transparent 0 39px, rgba(232, 228, 218, .05) 39px 40px); }
.tl[hidden] { display: none; }
.tl-ghost { position: absolute; left: 0; top: 0; display: grid; place-items: center; padding: 0; margin: 0; border-radius: 50%; cursor: grab; touch-action: none;
  border: 1.5px solid rgba(232, 228, 218, .55); background: rgba(11, 13, 15, .38); color: var(--bone, #e8e4da); font: 600 12px/1 var(--f-label, 'Arial Narrow', sans-serif); letter-spacing: .14em;
  -webkit-appearance: none; appearance: none; transition: box-shadow .15s ease; }
.tl-ghost span { margin-right: -.14em; pointer-events: none; }
.tl-ghost.sq { border-radius: 0; font-size: 10px; letter-spacing: .08em; }
.tl-ghost.stick { cursor: default; border-style: dashed; }
.tl-ghost.stick::after { content: ''; position: absolute; left: 50%; top: 50%; width: 41%; height: 41%; transform: translate(-50%, -50%); border-radius: 50%; border: 1.5px solid rgba(232, 228, 218, .7); background: rgba(232, 228, 218, .3); }
.tl-ghost.sel { box-shadow: 0 0 0 2px var(--ink, #0b0d0f), 0 0 0 4px var(--signal, #ffb347); color: var(--signal, #ffb347); }
.tl-ghost.drag { cursor: grabbing; }
.tl-ghost:focus-visible { outline: 2px solid var(--signal, #ffb347); outline-offset: 6px; }
.tl-bar { position: absolute; left: 50%; top: calc(8px + env(safe-area-inset-top, 0px)); transform: translateX(-50%); width: min(520px, calc(100vw - 24px)); box-sizing: border-box;
  padding: 10px 12px; background: rgba(11, 13, 15, .9); border: 1px solid rgba(232, 228, 218, .2); border-top: 2px solid var(--signal, #ffb347);
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px 14px; transition: opacity .15s ease; }
.tl-bar.mid { top: 50%; transform: translate(-50%, -50%); }
.tl-bar.low { top: auto; bottom: calc(8px + env(safe-area-inset-bottom, 0px)); }
.tl-bar.fade { opacity: .12; pointer-events: none; }
.tl-head { grid-column: 1 / -1; display: flex; align-items: baseline; justify-content: space-between; gap: 10px; min-width: 0; }
.tl-head b { font: 600 15px/1 var(--f-label, 'Arial Narrow', sans-serif); letter-spacing: .18em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tl-head span { font: 400 11px/1.3 var(--f-mono, ui-monospace, monospace); color: var(--bone-dim, rgba(232, 228, 218, .64)); text-align: right; }
.tl-sl { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px; min-width: 0; }
.tl-sl label { font: 600 12px/1 var(--f-label, 'Arial Narrow', sans-serif); letter-spacing: .16em; text-transform: uppercase; }
.tl-sl output { font: 500 12px/1 var(--f-mono, ui-monospace, monospace); min-width: 4.5ch; text-align: right; }
.tl-sl input { width: 100%; min-width: 0; height: 28px; margin: 0; accent-color: var(--signal, #ffb347); }
.tl-sl input:disabled { opacity: .35; }
.tl-acts { grid-column: 1 / -1; display: flex; gap: 6px; }
.tl-acts button { flex: 1 1 0; min-width: 0; min-height: 36px; padding: 2px 6px 0; border-radius: 0; cursor: pointer; white-space: nowrap;
  font: 600 13px/1 var(--f-label, 'Arial Narrow', sans-serif); letter-spacing: .14em; text-transform: uppercase; color: var(--bone, #e8e4da);
  background: transparent; border: 1px solid rgba(232, 228, 218, .42); transition: background-color .15s ease, color .15s ease, border-color .15s ease; }
.tl-acts button:hover { border-color: var(--bone, #e8e4da); }
.tl-acts button:active { background: rgba(232, 228, 218, .12); }
.tl-acts button:disabled { opacity: .35; cursor: default; }
.tl-acts button:focus-visible { outline: 2px solid var(--signal, #ffb347); outline-offset: 2px; }
.tl-acts .tl-save { background: var(--signal, #ffb347); border-color: var(--signal, #ffb347); color: var(--ink, #0b0d0f); }
.tl-acts .tl-save:hover { background: var(--signal-hot, #ffc977); border-color: var(--signal-hot, #ffc977); }
@media (max-height: 420px) { .tl-bar { padding: 8px 10px; gap: 4px 12px; } .tl-acts button { min-height: 32px; } .tl-head span { display: none; } }
@media (prefers-reduced-motion: reduce) { .tl-bar, .tl-ghost, .tl-acts button { transition: none; } }`;
  document.head.appendChild(style);

  // ---- the editor
  let ui = null, draft = null, sel = 'fire', ins = { t: 0, r: 0, b: 0, l: 0 }, opener = null;
  function build() {
    ui = document.createElement('div'); ui.className = 'tl'; ui.hidden = true;
    ui.setAttribute('role', 'dialog'); ui.setAttribute('aria-modal', 'true'); ui.setAttribute('aria-label', 'Customise touch controls');
    ui.innerHTML = `
      <div class="tl-field"></div>
      <div class="tl-bar">
        <div class="tl-head"><b data-tl="name"></b><span>Drag a button to move it. Tap one to set its size and opacity.</span></div>
        <div class="tl-sl"><label for="tl-size">Size</label><input id="tl-size" type="range" min="${SIZE[0] * 100}" max="${SIZE[1] * 100}" step="5"><output data-tl="size"></output></div>
        <div class="tl-sl"><label for="tl-op">Opacity</label><input id="tl-op" type="range" min="${OPACITY[0] * 100}" max="${OPACITY[1] * 100}" step="5"><output data-tl="op"></output></div>
        <div class="tl-acts">
          <button type="button" data-tl="reset">Reset</button>
          <button type="button" data-tl="reset-all">Reset all</button>
          <button type="button" data-tl="cancel">Cancel</button>
          <button type="button" class="tl-save" data-tl="save">Save</button>
        </div>
      </div>`;
    const field = ui.querySelector('.tl-field');
    for (const c of CONTROLS) {
      const g = document.createElement('button'); g.type = 'button';
      g.className = 'tl-ghost' + (c.sq ? ' sq' : '') + (c.fixed ? ' stick' : '');
      g.dataset.id = c.id; g.setAttribute('aria-label', c.name + (c.fixed ? '' : ', drag or use the arrow keys to move'));
      if (!c.fixed) g.innerHTML = `<span>${c.label}</span>`;
      field.appendChild(g);
    }
    document.body.appendChild(ui);
    const q = s => ui.querySelector(s);
    const size = q('#tl-size'), op = q('#tl-op');
    size.addEventListener('input', () => { cur().s = +size.value / 100; paint(); });
    op.addEventListener('input', () => { cur().o = +op.value / 100; paint(); });
    q('[data-tl="reset"]').addEventListener('click', () => { delete draft[sel]; paint(); });
    q('[data-tl="reset-all"]').addEventListener('click', () => { draft = {}; paint(); });
    q('[data-tl="cancel"]').addEventListener('click', () => close(false));
    q('[data-tl="save"]').addEventListener('click', () => close(true));

    // dragging: one finger or the mouse, from where it was picked up
    let drag = null;
    field.addEventListener('pointerdown', ev => {
      const g = ev.target.closest('.tl-ghost'); if (!g) return;
      select(g.dataset.id);
      const c = byId(g.dataset.id); if (c.fixed) return;
      const p = place(c);
      drag = { id: c.id, el: g, pid: ev.pointerId, dx: ev.clientX - p.x, dy: ev.clientY - p.y, moved: false, sx: ev.clientX, sy: ev.clientY };
      try { g.setPointerCapture(ev.pointerId); } catch {}
      ev.preventDefault();
    });
    field.addEventListener('pointermove', ev => {
      if (!drag || ev.pointerId !== drag.pid) return;
      if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 4) return;
      if (!drag.moved) { drag.moved = true; drag.el.classList.add('drag'); }
      moveTo(drag.id, ev.clientX - drag.dx, ev.clientY - drag.dy);
      const bar = q('.tl-bar').getBoundingClientRect(), g = drag.el.getBoundingClientRect();
      q('.tl-bar').classList.toggle('fade', !(g.right < bar.left || g.left > bar.right || g.bottom < bar.top || g.top > bar.bottom));
    });
    const end = ev => {
      if (!drag || ev.pointerId !== drag.pid) return;
      drag.el.classList.remove('drag'); drag = null;
      q('.tl-bar').classList.remove('fade');
      fit(); // a button left under the bar: the bar moves out of its way
    };
    field.addEventListener('pointerup', end); field.addEventListener('pointercancel', end);
    field.addEventListener('focusin', ev => { const g = ev.target.closest('.tl-ghost'); if (g) select(g.dataset.id); });

    // the keyboard: arrows move the chosen button (Shift for bigger steps), Esc cancels, Tab stays inside
    ui.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Escape') { ev.preventDefault(); close(false); return; }
      const g = ev.target.closest && ev.target.closest('.tl-ghost');
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
      if (g && d && !byId(g.dataset.id).fixed) { ev.preventDefault(); const p = place(byId(g.dataset.id)), k = ev.shiftKey ? 20 : 4; moveTo(g.dataset.id, p.x + d[0] * k, p.y + d[1] * k); return; }
      if (ev.key === 'Tab') {
        const f = [...ui.querySelectorAll('button, input')].filter(x => !x.disabled);
        const i = f.indexOf(document.activeElement);
        if (ev.shiftKey && i <= 0) { ev.preventDefault(); f[f.length - 1].focus(); }
        else if (!ev.shiftKey && i === f.length - 1) { ev.preventDefault(); f[0].focus(); }
      }
    });
    ui.addEventListener('keyup', ev => ev.stopPropagation());
    for (const t of ['touchstart', 'touchmove', 'touchend', 'mousedown', 'click', 'wheel']) ui.addEventListener(t, ev => ev.stopPropagation());
    addEventListener('resize', () => { if (ui && !ui.hidden) { ins = insets(); paint(); fit(); } });
  }
  const byId = id => CONTROLS.find(c => c.id === id);
  const cur = () => (draft[sel] = draft[sel] || {});

  // where a control sits now, in px: its centre and its drawn size
  function place(c) {
    const W = innerWidth, H = innerHeight, v = draft[c.id] || {};
    const s = c.fixed ? 1 : clamp(+v.s || 1, ...SIZE), w = c.w * s;
    if (c.fixed) return { x: clamp(W * 0.2, ins.l + 80, W * 0.4), y: H - ins.b - Math.max(110, H * 0.32), w };
    if (Number.isFinite(+v.x) && Number.isFinite(+v.y)) return { x: v.x * W, y: v.y * H, w };
    const x = W - ins.r - c.r - c.w / 2, y = c.t != null ? ins.t + c.t + c.w / 2 : H - ins.b - c.b - c.w / 2;
    return { x, y, w };
  }
  function moveTo(id, x, y) {
    const c = byId(id), W = innerWidth, H = innerHeight, h = place(c).w / 2;
    x = clamp(x, ins.l + h, W - ins.r - h); y = clamp(y, ins.t + h, H - ins.b - h);
    const v = draft[id] = draft[id] || {}; v.x = x / W; v.y = y / H;
    paint();
  }
  // the bar goes where it covers fewest buttons: the top, the middle or the bottom
  const over = (a, b) => !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
  function fit() {
    const bar = ui.querySelector('.tl-bar'), ghosts = [...ui.querySelectorAll('.tl-ghost')];
    let best = null;
    for (const pos of ['', 'mid', 'low']) {
      bar.classList.remove('mid', 'low'); if (pos) bar.classList.add(pos);
      const b = bar.getBoundingClientRect(), n = ghosts.filter(g => over(g.getBoundingClientRect(), b)).length;
      if (!best || n < best.n) best = { pos, n };
      if (!n) break;
    }
    bar.classList.remove('mid', 'low'); if (best.pos) bar.classList.add(best.pos);
  }
  function select(id) { sel = id; paint(); }
  function paint() {
    const q = s => ui.querySelector(s);
    for (const g of ui.querySelectorAll('.tl-ghost')) {
      const c = byId(g.dataset.id), p = place(c), v = draft[c.id] || {};
      g.style.width = g.style.height = c.w + 'px';
      g.style.transform = `translate(${(p.x - c.w / 2).toFixed(1)}px, ${(p.y - c.w / 2).toFixed(1)}px) scale(${(p.w / c.w).toFixed(3)})`;
      g.style.opacity = String(clamp(v.o == null ? 1 : +v.o, ...OPACITY));
      g.classList.toggle('sel', c.id === sel);
      g.setAttribute('aria-pressed', String(c.id === sel));
    }
    const c = byId(sel), v = draft[sel] || {};
    const s = Math.round((c.fixed ? 1 : clamp(+v.s || 1, ...SIZE)) * 100), o = Math.round(clamp(v.o == null ? 1 : +v.o, ...OPACITY) * 100);
    q('[data-tl="name"]').textContent = c.fixed ? c.name + ' · shows where your thumb lands' : c.name;
    const size = q('#tl-size'), op = q('#tl-op');
    size.disabled = !!c.fixed; if (+size.value !== s) size.value = String(s); q('[data-tl="size"]').textContent = s + '%';
    if (+op.value !== o) op.value = String(o); q('[data-tl="op"]').textContent = o + '%';
    q('[data-tl="reset"]').disabled = !draft[sel];
    q('[data-tl="reset-all"]').disabled = !Object.keys(draft).length;
  }
  function open(from) {
    if (!ui) build();
    opener = from || document.activeElement;
    draft = JSON.parse(JSON.stringify(layout)); sel = 'fire'; ins = insets();
    ui.querySelector('.tl-bar').classList.remove('fade');
    ui.hidden = false; paint(); fit();
    ui.querySelector('.tl-ghost[data-id="fire"]').focus({ preventScroll: true });
  }
  function close(keep) {
    if (keep) {
      // drop what equals the default, so a later change to the game's own layout still reaches these buttons
      for (const [id, v] of Object.entries(draft)) {
        if (v.s != null && Math.abs(v.s - 1) < 0.001) delete v.s;
        if (v.o != null && Math.abs(v.o - 1) < 0.001) delete v.o;
        if (!Object.keys(v).length) delete draft[id];
      }
      layout = draft; save(layout); apply();
    }
    ui.hidden = true; draft = null;
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
  }

  // Settings: a "Touch controls" row under the field of view, on touch screens
  function row() {
    if (document.getElementById('s-touch')) { document.getElementById('s-touch').closest('.row').hidden = !isTouch(); return; }
    const after = document.getElementById('s-fov'), r0 = after && after.closest('.row');
    if (!r0) return;
    const r = document.createElement('div'); r.className = 'row'; r.hidden = !isTouch();
    r.innerHTML = '<label for="s-touch">Touch controls</label><button type="button" class="btn small" id="s-touch">Customise layout</button>';
    r.querySelector('button').addEventListener('click', ev => { ev.stopPropagation(); open(ev.currentTarget); });
    r0.after(r);
  }
  setInterval(row, 500);
  window.__touchLayout = { open, get: () => JSON.parse(JSON.stringify(layout)), controls: CONTROLS.map(c => c.id) };
})();
