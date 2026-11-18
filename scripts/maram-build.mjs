// Prepares the Maram map from its model (web/maps/maram/maram.glb): the collision boxes, the walk mask the minimap
// reads, and the spawn points, all written to web/maps/maram/world.json. It also runs the walk-and-jump check: a robot
// that moves as the game moves a player (the same capsule, step, jump and gravity; the 42 cm step works in mid-air too,
// so a player reaches 1.69 m above what they stand on) and tries every way to walk and jump from every place it
// reaches, so nobody can stand anywhere the map does not mean them to.
//
//   node scripts/maram-build.mjs ~/Downloads/maram-thin.glb   take the model in (once), then build
//   node scripts/maram-build.mjs                              build again from the model already in web/maps/maram/
//
// Taking the model in copies it to web/maps/maram/maram.glb with one picture changed: a plaque of names carries the old
// map's title, and is replaced by a plain dark panel. (Its face lies against a wall, so it is not seen in the game.)
//
// The model is a Counter-Strike map, in Hammer units divided by 75. The game is built for Counter-Strike proportions
// at 1 unit = 2.5 cm: the 72-unit player is the game's 1.8 m capsule, a 64-unit crate is 1.6 m, and a running jump
// (1.27 m, then the 42 cm step) lands on a crate as a crouch-jump does there. So the model is scaled by 75 x 0.025 = 1.875 and turned a quarter
// round, which puts the attackers' start in the west (x < 0, Red in Team deathmatch) and the defenders' in the east
// (x > 0, Blue).
//
// The collision follows the drawn surfaces, as boxes along the axes (the only shape the game collides with):
//   - every triangle is cut into 25 cm columns and each piece becomes the box around it, so a wall is a thin box on
//     its plane, a floor a thin slab at its height, a ramp a staircase of steps lower than the 42 cm step-up
//   - boxes that line up are merged, so straight walls and level floors become a few long boxes
//   - the model's walls are single sheets with nothing behind them. Every column with no floor in it is filled solid
//     for players (not for shots) up to TOP, so the space behind the walls cannot be entered or stood on
//   - every drawn triangle collides for players and shots alike
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'maps', 'maram');
const GLB = join(DIR, 'maram.glb'), OUT = join(DIR, 'world.json');

const S = 1.875;            // model metres -> game metres
const CELL = 0.25;          // collision columns
const PAD = 0.02;           // boxes reach this far past the surface they stand for
const THIN = 0.04;          // half the thickness of a wall box
const TOP = 17.5;           // the solid behind the walls goes up to here (the highest floor is 13.7 m; the model ends at 15.2 m)
const MARGIN = 3;           // and this far past the model all round
const SURF = ['concrete', 'wood', 'metal', 'glass', 'dirt'];
const WOOD = [2, 7, 9, 10, 11, 12, 15, 17, 23, 26, 28, 29, 30], METAL = [20, 21, 31, 32], GLASS = [33], SAND = [6, 22];
const surfaceOf = name => { const n = +String(name).replace(/\D/g, ''); return WOOD.includes(n) ? 1 : METAL.includes(n) ? 2 : GLASS.includes(n) ? 3 : SAND.includes(n) ? 4 : 0; };
const PLAQUE = 'material_19';
// pieces of the model left out, drawn and solid alike (game space, metres): a plain box floating outside the east wall
const HIDE = [[54.9, 4.5, -5.1, 61.9, 8.3, -1.3]];
const hidden = v => HIDE.some(h => v.every(p => p[0] >= h[0] && p[0] <= h[3] && p[1] >= h[1] && p[1] <= h[4] && p[2] >= h[2] && p[2] <= h[5]));

/* ------------------------------------------------------------------ the model file */
function readGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB file');
  const jl = buf.readUInt32LE(12), json = JSON.parse(buf.slice(20, 20 + jl).toString()), bl = buf.readUInt32LE(20 + jl), bin = buf.slice(28 + jl, 28 + jl + bl);
  return { json, bin };
}
function writeGlb(json, bin) {
  const pad = (b, fill) => { const n = (4 - (b.length % 4)) % 4; return n ? Buffer.concat([b, Buffer.alloc(n, fill)]) : b; };
  const j = pad(Buffer.from(JSON.stringify(json)), 0x20), b = pad(bin, 0);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8);
  const ch = (len, type) => { const c = Buffer.alloc(8); c.writeUInt32LE(len, 0); c.writeUInt32LE(type, 4); return c; };
  return Buffer.concat([head, ch(j.length, 0x4e4f534a), j, ch(b.length, 0x004e4942), b]);
}
// a plain PNG, grey, from a function of the pixel
function png(w, h, f) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = f(x, y);
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const v of b) c = table[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4), c = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type), data]); l.writeUInt32BE(data.length); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// copy the model in, with the plaque's picture swapped for a dark panel (every buffer view is laid out again)
function takeIn(src) {
  const { json, bin } = readGlb(readFileSync(src));
  const mat = json.materials.find(m => m.name === PLAQUE);
  if (!mat) throw new Error('the plaque material was not found');
  const image = json.textures[mat.pbrMetallicRoughness.baseColorTexture.index].source, view = json.images[image].bufferView;
  const panel = png(256, 256, (x, y) => (Math.min(x, y, 255 - x, 255 - y) < 6 ? 120 : 26 + ((x * 7 + y * 13) % 5)));
  const parts = []; let at = 0;
  json.bufferViews.forEach((bv, i) => {
    const data = i === view ? panel : bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    const gap = (4 - (at % 4)) % 4; if (gap) { parts.push(Buffer.alloc(gap)); at += gap; }
    bv.byteOffset = at; bv.byteLength = data.length; parts.push(data); at += data.length;
  });
  const out = Buffer.concat(parts); json.buffers[0].byteLength = out.length;
  mkdirSync(DIR, { recursive: true }); writeFileSync(GLB, writeGlb(json, out));
  console.log(`model taken in: ${GLB} (${(out.length / 1048576).toFixed(2)} MB, plaque replaced)`);
}

