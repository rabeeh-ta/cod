// Score check: one real game tab (headless Chrome) and scripted players in the same room, over several rounds.
// It counts kills, deaths and team scores through everything that used to lose or keep them wrongly: a kill reported
// across a reconnect, a reload in the middle of a round, leaving and joining again after the round changed, a new
// round while in the match, and changes of side in Team deathmatch. Needs `npm run dev` running and Google Chrome.
//
//   node scripts/score-check.mjs [http://localhost:8787]        (CHROME=/path/to/chrome to use another browser)
//
// The scripted players only send what a real page sends (presence over the room socket). Rounds are reached by moving
// the page's clock forward, so the whole run takes about two minutes. It reads the tab's own counts from what the tab
// sends to the room, the way every other player sees them.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] || 'http://localhost:8787', wsBase = base.replace(/^http/, 'ws');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CYCLE = 310000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };

/* ---------------------------------------------------------------- the browser */
const profile = mkdtempSync(join(tmpdir(), 'saltline-score-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=800,500', '--no-first-run', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
const done = code => { try { chrome.kill('SIGKILL'); } catch { /* gone */ } setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch { /* fine */ } process.exit(code); }, 500); };
process.on('uncaughtException', e => { console.error(e); done(2); });

// Chrome picks a free port and writes it into the profile (another browser may hold any fixed one)
let list = [];
for (let i = 0; i < 120 && !list.some(t => t.type === 'page'); i++) {
  try { const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { /* not up yet */ }
  await sleep(250);
}
const target = list.find(t => t.type === 'page');
if (!target) { console.error('Chrome did not start'); done(2); await sleep(10000); }
const cdp = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => { cdp.onopen = r; });
let cid = 0; const waiting = new Map();
const errors = []; // anything the page throws, or logs as an error, while the check runs
cdp.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description : m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(x => x.value || x.description || '').join(' '));
};
const send = (method, params = {}) => new Promise(r => { const i = ++cid; waiting.set(i, r); cdp.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable');
async function tab(expr) {
  const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(15000).then(() => null)]);
  return r && r.result && r.result.result ? r.result.result.value : undefined;
}
const until = async (expr, ms = 60000) => { for (let t = 0; t < ms; t += 500) { if (await tab(expr)) return true; await sleep(500); } return false; };
async function open(code) {
  await send('Page.navigate', { url: `${base}/r/${code}` });
  await sleep(1500);
  return until('!!window.__ready');
}
const live = () => until('!!(window.__SALTLINE_MATCH && window.__SALTLINE_MATCH.live)', 30000);
async function joinDm() {
  await tab(`(async () => { for (let i = 0; i < 40 && !document.querySelector('[data-act="join"]:not(:disabled)'); i++) await new Promise(r => setTimeout(r, 250));
    const m = document.querySelector('.fe-mode[data-mode="dm"]'); if (m) m.click(); await new Promise(r => setTimeout(r, 300)); document.querySelector('[data-act="join"]').click(); })()`);
  return live();
}
async function joinTeam(i) {
  await tab(`(async () => { for (let i = 0; i < 40 && !document.querySelector('.fe-join-team[data-team="${i}"]:not(:disabled)'); i++) await new Promise(r => setTimeout(r, 250)); document.querySelector('.fe-join-team[data-team="${i}"]').click(); })()`);
  return live();
}
// the tab has drawn the other player (it may be busy preparing graphics for a few seconds after joining; nobody can be shot before that)
const seesGhost = () => until('[...window.__SALTLINE_MATCH.players()].length > 0', 30000);
const leaveMatch = async () => { await tab(`window.__G.game.state = 'title'`); return until('!window.__SALTLINE_MATCH.live', 10000); };
// the page's clock jumps to two seconds into the next round
const nextRound = () => tab(`(() => { const o = Date.now, c = ${CYCLE}, d = c - o() % c + 2000; Date.now = () => o() + d; return Math.floor(Date.now() / c); })()`);
const feedText = () => tab(`[...document.querySelectorAll('.mp-kills > *')].map(e => e.textContent.trim()).join(' | ')`);

