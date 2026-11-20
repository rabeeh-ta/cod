// Imports a fresh export of the game from claude.ai into web/index.html, the file Cloudflare serves.
//   node scripts/import.mjs [COD.html]
// The raw export stays out of git (see .gitignore); only the cleaned web/index.html is committed.
// The game code is left as it is; only these targeted edits are made, and each one fails loudly if its anchor moved:
//   1. drop the embedded "version 8" build (1.9 MB of base64 that loads only from a menu button)
//   2. empty the author's note (the menu code needs the element; with no v8 build the game keeps it hidden)
//   3. swap the lobby's team-server label for the room, and reword the offline note (it pointed at claude.ai)
//   4. load /net.js (the Cloudflare adapter) right before the multiplayer layer
//   5. louder enemy footsteps: more gain point blank, a gentler fade with distance (hearing ranges unchanged), teammates much quieter (5%)
//   6. a new round restarts every player: new spawn point, full health and ammo (it used to reset only the kill counts)
//   7. the HUD's knife label no longer hides the key-name helper: the clash threw on every frame with keyboard and mouse,
//      so the grenade markers and the minimap after it never drew
//   8. the hooks that let a second map take over (scripts/map-hooks.mjs)
//   9. the hooks that let more guns in (scripts/gun-hooks.mjs)
//  10. no typed radio (the T key and everything it drew, sent and read aloud); voice chat stays
//  11. window.__SALTLINE_COLOR: the player's colour, settable from web/net.js
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMapHooks } from './map-hooks.mjs';
import { applyGunHooks } from './gun-hooks.mjs';
import { applyPerfHooks } from './perf-hooks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(process.cwd(), process.argv[2] || 'COD.html');
let html = readFileSync(src, 'utf8');
const before = html.length;

function once(find, replace, what) {
  const hits = typeof find === 'string' ? html.split(find).length - 1 : (html.match(new RegExp(find.source, find.flags.replace('g', '') + 'g')) || []).length;
  if (hits !== 1) throw new Error(`import: expected exactly one match for ${what}, found ${hits}`);
  html = html.replace(find, () => replace);
}

once(/<script type="application\/octet-stream" id="legacy-v8">[\s\S]*?<\/script>\n?/, '', 'the legacy-v8 blob');
once(/<aside class="m-callout"[\s\S]*?<\/aside>/,
  '<aside class="m-callout" hidden><button class="m-callout-tab" data-act="note" hidden></button><div class="m-callout-body"><button class="m-callout-x" data-act="note" hidden></button></div></aside>',
  "the author's note");