/* ------------------------------------------------------------------ triangles, in game space */
function triangles(json, bin) {
  const N = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array }, C = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const acc = i => { const a = json.accessors[i], bv = json.bufferViews[a.bufferView], T = N[a.componentType], n = C[a.type], off = (bv.byteOffset || 0) + (a.byteOffset || 0);
    return new T(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + a.count * n * T.BYTES_PER_ELEMENT)); };
  const mul = (A, B) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += A[k * 4 + r] * B[c * 4 + k]; return o; };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], raw = [];
  const walk = (ni, M) => { const n = json.nodes[ni]; M = mul(M, n.matrix || I);
    if (n.mesh != null) for (const p of json.meshes[n.mesh].primitives) {
      const pos = acc(p.attributes.POSITION), idx = p.indices != null ? acc(p.indices) : null, cnt = pos.length / 3, w = new Float64Array(cnt * 3);
      for (let i = 0; i < cnt; i++) for (let r = 0; r < 3; r++) w[i * 3 + r] = M[r] * pos[i * 3] + M[4 + r] * pos[i * 3 + 1] + M[8 + r] * pos[i * 3 + 2] + M[12 + r];
      raw.push({ w, idx: idx || Uint32Array.from({ length: cnt }, (_, i) => i), surface: surfaceOf(json.materials[p.material].name) });
    }
    for (const c of n.children || []) walk(c, M); };
  for (const r of json.scenes[json.scene || 0].nodes) walk(r, I);
  // the model's own corner is far from its origin: centre it, floor at 0, scale, and turn it so its length runs along x
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of raw) for (let i = 0; i < p.w.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p.w[i + k]); mx[k] = Math.max(mx[k], p.w[i + k]); }
  const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2, y0 = mn[1];
  // game = R * (model - centre) * S, as a matrix (rows x, y, z) for the page to put on the model
  const transform = [0, 0, -S, S * cz, 0, S, 0, -S * y0, S, 0, 0, -S * cx, 0, 0, 0, 1];
  const tf = (x, y, z) => [-(z - cz) * S, (y - y0) * S, (x - cx) * S];
  const tris = [];
  for (const p of raw) for (let t = 0; t < p.idx.length; t += 3) {
    const v = [0, 1, 2].map(k => { const i = p.idx[t + k]; return tf(p.w[i * 3], p.w[i * 3 + 1], p.w[i * 3 + 2]); });
    if (!hidden(v)) tris.push({ v, surface: p.surface });
  }
  return { tris, transform };
}

/* ------------------------------------------------------------------ boxes from columns */
// cut a polygon (points [x, y, z]) to x in [a, b] and z in [c, d]
function clip(poly, a, b, c, d) {
  const cut = (pts, k, v, keepAbove) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length], pin = keepAbove ? p[k] >= v : p[k] <= v, qin = keepAbove ? q[k] >= v : q[k] <= v;
      if (pin) out.push(p);
      if (pin !== qin) { const t = (v - p[k]) / (q[k] - p[k]); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]); }
    }
    return out;
  };
  let p = poly;
  p = cut(p, 0, a, true); if (!p.length) return p; p = cut(p, 0, b, false); if (!p.length) return p;
  p = cut(p, 2, c, true); if (!p.length) return p; return cut(p, 2, d, false);
}
const cm = v => Math.round(v * 100);

function buildBoxes(tris, grid) {
  const { x0: GX, z0: GZ, w: GW, h: GH } = grid;
  const floorArea = new Float32Array(GW * GH);          // how much of each column has something to stand on
  const items = [];                                    // [x0, y0, z0, x1, y1, z1, surface, kind] in cm; kind 0 floor, 1 wall
  for (const { v, surface } of tris) {
    const [a, b, c] = v, e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-9) continue;
    const ny = Math.abs(n[1]) / len, kind = ny >= 0.7 ? 0 : 1, flat = ny >= 0.985;      // as in Counter-Strike, nothing steeper than 45.6 degrees is a floor
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - GX) / CELL)), i1 = Math.min(GW - 1, Math.floor((Math.max(a[0], b[0], c[0]) - GX) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(a[2], b[2], c[2]) - GZ) / CELL)), j1 = Math.min(GH - 1, Math.floor((Math.max(a[2], b[2], c[2]) - GZ) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const xa = GX + i * CELL, za = GZ + j * CELL, p = clip(v, xa, xa + CELL, za, za + CELL);
      if (p.length < 2) continue;
      let px0 = Infinity, px1 = -Infinity, py0 = Infinity, py1 = -Infinity, pz0 = Infinity, pz1 = -Infinity, area = 0;
      for (let k = 0; k < p.length; k++) { const q = p[k], r = p[(k + 1) % p.length]; px0 = Math.min(px0, q[0]); px1 = Math.max(px1, q[0]); py0 = Math.min(py0, q[1]); py1 = Math.max(py1, q[1]); pz0 = Math.min(pz0, q[2]); pz1 = Math.max(pz1, q[2]); area += q[0] * r[2] - r[0] * q[2]; }
      area = Math.abs(area) / 2;
      if (kind === 0) { if (area < 1e-4) continue; floorArea[j * GW + i] += area; }
      // a wall is a thin box on its plane; a ramp's step stands at the height of its middle; a floor is a thin slab
      if (kind === 1) { const mxp = (px0 + px1) / 2, mzp = (pz0 + pz1) / 2; px0 = Math.min(px0, mxp - THIN); px1 = Math.max(px1, mxp + THIN); pz0 = Math.min(pz0, mzp - THIN); pz1 = Math.max(pz1, mzp + THIN); }
      else if (!flat) py1 = (py0 + py1) / 2;
      px0 = Math.max(px0, xa - THIN); px1 = Math.min(px1, xa + CELL + THIN); pz0 = Math.max(pz0, za - THIN); pz1 = Math.min(pz1, za + CELL + THIN);
      items.push([Math.floor(px0 * 100), Math.floor((py0 - PAD) * 100), Math.floor(pz0 * 100), Math.ceil(px1 * 100), Math.ceil((py1 + PAD) * 100), Math.ceil(pz1 * 100), surface, kind]);
    }
  }
  solidGround(items);
  const caps = capWalls(items);
  groundWalls(items);
  return { items: mergeBoxes([...items, ...caps]), floorArea, caps: caps.length };
}

