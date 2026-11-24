// Map hooks: the few places where the generated game (web/index.html) lets a second map take over.
// The game was written for one level, the harbour. Extra maps live in web/maps/ and are picked by web/maps.js;
// these hooks are the only edits to the game itself. Each one is found by a pattern that captures the minified
// names around it, so a fresh export keeps working as long as the code has the same shape, and each fails loudly
// when it matches anything but exactly once. Fix the pattern then; never loosen the check.
//
//   import { applyMapHooks } from './map-hooks.mjs'     (scripts/import.mjs runs it on every import)
//   node scripts/map-hooks.mjs in.html out.html        (apply to a game file that has no hooks yet)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAP = 'window.__SALTLINE_MAP';
const LVL = '(window.__G&&window.__G.level||{})';

export function applyMapHooks(html) {
  // every hook replaces exactly one match; `to` gets the match groups
  function hook(re, to, what) {
    const all = html.match(new RegExp(re.source, 'g')) || [];
    if (all.length !== 1) throw new Error(`map hooks: expected exactly one match for ${what}, found ${all.length}`);
    html = html.replace(re, (...m) => to(...m));
  }

  // names of the three constant tables the whole game reads: world bounds, sun, sky
  const C = html.match(/var (\w+)=\{min:new (\w+)\(-40,0,-30\),max:new \2\(40,30,30\),groundY:0,seaY:-1\.6,quayX:30\},(\w+)=\{dir:new \2\(\.916,\.225,\.331\)\.normalize\(\),color:new \w+\(1,\.72,\.42\),intensity:9\},(\w+)=\{zenith:/);
  if (!C) throw new Error('map hooks: the world, sun and sky constants were not found');
  const [, world, , sun, sky] = C;
  // the table of sounds, so a map can add its own before the sound engine starts (they are made from numbers, like the game's)
  const S = html.match(/names:Object\.keys\(([\w$]+)\)\.filter\([\w$]+=>!\1\[[\w$]+\]\.ir\)/g) || [];
  if (S.length !== 1) throw new Error(`map hooks: expected exactly one match for the table of sounds, found ${S.length}`);
  const sounds = S[0].match(/keys\(([\w$]+)\)/)[1];

  // 1. the map scripts load before the game, so the choice is made by the time the game starts
  hook(/<script>\n(?=\(\(\)=>\{var \w+=Object\.defineProperty;)/,
    () => '<script src="/maps/colosseum.js"></script>\n<script src="/maps/alpine.js"></script>\n<script src="/maps/maram.js"></script>\n<script src="/maps/area51.js"></script>\n<script src="/maps.js"></script>\n<script>\n', 'the start of the game bundle');

  // 2. boot: hand the constants to the map before anything reads them (it may move the sun, drop the sea, add a sound, ...)
  hook(/window\.__G=(\w+);/,
    (m, g) => `${m}${g}.consts={world:${world},sun:${sun},sky:${sky},sounds:${sounds}};await(window.__SALTLINE_BOOT?window.__SALTLINE_BOOT(${g}):0);`, 'the game object');

  // 3. the three stages a map can build itself: level, backdrop, ground. Each gets the original builder to call or ignore
  for (const stage of ['level', 'backdrop', 'ground']) {
    hook(new RegExp(`await (\\w+)\\("${stage}","${stage}",\\(\\)=>(\\w+)\\((\\w+)\\)(,!0)?\\)`),
      (m, run, build, g, must = '') => `await ${run}("${stage}","${stage}",()=>${MAP}&&${MAP}.${stage}?${MAP}.${stage}(${g},()=>${build}(${g})):${build}(${g})${must})`, `the ${stage} stage`);
  }

  // 4. the harbour scatters extra barrels from its own list of spots; a map that sets level.explosivesOnly places its own
  hook(/for\(let\[(\w+),(\w+)\]of (\w+)\)\{let (\w+)=null,(\w+)=1e9;/,
    (m, a, b, list, c, d) => `for(let[${a},${b}]of(${LVL}.explosivesOnly?[]:${list})){let ${c}=null,${d}=1e9;`, 'the scattered barrels');

  // 5. harbour sounds a map can switch off with level.ambience = { sea: 0, harbour: false }, and the rain with rain: 0, the wind with wind: 0
  hook(/(\w+)\.sea\.setGain\(/, (m, v) => `${v}.sea.setGain((${LVL}.ambience?${LVL}.ambience.sea:1)*`, 'the sea loop');
  const KEY = { rain: 'rain', rainIn: 'rain', wind: 'wind' };
  for (const one of ['rain', 'rainIn', 'wind']) hook(new RegExp(`(\\w+)\\.${one}\\.setGain\\(`), (m, v) => `${v}.${one}.setGain((${LVL}.ambience&&${LVL}.ambience.${KEY[one]}!=null?${LVL}.ambience.${KEY[one]}:1)*`, `the ${one} loop`);
  for (const one of ['foghorn', 'container_bang']) {
    hook(new RegExp(`(\\w+)\\("${one}",\\{`), (m, play) => `(${LVL}.ambience&&${LVL}.ambience.harbour===!1?()=>{}:${play})("${one}",{`, `the ${one} sound`);
  }

  // 6. loading lines
  ['Stacking containers', 'Raising the cranes', 'Flooding the apron', 'Waking the Harbormaster'].forEach((line, i) => {
    hook(new RegExp(`"${line}"`), () => `(${MAP}&&${MAP}.boot&&${MAP}.boot[${i}]||"${line}")`, `the "${line}" loading line`);
  });

  // 7. the whole map on the pause screen (web/fullmap.js) shows what the minimap shows: your team in Team deathmatch, and
  //    an opponent for a few seconds after they fire. The minimap reads the other players from the multiplayer layer's
  //    own table; this hands the same table out, read only, beside the minimap's settings
  hook(/\n    const MAP = \{ range: 30, cell: \.5 \};\n/,
    m => `${m}    window.__SALTLINE_MATCH = { get live() { return !!mp.live; }, get mode() { return mp.mode; }, get team() { return mp.team; }, players: () => remotes.values() };\n`, 'the minimap settings');

  return html;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) { console.error('usage: node scripts/map-hooks.mjs in.html out.html'); process.exit(1); }
  writeFileSync(out, applyMapHooks(readFileSync(src, 'utf8')));
  console.log('map hooks applied -> ' + out);
}
