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
  swap(`const FRAG = { count: 4, regen: 120000,`, `const FRAG = { count: 4, regen: 30000,`, 'how long a grenade takes to come back');      // 30 seconds each, down from two minutes
  swap(`P.invulnerable = true; if (first) refillFrags();`, `P.invulnerable = true; refillFrags();`, 'grenades on a respawn');      // every life starts with its grenades, not only the first
  swap(`const av = kit.create(); avatars.add(av.group);`, `const av = kit.create(); avatars.add(av.group); try { ${GUNS}.avatar(av); } catch (e) { console.error('[guns] avatar: ' + e); }`, 'a new avatar');

  // 14. a team's score is the sum of the rows under it, always. The game kept the kills of players who left (or reloaded,
  //     which makes a new connection) in the team score but dropped them from the board, so the numbers stopped adding up.
  //     Now each kept score remembers who it was (player id, name, deaths): it is added to that player's row when they are
  //     back on the same team, and otherwise shown as its own row, "(left)". The team scores are then counted from the rows.
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
      if (mp.mode === 'tdm') for (const peer in mp.bank) {
        const [tm, k, id, name, d] = mp.bank[peer];
        if (tm !== 0 && tm !== 1) continue;
        const same = id && rows.find(r => r.tm === tm && (r.me ? id === net.myId : r.id === id));
        if (same) { same.k += k; same.d += d || 0; same.bk = (same.bk || 0) + k; same.bd = (same.bd || 0) + (d || 0); }
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

  return html;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) { console.error('usage: node scripts/gun-hooks.mjs in.html out.html'); process.exit(1); }
  writeFileSync(out, applyGunHooks(readFileSync(src, 'utf8')));
  console.log('gun hooks applied -> ' + out);
}