/* Counter-Strike keeps players off wall tops with invisible brushes the model does not have. Here the top of a wall
   that is no floor's edge, and stands 1.3 m or more above the floor beside it (out of a jump's reach from there), is
   carried on up to TOP for players only. So no wall top can be reached from a crate, a ledge or another wall, while
   low walls, sills and the edges of raised floors stay as they are. Shots are not stopped by these. */
function capWalls(items) {
  const col = (x, z) => Math.floor(x / 25) + ',' + Math.floor(z / 25), floors = new Map(), walls = new Map(), caps = [];
  for (const b of items) { const k = col((b[0] + b[3]) / 2, (b[2] + b[5]) / 2), m = b[7] === 0 ? floors : walls; (m.get(k) || m.set(k, []).get(k)).push(b); }
  const around = (k, r) => { const [i, j] = k.split(',').map(Number), out = []; for (let a = -r; a <= r; a++) for (let c = -r; c <= r; c++) for (const f of floors.get((i + a) + ',' + (j + c)) || []) out.push(f); return out; };
  for (const [k, list] of walls) {
    list.sort((p, q) => p[1] - q[1]);
    const near1 = around(k, 1), near2 = around(k, 2);
    for (let i = 0; i < list.length;) {
      let lo = list[i][1], hi = list[i][4], x0 = list[i][0], z0 = list[i][2], x1 = list[i][3], z1 = list[i][5], j = i + 1;
      while (j < list.length && list[j][1] <= hi + 2) { hi = Math.max(hi, list[j][4]); x0 = Math.min(x0, list[j][0]); z0 = Math.min(z0, list[j][2]); x1 = Math.max(x1, list[j][3]); z1 = Math.max(z1, list[j][5]); j++; }
      i = j;
      if (near1.some(f => Math.abs(f[4] - hi) <= 10)) continue;                    // the edge of a floor, a crate, a step or a sill
      let below = -Infinity; for (const f of near2) if (f[4] < hi - 5) below = Math.max(below, f[4]);
      if (hi - below >= 130) caps.push([x0, hi, z0, x1, TOP * 100, z1, 0, 3]);
    }
  }
  return caps;
}

/* The model's floors are sheets too, with nothing under them, and the game's own ground (y = 0) runs underneath. In
   each column a piece of floor with no other floor under it is the ground there, so it is made solid down to below
   the game's ground; a floor over another floor (a roof over a tunnel, a bridge) stays a slab with room under it. */
function solidGround(items) {
  const cols = new Map();
  for (const b of items) if (b[7] === 0) { const k = Math.floor((b[0] + b[3]) / 50) + ',' + Math.floor((b[2] + b[5]) / 50); (cols.get(k) || cols.set(k, []).get(k)).push(b); }
  for (const list of cols.values()) {
    list.sort((p, q) => p[1] - q[1]);
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i]; let under = false;
      for (let j = 0; j < i && !under; j++) { const o = list[j]; if (o[4] < b[1] + 5 && o[0] < b[3] && o[3] > b[0] && o[2] < b[5] && o[5] > b[2]) under = true; }
      if (!under) b[1] = -100;
    }
  }
}

/* A wall standing on a floor or a ramp has a foot that follows the floor, so no two of its columns are alike and none
   merge. Its foot goes down to the next 25 cm instead: that part is under the floor, where nobody can be. A wall whose
   foot is in the air (over a doorway, under a roof) keeps its exact foot, so no opening gets lower. */
function groundWalls(items) {
  const floors = new Map(), col = (x, z) => Math.floor(x / 25) + ',' + Math.floor(z / 25);
  for (const b of items) if (b[7] === 0) for (const x of [b[0], b[3] - 1]) for (const z of [b[2], b[5] - 1]) { const k = col(x, z); (floors.get(k) || floors.set(k, []).get(k)).push(b); }
  let n = 0;
  for (const b of items) {
    if (b[7] !== 1) continue;
    const foot = b[1] + PAD * 100, near = new Set();
    for (const x of [b[0] - 13, (b[0] + b[3]) / 2, b[3] + 13]) for (const z of [b[2] - 13, (b[2] + b[5]) / 2, b[5] + 13]) for (const f of floors.get(col(x, z)) || []) near.add(f);
    let grounded = false;
    for (const f of near) if (f[1] - 6 <= foot && f[4] + 6 >= foot) { grounded = true; break; }
    if (grounded) { b[1] = Math.floor((foot - 1) / 25) * 25; n++; }
  }
  return n;
}

