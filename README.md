# Saltline

A browser multiplayer FPS running on Cloudflare: https://cod.rabeeta.xyz

The first screen has three ways to play:

- **Deathmatch**: quick play. Drops you into an open public match near you (rooms are grouped by continent), or opens a new one. Up to 10 players.
- **Room**: private. Create a room to get a 6-character code and invite link (`/r/ABC123`), or join one with a code. Inside the room you pick Deathmatch or Team play (Gate vs Quay). Up to 10 players.
- **Solo**: the single-player mission.

Above them is the **Map** picker: **Saltline Terminal** (the harbour), **Colosseum** (the arena of the Colosseum under restoration, an hour after a storm), **Alpine** (a war-ruined mountain village on a clear morning, with the Alps all round), **Maram** (a walled desert town under rocky hills in the morning sun, with two sites, a long road and tunnels) or **Area 51** (a fenced military motor pool in the open desert at noon: two long barracks, a radio block and tower, two hangars, a loading dock and a yard of trucks, containers and stores). Quick play matches you with players on the same map, a room keeps the map it was made with, and a room link loads that room's map for whoever opens it. Solo is set in the harbour.

Voice chat works in every online match. Press **V** (or the MIC button on touch) to talk. You hear the players in your match, and in Team play only your own team. **Settings → Voice chat volume** sets how loud other players are, from 0 to 400% (200% to start).

The pause screen shows the whole map in its top right corner: where you are and the way you face, your team in Team play, the two ammo sets, and an opponent for a few seconds after they fire (as the minimap does). It needs room beside the pause menu, so a screen under about 720 px wide does not get it.

**Settings → Crouch** and **Settings → Peek** choose how those keys work: **Hold** (down, or leaning, while held; the default), **Toggle** (press once to go down or lean out, again to come back; jumping or starting a sprint also stands you up, and sprinting brings you upright) or **Mixed** (a tap toggles, a press held half a second or more works as hold). The choices are kept in the browser.

Hold **F** to cook a grenade: red dots show where it would fly if let go now, up to the first thing it hits, a ring marks that spot and a small mark shows where it ends up after bouncing (both marks show through walls). Aim (right click) while cooking puts it back. In **Deathmatch** each player picks a colour (Quick play screen, room lobby, pause screen); a colour someone else in the room has is crossed out and says who has it, and whoever was in the room first keeps it.

## Run it

