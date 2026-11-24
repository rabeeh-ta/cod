// Turns the downloaded vehicle models (.glb, from Sketchfab) into what Area 51 loads from web/maps/area51/models/: for each,
// one small binary of geometry, a manifest (materials, credit, collision boxes) and textures cut down to size. The source
// files are far too heavy to ship (8 to 125 MB, almost all of it 2048 and 4096 px pictures) and the game has no model
// loader, so each model is prepared once, here, and the results are committed. The .glb files themselves never are.
//
//   node scripts/area51-models.mjs ~/Downloads/3d "~/Downloads/3d new"            (all of them; a file is looked for in each folder)
//   node scripts/area51-models.mjs ~/Downloads/3d "~/Downloads/3d new" ural suv   (some)
//
// Needs macOS (`sips` resizes and re-encodes the textures). A model with `simplify` set also needs the meshoptimizer
// package (`npm i --no-save meshoptimizer`); nothing else does.
//
// In the output every model is in the same space: metres, its front toward +X, up +Y, its right-hand side +Z, the middle of
// its footprint at the origin and its wheels on y = 0. The collision is boxes in that space: each 30 cm column of the model,
// from its lowest surface to its highest, the columns of one height merged. The map turns a model only by quarter turns, so
// the boxes stay square to the world.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { inflateSync, deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'maps', 'area51', 'models');

/* What to take from each file.
     file      the download's name
     rotY      degrees about +Y that turn the file's front to +X (rotZ, before it: degrees about +Z, to stand up a thing lying down)
     opaque    a file marked see-through that is not (an enclosure exported as glass): its pictures are taken as they are
     nodes     the nodes (by name) whose meshes, and their children's, are taken: one unit out of a kit whose parts share materials
     only      the materials (by name) to take: one object out of a file that holds several; simplifySkip: materials whose
               meshes are left as they are (leaf cards)
     size      [axis, metres]: the model is scaled so its extent along that axis (after the turn) is this
     drop      pieces (connected triangles) to leave out, whole: { material } by name, or { box: [lo, hi] } in the file's own
               space (as the file's numbers read, before the turn and scale): every piece wholly inside it goes. The inside of
               a cab behind dark glass, the springs under a body
     merge     makes the small parts drawn with thousands of triangles (rims, handles, lamps, tyre treads) lighter: in each,
               vertices close together (a 14th of the part, at least this many metres, at most 2.5 cm) with a like normal and
               texture place become one. Only parts under half a metre (or mergeUnder): doors, bonnets and panels are left
               exactly as they are
     simplify  about how many triangles the whole model is brought down to (needs meshoptimizer, see above); simplifyError:
               how far the shape may move, as a share of each mesh's size (0.05)
     dropUnder pieces smaller than this (metres, longest side) go: bolts, nuts, rivets nobody sees from where players stand
     unify     materials sampling the same pictures with the same numbers become one; flat: the untextured ones become one,
               their colours carried by the vertices (glass drawn dark and solid)
     center    [[x0, z0], [x1, z1]] in the file's own space: the middle of this, not of the whole model, goes to the origin
               (a radar that swings out to one side)
     clip      the collision only inside this box (output space): mirrors and antennas are drawn, not walked into
     textures  longest side, in pixels, of each kind of texture                                                         */