// merge boxes that share a face exactly (same kind and surface), along each axis in turn, until nothing changes
function mergeBoxes(list) {
  const key = (b, skip) => [0, 1, 2, 3, 4, 5].filter(k => k !== skip && k !== skip + 3).map(k => b[k]).join(',') + ',' + b[6] + ',' + b[7];
  let boxes = [...new Map(list.map(b => [b.join(','), b])).values()], before = Infinity;
  // boxes inside another box of the same kind and surface are dropped first (two triangles of one quad in one column)
  const absorb = arr => {
    const out = [], byCol = new Map();
    for (const b of arr) { const k = Math.floor(b[0] / 25) + ',' + Math.floor(b[2] / 25); (byCol.get(k) || byCol.set(k, []).get(k)).push(b); }
    for (const group of byCol.values()) {
      group.sort((p, q) => (q[3] - q[0]) * (q[4] - q[1]) * (q[5] - q[2]) - (p[3] - p[0]) * (p[4] - p[1]) * (p[5] - p[2]));
      const kept = [];
      for (const b of group) {
        let inside = false;
        for (const k of kept) if (k[6] === b[6] && k[7] === b[7] && b[0] >= k[0] && b[1] >= k[1] && b[2] >= k[2] && b[3] <= k[3] && b[4] <= k[4] && b[5] <= k[5]) { inside = true; break; }
        if (!inside) kept.push(b);
      }
      out.push(...kept);
    }
    return out;
  };
  // in one column, two pieces of the same wall or floor with the same footprint and touching or overlapping heights become one
  const stack = arr => {
    const groups = new Map();
    for (const b of arr) { const k = [b[0], b[2], b[3], b[5], b[6], b[7]].join(','); (groups.get(k) || groups.set(k, []).get(k)).push(b); }
    const out = [];
    for (const g of groups.values()) { g.sort((p, q) => p[1] - q[1]); let cur = g[0].slice(); for (let i = 1; i < g.length; i++) { const b = g[i]; if (b[1] <= cur[4] + 2) cur[4] = Math.max(cur[4], b[4]); else { out.push(cur); cur = b.slice(); } } out.push(cur); }
    return out;
  };
  boxes = absorb(stack(boxes));
  while (boxes.length < before) {
    before = boxes.length;
    for (const ax of [2, 0, 1]) {
      const groups = new Map();
      for (const b of boxes) { const k = key(b, ax); (groups.get(k) || groups.set(k, []).get(k)).push(b); }
      const out = [];
      for (const g of groups.values()) {
        g.sort((p, q) => p[ax] - q[ax]);
        let cur = g[0].slice();
        for (let i = 1; i < g.length; i++) { const b = g[i]; if (b[ax] <= cur[ax + 3]) cur[ax + 3] = Math.max(cur[ax + 3], b[ax + 3]); else { out.push(cur); cur = b.slice(); } }
        out.push(cur);
      }
      boxes = out;
    }
  }
  return boxes;
}

// columns with nothing to stand on, filled solid for players: rows of columns, then rows merged where they line up
function voidFill(floorArea, grid) {
  const { x0: GX, z0: GZ, w: GW, h: GH } = grid, empty = new Uint8Array(GW * GH);
  for (let k = 0; k < GW * GH; k++) empty[k] = floorArea[k] < 0.002 ? 1 : 0;
  const runs = [];
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW;) { if (!empty[j * GW + i]) { i++; continue; } let e = i; while (e < GW && empty[j * GW + e]) e++; runs.push([i, j, e]); i = e; }
  const open = new Map(), boxes = [];
  for (const [i, j, e] of runs) { const k = i + ',' + e, o = open.get(k); if (o && o.j1 === j) o.j1 = j + 1; else { if (o) boxes.push(o); open.set(k, { i, e, j0: j, j1: j + 1 }); } }
  for (const o of open.values()) boxes.push(o);
  return { empty, boxes: boxes.map(o => [cm(GX + o.i * CELL), -100, cm(GZ + o.j0 * CELL), cm(GX + o.e * CELL), cm(TOP), cm(GZ + o.j1 * CELL), 0, 2]) };
}

