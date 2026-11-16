// Turns a downloaded gun model (.glb) into what the game loads from web/guns/: one small binary of geometry, a manifest,
// and textures cut down to size. The game has no model loader and the source files are far too heavy to ship (the shotgun
// is 50 MB, almost all of it three 4096 px textures), so each gun is prepared once, here, and the results are committed.
//
//   node scripts/gun-assets.mjs shotgun ~/Downloads/shotgun.glb
//   node scripts/gun-assets.mjs sniper  ~/Downloads/sniper.glb
//   node scripts/gun-assets.mjs ammo    ~/Downloads/ammo_set.glb
//
// Needs macOS (`sips` resizes and re-encodes the textures). No other dependency.
//
// In the output every gun is in the same space: metres, the muzzle toward -Z, up +Y, the right-hand side +X, and the
// trigger at the origin. Parts that move or hide on their own (the shotgun's pump and stock, the rifle's bolt and magazine) are separate.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'guns');

/* What to take from each file. Coordinates here are the file's own.
     toGun     file point -> gun space
     keep      which triangles of the file belong to this gun (the sniper file holds two rifles, one above the other)
     parts     pieces that move: each is picked by the triangle count of its connected pieces and a box they must lie in
     points    places the game needs, in the file's coordinates
     textures  longest side, in pixels, of each kind of texture                                                         */
const GUNS = {
  shotgun: {
    // millimetres; muzzle +Z, up +Y, right -X; trigger at (0, 62, 80)
    toGun: ([x, y, z]) => [-x / 1000, (y - 62) / 1000, -(z - 80) / 1000],
    dirToGun: ([x, y, z]) => [-x, y, -z],
    keep: () => true,
    parts: {
      pump: [{ tris: 168, box: [[-25, 60, 370], [25, 125, 590]] }, { tris: 14, box: [[-12, 95, 260], [12, 115, 580]] }],   // the fore-end and its two action bars
      stock: [{ tris: 212, box: [[-25, -50, -305], [25, 135, 70]] }],                                                       // hidden when aiming: the eye is where it would be
    },
    points: { muzzle: [0, 124.7, 786], sight: [0, 147, 60], eject: [-19, 118, 205], port: [0, 72, 214], support: [0, 78, 480], grip: [0, 40, 20], butt: [0, 60, -300] },
    textures: { color: 2048, orm: 1024, normal: 1024 },
    drop: [],
  },
  sniper: {
    // metres; muzzle +X, up +Y, right +Z; the upper of the two rifles in the file (the one with the muzzle brake); trigger at (0.03, 0.335, 0)
    toGun: ([x, y, z]) => [z, y - 0.335, -(x - 0.03)],
    dirToGun: ([x, y, z]) => [z, y, -x],
    keep: c => c.min[1] > 0.2,
    parts: {
      bolt: [{ tris: 168, box: [[0.04, 0.37, 0.025], [0.075, 0.4, 0.06]] }, { tris: 92, box: [[0.045, 0.38, 0], [0.07, 0.43, 0.045]] }],   // the knob and its arm
      mag: [{ tris: 644, box: [[0.085, 0.3, -0.02], [0.2, 0.42, 0.02]] }, { tris: 280, box: [[0.085, 0.38, -0.02], [0.18, 0.42, 0.02]] }],
    },
    points: { muzzle: [0.943, 0.418, 0], sight: [-0.03, 0.4665, 0], eject: [0.11, 0.425, 0.02], port: [0.14, 0.31, 0], support: [0.36, 0.365, 0], grip: [-0.03, 0.3, 0], butt: [-0.337, 0.33, 0], boltAxis: [0.06, 0.4185, 0] },
    textures: { color: 1024, orm: 512, normal: 1024 },
    drop: ['Marker'],                                                                   // a label plane in the file, not part of the rifle
    glass: ['glass'],                                                                   // materials whose name has this in it are lens glass
  },
  // not a gun: the loose cartridges laid out at the ammo places on each map. fit: the set is centred, stood on y = 0 and
  // scaled until its longest side is this many metres (real cartridges are too small to see from where a player stands)
  ammo: { fit: 0.42, keep: () => true, parts: {}, points: {}, textures: { color: 512, orm: 256, normal: 512 }, drop: [] },
};

const [id, src] = process.argv.slice(2);
if (!GUNS[id] || !src) { console.error('usage: node scripts/gun-assets.mjs <shotgun|sniper|ammo> <file.glb>'); process.exit(1); }
const cfg = GUNS[id];

