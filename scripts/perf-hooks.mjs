// Performance hooks: the few edits to the generated game (web/index.html) that make it cheaper to draw.
// Like the map and gun hooks, each one finds its place by a pattern and fails loudly unless it matches exactly once.
//
// 1. Edge smoothing. The game drew every frame with 4x multisampling at "high" (2x at "medium") and then ran its own
//    edge-smoothing pass (FXAA) over the result as well. Multisampling was the dearest thing in the frame: 4 ms of a
//    13 ms frame on an Apple M4 at 2022x1137. The presets now leave it to the smoothing pass alone, as "low" always
//    did; "ultra" keeps multisampling for those who choose it.
//
// 2. The starting quality. Left on "auto", the game gave every card but Intel's built-in ones "high". Older and
//    entry-level cards (GTX 900, 1000 and 1600 series, MX, RX 400/500, the graphics built into Ryzen chips) now
//    start on "medium". The player's own choice in Settings still wins, and the game still lowers the drawing size
//    by itself when frames run long.
//
// 3. The mirror pass. To show the world in its puddles the game drew the whole map a second time every frame, upside
//    down, at half the size of the screen: twice the draw calls, and 16 to 19 % of the frame on the harbour and the
//    Colosseum. Valle Morta draws its mirror only on its top setting, and so does this game now: only "ultra"
//    keeps it. Below that the puddles reflect the sky, as they always did on "low".
//
// 4. The size of the picture. The game drew its world at the screen's full pixel density (up to twice the size of
//    the window on a Retina Mac or a laptop set to 125 %, within a budget). Valle Morta draws it at the window's
//    own size and sharpens it up to the screen. Now so does this game below "ultra": on a 1080p laptop at 125 %
//    that is 1536x864 instead of 1920x1080, a third fewer pixels. The last pass, the interface and the text are
//    still drawn at full density.
//
// 5. Warm-up. Everything the match can show is drawn once while the game loads (web/perf.js), so the first shot,
//    knife, grenade, gun or player does not stop the game while the browser prepares it. A second warm-up runs when
//    the multiplayer layer starts, with another player's figure and the effects of a fight.
//
//   import { applyPerfHooks } from './perf-hooks.mjs'    (scripts/import.mjs runs it on every import)
//   node scripts/perf-hooks.mjs in.html out.html        (apply to a game file that has the other hooks but not these)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function applyPerfHooks(html) {
  function hook(re, to, what) {
    const all = html.match(new RegExp(re.source, 'g')) || [];
    if (all.length !== 1) throw new Error(`perf hooks: expected exactly one match for ${what}, found ${all.length}`);
    html = html.replace(re, (...m) => to(...m));
  }
  hook(/medium:\{name:"medium",scale:\.85,msaa:2,/, () => 'medium:{name:"medium",scale:.85,msaa:0,', 'the medium preset');
  hook(/high:\{name:"high",scale:1,msaa:4,/, () => 'high:{name:"high",scale:1,msaa:0,', 'the high preset');
  hook(/planar:\.5,bloom:!0,motionBlur:!1,rain:\.8\}/, () => 'planar:0,bloom:!0,motionBlur:!1,rain:.8}', 'the mirror pass at medium');
  hook(/planar:\.5,bloom:!0,motionBlur:!0,rain:1\},ultra/, () => 'planar:0,bloom:!0,motionBlur:!0,rain:1},ultra', 'the mirror pass at high');
  hook(/let le=ee\*S\.scale,xe=/, () => 'let le=ee*S.scale*(n.quality.name==="ultra"?1:Math.min(1,1/oe)),xe=', 'the size of the picture');
  hook(/await i\.compileAsync\(r,a\)/, () => 'await(window.__SALTLINE_PERF?window.__SALTLINE_PERF.warm(i,r,a):i.compileAsync(r,a))', 'the warm-up');
  // the second warm-up, once the multiplayer layer exists: another player's figure, carrying each gun, and the effects a fight makes
  hook(/(\n {6}marks: \(\) => \[0, 1\]\.map\(\(\) => new T\.Mesh\(markGeo, glow\(0xe8e4da, 3\)\)\),\n {4}\}\);\n)/, m => m +
    "    try { if (window.__SALTLINE_PERF) window.__SALTLINE_PERF.match(G, () => { const av = kit.create(); avatars.add(av.group); try { window.__SALTLINE_GUNS.avatar(av); } catch { /* fine */ } return () => avatars.remove(av.group); }); } catch (e) { console.error('[perf] ' + e); }\n", 'the player kit');
  hook(/<script src="\/guns\.js"><\/script>\n/, m => `${m}<script src="/perf.js"></script>\n`, 'the script tags');
  hook(/\/SwiftShader\|llvmpipe\|Software\|Mali\|Adreno\|PowerVR\/i\.test\((\w+)\)\|\|/,
    (m, t) => `/SwiftShader|llvmpipe|Software|Mali|Adreno|PowerVR|GTX (9|10|16)\\d\\d|GeForce (GT|MX) ?\\d|RX (4|5)\\d\\d|Radeon\\(TM\\) (Vega \\d+ )?Graphics/i.test(${t})||`, 'the starting quality');
  return html;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) { console.error('usage: node scripts/perf-hooks.mjs in.html out.html'); process.exit(1); }
  writeFileSync(out, applyPerfHooks(readFileSync(src, 'utf8')));
  console.log('perf hooks applied -> ' + out);
}
