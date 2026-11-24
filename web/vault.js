/* Saltline vaulting. Jump while moving into something low (a barrier, a crate, a ruined wall, a window sill) and the
   player climbs over it, or through the window above it, the way PUBG and Call of Duty do; onto it when it is too deep
   to clear. scripts/gun-hooks.mjs (17) calls start() where the game would jump and step() each frame before it moves the
   player, so a vault replaces the jump and, while it lasts, the game's own movement.

   The rules, all measured from the player's feet:
     - the obstacle is within 75 cm ahead, and its top is between 45 cm and 1.65 m up. Higher than that is a wall: a
       jump already reaches 1.69 m above where the player stands (1.27 m of jump and the 42 cm step), so vaulting
       never reaches anything a jump could not. On Alpine nothing a player can stand on is between 1.2 and 3.2 m, and
       that stays true
     - above the top there is an opening of at least 85 cm, all the way across: a window is enough, standing room is not needed
     - the far side has room for a crouching player. Up to chest height (1.2 m), or thinner than half a metre, the
       player goes over and drops down the far side; higher and deeper (a block, a crate), or deeper than 1.6 m, they
       climb up and stay on top
   The whole path is checked against the map's solid boxes before the vault starts; anything in the way and it is a
   normal jump instead.

   The body. Up to 1.2 m it is a vault: the gun dips, the left hand goes down on the top and the player swings over.
   Higher, it is a climb: both hands on the edge (one if the knife is out), a pull up, then over or on top. From your
   own eyes the hands are the knife's first-person arms (view(), after the camera has its place for the frame); other
   players see the soldier tuck his knees, lean over and put his hand on the same spot (wire() goes out in the
   presence as `vt`, remote() poses it). */
