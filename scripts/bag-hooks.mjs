// Bag hooks: the edits to the generated game (web/index.html) for the bag and the guns on the ground (web/bag.js).
// In a match a player carries two things (a gun and the knife to start with), drops every gun when they go down, and
// can pick up a gun from the ground in exchange for what is in their hands; B opens the bag, G picks up. These hooks
// are the only edits to the game for it. Like the other hooks, each finds its place by exact text (or a pattern that
// captures the minified names around it) and fails loudly unless it matches exactly once. They run last, after the
// score hooks, so their anchors are the game as every other hook leaves it.
//
//   import { applyBagHooks } from './bag-hooks.mjs'     (scripts/import.mjs runs it on every import)
//   node scripts/bag-hooks.mjs in.html out.html        (apply to a game file that has the other hooks but not these)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BAG = 'window.__SALTLINE_BAG';
const W = '[\\w$]+';

export function applyBagHooks(html) {
  function swap(find, to, what) {
    const n = html.split(find).length - 1;
    if (n !== 1) throw new Error(`bag hooks: expected exactly one match for ${what}, found ${n}`);
    html = html.replace(find, () => to);
  }
  function hook(re, to, what) {
    const all = html.match(new RegExp(re.source, 'g')) || [];
    if (all.length !== 1) throw new Error(`bag hooks: expected exactly one match for ${what}, found ${all.length}`);
    html = html.replace(re, (...m) => to(...m));
  }
  const rx = src => new RegExp(src.replace(/§/g, W));

  /* ---------------------------------------------------------------- the game's core (minified) */

  // 1. the number keys: in a match, 1 and 2 take the bag's first and second thing (the game chose the rifle or the pistol)
  hook(rx('(§)\\.pressed\\("weapon1"\\)\\?(§)\\(\\(window\\.__G\\.weapon\\|\\|\\{\\}\\)\\.primary\\|\\|"rifle"\\):\\1\\.pressed\\("weapon2"\\)&&\\2\\("pistol"\\)'),
    (m, input) => `(${BAG}&&${BAG}.on()?(${input}.pressed("weapon1")?${BAG}.key(0):${input}.pressed("weapon2")&&${BAG}.key(1)):(${m}))`, 'the number keys');

  // 2. a gun put away and drawn again: two guns of one kind are one gun to the game (one magazine per kind), so taking
  //    the other rifle is the game's own holster and draw of the rifle, with the other rifle's rounds put in as it comes up
  const start = html.match(rx('function (§)\\(§,§,§\\)\\{§\\(\\),§\\.autoReload=-1,'));
  if (!start) throw new Error('bag hooks: the start of a weapon switch was not found');
  hook(rx('swap\\(\\)\\{return (§)\\(\\((§)\\.active\\?\\2\\.to:(§)\\)\\.id==="pistol"\\?this\\.primary\\|\\|"rifle":"pistol"\\)\\},'),
    (m, go, sw, cur) => `${m}redraw(){return ${sw}.active?!1:(${start[1]}(${cur},${cur},0),!0)},`, 'the swap between guns');

  /* ---------------------------------------------------------------- the multiplayer layer (readable code in the same file) */

  // 3. the keys: Pick up (G) and Bag (B) join Settings > Controls, and X is "Switch weapon" (it swaps the bag's two
  //    things). web/bag.js reads them through window.__SALTLINE_KB
  swap(`{ id: 'swap', label: 'Knife / rifle', def: 'KeyX', game: 'swap' }, { id: 'frag', label: 'Frag', def: 'KeyF' },`,
    `{ id: 'swap', label: 'Switch weapon', def: 'KeyX', game: 'swap' }, { id: 'frag', label: 'Frag', def: 'KeyF' },\n      { id: 'pickup', label: 'Pick up', def: 'KeyG' }, { id: 'bag', label: 'Bag', def: 'KeyB' },`, 'the list of keys');
  swap(`keyWatch.push(() => { knifeKey.textContent = kn('swap'); });`,
    `keyWatch.push(() => { knifeKey.textContent = kn('swap'); });\n    window.__SALTLINE_KB = { code: id => kb[id] || '', name: id => (kb[id] ? kn(id) : '') };`, 'the keys, for the bag');

  // 4. the knife and the swap: in a match the bag decides what is in the hands. X (the wheel, the touch Swap button)
  //    swaps its two things; the knife is one of them, shown and put away by the bag through window.__SALTLINE_KNIFE
  swap(`    const _swap = G.weapon.swap;\n    G.weapon.swap = function () { if (game.state === 'playing' && !frag.cook) setKnife(!knife.on); return false; };`,
    `    const _swap = G.weapon.swap;
    const bagOn = () => !!(mp.live && ${BAG} && ${BAG}.on());
    window.__SALTLINE_KNIFE = { set: setKnife, get on() { return knife.on; }, get busy() { return !!frag.cook || frag.rearm > 0; } };
    G.weapon.swap = function () { if (game.state === 'playing' && !frag.cook) { if (bagOn()) ${BAG}.swap(); else setKnife(!knife.on); } return false; };`, 'the swap to the knife');
  swap(`if (play && knife.on && G.input.pressed && G.input.pressed('weapon1')) setKnife(false);`,
    `if (play && knife.on && !bagOn() && G.input.pressed && G.input.pressed('weapon1')) setKnife(false);`, 'the first number key and the knife');
  swap(`const knifeLabel = knife.on ? window.__SALTLINE_GUNS.short(G.weapon.primary) : 'Knife';`,
    `const knifeLabel = bagOn() ? ${BAG}.otherName() : knife.on ? window.__SALTLINE_GUNS.short(G.weapon.primary) : 'Knife';`, 'the label beside the swap key');

  // 5. no slash and no throw while the bag is open or a swap is on its way (the gun itself has the weapon's noFire)
  swap(`      if (G.input.fire && knife.cd <= 0 && knife.t <= 0) {`,
    `      if (G.input.fire && knife.cd <= 0 && knife.t <= 0 && !(${BAG} && ${BAG}.holdFire())) {`, 'the knife slash');
  swap(`function canThrow() { return game.state === 'playing' && P.alive && P.enabled && (!mp.live || mp.alive) && frag.left > 0 && frag.cd <= 0 && !frag.cook; }`,
    `function canThrow() { return game.state === 'playing' && P.alive && P.enabled && (!mp.live || mp.alive) && frag.left > 0 && frag.cd <= 0 && !frag.cook && !(${BAG} && ${BAG}.holdFire()); }`, 'a grenade throw');

  // 6. going down drops every gun the player had; a life starts with the gun chosen and the knife (or, on joining, what
  //    this tab had a moment ago in this room and round); leaving the match clears the ground
  swap(`      mp.alive = false; s.deaths++;\n`, `      mp.alive = false; s.deaths++;\n      if (${BAG}) ${BAG}.died();\n`, 'going down');
  swap(`try { window.__SALTLINE_GUNS.spawn(G); } catch (e) { console.error('[guns] spawn: ' + e); }`,
    `try { window.__SALTLINE_GUNS.spawn(G); } catch (e) { console.error('[guns] spawn: ' + e); } try { if (${BAG}) ${BAG}.spawn(G, first); } catch (e) { console.error('[bag] spawn: ' + e); }`, 'a life starting');
  swap(`      if (mp.live) {\n        mp.live = false; mp.joining = false;\n`,
    `      if (mp.live) {\n        mp.live = false; mp.joining = false;\n        try { if (${BAG}) ${BAG}.left(); } catch (e) { console.error('[bag] left: ' + e); }\n`, 'leaving the match');

  // 7. what the bag needs from the match: models for the ground (the knife; the rifle as other players carry it), the
  //    kill feed's silhouettes, and the round, whether this player is up, and who they are
  swap(`      marks: () => [0, 1].map(() => new T.Mesh(markGeo, glow(0xe8e4da, 3))),\n    });`,
    `      marks: () => [0, 1].map(() => new T.Mesh(markGeo, glow(0xe8e4da, 3))),\n    });\n    window.__SALTLINE_KIT = { knife: () => kit.knifeMesh(), rifle: () => worldRifle() };`, 'the models for the ground');
  swap(`Object.assign(ICON, window.__SALTLINE_GUNS.icons); const iconEl = k => {`,
    `Object.assign(ICON, window.__SALTLINE_GUNS.icons); window.__SALTLINE_ICONS = ICON; const iconEl = k => {`, 'the silhouettes');
  swap(`window.__SALTLINE_MATCH = { get live() { return !!mp.live; }, get mode() { return mp.mode; }, get team() { return mp.team; }, players: () => remotes.values() };`,
    `window.__SALTLINE_MATCH = { get live() { return !!mp.live; }, get mode() { return mp.mode; }, get team() { return mp.team; }, players: () => remotes.values(), get round() { return mp.round; }, get alive() { return !!mp.alive; }, get peer() { return net.myPeer; } };`, 'the match, for the bag');

  return html;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) { console.error('usage: node scripts/bag-hooks.mjs in.html out.html'); process.exit(1); }
  writeFileSync(out, applyBagHooks(readFileSync(src, 'utf8')));
  console.log('bag hooks applied -> ' + out);
}
