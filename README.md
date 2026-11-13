# Saltline

A browser multiplayer FPS running on Cloudflare: https://cod.rabeeta.xyz

The first screen has three ways to play:

- **Deathmatch**: quick play. Drops you into an open public match near you (rooms are grouped by continent), or opens a new one. Up to 10 players.
- **Room**: private. Create a room to get a 6-character code and invite link (`/r/ABC123`), or join one with a code. Inside the room you pick Deathmatch or Team play (Gate vs Quay). Up to 10 players.
- **Solo**: the single-player mission.

Voice chat works in every online match. Press **V** (or the MIC button on touch) to talk. You hear the players in your match, and in Team play only your own team. **Settings → Voice chat volume** sets how loud other players are, from 0 to 400% (200% to start).

## Run it

```sh
npm install
npm run dev        # serves on http://localhost:8787 (add -- --port 8799 if 8787 is taken)
npm test           # protocol smoke test against the dev server (pass a URL to test another port or a deployment)
```

## Deploy

Pushing to `master` deploys automatically through Cloudflare Workers Builds. To deploy by hand: `npx wrangler login`, then `npm run deploy`.

Optional, for voice on strict networks (some corporate, mobile and university networks block direct connections). Create a TURN key in the Cloudflare dashboard under **Realtime → TURN**, then:

```sh
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_KEY_API_TOKEN
```

Without these, voice uses Cloudflare's free STUN server and works for most players.

## Update the game

The game is a claude.ai export. Save the new export as `COD.html` in the repo root (it is gitignored), then:

```sh
npm run import     # writes the cleaned web/index.html
```

## How it fits together

See [CLAUDE.md](CLAUDE.md) for the Cloudflare stack.

| Piece | File | Job |
|---|---|---|
| Game | `web/index.html` | The game, served as a static asset |
| Network adapter | `web/net.js` | Stands in for the claude.ai runtime the game was written for, plus the first screen and voice (WebRTC, peer to peer) |
| Worker | `src/worker.js` | `/api/*` routes |
| `Room` Durable Object | `src/worker.js` | One per room code. Holds up to 10 WebSockets, relays player state, relays voice-call setup. Deletes itself 30 min after it empties |
| `Matchmaker` Durable Object | `src/worker.js` | One per continent. Tracks public rooms and fills the fullest open one first |
| `Census` Durable Object | `src/worker.js` | One for the whole game. Counts players online, in Deathmatch and in private rooms for the first screen |
| Import | `scripts/import.mjs` | Makes `web/index.html` from a claude.ai export with a few small patches that fail loudly if the game changes |

## Known limits

- **Hits are reported by the shooter** (the original design). A modified client can cheat. Fixing that means moving hit checks to the server.
- **Round timers use each player's own clock.** Clocks a few seconds apart can disagree on when a round ends.
- **Voice is a mesh**: each player sends to everyone else. Fine for 10 players of audio. Cloudflare Realtime SFU is the upgrade path for much larger rooms.
