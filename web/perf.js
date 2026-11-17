/* Saltline: what the game does to stay smooth that it did not do on its own. The hooks in scripts/perf-hooks.mjs call in here.

   Warm-up. A graphics card draws nothing it has not first been given a program (a shader) for, and three.js makes each
   program the first time something needs it: the first shot, the knife, a grenade, another gun, another player
   walking into view. Making one stops the game for a moment, from a tenth of a second on a fast Mac to most of a
   second in Chrome on Windows (Valle Morta measured up to 0.8 s with ANGLE on Direct3D 11). The same goes for
   pictures, which are copied to the card the first time they are drawn.

   So while the loading screen is up, everything the match can show is shown once, out of sight: every hidden thing
   in the scene made visible, every layer the cameras can draw switched on, nothing left out for being off screen.
   Every program is made then (in parallel where the browser can), every picture copied, and one frame is drawn into
   a small hidden target so the shadow programs are made too. Then everything goes back as it was.

   This is how Valle Morta does it (github.com/Leonxlnx/valle-morta, src/engine/engine.js, prewarm).

     window.__SALTLINE_PERF.warm(renderer, scene, camera)   awaited by the game while it loads; replaces its own compile */
(() => {
  'use strict';
  const log = (...a) => console.info('[perf]', ...a);

  async function warm(renderer, scene, camera) {
    const t0 = performance.now(), before = renderer.info.programs ? renderer.info.programs.length : 0;
    const hidden = [], culled = [], mask = camera.layers.mask, textures = new Set();
    const addTex = v => { if (v && v.isTexture && !v.isRenderTargetTexture) textures.add(v); };
    // A program is made for a number of lights: the lights must stay exactly as they are in play, or the warm-up makes
    // programs for the wrong count and the right ones are still made mid-match. So lights that are off stay off, and
    // so do lights that are on inside something hidden.
    const seen = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }, litBefore = new Set(), quiet = [];
    scene.traverse(o => { if (o.isLight && seen(o)) litBefore.add(o); });
    scene.traverse(o => {
      if (!o.visible && !o.isLight) { hidden.push(o); o.visible = true; }
      if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.frustumCulled) { culled.push(o); o.frustumCulled = false; }
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) { for (const k in m) addTex(m[k]); if (m.uniforms) for (const k in m.uniforms) addTex(m.uniforms[k] && m.uniforms[k].value); }
    });
    scene.traverse(o => { if (o.isLight && o.visible && !litBefore.has(o)) { quiet.push(o); o.visible = false; } });
    camera.layers.enableAll();
    let target = null;
    const keepTarget = renderer.getRenderTarget();
    try {
      for (const t of textures) { if (t.image || t.isDataTexture || t.isDataArrayTexture || t.isCompressedTexture) { try { renderer.initTexture(t); } catch (e) { /* uploaded when first drawn */ } } }
      try { await renderer.compileAsync(scene, camera); } catch (e) { renderer.compile(scene, camera); }
      // one frame, drawn where nobody sees it (into the game's own scene target, which the next frame draws over):
      // the shadow programs and the vertex buffers are made here
      const THREE = window.__G && window.__G.THREE;
      if (!keepTarget && THREE) target = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType });
      if (keepTarget || target) {
        renderer.setRenderTarget(keepTarget || target);
        renderer.shadowMap.needsUpdate = true;
        renderer.render(scene, camera);
      }
    } finally {
      for (const o of hidden) o.visible = false;
      for (const o of quiet) o.visible = true;
      for (const o of culled) o.frustumCulled = true;
      camera.layers.mask = mask;
      renderer.setRenderTarget(keepTarget);
      renderer.shadowMap.needsUpdate = true;                       // the next real frame draws the shadows again, without the hidden things
      if (target) target.dispose();
    }
    const after = renderer.info.programs ? renderer.info.programs.length : 0;
    log(`warm-up: ${after - before} programs made, ${textures.size} pictures, ${hidden.length} hidden things shown once, ${Math.round(performance.now() - t0)} ms`);
  }

  /* The second warm-up, when the multiplayer layer starts (the title screen is up): what only a fight makes. One figure
     of another player, with every gun it can carry and the glow it wears while protected; and one of each effect,
     made forty metres under the ground: muzzle flash, tracer, shell case, bullet holes and splinters on every kind of
     surface, a grenade's blast. Everything is drawn once with the rest, then the figure is taken away and the effects
     cleared. makeFigure returns a function that removes the figure. */
  async function match(G, makeFigure) {
    const T = G.THREE, fx = G.fx, at = new T.Vector3(0, -40, 0), up = new T.Vector3(0, 1, 0), dir = new T.Vector3(0, 0, -1);
    let remove = null;
    try { remove = makeFigure(); } catch (e) { console.error('[perf] figure: ' + e); }
    const tryFx = f => { try { f(); } catch (e) { /* this game has no such effect */ } };
    if (fx) {
      tryFx(() => fx.muzzleFlash(at, dir, { scale: 1 }));
      tryFx(() => fx.tracer(at, at.clone().addScaledVector(dir, 5)));
      tryFx(() => fx.shell(at, up));
      for (const s of ['concrete', 'metal', 'wood', 'glass', 'dirt']) tryFx(() => fx.impact(at, up, s, dir, false));
      tryFx(() => fx.impact(at, up, 'enemy', dir, true));
      for (const k of ['bullet_concrete', 'bullet_metal', 'bullet_wood', 'bullet_glass']) tryFx(() => fx.decal(at, up, k, dir));
      tryFx(() => fx.debris(at, { count: 2, color: 0x303030, size: 0.05, speed: 1, spread: 1 }));
      tryFx(() => fx.explosion(at, 1.4));
    }
    try { await warm(G.renderer, G.scene, G.camera); }
    finally { if (remove) { try { remove(); } catch { /* fine */ } } if (fx) tryFx(() => fx.clear()); }
  }

  window.__SALTLINE_PERF = { warm, match };
})();