const MODELS = {
  ural: {
    file: 'ural_4320.glb', rotY: 90, size: ['x', 7.57],
    clip: [[-4, 0, -1.42], [4, 3.4, 1.42]],                  // the body; the mirrors stand out to 1.53
    textures: { color: 1024, normal: 1024, orm: 512 },
  },
  forklift: {
    file: 'forklift_gameready.glb', rotY: 90, size: ['y', 2.15],      // drawn at about 6/10 of life size: scaled to a 2.15 m guard
    merge: 0.012, mergeUnder: 0.7, simplify: 8000,                                   // its four tyres (64 cm) were 13,400 of its 17,700 triangles
    textures: { color: 1024, normal: 1024, orm: 512 },
  },
  suv: {
    file: 'military_truck.glb', rotY: 180, size: ['x', 4.9],
    drop: [{ box: [[-1.36, 0.55, -0.915], [2.0, 1.62, 0.915]] },     // the cab's inside: seats, dashboard, steering wheel, mirror
      { box: [[-1.9, 0.2, -0.65], [1.45, 0.6, 0.65]] }],             // the springs under it (13,600 triangles nobody sees)
    merge: 0.012, simplify: 16000,
    clip: [[-2.5, 0, -1.02], [2.5, 2, 1.02]],                        // the body; the mirrors stand out to 1.16
    textures: { color: 1024, normal: 1024, orm: 512 },
  },
  marmot: {                                                          // CC BY-NC: no selling the game while it is in it
    file: 'marmot_-_fictional_air-defence_radar_truck.glb', rotY: 90, size: ['x', 9.515],
    drop: [{ material: 'marmot_interior' }, { material: 'marmot_seat' }, { material: 'marmot_screen' }],
    dropUnder: 0.08, merge: 0.012, mergeUnder: 1.2, unify: true, flat: true, simplify: 18000, looseUV: true,
    clip: [[-5, 0, -1.3], [5, 4.2, 1.3]],                            // the body up to its radar; mirrors and whip antennas are drawn only
    textures: { color: 1024, normal: 1024, orm: 512 },
  },
  /* ---- props: drawn in the place of a box the map already builds (the box stays the collision), so each is made 1 m in
     one direction and the map fits it to its box. Small textures: nobody stands a hand's width from a pallet */
  crate1: { file: 'wooden_boxes_and_crates_kit.glb', only: ['Material', 'Empty'], size: ['y', 1], textures: { color: 512, normal: 512, orm: 256 } },
  crate2: { file: 'wooden_boxes_and_crates_kit.glb', only: ['Material.001', 'Empty.001'], size: ['y', 1], textures: { color: 512, normal: 512, orm: 256 } },
  crate3: { file: 'wooden_boxes_and_crates_kit.glb', only: ['Material.003'], size: ['y', 1], textures: { color: 512, normal: 512, orm: 256 } },
  crate5: { file: 'wooden_boxes_and_crates_kit.glb', only: ['Material.006'], size: ['y', 1], textures: { color: 512, normal: 512, orm: 256 } },
  pallet: { file: 'wooden_pallet_low-poly.glb', size: ['x', 1], simplify: 220, textures: { color: 512, normal: 512, orm: 256 } },
  tyre: { file: 'old_tyres.glb', only: ['tire_thin_line'], rotZ: 90, size: ['y', 1], simplify: 1200, textures: { color: 512, normal: 512, orm: 256 } },       // one of its four, stood up, its axle along x (the studded tyre is 1.5 million triangles of scan that will not come down)
  ibc: { file: 'ibc_tank.glb', size: ['y', 1.16], simplify: 1500, textures: { color: 512, normal: 512, orm: 256 } },                                          // CC BY-NC
  bicycle: { file: 'vintage_bicycle.glb', size: ['y', 1.05], simplify: 9000, simplifyError: 0.004, simplifySkip: ['whell'], textures: { color: 512, normal: 256, orm: 256 } },
  table: { file: 'picnic_table_-_low_poly.glb', size: ['y', 0.78], textures: { color: 512, normal: 512, orm: 256 } },
  jerry: { file: 'jerry_cans_model_free.glb', only: ['JerryCan', 'Jerrycan_1'], size: ['y', 0.47], simplify: 2400, textures: { color: 512, normal: 512, orm: 256 } },
  bench: { file: 'workbench.glb', size: ['x', 3.2], simplify: 3000, textures: { color: 1024, normal: 1024, orm: 512 } },     // a bench, a tool chest and a tool board
  hoist: { file: 'engine_hoist_-_engine_crane.glb', size: ['y', 1.9], dropUnder: 0.04, simplify: 3500, textures: { color: 512, normal: 512, orm: 256 } },
  gen: { file: 'generator_lp.glb', size: ['y', 0.72], simplify: 1800, textures: { color: 1024, normal: 512, orm: 512 } },
  genset: { file: 'simple_generatorfixed.glb', size: ['y', 1.4], opaque: true, simplify: 2400, textures: { color: 1024, normal: 512, orm: 512 } },
  ammo: { file: 'ammo_boxes_-_free_game_asset.glb', only: ['01_exp_Export'], size: ['y', 0.62], simplify: 3000, textures: { color: 1024, normal: 512, orm: 512 } },
  acacia: { file: 'acacia_tree.glb', size: ['y', 6.2], center: [[-0.01, -0.01], [0.01, 0.01]], noBoxes: true, simplify: 2600, simplifySkip: ['acacia_branch_1Mat'], textures: { color: 1024, normal: 512, orm: 256 } },
  acunit: { file: 'ac_outdoor_unit_-_lowploy_game_asset.glb', size: ['y', 0.62], textures: { color: 512, normal: 512, orm: 256 } },                             // CC BY-NC
  hvac: { file: 'hvac_unit.glb', only: ['material39'], size: ['y', 1.1], opaque: true, simplify: 800, textures: { color: 1024, normal: 512, orm: 512 } },
  rtu: { file: 'rooftop_ventilation_modular_kit.glb', nodes: ['HVAC_UnitA'], size: ['x', 1], textures: { color: 1024, normal: 512, orm: 512 } },         // the packaged rooftop unit out of the kit (3.5 m, 1.64 m tall): roof cover
  // not taken: the radio telescope (1.9 million triangles), the hose reel scan (600,000) and the freeway flood light (350,000 in 23
  // materials) would not come under 15,000 without their textures tearing; the solar water heater (450,000) loses its tubes; the cable reel and the case stack stay over 14,000 each; the old bicycle and the jersey barrier are under
  // Sketchfab's Standard licence, which does not let a public repository hand them on
  apc: { file: 'military_vehicle.glb', size: ['x', 7.6], simplify: 12000, clip: [[-4, 0, -1.5], [4, 2.9, 1.5]], textures: { color: 1024, normal: 1024, orm: 512 } },
  renault: {
    file: 'renault_trm_radar_truck.glb', rotY: 90, size: ['x', 10.33],
    center: [[-160, -507], [146, 525]],                              // the truck between its wheels, not its radar swung out to one side
    merge: 0.012, flat: true, simplify: 14000,
    clip: [[-5.3, 0, -1.35], [5.3, 4.0, 1.35]],                       // the truck to the top of its shelter; the radar above is drawn only
    textures: { color: 1024, normal: 1024, orm: 512 },
  },
};

