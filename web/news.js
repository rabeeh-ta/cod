/* Saltline's "what's new" card: shown once on each device (this browser remembers it), on the first menu screen after
   the game has loaded, never in a match or over the map intro. Change NEWS and its id for the next release: a new id
   shows again to everyone. ?news=1 in the address shows it whatever was seen, for a look before it goes out.
   Loaded by net.js. */
(() => {
  'use strict';
  const NEWS = { id: '2026-11-24-area51-pickup', date: '24 Nov 2026' };
  const KEY = 'saltline.news.seen';
  // net.js wipes the address's ?query as the page mounts, before this file runs, so read the address the page was opened at
  const opened = (() => { try { const n = performance.getEntriesByType('navigation')[0]; return n && n.name ? new URL(n.name).search : ''; } catch { return ''; } })();
  const forced = /[?&]news=1\b/.test(opened + location.search);
  const seen = () => { try { return localStorage.getItem(KEY) === NEWS.id; } catch { return false; } };
  let seenThisVisit = false;
  const markSeen = () => { seenThisVisit = true; if (forced) return; try { localStorage.setItem(KEY, NEWS.id); } catch { /* private mode: once this visit */ } };

  const css = `
    .news { position: fixed; inset: 0; z-index: 1200; display: grid; place-items: center; padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
      background: rgba(6, 8, 10, .72); opacity: 0; transition: opacity .2s ease; font-family: var(--f-label, 'Barlow Condensed', 'Arial Narrow', sans-serif); color: var(--bone, #e8e4da); }
    .news.on { opacity: 1; }
    .news.off { opacity: 0; transition: opacity .16s ease-in; }
    .news-card { position: relative; width: min(760px, 100%); max-height: 100%; overflow: auto; overscroll-behavior: contain; padding: 26px 26px 22px;
      background: rgba(11, 13, 15, .96); border: 1px solid rgba(232, 228, 218, .16); border-radius: 2px; box-shadow: 0 24px 60px rgba(0, 0, 0, .55);
      transform: translateY(12px); transition: transform .24s cubic-bezier(.2,.7,.2,1); }
    .news.on .news-card { transform: none; }
    .news.off .news-card { transform: translateY(6px); transition: transform .16s ease-in; }
    .news-card { width: min(600px, 100%); padding: 22px 24px 20px; }
    .news-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 0 0 16px; min-height: 40px; }
    .news-head h2 { margin: 0; font: 900 clamp(30px, 4.2vw, 40px)/.95 var(--f-display, Impact, sans-serif); letter-spacing: .01em; }      /* the heading as written, no capitals added */
    .news-x { flex: none; width: 40px; height: 40px; display: grid; place-items: center; padding: 0; margin: -4px -8px 0 0; border: 1px solid transparent; border-radius: 2px; background: none; color: var(--bone-dim, rgba(232, 228, 218, .64)); cursor: pointer; transition: color .12s, border-color .12s, background .12s; }
    .news-x:hover { color: var(--bone, #e8e4da); border-color: rgba(232, 228, 218, .24); }
    .news-x:active { background: rgba(232, 228, 218, .08); }
    .news-x:focus-visible { outline: 2px solid var(--bone, #e8e4da); outline-offset: 2px; }
    .news-x svg { width: 16px; height: 16px; }
    .news-page { display: grid; gap: 14px; }
    .news-page[hidden] { display: none; }
    .news-page.in { animation: news-in .22s cubic-bezier(.2,.7,.2,1); }
    @keyframes news-in { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
    .news-pic { position: relative; aspect-ratio: 16 / 9; overflow: hidden; border: 1px solid rgba(232, 228, 218, .12); border-radius: 2px; background: #15181b; }
    .news-pic img { display: block; width: 100%; height: 100%; object-fit: cover; }
    .news-page p { margin: 0; font: 400 17px/1.38 var(--f-label); color: rgba(232, 228, 218, .84); }
    .news-page b { font-weight: 700; color: var(--bone, #e8e4da); }
    .news-page kbd { display: inline-block; font: 500 11px/1 var(--f-mono, monospace); color: var(--bone, #e8e4da); border: 1px solid rgba(232, 228, 218, .45); padding: 3px 5px 2px; margin: 0 1px; vertical-align: 1px; }
    .news-foot { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 18px; }
    .news-step { font: 500 11px/1 var(--f-mono, monospace); letter-spacing: .14em; color: var(--bone-dim, rgba(232, 228, 218, .64)); }
    .news-ok { appearance: none; min-width: 168px; padding: 15px 22px 14px; border: 0; border-radius: 2px; cursor: pointer; text-align: center;
      background: var(--signal, #ffb347); color: var(--ink, #0b0d0f); font: 900 26px/.9 var(--f-display, Impact, sans-serif); letter-spacing: .02em; transition: background .15s ease, transform .1s ease; }
    .news-ok:hover { background: var(--signal-hot, #ffc977); }
    .news-ok:active { transform: translateY(1px); }
    .news-ok:focus-visible { outline: 2px solid var(--bone, #e8e4da); outline-offset: 3px; }
    @media (max-width: 640px) { .news-card { padding: 18px 16px 16px; } .news-page p { font-size: 16px; } }
    @media (max-height: 560px) { .news-card { width: min(520px, 100%); padding: 14px 18px 14px; } .news-head { margin-bottom: 10px; } .news-head h2 { font-size: 26px; } .news-page { gap: 10px; } .news-page p { font-size: 14px; } .news-foot { margin-top: 10px; } .news-ok { padding: 11px 18px 10px; font-size: 22px; } }
    @media (prefers-reduced-motion: reduce) { .news, .news-card, .news.off, .news.off .news-card { transition: opacity .12s linear; transform: none !important; } .news-page.in { animation: none; } }`;

  let box = null, lastFocus = null, page = 0;
  const pages = () => [...box.querySelectorAll('.news-page')];
  function go(n) {         // one thing a page: its heading, its picture, its words; Next, then Got it on the last
    const ps = pages(); page = Math.max(0, Math.min(ps.length - 1, n));
    ps.forEach((p, k) => { p.hidden = k !== page; p.classList.toggle('in', k === page && n > 0); });
    box.querySelector('#news-title').textContent = ps[page].dataset.title;
    box.querySelector('.news-step').textContent = (page + 1) + ' / ' + ps.length;
    box.querySelector('.news-ok').textContent = page === ps.length - 1 ? 'Got it' : 'Next';
  }
  function build() {
    const st = document.createElement('style'); st.id = 'news-style'; st.textContent = css; document.head.appendChild(st);
    box = document.createElement('div'); box.className = 'news';
    box.innerHTML = `<div class="news-card" role="dialog" aria-modal="true" aria-labelledby="news-title">
      <div class="news-head"><h2 id="news-title">New Map!</h2><button type="button" class="news-x" aria-label="Close"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"/></svg></button></div>
      <section class="news-page" data-title="New Map!">
        <div class="news-pic"><img src="/maps/cards/area51.jpg" alt="Area 51 from above: hangars, a comm tower and containers inside a fenced desert base" width="800" height="450" decoding="async"></div>
        <p><b>Area 51</b>: a desert base behind the wire, with hangars, a comm tower, flat roofs you can walk and jump between, and cover everywhere. Pick it from the map cards.</p>
      </section>
      <section class="news-page" data-title="Pick Up Guns!" hidden>
        <div class="news-pic"><img src="/news/pickup.jpg" alt="A sniper rifle lying on the sand with the pick-up panel over it: PAC-98 Lookout, 5 + 25, hold G to swap for Rifle" width="768" height="432" decoding="async"></div>
        <p>Players drop their guns when they go down. Walk up to one and hold <kbd>G</kbd> to swap it for what's in your hands: carry two guns, or a gun and the knife. <kbd>B</kbd> opens your bag.</p>
      </section>
      <div class="news-foot"><span class="news-step" aria-live="polite">1 / 2</span><button type="button" class="news-ok">Next</button></div>
    </div>`;
    document.body.appendChild(box);
    box.querySelector('.news-ok').addEventListener('click', () => { if (page < pages().length - 1) go(page + 1); else close(); });
    box.querySelector('.news-x').addEventListener('click', close);
    box.addEventListener('mousedown', e => { if (e.target === box) close(); });
    box.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === 'Tab') {      // focus stays in the card
        const f = [...box.querySelectorAll('button')], i = f.indexOf(document.activeElement);
        e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
      e.stopPropagation();        // the menus behind do not hear keys meant for the card
    });
  }
  function open() {
    if (box && box.classList.contains('on')) return;
    if (!box) build();
    go(0);
    lastFocus = document.activeElement;
    box.hidden = false; box.classList.remove('off'); void box.offsetWidth; box.classList.add('on');
    markSeen();
    setTimeout(() => { const b = box.querySelector('.news-ok'); if (b) b.focus({ preventScroll: true }); }, 30);
  }
  function close() {
    if (!box || !box.classList.contains('on')) return;
    box.classList.remove('on'); box.classList.add('off');
    setTimeout(() => { box.hidden = true; box.classList.remove('off'); }, 180);
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) try { lastFocus.focus({ preventScroll: true }); } catch { /* fine */ }
  }

  // when: the menus are up over the loaded scene, nothing is being joined or played, no intro, no reload on its way back in
  // a reload in a match goes straight back in (net.js); a note older than ten minutes is ignored there, so here too
  const resuming = () => { try { const r = JSON.parse(sessionStorage.getItem('saltline.resume') || 'null'); return !!r && Date.now() - r.t < 600000; } catch { return false; } };
  const ready = () => {
    const h = document.documentElement, g = window.__G;
    return h.classList.contains('net-scene') && h.classList.contains('net-gate-open') && !h.classList.contains('net-intro')
      && !(window.__SALTLINE_MATCH && window.__SALTLINE_MATCH.live) && (!g || !g.game || g.game.state === 'title') && !resuming();
  };
  let calm = 0;
  const wait = setInterval(() => {
    if (seenThisVisit || (!forced && seen())) { clearInterval(wait); return; }
    calm = ready() ? calm + 1 : 0;
    if (calm >= 3) { clearInterval(wait); open(); }        // up for a moment (0.75 s), so it does not land on a screen still fading in
  }, 250);
  window.__SALTLINE_NEWS = { open, close, id: NEWS.id };
})();
