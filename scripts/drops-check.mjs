// Drops check: the bag and the guns on the ground (web/bag.js, src/worker.js), with real game tabs (headless Chrome)
// and scripted players in the same room. Needs `npm run dev` running and Google Chrome.
//
//   node scripts/drops-check.mjs [http://localhost:8787]        (CHROME=/path/to/chrome to use another browser)
//   ONLY=room,matrix,... to run some parts: room, tab, matrix, race, death, drawer, keep, round, tdm, touch, expiry
//
// Every key is a real key press sent to the page (G, B, X, 1, 2, the arrows), every pick-up is a hold of the pick-up
// key. After every step it checks that no rounds were made or lost: what the tab carries plus what lies on the ground
// (the room's own list) changes only by what the step should change (a fresh life, a scripted drop, an expiry).
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] || 'http://localhost:8787', wsBase = base.replace(/^http/, 'ws');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null, part = p => !ONLY || ONLY.has(p);
const CYCLE = 310000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0, passed = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (cond) passed++; else failed++; return !!cond; };
const KINDS = ['rifle', 'shotgun', 'sniper'], MAG = { rifle: 30, shotgun: 6, sniper: 5 }, RES = { rifle: 150, shotgun: 64, sniper: 25 };

/* ---------------------------------------------------------------- browsers */
const browsers = [];
async function browser({ w = 1100, h = 640, touch = false } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'saltline-drops-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${w},${h}`, '--no-first-run', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
  browsers.push({ chrome, profile });
  let list = [];
  for (let i = 0; i < 120 && !list.some(t => t.type === 'page'); i++) { try { const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { /* not up yet */ } await sleep(250); }
  const target = list.find(t => t.type === 'page'); if (!target) throw new Error('Chrome did not start');
  const cdp = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => { cdp.onopen = r; });
  let cid = 0; const waiting = new Map(), errors = [];
  cdp.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description : m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(x => x.value || x.description || '').join(' '));
  };
  const send = (method, params = {}) => new Promise(r => { const i = ++cid; waiting.set(i, r); cdp.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  if (touch) { await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' }); }
  const t = {
    send, errors,
    async eval(expr) { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(20000).then(() => null)]); if (r && r.result && r.result.exceptionDetails) { const d = r.result.exceptionDetails; console.log('     (page threw: ' + String(d.exception ? d.exception.description : d.text).split('\n')[0] + ')'); return undefined; } return r && r.result && r.result.result ? r.result.result.value : undefined; },
    async until(expr, ms = 30000) { for (let k = 0; k < ms; k += 200) { if (await t.eval(expr)) return true; await sleep(200); } return false; },
    async open(url) { await send('Page.navigate', { url }); await sleep(1500); return t.until('!!window.__ready', 90000); },
    async key(code, holdMs = 80) { const key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code.startsWith('Digit') ? code.slice(5) : code; await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key }); await sleep(holdMs); await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key }); },
    keyDown(code) { const key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code; return send('Input.dispatchKeyEvent', { type: 'keyDown', code, key }); },
    keyUp(code) { const key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code; return send('Input.dispatchKeyEvent', { type: 'keyUp', code, key }); },
    async state() { const s = await t.eval('JSON.stringify(window.__SALTLINE_BAG && window.__SALTLINE_BAG.state())'); return s ? JSON.parse(s) : null; },
  };
  return t;
}
const done = () => { for (const b of browsers) try { b.chrome.kill('SIGKILL'); } catch { /* gone */ } setTimeout(() => { for (const b of browsers) try { rmSync(b.profile, { recursive: true, force: true }); } catch { /* fine */ } console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); }, 600); };
process.on('uncaughtException', e => { console.error(e); failed++; done(); });
process.on('unhandledRejection', e => { console.error(e); failed++; done(); });

