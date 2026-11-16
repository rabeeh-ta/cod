/* Colosseum: a second map for Saltline. The arena of the Colosseum, under restoration, an hour after a storm.

   Built the way the Gizmo Labs guides build theirs (gizmo-labs.com/guides):
     - the look comes from pictures, the sizes from published measurements, and where they disagree the numbers win
     - one bay is built finished, in its own flat space (along the wall, depth, height), then bent round the ellipse
     - no two stones alike: every block has its own tint and its own patch of stone, with stains and darker bases
     - slow light (corners, undersides, doorways) is baked into the vertices; the sun and its shadows stay live
     - plain checks: every face is wound from its normal, the parts are counted, and stats() reports the totals

   How it meets the game (see scripts/map-hooks.mjs): pre() runs before the game reads its constants, then level(),
   backdrop() and ground() replace the harbour's three build stages. Everything else (weapons, players, effects, sound,
   the multiplayer layer) is the game's own and unchanged.

   Players never leave the arena floor. The arena wall is an exact ellipse in the collision code (see physics below),
   not a ring of boxes, so sliding along it is smooth; shots and grenades also land on the seats behind it.          */
(() => {
  'use strict';
  const MAPS = window.__SALTLINE_MAPS = window.__SALTLINE_MAPS || {};

  /* ------------------------------------------------------------------ the plan, in numbers
     Published: arena 76 x 44 m, outer wall 188 x 156 m and 48.5 m high, seats at about 37 degrees in three bands of
     17, 21 and 18 rows, 80 bays, 240 masts. Here the arena is 69 x 43 m (about 91%) so that the map is as long as
     the harbour and sits inside the game's 70 m walk grid; the stands keep their real row counts and slope.      */
  const CX = -4.5;               // arena centre on x (z centre is 0): the walk grid runs from x = -40 to 31
  const A = 34.5, B = 21.5;      // semi-axes of the arena, measured at the face of the podium plinth
  const NB = 80;                 // bays round the ring; one bay is 2.23 m of arena wall
  const SECTORS = 4;             // the ring is cut into quarters so what is behind the camera is not drawn
  const SUN = { az: -65, el: 35 }; // degrees: the sun stands to the south so neither end of the arena looks into it
  const WALL_TOP = 4.42;         // top of the podium parapet: below this a shot hits the wall, above it the stands

  // radial section: d = metres out from the arena wall, y = height
  const SEC = {
    face: 0.10,                                             // wall face behind the plinth
    terrace: { d0: 0.44, d1: 2.1, y: 3.6, rows: 3, tread: 1.8, rise: 0.4667 },   // senators' platforms: ends d 7.5, y 5.0
    wall1: { d: 7.5, y0: 5.0, y1: 6.9, walk: 6.0, back: 7.92, end: 9.0 },
    band1: { d: 9.0, y: 6.0, rows: 17, tread: 0.70, rise: 0.44 },               // ends d 20.9, y 13.48
    wall2: { d: 22.1, y0: 13.48, y1: 16.1, walk: 15.2, back: 22.5, end: 23.5 },
    band2: { d: 23.5, y: 15.2, rows: 21, tread: 0.68, rise: 0.47 },             // ends d 37.78, y 25.07
    wall3: { d: 38.9, y0: 25.07, y1: 29.4, walk: 28.5, back: 39.35, end: 40.2 },
    band3: { d: 40.2, y: 28.5, rows: 11, tread: 0.62, rise: 0.52 },             // ends d 47.02, y 34.22
    portico: { d0: 47.02, col: 47.5, d1: 52.5, y: 34.22, colH: 5.0, beam: 40.0, roof: 41.3 },
    attic: { d0: 52.5, d1: 53.3, y: 43.0, mast: 47.6 },
  };

  // the stores: lean-to roofs along the wall near each gate. first bay and number of bays; how far the roof reaches; its height at the wall and at the eave
  const STORES = { runs: [[32, 5], [72, 5]], eave: 3.8, y0: 3.02, y1: 2.42 };
  const storeRoofY = d => STORES.y0 + (STORES.y1 - STORES.y0) * Math.min(1, Math.max(0, -d / STORES.eave));

  /* ------------------------------------------------------------------ small maths */
  const TAU = Math.PI * 2, clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  // the same build gives the same bytes every time: all randomness comes from these two
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash(i, j = 0, k = 0) { let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(k | 0, 2147483647)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function noise2(x, z) { const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz); return lerp(lerp(hash(xi, zi), hash(xi + 1, zi), u), lerp(hash(xi, zi + 1), hash(xi + 1, zi + 1), u), v); }
  const C3 = c => (typeof c === 'number' ? [c, c, c] : c);             // one colour: a grey level or [r, g, b]
  const PV = (...cs) => cs.map(C3);                                     // one colour per corner
  const fbm2 = (x, z) => noise2(x, z) * 0.55 + noise2(x * 2.1 + 7.3, z * 2.1 + 1.9) * 0.3 + noise2(x * 4.3 + 3.1, z * 4.3 + 8.7) * 0.15;

  /* The arena ellipse by arc length. s runs from the east end (s = 0) through north (s = L / 4), west and south. */
  const NT = 4096, ARC = new Float64Array(NT + 1);
  { let px = A, pz = 0; for (let i = 1; i <= NT; i++) { const t = (i / NT) * TAU, x = A * Math.cos(t), z = B * Math.sin(t); ARC[i] = ARC[i - 1] + Math.hypot(x - px, z - pz); px = x; pz = z; } }
  const L = ARC[NT], HB = L / NB;
  function thetaAt(s) {
    s = ((s % L) + L) % L;
    let lo = 0, hi = NT;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ARC[m] <= s) lo = m; else hi = m; }
    return ((lo + (s - ARC[lo]) / (ARC[hi] - ARC[lo])) / NT) * TAU;
  }
  // the frame at s: point on the wall (ex, ez), unit tangent (tx, tz) toward growing s, unit outward normal (nx, nz), curvature k
  const frames = new Map();
  function frame(s) {
    const key = Math.round(s * 2000);
    let f = frames.get(key);
    if (!f) {
      const t = thetaAt(s), c = Math.cos(t), sn = Math.sin(t), g = Math.hypot(B * c, A * sn), q = A * A * sn * sn + B * B * c * c;
      f = { ex: CX + A * c, ez: B * sn, tx: -A * sn / g, tz: B * c / g, nx: B * c / g, nz: A * sn / g, k: A * B / Math.pow(q, 1.5) };
      frames.set(key, f);
    }
    return f;
  }
  const stretch = (s, d) => 1 + d * frame(s).k;          // how much longer a metre of wall is at depth d
  const metres = (s, d, m) => m / stretch(s, d);          // a length in metres at depth d, as a step in s
  const ringAt = (s, d) => { const f = frame(s); return [f.ex + d * f.nx, f.ez + d * f.nz]; };

  // nearest point on the arena ellipse to (px, pz), both measured from the centre (works inside and outside)
  function nearest(px, pz) {
    const ax = Math.abs(px), az = Math.abs(pz);
    let tx = 0.7071, tz = 0.7071;
    for (let i = 0; i < 5; i++) {
      const x = A * tx, z = B * tz, ex = (A * A - B * B) * tx * tx * tx / A, ez = (B * B - A * A) * tz * tz * tz / B;
      const rx = x - ex, rz = z - ez, qx = ax - ex, qz = az - ez, r = Math.hypot(rx, rz), q = Math.hypot(qx, qz) || 1e-9;
      tx = clamp((qx * r / q + ex) / A, 0, 1); tz = clamp((qz * r / q + ez) / B, 0, 1);
      const t = Math.hypot(tx, tz) || 1; tx /= t; tz /= t;
    }
    return [A * tx * (px < 0 ? -1 : 1), B * tz * (pz < 0 ? -1 : 1)];
  }
  const inside = (px, pz) => (px * px) / (A * A) + (pz * pz) / (B * B) < 1;
  // metres outside the arena wall (negative inside), and the outward normal there
  function outward(px, pz) {
    const [qx, qz] = nearest(px, pz), nx = qx / (A * A), nz = qz / (B * B), nl = Math.hypot(nx, nz) || 1;
    return { d: ((px - qx) * nx + (pz - qz) * nz) / nl, nx: nx / nl, nz: nz / nl, qx, qz };
  }

  // the stands as a height over the ground, for shots and grenades: the section above as a polyline
  const PROFILE = (() => {
    const p = [[0, 0], [0, SEC.terrace.y], [SEC.terrace.d0 - 0.3, SEC.terrace.y], [SEC.terrace.d0 - 0.3, WALL_TOP], [SEC.terrace.d0, WALL_TOP], [SEC.terrace.d0, SEC.terrace.y], [SEC.terrace.d1, SEC.terrace.y]];
    const slope = (b, rows) => { p.push([b.d, b.y + b.rise * 0.5], [b.d + rows * b.tread, b.y + b.rise * (rows + 0.5)]); };
    slope({ d: SEC.terrace.d1, y: SEC.terrace.y, tread: SEC.terrace.tread, rise: SEC.terrace.rise }, SEC.terrace.rows);
    for (const [w, b] of [[SEC.wall1, SEC.band1], [SEC.wall2, SEC.band2], [SEC.wall3, SEC.band3]]) {
      p.push([w.d, w.y0], [w.d, w.y1], [w.back, w.y1], [w.back, w.walk], [w.end, w.walk]);
      slope(b, b.rows);
    }
    p.push([SEC.portico.d1, SEC.portico.y], [SEC.portico.d1, SEC.attic.y], [SEC.attic.d1, SEC.attic.y], [SEC.attic.d1, 0]);
    return p;
  })();
  function profileY(d) {
    if (d <= 0) return 0;
    let y = 0;
    for (let i = 1; i < PROFILE.length; i++) {
      const [d0, y0] = PROFILE[i - 1], [d1, y1] = PROFILE[i];
      if (d < d0) break;
      y = d1 > d0 ? (d <= d1 ? lerp(y0, y1, (d - d0) / (d1 - d0)) : y1) : Math.max(y0, y1);
    }
    return d > SEC.attic.d1 ? 0 : y;
  }
  const standsY = (x, z) => (inside(x - CX, z) ? 0 : profileY(outward(x - CX, z).d));

  /* A store roof is one flat sheet of tiles per bay. Boxes can only make steps, and a slope made of steps jolts the
     eye at every one, so the roofs are kept as what they are: for each bay its four corners on the plan and the
     plane it lies in. Walking, shots and thrown things all ask this (installPhysics). */
  let ROOFS = null, FIRE_VOICES = null;
  function roofs() {
    if (ROOFS) return ROOFS;
    ROOFS = [];
    for (const [first, bays] of STORES.runs) for (let i = first; i < first + bays; i++) {
      const s0 = i * HB, s1 = s0 + HB, w0 = ringAt(s0, -0.02), w1 = ringAt(s1, -0.02), e1 = ringAt(s1, -STORES.eave), e0 = ringAt(s0, -STORES.eave), q = [w0, w1, e1, e0];
      // the plane through the edge at the wall and the middle of the eave
      const ax = w1[0] - w0[0], az = w1[1] - w0[1], bx = (e0[0] + e1[0]) / 2 - w0[0], by = STORES.y1 - STORES.y0, bz = (e0[1] + e1[1]) / 2 - w0[1];
      let nx = -az * by, ny = az * bx - ax * bz, nz = ax * by; const nl = Math.hypot(nx, ny, nz) * (ny < 0 ? -1 : 1); nx /= nl; ny /= nl; nz /= nl;
      // its four edges, each with the direction that points into the roof
      const mx = (w0[0] + w1[0] + e1[0] + e0[0]) / 4, mz = (w0[1] + w1[1] + e1[1] + e0[1]) / 4;
      const edges = q.map((a, k) => { const b = q[(k + 1) % 4], l = Math.hypot(b[0] - a[0], b[1] - a[1]); let ux = (b[1] - a[1]) / l, uz = -(b[0] - a[0]) / l; if ((mx - a[0]) * ux + (mz - a[1]) * uz < 0) { ux = -ux; uz = -uz; } return [a[0], a[1], ux, uz]; });
      ROOFS.push({ x: w0[0], y: STORES.y0, z: w0[1], nx, ny, nz, edges, x0: Math.min(...q.map(c => c[0])), x1: Math.max(...q.map(c => c[0])), z0: Math.min(...q.map(c => c[1])), z1: Math.max(...q.map(c => c[1])) });
    }
    return ROOFS;
  }
  // how far (x, z) is inside this roof's outline (negative: outside)
  const roofInset = (r, x, z) => { let m = Infinity; for (const e of r.edges) m = Math.min(m, (x - e[0]) * e[2] + (z - e[1]) * e[3]); return m; };
  // the height of the tiles over (x, z), or null away from the roofs. margin: how far past the edge still counts (a foot overhangs)
  function roofAt(x, z, margin = 0) {
    let best = null, most = -margin;
    for (const r of roofs()) {
      if (x < r.x0 - margin || x > r.x1 + margin || z < r.z0 - margin || z > r.z1 + margin) continue;
      const m = roofInset(r, x, z);
      if (m >= most) { most = m; best = r; }
    }
    return best ? best.y - (best.nx * (x - best.x) + best.nz * (z - best.z)) / best.ny : null;
  }

  /* ------------------------------------------------------------------ before the game reads its constants */
  function pre(G) {
    const { world, sun, sky } = G.consts, el = SUN.el * Math.PI / 180, az = SUN.az * Math.PI / 180;
    world.quayX = 1e6;                                             // no quay edge and no sea: the ground runs everywhere
    sun.dir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    sun.color.setRGB(1.0, 0.83, 0.62);                             // a higher, whiter sun than the harbour's dawn
    sun.intensity = 5.9;
    sky.horizon.setRGB(0.92, 0.62, 0.36); sky.horizonAway.setRGB(0.17, 0.22, 0.29); sky.fog.setRGB(0.46, 0.47, 0.47);
    // the fires' own sound, added to the game's table before its sound engine starts, so it is made, mixed and turned down like the rest
    if (G.consts.sounds) G.consts.sounds.fire_crackle = { gen: sr => fireSound(sr), n: 1, sr: 44100, peak: 0.7, loop: 1, ref: 1.6, roll: 1.5 };
  }

  /* ------------------------------------------------------------------ the sound of a fire
     A burning brazier, made the way the game makes its own sounds: from numbers, no recording. A low roar that
     breathes, a thin hiss over it, and wood snapping: mostly small ticks that come in flurries, now and then a loud
     crack or a deep pop. Six seconds, and the end runs into the start, so the loop has no seam. */
  function fireSound(sr) {
    const SEC6 = 6, n = Math.round(sr * SEC6), fade = Math.round(sr * 0.5), m = n + fade, r = rng(90210), out = new Float32Array(n);
    const lp = hz => 1 - Math.exp(-TAU * hz / sr), level = (a, to) => { let e = 0; for (let i = 0; i < a.length; i++) e += a[i] * a[i]; const k = to / Math.sqrt(e / a.length || 1); for (let i = 0; i < a.length; i++) a[i] *= k; };
    // slow swells that are back where they started after six seconds
    const swell = (t, parts) => parts.reduce((v, [cycles, amp, ph]) => v + amp * Math.sin(TAU * (cycles * t / SEC6 + ph)), 0);
    const BREATH = [[1, 0.2, 0.1], [3, 0.15, 0.6], [5, 0.1, 0.3], [8, 0.07, 0.8]], FLUTTER = [[23, 0.3, 0.2], [37, 0.22, 0.7], [52, 0.15, 0.4]];
    const roar = new Float32Array(m), hiss = new Float32Array(m);
    { let brown = 0, low = 0, rumble = 0, dull = 0; const a1 = lp(420), a2 = lp(85), a3 = lp(2600);
      for (let i = 0; i < m; i++) {
        const w = r() * 2 - 1;
        brown = (brown + w * 0.045) * 0.996; low += a1 * (brown - low); rumble += a2 * (low - rumble); dull += a3 * (w - dull);
        roar[i] = low - rumble * 0.6; hiss[i] = w - dull;
      } }
    level(roar, 0.115); level(hiss, 0.03);
    for (let i = 0; i < n; i++) {
      const t = i / sr, k = i < fade ? i / fade : 1, at = j => roar[j] * (0.75 + swell(t, BREATH)) + hiss[j] * (0.65 + swell(t, FLUTTER));
      out[i] = at(i) * Math.sqrt(k) + (i < fade ? at(i + n) * Math.sqrt(1 - k) : 0);
    }
    // a snap: a click and a short ring of noise through a narrow filter, written round the end of the loop
    const snap = (start, amp, ms, hz, damp) => {
      const tau = sr * ms / 1000, len = Math.round(tau * 6), f = 2 * Math.sin(Math.PI * Math.min(hz, sr * 0.15) / sr);
      let low = 0, band = 0;
      for (let k = 0; k < len; k++) {
        const x = (r() * 2 - 1) * Math.exp(-k / tau) + (k === 0 ? 1.4 : 0);
        low += f * band; band += f * (x - low - damp * band);
        out[(start + k) % n] += amp * (band * 0.85 + x * 0.22);
      }
    };
    const flurries = Array.from({ length: 9 }, () => r() * SEC6), wrap = t => Math.floor((((t % SEC6) + SEC6) % SEC6) * sr) % n;
    for (let k = 0; k < 150; k++) snap(wrap(r() < 0.7 ? flurries[Math.floor(r() * flurries.length)] + (r() + r() + r() - 1.5) * 0.28 : r() * SEC6), 0.05 + 0.3 * Math.pow(r(), 2.5), 0.4 + 1.6 * r(), 2200 + 4200 * r(), 0.7);   // ticks
    for (let k = 0; k < 13; k++) snap(wrap(r() * SEC6), 0.55 + 0.45 * r(), 2.5 + 5 * r(), 700 + 1500 * r(), 0.45);                                                                                                        // cracks
    for (let k = 0; k < 5; k++) snap(wrap(r() * SEC6), 0.5 + 0.3 * r(), 9 + 8 * r(), 180 + 220 * r(), 0.6);                                                                                                               // deep pops
    return out;
  }

  /* Fires are heard when you come close: within about 15 m, and plainly within 5. Three voices follow the three fires
     that would be loudest where the camera is; a voice that changes fire fades out, moves and fades in, so nothing
     jumps. The game's sound engine places each one in space and turns it down with distance. */
  function makeFireSound(G, fires) {
    const src = fires.map(f => ({ pos: [f.x, f.y + 0.25, f.z], vol: f.big ? 1 : 0.42 })), voices = [0, 1, 2].map(() => ({ h: null, at: null, want: null, g: 0 }));
    const edge = d => 1 - smooth(9, 15, d);
    let wait = 0;
    return {
      update(dt) {
        const au = G.audio, cam = G.camera;
        if (!au || !au.loop || !cam || !G.consts.sounds || !G.consts.sounds.fire_crackle) return;
        const c = cam.position, dist = s => Math.hypot(s.pos[0] - c.x, s.pos[1] - c.y, s.pos[2] - c.z);
        if ((wait -= dt) <= 0) {
          wait = 0.25;
          const pick = src.map(s => { const d = dist(s); return [s, s.vol * edge(d) / (1 + d)]; }).filter(p => p[1] > 0).sort((p, q) => q[1] - p[1]).slice(0, voices.length).map(p => p[0]);
          for (const v of voices) { const i = pick.indexOf(v.want); if (i >= 0) pick.splice(i, 1); else v.want = null; }
          for (const s of pick) { const v = voices.find(o => !o.want && !o.at) || voices.find(o => !o.want); if (v) v.want = s; }
        }
        for (const v of voices) {
          if (v.at !== v.want) {
            v.g = Math.max(0, v.g - dt * 5);
            if (v.g === 0) { v.at = v.want; if (v.at) { if (!v.h) v.h = au.loop('fire_crackle', { pos: v.at.pos, gain: 0, fade: 14 }); if (v.h && v.h.setPos) v.h.setPos(v.at.pos); } }
          } else if (v.at) v.g = Math.min(1, v.g + dt * 3);
          if (v.h && v.h.setGain) v.h.setGain(v.at ? v.g * v.at.vol * edge(dist(v.at)) : 0);
        }
      },
      state: () => voices.map(v => ({ on: !!v.at, playing: !!(v.h && v.h.src), fade: +v.g.toFixed(2), vol: v.at ? v.at.vol : 0, gain: v.h ? +(v.h.gC || 0).toFixed(3) : 0, metres: v.at && G.camera ? +Math.hypot(v.at.pos[0] - G.camera.position.x, v.at.pos[1] - G.camera.position.y, v.at.pos[2] - G.camera.position.z).toFixed(1) : null })),
    };
  }

  /* ------------------------------------------------------------------ stone, sand and marble, painted on the GPU
     Each set is one fragment shader that returns colour, occlusion, roughness and height for a point of a tile that
     repeats. It is drawn three times (colour, ORM, normal from the height) into mip-mapped targets, like the game's
     own materials. Heights are in metres, so the normal map is as deep as the real relief.                         */
  const GLSL_COMMON = `
precision highp float; precision highp int;
in vec2 vUv; out vec4 o;
uniform int uOut; uniform vec2 uTexel; uniform vec2 uTile;
struct S { vec3 a; float ao; float r; float m; float h; };
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vn(vec2 p, vec2 per){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = h21(mod(i, per)), b = h21(mod(i + vec2(1.0, 0.0), per)), c = h21(mod(i + vec2(0.0, 1.0), per)), d = h21(mod(i + vec2(1.0, 1.0), per));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
float fbm(vec2 p, vec2 per){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vn(p, per); p *= 2.0; per *= 2.0; a *= 0.5; } return s / 0.96875; }
float wor(vec2 p, vec2 per){ vec2 i = floor(p), f = fract(p); float d = 9.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){ vec2 g = vec2(float(x), float(y)); d = min(d, length(g + h22(mod(i + g, per)) - f)); }
  return d; }
// travertine: p in metres, per = the period in metres. Bedding runs along x: soft bands, strings of small voids, a few rust veils
vec3 travertine(vec2 p, vec2 per, out float hgt, out float pit){
  float bed  = fbm(p * vec2(1.5, 14.0), per * vec2(1.5, 14.0));
  float fine = fbm(p * vec2(4.0, 36.0) + 5.1, per * vec2(4.0, 36.0));
  float mott = fbm(p * 2.0 + 2.3, per * 2.0);
  float lane = smoothstep(0.56, 0.78, fbm(p * vec2(1.0, 10.0) + 3.7, per * vec2(1.0, 10.0)));      // only some beds are full of holes
  float w    = wor(p * vec2(38.0, 150.0), per * vec2(38.0, 150.0));
  pit = (1.0 - smoothstep(0.08, 0.26, w)) * lane;
  float w2   = wor(p * vec2(12.0, 44.0) + 1.7, per * vec2(12.0, 44.0));
  pit = max(pit, (1.0 - smoothstep(0.04, 0.13, w2)) * smoothstep(0.52, 0.72, mott));             // a few bigger cavities
  vec3 col = mix(vec3(0.545, 0.470, 0.355), vec3(0.455, 0.385, 0.285), smoothstep(0.3, 0.75, bed));
  col *= 0.90 + 0.20 * fine;
  col = mix(col, col * vec3(1.06, 0.97, 0.84), smoothstep(0.4, 0.8, mott) * 0.6);
  float rust = smoothstep(0.60, 0.82, fbm(p * 1.0 + 9.0, per * 1.0)) * smoothstep(0.3, 0.7, bed);
  col = mix(col, vec3(0.44, 0.27, 0.13), rust * 0.42);
  float crust = smoothstep(0.60, 0.88, fbm(p * 0.5 + 21.0, per * 0.5));                               // dark weathering crust, a little green where algae live
  col = mix(col, vec3(0.215, 0.225, 0.185), crust * 0.62);
  float crack = pow(1.0 - abs(2.0 * fbm(p * vec2(1.5, 1.5) + 5.0, per * 1.5) - 1.0), 30.0) * smoothstep(0.45, 0.7, fbm(p * 0.5 + 13.0, per * 0.5));   // hairline cracks, here and there
  col *= 1.0 - 0.55 * crack;
  col *= 1.0 - 0.45 * pit;
  hgt = 0.0042 * (bed - 0.5) + 0.0016 * (fine - 0.5) - 0.008 * pit - 0.004 * crack + 0.0012 * crust;
  return col;
}`;
  const GLSL_SETS = {
    // plain travertine, 2 m tile: single stones get their own patch of it through their UVs
    trav: `S surf(vec2 uv){ vec2 p = uv * uTile; float h, pit; vec3 c = travertine(p, uTile, h, pit);
      return S(c, 1.0 - 0.5 * pit, 0.80 + 0.14 * pit + 0.06 * vn(p * 8.0, uTile * 8.0), 0.0, h); }`,
    // coursed blocks, 4.8 x 2.4 m tile: four courses of 0.6 m, blocks of 1.2 m in running bond. Used where the wall is too far to be cut stone by stone
    ashlar: `S surf(vec2 uv){ vec2 m = uv * uTile;
      float course = floor(m.y / 0.6), cy = fract(m.y / 0.6) * 0.6;
      float bx = (m.x + mod(course, 2.0) * 0.6) / 1.2, bi = mod(floor(bx), 4.0), lx = fract(bx) * 1.2;
      vec2 id = vec2(bi, course);
      float r1 = h21(id * 7.13 + 1.7), r2 = h21(id * 3.71 + 9.2), r3 = h21(id * 5.37 + 4.4);
      float e = min(min(lx, 1.2 - lx), min(cy, 0.6 - cy));
      e += (vn(m * 40.0, uTile * 40.0) - 0.5) * 0.006 * smoothstep(0.0, 0.03, e);            // chipped, uneven arrises
      float h, pit; vec3 c = travertine(vec2(lx, cy) + vec2(r1 * 31.0, r2 * 17.0), vec2(4096.0), h, pit);
      c *= 0.84 + 0.30 * r1; c *= mix(vec3(1.04, 1.0, 0.94), vec3(0.96, 1.0, 1.05), r2);
      if (r3 > 0.88) c = mix(c, vec3(0.66, 0.62, 0.54), 0.55);                               // a stone replaced in a later repair: paler, cleaner
      float joint = 1.0 - smoothstep(0.002, 0.007, e);
      c *= mix(0.42, 1.0, smoothstep(0.0, 0.014, e));
      c = mix(c, vec3(0.20, 0.185, 0.16), joint * 0.7);
      float bevel = smoothstep(0.0, 0.024, e);
      return S(c, mix(0.5, 1.0, smoothstep(0.0, 0.035, e)) * (1.0 - 0.5 * pit), 0.82 + 0.12 * pit + 0.08 * joint, 0.0, h + bevel * 0.017 + (r3 - 0.5) * 0.006 * bevel); }`,
    // veined marble, 1.5 m tile, light: tinted red for the podium panels and cream for their frames
    marble: `S surf(vec2 uv){ vec2 p = uv * 6.0, P = vec2(6.0);
      vec2 w = p + 0.9 * vec2(fbm(p * 1.0, P), fbm(p * 1.0 + 5.2, P));
      float v1 = pow(1.0 - abs(2.0 * fbm(w, P) - 1.0), 7.0);
      float v2 = pow(1.0 - abs(2.0 * fbm(w * 2.0 + 3.1, P * 2.0) - 1.0), 11.0);
      float cloud = fbm(p * 0.5 + 8.0, P * 0.5);
      float g = 0.62 + 0.20 * cloud; g = mix(g, 1.0, v1 * 0.75); g = mix(g, 0.22, v2 * 0.55);
      return S(vec3(g), 1.0, 0.26 + 0.14 * cloud + 0.2 * v2, 0.0, 0.0004 * (cloud - 0.5) - 0.0008 * v2); }`,
    // arena sand, 4 m tile: wind and rake marks, pocks from boots and rain, a few pebbles, damp in the hollows
    sand: `S surf(vec2 uv){ vec2 P = uTile, p = uv * uTile;
      float big = fbm(p, P), mid = fbm(p * 4.0 + 2.2, P * 4.0), fine = fbm(p * 24.0 + 9.0, P * 24.0);
      float grain = fbm(p * 96.0, P * 96.0) * 0.5 + h21(floor(uv / uTexel)) * 0.5;
      float warp = fbm(p * vec2(0.5, 1.0) + 4.0, P * vec2(0.5, 1.0));
      float rip = sin(6.2831853 * (p.y * 5.0 + 1.3 * warp)) * 0.5 + 0.5, ripM = smoothstep(0.42, 0.66, fbm(p * 0.5 + 7.0, P * 0.5));      // wind ripples that come and go
      float t1 = wor(p * 3.0 + 1.3, P * 3.0), t2 = wor(p * 5.0 + 6.1, P * 5.0);
      float tread = smoothstep(0.44, 0.10, t1) * 0.6 + smoothstep(0.38, 0.08, t2) * 0.4, treadM = smoothstep(0.36, 0.62, fbm(p * 0.75 + 1.0, P * 0.75)); // trodden: heel and toe marks over one another
      float grit = smoothstep(0.17, 0.04, wor(p * 7.0 + 8.1, P * 7.0)) * smoothstep(0.62, 0.72, vn(p * 2.0 + 5.0, P * 2.0)) * step(0.5, vn(p * 7.0 + 2.0, P * 7.0));  // a few stones, in patches
      float h = 0.022 * big + 0.009 * mid + 0.0035 * fine + 0.0045 * rip * ripM - 0.013 * tread * treadM + 0.009 * grit + 0.0014 * grain;
      float damp = smoothstep(0.60, 0.36, big + 0.25 * mid);
      vec3 c = mix(vec3(0.385, 0.310, 0.200), vec3(0.535, 0.450, 0.305), mid * 0.6 + fine * 0.4) * (0.84 + 0.32 * grain);
      c *= 1.0 - 0.2 * tread * treadM; c *= 0.94 + 0.12 * rip * ripM;
      c = mix(c, c * vec3(0.50, 0.47, 0.42), damp * 0.9);
      c = mix(c, vec3(0.33, 0.31, 0.28) * (0.7 + 0.6 * grain), grit);
      return S(c, 1.0 - 0.28 * tread * treadM, mix(0.95, 0.34, damp * 0.9) + 0.05 * grain, 0.0, h); }`,
    // fired clay, for amphorae: plain, a little uneven in the firing, with pale salt bloom
    clay: `S surf(vec2 uv){ vec2 p = uv * 8.0, P = vec2(8.0); float n = fbm(p, P), g = fbm(p * 8.0, P * 8.0);
      vec3 c = mix(vec3(0.33, 0.150, 0.075), vec3(0.45, 0.235, 0.115), n) * (0.85 + 0.3 * g);
      c = mix(c, vec3(0.47, 0.42, 0.35), smoothstep(0.62, 0.84, fbm(p * 0.5 + 3.0, P * 0.5)) * 0.25);
      return S(c, 1.0, 0.74 + 0.16 * g, 0.0, 0.0006 * g); }`,
    // Roman brick, 1.2 x 0.96 m tile: thin bricks on thick mortar beds, 16 courses
    brick: `S surf(vec2 uv){ vec2 m = uv * uTile;
      float course = floor(m.y / 0.06), cy = fract(m.y / 0.06) * 0.06;
      float bx = (m.x + mod(course, 2.0) * 0.15 + h21(vec2(course, 3.0)) * 0.3) / 0.3, bi = mod(floor(bx), 4.0), lx = fract(bx) * 0.3;
      vec2 id = vec2(bi, course); float r1 = h21(id * 5.3 + 2.1), r2 = h21(id * 9.7 + 6.3);
      float e = min(min(lx, 0.3 - lx) - 0.006, min(cy, 0.06 - cy) - 0.011);
      e += (vn(m * 60.0, uTile * 60.0) - 0.5) * 0.006;
      float brick = smoothstep(0.0, 0.004, e), n = fbm(m * 30.0, uTile * 30.0);
      vec3 cb = mix(vec3(0.42, 0.20, 0.11), vec3(0.56, 0.36, 0.19), r1) * (0.8 + 0.4 * n); cb = mix(cb, vec3(0.34, 0.30, 0.25), step(0.9, r2) * 0.6);
      vec3 cm = vec3(0.50, 0.47, 0.41) * (0.75 + 0.5 * n);
      return S(mix(cm, cb, brick), mix(0.7, 1.0, brick), mix(0.95, 0.86, brick), 0.0, brick * 0.006 + n * 0.0015); }`,
    // Roman roof, 2.4 m tile (six pans by four courses, so no tile's colour comes round too soon): flat clay pans 0.4 m wide, each course lapping the one below every 0.6 m, and a half-round
    // cover tile over every joint. u runs along the eave, v down the slope
    roof: `S surf(vec2 uv){ vec2 m = uv * uTile;
      float col = floor(m.x / 0.4), x = fract(m.x / 0.4) * 0.4, jx = min(x, 0.4 - x), jc = floor(m.x / 0.4 + 0.5);    // across a pan: joints at both sides
      float row = floor(m.y / 0.6), y = fract(m.y / 0.6);                                                              // down a course: 0 under the lap above, 1 at its lower edge
      vec2 pid = vec2(mod(col, 6.0), mod(row, 4.0)), cid = vec2(mod(jc, 6.0), mod(row, 4.0));
      float p1 = h21(pid * 5.3 + 1.7), p2 = h21(pid * 9.1 + 4.2), c1 = h21(cid * 7.7 + 8.9);
      float n = fbm(m * 25.0, uTile * 25.0), fine = vn(m * 150.0, uTile * 150.0);
      float cw = 0.068 + 0.006 * y, q = jx / cw, onCover = step(jx, cw), round_ = sqrt(max(0.0, 1.0 - q * q));         // the cover tapers toward its upper end
      // heights in metres. Every tile is tilted so that its lower edge rides on the next one down
      float hp = 0.022 * y + (p1 - 0.5) * 0.004 + smoothstep(cw + 0.03, cw, jx) * 0.012;                               // pan, turned up at its sides
      float hc = 0.03 + round_ * 0.05 + 0.024 * y + (c1 - 0.5) * 0.006;                                                // cover
      float h = mix(hp, hc, onCover) + (n - 0.5) * 0.003 + (fine - 0.5) * 0.0012;
      // fired clay, every tile from its own batch; dirt in the gutter beside each cover, shade under each lap, lichen, a washed lower edge
      vec3 clayA = vec3(0.49, 0.23, 0.13), clayB = vec3(0.62, 0.34, 0.19);
      vec3 cp = mix(clayA, clayB, p1) * (0.82 + 0.36 * n), cc = mix(clayA, clayB, c1) * (0.86 + 0.34 * n);
      cp = mix(cp, vec3(0.33, 0.27, 0.21), step(0.9, p2) * 0.35);
      vec3 c = mix(cp, cc, onCover);
      float valley = (1.0 - onCover) * smoothstep(cw + 0.05, cw, jx), lap = smoothstep(0.1, 0.0, y);
      c *= 1.0 - 0.34 * valley * (0.5 + 0.5 * n) - 0.25 * lap;
      c = mix(c, vec3(0.42, 0.44, 0.32), smoothstep(0.62, 0.8, fbm(m * 5.0 + 3.0, uTile * 5.0)) * 0.3 * (1.0 - onCover * 0.5));
      c *= 1.0 + 0.12 * smoothstep(0.85, 1.0, y);
      return S(c, 1.0 - 0.45 * lap - 0.3 * valley, mix(0.9, 0.8, n), 0.0, h); }`,
  };
  const SET_DEFS = {       // tile in metres, size as a share of the quality's texture size, w:h of the target
    trav: { tile: [2, 2], size: 1, aspect: 1 }, ashlar: { tile: [4.8, 2.4], size: 1, aspect: 2 }, marble: { tile: [1.5, 1.5], size: 0.5, aspect: 1 },
    sand: { tile: [4, 4], size: 1, aspect: 1, sharp: 2 }, brick: { tile: [1.2, 0.96], size: 0.5, aspect: 1 }, clay: { tile: [1, 1], size: 0.25, aspect: 1 },
    roof: { tile: [2.4, 2.4], size: 1, aspect: 1 },
  };                       // sharp: the sand is underfoot everywhere, so from the high setting up it is drawn at twice the size (never over 2048)
  function makeTextures(G) {
    const T = G.THREE, renderer = G.renderer, base = Math.min((G.quality && G.quality.tex) || 1024, 2048), fine = base >= 1024 && (!G.quality || (G.quality.name !== 'low' && G.quality.name !== 'medium'));
    const aniso = Math.min(fine ? 16 : 8, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1);
    const cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1), scene = new T.Scene(), quad = new T.Mesh(new T.PlaneGeometry(2, 2));
    quad.frustumCulled = false; scene.add(quad);
    const keep = { rt: renderer.getRenderTarget(), clear: renderer.autoClear, auto: renderer.shadowMap.autoUpdate };
    renderer.autoClear = true; renderer.shadowMap.autoUpdate = false;
    const sets = {};
    for (const name of Object.keys(SET_DEFS)) {
      const def = SET_DEFS[name], w = Math.max(64, Math.min(2048, Math.round(base * def.size * (fine && def.sharp ? def.sharp : 1)))), h = Math.max(64, Math.round(w / def.aspect));
      const mat = new T.RawShaderMaterial({
        glslVersion: T.GLSL3, depthTest: false, depthWrite: false,
        uniforms: { uOut: { value: 0 }, uTexel: { value: new T.Vector2(1 / w, 1 / h) }, uTile: { value: new T.Vector2(def.tile[0], def.tile[1]) } },
        vertexShader: 'in vec3 position; in vec2 uv; out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: GLSL_COMMON + GLSL_SETS[name] + `
void main(){
  if (uOut == 2) {
    float h0 = surf(vUv).h, hx = surf(vUv + vec2(uTexel.x, 0.0)).h, hy = surf(vUv + vec2(0.0, uTexel.y)).h;
    o = vec4(normalize(vec3(-(vec2(hx, hy) - h0) / (uTexel * uTile), 1.0)) * 0.5 + 0.5, 1.0);
  } else { S s = surf(vUv); o = uOut == 0 ? vec4(s.a, 1.0) : vec4(s.ao, s.r, s.m, 1.0); }
}`,
      });
      quad.material = mat;
      const out = [];
      for (let pass = 0; pass < 3; pass++) {
        const rt = new T.WebGLRenderTarget(w, h, { depthBuffer: false, generateMipmaps: true, minFilter: T.LinearMipmapLinearFilter, magFilter: T.LinearFilter, wrapS: T.RepeatWrapping, wrapT: T.RepeatWrapping, anisotropy: aniso, colorSpace: pass === 0 ? T.SRGBColorSpace : T.NoColorSpace });
        mat.uniforms.uOut.value = pass; renderer.setRenderTarget(rt); renderer.render(scene, cam);
        rt.texture.repeat.set(1 / def.tile[0], 1 / def.tile[1]); rt.texture.name = 'col_' + name + pass;
        out.push(rt.texture);
      }
      mat.dispose();
      sets[name] = { albedo: out[0], orm: out[1], normal: out[2], tile: def.tile, size: w };
    }
    renderer.setRenderTarget(keep.rt); renderer.autoClear = keep.clear; renderer.shadowMap.autoUpdate = keep.auto;
    quad.geometry.dispose();
    return sets;
  }

  /* Materials. A new stone material is a copy of one of the game's own with our textures in it, so it keeps the game's
     shader: rain wetness that streaks down walls and pools on flat tops, a damp band where things meet the ground,
     and the large stains that keep a wall from looking uniform.
       wet   = [how much water darkens it, roughness when wet, streaking on walls, beads of water]
       macro = [colour variation, roughness variation, size of the variation, grime]                               */
  function makeMaterials(G, sets) {
    const T = G.THREE, mats = {};
    const stone = (name, set, { color = 0xffffff, rough = 1, nrm = 1.25, wet = [0.38, 0.45, 0.75, 0], macro = [0.34, 0.14, 0.3, 1.0], from = 'concrete' } = {}) => {
      const src = G.mats.get(from, { vertexColors: true }), m = src.clone(), tx = sets[set];
      m.map = tx.albedo; m.normalMap = tx.normal; m.roughnessMap = m.metalnessMap = m.aoMap = tx.orm;
      m.color.set(color); m.roughness = rough; m.metalness = 1; m.normalScale.set(nrm, nrm); m.vertexColors = true;
      m.defines = { ...src.defines };
      const uniforms = { uSlWet: G.mats.uniforms.wet, uSlWetP: { value: new T.Vector4(...wet) }, uSlMacro: { value: new T.Vector4(...macro) }, uSlUv: { value: new T.Vector3(1, 1, tx.size) }, uSlX: { value: new T.Vector2(1, 0) } };
      m.onBeforeCompile = shader => { src.onBeforeCompile(shader); Object.assign(shader.uniforms, uniforms); };
      m.customProgramCacheKey = src.customProgramCacheKey;
      m.userData = { sl: uniforms, set, tile: tx.tile };
      m.name = 'col_' + name;
      return (mats[name] = m);
    };
    stone('trav', 'trav');
    stone('ashlar', 'ashlar');
    stone('marbleRed', 'marble', { color: new T.Color(0.40, 0.085, 0.06), wet: [0.1, 0.7, 0.7, 0.6], macro: [0.1, 0.1, 0.8, 0.25] });
    stone('marbleCream', 'marble', { color: new T.Color(0.80, 0.76, 0.68), wet: [0.12, 0.7, 0.7, 0.5], macro: [0.1, 0.1, 0.8, 0.35] });
    stone('sand', 'sand', { wet: [0.26, 0.62, 0.5, 0], macro: [0.16, 0.12, 0.22, 0.3] });
    stone('brick', 'brick', { macro: [0.2, 0.1, 0.5, 0.6] });
    stone('tile', 'roof', { macro: [0.2, 0.1, 0.6, 0.6] });
    const own = (name, from, opts = {}) => (mats[name] = G.mats.get(from, { vertexColors: true, ...opts }));
    own('bronze', 'brass', { color: 0x7d5f33 }); own('iron', 'steel_dark'); own('rust', 'steel_rust'); own('timber', 'wood_dark'); own('rope', 'rope');
    own('canvas', 'tarp', { color: 0xbfb294, doubleSide: true }); own('canvasRed', 'tarp', { color: 0x74140f, doubleSide: true });
    { const src = mats.canvas, m = src.clone(); m.defines = { ...src.defines }; m.onBeforeCompile = src.onBeforeCompile; m.customProgramCacheKey = src.customProgramCacheKey;
      m.emissive = new T.Color(0.62, 0.47, 0.28); m.emissiveIntensity = 0.55; m.name = 'col_canvasLit'; mats.canvasLit = m; }
    stone('clay', 'clay', { wet: [0.2, 0.6, 0.6, 0.3], macro: [0.2, 0.1, 2.0, 0.4] });
    own('wood', 'wood_pallet'); own('straw', 'rope', { color: 0xb59a52 }); own('shieldRed', 'paint_red');
    // painted and lettered things are drawn on a canvas: the shield's face, the legion's flag, and letters cut in stone
    const paint = (w, h, draw, opts = {}) => {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h);
      const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
      return new T.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0, vertexColors: true, ...opts });
    };
    const GOLD = '#c9a23c', serif = px => '700 ' + px + 'px "Times New Roman", Georgia, serif';
    mats.shield = paint(256, 512, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#7e1611'); g.addColorStop(1, '#5c0f0c'); c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.strokeStyle = GOLD; c.lineWidth = 12; c.strokeRect(8, 8, w - 16, h - 16); c.lineWidth = 3; c.strokeRect(22, 22, w - 44, h - 44);
      c.fillStyle = GOLD; c.fillRect(w / 2 - 38, h / 2 - 50, 76, 100);                                    // the plate under the boss
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {                                                 // four wings and four thunderbolts
        c.save(); c.translate(w / 2, h / 2); c.scale(sx, sy);
        c.beginPath(); c.moveTo(40, 14); c.quadraticCurveTo(84, 22, 104, 64); c.quadraticCurveTo(76, 50, 60, 52); c.quadraticCurveTo(70, 40, 40, 34); c.closePath(); c.fill();
        c.lineWidth = 5; c.beginPath(); c.moveTo(22, 58); c.lineTo(48, 104); c.lineTo(30, 112); c.lineTo(62, 176); c.stroke();
        c.beginPath(); c.moveTo(62, 176); c.lineTo(46, 164); c.lineTo(66, 160); c.closePath(); c.fill(); c.restore();
      }
      c.globalAlpha = 0.5; for (let i = 0; i < 70; i++) { c.strokeStyle = i % 3 ? '#3a0a08' : '#b98f7c'; c.lineWidth = 1 + (i % 2); const x = (i * 97) % w, y = (i * 211) % h; c.beginPath(); c.moveTo(x, y); c.lineTo(x + ((i * 37) % 40) - 20, y + ((i * 53) % 30) - 8); c.stroke(); }   // scuffs
    }, { roughness: 0.55 }); mats.shield.name = 'col_shield';
    mats.vexillum = paint(256, 256, (c, w, h) => {
      c.fillStyle = '#74120e'; c.fillRect(0, 0, w, h); c.strokeStyle = GOLD; c.lineWidth = 8; c.strokeRect(10, 34, w - 20, h - 46);
      c.fillStyle = GOLD; c.font = serif(78); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('SPQR', w / 2, h / 2 + 10);
      for (let x = 6; x < w; x += 9) c.fillRect(x, 0, 4, 26);                                                // the fringe along its lower edge
    }, { side: T.DoubleSide, roughness: 0.85 }); mats.vexillum.name = 'col_vexillum';
    // letters: white on clear, so one sheet can be cut dark into stone or laid on in gold. Top half: the dedication. Bottom half: I to VIII
    const sheet = (opts) => paint(2048, 512, (c, w, h) => {
      c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = serif(96); c.fillText('IMP · CAES · VESPASIANVS · AVG', w / 2, 62); c.fillText('AMPHITHEATRVM · NOVVM · EX · MANVBIS', w / 2, 186);
      c.font = serif(150); ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'].forEach((n, i) => c.fillText(n, (i + 0.5) * (w / 8), 388, w / 8 - 16));
    }, { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...opts });
    mats.letters = sheet({ color: 0x33271d, roughness: 0.9 }); mats.letters.name = 'col_letters';
    mats.lettersGold = sheet({ color: 0xd8ab45, roughness: 0.4, metalness: 0.6 }); mats.lettersGold.name = 'col_lettersGold';
    mats.ember = new T.MeshBasicMaterial({ color: new T.Color(0xf03a0c).multiplyScalar(1.7) }); mats.ember.userData.base = mats.ember.color.clone();
    mats.coal = new T.MeshBasicMaterial({ color: 0x120d0a, vertexColors: true });
    own('laurel', 'paint_green');
    // weeds and loose straw: blades drawn on a canvas, cut out by alpha. Left half green, right half dry
    mats.weeds = paint(256, 128, (c, w, h) => {
      let seed = 12345; const r = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      for (let half = 0; half < 2; half++) for (let i = 0; i < 60; i++) {
        const x0 = half * 128 + 26 + r() * 76, top = 22 + r() * 92, leanX = (r() - 0.5) * 70;
        c.strokeStyle = half ? `hsl(${40 + r() * 12}, ${38 + r() * 20}%, ${34 + r() * 24}%)` : `hsl(${62 + r() * 44}, ${28 + r() * 26}%, ${15 + r() * 20}%)`;
        c.lineWidth = 1.6 + r() * 2.6; c.lineCap = 'round'; c.beginPath(); c.moveTo(x0, h); c.quadraticCurveTo(x0 + leanX * 0.2, h - top * 0.6, Math.min(half * 128 + 124, Math.max(half * 128 + 4, x0 + leanX)), h - top); c.stroke();
      }
    }, { alphaTest: 0.4, side: T.DoubleSide, roughness: 0.92 }); mats.weeds.name = 'col_weeds';
    for (const [name, decal] of [['grime', 'grime_streak']]) { try { const d = G.mats.decal(decal); if (d && d.material) mats[name] = d.material; } catch { /* that mark is left off */ } }
    mats.dark = new T.MeshBasicMaterial({ color: 0x060504 }); mats.dark.name = 'col_dark';
    mats.glow = G.mats.emissive(0xffe6c0, 2.2);
    // casts a shadow and draws nothing: stands in for the far stonework in the sun's view
    mats.proxy = new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: T.DoubleSide }); mats.proxy.shadowSide = T.DoubleSide; mats.proxy.name = 'col_proxy';
    return mats;
  }

  /* ------------------------------------------------------------------ the builder
     Everything on the ring is written in bay space: s along the wall, d out from it, y up. add() bends each vertex onto
     the ellipse with the exact frame at its own s, normals included, so curved walls shade smoothly. Faces are collected
     per material, per sector and per shadow role, and become one mesh each.
       shadow roles: 'cr' casts and receives (near things), 'r' receives only (the far stands: stand-ins cast for them),
                     'c' casts only, '' neither                                                                       */
  function makeBuilder() {
    const buckets = new Map(), counts = {};
    const bucket = (mat, sector, shadow) => {
      const key = mat + '|' + sector + '|' + shadow;
      let b = buckets.get(key);
      if (!b) buckets.set(key, b = { mat, sector, shadow, p: [], n: [], u: [], c: [], i: [], nv: 0 });
      return b;
    };
    const sectorOf = s => Math.floor(((((s % L) + L) % L) / L) * SECTORS) % SECTORS;
    const col3 = c => (typeof c === 'number' ? [c, c, c] : c);
    // pts: 3 or 4 points [s, d, y] ; nb: one bay normal [ns, nd, ny] or one per point ; uv: one [u, v] per point ; col: one colour or one per point
    function add(mat, pts, nb, uv, col = 1, shadow = 'r', sector = null) {
      const n = pts.length, per = Array.isArray(nb[0]), n0 = per ? nb[0] : nb;
      // wind the face from its normal, so no face can point the wrong way
      let ax = 0, ay = 0, az = 0;
      for (let k = 1; k + 1 < n; k++) {
        const e1 = [pts[k][0] - pts[0][0], pts[k][1] - pts[0][1], pts[k][2] - pts[0][2]], e2 = [pts[k + 1][0] - pts[0][0], pts[k + 1][1] - pts[0][1], pts[k + 1][2] - pts[0][2]];
        ax += e1[1] * e2[2] - e1[2] * e2[1]; ay += e1[2] * e2[0] - e1[0] * e2[2]; az += e1[0] * e2[1] - e1[1] * e2[0];
      }
      const flip = ax * n0[0] + ay * n0[1] + az * n0[2] < 0;
      const b = bucket(mat, sector == null ? sectorOf((pts[0][0] + pts[n - 1][0] + pts[1][0]) / 3) : sector, shadow), first = b.nv;
      for (let k = 0; k < n; k++) {
        const [s, d, y] = pts[k], f = frame(s), nn = per ? nb[k] : nb, c = col3(Array.isArray(col) && Array.isArray(col[0]) ? col[k] : col);
        b.p.push(f.ex + d * f.nx, y, f.ez + d * f.nz);
        b.n.push(nn[0] * f.tx + nn[1] * f.nx, nn[2], nn[0] * f.tz + nn[1] * f.nz);
        b.u.push(uv[k][0], uv[k][1]); b.c.push(c[0], c[1], c[2]); b.nv++;
      }
      for (let k = 1; k + 1 < n; k++) flip ? b.i.push(first, first + k + 1, first + k) : b.i.push(first, first + k, first + k + 1);
    }
    // the same in world space, for things that do not follow the ring
    function addW(mat, pts, nrm, uv, col = 1, shadow = 'cr', sector = 'w') {
      const n = pts.length, per = Array.isArray(nrm[0]), n0 = per ? nrm[0] : nrm;
      let ax = 0, ay = 0, az = 0;
      for (let k = 1; k + 1 < n; k++) {
        const e1 = [pts[k][0] - pts[0][0], pts[k][1] - pts[0][1], pts[k][2] - pts[0][2]], e2 = [pts[k + 1][0] - pts[0][0], pts[k + 1][1] - pts[0][1], pts[k + 1][2] - pts[0][2]];
        ax += e1[1] * e2[2] - e1[2] * e2[1]; ay += e1[2] * e2[0] - e1[0] * e2[2]; az += e1[0] * e2[1] - e1[1] * e2[0];
      }
      const flip = ax * n0[0] + ay * n0[1] + az * n0[2] < 0, b = bucket(mat, sector, shadow), first = b.nv;
      for (let k = 0; k < n; k++) {
        const nn = per ? nrm[k] : nrm, c = col3(Array.isArray(col) && Array.isArray(col[0]) ? col[k] : col);
        b.p.push(pts[k][0], pts[k][1], pts[k][2]); b.n.push(nn[0], nn[1], nn[2]); b.u.push(uv[k][0], uv[k][1]); b.c.push(c[0], c[1], c[2]); b.nv++;
      }
      for (let k = 1; k + 1 < n; k++) flip ? b.i.push(first, first + k + 1, first + k) : b.i.push(first, first + k, first + k + 1);
    }
    const count = (what, n = 1) => { counts[what] = (counts[what] || 0) + n; };
    return { add, addW, count, counts, buckets, sectorOf };
  }

  /* shapes in bay space, all made of add() */
  function shapes(bld) {
    const { add } = bld;
    // a strip along the wall between two points of the section, A then B. Walking A to B "up and out", the lit side is on the arena side
    function strip(mat, s0, s1, dA, yA, dB, yB, o = {}) {
      const dd = dB - dA, dy = yB - yA, len = Math.hypot(dd, dy) || 1, ku = o.ku || 1, u0 = o.u0 || 0, vA = o.vA ?? 0, vB = o.vB ?? len;
      add(mat, [[s0, dA, yA], [s1, dA, yA], [s1, dB, yB], [s0, dB, yB]], [0, -dy / len, dd / len],
        [[s0 * ku + u0, vA], [s1 * ku + u0, vA], [s1 * ku + u0, vB], [s0 * ku + u0, vB]], o.cA !== undefined ? PV(o.cA, o.cA, o.cB ?? o.cA, o.cB ?? o.cA) : (o.col ?? 1), o.shadow || 'r');
    }
    // a face across the wall at one s (an end, a cheek): pts are [d, y] round the face, dir is +1 if it looks toward growing s
    function cheek(mat, s, pts, dir, o = {}) {
      add(mat, pts.map(p => [s, p[0], p[1]]), [dir, 0, 0], pts.map(p => [p[0] + (o.u0 || 0), p[1]]), o.col ?? 1, o.shadow || 'r');
    }
    // a box: faces named f(ront, toward the arena) k(back) t(op) b(ottom) l(eft, low s) r(ight)
    function box(mat, s0, s1, d0, d1, y0, y1, o = {}) {
      const faces = o.faces || 'ftlr', ku = o.ku || 1, col = o.col ?? 1, sh = o.shadow || 'r', top = o.top ?? col, sideC = o.side ?? col;
      if (faces.includes('f')) strip(mat, s0, s1, d0, y0, d0, y1, { ku, vA: y0 + (o.v0 || 0), vB: y1 + (o.v0 || 0), col, cA: o.cA, cB: o.cB, shadow: sh, u0: o.u0 });
      if (faces.includes('k')) strip(mat, s0, s1, d1, y1, d1, y0, { ku, vA: y1, vB: y0, col, shadow: sh, u0: o.u0 });
      if (faces.includes('t')) strip(mat, s0, s1, d0, y1, d1, y1, { ku, vA: d0, vB: d1, col: top, shadow: sh, u0: o.u0 });
      if (faces.includes('b')) strip(mat, s0, s1, d1, y0, d0, y0, { ku, vA: d1, vB: d0, col: typeof col === 'number' ? col * 0.6 : col, shadow: sh, u0: o.u0 });
      if (faces.includes('l')) cheek(mat, s0, [[d0, y0], [d1, y0], [d1, y1], [d0, y1]], -1, { col: sideC, shadow: sh });
      if (faces.includes('r')) cheek(mat, s1, [[d0, y0], [d1, y0], [d1, y1], [d0, y1]], 1, { col: sideC, shadow: sh });
    }
    /* A cut stone: a polygon in the wall plane (points [s, y], any convex shape) standing proud at depth d, with every
       edge chamfered back by bev to the joint. col may be one colour or one per corner (for shading that runs up a wall). */
    function stone(mat, poly, d, bev, col, uo, vo, o = {}) {
      const n = poly.length, sh = o.shadow || 'cr';
      let area = 0; for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
      const P = area < 0 ? poly.slice().reverse() : poly, C = Array.isArray(col) && Array.isArray(col[0]) ? (area < 0 ? col.slice().reverse() : col) : null;
      const inN = [], inner = [];
      for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n], ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1; inN.push([-ey / l, ex / l]); }
      for (let i = 0; i < n; i++) { const n1 = inN[(i + n - 1) % n], n2 = inN[i], k = bev / Math.max(0.3, 1 + n1[0] * n2[0] + n1[1] * n2[1]); inner.push([P[i][0] + (n1[0] + n2[0]) * k, P[i][1] + (n1[1] + n2[1]) * k]); }
      const uv = p => [p[0] + uo, p[1] + vo], cAt = i => (C ? C[i] : col);
      add(mat, inner.map(p => [p[0], d, p[1]]), [0, -1, 0], inner.map(uv), C ? inner.map((p, i) => cAt(i)) : col, sh);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, nn = inN[i], c0 = C3(cAt(i)), c1 = C3(cAt(j)), dim = c => c.map(v => v * 0.82);
        add(mat, [[P[i][0], d + bev, P[i][1]], [P[j][0], d + bev, P[j][1]], [inner[j][0], d, inner[j][1]], [inner[i][0], d, inner[i][1]]],
          [-nn[0] * 0.7071, -0.7071, -nn[1] * 0.7071], [uv(P[i]), uv(P[j]), uv(inner[j]), uv(inner[i])], [dim(c0), dim(c1), c1, c0], sh);
      }
    }
    // a turned shape (column, drum, boss) standing at (s, d): profile is [radius, y] from bottom to top
    function turned(mat, s, d, profile, sides, o = {}) {
      const [cx, cz] = ringAt(s, d), f = frame(s), sh = o.shadow || 'r', col = o.col ?? 1, sector = bld.sectorOf(s);
      for (let k = 0; k + 1 < profile.length; k++) {
        const [r0, y0] = profile[k], [r1, y1] = profile[k + 1], sl = Math.hypot(r1 - r0, y1 - y0) || 1, ny = (r0 - r1) / sl, nr = (y1 - y0) / sl;
        for (let i = 0; i < sides; i++) {
          const a0 = (i / sides) * TAU, a1 = ((i + 1) / sides) * TAU;
          const dirv = a => [Math.cos(a) * f.nx + Math.sin(a) * f.tx, Math.cos(a) * f.nz + Math.sin(a) * f.tz];
          const [x0, z0] = dirv(a0), [x1, z1] = dirv(a1);
          const shade = a => (typeof col === 'number' ? col : col) ;
          bld.addW(mat, [[cx + x0 * r0, y0, cz + z0 * r0], [cx + x1 * r0, y0, cz + z1 * r0], [cx + x1 * r1, y1, cz + z1 * r1], [cx + x0 * r1, y1, cz + z0 * r1]],
            [[x0 * nr, ny, z0 * nr], [x1 * nr, ny, z1 * nr], [x1 * nr, ny, z1 * nr], [x0 * nr, ny, z0 * nr]],
            [[a0 * r0 + (o.u0 || 0), y0], [a1 * r0 + (o.u0 || 0), y0], [a1 * r1 + (o.u0 || 0), y1], [a0 * r1 + (o.u0 || 0), y1]], shade(a0), sh, sector);
        }
      }
    }
    /* The wall round an arch: from the arch (centre sc, springing at ys; rs is its half width along the wall, ry its rise)
       out to the rectangle sL..sR x ys..yTop. A fan of faces from the arch to the rectangle, so it meets both exactly. */
    function archFace(mat, sc, ys, rs, ry, sL, sR, yTop, d, colAt, uvAt, shadow = 'r') {
      const angs = [];
      for (let k = 0; k <= 16; k++) angs.push((k / 16) * Math.PI);
      angs.push(Math.atan2(yTop - ys, sR - sc), Math.atan2(yTop - ys, sL - sc));
      angs.sort((p, q) => p - q);
      const inner = t => [sc + rs * Math.cos(t), ys + ry * Math.sin(t)];
      const outer = t => { const dx = Math.cos(t), dy = Math.sin(t); let k = 1e9; if (dx > 1e-6) k = Math.min(k, (sR - sc) / dx); if (dx < -1e-6) k = Math.min(k, (sL - sc) / dx); if (dy > 1e-6) k = Math.min(k, (yTop - ys) / dy); return [sc + dx * k, ys + dy * k]; };
      for (let k = 0; k + 1 < angs.length; k++) {
        if (angs[k + 1] - angs[k] < 1e-6) continue;
        const q = [inner(angs[k]), inner(angs[k + 1]), outer(angs[k + 1]), outer(angs[k])];
        add(mat, q.map(p => [p[0], d, p[1]]), [0, -1, 0], q.map(p => uvAt(p[0], p[1])), q.map(p => C3(colAt(p[0], p[1]))), shadow);
      }
    }
    return { strip, cheek, box, stone, turned, archFace };
  }

  /* ------------------------------------------------------------------ the podium: the wall the players stand against
     One bay, finished: plinth, a course of cut stones, piers either side of a red marble panel in a cream frame with a
     bronze boss, a second course, the cornice, and the parapet with its posts. Every stone is real: five faces, chamfered
     edges, its own tint and its own patch of travertine. Darker toward the ground and under the cornice.
     Some bays hold an arched service door behind an iron grille instead of a panel; the gates and boxes build on the same parts. */
  function buildPodium(bld, sh, plan) {
    const { add } = bld, { strip, cheek, box, stone } = sh, F = SEC.face, BEV = 0.016;
    const tintOf = (i, j, k) => { const t = 0.80 + 0.30 * hash(i, j, k), w = hash(i + 91, j, k) - 0.5; return [t * (1 + w * 0.07), t, t * (1 - w * 0.09)]; };
    // damp, dirty base; shadow under the cornice. top is where this stretch of wall ends (the gates are taller)
    const shadeAt = (y, top = 3.15) => 0.74 + 0.26 * smooth(0.45, 1.5, y) - 0.2 * smooth(top - 0.55, top, y);
    const mul = (c, k) => c.map(v => v * k);
    // one cut stone on the wall face, s0..s1 x y0..y1
    function block(i, j, k, s0, s1, y0, y1, top = 3.15) {
      const t = tintOf(i, j, k), uo = hash(i, j, k + 7) * 23, vo = hash(i, j, k + 13) * 17, lo = mul(t, shadeAt(y0, top)), hi = mul(t, shadeAt(y1, top));
      stone('trav', [[s0, y0], [s1, y0], [s1, y1], [s0, y1]], F - BEV, BEV, [lo, lo, hi, hi], uo - s0, vo - y0);
      bld.count('stones');
    }
    // a run of stones along one course, cut at lengths that differ from course to course
    function course(i, j, a, b, y0, y1, top) {
      const n = Math.max(1, Math.round((b - a) / 1.0));
      let x = a;
      for (let k = 0; k < n; k++) { const nx = k === n - 1 ? b : a + ((k + 1) / n) * (b - a) + (hash(i, j, k + 40) - 0.5) * 0.3 * ((b - a) / n); block(i, j, k, x, nx, y0, y1, top); x = nx; }
    }
    // plinth: 10 cm proud of the wall, chamfered top, with a dark joint at each end
    function plinth(i, a, b) {
      const pt = tintOf(i, 0, 1).map(v => v * 0.86);
      strip('trav', a + 0.004, b - 0.004, 0, 0, 0, 0.46, { vA: hash(i, 1) * 9, vB: hash(i, 1) * 9 + 0.46, u0: hash(i, 2) * 9, cA: mul(pt, 0.62), cB: mul(pt, 0.9), shadow: 'cr' });
      strip('trav', a + 0.004, b - 0.004, 0, 0.46, F - 0.01, 0.56, { vA: 0, vB: 0.11, u0: hash(i, 3) * 9, col: mul(pt, 0.98), shadow: 'cr' });
      for (const e of [a, b]) strip('trav', e - 0.004, e + 0.004, 0.012, 0, 0.012, 0.5, { col: 0.22, shadow: 'r' });
    }
    // a bronze boss: a shallow dome with a raised rim and a stud, centred at (sc, yc) on a face at depth d
    function boss(sc, yc, R, d, tone, id) {
      const K = 14;
      for (let k = 0; k < K; k++) {
        const a0 = (k / K) * TAU, a1 = ((k + 1) / K) * TAU, pt = (r, ang, dd) => [sc + Math.cos(ang) * r, dd, yc + Math.sin(ang) * r], out = (ang, t = 0.6) => [Math.cos(ang) * t, -0.8, Math.sin(ang) * t], uv = (r, ang) => [Math.cos(ang) * r + id, Math.sin(ang) * r];
        add('bronze', [pt(R, a0, d), pt(R, a1, d), pt(R * 0.86, a1, d - R * 0.14), pt(R * 0.86, a0, d - R * 0.14)], [out(a0), out(a1), out(a1), out(a0)], [uv(R, a0), uv(R, a1), uv(R * 0.86, a1), uv(R * 0.86, a0)], tone * 0.8, 'r');
        add('bronze', [pt(R * 0.86, a0, d - R * 0.14), pt(R * 0.86, a1, d - R * 0.14), pt(R * 0.7, a1, d - R * 0.06), pt(R * 0.7, a0, d - R * 0.06)], [out(a0, -0.6), out(a1, -0.6), out(a1, -0.6), out(a0, -0.6)], [uv(R * 0.86, a0), uv(R * 0.86, a1), uv(R * 0.7, a1), uv(R * 0.7, a0)], tone * 0.55, 'r');
        add('bronze', [pt(R * 0.7, a0, d - R * 0.06), pt(R * 0.7, a1, d - R * 0.06), pt(R * 0.16, a1, d - R * 0.25), pt(R * 0.16, a0, d - R * 0.25)], [out(a0, 0.36), out(a1, 0.36), [0, -1, 0], [0, -1, 0]], [uv(R * 0.7, a0), uv(R * 0.7, a1), uv(R * 0.16, a1), uv(R * 0.16, a0)], tone, 'r');
        add('bronze', [pt(R * 0.16, a0, d - R * 0.25), pt(R * 0.16, a1, d - R * 0.25), [sc, d - R * 0.37, yc]], [out(a0), out(a1), [0, -1, 0]], [uv(R * 0.16, a0), uv(R * 0.16, a1), [id, 0]], tone * 1.1, 'r');
      }
    }
    // a marble panel in a raised frame: a..b x y0..y1 on the wall face. The frame stands 3 cm proud, the panel sits 3.5 cm back
    function panel(i, a, b, y0, y1, FW = 0.115, wall = F) {
      const df = wall - 0.03, dp = wall + 0.035, mo = hash(i, 8) * 5, ct = 0.86 + 0.2 * hash(i, 9), sd = shadeAt((y0 + y1) / 2);
      const bar = (q0, q1, r0, r1) => add('marbleCream', [[q0, df, r0], [q1, df, r0], [q1, df, r1], [q0, df, r1]], [0, -1, 0], [[q0 + mo, r0], [q1 + mo, r0], [q1 + mo, r1], [q0 + mo, r1]], ct * sd, 'cr');
      bar(a, b, y0, y0 + FW); bar(a, b, y1 - FW, y1); bar(a, a + FW, y0 + FW, y1 - FW); bar(b - FW, b, y0 + FW, y1 - FW);
      const ia = a + FW, ib = b - FW, iy0 = y0 + FW, iy1 = y1 - FW;
      const ret = (p, n, tone, dA, dB) => add('marbleCream', p.map(([s, y], k) => [s, k < 2 ? dA : dB, y]), n, [[0, 0], [1, 0], [1, 0.07], [0, 0.07]], ct * tone, 'r');
      ret([[ia, iy0], [ib, iy0], [ib, iy0], [ia, iy0]], [0, -0.3, 0.95], 0.9, df, dp); ret([[ia, iy1], [ib, iy1], [ib, iy1], [ia, iy1]], [0, -0.3, -0.95], 0.5, df, dp);
      ret([[ia, iy0], [ia, iy1], [ia, iy1], [ia, iy0]], [0.95, -0.3, 0], 0.7, df, dp); ret([[ib, iy0], [ib, iy1], [ib, iy1], [ib, iy0]], [-0.95, -0.3, 0], 0.7, df, dp);
      ret([[a, y1], [b, y1], [b, y1], [a, y1]], [0, -0.3, 0.95], 1, df, wall); ret([[a, y0], [b, y0], [b, y0], [a, y0]], [0, -0.3, -0.95], 0.6, df, wall);
      ret([[a, y0], [a, y1], [a, y1], [a, y0]], [-0.95, -0.3, 0], 0.8, df, wall); ret([[b, y0], [b, y1], [b, y1], [b, y0]], [0.95, -0.3, 0], 0.8, df, wall);
      const rt = 0.8 + 0.3 * hash(i, 10), ro = hash(i, 11) * 7, rv = hash(i, 12) * 7;
      add('marbleRed', [[ia, dp, iy0], [ib, dp, iy0], [ib, dp, iy1], [ia, dp, iy1]], [0, -1, 0], [[ia + ro, iy0 + rv], [ib + ro, iy0 + rv], [ib + ro, iy1 + rv], [ia + ro, iy1 + rv]], PV(rt * 0.8, rt * 0.8, rt * 0.62, rt * 0.62), 'r');
      return dp;
    }
    function panelBay(i, s0, s1) {
      const j1 = s0 + HB * (0.38 + 0.24 * hash(i, 5)), j2 = s0 + HB * (0.38 + 0.24 * hash(i, 6)), PW = 0.28;
      plinth(i, s0, s1);
      block(i, 1, 0, s0, j1, 0.56, 1.0); block(i, 1, 1, j1, s1, 0.56, 1.0);                        // course under the panel: the joint is off centre and different in every bay
      for (let c = 0; c < 4; c++) { const y0 = 1.0 + c * 0.43, y1 = y0 + 0.43; block(i, 2, c, s0, s0 + PW, y0, y1); block(i, 3, c, s1 - PW, s1, y0, y1); }   // half a pier at each end
      block(i, 4, 0, s0, j2, 2.72, 3.15); block(i, 4, 1, j2, s1, 2.72, 3.15);                      // course over the panel
      const dp = panel(i, s0 + PW, s1 - PW, 1.0, 2.72);
      boss(s0 + HB / 2, 1.86, 0.2, dp, 0.75 + 0.35 * hash(i, 14), i);
      bld.count('panels');
    }

    /* Cornice: an overhanging moulding, cut in stones. yo lifts it (the gates stand 2 m higher). */
    const CORN = [[F, 3.15, 0.55], [F - 0.035, 3.19, 0.6], [F - 0.035, 3.25, 0.72], [F - 0.13, 3.37, 0.8], [F - 0.13, 3.41, 0.9], [-0.15, 3.52, 0.95], [-0.15, 3.585, 1.0], [-0.125, 3.6, 1.05]];
    function cornice(i, s0, s1, yo = 0, parts = 2) {
      for (let h = 0; h < parts; h++) {
        const a = s0 + (h / parts) * (s1 - s0) + 0.003, b = s0 + ((h + 1) / parts) * (s1 - s0) - 0.003, t = tintOf(i, 20, h), vo = hash(i, 21, h) * 11, uo = hash(i, 22, h) * 11;
        for (let k = 0; k + 1 < CORN.length; k++) strip('trav', a, b, CORN[k][0], CORN[k][1] + yo, CORN[k + 1][0], CORN[k + 1][1] + yo, { u0: uo, vA: vo + CORN[k][1], vB: vo + CORN[k + 1][1], cA: mul(t, CORN[k][2]), cB: mul(t, CORN[k + 1][2]), shadow: 'cr' });
        strip('trav', a, b, -0.125, 3.6 + yo, 0.13, 3.6 + yo, { u0: uo, vA: vo, vB: vo + 0.26, col: mul(t, 0.95), shadow: 'cr' });
        strip('trav', a - 0.003, a + 0.003, F - 0.02, 3.2 + yo, -0.1, 3.56 + yo, { col: 0.2, shadow: '' });       // the joint
      }
    }
    // where a cornice stops against something taller, its end is closed. dir is the side it faces
    function corniceEnd(s, yo, dir) {
      cheek('trav', s, [[F, 3.6 + yo], ...CORN.map(c => [c[0], c[1] + yo])], dir, { col: 0.7, shadow: 'cr' });
    }
    // parapet: a slab between posts, with a sunk field on its face and a coping
    function parapet(i, s0, s1, yo = 0) {
      const pw = 0.17, t2 = tintOf(i, 24, 0), ps = hash(i, 25) * 13, a = s0 + pw, b = s1 - pw, y0 = 3.6 + yo, y1 = WALL_TOP - 0.07 + yo;
      stone('trav', [[a, y0], [b, y0], [b, y1], [a, y1]], 0.19, 0.012, mul(t2, 0.93), ps - a, ps, { shadow: 'cr' });
      const fa = a + 0.2, fb = b - 0.2, fy0 = y0 + 0.17, fy1 = y1 - 0.15;
      add('trav', [[fa, 0.186, fy0], [fb, 0.186, fy0], [fb, 0.186, fy1], [fa, 0.186, fy1]], [0, -1, 0], [[fa + ps, fy0], [fb + ps, fy0], [fb + ps, fy1], [fa + ps, fy1]], mul(t2, 0.7), 'r');
      box('trav', a - 0.004, b + 0.004, 0.15, 0.39, y1, WALL_TOP + yo, { faces: 'ftk', col: mul(t2, 1.0), top: mul(t2, 1.04), u0: ps + 3, shadow: 'cr' });
      box('trav', a, b, 0.33, 0.34, y0, y1, { faces: 'k', col: mul(t2, 0.8), shadow: 'cr' });
    }
    function post(i, s, yo = 0) {
      const pw = 0.17, t3 = tintOf(i, 26, 0);
      box('trav', s - pw, s + pw, 0.11, 0.43, 3.6 + yo, 4.52 + yo, { faces: 'ftlrk', col: mul(t3, 0.92), top: mul(t3, 1.0), u0: hash(i, 27) * 9, shadow: 'cr' });
      box('trav', s - pw - 0.03, s + pw + 0.03, 0.08, 0.46, 4.52 + yo, 4.585 + yo, { faces: 'ftlrkb', col: mul(t3, 1.0), top: mul(t3, 1.06), u0: hash(i, 28) * 9, shadow: 'cr' });
      bld.count('posts');
    }

    /* An arched doorway in the wall between sL and sR: plinth either side, jamb stones up to the springing, a ring of
       voussoirs with a keystone, and the wall round the arch up to yTop. Returns the opening for whoever fills it. */
    function doorway(i, sc, w, spring, ring, K, sL, sR, yTop) {
      const r = w / 2, R = r + ring, a = sc - r, b = sc + r;
      plinth(i, sL, a); plinth(i + 500, b, sR);
      for (const [e, dir] of [[a, 1], [b, -1]]) cheek('trav', e, [[0, 0], [F + 0.02, 0], [F + 0.02, 0.56], [0, 0.46]], dir, { col: 0.62, shadow: 'cr' });   // the plinth's ends at the opening
      const n = Math.max(2, Math.round((spring - 0.56) / 0.45)), ch = (spring - 0.56) / n;
      for (let c = 0; c < n; c++) { course(i, 30 + c, sL, a, 0.56 + c * ch, 0.56 + (c + 1) * ch, yTop); course(i, 50 + c, b, sR, 0.56 + c * ch, 0.56 + (c + 1) * ch, yTop); }
      for (let k = 0; k < K; k++) {
        const a0 = (k / K) * Math.PI, a1 = ((k + 1) / K) * Math.PI, key = k === (K - 1) / 2, Ro = key ? R + 0.07 : R, t = mul(tintOf(i, 70, k), key ? 1.06 : 1), at = (rad, ang) => [sc + rad * Math.cos(ang), spring + rad * Math.sin(ang)];
        const poly = [at(r, a0), at(Ro, a0), at(Ro, a1), at(r, a1)], sd = shadeAt(spring + r * Math.sin((a0 + a1) / 2), yTop);
        stone('trav', poly, F - BEV - (key ? 0.02 : 0), BEV + (key ? 0.02 : 0), mul(t, sd), hash(i, 71, k) * 19, hash(i, 72, k) * 19);
        bld.count('stones');
      }
      const wt = 0.9 + 0.12 * hash(i, 73);
      sh.archFace('ashlar', sc, spring, R - 0.02, R - 0.02, sL, sR, yTop, F, (s, y) => wt * shadeAt(y, yTop), (s, y) => [s, y], 'cr');
      bld.count('arches');
      return { a, b, r, sc, spring };
    }
    // the inside of an arched opening, from the wall face back to depth d1: jambs, the curve of the arch, and a dark end
    function reveal(o, d0, d1, tone = 0.6) {
      const { a, b, r, sc, spring } = o, K = 10;
      cheek('trav', a, [[d0, 0], [d1, 0], [d1, spring], [d0, spring]], 1, { col: PV(tone * 0.7, 0.04, 0.04, tone), shadow: 'r' });
      cheek('trav', b, [[d0, 0], [d1, 0], [d1, spring], [d0, spring]], -1, { col: PV(tone * 0.7, 0.04, 0.04, tone), shadow: 'r' });
      for (let k = 0; k < K; k++) {
        const a0 = (k / K) * Math.PI, a1 = ((k + 1) / K) * Math.PI, p = t => [sc + r * Math.cos(t), spring + r * Math.sin(t)], p0 = p(a0), p1 = p(a1), n = t => [-Math.cos(t), 0, -Math.sin(t)];
        add('trav', [[p0[0], d0, p0[1]], [p1[0], d0, p1[1]], [p1[0], d1, p1[1]], [p0[0], d1, p0[1]]], [n(a0), n(a1), n(a1), n(a0)], [[a0, 0], [a1, 0], [a1, d1 - d0], [a0, d1 - d0]], PV(tone * 0.8, tone * 0.8, 0.04, 0.04), 'r');
        add('dark', [[p0[0], d1, p0[1]], [p1[0], d1, p1[1]], [sc, d1, spring]], [0, -1, 0], [[0, 0], [1, 0], [0, 1]], 1, '');
      }
      add('dark', [[a, d1, 0], [b, d1, 0], [b, d1, spring], [a, d1, spring]], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], 1, '');
      strip('trav', a, b, 0, 0.02, d1, 0.02, { cA: tone, cB: 0.05, shadow: 'r' });                                            // threshold
    }
    /* An iron grille filling an arched opening at depth d: upright bars with spear points under the arch, three flat rails.
       split leaves a gap down the middle, as on a pair of gates. */
    function grille(o, d, bar = 0.03, gap = 0.14, split = false) {
      const { a, b, r, sc, spring } = o, n = Math.round((b - a) / gap), topAt = s => spring + Math.sqrt(Math.max(0, r * r - (s - sc) * (s - sc)));
      for (let k = 1; k < n; k++) {
        const s = a + (k / n) * (b - a), top = topAt(s) - 0.06, tone = 0.7 + 0.5 * hash(k, 80, Math.round(sc));
        if (top < 0.4) continue;
        box('iron', s - bar / 2, s + bar / 2, d, d + bar, 0.04, top, { faces: 'flrk', col: tone, shadow: 'cr' });
        add('iron', [[s - bar, d + bar / 2, top - 0.02], [s + bar, d + bar / 2, top - 0.02], [s, d + bar / 2, top + 0.11]], [0, -1, 0], [[0, 0], [0.06, 0], [0.03, 0.1]], tone * 1.1, 'r');
      }
      for (const y of [0.12, spring * 0.52, spring - 0.05]) box('iron', a, b, d - 0.012, d + bar + 0.012, y, y + 0.06, { faces: 'ftbk', col: 0.8, shadow: 'cr' });
      box('iron', a, a + 0.05, d - 0.012, d + bar + 0.012, 0, spring, { faces: 'frk', col: 0.75, shadow: 'cr' }); box('iron', b - 0.05, b, d - 0.012, d + bar + 0.012, 0, spring, { faces: 'flk', col: 0.75, shadow: 'cr' });
      if (split) box('iron', sc - 0.05, sc + 0.05, d - 0.02, d + bar + 0.02, 0, topAt(sc) - 0.05, { faces: 'flrk', col: 0.7, shadow: 'cr' });
      bld.count('grilles');
    }

    for (let i = 0; i < NB; i++) {
      const s0 = i * HB, s1 = s0 + HB, kind = plan.bay[i];
      if (kind === 'panel') panelBay(i, s0, s1);
      else if (kind === 'door') { const o = doorway(i, s0 + HB / 2, 1.3, 1.75, 0.36, 9, s0, s1, 3.15); reveal(o, F, F + 0.8); grille(o, F + 0.1); bld.count('serviceDoors'); }
      if (plan.crown[i] === 'gate') continue;
      cornice(i, s0, s1, 0, kind === 'panel' || kind === 'door' ? 2 : 1);
      if (plan.crown[i] === 'std') { parapet(i, s0, s1); post(i, s0); }
    }
    return { block, course, plinth, boss, panel, cornice, corniceEnd, parapet, post, doorway, reveal, grille, tintOf, shadeAt, mul, CORN, F, BEV };
  }

  /* The two great gates on the long axis: an arch 3.2 m wide in a gatehouse that stands 2 m above the podium, a pair of
     iron gates, and behind them the passage out under the stands, dark in the middle with daylight at the far end.
     The passage is built straight (in its own frame at the gate), not bent with the ring.                              */
  function buildGates(bld, sh, pod) {
    const { strip, cheek, box } = sh, { F } = pod, YO = 2.0, W = 3.2, SPR = 2.9, DEEP = 26;
    for (const [i0, gs] of [[NB - 1, 0], [NB / 2 - 1, L / 2]]) {
      const sL = gs - HB, sR = gs + HB, o = pod.doorway(i0 + 200, gs, W, SPR, 0.5, 13, sL, sR, 3.15 + YO);
      pod.grille(o, F + 0.3, 0.045, 0.17, true);
      pod.cornice(i0 + 200, sL, sR, YO, 3);
      for (const [e, dir] of [[sL, -1], [sR, 1]]) {
        pod.corniceEnd(e, YO, dir); pod.corniceEnd(e, 0, -dir);                                   // the gate's own cornice, and the lower one that stops against it
        cheek('ashlar', e, [[F, 3.6], [7.5, 3.6], [7.5, 3.6 + YO], [F, 3.6 + YO]], dir, { col: PV(0.7, 0.55, 0.8, 0.9), shadow: 'cr' });
        pod.post(i0 + 210 + dir, e - dir * 0.17, YO);
      }
      pod.post(i0 + 220, sL, 0);                                                                  // the low parapet's last post, against the gatehouse
      pod.parapet(i0 + 230, sL + 0.17, gs, YO); pod.parapet(i0 + 231, gs, sR - 0.17, YO); pod.post(i0 + 232, gs, YO);
      strip('ashlar', sL, sR, 0.34, 3.6 + YO, 7.5, 3.6 + YO, { vA: 0, vB: 7.2, col: 0.85, shadow: 'cr' });       // the deck over the gate
      // the passage, straight out along the gate's own axis
      const f = frame(gs), hw = W / 2, sector = bld.sectorOf(gs);
      const P = (u, d, y) => [f.ex + u * f.tx + d * f.nx, y, f.ez + u * f.tz + d * f.nz], N = (nu, nd, ny) => [nu * f.tx + nd * f.nx, ny, nu * f.tz + nd * f.nz];
      const q = (mat, pts, n, uv, col, shadow = 'r') => bld.addW(mat, pts.map(p => P(...p)), Array.isArray(n[0]) ? n.map(v => N(...v)) : N(...n), uv, col, shadow, sector);
      const cuts = [[F, 0.62], [5, 0.2], [14, 0.07], [21, 0.3], [DEEP, 1.0]];                          // depth, and how much light reaches it
      for (let c = 0; c + 1 < cuts.length; c++) {
        const [d0, l0] = cuts[c], [d1, l1] = cuts[c + 1];
        q('ashlar', [[-hw, d0, 0.012], [hw, d0, 0.012], [hw, d1, 0.012], [-hw, d1, 0.012]], [0, 0, 1], [[-hw, d0], [hw, d0], [hw, d1], [-hw, d1]], PV(l0 * 0.8, l0 * 0.8, l1 * 0.8, l1 * 0.8));
        for (const side of [-1, 1]) q('ashlar', [[side * hw, d0, 0], [side * hw, d1, 0], [side * hw, d1, SPR], [side * hw, d0, SPR]], [-side, 0, 0], [[d0, 0], [d1, 0], [d1, SPR], [d0, SPR]], PV(l0 * 0.6, l1 * 0.6, l1, l0));
        for (let k = 0; k < 10; k++) {
          const a0 = (k / 10) * Math.PI, a1 = ((k + 1) / 10) * Math.PI, p = (t, d) => [hw * Math.cos(t), d, SPR + hw * Math.sin(t)], n = t => [-Math.cos(t), 0, -Math.sin(t)];
          q('ashlar', [p(a0, d0), p(a1, d0), p(a1, d1), p(a0, d1)], [n(a0), n(a1), n(a1), n(a0)], [[a0 * hw, d0], [a1 * hw, d0], [a1 * hw, d1], [a0 * hw, d1]], PV(l0, l0, l1, l1));
        }
      }
      // daylight at the far end, and the outer gate in silhouette against it
      for (let k = 0; k < 10; k++) { const a0 = (k / 10) * Math.PI, a1 = ((k + 1) / 10) * Math.PI; q('glow', [[hw * Math.cos(a0), DEEP, SPR + hw * Math.sin(a0)], [hw * Math.cos(a1), DEEP, SPR + hw * Math.sin(a1)], [0, DEEP, SPR]], [0, -1, 0], [[0, 0], [1, 0], [0, 1]], 1, ''); }
      q('glow', [[-hw, DEEP, 0], [hw, DEEP, 0], [hw, DEEP, SPR], [-hw, DEEP, SPR]], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], 1, '');
      for (let k = -4; k <= 4; k++) q('dark', [[k * 0.36 - 0.035, DEEP - 0.4, 0], [k * 0.36 + 0.035, DEEP - 0.4, 0], [k * 0.36 + 0.035, DEEP - 0.4, SPR + Math.sqrt(hw * hw - k * k * 0.1296) - 0.05], [k * 0.36 - 0.035, DEEP - 0.4, SPR + Math.sqrt(hw * hw - k * k * 0.1296) - 0.05]], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], 1, '');
      for (const y of [0.5, 2.2]) q('dark', [[-hw, DEEP - 0.4, y], [hw, DEEP - 0.4, y], [hw, DEEP - 0.4, y + 0.09], [-hw, DEEP - 0.4, y + 0.09]], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], 1, '');
      bld.count('gates');
    }
  }

  /* The two boxes on the short axis: a doorway in the podium below, and above it a pavilion of six marble columns under
     a pediment and a tiled roof, hung with red cloth. They are the landmarks you steer by: north and south.            */
  function buildBoxes(bld, sh, pod) {
    const { add } = bld, { strip, cheek, box, turned } = sh, { F, mul, tintOf } = pod;
    const Y0 = 3.6, PED = 4.5, COLH = 3.1, CAP = PED + COLH, ENT = CAP + 0.62, APEX = ENT + 1.45, FRONT = 0.55, BACK = 6.7;
    for (const [i0, sc, id] of [[18, 20 * HB, 1], [58, 60 * HB, 2]]) {
      const sL = i0 * HB, o = pod.doorway(i0 + 300, sc, 1.9, 1.72, 0.38, 11, sc - HB, sc + HB, 3.15);
      pod.post(i0 + 310, sL);                                                                        // the parapet's last post before the box
      pod.reveal(o, F, F + 1.0); pod.grille(o, F + 0.12, 0.035, 0.15, true);
      const xs = []; for (let j = 0; j < 6; j++) xs.push(sc + (j - 2.5) * 1.62);
      const tone = j => 0.86 + 0.2 * hash(id, 90, j);
      // pedestals under the columns, with a base and a cap moulding, and the low wall between them inlaid with red marble
      xs.forEach((x, j) => {
        const t = tone(j);
        box('trav', x - 0.33, x + 0.33, FRONT - 0.33, FRONT + 0.33, Y0, PED - 0.1, { faces: 'ftlrk', col: t * 0.92, u0: j * 3.1, shadow: 'cr' });
        box('trav', x - 0.38, x + 0.38, FRONT - 0.38, FRONT + 0.38, Y0, Y0 + 0.14, { faces: 'ftlrk', col: t * 0.86, u0: j * 1.7, shadow: 'cr' });
        box('trav', x - 0.38, x + 0.38, FRONT - 0.38, FRONT + 0.38, PED - 0.1, PED, { faces: 'ftlrkb', col: t, top: t * 1.05, u0: j * 2.3, shadow: 'cr' });
        if (j < 5) {
          const a = x + 0.33, b = xs[j + 1] - 0.33;
          box('trav', a, b, FRONT - 0.12, FRONT + 0.12, Y0, PED - 0.16, { faces: 'ftk', col: t * 0.9, top: t, u0: j * 5.3, shadow: 'cr' });
          box('trav', a, b, FRONT - 0.16, FRONT + 0.16, PED - 0.16, PED - 0.08, { faces: 'ftkb', col: t, top: t * 1.05, u0: j * 4.1, shadow: 'cr' });
          pod.panel(i0 * 10 + j, a + 0.1, b - 0.1, Y0 + 0.14, PED - 0.26, 0.07, FRONT - 0.12);
        }
      });
      // side walls of the box, from the front pedestals back to its rear wall
      for (const [e, dir] of [[xs[0] - 0.33, -1], [xs[5] + 0.33, 1]]) {
        box('trav', Math.min(e, e + dir * 0.24), Math.max(e, e + dir * 0.24), FRONT + 0.33, BACK, Y0, PED - 0.16, { faces: 'ftlrk', col: 0.8, top: 0.9, shadow: 'cr' });
      }
      // columns: cream marble shafts with a slight swell on stone bases, plain capitals, a square abacus
      const column = (x, d, j) => {
        const r = 0.2, y = PED, t = tone(j + 7);
        turned('trav', x, d, [[r * 1.42, y], [r * 1.46, y + 0.07], [r * 1.2, y + 0.13], [r * 1.26, y + 0.2], [r * 1.04, y + 0.27]], 12, { col: t * 0.95, shadow: 'cr', u0: j });
        turned('marbleCream', x, d, [[r * 1.04, y + 0.27], [r * 1.05, y + 1.1], [r * 0.86, y + COLH - 0.4]], 12, { col: t, shadow: 'cr', u0: j * 2 });
        turned('trav', x, d, [[r * 0.86, y + COLH - 0.4], [r * 0.93, y + COLH - 0.36], [r * 0.88, y + COLH - 0.32], [r * 1.02, y + COLH - 0.2], [r * 1.4, y + COLH - 0.09]], 12, { col: t, shadow: 'cr', u0: j });
        box('trav', x - r * 1.5, x + r * 1.5, d - r * 1.5, d + r * 1.5, y + COLH - 0.09, y + COLH, { faces: 'ftlrkb', col: t * 0.98, shadow: 'cr' });
        bld.count('boxColumns');
      };
      xs.forEach((x, j) => column(x, FRONT, j));
      column(xs[0], BACK - 0.5, 8); column(xs[5], BACK - 0.5, 9);
      // entablature: architrave, a frieze of red marble, and a cornice that overhangs
      const eL = xs[0] - 0.38, eR = xs[5] + 0.38, et = 0.9 + 0.1 * hash(id, 91);
      box('trav', eL, eR, FRONT - 0.3, FRONT + 0.3, CAP, CAP + 0.22, { faces: 'fblrk', col: et, u0: id * 4, shadow: 'cr' });
      box('marbleRed', eL, eR, FRONT - 0.27, FRONT + 0.27, CAP + 0.22, ENT - 0.16, { faces: 'flrk', col: 0.85, u0: id * 7, shadow: 'cr' });
      box('trav', eL - 0.12, eR + 0.12, FRONT - 0.46, FRONT + 0.36, ENT - 0.16, ENT, { faces: 'ftblrk', col: et * 1.04, top: et, u0: id * 9, shadow: 'cr' });
      for (const [e, dir] of [[eL, -1], [eR, 1]]) {            // the same three bands down each side
        const a = Math.min(e, e - dir * 0.3), b = Math.max(e, e - dir * 0.3);
        box('trav', a, b, FRONT + 0.3, BACK, CAP, CAP + 0.22, { faces: dir < 0 ? 'lb' : 'rb', col: et * 0.9, shadow: 'cr' });
        box('marbleRed', a, b, FRONT + 0.27, BACK, CAP + 0.22, ENT - 0.16, { faces: dir < 0 ? 'l' : 'r', col: 0.75, shadow: 'cr' });
        box('trav', Math.min(e, e + dir * 0.12), Math.max(e, e + dir * 0.12), FRONT + 0.36, BACK, ENT - 0.16, ENT, { faces: dir < 0 ? 'ltb' : 'rtb', col: et, shadow: 'cr' });
      }
      // pediment: a raking cornice either side over a sunk field with a bronze wreath
      const pL = eL - 0.12, pR = eR + 0.12, pd = FRONT - 0.46, td = FRONT - 0.2, rk = 0.24;
      add('trav', [[pL + 0.5, td, ENT], [pR - 0.5, td, ENT], [sc, td, APEX - rk * 1.25]], [0, -1, 0], [[pL, ENT], [pR, ENT], [sc, APEX]], PV(et * 0.62, et * 0.62, et * 0.5), 'cr');
      for (const side of [-1, 1]) {
        const e = side < 0 ? pL : pR, inX = e - side * 0.62;
        add('trav', [[e, pd, ENT], [inX, pd, ENT], [sc, pd, APEX - rk], [sc, pd, APEX]], [0, -1, 0], [[e, ENT], [inX, ENT], [sc, APEX - rk], [sc, APEX]], et * 1.02, 'cr');                       // its face
        add('trav', [[inX, pd, ENT], [sc, pd, APEX - rk], [sc, td, APEX - rk], [inX, td, ENT]], [-side * 0.5, 0, -0.87], [[0, 0], [4.6, 0], [4.6, 0.26], [0, 0.26]], et * 0.45, 'r');   // its underside
        // the roof on this side: tiles from the ridge down to the eaves
        add('tile', [[e, pd, ENT + 0.02], [sc, pd, APEX + 0.02], [sc, BACK + 0.1, APEX + 0.02], [e, BACK + 0.1, ENT + 0.02]], [side * 0.31, 0, 0.95], [[0, 4.9], [0, 0], [BACK, 0], [BACK, 4.9]], PV(0.8, 1, 0.9, 0.72), 'cr');
      }
      add('trav', [[pL, BACK + 0.1, ENT], [pR, BACK + 0.1, ENT], [sc, BACK + 0.1, APEX]], [0, 1, 0], [[pL, ENT], [pR, ENT], [sc, APEX]], 0.5, 'cr');     // the gable at the back
      pod.boss(sc, ENT + 0.5, 0.3, td, 1.0, 400 + id);
      // inside: a timber ceiling, a rear wall in shade with a dark door
      strip('timber', eL, eR, BACK, ENT - 0.16, FRONT + 0.3, ENT - 0.16, { col: 0.3, shadow: 'r' });
      strip('ashlar', eL, eR, BACK, Y0 + 0.9, BACK, ENT - 0.16, { vA: 0, vB: 4, cA: 0.3, cB: 0.2, shadow: 'r' });
      add('dark', [[sc - 0.6, BACK - 0.01, Y0 + 0.9], [sc + 0.6, BACK - 0.01, Y0 + 0.9], [sc + 0.6, BACK - 0.01, Y0 + 3.2], [sc - 0.6, BACK - 0.01, Y0 + 3.2]], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], 1, '');
      // red cloth: a valance in swags between the columns, a curtain tied back at each end, and a banner over the parapet
      const cloth = (pts, n, tone2) => add('canvasRed', pts, n, pts.map(p => [p[0], p[2]]), tone2, 'cr');
      for (let j = 0; j < 5; j++) {
        const a = xs[j] + 0.16, b = xs[j + 1] - 0.16, SEG = 7;
        for (let k = 0; k < SEG; k++) {
          const t0 = k / SEG, t1 = (k + 1) / SEG, s0 = lerp(a, b, t0), s1 = lerp(a, b, t1), drop = t => 0.3 + 0.42 * Math.sin(Math.PI * t), fold = t => FRONT + 0.05 * Math.sin(t * Math.PI * 6 + j);
          cloth([[s0, fold(t0), CAP - 0.02], [s1, fold(t1), CAP - 0.02], [s1, fold(t1) - 0.04, CAP - drop(t1)], [s0, fold(t0) - 0.04, CAP - drop(t0)]], [0, -1, 0], (0.75 + 0.35 * hash(id, j, k)) * (0.8 + 0.2 * Math.cos(t0 * Math.PI * 6 + j)));
        }
        add('bronze', [[a, FRONT - 0.02, CAP - 0.02], [b, FRONT - 0.02, CAP - 0.02], [b, FRONT - 0.02, CAP - 0.07], [a, FRONT - 0.02, CAP - 0.07]], [0, -1, 0], [[a, 0], [b, 0], [b, 0.05], [a, 0.05]], 1.1, 'r');
      }
      for (const [x, dir] of [[xs[0], 1], [xs[5], -1]]) {
        for (let k = 0; k < 5; k++) {
          const u0 = k / 5, u1 = (k + 1) / 5, wAt = y => 0.16 + 0.42 * smooth(PED + 1.0, CAP, y) + 0.3 * smooth(PED + 0.9, PED + 0.1, y), top = CAP - 0.3, mid = PED + 1.0, bot = PED + 0.12;
          const sAt = (u, y) => x + dir * (0.22 + u * wAt(y)), dAt = u => FRONT + 0.1 + 0.06 * Math.sin(u * Math.PI * 5), tn = (0.7 + 0.4 * hash(id, k, 95)) * (0.75 + 0.25 * Math.cos(u0 * Math.PI * 5));
          cloth([[sAt(u0, top), dAt(u0), top], [sAt(u1, top), dAt(u1), top], [sAt(u1, mid), dAt(u1), mid], [sAt(u0, mid), dAt(u0), mid]], [0, -1, 0], tn);
          cloth([[sAt(u0, mid), dAt(u0), mid], [sAt(u1, mid), dAt(u1), mid], [sAt(u1, bot), dAt(u1), bot], [sAt(u0, bot), dAt(u0), bot]], [0, -1, 0], tn * 0.9);
        }
        add('bronze', [[x + dir * 0.18, FRONT + 0.06, PED + 0.95], [x + dir * 0.44, FRONT + 0.06, PED + 0.95], [x + dir * 0.44, FRONT + 0.06, PED + 1.05], [x + dir * 0.18, FRONT + 0.06, PED + 1.05]], [0, -1, 0], [[0, 0], [1, 0], [1, 0.1], [0, 0.1]], 1.2, 'r');
      }
      const bw = 0.62, line = [[FRONT - 0.14, PED - 0.14], [FRONT - 0.14, Y0 + 0.03], [-0.17, Y0 + 0.02], [-0.18, 2.86]];   // between the two middle pedestals
      for (let k = 0; k + 1 < line.length; k++) {
        const [dA, yA] = line[k], [dB, yB] = line[k + 1], dd = dB - dA, dy = yB - yA, len = Math.hypot(dd, dy);
        for (let h = 0; h < 4; h++) { const a = sc - bw + (h / 4) * 2 * bw, b = a + bw / 2, rip = 0.012 * (h % 2 ? 1 : -1); cloth([[a, dA + rip, yA], [b, dA - rip, yA], [b, dB - rip, yB], [a, dB + rip, yB]], [0, dy / len, -dd / len], 0.82 + 0.22 * hash(id, k, h)); }
      }
      add('bronze', [[sc - bw, -0.185, 2.98], [sc + bw, -0.185, 2.98], [sc + bw, -0.185, 2.86], [sc - bw, -0.185, 2.86]], [0, -1, 0], [[0, 0], [1.2, 0], [1.2, 0.12], [0, 0.12]], 1.25, 'r');
      pod.boss(sc, 3.28, 0.2, -0.19, 1.15, 500 + id);
      bld.count('boxes');
    }
  }

  /* ------------------------------------------------------------------ the stands
     Seats are rows of stone: a riser and a tread, cut by narrow stairs with two steps to a row. The coursed-block
     texture is laid so that each riser and each tread is one course, so the seats read as blocks. Corners are darker. */
  function buildStands(bld, sh, plan) {
    const { strip, cheek, box } = sh;
    const perim = d => L + TAU * d;
    const kuAt = d => Math.round(perim(d) / 4.8) * 4.8 / L;                 // blocks meet themselves after one lap
    const SEG = HB;                                                         // a seat row is cut at every bay line
    const gateBay = k => plan.crown[((k % NB) + NB) % NB] === 'gate';
    /* vom: doorways out of the stands (vomitoria). At every `every`-th stair (counting from `at`) the rows r0 .. r0 + n - 1
       are cut wider and open onto a dark passage, with a low wall up each side and across the stair above it.
       lost(bay, row): where the stone seat is gone and the step of brick-faced concrete under it shows. */
    function band(b, rows, stairs, stairHalf, tag, skip = null, vom = null, lost = null) {
      const isVom = c => !!vom && c % vom.every === vom.at;
      for (let r = 0; r < rows; r++) {
        const d0 = b.d + r * b.tread, d1 = d0 + b.tread, y0 = b.y + r * b.rise, y1 = y0 + b.rise, ku = kuAt(d0), course = (r % 4) * 0.6;
        const tone = 0.86 + 0.2 * hash(r, 31, tag);
        // the stairs cut this row into stretches
        const cuts = stairs.map((sc, c) => { const open = isVom(c) && r >= vom.r0 && r < vom.r0 + vom.n, h = metres(sc, d0 + b.tread / 2, open ? vom.half : stairHalf); return [sc - h, sc + h, open]; }).sort((p, q) => p[0] - q[0]);
        for (let c = 0; c < cuts.length; c++) {
          const from = cuts[c][1], to = c + 1 < cuts.length ? cuts[c + 1][0] : cuts[0][0] + L;
          // seats between two stairs, cut at the bay lines
          let a = from;
          while (a < to - 1e-6) {
            const next = Math.min(to, (Math.floor(a / SEG + 1e-6) + 1) * SEG), k = Math.round(a / SEG), kb = Math.floor((a + next) / 2 / SEG);
            if (skip && skip(kb)) { a = next; continue; }
            const stain = 0.72 + 0.4 * fbm2(k * 0.23 + tag * 7, r * 0.31 + tag * 3);
            if (lost && lost(kb, r)) {
              // the stone seat is gone: the step of brick-faced concrete it was bedded on, rougher and redder, with now and then a block that slid and stayed
              const bt = 0.8 + 0.34 * hash(kb, r, tag + 20) * stain;
              const red = v => [bt * v * 1.16, bt * v * 0.8, bt * v * 0.66];                    // fired clay against pale stone: it has to read from the sand
              strip('brick', a, next, d0, y0, d0, y1, { ku: 1, vA: r * 0.31, vB: r * 0.31 + b.rise, cA: red(0.68), cB: red(1.05) });
              strip('brick', a, next, d0, y1, d1, y1, { ku: 1, vA: r * 0.31 + 1, vB: r * 0.31 + 1 + b.tread, cA: red(1.0), cB: red(0.6) });
              if (hash(kb, r, tag + 40) < 0.17) {
                const sa = a + (next - a) * (0.12 + 0.5 * hash(kb, r, 41)), sb = Math.min(next, sa + metres(sa, d0, 0.5 + 0.5 * hash(kb, r, 42))), rt = 0.8 + 0.25 * hash(kb, r, 43);
                box('trav', sa, sb, d0 + 0.1, d0 + 0.5, y1, y1 + 0.33, { faces: 'ftlr', col: rt, side: rt * 0.72, top: rt * 1.06, u0: kb * 1.7 });
              }
              a = next; continue;
            }
            const t = tone * stain * (0.92 + 0.16 * hash(k, r, tag));
            strip('ashlar', a, next, d0, y0, d0, y1, { ku, vA: course, vB: course + 0.6, cA: t * 0.52, cB: t * 1.0 });
            strip('ashlar', a, next, d0, y1, d1, y1, { ku, vA: course + 1.2, vB: course + 1.8, cA: t * 0.9, cB: t * 0.5 });
            a = next;
          }
          // the stair after this stretch: two steps to a row
          const [q0, q1, open] = c + 1 < cuts.length ? cuts[c + 1] : [cuts[0][0] + L, cuts[0][1] + L, cuts[0][2]];
          if (skip && (skip(Math.floor(q0 / SEG)) || skip(Math.floor(q1 / SEG)))) continue;
          if (open) {                       // a row of a doorway: its two side walls down to the passage floor, and the low wall on the seats either side
            const g0 = (r - vom.r0) / vom.n, g1 = (r - vom.r0 + 1) / vom.n, yF = b.y + vom.r0 * b.rise, c0 = tone * 0.72 * (1 - 0.8 * g0), c1 = tone * 0.72 * (1 - 0.8 * g1), pw = metres(q0, d0, 0.17), pt = tone * 0.98, yP = y1 + b.rise + 0.36;
            cheek('trav', q0, [[d0, yF], [d1, yF], [d1, y1], [d0, y1]], 1, { col: PV(c0 * 0.6, c1 * 0.6, c1, c0) });
            cheek('trav', q1, [[d0, yF], [d1, yF], [d1, y1], [d0, y1]], -1, { col: PV(c0 * 0.6, c1 * 0.6, c1, c0) });
            box('trav', q0 - pw, q0, d0, d1, y1, yP, { faces: 'ftlr', col: pt, side: pt * 0.78, top: pt * 1.06, ku });
            box('trav', q1, q1 + pw, d0, d1, y1, yP, { faces: 'ftlr', col: pt, side: pt * 0.78, top: pt * 1.06, ku });
            continue;
          }
          const ym = y0 + b.rise / 2, dm = d0 + b.tread / 2, st = tone * 0.84;
          strip('trav', q0, q1, d0, y0, d0, ym, { ku, cA: st * 0.7, cB: st * 0.95 }); strip('trav', q0, q1, d0, ym, dm, ym, { ku, vA: 0, vB: b.tread / 2, cA: st, cB: st * 0.75 });
          strip('trav', q0, q1, dm, ym, dm, y1, { ku, cA: st * 0.7, cB: st * 0.95 }); strip('trav', q0, q1, dm, y1, d1, y1, { ku, vA: 0, vB: b.tread / 2, cA: st, cB: st * 0.75 });
          // the ends of the seat rows that stand above the first step
          // (brick where the seat beside the stair is gone)
          for (const [q, dir] of [[q0, 1], [q1, -1]]) cheek(lost && lost(Math.floor((q - dir * 0.01) / SEG), r) ? 'brick' : 'trav', q, [[d0, ym], [dm, ym], [dm, y1], [d0, y1]], dir, { col: tone * 0.7 });
        }
      }
      if (vom) stairs.forEach((sc, c) => {            // what closes each doorway: the passage floor going into the dark, the frame and lintel at its back, the wall across the stair above
        if (!isVom(c)) return;
        const dA = b.d + vom.r0 * b.tread, dB = b.d + (vom.r0 + vom.n) * b.tread, yF = b.y + vom.r0 * b.rise, yT = b.y + (vom.r0 + vom.n) * b.rise, hA = metres(sc, dA, vom.half), hB = metres(sc, dB, vom.half);
        const t = 0.9 + 0.16 * hash(c, 33, tag), jw = hB * 0.17, hs = metres(sc, dB, stairHalf), ku = kuAt(dB);
        bld.add('trav', [[sc - hA, dA, yF], [sc + hA, dA, yF], [sc + hB, dB, yF], [sc - hB, dB, yF]], [0, 0, 1], [[0, 0], [2 * vom.half, 0], [2 * vom.half, dB - dA], [0, dB - dA]], PV(t * 0.62, t * 0.62, 0.07, 0.07), 'r');
        bld.add('dark', [[sc - hB, dB - 0.02, yF], [sc + hB, dB - 0.02, yF], [sc + hB, dB - 0.02, yT - 0.3], [sc - hB, dB - 0.02, yT - 0.3]], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], 1, '');
        box('trav', sc - hB, sc + hB, dB - 0.12, dB, yT - 0.3, yT, { faces: 'fb', col: t, ku, u0: c });
        box('trav', sc - hB, sc - hB + jw, dB - 0.1, dB, yF, yT - 0.3, { faces: 'fr', col: t * 0.9, side: t * 0.55 });
        box('trav', sc + hB - jw, sc + hB, dB - 0.1, dB, yF, yT - 0.3, { faces: 'fl', col: t * 0.9, side: t * 0.55 });
        box('trav', sc - hs * 1.25, sc + hs * 1.25, dB - 0.02, dB + 0.17, yT, yT + 0.52, { faces: 'ftlr', col: t, top: t * 1.05, side: t * 0.8, ku, u0: c + 2 });
        bld.count('vomitoria');
      });
      bld.count('rows', rows); bld.count('stairs', stairs.length);
    }
    const even = [], odd = [];
    for (let i = 0; i < NB; i += 2) { even.push(i * HB); odd.push((i + 1) * HB); }
    // the terrace behind the parapet: broad platforms for the front seats
    const tr = SEC.terrace;
    for (let i = 0; i < NB; i++) if (!gateBay(i)) strip('ashlar', i * HB, (i + 1) * HB, 0.34, tr.y, tr.d1, tr.y, { ku: kuAt(1), vA: 0, vB: 1.8, col: 0.9 * (0.92 + 0.16 * hash(i, 40)) });
    band({ d: tr.d1, y: tr.y, tread: tr.tread, rise: tr.rise }, tr.rows, even, 0.55, 0, gateBay);       // the gate passages run under here
    // where the seats are lost: ragged patches high in the bowl, the largest under the scaffolds (buildRepairs)
    const gone = patches => (k, r) => patches.some(([pk, pr, rk, rr]) => { const dk = ((((k - pk) % NB) + NB * 1.5) % NB) - NB / 2, e = (dk / rk) * (dk / rk) + ((r - pr) / rr) * ((r - pr) / rr); return e + (hash(k, r, pk) - 0.5) * 0.8 + (fbm2(k * 0.83 + pk, r * 0.47) - 0.5) * 1.1 < 1; });
    band(SEC.band1, SEC.band1.rows, even, 0.5, 1, null, { every: 5, at: 2, r0: 5, n: 5, half: 0.85 });
    band(SEC.band2, SEC.band2.rows, odd, 0.5, 2, null, { every: 5, at: 0, r0: 6, n: 5, half: 0.9 }, (k, r) => r >= 12 && gone([[24, 17, 3, 4.5], [63, 16.5, 3.6, 5], [4, 18, 2.2, 3.4]])(k, r));      // above the doorways only
    band(SEC.band3, SEC.band3.rows, even, 0.45, 3, null, null, gone([[11.5, 8, 3.2, 4.4], [33, 9, 2.4, 3.6], [51.5, 8, 3.0, 4.4], [71, 7.5, 2.2, 4.6]]));                // the rows that show over the high wall from the sand

    /* The walls between the bands, with their doorways: dark openings in a stone frame, as in the picture. */
    function wall(w, doors, doorW, doorH, tag, extra) {
      const ku = kuAt(w.d);
      for (let i = 0; i < NB; i++) {
        const s0 = i * HB, s1 = s0 + HB, sc = s0 + HB / 2, t = 0.86 + 0.2 * hash(i, 50, tag), has = doors(i);
        const dark = 0.62, top = y => 1 - 0.22 * smooth(w.y1 - 0.5, w.y1, y);
        if (!has) strip('ashlar', s0, s1, w.d, w.y0, w.d, w.y1, { ku, vA: 0, vB: w.y1 - w.y0, cA: t * dark, cB: t * 0.95 });
        else {
          // a doorway with a round head: the wall round it, the reveals fading into the dark, a black end, and a raised band round the arch
          const r = doorW / 2, h = metres(sc, w.d, r), a = sc - h, b = sc + h, ys = w.y0 + doorH - r, dz = w.d + 1.1, K = 8, lt = t * 1.08;
          const wallCol = (s2, y) => t * lerp(dark, 0.95, clamp((y - w.y0) / (w.y1 - w.y0), 0, 1));
          strip('ashlar', s0, a, w.d, w.y0, w.d, ys, { ku, vA: 0, vB: ys - w.y0, cA: t * dark, cB: wallCol(0, ys) });
          strip('ashlar', b, s1, w.d, w.y0, w.d, ys, { ku, vA: 0, vB: ys - w.y0, cA: t * dark, cB: wallCol(0, ys) });
          sh.archFace('ashlar', sc, ys, h, r, s0, s1, w.y1, w.d, wallCol, (s2, y) => [s2 * ku, y - w.y0]);
          cheek('trav', a, [[w.d, w.y0], [dz, w.y0], [dz, ys], [w.d, ys]], 1, { col: PV(t * 0.5, 0.03, 0.03, t * 0.55) });
          cheek('trav', b, [[w.d, w.y0], [dz, w.y0], [dz, ys], [w.d, ys]], -1, { col: PV(t * 0.5, 0.03, 0.03, t * 0.55) });
          bld.add('dark', [[a, dz, w.y0], [b, dz, w.y0], [b, dz, ys], [a, dz, ys]], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], 1, '');
          for (let k = 0; k < K; k++) {
            const a0 = (k / K) * Math.PI, a1 = ((k + 1) / K) * Math.PI, at = (ang, f = 1) => [sc + h * f * Math.cos(ang), ys + r * f * Math.sin(ang)], p0 = at(a0), p1 = at(a1), o0 = at(a0, 1.3), o1 = at(a1, 1.3), n = ang => [-Math.cos(ang), 0, -Math.sin(ang)];
            bld.add('trav', [[p0[0], w.d, p0[1]], [p1[0], w.d, p1[1]], [p1[0], dz, p1[1]], [p0[0], dz, p0[1]]], [n(a0), n(a1), n(a1), n(a0)], [[a0, 0], [a1, 0], [a1, 1.1], [a0, 1.1]], PV(t * 0.5, t * 0.5, 0.03, 0.03), 'r');
            bld.add('dark', [[p0[0], dz, p0[1]], [p1[0], dz, p1[1]], [sc, dz, ys]], [0, -1, 0], [[0, 0], [1, 0], [0, 1]], 1, '');
            bld.add('trav', [[p0[0], w.d - 0.07, p0[1]], [o0[0], w.d - 0.07, o0[1]], [o1[0], w.d - 0.07, o1[1]], [p1[0], w.d - 0.07, p1[1]]], [0, -1, 0], [[p0[0] * ku, p0[1]], [o0[0] * ku, o0[1]], [o1[0] * ku, o1[1]], [p1[0] * ku, p1[1]]], lt * (0.92 + 0.14 * hash(i, k, tag)), 'r');
          }
          const fw = h * 0.3;
          box('trav', a - fw, a, w.d - 0.07, w.d, w.y0, ys, { faces: 'flr', col: lt, side: lt * 0.7, u0: i });
          box('trav', b, b + fw, w.d - 0.07, w.d, w.y0, ys, { faces: 'flr', col: lt, side: lt * 0.7, u0: i + 3 });
          bld.count('doors');
        }
        // coping, and the wall's back down to the walk behind it
        box('trav', s0, s1, w.d - 0.06, w.back + 0.04, w.y1, w.y1 + 0.16, { faces: 'ftkb', col: t * 1.02, top: t * 1.05, ku, u0: tag * 3 });
        strip('ashlar', s0, s1, w.back, w.y1, w.back, w.walk, { ku, vA: 0.6, vB: 0.6 + (w.y1 - w.walk), col: t * 0.6 });
        strip('ashlar', s0, s1, w.back, w.walk, w.end, w.walk, { ku, vA: 1.2, vB: 1.2 + (w.end - w.back), cA: t * 0.6, cB: t * 0.85 });
        if (extra) extra(i, s0, s1, sc, t, ku);
      }
      // the walk at the foot of the wall
      const prev = tag === 1 ? SEC.terrace.d1 + SEC.terrace.rows * SEC.terrace.tread : tag === 2 ? SEC.band1.d + SEC.band1.rows * SEC.band1.tread : SEC.band2.d + SEC.band2.rows * SEC.band2.tread;
      if (w.d - prev > 0.05) for (let i = 0; i < NB; i++) strip('ashlar', i * HB, (i + 1) * HB, prev, w.y0, w.d, w.y0, { ku, vA: 0, vB: w.d - prev, cA: 0.88, cB: 0.62 });
    }
    wall(SEC.wall1, i => i % 4 === 1, 1.0, 1.62, 1);
    wall(SEC.wall2, i => i % 4 === 3, 1.25, 2.1, 2);
    // the high wall under the top seats: a doorway every eighth bay, small arched windows between, and red banners
    wall(SEC.wall3, i => i % 8 === 5, 1.3, 2.2, 3, (i, s0, s1, sc, t) => {
      const w = SEC.wall3;
      if (i % 2 === 1 && i % 8 !== 5) {                                    // window: a dark slot in a raised surround
        const h = metres(sc, w.d, 0.34), y0 = w.y0 + 1.75, y1 = y0 + 1.15, fw = metres(sc, w.d, 0.14);
        bld.add('dark', [[sc - h, w.d - 0.005, y0], [sc + h, w.d - 0.005, y0], [sc + h, w.d - 0.005, y1], [sc - h, w.d - 0.005, y1]], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], 1, '');
        box('trav', sc - h - fw, sc - h, w.d - 0.06, w.d, y0, y1, { faces: 'flr', col: t * 1.05 }); box('trav', sc + h, sc + h + fw, w.d - 0.06, w.d, y0, y1, { faces: 'flr', col: t * 1.05 });
        box('trav', sc - h - fw, sc + h + fw, w.d - 0.08, w.d, y1, y1 + 0.2, { faces: 'ftlrb', col: t * 1.08 }); box('trav', sc - h - fw, sc + h + fw, w.d - 0.1, w.d, y0 - 0.14, y0, { faces: 'ftlrb', col: t * 1.08 });
        bld.count('windows');
      }
      if (i % 4 === 0) {                                                  // banner: red cloth on a bronze rod, hanging a little off the wall
        const h = metres(sc, w.d, 0.55), y1 = w.y1 - 0.25, y0 = y1 - 3.0, d = w.d - 0.14, rows = 5, tone = 0.8 + 0.3 * hash(i, 60);
        for (let r = 0; r < rows; r++) {
          const ya = lerp(y1, y0, r / rows), yb = lerp(y1, y0, (r + 1) / rows), da = d - 0.05 * Math.sin(r * 1.3 + i), db = d - 0.05 * Math.sin((r + 1) * 1.3 + i);
          bld.add('canvasRed', [[sc - h, da, ya], [sc + h, da, ya], [sc + h, db, yb], [sc - h, db, yb]], [0, -1, 0], [[0, ya], [1.1, ya], [1.1, yb], [0, yb]], tone * (0.9 + 0.2 * (r % 2)), 'r');
        }
        bld.add('bronze', [[sc - h, d - 0.02, y0], [sc + h, d - 0.02, y0], [sc + h, d - 0.02, y0 - 0.1], [sc - h, d - 0.02, y0 - 0.1]], [0, -1, 0], [[0, 0], [1, 0], [1, 0.1], [0, 0.1]], 1.2, 'r');
        box('bronze', sc - h * 1.15, sc + h * 1.15, d - 0.05, d + 0.03, y1, y1 + 0.07, { faces: 'ftlrb', col: 0.9 });
        bld.count('banners');
      }
    });
  }

  /* ------------------------------------------------------------------ statues
     What the bowl lacked above the sand: marble figures. One stands on a pedestal on the first wall between each pair
     of its doorways, one in a round-headed niche in each of the two higher walls, and one between every pair of columns
     of the colonnade at the top. Four figures (a man in a toga, an athlete with a discus, Minerva with spear and
     shield, a general with his arm raised), never the same one twice running, turned either way, each of its own
     marble. This is a ruin under repair, so some have lost a head or an arm, and some plinths stand empty.
     A figure is made of tubes: a path of points, each with a half width and a half depth, skinned round.        */
  const STATUES = [];                // where each one stands, so that a shot from the sand marks the statue and not the seats behind it (installPhysics)
  function buildStatues(bld, sh) {
    const KINDS = 4;
    // s, d, y0: where it stands. k: scale (1 is a man of 1.8 m). m: +1 or -1, which way round. dmg: 0 whole, 1 no head, 2 no right arm, 3 only the feet are left
    // lod: 2 for the ones nearest the sand, 1, or 0 for those seen from fifty metres
    function figure(s, d, y0, k, kind, m, tone, dmg, lod) {
      const f = frame(s), [ox, oz] = ringAt(s, d), R = [f.tx * m, f.tz * m], Fw = [-f.nx, -f.nz], sector = bld.sectorOf(s), seed = hash(Math.round(s * 10), kind, 7) * 40;
      const W = p => [ox + (R[0] * p[0] + Fw[0] * p[2]) * k, y0 + p[1] * k, oz + (R[1] * p[0] + Fw[1] * p[2]) * k];
      const N = n => [R[0] * n[0] + Fw[0] * n[2], n[1], R[1] * n[0] + Fw[1] * n[2]];
      // paler where the rain washes it, darker under every overhang, and never one even colour
      const col = (p, n, t) => tone * t * (0.72 + 0.22 * (0.5 + 0.5 * n[1]) + 0.14 * fbm2(p[0] * 5 + seed, p[1] * 5 + p[2] * 3));
      // path: [x (to its side), y (up), z (toward the arena), half width, half depth]. caps: 1 closes the start, 2 the end
      function tube(path, sides, caps = 3, t = 1) {
        const rings = []; let u = null;
        for (let j = 0; j < path.length; j++) {
          const p = path[j], a = path[Math.max(0, j - 1)], b = path[Math.min(path.length - 1, j + 1)];
          let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
          if (!u) { u = [ty, -tx, 0]; if (Math.hypot(u[0], u[1]) < 0.25) u = [0, tz, -ty]; }
          const dot = u[0] * tx + u[1] * ty + u[2] * tz; u = [u[0] - tx * dot, u[1] - ty * dot, u[2] - tz * dot];      // carried along the path, so the skin never twists
          const ul = Math.hypot(u[0], u[1], u[2]) || 1; u = [u[0] / ul, u[1] / ul, u[2] / ul];
          const v = [u[1] * tz - u[2] * ty, u[2] * tx - u[0] * tz, u[0] * ty - u[1] * tx], pts = [], nrm = [];
          for (let i = 0; i < sides; i++) {
            const an = (i / sides) * TAU, c = Math.cos(an), sn = Math.sin(an);
            pts.push([p[0] + u[0] * p[3] * c + v[0] * p[4] * sn, p[1] + u[1] * p[3] * c + v[1] * p[4] * sn, p[2] + u[2] * p[3] * c + v[2] * p[4] * sn]);
            const nx = u[0] * p[4] * c + v[0] * p[3] * sn, ny = u[1] * p[4] * c + v[1] * p[3] * sn, nz = u[2] * p[4] * c + v[2] * p[3] * sn, nl = Math.hypot(nx, ny, nz) || 1;
            nrm.push([nx / nl, ny / nl, nz / nl]);
          }
          rings.push({ pts, nrm, t: [tx, ty, tz] });
        }
        let run = 0;
        for (let j = 0; j + 1 < rings.length; j++) {
          const A0 = rings[j], B0 = rings[j + 1], len = Math.hypot(path[j + 1][0] - path[j][0], path[j + 1][1] - path[j][1], path[j + 1][2] - path[j][2]);
          for (let i = 0; i < sides; i++) {
            const i2 = (i + 1) % sides, q = [A0.pts[i], A0.pts[i2], B0.pts[i2], B0.pts[i]], n = [A0.nrm[i], A0.nrm[i2], B0.nrm[i2], B0.nrm[i]];
            bld.addW('marbleCream', q.map(W), n.map(N), [[i * 0.11 + seed, run], [(i + 1) * 0.11 + seed, run], [(i + 1) * 0.11 + seed, run + len], [i * 0.11 + seed, run + len]], q.map((p, e) => C3(col(p, n[e], t))), 'r', sector);
          }
          run += len;
        }
        for (const [bit, ring, sgn] of [[1, rings[0], -1], [2, rings[rings.length - 1], 1]]) {
          if (!(caps & bit)) continue;
          const n = [ring.t[0] * sgn, ring.t[1] * sgn, ring.t[2] * sgn];
          bld.addW('marbleCream', ring.pts.map(W), N(n), ring.pts.map(p => [p[0] + seed, p[2]]), C3(col(ring.pts[0], n, t)), 'r', sector);
        }
      }
      const bs = [6, 8, 10][lod], ls = [4, 5, 6][lod];
      const limb = (pts, r0, r1) => tube(pts.map((p, j) => { const r = lerp(r0, r1, j / (pts.length - 1)); return [p[0], p[1], p[2], r, r]; }).concat([[...pts[pts.length - 1].map((v, e) => v + (pts[pts.length - 1][e] - pts[pts.length - 2][e]) * 0.2), r1 * 1.08, r1 * 0.9]]), ls, 2);
      const stub = (x, y) => tube([[x, y, 0, 0.06, 0.06], [x * 1.16, y - 0.13, 0.02, 0.054, 0.054]], ls, 2, 0.92);        // what is left of a broken arm
      const head = (y, z = 0) => { if (dmg !== 1) tube([[0, y, z, 0.05, 0.055], [0, y + 0.05, z + 0.004, 0.047, 0.052], [0, y + 0.075, z + 0.012, 0.062, 0.072], [0, y + 0.125, z + 0.014, 0.076, 0.09], [0, y + 0.19, z + 0.006, 0.08, 0.097], [0, y + 0.245, z - 0.004, 0.068, 0.086], [0, y + 0.28, z - 0.01, 0.034, 0.046]], [5, 6, 8][lod], 2); };
      const foot = (x, z0, z1) => tube([[x, 0.03, z0, 0.046, 0.03], [x, 0.03, z1, 0.042, 0.026]], 4, 3);
      if (dmg === 3) {                       // gone: two broken feet and a shin on the plinth
        tube([[-0.1, 0, 0, 0.06, 0.07], [-0.1, 0.1, 0.01, 0.046, 0.05]], ls, 2, 0.9); tube([[0.1, 0, 0.03, 0.06, 0.07], [0.105, 0.2, 0.03, 0.052, 0.056], [0.11, 0.34, 0.035, 0.05, 0.052]], ls, 2, 0.9);
        return 0.36;
      }
      if (kind === 0) {                      // a man in a toga, a scroll in one hand
        tube([[0, 0, 0, 0.25, 0.19], [0, 0.1, 0, 0.235, 0.18], [0.01, 0.55, 0.01, 0.215, 0.165], [0, 0.95, 0, 0.225, 0.16], [0, 1.15, 0, 0.205, 0.15], [0, 1.34, 0.01, 0.235, 0.155], [0, 1.44, 0, 0.245, 0.14], [0, 1.485, 0, 0.19, 0.12], [0, 1.51, 0, 0.1, 0.09], [0, 1.535, 0, 0.052, 0.055]], bs, 3);
        tube([[-0.2, 1.47, 0.07, 0.05, 0.05], [-0.02, 1.2, 0.175, 0.06, 0.05], [0.17, 0.9, 0.15, 0.07, 0.05], [0.25, 0.6, 0.05, 0.06, 0.045]], 5, 3, 0.93);      // the fold of the toga across him
        if (dmg !== 2) limb([[0.25, 1.42, 0], [0.31, 1.15, 0.06], [0.13, 1.22, 0.21]], 0.062, 0.042); else stub(0.25, 1.42);
        limb([[-0.25, 1.42, 0], [-0.3, 1.12, 0.02], [-0.28, 0.86, 0.1]], 0.06, 0.04);
        tube([[-0.28, 0.76, 0.09, 0.027, 0.027], [-0.28, 0.99, 0.17, 0.027, 0.027]], 4, 3, 0.9);
        head(1.535);
      } else if (kind === 1) {               // an athlete, the discus at his side, leaning on the stump every marble copy needs
        tube([[-0.2, 0, -0.08, 0.075, 0.075], [-0.2, 0.56, -0.07, 0.055, 0.055]], 5, 2, 0.85);
        foot(-0.09, -0.05, 0.17); foot(0.145, -0.16, 0.05);
        tube([[-0.09, 0.02, 0, 0.045, 0.05], [-0.095, 0.3, -0.01, 0.06, 0.065], [-0.09, 0.48, 0, 0.05, 0.052], [-0.1, 0.72, 0, 0.083, 0.088], [-0.09, 0.93, 0, 0.09, 0.09]], ls, 0);
        tube([[0.14, 0.02, -0.1, 0.045, 0.05], [0.13, 0.3, -0.06, 0.058, 0.063], [0.11, 0.5, 0.04, 0.05, 0.052], [0.1, 0.74, 0.02, 0.083, 0.088], [0.09, 0.93, 0, 0.09, 0.09]], ls, 0);
        tube([[0, 0.88, 0, 0.17, 0.112], [0.01, 1.02, 0, 0.16, 0.105], [0.015, 1.15, 0, 0.14, 0.1], [0.01, 1.3, 0.01, 0.175, 0.115], [0, 1.43, 0.01, 0.2, 0.115], [0, 1.48, 0.005, 0.165, 0.105], [0, 1.51, 0, 0.095, 0.08], [0, 1.535, 0, 0.052, 0.055]], bs, 3);
        if (dmg !== 2) { limb([[0.21, 1.43, 0], [0.3, 1.19, 0.02], [0.32, 0.98, 0.08]], 0.056, 0.037); tube([[0.325, 0.9, 0.08, 0.115, 0.115], [0.355, 0.9, 0.08, 0.115, 0.115]], lod ? 10 : 6, 3, 0.95); } else stub(0.21, 1.43);
        limb([[-0.21, 1.43, 0], [-0.31, 1.5, 0.1], [-0.25, 1.71, 0.17]], 0.054, 0.036);
        head(1.535);
      } else if (kind === 2) {               // Minerva: helmet with its crest, a spear in one hand, the other on her shield
        tube([[0, 0, 0, 0.24, 0.2], [0, 0.1, 0, 0.22, 0.18], [0, 0.5, 0, 0.19, 0.155], [0, 0.95, 0, 0.195, 0.15], [0, 1.0, 0, 0.2, 0.155], [0, 1.02, 0, 0.218, 0.168], [0, 1.06, 0, 0.198, 0.152], [0, 1.16, 0, 0.15, 0.12], [0, 1.24, 0, 0.165, 0.13], [0, 1.38, 0.01, 0.185, 0.14], [0, 1.46, 0, 0.19, 0.115], [0, 1.51, 0, 0.1, 0.085], [0, 1.54, 0, 0.05, 0.053]], bs, 3);
        head(1.54);
        if (dmg !== 1) tube([[0, 1.74, 0.115, 0.014, 0.05], [0, 1.865, 0.05, 0.014, 0.06], [0, 1.875, -0.06, 0.014, 0.06], [0, 1.76, -0.135, 0.014, 0.05]], 4, 3, 0.92);
        if (dmg !== 2) { limb([[0.2, 1.42, 0], [0.33, 1.3, 0.05], [0.345, 1.52, 0.1]], 0.05, 0.036); tube([[0.35, 0, 0.1, 0.017, 0.017], [0.35, 2.22, 0.1, 0.017, 0.017]], 4, 0, 0.8); tube([[0.35, 2.22, 0.1, 0.032, 0.012], [0.35, 2.42, 0.1, 0.004, 0.004]], 4, 1, 0.8); } else stub(0.2, 1.42);
        limb([[-0.2, 1.42, 0], [-0.3, 1.12, 0.03], [-0.31, 0.76, 0.08]], 0.05, 0.036);
        tube([[-0.3, 0.36, 0.06, 0.31, 0.31], [-0.325, 0.36, 0.085, 0.31, 0.31], [-0.345, 0.36, 0.105, 0.27, 0.27], [-0.375, 0.36, 0.135, 0.1, 0.1], [-0.385, 0.36, 0.145, 0.03, 0.03]], lod ? 14 : 8, 3, 0.95);   // her shield, standing on its rim, with its boss
      } else {                               // a general in armour and cloak, his arm raised to speak, a globe in the other hand
        foot(-0.1, -0.06, 0.16); foot(0.1, -0.03, 0.19);
        tube([[-0.1, 0.02, 0, 0.05, 0.055], [-0.1, 0.32, 0, 0.062, 0.066], [-0.1, 0.5, 0, 0.052, 0.054], [-0.1, 0.75, 0, 0.085, 0.09]], ls, 0);
        tube([[0.1, 0.02, 0.03, 0.05, 0.055], [0.1, 0.32, 0.035, 0.062, 0.066], [0.1, 0.5, 0.03, 0.052, 0.054], [0.1, 0.75, 0.01, 0.085, 0.09]], ls, 0);
        tube([[0, 0.68, 0, 0.215, 0.16], [0, 0.8, 0, 0.2, 0.145], [0, 0.93, 0, 0.185, 0.13]], bs, 1, 0.94);
        tube([[0, 0.93, 0, 0.18, 0.125], [0, 1.1, 0, 0.165, 0.118], [0, 1.3, 0.01, 0.185, 0.125], [0, 1.43, 0.01, 0.215, 0.125], [0, 1.48, 0.005, 0.175, 0.11], [0, 1.51, 0, 0.1, 0.085], [0, 1.535, 0, 0.052, 0.055]], bs, 3);
        tube([[-0.19, 1.47, -0.03, 0.075, 0.05], [-0.25, 1.1, -0.09, 0.085, 0.035], [-0.25, 0.62, -0.11, 0.07, 0.025]], 5, 3, 0.9);    // the cloak, down his back from one shoulder
        if (dmg !== 2) limb([[0.21, 1.43, 0], [0.34, 1.5, 0.12], [0.37, 1.76, 0.22]], 0.058, 0.04); else stub(0.21, 1.43);
        limb([[-0.21, 1.43, 0], [-0.28, 1.15, 0.04], [-0.2, 1.1, 0.25]], 0.056, 0.04);
        tube([[-0.2, 1.1, 0.3, 0.03, 0.03], [-0.2, 1.14, 0.3, 0.062, 0.062], [-0.2, 1.2, 0.3, 0.062, 0.062], [-0.2, 1.245, 0.3, 0.03, 0.03]], 6, 3);
        head(1.535);
      }
      return dmg === 1 ? 1.56 : kind === 2 && dmg !== 2 ? 2.42 : kind === 3 && dmg !== 2 ? 1.9 : 1.82;
    }
    let last = -1;
    // which figure stands at place i of a row, and in what state
    const who = (i, tag) => {
      let kind = Math.floor(hash(i, 81, tag) * KINDS) % KINDS; if (kind === last) kind = (kind + 1 + Math.floor(hash(i, 82, tag) * (KINDS - 1))) % KINDS; last = kind;
      const h = hash(i, 83, tag);
      return { kind, m: hash(i, 84, tag) < 0.5 ? 1 : -1, tone: 0.84 + 0.28 * hash(i, 85, tag), dmg: h < 0.09 ? 3 : h < 0.2 ? 1 : h < 0.29 ? 2 : 0 };
    };
    const put = (s, d, y, k, o, lod = 1) => {
      const top = figure(s, d, y, k, o.kind, o.m, o.tone, o.dmg, lod), [x, z] = ringAt(s, d), r = (o.kind === 2 ? 0.4 : 0.3) * k;
      STATUES.push({ min: [x - r, y, z - r], max: [x + r, y + top * k, z + r] }); bld.count('statues');
    };
    // on the first wall: a pedestal on the coping, midway between two doorways (not where an emperor's box stands in front)
    { const w = SEC.wall1, top = w.y1 + 0.16, dc = (w.d - 0.06 + w.back + 0.04) / 2;
      for (let i = 3; i < NB; i += 4) {
        if ((i >= 17 && i <= 22) || (i >= 57 && i <= 62)) continue;
        const sc = (i + 0.5) * HB, t = 0.86 + 0.2 * hash(i, 86), hw = x => metres(sc, dc, x);
        sh.box('trav', sc - hw(0.34), sc + hw(0.34), dc - 0.25, dc + 0.25, top, top + 0.09, { faces: 'ftlrk', col: t * 0.9 });
        sh.box('trav', sc - hw(0.27), sc + hw(0.27), dc - 0.2, dc + 0.2, top + 0.09, top + 0.5, { faces: 'flrk', col: t, side: t * 0.82, u0: i * 1.3 });
        sh.box('trav', sc - hw(0.32), sc + hw(0.32), dc - 0.24, dc + 0.24, top + 0.5, top + 0.58, { faces: 'ftlrkb', col: t * 1.04 });
        put(sc, dc, top + 0.58, 1.05, who(i, 1), 2);
      } }
    // in the two higher walls: a niche with a round head, dark behind the figure, on a ledge
    function niche(w, i, yb, r, ys, k, tag, lod) {
      const sc = (i + 0.5) * HB, h = metres(sc, w.d, r), fw = metres(sc, w.d, r * 0.22), t = 0.9 + 0.18 * hash(i, 87, tag), K = 8, dF = w.d - 0.07, dD = w.d - 0.012;
      bld.add('dark', [[sc - h, dD, yb], [sc + h, dD, yb], [sc + h, dD, ys], [sc - h, dD, ys]], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], 1, '');
      for (let j = 0; j < K; j++) {
        const a0 = (j / K) * Math.PI, a1 = ((j + 1) / K) * Math.PI, at = (a, e = 1) => [sc + h * e * Math.cos(a), ys + r * e * Math.sin(a)], p0 = at(a0), p1 = at(a1), o0 = at(a0, 1.26), o1 = at(a1, 1.26);
        bld.add('dark', [[p0[0], dD, p0[1]], [p1[0], dD, p1[1]], [sc, dD, ys]], [0, -1, 0], [[0, 0], [1, 0], [0, 1]], 1, '');
        bld.add('trav', [[p0[0], dF, p0[1]], [o0[0], dF, o0[1]], [o1[0], dF, o1[1]], [p1[0], dF, p1[1]]], [0, -1, 0], [[p0[0], p0[1]], [o0[0], o0[1]], [o1[0], o1[1]], [p1[0], p1[1]]], t * (0.94 + 0.12 * hash(i, j, 88)), 'r');
      }
      sh.box('trav', sc - h - fw, sc - h, dF, w.d, yb, ys, { faces: 'flr', col: t, side: t * 0.7, u0: i });
      sh.box('trav', sc + h, sc + h + fw, dF, w.d, yb, ys, { faces: 'flr', col: t, side: t * 0.7, u0: i + 3 });
      sh.box('trav', sc - h - fw * 1.6, sc + h + fw * 1.6, w.d - 0.4, w.d, yb - 0.17, yb, { faces: 'ftlrb', col: t * 1.02, top: t * 1.06 });
      put(sc, w.d - 0.19, yb, k, who(i, tag), lod);
    }
    for (let i = 1; i < NB; i += 4) niche(SEC.wall2, i, SEC.wall2.y0 + 0.42, 0.42, SEC.wall2.y0 + 1.8, 0.86, 2, 1);
    for (let i = 2; i < NB; i += 4) niche(SEC.wall3, i, SEC.wall3.y0 + 1.1, 0.55, SEC.wall3.y0 + 3.0, 1.15, 3, 0);
    // in the colonnade: one between every pair of columns, on a plinth
    { const p = SEC.portico, dc = p.col + 0.3;
      for (let i = 0; i < NB; i++) {
        const sc = (i + 0.5) * HB, t = 0.84 + 0.2 * hash(i, 89), hw = x => metres(sc, dc, x);
        sh.box('trav', sc - hw(0.36), sc + hw(0.36), dc - 0.3, dc + 0.3, p.y, p.y + 0.46, { faces: 'flr', col: t * 0.9, side: t * 0.75, u0: i * 0.7 });
        sh.box('trav', sc - hw(0.4), sc + hw(0.4), dc - 0.34, dc + 0.34, p.y + 0.46, p.y + 0.54, { faces: 'ftlrb', col: t });
        put(sc, dc, p.y + 0.54, 1.2, who(i, 4), 0);
      } }
  }

  /* ------------------------------------------------------------------ repairs
     The arena is under restoration: below, containers and sandbags; up here, two timber scaffolds on the walk against
     the high wall, each under a stretch of lost seats. Poles, ledgers, two plank decks with a guard rail, braces, a
     ladder, and a sheet of canvas hung over the rail. */
  function buildRepairs(bld, sh) {
    const w = SEC.wall3, dF = w.d - 1.0, dB = w.d - 0.16, y0 = w.y0, H = w.y1 - w.y0 + 1.0, lv = [1.8, 3.55];
    for (const i0 of [11, 51]) {
      const sA = i0 * HB + 0.2, sB = (i0 + 2) * HB - 0.2, n = 4, ps = k => lerp(sA, sB, k / n), tw = j => 0.5 + 0.3 * hash(i0, j, 95);
      for (let k = 0; k <= n; k++) for (const [d, back] of [[dF, 0], [dB, 1]]) {            // poles
        const s = ps(k), hw = metres(s, d, 0.04), t = tw(k * 2 + back);
        sh.box('timber', s - hw, s + hw, d - 0.04, d + 0.04, y0, y0 + H - back * 0.6 - 0.35 * hash(i0, k, 96), { faces: 'ftlrk', col: t, side: t * 0.8 });
      }
      for (const [y, j] of [[0.3, 20], [lv[0] - 0.05, 21], [lv[1] - 0.05, 22], [H - 0.8, 23]]) {     // ledgers along the front and the back
        sh.box('timber', sA - 0.18, sB + 0.18, dF - 0.085, dF - 0.04, y0 + y - 0.04, y0 + y + 0.04, { faces: 'ftb', col: tw(j) });
        sh.box('timber', sA - 0.18, sB + 0.18, dB - 0.085, dB - 0.04, y0 + y - 0.04, y0 + y + 0.04, { faces: 'ftb', col: tw(j) * 0.8 });
      }
      for (const [y, j] of [[lv[0], 0], [lv[1], 1]]) {
        for (let k = 0; k <= n; k++) { const s = ps(k), hw = metres(s, dF, 0.035); sh.box('timber', s - hw, s + hw, dF - 0.04, dB + 0.04, y0 + y - 0.045, y0 + y + 0.03, { faces: 'blr', col: 0.45, side: 0.5 }); }   // what the planks lie on
        for (let q = 0; q < 4; q++) { const da = lerp(dF - 0.06, dB + 0.02, q / 4), db = lerp(dF - 0.06, dB + 0.02, (q + 1) / 4) - 0.012, t = 0.62 + 0.3 * hash(i0, q, 97 + j); sh.box('wood', sA - 0.12 - 0.2 * hash(i0, q, 98 + j), sB + 0.12 + 0.2 * hash(i0, q, 99 + j), da, db, y0 + y + 0.03, y0 + y + 0.075, { faces: 'ftblr', col: t, top: t * 1.05, ku: 1, u0: q * 0.37 }); }   // planks
        sh.box('timber', sA - 0.05, sB + 0.05, dF - 0.085, dF - 0.045, y0 + y + 1.0, y0 + y + 1.07, { faces: 'ftb', col: tw(30 + j) });                                                                    // guard rail
      }
      for (let k = 0; k < n; k++) {                                                             // braces across the front, leaning alternate ways
        const up = k % 2 === 0, s0 = ps(k), s1 = ps(k + 1), ya = y0 + (up ? 0.3 : lv[0] - 0.05), yb = y0 + (up ? lv[0] - 0.05 : 0.3), t = tw(40 + k), d = dF - 0.09;
        bld.add('timber', [[s0, d, ya - 0.04], [s1, d, yb - 0.04], [s1, d, yb + 0.04], [s0, d, ya + 0.04]], [0, -1, 0], [[0, 0], [2, 0], [2, 0.08], [0, 0.08]], t, 'r');
      }
      { const sl = sB - 0.75, hw = metres(sl, dF, 0.2), rw = metres(sl, dF, 0.025);              // the ladder up to the first deck
        for (const e of [-1, 1]) sh.box('timber', sl + e * hw - rw, sl + e * hw + rw, dF - 0.15, dF - 0.1, y0, y0 + lv[0] + 0.95, { faces: 'ftlr', col: 0.62 });
        for (let q = 1; q < 9; q++) sh.box('timber', sl - hw, sl + hw, dF - 0.14, dF - 0.11, y0 + q * 0.3, y0 + q * 0.3 + 0.035, { faces: 'ftb', col: 0.58 });
      }
      { const a = ps(1) + 0.15, b2 = ps(2) + 0.35, yt = y0 + lv[1] + 1.07, d = dF - 0.1;       // canvas over the upper rail
        for (let q = 0; q < 4; q++) { const ya = lerp(yt, yt - 1.5, q / 4), yb = lerp(yt, yt - 1.5, (q + 1) / 4), da = d - 0.04 * Math.sin(q * 1.7 + i0), db = d - 0.04 * Math.sin((q + 1) * 1.7 + i0); bld.add('canvas', [[a, da, ya], [b2, da, ya], [b2, db, yb], [a, db, yb]], [0, -1, 0], [[0, ya], [1.4, ya], [1.4, yb], [0, yb]], 0.8 + 0.12 * (q % 2), 'r'); }
      }
      bld.count('scaffolds');
    }
  }

  /* ------------------------------------------------------------------ the top: colonnade, roof, attic wall and masts */
  function buildTop(bld, sh) {
    const { strip, box, turned } = sh, p = SEC.portico, at = SEC.attic, perim = d => L + TAU * d, ku = Math.round(perim(p.d1) / 4.8) * 4.8 / L;
    for (let i = 0; i < NB; i++) {
      const s0 = i * HB, s1 = s0 + HB, t = 0.84 + 0.2 * hash(i, 70);
      // floor of the colonnade and the wall at its back, with a dark doorway now and then
      strip('ashlar', s0, s1, p.d0, p.y, p.d1, p.y, { ku, vA: 0, vB: p.d1 - p.d0, cA: t * 0.8, cB: t * 0.3 });
      strip('ashlar', s0, s1, p.d1 - 0.3, p.y, p.d1 - 0.3, p.beam, { ku, vA: 0, vB: p.beam - p.y, cA: t * 0.34, cB: t * 0.22 });
      // beam over the columns, its underside, and the tiled roof up to the attic wall
      box('trav', s0, s1, p.col - 0.42, p.col + 0.42, p.y + p.colH, p.beam, { faces: 'fb', col: t * 0.98, ku, u0: 2 });
      strip('trav', s0, s1, p.col - 0.5, p.beam, p.col - 0.5, p.beam + 0.18, { ku, cA: t * 0.8, cB: t * 1.05 });
      strip('trav', s0, s1, p.col - 0.42, p.beam, p.col - 0.5, p.beam, { ku, col: t * 0.5 });
      strip('tile', s0, s1, p.col - 0.5, p.beam + 0.18, p.d1, p.roof, { ku: 1, vA: 5.3, vB: 0, cA: 0.95 * t, cB: 0.8 * t });
      strip('timber', s0, s1, p.d1 - 0.3, p.beam, p.col + 0.42, p.beam, { ku: 1, vA: 0, vB: 4, col: 0.35 });            // the ceiling, in shade
      // attic wall above the roof, its top and coping
      strip('ashlar', s0, s1, at.d0, p.roof, at.d0, at.y, { ku, vA: 0.6, vB: 0.6 + at.y - p.roof, cA: t * 0.75, cB: t });
      box('trav', s0, s1, at.d0 - 0.08, at.d1, at.y, at.y + 0.22, { faces: 'ftb', col: t * 1.04, top: t * 1.0, ku });
      // column on the bay line: plinth, base, shaft with a slight swell, capital, abacus
      const y = p.y, r = 0.36, ct = 0.86 + 0.22 * hash(i, 71);
      const hw = metres(s0, p.col, 0.5);
      box('trav', s0 - hw, s0 + hw, p.col - 0.5, p.col + 0.5, y, y + 0.22, { faces: 'ftlr', col: ct * 0.9 });
      turned('trav', s0, p.col, [[r * 1.3, y + 0.22], [r * 1.34, y + 0.3], [r * 1.12, y + 0.38], [r * 1.18, y + 0.46], [r, y + 0.54], [r * 1.01, y + 1.9], [r * 0.86, y + p.colH - 0.5], [r * 0.9, y + p.colH - 0.44], [r * 1.25, y + p.colH - 0.16]], 10, { col: ct, u0: i });
      box('trav', s0 - hw, s0 + hw, p.col - 0.5, p.col + 0.5, y + p.colH - 0.16, y + p.colH, { faces: 'flrb', col: ct * 0.95 });
      bld.count('columns');
      // three masts to a bay on the outer wall, each with a bronze foot
      for (let m = 0; m < 3; m++) {
        const sm = s0 + ((m + 0.5) / 3) * HB, hwm = metres(sm, at.d1, 0.13), top = at.mast + (hash(i, 72, m) - 0.5) * 0.5;
        box('timber', sm - hwm, sm + hwm, at.d1 - 0.36, at.d1 - 0.1, at.y + 0.2, top, { faces: 'ftlrk', col: 0.55 + 0.25 * hash(i, 73, m), shadow: 'c' });
        box('bronze', sm - hwm * 1.5, sm + hwm * 1.5, at.d1 - 0.4, at.d1 - 0.06, at.y + 0.22, at.y + 0.5, { faces: 'ftlr', col: 0.9 });
        bld.count('masts');
      }
    }
  }

  /* Stand-ins that only cast shadows: the stands as a few smooth strips set a little inside the stone, the roof and
     the outer wall. The sun sees these instead of forty thousand seat faces.                                         */
  function buildProxies(bld, sh) {
    const lines = [], t = SEC.terrace, tEnd = t.d1 + t.rows * t.tread, tTop = t.y + t.rows * t.rise;
    lines.push([[0.5, t.y - 0.25], [tEnd + 0.1, tTop - 0.25]]);
    for (const [w, b] of [[SEC.wall1, SEC.band1], [SEC.wall2, SEC.band2], [SEC.wall3, SEC.band3]]) {
      lines.push([[w.d + 0.12, w.y0 - 0.3], [w.d + 0.12, w.y1 - 0.1]], [[w.d + 0.12, w.y1 - 0.1], [w.back - 0.1, w.y1 - 0.1]]);
      lines.push([[b.d + 0.2, b.y - 0.25], [b.d + b.rows * b.tread, b.y + b.rows * b.rise - 0.25]]);
    }
    const p = SEC.portico, at = SEC.attic;
    lines.push([[p.col - 0.4, p.beam - 0.5], [p.col - 0.4, p.beam + 0.1]], [[p.col - 0.4, p.beam + 0.1], [p.d1, p.roof - 0.12]], [[at.d0 + 0.1, p.roof - 0.2], [at.d0 + 0.1, at.y]], [[at.d0 + 0.1, at.y], [at.d1 - 0.1, at.y]], [[at.d1 - 0.1, at.y], [at.d1 - 0.1, 0]]);
    for (let i = 0; i < NB; i++) for (const [a, b] of lines) sh.strip('proxy', i * HB, (i + 1) * HB, a[0], a[1], b[0], b[1], { shadow: 'c' });
  }

  /* ------------------------------------------------------------------ the arena floor: sand, a little uneven, darker where it holds water */
  function buildFloor(bld, puddles = [], fires = []) {
    const RINGS = 34, AROUND = 180;
    const at = (r, k) => { const t = (k / AROUND) * TAU, rr = r / RINGS; return [CX + (A + 0.02) * rr * Math.cos(t), (B + 0.02) * rr * Math.sin(t)]; };
    const vtx = (r, k) => {
      const [x, z] = at(r, k), edge = r / RINGS, wet = fbm2(x * 0.11 + 3, z * 0.11 + 9), y = 0.012 * (fbm2(x * 0.35, z * 0.35) - 0.5) * (1 - smooth(0.9, 1, edge));
      let tone = (0.80 + 0.34 * fbm2(x * 0.06 + 40, z * 0.06 + 11)) * (1 - 0.3 * smooth(0.5, 0.75, wet)) * (1 - 0.32 * smooth(0.93, 1, edge));
      // two ruts worn by carts between the gates, wandering a little, and darker sand round each pool
      const wander = 1.6 * Math.sin((x - CX) * 0.09) + 0.5 * Math.sin((x - CX) * 0.31), rut = Math.min(Math.abs(z - wander - 0.72), Math.abs(z - wander + 0.72));
      tone *= 1 - 0.2 * smooth(0.22, 0.05, rut) * (0.5 + 0.5 * noise2(x * 0.7, 3.3));
      for (const p of puddles) { const d = Math.hypot(x - p.x, z - p.z) / p.r; if (d < 1.7) tone *= 1 - 0.36 * smooth(1.7, 0.6, d); }
      for (const f of fires) { const d = Math.hypot(x - f.x, z - f.z); if (d < 1.3) tone *= 1 - 0.5 * smooth(1.3, 0.25, d); }       // soot and ash trodden round each brazier
      return { p: [x, y, z], c: [tone * 1.02, tone, tone * 0.96], uv: [x, z] };
    };
    for (let r = 0; r < RINGS; r++) for (let k = 0; k < AROUND; k++) {
      const q = [vtx(r, k), vtx(r, k + 1), vtx(r + 1, k + 1), vtx(r + 1, k)], sector = 'f' + Math.floor(k / (AROUND / 4));
      if (r === 0) bld.addW('sand', [q[0].p, q[2].p, q[3].p], [0, 1, 0], [q[0].uv, q[2].uv, q[3].uv], [q[0].c, q[2].c, q[3].c], 'r', sector);
      else bld.addW('sand', q.map(v => v.p), [0, 1, 0], q.map(v => v.uv), q.map(v => v.c), 'r', sector);
    }
  }

  /* ------------------------------------------------------------------ the awning
     The velarium is being re-rigged: drawn out over the north stands, still furled along the rest of the rim. Drawn
     panels belly between their ropes and end in a scalloped edge, whose shadow falls across the seats below.
     Furled canvas is a fat roll lashed to the masts, sagging between lashings.                                      */
  function buildAwning(bld, sh) {
    const { add } = bld, at = SEC.attic, rimD = at.d1 - 0.25, rimY = at.mast - 0.7, IN_D = 20, IN_Y = 30.5, FIRST = 12, LAST = 27;
    const drawn = i => i >= FIRST && i <= LAST;
    const U = 8, V = 4;
    const pt = (i, u, v) => {
      const s = (i + v) * HB, belly = Math.sin(Math.PI * v), d = lerp(rimD, IN_D + 3.2 * belly, u), y = lerp(rimY, IN_Y, u) - Math.sin(Math.PI * u) * (1.3 + 1.6 * belly) + 0.5 * belly * u;
      return [s, d, y];
    };
    for (let i = FIRST; i <= LAST; i++) {
      const tone = 0.86 + 0.2 * hash(i, 100);
      for (let a = 0; a < U; a++) for (let b = 0; b < V; b++) {
        const q = [pt(i, a / U, b / V), pt(i, a / U, (b + 1) / V), pt(i, (a + 1) / U, (b + 1) / V), pt(i, (a + 1) / U, b / V)];
        // the cloth's own normal, from its two edges, so the bellies shade as bellies
        const e1 = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]], e2 = [q[3][0] - q[0][0], q[3][1] - q[0][1], q[3][2] - q[0][2]];
        let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const nl = Math.hypot(...n) || 1; n = n.map(v => v / nl); if (n[2] < 0) n = n.map(v => -v);
        const stripe = 0.9 + 0.1 * Math.cos((a / U) * Math.PI * 9), seam = b === 0 || b === V - 1 ? 0.9 : 1;
        add('canvasLit', q, n, q.map(p => [p[0], p[1] * 0.5]), tone * stripe * seam, 'c');
      }
      bld.count('awningPanels');
    }
    // the ropes the panels hang from, and the rope along their inner edge
    for (let i = FIRST; i <= LAST + 1; i++) for (let a = 0; a < U; a++) {
      const p0 = pt(i, a / U, 0), p1 = pt(i, (a + 1) / U, 0), w = metres(p0[0], p0[1], 0.07);
      add('rope', [[p0[0] - w, p0[1], p0[2] + 0.06], [p0[0] + w, p0[1], p0[2] + 0.06], [p1[0] + w, p1[1], p1[2] + 0.06], [p1[0] - w, p1[1], p1[2] + 0.06]], [0, 0, 1], [[0, 0], [0.14, 0], [0.14, 2], [0, 2]], 0.8, '');
      add('rope', [[p0[0] - w, p0[1], p0[2] - 0.06], [p0[0] + w, p0[1], p0[2] - 0.06], [p1[0] + w, p1[1], p1[2] - 0.06], [p1[0] - w, p1[1], p1[2] - 0.06]], [0, 0, -1], [[0, 0], [0.14, 0], [0.14, 2], [0, 2]], 0.45, '');
    }
    // furled canvas round the rest of the rim: three rolls to a bay, mast to mast
    const SIDES = 6, R = 0.34;
    for (let i = 0; i < NB; i++) {
      if (drawn(i)) continue;
      for (let m = 0; m < 3; m++) {
        const tone = 0.7 + 0.3 * hash(i, 101, m);
        for (let k = 0; k < 3; k++) {
          const t0 = k / 3, t1 = (k + 1) / 3, at2 = t => { const s = (i + (m + t) / 3) * HB, sag = 0.34 * Math.sin(Math.PI * t), fat = R * (0.72 + 0.28 * Math.sin(Math.PI * t)); return { s, d: at.d0 + 0.42, y: at.y + 0.72 - sag, fat }; };
          const A0 = at2(t0), A1 = at2(t1);
          for (let c = 0; c < SIDES; c++) {
            const a0 = (c / SIDES) * TAU, a1 = ((c + 1) / SIDES) * TAU, ring = (P, ang) => [P.s, P.d + Math.cos(ang) * P.fat, P.y + Math.sin(ang) * P.fat], nn = ang => [0, Math.cos(ang), Math.sin(ang)];
            add('canvas', [ring(A0, a0), ring(A1, a0), ring(A1, a1), ring(A0, a1)], [nn(a0), nn(a0), nn(a1), nn(a1)], [[t0, a0], [t1, a0], [t1, a1], [t0, a1]], tone * (0.8 + 0.2 * Math.sin(a0 * 3 + i)), 'c');
          }
        }
      }
      bld.count('furledBays');
    }
  }

  /* ------------------------------------------------------------------ the Roman kit
     What an arena held: shields and arms on racks, amphorae, braziers, trophies of captured arms, the standards, a cart,
     a beast cage, training posts, the trapdoors and capstan of the lifts under the floor, and stone from the building
     itself. All made here from a few pieces (box, pole, turned shape, flat plate), in world space, with their own collision.
     at(x, z, yaw, y, lean) gives a place to build in: x to the right, y up, z toward you; lean tips it back.            */
  function romanKit(G, bld, ph, placed, seeded) {
    const jit = k => (seeded() - 0.5) * k, fires = [], puddles = [];
    const quadrant = () => 'p';        // one mesh per material: what stands on the sand is in view from almost anywhere
    const at = (x, z, yaw = 0, y = 0, lean = 0) => {
      const c = Math.cos(yaw), s = Math.sin(yaw), cl = Math.cos(lean), sl = Math.sin(lean), tilt = (ly, lz) => [ly * cl - lz * sl, ly * sl + lz * cl];
      return { x, z, yaw, y, sec: quadrant(x, z),
        P: (lx, ly, lz) => { const [ty, tz] = tilt(ly, lz); return [CX + x + lx * c + tz * s, y + ty, z - lx * s + tz * c]; },
        N: (nx, ny, nz) => { const [ty, tz] = tilt(ny, nz); return [nx * c + tz * s, ty, -nx * s + tz * c]; } };
    };
    const quad = (f, mat, pts, n, col = 1, uv = null, sh = 'cr') => bld.addW(mat, pts.map(p => f.P(...p)), Array.isArray(n[0]) ? n.map(v => f.N(...v)) : f.N(...n), uv || pts.map((p, i) => [[0, 0], [1, 0], [1, 1], [0, 1]][i % 4]), col, sh, f.sec);
    /* Collision, three kinds, so that what stops you is what you see:
         solid  stops people and shots: a thing with no gaps in it
         fence  stops people only: an open frame you cannot walk through but can shoot through (a rack of spears, cage bars)
         hit    stops shots only: the solid part inside an open frame (a brazier's bowl, a cart's bed)
       A shot must never stop on empty air: its mark would hang there. */
    const boxAt = (x, z, hx, hz, h, y0, opts) => ph.addBox([CX + x - hx, y0, z - hz], [CX + x + hx, h, z + hz], opts);
    const solid = (x, z, hx, hz, h, surface = 'wood', y0 = 0) => boxAt(x, z, hx, hz, h, y0, { surface });
    const fence = (x, z, hx, hz, h, y0 = 0) => boxAt(x, z, hx, hz, h, y0, { surface: 'wood', playerOnly: true });
    const hit = (x, z, hx, hz, h, y0 = 0, surface = 'wood') => boxAt(x, z, hx, hz, h, y0, { surface, bulletOnly: true });
    // a box that does not stand square to the map: tile it with small boxes that follow its outline, so nothing solid sticks out past what you see
    function oriented(kind, x, z, yaw, hx, hz, h, y0 = 0, surface = 'wood') {
      const opts = kind === 'fence' ? { surface, playerOnly: true } : kind === 'hit' ? { surface, bulletOnly: true } : { surface };
      if (Math.abs(Math.sin(2 * yaw)) < 0.06) { const [ax, az] = span(yaw, hx, hz); boxAt(x, z, ax, az, h, y0, opts); return; }
      const cell = Math.min(0.24, hx, hz), nx = Math.max(1, Math.round(hx / cell)), nz = Math.max(1, Math.round(hz / cell)), c = Math.cos(yaw), sn = Math.sin(yaw), half = Math.max(hx / nx, hz / nz) * (Math.abs(c) + Math.abs(sn)) * 0.72;
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { const lx = -hx + (2 * i + 1) * hx / nx, lz = -hz + (2 * j + 1) * hz / nz; boxAt(x + lx * c + lz * sn, z - lx * sn + lz * c, half, half, h, y0, opts); }
    }
    // a point given in a thing's own frame, on the plan
    const local = (x, z, yaw, lx, lz) => [x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
    // the box a turned thing fills on the plan
    const span = (yaw, hx, hz) => [Math.abs(Math.cos(yaw)) * hx + Math.abs(Math.sin(yaw)) * hz, Math.abs(Math.sin(yaw)) * hx + Math.abs(Math.cos(yaw)) * hz];
    const note = (name, x, z, yaw) => placed.push({ name, x: CX + x, y: 0, z, yaw });

    function box(f, mat, c, h, col = 1, o = {}) {
      const [cx, cy, cz] = c, [hx, hy, hz] = h, uo = seeded() * 7, vo = seeded() * 7, C = C3(col);
      const F = [[[1, 0, 0], [0, 0, -1], [0, 1, 0], hx, hz, hy, 0.86], [[-1, 0, 0], [0, 0, 1], [0, 1, 0], hx, hz, hy, 0.8], [[0, 0, 1], [1, 0, 0], [0, 1, 0], hz, hx, hy, 0.93], [[0, 0, -1], [-1, 0, 0], [0, 1, 0], hz, hx, hy, 0.76], [[0, 1, 0], [1, 0, 0], [0, 0, -1], hy, hx, hz, 1.05], [[0, -1, 0], [1, 0, 0], [0, 0, 1], hy, hx, hz, 0.5]];
      for (const [n, u, v, hn, hu, hv, shade] of F) {
        if (n[1] < 0 && !o.bottom) continue;
        const p = (a, b) => [cx + n[0] * hn + u[0] * a + v[0] * b, cy + n[1] * hn + u[1] * a + v[1] * b, cz + n[2] * hn + u[2] * a + v[2] * b];
        quad(f, mat, [p(-hu, -hv), p(hu, -hv), p(hu, hv), p(-hu, hv)], n, C.map(k => k * shade), [[uo - hu, vo - hv], [uo + hu, vo - hv], [uo + hu, vo + hv], [uo - hu, vo + hv]], o.shadow || 'cr');
      }
    }
    // a frame of three unit vectors with the first along dir
    function basis(dir) {
      const up = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      let s = [dir[1] * up[2] - dir[2] * up[1], dir[2] * up[0] - dir[0] * up[2], dir[0] * up[1] - dir[1] * up[0]]; const l = Math.hypot(...s); s = s.map(v => v / l);
      return [s, [s[1] * dir[2] - s[2] * dir[1], s[2] * dir[0] - s[0] * dir[2], s[0] * dir[1] - s[1] * dir[0]]];
    }
    // a turned shape about the axis from a along dir: profile is [radius, distance along the axis, shade] from one end to the other.
    // It is closed with a disc at each end that is not already a point, so it is solid from every side
    function turn(f, mat, a, profile, sides, col = 1, o = {}) {
      let dir = o.dir || [0, 1, 0]; const dl = Math.hypot(...dir); dir = dir.map(v => v / dl);
      const [s, t] = basis(dir), C = C3(col), uo = seeded() * 5, flute = o.flute || 0;
      const rad = ang => [s[0] * Math.cos(ang) + t[0] * Math.sin(ang), s[1] * Math.cos(ang) + t[1] * Math.sin(ang), s[2] * Math.cos(ang) + t[2] * Math.sin(ang)];
      const pt = (r, d, ang) => { const q = rad(ang); return [a[0] + dir[0] * d + q[0] * r, a[1] + dir[1] * d + q[1] * r, a[2] + dir[2] * d + q[2] * r]; };
      for (let k = 0; k + 1 < profile.length; k++) {
        const [r0, d0] = profile[k], [r1, d1] = profile[k + 1], len = Math.hypot(r1 - r0, d1 - d0) || 1, nr = (d1 - d0) / len, nd = (r0 - r1) / len;
        for (let i = 0; i < sides; i++) {
          const a0 = (i / sides) * TAU, a1 = ((i + 1) / sides) * TAU, nm = ang => { const q = rad(ang); return [q[0] * nr + dir[0] * nd, q[1] * nr + dir[1] * nd, q[2] * nr + dir[2] * nd]; };
          const shade = flute ? 1 - flute * (i % 2) : 1;      // every other face darker: reads as fluting on a column
          quad(f, mat, [pt(r0, d0, a0), pt(r0, d0, a1), pt(r1, d1, a1), pt(r1, d1, a0)], flute ? nm((a0 + a1) / 2) : [nm(a0), nm(a1), nm(a1), nm(a0)], C.map(v => v * shade * (profile[k][2] ?? 1)), [[uo + a0 * r0, d0], [uo + a1 * r0, d0], [uo + a1 * r1, d1], [uo + a0 * r1, d1]], o.shadow || 'cr');
        }
      }
      if (o.open) return;
      for (const [end, sign] of [[profile[0], -1], [profile[profile.length - 1], 1]]) {
        if (end[0] < 1e-4) continue;
        const c = [a[0] + dir[0] * end[1], a[1] + dir[1] * end[1], a[2] + dir[2] * end[1]], n = dir.map(v => v * sign), shade = (end[2] ?? 1) * (o.capShade ?? 0.8);
        for (let i = 0; i < sides; i++) { const a0 = (i / sides) * TAU, a1 = ((i + 1) / sides) * TAU; quad(f, mat, [c, pt(end[0], end[1], a0), pt(end[0], end[1], a1)], n, C.map(v => v * shade), [[uo, 0], [uo + end[0], 0], [uo, end[0]]], o.shadow || 'cr'); }
      }
    }
    // a pole or beam between two points; w1 lets it taper (to a point for a spear head)
    function pole(f, mat, a, b, w, col = 1, sides = 4, w1 = w, sh = 'cr') {
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(...d) || 1;
      const k = sides === 4 ? Math.SQRT1_2 * 1.0 : 0.5;
      turn(f, mat, a, [[0, 0], [w * k, 0], [w1 * k, len], [0, len]], sides, col, { dir: d, shadow: sh, flute: sides === 4 ? 0.0001 : 0 });      // closed at both ends
    }
    // a flat plate cut to a shape: pts are [x, y] in the plate's own plane, at local z, facing +z, seen from both sides
    function plate(f, mat, pts, z, col = 1, o = {}) {
      const uv = pts.map(p => [p[0] * (o.us ?? 1) + (o.u0 ?? 0), p[1] * (o.vs ?? 1) + (o.v0 ?? 0)]), back = o.back ?? col;
      quad(f, mat, pts.map(p => [p[0], p[1], z]), [0, 0, 1], col, uv, o.shadow || 'cr');
      const thick = o.thick ?? 0.012;
      if (o.back !== false) quad(f, o.backMat || mat, pts.map(p => [p[0], p[1], z - thick]), [0, 0, -1], back, uv, o.shadow || 'cr');
      if (thick >= 0.03) for (let i = 0; i < pts.length; i++) {           // thick enough to see edge-on: close the edges
        const a = pts[i], b = pts[(i + 1) % pts.length], ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1;
        let cx = 0, cy = 0; for (const q of pts) { cx += q[0] / pts.length; cy += q[1] / pts.length; }
        let nx = ey / l, ny = -ex / l; if (nx * ((a[0] + b[0]) / 2 - cx) + ny * ((a[1] + b[1]) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
        quad(f, o.backMat || mat, [[a[0], a[1], z], [b[0], b[1], z], [b[0], b[1], z - thick], [a[0], a[1], z - thick]], [nx, ny, 0], C3(back).map(v => v * 0.8), null, o.shadow || 'cr');
      }
    }

    /* ---- the things ---- */
    // an amphora: the long wine jar with a spike foot and two handles. tip is where its foot stands, dir the way it points
    // a jar standing or leaning on its own on the sand
    function looseAmphora(x, z, lean, tone = 0.9) {
      amphora(at(x, z), [0, 0.02, 0], [lean[0], 1, lean[1]], tone);
      solid(x + lean[0] * 0.42, z + lean[1] * 0.42, 0.21 + Math.abs(lean[0]) * 0.3, 0.21 + Math.abs(lean[1]) * 0.3, 0.9, 'concrete'); note('amphora', x, z, 0);
    }
    function amphora(f, foot, dir = [0, 1, 0], tone = 1) {
      const c = [tone * (0.9 + jit(0.25)), tone * (0.86 + jit(0.2)), tone * 0.82];
      turn(f, 'clay', foot, [[0.02, 0], [0.05, 0.05], [0.17, 0.28], [0.22, 0.46], [0.2, 0.62], [0.11, 0.74], [0.07, 0.8], [0.065, 0.9], [0.09, 0.93], [0.085, 0.96], [0.05, 0.955], [0.045, 0.9, 0.2]], 10, c, { dir, capShade: 0.12 });
      const dl = Math.hypot(...dir), d = dir.map(v => v / dl), [s] = basis(d), p = (side, along, out) => [foot[0] + d[0] * along + s[0] * side * out, foot[1] + d[1] * along + s[1] * side * out, foot[2] + d[2] * along + s[2] * side * out];
      for (const side of [-1, 1]) { pole(f, 'clay', p(side, 0.72, 0.12), p(side, 0.82, 0.2), 0.035, c, 4); pole(f, 'clay', p(side, 0.82, 0.2), p(side, 0.9, 0.07), 0.035, c, 4); }
    }
    function amphoraRack(x, z, yaw) {
      const f = at(x, z, yaw), n = 5;
      for (const e of [-0.95, 0.95]) for (const d of [-0.2, 0.2]) pole(f, 'timber', [e, 0, d], [e, 0.62, d], 0.07, 0.8);
      for (const d of [-0.2, 0.2]) for (const y of [0.22, 0.6]) pole(f, 'timber', [-1, y, d], [1, y, d], 0.06, 0.75 + jit(0.2));
      for (const e of [-0.95, 0.95]) pole(f, 'timber', [e, 0.6, -0.2], [e, 0.6, 0.2], 0.06, 0.7);
      for (let i = 0; i < n; i++) amphora(f, [-0.76 + i * 0.38, 0.04, jit(0.05)], [jit(0.1), 1, jit(0.12)], 0.9 + jit(0.25));
      amphora(f, [0.5, 0.22, 0.42], [0.9, 0.05, 0.3], 0.8);                                   // one lying in front
      oriented('solid', x, z, yaw, 0.98, 0.24, 0.97, 0, 'concrete'); note('amphorae', x, z, yaw);
    }
    // a scutum: the legionary's curved shield, red with a bronze boss. Stands on its edge at foot, leaning back by lean
    function scutum(x, z, yaw, lean, y = 0) {
      const f = at(x, z, yaw, y, lean), W = 0.66, H = 1.08, SEG = 6, R = 0.62, half = Math.asin(W / 2 / R), tn = 0.85 + jit(0.3);
      for (let k = 0; k < SEG; k++) {
        const a0 = -half + (k / SEG) * 2 * half, a1 = -half + ((k + 1) / SEG) * 2 * half, p = (a, yy, off = 0) => [Math.sin(a) * (R + off), yy, Math.cos(a) * (R + off) - R], n = a => [Math.sin(a), 0, Math.cos(a)];
        quad(f, 'shield', [p(a0, 0), p(a1, 0), p(a1, H), p(a0, H)], [n(a0), n(a1), n(a1), n(a0)], tn, [[k / SEG, 0], [(k + 1) / SEG, 0], [(k + 1) / SEG, 1], [k / SEG, 1]]);
        quad(f, 'timber', [p(a0, 0, -0.02), p(a1, 0, -0.02), p(a1, H, -0.02), p(a0, H, -0.02)], [n(a0).map(v => -v), n(a1).map(v => -v), n(a1).map(v => -v), n(a0).map(v => -v)], 0.6);
      }
      turn(f, 'bronze', [0, H / 2, 0], [[0.115, 0, 0.8], [0.1, 0.02], [0.085, 0.06], [0.05, 0.095], [0, 0.11, 1.2]], 10, 1.05, { dir: [0, 0, 1] });
    }
    // spear or trident: shaft, iron head. a is the butt on the ground, b the tip
    function spear(f, a, b, kind = 'pilum') {
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(...d), u = d.map(v => v / len), p = t => [a[0] + u[0] * t, a[1] + u[1] * t, a[2] + u[2] * t];
      pole(f, 'timber', a, p(len - 0.42), 0.036, 0.9 + jit(0.2), 5);
      if (kind === 'trident') {
        const [s] = basis(u), o = (t, k) => { const q = p(t); return [q[0] + s[0] * k, q[1] + s[1] * k, q[2] + s[2] * k]; };
        pole(f, 'iron', p(len - 0.42), p(len - 0.3), 0.03, 0.9, 5); pole(f, 'iron', o(len - 0.3, -0.1), o(len - 0.3, 0.1), 0.026, 0.9, 4);
        for (const k of [-0.1, 0, 0.1]) pole(f, 'iron', o(len - 0.3, k), o(len, k), 0.024, 1, 4, 0.004);
      } else { pole(f, 'iron', p(len - 0.42), p(len - 0.09), 0.02, 0.85, 5, 0.014); pole(f, 'iron', p(len - 0.1), p(len), 0.05, 1.0, 4, 0.004); }
    }
    // a helmet: bowl, neck guard, cheek pieces and a red crest
    function helmet(f, c, tone = 1) {
      turn(f, 'bronze', [c[0], c[1], c[2]], [[0.115, 0, 0.8], [0.118, 0.07], [0.1, 0.14], [0.06, 0.185], [0, 0.2, 1.15]], 10, tone);
      quad(f, 'bronze', [[c[0] - 0.12, c[1], c[2] - 0.1], [c[0] + 0.12, c[1], c[2] - 0.1], [c[0] + 0.15, c[1] - 0.03, c[2] - 0.2], [c[0] - 0.15, c[1] - 0.03, c[2] - 0.2]], [0, 0.9, -0.3], tone * 0.8);
      box(f, 'shieldRed', [c[0], c[1] + 0.25, c[2]], [0.012, 0.06, 0.14], [0.9, 0.2, 0.15]);
    }
    // a rack of spears and tridents between two end boards, helmets on top. Stands square to the map (yaw in quarter turns) so its boxes fit it
    function weaponRack(x, z, yaw) {
      const f = at(x, z, yaw), BOARD = [[-0.3, 0], [0.3, 0], [0.07, 1.75], [-0.07, 1.75]];
      for (const e of [-0.8, 0.8]) { const [bx, bz] = local(x, z, yaw, e + 0.03, 0); plate(at(bx, bz, yaw + Math.PI / 2), 'timber', BOARD, 0, 0.78 + jit(0.1), { thick: 0.06, back: 0.7 }); }
      pole(f, 'timber', [-0.9, 1.72, 0], [0.9, 1.72, 0], 0.08, 0.8); pole(f, 'timber', [-0.8, 0.6, 0.17], [0.8, 0.6, 0.17], 0.06, 0.7); pole(f, 'timber', [-0.8, 0.6, -0.17], [0.8, 0.6, -0.17], 0.06, 0.7);
      for (let i = 0; i < 6; i++) spear(f, [-0.62 + i * 0.25 + jit(0.04), 0, 0.38 + jit(0.05)], [-0.62 + i * 0.25 + jit(0.05), 2.05 + jit(0.2), 0.05], i % 3 === 1 ? 'trident' : 'pilum');
      helmet(f, [-0.8, 1.79, 0], 0.95); helmet(f, [0.8, 1.79, 0], 1.05);
      const [hx, hz] = span(yaw, 0.9, 0.42); fence(x, z, hx, hz, 1.8);
      // what a shot stops on: the two end boards (narrowing as they rise), the rails, the helmets
      for (const e of [-0.8, 0.8]) {
        const [bx, bz] = local(x, z, yaw, e, 0);
        for (const [y0, y1, half] of [[0, 0.6, 0.27], [0.6, 1.2, 0.19], [1.2, 1.75, 0.11]]) { const [ax, az] = span(yaw, 0.035, half); hit(bx, bz, ax, az, y1, y0); }
        const [ax, az] = span(yaw, 0.12, 0.12); hit(bx, bz, ax, az, 2.0, 1.79, 'metal');
      }
      { const [ax, az] = span(yaw, 0.9, 0.04); hit(x, z, ax, az, 1.76, 1.68); }
      for (const d of [-0.17, 0.17]) { const [rx, rz] = local(x, z, yaw, 0, d), [ax, az] = span(yaw, 0.8, 0.03); hit(rx, rz, ax, az, 0.63, 0.57); }
      note('weapon rack', x, z, yaw);
    }
    function shieldRack(x, z, yaw) {
      const f = at(x, z, yaw);
      for (const e of [-1.35, 1.35]) { pole(f, 'timber', [e, 0, -0.25], [e, 1.0, -0.25], 0.09, 0.8); pole(f, 'timber', [e, 0, -0.25], [e, 0, 0.3], 0.08, 0.7); pole(f, 'timber', [e, 0.75, -0.25], [e, 0.08, 0.26], 0.06, 0.75); }
      pole(f, 'timber', [-1.45, 0.98, -0.25], [1.45, 0.98, -0.25], 0.08, 0.8); pole(f, 'timber', [-1.4, 0.4, -0.2], [1.4, 0.4, -0.2], 0.06, 0.72);
      const c = Math.cos(yaw), s = Math.sin(yaw);
      for (let i = 0; i < 4; i++) { const lx = -1.0 + i * 0.67 + jit(0.04), lz = 0.16; scutum(x + lx * c + lz * s, z - lx * s + lz * c, yaw + jit(0.08), -0.3 + jit(0.06), 0.02); }
      spear(f, [-1.5, 0, 0.3], [-1.42, 2.1, -0.2]); spear(f, [1.52, 0, 0.32], [1.4, 2.0, -0.2], 'trident');
      const [hx, hz] = span(yaw, 1.45, 0.38); fence(x, z, hx, hz, 1.15);
      for (const [y0, y1, lz] of [[0.04, 0.38, 0.03], [0.38, 0.72, -0.07], [0.72, 1.08, -0.17]]) { const [sx, sz] = local(x, z, yaw, 0, lz), [bx, bz] = span(yaw, 1.34, 0.075); hit(sx, sz, bx, bz, y1, y0); }
      note('shield rack', x, z, yaw);
    }
    // a brazier: an iron tripod, a bronze bowl of coals, and a flame. Adds a fire for the level to light and flicker
    function brazier(x, z, bowlY = 0.95, legs = true) {
      const f = at(x, z, seeded() * TAU);
      if (legs) for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; pole(f, 'iron', [Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3], [Math.cos(a) * 0.1, bowlY - 0.06, Math.sin(a) * 0.1], 0.035, 0.9, 4); pole(f, 'iron', [Math.cos(a) * 0.22, 0.42, Math.sin(a) * 0.22], [Math.cos(a + 2.1) * 0.22, 0.42, Math.sin(a + 2.1) * 0.22], 0.02, 0.8, 4); }
      turn(f, 'bronze', [0, bowlY - 0.08, 0], [[0.06, 0, 0.6], [0.2, 0.05, 0.8], [0.3, 0.16], [0.31, 0.2], [0.27, 0.2, 0.5], [0.2, 0.14, 0.4]], 12, 0.95, { capShade: 0.25 });
      turn(f, 'ember', [0, bowlY + 0.05, 0], [[0.22, 0], [0.1, 0.035], [0, 0.04]], 9, 1, { shadow: '' });
      for (let k = 0; k < 14; k++) { const a = seeded() * TAU, r = 0.02 + seeded() * 0.17, w = 0.016 + seeded() * 0.024; box(f, 'coal', [Math.cos(a) * r, bowlY + 0.07 + seeded() * 0.03, Math.sin(a) * r], [w, w * 0.7, w * (0.7 + seeded() * 0.6)], 0.5 + seeded() * 0.6, { shadow: '' }); }   // lumps of charcoal on the glowing bed
      fires.push({ x: CX + x, y: bowlY + 0.05, z, r: 0.29, h: 0.82, big: true });
      if (legs) { fence(x, z, 0.26, 0.26, bowlY + 0.1); note('brazier', x, z, 0); }
      hit(x, z, 0.27, 0.27, bowlY + 0.13, bowlY - 0.08, 'metal');
    }
    // a trophy of captured arms: a post dressed with a cuirass, helmet and shields, spears crossed behind
    function trophy(x, z, yaw) {
      const f = at(x, z, yaw);
      turn(f, 'trav', [0, 0, 0], [[0.42, 0, 0.8], [0.42, 0.22], [0.36, 0.24], [0.36, 0.42], [0.3, 0.44]], 8, 0.92, { flute: 0.06 });
      pole(f, 'timber', [0, 0.4, 0], [0, 2.75, 0], 0.11, 0.75, 6); pole(f, 'timber', [-0.78, 2.02, 0], [0.78, 2.02, 0], 0.08, 0.7, 5);
      turn(f, 'bronze', [0, 1.38, 0], [[0.2, 0, 0.7], [0.24, 0.12], [0.2, 0.3], [0.26, 0.5], [0.28, 0.62], [0.16, 0.7], [0.1, 0.74]], 10, 0.9);       // the cuirass
      for (let k = 0; k < 7; k++) { const a = (k / 7) * TAU; quad(f, 'shieldRed', [[Math.cos(a) * 0.2, 1.4, Math.sin(a) * 0.2], [Math.cos(a + 0.7) * 0.2, 1.4, Math.sin(a + 0.7) * 0.2], [Math.cos(a + 0.7) * 0.25, 1.08, Math.sin(a + 0.7) * 0.25], [Math.cos(a) * 0.25, 1.08, Math.sin(a) * 0.25]], [Math.cos(a + 0.35), 0.1, Math.sin(a + 0.35)], [0.75 + jit(0.3), 0.18, 0.13]); }   // its leather skirt
      helmet(f, [0, 2.76, 0], 1.0);
      for (const e of [-1, 1]) {       // a round shield hung on each arm, and a spear behind it
        turn(f, 'bronze', [e * 0.62, 1.82, 0.07], [[0.36, 0, 0.75], [0.35, 0.015], [0.3, 0.035, 0.55], [0.12, 0.075], [0, 0.1, 1.2]], 14, 0.95 + jit(0.2), { dir: [e * 0.15, 0, 1] });
        spear(f, [e * 0.75, 0.1, -0.2], [e * -0.5, 3.15, -0.08], e < 0 ? 'pilum' : 'trident');
      }
      fence(x, z, 0.42, 0.42, 2.7); hit(x, z, 0.4, 0.4, 0.44, 0, 'concrete'); hit(x, z, 0.22, 0.22, 2.1, 1.08, 'metal'); hit(x, z, 0.06, 0.06, 2.76, 0.44); hit(x, z, 0.12, 0.12, 2.98, 2.76, 'metal');
      for (const e of [-1, 1]) { const [sx, sz] = local(x, z, yaw, e * 0.63, 0.11), [ax, az] = span(yaw, 0.3, 0.06); hit(sx, sz, ax, az, 2.12, 1.52, 'metal'); }      // the two round shields
      { const [ax, az] = span(yaw, 0.78, 0.04); hit(x, z, ax, az, 2.06, 1.98); }
      note('trophy', x, z, yaw);
    }
    // the eagle of a standard: a bronze plate cut to an eagle with its wings raised
    function eagle(f, c, size, tone = 1) {
      const P = pts => pts.map(([px, py]) => [c[0] + px * size, c[1] + py * size]);
      for (const side of [-1, 1]) {
        plate(f, 'bronze', P([[side * 0.08, 0.3], [side * 0.5, 0.78], [side * 0.92, 0.98], [side * 0.86, 0.6], [side * 0.6, 0.3], [side * 0.22, 0.1]]), c[2], tone, { thick: 0.02 * size });
        plate(f, 'bronze', P([[side * 0.6, 0.3], [side * 0.86, 0.6], [side * 0.98, 0.3], [side * 0.7, 0.05]]), c[2], tone * 0.85, { thick: 0.02 * size });
      }
      plate(f, 'bronze', P([[-0.13, 0], [0.13, 0], [0.17, 0.42], [0, 0.56], [-0.17, 0.42]]), c[2] + 0.01, tone * 1.1, { thick: 0.04 * size });
      plate(f, 'bronze', P([[-0.07, 0.5], [0.1, 0.5], [0.24, 0.66], [0.06, 0.78], [-0.08, 0.7]]), c[2] + 0.012, tone * 1.15, { thick: 0.04 * size });           // head, turned to its right
      plate(f, 'bronze', P([[-0.22, 0], [0.22, 0], [0.26, -0.08], [-0.26, -0.08]]), c[2], tone * 0.8, { thick: 0.05 * size });                               // the thunderbolt it stands on
    }
    // a legion's standard: a pole in a stone foot, the eagle, a red flag with SPQR in gold, and its discs
    function standard(x, z, yaw, h = 3.4) {
      const f = at(x, z, yaw);
      box(f, 'trav', [0, 0.17, 0], [0.24, 0.17, 0.24], 0.9); box(f, 'trav', [0, 0.39, 0], [0.17, 0.05, 0.17], 0.95);
      pole(f, 'timber', [0, 0.4, 0], [0, h, 0], 0.055, 0.7, 6);
      eagle(f, [0, h, 0], 0.42, 1.05);
      pole(f, 'bronze', [-0.36, h - 0.22, 0], [0.36, h - 0.22, 0], 0.035, 1, 5);
      plate(f, 'vexillum', [[-0.32, h - 0.9], [0.32, h - 0.9], [0.32, h - 0.25], [-0.32, h - 0.25]], 0.03, 1, { us: 1 / 0.64, vs: 1 / 0.65, u0: 0.5, v0: -(h - 0.9) / 0.65, thick: 0.01, shadow: 'cr' });
      for (let k = 0; k < 3; k++) turn(f, 'bronze', [0, h - 1.22 - k * 0.3, 0.035], [[0.12, 0, 0.7], [0.11, 0.012], [0.04, 0.04], [0, 0.05, 1.2]], 10, 0.95, { dir: [0, 0, 1] });
      solid(x, z, 0.24, 0.24, 0.44, 'concrete'); solid(x, z, 0.04, 0.04, h, 'wood', 0.44);
      { const [ax, az] = span(yaw, 0.32, 0.03); hit(x, z, ax, az, h - 0.25, h - 0.9); const [ex, ez] = span(yaw, 0.36, 0.03); hit(x, z, ex, ez, h + 0.4, h + 0.02, 'metal'); }
      note('standard', x, z, yaw);
    }
    // a two-wheeled cart, shafts down, loaded with hay or amphorae
    function cart(x, z, yaw, load = 'hay') {
      const f = at(x, z, yaw);
      for (const e of [-0.78, 0.78]) {
        turn(f, 'timber', [e - 0.045, 0.55, 0], [[0.1, 0, 0.6], [0.55, 0, 0.75], [0.55, 0.09, 0.9], [0.1, 0.09, 0.7]], 14, 0.8, { dir: [1, 0, 0] });
        turn(f, 'iron', [e - 0.05, 0.55, 0], [[0.552, 0], [0.552, 0.1]], 14, 0.8, { dir: [1, 0, 0] });
        for (let k = 0; k < 2; k++) pole(f, 'timber', [e + 0.05, 0.55 - 0.5 * Math.cos(k * 1.57), -0.5 * Math.sin(k * 1.57)], [e + 0.05, 0.55 + 0.5 * Math.cos(k * 1.57), 0.5 * Math.sin(k * 1.57)], 0.07, 0.65);
      }
      pole(f, 'timber', [-0.82, 0.55, 0], [0.82, 0.55, 0], 0.09, 0.6, 6);
      box(f, 'timber', [0, 0.7, 0], [0.66, 0.045, 1.05], 0.8, { bottom: true });
      for (const e of [-0.64, 0.64]) { box(f, 'timber', [e, 0.94, 0], [0.025, 0.2, 1.05], 0.75 + jit(0.15)); for (const d of [-0.95, 0, 0.95]) pole(f, 'timber', [e, 0.72, d], [e, 1.18, d], 0.06, 0.7); }
      box(f, 'timber', [0, 0.94, -1.03], [0.64, 0.2, 0.025], 0.78);
      for (const e of [-0.4, 0.4]) pole(f, 'timber', [e, 0.68, 1.0], [e * 0.9, 0.06, 2.55], 0.08, 0.72);            // the shafts, resting on the sand
      if (load === 'hay') { box(f, 'straw', [0, 1.02, -0.05], [0.6, 0.27, 0.95], [0.95, 0.88, 0.62]); box(f, 'straw', [0.05, 1.5, -0.2], [0.5, 0.22, 0.7], [0.9, 0.84, 0.6]); }
      else for (let i = 0; i < 5; i++) amphora(f, [-0.42 + (i % 3) * 0.4, 0.86 + Math.floor(i / 3) * 0.3, -0.85 + Math.floor(i / 3) * 0.2], [jit(0.1), 0.25 + jit(0.1), 1], 0.9);
      const top = load === 'hay' ? 1.7 : 1.22, [hx, hz] = span(yaw, 0.85, 1.08); fence(x, z, hx, hz, top);
      { const [bx, bz] = span(yaw, 0.66, 1.05); hit(x, z, bx, bz, top, 0.64); }
      for (const e of [-0.8, 0.8]) { const [wx, wz] = local(x, z, yaw, e, 0), [ax, az] = span(yaw, 0.06, 0.54); hit(wx, wz, ax, az, 1.1, 0); }
      { const [sx, sz] = local(x, z, yaw, 0, 1.8), [ax, az] = span(yaw, 0.48, 0.75); fence(sx, sz, ax, az, 0.6); }
      note('cart', x, z, yaw);
    }
    // hay in bound bales, n of them stacked
    function bales(x, z, yaw, n = 3) {
      const f = at(x, z, yaw), spots = [[-0.56, 0.27, 0], [0.58, 0.27, 0.04], [0.02, 0.81, 0.02], [0.3, 0.27, 0.62]];
      for (let i = 0; i < n; i++) {
        const [bx, by, bz] = spots[i], t = [0.92 + jit(0.14), 0.85 + jit(0.1), 0.6];
        box(f, 'straw', [bx, by, bz], [0.55, 0.26, 0.28], t);
        for (const e of [-0.28, 0.28]) box(f, 'rope', [bx + e, by, bz], [0.014, 0.265, 0.285], 0.5);
      }
      oriented('solid', x, z, yaw, 1.12, 0.3, 0.54, 0, 'dirt'); if (n > 2) { const [tx, tz] = local(x, z, yaw, 0.02, 0.02); oriented('solid', tx, tz, yaw, 0.56, 0.29, 1.07, 0.54, 'dirt'); }
      if (n > 3) { const [tx, tz] = local(x, z, yaw, 0.3, 0.62); oriented('solid', tx, tz, yaw, 0.56, 0.29, 0.54, 0, 'dirt'); }
      note('hay', x, z, yaw);
    }
    // a beast cage on rollers: timber floor and roof, iron bars, straw inside
    function cage(x, z, yaw) {
      const f = at(x, z, yaw), HX = 1.15, HZ = 0.72, Y0 = 0.34, Y1 = 1.86;
      for (const e of [-0.8, 0.8]) turn(f, 'timber', [-HX * 0.98, 0.15, e * 0.75], [[0.15, 0, 0.7], [0.15, HX * 1.96]], 8, 0.7, { dir: [1, 0, 0] });
      box(f, 'timber', [0, Y0 - 0.03, 0], [HX, 0.045, HZ], 0.78, { bottom: true }); box(f, 'timber', [0, Y1 + 0.04, 0], [HX + 0.05, 0.05, HZ + 0.05], 0.72, { bottom: true });
      for (const [ex, ez] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pole(f, 'timber', [ex * HX, Y0, ez * HZ], [ex * HX, Y1, ez * HZ], 0.1, 0.7);
      const bar = (ax, az) => pole(f, 'iron', [ax, Y0, az], [ax, Y1, az], 0.032, 0.75 + jit(0.3), 5);
      for (let i = 1; i < 14; i++) { const ax = -HX + (i / 14) * 2 * HX; bar(ax, HZ); bar(ax, -HZ); }
      for (let i = 1; i < 8; i++) { const az = -HZ + (i / 8) * 2 * HZ; bar(HX, az); bar(-HX, az); }
      for (const y of [Y0 + 0.5, Y1 - 0.45]) { for (const ez of [-HZ, HZ]) box(f, 'iron', [0, y, ez], [HX, 0.025, 0.02], 0.8); for (const ex of [-HX, HX]) box(f, 'iron', [ex, y, 0], [0.02, 0.025, HZ], 0.8); }
      box(f, 'straw', [0.1, Y0 + 0.06, 0], [HX * 0.85, 0.05, HZ * 0.8], [0.9, 0.82, 0.55]);
      oriented('fence', x, z, yaw, HX + 0.05, HZ + 0.05, Y1 + 0.1); oriented('hit', x, z, yaw, HX, HZ, Y0 + 0.02, 0.02); oriented('hit', x, z, yaw, HX + 0.05, HZ + 0.05, Y1 + 0.09, Y1 - 0.01); note('cage', x, z, yaw);
    }
    // the palus: the post gladiators trained against, hacked about, with a wooden sword left against it
    function palus(x, z) {
      const f = at(x, z, seeded() * TAU);
      turn(f, 'timber', [0, 0, 0], [[0.13, 0, 0.6], [0.12, 0.6], [0.105, 0.75, 0.8], [0.12, 0.85], [0.1, 1.2, 0.85], [0.115, 1.3], [0.11, 1.78], [0.06, 1.82]], 8, 0.8 + jit(0.2), { flute: 0.05 });
      turn(f, 'rope', [0, 0.95, 0], [[0.125, 0], [0.13, 0.05], [0.125, 0.1]], 8, 0.9);
      pole(f, 'wood', [0.2, 0, 0.16], [0.13, 0.86, 0.1], 0.05, 1.0, 4, 0.03); pole(f, 'wood', [0.07, 0.62, 0.12], [0.21, 0.64, 0.14], 0.03, 0.9, 4);      // rudis
      solid(x, z, 0.13, 0.13, 1.8, 'wood'); note('palus', x, z, 0);
    }
    // a trapdoor in the arena floor, over one of the lifts: planks, iron straps and a ring, in a timber frame
    function trapdoor(x, z, yaw) {
      const f = at(x, z, yaw), HX = 1.25, HZ = 0.85;
      for (let i = 0; i < 6; i++) { const lz = -HZ + (i + 0.5) * (2 * HZ / 6); quad(f, 'timber', [[-HX, 0.022, lz + HZ / 6 - 0.008], [HX, 0.022, lz + HZ / 6 - 0.008], [HX, 0.022, lz - HZ / 6 + 0.008], [-HX, 0.022, lz - HZ / 6 + 0.008]], [0, 1, 0], 0.5 + jit(0.25), [[0, lz], [2.5, lz], [2.5, lz + 0.28], [0, lz + 0.28]], 'r'); }
      quad(f, 'dark', [[-HX, 0.014, HZ], [HX, 0.014, HZ], [HX, 0.014, -HZ], [-HX, 0.014, -HZ]], [0, 1, 0], 1, null, '');
      for (const [a, b, c, d] of [[-HX - 0.12, HX + 0.12, HZ, HZ + 0.12], [-HX - 0.12, HX + 0.12, -HZ - 0.12, -HZ], [-HX - 0.12, -HX, -HZ, HZ], [HX, HX + 0.12, -HZ, HZ]]) quad(f, 'timber', [[a, 0.035, d], [b, 0.035, d], [b, 0.035, c], [a, 0.035, c]], [0, 1, 0], 0.62 + jit(0.1), [[a, c], [b, c], [b, d], [a, d]], 'r');
      for (const e of [-0.7, 0.7]) quad(f, 'iron', [[e - 0.04, 0.028, HZ], [e + 0.04, 0.028, HZ], [e + 0.04, 0.028, -HZ * 0.6], [e - 0.04, 0.028, -HZ * 0.6]], [0, 1, 0], 0.8, null, 'r');
      turn(f, 'iron', [0, 0.03, -HZ * 0.55], [[0.1, 0], [0.1, 0.02], [0.07, 0.02], [0.07, 0]], 10, 0.9, { shadow: '' });
      note('trapdoor', x, z, yaw);
    }
    // the capstan that hauled the lifts: a drum on a cross foot, with its four bars
    function capstan(x, z, yaw) {
      const f = at(x, z, yaw);
      for (const a of [0, Math.PI / 2]) pole(f, 'timber', [Math.cos(a) * -0.7, 0.07, Math.sin(a) * -0.7], [Math.cos(a) * 0.7, 0.07, Math.sin(a) * 0.7], 0.14, 0.7);
      turn(f, 'timber', [0, 0.1, 0], [[0.3, 0, 0.7], [0.27, 0.35], [0.23, 0.42], [0.23, 0.62], [0.28, 0.68], [0.28, 0.96], [0.2, 1.02]], 10, 0.82, { flute: 0.07 });
      turn(f, 'rope', [0, 0.52, 0], [[0.24, 0], [0.265, 0.03], [0.24, 0.1]], 10, 0.9);
      for (const a of [0, Math.PI / 2]) pole(f, 'timber', [Math.cos(a) * -1.15, 0.86, Math.sin(a) * -1.15], [Math.cos(a) * 1.15, 0.86, Math.sin(a) * 1.15], 0.07, 0.85, 6);
      // the bars are solid too: placed square to the map (yaw 0) so each is one box
      solid(x, z, 0.28, 0.28, 1.1, 'wood'); fence(x, z, 1.15, 0.07, 0.93); fence(x, z, 0.07, 1.15, 0.93); hit(x, z, 1.15, 0.04, 0.9, 0.82); hit(x, z, 0.04, 1.15, 0.9, 0.82); hit(x, z, 0.7, 0.07, 0.14, 0); hit(x, z, 0.07, 0.7, 0.14, 0); note('capstan', x, z, yaw);
    }
    // a length of fluted column still standing on its base, broken off at h
    function stump(x, z, h = 2.2, r = 0.44) {
      const f = at(x, z, seeded() * TAU), t = 0.86 + jit(0.2);
      box(f, 'trav', [0, 0.11, 0], [r * 1.5, 0.11, r * 1.5], t * 0.9);
      turn(f, 'trav', [0, 0.22, 0], [[r * 1.36, 0, 0.8], [r * 1.4, 0.07], [r * 1.14, 0.14], [r * 1.2, 0.21], [r, 0.28]], 16, t);
      turn(f, 'trav', [0, 0.5, 0], [[r, 0], [r * 0.97, h - 0.5], [r * 0.55, h - 0.4, 0.8], [0, h - 0.47, 0.7]], 20, t, { flute: 0.2 });       // ends in the rough face where it broke
      solid(x, z, r * 1.5, r * 1.5, 0.22, 'concrete'); solid(x, z, r * 0.86, r * 0.86, h - 0.42, 'concrete', 0.22); note('column', x, z, 0);
    }
    // a capital on the ground, on its side: bell, scrolls at the corners, the square top
    function capital(x, z, yaw) {
      const f = at(x, z, yaw, 0.02, 0.5), t = 0.9 + jit(0.15);
      turn(f, 'trav', [0, 0.3, 0], [[0.36, 0, 0.8], [0.38, 0.06], [0.36, 0.1], [0.4, 0.3], [0.52, 0.52], [0.56, 0.6]], 12, t, { flute: 0.12 });
      box(f, 'trav', [0, 0.97, 0], [0.62, 0.07, 0.62], t * 1.02, { bottom: true });
      for (const [ex, ez] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) turn(f, 'trav', [ex * 0.5, 0.8, ez * 0.5], [[0.02, -0.07], [0.11, -0.06], [0.11, 0.06], [0.02, 0.07]], 8, t * 0.92, { dir: [ex, 0, -ez] });
      solid(x, z, 0.6, 0.6, 0.85, 'concrete'); note('capital', x, z, yaw);
    }
    // an altar: a marble block with a moulded foot and top, coals burning on it
    function altar(x, z, yaw) {
      const f = at(x, z, yaw);
      box(f, 'trav', [0, 0.09, 0], [0.62, 0.09, 0.5], 0.85); box(f, 'trav', [0, 0.22, 0], [0.55, 0.04, 0.43], 0.95);
      box(f, 'marbleCream', [0, 0.62, 0], [0.48, 0.36, 0.37], 0.95);
      for (const e of [-1, 1]) { quad(f, 'marbleRed', [[-0.34, 0.36, e * 0.372], [0.34, 0.36, e * 0.372], [0.34, 0.88, e * 0.372], [-0.34, 0.88, e * 0.372]], [0, 0, e], 0.85, [[0, 0], [0.7, 0], [0.7, 0.5], [0, 0.5]]); turn(f, 'bronze', [0, 0.62, e * 0.374], [[0.13, 0, 0.7], [0.115, 0.012], [0.05, 0.04], [0, 0.05, 1.2]], 10, 1, { dir: [0, 0, e] }); }
      box(f, 'trav', [0, 1.02, 0], [0.56, 0.04, 0.45], 1.0, { bottom: true }); box(f, 'trav', [0, 1.1, 0], [0.62, 0.045, 0.5], 0.95, { bottom: true });
      brazier(x, z, 1.24, false);
      const [hx, hz] = span(yaw, 0.62, 0.5); solid(x, z, hx, hz, 1.145, 'concrete'); note('altar', x, z, yaw);
    }
    // a great block cut with the dedication, on bearers, waiting to go back up
    function inscribed(x, z, yaw) {
      const f = at(x, z, yaw), t = 0.92 + jit(0.1);
      for (const e of [-0.8, 0.8]) pole(f, 'timber', [e, 0.06, -0.5], [e, 0.06, 0.5], 0.12, 0.7);
      box(f, 'marbleCream', [0, 0.52, 0], [1.25, 0.4, 0.33], t);
      quad(f, 'letters', [[-1.14, 0.35, 0.334], [1.14, 0.35, 0.334], [1.14, 0.69, 0.334], [-1.14, 0.69, 0.334]], [0, 0, 1], 1, [[0.05, 0.53], [0.95, 0.53], [0.95, 0.99], [0.05, 0.99]], '');
      oriented('solid', x, z, yaw, 1.25, 0.33, 0.92, 0.1, 'concrete'); note('inscription', x, z, yaw);
    }
    // standing water in a hollow of the sand. Only noted here (shots and boots splash in it); makePuddles draws them all
    function puddle(x, z, r) { puddles.push({ x: CX + x, z, r, seed: seeded() * 100, squash: 0.58 + seeded() * 0.3, turn: seeded() * TAU }); }
    return { at, quad, box, turn, pole, plate, oriented, amphora, looseAmphora, amphoraRack, scutum, spear, helmet, weaponRack, shieldRack, brazier, trophy, eagle, standard, cart, bales, cage, palus, trapdoor, capstan, stump, capital, altar, inscribed, puddle, fires, puddles };
  }

  /* ------------------------------------------------------------------ what stands on the sand
     The restoration yard: the game's own containers, crates, barriers and plant, plus stone waiting to be set: blocks
     stacked on pallets, column drums lying where they were unloaded. Laid out for play:
       - nothing lets you see from one gate to the other: the middle is blocked by a container you can climb
       - three lanes down the length, with a tall block and a low block alternating along each
       - the layout is the same turned half a circle, so both ends are equal
     Positions are in metres from the arena centre: x along its length (east is +), z across it (north is +).        */
  function furnish(G, bld, root, sh) {
    const T = G.THREE, ph = G.physics, staticRoot = new T.Group(), placed = [], explosives = [], lamps = [], box = new T.Box3();
    const NO_COLLIDER = new Set(['traffic_cone', 'jerry_can']);
    // the game's own way of giving a turned prop boxes: cut the long side into short lengths, each a box round its slice
    function collide(obj, yaw) {
      const turnedProp = Math.abs(Math.sin(2 * yaw)) > 0.2;
      for (const c of obj.userData.colliders || []) {
        let parts = [c];
        if (turnedProp) {
          const w = c.max[0] - c.min[0], d = c.max[2] - c.min[2], axis = w >= d ? 0 : 2, long = Math.max(w, d), n = Math.min(10, Math.max(1, Math.round(long / Math.max(0.25, Math.min(w, d)))));
          if (n > 1) { parts = []; for (let k = 0; k < n; k++) { const mn = c.min.slice(), mx = c.max.slice(); mn[axis] = c.min[axis] + (long * k) / n; mx[axis] = c.min[axis] + (long * (k + 1)) / n; parts.push({ min: mn, max: mx, surface: c.surface }); } }
        }
        for (const p of parts) {
          box.min.set(p.min[0], p.min[1], p.min[2]); box.max.set(p.max[0], p.max[1], p.max[2]); box.applyMatrix4(obj.matrixWorld);
          if (box.max.y - box.min.y < 0.2 && box.max.y < 0.3) continue;
          if (turnedProp) { const ix = (box.max.x - box.min.x) * 0.07, iz = (box.max.z - box.min.z) * 0.07; box.min.x += ix; box.max.x -= ix; box.min.z += iz; box.max.z -= iz; }
          ph.addBox(box.min, box.max, { surface: p.surface || c.surface || 'metal' });
        }
      }
    }
    function place(name, x, z, yaw = 0, opts = {}, y = 0, bare = false) {      // bare: the caller gives it collision of its own
      if ((name === 'barrel' && opts.color === 'red' && !opts.lying) || name === 'gas_cylinders') { explosives.push({ name, x: CX + x, y, z, yaw, opts: { ...opts } }); return null; }
      const obj = G.props.build(name, opts);
      obj.position.set(CX + x, y, z); obj.rotation.y = yaw; staticRoot.add(obj); obj.updateMatrixWorld(true);
      if (!NO_COLLIDER.has(name) && !bare) collide(obj, yaw);
      if (obj.userData.lamps) lamps.push(obj);
      placed.push({ name, x: CX + x, y, z, yaw });
      return obj;
    }
    // everything is placed twice: once as given, once turned half a circle about the centre
    const both = (fn) => { fn(1); fn(-1); };
    const seeded = rng(7411), jit = k => (seeded() - 0.5) * k, kit = romanKit(G, bld, ph, placed, seeded);

    /* stone, in world space: a cut block with chamfered edges, and a column drum */
    const quadrant = () => 'p';
    function stoneBlock(x, y, z, sx, sy, sz, yaw, tone) {
      const c = Math.cos(yaw), s = Math.sin(yaw), b = 0.022, hx = sx / 2, hy = sy / 2, hz = sz / 2, sec = quadrant(x, z), uo = seeded() * 20, vo = seeded() * 20;
      const W = (lx, ly, lz) => [CX + x + lx * c + lz * s, y + hy + ly, z - lx * s + lz * c], Nw = (nx, ny, nz) => [nx * c + nz * s, ny, -nx * s + nz * c];
      const tint = [tone * (1 + jit(0.08)), tone, tone * (1 + jit(0.1))], shade = (ly, k = 1) => tint.map(v => v * k * (0.72 + 0.28 * smooth(-hy, hy * 0.2, ly)));
      // the six faces, each set in from its edges by the chamfer
      const faces = [[[1, 0, 0], [0, 1, 0], [0, 0, 1], hx, hy, hz], [[-1, 0, 0], [0, 1, 0], [0, 0, -1], hx, hy, hz], [[0, 1, 0], [0, 0, 1], [1, 0, 0], hy, hz, hx], [[0, -1, 0], [1, 0, 0], [0, 0, 1], hy, hx, hz], [[0, 0, 1], [1, 0, 0], [0, 1, 0], hz, hx, hy], [[0, 0, -1], [0, 1, 0], [1, 0, 0], hz, hy, hx]];
      for (const [n, ua, va, hn, hu, hv] of faces) {
        if (n[1] < 0) continue;                                                // nobody sees the underside
        const P = (a, bb, off) => { const p = [n[0] * (hn - off) + ua[0] * a + va[0] * bb, n[1] * (hn - off) + ua[1] * a + va[1] * bb, n[2] * (hn - off) + ua[2] * a + va[2] * bb]; return p; };
        const iu = hu - b, iv = hv - b, corners = [[-iu, -iv], [iu, -iv], [iu, iv], [-iu, iv]], top = n[1] > 0 ? 1.06 : 1;
        bld.addW('trav', corners.map(([a, bb]) => W(...P(a, bb, 0))), Nw(...n), corners.map(([a, bb]) => [a + uo, bb + vo]), corners.map(([a, bb]) => shade(P(a, bb, 0)[1], top)), 'cr', sec);
        // the chamfer along each of this face's four edges (each edge is shared, so each face draws half of it)
        for (let k = 0; k < 4; k++) {
          const [a0, b0] = corners[k], [a1, b1] = corners[(k + 1) % 4], ex = k === 0 ? [0, -1] : k === 1 ? [1, 0] : k === 2 ? [0, 1] : [-1, 0];
          const o0 = [a0 + ex[0] * b * 0.5, b0 + ex[1] * b * 0.5], o1 = [a1 + ex[0] * b * 0.5, b1 + ex[1] * b * 0.5], en = [n[0] + ua[0] * ex[0] + va[0] * ex[1], n[1] + ua[1] * ex[0] + va[1] * ex[1], n[2] + ua[2] * ex[0] + va[2] * ex[1]].map(v => v * 0.7071);
          bld.addW('trav', [W(...P(a0, b0, 0)), W(...P(a1, b1, 0)), W(...P(o1[0], o1[1], b * 0.5)), W(...P(o0[0], o0[1], b * 0.5))], Nw(...en), [[a0 + uo, b0 + vo], [a1 + uo, b1 + vo], [o1[0] + uo, o1[1] + vo], [o0[0] + uo, o0[1] + vo]], shade(P(a0, b0, 0)[1], 0.9), 'cr', sec);
        }
      }
    }
    // blocks stacked on a pallet: cols x rows on the plan, layers high. Returns nothing; adds its own collision
    // full: every stone of the top layer is there (a stack that is meant to be climbed)
    function blockStack(x, z, yaw, layers, tone = 1, name = 'stack', full = false) {
      place('pallet', x, z, yaw, { seed: Math.floor(seeded() * 9999) });
      const c = Math.cos(yaw), s = Math.sin(yaw), bw = 0.56, bd = 0.46, bh = 0.4, top = [];
      for (let l = 0; l < layers; l++) for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        if (l === layers - 1 && layers > 1 && seeded() < 0.3 && !full) continue;              // the top layer is not always full
        const lx = (i - 0.5) * (bw + 0.02) + jit(0.03), lz = (j - 0.5) * (bd + 0.02) + jit(0.03), flip = l % 2 ? Math.PI / 2 : 0;
        const fx = flip ? lz : lx, fz = flip ? lx : lz, bx = x + fx * c + fz * s, bz = z - fx * s + fz * c, byaw = yaw + flip + jit(0.04);
        stoneBlock(bx, 0.144 + l * (bh + 0.004), bz, bw, bh, bd, byaw, tone * (0.86 + 0.24 * seeded()));
        if (l === layers - 1) top.push([bx, bz, byaw]);
      }
      for (let l = 0; l < layers; l++) {            // each layer is laid across the one below, so each gets its own box
        const y0 = l ? 0.144 + l * 0.404 : 0, y1 = 0.144 + (l + 1) * 0.404;
        if (l === layers - 1 && top.length < 4) {    // a top layer with stones missing: a box for each stone that is there, none where there is air
          for (const [bx, bz, byaw] of top) { const ca = Math.abs(Math.cos(byaw)), sa = Math.abs(Math.sin(byaw)), hx = (ca * bw + sa * bd) / 2, hz = (sa * bw + ca * bd) / 2; ph.addBox([CX + bx - hx, y0, bz - hz], [CX + bx + hx, y1, bz + hz], { surface: 'concrete' }); }
          continue;
        }
        const a = l % 2 ? 0.48 : 0.58, b = l % 2 ? 0.58 : 0.48, hx = Math.abs(c) * a + Math.abs(s) * b, hz = Math.abs(s) * a + Math.abs(c) * b;
        ph.addBox([CX + x - hx, y0, z - hz], [CX + x + hx, y1, z + hz], { surface: 'concrete' });
      }
      placed.push({ name, x: CX + x, y: 0, z, yaw });
    }
    // big blocks waiting to be set: one stone to a layer on timber bearers. Three high is 2.6 m: nobody sees over it, not even from the roof in the middle
    function bigStack(x, z, yaw, layers = 3, tone = 1) {
      const c = Math.cos(yaw), s = Math.sin(yaw), sec = quadrant(x, z);
      for (const e of [-0.34, 0.34]) {                                                      // bearers
        const W = (lx, ly, lz) => [CX + x + lx * c + lz * s, ly, z - lx * s + lz * c];
        bld.addW('timber', [W(e - 0.06, 0.11, -0.5), W(e + 0.06, 0.11, -0.5), W(e + 0.06, 0.11, 0.5), W(e - 0.06, 0.11, 0.5)], [0, 1, 0], [[0, 0], [0.12, 0], [0.12, 1], [0, 1]], 0.8, 'cr', sec);
        for (const side of [-1, 1]) bld.addW('timber', [W(e - 0.06, 0, side * 0.5), W(e + 0.06, 0, side * 0.5), W(e + 0.06, 0.11, side * 0.5), W(e - 0.06, 0.11, side * 0.5)], [s * side, 0, c * side], [[0, 0], [0.12, 0], [0.12, 0.11], [0, 0.11]], 0.6, 'cr', sec);
      }
      let y = 0.11;
      for (let l = 0; l < layers; l++) {
        const w = 1.18 + jit(0.03), h = 0.8 + jit(0.06), d = 0.92 + jit(0.04), ox = jit(0.02), oz = jit(0.05);
        stoneBlock(x + ox * c + oz * s, y, z - ox * s + oz * c, w, h, d, yaw + jit(0.05), tone * (0.84 + 0.26 * seeded()));
        y += h + 0.006;
      }
      const hx = Math.abs(c) * 0.59 + Math.abs(s) * 0.46, hz = Math.abs(s) * 0.59 + Math.abs(c) * 0.46;     // the size of the stone; in a row they touch, so there is no slit to see through
      ph.addBox([CX + x - hx, 0, z - hz], [CX + x + hx, y, z + hz], { surface: 'concrete' });
      placed.push({ name: 'bigstack', x: CX + x, y: 0, z, yaw });
    }
    // a column drum lying on its side, chocked with timber
    function drum(x, z, yaw, r = 0.52, len = 1.25, tone = 1) {
      const c = Math.cos(yaw), s = Math.sin(yaw), N = 18, sec = quadrant(x, z), uo = seeded() * 9;
      const W = (ax, ry, rz) => [CX + x + ax * c + rz * s, r + ry, z - ax * s + rz * c], Nw = (ax, ry, rz) => [ax * c + rz * s, ry, -ax * s + rz * c];
      for (let k = 0; k < N; k++) {
        const a0 = (k / N) * TAU, a1 = ((k + 1) / N) * TAU, y0 = Math.sin(a0), y1 = Math.sin(a1), z0 = Math.cos(a0), z1 = Math.cos(a1), sh0 = tone * (0.6 + 0.4 * smooth(-1, 0.3, y0)), sh1 = tone * (0.6 + 0.4 * smooth(-1, 0.3, y1));
        bld.addW('trav', [W(-len / 2, y0 * r, z0 * r), W(len / 2, y0 * r, z0 * r), W(len / 2, y1 * r, z1 * r), W(-len / 2, y1 * r, z1 * r)], [Nw(0, y0, z0), Nw(0, y0, z0), Nw(0, y1, z1), Nw(0, y1, z1)], [[uo, a0 * r], [uo + len, a0 * r], [uo + len, a1 * r], [uo, a1 * r]], PV(sh0, sh0, sh1, sh1), 'cr', sec);
        for (const e of [-1, 1]) {            // the two faces, with the dowel hole the next drum sat on
          bld.addW('trav', [W(e * len / 2, y0 * r, z0 * r), W(e * len / 2, y1 * r, z1 * r), W(e * len / 2, y1 * r * 0.16, z1 * r * 0.16), W(e * len / 2, y0 * r * 0.16, z0 * r * 0.16)], Nw(e, 0, 0), [[z0 * r + uo, y0 * r], [z1 * r + uo, y1 * r], [z1 * r * 0.16 + uo, y1 * r * 0.16], [z0 * r * 0.16 + uo, y0 * r * 0.16]], tone * 0.86, 'cr', sec);
          bld.addW('trav', [W(e * len / 2, y0 * r * 0.16, z0 * r * 0.16), W(e * len / 2, y1 * r * 0.16, z1 * r * 0.16), W(e * (len / 2 - 0.07), 0, 0)], Nw(e, 0, 0), [[uo, 0], [uo + 0.1, 0], [uo, 0.1]], tone * 0.3, 'cr', sec);
        }
      }
      for (const e of [-0.35, 0.35]) for (const side of [-1, 1]) {                             // chocks
        const cx = e * len, cz = side * (r * 0.78), w = 0.09;
        const corner = (ax, hh, rz) => W(cx + ax, hh - r, cz + rz);
        bld.addW('timber', [corner(-w, 0, -0.12 * side), corner(w, 0, -0.12 * side), corner(w, 0.16, 0.1 * side), corner(-w, 0.16, 0.1 * side)], Nw(0, 0.8, -0.6 * side), [[0, 0], [0.2, 0], [0.2, 0.3], [0, 0.3]], 0.8, 'cr', sec);
      }
      const hx = Math.abs(c) * len / 2 + Math.abs(s) * r * 0.86, hz = Math.abs(s) * len / 2 + Math.abs(c) * r * 0.86;       // a little inside the round, so a shot's mark lands on the stone
      ph.addBox([CX + x - hx, 0, z - hz], [CX + x + hx, r * 1.86, z + hz], { surface: 'concrete' });
      placed.push({ name: 'drum', x: CX + x, y: 0, z, yaw });
    }

    const H = Math.PI / 2;
    /* The stores: a lean-to along an arc of the wall beside each gate. A tiled roof runs from under the cornice down to a
       line of posts 3.3 m out, following the curve; under it, what the arena keeps to hand. The roof is solid: nobody
       on the container in the middle can see or shoot what is under it. One at each end, turned half a circle. */
    function stores(i0, n) {
      const D = 3.3, EAVE = STORES.eave, Y0 = STORES.y0, Y1 = STORES.y1, roofY = storeRoofY;
      for (let i = i0; i < i0 + n; i++) {
        const s0 = i * HB, s1 = s0 + HB, t = 0.78 + 0.3 * hash(i, 140);
        bld.add('tile', [[s0, -0.02, Y0], [s1, -0.02, Y0], [s1, -EAVE, Y1], [s0, -EAVE, Y1]], [0, -0.157, 0.988], [[s0, 0], [s1, 0], [s1, EAVE], [s0, EAVE]], PV(t, t, t * 0.82, t * 0.82), 'cr');
        bld.add('timber', [[s0, -0.02, Y0 - 0.06], [s1, -0.02, Y0 - 0.06], [s1, -EAVE, Y1 - 0.06], [s0, -EAVE, Y1 - 0.06]], [0, 0.157, -0.988], [[s0, 0], [s1, 0], [s1, EAVE], [s0, EAVE]], 0.4, 'r');
        bld.add('timber', [[s0, -EAVE, Y1 - 0.06], [s1, -EAVE, Y1 - 0.06], [s1, -EAVE, Y1], [s0, -EAVE, Y1]], [0, -1, 0], [[s0, 0], [s1, 0], [s1, 0.06], [s0, 0.06]], 0.6, 'cr');
        for (const d of [-0.1, -1.15, -2.25]) sh.box('timber', s0, s1, d - 0.06, d + 0.06, roofY(d) - 0.2, roofY(d) - 0.062, { faces: 'fbk', col: 0.52, shadow: 'r' });     // wall plate and purlins
        sh.box('timber', s0, s1, -D - 0.08, -D + 0.08, roofY(-D) - 0.22, roofY(-D) - 0.062, { faces: 'fbk', col: 0.6, shadow: 'cr' });                                  // the beam over the posts
        for (const e of [s0, s0 + HB / 2]) bld.add('timber', [[e - 0.05, -0.02, Y0 - 0.2], [e + 0.05, -0.02, Y0 - 0.2], [e + 0.05, -EAVE, Y1 - 0.2], [e - 0.05, -EAVE, Y1 - 0.2]], [0, 0.157, -0.988], [[0, 0], [0.1, 0], [0.1, EAVE], [0, EAVE]], 0.5, 'r');   // rafters, seen from below
      }
      /* The roof is solid, but not from boxes: a slope made of boxes is a staircase, and walking it jolts the eye. The
         game is told the true slope instead (roofs, installPhysics). These boxes only sit under the tiles as the ceiling
         for whoever jumps below. They stay inside the roof's outline and under the slope, so they never carry anyone. */
      { const sA = i0 * HB + 0.48, sB = (i0 + n) * HB - 0.48, cols = Math.ceil((sB - sA) / 0.5), rows = 7;
        for (let a = 0; a <= cols; a++) for (let b = 0; b < rows; b++) {
          const [x, z] = ringAt(lerp(sA, sB, a / cols), lerp(-0.3, -EAVE + 0.48, b / (rows - 1))), y = roofAt(x, z, 1);
          ph.addBox([x - 0.34, y - 0.3, z - 0.34], [x + 0.34, y - 0.16, z + 0.34], { surface: 'wood', playerOnly: true });
        } }
      for (let i = i0; i <= i0 + n; i++) {                   // posts on stone feet, each solid
        const s = i * HB, w = metres(s, -D, 0.09), [px, pz] = ringAt(s, -D), pt = 0.6 + 0.22 * hash(i, 141);
        sh.box('timber', s - w, s + w, -D - 0.09, -D + 0.09, 0.2, roofY(-D) - 0.2, { faces: 'flrk', col: pt, side: pt * 0.85, shadow: 'cr' });
        sh.box('trav', s - w * 1.7, s + w * 1.7, -D - 0.16, -D + 0.16, 0, 0.2, { faces: 'ftlrk', col: 0.85, shadow: 'cr' });
        ph.addBox([px - 0.12, 0, pz - 0.12], [px + 0.12, 2.3, pz + 0.12], { surface: 'wood' });
      }
      for (const [e, dir] of [[i0 * HB, -1], [(i0 + n) * HB, 1]]) sh.cheek('timber', e, [[-0.02, Y0 - 0.2], [-EAVE, Y1 - 0.2], [-EAVE, Y1], [-0.02, Y0]], dir, { col: 0.55, shadow: 'cr' });      // barge boards at the two ends
      /* A breastwork on the roof, 1 m high, round one corner (the right one, looking out over the sand): across the end
         of the roof and 3 m back along the eave. Planks between posts; solid, so it is cover for whoever climbs up
         there. The other end is left open. */
      const WALL = 1.0, TH = 0.12;
      for (const [se, dir] of [[i0 * HB, 1]]) {
        const w = metres(se, -2, TH), sIn = se + dir * w, a0 = Math.min(se, sIn), a1 = Math.max(se, sIn);
        for (let k = 0; k < 7; k++) {                             // across the end, stepping up the slope
          const dA = -EAVE + k * 0.5, dB = Math.min(-0.28, dA + 0.5), y = roofY((dA + dB) / 2), t = 0.7 + 0.28 * hash(i0, 150 + k, dir);
          sh.box('wood', a0, a1, dA, dB, roofY(dA) - 0.04, y + WALL, { faces: 'ftlrk', col: t, side: t * 0.9, top: t * 1.05, u0: k * 0.37, shadow: 'cr' });
          const [x, z] = ringAt((a0 + a1) / 2, (dA + dB) / 2); ph.addBox([x - 0.2, roofY(dA) - 0.1, z - 0.2], [x + 0.2, y + WALL, z + 0.2], { surface: 'wood' });
        }
        const len = metres(se, -EAVE, 3.0);
        for (let k = 0; k < 6; k++) {                             // back along the eave
          const sA = se + dir * (k / 6) * len, sB = se + dir * ((k + 1) / 6) * len, b0 = Math.min(sA, sB), b1 = Math.max(sA, sB), t = 0.7 + 0.28 * hash(i0, 160 + k, dir);
          sh.box('wood', b0, b1, -EAVE, -EAVE + TH, Y1 - 0.04, Y1 + WALL, { faces: 'ftlrk', col: t, side: t * 0.9, top: t * 1.05, u0: k * 0.53, shadow: 'cr' });
          const [x, z] = ringAt((b0 + b1) / 2, -EAVE + TH / 2); ph.addBox([x - 0.2, Y1 - 0.1, z - 0.2], [x + 0.2, Y1 + WALL, z + 0.2], { surface: 'wood' });
        }
        for (const [ps, pd] of [[se + dir * w / 2, -EAVE + 0.08], [se + dir * len, -EAVE + 0.08], [se + dir * w / 2, -1.9], [se + dir * w / 2, -0.34]]) {   // posts at the corner, the eave end and along the roof's end
          const pw = metres(ps, pd, 0.08);
          sh.box('timber', ps - pw, ps + pw, pd - 0.08, pd + 0.08, roofY(pd) - 0.04, roofY(pd) + WALL + 0.08, { faces: 'ftlrk', col: 0.6, shadow: 'cr' });
        }
      }
      // what is kept there, along the wall, leaving the way under the roof clear
      const at = (bay, d) => { const [x, z] = ringAt(bay * HB, d), f = frame(bay * HB); return [x - CX, z, Math.atan2(-f.nx, -f.nz)]; };
      { const [x, z, yaw] = at(i0 + 0.85, -0.5); kit.amphoraRack(x, z, yaw); }
      { const [x, z, yaw] = at(i0 + 2.0, -0.62); place('crate_stack', x, z, yaw, { seed: 201 + i0 }); }
      { const [x, z, yaw] = at(i0 + 2.62, -0.6); place('crate_wood', x, z, yaw + 0.15, { seed: 203 + i0 }); }
      { const [x, z, yaw] = at(i0 + 3.5, -0.62); kit.bales(x, z, yaw, 3); }
      { const [x, z, yaw] = at(i0 + 4.45, -0.5); kit.amphoraRack(x, z, yaw); }
      { const [x, z] = at(i0 + 1.45, -0.5); kit.looseAmphora(x, z, [0.04, 0.03], 0.9); }
      placed.push({ name: 'stores', x: ringAt((i0 + n / 2) * HB, -1.6)[0], y: 0, z: ringAt((i0 + n / 2) * HB, -1.6)[1], yaw: 0 });
    }
    for (const [first, bays] of STORES.runs) stores(first, bays);
    /* the middle: a container across the arena with a stair up each side. The roof sees everything and hides nothing */
    place('container20', 0, 0, H + 0.012, { color: 'orange', seed: 31, wear: 0.7 });
    /* Each stair runs straight at the container and its landing opens onto the roof. It is an open steel stair, and it
       behaves like one:
       - people walk a slope laid in 5 cm rises (the game's own stair rises 20 cm at a time, which jolts the eye at every
         tread), 30 cm thick like the stringers, with room underneath wherever there is headroom;
       - shots are stopped only by steel that is there: the twelve treads, the two stringers, the landing and its
         posts. Between the treads and under the flight they go through;
       - the handrails stop people and let shots through (they are open tube). */
    for (const [sx, sz, dir] of [[-2.73, -1.5, 1], [2.73, 1.5, -1]]) {
      place('stairs_metal', sx, sz, dir > 0 ? 0 : Math.PI, { seed: dir > 0 ? 3 : 4 }, 0, true);
      // a box in the stair's own measures: a..b along the run (-1.5 at the foot, 1.5 at the container), z across
      const box = (a, b, y0, y1, z0, z1, flags) => { const xa = CX + sx + dir * a, xb = CX + sx + dir * b; ph.addBox([Math.min(xa, xb), y0, sz + z0], [Math.max(xa, xb), y1, sz + z1], { surface: 'metal', ...flags }); };
      const WALK = { playerOnly: true }, SHOT = { bulletOnly: true };
      for (let j = 0; j < 48; j++) { const top = 2.6 * (j + 1) / 48; box(-1.5 + j * 0.05, -1.45 + j * 0.05, Math.max(0, top - 0.3), top, -0.47, 0.47, WALK); }
      box(0.9, 1.5, 2.4, 2.6, -0.5, 0.5, WALK);                                                                       // the landing
      for (let k = 0; k < 12; k++) box(-1.5 + k * 0.2, -1.25 + k * 0.2, (k + 1) * 0.2 - 0.03, (k + 1) * 0.2, -0.45, 0.45, SHOT);   // treads
      box(0.88, 1.52, 2.565, 2.6, -0.48, 0.48, SHOT);                                                                 // landing plate
      box(1.44, 1.5, 2.405, 2.565, -0.48, 0.48, SHOT); box(0.89, 0.95, 2.44, 2.56, -0.45, 0.45, SHOT);                // the beams across under it
      for (const side of [-1, 1]) {
        for (let k = 0; k < 48; k++) { const a = -1.43 + k * 2.37 / 48, b = a + 2.37 / 48; box(a, b, a + 1.39, b + 1.73, side * 0.465 - 0.012, side * 0.465 + 0.012, SHOT); }   // stringer: a plate 34 cm deep, rising 1 in 1
        box(0.87, 1.53, 2.405, 2.565, side * 0.47 - 0.03, side * 0.47 + 0.03, SHOT);                                  // the beam along the landing
        box(1.4, 1.48, 0, 2.41, side * 0.45 - 0.04, side * 0.45 + 0.04, {});                                          // post
        for (let k = 0; k < 6; k++) { const a = 1 + k * 0.44 / 6, b = a + 0.44 / 6, y = x => 2.4 - (x - 1) * 0.9 / 0.44; box(a, b, y(b) - 0.035, y(a) + 0.035, side * 0.45 - 0.025, side * 0.45 + 0.025, SHOT); }   // the brace from post to landing
      }
      for (let i = 0; i < 15; i++) {                      // handrail, tread by tread, and round the landing
        const foot = Math.min(2.6, 2.6 * (0.2 * i) / 2.4);
        for (const side of [-1, 1]) box(-1.5 + 0.2 * i, -1.3 + 0.2 * i, foot, Math.min(2.6, foot + 0.22) + 1.02, Math.min(side * 0.47, side * 0.53), Math.max(side * 0.47, side * 0.53), WALK);
      }
    }
    both(k => {
      place('crate_stack', k * 0.1, k * 4.05, 0.1 * k, { seed: 11 + k }); place('pallet_stack', k * -1.2, k * 5.4, 0.3, { seed: 13 + k });
      place('barrel', k * 2.6, k * -2.3, 0, { color: 'red', seed: 5 + k });
      // mid lanes: a long container on one side, a short one across the other, so each lane has one tall block
      place('container40', k * -13, k * 7.5, 0.015 * k, { color: k > 0 ? 'blue' : 'green', seed: 41 + k, wear: 0.55 });
      place('container20', k * -16, k * 7.5, 0.02, { color: k > 0 ? 'white' : 'red', seed: 51 + k, wear: 0.8 }, 2.59);
      place('container20', k * -10.5, k * -8.2, H - 0.02 * k, { color: k > 0 ? 'teal' : 'yellow', seed: 61 + k, wear: 0.6, doors: 0.35 });
      place('container20', k * -10.45, k * -8.0, H + 0.03 * k, { color: k > 0 ? 'grey' : 'blue', seed: 65 + k, wear: 0.75 }, 2.59);      // two high: the roof in the middle cannot see over it
      place('reefer_unit', k * -10.5, k * -11.5, H, { seed: 3 }, 0.14);
      // low cover between them: stone stacks, sandbags, a drum
      blockStack(k * -6.2, k * 3.0, 0.2 * k, 2, 1.0, 'stack', true); blockStack(k * -7.6, k * 3.9, -0.1, 3, 0.94, 'stack', true);      // the first two steps of the way up onto the long container (the third is set below)
      place('sandbags', k * -5.2, k * -4.6, 0.5, { seed: 71 + k }); place('sandbags', k * -3.6, k * -5.6, 0.5 + H * 0.2, { seed: 73 + k });
      drum(k * -17.4, k * 1.3, 0.03 * k, 0.52, 1.25, 0.95); drum(k * -18.5, k * -0.6, H + 0.03, 0.5, 1.2, 1.02);
      // in front of each gate: nothing can be seen from the middle roof to the gate
      for (let j = 0; j < 6; j++) bigStack(k * (-23.4 + jit(0.1)), k * (-2.93 + j * 1.17), H + jit(0.04), 3, 0.9 + 0.16 * seeded());        // a wall of them across the gate
      for (let j = 0; j < 5; j++) bigStack(k * (-21.3 + j * 1.17), k * (-7.9 + jit(0.08)), jit(0.04), 3, 0.92 + 0.14 * seeded());
      bigStack(k * -1.6, k * -12.6, H + 0.1, 3, 0.95); bigStack(k * -1.4, k * -13.9, H - 0.06, 3, 1.02); blockStack(k * -0.2, k * -11.6, 0.3, 2, 1.0);
      place('jersey_barrier', k * -22, k * 6.2, 0.9 * k, { seed: 5 }); place('jersey_barrier', k * -21.4, k * -4.6, -0.8 * k, { seed: 6 });
      place('tarp_cargo', k * -24.8, k * 7.9, H, { seed: 81 + k }); place('pallet_stack', k * -28.2, k * -8.8, -0.3, { seed: 83 + k });
      // north and south lanes
      place('forklift', k * 5.6, k * 13.6, 2.6 * k, { seed: 91 + k }); place('pallet', k * 7.8, k * 12.2, 0.4, { seed: 93 });
      place('generator', k * 14.5, k * 16.4, 0.12 * k, { seed: 95 + k }); place('barrel', k * 16.2, k * 15.1, 0, { color: 'red', seed: 97 + k });
      place('pipe_stack', k * -3.5, k * 19.4, 0.03 * k, { seed: 105 + k });
      drum(k * -8.6, k * 15.4, H + 0.02, 0.52, 1.25, 1.0); drum(k * -10.3, k * 16.5, 0.03, 0.52, 1.1, 0.9); blockStack(k * -12.6, k * 17.2, 0.6, 2, 0.96);
      place('gas_cylinders', k * 19.6, k * 11.6, 0.4, { seed: 113 + k });
      place('sandbags', k * 9.4, k * 3.2, H + 0.1, { seed: 115 + k }); place('crate_wood', k * 10.6, k * 2.2, 0.3, { seed: 117 + k });
      place('floodlight_stand', k * 3.4, k * -9.2, 2.2 * k, { seed: 119 }); place('floodlight_stand', k * -22.6, k * -11.6, 0.6 * k, { seed: 121 });
      /* the arena's own things */
      const turn = k > 0 ? 0 : Math.PI;                                                      // the far half is the near half turned round
      kit.cage(k * -19.5, k * 15.4, turn); kit.bales(k * -21.9, k * 13.0, H + turn, 3); kit.bales(k * 9.8, k * -15.6, turn, 4);
      kit.amphoraRack(k * 21.2, k * 9.3, turn);
      for (const [ax, az, dx, dz] of [[22.9, 10.4, 0.2, 0.05], [23.5, 9.5, -0.12, 0.2], [22.5, 11.2, 0.05, -0.2]]) kit.looseAmphora(k * ax, k * az, [dx, dz], 0.85 + seeded() * 0.2);
      kit.cart(k * -5.3, k * 15.7, H + 0.12 + turn, k > 0 ? 'hay' : 'amphorae');
      kit.weaponRack(k * 3.2, k * 6.6, H + turn); kit.shieldRack(k * 2.7, k * 19.5, Math.PI + turn);
      kit.brazier(k * -2.6, k * 9.8); kit.brazier(k * -14.4, k * -13.6); kit.brazier(k * -27.9, k * -2.9); kit.brazier(k * 12.8, k * 5.6);
      kit.trophy(k * -15.6, k * -2.4, H + turn);
      kit.standard(k * -32.4, k * 3.7, H + turn); kit.standard(k * -32.4, k * -3.7, H + turn); kit.standard(k * 5.5, k * 20.2, Math.PI + turn, 3.1);
      kit.palus(k * 13.2, k * -13.0); kit.palus(k * 14.7, k * -14.3); kit.palus(k * 12.3, k * -14.8);
      kit.trapdoor(k * -12.4, k * -0.7, 0.04 * k); kit.trapdoor(k * -23.0, k * -12.6, 0.4 + turn); kit.trapdoor(k * 8.4, k * -17.2, 0.08 + turn); kit.capstan(k * -13.2, k * 2.7, 0);
      kit.stump(k * -8.8, k * -15.8, 2.4); kit.stump(k * 17.0, k * -12.2, 1.5, 0.4); kit.capital(k * -7.0, k * -17.3, 0.4 + turn); kit.inscribed(k * -14.0, k * -18.0, turn);
      kit.altar(k * -2.6, k * 12.0, turn);
      for (const [hx, hz, n, spread] of [[-19.5, 15.2, 16, 2.0], [-21.7, 13.1, 12, 1.6], [9.8, -15.6, 14, 1.8], [-5.3, 15.7, 10, 1.8]]) for (let q = 0; q < n; q++) {
        const f = kit.at(k * hx + jit(2 * spread), k * hz + jit(2 * spread), seeded() * TAU), w = 0.22 + seeded() * 0.2;
        kit.quad(f, 'weeds', [[-w, 0.02, -w * 0.6], [w, 0.02, -w * 0.6], [w, 0.02, w * 0.6], [-w, 0.02, w * 0.6]], [0, 1, 0], 0.8 + seeded() * 0.4, [[0.5, 0], [1, 0], [1, 1], [0.5, 1]], '');
      }
      for (const [px, pz, pr] of [[-9.5, -11.6, 2.6], [2.2, -18.6, 2.0], [-27, -12.4, 2.2], [18.2, -3.4, 1.9], [-16.6, -5.4, 1.5], [24.5, 5.2, 2.2], [-4.2, -6.4, 1.7], [10.5, -18.2, 2.4], [-26.2, 4.6, 1.5], [6.8, 1.8, 1.3]]) kit.puddle(k * px, k * pz, pr);
    });
    /* The way up onto each long container: three stacks of stone, two, three and four layers high (0.95, 1.36 and
       1.76 m), the tallest against the container's side. A jump clears 1.27 m, so each is one jump from the last and
       the container's roof (2.59 m) is one jump from the tallest. Set here, after everything else, so that nothing
       placed before it moves. */
    both(k => blockStack(k * -8.0, k * 5.55, 0, 4, 0.98, 'stack', true));
    /* More standing water, found rather than listed: the storm left pools wherever the sand lies open. Places are thrown
       by the map's own dice and kept only where the whole pool, and its twin at the other end of the arena, is on bare
       sand: clear of every box, every placed thing, the wall, the stores' roofs and the pools already there. Large pools
       first, then small ones, half of them strung beside a large one the way puddles sit along a rut. */
    { const pools = kit.puddles;
      const bare = (x, z, r) => {
        if (outward(x, z).d > -(r + 1.0) || roofAt(CX + x, z, r + 0.3) !== null || ph.groundHeight(CX + x, z, 30) > 0.005) return false;
        for (let a = 0; a < 12; a++) for (const q of [1.15, 0.6]) if (ph.groundHeight(CX + x + Math.cos(a * TAU / 12) * r * q, z + Math.sin(a * TAU / 12) * r * q, 30) > 0.005) return false;
        return !placed.some(p => Math.hypot(p.x - CX - x, p.z - z) < r + 1.1) && !pools.some(p => Math.hypot(p.x - CX - x, p.z - z) < (p.r + r) * 0.9 + 0.25);
      };
      let added = 0;
      const tryAt = (x, z, r) => { if (!bare(x, z, r) || !bare(-x, -z, r)) return; kit.puddle(x, z, r); kit.puddle(-x, -z, r); added += 2; };
      for (let i = 0; i < 500 && added < 16; i++) tryAt((seeded() * 2 - 1) * (A - 4), (seeded() * 2 - 1) * (B - 3), 1.5 + seeded() * 1.5);
      const large = pools.slice();
      for (let i = 0; i < 1200 && added < 52; i++) {
        const r = 0.42 + seeded() * 0.7;
        if (seeded() < 0.5) { const b = large[Math.floor(seeded() * large.length)], a = seeded() * TAU, d = b.r * 0.9 + r + 0.3 + seeded() * 0.9; tryAt(b.x - CX + Math.cos(a) * d, b.z + Math.sin(a) * d, r); }
        else tryAt((seeded() * 2 - 1) * (A - 3), (seeded() * 2 - 1) * (B - 2.5), r);
      }
    }
    // merge what the game's props are made of into one mesh per material
    staticRoot.updateMatrixWorld(true);
    const groups = new Map(), merged = new T.Group(), kept = []; merged.name = 'col-props';
    let tris = 0;
    staticRoot.traverse(m => {
      if (!m.isMesh) return;
      if (Array.isArray(m.material) || m.isInstancedMesh || m.isSkinnedMesh) { kept.push(m); return; }
      let top = m; while (top.parent && top.parent !== staticRoot) top = top.parent;
      const q = 0, basic = !!m.material.isMeshBasicMaterial, cast = !m.material.transparent && !basic;
      const key = m.material.uuid + '|' + q + '|' + m.renderOrder;
      if (!groups.has(key)) groups.set(key, { mat: m.material, cast, recv: !basic, order: m.renderOrder, list: [] });
      groups.get(key).list.push(m);
    });
    const v = new T.Vector3(), nm = new T.Matrix3();
    for (const g of groups.values()) {
      let nv = 0, ni = 0;
      for (const m of g.list) { nv += m.geometry.attributes.position.count; ni += m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count; }
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3).fill(1), idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
      let vo = 0, io = 0;
      for (const m of g.list) {
        const ge = m.geometry, P = ge.attributes.position, Nn = ge.attributes.normal, Uv = ge.attributes.uv, Cc = ge.attributes.color;
        nm.getNormalMatrix(m.matrixWorld);
        for (let k = 0; k < P.count; k++) {
          v.fromBufferAttribute(P, k).applyMatrix4(m.matrixWorld); pos.set([v.x, v.y, v.z], (vo + k) * 3);
          if (Nn) { v.fromBufferAttribute(Nn, k).applyMatrix3(nm).normalize(); nor.set([v.x, v.y, v.z], (vo + k) * 3); } else nor[(vo + k) * 3 + 1] = 1;
          if (Uv) { uv[(vo + k) * 2] = Uv.getX(k); uv[(vo + k) * 2 + 1] = Uv.getY(k); }
          if (Cc) { col[(vo + k) * 3] = Cc.getX(k); col[(vo + k) * 3 + 1] = Cc.getY(k); col[(vo + k) * 3 + 2] = Cc.getZ(k); }
        }
        if (ge.index) for (let k = 0; k < ge.index.count; k++) idx[io++] = ge.index.getX(k) + vo; else for (let k = 0; k < P.count; k++) idx[io++] = vo + k;
        vo += P.count;
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.BufferAttribute(nor, 3)); geo.setAttribute('uv', new T.BufferAttribute(uv, 2)); geo.setAttribute('color', new T.BufferAttribute(col, 3));
      geo.setIndex(new T.BufferAttribute(idx, 1)); geo.computeBoundingSphere(); geo.computeBoundingBox();
      const mesh = new T.Mesh(geo, g.mat); mesh.castShadow = g.cast; mesh.receiveShadow = g.recv; mesh.renderOrder = g.order; mesh.matrixAutoUpdate = false;
      merged.add(mesh); tris += ni / 3;
    }
    for (const m of kept) { m.matrix.copy(m.matrixWorld); m.matrix.decompose(m.position, m.quaternion, m.scale); merged.add(m); }
    root.add(merged);

    // where players come in. West and east ends for the two teams (the game sends team one to x < -6 and team two to x > 13), the rest for everyone
    const spawns = [];
    both(k => { for (const [x, z] of [[-30.5, 0], [-29.6, 3.2], [-29.6, -3.2], [-25.5, 10.1], [-26.4, -10.4], [-24.2, 11.7], [-23, -14.6], [-19.4, 10.6]]) spawns.push([k * x, k * z]); });
    for (const [x, z] of [[0.6, 16.8], [0.4, -16.6], [6.4, 9.6], [8.2, -12.6], [2.6, -6.8], [12.6, 13.4], [5.2, 1.2]]) spawns.push([x, z]);
    return { placed, explosives, spawns, kit, fires: kit.fires, puddles: kit.puddles, tris: Math.round(tris), meshes: merged.children.length };
  }

  /* ------------------------------------------------------------------ dressing the building
     Torches in iron cups on the podium piers, with soot above them. Numerals cut over the service doors. The dedication
     in gold on the frieze of each box, under an eagle. Bronze shields on the high wall. Grime where water runs off.   */
  function dress(bld, sh, plan, kit, mats) {
    const F = SEC.face, UNIT = [[0, 0], [1, 0], [1, 1], [0, 1]];
    // a place on the ring, looking into the arena
    const facing = (s, d, y = 0) => { const f = frame(s); return kit.at(f.ex + d * f.nx - CX, f.ez + d * f.nz, Math.atan2(-f.nx, -f.nz), y); };
    const flat = (mat, s0, s1, d, y0, y1, uv = UNIT, col = 1) => { if (mats[mat]) bld.add(mat, [[s0, d, y0], [s1, d, y0], [s1, d, y1], [s0, d, y1]], [0, -1, 0], uv, col, ''); };
    for (let i = 0; i < NB; i += 2) {
      if (plan.bay[i] !== 'panel' || plan.bay[(i + NB - 1) % NB] !== 'panel' || plan.crown[i] !== 'std' || plan.crown[(i + NB - 1) % NB] !== 'std') continue;
      const s = i * HB, f = facing(s, F - 0.016);
      kit.pole(f, 'iron', [0, 2.03, 0], [0, 2.03, 0.22], 0.03, 0.8); kit.pole(f, 'iron', [0, 1.86, 0.005], [0, 2.02, 0.2], 0.025, 0.8);
      kit.turn(f, 'iron', [0, 2.0, 0.24], [[0.03, 0, 0.7], [0.075, 0.1], [0.086, 0.2], [0.07, 0.2, 0.4]], 8, 0.85);
      kit.turn(f, 'ember', [0, 2.2, 0.24], [[0.066, 0], [0, 0.03]], 6, 1, { shadow: '' });
      { const w = f.P(0, 2.19, 0.24); kit.fires.push({ x: w[0], y: w[1], z: w[2], r: 0.13, h: 0.46 }); }
      flat('grime', s - 0.2, s + 0.2, F - 0.022, 2.3, 3.14, [[0, 1], [1, 1], [1, 0], [0, 0]], 1);                 // soot, thinning as it climbs
      bld.count('torches');
    }
    let door = 0;
    for (let i = 0; i < NB; i++) if (plan.bay[i] === 'door') { const sc = (i + 0.5) * HB, u0 = door / 8, u1 = (door + 1) / 8; flat('letters', sc - 0.34, sc + 0.34, F - 0.004, 2.83, 3.13, [[u0, 0.04], [u1, 0.04], [u1, 0.46], [u0, 0.46]]); door++; bld.count('numerals'); }
    // each box: the dedication on its frieze, and an eagle on the point of its gable
    for (const sc of [20 * HB, 60 * HB]) {
      flat('lettersGold', sc - 2.3, sc + 2.3, 0.55 - 0.275, 7.83, 8.07, [[0.07, 0.79], [0.93, 0.79], [0.93, 0.97], [0.07, 0.97]]);
      kit.eagle(facing(sc, 0.06, 9.67), [0, 0, 0], 1.25, 1.1);
    }
    // bronze shields on the high wall, between the banners
    const w3 = SEC.wall3;
    for (let i = 2; i < NB; i += 4) { kit.turn(facing((i + 0.5) * HB, w3.d - 0.01, w3.y0 + 2.7), 'bronze', [0, 0, 0], [[0.62, 0, 0.7], [0.6, 0.03], [0.5, 0.06, 0.55], [0.2, 0.13], [0, 0.17, 1.2]], 14, 0.85 + 0.25 * hash(i, 120), { dir: [0, 0, 1], shadow: 'r' }); bld.count('wallShields'); }
    // a row of dentils under the cornice: small square blocks, the detail that makes a Roman cornice read as one
    for (let i = 0; i < NB; i++) {
      if (plan.crown[i] === 'gate') continue;
      for (let k = 0; k < 12; k++) { const a = (i + (k + 0.25) / 12) * HB, t = 0.82 + 0.2 * hash(i, 130, k); sh.box('trav', a, a + HB / 24, F - 0.075, F - 0.01, 3.05, 3.146, { faces: 'fblr', col: t, side: t * 0.7, u0: hash(i, 131, k) * 9, shadow: 'cr' }); }
      bld.count('dentils', 12);
    }
    // garlands of laurel swung from post to post either side of each box, tied with red
    for (let i = 0; i < NB; i++) {
      if (plan.crown[i] !== 'std' || !((i >= 12 && i <= 27) || (i >= 52 && i <= 67))) continue;
      const a = i * HB + 0.2, b = (i + 1) * HB - 0.2, SEG = 6, SIDES = 5, R = 0.07, tone = 1.5 + 0.7 * hash(i, 132);
      for (let k = 0; k < SEG; k++) {
        const at2 = t => ({ s: lerp(a, b, t), y: 4.4 - 0.36 * Math.sin(Math.PI * t), fat: R * (0.75 + 0.45 * Math.sin(Math.PI * t)) }), A0 = at2(k / SEG), A1 = at2((k + 1) / SEG);
        for (let c = 0; c < SIDES; c++) { const a0 = (c / SIDES) * TAU, a1 = ((c + 1) / SIDES) * TAU, pt = (P, ang) => [P.s, 0.07 + Math.cos(ang) * P.fat, P.y + Math.sin(ang) * P.fat], nn = ang => [0, Math.cos(ang), Math.sin(ang)]; bld.add('laurel', [pt(A0, a0), pt(A1, a0), pt(A1, a1), pt(A0, a1)], [nn(a0), nn(a0), nn(a1), nn(a1)], [[k, a0], [k + 1, a0], [k + 1, a1], [k, a1]], tone * (0.8 + 0.4 * hash(i, k, c)), 'r'); }
      }
      for (const e of [a, b]) bld.add('canvasRed', [[e - 0.05, 0.06, 4.42], [e + 0.05, 0.06, 4.42], [e + 0.08, 0.05, 4.0], [e - 0.08, 0.05, 4.0]], [0, -1, 0], UNIT, 0.9, 'r');
      bld.count('garlands');
    }
    // along the foot of the wall: weeds in the angle, and small stone that has come away
    const rnd = rng(4242);
    for (let i = 0; i < NB; i++) {
      if (plan.bay[i] === 'gate') continue;
      for (let k = 0; k < 3; k++) {
        if (rnd() < 0.3) continue;
        const f = facing((i + rnd()) * HB, -0.1 - rnd() * 0.22), w = 0.2 + rnd() * 0.2, h = 0.22 + rnd() * 0.34, dry = rnd() < 0.3 ? 0.5 : 0, t = 0.7 + rnd() * 0.5, ang = rnd() * TAU;
        for (const q of [0, 1.57]) { const c = Math.cos(ang + q) * w, s2 = Math.sin(ang + q) * w; kit.quad(f, 'weeds', [[-c, 0, -s2], [c, 0, s2], [c, h, s2], [-c, h, -s2]], [0, 0.85, 0.5], t, [[dry, 0], [dry + 0.5, 0], [dry + 0.5, 1], [dry, 1]], ''); }
        bld.count('weeds');
      }
      for (let k = 0; k < 2; k++) {
        if (rnd() < 0.45) continue;
        const f = facing((i + rnd()) * HB, -0.15 - rnd() * 0.7), w = 0.04 + rnd() * 0.09, f2 = kit.at(f.x, f.z, rnd() * TAU);
        kit.box(f2, 'trav', [0, w * 0.45, 0], [w, w * (0.4 + rnd() * 0.3), w * (0.6 + rnd() * 0.6)], 0.7 + rnd() * 0.4, { shadow: 'r' });
        bld.count('rubble');
      }
    }
    // where water runs off: streaks down the parapet and the first wall
    for (let i = 0; i < NB; i++) {
      if (plan.crown[i] === 'std' && hash(i, 121) < 0.5) { const sc = (i + 0.25 + 0.5 * hash(i, 122)) * HB, w = 0.2 + 0.2 * hash(i, 123); flat('grime', sc - w, sc + w, 0.181, 3.62, 4.36, UNIT, 1); }
      if (hash(i, 124) < 0.4) { const sc = (i + 0.5 * hash(i, 125)) * HB, w = metres(sc, SEC.wall1.d, 0.35 + 0.3 * hash(i, 126)); flat('grime', sc - w, sc + w, SEC.wall1.d - 0.012, SEC.wall1.y0 + 0.2, SEC.wall1.y1, UNIT, 1); }
      if (hash(i, 127) < 0.3) { const sc = (i + 0.5 * hash(i, 128)) * HB, w = metres(sc, SEC.wall2.d, 0.5 + 0.4 * hash(i, 129)); flat('grime', sc - w, sc + w, SEC.wall2.d - 0.012, SEC.wall2.y0 + 0.3, SEC.wall2.y1, UNIT, 1); }
    }
  }

  /* ------------------------------------------------------------------ fire
     Every flame is a small volume of burning gas, not a shape: a box round each fire, and for each pixel of it the
     shader walks the ray through the box and adds up what is burning there. The flame is a column that tapers, leans
     and breaks up as noise scrolls up through it; hot gas is white-yellow low in the core and cools to orange and red
     at the edges and the tips. One mesh draws them all. The values are bright on purpose: the game's bloom does the glow. */
  function makeFire(G, fires, root) {
    const T = G.THREE, N = 32, raw = new Float32Array(N * N * N), data = new Uint8Array(N * N * N), rnd = rng(9001);
    for (let i = 0; i < raw.length; i++) raw[i] = rnd();
    const at = (x, y, z) => raw[((z + N) % N) * N * N + ((y + N) % N) * N + ((x + N) % N)];
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {      // soften once, wrapping, so it tiles and flows
      const v = (at(x, y, z) * 2 + at(x + 1, y, z) + at(x - 1, y, z) + at(x, y + 1, z) + at(x, y - 1, z) + at(x, y, z + 1) + at(x, y, z - 1)) / 8;
      data[z * N * N + y * N + x] = clamp((v - 0.5) * 2.6 + 0.5, 0, 1) * 255;
    }
    const noise = new T.Data3DTexture(data, N, N, N);
    noise.format = T.RedFormat; noise.type = T.UnsignedByteType; noise.wrapS = noise.wrapT = noise.wrapR = T.RepeatWrapping; noise.minFilter = noise.magFilter = T.LinearFilter; noise.unpackAlignment = 1; noise.needsUpdate = true;
    const pos = [], base = [], dim = [], seed = [], idx = [];
    fires.forEach((f, k) => {
      const v0 = pos.length / 3, r = f.r * 1.25, h = f.h;
      for (const [sx, sy, sz] of [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1], [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]]) { pos.push(f.x + sx * r, f.y + sy * h, f.z + sz * r); base.push(f.x, f.y, f.z); dim.push(r, h); seed.push(hash(k, 77) * 9); }
      for (const q of [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]) idx.push(v0 + q[0], v0 + q[1], v0 + q[2], v0 + q[0], v0 + q[2], v0 + q[3]);
    });
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('aBase', new T.Float32BufferAttribute(base, 3));
    geo.setAttribute('aDim', new T.Float32BufferAttribute(dim, 2)); geo.setAttribute('aSeed', new T.Float32BufferAttribute(seed, 1)); geo.setIndex(idx);
    const mat = new T.ShaderMaterial({
      uniforms: { uNoise: { value: noise }, uTime: { value: 0 } },
      side: T.DoubleSide, transparent: true, depthWrite: false, toneMapped: false, blending: T.CustomBlending, blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor,
      vertexShader: `
        attribute vec3 aBase; attribute vec2 aDim; attribute float aSeed;
        varying vec3 vW; varying vec3 vBase; varying vec2 vDim; varying float vSeed;
        void main(){ vW = position; vBase = aBase; vDim = aDim; vSeed = aSeed; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        precision highp sampler3D;
        uniform sampler3D uNoise; uniform float uTime;
        varying vec3 vW; varying vec3 vBase; varying vec2 vDim; varying float vSeed;
        void main(){
          // only the far side of the box draws, so the flame is there whether the eye is outside the box or in it
          if (gl_FrontFacing) discard;
          vec3 ro = cameraPosition, rd = normalize(vW - cameraPosition);
          vec3 bmin = vBase - vec3(vDim.x, 0.0, vDim.x), bmax = vBase + vec3(vDim.x, vDim.y, vDim.x);
          vec3 inv = 1.0 / rd, t0 = (bmin - ro) * inv, t1 = (bmax - ro) * inv, near3 = min(t0, t1), far3 = max(t0, t1);
          float tn = max(max(near3.x, near3.y), max(near3.z, 0.0)), tf = min(min(far3.x, far3.y), far3.z);
          if (tf <= tn) discard;
          const int STEPS = 24;
          float dt = (tf - tn) / float(STEPS), t = tn + dt * 0.6 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          vec3 acc = vec3(0.0); float alpha = 0.0;
          for (int i = 0; i < STEPS; i++) {
            vec3 q = (ro + rd * t - vBase) / vec3(vDim.x, vDim.y, vDim.x); t += dt;                 // x, z in -1..1; y from 0 at the coals to 1 at the tip
            float y = q.y;
            vec3 s = vec3(q.x, y * 1.7, q.z) * 0.42 + vSeed;
            float n1 = texture(uNoise, s - vec3(0.0, uTime * 0.62, 0.0)).r;                       // slow, large: the body sways and swells
            float n2 = texture(uNoise, s * 2.6 - vec3(uTime * 0.11, uTime * 1.25, 0.0)).r;         // fast, fine: tongues tearing off upward
            vec2 lean = (vec2(n1, texture(uNoise, vec3(vSeed, uTime * 0.19, y * 0.5)).r) - 0.5) * 0.85 * y;
            float width = mix(0.70, 0.0, pow(y, 0.9)) * (0.58 + 0.84 * n1);
            float d = smoothstep(width, width * 0.2, length(q.xz - lean));
            d *= smoothstep(0.0, 0.07, y) * (1.0 - smoothstep(0.42, 1.0, y + (n2 - 0.5) * 0.95));
            d *= 0.35 + 1.25 * n2;
            if (d > 0.01) {
              float heat = d * (1.3 - 0.95 * y);
              vec3 col = mix(vec3(0.85, 0.10, 0.015), vec3(1.0, 0.42, 0.05), smoothstep(0.08, 0.45, heat));
              col = mix(col, vec3(1.0, 0.76, 0.28), smoothstep(0.50, 0.98, heat));
              col = mix(col, vec3(1.0, 0.93, 0.70), smoothstep(1.0, 1.45, heat));
              float a = clamp(d * dt / vDim.x * 2.4, 0.0, 1.0);
              acc += col * (1.3 + 4.0 * heat) * a * (1.0 - alpha);
              alpha += a * (1.0 - alpha);
            }
          }
          gl_FragColor = vec4(acc, alpha * 0.42);
        }`,
    });
    const mesh = new T.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 6; mesh.name = 'col:fire'; mesh.castShadow = mesh.receiveShadow = false; mesh.matrixAutoUpdate = false;
    root.add(mesh);
    return { count: fires.length, update(t) { mat.uniforms.uTime.value = t; } };
  }

  /* ------------------------------------------------------------------ standing water
     After the storm the sand holds pools. Each is a soft-edged sheet that mirrors the arena: the game already renders
     the world upside down once a frame for the harbour's puddles (its planar reflection), and these pools read the same
     picture. Rain rings and a breeze ruffle the mirror. Where the quality setting turns the mirror off, they show sky. */
  let POOLS = null;
  function makePuddles(G, puddles, root) {
    const T = G.THREE, pos = [], edge = [], idx = [], K = 24;
    for (const p of puddles) {
      const c = Math.cos(p.turn), s = Math.sin(p.turn), v0 = pos.length / 3;
      pos.push(p.x, 0.017, p.z); edge.push(1);
      for (const [scale, e] of [[0.6, 1], [1, 0]]) for (let k = 0; k < K; k++) {
        const a = (k / K) * TAU, rr = p.r * scale * (0.7 + 0.36 * noise2(p.seed + Math.cos(a) * 1.4, p.seed * 0.7 + Math.sin(a) * 1.4) + 0.1 * Math.cos(a * 3 + p.seed)), lx = Math.cos(a) * rr, lz = Math.sin(a) * rr * p.squash;
        pos.push(p.x + lx * c + lz * s, 0.017, p.z - lx * s + lz * c); edge.push(e);
      }
      for (let k = 0; k < K; k++) { const a = v0 + 1 + k, b = v0 + 1 + ((k + 1) % K); idx.push(v0, a, b, a, a + K, b + K, a, b + K, b); }
    }
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('aEdge', new T.Float32BufferAttribute(edge, 1)); geo.setIndex(idx);
    const mat = new T.ShaderMaterial({
      uniforms: { uRefl: { value: null }, uReflMatrix: { value: new T.Matrix4() }, uReflOn: { value: 0 }, uTime: { value: 0 }, uSky: { value: new T.Color(0.42, 0.47, 0.54) } },
      side: T.DoubleSide, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, blending: T.CustomBlending, blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor,
      vertexShader: 'attribute float aEdge; varying vec3 vW; varying float vEdge; void main(){ vW = position; vEdge = aEdge; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform sampler2D uRefl; uniform mat4 uReflMatrix; uniform float uReflOn, uTime; uniform vec3 uSky;
        varying vec3 vW; varying float vEdge;
        // one raindrop's ring in each cell of a grid, each on its own clock
        float ring(vec2 p, float t){ vec2 c = floor(p), f = fract(p) - 0.5; float h = fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453), ph = fract(t * 0.55 + h);
          float d = length(f - (vec2(fract(h * 17.0), fract(h * 71.0)) - 0.5) * 0.5), r = 0.36 * ph; return sin(46.0 * (d - r)) * smoothstep(r + 0.03, r, d) * smoothstep(r - 0.09, r, d) * (1.0 - ph); }
        void main(){
          vec3 V = normalize(cameraPosition - vW);
          vec2 ruffle = vec2(sin(vW.x * 9.0 + uTime * 1.7) + sin(vW.z * 13.0 - uTime * 1.3), sin(vW.z * 8.0 + uTime * 1.5) + sin(vW.x * 12.0 + uTime * 1.1)) * 0.012;
          float drops = ring(vW.xz * 2.3, uTime) + ring(vW.xz * 3.7 + 5.0, uTime * 1.3 + 2.0);
          ruffle += drops * 0.05;
          vec4 rc = uReflMatrix * vec4(vW.x + ruffle.x, 0.0, vW.z + ruffle.y, 1.0);
          vec3 refl = uReflOn > 0.5 ? texture2D(uRefl, rc.xy / rc.w).rgb : uSky;
          float fres = 0.03 + 0.97 * pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
          vec3 col = vec3(0.050, 0.042, 0.030) * (1.0 - fres) + refl * (0.08 + 0.92 * fres);       // wet sand under a finger of water, and the mirror over it
          col += max(drops, 0.0) * uSky * (0.10 + 0.25 * fres);                                     // each raindrop's ring catches the sky, so the rain shows even where the mirror is dark
          float a = smoothstep(0.0, 0.6, vEdge);
          gl_FragColor = vec4(col * a, a * (0.6 + 0.4 * fres));
        }`,
    });
    const mesh = new T.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 2; mesh.name = 'col:pools'; mesh.castShadow = mesh.receiveShadow = false; mesh.matrixAutoUpdate = false;
    root.add(mesh);
    // a pool must not be in the upside-down picture it reads from: hide them all before the mirror pass (the ground stage shows them again after it)
    if (G.render.addPrePass) G.render.addPrePass(() => { mesh.visible = false; });
    return (POOLS = { mesh, mat, update(t) { mat.uniforms.uTime.value = t; } });
  }

  /* ------------------------------------------------------------------ meshes from the builder */
  function toMeshes(G, bld, mats, root) {
    const T = G.THREE; let tris = 0, meshes = 0;
    for (const b of bld.buckets.values()) {
      if (!b.nv) continue;
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(b.p, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(b.n, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(b.u, 2)); g.setAttribute('color', new T.Float32BufferAttribute(b.c, 3));
      g.setIndex(b.nv > 65535 ? new T.Uint32BufferAttribute(b.i, 1) : new T.Uint16BufferAttribute(b.i, 1));
      g.computeBoundingSphere(); g.computeBoundingBox();
      if (!mats[b.mat]) continue;                                                   // a material this build could not make: leave the detail off
      const m = new T.Mesh(g, mats[b.mat]);
      m.castShadow = b.shadow.includes('c'); m.receiveShadow = b.shadow.includes('r'); m.name = 'col:' + b.mat + ':' + b.sector;
      m.matrixAutoUpdate = false; m.updateMatrix();
      root.add(m); tris += b.i.length / 3; meshes++;
    }
    return { tris, meshes };
  }

  /* ------------------------------------------------------------------ collision
     The game's physics is boxes plus a flat ground. The arena wall is added on top as an exact ellipse:
       - the player's capsule is kept inside it (smooth sliding, and nobody climbs out over a stack of crates)
       - shots hit the wall where it really is, and above the parapet they go on to land on the stands
       - grenades find the stands as ground
     Boxes behind the wall mark the outside as solid for the game's walk grid, which also draws the minimap.          */
  function installPhysics(G) {
    const T = G.THREE, ph = G.physics, move = ph.moveCapsule, cast = ph.raycast, groundH = ph.groundHeight;
    ph.moveCapsule = function (pos, vel, dt, radius = 0.32, height = 1.8, step = true) {
      const yWas = pos.y, res = move.call(ph, pos, vel, dt, radius, height, step), px = pos.x - CX, pz = pos.z, ra = A - radius - 0.4, rb = B - radius - 0.4;
      if ((px * px) / (ra * ra) + (pz * pz) / (rb * rb) >= 1) {                    // near the wall (well inside is the usual case)
        const o = outward(px, pz);
        if (o.d > -radius) {
          pos.x = CX + o.qx - o.nx * radius; pos.z = o.qz - o.nz * radius;
          const vn = vel.x * o.nx + vel.z * o.nz;
          if (vn > 0) { vel.x -= o.nx * vn; vel.z -= o.nz * vn; }
          res.hitWall = true;
        }
      }
      /* A store roof: stand on the slope itself. Whoever was above the tiles and would now be at or under them has
         landed, at any speed; whoever the game has stood on a box under the tiles is lifted onto them. Nobody comes
         up through the roof from below: they were never above it. */
      if (vel.y <= 0 && pos.y < STORES.y0 + 0.05 && pos.y > STORES.y1 - 0.7) {
        const h = roofAt(pos.x, pos.z, radius * 0.7);
        if (h !== null && pos.y <= h + 0.02 && (yWas >= h - 0.06 || (res.onGround && pos.y >= h - 0.45))) { pos.y = h; vel.y = 0; res.onGround = true; res.surface = 'concrete'; }
      }
      return res;
    };
    const hitAt = (o, d, t, nx, ny, nz) => ({ dist: t, point: new T.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t), normal: new T.Vector3(nx, ny, nz), surface: 'concrete', box: null });
    ph.raycast = function (o, d, max = 500) {
      let base = cast.call(ph, o, d, max);
      // a store roof: a shot from above lands on the tiles, from below on the boards 6 cm under them
      for (const r of roofs()) {
        const dn = d.x * r.nx + d.y * r.ny + d.z * r.nz; if (dn > -1e-6 && dn < 1e-6) continue;
        const under = dn > 0, t = ((r.x - o.x) * r.nx + (r.y - (under ? 0.06 : 0) - o.y) * r.ny + (r.z - o.z) * r.nz) / dn;
        if (t <= 1e-4 || t >= (base ? base.dist : max) || roofInset(r, o.x + d.x * t, o.z + d.z * t) < 0) continue;
        base = hitAt(o, d, t, under ? -r.nx : r.nx, under ? -r.ny : r.ny, under ? -r.nz : r.nz); base.surface = under ? 'wood' : 'concrete';
      }
      const limit = base ? base.dist : max, ox = o.x - CX, oz = o.z;
      // where the ray leaves the arena
      const qa = (d.x * d.x) / (A * A) + (d.z * d.z) / (B * B), qb = (ox * d.x) / (A * A) + (oz * d.z) / (B * B), qc = (ox * ox) / (A * A) + (oz * oz) / (B * B) - 1;
      let t = 0;
      if (qc < 0) {
        if (qa < 1e-12) return base;                                              // straight up or down, inside
        t = (-qb + Math.sqrt(Math.max(0, qb * qb - qa * qc))) / qa;
        if (t >= limit) return base;
        const y = o.y + d.y * t;
        if (y < 0) return base;                                                   // into the ground first (the base cast has it)
        if (y <= WALL_TOP) { const x = ox + d.x * t, z = oz + d.z * t, nx = x / (A * A), nz = z / (B * B), nl = Math.hypot(nx, nz) || 1; return hitAt(o, d, t, -nx / nl, 0, -nz / nl); }
      }
      // over the parapet: walk the ray across the stands until it goes under them
      const STEP = 0.5; let prev = t;
      for (let k = 0; k < 400; k++) {
        t += STEP; if (t >= limit) return base;
        const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t, out = outward(x - CX, z).d;
        if (out > SEC.attic.d1 + 1 || y > SEC.attic.mast + 2) return y > 0 ? null : base;   // out over the rim: sky
        if (y < profileY(out)) {
          let a = prev, b = t;
          for (let it = 0; it < 10; it++) { const m = (a + b) / 2; if (o.y + d.y * m < profileY(outward(o.x + d.x * m - CX, o.z + d.z * m).d)) b = m; else a = m; }
          const hx = o.x + d.x * b, hz = o.z + d.z * b, oo = outward(hx - CX, hz), e = 0.06, slope = (profileY(oo.d + e) - profileY(oo.d - e)) / (2 * e), nl = Math.hypot(slope, 1);
          return hitAt(o, d, b, -oo.nx * slope / nl, 1 / nl, -oo.nz * slope / nl);
        }
        prev = t;
      }
      return base;
    };
    ph.groundHeight = function (x, z, maxY = 50) {
      const g = groundH.call(ph, x, z, maxY);
      if (inside(x - CX, z)) { const h = maxY > STORES.y1 - 0.2 ? roofAt(x, z) : null; return h !== null && h <= maxY && h > g ? h : g; }
      const y = standsY(x, z);
      return y <= maxY && y > g ? y : g;
    };
    // the statues stop shots (and nothing else): they stand outside the arena, where only a shot can reach
    for (const b of STATUES) ph.addBox(b.min, b.max, { surface: 'concrete', bulletOnly: true, noNav: true });
    // the outside of the ellipse as boxes, one walk-grid row at a time, set back 0.45 m so the exact wall always wins
    const b = ph.bounds, z0 = b.min.z - 2, z1 = b.max.z, x0 = b.min.x, x1 = b.max.x, ROW = 0.5;
    for (let z = z0; z < z1; z += ROW) {
      const zc = Math.min(Math.abs(z), Math.abs(z + ROW)), half = zc < B + 0.45 ? (A + 0.45) * Math.sqrt(1 - (zc * zc) / ((B + 0.45) * (B + 0.45))) : -1;
      if (half < 0) { ph.addBox([x0, 0, z], [x1, WALL_TOP, z + ROW], { surface: 'concrete', tag: 'stands' }); continue; }
      if (CX - half > x0) ph.addBox([x0, 0, z], [CX - half, WALL_TOP, z + ROW], { surface: 'concrete', tag: 'stands' });
      if (CX + half < x1) ph.addBox([CX + half, 0, z], [x1, WALL_TOP, z + ROW], { surface: 'concrete', tag: 'stands' });
    }
  }

  /* The sun's shadow map is fitted to the harbour when the renderer starts. Refit it to the whole bowl, so the rim, the
     masts and the awning throw their shadows across the seats and the sand, and keep the soft edge as wide as before. */
  function fitShadows(G) {
    const T = G.THREE, sun = G.render.sun, cam = sun.shadow.camera, w0 = cam.right - cam.left, h0 = cam.top - cam.bottom, depth0 = cam.far - cam.near;
    const dir = G.consts.sun.dir.clone().normalize(), centre = new T.Vector3(CX, 14, 0);
    sun.target.position.copy(centre); sun.position.copy(centre).addScaledVector(dir, 220); sun.updateMatrixWorld(true); sun.target.updateMatrixWorld(true);
    const view = new T.Matrix4().lookAt(sun.position, centre, new T.Vector3(0, 1, 0)); view.setPosition(sun.position); view.invert();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, n0 = 1e9, n1 = -1e9; const v = new T.Vector3();
    for (let k = 0; k < 96; k++) for (const [d, y] of [[0, 0], [SEC.attic.d1, 0], [SEC.attic.d1, SEC.attic.mast + 1], [SEC.portico.col, SEC.portico.beam]]) {
      const [x, z] = ringAt((k / 96) * L, d); v.set(x, y, z).applyMatrix4(view);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); n0 = Math.min(n0, -v.z); n1 = Math.max(n1, -v.z);
    }
    cam.left = x0 - 1; cam.right = x1 + 1; cam.bottom = y0 - 1; cam.top = y1 + 1; cam.near = Math.max(1, n0 - 4); cam.far = Math.max(n1 + 4, cam.near + depth0);
    cam.updateProjectionMatrix();
    sun.shadow.radius *= Math.sqrt((w0 / (cam.right - cam.left)) * (h0 / (cam.top - cam.bottom)));
    sun.shadow.needsUpdate = true;
    return { width: cam.right - cam.left, height: cam.top - cam.bottom, depth: cam.far - cam.near };
  }

  /* The game's sky is a storm deck at dawn: nearly black away from the sun, which is right beside a low orange sun and
     wrong beside sunlit stone. Lift it away from the sun (the hole the sun burns through stays as it is), and take the
     scene's ambient light from the lifted sky, the way the game takes it from its own.                               */
  function liftSky(G) {
    const T = G.THREE, sky = G.render.sky, mat = sky && sky.material, mark = 'col = mix(col, min(col, vec3(6.0)), uEnv);';
    if (!mat || !mat.fragmentShader || !mat.fragmentShader.includes(mark)) { console.warn('[colosseum] sky not lifted: the sky shader has changed'); return false; }
    mat.fragmentShader = mat.fragmentShader.replace(mark, 'col *= mix(vec3(4.4, 4.2, 3.9), vec3(1.0), pow(s, 1.5));\n  ' + mark);
    mat.needsUpdate = true;
    const pm = new T.PMREMGenerator(G.renderer), env = mat.clone(), scene = new T.Scene(), mesh = new T.Mesh(sky.geometry, env);
    env.uniforms.tNoise.value = mat.uniforms.tNoise.value; env.uniforms.uEnv.value = 1; mesh.frustumCulled = false; scene.add(mesh);
    const keep = G.renderer.getRenderTarget(), rt = pm.fromScene(scene, 0, 0.1, 100);
    G.renderer.setRenderTarget(keep); env.dispose(); pm.dispose();
    G.scene.environment = rt.texture; G.render.env = rt.texture;
    G.scene.environmentIntensity *= 0.36;       // the lifted sky is brighter all round; without this its light would drown the sun and flatten every shadow
    return true;
  }

  /* ------------------------------------------------------------------ the level */
  // what stands in each bay of the podium: the two great gates on the long axis, the two boxes on the short one, service doors, panels
  function bayPlan() {
    const bay = new Array(NB).fill('panel'), crown = new Array(NB).fill('std');
    for (const i of [NB - 1, 0, NB / 2 - 1, NB / 2]) { bay[i] = 'gate'; crown[i] = 'gate'; }
    for (const i0 of [18, 58]) { for (let k = 0; k < 4; k++) crown[i0 + k] = 'box'; bay[i0 + 1] = bay[i0 + 2] = 'boxdoor'; }
    for (let i = 5; i < NB; i += 10) bay[i] = 'door';
    return { bay, crown };
  }

  let PUDDLES = [];        // where water stands, for the ground stage (splashes and wet footsteps)

  async function level(G) {
    const T = G.THREE, root = new T.Group(); root.name = 'level'; G.scene.add(root);
    const sets = makeTextures(G), mats = makeMaterials(G, sets), bld = makeBuilder(), sh = shapes(bld), plan = bayPlan();
    const pod = buildPodium(bld, sh, plan);
    buildGates(bld, sh, pod);
    buildBoxes(bld, sh, pod);
    buildStands(bld, sh, plan);
    buildStatues(bld, sh);
    buildRepairs(bld, sh);
    buildTop(bld, sh);
    buildProxies(bld, sh);
    buildAwning(bld, sh);
    const fur = furnish(G, bld, root, sh);
    buildFloor(bld, fur.puddles, fur.fires.filter(f => f.big && f.y < 1.1));
    dress(bld, sh, plan, fur.kit, mats);
    PUDDLES = fur.puddles;
    const fire = makeFire(G, fur.fires, root), crackle = makeFireSound(G, fur.fires), pools = makePuddles(G, fur.puddles, root);
    FIRE_VOICES = crackle.state;
    const built = toMeshes(G, bld, mats, root);
    installPhysics(G);
    const shadow = fitShadows(G), skyLifted = liftSky(G);
    G.mats.uniforms.wet.value = 0.82;
    if (G.render.tune) Object.assign(G.render.tune, { aoIntensity: 2.1, aoRadius: 1.15, volSunScale: 1.15, volSigma: 0.0042 });   // closer contact shadows; sun shafts that show in the damp air
    /* Light the bowl throws back. A storm sky alone leaves the shade black beside sunlit stone, which no pale stone
       arena ever is: the sand and the lit stands bounce warm light into it. A sky-and-ground light for the general
       lift, and one soft light from the lit side for the shaded stands and the south wall. Neither casts a shadow. */
    const hemi = new T.HemisphereLight(new T.Color(0.52, 0.60, 0.74), new T.Color(0.66, 0.53, 0.36), 0.62), back = new T.DirectionalLight(new T.Color(1.0, 0.85, 0.64), 0.7);
    back.position.set(CX - 18, 16, 60); back.target.position.set(CX, 8, 0); back.castShadow = false;
    for (const l of [hemi, back]) { l.layers.enable(1); root.add(l); }
    root.add(back.target);

    // firelight: three of the game's six spare lights go to braziers in the shade, the rest keep serving muzzle flashes
    const lit = [];
    for (const f of fur.fires.filter(f => f.big).sort((p, q) => p.z - q.z)) {
      if (lit.length >= 3 || lit.some(l => Math.hypot(l.x - f.x, l.z - f.z) < 12)) continue;
      const h = G.render.lightPool && G.render.lightPool.acquire(); if (!h) break;
      h.light.color.setRGB(1, 0.52, 0.2); h.light.distance = 10; h.light.position.set(f.x, f.y + 0.45, f.z);
      lit.push({ x: f.x, z: f.z, light: h.light, seed: lit.length * 17.3 });
    }
    const sp = (x, z) => ({ pos: new T.Vector3(CX + x, 0, z), zone: 'arena', type: 'ground' });
    let fill = 1.1, clock = 0; const fwd = new T.Vector3();
    return {
      root, name: 'Colosseum',
      playerStart: { pos: new T.Vector3(CX - 30.5, 0, 0), yaw: -Math.PI / 2 },
      objectives: [], extraction: { pos: new T.Vector3(CX, -50, 0), radius: 1 },
      enemySpawns: fur.spawns.map(([x, z]) => sp(x, z)),
      zones: [{ name: 'arena', min: [-40, -30], max: [40, 30] }], interiorBoxes: [], coverPoints: [], skylights: [], shedLights: [], placed: fur.placed,
      cinematicPath: [
        { pos: [CX - 31, 1.7, 0.6], look: [CX - 20, 3.2, 1.5] }, { pos: [CX - 26.5, 1.7, 6.5], look: [CX - 12, 4, 14] }, { pos: [CX - 15, 1.8, 12.5], look: [CX - 2, 5.5, 21] },
        { pos: [CX - 5, 1.8, 10.5], look: [CX + 2.5, 2.2, 19.5] }, { pos: [CX + 6.5, 2.0, 11.5], look: [CX + 20, 5, 9] }, { pos: [CX + 17, 1.8, 4], look: [CX + 30, 3.2, 0] },
        { pos: [CX + 20, 1.8, -5], look: [CX + 6, 4, -16] }, { pos: [CX + 6, 1.9, -11.5], look: [CX - 6, 6, -21] }, { pos: [CX - 8, 1.8, -10], look: [CX - 20, 2.4, -14] },
        { pos: [CX - 18, 1.8, -4.5], look: [CX - 4.5, 3.5, 0] },
      ],
      explosives: fur.explosives, explosivesOnly: true, ambience: { sea: 0, harbour: false },
      stats: { ...built, props: { tris: fur.tris, meshes: fur.meshes, placed: fur.placed.length }, fires: fire.count, firelights: lit.length, puddles: fur.puddles.length, counts: bld.counts, shadow, skyLifted, perimeter: +L.toFixed(2) },
      groundSurfaceAt: () => 'dirt',
      update(dt) {
        clock += dt;
        const flick = noise2(clock * 9, 1.5) * 0.6 + noise2(clock * 23, 7.5) * 0.4;                    // fire: the flames and their light breathe together
        fire.update(clock); crackle.update(dt); pools.update(clock); mats.ember.color.copy(mats.ember.userData.base).multiplyScalar(0.7 + 0.6 * flick);
        for (const l of lit) l.light.intensity = 7.5 * (0.7 + 0.5 * (noise2(clock * 8 + l.seed, 3.1) * 0.6 + flick * 0.4));
        // the game brightens the weapon when you face the sun, but only on levels with an indoor area; do the same here
        if (G.render.sunDir && G.camera) { const d = G.camera.getWorldDirection(fwd), e = Math.max(0, d.x * G.render.sunDir.x + d.z * G.render.sunDir.z); fill += (1.1 + 0.6 * e * e - fill) * Math.min(1, dt * 2.5); G.render.viewFill = fill; }
      },
    };
  }

  MAPS.colosseum = {
    id: 'colosseum', name: 'Colosseum', boot: ['Cutting travertine', 'Raising the seats', 'Raking the sand', 'Opening the gates'],
    pre, level,
    async backdrop() { return { stub: true, update() {} }; },
    // the game's ground also carries the rain: keep that, hide the harbour's apron and sea, and skip the mirror pass they needed
    async ground(G, base) {
      const g = await base();
      g.apron.visible = false; g.sea.visible = false;
      g.root.children.forEach((c, i) => { if (i === 2 && c !== g.rain) c.visible = false; });   // the sea's skirt
      g.setRain(0.35);
      // the pools read the game's mirror picture through the same uniforms the harbour's apron uses, and come back into view once it is drawn
      if (POOLS && g.uniforms && g.uniforms.uRefl) { Object.assign(POOLS.mat.uniforms, { uRefl: g.uniforms.uRefl, uReflMatrix: g.uniforms.uReflMatrix, uReflOn: g.uniforms.uReflOn }); G.render.addPrePass(() => { POOLS.mesh.visible = true; }); }
      else if (POOLS) G.render.addPrePass(() => { POOLS.mesh.visible = true; });
      const pool = (x, z) => PUDDLES.some(p => { const c = Math.cos(p.turn), s = Math.sin(p.turn), dx = x - p.x, dz = z - p.z, lx = dx * c - dz * s, lz = dx * s + dz * c; return (lx * lx) / (p.r * p.r) + (lz * lz) / (p.r * p.r * p.squash * p.squash) < 0.42; });
      g.isPuddle = pool; g.puddleDepth = (x, z) => (pool(x, z) ? 0.03 : -0.2); g.wetnessAt = (x, z) => (pool(x, z) ? 1 : 0.6);
      return g;
    },
    _debug: { CX, A, B, L, HB, SEC, STORES, standsY, outward, profileY, roofAt, ringAt, fireSound, fireVoices: () => (FIRE_VOICES ? FIRE_VOICES() : []) },
  };
})();