const args = process.argv.slice(2), only = args.filter(a => MODELS[a]), srcDirs = args.filter(a => !MODELS[a]);
if (!srcDirs.length) { console.error('usage: node scripts/area51-models.mjs <folder with the .glb files> [another folder ...] [id ...]'); process.exit(1); }
mkdirSync(OUT, { recursive: true });
for (const [id, cfg] of Object.entries(MODELS)) if (!only.length || only.includes(id)) await convert(id, cfg);

async function convert(id, cfg) {
  const src = srcDirs.map(d => join(d, cfg.file)).find(existsSync);
  if (!src) throw new Error(`${id}: ${cfg.file} is in none of ${srcDirs.join(', ')}`);
  /* ---- read the .glb */
  const buf = readFileSync(src), jl = buf.readUInt32LE(12), gltf = JSON.parse(buf.subarray(20, 20 + jl).toString('utf8'));
  const bin = buf.subarray(28 + jl, 28 + jl + buf.readUInt32LE(20 + jl));
  const CT = { 5126: [4, o => bin.readFloatLE(o)], 5125: [4, o => bin.readUInt32LE(o)], 5123: [2, o => bin.readUInt16LE(o)], 5122: [2, o => bin.readInt16LE(o)], 5121: [1, o => bin.readUInt8(o)], 5120: [1, o => bin.readInt8(o)] }, NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const read = ai => {
    const a = gltf.accessors[ai], bv = gltf.bufferViews[a.bufferView], n = NC[a.type], [s, get] = CT[a.componentType], st = bv.byteStride || s * n, off = (bv.byteOffset || 0) + (a.byteOffset || 0), out = [];
    const norm = a.normalized ? { 5121: 255, 5123: 65535, 5120: 127, 5122: 32767 }[a.componentType] || 1 : 1;
    for (let i = 0; i < a.count; i++) { const v = []; for (let k = 0; k < n; k++) v.push(get(off + i * st + k * s) / norm); out.push(v); }
    return out;
  };
  const mul = (A, B) => { const R = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) R[c * 4 + r] += A[k * 4 + r] * B[c * 4 + k]; return R; };
  const local = n => { if (n.matrix) return n.matrix; const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], t = n.translation || [0, 0, 0];
    return [(1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0, (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
      (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, t[0], t[1], t[2], 1]; };

  /* ---- every triangle in the file's world space, by material */
  const tri = [];           // { mat, p: [[x,y,z]x3], n: [[...]x3], uv: [[u,v]x3] }
  // simplify: each mesh is brought down as it is read, by the share that takes the whole file to about that many triangles
  // (meshoptimizer: seams and borders kept, the shape held to 5% of the mesh's size unless simplifyError says otherwise)
  let simp = null, ratio = 1;
  if (cfg.simplify) {
    try { simp = (await import('meshoptimizer')).MeshoptSimplifier; await simp.ready; } catch { throw new Error(`${id}: simplify needs the meshoptimizer package: npm i --no-save meshoptimizer`); }
    let total = 0; for (const node of gltf.nodes) if (node.mesh != null) for (const prim of gltf.meshes[node.mesh].primitives) { if (cfg.only && !cfg.only.includes((gltf.materials[prim.material] || {}).name || '')) continue; total += (prim.indices != null ? gltf.accessors[prim.indices].count : gltf.accessors[prim.attributes.POSITION].count) / 3; }
    ratio = Math.min(1, cfg.simplify / total);
  }
  const walk = (list, M, inside = !cfg.nodes) => { for (const i of list) { const node = gltf.nodes[i], W = mul(M, local(node)), inn = inside || cfg.nodes.includes(node.name);
    if (node.mesh != null && inn) for (const prim of gltf.meshes[node.mesh].primitives) {
      if ((prim.mode ?? 4) !== 4) continue;
      const pmName = (gltf.materials[prim.material] || {}).name || '';
      if (cfg.only && !cfg.only.includes(pmName)) continue;                 // one object out of a file that holds several
      const P = read(prim.attributes.POSITION).map(([x, y, z]) => [W[0] * x + W[4] * y + W[8] * z + W[12], W[1] * x + W[5] * y + W[9] * z + W[13], W[2] * x + W[6] * y + W[10] * z + W[14]]);
      const Nn = prim.attributes.NORMAL != null ? read(prim.attributes.NORMAL).map(([x, y, z]) => { const v = [W[0] * x + W[4] * y + W[8] * z, W[1] * x + W[5] * y + W[9] * z, W[2] * x + W[6] * y + W[10] * z], l = Math.hypot(...v) || 1; return v.map(c => c / l); }) : null;
      const UV = prim.attributes.TEXCOORD_0 != null ? read(prim.attributes.TEXCOORD_0) : P.map(() => [0, 0]);
      let I = prim.indices != null ? read(prim.indices).map(v => v[0]) : P.map((_, k) => k), PP = P, NN = Nn, UU = UV;
      const det = W[0] * (W[5] * W[10] - W[9] * W[6]) - W[4] * (W[1] * W[10] - W[9] * W[2]) + W[8] * (W[1] * W[6] - W[5] * W[2]);   // a mirrored node turns its triangles inside out
      if (simp && ratio < 1 && I.length > 180 && !(cfg.simplifySkip || []).includes(pmName)) {
        // welded by place and texture place first: a model shaded flat has a vertex per face at every corner, which the
        // simplifier takes for seams and will not move. The normals are made again after, hard where faces meet at over 35 deg
        const span = Math.max(...[0, 1, 2].map(a2 => Math.max(...P.map(q => q[a2])) - Math.min(...P.map(q => q[a2])))) || 1, eps = span * 2e-5, wk = new Map(), wp = [], wu = [];
        // looseUV: by place alone (a model whose every face has its own patch of the texture has no vertex left to move
        // otherwise); each new triangle then takes, at its three places, the old corners closest together in the texture
        const wed = [], wi = I.map(k2 => { const q = P[k2], u = UV[k2], key = Math.round(q[0] / eps) + ',' + Math.round(q[1] / eps) + ',' + Math.round(q[2] / eps) + (cfg.looseUV ? '' : '|' + Math.round(u[0] * 4096) + ',' + Math.round(u[1] * 4096));
          let ix = wk.get(key); if (ix == null) { ix = wp.length; wk.set(key, ix); wp.push(q); wu.push(u); wed.push([]); } if (cfg.looseUV && Nn) wed[ix].push([Nn[k2], u]); return ix; });
        const want = Math.max(12, Math.round(I.length / 3 * ratio)) * 3, flat = new Float32Array(wp.length * 3); wp.forEach((q, k2) => flat.set(q, k2 * 3));
        const J = simp.simplify(new Uint32Array(wi), flat, 3, want, cfg.simplifyError ?? 0.05)[0], sg = det < 0 ? -1 : 1, fn = [], inc = new Map();
        for (let t = 0; t < J.length; t += 3) { const A = wp[J[t]], B = wp[J[t + 1]], Cc = wp[J[t + 2]], e1 = [0, 1, 2].map(a2 => B[a2] - A[a2]), e2 = [0, 1, 2].map(a2 => Cc[a2] - A[a2]);
          fn.push([(e1[1] * e2[2] - e1[2] * e2[1]) * sg, (e1[2] * e2[0] - e1[0] * e2[2]) * sg, (e1[0] * e2[1] - e1[1] * e2[0]) * sg]);          // length: twice the area, so big faces weigh more
          for (let v = 0; v < 3; v++) { const l = inc.get(J[t + v]); if (l) l.push(t / 3); else inc.set(J[t + v], [t / 3]); } }
        const unit = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); }, fu = fn.map(unit);
        PP = []; NN = []; UU = []; I = [];
        for (let t = 0; t < J.length; t += 3) { const f = t / 3; let uvs = [wu[J[t]], wu[J[t + 1]], wu[J[t + 2]]];
          if (cfg.looseUV) {      // the three old corners, one at each place, that lie closest together in the texture: one island, not three
            const cand = [0, 1, 2].map(v => { const seen = new Set(), out = []; for (const w of wed[J[t + v]]) { const key = Math.round(w[1][0] * 2048) + ',' + Math.round(w[1][1] * 2048); if (!seen.has(key)) { seen.add(key); out.push(w); } } return out.slice(0, 12); });
            let best = Infinity; const d2 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
            for (const A of cand[0]) for (const B of cand[1]) { const ab = d2(A[1], B[1]); if (ab >= best) continue; for (const Cc of cand[2]) {
              const sc = ab + d2(B[1], Cc[1]) + d2(Cc[1], A[1]) - 0.002 * (A[0][0] * fu[f][0] + A[0][1] * fu[f][1] + A[0][2] * fu[f][2]); if (sc < best) { best = sc; uvs = [A[1], B[1], Cc[1]]; } } }
          }
          for (let v = 0; v < 3; v++) { const sum = [0, 0, 0];
            for (const g of inc.get(J[t + v])) if (fu[f][0] * fu[g][0] + fu[f][1] * fu[g][1] + fu[f][2] * fu[g][2] > 0.82) { sum[0] += fn[g][0]; sum[1] += fn[g][1]; sum[2] += fn[g][2]; }
            I.push(PP.length); PP.push(wp[J[t + v]]); UU.push(uvs[v]); NN.push(unit(sum)); } }
      }
      for (let t = 0; t < I.length; t += 3) { const o = det < 0 ? [I[t], I[t + 2], I[t + 1]] : [I[t], I[t + 1], I[t + 2]];
        const p = o.map(k => PP[k]), e1 = [0, 1, 2].map(a => p[1][a] - p[0][a]), e2 = [0, 1, 2].map(a => p[2][a] - p[0][a]), fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], fl = Math.hypot(...fn);
        if (fl < 1e-12) continue;
        tri.push({ mat: prim.material ?? 0, p, n: NN ? o.map(k => NN[k]) : [0, 1, 2].map(() => fn.map(c => c / fl)), uv: o.map(k => UU[k]) }); }
    }
    walk(node.children || [], W, inn); } };
  walk(gltf.scenes[gltf.scene || 0].nodes, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  /* ---- into output space: the turn, the scale, the footprint's middle at the origin, the lowest point on y = 0 */
  const a = (cfg.rotY || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), az = (cfg.rotZ || 0) * Math.PI / 180, cz = Math.cos(az), sz = Math.sin(az);
  const turn = ([x0, y0, z]) => { const x = x0 * cz - y0 * sz, y = x0 * sz + y0 * cz; return [x * c + z * s, y, -x * s + z * c]; };      // rotZ first: a thing lying down stood up
  for (const t of tri) { t.f = t.p; t.p = t.p.map(turn); t.n = t.n.map(turn); }
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const t of tri) for (const q of t.p) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); }
  const ax = { x: 0, y: 1, z: 2 }[cfg.size[0]], k = cfg.size[1] / (hi[ax] - lo[ax]), mid = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
  if (cfg.center) { const cm = turn([(cfg.center[0][0] + cfg.center[1][0]) / 2, 0, (cfg.center[0][1] + cfg.center[1][1]) / 2]); mid[0] = cm[0]; mid[2] = cm[2]; }
  for (const t of tri) t.p = t.p.map(q => [(q[0] - mid[0]) * k, (q[1] - mid[1]) * k, (q[2] - mid[2]) * k]);
  const size = [0, 1, 2].map(i => +((hi[i] - lo[i]) * k).toFixed(3));

  /* ---- pieces to leave out, whole: triangles joined by a shared corner are one piece */
  let kept = tri;
  if (cfg.drop && cfg.drop.length) {
    const matName = m => (gltf.materials[m] || {}).name || '', vid = new Map(), id3 = q => { const key = q.map(v => Math.round(v * 1e4)).join(','); if (!vid.has(key)) vid.set(key, vid.size); return vid.get(key); };
    const tv = tri.map(t => t.f.map(id3)), par = [...Array(vid.size).keys()], find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (const [a0, b0, c0] of tv) { const r = find(a0); par[find(b0)] = r; par[find(c0)] = r; }
    const inside = (q, b) => q.every((v, i) => v >= b[0][i] && v <= b[1][i]), out = new Map();      // root -> is every corner of the piece inside some box
    for (const [i, t] of tri.entries()) { const r = find(tv[i][0]), o = out.get(r) || { all: cfg.drop.filter(d => d.box).map(() => true), mat: false };
      cfg.drop.filter(d => d.box).forEach((d, k) => { if (!t.f.every(q => inside(q, d.box))) o.all[k] = false; });
      if (cfg.drop.some(d => d.material && matName(t.mat).includes(d.material))) o.mat = true; out.set(r, o); }
    kept = tri.filter((t, i) => { const o = out.get(find(tv[i][0])); return !(o.mat || o.all.some(Boolean)); });
  }
  /* ---- small dense parts made lighter (see merge above): in each piece under half a metre with more than 150 triangles,
     the vertices in one cell (a 14th of the piece, at least `merge`, at most 2.5 cm) with a like normal and texture place
     become one. A door or a bonnet is never touched */
  if (cfg.merge || cfg.dropUnder) {
    const vid = new Map(), id3 = q => { const key = q.map(v => Math.round(v * 1e4)).join(','); if (!vid.has(key)) vid.set(key, vid.size); return vid.get(key); };
    const tv = kept.map(t => t.p.map(id3)), par = [...Array(vid.size).keys()], find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (const [a0, b0, c0] of tv) { const r = find(a0); par[find(b0)] = r; par[find(c0)] = r; }
    const piece = new Map();     // root -> { n, lo, hi }
    kept.forEach((t, i) => { const r = find(tv[i][0]), pc = piece.get(r) || { n: 0, lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9] }; pc.n++; for (const q of t.p) for (let a = 0; a < 3; a++) { pc.lo[a] = Math.min(pc.lo[a], q[a]); pc.hi[a] = Math.max(pc.hi[a], q[a]); } piece.set(r, pc); });
    for (const pc of piece.values()) { const L = Math.max(...pc.hi.map((v, a) => v - pc.lo[a])); pc.gone = L < (cfg.dropUnder || 0); pc.cell = cfg.merge && pc.n > 150 && L < (cfg.mergeUnder || 0.5) ? Math.min(0.025, Math.max(cfg.merge, L / 14)) : 0; }
    kept = kept.filter((t, i) => !piece.get(find(tv[i][0])).gone); const tvk = kept.map(t => t.p.map(id3));
    const reps = new Map(), keyOf = (t, v, r, M) => { const p = t.p[v], n = t.n[v], uv = t.uv[v]; return r + '|' + [Math.floor(p[0] / M), Math.floor(p[1] / M), Math.floor(p[2] / M), Math.round(n[0] * 1.5), Math.round(n[1] * 1.5), Math.round(n[2] * 1.5), Math.floor(uv[0] * 32), Math.floor(uv[1] * 32)].join(','); };
    const before = kept.length;
    kept.forEach((t, i) => { const r = find(tvk[i][0]), M = piece.get(r).cell; if (!M) return; t.k = [0, 1, 2].map(v => keyOf(t, v, r, M));
      t.k.forEach((key, v) => { let q = reps.get(key); if (!q) reps.set(key, (q = { s: [0, 0, 0], n: [0, 0, 0], c: 0, uv: t.uv[v] })); for (let a = 0; a < 3; a++) { q.s[a] += t.p[v][a]; q.n[a] += t.n[v][a]; } q.c++; }); });
    kept = kept.filter(t => !t.k || (t.k[0] !== t.k[1] && t.k[1] !== t.k[2] && t.k[0] !== t.k[2])).map(t => { if (!t.k) return t; const R = t.k.map(key => reps.get(key));
      return { mat: t.mat, p: R.map(q => q.s.map(v => v / q.c)), n: R.map(q => { const l = Math.hypot(...q.n) || 1; return q.n.map(v => v / l); }), uv: R.map(q => q.uv) }; });
    console.log(`${id}: small parts took ${tri.length} triangles (${before} after the drops) to ${kept.length}`);
    if (process.env.A51_PIECES) { const top = [...piece.values()].sort((x, y) => y.n - x.n).slice(0, +process.env.A51_PIECES); for (const pc of top) console.log('   piece', pc.n, 'tris, cell', pc.cell.toFixed(3), 'size', pc.hi.map((v, a) => (v - pc.lo[a]).toFixed(2)).join('x'), 'at', pc.hi.map((v, a) => ((v + pc.lo[a]) / 2).toFixed(2)).join(',')); }
  }
  /* ---- textures: colour, normal and occlusion/roughness/metal per material, resized with sips. A see-through colour
     picture (glass drawn in the texture, alpha BLEND) has its clear parts laid over dark glass first: the cab's inside is
     left out, so its windows are drawn solid, and JPEG keeps no alpha */
  const tmp = mkdtempSync(join(tmpdir(), 'a51-models-'));
  const texture = (ref, kind, mi) => {
    if (!ref) return null;
    const cut = kind === 'color' && (gltf.materials[mi] || {}).alphaMode === 'MASK';       // a cut-out (mesh, grille): kept as PNG with its alpha
    const im = gltf.images[gltf.textures[ref.index].source], bv = gltf.bufferViews[im.bufferView], raw = join(tmp, `${mi}-${kind}`), name = `${id}-${mi}-${kind}.${cut ? 'png' : 'jpg'}`;
    let data = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    if (kind === 'color' && !cfg.opaque && (gltf.materials[mi] || {}).alphaMode === 'BLEND' && data[0] === 0x89 && data[25] === 6 && data[24] === 8) data = overGlass(data, [10, 13, 16]);
    writeFileSync(raw, data);
    execFileSync('sips', ['-Z', String(cut ? Math.min(512, cfg.textures[kind]) : cfg.textures[kind]), '-s', 'format', cut ? 'png' : 'jpeg', ...(cut ? [] : ['-s', 'formatOptions', kind === 'color' ? '82' : '88']), raw, '--out', join(OUT, name)], { stdio: 'ignore' });
    return name;
  };
  // materials that sample the same pictures with the same numbers are one (unify); the untextured ones become one, their
  // colours carried by the vertices (flat): a model of 24 materials is drawn in 2
  const slotKey = mi => { const m = gltf.materials[mi] || {}, pbr = m.pbrMetallicRoughness || {};
    if (cfg.flat && !pbr.baseColorTexture) return 'flat';
    return cfg.unify ? JSON.stringify([pbr.baseColorTexture && pbr.baseColorTexture.index, pbr.metallicRoughnessTexture && pbr.metallicRoughnessTexture.index, m.normalTexture && m.normalTexture.index, pbr.baseColorFactor, pbr.roughnessFactor, pbr.metallicFactor, !!m.doubleSided, m.alphaMode]) : 'm' + mi; };
  const flatColour = mi => { const m = gltf.materials[mi] || {}, c = ((m.pbrMetallicRoughness || {}).baseColorFactor || [1, 1, 1, 1]); return m.alphaMode === 'BLEND' && !cfg.opaque ? [0.04, 0.05, 0.06] : c.slice(0, 3); };   // glass drawn dark and solid
  const usedMats = [...new Set(kept.map(t => t.mat))].sort((x, y) => x - y), slots = [], slotOf = new Map();
  for (const mi of usedMats) { const key = slotKey(mi); let sl = slots.findIndex(x => x.key === key); if (sl < 0) { sl = slots.length; slots.push({ key, mi }); } slotOf.set(mi, sl); }
  const materials = slots.map(({ key, mi }) => {
    if (key === 'flat') return { name: 'flat', color: [1, 1, 1], roughness: 0.55, metalness: 0.1, doubleSided: true, colors: true, map: null, orm: null, normal: null, ao: false };
    const m = gltf.materials[mi] || {}, pbr = m.pbrMetallicRoughness || {};
    return { name: m.name || 'material' + mi, color: (pbr.baseColorFactor || [1, 1, 1, 1]).slice(0, 3), roughness: pbr.roughnessFactor ?? 1, metalness: pbr.metallicFactor ?? 1, doubleSided: !!m.doubleSided,
      alphaTest: m.alphaMode === 'MASK' ? m.alphaCutoff ?? 0.5 : 0,
      map: texture(pbr.baseColorTexture, 'color', mi), orm: texture(pbr.metallicRoughnessTexture, 'orm', mi), normal: texture(m.normalTexture, 'normal', mi), ao: !!m.occlusionTexture };
  });
  rmSync(tmp, { recursive: true, force: true });

  /* ---- geometry: one part per material, its vertices welded where position, normal, uv (and colour) agree; a flat part
     carries a colour per vertex after its indices */
  const chunks = [], parts = []; let at = 0;
  const pad = b => { const r = b.length % 4; return r ? Buffer.concat([b, Buffer.alloc(4 - r)]) : b; };
  for (const [slot, sm] of materials.entries()) {
    const ts = kept.filter(t => slotOf.get(t.mat) === slot), keyOf = new Map(), P = [], N = [], U = [], I = [], K = [];
    for (const t of ts) { const col = sm.colors ? flatColour(t.mat) : null; for (let v = 0; v < 3; v++) {
      const p = t.p[v], n = t.n[v], uv = t.uv[v], key = p.map(x => Math.round(x * 2000)).join(',') + '|' + n.map(x => Math.round(x * 100)).join(',') + '|' + uv.map(x => Math.round(x * 8192)).join(',') + (col ? '|' + col.join(',') : '');
      let ix = keyOf.get(key); if (ix == null) { ix = P.length / 3; keyOf.set(key, ix); P.push(...p); N.push(...n); U.push(...uv); if (col) K.push(...col.map(c => Math.round(Math.max(0, Math.min(1, c)) * 255))); } I.push(ix);
    } }
    const vertices = P.length / 3, wide = vertices > 65535;
    const pos = pad(Buffer.from(new Float32Array(P).buffer)), nrm = pad(Buffer.from(new Int8Array(N.map(x => Math.round(Math.max(-1, Math.min(1, x)) * 127))).buffer));
    const uvb = pad(Buffer.from(new Float32Array(U).buffer)), idx = pad(Buffer.from((wide ? new Uint32Array(I) : new Uint16Array(I)).buffer));
    parts.push({ material: slot, at, vertices, indices: I.length, wide, colors: !!sm.colors });
    for (const b of [pos, nrm, uvb, idx, ...(sm.colors ? [pad(Buffer.from(new Uint8Array(K).buffer))] : [])]) { chunks.push(b); at += b.length; }
  }

  /* ---- collision: per column (30 cm), from the lowest surface to the highest (to 20 cm), the columns of one span merged */
  const C = cfg.cell || 0.3, Y = cfg.step || 0.2, cols = new Map(), [cl0, cl1] = cfg.clip || [[-1e9, -1e9, -1e9], [1e9, 1e9, 1e9]];
  const mark = q => { if (q.some((v, i) => v < cl0[i] || v > cl1[i])) return; const key = Math.floor(q[0] / C) + ',' + Math.floor(q[2] / C), e = cols.get(key); if (e) { e[0] = Math.min(e[0], q[1]); e[1] = Math.max(e[1], q[1]); } else cols.set(key, [q[1], q[1]]); };
  for (const t of cfg.noBoxes ? [] : kept) {         // noBoxes: a thing whose collision the map makes itself (a tree: its trunk)
    const [A, B, D] = t.p, L = Math.max(...[[A, B], [B, D], [D, A]].map(([u, v]) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]))), n = Math.max(1, Math.ceil(L / (C * 0.4)));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) { const u = i / n, v = j / n, w = 1 - u - v; mark([0, 1, 2].map(m => A[m] * w + B[m] * u + D[m] * v)); }
  }
  const spans = new Map();      // "y0,y1" -> Set of "ix,iz"
  for (const [key, [y0, y1]] of cols) { const s0 = Math.max(0, Math.floor(y0 / Y) * Y), s1 = Math.ceil(y1 / Y) * Y, sk = s0.toFixed(2) + ',' + Math.max(s1, s0 + Y).toFixed(2); if (!spans.has(sk)) spans.set(sk, new Set()); spans.get(sk).add(key); }
  const boxes = [];
  for (const [sk, set] of spans) {
    const [y0, y1] = sk.split(',').map(Number), cells = [...set].map(k => k.split(',').map(Number)).sort((p, q) => p[1] - q[1] || p[0] - q[0]), used = new Set();
    for (const [ix, iz] of cells) {
      if (used.has(ix + ',' + iz)) continue;
      let x1 = ix; while (set.has((x1 + 1) + ',' + iz) && !used.has((x1 + 1) + ',' + iz)) x1++;
      let z1 = iz; grow: for (;;) { for (let x = ix; x <= x1; x++) if (!set.has(x + ',' + (z1 + 1)) || used.has(x + ',' + (z1 + 1))) break grow; z1++; }
      for (let x = ix; x <= x1; x++) for (let z = iz; z <= z1; z++) used.add(x + ',' + z);
      boxes.push([ix * C, y0, iz * C, (x1 + 1) * C, y1, (z1 + 1) * C].map(v => +v.toFixed(3)));
    }
  }

  /* ---- the manifest */
  const ex = (gltf.asset && gltf.asset.extras) || {};
  const manifest = { id, size, tris: kept.length, materials, parts, boxes, credit: { title: ex.title || '', author: ex.author || '', license: ex.license || '', source: ex.source || '' } };
  writeFileSync(join(OUT, id + '.bin'), Buffer.concat(chunks));
  writeFileSync(join(OUT, id + '.json'), JSON.stringify(manifest));
  console.log(`${id}: ${kept.length} triangles, ${parts.length} part(s), ${(at / 1024).toFixed(0)} KB geometry, ${boxes.length} collision boxes, size ${size.join(' x ')} m; textures ${materials.map(m => [m.map, m.normal, m.orm].filter(Boolean).join(' ')).join(' | ')}`);
}