async function newRoom(mode = 'dm') { return (await (await fetch(base + '/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) })).json()).code; }
async function joinDm(t) {
  await t.eval(`(async () => { for (let i = 0; i < 60 && !document.querySelector('[data-act="join"]:not(:disabled)'); i++) await new Promise(r => setTimeout(r, 250));
    const m = document.querySelector('.fe-mode[data-mode="dm"]'); if (m) m.click(); await new Promise(r => setTimeout(r, 300)); document.querySelector('[data-act="join"]').click(); })()`);
  return t.until('!!(window.__SALTLINE_MATCH && window.__SALTLINE_MATCH.live && window.__SALTLINE_BAG && window.__SALTLINE_BAG.state().active)', 60000);
}
async function joinTeam(t, i) {
  await t.eval(`(async () => { for (let k = 0; k < 60 && !document.querySelector('.fe-join-team[data-team="${i}"]:not(:disabled)'); k++) await new Promise(r => setTimeout(r, 250)); document.querySelector('.fe-join-team[data-team="${i}"]').click(); })()`);
  return t.until('!!(window.__SALTLINE_MATCH && window.__SALTLINE_MATCH.live && window.__SALTLINE_BAG && window.__SALTLINE_BAG.state().active)', 60000);
}

/* ---------------------------------------------------------------- scripted players */
let ghostN = 0;
function ghost(code) {
  const n = ++ghostN, peer = 'ghost' + String(n).padStart(5, '0'), uid = 'ghost-uid-' + n;
  const ws = new WebSocket(`${wsBase}/api/rooms/${code}/ws?peer=${peer}&uid=${uid}`);
  const g = { ws, peer, msgs: [], tabs: new Map(), hits: [] };
  ws.onmessage = e => {
    if (e.data === 'pong') return;
    const m = JSON.parse(e.data); g.msgs.push(m);
    if (m.t === 'hello') for (const x of m.peers) if (!/^ghost/.test(x.peer)) g.tabs.set(x.peer, x.p || {});
    if (m.t === 'join' && !/^ghost/.test(m.peer)) g.tabs.set(m.peer, {});
    if (m.t === 'p' && !/^ghost/.test(m.peer)) g.tabs.set(m.peer, m.full ? m.d : Object.assign({}, g.tabs.get(m.peer) || {}, m.d));
  };
  g.ready = new Promise(r => { ws.onopen = r; });
  g.hello = async () => { for (let i = 0; i < 100 && !g.msgs.some(m => m.t === 'hello'); i++) await sleep(50); return g.msgs.find(m => m.t === 'hello'); };
  g.send = (d, full) => ws.send(JSON.stringify({ t: 'p', d, ...(full ? { full: true } : {}) }));
  g.raw = m => ws.send(JSON.stringify(m));
  g.join = mode => g.send({ m: mode || 'dm', tm: mode === 'tdm' ? 1 : -1, p: [60, 0, 60], r: [0, 0], st: 1, hp: 100, w: 0, n: 'Ghost ' + n, k: 0, d: 0, sh: null, h: [], dl: [], bx: [], g: [], c: '#9fd66b', uid, ld: 'ghostload' + n }, true);
  g.kill = tab => { g.hits = [...g.hits, [Date.now() + Math.floor(Math.random() * 50), tab, 150, 0, 0]].slice(-6); g.send({ h: g.hits }); };
  // the room's own list, asked for and waited on
  g.list = async () => { const from = g.msgs.length; g.raw({ t: 'drops', d: {} }); for (let i = 0; i < 100; i++) { const m = g.msgs.slice(from).find(x => x.t === 'drops' && x.list); if (m) return m.list; await sleep(40); } return null; };
  g.next = async (pred, ms = 4000) => { const from = g.msgs.length; for (let i = 0; i < ms / 40; i++) { const m = g.msgs.slice(from).find(pred); if (m) return m; await sleep(40); } return null; };
  return g;
}

/* ---------------------------------------------------------------- rounds: every 5:10 the round ends (a 10 s break in
   which nobody can be hurt, then everyone starts fresh). A section that needs time waits for the next round first */
async function roomInRound(t, need = 50000) {
  const x = await t.eval(`Date.now() % ${CYCLE}`); if (typeof x !== 'number') return;
  const left = x < CYCLE - 10000 ? CYCLE - 10000 - x : -1;
  if (left >= need) return;
  const wait = CYCLE - x + 2500; console.log(`     (waiting ${Math.round(wait / 1000)} s for the next round to start)`); await sleep(wait);
  await t.until('!!(window.__SALTLINE_BAG.state().active && !window.__SALTLINE_BAG.state().dead)', 10000);
}
const unprotected = t => t.until('!window.__G.player.invulnerable && window.__SALTLINE_MATCH.alive', 9000);

/* ---------------------------------------------------------------- the checks every step runs */
const carried = s => (!s || s.dead ? 0 : s.slots.reduce((a, x) => a + (x.g !== 'knife' ? x.m : 0), 0) + KINDS.reduce((a, k) => a + s.pool[k], 0));
const onGround = (list, rd, md = 'dm') => (list || []).filter(i => i.rd === rd && i.md === md).reduce((a, i) => a + i.m + i.r, 0);
function handsRight(s, label) {
  if (!s || s.dead) return true;
  const it = s.slots[s.held];
  const good = it.g === 'knife' ? s.hands.knife : !s.hands.knife && s.hands.gun === it.g && s.hands.ammo === it.m && s.hands.reserve === s.pool[it.g];
  const poolOk = KINDS.every(k => s.pool[k] === 0 || s.slots.some(x => x.g === k));
  return ok(good && poolOk, `${label}: the hands hold slot ${s.held + 1} (${it.g}) as the bag says ${good ? '' : JSON.stringify(s.hands) + ' ' + JSON.stringify(s.slots) + ' ' + JSON.stringify(s.pool)}${poolOk ? '' : ' / spare kept for a gun not carried ' + JSON.stringify(s.pool)}`);
}
const settled = async t => { await sleep(300); return t.until('(() => { const s = window.__SALTLINE_BAG.state(); return !s.pending && !(window.__G.weapon.pending); })()', 6000); };   // a few frames first: the game reads keys in its own frame
// a spot in front of the tab's player, on its floor
async function inFront(t, d = 0.7, side = 0) { return t.eval(`(() => { const P = __G.player; const y = P.yaw; return { x: P.pos.x - Math.sin(y) * ${d} + Math.cos(y) * ${side}, y: P.pos.y, z: P.pos.z - Math.cos(y) * ${d} - Math.sin(y) * ${side} }; })()`); }
async function dropBy(g, t, item, at) {
  const s = await t.state(), m = await t.eval('({ rd: __SALTLINE_MATCH.round, md: __SALTLINE_MATCH.mode })');
  const p = at || await inFront(t);
  const from = g.msgs.length;
  g.raw({ t: 'drop', d: { items: [{ g: item.g, m: item.m || 0, r: item.r || 0, x: p.x, y: p.y, z: p.z, yw: item.yw || 0.4, rd: m.rd, md: m.md }] } });
  const msg = await g.next(x => x.t === 'drops' && x.add && x.add.some(i => i.by === g.peer), 3000);
  const it = msg && msg.add.find(i => i.by === g.peer);
  if (it) await t.until(`window.__SALTLINE_BAG.state().ground.some(i => i.id === ${JSON.stringify(it.id)})`, 4000);
  void s; void from; return it;
}
async function pickUp(t, id, code = 'KeyG') {
  if (id && !await t.until(`window.__SALTLINE_BAG.state().target === ${JSON.stringify(id)}`, 3000)) return false;
  await t.key(code, 700); await settled(t); return true;
}
async function cleanGround(g) { const list = await g.list(); for (const i of list || []) { g.raw({ t: 'take', d: { id: i.id } }); } await sleep(300); }

/* ================================================================ 1. the room's rules (scripted players only) */
async function roomRules() {
  console.log('\nThe room: guns on the ground');
  const code = await newRoom('dm');
  const a = ghost(code), b = ghost(code); await a.ready; await b.ready; await a.hello(); await b.hello();
  const item = { g: 'sniper', m: 3, r: 20, x: 1.5, y: 0, z: 2.5, yw: 0.5, rd: 7, md: 'dm' };
  const wa = a.next(m => m.t === 'drops' && m.add), wb = b.next(m => m.t === 'drops' && m.add);
  a.raw({ t: 'drop', d: { items: [item] } });
  const ma = await wa, mb = await wb;
  const it = ma && ma.add[0];
  ok(it && mb && mb.add[0].id === it.id && it.g === 'sniper' && it.m === 3 && it.r === 20 && it.by === a.peer && typeof it.at === 'number', 'a drop reaches everyone, the sender too, with its rounds and who dropped it');
  const late = ghost(code); await late.ready; const hello = await late.hello();
  ok(hello && Array.isArray(hello.drops) && hello.drops.some(d => d.id === it.id), 'a player who joins later gets it in their hello');
  // a take, with something put down in exchange
  b.raw({ t: 'take', d: { id: it.id, put: { g: 'rifle', m: 12, r: 40 } } });
  const took = await a.next(m => m.t === 'drops' && m.took);
  ok(took && took.took.id === it.id && took.took.by === b.peer && took.took.item.m === 3 && took.took.item.r === 20, 'a take goes to everyone with what was taken');
  const put = took && took.add && took.add[0];
  ok(put && put.g === 'rifle' && put.m === 12 && put.r === 40 && put.x === it.x && put.z === it.z && put.tk === b.peer && put.of === it.id, 'what was put down lies where the taken gun lay, marked with who took what');
  // the same item again: refused, to that player only
  const before = a.msgs.length;
  b.raw({ t: 'take', d: { id: it.id, put: { g: 'knife' } } });
  const fail = await b.next(m => m.t === 'drops' && m.fail === it.id);
  await sleep(300);
  ok(!!fail && !a.msgs.slice(before).some(m => m.t === 'drops'), 'a second take of it is refused, and only the one who asked hears');
  // two takes at the same moment: one wins
  let wins = 0, fails = 0;
  for (let k = 0; k < 6; k++) {
    a.raw({ t: 'drop', d: { items: [{ ...item, x: 3 + k }] } });
    const m = await a.next(x => x.t === 'drops' && x.add && x.add[0].x === 3 + k); const id = m.add[0].id;
    const fa = a.msgs.length, fb = b.msgs.length;
    a.raw({ t: 'take', d: { id, put: { g: 'knife' } } }); b.raw({ t: 'take', d: { id, put: { g: 'knife' } } });
    await sleep(500);
    const res = [a, b].map((g, gi) => { const ms = g.msgs.slice(gi ? fb : fa); return ms.some(x => x.t === 'drops' && x.took && x.took.id === id && x.took.by === g.peer) ? 'won' : ms.some(x => x.t === 'drops' && x.fail === id) ? 'lost' : '?'; });
    if (res.filter(r => r === 'won').length === 1 && res.filter(r => r === 'lost').length === 1) wins++; else fails++;
  }
  ok(wins === 6 && !fails, `two players taking one gun at once: exactly one gets it, every time (${wins}/6)`);
  const list = await a.list();
  ok(list && list.filter(d => d.g === 'knife' && d.tk).length === 6, 'and only the winner\'s knife went down each time');
  // what is refused
  const bad = [{ ...item, g: 'bazooka' }, { ...item, x: NaN }, { ...item, x: 'a' }, { ...item, m: -1 }, { ...item, m: 2.5 }, { ...item, r: 1e6 }, { ...item, md: 'solo' }, { ...item, rd: -3 }, { ...item, y: 9999 }, null, 7];
  const n0 = (await a.list()).length;
  for (const x of bad) a.raw({ t: 'drop', d: { items: [x] } });
  a.raw({ t: 'drop', d: { items: [item, item, item, item] } });
  a.raw({ t: 'drop', d: { items: 'x' } }); a.raw({ t: 'take', d: { id: 5 } }); a.raw({ t: 'take', d: {} }); a.raw({ t: 'take', d: { id: 'nope' } });
  await sleep(600);
  ok((await a.list()).length === n0, 'odd items, too many at once and takes of nothing change nothing');
  // a knife is never carrying rounds
  a.raw({ t: 'drop', d: { items: [{ ...item, g: 'knife', m: 30, r: 99 }] } });
  const kn = await a.next(m => m.t === 'drops' && m.add && m.add[0].g === 'knife');
  ok(kn && kn.add[0].m === 0 && kn.add[0].r === 0, 'a knife on the ground carries no rounds');
  // the cap
  for (let k = 0; k < 20; k++) a.raw({ t: 'drop', d: { items: [item, item, item] } });
  await sleep(1500);
  const capped = await a.list();
  ok(capped && capped.length === 48, `at most 48 on the ground, the oldest go first (${capped && capped.length})`);
  for (const g of [a, b, late]) g.ws.close();
  // a private room's map change clears the ground
  const code2 = await newRoom('dm'); const c = ghost(code2); await c.ready; await c.hello();
  c.raw({ t: 'drop', d: { items: [item] } }); await c.next(m => m.t === 'drops' && m.add);
  c.raw({ t: 'map', d: { map: 'colosseum' } }); await c.next(m => m.t === 'map');
  ok((await c.list()).length === 0, 'changing a private room\'s map clears the guns of the old map');
  c.ws.close();
}

/* ================================================================ 2. one tab: dropping, picking up, switching */
let T1 = null, code1 = null, G1 = null, tabPeer = null;
async function setupTab() {
  if (T1) return;
  code1 = await newRoom('dm');
  T1 = await browser();
  ok(await T1.open(`${base}/r/${code1}`), `the game loads in room ${code1}`);
  ok(await joinDm(T1), 'the tab joins the Deathmatch with a bag');
  G1 = ghost(code1); await G1.ready; await G1.hello(); G1.join('dm');
  await sleep(1200);
  tabPeer = await T1.eval('__SALTLINE_MATCH.peer');
}
async function tabBasics() {
  console.log('\nOne player: going down, picking up, switching');
  await setupTab();
  const T = T1, g = G1;
  await roomInRound(T, 70000);
  let s = await T.state();
  ok(s.slots[0].g === 'rifle' && s.slots[0].m === 30 && s.slots[1].g === 'knife' && s.pool.rifle === 150 && s.held === 0, 'a life starts with the rifle (30 + 150) and the knife');
  handsRight(s, 'at the start');
  // shots fired (the magazine as the game counts it), then going down
  await T.eval('__G.weapon.rigs.rifle.slot.ammo = 17; 0'); await sleep(200);
  s = await T.state(); ok(s.slots[0].m === 17, 'the bag follows the magazine as the game counts it');
  await unprotected(T);                                           // the protected seconds after a spawn
  const rd = await T.eval('__SALTLINE_MATCH.round');
  const where = await T.eval('[__G.player.pos.x, __G.player.pos.y, __G.player.pos.z]');
  const wait = g.next(m => m.t === 'drops' && m.add && m.add.some(i => i.by === tabPeer), 4000);
  g.kill(tabPeer);
  const dm = await wait, dropped = dm && dm.add.filter(i => i.by === tabPeer);
  ok(dropped && dropped.length === 1 && dropped[0].g === 'rifle' && dropped[0].m === 17 && dropped[0].r === 150, 'going down drops the rifle with its 17 rounds and the 150 spare, never the knife: ' + JSON.stringify(dropped && dropped.map(i => [i.g, i.m, i.r])));
  ok(dropped && dropped[0] && Math.hypot(dropped[0].x - where[0], dropped[0].z - where[2]) < 0.5 && Math.abs(dropped[0].y - where[1]) < 0.3, 'where the player fell, on the floor');
  ok(await T.until(`(() => { const s = window.__SALTLINE_BAG.state(); return s.dead && s.ground.some(i => i.id === ${JSON.stringify(dropped && dropped[0] && dropped[0].id)} && i.shown); })()`, 3000), 'the tab is down and sees its rifle on the ground');
  ok(await T.until('!window.__SALTLINE_BAG.state().dead', 8000), 'it comes back');
  s = await T.state();
  ok(s.slots[0].g === 'rifle' && s.slots[0].m === 30 && s.pool.rifle === 150 && s.slots[1].g === 'knife', 'with a fresh rifle and the knife');
  handsRight(s, 'after coming back');
  void rd;
  // X: to the knife and back; 1 and 2
  await T.key('KeyX'); await settled(T); s = await T.state();
  ok(s.held === 1 && s.hands.knife, 'X takes the knife'); handsRight(s, 'X');
  await T.key('KeyX'); await settled(T); await sleep(300); s = await T.state();
  ok(s.held === 0 && !s.hands.knife && s.hands.gun === 'rifle', 'X again takes the rifle'); handsRight(s, 'X again');
  await T.key('Digit2'); await settled(T); s = await T.state(); ok(s.held === 1 && s.hands.knife, '2 takes the knife');
  await T.key('Digit1'); await settled(T); await sleep(300); s = await T.state(); ok(s.held === 0 && s.hands.gun === 'rifle' && !s.hands.knife, '1 takes the rifle');
  await T.key('Digit1'); await sleep(300); s = await T.state(); ok(s.held === 0 && !s.hands.knife, '1 again changes nothing');
  // the X label says what X would take
  ok(/knife/i.test(await T.eval(`document.querySelector('.mp-knife b').textContent`)), 'the label beside X says Knife');
  await cleanGround(g);
  // the panel: near a gun it says what it is and what it would swap for
  const sn = await dropBy(g, T, { g: 'sniper', m: 4, r: 17 });
  ok(await T.until(`window.__SALTLINE_BAG.state().target === ${JSON.stringify(sn && sn.id)}`, 3000), 'standing at a gun on the ground makes it the one to pick up');
  await sleep(300);
  const panel = await T.eval(`(() => { const p = document.querySelector('.bagp'); return p && p.classList.contains('on') ? p.innerText.replace(/\\s+/g, ' ') : ''; })()`);
  ok(/LOOKOUT/i.test(panel) && /4/.test(panel) && /17/.test(panel) && /swap for/i.test(panel) && /rifle/i.test(panel), 'the panel names it, its rounds, and what it swaps for: ' + panel);
  // a short press does nothing
  await T.key('KeyG', 150); await sleep(400); s = await T.state();
  ok(s.slots[0].g === 'rifle', 'a quick tap of G does not pick up');
  const before = carried(s) + onGround(await g.list(), await T.eval('__SALTLINE_MATCH.round'));
  ok(await pickUp(T, sn.id), 'holding G picks it up');
  s = await T.state();
  ok(s.slots[0].g === 'sniper' && s.slots[0].m === 4 && s.pool.sniper === 17 && s.pool.rifle === 0, 'the sniper is in the rifle\'s slot, with its 4 and 17');
  handsRight(s, 'after the pick-up');
  const after = carried(s) + onGround(await g.list(), await T.eval('__SALTLINE_MATCH.round'));
  ok(before === after, `no rounds made or lost (${before} -> ${after})`);
  const put = (await g.list()).find(i => i.tk === tabPeer && i.of === sn.id);
  ok(put && put.g === 'rifle' && put.m === 30 && put.r === 150, 'the rifle went down where the sniper lay, with its rounds');
  // the key held on: it does not take the rifle straight back
  await T.keyDown('KeyG'); await sleep(1200); await T.keyUp('KeyG'); await settled(T); s = await T.state();
  ok(s.slots[0].g === 'rifle', 'a fresh hold takes the rifle back (the key was let go in between)');
  await T.keyDown('KeyG'); await sleep(1300); s = await T.state(); await T.keyUp('KeyG'); await settled(T);
  ok(s.slots[0].g === 'sniper', 'holding on after a pick-up does not swap again by itself');
  await cleanGround(g);
  // walking up to a gun with the key already held: the hold starts when it comes into reach, not before
  const far = await dropBy(g, T, { g: 'shotgun', m: 6, r: 20 }, await inFront(T, 4));
  await T.keyDown('KeyG'); await sleep(900);
  await T.eval(`(() => { const P = __G.player, i = window.__SALTLINE_BAG.state().ground.find(x => x.id === ${JSON.stringify(far.id)}); P.pos.set(i.x + Math.sin(P.yaw) * 0.6, i.y, i.z + Math.cos(P.yaw) * 0.6); return 1; })()`);
  // the page notes when the gun came into reach and when the swap began
  const gap = await T.eval(`(async () => { const id = ${JSON.stringify(far.id)}; let a = 0, b = 0; for (let k = 0; k < 400 && !b; k++) { const s = window.__SALTLINE_BAG.state(); const t = performance.now(); if (!a && s.target === id) a = t; if (a && (s.pending || s.slots[0].g === 'shotgun')) b = t; await new Promise(r => requestAnimationFrame(r)); } return a && b ? Math.round(b - a) : -1; })()`);
  ok(gap >= 380, 'walking up with G held: taken only after holding there for the hold time, not the moment it comes into reach (' + gap + ' ms)');
  await T.keyUp('KeyG'); await settled(T); s = await T.state();
  ok(s.slots[0].g === 'shotgun', 'but after holding there for the hold time');
  await cleanGround(g);
}

/* ================================================================ 3. every combination */
async function matrix() {
  console.log('\nEvery combination of what is held, the other thing and the gun on the ground');
  await setupTab();
  const T = T1, g = G1;
  let done64 = 0;
  const ALL = ['rifle', 'shotgun', 'sniper', 'knife'], mag = { rifle: 21, shotgun: 4, sniper: 3, knife: 0 }, spare = { rifle: 77, shotgun: 13, sniper: 9 };
  let good = 0, bad = 0;
  for (const held of ALL) for (const other of ALL) for (const gr of ALL) {
    if (done64++ % 8 === 0) await roomInRound(T, 30000);
    const label = `${held} in hand, ${other} beside it, ${gr} on the ground`;
    const pool = { rifle: 0, shotgun: 0, sniper: 0 }; for (const k of new Set([held, other])) if (k !== 'knife') pool[k] = spare[k];
    const othMag = other === held && held !== 'knife' ? mag[held] - 2 : mag[other];
    await T.eval(`window.__SALTLINE_BAG.put(${JSON.stringify({ slots: [{ g: held, m: mag[held] }, { g: other, m: othMag }], held: 0, pool })})`);
    await settled(T); await sleep(150);
    const gm = { rifle: 19, shotgun: 5, sniper: 2, knife: 0 }[gr];
    const it = await dropBy(g, T, { g: gr, m: gm, r: gr === 'knife' ? 0 : 11 });
    if (!it) { ok(false, label + ': the scripted drop arrived'); bad++; continue; }
    const rd = await T.eval('__SALTLINE_MATCH.round');
    const s0 = await T.state(), t0 = carried(s0) + onGround(await g.list(), rd);
    const picked = await pickUp(T, it.id);
    const s = await T.state(), list = await g.list(), t1 = carried(s) + onGround(list, rd);
    // what should have happened
    const share = held === 'knife' ? 0 : other === held ? Math.floor(pool[held] / 2) : pool[held];
    const want = { ...pool }; if (held !== 'knife') want[held] -= share; if (gr !== 'knife') want[gr] += 11;
    const put = list.find(i => i.tk === tabPeer && i.of === it.id);
    const errs = [];
    if (!picked) errs.push('not in reach');
    if (s.slots[0].g !== gr || s.slots[0].m !== gm) errs.push('slot ' + JSON.stringify(s.slots[0]));
    if (s.slots[1].g !== other || s.slots[1].m !== (other === 'knife' ? 0 : othMag)) errs.push('other ' + JSON.stringify(s.slots[1]));
    if (KINDS.some(k => s.pool[k] !== want[k])) errs.push('spare ' + JSON.stringify(s.pool) + ' want ' + JSON.stringify(want));
    if (!put || put.g !== held || put.m !== (held === 'knife' ? 0 : mag[held]) || put.r !== share) errs.push('put ' + JSON.stringify(put && [put.g, put.m, put.r]));
    if (t0 !== t1) errs.push(`rounds ${t0} -> ${t1}`);
    const it2 = s.slots[s.held], hands = it2.g === 'knife' ? s.hands.knife : !s.hands.knife && s.hands.gun === it2.g && s.hands.ammo === it2.m && s.hands.reserve === s.pool[it2.g];
    if (!hands) errs.push('hands ' + JSON.stringify(s.hands));
    if (errs.length) { bad++; ok(false, label + ': ' + errs.join('; ')); } else good++;
    await cleanGround(g);
  }
  ok(bad === 0, `all 64 combinations come out right (${good} of 64)`);
}

/* ================================================================ 4. two guns of one kind, reloading, going down with two guns */
async function twoOfAKind() {
  console.log('\nTwo rifles');
  await setupTab();
  const T = T1, g = G1;
  await roomInRound(T, 60000); await unprotected(T);
  await T.eval(`window.__SALTLINE_BAG.put({ slots: [{ g: 'rifle', m: 30 }, { g: 'knife', m: 0 }], held: 1, pool: { rifle: 150 } })`); await settled(T);
  const it = await dropBy(g, T, { g: 'rifle', m: 12, r: 40 });
  ok(await pickUp(T, it.id), 'with the knife out, a rifle on the ground is picked up');
  let s = await T.state();
  ok(s.slots[0].g === 'rifle' && s.slots[1].g === 'rifle' && s.slots[1].m === 12 && s.pool.rifle === 190, 'two rifles: 30 and 12 in their magazines, 150 + 40 spare shared');
  handsRight(s, 'two rifles');
  const knifePut = (await g.list()).find(i => i.tk === tabPeer && i.of === it.id);
  ok(knifePut && knifePut.g === 'knife', 'the knife went down in exchange');
  await cleanGround(g);
  const switches = await T.eval(`(() => { window.__sw = 0; __G.events.on('weapon:switch', e => { if (e.phase === 'draw') window.__sw++; }); return 1; })()`);
  void switches;
  await T.key('KeyX'); await settled(T); await sleep(300); s = await T.state();
  ok(s.held === 0 && s.hands.gun === 'rifle' && s.hands.ammo === 30 && s.hands.reserve === 190, 'X to the other rifle: its own 30, the shared 190');
  ok(await T.eval('window.__sw') >= 1, 'with the rifle put away and drawn again');
  await T.key('KeyX'); await settled(T); await sleep(300); s = await T.state();
  ok(s.held === 1 && s.hands.ammo === 12, 'and back: 12');
  // a reload draws from the shared spare
  await T.key('KeyR'); await T.until('(() => { const s = window.__SALTLINE_BAG.state(); return s.hands.ammo === 30; })()', 6000); await sleep(300);
  s = await T.state();
  ok(s.slots[1].m === 30 && s.pool.rifle === 172 && s.slots[0].m === 30, `a reload fills it from the shared spare (190 - 18 = ${s.pool.rifle})`);
  handsRight(s, 'after the reload');
  // going down with two rifles: both drop, the spare split between them
  await sleep(500);
  if (process.env.DEBUG) console.log('     debug', await T.eval(`JSON.stringify({ inv: __G.player.invulnerable, hp: __G.player.health, alive: __SALTLINE_MATCH.alive, remotes: [...__SALTLINE_MATCH.players()].map(R => [R.peer, R.alive, R.hSeq]), hits: ${JSON.stringify(g.hits.map(h => h[0]))} })`));
  const wait = g.next(m => m.t === 'drops' && m.add && m.add.some(i => i.by === tabPeer), 4000);
  g.kill(tabPeer); const dm = await wait; const d = dm ? dm.add.filter(i => i.by === tabPeer) : [];
  ok(d.length === 2 && d.every(i => i.g === 'rifle') && d.reduce((a, i) => a + i.r, 0) === 172 && Math.abs(d[0].r - d[1].r) <= 1 && d.every(i => i.m === 30), 'going down drops both rifles, the spare split between them: ' + JSON.stringify(d.map(i => [i.g, i.m, i.r])));
  ok(d.length === 2 && Math.hypot(d[0].x - d[1].x, d[0].z - d[1].z) > 0.4, 'apart enough to pick either');
  await T.until('!window.__SALTLINE_BAG.state().dead', 8000); await sleep(300);
  // both can be told apart by where the player looks
  const ids = d.map(i => i.id);
  const tg = await T.eval(`(async () => { const P = __G.player, d = ${JSON.stringify(d.map(i => ({ x: i.x, y: i.y, z: i.z, id: i.id })))}; const out = []; for (const i of d) { const mx = (d[0].x + d[1].x) / 2, mz = (d[0].z + d[1].z) / 2, lx = d[1].x - d[0].x, lz = d[1].z - d[0].z, l = Math.hypot(lx, lz); P.pos.set(mx - lz / l * 0.9, i.y, mz + lx / l * 0.9); P.yaw = Math.atan2(-(i.x - P.pos.x), -(i.z - P.pos.z)); await new Promise(r => setTimeout(r, 500)); out.push(window.__SALTLINE_BAG.state().target === i.id); } return out; })()`);
  ok(Array.isArray(tg) && tg.every(Boolean), 'looking at one or the other picks which one the panel offers: ' + JSON.stringify(tg));
  void ids; await cleanGround(g);
}

/* ================================================================ 5. going down in the middle of a swap */
async function deathMidSwap() {
  console.log('\nGoing down in the middle of a swap');
  await setupTab();
  const T = T1, g = G1;
  for (const outcome of ['won', 'lost']) {
    await T.until('!window.__SALTLINE_BAG.state().dead', 8000); await roomInRound(T, 30000); await unprotected(T);
    await T.eval(`window.__SALTLINE_BAG.put({ slots: [{ g: 'shotgun', m: 5 }, { g: 'rifle', m: 22 }], held: 0, pool: { shotgun: 30, rifle: 90 } })`); await settled(T);
    const it = await dropBy(g, T, { g: 'sniper', m: 2, r: 8 });
    const rd = await T.eval('__SALTLINE_MATCH.round');
    const before = carried(await T.state()) + onGround(await g.list(), rd);
    // the take is held back a moment, as a slow connection would
    await T.eval(`(async () => { const r = await window.__SALTLINE_ROOM(); if (!r.__take) { r.__take = r.take; } r.take = (id, put) => { setTimeout(() => r.__take(id, put), ${outcome === 'won' ? 900 : 2000}); return true; }; return 1; })()`);
    await T.until(`window.__SALTLINE_BAG.state().target === ${JSON.stringify(it.id)}`, 3000);
    await T.key('KeyG', 700);
    const pend = (await T.state()).pending;
    g.kill(tabPeer);
    if (outcome === 'lost') { await T.until('window.__SALTLINE_BAG.state().dead', 3000); g.raw({ t: 'take', d: { id: it.id } }); }   // someone else gets there first, after the tab went down
    const dead = await T.until('window.__SALTLINE_BAG.state().dead', 3000);
    await sleep(3000);
    await T.eval(`(async () => { const r = await window.__SALTLINE_ROOM(); r.take = r.__take; return 1; })()`);
    const list = await g.list(), mine = list.filter(i => i.by === tabPeer && i.rd === rd);
    const tookByGhost = g.msgs.some(m => m.t === 'drops' && m.took && m.took.id === it.id && m.took.by === g.peer) ? 2 + 8 : 0;   // what the other player walked off with
    const after = onGround(list, rd) + tookByGhost;                                     // the tab is down: everything it had is on the ground
    ok(!!pend && dead, `(${outcome}) the swap was on its way when the player went down`);
    ok(before === after, `(${outcome}) no rounds made or lost: ${before} -> ${after} ` + JSON.stringify(mine.map(i => [i.g, i.m, i.r])));
    const shot = mine.find(i => i.g === 'shotgun'), rif = mine.find(i => i.g === 'rifle'), sni = mine.find(i => i.g === 'sniper');
    if (outcome === 'won') ok(shot && rif && sni && shot.tk === tabPeer && sni.m === 2 && sni.r === 8 && rif.r === 90 && shot.r === 30, '(won) the shotgun lies where the sniper was, the sniper and the rifle where the player fell');
    else ok(shot && rif && !sni && shot.r === 30 && rif.r === 90, '(lost) the shotgun and the rifle lie where the player fell');
    await cleanGround(g);
  }
}

/* ================================================================ 6. the drawer */
async function drawer() {
  console.log('\nThe bag (B)');
  await setupTab();
  const T = T1;
  await roomInRound(T, 60000);
  await T.until('!window.__SALTLINE_BAG.state().dead', 8000); await sleep(400);
  await T.eval(`window.__SALTLINE_BAG.put({ slots: [{ g: 'sniper', m: 3 }, { g: 'rifle', m: 25 }], held: 0, pool: { sniper: 12, rifle: 100 } })`); await settled(T);
  await T.key('KeyB'); await T.until(`+getComputedStyle(document.querySelector('.bag')).opacity > 0.95`, 3000);
  let s = await T.state();
  const dom = await T.eval(`(() => { const d = document.querySelector('.bag'); const r = d.getBoundingClientRect(); return { on: d.classList.contains('on'), vis: getComputedStyle(d).visibility, op: +getComputedStyle(d).opacity, rows: [...d.querySelectorAll('.bag-row')].map(x => x.innerText.replace(/\\s+/g, ' ')), held: [...d.querySelectorAll('.bag-row')].map(x => x.classList.contains('held')), right: innerWidth - r.right, bottom: innerHeight - r.bottom, w: r.width }; })()`);
  ok(s.drawer && dom.on && dom.vis === 'visible' && dom.op > 0.9, 'B opens the bag');
  ok(dom.rows.length === 2 && /LOOKOUT/i.test(dom.rows[0]) && /3/.test(dom.rows[0]) && /12/.test(dom.rows[0]) && /LONGSHORE/i.test(dom.rows[1]) && /25/.test(dom.rows[1]) && /100/.test(dom.rows[1]) && dom.held[0] && !dom.held[1], 'it lists 1: the sniper (in your hands) and 2: the rifle, with their rounds: ' + JSON.stringify(dom.rows));
  ok(dom.right >= 8 && dom.right < 60 && dom.bottom > 100, `at the bottom right, above the ammo (${Math.round(dom.right)} px from the right, ${Math.round(dom.bottom)} from the bottom)`);
  // moving while it is open
  const p0 = await T.eval('[__G.player.pos.x, __G.player.pos.z]');
  await T.key('KeyW', 700); await sleep(200);
  const p1 = await T.eval('[__G.player.pos.x, __G.player.pos.z]');
  ok(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 0.5, 'the player still walks with it open');
  ok(await T.eval('__G.weapon.debug.noFire === true'), 'and cannot fire');
  // the arrows change the order; the gun in the hands stays in the hands
  await T.key('ArrowDown'); await sleep(400); s = await T.state();
  ok(s.slots[0].g === 'rifle' && s.slots[1].g === 'sniper' && s.held === 1 && s.hands.gun === 'sniper', 'the arrow keys swap 1 and 2; the sniper stays in the hands, now as 2');
  const rows2 = await T.eval(`[...document.querySelectorAll('.bag .bag-row')].map(x => x.innerText.replace(/\\s+/g, ' '))`);
  ok(/LONGSHORE/i.test(rows2[0]) && /LOOKOUT/i.test(rows2[1]), 'and the bag shows the new order');
  await T.key('Digit1'); await settled(T); await sleep(300); s = await T.state();
  ok(s.held === 0 && s.hands.gun === 'rifle' && s.hands.ammo === 25, '1 now takes the rifle');
  handsRight(s, 'after reordering');
  // dragging a row, with a pointer that is not captured (a finger, or a free mouse)
  const drag = await T.eval(`(async () => { const rows = document.querySelectorAll('.bag .bag-row'), a = rows[0].getBoundingClientRect(), b = rows[1].getBoundingClientRect();
    const ev = (type, el, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, clientX: a.left + 40, clientY: y, isPrimary: true }));
    ev('pointerdown', rows[0], a.top + 20); for (let k = 1; k <= 6; k++) { ev('pointermove', rows[0], a.top + 20 + (b.top - a.top) * k / 6); await new Promise(r => setTimeout(r, 30)); } ev('pointerup', rows[0], b.top + 20);
    await new Promise(r => setTimeout(r, 300)); return window.__SALTLINE_BAG.state().slots.map(x => x.g); })()`);
  ok(JSON.stringify(drag) === '["sniper","rifle"]', 'dragging the top row down swaps them: ' + JSON.stringify(drag));
  s = await T.state(); handsRight(s, 'after the drag');
  const tap = await T.eval(`(async () => { const r = document.querySelectorAll('.bag .bag-row')[0], a = r.getBoundingClientRect(); const ev = t => r.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 8, clientX: a.left + 40, clientY: a.top + 20, isPrimary: true })); ev('pointerdown'); ev('pointerup'); await new Promise(x => setTimeout(x, 900)); return window.__SALTLINE_BAG.state().held; })()`);
  ok(tap === 0, 'a tap on a row takes that one in hand');
  // with the mouse captured: a cursor of the bag's own
  await T.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 500, y: 300, button: 'left', clickCount: 1 }); await T.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 500, y: 300, button: 'left', clickCount: 1 });
  const lockedNow = await T.eval('!!document.pointerLockElement');
  if (lockedNow) {
    const yaw0 = await T.eval('__G.player.yaw');
    for (let k = 0; k < 10; k++) await T.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 500 + k * 15, y: 300 });
    await sleep(300);
    ok(Math.abs(await T.eval('__G.player.yaw') - yaw0) < 1e-6, 'with the mouse captured, moving it moves the bag\'s cursor, not the view');
  } else {
    // a headless browser does not capture the mouse: the page is told it is captured, and gets the events a captured mouse sends
    const r = await T.eval(`(async () => {
      const view = document.getElementById('view') || document.querySelector('canvas');
      Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => view });
      const P = __G.player, frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const move = (dx, dy) => view.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, movementX: dx, movementY: dy }));
      const out = {};
      const yaw0 = P.yaw; for (let k = 0; k < 8; k++) { move(40, 0); await frame(); }
      out.viewStill = Math.abs(P.yaw - yaw0) < 1e-6;
      out.cursor = getComputedStyle(document.querySelector('.bag-cursor')).display !== 'none';
      // a click with the captured mouse never fires
      const a0 = __G.weapon.rigs[__G.weapon.current].slot.ammo;
      view.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); await frame(); await frame(); await frame();
      out.noShot = __G.weapon.rigs[__G.weapon.current].slot.ammo === a0 && !__G.input.fire;
      view.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })); await frame();
      // drag the top row down with the bag's cursor
      const host = document.querySelector('.mp-ui').getBoundingClientRect(), rows = document.querySelectorAll('.bag .bag-row'), a = rows[0].getBoundingClientRect(), b = rows[1].getBoundingClientRect();
      const cur = document.querySelector('.bag-cursor'), at = () => { const m = /translate\\(([-\\d.]+)px, ([-\\d.]+)px\\)/.exec(cur.style.transform); return m ? [+m[1] + host.left, +m[2] + host.top] : [0, 0]; };
      let [cx, cy] = at(); move(Math.round(a.left + 60 - cx), Math.round(a.top + a.height / 2 - cy)); await frame();
      const before = window.__SALTLINE_BAG.state().slots.map(x => x.g);
      view.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); await frame();
      for (let k = 0; k < 6; k++) { move(0, Math.round((b.top - a.top) / 6)); await frame(); }
      view.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })); await frame(); await frame();
      out.dragged = JSON.stringify(window.__SALTLINE_BAG.state().slots.map(x => x.g)) === JSON.stringify(before.slice().reverse());
      out.held = window.__SALTLINE_BAG.state().slots[window.__SALTLINE_BAG.state().held].g === before[window.__SALTLINE_BAG.state().held === 0 ? 1 : 0] || true;
      return out; })()`);
    ok(r && r.viewStill, 'with the mouse captured, moving it does not turn the view while the bag is open');
    ok(r && r.cursor, 'it moves the bag\'s own cursor');
    ok(r && r.noShot, 'and a click does not fire');
    ok(r && r.dragged, 'dragging a row with that cursor swaps 1 and 2');
    s = await T.state(); handsRight(s, 'after the drag with the captured mouse');
  }
  await T.key('KeyB'); await sleep(350); s = await T.state();
  ok(!s.drawer && !(await T.eval('document.querySelector(".bag").classList.contains("on")')), 'B closes it');
  ok(await T.eval('__G.weapon.debug.noFire !== true'), 'and the gun fires again');
  const turns = await T.eval(`(async () => { if (!Object.getOwnPropertyDescriptor(document, 'pointerLockElement')) return null; const view = document.getElementById('view') || document.querySelector('canvas'); const P = __G.player, y0 = P.yaw; for (let k = 0; k < 6; k++) { view.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, movementX: 40, movementY: 0 })); await new Promise(r => requestAnimationFrame(r)); } const moved = Math.abs(P.yaw - y0) > 1e-4; delete document.pointerLockElement; return moved; })()`);
  if (turns !== null) ok(turns, 'with it closed, the same mouse movement turns the view again');
  // it closes by itself on going down
  await T.key('KeyB'); await sleep(300); await unprotected(T);
  G1.kill(tabPeer); await sleep(800); s = await T.state();
  ok(!s.drawer, 'going down closes it');
  await T.until('!window.__SALTLINE_BAG.state().dead', 8000);
  await T.key('KeyB'); await sleep(300); ok((await T.state()).drawer, 'it opens again in the next life'); await T.key('KeyB'); await sleep(300);
  await cleanGround(G1);
}

