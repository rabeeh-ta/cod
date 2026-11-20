# Saltline

A browser multiplayer FPS running on Cloudflare: https://cod.rabeeta.xyz

The first screen has three ways to play:

- **Deathmatch**: quick play. Drops you into an open public match near you (rooms are grouped by continent), or opens a new one. Up to 10 players.
- **Room**: private. Create a room to get a 6-character code and invite link (`/r/ABC123`), or join one with a code. Inside the room you pick Deathmatch or Team play (Gate vs Quay). Up to 10 players.
- **Solo**: the single-player mission.

Above them is the **Map** picker: **Saltline Terminal** (the harbour), **Colosseum** (the arena of the Colosseum under restoration, an hour after a storm), **Alpine** (a war-ruined mountain village on a clear morning, with the Alps all round) or **Maram** (a walled desert town under rocky hills in the morning sun, with two sites, a long road and tunnels). Quick play matches you with players on the same map, a room keeps the map it was made with, and a room link loads that room's map for whoever opens it. Solo is set in the harbour.

Voice chat works in every online match. Press **V** (or the MIC button on touch) to talk. You hear the players in your match, and in Team play only your own team. **Settings → Voice chat volume** sets how loud other players are, from 0 to 400% (200% to start).

The pause screen shows the whole map in its top right corner: where you are and the way you face, your team in Team play, the two ammo sets, and an opponent for a few seconds after they fire (as the minimap does). It needs room beside the pause menu, so a screen under about 720 px wide does not get it.

**Settings → Crouch** and **Settings → Peek** choose how those keys work: **Hold** (down, or leaning, while held; the default), **Toggle** (press once to go down or lean out, again to come back; jumping or starting a sprint also stands you up, and sprinting brings you upright) or **Mixed** (a tap toggles, a press held half a second or more works as hold). The choices are kept in the browser.