/* ------------------------------------------------------------------ the robot: the game's own movement, run in a box world */
const STEP = 0.42, AIR_STEP = 0.08, RADIUS = 0.32, STAND = 1.8, CROUCH = 1.15, G = 21, JUMP = Math.sqrt(2 * G * 1.27), DT = 1 / 60;
function world(boxes, bounds) {
  // boxes: [x0, y0, z0, x1, y1, z1, surface, kind] in cm -> metres, filed in 50 cm squares
  const B = boxes.map(b => ({ x0: b[0] / 100, y0: b[1] / 100, z0: b[2] / 100, x1: b[3] / 100, y1: b[4] / 100, z1: b[5] / 100, kind: b[7] }));
  const GC = 0.5, gx = bounds.x0 - 4, gz = bounds.z0 - 4, gw = Math.ceil((bounds.x1 - bounds.x0 + 8) / GC), gh = Math.ceil((bounds.z1 - bounds.z0 + 8) / GC), cells = Array.from({ length: gw * gh }, () => []);
  B.forEach((b, n) => { for (let j = Math.max(0, Math.floor((b.z0 - gz) / GC)); j <= Math.min(gh - 1, Math.floor((b.z1 - gz) / GC)); j++) for (let i = Math.max(0, Math.floor((b.x0 - gx) / GC)); i <= Math.min(gw - 1, Math.floor((b.x1 - gx) / GC)); i++) cells[j * gw + i].push(n); });
  const stamp = new Int32Array(B.length); let sid = 0; const near = [];
  function around(x, z, r) {
    sid++; near.length = 0;
    for (let j = Math.max(0, Math.floor((z - r - gz) / GC)); j <= Math.min(gh - 1, Math.floor((z + r - gz) / GC)); j++) for (let i = Math.max(0, Math.floor((x - r - gx) / GC)); i <= Math.min(gw - 1, Math.floor((x + r - gx) / GC)); i++) for (const n of cells[j * gw + i]) if (stamp[n] !== sid) { stamp[n] = sid; near.push(B[n]); }
    return near;
  }
  // the game's moveCapsule, line for line (web/index.html), with its box list cut down to the boxes nearby
  function move(pos, vel, dt, h, step) {
    const res = { onGround: false, ground: null };
    const dx = vel.x * dt, dz = vel.z * dt, U = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (RADIUS * 0.6))), k = pos.y, list = around(pos.x + dx / 2, pos.z + dz / 2, Math.hypot(dx, dz) / 2 + RADIUS + 0.1).slice();
    for (let q = 0; q < U; q++) {
      pos.x += dx / U; pos.z += dz / U;
      for (let it = 0; it < 3; it++) {
        let hit = false;
        for (const b of list) {
          if (b.y1 <= pos.y + (step ? STEP : AIR_STEP) || b.y0 >= pos.y + h) continue;
          const cx = Math.max(b.x0, Math.min(b.x1, pos.x)), cz = Math.max(b.z0, Math.min(b.z1, pos.z)); let ex = pos.x - cx, ez = pos.z - cz; const d2 = ex * ex + ez * ez;
          if (d2 >= RADIUS * RADIUS) continue;
          if (d2 > 1e-10) { const d = Math.sqrt(d2), pen = RADIUS - d; ex /= d; ez /= d; pos.x += ex * pen; pos.z += ez * pen; const vn = vel.x * ex + vel.z * ez; if (vn < 0) { vel.x -= ex * vn; vel.z -= ez * vn; } }
          else { const o1 = pos.x - b.x0, o2 = b.x1 - pos.x, o3 = pos.z - b.z0, o4 = b.z1 - pos.z, m = Math.min(o1, o2, o3, o4);
            if (m === o1) { pos.x = b.x0 - RADIUS; if (vel.x > 0) vel.x = 0; } else if (m === o2) { pos.x = b.x1 + RADIUS; if (vel.x < 0) vel.x = 0; } else if (m === o3) { pos.z = b.z0 - RADIUS; if (vel.z > 0) vel.z = 0; } else { pos.z = b.z1 + RADIUS; if (vel.z < 0) vel.z = 0; } }
          hit = true;
        }
        if (!hit) break;
      }
    }
    const C = pos.y + vel.y * dt, A = RADIUS * 0.7, Z = k + (step ? STEP : AIR_STEP) + 1e-4; let F = 0, N = Infinity, gb = null;
    for (const b of list) {
      if (pos.x + A < b.x0 || pos.x - A > b.x1 || pos.z + A < b.z0 || pos.z - A > b.z1) continue;
      if (b.y1 <= Z && b.y1 > F) { F = b.y1; gb = b; }
      if (b.y0 >= k + h - 0.05 && b.y0 < N) N = b.y0;
    }
    if (vel.y > 0 && C + h > N) { pos.y = N - h; vel.y = 0; }
    else if (C <= F) { pos.y = F; if (vel.y < 0) vel.y = 0; res.onGround = true; }
    else if (step && vel.y <= 0 && C - F < STEP) { pos.y = F; vel.y = 0; res.onGround = true; }
    else pos.y = C;
    pos.x = Math.min(bounds.x1 - 0.4, Math.max(bounds.x0 + 0.4, pos.x)); pos.z = Math.min(bounds.z1 - 0.4, Math.max(bounds.z0 + 0.4, pos.z));
    if (res.onGround) res.ground = gb;
    return res;
  }
  // can a standing player fit here (the game's own test before it lets a crouching player stand)?
  function canStand(x, z, y) {
    const r = RADIUS * 0.9;
    for (const b of around(x, z, r + 0.1)) if (!(x + r < b.x0 || x - r > b.x1 || z + r < b.z0 || z - r > b.z1) && b.y0 < y + STAND && b.y1 > y + CROUCH - 0.05) return false;
    return true;
  }
  // one frame of the player: gravity in two halves around the move, as the game does it
  function frame(p, h) {
    p.vel.y -= G * (p.vel.y < 0 ? 1.22 : 1) * DT * 0.5; if (p.vel.y < -40) p.vel.y = -40;
    const r = move(p.pos, p.vel, DT, h, p.onGround);
    if (!r.onGround) p.vel.y -= G * (p.vel.y < 0 ? 1.22 : 1) * DT * 0.5;
    p.onGround = r.onGround; p.ground = r.ground;
    return r;
  }
  return { B, around, move, frame, canStand };
}