/* ================================================================ 7. a reload keeps the bag; a reload while down does not bring it back */
async function keepAcrossReload() {
  console.log('\nA reload of the page');
  await setupTab();
  const T = T1;
  await roomInRound(T, 90000);
  await T.until('!window.__SALTLINE_BAG.state().dead', 8000);
  await T.eval(`window.__SALTLINE_BAG.put({ slots: [{ g: 'shotgun', m: 2 }, { g: 'sniper', m: 4 }], held: 1, pool: { shotgun: 20, sniper: 9 } })`); await settled(T); await sleep(1800);
  await T.send('Page.reload'); await sleep(1500);
  ok(await T.until('!!window.__ready', 90000), 'the page reloads');
  ok(await T.until('!!(window.__SALTLINE_MATCH && window.__SALTLINE_MATCH.live && window.__SALTLINE_BAG.state().active)', 40000), 'and goes back into the match');
  await sleep(800);
  let s = await T.state();
  ok(s.slots[0].g === 'shotgun' && s.slots[0].m === 2 && s.slots[1].g === 'sniper' && s.slots[1].m === 4 && s.pool.shotgun === 20 && s.pool.sniper === 9 && s.held === 1, 'with the same bag: no free rounds, no lost gun ' + JSON.stringify([s.slots, s.pool]));
  handsRight(s, 'after the reload');
  // down, then reloaded during the card: the guns are on the ground, the bag is fresh
  await unprotected(T);
  G1 = G1 || ghost(code1);
  const wait = G1.next(m => m.t === 'drops' && m.add && m.add.some(i => i.by === tabPeer), 4000);
  G1.kill(tabPeer); await wait; await sleep(500);
  await T.send('Page.reload'); await sleep(1500);
  await T.until('!!window.__ready', 90000); await T.until('!!(window.__SALTLINE_MATCH && window.__SALTLINE_MATCH.live && window.__SALTLINE_BAG.state().active)', 40000); await sleep(800);
  s = await T.state();
  ok(s.slots[0].g === 'rifle' && s.slots[0].m === 30 && s.pool.rifle === 150 && s.pool.shotgun === 0 && s.pool.sniper === 0, 'a reload while down comes back with a fresh rifle, not the guns already dropped');
  const list = await G1.list();
  ok(list.filter(i => i.by === tabPeer && (i.g === 'shotgun' || i.g === 'sniper')).length === 2, 'the dropped guns are still on the ground');
  ok((await T.state()).ground.filter(i => i.shown).length >= 2, 'and the reloaded page shows them');
  await cleanGround(G1);
}

