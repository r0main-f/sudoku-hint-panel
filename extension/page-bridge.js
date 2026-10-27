// Sudoku Hint Panel — page bridge (not affiliated with Easybrain / sudoku.com).
// Runs in the page's own JS world, before the game's code.
// 1. Exposes sudoku.com's gameData (page mode, puzzle type, puzzle id) to the
//    helper via DOM attributes.
// 2. Signals the helper the instant the game saves a move, so the hints
//    update as you play instead of on a timer.
// 3. Captures a newly loaded puzzle (/api/.../level/...) so the helper knows
//    the new grid before the game has saved anything for it.
(() => {
  // <html> may not exist yet at document_start: resolve it lazily.
  const ds = new Proxy({}, {
    get: (_, k) => (document.documentElement ? document.documentElement.dataset[k] : undefined),
    set: (_, k, v) => { if (document.documentElement) document.documentElement.dataset[k] = v; return true; },
  });
  const signal = () => document.dispatchEvent(new CustomEvent('sdkh-game-saved'));

  // --- saves -------------------------------------------------------------
  try {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      const r = orig.apply(this, arguments);
      try {
        if (this === window.localStorage) {
          const k = String(key);
          if (/^main_game(_killer)?$/.test(k)) { ds.sdkhSaveT = String(Date.now()); signal(); }
          else if (/storybook|postcard|event|daily|dc_|level|game/i.test(k)) signal(); // special editions
        }
      } catch (e) { /* ignore */ }
      return r;
    };
  } catch (e) { /* ignore */ }

  // --- new puzzles ---------------------------------------------------------
  // classic/killer/events: /api/v2/level/…   daily challenge: /api/dc/2026-10-25   postcards: /api/content/…
  const LEVEL_URL = /\/api\/(v\d+\/)?(level\/(?!finish)|dc\/(?!finish)|content\/)/;
  function onLevel(url, data) {
    try {
      if (!data || typeof data.mission !== 'string' || !/^\d{81}$/.test(data.mission)) return;
      ds.sdkhLevel = JSON.stringify({
        id: data.id,
        mission: data.mission,
        type: /killer/.test(url) ? 'killer' : 'classic',
        t: Date.now(),
      });
      signal();
    } catch (e) { /* ignore */ }
  }

  try {
    const origFetch = window.fetch;
    window.fetch = function (input) {
      const p = origFetch.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (LEVEL_URL.test(url)) {
          p.then((res) => res.clone().json().then((d) => onLevel(url, d))).catch(() => {});
        }
      } catch (e) { /* ignore */ }
      return p;
    };
  } catch (e) { /* ignore */ }

  try {
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      try {
        if (LEVEL_URL.test(String(url))) {
          this.addEventListener('load', () => {
            try { onLevel(String(url), typeof this.response === 'object' ? this.response : JSON.parse(this.responseText)); } catch (e) { /* ignore */ }
          });
        }
      } catch (e) { /* ignore */ }
      return open.apply(this, arguments);
    };
  } catch (e) { /* ignore */ }

  // --- page info -----------------------------------------------------------
  const publish = () => {
    try {
      const gd = window.gameData || {};
      ds.sdkhMode = gd.mode || '';                 // "main", "daily", ...
      ds.sdkhType = gd.content_type || '';         // "classic", "killer"
      ds.sdkhId = gd.content_id != null ? String(gd.content_id) : '';
    } catch (e) { /* ignore */ }
  };
  publish();
  setInterval(publish, 1000);
})();
