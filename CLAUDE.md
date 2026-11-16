# Saltline (cod)

A browser multiplayer FPS, live at https://cod.rabeeta.xyz. The game was built as a claude.ai artifact; this repo runs it on Cloudflare instead.

## Stack

Everything runs on Cloudflare. There is no other server, database or build tool.

| Layer | Cloudflare product | Where | What it does |
|---|---|---|---|
| Static files | Workers Static Assets | `web/` | Serves `index.html` (the game) and `net.js` from the edge. `/r/<code>` invite links fall back to `index.html` (SPA mode) |
| API | Workers | `src/worker.js` | Only `/api/*` runs code (`run_worker_first` in `wrangler.jsonc`) |
| Rooms | Durable Objects (SQLite-backed), class `Room` | `src/worker.js` | One per 6-char room code. Holds up to 10 WebSockets (hibernation API), relays player state and WebRTC signalling |
| Matchmaking | Durable Objects, class `Matchmaker` | `src/worker.js` | One per continent (from `request.cf`). Fills the fullest open public room first |
| Player counts | Durable Objects, class `Census` | `src/worker.js` `/api/online` | One global instance. Every room reports its count on join/leave; quiet rooms are re-checked so a crashed room can't leave a stale number. Feeds the global numbers on the first screen. The in-match "N in this match" line doesn't use it: `net.js` counts that live from the room connection |
| Maps | Workers Static Assets | `web/maps.js`, `web/maps/` | The game builds one map per page load. `maps.js` picks it before the game starts (`?map=`, the room's map, or the player's last pick); `maps/colosseum.js` builds the Colosseum. Rooms store their map; quick play has one `Matchmaker` per continent and map |
| Voice | Realtime STUN/TURN | `src/worker.js` `/api/ice` | Free STUN by default; TURN when the `TURN_KEY_ID` / `TURN_KEY_API_TOKEN` secrets are set. Audio itself is peer-to-peer WebRTC |
| Domain | Workers Custom Domain | `wrangler.jsonc` `routes` | `cod.rabeeta.xyz` on the `rabeeta.xyz` zone. `workers.dev` and preview URLs are off |
| Logs | Workers Observability | `wrangler.jsonc` | On |
| CI/CD | Workers Builds | Cloudflare dashboard | Every push to `master` runs `npx wrangler deploy`. No build command |

Front end is plain JS: the game is a single minified HTML file (three.js bundled inside), and `web/net.js` stands in for the claude.ai runtime (`window.claude.use(...)`) that the game was written against. Wrangler is the only dependency.

## Rules that are not obvious from the code

- **`web/index.html` is generated.** `npm run import [path]` turns a raw claude.ai export (`COD.html`, gitignored) into it, removing the author's note, work references and a 1.9 MB legacy build. Change the game by re-exporting and re-importing. Each patch in `scripts/import.mjs` fails loudly when its anchor moves; fix the anchor, never loosen the check. The final check refuses any output that still names the original author or employer.
- **A map is three things.** A file in `web/maps/` that registers itself in `window.__SALTLINE_MAPS`, its script tag in `scripts/map-hooks.mjs`, and its id in `MAPS` in `src/worker.js` (the server only stores maps it knows). The hooks in `map-hooks.mjs` are the only edits to the game for maps: each finds its place by a pattern and fails loudly if it does not match exactly once. A map must not reach into the game beyond those hooks and `window.__G`.
- **Check a map in a browser before pushing.** `npm test` only covers the server. Load `http://localhost:8787/?map=colosseum`, enter a match, and watch the console: the game logs anything that throws.
- **A gun is three things.** Its model, prepared once by `scripts/gun-assets.mjs` into `web/guns/`; its numbers, handling, reload and sounds in `web/guns.js`; and the hooks in `scripts/gun-hooks.mjs`, which are the only edits to the game for guns and for the respawn (two seconds down, five protected). The rifle and pistol are the game's own and stay in the generated file. What goes over the wire keeps its old meaning (shot code 0 rifle, 1 pistol; hit kinds 1 knife, 2 frag; carried 2 knife); new guns take the next numbers, so an old client still plays against a new one.
- **Check guns with two players.** One browser cannot be shot. Two tabs on `npm run dev`, both in Deathmatch: shoot the other, read the kill feed and the card shown when down, come back, and try **B**.
- **The Worker name stays `cod`.** It was renamed from `saltline` in the dashboard, which carried over the custom domain and Durable Objects (their namespaces are still called `saltline_Room` / `saltline_Matchmaker`). Changing `name` in `wrangler.jsonc` alone makes a new, empty Worker instead; rename in the dashboard first.
- **Durable Object classes change only through a new migration tag** in `wrangler.jsonc` (`v2` today). Never edit or delete an existing tag.
- **`master` is production.** Anything merged there goes live in about a minute. Run `npm test` against `npm run dev` before pushing. It is a protocol smoke test that needs a running server, so CI does not run it.
- **The repo is public.** Secrets go in `wrangler secret put` (runtime) or `.dev.vars` (local, gitignored), never in `wrangler.jsonc`.