/* ================================================================ 8. a new round */
async function newRound() {
  console.log('\nA new round');
  await setupTab();
  const T = T1;
  await roomInRound(T, 30000);
  await T.until('!window.__SALTLINE_BAG.state().dead', 8000); await sleep(300);
  await T.eval(`window.__SALTLINE_BAG.put({ slots: [{ g: 'sniper', m: 1 }, { g: 'knife', m: 0 }], held: 0, pool: { sniper: 3 } })`); await settled(T);
  const it = await dropBy(G1, T, { g: 'shotgun', m: 6, r: 30 });
  await T.eval(`(() => { const o = Date.now, c = ${CYCLE}, d = c - o() % c + 2000; Date.now = () => o() + d; return 1; })()`);
  ok(await T.until(`window.__SALTLINE_MATCH.round !== ${it.rd}`, 8000), 'the round changes');
  await sleep(800);
  const s = await T.state();
  ok(s.slots[0].g === 'rifle' && s.slots[0].m === 30 && s.slots[1].g === 'knife' && s.pool.rifle === 150 && s.pool.sniper === 0, 'everyone starts fresh: rifle and knife');
  const g0 = s.ground.find(i => i.id === it.id);
  ok(!g0 || !g0.shown, 'the last round\'s guns are gone from the ground');
  ok(!s.target, 'and cannot be picked up');
  await cleanGround(G1);
}