function robot(W, starts, bounds) {
  const Q = 0.25, key = (x, z, y, c) => Math.round(x / Q) + ',' + Math.round(z / Q) + ',' + Math.round(y * 20) + ',' + c;
  const seen = new Map(), queue = [];
  let from = null; const squeezed = [];
  // a place where the player's middle is inside a box is a squeeze the game's push-out failed at; the map puts such a
  // player back where they last stood (maram.js), so the robot notes it and goes no further from there
  const inBox = (x, z, y) => W.around(x, z, 0.01).some(b => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && y + 0.5 > b.y0 && y + 0.5 < b.y1);
  const add = (x, z, y, c, ground) => { const k = key(x, z, y, c); if (seen.has(k)) return; if (inBox(x, z, y)) { squeezed.push({ x, y, z, from }); seen.set(k, null); return; } const s = { x, z, y, c, ground, from }; seen.set(k, s); queue.push(s); };      // the place itself, as the game left it; the 25 cm grid only says what was seen
  for (const s of starts) add(s[0], s[2], s[1], 0, null);
  const dirs = Array.from({ length: 16 }, (_, i) => [Math.cos(i * Math.PI / 8), Math.sin(i * Math.PI / 8)]);
  const settle = (p, h) => { for (let f = 0; f < 240; f++) { const r = W.frame(p, h); if (r.onGround && f > 0) return true; } return false; };
  // jumping only matters near something to land on, or near a drop
  const worthJumping = s => { for (const b of W.around(s.x, s.z, 4.5)) { if (b.y1 > s.y + 0.08 && b.y1 <= s.y + 1.75) return true; if (b.y1 < s.y - 0.3 && b.kind !== 2) return true; } return false; };
  let sims = 0;
  while (queue.length) {
    const s = queue.pop(), h = s.c ? CROUCH : STAND, jump = !s.c && worthJumping(s); from = s;
    // walking: a short run each way, then stop and come to rest
    for (let d = 0; d < 16; d += s.c ? 2 : 1) {
      const [dx, dz] = dirs[d], p = { pos: { x: s.x, y: s.y, z: s.z }, vel: { x: 0, y: 0, z: 0 }, onGround: true }, sp = s.c ? 1.9 : 6.4;
      W.frame(p, h);
      for (let f = 0; f < (s.c ? 16 : 6); f++) { p.vel.x = dx * sp; p.vel.z = dz * sp; W.frame(p, h); }
      p.vel.x = p.vel.z = 0; if (!p.onGround && !settle(p, h)) continue; sims++;
      add(p.pos.x, p.pos.z, p.pos.y, s.c, p.ground);
    }
    // crouch where standing is possible, stand where there is room
    if (!s.c) add(s.x, s.z, s.y, 1, s.ground); else if (W.canStand(s.x, s.z, s.y)) add(s.x, s.z, s.y, 0, s.ground);
    if (!jump) continue;
    for (const [dx, dz] of dirs) for (const sp of [6.4, 3.8, 1.6]) {
      const p = { pos: { x: s.x, y: s.y, z: s.z }, vel: { x: dx * sp, y: JUMP, z: dz * sp }, onGround: true };
      for (let f = 0; f < 240; f++) {
        p.vel.x = dx * sp; p.vel.z = dz * sp;
        p.vel.y -= G * (p.vel.y < 0 ? 1.22 : 1) * DT * 0.5;
        // the 42 cm step works in the air as well: in the game a running jump lands on a 1.6 m crate
        const r = W.move(p.pos, p.vel, DT, STAND, true);
        if (!r.onGround) p.vel.y -= G * (p.vel.y < 0 ? 1.22 : 1) * DT * 0.5;
        if (r.onGround && f > 0 && p.vel.y <= 0.001) { p.ground = r.ground; break; }
      }
      p.vel.x = p.vel.z = 0; p.onGround = true; settle(p, STAND); sims++;
      add(p.pos.x, p.pos.z, p.pos.y, 0, p.ground);
    }
  }
  return { states: [...seen.values()].filter(Boolean), sims, squeezed };
}

/* ------------------------------------------------------------------ spawns
   [x, y, z, yaw] on open floor. The game puts Red's Team deathmatch spawns west of x = -6 and
   Blue's east of x = 13, so the attackers' start is Red's and the defenders' start is Blue's; the rest are for
   Deathmatch. Each is checked below: it must stand on the model's floor, inside a level, clear square 1.5 m across (the
   game shuffles a spawn by up to 80 cm), and the yaw looks down the longest open line from it. */
const SPAWNS = [
  // Red: the attackers' start
  [-42.5, 8.03, -32, -1.57], [-48, 8.03, -15, 0], [-48, 8.03, -47, -3.14], [-30, 4.83, -41.5, -1.96], [-39.5, 8.03, -21.5, -0.79], [-33, 8.03, -29, 0.79], [-49, 8.03, -25, -3.14],
  // Blue: the defenders' start
  [26, 1.63, 6, 0], [28.5, 4.83, -22, 0.39], [24.5, 1.63, -8.5, -3.14], [18, 1.63, -0.5, -0.79], [28, 1.63, -1.5, 1.57], [22.5, 1.63, -3.5, -2.75],
  // Deathmatch: the middle, the tunnels, the long road, both sites
  [-12, 4.83, -3.5, -1.96], [5.5, 2.03, -7, -0.39], [-35.5, 4.83, 22, -1.18], [-18, 4.83, 14.5, 1.57], [11, 4.83, 45, 1.18], [39.5, 7.23, 38, 0.39], [-16, 6.43, 50.5, -0.39],
  [34, 7.23, 22, 2.75], [26, 4.83, 45, 1.57], [48, 5.63, -43.5, 2.36], [12, 5.63, -41.5, -1.57], [1, 4.83, 25.5, 1.57], [-14.5, 4.83, 33.5, -2.36],
];