Hold **F** to cook a grenade: red dots show where it would fly if let go now, up to the first thing it hits, a ring marks that spot and a small mark shows where it ends up after bouncing (both marks show through walls). Aim (right click) while cooking puts it back. In **Deathmatch** each player picks a colour (Quick play screen, room lobby, pause screen); a colour someone else in the room has is crossed out and says who has it, and whoever was in the room first keeps it.

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
| Grenade path | `web/fragpath.js` | The path of a cooked grenade: the game's own throw flown through the game's own steps (fixed 1/120 s since gun hook 24), drawn as dots to the first hit, a ring there and a mark where it ends up |
| Pause map | `web/fullmap.js` | The whole map on the pause screen, from the same walk grid as the minimap, north up, with you, your team, the ammo sets and recent shooters |
| Map choice | `web/maps.js` | Decides which map this page load builds (a link, the room, or the player's last pick) before the game starts |
| Colosseum | `web/maps/colosseum.js` | The second map: stonework, cover, light and collision, built in code when it is picked |
| Alpine | `web/maps/alpine.js`, `web/maps/alpine/` | The third map: a war-ruined village. Its houses are built the way Valle Morta builds them (walls as a grid of cells that blasts and collapses take away), and every wall cell a player can reach is also a collision box; roofs and other high parts stop shots as the triangles they are drawn with. Its textures and the 360° photograph of the valley are in the folder |
| Worker | `src/worker.js` | `/api/*` routes |
| `Room` Durable Object | `src/worker.js` | One per room code. Holds up to 10 WebSockets, relays player state, relays voice-call setup. Deletes itself 30 min after it empties |
| `Matchmaker` Durable Object | `src/worker.js` | One per continent. Tracks public rooms and fills the fullest open one first |
| `Census` Durable Object | `src/worker.js` | One for the whole game. Counts players online, in Deathmatch and in private rooms for the first screen |
| Import | `scripts/import.mjs` | Makes `web/index.html` from a claude.ai export with a few small patches that fail loudly if the game changes |
| Maram | `web/maps/maram.js`, `web/maps/maram/` | The fourth map: a desert town, drawn from a model (`maram.glb`). Everything drawn is solid: `world.json` holds its collision boxes, the places players can reach (for the minimap) and its spawns, all made by `scripts/maram-build.mjs`. The model's small pictures get a sharp second layer of stone, plaster, wood, rubble and sand in world space (Alpine's textures, and sand made in the file), the hills round it and the sky are a 360° photograph, sunbeams are drawn wherever the sun reaches a roofed floor and a light haze lies over the town, roofed places lose most of the sky's light, motes glitter where the sun falls, palms stand outside the walls, and the eye glides over the stepped ramps |
| Maram build | `scripts/maram-build.mjs` | Cuts the Maram model into collision boxes, fills the space behind its walls, keeps wall tops out of reach, and runs a walk-and-jump robot with the game's own movement over the result before it writes `world.json`. Run it after any change to the model |
| Map hooks | `scripts/map-hooks.mjs` | The patches that let a map other than the harbour build itself; the import runs them |
| Guns | `web/guns.js`, `web/guns/` | The shotgun and the sniper rifle: models, handling, shots, reloads, sounds and the scope; the three gun cards (the model turning, its numbers, its name) on the first screen, on the card shown when down, and on **B** in a match, where the pick is for the next life; the protected seconds after a respawn |
| Gun models | `scripts/gun-assets.mjs` | Turns a downloaded `.glb` into the small files in `web/guns/` (run once per model, on macOS) |
| Gun hooks | `scripts/gun-hooks.mjs` | The patches that let more guns into the game and change what a respawn does; the import runs them |
| Performance hooks | `scripts/perf-hooks.mjs`, `web/perf.js` | What keeps the game smooth on modest hardware, learnt from Valle Morta: no multisampling at Medium and High (the game's own smoothing pass does the edges), the mirror pass for puddles only at Ultra, the world drawn at the window's size rather than the screen's pixel density below Ultra, a warm-up during loading that prepares every shader and picture so first shots, grenades and players do not freeze the game, and older graphics cards starting on Medium; the import runs the hooks |

## Credits

The gun and ammunition models come from Sketchfab and are used under their Creative Commons licences:

- Shotgun: "Simple old shotgun" by SuperMopsek, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/simple-old-shotgun-e20d1457bf8b49d8ade324690de27b4b. Textures resized, the pump and stock separated.
- Ammunition: "Ammo Set" by Guy in a Poncho, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/ammo-set-31b78afb6f544b0386d02be2d7aad5d8. Textures resized, scaled up.
- Sniper rifle: "SV-98 | Contract Wars" by xlisov, [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/), https://sketchfab.com/3d-models/sv-98-contract-wars-130bd9dd144a4da2971d148dd0098492. One of the two rifles in the file is used; the bolt and magazine separated. Non-commercial use only.

The Maram map is a model by vrchris on Sketchfab (https://sketchfab.com/vrchris), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Renamed, scaled to the game and turned a quarter round; the picture on one plaque replaced.

The Alpine map uses work by others:

- Wall, roof, cobble, turf, earth, rubble, wood and bark textures: from [Valle Morta](https://github.com/Leonxlnx/valle-morta) by Leonxlnx, MIT licence (`web/maps/alpine/tex/LICENSE.txt`). Resized and recompressed. Maram lays the masonry, plaster, wood, rubble and worn plaster ones over its model as detail. The grass (tufts of crossed cards, each a painting of many blades) follows its method, and the blade-painting code is adapted from it.
- The valley and sky: "Alps Field" by Andreas Mischok, [polyhaven.com/a/alps_field](https://polyhaven.com/a/alps_field), CC0. Cut into a horizon strip and a small whole-sky picture.
- Maram's hills and sky: "Klippad Sunrise 2" by Greg Zaal, [polyhaven.com/a/klippad_sunrise_2](https://polyhaven.com/a/klippad_sunrise_2), CC0. Cut the same way (`web/maps/maram/band.jpg`, `sky.jpg`).

## Known limits

- **Hits are reported by the shooter** (the original design). A modified client can cheat. Fixing that means moving hit checks to the server.
- **Round timers use each player's own clock.** Clocks a few seconds apart can disagree on when a round ends.
- **Voice is a mesh**: each player sends to everyone else. Fine for 10 players of audio. Cloudflare Realtime SFU is the upgrade path for much larger rooms.