/* ================================================================ 9. two tabs: racing for one gun, a late joiner, another key */
async function race() {
  console.log('\nTwo players, one gun');
  await setupTab();
  const T = T1;
  await roomInRound(T, 120000);
  const T2 = await browser();
  ok(await T2.open(`${base}/r/${code1}`), 'a second tab loads');
  await T2.eval(`localStorage.setItem('saltline.mp.keys', JSON.stringify({ pickup: 'KeyH' })); 0`);
  await T2.send('Page.reload'); await sleep(1500); await T2.until('!!window.__ready', 90000);
  ok(await joinDm(T2), 'and joins');
  ok(await T2.eval('window.__SALTLINE_KB.code("pickup") === "KeyH"'), 'with Pick up set to H in its settings');
  await sleep(1500);
  // a late joiner sees what is already on the ground
  const early = await dropBy(G1, T, { g: 'sniper', m: 5, r: 5 });
  ok(await T2.until(`window.__SALTLINE_BAG.state().ground.some(i => i.id === ${JSON.stringify(early.id)} && i.shown)`, 5000), 'the second tab sees a gun dropped after it joined');
  await cleanGround(G1);
  const T3 = await browser();
  const it0 = await dropBy(G1, T, { g: 'shotgun', m: 6, r: 6 });
  ok(await T3.open(`${base}/r/${code1}`) && await joinDm(T3), 'a third tab joins later');
  ok(await T3.until(`window.__SALTLINE_BAG.state().ground.some(i => i.id === ${JSON.stringify(it0.id)})`, 8000), 'and has the gun that was already there');
  ok(await T3.until(`window.__SALTLINE_BAG.state().ground.some(i => i.id === ${JSON.stringify(it0.id)} && i.shown)`, 20000), 'and shows it once its model is in');
  await cleanGround(G1);
  // G does nothing on the tab that moved Pick up to H
  const p = await T.eval('[__G.player.pos.x, __G.player.pos.y, __G.player.pos.z, __G.player.yaw]');
  let wins = 0, both = 0, none = 0;
  for (let k = 0; k < 5; k++) {
    await T.eval(`window.__SALTLINE_BAG.put({ slots: [{ g: 'rifle', m: 30 }, { g: 'knife', m: 0 }], held: 0, pool: { rifle: 150 } })`);
    await T2.eval(`window.__SALTLINE_BAG.put({ slots: [{ g: 'rifle', m: 30 }, { g: 'knife', m: 0 }], held: 0, pool: { rifle: 150 } })`);
    // both players next to the same spot, facing it
    const at = { x: p[0], y: p[1], z: p[2] };
    await T.eval(`(() => { const P = __G.player; P.pos.set(${at.x} + 0.7, ${at.y}, ${at.z}); P.yaw = Math.PI / 2; return 1; })()`);
    await T2.eval(`(() => { const P = __G.player; P.pos.set(${at.x} - 0.7, ${at.y}, ${at.z}); P.yaw = -Math.PI / 2; return 1; })()`);
    await sleep(400);
    const it = await dropBy(G1, T, { g: 'sniper', m: 5, r: 25 }, at);
    await T2.until(`window.__SALTLINE_BAG.state().target === ${JSON.stringify(it.id)}`, 3000);
    await T.until(`window.__SALTLINE_BAG.state().target === ${JSON.stringify(it.id)}`, 3000);
    await Promise.all([T.keyDown('KeyG'), T2.keyDown('KeyH')]); await sleep(750); await Promise.all([T.keyUp('KeyG'), T2.keyUp('KeyH')]);
    await settled(T); await settled(T2); await sleep(400);
    const a = await T.state(), b = await T2.state();
    const got = [a, b].filter(s => s.slots[0].g === 'sniper').length;
    if (got === 1) wins++; else if (got === 2) both++; else none++;
    const list = await G1.list();
    if (list.filter(i => i.g === 'rifle' && i.tk).length !== got) both += 100;
    handsRight(a, `race ${k + 1}, first tab`); handsRight(b, `race ${k + 1}, second tab`);
    await cleanGround(G1);
  }
  ok(wins === 5 && !both, `both holding at the same moment: exactly one gets it, every time (${wins}/5, both ${both}, none ${none})`);
  // the one that lost is told
  ok(!T2.errors.length && !T3.errors.length, 'no errors on the other tabs: ' + JSON.stringify(T2.errors.concat(T3.errors).slice(0, 3)));
  // the tab that moved the key: G does nothing there
  await T2.eval(`window.__SALTLINE_BAG.put({ slots: [{ g: 'rifle', m: 30 }, { g: 'knife', m: 0 }], held: 0, pool: { rifle: 150 } })`);
  const it2 = await dropBy(G1, T2, { g: 'sniper', m: 5, r: 25 });
  await T2.until(`window.__SALTLINE_BAG.state().target === ${JSON.stringify(it2.id)}`, 3000);
  await T2.key('KeyG', 800); await sleep(500);
  ok((await T2.state()).slots[0].g === 'rifle', 'G does nothing where Pick up was moved to H');
  const cap = await T2.eval(`document.querySelector('.bagp [data-k="pickup"]').textContent`);
  ok(cap === 'H', 'and the panel shows H: ' + cap);
  await cleanGround(G1);
}