/* An 8-bit RGBA PNG laid over a flat colour: its alpha becomes how much of the picture shows. Returns an RGB PNG. */
function overGlass(png, under) {
  let at = 8, w = 0, h = 0; const idat = [];
  while (at < png.length) { const len = png.readUInt32BE(at), type = png.toString('latin1', at + 4, at + 8), body = png.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new Error('overGlass: only plain 8-bit RGBA PNGs'); }
    if (type === 'IDAT') idat.push(body); if (type === 'IEND') break; at += 12 + len; }
  const raw = inflateSync(Buffer.concat(idat)), bpp = 4, stride = w * bpp, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) { const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = px.subarray(y * stride, (y + 1) * stride), up = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) { const a = i >= bpp ? row[i - bpp] : 0, b = up ? up[i] : 0, c = up && i >= bpp ? up[i - bpp] : 0;
      const pr = () => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
      row[i] = (src[i] + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pr())) & 255; } }
  const out = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) { out[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const s = y * stride + x * 4, d = y * (w * 3 + 1) + 1 + x * 3, al = px[s + 3] / 255;
    for (let k = 0; k < 3; k++) out[d + k] = Math.round(px[s + k] * al + under[k] * (1 - al)); } }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, body) => { const l = Buffer.alloc(4); l.writeUInt32BE(body.length); const tb = Buffer.concat([Buffer.from(type, 'latin1'), body]), c = Buffer.alloc(4); c.writeUInt32BE(crc(tb)); return Buffer.concat([l, tb, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(out)), chunk('IEND', Buffer.alloc(0))]);
}