/* ---------------------------------------------------------------- scripted players */
function ghost(code, peer, uid) {
  const ws = new WebSocket(`${wsBase}/api/rooms/${code}/ws?peer=${peer}&uid=${uid}`);
  const g = { ws, peer, msgs: [], tabPeer: null, tabP: {}, joins: [] };
  ws.onmessage = e => {
    if (e.data === 'pong') return;
    const m = JSON.parse(e.data); g.msgs.push(m);
    if (m.t === 'hello') for (const x of m.peers) if (!/^ghost/.test(x.peer)) { g.tabPeer = x.peer; g.tabP = x.p || {}; }
    if (m.t === 'join' && !/^ghost/.test(m.peer)) { g.joins.push(m.peer); g.tabPeer = m.peer; }
    if (m.t === 'p' && m.peer === g.tabPeer) g.tabP = m.full ? m.d : Object.assign({}, g.tabP, m.d);
  };
  g.ready = new Promise(r => { ws.onopen = r; });
  g.hello = async () => { for (let i = 0; i < 80 && !g.msgs.some(m => m.t === 'hello'); i++) await sleep(50); };
  g.send = (d, full) => ws.send(JSON.stringify({ t: 'p', d, ...(full ? { full: true } : {}) }));
  return g;
}
const seq = () => Date.now() + Math.floor(Math.random() * 100);

