// Protocol smoke test against a running server (default: wrangler dev on :8787).
//   node scripts/smoke.mjs [http://localhost:8787]
const base = process.argv[2] || 'http://localhost:8787';
const wsBase = base.replace(/^http/, 'ws');
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CODE = /^[A-HJ-NP-Z2-9]{6}$/;

function client(code, n) {
  const peer = 'peer' + String(n).padStart(4, '0');
  const ws = new WebSocket(`${wsBase}/api/rooms/${code}/ws?peer=${peer}&uid=user-${n}xx`);
  const c = { peer, ws, msgs: [], closed: null };
  ws.onmessage = e => { if (e.data !== 'pong') c.msgs.push(JSON.parse(e.data)); };
  ws.onclose = e => { c.closed = e.code; };
  c.ready = new Promise(r => { ws.onopen = r; ws.onerror = r; });
  c.hello = async () => { for (let i = 0; i < 50 && !c.msgs.some(m => m.t === 'hello' || m.t === 'error'); i++) await sleep(50); return c.msgs.find(m => m.t === 'hello'); };
  return c;
}

const page = await fetch(base + '/r/ABCDEF');
ok(page.ok && (await page.text()).includes('/net.js'), 'invite link serves the game with net.js');
ok((await fetch(base + '/net.js')).ok, 'net.js is served');

const created = await fetch(base + '/api/rooms', { method: 'POST' });
const { code } = await created.json();
ok(created.status === 201 && /^[A-HJ-NP-Z2-9]{6}$/.test(code), `create room -> ${code}`);
let info = await (await fetch(`${base}/api/rooms/${code}`)).json();
ok(info.exists && info.players === 0 && info.max === 10, 'room info: exists, 0/10');
ok(!(await (await fetch(`${base}/api/rooms/ZZZZZ2`)).json()).exists, 'unknown room: exists=false');

const a = client(code, 1); await a.ready; const ha = await a.hello();
ok(ha && ha.peers.length === 0, 'first player gets hello with no peers');
a.ws.send(JSON.stringify({ t: 'p', d: { m: 'dm', p: [1, 2, 3], n: 'alpha' } }));
await sleep(150);

const b = client(code, 2); await b.ready; const hb = await b.hello();
ok(hb && hb.peers.length === 1 && hb.peers[0].p.n === 'alpha' && hb.peers[0].p.p[2] === 3, 'second player sees first player and their stored presence');
await sleep(150);
ok(a.msgs.some(m => m.t === 'join' && m.peer === b.peer), 'first player is told about the join');

b.ws.send(JSON.stringify({ t: 'p', d: { p: [4, 5, 6] } }));
await sleep(150);
const rel = a.msgs.find(m => m.t === 'p' && m.peer === b.peer);
ok(rel && rel.d.p[0] === 4, 'presence delta is relayed');
ok(!b.msgs.some(m => m.t === 'p' && m.peer === b.peer), 'sender does not get its own echo');

a.ws.send('ping'); await sleep(100);

// fill to 10, then the 11th is refused
const more = [];
for (let i = 3; i <= 10; i++) { const c = client(code, i); more.push(c); await c.ready; await c.hello(); }
info = await (await fetch(`${base}/api/rooms/${code}`)).json();
ok(info.players === 10, `room info: 10/10 (got ${info.players})`);
const x = client(code, 11); await x.ready; await x.hello(); await sleep(200);
ok(x.msgs.some(m => m.t === 'error' && m.code === 'full'), '11th player is refused with "full"');
ok(!more[0].msgs.some(m => m.t === 'join' && m.peer === x.peer), 'refused player is never announced');

// reconnect with the same peer id replaces the old socket without a leave
const a2 = client(code, 1); await a2.ready; const ha2 = await a2.hello(); await sleep(200);
ok(ha2 && ha2.peers.length === 9, 'reconnect with same peer id is accepted while room is full');
ok(!b.msgs.some(m => m.t === 'leave' && m.peer === a.peer), 'no leave is announced for a replaced socket');

b.ws.close(1000); await sleep(300);
ok(a2.msgs.some(m => m.t === 'leave' && m.peer === b.peer), 'leave is announced when a player disconnects');

const bad = client('ZZZZZ2', 12); await bad.ready; await bad.hello(); await sleep(200);
ok(bad.msgs.some(m => m.t === 'error' && m.code === 'not_found'), 'joining an unknown room is refused with "not_found"');


// voice signalling goes to one peer only
{
  const room2 = (await (await fetch(base + '/api/rooms', { method: 'POST' })).json()).code;
  const p1 = client(room2, 21), p2 = client(room2, 22), p3 = client(room2, 23);
  for (const c of [p1, p2, p3]) { await c.ready; await c.hello(); }
  p1.ws.send(JSON.stringify({ t: 'sig', to: p2.peer, d: { k: 'offer', sdp: 'v=0' } }));
  await sleep(200);
  const got = p2.msgs.find(m => m.t === 'sig');
  ok(got && got.from === p1.peer && got.d.k === 'offer', 'voice signal reaches its target');
  ok(!p3.msgs.some(m => m.t === 'sig'), 'voice signal is not seen by anyone else');
  const ice = await fetch(`${base}/api/ice?room=${room2}`);
  const ij = await ice.json();
  ok(ice.ok && ij.iceServers.some(s => [].concat(s.urls).some(u => u.includes('cloudflare.com'))), 'ICE servers come from Cloudflare');
  ok((await fetch(`${base}/api/ice?room=ZZZZZ2`)).status === 404, 'ICE servers are only handed out for real rooms');
  for (const c of [p1, p2, p3]) c.ws.close();
}

// quick play fills one room before opening another
{
  const q1 = (await (await fetch(base + '/api/quick', { method: 'POST' })).json()).code;
  const q2 = (await (await fetch(base + '/api/quick', { method: 'POST' })).json()).code;
  ok(CODE.test(q1) && q1 === q2, `quick play puts players together (${q1}, ${q2})`);
  const qs = [];
  for (let i = 0; i < 10; i++) { const c = client(q1, 30 + i); qs.push(c); await c.ready; await c.hello(); }
  await sleep(300);
  const st = await (await fetch(base + '/api/online')).json();
  ok(st.dm.players >= 10 && st.dm.matches >= 1, `online counts quick-play players (${st.dm.players} in ${st.dm.matches} matches)`);
  ok(st.rooms.rooms >= 1 && st.rooms.players >= 1, `online counts private rooms (${st.rooms.rooms} rooms, ${st.rooms.players} players)`);
  ok(st.online === st.dm.players + st.rooms.players, `online is the sum (${st.online})`);
  const q3 = (await (await fetch(base + '/api/quick', { method: 'POST' })).json()).code;
  ok(CODE.test(q3) && q3 !== q1, `a full public room is skipped (${q3})`);
  for (const c of qs) c.ws.close();
}

for (const c of [a, a2, ...more]) try { c.ws.close(); } catch { /* fine */ }
await sleep(200);
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