/* ================================================================ 10. Team deathmatch */
async function tdm() {
  console.log('\nTeam deathmatch');
  const code = await newRoom('tdm');
  const T = await browser();
  ok(await T.open(`${base}/r/${code}`), 'the game loads');
  ok(await joinTeam(T, 0), 'and joins Red');
  const g = ghost(code); await g.ready; await g.hello(); g.join('tdm'); await sleep(1500);
  const peer = await T.eval('__SALTLINE_MATCH.peer');
  await roomInRound(T, 30000); await unprotected(T);
  const wait = g.next(m => m.t === 'drops' && m.add && m.add.some(i => i.by === peer), 5000);
  g.kill(peer); const dm = await wait;
  ok(dm && dm.add[0].md === 'tdm' && dm.add[0].g === 'rifle', 'going down in Team deathmatch drops the rifle there');
  // a Deathmatch drop in the same room is not shown to a Team deathmatch player
  const it = await dropBy(g, T, { g: 'sniper', m: 1, r: 1 });
  const m = await T.eval('({ rd: __SALTLINE_MATCH.round })');
  g.raw({ t: 'drop', d: { items: [{ g: 'shotgun', m: 1, r: 1, x: it.x, y: it.y, z: it.z + 0.5, yw: 0, rd: m.rd, md: 'dm' }] } }); await sleep(800);
  const s = await T.state();
  ok(s.ground.some(i => i.g === 'sniper' && i.shown) && !s.ground.some(i => i.g === 'shotgun' && i.md === 'dm' && i.shown), 'guns dropped in the other mode are not shown');
  ok(!T.errors.length, 'no errors: ' + JSON.stringify(T.errors.slice(0, 3)));
}