once(/\/\* Felix's note[^*]*\*\//, "/* author's note (kept empty): floats top right; dismissing folds it to a tab */", "the note's CSS comment");
once(/<span>[^<]*team server<\/span>/, '<span data-net-room>Online room</span>', 'the lobby eyebrow');
once(/nohost: '[^']*'/, "nohost: 'You are not in a room. Pick Multiplayer to join a match or a room. Solo works either way.'", 'the offline note');
once('<script>\n/* Saltline multiplayer layer.', '<script src="/net.js"></script>\n<script>\n/* Saltline multiplayer layer.', 'the multiplayer layer');

once("const STEP = { run: 26, walk: 18, crouch: 6, gRun: 2.5, gWalk: 2, gCrouch: .8 };", "const STEP = { run: 26, walk: 18, crouch: 6, gRun: 4.5, gWalk: 3.6, gCrouch: 1.3 };", 'the footstep levels');
once("* Math.pow(near, 1.5) * (mate ? .4 : 1);", "* Math.pow(near, 1.1) * (mate ? .05 : 1);", 'the footstep distance fade');      // a teammate's steps at a twentieth of an enemy's, so the steps you hear are the ones that matter
once("hint: 'Kills reset · new round is live'", "hint: 'New round · everyone starts fresh'", 'the round-over hint');
once("      refillFrags();\n      try { hud.warn(title, 4); } catch { /* fine */ }", "      refillFrags();\n      respawn(false); // a new round is a clean start for everyone: new spawn point, full health, full ammo, down or not\n      try { hud.warn(title, 4); } catch { /* fine */ }", 'the round-over restart');
once("const kn = knife.on ? 'Rifle' : 'Knife'; if (knifeName.textContent !== kn) knifeName.textContent = kn;",
  "const knifeLabel = knife.on ? 'Rifle' : 'Knife'; if (knifeName.textContent !== knifeLabel) knifeName.textContent = knifeLabel;", 'the knife label in the HUD');
// 10. no typed radio: the T key, its message line and its hint, its key in Settings > Controls, the lines it sent and
//     showed, and the lobby's "Radio voice" switch (it read typed lines aloud). Voice chat (V) stays.
once(/\/\* typed radio: T opens a line at the bottom of the view \*\/\n[\s\S]*?(?=\/\* controls: the key list)/, '', 'the typed radio styles');
once('\n        <button class="btn small" data-mp="hear" hidden>Radio voice: on</button>', '', 'the radio voice switch');
once(" { id: 'type', label: 'Radio: type', def: 'KeyT' },", '', 'the typed radio key');
once("d2.textContent = 'Radio'; dd.innerHTML = '<kbd>T</kbd> type, <kbd>V</kbd> mic on / off';", "d2.textContent = 'Voice chat'; dd.innerHTML = '<kbd>V</kbd> mic on / off';", 'the radio row in Controls');
once(/if \(!d\) \{ tell\('[^']*\. Type your radio message instead', 4\.5\); openChat\(\); return; \}/,
  "if (!d) { tell('Voice chat is not available in this browser', 4.5); return; }", 'the mic fallback to typing');
once(/    const chatEl = el\('div', 'mp-chat'\);[\s\S]*?ev\.code === kb\.type [^\n]*\n/,
  "    keyWatch.push(() => { micKey.textContent = kn('mic'); try { micHud(); } catch { /* not built yet */ } });\n    function closeChat() { /* typed radio is gone; leaving a match still calls this */ }\n", 'the typed radio line and its key');
once('\n      if (Array.isArray(pr.v)) for (const v of pr.v) if (Array.isArray(v) && +v[0] > (R.vSeq || 0)) { R.vSeq = +v[0]; heard(R, v[1]); }', '', 'typed radio lines heard');
once(' v: radio.sent.slice(),', '', 'typed radio lines sent');
// 11. a player's colour can be set from outside the game (web/net.js: the colour rows of Deathmatch), the way the game's
//     own lobby swatches set it: kept in this browser and sent with the next presence
once("const myColor = () => my.color || PALETTE[hash(net.myId || net.myPeer || 'me') % PALETTE.length];",
  "const myColor = () => my.color || PALETTE[hash(net.myId || net.myPeer || 'me') % PALETTE.length];\n    window.__SALTLINE_COLOR = { palette: PALETTE, names: SHADES, get: () => myColor(), set(c) { if (!isHex(c)) return false; my.color = c.toLowerCase(); try { localStorage.setItem('saltline.mp.color', my.color); } catch { /* this visit only */ } lobbySig = ''; try { lobbyPresence(); renderLobby(); } catch { /* not built yet */ } mp.dirty = true; return true; } };", 'the colour, settable from outside');
html = applyMapHooks(html);
html = applyGunHooks(html);
html = applyPerfHooks(html);

const leftover = html.match(/blend-ed|felix|claude\.ai\/artifact/gi);
if (leftover) throw new Error(`import: personal references left in the game: ${[...new Set(leftover)].join(', ')}`);

writeFileSync(resolve(root, 'web/index.html'), html);
console.log(`web/index.html  ${(before / 1e6).toFixed(2)} MB -> ${(html.length / 1e6).toFixed(2)} MB`);
