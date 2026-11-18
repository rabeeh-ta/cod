/* Saltline map: Alpine. A mountain village after a war, on a bright morning.

   One cobbled street with a bend of rubble in it, a back lane, a green with a well, a church square at the east end.
   Half the houses are shells: no roof, walls broken down to steps of stone, doors and windows you can see and shoot
   through. Round it, meadows, pine slopes and snow.

   How it is made, and why it holds together:

   - Everything solid is a box, and every box is drawn exactly as it collides. The game's collision is boxes that lie
     along the axes, so the village is built along the axes too: a wall is a row of half-metre columns, a window is the
     columns that are missing, a ruin is the same wall with its columns cut to different heights. There is no part of
     a wall you can see and not touch, or touch and not see.
   - Rubble is the one thing that is not a box: a heap is a smooth hill the game is told about (walking, shots and
     thrown things all ask heap()).
   - Thin things are solid too: shutters, lintels, sills, beams, rails. On the ground floor they lie flush inside
     their openings, so there is nothing to catch on in passing.
   - Nothing can be climbed that should not be. A player gets 1.69 m above whatever they stand on (a 1.27 m jump and
     a 0.42 m step, which the game allows in the air too) and 1.95 m by vaulting (this map's vaultMax). The blocks and
     crates stand up to 1.95 m, so from their tops a player reaches 3.9 m; every top over 3.15 m with open sky over it
     is therefore carried up out of reach by a box for players only (see the caps near the end). Ruined walls are
     0.4 or 0.8 m, or 3.2 m and up. Roofs stop shots only, as the flat sheets they are, so a gap in the caps would be
     a way into a sealed house.
   - The look is borrowed where others did it better: the textures are Valle Morta's (MIT) and the valley round the
     village is a 360-degree photograph of the Alps (CC0). See the README for the credits.

   The game reaches this file through the map hooks (scripts/map-hooks.mjs) and window.__G, like the Colosseum.    */
