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
| Voice | Realtime STUN/TURN | `src/worker.js` `/api/ice` | Free STUN by default; TURN when the `TURN_KEY_ID` / `TURN_KEY_API_TOKEN` secrets are set. Audio itself is peer-to-peer WebRTC |
| Domain | Workers Custom Domain | `wrangler.jsonc` `routes` | `cod.rabeeta.xyz` on the `rabeeta.xyz` zone. `workers.dev` and preview URLs are off |
| Logs | Workers Observability | `wrangler.jsonc` | On |
| CI/CD | Workers Builds | Cloudflare dashboard | Every push to `master` runs `npx wrangler deploy`. No build command |

Front end is plain JS: the game is a single minified HTML file (three.js bundled inside), and `web/net.js` stands in for the claude.ai runtime (`window.claude.use(...)`) that the game was written against. Wrangler is the only dependency.

## Rules that are not obvious from the code

- **`web/index.html` is generated.** `npm run import [path]` turns a raw claude.ai export (`COD.html`, gitignored) into it, removing the author's note, work references and a 1.9 MB legacy build. Change the game by re-exporting and re-importing. Each patch in `scripts/import.mjs` fails loudly when its anchor moves; fix the anchor, never loosen the check. The final check refuses any output that still names the original author or employer.
- **The Worker name stays `saltline`.** Durable Object state, the custom domain and the Workers Builds connection are all keyed to that name. Renaming it makes a new, empty Worker.
- **Durable Object classes change only through a new migration tag** in `wrangler.jsonc` (`v1` today). Never edit or delete an existing tag.
- **`master` is production.** Anything merged there goes live in about a minute. Run `npm test` against `npm run dev` before pushing. It is a protocol smoke test that needs a running server, so CI does not run it.
- **The repo is public.** Secrets go in `wrangler secret put` (runtime) or `.dev.vars` (local, gitignored), never in `wrangler.jsonc`.
