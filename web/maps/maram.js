/* Saltline map: Maram. A walled desert town at midday: sandstone lanes, wooden doors and crates, two sites to fight
   over, a long road on one side and tunnels on the other.

   The town is a model ("maram-thin" by vrchris, sketchfab.com/vrchris, CC BY 4.0; see the README), drawn as it is,
   scaled to the game and turned so the attackers start in the west and the defenders in the east.

   How it holds together:

   - Everything drawn is solid, for players and for shots. scripts/maram-build.mjs cuts every triangle of the model
     into 25 cm columns and makes each piece a box (the only shape the game collides with); maps/maram/world.json
     holds the result. Behind the walls, where the model has nothing, is solid for players up to 17.5 m, and the tops
     of free-standing walls are carried up to that height for players only, so nobody can stand on a wall or leave
     the town. The build runs a walk-and-jump robot over the map with the game's own movement to check it.
   - That is about 40,000 boxes, too many for the game's physics to look through one by one each time. So the game's
     raycast, moveCapsule and groundHeight are replaced here by the same code over a grid of 1 m squares that knows
     which boxes are where. The copies are checked against the game's own on hundreds of rays and moves when the map
     loads; if any answer differs, the game's own are put back.
   - The game's multiplayer puts every spawn at height 0. The town has floors from 0 to 9 m, so the player's reset is
     taken over to lift each spawn onto its floor (and to face down the open lane there).
   - The minimap reads the game's walk grid, which only covers the harbour. It is answered here from the places the
     robot reached.

   The game reaches this file through the map hooks (scripts/map-hooks.mjs) and window.__G, like the other maps. */