(() => {
  'use strict';
  const MAPS = (window.__SALTLINE_MAPS = window.__SALTLINE_MAPS || {});

  /* ------------------------------------------------------------------ small maths */
  const TAU = Math.PI * 2, clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash(i, j = 0, k = 0) { let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(k | 0, 2147483647)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function noise2(x, z) { const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz); return lerp(lerp(hash(xi, zi), hash(xi + 1, zi), u), lerp(hash(xi, zi + 1), hash(xi + 1, zi + 1), u), v); }
  function noise3(x, y, z) { const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = x - xi, fy = y - yi, fz = z - zi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
    const l = (dx, dy) => lerp(hash(xi + dx, yi + dy, zi), hash(xi + dx, yi + dy, zi + 1), w); return lerp(lerp(l(0, 0), l(1, 0), u), lerp(l(0, 1), l(1, 1), u), v); }
  const fbm2 = (x, z, o = 4) => { let s = 0, a = 0.5, n = 0; for (let i = 0; i < o; i++) { s += a * noise2(x, z); n += a; x *= 2.03; z *= 2.03; a *= 0.5; } return s / n; };

  /* ------------------------------------------------------------------ the plan, in metres
     x runs west to east, z north to south (the street lies along x at z = 0). Everything a player can reach is inside
     PLAY; the houses and walls of the edge stand just outside it. */
  const PLAY = { x0: -36, x1: 28, z0: -26, z1: 26 };
  const SUN = { az: 232, el: 42.1 };                      // where the sun is: up in the south-west, so shadows lie across the street
  const WALL = 0.5, CELL = 0.5, F1 = 3.0, F2 = 5.8, F3 = 8.6;     // wall thickness, the width of one wall cell, the tops of one, two and three storeys
  /* Houses. [x0, z0, x1, z1], storeys, ridge ('x' or 'z'), and what kind:
       sealed   doors and shutters closed, nobody goes in; damage only out of reach
       open     the ground floor can be entered; damage only out of reach
     upstairs: a stair against the west wall (keep it blind: noWin) up to a room on the first floor whose windows
     can be climbed out of; bigWin: one side whose first-floor windows are a single opening instead, as high as the others and 5 m wide;
     extraDoors: [[side, along]] a doorway more; veranda: a ruin's side ('n', 's': stair against the west wall; 'e': stair
     against the back wall) with boards along it at the first floor, and nothing else up there
       ruin     broken walls, open to the sky or nearly; damage anywhere
     and what the war did to it (see house()): damage.blasts [x, y, z, radius], damage.collapse (a corner or a stretch
     brought down: where, how far, how wide), damage.top (the height the walls are broken off at), damage.burnt (soot
     and charred timber); roof: intact, holed (with roofHoles [x, z, radius]), skeleton (the rafters a fire left), none.
     Edge houses (outside PLAY) are part of what keeps players in, so their walls stay whole below 3.2 m. */
  const HOUSES = [
    // north of the street
    { id: 'n1', at: [-33, 4, -22, 13], floors: 3, ridge: 'x', kind: 'open', upstairs: true, noWin: ['w0', 'w1'], bigWin: 'n', tint: [1.12, 0.98, 0.74], quoins: true, roof: 'holed', roofHoles: [[-25.8, 6.6, 1.7]], damage: { blasts: [[-25.6, 7.4, 4, 1.25]] } },
    { id: 'n2', at: [-19, 4, -8, 13], floors: 2, ridge: 'x', kind: 'ruin', veranda: 'e', tint: [1.06, 1.0, 0.9], seed: 11, roof: 'none', damage: { collapse: { x: -13, z: 4, depth: 7.4, sigma: 3.0 }, rag: 0.8, blasts: [[-17.2, 1.6, 13.2, 1.5]], burnt: 0.45 } },
    { id: 'n3', at: [-5, 4, 7, 13], floors: 2, ridge: 'x', kind: 'open', tint: [1.14, 0.92, 0.82], balcony: 's', quoins: true, roof: 'holed', roofHoles: [[5.2, 10.6, 1.5]], upstairs: true, noWin: ['w0', 'w1'] },
    { id: 'n4', at: [10, 4, 21, 13], floors: 2, ridge: 'x', kind: 'ruin', tint: [0.96, 0.95, 0.93], seed: 23, stone: true, extraDoors: [['w', 8.5]], roof: 'skeleton', floor: true, damage: { top: 6.6, rag: 0.7, blasts: [[14.2, 1.2, 4, 1.55], [21, 4.6, 7.6, 1.6]], burnt: 0.9 } },
    // south of the street
    { id: 's1', at: [-34, -13, -23, -4], floors: 2, ridge: 'x', kind: 'open', upstairs: true, noWin: ['w0', 'w1'], bigWin: 's', tint: [1.05, 1.03, 0.92], quoins: true, roof: 'holed', roofHoles: [[-25.8, -6.6, 1.4], [-31.6, -10.6, 1.0]] },
    { id: 's2', at: [-20, -12, -11, -4], floors: 2, ridge: 'x', kind: 'ruin', tint: [1.1, 0.98, 0.8], seed: 37, roof: 'skeleton', damage: { collapse: { x: -11, z: -4, depth: 8.2, sigma: 2.7 }, rag: 0.7, burnt: 0.35 } },
    { id: 's3', at: [10, -13, 20, -4], floors: 3, ridge: 'x', kind: 'open', upstairs: true, noWin: ['w0', 'w1'], bigWin: 's', tint: [0.98, 1.02, 1.08], balcony: 'n', quoins: true, roof: 'intact' },
    // the church: nave and tower
    { id: 'nave', at: [16, -30, 28, -17], floors: 2, ridge: 'x', kind: 'sealed', tint: [1.08, 1.06, 1.0], tall: 7.4, church: true, quoins: true, roof: 'holed', roofHoles: [[20.6, -20.4, 2.1], [25.6, -26.4, 1.3]] },
    { id: 'tower', at: [23, -17, 28, -12], floors: 2, ridge: 'spire', kind: 'sealed', tint: [1.08, 1.06, 1.0], tall: 15.5, quoins: true },
    // the edge: north row, west, south and east
    { id: 'e-n1', at: [-36.5, 18, -24, 27], floors: 2, ridge: 'x', kind: 'sealed', tint: [1.12, 0.94, 0.82], quoins: true },
    { id: 'e-n2', at: [-13, 18, -1, 27], floors: 2, ridge: 'x', kind: 'sealed', tint: [1.06, 1.03, 0.94], roof: 'skeleton', seed: 5, damage: { top: 6.9, rag: 0.9, burnt: 0.75 } },
    { id: 'e-n3', at: [9, 18, 21, 27], floors: 3, ridge: 'x', kind: 'sealed', tint: [1.12, 1.0, 0.76], quoins: true, roof: 'holed', roofHoles: [[15.2, 21.2, 1.5]], damage: { blasts: [[12.4, 6.9, 18, 1.1]] } },
    { id: 'e-w1', at: [-41, -9, -36, 5], floors: 2, ridge: 'z', kind: 'sealed', tint: [1.0, 1.03, 1.08] },
    { id: 'e-s1', at: [-31, -31, -19, -26], floors: 2, ridge: 'x', kind: 'sealed', tint: [1.1, 1.0, 0.82], quoins: true, damage: { blasts: [[-24.8, 4.8, -26, 1.2]] } },
    { id: 'e-s2', at: [-9, -31, 5, -26], floors: 2, ridge: 'x', kind: 'sealed', tint: [1.12, 0.92, 0.82], roof: 'holed', roofHoles: [[-3.4, -27.6, 1.6]] },
    { id: 'e-e1', at: [28, -8, 33, 6], floors: 2, ridge: 'z', kind: 'sealed', tint: [1.06, 1.03, 0.94], quoins: true },
    { id: 'e-e2', at: [28, 10, 33, 20], floors: 2, ridge: 'z', kind: 'sealed', tint: [1.12, 0.99, 0.76], roof: 'skeleton', seed: 9, damage: { top: 6.8, rag: 0.8, burnt: 0.6 } },
  ];
  /* Garden walls that close the gaps in the edge: [x0, z0, x1, z1], 2.8 m high, half a metre thick. */
  const EDGE_WALLS = [
    [-24, 18, -13, 18.5], [-1, 18, 9, 18.5], [21, 18, 28.5, 18.5],                 // north
    [-36.5, 5, -36, 18], [-36.5, -26.5, -36, -9],                                  // west
    [-36.5, -26.5, -31, -26], [-19, -26.5, -9, -26], [5, -26.5, 16, -26],          // south
    [28, -12, 28.5, -8], [28, 6, 28.5, 10], [28, 20, 28.5, 18.5],                  // east
  ];
  /* Heaps of rubble: [x, z, radius, height]. Smooth hills, at most 1.15 m, that can be walked over. */
  const HEAPS = [[3.2, 0.3, 3.5, 1.15], [-13.2, 4.6, 2.6, 1.0], [-14.6, 9.2, 2.3, 0.8], [-17.4, 13.8, 1.5, 0.55], [15.4, 8.6, 2.6, 0.95], [14.0, 3.4, 1.7, 0.65],
    [-12.2, -5.0, 2.6, 1.05], [-16.4, -8.8, 2.1, 0.75], [-21.2, 1.2, 2.0, 0.55], [22.5, 6.5, 2.2, 0.6]];
  function heap0(x, z) {
    let h = 0;
    for (const [cx, cz, r0, hh] of HEAPS) { const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz) || 1e-6, r = r0 * (0.74 + 0.5 * noise2(dx / d * 1.6 + cx, dz / d * 1.6 + cz)), d2 = (dx * dx + dz * dz) / (r * r); if (d2 < 1) { const f = (1 - d2) * (1 - d2); h += hh * f * (0.8 + 0.2 * noise2(x * 1.9 + cx, z * 1.9 + cz)); } }
    return h;
  }
  /* Stones lying on the rubble, as Valle Morta strews them: [x, z, half-length, half-width, height, turn, the heap
     under it]. Each is drawn as a broken block, and the ground under people's feet rises over it (a low dome) so they
     walk over the stone, not through it. None stands higher than 1.2 m. */
  const ROCKS = (() => { const r = rng(4242), out = [];
    for (const [cx, cz, rr] of HEAPS) { const n = Math.round(4 + rr * 3.4);
      for (let k = 0; k < n; k++) { const a = r() * TAU, d = rr * Math.sqrt(r()) * 0.8, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, base = heap0(x, z), rx = 0.14 + 0.22 * r(), rz = rx * (0.55 + 0.6 * r()), h = Math.min(0.12 + 0.22 * r(), 1.18 - base), yaw = r() * TAU;
        if (h > 0.07) out.push([x, z, rx, rz, h, yaw, base]); } }
    return out; })();
  function heap(x, z) {
    let h = heap0(x, z);
    for (const [cx, cz, rx, rz, hh, yaw, base] of ROCKS) { const dx = x - cx, dz = z - cz; if (dx * dx + dz * dz > (rx > rz ? rx * rx : rz * rz)) continue; const c = Math.cos(yaw), s = Math.sin(yaw), lx = dx * c + dz * s, lz = -dx * s + dz * c, q = 1 - (lx * lx) / (rx * rx) - (lz * lz) / (rz * rz); if (q > 0) h = Math.max(h, base + hh * Math.sqrt(q)); }
    return h;
  }
  /* What the ground is. Cobbles and turf are each a soft-edged field (1 inside, 0 outside, wandering at the edge);
     earth is whatever is neither. The same fields draw the ground, grow the grass and choose the sound of a footstep. */
  const inRect = (x, z, r, pad = 0) => x > r[0] - pad && x < r[2] + pad && z > r[1] - pad && z < r[3] + pad;
  const rectIn = (x, z, x0, z0, x1, z1) => Math.min(x - x0, x1 - x, z - z0, z1 - z);       // how far inside a rectangle (negative outside)
  function cobbleAt(x, z) {
    let d = Math.max(rectIn(x, z, -39, -3.3, 31, 3.3), rectIn(x, z, 20.5, -12, 31, 13.6), rectIn(x, z, -24, 13.6, 31, 17.7));    // the street, the square, the back lane
    for (const ax of [-20.5, -6.5, 8.5]) d = Math.max(d, rectIn(x, z, ax - 1.6, 3, ax + 1.6, 14));                               // the alleys
    return clamp(0.5 + (d + (fbm2(x * 0.9 + 3, z * 0.9 + 9, 3) - 0.5) * 1.4) / 0.7, 0, 1);
  }
  function turfAt(x, z) {
    const d = Math.max(rectIn(x, z, -10.5, -28, 9.5, -4.2), rectIn(x, z, -39, 13.6, -24, 29), rectIn(x, z, -39, -29, -33, 29),   // the green, the west garden, the west verge
      rectIn(x, z, -39, -29, -10.5, -13.6) - (0.55 - fbm2(x * 0.3 + 1, z * 0.3 + 7, 3)) * 9);                                    // the yard behind the south row, in patches
    return clamp(0.5 + (d + (fbm2(x * 1.1 + 11, z * 1.1 + 5, 3) - 0.5) * 1.6) / 0.8, 0, 1);
  }
  const groundKind = (x, z) => (cobbleAt(x, z) > 0.5 ? 'cobble' : turfAt(x, z) > 0.5 ? 'turf' : 'dirt');
  const VERANDAS = [];   // [x0, z0, x1, z1] of each veranda, filled as the houses are built
  /* Bushes: [x, z, radius]. Leaves to look at, and a block as wide and high as the leaves, so nobody walks into one. */
  const BUSHES = [[-9.2, -7.5, 0.9], [8.2, -7, 0.8], [-9, -22, 1.0], [7.5, -17, 0.9], [-34.6, 20.5, 1.0], [-26.5, 14.6, 0.8], [-34.8, -15, 0.9], [-12.4, -24.6, 0.9], [2, -24.8, 0.8], [26.8, 3.4, 0.7], [-22.4, 12.4, 0.7], [20.2, -3.6, 0.6], [8.6, 12.5, 0.6]];

  /* ------------------------------------------------------------------ before the game reads its constants */
  function pre(G) {
    const { world, sun, sky } = G.consts, el = SUN.el * Math.PI / 180, az = SUN.az * Math.PI / 180;
    world.quayX = 1e6;                                             // no quay and no sea: the ground runs everywhere
    sun.dir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    sun.color.setRGB(1.0, 0.93, 0.8);                              // a clear morning sun
    sun.intensity = 6.4;
    sky.horizon.setRGB(0.78, 0.86, 0.98); sky.horizonAway.setRGB(0.55, 0.7, 0.95); sky.fog.setRGB(0.72, 0.8, 0.92);
    if (sky.zenith) sky.zenith.setRGB(0.2, 0.42, 0.9);
  }

  /* ------------------------------------------------------------------ textures
     Plaster, masonry, roof tiles, cobbles, turf, earth, rubble, boards and bark are the pictures made for Valle Morta
     (github.com/Leonxlnx/valle-morta, MIT; see the README). Each is three files: colour, normal, and one that holds
     occlusion (red), roughness (green) and height (blue). The number is the width in metres one picture covers. */
  const TEX = '/maps/alpine/tex/';
  const SET_DEFS = { plaster: ['plaster_old', 4], plasterD: ['plaster_damaged', 4], stone: ['stone_masonry', 4], cobble: ['cobblestone', 4], tile: ['roof_tiles', 4], wood: ['wood_planks', 2], dirt: ['dirt_mud', 4], turf: ['grass_ground', 4], rubble: ['rubble', 4], bark: ['bark_deciduous', 1] };
  async function loadTextures(G) {
    const T = G.THREE, loader = new T.TextureLoader(), aniso = Math.min(8, G.renderer.capabilities.getMaxAnisotropy ? G.renderer.capabilities.getMaxAnisotropy() : 1);
    const one = async (file, srgb, tile) => { const t = await loader.loadAsync(TEX + file + '.jpg'); t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace; t.anisotropy = aniso; t.repeat.set(1 / tile, 1 / tile); t.name = 'alp_' + file; return t; };
    const sets = {};
    await Promise.all(Object.entries(SET_DEFS).map(async ([name, [file, tile]]) => {
      const [albedo, normal, orm] = await Promise.all([one(file + '_col', true, tile), one(file + '_nrm', false, tile), one(file + '_arh', false, tile)]);
      sets[name] = { albedo, normal, orm, tile: [tile, tile], size: albedo.image.width };
    }));
    return sets;
  }
  /* Materials: a copy of one of the game's own with these textures in it, so each keeps the game's shader (its light,
     its large stains). macro = [colour variation, roughness variation, size of the variation, grime]. */
  function makeMaterials(G, sets) {
    const T = G.THREE, mats = {};
    const make = (name, set, { color = 0xffffff, nrm = 1.2, macro = [0.24, 0.1, 0.3, 0.5], double = false, cut = 0 } = {}) => {
      const src = G.mats.get('concrete', { vertexColors: true }), m = src.clone(), tx = sets[set];
      m.map = tx.albedo; m.normalMap = tx.normal; m.roughnessMap = m.metalnessMap = m.aoMap = tx.orm;
      m.color.set(color); m.roughness = 1; m.metalness = 0; m.normalScale.set(nrm, nrm); m.vertexColors = true; if (double) m.side = T.DoubleSide;
      // a cut material lies over the ground and ends where its points say so (their fourth colour number): cobbles over earth, turf over earth
      if (cut) { m.alphaTest = 0.5; m.polygonOffset = true; m.polygonOffsetFactor = -cut; m.polygonOffsetUnits = -cut * 2; }
      m.defines = { ...src.defines };
      const uniforms = { uSlWet: G.mats.uniforms.wet, uSlWetP: { value: new T.Vector4(0.3, 0.5, 0.6, 0) }, uSlMacro: { value: new T.Vector4(...macro) }, uSlUv: { value: new T.Vector3(1, 1, tx.size) }, uSlX: { value: new T.Vector2(1, 0) } };
      m.onBeforeCompile = shader => { src.onBeforeCompile(shader); Object.assign(shader.uniforms, uniforms); };
      m.customProgramCacheKey = src.customProgramCacheKey;
      m.userData = { sl: uniforms, set, tile: tx.tile };
      m.name = 'alp_' + name;
      return (mats[name] = m);
    };
    make('plaster', 'plaster', { macro: [0.16, 0.08, 0.22, 0.3] });
    make('plasterD', 'plasterD', { macro: [0.16, 0.08, 0.22, 0.3] });
    make('stone', 'stone', { nrm: 1.2, macro: [0.16, 0.08, 0.3, 0.3] });
    make('bark', 'bark', { macro: [0.2, 0.1, 0.5, 0.2] });
    make('tile', 'tile', { nrm: 1.2, macro: [0.14, 0.08, 0.3, 0.2], double: true });
    make('wood', 'wood', { macro: [0.2, 0.1, 0.5, 0.4], double: true });
    make('dirt', 'dirt', { color: 0xd8c7ab, macro: [0.22, 0.1, 0.18, 0.2] }).roughness = 3;
    make('turfC', 'turf', { macro: [0.25, 0.1, 0.15, 0.2], cut: 1 });
    make('cobbleC', 'cobble', { nrm: 1.3, macro: [0.2, 0.1, 0.2, 0.5], cut: 2 });
    make('rubbleC', 'rubble', { nrm: 1.3, macro: [0.2, 0.1, 0.3, 0.3], cut: 3 });
    const plain = (name, color, rough, metal, extra = {}) => { const m = new T.MeshStandardMaterial({ color, roughness: rough, metalness: metal, vertexColors: true, ...extra }); m.name = 'alp_' + name; return (mats[name] = m); };
    plain('dark', 0x0a0b0c, 0.9, 0);                        // the water down the well
    plain('glass', 0x1a2026, 0.08, 0.85);                   // window panes: dark, and they catch the sky
    plain('paint', 0xffffff, 0.72, 0);                      // painted shutters and doors: the colour is in the points
    plain('iron', 0x2a2623, 0.6, 0.8);
    plain('rust', 0x6a3a22, 0.85, 0.5);
    // leaves and grass: one small picture, half of it a spray of leaves on nothing, half of it plain (for the blades)
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
    const c2 = cv.getContext('2d'), rl = rng(4711);
    c2.clearRect(0, 0, 256, 128); c2.fillStyle = '#fff'; c2.fillRect(128, 0, 128, 128);
    for (let k = 0; k < 30; k++) {
      const x = 12 + rl() * 104, y = 12 + rl() * 104, len = 9 + rl() * 7, wid = len * (0.34 + 0.14 * rl()), a = rl() * TAU, g = 200 + Math.round(rl() * 55);
      c2.save(); c2.translate(x, y); c2.rotate(a);
      c2.fillStyle = `rgb(${g},${g},${g})`; c2.beginPath(); c2.moveTo(-len, 0); c2.quadraticCurveTo(0, -wid, len, 0); c2.quadraticCurveTo(0, wid, -len, 0); c2.fill();
      c2.strokeStyle = 'rgba(150,150,150,0.9)'; c2.lineWidth = 1; c2.beginPath(); c2.moveTo(-len, 0); c2.lineTo(len, 0); c2.stroke();
      c2.restore();
    }
    const leafTex = new T.CanvasTexture(cv); leafTex.colorSpace = T.SRGBColorSpace; leafTex.anisotropy = 4;
    plain('leaf', 0xffffff, 0.75, 0, { side: T.DoubleSide, map: leafTex, alphaTest: 0.5 });
    return mats;
  }

  /* ------------------------------------------------------------------ the builder: faces go into one mesh per material */
  function makeBuilder() {
    const buckets = new Map();
    const bucket = (mat, shadow) => { const k = mat + '|' + shadow; let b = buckets.get(k); if (!b) buckets.set(k, (b = { mat, shadow, p: [], n: [], u: [], c: [], a: [], i: [], nv: 0 })); return b; };
    // a flat face: points in order round it, one normal, uv per point, colour per point ([r, g, b]) or one for all
    function face(mat, pts, n, uv, col = [1, 1, 1], shadow = 'cr', alpha = null) {
      const b = bucket(mat, shadow), first = b.nv, per = Array.isArray(col[0]);
      // wind it from its normal, so it cannot face the wrong way
      let ax = 0, ay = 0, az = 0;
      for (let k = 1; k + 1 < pts.length; k++) { const e1 = [pts[k][0] - pts[0][0], pts[k][1] - pts[0][1], pts[k][2] - pts[0][2]], e2 = [pts[k + 1][0] - pts[0][0], pts[k + 1][1] - pts[0][1], pts[k + 1][2] - pts[0][2]]; ax += e1[1] * e2[2] - e1[2] * e2[1]; ay += e1[2] * e2[0] - e1[0] * e2[2]; az += e1[0] * e2[1] - e1[1] * e2[0]; }
      const flip = ax * n[0] + ay * n[1] + az * n[2] < 0;
      for (let k = 0; k < pts.length; k++) { const c = per ? col[k] : col; b.p.push(pts[k][0], pts[k][1], pts[k][2]); b.n.push(n[0], n[1], n[2]); b.u.push(uv[k][0], uv[k][1]); b.c.push(c[0], c[1], c[2]); if (alpha) b.a.push(alpha[k]); b.nv++; }
      for (let k = 1; k + 1 < pts.length; k++) flip ? b.i.push(first, first + k + 1, first + k) : b.i.push(first, first + k, first + k + 1);
    }
    return { buckets, face };
  }
  function toMeshes(G, bld, mats, root) {
    const T = G.THREE; let tris = 0, meshes = 0;
    for (const b of bld.buckets.values()) {
      if (!b.nv || !mats[b.mat]) continue;
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(b.p, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(b.n, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(b.u, 2));
      if (b.a.length === b.nv) { const c4 = new Float32Array(b.nv * 4); for (let k = 0; k < b.nv; k++) { c4[k * 4] = b.c[k * 3]; c4[k * 4 + 1] = b.c[k * 3 + 1]; c4[k * 4 + 2] = b.c[k * 3 + 2]; c4[k * 4 + 3] = b.a[k]; } g.setAttribute('color', new T.BufferAttribute(c4, 4)); }
      else g.setAttribute('color', new T.Float32BufferAttribute(b.c, 3));
      g.setIndex(b.nv > 65535 ? new T.Uint32BufferAttribute(b.i, 1) : new T.Uint16BufferAttribute(b.i, 1));
      g.computeBoundingSphere(); g.computeBoundingBox();
      const m = new T.Mesh(g, mats[b.mat]);
      m.castShadow = b.shadow.includes('c'); m.receiveShadow = b.shadow.includes('r'); m.name = 'alp:' + b.mat;
      m.matrixAutoUpdate = false; m.updateMatrix();
      root.add(m); tris += b.i.length / 3; meshes++;
    }
    return { tris, meshes };
  }

  /* ------------------------------------------------------------------ the village */
  function build(G, bld) {
    const ph = G.physics, seeded = rng(90417), spawns = [], placed = [];
    const tone = (x, y, z, t) => { const n = 0.9 + 0.2 * fbm2(x * 0.35 + z * 0.21, y * 0.35 + z * 0.17, 3), g = 0.72 + 0.28 * smooth(0, 0.9, y); return [t[0] * n * g, t[1] * n * g, t[2] * n * g]; };     // a wall is darker at its foot and never one flat colour
    /* A box that is drawn. Texture runs in world metres, so boxes that touch carry one unbroken surface.
       faces: which of w e (x), b t (y), n s (z) to draw; top: another material for the top face. */
    function draw(mat, x0, y0, z0, x1, y1, z1, { faces = 'webtns', tint = [1, 1, 1], top = null, bottom = null, shadow = 'cr', flat = false, ends = null, endFaces = '', inner = '', innerTint = null, soot = null } = {}) {
      const col0 = (x, y, z) => (flat ? tint : tone(x, y, z, tint)), col = soot ? (x, y, z) => { const c = col0(x, y, z), k = 1 - 0.82 * clamp(soot(x, y, z), 0, 1); return [c[0] * k, c[1] * k, c[2] * k]; } : col0;
      const lying = mat === 'wood' && Math.max(x1 - x0, z1 - z0) > (y1 - y0) * 1.5;        // boards run along a piece that lies flat, up one that stands
      const q = (m, pts, n, uv) => { const f = n[0] < 0 ? 'w' : n[0] > 0 ? 'e' : n[2] < 0 ? 'n' : n[2] > 0 ? 's' : '', it = inner && inner === f && innerTint; bld.face(m, pts, n, lying ? uv.map(t => [t[1], t[0]]) : uv, pts.map(p => { const c = col(p[0], p[1], p[2]); return it ? [c[0] * it[0], c[1] * it[1], c[2] * it[2]] : c; }), shadow); };
      if (faces.includes('w')) q(ends && endFaces.includes('w') ? ends : mat, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]]);
      if (faces.includes('e')) q(ends && endFaces.includes('e') ? ends : mat, [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], [1, 0, 0], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]]);
      if (faces.includes('n')) q(ends && endFaces.includes('n') ? ends : mat, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, -1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
      if (faces.includes('s')) q(ends && endFaces.includes('s') ? ends : mat, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
      if (faces.includes('t')) q(top || mat, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
      if (faces.includes('b') && y0 > 0.01) q(bottom || mat, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
    }
    // ... and one that is also there to be walked into and shot: every solid thing in the village is one of these
    const SURF = { glass: 'glass', plasterD: 'concrete', paint: 'wood', plaster: 'concrete', stone: 'concrete', cobble: 'concrete', tile: 'concrete', wood: 'wood', iron: 'metal', rust: 'metal', dark: 'glass', bark: 'wood' };
    function solid(mat, x0, y0, z0, x1, y1, z1, o = {}) {
      draw(mat, x0, y0, z0, x1, y1, z1, o);
      ph.addBox([x0, y0, z0], [x1, y1, z1], { surface: o.surface || SURF[mat] || 'concrete', ...(o.only === 'shots' ? { bulletOnly: true } : o.only === 'people' ? { playerOnly: true } : {}), ...(o.noNav ? { noNav: true } : {}) });
    }
    // every drawn thing is solid, thin things too: shutters, frames, rails and beams stop people as well as shots
    const thin = solid;

    /* ================================================================== houses
       Built the way Valle Morta builds its houses (github.com/Leonxlnx/valle-morta, src/world/bld/house.js, MIT): thick
       walls cut into a grid of cells, a damage field that takes cells away (blasts, a fallen corner, ragged tops), real
       openings dressed in stone and wood, tile roofs on rafters that can be holed or burnt to the bones. Two things are
       this game's own:
       - every wall cell is also a box the game collides with, merged with its neighbours, so a wall is solid exactly
         where it is drawn; what is out of reach (roofs, rafters, high trim, gables) stops shots as the very triangles
         it is drawn with (the HI list, tested in installPhysics);
       - nothing can be climbed that should not be: a ledge the damage leaves between 1.2 and 3.2 m is raised out of
         reach or taken down to 1.2 m (see the header of this file). */
    const ROW = 0.42, LO = 1.2, HI_Y = 3.2;
    const HI = { p: [], s: [] };
    const hiTri = (a, b, c, surface = 'concrete') => { HI.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); HI.s.push(surface); };
    const hiQuad = (P, surface) => { hiTri(P[0], P[1], P[2], surface); hiTri(P[0], P[2], P[3], surface); };
    const hiBox = (x0, y0, z0, x1, y1, z1, surface) => { const v = i => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
      for (const [a, b, c, d] of [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]]) hiQuad([v(a), v(b), v(c), v(d)], surface); };
    // drawn and stopping shots, with no box for people: for what is out of reach
    const deco = (mat, x0, y0, z0, x1, y1, z1, o = {}) => { draw(mat, x0, y0, z0, x1, y1, z1, o); if (o.hi !== false) hiBox(x0, y0, z0, x1, y1, z1, SURF[mat] || 'concrete'); };
    // what can be reached is a box for people as well
    const part = (mat, x0, y0, z0, x1, y1, z1, o = {}) => (y0 < HI_Y ? solid(mat, x0, y0, z0, x1, y1, z1, o) : deco(mat, x0, y0, z0, x1, y1, z1, o));
    /* Trim on a wall's face (stone surrounds, sills, shutters folded back against it) stands out a few centimetres:
       a player's body never comes that close to the wall, so it stops shots only. As a box for people it would be a
       ledge to stand on wherever the wall beside it has fallen: a way up to the roofs. */
    const trim = (mat, x0, y0, z0, x1, y1, z1, o = {}) => solid(mat, x0, y0, z0, x1, y1, z1, { ...o, only: 'shots' });
    const vadd = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k], vlen = a => Math.hypot(a[0], a[1], a[2]), vscale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
    const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], vnorm = a => vscale(a, 1 / (vlen(a) || 1));
    /* A box turned any way: centre C and half-extent vectors U, V, W at right angles. U is its length, and wood grain
       runs along it. Used only out of reach: near the ground nothing may be any shape the game cannot collide with. */
    function obox(mat, C, U, V, W, { tint = [1, 1, 1], shadow = 'cr', hi = true, surface } = {}) {
      for (const [A, B, Cc] of [[U, V, W], [V, W, U], [W, V, U]]) for (const sg of [1, -1]) {
        const f = vadd(C, A, sg), P = [vadd(vadd(f, B, -1), Cc, -1), vadd(vadd(f, B, 1), Cc, -1), vadd(vadd(f, B, 1), Cc, 1), vadd(vadd(f, B, -1), Cc, 1)], lb = 2 * vlen(B), lc = 2 * vlen(Cc);
        bld.face(mat, P, vnorm(vscale(A, sg)), [[0, 0], [lb, 0], [lb, lc], [0, lc]], P.map(p => tone(p[0], p[1], p[2], tint)), shadow);
        if (hi) hiQuad(P, surface || SURF[mat] || 'concrete');
      }
    }
    // a beam from p to q, w wide and h deep
    function beamPQ(mat, p, q, w, h, o = {}) {
      const half = vscale([q[0] - p[0], q[1] - p[1], q[2] - p[2]], 0.5), L = vnorm(half);
      const side = vnorm(Math.abs(L[1]) > 0.95 ? vcross(L, [1, 0, 0]) : vcross(L, [0, 1, 0])), up = vnorm(vcross(side, L));
      obox(mat, vadd(p, half), half, vscale(side, w / 2), vscale(up, h / 2), o);
    }
    const PAINTS = [[0.4, 0.66, 0.46], [0.66, 0.26, 0.2], [0.34, 0.5, 0.72], [0.56, 0.42, 0.26], [0.46, 0.64, 0.6], [0.8, 0.62, 0.32]];
    const WOOD_T = [0.84, 0.76, 0.68], CHAR_T = [0.26, 0.23, 0.21], TRIM_T = [1.18, 1.14, 1.06];

    // rows up a wall: the break points kept, the stretches between cut into rows of about `cell` (Valle Morta's lines())
    function lines(breaks, cell) {
      const b = [...new Set(breaks.map(v => Math.round(v * 1000) / 1000))].sort((x, y) => x - y), out = [b[0]];
      for (let k = 1; k < b.length; k++) { const a0 = out[out.length - 1], e = b[k]; if (e - a0 < 0.03) continue; const n = Math.max(1, Math.round((e - a0) / cell)); for (let q = 1; q <= n; q++) out.push(a0 + (e - a0) * q / n); }
      return out;
    }

    /* One wall as a grid: columns of CELL along it, rows up it. A cell is wall, an opening, gone (the damage took it)
       or above the wall's top line (a gable's slope). Then:
         - what has nothing under it falls: a cell more than three cells from wall below it, in its own row, goes;
         - no ledge between 1.2 and 3.2 m: a top left above 2.2 m is built up to 3.2 m, a lower one taken down to 1.2 m;
         - what is left is merged into as few boxes as will do, each drawn and each solid.
       Faces the damage opened show the masonry inside the wall; the wall's own faces show its plaster. */
    const WALLc = 0, HOLE = 1, GONE = 2, OUT = 3;
    function gridWall(w) {
      const { axis, a, b, at, H, gable = null, holes = [], field = null, low = true, mat, tint, soot = null, innerSide } = w;
      const n = Math.round((b - a) / CELL), peak = gable ? H + gable.rise : H;
      const topAt = u => (gable ? H + Math.max(0, gable.rise * (1 - Math.abs(u - gable.mid) / gable.half)) : H);
      const ys = lines([0, LO, HI_Y, H, peak, ...(w.breaks || []), ...holes.flatMap(h => [h.v0, h.v1])].filter(v => v >= 0 && v <= peak + 1e-6), ROW), R = ys.length - 1;
      const P = (u, y) => (axis === 'x' ? [u, y, at + WALL / 2] : [at + WALL / 2, y, u]);
      const C = [];
      for (let r = 0; r < R; r++) {
        const yc = (ys[r] + ys[r + 1]) / 2, row = [];
        for (let k = 0; k < n; k++) {
          const uc = a + (k + 0.5) * CELL; let st = yc > topAt(uc) ? OUT : WALLc;
          if (st === WALLc && holes.some(h => uc > h.u0 && uc < h.u1 && yc > h.v0 && yc < h.v1)) st = HOLE;
          if (st === WALLc && field && (low || ys[r] >= HI_Y - 1e-6)) { const p = P(uc, yc); if (field(p[0], p[1], p[2]) > 0) st = GONE; }
          row.push(st);
        }
        C.push(row);
      }
      const support = () => {
        let changed = false;
        for (let r = 1; r < R; r++) for (let k = 0; k < n;) {
          if (C[r][k] !== WALLc) { k++; continue; } let k1 = k; while (k1 + 1 < n && C[r][k1 + 1] === WALLc) k1++;
          const base = []; for (let q = k; q <= k1; q++) if (C[r - 1][q] === WALLc) base.push(q);
          for (let q = k; q <= k1; q++) { let d = 1e9; for (const s0 of base) d = Math.min(d, Math.abs(s0 - q)); if (d > 3) { C[r][q] = GONE; changed = true; } }
          k = k1 + 1;
        }
        return changed;
      };
      const ledges = () => {
        let changed = false;
        for (let k = 0; k < n; k++) for (let r = 0; r < R; r++) {
          if (C[r][k] !== WALLc || (r + 1 < R && C[r + 1][k] === WALLc)) continue;
          const y = ys[r + 1]; if (y <= LO + 1e-6 || y >= HI_Y - 1e-6) continue;
          let fill = y >= 2.2; for (let q = r + 1; q < R && ys[q] < HI_Y - 1e-6; q++) if (C[q][k] === HOLE || C[q][k] === OUT) fill = false;
          if (fill) { for (let q = r + 1; q < R && ys[q] < HI_Y - 1e-6; q++) C[q][k] = WALLc; }
          else for (let q = r; q >= 0 && ys[q + 1] > LO + 1e-6; q--) if (C[q][k] === WALLc) C[q][k] = GONE;
          changed = true;
        }
        return changed;
      };
      for (let it = 0; it < 10; it++) { const c1 = support(), c2 = ledges(); if (!c1 && !c2) break; }
      const boxes = []; let open = new Map();
      for (let r = 0; r < R; r++) {
        const next = new Map();
        for (let k = 0; k < n;) {
          if (C[r][k] !== WALLc) { k++; continue; } let k1 = k; while (k1 + 1 < n && C[r][k1 + 1] === WALLc) k1++;
          const key = k + ':' + k1, ob = open.get(key);
          if (ob) { ob.r1 = r; next.set(key, ob); } else { const nb = { k0: k, k1, r0: r, r1: r }; boxes.push(nb); next.set(key, nb); }
          k = k1 + 1;
        }
        open = next;
      }
      const gone = (r, k) => (k < 0 || k >= n ? false : C[r][k] === GONE);
      for (const bx of boxes) {
        const u0 = a + bx.k0 * CELL, u1 = a + (bx.k1 + 1) * CELL, y0 = ys[bx.r0], y1 = ys[bx.r1 + 1];
        let endL = false, endR = false; for (let r = bx.r0; r <= bx.r1; r++) { if (gone(r, bx.k0 - 1)) endL = true; if (gone(r, bx.k1 + 1)) endR = true; }
        let topOpen = bx.r1 + 1 >= R; if (!topOpen) for (let k = bx.k0; k <= bx.k1; k++) if (C[bx.r1 + 1][k] === GONE || C[bx.r1 + 1][k] === OUT) topOpen = true;
        const endFaces = axis === 'x' ? (endL ? 'w' : '') + (endR ? 'e' : '') : (endL ? 'n' : '') + (endR ? 's' : '');
        const o = { tint, soot, top: topOpen ? 'stone' : mat, bottom: 'stone', ends: endFaces ? 'stone' : null, endFaces, inner: innerSide, innerTint: [0.8, 0.78, 0.76] };
        if (axis === 'x') solid(mat, u0, y0, at, u1, y1, at + WALL, o); else solid(mat, at, y0, u0, at + WALL, y1, u1, o);
      }
      const cellAt = (u, y) => { const k = Math.floor((u - a) / CELL); if (k < 0 || k >= n || y < 0 || y >= ys[R]) return OUT; let r = 0; while (r < R - 1 && ys[r + 1] <= y) r++; return C[r][k]; };
      return { C, ys, n, R, cellAt };
    }

    /* An opening, dressed the way the village builds them: a stone surround on the face, a wooden frame in the
       reveal, and in it shutters, glass or a door, as the house's fate has left them. Only an opening the wall still
       stands round is dressed; one the damage has broken into is a breach. */
    function dressOpening(g, h, c) {
      const { axis, side, at, kind, ruin, paint, r, soot, upstairs } = c, out = side === 'n' || side === 'w' ? -1 : 1, face = out < 0 ? at : at + WALL, back = out < 0 ? at + WALL : at;
      const yM = (h.v0 + h.v1) / 2, um = (h.u0 + h.u1) / 2;
      const whole = g.cellAt(h.u0 - 0.25, yM) === WALLc && g.cellAt(h.u1 + 0.25, yM) === WALLc && (h.v0 < 0.01 || g.cellAt(um, h.v0 - 0.05) === WALLc) && g.cellAt(um, h.v1 + 0.05) === WALLc;
      if (!whole) return;
      // B(fn, mat, along0, y0, across0, along1, y1, across1): a box in the wall's own terms, `across` as world coordinates
      const B = (fn, mat, a0, y0, c0, a1, y1, c1, o = {}) => (axis === 'x' ? fn(mat, a0, y0, Math.min(c0, c1), a1, y1, Math.max(c0, c1), o) : fn(mat, Math.min(c0, c1), y0, a0, Math.max(c0, c1), y1, a1, o));
      const put = h.v0 < HI_Y ? part : deco, face0 = h.v0 < HI_Y ? trim : deco, high = h.v0 >= HI_Y, tr = { tint: TRIM_T, soot }, wd = { tint: ruin ? CHAR_T : WOOD_T, soot };
      if (h.arch) archFill(h, c, out, face, back);
      else {
        // the stone surround
        B(face0, 'stone', h.u0 - 0.14, h.v0 - (h.kind === 'door' ? 0 : 0.06), face, h.u0, h.v1 + 0.16, face + out * 0.035, tr);
        B(face0, 'stone', h.u1, h.v0 - (h.kind === 'door' ? 0 : 0.06), face, h.u1 + 0.14, h.v1 + 0.16, face + out * 0.035, tr);
        B(face0, 'stone', h.u0, h.v1, face, h.u1, h.v1 + 0.16, face + out * 0.05, tr);
        if (h.kind !== 'door') B(face0, 'stone', h.u0 - 0.1, h.v0 - 0.07, face, h.u1 + 0.1, h.v0 + 0.01, face + out * 0.07, tr);
      }
      if (h.kind === 'belfry') { for (let y = h.v0 + 0.25; y < h.v1 - 0.9; y += 0.32) B(deco, 'wood', h.u0, y, face - out * 0.18, h.u1, y + 0.06, face - out * 0.3, { tint: [0.5, 0.45, 0.4] }); return; }
      // the wooden frame in the reveal
      const f0 = face - out * 0.1, f1 = face - out * 0.18;
      if (!(ruin && r() < 0.45)) {
        B(put, 'wood', h.u0, h.v0, f0, h.u0 + 0.07, h.v1, f1, wd); B(put, 'wood', h.u1 - 0.07, h.v0, f0, h.u1, h.v1, f1, wd);
        B(put, 'wood', h.u0, h.v1 - 0.07, f0, h.u1, h.v1, f1, wd);
        if (h.kind !== 'door') B(put, 'wood', h.u0, h.v0, f0, h.u1, h.v0 + 0.06, f1, wd);
      }
      if (h.big) return;   // the wide opening: frame and surround only
      const sh = { tint: paint, soot }, shDim = { tint: vscale(paint, 0.84), soot };
      if (h.kind === 'door') {
        if (kind === 'sealed' || h.church) B(put, 'wood', h.u0 + 0.07, 0, face - out * 0.12, h.u1 - 0.07, h.v1 - 0.07, face - out * 0.17, { tint: vscale(paint, 0.75), soot });
        else if (kind === 'open') B(solid, 'wood', h.u0 + 0.08, 0, back, h.u0 + 0.13, h.v1 - 0.09, back - out * 0.82, { tint: vscale(paint, 0.75), soot });       // open, folded back against the wall inside
        return;
      }
      if (h.church) return;
      const w2 = (h.u1 - h.u0) / 2, state = upstairs && high ? 'flat' : ruin ? (high && r() < 0.35 ? 'hanging' : r() < 0.3 && !high ? 'flat' : 'none') : kind === 'sealed' && !high ? 'closed' : !high ? 'flat' : ['closed', 'angled', 'angled', 'flat'][Math.floor(r() * 4)];
      // glass, in a window that still has its frame and is not shuttered
      if (!ruin && state !== 'closed' && high && !upstairs) {
        B(deco, 'glass', h.u0 + 0.07, h.v0 + 0.06, f0 - out * 0.03, h.u1 - 0.07, h.v1 - 0.07, f0 - out * 0.05, { flat: true, tint: [1, 1, 1] });
        B(deco, 'wood', um - 0.03, h.v0 + 0.06, f0 - out * 0.02, um + 0.03, h.v1 - 0.07, f0 - out * 0.07, wd);
        B(deco, 'wood', h.u0 + 0.07, yM + 0.1, f0 - out * 0.02, h.u1 - 0.07, yM + 0.16, f0 - out * 0.07, wd);
      }
      if (state === 'closed') { B(put, 'wood', h.u0 + 0.01, h.v0 + 0.01, face - out * 0.03, um - 0.005, h.v1 - 0.01, face - out * 0.08, sh); B(put, 'wood', um + 0.005, h.v0 + 0.01, face - out * 0.03, h.u1 - 0.01, h.v1 - 0.01, face - out * 0.08, shDim); }
      else if (state === 'flat') { B(face0, 'wood', h.u0 - 0.15 - w2, h.v0, face + out * 0.04, h.u0 - 0.15, h.v1, face + out * 0.075, sh); B(face0, 'wood', h.u1 + 0.15, h.v0, face + out * 0.04, h.u1 + 0.15 + w2, h.v1, face + out * 0.075, shDim); }
      else if (state === 'angled' || state === 'hanging') {
        const nrm = axis === 'x' ? [0, 0, out] : [out, 0, 0], alongV = axis === 'x' ? [1, 0, 0] : [0, 0, 1], hgt = h.v1 - h.v0;
        for (const s of state === 'hanging' ? [r() < 0.5 ? -1 : 1] : [-1, 1]) {
          const hu = s < 0 ? h.u0 - 0.15 : h.u1 + 0.15, hinge = axis === 'x' ? [hu, h.v0, face + out * 0.03] : [face + out * 0.03, h.v0, hu];
          if (state === 'hanging') {
            const tilt = 0.5 + 0.3 * r(), up = vnorm(vadd(vscale([0, 1, 0], Math.cos(tilt)), alongV, -s * Math.sin(tilt))), top = vadd(hinge, [0, hgt, 0]);
            obox('wood', vadd(vadd(top, up, -hgt / 2), alongV, -s * w2 / 2 * Math.cos(tilt)), vscale(up, hgt / 2), vscale(vnorm(vcross(up, nrm)), w2 / 2), vscale(nrm, 0.02), sh);
          } else {
            const th = 0.9 + 0.5 * r(), d = vadd(vscale(alongV, s * Math.cos(th)), nrm, Math.sin(th));
            obox('wood', vadd(vadd(hinge, [0, hgt / 2, 0]), d, w2 / 2), [0, hgt / 2, 0], vscale(d, w2 / 2), vscale(vnorm(vcross(d, [0, 1, 0])), 0.02), s < 0 ? sh : shDim);
          }
        }
      }
    }
    // a round arch over an opening: the stone between the opening's square top and the curve, on both faces, and the soffit
    function archFill(h, c, out, face, back) {
      const { axis } = c, rad = (h.u1 - h.u0) / 2, uc = (h.u0 + h.u1) / 2, cy = h.v1 - rad, N = 12, P = (u, y, x) => (axis === 'x' ? [u, y, x] : [x, y, u]);
      const nO = axis === 'x' ? [0, 0, out] : [out, 0, 0], nI = vscale(nO, -1);
      const pt = (ang, sq) => { const cs = Math.cos(ang), sn = Math.sin(ang), m = sq ? 1 / Math.max(Math.abs(cs), Math.abs(sn)) : 1; return [uc + rad * cs * m, cy + rad * sn * m]; };
      for (let k = 0; k < N; k++) {
        const A = Math.PI * k / N, Bn = Math.PI * (k + 1) / N, c0 = pt(A, false), c1 = pt(Bn, false), b0 = pt(A, true), b1 = pt(Bn, true);
        for (const [fx, nn] of [[face, nO], [back, nI]]) { const Q = [P(c0[0], c0[1], fx), P(c1[0], c1[1], fx), P(b1[0], b1[1], fx), P(b0[0], b0[1], fx)]; bld.face('stone', Q, nn, Q.map(p => [axis === 'x' ? p[0] : p[2], p[1]]), Q.map(p => tone(p[0], p[1], p[2], TRIM_T)), 'cr'); hiQuad(Q, 'concrete'); }
        const S = [P(c0[0], c0[1], face), P(c1[0], c1[1], face), P(c1[0], c1[1], back), P(c0[0], c0[1], back)], mid = (A + Bn) / 2;
        bld.face('stone', S, axis === 'x' ? [-Math.cos(mid), -Math.sin(mid), 0] : [0, -Math.sin(mid), -Math.cos(mid)], [[0, A * rad], [0, Bn * rad], [WALL, Bn * rad], [WALL, A * rad]], S.map(p => tone(p[0], p[1], p[2], TRIM_T)), 'cr');
      }
    }

    /* A roof: two slopes of clay tiles laid on battens and rafters, with eaves that show the rafter ends, a fascia, a
       gutter and its downpipes, verge boards and a ridge. 'holed' has holes where the tiles are gone and the rafters
       show; 'skeleton' is what a fire leaves: the charred rafters and the ridge beam, a few tiles at the eaves. */
    function roof(spec, c) {
      const [x0, z0, x1, z1] = spec.at, { H, alongX, mid, halfIn, rk, r, burnt, walls } = c, t = 0.5, over = 0.45, verge = 0.3, half = halfIn + over;
      const ry = H + 0.14 + halfIn * t, A0 = (alongX ? x0 : z0) - verge, A1 = (alongX ? x1 : z1) + verge, Ai0 = (alongX ? x0 : z0) + WALL, Ai1 = (alongX ? x1 : z1) - WALL;
      const pt = (A, d, sg, lift = 0) => (alongX ? [A, ry - d * t + lift, mid + sg * d] : [mid + sg * d, ry - d * t + lift, A]);
      const holes = spec.roofHoles || [], sk = rk === 'skeleton';
      const gone = (A, d, sg) => { const p = pt(A, d, sg); if (sk) return !(d > half - 1.1 && noise2(A * 0.9 + sg * 7, 3.3) > 0.62); let v = -1; for (const [hx, hz, hr] of holes) v = Math.max(v, 1 - Math.hypot(p[0] - hx, p[2] - hz) / hr); return v + 0.35 * (noise2(p[0] * 1.7, p[2] * 1.7) - 0.5) > 0; };
      const tileT = vscale([1, 1, 1], 0.82 + 0.24 * r()), na = Math.round((A1 - A0) / 0.6), nd = Math.ceil(half / 0.55);
      const supported = A => walls.every(w => !w.long || w.g.cellAt(Math.min(Ai1 - 0.01, Math.max(Ai0 + 0.01, A)), H - 0.1) === WALLc);      // the roof needs the eaves walls under it
      for (const sg of [-1, 1]) {
        const nrm = vnorm(alongX ? [0, 1, sg * t] : [sg * t, 1, 0]), sl = Math.hypot(1, t);
        for (let j = 0; j < nd; j++) {
          const d0 = half * j / nd, d1 = half * (j + 1) / nd, dm = (d0 + d1) / 2, ok = i => { const Ac = A0 + (i + 0.5) * (A1 - A0) / na; return !gone(Ac, dm, sg) && supported(Ac); };
          for (let i = 0; i < na;) {
            if (!ok(i)) { i++; continue; } let i1 = i; while (i1 + 1 < na && ok(i1 + 1)) i1++;
            const As = A0 + i * (A1 - A0) / na, Ae = A0 + (i1 + 1) * (A1 - A0) / na, Q = [pt(As, d0, sg), pt(Ae, d0, sg), pt(Ae, d1, sg), pt(As, d1, sg)], uv = [[As, d0 * sl], [Ae, d0 * sl], [Ae, d1 * sl], [As, d1 * sl]];
            bld.face('tile', Q, nrm, uv, Q.map(() => vscale(tileT, j === nd - 1 ? 0.86 : 1)), 'cr'); hiQuad(Q, 'concrete');
            bld.face('wood', Q.map(p => [p[0], p[1] - 0.05, p[2]]), vscale(nrm, -1), uv, Q.map(() => [0.5, 0.46, 0.42]), 'r');
            i = i1 + 1;
          }
        }
        // rafters under it all, where they can be seen, and their ends under the eaves
        for (let A = Ai0 + 0.25; A < Ai1 - 0.1; A += 0.6) {
          if (!supported(A)) continue;
          if (rk !== 'intact' && !(sk && r() < 0.18)) { const brk = sk && r() < 0.3 ? 0.25 + 0.5 * r() : 0; beamPQ('wood', pt(A, halfIn - 0.05, sg, -0.14), pt(A, brk ? halfIn * (1 - brk) : 0.06, sg, -0.14), 0.1, 0.16, { tint: sk || burnt > 0.3 ? CHAR_T : [0.56, 0.48, 0.42] }); }
          if (!sk) beamPQ('wood', pt(A, halfIn - 0.3, sg, -0.12), pt(A, half - 0.03, sg, -0.12), 0.08, 0.12, { tint: [0.62, 0.55, 0.48] });
        }
        if (sk) continue;
        // fascia and gutter along the eaves, a downpipe at each end
        const ye = ry - half * t, ec = mid + sg * half;
        if (alongX) { deco('wood', A0, ye - 0.22, Math.min(ec, ec + sg * 0.03), A1, ye + 0.02, Math.max(ec, ec + sg * 0.03), { tint: [0.6, 0.54, 0.48] }); deco('iron', A0 + 0.1, ye - 0.3, Math.min(ec + sg * 0.03, ec + sg * 0.15), A1 - 0.1, ye - 0.2, Math.max(ec + sg * 0.03, ec + sg * 0.15), { flat: true, tint: [0.62, 0.6, 0.58] }); }
        else { deco('wood', Math.min(ec, ec + sg * 0.03), ye - 0.22, A0, Math.max(ec, ec + sg * 0.03), ye + 0.02, A1, { tint: [0.6, 0.54, 0.48] }); deco('iron', Math.min(ec + sg * 0.03, ec + sg * 0.15), ye - 0.3, A0 + 0.1, Math.max(ec + sg * 0.03, ec + sg * 0.15), ye - 0.2, A1 - 0.1, { flat: true, tint: [0.62, 0.6, 0.58] }); }
        if (!spec.church) for (const Ap of [Ai0 - WALL + 0.25, Ai1 + WALL - 0.34]) {
          const wf = mid + sg * halfIn, p0 = Math.min(wf + sg * 0.03, wf + sg * 0.12), p1 = Math.max(wf + sg * 0.03, wf + sg * 0.12);
          if (alongX) part('iron', Ap, 0, p0, Ap + 0.09, ye - 0.25, p1, { flat: true, tint: [0.55, 0.53, 0.5] }); else part('iron', p0, 0, Ap, p1, ye - 0.25, Ap + 0.09, { flat: true, tint: [0.55, 0.53, 0.5] });
        }
        // verge boards along the gable edges
        for (const Ae of [A0 + 0.02, A1 - 0.02]) beamPQ('wood', pt(Ae, 0, sg, -0.02), pt(Ae, half, sg, -0.02), 0.04, 0.22, { tint: [0.6, 0.54, 0.48] });
      }
      // the ridge: the tiles over it, or the bare beam
      if (sk) { if (r() < 0.8) beamPQ('wood', pt(Ai0 + 0.2, 0.02, 1, -0.2), pt(Ai1 - 0.6 - 2 * r(), 0.02, 1, -0.2), 0.16, 0.2, { tint: CHAR_T }); return; }
      if (rk !== 'intact') beamPQ('wood', pt(Ai0, 0.02, 1, -0.22), pt(Ai1, 0.02, 1, -0.22), 0.16, 0.2, { tint: [0.56, 0.5, 0.44] });
      beamPQ('tile', pt(A0, 0, 1, 0.04), pt(A1, 0, 1, 0.04), 0.26, 0.12, { tint: vscale(tileT, 0.8) });
      // gables: the wall goes on up under the roof, as the triangle it is, inside and out
      for (const [e, dir] of [[alongX ? x0 : z0, -1], [alongX ? x1 : z1, 1]]) {
        for (const [fx, nd2] of [[e, dir], [e - dir * WALL, -dir]]) {
          const tri = [pt(fx, halfIn, -1, -0.16), pt(fx, halfIn, 1, -0.16), pt(fx, 0, 1, -0.16)].map(p => (alongX ? [fx, p[1], p[2]] : [p[0], p[1], fx]));
          tri[0][1] = tri[1][1] = H;
          bld.face(c.mat, tri, alongX ? [nd2, 0, 0] : [0, 0, nd2], tri.map(p => [alongX ? p[2] : p[0], p[1]]), tri.map(p => tone(p[0], p[1], p[2], nd2 === dir ? c.tint : vscale(c.tint, 0.8))), 'cr'); hiTri(tri[0], tri[1], tri[2], 'concrete');
        }
      }
      // a chimney
      const ca = lerp(Ai0 + 1, Ai1 - 1, 0.25 + 0.5 * r()), cp = pt(ca, 0.9, 1), cyb = ry - 0.9 * t - 0.6;
      deco('stone', cp[0] - 0.32, cyb, cp[2] - 0.32, cp[0] + 0.32, ry + 0.75, cp[2] + 0.32, { tint: c.tint });
      deco('stone', cp[0] - 0.4, ry + 0.75, cp[2] - 0.4, cp[0] + 0.4, ry + 0.87, cp[2] + 0.4, { tint: TRIM_T });
    }

    /* A house. */
    function house(spec) {
      const [x0, z0, x1, z1] = spec.at, tint = spec.tint, kind = spec.kind, ruin = kind === 'ruin', r = rng(Math.floor(hash(x0 * 7, z0 * 13) * 1e9));
      const floors = spec.floors || 2, H = spec.tall || [0, F1, F2, F3][floors], edge = !inRect((x0 + x1) / 2, (z0 + z1) / 2, [PLAY.x0, PLAY.z0, PLAY.x1, PLAY.z1]);
      const D = spec.damage || {}, sx = (spec.seed || 1) * 0.37, amp = D.amp ?? 0.45, rag = D.rag ?? 0.6, rk = spec.roof || (ruin ? 'none' : 'intact');
      const alongX = spec.ridge !== 'z', mid = alongX ? (z0 + z1) / 2 : (x0 + x1) / 2, halfIn = (alongX ? z1 - z0 : x1 - x0) / 2;
      // the damage field (Valle Morta's makeField): above zero is gone
      const broken = D.top != null || !!D.collapse, blasts = D.blasts || [];
      const hb = (x, z) => { let h = D.top ?? H * 1.2 + 1.5; if (D.collapse) { const q = D.collapse, dx = x - q.x, dz = z - q.z; h -= q.depth * Math.exp(-(dx * dx + dz * dz) / (2 * q.sigma * q.sigma)); }
        return h + rag * (3 * (noise2(x * 0.33 + sx, z * 0.33) - 0.5) + 1.2 * (noise2(x * 1.1, z * 1.1 + sx) - 0.5)); };
      const field = broken || blasts.length ? (x, y, z) => {
        let v = broken ? (y - hb(x, z)) / 1.3 : -9;
        for (const [bx, by, bz, br] of blasts) { const q = 1 - Math.hypot(x - bx, y - by, z - bz) / br; if (q > v) v = q; }
        return v + amp * ((noise3(x * 0.8 + sx, y * 0.8, z * 0.8) - 0.5) + 0.48 * (noise3(x * 2.3, y * 2.3 + sx, z * 2.3) - 0.5));
      } : null;
      const burnt = D.burnt || 0;
      const soot = burnt || blasts.length ? (x, y, z) => { let s = burnt * smooth(H * 0.2, H, y) * (0.5 + 0.5 * noise3(x * 0.6, y * 0.6, z * 0.6));
        for (const [bx, by, bz, br] of blasts) s = Math.max(s, 0.9 * (1 - Math.hypot(x - bx, y - by, z - bz) / (br * 2.0)));
        return s; } : null;
      const mat = spec.stone ? 'stone' : ruin || burnt > 0.3 ? 'plasterD' : 'plaster';
      const paint = PAINTS[Math.floor(hash(x0 * 3 + 1, z0 * 5 + 2) * PAINTS.length)];
      const levels = [0, F1, F2, F3].slice(0, floors);
      const walls = [];
      for (const [axis, a, b, at, side, innerSide] of [['x', x0, x1, z0, 'n', 's'], ['x', x0, x1, z1 - WALL, 's', 'n'], ['z', z0 + WALL, z1 - WALL, x0, 'w', 'e'], ['z', z0 + WALL, z1 - WALL, x1 - WALL, 'e', 'w']]) {
        const len = b - a, long = (axis === 'x') === alongX, holes = [];
        // an edge house has openings only on the side that looks in over the village
        const faces = !edge || (side === 'n' && z0 >= 17) || (side === 's' && z1 <= -25) || (side === 'e' && x1 <= -35) || (side === 'w' && x0 >= 27);
        const bays = Math.max(1, Math.floor((len - 1.5) / 2.75)), step = len / bays;
        const doorBay = spec.church ? (side === 'w' ? Math.floor(bays / 2) : -1) : long && (side === 'n' || side === 's') ? Math.floor(bays / 2) : -1;
        if (faces) for (let i = 0; i < bays; i++) {
          const cu = Math.round((a + (i + 0.5) * step) / CELL) * CELL;
          if (spec.id === 'tower') { if (i === Math.floor(bays / 2)) holes.push({ u0: cu - 0.5, u1: cu + 0.5, v0: H - 4.4, v1: H - 1.6, kind: 'belfry', arch: true }); continue; }
          if (spec.church) { if (i === doorBay) holes.push({ u0: cu - 0.5, u1: cu + 0.5, v0: 0, v1: 3.0, kind: 'door', arch: true, church: true }); else if (long) holes.push({ u0: cu - 0.5, u1: cu + 0.5, v0: 3.4, v1: 6.2, kind: 'win', arch: true, church: true }); continue; }
          if (!(spec.noWin && spec.noWin.includes(side + i))) holes.push(i === doorBay ? { u0: cu - 0.5, u1: cu + 0.5, v0: 0, v1: 2.1, kind: 'door' } : { u0: cu - 0.5, u1: cu + 0.5, v0: 1.0, v1: 2.2, kind: 'win' });
          for (let f = 1; f < floors; f++) if (!(f === 1 && spec.bigWin === side)) holes.push({ u0: cu - 0.5, u1: cu + 0.5, v0: levels[f] + 0.9, v1: levels[f] + 2.1, kind: 'win', up: true });
        }
        // a first floor that looks out through one wide opening; a doorway more
        if (faces && spec.bigWin === side) { const mu = Math.round((a + b) / 2 / CELL) * CELL; holes.push({ u0: mu - 2.5, u1: mu + 2.5, v0: F1 + 0.9, v1: F1 + 2.1, kind: 'win', up: true, big: true }); }
        for (const [sd, u] of spec.extraDoors || []) if (sd === side) holes.push({ u0: u - 0.5, u1: u + 0.5, v0: 0, v1: 2.1, kind: 'door' });
        const gable = !long && (rk === 'none' || rk === 'skeleton') && spec.ridge !== 'spire' ? { mid, half: halfIn, rise: halfIn * 0.5 + 0.14 } : null;
        const g = gridWall({ axis, a, b, at, H, gable, holes, field, low: ruin, mat, tint, soot, innerSide, breaks: levels });
        walls.push({ g, axis, a, b, at, side, long, holes });
        for (const h of holes) dressOpening(g, h, { axis, side, at, kind, ruin, paint, r, soot, upstairs: !!spec.upstairs });
      }
      // stone quoins at the corners, where the corner still stands
      if (spec.quoins) for (const [cx, cz, sxn, szn, wi] of [[x0, z0, 1, 1, 0], [x1, z0, -1, 1, 0], [x0, z1, 1, -1, 1], [x1, z1, -1, -1, 1]]) {
        const gw = walls[wi].g, uc = cx + sxn * 0.25;
        for (let y = 0, k = 0; y < H - 0.05; y += 0.34, k++) {
          if (gw.cellAt(uc, y + 0.17) !== WALLc) break;
          const la = k % 2 ? 0.34 : 0.62, lb = k % 2 ? 0.62 : 0.34, y1 = Math.min(H, y + 0.32), q = { tint: TRIM_T, hi: false, soot };
          deco('stone', Math.min(cx, cx + sxn * la), y, Math.min(cz, cz - szn * 0.025), Math.max(cx, cx + sxn * la), y1, Math.max(cz, cz - szn * 0.025), q);
          deco('stone', Math.min(cx, cx - sxn * 0.025), y, Math.min(cz, cz + szn * lb), Math.max(cx, cx - sxn * 0.025), y1, Math.max(cz, cz + szn * lb), q);
        }
      }
      // a band of stone between the storeys, along the faces that still stand
      if (!ruin && !spec.church && spec.id !== 'tower') for (const w of walls) {
        const out = w.side === 'n' || w.side === 'w' ? -1 : 1, face = out < 0 ? w.at : w.at + WALL;
        for (let f = 1; f < floors; f++) {
          const y = levels[f] - 0.12;
          for (let u = w.a; u < w.b - 0.01;) {
            if (w.g.cellAt(u + 0.25, y + 0.1) !== WALLc) { u += CELL; continue; } let u1 = u + CELL; while (u1 < w.b - 0.01 && w.g.cellAt(u1 + 0.25, y + 0.1) === WALLc) u1 += CELL;
            if (w.axis === 'x') deco('stone', u, y, Math.min(face, face + out * 0.05), u1, y + 0.2, Math.max(face, face + out * 0.05), { tint: TRIM_T, hi: false, soot }); else deco('stone', Math.min(face, face + out * 0.05), y, u, Math.max(face, face + out * 0.05), y + 0.2, u1, { tint: TRIM_T, hi: false, soot });
            u = u1;
          }
        }
      }
      // inside: floors and ceilings where there are storeys
      const ix0 = x0 + WALL, ix1 = x1 - WALL, iz0 = z0 + WALL, iz1 = z1 - WALL;
      if (spec.upstairs) {
        /* A house to fight from: a stair against its blind west wall, the upper floor open over it, and a room whose
           windows look over the street and the back lane. A player can vault out of them and drop to the street.
           Up here the same rule holds as below, measured from this floor: nothing to stand on within reach above it
           (no handrail: it was a step to the window heads and from there to the roofs). */
        const sx0 = ix0, sx1 = ix0 + 0.95, sz0 = iz0 + 0.7, run = 0.3, rise = 0.25, n = Math.round(F1 / rise), sz1 = sz0 + n * run, fl = { tint: [0.62, 0.56, 0.5] };
        for (let k = 0; k < n; k++) solid('wood', sx0, 0, sz0 + k * run, sx1, rise * (k + 1), sz0 + (k + 1) * run, { tint: k % 2 ? [0.7, 0.63, 0.55] : [0.64, 0.58, 0.51] });
        solid('wood', ix0, F1 - 0.22, iz0, sx1, F1, sz0, fl); solid('wood', ix0, F1 - 0.22, sz1, sx1, F1, iz1, fl); solid('wood', sx1, F1 - 0.22, iz0, ix1, F1, iz1, fl);
        for (let x = ix0 + 0.7; x < ix1 - 0.4; x += 1.4) solid('wood', x, F1 - 0.4, x < sx1 + 0.1 ? sz1 : iz0, x + 0.16, F1 - 0.22, iz1, { tint: [0.56, 0.5, 0.44] });
        if (floors > 2) solid('wood', ix0, F2 - 0.22, iz0, ix1, F2, iz1, { tint: [0.5, 0.46, 0.42], faces: 'tb' });   // the second floor is the room's ceiling
        else solid('wood', ix0, H - 0.06, iz0, ix1, H, iz1, { tint: [0.5, 0.46, 0.42], faces: 'b' });
      } else if (!ruin && !spec.church && spec.id !== 'tower') {
        for (let f = 1; f < floors; f++) solid('wood', ix0, levels[f] - 0.22, iz0, ix1, levels[f], iz1, { tint: [0.62, 0.56, 0.5], faces: 'tb' });
        if (rk === 'intact' || rk === 'holed') deco('wood', ix0, H - 0.04, iz0, ix1, H, iz1, { tint: [0.5, 0.46, 0.42], faces: 'b' });
        for (let x = ix0 + 0.7; x < ix1 - 0.4; x += 1.4) solid('wood', x, F1 - 0.4, iz0, x + 0.16, F1 - 0.22, iz1, { tint: [0.56, 0.5, 0.44] });
      }
      if (spec.floor) {
        // joists from one eaves wall to the other wherever both still stand at the floor, and boards on them, with holes
        const lw = walls.filter(w => w.long), ok = A => lw.every(w => w.g.cellAt(A, F1 - 0.1) === WALLc);
        const lo = alongX ? ix0 : iz0, hiA = alongX ? ix1 : iz1, qlo = alongX ? iz0 : ix0, qhi = alongX ? iz1 : ix1;
        for (let A = lo + 0.3; A < hiA - 0.2; A += 0.6) {
          if (!ok(A) || !ok(A + 0.16)) continue;
          if (alongX) solid('wood', A, F1 - 0.24, iz0, A + 0.16, F1 - 0.04, iz1, { tint: CHAR_T }); else solid('wood', ix0, F1 - 0.24, A, ix1, F1 - 0.04, A + 0.16, { tint: CHAR_T });
        }
        const board = (A, q) => { const x = alongX ? A + 0.3 : q + 0.12, z = alongX ? q + 0.12 : A + 0.3; return ok(A + 0.3) && noise2(x * 0.7 + 5, z * 0.7) < 0.55 && heap(x, z) < 0.15; };
        for (let q = qlo; q < qhi - 0.01; q += 0.25) {
          const q1 = Math.min(q + 0.25, qhi) - 0.01;
          for (let A = lo; A < hiA - 0.01;) {
            if (!board(A, q)) { A += 0.6; continue; } let A1 = A + 0.6; while (A1 < hiA - 0.01 && board(A1, q)) A1 += 0.6; A1 = Math.min(A1, hiA);
            if (alongX) solid('wood', A, F1 - 0.04, q, A1, F1 + 0.01, q1, { tint: [0.4, 0.36, 0.33] }); else solid('wood', q, F1 - 0.04, A, q1, F1 + 0.01, A1, { tint: [0.4, 0.36, 0.33] });
            A = A1;
          }
        }
      }
      if (ruin && !spec.floor) {
        // the floor is gone; the stubs of its joists still stand out of the walls, burnt off. Their tops are at 3.2 m,
        // out of reach, and nothing lower stands under them
        for (const w of walls.filter(w => w.long && w.side !== spec.veranda)) {
          const into = w.side === 'n' || w.side === 'w' ? 1 : -1, inner = into > 0 ? w.at + WALL : w.at;
          for (let A = w.a + 0.75; A < w.b - 0.75; A += 0.6) {
            if (w.g.cellAt(A, F1 + 0.1) !== WALLc || w.g.cellAt(A + 0.16, F1 + 0.1) !== WALLc || r() > 0.6) continue;
            if (spec.veranda === 'e' && w.side === 's' && A > ix1 - 1.5 - 3.9) continue;   // none over the stair to the veranda
            const L = 0.35 + 0.8 * r(), c0 = Math.min(inner, inner + into * L), c1 = Math.max(inner, inner + into * L);
            if (w.axis === 'x') solid('wood', A, F1 - 0.02, c0, A + 0.16, HI_Y, c1, { tint: CHAR_T }); else solid('wood', c0, F1 - 0.02, A, c1, HI_Y, A + 0.16, { tint: CHAR_T });
          }
        }
      }
      if (spec.veranda) {
        /* A veranda: boards 1.5 m deep along one wall at the first floor, on joists out of the wall, and a stair up to
           them. Nothing else is up there. Its top is 3.0 m, under the 3.15 m over which every open top is capped for
           players, so from it a player can look out, jump down or vault out of a window. */
        const dep = 1.5, wd = { tint: [0.6, 0.54, 0.47] }, n = Math.round(F1 / 0.25), run = 0.3, tone = k => ({ tint: k % 2 ? [0.62, 0.56, 0.49] : [0.56, 0.5, 0.44] });
        if (spec.veranda === 'e') {
          const xa = ix1 - dep;
          VERANDAS.push([xa, iz0, ix1, iz1]);   // the caps leave the low wall tops round the boards open (below)
          solid('wood', xa, F1 - 0.06, iz0, ix1, F1, iz1, wd);
          for (let z = iz0 + 0.4; z < iz1 - 0.2; z += 1.2) solid('wood', xa, F1 - 0.3, z, ix1, F1 - 0.06, z + 0.16, { tint: CHAR_T });
          for (let k = 0; k < n; k++) { const a0 = xa - (n - k) * run; solid('wood', a0, 0, iz1 - 0.95, a0 + run, 0.25 * (k + 1), iz1, tone(k)); }   // up along the back wall
        } else {
          const south = spec.veranda === 's', za = south ? iz1 - dep : iz0, zb = south ? iz1 : iz0 + dep;
          VERANDAS.push([ix0, za, ix1, zb]);
          solid('wood', ix0, F1 - 0.06, za, ix1, F1, zb, wd);
          for (let x = ix0 + 0.4; x < ix1 - 0.2; x += 1.2) solid('wood', x, F1 - 0.3, za, x + 0.16, F1 - 0.06, zb, { tint: CHAR_T });
          for (let k = 0; k < n; k++) { const a0 = south ? za - (n - k) * run : zb + (n - k - 1) * run; solid('wood', ix0, 0, a0, ix0 + 0.95, 0.25 * (k + 1), a0 + run, tone(k)); }   // up along the west wall
        }
      }
      if (rk !== 'none' && spec.ridge !== 'spire') roof(spec, { H, alongX, mid, halfIn, rk, r, burnt, walls, mat, tint });
      if (spec.ridge === 'spire') {
        // a four-sided spire of slate over a stone ledge, with an iron cross
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hw = (x1 - x0) / 2 + 0.3, y = H, tip = y + 6.5;
        deco('stone', x0 - 0.2, y, z0 - 0.2, x1 + 0.2, y + 0.25, z1 + 0.2, { tint: TRIM_T });
        for (const [ax, az] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const A = [cx + (ax - az) * hw, y + 0.25, cz + (az + ax) * hw], Bp = [cx + (ax + az) * hw, y + 0.25, cz + (az - ax) * hw], Q = [A, Bp, [cx, tip, cz]];
          const sl = Math.hypot(hw, tip - y); bld.face('tile', Q, [ax * (tip - y) / sl, hw / sl, az * (tip - y) / sl], [[0, 0], [hw * 2, 0], [hw, sl]], [[0.5, 0.52, 0.58], [0.5, 0.52, 0.58], [0.42, 0.44, 0.5]], 'cr'); hiTri(Q[0], Q[1], Q[2]);
        }
        deco('iron', cx - 0.03, tip, cz - 0.03, cx + 0.03, tip + 1.0, cz + 0.03, { flat: true, tint: [0.4, 0.4, 0.4] }); deco('iron', cx - 0.3, tip + 0.6, cz - 0.03, cx + 0.3, tip + 0.66, cz + 0.03, { flat: true, tint: [0.4, 0.4, 0.4] });
      }
      // a wooden balcony on the first floor
      if (spec.balcony) {
        const south = spec.balcony === 's', zf = south ? z1 : z0, out = south ? 1 : -1, bx0 = lerp(x0, x1, 0.22), bx1 = lerp(x0, x1, 0.78), bm = { tint: WOOD_T };
        const zr = (p, q) => [Math.min(zf + out * p, zf + out * q), Math.max(zf + out * p, zf + out * q)];
        { const [za, zb] = zr(0, 1.1); part('wood', bx0, F1 + 0.3, za, bx1, F1 + 0.42, zb, bm); }
        for (let x = bx0; x <= bx1 + 0.01; x += (bx1 - bx0) / 4) { const [pa, pb] = zr(1.02, 1.1), [ka, kb] = zr(0, 0.9); part('wood', x - 0.06, F1 + 0.42, pa, x + 0.06, F1 + 1.4, pb, bm); part('wood', x - 0.06, F1 - 0.5, ka, x + 0.06, F1 + 0.3, kb, bm); }
        { const [ra, rb] = zr(1.0, 1.12); part('wood', bx0, F1 + 1.32, ra, bx1, F1 + 1.4, rb, bm); }
        for (let x = bx0 + 0.18; x < bx1; x += 0.22) { const [ba, bb] = zr(1.04, 1.08); part('wood', x, F1 + 0.42, ba, x + 0.07, F1 + 1.32, bb, bm); }
      }
      placed.push({ name: 'house:' + spec.id, x: (x0 + x1) / 2, y: 0, z: (z0 + z1) / 2, yaw: 0 });
    }
    for (const h of HOUSES) house(h);
    const beam = (x0, y0, z0, x1, y1, z1, o = {}) => solid('wood', x0, y0, z0, x1, y1, z1, { tint: [0.7, 0.64, 0.58], ...o });

    /* ---- the rubble: on every heap broken blocks of masonry (the ground rises over each, see ROCKS), shards of roof
       tile, and on the heaps of the burnt houses a charred beam or two, half buried */
    const heapN = (x, z) => { const e = 0.08, gx = (heap0(x + e, z) - heap0(x - e, z)) / (2 * e), gz = (heap0(x, z + e) - heap0(x, z - e)) / (2 * e); return vnorm([-gx, 1, -gz]); };
    for (const [x, z, rx, rz, h, yaw, base] of ROCKS) {
      const c = Math.cos(yaw), s = Math.sin(yaw), k = 0.55 + 0.15 * seeded(), t = 0.82 + 0.32 * seeded(), y0 = base - 0.06, y1 = base + h;
      const at = (lx, lz, y, j) => [x + (lx * c - lz * s) * (1 + (seeded() - 0.5) * j), y, z + (lx * s + lz * c) * (1 + (seeded() - 0.5) * j)];
      const Bt = [at(-rx, -rz, y0, 0.2), at(rx, -rz, y0, 0.2), at(rx, rz, y0, 0.2), at(-rx, rz, y0, 0.2)], Tp = [at(-rx * k, -rz * k, y1, 0.3), at(rx * k, -rz * k, y1 - 0.03, 0.3), at(rx * k, rz * k, y1, 0.3), at(-rx * k, rz * k, y1 - 0.02, 0.3)];
      const tint = [t * 1.04, t, t * 0.94], fc = P => bld.face('stone', P, vnorm(vcross([P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]])), P.map(p => [p[0] + p[1], p[2] + p[1]]), P.map(() => tint), 'cr');
      fc([Tp[0], Tp[3], Tp[2], Tp[1]]); for (let i = 0; i < 4; i++) fc([Bt[i], Bt[(i + 1) % 4], Tp[(i + 1) % 4], Tp[i]]);
    }
    for (const [cx, cz, rr] of HEAPS) {
      for (let k = 0; k < Math.round(rr * 9); k++) {
        const a = seeded() * TAU, d = rr * Math.sqrt(seeded()) * 0.9, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, n = heapN(x, z), sz = 0.1 + 0.14 * seeded(), yaw = seeded() * TAU;
        const u = vnorm(vcross(n, [Math.sin(yaw), 0, Math.cos(yaw)])), v = vcross(n, u), C = [x, heap0(x, z) + 0.012, z], sh = seeded() < 0.6 ? 'tile' : 'stone', t = 0.8 + 0.3 * seeded();
        const P = [vadd(vadd(C, u, -sz), v, -sz * 0.7), vadd(vadd(C, u, sz), v, -sz * 0.7), vadd(vadd(C, u, sz * 0.8), v, sz * 0.7), vadd(vadd(C, u, -sz), v, sz * 0.6)];
        bld.face(sh, P, n, P.map(p => [p[0], p[2]]), P.map(() => [t, t * 0.96, t * 0.92]), 'r');
      }
    }
    for (const [cx, cz, rr] of [[-14.6, 9.2, 2.3], [15.4, 8.6, 2.6], [-16.4, -8.8, 2.1], [-12.2, -5.0, 2.6]]) for (let k = 0; k < 2; k++) {
      const a = seeded() * TAU, p = [cx + Math.cos(a) * rr * 0.2, 0, cz + Math.sin(a) * rr * 0.2], q = [cx + Math.cos(a + 0.4) * rr * 1.05, 0, cz + Math.sin(a + 0.4) * rr * 1.05];
      p[1] = heap0(p[0], p[2]) - 0.05; q[1] = heap0(q[0], q[2]) - 0.02; beamPQ('wood', p, q, 0.16, 0.16, { tint: CHAR_T, hi: false });
    }
    for (const [x0, z0, x1, z1] of EDGE_WALLS) { const a = Math.min(x0, x1), b = Math.max(x0, x1), c = Math.min(z0, z1), d = Math.max(z0, z1); solid('stone', a, 0, c, b, 3.2, d, { tint: [1.0, 0.98, 0.94] }); solid('stone', a - 0.06, 3.2, c - 0.06, b + 0.06, 3.32, d + 0.06, { tint: [0.85, 0.85, 0.83] }); }

    /* ---- what stands in the streets: all of it boxes, none taller than 1.2 m, so nothing is a step to a roof */
    const post = (x, z, h = 1.1, w = 0.07) => solid('wood', x - w, 0, z - w, x + w, h, z + w, { tint: [0.5, 0.46, 0.42] });
    // a paling fence along x or z: posts and two rails stop people, shots go between the pales
    function fence(x0, z0, x1, z1, gapAt = null) {
      const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0), a = alongX ? Math.min(x0, x1) : Math.min(z0, z1), b = alongX ? Math.max(x0, x1) : Math.max(z0, z1), at = alongX ? z0 : x0;
      for (let u = a; u <= b + 0.01; u += 2) alongX ? post(u, at) : post(at, u);
      for (let u = a; u < b - 0.01; u += 2) {
        const u1 = Math.min(b, u + 2); if (gapAt != null && u <= gapAt && u1 > gapAt) continue;
        for (const y of [0.35, 0.85]) alongX ? thin('wood', u, y, at - 0.03, u1, y + 0.09, at + 0.03, { tint: [0.52, 0.48, 0.44] }) : thin('wood', at - 0.03, y, u, at + 0.03, y + 0.09, u1, { tint: [0.52, 0.48, 0.44] });
        ph.addBox(alongX ? [u, 0, at - 0.06] : [at - 0.06, 0, u], alongX ? [u1, 1.08, at + 0.06] : [at + 0.06, 1.08, u1], { surface: 'wood', playerOnly: true });
        for (let p = u + 0.14; p < u1 - 0.05; p += 0.2) { const h = 0.95 + 0.12 * hash(p * 50, at * 31); alongX ? solid('wood', p, 0.05, at + 0.03, p + 0.1, h, at + 0.055, { tint: [0.6, 0.56, 0.5], only: 'shots' }) : solid('wood', at + 0.03, 0.05, p, at + 0.055, h, p + 0.1, { tint: [0.6, 0.56, 0.5], only: 'shots' }); }
      }
    }
    fence(-10, -5, 9, -5, 0); fence(-10, -5, -10, -14); fence(9, -5, 9, -12);              // round the green, open to the street in the middle
    fence(-36, 13.6, -24.5, 13.6, -30);                                                    // the west garden
    // the well on the green: a square kerb of stone with a timber frame over it
    { const x = -1, z = -14; for (const [a, b, c, d] of [[x - 1, z - 1, x + 1, z - 0.7], [x - 1, z + 0.7, x + 1, z + 1], [x - 1, z - 0.7, x - 0.7, z + 0.7], [x + 0.7, z - 0.7, x + 1, z + 0.7]]) solid('stone', a, 0, b, c, 0.9, d, {});
      solid('dark', x - 0.7, 0, z - 0.7, x + 0.7, 0.3, z + 0.7, { flat: true }); post(x - 0.85, z, 3.0, 0.07); post(x + 0.85, z, 3.0, 0.07); beam(x - 1.0, 3.0, z - 0.08, x + 1.0, 3.14, z + 0.08); }
    // across the street, what was being carried when the fighting came: a stack of sawn beams, and crates beside it
    { const x = -14, z = 0.4;
      for (let layer = 0; layer < 5; layer++) for (let k = 0; k < 6 - layer; k++) { const zz = z - 0.62 + layer * 0.16 + k * 0.32, sh = 0.82 + 0.3 * seeded(), off = (seeded() - 0.5) * 0.3; solid('wood', x - 2.2 + off, layer * 0.3, zz, x + 2.2 + off, layer * 0.3 + 0.3, zz + 0.3, { tint: [sh, sh * 0.95, sh * 0.88] }); }
      solid('wood', x + 2.7, 0, z - 0.9, x + 3.7, 1.42, z + 0.1, { tint: [0.95, 0.88, 0.78] }); solid('wood', x + 2.9, 0, z + 0.2, x + 3.7, 1.6, z + 1.0, { tint: [0.8, 0.76, 0.7] }); }
    /* Fallen blocks of stone and the village's crates: cover in the lanes. Each stands from three quarters of a
       man's height (1.35 m) to just over his head (1.95 m), so a player vaults or climbs onto it but cannot jump onto it
       when it is over 1.69 m. Where each stands is random but the same for everyone (the seeded random), and they
       zigzag across the lanes (below); never against a house or a wall, on a heap, by a post or near another block.
       From their tops a player reaches 3.9 m (a vault), which is why everything over 3.15 m is capped for players (below). */
    const POSTS = [[-25, 3.2], [-9, -3.2], [9, 3.2], [22, -3.2], [-18, 13.9], [3, 17.3], [-31, 3.75], [-6.5, 3.75], [19.8, 3.75], [-6.5, 13.85]];
    const taken = [];
    const fits = (x, z, w, d, pad = 0.35) => !HOUSES.some(hh => inRect(x, z, hh.at, Math.max(w, d) / 2 + pad)) && !EDGE_WALLS.some(([a, b, c, e]) => inRect(x, z, [Math.min(a, c), Math.min(b, e), Math.max(a, c), Math.max(b, e)], Math.max(w, d) / 2 + pad))
      && heap(x, z) < 0.02 && heap(x - w / 2, z - d / 2) < 0.02 && heap(x + w / 2, z + d / 2) < 0.02 && heap(x - w / 2, z + d / 2) < 0.02 && heap(x + w / 2, z - d / 2) < 0.02
      && !POSTS.some(([px, pz]) => Math.hypot(px - x, pz - z) < Math.max(w, d) / 2 + 0.9) && !BUSHES.some(([bx, bz, br]) => Math.hypot(bx - x, bz - z) < br + Math.max(w, d) / 2 + 0.9) && !taken.some(([tx, tz, tr]) => Math.hypot(tx - x, tz - z) < tr + Math.max(w, d) / 2 + 1.6)
      && inRect(x, z, [PLAY.x0, PLAY.z0, PLAY.x1, PLAY.z1], -0.6);
    /* Where each goes: [x, z, w, d, lane] where lane is [z0, z1] for one that stands in a lane running along x (the
       street, the back lanes): it goes against one side of the lane or the other (taken in turn, so they zigzag), a
       random distance from it, a random way along, and half of them turned. Without a lane it is moved up to 2.5 m. */
    let flip = 0;
    const place = (x, z, w, d, lane) => {
      for (let k = 0; k < 30; k++) {
        let W_ = w, D_ = d; if (seeded() < 0.5) { W_ = d; D_ = w; }
        let nx, nz;
        if (lane) {
          const side = (flip + (k > 14 ? 1 : 0)) % 2, gap = 0.4 + 0.9 * seeded();
          nx = x + (seeded() - 0.5) * 4; nz = side ? lane[1] - gap - D_ / 2 : lane[0] + gap + D_ / 2;
        } else { nx = x + (seeded() - 0.5) * 5; nz = z + (seeded() - 0.5) * 5; }
        if (fits(nx, nz, W_, D_)) { if (lane) flip++; return [nx, nz, W_, D_]; }
      }
      return null;
    };
    const STREET = [-4, 4], BACK_N = [13, 18];
    for (const [x, z, w, d, lane] of [[-27, 1.6, 1.2, 0.8, STREET], [-24.5, -1.8, 0.9, 1.3, STREET], [-6.8, 9, 1.0, 0.7], [8.4, -1.9, 1.3, 0.9, STREET], [15, 1.9, 0.9, 1.4, STREET], [24.5, -3, 1.2, 1.2, STREET], [-28, -18.5, 1.4, 0.9], [-15, -20, 1.0, 1.0],
      [4, 15.4, 1.3, 0.8, BACK_N], [-12, 15.8, 0.9, 1.2, BACK_N], [18, 15.2, 1.2, 1.2, BACK_N], [24, 15.5, 1.0, 1.0, BACK_N], [-30, 15.8, 1.2, 1.0, BACK_N], [5.5, -21, 1.2, 1.4], [-4.5, -8.5, 1.4, 0.9], [22, -5.5, 1.0, 1.0]]) {
      const at = place(x, z, w, d, lane); if (!at) continue;
      const [px, pz, pw, pd] = at, h = 1.35 + 0.6 * seeded(); taken.push([px, pz, Math.max(pw, pd) / 2]);
      solid('stone', px - pw / 2, 0, pz - pd / 2, px + pw / 2, h, pz + pd / 2, { tint: [0.9 + 0.2 * seeded(), 0.9 + 0.15 * seeded(), 0.88 + 0.1 * seeded()] });
    }
    // stacks of firewood and crates of the village's own: plank boxes, 1.35 to 1.45 m (the ammunition is set out on crates under 1.45 m)
    for (const [x, z, w, d, lane] of [[-33.2, -19, 1.0, 2.4], [-20.6, 15.6, 1.4, 1.0, BACK_N], [12.6, -14.6, 1.0, 1.0], [26.4, 11.6, 1.2, 1.2], [-2.2, 3.2, 1.0, 0.9, STREET], [7.6, -24.4, 1.0, 1.0]]) {
      const at = place(x, z, w, d, lane); if (!at) continue;
      const [px, pz, pw, pd] = at; taken.push([px, pz, Math.max(pw, pd) / 2]);
      solid('wood', px - pw / 2, 0, pz - pd / 2, px + pw / 2, 1.35 + 0.1 * seeded(), pz + pd / 2, { tint: [0.74, 0.68, 0.6] });
    }
    // lamp posts
    for (const [x, z] of [[-25, 3.2], [-9, -3.2], [9, 3.2], [22, -3.2], [-18, 13.9], [3, 17.3]]) { solid('iron', x - 0.06, 0, z - 0.06, x + 0.06, 3.4, z + 0.06, { flat: true, tint: [0.5, 0.48, 0.46] }); thin('iron', x - 0.06, 3.3, z - 0.06, x + 0.7, 3.38, z + 0.06, { flat: true, tint: [0.5, 0.48, 0.46] }); thin('rust', x + 0.5, 2.95, z - 0.14, x + 0.78, 3.3, z + 0.14, { flat: true, tint: [0.7, 0.62, 0.55] }); }

    /* ---- signposts at the junctions: where the piazza, the church and the well are. The post is tall enough that
       its top is out of reach; the boards stop shots only */
    const SIGNS = [];
    for (const [x, z, boards] of [[-31, 3.75, [['PIAZZA', 'x', 1], ['CHIESA', 'x', 1]]], [-6.5, 3.75, [['POZZO', 'z', -1], ['PIAZZA', 'x', 1]]], [19.8, 3.75, [['CHIESA', 'z', -1], ['PIAZZA', 'x', 1]]], [-6.5, 13.85, [['STRADA', 'z', -1], ['CHIESA', 'x', 1]]]]) {
      solid('wood', x - 0.06, 0, z - 0.06, x + 0.06, 3.4, z + 0.06, { tint: [0.5, 0.44, 0.38] });
      boards.forEach(([word, ax, dir], i) => SIGNS.push({ x, z, word, ax, dir, y: 2.55 - i * 0.42 }));
    }
    for (const sg of SIGNS) {
      const L = 1.05, a0 = sg.dir > 0 ? 0.07 : -0.07 - L, a1 = sg.dir > 0 ? 0.07 + L : -0.07, y0 = sg.y - 0.15, y1 = sg.y + 0.15;
      if (sg.ax === 'x') solid('wood', sg.x + a0, y0, sg.z - 0.025, sg.x + a1, y1, sg.z + 0.025, { tint: [0.42, 0.33, 0.25], only: 'shots', faces: 'webt' }); else solid('wood', sg.x - 0.025, y0, sg.z + a0, sg.x + 0.025, y1, sg.z + a1, { tint: [0.42, 0.33, 0.25], only: 'shots', faces: 'nsbt' });
    }
    /* ---- washing lines between the houses, out of reach over the alleys and the street; the clothes move in the wind */
    const LINES = [[[-8, 4.6, 6.2], [-5, 4.6, 6.2]], [[-8, 4.5, 10.4], [-5, 4.5, 10.4]], [[7, 4.6, 7.2], [10, 4.6, 7.2]], [[7, 4.4, 11.2], [10, 4.4, 11.2]], [[-29.6, 5.3, 4], [-29.6, 5.3, -4]], [[-25.8, 5.1, 4], [-25.8, 5.1, -4]]];
    for (const [p, q] of LINES) { const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2 - 0.3, (p[2] + q[2]) / 2]; beamPQ('wood', p, m, 0.015, 0.015, { tint: [0.6, 0.6, 0.6], hi: false }); beamPQ('wood', m, q, 0.015, 0.015, { tint: [0.6, 0.6, 0.6], hi: false }); }
    /* ---- trees on the green and in the gardens: a trunk you can stand behind, and a crown of leaves (which stops nothing) */
    const trees = [[-7, -20, 1.0], [5, -10, 1.15], [-4, -23.5, 0.85], [-30, 21, 1.0], [-33.5, 9.5, 0.8]];
    for (const [x, z, s] of trees) solid('bark', x - 0.22 * s, 0, z - 0.22 * s, x + 0.22 * s, Math.max(3.5, 3.7 * s), z + 0.22 * s, { tint: [1, 0.96, 0.9] });
    for (const [x, z, rad] of BUSHES) { const k = ph.addBox([x - rad * 0.95, 0, z - rad * 0.95], [x + rad * 0.95, Math.min(1.9, rad * 1.5 + 0.4), z + rad * 0.95], { surface: 'wood', playerOnly: true, noNav: true }); if (k) k.noVault = true; }
    // a bush stops people as wide and as high as its leaves go, so nobody stands inside one and sees out through leaves that hide them; nobody vaults over leaves either

    /* ---- where a new life begins: on open ground, all round the village */
    for (const [x, z] of [[-34, 0], [-34.5, 15.5], [-30, -22], [-21.5, 8], [-21.5, -16], [-27, 15.8], [-14, 15.6], [-6.5, 15.6], [-6.5, 8], [1, 15.6], [8.5, 8], [14, 15.6], [26.2, 15.4], [25, 9], [24.5, 0], [24, -9], [21.5, -14.5],
      [8.6, -8], [3, -18], [-6, -11], [-9, -24], [-16.5, -16], [-21.5, -5], [-14, -2.2], [-3, -1.8], [12, 2.2]]) spawns.push([x, z]);
    return { HI, spawns, placed, trees, draw, solid, SIGNS, LINES };
  }

  /* ------------------------------------------------------------------ the ground: cobbles, earth and turf, and the heaps of rubble */
  function buildGround(bld) {
    /* Earth everywhere, then turf, cobbles and rubble laid over it, each ending where its field says. The layers sit
       a few millimetres apart so none fights another; the game's ground is still the flat y = 0 (and the heaps). */
    const X0 = PLAY.x0 - 1.5, X1 = PLAY.x1 + 1.5, Z0 = PLAY.z0 - 1.5, Z1 = PLAY.z1 + 1.5;
    const shade = (x, z, k) => { const n = 0.84 + 0.3 * fbm2(x * 0.11 + 4, z * 0.11 + 8, 3); return [n * k[0], n * k[1], n * k[2]]; };
    const lean = (x, z) => { const e = 0.05, gx = (heap(x + e, z) - heap(x - e, z)) / (2 * e), gz = (heap(x, z + e) - heap(x, z - e)) / (2 * e), nl = Math.hypot(gx, 1, gz); return [-gx / nl, 1 / nl, -gz / nl]; };
    const quad = (mat, x, z, s, lift, k, weight) => {
      const P = [[x, 0, z], [x + s, 0, z], [x + s, 0, z + s], [x, 0, z + s]]; for (const p of P) p[1] = heap(p[0], p[2]) + lift;
      bld.face(mat, P, lean(x + s / 2, z + s / 2), P.map(p => [p[0], p[2]]), P.map(p => shade(p[0], p[2], k)), 'r', weight ? P.map(p => weight(p[0], p[2])) : null);
    };
    const one = () => 1;
    const layer = (mat, lift, k, weight) => {
      for (let x = X0; x < X1; x += 0.5) for (let z = Z0; z < Z1; z += 0.5) {
        const c = [weight(x, z), weight(x + 0.5, z), weight(x + 0.5, z + 0.5), weight(x, z + 0.5)], hi = Math.max(...c), lo = Math.min(...c);
        if (hi <= 0.02) continue;
        if (lo >= 0.98) quad(mat, x, z, 0.5, lift, k, one);
        else for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) quad(mat, x + i * 0.25, z + j * 0.25, 0.25, lift, k, weight);
      }
    };
    for (let x = X0; x < X1; x += 0.5) for (let z = Z0; z < Z1; z += 0.5) quad('dirt', x, z, 0.5, 0, [1.5, 1.4, 1.22], null);
    layer('turfC', 0.005, [0.95, 1.05, 0.85], turfAt);
    layer('cobbleC', 0.01, [1, 0.98, 0.94], cobbleAt);
    layer('rubbleC', 0.016, [1, 0.98, 0.95], (x, z) => clamp(heap(x, z) / 0.1, 0, 1));
  }

  /* ------------------------------------------------------------------ grass, flowers, bushes and the crowns of the trees */
  /* The grass is drawn the way Valle Morta draws its meadow (github.com/Leonxlnx/valle-morta, MIT): not blade by blade
     but tuft by tuft. A tuft is two or three upright cards crossed through each other, each carrying a painting of a
     hundred blades, dark at the root and bright at the tip; the cards lean outward, sway at the top, and take the
     ground's light (their normals point up) so a tuft never shows a dark back. The paintings are made here, on a canvas. */
  function grassAtlas(T) {
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 512;
    const c = cv.getContext('2d'), rnd = rng(1201), hsl = (h, s, l, a = 1) => `hsla(${h.toFixed(0)},${clamp(s, 0, 100).toFixed(0)}%,${clamp(l, 0, 100).toFixed(0)}%,${a})`;
    c.lineCap = 'round';
    const blade = (x0, y0, len, lean, wid, c0, c1) => {
      const tx = x0 + lean, ty = y0 - len, cx = x0 + lean * 0.2, cy = y0 - len * 0.62, g = c.createLinearGradient(x0, y0, tx, ty);
      g.addColorStop(0, c0); g.addColorStop(1, c1); c.fillStyle = g;
      c.beginPath(); c.moveTo(x0 - wid * 0.5, y0); c.quadraticCurveTo(cx - wid * 0.42, cy, tx, ty); c.quadraticCurveTo(cx + wid * 0.42, cy, x0 + wid * 0.5, y0); c.closePath(); c.fill();
    };
    const cols = dry => {
      if (rnd() < dry) { const h = 40 + rnd() * 14, s = 28 + rnd() * 26, l = 44 + rnd() * 20; return [hsl(h, s, l * 0.5), hsl(h, s, l)]; }
      const h = 70 + rnd() * 40, s = 44 + rnd() * 30, l = 25 + rnd() * 20; return [hsl(h + 6, s, l * 0.45), hsl(h - 6, s + 6, l * 1.3)];
    };
    const tuft = (w, h, o) => {
      const list = [];
      for (let i = 0; i < o.n; i++) {
        const u = Math.pow(rnd(), 0.75) * (rnd() < 0.5 ? -1 : 1), bx = w * 0.5 + u * w * 0.5 * o.spread, len = h * lerp(o.minLen, o.maxLen, Math.pow(rnd(), 1.25)) * (1 - 0.22 * Math.abs(u));
        list.push({ bx, len, lean: (u * 0.3 + (rnd() - 0.5) * 0.55) * len * 0.6, wid: o.bw * (0.65 + rnd() * 0.75), cols: cols(o.dry) });
      }
      list.sort((a, b) => b.len - a.len);
      for (const b of list) blade(b.bx, h + 3, b.len, clamp(b.bx + b.lean, 6, w - 6) - b.bx, b.wid, b.cols[0], b.cols[1]);
    };
    const stalks = (w, h, n) => { for (let i = 0; i < n; i++) {
      const bx = w * (0.15 + 0.7 * rnd()), top = h * (0.05 + rnd() * 0.3), tx = clamp(bx + (rnd() - 0.5) * w * 0.3, 12, w - 12);
      c.strokeStyle = hsl(44 + rnd() * 14, 32, 36 + rnd() * 12); c.lineWidth = 1.9; c.beginPath(); c.moveTo(bx, h + 2); c.quadraticCurveTo(bx + (tx - bx) * 0.2, h * 0.5, tx, top); c.stroke();
      for (let k = 0; k < 12; k++) { const t = k / 12, py = top + t * 26; c.lineWidth = 1.5; c.beginPath(); c.moveTo(tx, py); c.lineTo(tx + (k % 2 ? 1 : -1) * (3 + 5 * Math.sin(Math.PI * Math.min(1, t + 0.12))), py - 4); c.stroke(); }
    } };
    const flowers = (w, h, kind) => {
      tuft(w, h, { n: 14, dry: 0.1, minLen: 0.12, maxLen: 0.34, spread: 0.6, bw: 7 });
      for (let i = 0; i < (kind === 0 ? 7 : 5); i++) {
        const bx = w * (0.25 + 0.5 * rnd()), ty = h * (0.1 + 0.42 * rnd()), tx = clamp(bx + (rnd() - 0.5) * w * 0.5, 20, w - 20), r = kind === 0 ? 9 + rnd() * 3.5 : 10 + rnd() * 3;
        c.strokeStyle = hsl(84 + rnd() * 10, 42, 27 + rnd() * 6); c.lineWidth = 2.1; c.beginPath(); c.moveTo(bx, h + 2); c.quadraticCurveTo(bx + (tx - bx) * 0.3, (h + ty) * 0.5, tx, ty); c.stroke();
        c.save(); c.translate(tx, ty); c.scale(1, 0.66 + rnd() * 0.3);
        if (kind === 0) { for (let k = 0; k < 5; k++) { const a = k / 5 * TAU + rnd(); c.fillStyle = hsl(48 + rnd() * 6, 96, 52 + rnd() * 8); c.beginPath(); c.ellipse(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.55, r * 0.42, a, 0, TAU); c.fill(); } c.fillStyle = hsl(43, 96, 40); c.beginPath(); c.arc(0, 0, r * 0.3, 0, TAU); c.fill(); }
        else if (kind === 1) { for (let k = 0; k < 14; k++) { const a = k / 14 * TAU; c.fillStyle = hsl(55, 14, 90 + rnd() * 8); c.beginPath(); c.ellipse(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.42, r * 0.15, a, 0, TAU); c.fill(); } c.fillStyle = hsl(46, 95, 50); c.beginPath(); c.arc(0, 0, r * 0.3, 0, TAU); c.fill(); }
        else for (let k = 0; k < 13; k++) { const a = rnd() * TAU, rr = Math.sqrt(rnd()) * r; c.fillStyle = hsl(70, 12, 88 + rnd() * 10); c.beginPath(); c.arc(Math.cos(a) * rr, Math.sin(a) * rr * 0.6, 2.7, 0, TAU); c.fill(); }
        c.restore();
      }
    };
    const tile = (col, row, draw) => { c.save(); c.beginPath(); c.rect(col * 256, row * 256, 256, 256); c.clip(); c.translate(col * 256, row * 256); draw(256, 256); c.restore(); };
    tile(0, 0, (w, h) => tuft(w, h, { n: 105, dry: 0.08, minLen: 0.3, maxLen: 0.93, spread: 0.9, bw: 7.5 }));
    tile(1, 0, (w, h) => tuft(w, h, { n: 90, dry: 0.3, minLen: 0.35, maxLen: 0.97, spread: 0.9, bw: 6.5 }));
    tile(2, 0, (w, h) => tuft(w, h, { n: 70, dry: 0.12, minLen: 0.2, maxLen: 0.62, spread: 0.88, bw: 7 }));
    tile(3, 0, (w, h) => { stalks(w, h, 10); tuft(w, h, { n: 72, dry: 0.3, minLen: 0.2, maxLen: 0.62, spread: 0.88, bw: 6.5 }); });
    tile(0, 1, (w, h) => flowers(w, h, 0)); tile(1, 1, (w, h) => flowers(w, h, 1)); tile(2, 1, (w, h) => flowers(w, h, 2)); tile(3, 1, (w, h) => flowers(w, h, 0));
    const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; t.name = 'alp_grass';
    return t;
  }
  // the top of a plant moves in the wind: a point moves by its sway number
  function sway(mat, key) {
    const time = { value: 0 };
    mat.onBeforeCompile = sh => { sh.uniforms.uTime = time;
      sh.vertexShader = 'attribute float aSway; uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  { float ph = position.x * 0.9 + position.z * 1.3; transformed.x += aSway * (sin(uTime * 1.7 + ph) * 0.045 + sin(uTime * 3.1 + ph * 2.3) * 0.02); transformed.z += aSway * cos(uTime * 1.3 + ph * 1.7) * 0.035; }'); };
    mat.customProgramCacheKey = () => key;
    return time;
  }
  function buildGrass(G, root) {
    const T = G.THREE, r = rng(5521), q = (G.quality && G.quality.name) || 'high', P = [], C = [], N = [], I = [], A = [], U = [];
    const cell = { low: 0.44, medium: 0.34 }[q] || 0.29, cards = q === 'low' ? 2 : 3;      // a tuft every so many metres, each of so many cards
    const boxes = HOUSES.map(h => h.at), blocked = (x, z) => boxes.some(b => inRect(x, z, b, 0.2)) || heap(x, z) > 0.04;
    const tuft = (x, z, wid, hgt, tileX, tileY, tint, yaw, lean) => {
      for (let cI = 0; cI < cards; cI++) {
        const a = yaw + cI * Math.PI / cards + 0.35 * cI, dx = Math.cos(a), dz = Math.sin(a), nx = -dz, nz = dx, sg = [1, -1, 0.4][cI % 3], base = P.length / 3;
        for (let row = 0; row <= 2; row++) { const v = row / 2, k = (0.1 * sg + lean * v * v * Math.sign(sg)) * hgt;
          for (let j = 0; j <= 1; j++) { P.push(x + dx * (j - 0.5) * wid + nx * k, v * hgt, z + dz * (j - 0.5) * wid + nz * k); U.push((tileX + 0.012 + (cI % 2 ? 1 - j : j) * 0.976) * 0.25, tileY * 0.5 + (0.01 + v * 0.975) * 0.5); N.push(0, 1, 0); C.push(tint[0], tint[1], tint[2]); A.push(v * v * hgt * 2.2); } }
        for (let row = 0; row < 2; row++) { const p = base + row * 2; I.push(p, p + 1, p + 3, p, p + 3, p + 2); }
      }
    };
    for (let x = PLAY.x0 - 1; x < PLAY.x1 + 1; x += cell) for (let z = PLAY.z0 - 1; z < PLAY.z1 + 1; z += cell) {
      const px = x + r() * cell, pz = z + r() * cell, w = turfAt(px, pz), pick = r(), sz = r(), yaw = r() * TAU, leanR = r();
      if (w < 0.55 || cobbleAt(px, pz) > 0.42 || blocked(px, pz)) continue;
      const patch = fbm2(px * 0.3 + 7, pz * 0.3 + 3, 3), dry = fbm2(px * 0.12 + 31, pz * 0.12 + 9, 3), edge = smooth(0.55, 0.9, w), drift = fbm2(px * 0.3 + 1, pz * 0.3 + 5, 2);
      const g = 0.86 + 0.3 * patch, tint = [g * (0.95 + 0.25 * dry), g * 1.04, g * (0.86 - 0.2 * dry)];
      const flower = q !== 'low' && drift > 0.52 && pick < 0.16, tileX = flower ? Math.floor(sz * 4) : pick < 0.45 ? 0 : pick < 0.7 ? 1 : pick < 0.9 ? 2 : 3;
      tuft(px, pz, (0.42 + 0.2 * sz) * (0.8 + 0.4 * edge), (0.26 + 0.2 * sz) * (0.5 + 0.9 * patch) * (0.55 + 0.45 * edge) * (flower ? 1.15 : 1), tileX, flower ? 0 : 1, flower ? [1.05, 1.05, 1.0] : tint, yaw, 0.35 + 0.4 * leanR);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(N, 3)); g.setAttribute('color', new T.Float32BufferAttribute(C, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(U, 2)); g.setAttribute('aSway', new T.Float32BufferAttribute(A, 1));
    g.setIndex(new T.Uint32BufferAttribute(I, 1)); g.computeBoundingSphere();
    const mat = new T.MeshStandardMaterial({ map: grassAtlas(T), alphaTest: 0.36, side: T.DoubleSide, vertexColors: true, roughness: 1, metalness: 0 }); mat.name = 'alp_grass';
    const time = sway(mat, 'alp-grass'), mesh = new T.Mesh(g, mat);
    mesh.name = 'alp:grass'; mesh.receiveShadow = true; mesh.castShadow = false; mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; root.add(mesh);
    return { tris: I.length / 3, time };
  }
  function buildPlants(G, built, root, mats) {
    const T = G.THREE, r = rng(977), low = G.quality && G.quality.name === 'low', P = [], C = [], N = [], I = [], A = [], U = [];
    const grass = buildGrass(G, root);
    // leaves: bushes, and the crown of each tree, as clumps of small leaning cards each carrying a spray of leaves
    const clump = (cx, cy, cz, rad, n, dark) => { for (let k = 0; k < n; k++) {
      const a = r() * TAU, u = r() * 2 - 1, rr = rad * Math.cbrt(r()), s = Math.sqrt(1 - u * u), x = cx + Math.cos(a) * s * rr, y = cy + u * rr * 0.8, z = cz + Math.sin(a) * s * rr, sz = 0.2 + 0.16 * r(), yaw = r() * TAU, tilt = (r() - 0.5) * 1.8;
      const dx = Math.cos(yaw) * sz, dz = Math.sin(yaw) * sz, uy = Math.cos(tilt) * sz * 2, ux = -Math.sin(yaw) * Math.sin(tilt) * sz * 2, uz = Math.cos(yaw) * Math.sin(tilt) * sz * 2, v = P.length / 3;
      const lit = 0.45 + 0.55 * clamp((y - cy) / rad * 0.7 + 0.5, 0, 1), g = (0.75 + 0.5 * r()) * lit * (dark ? 0.72 : 1), warm = r() * 0.12, c = [(0.2 + warm) * g, 0.56 * g, 0.08 * g];
      P.push(x - dx, y, z - dz, x + dx, y, z + dz, x + dx + ux, y + uy, z + dz + uz, x - dx + ux, y + uy, z - dz + uz); const sw = clamp((y - 0.2) / 3, 0, 1) * 0.5; A.push(sw, sw, sw, sw);
      U.push(0.01, 0.01, 0.49, 0.01, 0.49, 0.99, 0.01, 0.99);
      const nl = Math.hypot(x - cx, 0.6, z - cz) || 1; for (let q = 0; q < 4; q++) { C.push(c[0], c[1], c[2]); N.push((x - cx) / nl * 0.6, 0.8, (z - cz) / nl * 0.6); } I.push(v, v + 1, v + 2, v, v + 2, v + 3);
    } };
    const leaves = low ? 0.55 : 1;
    for (const [x, z, s] of built.trees) { const top = Math.max(3.5, 3.7 * s) + 0.9; clump(x, top, z, 2.3 * s, Math.round(2200 * leaves), false); clump(x + 1.2 * s, top - 0.6, z + 0.5, 1.5 * s, Math.round(900 * leaves), true); clump(x - 1.0 * s, top - 0.4, z - 0.9, 1.6 * s, Math.round(950 * leaves), false); }
    for (const [x, z, rad] of BUSHES) clump(x, rad * 0.7, z, rad, Math.round(700 * leaves * rad), false);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(N, 3)); g.setAttribute('color', new T.Float32BufferAttribute(C, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(U, 2)); g.setAttribute('aSway', new T.Float32BufferAttribute(A, 1));
    g.setIndex(new T.Uint32BufferAttribute(I, 1)); g.computeBoundingSphere();
    const mat = mats.leaf, time = sway(mat, 'alp-leaf');
    const mesh = new T.Mesh(g, mat); mesh.name = 'alp:plants'; mesh.receiveShadow = true; mesh.castShadow = false; mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; root.add(mesh);
    // the crowns throw shade: a few plain blobs that only the sun's shadow pass sees
    const sm = new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    for (const [x, z, s] of built.trees) { const b = new T.Mesh(new T.IcosahedronGeometry(2.1 * s, 1), sm); b.position.set(x, Math.max(3.5, 3.7 * s) + 0.9, z); b.castShadow = true; b.matrixAutoUpdate = false; b.updateMatrix(); root.add(b); }
    return { tris: I.length / 3 + grass.tris, grass: grass.tris, update(t) { time.value = t; grass.time.value = t; } };
  }

  /* ------------------------------------------------------------------ what moves, and what is painted
     The words on the signposts (one painted sheet), the clothes on the washing lines (they move in the wind), and the
     smoke that still rises from the two burnt houses: a column seen from anywhere in the village, to find one's way by. */
  function buildExtras(G, built, root) {
    const T = G.THREE, r = rng(3131), parts = [];
    // the words: white paint on dark boards, both faces
    const words = [...new Set(built.SIGNS.map(s => s.word))], cv = document.createElement('canvas'); cv.width = 512; cv.height = 64 * words.length;
    const c = cv.getContext('2d'); c.fillStyle = '#5a4634'; c.fillRect(0, 0, cv.width, cv.height);
    c.font = '700 40px Georgia, "Times New Roman", serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    words.forEach((w, i) => { c.fillStyle = 'rgba(30,20,12,0.5)'; c.fillRect(6, i * 64 + 6, 500, 52); c.fillStyle = '#efe6d2'; c.fillText(w, 256, i * 64 + 34); });
    const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 8;
    const P = [], U = [], N = [], I = [];
    for (const sg of built.SIGNS) {
      const k = words.indexOf(sg.word), L = 1.05, a0 = sg.dir > 0 ? 0.07 : -0.07 - L, a1 = sg.dir > 0 ? 0.07 + L : -0.07, y0 = sg.y - 0.14, y1 = sg.y + 0.14, v0 = 1 - (k * 64 + 60) / cv.height, v1 = 1 - (k * 64 + 4) / cv.height;
      for (const side of [-1, 1]) {
        const off = 0.027 * side, at = (a, y) => (sg.ax === 'x' ? [sg.x + a, y, sg.z + off] : [sg.x + off, y, sg.z + a]), base = P.length / 3;
        // read left to right from either side
        const flip = (sg.ax === 'x') === (side > 0) ? 0 : 1, ua = flip ? 1 : 0, ub = flip ? 0 : 1;
        for (const [a, y, u, v] of [[a0, y0, ua, v0], [a1, y0, ub, v0], [a1, y1, ub, v1], [a0, y1, ua, v1]]) { P.push(...at(a, y)); U.push(u, v); N.push(sg.ax === 'x' ? 0 : side, 0, sg.ax === 'x' ? side : 0); }
        side > 0 === (sg.ax === 'x') ? I.push(base, base + 1, base + 2, base, base + 2, base + 3) : I.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
    { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(U, 2)); g.setAttribute('normal', new T.Float32BufferAttribute(N, 3)); g.setIndex(I);
      const m = new T.Mesh(g, new T.MeshStandardMaterial({ map: tex, roughness: 0.85, side: T.DoubleSide })); m.name = 'alp:signs'; m.receiveShadow = true; m.matrixAutoUpdate = false; root.add(m); }
    // the clothes: sheets, shirts and towels pegged along each line, faded colours
    const CP = [], CC = [], CN = [], CI = [], CA = [], colours = [[0.92, 0.9, 0.84], [0.86, 0.84, 0.78], [0.42, 0.52, 0.7], [0.66, 0.24, 0.2], [0.5, 0.56, 0.38], [0.8, 0.72, 0.5], [0.6, 0.62, 0.66]];
    for (const [p, q] of built.LINES) {
      const len = Math.hypot(q[0] - p[0], q[2] - p[2]), dx = (q[0] - p[0]) / len, dz = (q[2] - p[2]) / len, along = t => { const sag = 0.3 * (1 - (2 * t - 1) ** 2); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t - sag, p[2] + (q[2] - p[2]) * t]; };
      for (let t = 0.08; t < 0.92;) {
        const w = (0.35 + 0.5 * r()) / len, h = 0.45 + 0.45 * r(), col = colours[Math.floor(r() * colours.length)], t1 = Math.min(0.92, t + w), A = along(t), B = along(t1), base = CP.length / 3;
        for (const [pt, dy, sw] of [[A, 0, 0], [B, 0, 0], [B, -h, 1], [A, -h, 1]]) { CP.push(pt[0], pt[1] + dy, pt[2]); CC.push(...col); CN.push(-dz, 0, dx); CA.push(sw * h); }
        CI.push(base, base + 1, base + 2, base, base + 2, base + 3);
        t = t1 + (0.04 + 0.25 * r()) / len * 3;
      }
    }
    { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(CP, 3)); g.setAttribute('color', new T.Float32BufferAttribute(CC, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(CN, 3)); g.setAttribute('aSway', new T.Float32BufferAttribute(CA, 1)); g.setIndex(CI);
      const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: T.DoubleSide }), time = { value: 0 };
      mat.onBeforeCompile = sh => { sh.uniforms.uTime = time; sh.vertexShader = 'attribute float aSway; uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  { float ph = position.x * 1.7 + position.z * 1.3; vec3 nn = normalize(normal); transformed += nn * aSway * (0.22 * sin(uTime * 1.6 + ph) + 0.08 * sin(uTime * 3.7 + ph * 2.1)); }'); };
      mat.customProgramCacheKey = () => 'alp-cloth';
      const m = new T.Mesh(g, mat); m.name = 'alp:washing'; m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; m.frustumCulled = false; root.add(m); parts.push(t => { time.value = t; }); }
    // smoke: soft puffs that rise, widen, drift with the wind and thin out, all worked out on the graphics card
    { const SRC = [[15.4, 4.0, 8.4, 1.0], [-15.6, 3.0, -8.4, 0.75]], n = 160, pos = [], seed = [];
      for (const [x, y, z, k] of SRC) for (let i = 0; i < n * k; i++) { pos.push(x + (r() - 0.5) * 2.4, y, z + (r() - 0.5) * 2.4); seed.push(r(), r(), r(), k); }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('aSeed', new T.Float32BufferAttribute(seed, 4)); g.boundingSphere = new T.Sphere(new T.Vector3(0, 15, 0), 60);
      const u = { uTime: { value: 0 }, uPx: { value: 600 }, uSun: { value: new T.Color(1.0, 0.93, 0.82) } };
      const mat = new T.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, fog: false,
        vertexShader: `attribute vec4 aSeed; uniform float uTime, uPx; varying float vA, vT, vR;
          void main(){ float t = fract(uTime / 16.0 + aSeed.x); vT = t; vR = aSeed.y;
            vec3 p = position + vec3(t * t * 9.0 + sin(t * 6.0 + aSeed.y * 9.0) * 0.6, t * 20.0 * (0.8 + 0.4 * aSeed.z), (aSeed.z - 0.5) * t * 4.0);
            vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
            float size = (1.2 + t * 7.0) * (0.7 + 0.6 * aSeed.y);
            gl_PointSize = min(size * uPx / -mv.z, 900.0);
            vA = smoothstep(0.0, 0.07, t) * (1.0 - t) * (1.0 - t) * 0.62 * aSeed.w; }`,
        fragmentShader: `uniform vec3 uSun; varying float vA, vT, vR;
          void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float d = dot(q, q); if (d > 1.0) discard;
            float a = vA * (1.0 - d) * (1.0 - d) * (0.75 + 0.25 * sin(q.x * 5.0 + vR * 20.0) * sin(q.y * 4.0 + vR * 13.0));
            vec3 col = mix(vec3(0.11, 0.1, 0.1), vec3(0.5, 0.5, 0.52), smoothstep(0.0, 0.6, vT)) * mix(0.7, 1.15, 0.5 - q.y * 0.5) * uSun;
            gl_FragColor = vec4(col, a); }` });
      const pts = new T.Points(g, mat); pts.name = 'alp:smoke'; pts.renderOrder = 5; pts.matrixAutoUpdate = false; root.add(pts);
      parts.push(t => { u.uTime.value = t; const res = G.render.resolution, cam = G.camera; if (res && cam) u.uPx.value = res.y * 0.5 / Math.tan(cam.fov * Math.PI / 360); }); }
    return { update(t) { for (const f of parts) f(t); } };
  }

  /* ------------------------------------------------------------------ the sky
     The game's sky is a storm at dawn. This village has a clear morning: blue overhead, pale at the horizon, white
     cumulus drifting, the sun in its own glow. The game's sky dome is kept, with this picture drawn on it, and the
     scene's ambient light is taken again from the new sky, the way the game takes it from its own. */
  const SKY = `
uniform sampler2D tNoise; uniform float uTime, uEnv; uniform vec3 uSunDir, uSunCol;
varying vec3 vDir;
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vn(p); p = p * 2.03 + 17.0; a *= 0.5; } return s / 0.96875; }
void main(){
  vec3 d = normalize(vDir); float h = max(d.y, 0.0), mu = dot(d, uSunDir), s = max(mu, 0.0);
  vec3 zen = vec3(0.16, 0.36, 0.86), hor = vec3(0.62, 0.78, 0.98);
  vec3 col = mix(hor, zen, pow(h, 0.55)) * 1.75;
  col += uSunCol * vec3(1.0, 0.92, 0.78) * (pow(s, 6.0) * 0.5 + pow(s, 40.0) * 1.0 + pow(s, 400.0) * 3.0);
  // cumulus: a flat layer seen from below, thinning to nothing at the horizon
  vec2 q = d.xz / (h + 0.16) * 1.15 + vec2(0.010, 0.004) * uTime;
  float base = fbm(q * 0.9 + 3.0), detail = fbm(q * 3.2 + 9.0);
  float cov = smoothstep(0.50, 0.68, base + (detail - 0.5) * 0.3) * smoothstep(0.02, 0.2, h);
  float lit = clamp((base - fbm(q * 0.9 + 3.0 + normalize(uSunDir.xz) * 0.18)) * 5.0 + 0.6, 0.0, 1.0);
  vec3 cloud = mix(vec3(0.62, 0.68, 0.80), vec3(1.0, 0.99, 0.96), lit) * 2.6 + uSunCol * pow(s, 8.0) * 0.5;
  cloud = mix(cloud, hor * 1.9, exp(-h * 9.0));
  col = mix(col, cloud, cov * 0.95);
  col += vec3(1.0, 0.9, 0.7) * smoothstep(0.99990, 0.99996, mu) * 90.0 * (1.0 - cov) * (1.0 - uEnv);
  if (d.y < 0.0) col = mix(hor * 1.6, vec3(0.20, 0.26, 0.14), smoothstep(0.0, 0.25, -d.y));
  col = mix(col, min(col, vec3(6.0)), uEnv);
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;
  /* The valley round the village is a photograph: a full 360° picture of the Alps (Alps Field, by Andreas Mischok,
     polyhaven.com, CC0), turned so that its sun stands where the game's sun is. A small picture of the whole sky, and
     a sharp strip for the band round the horizon where the mountains are. If the pictures cannot be had, the painted
     sky above is used instead. */
  const PHOTO = { sunU: 0.5999, sunEl: 42.1, band: [0.44995, 0.25], dir: '/maps/alpine/' };
  const PANO = `