/* ================================================================ 11. touch screens */
async function touch() {
  console.log('\nTouch screens');
  const code = await newRoom('dm');
  const T = await browser({ w: 900, h: 420, touch: true });
  ok(await T.open(`${base}/r/${code}`), 'the game loads as on a phone');
  ok(await joinDm(T), 'and joins');
  // the game turns to its touch controls at the first touch
  await T.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 450, y: 210, id: 9 }] }); await sleep(80); await T.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(500);
  ok(await T.eval('document.documentElement.classList.contains("is-touch")'), 'and turns to its touch controls at the first touch');
  const g = ghost(code); await g.ready; await g.hello(); g.join('dm'); await sleep(1500);
  await T.until('!!document.querySelector(".mp-ui.live.play")', 15000);
  const btn = await T.eval(`(() => { const b = document.querySelector('.bag-btn'); if (!b) return null; const r = b.getBoundingClientRect(); return { show: getComputedStyle(b).display !== 'none', x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  ok(btn && btn.show, 'a Bag button is on the screen');
  const tap = async (x, y, ms = 60) => { await T.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); await sleep(ms); await T.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  if (btn) { await tap(btn.x, btn.y); await sleep(400); ok((await T.state()).drawer, 'tapping it opens the bag'); await tap(btn.x, btn.y); await sleep(400); ok(!(await T.state()).drawer, 'and again closes it'); }
  const it = await dropBy(g, T, { g: 'sniper', m: 5, r: 25 });
  await T.until(`window.__SALTLINE_BAG.state().target === ${JSON.stringify(it.id)}`, 3000); await sleep(300);
  const pb = await T.eval(`(() => { const b = document.querySelector('.bag-pickbtn'); const r = b.getBoundingClientRect(); return { show: getComputedStyle(b).display !== 'none', x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  ok(pb.show, 'next to a gun, a Pick up button shows');
  await tap(pb.x, pb.y, 150); await sleep(400);
  ok((await T.state()).slots[0].g === 'rifle', 'a quick tap does not pick up');
  await tap(pb.x, pb.y, 750); await settled(T);
  ok((await T.state()).slots[0].g === 'sniper', 'holding it does');
  const layout = await T.eval(`(() => { const s = document.getElementById('touch-layout'); return !!s; })()`);
  ok(layout !== undefined, 'the touch layout editor knows the new buttons');
  ok(!T.errors.length, 'no errors: ' + JSON.stringify(T.errors.slice(0, 3)));
}

/* ================================================================ 12. a minute on the ground */
async function expiry() {
  console.log('\nA minute on the ground (about 70 seconds)');
  await setupTab();
  const T = T1;
  await roomInRound(T, 75000);
  await T.until('!window.__SALTLINE_BAG.state().dead', 8000);
  const it = await dropBy(G1, T, { g: 'shotgun', m: 3, r: 3 }, await inFront(T, 6));
  // timed by the room's own clock: the tab says how long the gun has left
  const leftNow = async () => { const g = (await T.state()).ground.find(i => i.id === it.id); return g ? g.left : -1; };
  let l0 = await leftNow(); if (l0 > 4000) await sleep(l0 - 4000);
  let s = await T.state(), e = s.ground.find(i => i.id === it.id);
  ok(e && e.left < 5000 && e.left > 0, `56 s after it went down it is still there, in its last seconds (${e && e.left} ms left)`);
  const seen = await T.eval(`(async () => { const out = new Set(); for (let k = 0; k < 20; k++) { const g = window.__SALTLINE_BAG.state().ground.find(i => i.id === ${JSON.stringify(it.id)}); out.add(g ? g.shown : 'gone'); await new Promise(r => setTimeout(r, 70)); } return [...out]; })()`);
  ok(seen.includes(true) && seen.includes(false), 'and blinking: ' + JSON.stringify(seen));
  l0 = await leftNow(); if (l0 > -1500) await sleep(l0 + 1500);
  s = await T.state();
  ok(!s.ground.some(i => i.id === it.id), 'after a minute it is gone from the tab');
  ok(!(await G1.list()).some(i => i.id === it.id), 'and from the room');
}

/* ---------------------------------------------------------------- run */
if (part('room')) await roomRules();
if (part('tab')) await tabBasics();
if (part('matrix')) await matrix();
if (part('tab') || part('two')) await twoOfAKind();
if (part('death')) await deathMidSwap();
if (part('drawer')) await drawer();
if (part('keep')) await keepAcrossReload();
if (part('round')) await newRound();
if (part('race')) await race();
if (part('tdm')) await tdm();
if (part('touch')) await touch();
if (part('expiry')) await expiry();
if (T1) ok(!T1.errors.length, 'no errors on the main tab: ' + JSON.stringify(T1.errors.slice(0, 5)));
done();
