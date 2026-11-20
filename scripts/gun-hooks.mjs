// Gun hooks: the places where the generated game (web/index.html) lets more guns in, and what a respawn does now
// that there is a gun to choose (the card, the choice, the protected seconds after it).
// The game was written with two guns, each built in code. Extra guns live in web/guns.js (models in web/guns/); these
// hooks are the only edits to the game for them. Like the map hooks, each is found by a pattern that captures the
// minified names around it and fails loudly when it matches anything but exactly once. Fix the pattern then; never
// loosen the check. They run after the map hooks (they extend the constants those hand out).
//
//   import { applyGunHooks } from './gun-hooks.mjs'     (scripts/import.mjs runs it on every import)
//   node scripts/gun-hooks.mjs in.html out.html        (apply to a game file that has the map hooks but no gun hooks)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const GUNS = 'window.__SALTLINE_GUNS';
const W = '[\\w$]+';

export function applyGunHooks(html) {
  function hook(re, to, what) {
    const all = html.match(new RegExp(re.source, 'g')) || [];
    if (all.length !== 1) throw new Error(`gun hooks: expected exactly one match for ${what}, found ${all.length}`);
    html = html.replace(re, (...m) => to(...m));
  }
  const rx = (src) => new RegExp(src.replace(/§/g, W));

  /* ---------------------------------------------------------------- the game's core */

  // 1. the script loads before the game, after the maps
  hook(/<script src="\/maps\.js"><\/script>\n/, m => `${m}<script src="/guns.js"></script>\n`, 'the map scripts');

  // 2. what a gun needs from the game's sound code: the gunshot synthesiser and the rifle's settings for it (to make
  //    shots that sit in the same mix), and the table that says which sounds a gun uses
  const synth = html.match(rx('(§)=\\((§),(§),(§)\\)=>(§)\\(\\2,\\3,\\4,(§)\\),§=\\(\\2,\\3,\\4\\)=>\\5\\(\\2,\\3,\\4,§\\)'));
  if (!synth) throw new Error('gun hooks: the gunshot synthesiser was not found');
  const mix = html.match(rx('let §=(§)\\.weapon\\[§\\],§=§\\.currentTime'));
  if (!mix) throw new Error('gun hooks: the table of gun sounds was not found');
  hook(rx('(§)\\.consts=\\{world:§,sun:§,sky:§,sounds:§\\};'),
    (m, g) => `${m}${g}.consts.gunSound={shot:${synth[5]},rifle:${synth[6]},mix:${mix[1]}};`, 'the constants handed to maps');

  // 2b. the music has its own level in Settings: the mixer's music channel is kept where web/guns.js can reach it
  hook(rx('music:(§)\\((§)\\.musicBus\\)\\};'), (m, gain, cfg) => `music:${cfg}.musicNode=${gain}(${cfg}.musicBus)};`, 'the music channel');

  // 3. the weapon module builds its two guns; more are added to the same table and list before they are set up
  hook(rx('(§)=\\{rifle:(§),pistol:(§)\\},(§)=\\[\\2,\\3\\];'),
    (m, table, rifle, pistol, list) => `${m}${GUNS}&&${GUNS}.build(d,${table},${list});`, 'the table of guns');
  // ... `d` is the bundle the two builders are given; make sure that is still its name
  if (!rx('§=\\{G:§,S:§,mats:§,mk:§,rng:§,ev:§,arms:§\\},§=§\\(d\\),§=§\\(d\\),').test(html) || !rx('[,;]d=\\{G:§,S:§,mats:').test(html)) throw new Error('gun hooks: the gun builders are no longer given `d`');

  // 4. "swap" and the number keys chose between rifle and pistol by name; they now choose between the gun the player
  //    brought (weapon.primary) and the pistol
  hook(rx('swap\\(\\)\\{return (§)\\(\\((§)\\.active\\?\\2\\.to:(§)\\)===§\\?"pistol":"rifle"\\)\\}'),
    (m, go, sw, cur) => `swap(){return ${go}((${sw}.active?${sw}.to:${cur}).id==="pistol"?this.primary||"rifle":"pistol")}`, 'the swap between guns');
  hook(rx('(§)\\.pressed\\("weapon1"\\)\\?(§)\\("rifle"\\)'),
    (m, input, go) => `${input}.pressed("weapon1")?${go}((window.__G.weapon||{}).primary||"rifle")`, 'the first weapon key');

  // 5. one shot: a gun may fire it its own way (a shotgun's pellets), and may throw its own case out later (on the pump
  //    or the bolt) instead of at the moment of firing
  hook(rx('(§)=(§)\\.combat\\.playerShot\\((§),(§),\\{damage:(§)\\.damage,range:\\5\\.range\\}\\)'),
    (m, out, g, from, dir, def) => `${out}=${def}.shoot?${def}.shoot(${g},${from},${dir},${def}):${g}.combat.playerShot(${from},${dir},{damage:${def}.damage,range:${def}.range})`, 'the shot');
  hook(rx('(§)\\.shell&&\\((§)\\((§)\\.eject,'),
    (m, fx, toWorld, rig) => `${fx}.shell&&!${rig}.def.ownShell&&(${toWorld}(${rig}.eject,`, 'the spent case');

  // 5b. the last round: every gun starts its reload by itself a moment after firing it (the game waited for the next
  //     pull of the trigger). A gun may say how long that moment is (def.reloadAfter)
  const state = html.match(rx('§\\.slot\\.ammo--,(§)\\.burst\\+\\+'));
  if (!state) throw new Error('gun hooks: the weapon state in the shot was not found');
  hook(rx('(§)\\.shot\\(\\1\\.slot\\.ammo<=0\\)\\}'),
    (m, rig) => `${rig}.shot(${rig}.slot.ammo<=0),${rig}.slot.ammo<=0&&${rig}.slot.reserve>0&&(${state[1]}.autoReload=${rig}.def.reloadAfter||.3)}`, 'the last round');

  // 6. how far the view narrows when aiming: one number for every gun; a gun with a scope sets its own (weapon.adsFov)
  hook(rx('!(§)\\.params\\.fov\\)\\{let (§)=(§)\\((§)\\.baseFov\\+\\(\\4\\.sprinting\\?(§)\\.fovSprint:0\\),\\5\\.fovAds,\\4\\.ads\\)'),
    (m, g, v, lerp, p, tune) => `!${g}.params.fov){let ${v}=${lerp}(${p}.baseFov+(${p}.sprinting?${tune}.fovSprint:0),${g}.weapon&&${g}.weapon.adsFov||${tune}.fovAds,${p}.ads)`, 'the aiming field of view');

  // 7. sound: every gun that is not the pistol was "the rifle". A gun with its own row in the table of gun sounds now
  //    gets its own shot; guns without reload rows of their own play their own reload sounds (web/guns.js)
  hook(rx('(§)=(§)=>\\2&&\\2\\.weapon==="pistol"\\?"pistol":"rifle";function'),
    (m, name, a) => `${name}=${a}=>${a}&&${mix[1]}.weapon[${a}.weapon]?${a}.weapon:"rifle";function`, 'which gun a sound is for');
  hook(rx('(§)\\[(§)\\]=\\(\\1\\[\\2\\]\\+1\\+\\('), (m, t, k) => `${t}[${k}]=((${t}[${k}]||0)+1+(`, 'the count of shots per gun');
  hook(rx('=(§)\\[(§)\\]\\[(§)\\];\\3==="start"'), (m, t, a, b) => `=(${t}[${a}]||{})[${b}];${b}==="start"`, 'the reload sounds per gun');

  /* ---------------------------------------------------------------- the multiplayer layer (readable code in the same file) */
  // a literal piece of that code, replaced; it must be there exactly once
  function swap(from, to, what) {
    const n = html.split(from).length - 1;
    if (n !== 1) throw new Error(`gun hooks: expected exactly one "${what}", found ${n}`);
    html = html.replace(from, () => to);
  }

  // 8. what goes over the wire. A shot says which gun fired it, a hit says which gun made it, and a player's state says
  //    which gun they carry. The old values keep their meaning (0 rifle, 1 pistol; kinds 1 knife and 2 frag; w 2 knife)
  swap(`G.weapon.current === 'pistol' ? 1 : 0];`, `${GUNS}.code(G.weapon.current)];`, 'gun in a shot');
  swap(`G.audio.play(sh[4] ? 'pistol_shot' : 'rifle_shot', {`, `G.audio.play(${GUNS}.shotSound(sh[4]), {`, 'sound of a remote shot');
  swap(`sendHit(R, amount, part === 'weak', mp.hitKind || 0);`, `sendHit(R, amount, part === 'weak', mp.hitKind || ${GUNS}.kind(G.weapon.current));`, 'gun in a hit');
  swap(`w: kind === 1 ? 'knife' : kind === 2 ? 'frag' : 'rifle', hs: !!weak && !kind };`, `w: kind === 1 ? 'knife' : kind === 2 ? 'frag' : ${GUNS}.kindName(kind), hs: !!weak && kind !== 1 && kind !== 2 };`, 'gun that last hit the player');
  swap(`w: knife.on ? 2 : 0, ks: knife.seq,`, `w: knife.on ? 2 : ${GUNS}.carry(G.weapon.current), ks: knife.seq,`, 'gun in the player state');
  swap(`R.w = pr.w === 2 ? 2 : 0;`, `R.w = pr.w === 2 || pr.w === 3 || pr.w === 4 ? pr.w : 0;`, 'gun another player carries');
  // 8b. the ammo sets on the map: which ones a player took, and when, travels with their state
  swap(`c: myColor(), bk:`, `am: ${GUNS}.ammoWire(), c: myColor(), bk:`, 'ammo taken, sent');
  swap(`R.alive = !!(st & 1);`, `${GUNS}.ammoSeen(pr.am); R.alive = !!(st & 1);`, 'ammo taken, received');

  // 9. other players are drawn holding the gun they carry, not always the rifle
  swap(`      rifle: worldRifle,\n`, `      rifle: () => ${GUNS}.carried(worldRifle(), T, G),\n`, 'gun on another player');
  swap(`knife: R.w === 2, firing:`, `knife: R.w === 2, gun: R.w, prot: R.prot && R.alive, firing:`, 'pose of another player');
  swap(`st.sprint += ((s.sprint && !s.knife ? 1 : 0) - st.sprint) * k;`, `${GUNS}.posed(gun, mats, s); st.sprint += ((s.sprint && !s.knife ? 1 : 0) - st.sprint) * k;`, 'gun shown on another player');

  // 10. the kill feed knows the new guns
  swap(`const CAUSES = { rifle: 1, knife: 1, frag: 1, barrel: 1, down: 1 };`, `const CAUSES = { rifle: 1, knife: 1, frag: 1, barrel: 1, down: 1, shotgun: 1, sniper: 1 };`, 'causes in the kill feed');
  swap(`const iconEl = k => {`, `Object.assign(ICON, ${GUNS}.icons); const iconEl = k => {`, 'icons in the kill feed');

  // 11. going down and coming back: the card says what dropped the player and from how far, and offers the guns to
  //     come back with; a spawn takes up the chosen one (the game's own reset always ends on the rifle)
  swap(`downEl.classList.add('on');\n`, `downEl.classList.add('on'); try { ${GUNS}.down(downEl, K, cause, hs, G); } catch (e) { console.error('[guns] down card: ' + e); }\n`, 'the card shown when down');
  swap(`if (!first) try { G.weapon.reset(); } catch { /* fine */ }`, `if (!first) try { G.weapon.reset(); } catch { /* fine */ } try { ${GUNS}.spawn(G); } catch (e) { console.error('[guns] spawn: ' + e); }`, 'the respawn');
  swap(`const knifeLabel = knife.on ? 'Rifle' : 'Knife';`, `const knifeLabel = knife.on ? ${GUNS}.short(G.weapon.primary) : 'Knife';`, 'the label beside the knife key');
  swap(`try { G.weapon.equip('rifle'); } catch { /* fine */ } if (play) setKnife(true);`, `try { G.weapon.equip(G.weapon.primary || 'rifle'); } catch { /* fine */ } if (play) setKnife(true);`, 'the retired sidearm');

  // 12. coming back. Four seconds on the card (time to pick a gun with the pointer), then five seconds in which nothing can hurt the player: others see them
  //     with a white glow round their outline, and it ends at once if they shoot or use the knife
  swap(`const RESPAWN_MS = 3500, PROTECT_MS = 2000,`, `const RESPAWN_MS = 4000, PROTECT_MS = 5000,`, 'the respawn and protection times');
  swap(`const r = _shot.call(G.combat, o, d, opts);\n      if (mp.live) {`, `const r = _shot.call(G.combat, o, d, opts);\n      if (mp.live) {\n        if (mp.protectUntil) { mp.protectUntil = 0; P.invulnerable = false; }`, 'a shot ends the protection');
  swap(`    function slash() {\n`, `    function slash() {\n      if (mp.protectUntil) { mp.protectUntil = 0; P.invulnerable = false; mp.dirty = true; }\n`, 'the knife ends the protection');
  // 13. the head that can be hit is the head that is drawn. The game guessed where a player's head was (70 cm to the side
  //     when peeking) while the figure's head only leans about 30 cm, so a shot at the visible head went through
  swap(`        const th = raySphere(o, d, x + lx, y + 1.63 - drop, z + lz, .17, lim);`,
    `        let hx = x + lx, hy = y + 1.63 - drop, hz = z + lz; try { const hb = R.av && R.av.J && R.av.J.head, hv = G.__headAt || (G.__headAt = new T.Vector3()); if (hb) { hb.bone.getWorldPosition(hv); hx = hv.x; hy = hv.y + .09; hz = hv.z; } } catch { /* the estimate above */ }\n        const th = raySphere(o, d, hx, hy, hz, .18, lim);`, 'where a head can be hit');
  swap(`gravity: 20, bounce: .42 };`, `gravity: 20, bounce: .28 };`, 'how much a grenade bounces');      // keeps 28% of its speed into a wall or floor, down from 42%: it stops nearer where it lands (Irfan, 20 Nov 2026)
  swap(`const FRAG = { count: 4, regen: 120000,`, `const FRAG = { count: 4, regen: 30000,`, 'how long a grenade takes to come back');      // 30 seconds each, down from two minutes
  swap(`P.invulnerable = true; if (first) refillFrags();`, `P.invulnerable = true; refillFrags();`, 'grenades on a respawn');      // every life starts with its grenades, not only the first
  swap(`const av = kit.create(); avatars.add(av.group);`, `const av = kit.create(); avatars.add(av.group); try { ${GUNS}.avatar(av); } catch (e) { console.error('[guns] avatar: ' + e); }`, 'a new avatar');

  // 14. a team's score is the sum of the rows under it, always. The game kept the kills of players who left (or reloaded,
  //     which makes a new connection) in the team score but dropped them from the board, so the numbers stopped adding up.
  //     Now each kept score remembers who it was (player id, name, deaths): it is added to that player's row when they are
  //     back (matched by player id, or by name when the id is new: another device; on either side, so one person is
  //     always one row), and otherwise shown as its own row, "(left)". The team scores are then counted from the rows.
  //     Every kept score goes at the end of the round (roundOver empties the bank), so a new round starts with no one.
  swap(`if (mp.mode === 'tdm' && R.tm >= 0 && R.k > 0) bankPut(R.peer, R.tm, R.k);`,
    `if (mp.mode === 'tdm' && R.tm >= 0 && R.k > 0) bankPut(R.peer, R.tm, R.k, R.id, R.name, R.d);`, 'a leaving player is kept');
  swap(`    function bankPut(peer, tm, k) {
      if (peer === net.myPeer || remotes.has(peer)) return;
      const cur = mp.bank[peer];
      if (cur && cur[1] >= k) return;
      mp.bank[peer] = [tm, k];`, `    function bankPut(peer, tm, k, id, name, d) {
      if (peer === net.myPeer || remotes.has(peer)) return;
      const cur = mp.bank[peer];
      if (cur && cur[1] >= k) return;
      mp.bank[peer] = [tm, k, typeof id === 'string' ? id.slice(0, 40) : (cur && cur[2]) || '', typeof name === 'string' && name ? name.slice(0, 16) : (cur && cur[3]) || '', int(d)];`, 'what is kept of a player who left');
  swap(`Object.keys(mp.bank).map(k => [k, mp.bank[k][0], mp.bank[k][1]])`, `Object.keys(mp.bank).map(k => [k, ...mp.bank[k]])`, 'kept players, sent');
  swap(`bankPut(b[0], b[1], int(b[2]));`, `bankPut(b[0], b[1], int(b[2]), b[3], b[4], b[5]);`, 'kept players, received');
  swap(`    function teamTotals() {
      const t = [0, 0];
      if (mp.team === 0 || mp.team === 1) t[mp.team] += stats.tdm.kills;
      for (const R of remotes.values()) if (R.tm === 0 || R.tm === 1) t[R.tm] += R.k;
      for (const k in mp.bank) t[mp.bank[k][0]] += mp.bank[k][1];
      return t;
    }`, `    function teamTotals() {
      const t = [0, 0];
      for (const r of liveRows()) if (r.tm === 0 || r.tm === 1) t[r.tm] += r.k;
      return t;
    }`, 'the team scores');
  swap(`      for (const R of remotes.values()) rows.push({ me: false, peer: R.peer, name: R.name || 'Someone', k: R.k, d: R.d, tm: R.tm, alive: R.alive && !R.away, css: R.own || R.css || '#e8e4da' });
      return rows;`, `      for (const R of remotes.values()) rows.push({ me: false, peer: R.peer, id: R.id, name: R.name || 'Someone', k: R.k, d: R.d, tm: R.tm, alive: R.alive && !R.away, css: R.own || R.css || '#e8e4da' });
      // one row per person: a kept score joins the row of whoever has the same player id or, failing that, the same name
      // (another device, cleared storage), on either side; two departures of one person make one "(left)" row
      if (mp.mode === 'tdm') for (const peer in mp.bank) {
        const [tm, k, id, name, d] = mp.bank[peer];
        if (tm !== 0 && tm !== 1) continue;
        const key = n => String(n || '').replace(/ \\(left\\)$/, '').trim().toLowerCase(), nm = key(name), named = nm && nm !== 'someone';
        const same = rows.find(r => !r.left && id && (r.me ? id === net.myId : r.id === id)) || (named && rows.find(r => !r.left && key(r.name) === nm))
          || rows.find(r => r.left && ((id && r.id === id) || (named && key(r.name) === nm)));
        if (same) { same.k += k; same.d += d || 0; if (!same.left) { same.bk = (same.bk || 0) + k; same.bd = (same.bd || 0) + (d || 0); } }
        else rows.push({ me: false, left: true, peer, id, name: (name || 'Someone') + ' (left)', k, d: d || 0, tm, alive: false, css: '#e8e4da' });
      }
      return rows;`, 'kept players on the board');
  swap(`rows.length + (rows.length === 1 ? ' breacher in' : ' breachers in')`, `rows.filter(r => !r.left).length + (rows.filter(r => !r.left).length === 1 ? ' breacher in' : ' breachers in')`, 'players counted on the board');
  swap(`for (const r of rows) if (!r.me) { const l = mp.last[r.peer]; r.k = l ? l.k : 0; r.d = l ? l.d : 0; }`,
    `for (const r of rows) if (!r.me && !r.left) { const l = mp.last[r.peer]; r.k = (l ? l.k : 0) + (r.bk || 0); r.d = (l ? l.d : 0) + (r.bd || 0); }`, 'the rows at the end of a round');
  swap(`        for (const r of rows) if (r.tm === 0 || r.tm === 1) totals[r.tm] += r.k;
        for (const k in mp.bank) totals[mp.bank[k][0]] += mp.bank[k][1];`, `        for (const r of rows) if (r.tm === 0 || r.tm === 1) totals[r.tm] += r.k;`, 'the team scores at the end of a round');

  // 15. ten seconds between rounds. The wall clock now runs in 5:10 cycles, the same for everyone: five minutes of play,
  //     then a break in which the result stays on screen with a countdown, nobody moves and nobody can be hurt. The next
  //     round starts everyone fresh, as before. (A page from before this change still counts 5:00 rounds until reloaded.)
  swap(`ROUND_MS = 300000;\n  const roundNow = () => Math.floor(Date.now() / ROUND_MS), roundLeft = () => ROUND_MS - Date.now() % ROUND_MS;`,
    `ROUND_MS = 300000, BREAK_MS = 10000, CYCLE_MS = ROUND_MS + BREAK_MS;\n  const roundNow = () => Math.floor(Date.now() / CYCLE_MS), roundLeft = () => Math.max(0, ROUND_MS - Date.now() % CYCLE_MS);\n  const inBreak = () => Date.now() % CYCLE_MS >= ROUND_MS, breakLeft = () => inBreak() ? CYCLE_MS - Date.now() % CYCLE_MS : 0;`, 'the round clock');
  swap(`    function roundOver(next) {
      const rows = liveRows();`, `    function roundOver(next) {
      const shown = mp.breakOf === mp.round; mp.breakOf = -1;
      if (shown) mp.final = null; else roundEnd(8000);
      for (const m of ['dm', 'tdm']) { stats[m].kills = 0; stats[m].deaths = 0; }
      mp.bank = {}; mp.last = {}; mp.round = next;
      for (const R of remotes.values()) if (R.rd !== next) { R.k = 0; R.d = 0; }
      try { G.explosives.reset(); mp.lit.clear(); } catch { /* fine */ }
      refillFrags();
      respawn(false); // a new round is a clean start for everyone: new spawn point, full health, full ammo, down or not
      try { hud.warn(shown ? 'New round' : mp.final.title, shown ? 2 : 4); } catch { /* fine */ }
      try { G.audio.play('objective', { gain: .8 }); } catch { /* fine */ }
      mp.dirty = true; hudText(); lobbyPresence();
    }
    // the result of the round just played, on the board for ms
    function roundEnd(ms) {
      const rows = liveRows();`, 'the round splits into its result and the fresh start');
  swap(`      mp.final = { rows, totals, title, hint: 'New round · everyone starts fresh', until: performance.now() + 8000 };
      for (const m of ['dm', 'tdm']) { stats[m].kills = 0; stats[m].deaths = 0; }
      mp.bank = {}; mp.last = {}; mp.round = next;
      for (const R of remotes.values()) if (R.rd !== next) { R.k = 0; R.d = 0; }
      try { G.explosives.reset(); mp.lit.clear(); } catch { /* fine */ }
      refillFrags();
      respawn(false); // a new round is a clean start for everyone: new spawn point, full health, full ammo, down or not
      try { hud.warn(title, 4); } catch { /* fine */ }
      try { G.audio.play('objective', { gain: .8 }); } catch { /* fine */ }
      mp.dirty = true; hudText(); lobbyPresence();
    }`, `      mp.final = { rows, totals, title, hint: 'New round · everyone starts fresh', until: performance.now() + ms };
      return mp.final;
    }`, 'the result of a round');
  swap(`      if (rnd !== mp.round) roundOver(rnd);\n      else {`, `      if (rnd !== mp.round) roundOver(rnd);
      else if (inBreak()) {
        if (mp.breakOf !== rnd) { mp.breakOf = rnd; try { G.input.setGameplay(false); } catch { /* fine */ } const f = roundEnd(breakLeft() + 200); try { hud.warn(f.title, 4); } catch { /* fine */ } try { G.audio.play('objective', { gain: .8 }); } catch { /* fine */ } mp.dirty = true; }
        P.invulnerable = true; P.enabled = false;
      } else {`, 'the break between rounds');
  swap(`if (now >= mp.respawnAt) respawn(false);`, `if (now >= mp.respawnAt && !inBreak()) respawn(false);`, 'nobody comes back during the break');
  swap(`boardHint.textContent = fin ? fin.hint :`, `boardHint.textContent = fin ? (inBreak() ? 'Next round in ' + Math.max(1, Math.ceil(breakLeft() / 1000)) : fin.hint) :`, 'the countdown on the board');
  swap(`mp.tally = \`\${clock(roundLeft())} · Gate`, `mp.tally = \`\${inBreak() ? 'Next round ' + clock(breakLeft()) : clock(roundLeft())} · Gate`, 'the countdown in team play');
  swap(`mp.tally = \`\${clock(roundLeft())} · \${s.kills}`, `mp.tally = \`\${inBreak() ? 'Next round ' + clock(breakLeft()) : clock(roundLeft())} · \${s.kills}`, 'the countdown in deathmatch');
  swap(`const t = 'Round ends in ' + clock(roundLeft());`, `const t = inBreak() ? 'Next round in ' + clock(breakLeft()) : 'Round ends in ' + clock(roundLeft());`, 'the countdown in the lobby');

  // 16. the teams are Red and Blue (they were Gate and Quay, amber and sea green), and in Team deathmatch a player's helmet
  //     is their team's colour, as their plate and lights already were. Team numbers on the wire are unchanged: 0 is Red, 1 Blue.
  //     The same two colours are in web/net.js (TEAMS), for the menus.
  swap(`const TEAMS = [{ name: 'Gate', css: '#ffb347' }, { name: 'Quay', css: '#5fd3dc' }];`, `const TEAMS = [{ name: 'Red', css: '#ff4b3e' }, { name: 'Blue', css: '#3f8cff' }];`, 'the teams');
  swap(`:root { --gate: #ffb347; --quay: #5fd3dc; }`, `:root { --gate: #ff4b3e; --quay: #3f8cff; }`, 'the team colours in the styles of the game');
  swap(`clock(roundLeft())} · Gate \${t[0]} · Quay \${t[1]}\``, `clock(roundLeft())} · Red \${t[0]} · Blue \${t[1]}\``, 'the team scores in the tally');
  swap(`<p class="mp-desc">Gate holds the west yard, Quay holds the waterfront. Friendly fire is off.</p>`, `<p class="mp-desc">Red against Blue. Friendly fire is off.</p>`, 'the teams in the old lobby of the game');
  swap(`<b>Gate</b><span data-mp-f="t0-score">`, `<b>Red</b><span data-mp-f="t0-score">`, 'the name of the first team in the old lobby');
  swap(`<b>Quay</b><span data-mp-f="t1-score">`, `<b>Blue</b><span data-mp-f="t1-score">`, 'the name of the second team in the old lobby');
  swap(`data-mp="join-t0" disabled>Join Gate</button>`, `data-mp="join-t0" disabled>Join Red</button>`, 'joining the first team in the old lobby');
  swap(`data-mp="join-t1" disabled>Join Quay</button>`, `data-mp="join-t1" disabled>Join Blue</button>`, 'joining the second team in the old lobby');
  swap(`R.av.setHelmet(own); // the helmet itself is repainted in the player's colour`, `R.av.setHelmet(css); // the helmet itself is repainted: the team's colour in Team deathmatch, the player's own otherwise`, 'the helmet in the team colour');

  // 17. vaulting (web/vault.js). Where the game would jump, a player moving forward into something low climbs over it or
  //     through the window above it instead; while the vault lasts it moves the player in place of the game's own
  //     movement (the view, the eye height and the weapon still update as usual).
  swap('<script src="/guns.js"></script>\n', '<script src="/guns.js"></script>\n<script src="/vault.js"></script>\n', 'the vault script');
  swap('a>0&&r>0&&(!A.crouching||F())&&(A.vel.y=Pz,', 'a>0&&r>0&&window.__SALTLINE_VAULT&&__SALTLINE_VAULT.start(A,n,G)&&(a=0,r=0),a>0&&r>0&&(!A.crouching||F())&&(A.vel.y=Pz,', 'a vault in place of a jump');
  swap('o=A.crouching?Nt.crouchHeight:Nt.standHeight;let le=oe?G.move.x:0', 'o=A.crouching?Nt.crouchHeight:Nt.standHeight;if(window.__SALTLINE_VAULT&&__SALTLINE_VAULT.step(A,n,J)){Q(J),W(J);return}let le=oe?G.move.x:0', 'the vault moving the player');
  //     The body: the soldier's pose takes a hand on the ledge (handL / handR, each with a weight), knees tucked up (tuck)
  //     and a lean over the top (hunch). Your own view borrows the knife's first-person arms for the hands, once the
  //     camera has its final place for the frame; other players see the vault from `vt` in the presence.
  swap(`const cT0 = 1.15 * c, cK0 = 2.2 * c, cT = cT0 + .5 * st.air, cK = cK0 + 1.0 * st.air;`,
    `const cT0 = 1.15 * c, cK0 = 2.2 * c, cT = cT0 + .5 * st.air + (s.tuck || 0) * .9, cK = cK0 + 1.0 * st.air + (s.tuck || 0) * 1.3;`, 'knees tucked in a vault');
  swap(`hipBone.position.z -= (drop - bob + .01 * c) / scale;`, `hipBone.position.z -= (drop - bob + .01 * c + (s.sink || 0)) / scale;`, 'the hips low over a vault');
  swap(`const hunch = -.1 * run - .16 * c - .05, p3`, `const hunch = -.1 * run - .16 * c - .05 - (s.hunch || 0), p3`, 'leaning over a vault');
  swap(`reach(armR, hr, s.pole || poleR, tw, bend); reach(armL, hl, poleL, 0, null);`,
    `if (s.handL) { hl.lerp(s.handL, s.handLw); grip('l', curlL, mix(1, .2, s.handLw)); } if (s.handR) { hr.lerp(s.handR, s.handRw); grip('r', curlR, mix(1.25, s.gripR == null ? .2 : s.gripR, s.handRw)); if (s.twistR != null) tw = s.twistR; if (s.bendR) bend = s.bendR; }
          reach(armR, hr, s.pole || poleR, tw, bend); reach(armL, hl, s.poleL || poleL, 0, s.bendL || null);`, 'hands on a ledge');
  swap(`const FPO = new V3(.05, -1.6, -.1), _h = new V3(); // where the soldier stands relative to your eye: only his right arm reaches into view`,
    `const FPO = new V3(.05, -1.6, -.1), _h = new V3(); // where the soldier stands relative to your eye: only his right arm reaches into view
    window.__SALTLINE_FPBODY = () => ({ body: buildKnife(), at: FPO }); // the vault's hands from your own eyes`, 'first-person arms for the vault');
  swap(`      stepKnife(dt, play);\n`, `      stepKnife(dt, play);\n      try { if (window.__SALTLINE_VAULT) window.__SALTLINE_VAULT.view(G, dt); } catch (e) { console.error('[vault] view: ' + e); }\n`, 'the vault seen from your own eyes');
  swap(`slash: R.slashT > 0 ? Math.sin(Math.PI * (1 - R.slashT / .3)) : 0, dt });`,
    `slash: R.slashT > 0 ? Math.sin(Math.PI * (1 - R.slashT / .3)) : 0, dt, ...(R.alive && window.__SALTLINE_VAULT ? window.__SALTLINE_VAULT.remote(R, dt) : null) });`, 'another player vaulting');
  swap(`am: window.__SALTLINE_GUNS.ammoWire(), c: myColor(),`, `am: window.__SALTLINE_GUNS.ammoWire(), vt: window.__SALTLINE_VAULT ? window.__SALTLINE_VAULT.wire() : null, c: myColor(),`, 'a vault in the presence');

  // 18. peeking (Q / E). The leaning player's eye used to go 85 cm to the side while other players saw only the upper
  //     body tilt, about 30 cm: the peek saw out while the soldier drawn for it, and its hitboxes, stayed behind the
  //     corner. Now the eye goes at most 50 cm (less where a wall stops it), as a lean round a corner does, the real
  //     offset goes out in the presence (lo, metres to the right), and the soldier leans further from the hips so his
  //     head is where that eye is; his feet move at most 25 cm to make up the rest, so a peek shows a head and a
  //     shoulder, not a body. The head hitbox follows the drawn head; the body's follows the feet.
  swap(`const lean = { v: 0 };`, `const lean = { v: 0, off: 0 };`, 'the lean keeps its offset');
  swap(`let off = Math.abs(lean.v) * .85;`, `let off = Math.abs(lean.v) * .5;`, 'a lean goes 50 cm');
  swap(`P.eye.y -= .09 * Math.abs(lean.v);`, `P.eye.y -= .2 * Math.abs(lean.v);`, 'the eye dips as far as the drawn head does');
  swap(`l3 = -s.lean * .16;`, `l3 = -s.lean * (s.leanK || .16);`, 'how far a lean tilts the spine');
  swap(`dt, ...(R.alive && window.__SALTLINE_VAULT ?`, `dt, leanK: .4, ...(window.__SALTLINE_VAULT && window.__SALTLINE_VAULT.body ? window.__SALTLINE_VAULT.body(R, dt) : null), ...(R.alive && window.__SALTLINE_VAULT ?`, 'other players lean further from the hips');
  swap(`if (Math.abs(lean.v) < .004) { lean.v = 0; return; }`, `if (Math.abs(lean.v) < .004) { lean.v = 0; lean.off = 0; return; }`, 'no offset when upright');
  swap(`P.eye.x += rx * off; P.eye.z += rz * off;`, `lean.off = sgn * off; P.eye.x += rx * off; P.eye.z += rz * off;`, 'the offset the eye really moved');
  swap(`ln: r2(lean.v),`, `ln: r2(lean.v), lo: r2(lean.off),`, 'the lean offset in the presence');
  swap(`R.tlean = Number.isFinite(+pr.ln) ? clamp(+pr.ln, -1, 1) : 0;`, `R.tlean = Number.isFinite(+pr.ln) ? clamp(+pr.ln, -1, 1) : 0; R.lo = Number.isFinite(+pr.lo) ? clamp(+pr.lo, -1, 1) : R.tlean * .5;`, 'reading the lean offset');
  swap(`window.__SALTLINE_VAULT.remote(R, dt) : null) });`, `window.__SALTLINE_VAULT.remote(R, dt) : null) });
        { // a peek: the head as far out as the player's eye, the body stepping what the tilt does not cover
          R.loS = (R.loS || 0) + ((R.alive ? R.lo || 0 : 0) - (R.loS || 0)) * Math.min(1, dt * 11);
          let shift = 0; const rx = Math.cos(R.yaw), rz = -Math.sin(R.yaw), hb = av.J && av.J.head;
          if (hb && Math.abs(R.loS) > .01) {
            const hv = G.__peekAt || (G.__peekAt = new T.Vector3()); av.group.updateMatrixWorld(true); hb.bone.getWorldPosition(hv);
            shift = Math.max(-.25, Math.min(.25, R.loS - ((hv.x - av.group.position.x) * rx + (hv.z - av.group.position.z) * rz)));
            av.group.position.x += rx * shift; av.group.position.z += rz * shift;
          }
          R.lsx = rx * shift; R.lsz = rz * shift;
        }
        { // under a roof or a ceiling a soldier is lit a little from within, or a dark uniform in an unlit room is a black shape nobody can see
          R.inT = (R.inT || 0) - dt;
          if (R.inT <= 0) { R.inT = .3; const o = G.__roofO || (G.__roofO = new T.Vector3()), up = G.__roofU || (G.__roofU = new T.Vector3(0, 1, 0)); let roof = null; try { roof = G.physics.raycast(o.set(R.pos.x, R.pos.y + 1.7, R.pos.z), up, 8); } catch { roof = null; } R.indoor = !!roof; }
          const want = R.indoor ? .85 : .2; R.glow = R.glow == null ? want : R.glow + (want - R.glow) * Math.min(1, dt * 4);
          if (av.mats) for (const mm of av.mats) mm.m.emissiveIntensity = R.glow;
        }`, 'the soldier where the peek is');
  swap(`const drop = R.crouchT * .45, x = R.pos.x, y = R.pos.y, z = R.pos.z;`, `const drop = R.crouchT * .45, x = R.pos.x + (R.lsx || 0), y = R.pos.y, z = R.pos.z + (R.lsz || 0);`, 'the body hitbox where the soldier is drawn');

  // 19. falls. The game hurt a landing faster than 13 m/s, a drop of about 3.3 m, so jumping or vaulting out of an
  //     upstairs window (the sill is 3.9 m up) cost health. Now a landing hurts only over 16 m/s (about 5 m down, more
  //     than anything a player can stand on), and less for each m/s past it.
  swap('Y>13&&A.damage((Y-13)*7,null)', 'Y>16&&A.damage((Y-16)*5,null)', 'fall damage only past a 5 m drop');

  // 20. the wheel swaps weapons while sprinting too. Holding Shift turns a mouse wheel's turn into a sideways scroll (the
  //     browser reports it as deltaX, deltaY 0), and the game looked at deltaY only, so the knife could not be drawn on
  //     the run. With Shift down either direction counts; without it a sideways swipe still does nothing.
  hook(rx('Math\\.abs\\((§)\\.deltaY\\)<1\\|\\|\\((§)=(§),(§)\\.add\\("swap"\\)\\)'),
    (m, ev) => m.replace(`Math.abs(${ev}.deltaY)<1`, `(${ev}.shiftKey?Math.max(Math.abs(${ev}.deltaY),Math.abs(${ev}.deltaX)):Math.abs(${ev}.deltaY))<1`), 'the wheel that swaps weapons');

  // 21. peeking can be held or toggled (Settings > Peek, in web/net.js, beside Crouch). The game asked the two keys
  //     directly; it now asks window.__SALTLINE_PEEK for the lean (-1 left, 0, 1 right) when that is there
  swap(`want = (G.input.down('interact') ? 1 : 0) - (G.input.down('leanL') ? 1 : 0);`,
    `want = window.__SALTLINE_PEEK ? window.__SALTLINE_PEEK(G) : (G.input.down('interact') ? 1 : 0) - (G.input.down('leanL') ? 1 : 0);`, 'the keys that lean');

  // 22. a grenade's floor is found by a ray straight down, like everything else it meets. It was the walk code's
  //     groundHeight, which counts boxes for players only: on Alpine the caps that carry wall tops up to 12 m, so a frag
  //     thrown high near a wall settled on top of one, above the roofs. Rays never see player-only boxes.
  //     The ray starts up to 60 cm above the grenade (so it steps up onto a kerb), but never above a ceiling: it looks up
  //     first and starts just under whatever is there. Started above a ceiling it found the next floor's top, and a
  //     grenade thrown in at a first-floor window, rising near the ceiling, was put on the floor above.
  swap(`let floor = -1e9; try { floor = G.physics.groundHeight(g.pos.x, g.pos.z, g.pos.y + .6); } catch { floor = -1e9; }`,
    `let floor = -1e9; try { const ce = G.physics.raycast(_p.set(g.pos.x, g.pos.y, g.pos.z), _b.set(0, 1, 0), .6), lift = ce ? Math.max(0, ce.dist - .02) : .6; const dn = G.physics.raycast(_p.set(g.pos.x, g.pos.y + lift, g.pos.z), _b.set(0, -1, 0), lift + 1.5); floor = dn ? dn.point.y : -1e9; } catch { floor = -1e9; }`, 'the floor under a grenade');

  // 23. a cooked grenade can be put back: pressing aim (right mouse, the touch Aim button, a pad's left trigger) while
  //     cooking cancels the throw and the grenade is yours again. Aim held when the cook began counts only once let go.
  //     Then, while a grenade is cooked, the path it would take is drawn (web/fragpath.js, loaded by web/net.js): the
  //     same throw releaseFrag makes, flown through the same steps as the grenades above
  swap(`    function stepFrags(dt) {\n      if (frag.cd > 0) frag.cd -= dt;`,
    `    function stepFrags(dt) {
      if (frag.cook) { const aim = !!G.input.ads; if (frag.cook.aimWas === undefined) frag.cook.aimWas = aim; else if (aim && !frag.cook.aimWas) { frag.cook = null; frag.left = Math.min(FRAG.count, frag.left + 1); if (frag.left >= FRAG.count) frag.next = 0; frag.rearm = .25; cookEl.classList.remove('on'); fragHud(); try { G.audio.play('pistol_slide', { gain: .6, pitch: 1.2 }); } catch { /* fine */ } } else frag.cook.aimWas = aim; }
      try { if (window.__SALTLINE_FRAGPATH) window.__SALTLINE_FRAGPATH.step(G, P, FRAG, frag.cook && game.state === 'playing' && P.alive && (!mp.live || mp.alive) ? frag.cook : null); } catch (e) { console.error('[fragpath] ' + e); }\n      if (frag.cd > 0) frag.cd -= dt;`, 'the path of a cooked grenade, and putting it back');
  swap(`cookEl.append(el('b', '', 'Let go to throw'), cookBar);`, `cookEl.append(el('b', '', 'Let go to throw · aim to cancel'), cookBar);`, 'the cook hint says how to cancel');

  // 24. grenades fly in fixed steps of 1/120 s, whatever the frame rate. They moved by each frame's own time, so the same
  //     throw landed in a different place at 30 and at 144 frames a second, and no drawn path could be right. Now the
  //     path web/fragpath.js draws (the same steps) is the path flown, and every player's game flies a grenade alike.
  swap(`      for (let i = frag.live.length - 1; i >= 0; i--) {\n        const g = frag.live[i], v = g.vel;\n        v.y -= FRAG.gravity * dt;`,
    `      frag.acc = Math.min(.25, (frag.acc || 0) + dt);\n      for (; frag.acc >= 1 / 120; frag.acc -= 1 / 120) { const dt = 1 / 120;\n      for (let i = frag.live.length - 1; i >= 0; i--) {\n        const g = frag.live[i], v = g.vel;\n        v.y -= FRAG.gravity * dt;`, 'grenades in fixed steps');
  swap(`        g.t -= dt;\n        if (g.t <= 0) burst(g);\n      }\n    }\n    function refillFrags()`,
    `        g.t -= dt;\n        if (g.t <= 0) burst(g);\n      }\n      }\n    }\n    function refillFrags()`, 'grenades in fixed steps, the end');

  return html;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) { console.error('usage: node scripts/gun-hooks.mjs in.html out.html'); process.exit(1); }
  writeFileSync(out, applyGunHooks(readFileSync(src, 'utf8')));
  console.log('gun hooks applied -> ' + out);
}