/* The two ammo piles (web/guns.js) stand on crates, one on each side; each must be the top of something, with
   nothing over it, and a floor beside it within reach (a pile is taken from within 2.2 m below it). */
const AMMO = [[-32.17, 6.43, -4.03], [23.73, 6.03, -21.4]];
function checkAmmo(W) {
  const top = (x, z, maxY) => { let w = 0; for (const b of W.around(x, z, 0.01)) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && b.y1 <= maxY && b.y1 > w) w = b.y1; return w; };
  return AMMO.filter(([x, y, z]) => Math.abs(top(x, z, y + 0.05) - y) > 0.02 || top(x, z, y + 2.2) > y + 0.02 || ![0, 1, 2, 3].some(k => { const f = top(x + Math.cos(k * Math.PI / 2) * 1.5, z + Math.sin(k * Math.PI / 2) * 1.5, y - 0.4); return y - f > 0.4 && y - f < 2.1; }));
}

/* The camera's flight before a match: down the long road and over the near site. Each leg is checked to keep 30 cm
   clear of every box. */
const CINEMATIC = [
  { pos: [-12, 6.8, 45], look: [10, 6, 45] }, { pos: [10, 7.2, 46], look: [30, 7, 44] }, { pos: [30, 7.6, 45], look: [40, 9, 35] },
  { pos: [40, 9.4, 38], look: [35, 9, 25] }, { pos: [36, 9.4, 26], look: [24, 6, 10] },
];
function checkPath(W, path) {
  const bad = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i].pos, b = path[i + 1].pos, n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.2);
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
      const hit = W.around(x, z, 0.3).find(q => x > q.x0 - 0.3 && x < q.x1 + 0.3 && z > q.z0 - 0.3 && z < q.z1 + 0.3 && y > q.y0 - 0.3 && y < q.y1 + 0.3);
      if (hit) { bad.push(`leg ${i}: ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)} meets a box [${hit.x0}, ${hit.y0}, ${hit.z0}]-[${hit.x1}, ${hit.y1}, ${hit.z1}]`); break; }
    }
  }
  return bad;
}