```sh
npm install
npm run dev        # serves on http://localhost:8787 (add -- --port 8799 if 8787 is taken)
npm test           # protocol smoke test against the dev server (pass a URL to test another port or a deployment)
node scripts/score-check.mjs   # kills, deaths and team scores over five rounds with a real game tab (needs the dev server and Chrome)
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
| Area 51 | `web/maps/area51.js`, `web/maps/area51/` | The fifth map: a fenced desert motor pool at noon, built in code. Everything a player can reach is a collision box; roofs and other high parts stop shots as the triangles they are drawn with, and any top over 3.15 m is capped for players. The balcony, stair and booth rails can be jumped and vaulted over but not stood on. Walls, roofs and sheet metal are the game's own materials with peeling paint, rust and dirt laid over them; the desert and the yard are photographed ground. The canopy's sheets, the dock's sheets, the camo net and the windsock are simulated cloth that hangs by its own weight and moves in the wind; the search radar's aerial turns; light shafts fall through the net's cut-outs, motes glitter in the sun, and chain-link fences cast drawn lattice shadows. Its vehicles and many of its props are downloaded models (see Credits), the rest are built in code; its red drums blow up when shot. Steel stairs climb to the barracks' and the east wing's roofs; you can jump off them, and a fall from that height costs about 80 health. Puddles lie by the wash bay, round the water tank, along the kerbs and alleys and in the wheel ruts: they mirror the sky, and on High and Ultra the yard itself while one is near and in view. The hills and sky are a 360° photograph; its pictures are in the folder. `__SALTLINE_MAPS.area51._debug.reach()` in the console lists any top a player could stand on that they should not |
| Area 51 vehicles | `scripts/area51-models.mjs`, `web/maps/area51/models/` | Turns the downloaded vehicle models (`.glb`, not committed) into what the map loads: geometry, a manifest with the materials, the credit and collision boxes made from the model's own shape, and textures cut down to 1024 px. It leaves out what nobody sees (a cab's inside, the springs under a body, bolts), brings the triangle count down (with the meshoptimizer package, installed only to run it: `npm i --no-save meshoptimizer`), and merges materials that share pictures. Vehicles get collision from their own shape; props are drawn in the place of a box the map already builds, many copies as one instanced draw. The map falls back to its own boxy vehicle if a model does not load. Run it once per model, on macOS |
| Maram build | `scripts/maram-build.mjs` | Cuts the Maram model into collision boxes, fills the space behind its walls, keeps wall tops out of reach, and runs a walk-and-jump robot with the game's own movement over the result before it writes `world.json`. Run it after any change to the model |
| Map hooks | `scripts/map-hooks.mjs` | The patches that let a map other than the harbour build itself; the import runs them |
| Guns | `web/guns.js`, `web/guns/` | The shotgun and the sniper rifle: models, handling, shots, reloads, sounds and the scope; the three gun cards (the model turning, its numbers, its name) on the first screen, on the card shown when down, and on **B** in a match, where the pick is for the next life; the protected seconds after a respawn |
| Gun models | `scripts/gun-assets.mjs` | Turns a downloaded `.glb` into the small files in `web/guns/` (run once per model, on macOS) |
| Gun hooks | `scripts/gun-hooks.mjs` | The patches that let more guns into the game and change what a respawn does; the import runs them |
| Performance hooks | `scripts/perf-hooks.mjs`, `web/perf.js` | What keeps the game smooth on modest hardware, learnt from Valle Morta: no multisampling at Medium and High (the game's own smoothing pass does the edges), the mirror pass for puddles only at Ultra, the world drawn at the window's size rather than the screen's pixel density below Ultra, a warm-up during loading that prepares every shader and picture so first shots, grenades and players do not freeze the game, and older graphics cards starting on Medium; the import runs the hooks |
| Score hooks | `scripts/score-hooks.mjs`, `scripts/score-check.mjs` | Kills and deaths stay right across dropped connections, reloads, rounds and changes of side; the import runs them last, and the check plays five rounds against a real game tab |

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

The Area 51 map uses work by others:

- The mountains and sky: "Kiara 5 Noon" by Greg Zaal, [polyhaven.com/a/kiara_5_noon](https://polyhaven.com/a/kiara_5_noon), CC0. Cut into a horizon strip and a small whole-sky picture (`web/maps/area51/band.jpg`, `sky.jpg`).
- The desert and yard ground: "Aerial Ground Rock" and "Brown Mud Dry" by Rob Tuytel, [polyhaven.com/a/aerial_ground_rock](https://polyhaven.com/a/aerial_ground_rock) and [polyhaven.com/a/brown_mud_dry](https://polyhaven.com/a/brown_mud_dry), CC0 (`web/maps/area51/tex/`). Resized and recompressed.
- The barracks plaster: Valle Morta's worn plaster texture, borrowed from `web/maps/alpine/tex/` (MIT, above).
- The vehicles and props are Sketchfab models, used under their licences and converted by `scripts/area51-models.mjs`: scaled to life size, turned to the map, textures resized to 1024 px or less, triangles reduced (meshoptimizer), what nobody sees left out (a cab's inside, springs, bolts), glass drawn solid, and single objects cut out of files that hold several:
  - "AC Outdoor Unit - Lowploy Game Asset" by krishVector, [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) (non-commercial use only), https://sketchfab.com/3d-models/ac-outdoor-unit-lowploy-game-asset-fad73f702894431bac553a6a9f14f549. Used for the AC units on the walls.
  - "Acacia tree" by evolveduk, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/acacia-tree-bb14c2bb679b4d0bb1c578a27e2ddabf. Used for the trees.
  - "Ammo boxes - free game asset" by Andy Woodhead, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/ammo-boxes-free-game-asset-792384e035894e8686e2f7ce34054410. Used for the ammo boxes.
  - "Engine Hoist - Engine Crane" by dinoxwave, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/engine-hoist-engine-crane-cca42a7a1eaa47f187e9206991c5b4e4. Used for the engine hoist.
  - "ForkLift GameReady" by Mathieu Godard, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/forklift-gameready-31c9702da6a04f4eb534fe83cf135c13. Used for the forklift.
  - "Generator LP" by YoeriBervoets, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/generator-lp-9127ac84a3c84d56be6e3993ed350eff. Used for the portable generator.
  - "HVAC Unit" by kubassa, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/hvac-unit-0bf1acaa6f1d4a9bb38cfc91fd115f9c. Used for the long roof units.
  - "IBC Tank" by Jinhong Jeong, [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) (non-commercial use only), https://sketchfab.com/3d-models/ibc-tank-a6c6ae1f847245d783c82e4b5f4b9841. Used for the IBC tanks.
  - "Jerry Cans Model Free" by Nicholas-3D, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/jerry-cans-model-free-7b79616bd4534970a4dd6b25e28c38eb. Used for the jerry cans.
  - "Marmot - fictional air-defence radar truck" by hannes.thurnherr, [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) (non-commercial use only), https://sketchfab.com/3d-models/marmot-fictional-air-defence-radar-truck-3ee13575a5d9466b8dbe1e58dd1a5db4. Used for the big truck.
  - "Military Truck" by Raphael Escamilla, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/military-truck-d3a85af5faef4fddb217b3fce073614c. Used for the two cars.
  - "Military Vehicle" by sayedgamal655, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/military-vehicle-8cb73c93d4a442b9ac6a929d58e9daad. Used for the APC.
  - "Oil Drums" by Chamod, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/oil-drums-b8fccbf7d949407e9ef32165e5bf3f18. Used for the oil drums.
  - "Old Tyres" by Sousinho, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/old-tyres-392a49ceabe54d84bc260ffadc714c68. Used for the tyre.
  - "Picnic Table - Low Poly" by Derek Flanagan, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/picnic-table-low-poly-fe35acda3a5245da8459d1a062e28190. Used for the picnic tables.
  - "Renault TRM Radar Truck" by Muhamad Mirza Arrafi, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/renault-trm-radar-truck-1ad95e5724624a3bba7d36a686817efc. Used for the radar truck.
  - "Rooftop Ventilation Modular Kit" by D3D, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/rooftop-ventilation-modular-kit-53535fc3005741758c35a4b7227aaff5. Its unit A only, for the packaged rooftop units used as roof cover.
  - "Simple Generator(Fixed)" by Blender3D, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/simple-generatorfixed-eda91f75faae470e8d6461e0e6fc86fa. Used for the generator sets.
  - "Ural 4320" by Brout, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/ural-4320-f953c51a5dbc4a15949f4dcc0905c4e8. Used for the canvas trucks.
  - "Vintage Bicycle" by VladNeko, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/vintage-bicycle-1795f6e907634afda88fdaf45f67b279. Used for the bicycle.
  - "Wooden Boxes And Crates Kit" by Jungle Jim, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/wooden-boxes-and-crates-kit-7db0ab3a652445f8ae883aacdd089e54. Used for the crates.
  - "Wooden Pallet Low-poly" by MaX3Dd, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/wooden-pallet-low-poly-2f1abd705d4f4118b4c8d0b275441505. Used for the pallets.
  - "Workbench" by JJ Chalupnik, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), https://sketchfab.com/3d-models/workbench-9634d6a81a494925a909512c8048f446. Used for the workbench.

## Known limits

- **Hits are reported by the shooter** (the original design). A modified client can cheat. Fixing that means moving hit checks to the server.
- **Round timers use each player's own clock.** Clocks a few seconds apart can disagree on when a round ends.
- **Voice is a mesh**: each player sends to everyone else. Fine for 10 players of audio. Cloudflare Realtime SFU is the upgrade path for much larger rooms.
