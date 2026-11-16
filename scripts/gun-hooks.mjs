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

  return html;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) { console.error('usage: node scripts/gun-hooks.mjs in.html out.html'); process.exit(1); }
  writeFileSync(out, applyGunHooks(readFileSync(src, 'utf8')));
  console.log('gun hooks applied -> ' + out);
}