/* ---- read the .glb */
const buf = readFileSync(src), jsonLen = buf.readUInt32LE(12), gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const bin = buf.subarray(20 + jsonLen + 8, 20 + jsonLen + 8 + buf.readUInt32LE(20 + jsonLen));
const mul = (a, b) => a.map((_, i) => b[0].map((__, j) => a[i].reduce((s, v, k) => s + v * b[k][j], 0)));
const nodeMatrix = n => {
  if (n.matrix) return [0, 1, 2, 3].map(r => [0, 1, 2, 3].map(c => n.matrix[c * 4 + r]));
  const t = n.translation || [0, 0, 0], [x, y, z, w] = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
  const R = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
  return [...R.map((r, i) => [r[0] * s[0], r[1] * s[1], r[2] * s[2], t[i]]), [0, 0, 0, 1]];
};
const world = {};
(function walk(list, m) { for (const i of list) { world[i] = mul(m, nodeMatrix(gltf.nodes[i])); walk(gltf.nodes[i].children || [], world[i]); } })(gltf.scenes[gltf.scene || 0].nodes, [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]);
const read = ai => {
  const a = gltf.accessors[ai], bv = gltf.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const [size, get] = { 5126: [4, o => bin.readFloatLE(o)], 5125: [4, o => bin.readUInt32LE(o)], 5123: [2, o => bin.readUInt16LE(o)], 5121: [1, o => bin.readUInt8(o)] }[a.componentType];
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || size * n, out = [];
  for (let i = 0; i < a.count; i++) { const v = []; for (let k = 0; k < n; k++) v.push(get(off + i * stride + k * size)); out.push(v); }
  return out;
};

/* ---- every triangle, in the file's space, cut into connected pieces */
const pieces = [];           // { material, tris: [[a, b, c]], verts: [{ p, n, uv }], min, max }
for (const [ni, node] of gltf.nodes.entries()) {
  if (node.mesh == null) continue;
  const w = world[ni];
  for (const prim of gltf.meshes[node.mesh].primitives) {
    const mat = gltf.materials[prim.material];
    if ((cfg.drop || []).some(d => (mat.name || '').includes(d))) continue;
    const pos = read(prim.attributes.POSITION).map(([x, y, z]) => [0, 1, 2].map(r => w[r][0] * x + w[r][1] * y + w[r][2] * z + w[r][3]));
    const nrm = read(prim.attributes.NORMAL).map(([x, y, z]) => { const v = [0, 1, 2].map(r => w[r][0] * x + w[r][1] * y + w[r][2] * z), l = Math.hypot(...v) || 1; return v.map(c => c / l); });
    const uv = read(prim.attributes.TEXCOORD_0), idx = read(prim.indices).map(v => v[0]);
    // weld by position to find what is joined to what
    const span = Math.max(...[0, 1, 2].map(a => Math.max(...pos.map(p => p[a])) - Math.min(...pos.map(p => p[a])))), q = span * 1e-5, key = new Map(), vid = pos.map(p => { const k = p.map(c => Math.round(c / q)).join(','); if (!key.has(k)) key.set(k, key.size); return key.get(k); });
    const par = [...Array(key.size).keys()], find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    for (let t = 0; t < idx.length; t += 3) { const a = find(vid[idx[t]]); par[find(vid[idx[t + 1]])] = a; par[find(vid[idx[t + 2]])] = a; }
    const by = new Map();
    for (let t = 0; t < idx.length; t += 3) { const r = find(vid[idx[t]]); if (!by.has(r)) by.set(r, []); by.get(r).push([idx[t], idx[t + 1], idx[t + 2]]); }
    for (const tris of by.values()) {
      const used = [...new Set(tris.flat())], min = [0, 1, 2].map(a => Math.min(...used.map(i => pos[i][a]))), max = [0, 1, 2].map(a => Math.max(...used.map(i => pos[i][a])));
      pieces.push({ material: prim.material, tris, pos, nrm, uv, min, max });
    }
  }
}
const kept = pieces.filter(cfg.keep);
if (cfg.fit) {
  const lo = [0, 1, 2].map(a => Math.min(...kept.map(c => c.min[a]))), hi = [0, 1, 2].map(a => Math.max(...kept.map(c => c.max[a]))), k = cfg.fit / Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  cfg.toGun = ([x, y, z]) => [(x - (lo[0] + hi[0]) / 2) * k, (y - lo[1]) * k, (z - (lo[2] + hi[2]) / 2) * k];
  cfg.dirToGun = v => v;
}