uniform sampler2D tPano, tBand; uniform float uEnv, uRot, uGain, uBand; uniform vec3 uSunDir, uSunCol;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float ua = atan(d.z, d.x) * 0.15915494 + uRot, ub = fract(ua + 0.5) - 0.5;
  float u = fwidth(ua) <= fwidth(ub) + 1e-6 ? ua : ub;                                       // no seam where the angle wraps round
  float v = asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5, vb = (v - ${PHOTO.band[0]}) / ${PHOTO.band[1]};
  vec3 col = texture2D(tPano, vec2(u, v)).rgb, band = texture2D(tBand, vec2(u, clamp(vb, 0.002, 0.998))).rgb;
  col = mix(col, band, uBand * smoothstep(0.0, 0.06, vb) * smoothstep(1.0, 0.94, vb));
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col *= uGain * (1.0 + 3.0 * pow(l, 5.0));                                                   // the photograph is a print: give its brightest parts their light back
  col = mix(col, min(col, vec3(6.0)), uEnv);
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;
  async function makeSky(G) {
    const T = G.THREE, sky = G.render.sky, mat = sky && sky.material;
    if (!mat || !mat.uniforms || !mat.uniforms.uSunDir) { console.warn('[alpine] the sky was left as it is: its material has changed'); return 'kept'; }
    let kind = 'painted';
    try {
      const loader = new T.TextureLoader(), wide = G.renderer.capabilities.maxTextureSize >= 8192;
      const [pano, band] = await Promise.all([loader.loadAsync(PHOTO.dir + 'sky.jpg'), wide ? loader.loadAsync(PHOTO.dir + 'band.jpg') : null]);
      for (const t of [pano, band]) if (t) { t.colorSpace = T.SRGBColorSpace; t.wrapS = T.RepeatWrapping; t.wrapT = T.ClampToEdgeWrapping; t.anisotropy = Math.min(8, G.renderer.capabilities.getMaxAnisotropy()); }
      const sd = G.consts.sun.dir;
      Object.assign(mat.uniforms, { tPano: { value: pano }, tBand: { value: band || pano }, uBand: { value: band ? 1 : 0 }, uGain: { value: 2.5 }, uRot: { value: PHOTO.sunU - Math.atan2(sd.z, sd.x) / TAU } });
      mat.fragmentShader = PANO; mat.extensions = { ...(mat.extensions || {}), derivatives: true }; kind = band ? 'photo' : 'photo-small';
    } catch (e) { console.warn('[alpine] no photograph of the valley, painting the sky instead', e); mat.fragmentShader = SKY; }
    mat.needsUpdate = true;
    // the light of the sky on everything: taken again from the new sky, as the game takes it from its own
    const pm = new T.PMREMGenerator(G.renderer), env = mat.clone(), scene = new T.Scene(), mesh = new T.Mesh(sky.geometry, env);
    for (const k of ['tNoise', 'tPano', 'tBand']) if (mat.uniforms[k]) env.uniforms[k].value = mat.uniforms[k].value;
    env.uniforms.uEnv.value = 1; mesh.frustumCulled = false; scene.add(mesh);
    const keep = G.renderer.getRenderTarget(), rt = pm.fromScene(scene, 0, 0.1, 100);
    G.renderer.setRenderTarget(keep); env.dispose(); pm.dispose();
    G.scene.environment = rt.texture; G.render.env = rt.texture;
    return kind;
  }
  /* The sun's shadow map is fitted to the harbour when the renderer starts. Refit it to the village. */
  function fitShadows(G) {
    const T = G.THREE, sun = G.render.sun, cam = sun.shadow.camera, w0 = cam.right - cam.left, h0 = cam.top - cam.bottom, depth0 = cam.far - cam.near;
    const dir = G.consts.sun.dir.clone().normalize(), centre = new T.Vector3(-4, 4, 0);
    sun.target.position.copy(centre); sun.position.copy(centre).addScaledVector(dir, 160); sun.updateMatrixWorld(true); sun.target.updateMatrixWorld(true);
    const view = new T.Matrix4().lookAt(sun.position, centre, new T.Vector3(0, 1, 0)); view.setPosition(sun.position); view.invert();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, n0 = 1e9, n1 = -1e9; const v = new T.Vector3();
    for (const x of [-42, 34]) for (const z of [-32, 28]) for (const y of [0, 24]) { v.set(x, y, z).applyMatrix4(view); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); n0 = Math.min(n0, -v.z); n1 = Math.max(n1, -v.z); }
    cam.left = x0 - 1; cam.right = x1 + 1; cam.bottom = y0 - 1; cam.top = y1 + 1; cam.near = Math.max(1, n0 - 4); cam.far = Math.max(n1 + 4, cam.near + depth0);
    cam.updateProjectionMatrix();
    sun.shadow.radius *= Math.sqrt((w0 / (cam.right - cam.left)) * (h0 / (cam.top - cam.bottom)));
    sun.shadow.needsUpdate = true;
    return { width: cam.right - cam.left, height: cam.top - cam.bottom };
  }

  /* ------------------------------------------------------------------ collision beyond boxes
     The heaps of rubble are smooth hills: people stand on them, shots land on them, thrown things come to rest on them.
     Roofs and the spire stop shots where they are drawn. A ring of boxes outside the walls is the last word on staying in. */
  function installPhysics(G, built) {
    const T = G.THREE, ph = G.physics, move = ph.moveCapsule, cast = ph.raycast, groundH = ph.groundHeight;
    ph.moveCapsule = function (pos, vel, dt, radius = 0.32, height = 1.8, step = true) {
      const res = move.call(ph, pos, vel, dt, radius, height, step), h = heap(pos.x, pos.z);
      if (h > 0.002 && pos.y <= h + 0.02 && (vel.y <= 0 || pos.y < h)) { pos.y = h; if (vel.y < 0) vel.y = 0; res.onGround = true; res.surface = 'concrete'; }
      return res;
    };
    /* What is out of reach and is no box (roof slopes, rafters, gables, high trim) stops shots as the triangles it is
       drawn with. They are filed in a grid of 2 m squares, and a shot tests only those in the squares along its way. */
    const HP = built.HI.p, HS = built.HI.s, NT = HS.length, GC = 2, GX = -48, GZ = -38, GW = 44, GD = 36, cells = Array.from({ length: GW * GD }, () => []);
    for (let t = 0; t < NT; t++) {
      const i = t * 9, xa = Math.min(HP[i], HP[i + 3], HP[i + 6]), xb = Math.max(HP[i], HP[i + 3], HP[i + 6]), za = Math.min(HP[i + 2], HP[i + 5], HP[i + 8]), zb = Math.max(HP[i + 2], HP[i + 5], HP[i + 8]);
      for (let cx = Math.max(0, Math.floor((xa - GX) / GC)); cx <= Math.min(GW - 1, Math.floor((xb - GX) / GC)); cx++) for (let cz = Math.max(0, Math.floor((za - GZ) / GC)); cz <= Math.min(GD - 1, Math.floor((zb - GZ) / GC)); cz++) cells[cz * GW + cx].push(t);
    }
    const stamp = new Int32Array(NT); let rayId = 0;
    const triHit = (t, o, d) => {       // Moller-Trumbore: the distance along the ray, or -1
      const i = t * 9, ax = HP[i], ay = HP[i + 1], az = HP[i + 2], e1x = HP[i + 3] - ax, e1y = HP[i + 4] - ay, e1z = HP[i + 5] - az, e2x = HP[i + 6] - ax, e2y = HP[i + 7] - ay, e2z = HP[i + 8] - az;
      const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x, det = e1x * px + e1y * py + e1z * pz; if (det > -1e-12 && det < 1e-12) return -1;
      const inv = 1 / det, tx = o.x - ax, ty = o.y - ay, tz = o.z - az, u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) return -1;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (d.x * qx + d.y * qy + d.z * qz) * inv; if (v < 0 || u + v > 1) return -1;
      return (e2x * qx + e2y * qy + e2z * qz) * inv;
    };
    function hiCast(o, d, lim) {
      let t0 = 0, t1 = lim;
      for (const [oc, dc, lo, hiE] of [[o.x, d.x, GX, GX + GW * GC], [o.z, d.z, GZ, GZ + GD * GC]]) { if (Math.abs(dc) < 1e-12) { if (oc < lo || oc >= hiE) return null; continue; } let p0 = (lo - oc) / dc, p1 = (hiE - oc) / dc; if (p0 > p1) { const q = p0; p0 = p1; p1 = q; } t0 = Math.max(t0, p0); t1 = Math.min(t1, p1); }
      if (t0 >= t1) return null;
      rayId++; let best = -1, bt = t1;
      let cx = Math.min(GW - 1, Math.max(0, Math.floor((o.x + d.x * t0 - GX) / GC))), cz = Math.min(GD - 1, Math.max(0, Math.floor((o.z + d.z * t0 - GZ) / GC)));
      const sx = d.x > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1, ax = Math.abs(d.x) > 1e-12, az = Math.abs(d.z) > 1e-12;
      const tdx = ax ? GC / Math.abs(d.x) : Infinity, tdz = az ? GC / Math.abs(d.z) : Infinity;
      let tmx = ax ? (GX + (cx + (sx > 0 ? 1 : 0)) * GC - o.x) / d.x : Infinity, tmz = az ? (GZ + (cz + (sz > 0 ? 1 : 0)) * GC - o.z) / d.z : Infinity, tc = t0;
      while (cx >= 0 && cx < GW && cz >= 0 && cz < GD && tc <= bt) {
        for (const t of cells[cz * GW + cx]) { if (stamp[t] === rayId) continue; stamp[t] = rayId; const h = triHit(t, o, d); if (h > 1e-4 && h < bt) { bt = h; best = t; } }
        if (tmx < tmz) { tc = tmx; tmx += tdx; cx += sx; } else { tc = tmz; tmz += tdz; cz += sz; }
      }
      if (best < 0) return null;
      const i = best * 9, e1 = [HP[i + 3] - HP[i], HP[i + 4] - HP[i + 1], HP[i + 5] - HP[i + 2]], e2 = [HP[i + 6] - HP[i], HP[i + 7] - HP[i + 1], HP[i + 8] - HP[i + 2]];
      const n = new T.Vector3(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]).normalize(); if (n.x * d.x + n.y * d.y + n.z * d.z > 0) n.negate();
      return { dist: bt, normal: n, surface: HS[best] };
    }
    const hit = (o, d, t, n, surface) => ({ dist: t, point: new T.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t), normal: n, surface, box: null });
    ph.raycast = function (o, d, max = 500) {
      let best = cast.call(ph, o, d, max);
      // what is out of reach and not a box
      { const h = hiCast(o, d, best ? best.dist : max); if (h) best = hit(o, d, h.dist, h.normal, h.surface); }
      // heaps: walk the ray through each heap it could touch, then close in on where it goes under
      for (const [cx, cz, r0, hh] of HEAPS) { const r = r0 * 1.25;                 // a heap's ragged edge reaches a quarter beyond its radius
        const ox = o.x - cx, oz = o.z - cz, a = d.x * d.x + d.z * d.z, lim = best ? best.dist : max; let t0 = 0, t1 = lim;
        if (a > 1e-9) { const b = ox * d.x + oz * d.z, c = ox * ox + oz * oz - r * r, disc = b * b - a * c; if (disc <= 0) continue; const sq = Math.sqrt(disc); t0 = Math.max(0, (-b - sq) / a); t1 = Math.min(lim, (-b + sq) / a); }
        else if (ox * ox + oz * oz >= r * r) continue;
        if (t1 <= t0) continue;
        if (d.y > 0 && o.y + d.y * t0 > Math.max(hh, 1.2) * 1.05) continue;
        let prev = t0, found = -1; if (o.y + d.y * t0 < heap(o.x + d.x * t0, o.z + d.z * t0)) { if (t0 === 0) continue; found = t0; }
        for (let t = t0 + 0.12; found < 0 && t <= t1 + 0.12; t += 0.12) { const tt = Math.min(t, t1); if (o.y + d.y * tt < heap(o.x + d.x * tt, o.z + d.z * tt)) { let lo = prev, hi = tt; for (let it = 0; it < 12; it++) { const m = (lo + hi) / 2; if (o.y + d.y * m < heap(o.x + d.x * m, o.z + d.z * m)) hi = m; else lo = m; } found = hi; } prev = tt; }
        if (found < 0 || found >= lim) continue;
        const hx = o.x + d.x * found, hz = o.z + d.z * found, g = 0.04, gx = (heap(hx + g, hz) - heap(hx - g, hz)) / (2 * g), gz = (heap(hx, hz + g) - heap(hx, hz - g)) / (2 * g), nl = Math.hypot(gx, 1, gz);
        best = hit(o, d, found, new T.Vector3(-gx / nl, 1 / nl, -gz / nl), 'concrete');
      }
      return best;
    };
    ph.groundHeight = function (x, z, maxY = 50) { const g = groundH.call(ph, x, z, maxY), h = heap(x, z); return h > g && h <= maxY ? h : g; };
    // outside the walls: solid all round, up to 9 m, and the walk grid knows it is not ground
    const B = ph.bounds || { min: { x: -40, z: -30 }, max: { x: 40, z: 30 } }, o = { surface: 'concrete', playerOnly: true };
    ph.addBox([B.min.x - 4, 0, B.min.z - 6], [PLAY.x0 - 0.5, 9, B.max.z + 6], o); ph.addBox([PLAY.x1 + 0.5, 0, B.min.z - 6], [B.max.x + 4, 9, B.max.z + 6], o);
    ph.addBox([PLAY.x0 - 0.5, 0, B.min.z - 6], [PLAY.x1 + 0.5, 9, PLAY.z0 - 0.5], o); ph.addBox([PLAY.x0 - 0.5, 0, PLAY.z1 + 0.5], [PLAY.x1 + 0.5, 9, B.max.z + 6], o);
  }

  /* ------------------------------------------------------------------ the level */
  let PLANTS = null, EXTRAS = null;
  async function level(G) {
    const T = G.THREE, root = new T.Group(); root.name = 'alpine'; G.scene.add(root);
    const sets = await loadTextures(G), mats = makeMaterials(G, sets), bld = makeBuilder();
    const built = build(G, bld);
    buildGround(bld);
    const meshes = toMeshes(G, bld, mats, root);
    PLANTS = buildPlants(G, built, root, mats);
    EXTRAS = buildExtras(G, built, root);
    installPhysics(G, built);
    const shadow = fitShadows(G), sky = await makeSky(G);
    G.mats.uniforms.wet.value = 0;                                 // a dry morning
    { const emit = G.events.emit; G.events.emit = function (name, data) { if (name === 'thunder') return; return emit.call(this, name, data); }; }      // and no thunder out of a clear sky
    if (G.render.tune) Object.assign(G.render.tune, { aoIntensity: 1.5, aoRadius: 1.0, volSunScale: 0.5, volSigma: 0.0008, volFarHaze: 0.1, flare: 0.07, bloom: 0.05, key: 0.25, maxExposure: 2.6 });
    // the light the meadows and pale walls throw back into the shade, and the same for the gun in the hands
    const hemi = new T.HemisphereLight(new T.Color(0.8, 0.86, 1.0), new T.Color(0.6, 0.52, 0.3), 0.9), back = new T.DirectionalLight(new T.Color(1.0, 0.95, 0.85), 0.5);
    back.position.set(40, 30, 60); back.target.position.set(-4, 2, 0); back.castShadow = false;
    for (const l of [hemi, back]) { l.layers.enable(1); root.add(l); }
    root.add(back.target);
    if (G.camera && G.camera.far < 1100) { G.camera.far = 1100; G.camera.updateProjectionMatrix(); }
    /* Nothing over 3.15 m can be stood on. Every top that high with open sky over it (a ruined wall broken off, the
       coping of a garden wall, a post, a wall's head under a roof that stops shots only) is carried up to 12 m by a box
       for players only. Where a top has something over it within 2.6 m it is the
       sill of an opening or a floor under a ceiling, and stays as it is; this is decided per 25 cm square, so a top
       only partly covered is capped where it is open. Round a veranda (3.0 m) the wall tops up to 4.0 m are left open,
       so a player can jump or vault from it over the wall and drop outside; from there nothing higher is open.
       Shots, grenades and the walk grid do not see these. */
    { const ph = G.physics, all = ph.boxes.filter(b => !b.bulletOnly && !b.capOf), list = all.filter(b => b.max.y >= 3.15 && b.max.y < 12), caps = [], C = 0.25;
      // square by square (25 cm): a top only partly covered (a broken wall stepping up, a coping under the corner of a house) is capped where it is open
      for (const b of list) {
        const above = all.filter(c => c !== b && c.min.y >= b.max.y - 0.01 && c.min.y < b.max.y + 2.6 && c.min.x < b.max.x && c.max.x > b.min.x && c.min.z < b.max.z && c.max.z > b.min.z);
        const nx = Math.max(1, Math.ceil((b.max.x - b.min.x) / C - 1e-6)), nz = Math.max(1, Math.ceil((b.max.z - b.min.z) / C - 1e-6)), sx = (b.max.x - b.min.x) / nx, sz = (b.max.z - b.min.z) / nz;
        for (let j = 0; j < nz; j++) {
          let run = -1;
          for (let i = 0; i <= nx; i++) {
            const x = b.min.x + (i + 0.5) * sx, z = b.min.z + (j + 0.5) * sz;
            const open = i < nx && !above.some(c => x > c.min.x && x < c.max.x && z > c.min.z && z < c.max.z) && !(b.max.y <= F1 + 1.0 && b.max.x - b.min.x > 0.3 && b.max.z - b.min.z > 0.3 && VERANDAS.some(r => inRect(x, z, r, 2.5)));   // wall tops, not posts
            if (open && run < 0) run = i;
            if (!open && run >= 0) { caps.push([b.min.x + run * sx, b.max.y, b.min.z + j * sz, b.min.x + i * sx, 12, b.min.z + (j + 1) * sz]); run = -1; }
          }
        }
      }
      for (const c of caps) { const k = ph.addBox([c[0], c[1], c[2]], [c[3], c[4], c[5]], { surface: 'concrete', playerOnly: true, noNav: true }); if (k) k.capOf = true; } }
    const sp = (x, z) => ({ pos: new T.Vector3(x, 0, z), zone: 'village', type: 'ground' });
    let clock = 0, fill = 1.1; const fwd = new T.Vector3();
    // the sky is bright all round; left at the game's strength its light would flatten every shadow. The game sets the
    // strength again when it finishes starting, so it is held here for the first seconds and on every frame of play
    const ENV = 0.42, hold = () => { if (G.scene.environmentIntensity !== ENV) G.scene.environmentIntensity = ENV; };
    hold(); { let n = 0; const tick = () => { hold(); if (++n < 600) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
    return {
      root, name: 'Alpine',
      playerStart: { pos: new T.Vector3(-34, 0, 0), yaw: -Math.PI / 2 },
      objectives: [], extraction: { pos: new T.Vector3(0, -50, 0), radius: 1 },
      enemySpawns: built.spawns.map(([x, z]) => sp(x, z)),
      vaultMax: 1.95,   // web/vault.js: the blocks are up to 1.95 m, and placed so nothing more comes within reach from their tops
      zones: [{ name: 'village', min: [-40, -30], max: [40, 30] }], interiorBoxes: [], coverPoints: [], skylights: [], shedLights: [], placed: built.placed,
      cinematicPath: [
        { pos: [-33, 1.7, 0.5], look: [-10, 3, 0] }, { pos: [-22, 1.8, 1.5], look: [-6, 4, -3] }, { pos: [-9, 1.9, -2], look: [3, 2.5, -14] }, { pos: [-2, 2.2, -12], look: [16, 8, -18] },
        { pos: [9, 1.9, -6], look: [22, 6, -14] }, { pos: [21, 1.8, -2], look: [26, 9, -14] }, { pos: [23, 1.8, 8], look: [10, 4, 9] }, { pos: [8.5, 1.8, 15.5], look: [-8, 3.5, 15] },
        { pos: [-7, 1.8, 15.5], look: [-14, 3, 8] }, { pos: [-20.5, 1.8, 9], look: [-28, 3.5, 0] },
      ],
      explosives: [], explosivesOnly: true, ambience: { sea: 0, harbour: false, rain: 0, wind: 0 },
      stats: { ...meshes, plants: PLANTS.tris, shadow, sky },
      groundSurfaceAt: (x, z) => (heap(x, z) > 0.02 ? 'concrete' : groundKind(x, z) === 'cobble' ? 'concrete' : 'dirt'),
      update(dt) {
        clock += dt; PLANTS.update(clock); EXTRAS.update(clock); hold();
        if (G.render.sunDir && G.camera) { const d = G.camera.getWorldDirection(fwd), e = Math.max(0, d.x * G.render.sunDir.x + d.z * G.render.sunDir.z); fill += (1.1 + 0.6 * e * e - fill) * Math.min(1, dt * 2.5); G.render.viewFill = fill; }
      },
    };
  }

  MAPS.alpine = {
    id: 'alpine', name: 'Alpine', boot: ['Laying the cobbles', 'Raising the houses', 'Sowing the green', 'Opening the valley'],
    pre, level,
    async backdrop() { return { stub: true, update() {} }; },
    // the game's ground also carries the rain: keep the object, hide the harbour's apron and sea, and let no rain fall
    async ground(G, base) {
      const g = await base();
      g.apron.visible = false; g.sea.visible = false;
      g.root.children.forEach((c, i) => { if (i === 2 && c !== g.rain) c.visible = false; });
      g.setRain(0);
      if (g.planar) g.planar.enabled = false;                    // the harbour draws the world upside down each frame for its puddles; there are none here
      g.isPuddle = () => false; g.puddleDepth = () => -0.2; g.wetnessAt = () => 0;
      return g;
    },
    _debug: { PLAY, HOUSES, HEAPS, BUSHES, heap, groundKind, cobbleAt, turfAt },
  };
})();
