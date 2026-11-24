// Score hooks: the edits to the generated game (web/index.html) that keep kills and deaths right over a whole evening
// of rounds. Like the other hooks, each finds its place by exact text and fails loudly unless it matches exactly once.
// They run last (after the map, gun and perf hooks), so their anchors are the game as those hooks leave it.
//
// 1. A kill reported across a reconnect counts. The room told everyone about a "join" when a player's connection came
//    back, so their games made that player anew and took everything in the first message as already seen, the death
//    that just happened included: the killer never got the kill. Now each game remembers, for a minute, what it had
//    seen from a player who went (mp.seen) and carries on from there when the same player is back. Event numbers (shots,
//    hits, deaths, blasts, grenades) grow with the clock instead of from 1, so a reloaded page's are always newer than
//    anything it sent before. (The room no longer announces a reconnect as a join either: src/worker.js.)
// 2. A new round starts at zero for everyone, even a player who was in the menus when it began. The counts remember
//    the round they were made in (stats.rd), and joining in a later round clears them. They used to come back: a player
//    who left the match and joined again after the round changed had last round's kills on the board.
// 3. A reload keeps this round's kills. web/net.js keeps the tab's player id across reloads (and map changes, and pages
//    the browser reloads on its own); the game keeps the counts for this tab (sessionStorage 'saltline.score': room,
//    player id, round, mode and team counts) and gives them back on joining the same room in the same round as the same
//    player. Ctrl+R no longer reloads in the middle of play (Ctrl is a crouch key); pausing first still allows it.
// 4. Team deathmatch: kills stay with the team they were made for. A player who changes side keeps the counts for each
//    team (stats.tdm.per) and sends both (kt); the kills made for the old team are a row of their own on that team,
//    "Name (moved to Blue)", and a kept score of a player who left joins a row only on its own team. The team scores
//    are still the sum of the rows under them.
// 5. The kill feed says when a player is back: "is back" after a dropped connection, "reloaded and is back", or
//    "joined Blue" after a change of side. Each page sends an id of its own load (ld) so a reload can be told apart.
//
//   import { applyScoreHooks } from './score-hooks.mjs'   (scripts/import.mjs runs it on every import)
//   node scripts/score-hooks.mjs in.html out.html        (apply to a game file that has the other hooks but not these)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function applyScoreHooks(html) {
  function swap(find, to, what) {
    const n = html.split(find).length - 1;
    if (n !== 1) throw new Error(`score hooks: expected exactly one match for ${what}, found ${n}`);
    html = html.replace(find, () => to);
  }

  /* ---------------------------------------------------------------- the counts and what they belong to */

  swap(`const stats = { dm: { kills: 0, deaths: 0 }, tdm: { kills: 0, deaths: 0, team: -1 } };`,
    `const stats = { dm: { kills: 0, deaths: 0 }, tdm: { kills: 0, deaths: 0, team: -1, per: [[0, 0], [0, 0]] }, rd: -1 }; // per: kills and deaths made for each team this round; rd: the round they were made in`,
    'the counts');
  swap(`shSeq: 0, shot: null, hSeq: 0, hits: [],`, `seen: new Map(), shSeq: 0, shot: null, hSeq: 0, hits: [],`, 'what was seen from players who went');
  swap(`    const S = () => stats[mp.mode] || stats.dm;\n`, `    const S = () => stats[mp.mode] || stats.dm;
    /* ---- scores (scripts/score-hooks.mjs) */
    const LOAD_ID = Math.random().toString(36).slice(2, 10); // this page load: a reload is told apart from a dropped connection
    const nextSeq = s => Math.max(s + 1, Date.now()); // event numbers grow with the clock, so a reloaded page's are newer than anything sent before it
    function tdmPer() { const p = stats.tdm.per.map(x => x.slice()); if (stats.tdm.team === 0 || stats.tdm.team === 1) p[stats.tdm.team] = [stats.tdm.kills, stats.tdm.deaths]; return p; }
    const SCORE_KEY = 'saltline.score';
    let scoreSig = '';
    function keepScore() { // this tab's counts, so a reload gives them back (sessionStorage: this tab only)
      if (!mp.live || !net.room || !net.myPeer) return;
      const s = S(), sig = JSON.stringify({ code: net.room.code || '', peer: net.myPeer, rd: mp.round, m: mp.mode, tm: mp.team, k: s.kills, d: s.deaths, per: mp.mode === 'tdm' ? tdmPer() : null });
      if (sig === scoreSig) return; scoreSig = sig;
      try { sessionStorage.setItem(SCORE_KEY, sig); } catch { /* this page only */ }
    }
    function keptScore(mode) { // the counts this tab had in this room this round, as the same player; otherwise null
      let o = null; try { o = JSON.parse(sessionStorage.getItem(SCORE_KEY) || 'null'); } catch { o = null; }
      if (!o || !net.room || o.code !== net.room.code || o.peer !== net.myPeer || o.rd !== roundNow() || o.m !== mode) return null;
      return o;
    }
`, 'the score helpers');

  /* ---------------------------------------------------------------- joining: the round, a reload, a change of side */

  swap(`      if (mode === 'tdm' && stats.tdm.team !== team) { stats.tdm.kills = 0; stats.tdm.deaths = 0; stats.tdm.team = team; }\n`,
    `      // counts from an earlier round belong to that round: a player who was in the menus when this one began starts at zero
      if (stats.rd !== roundNow()) { for (const m of ['dm', 'tdm']) { stats[m].kills = 0; stats[m].deaths = 0; } stats.tdm.per = [[0, 0], [0, 0]]; stats.rd = roundNow(); }
      // this tab was in this room earlier this round as the same player (a reload, a map change, a page the browser reloaded): its counts come back
      const fresh = !stats[mode].kills && !stats[mode].deaths, kept = keptScore(mode);
      if (kept && mode === 'tdm' && Array.isArray(kept.per)) { for (const i of [0, 1]) for (const j of [0, 1]) stats.tdm.per[i][j] = Math.max(stats.tdm.per[i][j], int(kept.per[i] && kept.per[i][j])); }
      else if (kept && mode === 'dm') { stats.dm.kills = Math.max(stats.dm.kills, int(kept.k)); stats.dm.deaths = Math.max(stats.dm.deaths, int(kept.d)); }
      // a change of side: what was made for the old team stays with it (stats.tdm.per, sent as kt); the new team's counts come back if this player was on it before
      if (mode === 'tdm' && stats.tdm.team !== team) {
        if (stats.tdm.team === 0 || stats.tdm.team === 1) stats.tdm.per[stats.tdm.team] = [stats.tdm.kills, stats.tdm.deaths];
        stats.tdm.team = team; stats.tdm.kills = stats.tdm.per[team][0]; stats.tdm.deaths = stats.tdm.per[team][1];
      } else if (kept && mode === 'tdm') { stats.tdm.kills = Math.max(stats.tdm.kills, stats.tdm.per[team][0]); stats.tdm.deaths = Math.max(stats.tdm.deaths, stats.tdm.per[team][1]); }
      const restored = kept && fresh ? stats[mode].kills : 0;
`, 'joining a match');
  swap(`      mp.bank = {}; mp.hits = []; mp.dl = []; mp.bx = []; frag.sent = []; mp.shot = null;`,
    `      mp.seen.clear(); mp.bank = {}; mp.hits = []; mp.dl = []; mp.bx = []; frag.sent = []; mp.shot = null;`, 'joining forgets players seen before');
  swap(`      respawn(true);\n      hudText(); lobbyPresence();\n      net.ch = net.room; net.named = false; mp.joining = false; mp.dirty = true;\n`,
    `      respawn(true);\n      hudText(); lobbyPresence();\n      net.ch = net.room; net.named = false; mp.joining = false; mp.dirty = true;
      if (restored > 0) feed('is back with ' + restored + (restored === 1 ? ' kill' : ' kills') + ' this round', who(net.myPeer)); // in the feed: the message line is taken by the mouse prompt after a reload
`, 'the note on a kept score');

  /* ---------------------------------------------------------------- a new round */

  swap(`      for (const m of ['dm', 'tdm']) { stats[m].kills = 0; stats[m].deaths = 0; }\n      mp.bank = {}; mp.last = {}; mp.round = next;\n      for (const R of remotes.values()) if (R.rd !== next) { R.k = 0; R.d = 0; }`,
    `      for (const m of ['dm', 'tdm']) { stats[m].kills = 0; stats[m].deaths = 0; }\n      stats.tdm.per = [[0, 0], [0, 0]]; stats.rd = next;\n      mp.bank = {}; mp.last = {}; mp.round = next;\n      for (const R of remotes.values()) if (R.rd !== next) { R.k = 0; R.d = 0; R.kt = null; }`,
    'a new round');

  /* ---------------------------------------------------------------- event numbers */

  swap(`mp.shot = [++mp.shSeq,`, `mp.shot = [(mp.shSeq = nextSeq(mp.shSeq)),`, 'a shot');
  swap(`mp.hits.push([++mp.hSeq,`, `mp.hits.push([(mp.hSeq = nextSeq(mp.hSeq)),`, 'a hit');
  swap(`mp.dl.push([++mp.dSeq,`, `mp.dl.push([(mp.dSeq = nextSeq(mp.dSeq)),`, 'going down');
  swap(`mp.bx.push([++mp.bSeq,`, `mp.bx.push([(mp.bSeq = nextSeq(mp.bSeq)),`, 'a blast');
  swap(`frag.sent.push([++frag.seq,`, `frag.sent.push([(frag.seq = nextSeq(frag.seq)),`, 'a grenade');

  /* ---------------------------------------------------------------- players who go and come back */

  swap(`      avatars.remove(R.av.group); R.tag.remove(); remotes.delete(R.peer);\n      if (left && mp.live) {\n`,
    `      avatars.remove(R.av.group); R.tag.remove(); remotes.delete(R.peer);\n      if (left && mp.live) {
        mp.seen.set(R.peer, { sh: R.shSeq, h: R.hSeq, dl: R.dSeq, bx: R.bSeq, g: R.gSeq, ld: R.ld || '', tm: R.tm, t: performance.now() });
        if (mp.seen.size > 40) mp.seen.delete(mp.seen.keys().next().value);
        if (mp.mode === 'tdm' && R.kt) for (const i of [0, 1]) if (i !== R.tm && R.kt[i][0] > 0) bankPut(R.peer + '#' + i, i, R.kt[i][0], R.id, R.name, R.kt[i][1]); // kills made for the side they left earlier
`, 'a player who goes');
  swap(`      if (peer === net.myPeer || remotes.has(peer)) return;\n      const cur = mp.bank[peer];`,
    `      const base = String(peer).split('#')[0]; // "peer#team": kills that player made for their other side
      if (base === net.myPeer || remotes.has(base)) return;\n      const cur = mp.bank[peer];`, 'kept scores of players who are here');
  swap(`if (!R) { R = makeRemote(p.peer); remotes.set(p.peer, R); delete mp.bank[p.peer]; }`,
    `if (!R) { R = makeRemote(p.peer); remotes.set(p.peer, R); delete mp.bank[p.peer]; if (Array.isArray(pr.kt)) { delete mp.bank[p.peer + '#0']; delete mp.bank[p.peer + '#1']; } } // back: they send their own counts for both sides`,
    'a player who comes back');
  swap(`      if (cur) mp.last[R.peer] = { k: R.k, d: R.d, tm: R.tm };\n`,
    `      R.kt = cur && Array.isArray(pr.kt) ? [0, 1].map(i => Array.isArray(pr.kt[i]) ? [int(pr.kt[i][0]), int(pr.kt[i][1])] : [0, 0]) : null;
      if (cur) mp.last[R.peer] = { k: R.k, d: R.d, tm: R.tm, kt: R.kt };\n`, 'counts for both sides, received');
  swap(`      if (first) {
        R.shSeq = Array.isArray(pr.sh) ? +pr.sh[0] || 0 : 0; R.hSeq = maxSeq(pr.h); R.dSeq = maxSeq(pr.dl); R.bSeq = maxSeq(pr.bx); R.gSeq = maxSeq(pr.g); R.vSeq = maxSeq(pr.v);
        resolve([R.id]);
        if (performance.now() - mp.joinedAt > 1500) feed('dropped in', who(R.peer));
        return;
      }\n`, `      const ld = typeof pr.ld === 'string' ? pr.ld.slice(0, 16) : '', ldWas = R.ld || ''; R.ld = ld || ldWas;
      const was = first ? mp.seen.get(R.peer) : null; if (was) mp.seen.delete(R.peer);
      const back = was && performance.now() - was.t < 60000 ? was : null;
      if (first && back) {
        // the same player back within a minute (a dropped connection, a reload, a change of side): carry on from what was
        // seen from them, so a death or a hit in this first message still counts
        R.shSeq = back.sh; R.hSeq = back.h; R.dSeq = back.dl; R.bSeq = back.bx; R.gSeq = back.g; R.vSeq = maxSeq(pr.v);
        resolve([R.id]);
        feed(ld && back.ld && ld !== back.ld ? 'reloaded and is back' : R.tm !== back.tm && (R.tm === 0 || R.tm === 1) ? 'joined ' + TEAMS[R.tm].name : 'is back', who(R.peer));
      } else if (first) {
        R.shSeq = Array.isArray(pr.sh) ? +pr.sh[0] || 0 : 0; R.hSeq = maxSeq(pr.h); R.dSeq = maxSeq(pr.dl); R.bSeq = maxSeq(pr.bx); R.gSeq = maxSeq(pr.g); R.vSeq = maxSeq(pr.v);
        resolve([R.id]);
        if (performance.now() - mp.joinedAt > 1500) feed('dropped in', who(R.peer));
        return;
      } else if (ld && ldWas && ld !== ldWas) feed('reloaded and is back', who(R.peer)); // reloaded so fast the room never saw them go\n`,
    'a player seen for the first time, or again');

  /* ---------------------------------------------------------------- what this page sends and keeps */

  swap(`bk: mp.mode === 'tdm' ? Object.keys(mp.bank).map(k => [k, ...mp.bank[k]]) : null, uid: net.myId,`,
    `bk: mp.mode === 'tdm' ? Object.keys(mp.bank).map(k => [k, ...mp.bank[k]]) : null, kt: mp.mode === 'tdm' ? tdmPer() : null, ld: LOAD_ID, uid: net.myId,`, 'what a player sends');
  swap(`    function hudText() {\n      if (!mp.live) return;\n`, `    function hudText() {\n      if (!mp.live) return;\n      keepScore();\n`, 'the counts kept for a reload');

  /* ---------------------------------------------------------------- Team deathmatch rows */

  swap(`      // one row per person: a kept score joins the row of whoever has the same player id or, failing that, the same name\n`,
    `      // kills a player made for the other side before changing it stay with that side, as a row of their own
      if (mp.mode === 'tdm') {
        const moved = (peer, id, name, tm, kt) => { if (!kt || (tm !== 0 && tm !== 1)) return; const o = 1 - tm; if (kt[o][0] > 0 || kt[o][1] > 0) rows.push({ me: false, left: true, moved: true, peer: peer + '#' + o, id, name: name + ' (moved to ' + TEAMS[tm].name + ')', k: kt[o][0], d: kt[o][1], tm: o, alive: false, css: '#e8e4da' }); };
        moved(net.myPeer, net.myId, rows[0].name, mp.team, tdmPer());
        for (const R of remotes.values()) moved(R.peer, R.id, R.name || 'Someone', R.tm, R.kt || (mp.last[R.peer] && mp.last[R.peer].kt));
      }
      // one row per person: a kept score joins the row of whoever has the same player id or, failing that, the same name\n`,
    'rows for kills made for the other side');
  swap(`        const key = n => String(n || '').replace(/ \\(left\\)$/, '').trim().toLowerCase(), nm = key(name), named = nm && nm !== 'someone';
        const same = rows.find(r => !r.left && id && (r.me ? id === net.myId : r.id === id)) || (named && rows.find(r => !r.left && key(r.name) === nm))
          || rows.find(r => r.left && ((id && r.id === id) || (named && key(r.name) === nm)));`,
    `        const key = n => String(n || '').replace(/ \\((left|moved to \\w+)\\)$/, '').trim().toLowerCase(), nm = key(name), named = nm && nm !== 'someone';
        // only on the team the kills were made for: a player who came back on the other side gets a row of their own here
        const same = rows.find(r => !r.left && r.tm === tm && id && (r.me ? id === net.myId : r.id === id)) || (named && rows.find(r => !r.left && r.tm === tm && key(r.name) === nm))
          || rows.find(r => r.left && r.tm === tm && ((id && r.id === id) || (named && key(r.name) === nm)));
        const there = !same && rows.find(r => !r.left && r.tm !== tm && ((id && (r.me ? id === net.myId : r.id === id)) || (named && key(r.name) === nm)));`,
    'kept scores join a row on their own team');
  swap(`else rows.push({ me: false, left: true, peer, id, name: (name || 'Someone') + ' (left)', k, d: d || 0, tm, alive: false, css: '#e8e4da' });`,
    `else rows.push({ me: false, left: true, peer, id, name: (name || 'Someone') + (there && (there.tm === 0 || there.tm === 1) ? ' (moved to ' + TEAMS[there.tm].name + ')' : ' (left)'), k, d: d || 0, tm, alive: false, css: '#e8e4da' });`,
    'the row of a kept score');

  /* ---------------------------------------------------------------- Ctrl+R */

  swap(`addEventListener('keydown', tabKey); addEventListener('keyup', tabKey);`,
    `addEventListener('keydown', tabKey); addEventListener('keyup', tabKey);
    // Ctrl+R reloads the page in most browsers, and Ctrl is a crouch key: crouching while reloading the gun must not leave
    // the match. The game still reloads the gun; pausing first (Esc) lets the page be reloaded on purpose.
    addEventListener('keydown', ev => { if (mp.live && game.state === 'playing' && ev.ctrlKey && !ev.metaKey && ev.code === 'KeyR') ev.preventDefault(); }, true);`,
    'Ctrl+R in play');

  return html;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) { console.error('usage: node scripts/score-hooks.mjs in.html out.html'); process.exit(1); }
  writeFileSync(out, applyScoreHooks(readFileSync(src, 'utf8')));
  console.log('score hooks applied -> ' + out);
}
