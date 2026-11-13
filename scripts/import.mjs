// Imports a fresh export of the game from claude.ai into web/index.html, the file Cloudflare serves.
//   node scripts/import.mjs [COD.html]
// The raw export stays out of git (see .gitignore); only the cleaned web/index.html is committed.
// The game code is left as it is; only these targeted edits are made, and each one fails loudly if its anchor moved:
//   1. drop the embedded "version 8" build (1.9 MB of base64 that loads only from a menu button)
//   2. empty the author's note (the menu code needs the element; with no v8 build the game keeps it hidden)
//   3. swap the lobby's team-server label for the room, and reword the offline note (it pointed at claude.ai)
//   4. load /net.js (the Cloudflare adapter) right before the multiplayer layer
//   5. louder enemy footsteps: more gain point blank, a gentler fade with distance (hearing ranges unchanged), quieter teammates
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
once("* Math.pow(near, 1.5) * (mate ? .4 : 1);", "* Math.pow(near, 1.1) * (mate ? .25 : 1);", 'the footstep distance fade');

const leftover = html.match(/blend-ed|felix|claude\.ai\/artifact/gi);
if (leftover) throw new Error(`import: personal references left in the game: ${[...new Set(leftover)].join(', ')}`);

writeFileSync(resolve(root, 'web/index.html'), html);
console.log(`web/index.html  ${(before / 1e6).toFixed(2)} MB -> ${(html.length / 1e6).toFixed(2)} MB`);
