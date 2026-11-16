/* Which map this page load builds.
   The game builds one level per page load, so a map is chosen before the game starts and changing it reloads the page.
   Maps register themselves in window.__SALTLINE_MAPS (see web/maps/); 'terminal' is the game's own harbour and needs no file.

   The choice, in order:
     ?map=<id>                     a link that names a map
     a room link (/r/CODE)         the room's own map, asked from the server while the game starts
     the one-shot note             left by choose() just before it reloads
     the last map this player used
     terminal

   For the rest of the page:  window.__saltlineMaps = { list, id, ready, name(id), choose(id, path, remember) }
   id is the best guess until ready resolves (a room link has to ask the server), and the final answer after.                                  */
(() => {
  'use strict';
  const MAPS = window.__SALTLINE_MAPS || {};
  const LAST = 'saltline.map', ONCE = 'saltline.map.once';
  const list = [{ id: 'terminal', name: 'Saltline Terminal' }, ...Object.keys(MAPS).map(id => ({ id, name: MAPS[id].name || id }))];
  const valid = id => list.some(m => m.id === id);
  const read = (store, key) => { try { return store.getItem(key); } catch { return null; } };
  const write = (store, key, v) => { try { v == null ? store.removeItem(key) : store.setItem(key, v); } catch { /* private mode */ } };

  const qs = new URLSearchParams(location.search);
  const once = read(sessionStorage, ONCE); write(sessionStorage, ONCE, null);
  let id = [qs.get('map'), once, read(localStorage, LAST)].find(valid) || 'terminal';
  if (qs.get('show')) id = 'terminal'; // the game's own asset showcases

  // a room link plays the room's map: ask while the renderer is still loading, and never wait long for the answer
  let decided = Promise.resolve(id);
  const room = location.pathname.match(/^\/r\/([A-Za-z0-9]{6})\/?$/);
  if (room && !valid(qs.get('map')) && !valid(once)) {
    const ask = fetch('/api/rooms/' + room[1].toUpperCase()).then(r => r.json()).then(info => (info && info.exists && valid(info.map) ? info.map : id));
    decided = Promise.race([ask, new Promise(done => setTimeout(() => done(id), 2500))]).catch(() => id);
  }

  const api = window.__saltlineMaps = {
    list, id, ready: null,
    name: mapId => (list.find(m => m.id === mapId) || list[0]).name,
    // switch map: the page reloads into it, optionally at another path (a room link, /?play=dm). remember = false loads the map
    // for this visit only, e.g. to follow a friend into their room without changing the map you play by default
    choose(mapId, path, remember = true) {
      if (!valid(mapId)) return false;
      if (remember) write(localStorage, LAST, mapId);
      write(sessionStorage, ONCE, mapId);
      const url = new URL(path || location.pathname, location.origin);
      location.assign(url.pathname + url.search);
      return true;
    },
  };

  api.ready = decided.then(v => (id = api.id = v));

  // called by the game right after it creates its game object and before it builds anything
  window.__SALTLINE_BOOT = async G => {
    await api.ready;
    const map = MAPS[id] || null;
    window.__SALTLINE_MAP = map;
    document.documentElement.dataset.map = id;
    if (map && map.pre) map.pre(G);
  };
})();