/* ---- sort the pieces into parts */
const inBox = (c, [lo, hi]) => [0, 1, 2].every(a => c.min[a] >= lo[a] - 1e-6 && c.max[a] <= hi[a] + 1e-6);
const partOf = c => { for (const [name, rules] of Object.entries(cfg.parts)) if (rules.some(r => r.tris === c.tris.length && inBox(c, r.box))) return name; return 'body'; };
const groups = new Map();    // "part|material" -> pieces
for (const c of kept) { const k = partOf(c) + '|' + c.material; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
for (const name of Object.keys(cfg.parts)) if (![...groups.keys()].some(k => k.startsWith(name + '|'))) throw new Error(`${id}: no triangles matched the part "${name}"; the rules need another look`);

/* ---- textures: one colour, one occlusion/roughness/metal and one normal map per material, resized with sips */
mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'gun-assets-'));
const texture = (ref, kind, mi) => {
  if (!ref) return null;
  const im = gltf.images[gltf.textures[ref.index].source], bv = gltf.bufferViews[im.bufferView], png = join(tmp, `${mi}-${kind}.png`), name = `${id}-${mi}-${kind}.jpg`;
  writeFileSync(png, bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength));
  execFileSync('sips', ['-Z', String(cfg.textures[kind]), '-s', 'format', 'jpeg', '-s', 'formatOptions', kind === 'color' ? '82' : '88', png, '--out', join(OUT, name)], { stdio: 'ignore' });
  return name;
};
const usedMats = [...new Set(kept.map(c => c.material))].sort((a, b) => a - b);
const materials = usedMats.map(mi => {
  const m = gltf.materials[mi], pbr = m.pbrMetallicRoughness || {}, glass = (cfg.glass || []).some(g => (m.name || '').toLowerCase().includes(g));
  return { name: m.name || 'material' + mi, glass, color: (pbr.baseColorFactor || [1, 1, 1, 1]).slice(0, 3), roughness: pbr.roughnessFactor ?? 1, metalness: pbr.metallicFactor ?? 1,
    map: texture(pbr.baseColorTexture, 'color', mi), orm: texture(pbr.metallicRoughnessTexture, 'orm', mi), normal: texture(m.normalTexture, 'normal', mi), ao: !!m.occlusionTexture };
});
rmSync(tmp, { recursive: true, force: true });

/* ---- geometry: per part and material, re-indexed, in gun space */
const chunks = [], parts = [];
let at = 0;
const push = typed => { const b = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength), pad = (4 - (b.length % 4)) % 4; chunks.push(b, Buffer.alloc(pad)); at += b.length + pad; };
let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], triCount = 0;
for (const [k, list] of [...groups.entries()].sort()) {
  const [name, mi] = k.split('|'), P = [], N = [], U = [], I = [];
  for (const c of list) {
    const remap = new Map();
    for (const tri of c.tris) for (const i of tri) {
      if (!remap.has(i)) { remap.set(i, P.length / 3); const p = cfg.toGun(c.pos[i]), n = cfg.dirToGun(c.nrm[i]); P.push(...p); N.push(...n.map(v => Math.max(-127, Math.min(127, Math.round(v * 127))))); U.push(c.uv[i][0], c.uv[i][1]); for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); } }
      I.push(remap.get(i));
    }
  }
  // the turn from the file's axes to the gun's may mirror the model; if it does, flip every triangle so it still faces out
  const [a, b, c] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(cfg.dirToGun), det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  if (det < 0) for (let t = 0; t < I.length; t += 3) { const s = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = s; }
  const verts = P.length / 3, wide = verts > 65535, start = at;
  push(new Float32Array(P)); push(new Int8Array(N)); push(new Float32Array(U)); push(wide ? new Uint32Array(I) : new Uint16Array(I));
  parts.push({ name, material: usedMats.indexOf(+mi), vertices: verts, indices: I.length, wide, at: start });
  triCount += I.length / 3;
}
const r4 = v => +v.toFixed(4);
const manifest = {
  id, source: { ...(gltf.asset.extras || {}) }, bin: `${id}.bin`,
  size: lo.map((v, a) => r4(hi[a] - v)), min: lo.map(r4), max: hi.map(r4), triangles: triCount,
  points: Object.fromEntries(Object.entries(cfg.points).map(([k, p]) => [k, cfg.toGun(p).map(r4)])),
  materials, parts,
};
writeFileSync(join(OUT, `${id}.bin`), Buffer.concat(chunks));
writeFileSync(join(OUT, `${id}.json`), JSON.stringify(manifest, null, 1) + '\n');
console.log(`${id}: ${triCount} triangles in ${parts.length} parts (${parts.map(p => p.name + ':' + p.indices / 3).join(', ')}), ${materials.length} materials, ${(at / 1024).toFixed(0)} KB of geometry, size ${manifest.size.join(' x ')} m`);