(() => {
  'use strict';
  const MAPS = (window.__SALTLINE_MAPS = window.__SALTLINE_MAPS || {});
  const DIR = '/maps/maram/', TAU = Math.PI * 2;
  const SUN = { az: 218, el: 65 };                      // high, from the south-west (Irfan's call: low sun made the rays glare along every lane); the photograph is turned to this azimuth
  const BOUNDS = { x0: -70, z0: -60, x1: 70, z1: 60 };  // the town and its surrounding wall fit inside, with room
  const SURFACE = { sand: 'dirt' };

  /* ------------------------------------------------------------------ files: asked for as soon as the map is chosen */
  let files = null;
  const fetchFiles = () => files || (files = Promise.all([
    fetch(DIR + 'world.json').then(r => { if (!r.ok) throw new Error('world.json ' + r.status); return r.json(); }),
    fetch(DIR + 'maram.glb').then(r => { if (!r.ok) throw new Error('maram.glb ' + r.status); return r.arrayBuffer(); }),
  ]));

  /* ------------------------------------------------------------------ before the game reads its constants */
  function pre(G) {
    fetchFiles();
    const { world, sun, sky } = G.consts, el = SUN.el * Math.PI / 180, az = SUN.az * Math.PI / 180;
    world.quayX = 1e6;                                             // no quay and no sea: the ground runs everywhere
    world.min.set(BOUNDS.x0, 0, BOUNDS.z0); world.max.set(BOUNDS.x1, 40, BOUNDS.z1);
    sun.dir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    sun.color.setRGB(1.0, 0.86, 0.66);                             // a warm morning sun, gold on the stone
    sun.intensity = 7.6;
    sky.horizon.setRGB(0.98, 0.84, 0.66); sky.horizonAway.setRGB(0.64, 0.72, 0.84); sky.fog.setRGB(0.88, 0.78, 0.64);   // the photograph's horizon: warm toward the sun, hazy blue away
    if (sky.zenith) sky.zenith.setRGB(0.3, 0.46, 0.78);
  }

  /* ------------------------------------------------------------------ the model */
  function parseGlb(buf) {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('maram.glb is not a GLB file');
    const jl = dv.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
    const bl = dv.getUint32(20 + jl, true), bin = new Uint8Array(buf, 28 + jl, bl);
    return { json, bin };
  }
  const TYPED = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array }, SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  function accessor({ json, bin }, i) {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView], T = TYPED[a.componentType], n = SIZE[a.type];
    const off = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0), out = new T(a.count * n);
    out.set(new T(bin.buffer.slice(off, off + a.count * n * T.BYTES_PER_ELEMENT)));
    return out;
  }
  // the pieces the build leaves out (world.json hide: boxes in game space): every triangle wholly inside one goes
  function leaveOut(g, boxes) {
    const P = g.attributes.position, idx = g.index ? Array.from(g.index.array) : Array.from({ length: P.count }, (_, i) => i), keep = [];
    const inside = i => boxes.some(h => P.getX(i) >= h[0] && P.getX(i) <= h[3] && P.getY(i) >= h[1] && P.getY(i) <= h[4] && P.getZ(i) >= h[2] && P.getZ(i) <= h[5]);
    for (let t = 0; t < idx.length; t += 3) if (!(inside(idx[t]) && inside(idx[t + 1]) && inside(idx[t + 2]))) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    if (keep.length !== idx.length) g.setIndex(keep);
  }
  /* ------------------------------------------------------------------ surface detail
     The model's pictures are small (16 to 256 pixels for whole walls), so up close their pixels showed and the town
     looked flat. Each material now gets a second, sharp layer laid on in world space, from the side a face looks to:
     stone, plaster, wood or rubble from Valle Morta's pictures (shared with Alpine, MIT, see the README), and sand
     made here. The detail brings colour (as variation around the model's own colour, so graffiti, doors and posters
     stay what they are), relief that catches the low sun, roughness and occlusion. Sand settles on whatever faces up.
     The model's own picture is read a little softer, so its blocks of pixels melt into the sharp layer. */
  const TEX = '/maps/alpine/tex/';
  const SETS = { stone: 'stone_masonry', plaster: 'plaster_old', wood: 'wood_planks', rubble: 'rubble', worn: 'plaster_damaged' };
  // what each of the model's materials is (by its number); anything not listed (posters, signs, glass) is drawn as it is
  const KIND_OF = { stone: [1, 4, 8, 15, 16, 25, 27], trim: [0], plaster: [10], cobble: [5], sand: [6, 22], wood: [2, 7, 9, 11, 12, 17, 23, 26, 28, 29, 30], metal: [20, 21, 31, 32] };
  const KINDS = {
    //        detail     metres  colour  relief  roughness      sand  soften  occlusion
    stone:   ['stone',   3.2,    0.6,    0.65,   [0.72, 0.98],  0.9,  1.2,    0.5],
    trim:    ['stone',   2.4,    0.3,    0.5,    [0.72, 0.95],  0.9,  0.5,    0.35],
    plaster: ['plaster', 3.0,    0.5,    0.55,   [0.78, 0.98],  0.9,  1.4,    0.45],
    cobble:  ['rubble',  1.8,    0.4,    1.0,    [0.7, 0.96],   0.0,  0.9,    0.5],
    sand:    ['sand',    2.4,    0.5,    1.0,    [0.88, 1.0],   0.0,  1.5,    0.35],
    wood:    ['wood',    1.3,    0.3,    0.7,    [0.62, 0.88],  0.55, 0.6,    0.4],
    metal:   ['worn',    2.0,    0.18,   0.4,    [0.4, 0.68],   0.35, 0.4,    0.3],
  };
  const kindOfMaterial = name => { const n = +String(name).replace(/\D/g, ''); return Object.keys(KIND_OF).find(k => KIND_OF[k].includes(n)) || null; };
  async function loadDetail(G) {
    const T = G.THREE, loader = new T.TextureLoader(), aniso = Math.min(8, G.renderer.capabilities.getMaxAnisotropy ? G.renderer.capabilities.getMaxAnisotropy() : 1);
    const one = async (file, srgb) => { const t = await loader.loadAsync(TEX + file + '.jpg'); t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace; t.anisotropy = aniso; t.name = 'maram_' + file; return t; };
    const sets = {};
    await Promise.all(Object.entries(SETS).map(async ([name, file]) => {
      const [col, nrm, arh] = await Promise.all([one(file + '_col', true), one(file + '_nrm', false), one(file + '_arh', false)]);
      sets[name] = { col, nrm, arh };
    }));
    sets.sand = makeSand(T, aniso);
    return sets;
  }
  /* Sand, made here: wind ripples bent by a slow wander, and grains. It tiles: the ripples fit a whole number of times
     across, and the noise repeats on its own lattice. */
  function makeSand(T, aniso) {
    const N = 512, H = new Float32Array(N * N), L = 8;
    const hash = (i, j) => { let h = Math.imul(i * 374761393 + j * 668265263, 1274126177); h ^= h >>> 15; return ((h >>> 0) % 10007) / 10007; };
    const vnoise = (x, y, l) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = (a, b) => hash(((a % l) + l) % l, ((b % l) + l) % l);
      return (w(xi, yi) * (1 - u) + w(xi + 1, yi) * u) * (1 - v) + (w(xi, yi + 1) * (1 - u) + w(xi + 1, yi + 1) * u) * v; };
    let k = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const s = x / N, t = y / N, warp = vnoise(s * L, t * L, L) * 1.6 + vnoise(s * L * 2, t * L * 2, L * 2) * 0.5;
      const ph = (s * 9 + t * 3) * Math.PI * 2 + warp * 2.4, r = 0.5 + 0.5 * Math.sin(ph);
      H[k++] = Math.pow(r, 2.2) * 0.75 + vnoise(s * 64, t * 64, 64) * 0.18 + hash(x, y) * 0.12;   // a crest steeper on one side, then grains
    }
    const mk = fill => { const cv = document.createElement('canvas'); cv.width = cv.height = N; const c = cv.getContext('2d'), im = c.createImageData(N, N); fill(im.data); c.putImageData(im, 0, 0); return cv; };
    const at = (x, y) => H[((y + N) % N) * N + ((x + N) % N)];
    const col = mk(d => { for (let y = 0, i = 0; y < N; y++) for (let x = 0; x < N; x++, i += 4) { const v = 0.92 + 0.08 * vnoise(x / N * 16, y / N * 16, 16) + (hash(x + 7, y + 3) - 0.5) * 0.09 + (at(x, y) - 0.5) * 0.06; d[i] = 212 * v; d[i + 1] = 168 * v; d[i + 2] = 116 * v; d[i + 3] = 255; } });
    const nrm = mk(d => { for (let y = 0, i = 0; y < N; y++) for (let x = 0; x < N; x++, i += 4) { const dx = (at(x + 1, y) - at(x - 1, y)) * 3.2, dy = (at(x, y + 1) - at(x, y - 1)) * 3.2, l = Math.hypot(dx, dy, 1); d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255; } });
    const tex = (cv, srgb) => { const t = new T.CanvasTexture(cv); t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace; t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = T.LinearMipmapLinearFilter; t.needsUpdate = true; return t; };
    const arh = mk(d => { for (let y = 0, i = 0; y < N; y++) for (let x = 0; x < N; x++, i += 4) { const h = at(x, y); d[i] = 200 + 55 * h; d[i + 1] = 245; d[i + 2] = 255 * h; d[i + 3] = 255; } });
    return { col: tex(col, true), nrm: tex(nrm, false), arh: tex(arh, false) };
  }
  /* Roofs. The sky's light (the hemisphere light and the painted sky's reflections) reaches everywhere alike, so the
     inside of a tunnel was as bright as the street and nothing in it could stand out. This finds, on a 50 cm grid, every
     walkable square with a roof between 1.9 and 7 m over it (the scan behind COVER) and keeps floor and roof height in
     a small picture; materials take most of the sky's light away under a roof, with soft edges at the mouths. The
     squares of the walls next to a roofed square count as roofed, so tunnel walls go dark with their floor. */
  function makeRoofs(G) {
    const T = G.THREE, ph = G.physics, C = 0.5, x0 = BOUNDS.x0, z0 = BOUNDS.z0, W = Math.round((BOUNDS.x1 - x0) / C), D = Math.round((BOUNDS.z1 - z0) / C), n = W * D;
    const amt = new Float32Array(n), lo = new Float32Array(n).fill(NaN), hi = new Float32Array(n).fill(NaN), up = new T.Vector3(0, 1, 0), o = new T.Vector3();
    for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
      const x = x0 + (i + 0.5) * C, z = z0 + (j + 0.5) * C;
      if (!ph.nav.isWalkable(x, z)) continue;
      let y = ph.groundHeight(x, z, 12);
      for (let k = 0; k < 3; k++) { o.set(x, y + 0.2, z); const h = ph.raycast(o, up, 7); if (h && h.dist > 1.9 && h.dist < 7) { const c = j * W + i; amt[c] = 1; lo[c] = y; hi[c] = y + 0.2 + h.dist; break; } y = ph.groundHeight(x, z, y - 0.5); if (y <= 0.01) break; }
    }
    // spread: the roofed amount two squares into the walls, the heights further, so the picture's blending stays sensible
    for (let pass = 0; pass < 6; pass++) {
      const a2 = amt.slice(), l2 = lo.slice(), h2 = hi.slice();
      for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
        const c = j * W + i; if (!Number.isNaN(lo[c]) && (amt[c] >= 1 || pass >= 2)) continue;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= D) continue; const d = jj * W + ii; if (Number.isNaN(lo[d])) continue;
          if (Number.isNaN(l2[c])) { l2[c] = lo[d]; h2[c] = hi[d]; }
          if (pass < 2 && !ph.nav.isWalkable(x0 + (i + 0.5) * C, z0 + (j + 0.5) * C)) a2[c] = Math.max(a2[c], amt[d]); }
      }
      amt.set(a2); lo.set(l2); hi.set(h2);
    }
    const px = new Uint16Array(n * 4), half = T.DataUtils.toHalfFloat;
    for (let c = 0; c < n; c++) { px[c * 4] = half(amt[c]); px[c * 4 + 1] = half(Number.isNaN(lo[c]) ? -50 : lo[c]); px[c * 4 + 2] = half(Number.isNaN(hi[c]) ? -50 : hi[c]); px[c * 4 + 3] = half(1); }
    const tex = new T.DataTexture(px, W, D, T.RGBAFormat, T.HalfFloatType); tex.magFilter = tex.minFilter = T.LinearFilter; tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping; tex.needsUpdate = true;
    return { tex, rect: new T.Vector4(x0, z0, W * C, D * C) };
  }
  const roofU = { tRoof: { value: null }, uRoof: { value: null } };
  const DETAIL_HEAD = `
uniform sampler2D tDCol, tDNrm, tDArh, tSCol, tSNrm, tRoof; uniform vec4 uD, uD2, uRoof, uFar; uniform vec3 uFarCol;
varying vec3 vMwPos, vMwNrm;
float mh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(mh(i), mh(i + vec2(1.0, 0.0)), f.x), mix(mh(i + vec2(0.0, 1.0)), mh(i + vec2(1.0, 1.0)), f.x), f.y); }
`;
  const DETAIL_MAP = `
#ifdef USE_MAP
  diffuseColor *= texture2D(map, vMapUv, uD2.z);
#endif
  vec3 mN = normalize(vMwNrm) * (gl_FrontFacing ? 1.0 : -1.0), mA = abs(mN);
  vec2 mUv; vec3 mT, mB;
  if (mA.y >= mA.x && mA.y >= mA.z) { mUv = vMwPos.xz; mT = vec3(1.0, 0.0, 0.0); mB = vec3(0.0, 0.0, 1.0); }
  else if (mA.x >= mA.z) { mUv = vMwPos.zy; mT = vec3(0.0, 0.0, 1.0); mB = vec3(0.0, 1.0, 0.0); }
  else { mUv = vMwPos.xy; mT = vec3(1.0, 0.0, 0.0); mB = vec3(0.0, 1.0, 0.0); }
  mT *= sign(dot(cross(mT, mB), mN) + 1e-4);
  mUv /= uD.x;
  vec3 mCol = texture2D(tDCol, mUv).rgb, mAvg = textureLod(tDCol, mUv, 12.0).rgb, mArh = texture2D(tDArh, mUv).rgb;
  float mMacro = mn(vMwPos.xz * 0.09 + vMwPos.y * 0.05) * 0.6 + mn(vMwPos.xz * 0.31 + 11.0) * 0.4;
  diffuseColor.rgb *= mix(vec3(1.0), mCol / max(mAvg, vec3(0.03)), uD.y) * mix(vec3(0.9, 0.88, 0.84), vec3(1.08, 1.04, 0.98), mMacro);
  vec2 mSUv = vMwPos.xz / 2.4;
  float mSand = uD.w * smoothstep(0.55, 0.85, mN.y) * smoothstep(0.38, 0.62, mn(vMwPos.xz * 1.3) * 0.5 + mn(vMwPos.xz * 4.1) * 0.25 + mMacro * 0.45);
  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(tSCol, mSUv).rgb, mSand);
  diffuseColor.rgb *= mix(1.0, mArh.r, uD2.w * (1.0 - mSand));
  diffuseColor.rgb = mix(diffuseColor.rgb, uFarCol, uFar.x * smoothstep(uFar.y, uFar.z, length(vMwPos.xz)));   // the sand's far edge takes the colour of the photograph's scrub
  vec4 mRoof = texture2D(tRoof, (vMwPos.xz - uRoof.xy) / uRoof.zw);
  float mCover = mRoof.r * smoothstep(mRoof.g - 0.9, mRoof.g - 0.2, vMwPos.y) * smoothstep(mRoof.b + 0.6, mRoof.b + 0.25, vMwPos.y);
`;
  const DETAIL_AMBIENT = `
#include <aomap_fragment>
  { float mAmb = 1.0 - 0.72 * mCover; reflectedLight.indirectDiffuse *= mAmb; reflectedLight.indirectSpecular *= mAmb; }
`;
  const DETAIL_NORMAL = `
  {
    vec3 mDn = texture2D(tDNrm, mUv).xyz * 2.0 - 1.0; mDn.xy *= uD.z;
    vec3 mSn = texture2D(tSNrm, mSUv).xyz * 2.0 - 1.0;
    vec3 mTn = normalize(mix(mDn, mSn, mSand));
    normal = normalize((viewMatrix * vec4(normalize(mT * mTn.x + mB * mTn.y + mN * mTn.z), 0.0)).xyz);
  }
`;
  function detailed(G, mat, kind, sets) {
    const T = G.THREE, [set, metres, col, nrm, rough, sand, soft, occ] = KINDS[kind], d = sets[set], s = sets.sand;
    const uniforms = { tDCol: { value: d.col }, tDNrm: { value: d.nrm }, tDArh: { value: d.arh }, tSCol: { value: s.col }, tSNrm: { value: s.nrm },
      uD: { value: new T.Vector4(metres, col, nrm, sand) }, uD2: { value: new T.Vector4(rough[0], rough[1], soft, occ) }, ...roofU,
      uFar: { value: new T.Vector4(0, 1e6, 2e6, 0) }, uFarCol: { value: new T.Color(0.3, 0.24, 0.16) } };
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uniforms);
      const need = (src, what) => { if (!src.includes(what)) throw new Error('[maram] the material shader has no ' + what); return src; };
      sh.vertexShader = 'varying vec3 vMwPos, vMwNrm;\n' + need(sh.vertexShader, '#include <project_vertex>').replace('#include <project_vertex>', '#include <project_vertex>\n  vMwPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vMwNrm = normalize(mat3(modelMatrix) * objectNormal);');
      let f = sh.fragmentShader;
      for (const w of ['#include <map_fragment>', '#include <roughnessmap_fragment>', '#include <normal_fragment_maps>', '#include <aomap_fragment>']) need(f, w);
      f = f.replace('#include <map_fragment>', DETAIL_MAP).replace('#include <aomap_fragment>', DETAIL_AMBIENT)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(mix(uD2.x, uD2.y, mArh.g), 0.96, mSand);')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + DETAIL_NORMAL);
      sh.fragmentShader = DETAIL_HEAD + f;
    };
    mat.customProgramCacheKey = () => 'maram-detail-1';
    mat.userData.detail = uniforms;
    mat.needsUpdate = true;
    return mat;
  }

  async function buildModel(G, glb, data, root, sets) {
    const T = G.THREE, { json, bin } = glb, aniso = Math.min(8, G.renderer.capabilities.getMaxAnisotropy ? G.renderer.capabilities.getMaxAnisotropy() : 1);
    // textures: the pictures inside the file, as the file says to sample them
    const textures = await Promise.all(json.textures.map(async tx => {
      const im = json.images[tx.source], bv = json.bufferViews[im.bufferView];
      const blob = new Blob([bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)], { type: im.mimeType || 'image/png' });
      const url = URL.createObjectURL(blob);
      try {
        const t = await new T.TextureLoader().loadAsync(url);
        const s = (json.samplers || [])[tx.sampler] || {};
        t.flipY = false; t.colorSpace = T.SRGBColorSpace; t.anisotropy = aniso;
        t.wrapS = s.wrapS === 33071 ? T.ClampToEdgeWrapping : s.wrapS === 33648 ? T.MirroredRepeatWrapping : T.RepeatWrapping;
        t.wrapT = s.wrapT === 33071 ? T.ClampToEdgeWrapping : s.wrapT === 33648 ? T.MirroredRepeatWrapping : T.RepeatWrapping;
        t.needsUpdate = true;
        return t;
      } finally { URL.revokeObjectURL(url); }
    }));
    const kindOf = name => { const n = +String(name).replace(/\D/g, ''); return [20, 21, 31, 32].includes(n) ? 'metal' : n === 33 ? 'glass' : 'plain'; };
    const mats = json.materials.map(m => {
      const kind = kindOf(m.name), tx = m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture;
      const mat = new T.MeshStandardMaterial({
        map: tx ? textures[tx.index] : null,
        roughness: kind === 'metal' ? 0.55 : kind === 'glass' ? 0.12 : 0.92, metalness: kind === 'metal' ? 0.35 : kind === 'glass' ? 0.6 : 0,
        side: T.DoubleSide,
      });
      mat.name = 'maram_' + m.name;
      const k = sets && kindOfMaterial(m.name);
      return k ? detailed(G, mat, k, sets) : mat;
    });
    // the model's own node matrices, then the build's turn and scale (rows x, y, z)
    const place = new T.Matrix4().set(...data.transform);
    let tris = 0;
    const walk = (ni, parent) => {
      const n = json.nodes[ni], M = parent.clone();
      if (n.matrix) M.multiply(new T.Matrix4().fromArray(n.matrix));
      if (n.mesh != null) for (const p of json.meshes[n.mesh].primitives) {
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.BufferAttribute(accessor(glb, p.attributes.POSITION), 3));
        if (p.attributes.NORMAL != null) g.setAttribute('normal', new T.BufferAttribute(accessor(glb, p.attributes.NORMAL), 3));
        if (p.attributes.TEXCOORD_0 != null) g.setAttribute('uv', new T.BufferAttribute(accessor(glb, p.attributes.TEXCOORD_0), 2));
        if (p.indices != null) g.setIndex(new T.BufferAttribute(accessor(glb, p.indices), 1));
        g.applyMatrix4(M);
        if (data.hide && data.hide.length) leaveOut(g, data.hide);
        if (p.attributes.NORMAL == null) g.computeVertexNormals();
        g.computeBoundingBox(); g.computeBoundingSphere();
        const mesh = new T.Mesh(g, mats[p.material]);
        mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'maram:' + (json.materials[p.material].name || p.material);
        mesh.matrixAutoUpdate = false; mesh.updateMatrix();
        root.add(mesh); tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      }
      for (const c of n.children || []) walk(c, M);
    };
    for (const r of json.scenes[json.scene || 0].nodes) walk(r, place);
    // the sand round the town: the model's own, a round floor 300 m out, just under its lowest floor. Past it the
    // photograph's own scrub and hills go on (a floor out to the horizon took the game's distance haze, which the
    // photograph does not, and the hills stood in a pale band); its edge fades to the colour of that scrub
    const sandMat = mats.find(m => m.name === 'maram_material_6');
    const sand = sandMat.map.clone(); sand.repeat.set(600 / 6.4, 600 / 6.4); sand.needsUpdate = true;
    const groundMat = new T.MeshStandardMaterial({ map: sand, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
    if (sets) { detailed(G, groundMat, 'sand', sets); groundMat.userData.detail.uFar.value.set(0.9, 200, 296, 0); groundMat.userData.detail.uFarCol.value.setRGB(0.15, 0.12, 0.085); }
    const ground = new T.Mesh(new T.CircleGeometry(300, 96).rotateX(-Math.PI / 2), groundMat);
    ground.position.y = -0.03; ground.receiveShadow = true; ground.name = 'maram:desert'; ground.matrixAutoUpdate = false; ground.updateMatrix();
    root.add(ground);
    return { tris, meshes: root.children.length };
  }

  /* ------------------------------------------------------------------ collision */
  function addBoxes(G, data) {
    const ph = G.physics, B = data.boxes, S = data.surfaces;
    for (let i = 0; i < B.length; i += 7) {
      const k = B[i + 6], o = k >= 8 ? { surface: 'concrete', playerOnly: true, noNav: true } : { surface: S[k] || 'concrete' };
      ph.addBox([B[i] / 100, B[i + 1] / 100, B[i + 2] / 100], [B[i + 3] / 100, B[i + 4] / 100, B[i + 5] / 100], o);
    }
    // outside everything: solid all round, the last word on staying in
    const o = { surface: 'concrete', playerOnly: true, noNav: true }, [x0, z0, x1, z1] = data.bounds, H = data.top;
    ph.addBox([x0 - 6, -1, z0 - 6], [x0, H, z1 + 6], o); ph.addBox([x1, -1, z0 - 6], [x1 + 6, H, z1 + 6], o);
    ph.addBox([x0, -1, z0 - 6], [x1, H, z0], o); ph.addBox([x0, -1, z1], [x1, H, z1 + 6], o);
    return B.length / 7 + 4;
  }

  /* The game's raycast, moveCapsule and groundHeight, line for line (web/index.html), over a grid that files each box
     under the 1 m squares it covers. Boxes keep the order the game holds them in, so every answer is the game's own. */
  function installPhysics(G) {
    const T = G.THREE, ph = G.physics, W = G.consts.world, own = { raycast: ph.raycast, moveCapsule: ph.moveCapsule, groundHeight: ph.groundHeight, addBox: ph.addBox, removeBox: ph.removeBox };
    const GC = 1, GX = BOUNDS.x0 - 8, GZ = BOUNDS.z0 - 8, GW = Math.ceil((BOUNDS.x1 - BOUNDS.x0 + 16) / GC), GD = Math.ceil((BOUNDS.z1 - BOUNDS.z0 + 16) / GC);
    const cells = Array.from({ length: GW * GD }, () => []), wide = [];      // wide: boxes too big to file (the ring, anything far out)
    let order = 0, qid = 0;
    const span = (b, f) => {
      const i0 = Math.floor((b.min.x - GX) / GC), i1 = Math.floor((b.max.x - GX) / GC), j0 = Math.floor((b.min.z - GZ) / GC), j1 = Math.floor((b.max.z - GZ) / GC);
      if (i0 < 0 || j0 < 0 || i1 >= GW || j1 >= GD || (i1 - i0 + 1) * (j1 - j0 + 1) > 400) return false;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(cells[j * GW + i]);
      return true;
    };
    const file = b => { b._mo = ++order; if (!span(b, c => c.push(b))) wide.push(b); };
    const unfile = b => { if (!span(b, c => { const k = c.indexOf(b); if (k >= 0) c.splice(k, 1); })) { const k = wide.indexOf(b); if (k >= 0) wide.splice(k, 1); } };
    for (const b of ph.boxes) file(b);
    const byOrder = (a, b) => a._mo - b._mo;
    // the boxes filed under squares that meet the rectangle, each once, in the game's order
    function gather(x0, z0, x1, z1) {
      const q = ++qid, out = [];
      const i0 = Math.max(0, Math.floor((x0 - GX) / GC)), i1 = Math.min(GW - 1, Math.floor((x1 - GX) / GC)), j0 = Math.max(0, Math.floor((z0 - GZ) / GC)), j1 = Math.min(GD - 1, Math.floor((z1 - GZ) / GC));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const b of cells[j * GW + i]) if (b._mq !== q) { b._mq = q; out.push(b); }
      for (const b of wide) if (b._mq !== q) { b._mq = q; out.push(b); }
      return out.sort(byOrder);
    }

    const STEP = 0.42;
    function moveCapsule(M, _, T_, w = 0.32, S = 1.8, R = true) {
      const z = { onGround: false, hitWall: false, hitCeil: false, surface: 'concrete' }, I = _.x * T_, L = _.z * T_, U = Math.max(1, Math.ceil(Math.hypot(I, L) / (w * 0.6))), k = M.y;
      const e = gather(Math.min(M.x, M.x + I) - w - 1, Math.min(M.z, M.z + L) - w - 1, Math.max(M.x, M.x + I) + w + 1, Math.max(M.z, M.z + L) + w + 1);   // a metre over: pushes out of walls move the capsule too
      for (let Q = 0; Q < U; Q++) {
        M.x += I / U; M.z += L / U;
        for (let W_ = 0; W_ < 3; W_++) {
          let J = false;
          for (let G_ = 0; G_ < e.length; G_++) {
            const te = e[G_];
            if (te.bulletOnly || te.max.y <= M.y + (R ? STEP : 0.08) || te.min.y >= M.y + S) continue;
            const oe = Math.max(te.min.x, Math.min(te.max.x, M.x)), ee = Math.max(te.min.z, Math.min(te.max.z, M.z));
            let le = M.x - oe, xe = M.z - ee; const j = le * le + xe * xe;
            if (!(j >= w * w)) {
              if (j > 1e-10) { const O = Math.sqrt(j), q = w - O; le /= O; xe /= O; M.x += le * q; M.z += xe * q; const ue = _.x * le + _.z * xe; if (ue < 0) { _.x -= le * ue; _.z -= xe * ue; } }
              else { const O = M.x - te.min.x, q = te.max.x - M.x, ue = M.z - te.min.z, de = te.max.z - M.z, $ = Math.min(O, q, ue, de);
                if ($ === O) { M.x = te.min.x - w; if (_.x > 0) _.x = 0; } else if ($ === q) { M.x = te.max.x + w; if (_.x < 0) _.x = 0; } else if ($ === ue) { M.z = te.min.z - w; if (_.z > 0) _.z = 0; } else { M.z = te.max.z + w; if (_.z < 0) _.z = 0; } }
              J = true; z.hitWall = true;
            }
          }
          if (!J) break;
        }
      }
      const C = M.y + _.y * T_, A = w * 0.7; let F = M.x <= W.quayX + A ? W.groundY : -50, H = null, N = Infinity; const Z = k + (R ? STEP : 0.08) + 1e-4;
      for (let Q = 0; Q < e.length; Q++) {
        const b = e[Q];
        if (b.bulletOnly || M.x + A < b.min.x || M.x - A > b.max.x || M.z + A < b.min.z || M.z - A > b.max.z) continue;
        if (b.max.y <= Z && b.max.y > F) { F = b.max.y; H = b.surface; }
        if (b.min.y >= k + S - 0.05 && b.min.y < N) N = b.min.y;
      }
      if (_.y > 0 && C + S > N) { M.y = N - S; _.y = 0; z.hitCeil = true; }
      else if (C <= F) { M.y = F; if (_.y < 0) _.y = 0; z.onGround = true; }
      else if (R && _.y <= 0 && C - F < STEP) { M.y = F; _.y = 0; z.onGround = true; }
      else M.y = C;
      if (z.onGround) z.surface = H || (G.level && G.level.groundSurfaceAt ? G.level.groundSurfaceAt(M.x, M.z) : 'concrete');
      return z;
    }
    // the boxes a ray meets, square by square along its way, each tested once; it stops once it is past the nearest hit
    function raycast(M, _, T_ = 500) {
      let w = T_, S = null, R = -1, z = 0, I = 0;
      const L = M.x, U = M.y, k = M.z, C = _.x, A = _.y, F = _.z;
      if (A < -1e-6) { const J = (W.groundY - U) / A; if (J > 0 && J < w) { if (L + C * J <= W.quayX) { w = J; I = 1; } else { const te = (W.seaY - U) / A; if (te > 0 && te < w) { w = te; I = 2; } } } }
      const H = C === 0 ? Infinity : 1 / C, N = A === 0 ? Infinity : 1 / A, Z = F === 0 ? Infinity : 1 / F, q = ++qid;
      const test = G_ => {
        if (G_._mq === q) return; G_._mq = q;
        if (G_.playerOnly) return;
        let te = 0, oe = w, ee = -1, le = 0, xe, j;
        if (C !== 0) { xe = (G_.min.x - L) * H; j = (G_.max.x - L) * H; let O = -1; if (xe > j) { const t = xe; xe = j; j = t; O = 1; } if (xe > te) { te = xe; ee = 0; le = O; } if (j < oe) oe = j; if (te > oe) return; } else if (L < G_.min.x || L > G_.max.x) return;
        if (A !== 0) { xe = (G_.min.y - U) * N; j = (G_.max.y - U) * N; let O = -1; if (xe > j) { const t = xe; xe = j; j = t; O = 1; } if (xe > te) { te = xe; ee = 1; le = O; } if (j < oe) oe = j; if (te > oe) return; } else if (U < G_.min.y || U > G_.max.y) return;
        if (F !== 0) { xe = (G_.min.z - k) * Z; j = (G_.max.z - k) * Z; let O = -1; if (xe > j) { const t = xe; xe = j; j = t; O = 1; } if (xe > te) { te = xe; ee = 2; le = O; } if (j < oe) oe = j; if (te > oe) return; } else if (k < G_.min.z || k > G_.max.z) return;
        if (ee < 0) return;
        w = te; S = G_; R = ee; z = le; I = 0;
      };
      for (const b of wide) test(b);
      // walk the squares along the ray (its path seen from above), from the start to where it leaves the grid or passes w
      let t0 = 0, t1 = w;
      for (const [o, d, lo, hi] of [[L, C, GX, GX + GW * GC], [k, F, GZ, GZ + GD * GC]]) {
        if (Math.abs(d) < 1e-12) { if (o < lo || o >= hi) { t1 = -1; } continue; }
        let a = (lo - o) / d, b = (hi - o) / d; if (a > b) { const t = a; a = b; b = t; } t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      }
      if (t1 >= t0) {
        let cx = Math.min(GW - 1, Math.max(0, Math.floor((L + C * t0 - GX) / GC))), cz = Math.min(GD - 1, Math.max(0, Math.floor((k + F * t0 - GZ) / GC)));
        const sx = C > 0 ? 1 : -1, sz = F > 0 ? 1 : -1, ax = Math.abs(C) > 1e-12, az = Math.abs(F) > 1e-12;
        const tdx = ax ? GC / Math.abs(C) : Infinity, tdz = az ? GC / Math.abs(F) : Infinity;
        let tmx = ax ? (GX + (cx + (sx > 0 ? 1 : 0)) * GC - L) / C : Infinity, tmz = az ? (GZ + (cz + (sz > 0 ? 1 : 0)) * GC - k) / F : Infinity, tc = t0;
        while (cx >= 0 && cx < GW && cz >= 0 && cz < GD && tc <= w) {
          const cell = cells[cz * GW + cx];
          for (let i = 0; i < cell.length; i++) test(cell[i]);
          if (tmx < tmz) { tc = tmx; tmx += tdx; cx += sx; } else { tc = tmz; tmz += tdz; cz += sz; }
        }
      }
      if (!S && !I) return null;
      const Q = new T.Vector3(L + C * w, U + A * w, k + F * w);
      if (I) return { dist: w, point: Q, normal: new T.Vector3(0, 1, 0), surface: I === 2 ? 'water' : G.level && G.level.groundSurfaceAt ? G.level.groundSurfaceAt(Q.x, Q.z) : 'concrete', box: null };
      const Wn = new T.Vector3(); Wn.setComponent(R, z);
      return { dist: w, point: Q, normal: Wn, surface: S.surface, box: S };
    }
    function groundHeight(M, _, T_ = 50) {
      let w = M <= W.quayX ? W.groundY : W.seaY;
      for (const R of gather(M, _, M, _)) if (!R.bulletOnly && M >= R.min.x && M <= R.max.x && _ >= R.min.z && _ <= R.max.z && R.max.y <= T_ && R.max.y > w) w = R.max.y;
      return w;
    }

    // check the copies against the game's own before trusting them: rays and moves all over the town
    const rnd = (() => { let a = 20231118; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
    let worst = 0, tests = 0, tOwn = 0, tGrid = 0, nRay = 0, nMove = 0;
    const V = (x, y, z) => new T.Vector3(x, y, z), now = () => performance.now();
    for (let n = 0; n < 240; n++) {
      const o = V(-60 + rnd() * 120, 0.5 + rnd() * 12, -50 + rnd() * 100), a = rnd() * TAU, e = (rnd() - 0.6) * 1.2, d = V(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)).normalize();
      let t = now(); const r0 = own.raycast.call(ph, o, d, 300); tOwn += now() - t; t = now(); const r1 = raycast(o, d, 300); tGrid += now() - t; tests++; nRay++;
      if (!r0 !== !r1) { worst = Infinity; break; }
      if (r0) worst = Math.max(worst, Math.abs(r0.dist - r1.dist), r0.surface === r1.surface ? 0 : 1);
    }
    for (let n = 0; n < 160 && worst < 1e-6; n++) {
      const x = -60 + rnd() * 120, zz = -50 + rnd() * 100, y = own.groundHeight.call(ph, x, zz, 20), v = V((rnd() - 0.5) * 12, rnd() < 0.3 ? 6 : -1, (rnd() - 0.5) * 12);
      const p0 = V(x, y, zz), v0 = v.clone(), p1 = p0.clone(), v1 = v.clone(), step = rnd() < 0.7;
      let t = now(); const m0 = own.moveCapsule.call(ph, p0, v0, 1 / 60, 0.32, 1.8, step); tOwn += now() - t; t = now(); const m1 = moveCapsule(p1, v1, 1 / 60, 0.32, 1.8, step); tGrid += now() - t; tests++; nMove++;
      worst = Math.max(worst, p0.distanceTo(p1), v0.distanceTo(v1), m0.onGround === m1.onGround && m0.hitWall === m1.hitWall && m0.hitCeil === m1.hitCeil ? 0 : 1);
      worst = Math.max(worst, Math.abs(own.groundHeight.call(ph, x, zz, 20) - groundHeight(x, zz, 20)));
    }
    if (!(worst < 1e-6)) { console.warn(`[maram] the grid physics disagreed with the game's own (by ${worst}); keeping the game's own`); return { info: { indexed: false, tests }, near: () => ph.boxes }; }
    ph.raycast = raycast; ph.moveCapsule = moveCapsule; ph.groundHeight = groundHeight;
    ph.addBox = function () { const b = own.addBox.apply(this, arguments); file(b); return b; };
    ph.removeBox = function (b) { own.removeBox.call(this, b); unfile(b); };
    // what a call costs, on average over the checks (rays and moves together): the game's own against the grid
    return { info: { indexed: true, tests, wide: wide.length, msPerCallOwn: +(tOwn / (nRay + nMove)).toFixed(4), msPerCallGrid: +(tGrid / (nRay + nMove)).toFixed(4) }, near: (x, z) => gather(x, z, x, z) };
  }

  // the minimap and the spawn shuffle ask the game's walk grid, which covers only the harbour; answer from the robot's map
  function walkGrid(G, walk) {
    const bits = Uint8Array.from(atob(walk.bits), ch => ch.charCodeAt(0)), nav = G.physics.nav;
    nav.isWalkable = (x, z) => { const i = Math.floor((x - walk.x0) / walk.cell), j = Math.floor((z - walk.z0) / walk.cell); if (i < 0 || j < 0 || i >= walk.w || j >= walk.h) return false; const k = j * walk.w + i; return !!(bits[k >> 3] & (1 << (k & 7))); };
  }

  /* ------------------------------------------------------------------ sky and light
     A painted desert sky: deep blue overhead, pale and hazy low down, a few thin high streaks, the sun in its glow.
     The scene's ambient light is taken again from it, as the game takes it from its own. */
  const SKY = `
uniform sampler2D tNoise; uniform float uTime, uEnv; uniform vec3 uSunDir, uSunCol;
varying vec3 vDir;
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vn(p); p = p * 2.03 + 17.0; a *= 0.5; } return s / 0.96875; }
void main(){
  vec3 d = normalize(vDir); float h = max(d.y, 0.0), mu = dot(d, uSunDir), s = max(mu, 0.0);
  vec3 zen = vec3(0.12, 0.32, 0.8), hor = vec3(0.95, 0.84, 0.68);
  vec3 col = mix(hor, zen, pow(h, 0.45)) * 1.8;
  col += uSunCol * vec3(1.0, 0.9, 0.74) * (pow(s, 5.0) * 0.6 + pow(s, 36.0) * 1.1 + pow(s, 380.0) * 3.0);
  // thin high streaks, stretched one way, fading to nothing at the horizon
  vec2 q = d.xz / (h + 0.22) * vec2(0.5, 2.4) + vec2(0.006, 0.0) * uTime;
  float cov = smoothstep(0.58, 0.78, fbm(q * 0.8 + 5.0) + (fbm(q * 3.0 + 2.0) - 0.5) * 0.25) * smoothstep(0.04, 0.3, h) * 0.55;
  col = mix(col, vec3(1.0, 0.98, 0.94) * 2.4, cov);
  col += vec3(1.0, 0.9, 0.7) * smoothstep(0.99990, 0.99996, mu) * 90.0 * (1.0 - uEnv);
  if (d.y < 0.0) col = mix(hor * 1.7, vec3(0.62, 0.48, 0.3), smoothstep(0.0, 0.2, -d.y));
  col = mix(col, min(col, vec3(6.0)), uEnv);
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;
  /* The land round the town is a photograph: a full 360° picture of arid rocky hills at sunrise (Klippad Sunrise 2, by
     Greg Zaal, polyhaven.com, CC0), turned so its sun stands in the game sun's direction (the photograph's sun is 10°
     up; the game's is higher, SUN.el, and the photograph's sun is hazy enough that it passes). A small picture of the whole sky, and a sharp strip for the band round the horizon where the hills are, cut
     the way Alpine's are. If the pictures cannot be had, the painted sky above is used instead. */
  const PHOTO = { sunU: 0.5994, band: [0.44995, 0.25] };
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
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col *= uGain * (1.0 + 3.0 * pow(l, 5.0));
  col = mix(col, min(col, vec3(6.0)), uEnv);
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;
  async function makeSky(G) {
    const T = G.THREE, sky = G.render.sky, mat = sky && sky.material;
    if (!mat || !mat.uniforms || !mat.uniforms.uSunDir) { console.warn('[maram] the sky was left as it is: its material has changed'); return 'kept'; }
    let kind = 'painted';
    try {
      const loader = new T.TextureLoader(), wide = G.renderer.capabilities.maxTextureSize >= 8192;
      const [pano, band] = await Promise.all([loader.loadAsync(DIR + 'sky.jpg'), wide ? loader.loadAsync(DIR + 'band.jpg') : null]);
      for (const t of [pano, band]) if (t) { t.colorSpace = T.SRGBColorSpace; t.wrapS = T.RepeatWrapping; t.wrapT = T.ClampToEdgeWrapping; t.anisotropy = Math.min(8, G.renderer.capabilities.getMaxAnisotropy()); }
      const sd = G.consts.sun.dir;
      Object.assign(mat.uniforms, { tPano: { value: pano }, tBand: { value: band || pano }, uBand: { value: band ? 1 : 0 }, uGain: { value: 2.0 }, uRot: { value: PHOTO.sunU - Math.atan2(sd.z, sd.x) / TAU } });
      mat.fragmentShader = PANO; mat.extensions = { ...(mat.extensions || {}), derivatives: true }; kind = band ? 'photo' : 'photo-small';
    } catch (e) { console.warn('[maram] no photograph of the hills, painting the sky instead', e); mat.fragmentShader = SKY; }
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
  /* The sun's shadow map is fitted to the harbour when the renderer starts. Refit it to the town. */
  function fitShadows(G, data) {
    const T = G.THREE, sun = G.render.sun, cam = sun.shadow.camera, w0 = cam.right - cam.left, h0 = cam.top - cam.bottom, depth0 = cam.far - cam.near;
    const dir = G.consts.sun.dir.clone().normalize(), centre = new T.Vector3(0, 5, 0);
    sun.target.position.copy(centre); sun.position.copy(centre).addScaledVector(dir, 180); sun.updateMatrixWorld(true); sun.target.updateMatrixWorld(true);
    const view = new T.Matrix4().lookAt(sun.position, centre, new T.Vector3(0, 1, 0)); view.setPosition(sun.position); view.invert();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, n0 = 1e9, n1 = -1e9; const v = new T.Vector3(), [bx0, bz0, bx1, bz1] = data.bounds;
    for (const x of [bx0 + 2, bx1 - 2]) for (const z of [bz0 + 2, bz1 - 2]) for (const y of [0, 16]) { v.set(x, y, z).applyMatrix4(view); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); n0 = Math.min(n0, -v.z); n1 = Math.max(n1, -v.z); }
    cam.left = x0 - 1; cam.right = x1 + 1; cam.bottom = y0 - 1; cam.top = y1 + 1; cam.near = Math.max(1, n0 - 4); cam.far = Math.max(n1 + 4, cam.near + depth0);
    cam.updateProjectionMatrix();
    sun.shadow.radius *= Math.sqrt((w0 / (cam.right - cam.left)) * (h0 / (cam.top - cam.bottom)));
    sun.shadow.needsUpdate = true;
    return { width: +(cam.right - cam.left).toFixed(1), height: +(cam.top - cam.bottom).toFixed(1) };
  }

  /* ------------------------------------------------------------------ air
     The game's light shafts come from its volumetric pass, which reads the sun's shadow map along every view ray. Two
     things feed it here. The open air carries a light haze, enough for beams to show where a wall's shadow edge
     crosses a lane. And the covered places (the tunnels, the passages under the high ground, the mid doors) hold
     thicker air: the pass takes one box of it (the level's first interiorBoxes entry), so that box is moved to the
     covered place nearest the eye on every frame, and beams through doorways and gaps stand out there. The places were
     found by casting up from every walkable square for a roof between 1.9 and 7 m (_debug.cover() does it again);
     [x0, y0, z0, x1, y1, z1], floor to roof. */
  const COVER = [[-9.5, 1.9, -46.5, 16.5, 9.9, -17.5], [21.5, 1.1, 3.5, 35.5, 6.6, 21.5], [3.5, 1.5, -22.5, 10.5, 5.9, -4.5], [-22.5, 4.3, 20.5, -9.5, 9.8, 27.5],
    [-28.5, -0.5, 40.5, -19.5, 5.1, 47.5], [-39.5, 4.3, -4.5, -27.5, 9.0, -1.5], [-22.5, 4.3, -10.5, -14.5, 10.7, -6.5], [12.5, 1.1, -3.5, 22.5, 7.3, 1.5]];
  function cover(G) {          // the scan behind COVER, for when the model changes
    const T = G.THREE, ph = G.physics, up = new T.Vector3(0, 1, 0), o = new T.Vector3(), out = [];
    for (let x = BOUNDS.x0; x <= BOUNDS.x1; x++) for (let z = BOUNDS.z0; z <= BOUNDS.z1; z++) {
      if (!ph.nav.isWalkable(x, z)) continue;
      let y = ph.groundHeight(x, z, 12);
      for (let k = 0; k < 3; k++) { o.set(x, y + 0.2, z); const h = ph.raycast(o, up, 7); if (h && h.dist > 1.9 && h.dist < 7) { out.push([x, y, z, h.dist]); break; } y = ph.groundHeight(x, z, y - 0.5); if (y <= 0.01) break; }
    }
    return out;
  }
  /* A little thicker air over the whole town, so light coming through an opening shows in the air and the hills sit
     back in a haze. The box is the whole town, one even thickness, and it reaches 18 m, above the highest place a
     player can stand (11.2 m): the pass tests the box with a hard edge, so a top players could see, or a box that
     jumped to the covered places as the eye moved, showed as a flat wall of haze snapping on and off. The game also
     treats being inside its first interiorBoxes entry as being indoors (it dims the gun's light and swaps its
     reflections), so update() clears render.interiorEnv, which both of those wait for; the haze does not. */
  const AIR = { town: [BOUNDS.x0 - 4, -1, BOUNDS.z0 - 4, BOUNDS.x1 + 4, 18, BOUNDS.z1 + 4], townThick: 1.6 };
  function makeAir(G) {
    const T = G.THREE, box = { min: new T.Vector3(), max: new T.Vector3() }, zones = COVER.map(c => ({ min: new T.Vector3(c[0], c[1], c[2]), max: new T.Vector3(c[3], c[4], c[5]) }));
    const tune = G.render.tune, thick = tune && Object.keys(tune).find(k => k.startsWith('volInterior'));        // how much thicker the air in the box is
    const town = { min: new T.Vector3(AIR.town[0], AIR.town[1], AIR.town[2]), max: new T.Vector3(AIR.town[3], AIR.town[4], AIR.town[5]) };
    const place = (z, k) => { box.min.copy(z.min); box.max.copy(z.max); if (thick) tune[thick] = k; };
    place(town, AIR.townThick);
    let inside = 0;
    return {
      box,
      // the box stays the whole town; how close the eye is to a covered place only thickens the motes there
      update(eye) {
        let bd = 1e9;
        for (const z of zones) { const dx = Math.max(z.min.x - eye.x, 0, eye.x - z.max.x), dy = Math.max(z.min.y - eye.y, 0, eye.y - z.max.y), dz = Math.max(z.min.z - eye.z, 0, eye.z - z.max.z); bd = Math.min(bd, Math.hypot(dx, dy, dz)); }
        place(town, AIR.townThick);
        inside = bd === 0 ? 1 : Math.max(0.3, 1 - bd / 8);
        return inside;
      },
      get near() { return inside; },
    };
  }

  /* Motes: tiny grains in the air round the eye, drawn only where the sun reaches them (each looks up the sun's shadow
     map, as the volumetric pass does), brighter looking toward the sun, and thicker near the covered places. Out in
     the open they are a faint sparkle in the light; in a beam through a doorway they are what makes it read. */
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
  vA = sh * edge * (0.22 + 0.78 * uNear) * (0.35 + 1.4 * pow(fwd, 6.0)) * (0.6 + 0.4 * seed.w);
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
  function makeMotes(G, root) {
    const T = G.THREE, q = (G.quality && G.quality.name) || 'high', n = { low: 500, medium: 1100, high: 1800, ultra: 2600 }[q] || 1800;
    const seed = new Float32Array(n * 4); let a = 7;
    const r = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let i = 0; i < n * 4; i++) seed[i] = r();
    const g = new T.BufferGeometry(); g.setAttribute('seed', new T.BufferAttribute(seed, 4)); g.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3));
    const sun = G.render.sun, u = { tShadow: { value: null }, uShadowMatrix: { value: new T.Matrix4() }, uHasShadow: { value: 0 }, uTime: { value: 0 }, uNear: { value: 0 }, uPx: { value: 800 },
      uCam: { value: new T.Vector3() }, uSunDir: { value: G.consts.sun.dir.clone().normalize() }, uCol: { value: new T.Color(1.0, 0.86, 0.64).multiplyScalar(2.2) } };
    const m = new T.ShaderMaterial({ uniforms: u, vertexShader: MOTE_V, fragmentShader: MOTE_F, transparent: true, depthWrite: false, blending: T.AdditiveBlending });
    const pts = new T.Points(g, m); pts.frustumCulled = false; pts.name = 'maram:motes'; pts.renderOrder = 5; root.add(pts);
    const size = new T.Vector2(), eye = new T.Vector3();
    // everything that depends on where the eye is is read while drawing, from the camera actually drawn with; the thick
    // air's box is placed here too, before the volumetric pass reads it later in the same frame
    pts.onBeforeRender = (renderer, scene, cam) => {
      if (!cam || !cam.isPerspectiveCamera) return;
      eye.setFromMatrixPosition(cam.matrixWorld);
      u.uNear.value = air ? air.update(eye) : 0; u.uCam.value.copy(eye);
      const map = sun.shadow && sun.shadow.map; u.tShadow.value = map ? map.texture : null; u.uHasShadow.value = map ? 1 : 0; if (map) u.uShadowMatrix.value.copy(sun.shadow.matrix);
      renderer.getDrawingBufferSize(size); u.uPx.value = size.y * 0.5 / Math.tan((cam.fov || 70) * Math.PI / 360);
    };
    let air = null;
    return { update(t) { u.uTime.value = t; }, set air(a) { air = a; } };
  }

  /* Beams. The game's volumetric haze is too thin here to show light coming through an opening into a covered passage,
     and its thickness is fixed when the game starts, so the beams are drawn: for every floor square under a roof that
     the sun reaches (a ray toward the sun leaves the town without touching anything), a soft ribbon of light runs from
     that spot back up the sun's ray, past the roof's height, at most 8 m. Ribbons always turn their face to the eye,
     side by side they add up into a beam as wide as the opening, and like real beams they only show against shade.
     Out in the open there are none: the street is lit all through, so a beam there has nothing to stand against (with
     a low sun they read as glowing planks where they met the walls). */
  const BEAM_V = `
attribute float aSide, aAlong, aSeed; uniform vec3 uSun; uniform float uW;
varying vec2 vUv; varying float vSeed, vEnd;
void main(){
  vec3 p = position, toCam = normalize(cameraPosition - p);
  vec3 side = cross(uSun, toCam); float s = length(side); side = s > 1e-3 ? side / s : vec3(1.0, 0.0, 0.0);
  p += side * aSide * uW;
  vUv = vec2(aSide, aAlong); vSeed = aSeed; vEnd = 1.0 - 0.75 * pow(abs(dot(toCam, uSun)), 4.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
  const BEAM_F = `
uniform vec3 uCol; uniform float uTime, uStrength; varying vec2 vUv; varying float vSeed, vEnd;
void main(){
  float across = exp(-vUv.x * vUv.x * 3.2);
  float along = smoothstep(0.0, 0.1, vUv.y) * (0.5 + 0.5 * vUv.y) * smoothstep(1.0, 0.75, vUv.y);
  float drift = 0.8 + 0.2 * sin(uTime * 0.6 + vSeed * 31.0 + vUv.y * 5.0);
  float a = across * along * drift * vEnd * uStrength;
  gl_FragColor = vec4(uCol * a, a);
}`;
  function makeBeams(G, root) {
    const T = G.THREE, ph = G.physics, sd = G.consts.sun.dir.clone().normalize(), C = 0.75, o = new T.Vector3(), q = new T.Vector3(), up = new T.Vector3(0, 1, 0), rays = [];
    const lit = (x, y, z) => { q.set(x, y, z); return !ph.raycast(q, sd, 150); };
    for (let x = BOUNDS.x0 + C / 2; x < BOUNDS.x1; x += C) for (let z = BOUNDS.z0 + C / 2; z < BOUNDS.z1; z += C) {
      if (!ph.nav.isWalkable(x, z)) continue;
      let y = ph.groundHeight(x, z, 12);
      for (let k = 0; k < 3; k++) {
        o.set(x, y + 0.2, z); const h = ph.raycast(o, up, 7);
        if (h && h.dist > 1.9 && h.dist < 7) { if (lit(x, y + 0.05, z)) rays.push([x, y, z, Math.min(8, (0.6 + h.dist) / Math.max(sd.y, 0.2))]); break; }
        y = ph.groundHeight(x, z, y - 0.5); if (y <= 0.01) break;
      }
    }
    const n = rays.length, P = new Float32Array(n * 12), side = new Float32Array(n * 4), along = new Float32Array(n * 4), seed = new Float32Array(n * 4), idx = [];
    rays.forEach(([x, y, z, L], i) => {
      const e = [x + sd.x * L, y + sd.y * L, z + sd.z * L], s = Math.random();
      [[x, y, z, -1, 0], [x, y, z, 1, 0], [...e, -1, 1], [...e, 1, 1]].forEach(([px, py, pz, sv, av], k) => { const v = i * 4 + k; P.set([px, py, pz], v * 3); side[v] = sv; along[v] = av; seed[v] = s; });
      const b = i * 4; idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
    });
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(P, 3)); g.setAttribute('aSide', new T.BufferAttribute(side, 1)); g.setAttribute('aAlong', new T.BufferAttribute(along, 1)); g.setAttribute('aSeed', new T.BufferAttribute(seed, 1));
    g.setIndex(idx); g.computeBoundingSphere();
    const u = { uSun: { value: sd }, uW: { value: C * 0.8 }, uCol: { value: new T.Color(1.0, 0.84, 0.6) }, uTime: { value: 0 }, uStrength: { value: 0.45 } };
    const m = new T.ShaderMaterial({ uniforms: u, vertexShader: BEAM_V, fragmentShader: BEAM_F, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide });
    const mesh = new T.Mesh(g, m); mesh.name = 'maram:beams'; mesh.renderOrder = 4; mesh.frustumCulled = n > 0; root.add(mesh);
    return { count: n, update(t) { u.uTime.value = t; }, uniforms: u };
  }

  /* Palms, out in the desert beyond the town's walls: tall, leaning a little, in loose groups, so their crowns stand over
     the rooftops from inside the town. They are past the invisible wall that keeps players in (data.bounds), so nothing
     can reach them and they need no collision. Trunks are tapered and ringed; each frond is a curved, drooping strip
     with a painted leaf on it, and the fronds sway a little in the wind. */
  function makePalms(G, root, bounds) {
    const T = G.THREE, TAUx = Math.PI * 2;
    let a = 9127; const r = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    // the pictures: a ringed trunk, and a frond (a rib with leaflets each side, on nothing)
    const tc = document.createElement('canvas'); tc.width = 64; tc.height = 256; const t2 = tc.getContext('2d');
    t2.fillStyle = '#7a6448'; t2.fillRect(0, 0, 64, 256);
    for (let y = 0; y < 256; y += 9) { const l = 70 + r() * 40; t2.fillStyle = `rgb(${l + 40},${l + 22},${l})`; t2.fillRect(0, y, 64, 3 + r() * 2); t2.fillStyle = 'rgba(40,30,20,0.45)'; t2.fillRect(0, y + 5, 64, 2); }
    const fc = document.createElement('canvas'); fc.width = 512; fc.height = 128; const f2 = fc.getContext('2d');
    f2.clearRect(0, 0, 512, 128); f2.lineCap = 'round';
    for (let i = 0; i < 46; i++) {
      const x = 14 + i * 10.5, len = 52 * Math.sin(Math.min(1, (i + 3) / 46) * Math.PI * 0.95) + 6, g = 90 + r() * 50;
      for (const s of [-1, 1]) { f2.strokeStyle = `rgb(${g * 0.55},${g},${g * 0.35})`; f2.lineWidth = 4.5; f2.beginPath(); f2.moveTo(x, 64); f2.quadraticCurveTo(x + 10, 64 + s * len * 0.5, x + 22, 64 + s * len); f2.stroke(); }
    }
    f2.strokeStyle = '#6d6a3a'; f2.lineWidth = 5; f2.beginPath(); f2.moveTo(4, 64); f2.lineTo(508, 64); f2.stroke();
    const tex = (cv, rep) => { const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; if (rep) { t.wrapS = t.wrapT = T.RepeatWrapping; } return t; };
    const trunkMat = new T.MeshStandardMaterial({ map: tex(tc, true), roughness: 0.95, metalness: 0 }); trunkMat.name = 'maram_palm_trunk';
    const leafMat = new T.MeshStandardMaterial({ map: tex(fc), roughness: 0.75, metalness: 0, side: T.DoubleSide, alphaTest: 0.45 }); leafMat.name = 'maram_palm_leaf';
    const sway = { value: 0 };
    leafMat.onBeforeCompile = sh => { sh.uniforms.uSway = sway; sh.vertexShader = 'uniform float uSway; attribute vec2 aSway;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed.xz += vec2(sin(uSway * 1.3 + aSway.y), cos(uSway * 1.1 + aSway.y * 1.7)) * 0.16 * aSway.x * aSway.x;'); };
    leafMat.customProgramCacheKey = () => 'maram-palm-leaf';
    const TP = [], TU = [], TI = [], LP = [], LU = [], LS = [], LI = [];
    const plant = (x, z, H, lean, turn) => {
      // trunk: 14 rings, 8 sides, leaning and bending toward its top
      const rings = 14, sides = 8, base = TP.length / 3, top = new T.Vector3();
      for (let k = 0; k <= rings; k++) {
        const v = k / rings, rad = 0.36 * (1 - v * 0.35) + (k === 0 ? 0.1 : 0), bend = lean * v * v * H;
        const cx = x + Math.cos(turn) * bend, cz = z + Math.sin(turn) * bend, cy = v * H;
        if (k === rings) top.set(cx, cy, cz);
        for (let s = 0; s <= sides; s++) { const an = s / sides * TAUx; TP.push(cx + Math.cos(an) * rad, cy, cz + Math.sin(an) * rad); TU.push(s / sides, v * H / 1.2); }
      }
      for (let k = 0; k < rings; k++) for (let s = 0; s < sides; s++) { const i0 = base + k * (sides + 1) + s, i1 = i0 + sides + 1; TI.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1); }
      // crown: fronds out and down from the top, in two loose layers
      const nF = 12 + Math.floor(r() * 5), phase = r() * 10;
      for (let f = 0; f < nF; f++) {
        const az = f / nF * TAUx + r() * 0.4, up0 = (f % 2 ? 0.55 : 0.2) + r() * 0.25, L = 4.6 + r() * 1.6, W = 0.75 + r() * 0.2, segs = 10, fb = LP.length / 3;
        const dir = new T.Vector3(Math.cos(az), 0, Math.sin(az)), sideV = new T.Vector3(-Math.sin(az), 0, Math.cos(az));
        for (let k = 0; k <= segs; k++) {
          const v = k / segs, along = v * L, droop = up0 * along - 0.32 * along * along / L * 1.6;
          const c = top.clone().addScaledVector(dir, along); c.y += droop;
          const w = W * Math.sin(Math.min(1, v * 1.15) * Math.PI) * 0.9 + 0.05, tilt = 0.35 * v;
          for (const s of [-1, 1]) { LP.push(c.x + sideV.x * w * s, c.y - tilt * w * Math.abs(s) * 0.6, c.z + sideV.z * w * s); LU.push(v, s < 0 ? 0 : 1); LS.push(v, phase + f * 0.3); }
        }
        for (let k = 0; k < segs; k++) { const i0 = fb + k * 2; LI.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3); }
      }
    };
    // groups round the town, beyond the invisible wall, none in front of another's base
    const [x0, z0, x1, z1] = bounds, spots = [];
    for (let g = 0; g < 22; g++) {
      const side = g % 4, t = (g + r() * 0.8) / 22;
      const out = 4 + r() * 20;
      let gx, gz;
      if (side === 0) { gx = x0 - out; gz = z0 + (z1 - z0) * ((t * 4) % 1); } else if (side === 1) { gx = x1 + out; gz = z0 + (z1 - z0) * ((t * 4 + 0.5) % 1); }
      else if (side === 2) { gz = z0 - out; gx = x0 + (x1 - x0) * ((t * 4 + 0.25) % 1); } else { gz = z1 + out; gx = x0 + (x1 - x0) * ((t * 4 + 0.75) % 1); }
      const n = 1 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) { const px = gx + (r() - 0.5) * 7, pz = gz + (r() - 0.5) * 7; if (px > x0 - 4 && px < x1 + 4 && pz > z0 - 4 && pz < z1 + 4) continue; if (spots.some(([sx, sz]) => Math.hypot(sx - px, sz - pz) < 2.5)) continue; spots.push([px, pz]); plant(px, pz, 12 + r() * 5.5, 0.04 + r() * 0.1, r() * TAUx); }
    }
    const tg = new T.BufferGeometry(); tg.setAttribute('position', new T.Float32BufferAttribute(TP, 3)); tg.setAttribute('uv', new T.Float32BufferAttribute(TU, 2)); tg.setIndex(TI); tg.computeVertexNormals();
    const lg = new T.BufferGeometry(); lg.setAttribute('position', new T.Float32BufferAttribute(LP, 3)); lg.setAttribute('uv', new T.Float32BufferAttribute(LU, 2)); lg.setAttribute('aSway', new T.Float32BufferAttribute(LS, 2)); lg.setIndex(LI); lg.computeVertexNormals();
    const trunks = new T.Mesh(tg, trunkMat), leaves = new T.Mesh(lg, leafMat);
    for (const m of [trunks, leaves]) { m.castShadow = m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); root.add(m); }
    trunks.name = 'maram:palm-trunks'; leaves.name = 'maram:palm-leaves';
    return { count: spots.length, tris: (TI.length + LI.length) / 3, update(t) { sway.value = t; } };
  }

  /* Ramps and stairs are stairs of 25 cm columns to the game's physics (it collides with boxes only), so walking them
     moved the player up or down a few centimetres every few frames. Smoothing that over time made the view trail
     behind and still stutter, which felt like lag. So the eye is drawn at the model's real floor averaged over a small
     circle round the feet (13 points out to 60 cm, only floor within 45 cm of the feet counts, so walls and drops do not
     pull it): on a slope that is the slope itself, on stairs a ramp over them, and it moves exactly with the player.
     It is only for the drawing: the player's real height, jumps and every shot are the game's own. In the air the
     difference fades out in a tenth of a second, and comes back as fast on landing. */
  /* The model's own floors (every triangle facing up), filed on a 1 m grid: the height of the real surface at a point,
     where the boxes only know steps of 25 cm. */
  function floorIndex(T, meshes) {
    const C = 1, X0 = BOUNDS.x0 - 4, Z0 = BOUNDS.z0 - 4, W = Math.ceil((BOUNDS.x1 - BOUNDS.x0 + 8) / C), D = Math.ceil((BOUNDS.z1 - BOUNDS.z0 + 8) / C);
    const cells = Array.from({ length: W * D }, () => []), tris = [], a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), e1 = new T.Vector3(), e2 = new T.Vector3();
    for (const m of meshes) {
      const P = m.geometry.attributes.position, I = m.geometry.index, n = I ? I.count : P.count;
      for (let t = 0; t + 2 < n; t += 3) {
        a.fromBufferAttribute(P, I ? I.getX(t) : t); b.fromBufferAttribute(P, I ? I.getX(t + 1) : t + 1); c.fromBufferAttribute(P, I ? I.getX(t + 2) : t + 2);
        e1.subVectors(b, a); e2.subVectors(c, a); e1.cross(e2); const len = e1.length();
        if (len < 1e-8 || Math.abs(e1.y) / len < 0.6) continue;                 // walls, and anything steeper than about 53 degrees
        const k = tris.length / 9; tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - X0) / C)), i1 = Math.min(W - 1, Math.floor((Math.max(a.x, b.x, c.x) - X0) / C));
        const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - Z0) / C)), j1 = Math.min(D - 1, Math.floor((Math.max(a.z, b.z, c.z) - Z0) / C));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells[j * W + i].push(k);
      }
    }
    const TR = new Float32Array(tris);
    // the highest floor between lo and hi straight under (x, z), or NaN
    return (x, z, lo, hi) => {
      const i = Math.floor((x - X0) / C), j = Math.floor((z - Z0) / C); if (i < 0 || j < 0 || i >= W || j >= D) return NaN;
      let best = NaN;
      for (const k of cells[j * W + i]) {
        const o = k * 9, x1 = TR[o], z1 = TR[o + 2], x2 = TR[o + 3], z2 = TR[o + 5], x3 = TR[o + 6], z3 = TR[o + 8];
        const det = (z2 - z3) * (x1 - x3) + (x3 - x2) * (z1 - z3); if (Math.abs(det) < 1e-9) continue;
        const l1 = ((z2 - z3) * (x - x3) + (x3 - x2) * (z - z3)) / det, l2 = ((z3 - z1) * (x - x3) + (x1 - x3) * (z - z3)) / det, l3 = 1 - l1 - l2;
        if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
        const h = l1 * TR[o + 1] + l2 * TR[o + 4] + l3 * TR[o + 7];
        if (h >= lo && h <= hi && !(h <= best)) best = h;
      }
      return best;
    };
  }
  function smoothEye(G, meshes) {
    const ph = G.physics, RING = [[0, 0, 2]], surface = floorIndex(G.THREE, meshes);
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; RING.push([Math.cos(a) * 0.3, Math.sin(a) * 0.3, 1.5], [Math.cos(a + 0.52) * 0.6, Math.sin(a + 0.52) * 0.6, 1]); }
    let off = 0, grounded = false, last = performance.now(), base = 0, wrote = NaN;
    // the floor averaged round the feet: the model's real surface where it has one, else the top of the boxes there
    const floorAt = (x, y, z) => {
      let sum = 0, w = 0;
      for (const [dx, dz, k] of RING) {
        let h = surface(x + dx, z + dz, y - 0.45, y + 0.45);
        if (Number.isNaN(h)) { h = ph.groundHeight(x + dx, z + dz, y + 0.45); if (!(h > y - 0.45)) continue; }
        sum += h * k; w += k;
      }
      return w ? sum / w : y;
    };
    G.render.addPrePass(() => {
      const P = G.player, cam = G.camera, now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (!P || !P.alive || !cam || !P.pos) { off = 0; wrote = NaN; return; }
      // the height the game put the eye at this frame; when it did not set it again (paused, or a frame drawn twice),
      // the camera still holds what was written here, and the offset must not be added on top of it once more
      if (cam.position.y !== wrote) base = cam.position.y;
      const want = P.onGround ? Math.max(-0.3, Math.min(0.3, floorAt(P.pos.x, P.pos.y, P.pos.z) - P.pos.y)) : 0;
      // on the ground the average is taken as it is (it moves with the feet, so there is nothing to wait for); only
      // leaving the ground and landing are eased, so a jump does not start or end with a jolt
      if (P.onGround && grounded) off = want; else off += (want - off) * (1 - Math.exp(-dt * (P.onGround ? 30 : 20)));
      grounded = !!P.onGround;
      cam.position.y = wrote = base + off; cam.updateMatrixWorld(true);
    });
  }

  /* ------------------------------------------------------------------ the level */
  async function level(G) {
    const T = G.THREE, root = new T.Group(); root.name = 'maram'; G.scene.add(root);
    const [[data, buf], sets] = await Promise.all([fetchFiles(), loadDetail(G).catch(e => { console.warn('[maram] the detail pictures did not load; drawing the model plain: ' + (e && e.message || e)); return null; })]);
    const model = await buildModel(G, parseGlb(buf), data, root, sets);
    const boxes = addBoxes(G, data), { info: physics, near } = installPhysics(G);
    walkGrid(G, data.walk);
    { const t0 = performance.now(), r = makeRoofs(G); roofU.tRoof.value = r.tex; roofU.uRoof.value = r.rect; model.roofsMs = Math.round(performance.now() - t0); }
    const shadow = fitShadows(G, data), sky = await makeSky(G);
    G.mats.uniforms.wet.value = 0;                                 // dry as bone
    { const emit = G.events.emit; G.events.emit = function (name, d) { if (name === 'thunder') return; return emit.call(this, name, d); }; }   // and no thunder out of a clear sky
    // brighter light in the air for the beams (its thickness is the game's own, fixed at start; see "air"), more glow
    // round the low sun, and contact shadow in the corners
    if (G.render.tune) Object.assign(G.render.tune, { aoIntensity: 1.55, aoRadius: 1.1, volSunScale: 1.15, flare: 0.12, bloom: 0.08, key: 0.24, maxExposure: 2.4 });
    const air = makeAir(G), motes = makeMotes(G, root), beams = makeBeams(G, root), palms = makePalms(G, root, data.bounds); motes.air = air;
    smoothEye(G, root.children.filter(m => m.isMesh && m.name.startsWith('maram:material')));
    // the light of the sky in the shade, and the same for the gun in the hands. No fill light from the other side: it
    // had no source and cast no shadow, so it lit faces the sun could not reach (a crate in a wall's shadow glowed)
    const hemi = new T.HemisphereLight(new T.Color(0.74, 0.82, 1.0), new T.Color(0.86, 0.66, 0.42), 0.6);
    hemi.layers.enable(1); root.add(hemi);
    if (G.camera && G.camera.far < 1100) { G.camera.far = 1100; G.camera.updateProjectionMatrix(); }

    // spawns: the game's multiplayer puts everyone at height 0 and faces them to the middle; lift each onto its floor
    const spawns = data.spawns.map(([x, y, z, yaw]) => ({ x, y, z, yaw }));
    const lift = () => {
      const P = G.player; if (!P || P._maram) return !!P;
      const reset = P.reset; P._maram = true;
      P.reset = function (s) {
        if (s && s.pos && s.pos.y === 0) {
          let best = null, bd = 2.5;
          for (const p of spawns) { const d = Math.hypot(p.x - s.pos.x, p.z - s.pos.z); if (d < bd) { bd = d; best = p; } }
          if (best) {
            // keep the game's small shuffle where the floor there is level with the spawn, else stand on the spawn itself
            const y = G.physics.groundHeight(s.pos.x, s.pos.z, best.y + 0.3);
            if (Math.abs(y - best.y) > 0.05) s.pos.set(best.x, best.y, best.z); else s.pos.y = best.y;
            s.yaw = best.yaw;
          }
        }
        safe.ok = false;
        return reset.call(this, s);
      };
      return true;
    };
    /* In a tight corner of many small boxes the game's push out of walls can fail and leave a player inside solid
       ground (the build's robot found one such corner, crouching along a ramp by the back of the high site). A
       player's middle is never inside a box otherwise, so when it is, they are put back where they last stood. */
    const safe = new T.Vector3(); safe.ok = false;
    const inside = p => { for (const b of near(p.x, p.z)) if (!b.bulletOnly && p.x > b.min.x && p.x < b.max.x && p.z > b.min.z && p.z < b.max.z && p.y + 0.5 > b.min.y && p.y + 0.5 < b.max.y) return true; return false; };
    let rescues = 0;
    const guard = () => {
      const P = G.player; if (!P || !P.alive || !P.pos) return;
      if (inside(P.pos)) { if (safe.ok) { P.pos.copy(safe); P.vel.set(0, 0, 0); rescues++; } }
      else if (P.onGround) { safe.copy(P.pos); safe.ok = true; }
    };
    { let n = 0; const tick = () => { if (!lift() && ++n < 3600) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }

    let fill = 1.1, clock = 0; const fwd = new T.Vector3();
    // the painted sky is bright all round; at the game's strength its light would flatten every shadow. The game sets
    // the strength again when it finishes starting, so it is held here for the first seconds and on every frame of play
    const ENV = 0.5, hold = () => { if (G.scene.environmentIntensity !== ENV) G.scene.environmentIntensity = ENV; };
    hold(); { let n = 0; const tick = () => { hold(); if (++n < 600) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
    const start = spawns[0];
    return {
      root, name: 'Maram',
      playerStart: { pos: new T.Vector3(start.x, start.y, start.z), yaw: start.yaw },
      objectives: [], extraction: { pos: new T.Vector3(0, -50, 0), radius: 1 },
      enemySpawns: spawns.map(p => ({ pos: new T.Vector3(p.x, p.y, p.z), zone: 'town', type: 'ground' })),
      zones: [{ name: 'town', min: [BOUNDS.x0, BOUNDS.z0], max: [BOUNDS.x1, BOUNDS.z1] }], interiorBoxes: [air.box], coverPoints: [], skylights: [], shedLights: [], placed: [],
      cinematicPath: data.cinematic || [],
      explosives: [], explosivesOnly: true, ambience: { sea: 0, harbour: false, rain: 0, wind: 0 },
      stats: { ...model, boxes, physics, shadow, sky, beams: beams.count, palms: palms.count, palmTris: palms.tris, check: data.check, get rescues() { return rescues; } },
      // the two ammo piles (web/guns.js): on a crate on each side, as the game would pick them on a flat map
      ammoSpots: (data.ammo || []).map(([x, y, z]) => ({ x, y, z })),
      groundSurfaceAt: () => SURFACE.sand,
      update(dt) {
        hold(); lift(); guard();
        if (G.render.interiorEnv) G.render.interiorEnv = null;       // the town is not indoors (see AIR)
        clock += dt; motes.update(clock); beams.update(clock); palms.update(clock);
        if (G.render.sunDir && G.camera) { const d = G.camera.getWorldDirection(fwd), e = Math.max(0, d.x * G.render.sunDir.x + d.z * G.render.sunDir.z); fill += (1.1 + 0.6 * e * e - fill) * Math.min(1, dt * 2.5); G.render.viewFill = fill; }
      },
    };
  }

  MAPS.maram = {
    id: 'maram', name: 'Maram', boot: ['Raising the walls', 'Hanging the doors', 'Sweeping the sand', 'Waking the town'],
    pre, level,
    _debug: { cover, COVER, KIND_OF, KINDS, AIR },
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
  };
})();