/* ------------------------------------------------------------------ main */
export function build() {
  const { json, bin } = readGlb(readFileSync(GLB));
  const t0 = Date.now();
  const { tris, transform } = triangles(json, bin);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = -Infinity;
  for (const { v } of tris) for (const p of v) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); y1 = Math.max(y1, p[1]); }
  const grid = { x0: Math.floor((x0 - MARGIN) / CELL) * CELL, z0: Math.floor((z0 - MARGIN) / CELL) * CELL };
  grid.w = Math.ceil((x1 + MARGIN - grid.x0) / CELL); grid.h = Math.ceil((z1 + MARGIN - grid.z0) / CELL);
  const bounds = { x0: grid.x0, z0: grid.z0, x1: grid.x0 + grid.w * CELL, z1: grid.z0 + grid.h * CELL };
  console.log(`model: ${tris.length} triangles, ${(x1 - x0).toFixed(1)} x ${(z1 - z0).toFixed(1)} m, ${y1.toFixed(1)} m high`);
  const { items, floorArea, caps } = buildBoxes(tris, grid);
  const fill = voidFill(floorArea, grid);
  const boxes = [...items, ...fill.boxes];
  console.log(`boxes: ${items.length} drawn and capping walls + ${fill.boxes.length} behind the walls = ${boxes.length} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  return { tris, transform, grid, bounds, items, fill, boxes, floorArea };
}
export { world, robot, SPAWNS, CELL, TOP, SURF, OUT };

// the place a player lands when dropped at (x, z) from just above height y
function land(W, x, z, y) {
  const p = { pos: { x, y: y + 0.5, z }, vel: { x: 0, y: 0, z: 0 }, onGround: false };
  for (let f = 0; f < 240; f++) if (W.frame(p, STAND).onGround) break;
  return p;
}
// the reached places as a mask of 50 cm squares, for the minimap (the game asks its walk grid what is open)
function walkMask(states, bounds) {
  const C = 0.5, w = Math.ceil((bounds.x1 - bounds.x0) / C), h = Math.ceil((bounds.z1 - bounds.z0) / C), bits = new Uint8Array(Math.ceil(w * h / 8));
  for (const s of states) { if (s.c) continue; const i = Math.floor((s.x - bounds.x0) / C), j = Math.floor((s.z - bounds.z0) / C); if (i >= 0 && j >= 0 && i < w && j < h) { const k = j * w + i; bits[k >> 3] |= 1 << (k & 7); } }
  return { x0: bounds.x0, z0: bounds.z0, cell: C, w, h, bits: Buffer.from(bits).toString('base64') };
}
// where the robot stands that is not the model's floor: on top of a wall, a sill, a trim. Grouped, with the height over the floor nearby
function perches(states, items) {
  const idx = new Map(), key = (i, j) => i + ',' + j, add = (m, k, v) => (m.get(k) || m.set(k, []).get(k)).push(v);
  for (const b of items) if (b[7] === 0) for (let i = Math.floor(b[0] / 100); i <= Math.floor(b[3] / 100); i++) for (let j = Math.floor(b[2] / 100); j <= Math.floor(b[5] / 100); j++) add(idx, key(i, j), b);
  const onFloor = s => { const r = 0.35; for (const b of idx.get(key(Math.floor(s.x), Math.floor(s.z))) || []) if (b[0] / 100 < s.x + r && b[3] / 100 > s.x - r && b[2] / 100 < s.z + r && b[5] / 100 > s.z - r && Math.abs(b[4] / 100 - s.y) <= 0.06) return true; return false; };
  const floorTop = new Map(); for (const s of states) if (onFloor(s)) { const k = key(Math.round(s.x), Math.round(s.z)); floorTop.set(k, Math.max(floorTop.get(k) ?? -Infinity, s.y)); }
  const out = [];
  for (const s of states) { if (s.y < 0.05 || onFloor(s)) continue; let f = -Infinity; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) f = Math.max(f, floorTop.get(key(Math.round(s.x) + a, Math.round(s.z) + b)) ?? -Infinity); out.push({ x: s.x, y: s.y, z: s.z, over: s.y - f }); }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), src = args.find(a => !a.startsWith('--'));
  if (src) takeIn(src.replace(/^~(?=\/)/, process.env.HOME));
  const B = build(), W = world(B.boxes, B.bounds);
  // spawns: dropped onto the map, then checked against what the robot reaches
  const spawns = SPAWNS.map(([x, y, z, yaw]) => { const p = land(W, x, z, y); return [x, +p.pos.y.toFixed(2), z, yaw, p.ground ? p.ground.kind : -1, y]; });
  const bad = spawns.filter(s => s[4] !== 0 || Math.abs(s[1] - s[5]) > 0.05);
  if (bad.length) throw new Error('spawns not on the floor: ' + JSON.stringify(bad));
  const piles = checkAmmo(W);
  if (piles.length) throw new Error('ammo piles with nothing to stand on: ' + JSON.stringify(piles));
  const legs = checkPath(W, CINEMATIC);
  if (legs.length) throw new Error('the camera path goes through the town:\n  ' + legs.join('\n  '));
  const t0 = Date.now(), exact = robot(W, spawns, B.bounds);
  console.log(`walk-and-jump check: ${exact.states.length} places reached, ${exact.sims} tries, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  // each spawn: the robot reaches it, and a player dropped anywhere in the 1.5 m square round it lands at its height, untouched by any wall
  const near = (s, R) => R.states.some(q => !q.c && Math.abs(q.x - s[0]) <= 0.3 && Math.abs(q.z - s[2]) <= 0.3 && Math.abs(q.y - s[1]) <= 0.06);
  for (const s of spawns) {
    if (!near(s, exact)) throw new Error(`spawn ${s[0]}, ${s[2]} is not reached by the robot`);
    for (let a = -0.75; a <= 0.75; a += 0.25) for (let b = -0.75; b <= 0.75; b += 0.25) {
      const p = land(W, s[0] + a, s[2] + b, s[1]), moved = Math.hypot(p.pos.x - s[0] - a, p.pos.z - s[2] - b);
      if (Math.abs(p.pos.y - s[1]) > 0.05 || moved > 0.01) throw new Error(`spawn ${s[0]}, ${s[2]}: the square round it is not level and clear (at ${a}, ${b}: height ${p.pos.y.toFixed(2)}, pushed ${moved.toFixed(2)} m)`);
    }
  }
  const report = (name, R) => {
    const p = perches(R.states, B.items), high = p.filter(q => q.over > 1.3), top = R.states.reduce((m, s) => Math.max(m, s.y), -Infinity);
    const outside = R.states.filter(s => !s.ground && s.y < 0.05);
    if (R.squeezed.length) console.log(`  ${name}: ${R.squeezed.length} squeezes into solid ground, where the map puts the player back: ` + R.squeezed.slice(0, 4).map(q => `${q.x.toFixed(1)}, ${q.y.toFixed(1)}, ${q.z.toFixed(1)}`).join('; '));
    console.log(`  ${name}: highest place ${top.toFixed(2)} m; ${p.length} places off the floor, ${high.length} of them more than 1.3 m over the floor beside them (highest ${high.length ? high.reduce((m, q) => Math.max(m, q.y), -Infinity).toFixed(2) : '-'} m); ${outside.length} on the bare ground`);
    return { perches: p.length, high: high.length };
  };
  const rep = report('robot', exact);
  const out = {
    about: 'Maram: collision, walk mask and spawns, made by scripts/maram-build.mjs from maram.glb. Boxes are [x0, y0, z0, x1, y1, z1, kind] in centimetres; kind: surface index (0-4) for drawn things, 8 behind the walls, 9 above wall tops (both for players only).',
    transform: B.transform, bounds: [B.bounds.x0, B.bounds.z0, B.bounds.x1, B.bounds.z1], top: TOP, surfaces: SURF,
    boxes: [].concat(...B.boxes.map(b => [b[0], b[1], b[2], b[3], b[4], b[5], b[7] === 2 ? 8 : b[7] === 3 ? 9 : b[6]])),
    walk: walkMask(exact.states, B.bounds),
    spawns: spawns.map(s => s.slice(0, 4)),
    cinematic: CINEMATIC,
    hide: HIDE,
    ammo: AMMO,
    check: { places: exact.states.length, offFloor: rep.perches, high: rep.high },
  };
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`wrote ${OUT} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
}