/* ================================================================ Deathmatch */
let G = null, dl = [], deaths = 0;
const rd = () => G.tabP.rd;
if (!process.env.ONLY_TDM) {
console.log('\nDeathmatch');
const dm = (await (await fetch(base + '/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'dm' }) })).json()).code;
ok(await open(dm), `the game loads in room ${dm}`);
ok(await joinDm(), 'the tab joins the Deathmatch');
await sleep(1500);

G = ghost(dm, 'ghost00001', 'ghost-uid-1'); await G.ready; await G.hello();
const me = { m: 'dm', tm: -1, p: [4, 0, 4], r: [0, 0], st: 1, hp: 100, w: 0, n: 'Ghost', k: 0, d: 0, sh: null, h: [], dl: [], bx: [], g: [], c: '#9fd66b', uid: 'ghost-uid-1', ld: 'ghostload1' };
G.send({ ...me, rd: rd() }, true); await sleep(1500);
ok(await seesGhost(), 'the tab draws the scripted player');
const tabPeer = G.tabPeer;
ok(!!tabPeer && G.tabP.m === 'dm', `the scripted player sees the tab (${tabPeer})`);
async function die(full) { // the scripted player goes down to the tab
  dl = [...dl, [seq(), tabPeer, 'rifle', 0]].slice(-4); deaths++;
  G.send({ ...(full ? me : {}), st: 0, d: deaths, dl, rd: rd() }, full); await sleep(1200);
  G.send({ st: 1 }); await sleep(500);
}
async function reconnect(closeFirst, ld) { // the same scripted player's connection comes back, a death in its first message
  if (closeFirst) { G.ws.close(); await sleep(800); }
  const g2 = ghost(dm, 'ghost00001', 'ghost-uid-1'); g2.tabPeer = tabPeer; g2.tabP = G.tabP; await g2.ready; await g2.hello();
  if (!closeFirst) { const old = G; setTimeout(() => { try { old.ws.close(); } catch { /* fine */ } }, 50); }
  G = g2; if (ld) me.ld = ld;
  await die(true);
}

for (let round = 1; round <= 4; round++) {
  const start = G.tabP.k | 0;
  await die(false); await die(false);
  ok(G.tabP.k === start + 2, `round ${round}: two kills count (${G.tabP.k})`);
  await reconnect(false);
  ok(G.tabP.k === start + 3, `round ${round}: a kill reported as the connection comes back counts (${G.tabP.k})`);
  await reconnect(true, round === 2 ? 'ghostload2' : null);
  ok(G.tabP.k === start + 4, `round ${round}: a kill reported after the room saw the player go counts (${G.tabP.k})`);
  if (round === 2) ok(/reloaded and is back/.test(await feedText()), 'the kill feed says the player reloaded and is back');
  if (round === 1) {
    // a reload in the middle of the round (real time: the page's own clock)
    const k = G.tabP.k;
    G.joins = [];
    await send('Page.reload'); await sleep(1500);
    ok(await until('!!window.__ready'), 'the page reloads');
    ok(await live(), 'and goes straight back into the match');
    await sleep(2000);
    ok(G.tabPeer === tabPeer, `as the same player (${G.tabPeer})`);
    ok(G.tabP.k === k, `with this round's kills (${G.tabP.k} of ${k})`);
    ok(/is back with \d+ kills? this round/.test(await feedText()), 'and the kill feed says so');
    await die(false);
    ok(G.tabP.k === k + 1, `a kill after the reload counts (${G.tabP.k})`);
  }
  if (round === 3) {
    // leave, the round changes in the menus, join again
    ok(await leaveMatch(), 'the tab leaves the match');
    const r = await nextRound(); await sleep(800);
    ok(await joinDm(), 'and joins again after the round changed');
    await sleep(1500);
    ok(G.tabP.rd === r && G.tabP.k === 0 && G.tabP.d === 0, `it starts the new round at zero (k ${G.tabP.k}, d ${G.tabP.d})`);
    G.send({ rd: rd() }); await sleep(300);
    continue;
  }
  // a new round while in the match
  const r = await nextRound();
  for (let i = 0; i < 20 && G.tabP.rd !== r; i++) await sleep(250);
  ok(G.tabP.rd === r && G.tabP.k === 0, `round ${round + 1} starts at zero (k ${G.tabP.k})`);
  G.send({ k: 0, d: 0, rd: rd() }); deaths = 0; await sleep(300);
}
G.ws.close();
}

/* ================================================================ Team deathmatch */
console.log('\nTeam deathmatch');
const tdm = (await (await fetch(base + '/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'tdm' }) })).json()).code;
ok(await open(tdm), `the game loads in room ${tdm}`);
ok(await joinTeam(0), 'the tab joins Red');
await sleep(1500);
G = ghost(tdm, 'ghost00002', 'ghost-uid-2'); await G.ready; await G.hello();
const T = G.tabPeer;
const blue = { m: 'tdm', tm: 1, p: [20, 0, 4], r: [0, 0], st: 1, hp: 100, w: 0, n: 'Ghost', k: 0, d: 0, sh: null, h: [], dl: [], bx: [], g: [], uid: 'ghost-uid-2', ld: 'ghostload3', kt: [[0, 0], [0, 0]] };
G.send({ ...blue, rd: rd() }, true); await sleep(1500);
ok(await seesGhost(), 'the tab draws the scripted player');
dl = [];
async function tdmDie(state) { dl = [...dl, [seq(), T, 'rifle', 0]].slice(-4); G.send({ ...state, st: 0, dl, rd: rd() }); await sleep(1200); G.send({ st: 1 }); await sleep(500); }
await tdmDie({ d: 1, kt: [[0, 0], [0, 1]] }); await tdmDie({ d: 2, kt: [[0, 0], [0, 2]] });
ok(G.tabP.k === 2 && G.tabP.ts && G.tabP.ts[0] === 2 && G.tabP.ts[1] === 0, `two kills for Red (k ${G.tabP.k}, teams ${JSON.stringify(G.tabP.ts)})`);

// the scripted player goes to the menus and comes back on Red, with 3 kills made for Blue
G.send({ ...blue, k: 3, d: 2, kt: [[0, 0], [3, 2]], rd: rd() }); await sleep(1200);
ok(G.tabP.ts[1] === 3, `Blue has the scripted player's 3 kills (${JSON.stringify(G.tabP.ts)})`);
G.send({ m: '', p: null }); await sleep(1500);
dl = []; // joining again starts the page's lists afresh, as a real page does
G.send({ ...blue, tm: 0, k: 0, d: 0, kt: [[0, 0], [3, 2]], rd: rd() }, true); await sleep(1500);
ok(G.tabP.ts[0] === 2 && G.tabP.ts[1] === 3, `after changing to Red, Blue keeps those 3 kills (${JSON.stringify(G.tabP.ts)})`);
ok(/joined Red/.test(await feedText()), 'the kill feed says the player joined Red');
const boardText = () => tab(`(async () => { dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', bubbles: true })); await new Promise(r => setTimeout(r, 700)); const t = document.querySelector('.mp-board').innerText; dispatchEvent(new KeyboardEvent('keyup', { code: 'Tab', bubbles: true })); return t; })()`);
ok(/Ghost \(moved to Red\)/.test(await boardText()), 'the board shows those kills as "Ghost (moved to Red)" under Blue');

// the tab changes to Blue: its 2 Red kills stay with Red
ok(await leaveMatch(), 'the tab leaves the match');
ok(await joinTeam(1), 'and joins Blue');
await sleep(1500);
ok(G.tabP.tm === 1 && G.tabP.k === 0 && G.tabP.ts[0] === 2 && G.tabP.ts[1] === 3, `on Blue: 0 kills, Red still 2, Blue 3 (k ${G.tabP.k}, teams ${JSON.stringify(G.tabP.ts)})`);
await tdmDie({ d: 1, kt: [[0, 1], [3, 2]] });
ok(G.tabP.k === 1 && G.tabP.ts[1] === 4, `a kill for Blue (k ${G.tabP.k}, teams ${JSON.stringify(G.tabP.ts)})`);

// a reload keeps both sides' counts
await send('Page.reload'); await sleep(1500);
ok(await until('!!window.__ready') && await live(), 'the page reloads back into the match');
await sleep(2500);
ok(G.tabP.tm === 1 && G.tabP.k === 1 && G.tabP.ts[0] === 2 && G.tabP.ts[1] === 4, `after the reload: Blue 1 kill, teams Red 2 Blue 4 (k ${G.tabP.k}, teams ${JSON.stringify(G.tabP.ts)})`);

// the scripted player leaves for good: its Blue kills stay with Blue
G.ws.close(); await sleep(2000);
const ts = await tab(`JSON.stringify(window.__net.room().mine().ts)`);
ok(ts === '[2,4]', `after the scripted player left, the teams are still Red 2, Blue 4 (${ts})`);

/* ================================================================ the page itself */
console.log('\nThe page');
// Ctrl+R in the middle of play is held back (the game still reloads the gun); paused, it is let through
const ctrlR = () => tab(`(() => { const e = new KeyboardEvent('keydown', { code: 'KeyR', key: 'r', ctrlKey: true, bubbles: true, cancelable: true }); dispatchEvent(e); return e.defaultPrevented; })()`);
ok(await ctrlR() === true, 'Ctrl+R does not reload the page in the middle of play');
await tab(`window.__G.game.state = 'paused'`); await sleep(300);
ok(await ctrlR() === false, 'paused, Ctrl+R reloads as usual');
await tab(`window.__G.game.state = 'playing'`);
// a duplicated tab copies the first tab's kept player id; it must take a new one
const peerA = await tab(`sessionStorage.getItem('saltline.peer')`);
const second = await (await fetch(`http://127.0.0.1:${new URL(target.webSocketDebuggerUrl).port}/json/new?${encodeURIComponent(base + '/')}`, { method: 'PUT' })).json();
const cdp2 = new WebSocket(second.webSocketDebuggerUrl); await new Promise(r => { cdp2.onopen = r; });
let id2 = 0; const w2 = new Map(); cdp2.onmessage = e => { const m = JSON.parse(e.data); if (m.id && w2.has(m.id)) { w2.get(m.id)(m); w2.delete(m.id); } };
const send2 = (method, params = {}) => new Promise(r => { const i = ++id2; w2.set(i, r); cdp2.send(JSON.stringify({ id: i, method, params })); });
const tab2 = async expr => { const r = await send2('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
await sleep(2000);
await tab2(`sessionStorage.setItem('saltline.peer', ${JSON.stringify(peerA)})`);
await send2('Page.reload'); await sleep(3000);
const peerB = await tab2(`sessionStorage.getItem('saltline.peer')`);
ok(peerA && peerB && peerB !== peerA && /^[a-z0-9]{10}$/.test(peerB), `a duplicated tab takes a player id of its own (${peerA} -> ${peerB})`);
ok(await tab(`sessionStorage.getItem('saltline.peer')`) === peerA, 'and the first tab keeps its own');
try { cdp2.close(); } catch { /* fine */ }

ok(!errors.length, 'the page threw nothing' + (errors.length ? ':\n  ' + [...new Set(errors)].slice(0, 8).join('\n  ') : ''));
console.log(failed ? `\n${failed} failed` : '\nall passed');
try { cdp.close(); } catch { /* fine */ }
done(failed ? 1 : 0);