(() => {
  const MIN = 0.45, MAX = 1.65, CLIMB = 1.2, REACH = 0.75, GAP = 0.85, CROUCH = 1.15, DEEP = 1.6, KNEE = 0.3, R = 0.32, STEP = 0.42;
  const LANE = 0.19;   // how wide the path has to be: the body is 0.32 m round, but only head and shoulders go through a window (a 1 m window with its frame leaves 0.86 m)
  let v = null, why = '', seq = 0, sent = null, near = [], info = null;
  const no = w => { why = w; return false; };

  // is anything solid inside the circle (x, z, r) between heights y0 and y1?
  function solid(boxes, x, z, r, y0, y1) {
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.max.y <= y0 || b.min.y >= y1) continue;
      const cx = Math.max(b.min.x, Math.min(b.max.x, x)), cz = Math.max(b.min.z, Math.min(b.max.z, z));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) { hitBox = b; return true; }
    }
    return false;
  }
  let hitBox = null;
  // the lowest underside above y of anything in the circle: the head room there
  function ceiling(boxes, x, z, r, y) {
    let c = Infinity;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.min.y < y - 0.001 || b.min.y >= c) continue;
      const cx = Math.max(b.min.x, Math.min(b.max.x, x)), cz = Math.max(b.min.z, Math.min(b.max.z, z));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) c = b.min.y;
    }
    return c;
  }
  // the top of what stands at (x, z) from height y up: boxes stacked on each other count as one
  function topFrom(boxes, x, z, y) {
    let top = y, grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (b.min.y > top + 0.01 || b.max.y <= top) continue;
        if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
        top = b.max.y; grew = true;
      }
    }
    return top;
  }
  const smooth = t => t * t * (3 - 2 * t);
  const clamp01 = t => Math.max(0, Math.min(1, t));
  const ramp = (t, a, b) => clamp01((t - a) / (b - a));
  const r2 = x => Math.round(x * 100) / 100;

  /* The motion is one smooth curve through a few moments, each with its place and its speed, so the body never stops
     between "up" and "across" and carries the speed it came in with:
       start   where the player is, still moving at their own speed, with a little hop
       hands   at the face of the obstacle, the hands going down, the body most of the way up
       edge    the hips over the front edge, still rising a little
       over    past the far edge (a vault), or standing on the top (a climb onto it)
       out     a vault comes down the far side and hands its speed, falling, to the game
     Between moments the place follows a cubic (Hermite) curve that meets each moment's place and speed exactly. The
     times come from the distances and the speed: a sprint goes over quickly, a walk slowly. */
  function herm(a, b, t, k, vk) {
    const T = b.t - a.t, u = (t - a.t) / T, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * a[k] + (u3 - 2 * u2 + u) * T * a[vk] + (-2 * u3 + 3 * u2) * b[k] + (u3 - u2) * T * b[vk];
  }
  // where the player is at fraction f (0..1) of a vault
  function at(o, f, out) {
    const t = f * o.T, K = o.knots;
    let i = 0; while (i < K.length - 2 && t > K[i + 1].t) i++;
    const s = herm(K[i], K[i + 1], t, 's', 'vs'), y = herm(K[i], K[i + 1], t, 'y', 'vy');
    const l = o.off * smooth(ramp(t, 0, o.tLane));   // the slide sideways into the opening, done by the time the hips are over the edge
    out.x = o.from.x + o.dir.x * s + o.side.x * l; out.z = o.from.z + o.dir.z * s + o.side.z * l; out.y = y;
    return out;
  }
  // how much the hands are on the ledge at fraction f: down as the body meets the face, off as the hips go past
  function hands(o, f) {
    const a = o.hA != null ? o.hA : (o.climb ? 0.16 : 0.2), b = o.hB != null ? o.hB : (o.climb ? 0.9 : 0.82);
    return smooth(ramp(f, 0, Math.max(0.06, a))) * (1 - smooth(ramp(f, b - 0.14, b + 0.04)));
  }

  /* One way over: straight along `yaw`, the line `off` metres to the side of the player. Returns the vault, or a reason. */
  let climbAt = CLIMB;      // over this height, a top half a metre deep or more is climbed onto, not vaulted over (see choose)
  function plan(P, phys, boxes, yaw, off, speed, careful, MAXH, STEPS) {
    const dir = { x: -Math.sin(yaw), z: -Math.cos(yaw) }, side = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const feet = P.pos.y, x0 = P.pos.x + side.x * off, z0 = P.pos.z + side.z * off;
    const ahead = d => [x0 + dir.x * d, z0 + dir.z * d];
    // 1. something at knee height within reach
    let front = -1;
    for (let d = R; d <= R + REACH; d += 0.04) { const [x, z] = ahead(d); if (solid(boxes, x, z, 0.06, feet + KNEE, feet + MIN - 0.02)) { front = d; break; } }
    if (front < 0) return 'nothing low ahead';
    if (hitBox && hitBox.noVault) return 'not something to vault (a bush)';   // a map marks what stops people but is not climbed
    // 2. its top, low enough to vault
    const [tx, tz] = ahead(front + 0.08);
    const top = topFrom(boxes, tx, tz, feet + KNEE), h = top - feet;
    if (h < MIN || h > MAXH) return 'top at ' + h.toFixed(2);
    // 3. how deep it is: where its top ends
    let back = -1;
    for (let d = front + 0.08; d <= front + DEEP; d += 0.04) { const [x, z] = ahead(d); if (!solid(boxes, x, z, 0.06, top - 0.12, top - 0.01)) { back = d; break; } }
    // onto it when it is deep, or higher than the chest and at least half a metre across the top (a block, a crate:
    // climbed onto, as in Call of Duty); over it when it is low or thin (a barrier, a sill, a wall)
    const mantle = back < 0 || (h > climbAt && back - front >= 0.5);
    const endD = !mantle ? back + R + 0.08 : back < 0 ? front + R + 0.2 : Math.min(front + R + 0.2, (front + back) / 2), lift = top + 0.03;
    const [ex, ez] = ahead(endD);
    // 4. room at the far side (crouching), inside the map
    if (solid(boxes, ex, ez, R, lift, lift + CROUCH)) return mantle ? 'no room on top' : 'no room behind';
    const bd = phys.bounds;
    if (bd && (ex < bd.min.x + 0.4 || ex > bd.max.x - 0.4 || ez < bd.min.z + 0.4 || ez > bd.max.z - 0.4)) return 'edge of the map';
    // 5. the curve
    const climb = h > CLIMB, v0 = Math.max(0, Math.min(7.5, speed)), q = clamp01((v0 - 2.5) / 4);
    const sa = Math.max(0, front - R - 0.02);
    const rise = (climb ? 0.36 + 0.3 * (h - CLIMB) / 0.75 : 0.2 + 0.12 * h) * (1 - 0.3 * q) * (careful ? 1.15 : 1);
    const ta = Math.max(rise * 0.5, sa / Math.max(1.2, v0) * 1.1), t1 = ta + rise * 0.5, bump = climb ? 0.05 : 0.1;
    const ya = careful ? lift + bump * 0.5 : feet + h * 0.62;
    const K = [
      { t: 0, s: 0, y: feet, vs: Math.min(v0, 2.4 * sa / ta), vy: careful ? 2.4 : climb ? 0.8 : 1.6 },
      { t: ta, s: sa, y: ya, vs: Math.min(0.6, sa / ta), vy: careful ? 0.2 : (lift + bump - ya) / (t1 - ta) * 1.1 },
      { t: t1, s: Math.max(sa + 0.05, front - 0.17), y: lift + bump, vs: climb ? Math.max(1.1, v0 * 0.35) : Math.max(1.8, v0 * 0.55), vy: climb ? 0.2 : 0.5 },
    ];
    const k1 = K[2];
    if (mantle) {
      const vs = climb ? Math.max(1.2, v0 * 0.4) : Math.max(1.5, v0 * 0.5);
      K.push({ t: t1 + 2 * (endD - k1.s) / (k1.vs + vs) + 0.04, s: endD, y: top, vs, vy: 0 });
    } else {
      const vs = Math.max(2.2, v0 * 0.85), s2 = Math.max(k1.s + 0.05, back + 0.04), t2 = t1 + 2 * (s2 - k1.s) / (k1.vs + vs);
      K.push({ t: t2, s: s2, y: lift + bump * 0.4, vs, vy: -0.5 });
      K.push({ t: t2 + Math.max(0.05, (endD - s2) / vs), s: Math.max(endD, s2 + 0.05), y: lift - 0.12, vs, vy: -1.3 });
    }
    const T = K[K.length - 1].t;
    const o = { from: { x: P.pos.x, y: feet, z: P.pos.z }, dir, side, off, knots: K, T, tLane: t1, lift, top, mantle, climb, h, t: 0, careful,
      hA: ta / T, hB: mantle ? 0.9 : K[3].t / T };
    // 6. the whole path is clear for head and shoulders, with an opening of at least GAP over the top
    const p = { x: 0, y: 0, z: 0 };
    let head = Infinity;
    for (let i = 1; i <= 24; i++) {
      at(o, i / 24, p);
      // on a map that asks for it (level.vaultSteps: Area 51's stair rails), going over something, until the hands reach
      // its top the feet are still on the ground they stood on, and what the game would step up onto (STEP) is no
      // obstacle: on a stair the next tread up is always this close beside the player. Never for a mantle: up a stair
      // that would turn a jump into a climb onto the steps above
      const lo = STEPS && !mantle && i / 24 * T < ta ? Math.max(p.y + 0.02, feet + STEP) : p.y + 0.02;
      if (solid(boxes, p.x, p.z, LANE, lo, p.y + GAP)) { const k = hitBox; return 'path blocked at ' + i + '/24 by ' + [k.min.x, k.min.y, k.min.z, k.max.x, k.max.y, k.max.z].map(r2).join(','); }
      if (p.y >= lift - 0.01) head = Math.min(head, ceiling(boxes, p.x, p.z, LANE, p.y + 0.02) - p.y);
    }
    // through a window the view stays under its top: the body goes through low, as in a dive
    o.dip = Number.isFinite(head) ? Math.max(0, 1.05 + 0.12 - head) : 0;
    const last = K[K.length - 1];
    o.endPos = { x: o.from.x + dir.x * last.s + side.x * off, y: last.y, z: o.from.z + dir.z * last.s + side.z * off };
    o.endVel = { x: dir.x * last.vs, y: last.vy, z: dir.z * last.vs };
    // where the hands go: on the top, just past its front edge, either side of the lane
    const [hx, hz] = ahead(front + 0.1);
    o.handL = { x: hx - side.x * 0.28, y: top + 0.03, z: hz - side.z * 0.28 };
    o.handR = { x: hx + side.x * 0.3, y: top + 0.03, z: hz + side.z * 0.3 };
    return o;
  }

  /* Every way the player could mean: square on to the face in front of them (the maps are built along the axes) and
     the way they look, each straight ahead and a little to either side, so a window is found without lining up on it
     to the centimetre. The first that works wins; the reason given is the one for straight ahead. */
  const OFFS = [0, 0.1, -0.1, 0.2, -0.2, 0.3, -0.3];
  function choose(P, G, speed) {
    const phys = G && G.physics, all = phys && phys.boxes;
    if (!all) return 'no map';
    const MAXH = Math.min(1.95, (G.level && G.level.vaultMax) || MAX);   // a map may allow more (Alpine: 1.95 m, see its file)
    const STEPS = !!(G.level && G.level.vaultSteps);   // and may let a vault start beside a step (see plan)
    climbAt = Math.min(CLIMB, (G.level && G.level.vaultClimb) || CLIMB);   // and may climb onto lower deep tops (Area 51: 0.85 m; a jump at a 1.1 m compressor threw the player over it)
    const feet = P.pos.y, px = P.pos.x, pz = P.pos.z, span = R + REACH + DEEP + R + 1.0;
    near.length = 0;   // only the boxes within reach of any of the ways over: a map can have tens of thousands
    for (let i = 0; i < all.length; i++) {
      const b = all[i];
      if (b.bulletOnly || b.max.y < feet - 0.5 || b.min.y > feet + MAXH + 2.5) continue;
      if (b.max.x < px - span || b.min.x > px + span || b.max.z < pz - span || b.min.z > pz + span) continue;
      near.push(b);
    }
    const snap = Math.round(P.yaw / (Math.PI / 2)) * (Math.PI / 2), d = Math.abs(Math.atan2(Math.sin(P.yaw - snap), Math.cos(P.yaw - snap)));
    const yaws = d > 0.02 && d < 0.62 ? [snap, P.yaw] : [P.yaw];
    let first = null;
    for (const careful of [false, true]) for (const yaw of yaws) for (const off of OFFS) {
      const r = plan(P, phys, near, yaw, off, speed, careful, MAXH, STEPS);
      if (typeof r === 'object') return r;
      if (first === null && yaw === P.yaw && off === 0) first = r;
    }
    return first || 'no way over';
  }

  function start(P, G, input) {
    try {
      if (v || !P || !P.alive || !P.onGround) return no('not on the ground');
      if (!input || !input.move || input.move.y < 0.35) return no('not moving forward');   // only when moving forward into it
      const fwd = -Math.sin(P.yaw) * (P.vel ? P.vel.x : 0) - Math.cos(P.yaw) * (P.vel ? P.vel.z : 0);
      const o = choose(P, G, Math.max(fwd, 0) || P.speed || 0);
      if (typeof o === 'string') return no(o);
      o.seq = ++seq;
      sent = [o.seq, r2(o.handL.x), r2(o.handL.y), r2(o.handL.z), r2(o.handR.x), r2(o.handR.z), r2(o.T), o.climb ? 1 : 0, r2(o.hA), r2(o.hB)];
      o.last = { x: P.pos.x, y: P.pos.y, z: P.pos.z };
      v = o; why = '';
      info = { h: +o.h.toFixed(2), climb: o.climb, mantle: o.mantle, dur: +o.T.toFixed(2), off: o.off, careful: o.careful, at: performance.now(), end: '' };
      P.vaulting = true;
      try { G.events.emit('player:jump', { pos: P.pos }); } catch { /* sound only */ }
      return true;
    } catch (e) { console.error('[vault]', e); v = null; return false; }
  }
  // for the console and the checks: would a vault start here? (nothing moves)
  function test(G, x, y, z, yaw, speed = 4) {
    const P = { pos: { x, y, z }, yaw, vel: { x: 0, z: 0 }, speed };
    const o = choose(P, G, speed);
    return typeof o === 'string' ? o : { h: r2(o.h), climb: o.climb, mantle: o.mantle, dur: r2(o.T), off: o.off, careful: o.careful, dip: r2(o.dip), yaw: r2(Math.atan2(-o.dir.x, -o.dir.z)), end: o.endPos, vel: o.endVel };
  }

  const tmp = { x: 0, y: 0, z: 0 };
  let after = 0;   // seconds since the last vault ended: the gun comes back up over this
  function step(P, G, dt) {
    if (!v) return false;
    if (info) info.t = +v.t.toFixed(3);
    // dead, switched off, or moved by the game (a respawn, a new round): the vault is over
    if (!P.alive || !P.enabled || Math.hypot(P.pos.x - v.last.x, P.pos.z - v.last.z) > 0.6 || Math.abs(P.pos.y - v.last.y) > 0.8) { end(P, 'cut short at ' + v.t.toFixed(2)); return false; }
    v.t = Math.min(1, v.t + dt / v.T);
    at(v, v.t, tmp);
    const dip = v.dip * Math.sin(Math.PI * ramp(v.t, v.hA * 0.8, Math.min(1, v.hB + 0.1)));
    P.pos.set(tmp.x, tmp.y - dip, tmp.z);
    v.last = { x: P.pos.x, y: P.pos.y, z: P.pos.z };
    P.vel.set(0, 0, 0); P.onGround = false; P.crouching = true; P.sprinting = false;
    if (v.t >= 1) {
      // out with the speed the curve ends on: a vault keeps going and falls the rest of the way, the game's own falling and landing take over
      P.pos.set(v.endPos.x, v.endPos.y, v.endPos.z);
      P.vel.set(v.endVel.x, v.endVel.y, v.endVel.z);
      P.onGround = v.mantle;
      end(P, 'done');
    }
    return true;
  }
  function end(P, how) { if (info) { info.end = how; info.took = Math.round(performance.now() - info.at); } v = null; after = 0; if (P) P.vaulting = false; }

  /* ---------------------------------------------------------------- from your own eyes: the gun dips, the hands go on the ledge */
  const PALM = { twist: -1.6, bend: [0, 0.8, 0], grip: 0 };   // the wrist rolled and turned so the palm lies flat, fingers forward
  let arms = null, armsFailed = false, low = 0, lowSet = -1, noFireSet = false, airT = 0, fallV = 0, landK = 0, landT = 0;
  // a world point in a first-person arm's own frame, drawn by the view camera. The hand goes where the ledge is on
  // screen, but never out of sight: once the ledge drops below the view the hand stays pressed at its bottom edge
  function local(G, w, out, k, vfov, arm) {
    const c = G.camera, p = out.set(w.x, w.y, w.z);
    c.worldToLocal(p);
    p.x *= k; p.y *= k;            // the arms are drawn with the view camera's wider angle: put them where the world camera sees the ledge
    const tv = Math.tan(vfov * 0.5) * 0.8, th = tv * (c.aspect || 16 / 9) * 0.85;
    if (-p.z < 0.3) { p.x = arm.mirror ? -0.22 : 0.22; p.y = -1; p.z = -0.4; }   // under or behind the eye: pushing down below the view
    const d = Math.min(0.6, Math.max(0.38, -p.z)), s = d / -p.z;
    p.x *= s; p.y *= s; p.z = -d;  // at arm's length, in the same direction
    p.y = Math.max(-d * tv * 0.62, Math.min(d * tv * 0.3, p.y));
    p.x = Math.max(-d * th, Math.min(d * th, p.x));
    p.x = arm.mirror ? Math.min(p.x, -0.15) : Math.max(p.x, 0.15);   // a shoulder's width apart, never crossed
    if (arm.mirror) p.x = -p.x;     // the left arm is a right arm seen in a mirror (the first-person body has only a right arm)
    return p.sub(arm.at);
  }
  // one first-person arm: the knife's body, holding nothing, its right hand the only part that reaches into view
  function makeArm(G, mirror) {
    const made = window.__SALTLINE_FPBODY(), V = G.camera.position.constructor;
    const arm = { body: made.body, at: made.at.clone(), mirror, to: new V(), rest: new V(0.3, 0.55, 0.1) };   // rest: out of sight, low by the side
    if (mirror) { arm.body.group.scale.x = -1; arm.body.group.position.x = -made.at.x; }
    arm.bend = new G.camera.quaternion.constructor().setFromEuler(new G.camera.rotation.constructor(PALM.bend[0], PALM.bend[1], PALM.bend[2]));
    arm.body.pose({ pitch: 0, lean: 0, crouch: 0, speed: 0, phase: 0, knife: 0, dt: 1 });   // the knife it was built with, put away at once
    arm.body.group.visible = false;
    return arm;
  }
  function view(G, dt) {
    const P = G.player, W = G.weapon;
    // the gun: the weapon's own holster pose, the one it uses between weapons, as far down as the vault wants it
    const want = v ? smooth(ramp(v.t, 0, 0.14)) * (1 - smooth(ramp(v.t, 0.82, 1))) * (v.climb ? 1 : 0.85) : 0;
    if (!v) after += dt;
    try {
      const S = W && W.debug && W.debug.S;
      if (S) {
        const mine = Math.max(want, low * Math.max(0, 1 - dt * 6));
        low = mine;
        if (S.hol === lowSet || S.hol < mine) { S.hol = mine; lowSet = mine; }   // a weapon swap under way keeps its own
        if (mine <= 0.001 && S.hol === lowSet) { S.hol = 0; lowSet = -1; low = 0; }
      }
      if (W && W.debug) {
        if (v && !W.debug.noFire) { W.debug.noFire = true; noFireSet = true; }
        else if (!v && noFireSet) { W.debug.noFire = false; noFireSet = false; }
      }
    } catch { /* the gun stays as it is */ }

    // a landing: the view dips with the knees and comes back, deeper for a longer drop
    if (P && P.alive) {
      if (P.onGround === false) { airT += dt; fallV = Math.min(fallV, P.vel ? P.vel.y : 0); }
      else { if (airT > 0.15 && !v) { landK = Math.min(1, 0.4 + Math.max(0, -fallV - 2) * 0.09); landT = 0; } airT = 0; fallV = 0; }
      if (landK > 0) {
        landT += dt; const f = landT / 0.34;
        if (f >= 1) landK = 0;
        else { const d = Math.sin(Math.PI * Math.min(1, f * 1.4)) * (1 - f * 0.4) * landK; G.camera.position.y -= 0.08 * d; G.camera.rotation.x -= 0.04 * d; }
      }
    }
    if (!v || !P || !P.alive) { if (arms) arms.L.body.group.visible = arms.R.body.group.visible = false; return; }
    // the head follows the body's weight: it dips toward the ledge as the hands push, rolls toward the planted hand
    // and turns a little as the legs swing over, then comes up and bobs as the feet land
    const push = Math.sin(Math.PI * ramp(v.t, v.hA * 0.5, Math.min(1, v.hB + 0.12))), land = Math.sin(Math.PI * ramp(v.t, v.hB, 1));
    G.camera.rotation.x -= (v.climb ? 0.2 : 0.16) * push + 0.07 * land;
    G.camera.rotation.z += (v.climb ? 0.05 : 0.11) * push - 0.03 * land;
    G.camera.rotation.y -= (v.climb ? 0.02 : 0.06) * push;
    // the hands
    if (!arms && !armsFailed) {
      try { arms = window.__SALTLINE_FPBODY ? { L: makeArm(G, true), R: makeArm(G, false) } : null; } catch (e) { console.error('[vault] arms: ' + e); arms = null; }
      if (!arms) armsFailed = true;
    }
    if (!arms) return;
    const w = hands(v, v.t), knife = !!(W && W.root && W.root.visible === false), two = v.climb && !knife;   // with the knife out its own arm holds the right side
    arms.L.body.group.visible = w > 0.001;
    arms.R.body.group.visible = two && w > 0.001;
    if (w <= 0.001) return;
    G.camera.updateMatrixWorld(true);
    const vc = G.render && G.render.viewCamera, half = Math.PI / 360;
    const k = vc ? Math.tan(vc.fov * half) / Math.tan(G.camera.fov * half) : 1, vfov = (vc ? vc.fov : G.camera.fov) * Math.PI / 180;
    for (const [arm, at, on] of [[arms.L, v.handL, true], [arms.R, v.handR, two]]) {
      if (!on) continue;
      local(G, at, arm.to, k, vfov, arm);
      arm.to.lerp(arm.rest, 1 - w);
      // palm down on the ledge: the wrist cocked back, fingers open
      arm.body.pose({ pitch: 0, lean: 0, crouch: 0, speed: 0, phase: 0, knife: 0, dt, handR: arm.to, handRw: 1, twistR: PALM.twist * w, bendR: arm.bend, gripR: PALM.grip });
    }
  }

  /* ---------------------------------------------------------------- other players: what goes out, and how it is shown */
  function wire() { return sent; }
  const lift = (R_, x, y, z, out, yaw = R_.yaw) => {   // a world point in an avatar's own frame (feet at the origin, facing -Z)
    const dx = x - R_.pos.x, dy = y - R_.pos.y, dz = z - R_.pos.z, c = Math.cos(yaw), s = Math.sin(yaw);
    out.x = dx * c - dz * s; out.y = dy; out.z = dx * s + dz * c;
    return out;
  };
  function remote(R_, dt) {
    const vt = R_.pr && R_.pr.vt;
    if (!Array.isArray(vt) || vt.length < 8) return null;
    if (R_.vSeq === undefined) { R_.vSeq = vt[0]; R_.vT = 99; }   // a vault from before we saw this player is not shown
    else if (vt[0] !== R_.vSeq) { R_.vSeq = vt[0]; R_.vT = 0; }
    R_.vT += dt;
    const dur = +vt[6] || 0.6, t = R_.vT / dur;
    if (!(t < 1.12)) return null;
    const climb = vt[7] === 1, o = { climb, hA: vt.length > 9 ? +vt[8] : null, hB: vt.length > 9 ? +vt[9] : null }, tc = Math.min(1, t), a0 = (o.hA != null ? o.hA : 0.2) * 0.7;
    if (!R_.vL) { const V = R_.pos.constructor; R_.vL = new V(); R_.vR = new V(); }
    const w = hands(o, tc), tuck = Math.sin(Math.PI * clamp01((tc - a0) / (1 - a0)));
    /* The whole body moves: as the hand goes down the chest bends forward over the top and rolls toward that hand, the
       hips turn sideways while the legs swing over (a side vault; a climb turns less and bends more), and on the
       landing the body comes up again with a little bend at the knees. */
    const hA = o.hA != null ? o.hA : 0.2, hB = o.hB != null ? o.hB : 0.85;
    const over = Math.sin(Math.PI * clamp01((tc - hA * 0.5) / (Math.min(1, hB + 0.15) - hA * 0.5))), land = Math.sin(Math.PI * clamp01((tc - hB) / Math.max(0.05, 1.1 - hB)));
    const turn = -(climb ? 0.3 : 0.8) * over, yaw = R_.yaw + turn;
    if (R_.av && R_.av.group) R_.av.group.rotation.y = yaw;
    const out = { handL: lift(R_, +vt[1], +vt[2], +vt[3], R_.vL, yaw), handLw: w, tuck: tuck * (climb ? 1 : 0.9), sink: tuck * (climb ? 0.5 : 0.42) + 0.12 * land,
      hunch: (climb ? 0.75 : 0.9) * over + 0.2 * land, lean: -(climb ? 0.35 : 0.85) * over, leanK: 0.3, pitch: (R_.pitch || 0) * (1 - over) - 0.15 * over,
      crouch: Math.max(Math.min(R_.crouchT, 0.35), 0.4 * land), air: false, speed: 0, sprint: true, firing: false, ads: false };
    if (climb && R_.w === 2) { out.handR = lift(R_, +vt[4], +vt[2], +vt[5], R_.vR, yaw); out.handRw = w; }   // knife out: both hands free for the climb
    return out;
  }

  /* Every other player's jumps and landings: rising, the knees come up; falling, the legs reach down for the ground;
     landing, the knees and hips give and come back, deeper for a longer drop. The vault's own pose comes after this. */
  function body(R_, dt) {
    if (!R_.alive || !(dt > 0)) return null;
    const y = R_.pos.y; if (R_.bPy == null) R_.bPy = y;
    const vy = (y - R_.bPy) / dt; R_.bPy = y; R_.bVy = (R_.bVy || 0) + (vy - (R_.bVy || 0)) * Math.min(1, dt * 12);
    if (R_.air) R_.bFall = Math.min(R_.bFall || 0, R_.bVy);
    if (R_.bAir && !R_.air) { R_.bLand = 0; R_.bLandK = Math.min(1, 0.45 + Math.max(0, -(R_.bFall || 0) - 2) * 0.09); R_.bFall = 0; }
    R_.bAir = R_.air;
    const out = {};
    if (R_.air) { const up = clamp01(R_.bVy / 3), down = clamp01(-R_.bVy / 4); out.tuck = 0.25 * up - 0.4 * down; out.hunch = 0.08 * up - 0.06 * down; }
    if (R_.bLand != null) {
      R_.bLand += dt; const f = R_.bLand / 0.4;
      if (f >= 1) R_.bLand = null;
      else { const k = Math.sin(Math.PI * Math.min(1, f * 1.4)) * (1 - f * 0.4) * R_.bLandK; out.crouch = Math.max(R_.crouchT || 0, 0.6 * k); out.hunch = 0.3 * k; }
    }
    return out;
  }

  window.__SALTLINE_VAULT = { start, step, view, wire, remote, body, test, active: () => !!v, why: () => why, last: () => info };   // why: the reason the last try was refused; last: the last vault
})();
