/* Saltline map: Area 51. A fenced motor-pool compound in the desert at midday: two long barracks of peeling plaster, a
   comm block under a lattice tower, two corrugated hangars on a concrete apron, a stores yard of containers and a gate
   with a yard office.

   STAGE 1 of 6 (see ~/Documents/Irfan/COD-refs/area51/PLAN.md): the whole layout, outside only, built to play.
   Every building is sealed; its windows and doors are real openings 15 cm deep with the glass or door at the back, so a
   later stage can open the ground floors without touching the facades. Vehicles and props are their true outlines in
   plain materials; detail, the photo backdrop and the sunbeams come in the later stages.

   How it holds together (the rules are Alpine's):
   - Everything solid is a box, drawn as it collides. What is out of reach and not a box (roof slopes, the tower, high
     beams) stops shots as the triangles it is drawn with (HI, tested in installPhysics).
   - Nothing over 3.15 m can be stood on: every top that high with open sky over it is carried up to 12 m by a box for
     players only (the caps, at the end of level()). The highest places a player can stand are the balcony (3.0 m), the
     containers (2.59 m) and the vehicles' roofs.
   - The fence is the edge. On its line, and round the forecourt outside the gate, stands a wall for players only up to
     12 m, so nothing near the fence (a container, a crate, the tank) is a way out.
   - Soft roofs (the picnic canopy, the awnings, the camo net, the shade sails) have a slab for players under them, so a
     head never passes through the cloth. Where a player can drop onto one from a roof (the picnic canopy, the camo net) the
     slab follows the cloth in steps and is walked on; so does the sails' over the dock, reached from the containers' roofs.
   - The game's walk grid covers only the harbour, so isWalkable is answered here (as Maram does).
   - _debug.reach() lists every top a player can reach by walking, jumping, stepping and vaulting, and flags any over
     3.15 m or outside the fence. Its report must be empty.

   The game reaches this file through the map hooks (scripts/map-hooks.mjs) and window.__G, like the other maps. */
(() => {
  'use strict';
  const MAPS = (window.__SALTLINE_MAPS = window.__SALTLINE_MAPS || {});

  /* ------------------------------------------------------------------ small maths */
  const TAU = Math.PI * 2, clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t;
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash(i, j = 0, k = 0) { let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(k | 0, 2147483647)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function noise2(x, z) { const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz); return lerp(lerp(hash(xi, zi), hash(xi + 1, zi), u), lerp(hash(xi, zi + 1), hash(xi + 1, zi + 1), u), v); }
  const fbm2 = (x, z, o = 4) => { let s = 0, a = 0.5, n = 0; for (let i = 0; i < o; i++) { s += a * noise2(x, z); n += a; x *= 2.03; z *= 2.03; a *= 0.5; } return s / n; };

  /* ------------------------------------------------------------------ the plan, in metres
     x runs west to east, z north to south; the gate is on the west side. Measured from Irfan's picture from above
     (13 px to the metre). */
  const SUN = { az: 70, el: 51.2 };                         // high in the south-east, where the photograph's sun is (51° up); shadows fall north-west
  const WORLD = { x0: -64, z0: -48, x1: 52, z1: 46 };
  const FENCE = { x0: -51, x1: 47, z0: -41.5, z1: 40.5, gate: [10, 16.5], cham: [-51, 18, -38, 40.5] };   // the south-west corner runs on a slant
  const FORE = { x0: -60, z0: 3, x1: -51, z1: 18 };        // the forecourt outside the gate, in play
  const chamX = z => FENCE.cham[0] + (z - FENCE.cham[1]) * (FENCE.cham[2] - FENCE.cham[0]) / (FENCE.cham[3] - FENCE.cham[1]);
  // inside the fence or the forecourt
  function inPlay(x, z, pad = 0) {
    if (x > FORE.x0 + pad && x <= FENCE.x0 && z > FORE.z0 + pad && z < FORE.z1 - pad) return true;
    if (x < FENCE.x0 + pad || x > FENCE.x1 - pad || z < FENCE.z0 + pad || z > FENCE.z1 - pad) return false;
    return !(z > FENCE.cham[1] && x < chamX(z) + pad);
  }
  const TAN = [1.14, 0.97, 0.76], TAN2 = [1.1, 0.93, 0.74], GREYTAN = [0.98, 0.93, 0.84], GREY = [0.86, 0.86, 0.84], DARK = [0.3, 0.3, 0.29];
  /* Buildings: [x0, z0, x1, z1], height, storeys. doors: [side, along, width, storey, bottom]; the bottom is the storey's
     floor unless given (the barracks' doors onto the balcony stand on its deck, 3.0 m). All sealed in this stage. */
  const BUILDINGS = [
    { id: 'A', name: 'north barracks', at: [-35.5, -35.5, 8.5, -23], H: 7.2, floors: 2, tint: TAN, doors: [['s', 1.5, 1.8, 0], ['s', -24.5, 1.8, 0], ['s', -32, 1.0, 1, 3.0], ['s', -26.5, 1.0, 1, 3.0], ['w', -29, 1.0, 1, 3.0], ['n', -10, 1.0, 0], ['n', -26, 1.0, 0]] },
    { id: 'B', name: 'annex', at: [8.5, -33.5, 17.7, -24.6], H: 4.0, floors: 1, tint: TAN2, roof: true, doors: [['s', 13.1, 1.0, 0]] },
    { id: 'C', name: 'east wing', at: [21.5, -38, 32, -7], H: 7.2, floors: 2, tint: GREYTAN, doors: [['w', -25, 1.8, 0], ['w', -13, 1.0, 0], ['e', -22, 1.0, 0]] },
    { id: 'D', name: 'comm block', at: [22, -7, 34, 4], H: 4.2, floors: 1, tint: GREY, roof: true, mat: 'wallc', winW: 1.6, doors: [['w', -4.6, 1.0, 0], ['w', -1.4, 1.0, 0], ['n', 33, 1.0, 0]] },
    { id: 'E', name: 'black bunker', at: [32, -39, 39, -33.5], H: 3.6, floors: 1, tint: DARK, roof: true, mat: 'wallc', noWin: 'nsew', parapet: 0.45, doors: [['s', 37.5, 1.0, 0]] },
    { id: 'F', name: 'dish bunker', at: [35, -18.5, 43, -12], H: 3.4, floors: 1, tint: [0.84, 0.84, 0.82], roof: true, mat: 'wallc', parapet: 0.45, noWin: 'ne', doorTint: [0.36, 0.4, 0.26], doors: [['w', -16.6, 1.0, 0]] },
    { id: 'I', name: 'yard office', at: [-54, 6.4, -51.1, 9.4], H: 2.7, floors: 1, tint: [1.02, 0.98, 0.9], mat: 'wallc', parapet: 0.2, winW: 1.5, doors: [['n', -52.6, 0.9, 0]] },
  ];
  /* The bunkers' parapets are 45 cm (53 cm with the coping): under the game's 42 cm step a ledge lifted a player brushing past it onto it in one
     frame (38 cm, a jolt he felt walking the roof's edge, 24 Nov). Every walked-on roof's ledge stands over the step. */
  /* Stairs to the roofs (121-123): a steel stair up the wall of a two-storey block to a landing at roof height, and a gap in the
     parapet there. Each is the balcony stair carried higher: the same treads (30 cm deep, a rise just under 25 cm), the same rails
     (jumped and vaulted over, never stood on). u0 is where the first tread starts along the wall, dir which way it climbs.
     A building with a stair has a roof to walk on, and so has every lower flat roof beside one (roof: true), to drop onto:
     their roofs and wall heads are not capped, their parapets are ledges (stood on, walked along, jumped or vaulted over), and what
     stands on them is measured from the roof, as the ground's things are from the ground (24 Nov: he must be able to jump
     off any side and over anything up there). */
  const STAIR = { W: 1.1, GAP: 0.05, RUN: 0.3, N: 29, LAND: 1.2 };
  const ROOF_STAIRS = [
    { b: 'A', side: 'n', u0: 6.6, dir: -1 },       // the barracks, from the alley behind it (123)
    { b: 'C', side: 'n', u0: 22.1, dir: 1 },       // the east wing, from the alley by the fence (122)
    { b: 'C', side: 'e', u0: -8.6, dir: -1 },      // the east wing, from the gap by the dish bunker (121)
  ];
  const stairTop = st => { const a = st.u0 + (STAIR.N - 1) * STAIR.RUN * st.dir, b = a + STAIR.LAND * st.dir; return [Math.min(a, b), Math.max(a, b)]; };     // the landing, along the wall
  const HANGARS = [
    { id: 'G1', name: 'workshop', at: [6, 14, 26, 24], eave: 4.8, ridge: 6.8, monitor: true },
    { id: 'G2', name: 'wash bay', at: [6, 27, 26, 37], eave: 4.8, ridge: 6.8, leanTo: true },
  ];

  /* The painted signs, one sheet of 2 x 8 cells (makeMaterials draws it, signQuad in build() puts a cell on a wall). Stage 4
     uses the cells from 5 on (vehicle plates, the water, power and generator plates). */
  const SIGNS = [
    { bg: '#e6e0cf', fg: '#1f2b23', num: '01', small: 'MOTOR POOL', big: 'WORKSHOP' },            // 0  the workshop's west gable (3, 20)
    { bg: '#e6e0cf', fg: '#1f2b23', num: '02', small: 'MOTOR POOL', big: 'WASH BAY' },            // 1  the wash bay's (46)
    { bg: '#26402f', fg: '#efe9d6', small: 'DELIVERY WINDOW', big: 'YARD OFFICE' },               // 2  the booth (34-36)
    { bg: '#f0ede4', fg: '#1b1b1b', small: 'MOTOR TRANSPORT', big: 'DELIVERIES \u2192', under: 'YARD OFFICE', size: 40 },   // 3  the forecourt (33)
    { bg: '#59603f', fg: '#f1ecdd', big: '02', size: 92 },                                         // 4  the dish bunker's door (8)
    { bg: '#1f4f8c', fg: '#ffffff', big: 'WATER', size: 74 },                                      // 5
    { bg: '#e6c01e', fg: '#151515', big: 'POWER', size: 74 },                                      // 6
    { bg: '#3b4334', fg: '#efe9d6', num: 'AUX', big: '02', size: 74 },                             // 7
    { bg: '#e6c01e', fg: '#151515', num: '04', small: 'STORES', big: 'YARD LIFT' },                // 8
    { bg: '#f3f1e8', fg: '#111111', big: 'YD 06', size: 86 },                                      // 9
    { bg: '#f3f1e8', fg: '#111111', big: 'YD 12', size: 86 },                                      // 10
  ];

  /* ------------------------------------------------------------------ before the game reads its constants */
  function pre(G) {
    const { world, sun, sky } = G.consts, el = SUN.el * Math.PI / 180, az = SUN.az * Math.PI / 180;
    world.quayX = 1e6;                                              // no quay and no sea: the ground runs everywhere
    world.min.set(WORLD.x0, 0, WORLD.z0); world.max.set(WORLD.x1, 40, WORLD.z1);
    sun.dir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    sun.color.setRGB(1.0, 0.94, 0.84);                              // a hard white desert sun
    sun.intensity = 7.0;
    sky.horizon.setRGB(0.86, 0.86, 0.9); sky.horizonAway.setRGB(0.62, 0.72, 0.92); sky.fog.setRGB(0.84, 0.82, 0.8);
    if (sky.zenith) sky.zenith.setRGB(0.16, 0.34, 0.82);
  }

  /* ------------------------------------------------------------------ materials
     Plaster and earth are Valle Morta's pictures (in maps/alpine/tex, MIT); everything else is one of the game's own
     materials, tinted by the colour of each point. */
  const TEX = '/maps/alpine/tex/';
  /* The yard's wheel tracks (112, 116): where lorries have swung in from the gate, round the middle and off to the
     hangars and the barracks, pass after pass. Each route is a soft dark band with a pair of ruts in it, drawn two or three
     times a little apart; under the parked lorries the ground is darker gravel. Painted once into one picture laid over
     the yard: nothing is drawn where concrete lies or outside the slanted corner. */
  const TRACK_RECT = [FENCE.x0, FENCE.z0, FENCE.x1, FENCE.z1];
  const TRACKS = [
    [[-51, 13.2], [-44, 13], [-34, 10], [-22, 6.5], [-13, 9], [-6, 17]],
    [[-51, 13.2], [-45, 11], [-38, 2], [-30, -8], [-18, -13.5], [-4, -13.5], [8, -10], [16, -2], [18.5, 7]],
    [[-7, 3], [-10.5, 10.5], [-19, 12.5], [-27, 9], [-30, 1], [-25, -6], [-16, -8.5], [-9, -5], [-5, 2]],
    [[-14, 10], [-12.5, 18], [-9.5, 24], [-6, 29]],
    [[18.5, 7], [30, 8.5], [40, 10], [43.5, 1], [42, -8]],
    [[-45, 11], [-46.5, 0], [-44, -12], [-38, -16.5], [-28, -15]],
    [[12, -7], [2, -8.5], [-8, -3], [-17, 4]],
    [[-44, 30], [-33, 25.5], [-21, 27], [-11, 25.5], [-6, 22]],
    [[-30, -8], [-22, 1], [-20, 12], [-24, 22], [-33, 25.5]],
    [[16, -2], [10, 6], [2, 9], [-6, 14]],
  ];
  function paintTracks(g, W, H) {
    const [X0, Z0, X1, Z1] = TRACK_RECT, sx = W / (X1 - X0), sz = H / (Z1 - Z0), px = (x, z) => [(x - X0) * sx, H - (z - Z0) * sz], r = rng(6116);
    const curve = pts => { const out = []; for (let k = 0; k + 1 < pts.length; k++) { const p0 = pts[Math.max(0, k - 1)], p1 = pts[k], p2 = pts[k + 1], p3 = pts[Math.min(pts.length - 1, k + 2)];
        for (let t = 0; t < 1; t += 0.05) { const t2 = t * t, t3 = t2 * t; out.push([0, 1].map(i => 0.5 * (2 * p1[i] + (p2[i] - p0[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (3 * p1[i] - p0[i] - 3 * p2[i] + p3[i]) * t3))); } }
      out.push(pts[pts.length - 1]); return out; };
    const shifted = (line, off) => line.map((p, k) => { const a = line[Math.max(0, k - 1)], b = line[Math.min(line.length - 1, k + 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [p[0] - dz / l * off, p[1] + dx / l * off]; });
    const stroke = (line, w, style) => { g.strokeStyle = style; g.lineWidth = w * sx; g.lineCap = g.lineJoin = 'round'; g.beginPath(); line.forEach((p, k) => { const q = px(p[0], p[1]); if (k) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.stroke(); };
    // darker gravel where the lorries stand and turn
    for (const [x, z, rad] of [[-13.5, 7, 7], [-13, 16.5, 7], [-17, 23, 5], [-10.5, 24.5, 5], [-31, 0.5, 6], [-22, 12, 8], [-6, 6, 6], [-40, 12.5, 4], [10, -6, 5], [-18, 2, 9]]) for (let k = 0; k < 5; k++) {
      const q = px(x + (r() - 0.5) * rad, z + (r() - 0.5) * rad), R = rad * (0.45 + 0.5 * r()) * sx, gr = g.createRadialGradient(q[0], q[1], R * 0.15, q[0], q[1], R); gr.addColorStop(0, 'rgba(58,55,50,0.2)'); gr.addColorStop(1, 'rgba(58,55,50,0)'); g.fillStyle = gr; g.fillRect(q[0] - R, q[1] - R, R * 2, R * 2); }
    for (const route of TRACKS) for (let pass = 0; pass < 3; pass++) {
      const line = shifted(curve(route.map(([x, z]) => [x + (r() - 0.5) * 1.2, z + (r() - 0.5) * 1.2])), (r() - 0.5) * 1.6), dark = 0.75 + 0.5 * r();
      stroke(line, 3.6, `rgba(52,42,32,${(0.035 * dark).toFixed(3)})`);                              // the swept band
      for (const off of [-0.95, 0.95]) { const rut = shifted(line, off);
        stroke(rut, 0.8, `rgba(48,38,28,${(0.05 * dark).toFixed(3)})`); stroke(rut, 0.48, `rgba(44,35,26,${(0.075 * dark).toFixed(3)})`); stroke(rut, 0.24, `rgba(40,31,23,${(0.09 * dark).toFixed(3)})`);
        stroke(shifted(line, off * 1.75), 0.3, `rgba(226,214,190,${(0.05 * dark).toFixed(3)})`); }   // the dust thrown to the side of each rut, paler
    }
    // nothing on the concrete, nothing outside the slanted corner
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
    for (const [a, b, c, d] of GROUND_SLABS) { const p = px(a, d), q = px(c, b); g.fillRect(p[0], p[1], q[0] - p[0], q[1] - p[1]); }
    { const c = FENCE.cham, P = [px(c[0], c[1]), px(c[2], c[3]), px(c[0], c[3])]; g.beginPath(); g.moveTo(...P[0]); g.lineTo(...P[1]); g.lineTo(...P[2]); g.closePath(); g.fill(); }
    g.globalCompositeOperation = 'source-over';
  }
  async function makeMaterials(G) {
    const T = G.THREE, loader = new T.TextureLoader(), aniso = Math.min(8, G.renderer.capabilities.getMaxAnisotropy ? G.renderer.capabilities.getMaxAnisotropy() : 1), mats = {};
    const one = async (file, srgb, tile) => { const t = await loader.loadAsync(TEX + file + '.jpg'); t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace; t.anisotropy = aniso; t.repeat.set(1 / tile, 1 / tile); return t; };
    const own = async (name, file, tile, macro, color = 0xffffff) => {
      const [albedo, normal, orm] = await Promise.all([one(file + '_col', true, tile), one(file + '_nrm', false, tile), one(file + '_arh', false, tile)]);
      const src = G.mats.get('concrete', { vertexColors: true }), m = src.clone();
      m.map = albedo; m.normalMap = normal; m.roughnessMap = m.metalnessMap = m.aoMap = orm; m.color.set(color); m.roughness = 1; m.metalness = 0; m.normalScale.set(1.2, 1.2); m.vertexColors = true;
      m.defines = { ...src.defines };
      const uniforms = { uSlWet: G.mats.uniforms.wet, uSlWetP: { value: new T.Vector4(0.3, 0.5, 0.6, 0) }, uSlMacro: { value: new T.Vector4(...macro) }, uSlUv: { value: new T.Vector3(1, 1, albedo.image.width) }, uSlX: { value: new T.Vector2(1, 0) } };
      m.onBeforeCompile = shader => { src.onBeforeCompile(shader); Object.assign(shader.uniforms, uniforms); };
      m.customProgramCacheKey = src.customProgramCacheKey; m.name = 'a51_' + name;
      return (mats[name] = m);
    };
    /* The quality the map's own shaders draw at (0 low, 1 medium, 2 high, 3 ultra), kept in step with the game's setting every frame (the
       level's update). High and Ultra must look it (he could see no difference, 24 Nov): what each adds is listed where it is drawn */
    mats.q = { value: 2 };
    /* Sunlight through cloth and leaves (High and Ultra): with the sun behind a sail, a canvas or a leaf, it glows with the light coming
       through, most when the sun is straight behind it, less where it is edge-on to the sun */
    mats.backlit = (m, k = 0.55) => { const ob = m.onBeforeCompile, own0 = ob && ob !== T.Material.prototype.onBeforeCompile, pk = m.customProgramCacheKey && m.customProgramCacheKey !== T.Material.prototype.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : null;
      m.onBeforeCompile = (sh, r) => { if (own0) ob.call(m, sh, r); const E = '#include <lights_fragment_end>'; if (sh.fragmentShader.split(E).length !== 2) return; sh.uniforms.uA51Q = mats.q;
        sh.fragmentShader = 'uniform float uA51Q;\n' + sh.fragmentShader.replace(E, E + `
  #if NUM_DIR_LIGHTS > 0
  if (uA51Q > 1.5) { vec3 blL = directionalLights[0].direction; float blB = pow(max(dot(-geometryViewDir, blL), 0.0), 3.0) * (0.55 + 0.45 * (1.0 - abs(dot(geometryNormal, blL))));
    reflectedLight.directDiffuse += directionalLights[0].color * diffuseColor.rgb * blB * ${k.toFixed(2)}; }
  #endif`); };
      m.customProgramCacheKey = () => (pk ? pk() : m.name || m.uuid) + '|a51bl'; return m; };
    await Promise.all([own('plaster', 'plaster_old', 4, [0.16, 0.08, 0.22, 0.4]), own('yard', '../../area51/tex/mud', 4, [0.2, 0.1, 0.1, 0.2]), own('desert', '../../area51/tex/rock', 11, [0.3, 0.12, 0.06, 0.15])]);
    mats.yard.polygonOffset = true; mats.yard.polygonOffsetFactor = -1; mats.yard.polygonOffsetUnits = -2;      // the yard lies over the desert inside the fence
    /* The ground's colour. The two pictures are an orange mud and a pink rock; the place is pale, dusty sand. Each is drawn
       part-way to its own grey and then gained: [how much of the picture's colour is kept, red, green, blue]. [1, 1, 1, 1]
       gives the pictures back as they come. */
    const LOOK = { yard: [0.42, 1.2, 1.15, 1.07], desert: [0.45, 1.06, 1.05, 1.02] };
    const pale = ([k, r, g, b]) => `sampledDiffuseColor.rgb = mix(vec3(dot(sampledDiffuseColor.rgb, vec3(0.3, 0.59, 0.11))), sampledDiffuseColor.rgb, ${k.toFixed(3)}) * vec3(${r.toFixed(3)}, ${g.toFixed(3)}, ${b.toFixed(3)});`;
    /* Ultra: within 16 m the ground gets a second, finer grain of its own picture (four or five times smaller, turned) in its colour and
       its relief, fading out by distance, so the stones underfoot stay sharp; anisotropic filtering goes to the card's most (see the
       level's update). High and Ultra: the yard's 4 m repeat is broken by a turned copy mixed in by a slow noise, as the desert's is */
    const MICRO = `
  float slMd = uA51Q > 2.5 ? 1.0 - smoothstep(5.0, 16.0, length(vViewPosition)) : 0.0; vec2 slQ3 = mat2(0.62, -0.785, 0.785, 0.62) * slUv * 4.7 + vec2(0.13, 0.71);
  if (slMd > 0.001) { float slDl = dot(texture2D(map, slQ3).rgb, vec3(0.3, 0.59, 0.11)), slDa = dot(textureLod(map, slQ3, 12.0).rgb, vec3(0.3, 0.59, 0.11)); sampledDiffuseColor.rgb *= mix(1.0, clamp(0.45 + 0.55 * slDl / max(slDa, 0.02), 0.6, 1.4), 0.8 * slMd); }`, NRM = 'vec3 mapN = texture2D(normalMap, slUv).xyz * 2.0 - 1.0;', NRM2 = `vec3 mapN = texture2D(normalMap, slUv).xyz * 2.0 - 1.0;
  if (slMd > 0.001) { vec3 slN2 = texture2D(normalMap, slQ3).xyz * 2.0 - 1.0; mapN.xy += slN2.xy * 1.05 * slMd; }      // the stones' fine relief up close (Ultra)`;
    { const m = mats.yard, ob = m.onBeforeCompile, A = 'vec4 sampledDiffuseColor = texture2D(map, slUv);', B = 'slORM = texture2D(roughnessMap, slUv);';
      m.onBeforeCompile = (shader, r) => { ob(shader, r); const f = shader.fragmentShader; if (f.split(A).length !== 2 || f.split(B).length !== 2) { console.warn('[area51] the yard shader anchor moved; the yard keeps the picture\'s own colour'); return; }
        shader.uniforms.uA51Q = mats.q;
        let g = 'uniform float uA51Q;\n' + f.replace(A, `vec2 slQ2 = mat2(0.799, 0.602, -0.602, 0.799) * slUv * 0.87 + vec2(0.37, 0.61); float slTb = uA51Q > 1.5 ? smoothstep(0.3, 0.7, slN3(vec3(vSlPos.xz * 0.07, 2.3))) : 0.0;
  vec4 sampledDiffuseColor = texture2D(map, slUv); if (slTb > 0.001) sampledDiffuseColor = mix(sampledDiffuseColor, texture2D(map, slQ2), slTb);
  ` + pale(LOOK.yard) + MICRO).replace(B, 'slORM = texture2D(roughnessMap, slUv); if (slTb > 0.001) slORM = mix(slORM, texture2D(roughnessMap, slQ2), slTb);');
        if (g.split(NRM).length === 2) g = g.replace(NRM, NRM2); else console.warn('[area51] the ground normal anchor moved; no fine relief up close');
        shader.fragmentShader = g; };
      m.customProgramCacheKey = () => 'a51-yard'; }
    { // the desert picture repeats every 11 m, and from the roofs its pale patches line up into a grid: a second copy, turned
      // and shifted, is mixed in by a slow noise, and far off both fade towards the picture's average colour
      const m = mats.desert, ob = m.onBeforeCompile;
      m.onBeforeCompile = (shader, r) => { ob(shader, r);
        const A = 'vec4 sampledDiffuseColor = texture2D(map, slUv);', B = 'slORM = texture2D(roughnessMap, slUv);', f = shader.fragmentShader;
        if (f.split(A).length !== 2 || f.split(B).length !== 2) { console.warn('[area51] the desert shader anchors moved; its picture repeats in a grid'); return; }
        shader.uniforms.uA51Q = mats.q;
        let g = 'uniform float uA51Q;\n' + f.replace(A, `vec2 slQ2 = mat2(0.799, 0.602, -0.602, 0.799) * slUv * 0.87 + vec2(0.37, 0.61);
  float slTb = smoothstep(0.3, 0.7, slN3(vec3(vSlPos.xz * 0.055, 4.1)));
  vec4 sampledDiffuseColor = mix(texture2D(map, slUv), texture2D(map, slQ2), slTb);
  sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, textureLod(map, slUv, 12.0).rgb, 0.8 * smoothstep(35.0, 200.0, length(vViewPosition)));
  ` + pale(LOOK.desert) + `
  if (uA51Q > 1.5) sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, vec3(0.74, 0.77, 0.82), 0.38 * smoothstep(80.0, 700.0, length(vViewPosition)));      // the air between: the far desert fades toward the sky (High, Ultra)` + MICRO)
          .replace(B, 'slORM = mix(texture2D(roughnessMap, slUv), texture2D(roughnessMap, slQ2), slTb);');
        if (g.split(NRM).length === 2) g = g.replace(NRM, NRM2); else console.warn('[area51] the ground normal anchor moved; no fine relief up close');
        shader.fragmentShader = g; };
      m.customProgramCacheKey = () => 'a51-desert'; }
    const game = { concrete: 'concrete', slab: 'concrete_dirty', corr: 'corrugated_roof', link: 'chainlink', galv: 'steel_galv', steel: 'steel_dark', worn: 'steel_worn', rust: 'steel_rust', paint: 'paint_white', tarp: 'tarp', tire: 'tire', wood: 'wood_pallet', hazard: 'hazard_stripes' };
    for (const [k, v] of Object.entries(game)) mats[k] = G.mats.get(v, { vertexColors: true });
    const plain = (name, color, rough, metal, extra = {}) => { const m = new T.MeshStandardMaterial({ color, roughness: rough, metalness: metal, vertexColors: true, ...extra }); m.name = 'a51_' + name; return (mats[name] = m); };
    plain('glass', 0x161b20, 0.14, 0.7); mats.glass.envMapIntensity = 0.75;          // a window, not a mirror: at a low sun it flared white (120)
    mats.backlit(plain('cloth', 0xffffff, 0.95, 0, { side: T.DoubleSide }), 0.45);
    plain('stone', 0xffffff, 0.9, 0);
    // desert scrub: one picture of twiggy sprays with small grey-olive and ochre leaves, on nothing (see buildPlants)
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
    const c2 = cv.getContext('2d'), rl = rng(5150);
    for (let k = 0; k < 13; k++) {          // twigs from the base outward
      const a = -Math.PI / 2 + (rl() - 0.5) * 2.2, L = 90 + rl() * 120; c2.strokeStyle = 'rgb(74,62,48)'; c2.lineWidth = 2.6; c2.beginPath(); c2.moveTo(128, 250); c2.quadraticCurveTo(128 + Math.cos(a) * L * 0.4, 250 + Math.sin(a) * L * 0.6, 128 + Math.cos(a) * L, 250 + Math.sin(a) * L); c2.stroke();
    }
    for (let k = 0; k < 520; k++) {       // leaves: small, dull and dark against the pale ground, the sprays open enough to see through
      const a = rl() * TAU, d = (0.06 + 0.94 * Math.sqrt(rl())) * 112, x = 128 + Math.cos(a) * d, y = 140 + Math.sin(a) * d * 0.9, len = 3.5 + rl() * 5, g = 62 + rl() * 58, dry = rl() < 0.35;
      c2.save(); c2.translate(x, y); c2.rotate(rl() * TAU); c2.fillStyle = dry ? `rgb(${g * 1.12 | 0},${g * 0.94 | 0},${g * 0.56 | 0})` : `rgb(${g * 0.74 | 0},${g * 0.84 | 0},${g * 0.5 | 0})`;
      c2.beginPath(); c2.ellipse(0, 0, len, len * 0.38, 0, 0, TAU); c2.fill(); c2.restore();
    }
    const leaf = new T.CanvasTexture(cv); leaf.colorSpace = T.SRGBColorSpace; leaf.anisotropy = 4;
    plain('scrub', 0xffffff, 0.85, 0, { side: T.DoubleSide, map: leaf, alphaTest: 0.5 });

    /* Weathering, worked out per pixel in world space and added to the game's own shader after its colour step (Stage 3):
       - walls: the coat peeled off in patches (the render under it lighter, a dark rim round it), dark streaks running
         down from under the roof line, earth splashed up the foot (1, 5, 12, 13);
       - corrugated roofs: rust in blotches (3, 20, 21). */
    const tops = BUILDINGS.map(b => [b.at, b.H + (b.parapet != null ? b.parapet : 0.6)]);
    while (tops.length < 8) tops.push([[1e5, 1e5, 1e5, 1e5], 0]);
    const WEATHER = `
{ vec3 wp = vSlPos; float top = 99.0;
  for (int i = 0; i < 8; i++) { vec4 r = uWB[i]; if (wp.x > r.x - 0.4 && wp.x < r.z + 0.4 && wp.z > r.y - 0.4 && wp.z < r.w + 0.4) top = uWH[i]; }
  float al = wp.x + wp.z, hi = smoothstep(0.3, 2.4, wp.y);
  float n = (slN3(vec3(al * 1.3, wp.y * 1.3, 3.1)) * 0.55 + slN3(vec3(al * 4.5, wp.y * 4.5, 5.0)) * 0.3 + slN3(vec3(al * 13.0, wp.y * 13.0, 8.0)) * 0.15) * (1.0 + 0.1 * (1.0 - hi));
  float pe = smoothstep(0.68, 0.69, n) * uWPeel, rim = clamp(smoothstep(0.665, 0.68, n) * uWPeel - pe, 0.0, 1.0);   // small patches, about 6 in 100, more near the foot
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uWUnder + uWAdd, pe);
  diffuseColor.rgb *= 1.0 - 0.22 * rim;
  float st = slN3(vec3(al * 2.4, wp.y * 0.1, 9.0)) * 0.7 + slN3(vec3(al * 7.0, wp.y * 0.3, 2.0)) * 0.3;
  diffuseColor.rgb *= 1.0 - uWStreak * smoothstep(top - 2.8, top - 0.7, wp.y) * smoothstep(0.38, 0.7, st);
  diffuseColor.rgb *= mix(vec3(0.7, 0.63, 0.55), vec3(1.0), smoothstep(0.0, 0.9, wp.y)); }`;
    const RUST = `
{ vec3 wp = vSlPos; float n = slN3(wp * 0.42 + 7.0) * 0.6 + slN3(wp * 1.8 + 1.0) * 0.4;
  float r = smoothstep(0.64, 0.71, n); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.25, 0.13) * (0.7 + 0.6 * slN3(wp * 5.0)), r * 0.7); }`;   // about 10 in 100, brown
    const weather = (m, src, code, extra, key, fadeRibs = false) => {
      const uni = { uWB: { value: tops.map(([r]) => new T.Vector4(r[0], r[1], r[2], r[3])) }, uWH: { value: tops.map(([, h]) => h) }, ...extra };
      const base = m.onBeforeCompile !== T.Material.prototype.onBeforeCompile ? m.onBeforeCompile : sh => src.onBeforeCompile(sh), pk = src.customProgramCacheKey.bind(src);
      m.onBeforeCompile = sh => {
        base(sh); Object.assign(sh.uniforms, uni);
        if (!sh.fragmentShader.includes('#include <color_fragment>') || !sh.fragmentShader.includes('slN3')) { console.warn('[area51] weathering found no place in the shader of', m.name); return; }
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec4 uWB[8]; uniform float uWH[8]; uniform float uWPeel, uWStreak; uniform vec3 uWUnder, uWAdd;').replace('#include <color_fragment>', '#include <color_fragment>\n' + code);
        // the ribs of a corrugated sheet (10 to a tile of its texture) get finer than a few pixels and their lighting breaks into
        // rings: their normal fades to the sheet's own as more than a tenth of a rib falls in a pixel (fwidth), and far off
        // (the game replaces three's normal step with its own; this goes straight after it, before the clearcoat step)
        if (fadeRibs) { const at = '#include <clearcoat_normal_fragment_begin>'; if (sh.fragmentShader.includes(at)) sh.fragmentShader = sh.fragmentShader.replace(at, '{ float cpp = fwidth(vMapUv.x * 10.0); float fdN = max(smoothstep(0.1, 0.35, cpp), smoothstep(16.0, 40.0, length(vViewPosition))); normal = normalize(mix(normal, normalize(vNormal) * faceDirection, fdN)); }\n' + at); else console.warn('[area51] the corrugation has no normal step to fade'); }
      };
      m.customProgramCacheKey = () => pk() + key; return m;
    };
    const wallU = (peel, streak, under, add) => ({ uWPeel: { value: peel }, uWStreak: { value: streak }, uWUnder: { value: new T.Vector3(...under) }, uWAdd: { value: new T.Vector3(...add) } });
    const concrete = G.mats.get('concrete', { vertexColors: true }), corr = G.mats.get('corrugated_roof', { vertexColors: true });
    weather(mats.plaster, concrete, WEATHER, wallU(1, 0.62, [1.24, 1.2, 1.1], [0.02, 0.02, 0.015]), '|a51plaster');
    { const m = concrete.clone(); m.defines = { ...concrete.defines }; m.name = 'a51_wallc'; mats.wallc = weather(m, concrete, WEATHER, wallU(0.7, 0.5, [1.0, 1.0, 0.98], [0.09, 0.09, 0.085]), '|a51wallc'); }
    { const m = corr.clone(); m.defines = { ...corr.defines }; m.name = 'a51_corrR'; mats.corrR = weather(m, corr, RUST, wallU(0, 0, [1, 1, 1], [0, 0, 0]), '|a51rust', true); }
    // the painted signs: one sheet, cells of 512 x 128 (SIGNS)
    { const sc = document.createElement('canvas'); sc.width = 1024; sc.height = 1024; const s2 = sc.getContext('2d'), F = 'Arial, Helvetica, sans-serif';
      SIGNS.forEach((sg, k) => {
        s2.save(); s2.translate((k % 2) * 512, Math.floor(k / 2) * 128);
        s2.fillStyle = sg.bg; s2.fillRect(0, 0, 512, 128); s2.strokeStyle = sg.fg; s2.globalAlpha = 0.85; s2.lineWidth = 5; s2.strokeRect(10, 10, 492, 108); s2.globalAlpha = 1; s2.fillStyle = sg.fg; s2.textBaseline = 'top';
        let tx = 30;
        if (sg.num) { s2.font = `700 ${sg.num.length > 2 ? 46 : 76}px ${F}`; s2.textBaseline = 'middle'; s2.fillText(sg.num, 28, 66); s2.textBaseline = 'top'; tx = 28 + s2.measureText(sg.num).width + 16; s2.fillRect(tx - 2, 26, 4, 76); tx += 18; }
        const rows = []; if (sg.small) rows.push([sg.small, 600, 22]); rows.push([sg.big, 700, sg.size || 46]); if (sg.under) rows.push([sg.under, 600, 22]);
        const gap = 7, tot = rows.reduce((t, r) => t + r[2], 0) + gap * (rows.length - 1); let y = (128 - tot) / 2 + 2;
        const centre = !sg.num && !sg.small;
        for (const [txt, wt, sz] of rows) { s2.font = `${wt} ${sz}px ${F}`; const w = Math.min(s2.measureText(txt).width, 482 - tx); s2.fillText(txt, centre ? (512 - w) / 2 : tx, y, 482 - tx); y += sz + gap; }
        const rr = rng(k * 31 + 7); for (let q = 0; q < 160; q++) { s2.fillStyle = `rgba(${rr() < 0.5 ? '0,0,0' : '205,195,175'},${0.04 + 0.12 * rr()})`; s2.fillRect(rr() * 512, rr() * 128, 2 + rr() * 10, 1 + rr() * 4); }   // a little wear
        s2.restore(); });
      const st = new T.CanvasTexture(sc); st.colorSpace = T.SRGBColorSpace; st.anisotropy = aniso;
      plain('signs', 0xffffff, 0.7, 0, { map: st }); }
    plain('grille', 0x1b1c1d, 0.75, 0.5);
    plain('skylite', 0xaebfc9, 0.3, 0.05);
    /* Stage 4: decals on the ground (a soft blob for oil and gravel, tyre tread for the tracks), thin lines (cracks, joints,
       painted lines), acacia leaf sprays, the camo net with its cut-outs */
    const canvasTex = (w, h, paint, repeat = false) => { const c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h); const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = aniso; if (repeat) t.wrapS = t.wrapT = T.RepeatWrapping; return t; };
    const decal = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 };
    plain('stain', 0xffffff, 0.55, 0, { ...decal, map: canvasTex(128, 128, (g) => { const r = rng(77), grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
      grd.addColorStop(0, 'rgba(255,255,255,0.92)'); grd.addColorStop(0.55, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
      g.globalCompositeOperation = 'destination-out'; for (let k = 0; k < 90; k++) { const a = r() * TAU, d = 28 + r() * 36; g.beginPath(); g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 4 + r() * 12, 0, TAU); g.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.6})`; g.fill(); } }) });
    plain('mud', 0xffffff, 0.34, 0, { ...decal, map: mats.stain.map });      // wet earth round a puddle: dark, and it catches the light
    plain('track', 0xffffff, 0.9, 0, { ...decal, polygonOffsetFactor: -3, polygonOffsetUnits: -6, map: canvasTex(64, 64, (g) => { const gr = g.createLinearGradient(0, 0, 64, 0);       // a band soft at both edges, the tread's bars faint along it
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.28, 'rgba(255,255,255,0.42)'); gr.addColorStop(0.72, 'rgba(255,255,255,0.42)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      for (let y = 0; y < 64; y += 8) { g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(16, y, 32, 4); } }, true) });
    const low = ((G.quality && G.quality.name) || 'high') === 'low';
    plain('tracks', 0xffffff, 1, 0, { ...decal, polygonOffsetFactor: -2, polygonOffsetUnits: -4, map: canvasTex(low ? 1024 : 2048, low ? 856 : 1712, paintTracks) }); mats.tracks.vertexColors = false;
    plain('line', 0xffffff, 0.8, 0, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
    /* The hangars' walls (114): upright boards weathered grey, some warmer, a dark gap between each, the grain running up them,
       rust run down from the nails. One picture 2.4 m square (twelve boards), a joint across its foot, so a wall has one at
       2.4 m and one at the eaves. */
    { const tx = canvasTex(512, 512, (g) => { const r = rng(1414), BW = 512 / 12, PAL = ['#9d9484', '#a69c87', '#8f897c', '#ad9f83', '#958c7b', '#b3a68b', '#8a8376', '#a2977f'];
        for (let b = 0; b < 12; b++) { const x = b * BW; g.fillStyle = PAL[Math.floor(r() * PAL.length)]; g.fillRect(x, 0, BW, 512);
          for (let k = 0; k < 46; k++) { const gx = x + r() * BW, w = 0.6 + r() * 1.6; g.fillStyle = r() < 0.5 ? `rgba(40,34,26,${(0.05 + 0.1 * r()).toFixed(3)})` : `rgba(226,218,200,${(0.04 + 0.1 * r()).toFixed(3)})`; const y0 = r() * 512, len = 120 + r() * 500; g.fillRect(gx, y0, w, len); g.fillRect(gx, y0 - 512, w, len); }   // grain
          if (r() < 0.55) { const gx = x + 6 + r() * (BW - 12), gr = g.createLinearGradient(0, 0, 0, 512), a = 0.1 + 0.16 * r(); gr.addColorStop(0, `rgba(150,96,44,${a.toFixed(3)})`); gr.addColorStop(0.6, `rgba(150,96,44,${(a * 0.5).toFixed(3)})`); gr.addColorStop(1, 'rgba(150,96,44,0)'); g.fillStyle = gr; g.fillRect(gx - 2 - r() * 4, 0, 5 + r() * 9, 512); }   // rust run down a board
          g.fillStyle = 'rgba(40,35,28,0.85)'; g.fillRect(x, 0, 2, 512); g.fillStyle = 'rgba(232,224,206,0.22)'; g.fillRect(x + 2, 0, 1.5, 512);                   // the gap, and the board's lit edge
          for (const y of [26, 250, 486]) { g.fillStyle = 'rgba(46,38,30,0.8)'; g.fillRect(x + BW / 2 - 1, y, 2.5, 2.5); } }                                           // nails
        g.fillStyle = 'rgba(38,33,27,0.8)'; g.fillRect(0, 509, 512, 3); g.fillStyle = 'rgba(232,224,206,0.2)'; g.fillRect(0, 0, 512, 2); }, true);                    // the joint across
      tx.repeat.set(1 / 2.4, 1 / 2.4); plain('timber', 0xffffff, 0.9, 0, { map: tx }); }
    /* Army paint that has been out in the sun (109, 110): olive in two or three tones, dust settled on it, chipped to dark primer and
       bright metal at its edges, scratched, a rust bloom here and there. One picture 1.4 m square. Flat colour read as plastic. */
    { const tx = canvasTex(512, 512, (g) => { const r = rng(5151), wrap = (x, y, rad, fn) => { for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) if (x + ox > -rad && x + ox < 512 + rad && y + oy > -rad && y + oy < 512 + rad) fn(x + ox, y + oy); };
        g.fillStyle = '#6c7651'; g.fillRect(0, 0, 512, 512);
        for (let k = 0; k < 70; k++) { const x = r() * 512, y = r() * 512, rad = 30 + r() * 90, col = ['92,104,70', '124,133,96', '100,110,74', '82,92,62'][Math.floor(r() * 4)], a = 0.12 + 0.2 * r(); wrap(x, y, rad, (px, py) => { const gr = g.createRadialGradient(px, py, 2, px, py, rad); gr.addColorStop(0, `rgba(${col},${a.toFixed(3)})`); gr.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gr; g.fillRect(px - rad, py - rad, rad * 2, rad * 2); }); }
        for (let k = 0; k < 26; k++) { const x = r() * 512, y = r() * 512, rad = 40 + r() * 80, a = 0.06 + 0.1 * r(); wrap(x, y, rad, (px, py) => { const gr = g.createRadialGradient(px, py, 2, px, py, rad); gr.addColorStop(0, `rgba(190,178,146,${a.toFixed(3)})`); gr.addColorStop(1, 'rgba(190,178,146,0)'); g.fillStyle = gr; g.fillRect(px - rad, py - rad, rad * 2, rad * 2); }); }      // dust
        for (let k = 0; k < 520; k++) { const x = r() * 512, y = r() * 512, w = 1 + r() * 3.5, h = 1 + r() * 2.5; g.fillStyle = r() < 0.6 ? `rgba(38,42,30,${(0.35 + 0.5 * r()).toFixed(2)})` : `rgba(176,180,160,${(0.3 + 0.5 * r()).toFixed(2)})`; g.fillRect(x, y, w, h); }                                                    // chips
        for (let k = 0; k < 14; k++) { const x = r() * 512, y = r() * 512, n2 = 6 + Math.floor(r() * 10); for (let j = 0; j < n2; j++) { g.fillStyle = `rgba(34,38,27,${(0.4 + 0.4 * r()).toFixed(2)})`; g.beginPath(); g.ellipse(x + (r() - 0.5) * 26, y + (r() - 0.5) * 18, 2 + r() * 6, 1.5 + r() * 4, r() * 3, 0, TAU); g.fill(); } }                       // a patch of chipping
        g.lineWidth = 0.8; for (let k = 0; k < 70; k++) { const x = r() * 512, y = r() * 512, a = r() * TAU, l = 8 + r() * 40; g.strokeStyle = `rgba(170,176,150,${(0.15 + 0.3 * r()).toFixed(2)})`; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }                                              // scratches
        for (let k = 0; k < 9; k++) { const x = r() * 512, y = r() * 512, rad = 5 + r() * 12; const gr = g.createRadialGradient(x, y, 1, x, y, rad); gr.addColorStop(0, 'rgba(122,78,42,0.6)'); gr.addColorStop(1, 'rgba(122,78,42,0)'); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
          const gl = g.createLinearGradient(0, y, 0, y + 50); gl.addColorStop(0, 'rgba(122,78,42,0.3)'); gl.addColorStop(1, 'rgba(122,78,42,0)'); g.fillStyle = gl; g.fillRect(x - 2, y, 4, 50); } }, true);
      tx.repeat.set(1 / 1.4, 1 / 1.4); plain('mil', 0xffffff, 0.8, 0.08, { map: tx }); }
    /* A flat roof (116, 124): felt laid in strips a metre wide, each seam a darker line with the lap's paler edge beside it,
       patched where it was mended, grit on it, dirt and old water marks. One picture 4 m square. */
    { const tx = canvasTex(1024, 1024, (g) => { const r = rng(7171), S = 256; g.fillStyle = '#b4b0a6'; g.fillRect(0, 0, 1024, 1024);
        for (let k = 0; k < 90; k++) { const x = r() * 1024, y = r() * 1024, rad = 40 + r() * 160, dk = r() < 0.6, a = 0.05 + 0.09 * r();
          for (const ox of [-1024, 0, 1024]) for (const oy of [-1024, 0, 1024]) { if (x + ox < -rad || x + ox > 1024 + rad || y + oy < -rad || y + oy > 1024 + rad) continue; const gr = g.createRadialGradient(x + ox, y + oy, 2, x + ox, y + oy, rad); const c = dk ? '96,90,80' : '214,210,200'; gr.addColorStop(0, `rgba(${c},${a.toFixed(3)})`); gr.addColorStop(1, `rgba(${c},0)`); g.fillStyle = gr; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2); } }
        for (let k = 0; k < 4; k++) { const y = k * S; g.fillStyle = 'rgba(70,66,60,0.55)'; g.fillRect(0, y, 1024, 3); g.fillStyle = 'rgba(232,228,218,0.35)'; g.fillRect(0, y + 3, 1024, 5);
          for (let x = r() * 300; x < 1024; x += 300 + r() * 400) { g.fillStyle = 'rgba(70,66,60,0.45)'; g.fillRect(x, y, 3, S); } }                                                    // the strips, and where one roll ends and the next begins
        for (let k = 0; k < 7; k++) { const x = r() * 900, y = r() * 900, w = 60 + r() * 140, h = 40 + r() * 100; g.fillStyle = r() < 0.5 ? 'rgba(120,114,104,0.35)' : 'rgba(200,196,186,0.35)'; g.fillRect(x, y, w, h); g.strokeStyle = 'rgba(60,56,50,0.5)'; g.lineWidth = 2; g.strokeRect(x, y, w, h); }   // patches
        for (let k = 0; k < 9000; k++) { g.fillStyle = r() < 0.55 ? `rgba(60,56,50,${(0.12 + 0.3 * r()).toFixed(2)})` : `rgba(240,236,228,${(0.1 + 0.3 * r()).toFixed(2)})`; g.fillRect(r() * 1024, r() * 1024, 1 + r() * 2, 1 + r() * 2); }   // grit
        for (let k = 0; k < 6; k++) { const x = r() * 1024, y = r() * 1024; g.strokeStyle = 'rgba(110,104,94,0.35)'; g.lineWidth = 2; g.beginPath(); for (let j = 0; j < 40; j++) { const a = j / 40 * TAU, rr = 50 + 30 * Math.sin(a * 3 + k) + 20 * r(); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.7); } g.closePath(); g.stroke(); } }, true);   // old water marks
      tx.repeat.set(1 / 4, 1 / 4); plain('roofing', 0xffffff, 0.93, 0, { map: tx }); }
    /* Shipping containers (119): the side's corrugation (ribs 28 cm apart: a lit crest, a shadowed slope, the valley, the other slope
       catching light), faded and patched paint, rust in patches and running down from the top and the ribs, dust at the foot. One
       picture per colour, 2.4 m wide and the container's 2.6 m tall. */
    const contTex = (base, seed, rust) => { const t = canvasTex(512, 512, (g) => { const r = rng(seed), W = 512, P = W / 8.5;
        g.fillStyle = base; g.fillRect(0, 0, W, W);
        for (let k = 0; k < 9; k++) { const x0 = k * P, gr = g.createLinearGradient(x0, 0, x0 + P, 0);
          gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(0.36, 'rgba(255,255,255,0.10)'); gr.addColorStop(0.42, 'rgba(0,0,0,0.3)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.13)'); gr.addColorStop(0.86, 'rgba(0,0,0,0.13)'); gr.addColorStop(0.93, 'rgba(255,255,255,0.2)'); gr.addColorStop(1, 'rgba(255,255,255,0.10)');
          g.fillStyle = gr; g.fillRect(x0, 0, P, W); }
        const blob = (x, y, rad, col, a) => { for (const ox of [-W, 0, W]) { const gr = g.createRadialGradient(x + ox, y, 1, x + ox, y, rad); gr.addColorStop(0, `rgba(${col},${a.toFixed(3)})`); gr.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gr; g.fillRect(x + ox - rad, y - rad, rad * 2, rad * 2); } };
        for (let k = 0; k < 40; k++) blob(r() * W, r() * W, 20 + r() * 70, '232,228,216', 0.06 + 0.12 * r());                                            // faded
        for (let k = 0; k < 10; k++) { g.fillStyle = `rgba(0,0,0,${(0.04 + 0.06 * r()).toFixed(3)})`; g.fillRect(r() * W, r() * W, 30 + r() * 90, 20 + r() * 60); }   // patched over in a slightly other paint
        for (let k = 0; k < Math.round(34 * rust); k++) { const x = r() * W, y = r() * W * 0.9, n2 = 4 + Math.floor(r() * 9);                       // rust patches, darker at the heart
          for (let j = 0; j < n2; j++) { g.fillStyle = `rgba(${r() < 0.5 ? '118,62,30' : '92,48,24'},${(0.35 + 0.4 * r()).toFixed(2)})`; g.beginPath(); g.ellipse(x + (r() - 0.5) * 30, y + (r() - 0.5) * 20, 2 + r() * 9, 1.5 + r() * 6, r() * 3, 0, TAU); g.fill(); } }
        for (let k = 0; k < Math.round(46 * rust); k++) { const x = Math.floor(r() * 9) * P + (r() < 0.5 ? 0.42 : 0.9) * P + (r() - 0.5) * 6, y0 = r() < 0.5 ? 0 : r() * W * 0.7, L = 40 + r() * 220, gr = g.createLinearGradient(0, y0, 0, y0 + L);   // streaks run down the ribs
          gr.addColorStop(0, `rgba(120,62,30,${(0.25 + 0.3 * r()).toFixed(2)})`); gr.addColorStop(1, 'rgba(120,62,30,0)'); g.fillStyle = gr; g.fillRect(x, y0, 2 + r() * 5, L); }
        { const gr = g.createLinearGradient(0, W, 0, W * 0.62); gr.addColorStop(0, 'rgba(126,104,78,0.55)'); gr.addColorStop(1, 'rgba(126,104,78,0)'); g.fillStyle = gr; g.fillRect(0, W * 0.62, W, W * 0.38); }   // dust and splash at the foot
        { const gr = g.createLinearGradient(0, 0, 0, W * 0.12); gr.addColorStop(0, 'rgba(60,46,34,0.35)'); gr.addColorStop(1, 'rgba(60,46,34,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, W * 0.12); }               // grime under the top rail
        g.lineWidth = 0.8; for (let k = 0; k < 60; k++) { const x = r() * W, y = r() * W, a = (r() - 0.5) * 0.6, l = 10 + r() * 50; g.strokeStyle = `rgba(210,206,196,${(0.12 + 0.25 * r()).toFixed(2)})`; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }   // scrapes
      }, true); t.repeat.set(1 / 2.4, 1 / 2.6); return t; };
    plain('contR', 0xffffff, 0.72, 0.12, { map: contTex('#8f3f2c', 61, 1.4) }); plain('contB', 0xffffff, 0.7, 0.12, { map: contTex('#5f7f93', 62, 0.8) }); plain('contC', 0xffffff, 0.74, 0.1, { map: contTex('#bdb29a', 63, 0.55) });
    // pale, sun-bleached concrete for the apron and the flat roofs (114, 116): the game's own dirty concrete is a dark wet grey
    { const tx = canvasTex(512, 512, (g) => { const r = rng(2626); g.fillStyle = '#cbc6b9'; g.fillRect(0, 0, 512, 512);
        for (let k = 0; k < 130; k++) { const x = r() * 512, y = r() * 512, rad = 16 + r() * 70, lightc = r() < 0.5, a = 0.05 + 0.1 * r();
          for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) { if (x + ox < -rad || x + ox > 512 + rad || y + oy < -rad || y + oy > 512 + rad) continue; const gr = g.createRadialGradient(x + ox, y + oy, 1, x + ox, y + oy, rad); gr.addColorStop(0, lightc ? `rgba(236,232,222,${a.toFixed(3)})` : `rgba(120,112,98,${a.toFixed(3)})`); gr.addColorStop(1, lightc ? 'rgba(236,232,222,0)' : 'rgba(120,112,98,0)'); g.fillStyle = gr; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2); } }
        for (let k = 0; k < 2600; k++) { g.fillStyle = r() < 0.5 ? `rgba(70,66,58,${(0.05 + 0.12 * r()).toFixed(3)})` : `rgba(245,242,234,${(0.05 + 0.12 * r()).toFixed(3)})`; g.fillRect(r() * 512, r() * 512, 1 + r() * 1.6, 1 + r() * 1.6); } }, true);
      tx.repeat.set(1 / 5, 1 / 5); plain('pave', 0xffffff, 0.92, 0, { map: tx }); }
    plain('lattice', 0xffffff, 1, 0, { ...decal, opacity: 1, map: canvasTex(64, 64, (g) => { g.strokeStyle = 'rgba(8,7,6,0.5)'; g.lineWidth = 7; for (const [a, b] of [[[0, 0], [64, 64]], [[64, 0], [0, 64]], [[-32, 0], [32, 64]], [[32, 0], [96, 64]], [[96, 0], [32, 64]], [[32, 0], [-32, 64]]]) { g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); } }, true) });
    mats.lattice.vertexColors = false;   // dark wire lines at half strength over a quarter of the ground: it takes about that much of the light
    plain('shade', 0x060504, 1, 0, { ...decal, opacity: 0.5 }); mats.shade.vertexColors = false;   // the posts' shadows, drawn (too thin for the soft shadow map)
    // wind: cloth carries its sway in its uv (x how free, y a phase); the net works it out from where it is
    mats.wind = { value: 0 };
    plain('wcloth', 0xffffff, 0.95, 0, { side: T.DoubleSide });
    mats.wcloth.onBeforeCompile = sh => { sh.uniforms.uTime = mats.wind; sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  { float w = uv.x, ph = uv.y; transformed.y += w * (0.05 * sin(uTime * 2.1 + ph + position.x * 0.7) + 0.022 * sin(uTime * 4.7 + ph * 2.3 + position.z * 1.1));
    transformed.xz += w * 0.02 * vec2(sin(uTime * 1.7 + ph), cos(uTime * 1.3 + ph * 1.7)); }`); };
    mats.wcloth.customProgramCacheKey = () => 'a51-wcloth';

    plain('acacia', 0xffffff, 0.8, 0, { side: T.DoubleSide, alphaTest: 0.5, map: canvasTex(256, 256, (g) => { const r = rng(808);
      for (let k = 0; k < 9; k++) { const a = r() * TAU; g.strokeStyle = 'rgb(72,60,46)'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112); g.stroke(); }
      for (let k = 0; k < 2600; k++) { const a = r() * TAU, d = Math.sqrt(r()) * 118, gg = 88 + r() * 72; g.fillStyle = `rgb(${gg * 0.6 | 0},${gg * 0.76 | 0},${gg * 0.4 | 0})`; g.beginPath(); g.ellipse(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 2.4 + r() * 2, 1.2 + r(), r() * TAU, 0, TAU); g.fill(); } }) });
    plain('net', 0xffffff, 0.95, 0, { side: T.DoubleSide, alphaTest: 0.45, map: canvasTex(512, 512, (g) => { const r = rng(4242);
      g.fillStyle = '#c8aa70'; g.fillRect(0, 0, 512, 512);
      for (const col of ['#a98a56', '#5a4c36', '#dcc691']) for (let k = 0; k < 34; k++) { const x = r() * 512, y = r() * 512, rad = [...Array(9)].map(() => 18 + r() * 40); g.fillStyle = col;
        for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) { if (x + ox < -60 || x + ox > 572 || y + oy < -60 || y + oy > 572) continue; g.beginPath(); rad.forEach((d, j) => { const a = j / 9 * TAU; g.lineTo(x + ox + Math.cos(a) * d, y + oy + Math.sin(a) * d); }); g.fill(); } }
      g.globalCompositeOperation = 'destination-out'; for (let k = 0; k < 1500; k++) { const x = r() * 512, y = r() * 512, a = 3 + r() * 7, b = 2 + r() * 4, rot = r() * TAU; for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) { if (x + ox < -12 || x + ox > 524 || y + oy < -12 || y + oy > 524) continue; g.beginPath(); g.ellipse(x + ox, y + oy, a, b, rot, 0, TAU); g.fill(); } } }, true) });
    { const n0 = mats.net; n0.onBeforeCompile = sh => { sh.uniforms.uTime = mats.wind; sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  { vec2 q = clamp((position.xz - vec2(32.4, -32.4)) / vec2(7.4, 7.2), 0.0, 1.0); float top = sin(3.14159 * q.x) * sin(3.14159 * q.y) * step(3.37, position.y), hang = clamp((3.42 - position.y) / 0.5, 0.0, 1.0);
    transformed.y += top * (0.06 * sin(uTime * 1.6 + position.x * 0.8 + position.z * 0.5) + 0.02 * sin(uTime * 3.9 + position.x * 2.0));
    transformed.xz += hang * 0.09 * vec2(sin(uTime * 2.2 + position.x * 1.3 + position.z), cos(uTime * 1.9 + position.z * 1.1)); }`); }; n0.customProgramCacheKey = () => 'a51-net'; }
    if (mats.acacia) mats.backlit(mats.acacia, 0.5);            // the acacias' leaf sprays glow with the sun behind them (High, Ultra)
    return mats;
  }

  /* ------------------------------------------------------------------ the builder: faces go into one mesh per material (Alpine's) */
  function makeBuilder() {
    const buckets = new Map();
    const bucket = (mat, shadow) => { const k = mat + '|' + shadow; let b = buckets.get(k); if (!b) buckets.set(k, (b = { mat, shadow, p: [], n: [], u: [], c: [], i: [], nv: 0 })); return b; };
    function face(mat, pts, n, uv, col = [1, 1, 1], shadow = 'cr') {   // n: one normal, or one per point (smooth ground)
      const b = bucket(mat, shadow), first = b.nv, per = Array.isArray(col[0]), pn = Array.isArray(n[0]), nf = pn ? n[0] : n;
      let ax = 0, ay = 0, az = 0;
      for (let k = 1; k + 1 < pts.length; k++) { const e1 = [pts[k][0] - pts[0][0], pts[k][1] - pts[0][1], pts[k][2] - pts[0][2]], e2 = [pts[k + 1][0] - pts[0][0], pts[k + 1][1] - pts[0][1], pts[k + 1][2] - pts[0][2]]; ax += e1[1] * e2[2] - e1[2] * e2[1]; ay += e1[2] * e2[0] - e1[0] * e2[2]; az += e1[0] * e2[1] - e1[1] * e2[0]; }
      const flip = ax * nf[0] + ay * nf[1] + az * nf[2] < 0;
      for (let k = 0; k < pts.length; k++) { const c = per ? col[k] : col, nk = pn ? n[k] : n; b.p.push(pts[k][0], pts[k][1], pts[k][2]); b.n.push(nk[0], nk[1], nk[2]); b.u.push(uv[k][0], uv[k][1]); b.c.push(c[0], c[1], c[2]); b.nv++; }
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
      g.setAttribute('uv', new T.Float32BufferAttribute(b.u, 2)); g.setAttribute('color', new T.Float32BufferAttribute(b.c, 3));
      g.setIndex(b.nv > 65535 ? new T.Uint32BufferAttribute(b.i, 1) : new T.Uint16BufferAttribute(b.i, 1));
      g.computeBoundingSphere(); g.computeBoundingBox();
      const m = new T.Mesh(g, mats[b.mat]);
      m.castShadow = b.shadow.includes('c'); m.receiveShadow = b.shadow.includes('r'); m.name = 'a51:' + b.mat;
      m.matrixAutoUpdate = false; m.updateMatrix(); root.add(m); tris += b.i.length / 3; meshes++;
    }
    return { tris, meshes };
  }

  /* ------------------------------------------------------------------ the vehicles' models
     Downloaded models (Sketchfab, credited in the README), prepared once by scripts/area51-models.mjs into maps/area51/models/:
     geometry, a manifest with the materials and the collision boxes, and small textures. Each is in its own space: metres,
     its front toward +X, up +Y, the middle of its footprint at the origin. They load before the build, so their boxes are
     there for the dressing, the caps, the walk grid and the beams, and their textures for the warm-up. A model that does
     not load leaves its vehicle to be built in code, as before: never a box with nothing drawn. */
  const MODELS = ['ural', 'forklift', 'suv', 'renault', 'marmot', 'crate1', 'crate2', 'crate3', 'crate5', 'pallet', 'tyre', 'ibc', 'table', 'jerry', 'bicycle', 'bench', 'hoist', 'gen', 'genset', 'ammo', 'acacia', 'acunit', 'hvac', 'apc', 'rtu'], MDIR = '/maps/area51/models/';
  async function loadModels(G) {
    const T = G.THREE, out = {}, aniso = Math.min(8, G.renderer.capabilities.getMaxAnisotropy ? G.renderer.capabilities.getMaxAnisotropy() : 1), loader = new T.TextureLoader();
    const get = (file, how) => fetch(MDIR + file).then(r => { if (!r.ok) throw new Error(file + ' ' + r.status); return r[how](); });
    const tex = async (file, srgb) => { if (!file) return null; const t = await loader.loadAsync(MDIR + file); t.flipY = false; t.anisotropy = aniso; t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace; return t; };
    await Promise.all(MODELS.map(async id => {
      try {
        const [man, bin] = await Promise.all([get(id + '.json', 'json'), get(id + '.bin', 'arrayBuffer')]);
        const mats = await Promise.all(man.materials.map(async (m, i) => {
          const [map, normalMap, orm] = await Promise.all([tex(m.map, true), tex(m.normal, false), tex(m.orm, false)]);
          const mat = new T.MeshStandardMaterial({ color: new T.Color(...(MODEL_TINT[id] || m.color)), map, normalMap, roughnessMap: orm, metalnessMap: orm, aoMap: m.ao ? orm : null, roughness: m.roughness, metalness: m.metalness, side: m.doubleSided ? T.DoubleSide : T.FrontSide, vertexColors: !!m.colors, alphaTest: m.alphaTest || 0 });
          mat.name = 'a51_' + id + '_' + i; return mat; }));
        const parts = man.parts.map(p => {         // the layout scripts/gun-assets.mjs writes: positions, normals (bytes), uvs, indices, each padded to 4 bytes; then a flat part's colours (bytes)
          const g = new T.BufferGeometry(), pad = n => (n + 3) & ~3; let at = p.at;
          const pos = new Float32Array(bin.slice(at, at + p.vertices * 12)); at += pad(p.vertices * 12);
          const nrm = new Int8Array(bin.slice(at, at + p.vertices * 3)); at += pad(p.vertices * 3);
          const uv = new Float32Array(bin.slice(at, at + p.vertices * 8)); at += pad(p.vertices * 8);
          const idx = p.wide ? new Uint32Array(bin.slice(at, at + p.indices * 4)) : new Uint16Array(bin.slice(at, at + p.indices * 2)); at += pad(p.indices * (p.wide ? 4 : 2));
          g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(nrm, 3, true)); g.setAttribute('uv', new T.BufferAttribute(uv, 2)); g.setIndex(new T.BufferAttribute(idx, 1));
          if (p.colors) g.setAttribute('color', new T.BufferAttribute(new Uint8Array(bin.slice(at, at + p.vertices * 3)), 3, true));
          g.computeBoundingSphere(); g.computeBoundingBox();
          return { geo: g, mat: mats[p.material] };
        });
        out[id] = { man, parts };
      } catch (e) { console.warn('[area51] the ' + id + ' model did not load (' + e.message + '); its vehicle is built in code'); }
    }));
    return out;
  }
  // the meshes of every model the build set down (built.models), sharing each model's geometry and materials
  // A model set down more than once is drawn as one instanced mesh per part: thirty pallets are one draw, not thirty.
  const NO_SHADOW = ['acunit', 'jerry', 'hvac'];
  const MODEL_TINT = { table: [2.6, 2.2, 1.6] };       // the picnic table's own picture is near black; the pictures show pale sawn planks       // too small, or up on a roof: their shadows are never seen
  function placeModels(G, root, models, list) {
    const T = G.THREE, by = new Map(), M = new T.Matrix4(), Q = new T.Quaternion(), UP = new T.Vector3(0, 1, 0); let tris = 0, draws = 0;
    for (const it of list) { if (!by.has(it.id)) by.set(it.id, []); by.get(it.id).push(it); }
    const mat4 = it => { const s = it.s || [1, 1, 1]; return M.compose(new T.Vector3(it.x, it.y || 0, it.z), Q.setFromAxisAngle(UP, it.yaw), new T.Vector3(s[0], s[1], s[2])).clone(); };
    for (const [id, items] of by) for (const { geo, mat } of models[id].parts) {
      let m;
      if (items.length === 1) { m = new T.Mesh(geo, mat); m.matrix.copy(mat4(items[0])); m.matrixAutoUpdate = false; m.matrixWorldNeedsUpdate = true; }
      else { m = new T.InstancedMesh(geo, mat, items.length); items.forEach((it, k) => m.setMatrixAt(k, mat4(it))); m.instanceMatrix.needsUpdate = true; m.matrixAutoUpdate = false;
        if (m.computeBoundingSphere) m.computeBoundingSphere(); else m.frustumCulled = false; }
      m.castShadow = !NO_SHADOW.includes(id); m.receiveShadow = true; m.name = 'a51:model:' + id; root.add(m); tris += geo.index.count / 3 * items.length; draws++;
    }
    return { tris, count: list.length, draws };
  }

  /* ------------------------------------------------------------------ the compound */
  function build(G, bld0, models = {}) {
    let bld = bld0;            // the builder faces go to: the map's own, or for a while a part's (the radar's turning head)
    const ph = G.physics;
    const tone = (x, y, z, t) => { const n = 0.9 + 0.2 * fbm2(x * 0.35 + z * 0.21, y * 0.35 + z * 0.17, 3), g = 0.78 + 0.22 * clamp(y / 0.9, 0, 1); return [t[0] * n * g, t[1] * n * g, t[2] * n * g]; };
    // a drawn box; texture runs in world metres. faces: which of w e (x), b t (y), n s (z) to draw
    function draw(mat, x0, y0, z0, x1, y1, z1, { faces = 'webtns', tint = [1, 1, 1], top = null, shadow = 'cr', flat = false } = {}) {
      const col = (x, y, z) => (flat ? tint : tone(x, y, z, tint));
      const q = (m, pts, n, uv) => bld.face(m, pts, n, uv, pts.map(p => col(p[0], p[1], p[2])), shadow);
      if (faces.includes('w')) q(mat, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]]);
      if (faces.includes('e')) q(mat, [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], [1, 0, 0], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]]);
      if (faces.includes('n')) q(mat, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, -1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
      if (faces.includes('s')) q(mat, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
      if (faces.includes('t')) q(top || mat, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
      if (faces.includes('b') && y0 > 0.01) q(mat, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
    }
    const SURF = { wallc: 'concrete', corrR: 'metal', signs: 'metal', grille: 'metal', skylite: 'glass', glass: 'glass', plaster: 'concrete', concrete: 'concrete', slab: 'concrete', corr: 'metal', galv: 'metal', steel: 'metal', worn: 'metal', rust: 'metal', paint: 'metal', tarp: 'wood', tire: 'wood', wood: 'wood', hazard: 'metal', cloth: 'wood', timber: 'wood', pave: 'concrete', mil: 'metal', roofing: 'concrete', contR: 'metal', contB: 'metal', contC: 'metal' };
    // drawn, and there to be walked into and shot
    function solid(mat, x0, y0, z0, x1, y1, z1, o = {}) {
      draw(mat, x0, y0, z0, x1, y1, z1, o);
      return ph.addBox([x0, y0, z0], [x1, y1, z1], { surface: o.surface || SURF[mat] || 'concrete', ...(o.only === 'shots' ? { bulletOnly: true } : {}) });
    }
    const block = (x0, y0, z0, x1, y1, z1, surface = 'concrete') => ph.addBox([x0, y0, z0], [x1, y1, z1], { surface, playerOnly: true, noNav: true });     // for players only, not drawn
    const hitBox = (x0, y0, z0, x1, y1, z1, surface = 'metal') => ph.addBox([x0, y0, z0], [x1, y1, z1], { surface, bulletOnly: true });                    // for shots only, not drawn
    // out of reach: drawn, and stopping shots as its own triangles
    const HI = { p: [], s: [] };
    const hiTri = (a, b, c, surface = 'concrete') => { HI.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); HI.s.push(surface); };
    const hiQuad = (P, surface) => { hiTri(P[0], P[1], P[2], surface); hiTri(P[0], P[2], P[3], surface); };
    const hiBox = (x0, y0, z0, x1, y1, z1, surface) => { const v = i => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
      for (const [a, b, c, d] of [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]]) hiQuad([v(a), v(b), v(c), v(d)], surface); };
    const deco = (mat, x0, y0, z0, x1, y1, z1, o = {}) => { draw(mat, x0, y0, z0, x1, y1, z1, o); if (o.hi !== false) hiBox(x0, y0, z0, x1, y1, z1, SURF[mat] || 'concrete'); };
    const trim = (mat, x0, y0, z0, x1, y1, z1, o = {}) => solid(mat, x0, y0, z0, x1, y1, z1, { ...o, only: 'shots' });
    // a flat quad, drawn both ways if asked, stopping shots if hi
    function sheet(mat, P, { tint = [1, 1, 1], both = true, hi = true, surface = 'metal', shadow = 'cr' } = {}) {
      const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], e2 = [P[3][0] - P[0][0], P[3][1] - P[0][1], P[3][2] - P[0][2]];
      const n = vnorm(vcross(e1, e2)), l1 = vlen(e1), l2 = vlen(e2), uv = [[0, 0], [l1, 0], [l1, l2], [0, l2]], col = P.map(p => tone(p[0], p[1] + 1, p[2], tint));
      bld.face(mat, P, n, uv, col, shadow); if (both) bld.face(mat, P, vscale(n, -1), uv, col.map(c => vscale(c, 0.8)), shadow);
      if (hi) hiQuad(P, surface);
    }
    const vadd = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k], vlen = a => Math.hypot(a[0], a[1], a[2]), vscale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
    const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], vnorm = a => vscale(a, 1 / (vlen(a) || 1));
    const vsub = (a, b) => vadd(a, b, -1);
    // a cell of the sign sheet (SIGNS) on a flat board: centre C, facing n, w x h metres
    function signQuad(k, C, n, w, h) {
      const up = [0, 1, 0], r = vcross(up, n), u0 = (k % 2) * 0.5 + 0.003, u1 = u0 + 0.494, v1 = 1 - Math.floor(k / 2) / 8 - 0.003, v0 = v1 - 0.119;
      const P = [vadd(vadd(C, r, -w / 2), up, -h / 2), vadd(vadd(C, r, w / 2), up, -h / 2), vadd(vadd(C, r, w / 2), up, h / 2), vadd(vadd(C, r, -w / 2), up, h / 2)];
      bld.face('signs', P, n, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], [1, 1, 1], 'r');
    }
    // a shallow dish (a paraboloid), open toward dir: front white, back darker; drawn only (its owner gives the collision)
    function dish(C, dir, r, depth, tint = [1.02, 1.02, 1.0]) {
      const D = vnorm(dir), U = vnorm(Math.abs(D[1]) > 0.9 ? vcross(D, [1, 0, 0]) : vcross(D, [0, 1, 0])), V = vcross(D, U), RI = 4, SG = 22;
      const pt = (i, j) => { const q = i / RI, a = j / SG * TAU; return vadd(vadd(vadd(C, D, depth * q * q), U, r * q * Math.cos(a)), V, r * q * Math.sin(a)); };
      for (let i = 0; i < RI; i++) for (let j = 0; j < SG; j++) {
        const P = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)], a = (j + 0.5) / SG * TAU, q = (i + 0.5) / RI;
        const rad = vadd(vscale(U, Math.cos(a)), V, Math.sin(a)), nIn = vnorm(vadd(D, rad, -2 * depth * q / r)), uv = P.map(p => [vlen(vsub(p, C)), j / SG]);
        bld.face('paint', P, nIn, uv, tint, 'cr'); bld.face('paint', P, vscale(nIn, -1), uv, vscale(tint, 0.62), 'cr');
      }
      const f = r * r / (4 * depth), feed = vadd(C, D, f * 0.95);
      for (const j of [0, 7, 15]) beamPQ('steel', pt(RI, j), feed, 0.022, 0.022, { tint: [0.5, 0.5, 0.5], hi: false });
      for (let j = 0; j < SG; j++) beamPQ('steel', pt(RI, j), pt(RI, j + 1), 0.03, 0.03, { tint: [0.6, 0.6, 0.58], hi: false });                 // the rolled rim
      { const hub = vsub(C, vscale(D, 0.2));                                                                                                   // ribs behind it, to a hub on its mount
        for (let j = 0; j < SG; j += 2) beamPQ('steel', hub, vsub(pt(RI, j), vscale(D, 0.02)), 0.022, 0.035, { tint: [0.42, 0.42, 0.4], hi: false });
        obox('steel', vsub(C, vscale(D, 0.14)), vscale(D, 0.1), vscale(U, 0.12), vscale(V, 0.12), { tint: [0.36, 0.36, 0.34], hi: false }); }
      obox('steel', feed, vscale(D, 0.07), vscale(U, 0.06), vscale(V, 0.06), { tint: [0.4, 0.4, 0.4], hi: false });
      return { back: vsub(C, vscale(D, 0.05)), D };
    }
    // a box turned any way (out of reach only): centre C, half-extent vectors U, V, W
    function obox(mat, C, U, V, W, { tint = [1, 1, 1], hi = true, surface, shadow = 'cr' } = {}) {
      for (const [A, B, Cc] of [[U, V, W], [V, W, U], [W, V, U]]) for (const sg of [1, -1]) {
        const f = vadd(C, A, sg), P = [vadd(vadd(f, B, -1), Cc, -1), vadd(vadd(f, B, 1), Cc, -1), vadd(vadd(f, B, 1), Cc, 1), vadd(vadd(f, B, -1), Cc, 1)], lb = 2 * vlen(B), lc = 2 * vlen(Cc);
        bld.face(mat, P, vnorm(vscale(A, sg)), [[0, 0], [lb, 0], [lb, lc], [0, lc]], P.map(p => tone(p[0], p[1] + 1, p[2], tint)), shadow);
        if (hi) hiQuad(P, surface || SURF[mat] || 'metal');
      }
    }
    function beamPQ(mat, p, q, w, h, o = {}) {
      const half = vscale([q[0] - p[0], q[1] - p[1], q[2] - p[2]], 0.5), L = vnorm(half);
      const side = vnorm(Math.abs(L[1]) > 0.95 ? vcross(L, [1, 0, 0]) : vcross(L, [0, 1, 0])), up = vnorm(vcross(side, L));
      obox(mat, vadd(p, half), half, vscale(side, w / 2), vscale(up, h / 2), { ...o, shadow: o.shadow || (Math.max(w, h) < 0.045 ? 'r' : 'cr') });   // wires, rungs, spokes: no shadow
    }
    // a cylinder along an axis ('x', 'y' or 'z'), drawn only (its collision is given separately)
    function cyl(mat, axis, c, r, len, { tint = [1, 1, 1], n: n0 = 14, caps = true, capMat = null, shadow = r < 0.06 ? 'r' : 'cr' } = {}) {   // nuts, taps, insulators: no shadow
      let n = n0;
      const P = (a, s) => { const u = Math.cos(a) * r, v = Math.sin(a) * r; return axis === 'x' ? [c[0] + s, c[1] + u, c[2] + v] : axis === 'z' ? [c[0] + u, c[1] + v, c[2] + s] : [c[0] + u, c[1] + s, c[2] + v]; };
      const N = (a) => { const u = Math.cos(a), v = Math.sin(a); return axis === 'x' ? [0, u, v] : axis === 'z' ? [u, v, 0] : [u, 0, v]; };
      n = Math.max(n, r >= 0.4 ? 28 : r >= 0.18 ? 22 : r >= 0.08 ? 14 : n);          // a wide one is never left with corners
      for (let k = 0; k < n; k++) {                                                   // round to the light: a normal at each corner, not one to a side (which showed every side as a flat)
        const a0 = k / n * TAU, a1 = (k + 1) / n * TAU, Q = [P(a0, -len / 2), P(a1, -len / 2), P(a1, len / 2), P(a0, len / 2)];
        bld.face(mat, Q, [N(a0), N(a1), N(a1), N(a0)], [[a0 * r, 0], [a1 * r, 0], [a1 * r, len], [a0 * r, len]], Q.map(p => tone(p[0], p[1] + 1, p[2], tint)), shadow);
      }
      if (caps) for (const s of [-1, 1]) {
        const ring = []; for (let k = 0; k < n; k++) ring.push(P(k / n * TAU, s * len / 2));
        const nn = axis === 'x' ? [s, 0, 0] : axis === 'z' ? [0, 0, s] : [0, s, 0];
        bld.face(capMat || mat, ring, nn, ring.map(p => (axis === 'x' ? [p[2], p[1]] : axis === 'z' ? [p[0], p[1]] : [p[0], p[2]])), ring.map(p => tone(p[0], p[1] + 1, p[2], vscale(tint, 0.9))), shadow);
      }
    }

    /* ================================================================== buildings
       A building is a core box set 15 cm in from its faces, and panels 15 cm thick round its openings: the windows and
       doors sit at the back of a real reveal, and a shot stops at the glass where it is drawn. Trim (sills) stops shots
       only, so it is never a ledge. */
    const T_ = 0.15, footprints = [];
    for (const b of BUILDINGS) footprints.push({ at: b.at, H: b.H });
    for (const h of HANGARS) footprints.push({ at: h.at, H: h.eave });
    const covered = (x, y, z) => footprints.some(f => x > f.at[0] - 0.05 && x < f.at[2] + 0.05 && z > f.at[1] - 0.05 && z < f.at[3] + 0.05 && y < f.H);
    const placed = [];
    // a model (loadModels) set down with the middle of its footprint at cx, cz, turned q quarter turns (0: its front toward
    // +x, 1: toward -z, 2: -x, 3: +z); its boxes stop players and shots. False when the model did not load
    const modelsPlaced = [];
    function placeModel(id, cx, cz, q, name) {
      const M = models[id]; if (!M) return false;
      const c = [1, 0, -1, 0][q & 3], s = [0, 1, 0, -1][q & 3];        // as three.js turns about y: x' = x c + z s, z' = -x s + z c
      for (const b of M.man.boxes) { const xs = [b[0] * c + b[2] * s, b[3] * c + b[5] * s], zs = [-b[0] * s + b[2] * c, -b[3] * s + b[5] * c];
        ph.addBox([cx + Math.min(...xs), b[1], cz + Math.min(...zs)], [cx + Math.max(...xs), b[4], cz + Math.max(...zs)], { surface: 'metal' }); }
      modelsPlaced.push({ id, x: cx, z: cz, yaw: q * Math.PI / 2 });
      placed.push({ name: name || 'model:' + id, x: cx, y: 0, z: cz, yaw: q * Math.PI / 2 });
      return true;
    }
    // a model drawn in the place of a box the build already makes (the box stays the collision): stretched to fill the box,
    // turned q quarter turns first. `ids` are the variants to pick from, by where it stands. False when none loaded
    function prop(ids, x0, y0, z0, x1, y1, z1, q = 0) {
      const have = [].concat(ids).filter(i => models[i]); if (!have.length) return false;
      const h = Math.abs(Math.sin(x0 * 12.9898 + z0 * 78.233 + y0 * 37.7) * 43758.5453) % 1, id = have[Math.floor(h * have.length)], sz = models[id].man.size, odd = q & 1;
      const sx = (odd ? z1 - z0 : x1 - x0) / sz[0], sy = (y1 - y0) / sz[1], sZ = (odd ? x1 - x0 : z1 - z0) / sz[2];
      modelsPlaced.push({ id, x: (x0 + x1) / 2, y: y0, z: (z0 + z1) / 2, yaw: q * Math.PI / 2, s: [sx, sy, sZ] });
      return true;
    }
    const cbox = (x0, y0, z0, x1, y1, z1, surface = 'wood') => ph.addBox([x0, y0, z0], [x1, y1, z1], { surface });      // the collision of a thing a model draws
    const explosives = [], cloths = [], spinners = [], puddles = [];
    const hexLin = h => [0, 2, 4].map(k => { const c = parseInt(h.slice(k, k + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });   // a colour as painted, to the linear one a vertex carries
    // a round tube from p to q
    function tube(mat, p, q, r, { tint = [1, 1, 1], n = 8, shadow = r < 0.05 ? 'r' : 'cr', caps = true } = {}) {
      const ax = vnorm(vsub(q, p)), sv = vnorm(Math.abs(ax[1]) > 0.95 ? vcross(ax, [1, 0, 0]) : vcross(ax, [0, 1, 0])), uv2 = vcross(ax, sv);
      const dirs = [...Array(n)].map((_, k) => vadd(vscale(sv, Math.cos(k / n * TAU)), uv2, Math.sin(k / n * TAU)));
      for (let k = 0; k < n; k++) { const a = dirs[k], b = dirs[(k + 1) % n]; bld.face(mat, [vadd(p, a, r), vadd(p, b, r), vadd(q, b, r), vadd(q, a, r)], [a, b, b, a], [[k / n, 0], [(k + 1) / n, 0], [(k + 1) / n, 1], [k / n, 1]], tint, shadow); }
      if (caps) { bld.face(mat, dirs.map(dv => vadd(p, dv, r)), vscale(ax, -1), dirs.map(dv => [dv[0], dv[2]]), tint, shadow); bld.face(mat, dirs.map(dv => vadd(q, dv, r)), ax, dirs.map(dv => [dv[0], dv[2]]), tint, shadow); }
    }
    // a skin over rings of points (every ring the same count), smooth across it, its outside away from `inside`
    function loft(mat, rings, inside, { tint = [1, 1, 1], shadow = 'cr' } = {}) {
      const R = rings.length, N = rings[0].length, nr = rings.map(r => r.map(() => [0, 0, 0])), qn = [], col = (i, j) => (typeof tint === 'function' ? tint(i, j) : tint);
      for (let i = 0; i + 1 < R; i++) for (let j = 0; j + 1 < N; j++) { const a = rings[i][j], b = rings[i][j + 1], c = rings[i + 1][j + 1], dq = rings[i + 1][j]; let n = vcross(vsub(c, a), vsub(dq, b));
        const mid = vscale(vadd(vadd(a, b), vadd(c, dq)), 0.25); if (n[0] * (mid[0] - inside[0]) + n[1] * (mid[1] - inside[1]) + n[2] * (mid[2] - inside[2]) < 0) n = vscale(n, -1);
        qn.push(n); for (const [u, v] of [[i, j], [i, j + 1], [i + 1, j + 1], [i + 1, j]]) { nr[u][v][0] += n[0]; nr[u][v][1] += n[1]; nr[u][v][2] += n[2]; } }
      for (let i = 0; i < R; i++) if (vlen(vsub(rings[i][0], rings[i][N - 1])) < 1e-6) { const m2 = vadd(nr[i][0], nr[i][N - 1]); nr[i][0] = m2; nr[i][N - 1] = m2; }     // a closed ring: no seam where it joins
      let q = 0;
      for (let i = 0; i + 1 < R; i++) for (let j = 0; j + 1 < N; j++, q++) { if (vlen(qn[q]) < 1e-10) continue; const ix = [[i, j], [i, j + 1], [i + 1, j + 1], [i + 1, j]];
        bld.face(mat, ix.map(([u, v]) => rings[u][v]), ix.map(([u, v]) => vnorm(nr[u][v])), ix.map(([u, v]) => { const pt = rings[u][v]; return [pt[0] + pt[2], pt[1]]; }), typeof tint === 'function' ? ix.map(([u, v]) => col(u, v)) : tint, shadow); }
    }
    function building(b) {
      const [x0, z0, x1, z1] = b.at, H = b.H, FH = H / b.floors, mat = b.mat || 'plaster', tint = b.tint, P = b.parapet != null ? b.parapet : 0.6, ww = b.winW || 1.2;
      const tt = { tint };
      // the core: only its top shows (the roof); its sides are the backs of the openings
      const stairs = ROOF_STAIRS.filter(st => st.b === b.id), walk = stairs.length > 0 || !!b.roof;
      { const core = solid(mat, x0 + T_, 0, z0 + T_, x1 - T_, H, z1 - T_, { faces: 't', tint: [0.94, 0.93, 0.9], top: 'roofing' }); if (walk && core) core.walk = true; }        // flat roofs: pale grey (116); one with a stair is walked on (not capped)
      // the parapet and its coping
      if (P > 0) {
        const t = 0.3, Y = H + P;
        for (const [sd0, a, c, d, e] of [['n', x0, z0, x1, z0 + t], ['s', x0, z1 - t, x1, z1], ['w', x0, z0 + t, x0 + t, z1 - t], ['e', x1 - t, z0 + t, x1, z1 - t]]) {
          // cut where a stair comes up; on a roof that is walked on each piece also stops players (the caps then stand over it)
          const ax = sd0 === 'n' || sd0 === 's', pieces = []; let u = ax ? a : c; const end = ax ? d : e;
          /* where this roof meets a taller block's wall there is no parapet (a 30 cm ledge against a wall leaves no room for a body, which is
             64 cm across): the roof runs to the wall and its felt is turned up the wall */
          const abut = BUILDINGS.filter(o => o !== b && o.H > b.H).map(o => { const [ox0, oz0, ox1, oz1] = o.at;
            if (sd0 === 'w' && Math.abs(ox1 - x0) < 0.05) return [Math.max(z0, oz0), Math.min(z1, oz1)]; if (sd0 === 'e' && Math.abs(ox0 - x1) < 0.05) return [Math.max(z0, oz0), Math.min(z1, oz1)];
            if (sd0 === 'n' && Math.abs(oz1 - z0) < 0.05) return [Math.max(x0, ox0), Math.min(x1, ox1)]; if (sd0 === 's' && Math.abs(oz0 - z1) < 0.05) return [Math.max(x0, ox0), Math.min(x1, ox1)]; return null; }).filter(iv => iv && iv[1] - iv[0] > 0.1);
          for (const [g0, g1] of abut) { const sk = { tint: [0.62, 0.6, 0.56], shadow: 'r' }, h2 = H + 0.25, k = 0.025;
            if (sd0 === 'w') draw('roofing', x0, H, g0, x0 + k, h2, g1, { ...sk, faces: 'et' }); else if (sd0 === 'e') draw('roofing', x1 - k, H, g0, x1, h2, g1, { ...sk, faces: 'wt' });
            else if (sd0 === 'n') draw('roofing', g0, H, z0, g1, h2, z0 + k, { ...sk, faces: 'st' }); else draw('roofing', g0, H, z1 - k, g1, h2, z1, { ...sk, faces: 'nt' }); }
          const cuts = [...stairs.filter(st => st.side === sd0).map(stairTop), ...abut].sort((p, q) => p[0] - q[0]);
          for (const [g0, g1] of cuts) { if (g0 > u + 1e-3) pieces.push([u, g0]); u = Math.max(u, g1); } if (end > u + 1e-3) pieces.push([u, end]);
          for (const [u0, u1] of pieces) { const [pa, pc, pd, pe] = ax ? [u0, c, u1, e] : [a, u0, d, u1];
            { const sk = { tint: [0.62, 0.6, 0.56], faces: { n: 'st', s: 'nt', w: 'et', e: 'wt' }[sd0], shadow: 'r' }, k = 0.025, h2 = H + 0.18;          // the felt turned up the parapet's inner face, and its fixing strip
              if (sd0 === 'n') draw('roofing', pa, H, pe, pd, h2, pe + k, sk); else if (sd0 === 's') draw('roofing', pa, H, pc - k, pd, h2, pc, sk); else if (sd0 === 'w') draw('roofing', pd, H, pc, pd + k, h2, pe, sk); else draw('roofing', pa - k, H, pc, pa, h2, pe, sk); }
            deco(mat, pa, H, pc, pd, Y, pe, tt); deco('slab', pa - (ax ? 0 : 0.04), Y, pc - (ax ? 0.04 : 0), pd + (ax ? 0 : 0.04), Y + 0.08, pe + (ax ? 0.04 : 0), { tint: [0.92, 0.9, 0.86] });
            if (walk) { const pb = block(pa, H, pc, pd, Y + 0.08, pe, 'concrete'); pb.parapet = sd0; } } }          // a ledge: stood on, walked along, jumped or vaulted over (he asked, 24 Nov), never a wall
      }
      // drains in two corners of the roof: a grate in a dished outlet, the dark stain the water leaves round it
      if (P > 0) for (const [dx, dz] of [[x0 + 0.62, z0 + 0.62], [x1 - 0.62, z1 - 0.62]]) {
        const ring = (r2, y, n2 = 14) => [...Array(n2)].map((_, k) => [dx + Math.cos(-k / n2 * TAU) * r2, y, dz + Math.sin(-k / n2 * TAU) * r2]);
        bld.face('stain', ring(0.75, H + 0.004), [0, 1, 0], ring(0.75, 0).map(q => [(q[0] - dx) / 1.5 + 0.5, (q[2] - dz) / 1.5 + 0.5]), [0.25, 0.23, 0.2], 'r');
        bld.face('steel', ring(0.17, H + 0.006), [0, 1, 0], ring(0.17, 0).map(q => [q[0], q[2]]), [0.3, 0.3, 0.29], 'r'); bld.face('grille', ring(0.12, H + 0.008), [0, 1, 0], ring(0.12, 0).map(q => [q[0], q[2]]), [1, 1, 1], 'r'); }
      // the four sides
      for (const side of ['n', 's', 'w', 'e']) {
        const alongX = side === 'n' || side === 's', a = alongX ? x0 : z0 + T_, bb = alongX ? x1 : z1 - T_, out = side === 'n' || side === 'w' ? -1 : 1;
        const face = side === 'n' ? z0 : side === 's' ? z1 : side === 'w' ? x0 : x1, back = face - out * T_;
        const W = (u, y, d = 0.3) => (alongX ? [u, y, face + out * d] : [face + out * d, y, u]);
        const free = (u0, u1, v0, v1) => ![u0 + 0.05, (u0 + u1) / 2, u1 - 0.05].some(u => [v0 + 0.05, v1 - 0.05].some(v => { const p = W(u, v); return covered(p[0], p[1], p[2]); }));
        const holes = [];
        for (const [s, u, w, f, lo] of b.doors || []) if (s === side) { const v0 = lo != null ? lo : f * FH + (f ? 0.15 : 0), v1 = v0 + (w > 1.2 ? 2.4 : 2.2); if (free(u - w / 2, u + w / 2, v0, v1)) holes.push({ u0: u - w / 2, u1: u + w / 2, v0, v1, kind: 'door', f }); }
        if (!(b.noWin || '').includes(side)) for (let f = 0; f < b.floors; f++) {
          const span = bb - a, n = Math.max(1, Math.floor((span - 1.2) / 3.2)), step = span / n;
          for (let k = 0; k < n; k++) {
            const u = a + step * (k + 0.5), u0 = u - ww / 2, u1 = u + ww / 2, v0 = f * FH + 0.95, v1 = v0 + 1.4;
            if (holes.some(h => h.f === f && u1 > h.u0 - 0.6 && u0 < h.u1 + 0.6)) continue;
            if (free(u0, u1, v0, v1)) holes.push({ u0, u1, v0, v1, kind: 'win', f });
          }
        }
        // panels: bands between the holes' tops and bottoms; in each band the wall where no hole is
        const ys = [...new Set([0, H, ...holes.flatMap(h => [h.v0, h.v1])])].sort((p, q) => p - q);
        let prev = null;
        const emit = (iv, y0, y1) => { for (const [u0, u1] of iv) { const box = alongX ? [u0, y0, Math.min(face, back), u1, y1, Math.max(face, back)] : [Math.min(face, back), y0, u0, Math.max(face, back), y1, u1];
          const wl = solid(mat, ...box, { tint, faces: alongX ? (out < 0 ? 'nwetb' : 'swetb') : (out < 0 ? 'wnstb' : 'enstb') }); if (walk && wl) wl.walk = true; } };
        const bands = [];
        for (let k = 0; k + 1 < ys.length; k++) {
          const y0 = ys[k], y1 = ys[k + 1], ym = (y0 + y1) / 2, cut = holes.filter(h => h.v0 < ym && h.v1 > ym).sort((p, q) => p.u0 - q.u0), iv = []; let u = alongX ? x0 : a;
          const end = alongX ? x1 : bb;
          for (const h of cut) { if (h.u0 > u + 1e-3) iv.push([u, h.u0]); u = Math.max(u, h.u1); } if (end > u + 1e-3) iv.push([u, end]);
          const key = iv.map(p => p.join(',')).join('|');
          if (prev && prev.key === key) prev.y1 = y1; else bands.push(prev = { key, iv, y0, y1 });
        }
        for (const bd of bands) emit(bd.iv, bd.y0, bd.y1);
        (b._sides || (b._sides = [])).push({ b, side, alongX, out, face, holes, lo: alongX ? x0 : a, hi: alongX ? x1 : bb });
        // what is at the back of each opening, and a sill under each window. For players every opening off the ground is
        // filled flush with the wall: a 15 cm recess was a ledge to stand in (a balcony door's threshold at 3.75 m was)
        for (const h of holes) {
          if (h.v0 > 0.01) { const f0 = Math.min(face, back), f1 = Math.max(face, back); if (alongX) block(h.u0, h.v0, f0, h.u1, h.v1, f1, 'concrete'); else block(f0, h.v0, h.u0, f1, h.v1, h.u1, 'concrete'); }
          const Q = [W(h.u0, h.v0, -T_ + 0.002), W(h.u1, h.v0, -T_ + 0.002), W(h.u1, h.v1, -T_ + 0.002), W(h.u0, h.v1, -T_ + 0.002)];
          const nrm = alongX ? [0, 0, out] : [out, 0, 0], uv = Q.map(p => [alongX ? p[0] : p[2], p[1]]);
          if (h.kind === 'win') {
            bld.face('glass', Q, nrm, uv, [1, 1, 1], 'r');
            const s0 = W(h.u0 - 0.1, h.v0 - 0.07, 0), s1 = W(h.u1 + 0.1, h.v0, 0.07);
            trim('concrete', Math.min(s0[0], s1[0]), s0[1], Math.min(s0[2], s1[2]), Math.max(s0[0], s1[0]), s1[1], Math.max(s0[2], s1[2]), { tint: [1.05, 1.02, 0.96] });
            // a frame and a bar in the reveal, drawn only
            const fr = (u0, v0, u1, v1) => { const p0 = W(u0, v0, -T_ + 0.04), p1 = W(u1, v1, -T_ + 0.09); draw('worn', Math.min(p0[0], p1[0]), p0[1], Math.min(p0[2], p1[2]), Math.max(p0[0], p1[0]), p1[1], Math.max(p0[2], p1[2]), { tint: [0.55, 0.6, 0.56], flat: true }); };
            fr(h.u0, h.v0, h.u1, h.v0 + 0.06); fr(h.u0, h.v1 - 0.06, h.u1, h.v1); fr(h.u0, h.v0, h.u0 + 0.06, h.v1); fr(h.u1 - 0.06, h.v0, h.u1, h.v1); fr((h.u0 + h.u1) / 2 - 0.03, h.v0, (h.u0 + h.u1) / 2 + 0.03, h.v1);
          } else bld.face('paint', Q, nrm, uv, b.doorTint || (mat === 'plaster' ? [0.36, 0.34, 0.3] : [0.42, 0.48, 0.5]), 'cr');
        }
      }
      placed.push({ name: 'building:' + b.id, x: (x0 + x1) / 2, y: 0, z: (z0 + z1) / 2, yaw: 0 });
    }
    for (const b of BUILDINGS) building(b);

    /* ---- sidewalks with painted kerbs, and porches (a slab, four columns, a roof) */
    const kerb = (x0, z0, x1, z1) => { solid('slab', x0, 0, z0, x1, 0.15, z1, { tint: [1.02, 1.0, 0.96] }); };
    kerb(-35.5, -23, 17.7, -21.4); kerb(19.9, -38, 21.5, -7); kerb(8.5, -24.6, 17.7, -23);
    for (let x = -35.5; x < 17.7; x += 1) solid('concrete', x, 0, -21.65, Math.min(17.7, x + 1), 0.25, -21.4, { tint: (Math.floor(x) & 1) ? [0.72, 0.22, 0.18] : [1.08, 1.06, 1.0] });
    for (let z = -38; z < -7; z += 1) solid('concrete', 19.9, 0, z, 20.15, 0.25, Math.min(-7, z + 1), { tint: (Math.floor(z) & 1) ? [0.72, 0.22, 0.18] : [1.08, 1.06, 1.0] });
    function porch(alongX, face, out, u, w, d, roof = true) {
      const B = (u0, y0, d0, u1, y1, d1, mat, o) => { const c0 = face + out * d0, c1 = face + out * d1; return alongX ? solid(mat, u0, y0, Math.min(c0, c1), u1, y1, Math.max(c0, c1), o) : solid(mat, Math.min(c0, c1), y0, u0, Math.max(c0, c1), y1, u1, o); };
      B(u - w / 2, 0, 0, u + w / 2, 0.3, d, 'slab', { tint: [1.0, 0.98, 0.94] });
      B(u - w / 2 + 0.3, 0, d, u + w / 2 - 0.3, 0.15, d + 0.35, 'slab', { tint: [0.96, 0.94, 0.9] });                          // the step
      for (const cu of [u - w / 2 + 0.05, u - w / 2 + 0.9, u + w / 2 - 1.25, u + w / 2 - 0.4]) B(cu, 0.3, d - 0.45, cu + 0.35, roof ? 3.3 : 2.85, d - 0.1, 'plaster', { tint: [1.0, 0.95, 0.86] });   // under the balcony they stop at its deck
      if (roof) { const sl = B(u - w / 2 - 0.1, 3.3, 0, u + w / 2 + 0.1, 3.55, d + 0.1, 'slab', { tint: [0.95, 0.93, 0.9] }); if (sl) sl.walk = true; }     // a roof under a roof's edge: landed on and walked, never capped
    }
    porch(true, -23, 1, 1.5, 5.6, 2.6);                // A, the front door
    porch(true, -23, 1, -24.5, 4.6, 1.6, false);        // A, the door under the balcony: the balcony is its roof
    porch(false, 21.5, -1, -25, 5.0, 2.4);             // C

    /* ---- the balcony round the west end of the north barracks, and its stair down to the alley behind (14-17) */
    {
      const deck = (x0, z0, x1, z1) => { solid('slab', x0, 2.85, z0, x1, 3.0, z1, { tint: [0.92, 0.9, 0.86] }); };
      deck(-37.3, -23, -22, -21.3); deck(-37.3, -35.5, -35.5, -23);
      // posts every 1.5 m, a mid rail and a top rail. For players a wall the rail's height, 14 cm thick round the rail:
      // the vault (web/vault.js) looks for an obstacle's top 2 to 6 cm past where it first touches it, so a wall as thin
      // as the drawn rail (6 cm) would sometimes be missed and the jump would stay a jump
      const rail = (x0, z0, x1, z1) => {
        const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0), L = alongX ? x1 - x0 : z1 - z0, n = Math.max(1, Math.round(L / 1.5));
        for (let k = 0; k <= n; k++) { const u = (alongX ? x0 : z0) + L * k / n; (alongX ? solid('steel', u - 0.03, 3.0, z0 - 0.03, u + 0.03, 4.05, z0 + 0.03, { tint: [0.5, 0.55, 0.5] }) : solid('steel', x0 - 0.03, 3.0, u - 0.03, x0 + 0.03, 4.05, u + 0.03, { tint: [0.5, 0.55, 0.5] })).rail = true; }
        for (const y of [3.5, 3.98]) (alongX ? solid('steel', x0, y, z0 - 0.025, x1, y + 0.06, z0 + 0.025, { tint: [0.5, 0.55, 0.5] }) : solid('steel', x0 - 0.025, y, z0, x0 + 0.025, y + 0.06, z1, { tint: [0.5, 0.55, 0.5] })).rail = true;
        (alongX ? block(x0, 3.0, z0 - 0.07, x1, 4.05, z0 + 0.07, 'metal') : block(x0 - 0.07, 3.0, z0, x0 + 0.07, 4.05, z1, 'metal')).rail = true;
      };
      rail(-37.3, -21.32, -22, -21.32); rail(-22.02, -23, -22.02, -21.3); rail(-37.28, -35.5, -37.28, -21.3);
      for (const [x, z] of [[-37.2, -21.4], [-32, -21.4], [-27, -21.4], [-22.1, -21.4], [-37.2, -27], [-37.2, -32], [-37.2, -35.4]]) solid('steel', x - 0.07, 0, z - 0.07, x + 0.07, 2.85, z + 0.07, { tint: [0.45, 0.5, 0.46] });
      // twelve steps of 25 cm, north from the deck's end; a rail each side, for players a stepped wall
      for (let k = 1; k <= 12; k++) {
        const za = -35.5 - (13 - k) * 0.3, zb = -35.5 - (12 - k) * 0.3, y = 0.25 * k;
        solid('steel', -37.3, y - 0.06, za, -35.5, y, zb, { tint: [0.55, 0.58, 0.55] });   // open under: walked under and shot through, as it is drawn
        block(-37.355, y, za, -37.215, y + 1.0, zb, 'metal').rail = true; block(-35.585, y, za, -35.445, y + 1.0, zb, 'metal').rail = true;   // 14 cm, as the balcony's
      }
      for (const x of [-37.3, -35.53]) { beamPQ('steel', [x + 0.015, 0, -39.1], [x + 0.015, 3.0, -35.5], 0.05, 0.25, { tint: [0.45, 0.5, 0.46] }); beamPQ('steel', [x + 0.015, 1.0, -39.1], [x + 0.015, 4.0, -35.5], 0.04, 0.05, { tint: [0.45, 0.5, 0.46], hi: false }); }
    }

    /* ---- the stairs to the roofs (121-123): see ROOF_STAIRS. Treads open under, as the balcony stair's; a stepped wall for players down the
       open side and across the landing's end (a rail: jumped and vaulted, not stood on); posts under the landing and the flight. */
    for (const st of ROOF_STAIRS) {
      const b = BUILDINGS.find(q => q.id === st.b), [x0, z0, x1, z1] = b.at, H = b.H, alongX = st.side === 'n' || st.side === 's', out = st.side === 'n' || st.side === 'w' ? -1 : 1, d = st.dir;
      const face = st.side === 'n' ? z0 : st.side === 's' ? z1 : st.side === 'w' ? x0 : x1, N = STAIR.N, rise = H / N, q0 = face + out * STAIR.GAP, q1 = face + out * (STAIR.GAP + STAIR.W), qa = Math.min(q0, q1), qb = Math.max(q0, q1), qo = q1;
      const B = (ua, ub, y0, y1, pa, pb) => { const u0 = Math.min(ua, ub), u1 = Math.max(ua, ub), p0 = Math.min(pa, pb), p1 = Math.max(pa, pb); return alongX ? [u0, y0, p0, u1, y1, p1] : [p0, y0, u0, p1, y1, u1]; };
      const P3 = (u, y, q) => (alongX ? [u, y, q] : [q, y, u]);
      const TR = { tint: [0.55, 0.58, 0.55] }, FR = { tint: [0.45, 0.5, 0.46] }, uL = st.u0 + (N - 1) * STAIR.RUN * d, uE = uL + STAIR.LAND * d, yL = rise * (N - 1);
      for (let k = 1; k <= N; k++) {
        const ua = st.u0 + (k - 1) * STAIR.RUN * d, ub = k < N ? st.u0 + k * STAIR.RUN * d : uE, y = k < N ? rise * k : H;
        solid('steel', ...B(ua, ub, y - 0.06, y, qa, qb), TR).walk = true;                                         // a tread (the last is the landing): never capped
        block(...B(ua, ub, y, y + 1.0, qo - 0.07, qo + 0.07), 'metal').rail = true;                                  // the open side
      }
      block(...B(uE - 0.07, uE + 0.07, H, H + 1.0, qa, qb), 'metal').rail = true;                                    // across the landing's end
      // what carries it: a stringer each side, posts under the landing's corners and twice under the flight
      for (const q of [q0 + out * 0.03, q1 - out * 0.03]) beamPQ('steel', P3(st.u0, 0, q), P3(uL, yL, q), 0.05, 0.25, FR);
      for (const [u, top] of [[uL + 0.1 * d, H - 0.07], [uE - 0.1 * d, H - 0.07], [st.u0 + 9.5 * STAIR.RUN * d, rise * 10 - 0.31], [st.u0 + 18.5 * STAIR.RUN * d, rise * 19 - 0.31]]) solid('steel', ...B(u - 0.07, u + 0.07, 0, top, qo - out * 0.14, qo), FR);
      for (const q of [q0 + out * 0.03, q1 - out * 0.03]) beamPQ('steel', P3(uL, H - 0.19, q), P3(uE, H - 0.19, q), 0.05, 0.25, FR);
      beamPQ('steel', P3(uE - 0.03 * d, H - 0.19, q0), P3(uE - 0.03 * d, H - 0.19, q1), 0.05, 0.25, FR);
      // the rail as it is drawn: a top rail and a mid rail up the flight and round the landing, a baluster every fourth tread
      for (const h of [0.52, 1.0]) { beamPQ('steel', P3(st.u0, h, qo), P3(uL, yL + h, qo), 0.04, 0.05, { ...FR, hi: false }); beamPQ('steel', P3(uL, H + h, qo), P3(uE, H + h, qo), 0.04, 0.05, { ...FR, hi: false }); beamPQ('steel', P3(uE, H + h, q0), P3(uE, H + h, q1), 0.04, 0.05, { ...FR, hi: false }); }
      for (let k = 0; k <= N - 1; k += 4) { const u = st.u0 + k * STAIR.RUN * d, y = rise * k; beamPQ('steel', P3(u, y, qo), P3(u, y + 1.0, qo), 0.04, 0.04, { ...FR, hi: false }); }
      for (const [u, q] of [[uL, qo], [uE, qo], [uE, q0]]) beamPQ('steel', P3(u, H, q), P3(u, H + 1.0, q), 0.04, 0.04, { ...FR, hi: false });
      placed.push({ name: 'roof stair:' + st.b + st.side, x: alongX ? (st.u0 + uE) / 2 : (qa + qb) / 2, y: 0, z: alongX ? (qa + qb) / 2 : (st.u0 + uE) / 2, yaw: 0 });
    }

    /* ================================================================== hangars: a box to the eaves, a gable roof of
       corrugated sheet over it (out of reach: shots only), gables, a roll door on the west end */
    for (const h of HANGARS) {
      const [x0, z0, x1, z1] = h.at, E = h.eave, R = h.ridge, mid = (z0 + z1) / 2, half = (z1 - z0) / 2, tint = [1, 1, 1], ROOF = [1.5, 1.44, 1.34], BOARD = [0.84, 0.81, 0.74];   // weathered boards under a pale galvanised roof (114)
      solid('timber', x0, 0.3, z0, x1, E, z1, { tint, faces: 'wens', surface: 'wood' });
      solid('slab', x0 - 0.05, 0, z0 - 0.05, x1 + 0.05, 0.3, z1 + 0.05, { tint: [0.9, 0.88, 0.84] });
      for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) trim('paint', x - 0.1, 0.3, z - 0.1, x + 0.1, E, z + 0.1, { tint: BOARD, surface: 'wood' });      // corner boards
      for (const z of [z0, z1]) draw('paint', x0, E - 0.2, z - 0.035, x1, E, z + 0.035, { tint: BOARD, faces: 'nsb' });                                           // the board under each eave
      const ov = 0.45, vg = 0.3, rf = (d, sg) => [mid + sg * d, R - (R - E) * d / half];
      for (const sg of [-1, 1]) {
        const [za, ya] = rf(0, sg), [zb, yb] = rf(half + ov, sg);
        sheet('corrR', [[x0 - vg, ya, za], [x1 + vg, ya, za], [x1 + vg, yb, zb], [x0 - vg, yb, zb]], { tint: ROOF });
        beamPQ('paint', [x0 - vg, yb - 0.05, zb], [x1 + vg, yb - 0.05, zb], 0.06, 0.14, { tint: BOARD });     // the eaves' edge
        for (const x of [x0 - vg, x1 + vg]) beamPQ('paint', [x, ya - 0.06, za], [x, yb - 0.06, zb], 0.05, 0.14, { tint: BOARD, hi: false });                            // the barge boards up each gable
      }
      for (const x of [x0, x1]) { const P = [[x, E, z0], [x, E, z1], [x, R, mid]]; bld.face('timber', P, [x === x0 ? -1 : 1, 0, 0], P.map(p => [p[2], p[1]]), P.map(p => tone(p[0], p[1], p[2], tint)), 'cr'); hiTri(...P, 'wood'); }
      hitBox(x0, E, z0, x1, E + 0.05, z1, 'metal');                     // the ceiling, so nothing goes in over the walls
      // the roll door, its frame and its hood, flush on the west gable
      const dz0 = mid - 2.1, dz1 = mid + 2.1;
      draw('worn', x0 - 0.03, 0.3, dz0, x0, 4.2, dz1, { faces: 'w', tint: [0.62, 0.64, 0.66] });
      for (let y = 0.5; y < 4.1; y += 0.12) draw('steel', x0 - 0.05, y, dz0 + 0.05, x0 - 0.03, y + 0.03, dz1 - 0.05, { faces: 'wt', tint: [0.4, 0.42, 0.44], flat: true });
      trim('steel', x0 - 0.12, 0.3, dz0 - 0.2, x0, 4.4, dz0, { tint: [0.36, 0.34, 0.3] }); trim('steel', x0 - 0.12, 0.3, dz1, x0, 4.4, dz1 + 0.2, { tint: [0.36, 0.34, 0.3] });
      deco('steel', x0 - 0.35, 4.2, dz0 - 0.2, x0, 4.6, dz1 + 0.2, { tint: [0.36, 0.34, 0.3] });
      if (h.monitor) {       // the vent along the ridge (114): louvred sides between posts, its own little roof
        const a = x0 + 3, b = x0 + 13, yb = R - 0.12, yt = R + 0.74, hw2 = 0.75;
        deco('paint', a, yb, mid - hw2, b, yt, mid + hw2, { tint: [0.13, 0.13, 0.12], faces: 'wens', flat: true });                       // the dark behind the slats
        for (const sg of [-1, 1]) { const zf = mid + sg * hw2;
          for (let y = yb + 0.2; y < yt - 0.04; y += 0.1) { const Q = [[a + 0.04, y, zf + sg * 0.006], [b - 0.04, y, zf + sg * 0.006], [b - 0.04, y - 0.075, zf + sg * 0.065], [a + 0.04, y - 0.075, zf + sg * 0.065]]; bld.face('paint', Q, [0, 0.62, sg * 0.78], Q.map(q => [q[0], q[1]]), [0.8, 0.78, 0.72], 'r'); }
          for (let x = a; x <= b + 0.01; x += 1.25) draw('paint', x - 0.045, yb, zf + (sg > 0 ? 0 : -0.07), x + 0.045, yt, zf + (sg > 0 ? 0.07 : 0), { tint: BOARD, flat: true, shadow: 'r' });
          sheet('corrR', [[a - 0.3, yt + 0.34, mid], [b + 0.3, yt + 0.34, mid], [b + 0.3, yt - 0.03, mid + sg * 1.08], [a - 0.3, yt - 0.03, mid + sg * 1.08]], { tint: ROOF }); }
        for (const x of [a, b]) { const P = [[x, yt, mid - hw2], [x, yt, mid + hw2], [x, yt + 0.24, mid]]; bld.face('timber', P, [x === a ? -1 : 1, 0, 0], P.map(q => [q[2], q[1]]), tint, 'cr'); }
      }
      if (h.id === 'G1') {   // the awning over the workshop door (3, 22): posts, a sloping sheet; a slab for players under it
        for (const z of [15.2, 22.8]) solid('steel', 2.55, 0, z - 0.06, 2.67, 3.25, z + 0.06, { tint: [0.4, 0.4, 0.38] });
        sheet('corrR', [[x0, 3.75, 15.0], [x0, 3.75, 23.0], [2.3, 3.3, 23.0], [2.3, 3.3, 15.0]], { tint: ROOF });
        block(2.3, 3.2, 15.0, x0, 3.7, 23.0, 'metal');
      }
      if (h.leanTo) {        // the lean-to along the wash bay's south side, by the fence (46-49)
        for (let x = x0 + 0.2; x <= x1; x += 4.9) solid('steel', x - 0.06, 0, 39.14, x + 0.06, 2.8, 39.26, { tint: [0.4, 0.4, 0.38] });
        sheet('corrR', [[x0, 3.45, z1], [x1, 3.45, z1], [x1, 2.8, 39.5], [x0, 2.8, 39.5]], { tint: ROOF });
        block(x0, 2.72, z1, x1, 3.45, 39.5, 'metal');
      }

      // Stage 3: the name over the door, louvres high in both gables, skylights in the roof, the monitor's louvres, lamps (3, 20-22, 45-52)
      { const k = h.id === 'G1' ? 0 : 1;
        deco('paint', x0 - 0.04, 4.66, mid - 2.24, x0 - 0.005, 5.8, mid + 2.24, { tint: [0.3, 0.3, 0.28], hi: false });
        signQuad(k, [x0 - 0.045, 5.23, mid], [-1, 0, 0], 4.3, 1.075);
        for (const x of [x0, x1]) { const sg = x === x0 ? -1 : 1;
          deco('worn', x + sg * 0.04 - 0.02, 5.82, mid - 0.68, x + sg * 0.04 + 0.02, 6.4, mid + 0.68, { tint: [0.5, 0.5, 0.48], hi: false });
          for (let y = 5.88; y < 6.34; y += 0.075) { const P = [[x + sg * 0.065, y, mid - 0.62], [x + sg * 0.065, y, mid + 0.62], [x + sg * 0.065, y + 0.04, mid + 0.62], [x + sg * 0.065, y + 0.04, mid - 0.62]]; bld.face('grille', P, [sg, 0, 0], P.map(p => [p[2], p[1]]), [1, 1, 1], 'cr'); } }
        for (const sg of [-1, 1]) for (const xc of [x0 + 5.2, x0 + 14.8]) {      // two wide rooflights a slope, four panes in a frame (114)
          const [za, ya] = rf(1.55, sg), [zb, yb] = rf(4.05, sg), wd = 1.35, sl = (R - E) / half, at = (x, t, lift) => [x, lerp(ya, yb, t) + lift, lerp(za, zb, t)];
          const nn = vnorm([0, 1, sg * sl]), q4 = (m, xa, xb, ta, tb, lift, col) => { const Q = [at(xa, tb, lift), at(xb, tb, lift), at(xb, ta, lift), at(xa, ta, lift)]; bld.face(m, Q, nn, Q.map(p => [p[0], p[2]]), col, 'r'); };
          q4('paint', xc - wd - 0.1, xc + wd + 0.1, -0.04, 1.04, 0.035, [0.36, 0.37, 0.36]);                    // the frame
          q4('skylite', xc - wd, xc + wd, 0, 1, 0.05, [0.82, 0.9, 0.98]);                                       // the glazing
          for (const dx of [-wd / 2, 0, wd / 2]) q4('paint', xc + dx - 0.03, xc + dx + 0.03, 0, 1, 0.06, [0.42, 0.43, 0.42]); }
        for (const [x, z, sg] of h.id === 'G1' ? [[10, z0, -1], [22, z0, -1]] : [[12, z0, -1], [20, z0, -1]]) { deco('steel', x - 0.13, 4.0, z + sg * 0.32, x + 0.13, 4.16, z, { tint: [0.28, 0.29, 0.28], hi: false }); const P = [[x - 0.1, 3.998, z + sg * 0.05], [x + 0.1, 3.998, z + sg * 0.05], [x + 0.1, 3.998, z + sg * 0.3], [x - 0.1, 3.998, z + sg * 0.3]]; bld.face('paint', P, [0, -1, 0], P.map(p => [p[0], p[2]]), [1.55, 1.5, 1.3], 'r'); }
      }
      placed.push({ name: 'hangar:' + h.id, x: (x0 + x1) / 2, y: 0, z: mid, yaw: 0 });
    }
    // the apron (drawn on the ground) and its drain along it
    draw('pave', -6, 0, 12, 6, 0.02, 39, { faces: 'wenst', tint: [1.0, 0.99, 0.96], shadow: 'r' });         // pale, sun-bleached concrete (114)
    draw('steel', -1.2, 0.025, 13, -0.9, 0.026, 38, { faces: 't', tint: [0.3, 0.3, 0.3], flat: true, shadow: 'r' });

    /* ================================================================== the comm block's tower, on its roof (3, 6, 7, 19) */
    {
      const cx = 30.5, cz = -1.5, y0 = 4.2, top = 28, b0 = 1.6, b1 = 0.6, at = y => lerp(b0, b1, (y - y0) / (top - y0)), tw = [0.45, 0.43, 0.4];
      const leg = (sx, sz) => beamPQ('steel', [cx + sx * b0, y0, cz + sz * b0], [cx + sx * b1, top, cz + sz * b1], 0.12, 0.12, { tint: tw });
      leg(-1, -1); leg(1, -1); leg(1, 1); leg(-1, 1);
      for (let y = y0; y < top - 0.1; y += 2.4) {
        const y1 = Math.min(top, y + 2.4), a = at(y), c = at(y1), C = (sx, sz, h, r) => [cx + sx * r, h, cz + sz * r];
        for (const [p, q] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) {
          beamPQ('steel', C(p[0], p[1], y, a), C(q[0], q[1], y, a), 0.06, 0.06, { tint: tw });
          beamPQ('steel', C(p[0], p[1], y, a), C(q[0], q[1], y1, c), 0.05, 0.05, { tint: tw }); beamPQ('steel', C(q[0], q[1], y, a), C(p[0], p[1], y1, c), 0.05, 0.05, { tint: tw });
        }
      }
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) solid('slab', cx + sx * b0 - 0.3, y0, cz + sz * b0 - 0.3, cx + sx * b0 + 0.3, y0 + 0.3, cz + sz * b0 + 0.3, { tint: [0.9, 0.88, 0.85] });
      /* the comm block's roof is walked on: the tower is a closed cage to a player (every face braced, no gap a body fits), so a box
         per 2.4 m bay at that bay's width stops them, to 12 m; and the ladder up its north face, which cannot be climbed */
      for (let y = y0; y < 12 - 1e-6; y += 2.4) { const y1 = Math.min(12, y + 2.4), a = at(y) + 0.1; block(cx - a, y, cz - a, cx + a, y1, cz + a, 'metal'); block(cx - 0.26, y, cz - at(y) - 0.21, cx + 0.26, y1, cz - a, 'metal'); }
      { const d = dish([cx + at(19) + 0.45, 19, cz], [1, 0.05, 0.25], 1.0, 0.27); beamPQ('steel', [cx + at(19), 19, cz], d.back, 0.08, 0.08, { tint: tw }); }   // the microwave dish
      for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const r = at(22.2) + 0.16, x = cx + sx * r, z = cz + sz * r;   // panel antennas, one on each face
        deco('paint', x - (sz ? 0.17 : 0.06), 21.5, z - (sx ? 0.17 : 0.06), x + (sz ? 0.17 : 0.06), 23.0, z + (sx ? 0.17 : 0.06), { tint: [0.92, 0.92, 0.9] });
        for (const y of [21.7, 22.8]) beamPQ('steel', [cx + sx * (r - 0.18), y, cz + sz * (r - 0.18)], [x - sx * 0.06, y, z - sz * 0.06], 0.03, 0.03, { tint: tw, hi: false }); }
      { const zf = y => cz - at(y) - 0.16;   // the ladder up the north face
        for (const dx of [-0.2, 0.2]) beamPQ('steel', [cx + dx, y0, zf(y0)], [cx + dx, top, zf(top)], 0.035, 0.035, { tint: tw });
        for (let y = y0 + 0.3; y < top; y += 0.3) beamPQ('steel', [cx - 0.2, y, zf(y)], [cx + 0.2, y, zf(y)], 0.022, 0.022, { tint: tw, hi: false }); }
      for (const s of [-1, 1]) deco('galv', cx - 0.08 + s * 0.5, 24, cz - 0.08, cx + 0.08 + s * 0.5, 26.5, cz + 0.08, { tint: [0.9, 0.9, 0.9] });
      deco('steel', cx - 0.03, top, cz - 0.03, cx + 0.03, top + 3, cz + 0.03, { tint: [0.4, 0.4, 0.4] });
    }

    /* ================================================================== the fence: posts on footings every 3 m, a top rail,
       chain-link (shots go through it; players are held by the wall on its line), arms with barbed wire */
    const posts = [];
    /* A fence's shadow, drawn: the band of ground the sun's light crosses the chain-link to reach, a lattice at the strength
       the wire takes out of the light (a quarter). The shadow map is too coarse for a 5 cm mesh; this is what it would draw. */
    const SD = (() => { const el = SUN.el * Math.PI / 180, az = SUN.az * Math.PI / 180; return [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)]; })();
    function fenceShadow(x0, z0, x1, z1, h) {
      const ox = -SD[0] / SD[1] * h, oz = -SD[2] / SD[1] * h, L = Math.hypot(x1 - x0, z1 - z0), W = Math.hypot(ox, oz), y = 0.013;
      const P = [[x0, y, z0], [x1, y, z1], [x1 + ox, y, z1 + oz], [x0 + ox, y, z0 + oz]];
      bld.face('lattice', P, [0, 1, 0], [[0, 0], [L / 0.11, 0], [L / 0.11, W / 0.16], [0, W / 0.16]], [1, 1, 1], 'r');
      const n = Math.max(1, Math.round(L / 3)), ux = (x1 - x0) / L, uz = (z1 - z0) / L, k = 0.045;
      if (h > 2.2) for (let i = 0; i <= n; i++) { const px = x0 + (x1 - x0) * i / n, pz = z0 + (z1 - z0) * i / n, ex = px + ox * 1.03, ez = pz + oz * 1.03;   // each post's shadow, to the top of its arm
        const Q = [[px - ux * k, y + 0.001, pz - uz * k], [px + ux * k, y + 0.001, pz + uz * k], [ex + ux * k, y + 0.001, ez + uz * k], [ex - ux * k, y + 0.001, ez - uz * k]]; bld.face('shade', Q, [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1], 'r'); }
    }
    function fenceRun(x0, z0, x1, z1) {
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 3)), dx = (x1 - x0) / L, dz = (z1 - z0) / L, nx = -dz, nz = dx;
      for (let k = 0; k <= n; k++) { const x = x0 + (x1 - x0) * k / n, z = z0 + (z1 - z0) * k / n; if (posts.some(([px, pz]) => Math.hypot(px - x, pz - z) < 0.5)) continue; posts.push([x, z]);
        solid('galv', x - 0.045, 0.2, z - 0.045, x + 0.045, 2.45, z + 0.045, { tint: [0.78, 0.78, 0.74] }); solid('concrete', x - 0.18, 0, z - 0.18, x + 0.18, 0.22, z + 0.18, { tint: [0.95, 0.93, 0.88] });
        cyl('galv', 'y', [x, 2.47, z], 0.058, 0.05, { tint: [0.7, 0.7, 0.66], n: 8 });   // the post's cap
        beamPQ('galv', [x, 2.45, z], [x - nx * 0.35, 2.85, z - nz * 0.35], 0.04, 0.04, { tint: [0.78, 0.78, 0.74] }); beamPQ('galv', [x, 2.45, z], [x + nx * 0.35, 2.85, z + nz * 0.35], 0.04, 0.04, { tint: [0.78, 0.78, 0.74] }); }
      sheet('link', [[x0, 0.05, z0], [x1, 0.05, z1], [x1, 2.38, z1], [x0, 2.38, z0]], { hi: false, tint: [0.85, 0.85, 0.82], shadow: 'n' });
      fenceShadow(x0, z0, x1, z1, 2.38);
      beamPQ('galv', [x0, 2.4, z0], [x1, 2.4, z1], 0.045, 0.045, { tint: [0.78, 0.78, 0.74] });
      for (const s of [-1, 1]) for (const k of [0.15, 0.27]) beamPQ('steel', [x0 + s * nx * k * 1.25, 2.45 + k * 1.45, z0 + s * nz * k * 1.25], [x1 + s * nx * k * 1.25, 2.45 + k * 1.45, z1 + s * nz * k * 1.25], 0.012, 0.012, { tint: [0.45, 0.45, 0.45], hi: false });
      // the fabric is a wall for players (the ring outside does the rest); on the slant, steps of 25 cm
      if (Math.abs(dx) < 1e-6 || Math.abs(dz) < 1e-6) block(Math.min(x0, x1) - 0.03, 0, Math.min(z0, z1) - 0.03, Math.max(x0, x1) + 0.03, 2.45, Math.max(z0, z1) + 0.03, 'metal');
    }
    const [g0, g1] = FENCE.gate;
    fenceRun(FENCE.x0, FENCE.z0, FENCE.x1, FENCE.z0); fenceRun(FENCE.x1, FENCE.z0, FENCE.x1, FENCE.z1); fenceRun(FENCE.cham[2], FENCE.z1, FENCE.x1, FENCE.z1);
    fenceRun(FENCE.x0, FENCE.z0, FENCE.x0, g0); fenceRun(FENCE.x0, g1, FENCE.x0, FENCE.cham[1]); fenceRun(FENCE.cham[0], FENCE.cham[1], FENCE.cham[2], FENCE.cham[3]);
    // the gate: two leaves of chain-link in steel frames, swung open into the yard; a concrete sill with a drain across it
    for (const z of [g0 + 0.06, g1 - 0.06]) {
      const L = (g1 - g0) / 2 - 0.1, xa = FENCE.x0 + 0.05, xb = xa + L;
      solid('steel', FENCE.x0 - 0.08, 0, z - 0.08, FENCE.x0 + 0.08, 2.5, z + 0.08, { tint: [0.4, 0.44, 0.4] });
      for (const [a, b, c, d] of [[xa, 0.08, xb, 0.14], [xa, 2.06, xb, 2.12], [xa, 0.08, xa + 0.06, 2.12], [xb - 0.06, 0.08, xb, 2.12]]) solid('steel', a, b, z - 0.03, c, d, z + 0.03, { tint: [0.4, 0.44, 0.4] });
      sheet('link', [[xa, 0.14, z], [xb, 0.14, z], [xb, 2.06, z], [xa, 2.06, z]], { hi: false, tint: [0.8, 0.8, 0.78], shadow: 'n' });
      fenceShadow(xa, z, xb, z, 2.06);
      beamPQ('steel', [xa, 0.15, z], [xb, 2.05, z], 0.03, 0.03, { tint: [0.4, 0.44, 0.4] });
      block(xa, 0, z - 0.04, xb, 2.12, z + 0.04, 'metal');
      for (const y of [0.35, 1.75]) draw('steel', FENCE.x0 + 0.04, y, z - 0.06, FENCE.x0 + 0.13, y + 0.1, z + 0.06, { tint: [0.28, 0.28, 0.27], flat: true });   // hinges
      beamPQ('steel', [xb - 0.14, 0.0, z + 0.06], [xb - 0.14, 0.95, z + 0.06], 0.022, 0.022, { tint: [0.35, 0.36, 0.34], hi: false });                       // the drop rod
      beamPQ('steel', [xb - 0.14, 0.95, z + 0.06], [xb - 0.3, 0.95, z + 0.06], 0.02, 0.02, { tint: [0.35, 0.36, 0.34], hi: false });
    }
    draw('slab', -55, 0, g0, -47, 0.022, g1, { faces: 'wenst', tint: [1.25, 1.23, 1.18], shadow: 'r' });
    draw('steel', -51.25, 0.024, g0, -50.95, 0.025, g1, { faces: 't', tint: [0.28, 0.27, 0.25], flat: true, shadow: 'r' });

    /* ================================================================== vehicles (22-33, 53-56, 7, 19)
       The Stage 1 outlines still stop players and shots; Stage 4 dresses them: wheels with hubs and nuts, grilles, lamps,
       bumpers, windows, doors, mirrors, steps, canvas over its bows, plates, fuel tanks and the gear each one carries.
       vehicle(cx, cz, alongX, dir): a frame where u runs from the back to the front, w across it (+w is the 'l' side) */
    function vehicle(cx, cz, alongX, dir, paint) {
      const P = (u, w) => (alongX ? [cx + dir * u, cz + dir * w] : [cx - dir * w, cz + dir * u]);
      const W3 = (u, y, w) => { const p = P(u, w); return [p[0], y, p[1]]; };
      const N3 = (nu, nw) => { const a = P(0, 0), b = P(nu, nw); return [b[0] - a[0], 0, b[1] - a[1]]; };
      const box = (fn, mat, u0, y0, w0, u1, y1, w1, o = {}) => { const a = P(u0, w0), b = P(u1, w1); return fn(mat, Math.min(a[0], b[0]), y0, Math.min(a[1], b[1]), Math.max(a[0], b[0]), y1, Math.max(a[1], b[1]), { tint: paint, ...o }); };
      const add = (u0, y0, w0, u1, y1, w1, o = {}) => { const a = P(u0, w0), b = P(u1, w1); return ph.addBox([Math.min(a[0], b[0]), y0, Math.min(a[1], b[1])], [Math.max(a[0], b[0]), y1, Math.max(a[1], b[1])], { surface: 'metal', ...o }); };
      // a flat quad on a face: 'f' (u = at, facing +u), 'b', 'l' (w = at, facing +w), 'r'; a0..a1 across it, y0..y1
      const quad = (mat, side, at, a0, a1, y0, y1, col = [1, 1, 1]) => {
        const nu = side === 'f' ? 1 : side === 'b' ? -1 : 0, nw = side === 'l' ? 1 : side === 'r' ? -1 : 0, pt = (a, y) => (nu ? W3(at, y, a) : W3(a, y, at)), Q = [pt(a0, y0), pt(a1, y0), pt(a1, y1), pt(a0, y1)];
        bld.face(mat, Q, N3(nu, nw), Q.map(p => [p[0] + p[2], p[1]]), col, 'cr');
      };
      const disc = (mat, side, at, a, y, r, col, n = 14) => { const nu = side === 'f' ? 1 : side === 'b' ? -1 : 0, nw = side === 'l' ? 1 : side === 'r' ? -1 : 0, Q = [];
        for (let k = 0; k < n; k++) { const t = k / n * TAU; Q.push(nu ? W3(at, y + Math.sin(t) * r, a + Math.cos(t) * r) : W3(a + Math.cos(t) * r, y + Math.sin(t) * r, at)); } bld.face(mat, Q, N3(nu, nw), Q.map(p => [p[0] + p[2], p[1]]), col, 'cr'); };
      const uAx = alongX ? 'x' : 'z', wAx = alongX ? 'z' : 'x';
      const wheel = (u, w, r, wd) => { const s = Math.sign(w) || 1, at = d => { const p = P(u, w + s * d); return [p[0], r, p[1]]; };
        cyl('tire', wAx, at(0), r, wd, { tint: [0.9, 0.9, 0.9], n: 18 });
        cyl('paint', wAx, at(wd / 2 + 0.006), r * 0.56, 0.012, { tint: vscale(paint, 0.78), n: 16 });
        cyl('steel', wAx, at(wd / 2 + 0.022), r * 0.17, 0.03, { tint: [0.5, 0.5, 0.48], n: 8 });
        for (let j = 0; j < 6; j++) { const t = j / 6 * TAU, p = P(u + Math.cos(t) * r * 0.36, w + s * (wd / 2 + 0.016)); cyl('steel', wAx, [p[0], r + Math.sin(t) * r * 0.36, p[1]], r * 0.045, 0.02, { tint: [0.42, 0.42, 0.4], n: 6 }); }
        add(u - r * 0.85, 0, w - wd / 2, u + r * 0.85, r * 1.85, w + wd / 2, { surface: 'wood' }); };
      return { box, add, wheel, quad, disc, W3, N3, P, uAx, wAx, paint, solid: (...a) => box(solid, ...a), deco: (...a) => box(deco, ...a), draw: (...a) => box(draw, ...a) };
    }
    // a truck's cab: grille, lamps and a bumper on the front, windows, doors and a handle on each side, mirrors, a step
    function cab(v, o) {
      const { u1, hw } = o, sd = s => (s > 0 ? 'l' : 'r');
      v.quad('grille', 'f', u1 + 0.006, -o.grill[2], o.grill[2], o.grill[0], o.grill[1]);
      for (let y = o.grill[0] + 0.05; y < o.grill[1] - 0.03; y += 0.075) v.quad('paint', 'f', u1 + 0.009, -o.grill[2] + 0.03, o.grill[2] - 0.03, y, y + 0.025, vscale(v.paint, 0.85));
      for (const s of [-1, 1]) { const c = s * (hw - 0.17);
        v.quad('paint', 'f', u1 + 0.008, c - 0.12, c + 0.12, o.lamp - 0.08, o.lamp + 0.08, [1.6, 1.55, 1.35]);
        v.quad('paint', 'f', u1 + 0.008, c - 0.06, c + 0.06, o.lamp + 0.12, o.lamp + 0.18, [1.5, 0.75, 0.15]); }
      v.solid('steel', u1, o.bump[0], -hw - 0.04, u1 + 0.18, o.bump[1], hw + 0.04, { tint: [0.3, 0.31, 0.3] });
      if (o.plate != null) signQuad(o.plate, v.W3(u1 + 0.186, (o.bump[0] + o.bump[1]) / 2, 0), v.N3(1, 0), 0.52, 0.13);
      for (const s of [-1, 1]) {
        v.quad('glass', sd(s), s * (hw + 0.006), o.winU[0], o.winU[1], o.win[0], o.win[1]);
        const dq = (a, b, c, d, col = [0.24, 0.24, 0.24]) => v.quad('steel', sd(s), s * (hw + 0.008), a, b, c, d, col);
        dq(o.doorU[0], o.doorU[0] + 0.02, o.door[0], o.door[1]); dq(o.doorU[1] - 0.02, o.doorU[1], o.door[0], o.door[1]); dq(o.doorU[0], o.doorU[1], o.door[0], o.door[0] + 0.02);
        dq(o.doorU[0] + 0.1, o.doorU[0] + 0.28, o.win[0] - 0.13, o.win[0] - 0.09, [0.36, 0.36, 0.35]);
        const [mu, my] = o.mirror;
        if (o.mirrorSolid) v.solid('steel', mu - 0.05, my - 0.1, s * hw, mu + 0.05, my + 0.1, s * (hw + 0.2), { tint: [0.22, 0.22, 0.22] });
        else { beamPQ('steel', v.W3(mu, my - 0.12, s * hw), v.W3(mu, my, s * (hw + 0.26)), 0.025, 0.025, { tint: [0.25, 0.25, 0.25], hi: false }); v.draw('steel', mu - 0.04, my - 0.22, s * (hw + 0.22), mu + 0.04, my + 0.22, s * (hw + 0.34), { tint: [0.22, 0.22, 0.22], flat: true }); }
        if (o.step) v.solid('steel', o.stepU[0], o.step - 0.05, s * hw, o.stepU[1], o.step, s * (hw + 0.16), { tint: [0.3, 0.3, 0.3] });
      }
    }
    // canvas over its bows: a darker seam over each bow, a rope along the foot, the back flap laced down
    function canvasBack(v, u0, u1, y0, y1, hw, col) {
      for (let u = u0 + 0.45; u < u1 - 0.2; u += 0.9) { for (const s of [-1, 1]) v.quad('tarp', s > 0 ? 'l' : 'r', s * (hw + 0.006), u - 0.04, u + 0.04, y0 + 0.1, y1 - 0.05, vscale(col, 0.75));
        const Q = [v.W3(u - 0.04, y1 + 0.006, -hw), v.W3(u + 0.04, y1 + 0.006, -hw), v.W3(u + 0.04, y1 + 0.006, hw), v.W3(u - 0.04, y1 + 0.006, hw)]; bld.face('tarp', Q, [0, 1, 0], Q.map(p => [p[0], p[2]]), vscale(col, 0.75), 'cr'); }
      for (const s of [-1, 1]) v.quad('steel', s > 0 ? 'l' : 'r', s * (hw + 0.01), u0, u1, y0 + 0.08, y0 + 0.11, [0.3, 0.28, 0.24]);
      v.quad('tarp', 'b', u0 - 0.006, -hw + 0.05, hw - 0.05, y0 + 0.05, y1 - 0.1, vscale(col, 0.88));
      for (const a of [-hw * 0.5, 0, hw * 0.5]) v.quad('steel', 'b', u0 - 0.01, a - 0.015, a + 0.015, y0 + 0.05, y1 - 0.15, [0.28, 0.26, 0.22]);
    }
    const tail = (v, u, a, y) => { for (const s of [-1, 1]) v.quad('paint', 'b', u - 0.006, s * a - 0.09, s * a + 0.09, y, y + 0.14, [1.25, 0.16, 0.1]); };
    const fuel = (v, u, w, r, len, y) => { cyl('worn', v.uAx, v.W3(u, y, w), r, len, { tint: [0.55, 0.57, 0.5], n: 14 }); v.add(u - len / 2, y - r, w - r, u + len / 2, y + r, w + r, { bulletOnly: true }); };
    const OLIVE = [0.5, 0.52, 0.38], OLIVE2 = [0.44, 0.46, 0.34], SAND = [0.86, 0.78, 0.62], CANVAS = [0.62, 0.6, 0.46], CANVAS2 = [0.42, 0.44, 0.36];
    // the five-axle tractor with a canvas back (27-31)
    if (!placeModel('marmot', -31, 0.5, 3, 'truck:8x8')) { const v = vehicle(-31, -1, false, 1, OLIVE);
      for (const u of [4.6, 2.7, 0.2, -1.9, -4.4]) for (const s of [-1, 1]) v.wheel(u, s * 1.12, 0.66, 0.42);
      v.solid('paint', -6, 0.75, -1.0, 6, 1.35, 1.0); v.solid('paint', -6, 1.25, -1.3, 6, 1.4, 1.3);
      v.solid('paint', 3.4, 1.4, -1.28, 6.1, 3.05, 1.28); v.solid('glass', 5.6, 2.2, -1.1, 6.12, 2.95, 1.1, { tint: [1, 1, 1], flat: true });
      v.solid('paint', 0.2, 1.4, -1.1, 3.2, 2.3, 1.1, { tint: OLIVE2 }); v.solid('steel', 3.1, 1.4, 0.6, 3.3, 3.6, 0.85, { tint: [0.3, 0.3, 0.3] });
      v.solid('tarp', -6, 1.4, -1.3, -2.4, 3.2, 1.3, { tint: CANVAS2 });
      cab(v, { u1: 6.1, hw: 1.28, win: [2.2, 2.85], winU: [4.65, 5.45], door: [1.45, 2.95], doorU: [3.65, 5.5], grill: [1.5, 2.1, 0.75], lamp: 1.72, bump: [0.55, 0.95], mirror: [5.85, 2.55], step: 1.0, stepU: [3.44, 3.98] });
      canvasBack(v, -6, -2.4, 1.4, 3.2, 1.3, CANVAS2); tail(v, -6, 0.78, 0.92); v.solid('steel', -6.15, 0.58, -1.25, -6.0, 0.8, 1.25, { tint: [0.3, 0.31, 0.3] });
      // the winch, the spare wheel lying on the gear box, jerry cans, fuel tanks, a hatch in the cab roof, the gear box's doors, the antennas on their mounts
      v.solid('steel', 6.28, 0.6, -0.36, 6.5, 0.92, 0.36, { tint: [0.3, 0.31, 0.3] }); cyl('steel', v.wAx, v.W3(6.52, 0.76, 0), 0.13, 0.56, { tint: [0.42, 0.42, 0.4], n: 12 });
      { const c = v.W3(1.7, 2.49, 0); cyl('tire', 'y', c, 0.62, 0.38, { tint: [0.9, 0.9, 0.9], n: 18 }); cyl('paint', 'y', [c[0], 2.686, c[2]], 0.34, 0.012, { tint: vscale(OLIVE, 0.78), n: 14 }); v.add(1.08, 2.3, -0.62, 2.32, 2.68, 0.62, { surface: 'wood' }); }
      for (let k = 0; k < 3; k++) { const u = 0.45 + k * 0.42; v.solid('paint', u - 0.17, 1.4, 1.12, u + 0.17, 1.86, 1.28, { tint: OLIVE2 }); v.quad('steel', 'l', 1.286, u - 0.1, u + 0.1, 1.76, 1.8, [0.3, 0.3, 0.28]); }
      for (const s of [-1, 1]) fuel(v, 1.45, s * 1.0, 0.27, 1.0, 0.92);
      v.solid('paint', 4.45, 3.05, -0.32, 5.05, 3.12, 0.32, { tint: OLIVE2 });
      for (const s of [-1, 1]) { const sd = s > 0 ? 'l' : 'r'; for (const u of [1.2, 2.2]) v.quad('steel', sd, s * 1.106, u - 0.01, u + 0.01, 1.45, 2.25, [0.25, 0.25, 0.25]); if (s < 0) for (const u of [0.7, 1.7, 2.7]) v.quad('steel', sd, -1.107, u - 0.05, u + 0.05, 1.8, 1.9, [0.32, 0.32, 0.3]); }
      for (const [u, w, h, base, mh] of [[2.8, -0.9, 7.5, 2.3, 0.12], [0.5, 0.8, 9, 2.3, 0.12], [5.2, 0.9, 4.5, 3.05, 0.08]]) { const c = v.P(u, w); v.solid('steel', u - 0.07, base, w - 0.07, u + 0.07, base + mh, w + 0.07, { tint: [0.25, 0.25, 0.25] }); deco('steel', c[0] - 0.015, base + mh, c[1] - 0.015, c[0] + 0.015, h, c[1] + 0.015, { tint: [0.2, 0.2, 0.2], hi: false }); }
      for (const s of [-1, 1]) v.draw('tire', -5.21, 0.25, s * 0.92, -5.18, 0.9, s * 1.32, { tint: [0.6, 0.6, 0.6], flat: true });
      placed.push({ name: 'truck:8x8', x: -31, y: 0, z: -1, yaw: 0 }); }
    // the six-wheel canvas truck "YD 06" (32-33), cab to the west; the flatbed "YD 12" with three crates (23-26), its bed backed up to the dock
    for (const [cx, cz, canvas, dir] of [[-13.5, 7, true, -1], [-17.94, 18.15, false, 1]]) {
      // the Ural model in both places when it loaded: the second backed up to the dock (its tail 10 cm off the dock's east end at x -22.4)
      if (placeModel('ural', canvas ? cx : -22.4 + 0.1 + 7.57 / 2, cz, dir > 0 ? 0 : 2, canvas ? 'truck:canvas' : 'truck:flatbed')) continue;
      const col = canvas ? OLIVE : [0.62, 0.62, 0.5], v = vehicle(cx, cz, true, dir, col), plate = canvas ? 9 : 10;
      for (const u of [2.9, -1.5, -2.9]) for (const s of [-1, 1]) v.wheel(u, s * 1.0, 0.55, 0.36);
      v.solid('paint', -4.2, 0.62, -0.95, 4.25, 1.15, 0.95); v.solid('wood', -4.2, 1.15, -1.25, 2.0, 1.3, 1.25, { tint: [0.7, 0.66, 0.56] });
      v.solid('paint', 2.3, 1.15, -1.25, 4.3, 2.95, 1.25, { tint: canvas ? OLIVE2 : [0.7, 0.66, 0.52] }); v.solid('glass', 4.0, 1.95, -1.1, 4.32, 2.75, 1.1, { tint: [1, 1, 1], flat: true });
      cab(v, { u1: 4.3, hw: 1.25, win: [1.95, 2.6], winU: [3.05, 3.95], door: [1.2, 2.8], doorU: [2.45, 4.0], grill: [1.3, 1.85, 0.7], lamp: 1.48, bump: [0.48, 0.85], mirror: [4.1, 2.3], step: 0.72, stepU: [3.5, 4.2], plate });
      signQuad(plate, v.W3(-4.206, 0.88, 0), v.N3(-1, 0), 0.52, 0.13); tail(v, -4.2, 0.75, 0.74); v.solid('steel', -4.36, 0.48, -1.15, -4.2, 0.66, 1.15, { tint: [0.3, 0.31, 0.3] });
      fuel(v, 0.8, 1.0, 0.24, 1.0, 0.8);
      if (canvas) { v.solid('tarp', -4.2, 1.3, -1.25, 2.0, 3.1, 1.25, { tint: CANVAS }); canvasBack(v, -4.2, 2.0, 1.3, 3.1, 1.25, CANVAS); }
      else { for (const s of [-1, 1]) v.solid('wood', -4.2, 1.3, s * 1.2 - 0.05, 2.0, 1.75, s * 1.2 + 0.05, { tint: [0.6, 0.6, 0.5] });
        const crates = [[-3.9, -2.4, 1.35], [-2.2, 0.0, 1.6], [0.2, 1.8, 1.2]];
        for (const [u0, u1, h] of crates) { v.solid('wood', u0, 1.3, -0.95, u1, 1.3 + h, 0.95, { tint: [0.78, 0.6, 0.38] });
          for (const f of [0.28, 0.72]) { const u = u0 + (u1 - u0) * f, top = 1.3 + h, S = [0.72, 0.4, 0.12], Q = [v.W3(u - 0.025, top + 0.006, -0.95), v.W3(u + 0.025, top + 0.006, -0.95), v.W3(u + 0.025, top + 0.006, 0.95), v.W3(u - 0.025, top + 0.006, 0.95)];   // ratchet straps
            bld.face('tarp', Q, [0, 1, 0], Q.map(p => [p[0], p[2]]), S, 'cr'); for (const s of [-1, 1]) v.quad('tarp', s > 0 ? 'l' : 'r', s * 0.956, u - 0.025, u + 0.025, 1.3, top, S); } }
        cyl('tarp', v.wAx, v.W3(2.1, 3.15, 0), 0.28, 2.2, { tint: [0.95, 0.86, 0.64] });
        v.solid('grille', 2.06, 1.35, -1.15, 2.14, 2.8, 1.15, { tint: [1, 1, 1] }); for (const w of [-1.17, 1.17]) beamPQ('steel', v.W3(2.1, 1.3, w), v.W3(2.1, 2.85, w), 0.05, 0.05, { tint: [0.3, 0.3, 0.3], hi: false }); beamPQ('steel', v.W3(2.1, 2.85, -1.17), v.W3(2.1, 2.85, 1.17), 0.05, 0.05, { tint: [0.3, 0.3, 0.3], hi: false }); }
      placed.push({ name: canvas ? 'truck:canvas' : 'truck:flatbed', x: cx, y: 0, z: cz, yaw: 0 });
    }
    // two pickups, olive with a roll bar and a roof rack, and sand with a toolbox (22-26)
    for (const [cx, cz, col, olive] of [[-17, 23, [0.6, 0.6, 0.46], true], [-10.5, 24.5, SAND, false]]) {
      if (placeModel('suv', cx, cz, olive ? 1 : 3, 'car:suv')) continue;          // the SUV model, when it loaded: the second parked the other way round
      const v = vehicle(cx, cz, false, -1, col);
      for (const u of [1.6, -1.6]) for (const s of [-1, 1]) v.wheel(u, s * 0.82, 0.42, 0.28);
      v.solid('paint', -2.6, 0.42, -0.95, 2.6, 0.85, 0.95); v.solid('paint', 0.9, 0.85, -0.95, 2.6, 1.12, 0.95);
      v.solid('paint', -0.6, 0.85, -0.95, 0.9, 1.88, 0.95); v.solid('glass', 0.85, 1.15, -0.85, 0.95, 1.8, 0.85, { tint: [1, 1, 1], flat: true });
      for (const s of [-1, 1]) v.solid('paint', -2.6, 0.85, s * 0.95 - 0.06 * s - 0.03, -0.6, 1.15, s * 0.95 - 0.06 * s + 0.03);
      v.solid('paint', -2.6, 0.85, -0.95, -2.5, 1.15, 0.95);
      cab(v, { u1: 2.6, hw: 0.95, win: [1.2, 1.74], winU: [-0.45, 0.72], door: [0.5, 1.84], doorU: [-0.52, 0.86], grill: [0.55, 0.82, 0.5], lamp: 0.74, bump: [0.36, 0.6], mirror: [0.84, 1.45], mirrorSolid: true });
      v.quad('glass', 'b', -0.606, -0.75, 0.75, 1.2, 1.74); v.solid('steel', -2.74, 0.36, -0.97, -2.6, 0.56, 0.97, { tint: [0.3, 0.31, 0.3] }); tail(v, -2.6, 0.8, 0.94);
      if (olive) { for (const s of [-1, 1]) v.solid('steel', -0.74, 0.85, s * 0.85 - 0.03, -0.68, 1.95, s * 0.85 + 0.03, { tint: [0.22, 0.22, 0.22] });
        v.solid('steel', -0.74, 1.89, -0.88, -0.68, 1.95, 0.88, { tint: [0.22, 0.22, 0.22] });
        for (const a of [-0.45, -0.15, 0.15, 0.45]) { v.draw('steel', -0.73, 1.95, a - 0.07, -0.65, 2.07, a + 0.07, { tint: [0.2, 0.2, 0.2], flat: true }); v.quad('paint', 'f', -0.646, a - 0.06, a + 0.06, 1.96, 2.06, [1.5, 1.45, 1.3]); }
        for (const s of [-1, 1]) v.solid('steel', -0.5, 1.88, s * 0.78 - 0.02, 0.8, 1.94, s * 0.78 + 0.02, { tint: [0.24, 0.24, 0.24] });
        for (const u of [-0.3, 0.15, 0.6]) v.draw('steel', u - 0.02, 1.9, -0.78, u + 0.02, 1.93, 0.78, { tint: [0.24, 0.24, 0.24], flat: true }); }
      else v.solid('steel', -0.98, 0.85, -0.88, -0.62, 1.2, 0.88, { tint: [0.62, 0.62, 0.6] });
    }
    // the forklift "04 STORES YARD LIFT" (26-28)
    if (!placeModel('forklift', -39.7, 12.5, 0, 'forklift')) {      // east and south of the code one's place: between the intro camera's first pass and its last const v = vehicle(-42, 10.5, true, 1, [0.92, 0.72, 0.3]);
      for (const u of [0.45, -0.95]) for (const s of [-1, 1]) v.wheel(u, s * 0.58, 0.33, 0.24);
      v.solid('paint', -1.35, 0.22, -0.6, 0.6, 1.15, 0.6); v.solid('steel', 0.62, 0, -0.42, 0.78, 2.55, 0.42, { tint: [0.4, 0.42, 0.38] });
      for (const s of [-0.28, 0.28]) v.solid('steel', 0.78, 0.04, s - 0.06, 1.95, 0.1, s + 0.06, { tint: [0.45, 0.45, 0.42] });
      for (const [u, s] of [[0.45, -1], [0.45, 1], [-1.1, -1], [-1.1, 1]]) v.solid('steel', u - 0.04, 1.15, s * 0.52 - 0.04, u + 0.04, 2.15, s * 0.52 + 0.04, { tint: [0.3, 0.3, 0.28] });
      v.solid('steel', -1.15, 2.15, -0.56, 0.5, 2.2, 0.56, { tint: [0.3, 0.3, 0.28] });
      v.draw('paint', -1.37, 0.22, -0.61, -1.0, 1.0, 0.61, { tint: [0.24, 0.24, 0.23] }); signQuad(8, v.W3(-1.376, 0.66, 0), v.N3(-1, 0), 0.88, 0.22);       // the counterweight and its plate
      v.quad('grille', 'f', 0.786, -0.3, 0.3, 0.12, 2.5); for (const y of [0.55, 1.35, 2.25]) v.quad('steel', 'f', 0.79, -0.3, 0.3, y, y + 0.06, [0.4, 0.42, 0.38]);   // the mast's uprights and ties
      v.solid('steel', 0.78, 0.1, -0.5, 0.86, 0.9, 0.5, { tint: [0.38, 0.38, 0.36] }); cyl('galv', 'y', v.W3(0.56, 0.9, 0), 0.05, 1.4, { tint: [0.8, 0.8, 0.78], n: 8 });
      v.solid('tire', -0.72, 1.15, -0.22, -0.28, 1.3, 0.22, { tint: [0.4, 0.4, 0.4] }); v.solid('tire', -0.78, 1.3, -0.22, -0.68, 1.72, 0.22, { tint: [0.4, 0.4, 0.4] });     // the seat
      { const c = v.W3(0.12, 1.52, 0), e1 = v.N3(0, 1), e2 = vnorm(vadd(vscale(v.N3(-1, 0), 0.6), [0, 0.8, 0])), q = t => vadd(c, vadd(vscale(e1, Math.cos(t) * 0.17), vscale(e2, Math.sin(t) * 0.17)));
        for (let k = 0; k < 10; k++) beamPQ('steel', q(k / 10 * TAU), q((k + 1) / 10 * TAU), 0.025, 0.025, { tint: [0.15, 0.15, 0.15], hi: false }); beamPQ('steel', v.W3(0.36, 1.15, 0), c, 0.04, 0.04, { tint: [0.15, 0.15, 0.15], hi: false }); }
      cyl('paint', 'y', v.W3(-0.95, 2.26, 0.42), 0.07, 0.12, { tint: [1.6, 0.8, 0.15], n: 10 });
      for (const s of [-1, 1]) { v.draw('steel', 0.36, 2.0, s * 0.52 - 0.06, 0.48, 2.12, s * 0.52 + 0.06, { tint: [0.2, 0.2, 0.2], flat: true }); v.quad('paint', 'f', 0.486, s * 0.52 - 0.05, s * 0.52 + 0.05, 2.01, 2.11, [1.6, 1.55, 1.35]); } }
    placeModel('apc', 10, -6, 2, 'apc');         // the APC, in the open yard north of the middle, nose to the gate: clear of the intro camera's pass from the barracks to the hangars
    // the compressor trailer by the comm block (6, 53-56): louvres, a gauge panel, fenders; the radar trailer by its south-east corner (7, 19)
    { /* The towable air compressor by the comm block (6, 53-56), to my own measure of such a machine: a single-axle chassis of two rails, a
         canopy 2.7 m long, 1.4 m wide and 1.1 m tall with its top edges rounded (a section worked out here, lofted along the length), two
         doors a side, a bank of louvres in the front ones, a cooling grille on the nose, the gauges on the tail, angular mudguards, an
         A-frame draw bar with a towing eye and a jockey wheel, a lifting bail and an exhaust stack with its rain flap. */
      const O = [17.9, -4.5], W = (x, y, z) => [O[0] + x, y, O[1] + z], CAN = hexLin('8ea3a6'), CAN2 = hexLin('7d9296'), DK = hexLin('3f4a4b'), FR = hexLin('5d6462'), BR = hexLin('9aa19a');
      const X0 = -1.3, X1 = 1.4, HW = 0.7, Y0 = 0.62, Y1 = 1.72, RC = 0.16, AX = 0.15, WR = 0.36, IN = W(0.05, 1.15, 0);
      for (const t of [-1, 1]) {
        draw('steel', O[0] + X0 - 0.08, 0.46, O[1] + t * 0.48 - 0.045, O[0] + X1, Y0, O[1] + t * 0.48 + 0.045, { tint: FR });                                  // a chassis rail
        cyl('tire', 'z', W(AX, WR, t * 0.83), WR, 0.2, { tint: [0.5, 0.5, 0.5], n: 20 }); cyl('paint', 'z', W(AX, WR, t * 0.935), 0.2, 0.016, { tint: BR, n: 16 }); cyl('steel', 'z', W(AX, WR, t * 0.945), 0.06, 0.02, { tint: [0.24, 0.24, 0.23], n: 8 });
        for (let k = 0; k < 6; k++) { const a2 = k / 6 * TAU + 0.3; cyl('steel', 'z', W(AX + Math.cos(a2) * 0.115, WR + Math.sin(a2) * 0.115, t * 0.946), 0.015, 0.014, { tint: [0.3, 0.3, 0.29], n: 6 }); }
        { const G2 = [[AX - 0.52, 0.5], [AX - 0.36, 0.8], [AX + 0.36, 0.8], [AX + 0.52, 0.5]];                                                                     // the mudguard: three flat planes and a lip down the outside
          loft('paint', G2.map(([gx, gy]) => [W(gx, gy, t * HW), W(gx, gy, t * 0.96), W(gx, gy - 0.07, t * 0.96)]), W(AX, 0.3, t * 0.84), { tint: CAN2 }); }
        tube('steel', W(X0 - 0.06, 0.52, t * 0.46), W(-2.42, 0.5, t * 0.05), 0.04, { tint: FR, n: 8 });                                                             // the draw bar's two arms
        ph.addBox(W(AX - 0.4, 0, t * 0.83 - 0.13), W(AX + 0.4, 0.84, t * 0.83 + 0.13), { surface: 'wood' });
      }
      draw('steel', O[0] - 2.62, 0.45, O[1] - 0.07, O[0] - 2.38, 0.55, O[1] + 0.07, { tint: FR }); cyl('steel', 'y', W(-2.7, 0.5, 0), 0.07, 0.035, { tint: BR, n: 12 });      // the head and its towing eye
      draw('steel', O[0] - 1.9, 0.46, O[1] - 0.3, O[0] - 1.84, 0.54, O[1] + 0.3, { tint: FR });                                                                 // the cross brace
      tube('steel', W(-2.05, 0.2, 0.2), W(-2.05, 0.72, 0.2), 0.03, { tint: BR, n: 8 }); cyl('tire', 'z', W(-2.05, 0.1, 0.2), 0.1, 0.06, { tint: [0.45, 0.45, 0.45], n: 12 }); tube('steel', W(-2.05, 0.72, 0.2), W(-2.05, 0.72, 0.34), 0.012, { tint: BR, n: 6 });   // the jockey wheel and its crank
      { const half = [[HW, Y0], [HW, Y1 - RC], ...[1, 2, 3, 4].map(k => [HW - RC + RC * Math.cos(k * Math.PI / 10), Y1 - RC + RC * Math.sin(k * Math.PI / 10)]), [HW - RC, Y1]];      // one side of the section: wall, quarter-round, top
        const prof = [...half.map(([z2, y2]) => [-z2, y2]), ...half.slice().reverse()];
        const ring = (x, k, dy) => prof.map(([z2, y2]) => W(x, Y0 + (y2 - Y0) * k + dy, z2 * k)), rings = [ring(X0 - 0.05, 0.94, 0.03), ring(X0, 1, 0), ring(-0.35, 1, 0), ring(0.55, 1, 0), ring(X1, 1, 0), ring(X1 + 0.05, 0.94, 0.03)];
        loft('paint', rings, IN, { tint: (i) => (i === 0 || i === 5 ? CAN2 : CAN) });
        bld.face('paint', rings[0], [-1, 0, 0], rings[0].map(q => [q[2], q[1]]), CAN2, 'cr'); bld.face('paint', rings[5], [1, 0, 0], rings[5].map(q => [q[2], q[1]]), CAN2, 'cr');
        bld.face('steel', [W(X0, Y0, -HW), W(X1, Y0, -HW), W(X1, Y0, HW), W(X0, Y0, HW)], [0, -1, 0], [[0, 0], [2.7, 0], [2.7, 1.4], [0, 1.4]], [0.1, 0.1, 0.1], 'cr'); }
      for (const t of [-1, 1]) { const n = [0, 0, t], F = (x, y, dz) => W(x, y, t * (HW + dz)), rect = (x0, y0, x1, y1, dz, col) => { const P = [F(x0, y0, dz), F(x1, y0, dz), F(x1, y1, dz), F(x0, y1, dz)]; bld.face('paint', P, n, P.map(q => [q[0], q[1]]), col, 'r'); };
        for (const x of [-0.35, 0.55]) rect(x - 0.009, Y0 + 0.05, x + 0.009, Y1 - RC, 0.004, DK);                                  // the seams between the doors
        rect(X0 + 0.14, 0.92, -0.5, 1.46, 0.004, DK);                                                                              // the louvre bank: nine slats, tilted down
        for (let k = 0; k < 9; k++) { const y = 1.43 - k * 0.058, P = [F(X0 + 0.16, y, 0.006), F(-0.52, y, 0.006), F(-0.52, y - 0.046, 0.034), F(X0 + 0.16, y - 0.046, 0.034)]; bld.face('paint', P, [0, 0.59, t * 0.81], P.map(q => [q[0], q[1]]), hexLin('a3b5b7'), 'r'); }
        for (const x of [-0.18, 0.72]) { rect(x, 1.12, x + 0.2, 1.2, 0.005, DK); tube('steel', F(x + 0.03, 1.16, 0.03), F(x + 0.17, 1.16, 0.03), 0.012, { tint: BR, n: 6 }); }     // a recessed handle on each of the other doors
        rect(0.62, 0.72, 1.3, 0.8, 0.005, hexLin('c9b23a')); }                                                                     // a yellow warning strip low on the tail door
      { const E = (z2, y, dx) => W(X0 - 0.052 - dx, y, z2), n = [-1, 0, 0];                                                        // the nose: the cooling grille
        const P = [E(-0.5, 0.84, 0.002), E(0.5, 0.84, 0.002), E(0.5, 1.5, 0.002), E(-0.5, 1.5, 0.002)]; bld.face('paint', P, n, P.map(q => [q[2], q[1]]), DK, 'r');
        for (let k = 0; k < 8; k++) { const y = 0.88 + k * 0.08; draw('steel', O[0] + X0 - 0.075, y, O[1] - 0.48, O[0] + X0 - 0.052, y + 0.025, O[1] + 0.48, { tint: BR, flat: true, shadow: 'r' }); } }
      { const E = (z2, y, dx) => W(X1 + 0.052 + dx, y, z2), n = [1, 0, 0], P = [E(-0.46, 1.08, 0.002), E(0.36, 1.08, 0.002), E(0.36, 1.5, 0.002), E(-0.46, 1.5, 0.002)];       // the tail: three gauges in a row, a stop button, a key switch
        bld.face('paint', P, n, P.map(q => [q[2], q[1]]), hexLin('4c5756'), 'r');
        for (const z2 of [-0.3, -0.08, 0.14]) { cyl('steel', 'x', W(X1 + 0.07, 1.36, z2), 0.075, 0.03, { tint: BR, n: 16 }); cyl('paint', 'x', W(X1 + 0.087, 1.36, z2), 0.06, 0.006, { tint: hexLin('d8d4bd'), n: 16 }); tube('steel', W(X1 + 0.092, 1.34, z2 - 0.02), W(X1 + 0.092, 1.39, z2 + 0.03), 0.005, { tint: [0.1, 0.1, 0.1], n: 4, caps: false }); }
        cyl('paint', 'x', W(X1 + 0.08, 1.18, 0.2), 0.04, 0.05, { tint: hexLin('b3281e'), n: 12 }); cyl('steel', 'x', W(X1 + 0.07, 1.18, -0.2), 0.022, 0.03, { tint: BR, n: 8 }); }
      for (const dx of [-0.16, 0.16]) tube('steel', W(0.05 + dx, Y1 - 0.01, 0), W(0.05 + dx, Y1 + 0.14, 0), 0.016, { tint: FR, n: 6 }); tube('steel', W(-0.11, Y1 + 0.14, 0), W(0.21, Y1 + 0.14, 0), 0.016, { tint: FR, n: 6 });      // the lifting bail
      cyl('steel', 'y', W(0.95, Y1 + 0.01, -0.3), 0.075, 0.02, { tint: FR, n: 12 }); tube('steel', W(0.95, Y1, -0.3), W(0.95, Y1 + 0.3, -0.3), 0.045, { tint: hexLin('6a6258'), n: 10 });                                        // the exhaust stack, its flap half open
      obox('steel', W(0.985, Y1 + 0.325, -0.3), [0.055, 0.03, 0], [-0.003, 0.005, 0], [0, 0, 0.055], { tint: hexLin('6a6258'), hi: false });
      cyl('paint', 'y', W(-0.8, Y1 + 0.015, 0.25), 0.06, 0.03, { tint: hexLin('2c2f2f'), n: 10 });                                                                                                                                  // the fuel cap
      ph.addBox(W(X0 - 0.06, 0.44, -HW - 0.01), W(X1 + 0.06, Y1 + 0.02, HW + 0.01), { surface: 'metal' }); ph.addBox(W(-2.75, 0.3, -0.5), W(X0 - 0.06, 0.62, 0.5), { surface: 'metal' }); ph.addBox(W(-2.15, 0, 0.1), W(-1.95, 0.3, 0.3), { surface: 'metal', bulletOnly: true });
    }
    placeModel('renault', -42, -6, 3, 'truck:radar');        // the radar truck: on the open ground west of the big truck, its nose to the gate
    { /* The search radar by the comm block's south-east corner (7, 19, 109, 110): a low single-axle trailer on four screw legs, its draw bar toward
         the block; a plate deck with round corners over a dark frame, a stepped base plate, a flanged pedestal, and on a turntable (level():
         spinners) a tall narrow aerial leaning back: a thick frame round a face of dark and grey cells, ribs and the set box behind it, lugs
         down its sides, studs along its top. Behind the pedestal the cream equipment box with its louvred end. Everything is round or
         bevelled where the thing itself would be, and painted with the worn army olive ('mil'), not flat colour. */
      const O = [37.6, 5.8], W = (x, y, z) => [O[0] + x, y, O[1] + z], OL = [0.8, 0.75, 0.72], OD = [0.6, 0.58, 0.55], CR = hexLin('cfc8b0'), ST = hexLin('2c2f29'), ST2 = hexLin('454a41'), PX = -0.35;
      const lathe = (mat, axis, c, prof, o = {}) => { const n = o.n || 20, at = (a2, rr, t) => { const u = Math.cos(t) * rr, v = Math.sin(t) * rr; return axis === 'y' ? [c[0] + u, c[1] + a2, c[2] + v] : axis === 'z' ? [c[0] + u, c[1] + v, c[2] + a2] : [c[0] + a2, c[1] + u, c[2] + v]; };
        const mid = prof.reduce((q, pf) => q + pf[0], 0) / prof.length; loft(mat, prof.map(([a2, rr]) => [...Array(n + 1)].map((_, k) => at(a2, rr, (k % n) / n * TAU))), at(mid, 0, 0), o); };
      const rr = (hx, hz, rc, y, cx = 0) => { const P = []; for (const [sx, sz, a0] of [[1, 1, 0], [-1, 1, 1], [-1, -1, 2], [1, -1, 3]]) for (let k = 0; k <= 3; k++) { const a2 = (a0 + k / 3) * Math.PI / 2; P.push(W(cx + sx * (hx - rc) + Math.cos(a2) * rc, y, sz * (hz - rc) + Math.sin(a2) * rc)); } P.push(P[0]); return P; };
      // the deck: a plate with round corners and a bevelled top edge, a dark frame under it
      { const R3 = rr(1.47, 0.92, 0.06, 0.84); loft('mil', [rr(1.5, 0.95, 0.08, 0.7), rr(1.5, 0.95, 0.08, 0.815), R3], W(0, 0.6, 0), { tint: OL });
        bld.face('mil', R3.slice(0, -1), [0, 1, 0], R3.slice(0, -1).map(q => [q[0], q[2]]), OL, 'cr');
        draw('steel', O[0] - 1.44, 0.56, O[1] - 0.89, O[0] + 1.44, 0.7, O[1] + 0.89, { tint: ST, faces: 'wensb' });
        for (const [x, z] of [[-1.15, -0.62], [-1.15, 0.62], [-0.2, -0.75], [0.35, 0.75], [1.2, -0.7], [1.2, 0.7], [-0.75, 0.05], [0.2, -0.2], [-1.3, 0.2], [0.9, 0.1]]) cyl('paint', 'y', W(x, 0.843, z), 0.045, 0.006, { tint: hexLin('a6ad8c'), n: 10 });     // lashing points, worn bright
        for (const sg of [-1, 1]) { draw('steel', O[0] - 1.503, 0.72, O[1] + sg * 0.55 - 0.17, O[0] - 1.5, 0.8, O[1] + sg * 0.55 + 0.17, { tint: ST, flat: true, faces: 'w' }); draw('paint', O[0] - 1.508, 0.74, O[1] + sg * 0.55 - 0.11, O[0] - 1.5, 0.78, O[1] + sg * 0.55 + 0.11, { tint: hexLin('b9b49a'), flat: true, faces: 'wt' });
          draw('steel', O[0] - 1.2, 0.72, O[1] + sg * 0.953 - 0.002, O[0] - 0.85, 0.8, O[1] + sg * 0.953 + 0.002, { tint: ST, flat: true, faces: sg > 0 ? 's' : 'n' }); draw('paint', O[0] - 1.13, 0.74, O[1] + sg * 0.956 - 0.003, O[0] - 0.92, 0.78, O[1] + sg * 0.956 + 0.003, { tint: hexLin('b34a2c'), flat: true, faces: sg > 0 ? 'st' : 'nt' }); } }
      // wheels: a tyre with round shoulders, a dished hub with five lug holes
      for (const sg of [-1, 1]) { const c = W(0.25, 0.36, sg * 1.04), m = pf => pf.map(([a2, r2]) => [a2 * sg, r2]);
        lathe('tire', 'z', c, m([[-0.1, 0.22], [-0.106, 0.3], [-0.085, 0.345], [-0.045, 0.362], [0.045, 0.362], [0.085, 0.345], [0.106, 0.3], [0.1, 0.22]]), { tint: [0.42, 0.42, 0.42], n: 24 });
        lathe('mil', 'z', c, m([[0.085, 0.225], [0.07, 0.2], [0.07, 0.1], [0.1, 0.085], [0.105, 0.0]]), { tint: [1.05, 1.02, 0.98], n: 20 });
        for (let k = 0; k < 5; k++) { const a2 = k / 5 * TAU + 0.3; cyl('steel', 'z', [c[0] + Math.cos(a2) * 0.15, c[1] + Math.sin(a2) * 0.15, c[2] + sg * 0.072], 0.028, 0.008, { tint: [0.08, 0.08, 0.08], n: 8 }); }
        cyl('steel', 'z', [c[0], c[1], c[2] + sg * 0.108], 0.04, 0.012, { tint: ST, n: 10 });
        draw('steel', O[0] + 0.19, 0.3, O[1] + sg * 0.6, O[0] + 0.31, 0.42, O[1] + sg * 0.95, { tint: ST });                                      // the axle stub
        ph.addBox(W(0.25 - 0.37, 0, sg * 1.04 - 0.11), W(0.25 + 0.37, 0.74, sg * 1.04 + 0.11), { surface: 'wood' }); }
      // four screw legs on outriggers: an outer tube, the screw below it, a foot, the crank on top
      for (const sg of [-1, 1]) for (const lx of [-1.34, 1.34]) { const z = sg * 1.14;
        draw('steel', O[0] + lx - 0.035, 0.72, O[1] + Math.min(sg * 0.9, z), O[0] + lx + 0.035, 0.79, O[1] + Math.max(sg * 0.9, z), { tint: ST2 });
        draw('steel', O[0] + lx - 0.045, 0.3, O[1] + z - 0.045, O[0] + lx + 0.045, 0.9, O[1] + z + 0.045, { tint: ST2 }); cyl('galv', 'y', W(lx, 0.19, z), 0.022, 0.24, { tint: [0.7, 0.7, 0.68], n: 8 });
        draw('steel', O[0] + lx - 0.15, 0, O[1] + z - 0.15, O[0] + lx + 0.15, 0.045, O[1] + z + 0.15, { tint: ST }); draw('steel', O[0] + lx - 0.07, 0.045, O[1] + z - 0.07, O[0] + lx + 0.07, 0.085, O[1] + z + 0.07, { tint: ST });
        draw('steel', O[0] + lx - 0.1, 0.9, O[1] + z - 0.025, O[0] + lx + 0.1, 0.925, O[1] + z + 0.025, { tint: ST }); cyl('steel', 'y', W(lx + 0.085, 0.95, z), 0.014, 0.05, { tint: ST, n: 6 });
        tube('steel', W(lx - Math.sign(lx) * 0.32, 0.64, sg * 0.9), W(lx, 0.36, z), 0.016, { tint: ST2, n: 5 });
        ph.addBox(W(lx - 0.07, 0, z - 0.07), W(lx + 0.07, 0.92, z + 0.07), { surface: 'metal' }); }
      // the draw bar: two arms to a coupling head, its chain, a stand
      for (const sg of [-1, 1]) tube('steel', W(-1.46, 0.63, sg * 0.62), W(-2.5, 0.52, sg * 0.05), 0.042, { tint: ST2, n: 8 });
      draw('steel', O[0] - 2.72, 0.46, O[1] - 0.075, O[0] - 2.45, 0.58, O[1] + 0.075, { tint: ST2 }); cyl('steel', 'y', W(-2.79, 0.52, 0), 0.075, 0.04, { tint: ST, n: 12 }); cyl('paint', 'y', W(-2.79, 0.545, 0), 0.035, 0.012, { tint: [0.05, 0.05, 0.05], n: 8 });
      { let q0 = W(-2.5, 0.48, 0.09); for (let k = 1; k <= 5; k++) { const t = k / 5, q1 = W(-2.5 - 0.22 * t, 0.48 - 0.22 * Math.sin(t * Math.PI) - 0.1 * t, 0.09 + 0.05 * t); tube('steel', q0, q1, 0.012, { tint: [0.3, 0.3, 0.29], n: 4, caps: false }); q0 = q1; } }
      tube('steel', W(-2.25, 0.5, 0.14), W(-2.25, 0.05, 0.14), 0.028, { tint: ST2, n: 6 }); draw('steel', O[0] - 2.35, 0, O[1] + 0.04, O[0] - 2.15, 0.04, O[1] + 0.24, { tint: ST });
      // the equipment box: a lid with an overhang, latches, a handle each side, the louvred end in its frame, the cable to the pedestal
      draw('paint', O[0] + 0.48, 0.84, O[1] - 0.54, O[0] + 1.36, 1.46, O[1] + 0.54, { tint: CR }); draw('paint', O[0] + 0.46, 1.46, O[1] - 0.56, O[0] + 1.38, 1.51, O[1] + 0.56, { tint: hexLin('d9d2bb') });
      draw('steel', O[0] + 0.5, 0.84, O[1] - 0.545, O[0] + 1.34, 0.9, O[1] + 0.545, { tint: ST2, faces: 'ns' });
      for (const sg of [-1, 1]) { for (const x of [0.7, 1.14]) draw('steel', O[0] + x - 0.03, 1.39, O[1] + sg * 0.54 + (sg > 0 ? 0 : -0.02), O[0] + x + 0.03, 1.47, O[1] + sg * 0.54 + (sg > 0 ? 0.02 : 0), { tint: ST2, flat: true });
        tube('steel', W(0.78, 1.16, sg * 0.57), W(1.06, 1.16, sg * 0.57), 0.012, { tint: ST2, n: 6 }); for (const x of [0.78, 1.06]) tube('steel', W(x, 1.16, sg * 0.54), W(x, 1.16, sg * 0.57), 0.012, { tint: ST2, n: 5, caps: false }); }
      { const X = O[0] + 1.36; draw('paint', X, 0.9, O[1] - 0.48, X + 0.02, 1.42, O[1] + 0.48, { tint: hexLin('ddd7c3'), faces: 'etbns' }); draw('steel', X + 0.02, 0.95, O[1] - 0.43, X + 0.022, 1.37, O[1] + 0.43, { tint: [0.1, 0.1, 0.1], flat: true, faces: 'e' });
        for (let k = 0; k < 7; k++) { const y = 0.98 + k * 0.056, Q = [W(1.383, y, -0.42), W(1.383, y, 0.42), W(1.412, y + 0.04, 0.42), W(1.412, y + 0.04, -0.42)]; bld.face('paint', Q, [0.82, 0.57, 0], Q.map(q => [q[2], q[1]]), hexLin('d8d2bd'), 'r'); } }
      { let q0 = W(0.48, 0.98, 0.3); for (const q1 of [W(0.36, 0.875, 0.34), W(0.1, 0.865, 0.3), W(-0.1, 0.93, 0.2)]) { tube('tire', q0, q1, 0.018, { tint: [0.2, 0.2, 0.2], n: 6, caps: false }); q0 = q1; } }
      // the base plate in two steps, its bolts, the pedestal with its flange and collar
      draw('steel', O[0] + PX - 0.5, 0.84, O[1] - 0.5, O[0] + PX + 0.5, 0.875, O[1] + 0.5, { tint: ST }); draw('steel', O[0] + PX - 0.4, 0.875, O[1] - 0.4, O[0] + PX + 0.4, 0.905, O[1] + 0.4, { tint: ST2 });
      for (const [bx, bz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) cyl('galv', 'y', W(PX + bx * 0.44, 0.885, bz * 0.44), 0.022, 0.02, { tint: [0.6, 0.6, 0.58], n: 6 });
      lathe('steel', 'y', W(PX, 0, 0), [[0.905, 0.3], [0.94, 0.3], [0.96, 0.25]], { tint: ST, n: 22 });
      lathe('mil', 'y', W(PX, 0, 0), [[0.955, 0.235], [0.99, 0.205], [1.25, 0.19], [1.5, 0.185], [1.54, 0.2]], { tint: OL, n: 22 });
      lathe('steel', 'y', W(PX, 0, 0), [[1.535, 0.21], [1.55, 0.265], [1.62, 0.265], [1.635, 0.24]], { tint: ST, n: 22 }); cyl('steel', 'y', W(PX, 1.63, 0), 0.24, 0.012, { tint: ST, n: 22 });
      for (let k = 0; k < 4; k++) { const a2 = k * Math.PI / 2 + Math.PI / 4, dx = Math.cos(a2), dz = Math.sin(a2), P = [W(PX + dx * 0.2, 0.905, dz * 0.2), W(PX + dx * 0.4, 0.905, dz * 0.4), W(PX + dx * 0.2, 1.2, dz * 0.2)]; for (const sgn of [1, -1]) bld.face('mil', P, [-dz * sgn, 0, dx * sgn], P.map(q => [q[0] + q[2], q[1]]), OD, 'r'); }     // gussets
      ph.addBox(W(-1.5, 0.5, -0.95), W(1.5, 0.86, 0.95), { surface: 'metal' }); ph.addBox(W(0.46, 0.86, -0.56), W(1.38, 1.51, 0.56), { surface: 'metal' });
      ph.addBox(W(PX - 0.85, 0.86, -0.85), W(PX + 0.85, 3.9, 0.85), { surface: 'metal' }); ph.addBox(W(-2.85, 0.3, -0.62), W(-1.5, 0.66, 0.62), { surface: 'metal' });       // the head's whole sweep: nothing walks or shoots through where the aerial passes
      // the head, in its own space (the pivot is the origin)
      const main = bld; bld = makeBuilder();
      { const tb = 0.26, cs = Math.cos(tb), sn = Math.sin(tb), up = [-sn, cs, 0], out = [cs, sn, 0], sd = [0, 0, 1], HW = 0.6, HH = 0.95, c0 = vadd([0.16, 0.22, 0], up, HH), rg = rng(909);
        const at = (d, u, v) => vadd(vadd(vadd(c0, out, d), sd, u), up, v);
        const ring = (d, hw, hh, rc) => { const P = []; for (const [su, sv, a0] of [[1, 1, 0], [-1, 1, 1], [-1, -1, 2], [1, -1, 3]]) for (let k = 0; k <= 3; k++) { const a2 = (a0 + k / 3) * Math.PI / 2; P.push(at(d, su * (hw - rc) + Math.cos(a2) * rc, sv * (hh - rc) + Math.sin(a2) * rc)); } P.push(P[0]); return P; };
        cyl('steel', 'y', [0, 0.03, 0], 0.235, 0.06, { tint: ST, n: 22 }); cyl('mil', 'y', [0, 0.075, 0], 0.19, 0.03, { tint: OL, n: 20 });                 // the turntable
        obox('mil', [0.02, 0.1, 0], [0.11, 0, 0], [0, 0.03, 0], [0, 0, 0.27], { tint: OD, hi: false });                                                           // the yoke: a foot and two cheeks
        for (const e of [-1, 1]) { obox('mil', [0.03, 0.34, e * 0.25], [0.07, 0, 0], [0, 0.24, 0], [0, 0, 0.022], { tint: OL, hi: false }); cyl('steel', 'z', [0.05, 0.52, e * 0.275], 0.05, 0.03, { tint: ST, n: 10 }); }
        // the aerial: a thick frame, bevelled front and back
        { const rings = [ring(-0.055, HW - 0.03, HH - 0.03, 0.04), ring(-0.035, HW, HH, 0.05), ring(0.035, HW, HH, 0.05), ring(0.055, HW - 0.03, HH - 0.03, 0.04)];
          loft('mil', rings, c0, { tint: OL, shadow: 'cr' }); bld.face('mil', rings[0].slice(0, -1), vscale(out, -1), rings[0].slice(0, -1).map(q => [q[2], q[1]]), OD, 'cr'); bld.face('mil', rings[3].slice(0, -1), out, rings[3].slice(0, -1).map(q => [q[2], q[1]]), OL, 'cr'); }
        { const IW = HW - 0.08, IH = HH - 0.08, NC = 6, NR = 10, cw = IW * 2 / NC, ch = IH * 2 / NR, Q0 = [at(0.056, -IW, -IH), at(0.056, IW, -IH), at(0.056, IW, IH), at(0.056, -IW, IH)];
          bld.face('paint', Q0, out, Q0.map(q => [q[2], q[1]]), hexLin('14170f'), 'r');                                                                         // the recess the cells sit in
          for (let i = 0; i < NC; i++) for (let j = 0; j < NR; j++) { const u = -IW + (i + 0.5) * cw, v = -IH + (j + 0.5) * ch, lt = (i + j) % 2 === 0 ? rg() < 0.8 : rg() < 0.15, col = lt ? hexLin(rg() < 0.5 ? '6c7164' : '5c6156') : hexLin(rg() < 0.5 ? '23261d' : '2c3025');
            const Q = [at(0.06, u - cw * 0.44, v - ch * 0.44), at(0.06, u + cw * 0.44, v - ch * 0.44), at(0.06, u + cw * 0.44, v + ch * 0.44), at(0.06, u - cw * 0.44, v + ch * 0.44)]; bld.face('paint', Q, out, Q.map(q => [q[2], q[1]]), col, 'r'); } }
        for (let k = -2; k <= 2; k++) obox('mil', at(0, k * 0.24, HH + 0.045), vscale(out, 0.014), vscale(up, 0.05), vscale(sd, 0.014), { tint: OD, hi: false, shadow: 'r' });               // studs along the top
        for (const e of [-1, 1]) for (const v of [-0.6, -0.05, 0.5]) obox('mil', at(0, e * (HW + 0.025), v), vscale(out, 0.03), vscale(up, 0.07), vscale(sd, 0.03), { tint: OD, hi: false, shadow: 'r' });   // lugs down the sides
        for (const u of [-0.36, 0, 0.36]) obox('mil', at(-0.085, u, 0), vscale(out, 0.03), vscale(up, HH - 0.07), vscale(sd, 0.028), { tint: OD, hi: false });                              // ribs up the back, two across
        for (const v of [-0.5, 0.45]) obox('mil', at(-0.085, 0, v), vscale(out, 0.03), vscale(up, 0.03), vscale(sd, HW - 0.05), { tint: OD, hi: false });
        obox('paint', at(-0.25, 0, -0.18), vscale(out, 0.13), vscale(up, 0.27), vscale(sd, 0.21), { tint: hexLin('3d4238'), hi: false });                                                     // the set box on the back, its lid and fins
        obox('paint', at(-0.385, 0, -0.18), vscale(out, 0.008), vscale(up, 0.23), vscale(sd, 0.17), { tint: hexLin('4b5146'), hi: false, shadow: 'r' });
        for (let k = -3; k <= 3; k++) obox('steel', at(-0.25, k * 0.055, 0.105), vscale(out, 0.11), vscale(up, 0.012), vscale(sd, 0.008), { tint: ST, hi: false, shadow: 'r' });
        for (const e of [-1, 1]) tube('mil', [0.05, 0.52, e * 0.25], at(-0.1, e * 0.3, -0.42), 0.028, { tint: OD, n: 6 });                                                                   // the arms that carry it
        { let q0 = at(-0.3, 0.16, -0.46); for (const q1 of [at(-0.36, 0.2, -0.75), [-0.12, 0.2, 0.16], [-0.06, 0.09, 0.12]]) { tube('tire', q0, q1, 0.014, { tint: [0.2, 0.2, 0.2], n: 5, caps: false }); q0 = q1; } } }
      spinners.push({ bld, pivot: W(PX, 1.636, 0), speed: 0.9 }); bld = main;
    }
    /* ================================================================== the yard */
    const CRATES = ['crate1', 'crate2', 'crate3', 'crate5'];
    const TABLE_Q = 0, BENCH_Q = 1, HEATER_Q = 0;        // which way the picnic table model's benches run
    const crate = (x, z, w, d, h, y = 0, tint = [0.82, 0.64, 0.4]) => (prop(CRATES, x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, Math.floor(Math.abs(x * 7 + z * 13)) % 4)
      ? cbox(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2) : solid('wood', x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, { tint }));
    // a pallet, 1.2 x 1.0, with the dark gaps between its blocks on every side
    const pallet = (x, z, y, tint = [0.86, 0.76, 0.58]) => { if (prop('pallet', x - 0.6, y, z - 0.5, x + 0.6, y + 0.14, z + 0.5)) { cbox(x - 0.6, y, z - 0.5, x + 0.6, y + 0.14, z + 0.5); return; }
      solid('wood', x - 0.6, y, z - 0.5, x + 0.6, y + 0.14, z + 0.5, { tint });
      const g = vscale(tint, 0.22), q = (P, n) => bld.face('wood', P, n, P.map(p => [p[0] + p[2], p[1]]), g, 'r');
      for (const s of [-1, 1]) for (const c of [-0.3, 0.3]) {
        q([[x + c - 0.13, y + 0.025, z + s * 0.503], [x + c + 0.13, y + 0.025, z + s * 0.503], [x + c + 0.13, y + 0.115, z + s * 0.503], [x + c - 0.13, y + 0.115, z + s * 0.503]], [0, 0, s]);
        q([[x + s * 0.603, y + 0.025, z + c * 0.83 - 0.1], [x + s * 0.603, y + 0.025, z + c * 0.83 + 0.1], [x + s * 0.603, y + 0.115, z + c * 0.83 + 0.1], [x + s * 0.603, y + 0.115, z + c * 0.83 - 0.1]], [s, 0, 0]); } };
    // a flat rectangle standing on a wall between ground points A and B, facing n; louvres are a dark grille with blades over it
    const vrect = (mat, A, B, y0, y1, n, col = [1, 1, 1], d = 0.004) => { const P = [[A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]]].map(p => vadd(p, n, d)); bld.face(mat, P, n, P.map(p => [p[0] + p[2], p[1]]), col, 'cr'); };
    const louvre = (A, B, y0, y1, n, col = [0.5, 0.5, 0.42]) => { vrect('grille', A, B, y0, y1, n); const L = Math.hypot(B[0] - A[0], B[1] - A[1]), e = [(B[0] - A[0]) / L * 0.02, (B[1] - A[1]) / L * 0.02];
      for (let y = y0 + 0.04; y < y1 - 0.02; y += 0.065) vrect('paint', [A[0] + e[0], A[1] + e[1]], [B[0] - e[0], B[1] - e[1]], y, y + 0.022, n, col, 0.007); };
    // a cable reel: two flanges, the cable wound between them, the axle
    const reel = (x, z, y, r, len) => {
      const fz = len / 2, W = [0.66, 0.5, 0.34], face = (zf, sg, pts, col) => bld.face('wood', pts.map(([a, b]) => [x + a, y + r + b, zf]), [0, 0, sg], pts.map(q => [q[0], q[1]]), col, 'r');
      const ring = (rr, n = 20) => [...Array(n)].map((_, k) => [Math.cos(k / n * TAU) * rr, Math.sin(k / n * TAU) * rr]);
      for (const sg of [-1, 1]) { const zc = z + sg * (fz - 0.035), zf = z + sg * (fz + 0.002);
        cyl('wood', 'z', [x, y + r, zc], r, 0.07, { tint: W, n: 24 });
        cyl('steel', 'z', [x, y + r, zc], r + 0.006, 0.022, { tint: [0.3, 0.29, 0.27], n: 24, caps: false });                   // the steel band round the rim
        for (let k = -3; k <= 3; k++) { const a = k * r / 3.6, hh = Math.sqrt(Math.max(0, r * r * 0.94 - a * a)); face(zf, sg, [[a - 0.006, -hh], [a + 0.006, -hh], [a + 0.006, hh], [a - 0.006, hh]], vscale(W, 0.3)); }   // the seams between its planks
        face(zf + sg * 0.002, sg, ring(r * 0.24), [0.3, 0.3, 0.28]); face(zf + sg * 0.004, sg, ring(r * 0.09, 12), [0.03, 0.03, 0.03]);       // the hub plate and its hole
        for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + 0.6; face(zf + sg * 0.004, sg, ring(r * 0.035, 8).map(([e, q]) => [e + Math.cos(a) * r * 0.5, q + Math.sin(a) * r * 0.5]), [0.2, 0.2, 0.19]); } }
      cyl('wood', 'z', [x, y + r, z], r * 0.4, len - 0.14, { tint: vscale(W, 0.8), n: 14, caps: false });
      const nC = Math.max(6, Math.round((len - 0.16) / 0.07)), cw = (len - 0.16) / nC;
      for (let k = 0; k < nC; k++) cyl('tire', 'z', [x, y + r, z - (len - 0.16) / 2 + (k + 0.5) * cw], r * (k % 2 ? 0.7 : 0.672), cw, { tint: [0.16, 0.16, 0.17], n: 16, caps: false, shadow: 'r' });   // the cable, turn beside turn
    };
    // the generator pad north of the workshop (6, 20, 57): "AUX 02", the POWER cabinet, a crate, the big olive set, four ammo boxes
    draw('slab', 17.5, 0.01, 7.6, 21.5, 0.08, 10.6, { tint: [1, 1, 1], faces: 'wenst' });
    const gsA = prop('genset', 18, 0.08, 8.3, 20.6, 1.45, 9.7, 1), gsB = prop('genset', 33.5, 0.1, -17.6, 34.8, 1.3, -15.8, 0), ammoM = placeModel('ammo', 30.2, 9.55, 0, 'ammo boxes');   // the generator model for the two small sets, the ammo-box model for the four boxes
    if (gsA) cbox(18, 0.08, 8.3, 20.6, 1.45, 9.7, 'metal'); else solid('paint', 18, 0.08, 8.3, 20.6, 1.45, 9.7, { tint: [0.62, 0.62, 0.48] });
    solid('paint', 20.9, 0.08, 8.1, 21.4, 1.8, 8.6, { tint: [0.86, 0.84, 0.78] });
    crate(22.6, 9.2, 1.2, 1.2, 1.3); solid('paint', 24.2, 0, 8.2, 27.4, 1.6, 9.8, { tint: OLIVE2 });
    if (!ammoM) for (let k = 0; k < 4; k++) solid('paint', 28.4 + k * 1.0, 0, 9.2, 29.1 + k * 1.0, 0.6, 9.9, { tint: [0.36, 0.38, 0.3] });
    solid('hazard', 21.75, 0, 9.85, 21.95, 1.0, 10.05, { tint: [1, 1, 1] });
    { // Stage 4: louvres, exhausts and panels on the sets, the plates "AUX 02" and "POWER", lids and stencils on the ammo boxes (6, 20, 57)
      if (!gsA) for (const [z, n] of [[9.7, [0, 0, 1]], [8.3, [0, 0, -1]]]) { louvre([18.2, z], [19.3, z], 0.35, 1.2, n, [0.5, 0.5, 0.4]); vrect('steel', [19.45, z], [19.47, z], 0.2, 1.35, n, [0.3, 0.3, 0.28]); }
      signQuad(7, [19.98, 1.12, 9.708], [0, 0, 1], 0.9, 0.225);
      if (!gsA) vrect('steel', [20.6, 8.45], [20.6, 9.55], 0.6, 1.25, [1, 0, 0], [0.2, 0.2, 0.2]); if (!gsA) for (const z of [8.75, 9.15]) bld.face('paint', [...Array(12)].map((_, k) => [20.608, 1.0 + Math.sin(k / 12 * TAU) * 0.07, z + Math.cos(k / 12 * TAU) * 0.07]), [1, 0, 0], [...Array(12)].map((_, k) => [Math.cos(k / 12 * TAU), Math.sin(k / 12 * TAU)]), [1.1, 1.1, 1.05], 'cr');
      cyl('steel', 'y', [18.5, 1.75, 9.0], 0.06, 0.6, { tint: [0.3, 0.3, 0.3], n: 10 }); ph.addBox([18.44, 1.45, 8.94], [18.56, 2.05, 9.06], { surface: 'metal' });
      signQuad(6, [21.15, 1.58, 8.606], [0, 0, 1], 0.44, 0.11); vrect('steel', [21.148, 8.6], [21.152, 8.6], 0.15, 1.45, [0, 0, 1], [0.25, 0.25, 0.25]); vrect('steel', [21.25, 8.6], [21.3, 8.6], 0.9, 0.96, [0, 0, 1], [0.35, 0.35, 0.35], 0.006);
      for (const [z, n] of [[9.8, [0, 0, 1]], [8.2, [0, 0, -1]]]) { louvre([24.5, z], [25.7, z], 0.3, 1.3, n, [0.4, 0.42, 0.32]); louvre([25.9, z], [27.1, z], 0.3, 1.3, n, [0.4, 0.42, 0.32]); vrect('steel', [25.79, z], [25.81, z], 0.1, 1.5, n, [0.25, 0.25, 0.22]); }
      louvre([24.2, 8.4], [24.2, 9.6], 0.25, 1.4, [-1, 0, 0], [0.4, 0.42, 0.32]);
      cyl('steel', 'y', [26.9, 1.95, 9.3], 0.08, 0.7, { tint: [0.28, 0.28, 0.27], n: 10 }); ph.addBox([26.82, 1.6, 9.22], [26.98, 2.3, 9.38], { surface: 'metal' });
      if (!ammoM) for (let k = 0; k < 4; k++) { const x0 = 28.4 + k, x1 = 29.1 + k; draw('paint', x0 - 0.01, 0.5, 9.19, x1 + 0.01, 0.6, 9.91, { tint: [0.42, 0.44, 0.34], faces: 'wenst' });
        vrect('paint', [x0 + 0.12, 9.9], [x1 - 0.12, 9.9], 0.26, 0.31, [0, 0, 1], [0.9, 0.78, 0.2], 0.006); for (const x of [x0, x1]) draw('steel', x + (x === x0 ? -0.03 : 0), 0.32, 9.45, x + (x === x0 ? 0 : 0.03), 0.36, 9.65, { tint: [0.25, 0.25, 0.25], flat: true }); }
      // the dish bunker's set
      if (!gsB) louvre([33.6, -15.8], [34.7, -15.8], 0.35, 1.1, [0, 0, 1], [0.6, 0.58, 0.52]); cyl('steel', 'y', [34.5, 1.55, -17.2], 0.05, 0.5, { tint: [0.3, 0.3, 0.3], n: 8 }); ph.addBox([34.45, 1.3, -17.25], [34.55, 1.8, -17.15], { surface: 'metal' });
    }
    // pallets and drums by the workshop's west end; the crane, the bench and drums under its awning (3, 21, 22)
    for (const [x, z, n] of [[4.6, 12.8, 4], [3.2, 12.8, 3]]) for (let k = 0; k < n; k++) pallet(x, z, k * 0.15);
    // under the workshop's awning: the bench model (a bench, a tool chest, a tool board) for the code's chest and bench, the engine
    // hoist model for its crane, and a portable generator beside them
    placeModel('gen', 2.4, 16.2, 1, 'generator');
    if (!placeModel('bench', 3.1, 21.0, BENCH_Q, 'workbench')) {
    solid('paint', 4.2, 0, 16.0, 5.6, 0.95, 17.0, { tint: [0.72, 0.18, 0.12] });                           // the red tool chest
    solid('wood', 3.6, 0.8, 20.2, 5.6, 0.88, 22.0, { tint: [0.7, 0.62, 0.5] }); for (const [x, z] of [[3.7, 20.3], [5.5, 20.3], [3.7, 21.9], [5.5, 21.9]]) solid('steel', x - 0.04, 0, z - 0.04, x + 0.04, 0.8, z + 0.04, { tint: [0.4, 0.4, 0.4] }); }
    if (!placeModel('hoist', 2.2, 18.6, 0, 'hoist')) { solid('paint', 2.8, 0, 18.2, 4.2, 0.12, 18.35, { tint: [0.8, 0.22, 0.12] }); solid('paint', 3.42, 0.12, 18.2, 3.58, 1.9, 18.35, { tint: [0.8, 0.22, 0.12] }); deco('paint', 3.5, 1.8, 18.22, 3.56, 1.86, 18.33, { tint: [0.8, 0.22, 0.12] });
      beamPQ('paint', [3.5, 1.9, 18.27], [2.4, 2.3, 18.27], 0.1, 0.1, { tint: [0.8, 0.22, 0.12], hi: false }); hitBox(2.4, 1.85, 18.2, 3.5, 2.35, 18.35); }
    // the drums by the workshop and between the hangars (3, 4, 21): the game's own red barrels, which blow up when shot, as on the harbour
    // (level.explosives: the game makes the barrel, its collision and the blast, and tells the other players)
    for (const [x, z, k] of [[2.4, 14.4, 1], [3.05, 14.15, 2], [1.0, 25.4, 3], [1.7, 25.75, 4], [22.9, 10.4, 5]]) explosives.push({ name: 'barrel', x, y: 0.02, z, yaw: k * 1.3, opts: { color: 'red', seed: 40 + k } });
    { // the hose reel cart by the wash bay's door (46-49): two rims, the hose wound between them, a frame with a handle and two wheels, the hose's end run out on the apron
      const x = 4.9, z = 35.3, y = 0.44, R = 0.3, G = [0.2, 0.42, 0.22], RD = [0.62, 0.14, 0.1], fr = { tint: RD, hi: false };
      for (const sg of [-1, 1]) { cyl('paint', 'x', [x + sg * 0.21, y, z], R, 0.02, { tint: RD, n: 20 }); cyl('steel', 'x', [x + sg * 0.225, y, z], 0.05, 0.03, { tint: [0.3, 0.3, 0.3], n: 8 });
        beamPQ('paint', [x + sg * 0.25, y, z], [x + sg * 0.25, 0.02, z + 0.3], 0.035, 0.035, fr); beamPQ('paint', [x + sg * 0.25, y, z], [x + sg * 0.25, 0.1, z - 0.24], 0.035, 0.035, fr);
        beamPQ('paint', [x + sg * 0.25, y, z], [x + sg * 0.25, 0.98, z + 0.34], 0.035, 0.035, fr); cyl('tire', 'x', [x + sg * 0.29, 0.1, z - 0.24], 0.1, 0.05, { tint: [0.3, 0.3, 0.3], n: 12 }); }
      beamPQ('paint', [x - 0.25, 0.98, z + 0.34], [x + 0.25, 0.98, z + 0.34], 0.035, 0.035, fr); beamPQ('steel', [x - 0.3, 0.1, z - 0.24], [x + 0.3, 0.1, z - 0.24], 0.025, 0.025, { tint: [0.3, 0.3, 0.3], hi: false });
      cyl('steel', 'x', [x, y, z], 0.1, 0.4, { tint: [0.3, 0.3, 0.3], n: 10, caps: false });
      for (let k = 0; k < 6; k++) cyl('tire', 'x', [x - 0.165 + k * 0.066, y, z], R * (k % 2 ? 0.8 : 0.74), 0.066, { tint: G, n: 14, caps: false });
      beamPQ('steel', [x + 0.24, y, z], [x + 0.34, y + 0.12, z], 0.02, 0.02, { tint: [0.3, 0.3, 0.3], hi: false }); beamPQ('steel', [x + 0.34, y + 0.12, z], [x + 0.42, y + 0.12, z], 0.03, 0.03, { tint: [0.15, 0.15, 0.15], hi: false });   // the crank
      { const run = [[x, y - R * 0.74, z + 0.08], [x - 0.04, 0.025, z + 0.5], [x - 0.5, 0.025, z + 0.95], [x - 0.75, 0.025, z + 0.55], [x - 1.25, 0.025, z + 0.3], [x - 1.7, 0.025, z + 0.75]];
        for (let k = 0; k + 1 < run.length; k++) beamPQ('tire', run[k], run[k + 1], 0.035, 0.035, { tint: G, hi: false }); const e = run[run.length - 1]; beamPQ('paint', e, [e[0] - 0.14, 0.03, e[2] + 0.1], 0.03, 0.03, { tint: [0.9, 0.7, 0.2], hi: false }); }
      ph.addBox([x - 0.33, 0, z - 0.36], [x + 0.33, 1.0, z + 0.38], { surface: 'metal' }); }
    // the gap between the hangars: a tyre and drums (4)
    if (!prop('tyre', 9.825, 0, 25.0, 10.175, 1.0, 26.0)) cyl('tire', 'x', [10, 0.5, 25.5], 0.5, 0.35, { tint: [0.9, 0.9, 0.9], n: 16 }); ph.addBox([9.82, 0, 25.0], [10.18, 1.0, 26.0], { surface: 'wood' });
    // the picnic canopy along the barracks (14-17): posts, a gable of cloth, three tables; a slab for players under the cloth
    { const x0 = -16.5, x1 = -3.8, z0 = -20.8, z1 = -16, zm = (z0 + z1) / 2;
      for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / 3) for (const z of [z0, z1]) { solid('steel', x - 0.05, 0, z - 0.05, x + 0.05, 2.5, z + 0.05, { tint: [0.4, 0.42, 0.36] }); solid('concrete', x - 0.2, 0, z - 0.2, x + 0.2, 0.15, z + 0.2, { tint: [0.95, 0.93, 0.9] }); }
      // three bays of fabric, green, yellow, green (14-17)
      // three bays of fabric, green, yellow, green (14-17): each slope a sheet laced to its ridge and its two rafters, its eave free between the posts.
      // The sheets are cloth (makeCloths): they sag under their own weight and fill and flap with the wind. What stops shots stays where it hangs at rest
      tube('steel', [x0 - 0.2, 3.25, zm], [x1 + 0.2, 3.25, zm], 0.03, { tint: [0.4, 0.42, 0.36], n: 6 });
      for (let k = 0; k <= 3; k++) { const x = x0 - 0.2 + (x1 - x0 + 0.4) * k / 3; for (const za of [z0 - 0.15, z1 + 0.15]) tube('steel', [x, 2.45, za], [x, 3.25, zm], 0.022, { tint: [0.4, 0.42, 0.36], n: 6 }); }
      for (let k = 0; k < 3; k++) { const a = x0 - 0.2 + (x1 - x0 + 0.4) * k / 3, c = x0 - 0.2 + (x1 - x0 + 0.4) * (k + 1) / 3, tint = k === 1 ? hexLin('b59a3a') : hexLin('55703a');
        for (const [za, zb] of [[z0 - 0.15, zm], [z1 + 0.15, zm]]) {
          hiQuad([[a, 2.45, za], [c, 2.45, za], [c, 3.25, zb], [a, 3.25, zb]], 'wood');
          cloths.push({ nu: 9, nv: 6, slack: 1.014, calm: 0.8, tex: 'olive', seed: k * 2 + (za < zm ? 0 : 1), at: (u, v) => [lerp(a + 0.02, c - 0.02, u), lerp(2.45, 3.25, v), lerp(za, zb, v)], pin: (i2, j2, nu, nv) => j2 === nv || j2 === 0 || i2 === 0 || i2 === nu });
        } }
      for (const za of [z0 - 0.15, z1 + 0.15]) tube('steel', [x0 - 0.2, 2.45, za], [x1 + 0.2, 2.45, za], 0.022, { tint: [0.4, 0.42, 0.36], n: 6 });     // the eave rails the cloth is laced to
      for (const za of [z0 - 0.15, z1 + 0.15]) for (let k = 0; k < 4; k++) { const q0 = lerp(za, zm, k / 4), q1 = lerp(za, zm, (k + 1) / 4), top = lerp(2.45, 3.25, k / 4) + 0.02;     // under the cloth all the way across its band
        block(x0 - 0.2, Math.min(2.5, top - 0.06), Math.min(q0, q1), x1 + 0.2, top, Math.max(q0, q1), 'wood').walk = true; }
      for (const x of [-14.2, -10.2, -6.2]) { if (prop('table', x - 0.95, 0, zm - 0.76, x + 0.95, 0.78, zm + 0.76, TABLE_Q)) { cbox(x - 0.95, 0.72, zm - 0.4, x + 0.95, 0.78, zm + 0.4); for (const s of [-1, 1]) cbox(x - 0.95, 0.42, zm + s * 0.62 - 0.14, x + 0.95, 0.47, zm + s * 0.62 + 0.14); for (const dx of [-0.75, 0.75]) cbox(x + dx - 0.04, 0, zm - 0.72, x + dx + 0.04, 0.72, zm + 0.72); continue; }
        solid('wood', x - 0.95, 0.72, zm - 0.4, x + 0.95, 0.78, zm + 0.4, { tint: [0.74, 0.6, 0.42] });
        for (const s of [-1, 1]) solid('wood', x - 0.95, 0.42, zm + s * 0.62 - 0.14, x + 0.95, 0.47, zm + s * 0.62 + 0.14, { tint: [0.74, 0.6, 0.42] });
        for (const dx of [-0.75, 0.75]) solid('steel', x + dx - 0.04, 0, zm - 0.72, x + dx + 0.04, 0.72, zm + 0.72, { tint: [0.5, 0.5, 0.48] }); }
      { // the drinks cooler on its stand by the canopy's east post (16): a crate for a stand, an insulated orange cooler with a white lid, its bands, its handles and its spigot, a stack of cups
        const cx = -2.4, Y = 0.72, OR = hexLin('d9661c');
        crate(cx, zm, 0.62, 0.62, Y);
        cyl('paint', 'y', [cx, Y + 0.24, zm], 0.2, 0.48, { tint: OR, n: 22 }); cyl('paint', 'y', [cx, Y + 0.505, zm], 0.208, 0.05, { tint: [0.9, 0.9, 0.86], n: 22 }); cyl('paint', 'y', [cx, Y + 0.545, zm], 0.12, 0.03, { tint: [0.8, 0.8, 0.76], n: 16 });
        for (const y of [Y + 0.1, Y + 0.38]) cyl('paint', 'y', [cx, y, zm], 0.204, 0.022, { tint: hexLin('b8510f'), n: 22, caps: false });
        tube('paint', [cx + 0.19, Y + 0.08, zm], [cx + 0.265, Y + 0.07, zm], 0.018, { tint: [0.85, 0.85, 0.82], n: 6 }); tube('paint', [cx + 0.25, Y + 0.075, zm], [cx + 0.25, Y + 0.115, zm], 0.012, { tint: [0.7, 0.1, 0.08], n: 6 });
        for (const sg of [-1, 1]) { tube('steel', [cx - 0.06, Y + 0.4, zm + sg * 0.2], [cx - 0.06, Y + 0.44, zm + sg * 0.245], 0.009, { tint: [0.2, 0.2, 0.2], n: 4 }); tube('steel', [cx + 0.06, Y + 0.4, zm + sg * 0.2], [cx + 0.06, Y + 0.44, zm + sg * 0.245], 0.009, { tint: [0.2, 0.2, 0.2], n: 4 }); tube('steel', [cx - 0.06, Y + 0.44, zm + sg * 0.245], [cx + 0.06, Y + 0.44, zm + sg * 0.245], 0.011, { tint: [0.2, 0.2, 0.2], n: 4 }); }
        cyl('paint', 'y', [cx - 0.2, Y + 0.09, zm + 0.2], 0.04, 0.18, { tint: [0.95, 0.95, 0.92], n: 10 });
        hitBox(cx - 0.22, Y, zm - 0.22, cx + 0.22, Y + 0.58, zm + 0.22); } }
    { const x0 = -3.55, z = -15.72, r = 0.33, ring = c => { for (let k = 0; k < 16; k++) beamPQ('tire', vadd(c, [Math.cos(k / 16 * TAU) * r, Math.sin(k / 16 * TAU) * r, 0]), vadd(c, [Math.cos((k + 1) / 16 * TAU) * r, Math.sin((k + 1) / 16 * TAU) * r, 0]), 0.035, 0.035, { tint: [0.28, 0.28, 0.28], hi: false });
        for (let k = 0; k < 8; k++) beamPQ('galv', c, vadd(c, [Math.cos(k / 8 * TAU) * r, Math.sin(k / 8 * TAU) * r, 0]), 0.005, 0.005, { tint: [0.8, 0.8, 0.78], hi: false }); };
      const R = [x0 + 0.2, r, z], F = [x0 + 1.24, r, z], Bt = [x0 + 0.62, r + 0.04, z], S = [x0 + 0.46, 0.86, z], H = [x0 + 1.08, 0.96, z], fr = { tint: [0.7, 0.15, 0.12], hi: false };   // a bicycle by the canopy's corner post (16)
      if (!prop('bicycle', x0 - 0.05, 0, z - 0.3, x0 + 1.75, 1.02, z + 0.3)) {
      ring(R); ring(F); beamPQ('paint', R, Bt, 0.024, 0.024, fr); beamPQ('paint', Bt, S, 0.03, 0.03, fr); beamPQ('paint', Bt, H, 0.032, 0.032, fr); beamPQ('paint', S, H, 0.03, 0.03, fr); beamPQ('paint', R, S, 0.02, 0.02, fr); beamPQ('paint', H, F, 0.026, 0.026, fr);
      beamPQ('steel', [S[0] - 0.12, 0.9, z], [S[0] + 0.1, 0.9, z], 0.07, 0.035, { tint: [0.14, 0.14, 0.14], hi: false }); beamPQ('steel', [H[0], 1.0, z - 0.26], [H[0], 1.0, z + 0.26], 0.025, 0.025, { tint: [0.2, 0.2, 0.2], hi: false });
      }
      ph.addBox([x0 - 0.02, 0, z - 0.05], [x0 + 1.6, 1.0, z + 0.05], { surface: 'metal' }); }
    /* the stores (38-42, as 119 shows them): three 40 ft containers side by side, their ends on the back of a low concrete dock cast in
       slabs: a deep part along the containers with pallets stacked under two patched sails on six posts, a narrower part past the
       last container with IBC tanks, cable reels and a crate, a ramp down at the red container's end; roped tarp stacks on the
       ground in front, a big crate against the dock's face */
    for (const [x, tint, cm, rt] of [[-37.6, [0.7, 0.3, 0.22], 'contR', [1.0, 0.8, 0.74]], [-34.2, [0.44, 0.56, 0.62], 'contB', [0.88, 0.94, 1.0]], [-30.8, [0.86, 0.8, 0.66], 'contC', [1.0, 1.0, 0.98]]]) {
      solid(cm, x - 1.22, 0, 19.5, x + 1.22, 2.59, 31.7, { tint: [1, 1, 1], faces: 'wens', flat: true, surface: 'metal' });          // corrugated sides in their own paint (119)
      { const Q = [[x - 1.22, 2.59, 19.5], [x + 1.22, 2.59, 19.5], [x + 1.22, 2.59, 31.7], [x - 1.22, 2.59, 31.7]];                         // the roof: its ribs across, from the middle of the picture (no dust band)
        bld.face('contC', Q, [0, 1, 0], Q.map(q => [q[2], 2.6 * (0.35 + 0.3 * (q[0] - x + 1.22) / 2.44)]), rt, 'cr'); }     // sun-bleached to near white over its paint (119)
      const frame = vscale(tint, 0.62);
      for (const s of [-1, 1]) for (const z of [19.5, 31.7]) deco('steel', x + s * 1.22 - 0.09, 0, z - 0.09, x + s * 1.22 + 0.09, 2.6, z + 0.09, { tint: frame, hi: false });     // corner posts
      for (const s of [-1, 1]) for (const [y0, y1] of [[0, 0.13], [2.47, 2.6]]) deco('steel', x + s * 1.22 - (s > 0 ? 0.015 : 0.0), y0, 19.5, x + s * 1.22 + (s > 0 ? 0 : 0.015), y1, 31.7, { tint: frame, hi: false, faces: s > 0 ? 'etb' : 'wtb' });   // the side rails, top and bottom
      for (const s of [-1, 1]) for (const z of [19.5, 31.7]) for (const y of [0, 2.44]) deco('steel', x + s * 1.22 - 0.11, y, z - 0.11, x + s * 1.22 + 0.11, y + 0.16, z + 0.11, { tint: vscale(tint, 0.45), hi: false, shadow: 'r' });   // corner castings
      // the doors: rails top and bottom, the seam, hinges, four lock rods with their handles and cam keepers (39-42)
      const Z = 31.7, dk = vscale(tint, 0.6);
      vrect('steel', [x - 1.14, Z], [x + 1.14, Z], 0.0, 0.14, [0, 0, 1], dk); vrect('steel', [x - 1.14, Z], [x + 1.14, Z], 2.44, 2.59, [0, 0, 1], dk); vrect('steel', [x - 0.012, Z], [x + 0.012, Z], 0.14, 2.44, [0, 0, 1], [0.14, 0.14, 0.14]);
      for (const sx of [-1, 1]) for (const y of [0.35, 0.95, 1.6, 2.2]) draw('steel', x + sx * 1.1 - 0.05, y, Z, x + sx * 1.1 + 0.05, y + 0.12, Z + 0.05, { tint: vscale(tint, 0.55), flat: true });
      for (const dx of [-0.8, -0.3, 0.3, 0.8]) { draw('galv', x + dx - 0.025, 0.2, Z, x + dx + 0.025, 2.4, Z + 0.06, { tint: [0.8, 0.8, 0.78], faces: 'swe' });
        for (const y of [0.18, 2.34]) draw('steel', x + dx - 0.05, y, Z, x + dx + 0.05, y + 0.08, Z + 0.08, { tint: [0.45, 0.45, 0.43], flat: true });
        const sg = Math.sign(dx); draw('steel', Math.min(x + dx, x + dx + sg * 0.24), 1.05, Z + 0.06, Math.max(x + dx, x + dx + sg * 0.24), 1.09, Z + 0.09, { tint: [0.55, 0.55, 0.52], flat: true }); }
    }
    { const xw = -38.82, xo = -40.25, z0 = 25.6, z1 = 29.5;   // a lean-to on the red container's west side toward the fence, a workbench under it (119)
      for (const z of [z0 + 0.1, z1 - 0.1]) solid('steel', xo + 0.02, 0, z - 0.04, xo + 0.1, 2.15, z + 0.04, { tint: [0.4, 0.4, 0.38] });
      sheet('corrR', [[xw, 2.55, z1], [xw, 2.55, z0], [xo, 2.15, z0], [xo, 2.15, z1]], { tint: [0.85, 0.82, 0.76] }); block(xo, 2.1, z0, xw, 2.55, z1, 'metal');
      solid('wood', xw - 0.95, 0.8, 26.5, xw - 0.1, 0.86, 28.9, { tint: [0.7, 0.6, 0.45] });
      for (const [dx, z] of [[0.15, 26.6], [0.9, 26.6], [0.15, 28.8], [0.9, 28.8]]) solid('steel', xw - dx - 0.03, 0, z - 0.03, xw - dx + 0.03, 0.8, z + 0.03, { tint: [0.4, 0.4, 0.4] });
      solid('paint', xw - 0.6, 0.86, 27.0, xw - 0.25, 1.1, 27.4, { tint: [0.7, 0.2, 0.12] });                       // a red toolbox on the bench
      solid('steel', xw - 0.5, 0.86, 28.2, xw - 0.3, 1.0, 28.5, { tint: [0.3, 0.3, 0.32] }); }                   // and a vice
    const DH = 0.55;      // the dock's height: knee high, as 119 shows it (the ramp's eleven 5 cm steps reach it)
    { const slab = (x0, z0, x1, z1, k) => { const t = 0.74 + 0.05 * Math.sin(k * 2.7 + 1.3), c = [t * 0.97, t * 0.95, t * 0.9]; solid('pave', x0, 0, z0, x1, DH, z1, { tint: c }); return c; };      // weathered grey, each slab a little different
      const near = [[-40.2, -37.45], [-37.45, -34.7], [-34.7, -31.95], [-31.95, -29.2]].map(([a, c], k) => [a, c, slab(a, 14.6, c, 19.5, k)]);
      const far = [[-29.2, -25.8], [-25.8, -22.4]].map(([a, c], k) => [a, c, slab(a, 16.8, c, 19.5, k + 4)]);
      // the joints between the slabs, cut across the top and down the faces
      const J = [0.2, 0.2, 0.19];
      for (const x of [-37.45, -34.7, -31.95]) { draw('line', x - 0.012, DH, 14.6, x + 0.012, DH + 0.002, 19.5, { tint: J, flat: true, faces: 't' }); draw('line', x - 0.012, 0.02, 14.598, x + 0.012, DH, 14.6, { tint: J, flat: true, faces: 'n' }); }
      draw('line', -25.8 - 0.012, DH, 16.8, -25.8 + 0.012, DH + 0.002, 19.5, { tint: J, flat: true, faces: 't' }); draw('line', -25.8 - 0.012, 0.02, 16.798, -25.8 + 0.012, DH, 16.8, { tint: J, flat: true, faces: 'n' });
      draw('line', -29.2 - 0.012, DH, 16.8, -29.2 + 0.012, DH + 0.002, 19.5, { tint: J, flat: true, faces: 't' });
      // weathering: each exposed face dark with dirt at its foot, fading up to the slab's own colour (one quad a hair proud of the face)
      const grime = (P0, P1, n, c) => { const d = vscale(c, 0.42), up = 0.3, e = 0.002, o = [n[0] * e, 0, n[2] * e], Q = [[P0[0] + o[0], 0.0, P0[1] + o[2]], [P1[0] + o[0], 0.0, P1[1] + o[2]], [P1[0] + o[0], up, P1[1] + o[2]], [P0[0] + o[0], up, P0[1] + o[2]]];
        bld.face('pave', n[0] + n[2] > 0 ? [Q[1], Q[0], Q[3], Q[2]] : Q, n, Q.map(q => [q[0] + q[2], q[1]]), n[0] + n[2] > 0 ? [d, d, c, c] : [d, d, c, c], 'r'); };
      for (const [a, c, t] of near) grime([a, 14.6], [c, 14.6], [0, 0, -1], t);
      for (const [a, c, t] of far) grime([a, 16.8], [c, 16.8], [0, 0, -1], t);
      grime([-29.2, 14.6], [-29.2, 16.8], [1, 0, 0], near[3][2]); grime([-22.4, 16.8], [-22.4, 19.5], [1, 0, 0], far[1][2]);
      grime([-40.2, 17.3], [-40.2, 19.5], [-1, 0, 0], near[0][2]);
      // a steel angle along the top edges a forklift's forks and pallets knock (dark, worn bright at the corner)
      const ST = { tint: [0.3, 0.3, 0.29], flat: true };
      draw('steel', -40.2, DH - 0.06, 14.575, -29.2, DH + 0.002, 14.6, { ...ST, faces: 'nt' }); draw('steel', -29.2, DH - 0.06, 16.775, -22.4, DH + 0.002, 16.8, { ...ST, faces: 'nt' });
      draw('steel', -29.2, DH - 0.06, 14.6, -29.175, DH + 0.002, 16.8, { ...ST, faces: 'et' }); draw('steel', -22.4, DH - 0.06, 16.8, -22.375, DH + 0.002, 19.5, { ...ST, faces: 'et' });
      // cracks and patches on the top, oil where the forklift stands to load
      for (const [x, z, sx, sz, r] of [[-38.6, 16.2, 0.9, 0.35, 0.3], [-33.2, 15.4, 1.1, 0.4, 1.2], [-27.4, 18.2, 0.7, 0.3, 2.1]]) { const c2 = Math.cos(r), sn = Math.sin(r), P = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + a * sx * c2 - b * sz * sn, DH + 0.003, z + a * sx * sn + b * sz * c2]); bld.face('stain', P, [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.05, 0.045, 0.04], 'r'); }
    }
    { /* the ramp down the red container's end (119): eleven steps of 5 cm for players (the game steps 42 cm, so it walks as a slope),
         drawn as the slope through their middles, with its two sides */
      const X0 = -44.0, X1 = -40.2, Z0 = 14.9, Z1 = 17.3, N = 11, yAt = x => { const t = (x - X0) / (X1 - X0); return DH * t + 0.025 * (1 - t); };
      for (let k = 0; k < N; k++) { const b2 = ph.addBox([X0 + k * (X1 - X0) / N, 0, Z0], [X1, (k + 1) * 0.05, Z1], { surface: 'concrete' }); if (b2) b2.ramp = true; }
      const nrm = vnorm([-(DH - 0.025), X1 - X0, 0]), top = [[X0, yAt(X0), Z0], [X1, yAt(X1), Z0], [X1, yAt(X1), Z1], [X0, yAt(X0), Z1]];
      bld.face('pave', top, nrm, top.map(q => [q[0] * 1.02, q[2]]), [0.86, 0.84, 0.8], 'cr');
      for (const [z, n2] of [[Z0, [0, 0, -1]], [Z1, [0, 0, 1]]]) { const P = [[X0, 0, z], [X1, 0, z], [X1, yAt(X1), z], [X0, yAt(X0), z]]; bld.face('pave', P, n2, P.map(q => [q[0], q[1]]), [0.8, 0.78, 0.75], 'cr'); }
      for (let x = X0 + 0.25; x < X1; x += 0.25) { const Q = [[x, yAt(x) + 0.002, Z0 + 0.1], [x + 0.03, yAt(x + 0.03) + 0.002, Z0 + 0.1], [x + 0.03, yAt(x + 0.03) + 0.002, Z1 - 0.1], [x, yAt(x) + 0.002, Z1 - 0.1]]; bld.face('line', Q, nrm, Q.map(q => [q[0], q[2]]), [0.5, 0.49, 0.46], 'r'); }   // the grooves cut across it for grip
    }
    const ibc = (x, z, y) => { if (prop('ibc', x - 0.52, y, z - 0.62, x + 0.52, y + 1.16, z + 0.62, 1)) { cbox(x - 0.5, y, z - 0.6, x + 0.5, y + 1.1, z + 0.6, 'metal'); return; }
      solid('paint', x - 0.5, y, z - 0.6, x + 0.5, y + 1.1, z + 0.6, { tint: [0.92, 0.92, 0.88] });   // the tank in its cage, on a pallet, a cap and a valve
      draw('steel', x - 0.52, y, z - 0.62, x + 0.52, y + 0.13, z + 0.62, { tint: [0.3, 0.3, 0.3], faces: 'wens' });
      for (const yy of [0.42, 0.76, 1.08]) draw('galv', x - 0.515, y + yy, z - 0.615, x + 0.515, y + yy + 0.025, z + 0.615, { tint: [0.8, 0.8, 0.78], faces: 'wenst' });
      for (const t of [-0.49, -0.16, 0.16, 0.49]) { draw('galv', x + t - 0.012, y + 0.13, z - 0.615, x + t + 0.012, y + 1.1, z + 0.615, { tint: [0.8, 0.8, 0.78], faces: 'ns' }); draw('galv', x - 0.515, y + 0.13, z + t * 1.2 - 0.012, x + 0.515, y + 1.1, z + t * 1.2 + 0.012, { tint: [0.8, 0.8, 0.78], faces: 'we' }); }
      cyl('steel', 'y', [x, y + 1.13, z], 0.15, 0.06, { tint: [0.25, 0.25, 0.25], n: 12 }); cyl('steel', 'x', [x + 0.56, y + 0.22, z], 0.05, 0.12, { tint: [0.3, 0.3, 0.3], n: 8 }); };
    // the far part: two IBC tanks against the back, the ammunition crate in front of them, the cable reels at the end (119)
    ibc(-28.45, 18.9, DH); ibc(-27.35, 18.9, DH);      // flush with the dock's back edge: from the ground behind, one face to climb, no 5 cm ledge under it
    crate(-28.0, 17.45, 0.9, 0.8, 0.5, DH);            // the ammunition crate on the dock (ammoSpots)
    reel(-25.3, 18.4, DH, 0.7, 1.0); ph.addBox([-26.0, DH, 17.9], [-24.6, DH + 1.4, 18.9], { surface: 'wood' });
    reel(-23.55, 18.45, DH, 0.48, 0.8); ph.addBox([-24.03, DH, 18.05], [-23.07, DH + 0.96, 18.85], { surface: 'wood' });
    // the deep part: pallets stacked under the sails, against the containers' ends; a big crate on the ground against the dock's face
    for (const [x, z, n] of [[-36.0, 18.55, 10], [-34.75, 18.55, 6], [-31.4, 18.55, 7], [-31.6, 15.5, 9], [-32.9, 15.5, 4]]) for (let k = 0; k < n; k++) pallet(x + (k % 3 === 1 ? 0.03 : k % 3 === 2 ? -0.02 : 0), z, DH + k * 0.15, [0.88, 0.76, 0.56]);
    crate(-36.3, 13.85, 1.5, 1.1, 1.2, 0);
    // the sails: six posts, three along the front, three against the containers' ends
    const SP = { x: [-39.8, -34.7, -29.6], z: [14.72, 19.25] };      // the front row at the dock's edge, clear of the ramp's top
    for (const x of SP.x) for (const z of SP.z) solid('galv', x - 0.06, DH, z - 0.06, x + 0.06, 4.1, z + 0.06, { tint: [0.75, 0.75, 0.72] });
    { /* two patched sheets (119), each tied by its corners to four of the six posts, the two meeting at the middle pair; each twisted
         (its corners high and low by turns) so it sheds the wind and shows its bowl. Cloth (makeCloths): they hang in shallow bowls,
         their edges drawn in between the ties, and lift in the gusts. Under each, what stops shots lies in its plane, and what holds a
         player who jumps onto it from a container's roof follows it in nine cells, a little under the cloth (it sags about 12 cm) */
      const SAILS = [[[-39.5, 3.78, 15.0], [-35.0, 3.38, 15.0], [-35.0, 3.82, 18.95], [-39.5, 3.42, 18.95]], [[-34.4, 3.4, 15.0], [-29.9, 3.8, 15.0], [-29.9, 3.4, 18.95], [-34.4, 3.84, 18.95]]];
      for (const [k2, S] of SAILS.entries()) {
        const at = (u, v) => vadd(vscale(vadd(vscale(S[0], 1 - u), S[1], u), 1 - v), vadd(vscale(S[3], 1 - u), S[2], u), v);
        cloths.push({ nu: 11, nv: 8, slack: 1.012, tex: 'cream', seed: 20 + k2, at, pin: (i2, j2, nu, nv) => (i2 === 0 || i2 === nu) && (j2 === 0 || j2 === nv) });
        for (const q of S) { const px = q[0] < -37 ? -39.8 : q[0] > -32 ? -29.6 : -34.7, pz = q[2] < 17 ? 14.72 : 19.25; tube('tarp', q, [px, q[1] + 0.08, pz], 0.008, { tint: [0.3, 0.28, 0.2], n: 4, caps: false }); }
        hiTri(S[0], S[1], S[2], 'wood'); hiTri(S[0], S[2], S[3], 'wood');
        const sag = (u, v) => 0.12 * 16 * u * (1 - u) * v * (1 - v), N3 = 3;
        for (let i = 0; i < N3; i++) for (let j = 0; j < N3; j++) { const cs = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]].map(([a, c]) => { const p = at(a / N3, c / N3); return [p[0], p[1] - sag(a / N3, c / N3), p[2]]; });
          const top = Math.min(...cs.map(p => p[1])) - 0.03, xs = cs.map(p => p[0]), zs = cs.map(p => p[2]);
          block(Math.min(...xs), top - 0.12, Math.min(...zs), Math.max(...xs), top, Math.max(...zs), 'wood').walk = true; } } }
    for (const [x, z, w, d] of [[-24.2, 15.3, 2.6, 1.8], [-32.6, 12.9, 2.6, 2.0], [-20.5, 11.4, 2.4, 1.6]]) {   // tarp stacks: straps across the short way, stakes at the corners and their ropes (38, 39, 42)
      /* a load under canvas, as the pictures show it: a rounded mound, the cloth pulled over crates of uneven height and spreading to the
         ground in folds, roped across the short way and along the long way to pegs. One skin over rings of the footprint (a rectangle with
         round corners) that draw in toward the crown; the ropes are laid on the same surface. The box under it is what stops players and shots. */
      { const CV = hexLin('7d7350'), sd = x * 3.1 + z * 1.7, hw = w / 2 + 0.03, hd = d / 2 + 0.03, NE = 5, M = 64, IN2 = [x, 0.8, z];
        cbox(x - hw * 1.03, 0, z - hd * 1.03, x + hw * 1.03, 1.5, z + hd * 1.03);
        const PRO = [[0, 1.09], [0.05, 1.065], [0.22, 1.04], [0.6, 1.02], [1.0, 1.0], [1.24, 0.965], [1.38, 0.9], [1.46, 0.79], [1.505, 0.62], [1.53, 0.4], [1.545, 0.18], [1.55, 0.02]];   // a height, and how much of the footprint is left at it
        const yOf = sc => { if (sc >= PRO[0][1]) return 0; for (let k = 0; k + 1 < PRO.length; k++) if (sc <= PRO[k][1] && sc >= PRO[k + 1][1]) return lerp(PRO[k][0], PRO[k + 1][0], (PRO[k][1] - sc) / (PRO[k][1] - PRO[k + 1][1])); return PRO[PRO.length - 1][0]; };
        const S = (th, sc) => { const c = Math.cos(th), s2 = Math.sin(th), ex = Math.sign(c) * Math.abs(c) ** (2 / NE) * hw, ez = Math.sign(s2) * Math.abs(s2) ** (2 / NE) * hd, y = yOf(sc), low = 1 - smooth(0.15, 1.3, y), top = 1 - smooth(0.5, 0.97, sc);
          const fold = 1 + low * (0.045 * Math.sin(th * 7 + sd) + 0.028 * Math.sin(th * 13 + sd * 2) + 0.012 * Math.sin(th * 29 + sd)) + (1 - low) * (1 - top) * 0.02 * Math.sin(th * 5 + sd), px = ex * sc * fold, pz = ez * sc * fold;
          return [x + px, y * (0.93 + 0.07 * top) - top * 0.3 * Math.max(0, 0.62 - fbm2(px * 0.9 + sd, pz * 0.9 + 2, 2)), z + pz]; };                                  // the crates under it are not all one height
        const rings = PRO.map(([, sc]) => [...Array(M + 1)].map((_, k) => S((k % M) / M * TAU, sc)));
        loft('cloth', rings, IN2, { tint: (i2, j2) => { const th = (j2 % M) / M * TAU, y = PRO[i2][0], low = 1 - smooth(0.15, 1.3, y), g = 0.74 + 0.4 * fbm2(j2 * 0.3 + sd, i2 * 0.8, 2) + 0.2 * smooth(1.3, 1.5, y) + 0.2 * low * Math.sin(th * 7 + sd) + 0.08 * low * Math.sin(th * 13 + sd * 2); return [CV[0] * g, CV[1] * g, CV[2] * g]; } });
        const along = w >= d, RP = { tint: hexLin('a69c7c'), n: 4, caps: false, shadow: 'r' }, PEG = [0.5, 0.42, 0.3];
        const rope = (fix, acrossZ) => {          // a rope over the load where one footprint coordinate is `fix`, pegged at both hems
          const pts = [], A = acrossZ ? hw : hd, B = acrossZ ? hd : hw, bmax = B * (PRO[0][1] ** NE - (Math.abs(fix) / A) ** NE) ** (1 / NE);
          for (let k = 0; k <= 44; k++) { const u = k / 22 - 1, b2 = bmax * Math.sign(u) * (1 - (1 - Math.abs(u)) ** 2.2), ca = acrossZ ? fix : b2, cb = acrossZ ? b2 : fix;
            const sc = Math.max(0.02, ((Math.abs(ca) / hw) ** NE + (Math.abs(cb) / hd) ** NE) ** (1 / NE)), th = Math.atan2(Math.sign(cb) * (Math.abs(cb) / (sc * hd)) ** (NE / 2), Math.sign(ca) * (Math.abs(ca) / (sc * hw)) ** (NE / 2)), q = S(th, sc);
            if (q[1] < 0.22) continue; const side = smooth(0.9, 1.0, sc), dx = q[0] - x, dz = q[2] - z, l = Math.hypot(dx, dz) || 1; pts.push([q[0] + dx / l * 0.012 * side, q[1] + 0.012 * (1 - side), q[2] + dz / l * 0.012 * side]); }
          for (const e of [0, pts.length - 1]) { const q = pts[e], sg = e ? 1 : -1, peg = acrossZ ? [q[0], 0.05, z + sg * (hd * PRO[0][1] + 0.22)] : [x + sg * (hw * PRO[0][1] + 0.22), 0.05, q[2]];
            if (e) pts.push(peg); else pts.unshift(peg);
            beamPQ('wood', [peg[0], -0.02, peg[2]], vadd(peg, acrossZ ? [0, 0.1, sg * 0.04] : [sg * 0.04, 0.1, 0]), 0.018, 0.018, { tint: PEG, hi: false }); }
          for (let k = 0; k + 1 < pts.length; k++) tube('cloth', pts[k], pts[k + 1], 0.011, RP); };
        const L = along ? w : d, Sh = along ? d : w;
        for (const fr of [-0.31, 0, 0.31]) rope(fr * L, along); for (const fr of [-0.22, 0.22]) rope(fr * Sh, !along);
      }
    }
    crate(-24.4, 21.6, 1.4, 1.4, 1.35); crate(-28.6, 27.6, 1.2, 1.2, 1.3);
    // the water station (43-47): the tank on its saddles, its trough under a little roof
    { const x = -9.5, z0 = 30.2, z1 = 36.2, r = 1.1, yc = 1.62;
      cyl('paint', 'z', [x, yc, (z0 + z1) / 2], r, z1 - z0, { tint: [0.86, 0.84, 0.66], n: 24 });
      for (const z of [z0 + 1.1, z1 - 1.1]) solid('concrete', x - 0.8, 0, z - 0.35, x + 0.8, 0.62, z + 0.35, { tint: [0.95, 0.93, 0.9] });
      for (const [hw, y0, y1] of [[1.1, 1.05, 2.2], [0.85, 0.75, 2.5], [0.5, 0.56, 2.68]]) ph.addBox([x - hw, y0, z0], [x + hw, y1, z1], { surface: 'metal' });
      solid('steel', x - 2.6, 0.7, 32.6, x - 1.6, 0.9, 34.0, { tint: [0.6, 0.62, 0.62] }); for (const [dx, dz] of [[-2.55, 32.65], [-1.65, 32.65], [-2.55, 33.95], [-1.65, 33.95]]) solid('steel', x + dx - 0.03, 0, dz - 0.03, x + dx + 0.03, 0.7, dz + 0.03, { tint: [0.5, 0.5, 0.5] });
      for (const z of [32.3, 34.3]) solid('steel', x - 2.75, 0, z - 0.04, x - 2.67, 2.6, z + 0.04, { tint: [0.5, 0.5, 0.5] });
      sheet('corrR', [[x - 3.0, 2.7, 32.0], [x - 3.0, 2.7, 34.6], [x - 1.1, 2.5, 34.6], [x - 1.1, 2.5, 32.0]], { tint: [0.95, 0.85, 0.72] });
      block(x - 3.0, 2.4, 32.0, x - 1.1, 3.2, 34.6, 'metal');
      // Stage 4: bands round the tank, a hatch on top, a ladder, the WATER plate, the pipe to the trough and its taps, a hose, a manhole (43-47)
      for (const z of [z0 + 0.04, z0 + 2.0, z1 - 2.0, z1 - 0.04]) cyl('paint', 'z', [x, yc, z], r + 0.015, 0.07, { tint: [0.7, 0.68, 0.54], n: 24, caps: false });
      cyl('steel', 'y', [x, yc + r + 0.04, 34.6], 0.3, 0.1, { tint: [0.5, 0.5, 0.46], n: 16 });
      { const lx = x + r + 0.08, top = yc + 0.55, bend = [x + 0.62, yc + 0.98];
        for (const dz of [-0.2, 0.2]) { beamPQ('galv', [lx, 0, 33.2 + dz], [lx, top, 33.2 + dz], 0.03, 0.03, { tint: [0.72, 0.72, 0.7] }); beamPQ('galv', [lx, top, 33.2 + dz], [bend[0], bend[1], 33.2 + dz], 0.03, 0.03, { tint: [0.72, 0.72, 0.7] }); }
        for (let y = 0.3; y < top; y += 0.3) beamPQ('galv', [lx, y, 33.0], [lx, y, 33.4], 0.022, 0.022, { tint: [0.72, 0.72, 0.7], hi: false }); }
      signQuad(5, [x + r + 0.012, yc + 0.05, 31.7], [1, 0, 0], 1.0, 0.25);
      solid('galv', x - 1.65, 0, 33.25, x - 0.45, 0.1, 33.35, { tint: [0.65, 0.66, 0.64] }); beamPQ('galv', [x - 0.45, 0.05, 33.3], [x - 0.45, 0.58, 33.3], 0.07, 0.07, { tint: [0.65, 0.66, 0.64], hi: false });
      beamPQ('galv', [x - 1.65, 0.05, 33.3], [x - 1.65, 1.21, 33.3], 0.07, 0.07, { tint: [0.65, 0.66, 0.64], hi: false }); solid('galv', x - 1.7, 1.17, 32.7, x - 1.6, 1.25, 33.9, { tint: [0.65, 0.66, 0.64] });
      for (const z of [32.95, 33.3, 33.65]) { beamPQ('steel', [x - 1.65, 1.21, z], [x - 1.86, 1.21, z], 0.025, 0.025, { tint: [0.45, 0.45, 0.43], hi: false }); beamPQ('steel', [x - 1.86, 1.21, z], [x - 1.86, 1.09, z], 0.022, 0.022, { tint: [0.45, 0.45, 0.43], hi: false }); cyl('paint', 'y', [x - 1.65, 1.29, z], 0.035, 0.04, { tint: [0.7, 0.15, 0.1], n: 8 }); }
      { let prev = null; for (let k = 0; k <= 48; k++) { const t = k / 48, a = t * 3 * TAU, rr = 0.14 + 0.3 * t, p = [x - 3.6 + Math.cos(a) * rr, 0.022, 35.0 + Math.sin(a) * rr]; if (prev) beamPQ('tire', prev, p, 0.035, 0.035, { tint: [0.25, 0.5, 0.25], hi: false }); prev = p; } }
      { const ring = (rr, y, col) => bld.face('steel', [...Array(16)].map((_, k) => [-7.2 + Math.cos(-k / 16 * TAU) * rr, y, 30.6 + Math.sin(-k / 16 * TAU) * rr]), [0, 1, 0], [...Array(16)].map((_, k) => [Math.cos(k / 16 * TAU), Math.sin(k / 16 * TAU)]), col, 'r'); ring(0.4, 0.01, [0.35, 0.34, 0.32]); ring(0.34, 0.012, [0.5, 0.48, 0.45]); } }
    // the camo-net yard by the black bunker (10-12): poles, the net, a table, a crate with the second ammunition set
    { for (const [x, z] of [[32.6, -32.2], [39.6, -32.2], [32.6, -25.4], [39.6, -25.4], [36.1, -28.8]]) solid('galv', x - 0.05, 0, z - 0.05, x + 0.05, z === -28.8 ? 3.75 : 3.5, z + 0.05, { tint: [0.7, 0.7, 0.68] });
      { const X0 = 32.4, X1 = 39.8, Z0 = -32.4, Z1 = -25.2, N = 10, h = (x, z) => 3.42 + 0.33 * Math.max(0, 1 - Math.hypot(x - 36.1, z + 28.8) / 3.4) ** 1.6, pt = (i, j) => { const x = lerp(X0, X1, i / N), z = lerp(Z0, Z1, j / N); return [x, h(x, z), z]; };
        // the camo net (10-12): cloth (makeCloths) hung from its five poles, a hand's width of it hanging free past the corner poles all round; its cut-outs let light through
        cloths.push({ nu: 17, nv: 17, slack: 1.006, calm: 0.55, net: true, uv: 3.5, at: (u, v) => { const x = lerp(X0 - 0.3, X1 + 0.3, u), z = lerp(Z0 - 0.3, Z1 + 0.3, v); return [x, h(x, z), z]; }, pinAt: [[32.6, -32.2], [39.6, -32.2], [32.6, -25.4], [39.6, -25.4], [36.1, -28.8], ...[1, 2, 3, 4, 5].flatMap(k => [[32.1, lerp(-32.7, -24.9, k / 6)], [lerp(32.1, 40.1, k / 6), -32.7]])] });     // the five poles, and laced along the wing's wall and the bunker's side
        for (const [x, z, px, pz] of [[39.6, -32.2, 40.9, -32.4], [39.6, -25.4, 40.9, -25.2], [39.6, -25.4, 39.8, -24.1], [32.6, -25.4, 32.6, -24.1]]) { beamPQ('tarp', [x, 3.42, z], [px, 0.03, pz], 0.01, 0.01, { tint: [0.36, 0.34, 0.28], hi: false }); solid('wood', px - 0.025, 0, pz - 0.025, px + 0.025, 0.25, pz + 0.025, { tint: [0.5, 0.42, 0.3] }); } }
      block(32.4, 3.3, -32.4, 39.8, 3.44, -25.2, 'wood').walk = true;      // what holds a player under and on the net: its top follows the cloth (3.42 m, rising to 3.75 m at the middle pole)
      for (const [r, top] of [[2.0, 3.5], [1.07, 3.6], [0.33, 3.7]]) block(36.1 - r, 3.44, -28.8 - r, 36.1 + r, top, -28.8 + r, 'wood').walk = true;
      solid('wood', 33.4, 0.76, -27.6, 35.2, 0.82, -26.8, { tint: [0.7, 0.58, 0.42] }); for (const [x, z] of [[33.5, -27.5], [35.1, -27.5], [33.5, -26.9], [35.1, -26.9]]) solid('steel', x - 0.03, 0, z - 0.03, x + 0.03, 0.76, z + 0.03, { tint: [0.4, 0.4, 0.4] });
      prop('jerry', 33.7, 0.82, -27.45, 34.95, 0.82 + 0.47, -27.05);                    // jerry cans on the table (10-12): drawn only, out of anyone's way
      crate(37.6, -27.4, 1.1, 1.1, 1.2, 0, [0.5, 0.54, 0.4]); solid('paint', 36.6, 0, -30.6, 37.6, 0.7, -29.8, { tint: [0.7, 0.22, 0.14] }); }
    // the dish bunker's generator (8, 9)
    solid('slab', 33.4, 0, -17.8, 34.9, 0.1, -15.6, { tint: [0.9, 0.9, 0.88] }); if (models.genset) cbox(33.5, 0.1, -17.6, 34.8, 1.3, -15.8, 'metal'); else solid('paint', 33.5, 0.1, -17.6, 34.8, 1.3, -15.8, { tint: [0.82, 0.8, 0.72] });
    // jersey barriers in the forecourt and along the fence outside the gate (34-37): a red-and-white trapezoid, a block for players
    const barrier = (x0, z0, x1, z1) => {
      const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0), c = alongX ? (z0 + z1) / 2 : (x0 + x1) / 2, a = alongX ? Math.min(x0, x1) : Math.min(z0, z1), b = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
      const S = [[-0.31, 0], [0.31, 0], [0.24, 0.12], [0.1, 0.36], [0.09, 0.81], [-0.09, 0.81], [-0.1, 0.36], [-0.24, 0.12]];
      const at = (u, s, y) => (alongX ? [u, y, c + s] : [c + s, y, u]);
      for (let k = 0; k < S.length; k++) { const [s0, y0] = S[k], [s1, y1] = S[(k + 1) % S.length]; if (y0 === 0 && y1 === 0) continue;
        const Q = [at(a, s0, y0), at(b, s0, y0), at(b, s1, y1), at(a, s1, y1)], nn = vnorm(alongX ? [0, s1 - s0, -(y1 - y0)] : [-(y1 - y0), s1 - s0, 0]);
        bld.face('concrete', Q, vlen(nn) ? vscale(nn, Math.sign(nn[1] || 1) * (y0 + y1 > 0 ? 1 : 1)) : [0, 1, 0], Q.map(p => [alongX ? p[0] : p[2], p[1] + (alongX ? p[2] : p[0])]), Q.map(p => { const u = alongX ? p[0] : p[2], red = (Math.floor(u / 0.6) & 1) && p[1] > 0.15; return red ? [0.74, 0.26, 0.2] : [1.05, 1.03, 0.98]; }), 'cr'); }
      for (const u of [a, b]) { const ring = S.map(([s, y]) => at(u, s, y)); bld.face('concrete', ring, alongX ? [u === a ? -1 : 1, 0, 0] : [0, 0, u === a ? -1 : 1], ring.map(p => [alongX ? p[2] : p[0], p[1]]), [1.0, 0.98, 0.94], 'cr'); }
      ph.addBox(alongX ? [a, 0, c - 0.31] : [c - 0.31, 0, a], alongX ? [b, 0.81, c + 0.31] : [c + 0.31, 0.81, b], { surface: 'concrete' });
    };
    for (let z = 3.6; z < 17.5; z += 3.5) barrier(-59.5, z, -59.5, Math.min(17.6, z + 3.0));
    barrier(-59.0, 3.4, -56.2, 3.4); barrier(-58.8, 17.6, -55.8, 17.6); barrier(-55.4, 17.6, -52.4, 17.6);
    // the yard office's cabinet and counter (34-36), lamps by the gate and at the hangars' corners, power poles
    { // the yard office's electrical cabinet (34-36, 120): a steel case on a concrete plinth, its lid overhanging, two doors with a seam,
      // handles and hinges, louvres low down, a warning label, the conduit into the ground
      const X0 = -54.58, X1 = -54.02, Z0 = 7.0, Z1 = 7.9, GR = [0.6, 0.64, 0.6], DK = [0.22, 0.23, 0.22];
      solid('slab', X0 - 0.06, 0, Z0 - 0.06, X1 + 0.02, 0.12, Z1 + 0.06, { tint: [0.92, 0.9, 0.86] });
      solid('paint', X0, 0.12, Z0, X1, 1.62, Z1, { tint: GR });
      deco('paint', X0 - 0.05, 1.62, Z0 - 0.05, X1 + 0.02, 1.68, Z1 + 0.05, { tint: vscale(GR, 0.92), hi: false });
      draw('steel', X0 - 0.003, 0.2, (Z0 + Z1) / 2 - 0.006, X0, 1.56, (Z0 + Z1) / 2 + 0.006, { tint: DK, flat: true, faces: 'w' });
      for (const z of [Z0 + 0.06, Z1 - 0.06]) for (const y of [0.42, 1.3]) draw('steel', X0 - 0.02, y, z - 0.015, X0, y + 0.1, z + 0.015, { tint: DK, flat: true });
      for (const z of [(Z0 + Z1) / 2 - 0.07, (Z0 + Z1) / 2 + 0.07]) { draw('steel', X0 - 0.04, 0.9, z - 0.012, X0, 1.06, z + 0.012, { tint: [0.15, 0.15, 0.15], flat: true }); draw('steel', X0 - 0.045, 0.95, z - 0.03, X0 - 0.03, 1.01, z + 0.03, { tint: [0.15, 0.15, 0.15], flat: true }); }
      for (const [za, zb] of [[Z0 + 0.1, (Z0 + Z1) / 2 - 0.08], [(Z0 + Z1) / 2 + 0.08, Z1 - 0.1]]) for (let k = 0; k < 5; k++) { const y = 0.25 + k * 0.05, Q = [[X0 - 0.002, y, za], [X0 - 0.002, y, zb], [X0 - 0.002, y + 0.025, zb], [X0 - 0.002, y + 0.025, za]]; bld.face('grille', Q, [-1, 0, 0], Q.map(q => [q[2], q[1]]), [1, 1, 1], 'r'); }
      { const z = Z0 + 0.22, y = 1.36, Q = [[X0 - 0.003, y - 0.07, z - 0.075], [X0 - 0.003, y - 0.07, z + 0.075], [X0 - 0.003, y + 0.07, z]]; bld.face('paint', Q, [-1, 0, 0], Q.map(q => [q[2], q[1]]), [1.6, 1.25, 0.1], 'r');
        const Q2 = [[X0 - 0.004, y - 0.03, z - 0.006], [X0 - 0.004, y - 0.03, z + 0.006], [X0 - 0.004, y + 0.03, z + 0.006], [X0 - 0.004, y + 0.03, z - 0.006]]; bld.face('paint', Q2, [-1, 0, 0], Q2.map(q => [q[2], q[1]]), [0.05, 0.05, 0.05], 'r'); }
      tube('galv', [(X0 + X1) / 2, 0.12, Z1 - 0.12], [(X0 + X1) / 2, -0.05, Z1 - 0.12], 0.035, { tint: [0.6, 0.6, 0.58], n: 8 });
    }
    { // the counter under the delivery window: a plank with a steel lip on two brackets, a clipboard and a mug on it
      trim('wood', -54.35, 0.95, 8.0, -54.0, 1.0, 9.2, { tint: [0.62, 0.5, 0.34] });
      draw('steel', -54.37, 0.93, 8.0, -54.35, 1.005, 9.2, { tint: [0.3, 0.3, 0.29], flat: true, faces: 'wtb' });
      for (const z of [8.15, 9.05]) { const P = [[-54.0, 0.95, z], [-54.3, 0.95, z], [-54.0, 0.68, z]]; for (const sg of [-1, 1]) bld.face('steel', P, [0, 0, sg], P.map(q => [q[0], q[1]]), [0.3, 0.3, 0.29], 'r'); }
      draw('paint', -54.3, 1.0, 8.3, -54.08, 1.006, 8.62, { tint: [1.3, 1.28, 1.2], flat: true, faces: 'wenst' }); draw('steel', -54.27, 1.006, 8.42, -54.22, 1.016, 8.5, { tint: [0.2, 0.2, 0.2], flat: true });
      cyl('paint', 'y', [-54.17, 1.045, 8.95], 0.04, 0.09, { tint: [0.75, 0.2, 0.14], n: 12 }); }
    // a flood-light pole (34-37, 49): a round pole in two sections on a bolted base plate, a cross arm, two heads tipped down and
    // out, each with a lens, a visor and a yoke; the control box at chest height
    const lamp = (x, z, h = 6.5) => { cbox(x - 0.07, 0, z - 0.07, x + 0.07, h, z + 0.07, 'metal');
      const GV = [0.6, 0.6, 0.58], DK = { tint: [0.3, 0.3, 0.3], hi: false };
      cyl('galv', 'y', [x, 0.02, z], 0.19, 0.04, { tint: vscale(GV, 0.8), n: 8 });
      for (let k = 0; k < 4; k++) cyl('steel', 'y', [x + Math.cos(k * TAU / 4 + 0.78) * 0.14, 0.06, z + Math.sin(k * TAU / 4 + 0.78) * 0.14], 0.018, 0.05, { tint: [0.3, 0.3, 0.3], n: 6 });
      cyl('galv', 'y', [x, 1.5, z], 0.085, 3.0, { tint: GV, n: 10, caps: false }); cyl('galv', 'y', [x, 3.0 + (h - 3.0) / 2, z], 0.062, h - 3.0, { tint: GV, n: 10 });
      cyl('galv', 'y', [x, 3.0, z], 0.096, 0.09, { tint: vscale(GV, 0.85), n: 10 });
      beamPQ('galv', [x, h - 0.12, z - 0.52], [x, h - 0.12, z + 0.52], 0.07, 0.07, { tint: GV, hi: false });
      for (const s of [-1, 1]) { const c = [x, h + 0.06, z + s * 0.42], fw = vnorm([0, -0.62, s * 0.78]), up = vnorm([0, 0.78, s * 0.62]), sv = [1, 0, 0];
        obox('steel', c, vscale(fw, 0.11), vscale(sv, 0.21), vscale(up, 0.15), { tint: [0.2, 0.2, 0.2], hi: false });
        const lc = vadd(c, fw, 0.113), P = [vadd(vadd(lc, sv, -0.18), up, -0.12), vadd(vadd(lc, sv, 0.18), up, -0.12), vadd(vadd(lc, sv, 0.18), up, 0.12), vadd(vadd(lc, sv, -0.18), up, 0.12)];
        bld.face('paint', P, fw, P.map(q => [q[0], q[2]]), [1.7, 1.65, 1.45], 'r');
        obox('steel', vadd(vadd(c, fw, 0.16), up, 0.158), vscale(fw, 0.07), vscale(sv, 0.22), vscale(up, 0.008), { tint: [0.16, 0.16, 0.16], hi: false });
        for (const e of [-1, 1]) { beamPQ('steel', [x + e * 0.235, h - 0.1, z + s * 0.42], vadd(c, sv, e * 0.235), 0.025, 0.025, DK); beamPQ('steel', [x + e * 0.235, h - 0.1, z + s * 0.42], [x, h - 0.1, z + s * 0.42], 0.025, 0.025, DK); }
        hiBox(x - 0.24, h - 0.15, z + s * 0.42 - 0.22, x + 0.24, h + 0.26, z + s * 0.42 + 0.22, 'metal'); }
      draw('paint', x - 0.12, 1.0, z - 0.19, x + 0.12, 1.4, z - 0.07, { tint: [0.55, 0.56, 0.54] }); };
    lamp(-50.5, 9.3); lamp(-50.5, 17.2); lamp(5.6, 13.4); lamp(5.6, 37.6); lamp(26.4, 13.4);
    { /* the power line (5, 6, 20, 55): in from the desert to the north, pole to pole across the yard, drops to the barracks, the
         east wing and the generator pad's POWER cabinet. Each pole's arm stands square to the line; wires sag between insulators. */
      const LINE = [[-44, -47.5, false], [-44, -24, true], [-2, -13.5, true], [16, -15, true], [17, 5.6, true]], wood = { tint: [0.5, 0.4, 0.3] }, tips = [];
      LINE.forEach(([x, z, inside], k) => { const a = LINE[Math.max(0, k - 1)], b = LINE[Math.min(LINE.length - 1, k + 1)], d = vnorm([b[0] - a[0], 0, b[1] - a[1]]), pr = [-d[2], 0, d[0]];
        (inside ? solid : deco)('wood', x - 0.12, 0, z - 0.12, x + 0.12, 9.5, z + 0.12, wood);
        beamPQ('wood', [x - pr[0] * 1.1, 8.68, z - pr[2] * 1.1], [x + pr[0] * 1.1, 8.68, z + pr[2] * 1.1], 0.1, 0.14, wood);
        for (const sg of [-1, 1]) beamPQ('steel', [x, 8.05, z], [x + pr[0] * 0.7 * sg, 8.62, z + pr[2] * 0.7 * sg], 0.04, 0.02, { tint: [0.35, 0.35, 0.33], hi: false });
        const t = [-0.95, 0, 0.95].map(f => [x + pr[0] * f, f === 0 ? 9.66 : 8.9, z + pr[2] * f]); t.forEach(p => cyl('paint', 'y', [p[0], p[1] - 0.08, p[2]], 0.045, 0.16, { tint: [0.55, 0.62, 0.55], n: 8 })); tips.push(t); });
      const wire = (A, B, sag) => { let prev = A; for (let k = 1; k <= 12; k++) { const f = k / 12, p = [lerp(A[0], B[0], f), lerp(A[1], B[1], f) - 4 * sag * f * (1 - f), lerp(A[2], B[2], f)]; beamPQ('steel', prev, p, 0.018, 0.018, { tint: [0.2, 0.2, 0.2], hi: false }); prev = p; } };
      for (let k = 0; k + 1 < tips.length; k++) for (let j = 0; j < 3; j++) wire(tips[k][j], tips[k + 1][j], 0.55);
      { const [x, z] = [17, 5.6]; cyl('paint', 'y', [x + 0.42, 7.3, z], 0.3, 0.8, { tint: [0.62, 0.64, 0.62], n: 14 }); for (const y of [7.0, 7.6]) beamPQ('steel', [x, y, z], [x + 0.2, y, z], 0.06, 0.04, { tint: [0.35, 0.35, 0.33], hi: false }); wire([x + 0.42, 7.55, z], [21.15, 1.8, 8.35], 0.15); }
      for (const [k, to] of [[3, [21.5, 6.0, -15.0]], [2, [-2.0, 6.4, -23.0]]]) { wire(tips[k][1], to, 0.4); deco('steel', to[0] - 0.08, to[1] - 0.08, to[2] - 0.08, to[0] + 0.08, to[1] + 0.08, to[2] + 0.08, { tint: [0.3, 0.3, 0.3], hi: false }); }
    }
    // the windsock (4, 7)
    { solid('galv', 40.95, 0, 8.95, 41.05, 6, 9.05, { tint: [0.85, 0.85, 0.85] }); solid('concrete', 40.75, 0, 8.75, 41.25, 0.15, 9.25, { tint: [0.95, 0.93, 0.9] });
      beamPQ('galv', [41.0, 5.75, 9], [41.25, 5.75, 9], 0.04, 0.04, { tint: [0.85, 0.85, 0.85], hi: false }); }   // the sock itself swings (level(): windsock)

    /* ================================================================== Stage 4: acacias, and the marks on the ground (13, 16, 22, 45, 2)
       An acacia: a trunk that stops players and shots, forking above head height into limbs (shots only) and a flat crown
       of leaf sprays that stop nothing. On the ground: tyre tracks curving where the trucks turn, darker gravel and oil
       under the parked trucks, oil, cracks, joints and two yellow lines on the apron. */
    function acacia(x, z, sc, seed) {
      if (models.acacia) {      // the model, 4 m tall, its narrower side toward the wall; the trunk stays the only thing in the way
        const k = sc * 4.0 / models.acacia.man.size[1]; modelsPlaced.push({ id: 'acacia', x, y: 0, z, yaw: 0, s: [k, k, k] });
        ph.addBox([x - 0.15 * sc, 0, z - 0.15 * sc], [x + 0.15 * sc, 1.95 * sc, z + 0.15 * sc], { surface: 'wood' }); return; }
      const r = rng(seed), bark = { tint: [0.4, 0.34, 0.28] }, fork = [x + (r() - 0.5) * 0.3, 1.95 * sc, z + (r() - 0.5) * 0.3];
      cyl('wood', 'y', [x, 0.98 * sc, z], 0.15 * sc, 1.96 * sc, { tint: [0.4, 0.34, 0.28], n: 10 }); beamPQ('wood', [x, 1.8 * sc, z], fork, 0.24 * sc, 0.24 * sc, bark);
      ph.addBox([x - 0.15 * sc, 0, z - 0.15 * sc], [x + 0.15 * sc, 1.95 * sc, z + 0.15 * sc], { surface: 'wood' });
      const ends = [], nL = 4 + (r() < 0.5 ? 1 : 0), a0 = r() * TAU;
      for (let k = 0; k < nL; k++) { const a = a0 + k / nL * TAU + (r() - 0.5) * 0.5, L = (1.5 + r() * 0.7) * sc, mid = [fork[0] + Math.cos(a) * L, (3.0 + r() * 0.35) * sc, fork[2] + Math.sin(a) * L];
        beamPQ('wood', fork, mid, 0.13 * sc, 0.13 * sc, bark);
        for (let j = 0; j < 3; j++) { const b = a + (j - 1) * 0.55 + (r() - 0.5) * 0.3, l2 = (0.7 + r() * 0.7) * sc, e = [mid[0] + Math.cos(b) * l2, (3.55 + r() * 0.35) * sc, mid[2] + Math.sin(b) * l2]; beamPQ('wood', mid, e, 0.06 * sc, 0.06 * sc, { ...bark, hi: false }); ends.push(e); } }
      for (const e of ends) for (let k = 0; k < 7; k++) {   // leaf sprays, mostly level: the flat top the trees have
        const c = [e[0] + (r() - 0.5) * 1.1 * sc, e[1] + (r() - 0.3) * 0.45 * sc, e[2] + (r() - 0.5) * 1.1 * sc], R = (0.55 + r() * 0.45) * sc, t = r() * TAU, tilt = (r() - 0.5) * 0.5, u = [Math.cos(t) * R, Math.sin(tilt) * R, Math.sin(t) * R], v = [-Math.sin(t) * R, Math.sin(-tilt * 0.7) * R * 0.6, Math.cos(t) * R];
        const Q = [vsub(vsub(c, u), v), vsub(vadd(c, u), v), vadd(vadd(c, u), v), vadd(vsub(c, u), v)], g = 0.85 + r() * 0.3;
        bld.face('acacia', Q, [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [g, g, g * 0.95], 'cr'); }
    }
    acacia(10.8, -19.4, 1.0, 71); acacia(-31.5, -17.9, 1.08, 72); acacia(-41.5, -22.2, 0.9, 73);   // far enough from the walls and the balcony that no limb reaches them
    { const r = rng(9090);
      const onApron = (x, z) => x > -6.1 && x < 6.0 && z > 12.1 && z < 38.9;
      const clear = (x, z) => inPlay(x, z, 0.6) && !footprints.some(f => x > f.at[0] - 0.3 && x < f.at[2] + 0.3 && z > f.at[1] - 0.3 && z < f.at[3] + 0.3)
        && !ph.boxes.some(b => !b.bulletOnly && b.min.y < 0.3 && b.max.y > 0.05 && x > b.min.x - 0.1 && x < b.max.x + 0.1 && z > b.min.z - 0.1 && z < b.max.z + 0.1);   // nothing standing on it
      // a band along a polyline on the ground; v runs along it in metres (times uvs), so a texture repeats along the band
      const strip = (pts, w, y, mat, col, uvs = 2) => { let acc = 0;
        for (let k = 0; k + 1 < pts.length; k++) { const [ax, az] = pts[k], [bx, bz] = pts[k + 1], L = Math.hypot(bx - ax, bz - az); if (!L) continue;
          if (!clear(ax, az) || !clear(bx, bz) || onApron(ax, az) !== onApron(bx, bz)) { acc += L; continue; }
          const nx = -(bz - az) / L * w / 2, nz = (bx - ax) / L * w / 2, yy = onApron(ax, az) ? 0.0262 : y, Q = [[ax - nx, yy, az - nz], [bx - nx, yy, bz - nz], [bx + nx, yy, bz + nz], [ax + nx, yy, az + nz]];
          bld.face(mat, Q, [0, 1, 0], [[0, acc * uvs], [0, (acc + L) * uvs], [1, (acc + L) * uvs], [1, acc * uvs]], col, 'r'); acc += L; } };
      // the yard's wheel tracks and its darker gravel: one picture over the whole yard (makeMaterials paints it from TRACKS), a few millimetres up
      { const [X0, Z0, X1, Z1] = TRACK_RECT, y = 0.0085; bld.face('tracks', [[X0, y, Z0], [X1, y, Z0], [X1, y, Z1], [X0, y, Z1]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1], 'r'); }
      const blob = (x, z, sx, sz, rot, col) => { const c = Math.cos(rot), sn = Math.sin(rot), y = onApron(x, z) ? 0.0265 : 0.0095, P = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + a * sx * c - b * sz * sn, y, z + a * sx * sn + b * sz * c]); bld.face('stain', P, [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], col, 'r'); };
      /* Standing water and wet mud: where the wash bay's hose runs off over the apron, round the water tank's tap and trough, and in
         the deepest of the yard's wheel ruts. Each is a patch of dark wet earth (it shines a little) with the water lying in its
         middle; the water itself is drawn by makePuddles, which mirrors the yard in it. */
      for (const [x, z, rx, rz, rot] of [[2.5, 33.4, 1.5, 0.9, 0.3], [-1.6, 30.2, 1.1, 0.6, 1.2], [3.9, 29.0, 0.75, 0.45, 2.0], [-3.8, 35.3, 0.9, 0.5, 0.6],
        [-12.6, 33.3, 1.3, 0.8, 0.2], [-11.4, 30.4, 0.75, 0.45, 1.0], [-8.4, 28.9, 0.85, 0.5, 2.2],
        [-21, 6.3, 3.4, 1.4, 0.3], [-33, 9.8, 3.0, 1.2, 0.25], [-7.6, 14.6, 1.8, 0.8, 1.05], [-27.5, -4.6, 2.1, 0.85, 0.9], [-45.6, 12.6, 1.5, 0.75, 0.1], [0, -13.2, 3.2, 1.3, 0.0], [14, -3.6, 1.7, 0.7, 0.9],
        [-2.2, -15.2, 0.5, 0.35, 0.5], [19.2, -2.6, 0.7, 0.4, 0.4],
        // more (he asked): the rest of the yard's low places, the kerb under the barracks' air conditioners, the alleys, the forecourt, the apron
        [-36, -3, 3.0, 1.3, 1.2], [-12, -9.5, 1.8, 0.7, 0.2], [6.5, 2.5, 3.2, 1.3, 0.6], [-24, 12.4, 1.5, 0.6, 1.5], [-3, 6.5, 1.6, 0.7, 2.0], [15.5, 9.5, 1.4, 0.6, 0.3], [-40, -14, 1.7, 0.7, 0.8], [28, 9.5, 1.5, 0.6, 0.1], [40.5, -4, 1.6, 0.7, 1.5], [-26.5, 31.5, 1.8, 0.8, 0.4], [-15, 34.5, 1.4, 0.6, 1.0],
        [-27, -19.3, 1.2, 0.5, 0.05], [2, -19.5, 1.0, 0.45, 0.1], [-12, -38.6, 1.6, 0.7, 0.05], [26, -40.3, 1.3, 0.5, 0.0], [33.9, -14.5, 0.9, 0.5, 1.55], [41, -29, 1.3, 0.6, 0.7], [-57.5, 6.2, 1.2, 0.6, 0.3],
        [-4.5, 20, 1.0, 0.6, 0.4], [1.5, 15.3, 0.8, 0.45, 1.1], [4.2, 24.5, 0.9, 0.5, 2.2],
        // larger (he asked, 24 Nov: "more puddles, larger"): the wide hollows a wet season leaves
        [-26, 2.5, 3.4, 1.5, 0.4], [-10, 0.5, 3.8, 1.7, 1.1], [8, -16, 3.2, 1.4, 0.2], [36, 8, 3.0, 1.3, 1.2], [-30, -14, 3.4, 1.5, 0.1], [16, -10, 2.8, 1.2, 2.4], [30, 24, 3.0, 1.3, 0.6],
        [-40, 30, 2.8, 1.2, 1.0], [44, 12, 2.6, 1.2, 1.8], [-14, 12.5, 3.0, 1.3, 2.6], [-2, -2.5, 2.8, 1.2, 0.3], [-20, -12.5, 3.0, 1.3, 2.8],
        [38, 30, 2.8, 1.2, 0.2], [-41, 6, 3.3, 1.45, 0.3],
        [-24.5, 22.5, 3.3, 1.45, 0.3], [-15.5, 22.5, 2.9, 1.3, 0.3], [-18.5, -4.5, 3.3, 1.45, 0.3], [-14, -18, 3.1, 1.35, 0.3], [4, 10.5, 3.3, 1.45, 1.2], [5.5, -6, 3.2, 1.4, 2.1], [16, -18, 3.3, 1.45, 0.3],
        [26.5, 10.5, 3.3, 1.45, 1.2], [29.5, 33, 3.0, 1.3, 1.2], [34, 16.5, 3.3, 1.45, 0.3], [35.5, -22.5, 3.0, 1.3, 1.2], [41.5, 21, 3.3, 1.45, 0.3], [-47, 0, 3.0, 1.3, 1.2], [-39.5, -25.5, 3.1, 1.35, 0.3],
        [13, -36, 3.0, 1.3, 0.3], [-35, 37.5, 3.3, 1.45, 0.3]]) {
        { const c0 = Math.cos(rot), s0 = Math.sin(rot), rim = [...Array(10)].map((_, k) => { const a = k / 10 * TAU, u = Math.cos(a) * rx * 1.15, v = Math.sin(a) * rz * 1.15; return [x + u * c0 - v * s0, z + u * s0 + v * c0]; });
          if (!clear(x, z) || rim.some(([px, pz]) => !clear(px, pz) || onApron(px, pz) !== onApron(x, z))) continue; }     // all of the water on open ground, and all on the apron or all off it
        const ap = onApron(x, z), c = Math.cos(rot), sn = Math.sin(rot), y = ap ? 0.0268 : 0.0098, k = 1.95, P = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + a * rx * k * c - b * rz * k * sn, y, z + a * rx * k * sn + b * rz * k * c]);
        bld.face('mud', P, [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], ap ? [0.1, 0.1, 0.095] : [0.11, 0.085, 0.06], 'r');      // damp earth: darker than the dust, never black
        puddles.push({ x, z, y: y + 0.0008, rx, rz, rot, seed: Math.round(x * 31 + z * 17) });
      }
      for (const [x, z, sx, sz] of [[-31, -1, 1.9, 6.6], [-13.5, 7, 4.7, 1.7], [-12.6, 16.4, 4.7, 1.7], [-17, 23, 1.25, 2.9], [-10.5, 24.5, 1.25, 2.9], [-39.7, 12.5, 1.8, 0.95], [-42, -6, 1.6, 5.4], [17.7, -4.5, 2.3, 1.2], [37.6, 5.8, 2.4, 1.5]]) blob(x, z, sx, sz, 0, [0.12, 0.1, 0.085]);   // darker gravel where they stand (vertex colours are linear: these are dark)
      for (const [x, z] of [[-31, 4.0], [-31, 1.9], [-17.0, 7.0], [-15.3, 18.15], [-17, 21.3], [-10.5, 22.8], [-40.7, 12.5], [-42, -2.6]]) blob(x, z, 0.45 + r() * 0.3, 0.35 + r() * 0.2, r() * 3, [0.02, 0.018, 0.015]);   // oil under the engines
      for (let k = 0; k < 16; k++) { const x = lerp(-5.4, 5.3, r()), z = lerp(12.8, 38.2, r()), sz = 0.3 + r() * 0.9; blob(x, z, sz, sz * (0.6 + r() * 0.5), r() * 3, [0.03, 0.026, 0.022]); }   // and on the apron
      for (let k = 0; k < 14; k++) { let x = lerp(-5.4, 5.3, r()), z = lerp(12.8, 38.2, r()), a = r() * TAU; const pts = [[x, z]]; for (let j = 0; j < 10; j++) { a += (r() - 0.5) * 0.9; x += Math.cos(a) * 0.35; z += Math.sin(a) * 0.35; if (!onApron(x, z)) break; pts.push([x, z]); } strip(pts, 0.018 + r() * 0.012, 0, 'line', [0.05, 0.045, 0.04]); }
      for (let z = 16; z < 39; z += 4) strip([[-5.9, z], [5.6, z]], 0.02, 0, 'line', [0.12, 0.115, 0.11]);
      for (const x of [-2.0, 2.0]) strip([[x, 12.4], [x, 38.6]], 0.07, 0, 'line', [0.62, 0.5, 0.16]);
      for (const x of [-4.2, 0.6, 4.0]) strip([[x, 12.1], [x, 38.9]], 0.02, 0, 'line', [0.12, 0.115, 0.11]);
    }

    /* ================================================================== Stage 3: the buildings' outsides (1, 4-19)
       Within reach, a piece on a wall stops players (split AC units, lamps, canopies, cabinets, downpipes); a flat piece no
       more than 4 cm proud (shutters, conduits, the string course) stops shots only, so it is never a ledge; up high it is
       drawn and stops shots as triangles. A piece goes only where nothing else is: not over an opening, a porch, the
       balcony, a kerb, a vehicle or another building, so this runs after everything else is built. */
    {
      const rd = rng(3303), SH = [0.42, 0.5, 0.45], ACW = [0.9, 0.9, 0.86], GP = [0.74, 0.73, 0.69];
      const P3 = (s, u, y, d) => (s.alongX ? [u, y, s.face + s.out * d] : [s.face + s.out * d, y, u]);
      const N3 = s => (s.alongX ? [0, 0, s.out] : [s.out, 0, 0]);
      const span = (s, u0, y0, d0, u1, y1, d1) => { const p = P3(s, u0, y0, d0), q = P3(s, u1, y1, d1); return [Math.min(p[0], q[0]), Math.min(y0, y1), Math.min(p[2], q[2]), Math.max(p[0], q[0]), Math.max(y0, y1), Math.max(p[2], q[2])]; };
      const free = bx => !ph.boxes.some(c => c.min.x < bx[3] - 0.01 && c.max.x > bx[0] + 0.01 && c.min.y < bx[4] - 0.01 && c.max.y > bx[1] + 0.01 && c.min.z < bx[5] - 0.01 && c.max.z > bx[2] + 0.01);
      const fits = (s, u0, y0, d0, u1, y1, d1) => free(span(s, u0, y0, d0, u1, y1, d1));
      const stairBusy = (s, u0, u1) => ROOF_STAIRS.some(st => { if (st.b !== s.b.id || st.side !== s.side) return false; const [a, c] = stairTop(st), lo = Math.min(st.u0, a) - 0.45, hi = Math.max(st.u0, c) + 0.45; return u1 > lo && u0 < hi; });   // the flight and its landing, with room to pass
      const onWall = (s, u0, u1, y0, y1, own) => !stairBusy(s, u0, u1) && u0 > s.lo + 0.25 && u1 < s.hi - 0.25 && !s.holes.some(h => h !== own && u1 > h.u0 - 0.12 && u0 < h.u1 + 0.12 && y1 > h.v0 - 0.12 && y0 < h.v1 + 0.12) && !covered(...P3(s, (u0 + u1) / 2, (y0 + y1) / 2, 0.4));
      // a box on a side, by reach: solid, or flat (shots only), or drawn only, or high (drawn, shots stop at its triangles)
      const put = (s, mat, u0, y0, d0, u1, y1, d1, o = {}, how) => { const bx = span(s, u0, y0, d0, u1, y1, d1); (how === 'flat' ? trim : how === 'draw' ? draw : bx[1] >= 3.2 ? deco : solid)(mat, ...bx, o); return bx; };
      const quad = (s, mat, u0, y0, u1, y1, d, col = [1, 1, 1]) => { const P = [P3(s, u0, y0, d), P3(s, u1, y0, d), P3(s, u1, y1, d), P3(s, u0, y1, d)]; bld.face(mat, P, N3(s), P.map(p => [s.alongX ? p[0] : p[2], p[1]]), col, 'cr'); };
      const disc = (s, mat, u, y, r, d, col = [1, 1, 1], n = 18) => { const P = []; for (let k = 0; k < n; k++) { const a = k / n * TAU; P.push(P3(s, u + Math.cos(a) * r, y + Math.sin(a) * r, d)); } bld.face(mat, P, N3(s), P.map(p => [s.alongX ? p[0] : p[2], p[1]]), col, 'cr'); };
      const lens = (s, u, y, w, d0, d1) => { const P = [P3(s, u - w, y, d0), P3(s, u + w, y, d0), P3(s, u + w, y, d1), P3(s, u - w, y, d1)]; bld.face('paint', P, [0, -1, 0], P.map(p => [p[0], p[2]]), [1.55, 1.5, 1.3], 'r'); };
      const ground = (s, u) => { const g = P3(s, u, 0, 0.35); return ph.groundHeight(g[0], g[2], 0.5); };

      // the AC unit model in a box on a side, its fan outward; the box is its collision, by reach as put() would make it
      const AC_FRONT = 0;       // quarter turns from the model's +x to its fan
      function acModel(s, u0, y0, d0, u1, y1, d1) {
        if (!models.acunit) return false;
        const bx = span(s, u0, y0, d0, u1, y1, d1), n = N3(s), q = n[0] > 0.5 ? 0 : n[2] < -0.5 ? 1 : n[0] < -0.5 ? 2 : 3;
        if (bx[1] >= 3.2) hiBox(...bx, 'metal'); else cbox(...bx, 'metal');
        return prop('acunit', ...bx, (q + AC_FRONT) & 3);
      }
      // an outdoor AC unit on two brackets, its fan behind a guard, its pipes into the wall (5, 12, 13)
      function splitAC(s, u, y) {
        if (!onWall(s, u - 0.5, u + 0.56, y - 0.08, y + 0.95) || !fits(s, u - 0.5, y - 0.08, 0.005, u + 0.56, y + 0.62, 0.44)) return false;
        const low = y < 3.2;
        if (!acModel(s, u - 0.43, y, 0.1, u + 0.43, y + 0.58, 0.4)) {
        put(s, 'paint', u - 0.43, y, 0.1, u + 0.43, y + 0.58, 0.4, { tint: ACW });
        disc(s, 'grille', u - 0.1, y + 0.29, 0.21, 0.402);
        for (let k = -2; k <= 2; k++) quad(s, 'paint', u - 0.31, y + 0.29 + k * 0.08 - 0.006, u + 0.11, y + 0.29 + k * 0.08 + 0.006, 0.404, [0.78, 0.78, 0.75]);
        for (let k = 0; k < 6; k++) quad(s, 'steel', u + 0.18, y + 0.1 + k * 0.065, u + 0.38, y + 0.13 + k * 0.065, 0.402, [0.55, 0.55, 0.53]); }
        for (const du of [-0.3, 0.3]) put(s, 'steel', u + du - 0.02, y - 0.06, 0, u + du + 0.02, y, 0.42, { tint: [0.4, 0.4, 0.38] }, low ? 'flat' : 'draw');
        put(s, 'galv', u + 0.43, y + 0.12, 0.14, u + 0.52, y + 0.2, 0.22, { tint: GP }, 'draw');
        put(s, 'galv', u + 0.46, y + 0.2, 0.005, u + 0.52, y + 0.9, 0.06, { tint: GP }, low ? 'flat' : 'draw');
        return true;
      }
      // a condenser on the sidewalk against the wall, on a little plinth
      function condenser(s, u) {
        const y0 = ground(s, u);
        if (!onWall(s, u - 0.55, u + 0.55, 0, 0.9) || !fits(s, u - 0.52, y0 + 0.005, 0.1, u + 0.52, y0 + 0.75, 0.6)) return false;
        put(s, 'slab', u - 0.5, y0, 0.12, u + 0.5, y0 + 0.08, 0.58, { tint: [0.82, 0.81, 0.78] });
        if (!acModel(s, u - 0.45, y0 + 0.08, 0.15, u + 0.45, y0 + 0.7, 0.52)) {
        put(s, 'paint', u - 0.45, y0 + 0.08, 0.15, u + 0.45, y0 + 0.7, 0.52, { tint: [0.86, 0.86, 0.82] });
        disc(s, 'grille', u - 0.1, y0 + 0.39, 0.22, 0.522);
        for (let k = -2; k <= 2; k++) quad(s, 'paint', u - 0.32, y0 + 0.39 + k * 0.085 - 0.006, u + 0.12, y0 + 0.39 + k * 0.085 + 0.006, 0.524, [0.78, 0.78, 0.75]); }
        put(s, 'galv', u + 0.3, y0 + 0.5, 0.005, u + 0.36, y0 + 1.6, 0.06, { tint: GP }, 'flat');
        return true;
      }
      // a downpipe from the roof's edge: a hopper head, clips, a shoe turned out at the foot
      function downpipe(s, u, top) {
        const y0 = ground(s, u);
        if (!onWall(s, u - 0.2, u + 0.2, 0, 0.1) || s.holes.some(h => u + 0.2 > h.u0 - 0.1 && u - 0.2 < h.u1 + 0.1) || !fits(s, u - 0.1, y0 + 0.005, 0.06, u + 0.1, top - 0.6, 0.2)) return false;
        put(s, 'galv', u - 0.055, y0 + 0.14, 0.06, u + 0.055, top - 0.62, 0.17, { tint: GP });
        put(s, 'galv', u - 0.07, y0, 0.05, u + 0.07, y0 + 0.14, 0.34, { tint: GP });
        put(s, 'galv', u - 0.17, top - 0.66, 0.02, u + 0.17, top - 0.36, 0.32, { tint: vscale(GP, 0.92) });
        put(s, 'galv', u - 0.06, top - 0.36, 0.005, u + 0.06, top + 0.02, 0.14, { tint: vscale(GP, 0.9) }, 'draw');
        for (let y = y0 + 0.9; y < top - 1; y += 1.7) put(s, 'steel', u - 0.08, y, 0.005, u + 0.08, y + 0.04, 0.19, { tint: [0.45, 0.45, 0.43] }, 'draw');
        return true;
      }
      function wallLamp(s, u, y) {
        if (!onWall(s, u - 0.15, u + 0.15, y - 0.05, y + 0.25) || !fits(s, u - 0.14, y, 0.005, u + 0.14, y + 0.18, 0.34)) return false;
        put(s, 'steel', u - 0.12, y, 0, u + 0.12, y + 0.16, 0.32, { tint: [0.28, 0.29, 0.28] }); lens(s, u, y - 0.002, 0.1, 0.05, 0.3); return true;
      }
      // a slab canopy over a door that has no porch or balcony over it, a light under it
      function canopy(s, h) {
        const y = h.v1 + 0.12;
        if (!fits(s, h.u0 - 0.36, y - 0.3, 0.06, h.u1 + 0.36, 4.0, 0.9)) return false;   // clear up to 4 m: no porch or balcony over it (the string course is 5 cm proud)
        put(s, 'slab', h.u0 - 0.35, y, 0, h.u1 + 0.35, y + 0.12, 0.85, { tint: [0.93, 0.91, 0.87] });
        for (const sg of [-1, 1]) put(s, 'steel', (h.u0 + h.u1) / 2 + sg * (h.u1 - h.u0) / 2 + sg * 0.25 - 0.02, y - 0.5, 0.005, (h.u0 + h.u1) / 2 + sg * (h.u1 - h.u0) / 2 + sg * 0.25 + 0.02, y, 0.06, { tint: [0.4, 0.4, 0.38] }, 'flat');
        lens(s, (h.u0 + h.u1) / 2, y - 0.003, 0.12, 0.25, 0.45); return true;
      }
      // a band along a side, broken where an opening crosses it: the string course, the cornice, a conduit
      function band(s, y0, y1, d, mat, tint, how, ends = 0) {
        const lo = s.alongX ? s.lo - ends : s.lo - 0.15, hi = s.alongX ? s.hi + ends : s.hi + 0.15, cuts = s.holes.filter(h => h.v0 < y1 && h.v1 > y0).sort((p, q) => p.u0 - q.u0);
        let u = lo; const seg = (a, c) => { if (c - a > 0.05) put(s, mat, a, y0, 0, c, y1, d, { tint }, how); };
        for (const h of cuts) { seg(u, h.u0 - 0.04); u = Math.max(u, h.u1 + 0.04); } seg(u, hi);
      }
      // a conduit: only where the wall is free
      function conduit(s, y, a, c) {
        let r0 = null;
        for (let u = a; u <= c + 1e-6; u += 0.2) { const ok = u < c && onWall(s, u, u + 0.2, y - 0.02, y + 0.06) && fits(s, u, y, 0.005, u + 0.2, y + 0.05, 0.05); if (ok && r0 === null) r0 = u; if (!ok && r0 !== null) { if (u - r0 > 0.5) put(s, 'galv', r0, y, 0.005, u, y + 0.045, 0.045, { tint: GP }, 'flat'); r0 = null; } }
      }
      // what is on a window: shutters, flat and open or closed in the reveal (plaster only), curtains behind the glass
      function dressWindow(s, h, plaster) {
        const r = rd(), ww = h.u1 - h.u0;
        if (plaster && r < 0.14) {
          for (const [a, c] of [[h.u0 + 0.06, (h.u0 + h.u1) / 2 - 0.005], [(h.u0 + h.u1) / 2 + 0.005, h.u1 - 0.06]]) {
            quad(s, 'paint', a, h.v0 + 0.06, c, h.v1 - 0.06, -T_ + 0.03, SH);
            for (let y = h.v0 + 0.12; y < h.v1 - 0.1; y += 0.07) quad(s, 'steel', a + 0.04, y, c - 0.04, y + 0.016, -T_ + 0.032, vscale(SH, 0.5));
          }
          return;
        }
        if (plaster && r < 0.6) {
          const w = ww / 2;
          for (const sg of [-1, 1]) {
            const a = sg < 0 ? h.u0 - 0.03 - w : h.u1 + 0.03, c = a + w;
            if (!onWall(s, a, c, h.v0, h.v1, h) || !fits(s, a, h.v0 + 0.005, 0.005, c, h.v1, 0.04)) continue;
            put(s, 'paint', a, h.v0, 0, c, h.v1 + 0.02, 0.035, { tint: SH }, h.v0 >= 3.2 ? 'draw' : 'flat');
            for (let y = h.v0 + 0.06; y < h.v1 - 0.04; y += 0.07) quad(s, 'steel', a + 0.05, y, c - 0.05, y + 0.016, 0.037, vscale(SH, 0.5));
          }
        }
        if (rd() < 0.55) {
          const c = [[0.62, 0.56, 0.46], [0.46, 0.55, 0.6], [0.5, 0.52, 0.42], [0.6, 0.48, 0.42]][Math.floor(rd() * 4)].map(v => v * 0.5), l = 0.22 + rd() * 0.3, rr = 0.18 + rd() * 0.3;
          quad(s, 'cloth', h.u0 + 0.06, h.v0 + 0.08, h.u0 + 0.06 + (ww - 0.12) * l, h.v1 - 0.07, -T_ + 0.006, c);
          quad(s, 'cloth', h.u1 - 0.06 - (ww - 0.12) * rr, h.v0 + 0.08, h.u1 - 0.06, h.v1 - 0.07, -T_ + 0.006, c);
        }
      }

      for (const b of BUILDINGS) {
        const plaster = (b.mat || 'plaster') === 'plaster', FH = b.H / b.floors, light = vscale(b.tint, 1.06);
        for (const s of b._sides) {
          // the string course and the cornice (A, C), with the black band of streaks under it in the walls' shader
          if (plaster && b.floors > 1) {
            band(s, FH - 0.12, FH + 0.1, 0.05, b.mat || 'plaster', light, 'flat', 0.05);
            band(s, b.H - 0.34, b.H - 0.14, 0.12, b.mat || 'plaster', light, undefined, 0.12);
            band(s, b.H - 0.14, b.H - 0.08, 0.17, 'slab', [0.9, 0.88, 0.84], undefined, 0.17);
          }
          // doors: a canopy and a light, or a lamp over a door that already has a roof
          for (const h of s.holes) if (h.kind === 'door' && h.v0 < 0.01) { if (!canopy(s, h) && h.v1 < 2.5) wallLamp(s, (h.u0 + h.u1) / 2, h.v1 + 0.25); }
          // downpipes: one near each end of a side, more along a long one
          const L = s.hi - s.lo, nP = L > 20 ? 4 : L > 9 ? 2 : 1;
          for (let k = 0; k < nP; k++) { const u0 = nP === 1 ? s.lo + 0.6 : s.lo + 0.6 + (L - 1.2) * k / (nP - 1); for (const du of [0, 0.5, -0.5, 1, -1, 1.6, -1.6]) if (downpipe(s, u0 + du, b.H)) break; }
          // split AC units beside some windows, on every storey; condensers on the ground under a few
          for (const h of s.holes) if (h.kind === 'win' && rd() < (h.f ? 0.22 : 0.34) && b.id !== 'E') { const sg = rd() < 0.5 ? -1 : 1, u = sg < 0 ? h.u0 - 0.75 : h.u1 + 0.8; splitAC(s, u, h.f ? h.v1 + 0.22 : 2.45) || splitAC(s, sg < 0 ? h.u1 + 0.8 : h.u0 - 0.75, h.f ? h.v1 + 0.22 : 2.45); }
          if (b.id !== 'I') for (const h of s.holes) if (h.kind === 'win' && !h.f && rd() < 0.22) condenser(s, rd() < 0.5 ? h.u0 - 0.85 : h.u1 + 0.85);
          // a conduit along the ground floor's top
          if (b.id === 'A' || b.id === 'C' || b.id === 'D') conduit(s, Math.min(FH, 3.6) - 0.5 + (b.id === 'D' ? 0.6 : 0), s.lo + 0.4, s.hi - 0.4);
          for (const h of s.holes) if (h.kind === 'win') dressWindow(s, h, plaster);
        }
      }

      // the comm block: electric boxes on the west face, two cabinets on the south (6, 7, 54-58)
      { const sW = BUILDINGS.find(b => b.id === 'D')._sides.find(s => s.side === 'w'), sS = BUILDINGS.find(b => b.id === 'D')._sides.find(s => s.side === 's');
        for (const u of [0.9, 1.75, 2.45]) if (onWall(sW, u - 0.32, u + 0.32, 1.0, 1.9) && fits(sW, u - 0.3, 1.1, 0.005, u + 0.3, 1.85, 0.23)) {
          put(sW, 'paint', u - 0.28, 1.1, 0, u + 0.28, 1.85, 0.22, { tint: [0.62, 0.64, 0.63] }); quad(sW, 'steel', u - 0.005, 1.14, u + 0.005, 1.81, 0.222, [0.3, 0.3, 0.3]);
          quad(sW, 'steel', u + 0.17, 1.42, u + 0.21, 1.52, 0.222, [0.25, 0.25, 0.25]); put(sW, 'galv', u - 0.03, 1.85, 0.005, u + 0.03, 3.85, 0.05, { tint: GP }, 'flat');
        }
        for (const u of [25.2, 26.25]) if (fits(sS, u - 0.45, 0.01, 0.005, u + 0.45, 1.7, 0.47)) {
          put(sS, 'paint', u - 0.43, 0, 0.02, u + 0.43, 1.65, 0.46, { tint: [0.6, 0.63, 0.6] }); quad(sS, 'steel', u - 0.004, 0.1, u + 0.004, 1.55, 0.462, [0.3, 0.3, 0.3]);
          for (let k = 0; k < 5; k++) quad(sS, 'grille', u - 0.32, 1.2 + k * 0.06, u - 0.08, 1.23 + k * 0.06, 0.462);
        }
      }
      // the dish bunker's "02" over its olive door, and a step (8)
      { const sF = BUILDINGS.find(b => b.id === 'F')._sides.find(s => s.side === 'w'), h = sF.holes.find(o => o.kind === 'door');
        if (h) { const u = (h.u0 + h.u1) / 2; signQuad(4, P3(sF, u, h.v1 + 0.42, 0.03), N3(sF), 0.64, 0.16); put(sF, 'paint', u - 0.35, h.v1 + 0.32, 0.005, u + 0.35, h.v1 + 0.52, 0.025, { tint: [0.3, 0.3, 0.28] }, 'flat'); if (fits(sF, h.u0 - 0.2, 0.01, 0.005, h.u1 + 0.2, 0.15, 0.45)) put(sF, 'slab', h.u0 - 0.2, 0, 0, h.u1 + 0.2, 0.15, 0.45, { tint: [0.9, 0.89, 0.86] }); } }
      // the booth: its sign over the window, a rail round its roof, an AC box up there (33-37)
      { const bI = BUILDINGS.find(b => b.id === 'I'), [x0, z0, x1, z1] = bI.at, sS = bI._sides.find(s => s.side === 's'), Y = bI.H;
        put(sS, 'paint', (x0 + x1) / 2 - 1.08, 2.4, 0.005, (x0 + x1) / 2 + 1.08, 2.88, 0.03, { tint: [0.2, 0.22, 0.2] }, 'draw');
        signQuad(2, P3(sS, (x0 + x1) / 2, 2.64, 0.032), N3(sS), 2.0, 0.44);
        const railI = (ax, az, bx, bz) => { const alongX = Math.abs(bx - ax) > 0.01, L = alongX ? bx - ax : bz - az, n = Math.max(1, Math.round(L / 1.4));
          for (let k = 0; k <= n; k++) { const u = (alongX ? ax : az) + L * k / n; (alongX ? solid('galv', u - 0.025, Y + 0.2, az - 0.025, u + 0.025, Y + 1.0, az + 0.025, { tint: [0.7, 0.7, 0.68] }) : solid('galv', ax - 0.025, Y + 0.2, u - 0.025, ax + 0.025, Y + 1.0, u + 0.025, { tint: [0.7, 0.7, 0.68] })).rail = true; }
          for (const y of [Y + 0.6, Y + 0.96]) (alongX ? solid('galv', ax, y, az - 0.02, bx, y + 0.04, az + 0.02, { tint: [0.7, 0.7, 0.68] }) : solid('galv', ax - 0.02, y, az, ax + 0.02, y + 0.04, bz, { tint: [0.7, 0.7, 0.68] })).rail = true;
          (alongX ? block(ax, Y, az - 0.07, bx, Y + 1.0, az + 0.07, 'metal') : block(ax - 0.07, Y, az, ax + 0.07, Y + 1.0, bz, 'metal')).rail = true; };
        railI(x0 + 0.15, z0 + 0.15, x1 - 0.15, z0 + 0.15); railI(x0 + 0.15, z1 - 0.15, x1 - 0.15, z1 - 0.15); railI(x0 + 0.15, z0 + 0.15, x0 + 0.15, z1 - 0.15); railI(x1 - 0.15, z0 + 0.15, x1 - 0.15, z1 - 0.15);
        solid('paint', x0 + 0.5, Y, z0 + 0.6, x0 + 1.35, Y + 0.42, z0 + 1.25, { tint: [0.88, 0.88, 0.84] });
        bld.face('grille', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(k => [x0 + 0.925 + Math.cos(k / 14 * TAU) * 0.22, Y + 0.424, z0 + 0.925 + Math.sin(k / 14 * TAU) * 0.22]), [0, 1, 0], [...Array(14)].map((_, k) => [Math.cos(k / 14 * TAU), Math.sin(k / 14 * TAU)]), [1, 1, 1], 'r');
      }
      // the forecourt's sign, on two posts, facing the road in (33)
      { const x = -57.4, z = 3.45; for (const dx of [-0.95, 0.95]) solid('galv', x + dx - 0.04, 0, z - 0.04, x + dx + 0.04, 2.25, z + 0.04, { tint: [0.68, 0.68, 0.66] });
        solid('paint', x - 1.15, 1.5, z + 0.04, x + 1.15, 2.1, z + 0.08, { tint: [0.24, 0.24, 0.22] }); signQuad(3, [x, 1.8, z + 0.083], [0, 0, 1], 2.24, 0.56); }

      /* roofs (every flat roof is walked on: what stands there stops players, measured from the roof): AC boxes with a fan on top or louvres down the side, ducts, vent pipes,
         a solar water heater, water tanks on a stand, twin-fan units, a dish (15-19, 6, 7, 10-12, 8, 9) */
      let onWalkRoof = false;          // set while a walked-on roof is dressed: what stands on it then stops players too, and is jumped, vaulted and climbed as on the ground
      const roofAC = (x, y, z, w, d, h, fans = 1) => {
        if (onWalkRoof) block(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, 'metal');
        if (models.hvac && (w / d > 1.45 || d / w > 1.45)) { hiBox(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, 'metal'); prop('hvac', x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, w > d ? 0 : 1); return; }   // the long units: the HVAC model
        for (const sg of [-1, 1]) deco('steel', x - w / 2 - 0.06, y, z + sg * (d / 2 - 0.12) - 0.05, x + w / 2 + 0.06, y + 0.12, z + sg * (d / 2 - 0.12) + 0.05, { tint: [0.32, 0.32, 0.31], hi: false });     // two rails it is bolted to
        deco('paint', x - w / 2, y + 0.12, z - d / 2, x + w / 2, y + h, z + d / 2, { tint: [0.86, 0.86, 0.83] });
        for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) deco('paint', x + cx * w / 2 - (cx > 0 ? 0.03 : 0), y + 0.12, z + cz * d / 2 - (cz > 0 ? 0.03 : 0), x + cx * w / 2 + (cx < 0 ? 0.03 : 0), y + h, z + cz * d / 2 + (cz < 0 ? 0.03 : 0), { tint: [0.62, 0.62, 0.6], hi: false, shadow: 'r' });   // its corner posts
        deco('paint', x - w / 2 - 0.02, y + h - 0.05, z - d / 2 - 0.02, x + w / 2 + 0.02, y + h, z + d / 2 + 0.02, { tint: [0.74, 0.74, 0.72], hi: false, shadow: 'r' });                                              // the lid's rim
        for (const sg of [-1, 1]) for (let k = 0; k < 6; k++) { const xx = x + sg * (w / 2 + 0.003), yy = y + 0.24 + k * (h - 0.42) / 6, P2 = [[xx, yy, z - d / 2 + 0.1], [xx, yy, z + d / 2 - 0.1], [xx, yy + 0.035, z + d / 2 - 0.1], [xx, yy + 0.035, z - d / 2 + 0.1]]; bld.face('grille', P2, [sg, 0, 0], P2.map(q => [q[2], q[1]]), [1, 1, 1], 'cr'); }   // louvres in its ends
        if (fans) for (let f = 0; f < fans; f++) { const fx = x - w / 2 + w * (f + 0.5) / fans, rr = Math.min(w / fans, d) * 0.36, ring = []; for (let k = 0; k < 18; k++) { const a = k / 18 * TAU; ring.push([fx + Math.cos(a) * rr, y + h + 0.004, z + Math.sin(a) * rr]); } bld.face('grille', ring, [0, 1, 0], ring.map(p => [p[0], p[2]]), [1, 1, 1], 'r');
          cyl('steel', 'y', [fx, y + h + 0.03, z], rr + 0.02, 0.05, { tint: [0.42, 0.42, 0.4], n: 18, caps: false }); for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + 0.4; beamPQ('steel', [fx, y + h + 0.06, z], [fx + Math.cos(a) * rr, y + h + 0.06, z + Math.sin(a) * rr], 0.015, 0.015, { tint: [0.3, 0.3, 0.29], hi: false }); } cyl('steel', 'y', [fx, y + h + 0.06, z], 0.05, 0.03, { tint: [0.25, 0.25, 0.24], n: 10 }); }        // the guard ring, its spokes and the hub
        else for (const sg of [-1, 1]) for (let k = 0; k < 7; k++) { const yy = y + 0.25 + k * (h - 0.4) / 7, zz = z + sg * (d / 2 + 0.003), P = [[x - w / 2 + 0.1, yy, zz], [x + w / 2 - 0.1, yy, zz], [x + w / 2 - 0.1, yy + 0.035, zz], [x - w / 2 + 0.1, yy + 0.035, zz]]; bld.face('grille', P, [0, 0, sg], P.map(p => [p[0], p[1]]), [1, 1, 1], 'cr'); }
      };
      const vent = (x, y, z, r = 0.07, h = 0.7) => { if (onWalkRoof) block(x - r * 1.8, y, z - r * 1.8, x + r * 1.8, y + h + 0.1, z + r * 1.8, 'metal'); cyl('paint', 'y', [x, y + 0.02, z], r * 2.2, 0.04, { n: 14, tint: [0.4, 0.4, 0.38] }); cyl('paint', 'y', [x, y + h / 2, z], r, h, { n: 12, tint: [0.62, 0.63, 0.62] }); cyl('paint', 'y', [x, y + h + 0.05, z], r * 0.5, 0.06, { n: 8, tint: [0.4, 0.4, 0.38] }); cyl('paint', 'y', [x, y + h + 0.1, z], r * 1.9, 0.04, { n: 14, tint: [0.55, 0.55, 0.53] }); hiBox(x - r, y, z - r, x + r, y + h, z + r, 'metal'); };
      const duct = (x0, y0, z0, x1, y1, z1) => { if (onWalkRoof) block(x0, y0 - 0.2, z0, x1, y1, z1, 'metal'); deco('paint', x0, y0, z0, x1, y1, z1, { tint: [0.7, 0.71, 0.7] });
        const along = x1 - x0 > z1 - z0, L = along ? x1 - x0 : z1 - z0, n2 = Math.max(1, Math.round(L / 1.2));          // on sleepers, a seam band every length
        for (let k = 0; k <= n2; k++) { const t = k / n2, u = along ? lerp(x0 + 0.1, x1 - 0.1, t) : lerp(z0 + 0.1, z1 - 0.1, t);
          if (along) { deco('steel', u - 0.05, y0 - 0.2, z0 - 0.06, u + 0.05, y0, z1 + 0.06, { tint: [0.3, 0.3, 0.29], hi: false }); deco('paint', u - 0.02, y0 - 0.01, z0 - 0.012, u + 0.02, y1 + 0.012, z1 + 0.012, { tint: [0.55, 0.56, 0.55], hi: false, shadow: 'r' }); }
          else { deco('steel', x0 - 0.06, y0 - 0.2, u - 0.05, x1 + 0.06, y0, u + 0.05, { tint: [0.3, 0.3, 0.29], hi: false }); deco('paint', x0 - 0.012, y0 - 0.01, u - 0.02, x1 + 0.012, y1 + 0.012, u + 0.02, { tint: [0.55, 0.56, 0.55], hi: false, shadow: 'r' }); } } };
      /* Cover on the walked roofs (he asked, 24 Nov): every piece from 1.3 m (a crouching player's head is 1.15 m: it stays out
         of sight behind one) to 1.6 m (under what the vault climbs, 1.65 m, and a jump reaches, 1.69 m), so each is hidden behind,
         vaulted over or climbed onto, and stops shots. avoid: the sprinkled vents keep clear of them */
      const coverRTU = (x, z, y, q, avoid) => { const hx = q & 1 ? 0.92 : 1.6, hz = q & 1 ? 1.6 : 0.92;          // the packaged rooftop unit (the kit's unit A), 3.2 x 1.84 x 1.6
        if (prop('rtu', x - hx, y, z - hz, x + hx, y + 1.6, z + hz, q)) cbox(x - hx, y, z - hz, x + hx, y + 1.6, z + hz, 'metal'); else solid('paint', x - hx, y, z - hz, x + hx, y + 1.6, z + hz, { tint: [0.8, 0.8, 0.76] });
        for (const sg of [-1, 1]) deco('steel', q & 1 ? x - hx - 0.05 : x + sg * (hx - 0.3) - 0.06, y, q & 1 ? z + sg * (hz - 0.3) - 0.06 : z - hz - 0.05, q & 1 ? x + hx + 0.05 : x + sg * (hx - 0.3) + 0.06, y + 0.06, q & 1 ? z + sg * (hz - 0.3) + 0.06 : z + hz + 0.05, { tint: [0.3, 0.3, 0.29], hi: false });   // the curb rails it sits on
        avoid.push([x, z, Math.max(hx, hz) + 1.0]); };
      const coverCrates = (x, z, y, avoid) => {          // a crate on a crate (1.34 m), a lower one beside it to climb by, cans at its foot
        crate(x, z, 1.2, 1.0, 0.72, y); crate(x + 0.06, z - 0.05, 0.96, 0.84, 0.62, y + 0.72); crate(x + 1.02, z + 0.12, 0.72, 0.64, 0.52, y);
        if (prop('jerry', x - 0.55, y, z + 0.52, x + 0.55, y + 0.47, z + 0.86, 0)) cbox(x - 0.55, y, z + 0.52, x + 0.55, y + 0.47, z + 0.86, 'metal');
        avoid.push([x + 0.4, z, 1.9]); };
      const coverTanks = (x, z, y, avoid) => {           // two IBC tanks side by side on timber sleepers (1.31 m)
        for (const dx of [-0.52, 0.52]) { for (const dz of [-0.42, 0.42]) solid('wood', x + dx - 0.5, y, z + dz - 0.07, x + dx + 0.5, y + 0.15, z + dz + 0.07, { tint: [0.52, 0.44, 0.34] }); ibc(x + dx, z, y + 0.15); }
        hiBox(x - 0.05, y + 0.15, z - 0.6, x + 0.05, y + 1.25, z + 0.6, 'metal'); block(x - 0.05, y + 0.15, z - 0.6, x + 0.05, y + 1.25, z + 0.6, 'metal');     // the cages touch: no slit between them to see or shoot through
        avoid.push([x, z, 2.0]); };
      const coverPallets = (x, z, y, avoid) => {         // nine pallets stacked (1.34 m), strapped, a crate on the roof beside them
        for (let k = 0; k < 9; k++) pallet(x + (k % 3 === 1 ? 0.03 : k % 3 === 2 ? -0.02 : 0), z, y + k * 0.15, [0.84, 0.74, 0.56]);
        for (const dx of [-0.32, 0.32]) draw('tarp', x + dx - 0.025, y, z - 0.506, x + dx + 0.025, y + 1.345, z + 0.506, { tint: [0.65, 0.45, 0.12], faces: 'nst' });
        crate(x + 1.0, z + 0.1, 0.7, 0.62, 0.55, y); avoid.push([x + 0.3, z, 1.8]); };
      const coverGen = (x, z, y, avoid) => {             // a generator set (1.4 m) on its skids
        if (prop('genset', x - 1.2, y, z - 0.75, x + 1.2, y + 1.4, z + 0.75, 1)) cbox(x - 1.2, y, z - 0.75, x + 1.2, y + 1.4, z + 0.75, 'metal'); else solid('paint', x - 1.2, y, z - 0.75, x + 1.2, y + 1.4, z + 0.75, { tint: [0.62, 0.62, 0.48] });
        avoid.push([x, z, 2.0]); };
      const sprinkle = (b, n, avoid) => { const [x0, z0, x1, z1] = b.at; for (let k = 0, t = 0; k < n && t < 80; t++) { const x = lerp(x0 + 0.7, x1 - 0.7, rd()), z = lerp(z0 + 0.7, z1 - 0.7, rd()); if (avoid.some(([ax, az, r]) => Math.hypot(x - ax, z - az) < r)) continue; vent(x, b.H, z, 0.05 + rd() * 0.05, 0.45 + rd() * 0.5); avoid.push([x, z, 0.8]); k++; } };
      { const A = BUILDINGS.find(b => b.id === 'A'), Y = A.H, av = [[-2.4, -34.4, 2.2]]; onWalkRoof = true;      // nothing where the stair comes up
        for (const [x, z, f] of [[-30, -26.6, 1], [-17.5, -32.2, 1], [-7.5, -25.6, 1], [4.0, -31.0, 1], [-25, -32.8, 0], [-11.5, -29.0, 0]]) { f ? roofAC(x, Y, z, 1.1, 1.1, 0.95) : roofAC(x, Y, z, 1.7, 0.85, 1.05, 0); av.push([x, z, 1.6]); }
        duct(-24.1, Y + 0.2, -33.0, -19.5, Y + 0.62, -32.6); duct(-19.9, Y + 0.2, -33.0, -19.5, Y + 0.62, -30.0); duct(-10.6, Y + 0.2, -29.2, -7.0, Y + 0.55, -28.85); av.push([-21.8, -32.8, 1.6], [-19.7, -31.5, 1.2], [-8.8, -29, 1.4]);
        // the solar water heater: a tank over two panels on a frame, turned to the sun
        { const x = -1.5, z = -27.6, FR = { tint: [0.7, 0.7, 0.68], hi: false };        // the solar water heater: a tank over a rack of glass tubes on a frame, turned to the sun
          sheet('galv', [[x - 1.02, Y + 0.4, z + 0.62], [x + 1.02, Y + 0.4, z + 0.62], [x + 1.02, Y + 1.14, z - 0.56], [x - 1.02, Y + 1.14, z - 0.56]], { tint: [0.92, 0.92, 0.9], both: false, hi: false });   // the reflector under them
          for (let k = 0; k < 15; k++) { const tx = x - 0.98 + k * 0.14; beamPQ('glass', [tx, Y + 0.47, z + 0.6], [tx, Y + 1.27, z - 0.66], 0.05, 0.05, { tint: [0.5, 0.65, 1.3], hi: false }); }     // fifteen tubes
          beamPQ('worn', [x - 1.06, Y + 0.44, z + 0.63], [x + 1.06, Y + 0.44, z + 0.63], 0.07, 0.07, FR);
          for (const sx of [-1.05, 1.05]) { beamPQ('worn', [x + sx, Y + 0.43, z + 0.62], [x + sx, Y + 1.2, z - 0.6], 0.04, 0.04, FR);
            beamPQ('steel', [x + sx, Y, z + 0.6], [x + sx, Y + 0.45, z + 0.6], 0.05, 0.05, { tint: [0.5, 0.5, 0.48] }); beamPQ('steel', [x + sx, Y, z - 0.75], [x + sx, Y + 1.3, z - 0.75], 0.05, 0.05, { tint: [0.5, 0.5, 0.48] });
            beamPQ('steel', [x + sx, Y + 0.05, z + 0.55], [x + sx, Y + 1.1, z - 0.72], 0.03, 0.03, { tint: [0.5, 0.5, 0.48], hi: false }); }
          cyl('paint', 'x', [x, Y + 1.5, z - 0.78], 0.27, 2.2, { tint: [0.9, 0.9, 0.86], n: 16, capMat: 'galv' });
          for (const sx of [-1.12, 1.12]) cyl('steel', 'x', [x + sx, Y + 1.5, z - 0.78], 0.275, 0.05, { tint: [0.3, 0.3, 0.3], n: 16 });
          cyl('galv', 'y', [x + 0.6, Y + 1.83, z - 0.78], 0.04, 0.14, { tint: GP, n: 8 });
          hiBox(x - 1.1, Y + 1.23, z - 1.05, x + 1.1, Y + 1.77, z - 0.51, 'metal');
          for (const [q0, q1, top] of [[0.68, 0.3, 0.58], [0.3, -0.08, 0.82], [-0.08, -0.46, 1.06]]) block(x - 1.14, Y, z + q1, x + 1.14, Y + top, z + q0, 'metal');      // the tubes' slope, in three steps (stood on, vaulted, as it looks)
          block(x - 1.14, Y, z - 1.08, x + 1.14, Y + 1.8, z - 0.46, 'metal'); av.push([x, z, 2.0]); }       // the tank on its frame
        draw('galv', -34.6, Y, -34.75, 7.6, Y + 0.05, -34.7, { tint: GP, flat: true }); draw('galv', -2.0, Y, -34.75, -1.95, Y + 0.05, -28.4, { tint: GP, flat: true });
        coverRTU(-32.6, -30.2, Y, 0, av); coverRTU(-12.5, -25.4, Y, 0, av); coverCrates(-21.6, -26.4, Y, av); coverTanks(-13.65, -33.4, Y, av); coverGen(-6.0, -32.0, Y, av); coverPallets(5.6, -25.4, Y, av); coverCrates(1.2, -33.0, Y, av);
        sprinkle(A, 9, av); onWalkRoof = false;
      }
      { const C = BUILDINGS.find(b => b.id === 'C'), Y = C.H, av = [[31.1, -36.9, 2.2], [30.9, -17.6, 2.2]]; onWalkRoof = true; for (const [x, z] of [[24.2, -30.5], [29.0, -20.5], [25.2, -12.3]]) { roofAC(x, Y, z, 1.1, 1.1, 0.95); av.push([x, z, 1.6]); } roofAC(28.6, Y, -34.2, 1.7, 0.85, 1.05, 0); av.push([28.6, -34.2, 1.6]); duct(27.7, Y + 0.2, -34.0, 28.0, Y + 0.6, -31.0); av.push([27.85, -32.5, 1.4]);
        coverRTU(27.0, -26.0, Y, 1, av); coverCrates(23.6, -21.0, Y, av); coverTanks(28.6, -12.4, Y, av); coverPallets(24.0, -35.6, Y, av); coverGen(24.3, -16.5, Y, av);
        sprinkle(C, 6, av); onWalkRoof = false; }
      { const B = BUILDINGS.find(b => b.id === 'B'), Y = B.H, av = [[13.2, -30.4, 1.6]]; onWalkRoof = true; roofAC(13.2, Y, -30.4, 1.6, 0.8, 1.0, 0); coverCrates(14.6, -26.4, Y, av);
        /* a way up to the barracks' roof (he asked, 24 Nov): three heaps of crates against the barracks' wall where it has no window, each a climb
           from the last (1.3 m, 1.2 m, 1.05 m: the vault takes up to 1.65 m) and the coping 33 cm over the last. Walked on, like a stair's treads */
        { const z0 = -32.4, z1 = -31.2, zc = (z0 + z1) / 2, heap = (x0, x1, hs) => { let y = Y; for (const h of hs) { const c = crate((x0 + x1) / 2, zc, x1 - x0, z1 - z0, h, y); if (c) c.walk = true; y += h; } };
          heap(10.95, 12.05, [0.7, 0.6]); heap(9.8, 10.95, [0.85, 0.85, 0.8]); heap(8.52, 9.8, [0.9, 0.9, 0.9, 0.85]); }
        onWalkRoof = false; }
      { const D = BUILDINGS.find(b => b.id === 'D'), Y = D.H; onWalkRoof = true;    // two water tanks on a stand, a big AC, a duct; the tower stands east of them
        block(23.4, Y, -5.55, 27.0, Y + 1.25, -3.65, 'metal'); block(23.69, Y + 1.25, -5.26, 26.71, Y + 2.75, -3.94, 'metal');      // the stand (no room under it for a body) and the tanks on it
        for (let k = 0; k < 4; k++) { const t0 = k / 4, t1 = (k + 1) / 4, za = lerp(-3.94, -2.6, t0), zb = lerp(-3.94, -2.6, t1); block(25.98, Y, Math.min(za, zb) - 0.07, 26.12, Y + lerp(1.3, 0.1, t0) + 0.06, Math.max(za, zb) + 0.07, 'metal'); }   // the down pipe
        block(22.5, Y, -2.67, 26.12, Y + 0.16, -2.53, 'metal');
        deco('steel', 23.4, Y + 1.15, -5.55, 27.0, Y + 1.25, -3.65, { tint: [0.45, 0.45, 0.43] });
        for (const [x, z] of [[23.5, -5.45], [26.9, -5.45], [23.5, -3.75], [26.9, -3.75]]) deco('steel', x - 0.05, Y, z - 0.05, x + 0.05, Y + 1.15, z + 0.05, { tint: [0.45, 0.45, 0.43] });
        for (const x of [24.35, 26.05]) { cyl('paint', 'y', [x, Y + 2.0, -4.6], 0.66, 1.5, { tint: [0.84, 0.84, 0.8], n: 22, capMat: 'galv' }); hiBox(x - 0.62, Y + 1.25, -5.22, x + 0.62, Y + 2.75, -3.98, 'metal'); cyl('galv', 'y', [x, Y + 2.78, -4.6], 0.22, 0.06, { n: 12, tint: GP }); }
        beamPQ('galv', [26.05, Y + 1.3, -3.94], [26.05, Y + 0.1, -2.6], 0.06, 0.06, { tint: GP, hi: false }); beamPQ('galv', [26.05, Y + 0.1, -2.6], [22.5, Y + 0.1, -2.6], 0.06, 0.06, { tint: GP, hi: false });
        roofAC(25.0, Y, 1.7, 2.2, 1.25, 1.15, 2); duct(22.6, Y + 0.25, 1.45, 23.9, Y + 0.75, 1.95);
        vent(23.0, Y, -6.0); vent(33.0, Y, 3.0, 0.08, 0.6); vent(28.0, Y, 3.2, 0.06, 0.5); coverCrates(30.6, 1.8, Y, []); onWalkRoof = false; }
      { const E = BUILDINGS.find(b => b.id === 'E'), Y = E.H; onWalkRoof = true; roofAC(34.3, Y, -36.4, 1.9, 0.85, 0.85, 2); roofAC(36.9, Y, -36.4, 1.9, 0.85, 0.85, 2); solid('galv', 37.4, Y, -34.8, 38.0, Y + 0.5, -34.2, { tint: [0.6, 0.6, 0.58] }); solid('galv', 33.0, Y, -34.7, 33.5, Y + 0.45, -34.2, { tint: [0.6, 0.6, 0.58] }); vent(35.6, Y, -34.4); onWalkRoof = false; }
      { const F = BUILDINGS.find(b => b.id === 'F'), Y = F.H; onWalkRoof = true;   // the dish on its mount, a grille in the roof, vent boxes
        solid('steel', 40.2, Y, -15.9, 40.8, Y + 0.2, -15.3, { tint: [0.5, 0.5, 0.48] }); solid('steel', 40.42, Y + 0.2, -15.68, 40.58, Y + 1.1, -15.52, { tint: [0.5, 0.5, 0.48] }); block(39.7, Y + 0.8, -16.4, 41.3, Y + 2.4, -14.8, 'metal');
        const d1 = dish([40.5, Y + 1.55, -15.6], [-0.55, 0.55, 0.62], 0.95, 0.24); beamPQ('steel', [40.5, Y + 1.1, -15.6], d1.back, 0.08, 0.08, { tint: [0.5, 0.5, 0.48] }); hiBox(39.7, Y + 0.8, -16.4, 41.3, Y + 2.4, -14.8, 'metal');
        draw('grille', 36.4, Y + 0.01, -14.4, 37.8, Y + 0.02, -13.4, { faces: 't', flat: true }); deco('galv', 36.3, Y, -14.5, 37.9, Y + 0.08, -13.3, { faces: 'wens', tint: [0.6, 0.6, 0.58], hi: false });
        solid('galv', 38.2, Y, -17.4, 38.8, Y + 0.55, -16.8, { tint: [0.62, 0.62, 0.6] }); solid('galv', 36.2, Y, -17.2, 36.8, Y + 0.45, -16.6, { tint: [0.62, 0.62, 0.6] }); vent(42.0, Y, -13.0); onWalkRoof = false; }
      /* cover in the open yard between the barracks and the vehicles (he asked, 24 Nov: "crate like military objects, around player height"):
         seven heaps on ground no puddle, spawn or path reaches, each 1.3 to 1.8 m, each climbed or vaulted from a lower piece beside it */
      const yardStack = (x, z, y) => { crate(x, z, 1.2, 1.0, 0.72, y); crate(x + 0.06, z - 0.05, 0.96, 0.84, 0.62, y + 0.72); crate(x - 0.08, z + 0.02, 0.7, 0.6, 0.45, y + 1.34);     // three crates high (1.79 m)
        crate(x + 1.02, z + 0.12, 0.72, 0.64, 0.75, y); if (prop('jerry', x - 0.55, y, z + 0.52, x + 0.55, y + 0.47, z + 0.86, 0)) cbox(x - 0.55, y, z + 0.52, x + 0.55, y + 0.47, z + 0.86, 'metal'); };   // a step to climb them by, cans at the foot
      yardStack(1.2, -9, 0); coverTanks(-3.5, -9, 0, []); coverGen(-8, -6.5, 0, []); yardStack(-12.8, -13.5, 0); coverPallets(-20.3, 0, 0, []); coverTanks(-23.5, -17, 0, []); yardStack(-28.3, -9.5, 0);
    }


    /* ---- where a new life begins: open ground all round the compound (checked against every box in level()) */
    const spawns = [[-57, 6.5], [-57, 15], [-46, -30], [-46, -12], [-45, 2], [-46, 23], [-20, -38.6], [0, -38.6], [14, -37.6], [19.8, -30], [-22, -9], [-6, -4], [8, -10], [6, 2], [-24, 7.5],
      [-24, 31], [-34, 33], [-14, 37.5], [0, 22], [0, 33], [30, 31], [40, 20], [40, 37], [42, -4], [44, -24], [43, -37.5], [12, -1]];
    return { HI, spawns, placed, models: modelsPlaced, explosives, cloths, spinners, puddles };
  }

  /* ------------------------------------------------------------------ the ground (Stage 2)
     Inside the fence and the forecourt: packed, graded earth (the yard), cut exactly at the fence. Outside: the open
     desert, rocky and paler, flat for a few metres, then a low berm, then ground rising into low hills, with the dirt
     road from the gate running west and north, cut through the knolls it meets. The nearer hills stand a few degrees
     over the fence from the yard; the photograph's mountains still stand over the far ones; the photograph's own near ground is hidden under this one. */
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const ROADS = [[[-51, 13.2], [-62, 13.2], [-74, 15], [-86, 24], [-98, 40], [-112, 62], [-130, 90], [-160, 140], [-220, 220]], [[-63, 13.2], [-66, 0], [-68, -20], [-70, -60], [-74, -140], [-80, -260]]];
  function segDist(x, z, pts) { let best = 1e9; for (let k = 0; k + 1 < pts.length; k++) { const [ax, az] = pts[k], [bx, bz] = pts[k + 1], dx = bx - ax, dz = bz - az, t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1); best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t)); } return best; }
  const roadAt = (x, z) => 1 - smooth(2.6, 4.6 + 11 * smooth(70, 130, Math.max(Math.abs(x), Math.abs(z))), Math.min(segDist(x, z, ROADS[0]), segDist(x, z, ROADS[1])) + (fbm2(x * 0.3, z * 0.3, 2) - 0.5) * 1.2);   // the banks widen far out: the ground's squares are 4 m there, and a 2 m bank became a saw
  const outside = (x, z) => Math.hypot(Math.max(FORE.x0 - x, 0, x - FENCE.x1), Math.max(FENCE.z0 - z, 0, z - FENCE.z1));
  const HILLS = [[-70, -4, 13, 6.5], [140, 34, 40, 8], [-20, -150, 45, 12], [60, -120, 30, 9], [-150, 40, 40, 11], [30, 160, 50, 10],      // [x, z, radius, height]: the mound by the gate (34-37), the hill east of the hangars (4)
    [-82, 37, 15, 5.5], [-94, -34, 22, 7], [74, -26, 20, 6], [14, 74, 22, 6.5], [-18, -80, 26, 8], [86, 62, 22, 7], [-42, 72, 16, 5]];      // and the nearer ones the road cuts between
  function terrainH(x, z) {
    const d = outside(x, z); if (d < 5) return 0;
    const near = smooth(5, 12, d), fade = 1 - 0.5 * smooth(250, 700, d);
    const berm = 1.6 * near * (1 - smooth(16, 34, d)) * (0.4 + 1.0 * fbm2(x * 0.05 + 3, z * 0.05 + 1, 3));
    const roll = smooth(10, 60, d) * (0.5 + 5.0 * fbm2(x * 0.011 + 7, z * 0.011 + 2, 4)) * fade;                       // the land's long swell
    const knoll = smooth(9, 26, d) * 11 * Math.max(0, fbm2(x * 0.034 + 21, z * 0.034 + 9, 3) - 0.5) * fade;             // knolls a few metres high, close enough to read from the yard
    const lump = near * 0.5 * (fbm2(x * 0.16 + 5, z * 0.16 + 13, 2) - 0.5);                                             // never dead level
    let h = berm + roll + knoll + lump;
    for (const [hx, hz, r, hh] of HILLS) { const q = ((x - hx) ** 2 + (z - hz) ** 2) / (r * r); if (q < 4) h += hh * Math.exp(-q * 1.6) * (0.8 + 0.4 * fbm2(x * 0.06, z * 0.06, 3)) * near; }
    return h * (1 - 0.94 * roadAt(x, z));
  }
  const terrainN = (x, z) => { const e = 0.4, gx = (terrainH(x + e, z) - terrainH(x - e, z)) / (2 * e), gz = (terrainH(x, z + e) - terrainH(x, z - e)) / (2 * e), l = Math.hypot(gx, 1, gz); return [-gx / l, 1 / l, -gz / l]; };
  // the play area as convex outlines, for cutting the yard at the fence: the compound (the slant cuts its south-west corner) and the forecourt
  const GROUND_SLABS = [[-6, 12, 6, 39], [-55, FENCE.gate[0], -47, FENCE.gate[1]]];      // the hangars' apron and the gate's slab: concrete lying on the ground, the yard cut out under them
  const YARD = [[[FENCE.x0, FENCE.z0], [FENCE.x1, FENCE.z0], [FENCE.x1, FENCE.z1], [FENCE.cham[2], FENCE.z1], [FENCE.cham[0], FENCE.cham[1]]], [[FORE.x0, FORE.z0], [FENCE.x0, FORE.z0], [FENCE.x0, FORE.z1], [FORE.x0, FORE.z1]]];
  function clip(poly, edge) {            // Sutherland-Hodgman against one convex outline (corners in turn, inside on the left as listed)
    let out = poly;
    for (let k = 0; k < edge.length && out.length; k++) {
      const [ax, az] = edge[k], [bx, bz] = edge[(k + 1) % edge.length], side = p => (bx - ax) * (p[1] - az) - (bz - az) * (p[0] - ax), inp = out; out = [];
      for (let i = 0; i < inp.length; i++) { const p = inp[i], q = inp[(i + 1) % inp.length], sp = side(p), sq = side(q);
        if (sp >= 0) out.push(p); if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); } }
    }
    return out;
  }
  function buildGround(bld) {
    const desertCol = (x, z) => { const n = 0.84 + 0.3 * fbm2(x * 0.07 + 4, z * 0.07 + 8, 3), r = roadAt(x, z), d = outside(x, z), far = smooth(150, 600, d);
      const k = [lerp(1.3, 1.52, r), lerp(1.3, 1.48, r), lerp(1.24, 1.38, r)]; return [lerp(n * k[0], 1.4, far), lerp(n * k[1], 1.36, far), lerp(n * k[2], 1.28, far)]; };
    const LV2 = 108, SEAMS = [[[WORLD.x0, WORLD.z0, WORLD.x1, WORLD.z1], 2], [[-LV2, -LV2, LV2, LV2], 4], [[-220, -220, 220, 220], 20]];
    const edgeH = (x, z) => {      // where a finer grid meets a coarser one, the finer edge follows the coarser one's straight edge: no crack opens on a slope
      for (const [B, S] of SEAMS) {
        if ((x === B[0] || x === B[2]) && z >= B[1] && z <= B[3]) { const a = Math.floor(z / S) * S; if (a !== z) return lerp(terrainH(x, a), terrainH(x, a + S), (z - a) / S); }
        if ((z === B[1] || z === B[3]) && x >= B[0] && x <= B[2]) { const a = Math.floor(x / S) * S; if (a !== x) return lerp(terrainH(a, z), terrainH(a + S, z), (x - a) / S); } }
      return terrainH(x, z); };
    const quad = (mat, x0, z0, s, col) => { const P = [[x0, 0, z0], [x0 + s, 0, z0], [x0 + s, 0, z0 + s], [x0, 0, z0 + s]]; for (const p of P) p[1] = edgeH(p[0], p[2]);
      bld.face(mat, P, P.map(p => terrainN(p[0], p[2])), P.map(p => [p[0], p[2]]), P.map(p => col(p[0], p[2])), 'r'); };   // a normal at each corner: no grid of facets
    // the desert: 1 m squares round the compound, 4 m out to 220 m, 20 m out to 800 m
    const inPoly = (x, z, poly) => { let sg = 0; for (let k = 0; k < poly.length; k++) { const [ax, az] = poly[k], [bx, bz] = poly[(k + 1) % poly.length], c = (bx - ax) * (z - az) - (bz - az) * (x - ax); if (Math.abs(c) < 1e-9) continue; if (sg && Math.sign(c) !== sg) return false; sg = Math.sign(c); } return true; };
    const underYard = (x, z, sz) => [[x, z], [x + sz, z], [x + sz, z + sz], [x, z + sz]].every(([px, pz]) => YARD.some(poly => inPoly(px, pz, poly)));
    for (let x = WORLD.x0; x < WORLD.x1; x += 1) for (let z = WORLD.z0; z < WORLD.z1; z += 1) if (!underYard(x, z, 1)) quad('desert', x, z, 1, desertCol);   // the yard covers the rest
    const ring = (R0, R1, s) => { for (let x = -R1; x < R1; x += s) for (let z = -R1; z < R1; z += s) { if (x >= -R0 && x + s <= R0 && z >= -R0 && z + s <= R0) continue; if (R0 === 0 && x >= WORLD.x0 && x + s <= WORLD.x1 && z >= WORLD.z0 && z + s <= WORLD.z1) continue; quad('desert', x, z, s, desertCol); } };
    { // 2 m squares from the 1 m patch out to 108 m (the knolls and the road's banks are there), 4 m to 220 m, then 20 m to 800 m
      for (let x = -LV2; x < LV2; x += 2) for (let z = -LV2; z < LV2; z += 2) { if (x >= WORLD.x0 && x + 2 <= WORLD.x1 && z >= WORLD.z0 && z + 2 <= WORLD.z1) continue; quad('desert', x, z, 2, desertCol); }
      for (let x = -220; x < 220; x += 4) for (let z = -220; z < 220; z += 4) { if (x >= -LV2 && x + 4 <= LV2 && z >= -LV2 && z + 4 <= LV2) continue; quad('desert', x, z, 4, desertCol); }
      ring(220, 800, 20);
    }
    // the yard: cut exactly at the fence, a few millimetres over the desert
    const yardCol = (x, z) => { const n = 0.86 + 0.26 * fbm2(x * 0.08 + 1, z * 0.08 + 6, 3), g = fbm2(x * 0.025 + 9, z * 0.025 + 2, 3); return [n * (1.42 + 0.1 * g), n * (1.38 + 0.1 * g), n * (1.26 + 0.08 * g)]; };
    for (const poly of YARD) {
      let ax = 1e9, az = 1e9, bx = -1e9, bz = -1e9; for (const [px, pz] of poly) { ax = Math.min(ax, px); az = Math.min(az, pz); bx = Math.max(bx, px); bz = Math.max(bz, pz); }
      for (let x = Math.floor(ax / 2) * 2; x < bx; x += 2) for (let z = Math.floor(az / 2) * 2; z < bz; z += 2) {     // flat: 2 m squares are enough
        const cut = GROUND_SLABS.some(([a, b, c2, d]) => x < c2 && x + 2 > a && z < d && z + 2 > b);       // half-metre squares where a slab lies, none under it
        for (const [qx, qz, qs] of cut ? [0, 1, 2, 3].flatMap(i => [0, 1, 2, 3].map(j => [x + i * 0.5, z + j * 0.5, 0.5])).filter(([cx, cz]) => !GROUND_SLABS.some(([a, b, c2, d]) => cx + 0.25 > a && cx + 0.25 < c2 && cz + 0.25 > b && cz + 0.25 < d)) : [[x, z, 2]]) {
          const c = clip([[qx, qz], [qx + qs, qz], [qx + qs, qz + qs], [qx, qz + qs]], poly); if (c.length < 3) continue;
          const P = c.map(([px, pz]) => [px, 0.004, pz]); bld.face('yard', P, [0, 1, 0], P.map(p => [p[0], p[2]]), P.map(p => yardCol(p[0], p[2])), 'r'); }
      }
    }
    // rocks lying out in the desert (broken blocks, as Alpine strews its rubble), thicker on the mounds; none inside the fence
    const r = rng(7331), stoneTint = () => { const t = 0.42 + 0.3 * r(); return [t * 1.05, t * 0.95, t * 0.84]; };
    const rock = (x, z, rx, rz, h) => { const y0 = terrainH(x, z) - 0.08, yaw = r() * TAU, c = Math.cos(yaw), s = Math.sin(yaw), k = 0.5 + 0.2 * r(), tint = stoneTint();
      const at = (lx, lz, y, j) => [x + (lx * c - lz * s) * (1 + (r() - 0.5) * j), y, z + (lx * s + lz * c) * (1 + (r() - 0.5) * j)];
      const B = [at(-rx, -rz, y0, 0.25), at(rx, -rz, y0, 0.25), at(rx, rz, y0, 0.25), at(-rx, rz, y0, 0.25)], Tp = [at(-rx * k, -rz * k, y0 + h, 0.4), at(rx * k, -rz * k, y0 + h * 0.9, 0.4), at(rx * k, rz * k, y0 + h, 0.4), at(-rx * k, rz * k, y0 + h * 0.85, 0.4)];
      const fc = P => { const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], e2 = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]], n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(...n) || 1; bld.face('desert', P, [n[0] / l, n[1] / l, n[2] / l], P.map(p => [p[0] * 1.7 + p[1], p[2] * 1.7 + p[1]]), P.map(() => tint), 'cr'); };
      fc([Tp[0], Tp[3], Tp[2], Tp[1]]); for (let i = 0; i < 4; i++) fc([B[i], B[(i + 1) % 4], Tp[(i + 1) % 4], Tp[i]]); };
    for (let n = 0; n < 2100; n++) {
      const x = -180 + 360 * r(), z = -180 + 360 * r(), d = outside(x, z); if (d < 2.5 || roadAt(x, z) > 0.2) continue;
      let w = 0.25 + 0.5 * smooth(40, 4, Math.abs(d - 30)); for (const [hx, hz, rr] of HILLS) if (Math.hypot(x - hx, z - hz) < rr) w += 0.8;
      if (r() > w * Math.exp(-d / 90)) continue;
      const big = r() < 0.17, rx = big ? 0.6 + 0.9 * r() : 0.12 + 0.3 * r(); rock(x, z, rx, rx * (0.5 + 0.5 * r()), rx * (0.5 + 0.5 * r()));
    }
    // pebbles: small dark flat stones everywhere, a few inside the fence too
    for (let n = 0; n < 5200; n++) {
      const x = -90 + 180 * r(), z = -80 + 160 * r(), d = outside(x, z), inside = d === 0 && inPlay(x, z, 0.2);
      if (inside ? r() > 0.25 || covered0(x, z) : r() > Math.exp(-d / 40)) continue;
      const s = 0.04 + 0.1 * r() * r(), a = r() * TAU, y = terrainH(x, z) + (inside ? 0.012 : 0.008), t = 0.4 + 0.3 * r(), P = [0, 1, 2, 3, 4].map(k => { const q = a + k / 5 * TAU, rr = s * (0.7 + 0.5 * r()); return [x + Math.cos(q) * rr, y, z + Math.sin(q) * rr * 0.7]; });
      bld.face('stone', P, [0, 1, 0], P.map(p => [p[0], p[2]]), [t * 1.05, t * 0.92, t * 0.8], 'r');
    }
  }
  // inside a building, a hangar or a slab: no pebbles there
  const covered0 = (x, z) => [...BUILDINGS, ...HANGARS].some(b => x > b.at[0] - 0.3 && x < b.at[2] + 0.3 && z > b.at[1] - 0.3 && z < b.at[3] + 0.3) || (x > -6 && x < 6 && z > 12 && z < 39) || (x > -43 && x < -17 && z > 14 && z < 18);

  /* ------------------------------------------------------------------ desert scrub: walk-through, moving a little in the wind
     Each bush is a handful of crossed cards carrying the twiggy spray (the 'scrub' picture), leaning outward. Thick out
     in the desert, sparse at the fence, a few in the yard along the barracks' kerb (5, 13, 15) and by the hangars. */
  function sway(mat, key) {
    const time = { value: 0 };
    mat.onBeforeCompile = sh => { sh.uniforms.uTime = time;
      sh.vertexShader = 'attribute float aSway; uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  { float ph = position.x * 0.9 + position.z * 1.3; transformed.x += aSway * (sin(uTime * 1.5 + ph) * 0.05 + sin(uTime * 3.3 + ph * 2.3) * 0.02); transformed.z += aSway * cos(uTime * 1.2 + ph * 1.7) * 0.04; }'); };
    mat.customProgramCacheKey = () => key;
    return time;
  }
  const YARD_BUSHES = [[-30, -21.1, 0.5], [-18, -21.1, 0.45], [-2.5, -21.1, 0.55], [5.5, -21.1, 0.45], [12.5, -22.8, 0.5], [20.4, -30, 0.45], [20.4, -18, 0.5], [20.4, -10, 0.4], [-47, -38, 0.6], [44, 38, 0.6], [-48, 25, 0.5], [3, 40, 0.5], [45, -10, 0.55]];
  function buildPlants(G, root, mats) {
    const T = G.THREE, r = rng(2077), q = (G.quality && G.quality.name) || 'high', sets = [0, 1].map(() => ({ P: [], C: [], N: [], I: [], A: [], U: [] }));
    let P, C, N, I, A, U;
    const bush = (x, z, rad) => { ({ P, C, N, I, A, U } = sets[outside(x, z) < 35 ? 0 : 1]);   // near the fence they cast shadows, far out not
      const y0 = terrainH(x, z), n = q === 'low' || outside(x, z) > 60 ? 4 : 7, dry = r() < 0.4;   // far out four cards are plenty
      for (let k = 0; k < n; k++) {
        const a = r() * TAU, off = rad * 0.35 * r(), cx = x + Math.cos(a) * off, cz = z + Math.sin(a) * off, yaw = r() * TAU, w = rad * (1.1 + 0.6 * r()), h = rad * (1.0 + 0.6 * r()), lean = (r() - 0.5) * 0.5;
        const dx = Math.cos(yaw) * w / 2, dz = Math.sin(yaw) * w / 2, lx = -Math.sin(yaw) * lean * h, lz = Math.cos(yaw) * lean * h, v = P.length / 3, g = 0.8 + 0.35 * r();
        const tint = dry ? [g * 0.9, g * 0.78, g * 0.56] : [g * 0.68, g * 0.74, g * 0.56];
        P.push(cx - dx, y0 - 0.05, cz - dz, cx + dx, y0 - 0.05, cz + dz, cx + dx + lx, y0 + h, cz + dz + lz, cx - dx + lx, y0 + h, cz - dz + lz);
        U.push(0, 0, 1, 0, 1, 1, 0, 1); A.push(0, 0, h, h);
        for (let j = 0; j < 4; j++) { C.push(...tint); N.push(0, 1, 0); }
        I.push(v, v + 1, v + 2, v, v + 2, v + 3);
      }
    };
    for (let n = 0; n < (q === 'low' ? 6000 : q === 'medium' ? 10000 : 15000); n++) {       // thick enough to read as scrubland from the fence (115)
      const x = -170 + 340 * r(), z = -170 + 340 * r(), d = outside(x, z);
      if (d < 1.2 || roadAt(x, z) > 0.15 || r() > Math.exp(-d / 90) * (0.35 + 0.8 * fbm2(x * 0.04, z * 0.04, 2))) continue;
      bush(x, z, 0.38 + 0.6 * r() * r() + (d > 60 ? 0.35 : 0));
    }
    for (const [x, z, rad] of YARD_BUSHES) bush(x, z, rad);
    const time = sway(mats.scrub, 'a51-scrub'); let tris = 0;
    sets.forEach(({ P, C, N, I, A, U }, k) => {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(N, 3)); g.setAttribute('color', new T.Float32BufferAttribute(C, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(U, 2)); g.setAttribute('aSway', new T.Float32BufferAttribute(A, 1));
      g.setIndex(new T.Uint32BufferAttribute(I, 1)); g.computeBoundingSphere();
      const mesh = new T.Mesh(g, mats.scrub); mesh.name = k ? 'a51:scrubFar' : 'a51:scrub'; mesh.receiveShadow = true; mesh.castShadow = k === 0; mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; root.add(mesh); tris += I.length / 3;
    });
    return { tris, update(t) { time.value = t; } };
  }

  /* ------------------------------------------------------------------ the sky: clear and deep blue (the painted one; the photograph comes in Stage 2) */
  const SKY = `
uniform sampler2D tNoise; uniform float uTime, uEnv; uniform vec3 uSunDir, uSunCol;
varying vec3 vDir;
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vn(p); p = p * 2.03 + 17.0; a *= 0.5; } return s / 0.96875; }
void main(){
  vec3 d = normalize(vDir); float h = max(d.y, 0.0), mu = dot(d, uSunDir), s = max(mu, 0.0);
  vec3 zen = vec3(0.12, 0.28, 0.78), hor = vec3(0.7, 0.78, 0.92);
  vec3 col = mix(hor, zen, pow(h, 0.5)) * 1.75;
  col += uSunCol * vec3(1.0, 0.94, 0.84) * (pow(s, 6.0) * 0.45 + pow(s, 40.0) * 1.0 + pow(s, 400.0) * 3.0);
  vec2 q = d.xz / (h + 0.16) * 1.1 + vec2(0.010, 0.004) * uTime;
  float cov = smoothstep(0.6, 0.76, fbm(q * 0.8 + 3.0) + (fbm(q * 3.0 + 9.0) - 0.5) * 0.3) * smoothstep(0.02, 0.2, h);
  col = mix(col, mix(vec3(0.75, 0.78, 0.86), vec3(1.0, 0.99, 0.96), 0.7) * 2.4, cov * 0.8);
  col += vec3(1.0, 0.92, 0.74) * smoothstep(0.99990, 0.99996, mu) * 90.0 * (1.0 - cov) * (1.0 - uEnv);
  if (d.y < 0.0) col = mix(hor * 1.6, vec3(0.62, 0.54, 0.42), smoothstep(0.0, 0.2, -d.y));
  col = mix(col, min(col, vec3(6.0)), uEnv);
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;
  /* The mountains and the sky are a photograph: a full 360° picture of a mountain valley at noon ("Kiara 5 Noon" by
     Greg Zaal, polyhaven.com, CC0), turned so its sun (51° up) stands where the game's sun is. A small picture of the
     whole sky, and a sharp strip for the band round the horizon (cut the way Alpine's are). Its own near ground lies
     under the modelled desert. If the pictures cannot be had, the painted sky above is used instead. */
  const PHOTO = { sunU: 0.6167, band: [0.45, 0.25], dir: '/maps/area51/' };
  const PANO = `
uniform sampler2D tPano, tBand; uniform float uEnv, uRot, uGain, uBand; uniform vec3 uSunDir, uSunCol;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float ua = atan(d.z, d.x) * 0.15915494 + uRot, ub = fract(ua + 0.5) - 0.5;
  float u = fwidth(ua) <= fwidth(ub) + 1e-6 ? ua : ub;
  float v = asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5, vb = (v - ${PHOTO.band[0]}) / ${PHOTO.band[1]};
  vec3 col = texture2D(tPano, vec2(u, v)).rgb, band = texture2D(tBand, vec2(u, clamp(vb, 0.002, 0.998))).rgb;
  col = mix(col, band, uBand * smoothstep(0.0, 0.06, vb) * smoothstep(1.0, 0.94, vb));
  if (uEnv < 0.5) { float lb = dot(col, vec3(0.2126, 0.7152, 0.0722)), open = smoothstep(0.0, 0.12, d.y) * smoothstep(-0.03, 0.05, col.b - col.r);   // the open sky: above the hills, bluer than red (the sun and its glare stay white)
    vec3 hue = mix(vec3(0.30, 0.58, 1.0), vec3(0.09, 0.30, 1.0), smoothstep(0.05, 0.7, d.y));                                                      // a clear light blue at the hills to a deep cobalt overhead (he asked for a very blue sky, 24 Nov)
    vec3 deep = hue * (lb / 0.494) * mix(1.0, 0.85, smoothstep(0.25, 0.9, d.y));                                                                  // the photograph's own light in that blue, a little darker overhead
    col = mix(col, deep, open * mix(0.6, 0.95, smoothstep(0.04, 0.5, d.y))); }
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col *= uGain * (1.0 + 3.0 * pow(l, 5.0));
  col = mix(col, min(col, vec3(6.0)), uEnv);
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;
  async function makeSky(G) {
    const T = G.THREE, sky = G.render.sky, mat = sky && sky.material;
    if (!mat || !mat.uniforms || !mat.uniforms.uSunDir) { console.warn('[area51] the sky was left as it is: its material has changed'); return 'kept'; }
    let kind = 'painted';
    try {
      const loader = new T.TextureLoader(), wide = G.renderer.capabilities.maxTextureSize >= 8192;
      const [pano, band] = await Promise.all([loader.loadAsync(PHOTO.dir + 'sky.jpg'), wide ? loader.loadAsync(PHOTO.dir + 'band.jpg') : null]);
      for (const t of [pano, band]) if (t) { t.colorSpace = T.SRGBColorSpace; t.wrapS = T.RepeatWrapping; t.wrapT = T.ClampToEdgeWrapping; t.anisotropy = Math.min(8, G.renderer.capabilities.getMaxAnisotropy()); }
      const sd = G.consts.sun.dir;
      Object.assign(mat.uniforms, { tPano: { value: pano }, tBand: { value: band || pano }, uBand: { value: band ? 1 : 0 }, uGain: { value: 2.1 }, uRot: { value: PHOTO.sunU - Math.atan2(sd.z, sd.x) / TAU } });
      mat.fragmentShader = PANO; mat.extensions = { ...(mat.extensions || {}), derivatives: true }; kind = band ? 'photo' : 'photo-small';
    } catch (e) { console.warn('[area51] no photograph of the mountains, painting the sky instead', e); mat.fragmentShader = SKY; }
    mat.needsUpdate = true;
    const pm = new T.PMREMGenerator(G.renderer), env = mat.clone(), scene = new T.Scene(), mesh = new T.Mesh(sky.geometry, env);
    for (const k of ['tNoise', 'tPano', 'tBand']) if (mat.uniforms[k]) env.uniforms[k].value = mat.uniforms[k].value;
    env.uniforms.uEnv.value = 1; mesh.frustumCulled = false; scene.add(mesh);
    const keep = G.renderer.getRenderTarget(), rt = pm.fromScene(scene, 0, 0.1, 100);
    G.renderer.setRenderTarget(keep); env.dispose(); pm.dispose();
    G.scene.environment = rt.texture; G.render.env = rt.texture;
    return kind;
  }
  function fitShadows(G) {
    const T = G.THREE, sun = G.render.sun, cam = sun.shadow.camera, w0 = cam.right - cam.left, h0 = cam.top - cam.bottom, depth0 = cam.far - cam.near;
    const dir = G.consts.sun.dir.clone().normalize(), centre = new T.Vector3(-4, 4, 0);
    sun.target.position.copy(centre); sun.position.copy(centre).addScaledVector(dir, 180); sun.updateMatrixWorld(true); sun.target.updateMatrixWorld(true);
    const view = new T.Matrix4().lookAt(sun.position, centre, new T.Vector3(0, 1, 0)); view.setPosition(sun.position); view.invert();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, n0 = 1e9, n1 = -1e9; const v = new T.Vector3();
    for (const x of [FORE.x0 - 1, FENCE.x1 + 1]) for (const z of [FENCE.z0 - 1, FENCE.z1 + 1]) for (const y of [0, 12]) { v.set(x, y, z).applyMatrix4(view); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); n0 = Math.min(n0, -v.z); n1 = Math.max(n1, -v.z); }
    cam.left = x0 - 1; cam.right = x1 + 1; cam.bottom = y0 - 1; cam.top = y1 + 1; cam.near = Math.max(1, n0 - 30); cam.far = Math.max(n1 + 4, cam.near + depth0);
    cam.updateProjectionMatrix();
    sun.shadow.radius *= Math.sqrt((w0 / (cam.right - cam.left)) * (h0 / (cam.top - cam.bottom)));
    sun.shadow.needsUpdate = true;
    return { width: +(cam.right - cam.left).toFixed(1), height: +(cam.top - cam.bottom).toFixed(1) };
  }

  /* ------------------------------------------------------------------ collision beyond boxes, the edge, the walk grid */
  function installPhysics(G, built) {
    const T = G.THREE, ph = G.physics, cast = ph.raycast;
    // out of reach and not a box (roof slopes, the tower, high beams): shots test their triangles, filed in 2 m squares
    const HP = built.HI.p, HS = built.HI.s, NT = HS.length, GC = 2, GX = -66, GZ = -50, GW = 60, GD = 49, cells = Array.from({ length: GW * GD }, () => []);
    for (let t = 0; t < NT; t++) {
      const i = t * 9, xa = Math.min(HP[i], HP[i + 3], HP[i + 6]), xb = Math.max(HP[i], HP[i + 3], HP[i + 6]), za = Math.min(HP[i + 2], HP[i + 5], HP[i + 8]), zb = Math.max(HP[i + 2], HP[i + 5], HP[i + 8]);
      for (let cx = Math.max(0, Math.floor((xa - GX) / GC)); cx <= Math.min(GW - 1, Math.floor((xb - GX) / GC)); cx++) for (let cz = Math.max(0, Math.floor((za - GZ) / GC)); cz <= Math.min(GD - 1, Math.floor((zb - GZ) / GC)); cz++) cells[cz * GW + cx].push(t);
    }
    const stamp = new Int32Array(NT); let rayId = 0;
    const triHit = (t, o, d) => {
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
      const h = hiCast(o, d, best ? best.dist : max);
      if (h) best = hit(o, d, h.dist, h.normal, h.surface);
      // the desert's rise outside the fence: walk the ray over it, then close in on where it goes under
      const lim = Math.min(best ? best.dist : max, 800);
      if (!(d.y > 0 && o.y > 32)) {
        let prev = 0;
        for (let t = 0.5; t <= lim; t += t < 80 ? 0.5 : 2) {
          const y = o.y + d.y * t; if (y > 32) { if (d.y >= 0) break; prev = t; continue; }
          const x = o.x + d.x * t, z = o.z + d.z * t; if (y < terrainH(x, z)) {
            let lo = prev, hi = t; for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (o.y + d.y * m < terrainH(o.x + d.x * m, o.z + d.z * m)) hi = m; else lo = m; }
            const n = terrainN(o.x + d.x * hi, o.z + d.z * hi); best = hit(o, d, hi, new T.Vector3(n[0], n[1], n[2]), 'dirt'); break;
          }
          prev = t;
        }
      }
      return best;
    };
    { const groundH = ph.groundHeight; ph.groundHeight = function (x, z, maxY = 50) { const g = groundH.call(ph, x, z, maxY), h = terrainH(x, z); return h > g && h <= maxY ? h : g; }; }
    /* The balcony's and the stair's rails can be jumped and vaulted over (web/vault.js), but never stood on. The game's
       step (42 cm, in the air too) puts a player on any top within 22 cm of their middle, so whoever jumps a rail lands
       on it for a moment; here they go on over it the way they were moving, or back off it if they were standing still. */
    { const move = ph.moveCapsule; let rails = [], seen = -1;
      const onTop = (b, M, A) => Math.abs(b.max.y - M.y) < 1e-3 && M.x + A >= b.min.x && M.x - A <= b.max.x && M.z + A >= b.min.z && M.z - A <= b.max.z;
      ph.moveCapsule = function (M, V, dt, w = 0.32, S = 1.8, step = true) {
        const r = move.call(this, M, V, dt, w, S, step), A = w * 0.7;
        if (!r || !r.onGround) return r;
        if (seen !== this.boxes.length) { seen = this.boxes.length; rails = this.boxes.filter(b => b.rail && !b.bulletOnly); }
        const on = rails.find(b => onTop(b, M, A));
        if (!on || this.boxes.some(b => !b.rail && !b.bulletOnly && onTop(b, M, A))) return r;
        const k = on.max.x - on.min.x > on.max.z - on.min.z ? 'z' : 'x', c = (on.min[k] + on.max[k]) / 2, v = V[k], sg = Math.abs(v) > 0.2 ? Math.sign(v) : M[k] >= c ? 1 : -1, off = (on.max[k] - on.min[k]) / 2 + w + 0.02;     // clear by the whole width: a capsule left over the edge stands on it again
        const clear = t => { const x = k === 'x' ? t : M.x, z = k === 'z' ? t : M.z; return !this.boxes.some(b => !b.bulletOnly && b !== on && x + w > b.min.x && x - w < b.max.x && z + w > b.min.z && z - w < b.max.z && M.y + 0.1 < b.max.y && M.y + S > b.min.y); };
        if (clear(c + sg * off)) M[k] = c + sg * off; else if (clear(c - sg * off)) M[k] = c - sg * off;          // the way they were going, or back where they came from (a cap or a wall beyond): never into something
        r.onGround = false; return r;
      };
    }
    // the edge: a wall for players up to 12 m on the fence line, round the forecourt, and in steps of 25 cm along the slant
    const o = { surface: 'concrete', playerOnly: true, noNav: true }, B = [WORLD.x0 - 8, WORLD.z0 - 8, WORLD.x1 + 8, WORLD.z1 + 8], [cx0, cz0, cx1, cz1] = FENCE.cham;
    ph.addBox([B[0], 0, B[1]], [B[2], 12, FENCE.z0], o); ph.addBox([FENCE.x1, 0, FENCE.z0], [B[2], 12, B[3]], o); ph.addBox([B[0], 0, FENCE.z1], [FENCE.x1, 12, B[3]], o);
    ph.addBox([B[0], 0, FENCE.z0], [FENCE.x0, 12, FORE.z0], o); ph.addBox([B[0], 0, FORE.z0], [FORE.x0, 12, FORE.z1], o); ph.addBox([B[0], 0, FORE.z1], [FENCE.x0, 12, FENCE.z1], o);
    for (let z = cz0; z < cz1 - 1e-6; z += 0.25) ph.addBox([FENCE.x0 - 0.1, 0, z], [chamX(z), 12, Math.min(cz1, z + 0.25)], o);
    // the fence between the forecourt and the yard, where no ring stands behind it
    ph.addBox([FENCE.x0 - 0.04, 0, FORE.z0], [FENCE.x0 + 0.04, 2.45, FENCE.gate[0]], o); ph.addBox([FENCE.x0 - 0.04, 0, FENCE.gate[1]], [FENCE.x0 + 0.04, 2.45, FORE.z1], o);
  }
  // the walk grid, as the game would make it, over this map: free of boxes a player bumps into, and in play
  function walkGrid(G) {
    const ph = G.physics, C = 0.5, X0 = WORLD.x0, Z0 = WORLD.z0, W = Math.ceil((WORLD.x1 - X0) / C), D = Math.ceil((WORLD.z1 - Z0) / C), free = new Uint8Array(W * D);
    for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) free[j * W + i] = inPlay(X0 + (i + 0.5) * C, Z0 + (j + 0.5) * C, 0.3) ? 1 : 0;
    for (const b of ph.boxes) {
      if (b.noNav || b.bulletOnly || b.max.y < 0.47 || b.min.y > 1.5) continue;
      for (let j = Math.max(0, Math.floor((b.min.z - 0.3 - Z0) / C)); j <= Math.min(D - 1, Math.floor((b.max.z + 0.3 - Z0) / C)); j++)
        for (let i = Math.max(0, Math.floor((b.min.x - 0.3 - X0) / C)); i <= Math.min(W - 1, Math.floor((b.max.x + 0.3 - X0) / C)); i++) free[j * W + i] = 0;
    }
    ph.nav.isWalkable = (x, z) => { const i = Math.floor((x - X0) / C), j = Math.floor((z - Z0) / C); return i >= 0 && j >= 0 && i < W && j < D && free[j * W + i] === 1; };
    let n = 0; for (const f of free) n += f; return n;
  }

  /* ------------------------------------------------------------------ the check: every top a player can reach
     Tops are sampled every 25 cm (a box thinner than that at its middle). A top is a place to stand if nothing solid
     starts between a step (42 cm, the next tread of a stair) and a crouching player's height (1.15 m) over it. Rail tops
     are not places to stand (installPhysics moves a player off them). It is reached from
     the ground when it is within a jump and a step (1.69 m) of it, from another top within 2.2 m across and 1.69 m
     up (or any height down). Anything reached more than 3.15 m over its floor (the walked-on top under it, or the ground) or
     outside the fence is a fault; so is a spawn in a box. */
  function reach(G, across = 2.2) {
    const ph = G.physics, boxes = ph.boxes.filter(b => !b.bulletOnly), JUMP = 1.69, S = 0.25, spots = [];
    const covered = (x, y, z) => boxes.some(c => c.min.y > y + 0.42 && c.min.y < y + 1.15 && x > c.min.x - 0.25 && x < c.max.x + 0.25 && z > c.min.z - 0.25 && z < c.max.z + 0.25);
    const inside = (x, y, z) => boxes.some(c => y > c.min.y && y < c.max.y - 0.01 && x >= c.min.x - 1e-6 && x <= c.max.x + 1e-6 && z >= c.min.z - 1e-6 && z <= c.max.z + 1e-6);   // on a seam between two boxes counts as inside: the caps meet edge to edge
    for (const b of boxes) {
      const y = b.max.y; if (y < 0.3 || y >= 12 || b.capOf || b.rail) continue;
      const xs = b.max.x - b.min.x < S ? [(b.min.x + b.max.x) / 2] : [], zs = b.max.z - b.min.z < S ? [(b.min.z + b.max.z) / 2] : [];
      if (!xs.length) for (let x = b.min.x + S / 2; x < b.max.x; x += S) xs.push(x);
      if (!zs.length) for (let z = b.min.z + S / 2; z < b.max.z; z += S) zs.push(z);
      for (const x of xs) for (const z of zs) if (!covered(x, y, z) && !inside(x, y + 0.05, z)) spots.push({ x, y, z, r: false, walk: !!b.walk, floor: b.floor || 0 });
    }
    const grid = new Map(), key = (x, z) => Math.floor(x / 2.5) + ',' + Math.floor(z / 2.5);
    for (const s of spots) { const k = key(s.x, s.z); (grid.get(k) || grid.set(k, []).get(k)).push(s); }
    const queue = [];
    for (const s of spots) if (s.y <= JUMP && inPlay(s.x, s.z, -1.5)) { s.r = true; queue.push(s); }
    while (queue.length) {
      const a = queue.pop(), gx = Math.floor(a.x / 2.5), gz = Math.floor(a.z / 2.5);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const b of grid.get((gx + i) + ',' + (gz + j)) || []) if (!b.r && b.y <= a.y + JUMP && Math.hypot(b.x - a.x, b.z - a.z) < across) { b.r = true; b.from = a; queue.push(b); }
    }
    const got = spots.filter(s => s.r), bad = got.filter(s => (s.y > s.floor + 3.15 && !s.walk) || !inPlay(s.x, s.z, -0.4)).map(s => [+s.x.toFixed(2), +s.y.toFixed(2), +s.z.toFixed(2)]);
    const level = G.level || {}, spawnBad = (level.enemySpawns || []).filter(p => !ph.nav.isWalkable(p.pos.x, p.pos.z)).map(p => [p.pos.x, p.pos.z]);
    // how the first fault was reached, from the ground up: the place to look when one appears
    const first = got.find(s => (s.y > s.floor + 3.15 && !s.walk) || !inPlay(s.x, s.z, -0.4)), route = [];
    for (let s = first; s && route.length < 40; s = s.from) route.unshift([+s.x.toFixed(2), +s.y.toFixed(2), +s.z.toFixed(2)]);
    const hi = got.reduce((m, s) => (!m || s.y > m.y ? s : m), null), hiRoute = [];     // and how the highest place was reached
    for (let s = hi; s && hiRoute.length < 40; s = s.from) hiRoute.unshift([+s.x.toFixed(2), +s.y.toFixed(2), +s.z.toFixed(2)]);
    return { tops: spots.length, reached: got.length, roofSpots: got.filter(s => s.walk && s.y > 7).length, roofSpotsAll: spots.filter(s => s.walk && s.y > 7).length, highest: hi ? +hi.y.toFixed(2) : 0, highestRoute: hiRoute, faults: bad.slice(0, 40), faultCount: bad.length, route, spawnFaults: spawnBad, boxes: ph.boxes.length };
  }

  /* ------------------------------------------------------------------ light in the air (Stage 5), as Maram does it
     The game's light shafts come from its volumetric pass, which reads the sun's shadow map along each view ray and takes
     one box of thicker air (the level's first interiorBoxes entry). The box here is the whole compound up past the tower,
     one even thickness, so its edge is never seen. Its haze is thin in the open; where light falls past a roof's edge into
     shade it shows as a beam. Being inside that box would also count as indoors to the game, so update() clears
     render.interiorEnv, as Maram's does. */
  /* ------------------------------------------------------------------ the ground's loose stuff, close up (Ultra; a third of it on High)
     Stones and gravel from 2 to 11 cm, most where they collect at the feet of walls, and tufts of dry grass along the walls and the
     fence, moving in the wind. Built once over open yard (no slab, building, box or puddle under it), each kind one instanced mesh;
     Ultra draws all of it and the stones' shadows, High the first third (the list is shuffled, so a third is spread evenly), Medium
     and Low none. No collision: nothing here is as tall as a step (42 cm), so it changes no movement anywhere. */
  function makeClutter(G, root, mats) {
    const T = G.THREE, r = rng(4242), ph = G.physics, CELL = 4, grid = new Map(), key = (i, j) => i + ',' + j;
    for (const b of ph.boxes) { if (b.bulletOnly || b.min.y > 0.3 || b.max.y < 0.02) continue;
      for (let i = Math.floor(b.min.x / CELL); i <= Math.floor(b.max.x / CELL); i++) for (let j = Math.floor(b.min.z / CELL); j <= Math.floor(b.max.z / CELL); j++) { const k = key(i, j); (grid.get(k) || grid.set(k, []).get(k)).push(b); } }
    const hitBox = (x, z, pad) => (grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) || []).some(b => x > b.min.x - pad && x < b.max.x + pad && z > b.min.z - pad && z < b.max.z + pad);
    const fps = [...BUILDINGS, ...HANGARS].map(b => b.at);
    const inPud = (x, z) => PUDDLES.some(p => { const c = Math.cos(p.rot), sn = Math.sin(p.rot), dx = x - p.x, dz = z - p.z, u = dx * c + dz * sn, v = -dx * sn + dz * c; return (u / (p.rx * 1.15)) ** 2 + (v / (p.rz * 1.15)) ** 2 < 1; });
    const open = (x, z) => inPlay(x, z, 0.25) && !GROUND_SLABS.some(q => x > q[0] - 0.1 && x < q[2] + 0.1 && z > q[1] - 0.1 && z < q[3] + 0.1) && !fps.some(f => x > f[0] - 0.04 && x < f[2] + 0.04 && z > f[1] - 0.04 && z < f[3] + 0.04) && !hitBox(x, z, 0.04) && !inPud(x, z);
    const edges = f => [[f[0], f[1], f[2], f[1], 0, -1], [f[2], f[1], f[2], f[3], 1, 0], [f[2], f[3], f[0], f[3], 0, 1], [f[0], f[3], f[0], f[1], -1, 0]];
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    // stones: scattered over the yard, thicker along the walls' feet
    const S = [];
    for (let x = FENCE.x0; x < FENCE.x1; x += 0.65) for (let z = FENCE.z0; z < FENCE.z1; z += 0.65) { if (r() > 0.85) continue; const px = x + r() * 0.65, pz = z + r() * 0.65; if (!open(px, pz)) continue; const t = r(); S.push([px, pz, t < 0.6 ? 0.03 + r() * 0.02 : t < 0.92 ? 0.05 + r() * 0.04 : 0.09 + r() * 0.05]); }
    for (const f of fps) for (const [ax, az, bx, bz, nx, nz] of edges(f)) { const L = Math.hypot(bx - ax, bz - az); for (let u = 0; u < L; u += 0.3) { if (r() > 0.65) continue; const t = u / L, d = 0.07 + r() * r() * 0.8, px = ax + (bx - ax) * t + nx * d, pz = az + (bz - az) * t + nz * d; if (open(px, pz)) S.push([px, pz, 0.025 + r() * 0.055]); } }
    shuffle(S);
    const PAL = [[1.35, 1.4, 1.5], [1.2, 1.25, 1.35], [1.0, 1.0, 1.04], [1.5, 1.52, 1.6], [1.25, 1.2, 1.18], [0.78, 0.79, 0.84], [1.15, 1.02, 0.94]];      // over the rock picture's own pink-orange: pale greys and tans, as the yard's dust
    const stoneGeo = new T.IcosahedronGeometry(1, 1);
    { const p = stoneGeo.attributes.position, nn = new Float32Array(p.count * 3);       // dented out of round (the same corner moves the same way in each face it belongs to), shaded smooth
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), l = Math.hypot(x, y, z), h = 0.8 + 0.34 * (Math.abs(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453) % 1); nn.set([x / l, y / l, z / l], i * 3); p.setXYZ(i, x * h, y * h, z * h); }
      stoneGeo.setAttribute('normal', new T.BufferAttribute(nn, 3)); }
    const stoneTex = mats.desert.map.clone(); stoneTex.repeat.set(1, 1); stoneTex.needsUpdate = true;
    const stoneMat = new T.MeshStandardMaterial({ map: stoneTex, roughness: 0.92, metalness: 0 }); stoneMat.name = 'a51_pebbles';
    const stones = new T.InstancedMesh(stoneGeo, stoneMat, S.length), M = new T.Matrix4(), Q = new T.Quaternion(), E = new T.Euler(), P = new T.Vector3(), SC = new T.Vector3(), C = new T.Color();
    S.forEach(([x, z, sz], i) => { E.set((r() - 0.5) * 0.5, r() * TAU, (r() - 0.5) * 0.5); Q.setFromEuler(E); SC.set(sz * (0.8 + 0.4 * r()), sz * (0.4 + 0.3 * r()), sz * (0.75 + 0.4 * r())); P.set(x, SC.y * 0.35, z); M.compose(P, Q, SC); stones.setMatrixAt(i, M);
      const c = PAL[Math.floor(r() * PAL.length)], g = 0.85 + 0.25 * r(); C.setRGB(c[0] * g, c[1] * g, c[2] * g); stones.setColorAt(i, C); });
    stones.name = 'a51:pebbles'; stones.receiveShadow = true; stones.castShadow = true; stones.frustumCulled = false; root.add(stones);      // layer 0 only: layer 1 is drawn over everything (the gun's pass), and there the stones floated over what stood in front of them
    // dry grass: tufts along the walls' feet and the fence
    const U = [];
    for (const f of fps) for (const [ax, az, bx, bz, nx, nz] of edges(f)) { const L = Math.hypot(bx - ax, bz - az); for (let u = 0; u < L; u += 0.5) { if (r() > 0.7) continue; const t = u / L, d = 0.12 + r() * 0.55, px = ax + (bx - ax) * t + nx * d, pz = az + (bz - az) * t + nz * d; if (open(px, pz)) U.push([px, pz, 0.22 + r() * 0.26]); } }
    for (const [ax, az, bx, bz, nx, nz] of [[FENCE.x0, FENCE.z0, FENCE.x1, FENCE.z0, 0, 1], [FENCE.x1, FENCE.z0, FENCE.x1, FENCE.z1, -1, 0], [FENCE.x1, FENCE.z1, FENCE.x0, FENCE.z1, 0, -1], [FENCE.x0, FENCE.z1, FENCE.x0, FENCE.z0, 1, 0]]) {
      const L = Math.hypot(bx - ax, bz - az); for (let u = 0; u < L; u += 0.6) { if (r() > 0.7) continue; const t = u / L, d = 0.25 + r() * 0.8, px = ax + (bx - ax) * t + nx * d, pz = az + (bz - az) * t + nz * d; if (open(px, pz)) U.push([px, pz, 0.25 + r() * 0.3]); } }
    for (let x = FENCE.x0; x < FENCE.x1; x += 5) for (let z = FENCE.z0; z < FENCE.z1; z += 5) { if (r() > 0.35) continue; const cx = x + r() * 5, cz = z + r() * 5; for (let k = 0; k < 3; k++) { const px = cx + (r() - 0.5) * 0.7, pz = cz + (r() - 0.5) * 0.7; if (open(px, pz)) U.push([px, pz, 0.18 + r() * 0.2]); } }     // a few clumps out in the open
    shuffle(U);
    const gc = document.createElement('canvas'); gc.width = gc.height = 128; const gg = gc.getContext('2d'), rb = rng(77);
    for (let k = 0; k < 30; k++) { const x0 = 20 + rb() * 88, lean = (rb() - 0.5) * 70, h = 60 + rb() * 66; gg.strokeStyle = ['#c9b98a', '#a8956a', '#d8cba0', '#8f7f58', '#b8a77a'][k % 5]; gg.lineWidth = 1.2 + rb() * 1.4; gg.beginPath(); gg.moveTo(x0, 128); gg.quadraticCurveTo(x0 + lean * 0.3, 128 - h * 0.6, x0 + lean, 128 - h); gg.stroke(); }
    const gt = new T.CanvasTexture(gc); gt.colorSpace = T.SRGBColorSpace;
    const tg = new T.BufferGeometry(), tp = [], tu = [], tn = [], ti = [];
    for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI, dx = Math.cos(a) * 0.5, dz = Math.sin(a) * 0.5, b = tp.length / 3; tp.push(-dx, 0, -dz, dx, 0, dz, dx, 1, dz, -dx, 1, -dz); tu.push(0, 0, 1, 0, 1, 1, 0, 1); tn.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0); ti.push(b, b + 1, b + 2, b, b + 2, b + 3); }
    tg.setAttribute('position', new T.Float32BufferAttribute(tp, 3)); tg.setAttribute('uv', new T.Float32BufferAttribute(tu, 2)); tg.setAttribute('normal', new T.Float32BufferAttribute(tn, 3)); tg.setIndex(ti);
    const tm = mats.backlit(new T.MeshStandardMaterial({ map: gt, alphaTest: 0.5, side: T.DoubleSide, roughness: 0.95, metalness: 0 }), 0.5); tm.name = 'a51_grass';
    { const ob = tm.onBeforeCompile; tm.onBeforeCompile = (sh, rr) => { ob(sh, rr); sh.uniforms.uTime = mats.wind; sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  #ifdef USE_INSTANCING
  { vec2 gp = instanceMatrix[3].xz; float gw = uv.y * uv.y; transformed.x += sin(uTime * 1.8 + gp.x * 0.7 + gp.y * 0.4) * 0.07 * gw; transformed.z += cos(uTime * 1.3 + gp.y * 0.6) * 0.05 * gw; }
  #endif`); }; }
    const tufts = new T.InstancedMesh(tg, tm, U.length);
    U.forEach(([x, z, h], i) => { E.set(0, r() * TAU, 0); Q.setFromEuler(E); SC.set(h * (0.9 + 0.4 * r()), h, h * (0.9 + 0.4 * r())); P.set(x, 0, z); M.compose(P, Q, SC); tufts.setMatrixAt(i, M); const g = 0.8 + 0.3 * r(); C.setRGB(g, g * 0.97, g * 0.9); tufts.setColorAt(i, C); });
    tufts.name = 'a51:grass'; tufts.receiveShadow = true; tufts.castShadow = false; tufts.frustumCulled = false; root.add(tufts);
    const NS = S.length, NU = U.length;
    return { stones: NS, tufts: NU, set(q) { stones.count = q >= 3 ? NS : q === 2 ? Math.floor(NS * 0.35) : 0; stones.visible = stones.count > 0; stones.castShadow = q >= 3;
      tufts.count = q >= 3 ? NU : q === 2 ? Math.floor(NU * 0.4) : 0; tufts.visible = tufts.count > 0; } };
  }

  /* The game's sound also reads interiorBoxes: a listener inside any of them is indoors, and every shot, step and impact goes
     through its shed reverb (the outdoor one at a tenth). The air box covers the whole compound, so the whole map echoed like a
     shed (he heard it, 24 Nov). Nothing here is indoors, so the sound's update never sees the air box; the light still does.
     The audio is made after the level, so this is put in place from the first frame's update. */
  function outdoorSound(G, box) {
    const au = G.audio; if (!au || !au.update || au._airHidden) return;
    const up = au.update; au._airHidden = true;
    au.update = function (dt) {
      const lv = G.level, all = lv && lv.interiorBoxes;
      if (!Array.isArray(all) || !all.includes(box)) return up.call(this, dt);
      const rest = all.filter(b => b !== box); lv.interiorBoxes = rest;
      if (!rest.length && au.setInterior) au.setInterior(0);      // an empty list leaves the sound's last answer standing
      try { return up.call(this, dt); } finally { lv.interiorBoxes = all; }
    };
  }

  function makeAir(G) {
    const T = G.THREE, tune = G.render.tune, thick = tune && Object.keys(tune).find(k => k.startsWith('volInterior'));
    const box = { min: new T.Vector3(WORLD.x0 - 6, -1, WORLD.z0 - 6), max: new T.Vector3(WORLD.x1 + 6, 40, WORLD.z1 + 6) };
    if (thick) tune[thick] = 0.45;           // thin: at 1.4 every shadow's edge glowed like smoke
    return { box, near: 0, cells: null, update(eye) {        // how close the eye is to a covered place: the motes thicken there
      const c = this.cells; if (!c) return 0; let bd = 9;
      const gx = Math.floor(eye.x / 2), gz = Math.floor(eye.z / 2);
      for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) if (c.has((gx + i) + ',' + (gz + j))) bd = Math.min(bd, Math.max(0, Math.hypot(i, j) * 2 - 1.4));
      return (this.near = bd === 0 ? 1 : Math.max(0.3, 1 - bd / 8)); } };
  }
  /* Motes: grains in the air round the eye, drawn only where the sun reaches them (each looks up the sun's shadow map, as
     the volumetric pass does), brighter looking toward the sun, thicker near the covered places. Maram's, as they are. */
  const MOTE_V = `
uniform sampler2D tShadow; uniform mat4 uShadowMatrix; uniform float uHasShadow, uTime, uNear, uPx; uniform vec3 uCam, uSunDir;
attribute vec4 seed; varying float vA;
float sunVis(vec3 p){
  vec4 sc = uShadowMatrix * vec4(p, 1.0);
  if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0 || sc.z < 0.0) return 1.0;
  float d = dot(texture2D(tShadow, sc.xy), vec4(0.99609375, 0.99609375 / 256.0, 0.99609375 / 65536.0, 1.0 / 16777216.0));
  return step(sc.z - 0.0008, d);
}
void main(){
  vec3 room = vec3(24.0, 9.0, 24.0);
  vec3 p = seed.xyz * room + vec3(sin(uTime * 0.21 + seed.w * 6.283) * 0.6, uTime * 0.035 + sin(uTime * 0.5 + seed.w * 9.0) * 0.15, cos(uTime * 0.17 + seed.w * 4.0) * 0.6);
  p = mod(p - uCam + room * 0.5, room) - room * 0.5 + uCam;
  vec3 v = p - uCam; float d = length(v);
  float sh = uHasShadow > 0.5 ? sunVis(p) : 0.6;
  float fwd = max(dot(v / max(d, 1e-3), uSunDir), 0.0);
  float edge = smoothstep(12.0, 6.0, d) * smoothstep(0.35, 1.2, d);
  vA = sh * edge * (0.18 + 0.82 * uNear) * (0.35 + 1.4 * pow(fwd, 6.0)) * (0.6 + 0.4 * seed.w);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uPx * (0.012 + 0.01 * seed.w) / max(-mv.z, 0.1), 1.0, 5.0);
}`;
  const MOTE_F = `
uniform vec3 uCol; varying float vA;
void main(){
  vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.1, length(c)) * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uCol * a, a);
}`;
  function makeMotes(G, root, air) {
    const T = G.THREE, q = (G.quality && G.quality.name) || 'high', n = { low: 400, medium: 900, high: 1500, ultra: 2200 }[q] || 1500, seed = new Float32Array(n * 4), r = rng(7);
    for (let i = 0; i < n * 4; i++) seed[i] = r();
    const g = new T.BufferGeometry(); g.setAttribute('seed', new T.BufferAttribute(seed, 4)); g.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3));
    const sun = G.render.sun, u = { tShadow: { value: null }, uShadowMatrix: { value: new T.Matrix4() }, uHasShadow: { value: 0 }, uTime: { value: 0 }, uNear: { value: 0 }, uPx: { value: 800 },
      uCam: { value: new T.Vector3() }, uSunDir: { value: G.consts.sun.dir.clone().normalize() }, uCol: { value: new T.Color(1.0, 0.9, 0.72).multiplyScalar(2.0) } };
    const m = new T.ShaderMaterial({ uniforms: u, vertexShader: MOTE_V, fragmentShader: MOTE_F, transparent: true, depthWrite: false, blending: T.AdditiveBlending });
    const pts = new T.Points(g, m); pts.frustumCulled = false; pts.name = 'a51:motes'; pts.renderOrder = 5; root.add(pts);
    const size = new T.Vector2(), eye = new T.Vector3();
    pts.onBeforeRender = (renderer, scene, cam) => {          // read from the camera actually drawn with
      if (!cam || !cam.isPerspectiveCamera) return;
      eye.setFromMatrixPosition(cam.matrixWorld); u.uNear.value = air.update(eye); u.uCam.value.copy(eye);
      const map = sun && sun.shadow && sun.shadow.map; u.tShadow.value = map ? map.texture : null; u.uHasShadow.value = map ? 1 : 0; if (map) u.uShadowMatrix.value.copy(sun.shadow.matrix);
      renderer.getDrawingBufferSize(size); u.uPx.value = size.y * 0.5 / Math.tan((cam.fov || 70) * Math.PI / 360);
    };
    return { count: n, update(t) { u.uTime.value = t; } };
  }
  /* Beams, drawn: the haze is too thin to show light past a roof's edge into its shade, and its thickness is fixed when the
     game starts. For every floor square under a roof 1.9 to 7 m up that the sun reaches (a ray toward the sun gets out), a
     soft ribbon runs from the floor back up the sun's ray past the roof, turned to the eye; side by side they make a beam as
     wide as the light. Under the porches, the balcony, the canopy, the awnings and lean-tos, the sail over the dock; under the
     camo net, which lets light through its cut-outs, thinner ones from everywhere under it. */
  const BEAM_V = `
attribute float aSide, aAlong, aSeed, aK; uniform vec3 uSun; uniform float uW;
varying vec2 vUv; varying float vSeed, vEnd, vK;
void main(){
  vec3 p = position, toCam = normalize(cameraPosition - p);
  vec3 side = cross(uSun, toCam); float s = length(side); side = s > 1e-3 ? side / s : vec3(1.0, 0.0, 0.0);
  p += side * aSide * uW * (0.55 + 0.45 * aK);
  vUv = vec2(aSide, aAlong); vSeed = aSeed; vK = aK; vEnd = 1.0 - 0.75 * pow(abs(dot(toCam, uSun)), 4.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
  const BEAM_F = `
uniform vec3 uCol; uniform float uTime, uStrength; varying vec2 vUv; varying float vSeed, vEnd, vK;
void main(){
  float across = exp(-vUv.x * vUv.x * 3.2);
  float along = smoothstep(0.0, 0.1, vUv.y) * (0.5 + 0.5 * vUv.y) * smoothstep(1.0, 0.75, vUv.y);
  float drift = 0.8 + 0.2 * sin(uTime * 0.6 + vSeed * 31.0 + vUv.y * 5.0);
  float a = across * along * drift * vEnd * uStrength * vK;
  gl_FragColor = vec4(uCol * a, a);
}`;
  function makeBeams(G, root, air) {
    const T = G.THREE, ph = G.physics, sd = G.consts.sun.dir.clone().normalize(), C = 0.75, o = new T.Vector3(), q = new T.Vector3(), up = new T.Vector3(0, 1, 0), rays = [], cells = new Set();
    const lit = (x, y, z) => { q.set(x, y, z); return !ph.raycast(q, sd, 150); };
    const NET = [32.4, -32.4, 39.8, -25.2], underNet = (x, z) => x > NET[0] + 0.2 && x < NET[2] - 0.2 && z > NET[1] + 0.2 && z < NET[3] - 0.2;
    for (let x = WORLD.x0 + C / 2; x < WORLD.x1; x += C) for (let z = WORLD.z0 + C / 2; z < WORLD.z1; z += C) {
      if (!ph.nav.isWalkable(x, z)) continue;
      const y = ph.groundHeight(x, z, 2.5);
      if (underNet(x, z)) { cells.add(Math.floor(x / 2) + ',' + Math.floor(z / 2)); if ((Math.round(x / C) + Math.round(z / C)) % 2 === 0 && lit(x, y + 0.05, z)) rays.push([x, y, z, Math.max(0.5, 3.4 - y) / Math.max(sd.y, 0.2), 0.45]); continue; }
      o.set(x, y + 0.2, z); const h = ph.raycast(o, up, 7);
      if (h && h.dist > 1.7 && h.dist < 6.8) cells.add(Math.floor(x / 2) + ',' + Math.floor(z / 2));       // under a roof: the motes thicken there, but no beam is drawn (an open-sided roof at noon throws none: they stood out as white plumes)
    }
    air.cells = cells;
    if (((G.quality && G.quality.name) || 'high') === 'low') rays.length = 0;         // none at all on low
    const n = rays.length, P = new Float32Array(n * 12), side = new Float32Array(n * 4), along = new Float32Array(n * 4), seed = new Float32Array(n * 4), kk = new Float32Array(n * 4), idx = [], r = rng(31);
    rays.forEach(([x, y, z, L, k], i) => {
      const e = [x + sd.x * L, y + sd.y * L, z + sd.z * L], sv0 = r();
      [[x, y, z, -1, 0], [x, y, z, 1, 0], [...e, -1, 1], [...e, 1, 1]].forEach(([px, py, pz, sv, av], j) => { const v = i * 4 + j; P.set([px, py, pz], v * 3); side[v] = sv; along[v] = av; seed[v] = sv0; kk[v] = k; });
      const b = i * 4; idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
    });
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(P, 3)); g.setAttribute('aSide', new T.BufferAttribute(side, 1)); g.setAttribute('aAlong', new T.BufferAttribute(along, 1)); g.setAttribute('aSeed', new T.BufferAttribute(seed, 1)); g.setAttribute('aK', new T.BufferAttribute(kk, 1));
    g.setIndex(idx); g.computeBoundingSphere();
    const u = { uSun: { value: sd }, uW: { value: C * 0.42 }, uCol: { value: new T.Color(1.0, 0.9, 0.72) }, uTime: { value: 0 }, uStrength: { value: 0.3 } };
    const m = new T.ShaderMaterial({ uniforms: u, vertexShader: BEAM_V, fragmentShader: BEAM_F, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide });
    const mesh = new T.Mesh(g, m); mesh.name = 'a51:beams'; mesh.renderOrder = 4; mesh.frustumCulled = n > 0; root.add(mesh);
    return { count: n, update(t) { u.uTime.value = t; } };
  }
  /* The windsock (4, 7): a cone of cloth in five bands on a hoop at the mast's arm. Its middle line is a chain of points left to
     the wind and their weight (Verlet steps, each link kept to length): it streams out and lifts in a gust, sags and hangs
     when the wind drops, swings round as the wind backs, and whips at its tail. The cloth is drawn round the chain, full when
     the wind fills it and flattening as it empties. On low quality it is set once and left. */
  function makeWindsock(G, root) {
    const T = G.THREE, live = ((G.quality && G.quality.name) || 'high') !== 'low', N = 10, SEG = 14, LEN = 1.8, seg = LEN / N, base = [41.25, 5.75, 9], R0 = 0.3, R1 = 0.12;
    const P = new Float32Array((N + 1) * 3), Q = new Float32Array((N + 1) * 3);
    for (let k = 0; k <= N; k++) { P.set([base[0] + k * seg, base[1] - k * k * 0.004, base[2]], k * 3); Q.set([base[0] + k * seg, base[1] - k * k * 0.004, base[2]], k * 3); }
    // rings of the drawn cloth: each band has its own first and last ring, so the colours meet in a line
    const rings = []; for (let b = 0; b < 5; b++) for (let e = 0; e <= 2; e++) rings.push([b * 2 + e, b]);
    const nv = rings.length * (SEG + 1), pos = new Float32Array(nv * 3), col = new Float32Array(nv * 3), idx = [], OR = [0.86, 0.3, 0.04], WH = [0.86, 0.84, 0.78];
    rings.forEach(([, b], r) => { for (let a = 0; a <= SEG; a++) col.set(b & 1 ? WH : OR, (r * (SEG + 1) + a) * 3); });
    for (let r = 0; r + 1 < rings.length; r++) { if (rings[r][1] !== rings[r + 1][1]) continue; for (let a = 0; a < SEG; a++) { const i0 = r * (SEG + 1) + a, i1 = i0 + SEG + 1; idx.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1); } }
    const g = new T.BufferGeometry(), pa = new T.BufferAttribute(pos, 3); pa.setUsage(T.DynamicDrawUsage);
    g.setAttribute('position', pa); g.setAttribute('color', new T.BufferAttribute(col, 3)); g.setIndex(idx); g.boundingSphere = new T.Sphere(new T.Vector3(base[0], base[1] - 0.5, base[2]), 3);
    const mesh = new T.Mesh(g, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: T.DoubleSide }));
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'a51:windsock'; mesh.matrixAutoUpdate = false; root.add(mesh);
    const hoop = new T.Mesh(new T.TorusGeometry(R0, 0.012, 5, 20), new T.MeshStandardMaterial({ color: 0x777772, roughness: 0.6, metalness: 0.6 })); hoop.name = 'a51:windsock'; hoop.matrixAutoUpdate = false; root.add(hoop);
    const tv = new T.Vector3(), sv = new T.Vector3(), uv = new T.Vector3(), UP = new T.Vector3(0, 1, 0);
    const step = (t, h) => {
      const yaw = 0.45 + 0.5 * Math.sin(t * 0.11) + 0.22 * Math.sin(t * 0.31 + 1), spd = Math.min(1.3, Math.max(0.06, 0.62 + 0.5 * Math.sin(t * 0.37) * Math.sin(t * 0.91 + 1.3) + 0.2 * Math.sin(t * 1.7)));
      const wx = Math.cos(yaw), wz = Math.sin(yaw), h2 = h * h;
      for (let k = 1; k <= N; k++) { const o = k * 3, f = k / N, fl = spd * f;
        const ax = wx * spd * 15 - wz * Math.sin(t * 7.1 + k * 0.9) * 3.2 * fl, ay = -6.5 + spd * 2.4 + Math.sin(t * 5.3 + k * 1.2) * 2.0 * fl, az = wz * spd * 15 + wx * Math.sin(t * 7.1 + k * 0.9) * 3.2 * fl;
        const x = P[o], y = P[o + 1], z = P[o + 2]; P[o] = x + (x - Q[o]) * 0.955 + ax * h2; P[o + 1] = y + (y - Q[o + 1]) * 0.955 + ay * h2; P[o + 2] = z + (z - Q[o + 2]) * 0.955 + az * h2; Q[o] = x; Q[o + 1] = y; Q[o + 2] = z; }
      for (let it = 0; it < 6; it++) for (let k = 1; k <= N; k++) { const o = k * 3, m = o - 3, dx = P[o] - P[m], dy = P[o + 1] - P[m + 1], dz = P[o + 2] - P[m + 2], d = Math.hypot(dx, dy, dz) || 1e-6, c = (d - seg) / d;
        if (k === 1) { P[o] -= dx * c; P[o + 1] -= dy * c; P[o + 2] -= dz * c; } else { P[o] -= dx * c * 0.5; P[o + 1] -= dy * c * 0.5; P[o + 2] -= dz * c * 0.5; P[m] += dx * c * 0.5; P[m + 1] += dy * c * 0.5; P[m + 2] += dz * c * 0.5; } }
      return spd;
    };
    const draw2 = (t, spd) => {
      const full = Math.min(1, Math.max(0.28, spd * 1.3));
      rings.forEach(([k], r) => { const a3 = Math.max(0, k - 1) * 3, b3 = Math.min(N, k + 1) * 3, f = k / N;
        tv.set(P[b3] - P[a3], P[b3 + 1] - P[a3 + 1], P[b3 + 2] - P[a3 + 2]).normalize(); sv.crossVectors(tv, UP); if (sv.lengthSq() < 1e-6) sv.set(0, 0, 1); sv.normalize(); uv.crossVectors(sv, tv);
        const rr = (R0 + (R1 - R0) * f) * (k === 0 ? 1 : 0.5 + 0.5 * full), ru = rr * (k === 0 ? 1 : 0.45 + 0.55 * full);
        for (let a = 0; a <= SEG; a++) { const an = a / SEG * 6.2832, w = 1 + 0.07 * Math.sin(t * 11 + k * 1.7 + an * 3) * spd * f, cs = Math.cos(an) * rr * w, sn = Math.sin(an) * ru * w, o = (r * (SEG + 1) + a) * 3;
          pos[o] = P[k * 3] + sv.x * cs + uv.x * sn; pos[o + 1] = P[k * 3 + 1] + sv.y * cs + uv.y * sn - (1 - full) * rr * 0.5 * f; pos[o + 2] = P[k * 3 + 2] + sv.z * cs + uv.z * sn; } });
      pa.needsUpdate = true; g.computeVertexNormals();
      tv.set(P[3] - P[0], P[4] - P[1], P[5] - P[2]).normalize(); hoop.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), tv); hoop.position.set(base[0], base[1], base[2]); hoop.updateMatrix();
    };
    let spd0 = 0.6; for (let k = 0; k < 240; k++) spd0 = step(k / 60, 1 / 60); draw2(4, spd0);
    return { update(t, dt) { if (!live) return; const n = Math.min(3, Math.max(1, Math.round((dt || 1 / 60) * 60))); let sp = 0.6; for (let k = 0; k < n; k++) sp = step(t, 1 / 60); draw2(t, sp); } };
  }
  /* Cloth: the picnic canopy's six sheets and the dock's sail (the build lists them). Each is a grid of points joined to its
     neighbours and across its squares; some are held (a ridge, a rafter, a corner), the rest hang by their weight and move in
     the wind: Verlet steps, each join pulled back to its length a few times a step (cloth does not push, so only a join
     stretched too far is corrected). The wind presses on a sheet by how squarely it faces it and in waves of pressure
     crossing the yard, so a sheet bellies, lifts and snaps. Low quality hangs them once and leaves them; medium moves them
     every other frame; high and ultra every frame. */
  function makeCloths(G, root, specs, mats) {
    const T = G.THREE, q = (G.quality && G.quality.name) || 'high', live = q !== 'low', every = q === 'medium' ? 2 : 1, list = [], WX = 0.86, WZ = 0.5;
    // canvas as the pictures show it: sun-faded, blotched lighter and darker, a seam or two, a stitched patch
    const clothTex = (kind, seed) => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), r = rng(900 + seed * 13), P = kind === 'cream' ? ['#e4dfd2', '#efebe0', '#cdc5b0', '#d9d1bc', '#bdb399'] : ['#77734a', '#8a8150', '#5e663a', '#978b5c', '#565831'];
      g.fillStyle = P[0]; g.fillRect(0, 0, 256, 256);
      for (let k = 0; k < 46; k++) { const x = r() * 256, y = r() * 256, rad = 14 + r() * 46, gr = g.createRadialGradient(x, y, 2, x, y, rad), col = P[1 + Math.floor(r() * 3)]; gr.addColorStop(0, col); gr.addColorStop(1, col + '00'); g.globalAlpha = 0.25 + r() * 0.3; g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
      g.globalAlpha = 0.5; g.strokeStyle = P[4]; g.lineWidth = 1.5; for (const u of [85, 171]) { g.beginPath(); g.moveTo(u, 0); g.lineTo(u, 256); g.stroke(); }                 // seams
      g.globalAlpha = 0.9; const px = 40 + r() * 130, py = 40 + r() * 130, pw = 34 + r() * 22, ph2 = 26 + r() * 18; g.fillStyle = P[3]; g.fillRect(px, py, pw, ph2);              // a patch, stitched round
      g.setLineDash([3, 3]); g.strokeStyle = P[4]; g.lineWidth = 1; g.strokeRect(px + 2, py + 2, pw - 4, ph2 - 4); g.setLineDash([]); g.globalAlpha = 1;
      if (kind === 'cream') {          // the dock's sails (119): sun-bleached canvas mended with tan patches, a corner reinforced, grime toward the hems
        for (let k = 0; k < 3; k++) { const qx = 20 + r() * 190, qy = 20 + r() * 190, qw = 28 + r() * 48, qh = 22 + r() * 40; g.globalAlpha = 0.75; g.fillStyle = ['#c8b48a', '#d6c69e', '#b8a47c'][k]; g.fillRect(qx, qy, qw, qh);
          g.globalAlpha = 0.6; g.setLineDash([2, 3]); g.strokeStyle = '#8f8262'; g.lineWidth = 1; g.strokeRect(qx + 2, qy + 2, qw - 4, qh - 4); g.setLineDash([]); }
        g.globalAlpha = 0.8; g.fillStyle = '#cdbb92'; g.beginPath(); g.moveTo(0, 0); g.lineTo(46, 0); g.lineTo(0, 46); g.closePath(); g.fill();       // the corner where it is tied
        for (const [x0, y0, x1, y1] of [[0, 0, 0, 30], [0, 256, 0, 226], [0, 0, 30, 0], [256, 0, 226, 0]]) { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, 'rgba(120,108,84,0.45)'); gr.addColorStop(1, 'rgba(120,108,84,0)'); g.globalAlpha = 1; g.fillStyle = gr; g.fillRect(0, 0, 256, 256); }
        g.globalAlpha = 0.18; g.strokeStyle = '#8a7c5c'; g.lineWidth = 2; for (let k = 0; k < 7; k++) { const x = r() * 256; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 20, 60 + r() * 120); g.stroke(); }     // rain streaks off the hem
        g.globalAlpha = 1; }
      const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; return t; };
    for (const [ci, s] of specs.entries()) {
      const nu = s.nu, nv = s.nv, W1 = nu + 1, n = W1 * (nv + 1), pos = new Float32Array(n * 3), prev = new Float32Array(n * 3), pin = new Uint8Array(n), uvs = new Float32Array(n * 2), id = (i, j) => j * W1 + i, cons = [], idx = [];
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const p3 = s.at(i / nu, j / nv), k = id(i, j); pos.set(p3, k * 3); prev.set(p3, k * 3); pin[k] = s.pin && s.pin(i, j, nu, nv) ? 1 : 0;
        if (s.uv) { uvs[k * 2] = p3[0] / s.uv; uvs[k * 2 + 1] = p3[2] / s.uv; } else { uvs[k * 2] = i / nu; uvs[k * 2 + 1] = j / nv; } }
      for (const [px, pz] of s.pinAt || []) { let best = 0, bd = 1e9; for (let k = 0; k < n; k++) { const d = Math.hypot(pos[k * 3] - px, pos[k * 3 + 2] - pz); if (d < bd) { bd = d; best = k; } } pin[best] = 1; }     // held at the point nearest each pole
      const link = (a, b) => { cons.push(a, b, Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]) * s.slack); };
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { if (i < nu) link(id(i, j), id(i + 1, j)); if (j < nv) link(id(i, j), id(i, j + 1));
        if (i < nu && j < nv) { link(id(i, j), id(i + 1, j + 1)); link(id(i + 1, j), id(i, j + 1)); idx.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1)); } }
      const g = new T.BufferGeometry(), pa = new T.BufferAttribute(pos, 3); pa.setUsage(T.DynamicDrawUsage);
      g.setAttribute('position', pa); g.setAttribute('uv', new T.BufferAttribute(uvs, 2)); g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere(); g.boundingSphere.radius += 1.5;
      const m = mats.backlit(s.net ? new T.MeshStandardMaterial({ map: mats.net.map, alphaTest: 0.45, roughness: 0.95, metalness: 0, side: T.DoubleSide })
        : s.tex ? new T.MeshStandardMaterial({ map: clothTex(s.tex, s.seed || 0), roughness: 0.93, metalness: 0, side: T.DoubleSide })
        : new T.MeshStandardMaterial({ color: new T.Color(s.color[0], s.color[1], s.color[2]), roughness: 0.93, metalness: 0, side: T.DoubleSide }), s.net ? 0.35 : 0.6);
      m.name = 'a51_cloth' + ci;
      m.name = 'a51_cloth'; const mesh = new T.Mesh(g, m); mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'a51:cloth'; mesh.matrixAutoUpdate = false; root.add(mesh);
      list.push({ g, pa, pos, prev, pin, cons: new Float32Array(cons), n, ph: ci * 1.7, calm: s.calm == null ? 1 : s.calm });
    }
    const step = (c, t, h) => {
      const P = c.pos, Q = c.prev, Nn = c.g.attributes.normal.array, h2 = h * h, gust = 1.0 + 0.75 * Math.sin(t * 0.37) * Math.sin(t * 0.91 + 1.3) + 0.3 * Math.sin(t * 1.9 + c.ph);
      for (let k = 0; k < c.n; k++) { if (c.pin[k]) continue; const o = k * 3, x = P[o], y = P[o + 1], z = P[o + 2], nx = Nn[o], ny = Nn[o + 1], nz = Nn[o + 2];
        const loc = Math.max(0, gust + 0.45 * Math.sin(t * 2.3 + x * 0.55 + z * 0.4) + 0.22 * Math.sin(t * 5.1 + x * 1.7 - z * 1.3));           // the gust as it crosses this point, and its flutter
        const press = ((WX * nx + WZ * nz) * 3.0 + 1.0 * Math.sin(t * 1.3 + x * 0.5 + z * 0.35 + c.ph) + 0.5 * Math.sin(t * 2.9 - x * 0.9 + z * 0.6)) * Math.min(loc, 2.2) * c.calm;   // along the sheet's own normal
        const ax = nx * press + WX * loc * 0.3, ay = ny * press - 2.4, az = nz * press + WZ * loc * 0.3;
        const lim = v => (v > 0.035 ? 0.035 : v < -0.035 ? -0.035 : v);                                    // no point moves more than 3.5 cm a step: a sheet that gains speed without end tears itself apart
        P[o] = x + lim((x - Q[o]) * 0.972 + ax * h2); P[o + 1] = y + lim((y - Q[o + 1]) * 0.972 + ay * h2); P[o + 2] = z + lim((z - Q[o + 2]) * 0.972 + az * h2); Q[o] = x; Q[o + 1] = y; Q[o + 2] = z; }
      const C = c.cons;
      for (let it = 0; it < 4; it++) for (let e = 0; e < C.length; e += 3) { const a = C[e] * 3, b = C[e + 1] * 3, dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2], d = Math.hypot(dx, dy, dz);
        if (d <= C[e + 2]) continue; const pa2 = c.pin[C[e]], pb2 = c.pin[C[e + 1]]; if (pa2 && pb2) continue; const f = (d - C[e + 2]) / d, wa = pa2 ? 0 : pb2 ? 1 : 0.5, wb = pb2 ? 0 : pa2 ? 1 : 0.5;
        P[a] += dx * f * wa; P[a + 1] += dy * f * wa; P[a + 2] += dz * f * wa; P[b] -= dx * f * wb; P[b + 1] -= dy * f * wb; P[b + 2] -= dz * f * wb; }
    };
    const show = c => { c.pa.needsUpdate = true; c.g.computeVertexNormals(); };
    for (const c of list) { for (let k = 0; k < 260; k++) { step(c, k / 60, 1 / 60); if (k % 20 === 19) c.g.computeVertexNormals(); } show(c); }     // hung before the first frame
    let frame = 0;
    return { count: list.length, update(t, dt) { if (!live || (frame++ % every)) return; const n = Math.min(2, Math.max(1, Math.round((dt || 1 / 60) * 60 * every))); for (const c of list) { for (let k = 0; k < n; k++) step(c, t, 1 / 60); show(c); } } };
  }

  /* Standing water. Each puddle is a flat patch with a ragged outline, clear at its edge, lying a millimetre over its mud.
     It is a mirror: the game's sky lighting gives it the sky at every quality, and where the game's mirror pass runs (the
     pass the harbour's puddles use: the world drawn upside down into a picture each frame; Ultra, and High at half size)
     that picture is laid in it instead, so the lorries, the hangars and the hills stand in the water. How much it mirrors
     grows as the eye drops toward it, as water does. The patches are on layer 2, which the mirror pass's camera does not
     see: a puddle drawn into the picture it is reading would be a loop. */
  const MIRROR_HIGH = 0.5, MIRROR_NEAR = { high: 16, ultra: 30 };          // the mirror pass's size at High, as a part of the screen (0: sky only at High); how near a puddle must be for the pass to run (farther off a puddle is a sliver, and the sky in it reads the same)
  let PUDDLES = [];
  const puddleAt = (x, z, grow = 1) => PUDDLES.some(p => { const c = Math.cos(p.rot), sn = Math.sin(p.rot), dx = x - p.x, dz = z - p.z, lx = (dx * c + dz * sn) / (p.rx * grow), lz = (-dx * sn + dz * c) / (p.rz * grow); return lx * lx + lz * lz < 0.7; });
  function makePuddles(G, root, specs, mats) {
    PUDDLES = specs; if (!specs.length) return null;
    const T = G.THREE, P = [], C = [], N = [], I = [], SEG = 28;
    const tri = (a, b, c) => { const ux = P[b * 3] - P[a * 3], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vz = P[c * 3 + 2] - P[a * 3 + 2]; if (uz * vx - ux * vz > 0) I.push(a, b, c); else I.push(a, c, b); };   // facing up
    for (const s of specs) { const r = rng(s.seed + 99), c = Math.cos(s.rot), sn = Math.sin(s.rot), base = P.length / 3, ph = r() * TAU, rad = [...Array(SEG)].map((_, k) => 0.8 + 0.16 * Math.sin(k / SEG * TAU * 2 + ph) + 0.09 * Math.sin(k / SEG * TAU * 5 + ph * 2) + 0.08 * (r() - 0.5));
      P.push(s.x, s.y, s.z); C.push(1, 1, 1, 1); N.push(0, 1, 0);
      for (const [f, al] of [[0.8, 1], [1, 0]]) for (let k = 0; k < SEG; k++) { const t = k / SEG * TAU, lx = Math.cos(t) * s.rx * rad[k] * f, lz = Math.sin(t) * s.rz * rad[k] * f; P.push(s.x + lx * c - lz * sn, s.y, s.z + lx * sn + lz * c); C.push(1, 1, 1, al); N.push(0, 1, 0); }
      for (let k = 0; k < SEG; k++) { const k1 = (k + 1) % SEG, a = base + 1 + k, b = base + 1 + k1, o = base + 1 + SEG + k, o1 = base + 1 + SEG + k1; tri(base, a, b); tri(a, o, o1); tri(a, o1, b); } }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(N, 3)); g.setAttribute('color', new T.Float32BufferAttribute(C, 4)); g.setIndex(I); g.computeBoundingSphere();
    const m = new T.MeshStandardMaterial({ color: 0x4e4032, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.9, depthWrite: false, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 });
    m.name = 'a51_puddle'; const fade = { value: 0 }, nearU = { value: 16 }, fr = new T.Frustum(), pm = new T.Matrix4(), sph = new T.Sphere(); let last = performance.now(); const black = new T.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true;
    m.onBeforeCompile = sh => { const gu = (G.ground && G.ground.uniforms) || {};
      sh.uniforms.uRefl = gu.uRefl || { value: black }; sh.uniforms.uReflOn = gu.uReflOn || { value: 0 }; sh.uniforms.uReflMatrix = gu.uReflMatrix || { value: new T.Matrix4() }; sh.uniforms.uReflLod = gu.uReflLod || { value: 0 }; sh.uniforms.uPT = mats.wind; sh.uniforms.uPM = fade; sh.uniforms.uPN = nearU;
      sh.vertexShader = 'varying vec3 vPW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      const f = sh.fragmentShader, A = '#include <lights_fragment_maps>', B = '#include <lights_fragment_end>';
      const CF = '#include <color_fragment>';
      if (f.split(A).length !== 2 || f.split(B).length !== 2 || f.split(CF).length !== 2) { console.warn('[area51] the puddle shader anchors moved; the puddles mirror the sky only'); return; }
      /* Looked down into, water is clear: the wet mud under it shows through and the sky's reflection is faint (a black hole from above
         otherwise, 24 Nov); toward the horizon it turns to a mirror. So it is half as opaque looking straight down as along the ground */
      sh.fragmentShader = 'uniform sampler2D uRefl; uniform float uReflOn, uReflLod, uPT, uPM, uPN; uniform mat4 uReflMatrix; varying vec3 vPW; vec3 pRad; float pF;\n' + f.replace(CF, CF + `
  { vec3 pV0 = normalize(cameraPosition - vPW); diffuseColor.a *= mix(0.5, 1.0, pow(1.0 - clamp(pV0.y, 0.0, 1.0), 1.6)); }`).replace(A, A + `
  { vec3 pV = normalize(cameraPosition - vPW); float pd = length(cameraPosition - vPW);
    vec2 rp = vec2(sin(vPW.x * 7.0 + uPT * 1.3) + sin(vPW.z * 5.3 - uPT * 0.9), cos(vPW.z * 6.1 + uPT * 1.1) + sin(vPW.x * 4.7 + uPT * 0.7)) * 0.0014 / (1.0 + pd * 0.08);      // the wind's ripple
    vec4 rc = uReflMatrix * vec4(vPW.x, 0.0, vPW.z, 1.0); vec2 ruv = rc.xy / max(rc.w, 1e-4) + rp;
    vec3 pr = min(textureLod(uRefl, clamp(ruv, vec2(0.002), vec2(0.998)), 0.7 + uReflLod).rgb, vec3(48.0));
    pRad = mix(radiance, pr, uReflOn * uPM * (1.0 - smoothstep(uPN * 0.6, uPN * 0.95, pd))); pF = 0.1 + 0.8 * pow(1.0 - clamp(pV.y, 0.0, 1.0), 3.6); }`).replace(B, B + `
  reflectedLight.indirectSpecular = pRad * pF; reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(10.0));`); };
    m.customProgramCacheKey = () => 'a51-puddle';
    const mesh = new T.Mesh(g, m); mesh.name = 'a51:puddles'; mesh.layers.set(2); mesh.receiveShadow = true; mesh.castShadow = false; mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; mesh.renderOrder = 3; root.add(mesh);
    if (G.camera) G.camera.layers.enable(2);
    return { count: specs.length, mesh,
      /* The mirror pass draws the whole world a second time (at High it roughly doubled the frame time, measured on a busy machine), so it runs
         only while a puddle is within MIRROR_NEAR of the eye (16 m at High, 30 m at Ultra) and in view, eased in and out over a third of a second, and the picture itself comes into
         the water over the last stretch of the walk up to it (60 to 95% of that distance), so nothing pops; the rest of the time the puddles mirror the sky, which costs nothing. */
      update() { const gr = G.ground, q = G.quality, cam = G.camera, now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now; if (!gr || !gr.planar || !q || !cam) return;
        if (!cam.layers.isEnabled(2)) cam.layers.enable(2);
        if (MIRROR_HIGH && q.name === 'high' && !q.planar) q.planar = MIRROR_HIGH;
        let want = false;
        const near = MIRROR_NEAR[q.name] || 16; nearU.value = near;
        if (q.planar > 0) { fr.setFromProjectionMatrix(pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)); for (const p of specs) { sph.center.set(p.x, 0, p.z); sph.radius = Math.max(p.rx, p.rz); if (cam.position.distanceToSquared(sph.center) < near * near && fr.intersectsSphere(sph)) { want = true; break; } } }
        fade.value = Math.max(0, Math.min(1, fade.value + (want ? 3 : -3) * dt)); gr.planar.enabled = want || fade.value > 0; } };
  }

  /* Falling (he asked, 24 Nov: "from the height of the building if we fall, it takes like 80"). The game takes (speed - 16) x 5 for a
     landing faster than 16 m/s, which off these roofs is only 7 to 15. Here the fall is measured from the highest point since the
     feet left the ground and topped up to: nothing under 4.5 m (a jump off the balcony), 80 at 8.55 m (a jump over the roof's
     parapet: 75 to 82, measured), more past that. Taken through the player's own damage, so in a match a death goes through the room's own handling
     ("You went down", or the kill to whoever hit them in the last five seconds). */
  const FALL = { from: 4.5, full: 8.55, at: 80 };
  function fallDamage(G, rescued) {
    let peak = null, vmax = 0, seen = 0;
    return () => {
      const P = G.player; if (!P || !P.pos) return;
      if (!P.alive || P.enabled === false || rescued() !== seen) { seen = rescued(); peak = null; vmax = 0; return; }
      if (!P.onGround) { peak = peak === null ? P.pos.y : Math.max(peak, P.pos.y); vmax = Math.max(vmax, -(P.vel ? P.vel.y : 0)); return; }
      if (peak === null) return;
      const h = peak - P.pos.y, game = Math.max(0, (vmax - 16) * 5); peak = null; vmax = 0;
      const want = h > FALL.from ? FALL.at * (h - FALL.from) / (FALL.full - FALL.from) : 0, add = Math.round(want - game);
      if (add > 0 && P.damage) { lastFall.h = h; lastFall.dmg = Math.round(want); P.damage(add, null); }
    };
  }
  const lastFall = { h: 0, dmg: 0 };

  /* The eye on the stairs. The game lifts the feet a whole tread (25 cm) at a time, and the eye with them, so walking the
     balcony stair or the dock's steps jolted on every tread. The eye rides the ramp through the middles of the treads
     instead (Maram averages the floor round the feet; with treads this tall that still jumped 21 cm), and only leaving the
     ground and landing are eased. Done
     just before each frame is drawn (never in a pre-pass: the frame copies the camera into the one that draws the gun first),
     and only on the flights, so nothing is spent anywhere else. */
  function smoothEye(G) {
    // each flight: its patch of ground (a pace to spare all round) and the ramp through the middles of its treads
    const FLIGHTS = [{ r: [-37.4, -39.7, -35.4, -34.8], y: (x, z) => Math.max(0, Math.min(3.0, 3.0 + (z + 35.65) * 0.8333)) },          // the balcony stair: twelve treads of 25 cm, 30 cm deep
      { r: [-44.5, 14.8, -39.9, 17.4], y: (x) => Math.max(0, Math.min(0.55, 0.025 + (x + 44.0) * 0.13816)) },                              // the dock's ramp: eleven steps of 5 cm
      ...ROOF_STAIRS.map(st => { const b = BUILDINGS.find(q => q.id === st.b), [x0, z0, x1, z1] = b.at, H = b.H, alongX = st.side === 'n' || st.side === 's', out = st.side === 'n' || st.side === 'w' ? -1 : 1, face = st.side === 'n' ? z0 : st.side === 's' ? z1 : st.side === 'w' ? x0 : x1;
        const uE = st.u0 + ((STAIR.N - 1) * STAIR.RUN + STAIR.LAND) * st.dir, ua = Math.min(st.u0, uE) - 0.4, ub = Math.max(st.u0, uE) + 0.4, qa = Math.min(face, face + out * (STAIR.GAP + STAIR.W + 0.1)), qb = Math.max(face, face + out * (STAIR.GAP + STAIR.W + 0.1)), rise = H / STAIR.N;
        const ramp = u => Math.max(0, Math.min(H, rise * ((u - st.u0) * st.dir / STAIR.RUN + 0.5)));
        return { r: alongX ? [ua, qa, ub, qb] : [qa, ua, qb, ub], y: alongX ? (x) => ramp(x) : (x, z) => ramp(z) }; })];                  // the roof stairs: 29 rises to 7.2 m
    let off = 0, grounded = false, last = performance.now();
    const frame = G.render.frame;
    // the eye is moved for the drawing only and put back after it, so each frame starts from the height the game itself set (telling the two apart by
    // comparing heights failed where they happened to be equal: at the stair's foot the view flicked up a tread for one frame)
    G.render.frame = function () { const y0 = place(); try { return frame.apply(this, arguments); } finally { if (y0 !== null) { G.camera.position.y = y0; G.camera.updateMatrixWorld(true); } } };
    function place() {
      const P = G.player, cam = G.camera, now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (!P || !P.alive || !cam || !P.pos) { off = 0; return null; }
      const base = cam.position.y;                                         // the height the game set
      const fl = FLIGHTS.find(f => P.pos.x > f.r[0] && P.pos.x < f.r[2] && P.pos.z > f.r[1] && P.pos.z < f.r[3]);
      if (!fl && Math.abs(off) < 1e-3) { off = 0; grounded = !!P.onGround; return null; }
      let want = 0; if (fl && P.onGround) { const d = fl.y(P.pos.x, P.pos.z) - P.pos.y; if (Math.abs(d) < 0.35) want = Math.max(-0.3, Math.min(0.3, d)); }     // only while the feet are on the flight itself
      if (fl && P.onGround && grounded) off = want; else off += (want - off) * (1 - Math.exp(-dt * (P.onGround ? 30 : 20)));
      grounded = !!P.onGround;
      cam.position.y = base + off; cam.updateMatrixWorld(true); return base;
    }
  }

  /* ------------------------------------------------------------------ the level */
  async function level(G) {
    const T = G.THREE, root = new T.Group(); root.name = 'area51'; G.scene.add(root);
    const [mats, models] = await Promise.all([makeMaterials(G), loadModels(G)]), bld = makeBuilder();
    const built = build(G, bld, models);
    buildGround(bld);
    const meshes = toMeshes(G, bld, mats, root), plants = buildPlants(G, root, mats), vehicles = placeModels(G, root, models, built.models);
    installPhysics(G, built);
    smoothEye(G);
    const shadow = fitShadows(G), sky = await makeSky(G);
    G.mats.uniforms.wet.value = 0;                                   // dry as bone
    { const emit = G.events.emit; G.events.emit = function (name, data) { if (name === 'thunder') return; return emit.call(this, name, data); }; }
    if (G.render.tune) Object.assign(G.render.tune, { aoIntensity: 1.5, aoRadius: 1.0, volSunScale: 0.45, flare: 0.08, bloom: 0.05, key: 0.24, maxExposure: 2.4 });
    const hemi = new T.HemisphereLight(new T.Color(0.78, 0.84, 1.0), new T.Color(0.86, 0.72, 0.5), 0.75);
    hemi.layers.enable(1); root.add(hemi);
    if (G.camera && G.camera.far < 1100) { G.camera.far = 1100; G.camera.updateProjectionMatrix(); }
    /* Nothing more than 3.15 m over the floor under it can be stood on (Alpine's caps, measured from the ground there): the
       floor is the highest walked-on top under a box (a roof, for what stands on a roof), or the ground. A top that high with
       open sky over it is either a rail, when it is narrow (a lamp, a downpipe's head, a wall unit: a player who lands on one
       is moved off it, as off a parapet), or, square by square (25 cm), carried up to 12 m by a box for players only. A top
       with something over it within 2.6 m is left. Never a wall in the air beside a roof: a 12 m cap there stopped jumps off
       the roof and walled every AC unit on it (24 Nov). */
    { const ph = G.physics, all = ph.boxes.filter(b => !b.bulletOnly && !b.capOf), walks = all.filter(b => b.walk && !b.rail), caps = [], C = 0.25;
      for (const b of all) { let f = 0; for (const w of walks) if (w !== b && w.max.y <= b.min.y + 0.05 && w.max.y > f && w.min.x < b.max.x && w.max.x > b.min.x && w.min.z < b.max.z && w.max.z > b.min.z) f = w.max.y; b.floor = f; }
      const list = all.filter(b => b.max.y >= b.floor + 3.15 && b.max.y < 12 && !b.rail && !b.walk);      // the rails are left open, to jump over; the roofs and the stairs' treads are walked on
      const strip = b => all.some(c => c !== b && !c.walk && !c.rail && Math.abs(c.max.y - b.max.y) < 0.2 && c.min.x <= b.max.x + 0.05 && c.max.x >= b.min.x - 0.05 && c.min.z <= b.max.z + 0.05 && c.max.z >= b.min.z - 0.05);   // a strip of a wider top (a truck's canopy, its columns side by side)
      for (const b of list) { if (Math.min(b.max.x - b.min.x, b.max.z - b.min.z) <= 0.8 && !strip(b)) { b.rail = true; b.highRail = true; continue; }
        const above = all.filter(c => c !== b && c.min.y >= b.max.y - 0.01 && c.min.y < b.max.y + 2.6 && c.min.x < b.max.x && c.max.x > b.min.x && c.min.z < b.max.z && c.max.z > b.min.z);
        const nx = Math.max(1, Math.ceil((b.max.x - b.min.x) / C - 1e-6)), nz = Math.max(1, Math.ceil((b.max.z - b.min.z) / C - 1e-6)), sx = (b.max.x - b.min.x) / nx, sz = (b.max.z - b.min.z) / nz;
        for (let j = 0; j < nz; j++) { let run = -1;
          for (let i = 0; i <= nx; i++) {
            const x = b.min.x + (i + 0.5) * sx, z = b.min.z + (j + 0.5) * sz, open = i < nx && !above.some(c => x > c.min.x && x < c.max.x && z > c.min.z && z < c.max.z);
            if (open && run < 0) run = i;
            if (!open && run >= 0) { caps.push([b.min.x + run * sx, b.max.y, b.min.z + j * sz, b.min.x + i * sx, 12, b.min.z + (j + 1) * sz]); run = -1; }
          } }
      }
      for (const c of caps) { const k = ph.addBox([c[0], c[1], c[2]], [c[3], c[4], c[5]], { surface: 'concrete', playerOnly: true, noNav: true }); if (k) k.capOf = true; }
      }
    const walkable = walkGrid(G);
    const air = makeAir(G), beams = makeBeams(G, root, air), motes = makeMotes(G, root, air), sock = makeWindsock(G, root), cloth = makeCloths(G, root, built.cloths, mats), water = makePuddles(G, root, built.puddles, mats);
    const clutter = makeClutter(G, root, mats);       // after the puddles: it keeps out of them
    // parts that turn (the search radar's head): each built in its own space round its pivot
    const spinners = built.spinners.map(sp => { const g = new T.Group(); toMeshes(G, sp.bld, mats, g); g.position.set(sp.pivot[0], sp.pivot[1], sp.pivot[2]); g.name = 'a51:spinner'; root.add(g); return { g, speed: sp.speed }; });   // after the walk grid: the beams scan it
    // spawns: only where the walk grid is free (a spawn the layout covered is dropped and said)
    const fall = fallDamage(G, () => rescues);
    const spawns = built.spawns.filter(([x, z]) => { const ok = G.physics.nav.isWalkable(x, z); if (!ok) console.warn('[area51] spawn dropped, not on open ground:', x, z); return ok; });
    // in a tight corner the game's push out of walls can fail; a player whose middle is inside a box goes back to where they last stood
    const safe = new T.Vector3(); safe.ok = false; let rescues = 0;
    const guard = () => { const P = G.player; if (!P || !P.alive || !P.pos) return; const p = P.pos, y = p.y + 0.5;
      if (G.physics.boxes.some(b => !b.bulletOnly && p.x > b.min.x && p.x < b.max.x && p.z > b.min.z && p.z < b.max.z && y > b.min.y && y < b.max.y)) { if (safe.ok) { p.copy(safe); P.vel.set(0, 0, 0); rescues++; } }
      else if (P.onGround) { safe.copy(p); safe.ok = true; } };
    const ENV = 0.45, hold = () => { if (G.scene.environmentIntensity !== ENV) G.scene.environmentIntensity = ENV; };
    hold(); { let n = 0; const tick = () => { hold(); if (++n < 600) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
    let fill = 1.1, frame = 0, clock = 0, anisoSet = false; const fwd = new T.Vector3();
    return {
      root, name: 'Area 51',
      playerStart: { pos: new T.Vector3(-57, 0, 12), yaw: -Math.PI / 2 },
      objectives: [], extraction: { pos: new T.Vector3(0, -50, 0), radius: 1 },
      enemySpawns: spawns.map(([x, z]) => ({ pos: new T.Vector3(x, 0, z), zone: 'base', type: 'ground' })),
      vaultMax: 1.65, vaultSteps: true, vaultClimb: 0.85,   // over 0.85 m a deep top (a compressor, a crate, a generator) is climbed onto: jumping at one should land you on it (he asked, 24 Nov)
        // web/vault.js: a rail beside a stair is vaulted from the stair; the next tread up does not stop it
      zones: [{ name: 'base', min: [WORLD.x0, WORLD.z0], max: [WORLD.x1, WORLD.z1] }], interiorBoxes: [air.box], coverPoints: [], skylights: [], shedLights: [], placed: built.placed,
      cinematicPath: [
        { pos: [-58, 1.8, 12], look: [-30, 3, 8] }, { pos: [-44, 2.0, 12], look: [-20, 3, -10] }, { pos: [-28, 2.2, -12], look: [0, 6, -26] }, { pos: [-6, 2.0, -12], look: [26, 12, -2] },
        { pos: [1, 2.0, 6], look: [26, 5, 18] }, { pos: [0, 1.9, 28], look: [-30, 3, 22] }, { pos: [-24, 4.6, 28], look: [-40, 3, 10] }, { pos: [-35, 5.2, 13.0], look: [-44, 2, 2] }, { pos: [-44, 1.9, 4], look: [-20, 4, -20] },     // down the apron's middle, clear of the workshop's corner and the awning's posts; up over the containers on the way back to the gate
      ],
      // the two ammunition sets: a crate on the stores dock and a crate under the camo net, at opposite ends
      ammoSpots: [{ x: -28.0, y: 1.05, z: 17.45 }, { x: 37.6, y: 1.2, z: -27.4 }],
      explosives: built.explosives, explosivesOnly: true, ambience: { sea: 0, harbour: false, rain: 0, wind: 0 },
      stats: { ...meshes, scrub: plants.tris, models: vehicles, shadow, sky, walkable, spawns: spawns.length, puddles: built.puddles.length, clutter: [clutter.stones, clutter.tufts], boxes: G.physics.boxes.length, beams: beams.count, motes: motes.count, get rescues() { return rescues; } },
      groundSurfaceAt: () => 'dirt',
      update(dt) {
        { const qn = { low: 0, medium: 1, high: 2, ultra: 3 }[(G.quality && G.quality.name) || 'high'] ?? 2; if (qn !== mats.q.value || !anisoSet) { mats.q.value = qn; anisoSet = true;
          const most = G.renderer.capabilities.getMaxAnisotropy ? G.renderer.capabilities.getMaxAnisotropy() : 1;       // Ultra: every texture filtered at the card's most (16), sharp to the horizon; below Ultra each keeps what it was given
          for (const m of Object.values(mats)) if (m && m.isMaterial) for (const k of ['map', 'normalMap', 'roughnessMap']) { const t = m[k]; if (!t || !t.isTexture) continue; if (t.userData.a51A0 == null) t.userData.a51A0 = t.anisotropy;
            const a = qn >= 3 ? Math.max(t.userData.a51A0, Math.min(most, 16)) : t.userData.a51A0; if (t.anisotropy !== a) { t.anisotropy = a; t.needsUpdate = true; } }
          clutter.set(qn); } }
        hold(); if ((frame++ & 1) === 0) guard(); fall(); clock += dt; plants.update(clock); beams.update(clock); motes.update(clock); sock.update(clock, dt); cloth.update(clock, dt); if (water) water.update(); for (const sp of spinners) sp.g.rotation.y = clock * sp.speed; mats.wind.value = clock;
        if (G.render.interiorEnv) G.render.interiorEnv = null;          // the air box is not indoors (see makeAir)
        outdoorSound(G, air.box);                                        // nor to the ears
        if (G.render.sunDir && G.camera) { const d = G.camera.getWorldDirection(fwd), e = Math.max(0, d.x * G.render.sunDir.x + d.z * G.render.sunDir.z); fill += (1.1 + 0.6 * e * e - fill) * Math.min(1, dt * 2.5); G.render.viewFill = fill; }
      },
    };
  }

  MAPS.area51 = {
    id: 'area51', name: 'Area 51', boot: ['Raising the fence', 'Parking the trucks', 'Sweeping the yard', 'Opening the gate'],
    pre, level,
    async backdrop() { return { stub: true, update() {} }; },
    // the game's ground also carries the rain: keep the object, hide the harbour's apron and sea, and let no rain fall
    async ground(G, base) {
      const g = await base();
      g.apron.visible = false; g.sea.visible = false;
      g.root.children.forEach((c, i) => { if (i === 2 && c !== g.rain) c.visible = false; });
      g.setRain(0);
      // the game eases its rain out from 0.6 over some 20 s after loading; in the desert it is gone from the first frame
      for (const o of [g.rain, g.root.getObjectByName('rainSplash')]) { const u = o && o.material && o.material.uniforms; if (u && u.uRain) u.uRain.value = 0; }
      if (g.planar) g.planar.enabled = false;                       // makePuddles turns the mirror pass on where the quality has it: the yard's puddles are its only use here
      g.isPuddle = (x, z) => puddleAt(x, z); g.puddleDepth = (x, z) => (puddleAt(x, z) ? 0.03 : -0.2); g.wetnessAt = (x, z) => (puddleAt(x, z) ? 1 : puddleAt(x, z, 1.9) ? 0.6 : 0);
      return g;
    },
    _debug: { reach: across => reach(window.__G, across), lastFall, FALL, get puddles() { return PUDDLES; }, inPlay, BUILDINGS, HANGARS, FENCE, FORE },
  };
})();
